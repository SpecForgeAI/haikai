/**
 * StoryResultDrawer tests
 *
 * Spec: 2026-05-19 PM Migration Shape-Spec Batch Generation
 * Task Group 11.1 - story result drawer coverage.
 *
 * Coverage (Tests 2 + 3 from task 11.1):
 *   - Drawer renders generated spec text for a `generated` row with a
 *     working copy-to-clipboard button.
 *   - Drawer renders `missingInputs[]` and `recommendedNextAction` for an
 *     `insufficient_context` row.
 *
 * The drawer is tested in isolation (direct rendering) for spec content
 * assertions and through the parent `SpecGenerationWorkspace` for the
 * open-on-row-click integration assertion.
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

import { StoryResultDrawer } from '../StoryResultDrawer';
import { SpecGenerationWorkspace } from '../SpecGenerationWorkspace';
import type {
  SpecGenerationRow,
  SpecGenerationSummaryDto,
} from '../../../../api/specGenerationApi';

const PROJECT_ID = 'proj-1';
const BOOK_ID = 'book-1';

function makeSummary(
  overrides: Partial<SpecGenerationSummaryDto> = {},
): SpecGenerationSummaryDto {
  return {
    totalStories: 2,
    savedStoryCount: 2,
    attemptedCount: 2,
    generatedCount: 1,
    generatedWithWarningsCount: 0,
    insufficientContextCount: 1,
    failedCount: 0,
    skippedBlockedCount: 0,
    notAttemptedCount: 0,
    nextBatchStart: 3,
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
    generatedSpecText: null,
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
    storyTitle: 'Story',
    parentTitle: 'Parent feature',
    parentType: 'feature',
    workstream: 'order-service',
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockFetchSummary.mockResolvedValue(makeSummary());
  mockFetchRows.mockResolvedValue([]);
  mockFetchSpecsForWorkItem.mockResolvedValue([]);
});

// ----------------------------------------------------------------------------
// Test 2 - drawer renders generated spec text + working copy button
// ----------------------------------------------------------------------------

describe('StoryResultDrawer - generated spec text + copy button (Task 11.1 #2)', () => {
  it('renders generated spec text and copies it to the clipboard on copy-button click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const row = makeRow({
      workItemId: 'wi-gen',
      storyTitle: 'A generated story',
      status: 'generated',
      confidence: 'high',
      generatedSpecText:
        '/agent-os:shape-spec migrate order-service create endpoint',
      evidenceRefs: ['evidence-1', 'evidence-2'],
    });

    render(
      <StoryResultDrawer
        row={row}
        projectId={PROJECT_ID}
        bookOfWorkId={BOOK_ID}
        onClose={() => undefined}
        onRegenerate={vi.fn()}
      />,
    );

    // The drawer surface is visible.
    expect(screen.getByTestId('msg-story-drawer')).toBeInTheDocument();

    // The generated spec text is rendered.
    const specText = screen.getByTestId('msg-story-drawer-spec-text');
    expect(specText).toHaveTextContent(
      /migrate order-service create endpoint/i,
    );

    // The copy button copies the spec text to the clipboard.
    const copyButton = screen.getByTestId('msg-story-drawer-copy-spec');
    fireEvent.click(copyButton);
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(row.generatedSpecText);
    });
  });

  it('opens the drawer when the user clicks a row in the batch results table', async () => {
    const row = makeRow({
      workItemId: 'wi-clickable',
      storyTitle: 'Clickable story',
      status: 'generated',
      generatedSpecText: '/agent-os:shape-spec clickable',
    });
    mockFetchRows.mockResolvedValue([row]);

    render(
      <SpecGenerationWorkspace
        projectId={PROJECT_ID}
        bookOfWorkId={BOOK_ID}
      />,
    );

    // Wait for the row to render.
    await waitFor(() => {
      expect(
        screen.getByTestId('msg-results-row-wi-clickable'),
      ).toBeInTheDocument();
    });

    // Drawer is not yet open.
    expect(screen.queryByTestId('msg-story-drawer')).not.toBeInTheDocument();

    // Click the row to open the drawer.
    fireEvent.click(screen.getByTestId('msg-results-row-wi-clickable'));

    // Drawer is now open and shows the story.
    await waitFor(() => {
      expect(screen.getByTestId('msg-story-drawer')).toBeInTheDocument();
    });
    expect(screen.getByTestId('msg-story-drawer-title')).toHaveTextContent(
      /clickable story/i,
    );
  });

  it('closes when the explicit X close button is clicked', () => {
    const onClose = vi.fn();
    const row = makeRow({
      workItemId: 'wi-close',
      generatedSpecText: '/agent-os:shape-spec close-test',
    });
    render(
      <StoryResultDrawer
        row={row}
        projectId={PROJECT_ID}
        bookOfWorkId={BOOK_ID}
        onClose={onClose}
        onRegenerate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('msg-story-drawer-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when Esc is pressed', () => {
    const onClose = vi.fn();
    const row = makeRow({
      workItemId: 'wi-esc',
      generatedSpecText: '/agent-os:shape-spec esc-test',
    });
    render(
      <StoryResultDrawer
        row={row}
        projectId={PROJECT_ID}
        bookOfWorkId={BOOK_ID}
        onClose={onClose}
        onRegenerate={vi.fn()}
      />,
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

// ----------------------------------------------------------------------------
// Test 3 - drawer renders missingInputs + recommendedNextAction for an
// insufficient_context row
// ----------------------------------------------------------------------------

describe('StoryResultDrawer - missingInputs + recommendedNextAction (Task 11.1 #3)', () => {
  it('renders the missingInputs list and the recommendedNextAction for an insufficient_context row', () => {
    const row = makeRow({
      workItemId: 'wi-insufficient',
      storyTitle: 'Story missing inputs',
      status: 'insufficient_context',
      confidence: 'low',
      predictedReadiness: 'needs_focused_context',
      generatedSpecText: null,
      missingInputs: [
        { field: 'mappings', reason: 'No DB column mappings supplied' },
        { field: 'baselines', reason: 'No SOAP baselines supplied' },
      ],
      recommendedNextAction:
        'Provide DB column mappings and SOAP baselines in focused context, then regenerate.',
    });

    render(
      <StoryResultDrawer
        row={row}
        projectId={PROJECT_ID}
        bookOfWorkId={BOOK_ID}
        onClose={() => undefined}
        onRegenerate={vi.fn()}
      />,
    );

    // The status indicator reports `Insufficient context`.
    expect(screen.getByTestId('msg-story-drawer-status')).toHaveTextContent(
      /insufficient context/i,
    );

    // The missingInputs list is rendered with both entries visible.
    const missingList = screen.getByTestId('msg-story-drawer-missing-inputs');
    expect(missingList).toHaveTextContent(/mappings/i);
    expect(missingList).toHaveTextContent(/No DB column mappings supplied/i);
    expect(missingList).toHaveTextContent(/baselines/i);
    expect(missingList).toHaveTextContent(/No SOAP baselines supplied/i);

    // The recommendedNextAction is rendered.
    expect(
      screen.getByTestId('msg-story-drawer-recommended-next-action'),
    ).toHaveTextContent(/provide DB column mappings/i);

    // The spec-text section is replaced with an "insufficient context" hint
    // rather than a copy button (no spec was generated).
    expect(
      screen.queryByTestId('msg-story-drawer-copy-spec'),
    ).not.toBeInTheDocument();
  });

  it('shows a manual-edit-protected confirm dialog when regenerate returns errorMessage="manual_edit_protected"', async () => {
    const onRegenerate = vi
      .fn()
      // First call (no confirmOverwrite) -> the gateway returns a per-row
      // failure with the protected flag.
      .mockRejectedValueOnce(new Error('manual_edit_protected'))
      // Second call (after confirm) -> succeeds.
      .mockResolvedValueOnce(undefined);

    const row = makeRow({
      workItemId: 'wi-protected',
      storyTitle: 'A protected, manually-edited spec',
      status: 'generated',
      generatedSpecText: '/agent-os:shape-spec edited by user',
    });

    render(
      <StoryResultDrawer
        row={row}
        projectId={PROJECT_ID}
        bookOfWorkId={BOOK_ID}
        onClose={() => undefined}
        onRegenerate={onRegenerate}
      />,
    );

    // Trigger the regenerate.
    fireEvent.click(screen.getByTestId('msg-story-drawer-regenerate'));

    // Wait for the manual-edit-protected confirm dialog to surface.
    const confirmDialog = await screen.findByTestId(
      'msg-story-drawer-protected-confirm-dialog',
    );
    expect(confirmDialog).toBeInTheDocument();

    // Click "Yes, overwrite".
    fireEvent.click(
      screen.getByTestId('msg-story-drawer-protected-confirm-overwrite'),
    );

    // Regenerate is re-invoked, this time with confirmOverwrite=true.
    await waitFor(() => {
      expect(onRegenerate).toHaveBeenCalledTimes(2);
    });
    expect(onRegenerate.mock.calls[1][0]).toMatchObject({
      workItemId: 'wi-protected',
      confirmOverwrite: true,
    });
  });
});
