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
  haltMigrationRunByOperator,
  retryDbPlaneCompletion,
  resumeFailedMigrationRun,
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
  citeFindingIntoStory,
  amendStoryForFinding,
  createStoryForFinding,
} from '../services/migrationCarryOverActions';
import {
  runCarryOverTriage,
  draftSingleSuggestion,
  fetchTriageCapturedDecisions,
  applyTriageSuggestions,
  TriageItemInput,
  TriageStoryIndexEntry,
  TriageDisposition,
  ApprovedSuggestion,
} from '../services/migrationCarryOverTriage';
import {
  computeRunParityStatus,
  defaultRunParityStatusDeps,
} from '../services/migrationRunParityStatus';
import { currentSystemCredentialsStore } from '../services/baselineDriftScheduler';
import type {
  TargetDbSecret,
  TargetServeSpec,
} from '../services/migrationTargetCredentialsStore';
import { deriveServeSpecDefaults } from '../services/migrationServeSpecDefaults';
import { defaultFetchPackView } from '../services/migrationDbPackPlanner';
import { runOperatorIncrementalSync } from '../services/migrationDataRunnerDispatch';

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
      baseMode?: string;
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
    // Run base modes: 'chain' (default — auto: integration at a deployed
    // disjoint stage boundary, else default branch); 'fresh' = default
    // branch; 'mr' (2026-08-15) = the prior DB run's db-migration/<id>
    // assembly branch (the open Merge Request's code); 'integration'
    // (2026-08-15, now explicit too) = default + every remote db-migration/*
    // and feature/* branch merged.
    const VALID_BASE_MODES = new Set(['chain', 'fresh', 'mr', 'integration']);
    if (body.baseMode !== undefined && !VALID_BASE_MODES.has(body.baseMode)) {
      return res.status(400).json({
        status: 'error',
        message: `baseMode must be one of chain|fresh|mr|integration`,
      });
    }

    const scope: MigrateScope = {
      projectId,
      bookId,
      company: body.company,
      project: body.project,
      plane: (body.plane as MigrateScope['plane']) ?? null,
      parityOverride: body.parityOverride === true,
      baseMode: (body.baseMode as MigrateScope['baseMode']) ?? null,
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
// POST .../migration-execution-runs/:runId/halt -- operator "abandon run"
// (2026-07-28). A run wedged non-terminal (e.g. its IVS job died before the
// pipeline ran and the failure callback never arrived) blocks the rail's
// Start forever. Halting marks non-terminal items failed + the run halted;
// Start re-enables on the next latest-run read.
// ---------------------------------------------------------------------------

migrationExecutionRouter.post(
  '/projects/:projectId/migration-execution-runs/:runId/halt',
  async (req: Request, res: Response) => {
    const { projectId, runId } = req.params;
    const body = (req.body ?? {}) as { reason?: string };
    try {
      const deps = defaultMigrationDriverDeps(buildResultsCallbackUrl());
      const result = await haltMigrationRunByOperator(
        projectId,
        runId,
        deps,
        typeof body.reason === 'string' ? body.reason : undefined
      );
      logger.info('[diag-gateway] migration_execution_driver operator_halt_requested', {
        projectId,
        runId,
        outcome: result.status,
      });
      if (result.status === 'halted') return res.status(200).json(result);
      if (result.status === 'already_terminal') return res.status(409).json(result);
      return res.status(404).json({ error: 'Migration execution run not found' });
    } catch (error) {
      logger.error('[diag-gateway] migration_execution_driver operator_halt_error', {
        projectId,
        runId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return res
        .status(500)
        .json({ status: 'error', message: 'Failed to halt the migration run' });
    }
  }
);

// ---------------------------------------------------------------------------
// POST .../migration-execution-runs/:runId/retry-db-completion — operator
// "Retry DB build" (2026-07-31). A run whose specs ALL implemented but whose
// DB execution chain failed (live: the chain's inputs guard halted on
// unregistered source DB creds) can re-run assemble -> schema-apply -> load
// -> reconcile WITHOUT re-running the specs. The chain is idempotent
// end-to-end; the driver guards fail-closed (only a halted run with an
// implemented/chain-failed final db-plane item).
// ---------------------------------------------------------------------------

migrationExecutionRouter.post(
  '/projects/:projectId/migration-execution-runs/:runId/retry-db-completion',
  async (req: Request, res: Response) => {
    const { projectId, runId } = req.params;
    const body = (req.body ?? {}) as { company?: string; project?: string; book_id?: string };
    if (!body.company || !body.project) {
      return res.status(400).json({
        error: 'body must include company + project (the workspace identifiers)',
      });
    }
    try {
      const deps = defaultMigrationDriverDeps(buildResultsCallbackUrl());
      const result = await retryDbPlaneCompletion(
        {
          projectId,
          bookId: body.book_id ?? '',
          company: body.company,
          project: body.project,
        },
        runId,
        deps
      );
      logger.info('[diag-gateway] migration_execution_driver db_completion_retry_requested', {
        projectId,
        runId,
        outcome: result.status,
      });
      if (result.status === 'retrying') return res.status(200).json(result);
      if (result.status === 'not_retryable') return res.status(409).json(result);
      return res.status(404).json({ error: 'Migration execution run not found' });
    } catch (error) {
      logger.error('[diag-gateway] migration_execution_driver db_completion_retry_error', {
        projectId,
        runId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return res
        .status(500)
        .json({ status: 'error', message: 'Failed to retry the DB build' });
    }
  }
);

// ---------------------------------------------------------------------------
// POST .../migration-execution-runs/:runId/resume-failed — operator "resume
// from failure" (Robustness R2, 2026-08-05). A HALTED run re-runs from its
// failed spec WITHOUT burning the already-implemented items: every
// non-implemented item is reset to pending (outcome/error/job_id cleared,
// retry counters zeroed — a human resume grants a fresh auto-retry budget)
// and the first pending item (or the remaining-batch, for batch runs) is
// re-dispatched through the same primitive the transient auto-retry uses.
//   200 { resumed: true, itemsReset: n } | 409 { allowed: false, reason } |
//   404
// ---------------------------------------------------------------------------

migrationExecutionRouter.post(
  '/projects/:projectId/migration-execution-runs/:runId/resume-failed',
  async (req: Request, res: Response) => {
    const { projectId, runId } = req.params;
    const body = (req.body ?? {}) as {
      company?: string;
      project?: string;
      book_id?: string;
      salvage?: boolean;
    };
    if (!body.company || !body.project) {
      return res.status(400).json({
        error: 'body must include company + project (the workspace identifiers)',
      });
    }
    try {
      const deps = defaultMigrationDriverDeps(buildResultsCallbackUrl());
      const result = await resumeFailedMigrationRun(
        {
          projectId,
          bookId: body.book_id ?? '',
          company: body.company,
          project: body.project,
        },
        runId,
        deps,
        // Salvage-first (2026-08-15): commit+push the first failed item's
        // local worktree and mark it implemented before resuming.
        { salvageFirstFailed: body.salvage === true }
      );
      logger.info('[diag-gateway] migration_execution_driver resume_failed_requested', {
        projectId,
        runId,
        outcome: result.status,
      });
      if (result.status === 'resumed') {
        return res.status(200).json({ resumed: true, itemsReset: result.itemsReset });
      }
      if (result.status === 'not_resumable') {
        return res.status(409).json({ allowed: false, reason: result.reason });
      }
      return res.status(404).json({ error: 'Migration execution run not found' });
    } catch (error) {
      logger.error('[diag-gateway] migration_execution_driver resume_failed_error', {
        projectId,
        runId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return res
        .status(500)
        .json({ status: 'error', message: 'Failed to resume the migration run from failure' });
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
      if (result.status === 'sent_mark_failed') {
        // The bug POSTED but the sent stamp failed (2026-08-07): 207-ish
        // partial truth — the FE must show BOTH facts, not a clean success.
        return res.status(502).json(result);
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
/** Whole-or-400 DB block validation (shared by target `db` + `source_db`). */
function parseDbBlock(
  raw: Record<string, unknown> | undefined | null,
  label: string
): { db?: TargetDbSecret; error?: string } {
  if (raw === undefined || raw === null) return {};
  const d = raw as {
    dbType?: string;
    host?: string;
    port?: number;
    database?: string;
    schema?: string | null;
    username?: string;
    password?: string;
  };
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
    return {
      error: `${label} block must include { dbType: postgres|sybase, host, port, database, username, password }`,
    };
  }
  return {
    db: {
      dbType: d.dbType as 'postgres' | 'sybase',
      host: d.host,
      port: d.port,
      database: d.database,
      schema: d.schema ?? null,
      username: d.username,
      password: d.password,
    },
  };
}

const VALID_AUTH_TYPES = [
  'none', 'bearer', 'api_key_header', 'api_key_query', 'basic', 'custom_header',
];

migrationExecutionRouter.post(
  '/projects/:projectId/migration-execution-runs/:runId/target-credentials',
  async (req: Request, res: Response) => {
    const { projectId, runId } = req.params;
    const body = (req.body ?? {}) as {
      api?: { type?: string };
      db?: Record<string, unknown>;
      /**
       * Stage-1 Start modal (2026-07-31): the SOURCE database credentials.
       * Previously only registerable via the baseline-drift-watch route
       * (which demands baseline context a DB start does not have) — the
       * live run halted at the chain's inputs guard because of exactly
       * that gap. Written to currentSystemCredentialsStore, merge-not-
       * clobber.
       */
      source_db?: Record<string, unknown>;
      /**
       * Stage-2 Start modal (2026-07-31): the target-service serve spec
       * haibox launches for the deploy + API reconcile. TRUST BOUNDARY:
       * command is operator-confirmed input, executed verbatim by haiboxd.
       */
      service?: {
        command?: string;
        health_path?: string;
        port_env?: string;
        readiness_timeout?: number;
        setup?: string;
        env?: Record<string, unknown>;
      };
      /** Stage-2 Start modal: the SOURCE (current system) API details. The
       * auth block is the FULL ApiAuthSecret shape (2026-08-13) — the same
       * methods the capture wizard offers, incl. the ssoToken custom header
       * internal systems require. */
      source_api?: {
        current_base_url?: string;
        api?: {
          type?: string;
          bearerToken?: string;
          username?: string;
          password?: string;
          headerName?: string;
          headerValue?: string;
        };
      };
    };
    if (!body.api || typeof body.api.type !== 'string') {
      return res.status(400).json({ error: 'body must include { api: { type, ... } }' });
    }
    if (!VALID_AUTH_TYPES.includes(body.api.type)) {
      return res.status(400).json({ error: `invalid auth type: ${body.api.type}` });
    }
    // OPTIONAL DB blocks: validated as a whole — a partial block is a 400,
    // never a silently-degraded registration.
    const target = parseDbBlock(body.db, 'db');
    if (target.error) return res.status(400).json({ error: target.error });
    const source = parseDbBlock(body.source_db, 'source_db');
    if (source.error) return res.status(400).json({ error: source.error });

    // OPTIONAL target-service serve spec: whole-or-400.
    let service: TargetServeSpec | undefined;
    if (body.service !== undefined && body.service !== null) {
      const s = body.service;
      const commandOk = typeof s.command === 'string' && s.command.trim().length > 0;
      const healthOk = typeof s.health_path === 'string' && s.health_path.startsWith('/');
      const portEnvOk =
        typeof s.port_env === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(s.port_env);
      const timeoutOk =
        s.readiness_timeout === undefined ||
        (typeof s.readiness_timeout === 'number' &&
          Number.isFinite(s.readiness_timeout) &&
          s.readiness_timeout > 0);
      const envOk =
        s.env === undefined ||
        (typeof s.env === 'object' &&
          s.env !== null &&
          Object.values(s.env).every((v) => typeof v === 'string'));
      const setupOk = s.setup === undefined || typeof s.setup === 'string';
      if (!commandOk || !healthOk || !portEnvOk || !timeoutOk || !envOk || !setupOk) {
        return res.status(400).json({
          error:
            'service block must include { command (non-empty), health_path (/-prefixed), ' +
            'port_env (env-var name) } with optional readiness_timeout (positive number), ' +
            'setup (string) and env (string values)',
        });
      }
      service = {
        command: (s.command as string).trim(),
        healthPath: s.health_path as string,
        portEnv: s.port_env as string,
        ...(s.readiness_timeout !== undefined ? { readinessTimeout: s.readiness_timeout } : {}),
        // Optional bootstrap command (2026-08-01); whitespace-only = absent.
        ...(typeof s.setup === 'string' && s.setup.trim() !== ''
          ? { setup: s.setup.trim() }
          : {}),
        ...(s.env !== undefined ? { env: s.env as Record<string, string> } : {}),
      };
    }

    // OPTIONAL source-API block: whole-or-400.
    let sourceApi: { currentBaseUrl: string; api: { type: string } } | undefined;
    if (body.source_api !== undefined && body.source_api !== null) {
      const sa = body.source_api;
      const urlOk =
        typeof sa.current_base_url === 'string' && /^https?:\/\//.test(sa.current_base_url);
      const apiOk =
        !!sa.api && typeof sa.api.type === 'string' && VALID_AUTH_TYPES.includes(sa.api.type);
      if (!urlOk || !apiOk) {
        return res.status(400).json({
          error: 'source_api block must include { current_base_url (http/https), api: { type } }',
        });
      }
      // Per-type required material (2026-08-13): a secret missing its value
      // would only fail LATER at replay time, invisibly — fail the
      // registration loudly instead.
      const api = sa.api!;
      const missing =
        api.type === 'bearer' && (api.bearerToken ?? '').trim() === ''
          ? 'bearerToken'
          : api.type === 'basic' && (api.username ?? '').trim() === ''
            ? 'username'
            : api.type === 'custom_header' && (api.headerName ?? '').trim() === ''
              ? 'headerName'
              : api.type === 'custom_header' && (api.headerValue ?? '').trim() === ''
                ? 'headerValue'
                : null;
      if (missing) {
        return res.status(400).json({
          error: `source_api.api type '${api.type}' requires a non-empty '${missing}'`,
        });
      }
      sourceApi = { currentBaseUrl: sa.current_base_url as string, api: sa.api as { type: string } };
    }

    // Never log the secret material -- only that creds were registered.
    migrationTargetCredentialsStore.set(
      runId,
      body.api as Parameters<typeof migrationTargetCredentialsStore.set>[1],
      target.db,
      service
    );
    if (source.db) {
      currentSystemCredentialsStore.upsertDb(projectId, source.db);
    }
    if (sourceApi) {
      currentSystemCredentialsStore.upsertApi(projectId, {
        currentBaseUrl: sourceApi.currentBaseUrl,
        api: sourceApi.api as Parameters<typeof migrationTargetCredentialsStore.set>[1],
      });
    }
    logger.info('[diag-gateway] migration_reconciliation target_credentials_registered', {
      runId,
      authType: body.api.type,
      dbRegistered: target.db !== undefined,
      sourceDbRegistered: source.db !== undefined,
      serviceRegistered: service !== undefined,
      sourceApiRegistered: sourceApi !== undefined,
    });
    return res.status(200).json({
      runId,
      registered: true,
      dbRegistered: target.db !== undefined,
      sourceDbRegistered: source.db !== undefined,
      serviceRegistered: service !== undefined,
      sourceApiRegistered: sourceApi !== undefined,
    });
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
    const watch = currentSystemCredentialsStore.get(projectId);
    const sourceDb = watch?.db;
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

    // Source SERVICE (current system API) presence — non-secret fields only
    // (stage-2 Start modal prefill, 2026-07-31).
    const sourceApi =
      watch?.api && watch?.currentBaseUrl
        ? { registered: true, current_base_url: watch.currentBaseUrl, auth_type: watch.api.type }
        : { registered: false };

    // Target registration presence for a specific run (booleans only).
    const targetRegistered = runId
      ? migrationTargetCredentialsStore.getDb(runId) !== undefined
      : false;
    const targetServiceRegistered = runId
      ? migrationTargetCredentialsStore.getService(runId) !== undefined
      : false;

    // DECLARED target-service serve-spec defaults (stage-2 modal prefill):
    // derived from the target-state captured decisions, best-effort.
    const serviceBinding = await deriveServeSpecDefaults(projectId);

    return res.status(200).json({
      target_binding: targetBinding,
      service_binding: serviceBinding,
      source,
      source_api: sourceApi,
      target_registered: targetRegistered,
      target_service_registered: targetServiceRegistered,
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
          architectureId: null,
          itemDetails: {},
          scope: {
            capabilityCount: 0,
            runCount: 0,
            findingCount: 0,
            runScopeSource: 'none',
          },
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
      // 2026-07-26 accounting panel: join the coverage items with their human
      // content (title/summary/severity + the finding's run id — dismissal is
      // run-scoped) so the review screen lists REAL items, not bare UUIDs. The
      // architecture id rides along for the dismiss action; the scope
      // diagnostics (2026-07-27) make an EMPTY coverage explainable. Additive
      // fields — existing consumers of the bare coverage shape are unaffected.
      const itemDetails: Record<string, unknown> = {};
      for (const item of coverage.items) {
        const detail = inputs.itemDetailById.get(item.id);
        if (detail) itemDetails[item.id] = detail;
      }
      return res
        .status(200)
        .json({ ...coverage, architectureId, itemDetails, scope: inputs.scope });
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
 * POST .../migration-books-of-work/:bookId/carry-over/cite-finding — CITE one
 * finding onto an EXISTING story (2026-07-26 triage plumbing). Body:
 *   { book_item_id, finding_id }
 * The AMS item patch adds the finding id to the story's
 * `discoveryFindingReferences` (the D4 gate's citation array). Idempotent.
 */
migrationExecutionRouter.post(
  '/projects/:projectId/migration-books-of-work/:bookId/carry-over/cite-finding',
  async (req: Request, res: Response) => {
    const { projectId, bookId } = req.params;
    const body = (req.body ?? {}) as { book_item_id?: string; finding_id?: string };
    if (!body.book_item_id || typeof body.book_item_id !== 'string') {
      return res.status(400).json({ error: 'book_item_id is required' });
    }
    if (!body.finding_id || typeof body.finding_id !== 'string') {
      return res.status(400).json({ error: 'finding_id is required' });
    }
    try {
      const result = await citeFindingIntoStory({
        projectId,
        bookId,
        bookItemId: body.book_item_id,
        findingId: body.finding_id,
      });
      if (result.ok) {
        return res.status(200).json({ ok: true, alreadyCited: result.alreadyCited });
      }
      return res.status(400).json({ error: result.error });
    } catch (error) {
      logger.error('[diag-gateway] carry_over_action cite_finding_error', {
        projectId,
        bookId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return res.status(502).json({ error: 'Failed to cite the finding' });
    }
  }
);

/**
 * POST .../migration-books-of-work/:bookId/carry-over/amend-story — AMEND an
 * existing story so it actually deals with a finding (2026-07-26 triage
 * plumbing). Body:
 *   { book_item_id, finding_id, description?, append_acceptance_criteria?[] }
 * One atomic AMS transaction: description replace + criteria append + cite +
 * spec rows marked STALE (the story drops out of stage spec-readiness until
 * its spec regenerates with the amendment folded in).
 */
migrationExecutionRouter.post(
  '/projects/:projectId/migration-books-of-work/:bookId/carry-over/amend-story',
  async (req: Request, res: Response) => {
    const { projectId, bookId } = req.params;
    const body = (req.body ?? {}) as {
      book_item_id?: string;
      finding_id?: string;
      description?: string;
      append_acceptance_criteria?: string[];
      stale_reason?: string;
    };
    if (!body.book_item_id || typeof body.book_item_id !== 'string') {
      return res.status(400).json({ error: 'book_item_id is required' });
    }
    if (!body.finding_id || typeof body.finding_id !== 'string') {
      return res.status(400).json({ error: 'finding_id is required' });
    }
    try {
      const result = await amendStoryForFinding({
        projectId,
        bookId,
        bookItemId: body.book_item_id,
        findingId: body.finding_id,
        description: body.description ?? null,
        appendAcceptanceCriteria: Array.isArray(body.append_acceptance_criteria)
          ? body.append_acceptance_criteria
          : null,
        staleReason: body.stale_reason ?? null,
      });
      if (result.ok) {
        return res.status(200).json({
          ok: true,
          workItemId: result.workItemId,
          specsMarkedStale: result.specsMarkedStale,
        });
      }
      return res.status(400).json({ error: result.error });
    } catch (error) {
      logger.error('[diag-gateway] carry_over_action amend_story_error', {
        projectId,
        bookId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return res.status(502).json({ error: 'Failed to amend the story' });
    }
  }
);

/**
 * POST .../migration-books-of-work/:bookId/carry-over/new-story — create a
 * REAL story for a FINDING via D5's add-item, with the finding cited on the
 * blob (2026-07-26 triage plumbing). Body:
 *   { finding_id, title, description, workstream?, acceptance_criteria?[], kind? }
 * The description must EMBED the finding's essence — it is the spec
 * generator's sole grounding for a manual story. (A CAPABILITY's new story
 * stays on the existing `append-capability-story` route.)
 */
migrationExecutionRouter.post(
  '/projects/:projectId/migration-books-of-work/:bookId/carry-over/new-story',
  async (req: Request, res: Response) => {
    const { projectId, bookId } = req.params;
    const body = (req.body ?? {}) as {
      finding_id?: string;
      title?: string;
      description?: string;
      workstream?: string;
      acceptance_criteria?: string[];
      kind?: string;
    };
    if (!body.finding_id || typeof body.finding_id !== 'string') {
      return res.status(400).json({ error: 'finding_id is required' });
    }
    if (!body.title || typeof body.title !== 'string' || body.title.trim() === '') {
      return res.status(400).json({ error: 'title is required' });
    }
    if (
      !body.description ||
      typeof body.description !== 'string' ||
      body.description.trim() === ''
    ) {
      return res.status(400).json({ error: 'description is required (it must embed the finding)' });
    }
    try {
      const result = await createStoryForFinding({
        projectId,
        bookId,
        findingId: body.finding_id,
        title: body.title,
        description: body.description,
        workstream: body.workstream ?? null,
        acceptanceCriteria: Array.isArray(body.acceptance_criteria)
          ? body.acceptance_criteria
          : null,
        kind: body.kind ?? null,
      });
      if (result.ok) {
        return res.status(200).json({
          ok: true,
          workItemId: result.workItemId,
          bookItemId: result.bookItemId,
        });
      }
      return res.status(400).json({ error: result.error });
    } catch (error) {
      logger.error('[diag-gateway] carry_over_action new_story_error', {
        projectId,
        bookId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return res.status(502).json({ error: 'Failed to create the story' });
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

// ---------------------------------------------------------------------------
// Carry-over TRIAGE (2026-07-26): LLM-drafted dispositions, human-approved.
// The bookkeeping (coverage maths, validation, application) is deterministic;
// only the CONTENT (which disposition, what to draft) is LLM-drafted, and
// NOTHING is applied until the reviewer approves it (apply-triage below).
// ---------------------------------------------------------------------------

/**
 * Assemble the triage inputs server-side: the un-accounted items (with their
 * content) + the compact story index (cite/amend targets). Shared by the
 * batch, the re-draft, and the apply routes so all three see the same truth.
 */
async function assembleTriageContext(projectId: string, bookId: string) {
  const book = await fetchBookOfWork(projectId, bookId);
  if (!book) return null;
  const architectureId = book.current_architecture_id ?? null;
  if (!architectureId) return null;
  const workItems = await fetchWorkItems(projectId);
  const inputs = await gatherCarryOverCoverageInputs({
    projectId,
    architectureId,
    book,
    workItems,
  });
  const coverage = computeCarryOverCoverage(inputs);
  const items: TriageItemInput[] = coverage.unaccounted.map((item) => ({
    id: item.id,
    kind: item.kind,
    detail: inputs.itemDetailById.get(item.id) ?? null,
  }));
  const storyIndex: TriageStoryIndexEntry[] = (book.book_of_work_json?.items ?? [])
    .filter((it) => (it.type ?? '').toLowerCase() === 'story' && typeof it.id === 'string')
    .map((it) => ({
      bookItemId: it.id as string,
      title: it.title ?? it.id as string,
      description: it.description ?? '',
      workstream: it.workstream ?? null,
    }));
  return { book, architectureId, inputs, coverage, items, storyIndex };
}

/**
 * POST .../migration-books-of-work/:bookId/carry-over/triage — draft ONE
 * suggestion per un-accounted item (batch, sequential LLM calls). Returns
 * `{ suggestions }` — the review table renders them for editing/approval;
 * NOTHING is applied here.
 */
migrationExecutionRouter.post(
  '/projects/:projectId/migration-books-of-work/:bookId/carry-over/triage',
  async (req: Request, res: Response) => {
    const { projectId, bookId } = req.params;
    try {
      const ctx = await assembleTriageContext(projectId, bookId);
      if (!ctx) {
        return res.status(404).json({ error: 'Book of work (or its architecture) not found' });
      }
      if (ctx.items.length === 0) {
        return res.status(200).json({ suggestions: [] });
      }
      // Decisions stack (2026-08-07): drafts must align with the decisions
      // already made — fetched fail-soft (null = triage still runs).
      const capturedDecisions = await fetchTriageCapturedDecisions(projectId);
      const suggestions = await runCarryOverTriage({
        projectId,
        bookId,
        items: ctx.items,
        storyIndex: ctx.storyIndex,
        capturedDecisions,
      });
      return res.status(200).json({ suggestions });
    } catch (error) {
      logger.error('[diag-gateway] carry_over_triage batch_error', {
        projectId,
        bookId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return res.status(502).json({ error: 'Carry-over triage failed' });
    }
  }
);

/**
 * POST .../migration-books-of-work/:bookId/carry-over/triage/redraft — re-draft
 * ONE item with the reviewer's steering (the user's requirement: a free-text
 * guidance field feeding the LLM when they choose/redirect a disposition).
 * Body: { item_id, forced_disposition?, guidance?, target_book_item_id? }.
 * When a target story is supplied for cite/amend, the story index is narrowed
 * to it so the draft is FOR that story.
 */
migrationExecutionRouter.post(
  '/projects/:projectId/migration-books-of-work/:bookId/carry-over/triage/redraft',
  async (req: Request, res: Response) => {
    const { projectId, bookId } = req.params;
    const body = (req.body ?? {}) as {
      item_id?: string;
      forced_disposition?: string;
      guidance?: string;
      target_book_item_id?: string;
    };
    if (!body.item_id || typeof body.item_id !== 'string') {
      return res.status(400).json({ error: 'item_id is required' });
    }
    const forced =
      typeof body.forced_disposition === 'string' &&
      ['cite', 'amend_story', 'new_story', 'dismiss'].includes(body.forced_disposition)
        ? (body.forced_disposition as TriageDisposition)
        : null;
    try {
      const ctx = await assembleTriageContext(projectId, bookId);
      if (!ctx) {
        return res.status(404).json({ error: 'Book of work (or its architecture) not found' });
      }
      const item = ctx.items.find((i) => i.id === body.item_id);
      if (!item) {
        return res
          .status(400)
          .json({ error: `item '${body.item_id}' is not an un-accounted carry-over item` });
      }
      let storyIndex = ctx.storyIndex;
      if (
        body.target_book_item_id &&
        (forced === 'cite' || forced === 'amend_story')
      ) {
        const target = ctx.storyIndex.filter(
          (s) => s.bookItemId === body.target_book_item_id
        );
        if (target.length === 0) {
          return res
            .status(400)
            .json({ error: `target story '${body.target_book_item_id}' not found` });
        }
        storyIndex = target;
      }
      const suggestion = await draftSingleSuggestion({
        projectId,
        item,
        storyIndex,
        forcedDisposition: forced,
        guidance: body.guidance ?? null,
        capturedDecisions: await fetchTriageCapturedDecisions(projectId),
      });
      return res.status(200).json({ suggestion });
    } catch (error) {
      logger.error('[diag-gateway] carry_over_triage redraft_error', {
        projectId,
        bookId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return res.status(502).json({ error: 'Carry-over re-draft failed' });
    }
  }
);

/**
 * POST .../migration-books-of-work/:bookId/carry-over/apply-triage — apply the
 * APPROVED suggestions (post-editing) sequentially, fail-soft per item,
 * through the SAME action functions the manual buttons use. Body:
 * `{ suggestions: [...] }` — the camelCase suggestion objects this API
 * returned, as edited/approved by the reviewer. Responds with per-item
 * results + the REFRESHED coverage so the panel and Stage-2 card update in
 * one round trip.
 */
migrationExecutionRouter.post(
  '/projects/:projectId/migration-books-of-work/:bookId/carry-over/apply-triage',
  async (req: Request, res: Response) => {
    const { projectId, bookId } = req.params;
    const body = (req.body ?? {}) as { suggestions?: unknown };
    if (!Array.isArray(body.suggestions) || body.suggestions.length === 0) {
      return res.status(400).json({ error: 'suggestions[] is required' });
    }
    const approved: ApprovedSuggestion[] = [];
    for (const raw of body.suggestions) {
      const s = raw as Record<string, unknown>;
      if (
        typeof s.itemId !== 'string' ||
        (s.kind !== 'capability' && s.kind !== 'finding') ||
        typeof s.disposition !== 'string' ||
        !['cite', 'amend_story', 'new_story', 'dismiss'].includes(s.disposition)
      ) {
        return res.status(400).json({
          error:
            'each suggestion needs itemId, kind (capability|finding) and a valid disposition',
        });
      }
      approved.push(s as unknown as ApprovedSuggestion);
    }
    try {
      const ctx = await assembleTriageContext(projectId, bookId);
      if (!ctx) {
        return res.status(404).json({ error: 'Book of work (or its architecture) not found' });
      }
      const results = await applyTriageSuggestions({
        projectId,
        bookId,
        architectureId: ctx.architectureId,
        suggestions: approved,
        itemDetailById: ctx.inputs.itemDetailById,
      });
      // Refresh the coverage AFTER the writes so the response carries truth.
      const after = await assembleTriageContext(projectId, bookId);
      const coverage = after
        ? {
            ...after.coverage,
            architectureId: after.architectureId,
            itemDetails: Object.fromEntries(
              after.coverage.items
                .map((i) => [i.id, after.inputs.itemDetailById.get(i.id)])
                .filter(([, d]) => d !== undefined)
            ),
            scope: after.inputs.scope,
          }
        : null;
      return res.status(200).json({ results, coverage });
    } catch (error) {
      logger.error('[diag-gateway] carry_over_triage apply_error', {
        projectId,
        bookId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return res.status(502).json({ error: 'Carry-over apply-triage failed' });
    }
  }
);

/**
 * POST .../migration-execution-runs/:runId/run-incremental-sync — the
 * operator-triggered side-by-side DAILY sync (gold-standard C4, 2026-08-07).
 * The pack's old bash runner was a comment stub that executed nothing; this
 * dispatches the REAL AMVS incremental-sync capability: keyed keyset deltas
 * above the stored high-water upsert into the shadow target, full_reload
 * tables truncate+reload, `haikai_sync_state` advances per clean table, and
 * pk-diff delete propagation is a bounded per-table opt-in.
 *
 * Body (all optional): { delete_modes?: { "<schema>.<table>": "pk_diff" },
 *                        pk_diff_max_rows?: number }
 * Credentials come from the run's registered stores (never the body).
 * 409 with the full missing-input list when the run cannot execute.
 */
migrationExecutionRouter.post(
  '/projects/:projectId/migration-execution-runs/:runId/run-incremental-sync',
  async (req: Request, res: Response) => {
    const { projectId, runId } = req.params;
    const body = (req.body ?? {}) as {
      delete_modes?: Record<string, string>;
      pk_diff_max_rows?: number;
    };
    try {
      const run = await getMigrationExecutionRun(projectId, runId);
      if (!run) {
        return res.status(404).json({ error: `run ${runId} not found` });
      }
      const bookId = run.book_of_work_id ?? null;
      const book = bookId ? await fetchBookOfWork(projectId, bookId) : null;
      const result = await runOperatorIncrementalSync({
        projectId,
        architectureId: book?.current_architecture_id ?? null,
        runId,
        deleteModes: body.delete_modes,
        pkDiffMaxRows: body.pk_diff_max_rows,
      });
      if (result.status === 'blocked') {
        return res.status(409).json({
          error: 'incremental sync cannot run — missing inputs',
          missing: result.missing,
        });
      }
      if (!result.sync.ok) {
        return res.status(502).json({ error: result.sync.error ?? 'incremental sync failed' });
      }
      return res.status(200).json({
        ok: true,
        status: result.sync.status,
        rows_applied: result.sync.rowsApplied,
        rows_deleted: result.sync.rowsDeleted,
        report: result.sync.report,
      });
    } catch (error) {
      logger.error('[diag-gateway] migration_execution incremental_sync_error', {
        projectId,
        runId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return res.status(502).json({ error: 'incremental sync dispatch failed' });
    }
  }
);
