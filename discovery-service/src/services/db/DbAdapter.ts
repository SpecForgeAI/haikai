// TODO: consolidate with api-migration-validation-service/src/services/db/* once
// the shared layer lands. See spec 2026-05-16-database-discovery-packs.
//
// This file is DUPLICATED from
// `api-migration-validation-service/src/services/db/DbAdapter.ts` per D2 of the
// shaping notes. Both copies carry this TODO so future consolidation work can
// grep for the marker and extract the shared surface into a workspace package.

/**
 * `DbAdapter` -- abstraction over per-engine read-only DB access for the
 * discovery-service's database discovery packs (PostgreSQL pack +
 * Sybase-sidecar pack) and the `/discovery/db/test-connection` action
 * endpoint.
 *
 * Spec: 2026-05-16 Database Discovery Packs -- Task Group 2.
 *
 * Implementation contract:
 *   - SELECT-only enforcement is the adapter's responsibility -- no caller
 *     is trusted to pre-validate SQL. Implementations MUST reject any
 *     statement matching the SELECT-only parser (see `sqlGuard.ts`).
 *   - Per-call statement timeout MUST be enforced via the engine's native
 *     mechanism (`SET statement_timeout` for Postgres) so a runaway query
 *     can't tie up the discovery run's per-step budget.
 *   - Row caps are injected as explicit `LIMIT` (or engine-equivalent) when
 *     the SQL doesn't already carry one.
 *   - All identifiers used in `sampleValues` / `listMetadata` MUST be quoted
 *     by the adapter, never interpolated as raw SQL.
 *   - `dispose()` MUST release any pooled connection slot the adapter holds.
 *
 * The DbAdapter surface is NARROWER than the discovery pack surface: it
 * covers SQL execution + guard + connection management only. Introspection
 * methods (schema/table walk, view body fetch, etc.) live on the
 * `DatabaseDiscoveryPack` interface, not here.
 */
export type DbType = 'postgres' | 'sybase' | 'mssql';

export interface DbConnectionConfig {
  dbType: DbType;
  host: string;
  port: number;
  database: string;
  schema?: string | null;
  username: string;
  /**
   * Password lives in the in-memory secrets bundle, NOT here. The factory
   * resolves it at adapter construction time via the per-run secretsStore.
   */
  password: string;
}

export interface DbAllowlist {
  schemas?: string[] | null;
  tables?: string[] | null;
}

export interface DbQueryLimits {
  /** Hard row cap injected as `LIMIT` if the SQL doesn't already carry one. */
  maxRows: number;
  /** Statement timeout in seconds, applied via `SET statement_timeout`. */
  timeoutSeconds: number;
}

export interface DbColumnMetadata {
  schema: string;
  table: string;
  column: string;
  dataType: string;
  isNullable: boolean;
}

export interface DbTableMetadata {
  schema: string;
  table: string;
  columns: DbColumnMetadata[];
}

export interface DbReadResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  /** TRUE when the result was capped by the injected / explicit LIMIT. */
  truncated: boolean;
}

export interface DbAdapter {
  /**
   * Smoke-test the connection -- returns success on a single round-trip,
   * throws on auth / network failure. Caller surfaces the error message
   * verbatim.
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
