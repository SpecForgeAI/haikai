/**
 * MigrationDeliveryDashboard -- Define Integration/E2E Tests node action
 *
 * Spec: 2026-06-14 Holistic Integration/E2E TEST Work Items (Spec 2 of 4)
 * -- Task Group 4 (D1 / D5(b)(c)).
 *
 * Coverage (focused):
 *   1. Clicking a FEATURE node's "Define Integration/E2E Tests" action calls
 *      the gateway route (via the `defineIntegrationTestsFn` seam) with the
 *      node's blob-item id AND re-fetches the dashboard so new TEST siblings
 *      surface.
 *   2. ALLOW-WITH-WARNING: a non-empty `skippedChildren` list is surfaced as a
 *      warning the user can act on (close gaps + re-run); the created count is
 *      still shown.
 *   3. Empty plan: when no cross-cutting tests are warranted
 *      (`emptyPlan: true`, `createdTestItems: []`), a clear "no integration/E2E
 *      tests needed" message is shown.
 *
 * Conventions mirror MigrationDeliveryDashboard.shell.test.tsx: vi.mock the CSS
 * module via a Proxy; all dashboard side-fetches are stubbed via the
 * component's test-seam props so the render is deterministic and offline.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// Mock the CSS module so class-name access does not blow up under jsdom.
vi.mock('../MigrationDeliveryDashboard.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

import { MigrationDeliveryDashboard } from '../MigrationDeliveryDashboard';
import type {
  MigrationDeliveryDashboardDto,
  DefineIntegrationTestsResult,
} from '../../../../api/migrationDeliveryDashboardApi';

const PROJECT_ID = 'proj-1';
const BOOK_ID = 'book-1';

/**
 * The real client-function type, for casting the vi.fn() stub to the dashboard
 * prop. Sourced via `typeof import(...)` so it does not need a value import.
 */
type DefineFn = typeof import(
  '../../../../api/migrationDeliveryDashboardApi'
).defineIntegrationTests;

beforeEach(() => {
  vi.resetAllMocks();
});

// Minimal dashboard with one feature node carrying one story.
function buildDashboard(): MigrationDeliveryDashboardDto {
  return {
    bookOfWorkId: BOOK_ID,
    projectId: PROJECT_ID,
    currentArchitectureId: 'arch-c',
    targetArchitectureId: 'arch-t',
    title: 'Book A',
    status: 'generated',
    generatedAt: '2026-06-14T00:00:00Z',
    summary: {
      totalInitiativeCount: 1,
      totalEpicCount: 1,
      totalFeatureCount: 1,
      totalStoryCount: 1,
      needsAttentionCount: 0,
    },
    hierarchy: [
      {
        id: 'feature-1',
        parentId: null,
        type: 'feature',
        title: 'Feature A',
        workstream: 'auth',
        sequenceOrder: 1,
        workItemId: 'wi-feature-1',
        backlogStatus: 'saved',
        specGenerationStatus: null,
        specGenerationConfidence: null,
        implementationStatus: null,
        evidenceStatus: 'none',
        needsAttentionCount: 0,
        missingInputsCount: null,
        children: [
          {
            id: 'story-1',
            parentId: 'feature-1',
            type: 'story',
            title: 'Story A.1',
            workstream: 'auth',
            sequenceOrder: 1,
            workItemId: 'wi-story-1',
            backlogStatus: 'saved',
            specGenerationStatus: 'generated',
            specGenerationConfidence: 'high',
            implementationStatus: null,
            evidenceStatus: 'none',
            needsAttentionCount: 0,
            missingInputsCount: null,
            children: [],
          },
        ],
      },
    ],
    workstreamSummaries: [],
    specGenerationSummary: {
      notAttemptedCount: 0,
      generatedCount: 1,
      generatedWithWarningsCount: 0,
      insufficientContextCount: 0,
      failedCount: 0,
      skippedBlockedCount: 0,
    },
    backlogSaveSummary: { savedCount: 1, notSavedToBacklogCount: 0 },
    implementationSummary: {
      notStartedCount: 1,
      inProgressCount: 0,
      blockedCount: 0,
      completedCount: 0,
      activeCount: 0,
    },
    evidenceSummary: {
      evidenceReferenceCount: 0,
      discoveryFindingReferenceCount: 0,
      apiBaselineReferenceCount: 0,
      mappingReferenceCount: 0,
      architectureReferenceCount: 0,
      anyCoverageCount: 0,
    },
    needsAttention: [],
    warnings: [],
  };
}

// Stub all dashboard side-fetches so the render is deterministic + offline.
function sideFetchSeams() {
  return {
    fetchStaleSpecSummary: vi
      .fn()
      .mockResolvedValue({ staleCount: 0, staleWorkItemIds: [] }),
    fetchReadyToRetry: vi
      .fn()
      .mockResolvedValue({ count: 0, specGenerationIds: [], specs: [] }),
    fetchBookOfWorkDraft: vi
      .fn()
      .mockResolvedValue({ generationSummary: null, bookOfWork: { items: [] } }),
  } as const;
}

const CREATED_ONE: DefineIntegrationTestsResult = {
  level: 'feature',
  nodeBookItemId: 'feature-1',
  nodeWorkItemId: 'wi-feature-1',
  testPlan: [],
  skippedChildren: [],
  specCompleteChildCount: 1,
  createdTestItems: [
    {
      workItemId: 'wi-test-1',
      bookItemId: 'test-1',
      title: 'X-cutting integration',
      type: 'integration',
      sequenceOrder: 2,
      specPersisted: true,
      implementStateWritten: true,
    },
  ],
  failedTestItems: [],
  emptyPlan: false,
};

describe('MigrationDeliveryDashboard -- Define Integration/E2E Tests action', () => {
  it('clicking a feature action calls the route with the node id and re-fetches the dashboard', async () => {
    const fetchDashboard = vi.fn().mockResolvedValue(buildDashboard());
    const defineFn = vi.fn().mockResolvedValue(CREATED_ONE);

    render(
      <MigrationDeliveryDashboard
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
        fetchDashboard={fetchDashboard}
        defineIntegrationTestsFn={defineFn as unknown as DefineFn}
        {...sideFetchSeams()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('mdd-hierarchy-section')).toBeInTheDocument(),
    );
    // Initial dashboard load happened once.
    expect(fetchDashboard).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('mdd-define-tests-feature-1'));

    // Route called with the node's blob-item id.
    await waitFor(() => expect(defineFn).toHaveBeenCalledTimes(1));
    expect(defineFn).toHaveBeenCalledWith(PROJECT_ID, BOOK_ID, 'feature-1');

    // Dashboard re-fetched so the new TEST sibling surfaces.
    await waitFor(() => expect(fetchDashboard).toHaveBeenCalledTimes(2));

    // Success banner confirms the created count.
    expect(screen.getByTestId('mdd-define-tests-created')).toHaveTextContent(
      /Created 1 integration\/E2E TEST item/i,
    );
  });

  it('surfaces the allow-with-warning skipped-children list and still reports the created tests', async () => {
    const fetchDashboard = vi.fn().mockResolvedValue(buildDashboard());
    const defineFn = vi.fn().mockResolvedValue({
      ...CREATED_ONE,
      skippedChildren: [
        {
          bookItemId: 'story-2',
          workItemId: null,
          title: 'Unscoped story',
          reason: 'insufficient_context',
        },
      ],
    } as DefineIntegrationTestsResult);

    render(
      <MigrationDeliveryDashboard
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
        fetchDashboard={fetchDashboard}
        defineIntegrationTestsFn={defineFn as unknown as DefineFn}
        {...sideFetchSeams()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('mdd-define-tests-feature-1')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('mdd-define-tests-feature-1'));

    // Warning list surfaces the skipped child + its reason; created count
    // still reported (allow-with-warning, never blocked).
    await waitFor(() =>
      expect(screen.getByTestId('mdd-define-tests-skipped')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('mdd-define-tests-skipped')).toHaveTextContent(
      /Unscoped story/,
    );
    expect(screen.getByTestId('mdd-define-tests-skipped')).toHaveTextContent(
      /insufficient_context/,
    );
    expect(screen.getByTestId('mdd-define-tests-created')).toBeInTheDocument();
  });

  it('shows a "no integration/E2E tests needed" message when the plan is empty', async () => {
    const fetchDashboard = vi.fn().mockResolvedValue(buildDashboard());
    const defineFn = vi.fn().mockResolvedValue({
      ...CREATED_ONE,
      createdTestItems: [],
      emptyPlan: true,
    } as DefineIntegrationTestsResult);

    render(
      <MigrationDeliveryDashboard
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
        fetchDashboard={fetchDashboard}
        defineIntegrationTestsFn={defineFn as unknown as DefineFn}
        {...sideFetchSeams()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('mdd-define-tests-feature-1')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('mdd-define-tests-feature-1'));

    await waitFor(() =>
      expect(screen.getByTestId('mdd-define-tests-empty')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('mdd-define-tests-empty')).toHaveTextContent(
      /No integration\/E2E tests needed/i,
    );
    // No "created" banner when nothing was created.
    expect(
      screen.queryByTestId('mdd-define-tests-created'),
    ).not.toBeInTheDocument();
  });
});
