/**
 * Migration Shape-Spec Batch Generation route file.
 *
 * Spec 2026-05-19 PM Migration Shape-Spec Batch Generation (Spec 2) —
 * follow-up wiring to expose the existing
 * `migrationShapeSpecGenerationHandler` service through HTTP endpoints.
 *
 * Mounted at `/api/v1` (see `server.ts`). Routes:
 *
 *   POST /api/v1/projects/:projectId/migration-books-of-work/:bookId/spec-generations/generate-batch
 *     Body: `{ batchSize?, regenerateAll?, skipBlockedStories?, confirmOverwrite? }`
 *     Response: `BatchResult` (see handler).
 *
 *   POST /api/v1/projects/:projectId/migration-books-of-work/:bookId/spec-generations/regenerate-single
 *     Body: `{ workItemId, confirmOverwrite? }`
 *     Response: `BatchResult` scoped to the single story.
 *     Internally calls `runShapeSpecGenerationBatch` with
 *     `{ regenerateAll: true, batchSize: 1, targetWorkItemIds: [workItemId] }`
 *     so the batch-selection step picks the story by id rather than by
 *     `sequenceOrder`.
 *
 *   POST /api/v1/projects/:projectId/spec-generations/:specId/recompute-quality
 *     Spec 2026-05-20 Spec Quality Scoring — Task Group 5.2.
 *     Thin pass-through to the AMS single-row quality-recompute endpoint.
 *     Returns `{ qualityScore, qualityGrade, qualityDimensions,
 *     previousQualityScore }` from the updated row. NO LLM contact.
 *
 *   POST /api/v1/projects/:projectId/spec-generations/recompute-quality-bulk
 *     Spec 2026-05-20 Spec Quality Scoring — Task Group 5.3.
 *     Thin pass-through to the AMS project-wide quality-recompute endpoint.
 *     Returns `{ totalScored, totalSkipped, gradeBreakdown: { A, B, C, D, F,
 *     na } }`. NO LLM contact.
 *
 *   POST /api/v1/projects/:projectId/migration-books-of-work/:bookId/spec-generations/preflight
 *     Phase 0 (2026-07-20) — the ONE readiness function. Runs the generator's
 *     own first half (carriage checks / focused-context resolver +
 *     detectInsufficientContext) for EVERY story and stops before the LLM.
 *     Response: `{ rows: SpecPreflightRow[] }`. Read-only; NO LLM contact.
 *
 * Auth gating: matches `migrationBookOfWork.ts` (Spec 1) — no role gate today.
 * R-11 says the gating mirrors the PM-task entry from Spec 1; both routers
 * should adopt project-wide gating together when it lands.
 *
 * Error mapping mirrors `migrationBookOfWork.ts`:
 *   - 400 on missing required input
 *   - 409 with `{ code: 'WORKSTREAM_LOCKED', message, workstreamId, activePass }`
 *     when {@link WorkstreamLockedError} fires (cross-story context injection,
 *     2026-05-20 Task Group 5.7). The frontend translates this to the
 *     "Batch in progress" banner.
 *   - 500 with structured envelope for unexpected errors
 *   - Per-story failures are NOT surfaced as HTTP errors — they live inside
 *     the `BatchResult` body (R-12 per-story failure isolation). The HTTP
 *     status is 200 even when every story in the batch failed; the caller
 *     reads `summary.failed` to render those failures.
 *
 * For the two recompute-quality proxy routes (Spec 2026-05-20 Spec Quality
 * Scoring), the gateway is pure pass-through: AMS status + body are
 * round-tripped verbatim, including 4xx/5xx envelopes. The `X-User-Id`
 * header is forwarded when present so any AMS-side audit channel sees the
 * originating caller.
 */

import { Router, Request, Response } from 'express';
import { getConfig } from '../config';
import { logger } from '../services/logger';
import {
  runShapeSpecGenerationBatch,
  RunShapeSpecGenerationBatchInput,
  ShapeSpecGenerationDeps,
  WorkstreamLockedError,
} from '../services/migrationShapeSpecGenerationHandler';
import { runSpecPreflight } from '../services/migrationSpecPreflight';
import { fetchProjectConfigWithDefaults } from '../services/architectureModelClient';
import { autoSeedEpicCapturedDecision } from '../services/epicCapturedDecisionsClient';
// Spec 5 Phase 2 (2026-06-25-confirmed-manifest-producer-wiring, Task Group 5):
// the REAL production confirmed-manifest source. It reads the persisted LATEST
// confirmed-manifest artifacts for `(projectId, targetArchitectureId)` (written
// at upload by Task Group 3) via the Task Group 2 gateway -> AMS client, builds
// the v1 convention service->module mapping (`tag -> <tag>/`, monorepo), and
// returns the seed bundle (or null). It is a safe no-op when no
// `targetArchitectureId` / no persisted artifacts, and fail-soft (a read hiccup
// degrades to null, never throwing into the batch). This REPLACES the prior
// honest-v1 no-op `defaultProductionSeedBuildFilesSource`; tests still inject a
// concrete source.
import { productionSeedBuildFilesSource } from '../services/migrationSeedBuildFilesProducer';

export const migrationShapeSpecGenerationRouter = Router();

// Production dep wiring for the cross-story two-pass loop.
// Without this, the handler treats `autoRunPass2` as false by default and
// `autoSeedEpicCapturedDecision` as a no-op (see handler docstring at line 1009
// and 1137). Wiring here ensures production behaviour matches spec defaults.
//
// In-Product Spec Editor + Confirm-Overwrite (2026-05-20, Task Group 5): the
// handler exposes `fetchManuallyEditedInScope` + `clearManuallyEditedFlag`
// dep seams. Production leaves them undefined so the handler uses its own
// AMS-default implementations (defaultFetchManuallyEditedInScope +
// defaultClearManuallyEditedFlag). Tests override the seams via the
// dep-injection path.
const productionDeps: ShapeSpecGenerationDeps = {
  fetchProjectConfig: fetchProjectConfigWithDefaults,
  autoSeedEpicCapturedDecision,
  // Spec 5 Phase 2 (Task Group 5): the REAL seed-build-files carriage source
  // (the one-line flip). It reads the persisted latest confirmed-manifest
  // artifacts and emits the verbatim build file(s) per module; it stays a safe
  // no-op (null) when there is no target architecture / nothing persisted, and
  // is fail-soft (a read hiccup degrades to null). This is the ONLY change to
  // the consumer-side carriage.
  seedBuildFilesSource: productionSeedBuildFilesSource,
};

// ---------------------------------------------------------------------------
// POST .../spec-generations/preflight — the ONE readiness function (Phase 0)
// ---------------------------------------------------------------------------

migrationShapeSpecGenerationRouter.post(
  '/projects/:projectId/migration-books-of-work/:bookId/spec-generations/preflight',
  async (req: Request, res: Response) => {
    const { projectId, bookId } = req.params;
    const start = Date.now();
    try {
      const { rows, warnings } = await runSpecPreflight({
        projectId,
        bookOfWorkId: bookId,
      });
      console.log(
        `[diag-gw] route=spec-generations-preflight status=200 ` +
          `elapsed_ms=${Date.now() - start} stories=${rows.length} ` +
          `ready=${rows.filter((r) => r.ready).length} warnings=${warnings.length}`
      );
      res.status(200).json({ rows, warnings });
    } catch (error) {
      logger.error('Spec preflight: unexpected error', {
        projectId,
        bookId,
        error: error instanceof Error ? error.message : String(error),
      });
      console.warn(
        `[diag-gw] route=spec-generations-preflight status=500 elapsed_ms=${Date.now() - start}`
      );
      res.status(500).json({
        error: {
          message: error instanceof Error ? error.message : 'Preflight failed',
        },
      });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/v1/projects/:projectId/migration-books-of-work/:bookId/spec-generations/generate-batch
// ---------------------------------------------------------------------------

migrationShapeSpecGenerationRouter.post(
  '/projects/:projectId/migration-books-of-work/:bookId/spec-generations/generate-batch',
  async (req: Request, res: Response) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId, bookId } = req.params;
    const body = (req.body ?? {}) as Partial<RunShapeSpecGenerationBatchInput>;
    const start = Date.now();
    try {
      const result = await runShapeSpecGenerationBatch({
        projectId,
        bookOfWorkId: bookId,
        batchSize: body.batchSize,
        regenerateAll: body.regenerateAll,
        skipBlockedStories: body.skipBlockedStories,
        confirmOverwrite: body.confirmOverwrite,
        maxFindings: body.maxFindings,
        maxEvidenceItems: body.maxEvidenceItems,
        maxBaselineItems: body.maxBaselineItems,
        autoRunPass2: body.autoRunPass2,
        workstreamId: body.workstreamId,
        // Selective generation: when the workspace sends an explicit work-item
        // whitelist (the "Generate specs for selected" action), forward it so
        // the handler's selectEligibleStories restricts the batch to exactly
        // those stories. Omitted/empty == "all eligible" (unchanged behaviour).
        targetWorkItemIds: body.targetWorkItemIds,
        // In-Product Spec Editor + Confirm-Overwrite (2026-05-20, Task Group 5):
        // pass through the overwrite flag + allow-list so the handler's
        // pre-flight + filter step (applyManuallyEditedPreFlight) can split
        // the candidate set into "overwrite" vs "skip" before the batch loop.
        overwriteManuallyEdited: body.overwriteManuallyEdited,
        manuallyEditedWorkItemIdsToOverwrite:
          body.manuallyEditedWorkItemIdsToOverwrite,
      }, productionDeps);
      console.log(
        `[diag-gw] route=spec-generations-generate-batch status=200 ` +
          `elapsed_ms=${Date.now() - start} ` +
          `generated=${result.summary.generated} ` +
          `failed=${result.summary.failed}`
      );
      res.status(200).json(result);
    } catch (error) {
      // 409 -- concurrency lock held by another batch on the same workstream.
      // Cross-story context injection 2026-05-20, Task Group 5.7. The frontend
      // (`startBatchGeneration` in `specGenerationApi.ts`) detects this
      // structured envelope and surfaces a "Batch in progress" banner.
      if (error instanceof WorkstreamLockedError) {
        console.warn(
          `[diag-gw] route=spec-generations-generate-batch status=409 ` +
            `elapsed_ms=${Date.now() - start} workstreamId=${error.workstreamId} ` +
            `activePass=${error.activePass}`
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
      logger.error('Shape-spec generate-batch: unexpected error', {
        requestId,
        projectId,
        bookId,
        error: message,
      });
      console.warn(
        `[diag-gw] route=spec-generations-generate-batch status=500 ` +
          `elapsed_ms=${Date.now() - start}`
      );
      res.status(500).json({
        error: {
          code: 500,
          message: 'Shape-spec batch generation failed',
          details: message,
        },
      });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/v1/projects/:projectId/migration-books-of-work/:bookId/spec-generations/regenerate-single
// ---------------------------------------------------------------------------

migrationShapeSpecGenerationRouter.post(
  '/projects/:projectId/migration-books-of-work/:bookId/spec-generations/regenerate-single',
  async (req: Request, res: Response) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId, bookId } = req.params;
    const body = (req.body ?? {}) as {
      workItemId?: string;
      confirmOverwrite?: boolean;
      // In-Product Spec Editor + Confirm-Overwrite (2026-05-20, Task Group 5).
      overwriteManuallyEdited?: boolean;
      manuallyEditedWorkItemIdsToOverwrite?: string[];
    };
    if (!body.workItemId || typeof body.workItemId !== 'string') {
      res.status(400).json({
        error: {
          code: 400,
          message: 'workItemId is required.',
        },
      });
      return;
    }
    const start = Date.now();
    try {
      const result = await runShapeSpecGenerationBatch({
        projectId,
        bookOfWorkId: bookId,
        batchSize: 1,
        regenerateAll: true,
        confirmOverwrite: !!body.confirmOverwrite,
        targetWorkItemIds: [body.workItemId],
        // In-Product Spec Editor + Confirm-Overwrite (2026-05-20, Task Group 5):
        // pass through the overwrite flag + allow-list so the regenerate-single
        // path can clear the manually_edited flag when the user confirms.
        overwriteManuallyEdited: body.overwriteManuallyEdited,
        manuallyEditedWorkItemIdsToOverwrite:
          body.manuallyEditedWorkItemIdsToOverwrite,
      }, productionDeps);
      console.log(
        `[diag-gw] route=spec-generations-regenerate-single status=200 ` +
          `elapsed_ms=${Date.now() - start} workItemId=${body.workItemId}`
      );
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof WorkstreamLockedError) {
        console.warn(
          `[diag-gw] route=spec-generations-regenerate-single status=409 ` +
            `elapsed_ms=${Date.now() - start} workstreamId=${error.workstreamId} ` +
            `activePass=${error.activePass}`
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
      logger.error('Shape-spec regenerate-single: unexpected error', {
        requestId,
        projectId,
        bookId,
        workItemId: body.workItemId,
        error: message,
      });
      console.warn(
        `[diag-gw] route=spec-generations-regenerate-single status=500 ` +
          `elapsed_ms=${Date.now() - start}`
      );
      res.status(500).json({
        error: {
          code: 500,
          message: 'Shape-spec single-story regenerate failed',
          details: message,
        },
      });
    }
  }
);

// ---------------------------------------------------------------------------
// Spec 2026-05-20 Spec Quality Scoring — Task Group 5
//
// Thin pass-through proxies for the AMS quality-recompute endpoints. The
// gateway does NOT score anything itself and does NOT contact the LLM; it
// only forwards the call and round-trips the AMS status + body verbatim.
//
// The pattern mirrors `missingInputResolutions.ts` (which is mounted at
// `/api`); here we live at `/api/v1` per the spec.md path contract:
//
//   POST /api/v1/projects/:projectId/spec-generations/:specId/recompute-quality
//   POST /api/v1/projects/:projectId/spec-generations/recompute-quality-bulk
//
// Both routes preserve 4xx/5xx envelopes (404 from AMS round-trips back as
// 404 with body intact) and forward the optional `X-User-Id` header to AMS
// for downstream audit channels.
// ---------------------------------------------------------------------------

/**
 * Pipe an upstream Node/Web `Response` back through the Express response.
 * Status code, `Content-Type` (when present), and body text are forwarded
 * verbatim. Mirrors the helper in `missingInputResolutions.ts`.
 */
async function pipeUpstream(
  upstream: globalThis.Response,
  res: Response,
): Promise<void> {
  const text = await upstream.text();
  res.status(upstream.status);
  const contentType = upstream.headers.get('content-type');
  if (contentType) res.setHeader('content-type', contentType);
  res.send(text);
}

/**
 * Pull `X-User-Id` off the incoming request, tolerant of single-string and
 * array shapes Express may surface for repeated headers. Returns `undefined`
 * when the header is absent so callers can omit it from forwarded headers.
 */
function readUserIdHeader(req: Request): string | undefined {
  const raw = req.headers['x-user-id'];
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && raw.length > 0) return raw[0];
  return undefined;
}

/**
 * Common error envelope for AMS-unreachable cases. The thin-proxy contract
 * is "pass-through" for AMS responses, but a transport-layer failure (DNS,
 * connect refused) is not an AMS response — we surface a 503 so the caller
 * can distinguish "AMS said 5xx" from "AMS unreachable".
 */
function handleQualityRecomputeUpstreamError(
  res: Response,
  error: unknown,
  route: string,
  requestId: string,
  extra: Record<string, string>,
): void {
  const message = error instanceof Error ? error.message : 'Unknown error';
  logger.error(
    `Migration shape-spec recompute-quality proxy: upstream fetch failed (${route})`,
    {
      requestId,
      ...extra,
      error: message,
    },
  );
  console.warn(
    `[diag-gw] route=spec-generations-${route} status=503`,
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
// POST /api/v1/projects/:projectId/spec-generations/:specId/recompute-quality
// ---------------------------------------------------------------------------

migrationShapeSpecGenerationRouter.post(
  '/projects/:projectId/spec-generations/:specId/recompute-quality',
  async (req: Request, res: Response) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId, specId } = req.params;
    const baseUrl = getConfig().architectureModelServiceBaseUrl;
    const url =
      `${baseUrl}/api/projects/${encodeURIComponent(projectId)}` +
      `/spec-generations/${encodeURIComponent(specId)}/recompute-quality`;
    const userIdHeader = readUserIdHeader(req);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (userIdHeader) headers['X-User-Id'] = userIdHeader;
    const start = Date.now();
    try {
      const upstream = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(req.body ?? {}),
      });
      console.log(
        `[diag-gw] route=spec-generations-recompute-quality ` +
          `status=${upstream.status} elapsed_ms=${Date.now() - start}`,
      );
      await pipeUpstream(upstream, res);
    } catch (error) {
      handleQualityRecomputeUpstreamError(res, error, 'recompute-quality', requestId, {
        projectId,
        specId,
      });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/v1/projects/:projectId/spec-generations/recompute-quality-bulk
// ---------------------------------------------------------------------------

migrationShapeSpecGenerationRouter.post(
  '/projects/:projectId/spec-generations/recompute-quality-bulk',
  async (req: Request, res: Response) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId } = req.params;
    const baseUrl = getConfig().architectureModelServiceBaseUrl;
    const url =
      `${baseUrl}/api/projects/${encodeURIComponent(projectId)}` +
      `/spec-generations/recompute-quality-bulk`;
    const userIdHeader = readUserIdHeader(req);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (userIdHeader) headers['X-User-Id'] = userIdHeader;
    const start = Date.now();
    try {
      const upstream = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(req.body ?? {}),
      });
      console.log(
        `[diag-gw] route=spec-generations-recompute-quality-bulk ` +
          `status=${upstream.status} elapsed_ms=${Date.now() - start}`,
      );
      await pipeUpstream(upstream, res);
    } catch (error) {
      handleQualityRecomputeUpstreamError(
        res,
        error,
        'recompute-quality-bulk',
        requestId,
        { projectId },
      );
    }
  },
);

// ---------------------------------------------------------------------------
// In-Product Spec Editor + Confirm-Overwrite (2026-05-20, Task Group 5)
//
// Thin pass-through proxies to two new AMS endpoints introduced by Spec
// Group 3:
//
//   POST /api/v1/projects/:projectId/spec-generations/:specId/manual-edit
//     - Body `{ specText }`; header `X-User-Id`. AMS persists the manual
//       edit, re-runs the parser + scorer, and returns the updated DTO.
//
//   GET /api/v1/projects/:projectId/migration-books-of-work/:bookId/
//       spec-generations/manually-edited-in-scope
//     - Optional query `?workItemIds=...&workItemIds=...` narrows the
//       candidate set (drives the retry-batch flow's pre-flight). Returns
//       the list of manually-edited rows the bulk picker will show.
//
// Both routes preserve 4xx/5xx envelopes (404 from AMS round-trips back as
// 404 with body intact) and forward the optional `X-User-Id` header to AMS.
// No new LLM calls or token-counting logic.
// ---------------------------------------------------------------------------

migrationShapeSpecGenerationRouter.post(
  '/projects/:projectId/spec-generations/:specId/manual-edit',
  async (req: Request, res: Response) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId, specId } = req.params;
    const baseUrl = getConfig().architectureModelServiceBaseUrl;
    const url =
      `${baseUrl}/api/projects/${encodeURIComponent(projectId)}` +
      `/spec-generations/${encodeURIComponent(specId)}/manual-edit`;
    const userIdHeader = readUserIdHeader(req);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (userIdHeader) headers['X-User-Id'] = userIdHeader;
    const start = Date.now();
    try {
      const upstream = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(req.body ?? {}),
      });
      console.log(
        `[diag-gw] route=spec-generations-manual-edit ` +
          `status=${upstream.status} elapsed_ms=${Date.now() - start}`,
      );
      await pipeUpstream(upstream, res);
    } catch (error) {
      handleQualityRecomputeUpstreamError(
        res,
        error,
        'manual-edit',
        requestId,
        { projectId, specId },
      );
    }
  },
);

migrationShapeSpecGenerationRouter.get(
  '/projects/:projectId/migration-books-of-work/:bookId/spec-generations/manually-edited-in-scope',
  async (req: Request, res: Response) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId, bookId } = req.params;
    const baseUrl = getConfig().architectureModelServiceBaseUrl;
    // Forward the `workItemIds` query verbatim (repeated key or comma form).
    // Express parses repeated `?workItemIds=A&workItemIds=B` as either a
    // string (single) or string[] (multi); we re-serialise into the same
    // shape AMS expects on its @RequestParam List<UUID>.
    const baseUrl2 = baseUrl; // alias to keep formatting consistent below
    let url =
      `${baseUrl2}/api/projects/${encodeURIComponent(projectId)}` +
      `/migration-books-of-work/${encodeURIComponent(bookId)}` +
      `/spec-generations/manually-edited-in-scope`;
    const raw = req.query.workItemIds;
    if (raw) {
      const ids: string[] = Array.isArray(raw)
        ? raw.map((v) => String(v)).filter((v) => v.length > 0)
        : [String(raw)].filter((v) => v.length > 0);
      if (ids.length > 0) {
        const qs = ids
          .map((v) => `workItemIds=${encodeURIComponent(v)}`)
          .join('&');
        url = `${url}?${qs}`;
      }
    }
    const userIdHeader = readUserIdHeader(req);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (userIdHeader) headers['X-User-Id'] = userIdHeader;
    const start = Date.now();
    try {
      const upstream = await fetch(url, { method: 'GET', headers });
      console.log(
        `[diag-gw] route=spec-generations-manually-edited-in-scope ` +
          `status=${upstream.status} elapsed_ms=${Date.now() - start}`,
      );
      await pipeUpstream(upstream, res);
    } catch (error) {
      handleQualityRecomputeUpstreamError(
        res,
        error,
        'manually-edited-in-scope',
        requestId,
        { projectId, bookId },
      );
    }
  },
);

// ---------------------------------------------------------------------------
// D3 — Internal-behaviour implementation-ready spec generation (2026-06-14)
//
// POST /api/v1/projects/:projectId/migration-books-of-work/:bookId/items/append-capability-story
//
// The explicit PER-CAPABILITY trigger: turn ONE approved D2
// `discovery_capability` into a first-class migration STORY so the already-built
// `migrationShapeSpecGenerationHandler` picks it up UNCHANGED. Thin pass-through
// to the AMS `append-capability-story` endpoint (built in Group 2), which mints a
// `type='story'` WorkItem AND appends the `book_of_work_json.items[]` blob —
// stamping the created `workItemId` + `saveState='saved'` + `source_capability_id`
// — in ONE transaction. The gateway does NOT generate anything here and does NOT
// contact the LLM; it only forwards the call and round-trips the AMS status + body
// verbatim (404 unknown book / 400 missing source_capability_id|title both flow
// back unchanged). Batch / gate-driven invocation for un-covered capabilities +
// the "Generate all" wiring is DEFERRED to D4 (out of scope here).
//
// The request body is the AMS snake_case shape:
//   { source_capability_id, title, description?, parent_book_item_id?, sequence_order? }
// The response is the AMS snake_case shape:
//   { work_item_id, book_item_id, source_capability_id, message }
// ---------------------------------------------------------------------------

migrationShapeSpecGenerationRouter.post(
  '/projects/:projectId/migration-books-of-work/:bookId/items/append-capability-story',
  async (req: Request, res: Response) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId, bookId } = req.params;
    const baseUrl = getConfig().architectureModelServiceBaseUrl;
    const url =
      `${baseUrl}/api/projects/${encodeURIComponent(projectId)}` +
      `/migration-books-of-work/${encodeURIComponent(bookId)}/items/append-capability-story`;
    const userIdHeader = readUserIdHeader(req);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (userIdHeader) headers['X-User-Id'] = userIdHeader;
    const start = Date.now();
    try {
      const upstream = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(req.body ?? {}),
      });
      console.log(
        `[diag-gw] route=append-capability-story ` +
          `status=${upstream.status} elapsed_ms=${Date.now() - start} ` +
          `projectId=${projectId} bookId=${bookId}`,
      );
      await pipeUpstream(upstream, res);
    } catch (error) {
      handleQualityRecomputeUpstreamError(
        res,
        error,
        'append-capability-story',
        requestId,
        { projectId, bookId },
      );
    }
  },
);


// ---------------------------------------------------------------------------
// D5 — Net-new backlog items + provenance (2026-06-14, Spec 5 of 6)
//
// POST /api/v1/projects/:projectId/migration-books-of-work/:bookId/items/add-item
//
// The Migration Delivery Dashboard's "Add work item" action: add ONE MANUAL
// work item (genuinely-new `net_new` work, or undiscoverable `carry_over` work
// like OS cron / vacuum schedules / ops runbooks no parser finds) to a SAVED
// book of work BEFORE Migrate. Two steps, in order:
//
//   1. Call the AMS `add-item` endpoint (built in Group 2), which mints a
//      `type='story'` WorkItem + appends the `book_of_work_json.items[]` blob
//      (stamping `workItemId` + `saveState='saved'` + `provenance` on BOTH the
//      column and the blob + the `kind` flavour on the blob), in ONE
//      transaction. The item carries NO `source_capability_id` / finding refs,
//      so it is OUTSIDE D4's discovered carry_over must-account set with no gate
//      code.
//   2. On success, trigger DESCRIPTION-GROUNDED spec-gen for the created
//      `workItemId`: the human description (carried on the blob the add-item
//      endpoint just wrote) IS the context — it REPLACES the discovered-context
//      resolver. `migrationShapeSpecGenerationHandler` runs UNCHANGED otherwise
//      (two-pass / confidence / implement-state / persistence), reaching
//      `generated` + writing the implement-state + the test pack. `kind` tunes
//      ONLY the prompt flavour (api -> endpoint; operational -> effect-test);
//      a manual add NEVER routes through D3's discovered-capability path.
//
// The spec-gen trigger is AWAITED but failure-isolated: a generation hiccup is
// logged and never fails the add (the story is already minted + dispatchable;
// the user can re-generate). When the AMS add-item call is non-2xx, the status
// + body are round-tripped verbatim (400 missing title / invalid provenance|kind,
// 404 unknown book) and generation is NOT triggered.
//
// Request body (snake_case AMS shape):
//   { provenance, kind, title, description?, parent_book_item_id?, sequence_order?,
//     net_new_operations? }   <- D6: forwarded verbatim; AMS stamps it on the blob
//                                  for net_new + api adds (the reconcile match source)
// Response: the AMS add-item body (snake_case) verbatim:
//   { work_item_id, book_item_id, provenance, kind, message }
// ---------------------------------------------------------------------------

migrationShapeSpecGenerationRouter.post(
  '/projects/:projectId/migration-books-of-work/:bookId/items/add-item',
  async (req: Request, res: Response) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId, bookId } = req.params;
    const body = (req.body ?? {}) as {
      provenance?: string;
      kind?: string;
      title?: string;
      description?: string;
      parent_book_item_id?: string;
      sequence_order?: number;
      // D6: the explicit, human-owned <METHOD> <path> operation list for a
      // net_new + api add (the AUTHORITATIVE reconcile-time match source). It is
      // forwarded VERBATIM to the AMS add-item endpoint below (the whole req.body
      // is JSON-stringified), where it rides the book_of_work_json blob item; the
      // AMS service scopes the stamp to net_new + api. Declared here only so the
      // route body shape self-documents the field that passes through.
      net_new_operations?: string[];
    };

    // Cheap client-side guard so an obviously-bad request never burns an AMS
    // round-trip (mirrors the AMS-side `title is required` 400).
    if (!body.title || typeof body.title !== 'string' || body.title.trim() === '') {
      res.status(400).json({
        error: { code: 400, message: 'title is required.' },
      });
      return;
    }

    const baseUrl = getConfig().architectureModelServiceBaseUrl;
    const url =
      `${baseUrl}/api/projects/${encodeURIComponent(projectId)}` +
      `/migration-books-of-work/${encodeURIComponent(bookId)}/items/add-item`;
    const userIdHeader = readUserIdHeader(req);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (userIdHeader) headers['X-User-Id'] = userIdHeader;
    const start = Date.now();

    let upstream: globalThis.Response;
    try {
      upstream = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(req.body ?? {}),
      });
    } catch (error) {
      handleQualityRecomputeUpstreamError(res, error, 'add-item', requestId, {
        projectId,
        bookId,
      });
      return;
    }

    // Non-2xx from AMS: round-trip the status + body verbatim and do NOT trigger
    // generation (nothing was created).
    if (!upstream.ok) {
      console.warn(
        `[diag-gw] route=add-item status=${upstream.status} ` +
          `elapsed_ms=${Date.now() - start} projectId=${projectId} bookId=${bookId}`,
      );
      await pipeUpstream(upstream, res);
      return;
    }

    // Success: read the created workItemId so we can trigger description-grounded
    // generation for exactly that story.
    let amsBody: {
      work_item_id?: string;
      book_item_id?: string;
      provenance?: string;
      kind?: string;
      message?: string;
    } = {};
    try {
      amsBody = (await upstream.json()) as typeof amsBody;
    } catch {
      amsBody = {};
    }
    const createdWorkItemId = amsBody.work_item_id;

    // Trigger description-grounded spec-gen for the created story. The handler
    // reads the manual-add provenance + kind + description off the blob the AMS
    // endpoint just wrote, so NO extra context is threaded here — it is a normal
    // single-story batch scoped to this workItemId. Failure-isolated: a
    // generation hiccup is logged and never fails the add (the story is already
    // minted + dispatchable; the user can re-generate from the dashboard).
    if (createdWorkItemId) {
      try {
        await runShapeSpecGenerationBatch(
          {
            projectId,
            bookOfWorkId: bookId,
            batchSize: 1,
            regenerateAll: true,
            targetWorkItemIds: [createdWorkItemId],
          },
          productionDeps,
        );
        console.log(
          `[diag-gw] route=add-item generation_triggered ` +
            `projectId=${projectId} bookId=${bookId} workItemId=${createdWorkItemId}`,
        );
      } catch (genError) {
        const message =
          genError instanceof Error ? genError.message : 'Unknown error';
        logger.warn(
          'Add-item: description-grounded generation trigger failed (non-blocking)',
          { requestId, projectId, bookId, workItemId: createdWorkItemId, error: message },
        );
      }
    } else {
      logger.warn('Add-item: AMS returned no work_item_id; skipping generation', {
        requestId,
        projectId,
        bookId,
      });
    }

    console.log(
      `[diag-gw] route=add-item status=200 elapsed_ms=${Date.now() - start} ` +
        `projectId=${projectId} bookId=${bookId} ` +
        `provenance=${amsBody.provenance ?? 'null'} kind=${amsBody.kind ?? 'null'}`,
    );
    res.status(200).json(amsBody);
  },
);
