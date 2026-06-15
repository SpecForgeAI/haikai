/**
 * Discovery Run Detail View and Candidate Listing Tests
 *
 * Spec: Discovery Results Visibility (Increment 12)
 * Task Group 5, Task 5.1: 6 focused tests for run detail and candidate listing.
 *
 * Updated for Increment 13 (Candidate Review and Approval Workflow):
 * - DiscoveryCandidateTable now receives candidates and onCandidatesChange as props
 * - DiscoveryCandidateDto includes review fields (review_status, reviewed_by, etc.)
 *
 * Tests:
 * 1. Run detail view renders a list of historical runs (most recent first) with status and date
 * 2. Selecting a run displays its detail: current_step, steps_payload phases, error_message, and candidate count
 * 3. Candidate listing table renders rows with name, candidate_type, confidence, status, and synthesized_at
 * 4. Candidate rows with a parent_candidate_id display a visual parent reference (label)
 * 5. Back/close affordance returns to the normal Dashboard layout
 * 6. Empty candidate list shows a "No candidates" message
 *
 * Mocks: discoveryApi (getDiscoveryRuns, getDiscoveryRun, getDiscoveryCandidateCount, getDiscoveryCandidates)
 */

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

const sampleRuns: DiscoveryRunDto[] = [
  {
    id: 'run-002',
    project_id: 'proj-1',
    status: 'COMPLETED',
    current_step: null,
    config_snapshot: null,
    steps_payload: { phase_1a: 'completed', phase_1b: 'completed', phase_1c: 'completed', phase_1d: 'completed' },
    error_message: null,
    created_at: '2026-04-05T12:00:00Z',
    updated_at: '2026-04-05T12:30:00Z',
  },
  {
    id: 'run-001',
    project_id: 'proj-1',
    status: 'FAILED',
    current_step: 'phase_1b',
    config_snapshot: null,
    steps_payload: { phase_1a: 'completed', phase_1b: 'failed' },
    error_message: 'Timeout during clustering',
    created_at: '2026-04-04T10:00:00Z',
    updated_at: '2026-04-04T10:15:00Z',
  },
];

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

describe('Discovery Run Detail View and Candidate Listing (Task Group 5)', () => {

  // --------------------------------------------------------------------------
  // Test 1: Run detail view renders a list of historical runs with status and date
  // --------------------------------------------------------------------------
  it('Test 1: renders a list of historical runs with status and date', async () => {
    mockGetDiscoveryRuns.mockResolvedValueOnce(sampleRuns);
    mockGetDiscoveryRun.mockResolvedValueOnce(sampleRuns[0]);
    mockGetDiscoveryCandidateCount.mockResolvedValueOnce({ count: 0 });
    mockGetDiscoveryCandidates.mockResolvedValueOnce([]);

    renderDiscoveryRunDetailPage(DiscoveryRunDetailPage, { runId: 'run-002' });

    // Wait for runs to load
    await waitFor(() => {
      expect(screen.getByTestId('run-list')).toBeInTheDocument();
    });

    // Should render 2 run list items
    const runItems = screen.getAllByTestId('run-list-item');
    expect(runItems).toHaveLength(2);

    // First run should show COMPLETED status
    expect(runItems[0]).toHaveTextContent('COMPLETED');

    // Second run should show FAILED status
    expect(runItems[1]).toHaveTextContent('FAILED');

    // Both should display dates
    // Dates are formatted via toLocaleString, so just verify something is rendered
    expect(runItems[0].textContent).toContain('2026');
    expect(runItems[1].textContent).toContain('2026');
  });

  // --------------------------------------------------------------------------
  // Test 2: Selecting a run displays its detail (current_step, phases, error, counts)
  // --------------------------------------------------------------------------
  it('Test 2: selecting a run displays its detail with current_step, phases, error_message, and candidate count', async () => {
    mockGetDiscoveryRuns.mockResolvedValueOnce(sampleRuns);

    // When run-001 (FAILED) is selected via URL:
    mockGetDiscoveryRun.mockResolvedValueOnce(sampleRuns[1]); // run-001 FAILED
    mockGetDiscoveryCandidateCount.mockResolvedValueOnce({ count: 3 });
    mockGetDiscoveryCandidates.mockResolvedValueOnce([]);

    renderDiscoveryRunDetailPage(DiscoveryRunDetailPage, { runId: 'run-001' });

    // Wait for detail panel to appear (URL drives the selection directly)
    await waitFor(() => {
      expect(screen.getByTestId('run-detail-panel')).toBeInTheDocument();
    });

    // Verify current_step is shown
    expect(screen.getByTestId('run-current-step')).toHaveTextContent('phase_1b');

    // Verify phases from steps_payload
    const phaseList = screen.getByTestId('phase-list');
    expect(phaseList).toHaveTextContent('phase_1a');
    expect(phaseList).toHaveTextContent('completed');
    expect(phaseList).toHaveTextContent('phase_1b');
    expect(phaseList).toHaveTextContent('failed');

    // Verify error message for FAILED run
    expect(screen.getByTestId('run-error-message')).toHaveTextContent('Timeout during clustering');

    // Verify candidate count
    expect(screen.getByTestId('run-candidate-count')).toHaveTextContent('3');
  });

  // --------------------------------------------------------------------------
  // Test 3: Candidate table renders rows with name, type, confidence, status, synthesized_at
  // --------------------------------------------------------------------------
  it('Test 3: candidate table renders rows with name, type, confidence, status, and synthesized_at', () => {
    const onCandidatesChange = vi.fn();

    render(
      <DiscoveryCandidateTable
        projectId="proj-1"
        architectureId="arch-uuid-default"
        runId="run-002"
        candidates={sampleCandidates}
        onCandidatesChange={onCandidatesChange}
      />
    );

    // Table should be rendered immediately (no async fetch, candidates are props)
    expect(screen.getByTestId('candidate-table')).toBeInTheDocument();

    // Should have 3 rows
    const rows = screen.getAllByTestId('candidate-row');
    expect(rows).toHaveLength(3);

    // Verify first candidate data
    expect(rows[0]).toHaveTextContent('OrderService');
    expect(rows[0]).toHaveTextContent('application');
    expect(rows[0]).toHaveTextContent('85%');
    expect(rows[0]).toHaveTextContent('pending_review');

    // Verify second candidate data
    expect(rows[1]).toHaveTextContent('PaymentProcessor');
    expect(rows[1]).toHaveTextContent('service');
    expect(rows[1]).toHaveTextContent('72%');

    // Verify third candidate data
    expect(rows[2]).toHaveTextContent('OrderDatabase');
    expect(rows[2]).toHaveTextContent('data_store');
    expect(rows[2]).toHaveTextContent('91%');
  });

  // --------------------------------------------------------------------------
  // Test 4: Candidate rows with parent_candidate_id display a parent reference
  // --------------------------------------------------------------------------
  it('Test 4: candidate rows with a parent_candidate_id display a visual parent reference', () => {
    const onCandidatesChange = vi.fn();

    render(
      <DiscoveryCandidateTable
        projectId="proj-1"
        architectureId="arch-uuid-default"
        runId="run-002"
        candidates={sampleCandidates}
        onCandidatesChange={onCandidatesChange}
      />
    );

    expect(screen.getByTestId('candidate-table')).toBeInTheDocument();

    // Only one candidate has a parent (cand-002 -> cand-001 "OrderService")
    const parentLabels = screen.getAllByTestId('parent-label');
    expect(parentLabels).toHaveLength(1);

    // Should reference the parent name
    expect(parentLabels[0]).toHaveTextContent('child of OrderService');

    // The child row should have the indentation class
    const rows = screen.getAllByTestId('candidate-row');
    // cand-002 (PaymentProcessor) is the child -- second row
    expect(rows[1].className).toContain('childRow');

    // Non-child rows should NOT have the class
    expect(rows[0].className || '').not.toContain('childRow');
    expect(rows[2].className || '').not.toContain('childRow');
  });

  // --------------------------------------------------------------------------
  // Test 5: Back/close affordance returns to the normal Dashboard layout
  // --------------------------------------------------------------------------
  it('Test 5: back button navigates back to the discovery list', async () => {
    mockGetDiscoveryRuns.mockResolvedValueOnce(sampleRuns);
    mockGetDiscoveryRun.mockResolvedValueOnce(sampleRuns[0]);
    mockGetDiscoveryCandidateCount.mockResolvedValueOnce({ count: 0 });
    mockGetDiscoveryCandidates.mockResolvedValueOnce([]);

    renderDiscoveryRunDetailPage(DiscoveryRunDetailPage, { runId: 'run-002' });

    // Wait for the view to render
    await waitFor(() => {
      expect(screen.getByTestId('discovery-run-detail-view')).toBeInTheDocument();
    });

    // Find and click the Back button (now navigates via React Router).
    const backButton = screen.getByTestId('back-to-dashboard-button');
    expect(backButton).toBeInTheDocument();

    fireEvent.click(backButton);

    // After click, the harness fallback discovery-list route should render.
    await waitFor(() => {
      expect(screen.getByTestId('harness-discovery-list')).toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // Test 6: Empty candidate list shows a "No candidates" message
  // --------------------------------------------------------------------------
  it('Test 6: empty candidate list shows a "No candidates" message', () => {
    const onCandidatesChange = vi.fn();

    render(
      <DiscoveryCandidateTable
        projectId="proj-1"
        architectureId="arch-uuid-default"
        runId="run-002"
        candidates={[]}
        onCandidatesChange={onCandidatesChange}
      />
    );

    expect(screen.getByTestId('candidate-table-empty')).toBeInTheDocument();
    expect(screen.getByTestId('candidate-table-empty')).toHaveTextContent('No candidates found for this run.');
  });
});
