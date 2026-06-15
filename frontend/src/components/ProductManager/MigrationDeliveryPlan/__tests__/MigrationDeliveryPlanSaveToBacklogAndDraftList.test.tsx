/**
 * MigrationDeliveryPlan Save-to-Backlog + Draft list tests
 *
 * Spec 2026-05-17 PM Migration Delivery Plan -- Task Group 12.
 *
 * Coverage:
 *   1. Selection controls: Select all / Deselect all / Subtree / Exclude
 *      / Include flip the right tree state
 *   2. Save-all invokes the AMS endpoint with saveMode='all'
 *   3. Save-selected invokes with saveMode='selected' + the right
 *      selectedItemIds
 *   4. Save-high-confidence-only invokes with saveMode='high_confidence_only'
 *   5. Save-ready-for-spec-only invokes with saveMode='ready_for_spec_only'
 *   6. Saved-state marker appears on saved nodes after the response returns
 *   7. Draft list view renders active drafts; toggle shows archived
 *   8. Click a row in the list view fires the open-draft callback (G11 route)
 *   9. "Unsaved review changes" indicator (Q-16) appears after the user
 *      toggles excluded/selected without saving
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type {
  MigrationBookOfWorkDraft,
  MigrationBookOfWorkItem,
  SaveToBacklogResponse,
} from '../../../../api/migrationBookOfWorkApi';

// --- Mock the CSS module so class-name assertions don't blow up ---------
vi.mock('../MigrationBookOfWork.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

// --- Mock the API client ------------------------------------------------
const mockGetMigrationBookOfWork = vi.fn();
const mockUpdateMigrationBookOfWork = vi.fn();
const mockSaveMigrationBookOfWorkToBacklog = vi.fn();
const mockListMigrationBookOfWorks = vi.fn();

vi.mock('../../../../api/migrationBookOfWorkApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/migrationBookOfWorkApi')
  >('../../../../api/migrationBookOfWorkApi');
  return {
    ...actual,
    getMigrationBookOfWork: (...args: unknown[]) =>
      mockGetMigrationBookOfWork(...args),
    updateMigrationBookOfWork: (...args: unknown[]) =>
      mockUpdateMigrationBookOfWork(...args),
    saveMigrationBookOfWorkToBacklog: (...args: unknown[]) =>
      mockSaveMigrationBookOfWorkToBacklog(...args),
    listMigrationBookOfWorks: (...args: unknown[]) =>
      mockListMigrationBookOfWorks(...args),
  };
});

import MigrationBookOfWorkReviewWorkspace from '../MigrationBookOfWorkReviewWorkspace';
import MigrationBookOfWorkDraftListView from '../MigrationBookOfWorkDraftListView';

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

const PROJECT_ID = 'proj-1';
const BOOK_ID = 'book-1';

function makeItem(
  overrides: Partial<MigrationBookOfWorkItem> = {},
): MigrationBookOfWorkItem {
  return {
    id: 'i-default',
    type: 'initiative',
    parentId: null,
    title: 'Default item',
    description: 'desc',
    acceptanceCriteria: [],
    workstream: 'other',
    sequenceOrder: 0,
    tags: [],
    confidence: 'medium',
    readiness: 'ready_for_spec',
    readinessReasons: [],
    missingInputs: [],
    recommendedNextAction: '',
    traceabilitySummary: '',
    evidenceReferences: [],
    architectureReferences: [],
    apiBaselineReferences: [],
    discoveryFindingReferences: [],
    mappingReferences: [],
    sourceContextRefs: [],
    ...overrides,
  };
}

function makeDraft(
  items: MigrationBookOfWorkItem[],
  overrides: Partial<MigrationBookOfWorkDraft> = {},
): MigrationBookOfWorkDraft {
  return {
    id: BOOK_ID,
    projectId: PROJECT_ID,
    currentArchitectureId: 'arch-current',
    targetArchitectureId: 'arch-target',
    status: 'draft',
    title: 'Test migration plan',
    summary: 'Summary text',
    generationInputs: null,
    generationSummary: null,
    qualityAssessment: null,
    bookOfWork: { items },
    createdAt: '2026-05-17T10:00:00Z',
    updatedAt: '2026-05-17T10:00:00Z',
    createdByTask: 'product-manager--migration-delivery-plan',
    savedToBacklogAt: null,
    errorMessage: null,
    ...overrides,
  };
}

function makeFixtureItems(): MigrationBookOfWorkItem[] {
  return [
    makeItem({
      id: 'init-1',
      type: 'initiative',
      parentId: null,
      title: 'I-1',
      confidence: 'high',
      readiness: 'ready_for_spec',
      sequenceOrder: 10,
    }),
    makeItem({
      id: 'epic-1',
      type: 'epic',
      parentId: 'init-1',
      title: 'E-1',
      confidence: 'high',
      readiness: 'ready_for_spec',
      sequenceOrder: 10,
    }),
    makeItem({
      id: 'feat-1',
      type: 'feature',
      parentId: 'epic-1',
      title: 'F-1',
      confidence: 'medium',
      readiness: 'needs_focused_context',
      sequenceOrder: 10,
    }),
    makeItem({
      id: 'story-1',
      type: 'story',
      parentId: 'feat-1',
      title: 'S-1',
      confidence: 'low',
      readiness: 'blocked',
      sequenceOrder: 10,
    }),
  ];
}

/**
 * Build a save-to-backlog response that flips the requested item ids to
 * saveState='saved' and assigns synthetic workItemIds.
 */
function makeSaveResponse(
  items: MigrationBookOfWorkItem[],
  savedIds: string[],
): SaveToBacklogResponse {
  const newItems = items.map((i) =>
    savedIds.includes(i.id)
      ? { ...i, saveState: 'saved' as const, workItemId: `wi-${i.id}` }
      : i,
  );
  return {
    draftId: BOOK_ID,
    status: savedIds.length === items.length ? 'saved' : 'partially_saved',
    savedCount: savedIds.length,
    failedCount: 0,
    skippedCount: 0,
    bookOfWork: { items: newItems },
  };
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('MigrationBookOfWorkReviewWorkspace -- selection controls (Group 12)', () => {
  beforeEach(() => {
    mockGetMigrationBookOfWork.mockReset();
    mockUpdateMigrationBookOfWork.mockReset();
    mockSaveMigrationBookOfWorkToBacklog.mockReset();
    mockListMigrationBookOfWorks.mockReset();
  });

  it('Select-all flips every non-saved item to "selected"; Deselect-all returns to draft', async () => {
    const items = makeFixtureItems();
    mockGetMigrationBookOfWork.mockResolvedValueOnce(makeDraft(items));

    render(
      <MigrationBookOfWorkReviewWorkspace
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('review-workspace')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('select-all-button'));
    await waitFor(() =>
      expect(screen.getByTestId('badge-savestate-init-1')).toHaveTextContent(
        'selected',
      ),
    );
    expect(screen.getByTestId('badge-savestate-story-1')).toHaveTextContent(
      'selected',
    );

    fireEvent.click(screen.getByTestId('deselect-all-button'));
    await waitFor(() =>
      expect(screen.queryByTestId('badge-savestate-init-1')).toBeNull(),
    );
    expect(screen.queryByTestId('badge-savestate-story-1')).toBeNull();
  });

  it('Select-subtree selects the focused item and all descendants', async () => {
    const items = makeFixtureItems();
    mockGetMigrationBookOfWork.mockResolvedValueOnce(makeDraft(items));

    render(
      <MigrationBookOfWorkReviewWorkspace
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('review-workspace')).toBeInTheDocument(),
    );

    // Focus on the epic node so subtree-select takes its descendants too.
    fireEvent.click(screen.getByTestId('hierarchy-node-row-epic-1'));
    fireEvent.click(screen.getByTestId('select-subtree-button'));

    await waitFor(() =>
      expect(screen.getByTestId('badge-savestate-epic-1')).toHaveTextContent(
        'selected',
      ),
    );
    expect(screen.getByTestId('badge-savestate-feat-1')).toHaveTextContent(
      'selected',
    );
    expect(screen.getByTestId('badge-savestate-story-1')).toHaveTextContent(
      'selected',
    );
    // init-1 (the parent of the focused node) is NOT in the subtree.
    expect(screen.queryByTestId('badge-savestate-init-1')).toBeNull();
  });

  it('Exclude / Include flip the right tree state', async () => {
    const items = makeFixtureItems();
    mockGetMigrationBookOfWork.mockResolvedValueOnce(makeDraft(items));

    render(
      <MigrationBookOfWorkReviewWorkspace
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('review-workspace')).toBeInTheDocument(),
    );

    // Focus on story-1 then exclude it.
    fireEvent.click(screen.getByTestId('hierarchy-node-row-story-1'));
    fireEvent.click(screen.getByTestId('exclude-selected-button'));
    await waitFor(() =>
      expect(screen.getByTestId('badge-savestate-story-1')).toHaveTextContent(
        'excluded',
      ),
    );

    // Include re-flips it back to draft.
    fireEvent.click(screen.getByTestId('include-selected-button'));
    await waitFor(() =>
      expect(screen.queryByTestId('badge-savestate-story-1')).toBeNull(),
    );
  });
});

describe('MigrationBookOfWorkReviewWorkspace -- save-to-backlog flows (Group 12)', () => {
  beforeEach(() => {
    mockGetMigrationBookOfWork.mockReset();
    mockUpdateMigrationBookOfWork.mockReset();
    mockSaveMigrationBookOfWorkToBacklog.mockReset();
    mockListMigrationBookOfWorks.mockReset();
  });

  it('Save All invokes saveMigrationBookOfWorkToBacklog with saveMode="all"', async () => {
    const items = makeFixtureItems();
    mockGetMigrationBookOfWork.mockResolvedValueOnce(makeDraft(items));
    mockSaveMigrationBookOfWorkToBacklog.mockResolvedValueOnce(
      makeSaveResponse(items, items.map((i) => i.id)),
    );

    render(
      <MigrationBookOfWorkReviewWorkspace
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('review-workspace')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('save-all-button'));
    await waitFor(() =>
      expect(screen.getByTestId('save-to-backlog-dialog')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('save-to-backlog-confirm'));

    await waitFor(() =>
      expect(mockSaveMigrationBookOfWorkToBacklog).toHaveBeenCalledTimes(1),
    );
    const [pid, bid, body] = mockSaveMigrationBookOfWorkToBacklog.mock.calls[0];
    expect(pid).toBe(PROJECT_ID);
    expect(bid).toBe(BOOK_ID);
    expect(body.saveMode).toBe('all');
  });

  it('Save Selected invokes with saveMode="selected" + selectedItemIds populated from frontend state', async () => {
    const items = makeFixtureItems();
    mockGetMigrationBookOfWork.mockResolvedValueOnce(makeDraft(items));
    mockSaveMigrationBookOfWorkToBacklog.mockResolvedValueOnce(
      makeSaveResponse(items, ['feat-1', 'story-1']),
    );

    render(
      <MigrationBookOfWorkReviewWorkspace
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('review-workspace')).toBeInTheDocument(),
    );

    // Select feat-1 + story-1 manually via focus + subtree.
    fireEvent.click(screen.getByTestId('hierarchy-node-row-feat-1'));
    fireEvent.click(screen.getByTestId('select-subtree-button'));

    fireEvent.click(screen.getByTestId('save-selected-button'));
    await waitFor(() =>
      expect(screen.getByTestId('save-to-backlog-dialog')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('save-to-backlog-confirm'));

    await waitFor(() =>
      expect(mockSaveMigrationBookOfWorkToBacklog).toHaveBeenCalledTimes(1),
    );
    const [, , body] = mockSaveMigrationBookOfWorkToBacklog.mock.calls[0];
    expect(body.saveMode).toBe('selected');
    // Subtree of feat-1 -> feat-1 + story-1
    expect(body.selectedItemIds).toEqual(
      expect.arrayContaining(['feat-1', 'story-1']),
    );
  });

  it('Save High-Confidence Only invokes with saveMode="high_confidence_only"', async () => {
    const items = makeFixtureItems();
    mockGetMigrationBookOfWork.mockResolvedValueOnce(makeDraft(items));
    mockSaveMigrationBookOfWorkToBacklog.mockResolvedValueOnce(
      makeSaveResponse(items, ['init-1', 'epic-1']),
    );

    render(
      <MigrationBookOfWorkReviewWorkspace
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('review-workspace')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('save-high-confidence-button'));
    await waitFor(() =>
      expect(screen.getByTestId('save-to-backlog-dialog')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('save-to-backlog-confirm'));

    await waitFor(() =>
      expect(mockSaveMigrationBookOfWorkToBacklog).toHaveBeenCalledTimes(1),
    );
    const [, , body] = mockSaveMigrationBookOfWorkToBacklog.mock.calls[0];
    expect(body.saveMode).toBe('high_confidence_only');
  });

  it('Save Ready-for-Spec Only invokes with saveMode="ready_for_spec_only"', async () => {
    const items = makeFixtureItems();
    mockGetMigrationBookOfWork.mockResolvedValueOnce(makeDraft(items));
    mockSaveMigrationBookOfWorkToBacklog.mockResolvedValueOnce(
      makeSaveResponse(items, ['init-1', 'epic-1']),
    );

    render(
      <MigrationBookOfWorkReviewWorkspace
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('review-workspace')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('save-ready-for-spec-button'));
    await waitFor(() =>
      expect(screen.getByTestId('save-to-backlog-dialog')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('save-to-backlog-confirm'));

    await waitFor(() =>
      expect(mockSaveMigrationBookOfWorkToBacklog).toHaveBeenCalledTimes(1),
    );
    const [, , body] = mockSaveMigrationBookOfWorkToBacklog.mock.calls[0];
    expect(body.saveMode).toBe('ready_for_spec_only');
  });

  it('Saved-state marker appears on saved nodes after the response returns', async () => {
    const items = makeFixtureItems();
    mockGetMigrationBookOfWork.mockResolvedValueOnce(makeDraft(items));
    mockSaveMigrationBookOfWorkToBacklog.mockResolvedValueOnce(
      makeSaveResponse(items, ['init-1', 'epic-1']),
    );

    render(
      <MigrationBookOfWorkReviewWorkspace
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('review-workspace')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('save-all-button'));
    await waitFor(() =>
      expect(screen.getByTestId('save-to-backlog-dialog')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('save-to-backlog-confirm'));

    await waitFor(() =>
      expect(screen.getByTestId('badge-savestate-init-1')).toHaveTextContent(
        'saved',
      ),
    );
    expect(screen.getByTestId('badge-savestate-epic-1')).toHaveTextContent(
      'saved',
    );
    // Post-save view rendered
    expect(screen.getByTestId('post-save-view')).toBeInTheDocument();
  });

  it('Unsaved review changes indicator appears after toggling excluded/selected without saving', async () => {
    const items = makeFixtureItems();
    mockGetMigrationBookOfWork.mockResolvedValueOnce(makeDraft(items));

    render(
      <MigrationBookOfWorkReviewWorkspace
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('review-workspace')).toBeInTheDocument(),
    );

    // Before any change, indicator is absent.
    expect(
      screen.queryByTestId('unsaved-review-changes-indicator'),
    ).toBeNull();

    // Focus + exclude story-1.
    fireEvent.click(screen.getByTestId('hierarchy-node-row-story-1'));
    fireEvent.click(screen.getByTestId('exclude-selected-button'));

    await waitFor(() =>
      expect(
        screen.getByTestId('unsaved-review-changes-indicator'),
      ).toBeInTheDocument(),
    );
  });
});

describe('MigrationBookOfWorkDraftListView (Group 12)', () => {
  beforeEach(() => {
    mockGetMigrationBookOfWork.mockReset();
    mockUpdateMigrationBookOfWork.mockReset();
    mockSaveMigrationBookOfWorkToBacklog.mockReset();
    mockListMigrationBookOfWorks.mockReset();
  });

  it('renders active drafts by default and toggles to include archived', async () => {
    const active = makeDraft(makeFixtureItems(), { id: 'd-active', status: 'draft' });
    const archived = makeDraft(makeFixtureItems(), {
      id: 'd-archived',
      status: 'archived',
      title: 'Archived plan',
    });
    mockListMigrationBookOfWorks.mockResolvedValueOnce([active]);
    mockListMigrationBookOfWorks.mockResolvedValueOnce([active, archived]);

    const onOpen = vi.fn();
    render(
      <MigrationBookOfWorkDraftListView
        projectId={PROJECT_ID}
        onOpenDraft={onOpen}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('draft-list-view')).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByTestId('draft-list-row-d-active')).toBeInTheDocument(),
    );

    // Default fetch: includeArchived=false
    const firstCall = mockListMigrationBookOfWorks.mock.calls[0];
    expect(firstCall[0]).toBe(PROJECT_ID);
    expect(firstCall[1]).toMatchObject({ includeArchived: false });

    // Toggle archived on -> second fetch
    fireEvent.click(screen.getByTestId('show-archived-toggle'));
    await waitFor(() =>
      expect(mockListMigrationBookOfWorks).toHaveBeenCalledTimes(2),
    );
    const secondCall = mockListMigrationBookOfWorks.mock.calls[1];
    expect(secondCall[1]).toMatchObject({ includeArchived: true });

    await waitFor(() =>
      expect(
        screen.getByTestId('draft-list-row-d-archived'),
      ).toBeInTheDocument(),
    );
  });

  it('clicking a row invokes the onOpenDraft callback so the parent can route to the review workspace', async () => {
    const active = makeDraft(makeFixtureItems(), {
      id: 'd-route',
      status: 'draft',
    });
    mockListMigrationBookOfWorks.mockResolvedValueOnce([active]);

    const onOpen = vi.fn();
    render(
      <MigrationBookOfWorkDraftListView
        projectId={PROJECT_ID}
        onOpenDraft={onOpen}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('draft-list-row-d-route')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('draft-list-row-d-route'));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith('d-route', expect.objectContaining({ id: 'd-route' }));
  });
});

// ----------------------------------------------------------------------------
// Phase-2 expansion surfaces (Spec 2026-06-11 Two-Phase generation, Group 5)
// ----------------------------------------------------------------------------

describe('Save-to-backlog partial-expansion warning + draft-list indicator (Spec 2026-06-11, Group 5)', () => {
  beforeEach(() => {
    mockGetMigrationBookOfWork.mockReset();
    mockUpdateMigrationBookOfWork.mockReset();
    mockSaveMigrationBookOfWorkToBacklog.mockReset();
    mockListMigrationBookOfWorks.mockReset();
  });

  it('save dialog shows a NON-BLOCKING warning when the selection includes an unexpanded epic, and the save still proceeds', async () => {
    // epic-1 is not yet expanded into detailed stories.
    const items = makeFixtureItems().map((i) =>
      i.id === 'epic-1'
        ? { ...i, expansionState: 'not_expanded' as const }
        : i,
    );
    mockGetMigrationBookOfWork.mockResolvedValueOnce(makeDraft(items));
    mockSaveMigrationBookOfWorkToBacklog.mockResolvedValueOnce(
      makeSaveResponse(items, items.map((i) => i.id)),
    );

    render(
      <MigrationBookOfWorkReviewWorkspace
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('review-workspace')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('save-all-button'));
    await waitFor(() =>
      expect(screen.getByTestId('save-to-backlog-dialog')).toBeInTheDocument(),
    );

    // Non-blocking warning present...
    expect(
      screen.getByTestId('save-to-backlog-unexpanded-warning'),
    ).toHaveTextContent(/1 epic has not been expanded/);
    // ...and Confirm is NOT blocked: the save call goes through normally.
    fireEvent.click(screen.getByTestId('save-to-backlog-confirm'));
    await waitFor(() =>
      expect(mockSaveMigrationBookOfWorkToBacklog).toHaveBeenCalledTimes(1),
    );
  });

  it('draft list rows show the aggregate "X/Y epics expanded" indicator; legacy drafts (no expansion state) show none', async () => {
    const skeletonItems = [
      makeItem({
        id: 'init-1',
        type: 'initiative',
        parentId: null,
        sequenceOrder: 10,
      }),
      makeItem({
        id: 'epic-1',
        type: 'epic',
        parentId: 'init-1',
        sequenceOrder: 10,
        expansionState: 'expanded',
      }),
      makeItem({
        id: 'epic-2',
        type: 'epic',
        parentId: 'init-1',
        sequenceOrder: 20,
        expansionState: 'not_expanded',
      }),
    ];
    const skeletonDraft = makeDraft(skeletonItems, { id: 'd-skeleton' });
    // Legacy full-plan draft: epics carry NO expansionState.
    const legacyDraft = makeDraft(makeFixtureItems(), { id: 'd-legacy' });
    mockListMigrationBookOfWorks.mockResolvedValueOnce([
      skeletonDraft,
      legacyDraft,
    ]);

    render(
      <MigrationBookOfWorkDraftListView
        projectId={PROJECT_ID}
        onOpenDraft={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByTestId('draft-list-row-d-skeleton'),
      ).toBeInTheDocument(),
    );
    expect(screen.getByTestId('draft-expansion-d-skeleton')).toHaveTextContent(
      '1/2 epics expanded',
    );
    expect(screen.queryByTestId('draft-expansion-d-legacy')).toBeNull();
  });
});
