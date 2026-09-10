/**
 * Routine invocation envelope + descriptor (Stored Proc & Function Behaviour
 * Program, Spec 2, 2026-09-09) — ENGINE-NEUTRAL.
 *
 * The envelope is what BOTH engines return when the tool invokes a routine:
 * outcome, return status, OUTPUT parameters, an ordered list of result sets,
 * messages, a projected error and the session that ran it. Engine packs
 * (the Sybase sidecar `/call`, the Postgres invoker) PRODUCE it; the proc
 * behaviour capture stores it; the proc parity comparator DIFFS two of them.
 * Nothing in here names an engine (two kinds of code, one kind of data).
 *
 * The descriptor is the per-routine calling convention stamped by the pack
 * (pair rule SYBPG.PROC.ABI.001): it tells the Postgres invoker HOW to call
 * a translated routine and the comparator WHAT to expect back.
 */

export type RoutineShape = 'return_status' | 'single_result_set' | 'out_params' | 'rich';

export interface RoutineParamValue {
  name: string;
  /** 1-based source declaration order. */
  ordinal: number;
  /** Verbatim SOURCE type token (e.g. `int`, `varchar(40)`); packs map it. */
  source_type: string;
  direction: 'in' | 'output';
  /** Wire value (strings for numerics/datetimes/binary as the sidecar renders them); null = SQL NULL. */
  value: unknown;
}

export interface RoutineDescriptorArg {
  /** Target argument name (source name without sigil, lower case). */
  name: string;
  /** Target type token (e.g. `integer`, `numeric(10,2)`, `timestamp`). */
  pg_type: string;
  /** The source parameter this argument carries. */
  source_param: string;
  direction: 'in' | 'out' | 'inout';
}

export interface RoutineDescriptor {
  shape: RoutineShape;
  pg_schema: string;
  pg_function: string;
  args: RoutineDescriptorArg[];
  /** OUT argument names in declaration order (excludes refcursors + return_status). */
  out_params: string[];
  /** Refcursor OUT names in result-set order (`rich` only). */
  refcursors: string[];
  /** How the source return status travels: function return | OUT return_status | absent. */
  return_status_carriage: 'function_return' | 'out_param' | 'none';
  /** The pair rule the error carriage follows (SQLSTATE + DETAIL JSON). */
  error_carriage_rule: string;
  session_profile_rule: string;
  /** `static` = from the profile only; `capture_refined` = confirmed by a pinned baseline. */
  confidence: 'static' | 'capture_refined';
  /** Rule ids the derivation cited. */
  rules_cited: string[];
}

export interface RoutineInvocationRequest {
  schema_name: string;
  routine_name: string;
  routine_kind: 'procedure' | 'function';
  params: RoutineParamValue[];
  /** Functions: the verbatim source RETURNS type (binds the result slot's type). */
  returns_type?: string | null;
  /** Ask for the return status placeholder (procedures default true). */
  return_status: boolean;
  /** Session SET statements to apply before the call (pair rule SESSION.001). */
  session_set: string[];
  limits: {
    max_rows_per_result_set: number;
    max_result_sets: number;
    timeout_seconds: number;
  };
  /** Target-side only: how to call the translated routine. */
  descriptor?: RoutineDescriptor | null;
}

export interface RoutineResultSet {
  ordinal: number;
  columns: Array<{ name: string; type: string }>;
  rows: unknown[][];
  row_count: number;
  truncated: boolean;
}

export interface RoutineMessage {
  kind: 'print' | 'info' | 'raiserror' | 'notice';
  number: number | null;
  severity: number | null;
  state: number | null;
  text: string;
}

export interface RoutineErrorDetail {
  /** Engine error number (Sybase message number; Postgres: source_error from DETAIL when carried). */
  number: number | null;
  sqlstate: string | null;
  severity: number | null;
  state: number | null;
  message: string;
  /** Postgres DETAIL / HINT / constraint when present. */
  detail?: string | null;
  constraint?: string | null;
}

export interface RoutineInvocationEnvelope {
  outcome: 'success' | 'error';
  return_status: number | null;
  output_params: Record<string, unknown>;
  result_sets: RoutineResultSet[];
  update_counts: number[];
  messages: RoutineMessage[];
  error: RoutineErrorDetail | null;
  timing_ms: number;
  session: { login: string; set_options: string[] };
  /** Which engine pack produced the envelope (informational, never compared). */
  engine?: string;
}

/** Default invocation limits (env-tunable at the adapter level). */
export const DEFAULT_ROUTINE_LIMITS = {
  max_rows_per_result_set: 1000,
  max_result_sets: 10,
  timeout_seconds: 300,
} as const;

/** Per-result-set hard cap shared with the sidecar guard (rows per set). */
export const MAX_ROUTINE_RESULT_SET_ROWS = 10_000;

export function emptyEnvelope(login: string, setOptions: string[]): RoutineInvocationEnvelope {
  return {
    outcome: 'success',
    return_status: null,
    output_params: {},
    result_sets: [],
    update_counts: [],
    messages: [],
    error: null,
    timing_ms: 0,
    session: { login, set_options: [...setOptions] },
  };
}
