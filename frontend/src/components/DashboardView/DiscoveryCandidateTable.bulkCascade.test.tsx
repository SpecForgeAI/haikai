/**
 * DiscoveryCandidateTable -- cascade bulk-apply + bulk Save tests
 *
 * Spec 2026-06-02 Cascade-aware Bulk Review + Reject Suppression (Spec 2) --
 * Task Group 5.1. These tests pin the grid-side wiring:
 *
 *   1. Clicking a bulk action (Reject) opens the cascade-confirm modal
 *      pre-selecting the FULL Spec 1 blast-radius (rendered over the review
 *      model ALREADY fetched on mount -- no new fetch). On Confirm the grid
 *      calls the NEW ATOMIC `bulkReviewCascade` endpoint with the curated ids --
 *      NOT the per-row `bulkReviewCandidates` fan-out -- and optimistically
 *      updates candidate state via `onCandidatesChange`, leaving `committed`
 *      rows untouched.
 *   2. Deselecting a dependent in the modal narrows the curated `candidate_ids`
 *      the atomic endpoint receives.
 *   3. Bulk Save (in the grid toolbar) reuses the EXISTING save-approved path
 *      and fires the SAME post-save AppShell cache refresh -- asserted at the
 *      page level via the established run-detail harness (cross-arch ->
 *      `invalidateArchitectureModelCache`).
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
  ReviewModel,
} from '../../api/discoveryApi';
import { renderDiscoveryRunDetailPage } from './__tests__/_discoveryRunDetailPageHarness';

// ============================================================================
// Module mocks -- one discoveryApi mock covering BOTH the grid-isolated tests
// (reviewCandidate / bulkReviewCandidates / bulkReviewCascade / getReviewModel)
// and the page-level Save test (getDiscoveryRuns / getDiscoveryRun /
// getDiscoveryCandidateCount / getDiscoveryCandidates / saveApprovedCandidates).
// ============================================================================

const mockReviewCandidate = vi.fn();
const mockBulkReviewCandidates = vi.fn();
const mockBulkReviewCascade = vi.fn();
const mockGetReviewModel = vi.fn();
const mockGetDiscoveryRuns = vi.fn();
const mockGetDiscoveryRun = vi.fn();
const mockGetDiscoveryCandidateCount = vi.fn();
const mockGetDiscoveryCandidates = vi.fn();
const mockSaveApprovedCandidates = vi.fn();

vi.mock('../../api/discoveryApi', () => ({
  reviewCandidate: (...args: unknown[]) => mockReviewCandidate(...args),
  bulkReviewCandidates: (...args: unknown[]) => mockBulkReviewCandidates(...args),
  bulkReviewCascade: (...args: unknown[]) => mockBulkReviewCascade(...args),
  getReviewModel: (...args: unknown[]) => mockGetReviewModel(...args),
  getDiscoveryRuns: (...args: unknown[]) => mockGetDiscoveryRuns(...args),
  getDiscoveryRun: (...args: unknown[]) => mockGetDiscoveryRun(...args),
  getDiscoveryCandidateCount: (...args: unknown[]) =>
    mockGetDiscoveryCandidateCount(...args),
  getDiscoveryCandidates: (...args: unknown[]) => mockGetDiscoveryCandidates(...args),
  saveApprovedCandidates: (...args: unknown[]) => mockSaveApprovedCandidates(...args),
}));

const mockLoadModelByProjectId = vi.fn();
vi.mock('../../api/modelApi', () => ({
  loadModelByProjectId: (...args: unknown[]) => mockLoadModelByProjectId(...args),
}));

// CSS module identity proxies. NOTE: the factory must be inline (vi.mock is
// hoisted above module-body consts, so a shared helper const would be in the
// temporal dead zone when the factory runs).
vi.mock('./DiscoveryRunDetailView.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, p: string | symbol) => String(p) }),
}));
vi.mock('../Discovery/ConflictResolutionModal.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, p: string | symbol) => String(p) }),
}));
vi.mock('../Discovery/BulkCandidateActionConfirmModal.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, p: string | symbol) => String(p) }),
}));
vi.mock('./TierBadge.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, p: string | symbol) => String(p) }),
}));
vi.mock('../Discovery/SaveBackConfirmModal.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, p: string | symbol) => String(p) }),
}));
vi.mock('../Discovery/DiscoveryRunKindBadge.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, p: string | symbol) => String(p) }),
}));

// ArchitectureContext: cross-arch scenario so the Save path's cross-arch
// branch (invalidate the run-bound arch cache) fires -- mirrors
// discoveryRunDetailView.dbCacheInvalidation.test.tsx.
const URL_ACTIVE_ARCH_ID = 'arch-active-url';
const RUN_BOUND_ARCH_ID = 'arch-bound-by-run';
const mockInvalidateArchitectureModelCache = vi.fn();
const mockArchDispatch = vi.fn();

vi.mock('../../contexts/ArchitectureContext', () => ({
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

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => ({ id: 'proj-1', name: 'Demo' }),
}));

// Import AFTER mocks.
import { DiscoveryCandidateTable } from './DiscoveryCandidateTable';

// ============================================================================
// Fixtures
// ============================================================================

const PROJECT_ID = 'proj-1';
const ARCH_ID = 'arch-1';
const RUN_ID = 'run-1';

function makeCandidate(
  overrides: Partial<DiscoveryCandidateDto> = {},
): DiscoveryCandidateDto {
  return {
    id: 'cand-1',
    run_id: RUN_ID,
    candidate_type: 'endpoints',
    name: 'GET /one',
    confidence: 0.9,
    status: 'proposed',
    source_cluster_ids: [],
    data: { _addedBy: 'spring-boot-adapter' },
    synthesized_at: '2026-06-02T00:00:00Z',
    parent_candidate_id: null,
    review_status: 'pending_review',
    reviewed_by: null,
    reviewed_at: null,
    previous_review_status: null,
    ...overrides,
  };
}

/**
 * A blast-radius model: parent --parent_child--> child. The grid seeds the
 * cascade from the actionable candidates; `parent` reaches `child`. A finding
 * `f-child` links the child.
 */
function buildModelWith(candidates: DiscoveryCandidateDto[]): ReviewModel {
  const ids = candidates.map((c) => c.id);
  const committed = candidates.filter((c) => c.review_status === 'committed');
  return {
    nodes: candidates.map((c) => ({
      id: c.id,
      review_status: c.status,
      committed: c.status === 'committed',
      conflict_state: { has_live_conflict: false },
    })),
    aggregations: {
      total_candidates: ids.length,
      total_findings: 1,
      committed_count: committed.length,
      actionable_count: ids.length - committed.length,
      live_conflict_count: 0,
    },
    blast_radius: [
      {
        candidate_id: 'parent',
        dependents: [
          {
            dependent_id: 'child',
            via_edge_kind: 'parent_child',
            via_predecessor_id: 'parent',
          },
        ],
        would_be_orphaned_parent_ids: [],
      },
      { candidate_id: 'child', dependents: [], would_be_orphaned_parent_ids: [] },
    ],
    findings: [
      { id: 'f-child', candidate_link_ids: ['child'], title: 'Child finding' },
    ],
  };
}

// ============================================================================
// Part 1 -- grid cascade apply (isolated grid mount)
// ============================================================================

describe('DiscoveryCandidateTable cascade bulk-apply (Spec 2 Group 5.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReviewCandidate.mockReset();
    mockBulkReviewCandidates.mockReset();
    mockBulkReviewCascade.mockReset();
    mockGetReviewModel.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('Reject (Filtered) opens the cascade modal showing the dependent pulled in BY CASCADE (no new fetch), and Confirm calls the ATOMIC endpoint -- not the fan-out -- optimistically updating and leaving committed rows untouched', async () => {
    const parent = makeCandidate({ id: 'parent', name: 'GET /parent' });
    const child = makeCandidate({ id: 'child', name: 'GET /child' });
    // A committed row that must NEVER be re-dispositioned or seeded.
    const committed = makeCandidate({
      id: 'done',
      name: 'GET /done',
      review_status: 'committed',
      status: 'committed',
    });
    const candidates = [parent, child, committed];
    const onCandidatesChange = vi.fn();

    mockGetReviewModel.mockResolvedValue(buildModelWith(candidates));
    mockBulkReviewCascade.mockResolvedValue({
      candidates: {
        updated_count: 2,
        skipped_count: 0,
        skipped_by_reason: { already_in_target: 0, transition_not_allowed: 0 },
        delta_by_from_status: { pending_review: 2 },
      },
      findings: {
        updated_count: 1,
        skipped_count: 0,
        skipped_by_reason: { already_in_target: 0, transition_not_allowed: 0 },
        delta_by_from_status: { pending_review: 1 },
      },
    });

    render(
      <DiscoveryCandidateTable
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        runId={RUN_ID}
        candidates={candidates}
        onCandidatesChange={onCandidatesChange}
      />,
    );

    // The review model is fetched ONCE on mount (single-run) -- the preview
    // renders over it with NO additional fetch.
    await waitFor(() => expect(mockGetReviewModel).toHaveBeenCalledTimes(1));
    expect(mockGetReviewModel).toHaveBeenCalledWith(PROJECT_ID, ARCH_ID, RUN_ID);

    // Filter to ONLY the parent so the seed is {parent}; the blast-radius then
    // pulls `child` in BY CASCADE (it is outside the filter), which is exactly
    // the cascade-preview case curation matters for.
    fireEvent.change(screen.getByTestId('filter-name'), {
      target: { value: 'parent' },
    });
    expect(screen.getAllByTestId('candidate-row')).toHaveLength(1);

    // Open the cascade modal via the FILTERED bulk Reject button.
    fireEvent.click(screen.getByTestId('bulk-reject-filtered'));
    expect(
      screen.getByTestId('bulk-candidate-action-confirm-modal'),
    ).toBeInTheDocument();

    // parent is the seed; child is pulled in BY CASCADE (parent_child); the
    // child's linked finding is pulled in too -- NO extra getReviewModel call.
    expect(mockGetReviewModel).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('bulk-candidate-seed-parent')).toBeInTheDocument();
    expect(
      screen.getByTestId('bulk-candidate-cascaded-child'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('bulk-candidate-cascaded-provenance-child'),
    ).toHaveTextContent('via parent');
    expect(
      screen.getByTestId('bulk-candidate-finding-f-child'),
    ).toBeInTheDocument();

    // Confirm the curated set.
    fireEvent.click(screen.getByTestId('bulk-candidate-confirm-confirm-button'));

    // The ATOMIC cascade endpoint is called with the curated ids -- NOT the
    // per-row fan-out.
    await waitFor(() => expect(mockBulkReviewCascade).toHaveBeenCalledTimes(1));
    expect(mockBulkReviewCandidates).not.toHaveBeenCalled();
    const [p, a, r, body] = mockBulkReviewCascade.mock.calls[0];
    expect(p).toBe(PROJECT_ID);
    expect(a).toBe(ARCH_ID);
    expect(r).toBe(RUN_ID);
    expect([...body.candidate_ids].sort()).toEqual(['child', 'parent']);
    expect(body.candidate_ids).not.toContain('done'); // committed never seeded
    expect(body.finding_ids).toEqual(['f-child']);
    expect(body.review_status).toBe('rejected');

    // Optimistic candidate update: parent + child -> rejected; the committed
    // row is left untouched.
    await waitFor(() => expect(onCandidatesChange).toHaveBeenCalled());
    const lastArg = onCandidatesChange.mock.calls[
      onCandidatesChange.mock.calls.length - 1
    ][0] as DiscoveryCandidateDto[];
    const byId = new Map(lastArg.map((c) => [c.id, c]));
    expect(byId.get('parent')?.review_status).toBe('rejected');
    expect(byId.get('child')?.review_status).toBe('rejected');
    expect(byId.get('done')?.review_status).toBe('committed');

    // Modal closes after the successful atomic apply.
    await waitFor(() =>
      expect(
        screen.queryByTestId('bulk-candidate-action-confirm-modal'),
      ).not.toBeInTheDocument(),
    );
  });

  it('deselecting a cascaded dependent narrows the curated candidate_ids the atomic endpoint receives', async () => {
    const parent = makeCandidate({ id: 'parent', name: 'GET /parent' });
    const child = makeCandidate({ id: 'child', name: 'GET /child' });
    const candidates = [parent, child];

    mockGetReviewModel.mockResolvedValue(buildModelWith(candidates));
    mockBulkReviewCascade.mockResolvedValue({
      candidates: {
        updated_count: 1,
        skipped_count: 0,
        skipped_by_reason: { already_in_target: 0, transition_not_allowed: 0 },
        delta_by_from_status: { pending_review: 1 },
      },
      findings: {
        updated_count: 0,
        skipped_count: 0,
        skipped_by_reason: { already_in_target: 0, transition_not_allowed: 0 },
        delta_by_from_status: {},
      },
    });

    render(
      <DiscoveryCandidateTable
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        runId={RUN_ID}
        candidates={candidates}
        onCandidatesChange={vi.fn()}
      />,
    );
    await waitFor(() => expect(mockGetReviewModel).toHaveBeenCalled());

    // Filter to ONLY parent so child is a cascaded dependent (deselectable).
    fireEvent.change(screen.getByTestId('filter-name'), {
      target: { value: 'parent' },
    });
    fireEvent.click(screen.getByTestId('bulk-reject-filtered'));
    // Deselect the cascaded child AND its linked finding.
    fireEvent.click(screen.getByTestId('bulk-candidate-cascaded-toggle-child'));
    fireEvent.click(screen.getByTestId('bulk-candidate-finding-toggle-f-child'));
    fireEvent.click(screen.getByTestId('bulk-candidate-confirm-confirm-button'));

    await waitFor(() => expect(mockBulkReviewCascade).toHaveBeenCalledTimes(1));
    const body = mockBulkReviewCascade.mock.calls[0][3];
    // Only the seed parent survives; child + its finding were deselected.
    expect(body.candidate_ids).toEqual(['parent']);
    expect(body.finding_ids).toEqual([]);
  });

  // --------------------------------------------------------------------------
  // Bug 1 (2026-06-03): a RELATIONSHIP-ROW candidate type
  // (logical_data_entity_relationships / interface_logical_entities) is an EDGE
  // in Spec 1's review model, NOT a node, so it has no `blast_radius` entry. The
  // shared `resolveBulkActionSet` used to DROP any seed absent from the model, so
  // a filter of only relationship rows -- e.g. "Approve Filtered (26)" -- resolved
  // to ZERO candidates and the modal confirmed nothing. The fix keeps a non-node
  // seed as a DIRECT candidate, so the relationship row is in the Approve-Filtered
  // set and `bulkReviewCascade` is called WITH its id.
  // --------------------------------------------------------------------------
  it('includes a relationship-row (non-node) candidate in the Approve-Filtered set and calls bulkReviewCascade with its id (Bug 1)', async () => {
    // A normal node candidate (has a blast_radius entry) + a relationship-row
    // candidate that is NOT in blast_radius (an edge, not a node).
    const node = makeCandidate({
      id: 'node-1',
      name: 'GET /node',
      candidate_type: 'endpoints',
    });
    const relationshipRow = makeCandidate({
      id: 'rel-lde-rel-1',
      name: 'Owner -> Pet (one-to-many)',
      candidate_type: 'logical_data_entity_relationships',
    });
    const candidates = [node, relationshipRow];
    const onCandidatesChange = vi.fn();

    // The backbone covers BOTH rows as actionable nodes for the count gate, but
    // the blast_radius (the cascade graph) has an entry ONLY for the true node --
    // the relationship row is an edge and is intentionally absent there, exactly
    // as Spec 1 emits it.
    const backbone: ReviewModel = {
      nodes: candidates.map((c) => ({
        id: c.id,
        review_status: c.status,
        committed: false,
        conflict_state: { has_live_conflict: false },
      })),
      aggregations: {
        total_candidates: candidates.length,
        total_findings: 0,
        committed_count: 0,
        actionable_count: candidates.length,
        live_conflict_count: 0,
      },
      blast_radius: [
        { candidate_id: 'node-1', dependents: [], would_be_orphaned_parent_ids: [] },
        // NOTE: 'rel-lde-rel-1' is deliberately ABSENT (it is an edge, not a node).
      ],
      findings: [],
    };
    mockGetReviewModel.mockResolvedValue(backbone);
    mockBulkReviewCascade.mockResolvedValue({
      candidates: {
        updated_count: 1,
        skipped_count: 0,
        skipped_by_reason: { already_in_target: 0, transition_not_allowed: 0 },
        delta_by_from_status: { pending_review: 1 },
      },
      findings: {
        updated_count: 0,
        skipped_count: 0,
        skipped_by_reason: { already_in_target: 0, transition_not_allowed: 0 },
        delta_by_from_status: {},
      },
    });

    render(
      <DiscoveryCandidateTable
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        runId={RUN_ID}
        candidates={candidates}
        onCandidatesChange={onCandidatesChange}
      />,
    );
    await waitFor(() => expect(mockGetReviewModel).toHaveBeenCalled());

    // Filter to ONLY the relationship row (the type filter selects its kind).
    fireEvent.change(screen.getByTestId('filter-type'), {
      target: { value: 'logical_data_entity_relationships' },
    });
    expect(screen.getAllByTestId('candidate-row')).toHaveLength(1);

    // "Approve Filtered" must be ENABLED (the relationship row is actionable) and
    // its count must include the relationship row (NOT zero).
    const approveFiltered = screen.getByTestId('bulk-approve-filtered');
    await waitFor(() => expect(approveFiltered).not.toBeDisabled());
    expect(approveFiltered).toHaveTextContent('(1)');

    // Open the cascade modal -- the relationship row is present as a DIRECT seed
    // (it was NOT dropped despite having no blast_radius entry).
    fireEvent.click(approveFiltered);
    expect(
      screen.getByTestId('bulk-candidate-action-confirm-modal'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('bulk-candidate-seed-rel-lde-rel-1'),
    ).toBeInTheDocument();

    // Confirm -> the atomic endpoint is called WITH the relationship-row id (the
    // set is NON-ZERO).
    fireEvent.click(screen.getByTestId('bulk-candidate-confirm-confirm-button'));
    await waitFor(() => expect(mockBulkReviewCascade).toHaveBeenCalledTimes(1));
    const body = mockBulkReviewCascade.mock.calls[0][3];
    expect(body.candidate_ids).toContain('rel-lde-rel-1');
    expect(body.candidate_ids.length).toBeGreaterThan(0);
    expect(body.review_status).toBe('approved');
  });
});

// ============================================================================
// Part 2 -- bulk Save fires the same AppShell cache refresh (page-level)
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
    created_at: '2026-06-02T12:00:00Z',
    updated_at: '2026-06-02T12:30:00Z',
    architecture_id: RUN_BOUND_ARCH_ID,
    discovery_kind: 'code',
    ...overrides,
  };
}

function makeApprovedCandidate(): DiscoveryCandidateDto {
  return makeCandidate({
    id: 'cand-approved',
    name: 'GET /approved',
    review_status: 'approved',
    reviewed_by: 'alice',
    reviewed_at: '2026-06-02T12:20:00Z',
    previous_review_status: 'pending_review',
  });
}

describe('DiscoveryCandidateTable bulk Save fires the same AppShell cache refresh (Spec 2 Group 5.1)', () => {
  let DiscoveryRunDetailPage: React.FC;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetReviewModel.mockReset();
    mockGetDiscoveryRuns.mockReset();
    mockGetDiscoveryRun.mockReset();
    mockGetDiscoveryCandidateCount.mockReset();
    mockGetDiscoveryCandidates.mockReset();
    mockSaveApprovedCandidates.mockReset();
    mockInvalidateArchitectureModelCache.mockReset();
    mockArchDispatch.mockReset();
    mockLoadModelByProjectId.mockReset();

    // The grid fetches the review model on mount; resolve it with a benign
    // single-node model so the grid's cascade preview has data and never throws.
    mockGetReviewModel.mockResolvedValue(buildModelWith([makeApprovedCandidate()]));

    const mod = await import('./DiscoveryRunDetailPage');
    DiscoveryRunDetailPage = mod.DiscoveryRunDetailPage;
  });

  afterEach(() => {
    cleanup();
  });

  it('clicking the grid toolbar Save -> confirm reuses save-approved AND invalidates the run-bound architecture cache (cross-arch)', async () => {
    const run = makeRun();
    const candidates = [makeApprovedCandidate()];

    mockGetDiscoveryRuns.mockResolvedValueOnce([run]);
    mockGetDiscoveryRun.mockResolvedValueOnce(run);
    mockGetDiscoveryCandidateCount.mockResolvedValueOnce({
      count: candidates.length,
    });
    mockGetDiscoveryCandidates.mockResolvedValueOnce(candidates);

    renderDiscoveryRunDetailPage(DiscoveryRunDetailPage, { runId: run.id });

    // Wait for the grid to render (candidate row present).
    await waitFor(() =>
      expect(screen.getAllByTestId('candidate-row').length).toBeGreaterThan(0),
    );

    // The bulk Save button lives in the grid toolbar now.
    const saveButton = await screen.findByTestId('bulk-save');
    fireEvent.click(saveButton);

    // The existing save-back confirm modal opens (the verbatim save-approved flow).
    expect(screen.getByTestId('save-back-confirm-modal')).toBeInTheDocument();

    mockSaveApprovedCandidates.mockResolvedValueOnce({
      entitiesCreated: 1,
      entitiesSkipped: 0,
      candidatesCommitted: 1,
    });
    // Post-save refetch streams so the page doesn't crash on undefined.
    const refreshedRun = makeRun();
    mockGetDiscoveryCandidates.mockResolvedValueOnce([]);
    mockGetDiscoveryRuns.mockResolvedValueOnce([refreshedRun]);
    mockGetDiscoveryRun.mockResolvedValueOnce(refreshedRun);
    mockGetDiscoveryCandidateCount.mockResolvedValueOnce({ count: 0 });

    await act(async () => {
      fireEvent.click(screen.getByTestId('save-back-confirm-confirm'));
    });

    // save-approved fired...
    await waitFor(() =>
      expect(mockSaveApprovedCandidates).toHaveBeenCalledTimes(1),
    );
    // ...and the SAME post-save cache refresh fired: cross-arch invalidation of
    // the run-bound architecture (per project_appshell_model_cache).
    await waitFor(() =>
      expect(mockInvalidateArchitectureModelCache).toHaveBeenCalledWith(
        RUN_BOUND_ARCH_ID,
      ),
    );
    // Cross-arch -> no same-arch LOAD_MODEL reload.
    expect(mockLoadModelByProjectId).not.toHaveBeenCalled();
  });
});
