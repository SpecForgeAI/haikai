/**
 * Migration Book of Work route file.
 *
 * Spec 2026-05-17 PM Migration Delivery Plan + Draft Book-of-Work Generation
 * (Spec 1) — follow-up wiring to expose the existing
 * `migrationBookOfWorkHandler` service through HTTP endpoints. Without this
 * file the frontend client in `migrationDeliveryPlanApi.ts` had no gateway
 * counterpart for its two URLs — the handler was paired-but-disconnected.
 *
 * Mounted at `/api/v1` (see `server.ts`). Two routes:
 *
 *   POST /api/v1/projects/:projectId/migration-books-of-work/generate
 *     Body: `{ currentArchitectureId, targetArchitectureId, wizardAnswers?,
 *              discoveryRunIds?, apiBehaviourBaselineIds? }`
 *     Response: `{ draftId, summary, warnings? }`
 *
 *   GET  /api/v1/projects/:projectId/migration-books-of-work/:bookId
 *     Thin proxy onto AMS `GET /api/projects/{projectId}/migration-books-of-work/{bookId}`
 *
 * Phase-2 expansion routes (Spec 2026-06-11 Two-Phase Migration Delivery Plan
 * Generation, Task Group 4.8):
 *
 *   POST /api/v1/projects/:projectId/migration-books-of-work/:bookId/epics/:epicId/expand
 *     Expand ONE epic (per-epic pipeline; returns the resulting expansion
 *     state so the frontend can update without an immediate re-poll).
 *
 *   POST /api/v1/projects/:projectId/migration-books-of-work/:bookId/expand-all
 *     Expand ALL `not_expanded` / `failed` / stale-`expanding` epics; skips
 *     `expanded` ones. Per-epic pipelines fan out over the ONE shared LLM
 *     pool — total in-flight LLM requests never exceed
 *     MIGRATION_PLAN_LLM_CONCURRENCY regardless of epic count.
 *
 *   POST /api/v1/projects/:projectId/migration-books-of-work/:bookId/items/append
 *     Thin proxy onto the AMS atomic `items/append` merge endpoint (AMS
 *     errors round-trip status + body byte-for-byte).
 *
 * Auth gating: matches `migrationContext.ts` (no role gate today). Once a
 * project-wide gating layer lands, both routers should adopt it together
 * since they back the same PM flow.
 *
 * Error mapping mirrors `migrationContext.ts`:
 *   - `TokenBudgetOverflowError` → 422 (context exceeds soft cap; not the
 *     gateway's fault — the user needs to narrow the inputs)
 *   - `MigrationBookOfWorkSchemaError` → 502 (upstream LLM produced invalid
 *     payload; not a 4xx because the caller did nothing wrong)
 *   - Other Error → 500 with structured envelope
 *   - Upstream AMS errors round-trip status + body byte-for-byte
 */

import { Router, Request, Response } from 'express';
import { logger } from '../services/logger';
import {
  generateMigrationBookOfWork,
  GenerateMigrationBookOfWorkInput,
  TokenBudgetOverflowError,
  MigrationBookOfWorkSchemaError,
} from '../services/migrationBookOfWorkHandler';
import {
  AmsRoundTripError,
  ExpansionPreconditionError,
  expandAllMigrationBookOfWorkEpics,
  expandMigrationBookOfWorkEpic,
} from '../services/migrationBookOfWorkExpansionHandler';
import { getConfig } from '../config';

export const migrationBookOfWorkRouter = Router();

// ---------------------------------------------------------------------------
// POST /api/v1/projects/:projectId/migration-books-of-work/generate
// ---------------------------------------------------------------------------

migrationBookOfWorkRouter.post(
  '/projects/:projectId/migration-books-of-work/generate',
  async (req: Request, res: Response) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId } = req.params;
    const body = (req.body ?? {}) as Omit<
      GenerateMigrationBookOfWorkInput,
      'projectId'
    >;

    if (!body.currentArchitectureId || !body.targetArchitectureId) {
      res.status(400).json({
        error: {
          code: 400,
          message:
            'currentArchitectureId and targetArchitectureId are required.',
        },
      });
      return;
    }

    const start = Date.now();
    try {
      const result = await generateMigrationBookOfWork({
        projectId,
        currentArchitectureId: body.currentArchitectureId,
        targetArchitectureId: body.targetArchitectureId,
        wizardAnswers: body.wizardAnswers,
        discoveryRunIds: body.discoveryRunIds,
        apiBehaviourBaselineIds: body.apiBehaviourBaselineIds,
      });
      console.log(
        `[diag-gw] route=migration-books-of-work-generate status=200 ` +
          `elapsed_ms=${Date.now() - start}`
      );
      res.status(200).json(result);
    } catch (error) {
      const elapsed = Date.now() - start;
      if (error instanceof TokenBudgetOverflowError) {
        logger.warn('Migration book-of-work generate: token budget overflow', {
          requestId,
          projectId,
          overflowingItems: error.overflowingItems,
          finalTokenCount: error.finalTokenCount,
        });
        console.warn(
          `[diag-gw] route=migration-books-of-work-generate status=422 ` +
            `elapsed_ms=${elapsed}`
        );
        res.status(422).json({
          error: {
            code: 422,
            message: error.message,
            overflowingItems: error.overflowingItems,
            finalTokenCount: error.finalTokenCount,
          },
        });
        return;
      }
      if (error instanceof MigrationBookOfWorkSchemaError) {
        logger.warn('Migration book-of-work generate: schema validation failed', {
          requestId,
          projectId,
          errors: error.errors,
        });
        console.warn(
          `[diag-gw] route=migration-books-of-work-generate status=502 ` +
            `elapsed_ms=${elapsed}`
        );
        res.status(502).json({
          error: {
            code: 502,
            message: 'Upstream LLM response failed schema validation.',
            errors: error.errors,
          },
        });
        return;
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Migration book-of-work generate: unexpected error', {
        requestId,
        projectId,
        error: message,
      });
      console.warn(
        `[diag-gw] route=migration-books-of-work-generate status=500 ` +
          `elapsed_ms=${elapsed}`
      );
      res.status(500).json({
        error: {
          code: 500,
          message: 'Migration book-of-work generation failed',
          details: message,
        },
      });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/v1/projects/:projectId/migration-books-of-work/:bookId
// Thin proxy onto AMS.
// ---------------------------------------------------------------------------

migrationBookOfWorkRouter.get(
  '/projects/:projectId/migration-books-of-work/:bookId',
  async (req: Request, res: Response) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId, bookId } = req.params;
    const baseUrl = getConfig().architectureModelServiceBaseUrl;
    const url =
      `${baseUrl}/api/projects/${encodeURIComponent(projectId)}` +
      `/migration-books-of-work/${encodeURIComponent(bookId)}`;
    const start = Date.now();
    try {
      const upstream = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      const text = await upstream.text();
      console.log(
        `[diag-gw] route=migration-books-of-work-get status=${upstream.status} ` +
          `elapsed_ms=${Date.now() - start}`
      );
      res.status(upstream.status);
      const contentType = upstream.headers.get('content-type');
      if (contentType) res.setHeader('content-type', contentType);
      res.send(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Migration book-of-work GET proxy: upstream fetch failed', {
        requestId,
        projectId,
        bookId,
        error: message,
      });
      console.warn(
        `[diag-gw] route=migration-books-of-work-get status=503 ` +
          `elapsed_ms=${Date.now() - start}`
      );
      res.status(503).json({
        error: {
          code: 503,
          message: 'Architecture model service unavailable',
          details: message,
        },
      });
    }
  }
);

// ---------------------------------------------------------------------------
// Phase-2 expansion routes (Spec 2026-06-11 Two-Phase generation, Task
// Group 4.8). Error mapping reuses this file's conventions: schema errors ->
// 502, AMS errors round-trip status + body, generic failures -> 500; the new
// `ExpansionPreconditionError` carries its own status (404 unknown epic/book,
// 409 already-expanded / in-flight, 400 invalid epic shape).
// ---------------------------------------------------------------------------

function mapExpansionError(
  error: unknown,
  res: Response,
  routeName: string,
  requestId: string,
  context: Record<string, unknown>
): void {
  if (error instanceof ExpansionPreconditionError) {
    logger.warn(`Migration book-of-work ${routeName}: precondition failed`, {
      requestId,
      ...context,
      statusCode: error.statusCode,
      error: error.message,
    });
    res.status(error.statusCode).json({
      error: { code: error.statusCode, message: error.message },
    });
    return;
  }
  if (error instanceof AmsRoundTripError) {
    // Round-trip the upstream AMS status + body byte-for-byte.
    logger.warn(`Migration book-of-work ${routeName}: AMS error round-trip`, {
      requestId,
      ...context,
      status: error.status,
    });
    res.status(error.status);
    res.setHeader('content-type', 'application/json');
    res.send(
      error.body ||
        JSON.stringify({ error: { code: error.status, message: error.message } })
    );
    return;
  }
  if (error instanceof MigrationBookOfWorkSchemaError) {
    res.status(502).json({
      error: {
        code: 502,
        message: 'Upstream LLM response failed schema validation.',
        errors: error.errors,
      },
    });
    return;
  }
  const message = error instanceof Error ? error.message : 'Unknown error';
  logger.error(`Migration book-of-work ${routeName}: unexpected error`, {
    requestId,
    ...context,
    error: message,
  });
  res.status(500).json({
    error: {
      code: 500,
      message: `Migration book-of-work ${routeName} failed`,
      details: message,
    },
  });
}

// ---------------------------------------------------------------------------
// POST .../:bookId/epics/:epicId/expand — expand ONE epic
// ---------------------------------------------------------------------------

migrationBookOfWorkRouter.post(
  '/projects/:projectId/migration-books-of-work/:bookId/epics/:epicId/expand',
  async (req: Request, res: Response) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId, bookId, epicId } = req.params;
    const start = Date.now();
    try {
      const result = await expandMigrationBookOfWorkEpic({ projectId, bookId, epicId });
      console.log(
        `[diag-gw] route=migration-books-of-work-expand-epic status=200 ` +
          `expansion_state=${result.expansionState} elapsed_ms=${Date.now() - start}`
      );
      // 200 for BOTH outcomes — a pipeline failure is a persisted, retryable
      // per-epic state (`failed`), not an HTTP transport failure. The
      // response carries the resulting expansion state so the frontend can
      // update without an immediate re-poll.
      res.status(200).json(result);
    } catch (error) {
      console.warn(
        `[diag-gw] route=migration-books-of-work-expand-epic status=err ` +
          `elapsed_ms=${Date.now() - start}`
      );
      mapExpansionError(error, res, 'expand-epic', requestId, { projectId, bookId, epicId });
    }
  }
);

// ---------------------------------------------------------------------------
// POST .../:bookId/expand-all — expand epics. Body `{ include_expanded }`:
//   false / absent = "Expand remaining" (unexpanded / failed / stale only);
//   true            = "Expand all" (ALSO re-expands already-expanded epics).
// ---------------------------------------------------------------------------

migrationBookOfWorkRouter.post(
  '/projects/:projectId/migration-books-of-work/:bookId/expand-all',
  async (req: Request, res: Response) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId, bookId } = req.params;
    const body = (req.body ?? {}) as { include_expanded?: boolean; includeExpanded?: boolean };
    const includeExpanded = body.include_expanded === true || body.includeExpanded === true;
    const start = Date.now();
    try {
      const outcome = await expandAllMigrationBookOfWorkEpics({
        projectId,
        bookId,
        includeExpanded,
      });
      console.log(
        `[diag-gw] route=migration-books-of-work-expand-all status=200 ` +
          `expanded=${outcome.results.filter((r) => r.expansionState === 'expanded').length} ` +
          `failed=${outcome.results.filter((r) => r.expansionState === 'failed').length} ` +
          `skipped=${outcome.skipped.length} elapsed_ms=${Date.now() - start}`
      );
      res.status(200).json(outcome);
    } catch (error) {
      console.warn(
        `[diag-gw] route=migration-books-of-work-expand-all status=err ` +
          `elapsed_ms=${Date.now() - start}`
      );
      mapExpansionError(error, res, 'expand-all', requestId, { projectId, bookId });
    }
  }
);

// ---------------------------------------------------------------------------
// POST .../:bookId/items/append — thin proxy onto the AMS atomic merge
// ---------------------------------------------------------------------------

migrationBookOfWorkRouter.post(
  '/projects/:projectId/migration-books-of-work/:bookId/items/append',
  async (req: Request, res: Response) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId, bookId } = req.params;
    const baseUrl = getConfig().architectureModelServiceBaseUrl;
    const url =
      `${baseUrl}/api/projects/${encodeURIComponent(projectId)}` +
      `/migration-books-of-work/${encodeURIComponent(bookId)}/items/append`;
    const start = Date.now();
    try {
      const upstream = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(req.body ?? {}),
      });
      const text = await upstream.text();
      console.log(
        `[diag-gw] route=migration-books-of-work-items-append status=${upstream.status} ` +
          `elapsed_ms=${Date.now() - start}`
      );
      res.status(upstream.status);
      const contentType = upstream.headers.get('content-type');
      if (contentType) res.setHeader('content-type', contentType);
      res.send(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Migration book-of-work items/append proxy: upstream fetch failed', {
        requestId,
        projectId,
        bookId,
        error: message,
      });
      console.warn(
        `[diag-gw] route=migration-books-of-work-items-append status=503 ` +
          `elapsed_ms=${Date.now() - start}`
      );
      res.status(503).json({
        error: {
          code: 503,
          message: 'Architecture model service unavailable',
          details: message,
        },
      });
    }
  }
);
