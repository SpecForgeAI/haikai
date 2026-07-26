/**
 * MigrationCarryOverAccountingPanel — the four manual accounting actions
 * (carry-over triage plumbing, 2026-07-26,
 * agent-os/planning/2026-07-26-carry-over-triage-build-plan.md Item 1).
 *
 * Pins, against a fully-mocked API surface:
 *   1. CITE — pick a story → the cite-finding call carries the story blob id +
 *      finding id, and the coverage REFRESHES after the action;
 *   2. AMEND — picking the target story PREFILLS its current description; the
 *      amend call carries description + parsed criteria lines + the finding;
 *   3. NEW STORY (finding) — prefilled title/summary from the item detail; the
 *      create call carries workstream + criteria + the finding reference;
 *   4. DISMISS — the confirm stays disabled on a blank reason (the gate
 *      ignores reasonless dismissals); the call carries architecture_id + the
 *      finding's RUN id (the AMS review is run-scoped);
 *   5. a CAPABILITY's "New story" routes to the existing
 *      append-capability-story cite (not the finding add-item).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../MigrationBookOfWork.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

const mockGetCarryOverCoverage = vi.fn();
const mockDismissCarryOverItem = vi.fn();
const mockCiteCapability = vi.fn();
const mockCiteFindingIntoStory = vi.fn();
const mockAmendStoryForFinding = vi.fn();
const mockCreateStoryForFinding = vi.fn();

vi.mock('../../../../api/carryOverCoverageApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/carryOverCoverageApi')
  >('../../../../api/carryOverCoverageApi');
  return {
    ...actual,
    getCarryOverCoverage: (...args: unknown[]) => mockGetCarryOverCoverage(...args),
    dismissCarryOverItem: (...args: unknown[]) => mockDismissCarryOverItem(...args),
    citeCapability: (...args: unknown[]) => mockCiteCapability(...args),
    citeFindingIntoStory: (...args: unknown[]) => mockCiteFindingIntoStory(...args),
    amendStoryForFinding: (...args: unknown[]) => mockAmendStoryForFinding(...args),
    createStoryForFinding: (...args: unknown[]) => mockCreateStoryForFinding(...args),
  };
});

import MigrationCarryOverAccountingPanel from '../MigrationCarryOverAccountingPanel';

const PROJECT_ID = 'proj-1';
const BOOK_ID = 'book-1';
const ARCH_ID = 'arch-1';

const STORIES = [
  {
    id: 's-close',
    title: 'Recreate the ledger close endpoint',
    description: 'Implements POST /ledger/close verbatim.',
  },
  {
    id: 's-purge',
    title: 'Recreate the archive purge job',
    description: 'Weekly purge of archived rows.',
  },
];

function blockingCoverage() {
  return {
    items: [],
    mustAccount: [
      { kind: 'finding', id: 'f-1', status: 'un-actioned', behaviourBearing: true, label: 'f-1' },
      { kind: 'capability', id: 'cap-1', status: 'un-actioned', behaviourBearing: true, label: 'cap-1' },
    ],
    unaccounted: [
      { kind: 'finding', id: 'f-1', status: 'un-actioned', behaviourBearing: true, label: 'f-1' },
      { kind: 'capability', id: 'cap-1', status: 'un-actioned', behaviourBearing: true, label: 'cap-1' },
    ],
    accountedCount: 0,
    totalMustAccount: 2,
    ok: false,
    architectureId: ARCH_ID,
    itemDetails: {
      'f-1': {
        kind: 'finding',
        title: 'Close job halts on replication lag',
        summary: 'The close aborts when replication lag exceeds 5 minutes.',
        severity: 'high',
        category: 'operational_artifact',
        runId: 'run-9',
        reviewStatus: 'approved',
        memberFindingCount: null,
      },
      'cap-1': {
        kind: 'capability',
        title: 'Nightly batch spine',
        summary: 'The overnight close chain.',
        severity: null,
        category: 'batch',
        runId: 'run-9',
        reviewStatus: 'approved',
        memberFindingCount: 3,
      },
    },
  };
}

async function renderPanelExpanded(onCoverageChanged = vi.fn()) {
  render(
    <MigrationCarryOverAccountingPanel
      projectId={PROJECT_ID}
      bookId={BOOK_ID}
      stories={STORIES}
      onCoverageChanged={onCoverageChanged}
    />,
  );
  fireEvent.click(await screen.findByTestId('carry-over-accounting-toggle'));
  return onCoverageChanged;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCarryOverCoverage.mockResolvedValue(blockingCoverage());
  mockDismissCarryOverItem.mockResolvedValue({ ok: true });
  mockCiteCapability.mockResolvedValue({ work_item_id: 'wi-new' });
  mockCiteFindingIntoStory.mockResolvedValue({ ok: true, alreadyCited: false });
  mockAmendStoryForFinding.mockResolvedValue({ ok: true, workItemId: 'wi-1', specsMarkedStale: 1 });
  mockCreateStoryForFinding.mockResolvedValue({ ok: true, workItemId: 'wi-new', bookItemId: 'manual-x' });
});

describe('MigrationCarryOverAccountingPanel actions', () => {
  it('CITE: picking a story cites the finding onto it and the coverage refreshes', async () => {
    await renderPanelExpanded();

    fireEvent.click(screen.getByTestId('carry-over-cite-f-1'));
    fireEvent.change(screen.getByTestId('carry-over-cite-target-f-1'), {
      target: { value: 's-close' },
    });
    fireEvent.click(screen.getByTestId('carry-over-cite-confirm-f-1'));

    await waitFor(() => {
      expect(mockCiteFindingIntoStory).toHaveBeenCalledWith(PROJECT_ID, BOOK_ID, {
        book_item_id: 's-close',
        finding_id: 'f-1',
      });
    });
    // Mount read + post-action refresh.
    await waitFor(() => expect(mockGetCarryOverCoverage).toHaveBeenCalledTimes(2));
  });

  it('AMEND: picking the target story PREFILLS its description; the call carries description + criteria lines + the finding', async () => {
    await renderPanelExpanded();

    fireEvent.click(screen.getByTestId('carry-over-amend-f-1'));
    fireEvent.change(screen.getByTestId('carry-over-amend-target-f-1'), {
      target: { value: 's-close' },
    });
    // Prefilled with the picked story's CURRENT description.
    expect(
      (screen.getByTestId('carry-over-amend-description-f-1') as HTMLTextAreaElement).value,
    ).toBe('Implements POST /ledger/close verbatim.');

    fireEvent.change(screen.getByTestId('carry-over-amend-description-f-1'), {
      target: { value: 'Implements POST /ledger/close verbatim, halting on replication lag.' },
    });
    fireEvent.change(screen.getByTestId('carry-over-amend-criteria-f-1'), {
      target: { value: 'Halts when replication lag exceeds 5 minutes.\n\n  ' },
    });
    fireEvent.click(screen.getByTestId('carry-over-amend-confirm-f-1'));

    await waitFor(() => {
      expect(mockAmendStoryForFinding).toHaveBeenCalledWith(PROJECT_ID, BOOK_ID, {
        book_item_id: 's-close',
        finding_id: 'f-1',
        description: 'Implements POST /ledger/close verbatim, halting on replication lag.',
        append_acceptance_criteria: ['Halts when replication lag exceeds 5 minutes.'],
      });
    });
  });

  it('NEW STORY (finding): prefilled from the item detail; the call carries workstream + criteria + the finding', async () => {
    await renderPanelExpanded();

    fireEvent.click(screen.getByTestId('carry-over-new-story-f-1'));
    // Prefilled title/summary from the finding's content.
    expect(
      (screen.getByTestId('carry-over-new-story-title-f-1') as HTMLInputElement).value,
    ).toBe('Close job halts on replication lag');
    expect(
      (screen.getByTestId('carry-over-new-story-description-f-1') as HTMLTextAreaElement).value,
    ).toBe('The close aborts when replication lag exceeds 5 minutes.');

    fireEvent.change(screen.getByTestId('carry-over-new-story-criteria-f-1'), {
      target: { value: 'Lag guard verified in the target.' },
    });
    fireEvent.click(screen.getByTestId('carry-over-new-story-confirm-f-1'));

    await waitFor(() => {
      expect(mockCreateStoryForFinding).toHaveBeenCalledWith(PROJECT_ID, BOOK_ID, {
        finding_id: 'f-1',
        title: 'Close job halts on replication lag',
        description: 'The close aborts when replication lag exceeds 5 minutes.',
        workstream: 'internal_processing_implementation',
        acceptance_criteria: ['Lag guard verified in the target.'],
      });
    });
  });

  it('DISMISS: confirm disabled on a blank reason; the call carries architecture_id + the finding RUN id', async () => {
    await renderPanelExpanded();

    fireEvent.click(screen.getByTestId('carry-over-dismiss-f-1'));
    const confirm = screen.getByTestId('carry-over-dismiss-confirm-f-1');
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByTestId('carry-over-dismiss-reason-f-1'), {
      target: { value: 'Superseded by the managed replication service.' },
    });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(mockDismissCarryOverItem).toHaveBeenCalledWith(PROJECT_ID, {
        kind: 'finding',
        id: 'f-1',
        architecture_id: ARCH_ID,
        run_id: 'run-9',
        reason: 'Superseded by the managed replication service.',
      });
    });
  });

  it("a CAPABILITY's New story routes to the existing append-capability-story cite (source_capability_id mint)", async () => {
    await renderPanelExpanded();

    fireEvent.click(screen.getByTestId('carry-over-new-story-cap-1'));
    fireEvent.click(screen.getByTestId('carry-over-new-story-confirm-cap-1'));

    await waitFor(() => {
      expect(mockCiteCapability).toHaveBeenCalledWith(
        PROJECT_ID,
        BOOK_ID,
        expect.objectContaining({
          source_capability_id: 'cap-1',
          title: 'Nightly batch spine',
        }),
      );
    });
    expect(mockCreateStoryForFinding).not.toHaveBeenCalled();
  });
});
