/**
 * Discovery UX Polish Tests
 *
 * Spec: Discovery Refinement, Consolidation, and System Hardening (Increment 16)
 * Task Group 7, Task 7.1: 6 focused tests for UI polish behavior
 *
 * Tests:
 * 1. RUNNING status shows current step name with progress indicator text
 * 2. FAILED status shows error_message with step context in the error banner
 * 3. Empty run list shows descriptive message instead of empty container
 * 4. Empty candidates for a run shows "No candidates generated" message
 * 5. Candidate table filter yielding zero results shows filter-aware empty message
 * 6. Candidate count summary line renders correct breakdown above the table
 *
 * Mocks: discoveryApi (getDiscoveryRuns, getDiscoveryRun, getDiscoveryCandidateCount, getDiscoveryCandidates)
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

function makeRunningRun(): DiscoveryRunDto {
  return {
    id: 'run-running',
    project_id: 'proj-1',
    status: 'RUNNING',
    current_step: '1b',
    config_snapshot: null,
    steps_payload: { '1a': 'completed' },
    error_message: null,
    created_at: '2026-04-06T10:00:00Z',
    updated_at: '2026-04-06T10:05:00Z',
  };
}

function makeFailedRun(): DiscoveryRunDto {
  return {
    id: 'run-failed',
    project_id: 'proj-1',
    status: 'FAILED',
    current_step: '1c',
    config_snapshot: null,
    steps_payload: { '1a': 'completed', '1b': 'completed', '1c': 'failed' },
    error_message: 'Step 1c failed: connection timeout during clustering',
    created_at: '2026-04-06T09:00:00Z',
    updated_at: '2026-04-06T09:10:00Z',
  };
}

function makeMixedCandidates(): DiscoveryCandidateDto[] {
  return [
    {
      id: 'cand-001',
      run_id: 'run-completed',
      candidate_type: 'application',
      name: 'OrderService',
      confidence: 0.85,
      status: 'proposed',
      source_cluster_ids: ['cluster-1'],
      data: {},
      synthesized_at: '2026-04-06T12:10:00Z',
      parent_candidate_id: null,
      review_status: 'approved',
      reviewed_by: 'alice',
      reviewed_at: '2026-04-06T12:20:00Z',
      previous_review_status: 'pending_review',
    },
    {
      id: 'cand-002',
      run_id: 'run-completed',
      candidate_type: 'service',
      name: 'PaymentProcessor',
      confidence: 0.72,
      status: 'proposed',
      source_cluster_ids: ['cluster-2'],
      data: {},
      synthesized_at: '2026-04-06T12:11:00Z',
      parent_candidate_id: null,
      review_status: 'approved',
      reviewed_by: 'alice',
      reviewed_at: '2026-04-06T12:21:00Z',
      previous_review_status: 'pending_review',
    },
    {
      id: 'cand-003',
      run_id: 'run-completed',
      candidate_type: 'data_store',
      name: 'OrderDatabase',
      confidence: 0.91,
      status: 'proposed',
      source_cluster_ids: ['cluster-3'],
      data: {},
      synthesized_at: '2026-04-06T12:12:00Z',
      parent_candidate_id: null,
      review_status: 'rejected',
      reviewed_by: 'bob',
      reviewed_at: '2026-04-06T12:22:00Z',
      previous_review_status: 'pending_review',
    },
    {
      id: 'cand-004',
      run_id: 'run-completed',
      candidate_type: 'service',
      name: 'NotificationService',
      confidence: 0.65,
      status: 'proposed',
      source_cluster_ids: ['cluster-4'],
      data: {},
      synthesized_at: '2026-04-06T12:13:00Z',
      parent_candidate_id: null,
      review_status: 'pending_review',
      reviewed_by: null,
      reviewed_at: null,
      previous_review_status: null,
    },
  ];
}

// ============================================================================
// Test helpers
// ============================================================================

let DiscoveryRunDetailPage: React.FC;
let DiscoveryCandidateTable: React.FC<{
  projectId: string;
  architectureId: string;
  runId: string;
  candidates: DiscoveryCandidateDto[];
  onCandidatesChange: (candidates: DiscoveryCandidateDto[]) => void;
}>;

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
  const tableMod = await import('../DiscoveryCandidateTable');
  DiscoveryCandidateTable = tableMod.DiscoveryCandidateTable;
});

// ============================================================================
// Tests
// ============================================================================

describe('Discovery UX Polish (Task Group 7)', () => {

  // --------------------------------------------------------------------------
  // Test 1: RUNNING status shows current step name with progress indicator text
  // --------------------------------------------------------------------------
  it('Test 1: RUNNING status shows current step name with progress indicator text', async () => {
    const runningRun = makeRunningRun();
    mockGetDiscoveryRuns.mockResolvedValueOnce([runningRun]);
    mockGetDiscoveryRun.mockResolvedValueOnce(runningRun);
    mockGetDiscoveryCandidateCount.mockResolvedValueOnce({ count: 0 });
    mockGetDiscoveryCandidates.mockResolvedValueOnce([]);

    renderDiscoveryRunDetailPage(DiscoveryRunDetailPage, { runId: runningRun.id });

    // Wait for detail panel
    await waitFor(() => {
      expect(screen.getByTestId('run-detail-panel')).toBeInTheDocument();
    });

    // Verify progress indicator is shown with step and count
    const progressIndicator = screen.getByTestId('running-progress-indicator');
    expect(progressIndicator).toBeInTheDocument();
    expect(progressIndicator).toHaveTextContent('Running step 1b of 4...');
  });

  // --------------------------------------------------------------------------
  // Test 2: FAILED status shows error_message with step context in the error banner
  // --------------------------------------------------------------------------
  it('Test 2: FAILED status shows error_message with step context in the error banner', async () => {
    const failedRun = makeFailedRun();
    mockGetDiscoveryRuns.mockResolvedValueOnce([failedRun]);
    mockGetDiscoveryRun.mockResolvedValueOnce(failedRun);
    mockGetDiscoveryCandidateCount.mockResolvedValueOnce({ count: 0 });
    mockGetDiscoveryCandidates.mockResolvedValueOnce([]);

    renderDiscoveryRunDetailPage(DiscoveryRunDetailPage, { runId: failedRun.id });

    // Wait for detail panel
    await waitFor(() => {
      expect(screen.getByTestId('run-detail-panel')).toBeInTheDocument();
    });

    // Verify error message is shown with step context
    const errorMessage = screen.getByTestId('run-error-message');
    expect(errorMessage).toBeInTheDocument();
    expect(errorMessage).toHaveTextContent('Step 1c failed: connection timeout during clustering');

    // Verify it uses the errorMessage CSS class
    expect(errorMessage.className).toContain('errorMessage');
  });

  // --------------------------------------------------------------------------
  // Test 3: Empty run list shows descriptive message instead of empty container
  // --------------------------------------------------------------------------
  it('Test 3: empty run list shows descriptive message instead of empty container', async () => {
    mockGetDiscoveryRuns.mockResolvedValueOnce([]);
    mockGetDiscoveryRun.mockRejectedValueOnce(new Error('not found'));
    mockGetDiscoveryCandidateCount.mockResolvedValueOnce({ count: 0 });
    mockGetDiscoveryCandidates.mockResolvedValueOnce([]);

    renderDiscoveryRunDetailPage(DiscoveryRunDetailPage, { runId: 'no-such-run' });

    // Wait for loading to finish
    await waitFor(() => {
      expect(screen.getByTestId('empty-runs-message')).toBeInTheDocument();
    });

    // Verify the descriptive message
    expect(screen.getByTestId('empty-runs-message')).toHaveTextContent(
      'No discovery runs found for this project. Start a new run to begin analyzing your codebase.'
    );

    // Verify that no run-list is rendered
    expect(screen.queryByTestId('run-list')).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 4: Empty candidates for a run shows "No candidates generated" message
  // --------------------------------------------------------------------------
  it('Test 4: empty candidates for a run shows "No candidates generated for this run." message', async () => {
    const completedRun: DiscoveryRunDto = {
      id: 'run-completed',
      project_id: 'proj-1',
      status: 'COMPLETED',
      current_step: null,
      config_snapshot: null,
      steps_payload: { '1a': 'completed', '1b': 'completed', '1c': 'completed', '1d': 'completed' },
      error_message: null,
      created_at: '2026-04-06T12:00:00Z',
      updated_at: '2026-04-06T12:30:00Z',
    };

    mockGetDiscoveryRuns.mockResolvedValueOnce([completedRun]);
    mockGetDiscoveryRun.mockResolvedValueOnce(completedRun);
    mockGetDiscoveryCandidateCount.mockResolvedValueOnce({ count: 0 });
    mockGetDiscoveryCandidates.mockResolvedValueOnce([]);

    renderDiscoveryRunDetailPage(DiscoveryRunDetailPage, { runId: completedRun.id });

    // Wait for detail panel
    await waitFor(() => {
      expect(screen.getByTestId('run-detail-panel')).toBeInTheDocument();
    });

    // Wait for candidates to load (empty result; Candidates tab is default).
    await waitFor(() => {
      expect(screen.getByTestId('empty-candidates-message')).toBeInTheDocument();
    });

    expect(screen.getByTestId('empty-candidates-message')).toHaveTextContent(
      'No candidates generated for this run.'
    );
  });

  // --------------------------------------------------------------------------
  // Test 5: Candidate table filter yielding zero results shows filter-aware empty message
  // --------------------------------------------------------------------------
  it('Test 5: candidate table filter yielding zero results shows filter-aware empty message', () => {
    const candidates = makeMixedCandidates();
    // candidates: 2 approved, 1 rejected, 1 pending_review, 0 deferred
    const onCandidatesChange = vi.fn();

    render(
      <DiscoveryCandidateTable
        projectId="proj-1"
        architectureId="arch-uuid-default"
        runId="run-completed"
        candidates={candidates}
        onCandidatesChange={onCandidatesChange}
      />
    );

    // Filter chips were replaced by the per-column filter row: type a name
    // that matches no candidate.
    fireEvent.change(screen.getByTestId('filter-name'), {
      target: { value: 'zzz-no-match' },
    });

    // Verify the filter-aware empty message appears as a table-body row
    expect(screen.getByText('No candidates match the current filters')).toBeInTheDocument();

    // The table itself stays mounted (the empty message is a body row) and
    // the count summary reflects the zero-of-N filtered state.
    expect(screen.getByTestId('candidate-table')).toBeInTheDocument();
    expect(screen.getByTestId('candidate-count-summary')).toHaveTextContent(
      'Showing 0 of 4 candidates'
    );
    expect(screen.queryAllByTestId('candidate-row')).toHaveLength(0);
  });

  // --------------------------------------------------------------------------
  // Test 6: Candidate count summary line renders correct breakdown above the table
  // --------------------------------------------------------------------------
  it('Test 6: candidate count summary line renders correct breakdown above the table', () => {
    const candidates = makeMixedCandidates();
    // 4 candidates total: 2 approved, 1 rejected, 1 pending
    const onCandidatesChange = vi.fn();

    render(
      <DiscoveryCandidateTable
        projectId="proj-1"
        architectureId="arch-uuid-default"
        runId="run-completed"
        candidates={candidates}
        onCandidatesChange={onCandidatesChange}
      />
    );

    // Verify count summary line is rendered. The per-status breakdown was
    // replaced by a simple total (plus "Showing X of Y" when filters are
    // active) when the filter chips became per-column filters.
    const summaryLine = screen.getByTestId('candidate-count-summary');
    expect(summaryLine).toBeInTheDocument();
    expect(summaryLine).toHaveTextContent('4 candidates');
  });
});
