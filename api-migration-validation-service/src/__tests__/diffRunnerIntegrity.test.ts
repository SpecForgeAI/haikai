/**
 * diffRunner -- SOURCE/oracle baseline integrity consumption.
 *
 * Spec: 2026-06-17 Baseline Integrity & Provenance -- Task Group 2 (sub-task
 * 2.1). The reconcile path consumes the AMS server-side integrity verdict for
 * the SOURCE (current-state oracle) baseline. The verdict is ADVISORY and
 * NEVER blocks the reconcile.
 *
 * Behaviours under test (the four locked cases from tasks.md 2.1):
 *   1. REAL mismatch (integrity_verified === false AND content_hash != null):
 *      a VISIBLE advisory integrity-warning finding is emitted AND the
 *      reconcile still PROCEEDS to completed.
 *   2. NULL-hash baseline (content_hash === null): verification is NEUTRAL --
 *      no integrity finding emitted (NOT a mismatch); reconcile proceeds.
 *   3. integrity_verified === true: no integrity finding; reconcile proceeds.
 *   4. Verify-call error (AMS unreachable / error): FAIL-SOFT -- reconcile
 *      does not crash and still completes; no integrity finding emitted.
 *
 * These tests assert the integrity finding is ADDITIVE: the diff still
 * completes with its normal count summary (no regression of reconcile
 * classification). The integrity finding is identified by its dedicated
 * finding_type `api_behaviour_oracle_integrity_mismatch`.
 */

import { runDiff } from '../services/diffRunner';
import { RunManager } from '../services/runManager';
import type {
  ApiBehaviourDiffDto,
  BaselineDto,
  BaselineItemDto,
  BaselineIntegrityDto,
} from '../services/archModelClient';

const PROJECT_ID = '00000000-0000-0000-0000-0000000000aa';
const ARCH_ID = '00000000-0000-0000-0000-0000000000bb';
const DIFF_ID = '00000000-0000-0000-0000-0000000000cc';
const SOURCE_BASELINE_ID = '00000000-0000-0000-0000-0000000000dd';
const TARGET_BASELINE_ID = '00000000-0000-0000-0000-0000000000ee';

const INTEGRITY_FINDING_TYPE = 'api_behaviour_oracle_integrity_mismatch';

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
  method: string;
  path: string;
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
    scenario_name: 'happy_path',
    request_json: { query: null, headers: null, body: null },
    response_status: opts.responseStatus ?? 200,
    response_json: opts.responseJson ?? { ok: true },
    business_notes: null,
    created_at: now,
    updated_at: now,
  };
}

interface IntegrityMockState {
  diffPatches: Array<Record<string, unknown>>;
  diffItemsCreated: Array<Record<string, unknown>>;
  findingsCreated: Array<Record<string, unknown>>;
  deleteFindingsCalled: number;
  getBaselineIntegrityCalls: string[];
}

/**
 * Builds an archModelClient mock with the full surface the tail block touches
 * (delete-findings cleanup + per-item + integrity finding emission), plus the
 * `getBaselineIntegrity` behaviour under test.
 *
 * `integrity` is either the verdict to return for the SOURCE baseline, or the
 * sentinel `'throw'` to model a verify-call error (fail-soft path).
 */
function buildArchMock(opts: {
  integrity: BaselineIntegrityDto | 'throw';
}): { mock: Record<string, unknown>; state: IntegrityMockState } {
  const diff = buildDiff();
  const sourceBaseline = buildBaseline(SOURCE_BASELINE_ID, 'current');
  const targetBaseline = buildBaseline(TARGET_BASELINE_ID, 'target');
  // One paired item that classifies as a clean match -- the reconcile MUST
  // complete normally regardless of the integrity verdict (advisory only).
  const sourceItems = [
    buildItem({
      id: 's1',
      baselineId: SOURCE_BASELINE_ID,
      method: 'GET',
      path: '/a',
      responseStatus: 200,
      responseJson: { ok: true },
    }),
  ];
  const targetItems = [
    buildItem({
      id: 't1',
      baselineId: TARGET_BASELINE_ID,
      method: 'GET',
      path: '/a',
      responseStatus: 200,
      responseJson: { headers: {}, body: { ok: true } },
    }),
  ];

  const state: IntegrityMockState = {
    diffPatches: [],
    diffItemsCreated: [],
    findingsCreated: [],
    deleteFindingsCalled: 0,
    getBaselineIntegrityCalls: [],
  };

  const mock = {
    getDiff: jest.fn(async () => diff),
    getBaseline: jest.fn(async (_p: string, id: string) => {
      if (id === sourceBaseline.id) return sourceBaseline;
      if (id === targetBaseline.id) return targetBaseline;
      throw new Error(`getBaseline: no fixture for id=${id}`);
    }),
    getBaselineIntegrity: jest.fn(async (_p: string, baselineId: string) => {
      state.getBaselineIntegrityCalls.push(baselineId);
      if (opts.integrity === 'throw') {
        throw new Error('AMS integrity endpoint unreachable');
      }
      return opts.integrity;
    }),
    listBaselineItems: jest.fn(async (_p: string, baselineId: string) => {
      if (baselineId === sourceBaseline.id) return sourceItems;
      if (baselineId === targetBaseline.id) return targetItems;
      return [];
    }),
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
    deleteFindingsByApiBehaviourDiffId: jest.fn(async () => {
      state.deleteFindingsCalled += 1;
    }),
    createDiffFinding: jest.fn(
      async (_p: string, _id: string, body: Record<string, unknown>) => {
        state.findingsCreated.push(body);
        return { id: `finding-${state.findingsCreated.length}`, ...body };
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

function integrityFindings(
  state: IntegrityMockState,
): Array<Record<string, unknown>> {
  return state.findingsCreated.filter(
    (f) => f.finding_type === INTEGRITY_FINDING_TYPE,
  );
}

// ---------------------------------------------------------------------------
// 1: REAL mismatch -> visible advisory finding + reconcile proceeds
// ---------------------------------------------------------------------------
test('real mismatch (verified=false, non-null hash) emits advisory warning and reconcile completes', async () => {
  const { mock, state } = buildArchMock({
    integrity: {
      content_hash: 'abc123',
      recomputed_hash: 'def456',
      integrity_verified: false,
    },
  });
  const runManager = buildRunManagerWithDiff();

  await runDiff(DIFF_ID, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    archModelClient: mock as any,
    runManager,
  });

  // The integrity verdict was requested for the SOURCE baseline only.
  expect(state.getBaselineIntegrityCalls).toEqual([SOURCE_BASELINE_ID]);

  // Exactly one advisory integrity warning was emitted, with the right shape.
  const findings = integrityFindings(state);
  expect(findings).toHaveLength(1);
  const f = findings[0];
  expect(f.severity).toBe('medium');
  expect(f.category).toBe('api_behaviour_drift');
  expect(f.finding_type).toBe(INTEGRITY_FINDING_TYPE);
  expect(f.title).toBe('Oracle baseline integrity mismatch');
  expect((f.detail_json as Record<string, unknown>).content_hash).toBe('abc123');
  expect((f.detail_json as Record<string, unknown>).recomputed_hash).toBe('def456');
  expect((f.detail_json as Record<string, unknown>).source_baseline_id).toBe(
    SOURCE_BASELINE_ID,
  );

  // Reconcile PROCEEDED: the diff still completed with its count summary.
  const finalPatch = state.diffPatches[state.diffPatches.length - 1];
  expect(finalPatch.status).toBe('completed');
  expect(finalPatch.matched_count).toBe(1);
  // The single diff_item was still classified + persisted (no regression).
  expect(state.diffItemsCreated).toHaveLength(1);
  // The advisory finding ran AFTER the mandatory recompute cleanup.
  expect(state.deleteFindingsCalled).toBe(1);
});

// ---------------------------------------------------------------------------
// 2: NULL-hash baseline -> neutral, no mismatch finding
// ---------------------------------------------------------------------------
test('null-hash baseline is NEUTRAL: no integrity finding emitted, reconcile completes', async () => {
  const { mock, state } = buildArchMock({
    integrity: {
      content_hash: null,
      recomputed_hash: 'def456',
      // AMS returns false when content_hash is null; the consumer must treat
      // this as "no hash recorded", NOT a mismatch.
      integrity_verified: false,
    },
  });
  const runManager = buildRunManagerWithDiff();

  await runDiff(DIFF_ID, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    archModelClient: mock as any,
    runManager,
  });

  // No integrity mismatch finding -- the null-hash case is neutral.
  expect(integrityFindings(state)).toHaveLength(0);

  // Reconcile proceeded normally.
  const finalPatch = state.diffPatches[state.diffPatches.length - 1];
  expect(finalPatch.status).toBe('completed');
  expect(finalPatch.matched_count).toBe(1);
});

// ---------------------------------------------------------------------------
// 3: verified=true -> no finding
// ---------------------------------------------------------------------------
test('integrity_verified=true emits no integrity finding and reconcile completes', async () => {
  const { mock, state } = buildArchMock({
    integrity: {
      content_hash: 'abc123',
      recomputed_hash: 'abc123',
      integrity_verified: true,
    },
  });
  const runManager = buildRunManagerWithDiff();

  await runDiff(DIFF_ID, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    archModelClient: mock as any,
    runManager,
  });

  expect(integrityFindings(state)).toHaveLength(0);
  const finalPatch = state.diffPatches[state.diffPatches.length - 1];
  expect(finalPatch.status).toBe('completed');
  expect(finalPatch.matched_count).toBe(1);
});

// ---------------------------------------------------------------------------
// 4: verify-call error -> fail-soft (reconcile proceeds, no crash, no finding)
// ---------------------------------------------------------------------------
test('verify-call error is FAIL-SOFT: reconcile completes, no crash, no integrity finding', async () => {
  const { mock, state } = buildArchMock({ integrity: 'throw' });
  const runManager = buildRunManagerWithDiff();

  // Must not throw -- a verify-call error never fails the reconcile.
  await expect(
    runDiff(DIFF_ID, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      archModelClient: mock as any,
      runManager,
    }),
  ).resolves.toBeUndefined();

  // The verify call was attempted for the source baseline.
  expect(state.getBaselineIntegrityCalls).toEqual([SOURCE_BASELINE_ID]);
  // No integrity finding (we never got a verdict).
  expect(integrityFindings(state)).toHaveLength(0);
  // Reconcile still completed.
  const finalPatch = state.diffPatches[state.diffPatches.length - 1];
  expect(finalPatch.status).toBe('completed');
  expect(finalPatch.matched_count).toBe(1);
});
