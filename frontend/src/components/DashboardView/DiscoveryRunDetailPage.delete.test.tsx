/**
 * DiscoveryRunDetailPage — right-click "Delete" on the Run History rows
 * (2026-08-19). Pins the page-specific delta over the already-tested
 * DiscoveryRunsList menu: the same cursor-anchored Delete menu + server
 * cascade, PLUS deleting the run the page is currently showing navigates
 * back to the discovery list instead of refetching a dead route.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockGetDiscoveryRuns = vi.fn();
const mockGetDiscoveryRun = vi.fn();
const mockGetDiscoveryCandidateCount = vi.fn();
const mockGetDiscoveryCandidates = vi.fn();
const mockDeleteDiscoveryRun = vi.fn();
const mockNavigate = vi.fn();

vi.mock('../../api/discoveryApi', () => ({
  getDiscoveryRuns: (...a: unknown[]) => mockGetDiscoveryRuns(...a),
  getDiscoveryRun: (...a: unknown[]) => mockGetDiscoveryRun(...a),
  getDiscoveryCandidateCount: (...a: unknown[]) => mockGetDiscoveryCandidateCount(...a),
  getDiscoveryCandidates: (...a: unknown[]) => mockGetDiscoveryCandidates(...a),
  saveApprovedCandidates: vi.fn(),
  deleteDiscoveryRun: (...a: unknown[]) => mockDeleteDiscoveryRun(...a),
}));

vi.mock('../../api/modelApi', () => ({
  loadModelByProjectId: vi.fn().mockResolvedValue(null),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

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

function run(id: string, status = 'COMPLETED') {
  return {
    id,
    project_id: 'proj-1',
    architecture_id: 'arch-1',
    service_id: 'svc-1',
    discovery_kind: id === 'run-db' ? 'database' : 'code',
    status,
    current_step: null,
    config_snapshot: null,
    steps_payload: null,
    error_message: null,
    warnings: [],
    created_at: '2026-08-19T10:00:00Z',
    updated_at: '2026-08-19T10:00:00Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetDiscoveryRuns.mockResolvedValue([run('run-current'), run('run-db')]);
  mockGetDiscoveryRun.mockResolvedValue(run('run-current'));
  mockGetDiscoveryCandidateCount.mockResolvedValue({ count: 0 });
  mockGetDiscoveryCandidates.mockResolvedValue([]);
  mockDeleteDiscoveryRun.mockResolvedValue(undefined);
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

describe('DiscoveryRunDetailPage — right-click delete', () => {
  it('right-click on a (database) run opens the Delete menu; confirming cascades + refetches', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    const rows = await screen.findAllByTestId('run-list-item');
    expect(rows).toHaveLength(2);

    fireEvent.contextMenu(rows[1]); // the database-kind run
    const del = await screen.findByTestId('run-context-menu-delete');
    fireEvent.click(del);

    await waitFor(() =>
      expect(mockDeleteDiscoveryRun).toHaveBeenCalledWith('proj-1', 'arch-1', 'run-db'),
    );
    // Not the current run -> the list refetches, no navigation.
    await waitFor(() => expect(mockGetDiscoveryRuns.mock.calls.length).toBeGreaterThan(1));
    expect(mockNavigate).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('deleting the CURRENTLY-SHOWN run navigates back to the discovery list', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    const rows = await screen.findAllByTestId('run-list-item');

    fireEvent.contextMenu(rows[0]); // run-current — the route-bound run
    fireEvent.click(await screen.findByTestId('run-context-menu-delete'));

    await waitFor(() =>
      expect(mockDeleteDiscoveryRun).toHaveBeenCalledWith('proj-1', 'arch-1', 'run-current'),
    );
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(
        '/projects/proj-1/architectures/arch-1/discovery',
      ),
    );
    confirmSpy.mockRestore();
  });

  it('a dismissed confirm leaves everything untouched', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();
    const rows = await screen.findAllByTestId('run-list-item');
    fireEvent.contextMenu(rows[1]);
    fireEvent.click(await screen.findByTestId('run-context-menu-delete'));
    expect(mockDeleteDiscoveryRun).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
