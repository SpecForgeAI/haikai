/**
 * Tests for the Group-3 post-diff `net_new` `target_only` auto-disposition pass
 * (Spec 2026-06-14, Non-Reconciling Work at Reconcile Time / D6, Task Group 3).
 *
 * The api-migration-validation-service diff stays a PURE, provenance-agnostic
 * current-state diff; this pass is GATEWAY-ONLY and runs AFTER `runHeadlessReconcile`
 * and AFTER the breaks are created. It reads the run's book-of-work `net_new`
 * items' `net_new_operations` (the AUTHORITATIVE human-owned match source) and:
 *  - UNIQUE match -> the (already-created) `target_only` break is immediately
 *    PATCHed to the terminal `expected_net_new` disposition with needs_human=false
 *    + a detail_json audit note naming the matched work item;
 *  - NO match -> the break stays a normal `open` break (unchanged from today);
 *  - AMBIGUOUS (multiple net_new items match the same key, or a net_new item
 *    exists for that path but the operation/method differs) -> stays `open`, with
 *    the match attempt recorded in detail_json;
 *  - a NON-`target_only` break (e.g. status_drift / source_only) is NEVER touched;
 *  - ORACLE UNCHANGED: the pass only RECORDS the additive endpoint (it never
 *    narrows/edits the pinned baseline).
 *
 * All deps are mocked (no AMS round-trip, no validation-service network, no live
 * LLM). The break-store writes (`patchReconciliationBreak`) are asserted on the
 * mock.
 */

// Mock the logger to silence output.
jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  triggerFullBaselineReconcile,
  ReconciliationDriverDeps,
  DEFAULT_CIRCUIT_BREAKER_MAX_ATTEMPTS,
} from '../services/migrationReconciliationDriver';
import {
  ReconciliationDiffItem,
  ReconciliationResult,
} from '../services/migrationReconciliationValidationClient';
import { MigrationExecutionRun } from '../services/migrationExecutionRunClient';
import {
  BREAK_DISPOSITION,
  MigrationReconciliationBreak,
} from '../services/migrationReconciliationBreakClient';
import { ReconcileBookOfWorkItem } from '../services/migrationReconciliationNetNewMatch';

const PROJECT_ID = 'proj-1';
const RUN_ID = 'run-1';
const BOOK_ID = 'book-1';
const PINNED_BASELINE_ID = 'baseline-current-1';
const ARCH_ID = 'arch-1';
const TARGET_URL = 'https://target.example.test';

/** A deployed run with a pinned baseline + target URL + book of work. */
function deployedRun(overrides: Partial<MigrationExecutionRun> = {}): MigrationExecutionRun {
  return {
    id: RUN_ID,
    project_id: PROJECT_ID,
    book_of_work_id: BOOK_ID,
    status: 'deployed',
    pinned_current_baseline_id: PINNED_BASELINE_ID,
    target_base_url: TARGET_URL,
    ...overrides,
  };
}

/** A `target_only` diff item (present in target, absent from baseline). */
function targetOnlyItem(id: string, method: string, path: string): ReconciliationDiffItem {
  return {
    id,
    method,
    path,
    scenario_name: 'default',
    // The hallmark of a target_only diff: null source_baseline_item_id.
    source_baseline_item_id: null,
    target_baseline_item_id: `tgt-${id}`,
    status_classification: 'target_only',
    body_classification: null,
    source_response_status: null,
    target_response_status: 201,
    body_diff_json: null,
    notes: 'target_only',
  };
}

/** An ordinary (NON-target_only) drift item -- a status_drift on a baseline op. */
function statusDriftItem(id: string, sourceItemId: string): ReconciliationDiffItem {
  return {
    id,
    method: 'GET',
    path: '/orders',
    scenario_name: 'default',
    source_baseline_item_id: sourceItemId,
    target_baseline_item_id: `tgt-${id}`,
    status_classification: 'status_drift',
    body_classification: 'body_match',
    source_response_status: 200,
    target_response_status: 500,
    body_diff_json: null,
    notes: null,
  };
}

/** A net_new + api book-of-work item carrying explicit net_new_operations. */
function netNewApiItem(
  over: Partial<ReconcileBookOfWorkItem> & { id: string },
): ReconcileBookOfWorkItem {
  return {
    title: `Net-new ${over.id}`,
    workItemId: `wi-${over.id}`,
    provenance: 'net_new',
    kind: 'api',
    netNewOperations: [],
    ...over,
  };
}

/**
 * Build a reconcile-driver deps surface. `createReconciliationBreaks` echoes the
 * created breaks back WITH ids (so the auto-disposition pass has a break id to
 * PATCH), mirroring the AMS bulk-create contract. Override per test.
 */
function buildDeps(args: {
  diffItems: ReconciliationDiffItem[];
  bookItems: ReconcileBookOfWorkItem[];
  overrides?: Partial<ReconciliationDriverDeps>;
}): {
  deps: ReconciliationDriverDeps;
  createBreaks: jest.Mock;
  patchBreak: jest.Mock;
  loadBookOfWork: jest.Mock;
} {
  // Echo each created break with a deterministic id derived from its diff_item_id.
  const createBreaks = jest.fn(
    async (_p: string, _r: string, breaks: MigrationReconciliationBreak[]) =>
      breaks.map((b, i) => ({ ...b, id: `brk-${b.diff_item_id ?? i}` })),
  );
  const patchBreak = jest.fn().mockResolvedValue({});
  const loadBookOfWork = jest.fn().mockResolvedValue(args.bookItems);

  const reconcileResult: ReconciliationResult = {
    ok: true,
    sessionId: 'sess-1',
    diffId: 'diff-1',
    targetBaselineId: 'tgt-bl-1',
    diffItems: args.diffItems,
    error: null,
  };

  const deps: ReconciliationDriverDeps = {
    createReconciliationBreaks: createBreaks,
    getReconciliationBreaksForRun: jest.fn().mockResolvedValue([]),
    getReconciliationBreaksByBugId: jest.fn().mockResolvedValue([]),
    markReconciliationBreaksSent: jest.fn().mockResolvedValue([]),
    patchReconciliationBreak: patchBreak,
    incrementReconciliationBreakAttempt: jest.fn().mockResolvedValue({}),
    tripReconciliationBreakCircuitBreaker: jest.fn().mockResolvedValue({}),
    patchMigrationExecutionRun: jest.fn().mockResolvedValue({}),
    runHeadlessReconcile: jest.fn().mockResolvedValue(reconcileResult),
    validationDeps: {} as ReconciliationDriverDeps['validationDeps'],
    resolveArchitectureForBaseline: jest.fn().mockResolvedValue(ARCH_ID),
    getTargetCredentials: jest.fn().mockReturnValue({ type: 'none' }),
    implRequest: jest.fn(),
    circuitBreakerMaxAttempts: DEFAULT_CIRCUIT_BREAKER_MAX_ATTEMPTS,
    loadReconcileBookOfWork: loadBookOfWork,
    ...args.overrides,
  };
  return { deps, createBreaks, patchBreak, loadBookOfWork };
}

/** Find the PATCH call (if any) that targeted a given break id. */
function patchFor(patchBreak: jest.Mock, breakId: string): MigrationReconciliationBreak | undefined {
  const call = patchBreak.mock.calls.find((c) => c[1] === breakId);
  return call ? (call[2] as MigrationReconciliationBreak) : undefined;
}

describe('net_new target_only auto-disposition pass (Group 3)', () => {
  it('auto-dispositions a UNIQUELY-matched target_only break to expected_net_new with an audit note naming the work item', async () => {
    const diffItems = [targetOnlyItem('di-new', 'post', '/accounts')];
    const bookItems = [
      netNewApiItem({ id: 'nn-1', workItemId: 'wi-accounts', title: 'Add accounts endpoint', netNewOperations: ['POST /accounts'] }),
    ];
    const { deps, createBreaks, patchBreak } = buildDeps({ diffItems, bookItems });

    const result = await triggerFullBaselineReconcile(deployedRun(), deps);
    expect(result.status).toBe('reconciled');

    // The break WAS created first (create-then-auto-dispose; visible + auditable).
    expect(createBreaks).toHaveBeenCalledTimes(1);
    const created = createBreaks.mock.calls[0][2] as MigrationReconciliationBreak[];
    expect(created).toHaveLength(1);
    expect(created[0].disposition_status).toBe(BREAK_DISPOSITION.OPEN);

    // Then the created break was PATCHed to expected_net_new with needs_human=false.
    const patch = patchFor(patchBreak, 'brk-di-new');
    expect(patch).toBeDefined();
    expect(patch?.disposition_status).toBe(BREAK_DISPOSITION.EXPECTED_NET_NEW);
    expect(patch?.needs_human).toBe(false);
    // The audit note names the matched work item (id + title) + the matched op.
    const detail = (patch?.detail_json ?? {}) as Record<string, unknown>;
    const audit = (detail.net_new_match ?? {}) as Record<string, unknown>;
    expect(audit.outcome).toBe('auto_recognised');
    expect(audit.matched_work_item_id).toBe('wi-accounts');
    expect(String(audit.matched_work_item_title)).toContain('Add accounts endpoint');
    expect(String(audit.matched_operation)).toBe('POST /accounts');
  });

  it('normalises the method/path key (case + whitespace) before matching', async () => {
    // Diff item has lowercase method; the net_new op has padded/upper variants.
    const diffItems = [targetOnlyItem('di-new', 'post', '/accounts')];
    const bookItems = [
      netNewApiItem({ id: 'nn-1', workItemId: 'wi-accounts', netNewOperations: ['  post   /accounts  '] }),
    ];
    const { deps, patchBreak } = buildDeps({ diffItems, bookItems });

    await triggerFullBaselineReconcile(deployedRun(), deps);
    const patch = patchFor(patchBreak, 'brk-di-new');
    expect(patch?.disposition_status).toBe(BREAK_DISPOSITION.EXPECTED_NET_NEW);
  });

  it('leaves a target_only break with NO match as a normal open break (never auto-dispositioned)', async () => {
    const diffItems = [targetOnlyItem('di-new', 'POST', '/widgets')];
    // A net_new item exists, but for a DIFFERENT path -> no match for /widgets.
    const bookItems = [
      netNewApiItem({ id: 'nn-1', netNewOperations: ['POST /accounts'] }),
    ];
    const { deps, patchBreak } = buildDeps({ diffItems, bookItems });

    const result = await triggerFullBaselineReconcile(deployedRun(), deps);
    expect(result.status).toBe('reconciled');
    if (result.status === 'reconciled') expect(result.breakCount).toBe(1);

    // No PATCH to expected_net_new -- the break stays open as today.
    const patch = patchFor(patchBreak, 'brk-di-new');
    expect(patch?.disposition_status).toBeUndefined();
  });

  it('leaves an AMBIGUOUS match (same key on multiple net_new items) as open + records the attempt in detail_json', async () => {
    const diffItems = [targetOnlyItem('di-new', 'POST', '/accounts')];
    const bookItems = [
      netNewApiItem({ id: 'nn-1', workItemId: 'wi-a', netNewOperations: ['POST /accounts'] }),
      netNewApiItem({ id: 'nn-2', workItemId: 'wi-b', netNewOperations: ['POST /accounts'] }),
    ];
    const { deps, patchBreak } = buildDeps({ diffItems, bookItems });

    await triggerFullBaselineReconcile(deployedRun(), deps);

    // The break is PATCHed only to record the ambiguous attempt -- NOT disposed.
    const patch = patchFor(patchBreak, 'brk-di-new');
    expect(patch).toBeDefined();
    expect(patch?.disposition_status).not.toBe(BREAK_DISPOSITION.EXPECTED_NET_NEW);
    // It is NOT moved off open (disposition omitted from the record-attempt patch).
    expect(patch?.disposition_status).toBeUndefined();
    const detail = (patch?.detail_json ?? {}) as Record<string, unknown>;
    const audit = (detail.net_new_match ?? {}) as Record<string, unknown>;
    expect(audit.outcome).toBe('ambiguous');
    // The matched work-item ids are recorded so the human sees why.
    expect(Array.isArray(audit.candidate_work_item_ids)).toBe(true);
    expect(audit.candidate_work_item_ids as string[]).toEqual(
      expect.arrayContaining(['wi-a', 'wi-b']),
    );
  });

  it('treats a same-path/different-method net_new op as AMBIGUOUS (not a clean match)', async () => {
    // The target_only break is GET /accounts; the net_new item declares POST /accounts.
    const diffItems = [targetOnlyItem('di-new', 'GET', '/accounts')];
    const bookItems = [
      netNewApiItem({ id: 'nn-1', workItemId: 'wi-a', netNewOperations: ['POST /accounts'] }),
    ];
    const { deps, patchBreak } = buildDeps({ diffItems, bookItems });

    await triggerFullBaselineReconcile(deployedRun(), deps);
    const patch = patchFor(patchBreak, 'brk-di-new');
    expect(patch?.disposition_status).not.toBe(BREAK_DISPOSITION.EXPECTED_NET_NEW);
    const detail = (patch?.detail_json ?? {}) as Record<string, unknown>;
    const audit = (detail.net_new_match ?? {}) as Record<string, unknown>;
    // A near-miss on the path is surfaced so the human understands the no-match.
    expect(audit.outcome).toBe('ambiguous');
  });

  it('NO-REGRESSION: ordinary (non-target_only) breaks AND a non-net_new target_only are never auto-dispositioned', async () => {
    const diffItems = [
      statusDriftItem('di-drift', 'src-1'), // ordinary break -- never considered
      targetOnlyItem('di-orphan', 'POST', '/unowned'), // target_only with NO net_new owner
    ];
    // Only a net_new item for a DIFFERENT path; neither diff should auto-dispose.
    const bookItems = [netNewApiItem({ id: 'nn-1', netNewOperations: ['POST /accounts'] })];
    const { deps, patchBreak, createBreaks } = buildDeps({ diffItems, bookItems });

    const result = await triggerFullBaselineReconcile(deployedRun(), deps);
    expect(result.status).toBe('reconciled');
    if (result.status === 'reconciled') expect(result.breakCount).toBe(2);

    // The status_drift break is NEVER patched (not a target_only candidate).
    expect(patchFor(patchBreak, 'brk-di-drift')).toBeUndefined();
    // No break was auto-dispositioned to expected_net_new.
    const anyExpected = patchBreak.mock.calls.some(
      (c) => (c[2] as MigrationReconciliationBreak)?.disposition_status === BREAK_DISPOSITION.EXPECTED_NET_NEW,
    );
    expect(anyExpected).toBe(false);
    // Both ordinary diff items still surfaced as breaks (created, open).
    const created = createBreaks.mock.calls[0][2] as MigrationReconciliationBreak[];
    expect(created.every((b) => b.disposition_status === BREAK_DISPOSITION.OPEN)).toBe(true);
  });

  it('does not crash (and skips the pass) when the book-of-work read fails', async () => {
    const diffItems = [targetOnlyItem('di-new', 'POST', '/accounts')];
    const { deps, patchBreak } = buildDeps({
      diffItems,
      bookItems: [],
      overrides: { loadReconcileBookOfWork: jest.fn().mockRejectedValue(new Error('AMS down')) },
    });

    const result = await triggerFullBaselineReconcile(deployedRun(), deps);
    // The reconcile still completes; the target_only break just stays open.
    expect(result.status).toBe('reconciled');
    expect(patchFor(patchBreak, 'brk-di-new')?.disposition_status).toBeUndefined();
  });

  it('only considers net_new items (a carry_over item with the same op does NOT match)', async () => {
    const diffItems = [targetOnlyItem('di-new', 'POST', '/accounts')];
    const bookItems = [
      // A carry_over item that happens to declare the same op must NOT contribute.
      { id: 'co-1', title: 'Carry over', workItemId: 'wi-co', provenance: 'carry_over', kind: 'api', netNewOperations: ['POST /accounts'] },
    ];
    const { deps, patchBreak } = buildDeps({ diffItems, bookItems });

    await triggerFullBaselineReconcile(deployedRun(), deps);
    expect(patchFor(patchBreak, 'brk-di-new')?.disposition_status).toBeUndefined();
  });
});
