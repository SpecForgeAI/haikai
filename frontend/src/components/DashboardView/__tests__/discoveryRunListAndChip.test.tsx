/**
 * Discovery Run List Architecture Filter + Detail Chip Tests
 *
 * Spec 2026-05-01 Multi-Architecture Discovery Integration -- Task Group 7
 *
 * Tests cover:
 *   1. getDiscoveryRuns hits the architecture-scoped URL when called with
 *      (projectId, architectureId). Sanity check on the API client URL shape.
 *   2. Run-list component (DiscoveryRunDetailView) reads useActiveArchitectureId()
 *      and passes it into the getDiscoveryRuns call -- safety property (c).
 *      Cross-architecture runs returned by a misbehaving backend would be
 *      shown if the frontend forgot to filter; the test asserts the URL
 *      passed to fetch carries the active architectureId so the backend's
 *      WHERE filter does the work.
 *   3. Detail page renders the read-only architecture chip with the name
 *      resolved from ArchitectureContext.architectures by matching the
 *      run's stored architecture_id field.
 *   4. Detail page handles archived architecture gracefully -- still shows
 *      the name with a small "(archived)" annotation.
 *
 * Test strategy:
 *   - Mock discoveryApi via the Vitest pattern (as in
 *     discoveryRunDetailView.test.tsx).
 *   - Mock ArchitectureContext to inject useActiveArchitectureId() and
 *     useArchitectureContext().architectures so the chip resolution is
 *     deterministic.
 *   - Test 1 uses vi.importActual to call the real getDiscoveryRuns
 *     against a mocked global.fetch (mirrors candidateReviewWorkflow Test 1
 *     pattern).
 *   - Tests 2-4 mount DiscoveryRunDetailView and assert against rendered
 *     output and the mock call arguments.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import type { DiscoveryRunDto } from '../../../api/discoveryApi';
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
}));

// CSS module identity mapping
vi.mock('../DiscoveryRunDetailView.module.css', () => ({
  default: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => String(prop),
  }),
}));

// ArchitectureContext mock -- two architectures so chip resolution is testable.
// One archived row to verify the archived-graceful behaviour in Test 4.
const ARCH_ACTIVE_ID = 'arch-active-uuid';
const ARCH_OTHER_ID = 'arch-other-uuid';
const ARCH_ARCHIVED_ID = 'arch-archived-uuid';

let mockActiveArchId: string | null = ARCH_ACTIVE_ID;

vi.mock('../../../contexts/ArchitectureContext', () => ({
  useActiveArchitectureId: () => mockActiveArchId,
  useArchitectureContext: () => ({
    architectures: [
      {
        id: ARCH_ACTIVE_ID,
        projectId: 'proj-1',
        name: 'Default',
        description: null,
        tags: [],
        archived: false,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: ARCH_OTHER_ID,
        projectId: 'proj-1',
        name: 'Target State',
        description: null,
        tags: [],
        archived: false,
        createdAt: '2026-02-01T00:00:00Z',
        updatedAt: '2026-02-01T00:00:00Z',
      },
      {
        id: ARCH_ARCHIVED_ID,
        projectId: 'proj-1',
        name: 'Sandbox (deprecated)',
        description: null,
        tags: [],
        archived: true,
        createdAt: '2026-01-15T00:00:00Z',
        updatedAt: '2026-01-15T00:00:00Z',
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
    id: 'run-001',
    project_id: 'proj-1',
    status: 'COMPLETED',
    current_step: null,
    config_snapshot: null,
    steps_payload: null,
    error_message: null,
    created_at: '2026-04-05T12:00:00Z',
    updated_at: '2026-04-05T12:30:00Z',
    architecture_id: ARCH_ACTIVE_ID,
    ...overrides,
  };
}

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

  // Reset active arch to the default fixture before each test.
  mockActiveArchId = ARCH_ACTIVE_ID;

  const detailMod = await import('../DiscoveryRunDetailPage');
  DiscoveryRunDetailPage = detailMod.DiscoveryRunDetailPage;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// Tests
// ============================================================================

describe('Discovery Run List Architecture Filter + Detail Chip (Task 7.1)', () => {

  // --------------------------------------------------------------------------
  // Test 1: getDiscoveryRuns hits the architecture-scoped URL.
  //
  // Sanity check on the API client. We call the real implementation against
  // a mocked global.fetch (the same `vi.importActual` pattern used in
  // candidateReviewWorkflow Test 1) and assert the URL embeds
  // `/architectures/{architectureId}/runs` between the projectId and the
  // resource path. Forgetting the segment would 404 at the gateway router.
  // --------------------------------------------------------------------------
  it('Test 1: getDiscoveryRuns hits the architecture-scoped URL', async () => {
    const originalFetch = global.fetch;
    const mockFetch = vi.fn();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    });
    global.fetch = mockFetch;

    try {
      // Pull the REAL function (not the file-scope mock) via vi.importActual.
      const { getDiscoveryRuns: realGetDiscoveryRuns } =
        await vi.importActual<typeof import('../../../api/discoveryApi')>(
          '../../../api/discoveryApi'
        );

      await realGetDiscoveryRuns('proj-7', 'arch-bound-xyz');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('/api/v1/discovery/projects/proj-7/architectures/arch-bound-xyz/runs');
    } finally {
      global.fetch = originalFetch;
    }
  });

  // --------------------------------------------------------------------------
  // Test 2: DiscoveryRunDetailView passes useActiveArchitectureId() to
  // getDiscoveryRuns -- safety property (c) at the frontend layer.
  //
  // Set the active architecture to ARCH_OTHER_ID via the mocked hook and
  // assert mockGetDiscoveryRuns was called with that id (not the ARCH_ACTIVE_ID
  // default). Cross-architecture runs are filtered server-side -- the
  // frontend's contribution to (c) is correctly threading the active id
  // into the URL.
  // --------------------------------------------------------------------------
  it('Test 2: run-list component passes useActiveArchitectureId() into getDiscoveryRuns (property (c))', async () => {
    // Switch the mocked active architecture to the OTHER one before mount.
    mockActiveArchId = ARCH_OTHER_ID;
    mockGetDiscoveryRuns.mockResolvedValueOnce([]);
    mockGetDiscoveryRun.mockRejectedValueOnce(new Error('not found'));
    mockGetDiscoveryCandidateCount.mockResolvedValueOnce({ count: 0 });
    mockGetDiscoveryCandidates.mockResolvedValueOnce([]);

    renderDiscoveryRunDetailPage(DiscoveryRunDetailPage, {
      architectureId: ARCH_OTHER_ID,
      runId: 'run-001',
    });

    await waitFor(() => {
      expect(mockGetDiscoveryRuns).toHaveBeenCalled();
    });

    // The run-list call must carry the URL active id, NOT a hardcoded
    // default. Were it not threaded, runs from the wrong architecture
    // would be returned (or all runs, depending on backend), defeating
    // safety property (c).
    expect(mockGetDiscoveryRuns).toHaveBeenCalledWith('proj-1', ARCH_OTHER_ID);
  });

  // --------------------------------------------------------------------------
  // Test 3: Detail page renders the architecture chip with the resolved name.
  //
  // Mount, click into a run whose architecture_id is the active one, and
  // assert the chip text reads "Architecture: Default". The name resolves
  // from ArchitectureContext.architectures by matching architecture_id.
  // --------------------------------------------------------------------------
  it('Test 3: detail page renders the architecture chip with the resolved name', async () => {
    const run = makeRun({ architecture_id: ARCH_ACTIVE_ID });
    mockGetDiscoveryRuns.mockResolvedValueOnce([run]);
    mockGetDiscoveryRun.mockResolvedValueOnce(run);
    mockGetDiscoveryCandidateCount.mockResolvedValueOnce({ count: 0 });
    mockGetDiscoveryCandidates.mockResolvedValueOnce([]);

    renderDiscoveryRunDetailPage(DiscoveryRunDetailPage, { runId: run.id });

    // Wait for the detail panel to render (URL drives selection directly).
    await waitFor(() => {
      expect(screen.getByTestId('run-detail-panel')).toBeInTheDocument();
    });

    // The chip should be present and show the bound architecture's name.
    const chip = screen.getByTestId('run-detail-architecture-chip');
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveTextContent('Architecture: Default');

    // No "(archived)" annotation when the architecture is active.
    expect(
      screen.queryByTestId('run-detail-architecture-chip-archived')
    ).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 4: Detail page handles archived architecture gracefully.
  //
  // The run targets an architecture that is now archived (rare but possible
  // -- the run was started before the architecture was archived). The chip
  // should still show the name with a small "(archived)" annotation so the
  // user knows why this architecture is no longer in the selector.
  // --------------------------------------------------------------------------
  it('Test 4: detail page shows name with (archived) annotation when run targets an archived architecture', async () => {
    const run = makeRun({ architecture_id: ARCH_ARCHIVED_ID });
    mockGetDiscoveryRuns.mockResolvedValueOnce([run]);
    mockGetDiscoveryRun.mockResolvedValueOnce(run);
    mockGetDiscoveryCandidateCount.mockResolvedValueOnce({ count: 0 });
    mockGetDiscoveryCandidates.mockResolvedValueOnce([]);

    renderDiscoveryRunDetailPage(DiscoveryRunDetailPage, { runId: run.id });

    await waitFor(() => {
      expect(screen.getByTestId('run-detail-panel')).toBeInTheDocument();
    });

    const chip = screen.getByTestId('run-detail-architecture-chip');
    expect(chip).toBeInTheDocument();
    // The architecture name still resolves -- the chip does not collapse
    // to "..." just because the architecture is archived.
    expect(chip).toHaveTextContent('Sandbox (deprecated)');
    // The "(archived)" annotation appears so the user knows why this
    // architecture is missing from the selector dropdown.
    expect(
      screen.getByTestId('run-detail-architecture-chip-archived')
    ).toHaveTextContent('(archived)');
  });
});
