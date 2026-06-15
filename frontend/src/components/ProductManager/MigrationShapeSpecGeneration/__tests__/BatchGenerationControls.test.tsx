/**
 * BatchGenerationControls + BatchResultsTable tests
 *
 * Spec: 2026-05-19 PM Migration Shape-Spec Batch Generation
 * Task Group 10.1 — primary action + in-progress banner + results table.
 *
 * Coverage:
 *   1. Clicking "Generate specs for all stories" starts the first batch via
 *      the gateway endpoint (mocked POST -> handler from Group 6).
 *   2. While a batch is in-flight, the "Generate next batch" button is
 *      DISABLED and the in-progress banner `Batch in progress (story X of N)`
 *      is visible (A-9).
 *   3. "Generate next 25" continues from `nextBatchStart` (re-fetched from
 *      summary) and appends new rows to the results table.
 *   4. The results table renders predicted readiness, actual status, and
 *      confidence columns side-by-side per row (R-10).
 *
 * The tests exercise both `BatchGenerationControls` (the buttons + toggles
 * + banner) and `BatchResultsTable` directly where the column shape is
 * the load-bearing assertion (Test 4), plus a parent-surface integration
 * test for Tests 1 + 2 + 3 (driven through `SpecGenerationWorkspace` so the
 * batch-runner wiring is also covered).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  act,
} from '@testing-library/react';

// Mock the CSS module.
vi.mock('../MigrationShapeSpecGeneration.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

// Mock the API client BEFORE importing the components.
const mockFetchSummary = vi.fn();
const mockFetchRows = vi.fn();
const mockStartBatch = vi.fn();
const mockRegenerateSingle = vi.fn();

vi.mock('../../../../api/specGenerationApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/specGenerationApi')
  >('../../../../api/specGenerationApi');
  return {
    ...actual,
    fetchSpecGenerationSummary: (...args: unknown[]) =>
      mockFetchSummary(...args),
    fetchSpecGenerationsForBook: (...args: unknown[]) => mockFetchRows(...args),
    startBatchGeneration: (...args: unknown[]) => mockStartBatch(...args),
    regenerateSingleStory: (...args: unknown[]) => mockRegenerateSingle(...args),
  };
});

import { SpecGenerationWorkspace } from '../SpecGenerationWorkspace';
import { BatchResultsTable } from '../BatchResultsTable';
import type {
  SpecGenerationRow,
  SpecGenerationSummaryDto,
  BatchGenerationResult,
} from '../../../../api/specGenerationApi';

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

const PROJECT_ID = 'proj-1';
const BOOK_ID = 'book-1';

function makeSummary(
  overrides: Partial<SpecGenerationSummaryDto> = {},
): SpecGenerationSummaryDto {
  return {
    totalStories: 60,
    savedStoryCount: 60,
    attemptedCount: 0,
    generatedCount: 0,
    generatedWithWarningsCount: 0,
    insufficientContextCount: 0,
    failedCount: 0,
    skippedBlockedCount: 0,
    notAttemptedCount: 60,
    nextBatchStart: 1,
    nextBatchSize: 25,
    ...overrides,
  };
}

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
    generatedAt: '2026-05-19T10:00:00Z',
    errorMessage: null,
    generationAttemptNumber: 1,
    createdByTask: 'product-manager--migration-shape-spec-generation',
    createdAt: '2026-05-19T10:00:00Z',
    updatedAt: '2026-05-19T10:00:00Z',
    storyTitle: 'Migrate order-service create endpoint',
    parentTitle: 'Order service migration',
    ...overrides,
  };
}

function makeBatchResult(
  rows: SpecGenerationRow[],
  overrides: Partial<BatchGenerationResult> = {},
): BatchGenerationResult {
  return {
    perStoryResults: rows,
    persistedCount: rows.length,
    resultsCouldNotPersist: 0,
    unpersistedResults: [],
    nextBatchStart: 26,
    summary: {
      generated: rows.filter((r) => r.status === 'generated').length,
      generated_with_warnings: rows.filter(
        (r) => r.status === 'generated_with_warnings',
      ).length,
      insufficient_context: rows.filter(
        (r) => r.status === 'insufficient_context',
      ).length,
      failed: rows.filter((r) => r.status === 'failed').length,
      skipped_blocked: rows.filter((r) => r.status === 'skipped_blocked').length,
    },
    ...overrides,
  };
}

/**
 * Tiny helper: yield to the microtask + macrotask queues so the in-flight
 * state set inside an async click handler can be committed by React before
 * we run our DOM assertions. `waitFor`'s default 50ms polling interval is
 * occasionally racy in jsdom against an immediately-resolving setState
 * inside an unawaited async callback, so we pump the event loop explicitly.
 */
async function flushPending() {
  // Two microtask flushes followed by a macrotask flush is enough for React
  // 18 batched setState commits in jsdom; tested with the same component
  // shape used in MigrationDeliveryPlan.
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mockFetchSummary.mockResolvedValue(makeSummary());
  mockFetchRows.mockResolvedValue([]);
});

// ----------------------------------------------------------------------------
// Test 1 — "Generate specs for all stories" starts the first batch
// ----------------------------------------------------------------------------

describe('BatchGenerationControls — generate-all kicks off a batch (Task 10.1 #1)', () => {
  it('clicking the primary action invokes the gateway batch endpoint with the project + book ids', async () => {
    // Resolve the start-batch call with an empty result so the
    // generate-all loop terminates on the first iteration.
    mockStartBatch.mockResolvedValueOnce(makeBatchResult([]));
    // Make the post-batch summary refresh report zero remaining so the
    // generate-all loop exits cleanly.
    mockFetchSummary
      .mockResolvedValueOnce(makeSummary({ notAttemptedCount: 60 }))
      .mockResolvedValueOnce(makeSummary({ notAttemptedCount: 0 }))
      .mockResolvedValueOnce(makeSummary({ notAttemptedCount: 0 }));

    render(
      <SpecGenerationWorkspace
        projectId={PROJECT_ID}
        bookOfWorkId={BOOK_ID}
      />,
    );

    // Wait for initial summary so the button enables.
    await screen.findByTestId('msg-summary-header');

    const button = screen.getByTestId('msg-action-generate-all');
    expect(button).not.toBeDisabled();
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockStartBatch).toHaveBeenCalled();
    });
    const callArg = mockStartBatch.mock.calls[0][0];
    expect(callArg).toMatchObject({
      projectId: PROJECT_ID,
      bookOfWorkId: BOOK_ID,
      regenerateAll: false,
      skipBlockedStories: false,
    });
  });
});

// ----------------------------------------------------------------------------
// Test 2 — in-flight banner + Generate-next-batch disabled while batch
// is in-flight (A-9)
// ----------------------------------------------------------------------------

describe('BatchGenerationControls — in-flight banner + disabled next-batch (Task 10.1 #2)', () => {
  it('shows the "Batch in progress (story X of N)" banner and disables the "Generate next" button while the batch is in flight', async () => {
    // Hold the start-batch promise pending so we can assert the in-flight
    // UI state. Resolve it explicitly later to let the test exit cleanly.
    let resolveBatch: ((v: BatchGenerationResult) => void) | null = null;
    mockStartBatch.mockImplementationOnce(
      () =>
        new Promise<BatchGenerationResult>((resolve) => {
          resolveBatch = resolve;
        }),
    );

    render(
      <SpecGenerationWorkspace
        projectId={PROJECT_ID}
        bookOfWorkId={BOOK_ID}
      />,
    );

    await screen.findByTestId('msg-summary-header');

    // Click the "Generate next 25" button to kick off a batch.
    fireEvent.click(screen.getByTestId('msg-action-generate-next-batch'));
    // Pump pending microtasks + a macrotask so the async setState lands.
    await flushPending();

    // The in-progress banner appears.
    const banner = await screen.findByTestId('msg-batch-in-progress-banner');
    expect(banner.textContent).toMatch(
      /batch in progress \(story \d+ of \d+\)/i,
    );

    // The "Generate next" button is disabled while the batch is in flight.
    expect(screen.getByTestId('msg-action-generate-next-batch')).toBeDisabled();
    // The "Generate all" button is also disabled while the batch is in
    // flight (A-9: navigating away does NOT cancel; you cannot start a
    // second batch concurrently).
    expect(screen.getByTestId('msg-action-generate-all')).toBeDisabled();

    // Resolve the batch so the component can clean up; tests do not block
    // on this beyond ensuring the in-flight state was rendered correctly.
    resolveBatch?.(makeBatchResult([]));
  });
});

// ----------------------------------------------------------------------------
// Test 3 — "Generate next 25" continues from nextBatchStart + appends rows
// ----------------------------------------------------------------------------

describe('BatchGenerationControls — Generate-next-25 continues from nextBatchStart (Task 10.1 #3)', () => {
  it('uses the re-fetched summary on subsequent batches and appends new rows to the results table', async () => {
    // Initial state: 60 stories remaining, next batch starts at 1.
    mockFetchSummary
      .mockResolvedValueOnce(makeSummary({ notAttemptedCount: 60, nextBatchStart: 1 }))
      // After the first batch, 35 remain and next batch starts at 26.
      .mockResolvedValueOnce(
        makeSummary({
          notAttemptedCount: 35,
          attemptedCount: 25,
          generatedCount: 25,
          nextBatchStart: 26,
        }),
      )
      // Subsequent calls return the same shape so the workspace can render.
      .mockResolvedValue(
        makeSummary({
          notAttemptedCount: 35,
          attemptedCount: 25,
          generatedCount: 25,
          nextBatchStart: 26,
        }),
      );

    const firstBatchRows = [
      makeRow({
        id: 'r-1',
        workItemId: 'wi-1',
        storyTitle: 'Story one',
      }),
      makeRow({
        id: 'r-2',
        workItemId: 'wi-2',
        storyTitle: 'Story two',
      }),
    ];
    const secondBatchRows = [
      makeRow({
        id: 'r-3',
        workItemId: 'wi-3',
        storyTitle: 'Story three',
        status: 'generated_with_warnings',
      }),
    ];
    mockStartBatch
      .mockResolvedValueOnce(makeBatchResult(firstBatchRows, { nextBatchStart: 26 }))
      .mockResolvedValueOnce(
        makeBatchResult(secondBatchRows, { nextBatchStart: 51 }),
      );

    render(
      <SpecGenerationWorkspace
        projectId={PROJECT_ID}
        bookOfWorkId={BOOK_ID}
      />,
    );

    await screen.findByTestId('msg-summary-header');

    // ---- First batch ----
    fireEvent.click(screen.getByTestId('msg-action-generate-next-batch'));

    await screen.findByTestId('msg-results-row-wi-1');
    await screen.findByTestId('msg-results-row-wi-2');

    // Summary re-fetched after the batch, so nextBatchStart should now be 26.
    await waitFor(() => {
      expect(screen.getByTestId('msg-summary-next-range')).toHaveTextContent(
        /26-50/,
      );
    });

    // ---- Second batch ----
    // Generate-next-batch button is re-enabled after the first batch
    // completes.
    await waitFor(() => {
      expect(
        screen.getByTestId('msg-action-generate-next-batch'),
      ).not.toBeDisabled();
    });

    fireEvent.click(screen.getByTestId('msg-action-generate-next-batch'));

    await screen.findByTestId('msg-results-row-wi-3');
    // Previous rows still present (rows are appended, not replaced).
    expect(screen.getByTestId('msg-results-row-wi-1')).toBeInTheDocument();
    expect(screen.getByTestId('msg-results-row-wi-2')).toBeInTheDocument();

    // The second call to the gateway happened.
    expect(mockStartBatch).toHaveBeenCalledTimes(2);
  });
});

// ----------------------------------------------------------------------------
// Test 4 — results table renders predicted / actual / confidence side-by-side
// (R-10)
// ----------------------------------------------------------------------------

describe('BatchResultsTable — predicted / actual / confidence side-by-side columns (Task 10.1 #4)', () => {
  it('renders each row with predicted-readiness, actual-status, and confidence columns adjacent', () => {
    const rows: SpecGenerationRow[] = [
      makeRow({
        id: 'r-1',
        workItemId: 'wi-1',
        storyTitle: 'Story with all three',
        predictedReadiness: 'ready_for_spec',
        status: 'generated',
        confidence: 'high',
      }),
      makeRow({
        id: 'r-2',
        workItemId: 'wi-2',
        storyTitle: 'Insufficient-context story',
        predictedReadiness: 'needs_focused_context',
        status: 'insufficient_context',
        confidence: 'low',
      }),
    ];

    render(
      <BatchResultsTable
        rows={rows}
        batchInProgress={false}
        onRetryStory={() => undefined}
      />,
    );

    // Column headers are rendered in this exact order: predicted readiness
    // then actual status then confidence. R-10 says the three sit
    // side-by-side per row.
    const predictedHeader = screen.getByTestId('msg-results-col-predicted');
    const actualHeader = screen.getByTestId('msg-results-col-actual');
    const confidenceHeader = screen.getByTestId('msg-results-col-confidence');
    expect(predictedHeader).toBeInTheDocument();
    expect(actualHeader).toBeInTheDocument();
    expect(confidenceHeader).toBeInTheDocument();

    // Adjacency check via parent row containment: all three chips appear in
    // the same row.
    const row1 = screen.getByTestId('msg-results-row-wi-1');
    expect(
      within(row1).getByTestId('msg-results-row-wi-1-predicted'),
    ).toHaveTextContent(/ready for spec/i);
    expect(
      within(row1).getByTestId('msg-results-row-wi-1-actual'),
    ).toHaveTextContent(/^generated$/i);
    expect(
      within(row1).getByTestId('msg-results-row-wi-1-confidence'),
    ).toHaveTextContent(/high/i);

    const row2 = screen.getByTestId('msg-results-row-wi-2');
    expect(
      within(row2).getByTestId('msg-results-row-wi-2-predicted'),
    ).toHaveTextContent(/needs focused context/i);
    expect(
      within(row2).getByTestId('msg-results-row-wi-2-actual'),
    ).toHaveTextContent(/insufficient context/i);
    expect(
      within(row2).getByTestId('msg-results-row-wi-2-confidence'),
    ).toHaveTextContent(/low/i);
  });

  it('exposes a retry control on failed rows that triggers the parent callback', () => {
    const onRetry = vi.fn();
    const rows: SpecGenerationRow[] = [
      makeRow({
        id: 'r-failed',
        workItemId: 'wi-failed',
        storyTitle: 'A failed story',
        status: 'failed',
        confidence: null,
        generatedSpecText: null,
        errorMessage: 'LLM call failed',
      }),
    ];

    render(
      <BatchResultsTable
        rows={rows}
        batchInProgress={false}
        onRetryStory={onRetry}
      />,
    );

    const retry = screen.getByTestId('msg-results-row-wi-failed-retry');
    expect(retry).toBeInTheDocument();
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledWith('wi-failed');
  });
});
