/**
 * diffRunner unit tests.
 *
 * Spec: 2026-05-25 API Test Harness -- Diff Engine -- Task Group 3
 * sub-task 3.1.
 *
 * Test inventory:
 *   1. Happy-path: 3 paired items -- 1 matched, 1 status_drift, 1
 *      body_shape_drift -- diff completes with the right count summary
 *      and persists 3 diff_items via stubbed createDiffItem.
 *   2. source_only: source item has no paired target -> emits one
 *      `source_only` diff_item with notes derived from the source item's
 *      business_notes.
 *   3. target_only forward-compat: target item has no paired source ->
 *      emits one `target_only` diff_item.
 *   4. Rejects a draft target baseline -- PATCHes the diff to `failed`
 *      with the canonical error code and exits without persisting items.
 *      (Defense in depth -- the route handler also rejects upfront with
 *      HTTP 400.)
 */

import { runDiff } from '../services/diffRunner';
import { RunManager } from '../services/runManager';
import type {
  ApiBehaviourDiffDto,
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

function buildItem(opts: {
  id: string;
  baselineId: string;
  method: string;
  path: string;
  scenarioName?: string;
  responseStatus?: number;
  responseJson?: unknown;
  businessNotes?: string | null;
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
    business_notes: opts.businessNotes ?? null,
    created_at: now,
    updated_at: now,
  };
}

interface DiffMockState {
  diffPatches: Array<Record<string, unknown>>;
  diffItemsCreated: Array<Record<string, unknown>>;
}

function buildArchMock(opts: {
  diff: ApiBehaviourDiffDto;
  sourceBaseline: BaselineDto;
  targetBaseline: BaselineDto;
  sourceItems: BaselineItemDto[];
  targetItems: BaselineItemDto[];
}): { mock: Record<string, unknown>; state: DiffMockState } {
  const state: DiffMockState = {
    diffPatches: [],
    diffItemsCreated: [],
  };
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
        state.diffItemsCreated.push(body);
        return { id: `item-${state.diffItemsCreated.length}`, ...body };
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

// ---------------------------------------------------------------------------
// Test 1: Happy-path -- 1 matched, 1 status_drift, 1 body_shape_drift
// ---------------------------------------------------------------------------
test('happy path: 3 paired items classify correctly and the diff completes', async () => {
  const diff = buildDiff();
  const sourceItems = [
    buildItem({
      id: 's1',
      baselineId: SOURCE_BASELINE_ID,
      method: 'GET',
      path: '/a',
      responseStatus: 200,
      responseJson: { ok: true },
    }),
    buildItem({
      id: 's2',
      baselineId: SOURCE_BASELINE_ID,
      method: 'GET',
      path: '/b',
      responseStatus: 200,
      responseJson: { ok: true },
    }),
    buildItem({
      id: 's3',
      baselineId: SOURCE_BASELINE_ID,
      method: 'GET',
      path: '/c',
      responseStatus: 200,
      responseJson: { user: { id: 1 } },
    }),
  ];
  // Target items: /a matches; /b has different status (status_drift);
  // /c has an extra key on the target body (body_shape_drift).
  // Note: target wraps response_json in { headers, body }.
  const targetItems = [
    buildItem({
      id: 't1',
      baselineId: TARGET_BASELINE_ID,
      method: 'GET',
      path: '/a',
      responseStatus: 200,
      responseJson: { headers: { 'x-h': '1' }, body: { ok: true } },
    }),
    buildItem({
      id: 't2',
      baselineId: TARGET_BASELINE_ID,
      method: 'GET',
      path: '/b',
      responseStatus: 500,
      responseJson: { headers: {}, body: { ok: true } },
    }),
    buildItem({
      id: 't3',
      baselineId: TARGET_BASELINE_ID,
      method: 'GET',
      path: '/c',
      responseStatus: 200,
      responseJson: {
        headers: {},
        body: { user: { id: 1, name: 'alice' } }, // extra key
      },
    }),
  ];
  const { mock, state } = buildArchMock({
    diff,
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
    now: () => 1700000000000,
  });

  // 3 diff_items persisted
  expect(state.diffItemsCreated).toHaveLength(3);
  const itemsByPath = new Map(
    state.diffItemsCreated.map((it) => [it.path as string, it]),
  );
  expect(itemsByPath.get('/a')?.status_classification).toBe('status_match');
  expect(itemsByPath.get('/a')?.body_classification).toBe('body_match');
  expect(itemsByPath.get('/b')?.status_classification).toBe('status_drift');
  expect(itemsByPath.get('/b')?.body_classification).toBe('body_match');
  expect(itemsByPath.get('/c')?.status_classification).toBe('status_match');
  expect(itemsByPath.get('/c')?.body_classification).toBe('body_shape_drift');

  // Final PATCH carries the count summary + completed status
  const finalPatch = state.diffPatches[state.diffPatches.length - 1];
  expect(finalPatch.status).toBe('completed');
  expect(finalPatch.matched_count).toBe(1);
  expect(finalPatch.status_drift_count).toBe(1);
  expect(finalPatch.body_shape_drift_count).toBe(1);
  expect(finalPatch.body_value_drift_count).toBe(0);
  expect(finalPatch.source_only_count).toBe(0);
  expect(finalPatch.target_only_count).toBe(0);
  expect(finalPatch.computed_at).toBe('2023-11-14T22:13:20.000Z');
});

// ---------------------------------------------------------------------------
// Test 2: source_only -- source item has no paired target
// ---------------------------------------------------------------------------
test('source_only: unpaired source item emits source_only with notes', async () => {
  const diff = buildDiff();
  const sourceItems = [
    buildItem({
      id: 's1',
      baselineId: SOURCE_BASELINE_ID,
      method: 'POST',
      path: '/widgets',
      responseStatus: 201,
      // business_notes carries a hint that this item was mutating-skipped
      businessNotes: 'mutating_skipped: POST suppressed by review',
    }),
  ];
  const { mock, state } = buildArchMock({
    diff,
    sourceBaseline: buildBaseline(SOURCE_BASELINE_ID, 'current'),
    targetBaseline: buildBaseline(TARGET_BASELINE_ID, 'target'),
    sourceItems,
    targetItems: [],
  });
  const runManager = buildRunManagerWithDiff();

  await runDiff(DIFF_ID, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    archModelClient: mock as any,
    runManager,
  });

  expect(state.diffItemsCreated).toHaveLength(1);
  const item = state.diffItemsCreated[0];
  expect(item.status_classification).toBe('source_only');
  expect(item.notes).toBe('mutating_skipped');
  expect(item.body_classification).toBeNull();
  expect(item.target_baseline_item_id).toBeNull();

  const finalPatch = state.diffPatches[state.diffPatches.length - 1];
  expect(finalPatch.status).toBe('completed');
  expect(finalPatch.source_only_count).toBe(1);
});

// ---------------------------------------------------------------------------
// Test 3: target_only forward-compat
// ---------------------------------------------------------------------------
test('target_only: unpaired target item emits target_only diff_item', async () => {
  const diff = buildDiff();
  const targetItems = [
    buildItem({
      id: 't1',
      baselineId: TARGET_BASELINE_ID,
      method: 'GET',
      path: '/new-target-endpoint',
      responseStatus: 200,
      responseJson: { headers: {}, body: { ok: true } },
    }),
  ];
  const { mock, state } = buildArchMock({
    diff,
    sourceBaseline: buildBaseline(SOURCE_BASELINE_ID, 'current'),
    targetBaseline: buildBaseline(TARGET_BASELINE_ID, 'target'),
    sourceItems: [],
    targetItems,
  });
  const runManager = buildRunManagerWithDiff();

  await runDiff(DIFF_ID, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    archModelClient: mock as any,
    runManager,
  });

  expect(state.diffItemsCreated).toHaveLength(1);
  const item = state.diffItemsCreated[0];
  expect(item.status_classification).toBe('target_only');
  expect(item.source_baseline_item_id).toBeNull();
  expect(item.target_baseline_item_id).toBe('t1');

  const finalPatch = state.diffPatches[state.diffPatches.length - 1];
  expect(finalPatch.target_only_count).toBe(1);
});

// ---------------------------------------------------------------------------
// Test 4: rejects draft target baseline (defense in depth)
// ---------------------------------------------------------------------------
test('draft target baseline -> PATCHes diff to failed with the canonical error', async () => {
  const diff = buildDiff();
  const { mock, state } = buildArchMock({
    diff,
    sourceBaseline: buildBaseline(SOURCE_BASELINE_ID, 'current'),
    targetBaseline: buildBaseline(TARGET_BASELINE_ID, 'target', 'draft'),
    sourceItems: [],
    targetItems: [],
  });
  const runManager = buildRunManagerWithDiff();

  await runDiff(DIFF_ID, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    archModelClient: mock as any,
    runManager,
  });

  // No diff_items persisted
  expect(state.diffItemsCreated).toHaveLength(0);
  // Exactly one PATCH: status=failed with the canonical error code
  expect(state.diffPatches).toHaveLength(1);
  expect(state.diffPatches[0].status).toBe('failed');
  expect(state.diffPatches[0].error_message).toBe(
    'target_baseline_not_finalised',
  );
});
