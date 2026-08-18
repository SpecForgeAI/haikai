/**
 * Log-replay CURRENT-side capture runner (Capture-State Discipline &
 * Log-Replay program, Spec 7, 2026-08-18).
 *
 * Reconciliation ROUND 2, phase A: replay the staged log corpus (Spec 5)
 * against the LIVE CURRENT system at S0 and promote the results into a
 * `log_replay`-kind baseline. Phase B then rides the EXISTING headless
 * machinery verbatim (`runHeadlessReconcile` with this baseline as the
 * source), because the target replay pairs on {method, path, scenario_name}
 * and only rejects `kind='target'` sources.
 *
 * The corpus supplies REQUESTS ONLY — the live current system at S0 is the
 * oracle; the logged status was a diagnostic and is not consulted here.
 *
 * State discipline: mutating corpus items replay inside compensation
 * brackets (CSD Specs 1/3) when current-DB credentials ride the request —
 * fail-closed refusals for unmapped endpoints, residue HALTS the run with
 * the guided-restore message, and the end-of-job S0 fingerprint proves the
 * DB is still S0. Without DB credentials, mutating items are SKIPPED loudly
 * (never fired uncompensated — stricter than the interactive wizard because
 * this runner is fully unattended).
 *
 * Deterministic identity: one operation row per distinct (method, template)
 * keyed `log:<METHOD> <template>`; one `manual`-type scenario per corpus
 * item named `log:<n>:<hash>` — the round-2 pairing key.
 */

import * as crypto from 'crypto';

import { archModelClient as defaultArchModelClient } from './archModelClient';
import type {
  BaselineDto,
  CaptureSessionDto,
  OperationDto,
} from './archModelClient';
import { createSessionHttpExecutor, type SessionHttpExecutor } from './httpExecutor';
import { createDbAdapter } from './db/dbAdapterFactory';
import type { DbAdapter } from './db/DbAdapter';
import type { DbConnectionConfig } from '../types/db';
import type { ApiAuthSecret } from '../types/secrets';
import { redactHeaders, redactJson, redactUrl } from './redactor';
import { normaliseBodyForAms } from './amsBodyEnvelope';
import {
  buildCaptureCompensationContext,
  createCompensationWriteAdapter,
  runEndOfJobFingerprint,
  COMPENSATED_VERBS,
  type CaptureCompensationContext,
} from './captureCompensation';
import { runCompensationBracket } from './compensation/compensationRunner';
import { fetchCompensationMetadataIndex } from './compensation/compensationMetadata';
import { effectTablesFor, fetchEffectScopeIndex } from './stateDelta';
import { createTracer } from '../trace';

const trace = createTracer('capture-svc');

export interface LogReplayCorpusItemInput {
  method: string;
  path_template: string;
  concrete_path: string;
  request_json: {
    query?: Record<string, unknown>;
    headers?: Record<string, string>;
    body?: unknown;
  } | null;
  occurrence_count: number;
}

export interface LogReplayRunArgs {
  projectId: string;
  architectureId: string;
  corpusId: string;
  items: LogReplayCorpusItemInput[];
  currentApi: {
    baseUrl: string;
    auth: ApiAuthSecret;
    defaultHeaders?: Record<string, string> | null;
  };
  /** OPTIONAL current-DB creds — activates compensation brackets. */
  currentDb?: DbConnectionConfig | null;
  perItemTimeoutMs?: number;
  deps?: {
    archModelClient?: typeof defaultArchModelClient;
    createHttpExecutor?: typeof createSessionHttpExecutor;
    createDbAdapterFn?: typeof createDbAdapter;
    compensationSeams?: {
      metadataFetcher?: typeof fetchCompensationMetadataIndex;
      effectScopeFetcher?: typeof fetchEffectScopeIndex;
      writeAdapterFactory?: typeof createCompensationWriteAdapter;
    };
  };
}

export interface LogReplayRunOutcome {
  sessionId: string | null;
  baselineId: string | null;
  itemsTotal: number;
  itemsReplayed: number;
  itemsSkipped: number;
  itemsFailed: number;
  finalStatus: 'completed' | 'failed';
  errorMessage: string | null;
}

function scenarioNameFor(index: number, item: LogReplayCorpusItemInput): string {
  const hash = crypto
    .createHash('sha256')
    .update(`${item.method}|${item.concrete_path}`)
    .digest('hex')
    .slice(0, 8);
  return `log:${index}:${hash}`;
}

export async function runLogReplayCurrentCapture(
  args: LogReplayRunArgs,
): Promise<LogReplayRunOutcome> {
  const archModelClient = args.deps?.archModelClient ?? defaultArchModelClient;
  const httpFactory = args.deps?.createHttpExecutor ?? createSessionHttpExecutor;
  const dbFactory = args.deps?.createDbAdapterFn ?? createDbAdapter;

  let itemsReplayed = 0;
  let itemsSkipped = 0;
  let itemsFailed = 0;
  let session: CaptureSessionDto | null = null;
  let baseline: BaselineDto | null = null;
  let executor: SessionHttpExecutor | null = null;
  let dbAdapter: DbAdapter | null = null;
  let compensation: CaptureCompensationContext | null = null;

  const fail = async (message: string): Promise<LogReplayRunOutcome> => {
    if (session) {
      try {
        await archModelClient.patchCaptureSession(args.projectId, session.id, {
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: message,
        });
      } catch {
        /* best-effort terminal patch */
      }
    }
    trace.fail(`log-replay round 2 (current side) FAILED — ${message}`, {
      project: args.projectId,
      arch: args.architectureId,
    });
    return {
      sessionId: session?.id ?? null,
      baselineId: baseline?.id ?? null,
      itemsTotal: args.items.length,
      itemsReplayed,
      itemsSkipped,
      itemsFailed,
      finalStatus: 'failed',
      errorMessage: message,
    };
  };

  try {
    // ---- 1) Session + baseline scaffolding --------------------------------
    session = await archModelClient.createCaptureSession(args.projectId, {
      project_id: args.projectId,
      architecture_id: args.architectureId,
      name: `log-replay round 2 (${args.corpusId.slice(0, 8)})`,
      env_name: 'log-replay',
      api_base_url: args.currentApi.baseUrl,
      auth_type: args.currentApi.auth.type,
      default_headers_redacted_json: args.currentApi.defaultHeaders ?? null,
      // Mutating corpus items replay ONLY inside brackets; the flag mirrors
      // that intent for the state-delta hooks.
      mutating_calls_confirmed: !!args.currentDb,
      kind: 'current',
    });
    await archModelClient.patchCaptureSession(args.projectId, session.id, {
      status: 'running',
    });

    executor = httpFactory({
      auth: args.currentApi.auth,
      baseURL: args.currentApi.baseUrl,
      timeoutMs: args.perItemTimeoutMs ?? 30_000,
      defaultHeaders: args.currentApi.defaultHeaders ?? {},
    });

    if (args.currentDb) {
      dbAdapter = dbFactory(args.currentDb);
      const built = await buildCaptureCompensationContext({
        projectId: args.projectId,
        architectureId: args.architectureId,
        writeConfig: args.currentDb,
        readAdapter: dbAdapter,
        metadataFetcher: args.deps?.compensationSeams?.metadataFetcher,
        effectScopeFetcher: args.deps?.compensationSeams?.effectScopeFetcher,
        writeAdapterFactory: args.deps?.compensationSeams?.writeAdapterFactory,
      });
      compensation = built.context;
    }

    // ---- 2) One operation row per distinct (method, template) ------------
    const operationByKey = new Map<string, OperationDto>();
    for (const item of args.items) {
      const key = `${item.method.toUpperCase()} ${item.path_template}`;
      if (operationByKey.has(key)) continue;
      const isMutating = COMPENSATED_VERBS.has(item.method.toLowerCase());
      const operation = await archModelClient.createOperation(args.projectId, {
        session_id: session.id,
        operation_id: `log:${key}`,
        method: item.method.toUpperCase(),
        path: item.path_template,
        summary: 'log-replay corpus operation',
        included: true,
        safe_to_execute: !isMutating,
        oas_operation_json: { operationId: `log:${key}` },
      });
      operationByKey.set(key, operation);
    }

    baseline = await archModelClient.createBaseline(args.projectId, {
      project_id: args.projectId,
      architecture_id: args.architectureId,
      session_id: session.id,
      name: `log-replay round 2 (${args.corpusId.slice(0, 8)})`,
      status: 'draft',
      accepted_capture_count: 0,
      operation_count: operationByKey.size,
      notes: `corpus ${args.corpusId}`,
      kind: 'log_replay',
      paired_with_baseline_id: null,
    });

    // ---- 3) Replay every corpus item --------------------------------------
    for (let i = 0; i < args.items.length; i++) {
      const item = args.items[i];
      const key = `${item.method.toUpperCase()} ${item.path_template}`;
      const operation = operationByKey.get(key) as OperationDto;
      const isMutating = COMPENSATED_VERBS.has(item.method.toLowerCase());
      const scenarioName = scenarioNameFor(i, item);

      if (isMutating && !compensation) {
        // Unattended runner: NEVER fire an uncompensated write. Stricter
        // than the wizard (which at least has an operator watching).
        itemsSkipped += 1;
        trace.detail(
          'log_replay.skip_uncompensated_mutation',
          { op: key, scenario: scenarioName },
          { project: args.projectId, arch: args.architectureId, session: session.id },
        );
        continue;
      }

      const scenario = await archModelClient.createScenario(args.projectId, {
        session_id: session.id,
        operation_id: operation.id,
        scenario_name: scenarioName,
        scenario_type: 'manual',
        status: 'draft',
        generation_source: 'manual',
        request_method: item.method.toUpperCase(),
        request_path: item.path_template,
      });

      const pathOnly = item.concrete_path.split('?')[0];
      const query = (item.request_json?.query ?? undefined) as
        | Record<string, unknown>
        | undefined;
      const headers = item.request_json?.headers ?? undefined;
      const body = item.request_json?.body;

      const fireItem = async () => {
        const startedAt = Date.now();
        const response = await (executor as SessionHttpExecutor).request({
          method: item.method.toUpperCase() as never,
          url: pathOnly,
          params: query,
          headers,
          data: body,
        });
        return { response, durationMs: Date.now() - startedAt };
      };

      try {
        let fired: Awaited<ReturnType<typeof fireItem>>;
        if (isMutating && compensation) {
          const tables = effectTablesFor(
            compensation.effectScope,
            item.method,
            item.path_template,
          );
          if (tables.length === 0) {
            itemsSkipped += 1;
            trace.detail(
              'log_replay.compensation_refused',
              { op: key, scenario: scenarioName, reason: 'no_effect_map' },
              { project: args.projectId, arch: args.architectureId, session: session.id },
            );
            continue;
          }
          const bracket = await runCompensationBracket({
            readAdapter: compensation.readAdapter,
            writeAdapter: compensation.writeAdapter,
            engine: compensation.engine,
            schema: compensation.schema,
            tables,
            metadata: compensation.metadata,
            fire: fireItem,
          });
          if (bracket.outcome.kind === 'refused') {
            itemsSkipped += 1;
            continue;
          }
          if (bracket.outcome.kind === 'residue') {
            return await fail(
              `S0 residue while replaying '${scenarioName}' on ${key} — the current DB ` +
                'is NO LONGER S0. Restore via POST /api/s0-snapshot/restore, then re-run.',
            );
          }
          if (bracket.fireError) throw bracket.fireError;
          fired = bracket.fireResult as Awaited<ReturnType<typeof fireItem>>;
        } else {
          fired = await fireItem();
        }

        const { response, durationMs } = fired;
        const capture = await archModelClient.createCapture(args.projectId, {
          session_id: session.id,
          scenario_id: scenario.id,
          operation_id: operation.id,
          attempt_number: 1,
          request_method: item.method.toUpperCase(),
          request_path: pathOnly,
          request_url_redacted: redactUrl(
            `${args.currentApi.baseUrl.replace(/\/+$/, '')}${
              pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`
            }`,
          ),
          request_query_json: query ? (redactJson(query) as Record<string, unknown>) : null,
          request_headers_redacted_json: headers
            ? (Object.fromEntries(
                Object.entries(redactHeaders(headers)).map(([k, v]) => [
                  k,
                  Array.isArray(v) ? v.join(', ') : String(v ?? ''),
                ]),
              ) as Record<string, string>)
            : null,
          request_body_json: normaliseBodyForAms(body),
          response_status: response.status,
          response_headers_redacted_json:
            response.headers && typeof response.headers === 'object'
              ? (Object.fromEntries(
                  Object.entries(response.headers).map(([k, v]) => [
                    k,
                    Array.isArray(v) ? v.join(', ') : String(v ?? ''),
                  ]),
                ) as Record<string, string>)
              : null,
          response_body_json: normaliseBodyForAms(response.data),
          duration_ms: durationMs,
          error_type: null,
          error_message: null,
          captured_at: new Date().toISOString(),
        });
        await archModelClient.patchCapture(args.projectId, capture.id, {
          accepted: true,
          accepted_at: new Date().toISOString(),
        });
        await archModelClient.createBaselineItem(args.projectId, {
          baseline_id: baseline.id,
          capture_id: capture.id,
          operation_id: operation.id,
          scenario_id: scenario.id,
          method: item.method.toUpperCase(),
          path: item.path_template,
          scenario_name: scenarioName,
          request_json: {
            query: query ?? null,
            headers: headers ?? null,
            body: body ?? null,
          },
          response_status: response.status,
          response_json: {
            headers: capture.response_headers_redacted_json,
            body: capture.response_body_json,
          },
          business_notes: `log-replay corpus item (${item.occurrence_count} logged occurrence(s))`,
        });
        itemsReplayed += 1;
      } catch (err) {
        itemsFailed += 1;
        trace.detail(
          'log_replay.item_failed',
          {
            op: key,
            scenario: scenarioName,
            error: err instanceof Error ? err.message : String(err),
          },
          { project: args.projectId, arch: args.architectureId, session: session.id },
        );
      }
    }

    // ---- 4) End-of-job S0 fingerprint (when the discipline is active) -----
    if (compensation) {
      const fingerprint = await runEndOfJobFingerprint({
        projectId: args.projectId,
        architectureId: args.architectureId,
        readAdapter: compensation.readAdapter,
        metadata: compensation.metadata,
        schema: compensation.schema,
      });
      if (fingerprint.status === 'mismatch') {
        return await fail(
          `end-of-job S0 fingerprint MISMATCH vs snapshot ${fingerprint.snapshotId}: ` +
            (fingerprint.detail ?? 'tables diverged'),
        );
      }
    }

    // ---- 5) Finalise -------------------------------------------------------
    await archModelClient.patchBaseline(args.projectId, baseline.id, {
      status: 'active',
      accepted_capture_count: itemsReplayed,
      operation_count: operationByKey.size,
    });
    await archModelClient.patchCaptureSession(args.projectId, session.id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      error_message: null,
      scenarios_attempted: args.items.length,
      scenarios_completed: itemsReplayed,
      scenarios_errored: itemsFailed + itemsSkipped,
    });
    trace.ok(
      `log-replay round 2 (current side) — ${itemsReplayed}/${args.items.length} replayed, ` +
        `${itemsSkipped} skipped, ${itemsFailed} failed`,
      { project: args.projectId, arch: args.architectureId, session: session.id },
    );

    return {
      sessionId: session.id,
      baselineId: baseline.id,
      itemsTotal: args.items.length,
      itemsReplayed,
      itemsSkipped,
      itemsFailed,
      finalStatus: 'completed',
      errorMessage: null,
    };
  } catch (err) {
    return await fail(err instanceof Error ? err.message : String(err));
  } finally {
    if (executor) {
      try {
        executor.dispose();
      } catch {
        /* pool teardown */
      }
    }
    if (dbAdapter) {
      try {
        await dbAdapter.dispose();
      } catch {
        /* pool teardown */
      }
    }
    if (compensation) {
      try {
        await compensation.writeAdapter.dispose();
      } catch {
        /* pool teardown */
      }
    }
  }
}
