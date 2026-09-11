import { Router, Request, Response } from 'express';
import { archModelClient as defaultArchModelClient } from '../services/archModelClient';
import type { CaptureSessionDto } from '../services/archModelClient';
import { secretsStore } from '../services/secretsStore';
import { runManager } from '../services/runManager';
import { createSessionHttpExecutor } from '../services/httpExecutor';
import {
  runTargetReplay as defaultRunTargetReplay,
  type TargetReplayDeps,
  type TargetReplayOutcome,
} from '../services/targetReplayRunner';
import type { ApiAuthSecret, SecretsBundle } from '../types/secrets';
import { parseEndpointScopeKeys } from '../services/endpointScope';
import { createDbAdapter } from '../services/db/dbAdapterFactory';
import { isDbType } from '../types/db';

/**
 * Target-side capture-session action endpoints. Mounted under the same
 * `/api-migration-validation` router as the current-state action endpoints
 * but kept on a SEPARATE route surface (per accepted Q8 -- different
 * payload schemas, clearer discriminator-to-route mapping).
 *
 * Spec: 2026-05-25 API Test Harness -- Target-Side Capture -- Task Group 3.
 *
 * Routes (mounted at `/api-migration-validation/api/target-capture-sessions/...`):
 *
 *   - `POST /target-capture-sessions`           -- create a target session
 *                                                  (server sets `kind='target'`)
 *   - `POST /target-capture-sessions/:id/secrets`            -- load target-side
 *                                                  auth into the in-memory
 *                                                  secretsStore (NEVER hits AMS)
 *   - `POST /target-capture-sessions/:id/test-connection`    -- one redacted
 *                                                  probe against the target URL
 *   - `POST /target-capture-sessions/:id/start`              -- fire-and-forget
 *                                                  the replay runner, returns
 *                                                  202 with the running session
 *   - `POST /target-capture-sessions/:id/cancel`             -- cancel the
 *                                                  in-flight replay
 *   - `GET  /target-capture-sessions/:id/status`             -- polling endpoint
 *
 * Reuses the same `:projectId` URL safety convention as the current-state
 * action endpoints -- projectId arrives as a query string param on every
 * authenticated route. The gateway proxy is responsible for moving it from
 * its URL path into the query string before forwarding.
 *
 * Reuses `runManager`, `secretsStore`, `httpExecutor` UNCHANGED. The
 * `/start` route dispatches to {@link runTargetReplay} (NOT
 * `orchestrateCaptureSession`) -- the discriminator is the route, the
 * runner is the implementation; both align with the session's
 * `kind='target'`.
 */

export interface TargetCaptureSessionActionsDeps {
  archModelClient?: typeof defaultArchModelClient;
  /**
   * Override for the replay runner spawn. Tests inject a stub to assert
   * /start fires the runner without actually executing it.
   */
  spawnRunner?: (
    sessionId: string,
    deps?: TargetReplayDeps,
  ) => Promise<TargetReplayOutcome>;
  /**
   * Optional probe override for `/test-connection`. Tests inject a fake to
   * avoid a real network call.
   */
  probeApiConnection?: (args: {
    baseUrl: string;
    auth: ApiAuthSecret;
    defaultHeaders: Record<string, string>;
  }) => Promise<{ status: number; durationMs: number }>;
  /**
   * Optional DB-adapter factory override (Spec 2026-07-06-n, Tier-1 batch).
   * Tests inject a fake so /start can be pinned without a real pool.
   */
  createDbAdapter?: typeof createDbAdapter;
}

function extractProjectId(req: Request): string | null {
  const fromQuery = req.query.projectId;
  if (typeof fromQuery === 'string' && fromQuery.length > 0) return fromQuery;
  const fromBody = (req.body as Record<string, unknown> | undefined)?.projectId;
  if (typeof fromBody === 'string' && fromBody.length > 0) return fromBody;
  return null;
}

function fail(
  res: Response,
  status: number,
  message: string,
  extra?: Record<string, unknown>,
): void {
  res.status(status).json({
    error: { code: status, message, ...(extra || {}) },
  });
}

/**
 * Body for `POST /target-capture-sessions`.
 *
 * `projectId` may travel via the query string OR the body field; either
 * is accepted. `sourceBaselineId` is the FK at the current-state baseline
 * being replayed; AMS service-layer validation enforces it MUST be a
 * `kind='current'` baseline in the same project + architecture.
 */
interface CreateTargetSessionBody {
  projectId?: string;
  architectureId: string;
  name?: string | null;
  sourceBaselineId: string;
  targetApiBaseUrl: string;
  authType?: string | null;
  authConfigRedactedJson?: Record<string, unknown> | null;
  defaultHeadersRedactedJson?: Record<string, string> | null;
  mutatingCallsConfirmed?: boolean;
  /**
   * OPTIONAL target-database connection CONFIG (Spec 2026-07-06-n, Tier-1
   * batch): `{ dbType: 'postgres'|'sybase', host, port, database, schema?,
   * username }` — persisted redacted on the session row exactly like the
   * current-side capture sessions. The PASSWORD never travels here; it rides
   * the in-memory /secrets bundle. When both are present the replay runner
   * snapshots effect tables around mutating replays so target items carry
   * `state_delta_json`.
   */
  dbConfigRedactedJson?: Record<string, unknown> | null;
}

/**
 * Polling status response shape for `GET /target-capture-sessions/:id/status`.
 * In v1 the per-item counters are sourced directly from the session row's
 * status field plus a best-effort scan of recent diagnostics. A future
 * iteration may add per-session counters on the AMS session row itself.
 */
interface TargetReplayStatusResponse {
  sessionId: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  isLiveInRunManager: boolean;
  lastDiagnosticMessage: string | null;
}

export function buildTargetCaptureSessionActionsRouter(
  deps: TargetCaptureSessionActionsDeps = {},
): Router {
  const router = Router({ mergeParams: true });
  const archModelClient = deps.archModelClient ?? defaultArchModelClient;
  const spawnRunner = deps.spawnRunner ?? defaultRunTargetReplay;

  // ----------------------------------------------------------------------
  // POST /api/target-capture-sessions
  // ----------------------------------------------------------------------
  router.post(
    '/api/target-capture-sessions',
    async (req: Request, res: Response) => {
      const projectId = extractProjectId(req);
      if (!projectId) {
        return fail(
          res,
          400,
          'projectId is required (query param or body field)',
        );
      }
      const body = (req.body || {}) as CreateTargetSessionBody;
      if (!body.architectureId) {
        return fail(res, 400, 'architectureId is required');
      }
      if (!body.sourceBaselineId) {
        return fail(res, 400, 'sourceBaselineId is required');
      }
      if (!body.targetApiBaseUrl) {
        return fail(res, 400, 'targetApiBaseUrl is required');
      }

      try {
        const session = await archModelClient.createCaptureSession(projectId, {
          project_id: projectId,
          architecture_id: body.architectureId,
          name: body.name ?? null,
          env_name: null,
          api_base_url: body.targetApiBaseUrl,
          auth_type: body.authType ?? null,
          auth_config_redacted_json: body.authConfigRedactedJson ?? null,
          default_headers_redacted_json: body.defaultHeadersRedactedJson ?? null,
          oas_spec_refs_json: null,
          db_config_redacted_json: body.dbConfigRedactedJson ?? null,
          mutating_calls_confirmed: body.mutatingCallsConfirmed === true,
          kind: 'target',
          source_baseline_id: body.sourceBaselineId,
        });
        return res.status(201).json(session);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'create target-capture-session failed';
        return fail(res, 502, message);
      }
    },
  );

  // ----------------------------------------------------------------------
  // POST /api/target-capture-sessions/:id/secrets
  // ----------------------------------------------------------------------
  // Mirrors the current-state route. NEVER writes to AMS -- only populates
  // the in-memory secretsStore for the session id. The route handler in
  // /start refuses to fire the runner unless this has been called.
  router.post(
    '/api/target-capture-sessions/:id/secrets',
    (req: Request, res: Response) => {
      const sessionId = req.params.id;
      const body = (req.body || {}) as Partial<{
        api: ApiAuthSecret;
        db: { password?: unknown };
      }>;
      if (!body.api || typeof body.api !== 'object' || typeof body.api.type !== 'string') {
        return fail(res, 400, 'secrets body must include { api: { type, ... } }');
      }
      const validTypes: Array<ApiAuthSecret['type']> = [
        'none',
        'bearer',
        'api_key_header',
        'api_key_query',
        'basic',
        'custom_header',
      ];
      if (!validTypes.includes(body.api.type)) {
        return fail(res, 400, `Invalid auth type: ${String(body.api.type)}`);
      }
      // Spec 2026-07-06-n (Tier-1 batch): OPTIONAL target-DB password —
      // in-memory only, mirroring the current-side capture bundle. The
      // connection CONFIG lives on the session row; the password ONLY here.
      const dbPassword =
        body.db && typeof body.db === 'object' && typeof body.db.password === 'string'
          ? body.db.password
          : null;
      const bundle: SecretsBundle = {
        sessionId,
        api: body.api,
        ...(dbPassword !== null ? { db: { password: dbPassword } } : {}),
        loadedAt: Date.now(),
      };
      secretsStore.set(bundle);
      return res.status(200).json({ sessionId, loaded: true, dbLoaded: dbPassword !== null });
    },
  );

  // ----------------------------------------------------------------------
  // POST /api/target-capture-sessions/:id/test-connection
  // ----------------------------------------------------------------------
  router.post(
    '/api/target-capture-sessions/:id/test-connection',
    async (req: Request, res: Response) => {
      const sessionId = req.params.id;
      const projectId = extractProjectId(req);
      if (!projectId) {
        return fail(res, 400, 'projectId is required (query param or body field)');
      }
      try {
        const session = await archModelClient.getCaptureSession(projectId, sessionId);
        if (session.kind !== 'target') {
          return fail(
            res,
            400,
            `Session ${sessionId} is not a target session (kind='${session.kind ?? 'current'}')`,
            { currentKind: session.kind ?? 'current' },
          );
        }
        const secrets = secretsStore.get(sessionId);
        if (!secrets) {
          return fail(
            res,
            409,
            'Secrets not loaded for this session. Submit /secrets before testing.',
            { code: 'SECRETS_NOT_LOADED' },
          );
        }
        if (!session.api_base_url) {
          return fail(res, 400, 'Session has no api_base_url configured.');
        }

        const probe =
          deps.probeApiConnection ??
          (async (args) => {
            const exec = createSessionHttpExecutor({
              auth: args.auth,
              baseURL: args.baseUrl,
              timeoutMs: 10_000,
              defaultHeaders: args.defaultHeaders,
            });
            const t0 = Date.now();
            try {
              const resp = await exec.request({ method: 'GET', url: '/' });
              return { status: resp.status, durationMs: Date.now() - t0 };
            } finally {
              exec.dispose();
            }
          });

        const result = await probe({
          baseUrl: session.api_base_url,
          auth: secrets.api,
          defaultHeaders: session.default_headers_redacted_json ?? {},
        });

        return res.status(200).json({
          sessionId,
          success: result.status >= 200 && result.status < 500,
          status: result.status,
          durationMs: result.durationMs,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'test-connection failed';
        return fail(res, 502, message);
      }
    },
  );

  // ----------------------------------------------------------------------
  // POST /api/target-capture-sessions/:id/start
  // ----------------------------------------------------------------------
  router.post(
    '/api/target-capture-sessions/:id/start',
    async (req: Request, res: Response) => {
      const sessionId = req.params.id;
      const projectId = extractProjectId(req);
      if (!projectId) {
        return fail(res, 400, 'projectId is required (query param or body field)');
      }
      try {
        const session = await archModelClient.getCaptureSession(projectId, sessionId);
        if (session.kind !== 'target') {
          return fail(
            res,
            400,
            `Session ${sessionId} is not a target session ` +
              `(kind='${session.kind ?? 'current'}'). ` +
              `Use POST /capture-sessions/${sessionId}/start instead.`,
            { currentKind: session.kind ?? 'current' },
          );
        }
        if (session.status === 'running') {
          return fail(
            res,
            409,
            `Session ${sessionId} is already running.`,
            { currentStatus: session.status },
          );
        }
        if (
          session.status !== 'draft' &&
          session.status !== 'configured'
        ) {
          return fail(
            res,
            409,
            `Cannot start session in status '${session.status}'.`,
            { currentStatus: session.status },
          );
        }

        // ---- Post-capture restore GATE (Item #6, 2026-08-27). The capture
        // and the migration/reconciliation share the UAT environment: if the
        // capture left the source drifted, replaying compares the migrated
        // target against a baseline from a DIFFERENT state — silent false ID
        // breaks. The gate requires an s0_restore_recorded receipt on the
        // SOURCE capture session dated after its completion. Never a dead
        // button (standing staleness-is-a-signal ruling): the caller may
        // proceed with confirm_no_restore: true, and that override is itself
        // recorded on THIS replay session. The gate CHECK is fail-soft — an
        // AMS hiccup logs and proceeds rather than blocking on infra.
        try {
          const sourceBaseline = await archModelClient.getBaseline(
            projectId,
            session.source_baseline_id as string,
          );
          const sourceSessionId = sourceBaseline.session_id;
          if (sourceSessionId) {
            const sourceSession = await archModelClient.getCaptureSession(
              projectId,
              sourceSessionId,
            );
            const diags = await archModelClient.listDiagnosticsBySession(
              projectId,
              sourceSessionId,
            );
            const completedAt = sourceSession.completed_at ?? null;
            const restoreRecorded = diags.some(
              (d) =>
                d.diagnostic_type === 's0_restore_recorded' &&
                (d.detail_json as { proceeded_without_restore?: boolean } | null)
                  ?.proceeded_without_restore !== true &&
                (!completedAt || (d.created_at ?? '') >= completedAt),
            );
            if (!restoreRecorded && (req.body ?? {}).confirm_no_restore !== true) {
              return fail(
                res,
                409,
                'No post-capture S0 restore is recorded for the source capture ' +
                  'session. Reconciling against a source left drifted by the ' +
                  'capture produces FALSE ID breaks across the whole run. ' +
                  'Restore S0 from the source session screen first, or resend ' +
                  'with confirm_no_restore: true to proceed anyway (the override ' +
                  'is recorded on the replay session).',
                { gate: 'post_capture_restore_required', sourceSessionId },
              );
            }
            if (!restoreRecorded) {
              try {
                await archModelClient.createDiagnostic(projectId, {
                  session_id: sessionId,
                  diagnostic_type: 's0_restore_recorded',
                  message:
                    'OVERRIDE: operator started reconciliation WITHOUT a recorded ' +
                    'post-capture S0 restore on the source session — ID drift in ' +
                    'the diff may be a run artefact, not a migration defect.',
                  detail_json: {
                    proceeded_without_restore: true,
                    source_session_id: sourceSessionId,
                  },
                });
              } catch {
                // best-effort override receipt
              }
            }
          }
        } catch (gateErr) {
          // eslint-disable-next-line no-console
          console.warn(
            '[targetCaptureSessionActions] restore-gate check failed (proceeding):',
            gateErr instanceof Error ? gateErr.message : String(gateErr),
          );
        }
        if (!secretsStore.has(sessionId)) {
          return fail(
            res,
            409,
            'Secrets not loaded for this session. Submit /secrets before /start.',
            { code: 'SECRETS_NOT_LOADED' },
          );
        }

        // AMS's session state machine only allows draft -> configured ->
        // running. A target session created by this flow carries its FULL
        // config from the create body and its secrets were verified loaded
        // above (that IS the 'configured' semantic), so hop through
        // 'configured' first — PATCHing draft -> running directly is a 409
        // Conflict that killed every headless reconcile started from a
        // fresh session (shakedown 2026-08-17).
        if (session.status === 'draft') {
          await archModelClient.patchCaptureSession(projectId, sessionId, {
            status: 'configured',
          });
        }
        // Transition to 'running' BEFORE registering the live runManager
        // entry so a concurrent /start hits the 409 guard above.
        const running = await archModelClient.patchCaptureSession(
          projectId,
          sessionId,
          {
            status: 'running',
            started_at: new Date().toISOString(),
            error_message: null,
          },
        );
        // Register the live run so cancel() can signal abort to in-flight
        // http calls. End() is called by the runner's finally block.
        if (!runManager.has(sessionId)) {
          runManager.start({
            sessionId,
            projectId,
            architectureId: session.architecture_id,
          });
        }
        // Spec 2026-07-06-i: OPTIONAL scoped replay. `endpointScope` is a
        // list of "METHOD /path/template" keys; `purpose` tags the run on
        // the diff's audit blob ('parity' | 'drift_check'). Both are
        // RUN-TIME args (never persisted on the session); the resulting
        // diff row carries them via endpoint_scope_json so a scoped-clean
        // diff never masquerades as full-surface-clean. Absent = full
        // replay, byte-identical to today.
        const startBody = (req.body || {}) as {
          endpointScope?: unknown;
          purpose?: unknown;
        };
        const endpointScope = parseEndpointScopeKeys(startBody.endpointScope);
        const scopePurpose =
          typeof startBody.purpose === 'string' && startBody.purpose.length > 0
            ? startBody.purpose
            : null;

        // Spec 2026-07-06-n (Tier-1 batch): build the TARGET-DB adapter when
        // the session row carries the connection config AND the in-memory
        // bundle carries the password — the exact guard idiom of the
        // current-side orchestrator (a malformed/absent config degrades to
        // "no state snapshots", never a throw; deltas stay null =>
        // state_unverified, fail-closed and visible). The route OWNS the
        // adapter lifecycle: disposed when the spawned run settles.
        const targetDbConfig = (() => {
          const cfg = session.db_config_redacted_json as {
            dbType?: string;
            host?: string;
            port?: number;
            database?: string;
            schema?: string | null;
            username?: string;
          } | null;
          const dbSecret = secretsStore.get(sessionId)?.db;
          if (!cfg || !cfg.host || !cfg.port || !cfg.database || !cfg.username) return null;
          if (!dbSecret?.password) return null;
          if (!isDbType(cfg.dbType)) return null;
          return {
            dbType: cfg.dbType,
            host: cfg.host,
            port: cfg.port,
            database: cfg.database,
            schema: cfg.schema ?? null,
            username: cfg.username,
            password: dbSecret.password,
          };
        })();
        const dbAdapter = targetDbConfig
          ? (deps.createDbAdapter ?? createDbAdapter)(targetDbConfig)
          : null;

        const runnerDeps: TargetReplayDeps | undefined =
          endpointScope || scopePurpose || dbAdapter
            ? {
                endpointScope,
                scopePurpose,
                dbAdapter,
                // CSD Spec 4: full connection config (password included)
                // activates the target-side compensation brackets.
                targetDbConfig,
              }
            : undefined;

        // Fire-and-forget the runner. Per-run errors land as `failed`
        // session patches inside the runner itself; the DB adapter (route-
        // owned) is disposed when the run settles either way.
        spawnRunner(sessionId, runnerDeps)
          .catch((err) => {
            console.error(
              `[targetCaptureSessionActions] runTargetReplay failed for ${sessionId}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          })
          .finally(() => {
            if (dbAdapter) {
              dbAdapter.dispose().catch(() => {
                /* pool teardown errors don't matter */
              });
            }
          });

        return res.status(202).json({ ...running, runId: sessionId });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'start failed';
        return fail(res, 500, message);
      }
    },
  );

  // ----------------------------------------------------------------------
  // POST /api/target-capture-sessions/:id/cancel
  // ----------------------------------------------------------------------
  router.post(
    '/api/target-capture-sessions/:id/cancel',
    async (req: Request, res: Response) => {
      const sessionId = req.params.id;
      const projectId = extractProjectId(req);
      if (!projectId) {
        return fail(res, 400, 'projectId is required (query param or body field)');
      }
      try {
        const session = await archModelClient.getCaptureSession(
          projectId,
          sessionId,
        );
        if (session.kind !== 'target') {
          return fail(
            res,
            400,
            `Session ${sessionId} is not a target session`,
            { currentKind: session.kind ?? 'current' },
          );
        }
        if (
          session.status !== 'configured' &&
          session.status !== 'running' &&
          session.status !== 'draft'
        ) {
          return fail(
            res,
            409,
            `Cannot cancel session in status '${session.status}'.`,
            { currentStatus: session.status },
          );
        }
        // Signal abort to any in-flight http calls before patching.
        runManager.cancel(sessionId);
        // Drop secrets immediately -- no resume path on cancel.
        secretsStore.purge(sessionId);
        const cancelled = await archModelClient.patchCaptureSession(
          projectId,
          sessionId,
          {
            status: 'cancelled',
            completed_at: new Date().toISOString(),
          },
        );
        return res.status(200).json(cancelled);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'cancel failed';
        return fail(res, 500, message);
      }
    },
  );

  // ----------------------------------------------------------------------
  // GET /api/target-capture-sessions/:id/status
  // ----------------------------------------------------------------------
  router.get(
    '/api/target-capture-sessions/:id/status',
    async (req: Request, res: Response) => {
      const sessionId = req.params.id;
      const projectId = extractProjectId(req);
      if (!projectId) {
        return fail(res, 400, 'projectId is required (query param or body field)');
      }
      try {
        const session: CaptureSessionDto =
          await archModelClient.getCaptureSession(projectId, sessionId);
        const out: TargetReplayStatusResponse = {
          sessionId,
          status: session.status,
          startedAt: session.started_at,
          completedAt: session.completed_at,
          errorMessage: session.error_message,
          isLiveInRunManager: runManager.has(sessionId),
          lastDiagnosticMessage: null,
        };
        return res.status(200).json(out);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'status fetch failed';
        return fail(res, 502, message);
      }
    },
  );

  return router;
}

export const targetCaptureSessionActionsRouter =
  buildTargetCaptureSessionActionsRouter();
