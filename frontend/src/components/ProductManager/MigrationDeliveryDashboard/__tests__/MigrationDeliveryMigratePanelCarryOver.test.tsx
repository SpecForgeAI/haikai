/**
 * MigrationDeliveryMigratePanel — carry_over_not_accounted blocked reason (D4).
 *
 * Spec: 2026-06-14 D4 — Carry-over Completeness Gate — Task Group 4.1 (c) +
 * the closing wiring pass (Task Group 5 follow-up): the blocked-reason
 * affordance is now a CLICKABLE deep-link that opens the book-scoped
 * completeness review surface (when the dashboard supplies `onReviewCarryOver`),
 * and the panel re-checks the gate when its parent bumps `refreshToken` (so the
 * stale server-side carry_over block clears once everything is accounted for and
 * the user can retry Migrate).
 *
 * The Migrate panel surfaces THAT there is un-accounted carry_over work: when a
 * launch attempt is refused server-side with a `carry_over_not_accounted`
 * reason, the panel renders it in the existing `serverBlockReasons` list (it is
 * a structured `MigrateBlockReason` like the others) and exposes a deep-link to
 * the completeness review surface so the user can go cite / dismiss. The actual
 * cite/dismiss pass happens on the extended Capabilities view (D7), not here.
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

beforeEach(() => {
  vi.resetAllMocks();
});

describe('MigrationDeliveryMigratePanel — carry_over_not_accounted (D4)', () => {
  it('renders the carry_over_not_accounted server-blocked reason with a deep-link', async () => {
    const blocked: TriggerMigrateResult = {
      status: 'blocked',
      reasons: [
        {
          code: 'carry_over_not_accounted',
          message:
            'Behaviour-bearing carry_over capability "cap-1" is neither cited by a story nor dismissed.',
          workItemId: null,
        },
      ],
    };
    const triggerFn = vi.fn().mockResolvedValue(blocked);
    const fetchRun = vi.fn().mockResolvedValue(null);

    render(
      <MigrationDeliveryMigratePanel
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
        // No client-side block (a ready, baselined book) so the button is
        // enabled and we can drive the server-side blocked path.
        hierarchy={[]}
        deferredWorkItemIds={new Set<string>()}
        hasActiveCurrentBaseline
        company="acme"
        project="billing"
        triggerMigrateFn={triggerFn as unknown as TriggerFn}
        fetchLatestRunFn={fetchRun as unknown as FetchRunFn}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('mdd-migrate-button')).not.toBeDisabled(),
    );

    fireEvent.click(screen.getByTestId('mdd-migrate-button'));
    fireEvent.click(screen.getByTestId('mdd-migrate-confirm-yes'));

    await waitFor(() => expect(triggerFn).toHaveBeenCalledTimes(1));

    // The server-blocked banner shows the carry_over message.
    const banner = await screen.findByTestId('mdd-migrate-server-blocked');
    expect(banner).toHaveTextContent(/carry_over capability/i);

    // A deep-link affordance to the completeness review surface renders for the
    // carry_over reason.
    expect(
      screen.getByTestId('mdd-migrate-carry-over-link'),
    ).toBeInTheDocument();
  });

  it('renders a CLICKABLE review affordance that opens the review surface (onReviewCarryOver)', async () => {
    const blocked: TriggerMigrateResult = {
      status: 'blocked',
      reasons: [
        {
          code: 'carry_over_not_accounted',
          message:
            'Behaviour-bearing carry_over capability "cap-1" is neither cited by a story nor dismissed.',
          workItemId: null,
        },
      ],
    };
    const triggerFn = vi.fn().mockResolvedValue(blocked);
    const fetchRun = vi.fn().mockResolvedValue(null);
    const onReviewCarryOver = vi.fn();

    render(
      <MigrationDeliveryMigratePanel
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
        hierarchy={[]}
        deferredWorkItemIds={new Set<string>()}
        hasActiveCurrentBaseline
        company="acme"
        project="billing"
        triggerMigrateFn={triggerFn as unknown as TriggerFn}
        fetchLatestRunFn={fetchRun as unknown as FetchRunFn}
        onReviewCarryOver={onReviewCarryOver}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('mdd-migrate-button')).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId('mdd-migrate-button'));
    fireEvent.click(screen.getByTestId('mdd-migrate-confirm-yes'));

    // The deep-link is a real <button> (clickable), not inert text.
    const link = await screen.findByTestId('mdd-migrate-carry-over-link');
    expect(link.tagName).toBe('BUTTON');

    fireEvent.click(link);
    expect(onReviewCarryOver).toHaveBeenCalledTimes(1);
  });

  it('clears the stale server-side carry_over block when the parent bumps refreshToken', async () => {
    const blocked: TriggerMigrateResult = {
      status: 'blocked',
      reasons: [
        {
          code: 'carry_over_not_accounted',
          message:
            'Behaviour-bearing carry_over capability "cap-1" is neither cited by a story nor dismissed.',
          workItemId: null,
        },
      ],
    };
    const triggerFn = vi.fn().mockResolvedValue(blocked);
    const fetchRun = vi.fn().mockResolvedValue(null);

    const { rerender } = render(
      <MigrationDeliveryMigratePanel
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
        hierarchy={[]}
        deferredWorkItemIds={new Set<string>()}
        hasActiveCurrentBaseline
        company="acme"
        project="billing"
        triggerMigrateFn={triggerFn as unknown as TriggerFn}
        fetchLatestRunFn={fetchRun as unknown as FetchRunFn}
        onReviewCarryOver={vi.fn()}
        refreshToken={0}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('mdd-migrate-button')).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId('mdd-migrate-button'));
    fireEvent.click(screen.getByTestId('mdd-migrate-confirm-yes'));

    // The stale server-side block is showing.
    expect(
      await screen.findByTestId('mdd-migrate-server-blocked'),
    ).toBeInTheDocument();

    // The user accounted for everything on the review surface; the parent bumps
    // refreshToken on close -> the panel re-checks the gate (reloads the run +
    // drops the stale server-side block so the carry_over banner disappears and
    // the user can retry Migrate).
    fetchRun.mockClear();
    rerender(
      <MigrationDeliveryMigratePanel
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
        hierarchy={[]}
        deferredWorkItemIds={new Set<string>()}
        hasActiveCurrentBaseline
        company="acme"
        project="billing"
        triggerMigrateFn={triggerFn as unknown as TriggerFn}
        fetchLatestRunFn={fetchRun as unknown as FetchRunFn}
        onReviewCarryOver={vi.fn()}
        refreshToken={1}
      />,
    );

    await waitFor(() =>
      expect(
        screen.queryByTestId('mdd-migrate-server-blocked'),
      ).not.toBeInTheDocument(),
    );
    // And the gate was re-checked (run re-read).
    expect(fetchRun).toHaveBeenCalled();
  });

  it('still renders the existing reasons unchanged (no-regression) when no carry_over reason is present', async () => {
    const blocked: TriggerMigrateResult = {
      status: 'blocked',
      reasons: [
        {
          code: 'missing_current_baseline',
          message: 'No active current-state API-behaviour baseline exists.',
        },
      ],
    };
    const triggerFn = vi.fn().mockResolvedValue(blocked);
    const fetchRun = vi
      .fn()
      .mockResolvedValue(null as MigrationExecutionRunDto | null);

    render(
      <MigrationDeliveryMigratePanel
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
        hierarchy={[]}
        deferredWorkItemIds={new Set<string>()}
        hasActiveCurrentBaseline
        company="acme"
        project="billing"
        triggerMigrateFn={triggerFn as unknown as TriggerFn}
        fetchLatestRunFn={fetchRun as unknown as FetchRunFn}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('mdd-migrate-button')).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId('mdd-migrate-button'));
    fireEvent.click(screen.getByTestId('mdd-migrate-confirm-yes'));

    const banner = await screen.findByTestId('mdd-migrate-server-blocked');
    expect(banner).toHaveTextContent(/baseline/i);
    // No carry_over deep-link when there is no carry_over reason.
    expect(
      screen.queryByTestId('mdd-migrate-carry-over-link'),
    ).toBeNull();
  });
});
