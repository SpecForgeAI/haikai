/**
 * Target write path for the data-migration runner (Spec Y). This is the ONLY
 * writer in the data plane — deliberately SEPARATE from the read-only DbAdapter,
 * whose SELECT-only guard secures the LLM's DB tools and must stay intact.
 */
import { Pool, PoolConfig } from 'pg';
import { DbConnectionConfig } from '../../types/db';
import { TableLoadSpec } from './types';

export interface TargetLoader {
  /**
   * Make the target table safe to (re)load: truncate it so a re-run of the
   * bulk load can NEVER double the rows (WS3 P2, 2026-07-31 — live:
   * `view_tag` 864 -> 1,728, exactly 2x, from a duplicated run). Called by
   * the runner immediately before `loadTable`.
   */
  prepareTable(spec: TableLoadSpec): Promise<void>;
  /**
   * Insert `rows` (each tuple aligned positionally to spec.loadColumns) into the
   * target table. Returns the number of rows written.
   */
  loadTable(spec: TableLoadSpec, rows: unknown[][]): Promise<number>;
  dispose(): Promise<void>;
}

function quoteIdent(name: string): string {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('Identifier must be a non-empty string.');
  }
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Writes rows to a PostgreSQL target via batched, parameterised multi-row
 * INSERTs. OVERRIDING SYSTEM VALUE is emitted when the target table has identity
 * columns, preserving source-assigned ids (like-for-like).
 *
 * The runner calls `prepareTable` ONCE per table (truncate), then `loadTable`
 * once per keyset PAGE — pages append, so full tables of any size load with
 * bounded memory (2026-08-07; the old single-call shape is gone with the
 * read caps).
 */
export class PostgresTargetLoader implements TargetLoader {
  private readonly pool: Pool;
  private readonly batchRows: number;

  constructor(config: DbConnectionConfig, opts?: { maxPoolSize?: number; batchRows?: number }) {
    const poolConfig: PoolConfig = {
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.username,
      password: config.password,
      max: opts?.maxPoolSize ?? 4,
      application_name: 'haikai-data-migrate',
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
    };
    this.pool = new Pool(poolConfig);
    this.batchRows = Math.max(1, opts?.batchRows ?? 500);
  }

  async prepareTable(spec: TableLoadSpec): Promise<void> {
    const qn = `${spec.schema ? `${quoteIdent(spec.schema)}.` : ''}${quoteIdent(spec.table)}`;
    // CASCADE: a re-run AFTER the post-load FKs exist must still truncate;
    // cascaded children are reloaded later in the same FK-ordered plan.
    await this.pool.query(`TRUNCATE TABLE ${qn} CASCADE`);
  }

  async loadTable(spec: TableLoadSpec, rows: unknown[][]): Promise<number> {
    if (rows.length === 0) return 0;
    if (spec.loadColumns.length === 0) {
      throw new Error(`load plan for ${spec.schema ?? ''}.${spec.table} has no columns to load`);
    }
    const qn = `${spec.schema ? `${quoteIdent(spec.schema)}.` : ''}${quoteIdent(spec.table)}`;
    const colList = spec.loadColumns.map(quoteIdent).join(', ');
    const overriding = spec.identityColumns.length > 0 ? 'OVERRIDING SYSTEM VALUE ' : '';

    let total = 0;
    const client = await this.pool.connect();
    try {
      for (let i = 0; i < rows.length; i += this.batchRows) {
        const batch = rows.slice(i, i + this.batchRows);
        const params: unknown[] = [];
        const tuples: string[] = [];
        for (const row of batch) {
          const placeholders = row.map((_, j) => `$${params.length + j + 1}`);
          tuples.push(`(${placeholders.join(', ')})`);
          params.push(...row);
        }
        const sql = `INSERT INTO ${qn} (${colList}) ${overriding}VALUES ${tuples.join(', ')}`;
        const res = await client.query(sql, params);
        total += res.rowCount ?? batch.length;
      }
    } finally {
      client.release();
    }
    return total;
  }

  async dispose(): Promise<void> {
    await this.pool.end();
  }
}
