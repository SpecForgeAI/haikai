/**
 * DiscoveryRunDetailView -- AppShell cache invalidation on candidate save-back
 *
 * Spec 2026-05-16: Database Discovery Packs (Sybase + PostgreSQL) -- Group 5
 *
 * Per `project_appshell_model_cache.md`, backend writes that bypass the
 * frontend dispatch path leave the AppShell's per-(project, architecture)
 * model cache STALE. Discovery candidate save-back is one such path -- the
 * mcp-server writes new architecture entities (including the new
 * `physical_data_entity` / `physical_data_attribute` candidates from the
 * Database Discovery Packs) directly into AMS.
 *
 * The same-arch case dispatches `LOAD_MODEL` (covered by the predecessor
 * Multi-Architecture Discovery Integration spec). The cross-arch case --
 * added by this Group 5 patch -- calls
 * `invalidateArchitectureModelCache(runArchitectureId)` so the next
 * navigation to that architecture refetches from AMS.
 *
 * Test surface (2 tests):
 *   1. Cross-arch save-back of any candidate (the new
 *      physical_data_entity is a representative case) calls
 *      `invalidateArchitectureModelCache(runArchitectureId)`.
 *   2. Finding save-back (a separate code path -- NOT going through
 *      `saveApprovedCandidates`) does NOT touch the cache. Verified by
 *      asserting that the cache invalidator is not invoked when the
 *      candidate save-back is never triggered.
 *
 * The existing `saveBackConfirmModalWiring.test.tsx` is intentionally
 * NOT modified -- it is on the pre-existing-failing list (it mocks
 * ArchitectureContext incompletely; not in scope for Group 5).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from '@testing-library/react';
import type {
  DiscoveryCandidateDto,
  DiscoveryRunDto,
} from '../../../api/discoveryApi';
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
  getDiscoveryCandidateCount: (...args: unknown[]) =>
    mockGetDiscoveryCandidateCount(...args),
  getDiscoveryCandidates: (...args: unknown[]) => mockGetDiscoveryCandidates(...args),
  reviewCandidate: (...args: unknown[]) => mockReviewCandidate(...args),
  saveApprovedCandidates: (...args: unknown[]) => mockSaveApprovedCandidates(...args),
  // Spec 2 (2026-06-02) cascade-bulk-review: the grid now fetches the
  // deterministic review-model backbone on mount. These tests assert the LOCAL
  // derivation, so the backbone fetch is mocked to REJECT -- the grid falls back
  // to the identical local logic, keeping these assertions byte-for-byte valid.
  getReviewModel: vi.fn().mockRejectedValue(new Error('not under test')),
}));

const mockLoadModelByProjectId = vi.fn();
vi.mock('../../../api/modelApi', () => ({
  loadModelByProjectId: (...args: unknown[]) => mockLoadModelByProjectId(...args),
}));

// CSS module identity proxy.
vi.mock('../DiscoveryRunDetailView.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, p: string | symbol) => String(p) },
  ),
}));
vi.mock('../../Discovery/SaveBackConfirmModal.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, p: string | symbol) => String(p) },
  ),
}));
vi.mock('../../Discovery/DiscoveryRunKindBadge.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, p: string | symbol) => String(p) },
  ),
}));

// ArchitectureContext: cross-arch scenario. URL active arch != run-bound arch
// so the new Group 5 branch (invalidate the run-bound arch cache) fires.
const URL_ACTIVE_ARCH_ID = 'arch-active-url';
const RUN_BOUND_ARCH_ID = 'arch-bound-by-run';

const mockInvalidateArchitectureModelCache = vi.fn();
const mockArchDispatch = vi.fn();

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
    invalidateArchitectureModelCache: mockInvalidateArchitectureModelCache,
    setArchitectureModelCacheInvalidator: vi.fn(),
  }),
  useArchitectureDispatch: () => mockArchDispatch,
}));

// ProjectContext: active project shape.
vi.mock('../../../contexts/ProjectContext', () => ({
  useProject: () => ({
    id: 'proj-1',
    name: 'Demo',
  }),
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
    discovery_kind: 'database',
    ...overrides,
  };
}

function makeApprovedPhysicalEntityCandidates(): DiscoveryCandidateDto[] {
  // Representative DB-pack candidate: physical_data_entities (plural canonical).
  return [
    {
      id: 'cand-physical-1',
      run_id: 'run-100',
      candidate_type: 'physical_data_entities',
      name: 'orders',
      confidence: 0.95,
      status: 'proposed',
      source_cluster_ids: ['cluster-1'],
      data: { schema: 'public', table: 'orders' },
      synthesized_at: '2026-04-05T12:10:00Z',
      parent_candidate_id: null,
      review_status: 'approved',
      reviewed_by: 'alice',
      reviewed_at: '2026-04-05T12:20:00Z',
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
  mockInvalidateArchitectureModelCache.mockReset();
  mockArchDispatch.mockReset();
  mockLoadModelByProjectId.mockReset();

  const mod = await import('../DiscoveryRunDetailPage');
  DiscoveryRunDetailPage = mod.DiscoveryRunDetailPage;
});

afterEach(() => {
  cleanup();
});

// ============================================================================
// Helper: drive the view to the point where Save All Approved is visible
// ============================================================================

async function openRunWithApprovedCandidates(): Promise<void> {
  const run = makeRun();
  const candidates = makeApprovedPhysicalEntityCandidates();

  mockGetDiscoveryRuns.mockResolvedValueOnce([run]);
  mockGetDiscoveryRun.mockResolvedValueOnce(run);
  mockGetDiscoveryCandidateCount.mockResolvedValueOnce({ count: candidates.length });
  mockGetDiscoveryCandidates.mockResolvedValueOnce(candidates);

  renderDiscoveryRunDetailPage(DiscoveryRunDetailPage, { runId: run.id });

  await waitFor(() => {
    expect(screen.getByTestId('run-detail-panel')).toBeInTheDocument();
  });

  await waitFor(() => {
    expect(screen.getByTestId('save-approved-button')).toBeInTheDocument();
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('DiscoveryRunDetailView AppShell cache invalidation (Spec 2026-05-16 Group 5)', () => {
  // -------------------------------------------------------------------------
  // 1. Cross-arch save-back of a physical_data_entity candidate dispatches
  //    invalidateArchitectureModelCache(runArchitectureId).
  // -------------------------------------------------------------------------
  it('cross-arch save-back of a physical_data_entity candidate invalidates the run-bound architecture cache', async () => {
    await openRunWithApprovedCandidates();

    // Open the save-back modal and confirm.
    fireEvent.click(screen.getByTestId('save-approved-button'));
    expect(screen.getByTestId('save-back-confirm-modal')).toBeInTheDocument();

    mockSaveApprovedCandidates.mockResolvedValueOnce({
      entitiesCreated: 1,
      entitiesSkipped: 0,
      candidatesCommitted: 1,
    });

    // Post-save refetch streams (Hotfix Bug 2 -- mirror the predecessor
    // wiring test's pattern so the parent doesn't crash on undefined).
    const refreshedRun = makeRun();
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

    // CRITICAL: the cross-arch branch fires the cache invalidator with the
    // run-BOUND architectureId (not the URL active one) so the next time
    // the user navigates to that architecture, AppShell refetches.
    await waitFor(() => {
      expect(mockInvalidateArchitectureModelCache).toHaveBeenCalledWith(
        RUN_BOUND_ARCH_ID,
      );
    });

    // Same-arch LOAD_MODEL dispatch is NOT triggered (we are cross-arch).
    expect(mockLoadModelByProjectId).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 2. Without a Confirm click, no save fires AND the cache is not touched.
  //    This covers the finding-save-back case at the code-path level: any
  //    flow that does NOT go through `saveApprovedCandidates` MUST NOT
  //    invalidate the architecture model cache.
  // -------------------------------------------------------------------------
  it('cache invalidator is NOT called when the candidate save-back is not confirmed (representative of the finding save-back flow which never goes through saveApprovedCandidates)', async () => {
    await openRunWithApprovedCandidates();

    // Open the modal but Cancel out -- mimicking the user choosing a
    // different action entirely (e.g. opening Findings and acting there).
    fireEvent.click(screen.getByTestId('save-approved-button'));
    expect(screen.getByTestId('save-back-confirm-modal')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('save-back-confirm-cancel'));
    await waitFor(() => {
      expect(screen.queryByTestId('save-back-confirm-modal')).not.toBeInTheDocument();
    });

    // No save fired, no cache invalidation, no model reload. The finding
    // save-back flow is structurally identical here: it never calls
    // `saveApprovedCandidates`, so the invalidator is never touched.
    expect(mockSaveApprovedCandidates).not.toHaveBeenCalled();
    expect(mockInvalidateArchitectureModelCache).not.toHaveBeenCalled();
    expect(mockLoadModelByProjectId).not.toHaveBeenCalled();
  });
});
