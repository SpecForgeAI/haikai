/**
 * ProcBaselinesTab — the "Stored procs and functions" tab on the Live
 * behaviour surface (Spec 3, 2026-09-09).
 *
 * Covers: both lists render off the proc API (sessions newest-first with the
 * coverage counts, baselines with the pinned badge), and "Start proc capture"
 * opens the wizard.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const mockListSessions = vi.fn();
const mockListBaselines = vi.fn();
const mockDeleteSession = vi.fn();

vi.mock('../../api/procBehaviourApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/procBehaviourApi')>();
  return {
    ...actual,
    listProcCaptureSessions: (...a: unknown[]) => mockListSessions(...a),
    listProcBaselines: (...a: unknown[]) => mockListBaselines(...a),
    deleteProcCaptureSession: (...a: unknown[]) => mockDeleteSession(...a),
  };
});

// The wizard has its own suite; stub it so this test does not need the
// routine catalog.
vi.mock('./StartProcCaptureSessionWizard', () => ({
  StartProcCaptureSessionWizard: (props: { open: boolean }) =>
    props.open ? <div data-testid="mock-proc-wizard" /> : null,
}));

import { mapBaseline, mapSession } from '../../api/procBehaviourApi';
import { ProcBaselinesTab } from './ProcBaselinesTab';

const SESSION_WIRE = {
  id: 'ps-1',
  project_id: 'proj-1',
  architecture_id: 'arch-1',
  name: 'upd_ledger_roll capture',
  status: 'completed_with_findings',
  kind: 'current',
  scope_routine_ids_json: ['r-1', 'r-2'],
  coverage_summary_json: {
    routines_in_scope: 4,
    verified: 2,
    not_exercised: 1,
    unverifiable: 1,
    excluded: 0,
    per_routine: [],
    computed_at: '2026-09-09T10:00:00Z',
  },
  created_at: '2026-09-09T09:00:00Z',
};

const BASELINE_WIRE = {
  id: 'pb-1',
  session_id: 'ps-1',
  name: 'Proc baseline v1',
  status: 'pinned',
  kind: 'current',
  routine_count: 4,
  scenario_count: 21,
  content_hash: 'abc123',
  created_at: '2026-09-09T11:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockListSessions.mockResolvedValue([mapSession(SESSION_WIRE)]);
  mockListBaselines.mockResolvedValue([mapBaseline(BASELINE_WIRE)]);
});

function renderTab() {
  return render(
    <MemoryRouter>
      <ProcBaselinesTab projectId="proj-1" architectureId="arch-1" />
    </MemoryRouter>,
  );
}

describe('ProcBaselinesTab', () => {
  it('lists proc capture sessions with status + coverage counts and baselines with the pinned badge', async () => {
    renderTab();

    const sessionRow = await screen.findByTestId('proc-capture-session-row');
    expect(sessionRow.getAttribute('data-session-id')).toBe('ps-1');
    expect(sessionRow.textContent).toContain('completed_with_findings');
    expect(sessionRow.textContent).toContain('upd_ledger_roll capture');
    expect(screen.getByTestId('proc-session-coverage-ps-1').textContent).toContain(
      '2/4 verified',
    );
    expect(screen.getByTestId('proc-session-coverage-ps-1').textContent).toContain(
      '1 unverifiable',
    );

    const baselineRow = screen.getByTestId('proc-baseline-row');
    expect(baselineRow.textContent).toContain('pinned');
    expect(baselineRow.textContent).toContain('Proc baseline v1');
    expect(baselineRow.textContent).toContain('4 routines');
    expect(baselineRow.textContent).toContain('21 scenarios');

    expect(mockListSessions).toHaveBeenCalledWith('proj-1', 'arch-1');
    expect(mockListBaselines).toHaveBeenCalledWith('proj-1', 'arch-1');
  });

  it('each session row has a Delete button: confirm -> delete -> reload; cancelling the confirm deletes nothing (2026-09-12)', async () => {
    const user = userEvent.setup();
    mockDeleteSession.mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderTab();
    const button = await screen.findByTestId('proc-capture-session-delete-ps-1');
    expect((button as HTMLButtonElement).disabled).toBe(false);

    await user.click(button);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0][0]).toContain('Baselines saved from it are kept');
    expect(mockDeleteSession).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    mockListSessions.mockResolvedValue([]);
    await user.click(button);
    await waitFor(() => expect(mockDeleteSession).toHaveBeenCalledWith('proj-1', 'arch-1', 'ps-1'));
    // Reloaded after the delete: the list call fires again and the row is gone.
    await waitFor(() => expect(mockListSessions.mock.calls.length).toBeGreaterThanOrEqual(2));
    await screen.findByTestId('proc-capture-sessions-empty');
    confirmSpy.mockRestore();
  });

  it('a RUNNING session cannot be deleted from the row (cancel it first)', async () => {
    mockListSessions.mockResolvedValue([mapSession({ ...SESSION_WIRE, status: 'running' })]);
    renderTab();
    const button = await screen.findByTestId('proc-capture-session-delete-ps-1');
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute('title')).toContain('Cancel the running capture');
  });

  it('opens the start-capture wizard from the header button', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByTestId('proc-capture-session-row');

    expect(screen.queryByTestId('mock-proc-wizard')).toBeNull();
    await user.click(screen.getByTestId('proc-start-capture-button'));
    await waitFor(() => expect(screen.getByTestId('mock-proc-wizard')).toBeInTheDocument());
  });

  it('renders honest empty states when nothing has been captured yet', async () => {
    mockListSessions.mockResolvedValue([]);
    mockListBaselines.mockResolvedValue([]);
    renderTab();

    expect(await screen.findByTestId('proc-capture-sessions-empty')).toBeInTheDocument();
    expect(screen.getByTestId('proc-baselines-empty')).toBeInTheDocument();
  });
});
