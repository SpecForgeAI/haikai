/**
 * DiscoveryRunDetailPage -- `?findingId=` + `?room=open` route params.
 *
 * Spec 2026-06-11 Deterministic Findings-Coverage Verification + Gap
 * Wayfinding -- Task Group 3.
 *
 * Two query-param additions to the EXISTING run detail route (no new
 * routes), extending the established `?tab=` / `useSearchParams` idiom:
 *   - `?findingId=X` (no explicit `tab`) -> the Findings tab is active, the
 *     single-finding fetch (`GET .../findings/{findingId}`) fires once on
 *     mount, and the existing `FindingDetailDrawer` opens with that finding.
 *   - unknown/404 finding id -> no drawer, no crash, no error banner.
 *   - `?room=open` -> the Discovery Review Room (Architecture Room) opens
 *     on load via the seeded `reviewRoomOpen` state.
 *   - garbage values (`room=banana`, empty `findingId`) -> the page renders
 *     normally and nothing throws.
 *
 * Mocks mirror the sibling run-detail page tests (shared harness +
 * discoveryApi / ArchitectureContext / ProjectContext mocks); findingsApi is
 * mocked so the FindingsTab's list fetches and the deep-link getFinding are
 * under test control. The Review Room itself + the right-hand panel shell
 * are stubbed -- only the OPEN-on-load wiring is under test here.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import type { DiscoveryRunDto } from '../../../api/discoveryApi';
import { renderDiscoveryRunDetailPage } from './_discoveryRunDetailPageHarness';
import { buildUnaddressedFindingEntry } from '../../../config/gapWayfindingRegistry';

// ============================================================================
// Mock setup
// ============================================================================

const mockGetDiscoveryRuns = vi.fn();
const mockGetDiscoveryRun = vi.fn();
const mockGetDiscoveryCandidateCount = vi.fn();
const mockGetDiscoveryCandidates = vi.fn();

vi.mock('../../../api/discoveryApi', () => ({
  getDiscoveryRuns: (...args: unknown[]) => mockGetDiscoveryRuns(...args),
  getDiscoveryRun: (...args: unknown[]) => mockGetDiscoveryRun(...args),
  getDiscoveryCandidateCount: (...args: unknown[]) =>
    mockGetDiscoveryCandidateCount(...args),
  getDiscoveryCandidates: (...args: unknown[]) =>
    mockGetDiscoveryCandidates(...args),
  reviewCandidate: vi.fn(),
  saveApprovedCandidates: vi.fn(),
  getReviewModel: vi.fn().mockRejectedValue(new Error('not under test')),
}));

const mockListFindings = vi.fn();
const mockGetFinding = vi.fn();

vi.mock('../../../api/findingsApi', () => {
  class FindingsApiError extends Error {
    readonly status: number;
    readonly body: { message?: string };
    constructor(status: number, body: { message?: string }) {
      super(body.message ?? `Findings API error (status ${status})`);
      this.name = 'FindingsApiError';
      this.status = status;
      this.body = body;
    }
  }
  return {
    listFindings: (...args: unknown[]) => mockListFindings(...args),
    getFinding: (...args: unknown[]) => mockGetFinding(...args),
    bulkReviewFindings: vi.fn(),
    reviewFinding: vi.fn(),
    updateFinding: vi.fn(),
    FindingsApiError,
  };
});

// The Review Room fires its own chat-thread API traffic on mount -- stub it
// (and its host panel shell) so this test exercises ONLY the open-on-load
// wiring from `?room=open`.
vi.mock('../../Discovery/DiscoveryReviewRoom', () => ({
  DiscoveryReviewRoom: () => <div data-testid="mock-discovery-review-room" />,
}));
vi.mock('../../common/RightHandPanelShell', () => ({
  RightHandPanelShell: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="mock-rhs-panel">{children}</div>
  ),
}));

const ARCH_ID = 'arch-route-params';

vi.mock('../../../contexts/ArchitectureContext', () => ({
  useActiveArchitectureId: () => ARCH_ID,
  useArchitectureContext: () => ({
    architectures: [
      {
        id: ARCH_ID,
        projectId: 'proj-1',
        name: 'Route Param Architecture',
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

vi.mock('../../../api/modelApi', () => ({
  loadModelByProjectId: vi.fn().mockResolvedValue({}),
}));

// ============================================================================
// Fixtures
// ============================================================================

const RUN_ID = 'run-route-params';

function makeRun(): DiscoveryRunDto {
  return {
    id: RUN_ID,
    project_id: 'proj-1',
    status: 'COMPLETED',
    current_step: null,
    config_snapshot: null,
    steps_payload: null,
    error_message: null,
    created_at: '2026-06-11T09:00:00Z',
    updated_at: '2026-06-11T09:30:00Z',
    architecture_id: ARCH_ID,
  } as DiscoveryRunDto;
}

function makeFinding(id: string, title: string) {
  return {
    id,
    run_id: RUN_ID,
    project_id: 'proj-1',
    architecture_id: ARCH_ID,
    finding_type: 'stored_procedure',
    category: 'database',
    severity: 'critical',
    confidence: 0.9,
    review_status: 'approved',
    previous_review_status: null,
    title,
    summary: 'A finding summary.',
    detail_json: null,
    source: 'db-scan',
    created_by_stage: '1c',
    created_at: '2026-06-11T09:10:00Z',
    updated_at: '2026-06-11T09:10:00Z',
    reviewed_at: null,
    reviewer_notes: null,
    links: [],
  };
}

let DiscoveryRunDetailPage: React.FC;

beforeEach(async () => {
  vi.clearAllMocks();
  mockGetDiscoveryRuns.mockResolvedValue([makeRun()]);
  mockGetDiscoveryRun.mockResolvedValue(makeRun());
  mockGetDiscoveryCandidateCount.mockResolvedValue({ count: 0 });
  mockGetDiscoveryCandidates.mockResolvedValue([]);
  mockListFindings.mockResolvedValue({ items: [], total: 0 });

  const mod = await import('../DiscoveryRunDetailPage');
  DiscoveryRunDetailPage = mod.DiscoveryRunDetailPage;
});

// ============================================================================
// Tests
// ============================================================================

describe('DiscoveryRunDetailPage -- ?findingId= / ?room=open route params (Spec 2026-06-11, Task Group 3)', () => {
  it('?findingId with no explicit tab -> Findings tab active, single-finding fetch fires once, drawer opens with that finding', async () => {
    mockGetFinding.mockResolvedValue(makeFinding('fnd-77', 'Deep linked finding'));

    renderDiscoveryRunDetailPage(DiscoveryRunDetailPage, {
      runId: RUN_ID,
      search: '?findingId=fnd-77',
    });

    // The Findings tab becomes the active tab without an explicit ?tab=.
    await waitFor(() => {
      expect(
        screen.getByTestId('discovery-run-detail-tab-findings'),
      ).toHaveAttribute('aria-selected', 'true');
    });

    // The dedicated single-finding fetch fired exactly once, with the param id.
    await waitFor(() => {
      expect(mockGetFinding).toHaveBeenCalledTimes(1);
    });
    expect(mockGetFinding).toHaveBeenCalledWith(
      'proj-1',
      ARCH_ID,
      RUN_ID,
      'fnd-77',
    );

    // The existing FindingDetailDrawer opens with that finding.
    await waitFor(() => {
      expect(screen.getByTestId('finding-detail-drawer')).toBeInTheDocument();
    });
    expect(screen.getByTestId('finding-detail-title')).toHaveTextContent(
      'Deep linked finding',
    );
  });

  it('unknown/404 finding id -> no drawer, no crash, no error banner', async () => {
    const { FindingsApiError } = await import('../../../api/findingsApi');
    mockGetFinding.mockRejectedValue(
      new FindingsApiError(404, { message: 'Finding not found' }),
    );

    renderDiscoveryRunDetailPage(DiscoveryRunDetailPage, {
      runId: RUN_ID,
      search: '?findingId=does-not-exist',
    });

    await waitFor(() => {
      expect(mockGetFinding).toHaveBeenCalledTimes(1);
    });
    // The findings tab still renders its normal empty state -- the failed
    // deep-link fetch is swallowed.
    await waitFor(() => {
      expect(screen.getByTestId('findings-empty')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('finding-detail-drawer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('findings-error')).not.toBeInTheDocument();
  });

  it('?room=open -> the Discovery Review Room (Architecture Room) opens on load', async () => {
    renderDiscoveryRunDetailPage(DiscoveryRunDetailPage, {
      runId: RUN_ID,
      search: '?room=open',
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('mock-discovery-review-room'),
      ).toBeInTheDocument();
    });
    // The launch toggle reflects the open state.
    expect(
      screen.getByTestId('discovery-review-room-launch-button'),
    ).toHaveTextContent('Close Architecture Room');
  });

  it('garbage param values (room=banana, empty findingId) -> page renders normally, nothing throws', async () => {
    renderDiscoveryRunDetailPage(DiscoveryRunDetailPage, {
      runId: RUN_ID,
      search: '?room=banana&findingId=',
    });

    await waitFor(() => {
      expect(screen.getByTestId('run-detail-panel')).toBeInTheDocument();
    });
    // Unrecognized room value -> room stays closed.
    expect(
      screen.queryByTestId('mock-discovery-review-room'),
    ).not.toBeInTheDocument();
    // Empty findingId -> no single-finding fetch, no drawer, and the default
    // (candidates) tab stays active.
    expect(mockGetFinding).not.toHaveBeenCalled();
    expect(screen.queryByTestId('finding-detail-drawer')).not.toBeInTheDocument();
    expect(
      screen.getByTestId('discovery-run-detail-tab-candidates'),
    ).toHaveAttribute('aria-selected', 'true');
  });
  // ==========================================================================
  // Task Group 5 — strategic addition
  // ==========================================================================

  // 5.2(b): gap-card -> deep-link flow, end to end. The URL is built by the
  // REGISTRY (`buildUnaddressedFindingEntry` -- the same helper the review
  // workspace's unaddressed-findings panel renders as its link hrefs) and
  // consumed by the Group-3 route-param handling on the run detail page:
  // path shape agrees with the run-detail route, and the query string opens
  // the finding drawer via the single-finding fetch.
  it('registry-built unaddressed-finding deep link -> run detail page opens the drawer (URL contract agreement)', async () => {
    mockGetFinding.mockResolvedValue(
      makeFinding('fnd-77', 'Registry linked finding'),
    );

    const entry = buildUnaddressedFindingEntry(
      { id: 'fnd-77', title: 'Registry linked finding', severity: 'high', runId: RUN_ID },
      { projectId: 'proj-1', architectureId: ARCH_ID },
    );
    expect(entry.destination).not.toBeNull();
    const [path, search] = (entry.destination as string).split('?');
    // Path half of the contract: the registry targets the EXACT run-detail
    // route the harness mounts.
    expect(path).toBe(
      `/projects/proj-1/architectures/${ARCH_ID}/discovery/runs/${RUN_ID}`,
    );

    // Query half of the contract: the registry-built search string drives
    // the page's param handling (findings tab + single fetch + drawer).
    renderDiscoveryRunDetailPage(DiscoveryRunDetailPage, {
      runId: RUN_ID,
      search: `?${search}`,
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('discovery-run-detail-tab-findings'),
      ).toHaveAttribute('aria-selected', 'true');
    });
    await waitFor(() => {
      expect(mockGetFinding).toHaveBeenCalledWith(
        'proj-1',
        ARCH_ID,
        RUN_ID,
        'fnd-77',
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId('finding-detail-drawer')).toBeInTheDocument();
    });
    expect(screen.getByTestId('finding-detail-title')).toHaveTextContent(
      'Registry linked finding',
    );
  });
});
