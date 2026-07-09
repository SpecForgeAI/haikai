/**
 * Parity verifier + code execution gate (Spec 2026-07-06-i — Parity Verify
 * Loop & Execution Gates, Code-Tier Oracle Program).
 *
 * Acceptance pins:
 *   LOOP/SCOPE  — the verifier threads the story's endpoint scope into the
 *                 replay start (mock validation deps assert it) and returns a
 *                 clean verdict on a clean scoped diff.
 *   FAIL-CLOSED — lifecycle failure / zero-compared → verdict unclean.
 *   WAIVER      — a waived break fingerprint → clean-with-waivers, waiver id
 *                 recorded on the verdict; unwaived stays broken.
 *   STATE       — state_drift AND state_unverified break the verdict
 *                 (fail-closed state parity, Spec N amendment).
 *   GATE        — endpoint without baseline coverage → code_baseline_missing
 *                 (flagged missing_baseline story exempt); no pinned baseline
 *                 → code_baseline_unpinned; unreadable coverage →
 *                 code_gate_read_failed; floor fail → code_coverage_floor_unmet.
 *   SCOPE AUDIT — story completion accepts a covering scoped clean diff;
 *                 closure REJECTS scoped diffs and requires an unscoped clean
 *                 one.
 *   DRIFT       — no/stale drift check → baseline_drift_unchecked; a breaking
 *                 drift check → baseline_behaviour_drift; fresh clean → ok.
 */

import {
  evaluateParityVerdict,
  runScopedParityVerify,
  runBaselineDriftCheck,
  breakFingerprint,
  type BreakFingerprintWaiver,
} from '../services/migrationParityVerifier';
import {
  codeStoriesInScope,
  evaluateCodeReadiness,
  evaluateCodeStoryCompletion,
  evaluateClosureReadiness,
  evaluateBaselineDrift,
  type CodeGateReads,
  type GateDiffRow,
} from '../services/migrationCodeExecutionGate';
import {
  isDiffItemABreak,
  type ReconciliationDiffItem,
  type ReconciliationValidationDeps,
} from '../services/migrationReconciliationValidationClient';
import type { BookOfWorkItem } from '../services/migrationDriverAmsReads';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function cleanItem(id: string, method = 'GET', path = '/owners/42'): ReconciliationDiffItem {
  return {
    id,
    method,
    path,
    scenario_name: 'happy_path',
    status_classification: 'status_match',
    body_classification: 'body_match',
    header_classification: null,
    source_response_status: 200,
    target_response_status: 200,
    body_diff_json: null,
  };
}

function brokenItem(id: string, method = 'GET', path = '/owners/42'): ReconciliationDiffItem {
  return {
    ...cleanItem(id, method, path),
    status_classification: 'status_drift',
    source_response_status: 200,
    target_response_status: 500,
  };
}

function stateItem(id: string, classification: string): ReconciliationDiffItem {
  return {
    ...cleanItem(id, 'POST', '/owners/42/things'),
    body_diff_json: { state_classification: classification },
  };
}

// ---------------------------------------------------------------------------
// STATE — the break predicate folds in state + byte dimensions
// ---------------------------------------------------------------------------

test('STATE: state_drift and state_unverified break; byte_drift breaks; raw_unavailable does not', () => {
  expect(isDiffItemABreak(cleanItem('c1'))).toBe(false);
  expect(isDiffItemABreak(stateItem('s1', 'state_drift'))).toBe(true);
  expect(isDiffItemABreak(stateItem('s2', 'state_unverified'))).toBe(true);
  expect(isDiffItemABreak(stateItem('s3', 'state_match'))).toBe(false);
  expect(
    isDiffItemABreak({ ...cleanItem('b1'), body_diff_json: { byte_classification: 'byte_drift' } }),
  ).toBe(true);
  expect(
    isDiffItemABreak({
      ...cleanItem('b2'),
      body_diff_json: { byte_classification: 'raw_unavailable' },
    }),
  ).toBe(false);
});

// ---------------------------------------------------------------------------
// FAIL-CLOSED + WAIVER — the pure verdict
// ---------------------------------------------------------------------------

test('FAIL-CLOSED: lifecycle failure and zero-compared are never clean', () => {
  const failed = evaluateParityVerdict({
    runOk: false,
    runError: 'reconcile session poll timed out',
    diffItems: [],
    waivers: [],
  });
  expect(failed.clean).toBe(false);
  expect(failed.reason).toMatch(/timed out/);

  const empty = evaluateParityVerdict({ runOk: true, diffItems: [], waivers: [] });
  expect(empty.clean).toBe(false);
  expect(empty.reason).toMatch(/zero items/);
});

test('WAIVER: a waived fingerprint yields clean-with-waivers with the waiver id recorded', () => {
  const broken = brokenItem('x1');
  const fingerprint = breakFingerprint(broken);
  expect(fingerprint).toBe('GET /owners/42::happy_path::status_drift');

  const unwaived = evaluateParityVerdict({
    runOk: true,
    diffItems: [cleanItem('c1'), broken],
    waivers: [],
  });
  expect(unwaived.clean).toBe(false);
  expect(unwaived.breaks).toHaveLength(1);
  expect(unwaived.breaks[0].fingerprint).toBe(fingerprint);

  const waivers: BreakFingerprintWaiver[] = [
    { id: 'waiver-1', target: fingerprint, reason: 'known legacy 500 on this scenario' },
  ];
  const waived = evaluateParityVerdict({
    runOk: true,
    diffItems: [cleanItem('c1'), broken],
    waivers,
  });
  expect(waived.clean).toBe(true);
  expect(waived.cleanWithWaivers).toBe(true);
  expect(waived.waivedBreaks).toHaveLength(1);
  expect(waived.waivedBreaks[0].waiverId).toBe('waiver-1');
  expect(waived.coverage.waived).toBe(1);
});

test('STATE (verdict): state_unverified blocks the verdict clean', () => {
  const verdict = evaluateParityVerdict({
    runOk: true,
    diffItems: [cleanItem('c1'), stateItem('s1', 'state_unverified')],
    waivers: [],
  });
  expect(verdict.clean).toBe(false);
  expect(verdict.breaks[0].kind).toBe('state_unverified');
  expect(verdict.coverage.stateUnverified).toBe(1);
});

// ---------------------------------------------------------------------------
// LOOP/SCOPE — the verifier threads the scope; drift check tags its purpose
// ---------------------------------------------------------------------------

function buildValidationDepsMock(diffItems: ReconciliationDiffItem[]): {
  deps: ReconciliationValidationDeps;
  startCalls: Array<Record<string, unknown>>;
} {
  const startCalls: Array<Record<string, unknown>> = [];
  const deps: ReconciliationValidationDeps = {
    createTargetSession: jest.fn(async () => 'session-1'),
    loadSecrets: jest.fn(async () => undefined),
    startSession: jest.fn(async (args) => {
      startCalls.push(args as unknown as Record<string, unknown>);
    }),
    getSessionStatus: jest.fn(async () => ({ status: 'completed' })),
    listTargetBaselines: jest.fn(async () => [
      { id: 'tb-1', session_id: 'session-1', status: 'active', updated_at: '2026-07-09T00:00:00Z' },
    ]),
    getDiffByTargetBaseline: jest.fn(async () => ({ diffId: 'diff-1', status: 'completed' })),
    getDiffStatus: jest.fn(async () => ({ diffId: 'diff-1', status: 'completed' })),
    listDiffItems: jest.fn(async () => diffItems),
    sleep: jest.fn(async () => undefined),
    now: () => 1700000000000,
  };
  return { deps, startCalls };
}

test('LOOP/SCOPE: runScopedParityVerify threads the endpoint scope and returns clean on a clean diff', async () => {
  const { deps, startCalls } = buildValidationDepsMock([cleanItem('c1'), cleanItem('c2', 'POST', '/owners/42/things')]);
  const verdict = await runScopedParityVerify(
    {
      projectId: 'proj-1',
      architectureId: 'arch-1',
      sourceBaselineId: 'src-b',
      targetBaseUrl: 'https://target.example.test',
      api: { type: 'bearer', bearerToken: 'in-memory-only' } as never,
      endpointScope: ['GET /owners/{id}', 'POST /owners/{id}/things'],
    },
    { validationDeps: deps, fetchWaivers: async () => [] },
  );
  expect(startCalls).toHaveLength(1);
  expect(startCalls[0].endpointScope).toEqual(['GET /owners/{id}', 'POST /owners/{id}/things']);
  expect(startCalls[0].purpose).toBe('parity');
  expect(verdict.clean).toBe(true);
  expect(verdict.diffId).toBe('diff-1');
  expect(verdict.endpointScope).toEqual(['GET /owners/{id}', 'POST /owners/{id}/things']);
});

test('DRIFT: runBaselineDriftCheck tags purpose drift_check and reports breaks unclean', async () => {
  const { deps, startCalls } = buildValidationDepsMock([brokenItem('x1')]);
  const verdict = await runBaselineDriftCheck(
    {
      projectId: 'proj-1',
      architectureId: 'arch-1',
      sourceBaselineId: 'src-b',
      currentBaseUrl: 'https://current.example.test',
      api: { type: 'bearer', bearerToken: 'in-memory-only' } as never,
    },
    { validationDeps: deps },
  );
  expect(startCalls[0].purpose).toBe('drift_check');
  expect(startCalls[0].endpointScope).toBeNull();
  expect(verdict.clean).toBe(false);
  expect(verdict.breaks).toHaveLength(1);
});

// ---------------------------------------------------------------------------
// GATE — pre-dispatch readiness
// ---------------------------------------------------------------------------

function storyItem(
  workItemId: string,
  opts: { tags?: string[]; apiEndpointIds?: string[]; flagReason?: string | null } = {},
): BookOfWorkItem {
  return {
    workItemId,
    tags: opts.tags ?? ['provenance:plan-deterministic', 'stream:target_service_api_implementation'],
    apiEndpointIds: opts.apiEndpointIds ?? [],
    flagReason: opts.flagReason ?? null,
  } as unknown as BookOfWorkItem;
}

function gateReads(overrides: Partial<CodeGateReads> = {}): CodeGateReads {
  return {
    fetchEndpointBaselineCoverage: jest.fn(async () => new Map<string, string>()),
    fetchCoverageSummaryForBaseline: jest.fn(async () => null),
    listDiffsForBaseline: jest.fn(async () => []),
    listDiffItems: jest.fn(async () => []),
    ...overrides,
  };
}

test('GATE: scope detection sees API-parity code stories; internal + manual-gate excluded', () => {
  const none = codeStoriesInScope({
    items: [
      storyItem('w1', { tags: ['stream:internal_processing_implementation'] }),
      storyItem('w2', { tags: ['provenance:plan-deterministic', 'execution:manual-gate'] }),
    ],
    deferredWorkItemIds: new Set(),
  });
  expect(none).toBe(false);

  const some = codeStoriesInScope({
    items: [storyItem('w3')],
    deferredWorkItemIds: new Set(),
  });
  expect(some).toBe(true);

  const deferred = codeStoriesInScope({
    items: [storyItem('w3')],
    deferredWorkItemIds: new Set(['w3']),
  });
  expect(deferred).toBe(false);
});

test('GATE: code_baseline_missing blocks uncovered endpoints; flagged missing_baseline exempt', async () => {
  const reads = gateReads({
    fetchEndpointBaselineCoverage: jest.fn(async () => new Map([['ep-covered', 'baseline-1']])),
  });
  const result = await evaluateCodeReadiness({
    projectId: 'proj-1',
    currentArchitectureId: 'arch-1',
    items: [
      storyItem('w-ok', { apiEndpointIds: ['ep-covered'] }),
      storyItem('w-missing', { apiEndpointIds: ['ep-uncovered'] }),
      storyItem('w-flagged', { apiEndpointIds: ['ep-uncovered-2'], flagReason: 'missing_baseline' }),
    ],
    deferredWorkItemIds: new Set(),
    pinnedBaselineId: 'baseline-1',
    reads,
  });
  expect(result.ok).toBe(false);
  const missing = result.reasons.filter((r) => r.code === 'code_baseline_missing');
  expect(missing).toHaveLength(1);
  expect(missing[0].workItemId).toBe('w-missing');
});

test('GATE: unpinned baseline + unreadable coverage fail closed', async () => {
  const unpinned = await evaluateCodeReadiness({
    projectId: 'proj-1',
    currentArchitectureId: 'arch-1',
    items: [storyItem('w1', { apiEndpointIds: [] })],
    deferredWorkItemIds: new Set(),
    pinnedBaselineId: null,
    reads: gateReads(),
  });
  expect(unpinned.reasons.map((r) => r.code)).toContain('code_baseline_unpinned');

  const unreadable = await evaluateCodeReadiness({
    projectId: 'proj-1',
    currentArchitectureId: 'arch-1',
    items: [storyItem('w1', { apiEndpointIds: ['ep-1'] })],
    deferredWorkItemIds: new Set(),
    pinnedBaselineId: 'baseline-1',
    reads: gateReads({
      fetchEndpointBaselineCoverage: jest.fn(async () => {
        throw new Error('AMS unreachable');
      }),
    }),
  });
  expect(unreadable.ok).toBe(false);
  expect(unreadable.reasons.map((r) => r.code)).toContain('code_gate_read_failed');
});

test('GATE: code_coverage_floor_unmet from the persisted summary; null summary passes', async () => {
  const failingSummary = {
    per_endpoint: [
      {
        operation_id: 'op-1',
        method: 'GET',
        path: '/owners/{id}',
        dimensions: [
          { name: 'happy_path', dimension_kind: 'happy', achieved: false, reason: null },
        ],
      },
    ],
  };
  const result = await evaluateCodeReadiness({
    projectId: 'proj-1',
    currentArchitectureId: 'arch-1',
    items: [storyItem('w1', { apiEndpointIds: [] })],
    deferredWorkItemIds: new Set(),
    pinnedBaselineId: 'baseline-1',
    reads: gateReads({
      fetchCoverageSummaryForBaseline: jest.fn(async () => failingSummary),
    }),
  });
  expect(result.reasons.map((r) => r.code)).toContain('code_coverage_floor_unmet');

  const legacy = await evaluateCodeReadiness({
    projectId: 'proj-1',
    currentArchitectureId: 'arch-1',
    items: [storyItem('w1', { apiEndpointIds: [] })],
    deferredWorkItemIds: new Set(),
    pinnedBaselineId: 'baseline-1',
    reads: gateReads({ fetchCoverageSummaryForBaseline: jest.fn(async () => null) }),
  });
  expect(legacy.reasons.map((r) => r.code)).not.toContain('code_coverage_floor_unmet');
});

// ---------------------------------------------------------------------------
// SCOPE AUDIT — story completion + closure
// ---------------------------------------------------------------------------

const scopedCleanDiff: GateDiffRow = {
  id: 'diff-scoped',
  status: 'completed',
  computed_at: '2026-07-09T10:00:00Z',
  endpoint_scope_json: { keys: ['GET /owners/{id}'], purpose: 'parity' },
};
const unscopedCleanDiff: GateDiffRow = {
  id: 'diff-full',
  status: 'completed',
  computed_at: '2026-07-09T11:00:00Z',
  endpoint_scope_json: null,
};

test('SCOPE AUDIT: story completion — covering scoped clean diff completes; breaks block; none unverified', async () => {
  const cleanReads = gateReads({
    listDiffItems: jest.fn(async () => [cleanItem('c1', 'GET', '/owners/42')]),
  });
  const ok = await evaluateCodeStoryCompletion({
    projectId: 'proj-1',
    storyEndpointKeys: ['GET /owners/{id}'],
    diffs: [scopedCleanDiff],
    waivers: [],
    reads: cleanReads,
  });
  expect(ok.ok).toBe(true);

  const brokenReads = gateReads({
    listDiffItems: jest.fn(async () => [brokenItem('x1', 'GET', '/owners/42')]),
  });
  const broken = await evaluateCodeStoryCompletion({
    projectId: 'proj-1',
    storyEndpointKeys: ['GET /owners/{id}'],
    diffs: [scopedCleanDiff],
    waivers: [],
    reads: brokenReads,
  });
  expect(broken.ok).toBe(false);
  expect(broken.reasons[0].code).toBe('code_parity_broken');

  const none = await evaluateCodeStoryCompletion({
    projectId: 'proj-1',
    storyEndpointKeys: ['DELETE /pets/{id}'],
    diffs: [scopedCleanDiff],
    waivers: [],
    reads: cleanReads,
  });
  expect(none.ok).toBe(false);
  expect(none.reasons[0].code).toBe('code_parity_unverified');
});

test('SCOPE AUDIT: closure rejects a scoped-only history and accepts an unscoped clean diff', async () => {
  const reads = gateReads({
    listDiffItems: jest.fn(async () => [cleanItem('c1')]),
  });
  const scopedOnly = await evaluateClosureReadiness({
    projectId: 'proj-1',
    diffs: [scopedCleanDiff],
    waivers: [],
    reads,
  });
  expect(scopedOnly.ok).toBe(false);
  expect(scopedOnly.reasons[0].code).toBe('code_parity_unverified');
  expect(scopedOnly.reasons[0].message).toMatch(/FULL-surface/);

  const full = await evaluateClosureReadiness({
    projectId: 'proj-1',
    diffs: [scopedCleanDiff, unscopedCleanDiff],
    waivers: [],
    reads,
  });
  expect(full.ok).toBe(true);
});

// ---------------------------------------------------------------------------
// DRIFT — gate codes
// ---------------------------------------------------------------------------

test('DRIFT: unchecked / stale / breaking / clean drift-check verdicts', async () => {
  const NOW = Date.parse('2026-07-09T12:00:00Z');
  const driftCleanDiff: GateDiffRow = {
    id: 'drift-1',
    status: 'completed',
    computed_at: '2026-07-08T12:00:00Z', // 1 day old
    endpoint_scope_json: { keys: null, purpose: 'drift_check' },
  };
  const driftStaleDiff: GateDiffRow = {
    ...driftCleanDiff,
    id: 'drift-old',
    computed_at: '2026-06-01T12:00:00Z', // > 14 days
  };

  const never = await evaluateBaselineDrift({
    projectId: 'proj-1',
    diffs: [unscopedCleanDiff], // parity diffs don't count as drift checks
    now: () => NOW,
    reads: gateReads(),
  });
  expect(never.reasons[0].code).toBe('baseline_drift_unchecked');

  const stale = await evaluateBaselineDrift({
    projectId: 'proj-1',
    diffs: [driftStaleDiff],
    now: () => NOW,
    reads: gateReads(),
  });
  expect(stale.reasons[0].code).toBe('baseline_drift_unchecked');

  const breaking = await evaluateBaselineDrift({
    projectId: 'proj-1',
    diffs: [driftCleanDiff],
    now: () => NOW,
    reads: gateReads({ listDiffItems: jest.fn(async () => [brokenItem('x1')]) }),
  });
  expect(breaking.reasons[0].code).toBe('baseline_behaviour_drift');

  const clean = await evaluateBaselineDrift({
    projectId: 'proj-1',
    diffs: [driftCleanDiff],
    now: () => NOW,
    reads: gateReads({ listDiffItems: jest.fn(async () => [cleanItem('c1')]) }),
  });
  expect(clean.ok).toBe(true);
});
