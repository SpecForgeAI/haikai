/**
 * Postgres routine invoker (Stored Proc & Function Behaviour Program, Spec 2,
 * 2026-09-09) — PACK CODE for the target engine.
 *
 * Invokes a TRANSLATED routine per its calling-convention descriptor
 * (pair rule SYBPG.PROC.ABI.001) and returns the engine-neutral envelope:
 *
 *   - `return_status`     : SELECT fn(args) AS return_status
 *   - `single_result_set` : SELECT * FROM fn(args)            -> one result set
 *   - `out_params`        : SELECT * FROM fn(args)            -> one row of OUT columns
 *   - `rich`              : SELECT * FROM fn(args) (OUT row incl. refcursor
 *                           names) then FETCH ALL FROM "<cursor>" per
 *                           refcursor in descriptor order
 *
 * Runs inside ONE transaction on ONE client: BEGIN -> call -> fetch cursors
 * -> COMMIT (the caller's compensation bracket owns undo, exactly as target
 * replay does today) or ROLLBACK on error. NOTICE messages are captured via
 * the client's 'notice' event (PRINT carriage, SYBPG.PROC.MSG.001). Errors
 * are projected with SQLSTATE + DETAIL; a DETAIL JSON carrying
 * `source_error` (SYBPG.PROC.ERR.001) surfaces as the envelope error number.
 *
 * The client interface is minimal so tests drive it with a fake.
 */

import type {
  RoutineDescriptor,
  RoutineInvocationEnvelope,
  RoutineInvocationRequest,
  RoutineMessage,
  RoutineResultSet,
} from './routineEnvelope';

/** The slice of `pg.PoolClient` the invoker needs (fake-able). */
export interface RoutineClient {
  query(text: string, values?: unknown[]): Promise<{
    rows: Array<Record<string, unknown>>;
    rowCount: number | null;
    fields?: Array<{ name: string; dataTypeID?: number }>;
  }>;
  on?(event: 'notice', listener: (msg: { message?: string; severity?: string; code?: string }) => void): unknown;
  off?(event: 'notice', listener: (msg: { message?: string; severity?: string; code?: string }) => void): unknown;
  removeListener?(event: 'notice', listener: (msg: { message?: string; severity?: string; code?: string }) => void): unknown;
}

/** Optional OID -> type-name resolver (the adapter passes `pg.types` knowledge). */
export type OidTypeNameResolver = (oid: number | undefined) => string;

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function parseDetailJson(detail: string | null | undefined): Record<string, unknown> | null {
  if (!detail) return null;
  const trimmed = detail.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Project a `pg` DatabaseError into the envelope error (exported for tests). */
export function projectPostgresError(err: unknown): RoutineInvocationEnvelope['error'] {
  const e = (err ?? {}) as {
    code?: string;
    message?: string;
    detail?: string;
    hint?: string;
    constraint?: string;
  };
  const detailJson = parseDetailJson(e.detail);
  const sourceError = detailJson && typeof detailJson.source_error === 'number' ? detailJson.source_error : null;
  const severity = detailJson && typeof detailJson.severity === 'number' ? detailJson.severity : null;
  const state = detailJson && typeof detailJson.state === 'number' ? detailJson.state : null;
  return {
    number: sourceError,
    sqlstate: e.code ?? null,
    severity,
    state,
    message: e.message ?? String(err),
    detail: e.detail ?? null,
    constraint: e.constraint ?? null,
  };
}

function toResultSet(
  ordinal: number,
  res: { rows: Array<Record<string, unknown>>; fields?: Array<{ name: string; dataTypeID?: number }> },
  cap: number,
  typeName: OidTypeNameResolver,
): RoutineResultSet {
  const columns = (res.fields ?? []).map((f) => ({ name: f.name, type: typeName(f.dataTypeID) }));
  const names = columns.length > 0 ? columns.map((c) => c.name) : Object.keys(res.rows[0] ?? {});
  const truncated = res.rows.length > cap;
  const rows = res.rows.slice(0, cap).map((r) => names.map((n) => r[n] ?? null));
  return {
    ordinal,
    columns: columns.length > 0 ? columns : names.map((n) => ({ name: n, type: '' })),
    rows,
    row_count: rows.length,
    truncated,
  };
}

/**
 * Invoke one translated routine on a target client per its descriptor.
 * The client must be a DEDICATED connection (the transaction spans calls).
 */
export async function invokePostgresRoutine(
  client: RoutineClient,
  request: RoutineInvocationRequest,
  opts: { login: string; typeName?: OidTypeNameResolver } ,
): Promise<RoutineInvocationEnvelope> {
  const descriptor = request.descriptor;
  if (!descriptor) {
    throw new Error('Postgres routine invocation requires a calling-convention descriptor (SYBPG.PROC.ABI.001).');
  }
  const typeName: OidTypeNameResolver = opts.typeName ?? ((oid) => (oid === undefined ? '' : String(oid)));
  const cap = Math.max(1, request.limits.max_rows_per_result_set);
  const messages: RoutineMessage[] = [];
  const onNotice = (msg: { message?: string; severity?: string; code?: string }): void => {
    messages.push({
      kind: 'notice',
      number: null,
      severity: null,
      state: null,
      text: msg.message ?? '',
    });
  };
  client.on?.('notice', onNotice);

  const inArgs = descriptor.args.filter((a) => a.direction !== 'out');
  const values = inArgs.map((a) => {
    const p = request.params.find((x) => x.name.toLowerCase() === a.source_param.toLowerCase());
    return p === undefined ? null : p.value ?? null;
  });
  const placeholders = inArgs.map((a, i) => `$${i + 1}::${a.pg_type}`).join(', ');
  const fn = `${quoteIdent(descriptor.pg_schema)}.${quoteIdent(descriptor.pg_function)}`;
  const started = Date.now();
  const envelope: RoutineInvocationEnvelope = {
    outcome: 'success',
    return_status: null,
    output_params: {},
    result_sets: [],
    update_counts: [],
    messages,
    error: null,
    timing_ms: 0,
    session: { login: opts.login, set_options: [...request.session_set] },
    engine: 'postgres',
  };

  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL statement_timeout = ${Math.max(1, request.limits.timeout_seconds) * 1000}`);
    for (const setLine of request.session_set) {
      // Session options are a SOURCE-engine concern; on the target they are
      // recorded only (the translation reproduced their semantics).
      void setLine;
    }
    switch (descriptor.shape) {
      case 'return_status': {
        const res = await client.query(`SELECT ${fn}(${placeholders}) AS return_status`, values);
        const v = res.rows[0]?.return_status;
        envelope.return_status = v === null || v === undefined ? null : Number(v);
        break;
      }
      case 'single_result_set': {
        const res = await client.query(`SELECT * FROM ${fn}(${placeholders})`, values);
        envelope.result_sets.push(toResultSet(1, res, cap, typeName));
        envelope.return_status = descriptor.return_status_carriage === 'none' ? 0 : null;
        break;
      }
      case 'out_params': {
        const res = await client.query(`SELECT * FROM ${fn}(${placeholders})`, values);
        const row = res.rows[0] ?? {};
        for (const name of descriptor.out_params) envelope.output_params[name] = row[name] ?? null;
        if (descriptor.return_status_carriage === 'out_param') {
          const rs = row['return_status'];
          envelope.return_status = rs === null || rs === undefined ? null : Number(rs);
        } else {
          envelope.return_status = 0;
        }
        break;
      }
      case 'rich': {
        const res = await client.query(`SELECT * FROM ${fn}(${placeholders})`, values);
        const row = res.rows[0] ?? {};
        for (const name of descriptor.out_params) envelope.output_params[name] = row[name] ?? null;
        const rs = row['return_status'];
        envelope.return_status = rs === null || rs === undefined ? null : Number(rs);
        let ordinal = 0;
        for (const cursorArg of descriptor.refcursors) {
          const cursorName = row[cursorArg];
          ordinal += 1;
          if (typeof cursorName !== 'string' || cursorName.length === 0) {
            // A branch that opened no cursor: an EMPTY result set is still a
            // result set on the source side; keep the ordinal, mark empty.
            envelope.result_sets.push({ ordinal, columns: [], rows: [], row_count: 0, truncated: false });
            continue;
          }
          const fetched = await client.query(`FETCH ALL FROM ${quoteIdent(cursorName)}`);
          envelope.result_sets.push(toResultSet(ordinal, fetched, cap, typeName));
          if (envelope.result_sets.length >= request.limits.max_result_sets) break;
        }
        break;
      }
      default:
        throw new Error(`Unknown routine shape '${String((descriptor as RoutineDescriptor).shape)}'`);
    }
    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* the pool discards a broken client */
    }
    envelope.outcome = 'error';
    envelope.error = projectPostgresError(err);
  } finally {
    envelope.timing_ms = Date.now() - started;
    (client.off ?? client.removeListener)?.call(client, 'notice', onNotice);
  }
  return envelope;
}
