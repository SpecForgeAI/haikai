/**
 * Migration Delivery Dashboard proxy route.
 *
 * Spec: 2026-05-19 Migration Delivery Progress and Evidence Tracking
 * -- Task Group 6 (Gateway proxy route).
 *
 * Single read-only project-scoped proxy:
 *   GET /api/projects/:projectId/migration-books-of-work/:bookId/delivery-dashboard
 *
 * Thin pass-through to the architecture-model-service endpoint
 * `GET /api/projects/{projectId}/migration-books-of-work/{bookId}/delivery-dashboard`,
 * which returns a single `MigrationDeliveryDashboardDto`. The AMS response
 * (status + body) is re-emitted byte-for-byte so callers (the frontend
 * `migrationDeliveryDashboardApi.ts` client and downstream PM workspace
 * components) receive an unmodified payload.
 *
 * Conventions match `migrationContext.ts` and the GET half of
 * `migrationBookOfWork.ts` -- AMS errors round-trip status + body verbatim;
 * network / fetch failures return a 503 with the structured error envelope
 * the rest of the gateway uses.
 *
 * Per spec.md AC 19, this proxy is the ONLY new gateway endpoint introduced by
 * the spec; no other gateway routes are added. The existing
 * `POST /api/v1/projects/:projectId/migration-books-of-work/:bookId/spec-generations/generate-batch`
 * route (mounted via `migrationShapeSpecGenerationRouter`) is reused unchanged
 * for Addition A.
 *
 * Mount point: `/api` in `server.ts` (so the internal router path resolves
 * to `/api/projects/.../delivery-dashboard`, matching the AMS path verbatim).
 *
 * Spec 2026-06-14 Holistic Integration/E2E TEST Work Items (Spec 2 of 4): a new
 * node-scoped POST is added here for the per-feature/epic "Define
 * Integration/E2E Tests" action. The delivery-dashboard route is the natural
 * home (it is the per-book read surface); Generate-All is book-of-work-scoped
 * on a different router, so this new action -- which is NODE-scoped -- gets its
 * own endpoint that invokes the headless holistic-review handler.
 */

import { Router, Request, Response } from 'express';
import { getConfig } from '../config';
import { logger } from '../services/logger';
import {
  runHolisticTestDefinitions,
  RunHolisticTestDefinitionsInput,
} from '../services/holisticTestDefinitionHandler';

export const migrationDeliveryDashboardRouter = Router();

/**
 * GET /api/projects/:projectId/migration-books-of-work/:bookId/delivery-dashboard
 *
 * Forwards the request to AMS and pipes the upstream status, content-type, and
 * body back to the caller unchanged. AMS 404 (book not found / project
 * mismatch) round-trips byte-for-byte. On network / fetch failure returns a
 * 503 with a structured envelope.
 */
migrationDeliveryDashboardRouter.get(
  '/projects/:projectId/migration-books-of-work/:bookId/delivery-dashboard',
  async (req: Request, res: Response) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId, bookId } = req.params;
    const baseUrl = getConfig().architectureModelServiceBaseUrl;
    const url =
      `${baseUrl}/api/projects/${encodeURIComponent(projectId)}` +
      `/migration-books-of-work/${encodeURIComponent(bookId)}/delivery-dashboard`;

    const start = Date.now();
    try {
      const upstream = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      const text = await upstream.text();
      console.log(
        `[diag-gw] route=migration-delivery-dashboard status=${upstream.status} ` +
          `elapsed_ms=${Date.now() - start}`,
      );
      res.status(upstream.status);
      const contentType = upstream.headers.get('content-type');
      if (contentType) res.setHeader('content-type', contentType);
      res.send(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Migration delivery-dashboard proxy: upstream fetch failed', {
        requestId,
        projectId,
        bookId,
        error: message,
      });
      console.warn(
        `[diag-gw] route=migration-delivery-dashboard status=503 ` +
          `elapsed_ms=${Date.now() - start}`,
      );
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

/**
 * POST /api/projects/:projectId/migration-books-of-work/:bookId/items/:bookItemId/repair-orphan
 *
 * Spec follow-up #2: one-click repair for an orphan
 * `book_of_work_json.items[].workItemId` (stale id whose WorkItem no longer
 * exists). Thin pass-through to the AMS endpoint of the same shape; AMS
 * round-trips status + body verbatim. AMS returns 400 if the item is not
 * actually orphan (stored id still resolves, or no stored id at all), 404 if
 * the book or item is missing.
 */
migrationDeliveryDashboardRouter.post(
  '/projects/:projectId/migration-books-of-work/:bookId/items/:bookItemId/repair-orphan',
  async (req: Request, res: Response) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId, bookId, bookItemId } = req.params;
    const baseUrl = getConfig().architectureModelServiceBaseUrl;
    const url =
      `${baseUrl}/api/projects/${encodeURIComponent(projectId)}` +
      `/migration-books-of-work/${encodeURIComponent(bookId)}` +
      `/items/${encodeURIComponent(bookItemId)}/repair-orphan`;

    const start = Date.now();
    try {
      const upstream = await fetch(url, {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
      const text = await upstream.text();
      console.log(
        `[diag-gw] route=migration-delivery-dashboard-repair-orphan ` +
          `status=${upstream.status} elapsed_ms=${Date.now() - start}`,
      );
      res.status(upstream.status);
      const contentType = upstream.headers.get('content-type');
      if (contentType) res.setHeader('content-type', contentType);
      res.send(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Migration delivery-dashboard repair-orphan proxy: upstream fetch failed', {
        requestId,
        projectId,
        bookId,
        bookItemId,
        error: message,
      });
      console.warn(
        `[diag-gw] route=migration-delivery-dashboard-repair-orphan ` +
          `status=503 elapsed_ms=${Date.now() - start}`,
      );
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

/**
 * POST /api/projects/:projectId/migration-books-of-work/:bookId/items/:bookItemId/define-integration-tests
 *
 * Spec 2026-06-14 Holistic Integration/E2E TEST Work Items (Spec 2 of 4):
 * the per-feature/epic "Define Integration/E2E Tests" action. Runs the headless
 * holistic-review handler over the node's SPEC-COMPLETE children's specs,
 * defines a small set of cross-cutting integration/E2E tests, and creates each
 * as a first-class `TEST` work item placed as a SIBLING (blob item + work_item
 * row + spec row + implement-state.json).
 *
 * Gating is ALLOW-WITH-WARNING: insufficient/not-generated children are skipped
 * and listed in the response `skippedChildren[]`; the action never hard-blocks.
 * The HTTP status is 200 even when the LLM returned an empty plan or some
 * per-test creations failed (per-test failures live in the body's
 * `failedTestItems[]` -- R-12 failure isolation). A 500 is returned only on an
 * unexpected handler-level error (e.g. the node could not be loaded).
 */
migrationDeliveryDashboardRouter.post(
  '/projects/:projectId/migration-books-of-work/:bookId/items/:bookItemId/define-integration-tests',
  async (req: Request, res: Response) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId, bookId, bookItemId } = req.params;
    const input: RunHolisticTestDefinitionsInput = {
      projectId,
      bookOfWorkId: bookId,
      nodeBookItemId: bookItemId,
    };
    const start = Date.now();
    try {
      const result = await runHolisticTestDefinitions(input);
      console.log(
        `[diag-gw] route=migration-delivery-define-integration-tests status=200 ` +
          `elapsed_ms=${Date.now() - start} level=${result.level} ` +
          `created=${result.createdTestItems.length} failed=${result.failedTestItems.length} ` +
          `skipped=${result.skippedChildren.length} emptyPlan=${result.emptyPlan}`,
      );
      res.status(200).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Migration delivery define-integration-tests: unexpected error', {
        requestId,
        projectId,
        bookId,
        bookItemId,
        error: message,
      });
      console.warn(
        `[diag-gw] route=migration-delivery-define-integration-tests status=500 ` +
          `elapsed_ms=${Date.now() - start}`,
      );
      res.status(500).json({
        error: {
          code: 500,
          message: 'Holistic integration/E2E test definition failed',
          details: message,
        },
      });
    }
  },
);
