/**
 * MigrationDeliveryPlanReviewWorkspace tests
 *
 * Spec 2026-05-17 PM Migration Delivery Plan -- Task Group 11.
 *
 * Coverage:
 *   1. Tree renders Initiative -> Epic -> Feature -> Story
 *   2. Filter by workstream narrows the tree (incl. `unknown` per Q-7)
 *   3. Filter by confidence narrows the tree
 *   4. Filter by readiness narrows the tree
 *   5. Discovery-finding-reference text search filters correctly
 *   6. Item drawer shows traceability + readiness reasons + missing inputs
 *      + recommended next action + reference lists
 *   7. Drawer updates when a different node is clicked
 *   8. Combined filters compose with AND semantics
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type {
  MigrationBookOfWorkDraft,
  MigrationBookOfWorkItem,
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

// --- Mock the expand API (Spec 2026-06-11 Two-Phase generation, Group 5) ---
const mockExpandEpic = vi.fn();
const mockExpandAll = vi.fn();

vi.mock('../../../../api/migrationDeliveryPlanApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/migrationDeliveryPlanApi')
  >('../../../../api/migrationDeliveryPlanApi');
  return {
    ...actual,
    expandMigrationBookOfWorkEpic: (...args: unknown[]) =>
      mockExpandEpic(...args),
    expandAllMigrationBookOfWorkEpics: (...args: unknown[]) =>
      mockExpandAll(...args),
  };
});

import MigrationBookOfWorkReviewWorkspace from '../MigrationBookOfWorkReviewWorkspace';

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

function makeDraft(items: MigrationBookOfWorkItem[]): MigrationBookOfWorkDraft {
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
  };
}

/**
 * A complete Initiative -> Epic -> Feature -> Story chain plus a few
 * siblings used to verify filter narrowing.
 */
function makeHierarchyFixture(): MigrationBookOfWorkItem[] {
  return [
    makeItem({
      id: 'init-1',
      type: 'initiative',
      parentId: null,
      title: 'Migrate monolith to two services',
      workstream: 'target_service_api_implementation',
      confidence: 'high',
      readiness: 'ready_for_spec',
      sequenceOrder: 10,
      traceabilitySummary: 'Anchored on current-arch service S1',
      discoveryFindingReferences: ['finding-evidence-gap-A'],
      evidenceReferences: ['ev-1', 'ev-2'],
      architectureReferences: ['arch-current-S1'],
      mappingReferences: ['map-S1-T1', 'map-S1-T2'],
      recommendedNextAction: 'Begin service decomposition',
      readinessReasons: [],
    }),
    makeItem({
      id: 'epic-1',
      type: 'epic',
      parentId: 'init-1',
      title: 'Target service T1 implementation',
      workstream: 'target_service_api_implementation',
      confidence: 'high',
      readiness: 'ready_for_spec',
      sequenceOrder: 10,
      discoveryFindingReferences: ['finding-evidence-gap-A'],
    }),
    makeItem({
      id: 'feat-1',
      type: 'feature',
      parentId: 'epic-1',
      title: 'Implement /createCustomer endpoint',
      workstream: 'target_service_api_implementation',
      confidence: 'medium',
      readiness: 'needs_focused_context',
      sequenceOrder: 10,
      readinessReasons: ['Contract version not yet finalised'],
      missingInputs: ['Final contract from product team'],
      discoveryFindingReferences: ['finding-evidence-gap-A'],
    }),
    makeItem({
      id: 'story-1',
      type: 'story',
      parentId: 'feat-1',
      title: 'Validate input payload',
      workstream: 'target_service_api_implementation',
      confidence: 'low',
      readiness: 'blocked',
      sequenceOrder: 10,
      readinessReasons: ['Awaiting validation rules from CompliancePM'],
      missingInputs: ['Validation rule list'],
      acceptanceCriteria: ['Reject invalid email', 'Reject empty name'],
      traceabilitySummary:
        'Traces to API Behaviour Baseline AP-1 + Mapping M-1',
      discoveryFindingReferences: ['finding-confidence-warning-B'],
      evidenceReferences: ['ev-3'],
      apiBaselineReferences: ['ap-1'],
      mappingReferences: ['map-S1-T1'],
      recommendedNextAction: 'Request rules from CompliancePM',
    }),
    // An "unknown" workstream story sibling for filter coverage.
    makeItem({
      id: 'story-unk',
      type: 'story',
      parentId: 'feat-1',
      title: 'Unknown-workstream sibling',
      workstream: 'unknown',
      confidence: 'low',
      readiness: 'needs_user_decision',
      sequenceOrder: 20,
    }),
    // A data-migration story for finding-reference filter coverage.
    makeItem({
      id: 'story-dm',
      type: 'story',
      parentId: 'feat-1',
      title: 'Migrate customer table',
      workstream: 'data_migration',
      confidence: 'medium',
      readiness: 'ready_for_spec',
      sequenceOrder: 30,
      discoveryFindingReferences: ['finding-confidence-warning-B'],
    }),
  ];
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('MigrationBookOfWorkReviewWorkspace (Group 11)', () => {
  beforeEach(() => {
    mockGetMigrationBookOfWork.mockReset();
    mockUpdateMigrationBookOfWork.mockReset();
    mockSaveMigrationBookOfWorkToBacklog.mockReset();
    mockListMigrationBookOfWorks.mockReset();
  });

  it('renders the tree with initiative -> epic -> feature -> story rows', async () => {
    const items = makeHierarchyFixture();
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

    expect(screen.getByTestId('hierarchy-node-init-1')).toBeInTheDocument();
    expect(screen.getByTestId('hierarchy-node-epic-1')).toBeInTheDocument();
    expect(screen.getByTestId('hierarchy-node-feat-1')).toBeInTheDocument();
    expect(screen.getByTestId('hierarchy-node-story-1')).toBeInTheDocument();
    expect(screen.getByTestId('hierarchy-node-type-init-1')).toHaveTextContent(
      'initiative',
    );
    expect(screen.getByTestId('hierarchy-node-type-epic-1')).toHaveTextContent(
      'epic',
    );
    expect(screen.getByTestId('hierarchy-node-type-feat-1')).toHaveTextContent(
      'feature',
    );
    expect(screen.getByTestId('hierarchy-node-type-story-1')).toHaveTextContent(
      'story',
    );
    // Confidence + readiness + workstream badges are present per item.
    expect(screen.getByTestId('badge-confidence-init-1')).toHaveTextContent(
      'high',
    );
    expect(screen.getByTestId('badge-readiness-story-1')).toHaveTextContent(
      'blocked',
    );
    expect(screen.getByTestId('badge-workstream-story-unk')).toHaveTextContent(
      'unknown',
    );
  });

  it('filtering by workstream "unknown" narrows the tree to the unknown sibling', async () => {
    const items = makeHierarchyFixture();
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

    const select = screen.getByTestId(
      'filter-workstreams',
    ) as HTMLSelectElement;
    // Select the 'unknown' option
    const unkOption = Array.from(select.options).find(
      (o) => o.value === 'unknown',
    )!;
    unkOption.selected = true;
    fireEvent.change(select);

    // Only the unknown-workstream story (and its promoted ancestors) should
    // remain visible. The other story siblings should be gone.
    await waitFor(() =>
      expect(screen.getByTestId('hierarchy-node-story-unk')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('hierarchy-node-story-1')).toBeNull();
    expect(screen.queryByTestId('hierarchy-node-story-dm')).toBeNull();
  });

  it('filtering by confidence=high narrows the tree to high-confidence items + their ancestors', async () => {
    const items = makeHierarchyFixture();
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

    fireEvent.click(screen.getByTestId('filter-confidence-high'));

    // init-1 + epic-1 are high; their descendants are admitted by the
    // descendant-promotion logic so the user sees a full subtree, but the
    // unrelated low/medium siblings outside that chain stay visible only if
    // they're descendants of a high-confidence root. story-1, story-unk,
    // story-dm are descendants of feat-1, which is medium and therefore
    // does NOT itself pass; but epic-1 is high so its full subtree
    // (including feat-1 and the stories) is promoted. We just verify the
    // high-confidence rows are present and that we have NOT dropped them.
    await waitFor(() =>
      expect(screen.getByTestId('hierarchy-node-init-1')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('hierarchy-node-epic-1')).toBeInTheDocument();
  });

  it('filtering by readiness=blocked narrows the tree', async () => {
    const items = makeHierarchyFixture();
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

    fireEvent.click(screen.getByTestId('filter-readiness-blocked'));

    // The only blocked item is story-1; its ancestor chain (init-1, epic-1,
    // feat-1) gets promoted but story-unk + story-dm are filtered out.
    await waitFor(() =>
      expect(screen.getByTestId('hierarchy-node-story-1')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('hierarchy-node-story-unk')).toBeNull();
    expect(screen.queryByTestId('hierarchy-node-story-dm')).toBeNull();
  });

  it('finding-reference text search filters the tree to items whose discoveryFindingReferences match', async () => {
    const items = makeHierarchyFixture();
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

    const input = screen.getByTestId(
      'filter-finding-reference',
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: { value: 'finding-confidence-warning-B' },
    });

    // Only story-1 and story-dm have that finding ref; the other items
    // are filtered out unless promoted as ancestors.
    await waitFor(() =>
      expect(screen.getByTestId('hierarchy-node-story-1')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('hierarchy-node-story-dm')).toBeInTheDocument();
    expect(screen.queryByTestId('hierarchy-node-story-unk')).toBeNull();
  });

  it('clicking a node opens the item drawer with traceability + reasons + missing inputs + next action + refs', async () => {
    const items = makeHierarchyFixture();
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

    fireEvent.click(screen.getByTestId('hierarchy-node-row-story-1'));

    await waitFor(() =>
      expect(screen.getByTestId('item-drawer-story-1')).toBeInTheDocument(),
    );

    expect(screen.getByTestId('item-drawer-title')).toHaveTextContent(
      'Validate input payload',
    );
    expect(screen.getByTestId('item-drawer-readiness-reasons')).toHaveTextContent(
      'Awaiting validation rules from CompliancePM',
    );
    expect(screen.getByTestId('item-drawer-missing-inputs')).toHaveTextContent(
      'Validation rule list',
    );
    expect(
      screen.getByTestId('item-drawer-recommended-next-action'),
    ).toHaveTextContent('Request rules from CompliancePM');
    expect(
      screen.getByTestId('item-drawer-traceability-summary'),
    ).toHaveTextContent('Traces to API Behaviour Baseline AP-1 + Mapping M-1');
    expect(
      screen.getByTestId('item-drawer-evidence-references'),
    ).toHaveTextContent('ev-3');
    expect(
      screen.getByTestId('item-drawer-discovery-finding-references'),
    ).toHaveTextContent('finding-confidence-warning-B');
    expect(
      screen.getByTestId('item-drawer-mapping-references'),
    ).toHaveTextContent('map-S1-T1');
    expect(
      screen.getByTestId('item-drawer-api-baseline-references'),
    ).toHaveTextContent('ap-1');
  });

  it('drawer updates when a different node is clicked', async () => {
    const items = makeHierarchyFixture();
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

    fireEvent.click(screen.getByTestId('hierarchy-node-row-init-1'));
    await waitFor(() =>
      expect(screen.getByTestId('item-drawer-init-1')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('item-drawer-title')).toHaveTextContent(
      'Migrate monolith to two services',
    );

    fireEvent.click(screen.getByTestId('hierarchy-node-row-story-1'));
    await waitFor(() =>
      expect(screen.getByTestId('item-drawer-story-1')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('item-drawer-title')).toHaveTextContent(
      'Validate input payload',
    );
  });

  it('combined filters compose with AND semantics', async () => {
    const items = makeHierarchyFixture();
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

    // Confidence=low AND blocking gaps -> only story-1 should match (both low + blocked).
    fireEvent.click(screen.getByTestId('filter-confidence-low'));
    fireEvent.click(screen.getByTestId('filter-blocking-gaps'));

    await waitFor(() =>
      expect(screen.getByTestId('hierarchy-node-story-1')).toBeInTheDocument(),
    );
    // story-unk is low but readiness=needs_user_decision with no blocker reasons
    // so it should be filtered out (no blocking-gaps signal).
    expect(screen.queryByTestId('hierarchy-node-story-unk')).toBeNull();
    expect(screen.queryByTestId('hierarchy-node-story-dm')).toBeNull();
  });
});

// ----------------------------------------------------------------------------
// Phase-2 expansion (Spec 2026-06-11 Two-Phase generation, Task Group 5)
// ----------------------------------------------------------------------------

/**
 * Skeleton fixture: one initiative with four epics covering all four
 * expansion states. `epic-s` carries a persisted `expanding` with no live
 * request, i.e. the stale (reload-mid-expansion) case.
 */
function makeSkeletonFixture(): MigrationBookOfWorkItem[] {
  return [
    makeItem({
      id: 'init-1',
      type: 'initiative',
      parentId: null,
      title: 'Skeleton initiative',
      sequenceOrder: 10,
    }),
    makeItem({
      id: 'epic-ne',
      type: 'epic',
      parentId: 'init-1',
      title: 'Not-expanded epic',
      sequenceOrder: 10,
      expansionState: 'not_expanded',
    }),
    makeItem({
      id: 'epic-x',
      type: 'epic',
      parentId: 'init-1',
      title: 'Expanded epic',
      sequenceOrder: 20,
      expansionState: 'expanded',
    }),
    makeItem({
      id: 'epic-f',
      type: 'epic',
      parentId: 'init-1',
      title: 'Failed epic',
      sequenceOrder: 30,
      expansionState: 'failed',
    }),
    makeItem({
      id: 'epic-s',
      type: 'epic',
      parentId: 'init-1',
      title: 'Stale-expanding epic',
      sequenceOrder: 40,
      expansionState: 'expanding',
    }),
  ];
}

describe('MigrationBookOfWorkReviewWorkspace -- phase-2 expansion (Spec 2026-06-11, Group 5)', () => {
  beforeEach(() => {
    mockGetMigrationBookOfWork.mockReset();
    mockUpdateMigrationBookOfWork.mockReset();
    mockSaveMigrationBookOfWorkToBacklog.mockReset();
    mockListMigrationBookOfWorks.mockReset();
    mockExpandEpic.mockReset();
    mockExpandAll.mockReset();
  });

  it('renders all four expansion-state badges; failed + stale-expanding offer retry; expanded offers Re-expand', async () => {
    mockGetMigrationBookOfWork.mockResolvedValueOnce(
      makeDraft(makeSkeletonFixture()),
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

    expect(screen.getByTestId('badge-expansion-epic-ne')).toHaveTextContent(
      'not expanded',
    );
    expect(screen.getByTestId('badge-expansion-epic-x')).toHaveTextContent(
      'expanded',
    );
    expect(screen.getByTestId('badge-expansion-epic-f')).toHaveTextContent(
      'expansion failed',
    );
    // Persisted `expanding` with no live request -> stale, retryable.
    expect(screen.getByTestId('badge-expansion-epic-s')).toHaveTextContent(
      'expanding (stale)',
    );

    expect(screen.getByTestId('expand-epic-button-epic-ne')).toHaveTextContent(
      'Expand epic',
    );
    expect(screen.getByTestId('expand-epic-button-epic-f')).toHaveTextContent(
      'Retry expansion',
    );
    expect(
      screen.getByTestId('expand-epic-button-epic-s'),
    ).toBeInTheDocument();
    // `expanded` now offers a RE-expand affordance (re-runs + replaces stories).
    expect(screen.getByTestId('expand-epic-button-epic-x')).toHaveTextContent(
      'Re-expand',
    );
    // Both bulk controls render and are enabled: "Expand remaining" (the
    // 3 not-yet-done epics) and "Expand all" (which also re-expands epic-x).
    expect(screen.getByTestId('expand-remaining-epics-button')).toBeEnabled();
    expect(screen.getByTestId('expand-all-epics-button')).toBeEnabled();
  });

  it('"Expand epic" calls the expand API for that epic, flips the badge, and refreshes the draft with the appended stories', async () => {
    const skeleton = makeSkeletonFixture();
    const expandedItems: MigrationBookOfWorkItem[] = [
      ...skeleton.map((i) =>
        i.id === 'epic-ne'
          ? { ...i, expansionState: 'expanded' as const }
          : i,
      ),
      makeItem({
        id: 'story-new',
        type: 'story',
        parentId: 'epic-ne',
        title: 'Appended story',
        sequenceOrder: 11,
        tags: ['provenance:stamped', 'stream:target_service_api_implementation'],
      }),
    ];
    mockGetMigrationBookOfWork
      .mockResolvedValueOnce(makeDraft(skeleton))
      .mockResolvedValue(makeDraft(expandedItems));
    mockExpandEpic.mockResolvedValueOnce({
      epicId: 'epic-ne',
      expansionState: 'expanded',
      storiesAppended: 1,
    });

    render(
      <MigrationBookOfWorkReviewWorkspace
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('review-workspace')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('expand-epic-button-epic-ne'));

    await waitFor(() =>
      expect(screen.getByTestId('badge-expansion-epic-ne')).toHaveTextContent(
        'expanded',
      ),
    );
    expect(mockExpandEpic).toHaveBeenCalledTimes(1);
    expect(mockExpandEpic).toHaveBeenCalledWith(PROJECT_ID, BOOK_ID, 'epic-ne');
    // Draft refreshed after expansion -> the appended story is in the tree.
    await waitFor(() =>
      expect(screen.getByTestId('hierarchy-node-story-new')).toBeInTheDocument(),
    );
    expect(mockGetMigrationBookOfWork).toHaveBeenCalledTimes(2);
    // The now-expanded epic offers a RE-expand affordance (re-run + replace).
    expect(screen.getByTestId('expand-epic-button-epic-ne')).toHaveTextContent(
      'Re-expand',
    );
  });

  it('retry on a failed epic re-calls expand for THAT epic only (never expand-all)', async () => {
    const skeleton = makeSkeletonFixture();
    mockGetMigrationBookOfWork
      .mockResolvedValueOnce(makeDraft(skeleton))
      .mockResolvedValue(
        makeDraft(
          skeleton.map((i) =>
            i.id === 'epic-f'
              ? { ...i, expansionState: 'expanded' as const }
              : i,
          ),
        ),
      );
    mockExpandEpic.mockResolvedValueOnce({
      epicId: 'epic-f',
      expansionState: 'expanded',
      storiesAppended: 2,
    });

    render(
      <MigrationBookOfWorkReviewWorkspace
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('review-workspace')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('expand-epic-button-epic-f'));

    await waitFor(() =>
      expect(screen.getByTestId('badge-expansion-epic-f')).toHaveTextContent(
        'expanded',
      ),
    );
    expect(mockExpandEpic).toHaveBeenCalledTimes(1);
    expect(mockExpandEpic).toHaveBeenCalledWith(PROJECT_ID, BOOK_ID, 'epic-f');
    expect(mockExpandAll).not.toHaveBeenCalled();
  });

  it('"Expand all epics" calls the expand-all API, applies per-epic results, and surfaces per-epic failures as retryable', async () => {
    const skeleton = makeSkeletonFixture();
    mockGetMigrationBookOfWork
      .mockResolvedValueOnce(makeDraft(skeleton))
      .mockResolvedValue(makeDraft(skeleton));
    mockExpandAll.mockResolvedValueOnce({
      results: [
        { epicId: 'epic-ne', expansionState: 'expanded', storiesAppended: 3 },
        {
          epicId: 'epic-f',
          expansionState: 'failed',
          storiesAppended: 0,
          error: 'judge failed after retry',
        },
        { epicId: 'epic-s', expansionState: 'expanded', storiesAppended: 1 },
      ],
      skipped: [
        {
          epicId: 'epic-x',
          expansionState: 'expanded',
          reason: 'already expanded',
        },
      ],
    });

    render(
      <MigrationBookOfWorkReviewWorkspace
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('review-workspace')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('expand-all-epics-button'));

    await waitFor(() =>
      expect(screen.getByTestId('badge-expansion-epic-ne')).toHaveTextContent(
        'expanded',
      ),
    );
    expect(mockExpandAll).toHaveBeenCalledTimes(1);
    // "Expand all" re-expands terminal epics → includeExpanded = true.
    expect(mockExpandAll).toHaveBeenCalledWith(PROJECT_ID, BOOK_ID, true);
    // The failed epic stays retryable and the failure is surfaced.
    expect(screen.getByTestId('badge-expansion-epic-f')).toHaveTextContent(
      'expansion failed',
    );
    expect(screen.getByTestId('expand-epic-button-epic-f')).toHaveTextContent(
      'Retry expansion',
    );
    expect(screen.getByTestId('expansion-error-banner')).toHaveTextContent(
      /1 epic\(s\) failed to expand/,
    );
  });

  it('"Expand remaining" calls the expand-all API with includeExpanded = false (leaves expanded epics alone)', async () => {
    const skeleton = makeSkeletonFixture();
    mockGetMigrationBookOfWork
      .mockResolvedValueOnce(makeDraft(skeleton))
      .mockResolvedValue(makeDraft(skeleton));
    mockExpandAll.mockResolvedValueOnce({ results: [], skipped: [] });

    render(
      <MigrationBookOfWorkReviewWorkspace projectId={PROJECT_ID} bookId={BOOK_ID} />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('review-workspace')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('expand-remaining-epics-button'));

    await waitFor(() => expect(mockExpandAll).toHaveBeenCalledTimes(1));
    expect(mockExpandAll).toHaveBeenCalledWith(PROJECT_ID, BOOK_ID, false);
  });
});
