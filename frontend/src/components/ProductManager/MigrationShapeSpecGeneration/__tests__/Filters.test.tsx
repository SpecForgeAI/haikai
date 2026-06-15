/**
 * SpecGenerationFilters tests
 *
 * Spec: 2026-05-19 PM Migration Shape-Spec Batch Generation
 * Task Group 11.1 - filter panel coverage.
 *
 * Coverage (Test 1 of three from task 11.1):
 *   - Filters narrow the batch results table by all five filter dimensions:
 *     actual status, confidence, predicted readiness, workstream, and parent
 *     epic / feature.
 *
 * The test renders the full `SpecGenerationWorkspace` so we exercise the
 * end-to-end wiring (filter UI -> workspace state -> results table).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

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

function makeSummary(
  overrides: Partial<SpecGenerationSummaryDto> = {},
): SpecGenerationSummaryDto {
  return {
    totalStories: 4,
    savedStoryCount: 4,
    attemptedCount: 4,
    generatedCount: 2,
    generatedWithWarningsCount: 0,
    insufficientContextCount: 1,
    failedCount: 1,
    skippedBlockedCount: 0,
    notAttemptedCount: 0,
    nextBatchStart: 5,
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
    storyTitle: 'Story',
    parentTitle: 'Parent feature',
    parentType: 'feature',
    workstream: 'order-service',
    ...overrides,
  };
}

const ROWS: SpecGenerationRow[] = [
  makeRow({
    id: 'r1',
    workItemId: 'wi-1',
    storyTitle: 'Generated high-confidence story',
    status: 'generated',
    confidence: 'high',
    predictedReadiness: 'ready_for_spec',
    workstream: 'order-service',
    parentTitle: 'Order service migration',
  }),
  makeRow({
    id: 'r2',
    workItemId: 'wi-2',
    storyTitle: 'Insufficient-context story',
    status: 'insufficient_context',
    confidence: 'low',
    predictedReadiness: 'needs_focused_context',
    workstream: 'order-service',
    parentTitle: 'Order service migration',
  }),
  makeRow({
    id: 'r3',
    workItemId: 'wi-3',
    storyTitle: 'Failed payment story',
    status: 'failed',
    confidence: 'medium',
    predictedReadiness: 'blocked',
    workstream: 'payment-service',
    parentTitle: 'Payment service migration',
  }),
  makeRow({
    id: 'r4',
    workItemId: 'wi-4',
    storyTitle: 'Generated medium story payment',
    status: 'generated',
    confidence: 'medium',
    predictedReadiness: 'needs_user_decision',
    workstream: 'payment-service',
    parentTitle: 'Payment service migration',
  }),
];

beforeEach(() => {
  vi.resetAllMocks();
  mockFetchSummary.mockResolvedValue(makeSummary());
  mockFetchRows.mockResolvedValue(ROWS);
  mockFetchSpecsForWorkItem.mockResolvedValue([]);
});

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

async function waitForRows() {
  await waitFor(() => {
    expect(screen.getByTestId('msg-results-row-wi-1')).toBeInTheDocument();
    expect(screen.getByTestId('msg-results-row-wi-2')).toBeInTheDocument();
    expect(screen.getByTestId('msg-results-row-wi-3')).toBeInTheDocument();
    expect(screen.getByTestId('msg-results-row-wi-4')).toBeInTheDocument();
  });
}

function selectFilter(testId: string, value: string) {
  const select = screen.getByTestId(testId) as HTMLSelectElement;
  fireEvent.change(select, { target: { value } });
}

// ----------------------------------------------------------------------------
// Test 1 - filter narrows the table by each of the five dimensions
// ----------------------------------------------------------------------------

describe('SpecGenerationFilters - five filter dimensions (Task 11.1 #1)', () => {
  it('narrows the batch results table by actual status', async () => {
    render(
      <SpecGenerationWorkspace
        projectId={PROJECT_ID}
        bookOfWorkId={BOOK_ID}
      />,
    );
    await waitForRows();

    selectFilter('msg-filter-status', 'generated');

    await waitFor(() => {
      expect(screen.getByTestId('msg-results-row-wi-1')).toBeInTheDocument();
      expect(screen.getByTestId('msg-results-row-wi-4')).toBeInTheDocument();
      expect(screen.queryByTestId('msg-results-row-wi-2')).not.toBeInTheDocument();
      expect(screen.queryByTestId('msg-results-row-wi-3')).not.toBeInTheDocument();
    });
  });

  it('narrows the batch results table by confidence', async () => {
    render(
      <SpecGenerationWorkspace
        projectId={PROJECT_ID}
        bookOfWorkId={BOOK_ID}
      />,
    );
    await waitForRows();

    selectFilter('msg-filter-confidence', 'low');

    await waitFor(() => {
      expect(screen.getByTestId('msg-results-row-wi-2')).toBeInTheDocument();
      expect(screen.queryByTestId('msg-results-row-wi-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('msg-results-row-wi-3')).not.toBeInTheDocument();
      expect(screen.queryByTestId('msg-results-row-wi-4')).not.toBeInTheDocument();
    });
  });

  it('narrows the batch results table by predicted readiness', async () => {
    render(
      <SpecGenerationWorkspace
        projectId={PROJECT_ID}
        bookOfWorkId={BOOK_ID}
      />,
    );
    await waitForRows();

    selectFilter('msg-filter-predicted-readiness', 'blocked');

    await waitFor(() => {
      expect(screen.getByTestId('msg-results-row-wi-3')).toBeInTheDocument();
      expect(screen.queryByTestId('msg-results-row-wi-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('msg-results-row-wi-2')).not.toBeInTheDocument();
      expect(screen.queryByTestId('msg-results-row-wi-4')).not.toBeInTheDocument();
    });
  });

  it('narrows the batch results table by workstream', async () => {
    render(
      <SpecGenerationWorkspace
        projectId={PROJECT_ID}
        bookOfWorkId={BOOK_ID}
      />,
    );
    await waitForRows();

    selectFilter('msg-filter-workstream', 'payment-service');

    await waitFor(() => {
      expect(screen.getByTestId('msg-results-row-wi-3')).toBeInTheDocument();
      expect(screen.getByTestId('msg-results-row-wi-4')).toBeInTheDocument();
      expect(screen.queryByTestId('msg-results-row-wi-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('msg-results-row-wi-2')).not.toBeInTheDocument();
    });
  });

  it('narrows the batch results table by parent epic / feature', async () => {
    render(
      <SpecGenerationWorkspace
        projectId={PROJECT_ID}
        bookOfWorkId={BOOK_ID}
      />,
    );
    await waitForRows();

    selectFilter('msg-filter-parent', 'Order service migration');

    await waitFor(() => {
      expect(screen.getByTestId('msg-results-row-wi-1')).toBeInTheDocument();
      expect(screen.getByTestId('msg-results-row-wi-2')).toBeInTheDocument();
      expect(screen.queryByTestId('msg-results-row-wi-3')).not.toBeInTheDocument();
      expect(screen.queryByTestId('msg-results-row-wi-4')).not.toBeInTheDocument();
    });
  });
});
