/**
 * Routine calling-convention descriptor (Stored Proc & Function Behaviour
 * Program, Spec 2, 2026-09-09) — PACK CODE.
 *
 * Derives, from a routine-catalog row (Spec 1) and the pair ruleset's
 * SYBPG.PROC.ABI.001 convention, the exact PostgreSQL header a translated
 * routine must expose and how the tool (and the application) call it:
 *
 *   return_status      no result set, no OUTPUT        -> RETURNS integer
 *   single_result_set  one result-producing SELECT,     -> RETURNS TABLE / SETOF
 *                      trivial return status
 *   out_params         OUTPUT params, no result set     -> OUT arguments
 *   rich               anything richer                  -> OUT refcursors rs1..rsN
 *                                                          + OUT return_status + OUT params
 *
 * The first three keep the application's existing pgjdbc call patterns
 * working (DB-only migrations); `rich` is the honest residual class.
 * Deterministic: same routine + same ruleset -> same descriptor. The
 * descriptor is also what Spec 4's replayer follows and what the call-site
 * compatibility count is computed against.
 */

import { procRulePrefix, type MigrationPairRuleset } from '../../migrationPairRules';
import { mapSourceType } from './typeMapping';

export type RoutineShape = 'return_status' | 'single_result_set' | 'out_params' | 'rich';

/** A `db_routines` row as AMS serves it (snake_case, Spec 1). */
export interface RoutineCatalogRow {
  id: string;
  schema_name: string;
  routine_name: string;
  routine_kind: 'procedure' | 'function' | 'trigger';
  params_json?: Array<{
    name: string;
    ordinal: number;
    source_type: string;
    direction: 'in' | 'output';
    default_literal: string | null;
  }> | null;
  returns_type?: string | null;
  profile_json?: {
    return_sites?: Array<{ value: number | null; expr: string | null }>;
    return_status_trivial?: boolean;
    raiserror_sites?: Array<{ number: number | null; severity: number | null; text_preview: string | null }>;
    /** THROW sites (SQL Server): user error numbers >= 50000 carried per the pair's ERR rule. */
    throw_sites?: Array<{ number: number | null; state: number | null; text_preview: string | null }>;
    result_selects?: Array<{ ordinal: number; has_order_by: boolean; has_top: boolean; select_list_static: string | null }>;
    max_result_sets?: number;
    constructs?: string[];
    volatile_functions?: string[];
    session_user_functions?: string[];
    non_compensatable_reasons?: string[];
    set_options?: string[];
  } | null;
  writes_closure_json?: string[] | null;
  reads_closure_json?: string[] | null;
  trigger_expanded_writes_json?: string[] | null;
  reads_json?: string[] | null;
  writes_json?: string[] | null;
  /** Bare lower-case routine names this body calls (callee-first ordering). */
  proc_calls_json?: string[] | null;
  body_hash?: string | null;
  signature_parsed?: boolean;
  full_body?: string;
}

export interface RoutineDescriptorArg {
  name: string;
  pg_type: string;
  source_param: string;
  direction: 'in' | 'out';
}

export interface RoutineDescriptor {
  shape: RoutineShape;
  pg_schema: string;
  pg_function: string;
  args: RoutineDescriptorArg[];
  out_params: string[];
  refcursors: string[];
  return_status_carriage: 'function_return' | 'out_param' | 'none';
  error_carriage_rule: string;
  session_profile_rule: string;
  confidence: 'static' | 'capture_refined';
  rules_cited: string[];
  /** Static facts the shape selection used (for the manifest + reviewer). */
  basis: {
    max_result_sets: number;
    has_output_params: boolean;
    return_status_trivial: boolean;
    signature_parsed: boolean;
  };
}

/** Rule ids are `<pair prefix>PROC.<family>` — the prefix comes from the ruleset, never a literal. */
const ABI_SUFFIX = 'PROC.ABI.001';
const ERR_SUFFIX = 'PROC.ERR.001';
const SESSION_SUFFIX = 'PROC.SESSION.001';
function procRuleIds(ruleset: MigrationPairRuleset | null): { abi: string; err: string; session: string } {
  const prefix = ruleset ? procRulePrefix(ruleset) : '';
  return { abi: `${prefix}${ABI_SUFFIX}`, err: `${prefix}${ERR_SUFFIX}`, session: `${prefix}${SESSION_SUFFIX}` };
}

/**
 * Source parameter type -> PostgreSQL argument type.
 *
 * UNIFIED onto the pack's column type table (Spec 5.2, 2026-09-11): this
 * used to be a SECOND, hand-maintained copy of the same mapping, and the two
 * had already drifted — the duplicate guessed `char(1)` for a bare `char`,
 * the exact silently-truncating guess the column mapper refuses to make
 * (2026-08-12). There is now one table; a routine argument whose type the
 * table cannot answer keeps the old pass-through behaviour (the apply step
 * reports it) rather than raising a decision, because a routine SIGNATURE is
 * reviewed in the translation workbench, not gated by the pack decision queue.
 *
 * The `char` refusal is preserved by NOT inventing a width: a bare `char`
 * renders as `char` and reads as PostgreSQL's own char(1) — but it reaches a
 * human in the calling-convention contract instead of silently defining a
 * column. A `double` alias (not a column type, but a legal parameter
 * spelling) maps before the table is consulted.
 */
export function mapRoutineArgType(sourceType: string, engine?: string): string {
  const raw = String(sourceType ?? '').trim().toLowerCase();
  if (raw === '') return raw;
  if (/^double(\s+precision)?$/.test(raw)) return 'double precision';
  const mapped = mapSourceType(engine ?? 'sybase', {
    dataType: raw,
    maxLength: null,
    precision: null,
    scale: null,
  });
  if (mapped.kind === 'mapped') return mapped.postgresType;
  // A type the deterministic table refuses (a bare `char` with no recorded
  // width, `rowversion`, an unlisted type): pass the SOURCE spelling through
  // verbatim so the contract shows exactly what the catalog reported.
  return raw;
}

function argName(sourceParam: string): string {
  return sourceParam.replace(/^@/, '').toLowerCase();
}

/** Shape selection per SYBPG.PROC.ABI.001 (exported for tests). */
export function selectRoutineShape(basis: {
  max_result_sets: number;
  has_output_params: boolean;
  return_status_trivial: boolean;
}): RoutineShape {
  if (basis.max_result_sets > 1) return 'rich';
  if (basis.max_result_sets === 1) {
    return basis.has_output_params || !basis.return_status_trivial ? 'rich' : 'single_result_set';
  }
  if (basis.has_output_params) return 'out_params';
  return 'return_status';
}

/**
 * Derive the descriptor. `targetSchema` defaults to the routine's schema
 * (the pack's schema-mapping decision may override it at emission).
 */
export function deriveRoutineDescriptor(
  routine: RoutineCatalogRow,
  ruleset: MigrationPairRuleset | null,
  opts: { targetSchema?: string | null; captureRefined?: boolean } = {}
): RoutineDescriptor {
  const params = routine.params_json ?? [];
  const profile = routine.profile_json ?? {};
  const isFunction = routine.routine_kind === 'function';
  const outputs = params.filter((p) => p.direction === 'output');
  const basis = {
    max_result_sets: typeof profile.max_result_sets === 'number' ? profile.max_result_sets : 0,
    has_output_params: outputs.length > 0,
    return_status_trivial: isFunction ? true : profile.return_status_trivial !== false,
    signature_parsed: routine.signature_parsed !== false,
  };
  const shape = isFunction && basis.max_result_sets === 0 && !basis.has_output_params
    ? 'return_status'
    : selectRoutineShape(basis);
  const args: RoutineDescriptorArg[] = params
    .slice()
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((p) => ({
      name: argName(p.name),
      pg_type: mapRoutineArgType(p.source_type, ruleset?.source?.engine),
      source_param: p.name,
      direction: p.direction === 'output' ? 'out' : 'in',
    }));
  const outParams = args.filter((a) => a.direction === 'out').map((a) => a.name);
  const refcursors =
    shape === 'rich'
      ? Array.from({ length: Math.max(1, basis.max_result_sets) }, (_, i) => `rs${i + 1}`)
      : [];
  let carriage: RoutineDescriptor['return_status_carriage'];
  if (shape === 'return_status') carriage = 'function_return';
  else if (shape === 'single_result_set') carriage = 'none';
  else if (shape === 'out_params') carriage = basis.return_status_trivial ? 'none' : 'out_param';
  else carriage = 'out_param';
  const ids = procRuleIds(ruleset);
  const rulesCited = [ids.abi, ids.err, ids.session].filter((id) => !ruleset || ruleset.rules.some((r) => r.id === id));
  return {
    shape,
    pg_schema: (opts.targetSchema ?? routine.schema_name ?? 'dbo').toLowerCase(),
    pg_function: routine.routine_name.toLowerCase(),
    args,
    out_params: outParams,
    refcursors,
    return_status_carriage: carriage,
    error_carriage_rule: ids.err,
    session_profile_rule: ids.session,
    confidence: opts.captureRefined ? 'capture_refined' : 'static',
    rules_cited: rulesCited,
    basis,
  };
}

/** The exact PostgreSQL header the descriptor prescribes (exported for tests + prompts). */
export function renderRequiredHeader(d: RoutineDescriptor): string {
  const parts: string[] = [];
  for (const a of d.args) {
    if (a.direction === 'in') parts.push(`${a.name} ${a.pg_type}`);
  }
  for (const a of d.args) {
    if (a.direction === 'out') parts.push(`OUT ${a.name} ${a.pg_type}`);
  }
  if (d.return_status_carriage === 'out_param') parts.push('OUT return_status integer');
  for (const cur of d.refcursors) parts.push(`OUT ${cur} refcursor`);
  const name = `${d.pg_schema}.${d.pg_function}`;
  switch (d.shape) {
    case 'return_status':
      return `CREATE OR REPLACE FUNCTION ${name}(${parts.join(', ')}) RETURNS integer LANGUAGE plpgsql AS $$ ... $$;`;
    case 'single_result_set':
      return `CREATE OR REPLACE FUNCTION ${name}(${parts.join(', ')}) RETURNS TABLE(<the columns of the result-producing SELECT, lower-case>) LANGUAGE plpgsql AS $$ ... $$;`;
    case 'out_params':
    case 'rich':
      return `CREATE OR REPLACE FUNCTION ${name}(${parts.join(', ')}) LANGUAGE plpgsql AS $$ ... $$;  -- OUT arguments carry the results; no RETURNS clause`;
    default:
      return '';
  }
}

/** Prompt-ready contract: header + signature + static profile summary (STATIC facts only). */
export function renderRoutineContract(routine: RoutineCatalogRow, d: RoutineDescriptor): string {
  const profile = routine.profile_json ?? {};
  const lines: string[] = [];
  lines.push(`Shape: ${d.shape} (${d.rules_cited.join(', ')}; confidence ${d.confidence})`);
  lines.push(`Required header: ${renderRequiredHeader(d)}`);
  if (d.shape === 'rich') {
    lines.push(
      `Result sets: open ONE refcursor per result-producing SELECT in source order (${d.refcursors.join(', ')}); ` +
        'assign each cursor a stable name via OPEN <cursor> FOR <select>; a branch that produces no rows still opens its cursor.'
    );
  }
  if (d.return_status_carriage === 'function_return') {
    lines.push('Return status: RETURN the source RETURN value (0 when the source falls off the end).');
  } else if (d.return_status_carriage === 'out_param') {
    lines.push('Return status: set OUT return_status to the source RETURN value (0 on the success path).');
  }
  // Rule ids are the pair's own (the ERR rule id is on the descriptor; the
  // TXN id shares its prefix) — the full conventions ride the prompt's
  // "Pair conventions" section from the ruleset data.
  const errRule = d.error_carriage_rule;
  const txnRule = errRule.replace(/PROC\.ERR\.001$/, 'PROC.TXN.001');
  lines.push(
    'Errors: every RAISERROR/THROW becomes RAISE EXCEPTION USING ERRCODE = \'P0001\', MESSAGE = <text>, ' +
      `DETAIL = '{"source_error": <n>, "severity": <s>, "state": <st>}' (${errRule}). PRINT becomes RAISE NOTICE.`
  );
  lines.push(
    'Transactions: no COMMIT/ROLLBACK inside a function — BEGIN TRAN/COMMIT become sub-blocks (savepoints), an inner ROLLBACK becomes ' +
      `RAISE EXCEPTION USING ERRCODE = 'P0002' (${txnRule}); follow the pair conventions for TRY/CATCH, XACT_ABORT and continue-after-error.`
  );
  lines.push('Identifiers: lower-case, unquoted; keep every ORDER BY exactly; never add one the source lacks.');
  const params = routine.params_json ?? [];
  if (params.length > 0) {
    lines.push(
      'Source signature: ' +
        params
          .map((p) => `${p.name} ${p.source_type}${p.default_literal !== null ? ` = ${p.default_literal}` : ''}${p.direction === 'output' ? ' OUTPUT' : ''}`)
          .join(', ')
    );
  }
  if (routine.returns_type) lines.push(`Source RETURNS: ${routine.returns_type}`);
  const exits: string[] = [];
  for (const r of profile.return_sites ?? []) exits.push(r.value !== null ? `RETURN ${r.value}` : r.expr ? `RETURN ${r.expr}` : 'RETURN');
  for (const r of profile.raiserror_sites ?? []) exits.push(`RAISERROR ${r.number ?? '?'}${r.severity !== null ? ` sev ${r.severity}` : ''}`);
  for (const t of profile.throw_sites ?? []) exits.push(`THROW ${t.number ?? '(re-throw)'}${t.state !== null ? ` state ${t.state}` : ''}`);
  if (exits.length > 0) lines.push(`Exit sites (static): ${[...new Set(exits)].join('; ')}`);
  const selects = profile.result_selects ?? [];
  if (selects.length > 0) {
    lines.push(
      `Result-producing SELECTs (static): ${selects
        .map((s) => `#${s.ordinal}${s.has_order_by ? ' ORDER BY' : ''}${s.has_top ? ' TOP' : ''}`)
        .join(', ')}`
    );
  }
  const constructs = profile.constructs ?? [];
  if (constructs.length > 0) lines.push(`Constructs present: ${constructs.join(', ')}`);
  const volatile = profile.volatile_functions ?? [];
  if (volatile.length > 0) {
    // The VOL family lives under the pair's own prefix (never a literal here).
    const prefix = d.error_carriage_rule.includes('PROC.') ? d.error_carriage_rule.slice(0, d.error_carriage_rule.indexOf('PROC.')) : '';
    lines.push(`Volatile functions present: ${volatile.join(', ')} (map per ${prefix}PROC.VOL.*)`);
  }
  return lines.join('\n');
}

/** Descriptors keyed by bare lower-case routine name (procedures + functions only). */
export function deriveDescriptorsByRoutine(
  routines: RoutineCatalogRow[],
  ruleset: MigrationPairRuleset | null,
  opts: { targetSchema?: string | null } = {}
): Map<string, RoutineDescriptor> {
  const out = new Map<string, RoutineDescriptor>();
  for (const r of routines) {
    if (r.routine_kind !== 'procedure' && r.routine_kind !== 'function') continue;
    const key = r.routine_name.toLowerCase();
    if (!out.has(key)) out.set(key, deriveRoutineDescriptor(r, ruleset, opts));
  }
  return out;
}
