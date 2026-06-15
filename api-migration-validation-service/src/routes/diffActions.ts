import { Router, Request, Response } from 'express';
import { archModelClient as defaultArchModelClient } from '../services/archModelClient';
import { runManager } from '../services/runManager';
import { runDiff as defaultRunDiff, type DiffRunnerDeps } from '../services/diffRunner';

/**
 * Diff engine action endpoints. Mounted under the same
 * `/api-migration-validation` router as the capture-session action endpoints.
 *
 * Spec: 2026-05-25 API Test Harness -- Diff Engine -- Task Group 3.
 *
 * Routes (mounted at `/api-migration-validation/api/diffs/...`):
 *
 *   - `POST /diffs`                       -- create a diff row + spawn the
 *                                            background runner. Body:
 *                                            { projectId, architectureId,
 *                                              sourceBaselineId,
 *                                              targetBaselineId }.
 *                                            Rejects with 400 if the target
 *                                            baseline is still `draft`.
 *   - `POST /diffs/:id/recompute`         -- delete prior diff_items, PATCH
 *                                            the diff back to `computing`,
 *                                            re-spawn the runner. Rejects
 *                                            with 409 if the diff is
 *                                            currently running.
 *   - `GET  /diffs/:id/status`            -- polling endpoint with the count
 *                                            summary + status + computed_at.
 *   - `POST /diffs/:id/cancel`            -- signal abort to the in-flight
 *                                            runner (via runManager), PATCH
 *                                            the diff to `failed` with
 *                                            error_message='cancelled'.
 *
 * Reuses `runManager` UNCHANGED with `diffId` in the `sessionId` slot --
 * see the comment in `diffRunner.ts` and accepted Q5 / requirements F5.
 */

export interface DiffActionsDeps {
  archModelClient?: typeof defaultArchModelClient;
  /**
   * Override for the runner. Tests inject a stub to assert the route fires
   * the runner without actually executing it.
   */
  spawnRunner?: (diffId: string, deps?: DiffRunnerDeps) => Promise<void>;
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

interface CreateDiffBody {
  projectId?: string;
  architectureId: string;
  sourceBaselineId: string;
  targetBaselineId: string;
}

export function buildDiffActionsRouter(
  deps: DiffActionsDeps = {},
): Router {
  const router = Router({ mergeParams: true });
  const archModelClient = deps.archModelClient ?? defaultArchModelClient;
  const spawnRunner = deps.spawnRunner ?? defaultRunDiff;

  // ----------------------------------------------------------------------
  // POST /api/diffs
  // ----------------------------------------------------------------------
  router.post('/api/diffs', async (req: Request, res: Response) => {
    const projectId = extractProjectId(req);
    if (!projectId) {
      return fail(res, 400, 'projectId is required (query param or body field)');
    }
    const body = (req.body || {}) as CreateDiffBody;
    if (!body.architectureId) {
      return fail(res, 400, 'architectureId is required');
    }
    if (!body.sourceBaselineId) {
      return fail(res, 400, 'sourceBaselineId is required');
    }
    if (!body.targetBaselineId) {
      return fail(res, 400, 'targetBaselineId is required');
    }

    try {
      // Reject upfront if the target baseline is still in draft. AMS would
      // accept the diff creation (the FK-pairing invariant doesn't care
      // about target status); the runner ALSO defends against this, but
      // surfacing 400 here gives the UI a clean error path before the row
      // exists at all.
      const targetBaseline = await archModelClient.getBaseline(
        projectId,
        body.targetBaselineId,
      );
      if (targetBaseline.status === 'draft') {
        return fail(res, 400, 'Target baseline is not finalised', {
          error: 'target_baseline_not_finalised',
        });
      }

      // Create the diff row -- AMS enforces the FK-pairing invariant on
      // create (source must be kind=current; target must be kind=target
      // paired with the source). Rejections surface as HTTP 400.
      const diff = await archModelClient.createDiff(projectId, {
        project_id: projectId,
        architecture_id: body.architectureId,
        source_baseline_id: body.sourceBaselineId,
        target_baseline_id: body.targetBaselineId,
        status: 'computing',
      });

      // Register in runManager BEFORE spawning so a rapid second POST
      // hits the 409 guard if AMS allowed two diff rows somehow. AMS has
      // a UNIQUE constraint on (source_baseline_id, target_baseline_id),
      // so a second POST against the same pair returns the existing diff
      // (or fails depending on AMS upsert semantics) -- the runManager
      // also catches the in-flight case.
      try {
        runManager.start({
          sessionId: diff.id,
          projectId,
          architectureId: body.architectureId,
        });
      } catch {
        // Already running -- treat the response as 202 anyway; the
        // in-flight run will complete and the polling endpoint reflects
        // status.
      }
      // Fire-and-forget the runner. Per-run errors are captured into the
      // diff row by the runner itself.
      spawnRunner(diff.id).catch((err) => {
        console.error(
          `[diffActions] runDiff failed for ${diff.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });

      return res.status(202).json({ diffId: diff.id, status: 'computing' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'create diff failed';
      return fail(res, 502, message);
    }
  });

  // ----------------------------------------------------------------------
  // POST /api/diffs/:id/recompute
  // ----------------------------------------------------------------------
  router.post('/api/diffs/:id/recompute', async (req: Request, res: Response) => {
    const diffId = req.params.id;
    const projectId = extractProjectId(req);
    if (!projectId) {
      return fail(res, 400, 'projectId is required (query param or body field)');
    }
    try {
      if (runManager.has(diffId)) {
        return fail(res, 409, 'Diff is already computing', {
          currentStatus: 'computing',
        });
      }
      // Load the diff to recover architecture_id for runManager registration
      // and target baseline id for the draft check.
      const diff = await archModelClient.getDiff(projectId, diffId);
      const targetBaseline = await archModelClient.getBaseline(
        projectId,
        diff.target_baseline_id,
      );
      if (targetBaseline.status === 'draft') {
        return fail(res, 400, 'Target baseline is not finalised', {
          error: 'target_baseline_not_finalised',
        });
      }
      // Wipe prior diff_items (CASCADE-friendly bulk delete).
      try {
        await archModelClient.deleteDiffItemsByDiffId(projectId, diffId);
      } catch (err) {
        console.warn(
          `[diffActions] failed to delete prior diff_items for ${diffId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      // PATCH the diff back to computing -- clears prior counts so the
      // polling endpoint reflects in-progress state.
      await archModelClient.updateDiff(projectId, diffId, {
        status: 'computing',
        matched_count: null,
        status_drift_count: null,
        body_shape_drift_count: null,
        body_value_drift_count: null,
        source_only_count: null,
        target_only_count: null,
        computed_at: null,
        error_message: null,
      });
      try {
        runManager.start({
          sessionId: diffId,
          projectId,
          architectureId: diff.architecture_id,
        });
      } catch {
        // Race -- another caller registered between our `has` check and
        // start. Treat as a concurrent recompute and respond 409.
        return fail(res, 409, 'Diff is already computing', {
          currentStatus: 'computing',
        });
      }
      spawnRunner(diffId).catch((err) => {
        console.error(
          `[diffActions] runDiff (recompute) failed for ${diffId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });

      return res.status(202).json({ diffId, status: 'computing' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'recompute failed';
      return fail(res, 502, message);
    }
  });

  // ----------------------------------------------------------------------
  // GET /api/diffs/:id/status
  // ----------------------------------------------------------------------
  router.get('/api/diffs/:id/status', async (req: Request, res: Response) => {
    const diffId = req.params.id;
    const projectId = extractProjectId(req);
    if (!projectId) {
      return fail(res, 400, 'projectId is required (query param or body field)');
    }
    try {
      const diff = await archModelClient.getDiff(projectId, diffId);
      return res.status(200).json({
        diffId: diff.id,
        status: diff.status,
        matched_count: diff.matched_count,
        status_drift_count: diff.status_drift_count,
        body_shape_drift_count: diff.body_shape_drift_count,
        body_value_drift_count: diff.body_value_drift_count,
        source_only_count: diff.source_only_count,
        target_only_count: diff.target_only_count,
        computed_at: diff.computed_at,
        error_message: diff.error_message,
        isLiveInRunManager: runManager.has(diffId),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'status fetch failed';
      return fail(res, 502, message);
    }
  });

  // ----------------------------------------------------------------------
  // POST /api/diffs/:id/cancel
  // ----------------------------------------------------------------------
  router.post('/api/diffs/:id/cancel', async (req: Request, res: Response) => {
    const diffId = req.params.id;
    const projectId = extractProjectId(req);
    if (!projectId) {
      return fail(res, 400, 'projectId is required (query param or body field)');
    }
    try {
      runManager.cancel(diffId);
      const patched = await archModelClient.updateDiff(projectId, diffId, {
        status: 'failed',
        error_message: 'cancelled',
      });
      return res.status(200).json(patched);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'cancel failed';
      return fail(res, 500, message);
    }
  });

  return router;
}

export const diffActionsRouter = buildDiffActionsRouter();
