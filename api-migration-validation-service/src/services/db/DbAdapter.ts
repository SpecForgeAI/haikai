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
   * Release pooled resources. Idempotent.
   */
  dispose(): Promise<void>;
}

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
