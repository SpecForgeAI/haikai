/**
 * Candidate Review and Approval Workflow -- Gap-Fill Tests
 *
 * Spec: Candidate Review and Approval Workflow (Increment 13)
 * Task Group 6, Task 6.5: Strategic tests to fill coverage gaps
 *
 * Tests:
 * 1. Optimistic update rollback on API error in frontend
 * 2. Filter bar count badges update after a review action
 * 3. Save-approved button disappears after all approved candidates are committed
 *
 * These tests cover critical user workflows that were not addressed
 * in the initial 23 tests from Task Groups 1-5.
 *
 * Spec 2026-05-01 Multi-Architecture Discovery Integration -- Task Group 8 update:
 *   The Save All Approved flow now goes through SaveBackConfirmModal -- a
 *   click on the button opens the modal, and only the modal's Confirm
 *   actually fires saveApprovedCandidates. Test 3 below was updated to
 *   drive through the modal accordingly. The run fixture also gains
 *   architecture_id so the wiring uses selectedRun.architecture_id (the
 *   bound id) -- this matches Group 8's safety property (d) wiring.
 *
 * Hotfix 2026-05-11 (Bug 2): the save-back path now also refetches the
 * runs list AND the selected run detail post-save. Test 3's fixtures
 * therefore include second-call resolutions for getDiscoveryRuns,
 * getDiscoveryRun, and getDiscoveryCandidateCount.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { DiscoveryCandidateDto } from '../../../api/discoveryApi';
import { renderDiscoveryRunDetailPage } from './_discoveryRunDetailPageHarness';

// ============================================================================
// Mock setup
// ============================================================================

const mockGetDiscoveryRuns = vi.fn();
const mockGetDiscoveryRun = vi.fn();
const mockGetDiscoveryCandidateCount = vi.fn();
const mockGetDiscoveryCandidates = vi.fn();
const mockReviewCandidate = vi.fn();
const mockSaveApprovedCandidates = vi.fn();

vi.mock('../../../api/discoveryApi', () => ({
  getDiscoveryRuns: (...args: unknown[]) => mockGetDiscoveryRuns(...args),
  getDiscoveryRun: (...args: unknown[]) => mockGetDiscoveryRun(...args),
  getDiscoveryCandidateCount: (...args: unknown[]) => mockGetDiscoveryCandidateCount(...args),
  getDiscoveryCandidates: (...args: unknown[]) => mockGetDiscoveryCandidates(...args),
  reviewCandidate: (...args: unknown[]) => mockReviewCandidate(...args),
  saveApprovedCandidates: (...args: unknown[]) => mockSaveApprovedCandidates(...args),
  // Spec 2 (2026-06-02) cascade-bulk-review: the grid now fetches the
  // deterministic review-model backbone on mount. These tests assert the LOCAL
  // derivation, so the backbone fetch is mocked to REJECT -- the grid falls back
  // to the identical local logic, keeping these assertions byte-for-byte valid.
  getReviewModel: vi.fn().mockRejectedValue(new Error('not under test')),
}));

// Mock CSS module to return identity mapping (class names = property names)
vi.mock('../DiscoveryRunDetailView.module.css', () => ({
  default: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => String(prop),
  }),
}));

// SaveBackConfirmModal CSS module mock (Group 8 -- modal lives in
// components/Discovery so it has its own CSS module that needs the
// identity proxy too).
vi.mock('../../Discovery/SaveBackConfirmModal.module.css', () => ({
  default: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => String(prop),
  }),
}));

// Spec 2026-05-01 Multi-Architecture Discovery Integration -- Task Group 7:
// DiscoveryRunDetailView now reads useActiveArchitectureId() and architectures
// from ArchitectureContext. Mock the hooks here so the component can mount
// without a real provider/router.
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
    invalidateArchitectureModelCache: vi.fn(),
  }),
  useArchitectureDispatch: () => vi.fn(),
}));

vi.mock('../../../contexts/ProjectContext', () => ({
  useProject: () => ({ id: 'proj-1', name: 'Project 1' }),
}));


// ============================================================================
// Fixtures
// ============================================================================

function makeCandidates(): DiscoveryCandidateDto[] {
  return [
    {
      id: 'cand-001',
      run_id: 'run-002',
      candidate_type: 'application',
      name: 'OrderService',
      confidence: 0.85,
      status: 'proposed',
      source_cluster_ids: ['cluster-1'],
      data: {},
      synthesized_at: '2026-04-05T12:10:00Z',
      parent_candidate_id: null,
      review_status: 'pending_review',
      reviewed_by: null,
      reviewed_at: null,
      previous_review_status: null,
    },
    {
      id: 'cand-002',
      run_id: 'run-002',
      candidate_type: 'service',
      name: 'PaymentProcessor',
      confidence: 0.72,
      status: 'proposed',
      source_cluster_ids: ['cluster-2'],
      data: {},
      synthesized_at: '2026-04-05T12:11:00Z',
      parent_candidate_id: null,
      review_status: 'approved',
      reviewed_by: 'alice',
      reviewed_at: '2026-04-05T12:20:00Z',
      previous_review_status: 'pending_review',
    },
    {
      id: 'cand-003',
      run_id: 'run-002',
      candidate_type: 'data_store',
      name: 'OrderDatabase',
      confidence: 0.91,
      status: 'proposed',
      source_cluster_ids: ['cluster-3'],
      data: {},
      synthesized_at: '2026-04-05T12:12:00Z',
      parent_candidate_id: null,
      review_status: 'rejected',
      reviewed_by: 'bob',
      reviewed_at: '2026-04-05T12:25:00Z',
      previous_review_status: 'pending_review',
    },
  ];
}

// ============================================================================
// Components (lazy import after mocks)
// ============================================================================

let DiscoveryCandidateTable: React.FC<{
  projectId: string;
  architectureId: string;
  runId: string;
  candidates: DiscoveryCandidateDto[];
  onCandidatesChange: (candidates: DiscoveryCandidateDto[]) => void;
}>;
let DiscoveryRunDetailPage: React.FC;

beforeEach(async () => {
  vi.clearAllMocks();
  mockGetDiscoveryRuns.mockReset();
  mockGetDiscoveryRun.mockReset();
  mockGetDiscoveryCandidateCount.mockReset();
  mockGetDiscoveryCandidates.mockReset();
  mockReviewCandidate.mockReset();
  mockSaveApprovedCandidates.mockReset();

  const tableMod = await import('../DiscoveryCandidateTable');
  DiscoveryCandidateTable = tableMod.DiscoveryCandidateTable;
  const detailMod = await import('../DiscoveryRunDetailPage');
  DiscoveryRunDetailPage = detailMod.DiscoveryRunDetailPage;
});

// ============================================================================
// Tests
// ============================================================================

describe('Candidate Review Gap-Fill Tests (Task Group 6)', () => {

  // --------------------------------------------------------------------------
  // Gap-Fill Test 1: Optimistic update rollback on API error
  // --------------------------------------------------------------------------
  it('reverts optimistic update when reviewCandidate API call fails', async () => {
    const candidates = makeCandidates();
    const onCandidatesChange = vi.fn();

    // Make reviewCandidate reject with an error
    mockReviewCandidate.mockRejectedValueOnce(new Error('Network error'));

    render(
      <DiscoveryCandidateTable
        projectId="proj-1"
        architectureId="arch-uuid-default"
        runId="run-002"
        candidates={candidates}
        onCandidatesChange={onCandidatesChange}
      />
    );

    // Click Approve on the first candidate (cand-001, pending_review)
    const approveButtons = screen.getAllByTestId('action-approve');
    fireEvent.click(approveButtons[0]);

    // First call: optimistic update (review_status -> approved)
    expect(onCandidatesChange).toHaveBeenCalledTimes(1);
    const optimisticCandidates = onCandidatesChange.mock.calls[0][0];
    expect(optimisticCandidates[0].review_status).toBe('approved');

    // Wait for the error to be caught and revert to happen
    await waitFor(() => {
      expect(onCandidatesChange.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    // Second call: rollback to original state (review_status -> pending_review)
    const revertedCandidates = onCandidatesChange.mock.calls[1][0];
    expect(revertedCandidates[0].review_status).toBe('pending_review');
    expect(revertedCandidates[0].id).toBe('cand-001');
  });

  // --------------------------------------------------------------------------
  // Gap-Fill Test 2: Review-status filtering reflects updated statuses after a
  // review action. (The chip count badges were replaced by the per-column
  // Review Status select filter, so the equivalent behaviour is that the
  // filtered row set tracks the optimistic status change.)
  // --------------------------------------------------------------------------
  it('filter count badges reflect updated counts after an optimistic review action', () => {
    // Start with 1 pending, 1 approved, 1 rejected
    const candidates = makeCandidates();
    const onCandidatesChange = vi.fn();

    const { rerender } = render(
      <DiscoveryCandidateTable
        projectId="proj-1"
        architectureId="arch-uuid-default"
        runId="run-002"
        candidates={candidates}
        onCandidatesChange={onCandidatesChange}
      />
    );

    // Filter to approved: initially only 1 row
    fireEvent.change(screen.getByTestId('filter-review-status'), {
      target: { value: 'approved' },
    });
    expect(screen.getAllByTestId('candidate-row')).toHaveLength(1);
    expect(screen.getByTestId('candidate-count-summary')).toHaveTextContent(
      'Showing 1 of 3 candidates'
    );

    // Simulate the optimistic update: cand-001 goes from pending_review -> approved
    const updatedCandidates = [...candidates];
    updatedCandidates[0] = { ...candidates[0], review_status: 'approved' };

    rerender(
      <DiscoveryCandidateTable
        projectId="proj-1"
        architectureId="arch-uuid-default"
        runId="run-002"
        candidates={updatedCandidates}
        onCandidatesChange={onCandidatesChange}
      />
    );

    // The approved filter now matches 2 rows
    expect(screen.getAllByTestId('candidate-row')).toHaveLength(2);
    expect(screen.getByTestId('candidate-count-summary')).toHaveTextContent(
      'Showing 2 of 3 candidates'
    );
  });

  // --------------------------------------------------------------------------
  // Gap-Fill Test 3: Save-approved button disappears after all approved
  //                  candidates are committed.
  //
  // Group 8 update: the save now goes through SaveBackConfirmModal. The
  // test now opens the modal via the Save All Approved button and clicks
  // the modal's Confirm to fire the actual save.
  // --------------------------------------------------------------------------
  it('Save All Approved button disappears after candidates are re-fetched as committed', async () => {
    const sampleRuns = [
      {
        id: 'run-002',
        project_id: 'proj-1',
        status: 'COMPLETED',
        current_step: null,
        config_snapshot: null,
        steps_payload: null,
        error_message: null,
        created_at: '2026-04-05T12:00:00Z',
        updated_at: '2026-04-05T12:30:00Z',
        // Group 8: the run is bound to a specific architecture for life.
        // This matches the URL active id in the mocked context so the
        // wiring's defensive console.warn does not fire here.
        architecture_id: 'arch-uuid-default',
      },
    ];

    const candidatesWithApproved = makeCandidates();
    // candidatesWithApproved[1] has review_status === 'approved'

    // After save, the approved candidate becomes committed
    const candidatesAfterSave: DiscoveryCandidateDto[] = candidatesWithApproved.map((c) => {
      if (c.review_status === 'approved') {
        return { ...c, status: 'committed', review_status: 'committed' };
      }
      return c;
    });

    mockGetDiscoveryRuns.mockResolvedValueOnce(sampleRuns);
    mockGetDiscoveryRun.mockResolvedValueOnce(sampleRuns[0]);
    mockGetDiscoveryCandidateCount.mockResolvedValueOnce({ count: 3 });
    // First fetch: candidates with one approved
    mockGetDiscoveryCandidates.mockResolvedValueOnce(candidatesWithApproved);
    // Save approved result
    mockSaveApprovedCandidates.mockResolvedValueOnce({
      entitiesCreated: 1,
      entitiesSkipped: 0,
      candidatesCommitted: 1,
    });
    // Re-fetch after save: approved candidate is now committed
    mockGetDiscoveryCandidates.mockResolvedValueOnce(candidatesAfterSave);
    // Hotfix Bug 2: post-save also refetches the run list AND the
    // selected-run detail in parallel. Provide a second resolution for
    // each so the post-save UX doesn't crash on an `undefined` payload.
    mockGetDiscoveryRuns.mockResolvedValueOnce(sampleRuns);
    mockGetDiscoveryRun.mockResolvedValueOnce(sampleRuns[0]);
    mockGetDiscoveryCandidateCount.mockResolvedValueOnce({ count: 3 });

    renderDiscoveryRunDetailPage(DiscoveryRunDetailPage, { runId: sampleRuns[0].id });

    // Wait for detail panel
    await waitFor(() => {
      expect(screen.getByTestId('run-detail-panel')).toBeInTheDocument();
    });

    // Wait for candidates to load (Candidates tab is default).
    await waitFor(() => {
      expect(screen.getByTestId('candidate-table')).toBeInTheDocument();
    });

    // Save All Approved button should be visible initially
    expect(screen.getByTestId('save-approved-button')).toBeInTheDocument();

    // Group 8: clicking Save All Approved opens the modal -- it does NOT
    // fire the API. The actual save happens when the modal's Confirm
    // button is clicked.
    fireEvent.click(screen.getByTestId('save-approved-button'));

    // Modal opens; API not yet called.
    await waitFor(() => {
      expect(screen.getByTestId('save-back-confirm-modal')).toBeInTheDocument();
    });
    expect(mockSaveApprovedCandidates).not.toHaveBeenCalled();

    // Click the modal's Confirm to actually fire the save.
    await act(async () => {
      fireEvent.click(screen.getByTestId('save-back-confirm-confirm'));
    });

    // Wait for save to complete and candidates to re-fetch.
    // After re-fetch, no candidates have review_status === 'approved'
    // (the approved one became 'committed'), so the Save All Approved
    // button (and its entire section) disappears from the DOM.
    await waitFor(() => {
      expect(screen.queryByTestId('save-approved-button')).not.toBeInTheDocument();
    });

    // Verify the candidate table is still visible with the updated data
    expect(screen.getByTestId('candidate-table')).toBeInTheDocument();

    // Verify saveApprovedCandidates was called -- with the run's bound
    // architecture_id (selectedRun.architecture_id), per Group 8.
    expect(mockSaveApprovedCandidates).toHaveBeenCalledWith('proj-1', 'arch-uuid-default', 'run-002');

    // Verify candidates were re-fetched after save
    expect(mockGetDiscoveryCandidates).toHaveBeenCalledTimes(2);
  });
});
