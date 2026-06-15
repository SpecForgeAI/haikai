/**
 * DiscoveryCandidateTable -- backbone re-point tests
 *
 * Spec 2026-06-02 Deterministic Review Model + Cascade/Dependency Graph +
 * Aggregation Backbone (Spec 1) -- Task Group 6.1.
 *
 * Spec 1 ships the deterministic review-model backbone (discovery-service
 * computes it live on read; the gateway proxies it) and RE-POINTS the grid's
 * existing count/aggregation `useMemo`s onto it (single-run consumption). The
 * grid passes its one `runId`; the backbone API can span two runs but the grid
 * never does, and adds NO blast-radius / cascade UI (that is Spec 2).
 *
 * These tests lock the re-point's behavioural contract:
 *   1. The migrated count memos (`committedCount` / `actionableCount`) read the
 *      backbone's whole-run aggregation scalars and produce IDENTICAL gating to
 *      today (bulk Approve/Reject disable + "Remaining" relabel).
 *   2. The conflict counts (`unresolvedConflictCount` / the filtered variant)
 *      match the grid's existing `getUnresolvedConflicts` semantics on the SAME
 *      fixture -- the backbone's per-node `has_live_conflict` is the same
 *      predicate, joined onto displayed rows by node id, so filtered + unfiltered
 *      agree exactly (the bulk Approve / Approve-Filtered conflict gate).
 *   3. `uniqueTierLabels` produces the SAME display labels as today (the Tier
 *      filter dropdown is byte-for-byte equivalent) -- the backbone's
 *      `source_tier_labels` is a DIFFERENT (precedence-bucket) vocabulary, so the
 *      grid keeps deriving its display labels locally via `getDisplayTierLabel`.
 *   4. Per-row review actions / the conflict-resolution modal / optimistic state
 *      remain on the EXISTING write paths -- unaffected (Spec 1 is read-only on
 *      review state; the review API still fires on a per-row action, and the
 *      backbone fetch is read-only).
 *   5. The backbone fetch is read-only: loading it never calls a write-path API
 *      method, and a backbone fetch FAILURE degrades to the local derivation so
 *      counts never flicker wrong.
 *
 * Mocks mirror the companion grid suites (vi.mock the discoveryApi module, CSS
 * Proxy idiom). The NEW `getReviewModel` fetch is mocked to return aggregations +
 * nodes that MATCH the fixture so the asserted counts hold.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type {
  DiscoveryCandidateDto,
  ReviewModel,
  ReviewModelNode,
} from '../../api/discoveryApi';

// ============================================================================
// Mock setup
// ============================================================================

const mockReviewCandidate = vi.fn();
const mockBulkReviewCandidates = vi.fn();
const mockGetReviewModel = vi.fn();

vi.mock('../../api/discoveryApi', async () => {
  const actual = await vi.importActual<typeof import('../../api/discoveryApi')>(
    '../../api/discoveryApi',
  );
  return {
    ...actual,
    reviewCandidate: (...args: unknown[]) => mockReviewCandidate(...args),
    bulkReviewCandidates: (...args: unknown[]) => mockBulkReviewCandidates(...args),
    getReviewModel: (...args: unknown[]) => mockGetReviewModel(...args),
  };
});

vi.mock('./DiscoveryRunDetailView.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, prop: string | symbol) => String(prop) }),
}));
vi.mock('../Discovery/ConflictResolutionModal.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, prop: string | symbol) => String(prop) }),
}));
vi.mock('./TierBadge.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, prop: string | symbol) => String(prop) }),
}));

// Import AFTER mocks.
import { DiscoveryCandidateTable } from './DiscoveryCandidateTable';

// ============================================================================
// Fixtures
// ============================================================================

const PROJECT_ID = 'proj-1';
const ARCH_ID = 'arch-1';
const RUN_ID = 'run-1';

function makeCandidate(overrides: Partial<DiscoveryCandidateDto> = {}): DiscoveryCandidateDto {
  return {
    id: 'cand-1',
    run_id: RUN_ID,
    candidate_type: 'endpoints',
    name: 'GET /owners/{p}',
    confidence: 0.9,
    status: 'proposed',
    source_cluster_ids: [],
    data: { _addedBy: 'spring-boot-adapter' },
    synthesized_at: '2026-06-02T00:00:00Z',
    parent_candidate_id: null,
    review_status: 'pending_review',
    reviewed_by: null,
    reviewed_at: null,
    previous_review_status: null,
    ...overrides,
  };
}

/** A merged endpoint carrying ONE unresolved conflict on `operation_verb`. */
function makeConflictedCandidate(overrides: Partial<DiscoveryCandidateDto> = {}): DiscoveryCandidateDto {
  return makeCandidate({
    id: 'cand-conflict',
    name: 'GET /conflicted',
    data: {
      _addedBy: ['rest-wadl-pack', 'spring-classic-adapter'],
      operation_verb: 'GET',
      _conflicts: {
        operation_verb: [
          { value: 'GET', source: 'rest-wadl-pack' },
          { value: 'POST', source: 'spring-classic-adapter' },
        ],
      },
    },
    ...overrides,
  });
}

/**
 * Build a backbone `ReviewModel` whose nodes + whole-run aggregation scalars are
 * derived from the SAME candidate fixture, EXACTLY as the deterministic backbone
 * would compute them:
 *   - committed         = status === 'committed'
 *   - has_live_conflict = a `_conflicts[attr]` with no `_conflictResolutions[attr]`
 * This is the matching mock the grid's new async fetch resolves with.
 */
function buildBackboneFor(candidates: DiscoveryCandidateDto[]): ReviewModel {
  const hasLiveConflict = (c: DiscoveryCandidateDto): boolean => {
    const data = (c.data ?? {}) as Record<string, unknown>;
    const conflicts = data._conflicts;
    if (!conflicts || typeof conflicts !== 'object' || Array.isArray(conflicts)) return false;
    const resolutions =
      data._conflictResolutions && typeof data._conflictResolutions === 'object'
        ? (data._conflictResolutions as Record<string, unknown>)
        : {};
    return Object.keys(conflicts as Record<string, unknown>).some(
      (attr) => resolutions[attr] === undefined,
    );
  };

  const nodes: ReviewModelNode[] = candidates.map((c) => ({
    id: c.id,
    review_status: c.status,
    committed: c.status === 'committed',
    conflict_state: { has_live_conflict: hasLiveConflict(c) },
    source_tier: 'structural-framework-pack',
  }));

  const committed_count = nodes.filter((n) => n.committed).length;
  const live_conflict_count = nodes.filter((n) => n.conflict_state.has_live_conflict).length;

  return {
    nodes,
    aggregations: {
      total_candidates: nodes.length,
      committed_count,
      actionable_count: nodes.length - committed_count,
      live_conflict_count,
      source_tier_labels: ['structural-framework-pack'],
    },
  };
}

function renderTable(
  candidates: DiscoveryCandidateDto[],
  opts: { onCandidatesChange?: ReturnType<typeof vi.fn>; backbone?: ReviewModel } = {},
) {
  const onCandidatesChange = opts.onCandidatesChange ?? vi.fn();
  const backbone = opts.backbone ?? buildBackboneFor(candidates);
  mockGetReviewModel.mockResolvedValue(backbone);
  render(
    <DiscoveryCandidateTable
      projectId={PROJECT_ID}
      architectureId={ARCH_ID}
      runId={RUN_ID}
      candidates={candidates}
      onCandidatesChange={onCandidatesChange}
    />,
  );
  return { onCandidatesChange, backbone };
}

describe('DiscoveryCandidateTable backbone re-point (Spec 1 Group 6.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetReviewModel.mockReset();
  });

  // --------------------------------------------------------------------------
  // 0. The grid fetches the SINGLE-run review model (no secondRunId), and the
  //    fetch is read-only -- it never invokes a write-path API method.
  // --------------------------------------------------------------------------
  it('fetches the single-run review model once and never calls a write-path API on load', async () => {
    renderTable([makeCandidate({ id: 'c1' }), makeCandidate({ id: 'c2', name: 'GET /two' })]);

    await waitFor(() => expect(mockGetReviewModel).toHaveBeenCalledTimes(1));
    // Single-run: (projectId, architectureId, runId) -- NO second run id.
    expect(mockGetReviewModel).toHaveBeenCalledWith(PROJECT_ID, ARCH_ID, RUN_ID);
    expect(mockGetReviewModel.mock.calls[0]).toHaveLength(3);

    // Read-only: loading the backbone wrote nothing back.
    expect(mockReviewCandidate).not.toHaveBeenCalled();
    expect(mockBulkReviewCandidates).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // 1. committedCount / actionableCount read the backbone scalars and produce
  //    IDENTICAL gating: with some committed + some actionable rows, the bulk
  //    Approve/Reject buttons relabel to "Approve Remaining" / "Reject
  //    Remaining" and stay enabled; with ALL committed they disable.
  // --------------------------------------------------------------------------
  it('committed/actionable counts drive identical bulk-action gating from the backbone', async () => {
    const committed = makeCandidate({ id: 'c-committed', name: 'GET /committed', review_status: 'committed', status: 'committed' });
    const pending = makeCandidate({ id: 'c-pending', name: 'GET /pending' });
    renderTable([committed, pending]);

    await waitFor(() => expect(mockGetReviewModel).toHaveBeenCalled());

    // 1 committed + 1 actionable -> "Remaining" relabel, both enabled.
    await waitFor(() => {
      expect(screen.getByTestId('bulk-approve')).toHaveTextContent('Approve Remaining');
    });
    expect(screen.getByTestId('bulk-approve')).not.toBeDisabled();
    expect(screen.getByTestId('bulk-reject')).toHaveTextContent('Reject Remaining');
    expect(screen.getByTestId('bulk-reject')).not.toBeDisabled();
  });

  it('all-committed disables the bulk Approve/Reject buttons with the saved tooltip (backbone counts)', async () => {
    const committedA = makeCandidate({ id: 'c-a', name: 'GET /a', review_status: 'committed', status: 'committed' });
    const committedB = makeCandidate({ id: 'c-b', name: 'GET /b', review_status: 'committed', status: 'committed' });
    renderTable([committedA, committedB]);

    await waitFor(() => expect(mockGetReviewModel).toHaveBeenCalled());

    const approve = screen.getByTestId('bulk-approve');
    const reject = screen.getByTestId('bulk-reject');
    await waitFor(() => expect(approve).toBeDisabled());
    expect(reject).toBeDisabled();
    expect(approve).toHaveAttribute('title', 'All candidates are already saved');
    expect(reject).toHaveAttribute('title', 'All candidates are already saved');
  });

  // --------------------------------------------------------------------------
  // 2. unresolvedConflictCount matches getUnresolvedConflicts: a live conflict
  //    gates bulk Approve (whole-run) with the conflict tooltip; reject stays
  //    enabled (rejecting an ambiguous candidate is always valid).
  // --------------------------------------------------------------------------
  it('whole-run conflict count gates bulk Approve (matches getUnresolvedConflicts) but not Reject', async () => {
    const clean = makeCandidate({ id: 'c-clean', name: 'GET /clean' });
    const conflicted = makeConflictedCandidate();
    renderTable([clean, conflicted]);

    await waitFor(() => expect(mockGetReviewModel).toHaveBeenCalled());

    const approve = screen.getByTestId('bulk-approve');
    await waitFor(() => expect(approve).toBeDisabled());
    // 1 conflicted candidate -> the conflict gate tooltip names the count.
    expect(approve.getAttribute('title') ?? '').toMatch(/Resolve 1 conflicted candidate/i);

    // Reject is NOT conflict-gated.
    expect(screen.getByTestId('bulk-reject')).not.toBeDisabled();
  });

  it('filtered conflict count agrees with the whole-run count on the same fixture (filtered Approve gate)', async () => {
    // Two conflicted endpoints; filtering by name to ONE of them must still gate
    // the FILTERED Approve via the per-node backbone join (filtered == subset of
    // unfiltered, identical predicate).
    const conflictedAlpha = makeConflictedCandidate({ id: 'c-alpha', name: 'GET /alpha' });
    const conflictedBeta = makeConflictedCandidate({ id: 'c-beta', name: 'GET /beta' });
    renderTable([conflictedAlpha, conflictedBeta]);

    await waitFor(() => expect(mockGetReviewModel).toHaveBeenCalled());

    // Apply a name filter that selects only the alpha row.
    fireEvent.change(screen.getByTestId('filter-name'), { target: { value: 'alpha' } });

    // Exactly one row visible now.
    expect(screen.getAllByTestId('candidate-row')).toHaveLength(1);

    // Filtered Approve is conflict-gated for the single filtered (conflicted) row.
    const approveFiltered = screen.getByTestId('bulk-approve-filtered');
    await waitFor(() => expect(approveFiltered).toBeDisabled());
    expect(approveFiltered.getAttribute('title') ?? '').toMatch(
      /Resolve 1 conflicted candidate\(s\) in the current filter/i,
    );
  });

  // --------------------------------------------------------------------------
  // 3. uniqueTierLabels produces the SAME display labels as today. The Tier
  //    filter dropdown lists the grid's display vocabulary (e.g. "adapter"),
  //    NOT the backbone's precedence buckets ("structural-framework-pack").
  // --------------------------------------------------------------------------
  it('Tier filter dropdown keeps the grid display labels (not the backbone precedence buckets)', async () => {
    const adapter = makeCandidate({ id: 'c-adapter', name: 'GET /a', data: { _addedBy: 'spring-boot-adapter' } });
    const gapFill = makeCandidate({ id: 'c-gap', name: 'GET /b', data: { _addedBy: 'llm-gap-fill' } });
    renderTable([adapter, gapFill]);

    await waitFor(() => expect(mockGetReviewModel).toHaveBeenCalled());

    const filterTier = screen.getByTestId('filter-tier') as HTMLSelectElement;
    const optionValues = Array.from(filterTier.options).map((o) => o.value);

    // Grid display labels are present...
    expect(optionValues).toContain('adapter');
    expect(optionValues).toContain('gap-fill');
    // ...and the backbone's precedence-bucket vocabulary is NOT leaked in.
    expect(optionValues).not.toContain('structural-framework-pack');
    expect(optionValues).not.toContain('llm-gap-fill');
  });

  // --------------------------------------------------------------------------
  // 4. Per-row review actions stay on the EXISTING write path: clicking Approve
  //    on a clean row still calls reviewCandidate (Spec 1 is read-only on review
  //    state; the backbone re-point only changed the derived COUNTS).
  // --------------------------------------------------------------------------
  it('per-row Approve still calls the existing reviewCandidate write path (untouched)', async () => {
    mockReviewCandidate.mockResolvedValue(
      makeCandidate({ id: 'c-clean', name: 'GET /clean', review_status: 'approved' }),
    );
    renderTable([makeCandidate({ id: 'c-clean', name: 'GET /clean' })]);

    await waitFor(() => expect(mockGetReviewModel).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('action-approve'));

    await waitFor(() => expect(mockReviewCandidate).toHaveBeenCalledTimes(1));
    expect(mockReviewCandidate).toHaveBeenCalledWith(
      PROJECT_ID,
      ARCH_ID,
      RUN_ID,
      'c-clean',
      'approved',
    );
  });

  it('the conflict-resolution modal stays on the existing optimistic onCandidatesChange path (no review API)', async () => {
    const onCandidatesChange = vi.fn();
    renderTable([makeConflictedCandidate()], { onCandidatesChange });

    await waitFor(() => expect(mockGetReviewModel).toHaveBeenCalled());

    // Open the chooser, pick the second option, confirm.
    fireEvent.click(screen.getByTestId('candidate-conflict-badge-cand-conflict'));
    fireEvent.click(screen.getByTestId('conflict-option-operation_verb-1'));
    fireEvent.click(screen.getByTestId('conflict-resolve-confirm'));

    // Resolution is purely client-side -> onCandidatesChange, NO review API call.
    expect(onCandidatesChange).toHaveBeenCalledTimes(1);
    expect(mockReviewCandidate).not.toHaveBeenCalled();
    expect(mockBulkReviewCandidates).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // 5. Backbone fetch FAILURE degrades to the local derivation so counts never
  //    flicker wrong: the conflict gate (driven locally) still fires even when
  //    the backbone never resolves.
  // --------------------------------------------------------------------------
  it('degrades to the local derivation when the backbone fetch fails (no wrong-count flicker)', async () => {
    mockGetReviewModel.mockRejectedValue(new Error('discovery-service unreachable'));
    render(
      <DiscoveryCandidateTable
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        runId={RUN_ID}
        candidates={[makeConflictedCandidate()]}
        onCandidatesChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(mockGetReviewModel).toHaveBeenCalled());

    // Even with the backbone unavailable, the local fallback still gates Approve
    // on the live conflict (counts are correct, just locally derived).
    const approve = screen.getByTestId('bulk-approve');
    await waitFor(() => expect(approve).toBeDisabled());
    expect(approve.getAttribute('title') ?? '').toMatch(/Resolve 1 conflicted candidate/i);
  });
});
