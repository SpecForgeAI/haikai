/**
 * DiscoveryCandidateTable -- Batch "Resolve Conflicts" wiring tests
 *
 * Spec 2026-06-23 Batch "Resolve Conflicts" Modal -- Task Group 4 (4.1).
 *
 * These cover ONLY the table-side wiring added by TG4 (the modal/commit/support
 * units are covered by their own co-located tests). The five focused cases:
 *   1. The top "Resolve Conflicts (N)" button renders FIRST in the bulk-actions
 *      row, shows the live whole-run N, and is disabled when N === 0.
 *   2. Clicking it opens the batch modal.
 *   3. The per-row "N conflicts" badge + the single-candidate
 *      `ConflictResolutionModal` are UNCHANGED (still present + openable), and
 *      opening the single modal does NOT open the batch modal.
 *   4. A successful batch commit fires `onCandidatesChange` (refresh), persists
 *      each resolution via `resolveDiscoveryConflict` with `reviewer (batch)`,
 *      and the modal auto-closes.
 *   5. A partial failure keeps the modal OPEN and relabels Confirm to
 *      "Retry failed (N)" with a result banner.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import type { DiscoveryCandidateDto } from '../../api/discoveryApi';

// ----------------------------------------------------------------------------
// Mocks (mirror DiscoveryCandidateTable.conflicts.test.tsx). The batch commit
// loops the existing `resolveDiscoveryConflict`; we spy on it. The backbone
// fetch defaults to rejecting so the grid uses the local count fallback. CSS
// modules (incl. the new batch modal's) are mocked via the identity Proxy idiom.
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
  default: new Proxy({}, { get: (_t: object, prop: string | symbol) => String(prop) }),
}));
vi.mock('../Discovery/ConflictResolutionModal.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, prop: string | symbol) => String(prop) }),
}));
vi.mock('../Discovery/BatchResolveConflictsModal.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, prop: string | symbol) => String(prop) }),
}));
vi.mock('./TierBadge.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, prop: string | symbol) => String(prop) }),
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
    name: 'GET /owners/{p}',
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

describe('DiscoveryCandidateTable batch Resolve Conflicts wiring (Spec 3 TG4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetReviewModel.mockReset();
    mockResolveDiscoveryConflict.mockReset();
    // Backbone fetch fails -> the grid falls back to the local count derivation.
    mockGetReviewModel.mockRejectedValue(new Error('no backbone'));
    // Default: the durable persist resolves so the best-effort loop succeeds.
    mockResolveDiscoveryConflict.mockResolvedValue(makeConflictedCandidate());
  });

  it('top "Resolve Conflicts (N)" button renders FIRST in the bulk row, shows live N, and is disabled when N === 0', () => {
    // (a) No conflicts -> disabled, N = 0.
    const { unmount } = render(
      <DiscoveryCandidateTable
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        runId={RUN_ID}
        candidates={[makeCandidate({ id: 'clean', name: 'GET /clean', data: {} })]}
        onCandidatesChange={vi.fn()}
      />,
    );
    const resolveBtn = screen.getByTestId('bulk-resolve-conflicts');
    expect(resolveBtn).toBeDisabled();
    expect(resolveBtn).toHaveTextContent('Resolve Conflicts (0)');

    // FIRST in the bulk row: it precedes the Approve button in document order.
    const approveBtn = screen.getByTestId('bulk-approve');
    expect(
      resolveBtn.compareDocumentPosition(approveBtn) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    unmount();

    // (b) One conflicted candidate -> enabled, N = 1.
    renderTable([makeConflictedCandidate()]);
    const enabled = screen.getByTestId('bulk-resolve-conflicts');
    expect(enabled).not.toBeDisabled();
    expect(enabled).toHaveTextContent('Resolve Conflicts (1)');
  });

  it('clicking the top button opens the batch modal with a row per conflict', () => {
    renderTable([makeConflictedCandidate()]);

    expect(
      screen.queryByTestId('batch-resolve-conflicts-modal'),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('bulk-resolve-conflicts'));

    const modal = screen.getByTestId('batch-resolve-conflicts-modal');
    expect(modal).toBeInTheDocument();
    // The conflicted attribute + both competing sources are shown.
    expect(within(modal).getByText('operation_verb')).toBeInTheDocument();
    expect(
      within(modal).getByTestId('batch-resolve-row-cand-conflict::operation_verb'),
    ).toBeInTheDocument();
  });

  it('leaves the per-row badge + single-candidate modal untouched (and opening it does NOT open the batch modal)', () => {
    renderTable([makeConflictedCandidate()]);

    // Per-row badge still present.
    const badge = screen.getByTestId('candidate-conflict-badge-cand-conflict');
    expect(badge).toBeInTheDocument();

    // Opening the per-row chooser opens the SINGLE modal, not the batch one.
    fireEvent.click(badge);
    expect(screen.getByTestId('conflict-resolution-modal')).toBeInTheDocument();
    expect(
      screen.queryByTestId('batch-resolve-conflicts-modal'),
    ).not.toBeInTheDocument();
  });

  it('a successful batch commit fires onCandidatesChange, persists with "reviewer (batch)", and auto-closes', async () => {
    const onCandidatesChange = vi.fn();
    renderTable([makeConflictedCandidate()], onCandidatesChange);

    fireEvent.click(screen.getByTestId('bulk-resolve-conflicts'));
    // Pre-select every row via the most-authoritative helper, then confirm.
    fireEvent.click(screen.getByTestId('batch-resolve-use-most-authoritative'));
    fireEvent.click(screen.getByTestId('batch-resolve-confirm'));

    // Refresh fired with the locally-mutated candidates (conflict cleared).
    await waitFor(() => expect(onCandidatesChange).toHaveBeenCalledTimes(1));
    const updated = onCandidatesChange.mock.calls[0][0] as DiscoveryCandidateDto[];
    const data = updated[0].data as Record<string, unknown>;
    expect((data._conflicts as Record<string, unknown>).operation_verb).toBeUndefined();
    expect(
      (data._conflictResolutions as Record<string, { resolvedBy: string }>)
        .operation_verb.resolvedBy,
    ).toBe('reviewer (batch)');

    // Durable persist fired once with the batch provenance label.
    expect(mockResolveDiscoveryConflict).toHaveBeenCalledTimes(1);
    const body = mockResolveDiscoveryConflict.mock.calls[0][4];
    expect(body.resolved_by).toBe('reviewer (batch)');
    expect(body.attr).toBe('operation_verb');

    // All-success -> the modal auto-closes (after the brief success linger).
    await waitFor(
      () =>
        expect(
          screen.queryByTestId('batch-resolve-conflicts-modal'),
        ).not.toBeInTheDocument(),
      { timeout: 2500 },
    );
  });

  it('a partial failure keeps the modal open and relabels Confirm to "Retry failed (N)"', async () => {
    const candA = makeConflictedCandidate({ id: 'cand-a', name: 'GET /a' });
    const candB = makeConflictedCandidate({ id: 'cand-b', name: 'GET /b' });
    // cand-b's resolve rejects; cand-a succeeds -> best-effort partial outcome.
    mockResolveDiscoveryConflict.mockImplementation(
      (_p: string, _a: string, _r: string, candidateId: string) =>
        candidateId === 'cand-b'
          ? Promise.reject(new Error('boom'))
          : Promise.resolve(makeConflictedCandidate({ id: candidateId })),
    );

    renderTable([candA, candB], vi.fn());

    fireEvent.click(screen.getByTestId('bulk-resolve-conflicts'));
    fireEvent.click(screen.getByTestId('batch-resolve-use-most-authoritative'));
    fireEvent.click(screen.getByTestId('batch-resolve-confirm'));

    // Modal STAYS open; banner reports the split; Confirm relabels to Retry.
    await waitFor(() =>
      expect(screen.getByTestId('batch-resolve-result-banner')).toHaveTextContent(
        '1 resolved, 1 failed',
      ),
    );
    expect(
      screen.getByTestId('batch-resolve-conflicts-modal'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('batch-resolve-confirm')).toHaveTextContent(
      'Retry failed (1)',
    );
  });
});
