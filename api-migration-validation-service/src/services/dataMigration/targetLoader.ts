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

/**
 * The incremental-sync write surface (gold standard C4, 2026-08-07): the
 * side-by-side daily sync was a bash comment-stub in the pack that executed
 * NOTHING. The AMVS-driven sync needs, beyond the bulk `loadTable`:
 * UPSERTs (keyed delta apply), the high-water state table, and optional
 * pk-diff delete propagation.
 */
export interface SyncTargetLoader extends TargetLoader {
  /** Create the high-water state table when absent (idempotent). */
  ensureSyncState(): Promise<void>;
  /** Read the stored high-water for a table ref (null = never synced). */
  getHighWater(tableRef: string): Promise<string | null>;
  /** Advance the stored high-water + stamp last_run_at/last_status. */
  setHighWater(tableRef: string, highWater: string, status: string): Promise<void>;
  /**
   * Upsert `rows` keyed on `conflictColumns`. `onConflict: 'update'` updates
   * every non-key load column (insert_update strategy); `'nothing'` skips
   * existing keys (insert_only). Returns rows written (inserted or updated).
   */
  upsertTable(
    spec: TableLoadSpec,
    rows: unknown[][],
    conflictColumns: string[],
    onConflict: 'update' | 'nothing'
  ): Promise<number>;
  /** Read the target's key tuples in `keyColumns` order (pk-diff deletes). */
  readKeyTuples(spec: TableLoadSpec, keyColumns: string[]): Promise<unknown[][]>;
  /** Delete the rows matching the given key tuples. Returns rows deleted. */
  deleteByKeyTuples(
    spec: TableLoadSpec,
    keyColumns: string[],
    tuples: unknown[][]
  ): Promise<number>;
}

function quoteIdent(name: string): string {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('Identifier must be a non-empty string.');
  }
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * A mid-table load failure that CARRIES the rows already written (gold
 * standard 2026-08-07): a plain throw lost the count, so the runner reported
 * `loadedCount: 0` for a table that had real partial data on the target —
 * the report then under-stated what a cleanup/re-run must deal with.
 */
export class TableLoadError extends Error {
  constructor(
    message: string,
    /** Rows successfully written by THIS loadTable call before the failure. */
    public readonly rowsWritten: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'TableLoadError';
  }
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
  protected readonly pool: Pool;
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
      // Session zone pinned to UTC (2026-08-11): a naive datetime string
      // inserted into a `timestamptz` column is interpreted in the SESSION
      // zone — the server default shifted every summer-dated value 1h on a
      // BST/GMT server (the live parity key-miss class). UTC on every
      // write session matches the read side's identical pin and the
      // comparator's naive-is-UTC policy. (`timestamp` columns unaffected.)
      options: '-c TimeZone=UTC',
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
        try {
          const res = await client.query(sql, params);
          total += res.rowCount ?? batch.length;
        } catch (err) {
          throw new TableLoadError(
            `insert into ${qn} failed after ${total} row(s) of this page were written: ` +
              `${err instanceof Error ? err.message : String(err)}`,
            total,
            err,
          );
        }
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

const SYNC_STATE_TABLE = 'haikai_sync_state';

/**
 * The PostgreSQL incremental-sync target (gold standard C4, 2026-08-07):
 * extends the bulk loader with upserts, the high-water state table, and
 * pk-diff delete support. Same credentials posture: function scope only.
 */
export class PostgresSyncTargetLoader extends PostgresTargetLoader implements SyncTargetLoader {
  private readonly syncPool: Pool;

  constructor(config: DbConnectionConfig, opts?: { maxPoolSize?: number; batchRows?: number }) {
    super(config, opts);
    // A second small pool for state/read statements so sync bookkeeping never
    // competes with the batched write client checkout.
    this.syncPool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.username,
      password: config.password,
      max: 2,
      application_name: 'haikai-incremental-sync',
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      // Same UTC session pin as the bulk-write pool (see above).
      options: '-c TimeZone=UTC',
    });
  }

  async ensureSyncState(): Promise<void> {
    await this.syncPool.query(
      `CREATE TABLE IF NOT EXISTS ${SYNC_STATE_TABLE} (` +
        `  table_name  text PRIMARY KEY,` +
        `  high_water  text,` +
        `  last_run_at timestamptz,` +
        `  last_status text` +
        `)`
    );
  }

  async getHighWater(tableRef: string): Promise<string | null> {
    const res = await this.syncPool.query(
      `SELECT high_water FROM ${SYNC_STATE_TABLE} WHERE table_name = $1`,
      [tableRef]
    );
    const raw = res.rows[0]?.high_water;
    return raw === null || raw === undefined ? null : String(raw);
  }

  async setHighWater(tableRef: string, highWater: string, status: string): Promise<void> {
    await this.syncPool.query(
      `INSERT INTO ${SYNC_STATE_TABLE} (table_name, high_water, last_run_at, last_status) ` +
        `VALUES ($1, $2, now(), $3) ` +
        `ON CONFLICT (table_name) DO UPDATE SET ` +
        `high_water = EXCLUDED.high_water, last_run_at = now(), last_status = EXCLUDED.last_status`,
      [tableRef, highWater, status]
    );
  }

  async upsertTable(
    spec: TableLoadSpec,
    rows: unknown[][],
    conflictColumns: string[],
    onConflict: 'update' | 'nothing'
  ): Promise<number> {
    if (rows.length === 0) return 0;
    if (conflictColumns.length === 0) {
      throw new Error(
        `upsertTable(${spec.schema ?? ''}.${spec.table}) needs conflict key columns ` +
          `— a keyless upsert would duplicate rows`
      );
    }
    const qn = `${spec.schema ? `${quoteIdent(spec.schema)}.` : ''}${quoteIdent(spec.table)}`;
    const colList = spec.loadColumns.map(quoteIdent).join(', ');
    const overriding = spec.identityColumns.length > 0 ? 'OVERRIDING SYSTEM VALUE ' : '';
    const conflictTarget = conflictColumns.map(quoteIdent).join(', ');
    const updates = spec.loadColumns
      .filter((c) => !conflictColumns.includes(c))
      .map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`)
      .join(', ');
    const conflictClause =
      onConflict === 'update' && updates.length > 0
        ? `ON CONFLICT (${conflictTarget}) DO UPDATE SET ${updates}`
        : `ON CONFLICT (${conflictTarget}) DO NOTHING`;
    let total = 0;
    const batchRows = 200;
    const client = await this.pool.connect();
    try {
      for (let i = 0; i < rows.length; i += batchRows) {
        const batch = rows.slice(i, i + batchRows);
        const params: unknown[] = [];
        const tuples: string[] = [];
        for (const row of batch) {
          const placeholders = row.map((_, j) => `$${params.length + j + 1}`);
          tuples.push(`(${placeholders.join(', ')})`);
          params.push(...row);
        }
        const sql =
          `INSERT INTO ${qn} (${colList}) ${overriding}VALUES ${tuples.join(', ')} ${conflictClause}`;
        try {
          const res = await client.query(sql, params);
          total += res.rowCount ?? 0;
        } catch (err) {
          throw new TableLoadError(
            `upsert into ${qn} failed after ${total} row(s) of this page were written: ` +
              `${err instanceof Error ? err.message : String(err)}`,
            total,
            err
          );
        }
      }
    } finally {
      client.release();
    }
    return total;
  }

  async readKeyTuples(spec: TableLoadSpec, keyColumns: string[]): Promise<unknown[][]> {
    const qn = `${spec.schema ? `${quoteIdent(spec.schema)}.` : ''}${quoteIdent(spec.table)}`;
    const cols = keyColumns.map(quoteIdent).join(', ');
    const res = await this.syncPool.query(`SELECT ${cols} FROM ${qn}`);
    return res.rows.map((r: Record<string, unknown>) => keyColumns.map((c) => r[c]));
  }

  async deleteByKeyTuples(
    spec: TableLoadSpec,
    keyColumns: string[],
    tuples: unknown[][]
  ): Promise<number> {
    if (tuples.length === 0) return 0;
    const qn = `${spec.schema ? `${quoteIdent(spec.schema)}.` : ''}${quoteIdent(spec.table)}`;
    const keyList = keyColumns.map(quoteIdent).join(', ');
    let total = 0;
    const batch = 500;
    for (let i = 0; i < tuples.length; i += batch) {
      const slice = tuples.slice(i, i + batch);
      const params: unknown[] = [];
      const valueTuples = slice.map((t) => {
        const placeholders = t.map((_, j) => `$${params.length + j + 1}`);
        params.push(...t);
        return `(${placeholders.join(', ')})`;
      });
      const res = await this.syncPool.query(
        `DELETE FROM ${qn} WHERE (${keyList}) IN (${valueTuples.join(', ')})`,
        params
      );
      total += res.rowCount ?? 0;
    }
    return total;
  }

  async dispose(): Promise<void> {
    await this.syncPool.end();
    await super.dispose();
  }
}
