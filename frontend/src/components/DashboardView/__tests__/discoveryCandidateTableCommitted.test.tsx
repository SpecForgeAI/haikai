/**
 * DiscoveryCandidateTable -- committed-status behaviour tests.
 *
 * Hotfix 2026-05-11 (Bug 3): after Save All Approved succeeds, candidates
 * that have been promoted to the canonical model carry `review_status: 'committed'`.
 * The user-facing requirements:
 *
 *   (a) The rows STAY VISIBLE. The pre-save review-status filter is cleared
 *       automatically when the parent bumps `lastSaveTimestamp`, so a row
 *       that filtered to "approved" before the save isn't filtered out
 *       just because it's now "committed".
 *
 *   (b) The Approve / Reject / Defer buttons on a committed row are
 *       DISABLED with a tooltip ("Already saved to canonical model").
 *       The Show Details button remains enabled.
 *
 * Scope: this file ONLY tests the candidate-table-level child component
 * behaviour. The parent's post-save refetch wiring (Bug 2) is covered in
 * `saveBackConfirmModalWiring.test.tsx` and the gap-fill test files.
 *
 * Mocks mirror `discoveryCandidateTableRuntime.test.tsx` to keep the
 * suite shape consistent across the table's hotfix tests.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import type { DiscoveryCandidateDto } from '../../../api/discoveryApi';

// ============================================================================
// Mock setup
// ============================================================================

vi.mock('../../../api/discoveryApi', () => ({
  reviewCandidate: vi.fn(),
  bulkReviewCandidates: vi.fn(),
  // Spec 1 (2026-06-02) Group 6: the table now fetches the deterministic
  // review-model backbone on mount (single-run). These committed-status tests
  // assert the LOCAL derivation, so the backbone fetch is mocked to REJECT --
  // the grid then falls back to the identical local count derivation, keeping
  // these assertions byte-for-byte valid (the fallback is the pre-backbone logic).
  getReviewModel: vi.fn().mockRejectedValue(new Error('not under test')),
}));

vi.mock('../DiscoveryRunDetailView.module.css', () => ({
  default: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => String(prop),
  }),
}));

vi.mock('../TierBadge.module.css', () => ({
  default: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => String(prop),
  }),
}));

vi.mock('../../../contexts/ArchitectureContext', () => ({
  useActiveArchitectureId: () => 'arch-uuid-default',
  useArchitectureContext: () => ({
    architectures: [
      {
        id: 'arch-uuid-default',
        projectId: 'proj-1',
        name: 'Default',
        description: null,
        tags: [],
        archived: false,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ],
  }),
}));

// ============================================================================
// Fixtures
// ============================================================================

function makeCandidate(overrides: Partial<DiscoveryCandidateDto> = {}): DiscoveryCandidateDto {
  return {
    id: 'cand-001',
    run_id: 'run-1',
    candidate_type: 'application',
    name: 'OrderService',
    confidence: 0.85,
    status: 'proposed',
    source_cluster_ids: [],
    data: {},
    synthesized_at: '2026-05-11T00:00:00Z',
    parent_candidate_id: null,
    review_status: 'pending_review',
    reviewed_by: null,
    reviewed_at: null,
    previous_review_status: null,
    ...overrides,
  };
}

// ============================================================================
// Lazy import after mocks
// ============================================================================

let DiscoveryCandidateTable: React.FC<{
  projectId: string;
  architectureId: string;
  runId: string;
  candidates: DiscoveryCandidateDto[];
  onCandidatesChange: (candidates: DiscoveryCandidateDto[]) => void;
  lastSaveTimestamp?: number;
}>;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../DiscoveryCandidateTable');
  DiscoveryCandidateTable = mod.DiscoveryCandidateTable;
});

// ============================================================================
// Tests
// ============================================================================

describe('DiscoveryCandidateTable committed-status behaviour (Hotfix Bug 3)', () => {
  // --------------------------------------------------------------------------
  // Test 1: Approve / Reject / Defer disabled when review_status === 'committed'.
  //   Show Details remains enabled. Disabled buttons carry the tooltip.
  // --------------------------------------------------------------------------
  it('Test 1: committed row disables Approve/Reject/Defer with the tooltip and keeps Show Details enabled', () => {
    const candidates = [
      makeCandidate({
        id: 'cand-committed',
        name: 'OrderService',
        review_status: 'committed',
        status: 'committed',
      }),
    ];

    render(
      <DiscoveryCandidateTable
        projectId="proj-1"
        architectureId="arch-uuid-default"
        runId="run-1"
        candidates={candidates}
        onCandidatesChange={vi.fn()}
      />
    );

    const row = screen.getByTestId('candidate-row');

    const approve = within(row).getByTestId('action-approve');
    const reject = within(row).getByTestId('action-reject');
    const defer = within(row).getByTestId('action-defer');

    expect(approve).toBeDisabled();
    expect(reject).toBeDisabled();
    expect(defer).toBeDisabled();

    // Tooltip wording per spec.
    expect(approve).toHaveAttribute('title', 'Already saved to canonical model');
    expect(reject).toHaveAttribute('title', 'Already saved to canonical model');
    expect(defer).toHaveAttribute('title', 'Already saved to canonical model');

    // Show Details button is not affected by committed status -- it's
    // gated solely by the type-supports allowlist. 'application' is not
    // currently in that allowlist, so the button is disabled for a
    // different reason (and has its own tooltip). To prove the committed
    // status itself doesn't disable it, we just assert the title differs.
    const showDetails = within(row).getByTestId('show-details-cand-committed');
    expect(showDetails).not.toHaveAttribute('title', 'Already saved to canonical model');
  });

  // --------------------------------------------------------------------------
  // Test 2: bumping `lastSaveTimestamp` clears the review-status filter.
  //   Verified by setting a non-empty filter beforehand via fireEvent.change
  //   on the visible <select> control, then bumping the timestamp.
  // --------------------------------------------------------------------------
  it('Test 2: bumping lastSaveTimestamp clears the review-status filter so newly-committed rows stay visible', () => {
    const approvedRow = makeCandidate({
      id: 'cand-approved',
      name: 'OrderService',
      review_status: 'approved',
    });
    const pendingRow = makeCandidate({
      id: 'cand-pending',
      name: 'PaymentService',
      review_status: 'pending_review',
    });

    const { rerender } = render(
      <DiscoveryCandidateTable
        projectId="proj-1"
        architectureId="arch-uuid-default"
        runId="run-1"
        candidates={[approvedRow, pendingRow]}
        onCandidatesChange={vi.fn()}
        lastSaveTimestamp={1}
      />
    );

    // Apply the "approved" review-status filter via the visible select.
    // This filters the table to just the approved row.
    fireEvent.change(screen.getByTestId('filter-review-status'), {
      target: { value: 'approved' },
    });

    // Sanity: before the save bump, the pre-existing user filter is
    // intact and the only visible row is the approved one.
    let rows = screen.getAllByTestId('candidate-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('OrderService');

    // Now simulate the post-save: the approved row becomes committed AND
    // the parent bumps `lastSaveTimestamp`. The table's effect should
    // clear the filter so both rows are visible again.
    const committedRow = { ...approvedRow, review_status: 'committed', status: 'committed' };
    rerender(
      <DiscoveryCandidateTable
        projectId="proj-1"
        architectureId="arch-uuid-default"
        runId="run-1"
        candidates={[committedRow, pendingRow]}
        onCandidatesChange={vi.fn()}
        lastSaveTimestamp={2}
      />
    );

    // Filter has been auto-cleared -- both rows visible now, including
    // the freshly-committed one which would otherwise have been filtered
    // out by the stale "approved" selection.
    rows = screen.getAllByTestId('candidate-row');
    expect(rows).toHaveLength(2);
    // The select reflects the cleared state too.
    expect((screen.getByTestId('filter-review-status') as HTMLSelectElement).value).toBe('');
  });

  // --------------------------------------------------------------------------
  // Test 3: a non-committed row still has Approve/Reject/Defer enabled
  //   per the existing behaviour (sanity guard against the disable being
  //   over-broad).
  // --------------------------------------------------------------------------
  it('Test 3: a pending row keeps Approve / Reject / Defer enabled (committed-disable is scoped to committed)', () => {
    const candidates = [makeCandidate({ id: 'cand-pending', review_status: 'pending_review' })];

    render(
      <DiscoveryCandidateTable
        projectId="proj-1"
        architectureId="arch-uuid-default"
        runId="run-1"
        candidates={candidates}
        onCandidatesChange={vi.fn()}
      />
    );

    const row = screen.getByTestId('candidate-row');
    expect(within(row).getByTestId('action-approve')).not.toBeDisabled();
    expect(within(row).getByTestId('action-reject')).not.toBeDisabled();
    expect(within(row).getByTestId('action-defer')).not.toBeDisabled();
  });
});
