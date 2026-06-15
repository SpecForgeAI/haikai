/**
 * Tests for the Group-2 `deployed` -> FULL-baseline reconcile trigger
 * (Spec 2026-06-14, Migration Reconciliation + Bug Loop, Task Group 2).
 *
 * Covers only the locked behaviours with a fully-mocked dependency surface (no
 * AMS round-trip, no validation-service network, no live LLM):
 *  - `deployed`+no-`bug_id` reads `pinned_current_baseline_id` and drives a
 *    FULL-baseline reconcile (the whole baseline, NOT scoped to migrated specs);
 *  - EVERY drifting diff_item becomes a break keyed on run + source_baseline_item_id,
 *    INCLUDING a deferred / un-migrated story's source_only break (CD-B);
 *  - a clean (status_match+body_match) diff_item is NOT a break;
 *  - a re-fired `deployed` for a run that already has breaks does NOT start a
 *    second reconcile (idempotency, CD-6);
 *  - creds absent at callback time PAUSES in `needs target credentials` (CD-2)
 *    and never drives the reconcile.
 *
 * The live-LLM guard is respected: there is no LLM boundary in the reconcile
 * trigger (the validation-service driver is injected as a mock).
 */

// Mock the logger to silence output.
jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  triggerFullBaselineReconcile,
  ReconciliationDriverDeps,
  RECONCILE_RUN_STATUS,
  DEFAULT_CIRCUIT_BREAKER_MAX_ATTEMPTS,
} from '../services/migrationReconciliationDriver';
import {
  ReconciliationDiffItem,
  ReconciliationResult,
} from '../services/migrationReconciliationValidationClient';
import { MigrationExecutionRun } from '../services/migrationExecutionRunClient';
import { BREAK_DISPOSITION } from '../services/migrationReconciliationBreakClient';

const PROJECT_ID = 'proj-1';
const RUN_ID = 'run-1';
const PINNED_BASELINE_ID = 'baseline-current-1';
const ARCH_ID = 'arch-1';
const TARGET_URL = 'https://target.example.test';

/** A deployed run with a pinned baseline + target URL. */
function deployedRun(overrides: Partial<MigrationExecutionRun> = {}): MigrationExecutionRun {
  return {
    id: RUN_ID,
    project_id: PROJECT_ID,
    book_of_work_id: 'book-1',
    status: 'deployed',
    pinned_current_baseline_id: PINNED_BASELINE_ID,
    target_base_url: TARGET_URL,
    ...overrides,
  };
}

/** A drifting (break) diff_item. */
function driftItem(
  id: string,
  sourceItemId: string,
  classification: string,
  method = 'GET',
  path = '/x'
): ReconciliationDiffItem {
  return {
    id,
    method,
    path,
    scenario_name: 'default',
    source_baseline_item_id: sourceItemId,
    target_baseline_item_id: classification === 'source_only' ? null : `tgt-${id}`,
    status_classification: classification,
    body_classification: classification === 'status_drift' ? 'body_match' : null,
    source_response_status: 200,
    target_response_status: classification === 'source_only' ? null : 500,
    body_diff_json: { entries: [] },
    notes: classification === 'source_only' ? 'source_only' : null,
  };
}

/** A clean (matched) diff_item -- NOT a break. */
function matchItem(id: string, sourceItemId: string): ReconciliationDiffItem {
  return {
    id,
    method: 'GET',
    path: '/clean',
    scenario_name: 'default',
    source_baseline_item_id: sourceItemId,
    target_baseline_item_id: `tgt-${id}`,
    status_classification: 'status_match',
    body_classification: 'body_match',
    source_response_status: 200,
    target_response_status: 200,
    body_diff_json: null,
    notes: null,
  };
}

/** Build a reconcile-driver deps surface; override per test. */
function buildDeps(
  overrides: Partial<ReconciliationDriverDeps> = {},
  reconcileResult?: ReconciliationResult
): {
  deps: ReconciliationDriverDeps;
  createBreaks: jest.Mock;
  patchRun: jest.Mock;
  runReconcile: jest.Mock;
} {
  const createBreaks = jest.fn().mockResolvedValue([]);
  const patchRun = jest.fn().mockResolvedValue({});
  const runReconcile = jest
    .fn()
    .mockResolvedValue(
      reconcileResult ?? {
        ok: true,
        sessionId: 'sess-1',
        diffId: 'diff-1',
        targetBaselineId: 'tgt-bl-1',
        diffItems: [],
        error: null,
      }
    );

  const deps: ReconciliationDriverDeps = {
    createReconciliationBreaks: createBreaks,
    getReconciliationBreaksForRun: jest.fn().mockResolvedValue([]),
    getReconciliationBreaksByBugId: jest.fn().mockResolvedValue([]),
    markReconciliationBreaksSent: jest.fn().mockResolvedValue([]),
    patchReconciliationBreak: jest.fn().mockResolvedValue({}),
    incrementReconciliationBreakAttempt: jest.fn().mockResolvedValue({}),
    tripReconciliationBreakCircuitBreaker: jest.fn().mockResolvedValue({}),
    patchMigrationExecutionRun: patchRun,
    runHeadlessReconcile: runReconcile,
    // The validation transport is never reached (runHeadlessReconcile is mocked).
    validationDeps: {} as ReconciliationDriverDeps['validationDeps'],
    resolveArchitectureForBaseline: jest.fn().mockResolvedValue(ARCH_ID),
    getTargetCredentials: jest.fn().mockReturnValue({ type: 'none' }),
    implRequest: jest.fn(),
    circuitBreakerMaxAttempts: DEFAULT_CIRCUIT_BREAKER_MAX_ATTEMPTS,
    loadReconcileBookOfWork: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
  return { deps, createBreaks, patchRun, runReconcile };
}

describe('triggerFullBaselineReconcile (Group 2)', () => {
  it('drives a FULL-baseline reconcile against the pinned baseline + target URL', async () => {
    const { deps, runReconcile } = buildDeps();
    const result = await triggerFullBaselineReconcile(deployedRun(), deps);

    expect(result.status).toBe('reconciled');
    // The reconcile was driven against the PINNED baseline (CD-1), NOT
    // re-resolved, and against the deployed target URL.
    expect(runReconcile).toHaveBeenCalledTimes(1);
    const call = runReconcile.mock.calls[0][0];
    expect(call.sourceBaselineId).toBe(PINNED_BASELINE_ID);
    expect(call.targetBaseUrl).toBe(TARGET_URL);
    expect(call.architectureId).toBe(ARCH_ID);
  });

  it('maps EVERY drifting diff_item to a break (incl. a deferred-story source_only) keyed on run + source_baseline_item_id', async () => {
    // diff items: a status_drift, a body_value_drift, and a source_only (the
    // classic deferred / un-migrated story signal -- absent in the target), plus
    // one clean match that must NOT become a break.
    const diffItems: ReconciliationDiffItem[] = [
      driftItem('di-1', 'src-1', 'status_drift', 'GET', '/orders'),
      {
        ...driftItem('di-2', 'src-2', 'status_match'),
        body_classification: 'body_value_drift',
      },
      driftItem('di-3', 'src-deferred', 'source_only', 'GET', '/legacy-only'),
      matchItem('di-4', 'src-4'),
    ];
    const { deps, createBreaks } = buildDeps(undefined, {
      ok: true,
      sessionId: 'sess-1',
      diffId: 'diff-1',
      targetBaselineId: 'tgt-bl-1',
      diffItems,
      error: null,
    });

    const result = await triggerFullBaselineReconcile(deployedRun(), deps);
    expect(result.status).toBe('reconciled');
    if (result.status === 'reconciled') {
      // 3 breaks (status_drift + body_value_drift + source_only); the match drops.
      expect(result.breakCount).toBe(3);
    }

    expect(createBreaks).toHaveBeenCalledTimes(1);
    const [projectIdArg, runIdArg, breaksArg] = createBreaks.mock.calls[0];
    expect(projectIdArg).toBe(PROJECT_ID);
    expect(runIdArg).toBe(RUN_ID);
    const persisted = breaksArg as Array<Record<string, unknown>>;
    expect(persisted).toHaveLength(3);
    // The deferred / un-migrated story's source_only divergence IS a break (CD-B).
    const deferredBreak = persisted.find((b) => b.source_baseline_item_id === 'src-deferred');
    expect(deferredBreak).toBeDefined();
    expect(deferredBreak?.run_id).toBe(RUN_ID);
    expect(deferredBreak?.pinned_baseline_id).toBe(PINNED_BASELINE_ID);
    expect(deferredBreak?.diff_item_id).toBe('di-3');
    expect(deferredBreak?.disposition_status).toBe(BREAK_DISPOSITION.OPEN);
    // No clean-match diff_item leaked into the break set.
    expect(persisted.find((b) => b.diff_item_id === 'di-4')).toBeUndefined();
  });

  it('is idempotent: a re-fired deployed for a run with existing breaks does NOT re-reconcile', async () => {
    const { deps, runReconcile, createBreaks } = buildDeps({
      getReconciliationBreaksForRun: jest
        .fn()
        .mockResolvedValue([{ id: 'brk-existing', run_id: RUN_ID }]),
    });
    const result = await triggerFullBaselineReconcile(deployedRun(), deps);
    expect(result.status).toBe('already_reconciled');
    expect(runReconcile).not.toHaveBeenCalled();
    expect(createBreaks).not.toHaveBeenCalled();
  });

  it('is idempotent: a run already in the reconciling latch does NOT re-reconcile', async () => {
    const { deps, runReconcile } = buildDeps();
    const result = await triggerFullBaselineReconcile(
      deployedRun({ status: RECONCILE_RUN_STATUS.RECONCILING }),
      deps
    );
    expect(result.status).toBe('already_reconciled');
    expect(runReconcile).not.toHaveBeenCalled();
  });

  it('pauses in needs_target_credentials when creds are absent and never reconciles (CD-2)', async () => {
    const { deps, runReconcile, patchRun } = buildDeps({
      getTargetCredentials: jest.fn().mockReturnValue(undefined),
    });
    const result = await triggerFullBaselineReconcile(deployedRun(), deps);
    expect(result.status).toBe('needs_target_credentials');
    expect(runReconcile).not.toHaveBeenCalled();
    // The run was paused (not crashed) in the credentials-needed state.
    expect(patchRun).toHaveBeenCalledWith(
      PROJECT_ID,
      RUN_ID,
      expect.objectContaining({ status: RECONCILE_RUN_STATUS.NEEDS_TARGET_CREDENTIALS })
    );
  });

  it('hard-signals when there is no pinned baseline (the oracle anchor)', async () => {
    const { deps, runReconcile } = buildDeps();
    const result = await triggerFullBaselineReconcile(
      deployedRun({ pinned_current_baseline_id: null }),
      deps
    );
    expect(result.status).toBe('no_pinned_baseline');
    expect(runReconcile).not.toHaveBeenCalled();
  });

  it('records reconcile_failed (does not crash) when the headless reconcile fails', async () => {
    const { deps, patchRun } = buildDeps(undefined, {
      ok: false,
      sessionId: 'sess-1',
      diffId: null,
      targetBaselineId: null,
      diffItems: [],
      error: 'target_unreachable',
    });
    const result = await triggerFullBaselineReconcile(deployedRun(), deps);
    expect(result.status).toBe('reconcile_failed');
    expect(patchRun).toHaveBeenCalledWith(
      PROJECT_ID,
      RUN_ID,
      expect.objectContaining({ status: RECONCILE_RUN_STATUS.RECONCILE_FAILED })
    );
  });
});
