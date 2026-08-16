/**
 * Missing Input Resolutions proxy + retry-batch orchestration routes.
 *
 * Spec: 2026-05-20 Missing Input Resolver Flow -- Task Group 5.
 *
 * This router exposes two surfaces:
 *
 * 1) Thin pass-through proxies to the AMS missing-input-resolutions endpoints
 *    (single create, bulk preview/commit, list, delete with cascade,
 *    ready-to-retry summary). These follow the same byte-for-byte status +
 *    body round-trip pattern as `epicCapturedDecisions.ts` so the frontend
 *    can branch on AMS-emitted error envelopes verbatim.
 *
 * 2) Retry-batch orchestration. The matching AMS endpoint deliberately
 *    returns 501 (see `SpecGenerationRetryController.retryBatch`) because
 *    the batch handler that actually runs shape-spec generation lives in
 *    the gateway. This route INTERCEPTS that responsibility, runs through
 *    the existing {@link runShapeSpecGenerationBatch} (Spec 2026-05-19) with
 *    `targetWorkItemIds = body.workItemIds` and `regenerateAll = true`, and
 *    optionally gates the run behind a cost-preview confirmation when the
 *    batch hits the documented size / token thresholds.
 *
 * Cost-preview gating thresholds (spec.md line 48, paraphrased): the
 * frontend gates the preview modal on `workItemIds.length >= 5 OR
 * estimatedTokens > 50000`. The gateway enforces the same rule as defence
 * in depth: when a request meets the threshold and is NOT confirmed, the
 * route returns `{ requiresConfirmation: true, costPreview, threshold }`
 * INSTEAD of running the batch. The frontend re-posts with `confirmed:true`
 * once the user accepts the preview.
 *
 * Mount point: `/api` (matches the AMS paths verbatim for proxies; the
 * retry-batch route lives at the same prefix for symmetry).
 *
 * Spec: 2026-05-20 Bulk-Resolve OAS/WSDL Parser -- Task Group 5.
 *
 * 3) Multipart pass-through for the new bulk-resolve OAS/WSDL parse-files
 *    endpoint. The AMS endpoint at
 *    `POST /api/projects/{projectId}/missing-input-resolutions/parse-files`
 *    accepts multipart file uploads with companion form fields
 *    (`serviceNames` positional list, `commit` boolean, optional
 *    `resolvedBy`) and an `X-User-Id` header for audit. The gateway buffers
 *    the multipart parts via `multer` memory storage and re-streams them to
 *    AMS verbatim using a constructed `FormData`. No parsing happens at
 *    this layer; AMS owns format detection, parsing, classification, and
 *    persistence.
 */

import { Router, Request, Response as ExpressResponse } from 'express';
import multer from 'multer';
import { getConfig } from '../config';
import { logger } from '../services/logger';
import {
  runShapeSpecGenerationBatch,
  ShapeSpecGenerationDeps,
  WorkstreamLockedError,
} from '../services/migrationShapeSpecGenerationHandler';
import { fetchProjectConfigWithDefaults } from '../services/architectureModelClient';
import { autoSeedEpicCapturedDecision } from '../services/epicCapturedDecisionsClient';
import { computeCostPreview, CostPreviewResponse } from '../services/migrationShapeSpecCostPreview';
import { productionSeedBuildFilesSource } from '../services/migrationSeedBuildFilesProducer';
import { autoApplyDecisionAdditions } from '../services/targetManifest/manifestDecisionAutoApply';

export const missingInputResolutionsRouter = Router();

// ---------------------------------------------------------------------------
// Threshold constants
// ---------------------------------------------------------------------------

/**
 * When the batch hits OR exceeds this count, the retry-batch route gates on a
 * cost-preview confirmation. Mirrors the frontend constant per spec.md.
 */
export const RETRY_BATCH_STORY_COUNT_THRESHOLD = 5;

/**
 * When the estimated token cost exceeds this value, the retry-batch route
 * gates on a cost-preview confirmation. Mirrors the frontend constant.
 */
export const RETRY_BATCH_TOKEN_THRESHOLD = 50000;

/**
 * Constant string surfaced to clients so the UI / logs can identify which
 * threshold combination triggered the gate.
 */
export const RETRY_BATCH_THRESHOLD_LABEL = '5_stories_or_50k_tokens';

// ---------------------------------------------------------------------------
// Production dep wiring (re-used between proxies + retry-batch)
// ---------------------------------------------------------------------------

const productionDeps: ShapeSpecGenerationDeps = {
  fetchProjectConfig: fetchProjectConfigWithDefaults,
  autoSeedEpicCapturedDecision,
  // The retry-batch path regenerates through the SAME handler as the primary
  // spec-generation routes, so it must carry the same confirmed-manifest seed
  // source. Without it the scaffold story regenerates to a FALSE
  // insufficient_context ("no confirmed manifest") even when the manifest IS
  // confirmed — the handler treats an unwired source as a deliberate no-op.
  seedBuildFilesSource: productionSeedBuildFilesSource,
  // Decision→manifest auto-apply (2026-08-16): same wiring as the primary
  // route — the seeded pom must be decision-consistent on retry too.
  autoApplyDecisionAdditions,
};

// ---------------------------------------------------------------------------
// Cost-preview threshold gating helper
// ---------------------------------------------------------------------------

export interface CostPreviewGateInput {
  projectId: string;
  bookOfWorkId: string;
  workItemIds: string[];
}

export interface CostPreviewGateResult {
  requiresConfirmation: boolean;
  costPreview?: CostPreviewResponse;
  estimatedTokens?: number;
  estimatedWallClockSeconds?: number;
  threshold?: string;
}

/**
 * Decide whether a retry-batch call must show the cost-preview modal first.
 *
 * Logic:
 *   - If `workItemIds.length >= RETRY_BATCH_STORY_COUNT_THRESHOLD` -> gate.
 *   - Otherwise compute the cost preview; if `estimatedTokens >
 *     RETRY_BATCH_TOKEN_THRESHOLD` -> gate.
 *   - When neither rule triggers, return `{ requiresConfirmation: false }`.
 *
 * The cost-preview computation is intentionally skipped when the story-count
 * rule already triggers -- we still surface the preview to the client by
 * computing it here so the response carries the data the modal needs.
 *
 * Note: this helper computes the preview AGAINST THE BOOK OF WORK, not the
 * filtered subset. The downstream batch handler is given the filtered
 * `targetWorkItemIds`; the preview is used only as a "rough order of
 * magnitude" signal per the existing cost-preview docstring.
 */
export async function evaluateCostPreviewGate(
  input: CostPreviewGateInput,
): Promise<CostPreviewGateResult> {
  const hitsStoryCount =
    input.workItemIds.length >= RETRY_BATCH_STORY_COUNT_THRESHOLD;

  // Always compute the preview when ANY threshold COULD trigger -- the story
  // count rule triggers regardless, and the token rule needs the preview to
  // evaluate. Computing once avoids redundant AMS round-trips.
  const costPreview = await computeCostPreview({
    projectId: input.projectId,
    bookOfWorkId: input.bookOfWorkId,
  });

  const hitsTokenBudget =
    costPreview.estimatedTokens > RETRY_BATCH_TOKEN_THRESHOLD;

  if (hitsStoryCount || hitsTokenBudget) {
    return {
      requiresConfirmation: true,
      costPreview,
      estimatedTokens: costPreview.estimatedTokens,
      estimatedWallClockSeconds: costPreview.estimatedWallClockSeconds,
      threshold: RETRY_BATCH_THRESHOLD_LABEL,
    };
  }

  return {
    requiresConfirmation: false,
    estimatedTokens: costPreview.estimatedTokens,
    estimatedWallClockSeconds: costPreview.estimatedWallClockSeconds,
  };
}

// ---------------------------------------------------------------------------
// Proxy helpers (mirror `epicCapturedDecisions.ts` patterns)
// ---------------------------------------------------------------------------

async function pipeUpstream(
  upstream: globalThis.Response,
  res: ExpressResponse,
): Promise<void> {
  const text = await upstream.text();
  res.status(upstream.status);
  const contentType = upstream.headers.get('content-type');
  if (contentType) res.setHeader('content-type', contentType);
  res.send(text);
}

function handleUpstreamError(
  res: ExpressResponse,
  error: unknown,
  route: string,
  requestId: string,
  extra: Record<string, string>,
): void {
  const message = error instanceof Error ? error.message : 'Unknown error';
  logger.error(
    `Missing input resolutions proxy: upstream fetch failed (${route})`,
    {
      requestId,
      ...extra,
      error: message,
    },
  );
  console.warn(
    `[diag-gw] route=missing-input-resolutions-${route} status=503`,
  );
  res.status(503).json({
    error: {
      code: 503,
      message: 'Architecture model service unavailable',
      details: message,
    },
  });
}

// ---------------------------------------------------------------------------
// POST /api/projects/:projectId/missing-input-resolutions  (single create)
// ---------------------------------------------------------------------------

missingInputResolutionsRouter.post(
  '/projects/:projectId/missing-input-resolutions',
  async (req: Request, res: ExpressResponse) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId } = req.params;
    const baseUrl = getConfig().architectureModelServiceBaseUrl;
    const url =
      `${baseUrl}/api/projects/${encodeURIComponent(projectId)}` +
      `/missing-input-resolutions`;
    const start = Date.now();
    try {
      const upstream = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(req.body ?? {}),
      });
      console.log(
        `[diag-gw] route=missing-input-resolutions-create status=${upstream.status} ` +
          `elapsed_ms=${Date.now() - start}`,
      );
      await pipeUpstream(upstream, res);
    } catch (error) {
      handleUpstreamError(res, error, 'create', requestId, { projectId });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/projects/:projectId/missing-input-resolutions/bulk
// ---------------------------------------------------------------------------

missingInputResolutionsRouter.post(
  '/projects/:projectId/missing-input-resolutions/bulk',
  async (req: Request, res: ExpressResponse) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId } = req.params;
    const baseUrl = getConfig().architectureModelServiceBaseUrl;
    const url =
      `${baseUrl}/api/projects/${encodeURIComponent(projectId)}` +
      `/missing-input-resolutions/bulk`;
    const start = Date.now();
    try {
      const upstream = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(req.body ?? {}),
      });
      console.log(
        `[diag-gw] route=missing-input-resolutions-bulk status=${upstream.status} ` +
          `elapsed_ms=${Date.now() - start}`,
      );
      await pipeUpstream(upstream, res);
    } catch (error) {
      handleUpstreamError(res, error, 'bulk', requestId, { projectId });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/projects/:projectId/missing-input-resolutions/parse-files
// ---------------------------------------------------------------------------
//
// Spec: 2026-05-20 Bulk-Resolve OAS/WSDL Parser -- Task Group 5.
//
// Thin multipart pass-through. AMS owns format detection, parsing,
// classification, and the optional commit. The gateway buffers parts via
// multer memoryStorage, re-streams them to AMS as a single FormData body
// (preserving the `files` field name, positional `serviceNames` ordering,
// `commit` flag, and optional `resolvedBy`), and pipes the AMS status + body
// back to the caller verbatim.
//
// Size limits: we DO NOT impose an arbitrary gateway-layer cap below the
// AMS per-project cap; that would short-circuit the "AMS enforces from
// project config" contract. We do set an explicit 100 MB-per-file ceiling
// (well above the default 10 MB and the documented 200 MB client max) so
// the multer default 1 MB doesn't silently truncate uploads. AMS continues
// to enforce the real per-project cap and the 5x total cap.

/**
 * Per-file size ceiling at the gateway layer.
 *
 * Set deliberately HIGH (100 MB) so the per-project cap enforced by AMS is
 * what actually constrains the user. Without this override, multer's default
 * of "no fileSize limit" still applies, but giving it an explicit number is
 * defensive against future multer defaults changes and lets us emit a clean
 * 413 with a reason string instead of an upstream parse error.
 */
const PARSE_FILES_PER_FILE_BYTES = 100 * 1024 * 1024; // 100 MB

const parseFilesUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: PARSE_FILES_PER_FILE_BYTES,
  },
});

missingInputResolutionsRouter.post(
  '/projects/:projectId/missing-input-resolutions/parse-files',
  (req: Request, res: ExpressResponse, next) => {
    // `.any()` accepts the `files` field (one entry per file part) plus all
    // companion text fields (`serviceNames`, `commit`, `resolvedBy`). The
    // AMS controller binds `serviceNames` as a `@RequestParam List<String>`
    // so it sees positional ordering -- we preserve that ordering when
    // rebuilding the FormData below.
    parseFilesUpload.any()(req, res, (err: unknown) => {
      if (err) {
        const code = (err as { code?: string }).code;
        if (code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({
            error: {
              code: 413,
              message: `One or more files exceed the gateway per-file size limit of ${PARSE_FILES_PER_FILE_BYTES} bytes`,
            },
          });
        }
        logger.warn(
          'Missing input resolutions parse-files: multer error parsing multipart body',
          {
            code,
            message: err instanceof Error ? err.message : String(err),
          },
        );
        return res.status(400).json({
          error: {
            code: 400,
            message: `Multipart parse error: ${err instanceof Error ? err.message : String(err)}`,
          },
        });
      }
      return next();
    });
  },
  async (req: Request, res: ExpressResponse) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId } = req.params;
    const baseUrl = getConfig().architectureModelServiceBaseUrl;

    // Forward any incoming query string verbatim (the AMS endpoint reads
    // `commit` from either form or query; the frontend currently posts it
    // as a form field but the spec calls out query forwarding too).
    const queryIdx = req.originalUrl.indexOf('?');
    const incomingQuery = queryIdx >= 0 ? req.originalUrl.substring(queryIdx + 1) : '';
    const qs = incomingQuery ? `?${incomingQuery}` : '';

    const url =
      `${baseUrl}/api/projects/${encodeURIComponent(projectId)}` +
      `/missing-input-resolutions/parse-files${qs}`;

    const allParts = (req.files as Express.Multer.File[] | undefined) || [];
    // Separate file parts (field name `files`) from any other multer-captured
    // parts. `multer.any()` only emits file parts here -- text fields land
    // on `req.body`. We still filter by field name to be defensive.
    const fileParts = allParts.filter((p) => p.fieldname === 'files');

    const formBody = (req.body || {}) as Record<string, unknown>;

    // Header forwarding. The AMS controller reads `X-User-Id` as the audit
    // channel; we pass it through if present so the resolved_by audit trail
    // carries the caller's identity.
    const userIdHeader =
      typeof req.headers['x-user-id'] === 'string'
        ? (req.headers['x-user-id'] as string)
        : Array.isArray(req.headers['x-user-id'])
          ? req.headers['x-user-id'][0]
          : undefined;

    const start = Date.now();

    try {
      const fd = new FormData();

      // Re-emit file parts under the same `files` field name in the order
      // they were uploaded (multer preserves arrival order in `req.files`).
      for (const f of fileParts) {
        const blob = new Blob([new Uint8Array(f.buffer)], {
          type: f.mimetype || 'application/octet-stream',
        });
        fd.append('files', blob, f.originalname);
      }

      // Re-emit text fields. `serviceNames` may arrive as either a single
      // string (one entry) or an array of strings (multer multi-value
      // semantics: multer's body parsing produces an array when the same
      // field name appears more than once). We re-append each entry under
      // the same field name to preserve AMS's positional binding.
      for (const [key, value] of Object.entries(formBody)) {
        if (Array.isArray(value)) {
          for (const v of value) {
            if (v !== null && v !== undefined) {
              fd.append(key, String(v));
            }
          }
        } else if (value !== null && value !== undefined) {
          fd.append(key, String(value));
        }
      }

      const init: RequestInit = {
        method: 'POST',
        body: fd,
        // Do NOT set Content-Type manually -- the fetch implementation
        // sets the `multipart/form-data; boundary=...` header automatically
        // when the body is a FormData instance. Setting it manually would
        // strip the boundary parameter.
        headers: userIdHeader ? { 'X-User-Id': userIdHeader } : undefined,
      };

      const upstream = await fetch(url, init);
      console.log(
        `[diag-gw] route=missing-input-resolutions-parse-files status=${upstream.status} ` +
          `files=${fileParts.length} elapsed_ms=${Date.now() - start}`,
      );
      await pipeUpstream(upstream, res);
    } catch (error) {
      handleUpstreamError(res, error, 'parse-files', requestId, { projectId });
    }
  },
);

// ---------------------------------------------------------------------------
// DELETE /api/projects/:projectId/missing-input-resolutions/:id
// ---------------------------------------------------------------------------

missingInputResolutionsRouter.delete(
  '/projects/:projectId/missing-input-resolutions/:id',
  async (req: Request, res: ExpressResponse) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId, id } = req.params;
    const baseUrl = getConfig().architectureModelServiceBaseUrl;
    // Forward optional `?deletedBy=` so the frontend can stamp the soft-delete
    // audit trail through the same path; AMS reads it from the query string.
    const deletedBy =
      typeof req.query.deletedBy === 'string' ? req.query.deletedBy : null;
    const qs = deletedBy
      ? `?deletedBy=${encodeURIComponent(deletedBy)}`
      : '';
    const url =
      `${baseUrl}/api/projects/${encodeURIComponent(projectId)}` +
      `/missing-input-resolutions/${encodeURIComponent(id)}${qs}`;
    const start = Date.now();
    try {
      const upstream = await fetch(url, {
        method: 'DELETE',
        headers: { Accept: 'application/json' },
      });
      console.log(
        `[diag-gw] route=missing-input-resolutions-delete status=${upstream.status} ` +
          `elapsed_ms=${Date.now() - start}`,
      );
      await pipeUpstream(upstream, res);
    } catch (error) {
      handleUpstreamError(res, error, 'delete', requestId, { projectId, id });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/projects/:projectId/missing-input-resolutions
// ---------------------------------------------------------------------------

missingInputResolutionsRouter.get(
  '/projects/:projectId/missing-input-resolutions',
  async (req: Request, res: ExpressResponse) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId } = req.params;
    const baseUrl = getConfig().architectureModelServiceBaseUrl;
    // Forward optional filters `?type=` and `?missingInputKey=` verbatim.
    const queryParts: string[] = [];
    if (typeof req.query.type === 'string') {
      queryParts.push(`type=${encodeURIComponent(req.query.type)}`);
    }
    if (typeof req.query.missingInputKey === 'string') {
      queryParts.push(
        `missingInputKey=${encodeURIComponent(req.query.missingInputKey)}`,
      );
    }
    const qs = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';
    const url =
      `${baseUrl}/api/projects/${encodeURIComponent(projectId)}` +
      `/missing-input-resolutions${qs}`;
    const start = Date.now();
    try {
      const upstream = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      console.log(
        `[diag-gw] route=missing-input-resolutions-list status=${upstream.status} ` +
          `elapsed_ms=${Date.now() - start}`,
      );
      await pipeUpstream(upstream, res);
    } catch (error) {
      handleUpstreamError(res, error, 'list', requestId, { projectId });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/projects/:projectId/spec-generations/ready-to-retry
// ---------------------------------------------------------------------------

missingInputResolutionsRouter.get(
  '/projects/:projectId/spec-generations/ready-to-retry',
  async (req: Request, res: ExpressResponse) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId } = req.params;
    const baseUrl = getConfig().architectureModelServiceBaseUrl;
    const url =
      `${baseUrl}/api/projects/${encodeURIComponent(projectId)}` +
      `/spec-generations/ready-to-retry`;
    const start = Date.now();
    try {
      const upstream = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      console.log(
        `[diag-gw] route=spec-generations-ready-to-retry status=${upstream.status} ` +
          `elapsed_ms=${Date.now() - start}`,
      );
      await pipeUpstream(upstream, res);
    } catch (error) {
      handleUpstreamError(res, error, 'ready-to-retry', requestId, {
        projectId,
      });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/projects/:projectId/spec-generations/retry-batch
// ---------------------------------------------------------------------------
// This route INTERCEPTS the AMS 501 envelope and runs the batch in the
// gateway. The matching AMS endpoint is documented to return 501 (see
// `SpecGenerationRetryController.retryBatch`) because the batch handler that
// actually runs shape-spec generation lives in the gateway.

missingInputResolutionsRouter.post(
  '/projects/:projectId/spec-generations/retry-batch',
  async (req: Request, res: ExpressResponse) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId } = req.params;
    const body = (req.body ?? {}) as {
      workItemIds?: unknown;
      bookOfWorkId?: unknown;
      confirmed?: unknown;
      confirmOverwrite?: unknown;
      // In-Product Spec Editor + Confirm-Overwrite (2026-05-20, Task Group 5).
      overwriteManuallyEdited?: unknown;
      manuallyEditedWorkItemIdsToOverwrite?: unknown;
    };
    const start = Date.now();

    // Validate required body fields.
    const bookOfWorkId =
      typeof body.bookOfWorkId === 'string' ? body.bookOfWorkId : null;
    if (!bookOfWorkId) {
      res.status(400).json({
        error: { code: 400, message: 'bookOfWorkId is required.' },
      });
      return;
    }
    if (!Array.isArray(body.workItemIds) || body.workItemIds.length === 0) {
      res.status(400).json({
        error: {
          code: 400,
          message: 'workItemIds must be a non-empty array.',
        },
      });
      return;
    }
    const workItemIds = body.workItemIds.filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );
    if (workItemIds.length === 0) {
      res.status(400).json({
        error: {
          code: 400,
          message: 'workItemIds must contain at least one non-empty string.',
        },
      });
      return;
    }

    const confirmed = body.confirmed === true;

    try {
      // Cost-preview threshold gate. When the request is NOT yet confirmed
      // and the batch meets either threshold, return the preview INSTEAD of
      // running the batch. The client must re-POST with `confirmed: true`
      // once the user accepts the preview.
      if (!confirmed) {
        const gate = await evaluateCostPreviewGate({
          projectId,
          bookOfWorkId,
          workItemIds,
        });
        if (gate.requiresConfirmation) {
          console.log(
            `[diag-gw] route=spec-generations-retry-batch status=200 ` +
              `gate=requires_confirmation ` +
              `elapsed_ms=${Date.now() - start} ` +
              `workItemCount=${workItemIds.length} ` +
              `estimatedTokens=${gate.estimatedTokens ?? 0}`,
          );
          res.status(200).json({
            requiresConfirmation: true,
            costPreview: gate.costPreview,
            threshold: gate.threshold,
          });
          return;
        }
      }

      const result = await runShapeSpecGenerationBatch(
        {
          projectId,
          bookOfWorkId,
          regenerateAll: true,
          confirmOverwrite:
            typeof body.confirmOverwrite === 'boolean'
              ? body.confirmOverwrite
              : false,
          targetWorkItemIds: workItemIds,
          // In-Product Spec Editor + Confirm-Overwrite (2026-05-20, Task
          // Group 5): forward the overwrite flag + allow-list so the
          // handler's pre-flight + filter step splits the candidate set
          // into "overwrite" vs "skip" before the batch loop fires.
          overwriteManuallyEdited:
            typeof body.overwriteManuallyEdited === 'boolean'
              ? body.overwriteManuallyEdited
              : undefined,
          manuallyEditedWorkItemIdsToOverwrite: Array.isArray(
            body.manuallyEditedWorkItemIdsToOverwrite,
          )
            ? (body.manuallyEditedWorkItemIdsToOverwrite as unknown[]).filter(
                (v): v is string => typeof v === 'string' && v.length > 0,
              )
            : undefined,
        },
        productionDeps,
      );
      console.log(
        `[diag-gw] route=spec-generations-retry-batch status=200 ` +
          `elapsed_ms=${Date.now() - start} ` +
          `generated=${result.summary.generated} ` +
          `failed=${result.summary.failed}`,
      );
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof WorkstreamLockedError) {
        console.warn(
          `[diag-gw] route=spec-generations-retry-batch status=409 ` +
            `elapsed_ms=${Date.now() - start} ` +
            `workstreamId=${error.workstreamId} activePass=${error.activePass}`,
        );
        res.status(409).json({
          code: 'WORKSTREAM_LOCKED',
          message: error.message,
          workstreamId: error.workstreamId,
          activePass: error.activePass,
        });
        return;
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Shape-spec retry-batch: unexpected error', {
        requestId,
        projectId,
        bookOfWorkId,
        error: message,
      });
      console.warn(
        `[diag-gw] route=spec-generations-retry-batch status=500 ` +
          `elapsed_ms=${Date.now() - start}`,
      );
      res.status(500).json({
        error: {
          code: 500,
          message: 'Shape-spec retry-batch failed',
          details: message,
        },
      });
    }
  },
);
