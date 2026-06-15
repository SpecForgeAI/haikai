/**
 * Gap-Fill Integration Tests for Discovery Run Detail and Candidate Table
 *
 * Spec: Discovery Results Visibility (Increment 12)
 * Task Group 7: Test Review and Gap Analysis (Task 7.3)
 *
 * Updated for Increment 13 (Candidate Review and Approval Workflow):
 * - DiscoveryCandidateTable now receives candidates as props (fetching lifted to parent)
 * - Gap 3 updated: candidate fetch error is now shown from DiscoveryRunDetailView
 * - DiscoveryCandidateDto includes review fields
 *
 * These tests fill coverage gaps identified in the Task Group 7 review:
 * - "View Candidates" button flow: clicking opens the candidate table within run detail
 * - Empty runs list shows "No discovery runs found" message in detail view
 * - Candidate fetch error shows error message (tested via DiscoveryRunDetailView)
 *
 * Mocks: discoveryApi (getDiscoveryRuns, getDiscoveryRun, getDiscoveryCandidateCount, getDiscoveryCandidates)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import type {
  DiscoveryRunDto,
  DiscoveryCandidateDto,
} from '../../../api/discoveryApi';
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
// Sample fixtures
// ============================================================================

const completedRun: DiscoveryRunDto = {
  id: 'run-002',
  project_id: 'proj-1',
  status: 'COMPLETED',
  current_step: null,
  config_snapshot: null,
  steps_payload: { phase_1a: 'completed', phase_1b: 'completed', phase_1c: 'completed', phase_1d: 'completed' },
  error_message: null,
  created_at: '2026-04-05T12:00:00Z',
  updated_at: '2026-04-05T12:30:00Z',
};

const sampleCandidates: DiscoveryCandidateDto[] = [
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
    status: 'accepted',
    source_cluster_ids: ['cluster-2'],
    data: {},
    synthesized_at: '2026-04-05T12:11:00Z',
    parent_candidate_id: 'cand-001',
    review_status: 'pending_review',
    reviewed_by: null,
    reviewed_at: null,
    previous_review_status: null,
  },
];

// ============================================================================
// Test helpers
// ============================================================================

let DiscoveryRunDetailPage: React.FC;

beforeEach(async () => {
  vi.clearAllMocks();
  mockGetDiscoveryRuns.mockReset();
  mockGetDiscoveryRun.mockReset();
  mockGetDiscoveryCandidateCount.mockReset();
  mockGetDiscoveryCandidates.mockReset();
  mockReviewCandidate.mockReset();
  mockSaveApprovedCandidates.mockReset();

  const detailMod = await import('../DiscoveryRunDetailPage');
  DiscoveryRunDetailPage = detailMod.DiscoveryRunDetailPage;
});

// ============================================================================
// Tests
// ============================================================================

describe('Discovery Integration Gap-Fill Tests (Task Group 7)', () => {

  // --------------------------------------------------------------------------
  // Gap 1: "View Candidates" button opens the candidate table within run detail
  // --------------------------------------------------------------------------
  it('candidate table loads for the selected run (Candidates tab is the default)', async () => {
    mockGetDiscoveryRuns.mockResolvedValueOnce([completedRun]);
    mockGetDiscoveryRun.mockResolvedValueOnce(completedRun);
    mockGetDiscoveryCandidateCount.mockResolvedValueOnce({ count: 2 });
    mockGetDiscoveryCandidates.mockResolvedValueOnce(sampleCandidates);

    renderDiscoveryRunDetailPage(DiscoveryRunDetailPage, { runId: completedRun.id });

    // Wait for detail panel
    await waitFor(() => {
      expect(screen.getByTestId('run-detail-panel')).toBeInTheDocument();
    });

    // Candidate table should appear with the correct data (auto-fetched).
    await waitFor(() => {
      expect(screen.getByTestId('candidate-table')).toBeInTheDocument();
    });

    // Verify candidate data is rendered
    const rows = screen.getAllByTestId('candidate-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('OrderService');
    expect(rows[1]).toHaveTextContent('PaymentProcessor');
  });

  // --------------------------------------------------------------------------
  // Gap 2: Empty runs list shows "No discovery runs found" in detail view
  // --------------------------------------------------------------------------
  it('shows "No discovery runs found" message when runs list is empty', async () => {
    mockGetDiscoveryRuns.mockResolvedValueOnce([]);
    // The URL still resolves a runId; the detail fetch returns null so no
    // detail panel renders. We only assert the empty-runs message here.
    mockGetDiscoveryRun.mockRejectedValueOnce(new Error('not found'));
    mockGetDiscoveryCandidateCount.mockResolvedValueOnce({ count: 0 });
    mockGetDiscoveryCandidates.mockResolvedValueOnce([]);

    renderDiscoveryRunDetailPage(DiscoveryRunDetailPage, { runId: 'no-such-run' });

    // Wait for loading to finish
    await waitFor(() => {
      expect(screen.getByTestId('empty-runs-message')).toBeInTheDocument();
    });

    // Run list should not be present
    expect(screen.queryByTestId('run-list')).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Gap 3: Candidate fetch error shows error message (via DiscoveryRunDetailView)
  // --------------------------------------------------------------------------
  it('candidate fetch error shows error message in run detail view', async () => {
    mockGetDiscoveryRuns.mockResolvedValueOnce([completedRun]);
    mockGetDiscoveryRun.mockResolvedValueOnce(completedRun);
    mockGetDiscoveryCandidateCount.mockResolvedValueOnce({ count: 2 });
    mockGetDiscoveryCandidates.mockRejectedValueOnce(new Error('Connection refused'));

    renderDiscoveryRunDetailPage(DiscoveryRunDetailPage, { runId: completedRun.id });

    // Wait for detail panel
    await waitFor(() => {
      expect(screen.getByTestId('run-detail-panel')).toBeInTheDocument();
    });

    // Wait for error to appear (candidates auto-fetched on Candidates tab).
    await waitFor(() => {
      expect(screen.getByTestId('candidate-table-error')).toBeInTheDocument();
    });

    expect(screen.getByTestId('candidate-table-error')).toHaveTextContent('Connection refused');

    // Table should NOT be present
    expect(screen.queryByTestId('candidate-table')).not.toBeInTheDocument();
  });
});
