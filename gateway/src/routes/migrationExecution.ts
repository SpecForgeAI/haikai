/**
 * Migration Execution route (the Migrate trigger + run-progress reads).
 *
 * The gateway-hosted Migration Execution Driver's HTTP surface (Spec 3, Task
 * Group 2). Three endpoints, all book-of-work-scoped:
 *
 *   POST /api/v1/projects/:projectId/migration-books-of-work/:bookId/migrate
 *     The Migrate trigger. Validates the HARD-BLOCK gate server-side (CD-7),
 *     pins the active `kind='current'` baseline, builds the ordered dispatch
 *     set, creates the AMS run, dispatches the FIRST spec, and RETURNS
 *     IMMEDIATELY (the run is NOT held in the request -- CD-5). Body carries the
 *     orchestration `{ company, project }`. Responds:
 *       202 { status: 'started', runId, itemCount }   on launch
 *       409 { status: 'blocked', reasons: [...] }       on a hard-block fail
 *       4xx/5xx { status: 'error', message }            otherwise
 *
 *   GET /api/v1/projects/:projectId/migration-execution-runs/:runId
 *     Read run-state (run + items) for the run-progress view (thin proxy onto
 *     the AMS run-state read).
 *
 *   GET /api/v1/projects/:projectId/migration-books-of-work/:bookId/migration-execution-run
 *     The latest run + items for a book of work (the dashboard's run-progress
 *     lookup); 404 when no run has been kicked off yet.
 *
 * The Driver itself ({@link startMigration}) owns the gate / sequence / dispatch
 * logic; these handlers are thin. The build-results RECEIVER (the inbound door
 * the external service calls) is on `implementationProjectsRouter` (Group 3),
 * NOT here.
 *
 * Spec: Migrate Button + Migration Execution Driver + External Shape-Spec
 * Auto-Answerer (2026-06-14, Spec 3 of 4) -- Task Group 2.
 */

import { Router, Request, Response } from 'express';
import { getConfig } from '../config';
import { logger } from '../services/logger';
import {
  startMigration,
  defaultMigrationDriverDeps,
  MigrateScope,
} from '../services/migrationExecutionDriver';
import {
  getMigrationExecutionRun,
  getLatestMigrationExecutionRunForBook,
} from '../services/migrationExecutionRunClient';
import {
  getReconciliationBreaksForRun,
} from '../services/migrationReconciliationBreakClient';
import {
  defaultReconciliationDriverDeps,
  sendBugForBreaks,
  disposeBreaks,
  declareVolatilePaths,
} from '../services/migrationReconciliationDriver';
import { migrationTargetCredentialsStore } from '../services/migrationTargetCredentialsStore';
import {
  fetchBookOfWork,
  fetchWorkItems,
} from '../services/migrationDriverAmsReads';
import {
  gatherCarryOverCoverageInputs,
} from '../services/migrationCarryOverCoverageReads';
import { computeCarryOverCoverage } from '../services/migrationCarryOverCoverage';
import {
  dismissCarryOverItem,
  generateAllCapabilityStories,
  BatchCapabilityCandidate,
} from '../services/migrationCarryOverActions';

export const migrationExecutionRouter = Router();

/** The gateway's build-results callback URL threaded on every submit (CD-3). */
export function buildResultsCallbackUrl(): string {
  return `${getConfig().gatewayPublicBaseUrl}/api/implementation/build-results`;
}

// ---------------------------------------------------------------------------
// POST .../migrate -- the Migrate trigger
// ---------------------------------------------------------------------------

migrationExecutionRouter.post(
  '/projects/:projectId/migration-books-of-work/:bookId/migrate',
  async (req: Request, res: Response) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId, bookId } = req.params;
    const body = (req.body ?? {}) as { company?: string; project?: string };

    if (!body.company || typeof body.company !== 'string' || body.company.trim() === '') {
      return res.status(400).json({ status: 'error', message: 'company is required' });
    }
    if (!body.project || typeof body.project !== 'string' || body.project.trim() === '') {
      return res.status(400).json({ status: 'error', message: 'project is required' });
    }

    const scope: MigrateScope = {
      projectId,
      bookId,
      company: body.company,
      project: body.project,
    };

    logger.info('[diag-gateway] migration_execution_driver migrate_trigger', {
      requestId,
      projectId,
      bookId,
      company: body.company,
      project: body.project,
    });

    try {
      const deps = defaultMigrationDriverDeps(buildResultsCallbackUrl());
      const result = await startMigration(scope, deps);
      if (result.status === 'started') {
        return res.status(202).json(result);
      }
      if (result.status === 'blocked') {
        return res.status(409).json(result);
      }
      // status === 'error'
      return res.status(422).json(result);
    } catch (error) {
      logger.error('[diag-gateway] migration_execution_driver migrate_trigger_error', {
        requestId,
        projectId,
        bookId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return res
        .status(500)
        .json({ status: 'error', message: 'Failed to start the migration run' });
    }
  }
);

// ---------------------------------------------------------------------------
// GET run-state (run + items) -- the run-progress view
// ---------------------------------------------------------------------------

migrationExecutionRouter.get(
  '/projects/:projectId/migration-execution-runs/:runId',
  async (req: Request, res: Response) => {
    const { projectId, runId } = req.params;
    try {
      const run = await getMigrationExecutionRun(projectId, runId);
      if (!run) {
        return res.status(404).json({ error: 'Migration execution run not found' });
      }
      return res.status(200).json(run);
    } catch (error) {
      logger.error('[diag-gateway] migration_execution_driver get_run_error', {
        projectId,
        runId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return res.status(502).json({ error: 'Failed to read migration execution run' });
    }
  }
);

// ---------------------------------------------------------------------------
// GET latest run for a book of work -- the dashboard's run-progress lookup
// ---------------------------------------------------------------------------

migrationExecutionRouter.get(
  '/projects/:projectId/migration-books-of-work/:bookId/migration-execution-run',
  async (req: Request, res: Response) => {
    const { projectId, bookId } = req.params;
    try {
      const run = await getLatestMigrationExecutionRunForBook(projectId, bookId);
      if (!run) {
        return res.status(404).json({ error: 'No migration execution run for this book of work' });
      }
      return res.status(200).json(run);
    } catch (error) {
      logger.error('[diag-gateway] migration_execution_driver get_latest_run_error', {
        projectId,
        bookId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return res.status(502).json({ error: 'Failed to read migration execution run' });
    }
  }
);

// ---------------------------------------------------------------------------
// Reconciliation breaks: list (the review surface) + the human-gated send +
// the non-sent dispositions (Spec 4, Group 3). The review surface reads the
// run's breaks; Send is the HUMAN GATE (nothing auto-sends); Dispose records a
// terminal human disposition (oracle unchanged -- CD-A).
// ---------------------------------------------------------------------------

/**
 * GET .../migration-execution-runs/:runId/reconciliation-breaks -- the run's
 * breaks (oldest-first) for the reconciliation review surface (Group 5).
 */
migrationExecutionRouter.get(
  '/projects/:projectId/migration-execution-runs/:runId/reconciliation-breaks',
  async (req: Request, res: Response) => {
    const { projectId, runId } = req.params;
    try {
      const breaks = await getReconciliationBreaksForRun(projectId, runId);
      return res.status(200).json(breaks);
    } catch (error) {
      logger.error('[diag-gateway] migration_reconciliation list_breaks_error', {
        projectId,
        runId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return res.status(502).json({ error: 'Failed to read reconciliation breaks' });
    }
  }
);

/**
 * POST .../migration-execution-runs/:runId/reconciliation-breaks/send -- the
 * HUMAN GATE (Group 3): send the user-SELECTED batch of breaks as ONE bug report
 * (CD-4 + CD-5). Body: { company, project, break_ids: [...], title? }. Nothing
 * auto-sends -- this route is the only send path. Responds 200 with the assigned
 * bug_id on success.
 */
migrationExecutionRouter.post(
  '/projects/:projectId/migration-execution-runs/:runId/reconciliation-breaks/send',
  async (req: Request, res: Response) => {
    const { projectId, runId } = req.params;
    const body = (req.body ?? {}) as {
      company?: string;
      project?: string;
      break_ids?: string[];
      title?: string;
    };
    if (!body.company || !body.project) {
      return res.status(400).json({ error: 'company and project are required' });
    }
    if (!Array.isArray(body.break_ids) || body.break_ids.length === 0) {
      return res.status(400).json({ error: 'break_ids must be a non-empty array' });
    }
    try {
      const deps = defaultReconciliationDriverDeps();
      const all = await getReconciliationBreaksForRun(projectId, runId);
      const selected = all.filter((b) => b.id && body.break_ids!.includes(b.id));
      if (selected.length === 0) {
        return res.status(404).json({ error: 'none of the selected break_ids belong to this run' });
      }
      const result = await sendBugForBreaks(
        {
          projectId,
          company: body.company,
          project: body.project,
          breaks: selected,
          callbackUrl: buildResultsCallbackUrl(),
          title: body.title,
        },
        deps
      );
      if (result.status === 'sent') {
        return res.status(200).json(result);
      }
      if (result.status === 'no_breaks') {
        return res.status(409).json(result);
      }
      return res.status(502).json(result);
    } catch (error) {
      logger.error('[diag-gateway] migration_reconciliation send_bug_error', {
        projectId,
        runId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return res.status(500).json({ status: 'send_failed', error: 'Failed to send the bug report' });
    }
  }
);

/**
 * POST .../migration-execution-runs/:runId/reconciliation-breaks/dispose -- the
 * non-sent terminal dispositions (Group 3). Body: { break_ids: [...],
 * disposition: accepted|wont_report|intentional_deviation }. The oracle is NEVER
 * mutated (CD-A) -- this is how intentional / deferred deviations are handled.
 */
migrationExecutionRouter.post(
  '/projects/:projectId/migration-execution-runs/:runId/reconciliation-breaks/dispose',
  async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const body = (req.body ?? {}) as {
      break_ids?: string[];
      disposition?: string;
      error_detail?: string | null;
    };
    if (!Array.isArray(body.break_ids) || body.break_ids.length === 0) {
      return res.status(400).json({ error: 'break_ids must be a non-empty array' });
    }
    if (!body.disposition) {
      return res.status(400).json({ error: 'disposition is required' });
    }
    try {
      const deps = defaultReconciliationDriverDeps();
      const result = await disposeBreaks(
        {
          projectId,
          breakIds: body.break_ids,
          disposition: body.disposition,
          errorDetail: body.error_detail ?? null,
        },
        deps
      );
      if (result.status === 'invalid_disposition') {
        return res.status(400).json({
          error:
            'disposition must be one of accepted | wont_report | intentional_deviation',
        });
      }
      return res.status(200).json(result);
    } catch (error) {
      logger.error('[diag-gateway] migration_reconciliation dispose_error', {
        projectId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return res.status(500).json({ error: 'Failed to dispose the breaks' });
    }
  }
);

/**
 * POST .../migration-execution-runs/:runId/reconciliation-breaks/declare-volatile --
 * the in-UI human-declared volatile path action (2026-06-16, Q3). Body:
 * { operation: '<METHOD> <path>', declared_paths: ['/createdAt', ...] }. A path
 * declared through the existing break-detail / disposition UI is applied
 * RETROACTIVELY to the CURRENT run -- it re-evaluates and re-disposes the
 * already-open breaks on that operation (tag `declared`, the highest-trust
 * volatile source) via the existing PATCH path. No new AMS endpoint, no admin
 * screen. The oracle is NEVER changed -- this only annotates variance.
 *
 * Spec: Reconcile-Time Determinism & Volatile-Value Handling (2026-06-16) --
 * Task Group 4 (sub-task 4.3, the gateway side; the frontend is Group 5).
 */
migrationExecutionRouter.post(
  '/projects/:projectId/migration-execution-runs/:runId/reconciliation-breaks/declare-volatile',
  async (req: Request, res: Response) => {
    const { projectId, runId } = req.params;
    const body = (req.body ?? {}) as { operation?: string; declared_paths?: string[] };
    if (!body.operation || typeof body.operation !== 'string') {
      return res.status(400).json({ error: 'operation ("<METHOD> <path>") is required' });
    }
    if (!Array.isArray(body.declared_paths) || body.declared_paths.length === 0) {
      return res.status(400).json({ error: 'declared_paths must be a non-empty array' });
    }
    try {
      const deps = defaultReconciliationDriverDeps();
      // Re-disposition is scoped to the CURRENT run's breaks (retroactive, not
      // forward-only): read them, then re-tag + re-classify the open breaks on
      // the named operation.
      const breaks = await getReconciliationBreaksForRun(projectId, runId);
      const result = await declareVolatilePaths(
        {
          projectId,
          operation: body.operation,
          declaredPaths: body.declared_paths,
          breaks,
        },
        deps
      );
      return res.status(200).json(result);
    } catch (error) {
      logger.error('[diag-gateway] migration_reconciliation declare_volatile_error', {
        projectId,
        runId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return res.status(500).json({ error: 'Failed to declare the volatile paths' });
    }
  }
);

/**
 * POST .../migration-execution-runs/:runId/target-credentials -- register the
 * run's target-env credentials (CD-2). Captured once at the Migrate confirm step
 * (the user knows the target auth up front); held in-memory for the run only,
 * NEVER persisted, NEVER logged. The reconcile loads them into the validation
 * service at reconcile time. Body: { api: { type, ... } }. `type:'none'` is
 * allowed for an unauthenticated like-for-like target.
 */
migrationExecutionRouter.post(
  '/projects/:projectId/migration-execution-runs/:runId/target-credentials',
  async (req: Request, res: Response) => {
    const { runId } = req.params;
    const body = (req.body ?? {}) as { api?: { type?: string } };
    if (!body.api || typeof body.api.type !== 'string') {
      return res.status(400).json({ error: 'body must include { api: { type, ... } }' });
    }
    const validTypes = ['none', 'bearer', 'api_key_header', 'api_key_query', 'basic', 'custom_header'];
    if (!validTypes.includes(body.api.type)) {
      return res.status(400).json({ error: `invalid auth type: ${body.api.type}` });
    }
    // Never log the secret material -- only that creds were registered.
    migrationTargetCredentialsStore.set(runId, body.api as Parameters<typeof migrationTargetCredentialsStore.set>[1]);
    logger.info('[diag-gateway] migration_reconciliation target_credentials_registered', {
      runId,
      authType: body.api.type,
    });
    return res.status(200).json({ runId, registered: true });
  }
);

// ---------------------------------------------------------------------------
// D4 — Carry-over completeness gate: coverage read + dismiss + batch
// (Spec 2026-06-14 D4 — Carry-over Completeness Gate, Task Group 3)
//
// The cite action (single) is the already-existing D3 `append-capability-story`
// route on `migrationShapeSpecGenerationRouter`. These three are the gate's own
// surface: the per-item coverage status the review surface + Migrate panel read,
// the dismiss action (mandatory reason), and the "Generate all capability
// stories" batch. NONE touch the LLM.
// ---------------------------------------------------------------------------

/**
 * GET .../migration-books-of-work/:bookId/carry-over-coverage — the per-item
 * carry_over coverage for the book (un-actioned / cited-by-story / dismissed),
 * the must-account set, and the un-accounted list. The Capabilities review
 * surface renders the status column from this; the Migrate panel reads the
 * un-accounted count for the blocked-reason deep-link. Server-computed (never
 * trust the UI).
 */
migrationExecutionRouter.get(
  '/projects/:projectId/migration-books-of-work/:bookId/carry-over-coverage',
  async (req: Request, res: Response) => {
    const { projectId, bookId } = req.params;
    try {
      const book = await fetchBookOfWork(projectId, bookId);
      if (!book) {
        return res.status(404).json({ error: 'Book of work not found' });
      }
      const architectureId = book.current_architecture_id ?? null;
      if (!architectureId) {
        // No architecture -> nothing to account for; an empty, ok coverage.
        return res.status(200).json({
          items: [],
          mustAccount: [],
          unaccounted: [],
          accountedCount: 0,
          totalMustAccount: 0,
          ok: true,
        });
      }
      const workItems = await fetchWorkItems(projectId);
      const inputs = await gatherCarryOverCoverageInputs({
        projectId,
        architectureId,
        book,
        workItems,
      });
      const coverage = computeCarryOverCoverage(inputs);
      return res.status(200).json(coverage);
    } catch (error) {
      logger.error('[diag-gateway] carry_over_coverage read_error', {
        projectId,
        bookId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return res.status(502).json({ error: 'Failed to compute carry-over coverage' });
    }
  }
);

/**
 * POST .../carry-over/dismiss — dismiss ONE behaviour-bearing carry_over item
 * with a MANDATORY non-empty reason. Body:
 *   { kind: 'capability'|'finding', id, architecture_id, run_id?, reason }
 * An empty reason is rejected 400 (the gate is not satisfied without a reason).
 * A finding requires `run_id` (the AMS finding review is run-scoped).
 */
migrationExecutionRouter.post(
  '/projects/:projectId/carry-over/dismiss',
  async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const body = (req.body ?? {}) as {
      kind?: string;
      id?: string;
      architecture_id?: string;
      run_id?: string;
      reason?: string;
    };
    if (body.kind !== 'capability' && body.kind !== 'finding') {
      return res.status(400).json({ error: "kind must be 'capability' or 'finding'" });
    }
    if (!body.id || typeof body.id !== 'string') {
      return res.status(400).json({ error: 'id is required' });
    }
    if (!body.architecture_id || typeof body.architecture_id !== 'string') {
      return res.status(400).json({ error: 'architecture_id is required' });
    }
    if (!body.reason || typeof body.reason !== 'string' || body.reason.trim() === '') {
      return res.status(400).json({ error: 'a non-empty dismissal reason is required' });
    }
    try {
      const result = await dismissCarryOverItem({
        projectId,
        architectureId: body.architecture_id,
        kind: body.kind,
        id: body.id,
        runId: body.run_id,
        reason: body.reason,
      });
      if (result.ok) {
        return res.status(200).json({ ok: true });
      }
      return res.status(400).json({ error: result.error });
    } catch (error) {
      logger.error('[diag-gateway] carry_over_action dismiss_error', {
        projectId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return res.status(502).json({ error: 'Failed to dismiss the carry-over item' });
    }
  }
);

/**
 * POST .../migration-books-of-work/:bookId/carry-over/generate-all-capability-stories
 * — the batch: cite once per un-covered approved behaviour-bearing capability.
 * Reads the book's capabilities + work items server-side to derive the
 * already-cited set, so the UI cannot under/over-cite. Responds with the cited /
 * skipped counts + any per-capability failures.
 */
migrationExecutionRouter.post(
  '/projects/:projectId/migration-books-of-work/:bookId/carry-over/generate-all-capability-stories',
  async (req: Request, res: Response) => {
    const { projectId, bookId } = req.params;
    try {
      const book = await fetchBookOfWork(projectId, bookId);
      if (!book) {
        return res.status(404).json({ error: 'Book of work not found' });
      }
      const architectureId = book.current_architecture_id ?? null;
      if (!architectureId) {
        return res.status(200).json({ citedCount: 0, skippedCount: 0, failures: [] });
      }
      const workItems = await fetchWorkItems(projectId);
      const inputs = await gatherCarryOverCoverageInputs({
        projectId,
        architectureId,
        book,
        workItems,
      });
      const candidates: BatchCapabilityCandidate[] = inputs.capabilities.map((c) => ({
        id: c.id,
        // The capability's human label (its `name`) is the created story title;
        // falls back to the id when the name is absent.
        title: inputs.capabilityTitleById.get(c.id) ?? c.id,
        reviewStatus: c.reviewStatus,
        behaviourBearing: c.behaviourBearing,
        alreadyCited: inputs.citedCapabilityIds.has(c.id),
      }));
      const result = await generateAllCapabilityStories({ projectId, bookId, capabilities: candidates });
      return res.status(200).json(result);
    } catch (error) {
      logger.error('[diag-gateway] carry_over_action generate_all_error', {
        projectId,
        bookId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return res.status(502).json({ error: 'Failed to generate capability stories' });
    }
  }
);
