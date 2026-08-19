/**
 * DiscoveryRunDetailPage — visible S0-snapshot outcome row (2026-08-19).
 * The DB scan pins S0 automatically at completion and records the outcome
 * in steps_payload.database.s0Snapshot; the run detail must surface it as a
 * readable status row (taken = green, failed = red + reason), and stay
 * silent for runs without the field (code runs / pre-feature runs).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockGetDiscoveryRuns = vi.fn();
const mockGetDiscoveryRun = vi.fn();
const mockGetDiscoveryCandidateCount = vi.fn();
const mockGetDiscoveryCandidates = vi.fn();

vi.mock('../../api/discoveryApi', () => ({
  getDiscoveryRuns: (...a: unknown[]) => mockGetDiscoveryRuns(...a),
  getDiscoveryRun: (...a: unknown[]) => mockGetDiscoveryRun(...a),
  getDiscoveryCandidateCount: (...a: unknown[]) => mockGetDiscoveryCandidateCount(...a),
  getDiscoveryCandidates: (...a: unknown[]) => mockGetDiscoveryCandidates(...a),
  saveApprovedCandidates: vi.fn(),
  deleteDiscoveryRun: vi.fn(),
}));

vi.mock('../../api/modelApi', () => ({
  loadModelByProjectId: vi.fn().mockResolvedValue(null),
}));

vi.mock('./DiscoveryRunDetailView.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

vi.mock('../../contexts/ArchitectureContext', () => ({
  useActiveArchitectureId: () => 'arch-1',
  useArchitectureContext: () => ({
    architectures: [],
    invalidateArchitectureModelCache: vi.fn(),
  }),
  useArchitectureDispatch: () => vi.fn(),
}));

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => ({ id: 'proj-1', name: 'Project 1' }),
}));

import { DiscoveryRunDetailPage } from './DiscoveryRunDetailPage';

function run(stepsPayload: Record<string, unknown> | null) {
  return {
    id: 'run-current',
    project_id: 'proj-1',
    architecture_id: 'arch-1',
    service_id: 'svc-1',
    discovery_kind: 'database',
    status: 'COMPLETED',
    current_step: null,
    config_snapshot: null,
    steps_payload: stepsPayload,
    error_message: null,
    warnings: [],
    created_at: '2026-08-19T10:00:00Z',
    updated_at: '2026-08-19T10:00:00Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetDiscoveryCandidateCount.mockResolvedValue({ count: 0 });
  mockGetDiscoveryCandidates.mockResolvedValue([]);
});

function renderPage() {
  return render(
    <MemoryRouter
      initialEntries={[
        '/projects/proj-1/architectures/arch-1/discovery/runs/run-current',
      ]}
    >
      <DiscoveryRunDetailPage />
    </MemoryRouter>,
  );
}

describe('DiscoveryRunDetailPage — S0 snapshot outcome row', () => {
  it('renders a green "Taken with this scan" badge + table count when taken', async () => {
    const r = run({
      database: {
        tableCount: 24,
        s0Snapshot: {
          status: 'taken',
          snapshotId: 'snap-1',
          tableCount: 24,
          detail: null,
        },
      },
    });
    mockGetDiscoveryRuns.mockResolvedValue([r]);
    mockGetDiscoveryRun.mockResolvedValue(r);

    renderPage();
    const badge = await screen.findByTestId('s0-snapshot-status-taken');
    expect(badge.textContent).toBe('Taken with this scan');
    expect(badge.className).toContain('statusCompleted');
    expect(screen.getByTestId('s0-snapshot-row').textContent).toContain(
      '24 tables',
    );
  });

  it('renders a red FAILED badge with the reason when the snapshot failed', async () => {
    const r = run({
      database: {
        s0Snapshot: {
          status: 'failed',
          snapshotId: null,
          tableCount: 24,
          detail: 'validation service returned HTTP 502',
        },
      },
    });
    mockGetDiscoveryRuns.mockResolvedValue([r]);
    mockGetDiscoveryRun.mockResolvedValue(r);

    renderPage();
    const badge = await screen.findByTestId('s0-snapshot-status-failed');
    expect(badge.textContent).toBe('FAILED');
    expect(badge.className).toContain('statusFailed');
    expect(screen.getByTestId('s0-snapshot-detail').textContent).toContain(
      'validation service returned HTTP 502',
    );
  });

  it('renders nothing for runs without an s0Snapshot field', async () => {
    const r = run({ database: { tableCount: 24 } });
    mockGetDiscoveryRuns.mockResolvedValue([r]);
    mockGetDiscoveryRun.mockResolvedValue(r);

    renderPage();
    // Wait for the detail to load (phase list appears), then assert absence.
    await screen.findByTestId('phase-list');
    expect(screen.queryByTestId('s0-snapshot-row')).toBeNull();
  });
});
