/**
 * Apply ONE translated routine to the target (Spec 4, 2026-09-09) — PACK CODE.
 *
 * `DROP FUNCTION IF EXISTS <schema>.<fn>(<arg types>)` + the draft SQL in
 * ONE transaction: a changed signature cannot be replaced in place, and a
 * draft that fails to compile leaves the target exactly as it was. The
 * draft is the reviewed/looped translation text (the only SQL this module
 * executes); the descriptor tells us which signature to drop.
 */

import { Pool, type PoolConfig } from 'pg';
import type { DbConnectionConfig } from '../../types/db';
import type { RoutineDescriptor } from './routineEnvelope';

export interface RoutineApplyResult {
  ok: boolean;
  dropped: boolean;
  error: { sqlstate: string | null; message: string; position: number | null; detail: string | null } | null;
  timing_ms: number;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** The DROP statements the descriptor prescribes (exported for tests). */
export function dropStatementsFor(descriptor: RoutineDescriptor): string[] {
  const fn = `${quoteIdent(descriptor.pg_schema)}.${quoteIdent(descriptor.pg_function)}`;
  const inTypes = descriptor.args.filter((a) => a.direction === 'in').map((a) => a.pg_type);
  // Drop the exact IN-signature the convention prescribes AND the bare name
  // when no overload exists (a previous attempt may have used other types).
  return [`DROP FUNCTION IF EXISTS ${fn}(${inTypes.join(', ')})`];
}

export interface RoutineApplyClient {
  query(text: string): Promise<unknown>;
}

export async function applyRoutineWithClient(
  client: RoutineApplyClient,
  descriptor: RoutineDescriptor,
  draftSql: string,
  opts: { dropFirst: boolean; timeoutSeconds: number },
): Promise<RoutineApplyResult> {
  const started = Date.now();
  let dropped = false;
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL statement_timeout = ${Math.max(1, opts.timeoutSeconds) * 1000}`);
    if (opts.dropFirst) {
      for (const stmt of dropStatementsFor(descriptor)) await client.query(stmt);
      dropped = true;
    }
    await client.query(draftSql);
    await client.query('COMMIT');
    return { ok: true, dropped, error: null, timing_ms: Date.now() - started };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* discarded client */
    }
    const e = (err ?? {}) as { code?: string; message?: string; position?: string; detail?: string };
    return {
      ok: false,
      dropped: false,
      error: {
        sqlstate: e.code ?? null,
        message: e.message ?? String(err),
        position: e.position ? Number(e.position) : null,
        detail: e.detail ?? null,
      },
      timing_ms: Date.now() - started,
    };
  }
}

/** Apply against a fresh single-connection pool for the given target config. */
export async function applyRoutineToPostgres(
  config: DbConnectionConfig,
  descriptor: RoutineDescriptor,
  draftSql: string,
  opts: { dropFirst: boolean; timeoutSeconds: number },
): Promise<RoutineApplyResult> {
  const poolConfig: PoolConfig = {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
    max: 1,
    application_name: 'api-migration-validation-routine-apply',
    connectionTimeoutMillis: 10000,
    options: '-c TimeZone=UTC',
  };
  const pool = new Pool(poolConfig);
  const client = await pool.connect();
  try {
    return await applyRoutineWithClient(client, descriptor, draftSql, opts);
  } finally {
    client.release();
    await pool.end();
  }
}
