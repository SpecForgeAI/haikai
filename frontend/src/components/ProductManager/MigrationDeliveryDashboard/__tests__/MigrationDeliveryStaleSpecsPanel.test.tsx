/**
 * MigrationDeliveryStaleSpecsPanel tests.
 *
 * Spec: 2026-05-20 Target Architecture Authoring Flow -- Task Group 9.1.
 *
 * Three tests:
 *   1. Renders the stale count from the summary (clickable when > 0,
 *      disabled when 0).
 *   2. Clicking the indicator opens a details panel listing stale stories
 *      with titles joined from the dashboard's needs-attention rows when
 *      available.
 *   3. "Regenerate stale" calls the existing batch entrypoint with
 *      `targetWorkItemIds = staleWorkItemIds` and `regenerateAll: true`,
 *      and invokes `onRegenerated` on success.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock the CSS module so class-name access does not blow up under jsdom.
vi.mock('../MigrationDeliveryDashboard.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

import { MigrationDeliveryStaleSpecsPanel } from '../MigrationDeliveryStaleSpecsPanel';
import type {
  MigrationDeliveryNeedsAttentionItemDto,
  StaleSpecSummary,
} from '../../../../api/migrationDeliveryDashboardApi';
import type { BatchGenerationResult } from '../../../../api/specGenerationApi';

const PROJECT_ID = 'proj-stale';
const BOOK_ID = 'book-stale';

function makeNeedsAttention(
  overrides: Partial<MigrationDeliveryNeedsAttentionItemDto>,
): MigrationDeliveryNeedsAttentionItemDto {
  return {
    bookItemId: 'bi-x',
    workItemId: 'wi-x',
    type: 'failed',
    priorityRank: 1,
    title: 'A story',
    workstream: null,
    specGenerationStatus: 'failed',
    specGenerationConfidence: null,
    implementationStatus: 'not_started',
    reason: 'A reason',
    missingInputs: null,
    ...overrides,
  };
}

function makeBatchResult(): BatchGenerationResult {
  return {
    perStoryResults: [],
    persistedCount: 0,
    resultsCouldNotPersist: 0,
    unpersistedResults: [],
    nextBatchStart: 0,
    summary: {
      generated: 0,
      generated_with_warnings: 0,
      insufficient_context: 0,
      failed: 0,
      skipped_blocked: 0,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MigrationDeliveryStaleSpecsPanel', () => {
  it('renders the stale-specs count and disables click when zero', () => {
    const summary: StaleSpecSummary = { staleCount: 0, staleWorkItemIds: [] };
    render(
      <MigrationDeliveryStaleSpecsPanel
        projectId={PROJECT_ID}
        bookOfWorkId={BOOK_ID}
        staleSummary={summary}
        onRegenerated={() => undefined}
      />,
    );

    const valueBtn = screen.getByTestId('mdd-summary-card-stale-specs-value');
    expect(valueBtn).toHaveTextContent('0');
    expect(valueBtn).toBeDisabled();
    // Panel must not be open when not clicked.
    expect(screen.queryByTestId('mdd-stale-specs-panel')).toBeNull();
  });

  it('opens the details panel on click and lists stale story titles joined from needsAttention', () => {
    const staleIds = ['wi-1', 'wi-2', 'wi-unknown'];
    const summary: StaleSpecSummary = {
      staleCount: staleIds.length,
      staleWorkItemIds: staleIds,
    };
    const needs: MigrationDeliveryNeedsAttentionItemDto[] = [
      makeNeedsAttention({ workItemId: 'wi-1', title: 'Order story' }),
      makeNeedsAttention({ workItemId: 'wi-2', title: 'Payment story' }),
    ];

    render(
      <MigrationDeliveryStaleSpecsPanel
        projectId={PROJECT_ID}
        bookOfWorkId={BOOK_ID}
        staleSummary={summary}
        needsAttention={needs}
        onRegenerated={() => undefined}
      />,
    );

    const valueBtn = screen.getByTestId('mdd-summary-card-stale-specs-value');
    expect(valueBtn).toHaveTextContent('3');
    expect(valueBtn).not.toBeDisabled();
    fireEvent.click(valueBtn);

    expect(screen.getByTestId('mdd-stale-specs-panel')).toBeTruthy();
    expect(
      screen.getByTestId('mdd-stale-specs-list-item-wi-1'),
    ).toHaveTextContent('Order story');
    expect(
      screen.getByTestId('mdd-stale-specs-list-item-wi-2'),
    ).toHaveTextContent('Payment story');
    // Unknown id falls back to a generic label rather than blowing up.
    expect(
      screen.getByTestId('mdd-stale-specs-list-item-wi-unknown'),
    ).toHaveTextContent(/WorkItem/i);
  });

  it('calls startBatchGeneration with the stale ids and regenerateAll=true on Regenerate stale', async () => {
    const staleIds = ['wi-1', 'wi-2'];
    const summary: StaleSpecSummary = {
      staleCount: staleIds.length,
      staleWorkItemIds: staleIds,
    };
    const startBatchMock = vi.fn(async () => makeBatchResult());
    const onRegenerated = vi.fn();

    render(
      <MigrationDeliveryStaleSpecsPanel
        projectId={PROJECT_ID}
        bookOfWorkId={BOOK_ID}
        staleSummary={summary}
        onRegenerated={onRegenerated}
        startBatchGenerationFn={startBatchMock as never}
      />,
    );

    fireEvent.click(screen.getByTestId('mdd-summary-card-stale-specs-value'));
    fireEvent.click(screen.getByTestId('mdd-stale-specs-regenerate'));

    await waitFor(() => expect(startBatchMock).toHaveBeenCalledTimes(1));
    expect(startBatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        bookOfWorkId: BOOK_ID,
        regenerateAll: true,
        targetWorkItemIds: staleIds,
      }),
    );
    await waitFor(() => expect(onRegenerated).toHaveBeenCalledTimes(1));
  });
});
