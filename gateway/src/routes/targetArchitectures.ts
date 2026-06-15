/**
 * Target Architecture proxy routes + mapping-suggest LLM augmentation.
 *
 * Spec: 2026-05-20 Target Architecture Authoring Flow -- Task Group 5
 *   (sub-tasks 5.2, 5.3, 5.5).
 * Spec: 2026-05-24 Target State Sub-tab + Deterministic Suggest --
 *   Task Group 2 (sub-task 2.1) added the
 *   `POST /api/projects/:projectId/target-architectures/suggest-from-current`
 *   proxy below.
 * Spec: 2026-05-24 Target State Captured Decisions -- Data Plane --
 *   Task Group 5 (sub-tasks 5.2, 5.3, 5.4) added the captured-decisions
 *   proxy routes and the active-target-architecture-id proxy below.
 *
 * Thin pass-through proxies to the architecture-model-service endpoints
 * introduced by Task Groups 2, 3, and 4 of the 2026-05-20 spec plus the
 * deterministic Suggest endpoint added by the 2026-05-24 spec:
 *
 *   POST   /api/projects/:projectId/target-architectures/seed
 *   POST   /api/projects/:projectId/target-architectures/suggest-from-current
 *   GET    /api/projects/:projectId/target-architectures
 *   POST   /api/projects/:projectId/target-architectures/:targetArchId/promote
 *   DELETE /api/projects/:projectId/target-architectures/:targetArchId
 *   POST   /api/projects/:projectId/target-architectures/:targetArchId/decommission
 *   GET    /api/projects/:projectId/architectures/:archId/unmapped-current-elements
 *   GET    /api/projects/:projectId/architectures/:archId/decommissioned-in-target-annotations
 *   POST   /api/projects/:projectId/architectures/:archId/mapping-suggest
 *   POST   /api/projects/:projectId/specs/mark-stale
 *   GET    /api/projects/:projectId/spec-generations/stale-count
 *   POST   /api/projects/:projectId/target-architectures/:targetArchitectureId/captured-decisions
 *   GET    /api/projects/:projectId/target-architectures/:targetArchitectureId/captured-decisions
 *   GET    /api/projects/:projectId/target-architectures/:targetArchitectureId/captured-decisions/:decisionId
 *   GET    /api/projects/:projectId/target-architectures/:targetArchitectureId/captured-decisions/by-code/:decisionCode
 *   GET    /api/projects/:projectId/active-target-architecture-id
 *
 * Every handler forwards the request to AMS and re-emits the upstream status,
 * content-type, and body byte-for-byte. AMS 4xx / 5xx round-trip verbatim --
 * concurrency / lock errors (e.g. 409 `{code: "active_cannot_be_deleted"}` or
 * 409 `{code: "recent_duplicate_suggest"}` and 422
 * `{code: "empty_current_architecture"}` on the suggest-from-current path)
 * surface unchanged so the frontend can branch on `body.code`.
 *
 * The `mapping-suggest` endpoint is the only one that does extra work: it
 * forwards the call to AMS to obtain the deterministic name-similarity
 * candidate list, then reranks via a small LLM call (direct build
 * 2026-06-11; previously a v1 stub). The rerank is advisory + fail-soft —
 * any LLM failure keeps the deterministic order — and is enabled by
 * default (`TARGET_ARCH_MAPPING_SUGGEST_LLM_RERANK=0` opts out). Logic in
 * `services/mappingSuggestRerank.ts`.
 *
 * Per spec.md and tasks.md sub-task 5.5 the active-target debounce decision
 * lives on the AMS side via the `last_marked_stale_at` field. The gateway
 * proxy forwards `mark-stale` calls straight through; there is no
 * gateway-internal debounce buffer in v1.
 *
 * Mount point: `/api` (matches the AMS path verbatim).
 */

import { Router, Request, Response as ExpressResponse } from 'express';
import { getConfig } from '../config';
import { logger } from '../services/logger';
import {
  rerankMappingSuggestCandidates,
  MappingSuggestWireResponse,
} from '../services/mappingSuggestRerank';

export const targetArchitecturesRouter = Router();

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Round-trip the upstream response (status + content-type + body) back to the
 * caller. The upstream argument is the global fetch `Response` (DOM type);
 * the `res` argument is Express's `Response`.
 */
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

/**
 * Common error path: upstream fetch threw (network / DNS / connection
 * refused). Emit 503 with the structured envelope.
 */
function handleUpstreamError(
  res: ExpressResponse,
  error: unknown,
  route: string,
  requestId: string,
  extra: Record<string, string>,
): void {
  const message = error instanceof Error ? error.message : 'Unknown error';
  logger.error(`Target architecture proxy: upstream fetch failed (${route})`, {
    requestId,
    ...extra,
    error: message,
  });
  console.warn(
    `[diag-gw] route=target-architectures-${route} status=503`,
  );
  res.status(503).json({
    error: {
      code: 503,
      message: 'Architecture model service unavailable',
      details: message,
    },
  });
}

function baseUrl(): string {
  return getConfig().architectureModelServiceBaseUrl;
}

// ---------------------------------------------------------------------------
// POST /api/projects/:projectId/target-architectures/seed
// ---------------------------------------------------------------------------

targetArchitecturesRouter.post(
  '/projects/:projectId/target-architectures/seed',
  async (req: Request, res: ExpressResponse) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId } = req.params;
    const url =
      `${baseUrl()}/api/projects/${encodeURIComponent(projectId)}/target-architectures/seed`;
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
        `[diag-gw] route=target-architectures-seed status=${upstream.status} ` +
          `elapsed_ms=${Date.now() - start}`,
      );
      await pipeUpstream(upstream, res);
    } catch (error) {
      handleUpstreamError(res, error, 'seed', requestId, { projectId });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/projects/:projectId/target-architectures/suggest-from-current
//
// Deterministic "Suggest target architecture from current" endpoint introduced
// by spec 2026-05-24 (Target State Sub-tab + Deterministic Suggest, Task
// Group 1 backend, Task Group 2 gateway proxy). Replaces the broken May-20
// LLM-driven Suggest stack (route file + handler + LLM task config +
// prompt -- all deleted by sub-tasks 2.2-2.5).
//
// Pure pass-through: AMS owns the deep-clone, mapping-row insert, auto-name
// resolution, double-click guard, and empty-source check. The gateway forwards
// the request body (`{ currentArchitectureId }`) and round-trips the AMS
// response unchanged so the frontend can branch on body.code for:
//   - 422 `{code: "empty_current_architecture"}` -- no in-scope elements
//   - 409 `{code: "recent_duplicate_suggest"}`  -- 5-second double-click guard
//   - 201 `{newDraftId, resolvedName, clonedElementCount, mappingRowCount}`
//     on success.
// ---------------------------------------------------------------------------

targetArchitecturesRouter.post(
  '/projects/:projectId/target-architectures/suggest-from-current',
  async (req: Request, res: ExpressResponse) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId } = req.params;
    const url =
      `${baseUrl()}/api/projects/${encodeURIComponent(projectId)}` +
      `/target-architectures/suggest-from-current`;
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
        `[diag-gw] route=target-architectures-suggest-from-current ` +
          `status=${upstream.status} elapsed_ms=${Date.now() - start}`,
      );
      await pipeUpstream(upstream, res);
    } catch (error) {
      handleUpstreamError(res, error, 'suggest-from-current', requestId, {
        projectId,
      });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/projects/:projectId/target-architectures
// ---------------------------------------------------------------------------

targetArchitecturesRouter.get(
  '/projects/:projectId/target-architectures',
  async (req: Request, res: ExpressResponse) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId } = req.params;
    const url =
      `${baseUrl()}/api/projects/${encodeURIComponent(projectId)}/target-architectures`;
    const start = Date.now();
    try {
      const upstream = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      console.log(
        `[diag-gw] route=target-architectures-list status=${upstream.status} ` +
          `elapsed_ms=${Date.now() - start}`,
      );
      await pipeUpstream(upstream, res);
    } catch (error) {
      handleUpstreamError(res, error, 'list', requestId, { projectId });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/projects/:projectId/target-architectures/:targetArchId/promote
// ---------------------------------------------------------------------------

targetArchitecturesRouter.post(
  '/projects/:projectId/target-architectures/:targetArchId/promote',
  async (req: Request, res: ExpressResponse) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId, targetArchId } = req.params;
    // Forward the dryRun query parameter verbatim so the AMS controller can
    // route through previewPromote without a separate gateway endpoint. The
    // confirm modal calls promote with ?dryRun=true to fetch the impact
    // preview BEFORE the user confirms, then calls promote again without
    // dryRun (or with dryRun=false) to commit.
    const dryRun =
      typeof req.query.dryRun === 'string' && req.query.dryRun === 'true';
    const url =
      `${baseUrl()}/api/projects/${encodeURIComponent(projectId)}` +
      `/target-architectures/${encodeURIComponent(targetArchId)}/promote` +
      (dryRun ? '?dryRun=true' : '');
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
        `[diag-gw] route=target-architectures-promote status=${upstream.status} ` +
          `dryRun=${dryRun} elapsed_ms=${Date.now() - start}`,
      );
      await pipeUpstream(upstream, res);
    } catch (error) {
      handleUpstreamError(res, error, 'promote', requestId, {
        projectId,
        targetArchId,
      });
    }
  },
);

// ---------------------------------------------------------------------------
// DELETE /api/projects/:projectId/target-architectures/:targetArchId
//
// AMS returns 409 `{code: "active_cannot_be_deleted"}` (or similar) when the
// target is currently in `draft_state='active'` -- this round-trips verbatim.
// ---------------------------------------------------------------------------

targetArchitecturesRouter.delete(
  '/projects/:projectId/target-architectures/:targetArchId',
  async (req: Request, res: ExpressResponse) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId, targetArchId } = req.params;
    // Forward the optional ?force=true so the active target can be deleted (the
    // UI confirms first) -- needed to wipe a project's target proposals.
    const force = req.query.force === 'true';
    const url =
      `${baseUrl()}/api/projects/${encodeURIComponent(projectId)}` +
      `/target-architectures/${encodeURIComponent(targetArchId)}` +
      (force ? '?force=true' : '');
    const start = Date.now();
    try {
      const upstream = await fetch(url, {
        method: 'DELETE',
        headers: { Accept: 'application/json' },
      });
      console.log(
        `[diag-gw] route=target-architectures-delete status=${upstream.status} ` +
          `elapsed_ms=${Date.now() - start}`,
      );
      await pipeUpstream(upstream, res);
    } catch (error) {
      handleUpstreamError(res, error, 'delete', requestId, {
        projectId,
        targetArchId,
      });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/projects/:projectId/target-architectures/:targetArchId/decommission
// ---------------------------------------------------------------------------

targetArchitecturesRouter.post(
  '/projects/:projectId/target-architectures/:targetArchId/decommission',
  async (req: Request, res: ExpressResponse) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId, targetArchId } = req.params;
    const url =
      `${baseUrl()}/api/projects/${encodeURIComponent(projectId)}` +
      `/target-architectures/${encodeURIComponent(targetArchId)}/decommission`;
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
        `[diag-gw] route=target-architectures-decommission status=${upstream.status} ` +
          `elapsed_ms=${Date.now() - start}`,
      );
      await pipeUpstream(upstream, res);
    } catch (error) {
      handleUpstreamError(res, error, 'decommission', requestId, {
        projectId,
        targetArchId,
      });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/projects/:projectId/architectures/:archId/unmapped-current-elements
// ---------------------------------------------------------------------------

targetArchitecturesRouter.get(
  '/projects/:projectId/architectures/:archId/unmapped-current-elements',
  async (req: Request, res: ExpressResponse) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId, archId } = req.params;
    // Forward the optional targetArchitectureId query param so AMS scopes the
    // gap to the draft the architect is viewing (not draft_state='active').
    const targetArchitectureId =
      typeof req.query.targetArchitectureId === 'string'
        ? req.query.targetArchitectureId
        : undefined;
    const url =
      `${baseUrl()}/api/projects/${encodeURIComponent(projectId)}` +
      `/architectures/${encodeURIComponent(archId)}/unmapped-current-elements` +
      (targetArchitectureId !== undefined
        ? `?targetArchitectureId=${encodeURIComponent(targetArchitectureId)}`
        : '');
    const start = Date.now();
    try {
      const upstream = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      console.log(
        `[diag-gw] route=target-architectures-unmapped status=${upstream.status} ` +
          `elapsed_ms=${Date.now() - start}`,
      );
      await pipeUpstream(upstream, res);
    } catch (error) {
      handleUpstreamError(res, error, 'unmapped', requestId, {
        projectId,
        archId,
      });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/projects/:projectId/architectures/:archId/decommissioned-in-target-annotations
// ---------------------------------------------------------------------------

targetArchitecturesRouter.get(
  '/projects/:projectId/architectures/:archId/decommissioned-in-target-annotations',
  async (req: Request, res: ExpressResponse) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId, archId } = req.params;
    // Forward the optional targetArchitectureId query param so AMS scopes the
    // annotations to the draft the architect is viewing.
    const targetArchitectureId =
      typeof req.query.targetArchitectureId === 'string'
        ? req.query.targetArchitectureId
        : undefined;
    const url =
      `${baseUrl()}/api/projects/${encodeURIComponent(projectId)}` +
      `/architectures/${encodeURIComponent(archId)}/decommissioned-in-target-annotations` +
      (targetArchitectureId !== undefined
        ? `?targetArchitectureId=${encodeURIComponent(targetArchitectureId)}`
        : '');
    const start = Date.now();
    try {
      const upstream = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      console.log(
        `[diag-gw] route=target-architectures-decom-annotations status=${upstream.status} ` +
          `elapsed_ms=${Date.now() - start}`,
      );
      await pipeUpstream(upstream, res);
    } catch (error) {
      handleUpstreamError(res, error, 'decom-annotations', requestId, {
        projectId,
        archId,
      });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/projects/:projectId/architectures/:archId/mapping-suggest
//
// Read-only candidate list. AMS returns the deterministic name-similarity
// candidates; the gateway reranks them via a small LLM call (direct build
// 2026-06-11 — the v1 stub is now the real implementation, see
// `services/mappingSuggestRerank.ts`).
//
//   - AMS already returns top-3 candidates ranked by similarity score.
//   - The rerank is advisory + fail-soft: any LLM failure/timeout keeps the
//     deterministic AMS order with `llmReranked: false`. The reranked list
//     is always a strict permutation of the AMS list.
//   - Enabled by default; `TARGET_ARCH_MAPPING_SUGGEST_LLM_RERANK=0` opts out.
//   - Read-only: never POSTs to AMS, never persists candidates.
// ---------------------------------------------------------------------------

targetArchitecturesRouter.post(
  '/projects/:projectId/architectures/:archId/mapping-suggest',
  async (req: Request, res: ExpressResponse) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId, archId } = req.params;
    const url =
      `${baseUrl()}/api/projects/${encodeURIComponent(projectId)}` +
      `/architectures/${encodeURIComponent(archId)}/mapping-suggest`;
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
      const text = await upstream.text();
      console.log(
        `[diag-gw] route=target-architectures-mapping-suggest status=${upstream.status} ` +
          `elapsed_ms=${Date.now() - start}`,
      );
      if (!upstream.ok) {
        // Non-2xx -- pass through verbatim, do NOT attempt LLM rerank.
        res.status(upstream.status);
        const contentType = upstream.headers.get('content-type');
        if (contentType) res.setHeader('content-type', contentType);
        res.send(text);
        return;
      }
      // 2xx success path: maybe rerank, then return.
      let parsed: MappingSuggestWireResponse;
      try {
        parsed = JSON.parse(text) as MappingSuggestWireResponse;
      } catch {
        // Body wasn't JSON -- return as-is.
        res.status(upstream.status);
        const contentType = upstream.headers.get('content-type');
        if (contentType) res.setHeader('content-type', contentType);
        res.send(text);
        return;
      }
      const reranked = await rerankMappingSuggestCandidates(
        parsed,
        (req.body ?? {}) as Record<string, unknown>,
      );
      res.status(upstream.status);
      res.setHeader('content-type', 'application/json');
      res.send(JSON.stringify(reranked));
    } catch (error) {
      handleUpstreamError(res, error, 'mapping-suggest', requestId, {
        projectId,
        archId,
      });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/projects/:projectId/specs/mark-stale
//
// Per spec.md and tasks.md sub-task 5.5 the active-target debounce decision
// lives on the AMS side via `last_marked_stale_at`. The gateway forwards the
// call straight through; there is NO gateway-internal in-memory debounce
// buffer in v1.
// ---------------------------------------------------------------------------

targetArchitecturesRouter.post(
  '/projects/:projectId/specs/mark-stale',
  async (req: Request, res: ExpressResponse) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId } = req.params;
    const url =
      `${baseUrl()}/api/projects/${encodeURIComponent(projectId)}/specs/mark-stale`;
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
        `[diag-gw] route=target-architectures-mark-stale status=${upstream.status} ` +
          `elapsed_ms=${Date.now() - start}`,
      );
      await pipeUpstream(upstream, res);
    } catch (error) {
      handleUpstreamError(res, error, 'mark-stale', requestId, { projectId });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/projects/:projectId/spec-generations/stale-count
//
// Migration Delivery Dashboard's "Stale specs" indicator (Target Architecture
// Authoring Flow spec, Task Group 9). Read-only project-scoped count of
// migration_story_spec_generations rows where stale=true, with the WorkItem
// id list fuelling the "Regenerate stale" action which forwards them as
// targetWorkItemIds to the gateway batch regeneration endpoint.
//
// Backed on the AMS side by the composite index idx_msg_project_stale on
// (project_id, stale).
// ---------------------------------------------------------------------------

targetArchitecturesRouter.get(
  '/projects/:projectId/spec-generations/stale-count',
  async (req: Request, res: ExpressResponse) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId } = req.params;
    const url =
      `${baseUrl()}/api/projects/${encodeURIComponent(projectId)}/spec-generations/stale-count`;
    const start = Date.now();
    try {
      const upstream = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      console.log(
        `[diag-gw] route=target-architectures-stale-count status=${upstream.status} ` +
          `elapsed_ms=${Date.now() - start}`,
      );
      await pipeUpstream(upstream, res);
    } catch (error) {
      handleUpstreamError(res, error, 'stale-count', requestId, { projectId });
    }
  },
);

// ---------------------------------------------------------------------------
// Captured Decisions proxy routes
// (spec 2026-05-24-target-state-captured-decisions-data-plane, Task Group 5)
//
// Pure pass-through proxies for the AMS captured-decisions REST surface
// introduced by Task Group 3 of the same spec. The data plane is insert-only:
// there are no PUT / PATCH / DELETE handlers (supersession is internal to
// AMS createDecision and surfaces via supersededById on subsequent reads).
//
// The cross-project 404 from AMS (decision belongs to a different project /
// target architecture than the path indicates) round-trips verbatim -- the
// gateway never translates it into 403 or any other status. The resolver
// added in Task Group 6 depends on this passthrough behaviour.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// POST /api/projects/:projectId/target-architectures/:targetArchitectureId/captured-decisions
// ---------------------------------------------------------------------------

targetArchitecturesRouter.post(
  '/projects/:projectId/target-architectures/:targetArchitectureId/captured-decisions',
  async (req: Request, res: ExpressResponse) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId, targetArchitectureId } = req.params;
    const url =
      `${baseUrl()}/api/projects/${encodeURIComponent(projectId)}` +
      `/target-architectures/${encodeURIComponent(targetArchitectureId)}` +
      `/captured-decisions`;
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
        `[diag-gw] route=target-architectures-captured-decisions-create ` +
          `status=${upstream.status} elapsed_ms=${Date.now() - start}`,
      );
      await pipeUpstream(upstream, res);
    } catch (error) {
      handleUpstreamError(res, error, 'captured-decisions-create', requestId, {
        projectId,
        targetArchitectureId,
      });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/projects/:projectId/target-architectures/:targetArchitectureId/captured-decisions
//
// Forwards the optional ?includeSuperseded query parameter verbatim so AMS
// can decide whether to return the latest non-superseded rows only (default)
// or the full audit list (when includeSuperseded=true).
// ---------------------------------------------------------------------------

targetArchitecturesRouter.get(
  '/projects/:projectId/target-architectures/:targetArchitectureId/captured-decisions',
  async (req: Request, res: ExpressResponse) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId, targetArchitectureId } = req.params;
    // Forward the includeSuperseded query parameter verbatim. The AMS
    // controller uses defaultValue="false", so absent / non-"true" values are
    // treated as false. The gateway only forwards the param when the caller
    // supplied it, preserving the upstream default behaviour.
    const includeSuperseded =
      typeof req.query.includeSuperseded === 'string'
        ? req.query.includeSuperseded
        : undefined;
    const url =
      `${baseUrl()}/api/projects/${encodeURIComponent(projectId)}` +
      `/target-architectures/${encodeURIComponent(targetArchitectureId)}` +
      `/captured-decisions` +
      (includeSuperseded !== undefined
        ? `?includeSuperseded=${encodeURIComponent(includeSuperseded)}`
        : '');
    const start = Date.now();
    try {
      const upstream = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      console.log(
        `[diag-gw] route=target-architectures-captured-decisions-list ` +
          `status=${upstream.status} includeSuperseded=${includeSuperseded ?? 'absent'} ` +
          `elapsed_ms=${Date.now() - start}`,
      );
      await pipeUpstream(upstream, res);
    } catch (error) {
      handleUpstreamError(res, error, 'captured-decisions-list', requestId, {
        projectId,
        targetArchitectureId,
      });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/projects/:projectId/target-architectures/:targetArchitectureId/captured-decisions/by-code/:decisionCode
//
// IMPORTANT: this route MUST be registered before the `/:decisionId` route
// below. Express matches routes in registration order; otherwise the
// `by-code` path segment would be consumed as a `decisionId` parameter.
// ---------------------------------------------------------------------------

targetArchitecturesRouter.get(
  '/projects/:projectId/target-architectures/:targetArchitectureId/captured-decisions/by-code/:decisionCode',
  async (req: Request, res: ExpressResponse) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId, targetArchitectureId, decisionCode } = req.params;
    const url =
      `${baseUrl()}/api/projects/${encodeURIComponent(projectId)}` +
      `/target-architectures/${encodeURIComponent(targetArchitectureId)}` +
      `/captured-decisions/by-code/${encodeURIComponent(decisionCode)}`;
    const start = Date.now();
    try {
      const upstream = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      console.log(
        `[diag-gw] route=target-architectures-captured-decisions-by-code ` +
          `status=${upstream.status} elapsed_ms=${Date.now() - start}`,
      );
      await pipeUpstream(upstream, res);
    } catch (error) {
      handleUpstreamError(
        res,
        error,
        'captured-decisions-by-code',
        requestId,
        { projectId, targetArchitectureId, decisionCode },
      );
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/projects/:projectId/target-architectures/:targetArchitectureId/captured-decisions/:decisionId
//
// AMS returns 404 (not 403) when the decision row's project_id or
// target_architecture_id does not match the path -- avoids leaking existence.
// This proxy round-trips that 404 verbatim.
// ---------------------------------------------------------------------------

targetArchitecturesRouter.get(
  '/projects/:projectId/target-architectures/:targetArchitectureId/captured-decisions/:decisionId',
  async (req: Request, res: ExpressResponse) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId, targetArchitectureId, decisionId } = req.params;
    const url =
      `${baseUrl()}/api/projects/${encodeURIComponent(projectId)}` +
      `/target-architectures/${encodeURIComponent(targetArchitectureId)}` +
      `/captured-decisions/${encodeURIComponent(decisionId)}`;
    const start = Date.now();
    try {
      const upstream = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      console.log(
        `[diag-gw] route=target-architectures-captured-decisions-get ` +
          `status=${upstream.status} elapsed_ms=${Date.now() - start}`,
      );
      await pipeUpstream(upstream, res);
    } catch (error) {
      handleUpstreamError(res, error, 'captured-decisions-get', requestId, {
        projectId,
        targetArchitectureId,
        decisionId,
      });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/projects/:projectId/active-target-architecture-id
//
// Project-scoped (not target-architecture-scoped). Co-located with the
// target-architectures proxy because the resolver added in Task Group 6
// calls this endpoint immediately before the captured-decisions list call,
// and the existing router already hosts other project-scoped proxies
// (specs/mark-stale, spec-generations/stale-count) under the same /api mount.
//
// AMS returns 200 with `{ "activeTargetArchitectureId": "<uuid-or-null>" }`.
// ---------------------------------------------------------------------------

targetArchitecturesRouter.get(
  '/projects/:projectId/active-target-architecture-id',
  async (req: Request, res: ExpressResponse) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId } = req.params;
    const url =
      `${baseUrl()}/api/projects/${encodeURIComponent(projectId)}` +
      `/active-target-architecture-id`;
    const start = Date.now();
    try {
      const upstream = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      console.log(
        `[diag-gw] route=target-architectures-active-target ` +
          `status=${upstream.status} elapsed_ms=${Date.now() - start}`,
      );
      await pipeUpstream(upstream, res);
    } catch (error) {
      handleUpstreamError(res, error, 'active-target', requestId, {
        projectId,
      });
    }
  },
);
