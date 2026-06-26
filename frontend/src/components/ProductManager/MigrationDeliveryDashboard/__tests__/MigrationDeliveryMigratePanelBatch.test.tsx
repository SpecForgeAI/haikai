/**
 * MigrationDeliveryMigratePanel — "Migrate selected (one branch)" (2026-06-26).
 *
 * The additive batch surface: pick a subset of spec-ready stories + a branch name
 * and send them to the implement-verify-service as ONE job -> one feature branch.
 * The whole-book Migrate button is unaffected. The batch trigger is a test-seam
 * prop; no network, no context hooks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('../MigrationDeliveryDashboard.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, prop: string | symbol) => String(prop) }),
}));

import { MigrationDeliveryMigratePanel } from '../MigrationDeliveryMigratePanel';
import type {
  TriggerMigrateResult,
  MigrationDeliveryHierarchyNodeDto,
} from '../../../../api/migrationDeliveryDashboardApi';

const PROJECT_ID = 'proj-1';
const BOOK_ID = 'book-1';

/** A spec-ready story leaf (saved-to-backlog + generated + not stale). */
function readyStory(workItemId: string, title: string): MigrationDeliveryHierarchyNodeDto {
  return {
    type: 'story',
    workItemId,
    title,
    backlogStatus: 'saved',
    specGenerationStatus: 'generated',
    staleReason: null,
    children: [],
  } as unknown as MigrationDeliveryHierarchyNodeDto;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('MigrationDeliveryMigratePanel — migrate selected (batch)', () => {
  it('sends the selected work items + batch name as ONE batch call', async () => {
    const started: TriggerMigrateResult = { status: 'started', runId: 'run-9', itemCount: 2 };
    const triggerSelected = vi.fn().mockResolvedValue(started);
    const fetchRun = vi.fn().mockResolvedValue(null);

    render(
      <MigrationDeliveryMigratePanel
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
        hierarchy={[readyStory('wi-1', 'Story 1'), readyStory('wi-3', 'Story 3')]}
        deferredWorkItemIds={new Set<string>()}
        hasActiveCurrentBaseline
        company="acme"
        project="billing"
        triggerMigrateSelectedFn={triggerSelected as never}
        fetchLatestRunFn={fetchRun as never}
      />,
    );

    // Both spec-ready stories are selectable.
    await waitFor(() =>
      expect(screen.getByTestId('mdd-migrate-select-wi-1')).toBeInTheDocument(),
    );

    // Select both + set a branch name, then launch + confirm.
    fireEvent.click(screen.getByTestId('mdd-migrate-select-wi-1'));
    fireEvent.click(screen.getByTestId('mdd-migrate-select-wi-3'));
    fireEvent.change(screen.getByTestId('mdd-migrate-batch-name-input'), {
      target: { value: 'checkout-revamp' },
    });
    fireEvent.click(screen.getByTestId('mdd-migrate-selected-button'));
    fireEvent.click(screen.getByTestId('mdd-migrate-batch-confirm-yes'));

    await waitFor(() => expect(triggerSelected).toHaveBeenCalledTimes(1));
    const [proj, book, body] = triggerSelected.mock.calls[0];
    expect(proj).toBe(PROJECT_ID);
    expect(book).toBe(BOOK_ID);
    expect([...body.selectedWorkItemIds].sort()).toEqual(['wi-1', 'wi-3']);
    expect(body.batchName).toBe('checkout-revamp');
  });

  it('disables the batch button until something is selected', async () => {
    const fetchRun = vi.fn().mockResolvedValue(null);
    render(
      <MigrationDeliveryMigratePanel
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
        hierarchy={[readyStory('wi-1', 'Story 1')]}
        deferredWorkItemIds={new Set<string>()}
        hasActiveCurrentBaseline
        company="acme"
        project="billing"
        fetchLatestRunFn={fetchRun as never}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('mdd-migrate-selected-button')).toBeDisabled(),
    );
  });
});
