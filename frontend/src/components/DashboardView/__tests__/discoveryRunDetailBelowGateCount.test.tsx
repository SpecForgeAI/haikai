/**
 * DiscoveryRunDetailPage -- below-auto-accept-gate count on the save-back outcome
 *
 * Spec 2026-05-30 Oracle Integrity & Determinism (Spec #3) -- Task Group 6.1.
 *
 * The MCP `SaveBackResult` (TG5) records candidates whose OWN confidence sits
 * below the 0.75 auto-accept gate as explicit "below auto-accept" reviewable
 * items (NOT auto-applied, NOT dropped) and surfaces a `belowGateCount`. That
 * result flows verbatim through the gateway save-approved proxy onto the
 * frontend's `saveApprovedCandidates` result, which the run-detail page renders
 * on its existing save-back outcome line (the `save-approved-success` span).
 *
 * This test mounts the real page via the shared harness, drives the save-back
 * modal Confirm, returns a result carrying `belowGateCount`, and asserts the
 * count renders on that existing outcome line (matching how the other counts
 * -- created / skipped / committed -- are shown). It mirrors the mock setup of
 * the sibling `saveBackConfirmModalWiring.test.tsx`.
 *
 * NOTE on the post-save refetch: the success line lives inside the
 * `save-approved-section`, which the page renders only while at least one
 * approved candidate remains. So the post-save candidate refetch here returns a
 * list that STILL contains one approved candidate (a partial / "save remaining"
 * scenario) -- otherwise the section (and the message) would unmount before the
 * assertion, exactly as it does in production once nothing approved remains.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { DiscoveryCandidateDto, DiscoveryRunDto } from '../../../api/discoveryApi';
import { renderDiscoveryRunDetailPage } from './_discoveryRunDetailPageHarness';

// ============================================================================
// Mock setup (mirrors saveBackConfirmModalWiring.test.tsx)
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
  // Spec 1 (2026-06-02) Group 6: the embedded candidate table fetches the
  // review-model backbone on mount. This page-level save-back test doesn't
  // exercise grid counts, so the backbone fetch is mocked to REJECT and the
  // grid falls back to the local count derivation (no behavioural change here).
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

const ARCH_ID = 'arch-bound-by-run';

vi.mock('../../../contexts/ArchitectureContext', () => ({
  useActiveArchitectureId: () => ARCH_ID,
  useArchitectureContext: () => ({
    architectures: [
      {
        id: ARCH_ID,
        projectId: 'proj-1',
        name: 'Run Architecture',
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

// The post-save model reload calls loadModelByProjectId (same-arch path) -- stub
// it so the success branch doesn't try to hit a real backend.
vi.mock('../../../api/modelApi', () => ({
  loadModelByProjectId: vi.fn().mockResolvedValue({}),
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
    created_at: '2026-05-30T12:00:00Z',
    updated_at: '2026-05-30T12:30:00Z',
    architecture_id: ARCH_ID,
    ...overrides,
  };
}

function makeApprovedCandidate(
  id: string,
  name: string,
): DiscoveryCandidateDto {
  return {
    id,
    run_id: 'run-100',
    candidate_type: 'application',
    name,
    confidence: 0.85,
    status: 'proposed',
    source_cluster_ids: ['cluster-1'],
    data: {},
    synthesized_at: '2026-05-30T12:10:00Z',
    parent_candidate_id: null,
    review_status: 'approved',
    reviewed_by: 'alice',
    reviewed_at: '2026-05-30T12:20:00Z',
    previous_review_status: 'pending_review',
  };
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

async function openRunWithApprovedCandidates(): Promise<void> {
  const run = makeRun();
  // Two approved candidates -- one will "remain" approved after the save so the
  // save-approved-section (and its success line) stays mounted for the assert.
  const candidates = [
    makeApprovedCandidate('cand-A', 'OrderService'),
    makeApprovedCandidate('cand-B', 'PaymentProcessor'),
  ];

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

/**
 * Queue the three post-save refetch resolutions. The candidate refetch keeps
 * ONE approved candidate so `hasApprovedCandidates` stays true and the
 * save-approved-section (with the success line) remains mounted.
 */
function queuePostSaveRefetch(): void {
  const refreshedRun = makeRun();
  mockGetDiscoveryCandidates.mockResolvedValueOnce([
    makeApprovedCandidate('cand-B', 'PaymentProcessor'),
  ]);
  mockGetDiscoveryRuns.mockResolvedValueOnce([refreshedRun]);
  mockGetDiscoveryRun.mockResolvedValueOnce(refreshedRun);
  mockGetDiscoveryCandidateCount.mockResolvedValueOnce({ count: 1 });
}

// ============================================================================
// Tests
// ============================================================================

describe('DiscoveryRunDetailPage -- below-gate count on save-back outcome (Spec #3, Group 6.1)', () => {
  it('renders the below-auto-accept count on the save-success line when SaveBackResult carries belowGateCount', async () => {
    await openRunWithApprovedCandidates();

    // Open the modal, then set up the save to resolve WITH a below-gate count.
    fireEvent.click(screen.getByTestId('save-approved-button'));
    expect(screen.getByTestId('save-back-confirm-modal')).toBeInTheDocument();

    mockSaveApprovedCandidates.mockResolvedValueOnce({
      entitiesCreated: 2,
      entitiesSkipped: 0,
      candidatesCommitted: 2,
      belowGateCount: 5, // <-- TG5's run-summary count of below-gate reviewables
    });
    queuePostSaveRefetch();

    await act(async () => {
      fireEvent.click(screen.getByTestId('save-back-confirm-confirm'));
    });

    await waitFor(() => {
      expect(mockSaveApprovedCandidates).toHaveBeenCalledTimes(1);
    });

    // The existing save-back outcome line now shows the below-gate count
    // alongside the created / skipped / committed counts.
    await waitFor(() => {
      expect(screen.getByTestId('save-approved-success')).toBeInTheDocument();
    });
    const successLine = screen.getByTestId('save-approved-success');
    expect(successLine).toHaveTextContent('2 created');
    expect(successLine).toHaveTextContent('2 committed');
    expect(successLine).toHaveTextContent('5 below auto-accept (reviewable)');
  });

  it('omits the below-gate suffix when belowGateCount is zero / absent (back-compat)', async () => {
    await openRunWithApprovedCandidates();

    fireEvent.click(screen.getByTestId('save-approved-button'));
    expect(screen.getByTestId('save-back-confirm-modal')).toBeInTheDocument();

    // Pre-Spec-#3 shape: NO belowGateCount field on the result.
    mockSaveApprovedCandidates.mockResolvedValueOnce({
      entitiesCreated: 1,
      entitiesSkipped: 0,
      candidatesCommitted: 1,
    });
    queuePostSaveRefetch();

    await act(async () => {
      fireEvent.click(screen.getByTestId('save-back-confirm-confirm'));
    });

    await waitFor(() => {
      expect(mockSaveApprovedCandidates).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByTestId('save-approved-success')).toBeInTheDocument();
    });
    const successLine = screen.getByTestId('save-approved-success');
    expect(successLine).toHaveTextContent('1 created');
    expect(successLine).not.toHaveTextContent('below auto-accept');
  });
});
