/**
 * Run-detail-header "Service deleted" chip tests.
 *
 * Spec: 2026-05-11 Discovery Run Robustness -- Section 2 (Task Group 5).
 *
 * Surface under test: DiscoveryRunDetailView's right-hand detail panel
 * (the `run-detail-panel` element). On an orphan run, the header renders
 * the snapshot-derived service name + an amber "Service deleted" chip
 * adjacent. On a legacy orphan (no snapshot) only the chip renders.
 * On a non-orphan run the chip is absent entirely.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { DiscoveryRunDto } from '../../../api/discoveryApi';
import { renderDiscoveryRunDetailPage } from './_discoveryRunDetailPageHarness';

// ============================================================================
// Mocks
// ============================================================================

const mockGetDiscoveryRuns = vi.fn();
const mockGetDiscoveryRun = vi.fn();
const mockGetDiscoveryCandidateCount = vi.fn();
const mockGetDiscoveryCandidates = vi.fn();
const mockSaveApprovedCandidates = vi.fn();

vi.mock('../../../api/discoveryApi', () => ({
  getDiscoveryRuns: (...args: unknown[]) => mockGetDiscoveryRuns(...args),
  getDiscoveryRun: (...args: unknown[]) => mockGetDiscoveryRun(...args),
  getDiscoveryCandidateCount: (...args: unknown[]) =>
    mockGetDiscoveryCandidateCount(...args),
  getDiscoveryCandidates: (...args: unknown[]) => mockGetDiscoveryCandidates(...args),
  saveApprovedCandidates: (...args: unknown[]) => mockSaveApprovedCandidates(...args),
  reviewCandidate: vi.fn(),
}));

vi.mock('../DiscoveryRunDetailView.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, p: string | symbol) => String(p) }),
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

import { DiscoveryRunDetailPage } from '../DiscoveryRunDetailPage';

function makeRun(overrides: Partial<DiscoveryRunDto> = {}): DiscoveryRunDto {
  return {
    id: 'run-header-test',
    project_id: 'proj-1',
    architecture_id: 'arch-uuid-default',
    status: 'COMPLETED',
    current_step: null,
    config_snapshot: null,
    steps_payload: null,
    error_message: null,
    created_at: '2026-05-11T10:00:00Z',
    updated_at: '2026-05-11T10:30:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetDiscoveryRuns.mockReset();
  mockGetDiscoveryRun.mockReset();
  mockGetDiscoveryCandidateCount.mockReset();
  mockGetDiscoveryCandidates.mockReset();
  mockGetDiscoveryCandidateCount.mockResolvedValue({ count: 0 });
  mockGetDiscoveryCandidates.mockResolvedValue([]);
});

describe('Run detail header Service deleted chip (Spec 2026-05-11 Task Group 5)', () => {
  it('renders snapshot name + amber chip in the header when the selected run is orphaned with snapshot', async () => {
    const orphanRun = makeRun({
      id: 'run-orphan',
      service_id: null,
      config_snapshot: {
        serviceIdentitySnapshot: {
          service_name: 'OldCheckoutSvc',
          service_id: 'svc-old',
          repo_location: 'r',
        },
      },
    });
    mockGetDiscoveryRuns.mockResolvedValueOnce([orphanRun]);
    mockGetDiscoveryRun.mockResolvedValueOnce(orphanRun);

    renderDiscoveryRunDetailPage(DiscoveryRunDetailPage, { runId: 'run-header-test' });

    await waitFor(() => {
      expect(screen.getByTestId('run-detail-panel')).toBeInTheDocument();
    });

    const panel = screen.getByTestId('run-detail-panel');
    const row = within(panel).getByTestId('run-detail-service-deleted-row');
    expect(
      within(row).getByTestId('run-detail-service-name-label'),
    ).toHaveTextContent('OldCheckoutSvc');
    expect(
      within(row).getByTestId('run-detail-service-deleted-chip'),
    ).toHaveTextContent(/Service deleted/i);
  });

  it('renders ONLY the chip in the header when the run is orphaned without snapshot (legacy)', async () => {
    const legacyOrphan = makeRun({
      id: 'run-legacy-orphan',
      service_id: null,
      config_snapshot: null,
    });
    mockGetDiscoveryRuns.mockResolvedValueOnce([legacyOrphan]);
    mockGetDiscoveryRun.mockResolvedValueOnce(legacyOrphan);

    renderDiscoveryRunDetailPage(DiscoveryRunDetailPage, { runId: 'run-legacy-orphan' });

    await waitFor(() => {
      expect(screen.getByTestId('run-detail-panel')).toBeInTheDocument();
    });

    const panel = screen.getByTestId('run-detail-panel');
    const row = within(panel).getByTestId('run-detail-service-deleted-row');
    expect(
      within(row).getByTestId('run-detail-service-deleted-chip'),
    ).toHaveTextContent(/Service deleted/i);
    // No service-name label when the snapshot is absent.
    expect(
      within(row).queryByTestId('run-detail-service-name-label'),
    ).not.toBeInTheDocument();
  });

  it('renders NO chip in the header when the selected run is non-orphaned', async () => {
    const boundRun = makeRun({
      id: 'run-bound',
      service_id: 'svc-still-bound',
      config_snapshot: null,
    });
    mockGetDiscoveryRuns.mockResolvedValueOnce([boundRun]);
    mockGetDiscoveryRun.mockResolvedValueOnce(boundRun);

    renderDiscoveryRunDetailPage(DiscoveryRunDetailPage, { runId: 'run-bound' });

    await waitFor(() => {
      expect(screen.getByTestId('run-detail-panel')).toBeInTheDocument();
    });

    const panel = screen.getByTestId('run-detail-panel');
    expect(
      within(panel).queryByTestId('run-detail-service-deleted-row'),
    ).not.toBeInTheDocument();
    expect(
      within(panel).queryByTestId('run-detail-service-deleted-chip'),
    ).not.toBeInTheDocument();
  });
});
