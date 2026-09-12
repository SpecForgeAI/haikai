/**
 * Deterministic scenario seeds for one routine (Spec 3, 2026-09-09).
 *
 * NO LLM here. Two deterministic sources:
 *   1. Parameter DOMAINS mined from the body: `<table>.<col> = @param` /
 *      `<col> = @param` comparisons bind a parameter to a column, so real
 *      values can be sampled from the database (the Pass A idea, one tier
 *      down). Unqualified columns are resolved against the routine's read /
 *      write tables at sampling time (try each candidate).
 *   2. The seeded scenario FAMILIES the pair ruleset names (zero-row
 *      rowcount path, RAISERROR paths, null / default parameters, boundary
 *      values) — present only when the body carries the construct.
 *
 * The LLM loop receives these as the scenario plan it must exercise; the
 * coverage floor (routineCoverageFloor.ts) is the deterministic denominator.
 */

import type { RoutineCatalogRow, RoutineParamDecl, ProcScenarioType } from './types';

export interface ParamDomain {
  param: string;
  /** Column candidates in body order: [{table|null, column}]. */
  candidates: Array<{ table: string | null; column: string }>;
}

export interface ScenarioPlan {
  name: string;
  type: ProcScenarioType;
  /** What the LLM must achieve; the source is the specification. */
  directive: string;
  /** Floor-bearing scenarios count towards the coverage denominator. */
  floor_bearing: boolean;
  /** The exit outcome key this scenario targets (`error:20012`, `return:-1`, `success`), when specific. */
  target_outcome: string | null;
  /** Deterministic seed inputs when the plan can propose them (values sampled later). */
  seed_inputs: Array<{ name: string; value: unknown; is_null: boolean }> | null;
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

/** Alias → table map from FROM / JOIN / UPDATE clauses (best effort). */
function aliasMap(body: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /\b(?:from|join|update|into)\s+([A-Za-z0-9_.#\[\]]+)(?:\s+(?:as\s+)?([A-Za-z][A-Za-z0-9_]*))?/gi;
  let m: RegExpExecArray | null;
  const reserved = new Set(['where', 'on', 'set', 'select', 'inner', 'left', 'right', 'outer', 'join', 'values', 'with', 'group', 'order']);
  while ((m = re.exec(body)) !== null) {
    const table = m[1].replace(/[[\]]/g, '').split('.').pop()?.toLowerCase() ?? '';
    if (!table) continue;
    const alias = m[2]?.toLowerCase();
    if (alias && !reserved.has(alias)) out.set(alias, table);
    out.set(table, table);
  }
  return out;
}

/** Mine parameter → column domains from comparisons in the body. */
export function mineParamDomains(routine: RoutineCatalogRow): ParamDomain[] {
  const body = stripComments(routine.full_body ?? '');
  const aliases = aliasMap(body);
  const params = (routine.params_json ?? []).filter((p) => p.direction === 'in');
  const domains: ParamDomain[] = [];
  for (const p of params) {
    const name = p.name.replace(/^@/, '');
    const candidates: ParamDomain['candidates'] = [];
    const push = (table: string | null, column: string): void => {
      const col = column.toLowerCase();
      if (!candidates.some((c) => c.table === table && c.column === col)) candidates.push({ table, column: col });
    };
    // qualified: alias.col = @p  |  @p = alias.col
    const q1 = new RegExp(`\\b([A-Za-z][A-Za-z0-9_]*)\\.([A-Za-z][A-Za-z0-9_]*)\\s*(?:=|<>|!=|<=|>=|<|>|\\bin\\s*\\()\\s*@${name}\\b`, 'gi');
    const q2 = new RegExp(`@${name}\\s*(?:=|<>|!=|<=|>=|<|>)\\s*([A-Za-z][A-Za-z0-9_]*)\\.([A-Za-z][A-Za-z0-9_]*)`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = q1.exec(body)) !== null) push(aliases.get(m[1].toLowerCase()) ?? m[1].toLowerCase(), m[2]);
    while ((m = q2.exec(body)) !== null) push(aliases.get(m[1].toLowerCase()) ?? m[1].toLowerCase(), m[2]);
    // unqualified: col = @p | @p = col  (col must not be another @var or a
    // keyword). The column's table is the statement's nearest preceding
    // UPDATE / FROM / DELETE / INTO table (null when none precedes it).
    const u1 = new RegExp(`(?<![.@A-Za-z0-9_])([A-Za-z][A-Za-z0-9_]*)\\s*(?:=|<>|!=|<=|>=|<|>)\\s*@${name}\\b`, 'gi');
    const u2 = new RegExp(`@${name}\\s*(?:=|<>|!=|<=|>=|<|>)\\s*(?![@0-9'])([A-Za-z][A-Za-z0-9_]*)\\b(?!\\s*\\()`, 'gi');
    const keywords = new Set(['and', 'or', 'not', 'null', 'is', 'set', 'select', 'where', 'if', 'else', 'then', 'case', 'when', 'end']);
    const statementTable = (at: number): string | null => {
      const before = body.slice(0, at);
      const re = /\b(?:update|from|delete(?:\s+from)?|into)\s+([A-Za-z0-9_.#\[\]]+)(?:\s+(?:as\s+)?([A-Za-z][A-Za-z0-9_]*))?/gi;
      let last: string | null = null;
      let mm: RegExpExecArray | null;
      while ((mm = re.exec(before)) !== null) {
        const table = mm[1].replace(/[[\]]/g, '').split('.').pop()?.toLowerCase() ?? '';
        if (table && !/^(where|set|select|values)$/i.test(table)) last = aliases.get(table) ?? table;
      }
      return last;
    };
    while ((m = u1.exec(body)) !== null) if (!keywords.has(m[1].toLowerCase())) push(statementTable(m.index), m[1]);
    while ((m = u2.exec(body)) !== null) if (!keywords.has(m[1].toLowerCase())) push(statementTable(m.index), m[1]);
    domains.push({ param: name, candidates });
  }
  return domains;
}

/** A type-appropriate placeholder value when no domain sample exists. */
export function defaultValueForType(sourceType: string): unknown {
  const base = sourceType.trim().toLowerCase().replace(/\(.*$/, '');
  switch (base) {
    case 'int':
    case 'integer':
    case 'smallint':
    case 'tinyint':
    case 'bigint':
      return 1;
    case 'bit':
      return 1;
    case 'numeric':
    case 'decimal':
    case 'money':
    case 'smallmoney':
    case 'float':
    case 'real':
    case 'double':
      return '1.00';
    case 'datetime':
    case 'smalldatetime':
    case 'bigdatetime':
      return '2026-01-15 09:30:00.000';
    case 'datetime2':
      return '2026-01-15 09:30:00.0000000';
    case 'datetimeoffset':
      return '2026-01-15 09:30:00.0000000 +00:00';
    case 'date':
      return '2026-01-15';
    case 'time':
    case 'bigtime':
      return '09:30:00.000';
    case 'binary':
    case 'varbinary':
    case 'image':
      return '\\x00';
    case 'rowversion':
    case 'timestamp':
      return '\\x0000000000000001';
    case 'uniqueidentifier':
      return '00000000-0000-0000-0000-000000000001';
    case 'xml':
      return '<r/>';
    default:
      return 'x';
  }
}

function bodyHas(routine: RoutineCatalogRow, re: RegExp): boolean {
  return re.test(stripComments(routine.full_body ?? ''));
}

/** Exit-outcome keys enumerated STATICALLY from the profile (the floor denominator). */
export function enumerateExitOutcomes(routine: RoutineCatalogRow): string[] {
  const profile = routine.profile_json ?? {};
  // RETURN as a data channel (2026-09-12): a routine whose every RETURN site
  // is an expression (RETURN @next) never returns 0, so `success` was an
  // unreachable requirement and `return:4600` could never be in it. Such a
  // routine requires `return:?` (any non-error return, 0 included) instead;
  // a mixed routine requires both.
  const sites = profile.return_sites ?? [];
  const allExpressions = sites.length > 0 && sites.every((r) => r.expr !== null);
  const out = new Set<string>(allExpressions ? ['return:?'] : ['success']);
  for (const r of sites) {
    if (r.expr !== null) out.add('return:?');
    else if (r.value !== null && r.value !== 0) out.add(`return:${r.value}`);
  }
  for (const r of profile.raiserror_sites ?? []) {
    out.add(r.number !== null ? `error:${r.number}` : 'error:?');
  }
  // THROW sites (SQL Server): a numbered THROW is its own exit outcome; a
  // bare re-THROW inside CATCH carries the caught error and is not counted.
  for (const t of (profile as { throw_sites?: Array<{ number: number | null }> }).throw_sites ?? []) {
    if (t.number !== null) out.add(`error:${t.number}`);
  }
  return [...out];
}

/** Seeded families present in the body (floor-bearing when the construct exists). */
export function seededFamilies(routine: RoutineCatalogRow): Array<{ type: ProcScenarioType; reason: string }> {
  const families: Array<{ type: ProcScenarioType; reason: string }> = [];
  if (bodyHas(routine, /@@rowcount/i)) families.push({ type: 'zero_rows', reason: 'branches on @@rowcount' });
  const constructs = routine.profile_json?.constructs ?? [];
  if (bodyHas(routine, /@@error/i) || constructs.includes('transaction_control')) {
    families.push({ type: 'error_path', reason: 'branches on @@error / transaction control' });
  }
  // Error-mid-routine family (second-pair programme, item 3): TRY/CATCH,
  // THROW, XACT_ABORT and statement-level continuation each make the
  // behaviour AFTER an error part of the observed contract.
  const errorConstructs = ['try_catch', 'throw', 'xact_abort', 'error_continuation'].filter((c) => constructs.includes(c));
  if (errorConstructs.length > 0 && !families.some((f) => f.type === 'error_path')) {
    families.push({ type: 'error_path', reason: `error handling constructs: ${errorConstructs.join(', ')}` });
  }
  return families;
}

/** The deterministic scenario plan for one routine. */
export function defaultRoutineScenarioPlan(routine: RoutineCatalogRow): ScenarioPlan[] {
  const params = (routine.params_json ?? []).filter((p) => p.direction === 'in');
  const seedInputs = (overrides: Record<string, unknown> = {}, omit: Set<string> = new Set()) =>
    params
      .filter((p) => !omit.has(p.name))
      .map((p) => ({
        name: p.name,
        value: p.name in overrides ? overrides[p.name] : defaultValueForType(p.source_type),
        is_null: p.name in overrides && overrides[p.name] === null,
      }));
  const plans: ScenarioPlan[] = [];
  plans.push({
    name: 'happy_path',
    type: 'happy_path',
    directive:
      'Exercise the main success path with REAL values resolved from the database (sample the columns the parameters compare against). Expect the success exit.',
    floor_bearing: true,
    target_outcome: 'success',
    seed_inputs: seedInputs(),
  });
  const profile = routine.profile_json ?? {};
  const seenErrors = new Set<string>();
  for (const site of profile.raiserror_sites ?? []) {
    const key = site.number !== null ? `error:${site.number}` : 'error:?';
    if (seenErrors.has(key)) continue;
    seenErrors.add(key);
    plans.push({
      name: site.number !== null ? `raiserror_${site.number}` : `raiserror_${seenErrors.size}`,
      type: 'error_path',
      directive:
        `Drive the RAISERROR path${site.number !== null ? ` ${site.number}` : ''}` +
        `${site.text_preview ? ` ("${site.text_preview}")` : ''}: choose inputs that make the source raise it. Expect the error exit.`,
      floor_bearing: true,
      target_outcome: key,
      seed_inputs: null,
    });
  }
  for (const site of profile.return_sites ?? []) {
    if (site.value === null || site.value === 0) continue;
    const key = `return:${site.value}`;
    if (plans.some((p) => p.target_outcome === key)) continue;
    plans.push({
      name: `return_${site.value < 0 ? `neg${Math.abs(site.value)}` : site.value}`,
      type: 'error_path',
      directive: `Drive the path that ends with RETURN ${site.value}. Expect return status ${site.value}.`,
      floor_bearing: true,
      target_outcome: key,
      seed_inputs: null,
    });
  }
  for (const fam of seededFamilies(routine)) {
    if (fam.type === 'zero_rows') {
      plans.push({
        name: 'zero_rows',
        type: 'zero_rows',
        directive: `The body ${fam.reason}: drive the update/select-zero-rows path (inputs matching no row) and capture the behaviour.`,
        floor_bearing: true,
        target_outcome: null,
        seed_inputs: null,
      });
    }
  }
  const nullable = params.filter((p) => p.default_literal !== null && /^null$/i.test(p.default_literal));
  if (nullable.length > 0) {
    plans.push({
      name: 'null_params',
      type: 'null_param',
      directive: `Pass NULL for ${nullable.map((p) => '@' + p.name).join(', ')} (their declared default) and capture the behaviour.`,
      floor_bearing: false,
      target_outcome: null,
      seed_inputs: seedInputs(Object.fromEntries(nullable.map((p) => [p.name, null]))),
    });
  }
  const defaulted = params.filter((p) => p.default_literal !== null && !/^null$/i.test(p.default_literal));
  if (defaulted.length > 0) {
    plans.push({
      name: 'default_params',
      type: 'default_param',
      directive: `Omit ${defaulted.map((p) => '@' + p.name).join(', ')} so their declared defaults apply, and capture the behaviour.`,
      floor_bearing: false,
      target_outcome: null,
      seed_inputs: seedInputs({}, new Set(defaulted.map((p) => p.name))),
    });
  }
  const numeric = params.filter((p) => /^(int|integer|smallint|tinyint|bigint|numeric|decimal|money|smallmoney|float|real)/i.test(p.source_type));
  if (numeric.length > 0) {
    plans.push({
      name: 'boundary_values',
      type: 'boundary',
      directive: `Probe boundary values for ${numeric.map((p) => '@' + p.name).join(', ')} (0, negative, max plausible) and capture the behaviour.`,
      floor_bearing: false,
      target_outcome: null,
      seed_inputs: null,
    });
  }
  return plans;
}

/** Bind values into the declared parameter order, validating names. */
export function bindInputs(
  params: RoutineParamDecl[],
  inputs: Array<{ name: string; value: unknown; is_null?: boolean }>,
): { ok: true; bound: Array<{ name: string; ordinal: number; source_type: string; direction: 'in' | 'output'; value: unknown }> } | { ok: false; error: string } {
  const declared = new Map(params.map((p) => [p.name.replace(/^@/, '').toLowerCase(), p]));
  const supplied = new Map<string, { value: unknown; is_null?: boolean }>();
  for (const i of inputs) {
    const key = i.name.replace(/^@/, '').toLowerCase();
    if (!declared.has(key)) return { ok: false, error: `unknown parameter @${i.name}` };
    supplied.set(key, i);
  }
  const bound = [...declared.values()]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((p) => {
      const key = p.name.replace(/^@/, '').toLowerCase();
      const s = supplied.get(key);
      const value = s === undefined ? (p.default_literal !== null ? parseDefault(p.default_literal) : null) : s.is_null ? null : s.value;
      return { name: p.name, ordinal: p.ordinal, source_type: p.source_type, direction: p.direction, value };
    });
  return { ok: true, bound };
}

function parseDefault(literal: string): unknown {
  const t = literal.trim();
  if (/^null$/i.test(t)) return null;
  if (/^'(.*)'$/.test(t)) return t.slice(1, -1).replace(/''/g, "'");
  if (/^-?\d+$/.test(t)) return Number(t);
  return t;
}
