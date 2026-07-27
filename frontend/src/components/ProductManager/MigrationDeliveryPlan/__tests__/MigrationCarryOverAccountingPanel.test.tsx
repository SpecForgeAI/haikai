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
const mockRunCarryOverTriage = vi.fn();
const mockRedraftTriageSuggestion = vi.fn();
const mockApplyTriageSuggestions = vi.fn();

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
    runCarryOverTriage: (...args: unknown[]) => mockRunCarryOverTriage(...args),
    redraftTriageSuggestion: (...args: unknown[]) => mockRedraftTriageSuggestion(...args),
    applyTriageSuggestions: (...args: unknown[]) => mockApplyTriageSuggestions(...args),
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

/** A drafted amend suggestion for f-1 + a validation-blanked one for cap-1. */
function draftedSuggestions() {
  return {
    suggestions: [
      {
        itemId: 'f-1',
        kind: 'finding',
        disposition: 'amend_story',
        targetBookItemId: 's-close',
        rationale: 'In the close story’s scope but unaddressed.',
        draftAmendment: {
          description: 'Implements POST /ledger/close verbatim, halting on replication lag.',
          appendAcceptanceCriteria: ['Halts when lag exceeds 5 minutes.'],
        },
        draftStory: null,
        dismissReason: null,
        validationNote: null,
      },
      {
        itemId: 'cap-1',
        kind: 'capability',
        disposition: null,
        targetBookItemId: null,
        rationale: '',
        draftAmendment: null,
        draftStory: null,
        dismissReason: null,
        validationNote: "Unknown disposition 'defer' — pick one manually.",
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCarryOverCoverage.mockResolvedValue(blockingCoverage());
  mockDismissCarryOverItem.mockResolvedValue({ ok: true });
  mockCiteCapability.mockResolvedValue({ work_item_id: 'wi-new' });
  mockCiteFindingIntoStory.mockResolvedValue({ ok: true, alreadyCited: false });
  mockAmendStoryForFinding.mockResolvedValue({ ok: true, workItemId: 'wi-1', specsMarkedStale: 1 });
  mockCreateStoryForFinding.mockResolvedValue({ ok: true, workItemId: 'wi-new', bookItemId: 'manual-x' });
  mockRunCarryOverTriage.mockResolvedValue(draftedSuggestions());
  mockRedraftTriageSuggestion.mockResolvedValue({
    suggestion: {
      itemId: 'f-1',
      kind: 'finding',
      disposition: 'amend_story',
      targetBookItemId: 's-close',
      rationale: 'Re-drafted with the guidance.',
      draftAmendment: {
        description: 'Re-drafted description honouring the retry semantics.',
        appendAcceptanceCriteria: ['Retries twice before halting.'],
      },
      draftStory: null,
      dismissReason: null,
      validationNote: null,
    },
  });
  mockApplyTriageSuggestions.mockResolvedValue({
    results: [{ itemId: 'f-1', disposition: 'amend_story', ok: true, error: null }],
    coverage: {
      ...blockingCoverage(),
      unaccounted: [
        { kind: 'capability', id: 'cap-1', status: 'un-actioned', behaviourBearing: true, label: 'cap-1' },
      ],
      accountedCount: 1,
      totalMustAccount: 2,
      ok: false,
    },
  });
});

describe('MigrationCarryOverAccountingPanel empty-state diagnostics (2026-07-27)', () => {
  it('an empty must-account set states WHAT was evaluated, and warns when NOTHING was', async () => {
    mockGetCarryOverCoverage.mockResolvedValue({
      items: [],
      mustAccount: [],
      unaccounted: [],
      accountedCount: 0,
      totalMustAccount: 0,
      ok: true,
      architectureId: ARCH_ID,
      itemDetails: {},
      scope: { capabilityCount: 0, runCount: 2, findingCount: 0, runScopeSource: 'architecture_runs' },
    });
    const first = render(
      <MigrationCarryOverAccountingPanel
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
        stories={STORIES}
      />,
    );
    const empty = await screen.findByTestId('carry-over-accounting-empty');
    expect(empty).toHaveTextContent(
      'Evaluated 2 discovery runs, 0 behaviour-bearing findings, 0 capabilities.',
    );
    expect(empty).not.toHaveTextContent('No discovery runs were evaluated');
    first.unmount();

    // runScopeSource 'none' = the coverage read saw NOTHING — warn loudly
    // (this exact state hid the live fail-open: capabilities [] meant zero
    // runs were ever evaluated while behaviour-bearing findings existed).
    mockGetCarryOverCoverage.mockResolvedValue({
      items: [],
      mustAccount: [],
      unaccounted: [],
      accountedCount: 0,
      totalMustAccount: 0,
      ok: true,
      architectureId: ARCH_ID,
      itemDetails: {},
      scope: { capabilityCount: 0, runCount: 0, findingCount: 0, runScopeSource: 'none' },
    });
    render(
      <MigrationCarryOverAccountingPanel
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
        stories={STORIES}
      />,
    );
    const warned = await screen.findByTestId('carry-over-accounting-empty');
    expect(warned).toHaveTextContent('No discovery runs were evaluated');
  });
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

// ============================================================================
// LLM triage panel (Item 3): suggestions table + guided re-draft + approve-all
// ============================================================================

describe('MigrationCarryOverAccountingPanel triage', () => {
  it('"Get suggestions" renders the editable suggestion per item; a validation-blanked row reads "needs manual choice"', async () => {
    await renderPanelExpanded();
    fireEvent.click(screen.getByTestId('carry-over-get-suggestions'));

    // f-1: the drafted amend with target + rationale + editable drafts.
    const disposition = (await screen.findByTestId(
      'carry-over-suggestion-disposition-f-1',
    )) as HTMLSelectElement;
    expect(disposition.value).toBe('amend_story');
    expect(
      (screen.getByTestId('carry-over-suggestion-target-f-1') as HTMLSelectElement).value,
    ).toBe('s-close');
    expect(
      screen.getByTestId('carry-over-suggestion-rationale-f-1'),
    ).toHaveTextContent('In the close story’s scope but unaddressed.');
    expect(
      (screen.getByTestId('carry-over-suggestion-amend-description-f-1') as HTMLTextAreaElement)
        .value,
    ).toContain('halting on replication lag');

    // cap-1: blanked by validation → "needs manual choice" + the note; its
    // Apply stays disabled; the dropdown offers only new_story|dismiss.
    const capDisposition = screen.getByTestId(
      'carry-over-suggestion-disposition-cap-1',
    ) as HTMLSelectElement;
    expect(capDisposition.value).toBe('');
    expect(screen.getByTestId('carry-over-suggestion-note-cap-1')).toHaveTextContent(
      'pick one manually',
    );
    expect(screen.getByTestId('carry-over-suggestion-apply-cap-1')).toBeDisabled();
    const capOptions = Array.from(capDisposition.options).map((o) => o.value);
    expect(capOptions).toEqual(['', 'new_story', 'dismiss']);

    // The manual action buttons are replaced while a suggestion is under review.
    expect(screen.queryByTestId('carry-over-amend-f-1')).not.toBeInTheDocument();
  });

  it('per-item Apply sends the EDITED suggestion (criteria cleaned) and the applied row leaves the review set; coverage comes from the response', async () => {
    const onCoverageChanged = await renderPanelExpanded();
    fireEvent.click(screen.getByTestId('carry-over-get-suggestions'));
    await screen.findByTestId('carry-over-suggestion-f-1');

    // Edit the drafted criteria (raw lines, blanks allowed while typing).
    fireEvent.change(screen.getByTestId('carry-over-suggestion-amend-criteria-f-1'), {
      target: { value: 'Halts when lag exceeds 5 minutes.\n\nRecovers automatically.\n' },
    });
    fireEvent.click(screen.getByTestId('carry-over-suggestion-apply-f-1'));

    await waitFor(() => {
      expect(mockApplyTriageSuggestions).toHaveBeenCalledWith(PROJECT_ID, BOOK_ID, [
        expect.objectContaining({
          itemId: 'f-1',
          kind: 'finding',
          disposition: 'amend_story',
          targetBookItemId: 's-close',
          draftAmendment: {
            description:
              'Implements POST /ledger/close verbatim, halting on replication lag.',
            // Blank lines cleaned at apply time.
            appendAcceptanceCriteria: [
              'Halts when lag exceeds 5 minutes.',
              'Recovers automatically.',
            ],
          },
        }),
      ]);
    });

    // The applied row leaves the review set; cap-1 (unapplied) remains.
    await waitFor(() => {
      expect(
        screen.queryByTestId('carry-over-suggestion-f-1'),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('carry-over-suggestion-cap-1')).toBeInTheDocument();
    // The response's refreshed coverage reached the parent (no extra GET).
    expect(onCoverageChanged).toHaveBeenLastCalledWith(
      expect.objectContaining({ accountedCount: 1 }),
    );
  });

  it('Re-draft folds the guidance + chosen disposition/target into the request and swaps in the fresh draft (guidance kept)', async () => {
    await renderPanelExpanded();
    fireEvent.click(screen.getByTestId('carry-over-get-suggestions'));
    await screen.findByTestId('carry-over-suggestion-f-1');

    fireEvent.change(screen.getByTestId('carry-over-suggestion-guidance-f-1'), {
      target: { value: 'Focus the amendment on the retry semantics.' },
    });
    fireEvent.click(screen.getByTestId('carry-over-suggestion-redraft-f-1'));

    await waitFor(() => {
      expect(mockRedraftTriageSuggestion).toHaveBeenCalledWith(PROJECT_ID, BOOK_ID, {
        item_id: 'f-1',
        forced_disposition: 'amend_story',
        guidance: 'Focus the amendment on the retry semantics.',
        target_book_item_id: 's-close',
      });
    });
    await waitFor(() => {
      expect(
        (screen.getByTestId('carry-over-suggestion-amend-description-f-1') as HTMLTextAreaElement)
          .value,
      ).toContain('honouring the retry semantics');
    });
    // The reviewer's guidance survives the swap so they can iterate.
    expect(
      (screen.getByTestId('carry-over-suggestion-guidance-f-1') as HTMLTextAreaElement).value,
    ).toBe('Focus the amendment on the retry semantics.');
  });

  it('"Approve all suggestions (N)" counts + sends ONLY the ready rows (the blanked one is skipped)', async () => {
    await renderPanelExpanded();
    fireEvent.click(screen.getByTestId('carry-over-get-suggestions'));
    await screen.findByTestId('carry-over-suggestion-f-1');

    const approveAll = screen.getByTestId('carry-over-approve-all');
    expect(approveAll).toHaveTextContent('Approve all suggestions (1)');
    fireEvent.click(approveAll);

    await waitFor(() => {
      expect(mockApplyTriageSuggestions).toHaveBeenCalledTimes(1);
    });
    const sent = mockApplyTriageSuggestions.mock.calls[0][2] as Array<{ itemId: string }>;
    expect(sent.map((s) => s.itemId)).toEqual(['f-1']);
  });

  it('choosing a disposition for a blanked row seeds prefilled drafts and enables Apply once complete', async () => {
    await renderPanelExpanded();
    fireEvent.click(screen.getByTestId('carry-over-get-suggestions'));
    await screen.findByTestId('carry-over-suggestion-cap-1');

    fireEvent.change(screen.getByTestId('carry-over-suggestion-disposition-cap-1'), {
      target: { value: 'new_story' },
    });
    // Seeded from the capability's content.
    expect(
      (screen.getByTestId('carry-over-suggestion-story-title-cap-1') as HTMLInputElement).value,
    ).toBe('Nightly batch spine');
    // A capability new_story is ready (the mint falls back to the item title).
    expect(screen.getByTestId('carry-over-suggestion-apply-cap-1')).not.toBeDisabled();
  });
});
