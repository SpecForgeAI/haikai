/**
 * Epic Captured Decisions proxy route.
 *
 * Spec: 2026-05-20 Cross-Story Context Injection -- Task Group 8 (gateway proxy
 * for the frontend's epic-decisions edit panel).
 *
 * Thin pass-through to the architecture-model-service endpoints introduced by
 * Task Group 4:
 *
 *   GET    /api/projects/:projectId/epics/:epicWorkItemId/captured-decisions
 *   POST   /api/projects/:projectId/epics/:epicWorkItemId/captured-decisions
 *   PATCH  /api/projects/:projectId/epics/:epicWorkItemId/captured-decisions/:id
 *   DELETE /api/projects/:projectId/epics/:epicWorkItemId/captured-decisions/:id
 *
 * Each handler forwards the request to AMS and re-emits the upstream status,
 * content-type, and body byte-for-byte. AMS 404 / 400 round-trip verbatim; on
 * network / fetch failure we return 503 with the structured envelope used by
 * other gateway proxies (per the same pattern as
 * `migrationDeliveryDashboard.ts`).
 *
 * NOTE: a parallel gateway-internal client lives in
 * `gateway/src/services/epicCapturedDecisionsClient.ts` and is used by the
 * batch handler's auto-seed flow during pass 1; the routes in this file exist
 * specifically so the browser-facing frontend can call AMS through the
 * gateway origin (same-origin requirement, CORS) without bypassing the
 * gateway middleware (rate-limit, request-id).
 *
 * Mount point: `/api` (matches the AMS path verbatim).
 */

import { Router, Request, Response as ExpressResponse } from 'express';
import { getConfig } from '../config';
import { logger } from '../services/logger';

export const epicCapturedDecisionsRouter = Router();

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
  logger.error(`Epic captured decisions proxy: upstream fetch failed (${route})`, {
    requestId,
    ...extra,
    error: message,
  });
  console.warn(
    `[diag-gw] route=epic-captured-decisions-${route} status=503`,
  );
  res.status(503).json({
    error: {
      code: 503,
      message: 'Architecture model service unavailable',
      details: message,
    },
  });
}

// ---- GET project-wide summary (bulk) ----------------------------------------
// Spec: 2026-05-20 Cross-Story Context Injection -- Follow-up #3 (replaces the
// dashboard's per-epic GETs with one project-scoped call).
//
// IMPORTANT: this route must be registered before the per-epic
// `/projects/:projectId/epics/:epicWorkItemId/captured-decisions` route. The
// path here is `/projects/:projectId/captured-decisions/summary` which sits in
// a different sub-tree, so order does not actually matter today -- but should a
// future change add a per-epic `/summary` sub-path the placement would matter.

epicCapturedDecisionsRouter.get(
  '/projects/:projectId/captured-decisions/summary',
  async (req: Request, res: ExpressResponse) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId } = req.params;
    const baseUrl = getConfig().architectureModelServiceBaseUrl;
    const url =
      `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/captured-decisions/summary`;
    const start = Date.now();
    try {
      const upstream = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      console.log(
        `[diag-gw] route=epic-captured-decisions-summary status=${upstream.status} ` +
          `elapsed_ms=${Date.now() - start}`,
      );
      await pipeUpstream(upstream, res);
    } catch (error) {
      handleUpstreamError(res, error, 'summary', requestId, { projectId });
    }
  },
);

// ---- GET list ---------------------------------------------------------------

epicCapturedDecisionsRouter.get(
  '/projects/:projectId/epics/:epicWorkItemId/captured-decisions',
  async (req: Request, res: ExpressResponse) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId, epicWorkItemId } = req.params;
    const baseUrl = getConfig().architectureModelServiceBaseUrl;
    const url =
      `${baseUrl}/api/projects/${encodeURIComponent(projectId)}` +
      `/epics/${encodeURIComponent(epicWorkItemId)}/captured-decisions`;
    const start = Date.now();
    try {
      const upstream = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      console.log(
        `[diag-gw] route=epic-captured-decisions-list status=${upstream.status} ` +
          `elapsed_ms=${Date.now() - start}`,
      );
      await pipeUpstream(upstream, res);
    } catch (error) {
      handleUpstreamError(res, error, 'list', requestId, {
        projectId,
        epicWorkItemId,
      });
    }
  },
);

// ---- POST create ------------------------------------------------------------

epicCapturedDecisionsRouter.post(
  '/projects/:projectId/epics/:epicWorkItemId/captured-decisions',
  async (req: Request, res: ExpressResponse) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId, epicWorkItemId } = req.params;
    const baseUrl = getConfig().architectureModelServiceBaseUrl;
    const url =
      `${baseUrl}/api/projects/${encodeURIComponent(projectId)}` +
      `/epics/${encodeURIComponent(epicWorkItemId)}/captured-decisions`;
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
        `[diag-gw] route=epic-captured-decisions-create status=${upstream.status} ` +
          `elapsed_ms=${Date.now() - start}`,
      );
      await pipeUpstream(upstream, res);
    } catch (error) {
      handleUpstreamError(res, error, 'create', requestId, {
        projectId,
        epicWorkItemId,
      });
    }
  },
);

// ---- PATCH update -----------------------------------------------------------

epicCapturedDecisionsRouter.patch(
  '/projects/:projectId/epics/:epicWorkItemId/captured-decisions/:id',
  async (req: Request, res: ExpressResponse) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId, epicWorkItemId, id } = req.params;
    const baseUrl = getConfig().architectureModelServiceBaseUrl;
    const url =
      `${baseUrl}/api/projects/${encodeURIComponent(projectId)}` +
      `/epics/${encodeURIComponent(epicWorkItemId)}/captured-decisions/${encodeURIComponent(id)}`;
    const start = Date.now();
    try {
      const upstream = await fetch(url, {
        method: 'PATCH',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(req.body ?? {}),
      });
      console.log(
        `[diag-gw] route=epic-captured-decisions-update status=${upstream.status} ` +
          `elapsed_ms=${Date.now() - start}`,
      );
      await pipeUpstream(upstream, res);
    } catch (error) {
      handleUpstreamError(res, error, 'update', requestId, {
        projectId,
        epicWorkItemId,
        id,
      });
    }
  },
);

// ---- DELETE -----------------------------------------------------------------

epicCapturedDecisionsRouter.delete(
  '/projects/:projectId/epics/:epicWorkItemId/captured-decisions/:id',
  async (req: Request, res: ExpressResponse) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId, epicWorkItemId, id } = req.params;
    const baseUrl = getConfig().architectureModelServiceBaseUrl;
    const lastEditedBy =
      typeof req.query.lastEditedBy === 'string' ? req.query.lastEditedBy : null;
    const qs = lastEditedBy
      ? `?lastEditedBy=${encodeURIComponent(lastEditedBy)}`
      : '';
    const url =
      `${baseUrl}/api/projects/${encodeURIComponent(projectId)}` +
      `/epics/${encodeURIComponent(epicWorkItemId)}/captured-decisions/${encodeURIComponent(id)}${qs}`;
    const start = Date.now();
    try {
      const upstream = await fetch(url, {
        method: 'DELETE',
        headers: { Accept: 'application/json' },
      });
      console.log(
        `[diag-gw] route=epic-captured-decisions-delete status=${upstream.status} ` +
          `elapsed_ms=${Date.now() - start}`,
      );
      await pipeUpstream(upstream, res);
    } catch (error) {
      handleUpstreamError(res, error, 'delete', requestId, {
        projectId,
        epicWorkItemId,
        id,
      });
    }
  },
);
