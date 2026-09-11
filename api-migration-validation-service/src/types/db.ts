/**
 * DB adapter shared types -- inputs and outputs for `DbAdapter` consumers.
 * Both the LLM tool registry (`run_readonly_sql`, `sample_db_values`,
 * `list_db_metadata`) and the `/test-db-connection` action endpoint rely on
 * these.
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 4.
 */

/**
 * Supported source/target engines. `mssql` = Microsoft SQL Server (SQL Server
 * 16 -> PostgreSQL 18 pair programme, 2026-09-11). The engine key is the
 * ONLY engine discriminator on every wire shape (`db_type` / `dbType`).
 */
export const DB_TYPES = ['postgres', 'sybase', 'mssql'] as const;
export type DbType = (typeof DB_TYPES)[number];

export function isDbType(value: unknown): value is DbType {
  return typeof value === 'string' && (DB_TYPES as readonly string[]).includes(value);
}

/** The 4xx message fragment routes use for an unsupported engine value. */
export const DB_TYPE_CHOICES = DB_TYPES.map((t) => `'${t}'`).join(' | ');

export interface DbConnectionConfig {
  dbType: DbType;
  host: string;
  port: number;
  database: string;
  schema?: string | null;
  username: string;
  /**
   * Password lives in the in-memory secrets bundle, NOT here. The factory
   * resolves it at adapter construction time via the secretsStore.
   */
  password: string;
  /** DETECTED source-server charset (e.g. iso_1) — declared on sidecar
   *  connections so extraction decodes single-byte data correctly
   *  (2026-08-23; carried from the DB scan / pack manifest). */
  charset?: string | null;
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
