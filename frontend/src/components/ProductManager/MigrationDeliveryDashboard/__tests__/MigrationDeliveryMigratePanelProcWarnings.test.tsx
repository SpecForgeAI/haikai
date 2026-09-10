/**
 * MigrationDeliveryMigratePanel — non-blocking proc-parity findings.
 *
 * Stored Proc & Function Behaviour Program, Spec 5 (2026-09-09).
 *
 * The proc-parity gate is GRADUATED: it blocks ONLY on a routine the NEXT
 * plane actually depends on. Every other non-reconciled routine comes back as
 * a `warnings` line on the start response — on a `started` launch as much as
 * on a `blocked` one.
 *
 * What this suite pins:
 *   1. The findings render under the server block reasons, in their own AMBER
 *      banner (`mdd-migrate-warnings`), one `<li>` per line.
 *   2. They render on BOTH outcomes — a run that started fine still reports.
 *   3. They are a SIGNAL, never a lock: nothing on the panel is disabled
 *      because findings exist, and no error banner appears.
 *
 * The trigger is a test-seam prop; no network, no context hooks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('../MigrationDeliveryDashboard.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

import { MigrationDeliveryMigratePanel } from '../MigrationDeliveryMigratePanel';
import type {
  TriggerMigrateResult,
  MigrationExecutionRunDto,
} from '../../../../api/migrationDeliveryDashboardApi';

const PROJECT_ID = 'proj-1';
const BOOK_ID = 'book-1';

type TriggerFn = typeof import(
  '../../../../api/migrationDeliveryDashboardApi'
).triggerMigrate;
type FetchRunFn = typeof import(
  '../../../../api/migrationDeliveryDashboardApi'
).getLatestMigrationExecutionRun;

const FINDINGS = [
  '3 routine(s) not reconciled and not depended on by the next plane: upd_ledger_roll, calc_accrual_band, fn_period_key.',
  '1 routine(s) reconciled under a waiver: upd_ledger_roll (proc-parity:volatile-timestamp).',
];

function renderPanel(result: TriggerMigrateResult) {
  const triggerFn = vi.fn().mockResolvedValue(result);
  const fetchRun = vi
    .fn()
    .mockResolvedValue(null as unknown as MigrationExecutionRunDto | null);
  render(
    <MigrationDeliveryMigratePanel
      projectId={PROJECT_ID}
      bookId={BOOK_ID}
      // No client-side block (a ready, baselined book) so the launch reaches
      // the server-side path.
      hierarchy={[]}
      deferredWorkItemIds={new Set<string>()}
      hasActiveCurrentBaseline
      company="acme"
      project="billing"
      triggerMigrateFn={triggerFn as unknown as TriggerFn}
      fetchLatestRunFn={fetchRun as unknown as FetchRunFn}
    />,
  );
  return { triggerFn };
}

async function launch() {
  await waitFor(() =>
    expect(screen.getByTestId('mdd-migrate-button')).not.toBeDisabled(),
  );
  fireEvent.click(screen.getByTestId('mdd-migrate-button'));
  fireEvent.click(screen.getByTestId('mdd-migrate-confirm-yes'));
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('MigrationDeliveryMigratePanel — proc-parity findings (Spec 5)', () => {
  it('renders the findings on a STARTED run and blocks nothing', async () => {
    const { triggerFn } = renderPanel({
      status: 'started',
      runId: 'run-1',
      itemCount: 4,
      warnings: FINDINGS,
    });

    await launch();
    await waitFor(() => expect(triggerFn).toHaveBeenCalledTimes(1));

    const banner = await screen.findByTestId('mdd-migrate-warnings');
    expect(banner.textContent).toContain('Proc parity findings (nothing blocks):');
    const lines = banner.querySelectorAll('li');
    expect(lines).toHaveLength(2);
    expect(lines[0].textContent).toContain('upd_ledger_roll');
    expect(lines[1].textContent).toContain('under a waiver');

    // Findings are a SIGNAL: the run started, so no block banner, no error, and
    // the Migrate button stays enabled.
    expect(screen.queryByTestId('mdd-migrate-server-blocked')).toBeNull();
    expect(screen.queryByTestId('mdd-migrate-error')).toBeNull();
    expect(screen.getByTestId('mdd-migrate-button')).not.toBeDisabled();
  });

  it('renders the findings alongside a BLOCKED response, under the block reasons', async () => {
    const { triggerFn } = renderPanel({
      status: 'blocked',
      reasons: [
        {
          code: 'proc_parity_dependent_routine',
          message:
            'Routine upd_ledger_roll is depended on by the service plane and is divergent.',
          workItemId: null,
        },
      ],
      warnings: FINDINGS,
    });

    await launch();
    await waitFor(() => expect(triggerFn).toHaveBeenCalledTimes(1));

    const blocked = await screen.findByTestId('mdd-migrate-server-blocked');
    const warnings = screen.getByTestId('mdd-migrate-warnings');
    expect(blocked.textContent).toContain('depended on by the service plane');
    expect(warnings.querySelectorAll('li')).toHaveLength(2);

    // Findings sit UNDER the authoritative block list, never above it.
    expect(
      blocked.compareDocumentPosition(warnings) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('renders no findings banner when the response carries none', async () => {
    const { triggerFn } = renderPanel({
      status: 'started',
      runId: 'run-2',
      itemCount: 1,
    });

    await launch();
    await waitFor(() => expect(triggerFn).toHaveBeenCalledTimes(1));

    expect(screen.queryByTestId('mdd-migrate-warnings')).toBeNull();
  });
});
