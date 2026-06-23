/**
 * BaselinesList — delete action tests.
 *
 * Pins the per-row Delete control added so a user can clean up test/iteration
 * baselines in place: it confirms, calls `deleteBaseline`, reloads, and never
 * bubbles to the row's onSelect. A dismissed confirm is a no-op.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockListBaselines = vi.fn();
const mockDeleteBaseline = vi.fn();

vi.mock('../../api/apiBehaviourClient', () => ({
  listBaselines: (...a: unknown[]) => mockListBaselines(...a),
  deleteBaseline: (...a: unknown[]) => mockDeleteBaseline(...a),
  // Imported by the component but not exercised here (rows carry session_id:
  // null, so the coverage effect never calls these, and we never click
  // Activate/Archive). Stubbed so the module shape is complete.
  updateBaseline: vi.fn(),
  getCaptureSession: vi.fn(),
  reconcileInventory: vi.fn(),
}));

import { BaselinesList } from './BaselinesList';

const PROJECT_ID = 'proj-1';
const ARCH_ID = 'arch-1';

function baseline(id: string, status = 'draft') {
  return {
    id,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    session_id: null,
    name: `Baseline ${id}`,
    status,
    accepted_capture_count: 3,
    operation_count: 3,
    notes: null,
    created_at: '2026-06-10T12:00:00Z',
    updated_at: '2026-06-10T12:00:00Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BaselinesList — delete action', () => {
  it('confirms, deletes, reloads, and does NOT select the row', async () => {
    mockListBaselines
      .mockResolvedValueOnce([baseline('b-1')])
      .mockResolvedValue([]);
    mockDeleteBaseline.mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onSelect = vi.fn();

    render(<BaselinesList projectId={PROJECT_ID} architectureId={ARCH_ID} onSelect={onSelect} />);

    fireEvent.click(await screen.findByTestId('baseline-delete-b-1'));

    await waitFor(() =>
      expect(mockDeleteBaseline).toHaveBeenCalledWith(PROJECT_ID, ARCH_ID, 'b-1'),
    );
    await waitFor(() => expect(mockListBaselines).toHaveBeenCalledTimes(2));
    expect(onSelect).not.toHaveBeenCalled();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when the confirm dialog is dismissed', async () => {
    mockListBaselines.mockResolvedValue([baseline('b-1')]);
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<BaselinesList projectId={PROJECT_ID} architectureId={ARCH_ID} onSelect={vi.fn()} />);

    fireEvent.click(await screen.findByTestId('baseline-delete-b-1'));
    expect(mockDeleteBaseline).not.toHaveBeenCalled();
  });
});
