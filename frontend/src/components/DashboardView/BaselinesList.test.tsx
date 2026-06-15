/**
 * BaselinesList — status action (Activate / Archive) tests.
 *
 * The 2026-06-11 gap-closure: baselines were created `draft` with NO UI path
 * to `active`, yet the migration-readiness rules require an ACTIVE baseline
 * for the api/baseline streams to read sufficient. These tests pin the new
 * per-row control: draft/archived rows offer Activate, active rows offer
 * Archive, the click PATCHes `{ status }` and reloads, and it never bubbles
 * to the row's onSelect.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockListBaselines = vi.fn();
const mockUpdateBaseline = vi.fn();

vi.mock('../../api/apiBehaviourClient', () => ({
  listBaselines: (...a: unknown[]) => mockListBaselines(...a),
  updateBaseline: (...a: unknown[]) => mockUpdateBaseline(...a),
}));

import { BaselinesList } from './BaselinesList';

const PROJECT_ID = 'proj-1';
const ARCH_ID = 'arch-1';

function baseline(id: string, status: string) {
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

describe('BaselinesList — Activate / Archive status action', () => {
  it('a DRAFT row offers Activate; clicking PATCHes status:"active", reloads, and does NOT select the row', async () => {
    mockListBaselines
      .mockResolvedValueOnce([baseline('b-1', 'draft')])
      .mockResolvedValue([baseline('b-1', 'active')]);
    mockUpdateBaseline.mockResolvedValue(baseline('b-1', 'active'));
    const onSelect = vi.fn();

    render(
      <BaselinesList
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        onSelect={onSelect}
      />,
    );

    const action = await screen.findByTestId('baseline-status-action-b-1');
    expect(action).toHaveTextContent('Activate');

    fireEvent.click(action);

    await waitFor(() =>
      expect(mockUpdateBaseline).toHaveBeenCalledWith(PROJECT_ID, ARCH_ID, 'b-1', {
        status: 'active',
      }),
    );
    // Reloaded after the PATCH (initial load + post-action load).
    await waitFor(() => expect(mockListBaselines).toHaveBeenCalledTimes(2));
    // The status click never bubbles to the row's onSelect.
    expect(onSelect).not.toHaveBeenCalled();
    // The badge/action now reflect the active state.
    expect(await screen.findByTestId('baseline-status-action-b-1')).toHaveTextContent('Archive');
  });

  it('an ACTIVE row offers Archive and an ARCHIVED row offers Activate', async () => {
    mockListBaselines.mockResolvedValue([
      baseline('b-active', 'active'),
      baseline('b-archived', 'archived'),
    ]);

    render(
      <BaselinesList
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        onSelect={vi.fn()}
      />,
    );

    expect(await screen.findByTestId('baseline-status-action-b-active')).toHaveTextContent(
      'Archive',
    );
    expect(screen.getByTestId('baseline-status-action-b-archived')).toHaveTextContent(
      'Activate',
    );
  });

  it('surfaces a failed transition in the existing error banner (no crash)', async () => {
    mockListBaselines.mockResolvedValue([baseline('b-1', 'draft')]);
    mockUpdateBaseline.mockRejectedValue(new Error('Invalid status transition'));

    render(
      <BaselinesList
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        onSelect={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByTestId('baseline-status-action-b-1'));

    // The existing render structure swaps the list for the error banner; the
    // user recovers via Refresh (which clears the error and reloads).
    await waitFor(() =>
      expect(screen.getByText('Invalid status transition')).toBeInTheDocument(),
    );
  });
});
