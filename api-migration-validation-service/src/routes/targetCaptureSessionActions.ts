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
          db_config_redacted_json: null,
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
      const bundle: SecretsBundle = {
        sessionId,
        api: body.api,
        loadedAt: Date.now(),
      };
      secretsStore.set(bundle);
      return res.status(200).json({ sessionId, loaded: true });
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
        if (!secretsStore.has(sessionId)) {
          return fail(
            res,
            409,
            'Secrets not loaded for this session. Submit /secrets before /start.',
            { code: 'SECRETS_NOT_LOADED' },
          );
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
        // Fire-and-forget the runner. Per-run errors land as `failed`
        // session patches inside the runner itself.
        spawnRunner(sessionId).catch((err) => {
          console.error(
            `[targetCaptureSessionActions] runTargetReplay failed for ${sessionId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
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
