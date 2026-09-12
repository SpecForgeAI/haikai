/**
 * ProcCaptureSessionDetailPage (Spec 3, 2026-09-09).
 *
 * Covers: the routine coverage panel is DEFAULT COLLAPSED and expands on
 * demand; the envelope viewer renders result-set rows; "Not possible" posts
 * the typed reason; the page polls `/status` every 3s while a run is in
 * flight and disables the action buttons ONLY then (staleness is a signal,
 * never a lock).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mockGetSession = vi.fn();
const mockListScenarios = vi.fn();
const mockListCaptures = vi.fn();
const mockListDiagnostics = vi.fn();
const mockGetStatus = vi.fn();
const mockListDbRoutines = vi.fn();
const mockNotPossible = vi.fn();
const mockExclude = vi.fn();
const mockRetry = vi.fn();
const mockCancel = vi.fn();

vi.mock('../../api/procBehaviourApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/procBehaviourApi')>();
  return {
    ...actual,
    getProcCaptureSession: (...a: unknown[]) => mockGetSession(...a),
    listProcScenarios: (...a: unknown[]) => mockListScenarios(...a),
    listProcCaptures: (...a: unknown[]) => mockListCaptures(...a),
    listProcDiagnostics: (...a: unknown[]) => mockListDiagnostics(...a),
    getProcCaptureStatus: (...a: unknown[]) => mockGetStatus(...a),
    listDbRoutines: (...a: unknown[]) => mockListDbRoutines(...a),
    markProcRoutineNotPossible: (...a: unknown[]) => mockNotPossible(...a),
    excludeProcRoutine: (...a: unknown[]) => mockExclude(...a),
    retryUncoveredRoutines: (...a: unknown[]) => mockRetry(...a),
    cancelProcCapture: (...a: unknown[]) => mockCancel(...a),
  };
});

vi.mock('../../api/s0SnapshotApi', () => ({
  getLatestS0Snapshot: vi.fn().mockResolvedValue(null),
  restoreS0Snapshot: vi.fn(),
}));

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => ({ id: 'proj-1', name: 'Project 1' }),
}));

vi.mock('../../contexts/ArchitectureContext', () => ({
  useActiveArchitectureId: () => 'arch-1',
}));

import {
  mapCapture,
  mapScenario,
  mapSession,
  mapStatus,
} from '../../api/procBehaviourApi';
import { ProcCaptureSessionDetailPage } from './ProcCaptureSessionDetailPage';

const SESSION_WIRE = {
  id: 'ps-1',
  project_id: 'proj-1',
  architecture_id: 'arch-1',
  name: 'Ledger routines capture',
  status: 'completed_with_findings',
  kind: 'current',
  coverage_summary_json: {
    routines_in_scope: 2,
    verified: 1,
    not_exercised: 1,
    unverifiable: 0,
    excluded: 0,
    per_routine: [
      {
        routine_id: 'r-proc',
        routine_name: 'dbo.upd_ledger_roll',
        bucket: 'verified',
        required: ['success', 'return:1', 'raiserror:20001'],
        achieved: ['success', 'return:1', 'raiserror:20001'],
        missing: [],
        floor_met: true,
        scenarios_fired: 3,
        captures_accepted: 3,
      },
      {
        routine_id: 'r-fn',
        routine_name: 'dbo.fn_roll_band',
        bucket: 'not_exercised',
        required: ['success', 'return:0'],
        achieved: [],
        missing: ['success', 'return:0'],
        floor_met: false,
        scenarios_fired: 0,
        captures_accepted: 0,
      },
    ],
    computed_at: '2026-09-09T12:00:00Z',
  },
};

const SCENARIO_WIRE = {
  id: 'sc-1',
  routine_id: 'r-proc',
  scenario_name: 'rolls one open ledger',
  scenario_type: 'happy_path',
  generation_source: 'llm_generated',
  inputs_json: [{ name: '@ledger_id', value: 42, is_null: false }],
  status: 'fired',
};

const CAPTURE_WIRE = {
  id: 'cap-1',
  scenario_id: 'sc-1',
  routine_id: 'r-proc',
  attempt_number: 1,
  accepted: true,
  bracket_outcome: 'compensated',
  duration_ms: 84,
  envelope_json: {
    outcome: 'success',
    return_status: 0,
    output_params: { '@rolled': 1 },
    result_sets: [
      {
        ordinal: 0,
        columns: [
          { name: 'ledger_id', type: 'int' },
          { name: 'band', type: 'varchar' },
        ],
        rows: [
          [42, 'CORE'],
          [43, 'EDGE'],
        ],
        row_count: 2,
        truncated: false,
      },
    ],
    messages: [],
    error: null,
    timing_ms: 84,
  },
  state_delta_json: { ledger: 1 },
};

function statusPayload(inFlight: boolean) {
  return mapStatus({
    session: SESSION_WIRE,
    run: inFlight
      ? {
          in_flight: true,
          phase: 'firing scenarios',
          routine_index: 1,
          routine_total: 2,
          scenarios_fired: 3,
          captures_accepted: 3,
        }
      : { in_flight: false },
    secrets_loaded: true,
    s0_pinned: true,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue(mapSession(SESSION_WIRE));
  mockListScenarios.mockResolvedValue([mapScenario(SCENARIO_WIRE)]);
  mockListCaptures.mockResolvedValue([mapCapture(CAPTURE_WIRE)]);
  mockListDiagnostics.mockResolvedValue([]);
  mockListDbRoutines.mockResolvedValue([]);
  mockGetStatus.mockResolvedValue(statusPayload(false));
  mockNotPossible.mockResolvedValue(undefined);
  mockExclude.mockResolvedValue(undefined);
  mockRetry.mockResolvedValue({ accepted: true });
});

afterEach(() => {
  vi.useRealTimers();
});

function renderPage() {
  return render(
    <MemoryRouter
      initialEntries={[
        '/projects/proj-1/architectures/arch-1/proc-behaviour/capture-sessions/ps-1',
      ]}
    >
      <Routes>
        <Route
          path="/projects/:projectId/architectures/:architectureId/proc-behaviour/capture-sessions/:sessionId"
          element={<ProcCaptureSessionDetailPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProcCaptureSessionDetailPage — coverage panel', () => {
  it('a STRANDED session (status running, no run in flight) explains itself and offers Stop, which cancels it (2026-09-12)', async () => {
    const user = userEvent.setup();
    const runningWire = { ...SESSION_WIRE, status: 'running' };
    mockGetSession.mockResolvedValue(mapSession(runningWire));
    mockGetStatus.mockResolvedValue(mapStatus({ session: runningWire, run: { in_flight: false } }));
    mockCancel.mockResolvedValue(undefined);
    renderPage();

    const note = await screen.findByTestId('proc-session-stranded');
    expect(note.textContent).toContain('no capture run is in flight');
    const stop = screen.getByTestId('proc-session-cancel');
    expect(stop.textContent).toBe('Stop run');

    const cancelledWire = { ...SESSION_WIRE, status: 'cancelled' };
    mockGetStatus.mockResolvedValue(mapStatus({ session: cancelledWire, run: { in_flight: false } }));
    mockGetSession.mockResolvedValue(mapSession(cancelledWire));
    await user.click(stop);
    await waitFor(() => expect(mockCancel).toHaveBeenCalledWith('proj-1', 'arch-1', 'ps-1'));
    await waitFor(() => expect(screen.getByTestId('proc-session-status').textContent).toBe('cancelled'));
    expect(screen.queryByTestId('proc-session-stranded')).toBeNull();
    expect(screen.queryByTestId('proc-session-cancel')).toBeNull();
  });

  it('offers the S0 restore panel on a finished proc session (2026-09-12: the only restore path used to be the API session page)', async () => {
    renderPage();
    const panel = await screen.findByTestId('s0-restore-panel');
    expect(panel.textContent).toContain('Canonical state (S0)');
  });

  it('renders the coverage roll-up collapsed by default and expands per-routine rows on demand', async () => {
    const user = userEvent.setup();
    renderPage();

    const panel = await screen.findByTestId('proc-coverage-panel');
    expect(panel.getAttribute('data-collapsed')).toBe('true');
    expect(screen.getByTestId('proc-coverage-panel-summary').textContent).toContain(
      '1 of 2 verified',
    );
    expect(screen.queryByTestId('proc-coverage-panel-detail')).toBeNull();

    await user.click(screen.getByTestId('proc-coverage-panel-toggle'));

    const detail = await screen.findByTestId('proc-coverage-panel-detail');
    expect(detail).toBeInTheDocument();
    const rows = screen.getAllByTestId('proc-coverage-panel-row');
    expect(rows).toHaveLength(2);
    expect(rows[1].getAttribute('data-bucket')).toBe('not_exercised');
    expect(rows[1].textContent).toContain('success, return:0');
  });
});

describe('ProcCaptureSessionDetailPage — envelope viewer', () => {
  it('expands a scenario into the envelope with its result-set rows', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByTestId('proc-session-scenario-row');
    expect(screen.queryByTestId('proc-envelope-cap-1')).toBeNull();

    await user.click(screen.getByTestId('proc-scenario-toggle-sc-1'));

    const envelope = await screen.findByTestId('proc-envelope-cap-1');
    expect(envelope.getAttribute('data-outcome')).toBe('success');
    expect(screen.getByTestId('proc-envelope-cap-1-outcome').textContent).toContain(
      'return status',
    );
    expect(screen.getByTestId('proc-envelope-cap-1-output-params').textContent).toContain(
      '@rolled',
    );
    const rows = screen.getAllByTestId('proc-envelope-cap-1-result-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('CORE');
    expect(screen.getByTestId('proc-envelope-cap-1-state-delta').textContent).toContain(
      'ledger: 1',
    );
  });
});

describe('ProcCaptureSessionDetailPage — retry / not-possible', () => {
  it('posts the typed reason when a routine is marked not possible', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByTestId('proc-coverage-panel');
    await user.click(screen.getByTestId('proc-session-retry-uncovered'));

    const row = await screen.findByTestId('proc-retry-uncovered-modal-row');
    expect(row.getAttribute('data-routine-id')).toBe('r-fn');

    // The waiver is inert until a reason exists — no manual residue.
    expect(
      (screen.getByTestId('proc-retry-uncovered-modal-not-possible-r-fn') as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    await user.type(
      screen.getByTestId('proc-retry-uncovered-modal-reason-r-fn'),
      'needs a caller-supplied cursor no client can build',
    );
    await user.click(screen.getByTestId('proc-retry-uncovered-modal-not-possible-r-fn'));

    expect(mockNotPossible).toHaveBeenCalledWith(
      'proj-1',
      'arch-1',
      'ps-1',
      'r-fn',
      'needs a caller-supplied cursor no client can build',
    );
  });
});

describe('ProcCaptureSessionDetailPage — in-flight run', () => {
  it('polls /status every 3s while the run is in flight and disables the actions only then', async () => {
    vi.useFakeTimers();
    mockGetStatus.mockResolvedValue(statusPayload(true));
    renderPage();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockGetStatus).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('proc-session-phase').textContent).toContain(
      'firing scenarios',
    );
    expect(
      (screen.getByTestId('proc-session-retry-uncovered') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId('proc-session-save-baseline') as HTMLButtonElement).disabled,
    ).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(mockGetStatus).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(mockGetStatus).toHaveBeenCalledTimes(3);
  });
});
