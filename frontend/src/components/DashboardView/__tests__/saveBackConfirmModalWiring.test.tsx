/**
 * DiscoveryRunDetailView <-> SaveBackConfirmModal wiring tests
 *
 * Spec 2026-05-01 Multi-Architecture Discovery Integration -- Task Group 8
 *
 * These tests cover the wiring between the Save All Approved button on
 * DiscoveryRunDetailView and the SaveBackConfirmModal, plus the safety
 * properties that require the wiring to behave correctly:
 *
 *   1. Safety property (e): clicking "Save All Approved" alone does NOT
 *      fire saveApprovedCandidates. The modal opens; only the modal's
 *      Confirm button fires the actual save.
 *
 *   2. Safety property (d): when the modal Confirm fires, the save call
 *      embeds selectedRun.architecture_id (the run's BOUND id) -- NOT
 *      useActiveArchitectureId() -- even when the user has navigated to
 *      a different architecture mid-session.
 *
 * Hotfix 2026-05-11 (Bug 2): after a successful save the parent ALSO
 * refetches the runs list AND the selected run detail (in addition to
 * the candidate list it already refetched). The mocks below provide
 * second-call resolutions for all three streams so the post-save UX
 * has data to render.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { DiscoveryCandidateDto, DiscoveryRunDto } from '../../../api/discoveryApi';
import { renderDiscoveryRunDetailPage } from './_discoveryRunDetailPageHarness';

// ============================================================================
// Mock setup
// ============================================================================

const mockGetDiscoveryRuns = vi.fn();
const mockGetDiscoveryRun = vi.fn();
const mockGetDiscoveryCandidateCount = vi.fn();
const mockGetDiscoveryCandidates = vi.fn();
const mockSaveApprovedCandidates = vi.fn();
const mockReviewCandidate = vi.fn();

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

// CSS module identity proxy so styles.X always returns the literal class
// name (component still renders, classes don't matter for these tests).
vi.mock('../DiscoveryRunDetailView.module.css', () => ({
  default: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => String(prop),
  }),
}));

vi.mock('../../Discovery/SaveBackConfirmModal.module.css', () => ({
  default: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => String(prop),
  }),
}));

// ArchitectureContext: the URL active id is `arch-active-url`. Crucially,
// this is DIFFERENT from the run's bound id (`arch-bound-by-run`) so the
// safety-property-(d) test can prove the save uses the BOUND id, not the
// URL active id. The architectures list contains BOTH so the chip can
// resolve and the modal has a name to render.
const URL_ACTIVE_ARCH_ID = 'arch-active-url';
const RUN_BOUND_ARCH_ID = 'arch-bound-by-run';

vi.mock('../../../contexts/ArchitectureContext', () => ({
  useActiveArchitectureId: () => URL_ACTIVE_ARCH_ID,
  useArchitectureContext: () => ({
    architectures: [
      {
        id: URL_ACTIVE_ARCH_ID,
        projectId: 'proj-1',
        name: 'Currently Viewing',
        description: null,
        tags: [],
        archived: false,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: RUN_BOUND_ARCH_ID,
        projectId: 'proj-1',
        name: 'Run Was Bound To',
        description: null,
        tags: [],
        archived: false,
        createdAt: '2026-02-01T00:00:00Z',
        updatedAt: '2026-02-01T00:00:00Z',
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

function makeRun(overrides: Partial<DiscoveryRunDto> = {}): DiscoveryRunDto {
  return {
    id: 'run-100',
    project_id: 'proj-1',
    status: 'COMPLETED',
    current_step: null,
    config_snapshot: null,
    steps_payload: null,
    error_message: null,
    created_at: '2026-04-05T12:00:00Z',
    updated_at: '2026-04-05T12:30:00Z',
    architecture_id: RUN_BOUND_ARCH_ID,
    ...overrides,
  };
}

function makeApprovedCandidates(): DiscoveryCandidateDto[] {
  return [
    {
      id: 'cand-A',
      run_id: 'run-100',
      candidate_type: 'application',
      name: 'OrderService',
      confidence: 0.85,
      status: 'proposed',
      source_cluster_ids: ['cluster-1'],
      data: {},
      synthesized_at: '2026-04-05T12:10:00Z',
      parent_candidate_id: null,
      review_status: 'approved',
      reviewed_by: 'alice',
      reviewed_at: '2026-04-05T12:20:00Z',
      previous_review_status: 'pending_review',
    },
    {
      id: 'cand-B',
      run_id: 'run-100',
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
      reviewed_at: '2026-04-05T12:21:00Z',
      previous_review_status: 'pending_review',
    },
  ];
}

// ============================================================================
// Component (lazy import after mocks)
// ============================================================================

let DiscoveryRunDetailPage: React.FC;

beforeEach(async () => {
  vi.clearAllMocks();
  mockGetDiscoveryRuns.mockReset();
  mockGetDiscoveryRun.mockReset();
  mockGetDiscoveryCandidateCount.mockReset();
  mockGetDiscoveryCandidates.mockReset();
  mockSaveApprovedCandidates.mockReset();
  mockReviewCandidate.mockReset();

  const mod = await import('../DiscoveryRunDetailPage');
  DiscoveryRunDetailPage = mod.DiscoveryRunDetailPage;
});

// ============================================================================
// Helper: drive the view to the point where Save All Approved is visible
// ============================================================================

async function openRunWithApprovedCandidates(): Promise<void> {
  const run = makeRun();
  const candidates = makeApprovedCandidates();

  mockGetDiscoveryRuns.mockResolvedValueOnce([run]);
  mockGetDiscoveryRun.mockResolvedValueOnce(run);
  mockGetDiscoveryCandidateCount.mockResolvedValueOnce({ count: candidates.length });
  mockGetDiscoveryCandidates.mockResolvedValueOnce(candidates);

  renderDiscoveryRunDetailPage(DiscoveryRunDetailPage, { runId: run.id });

  // Wait for detail panel (URL drives selection directly).
  await waitFor(() => {
    expect(screen.getByTestId('run-detail-panel')).toBeInTheDocument();
  });

  // Wait for the candidates table -- the Save All Approved button
  // should also be visible (we have 2 approved candidates auto-loaded
  // on the default Candidates tab).
  await waitFor(() => {
    expect(screen.getByTestId('save-approved-button')).toBeInTheDocument();
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('DiscoveryRunDetailView <-> SaveBackConfirmModal wiring (Task 8.1)', () => {
  // --------------------------------------------------------------------------
  // Test 1: safety property (e) -- "Save All Approved" alone does NOT fire
  // the API. It opens the modal; only the modal's Confirm fires the save.
  // --------------------------------------------------------------------------
  it('safety property (e): clicking Save All Approved opens the modal but does NOT fire saveApprovedCandidates', async () => {
    await openRunWithApprovedCandidates();

    // Modal should NOT be in the DOM yet.
    expect(screen.queryByTestId('save-back-confirm-modal')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('save-approved-button'));

    // Modal opens.
    expect(screen.getByTestId('save-back-confirm-modal')).toBeInTheDocument();

    // CRITICAL: the API is NOT yet called -- the modal is the gate.
    expect(mockSaveApprovedCandidates).not.toHaveBeenCalled();

    // Cancel out -- still no API call.
    fireEvent.click(screen.getByTestId('save-back-confirm-cancel'));
    await waitFor(() => {
      expect(screen.queryByTestId('save-back-confirm-modal')).not.toBeInTheDocument();
    });
    expect(mockSaveApprovedCandidates).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Test 2: safety property (d) -- the save call uses the run's BOUND
  // architecture_id, not the URL active architecture id (they differ in
  // this fixture, so the assertion is meaningful).
  // --------------------------------------------------------------------------
  it('safety property (d): on Confirm, saveApprovedCandidates is called with selectedRun.architecture_id (the run-bound id), NOT useActiveArchitectureId()', async () => {
    await openRunWithApprovedCandidates();

    // Open the modal.
    fireEvent.click(screen.getByTestId('save-approved-button'));
    expect(screen.getByTestId('save-back-confirm-modal')).toBeInTheDocument();

    // Modal copy should mention the run's bound architecture by name
    // (resolved via ArchitectureContext, NOT the URL active arch). The
    // run is bound to "Run Was Bound To"; the URL active is "Currently
    // Viewing". The modal must show the BOUND name.
    expect(screen.getByTestId('save-back-confirm-message')).toHaveTextContent(
      "architecture 'Run Was Bound To'"
    );
    expect(screen.getByTestId('save-back-confirm-message')).not.toHaveTextContent(
      'Currently Viewing'
    );

    // Set up the save to resolve so the modal closes cleanly.
    mockSaveApprovedCandidates.mockResolvedValueOnce({
      entitiesCreated: 2,
      entitiesSkipped: 0,
      candidatesCommitted: 2,
    });
    // Hotfix Bug 2: after the save the parent now refetches THREE streams
    // in parallel (candidates, runs list, selected-run detail + count).
    // Provide a second-call resolution for each so the post-save UX
    // doesn't crash on an `undefined` payload. The candidate list comes
    // back empty (no more approved) so the Save button hides cleanly.
    const refreshedRun = makeRun(); // same shape; in production the server may have updated metadata
    mockGetDiscoveryCandidates.mockResolvedValueOnce([]);
    mockGetDiscoveryRuns.mockResolvedValueOnce([refreshedRun]);
    mockGetDiscoveryRun.mockResolvedValueOnce(refreshedRun);
    mockGetDiscoveryCandidateCount.mockResolvedValueOnce({ count: 0 });

    await act(async () => {
      fireEvent.click(screen.getByTestId('save-back-confirm-confirm'));
    });

    await waitFor(() => {
      expect(mockSaveApprovedCandidates).toHaveBeenCalledTimes(1);
    });

    // CRITICAL ASSERTION: the architectureId arg is the run's BOUND id,
    // not the URL active id. The two are intentionally different in
    // this fixture so the assertion proves the wiring.
    expect(mockSaveApprovedCandidates).toHaveBeenCalledWith(
      'proj-1',
      RUN_BOUND_ARCH_ID, // <-- the run's bound id (selectedRun.architecture_id)
      'run-100'
    );
    // Sanity: the URL active id is NOT what we sent. If a future change
    // accidentally swaps these back, this assertion will catch it.
    expect(mockSaveApprovedCandidates).not.toHaveBeenCalledWith(
      'proj-1',
      URL_ACTIVE_ARCH_ID,
      'run-100'
    );
  });
});
