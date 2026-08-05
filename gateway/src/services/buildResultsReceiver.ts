/**
 * Build-Results receiver -- validation, inbound token guard, and dispatch into
 * the Migration Execution Driver advance (Spec 3, Task Group 3).
 *
 * The single inbound door the external implementation/verification service calls
 * after every unit of work: `POST /api/implementation/build-results`. The route
 * itself lives on `implementationProjectsRouter`; this module is the testable
 * core (so the door handler stays thin and the validation / token / dispatch
 * rules are asserted directly).
 *
 * Contract (`BuildResultCallback`, see
 * `docs/reconciliation-integration/migration-reconciliation-integration.md`):
 *   - required `{ company, project, outcome }`;
 *   - exactly one of `job_id` / `bug_id`;
 *   - `outcome in { implemented, deployed, failed, error, rejected,
 *     fix_unserved, not_fixed }` -- the reconciled enum shared with the external
 *     implement-verify-service (`src/verification/outcomes.py`). `failed` is kept
 *     for back-compat; the service emits `error` on the job path and
 *     `fix_unserved` / `not_fixed` on the bug path;
 *   - `target_base_url` REQUIRED when `outcome = deployed`;
 *   - optional `pr_url` + `summary`;
 *   - respond `202 { acknowledged: true }`.
 *   - errors: `401` (bad/missing inbound service token -- NEW; the existing
 *     /api/implementation routes are outbound-auth only), `404` (unknown
 *     `job_id` for the workspace), `422` (neither id, or deployed without
 *     `target_base_url`).
 *
 * Spec 3 owns the `job_id` paths and hands them to
 * {@link advanceRunOnBuildResult}. Spec 4 EXTENDS this same door: the `bug_id`
 * paths now dispatch to {@link advanceRunOnBugResult} (bug_id+deployed -> scoped
 * re-reconcile + circuit breaker; bug_id+failed/rejected -> terminal human-review
 * escalation). Advances are IDEMPOTENT (a duplicate callback for an
 * already-terminal run-item / break is a no-op `202`, CD-6).
 *
 * Spec: Migrate Button + Migration Execution Driver (2026-06-14, Spec 3 of 4) --
 * Task Group 3; Migration Reconciliation + Bug Loop (Spec 4 of 4) -- Group 4.
 */

import { getConfig } from '../config';
import { logger } from './logger';
import { createTracer } from '../trace';

// Haikai workflow trace (OFF unless HAIKAI_TRACE set). One SUMMARY line per
// inbound build-results callback; the per-outcome lines (implemented /
// deployed / failed) are emitted downstream in the driver. See docs/trace-logging.md.
const trace = createTracer('gateway');
import {
  advanceRunOnBuildResult,
  advanceRunOnBugResult,
  AdvanceDecision,
  BugAdvanceDispatch,
  BuildResultOutcome,
  BugResultOutcome,
  MigrationDriverDeps,
} from './migrationExecutionDriver';

/** The inbound build-results callback body (snake_case + camelCase-tolerant). */
export interface BuildResultCallbackBody {
  company?: string;
  project?: string;
  job_id?: string | null;
  jobId?: string | null;
  bug_id?: string | null;
  bugId?: string | null;
  outcome?: string;
  target_base_url?: string | null;
  targetBaseUrl?: string | null;
  pr_url?: string | null;
  prUrl?: string | null;
  summary?: string | null;
  /**
   * Robustness R1 (IVS-side): the orchestrator's failure classification for a
   * failed job — 'transient_upstream' (backend blip; the driver may absorb it
   * with a scheduled retry) | 'real' (the work itself failed; halt). Optional:
   * older IVS builds simply omit it and the driver falls back to its local
   * signature scan.
   */
  failure_class?: string | null;
  failureClass?: string | null;
  /** Robustness R1: the 1-based pipeline step that fataled, when known. */
  failed_step?: number | null;
  failedStep?: number | null;
}

/** The structured outcome of processing a callback (mapped to an HTTP status). */
export interface BuildResultProcessOutcome {
  /** HTTP status to respond with. */
  status: number;
  /** Response body. */
  body: unknown;
  /** The Driver advance decision (for logging), when a job_id was dispatched. */
  decision?: AdvanceDecision;
  /** The bug-callback dispatch kind (for logging), when a bug_id was dispatched. */
  bugDispatch?: BugAdvanceDispatch;
}

// The reconciled outcome enum, matching the external implement-verify-service
// (`src/verification/outcomes.py`). `failed` is retained for back-compat; the
// service splits it into `error` (job path) and `fix_unserved` / `not_fixed`
// (bug path). All non-implemented/non-deployed values route to halt/escalate.
const VALID_OUTCOMES = new Set([
  'implemented',
  'deployed',
  'failed',
  'error',
  'rejected',
  'fix_unserved',
  'not_fixed',
]);

/** Pick a value tolerating both snake_case and camelCase keys. */
function pick(
  snake: string | null | undefined,
  camel: string | null | undefined
): string | null {
  if (typeof snake === 'string' && snake.trim() !== '') return snake;
  if (typeof camel === 'string' && camel.trim() !== '') return camel;
  return null;
}

/**
 * The NEW inbound service-token check (the existing /api/implementation routes
 * are outbound-auth only). Accepts the token via `Authorization: Bearer <token>`
 * or the `X-Service-Token` header. A bad/missing token is a 401. When the
 * configured token is empty, the guard rejects all inbound callbacks (the token
 * MUST be configured for the door to operate).
 */
export function checkInboundServiceToken(headers: {
  authorization?: string;
  'x-service-token'?: string;
}): boolean {
  const expected = getConfig().buildResultsServiceToken;
  if (!expected) {
    // Fail-closed: no configured token means no caller can be authorised.
    return false;
  }
  const authHeader = headers.authorization ?? '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
  const xToken = (headers['x-service-token'] ?? '').trim();
  return bearer === expected || xToken === expected;
}

/**
 * Validate + dispatch a build-results callback. The caller (the route handler)
 * has already passed the inbound token guard. Returns the HTTP status + body to
 * respond with. NEVER throws -- a Driver-advance failure for one item is
 * isolated (the door still acknowledges the callback).
 */
export async function processBuildResult(
  body: BuildResultCallbackBody,
  deps: MigrationDriverDeps
): Promise<BuildResultProcessOutcome> {
  const company = pick(body.company, undefined);
  const project = pick(body.project, undefined);
  const outcome = typeof body.outcome === 'string' ? body.outcome : '';
  const jobId = pick(body.job_id, body.jobId);
  const bugId = pick(body.bug_id, body.bugId);
  const targetBaseUrl = pick(body.target_base_url, body.targetBaseUrl);
  const prUrl = pick(body.pr_url, body.prUrl);
  const summary = pick(body.summary, undefined);
  // Robustness R1/R2: the failure classification + fatal step, when the IVS
  // build sends them. Parsed LENIENTLY — an unknown class value is passed as
  // null (the driver's local signature scan then decides), never a 422:
  // the door must keep acknowledging callbacks from newer/older IVS builds.
  const failureClassRaw = pick(body.failure_class, body.failureClass);
  const failureClass =
    failureClassRaw === 'transient_upstream' || failureClassRaw === 'real'
      ? failureClassRaw
      : null;
  const failedStepRaw = body.failed_step ?? body.failedStep;
  const failedStep =
    typeof failedStepRaw === 'number' && Number.isFinite(failedStepRaw)
      ? failedStepRaw
      : null;

  // --- validation (422) ---
  if (!company || !project) {
    return { status: 422, body: { error: 'company and project are required' } };
  }
  if (!VALID_OUTCOMES.has(outcome)) {
    return {
      status: 422,
      body: {
        error:
          'outcome must be one of implemented | deployed | failed | error | rejected | fix_unserved | not_fixed',
      },
    };
  }
  // Exactly one of job_id / bug_id.
  if ((jobId && bugId) || (!jobId && !bugId)) {
    return { status: 422, body: { error: 'exactly one of job_id / bug_id must be present' } };
  }
  // target_base_url required when deployed.
  if (outcome === 'deployed' && !targetBaseUrl) {
    return { status: 422, body: { error: 'target_base_url is required when outcome = deployed' } };
  }

  trace.step(`build-results received — ${outcome}`, {
    job: jobId ?? undefined,
    bug: bugId ?? undefined,
    project,
  });

  // --- bug_id paths (Spec 4, Group 4): scoped re-reconcile + circuit breaker ---
  if (bugId) {
    logger.info('[diag-gateway] migration_execution_driver build_results_bug_dispatch', {
      company,
      project,
      bugId,
      outcome,
    });
    // bug_id+deployed -> scoped re-reconcile of ONLY that bug's breaks
    // (detached; long replay); bug_id+failed/rejected -> terminal escalation to
    // human review (inline; no replay). Idempotent: a duplicate callback whose
    // breaks are all already terminal is a no-op inside the handler (CD-6). The
    // door always 202s; the dispatch outcome is logging-only.
    const bugDispatch = await advanceRunOnBugResult(
      {
        company,
        project,
        bugId,
        outcome: outcome as BugResultOutcome,
        targetBaseUrl,
        summary,
      },
      deps
    );
    logger.info('[diag-gateway] migration_execution_driver build_results_bug_dispatched', {
      company,
      project,
      bugId,
      outcome,
      bugDispatch,
    });
    return { status: 202, body: { acknowledged: true }, bugDispatch };
  }

  // --- job_id paths (Spec 3 owns these) ---
  // The Driver advance correlates on the globally-unique job_id and recovers the
  // authoritative project id from the run-item's run, so the door passes
  // company/project through for traceability only.
  let decision: AdvanceDecision;
  try {
    decision = await advanceRunOnBuildResult(
      {
        company,
        project,
        jobId: jobId as string,
        outcome: outcome as BuildResultOutcome,
        prUrl,
        targetBaseUrl,
        summary,
        failureClass,
        failedStep,
      },
      deps
    );
  } catch (error) {
    // 2026-07-28: an advance exception (e.g. an AMS read hiccup) used to
    // escape as an opaque 500 — the caller's log showed only "returned 500".
    // Keep the door's never-throw contract: structured 502 naming the cause.
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[diag-gateway] migration_execution_driver build_results_advance_threw', {
      jobId,
      outcome,
      error: message,
    });
    return { status: 502, body: { error: `driver advance failed: ${message}` } };
  }

  if (decision === 'run_item_not_found') {
    logger.warn('[diag-gateway] migration_execution_driver build_results_unknown_job', {
      company,
      project,
      jobId,
      outcome,
    });
    return { status: 404, body: { error: 'unknown job_id for this workspace' } };
  }

  logger.info('[diag-gateway] migration_execution_driver build_results_dispatched', {
    company,
    project,
    jobId,
    outcome,
    decision,
  });
  return { status: 202, body: { acknowledged: true }, decision };
}
