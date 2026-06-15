// TODO: consolidate with api-migration-validation-service/src/services/db/* once
// the shared layer lands. See spec 2026-05-16-database-discovery-packs.
//
// This file is DUPLICATED from
// `api-migration-validation-service/src/services/db/PostgresAdapter.ts` per D2
// of the shaping notes. The discovery-service copy extends the AMVS surface
// with additional introspection helpers (`runIntrospectionQuery`, `getServer
// Identity`) that the per-pack PostgresDiscoveryPack uses for catalog walks.
// Both copies carry this TODO so future consolidation work can grep for the
// marker and extract the shared surface into a workspace package.

import { Pool, PoolConfig } from 'pg';
import {
  DbAdapter,
  DbAllowlist,
  DbConnectionConfig,
  DbQueryLimits,
  DbReadResult,
  DbTableMetadata,
} from './DbAdapter';
import { assertReadonlySelect, ensureLimit } from './sqlGuard';

/**
 * `PostgresAdapter` -- v1 implementation of `DbAdapter` for the
 * discovery-service. Pooled connections per session (configurable cap),
 * per-query `SET statement_timeout`, explicit `LIMIT` injection if absent,
 * SELECT-only statement parser via `sqlGuard`.
 *
 * Spec: 2026-05-16 Database Discovery Packs -- Task Group 3.
 *
 * Notes on safety:
 *   - The `Pool` is configured `application_name='discovery-service'`
 *     so DB-side audit / lock pickers can identify our connections.
 *   - All identifiers passed to `sampleValues` / `listMetadata` are quoted
 *     using `quoteIdent` (Postgres-style: double-quote and escape any
 *     embedded double-quotes by doubling them).
 *   - `runReadonlySelect` runs each query in its own implicit transaction
 *     (default `pg` behaviour) AFTER setting `statement_timeout` on the
 *     same connection -- so if the engine-level timeout fires, the rest of
 *     the connection is reset by `RESET statement_timeout` in the `finally`
 *     block.
 *   - `runIntrospectionQuery` is a discovery-service-specific helper that
 *     accepts arbitrary SELECT-only SQL against `information_schema` /
 *     `pg_catalog` and routes through the same SQL guard + timeout path.
 *     It does NOT inject LIMIT (catalog walks are inherently bounded).
 */
export class PostgresAdapter implements DbAdapter {
  private readonly pool: Pool;

  constructor(config: DbConnectionConfig, opts?: { maxPoolSize?: number }) {
    const poolConfig: PoolConfig = {
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.username,
      password: config.password,
      max: opts?.maxPoolSize ?? 4,
      application_name: 'discovery-service',
      // Connection-level timeouts -- generous; per-query timeout is enforced
      // separately via `SET statement_timeout`.
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
    };
    this.pool = new Pool(poolConfig);
  }

  async testConnection(): Promise<{ success: true; serverVersion?: string }> {
    const client = await this.pool.connect();
    try {
      const res = await client.query('SELECT version() AS version');
      const version = res.rows?.[0]?.version as string | undefined;
      return { success: true, serverVersion: version };
    } finally {
      client.release();
    }
  }

  async listMetadata(allowlist: DbAllowlist): Promise<DbTableMetadata[]> {
    const schemas = (allowlist.schemas ?? []).filter((s) => s && s.length > 0);
    const tables = (allowlist.tables ?? []).filter((t) => t && t.length > 0);
    if (schemas.length === 0 && tables.length === 0) {
      // Fail-closed: empty allowlist returns no rows.
      return [];
    }
    const client = await this.pool.connect();
    try {
      // `information_schema.columns` -- standard, read-only.
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (schemas.length > 0) {
        params.push(schemas);
        conditions.push(`table_schema = ANY($${params.length}::text[])`);
      }
      if (tables.length > 0) {
        params.push(tables);
        conditions.push(`table_name = ANY($${params.length}::text[])`);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const sql = `
        SELECT table_schema, table_name, column_name, data_type, is_nullable
        FROM information_schema.columns
        ${where}
        ORDER BY table_schema, table_name, ordinal_position
      `;
      const res = await client.query(sql, params);
      const grouped = new Map<string, DbTableMetadata>();
      for (const row of res.rows) {
        const key = `${row.table_schema}.${row.table_name}`;
        let entry = grouped.get(key);
        if (!entry) {
          entry = {
            schema: row.table_schema,
            table: row.table_name,
            columns: [],
          };
          grouped.set(key, entry);
        }
        entry.columns.push({
          schema: row.table_schema,
          table: row.table_name,
          column: row.column_name,
          dataType: row.data_type,
          isNullable: String(row.is_nullable).toUpperCase() === 'YES',
        });
      }
      return Array.from(grouped.values());
    } finally {
      client.release();
    }
  }

  async runReadonlySelect(
    rawSql: string,
    params: unknown[],
    limits: DbQueryLimits,
  ): Promise<DbReadResult> {
    const validatedSql = assertReadonlySelect(rawSql);
    const { sql: limitedSql, injected } = ensureLimit(validatedSql, limits.maxRows);

    const client = await this.pool.connect();
    try {
      // Per-query statement timeout. ms unit per Postgres convention.
      await client.query(`SET statement_timeout = ${limits.timeoutSeconds * 1000}`);
      const res = await client.query(limitedSql, params);
      const truncated = injected
        ? res.rowCount !== null && res.rowCount >= limits.maxRows
        : false;
      return {
        rows: res.rows as Array<Record<string, unknown>>,
        rowCount: res.rowCount ?? 0,
        truncated,
      };
    } finally {
      try {
        // Reset so the pooled connection is in a clean state on next use.
        await client.query('RESET statement_timeout');
      } catch {
        // Ignore reset failures; pool destroys connections that error out.
      }
      client.release();
    }
  }

  async sampleValues(args: {
    schema?: string | null;
    table: string;
    column: string;
    limits: DbQueryLimits;
    where?: { sql: string; params: unknown[] } | null;
  }): Promise<DbReadResult> {
    const qSchema = args.schema ? `${quoteIdent(args.schema)}.` : '';
    const qTable = quoteIdent(args.table);
    const qColumn = quoteIdent(args.column);
    const whereClause = args.where && args.where.sql.trim().length > 0
      ? `WHERE ${args.where.sql}`
      : '';
    const params = args.where?.params ?? [];
    const sql = `SELECT DISTINCT ${qColumn} FROM ${qSchema}${qTable} ${whereClause} LIMIT ${args.limits.maxRows}`;
    // Run through the readonly-select path so we still get the SELECT-only
    // guard + statement_timeout + result shape -- the LIMIT is already
    // present so `ensureLimit` is a no-op.
    return this.runReadonlySelect(sql, params, args.limits);
  }

  /**
   * Discovery-service-specific helper for catalog walks. Runs an arbitrary
   * SELECT-only statement against `information_schema` / `pg_catalog` (or
   * any other SELECT-able target) through the SQL guard + statement_timeout
   * path. Does NOT inject `LIMIT` -- catalog queries are inherently bounded
   * by the catalog's own row count, and `LIMIT` injection on a `JOIN`-heavy
   * catalog query produces misleading truncation behaviour.
   *
   * Spec: 2026-05-16 Database Discovery Packs -- Task Group 3.
   */
  async runIntrospectionQuery(
    rawSql: string,
    params: unknown[],
    timeoutSeconds: number,
  ): Promise<DbReadResult> {
    const validatedSql = assertReadonlySelect(rawSql);
    const client = await this.pool.connect();
    try {
      await client.query(`SET statement_timeout = ${timeoutSeconds * 1000}`);
      const res = await client.query(validatedSql, params);
      return {
        rows: res.rows as Array<Record<string, unknown>>,
        rowCount: res.rowCount ?? 0,
        truncated: false,
      };
    } finally {
      try {
        await client.query('RESET statement_timeout');
      } catch {
        // Ignore reset failures; pool destroys connections that error out.
      }
      client.release();
    }
  }

  /**
   * Best-effort engine identity query. Returns version + edition strings for
   * the run's connection-evidence record. Throws on connection failure;
   * caller's soft-fail wrapper converts the throw into a finding.
   */
  async getServerIdentity(): Promise<{ version: string; edition?: string }> {
    const client = await this.pool.connect();
    try {
      const versionRes = await client.query('SELECT version() AS version');
      const version = String(versionRes.rows?.[0]?.version ?? 'unknown');
      // Edition extraction is best-effort -- not all builds expose
      // server_version_num distinctly. Capture what we can.
      let edition: string | undefined;
      try {
        const editionRes = await client.query(
          "SELECT current_setting('server_version', true) AS server_version",
        );
        const sv = editionRes.rows?.[0]?.server_version;
        if (typeof sv === 'string' && sv.length > 0) edition = sv;
      } catch {
        // ignore -- edition stays undefined
      }
      return { version, edition };
    } finally {
      client.release();
    }
  }

  async dispose(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * Quote a Postgres identifier safely. Postgres uses double-quoted
 * identifiers; embedded double-quotes are escaped by doubling.
 */
function quoteIdent(name: string): string {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('Identifier must be a non-empty string.');
  }
  return `"${name.replace(/"/g, '""')}"`;
}

export { quoteIdent };
