/**
 * T-SQL routine profiler for the Sybase engine pack (Stored Proc & Function
 * Behaviour Program, Spec 1, 2026-09-09).
 *
 * Deterministic, tokenizer-level (regex over a comment-stripped body — the
 * Spec F "no full T-SQL parser" ruling stands). Produces the engine-neutral
 * `RoutineRecord`: parsed signature (name, params with type / direction /
 * default, RETURNS type, trigger table + events), the static profile that
 * drives the behaviour capture (exit outcomes, result-producing SELECTs,
 * constructs, volatility, non-compensatable reasons) and the body-level
 * read / write / call sets (via the shared SQL parsers).
 *
 * Every heuristic is documented at its site; where the profiler cannot
 * decide it errs towards the HONEST UPPER BOUND (`max_result_sets` counts
 * every SELECT site that could reach the client) or marks the signature
 * unparsed — never silent.
 */

import * as crypto from 'crypto';
import {
  parseProcCallsFromSql,
  parseReadTablesFromSql,
  parseWriteTablesFromSql,
} from '../../../scl/effectCandidateEmitter';
import { normalizedBodyMd5, stripSqlComments } from '../../../scl/sqlProcHarvester';
import type {
  RoutineKind,
  RoutineParam,
  RoutineProfile,
  RoutineRecord,
  RoutineSource,
} from '../routineTypes';

const SELECT_LIST_CAP = 500;
const TEXT_PREVIEW_CAP = 120;

/** SHA-256 over the whitespace-normalised, lower-cased body. */
export function normalizedBodySha256(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function bareLower(raw: string): string {
  const cleaned = raw.replace(/[[\]"]/g, '').trim();
  return (cleaned.split('.').pop() ?? cleaned).toLowerCase();
}

function schemaOf(raw: string): string {
  const cleaned = raw.replace(/[[\]"]/g, '').trim();
  const parts = cleaned.split('.');
  // `db.owner.name` -> owner; `owner.name` -> owner; `name` -> dbo.
  if (parts.length >= 2) return (parts[parts.length - 2] || 'dbo').toLowerCase();
  return 'dbo';
}

function kindFromObjType(objType: string | undefined, text: string): RoutineKind | null {
  const t = (objType ?? '').trim().toUpperCase();
  if (t === 'P') return 'procedure';
  if (t === 'F') return 'function';
  if (t === 'TR') return 'trigger';
  if (/\bcreate\s+trigger\b/i.test(text)) return 'trigger';
  if (/\bcreate\s+function\b/i.test(text)) return 'function';
  if (/\bcreate\s+proc(?:edure)?\b/i.test(text)) return 'procedure';
  return null;
}

/**
 * Split a parameter-list segment on commas at parenthesis depth 0 (so
 * `numeric(10,2)` stays whole). Ignores commas inside single-quoted literals.
 */
function splitTopLevel(segment: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inQuote = false;
  let cur = '';
  for (const ch of segment) {
    if (ch === "'" ) inQuote = !inQuote;
    if (!inQuote) {
      if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      else if (ch === ',' && depth === 0) {
        out.push(cur);
        cur = '';
        continue;
      }
    }
    cur += ch;
  }
  if (cur.trim().length > 0) out.push(cur);
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

// `@name type [= default] [output|out]` — the type may carry (n) / (p,s);
// the default may be a quoted literal, a number, NULL or a bare token.
const PARAM_RE =
  /^@([A-Za-z0-9_]+)\s+([A-Za-z_][A-Za-z0-9_]*(?:\s*\(\s*[0-9]+(?:\s*,\s*[0-9]+)?\s*\))?)\s*(?:=\s*('(?:[^']|'')*'|-?[0-9]+(?:\.[0-9]+)?|null|[A-Za-z0-9_]+))?\s*(output|out)?\s*$/i;

function parseParams(segment: string): { params: RoutineParam[]; error: string | null } {
  let s = segment.trim();
  // Strip `with recompile` / `with encryption` trailers and a surrounding paren pair.
  s = s.replace(/\bwith\s+(recompile|encryption)\b/gi, '').trim();
  if (s.startsWith('(') && s.endsWith(')')) s = s.slice(1, -1).trim();
  if (s.length === 0) return { params: [], error: null };
  const parts = splitTopLevel(s);
  const params: RoutineParam[] = [];
  for (let i = 0; i < parts.length; i++) {
    const m = PARAM_RE.exec(parts[i]);
    if (!m) {
      return { params, error: `unparsed parameter ${i + 1}: ${parts[i].slice(0, 80)}` };
    }
    params.push({
      name: m[1],
      ordinal: i + 1,
      source_type: m[2].replace(/\s+/g, '').toLowerCase(),
      direction: m[4] ? 'output' : 'in',
      default_literal: m[3] !== undefined ? m[3] : null,
    });
  }
  return { params, error: null };
}

interface HeaderParse {
  name: string;
  schema: string;
  params: RoutineParam[];
  returnsType: string | null;
  triggerOnTable: string | null;
  triggerEvents: string[];
  bodyStart: number;
  error: string | null;
}

/** Index of the first standalone `AS` keyword at parenthesis depth 0 after `from`. */
function findBodyAs(text: string, from: number): number {
  const re = /\bas\b/gi;
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(from, m.index);
    let depth = 0;
    let inQuote = false;
    for (const ch of before) {
      if (ch === "'") inQuote = !inQuote;
      if (inQuote) continue;
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    if (depth <= 0 && !inQuote) return m.index;
  }
  return -1;
}

function parseHeader(kind: RoutineKind, text: string): HeaderParse {
  const fail = (error: string, name = '', schema = 'dbo'): HeaderParse => ({
    name,
    schema,
    params: [],
    returnsType: null,
    triggerOnTable: null,
    triggerEvents: [],
    bodyStart: 0,
    error,
  });
  if (kind === 'trigger') {
    const m = /\bcreate\s+trigger\s+([A-Za-z0-9_."\[\]]+)\s+on\s+([A-Za-z0-9_."\[\]]+)\s+(?:for|after|instead\s+of)\s+([A-Za-z]+(?:\s*,\s*[A-Za-z]+)*)/i.exec(
      text,
    );
    if (!m) return fail('trigger header not recognised');
    const asAt = findBodyAs(text, m.index + m[0].length);
    return {
      name: bareLower(m[1]),
      schema: schemaOf(m[1]),
      params: [],
      returnsType: null,
      triggerOnTable: bareLower(m[2]),
      triggerEvents: m[3]
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.length > 0),
      bodyStart: asAt >= 0 ? asAt + 2 : m.index + m[0].length,
      error: null,
    };
  }
  if (kind === 'function') {
    const m = /\bcreate\s+function\s+([A-Za-z0-9_."\[\]]+)\s*\(([\s\S]*?)\)\s*returns\s+([\s\S]+?)(?=\bwith\b|\bas\b|\bbegin\b)/i.exec(
      text,
    );
    if (!m) return fail('function header not recognised');
    const parsed = parseParams(m[2]);
    const asAt = findBodyAs(text, m.index + m[0].length);
    return {
      name: bareLower(m[1]),
      schema: schemaOf(m[1]),
      params: parsed.params,
      returnsType: m[3].replace(/\s+/g, ' ').trim(),
      triggerOnTable: null,
      triggerEvents: [],
      bodyStart: asAt >= 0 ? asAt + 2 : m.index + m[0].length,
      error: parsed.error,
    };
  }
  const m = /\bcreate\s+proc(?:edure)?\s+([A-Za-z0-9_."\[\]]+)(?:\s*;\s*\d+)?/i.exec(text);
  if (!m) return fail('procedure header not recognised');
  const afterName = m.index + m[0].length;
  const asAt = findBodyAs(text, afterName);
  if (asAt < 0) return fail('procedure body AS not found', bareLower(m[1]), schemaOf(m[1]));
  const parsed = parseParams(text.slice(afterName, asAt));
  return {
    name: bareLower(m[1]),
    schema: schemaOf(m[1]),
    params: parsed.params,
    returnsType: null,
    triggerOnTable: null,
    triggerEvents: [],
    bodyStart: asAt + 2,
    error: parsed.error,
  };
}

const STATEMENT_KEYWORDS =
  /\b(insert|update|delete|if|else|begin|end|while|declare|set|exec|execute|return|print|raiserror|select|fetch|open|close|deallocate|commit|rollback|goto|break|continue|waitfor|truncate|create|drop|alter)\b|;/gi;

/**
 * Result-producing SELECT sites. A SELECT is NOT result-producing when it
 * is a subquery (`(` immediately precedes it), an INSERT ... SELECT, a
 * variable assignment (`select @x =`), a SELECT INTO, or an EXISTS/IN
 * operand. Everything else is counted — an honest upper bound.
 */
function findResultSelects(body: string): RoutineProfile['result_selects'] {
  const out: RoutineProfile['result_selects'] = [];
  const re = /\bselect\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const at = m.index;
    const before = body.slice(Math.max(0, at - 200), at).replace(/\s+/g, ' ');
    const trimmedBefore = before.trimEnd();
    if (trimmedBefore.endsWith('(')) continue; // subquery / derived table
    if (/\b(exists|in|any|all|some)\s*\(?\s*$/i.test(trimmedBefore)) continue;
    // INSERT ... SELECT: an INSERT with no statement keyword between it and this SELECT.
    const lastStmt = [...trimmedBefore.matchAll(STATEMENT_KEYWORDS)].pop();
    if (lastStmt && /^insert$/i.test(lastStmt[0])) continue;
    const rest = body.slice(at + 6);
    // Statement extent: up to the next statement keyword at depth 0 (approx).
    let end = rest.length;
    STATEMENT_KEYWORDS.lastIndex = 0;
    let depth = 0;
    let idx = 0;
    for (; idx < rest.length; idx++) {
      const ch = rest[idx];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (depth <= 0) {
        const tail = rest.slice(idx, idx + 12);
        const km = /^(insert|update|delete|if|else|begin|end|while|declare|set|exec|execute|return|print|raiserror|select|fetch|open|close|deallocate|commit|rollback|goto|waitfor|truncate|create|drop)\b|^;/i.exec(
          tail,
        );
        if (km && idx > 0 && /[\s;)]/.test(rest[idx - 1] ?? ' ')) {
          end = idx;
          break;
        }
      }
    }
    const stmt = rest.slice(0, end);
    if (/^\s*@[A-Za-z0-9_]+\s*=/.test(stmt)) continue; // select @x = ...
    if (/^\s*(top\s+\d+\s+)?[\s\S]*?\binto\s+[#@]?[A-Za-z0-9_."\[\]]+/i.test(stmt) && /\binto\b/i.test(stmt.split(/\bfrom\b/i)[0] ?? '')) continue; // select into
    const listPart = (stmt.split(/\bfrom\b/i)[0] ?? '').replace(/\s+/g, ' ').trim();
    out.push({
      ordinal: out.length + 1,
      has_order_by: /\border\s+by\b/i.test(stmt),
      has_top: /^\s*top\s+\d+/i.test(stmt),
      select_list_static: listPart.length > 0 ? listPart.slice(0, SELECT_LIST_CAP) : null,
    });
  }
  return out;
}

function findReturnSites(body: string): RoutineProfile['return_sites'] {
  const out: RoutineProfile['return_sites'] = [];
  const re = /\breturn\b[ \t]*(\(?\s*(-?\d+)\s*\)?|@[A-Za-z0-9_]+|\([^)\n]*\))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const raw = (m[1] ?? '').trim();
    if (m[2] !== undefined) {
      out.push({ value: Number(m[2]), expr: null });
    } else if (raw.length > 0) {
      out.push({ value: null, expr: raw.slice(0, 80) });
    } else {
      out.push({ value: null, expr: null });
    }
  }
  return out;
}

function findRaiserrorSites(body: string): RoutineProfile['raiserror_sites'] {
  const out: RoutineProfile['raiserror_sites'] = [];
  // raiserror 20001 'msg' | raiserror 20001, 'msg' | raiserror(20001, 16, 1, 'msg') | raiserror(@n, ...)
  const re = /\braiserror\s*(\()?\s*(\d+|@[A-Za-z0-9_]+)?\s*,?\s*(\d+)?[^\n']*('(?:[^']|'')*')?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const number = m[2] && /^\d+$/.test(m[2]) ? Number(m[2]) : null;
    const severity = m[1] && m[3] ? Number(m[3]) : null;
    const text = m[4] ? m[4].slice(1, -1).replace(/''/g, "'").slice(0, TEXT_PREVIEW_CAP) : null;
    out.push({ number, severity, text_preview: text });
  }
  return out;
}

const CONSTRUCT_TESTS: Array<[string, RegExp]> = [
  ['temp_table', /(^|[\s(,])#[A-Za-z_]/],
  ['cursor', /\bdeclare\s+[A-Za-z0-9_]+\s+cursor\b/i],
  ['transaction_control', /\b(begin\s+tran(?:saction)?|commit(?:\s+tran(?:saction)?)?|rollback(?:\s+tran(?:saction)?)?)\b/i],
  ['dynamic_sql', /\bexec(?:ute)?\s*\(\s*@|\bsp_executesql\b/i],
  ['system_proc', /\b(?:exec(?:ute)?\s+(?:@[A-Za-z0-9_]+\s*=\s*)?)?(?:[A-Za-z0-9_]+\.\.|master\.dbo\.)?xp_[A-Za-z0-9_]+\b|\bexec(?:ute)?\s+(?:@[A-Za-z0-9_]+\s*=\s*)?(?:[A-Za-z0-9_.]+\.)?sp_[A-Za-z0-9_]+\b/i],
  ['remote_call', /\bexec(?:ute)?\s+(?:@[A-Za-z0-9_]+\s*=\s*)?[A-Za-z0-9_]+\.[A-Za-z0-9_]*\.[A-Za-z0-9_]*\.[A-Za-z0-9_]+\b/i],
  ['cross_db_dml', /\b(?:insert\s+(?:into\s+)?|update\s+|delete\s+(?:from\s+)?)[A-Za-z0-9_]+\.[A-Za-z0-9_]*\.[A-Za-z0-9_]+\b/i],
  ['waitfor', /\bwaitfor\b/i],
  ['set_rowcount', /\bset\s+rowcount\b/i],
  ['set_nocount', /\bset\s+nocount\b/i],
  ['print', /\bprint\b/i],
];

const VOLATILE_FNS = ['getdate', 'getutcdate', 'newid', 'rand', '@@identity', '@@spid', 'current_date', 'current_time'];
const SESSION_USER_FNS = ['suser_name', 'user_name', 'suser_id', 'user_id', 'host_name', 'app_name', '@@servername'];

function tokensPresent(body: string, tokens: string[]): string[] {
  const lower = body.toLowerCase();
  return tokens.filter((t) => {
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![A-Za-z0-9_@])${escaped}(?![A-Za-z0-9_])`, 'i').test(lower);
  });
}

function findSetOptions(body: string): string[] {
  const out: string[] = [];
  const re = /\bset\s+(nocount|rowcount|ansinull|arithabort|quoted_identifier|chained|textsize|dateformat|transaction\s+isolation\s+level|xact_abort)\s+([A-Za-z0-9_]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const opt = `${m[1].replace(/\s+/g, ' ')} ${m[2]}`.toLowerCase();
    if (!out.includes(opt)) out.push(opt);
  }
  return out;
}

/** Profile one Sybase T-SQL routine source into an engine-neutral record. */
export function profileTsqlRoutine(source: RoutineSource): RoutineRecord {
  const rawText = source.text ?? '';
  const text = stripSqlComments(rawText);
  const kind = kindFromObjType(source.objType, text);
  const fallbackName = bareLower(source.name || '');
  const empty: RoutineProfile = {
    return_sites: [],
    return_status_trivial: true,
    raiserror_sites: [],
    result_selects: [],
    max_result_sets: 0,
    constructs: [],
    volatile_functions: [],
    session_user_functions: [],
    non_compensatable_reasons: [],
    set_options: [],
  };
  const base: RoutineRecord = {
    schema_name: 'dbo',
    routine_name: fallbackName,
    routine_kind: kind ?? 'procedure',
    language: 'TSQL',
    full_body: rawText,
    body_hash: normalizedBodySha256(rawText),
    body_md5: normalizedBodyMd5(rawText),
    params: [],
    returns_type: null,
    trigger_on_table: null,
    trigger_events: [],
    profile: empty,
    reads: [],
    writes: [],
    proc_calls: [],
    reads_closure: [],
    writes_closure: [],
    trigger_expanded_writes: [],
    source: 'live',
    signature_parsed: false,
    signature_error: null,
  };
  if (!kind) {
    return { ...base, signature_error: 'routine kind not recognised (no CREATE PROC/FUNCTION/TRIGGER)' };
  }
  const header = parseHeader(kind, text);
  const body = header.error && header.bodyStart === 0 ? text : text.slice(header.bodyStart);
  const selfName = header.name || fallbackName;

  const constructs = CONSTRUCT_TESTS.filter(([, re]) => re.test(body)).map(([tag]) => tag);
  const nonCompensatable = constructs.filter((c) =>
    ['system_proc', 'remote_call', 'cross_db_dml', 'dynamic_sql', 'waitfor'].includes(c),
  );
  const returnSites = findReturnSites(body);
  const resultSelects = findResultSelects(body);
  const profile: RoutineProfile = {
    return_sites: returnSites,
    return_status_trivial: returnSites.every((r) => r.expr === null && (r.value === null || r.value === 0)),
    raiserror_sites: findRaiserrorSites(body),
    result_selects: resultSelects,
    max_result_sets: resultSelects.length,
    constructs,
    volatile_functions: tokensPresent(body, VOLATILE_FNS),
    session_user_functions: tokensPresent(body, SESSION_USER_FNS),
    non_compensatable_reasons: nonCompensatable,
    set_options: findSetOptions(body),
  };
  return {
    ...base,
    schema_name: header.schema || 'dbo',
    routine_name: selfName,
    routine_kind: kind,
    params: header.params,
    returns_type: header.returnsType,
    trigger_on_table: header.triggerOnTable,
    trigger_events: header.triggerEvents,
    profile,
    reads: parseReadTablesFromSql(body).map((t) => t.toLowerCase()),
    writes: parseWriteTablesFromSql(body).map((t) => t.toLowerCase()),
    proc_calls: parseProcCallsFromSql(body)
      .map((p) => p.toLowerCase())
      .filter((p) => p !== selfName),
    signature_parsed: header.error === null,
    signature_error: header.error,
  };
}
