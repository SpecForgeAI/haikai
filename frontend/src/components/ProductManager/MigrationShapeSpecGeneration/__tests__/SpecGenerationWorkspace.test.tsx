/**
 * SpecGenerationWorkspace tests
 *
 * Spec: 2026-05-19 PM Migration Shape-Spec Batch Generation
 * Task Group 9.1 — workspace shell + summary header coverage.
 * Task Group 12 — drawer auto-open on `initialDrawerWorkItemId`.
 *
 * Coverage:
 *   1. Workspace renders summary header with totals (saved stories,
 *      attempted, remaining), by-status counts (generated /
 *      generated_with_warnings / insufficient_context / failed /
 *      skipped_blocked), current batch size, next batch range, and the
 *      optional predicted-vs-actual metric (R-10).
 *   2. Workspace fetches the summary from
 *      `GET /api/projects/{projectId}/migration-books-of-work/{bookId}/spec-generation-summary`
 *      on mount.
 *   3. Re-fetch on return: re-mounting the workspace triggers a new summary
 *      fetch (A-9 — batch keeps running; on return, re-fetch state).
 *   4. (Task Group 12) When `initialDrawerWorkItemId` is set, the workspace
 *      auto-opens the story result drawer for the matching row once the row
 *      list has arrived from the fetcher.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Mock the CSS module so class-name access does not blow up under jsdom.
vi.mock('../MigrationShapeSpecGeneration.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

// Mock the API client BEFORE importing the component.
const mockFetchSummary = vi.fn();
const mockFetchRows = vi.fn();
const mockStartBatch = vi.fn();
const mockRegenerateSingle = vi.fn();
const mockFetchSpecsForWorkItem = vi.fn();

vi.mock('../../../../api/specGenerationApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/specGenerationApi')
  >('../../../../api/specGenerationApi');
  return {
    ...actual,
    fetchSpecGenerationSummary: (...args: unknown[]) =>
      mockFetchSummary(...args),
    fetchSpecGenerationsForBook: (...args: unknown[]) => mockFetchRows(...args),
    fetchSpecGenerationsForWorkItem: (...args: unknown[]) =>
      mockFetchSpecsForWorkItem(...args),
    startBatchGeneration: (...args: unknown[]) => mockStartBatch(...args),
    regenerateSingleStory: (...args: unknown[]) => mockRegenerateSingle(...args),
  };
});

import { SpecGenerationWorkspace } from '../SpecGenerationWorkspace';
import type {
  SpecGenerationRow,
  SpecGenerationSummaryDto,
} from '../../../../api/specGenerationApi';

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

const PROJECT_ID = 'proj-1';
const BOOK_ID = 'book-1';

const SUMMARY_FIXTURE: SpecGenerationSummaryDto = {
  totalStories: 60,
  savedStoryCount: 60,
  attemptedCount: 25,
  generatedCount: 14,
  generatedWithWarningsCount: 4,
  insufficientContextCount: 5,
  failedCount: 2,
  skippedBlockedCount: 0,
  notAttemptedCount: 35,
  nextBatchStart: 26,
  nextBatchSize: 25,
};

function makeRow(overrides: Partial<SpecGenerationRow>): SpecGenerationRow {
  return {
    id: 'row-1',
    projectId: PROJECT_ID,
    workItemId: 'wi-1',
    bookOfWorkId: BOOK_ID,
    bookItemId: 'bi-1',
    status: 'generated',
    confidence: 'high',
    predictedReadiness: 'ready_for_spec',
    generatedSpecText: '/agent-os:shape-spec sample',
    warnings: [],
    missingInputs: [],
    focusedContextRefs: null,
    evidenceRefs: [],
    generatedAt: null,
    errorMessage: null,
    generationAttemptNumber: 1,
    createdByTask: 'product-manager--migration-shape-spec-generation',
    createdAt: null,
    updatedAt: null,
    storyTitle: 'Story title',
    parentTitle: 'Parent feature',
    parentType: 'feature',
    workstream: 'order-service',
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockFetchSummary.mockResolvedValue(SUMMARY_FIXTURE);
  mockFetchRows.mockResolvedValue([]);
  mockFetchSpecsForWorkItem.mockResolvedValue([]);
});

// ----------------------------------------------------------------------------
// Test 1 — summary header surface (totals + by-status counts + next batch +
// predicted-vs-actual stub)
// ----------------------------------------------------------------------------

describe('SpecGenerationWorkspace — summary header surface (Task 9.1 #1)', () => {
  it('renders saved-story totals, by-status counts, remaining, current batch size, next batch range, and predicted-vs-actual', async () => {
    render(
      <SpecGenerationWorkspace
        projectId={PROJECT_ID}
        bookOfWorkId={BOOK_ID}
        bookTitle="Migration Book of Work — sample"
      />,
    );

    // Wait for summary to load.
    await waitFor(() => {
      expect(screen.getByTestId('msg-summary-header')).toBeInTheDocument();
    });

    // Saved-story totals.
    expect(screen.getByTestId('msg-summary-count-saved-stories')).toHaveTextContent(
      '60',
    );
    expect(screen.getByTestId('msg-summary-count-attempted')).toHaveTextContent(
      '25',
    );
    expect(screen.getByTestId('msg-summary-count-remaining')).toHaveTextContent(
      '35',
    );

    // Per-status counts.
    expect(screen.getByTestId('msg-summary-status-generated')).toHaveTextContent(
      /Generated:\s*14/i,
    );
    expect(
      screen.getByTestId('msg-summary-status-generated_with_warnings'),
    ).toHaveTextContent(/Generated with warnings:\s*4/i);
    expect(
      screen.getByTestId('msg-summary-status-insufficient_context'),
    ).toHaveTextContent(/Insufficient context:\s*5/i);
    expect(screen.getByTestId('msg-summary-status-failed')).toHaveTextContent(
      /Failed:\s*2/i,
    );
    expect(
      screen.getByTestId('msg-summary-status-skipped_blocked'),
    ).toHaveTextContent(/Skipped \(blocked\):\s*0/i);

    // Current batch size + next batch range.
    expect(screen.getByTestId('msg-summary-batch-size')).toHaveTextContent(
      /Current batch size:\s*25/i,
    );
    expect(screen.getByTestId('msg-summary-next-range')).toHaveTextContent(
      /Next batch range:\s*26-50/i,
    );

    // Predicted-vs-actual: no rows have predictedReadiness, so the metric
    // falls back to "n/a" per Task 9.4 (the implementer is told to stub
    // rather than fabricate when the signal is not yet wired through).
    expect(
      screen.getByTestId('msg-summary-predicted-vs-actual-value'),
    ).toHaveTextContent(/n\/a/i);
  });
});

// ----------------------------------------------------------------------------
// Test 2 — fetches summary on mount
// ----------------------------------------------------------------------------

describe('SpecGenerationWorkspace — summary fetch on mount (Task 9.1 #2)', () => {
  it('calls fetchSpecGenerationSummary with the project id and book id on mount', async () => {
    render(
      <SpecGenerationWorkspace
        projectId={PROJECT_ID}
        bookOfWorkId={BOOK_ID}
      />,
    );

    await waitFor(() => {
      expect(mockFetchSummary).toHaveBeenCalled();
    });
    expect(mockFetchSummary).toHaveBeenCalledWith(PROJECT_ID, BOOK_ID);
  });
});

// ----------------------------------------------------------------------------
// Test 3 — re-fetch on remount (return from navigation; A-9)
// ----------------------------------------------------------------------------

describe('SpecGenerationWorkspace — re-fetch on remount (Task 9.1 #3)', () => {
  it('re-fetches the summary when the workspace is remounted', async () => {
    const { unmount } = render(
      <SpecGenerationWorkspace
        projectId={PROJECT_ID}
        bookOfWorkId={BOOK_ID}
      />,
    );

    await waitFor(() => {
      expect(mockFetchSummary).toHaveBeenCalledTimes(1);
    });

    // Simulate the user navigating away (component unmounts) and returning
    // (a new instance mounts). A-9 says the batch keeps running; the
    // workspace must re-fetch on return to show the latest counts.
    unmount();

    render(
      <SpecGenerationWorkspace
        projectId={PROJECT_ID}
        bookOfWorkId={BOOK_ID}
      />,
    );

    await waitFor(() => {
      expect(mockFetchSummary).toHaveBeenCalledTimes(2);
    });
    expect(mockFetchSummary).toHaveBeenLastCalledWith(PROJECT_ID, BOOK_ID);
  });
});

// ----------------------------------------------------------------------------
// Test 4 — initialDrawerWorkItemId auto-opens the drawer (Task Group 12)
// ----------------------------------------------------------------------------

describe('SpecGenerationWorkspace — auto-open drawer from initialDrawerWorkItemId (Task Group 12)', () => {
  it('opens the story result drawer for the matching row once the rows have arrived', async () => {
    mockFetchRows.mockResolvedValue([
      makeRow({
        workItemId: 'wi-deep-link',
        storyTitle: 'Drill-back target story',
        generatedSpecText: '/agent-os:shape-spec drill-back',
      }),
      makeRow({
        workItemId: 'wi-other',
        storyTitle: 'Unrelated row',
        generatedSpecText: '/agent-os:shape-spec unrelated',
      }),
    ]);

    render(
      <SpecGenerationWorkspace
        projectId={PROJECT_ID}
        bookOfWorkId={BOOK_ID}
        initialDrawerWorkItemId="wi-deep-link"
      />,
    );

    // Drawer opens automatically for the matching row.
    await waitFor(() => {
      expect(screen.getByTestId('msg-story-drawer')).toBeInTheDocument();
    });
    expect(screen.getByTestId('msg-story-drawer-title')).toHaveTextContent(
      /drill-back target story/i,
    );
  });
});
