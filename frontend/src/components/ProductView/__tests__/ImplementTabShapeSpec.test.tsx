/**
 * ImplementTabShapeSpec tests
 *
 * Spec: 2026-05-19 PM Migration Shape-Spec Batch Generation
 * Task Group 12.1 - WorkItem Implement-tab integration coverage.
 *
 * Coverage (Tests 1-3 from task 12.1):
 *   1. WorkItem Implement tab renders the "Generated shape-spec available"
 *      chip when `GET .../work-items/{workItemId}/spec-generations` returns
 *      a row (R-9).
 *   2. Clicking the chip drills back to the workspace and opens the story
 *      drawer for that WorkItem (the workspace accepts an
 *      `initialDrawerWorkItemId` prop; the chip calls the drill-back
 *      callback with the WorkItem id).
 *   3. Generated spec text is rendered inline with a copy button and
 *      status / confidence indicators visible.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockFetchSpecsForWorkItem = vi.fn();

vi.mock('../../../api/specGenerationApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../api/specGenerationApi')
  >('../../../api/specGenerationApi');
  return {
    ...actual,
    fetchSpecGenerationsForWorkItem: (...args: unknown[]) =>
      mockFetchSpecsForWorkItem(...args),
  };
});

// Mock the styles module for both the card's own stylesheet and the shared
// MigrationShapeSpecGeneration styles the card pulls in.
vi.mock(
  '../../ProductManager/MigrationShapeSpecGeneration/MigrationShapeSpecGeneration.module.css',
  () => ({
    default: new Proxy(
      {},
      { get: (_t: object, prop: string | symbol) => String(prop) },
    ),
  }),
);

import { ImplementTabShapeSpecCard } from '../ImplementTabShapeSpecCard';
import type { SpecGenerationRow } from '../../../api/specGenerationApi';

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

const PROJECT_ID = 'proj-1';
const WORK_ITEM_ID = 'wi-1';
const BOOK_ID = 'book-1';

function makeRow(overrides: Partial<SpecGenerationRow>): SpecGenerationRow {
  return {
    id: 'row-1',
    projectId: PROJECT_ID,
    workItemId: WORK_ITEM_ID,
    bookOfWorkId: BOOK_ID,
    bookItemId: 'bi-1',
    status: 'generated',
    confidence: 'high',
    predictedReadiness: 'ready_for_spec',
    generatedSpecText: '/agent-os:shape-spec a-generated-spec',
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
    storyTitle: 'A story title',
    parentTitle: 'A parent feature',
    parentType: 'feature',
    workstream: 'order-service',
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ----------------------------------------------------------------------------
// Test 1 - chip is rendered only when a spec-generation row exists (R-9)
// ----------------------------------------------------------------------------

describe('ImplementTabShapeSpecCard - chip rendering (Task 12.1 #1)', () => {
  it('renders the "Generated shape-spec available" chip when the endpoint returns a row', async () => {
    mockFetchSpecsForWorkItem.mockResolvedValue([makeRow({})]);

    render(
      <ImplementTabShapeSpecCard
        projectId={PROJECT_ID}
        workItemId={WORK_ITEM_ID}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId('msg-implement-spec-card-chip'),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId('msg-implement-spec-card-chip')).toHaveTextContent(
      /generated shape-spec available/i,
    );

    // The endpoint was called with the project id + work item id.
    expect(mockFetchSpecsForWorkItem).toHaveBeenCalledWith(
      PROJECT_ID,
      WORK_ITEM_ID,
    );
  });

  it('renders nothing when the endpoint returns no rows', async () => {
    mockFetchSpecsForWorkItem.mockResolvedValue([]);

    const { container } = render(
      <ImplementTabShapeSpecCard
        projectId={PROJECT_ID}
        workItemId={WORK_ITEM_ID}
      />,
    );

    // The card is hidden entirely when there is no spec row.
    await waitFor(() => {
      expect(mockFetchSpecsForWorkItem).toHaveBeenCalled();
    });
    expect(
      screen.queryByTestId('msg-implement-spec-card-chip'),
    ).not.toBeInTheDocument();
    // The whole card is also absent.
    expect(container.querySelector('[data-testid="msg-implement-spec-card"]'))
      .toBeNull();
  });
});

// ----------------------------------------------------------------------------
// Test 2 - clicking the chip drills back to the workspace + opens the drawer
// for this WorkItem
// ----------------------------------------------------------------------------

describe('ImplementTabShapeSpecCard - drill-back to workspace (Task 12.1 #2)', () => {
  it('invokes onDrillBackToWorkspace with the WorkItem id when the chip is clicked', async () => {
    mockFetchSpecsForWorkItem.mockResolvedValue([makeRow({})]);
    const onDrillBack = vi.fn();

    render(
      <ImplementTabShapeSpecCard
        projectId={PROJECT_ID}
        workItemId={WORK_ITEM_ID}
        onDrillBackToWorkspace={onDrillBack}
      />,
    );

    await screen.findByTestId('msg-implement-spec-card-chip');

    fireEvent.click(screen.getByTestId('msg-implement-spec-card-drill-back'));

    expect(onDrillBack).toHaveBeenCalledWith({
      workItemId: WORK_ITEM_ID,
      bookOfWorkId: BOOK_ID,
    });
  });
});

// ----------------------------------------------------------------------------
// Test 3 - inline spec text + copy button + status / confidence indicators
// ----------------------------------------------------------------------------

describe('ImplementTabShapeSpecCard - inline spec text + copy + indicators (Task 12.1 #3)', () => {
  it('renders the generated spec text inline with a copy button and visible status + confidence indicators', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const row = makeRow({
      status: 'generated_with_warnings',
      confidence: 'medium',
      generatedSpecText: '/agent-os:shape-spec inline-spec-here',
    });
    mockFetchSpecsForWorkItem.mockResolvedValue([row]);

    render(
      <ImplementTabShapeSpecCard
        projectId={PROJECT_ID}
        workItemId={WORK_ITEM_ID}
      />,
    );

    // Generated spec text rendered inline.
    const specText = await screen.findByTestId(
      'msg-implement-spec-card-spec-text',
    );
    expect(specText).toHaveTextContent(/inline-spec-here/i);

    // Status indicator visible.
    expect(
      screen.getByTestId('msg-implement-spec-card-status'),
    ).toHaveTextContent(/generated with warnings/i);

    // Confidence indicator visible.
    expect(
      screen.getByTestId('msg-implement-spec-card-confidence'),
    ).toHaveTextContent(/medium/i);

    // Copy button works.
    fireEvent.click(screen.getByTestId('msg-implement-spec-card-copy'));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(row.generatedSpecText);
    });
  });
});
