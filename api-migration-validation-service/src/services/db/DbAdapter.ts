import {
  DbAllowlist,
  DbColumnMetadata,
  DbConnectionConfig,
  DbQueryLimits,
  DbReadResult,
  DbTableMetadata,
} from '../../types/db';

/**
 * `DbAdapter` -- abstraction over per-engine read-only DB access for the
 * api-migration-validation service's DB sampling tools (`run_readonly_sql`,
 * `sample_db_values`, `list_db_metadata`) and the `/test-db-connection`
 * action endpoint.
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 4.
 *
 * Implementation contract:
 *   - SELECT-only enforcement is the adapter's responsibility -- no caller
 *     is trusted to pre-validate SQL. Implementations MUST reject any
 *     statement matching the SELECT-only parser (see `PostgresAdapter`).
 *   - Per-call statement timeout MUST be enforced via the engine's native
 *     mechanism (`SET statement_timeout` for Postgres) so a runaway query
 *     can't tie up the loop's per-tool 30s cap.
 *   - Row caps are injected as explicit `LIMIT` (or engine-equivalent) when
 *     the SQL doesn't already carry one.
 *   - All identifiers used in `sampleValues` / `listMetadata` MUST be quoted
 *     by the adapter, never interpolated as raw SQL.
 *   - `dispose()` MUST release any pooled connection slot the adapter holds.
 */
export interface DbAdapter {
  /**
   * Smoke-test the connection -- returns success on a single round-trip,
   * throws on auth / network failure. Caller (`/test-db-connection`)
   * surfaces the error message verbatim.
   */
  testConnection(): Promise<{ success: true; serverVersion?: string }>;

  /**
   * Read `information_schema` (or engine-equivalent) and return the table
   * + column metadata for everything the allowlist permits. An empty
   * allowlist returns an empty array (fail-closed).
   */
  listMetadata(allowlist: DbAllowlist): Promise<DbTableMetadata[]>;

  /**
   * Run a single SELECT statement under the configured limits. Throws if
   * the SQL fails the SELECT-only parser, fails the engine, or hits the
   * statement timeout.
   */
  runReadonlySelect(
    sql: string,
    params: unknown[],
    limits: DbQueryLimits,
  ): Promise<DbReadResult>;

  /**
   * Sample distinct values from a single column. Wraps a parameterised
   * `SELECT DISTINCT col FROM tbl LIMIT n` -- the adapter is responsible
   * for quoting the schema / table / column identifiers.
   */
  sampleValues(args: {
    schema?: string | null;
    table: string;
    column: string;
    limits: DbQueryLimits;
    where?: { sql: string; params: unknown[] } | null;
  }): Promise<DbReadResult>;

  /**
   * Count the rows in ONE table (data-parity Spec P). Adapter-owned SQL
   * construction + identifier quoting — the engine-equivalent of
   * `SELECT COUNT(*) FROM schema.table`.
   */
  countRows(args: {
    schema?: string | null;
    table: string;
    limits: DbQueryLimits;
  }): Promise<number>;

  /**
   * Fetch up to `limits.maxRows` whole rows in a DETERMINISTIC total order
   * over the supplied columns, ascending (data-parity Spec P). Cross-engine
   * ordering contract: NULLS-LOW — implementations must place NULLs first in
   * ascending order so both sides of a parity comparison enumerate rows
   * identically. Adapter-owned SQL construction + quoting; throws when
   * `orderBy` is empty (a total order is the whole point).
   *
   * KEYSET PAGINATION (2026-08-07, the full-table bulk load): when `after`
   * is supplied it is the ORDER-KEY VALUE TUPLE of the last row of the
   * previous page — the fetch returns rows strictly AFTER that tuple under
   * the same NULLS-LOW ascending order. Implementations expand the tuple
   * predicate NULL-aware ((a > x) OR (a = x AND b > y) ..., with `col IS
   * NOT NULL` standing in for `col > NULL` and `col IS NULL` for
   * `col = NULL`), because neither engine's row-value comparison covers the
   * NULLS-LOW contract. `after.length` must equal `orderBy.length`.
   *
   * `orderByTypes` (2026-08-12, optional; positionally aligned with
   * `orderBy`) carries the SOURCE column types so literal-SQL adapters can
   * render cursor values type-correctly. The sidecar wire deliberately
   * carries bigint/numeric values as STRINGS (JSON.parse precision), so a
   * string-shaped cursor value is NOT evidence of a string column — quoting
   * one against a numeric column is an engine type error (the live
   * `Implicit conversion from 'VARCHAR' to 'BIGINT'` read failure).
   * Parameterised adapters may ignore it (the engine infers from context).
   */
  fetchOrderedRows(args: {
    schema?: string | null;
    table: string;
    orderBy: string[];
    limits: DbQueryLimits;
    after?: unknown[] | null;
    orderByTypes?: Array<string | null> | null;
  }): Promise<DbReadResult>;

  /**
   * OPTIONAL capability (2026-08-12): probe the INTEGRITY of a declared key
   * against the LIVE data — (a) do any key columns hold NULLs, (b) do any
   * key tuples repeat? A pack-declared primary key the data does not satisfy
   * makes the load un-runnable (the target PK rejects it) and silently
   * poisons keyset pagination + keyed parity; the bulk runner probes BEFORE
   * writing anything and reports the surrogate-PK remedy instead of a
   * cryptic constraint violation. Adapter-owned SQL + quoting.
   */
  probeKeyIntegrity?(args: {
    schema?: string | null;
    table: string;
    keyColumns: string[];
    limits: DbQueryLimits;
  }): Promise<{ nullKeys: boolean; duplicateKeys: boolean }>;

  /**
   * OPTIONAL capability (2026-08-11): fetch every row whose key tuple equals
   * any of `keys` — the KEY-ANCHORED sampled-parity fetch. Sampling by
   * "first N from each side independently" only compares anything when both
   * engines order identically (they don't — collation + datetime rendering
   * disagree), so the comparator anchors the target fetch on the SOURCE's
   * sampled keys when the target adapter implements this. Key values are
   * passed RAW (the target engine compares its own stored values). Adapters
   * without the capability leave it undefined; the comparator falls back to
   * the page fetch with an honest depth note.
   */
  fetchRowsByKeys?(args: {
    schema?: string | null;
    table: string;
    keyColumns: string[];
    keys: unknown[][];
    limits: DbQueryLimits;
  }): Promise<DbReadResult>;

  /**
   * OPTIONAL capability (Stored Proc & Function Behaviour Program, Spec 2,
   * 2026-09-09): invoke ONE stored procedure / function and return the
   * engine-neutral envelope (outcome, return status, OUTPUT params, every
   * result set, messages, projected error, session). This is the ONLY
   * non-SELECT execution path on the adapter and it never takes SQL text —
   * the engine pack composes the call from structured names + typed params.
   * Source engines run the routine as-is; target engines follow the
   * request's `descriptor` (the pack's calling convention).
   */
  callRoutine?(
    request: import('./routineEnvelope').RoutineInvocationRequest,
  ): Promise<import('./routineEnvelope').RoutineInvocationEnvelope>;

  /**
   * Release pooled resources. Idempotent.
   */
  dispose(): Promise<void>;
}

export type {
  RoutineDescriptor,
  RoutineInvocationEnvelope,
  RoutineInvocationRequest,
  RoutineParamValue,
  RoutineResultSet,
  RoutineShape,
} from './routineEnvelope';

/**
 * Adapter-seam contract (2026-08-07): NO adapter guarantees more than this
 * many rows from ONE `runReadonlySelect` / `fetchOrderedRows` call — the
 * Sybase path buffers a whole result set as one sidecar JSON response, so a
 * single fetch is bounded and larger requests come back `truncated: true`.
 * Anything needing more rows must PAGE via `fetchOrderedRows.after`. Callers
 * sizing pages or full-scan bounds must clamp to this.
 */
export const MAX_SINGLE_FETCH_ROWS = 10_000;

/**
 * Re-export the underlying types so adapter consumers don't need a separate
 * import.
 */
export type {
  DbAllowlist,
  DbColumnMetadata,
  DbConnectionConfig,
  DbQueryLimits,
  DbReadResult,
  DbTableMetadata,
};
