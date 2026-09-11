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

const mockGetLatestS0Snapshot = vi.fn();
vi.mock('../../api/s0SnapshotApi', () => ({
  getLatestS0Snapshot: (...a: unknown[]) => mockGetLatestS0Snapshot(...a),
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
  mockGetLatestS0Snapshot.mockResolvedValue({ snapshot_id: 'snap-1', tables: [] });
});

describe('DiscoveryRunDetailPage — S0 pin durability (2026-09-11)', () => {
  const taken = () =>
    run({
      database: {
        tableCount: 65,
        s0Snapshot: { status: 'taken', snapshotId: 's0-20260910195359-28080', tableCount: 65, detail: null },
      },
    });

  it('when the validation service has NO pin although the scan says taken, the row says so (and what happens next)', async () => {
    const r = taken();
    mockGetDiscoveryRuns.mockResolvedValue([r]);
    mockGetDiscoveryRun.mockResolvedValue(r);
    mockGetLatestS0Snapshot.mockResolvedValue(null);
    renderPage();
    const warn = await screen.findByTestId('s0-snapshot-pin-missing');
    expect(warn.textContent).toContain('Pin not found on the validation service');
    expect(warn.textContent).toContain('re-pinned automatically');
    expect(mockGetLatestS0Snapshot).toHaveBeenCalledWith('proj-1', 'arch-1');
    // The scan's own record still reads as taken — the record is true.
    expect(screen.getByTestId('s0-snapshot-status-taken').textContent).toBe('Taken with this scan');
  });

  it('when the pin exists (or the service is unreachable) no warning renders', async () => {
    const r = taken();
    mockGetDiscoveryRuns.mockResolvedValue([r]);
    mockGetDiscoveryRun.mockResolvedValue(r);
    renderPage();
    await screen.findByTestId('s0-snapshot-status-taken');
    expect(screen.queryByTestId('s0-snapshot-pin-missing')).toBeNull();

    mockGetLatestS0Snapshot.mockRejectedValue(new Error('down'));
    renderPage();
    await screen.findAllByTestId('s0-snapshot-status-taken');
    expect(screen.queryByTestId('s0-snapshot-pin-missing')).toBeNull();
  });

  it('the estate banner says the DB scan is SAVED once candidates are committed, instead of asking to save it', async () => {
    const r = taken();
    mockGetDiscoveryRuns.mockResolvedValue([r]);
    mockGetDiscoveryRun.mockResolvedValue(r);
    mockGetDiscoveryCandidateCount.mockResolvedValue({ count: 1 });
    mockGetDiscoveryCandidates.mockResolvedValue([
      { id: 'c1', run_id: 'run-current', name: 'orders', review_status: 'committed', candidate_type: 'physical_data_entities', confidence: 1, payload_json: {} },
    ]);
    renderPage();
    const saved = await screen.findByTestId('estate-continuation-saved');
    expect(saved.textContent).toContain('this DB scan is saved');
    expect(screen.queryByTestId('estate-continuation-unsaved')).toBeNull();
  });
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
    expect(screen.queryByTestId('routine-catalog-row')).toBeNull();
  });
});

describe('DiscoveryRunDetailPage — routine catalog outcome row (Spec 1, 2026-09-09)', () => {
  it('renders a green "N profiled" badge when the catalog saved cleanly', async () => {
    const r = run({
      database: {
        tableCount: 24,
        routineCatalog: { status: 'saved', profiled: 38, unparsed: 0, detail: null },
      },
    });
    mockGetDiscoveryRuns.mockResolvedValue([r]);
    mockGetDiscoveryRun.mockResolvedValue(r);

    renderPage();
    const badge = await screen.findByTestId('routine-catalog-status-saved');
    expect(badge.textContent).toBe('38 profiled');
    expect(badge.className).toContain('statusCompleted');
    expect(screen.queryByTestId('routine-catalog-unparsed')).toBeNull();
  });

  it('renders an amber badge plus the unparsed count when signatures failed to parse', async () => {
    const r = run({
      database: {
        routineCatalog: { status: 'saved', profiled: 38, unparsed: 2, detail: null },
      },
    });
    mockGetDiscoveryRuns.mockResolvedValue([r]);
    mockGetDiscoveryRun.mockResolvedValue(r);

    renderPage();
    const badge = await screen.findByTestId('routine-catalog-status-saved');
    expect(badge.className).toContain('statusRunning');
    expect(screen.getByTestId('routine-catalog-unparsed').textContent).toContain(
      '2 signatures unparsed',
    );
  });

  it('renders a red FAILED badge with the reason when the save failed', async () => {
    const r = run({
      database: {
        routineCatalog: {
          status: 'failed',
          profiled: 38,
          unparsed: 0,
          detail: 'AMS returned HTTP 500',
        },
      },
    });
    mockGetDiscoveryRuns.mockResolvedValue([r]);
    mockGetDiscoveryRun.mockResolvedValue(r);

    renderPage();
    const badge = await screen.findByTestId('routine-catalog-status-failed');
    expect(badge.textContent).toBe('FAILED');
    expect(badge.className).toContain('statusFailed');
    expect(screen.getByTestId('routine-catalog-detail').textContent).toContain(
      'AMS returned HTTP 500',
    );
  });
});
