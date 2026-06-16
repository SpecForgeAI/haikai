/**
 * diffRunner volatility-tolerance integration tests.
 *
 * Spec: 2026-06-16 Reconcile-Time Determinism & Volatile-Value Handling --
 * Task Group 3 sub-tasks 3.2 / 3.4 / 3.6.
 *
 * These assert the RUNNER threads the source item's `volatile_paths_json`
 * envelope and the `non_deterministic_endpoint` signal into the comparator,
 * and persists the per-break volatility metadata on `body_diff_json` so the
 * gateway pass can act.
 *
 * Test inventory:
 *   1. A probed envelope on the source item -> a value-only diff is tolerated
 *      (body_match) and `body_diff_json.volatility_sources` carries `probed`.
 *   2. The `non_deterministic_endpoint` signal (no envelope) -> value
 *      tolerance, `volatility_sources` carries `endpoint_signal`.
 *   3. (G1) No envelope + no signal -> strict: a value diff is a real
 *      body_value_drift with NO volatility metadata.
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

function buildDiff(): ApiBehaviourDiffDto {
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
  };
}

function buildBaseline(id: string, kind: 'current' | 'target'): BaselineDto {
  const now = new Date().toISOString();
  return {
    id,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    session_id: 'session-x',
    name: `${kind}-baseline`,
    status: 'active',
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
  responseJson: unknown;
  volatilePathsJson?: Record<string, unknown> | null;
}): BaselineItemDto {
  const now = new Date().toISOString();
  return {
    id: opts.id,
    baseline_id: opts.baselineId,
    capture_id: `cap-${opts.id}`,
    operation_id: `op-${opts.id}`,
    scenario_id: `scen-${opts.id}`,
    method: 'GET',
    path: '/widget',
    scenario_name: 'happy_path',
    request_json: { query: null, headers: null, body: null },
    response_status: 200,
    response_json: opts.responseJson,
    business_notes: null,
    volatile_paths_json: opts.volatilePathsJson ?? null,
    created_at: now,
    updated_at: now,
  };
}

interface State {
  diffItemsCreated: Array<Record<string, unknown>>;
  diffPatches: Array<Record<string, unknown>>;
}

function buildArchMock(sourceItem: BaselineItemDto, targetItem: BaselineItemDto): {
  mock: Record<string, unknown>;
  state: State;
} {
  const state: State = { diffItemsCreated: [], diffPatches: [] };
  const diff = buildDiff();
  const mock = {
    getDiff: jest.fn(async () => diff),
    getBaseline: jest.fn(async (_p: string, id: string) =>
      id === SOURCE_BASELINE_ID
        ? buildBaseline(SOURCE_BASELINE_ID, 'current')
        : buildBaseline(TARGET_BASELINE_ID, 'target'),
    ),
    listBaselineItems: jest.fn(async (_p: string, baselineId: string) =>
      baselineId === SOURCE_BASELINE_ID ? [sourceItem] : [targetItem],
    ),
    updateDiff: jest.fn(async (_p: string, _id: string, body: Record<string, unknown>) => {
      state.diffPatches.push(body);
      return { ...diff, ...body };
    }),
    createDiffItem: jest.fn(
      async (_p: string, _id: string, body: Record<string, unknown>) => {
        state.diffItemsCreated.push(body);
        return { id: `item-${state.diffItemsCreated.length}`, ...body };
      },
    ),
    // Tail block: keep it quiet -- classify everything as no-emit.
    deleteFindingsByApiBehaviourDiffId: jest.fn(async () => undefined),
    createDiffFinding: jest.fn(async () => ({})),
  };
  return { mock, state };
}

function runManagerForDiff(): RunManager {
  const rm = new RunManager();
  rm.start({ sessionId: DIFF_ID, projectId: PROJECT_ID, architectureId: ARCH_ID });
  return rm;
}

const NO_EMIT = () => ({ shouldEmit: false }) as never;

test('1. probed envelope -> value-only diff tolerated; volatility_sources=probed', async () => {
  const sourceItem = buildItem({
    id: 's1',
    baselineId: SOURCE_BASELINE_ID,
    responseJson: { id: 1, updatedAt: '2026-06-16T10:00:00Z' },
    volatilePathsJson: { paths: ['/updatedAt'], volatility_source: 'probed', k: 3 },
  });
  const targetItem = buildItem({
    id: 't1',
    baselineId: TARGET_BASELINE_ID,
    responseJson: { headers: {}, body: { id: 1, updatedAt: '2026-06-16T11:30:00Z' } },
  });
  const { mock, state } = buildArchMock(sourceItem, targetItem);

  await runDiff(DIFF_ID, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    archModelClient: mock as any,
    runManager: runManagerForDiff(),
    now: () => 1700000000000,
    classifyDiffItem: NO_EMIT,
  });

  expect(state.diffItemsCreated).toHaveLength(1);
  const item = state.diffItemsCreated[0];
  // Tolerated -> body_match (not body_value_drift).
  expect(item.body_classification).toBe('body_match');
  const diffJson = item.body_diff_json as Record<string, unknown>;
  expect(diffJson.volatility_sources).toEqual(['probed']);
});

test('2. non_deterministic_endpoint signal -> value tolerance, endpoint_signal tag', async () => {
  const sourceItem = buildItem({
    id: 's1',
    baselineId: SOURCE_BASELINE_ID,
    responseJson: { id: 1, a: 'x' },
    volatilePathsJson: null, // probe recorded nothing
  });
  const targetItem = buildItem({
    id: 't1',
    baselineId: TARGET_BASELINE_ID,
    responseJson: { headers: {}, body: { id: 1, a: 'z' } },
  });
  const { mock, state } = buildArchMock(sourceItem, targetItem);

  await runDiff(DIFF_ID, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    archModelClient: mock as any,
    runManager: runManagerForDiff(),
    now: () => 1700000000000,
    classifyDiffItem: NO_EMIT,
    // operationKey is `${METHOD}|${path}` -> `GET|/widget`.
    nonDeterministicEndpointKeys: new Set(['GET|/widget']),
  });

  const item = state.diffItemsCreated[0];
  expect(item.body_classification).toBe('body_match');
  const diffJson = item.body_diff_json as Record<string, unknown>;
  expect(diffJson.volatility_sources).toEqual(['endpoint_signal']);
});

test('3. (G1) no envelope + no signal -> strict body_value_drift, no metadata', async () => {
  const sourceItem = buildItem({
    id: 's1',
    baselineId: SOURCE_BASELINE_ID,
    responseJson: { id: 1, updatedAt: '2026-06-16T10:00:00Z' },
    volatilePathsJson: null,
  });
  const targetItem = buildItem({
    id: 't1',
    baselineId: TARGET_BASELINE_ID,
    responseJson: { headers: {}, body: { id: 1, updatedAt: '2026-06-16T11:30:00Z' } },
  });
  const { mock, state } = buildArchMock(sourceItem, targetItem);

  await runDiff(DIFF_ID, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    archModelClient: mock as any,
    runManager: runManagerForDiff(),
    now: () => 1700000000000,
    classifyDiffItem: NO_EMIT,
  });

  const item = state.diffItemsCreated[0];
  expect(item.body_classification).toBe('body_value_drift');
  const diffJson = item.body_diff_json as Record<string, unknown>;
  expect(diffJson.volatility_sources).toBeUndefined();
});
