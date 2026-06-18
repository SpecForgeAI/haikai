/**
 * diffRunner finding-emission tail-block tests.
 *
 * Spec: 2026-05-25 API Test Harness -- Findings Integration -- Task
 * Group 2 sub-task 2.1.
 *
 * Three tests cover the load-bearing emission-block invariants:
 *
 *   1. Recompute idempotency (THE regression test for the load-bearing
 *      pitfall in tasks.md): two consecutive runs against the same diffId
 *      with the same diff_items input MUST yield the SAME finding count,
 *      not 2x. Without the explicit `deleteFindingsByApiBehaviourDiffId`
 *      call before the create loop, recompute would silently double the
 *      findings. This test fails if the implementer moves the delete call
 *      AFTER the loop or removes it.
 *
 *   2. Fail-soft: mock one finding creation to throw; assert (a) the
 *      throw is caught, (b) emission continues to the next item, (c) the
 *      diff status stays `completed` (not `failed`).
 *
 *   3. Per-rule branching: a happy-path run with a mix of classifications
 *      emits findings only for items where `classifyDiffItem` returns
 *      `shouldEmit=true`, with the right `finding_type` / `severity` /
 *      `links` payload. Validates the integration between the runner and
 *      the rules file.
 */

import { runDiff } from '../services/diffRunner';
import { RunManager } from '../services/runManager';
import type {
  ApiBehaviourDiffDto,
  ApiBehaviourDiffItemDto,
  BaselineDto,
  BaselineItemDto,
} from '../services/archModelClient';

const PROJECT_ID = '00000000-0000-0000-0000-0000000000aa';
const ARCH_ID = '00000000-0000-0000-0000-0000000000bb';
const DIFF_ID = '00000000-0000-0000-0000-0000000000cc';
const SOURCE_BASELINE_ID = '00000000-0000-0000-0000-0000000000dd';
const TARGET_BASELINE_ID = '00000000-0000-0000-0000-0000000000ee';

function buildDiff(overrides: Partial<ApiBehaviourDiffDto> = {}): ApiBehaviourDiffDto {
  const now = new Date().toISOString();
  return {
    id: DIFF_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    source_baseline_id: SOURCE_BASELINE_ID,
    target_baseline_id: TARGET_BASELINE_ID,
    status: 'computing',
    matched_count: null,
    status_drift_count: null,
    body_shape_drift_count: null,
    body_value_drift_count: null,
    source_only_count: null,
    target_only_count: null,
    source_baseline_updated_at: null,
    target_baseline_updated_at: null,
    computed_at: null,
    error_message: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function buildBaseline(
  id: string,
  kind: 'current' | 'target',
  status: 'draft' | 'active' = 'active',
): BaselineDto {
  const now = new Date().toISOString();
  return {
    id,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    session_id: 'session-x',
    name: `${kind}-baseline`,
    status,
    accepted_capture_count: null,
    operation_count: null,
    notes: null,
    kind,
    paired_with_baseline_id: kind === 'target' ? SOURCE_BASELINE_ID : null,
    created_at: now,
    updated_at: now,
  };
}

function buildBaselineItem(opts: {
  id: string;
  baselineId: string;
  method: string;
  path: string;
  scenarioName?: string;
  responseStatus?: number;
  responseJson?: unknown;
}): BaselineItemDto {
  const now = new Date().toISOString();
  return {
    id: opts.id,
    baseline_id: opts.baselineId,
    capture_id: `cap-${opts.id}`,
    operation_id: `op-${opts.id}`,
    scenario_id: `scen-${opts.id}`,
    method: opts.method,
    path: opts.path,
    scenario_name: opts.scenarioName ?? 'happy_path',
    request_json: { query: null, headers: null, body: null },
    response_status: opts.responseStatus ?? 200,
    response_json: opts.responseJson ?? { ok: true },
    business_notes: null,
    created_at: now,
    updated_at: now,
  };
}

interface DiffMockState {
  diffPatches: Array<Record<string, unknown>>;
  diffItemsCreated: Array<Record<string, unknown>>;
  diffFindingsCreated: Array<Record<string, unknown>>;
  deleteCallsByDiffId: string[];
}

function buildArchMock(opts: {
  diff: ApiBehaviourDiffDto;
  sourceBaseline: BaselineDto;
  targetBaseline: BaselineDto;
  sourceItems: BaselineItemDto[];
  targetItems: BaselineItemDto[];
  createDiffFindingThrowsOn?: (body: Record<string, unknown>) => boolean;
}): { mock: Record<string, unknown>; state: DiffMockState } {
  const state: DiffMockState = {
    diffPatches: [],
    diffItemsCreated: [],
    diffFindingsCreated: [],
    deleteCallsByDiffId: [],
  };
  let itemIdCounter = 0;
  const mock = {
    getDiff: jest.fn(async () => opts.diff),
    getBaseline: jest.fn(async (_p: string, id: string) => {
      if (id === opts.sourceBaseline.id) return opts.sourceBaseline;
      if (id === opts.targetBaseline.id) return opts.targetBaseline;
      throw new Error(`getBaseline: no fixture for id=${id}`);
    }),
    listBaselineItems: jest.fn(async (_p: string, baselineId: string) => {
      if (baselineId === opts.sourceBaseline.id) return opts.sourceItems;
      if (baselineId === opts.targetBaseline.id) return opts.targetItems;
      return [];
    }),
    updateDiff: jest.fn(async (_p: string, _id: string, body: Record<string, unknown>) => {
      state.diffPatches.push(body);
      return { ...opts.diff, ...body };
    }),
    createDiffItem: jest.fn(
      async (_p: string, _id: string, body: Record<string, unknown>) => {
        itemIdCounter += 1;
        const persisted: ApiBehaviourDiffItemDto = {
          id: `item-${itemIdCounter}`,
          diff_id: opts.diff.id,
          method: String(body.method),
          path: String(body.path),
          scenario_name: String(body.scenario_name),
          source_baseline_item_id: (body.source_baseline_item_id as string | null) ?? null,
          target_baseline_item_id: (body.target_baseline_item_id as string | null) ?? null,
          status_classification: body.status_classification as ApiBehaviourDiffItemDto['status_classification'],
          body_classification: (body.body_classification as ApiBehaviourDiffItemDto['body_classification']) ?? null,
          header_classification: (body.header_classification as ApiBehaviourDiffItemDto['header_classification']) ?? null,
          source_response_status: (body.source_response_status as number | null) ?? null,
          target_response_status: (body.target_response_status as number | null) ?? null,
          body_diff_json: (body.body_diff_json as Record<string, unknown> | null) ?? null,
          notes: (body.notes as string | null) ?? null,
          created_at: new Date().toISOString(),
        };
        state.diffItemsCreated.push(persisted as unknown as Record<string, unknown>);
        return persisted;
      },
    ),
    deleteFindingsByApiBehaviourDiffId: jest.fn(
      async (_p: string, diffId: string) => {
        state.deleteCallsByDiffId.push(diffId);
        // Simulate AMS-side cleanup: emptying the prior findings array
        // mimics the side effect of the DELETE endpoint.
        state.diffFindingsCreated = [];
      },
    ),
    createDiffFinding: jest.fn(
      async (_p: string, _id: string, body: Record<string, unknown>) => {
        if (opts.createDiffFindingThrowsOn && opts.createDiffFindingThrowsOn(body)) {
          throw new Error('simulated AMS rejection');
        }
        const finding = {
          id: `finding-${state.diffFindingsCreated.length + 1}`,
          ...body,
        };
        state.diffFindingsCreated.push(finding);
        return finding;
      },
    ),
  };
  return { mock, state };
}

function buildRunManagerWithDiff(): RunManager {
  const rm = new RunManager();
  rm.start({
    sessionId: DIFF_ID,
    projectId: PROJECT_ID,
    architectureId: ARCH_ID,
  });
  return rm;
}

/**
 * Build a fixture with: 1 matched (no emit), 1 status_drift 2xx->5xx
 * (critical), 1 source_only (no_paired_target -> high). Three items
 * persisted, exactly two findings emitted on a fresh run.
 */
function buildMixedFixture(): {
  sourceItems: BaselineItemDto[];
  targetItems: BaselineItemDto[];
} {
  const sourceItems = [
    buildBaselineItem({
      id: 's1',
      baselineId: SOURCE_BASELINE_ID,
      method: 'GET',
      path: '/a',
      responseStatus: 200,
      responseJson: { ok: true },
    }),
    buildBaselineItem({
      id: 's2',
      baselineId: SOURCE_BASELINE_ID,
      method: 'GET',
      path: '/payments/42',
      responseStatus: 200,
      responseJson: { ok: true },
    }),
    buildBaselineItem({
      id: 's3',
      baselineId: SOURCE_BASELINE_ID,
      method: 'GET',
      path: '/orphan',
      responseStatus: 200,
      responseJson: { ok: true },
    }),
  ];
  const targetItems = [
    buildBaselineItem({
      id: 't1',
      baselineId: TARGET_BASELINE_ID,
      method: 'GET',
      path: '/a',
      responseStatus: 200,
      // Target wraps response_json in { headers, body } per Spec #4 contract.
      responseJson: { headers: {}, body: { ok: true } },
    }),
    buildBaselineItem({
      id: 't2',
      baselineId: TARGET_BASELINE_ID,
      method: 'GET',
      path: '/payments/42',
      responseStatus: 500,
      responseJson: { headers: {}, body: { ok: true } },
    }),
    // No t3 for /orphan -> classified source_only.
  ];
  return { sourceItems, targetItems };
}

// ---------------------------------------------------------------------------
// Test 1: Recompute idempotency -- THE load-bearing regression test
// ---------------------------------------------------------------------------
test('recompute idempotency: two runs against the same diff yield the SAME finding count (NOT 2x)', async () => {
  const { sourceItems, targetItems } = buildMixedFixture();

  const { mock, state } = buildArchMock({
    diff: buildDiff(),
    sourceBaseline: buildBaseline(SOURCE_BASELINE_ID, 'current'),
    targetBaseline: buildBaseline(TARGET_BASELINE_ID, 'target'),
    sourceItems,
    targetItems,
  });

  // First run.
  const runManager1 = buildRunManagerWithDiff();
  await runDiff(DIFF_ID, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    archModelClient: mock as any,
    runManager: runManager1,
  });
  const firstRunCount = state.diffFindingsCreated.length;
  // Expectation: 2 emits (status_drift critical + source_only high). Item
  // /a is status_match + body_match -> no emit.
  expect(firstRunCount).toBe(2);
  expect(state.deleteCallsByDiffId).toEqual([DIFF_ID]);

  // Second run -- recompute. The diff itself stays around; the runner
  // should call deleteFindingsByApiBehaviourDiffId first, then re-emit
  // the same 2 findings -- NOT 4.
  const runManager2 = buildRunManagerWithDiff();
  await runDiff(DIFF_ID, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    archModelClient: mock as any,
    runManager: runManager2,
  });
  const secondRunCount = state.diffFindingsCreated.length;
  expect(secondRunCount).toBe(firstRunCount);
  expect(secondRunCount).toBe(2);

  // The cleanup endpoint was hit BOTH times -- once per run, BEFORE the
  // create loop. If a future implementer moves it AFTER the loop or
  // removes it, secondRunCount would be 4 and this test would fail.
  expect(state.deleteCallsByDiffId).toEqual([DIFF_ID, DIFF_ID]);

  // Both runs finished with diff status=completed.
  const completedPatches = state.diffPatches.filter(
    (p) => p.status === 'completed',
  );
  expect(completedPatches).toHaveLength(2);
});

// ---------------------------------------------------------------------------
// Test 2: Fail-soft -- one createDiffFinding throws; the others succeed
//          and the diff stays status=completed
// ---------------------------------------------------------------------------
test('fail-soft: one finding create throw does not stop other emissions and does not fail the diff', async () => {
  const { sourceItems, targetItems } = buildMixedFixture();

  const { mock, state } = buildArchMock({
    diff: buildDiff(),
    sourceBaseline: buildBaseline(SOURCE_BASELINE_ID, 'current'),
    targetBaseline: buildBaseline(TARGET_BASELINE_ID, 'target'),
    sourceItems,
    targetItems,
    // Reject the status_drift critical finding; the source_only one
    // should still succeed.
    createDiffFindingThrowsOn: (body) => body.finding_type === 'api_behaviour_status_drift',
  });

  const runManager = buildRunManagerWithDiff();
  await runDiff(DIFF_ID, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    archModelClient: mock as any,
    runManager,
  });

  // Exactly one finding persisted (the source_only one).
  expect(state.diffFindingsCreated).toHaveLength(1);
  expect(state.diffFindingsCreated[0].finding_type).toBe('api_behaviour_missing_target');

  // Diff still PATCHed to completed -- emission errors don't fail the diff.
  const finalDiffPatch = state.diffPatches[state.diffPatches.length - 1];
  expect(finalDiffPatch.status).toBe('completed');
  // The fail-state PATCH should NOT have fired.
  const failedPatches = state.diffPatches.filter((p) => p.status === 'failed');
  expect(failedPatches).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Test 3: Per-rule branching + payload shape (integration with rules file)
// ---------------------------------------------------------------------------
test('per-rule branching: emits only for shouldEmit=true items with correct fields + links', async () => {
  const { sourceItems, targetItems } = buildMixedFixture();

  const { mock, state } = buildArchMock({
    diff: buildDiff(),
    sourceBaseline: buildBaseline(SOURCE_BASELINE_ID, 'current'),
    targetBaseline: buildBaseline(TARGET_BASELINE_ID, 'target'),
    sourceItems,
    targetItems,
  });

  const runManager = buildRunManagerWithDiff();
  await runDiff(DIFF_ID, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    archModelClient: mock as any,
    runManager,
  });

  // 3 diff_items persisted, 2 findings emitted (matched item is no-emit).
  expect(state.diffItemsCreated).toHaveLength(3);
  expect(state.diffFindingsCreated).toHaveLength(2);

  // critical status_drift finding
  const statusDriftFinding = state.diffFindingsCreated.find(
    (f) => f.finding_type === 'api_behaviour_status_drift',
  );
  expect(statusDriftFinding).toBeDefined();
  expect(statusDriftFinding?.severity).toBe('critical');
  expect(statusDriftFinding?.category).toBe('api_behaviour_drift');
  expect(statusDriftFinding?.source).toBe('api_behaviour_diff');
  expect(statusDriftFinding?.created_by_stage).toBe('diffRunner.findingEmission');
  expect(statusDriftFinding?.status).toBe('new');
  // Inline link payload pinned: target_type / link_type / target_id.
  const statusLinks = statusDriftFinding?.links as Array<Record<string, unknown>>;
  expect(statusLinks).toHaveLength(1);
  expect(statusLinks[0].link_type).toBe('derived_from');
  expect(statusLinks[0].target_type).toBe('api_behaviour_diff_item');
  // The target_id should match one of the persisted diff_item ids.
  const persistedItemIds = state.diffItemsCreated.map((it) => it.id);
  expect(persistedItemIds).toContain(statusLinks[0].target_id);

  // high missing-target finding (source_only no_paired_target)
  const missingTargetFinding = state.diffFindingsCreated.find(
    (f) => f.finding_type === 'api_behaviour_missing_target',
  );
  expect(missingTargetFinding).toBeDefined();
  expect(missingTargetFinding?.severity).toBe('high');
});
