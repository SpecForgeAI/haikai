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
import { createTracer } from '../trace';
import {
  startMigration,
  resumeMigration,
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
import {
  computeRunParityStatus,
  defaultRunParityStatusDeps,
} from '../services/migrationRunParityStatus';
import { currentSystemCredentialsStore } from '../services/baselineDriftScheduler';
import type { TargetDbSecret } from '../services/migrationTargetCredentialsStore';
import { defaultFetchPackView } from '../services/migrationDbPackPlanner';

export const migrationExecutionRouter = Router();

// GATE-stage predicate emission (predicate run-judging batch — see
// docs/trace-logging.md §Predicate self-scoring layer). Emission only. A
// BLOCKED verdict is an honest gate evaluation (pass) — the judge decides
// from run context whether the block was expected (negative-path detour) or
// a golden-path problem. Only an evaluation ERROR fails the predicate.
const trace = createTracer('gateway');

function emitMigrateGatePredicate(
  id: string,
  result: { status: string; reasons?: unknown; runId?: unknown },
  corr: { project: string; run?: string },
): void {
  let excerpt = '';
  try {
    excerpt = JSON.stringify(result).slice(0, 260);
  } catch { /* unserializable */ }
  trace.predicate(
    id, 'migrate hard-block gate evaluated with an honest verdict',
    result.status === 'started' || result.status === 'blocked',
    'gate evaluation completes (started OR blocked-with-reasons)',
    `verdict=${result.status} ${excerpt}`,
    corr,
  );
}

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
    const body = (req.body ?? {}) as {
      company?: string;
      project?: string;
      plane?: string;
      parityOverride?: boolean;
    };

    if (!body.company || typeof body.company !== 'string' || body.company.trim() === '') {
      return res.status(400).json({ status: 'error', message: 'company is required' });
    }
    if (!body.project || typeof body.project !== 'string' || body.project.trim() === '') {
      return res.status(400).json({ status: 'error', message: 'project is required' });
    }
    // Per-plane start (2026-07-26): "Start stage N" scopes the run to one
    // plane. Absent = whole-book (legacy behaviour, batch flow).
    const VALID_PLANES = new Set(['db', 'service', 'ui']);
    if (body.plane !== undefined && !VALID_PLANES.has(body.plane as string)) {
      return res
        .status(400)
        .json({ status: 'error', message: `plane must be one of db|service|ui` });
    }

    const scope: MigrateScope = {
      projectId,
      bookId,
      company: body.company,
      project: body.project,
      plane: (body.plane as MigrateScope['plane']) ?? null,
      parityOverride: body.parityOverride === true,
    };

    logger.info('[diag-gateway] migration_execution_driver migrate_trigger', {
      requestId,
      projectId,
      bookId,
      company: body.company,
      project: body.project,
      plane: body.plane ?? null,
      parityOverride: body.parityOverride === true,
    });

    try {
      const deps = defaultMigrationDriverDeps(buildResultsCallbackUrl());
      trace.stageStart('GATE', { project: projectId });
      const result = await startMigration(scope, deps);
      emitMigrateGatePredicate('GATE.MIG.01', result, {
        project: projectId,
        run: typeof (result as { runId?: unknown }).runId === 'string'
          ? (result as { runId: string }).runId
          : undefined,
      });
      trace.stageEnd('GATE', { project: projectId });
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
      trace.predicate(
        'GATE.MIG.01', 'migrate hard-block gate evaluated with an honest verdict', false,
        'gate evaluation completes (started OR blocked-with-reasons)',
        `evaluation threw: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown'}`,
        { project: projectId },
      );
      trace.stageEnd('GATE', { project: projectId });
      return res
        .status(500)
        .json({ status: 'error', message: 'Failed to start the migration run' });
    }
  }
);

// ---------------------------------------------------------------------------
// POST .../migrate-selected -- batch migrate a SELECTED subset (one branch)
// ---------------------------------------------------------------------------

/** Slugify a user batch name into a git-branch-safe `feature/<name>` segment. */
function sanitizeBatchName(raw?: string): string {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, '-')
    .replace(/^[-/]+|[-/]+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 60);
}

/** A fallback batch name when the UI doesn't supply one (branch-safe + unique-ish). */
function defaultBatchName(bookId: string): string {
  const short = (bookId || 'book').replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
  return `migration-${short}-${Date.now().toString(36).slice(-4)}`;
}

migrationExecutionRouter.post(
  '/projects/:projectId/migration-books-of-work/:bookId/migrate-selected',
  async (req: Request, res: Response) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const { projectId, bookId } = req.params;
    const body = (req.body ?? {}) as {
      company?: string;
      project?: string;
      selected_work_item_ids?: unknown;
      batch_name?: string;
    };

    if (!body.company || typeof body.company !== 'string' || body.company.trim() === '') {
      return res.status(400).json({ status: 'error', message: 'company is required' });
    }
    if (!body.project || typeof body.project !== 'string' || body.project.trim() === '') {
      return res.status(400).json({ status: 'error', message: 'project is required' });
    }

    const selected = Array.isArray(body.selected_work_item_ids)
      ? body.selected_work_item_ids.filter(
          (id): id is string => typeof id === 'string' && id.trim() !== ''
        )
      : [];
    if (selected.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'selected_work_item_ids must contain at least one work item id',
      });
    }

    const batchName = sanitizeBatchName(body.batch_name) || defaultBatchName(bookId);

    const scope: MigrateScope = {
      projectId,
      bookId,
      company: body.company,
      project: body.project,
      selectedWorkItemIds: selected,
      batchName,
    };

    logger.info('[diag-gateway] migration_execution_driver migrate_selected_trigger', {
      requestId,
      projectId,
      bookId,
      company: body.company,
      project: body.project,
      selectedCount: selected.length,
      batchName,
    });

    try {
      const deps = defaultMigrationDriverDeps(buildResultsCallbackUrl());
      trace.stageStart('GATE', { project: projectId });
      const result = await startMigration(scope, deps);
      emitMigrateGatePredicate('GATE.MIG.02', result, {
        project: projectId,
        run: typeof (result as { runId?: unknown }).runId === 'string'
          ? (result as { runId: string }).runId
          : undefined,
      });
      trace.stageEnd('GATE', { project: projectId });
      if (result.status === 'started') {
        return res.status(202).json({ ...result, batchName });
      }
      if (result.status === 'blocked') {
        return res.status(409).json(result);
      }
      // status === 'error'
      return res.status(422).json(result);
    } catch (error) {
      logger.error('[diag-gateway] migration_execution_driver migrate_selected_error', {
        requestId,
        projectId,
        bookId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      trace.predicate(
        'GATE.MIG.02', 'migrate hard-block gate evaluated with an honest verdict', false,
        'gate evaluation completes (started OR blocked-with-reasons)',
        `evaluation threw: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown'}`,
        { project: projectId },
      );
      trace.stageEnd('GATE', { project: projectId });
      return res
        .status(500)
        .json({ status: 'error', message: 'Failed to start the batch migration run' });
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
// POST .../migration-execution-runs/:runId/resume -- "approve & continue"
// (Spec W phased execution). Resumes a run PAUSED at a plane boundary
// (awaiting_approval): dispatches the next plane's first spec. When the plane
// being left is the DB plane, the repositioned data-parity gate is re-checked
// (Persistence-conditional) unless `override` is set (human sign-off).
// ---------------------------------------------------------------------------

migrationExecutionRouter.post(
  '/projects/:projectId/migration-execution-runs/:runId/resume',
  async (req: Request, res: Response) => {
    const { projectId, runId } = req.params;
    const body = (req.body ?? {}) as { company?: string; project?: string; override?: boolean };
    if (!body.company || typeof body.company !== 'string' || body.company.trim() === '') {
      return res.status(400).json({ status: 'error', message: 'company is required' });
    }
    if (!body.project || typeof body.project !== 'string' || body.project.trim() === '') {
      return res.status(400).json({ status: 'error', message: 'project is required' });
    }
    // bookId is recovered from the run itself inside resumeMigration.
    const scope: MigrateScope = { projectId, bookId: '', company: body.company, project: body.project };
    try {
      const deps = defaultMigrationDriverDeps(buildResultsCallbackUrl());
      const result = await resumeMigration(scope, runId, deps, { override: body.override === true });
      logger.info('[diag-gateway] migration_execution_driver resume_requested', {
        projectId,
        runId,
        override: body.override === true,
        outcome: result.status,
      });
      if (result.status === 'resumed' || result.status === 'complete') {
        return res.status(200).json(result);
      }
      // not_paused / blocked both surface as 409 (the run is not resumable now).
      if (result.status === 'not_paused' || result.status === 'blocked') {
        return res.status(409).json(result);
      }
      return res.status(422).json(result);
    } catch (error) {
      logger.error('[diag-gateway] migration_execution_driver resume_error', {
        projectId,
        runId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return res
        .status(500)
        .json({ status: 'error', message: 'Failed to resume the migration run' });
    }
  }
);

// ---------------------------------------------------------------------------
// Run parity status (Spec 2026-07-06-i, Tier-1 batch): the on-demand read of
// the completion / closure / drift evaluators for a run — gate codes on the
// existing run surface, no new UI build-out. Evaluators fail CLOSED; input
// read problems surface as warnings on the payload.
// ---------------------------------------------------------------------------

migrationExecutionRouter.get(
  '/projects/:projectId/migration-execution-runs/:runId/parity-status',
  async (req: Request, res: Response) => {
    const { projectId, runId } = req.params;
    try {
      const run = await getMigrationExecutionRun(projectId, runId);
      if (!run) {
        return res.status(404).json({ error: 'Migration execution run not found' });
      }
      const driverDeps = defaultReconciliationDriverDeps();
      const status = await computeRunParityStatus(
        { projectId, run },
        defaultRunParityStatusDeps(
          driverDeps.loadReconcileBookOfWork,
          driverDeps.resolveArchitectureForBaseline
        )
      );
      let statusExcerpt = '';
      try {
        statusExcerpt = JSON.stringify(status).slice(0, 300);
      } catch { /* unserializable */ }
      trace.predicate(
        'REC.STAT.01', 'run parity status computed and logged', true,
        'completion/closure/drift evaluators produce a posture (fail-closed on read problems)',
        statusExcerpt,
        { project: projectId, run: runId },
      );
      return res.status(200).json(status);
    } catch (error) {
      logger.error('[diag-gateway] migration_parity run_status_error', {
        projectId,
        runId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      trace.predicate(
        'REC.STAT.01', 'run parity status computed and logged', false,
        'completion/closure/drift evaluators produce a posture (fail-closed on read problems)',
        `computation threw: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown'}`,
        { project: projectId, run: runId },
      );
      return res.status(502).json({ error: 'Failed to compute run parity status' });
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
 * service at reconcile time. Body: { api: { type, ... }, db?: { dbType, host,
 * port, database, schema?, username, password } }. `type:'none'` is allowed
 * for an unauthenticated like-for-like target. The OPTIONAL `db` block
 * (Spec 2026-07-06-n, Tier-1 batch — user decision Q3) enables state-delta
 * snapshots on the reconcile's mutating replays; same in-memory posture.
 */
migrationExecutionRouter.post(
  '/projects/:projectId/migration-execution-runs/:runId/target-credentials',
  async (req: Request, res: Response) => {
    const { runId } = req.params;
    const body = (req.body ?? {}) as {
      api?: { type?: string };
      db?: {
        dbType?: string;
        host?: string;
        port?: number;
        database?: string;
        schema?: string | null;
        username?: string;
        password?: string;
      };
    };
    if (!body.api || typeof body.api.type !== 'string') {
      return res.status(400).json({ error: 'body must include { api: { type, ... } }' });
    }
    const validTypes = ['none', 'bearer', 'api_key_header', 'api_key_query', 'basic', 'custom_header'];
    if (!validTypes.includes(body.api.type)) {
      return res.status(400).json({ error: `invalid auth type: ${body.api.type}` });
    }
    // OPTIONAL target-DB block: validated as a whole — a partial block is a
    // 400, never a silently-degraded registration.
    let db: Parameters<typeof migrationTargetCredentialsStore.set>[2];
    if (body.db !== undefined && body.db !== null) {
      const d = body.db;
      const engineOk = d.dbType === 'postgres' || d.dbType === 'sybase';
      if (
        !engineOk ||
        !d.host ||
        typeof d.port !== 'number' ||
        !d.database ||
        !d.username ||
        typeof d.password !== 'string' ||
        d.password.length === 0
      ) {
        return res.status(400).json({
          error:
            'db block must include { dbType: postgres|sybase, host, port, database, username, password }',
        });
      }
      db = {
        dbType: d.dbType as 'postgres' | 'sybase',
        host: d.host,
        port: d.port,
        database: d.database,
        schema: d.schema ?? null,
        username: d.username,
        password: d.password,
      };
    }
    // Never log the secret material -- only that creds were registered.
    migrationTargetCredentialsStore.set(
      runId,
      body.api as Parameters<typeof migrationTargetCredentialsStore.set>[1],
      db
    );
    logger.info('[diag-gateway] migration_reconciliation target_credentials_registered', {
      runId,
      authType: body.api.type,
      dbRegistered: db !== undefined,
    });
    return res.status(200).json({ runId, registered: true, dbRegistered: db !== undefined });
  }
);

// ---------------------------------------------------------------------------
// Migration credentials STATUS (Residual 2, 2026-07-20). Presence + NON-SECRET
// coordinates only — passwords NEVER leave the in-memory stores. Feeds the
// plan screen's Start-stage dialog (prefill) and the DB card's creds
// indicator: the plan DECLARED the target binding, so the operator confirms
// coordinates and supplies secrets, never re-types what the tool decided.
// ---------------------------------------------------------------------------

migrationExecutionRouter.get(
  '/projects/:projectId/migration-credentials-status',
  async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const architectureId =
      typeof req.query.architectureId === 'string' ? req.query.architectureId : null;
    const runId = typeof req.query.runId === 'string' ? req.query.runId : null;

    // Declared target binding from the pack manifest (null when no pack or a
    // pre-binding pack).
    let targetBinding: unknown = null;
    if (architectureId) {
      try {
        const packView = await defaultFetchPackView(projectId, architectureId);
        targetBinding =
          (packView?.manifest as { target_db?: unknown } | undefined)?.target_db ??
          null;
      } catch {
        targetBinding = null;
      }
    }

    // Source (current-system) coordinates — non-secret fields only.
    const sourceDb = currentSystemCredentialsStore.get(projectId)?.db;
    const source = sourceDb
      ? {
          registered: true,
          dbType: sourceDb.dbType,
          host: sourceDb.host,
          port: sourceDb.port,
          database: sourceDb.database,
          username: sourceDb.username,
        }
      : { registered: false };

    // Target registration presence for a specific run (boolean only).
    const targetRegistered = runId
      ? migrationTargetCredentialsStore.getDb(runId) !== undefined
      : false;

    return res.status(200).json({
      target_binding: targetBinding,
      source,
      target_registered: targetRegistered,
    });
  }
);

// ---------------------------------------------------------------------------
// Baseline drift watch (Spec 2026-07-06-i amendment §6; Tier-1 batch — user
// decision Q2b): register the CURRENT system's credentials IN GATEWAY MEMORY
// (process lifetime, never persisted, dropped on restart) so the in-process
// scheduler can run unattended drift checks against the pinned baseline.
// ---------------------------------------------------------------------------

migrationExecutionRouter.post(
  '/projects/:projectId/baseline-drift-watch',
  async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const body = (req.body ?? {}) as {
      architecture_id?: string;
      source_baseline_id?: string;
      current_base_url?: string;
      api?: { type?: string };
      db?: Partial<TargetDbSecret>;
    };
    if (
      !body.architecture_id ||
      !body.source_baseline_id ||
      !body.current_base_url ||
      !body.api ||
      typeof body.api.type !== 'string'
    ) {
      return res.status(400).json({
        error:
          'body must include architecture_id, source_baseline_id, current_base_url and api: { type, ... }',
      });
    }
    let db: TargetDbSecret | undefined;
    if (body.db !== undefined && body.db !== null) {
      const d = body.db;
      if (
        (d.dbType !== 'postgres' && d.dbType !== 'sybase') ||
        !d.host ||
        typeof d.port !== 'number' ||
        !d.database ||
        !d.username ||
        typeof d.password !== 'string' ||
        d.password.length === 0
      ) {
        return res.status(400).json({
          error:
            'db block must include { dbType: postgres|sybase, host, port, database, username, password }',
        });
      }
      db = {
        dbType: d.dbType,
        host: d.host,
        port: d.port,
        database: d.database,
        schema: d.schema ?? null,
        username: d.username,
        password: d.password,
      };
    }
    // Never log the secret material — only that a watch was registered.
    currentSystemCredentialsStore.set({
      projectId,
      architectureId: body.architecture_id,
      sourceBaselineId: body.source_baseline_id,
      currentBaseUrl: body.current_base_url,
      api: body.api as never,
      ...(db ? { db } : {}),
    });
    logger.info('[diag-gateway] baseline_drift watch_registered', {
      projectId,
      sourceBaselineId: body.source_baseline_id,
      dbRegistered: db !== undefined,
    });
    return res.status(200).json({ projectId, registered: true, dbRegistered: db !== undefined });
  }
);

migrationExecutionRouter.delete(
  '/projects/:projectId/baseline-drift-watch',
  async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const removed = currentSystemCredentialsStore.delete(projectId);
    logger.info('[diag-gateway] baseline_drift watch_removed', { projectId, removed });
    return res.status(200).json({ projectId, removed });
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
