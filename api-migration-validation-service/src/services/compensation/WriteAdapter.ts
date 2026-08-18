/**
 * Compensation write surface (Capture-State Discipline Spec 1).
 *
 * DELIBERATELY separate from the read-only `DbAdapter` — exactly the
 * `targetLoader` precedent (Spec Y): the SELECT-only guard that secures the
 * LLM's DB tools stays intact, and write capability exists ONLY on this
 * surface, constructed ONLY inside a compensation/restore code path with the
 * WRITE credentials (credential-role split: observational paths use the
 * read-only login; this surface is the single holder of the write login).
 *
 * Every batch passes `assertCompensationBatch` (grammar allowlist) before any
 * statement reaches an engine; the Sybase sidecar re-guards JVM-side.
 */

import { Pool, PoolConfig } from 'pg';

import { COMPENSATION_STATEMENT_TIMEOUT_SECONDS, SYBASE_SIDECAR_URL } from '../../config';
import type { DbConnectionConfig } from '../../types/db';
import { assertCompensationBatch } from './compensationSqlGuard';

export interface CompensationBatchOptions {
  /**
   * TRUE (default): the batch is atomic — all statements commit together or
   * none do. FALSE is reserved for reseed statements (Sybase
   * `sp_chgattribute` cannot run inside a user transaction).
   */
  transactional: boolean;
}

export interface CompensationBatchResult {
  /** Per-statement affected-row counts, aligned positionally. */
  rowCounts: number[];
}

export interface CompensationWriteAdapter {
  executeCompensationBatch(
    statements: string[],
    options?: CompensationBatchOptions,
  ): Promise<CompensationBatchResult>;
  dispose(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

export class PostgresCompensationWriteAdapter implements CompensationWriteAdapter {
  private readonly pool: Pool;

  constructor(config: DbConnectionConfig) {
    const poolConfig: PoolConfig = {
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.username,
      password: config.password,
      max: 1,
      statement_timeout: COMPENSATION_STATEMENT_TIMEOUT_SECONDS * 1000,
    };
    this.pool = new Pool(poolConfig);
  }

  async executeCompensationBatch(
    statements: string[],
    options?: CompensationBatchOptions,
  ): Promise<CompensationBatchResult> {
    assertCompensationBatch(statements);
    const transactional = options?.transactional !== false;
    const client = await this.pool.connect();
    const rowCounts: number[] = [];
    try {
      if (transactional) await client.query('BEGIN');
      for (const statement of statements) {
        const result = await client.query(statement);
        rowCounts.push(result.rowCount ?? 0);
      }
      if (transactional) await client.query('COMMIT');
      return { rowCounts };
    } catch (err) {
      if (transactional) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* the connection error itself is the signal */
        }
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async dispose(): Promise<void> {
    await this.pool.end();
  }
}

// ---------------------------------------------------------------------------
// Sybase (via the discovery sidecar's /mutate endpoint — literal SQL only,
// JVM-side MutationSqlGuard re-checks every statement)
// ---------------------------------------------------------------------------

/** Wire shape of the sidecar's MutationResponse record (camelCase, like /query). */
interface SidecarMutateResponse {
  ok?: boolean;
  error?: string | null;
  rowCounts?: number[] | null;
}

export class SybaseCompensationWriteAdapter implements CompensationWriteAdapter {
  private readonly config: DbConnectionConfig;
  private readonly sidecarBaseUrl: string;

  constructor(config: DbConnectionConfig, opts?: { sidecarBaseUrl?: string }) {
    this.config = config;
    this.sidecarBaseUrl = (opts?.sidecarBaseUrl ?? SYBASE_SIDECAR_URL).replace(/\/+$/, '');
  }

  async executeCompensationBatch(
    statements: string[],
    options?: CompensationBatchOptions,
  ): Promise<CompensationBatchResult> {
    assertCompensationBatch(statements);
    const body = {
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      username: this.config.username,
      password: this.config.password,
      statements,
      transactional: options?.transactional !== false,
      queryTimeoutSeconds: COMPENSATION_STATEMENT_TIMEOUT_SECONDS,
    };
    const url = `${this.sidecarBaseUrl}/mutate`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      let detail = '';
      try {
        detail = await resp.text();
      } catch {
        /* status alone */
      }
      throw new Error(`Sybase sidecar at ${url} returned HTTP ${resp.status}: ${detail}`);
    }
    const parsed = (await resp.json()) as SidecarMutateResponse;
    if (parsed.ok !== true) {
      throw new Error(`Sybase sidecar mutate failed: ${parsed.error ?? 'unknown error'}`);
    }
    return { rowCounts: parsed.rowCounts ?? [] };
  }

  async dispose(): Promise<void> {
    // Sidecar resolves connections per-request — nothing pooled here.
  }
}
