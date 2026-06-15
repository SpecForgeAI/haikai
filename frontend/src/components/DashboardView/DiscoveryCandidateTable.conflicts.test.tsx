/**
 * DiscoveryCandidateTable -- Conflict UI tests
 *
 * Spec 2026-06-02 Unique, Aggregate Discovery Candidates (Spec 0) -- Task Group 7.1.
 *
 * Surfaces the cross-source MERGE conflict data model in the candidate review
 * grid. The merge engine (Group 2, built concurrently) writes this shape into
 * candidate `data` (JSONB passthrough):
 *   - data._conflicts[attr]            = { value, source }[]   (competing PRESENT values)
 *   - data._conflictResolutions[attr]  = { chosenValue, chosenSource, resolvedBy, resolvedAt }
 *   - data._addedBy                    = string[]              (was a single string)
 *
 * An UNRESOLVED `_conflicts` entry (no matching `_conflictResolutions` entry)
 * is a live conflict: it raises a per-row badge and gates clean-approve.
 *
 * Coverage (6 highly-focused tests, all critical, no padding):
 *   1. Conflict badge renders ONLY when an unresolved `_conflicts` entry is
 *      present; absent for a clean candidate AND for one whose every conflict
 *      is already resolved.
 *   2. The side-by-side chooser lists each conflicted attribute's competing
 *      values WITH their source.
 *   3. Selecting a value writes `_conflictResolutions[attr]` (chosenValue +
 *      chosenSource), writes the chosen value to the canonical attribute slot,
 *      and clears that `_conflicts` entry -- via `onCandidatesChange`.
 *   4. Approve is DISABLED (with a tooltip) while any conflict is unresolved.
 *   5. Approve is ENABLED once every conflict is resolved.
 *   6. `getAddedBy` / `TierBadge` renders for BOTH `_addedBy: string[]` and the
 *      legacy single-string form (the known regression the merge introduces).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import type {
  DiscoveryCandidateDto,
  ReviewModel,
  ReviewModelNode,
} from '../../api/discoveryApi';

// ----------------------------------------------------------------------------
// Mocks. The conflict UI is purely client-side state + an onCandidatesChange
// callback; no review API call fires on resolve, so the API mock only needs to
// exist to keep the module import side-effect-free. CSS modules are mocked via
// the identity Proxy idiom (mirrors FindingsTab.bulk.test.tsx) so class-name
// assertions stay deterministic.
// ----------------------------------------------------------------------------

const mockGetReviewModel = vi.fn();
const mockResolveDiscoveryConflict = vi.fn();

vi.mock('../../api/discoveryApi', async () => {
  const actual = await vi.importActual<typeof import('../../api/discoveryApi')>(
    '../../api/discoveryApi',
  );
  return {
    ...actual,
    reviewCandidate: vi.fn(),
    bulkReviewCandidates: vi.fn(),
    bulkReviewCascade: vi.fn(),
    getReviewModel: (...args: unknown[]) => mockGetReviewModel(...args),
    resolveDiscoveryConflict: (...args: unknown[]) =>
      mockResolveDiscoveryConflict(...args),
  };
});

vi.mock('./DiscoveryRunDetailView.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));
vi.mock('../Discovery/ConflictResolutionModal.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));
vi.mock('./TierBadge.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

// Import AFTER mocks.
import { DiscoveryCandidateTable } from './DiscoveryCandidateTable';

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

const PROJECT_ID = 'proj-1';
const ARCH_ID = 'arch-1';
const RUN_ID = 'run-1';

function makeCandidate(
  overrides: Partial<DiscoveryCandidateDto> = {},
): DiscoveryCandidateDto {
  return {
    id: 'cand-1',
    run_id: RUN_ID,
    candidate_type: 'endpoints',
    name: 'GET /owners/{p}',
    confidence: 0.9,
    status: 'proposed',
    source_cluster_ids: [],
    data: {},
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
function makeConflictedCandidate(
  overrides: Partial<DiscoveryCandidateDto> = {},
): DiscoveryCandidateDto {
  return makeCandidate({
    id: 'cand-conflict',
    data: {
      _addedBy: ['rest-wadl-pack', 'spring-classic-adapter'],
      operation_verb: 'GET',
      path_or_address: '/owners/{p}',
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

function renderTable(
  candidates: DiscoveryCandidateDto[],
  onCandidatesChange = vi.fn(),
) {
  render(
    <DiscoveryCandidateTable
      projectId={PROJECT_ID}
      architectureId={ARCH_ID}
      runId={RUN_ID}
      candidates={candidates}
      onCandidatesChange={onCandidatesChange}
    />,
  );
  return { onCandidatesChange };
}

describe('DiscoveryCandidateTable conflict UI (Spec 0 Group 7.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetReviewModel.mockReset();
    mockResolveDiscoveryConflict.mockReset();
    // Default: the backbone fetch fails -> the grid falls back to the local
    // derivation, exactly as the existing conflict tests assumed when the real
    // fetch rejected. Individual Bug 2 tests override this with a resolved model.
    mockGetReviewModel.mockRejectedValue(new Error('no backbone'));
    // Default: the durable persist resolves with the (updated) candidate so the
    // fire-and-forget write never rejects in tests that do not assert on it.
    mockResolveDiscoveryConflict.mockResolvedValue(makeConflictedCandidate());
  });

  it('conflict badge renders only when an unresolved _conflicts entry is present', () => {
    const clean = makeCandidate({ id: 'clean', name: 'GET /clean' });
    const conflicted = makeConflictedCandidate();
    // A candidate whose only conflict already has a matching resolution must
    // NOT show the badge -- the conflict is settled.
    const resolved = makeConflictedCandidate({
      id: 'cand-resolved',
      data: {
        _addedBy: ['rest-wadl-pack', 'spring-classic-adapter'],
        operation_verb: 'GET',
        path_or_address: '/owners/{p}',
        _conflicts: {
          operation_verb: [
            { value: 'GET', source: 'rest-wadl-pack' },
            { value: 'POST', source: 'spring-classic-adapter' },
          ],
        },
        _conflictResolutions: {
          operation_verb: {
            chosenValue: 'GET',
            chosenSource: 'rest-wadl-pack',
            resolvedBy: 'reviewer',
            resolvedAt: '2026-06-02T01:00:00Z',
          },
        },
      },
    });

    renderTable([clean, conflicted, resolved]);

    // Exactly one badge -- on the conflicted (unresolved) candidate only.
    const badges = screen.getAllByTestId(/^candidate-conflict-badge-/);
    expect(badges).toHaveLength(1);
    expect(
      screen.getByTestId('candidate-conflict-badge-cand-conflict'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('candidate-conflict-badge-clean'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('candidate-conflict-badge-cand-resolved'),
    ).not.toBeInTheDocument();
  });

  it('the side-by-side chooser shows each conflicted attribute with its competing values + source', () => {
    renderTable([makeConflictedCandidate()]);

    // Open the chooser from the badge.
    fireEvent.click(screen.getByTestId('candidate-conflict-badge-cand-conflict'));

    const modal = screen.getByTestId('conflict-resolution-modal');
    expect(modal).toBeInTheDocument();

    // The conflicted attribute name is shown.
    expect(within(modal).getByText('operation_verb')).toBeInTheDocument();

    // Both competing options render WITH their source. One option per distinct
    // present value.
    const optGet = within(modal).getByTestId(
      'conflict-option-operation_verb-0',
    );
    const optPost = within(modal).getByTestId(
      'conflict-option-operation_verb-1',
    );
    expect(optGet).toHaveTextContent('GET');
    expect(optGet).toHaveTextContent('rest-wadl-pack');
    expect(optPost).toHaveTextContent('POST');
    expect(optPost).toHaveTextContent('spring-classic-adapter');
  });

  it('selecting a value writes _conflictResolutions + canonical slot and clears the conflict', () => {
    const onCandidatesChange = vi.fn();
    renderTable([makeConflictedCandidate()], onCandidatesChange);

    fireEvent.click(screen.getByTestId('candidate-conflict-badge-cand-conflict'));

    // Choose the SECOND option (POST / spring-classic-adapter), overriding the
    // canonical GET slot, then confirm.
    fireEvent.click(screen.getByTestId('conflict-option-operation_verb-1'));
    fireEvent.click(screen.getByTestId('conflict-resolve-confirm'));

    expect(onCandidatesChange).toHaveBeenCalledTimes(1);
    const updated = onCandidatesChange.mock.calls[0][0] as DiscoveryCandidateDto[];
    const data = updated[0].data as Record<string, unknown>;

    // (a) Resolution stamped with the chosen value + source.
    const resolutions = data._conflictResolutions as Record<
      string,
      { chosenValue: unknown; chosenSource: unknown; resolvedBy: unknown; resolvedAt: unknown }
    >;
    expect(resolutions.operation_verb.chosenValue).toBe('POST');
    expect(resolutions.operation_verb.chosenSource).toBe('spring-classic-adapter');
    expect(resolutions.operation_verb.resolvedBy).toBeTruthy();
    expect(resolutions.operation_verb.resolvedAt).toBeTruthy();

    // (b) Canonical attribute slot overwritten with the chosen value.
    expect(data.operation_verb).toBe('POST');

    // (c) That conflict entry cleared (no live conflicts remain).
    const conflicts = (data._conflicts ?? {}) as Record<string, unknown>;
    expect(conflicts.operation_verb).toBeUndefined();
  });

  it('Approve is disabled with a tooltip while any conflict is unresolved', () => {
    renderTable([makeConflictedCandidate()]);

    const approve = screen.getByTestId('action-approve') as HTMLButtonElement;
    expect(approve).toBeDisabled();
    expect(approve.getAttribute('title') ?? '').toMatch(/conflict/i);
  });

  it('Approve is enabled once every conflict is resolved', () => {
    // Same shape, but the single conflict already has a matching resolution.
    const resolved = makeConflictedCandidate({
      id: 'cand-resolved',
      data: {
        _addedBy: ['rest-wadl-pack', 'spring-classic-adapter'],
        operation_verb: 'GET',
        path_or_address: '/owners/{p}',
        _conflicts: {
          operation_verb: [
            { value: 'GET', source: 'rest-wadl-pack' },
            { value: 'POST', source: 'spring-classic-adapter' },
          ],
        },
        _conflictResolutions: {
          operation_verb: {
            chosenValue: 'GET',
            chosenSource: 'rest-wadl-pack',
            resolvedBy: 'reviewer',
            resolvedAt: '2026-06-02T01:00:00Z',
          },
        },
      },
    });

    renderTable([resolved]);

    const approve = screen.getByTestId('action-approve') as HTMLButtonElement;
    expect(approve).not.toBeDisabled();
  });

  it('getAddedBy / TierBadge renders for both _addedBy: string[] and the legacy string', () => {
    const arrayForm = makeCandidate({
      id: 'arr',
      name: 'array form',
      data: { _addedBy: ['petclinic-adapter', 'llm-gap-fill'] },
    });
    const legacyForm = makeCandidate({
      id: 'legacy',
      name: 'legacy form',
      data: { _addedBy: 'petclinic-adapter' },
    });

    renderTable([arrayForm, legacyForm]);

    const badges = screen.getAllByTestId('candidate-tier-badge');
    expect(badges).toHaveLength(2);

    // Array form: the FIRST label drives the badge, so it must NOT collapse to
    // the neutral em-dash placeholder (the regression the spec flags).
    const [arrBadge, legacyBadge] = badges;
    expect(arrBadge).not.toHaveTextContent('—');
    expect(arrBadge).toHaveAttribute('data-variant', 'success'); // *-adapter -> success
    // Legacy single string still resolves the same way.
    expect(legacyBadge).not.toHaveTextContent('—');
    expect(legacyBadge).toHaveAttribute('data-variant', 'success');
  });
  // --------------------------------------------------------------------------
  // Bug 3 (2026-06-03): resolving a conflict must PERSIST durably via the new
  // `resolveDiscoveryConflict` API (the existing `/resolve-conflict` proxy), not
  // just mutate React state -- otherwise a post-Approve server re-read still
  // carries the unresolved `_conflicts[attr]` and the conflict REAPPEARS. The
  // optimistic `onCandidatesChange` is kept for instant feedback.
  // --------------------------------------------------------------------------
  it('resolving a conflict calls resolveDiscoveryConflict to persist it durably (Bug 3)', async () => {
    const onCandidatesChange = vi.fn();
    mockResolveDiscoveryConflict.mockResolvedValue(makeConflictedCandidate());
    renderTable([makeConflictedCandidate()], onCandidatesChange);

    fireEvent.click(screen.getByTestId('candidate-conflict-badge-cand-conflict'));
    // Choose the SECOND option (POST / spring-classic-adapter), then confirm.
    fireEvent.click(screen.getByTestId('conflict-option-operation_verb-1'));
    fireEvent.click(screen.getByTestId('conflict-resolve-confirm'));

    // Optimistic local update still fires once (instant feedback).
    expect(onCandidatesChange).toHaveBeenCalledTimes(1);

    // The durable single-attribute persist fired with the snake_case body the
    // `/resolve-conflict` proxy expects (one call for the one resolved attribute).
    await waitFor(() =>
      expect(mockResolveDiscoveryConflict).toHaveBeenCalledTimes(1),
    );
    const [proj, arch, run, cand, body] =
      mockResolveDiscoveryConflict.mock.calls[0];
    expect(proj).toBe(PROJECT_ID);
    expect(arch).toBe(ARCH_ID);
    expect(run).toBe(RUN_ID);
    expect(cand).toBe('cand-conflict');
    expect(body.attr).toBe('operation_verb');
    expect(body.chosen_value).toBe('POST');
    expect(body.chosen_source).toBe('spring-classic-adapter');
  });

  // --------------------------------------------------------------------------
  // Bug 2 (2026-06-03): the all-or-nothing clean-approve gate reads the
  // server-computed backbone snapshot, which is STALE after a client-side
  // resolve, so "Approve Filtered" stayed DISABLED even after resolving every
  // conflicted candidate in the filter. Resolving must patch the held backbone so
  // the gate recomputes and the button ENABLES (the all-or-nothing semantics are
  // kept -- disabled while ANY in-scope candidate is still conflicted).
  // --------------------------------------------------------------------------
  it('resolving the last conflicted candidate in a filter ENABLES "Approve Filtered" (Bug 2, all-or-nothing kept, backbone-driven gate)', async () => {
    // Build a backbone where the single conflicted candidate has a LIVE conflict,
    // so the FILTERED Approve gate reads `has_live_conflict: true` from the
    // server snapshot (the path the bug lived on).
    const conflicted = makeConflictedCandidate({ id: 'c-alpha', name: 'GET /alpha' });
    const other = makeCandidate({ id: 'c-other', name: 'GET /other' });
    const nodes: ReviewModelNode[] = [
      {
        id: 'c-alpha',
        review_status: 'proposed',
        committed: false,
        conflict_state: { has_live_conflict: true, live_conflict_attrs: ['operation_verb'] },
      },
      {
        id: 'c-other',
        review_status: 'proposed',
        committed: false,
        conflict_state: { has_live_conflict: false },
      },
    ];
    const backbone: ReviewModel = {
      nodes,
      aggregations: {
        total_candidates: 2,
        committed_count: 0,
        actionable_count: 2,
        live_conflict_count: 1,
      },
    };
    mockGetReviewModel.mockResolvedValue(backbone);

    renderTable([conflicted, other]);

    // Wait for the backbone to land so the gate is reading the server snapshot.
    await waitFor(() => expect(mockGetReviewModel).toHaveBeenCalled());

    // Filter to ONLY the conflicted alpha row.
    fireEvent.change(screen.getByTestId('filter-name'), { target: { value: 'alpha' } });
    expect(screen.getAllByTestId('candidate-row')).toHaveLength(1);

    // Pre-condition: "Approve Filtered" is DISABLED -- the one filtered row still
    // has a live conflict per the backbone.
    const approveFiltered = screen.getByTestId('bulk-approve-filtered');
    await waitFor(() => expect(approveFiltered).toBeDisabled());

    // Resolve the conflict on the alpha row.
    fireEvent.click(screen.getByTestId('candidate-conflict-badge-c-alpha'));
    fireEvent.click(screen.getByTestId('conflict-option-operation_verb-1'));
    fireEvent.click(screen.getByTestId('conflict-resolve-confirm'));

    // Bug 2: the held backbone snapshot is patched so the gate recomputes and
    // "Approve Filtered" ENABLES (every conflicted candidate in the filter is now
    // settled).
    await waitFor(() => expect(approveFiltered).not.toBeDisabled());
  });
});
