/**
 * DiscoveryRunDetailView -- library-scans hierarchical sub-row rendering tests
 *
 * Spec 2026-05-06: Library Discovery Integration -- Task Group 8
 *
 * Confirms that the existing `phaseList` rendering walks the new
 * `library-scans` sub-array of the `service-scoped-llm-analysis` step
 * entry and emits indented sub-rows with per-row status badges. Also
 * verifies the "Pending libraries: N" counter and that skip badges
 * render with the expected status text.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import type { DiscoveryRunDto } from '../../../api/discoveryApi';
import { renderDiscoveryRunDetailPage } from './_discoveryRunDetailPageHarness';

// ============================================================================
// Mocks
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
}));

// Identity-mapping CSS module so class names == property names.
vi.mock('../DiscoveryRunDetailView.module.css', () => ({
  default: new Proxy({}, {
    get: (_t: object, prop: string | symbol) => String(prop),
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

function makeRun(libraryScans: unknown[]): DiscoveryRunDto {
  return {
    id: 'run-libscope-1',
    project_id: 'proj-1',
    architecture_id: 'arch-uuid-default',
    status: 'RUNNING',
    current_step: 'service-scoped-llm-analysis',
    config_snapshot: null,
    steps_payload: {
      'service-scoped-llm-analysis': {
        status: 'running',
        'library-scans': libraryScans,
      },
    } as unknown as Record<string, string>,
    error_message: null,
    created_at: '2026-05-06T12:00:00Z',
    updated_at: '2026-05-06T12:30:00Z',
  } as DiscoveryRunDto;
}

const sampleLibraryScans = [
  {
    library_id: 'lib-a',
    library_name: 'com.example:lib-a',
    depth: 1,
    status: 'completed',
    files_analyzed: 42,
    candidate_count: 7,
  },
  {
    library_id: 'lib-b',
    library_name: 'com.example:lib-b',
    depth: 2,
    status: 'running',
    files_analyzed: 0,
    candidate_count: 0,
  },
  {
    library_id: 'lib-c',
    library_name: 'com.example:lib-c',
    depth: 2,
    status: 'pending',
  },
  {
    library_id: 'lib-d',
    library_name: 'com.example:lib-d',
    depth: 3,
    status: 'skipped-cycle',
  },
  {
    library_id: 'lib-e',
    library_name: 'com.example:lib-e',
    depth: 5,
    status: 'skipped-depth-cap',
  },
];

// ============================================================================
// Tests
// ============================================================================

describe('DiscoveryRunDetailView -- library-scans (Spec 2026-05-06, Task Group 8)', () => {
  let DiscoveryRunDetailPage: React.FC;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetDiscoveryRuns.mockReset();
    mockGetDiscoveryRun.mockReset();
    mockGetDiscoveryCandidateCount.mockReset();
    mockGetDiscoveryCandidates.mockReset();
    mockGetDiscoveryCandidates.mockResolvedValue([]);

    const mod = await import('../DiscoveryRunDetailPage');
    DiscoveryRunDetailPage = mod.DiscoveryRunDetailPage;
  });

  it('renders library-scan sub-rows indented under the parent step entry', async () => {
    const run = makeRun(sampleLibraryScans);
    mockGetDiscoveryRuns.mockResolvedValueOnce([run]);
    mockGetDiscoveryRun.mockResolvedValueOnce(run);
    mockGetDiscoveryCandidateCount.mockResolvedValueOnce({ count: 7 });

    renderDiscoveryRunDetailPage(DiscoveryRunDetailPage, { runId: run.id });

    await waitFor(() => {
      expect(screen.getByTestId('phase-item-with-library-scans')).toBeInTheDocument();
    });

    // The library-scans sub-list should render 5 rows.
    const subList = screen.getByTestId('library-scans-sublist');
    expect(subList).toBeInTheDocument();
    const rows = screen.getAllByTestId('library-scan-row');
    expect(rows).toHaveLength(5);

    // Verify a couple of fields on the first row.
    expect(rows[0]).toHaveTextContent('com.example:lib-a');
    expect(rows[0]).toHaveTextContent('depth 1');
    expect(rows[0]).toHaveTextContent('completed');
    expect(rows[0]).toHaveTextContent('files 42');
    expect(rows[0]).toHaveTextContent('candidates 7');
  });

  it('decrements the pending counter as libraries move from pending/running to completed', async () => {
    // Snapshot: 2 of 5 are pending/running -> counter shows 2.
    const run = makeRun(sampleLibraryScans);
    mockGetDiscoveryRuns.mockResolvedValueOnce([run]);
    mockGetDiscoveryRun.mockResolvedValueOnce(run);
    mockGetDiscoveryCandidateCount.mockResolvedValueOnce({ count: 7 });

    renderDiscoveryRunDetailPage(DiscoveryRunDetailPage, { runId: run.id });

    await waitFor(() => {
      expect(screen.getByTestId('library-scans-pending-counter')).toBeInTheDocument();
    });
    // 1 running + 1 pending = 2 pending overall (skip-* are NOT counted).
    expect(screen.getByTestId('library-scans-pending-counter')).toHaveTextContent('2');
  });

  it('renders skipped-cycle and skipped-depth-cap status badges with the correct text', async () => {
    const run = makeRun(sampleLibraryScans);
    mockGetDiscoveryRuns.mockResolvedValueOnce([run]);
    mockGetDiscoveryRun.mockResolvedValueOnce(run);
    mockGetDiscoveryCandidateCount.mockResolvedValueOnce({ count: 0 });

    renderDiscoveryRunDetailPage(DiscoveryRunDetailPage, { runId: run.id });

    await waitFor(() => {
      expect(screen.getByTestId('library-scan-status-skipped-cycle')).toBeInTheDocument();
    });
    expect(screen.getByTestId('library-scan-status-skipped-cycle')).toHaveTextContent('skipped-cycle');
    expect(screen.getByTestId('library-scan-status-skipped-depth-cap')).toHaveTextContent('skipped-depth-cap');
  });
});
