/**
 * T-SQL routine profiler -- shared by BOTH T-SQL engine packs (Stored Proc &
 * Function Behaviour Program, Spec 1, 2026-09-09; extended for SQL Server by
 * the SQL Server 16 -> PostgreSQL 18 pair programme, Spec 2, 2026-09-11).
 *
 * The dialect is genuinely shared: Microsoft SQL Server and Sybase ASE
 * descend from the same T-SQL, so ONE profiler serves both packs and the
 * constructs recognised are the UNION of the two engines'. A SQL-Server-only
 * construct (TRY/CATCH, THROW, XACT_ABORT, MERGE, the OUTPUT clause, APPLY,
 * NEXT VALUE FOR, FOR SYSTEM_TIME, CONTAINS/FREETEXT, the XML methods,
 * OPENQUERY) simply never fires on an ASE body, so the ASE profile is
 * unchanged by their addition. The module stays in the `sybase/` pack folder
 * because that is where it was born and moving it would rewrite every
 * importer for no behavioural gain; the `mssql/` pack imports it directly.
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

/**
 * The routine's own name with its CASE PRESERVED (2026-09-12). The catalog
 * used to store `bareLower(...)`, and the capture built its EXEC target from
 * the catalog row -- on a case-sensitive ASE that is a different object, so
 * every invocation of a mixed-case routine came back 2812 "not found" and 23
 * of 25 attemptable routines were unreachable by name. Join keys stay
 * lowercase everywhere (the catalog, AMS's natural key, the callee ordering,
 * the workbench maps all lowercase both sides); only the identifier the
 * server is asked to run keeps its case.
 */
function bareName(raw: string): string {
  const cleaned = raw.replace(/[[\]"]/g, '').trim();
  return cleaned.split('.').pop() ?? cleaned;
}

/**
 * Blank out single-quoted string literals (doubled quotes escape) so table /
 * routine mining never reads inside message text (2026-09-12): a PRINT
 * '... delete from GRD ...' used to mine a phantom write table that is not
 * in the model, and the bracket then refused the routine with missing_pk on
 * a table that does not exist. Length is preserved so no offsets move.
 */
export function blankSqlStringLiterals(text: string): string {
  return text.replace(/N?'(?:[^']|'')*'/g, (m) => ' '.repeat(m.length));
}

/**
 * One-pass scanner that blanks string literals AND comments together
 * (2026-09-12). Doing them in two passes is wrong in both orders: a `--`
 * inside a literal would swallow the literal's closing quote (and with it
 * the next statement), and a `'` inside a comment would open a phantom
 * literal. Length and newlines are preserved so no offsets move.
 */
export function blankSqlLiteralsAndComments(text: string): string {
  return scanSql(text, true);
}

/**
 * Comments blanked, string literals KEPT (2026-09-12). The profiler used to
 * pre-strip comments with a scanner that did not know about literals, so a
 * `--` inside a PRINT / RAISERROR message swallowed the literal's closing
 * quote and everything after it read as one long string -- the header
 * parsed, but the body's updates, calls and reads all vanished from the
 * catalog. Literal text must survive here: RAISERROR / PRINT previews and
 * exit-outcome mining read it.
 */
export function blankSqlCommentsKeepLiterals(text: string): string {
  return scanSql(text, false);
}

function scanSql(text: string, blankLiterals: boolean): string {
  const out: string[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === "'" ) {
      // string literal (doubled quote escapes)
      const keep = (s: string): string => (blankLiterals ? s.replace(/[^\n]/g, ' ') : s);
      out.push(keep("'"));
      i += 1;
      while (i < n) {
        if (text[i] === "'") {
          if (text[i + 1] === "'") { out.push(keep("''")); i += 2; continue; }
          out.push(keep("'"));
          i += 1;
          break;
        }
        out.push(keep(text[i]));
        i += 1;
      }
      continue;
    }
    if (ch === '-' && next === '-') {
      while (i < n && text[i] !== '\n') { out.push(' '); i += 1; }
      continue;
    }
    if (ch === '/' && next === '*') {
      out.push('  ');
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) {
        out.push(text[i] === '\n' ? '\n' : ' ');
        i += 1;
      }
      if (i < n) { out.push('  '); i += 2; }
      continue;
    }
    out.push(ch);
    i += 1;
  }
  return out.join('');
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

// One identifier part: bare, `[bracketed]` or `"quoted"`.
const IDENT_PART = '(?:[A-Za-z_][A-Za-z0-9_]*|\\[[^\\]]+\\]|"[^"]+")';

// `@name type [= default] [output|out] [readonly]` in any trailing-modifier
// order. The NAME may be bracketed; the TYPE may be schema-qualified
// (`Website.OrderList` / `[dbo].[OrderIDList]` -- a SQL Server user-defined
// table type) and may carry `(n)` / `(max)` / `(p,s)`. The default may be a
// quoted literal (optionally `N`-prefixed), a number, NULL, a bare token or a
// parenthesised expression.
const PARAM_RE = new RegExp(
  '^@(' +
    IDENT_PART +
    ')\\s+(' +
    IDENT_PART +
    '(?:\\s*\\.\\s*' +
    IDENT_PART +
    ')*' +
    "(?:\\s*\\(\\s*(?:max|[0-9]+(?:\\s*,\\s*[0-9]+)?)\\s*\\))?)" +
    "\\s*(?:=\\s*(N?'(?:[^']|'')*'|-?[0-9]+(?:\\.[0-9]+)?|null|\\([^)]*\\)|[A-Za-z0-9_]+))?" +
    '\\s*((?:\\b(?:output|out|readonly)\\b\\s*)*)$',
  'i',
);

function parseParams(segment: string): { params: RoutineParam[]; error: string | null } {
  let s = segment.trim();
  // Strip the procedure-option trailers that sit between the parameter list
  // and the body `AS`: ASE's `with recompile` / `with encryption`, and SQL
  // Server's `with execute as owner|caller|self|'user'` (and the bare
  // `with native_compilation` / `schemabinding` module options).
  s = s
    .replace(/\bwith\s+execute\s+as\s+(?:owner|caller|self|'[^']*'|N'[^']*')/gi, '')
    .replace(
      /\bwith\s+(recompile|encryption|schemabinding|native_compilation|inline\s*=\s*(?:on|off))\b/gi,
      '',
    )
    .replace(/\bexecute\s+as\s+(?:owner|caller|self|'[^']*'|N'[^']*')/gi, '')
    .trim();
  // A trailing comma left behind by a stripped trailer is not a parameter.
  s = s.replace(/,\s*$/, '').trim();
  if (s.startsWith('(') && s.endsWith(')')) s = s.slice(1, -1).trim();
  if (s.length === 0) return { params: [], error: null };
  const parts = splitTopLevel(s);
  const params: RoutineParam[] = [];
  for (let i = 0; i < parts.length; i++) {
    const m = PARAM_RE.exec(parts[i]);
    if (!m) {
      return { params, error: `unparsed parameter ${i + 1}: ${parts[i].slice(0, 80)}` };
    }
    const modifiers = (m[4] ?? '').toLowerCase();
    const isReadonly = /\breadonly\b/.test(modifiers);
    params.push({
      name: m[1].replace(/^[["]|[\]"]$/g, ''),
      ordinal: i + 1,
      source_type: m[2].replace(/\s+/g, '').toLowerCase(),
      direction: /\b(?:output|out)\b/.test(modifiers) ? 'output' : 'in',
      default_literal: m[3] !== undefined ? m[3] : null,
      // Only ever SET when true, so an ASE routine's params serialise exactly
      // as they did before READONLY was understood.
      ...(isReadonly ? { is_readonly: true } : {}),
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

/**
 * Index of the first standalone `AS` keyword at parenthesis depth 0 after
 * `from`.
 *
 * SQL Server puts `WITH EXECUTE AS OWNER` between the parameter list and the
 * body `AS`, so an `as` whose preceding word is `execute` / `exec` is part of
 * that clause and is skipped -- taking it as the body start would cut the
 * header in half and lose every parameter.
 */
function findBodyAs(text: string, from: number): number {
  const re = /\bas\b/gi;
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(from, m.index);
    if (/\b(?:execute|exec)\s*$/i.test(before)) continue;
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
      name: bareName(m[1]),
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
      name: bareName(m[1]),
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
  if (asAt < 0) return fail('procedure body AS not found', bareName(m[1]), schemaOf(m[1]));
  const parsed = parseParams(text.slice(afterName, asAt));
  return {
    name: bareName(m[1]),
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
  /\b(insert|update|delete|merge|if|else|begin|end|while|declare|set|exec|execute|return|print|raiserror|throw|select|fetch|open|close|deallocate|commit|rollback|goto|break|continue|waitfor|truncate|create|drop|alter)\b|;/gi;

/**
 * Statements that can FAIL at runtime. Used by the error-continuation
 * detector below -- the point is not that they write, but that any of them
 * can raise and, without TRY/CATCH or an `@@ERROR` check, execution simply
 * carries on to the next statement with the batch half-applied.
 */
const FALLIBLE_STATEMENT =
  /\b(insert|update|delete|merge|exec|execute|truncate|create|drop|alter)\b/gi;

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
  out.push(...findThrowSites(body));
  return out;
}

/**
 * THROW sites (SQL Server 2012+), collected into the SAME `raiserror_sites`
 * list: both are "this routine can exit by raising", and the capture layer
 * only ever asks that question. The two forms:
 *
 *   - `THROW 51000, 'message', 1;` -- an explicit error. Unlike RAISERROR,
 *     THROW has NO severity argument (its third argument is the STATE), so
 *     `severity` is null and never guessed. A user-defined THROW number is
 *     always >= 50000, which is exactly the DETAIL boundary the pair's
 *     error-mapping rule keys on.
 *   - `THROW;` (bare) -- a RE-THROW inside a CATCH block. Nothing about the
 *     error is statically known, so every field is null rather than invented.
 *
 * The THROW keyword is skipped when it is immediately followed by a word
 * character (so an identifier like `throw_count` never registers).
 */
function findThrowSites(body: string): RoutineProfile['raiserror_sites'] {
  const out: RoutineProfile['raiserror_sites'] = [];
  const re =
    /\bthrow\b(?:\s*(\d+|@[A-Za-z0-9_]+)\s*,\s*(N?'(?:[^']|'')*'|@[A-Za-z0-9_]+)\s*,\s*(\d+|@[A-Za-z0-9_]+))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const number = m[1] && /^\d+$/.test(m[1]) ? Number(m[1]) : null;
    let text: string | null = null;
    if (m[2] && /^N?'/i.test(m[2])) {
      const literal = m[2].replace(/^N/i, '');
      text = literal.slice(1, -1).replace(/''/g, "'").slice(0, TEXT_PREVIEW_CAP);
    }
    // THROW carries no severity argument -- the third value is the STATE.
    out.push({ number, severity: null, text_preview: text });
  }
  return out;
}

/**
 * ERROR CONTINUATION -- the shaping doc's hard item 3, and the single most
 * dangerous like-for-like difference in this pair.
 *
 * In T-SQL, most statement-level errors do NOT abort the batch: execution
 * carries straight on to the next statement with the work half-applied.
 * PostgreSQL aborts the whole transaction instead, so a routine that RELIES
 * on continuing after a failure behaves differently the moment it is
 * translated -- silently, and only on the error path.
 *
 * A routine is tagged when ALL of these hold:
 *   - it contains a statement that can fail (see {@link FALLIBLE_STATEMENT}),
 *   - at least one further statement follows that one,
 *   - there is NO enclosing `BEGIN TRY` (which makes the flow explicit),
 *   - there is NO `@@ERROR` check (the classic pre-TRY/CATCH idiom for
 *     handling it deliberately), and
 *   - `SET XACT_ABORT ON` is not in force (which turns errors into batch
 *     aborts and so removes the continuation entirely).
 *
 * This is a HAZARD FLAG, never a compensation verdict: it does not join
 * `non_compensatable_reasons`, because a routine that continues after an
 * error is still perfectly bracketable from its static write set.
 */
function hasErrorContinuation(body: string): boolean {
  if (!body) return false;
  if (/\bbegin\s+try\b/i.test(body)) return false;
  if (/@@error\b/i.test(body)) return false;
  if (/\bset\s+xact_abort\s+on\b/i.test(body)) return false;
  FALLIBLE_STATEMENT.lastIndex = 0;
  const first = FALLIBLE_STATEMENT.exec(body);
  if (!first) return false;
  const after = body.slice(first.index + first[0].length);
  STATEMENT_KEYWORDS.lastIndex = 0;
  return STATEMENT_KEYWORDS.test(after);
}

/**
 * Construct tags. The first eleven are the original ASE set; everything
 * after the divider was added for SQL Server (pair programme Spec 2 §2.2)
 * and simply never fires on an ASE body, so the ASE profile is unchanged.
 */
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
  // ---- SQL Server constructs (pair programme Spec 2 §2.2) ----
  // Error / transaction semantics (shaping hard item 3).
  ['try_catch', /\bbegin\s+try\b/i],
  ['throw', /\bthrow\b\s*(?:;|\d|@|$)/im],
  ['xact_abort', /\bset\s+xact_abort\s+(?:on|off)\b/i],
  ['trancount', /@@trancount\b/i],
  ['save_tran', /\bsave\s+tran(?:saction)?\b/i],
  // Statement forms with no PostgreSQL one-to-one.
  ['merge', /\bmerge\s+(?:into\s+)?[A-Za-z_["]/i],
  // The OUTPUT CLAUSE, not an OUTPUT parameter: it is always followed by the
  // `inserted.` / `deleted.` pseudo-tables (or `* INTO`).
  ['output_clause', /\boutput\s+(?:\*\s+into\b|(?:[A-Za-z0-9_]+\.)?(?:inserted|deleted)\s*\.)/i],
  ['table_variable', /\bdeclare\s+@[A-Za-z0-9_]+\s+(?:as\s+)?table\b/i],
  ['offset_fetch', /\boffset\s+\S+\s+rows?\b/i],
  ['apply', /\b(?:cross|outer)\s+apply\b/i],
  ['iif', /\biif\s*\(/i],
  ['try_convert', /\btry_(?:convert|cast|parse)\s*\(/i],
  ['string_agg', /\bstring_agg\s*\(/i],
  // A PARAMETERISED sp_executesql -- the second argument is the quoted
  // parameter declaration list. Distinct from plain `dynamic_sql` because a
  // parameterised call is safely bindable, where string concatenation is not.
  ['sp_executesql_params', /\bsp_executesql\b[\s\S]{0,800}?,\s*N?'\s*@/i],
  ['next_value_for', /\bnext\s+value\s+for\b/i],
  // Temporal + full-text + XML (shaping hard item 5).
  ['for_system_time', /\bfor\s+system_time\b/i],
  ['contains_freetext', /\b(?:contains|freetext)(?:table)?\s*\(/i],
  ['xml_method', /\.(?:value|query|nodes|modify|exist)\s*\(\s*N?'/i],
  // The two OUT rulings' detectors (shaping §3 ruling 3, items 1 and 6). Both
  // classify as CROSS_DATABASE: a linked-server call and a three-/four-part
  // name are the same untranslatable reason wearing different clothes.
  ['openquery_linked', /\b(?:openquery|openrowset|opendatasource)\s*\(/i],
  [
    'three_part_name',
    /\b(?:from|join|apply|into|update|delete\s+from|insert\s+into|insert|merge|exec|execute|references)\s+(?:[A-Za-z_][A-Za-z0-9_$#@]*|\[[^\]]+\])\.(?:[A-Za-z_][A-Za-z0-9_$#@]*|\[[^\]]+\])?\.(?:[A-Za-z_][A-Za-z0-9_$#@]*|\[[^\]]+\])/i,
  ],
];

/**
 * Construct tags that mean "this routine reaches outside its own database".
 * The shaping doc's item-1 OUT ruling names the reason
 * `cross_database_reference`; these are the body-level signals that produce
 * it. Exported so the SQL Server pack's finding layer and the downstream
 * translation gate agree on ONE list rather than each keeping its own.
 */
export const CROSS_DATABASE_CONSTRUCTS: ReadonlyArray<string> = [
  'openquery_linked',
  'three_part_name',
  'remote_call',
  'cross_db_dml',
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
  const re = /\bset\s+(nocount|rowcount|ansinull|ansi_nulls|ansi_warnings|ansi_padding|arithabort|concat_null_yields_null|numeric_roundabort|quoted_identifier|chained|implicit_transactions|lock_timeout|deadlock_priority|textsize|dateformat|datefirst|transaction\s+isolation\s+level|xact_abort)\s+([A-Za-z0-9_]+)/gi;
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
  // Literal-aware comment blanking (2026-09-12): see blankSqlCommentsKeepLiterals.
  const text = blankSqlCommentsKeepLiterals(rawText);
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
  // Error continuation is body-shape, not a single token, so it is appended
  // after the regex sweep. It is deliberately NOT a non-compensatable reason:
  // a routine that carries on after an error is still bracketable from its
  // static write set. See `hasErrorContinuation`.
  if (hasErrorContinuation(body)) constructs.push('error_continuation');
  const nonCompensatable = constructs.filter((c) =>
    ['system_proc', 'remote_call', 'cross_db_dml', 'dynamic_sql', 'waitfor'].includes(c),
  );
  const returnSites = findReturnSites(body);
  const resultSelects = findResultSelects(body);
  const miningBody = blankSqlLiteralsAndComments(body);
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
    // Mining runs over the body with comments AND string literals blanked:
    // message text is never a table or a call (2026-09-12).
    reads: parseReadTablesFromSql(miningBody).map((t) => t.toLowerCase()),
    writes: parseWriteTablesFromSql(miningBody).map((t) => t.toLowerCase()),
    proc_calls: parseProcCallsFromSql(miningBody)
      .map((p) => p.toLowerCase())
      .filter((p) => p !== selfName.toLowerCase()),
    signature_parsed: header.error === null,
    signature_error: header.error,
  };
}
