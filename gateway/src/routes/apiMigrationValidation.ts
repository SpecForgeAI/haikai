/**
 * API Migration Validation Route
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 3
 *
 * Provides two surfaces for the API Behaviour Baseline Capture feature:
 *
 *   (1) AMS-direct CRUD proxies for the seven `api_behaviour_*` resources.
 *       Mounted at `/api/v1/projects/:projectId/architectures/:architectureId/
 *       api-behaviour/...`. Each route enforces the project + architecture URL
 *       safety property the rest of the system relies on -- the
 *       `:architectureId` segment is required, omitting it 404s at the Express
 *       layer (no fallback resolution).  Downstream URLs to the
 *       architecture-model-service drop the `architectures/:architectureId/`
 *       segment (AMS list endpoints take `architectureId` as a query param;
 *       id-scoped endpoints don't need it at all -- AMS validates project
 *       ownership separately).
 *
 *   (2) `POST /api/v1/api-migration-validation/llm-tool-loop` -- a thin
 *       single-round-trip relay through the existing `llmClient.ts` provider
 *       abstraction (OpenAI / Azure OpenAI). The new
 *       `api-migration-validation-service` (port 8092) drives the per-scenario
 *       loop, the round counter, and tool execution; this gateway endpoint
 *       only marshals one provider call per request.
 *
 *       NOTE: this is intentionally NOT routed through
 *       `gateway/src/services/toolExecutor.ts`. That executor is bound to the
 *       MCP/hub tool lifecycle and would couple this server-side tool-call
 *       loop to that lifecycle, which the spec explicitly forbids.
 *
 * Action endpoints on the new service (`/parse-oas`, `/test-api-connection`,
 * `/test-db-connection`, `/start`, `/cancel`, `/secrets`,
 * `/extract-endpoints`) get their gateway proxies registered below.
 * `/extract-endpoints` was added by the 2026-05-17 SOAP LLM Extraction
 * Phase 2 spec, Task Group 6, for the Workstream A "Extract endpoints with
 * LLM" Step 4 button.
 *
 * Spec: 2026-05-25 API Test Harness -- Target-Side Capture -- Task Group 4
 * adds six new proxy routes for the target-side capture flow on the new
 * service (`/target-capture-sessions` create + `/:id/{secrets,
 * test-connection,start,cancel,status}`) plus one AMS-direct proxy for the
 * pairing-read endpoint (`GET .../baselines/:sourceId/target-baselines`).
 * Target proxies mirror the existing current-state action proxy pattern --
 * `:projectId` travels in the gateway URL path and is moved to the query
 * string on forward; the body is forwarded verbatim and the upstream
 * status + body are piped back to the caller.
 *
 * Spec: 2026-05-25 API Test Harness -- Diff Engine -- Task Group 4 adds
 * four validation-service diff proxies (`POST /diffs`, `POST /diffs/:id/
 * recompute`, `POST /diffs/:id/cancel`, `GET /diffs/:id/status`) and seven
 * AMS-direct diff / diff_items CRUD proxies under the
 * `/api/v1/projects/:projectId/api-behaviour/diffs/...` shape (NOT the
 * `architectures/:architectureId/` shape used by the CRUD resources above --
 * the new diff endpoints take `projectId` only, mirroring AMS's
 * `/api/projects/{projectId}/api-behaviour/diffs/...` shape verbatim).
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { getConfig } from '../config';
import { logger } from '../services/logger';
import { getLlmClient } from '../services/llmClient';
import { OpenAIMessage } from '../services/openaiClient';
import { ToolCall, ToolDefinition } from '../types';

export const apiMigrationValidationRouter = Router();

// ============================================================================
// AMS-direct CRUD proxy helpers
// ============================================================================

/**
 * The seven AMS-direct CRUD resources for the API Behaviour Baseline Capture
 * feature. Each one is exposed by the architecture-model-service under
 * `/api/projects/{projectId}/api-behaviour/<resource>` with standard CRUD
 * verbs and an optional id segment for id-scoped routes.
 *
 * Keeping the list explicit here means that adding a new resource downstream
 * is a one-line change rather than a copy/paste of seven verb-quartets.
 */
const API_BEHAVIOUR_RESOURCES = [
  'capture-sessions',
  'operations',
  'scenarios',
  'captures',
  'diagnostics',
  'baselines',
  'baseline-items',
] as const;

type ApiBehaviourResource = (typeof API_BEHAVIOUR_RESOURCES)[number];

/**
 * Build the AMS-bound URL for a CRUD proxy hit. The `:architectureId` from
 * the gateway URL is stripped from the path (AMS routes don't carry it as a
 * path segment) and -- when the request didn't already supply one -- injected
 * as an `architectureId` query parameter.  Other query params (e.g.
 * `sessionId`, `operationId`) are forwarded verbatim.
 *
 * The list endpoints on AMS use `architectureId` as a query param (sessions,
 * baselines); id-scoped endpoints ignore the query param entirely.  Always
 * forwarding it is harmless and keeps the proxy generic.
 */
function buildAmsUrl(
  amsBaseUrl: string,
  projectId: string,
  architectureId: string,
  resource: ApiBehaviourResource,
  resourceId: string | undefined,
  originalUrl: string,
): string {
  const queryIdx = originalUrl.indexOf('?');
  const incomingQuery = queryIdx >= 0 ? originalUrl.substring(queryIdx + 1) : '';
  const params = new URLSearchParams(incomingQuery);

  // Inject architectureId from the URL safety segment if the caller didn't
  // already supply it as a query param. Some downstream endpoints ignore it
  // (id-scoped routes, baseline-items list which uses baselineId); leaving
  // it on the query string is harmless to those.
  if (!params.has('architectureId')) {
    params.set('architectureId', architectureId);
  }

  const path = resourceId
    ? `/api/projects/${encodeURIComponent(projectId)}/api-behaviour/${resource}/${encodeURIComponent(resourceId)}`
    : `/api/projects/${encodeURIComponent(projectId)}/api-behaviour/${resource}`;

  const queryString = params.toString();
  return `${amsBaseUrl}${path}${queryString ? `?${queryString}` : ''}`;
}

/**
 * Generic AMS proxy: forwards method + body verbatim and pipes the upstream
 * status + body back to the caller (mirroring the byte-for-byte pass-through
 * the `architectures.ts` proxy uses, including for non-2xx responses).
 *
 * On network / fetch failure returns 503 with a structured error envelope.
 */
async function proxyToAms(
  req: Request,
  res: Response,
  resource: ApiBehaviourResource,
  resourceId: string | undefined,
): Promise<void> {
  const requestId = (req as any).requestId || 'unknown';
  const { projectId, architectureId } = req.params;
  const { architectureModelServiceBaseUrl } = getConfig();

  const url = buildAmsUrl(
    architectureModelServiceBaseUrl,
    projectId,
    architectureId,
    resource,
    resourceId,
    req.originalUrl,
  );

  const init: RequestInit = {
    method: req.method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  };

  if (req.method !== 'GET' && req.method !== 'DELETE' && req.body !== undefined) {
    init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  }

  logger.debug('API behaviour proxy: forwarding request', {
    requestId,
    method: req.method,
    url,
    projectId,
    architectureId,
    resource,
    resourceId,
  });

  try {
    const upstream = await fetch(url, init);

    let body: unknown;
    const contentType = upstream.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        body = await upstream.json();
      } catch {
        body = null;
      }
    } else {
      body = await upstream.text();
    }

    if (!upstream.ok) {
      logger.warn('API behaviour proxy: upstream returned non-OK', {
        requestId,
        method: req.method,
        url,
        status: upstream.status,
        resource,
        resourceId,
      });
    }

    res.status(upstream.status);
    if (body === null || body === undefined) {
      res.end();
    } else if (typeof body === 'string') {
      res.send(body);
    } else {
      res.json(body);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('API behaviour proxy: upstream fetch failed', {
      requestId,
      method: req.method,
      url,
      error: message,
      resource,
      resourceId,
    });
    res.status(503).json({
      error: {
        code: 503,
        message: 'Architecture model service unavailable',
        details: message,
      },
    });
  }
}

/**
 * Register the four standard CRUD verbs (collection-level GET/POST,
 * id-scoped GET/PATCH/DELETE) for one `api-behaviour` resource.
 *
 * The routes are registered against the gateway URL shape:
 *   /projects/:projectId/architectures/:architectureId/api-behaviour/<resource>[/:id]
 *
 * Forgetting `:architectureId` in the URL means none of these routes match
 * and Express returns 404 (the URL safety property the spec requires --
 * mirrors the `discovery.ts` pattern).
 */
function registerCrudProxy(resource: ApiBehaviourResource): void {
  const collectionPath = `/projects/:projectId/architectures/:architectureId/api-behaviour/${resource}`;
  const idPath = `${collectionPath}/:id`;

  apiMigrationValidationRouter.get(collectionPath, (req, res) =>
    proxyToAms(req, res, resource, undefined),
  );
  apiMigrationValidationRouter.post(collectionPath, (req, res) =>
    proxyToAms(req, res, resource, undefined),
  );
  apiMigrationValidationRouter.get(idPath, (req, res) =>
    proxyToAms(req, res, resource, req.params.id),
  );
  apiMigrationValidationRouter.patch(idPath, (req, res) =>
    proxyToAms(req, res, resource, req.params.id),
  );
  apiMigrationValidationRouter.delete(idPath, (req, res) =>
    proxyToAms(req, res, resource, req.params.id),
  );
}

// ============================================================================
// Best-effort batch proxies -- Spec: 2026-06-20 Baseline Save & Review --
// Batch + Activate + Export -- Task Group 2.
//
// Two AMS-direct batch routes for the save -> review -> activate tail. They
// collapse the per-item accept/reject/save loops (~263 captures => ~263
// sequential gateway hits, which trip the rate limiter) into ONE request each:
//
//   POST  .../api-behaviour/baseline-items/batch   { items: [...] }
//   PATCH .../api-behaviour/captures/batch         { items: [{ id, patch }] }
//
// They MUST be registered BEFORE the generic registerCrudProxy loop below:
// otherwise the id-scoped PATCH .../captures/:id would capture the literal
// "batch" segment as the ":id" placeholder (and baseline-items/batch would
// 404 against the bare collection POST). Same first-match ordering discipline the
// diffs/by-target route uses against diffs/:diffId.
//
// Both reuse the shared proxyToAms / buildAmsUrl path with the literal
// "batch" segment passed as the resourceId, so the forward URL becomes
// /api/projects/{projectId}/api-behaviour/<resource>/batch (AMS publishes
// the batch endpoints at exactly that shape; architectureId rides on the
// query string harmlessly, as it does for every other CRUD proxy here).
//
// No body-limit change: the 32KB chat maxMessageBytes is NOT on these routes;
// they are bounded by the global express.json({ limit: '30mb' }) in server.ts.
// The per-call cap 500 enforced by AMS is the guardrail.
// ============================================================================

apiMigrationValidationRouter.post(
  '/projects/:projectId/architectures/:architectureId/api-behaviour/baseline-items/batch',
  (req, res) => proxyToAms(req, res, 'baseline-items', 'batch'),
);

apiMigrationValidationRouter.patch(
  '/projects/:projectId/architectures/:architectureId/api-behaviour/captures/batch',
  (req, res) => proxyToAms(req, res, 'captures', 'batch'),
);

for (const resource of API_BEHAVIOUR_RESOURCES) {
  registerCrudProxy(resource);
}

// ============================================================================
// LLM tool-call relay endpoint
// ============================================================================

/**
 * Request body for the LLM tool-call relay.
 *
 * `messages` and `tools` are passed straight through to the LLM client (which
 * accepts OpenAI's wire format -- assistant messages with `tool_calls`, tool
 * messages with `tool_call_id`, etc.). `toolChoice` and `model` are optional.
 *
 * The new `api-migration-validation-service` owns the loop, the 12-round
 * counter, the 30s per-tool-call timeout, and the 5min wall-clock; this
 * endpoint only does ONE provider round trip per call.
 */
interface LlmToolLoopRequest {
  messages: OpenAIMessage[];
  tools: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  model?: string; // forwarded for logging only -- provider model is selected by gateway env
}

/**
 * Assistant message returned from the relay.  Mirrors the OpenAI wire format
 * exactly so that the new service can feed it back into the next round-trip
 * (alongside `tool` messages built from the executed tool results) without
 * any shape munging.
 */
interface AssistantToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface AssistantMessage {
  role: 'assistant';
  content: string | null;
  tool_calls?: AssistantToolCall[];
}

interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

interface LlmToolLoopResponse {
  message: AssistantMessage;
  usage?: TokenUsage;
}

/**
 * Convert the parsed `ToolCall[]` shape returned by the LLM client back to
 * the OpenAI wire-format `tool_calls` (with `arguments` as a JSON string).
 * The new service round-trips these straight back to the LLM; it would be
 * strictly more work to keep them parsed.
 */
function toWireToolCalls(toolCalls: ToolCall[] | undefined): AssistantToolCall[] | undefined {
  if (!toolCalls || toolCalls.length === 0) return undefined;
  return toolCalls.map((tc) => ({
    id: tc.callId,
    type: 'function' as const,
    function: {
      name: typeof tc.name === 'string' ? tc.name : String(tc.name),
      arguments: JSON.stringify(tc.arguments ?? {}),
    },
  }));
}

/**
 * POST /api/v1/api-migration-validation/llm-tool-loop
 *
 * Stateless single-round-trip relay. Body schema:
 *   { messages, tools, toolChoice?, model? }
 * Response shape:
 *   { message: { role: 'assistant', content, tool_calls? }, usage? }
 *
 * Provider config (OpenAI vs Azure OpenAI) is inherited from the existing
 * `LLM_PROVIDER` env via `getLlmClient()`.  No new provider plumbing.
 */
apiMigrationValidationRouter.post('/api-migration-validation/llm-tool-loop', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || 'unknown';
  const startTime = Date.now();

  try {
    const body = (req.body || {}) as Partial<LlmToolLoopRequest>;

    // Minimal validation -- the new service owns the rest of the contract.
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return res.status(400).json({
        error: { code: 400, message: 'messages must be a non-empty array' },
      });
    }
    if (!Array.isArray(body.tools)) {
      return res.status(400).json({
        error: { code: 400, message: 'tools must be an array (use [] for no tools)' },
      });
    }

    logger.info('[ApiMigrationValidation] LLM tool-loop relay request received', {
      requestId,
      messageCount: body.messages.length,
      toolCount: body.tools.length,
      toolChoiceKind: typeof body.toolChoice === 'object' ? 'forced-function' : (body.toolChoice || 'default'),
      modelHint: body.model,
    });

    const llmClient = getLlmClient();

    const llmResponse = await llmClient.sendChatRequest(
      body.messages,
      requestId,
      `api-migration-validation-${requestId}`,
      {
        tools: body.tools,
        toolChoice: body.toolChoice,
      },
    );

    const message: AssistantMessage = {
      role: 'assistant',
      content: llmResponse.content ?? '',
      tool_calls: toWireToolCalls(llmResponse.toolCalls),
    };

    const response: LlmToolLoopResponse = {
      message,
      usage: llmResponse.usage,
    };

    logger.info('[ApiMigrationValidation] LLM tool-loop relay request completed', {
      requestId,
      durationMs: Date.now() - startTime,
      hasToolCalls: !!message.tool_calls && message.tool_calls.length > 0,
      toolCallCount: message.tool_calls?.length || 0,
      usage: llmResponse.usage,
    });

    return res.json(response);
  } catch (error) {
    // Pass provider errors through verbatim where we can recover a status code
    // (e.g. OpenAI/Azure SDK errors that carry .status). Otherwise fall back
    // to 502 so the caller knows the failure originated upstream of the
    // gateway, not in the gateway's own request handling.
    const status = (error as { status?: number })?.status;
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    logger.error('[ApiMigrationValidation] LLM tool-loop relay failed', {
      requestId,
      durationMs: Date.now() - startTime,
      errorName,
      error: errorMessage,
      providerStatus: status,
    });

    // Per-DAY quota (Spec 2026-07-22): a distinct, non-retryable signal so the
    // capture orchestrator STOPS the whole run (vs a per-minute 429, which the
    // Azure client already waited out and here surfaces as a plain rate-limit).
    if ((error as { isDailyLimit?: boolean })?.isDailyLimit === true) {
      return res.status(429).json({
        error: {
          code: 429,
          reason: 'llm_daily_limit',
          message: errorMessage,
          provider: errorName,
        },
      });
    }

    if (typeof status === 'number' && status >= 400 && status < 600) {
      return res.status(status).json({
        error: {
          code: status,
          message: errorMessage,
          provider: errorName,
        },
      });
    }

    return res.status(502).json({
      error: {
        code: 502,
        message: 'LLM provider request failed',
        provider: errorName,
        details: errorMessage,
      },
    });
  }
});

// ============================================================================
// Action endpoint proxies -- forward to api-migration-validation-service (8092)
//
// Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 6.
// Spec: 2026-05-17 SOAP LLM Extraction and Payload Enrichment (Phase 2)
//       Task Group 6 adds `/extract-endpoints` to the action list for the
//       Workstream A explicit "Extract endpoints with LLM" Step 4 button.
//
// The new microservice exposes these action endpoints under
//   POST /api-migration-validation/api/capture-sessions/:sessionId/<action>
// where <action> is one of:
//   parse-oas | test-api-connection | test-db-connection | start | cancel
//   | secrets | extract-endpoints | reconcile-inventory | account-endpoints
//   | manual-capture | add-operation | data-type-defaults-preview
//   | retry-uncovered | exclude-endpoint | refresh-oas-cache
//
// Spec: 2026-06-11 Model-Seeded Capture Inventory -- Task Group 3 adds the
// `reconcile-inventory` (configure-time + display reconciliation read) and
// `account-endpoints` (bulk include / exclude-with-reason accounting) plain
// JSON actions -- two list entries in the existing loop, no new proxy code.
//
// The gateway routes are URL-shaped to embed the URL safety property the rest
// of the system relies on:
//   POST /api/v1/projects/:projectId/architectures/:architectureId/
//        api-behaviour/capture-sessions/:sessionId/<action>
//
// Forgetting `:architectureId` 404s at the Express layer (no fallback /
// no silent default-resolution) -- mirrors the AMS CRUD proxies above
// and the discovery.ts pattern.
//
// `:projectId` and `:architectureId` are stripped from the proxied URL path
// (the new service's action routes don't carry them) and injected onto the
// query string -- the new service's `extractProjectId` reads the projectId
// off the query, and the architectureId is forwarded too for any future
// architecture-scoped logic.
// ============================================================================

export const API_BEHAVIOUR_ACTION_PATHS = [
  'parse-oas',
  'test-api-connection',
  'test-db-connection',
  'start',
  'cancel',
  'secrets',
  'extract-endpoints',
  'reconcile-inventory',
  'account-endpoints',
  'manual-capture',
  'add-operation',
  'data-type-defaults-preview',
  'retry-uncovered',
  'exclude-endpoint',
  // Parse-ONLY contract refresh (2026-08-08). The "Retry uncovered APIs"
  // modal's optional "API contract" picker posts the SAME multipart shape as
  // the wizard's `parse-oas` (one-or-more parts under the field name `file`).
  // It was absent from this list, so the gateway had no Express route for it
  // and the browser got the HTML "Cannot POST ..." 404 verbatim in the
  // modal's error banner -- a contract the wizard had just accepted looked
  // like a bad file on retry.
  'refresh-oas-cache',
] as const;

type ApiBehaviourAction = (typeof API_BEHAVIOUR_ACTION_PATHS)[number];

/**
 * Actions that may carry a MULTIPART body (contract file uploads) rather than
 * JSON. Both the route-registration loop and `proxyActionToService` consult
 * this ONE set, so a multipart action can never be half-wired again (on the
 * multer pipeline but not the body-rebuild branch, or vice versa).
 *
 * Every member forwards its parts under the same `file` field name and is
 * handled by the identical rebuild code path, so the retry flow's contract
 * upload behaves exactly as the wizard's does.
 */
const MULTIPART_ACTIONS: ReadonlySet<string> = new Set<ApiBehaviourAction>([
  'parse-oas',
  'refresh-oas-cache',
]);

/**
 * Multipart-aware passthrough configuration, applied to the actions listed in
 * `MULTIPART_ACTIONS` (ad-hoc contract uploads); every other action is always
 * JSON. Using `multer().none()` for non-file endpoints would strip fields, so
 * we segregate by action and forward bytes verbatim.
 */
const actionUpload = multer({
  storage: multer.memoryStorage(),
  // Spec 2026-06-03 (OAS-YAML + WADL/XSD): `parse-oas` may now carry a WADL
  // PLUS one-or-more sibling `.xsd` grammar files in a single multipart body,
  // so the single-file cap is lifted to a small multi-file cap. The OAS path
  // still posts a single file; both flow through the same `file` field name.
  limits: { fileSize: 5 * 1024 * 1024, files: 12 },
});

/**
 * Forward an action call to the new service. The downstream URL is:
 *   POST {apiMigrationValidationServiceBaseUrl}
 *        /api-migration-validation/api/capture-sessions/:sessionId/<action>
 *        ?projectId=...&architectureId=...
 *
 * For JSON actions: forward the parsed body verbatim.
 * For the `MULTIPART_ACTIONS` (`parse-oas`, `refresh-oas-cache`): rebuild a
 * multipart body with the file part(s) (only when a file was actually
 * uploaded) and forward.
 */
async function proxyActionToService(
  req: Request,
  res: Response,
  action: ApiBehaviourAction | 'compensation-preflight' | 'closure-status',
  method: 'POST' | 'GET' = 'POST',
): Promise<void> {
  const requestId = (req as any).requestId || 'unknown';
  const { projectId, architectureId, sessionId } = req.params;
  const { apiMigrationValidationServiceBaseUrl } = getConfig();

  const params = new URLSearchParams();
  params.set('projectId', projectId);
  params.set('architectureId', architectureId);

  const url =
    `${apiMigrationValidationServiceBaseUrl}` +
    `/api-migration-validation/api/capture-sessions/${encodeURIComponent(sessionId)}/${action}` +
    `?${params.toString()}`;

  logger.debug('API behaviour action proxy: forwarding request', {
    requestId,
    method: req.method,
    url,
    action,
    projectId,
    architectureId,
    sessionId,
  });

  try {
    let init: RequestInit;
    const files = (req as Request & { files?: Express.Multer.File[] }).files;
    if (method === 'GET') {
      // Read-only action (compensation-preflight): no body on a GET.
      init = { method: 'GET', headers: { Accept: 'application/json' } };
    } else if (MULTIPART_ACTIONS.has(action) && Array.isArray(files) && files.length > 0) {
      // Rebuild the multipart body, forwarding EVERY uploaded part under the
      // same `file` field name (an OAS doc on its own, OR a WADL + its XSD
      // grammar file(s)). We use the global FormData / Blob shipped with
      // Node 18+ (gateway runs Node 20). Any non-file fields posted alongside
      // the files are forwarded as plain text parts.
      const fd = new FormData();
      for (const file of files) {
        fd.append(
          'file',
          new Blob([new Uint8Array(file.buffer)], {
            type: file.mimetype || 'application/octet-stream',
          }),
          file.originalname,
        );
      }
      // Forward any text fields that came in alongside the files.
      const body = (req.body || {}) as Record<string, unknown>;
      for (const [k, v] of Object.entries(body)) {
        if (typeof v === 'string') fd.append(k, v);
      }
      init = { method: 'POST', body: fd };
    } else {
      init = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(req.body ?? {}),
      };
    }

    const upstream = await fetch(url, init);

    let body: unknown;
    const contentType = upstream.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        body = await upstream.json();
      } catch {
        body = null;
      }
    } else {
      body = await upstream.text();
    }

    if (!upstream.ok) {
      logger.warn('API behaviour action proxy: upstream returned non-OK', {
        requestId,
        action,
        status: upstream.status,
        sessionId,
      });
    }

    res.status(upstream.status);
    if (body === null || body === undefined) {
      res.end();
    } else if (typeof body === 'string') {
      res.send(body);
    } else {
      res.json(body);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('API behaviour action proxy: upstream fetch failed', {
      requestId,
      action,
      url,
      error: message,
      sessionId,
    });
    res.status(503).json({
      error: {
        code: 503,
        message: 'API migration validation service unavailable',
        details: message,
      },
    });
  }
}

/**
 * Register every action proxy in `API_BEHAVIOUR_ACTION_PATHS` under the
 * gateway URL shape:
 *   POST /projects/:projectId/architectures/:architectureId/
 *        api-behaviour/capture-sessions/:sessionId/<action>
 *
 * The `MULTIPART_ACTIONS` accept an optional multipart upload via
 * `multer().array('file')`; the rest accept only JSON and multer is not on
 * their pipeline.
 */
for (const action of API_BEHAVIOUR_ACTION_PATHS) {
  const path =
    `/projects/:projectId/architectures/:architectureId/` +
    `api-behaviour/capture-sessions/:sessionId/${action}`;
  if (MULTIPART_ACTIONS.has(action)) {
    apiMigrationValidationRouter.post(path, actionUpload.array('file'), (req, res) =>
      proxyActionToService(req, res, action),
    );
  } else {
    apiMigrationValidationRouter.post(path, (req, res) =>
      proxyActionToService(req, res, action),
    );
  }
}

// CSD Spec 3 gap fix (2026-08-19): the PRE-START compensation preflight is a
// READ (GET) — it lists the included write endpoints with no effect-table map
// so the wizard can warn BEFORE /start. Registered beside the POST action
// loop; same downstream URL shape, no body.
apiMigrationValidationRouter.get(
  `/projects/:projectId/architectures/:architectureId/` +
    `api-behaviour/capture-sessions/:sessionId/compensation-preflight`,
  (req, res) => proxyActionToService(req, res, 'compensation-preflight', 'GET'),
);

// Async coverage closure (2026-09-02): `retry-uncovered` now answers 202 and
// runs in the background on AMVS; this GET is the poll surface the modal uses
// to stay in its running state until the run is terminal. Registered beside
// the POST action loop; instant read, no timeout concerns.
apiMigrationValidationRouter.get(
  `/projects/:projectId/architectures/:architectureId/` +
    `api-behaviour/capture-sessions/:sessionId/closure-status`,
  (req, res) => proxyActionToService(req, res, 'closure-status', 'GET'),
);

// ============================================================================
// Target-side capture action proxies -- forward to api-migration-validation-
// service (8092). Spec: 2026-05-25 API Test Harness -- Target-Side Capture --
// Task Group 4.
//
// The new microservice exposes the target-side action endpoints under
//   POST /api-migration-validation/api/target-capture-sessions               (create)
//   POST /api-migration-validation/api/target-capture-sessions/:id/secrets
//   POST /api-migration-validation/api/target-capture-sessions/:id/test-connection
//   POST /api-migration-validation/api/target-capture-sessions/:id/start
//   POST /api-migration-validation/api/target-capture-sessions/:id/cancel
//   GET  /api-migration-validation/api/target-capture-sessions/:id/status
//
// The gateway routes mirror the existing current-state action proxy shape:
//   POST /api/v1/api-migration-validation/target-capture-sessions             (create)
//   POST /api/v1/api-migration-validation/target-capture-sessions/:id/secrets
//   POST /api/v1/api-migration-validation/target-capture-sessions/:id/test-connection
//   POST /api/v1/api-migration-validation/target-capture-sessions/:id/start
//   POST /api/v1/api-migration-validation/target-capture-sessions/:id/cancel
//   GET  /api/v1/api-migration-validation/target-capture-sessions/:id/status
//
// Unlike the current-state action proxies (which require `:projectId` and
// `:architectureId` as URL path segments for safety), the target-side
// proxies follow the validation-service's own route shape verbatim --
// `projectId` rides in the JSON body for `POST .../target-capture-sessions`
// (the create call) and as a query string parameter for the per-session
// id-scoped routes. The validation service's `extractProjectId` reads from
// either source. This keeps the proxy a true thin pass-through: no URL
// rewriting, no path-param injection, no body massaging.
// ============================================================================

const TARGET_CAPTURE_ACTION_PATHS = [
  'secrets',
  'test-connection',
  'start',
  'cancel',
  'status',
] as const;

type TargetCaptureAction = (typeof TARGET_CAPTURE_ACTION_PATHS)[number];

/**
 * Build the downstream URL for a target-capture proxy call. Mirrors the
 * verbatim shape the validation service publishes (`/api-migration-validation
 * /api/target-capture-sessions/...`). The incoming query string is forwarded
 * verbatim so callers can keep using `?projectId=...` on the per-session
 * routes; `:id` is URL-encoded defensively even though it's a UUID in
 * practice.
 */
function buildTargetCaptureUrl(
  serviceBaseUrl: string,
  sessionId: string | undefined,
  action: TargetCaptureAction | 'create',
  originalUrl: string,
): string {
  const queryIdx = originalUrl.indexOf('?');
  const queryString = queryIdx >= 0 ? originalUrl.substring(queryIdx) : '';
  if (action === 'create') {
    return `${serviceBaseUrl}/api-migration-validation/api/target-capture-sessions${queryString}`;
  }
  return (
    `${serviceBaseUrl}/api-migration-validation/api/target-capture-sessions/` +
    `${encodeURIComponent(sessionId || '')}/${action}${queryString}`
  );
}

/**
 * Forward a target-capture call to the new service. Mirrors `proxyActionToService`
 * for the JSON path (the target proxies never accept multipart -- the
 * source baseline already encodes the OAS operation set, so there is no
 * `parse-oas` equivalent on the target side).
 *
 * Pipes the upstream status + body back verbatim, including non-2xx
 * responses (404 on status polling for a missing session is the leading
 * example of why pass-through matters here).
 */
async function proxyTargetActionToService(
  req: Request,
  res: Response,
  action: TargetCaptureAction | 'create',
): Promise<void> {
  const requestId = (req as any).requestId || 'unknown';
  const sessionId = req.params.id;
  const { apiMigrationValidationServiceBaseUrl } = getConfig();

  const url = buildTargetCaptureUrl(
    apiMigrationValidationServiceBaseUrl,
    sessionId,
    action,
    req.originalUrl,
  );

  const init: RequestInit = {
    method: req.method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  };
  if (req.method !== 'GET' && req.method !== 'DELETE') {
    init.body = JSON.stringify(req.body ?? {});
  }

  logger.debug('Target capture action proxy: forwarding request', {
    requestId,
    method: req.method,
    url,
    action,
    sessionId,
  });

  try {
    const upstream = await fetch(url, init);

    let body: unknown;
    const contentType = upstream.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        body = await upstream.json();
      } catch {
        body = null;
      }
    } else {
      body = await upstream.text();
    }

    if (!upstream.ok) {
      logger.warn('Target capture action proxy: upstream returned non-OK', {
        requestId,
        action,
        status: upstream.status,
        sessionId,
      });
    }

    res.status(upstream.status);
    if (body === null || body === undefined) {
      res.end();
    } else if (typeof body === 'string') {
      res.send(body);
    } else {
      res.json(body);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Target capture action proxy: upstream fetch failed', {
      requestId,
      action,
      url,
      error: message,
      sessionId,
    });
    res.status(503).json({
      error: {
        code: 503,
        message: 'API migration validation service unavailable',
        details: message,
      },
    });
  }
}

/**
 * Create route: `POST /api/v1/api-migration-validation/target-capture-sessions`.
 * No `:id` segment -- the server allocates the session id.
 */
apiMigrationValidationRouter.post(
  '/api-migration-validation/target-capture-sessions',
  (req, res) => proxyTargetActionToService(req, res, 'create'),
);

/**
 * Per-session action routes. `:id` is the AMS-assigned session UUID. The
 * action verb is appended verbatim downstream.
 */
for (const action of TARGET_CAPTURE_ACTION_PATHS) {
  const path = `/api-migration-validation/target-capture-sessions/:id/${action}`;
  if (action === 'status') {
    apiMigrationValidationRouter.get(path, (req, res) =>
      proxyTargetActionToService(req, res, action),
    );
  } else {
    apiMigrationValidationRouter.post(path, (req, res) =>
      proxyTargetActionToService(req, res, action),
    );
  }
}

// ============================================================================
// S0-snapshot proxies (CSD, 2026-08-20 journey-audit fix)
//
// The capture halt remedy ("the database is NO LONGER S0 — restore, then
// re-run") previously pointed at a raw validation-service call; the session
// screen now offers the restore itself. Thin verbatim pass-throughs, same
// posture as the target-capture proxies: the incoming query string / JSON
// body (which carries the DB credentials for the restore — function-scope
// only, never logged) is forwarded untouched.
//
//   GET  /api/v1/api-migration-validation/s0-snapshot/latest?project_id=&architecture_id=
//   POST /api/v1/api-migration-validation/s0-snapshot/restore   (confirm-gated downstream)
// ============================================================================

const S0_SNAPSHOT_ACTIONS = ['latest', 'restore'] as const;
type S0SnapshotAction = (typeof S0_SNAPSHOT_ACTIONS)[number];

async function proxyS0SnapshotToService(
  req: Request,
  res: Response,
  action: S0SnapshotAction,
): Promise<void> {
  const requestId = (req as any).requestId || 'unknown';
  const { apiMigrationValidationServiceBaseUrl } = getConfig();
  const queryIdx = req.originalUrl.indexOf('?');
  const queryString = queryIdx >= 0 ? req.originalUrl.substring(queryIdx) : '';
  const url =
    `${apiMigrationValidationServiceBaseUrl}` +
    `/api-migration-validation/api/s0-snapshot/${action}${queryString}`;

  const init: RequestInit = {
    method: req.method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  };
  if (req.method !== 'GET') {
    init.body = JSON.stringify(req.body ?? {});
  }

  logger.debug('S0 snapshot proxy: forwarding request', {
    requestId,
    method: req.method,
    action,
  });

  try {
    const upstream = await fetch(url, init);
    let body: unknown;
    const contentType = upstream.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        body = await upstream.json();
      } catch {
        body = null;
      }
    } else {
      body = await upstream.text();
    }
    if (!upstream.ok) {
      logger.warn('S0 snapshot proxy: upstream returned non-OK', {
        requestId,
        action,
        status: upstream.status,
      });
    }
    res.status(upstream.status);
    if (body === null || body === undefined) {
      res.end();
    } else if (typeof body === 'string') {
      res.send(body);
    } else {
      res.json(body);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('S0 snapshot proxy: upstream fetch failed', {
      requestId,
      action,
      error: message,
    });
    res.status(503).json({
      error: {
        code: 503,
        message: 'API migration validation service unavailable',
        details: message,
      },
    });
  }
}

apiMigrationValidationRouter.get(
  '/api-migration-validation/s0-snapshot/latest',
  (req, res) => proxyS0SnapshotToService(req, res, 'latest'),
);
apiMigrationValidationRouter.post(
  '/api-migration-validation/s0-snapshot/restore',
  (req, res) => proxyS0SnapshotToService(req, res, 'restore'),
);

// ============================================================================
// AMS-direct proxy for the pairing-read endpoint
//
// Spec: 2026-05-25 API Test Harness -- Target-Side Capture -- Task Group 4
// sub-task 4.3.
//
// Forwards `GET /api/projects/:projectId/api-behaviour/baselines/:sourceId/
// target-baselines` verbatim to the AMS endpoint of the same shape. The
// route is mounted on this router (alongside the rest of the api-behaviour
// surface) so the AMS-direct vs. validation-service split stays in one
// file. The gateway path is the AMS path verbatim -- no architectureId in
// the URL (AMS already enforces project + source-baseline scoping).
//
// This proxy ships with the gateway layer even though this spec's frontend
// does not consume it; Spec #5's diff UI will. Keeping the AMS contract
// fully proxied here means Spec #5 only needs to add the frontend client +
// the diff-UI surface.
// ============================================================================

apiMigrationValidationRouter.get(
  '/projects/:projectId/api-behaviour/baselines/:sourceId/target-baselines',
  async (req: Request, res: Response) => {
    const requestId = (req as any).requestId || 'unknown';
    const { projectId, sourceId } = req.params;
    const { architectureModelServiceBaseUrl } = getConfig();

    const queryIdx = req.originalUrl.indexOf('?');
    const queryString = queryIdx >= 0 ? req.originalUrl.substring(queryIdx) : '';

    const url =
      `${architectureModelServiceBaseUrl}` +
      `/api/projects/${encodeURIComponent(projectId)}` +
      `/api-behaviour/baselines/${encodeURIComponent(sourceId)}/target-baselines` +
      queryString;

    logger.debug('Paired target baselines proxy: forwarding request', {
      requestId,
      method: req.method,
      url,
      projectId,
      sourceId,
    });

    try {
      const upstream = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      let body: unknown;
      const contentType = upstream.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        try {
          body = await upstream.json();
        } catch {
          body = null;
        }
      } else {
        body = await upstream.text();
      }

      if (!upstream.ok) {
        logger.warn('Paired target baselines proxy: upstream returned non-OK', {
          requestId,
          status: upstream.status,
          projectId,
          sourceId,
        });
      }

      res.status(upstream.status);
      if (body === null || body === undefined) {
        res.end();
      } else if (typeof body === 'string') {
        res.send(body);
      } else {
        res.json(body);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Paired target baselines proxy: upstream fetch failed', {
        requestId,
        url,
        error: message,
        projectId,
        sourceId,
      });
      res.status(503).json({
        error: {
          code: 503,
          message: 'Architecture model service unavailable',
          details: message,
        },
      });
    }
  },
);

// ============================================================================
// Diff Engine proxies -- Spec: 2026-05-25 API Test Harness -- Diff Engine
// Task Group 4.
//
// Two surfaces are exposed:
//
//   (1) Validation-service diff action proxies (port 8092). Mirrors the
//       target-capture action proxy convention -- thin pass-through,
//       projectId rides on body / query string, upstream status + body
//       piped back verbatim including non-2xx (e.g. 400 for draft-target
//       rejection, 409 for concurrent recompute).
//
//         POST /api/v1/api-migration-validation/diffs
//         POST /api/v1/api-migration-validation/diffs/:id/recompute
//         POST /api/v1/api-migration-validation/diffs/:id/cancel
//         GET  /api/v1/api-migration-validation/diffs/:id/status
//
//   (2) AMS-direct diff / diff_items CRUD proxies. Follows the same
//       `/api/v1/projects/:projectId/api-behaviour/...` URL convention used
//       by Spec #4's pairing-read proxy (NOT the `architectures/:architectureId/`
//       shape -- AMS publishes diffs at `/api/projects/{projectId}/
//       api-behaviour/diffs/...` with project-only scoping; architectureId
//       is carried in the row but not in the URL).
//
//         POST   /api/v1/projects/:projectId/api-behaviour/diffs
//         GET    /api/v1/projects/:projectId/api-behaviour/diffs/:diffId
//         GET    /api/v1/projects/:projectId/api-behaviour/diffs/by-target/:targetBaselineId
//         PATCH  /api/v1/projects/:projectId/api-behaviour/diffs/:diffId
//         DELETE /api/v1/projects/:projectId/api-behaviour/diffs/:diffId
//         GET    /api/v1/projects/:projectId/api-behaviour/diffs/:diffId/items
//         POST   /api/v1/projects/:projectId/api-behaviour/diffs/:diffId/items
//
// The by-target lookup is the primary UI entry point: the Drift report tab
// on `BaselineDetailView` calls it with the target baseline's id to discover
// whether a diff exists (404 on miss).
// ============================================================================

/**
 * Build the downstream validation-service URL for a diff action proxy hit.
 * Forwards the incoming query string verbatim so callers can keep using
 * `?projectId=...` on the id-scoped routes. The validation service reads
 * projectId from either body or query string.
 */
function buildDiffActionUrl(
  serviceBaseUrl: string,
  diffId: string | undefined,
  action: 'create' | 'recompute' | 'cancel' | 'status',
  originalUrl: string,
): string {
  const queryIdx = originalUrl.indexOf('?');
  const queryString = queryIdx >= 0 ? originalUrl.substring(queryIdx) : '';
  if (action === 'create') {
    return `${serviceBaseUrl}/api-migration-validation/api/diffs${queryString}`;
  }
  return (
    `${serviceBaseUrl}/api-migration-validation/api/diffs/` +
    `${encodeURIComponent(diffId || '')}/${action}${queryString}`
  );
}

/**
 * Forward a diff-action call to the validation service. Thin pass-through
 * mirroring `proxyTargetActionToService`: upstream status + body piped back
 * verbatim, network errors surfaced as 503.
 */
async function proxyDiffActionToService(
  req: Request,
  res: Response,
  action: 'create' | 'recompute' | 'cancel' | 'status',
): Promise<void> {
  const requestId = (req as any).requestId || 'unknown';
  const diffId = req.params.id;
  const { apiMigrationValidationServiceBaseUrl } = getConfig();

  const url = buildDiffActionUrl(
    apiMigrationValidationServiceBaseUrl,
    diffId,
    action,
    req.originalUrl,
  );

  const init: RequestInit = {
    method: req.method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  };
  if (req.method !== 'GET' && req.method !== 'DELETE') {
    init.body = JSON.stringify(req.body ?? {});
  }

  logger.debug('Diff action proxy: forwarding request', {
    requestId,
    method: req.method,
    url,
    action,
    diffId,
  });

  try {
    const upstream = await fetch(url, init);

    let body: unknown;
    const contentType = upstream.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        body = await upstream.json();
      } catch {
        body = null;
      }
    } else {
      body = await upstream.text();
    }

    if (!upstream.ok) {
      logger.warn('Diff action proxy: upstream returned non-OK', {
        requestId,
        action,
        status: upstream.status,
        diffId,
      });
    }

    res.status(upstream.status);
    if (body === null || body === undefined) {
      res.end();
    } else if (typeof body === 'string') {
      res.send(body);
    } else {
      res.json(body);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Diff action proxy: upstream fetch failed', {
      requestId,
      action,
      url,
      error: message,
      diffId,
    });
    res.status(503).json({
      error: {
        code: 503,
        message: 'API migration validation service unavailable',
        details: message,
      },
    });
  }
}

/**
 * Create route: `POST /api/v1/api-migration-validation/diffs`. No `:id`
 * segment -- the validation service allocates / reuses the diff id.
 */
apiMigrationValidationRouter.post(
  '/api-migration-validation/diffs',
  (req, res) => proxyDiffActionToService(req, res, 'create'),
);

apiMigrationValidationRouter.post(
  '/api-migration-validation/diffs/:id/recompute',
  (req, res) => proxyDiffActionToService(req, res, 'recompute'),
);

apiMigrationValidationRouter.post(
  '/api-migration-validation/diffs/:id/cancel',
  (req, res) => proxyDiffActionToService(req, res, 'cancel'),
);

apiMigrationValidationRouter.get(
  '/api-migration-validation/diffs/:id/status',
  (req, res) => proxyDiffActionToService(req, res, 'status'),
);

// ----------------------------------------------------------------------------
// AMS-direct diff / diff_items CRUD proxies
//
// All forward verbatim to the architecture-model-service under
// `/api/projects/{projectId}/api-behaviour/diffs/...` with the upstream
// status + body piped back. The by-target lookup is the leading UI entry
// point -- it 404s when no diff exists for the given target baseline, and
// the frontend client converts that 404 into `null` rather than throwing.
// ----------------------------------------------------------------------------

/**
 * Forward a diff CRUD call to AMS. Pipes the upstream status + body back
 * verbatim. The `path` parameter is the AMS sub-path beneath
 * `/api/projects/{projectId}/api-behaviour/` (e.g. `diffs` or
 * `diffs/<id>/items`).
 */
async function proxyDiffCrudToAms(
  req: Request,
  res: Response,
  amsSubPath: string,
): Promise<void> {
  const requestId = (req as any).requestId || 'unknown';
  const { projectId } = req.params;
  const { architectureModelServiceBaseUrl } = getConfig();

  const queryIdx = req.originalUrl.indexOf('?');
  const queryString = queryIdx >= 0 ? req.originalUrl.substring(queryIdx) : '';

  const url =
    `${architectureModelServiceBaseUrl}` +
    `/api/projects/${encodeURIComponent(projectId)}/api-behaviour/${amsSubPath}` +
    queryString;

  const init: RequestInit = {
    method: req.method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  };
  if (req.method !== 'GET' && req.method !== 'DELETE' && req.body !== undefined) {
    init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  }

  logger.debug('Diff CRUD proxy: forwarding request', {
    requestId,
    method: req.method,
    url,
    projectId,
    amsSubPath,
  });

  try {
    const upstream = await fetch(url, init);

    let body: unknown;
    const contentType = upstream.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        body = await upstream.json();
      } catch {
        body = null;
      }
    } else {
      body = await upstream.text();
    }

    if (!upstream.ok) {
      logger.warn('Diff CRUD proxy: upstream returned non-OK', {
        requestId,
        method: req.method,
        url,
        status: upstream.status,
        projectId,
        amsSubPath,
      });
    }

    res.status(upstream.status);
    if (body === null || body === undefined) {
      res.end();
    } else if (typeof body === 'string') {
      res.send(body);
    } else {
      res.json(body);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Diff CRUD proxy: upstream fetch failed', {
      requestId,
      method: req.method,
      url,
      error: message,
      projectId,
      amsSubPath,
    });
    res.status(503).json({
      error: {
        code: 503,
        message: 'Architecture model service unavailable',
        details: message,
      },
    });
  }
}

// Collection-level diffs
apiMigrationValidationRouter.post(
  '/projects/:projectId/api-behaviour/diffs',
  (req, res) => proxyDiffCrudToAms(req, res, 'diffs'),
);

// By-target lookup (UI primary entry point). Registered BEFORE the id-scoped
// route so Express matches `by-target` literally rather than routing it to
// the `:diffId` placeholder.
apiMigrationValidationRouter.get(
  '/projects/:projectId/api-behaviour/diffs/by-target/:targetBaselineId',
  (req, res) =>
    proxyDiffCrudToAms(
      req,
      res,
      `diffs/by-target/${encodeURIComponent(req.params.targetBaselineId)}`,
    ),
);

// Id-scoped diff
apiMigrationValidationRouter.get(
  '/projects/:projectId/api-behaviour/diffs/:diffId',
  (req, res) =>
    proxyDiffCrudToAms(req, res, `diffs/${encodeURIComponent(req.params.diffId)}`),
);

apiMigrationValidationRouter.patch(
  '/projects/:projectId/api-behaviour/diffs/:diffId',
  (req, res) =>
    proxyDiffCrudToAms(req, res, `diffs/${encodeURIComponent(req.params.diffId)}`),
);

apiMigrationValidationRouter.delete(
  '/projects/:projectId/api-behaviour/diffs/:diffId',
  (req, res) =>
    proxyDiffCrudToAms(req, res, `diffs/${encodeURIComponent(req.params.diffId)}`),
);

// Diff items (nested)
apiMigrationValidationRouter.get(
  '/projects/:projectId/api-behaviour/diffs/:diffId/items',
  (req, res) =>
    proxyDiffCrudToAms(
      req,
      res,
      `diffs/${encodeURIComponent(req.params.diffId)}/items`,
    ),
);

apiMigrationValidationRouter.post(
  '/projects/:projectId/api-behaviour/diffs/:diffId/items',
  (req, res) =>
    proxyDiffCrudToAms(
      req,
      res,
      `diffs/${encodeURIComponent(req.params.diffId)}/items`,
    ),
);

// ============================================================================
// Diff-scoped findings proxies -- Spec: 2026-05-25 API Test Harness --
// Findings Integration -- Task Group 3.
//
// Read + review proxies only (per accepted Q9). Emission goes from the
// validation-service DIRECT to AMS via the validation-service's
// `archModelClient` (mirrors `discovery-service/.../findings/FindingEmitter.ts`).
// The gateway intentionally does NOT proxy `POST .../findings` or
// `DELETE .../findings` -- those are AMS internal-only paths consumed by the
// validation-service emission step.
//
// Three diff-scoped routes mirror the new AMS controller surface:
//
//   GET   /api/v1/projects/:projectId/api-behaviour/diffs/:diffId/findings
//   GET   /api/v1/projects/:projectId/api-behaviour/diffs/:diffId/findings/by-diff-item/:diffItemId
//   PATCH /api/v1/projects/:projectId/api-behaviour/diffs/:diffId/findings/:findingId
//
// The `by-diff-item` literal-match route is registered BEFORE the
// id-scoped `:findingId` route so Express's first-match dispatch picks the
// literal segment over the placeholder (same pattern as the
// `diffs/by-target/:targetBaselineId` route registered before the
// `diffs/:diffId` route above).
//
// The existing discovery findings proxy block in `gateway/src/routes/
// discovery.ts` (lines ~2460-2700+) is NOT touched -- it stays run-scoped;
// this is a parallel diff-scoped block.
// ============================================================================

// List all findings for the diff (ascending created_at). Used by the
// per-diff finding count + the badge-column fallback list.
apiMigrationValidationRouter.get(
  '/projects/:projectId/api-behaviour/diffs/:diffId/findings',
  (req, res) =>
    proxyDiffCrudToAms(
      req,
      res,
      `diffs/${encodeURIComponent(req.params.diffId)}/findings`,
    ),
);

// List findings linked to a specific diff_item via
// `discovery_finding_links` (target_type='api_behaviour_diff_item').
// Registered BEFORE the id-scoped route so Express literal-match wins.
apiMigrationValidationRouter.get(
  '/projects/:projectId/api-behaviour/diffs/:diffId/findings/by-diff-item/:diffItemId',
  (req, res) =>
    proxyDiffCrudToAms(
      req,
      res,
      `diffs/${encodeURIComponent(req.params.diffId)}/findings/by-diff-item/` +
        `${encodeURIComponent(req.params.diffItemId)}`,
    ),
);

// Reviewer status transitions on a diff-sourced finding. Same body shape as
// the existing run-scoped PATCH on `DiscoveryFindingController`.
apiMigrationValidationRouter.patch(
  '/projects/:projectId/api-behaviour/diffs/:diffId/findings/:findingId',
  (req, res) =>
    proxyDiffCrudToAms(
      req,
      res,
      `diffs/${encodeURIComponent(req.params.diffId)}/findings/` +
        `${encodeURIComponent(req.params.findingId)}`,
    ),
);

// ============================================================================
// Stateless wizard pre-flight connection test proxy
//
// Spec: 2026-05-25 API Test Harness -- wizard pre-flight stateless
// test-connection endpoint.
//
// Forwards `POST /api/v1/projects/:projectId/architectures/:architectureId/
// api-behaviour/test-connection` to the validation service's session-less
// `POST /api-migration-validation/api/test-connection`. Unlike the
// session-bound action proxies, the validation-service route takes NO
// session id and NO projectId/architectureId (the probe is fully described
// by the request body: { baseUrl, auth, defaultHeaders }). The URL safety
// segments are still REQUIRED in the gateway path (mirroring the other
// api-behaviour proxies -- forgetting :architectureId 404s at Express), but
// they are NOT forwarded downstream because the stateless endpoint does not
// consume them.
//
// Thin pass-through, same posture as the action proxies: the request body is
// forwarded verbatim and the upstream status + body are piped back. On a
// network / fetch failure the gateway returns 503. Secrets in the body are
// forwarded to the validation service in-memory only and are NEVER logged
// here (only method + URL + status are logged).
// ============================================================================

apiMigrationValidationRouter.post(
  '/projects/:projectId/architectures/:architectureId/api-behaviour/test-connection',
  async (req: Request, res: Response) => {
    const requestId = (req as any).requestId || 'unknown';
    const { projectId, architectureId } = req.params;
    const { apiMigrationValidationServiceBaseUrl } = getConfig();

    const url = `${apiMigrationValidationServiceBaseUrl}/api-migration-validation/api/test-connection`;

    logger.debug('Stateless test-connection proxy: forwarding request', {
      requestId,
      method: req.method,
      url,
      projectId,
      architectureId,
    });

    try {
      const upstream = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(req.body ?? {}),
      });

      let body: unknown;
      const contentType = upstream.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        try {
          body = await upstream.json();
        } catch {
          body = null;
        }
      } else {
        body = await upstream.text();
      }

      if (!upstream.ok) {
        logger.warn('Stateless test-connection proxy: upstream returned non-OK', {
          requestId,
          status: upstream.status,
          projectId,
          architectureId,
        });
      }

      res.status(upstream.status);
      if (body === null || body === undefined) {
        res.end();
      } else if (typeof body === 'string') {
        res.send(body);
      } else {
        res.json(body);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Stateless test-connection proxy: upstream fetch failed', {
        requestId,
        url,
        error: message,
        projectId,
        architectureId,
      });
      res.status(503).json({
        error: {
          code: 503,
          message: 'API migration validation service unavailable',
          details: message,
        },
      });
    }
  },
);
