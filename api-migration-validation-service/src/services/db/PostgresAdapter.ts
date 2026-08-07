import { Pool, PoolClient, PoolConfig, types as pgTypes } from 'pg';
import {
  DbAdapter,
  DbAllowlist,
  DbConnectionConfig,
  DbQueryLimits,
  DbReadResult,
  DbTableMetadata,
} from './DbAdapter';
import { assertReadonlySelect, ensureLimit } from './sqlGuard';
import { keysetPredicate } from './keyset';

/**
 * `PostgresAdapter` -- v1 implementation of `DbAdapter` using the `pg`
 * package. Pooled connections per session (configurable cap), per-query
 * `SET statement_timeout`, explicit `LIMIT` injection if absent, SELECT-only
 * statement parser via `sqlGuard`.
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 4.
 *
 * Notes on safety:
 *   - The `Pool` is configured `application_name='api-migration-validation'`
 *     so DB-side audit / lock pickers can identify our connections.
 *   - All identifiers passed to `sampleValues` / `listMetadata` are quoted
 *     using `quoteIdent` (Postgres-style: double-quote and escape any
 *     embedded double-quotes by doubling them).
 *   - `runReadonlySelect` runs each query in its own implicit transaction
 *     (default `pg` behaviour) AFTER setting `statement_timeout` on the
 *     same connection -- so if the engine-level timeout fires, the rest of
 *     the connection is reset by `RESET statement_timeout` in the `finally`
 *     block.
 */
// Datetime OIDs read back as RAW STRINGS, never locale-shifted JS Dates
// (2026-08-07, the live ±1h BST/GMT parity artifact): node-postgres's default
// parsers construct `timestamp` (no tz) values as LOCAL-time Date objects, so
// the same stored instant read on a BST machine landed one hour off the
// source's ISO-UTC form and every ValidFrom/ValidTo cell "diverged". Raw
// strings keep the comparison engine-neutral; the pair-rule datetime strategy
// owns normalization (naive timestamps are interpreted as UTC by policy).
const RAW_STRING_DATETIME_OIDS = new Set([
  1082, // date
  1114, // timestamp without time zone
  1184, // timestamp with time zone (string carries its offset)
]);
export const rawDatetimeTypes = {
  getTypeParser: (oid: number, format?: string) =>
    RAW_STRING_DATETIME_OIDS.has(oid)
      ? (value: string) => value
      : // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (pgTypes.getTypeParser as (o: number, f?: string) => any)(oid, format),
};

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
      application_name: 'api-migration-validation',
      // Connection-level timeouts -- generous; per-query timeout is enforced
      // separately via `SET statement_timeout`.
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      // Pool-scoped (NOT the global pg.types mutation): the write path
      // (targetLoader) keeps its own pool untouched.
      types: rawDatetimeTypes,
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

  async countRows(args: {
    schema?: string | null;
    table: string;
    limits: DbQueryLimits;
  }): Promise<number> {
    const qSchema = args.schema ? `${quoteIdent(args.schema)}.` : '';
    const sql = `SELECT COUNT(*) AS row_count FROM ${qSchema}${quoteIdent(args.table)}`;
    const res = await this.runReadonlySelect(sql, [], args.limits);
    const first = res.rows[0] ?? {};
    const raw = (first as Record<string, unknown>).row_count ?? Object.values(first)[0];
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      // Gold standard (2026-08-07): an unparseable COUNT(*) used to degrade
      // to 0 — downstream then "verified" a table as empty or skipped its
      // load entirely. A garbled count is a loud failure, never a zero.
      throw new Error(
        `countRows(${args.schema ?? ''}.${args.table}) returned an unparseable count: ` +
          `${JSON.stringify(raw)}`,
      );
    }
    return n;
  }

  async fetchOrderedRows(args: {
    schema?: string | null;
    table: string;
    orderBy: string[];
    limits: DbQueryLimits;
    after?: unknown[] | null;
  }): Promise<DbReadResult> {
    if (args.orderBy.length === 0) {
      throw new Error('fetchOrderedRows requires at least one order column');
    }
    const qSchema = args.schema ? `${quoteIdent(args.schema)}.` : '';
    // NULLS FIRST pins the cross-engine NULLS-LOW ordering contract (the
    // sibling engine sorts NULLs low in ascending order natively).
    const orderBy = args.orderBy
      .map((c) => `${quoteIdent(c)} ASC NULLS FIRST`)
      .join(', ');
    // Keyset continuation (2026-08-07): rows strictly AFTER the previous
    // page's last key tuple, parameterised (this adapter supports params;
    // the tuple predicate is expanded NULL-aware in the shared builder).
    const params: unknown[] = [];
    const where = args.after && args.after.length > 0
      ? `WHERE ${keysetPredicate(args.orderBy.map(quoteIdent), args.after, (v) => {
          params.push(v);
          return `$${params.length}`;
        })} `
      : '';
    const sql =
      `SELECT * FROM ${qSchema}${quoteIdent(args.table)} ${where}` +
      `ORDER BY ${orderBy} LIMIT ${Math.max(1, args.limits.maxRows)}`;
    return this.runReadonlySelect(sql, params, args.limits);
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
