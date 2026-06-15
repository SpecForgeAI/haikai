/**
 * MigrationDeliveryReconciliationPanel
 *
 * Spec: 2026-06-14 Migration Reconciliation + Bug Loop (Spec 4 of 4) --
 * Task Group 5 (5.1).
 *
 * Coverage (focused, the critical behaviours only):
 *   1. LIST: the breaks list renders per-break source operation/area
 *      (method/path/summary), disposition, attempt counter, and the
 *      circuit-breaker / needs-human escalated badge.
 *   2. SEND (the human gate): selecting a batch + "Send as bugs" invokes the
 *      bug-send client with the selected break ids, then refreshes the list.
 *   3. DISPOSE: selecting a non-sent break + assigning a disposition invokes the
 *      dispose client with the disposition + ids, then refreshes the list.
 *   4. STATES: fixed_confirmed / still_broken / circuit_broken_escalated render
 *      distinctly.
 *   5. CREDS: the `needs_target_credentials` run pause surfaces with a register
 *      action that invokes the target-credentials client.
 *
 * Conventions mirror MigrationDeliveryDashboardMigrate.test.tsx: vi.mock the CSS
 * module via a Proxy; the new reconciliation api module is mocked so the render
 * is deterministic + offline; every client is also overridable via a test-seam
 * prop.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

// Mock the CSS module so class-name access does not blow up under jsdom.
vi.mock('../MigrationDeliveryDashboard.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

// Mock the new reconciliation api module (the HARD rule: mock the api module).
vi.mock('../../../../api/migrationReconciliationApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/migrationReconciliationApi')
  >('../../../../api/migrationReconciliationApi');
  return {
    ...actual,
    getReconciliationBreaks: vi.fn(),
    sendReconciliationBreaksAsBugs: vi.fn(),
    disposeReconciliationBreaks: vi.fn(),
    registerTargetCredentials: vi.fn(),
  };
});

import { MigrationDeliveryReconciliationPanel } from '../MigrationDeliveryReconciliationPanel';
import * as reconApi from '../../../../api/migrationReconciliationApi';
import type { MigrationReconciliationBreakDto } from '../../../../api/migrationReconciliationApi';

const PROJECT_ID = 'proj-1';
const RUN_ID = 'run-1';

function makeBreak(
  partial: Partial<MigrationReconciliationBreakDto> &
    Pick<MigrationReconciliationBreakDto, 'id'>,
): MigrationReconciliationBreakDto {
  return {
    run_id: RUN_ID,
    pinned_baseline_id: 'baseline-1',
    source_baseline_item_id: `sbi-${partial.id}`,
    diff_item_id: `diff-${partial.id}`,
    detail_json: {
      method: 'GET',
      path: '/widgets',
      summary: 'status drift: 200 vs 500',
    },
    disposition_status: reconApi.BREAK_DISPOSITION.OPEN,
    bug_id: null,
    attempt_count: 0,
    circuit_broken: false,
    needs_human: false,
    error_detail: null,
    ...partial,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('MigrationDeliveryReconciliationPanel', () => {
  it('lists breaks with source operation, disposition, attempt count and escalated badge', async () => {
    vi.mocked(reconApi.getReconciliationBreaks).mockResolvedValue([
      makeBreak({ id: 'b1' }),
      makeBreak({
        id: 'b2',
        detail_json: { method: 'POST', path: '/orders', summary: 'body drift' },
        disposition_status: reconApi.BREAK_DISPOSITION.CIRCUIT_BROKEN_ESCALATED,
        attempt_count: 3,
        circuit_broken: true,
        needs_human: true,
      }),
    ]);

    render(
      <MigrationDeliveryReconciliationPanel
        projectId={PROJECT_ID}
        runId={RUN_ID}
        runStatus="reconciled"
        company="acme"
        project="billing"
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('mdd-recon-panel')).toBeInTheDocument(),
    );

    // Source operation + summary render for b1.
    const row1 = screen.getByTestId('mdd-recon-break-row-b1');
    expect(row1).toHaveTextContent('GET');
    expect(row1).toHaveTextContent('/widgets');
    expect(row1).toHaveTextContent(/status drift/i);
    expect(
      within(row1).getByTestId('mdd-recon-break-disposition-b1'),
    ).toHaveTextContent(/open/i);
    expect(
      within(row1).getByTestId('mdd-recon-break-attempt-b1'),
    ).toHaveTextContent('0');

    // b2 carries the distinct escalated / needs-human badge.
    const row2 = screen.getByTestId('mdd-recon-break-row-b2');
    expect(row2).toHaveTextContent('POST');
    expect(row2).toHaveTextContent('/orders');
    expect(
      within(row2).getByTestId('mdd-recon-break-escalated-b2'),
    ).toBeInTheDocument();
    expect(
      within(row2).getByTestId('mdd-recon-break-attempt-b2'),
    ).toHaveTextContent('3');
  });

  it('selecting breaks + Send as bugs posts the selected ids and refreshes', async () => {
    vi.mocked(reconApi.getReconciliationBreaks)
      .mockResolvedValueOnce([makeBreak({ id: 'b1' }), makeBreak({ id: 'b2' })])
      // refresh after send: b1 now sent_as_bug.
      .mockResolvedValue([
        makeBreak({
          id: 'b1',
          disposition_status: reconApi.BREAK_DISPOSITION.SENT_AS_BUG,
          bug_id: 'bug-9',
          attempt_count: 1,
        }),
        makeBreak({ id: 'b2' }),
      ]);
    vi.mocked(reconApi.sendReconciliationBreaksAsBugs).mockResolvedValue({
      status: 'sent',
      bugId: 'bug-9',
      breakCount: 1,
    });

    render(
      <MigrationDeliveryReconciliationPanel
        projectId={PROJECT_ID}
        runId={RUN_ID}
        runStatus="reconciled"
        company="acme"
        project="billing"
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('mdd-recon-break-row-b1')).toBeInTheDocument(),
    );

    // Select b1, then Send.
    fireEvent.click(screen.getByTestId('mdd-recon-select-b1'));
    fireEvent.click(screen.getByTestId('mdd-recon-send-button'));

    await waitFor(() =>
      expect(reconApi.sendReconciliationBreaksAsBugs).toHaveBeenCalledTimes(1),
    );
    expect(reconApi.sendReconciliationBreaksAsBugs).toHaveBeenCalledWith(
      PROJECT_ID,
      RUN_ID,
      expect.objectContaining({
        company: 'acme',
        project: 'billing',
        breakIds: ['b1'],
      }),
    );

    // The list refreshes (GET called again) and b1 reflects sent_as_bug.
    await waitFor(() =>
      expect(reconApi.getReconciliationBreaks).toHaveBeenCalledTimes(2),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId('mdd-recon-break-disposition-b1'),
      ).toHaveTextContent(/sent/i),
    );
  });

  it('selecting a break + assigning a disposition posts the disposition and refreshes', async () => {
    vi.mocked(reconApi.getReconciliationBreaks)
      .mockResolvedValueOnce([makeBreak({ id: 'b1' })])
      .mockResolvedValue([
        makeBreak({
          id: 'b1',
          disposition_status: reconApi.BREAK_DISPOSITION.INTENTIONAL_DEVIATION,
        }),
      ]);
    vi.mocked(reconApi.disposeReconciliationBreaks).mockResolvedValue({
      status: 'disposed',
      count: 1,
    });

    render(
      <MigrationDeliveryReconciliationPanel
        projectId={PROJECT_ID}
        runId={RUN_ID}
        runStatus="reconciled"
        company="acme"
        project="billing"
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('mdd-recon-break-row-b1')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('mdd-recon-select-b1'));
    // Choose the intentional-deviation disposition in the select.
    fireEvent.change(screen.getByTestId('mdd-recon-disposition-select'), {
      target: { value: reconApi.BREAK_DISPOSITION.INTENTIONAL_DEVIATION },
    });
    fireEvent.click(screen.getByTestId('mdd-recon-dispose-button'));

    await waitFor(() =>
      expect(reconApi.disposeReconciliationBreaks).toHaveBeenCalledTimes(1),
    );
    expect(reconApi.disposeReconciliationBreaks).toHaveBeenCalledWith(
      PROJECT_ID,
      RUN_ID,
      expect.objectContaining({
        breakIds: ['b1'],
        disposition: reconApi.BREAK_DISPOSITION.INTENTIONAL_DEVIATION,
      }),
    );

    await waitFor(() =>
      expect(reconApi.getReconciliationBreaks).toHaveBeenCalledTimes(2),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId('mdd-recon-break-disposition-b1'),
      ).toHaveTextContent(/intentional/i),
    );
  });

  it('renders fixed_confirmed / still_broken / circuit_broken_escalated distinctly', async () => {
    vi.mocked(reconApi.getReconciliationBreaks).mockResolvedValue([
      makeBreak({
        id: 'fc',
        disposition_status: reconApi.BREAK_DISPOSITION.FIXED_CONFIRMED,
        attempt_count: 1,
      }),
      makeBreak({
        id: 'sb',
        disposition_status: reconApi.BREAK_DISPOSITION.STILL_BROKEN,
        attempt_count: 2,
      }),
      makeBreak({
        id: 'cb',
        disposition_status: reconApi.BREAK_DISPOSITION.CIRCUIT_BROKEN_ESCALATED,
        attempt_count: 3,
        circuit_broken: true,
        needs_human: true,
      }),
    ]);

    render(
      <MigrationDeliveryReconciliationPanel
        projectId={PROJECT_ID}
        runId={RUN_ID}
        runStatus="reconciled"
        company="acme"
        project="billing"
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('mdd-recon-break-row-fc')).toBeInTheDocument(),
    );

    // Distinct state classes / testids per outcome.
    const fc = screen.getByTestId('mdd-recon-break-disposition-fc');
    const sb = screen.getByTestId('mdd-recon-break-disposition-sb');
    const cb = screen.getByTestId('mdd-recon-break-disposition-cb');
    expect(fc).toHaveAttribute('data-state', 'fixed_confirmed');
    expect(sb).toHaveAttribute('data-state', 'still_broken');
    expect(cb).toHaveAttribute('data-state', 'circuit_broken_escalated');

    // The escalated break shows in the needs-review queue; fixed_confirmed does not.
    expect(screen.getByTestId('mdd-recon-needs-review-queue')).toHaveTextContent(
      '/widgets',
    );
    expect(
      screen.getByTestId('mdd-recon-needs-review-item-cb'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('mdd-recon-needs-review-item-fc'),
    ).not.toBeInTheDocument();
  });

  it('surfaces the needs_target_credentials pause with a register action', async () => {
    vi.mocked(reconApi.getReconciliationBreaks).mockResolvedValue([]);
    vi.mocked(reconApi.registerTargetCredentials).mockResolvedValue({
      runId: RUN_ID,
      registered: true,
    });

    render(
      <MigrationDeliveryReconciliationPanel
        projectId={PROJECT_ID}
        runId={RUN_ID}
        runStatus="needs_target_credentials"
        company="acme"
        project="billing"
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('mdd-recon-needs-creds')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('mdd-recon-needs-creds')).toHaveTextContent(
      /target credentials/i,
    );

    // Register creds (type:'none' for a like-for-like unauthenticated target).
    fireEvent.click(screen.getByTestId('mdd-recon-register-creds-button'));

    await waitFor(() =>
      expect(reconApi.registerTargetCredentials).toHaveBeenCalledTimes(1),
    );
    expect(reconApi.registerTargetCredentials).toHaveBeenCalledWith(
      PROJECT_ID,
      RUN_ID,
      expect.objectContaining({ type: 'none' }),
    );
  });

  it('disables Send/Dispose for already-terminal breaks (oracle-unchanged dispositions are terminal)', async () => {
    vi.mocked(reconApi.getReconciliationBreaks).mockResolvedValue([
      makeBreak({
        id: 'done',
        disposition_status: reconApi.BREAK_DISPOSITION.ACCEPTED,
      }),
    ]);

    render(
      <MigrationDeliveryReconciliationPanel
        projectId={PROJECT_ID}
        runId={RUN_ID}
        runStatus="reconciled"
        company="acme"
        project="billing"
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('mdd-recon-break-row-done')).toBeInTheDocument(),
    );

    // A terminal break is not selectable -> the action buttons stay disabled.
    expect(screen.getByTestId('mdd-recon-select-done')).toBeDisabled();
    expect(screen.getByTestId('mdd-recon-send-button')).toBeDisabled();
    expect(screen.getByTestId('mdd-recon-dispose-button')).toBeDisabled();
  });
});
