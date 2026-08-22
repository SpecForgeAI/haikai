/**
 * Foundations receipts on the candidate review stage (2026-08-22).
 *
 * After foundation answers exclude tables, the candidate table must make
 * that OBVIOUS — the "clearly appears in all following stages" contract:
 *   - entity rows matching an excluded/volatile table carry a scope chip
 *     citing the decision ref;
 *   - attribute rows inherit the chip through `data.tableName`;
 *   - the count summary states how many rows are covered and that they
 *     commit as documentation only (committed_excluded) on save;
 *   - uncovered rows and an absent map render exactly as before.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { DiscoveryCandidateDto } from '../../api/discoveryApi';

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

function makeCandidate(overrides: Partial<DiscoveryCandidateDto>): DiscoveryCandidateDto {
  return {
    id: 'cand-1',
    run_id: 'run-1',
    candidate_type: 'physical_data_entities',
    name: 'orders',
    confidence: 0.9,
    status: 'proposed',
    source_cluster_ids: [],
    data: {},
    synthesized_at: '2026-08-22T00:00:00Z',
    parent_candidate_id: null,
    review_status: 'pending_review',
    reviewed_by: null,
    reviewed_at: null,
    previous_review_status: null,
    ...overrides,
  };
}

const CANDIDATES: DiscoveryCandidateDto[] = [
  makeCandidate({ id: 'e-bak', name: 'orders_bak' }),
  makeCandidate({
    id: 'a-bak-col',
    candidate_type: 'physical_data_attributes',
    name: 'orders_bak.note',
    data: { tableName: 'orders_bak' },
  }),
  makeCandidate({ id: 'e-live', name: 'orders' }),
  makeCandidate({ id: 'e-work', name: 'work_queue' }),
];

const SCOPE_MAP = new Map<string, { scope: string; decisionRef: string | null }>([
  ['orders_bak', { scope: 'excluded', decisionRef: 'F-1' }],
  ['work_queue', { scope: 'volatile', decisionRef: 'F-3' }],
]);

function renderTable(scopeByEntityName?: typeof SCOPE_MAP) {
  // The table's second read-only fetch (review model) degrades gracefully to
  // the local derivation on null — that path is all these assertions need.
  mockGetReviewModel.mockResolvedValue(null);
  return render(
    <DiscoveryCandidateTable
      projectId="proj-1"
      architectureId="arch-1"
      runId="run-1"
      candidates={CANDIDATES}
      onCandidatesChange={() => undefined}
      scopeByEntityName={scopeByEntityName}
    />,
  );
}

describe('DiscoveryCandidateTable — foundation scope receipts', () => {
  it('entity + attribute rows covered by a decision carry the chip with its ref', () => {
    renderTable(SCOPE_MAP);
    const chips = screen.getAllByTestId('foundation-scope-chip');
    expect(chips.map((c) => c.textContent)).toEqual([
      'EXCLUDED (F-1)', // orders_bak entity row
      'EXCLUDED (F-1)', // orders_bak.note attribute row (via data.tableName)
      'VOLATILE (F-3)', // work_queue entity row
    ]);
    expect(chips[0].title).toContain('committed_excluded');
  });

  it('the count summary splits excluded (committed_excluded) from volatile', () => {
    renderTable(SCOPE_MAP);
    const count = screen.getByTestId('foundation-scope-count');
    expect(count.textContent).toContain('2 excluded by foundation decisions');
    expect(count.textContent).toContain('committed_excluded');
    expect(count.textContent).toContain('1 volatile (S0-tolerated)');
  });

  it('no map (or an empty one) renders no chips and no count line', () => {
    renderTable(undefined);
    expect(screen.queryByTestId('foundation-scope-chip')).toBeNull();
    expect(screen.queryByTestId('foundation-scope-count')).toBeNull();
  });
});
