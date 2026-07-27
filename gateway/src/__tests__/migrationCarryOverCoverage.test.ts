/**
 * Tests for the carry_over completeness-gate coverage computation
 * (Spec 2026-06-14 D4 — Carry-over Completeness Gate, Task Group 2).
 *
 * These exercise the PURE, deterministic status resolver across the canonical
 * cases the gate depends on (no AMS, no LLM — the module is data-in / data-out):
 *   - a capability cited-by-story (a work_item carries its source_capability_id);
 *   - an un-actioned behaviour-bearing capability (gates);
 *   - a dismissed capability/finding (disposition in {rejected,dismissed} + a
 *     non-empty reason) — and that an empty reason does NOT satisfy;
 *   - member-finding ROLL-UP: a behaviour-bearing finding that is a member of a
 *     covered/dismissed capability is accounted-for and is NOT double-counted in
 *     the must-account set, while an un-grouped behaviour-bearing finding gates
 *     on its own;
 *   - `behaviourBearing == false` NEVER enters the must-account set.
 *
 * No live LLM is reachable (the global jest guard applies; this module never
 * touches the LLM boundary anyway).
 */

import {
  computeCarryOverCoverage,
  COVERAGE_STATUS,
  capabilityBehaviourBearing,
  findingBehaviourBearing,
  CoverageCapabilityInput,
  CoverageFindingInput,
} from '../services/migrationCarryOverCoverage';
jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  gatherCarryOverCoverageInputs,
  CarryOverCoverageReadsDeps,
} from '../services/migrationCarryOverCoverageReads';
import type { BookOfWork } from '../services/migrationDriverAmsReads';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cap(
  over: Partial<CoverageCapabilityInput> & { id: string }
): CoverageCapabilityInput {
  return {
    behaviourBearing: true,
    reviewStatus: 'approved',
    reviewerNotes: null,
    memberFindingIds: [],
    ...over,
  };
}

function finding(
  over: Partial<CoverageFindingInput> & { id: string }
): CoverageFindingInput {
  return {
    behaviourBearing: true,
    reviewStatus: 'approved',
    reviewerNotes: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// behaviourBearing predicate helpers
// ---------------------------------------------------------------------------

describe('behaviourBearing predicate helpers', () => {
  it('reads behaviourBearing=true off detail_json on capabilities and findings', () => {
    expect(capabilityBehaviourBearing({ behaviourBearing: true })).toBe(true);
    expect(findingBehaviourBearing({ behaviourBearing: true })).toBe(true);
  });

  it('treats a missing / false behaviourBearing as NOT behaviour-bearing (never gates)', () => {
    expect(capabilityBehaviourBearing({ behaviourBearing: false })).toBe(false);
    expect(capabilityBehaviourBearing({})).toBe(false);
    expect(capabilityBehaviourBearing(null)).toBe(false);
    expect(findingBehaviourBearing({ behaviourBearing: false })).toBe(false);
    expect(findingBehaviourBearing(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Pure coverage computation
// ---------------------------------------------------------------------------

describe('computeCarryOverCoverage', () => {
  it('marks a capability cited-by-story when a work_item carries its source_capability_id', () => {
    const result = computeCarryOverCoverage({
      capabilities: [cap({ id: 'capA' })],
      findings: [],
      citedCapabilityIds: new Set(['capA']),
      citedFindingIds: new Set(),
    });
    const item = result.items.find((i) => i.id === 'capA');
    expect(item?.status).toBe(COVERAGE_STATUS.CITED_BY_STORY);
    // a cited capability is accounted-for -> nothing un-accounted.
    expect(result.unaccounted).toHaveLength(0);
    expect(result.ok).toBe(true);
  });

  it('marks an approved-but-uncited behaviour-bearing capability un-actioned (and gates)', () => {
    const result = computeCarryOverCoverage({
      capabilities: [cap({ id: 'capA', reviewStatus: 'approved' })],
      findings: [],
      citedCapabilityIds: new Set(),
      citedFindingIds: new Set(),
    });
    const item = result.items.find((i) => i.id === 'capA');
    expect(item?.status).toBe(COVERAGE_STATUS.UN_ACTIONED);
    expect(result.unaccounted.map((i) => i.id)).toEqual(['capA']);
    expect(result.ok).toBe(false);
  });

  it('marks a capability dismissed only with a non-empty reason (rejected OR dismissed)', () => {
    const dismissed = computeCarryOverCoverage({
      capabilities: [cap({ id: 'capA', reviewStatus: 'dismissed', reviewerNotes: 'dead code retired' })],
      findings: [],
      citedCapabilityIds: new Set(),
      citedFindingIds: new Set(),
    });
    expect(dismissed.items.find((i) => i.id === 'capA')?.status).toBe(COVERAGE_STATUS.DISMISSED);
    expect(dismissed.ok).toBe(true);

    const rejected = computeCarryOverCoverage({
      capabilities: [cap({ id: 'capR', reviewStatus: 'rejected', reviewerNotes: 'not real' })],
      findings: [],
      citedCapabilityIds: new Set(),
      citedFindingIds: new Set(),
    });
    expect(rejected.items.find((i) => i.id === 'capR')?.status).toBe(COVERAGE_STATUS.DISMISSED);
    expect(rejected.ok).toBe(true);
  });

  it('does NOT treat an empty-reason dismissed/rejected disposition as accounted-for (still un-actioned)', () => {
    const result = computeCarryOverCoverage({
      capabilities: [
        cap({ id: 'capEmpty', reviewStatus: 'dismissed', reviewerNotes: '   ' }),
        cap({ id: 'capNull', reviewStatus: 'rejected', reviewerNotes: null }),
      ],
      findings: [],
      citedCapabilityIds: new Set(),
      citedFindingIds: new Set(),
    });
    expect(result.items.find((i) => i.id === 'capEmpty')?.status).toBe(COVERAGE_STATUS.UN_ACTIONED);
    expect(result.items.find((i) => i.id === 'capNull')?.status).toBe(COVERAGE_STATUS.UN_ACTIONED);
    expect(result.ok).toBe(false);
    expect(result.unaccounted.map((i) => i.id).sort()).toEqual(['capEmpty', 'capNull']);
  });

  it('does NOT let approved / pending_review / deferred dispositions satisfy the gate', () => {
    const result = computeCarryOverCoverage({
      capabilities: [
        cap({ id: 'capApproved', reviewStatus: 'approved' }),
        cap({ id: 'capPending', reviewStatus: 'pending_review' }),
        cap({ id: 'capDeferred', reviewStatus: 'deferred', reviewerNotes: 'later' }),
      ],
      findings: [],
      citedCapabilityIds: new Set(),
      citedFindingIds: new Set(),
    });
    expect(result.unaccounted.map((i) => i.id).sort()).toEqual([
      'capApproved',
      'capDeferred',
      'capPending',
    ]);
    expect(result.ok).toBe(false);
  });

  it('rolls a member finding up under a COVERED capability: it is accounted-for and NOT double-counted', () => {
    // capA is cited; finding f1 is its member; f1 is behaviour-bearing but
    // un-actioned on its own -> still accounted-for via the roll-up.
    const result = computeCarryOverCoverage({
      capabilities: [cap({ id: 'capA', memberFindingIds: ['f1'] })],
      findings: [finding({ id: 'f1', reviewStatus: 'approved' })],
      citedCapabilityIds: new Set(['capA']),
      citedFindingIds: new Set(),
    });
    // The must-account set contains the capability ONLY (f1 is rolled up).
    expect(result.mustAccount.map((i) => `${i.kind}:${i.id}`)).toEqual(['capability:capA']);
    // f1 resolves cited-by-story (rolled up) and does not appear as un-accounted.
    expect(result.items.find((i) => i.id === 'f1')?.status).toBe(COVERAGE_STATUS.CITED_BY_STORY);
    expect(result.unaccounted).toHaveLength(0);
    expect(result.ok).toBe(true);
  });

  it('rolls a member finding up under a DISMISSED capability too (covered-or-dismissed absorbs members)', () => {
    const result = computeCarryOverCoverage({
      capabilities: [
        cap({ id: 'capA', reviewStatus: 'dismissed', reviewerNotes: 'out of scope', memberFindingIds: ['f1'] }),
      ],
      findings: [finding({ id: 'f1' })],
      citedCapabilityIds: new Set(),
      citedFindingIds: new Set(),
    });
    expect(result.mustAccount.map((i) => i.id)).toEqual(['capA']);
    expect(result.items.find((i) => i.id === 'f1')?.status).toBe(COVERAGE_STATUS.DISMISSED);
    expect(result.ok).toBe(true);
  });

  it('gates an UN-GROUPED behaviour-bearing finding on its own (cite via discoveryFindingReferences clears it)', () => {
    const blocking = computeCarryOverCoverage({
      capabilities: [],
      findings: [finding({ id: 'fLoose' })],
      citedCapabilityIds: new Set(),
      citedFindingIds: new Set(),
    });
    expect(blocking.mustAccount.map((i) => `${i.kind}:${i.id}`)).toEqual(['finding:fLoose']);
    expect(blocking.unaccounted.map((i) => i.id)).toEqual(['fLoose']);
    expect(blocking.ok).toBe(false);

    const cited = computeCarryOverCoverage({
      capabilities: [],
      findings: [finding({ id: 'fLoose' })],
      citedCapabilityIds: new Set(),
      citedFindingIds: new Set(['fLoose']),
    });
    expect(cited.items.find((i) => i.id === 'fLoose')?.status).toBe(COVERAGE_STATUS.CITED_BY_STORY);
    expect(cited.ok).toBe(true);
  });

  it('excludes behaviourBearing=false capabilities and findings from the must-account set entirely', () => {
    const result = computeCarryOverCoverage({
      capabilities: [cap({ id: 'capNonBB', behaviourBearing: false })],
      findings: [finding({ id: 'fNonBB', behaviourBearing: false })],
      citedCapabilityIds: new Set(),
      citedFindingIds: new Set(),
    });
    expect(result.mustAccount).toHaveLength(0);
    expect(result.unaccounted).toHaveLength(0);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Item-detail side-output (2026-07-26 accounting panel + triage)
// ---------------------------------------------------------------------------

describe('gatherCarryOverCoverageInputs itemDetailById', () => {
  const emptyBook: BookOfWork = {
    id: 'book-1',
    project_id: 'proj-1',
    current_architecture_id: 'arch-1',
    status: 'saved',
    book_of_work_json: { items: [] },
  };

  it('captures finding content + the owning RUN ID (dismissal is run-scoped) and capability content', async () => {
    const deps: CarryOverCoverageReadsDeps = {
      fetchCapabilitiesForArchitecture: jest.fn().mockResolvedValue([
        {
          id: 'capA',
          run_id: 'run-1',
          name: 'Nightly batch spine',
          kind: 'batch',
          summary: 'The JIL-driven overnight close chain.',
          review_status: 'approved',
          detail_json: { behaviourBearing: true },
          members: [
            { member_type: 'discovery_finding', member_id: 'fMember' },
            { member_type: 'code_element', member_id: 'ceX' },
          ],
        },
      ]),
      fetchFindingsForRun: jest.fn().mockResolvedValue([
        {
          id: 'fLoose',
          title: 'Ledger close halts on replication lag',
          summary: 'The close job aborts when replication lag exceeds 5 minutes.',
          severity: 'high',
          category: 'operational_artifact',
          review_status: 'approved',
          reviewer_notes: null,
          detail_json: { behaviourBearing: true },
        },
        // Non-behaviour-bearing rows stay OUT of the detail map too.
        {
          id: 'fNonBB',
          title: 'Cosmetic note',
          review_status: 'approved',
          detail_json: { behaviourBearing: false },
        },
      ]),
    };

    const inputs = await gatherCarryOverCoverageInputs({
      projectId: 'proj-1',
      architectureId: 'arch-1',
      book: emptyBook,
      workItems: [],
      deps,
    });

    const findingDetail = inputs.itemDetailById.get('fLoose');
    expect(findingDetail).toEqual({
      kind: 'finding',
      title: 'Ledger close halts on replication lag',
      summary: 'The close job aborts when replication lag exceeds 5 minutes.',
      severity: 'high',
      category: 'operational_artifact',
      runId: 'run-1',
      reviewStatus: 'approved',
      memberFindingCount: null,
    });
    expect(inputs.itemDetailById.has('fNonBB')).toBe(false);

    const capDetail = inputs.itemDetailById.get('capA');
    expect(capDetail).toEqual({
      kind: 'capability',
      title: 'Nightly batch spine',
      summary: 'The JIL-driven overnight close chain.',
      severity: null,
      category: 'batch',
      runId: 'run-1',
      reviewStatus: 'approved',
      // Only discovery_finding members count (code elements etc. do not).
      memberFindingCount: 1,
    });

    // Scope diagnostics: the canonical capability-derived run scope.
    expect(inputs.scope).toEqual({
      capabilityCount: 1,
      runCount: 1,
      findingCount: 1,
      runScopeSource: 'capabilities',
    });
  });
});

// ---------------------------------------------------------------------------
// Run-scope FALLBACK (2026-07-27) — the no-capabilities fail-open fix
// ---------------------------------------------------------------------------

describe('gatherCarryOverCoverageInputs run-scope fallback', () => {
  const emptyBook: BookOfWork = {
    id: 'book-1',
    project_id: 'proj-1',
    current_architecture_id: 'arch-1',
    status: 'saved',
    book_of_work_json: { items: [] },
  };

  const bbFinding = {
    id: 'fLoose',
    title: 'Ledger close halts on replication lag',
    review_status: 'approved',
    reviewer_notes: null,
    detail_json: { behaviourBearing: true },
  };

  it('NO capabilities -> the architecture run list becomes the scope, so behaviour-bearing findings STILL gate (live-confirmed fail-open)', async () => {
    const fetchRuns = jest
      .fn()
      .mockResolvedValue([{ id: 'run-9', status: 'completed' }]);
    const deps: CarryOverCoverageReadsDeps = {
      // The user's live estate: capabilities [] — the canonical D5 run
      // derivation yields NOTHING, and pre-fix zero findings were evaluated.
      fetchCapabilitiesForArchitecture: jest.fn().mockResolvedValue([]),
      fetchFindingsForRun: jest.fn().mockResolvedValue([bbFinding]),
      fetchDiscoveryRunsForArchitecture: fetchRuns,
    };

    const inputs = await gatherCarryOverCoverageInputs({
      projectId: 'proj-1',
      architectureId: 'arch-1',
      book: emptyBook,
      workItems: [],
      deps,
    });

    expect(fetchRuns).toHaveBeenCalledWith('proj-1', 'arch-1');
    expect(deps.fetchFindingsForRun).toHaveBeenCalledWith('proj-1', 'arch-1', 'run-9');
    expect(inputs.findings).toHaveLength(1);
    expect(inputs.scope).toEqual({
      capabilityCount: 0,
      runCount: 1,
      findingCount: 1,
      runScopeSource: 'architecture_runs',
    });

    // …and the pure gate now sees (and gates) the un-grouped finding.
    const coverage = computeCarryOverCoverage(inputs);
    expect(coverage.totalMustAccount).toBe(1);
    expect(coverage.ok).toBe(false);
  });

  it('capabilities present -> the fallback is NOT consulted (canonical scope wins)', async () => {
    const fetchRuns = jest.fn();
    const deps: CarryOverCoverageReadsDeps = {
      fetchCapabilitiesForArchitecture: jest.fn().mockResolvedValue([
        { id: 'capA', run_id: 'run-1', detail_json: { behaviourBearing: true }, members: [] },
      ]),
      fetchFindingsForRun: jest.fn().mockResolvedValue([]),
      fetchDiscoveryRunsForArchitecture: fetchRuns,
    };
    const inputs = await gatherCarryOverCoverageInputs({
      projectId: 'proj-1',
      architectureId: 'arch-1',
      book: emptyBook,
      workItems: [],
      deps,
    });
    expect(fetchRuns).not.toHaveBeenCalled();
    expect(inputs.scope.runScopeSource).toBe('capabilities');
  });

  it('NO capabilities AND no runs -> honest empty with runScopeSource none', async () => {
    const deps: CarryOverCoverageReadsDeps = {
      fetchCapabilitiesForArchitecture: jest.fn().mockResolvedValue([]),
      fetchFindingsForRun: jest.fn(),
      fetchDiscoveryRunsForArchitecture: jest.fn().mockResolvedValue([]),
    };
    const inputs = await gatherCarryOverCoverageInputs({
      projectId: 'proj-1',
      architectureId: 'arch-1',
      book: emptyBook,
      workItems: [],
      deps,
    });
    expect(deps.fetchFindingsForRun).not.toHaveBeenCalled();
    expect(inputs.scope).toEqual({
      capabilityCount: 0,
      runCount: 0,
      findingCount: 0,
      runScopeSource: 'none',
    });
  });
});
