/**
 * DB adapter shared types -- inputs and outputs for `DbAdapter` consumers.
 * Both the LLM tool registry (`run_readonly_sql`, `sample_db_values`,
 * `list_db_metadata`) and the `/test-db-connection` action endpoint rely on
 * these.
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 4.
 */

export type DbType = 'postgres' | 'sybase';

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
