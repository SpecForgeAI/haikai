/**
 * ProcBaselineDetailPage (Spec 3, 2026-09-09).
 *
 * Covers: the header facts (pin state, counts, S0 fingerprint, content hash),
 * items grouped by routine with the exit outcome, the loud stale badge when a
 * routine body hash has moved since capture, the expected-envelope viewer,
 * and the Pin button appearing only for a non-pinned baseline.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mockGetBaseline = vi.fn();
const mockListItems = vi.fn();
const mockListDbRoutines = vi.fn();
const mockPin = vi.fn();

vi.mock('../../api/procBehaviourApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/procBehaviourApi')>();
  return {
    ...actual,
    getProcBaseline: (...a: unknown[]) => mockGetBaseline(...a),
    listProcBaselineItems: (...a: unknown[]) => mockListItems(...a),
    listDbRoutines: (...a: unknown[]) => mockListDbRoutines(...a),
    pinProcBaseline: (...a: unknown[]) => mockPin(...a),
  };
});

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => ({ id: 'proj-1', name: 'Project 1' }),
}));

vi.mock('../../contexts/ArchitectureContext', () => ({
  useActiveArchitectureId: () => 'arch-1',
}));

import { mapBaseline, mapBaselineItem } from '../../api/procBehaviourApi';
import { ProcBaselineDetailPage } from './ProcBaselineDetailPage';

function baselineWire(status: string) {
  return {
    id: 'pb-1',
    session_id: 'ps-1',
    name: 'Ledger proc baseline',
    status,
    kind: 'current',
    routine_count: 1,
    scenario_count: 2,
    content_hash: 'sha256:beefcafe',
    s0_fingerprint_json: { fingerprint: 'fp-s0-1' },
    created_at: '2026-09-09T12:00:00Z',
  };
}

const ITEMS = [
  mapBaselineItem({
    id: 'bi-1',
    routine_id: 'r-proc',
    routine_body_hash: 'h1',
    scenario_name: 'rolls one open ledger',
    scenario_type: 'happy_path',
    exit_outcome: 'success',
    inputs_json: [{ name: '@ledger_id', value: 42, is_null: false }],
    expected_envelope_json: {
      outcome: 'success',
      return_status: 0,
      result_sets: [
        {
          ordinal: 0,
          columns: [{ name: 'ledger_id', type: 'int' }],
          rows: [[42]],
          row_count: 1,
        },
      ],
    },
    stale: false,
  }),
  mapBaselineItem({
    id: 'bi-2',
    routine_id: 'r-proc',
    routine_body_hash: 'h0',
    scenario_name: 'raises on a closed ledger',
    scenario_type: 'error_path',
    exit_outcome: 'error:20001',
    inputs_json: [],
    expected_envelope_json: { outcome: 'error', error: { number: 20001, message: 'closed' } },
    stale: true,
    stale_reason: 'routine body hash changed since capture',
  }),
];

beforeEach(() => {
  vi.clearAllMocks();
  mockGetBaseline.mockResolvedValue(mapBaseline(baselineWire('pinned')));
  mockListItems.mockResolvedValue(ITEMS);
  mockListDbRoutines.mockResolvedValue([]);
  mockPin.mockResolvedValue(mapBaseline(baselineWire('pinned')));
});

function renderPage() {
  return render(
    <MemoryRouter
      initialEntries={['/projects/proj-1/architectures/arch-1/proc-behaviour/baselines/pb-1']}
    >
      <Routes>
        <Route
          path="/projects/:projectId/architectures/:architectureId/proc-behaviour/baselines/:baselineId"
          element={<ProcBaselineDetailPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProcBaselineDetailPage', () => {
  it('renders the header facts, the items grouped by routine and the stale badge', async () => {
    renderPage();

    expect((await screen.findByTestId('proc-baseline-name')).textContent).toBe(
      'Ledger proc baseline',
    );
    expect(screen.getByTestId('proc-baseline-status').textContent).toBe('pinned');
    expect(screen.getByTestId('proc-baseline-s0').textContent).toBe('fp-s0-1');
    expect(screen.getByTestId('proc-baseline-content-hash').textContent).toBe(
      'sha256:beefcafe',
    );
    expect(screen.getByTestId('proc-baseline-facts').textContent).toContain('Scenarios:');

    expect(screen.getAllByTestId('proc-baseline-routine-group')).toHaveLength(1);
    const rows = screen.getAllByTestId('proc-baseline-item-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('exit: success');
    expect(rows[1].getAttribute('data-stale')).toBe('true');
    expect(screen.getByTestId('proc-baseline-stale-bi-2').textContent).toBe('stale');
    expect(screen.getByTestId('proc-baseline-stale-reason-bi-2').textContent).toContain(
      'routine body hash changed',
    );
    expect(screen.getByTestId('proc-baseline-stale-count').textContent).toContain(
      '1 stale item',
    );

    // Pinned baseline: no Pin button.
    expect(screen.queryByTestId('proc-baseline-pin')).toBeNull();
  });

  it('expands an item into its expected envelope', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByTestId('proc-baseline-items');
    await user.click(screen.getByTestId('proc-baseline-item-toggle-bi-1'));

    const envelope = await screen.findByTestId('proc-baseline-envelope-bi-1');
    expect(envelope.getAttribute('data-outcome')).toBe('success');
    expect(screen.getAllByTestId('proc-baseline-envelope-bi-1-result-row')).toHaveLength(1);
  });

  // ----------------------------------------------------------------------
  // Spec 5 (2026-09-09) — source drift is a SIGNAL, never a lock
  // ----------------------------------------------------------------------

  it('renders the drift banner counting ROUTINES (not items) and disables nothing', async () => {
    // Two stale items on ONE routine + one stale item on a second routine =
    // 2 routines drifted, not 3 items.
    mockListItems.mockResolvedValue([
      ...ITEMS,
      mapBaselineItem({
        id: 'bi-3',
        routine_id: 'r-proc',
        routine_body_hash: 'h0',
        scenario_name: 'raises on a missing ledger',
        scenario_type: 'error_path',
        exit_outcome: 'error:20002',
        inputs_json: [],
        expected_envelope_json: { outcome: 'error' },
        stale: true,
        stale_reason: 'body_changed',
      }),
      mapBaselineItem({
        id: 'bi-4',
        routine_id: 'r-fn',
        routine_body_hash: 'h9',
        scenario_name: 'derives the period key',
        scenario_type: 'happy_path',
        exit_outcome: 'success',
        inputs_json: [],
        expected_envelope_json: { outcome: 'success' },
        stale: true,
        stale_reason: 'body_changed',
      }),
    ]);
    mockGetBaseline.mockResolvedValue(mapBaseline(baselineWire('draft')));
    renderPage();

    const banner = await screen.findByTestId('proc-baseline-drift-banner');
    expect(banner.textContent).toContain('2 routine(s) changed since capture');
    expect(banner.textContent).toContain('re-capture (scoped) and re-run the translation loop');

    // Signal only: the Pin button (the one action on this page) stays live.
    expect((screen.getByTestId('proc-baseline-pin') as HTMLButtonElement).disabled).toBe(false);
  });

  it('renders no drift banner when nothing has drifted', async () => {
    mockListItems.mockResolvedValue([ITEMS[0]]); // the one non-stale item
    renderPage();

    await screen.findByTestId('proc-baseline-items');
    expect(screen.queryByTestId('proc-baseline-drift-banner')).toBeNull();
  });

  it('offers Pin for a draft baseline and posts it', async () => {
    const user = userEvent.setup();
    mockGetBaseline.mockResolvedValue(mapBaseline(baselineWire('draft')));
    renderPage();

    const pin = await screen.findByTestId('proc-baseline-pin');
    await user.click(pin);

    await waitFor(() =>
      expect(mockPin).toHaveBeenCalledWith('proj-1', 'arch-1', 'pb-1'),
    );
  });
});
