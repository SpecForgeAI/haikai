/**
 * Routine catalog types (Stored Proc & Function Behaviour Program, Spec 1,
 * 2026-09-09).
 *
 * A ROUTINE is a stored procedure, a function or a trigger harvested from
 * the LIVE catalog by an engine pack. Until this spec, routines existed only
 * as findings (size-capped bodies) and translation-queue rows; nothing knew
 * their parameters, exit outcomes or result-set shape. The record below is
 * engine-neutral and snake_case (it is persisted verbatim by AMS as a
 * `db_routines` row — the wire default is snake_case, see CLAUDE.md), and
 * the static PROFILE is produced by a dialect-specific profiler that lives
 * in the engine pack (two kinds of code, one kind of data).
 */

export type RoutineKind = 'procedure' | 'function' | 'trigger';

export interface RoutineParam {
  /** Parameter name WITHOUT the dialect sigil (`@id` -> `id`). */
  name: string;
  /** 1-based declaration order. */
  ordinal: number;
  /** Verbatim source type token (e.g. `int`, `varchar(40)`, `numeric(10,2)`). */
  source_type: string;
  direction: 'in' | 'output';
  /** Verbatim default literal when declared (`= 0`, `= NULL`), else null. */
  default_literal: string | null;
  /**
   * TRUE for a READONLY parameter -- SQL Server's table-valued parameters are
   * always READONLY, and the modifier is the only way to tell a TVP from an
   * ordinary one in the signature. Optional and only ever set to `true`, so a
   * routine from an engine without the concept (Sybase ASE) round-trips with
   * exactly the fields it had before this was added. A READONLY parameter
   * cannot be bound as a scalar at call time, so the capture layer must pass
   * it a table.
   */
  is_readonly?: boolean;
}

export interface RoutineReturnSite {
  /** Literal integer return value when statically known, else null. */
  value: number | null;
  /** Verbatim expression when the RETURN carries a non-literal, else null. */
  expr: string | null;
}

export interface RoutineRaiserrorSite {
  number: number | null;
  severity: number | null;
  /** First 120 chars of the message text when it is a literal, else null. */
  text_preview: string | null;
}

export interface RoutineResultSelect {
  /** 1-based order of appearance among result-producing SELECTs. */
  ordinal: number;
  has_order_by: boolean;
  has_top: boolean;
  /** The SELECT list text (capped) when it could be isolated, else null. */
  select_list_static: string | null;
}

/**
 * Deterministic static profile of one routine body. Tokenizer-level (no full
 * T-SQL parse — the Spec F ruling stands); every field is either exact or
 * an honest upper bound (`max_result_sets` counts result-producing SELECT
 * sites regardless of branch).
 */
export interface RoutineProfile {
  return_sites: RoutineReturnSite[];
  /** TRUE when every RETURN is bare or literal 0 (status carries no information). */
  return_status_trivial: boolean;
  raiserror_sites: RoutineRaiserrorSite[];
  result_selects: RoutineResultSelect[];
  max_result_sets: number;
  /**
   * Construct tags present in the body: temp_table | cursor |
   * transaction_control | dynamic_sql | system_proc | remote_call |
   * cross_db_dml | waitfor | set_rowcount | set_nocount | print.
   */
  constructs: string[];
  /** getdate | newid | rand | @@identity | @@spid ... (lower-case tokens). */
  volatile_functions: string[];
  /** suser_name | user_name | host_name ... (lower-case tokens). */
  session_user_functions: string[];
  /**
   * Reasons the routine cannot be bracketed by the compensation engine
   * (fail-closed BEFORE firing): system_proc | remote_call | cross_db_dml |
   * dynamic_sql | waitfor. Empty = compensatable from its static write set.
   */
  non_compensatable_reasons: string[];
  /** SET options the body toggles (lower-case, e.g. `nocount on`). */
  set_options: string[];
}

export interface RoutineRecord {
  schema_name: string;
  routine_name: string;
  routine_kind: RoutineKind;
  language: string;
  /** The FULL harvested body, unbounded (never truncated, never redacted here). */
  full_body: string;
  /** SHA-256 over the whitespace-normalised, lower-cased body. */
  body_hash: string;
  /** MD5 over the same normalisation — keeps parity with the SCL proc merge. */
  body_md5: string;
  params: RoutineParam[];
  /** Functions: verbatim RETURNS type; procedures/triggers: null. */
  returns_type: string | null;
  /** Triggers: the table the trigger is defined ON (bare, lower-case). */
  trigger_on_table: string | null;
  trigger_events: string[];
  profile: RoutineProfile;
  /** Bare lower-case table names read / written by the body itself. */
  reads: string[];
  writes: string[];
  /** Bare lower-case routine names this body calls (`exec` / `{call}`). */
  proc_calls: string[];
  /** Transitive (uncapped, cycle-safe) closures — filled by the catalog builder. */
  reads_closure: string[];
  writes_closure: string[];
  /** Writes contributed by triggers ON any table in `writes_closure`. */
  trigger_expanded_writes: string[];
  source: 'live' | 'repo';
  /** FALSE when the header could not be parsed — a loud finding is emitted. */
  signature_parsed: boolean;
  signature_error: string | null;
}

/** One raw source as harvested from a live catalog (engine-pack output). */
export interface RoutineSource {
  name: string;
  /** Engine object type token (`P` | `F` | `TR` on Sybase). */
  objType?: string;
  text: string;
}

/** An engine pack's routine profiler: source -> record (closures left empty). */
export type RoutineProfiler = (source: RoutineSource) => RoutineRecord;
