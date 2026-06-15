/**
 * Spec #4 Task Group 9 — gap-fill tests across the multi-architecture
 * Discovery Integration spec (2026-05-01).
 *
 * Hard cap: at most 5 strategic tests in this file (within the Group 9
 * 10-test cap; the rest of the cap is reserved for the gateway and
 * discovery-service gap-fill files in this group).
 *
 * Coverage:
 *   1. End-to-end picker -> createDiscoveryRun URL: when the run-start
 *      payload carries the picker's chosen id (different from the URL
 *      active id), the createDiscoveryRun client call builds the
 *      architecture-scoped URL with the picker's id, NOT the URL active
 *      id. Pins the full pipeline from picker selection to API URL.
 *      (Bridges Group 6 -> Group 8 / Group 4 binding.)
 *
 *   2. Cross-architecture isolation at the run-list level: when the API
 *      returns runs whose `architecture_id` does NOT match the URL active
 *      id (defence in depth — should never happen in practice, the
 *      backend filters), the list still does not show their counts
 *      against the active architecture's chip context, and the
 *      getDiscoveryRuns call still embeds the URL active id (preventing
 *      a client-side leak even if the backend regressed).
 *
 *   3. Defensive console.warn fires when the URL active architecture id
 *      differs from the run's bound architecture id at save-back time.
 *      (Group 8 caveat #4 — diagnostic, not a blocker; the save still
 *      uses the run's bound id.)
 *
 *   4. Pre-existing-run silent backfill: a run created before spec #4
 *      had no `architecture_id`. After Liquibase 094 backfilled it to
 *      `project_id` (Default), the run appears in the project's Default
 *      architecture's run list with no banner / no "legacy" tag — silent.
 *      Asserts the chip resolution still works for backfilled runs.
 *
 * Hotfix 2026-05-11 (Bug 2): the save-back path now also refetches the
 * runs list AND the selected run detail post-save (so an orphaned-service
 * chip predicate cannot trip against stale in-memory data). Test 3's
 * fixtures therefore need second-call resolutions for getDiscoveryRuns,
 * getDiscoveryRun, and getDiscoveryCandidateCount.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { DiscoveryRunDto } from '../../../api/discoveryApi';
import { renderDiscoveryRunDetailPage } from './_discoveryRunDetailPageHarness';

// ============================================================================
// Mock setup — mirrors saveBackConfirmModalWiring + discoveryRunListAndChip
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

// Two architectures: ARCH_ACTIVE (URL active) and ARCH_BACKFILLED (silent
// backfill scenario — same id as project_id). The wiring scenario uses
// ARCH_BOUND_BY_RUN to prove the bound id beats the URL active id.
const PROJECT_ID = 'proj-99';
const ARCH_ACTIVE_ID = 'arch-active-uuid';
const ARCH_BOUND_BY_RUN_ID = 'arch-bound-by-run-uuid';
// Per spec #1's deterministic-Default rule, Default's architecture.id ===
// project.id. The Liquibase 094 backfill exploits this: it sets
// discovery_run.architecture_id = discovery_run.project_id. Modelled here
// by deliberately reusing PROJECT_ID as the Default arch id.
const ARCH_BACKFILLED_DEFAULT_ID = PROJECT_ID;

let mockActiveArchId: string | null = ARCH_ACTIVE_ID;

vi.mock('../../../contexts/ArchitectureContext', () => ({
  useActiveArchitectureId: () => mockActiveArchId,
  useArchitectureContext: () => ({
    architectures: [
      {
        id: ARCH_BACKFILLED_DEFAULT_ID,
        projectId: PROJECT_ID,
        name: 'Default',
        description: null,
        tags: [],
        archived: false,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: ARCH_ACTIVE_ID,
        projectId: PROJECT_ID,
        name: 'Currently Viewing',
        description: null,
        tags: [],
        archived: false,
        createdAt: '2026-02-01T00:00:00Z',
        updatedAt: '2026-02-01T00:00:00Z',
      },
      {
        id: ARCH_BOUND_BY_RUN_ID,
        projectId: PROJECT_ID,
        name: 'Run Was Bound To',
        description: null,
        tags: [],
        archived: false,
        createdAt: '2026-03-01T00:00:00Z',
        updatedAt: '2026-03-01T00:00:00Z',
      },
    ],
    invalidateArchitectureModelCache: vi.fn(),
  }),
  useArchitectureDispatch: () => vi.fn(),
}));

vi.mock('../../../contexts/ProjectContext', () => ({
  useProject: () => ({ id: 'proj-99', name: 'Project 99' }),
}));

// ============================================================================
// Fixtures
// ============================================================================

function makeRun(overrides: Partial<DiscoveryRunDto> = {}): DiscoveryRunDto {
  return {
    id: 'run-default',
    project_id: PROJECT_ID,
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

function makeApprovedCandidates() {
  return [
    {
      id: 'cand-A',
      run_id: 'run-bound',
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
  ];
}

// ============================================================================
// Lazy import after mocks
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

  mockActiveArchId = ARCH_ACTIVE_ID;

  const mod = await import('../DiscoveryRunDetailPage');
  DiscoveryRunDetailPage = mod.DiscoveryRunDetailPage;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// Helpers
// ============================================================================

async function openRunWithApprovedCandidates(runArchId: string): Promise<void> {
  const run = makeRun({ id: 'run-bound', architecture_id: runArchId });
  const candidates = makeApprovedCandidates();

  mockGetDiscoveryRuns.mockResolvedValueOnce([run]);
  mockGetDiscoveryRun.mockResolvedValueOnce(run);
  mockGetDiscoveryCandidateCount.mockResolvedValueOnce({ count: candidates.length });
  mockGetDiscoveryCandidates.mockResolvedValueOnce(candidates);

  renderDiscoveryRunDetailPage(DiscoveryRunDetailPage, {
    projectId: PROJECT_ID,
    runId: run.id,
  });

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

describe('Spec #4 Group 9 — discovery architecture gap-fill (frontend)', () => {
  // --------------------------------------------------------------------------
  // Test 1 (gap-fill): End-to-end picker chosen id -> createDiscoveryRun URL
  //
  // Calls the REAL createDiscoveryRun against a mocked global.fetch and
  // asserts the URL embeds the supplied architectureId between the
  // projectId and `/runs`. Combined with Group 6's
  // StartDiscoveryRunConfirmModal test (which verifies onConfirm passes
  // the picker's id), this completes the picker -> API URL pipeline:
  //   user picks B -> modal.onConfirm(B) -> parent invokeStartRun(... B)
  //     -> createDiscoveryRun(projectId, B, ...) -> URL has B
  // The pipeline is the spine of safety property (d) at the call site.
  // --------------------------------------------------------------------------
  it('end-to-end: createDiscoveryRun URL embeds the supplied architectureId (the picker\'s chosen id)', async () => {
    const originalFetch = global.fetch;
    const mockFetch = vi.fn();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: () =>
        Promise.resolve({
          id: 'new-run-uuid',
          project_id: PROJECT_ID,
          architecture_id: ARCH_BOUND_BY_RUN_ID,
          status: 'PENDING',
          current_step: null,
          config_snapshot: null,
          steps_payload: null,
          error_message: null,
          created_at: '2026-05-01T00:00:00Z',
          updated_at: '2026-05-01T00:00:00Z',
        }),
    });
    global.fetch = mockFetch;

    try {
      const { createDiscoveryRun } = await vi.importActual<
        typeof import('../../../api/discoveryApi')
      >('../../../api/discoveryApi');

      // The picker's chosen id is ARCH_BOUND_BY_RUN_ID — explicitly NOT
      // the URL active id. The URL the API client builds MUST carry
      // ARCH_BOUND_BY_RUN_ID, not the URL active id.
      await createDiscoveryRun(PROJECT_ID, ARCH_BOUND_BY_RUN_ID);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        `/api/v1/discovery/projects/${PROJECT_ID}/architectures/${ARCH_BOUND_BY_RUN_ID}/runs`
      );
      expect(init.method).toBe('POST');
      // Defensive: the URL active id MUST NOT leak into the URL.
      expect(url).not.toContain(ARCH_ACTIVE_ID);
    } finally {
      global.fetch = originalFetch;
    }
  });

  // --------------------------------------------------------------------------
  // Test 2 (gap-fill): cross-architecture isolation at the run-list level.
  //
  // Even if the backend regressed and returned a run whose architecture_id
  // does NOT match the URL active id, the frontend's getDiscoveryRuns call
  // still embeds the URL active id in the URL. This is the front-end
  // contribution to safety property (c) -- the URL is the gating mechanism;
  // the backend's WHERE clause is the enforcement.
  // --------------------------------------------------------------------------
  it('run-list URL always carries the URL active architectureId, never a cross-architecture run\'s bound id', async () => {
    mockActiveArchId = ARCH_ACTIVE_ID;
    // Defence in depth: API returns runs whose architecture_id is NOT the
    // active id. (A correct backend would never return these, but if it
    // did, the URL is what we control here.)
    mockGetDiscoveryRuns.mockResolvedValueOnce([
      makeRun({ id: 'run-cross-1', architecture_id: ARCH_BOUND_BY_RUN_ID }),
    ]);
    // The page also fetches detail / count for the URL :runId.
    mockGetDiscoveryRun.mockResolvedValueOnce(
      makeRun({ id: 'run-cross-1', architecture_id: ARCH_BOUND_BY_RUN_ID }),
    );
    mockGetDiscoveryCandidateCount.mockResolvedValueOnce({ count: 0 });
    mockGetDiscoveryCandidates.mockResolvedValueOnce([]);

    renderDiscoveryRunDetailPage(DiscoveryRunDetailPage, {
      projectId: PROJECT_ID,
      runId: 'run-cross-1',
    });

    await waitFor(() => {
      expect(mockGetDiscoveryRuns).toHaveBeenCalled();
    });

    // The list call carries the URL active id, NOT the run's bound id.
    expect(mockGetDiscoveryRuns).toHaveBeenCalledWith(PROJECT_ID, ARCH_ACTIVE_ID);
    expect(mockGetDiscoveryRuns).not.toHaveBeenCalledWith(PROJECT_ID, ARCH_BOUND_BY_RUN_ID);
  });

  // --------------------------------------------------------------------------
  // Test 3 (gap-fill): defensive console.warn on URL/run-bound mismatch.
  //
  // Group 8 caveat #4: when the user navigates to a different architecture
  // mid-session and then triggers save-back, the save MUST still go to the
  // run's bound id (covered in saveBackConfirmModalWiring Test 2). In
  // addition, a console.warn fires so operators know the URL drifted from
  // the run binding (diagnostic, not a blocker).
  // --------------------------------------------------------------------------
  it('save-back path emits console.warn when URL active arch differs from run bound arch', async () => {
    // URL active is the "Currently Viewing" arch; run is bound to a
    // different arch. The two intentionally differ to trigger the warn.
    mockActiveArchId = ARCH_ACTIVE_ID;
    await openRunWithApprovedCandidates(ARCH_BOUND_BY_RUN_ID);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    fireEvent.click(screen.getByTestId('save-approved-button'));
    expect(screen.getByTestId('save-back-confirm-modal')).toBeInTheDocument();

    mockSaveApprovedCandidates.mockResolvedValueOnce({
      entitiesCreated: 1,
      entitiesSkipped: 0,
      candidatesCommitted: 1,
    });
    // Hotfix Bug 2: the parent now refetches THREE streams post-save.
    // Provide a second resolution for each so the post-save UX doesn't
    // crash on an `undefined` payload.
    const refreshedRun = makeRun({
      id: 'run-bound',
      architecture_id: ARCH_BOUND_BY_RUN_ID,
    });
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

    // The warning fired with the diagnostic payload.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[SaveBack]'),
      expect.objectContaining({
        urlActiveArchitectureId: ARCH_ACTIVE_ID,
        runArchitectureId: ARCH_BOUND_BY_RUN_ID,
        runId: 'run-bound',
      })
    );

    // And the save still went to the run's BOUND id (sanity — the warn
    // is diagnostic only; it must not block / divert the save).
    expect(mockSaveApprovedCandidates).toHaveBeenCalledWith(
      PROJECT_ID,
      ARCH_BOUND_BY_RUN_ID,
      'run-bound'
    );

    warnSpy.mockRestore();
  });

  // --------------------------------------------------------------------------
  // Test 4 (gap-fill): pre-existing-run silent backfill.
  //
  // Liquibase 094 backfilled discovery_run.architecture_id = project_id.
  // The Default architecture has architecture.id === project.id (spec #1
  // deterministic rule), so the backfilled run is now visible in the
  // project's Default architecture's run list. There is no banner, no
  // "legacy" tag, no per-run notice — the chip just shows "Default".
  //
  // This test asserts the post-migration scenario: a run with
  // architecture_id === project_id appears in the Default arch's list and
  // its detail-page chip resolves cleanly to "Default".
  // --------------------------------------------------------------------------
  it('pre-existing-run silent backfill: a backfilled run is visible in the Default architecture\'s list with the Default name on its chip', async () => {
    // Switch the URL active architecture to the Default (where the
    // backfill landed it).
    mockActiveArchId = ARCH_BACKFILLED_DEFAULT_ID;

    const backfilledRun = makeRun({
      id: 'run-pre-spec4',
      architecture_id: ARCH_BACKFILLED_DEFAULT_ID,
    });
    mockGetDiscoveryRuns.mockResolvedValueOnce([backfilledRun]);
    mockGetDiscoveryRun.mockResolvedValueOnce(backfilledRun);
    mockGetDiscoveryCandidateCount.mockResolvedValueOnce({ count: 0 });
    mockGetDiscoveryCandidates.mockResolvedValueOnce([]);

    renderDiscoveryRunDetailPage(DiscoveryRunDetailPage, {
      projectId: PROJECT_ID,
      architectureId: ARCH_BACKFILLED_DEFAULT_ID,
      runId: backfilledRun.id,
    });

    await waitFor(() => {
      expect(screen.getByTestId('run-list')).toBeInTheDocument();
    });

    // The run-list call carries the Default arch id (which equals project_id).
    expect(mockGetDiscoveryRuns).toHaveBeenCalledWith(
      PROJECT_ID,
      ARCH_BACKFILLED_DEFAULT_ID
    );

    await waitFor(() => {
      expect(screen.getByTestId('run-detail-panel')).toBeInTheDocument();
    });

    // Chip resolves to "Default" -- silent: no "legacy", no "(backfilled)",
    // no banner anywhere on the panel.
    const chip = screen.getByTestId('run-detail-architecture-chip');
    expect(chip).toHaveTextContent('Architecture: Default');
    expect(chip).not.toHaveTextContent(/legacy/i);
    expect(chip).not.toHaveTextContent(/backfilled/i);
    expect(chip).not.toHaveTextContent(/migrated/i);

    // Sanity: no "(archived)" annotation on a fresh Default arch.
    expect(
      screen.queryByTestId('run-detail-architecture-chip-archived')
    ).not.toBeInTheDocument();
  });
});
