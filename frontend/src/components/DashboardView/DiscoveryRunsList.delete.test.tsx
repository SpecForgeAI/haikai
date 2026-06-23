/**
 * DiscoveryRunsList — right-click "Delete" tests.
 *
 * Pins the cursor-anchored context menu added so a user can clean up
 * test/iteration discovery runs in place: right-click opens a Delete menu;
 * confirming calls `deleteDiscoveryRun` and refetches; a dismissed confirm and
 * Escape both leave the data untouched; opening the menu never selects the row.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockGetDiscoveryRuns = vi.fn();
const mockDeleteDiscoveryRun = vi.fn();

vi.mock('../../api/discoveryApi', () => ({
  getDiscoveryRuns: (...a: unknown[]) => mockGetDiscoveryRuns(...a),
  deleteDiscoveryRun: (...a: unknown[]) => mockDeleteDiscoveryRun(...a),
}));

import { DiscoveryRunsList } from './DiscoveryRunsList';

const PROJECT_ID = 'proj-1';
const ARCH_ID = 'arch-1';

function run(id: string, status = 'COMPLETED') {
  return {
    id,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    service_id: 'svc-1',
    discovery_kind: 'code',
    status,
    current_step: null,
    config_snapshot: null,
    steps_payload: null,
    error_message: null,
    created_at: '2026-06-20T10:00:00Z',
    updated_at: '2026-06-20T10:00:00Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DiscoveryRunsList — right-click delete', () => {
  it('right-click opens a Delete menu; confirming deletes the run and refetches', async () => {
    mockGetDiscoveryRuns
      .mockResolvedValueOnce([run('r-1')])
      .mockResolvedValue([]);
    mockDeleteDiscoveryRun.mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onSelectRun = vi.fn();

    render(
      <DiscoveryRunsList
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        onSelectRun={onSelectRun}
      />,
    );

    const row = await screen.findByTestId('run-list-item');
    // The menu only exists after a right-click.
    expect(screen.queryByTestId('run-context-menu')).not.toBeInTheDocument();
    fireEvent.contextMenu(row);

    fireEvent.click(await screen.findByTestId('run-context-menu-delete'));

    await waitFor(() =>
      expect(mockDeleteDiscoveryRun).toHaveBeenCalledWith(PROJECT_ID, ARCH_ID, 'r-1'),
    );
    // Initial fetch + post-delete refetch.
    await waitFor(() => expect(mockGetDiscoveryRuns).toHaveBeenCalledTimes(2));
    // Opening the menu / deleting must never trigger row selection.
    expect(onSelectRun).not.toHaveBeenCalled();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when the confirm dialog is dismissed', async () => {
    mockGetDiscoveryRuns.mockResolvedValue([run('r-1')]);
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(
      <DiscoveryRunsList projectId={PROJECT_ID} architectureId={ARCH_ID} onSelectRun={vi.fn()} />,
    );

    fireEvent.contextMenu(await screen.findByTestId('run-list-item'));
    fireEvent.click(await screen.findByTestId('run-context-menu-delete'));
    expect(mockDeleteDiscoveryRun).not.toHaveBeenCalled();
  });

  it('Escape closes the menu without deleting', async () => {
    mockGetDiscoveryRuns.mockResolvedValue([run('r-1')]);

    render(
      <DiscoveryRunsList projectId={PROJECT_ID} architectureId={ARCH_ID} onSelectRun={vi.fn()} />,
    );

    fireEvent.contextMenu(await screen.findByTestId('run-list-item'));
    expect(await screen.findByTestId('run-context-menu')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() =>
      expect(screen.queryByTestId('run-context-menu')).not.toBeInTheDocument(),
    );
    expect(mockDeleteDiscoveryRun).not.toHaveBeenCalled();
  });
});
