/**
 * DiscoveryCandidateTable -- Batch "Resolve Conflicts" end-to-end workflows
 *
 * Spec 2026-06-23 Batch "Resolve Conflicts" Modal -- Task Group 5 (gap-fill).
 *
 * The TG1-TG4 tests cover their units in isolation; these two exercise the
 * critical CROSS-UNIT workflows that no single-group test does end to end
 * (table -> modal -> support pre-selection -> commit loop -> result -> retry):
 *
 *   1. Use-most-authoritative -> Confirm -> ONE call fails -> "Retry failed (1)"
 *      -> retry succeeds -> all-success -> auto-close. (The full happy+sad+retry
 *      chain in one flow.)
 *   2. "Prefer a source" pre-selects ONLY the rows carrying that source, and
 *      Confirm commits exactly those (rows lacking the source are left alone).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { DiscoveryCandidateDto } from '../../api/discoveryApi';

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

import { DiscoveryCandidateTable } from './DiscoveryCandidateTable';

const PROJECT_ID = 'proj-1';
const ARCH_ID = 'arch-1';
const RUN_ID = 'run-1';

/** A candidate carrying ONE unresolved conflict on `operation_verb`. */
function makeConflicted(
  id: string,
  name: string,
  options: { value: unknown; source: string }[],
): DiscoveryCandidateDto {
  return {
    id,
    run_id: RUN_ID,
    candidate_type: 'endpoints',
    name,
    confidence: 0.9,
    status: 'proposed',
    source_cluster_ids: [],
    data: {
      _addedBy: options.map((o) => o.source),
      operation_verb: options[0]?.value,
      _conflicts: { operation_verb: options },
    },
    synthesized_at: '2026-06-02T00:00:00Z',
    parent_candidate_id: null,
    review_status: 'pending_review',
    reviewed_by: null,
    reviewed_at: null,
    previous_review_status: null,
  };
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

describe('DiscoveryCandidateTable batch Resolve Conflicts -- e2e workflows (Spec 3 TG5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetReviewModel.mockReset();
    mockResolveDiscoveryConflict.mockReset();
    mockGetReviewModel.mockRejectedValue(new Error('no backbone'));
  });

  it('most-authoritative -> confirm -> one fails -> Retry failed (1) -> retry succeeds -> auto-close', async () => {
    const onCandidatesChange = vi.fn();
    const candA = makeConflicted('cand-a', 'GET /a', [
      { value: 'GET', source: 'rest-wadl-pack' },
      { value: 'POST', source: 'spring-classic-adapter' },
    ]);
    const candB = makeConflicted('cand-b', 'GET /b', [
      { value: 'GET', source: 'rest-wadl-pack' },
      { value: 'PUT', source: 'spring-classic-adapter' },
    ]);

    // cand-b's resolve FAILS on the first attempt, SUCCEEDS on the retry.
    let candBAttempts = 0;
    mockResolveDiscoveryConflict.mockImplementation(
      (_p: string, _a: string, _r: string, candidateId: string) => {
        if (candidateId === 'cand-b') {
          candBAttempts += 1;
          return candBAttempts === 1
            ? Promise.reject(new Error('boom'))
            : Promise.resolve({});
        }
        return Promise.resolve({});
      },
    );

    renderTable([candA, candB], onCandidatesChange);

    fireEvent.click(screen.getByTestId('bulk-resolve-conflicts'));
    fireEvent.click(screen.getByTestId('batch-resolve-use-most-authoritative'));
    fireEvent.click(screen.getByTestId('batch-resolve-confirm'));

    // First pass: 1 resolved, 1 failed -> modal stays open, Confirm relabels.
    await waitFor(() =>
      expect(screen.getByTestId('batch-resolve-confirm')).toHaveTextContent(
        'Retry failed (1)',
      ),
    );
    expect(screen.getByTestId('batch-resolve-result-banner')).toHaveTextContent(
      '1 resolved, 1 failed',
    );
    expect(onCandidatesChange).toHaveBeenCalledTimes(1);

    // Retry: re-fires ONLY the failed cand-b, which now succeeds.
    fireEvent.click(screen.getByTestId('batch-resolve-confirm'));

    // All-success -> auto-close.
    await waitFor(
      () =>
        expect(
          screen.queryByTestId('batch-resolve-conflicts-modal'),
        ).not.toBeInTheDocument(),
      { timeout: 2500 },
    );

    // cand-a once + cand-b twice (fail, then succeed) = 3 calls; refresh twice.
    expect(mockResolveDiscoveryConflict).toHaveBeenCalledTimes(3);
    expect(candBAttempts).toBe(2);
    expect(onCandidatesChange).toHaveBeenCalledTimes(2);
  });

  it('"Prefer a source" pre-selects only rows carrying that source; Confirm commits exactly those', async () => {
    const onCandidatesChange = vi.fn();
    // candA + candB both carry `source-A`; candC does NOT.
    const candA = makeConflicted('cand-a', 'GET /a', [
      { value: 'GET', source: 'source-A' },
      { value: 'POST', source: 'source-B' },
    ]);
    const candB = makeConflicted('cand-b', 'GET /b', [
      { value: 'GET', source: 'source-A' },
      { value: 'PUT', source: 'source-C' },
    ]);
    const candC = makeConflicted('cand-c', 'GET /c', [
      { value: 'GET', source: 'source-B' },
      { value: 'DELETE', source: 'source-C' },
    ]);
    mockResolveDiscoveryConflict.mockResolvedValue({});

    renderTable([candA, candB, candC], onCandidatesChange);

    fireEvent.click(screen.getByTestId('bulk-resolve-conflicts'));
    // Prefer `source-A` -> pre-selects cand-a + cand-b only (cand-c lacks it).
    fireEvent.change(screen.getByTestId('batch-resolve-prefer-source-select'), {
      target: { value: 'source-A' },
    });
    fireEvent.click(screen.getByTestId('batch-resolve-confirm'));

    await waitFor(() => expect(onCandidatesChange).toHaveBeenCalledTimes(1));

    // Exactly the two source-A rows were committed, each with chosen_source A.
    expect(mockResolveDiscoveryConflict).toHaveBeenCalledTimes(2);
    const committedIds = mockResolveDiscoveryConflict.mock.calls.map((c) => c[3]);
    expect(committedIds.sort()).toEqual(['cand-a', 'cand-b']);
    for (const call of mockResolveDiscoveryConflict.mock.calls) {
      expect(call[4].chosen_source).toBe('source-A');
    }
  });
});
