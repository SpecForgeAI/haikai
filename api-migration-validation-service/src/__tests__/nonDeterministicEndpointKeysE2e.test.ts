/**
 * FU-1 end-to-end seam test: bridge -> runDiff tolerance.
 *
 * Spec: 2026-06-16 Reconcile-Time Determinism & Volatile-Value Handling --
 * FU-1.
 *
 * Proves the WHOLE chain a production reconcile now runs:
 *   discovery `non_deterministic_endpoint` finding
 *     -> `resolveNonDeterministicEndpointKeys` resolves it to the concrete
 *        `${METHOD}|${path}` operation key
 *     -> `runDiff` with that populated `nonDeterministicEndpointKeys` set
 *        TOLERATES pure value drift on that operation (tagged
 *        `endpoint_signal`)
 *     -> but a SHAPE change on the SAME operation STILL breaks
 *        (`body_shape_drift`), so the seam can only ever ADD value tolerance.
 *
 * Mirrors the arch-mock shape of `diffRunner.volatility.test.ts`.
 */

import { runDiff } from '../services/diffRunner';
import { resolveNonDeterministicEndpointKeys } from '../services/nonDeterministicEndpointKeys';
import { RunManager } from '../services/runManager';
import type {
  ApiBehaviourDiffDto,
  BaselineDto,
  BaselineItemDto,
  DiscoveryCandidateDto,
  DiscoveryFindingDto,
  DiscoveryRunSummaryDto,
} from '../services/archModelClient';

const PROJECT_ID = '00000000-0000-0000-0000-0000000000aa';
const ARCH_ID = '00000000-0000-0000-0000-0000000000bb';
const DIFF_ID = '00000000-0000-0000-0000-0000000000cc';
const SOURCE_BASELINE_ID = '00000000-0000-0000-0000-0000000000dd';
const TARGET_BASELINE_ID = '00000000-0000-0000-0000-0000000000ee';
const RUN_ID = '00000000-0000-0000-0000-0000000000ff';

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
}): BaselineItemDto {
  const now = new Date().toISOString();
  return {
    id: opts.id,
    baseline_id: opts.baselineId,
    capture_id: `cap-${opts.id}`,
    operation_id: `op-${opts.id}`,
    scenario_id: `scen-${opts.id}`,
    method: 'GET',
    path: '/widgets/42',
    scenario_name: 'happy_path',
    request_json: { query: null, headers: null, body: null },
    response_status: 200,
    response_json: opts.responseJson,
    business_notes: null,
    volatile_paths_json: null,
    created_at: now,
    updated_at: now,
  };
}

const RUN: DiscoveryRunSummaryDto = {
  id: RUN_ID,
  project_id: PROJECT_ID,
  architecture_id: ARCH_ID,
  status: 'COMPLETED',
  discovery_kind: 'code',
};

function ndFinding(): DiscoveryFindingDto {
  const now = new Date().toISOString();
  return {
    id: 'f1',
    run_id: RUN_ID,
    api_behaviour_diff_id: null,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    finding_type: 'evidence_gap',
    category: 'migration_risk',
    severity: 'medium',
    confidence: null,
    status: 'new',
    title: 'Non-deterministic endpoint',
    summary: null,
    detail_json: { gapType: 'non_deterministic_endpoint' },
    source: 'pipeline_evidence_gap',
    created_by_stage: 'findings.nonDeterministicEndpointScanner',
    created_at: now,
    updated_at: now,
    reviewed_at: null,
    reviewer_notes: null,
    links: [
      {
        id: 'link-1',
        finding_id: 'f1',
        link_type: 'supports',
        target_type: 'discovery_candidate',
        target_id: 'cand-1',
        label: null,
        created_at: now,
      },
    ],
  };
}

// Templated route covering the concrete captured path `/widgets/42`.
const ENDPOINT_CANDIDATE: DiscoveryCandidateDto = {
  id: 'cand-1',
  run_id: RUN_ID,
  candidate_type: 'endpoints',
  name: 'GET /widgets/{id}',
  data: { httpMethod: 'GET', fullPath: '/widgets/{id}' },
};

interface State {
  diffItemsCreated: Array<Record<string, unknown>>;
}

function buildArchMock(sourceItem: BaselineItemDto, targetItem: BaselineItemDto): {
  mock: Record<string, unknown>;
  state: State;
} {
  const state: State = { diffItemsCreated: [] };
  const diff = buildDiff();
  const mock = {
    // diff-runner surface
    getDiff: jest.fn(async () => diff),
    getBaseline: jest.fn(async (_p: string, id: string) =>
      id === SOURCE_BASELINE_ID
        ? buildBaseline(SOURCE_BASELINE_ID, 'current')
        : buildBaseline(TARGET_BASELINE_ID, 'target'),
    ),
    listBaselineItems: jest.fn(async (_p: string, baselineId: string) =>
      baselineId === SOURCE_BASELINE_ID ? [sourceItem] : [targetItem],
    ),
    updateDiff: jest.fn(async (_p: string, _id: string, body: Record<string, unknown>) => ({
      ...diff,
      ...body,
    })),
    createDiffItem: jest.fn(
      async (_p: string, _id: string, body: Record<string, unknown>) => {
        state.diffItemsCreated.push(body);
        return { id: `item-${state.diffItemsCreated.length}`, ...body };
      },
    ),
    deleteFindingsByApiBehaviourDiffId: jest.fn(async () => undefined),
    createDiffFinding: jest.fn(async () => ({})),
    // bridge surface
    listDiscoveryRuns: jest.fn(async () => [RUN]),
    listFindingsForRun: jest.fn(async () => [ndFinding()]),
    listCandidatesForRun: jest.fn(async () => [ENDPOINT_CANDIDATE]),
  };
  return { mock, state };
}

function runManagerForDiff(): RunManager {
  const rm = new RunManager();
  rm.start({ sessionId: DIFF_ID, projectId: PROJECT_ID, architectureId: ARCH_ID });
  return rm;
}

const NO_EMIT = () => ({ shouldEmit: false }) as never;

test('endpoint_signal resolved via the bridge tolerates VALUE drift on the flagged op', async () => {
  const sourceItem = buildItem({
    id: 's1',
    baselineId: SOURCE_BASELINE_ID,
    responseJson: { id: 1, status: 'active' },
  });
  // Pure VALUE change (same shape).
  const targetItem = buildItem({
    id: 't1',
    baselineId: TARGET_BASELINE_ID,
    responseJson: { headers: {}, body: { id: 1, status: 'archived' } },
  });
  const { mock, state } = buildArchMock(sourceItem, targetItem);

  // Resolve the keys from the discovery signal via the real bridge.
  const keys = await resolveNonDeterministicEndpointKeys(
    PROJECT_ID,
    ARCH_ID,
    [sourceItem],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { archModelClient: mock as any },
  );
  expect([...keys]).toEqual(['GET|/widgets/42']);

  await runDiff(DIFF_ID, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    archModelClient: mock as any,
    runManager: runManagerForDiff(),
    now: () => 1700000000000,
    classifyDiffItem: NO_EMIT,
    nonDeterministicEndpointKeys: keys,
  });

  const item = state.diffItemsCreated[0];
  // Tolerated -> body_match, tagged endpoint_signal.
  expect(item.body_classification).toBe('body_match');
  const diffJson = item.body_diff_json as Record<string, unknown>;
  expect(diffJson.volatility_sources).toEqual(['endpoint_signal']);
});

test('endpoint_signal does NOT suppress a SHAPE change on the flagged op (still breaks)', async () => {
  const sourceItem = buildItem({
    id: 's1',
    baselineId: SOURCE_BASELINE_ID,
    responseJson: { id: 1, status: 'active' },
  });
  // SHAPE change: a key is removed (`status` gone) -> must STILL break.
  const targetItem = buildItem({
    id: 't1',
    baselineId: TARGET_BASELINE_ID,
    responseJson: { headers: {}, body: { id: 1 } },
  });
  const { mock, state } = buildArchMock(sourceItem, targetItem);

  const keys = await resolveNonDeterministicEndpointKeys(
    PROJECT_ID,
    ARCH_ID,
    [sourceItem],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { archModelClient: mock as any },
  );
  expect([...keys]).toEqual(['GET|/widgets/42']);

  await runDiff(DIFF_ID, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    archModelClient: mock as any,
    runManager: runManagerForDiff(),
    now: () => 1700000000000,
    classifyDiffItem: NO_EMIT,
    nonDeterministicEndpointKeys: keys,
  });

  const item = state.diffItemsCreated[0];
  // Shape drift is NEVER tolerated by endpoint_signal.
  expect(item.body_classification).toBe('body_shape_drift');
});
