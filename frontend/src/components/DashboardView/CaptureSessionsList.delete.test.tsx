/**
 * CaptureSessionsList — delete action tests.
 *
 * Pins the per-row Delete control added so a user can clean up test/iteration
 * capture sessions in place: it confirms, calls `deleteCaptureSession`, reloads
 * the list, never bubbles to the row's onSelect, and surfaces a failure in the
 * existing error banner. A dismissed confirm is a no-op.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockListCaptureSessions = vi.fn();
const mockDeleteCaptureSession = vi.fn();

vi.mock('../../api/apiBehaviourClient', () => ({
  listCaptureSessions: (...a: unknown[]) => mockListCaptureSessions(...a),
  deleteCaptureSession: (...a: unknown[]) => mockDeleteCaptureSession(...a),
}));

import { CaptureSessionsList } from './CaptureSessionsList';

const PROJECT_ID = 'proj-1';
const ARCH_ID = 'arch-1';

function session(id: string, status = 'completed') {
  return {
    id,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    name: `Session ${id}`,
    environment_name: 'non-prod',
    status,
    created_at: '2026-06-20T12:00:00Z',
    updated_at: '2026-06-20T12:00:00Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CaptureSessionsList — delete action', () => {
  it('confirms, deletes, reloads, and does NOT select the row', async () => {
    mockListCaptureSessions
      .mockResolvedValueOnce([session('s-1')])
      .mockResolvedValue([]);
    mockDeleteCaptureSession.mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onSelect = vi.fn();

    render(
      <CaptureSessionsList projectId={PROJECT_ID} architectureId={ARCH_ID} onSelect={onSelect} />,
    );

    fireEvent.click(await screen.findByTestId('capture-session-delete-s-1'));

    await waitFor(() =>
      expect(mockDeleteCaptureSession).toHaveBeenCalledWith(PROJECT_ID, ARCH_ID, 's-1'),
    );
    // Initial load + post-delete reload.
    await waitFor(() => expect(mockListCaptureSessions).toHaveBeenCalledTimes(2));
    expect(onSelect).not.toHaveBeenCalled();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    // The reload returns [] so the row is gone.
    await waitFor(() =>
      expect(screen.queryByTestId('capture-session-delete-s-1')).not.toBeInTheDocument(),
    );
  });

  it('is a no-op when the confirm dialog is dismissed', async () => {
    mockListCaptureSessions.mockResolvedValue([session('s-1')]);
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(
      <CaptureSessionsList projectId={PROJECT_ID} architectureId={ARCH_ID} onSelect={vi.fn()} />,
    );

    fireEvent.click(await screen.findByTestId('capture-session-delete-s-1'));
    expect(mockDeleteCaptureSession).not.toHaveBeenCalled();
  });

  it('surfaces a delete failure in the error banner (no crash)', async () => {
    mockListCaptureSessions.mockResolvedValue([session('s-1')]);
    mockDeleteCaptureSession.mockRejectedValue(new Error('Delete failed'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <CaptureSessionsList projectId={PROJECT_ID} architectureId={ARCH_ID} onSelect={vi.fn()} />,
    );

    fireEvent.click(await screen.findByTestId('capture-session-delete-s-1'));
    await waitFor(() => expect(screen.getByText('Delete failed')).toBeInTheDocument());
  });
});
