/**
 * Candidate Review and Approval Workflow Tests
 *
 * Spec: Candidate Review and Approval Workflow (Increment 13)
 * Task Group 5, Task 5.1: 6 focused tests for frontend review workflow
 *
 * Tests:
 * 1. reviewCandidate() sends PATCH request with correct URL and body
 * 2. saveApprovedCandidates() sends POST request with correct URL
 * 3. DiscoveryCandidateTable renders action buttons (Approve, Reject, Defer) per row
 * 4. Clicking Approve calls reviewCandidate() with review_status = 'approved'
 * 5. Filter bar filters candidates by review_status when a filter chip is clicked
 * 6. "Save All Approved" button is visible when at least one candidate has review_status === 'approved'
 *
 * Mocks: global.fetch (for API tests), discoveryApi (for component tests)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { DiscoveryCandidateDto } from '../../../api/discoveryApi';
import { renderDiscoveryRunDetailPage } from './_discoveryRunDetailPageHarness';

// ============================================================================
// Mock setup for component tests
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
// Test helpers
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

describe('Candidate Review and Approval Workflow (Task Group 5)', () => {

  // --------------------------------------------------------------------------
  // Test 1: reviewCandidate() sends PATCH request with correct URL and body
  // --------------------------------------------------------------------------
  it('Test 1: reviewCandidate() sends PATCH request with correct URL and body', async () => {
    // This test uses the real function from discoveryApi, not the mock.
    // We need to test the actual fetch call, so we mock global.fetch directly.
    const originalFetch = global.fetch;
    const mockFetch = vi.fn();

    const updatedCandidate: DiscoveryCandidateDto = {
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
      review_status: 'approved',
      reviewed_by: 'alice',
      reviewed_at: '2026-04-05T13:00:00Z',
      previous_review_status: 'pending_review',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(updatedCandidate),
    });

    global.fetch = mockFetch;

    try {
      // Import the real function (not mocked) by using dynamic import with a cache-busting approach
      // Since vi.mock hoists, we need to use the actual module. We'll call through the mock instead.
      // For this test, we directly call fetch to verify the pattern.
      const { reviewCandidate: realReviewCandidate } = await vi.importActual<typeof import('../../../api/discoveryApi')>('../../../api/discoveryApi');

      const result = await realReviewCandidate('proj-1', 'arch-uuid-default', 'run-002', 'cand-001', 'approved', 'alice');

      // Verify fetch was called with correct URL and body
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('/api/v1/discovery/projects/proj-1/architectures/arch-uuid-default/runs/run-002/candidates/cand-001/review');
      expect(options.method).toBe('PATCH');
      expect(JSON.parse(options.body)).toEqual({
        review_status: 'approved',
        reviewed_by: 'alice',
      });
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(result).toEqual(updatedCandidate);
    } finally {
      global.fetch = originalFetch;
    }
  });

  // --------------------------------------------------------------------------
  // Test 2: saveApprovedCandidates() sends POST request with correct URL
  // --------------------------------------------------------------------------
  it('Test 2: saveApprovedCandidates() sends POST request with correct URL', async () => {
    const originalFetch = global.fetch;
    const mockFetch = vi.fn();

    const saveResult = { entitiesCreated: 3, entitiesSkipped: 1, candidatesCommitted: 3 };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(saveResult),
    });

    global.fetch = mockFetch;

    try {
      const { saveApprovedCandidates: realSaveApproved } = await vi.importActual<typeof import('../../../api/discoveryApi')>('../../../api/discoveryApi');

      const result = await realSaveApproved('proj-1', 'arch-uuid-default', 'run-002');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('/api/v1/discovery/projects/proj-1/architectures/arch-uuid-default/runs/run-002/save-approved');
      expect(options.method).toBe('POST');
      expect(result).toEqual(saveResult);
    } finally {
      global.fetch = originalFetch;
    }
  });

  // --------------------------------------------------------------------------
  // Test 3: DiscoveryCandidateTable renders action buttons per row
  // --------------------------------------------------------------------------
  it('Test 3: DiscoveryCandidateTable renders action buttons (Approve, Reject, Defer) per row', () => {
    const candidates = makeCandidates();
    const onCandidatesChange = vi.fn();

    render(
      <DiscoveryCandidateTable
        projectId="proj-1"
        architectureId="arch-uuid-default"
        runId="run-002"
        candidates={candidates}
        onCandidatesChange={onCandidatesChange}
      />
    );

    // Should render 3 candidate rows
    const rows = screen.getAllByTestId('candidate-row');
    expect(rows).toHaveLength(3);

    // Each row should have Approve, Reject, Defer buttons
    const approveButtons = screen.getAllByTestId('action-approve');
    const rejectButtons = screen.getAllByTestId('action-reject');
    const deferButtons = screen.getAllByTestId('action-defer');

    expect(approveButtons).toHaveLength(3);
    expect(rejectButtons).toHaveLength(3);
    expect(deferButtons).toHaveLength(3);

    // Buttons matching current status should be disabled
    // cand-001 is pending_review -> all buttons enabled
    expect(approveButtons[0]).not.toBeDisabled();
    expect(rejectButtons[0]).not.toBeDisabled();
    expect(deferButtons[0]).not.toBeDisabled();

    // cand-002 is approved -> Approve button disabled
    expect(approveButtons[1]).toBeDisabled();
    expect(rejectButtons[1]).not.toBeDisabled();

    // cand-003 is rejected -> Reject button disabled
    expect(rejectButtons[2]).toBeDisabled();
    expect(approveButtons[2]).not.toBeDisabled();
  });

  // --------------------------------------------------------------------------
  // Test 4: Clicking Approve calls reviewCandidate with review_status = 'approved'
  // --------------------------------------------------------------------------
  it('Test 4: clicking Approve calls reviewCandidate() with review_status = approved', async () => {
    const candidates = makeCandidates();
    const onCandidatesChange = vi.fn();

    // Mock reviewCandidate to return updated candidate
    const updatedCandidate = { ...candidates[0], review_status: 'approved', reviewed_by: 'anonymous' };
    mockReviewCandidate.mockResolvedValueOnce(updatedCandidate);

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

    // Should call reviewCandidate with correct params
    expect(mockReviewCandidate).toHaveBeenCalledTimes(1);
    expect(mockReviewCandidate).toHaveBeenCalledWith('proj-1', 'arch-uuid-default', 'run-002', 'cand-001', 'approved');

    // Optimistic update should have been called immediately
    expect(onCandidatesChange).toHaveBeenCalled();
    const optimisticCall = onCandidatesChange.mock.calls[0][0];
    expect(optimisticCall[0].review_status).toBe('approved');
  });

  // --------------------------------------------------------------------------
  // Test 5: Filter bar filters candidates by review_status when clicked
  // --------------------------------------------------------------------------
  it('Test 5: filter bar filters candidates by review_status when a filter chip is clicked', () => {
    const candidates = makeCandidates();
    // candidates[0]: pending_review, candidates[1]: approved, candidates[2]: rejected
    const onCandidatesChange = vi.fn();

    render(
      <DiscoveryCandidateTable
        projectId="proj-1"
        architectureId="arch-uuid-default"
        runId="run-002"
        candidates={candidates}
        onCandidatesChange={onCandidatesChange}
      />
    );

    // Initially (no filter), all 3 candidates visible
    expect(screen.getAllByTestId('candidate-row')).toHaveLength(3);
    expect(screen.getByTestId('candidate-count-summary')).toHaveTextContent('3 candidates');

    // The filter chips were replaced by the per-column Review Status select.
    // Select "approved"
    fireEvent.change(screen.getByTestId('filter-review-status'), {
      target: { value: 'approved' },
    });

    // Only approved candidate should be visible
    const filteredRows = screen.getAllByTestId('candidate-row');
    expect(filteredRows).toHaveLength(1);
    expect(filteredRows[0]).toHaveTextContent('PaymentProcessor');

    // Select "pending_review"
    fireEvent.change(screen.getByTestId('filter-review-status'), {
      target: { value: 'pending_review' },
    });

    // Only pending candidate should be visible
    const pendingRows = screen.getAllByTestId('candidate-row');
    expect(pendingRows).toHaveLength(1);
    expect(pendingRows[0]).toHaveTextContent('OrderService');

    // Reset to All (empty value)
    fireEvent.change(screen.getByTestId('filter-review-status'), {
      target: { value: '' },
    });
    expect(screen.getAllByTestId('candidate-row')).toHaveLength(3);
  });

  // --------------------------------------------------------------------------
  // Test 6: "Save All Approved" button visible when approved candidates exist
  // --------------------------------------------------------------------------
  it('Test 6: Save All Approved button is visible when at least one candidate has review_status === approved', async () => {
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
      },
    ];

    const candidatesWithApproved = makeCandidates();
    // candidatesWithApproved[1] has review_status === 'approved'

    mockGetDiscoveryRuns.mockResolvedValueOnce(sampleRuns);
    mockGetDiscoveryRun.mockResolvedValueOnce(sampleRuns[0]);
    mockGetDiscoveryCandidateCount.mockResolvedValueOnce({ count: 3 });
    mockGetDiscoveryCandidates.mockResolvedValueOnce(candidatesWithApproved);

    renderDiscoveryRunDetailPage(DiscoveryRunDetailPage, { runId: sampleRuns[0].id });

    // Wait for detail panel
    await waitFor(() => {
      expect(screen.getByTestId('run-detail-panel')).toBeInTheDocument();
    });

    // Wait for candidates to load and table to render (Candidates tab is default).
    await waitFor(() => {
      expect(screen.getByTestId('candidate-table')).toBeInTheDocument();
    });

    // The Save All Approved button should be visible since cand-002 is approved
    expect(screen.getByTestId('save-approved-button')).toBeInTheDocument();
    expect(screen.getByTestId('save-approved-button')).toHaveTextContent('Save All Approved');
  });
});
