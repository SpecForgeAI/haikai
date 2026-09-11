/**
 * StartProcCaptureSessionWizard (Spec 3, 2026-09-09).
 *
 * Covers the four load-bearing behaviours:
 *   - scope: triggers are listed but never selectable, and the flags
 *     (`non-compensatable`, `signature unparsed`) render off the profile;
 *   - the read-only credential pair is both-or-nothing;
 *   - Start posts create -> secrets -> start, IN THAT ORDER;
 *   - the 409 guard codes render as readable sentences with a next step.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const calls: string[] = [];
const mockListDbRoutines = vi.fn();
const mockCreateSession = vi.fn();
const mockSubmitSecrets = vi.fn();
const mockStart = vi.fn();

vi.mock('../../api/procBehaviourApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/procBehaviourApi')>();
  return {
    ...actual,
    listDbRoutines: (...a: unknown[]) => mockListDbRoutines(...a),
    createProcCaptureSession: (...a: unknown[]) => {
      calls.push('create');
      return mockCreateSession(...a);
    },
    submitProcSecrets: (...a: unknown[]) => {
      calls.push('secrets');
      return mockSubmitSecrets(...a);
    },
    startProcCapture: (...a: unknown[]) => {
      calls.push('start');
      return mockStart(...a);
    },
  };
});

import {
  ProcBehaviourApiError,
  mapRoutine,
  mapSession,
} from '../../api/procBehaviourApi';
import { StartProcCaptureSessionWizard } from './StartProcCaptureSessionWizard';

const ROUTINES = [
  mapRoutine({
    id: 'r-proc',
    schema_name: 'dbo',
    routine_name: 'upd_ledger_roll',
    routine_kind: 'procedure',
    params_json: [
      { name: '@ledger_id', ordinal: 1, source_type: 'int', direction: 'in' },
      { name: '@rolled', ordinal: 2, source_type: 'int', direction: 'output' },
    ],
    profile_json: { non_compensatable_reasons: [] },
    writes_closure_json: ['ledger', 'ledger_audit'],
    signature_parsed: true,
  }),
  mapRoutine({
    id: 'r-fn',
    schema_name: 'dbo',
    routine_name: 'fn_roll_band',
    routine_kind: 'function',
    params_json: [],
    profile_json: { non_compensatable_reasons: ['dynamic SQL with no static write set'] },
    writes_closure_json: [],
    signature_parsed: false,
  }),
  mapRoutine({
    id: 'r-trg',
    schema_name: 'dbo',
    routine_name: 'trg_ledger_audit',
    routine_kind: 'trigger',
    params_json: [],
    profile_json: {},
    writes_closure_json: ['ledger_audit'],
    signature_parsed: true,
  }),
];

const CREATED = mapSession({
  id: 'ps-new',
  project_id: 'proj-1',
  architecture_id: 'arch-1',
  name: 'Proc run',
  status: 'draft',
});

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  mockListDbRoutines.mockResolvedValue(ROUTINES);
  mockCreateSession.mockResolvedValue(CREATED);
  mockSubmitSecrets.mockResolvedValue({ ok: true, readonlySplit: false });
  mockStart.mockResolvedValue({ accepted: true, routines: 2 });
});

function renderWizard(onStarted = vi.fn()) {
  render(
    <StartProcCaptureSessionWizard
      open
      projectId="proj-1"
      architectureId="arch-1"
      onClose={vi.fn()}
      onStarted={onStarted}
    />,
  );
  return onStarted;
}

/** Walk step 1 -> 2 -> 3 with a valid DB block. */
async function advanceToStart(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByTestId('proc-scope-table');
  await user.click(screen.getByTestId('proc-start-capture-wizard-next'));
  await user.type(screen.getByTestId('proc-db-host'), 'sybase-sit');
  await user.type(screen.getByTestId('proc-db-database'), 'ledger_sit');
  await user.type(screen.getByTestId('proc-db-username'), 'capture_rw');
  await user.type(screen.getByTestId('proc-db-password'), 'pw-1');
  await user.click(screen.getByTestId('proc-start-capture-wizard-next'));
  await screen.findByTestId('proc-start-summary');
}

describe('StartProcCaptureSessionWizard — scope', () => {
  it('lists triggers but never lets them be selected, and pre-selects the rest', async () => {
    renderWizard();
    await screen.findByTestId('proc-scope-table');

    const trigger = screen.getByTestId('proc-scope-check-r-trg') as HTMLInputElement;
    expect(trigger.disabled).toBe(true);
    expect(trigger.checked).toBe(false);

    expect((screen.getByTestId('proc-scope-check-r-proc') as HTMLInputElement).checked).toBe(
      true,
    );
    expect((screen.getByTestId('proc-scope-check-r-fn') as HTMLInputElement).checked).toBe(
      true,
    );
    expect(screen.getByTestId('proc-scope-selected-count').textContent).toContain(
      '2 selected',
    );
  });

  it('flags non-compensatable routines and unparsed signatures', async () => {
    renderWizard();
    await screen.findByTestId('proc-scope-table');

    expect(
      screen.getByTestId('proc-scope-flag-non-compensatable-r-fn').textContent,
    ).toContain('non-compensatable');
    expect(
      screen.getByTestId('proc-scope-flag-signature-unparsed-r-fn').textContent,
    ).toContain('signature unparsed');
    expect(screen.queryByTestId('proc-scope-flag-non-compensatable-r-proc')).toBeNull();
  });
});

describe('StartProcCaptureSessionWizard — database step', () => {
  it('refuses a half-filled read-only pair (both-or-nothing) and says so', async () => {
    const user = userEvent.setup();
    renderWizard();
    await screen.findByTestId('proc-scope-table');
    await user.click(screen.getByTestId('proc-start-capture-wizard-next'));

    await user.type(screen.getByTestId('proc-db-host'), 'sybase-sit');
    await user.type(screen.getByTestId('proc-db-database'), 'ledger_sit');
    await user.type(screen.getByTestId('proc-db-username'), 'capture_rw');
    await user.type(screen.getByTestId('proc-db-password'), 'pw-1');
    await user.type(screen.getByTestId('proc-db-readonly-username'), 'capture_ro');

    expect(screen.getByTestId('proc-db-readonly-incomplete')).toBeInTheDocument();
    expect(
      (screen.getByTestId('proc-start-capture-wizard-next') as HTMLButtonElement).disabled,
    ).toBe(true);

    await user.type(screen.getByTestId('proc-db-readonly-password'), 'pw-ro');
    await waitFor(() =>
      expect(screen.queryByTestId('proc-db-readonly-incomplete')).toBeNull(),
    );
    expect(
      (screen.getByTestId('proc-start-capture-wizard-next') as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});

describe('StartProcCaptureSessionWizard — start', () => {
  it('posts create -> secrets -> start in order with the scope and tuning', async () => {
    const user = userEvent.setup();
    const onStarted = renderWizard();
    await advanceToStart(user);

    await user.click(screen.getByTestId('proc-start-capture-wizard-start'));

    await waitFor(() => expect(mockStart).toHaveBeenCalled());
    expect(calls).toEqual(['create', 'secrets', 'start']);

    const createBody = mockCreateSession.mock.calls[0][2];
    expect(createBody.scopeRoutineIds.sort()).toEqual(['r-fn', 'r-proc']);
    expect(createBody.dbConfigRedacted).toMatchObject({
      dbType: 'sybase',
      host: 'sybase-sit',
      port: 5000,
      database: 'ledger_sit',
      username: 'capture_rw',
    });
    expect(createBody.captureTuning).toMatchObject({
      attemptsPerScenario: 15,
      maxRowsPerResultSet: 1000,
      invocationTimeoutSeconds: 300,
      quietWindowSeconds: 120,
    });

    expect(mockSubmitSecrets).toHaveBeenCalledWith('proj-1', 'arch-1', 'ps-new', {
      password: 'pw-1',
      readonlyUsername: null,
      readonlyPassword: null,
    });
    expect(mockStart).toHaveBeenCalledWith('proj-1', 'arch-1', 'ps-new');
    expect(onStarted).toHaveBeenCalledWith(CREATED);
  });

  it('renders the S0_NOT_PINNED 409 as a readable next step', async () => {
    const user = userEvent.setup();
    mockStart.mockRejectedValue(
      new ProcBehaviourApiError(409, { error: 'S0 not pinned', code: 'S0_NOT_PINNED' }),
    );
    renderWizard();
    await advanceToStart(user);

    await user.click(screen.getByTestId('proc-start-capture-wizard-start'));

    const banner = await screen.findByTestId('proc-start-capture-wizard-error');
    expect(banner.textContent).toBe('Run the DB scan first — it pins S0 automatically.');
  });

  it('shows the server\u2019s OWN reason when the S0 re-pin failed (2026-09-11) instead of the generic next step', async () => {
    const user = userEvent.setup();
    const reason =
      'S0 is not pinned for this architecture and could not be re-pinned from the committed model ' +
      '(S0 re-pin failed: login failed). Save the DB scan (approve + commit its candidates) or re-run it, then start again.';
    mockStart.mockRejectedValue(new ProcBehaviourApiError(409, { error: reason, code: 'S0_NOT_PINNED' }));
    renderWizard();
    await advanceToStart(user);

    await user.click(screen.getByTestId('proc-start-capture-wizard-start'));

    const banner = await screen.findByTestId('proc-start-capture-wizard-error');
    expect(banner.textContent).toBe(reason);
  });
});
