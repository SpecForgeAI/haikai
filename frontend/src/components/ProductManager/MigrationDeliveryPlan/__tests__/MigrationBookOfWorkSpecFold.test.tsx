/**
 * Phase 1a — spec lifecycle folded into the plan screen (2026-07-20).
 *
 * Pins the load-bearing behaviours:
 *   1. Story rows render the spec chip from the book's persisted spec rows
 *      (✓ / ⚠ / ✕ / ✎ manual) + the header rollup counts.
 *   2. "Generate specs (saved)" drives the gateway batch and refreshes rows.
 *   3. The drawer's "Generated spec" section: text, Mark ready (manual)
 *      (per-story), and Delete story… opening the per-story confirm which
 *      calls the AMS delete endpoint.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../MigrationBookOfWork.module.css', () => ({
  default: new Proxy({}, { get: (_t, p) => String(p) }),
}));

const mockRunSpecPreflight = vi.fn();
const mockFetchRows = vi.fn();
const mockFetchSummary = vi.fn();
const mockStartBatch = vi.fn();
const mockSetManualReady = vi.fn();
vi.mock('../../../../api/specGenerationApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/specGenerationApi')
  >('../../../../api/specGenerationApi');
  return {
    ...actual,
    runSpecPreflight: (...a: unknown[]) => mockRunSpecPreflight(...a),
    fetchSpecGenerationsForBook: (...a: unknown[]) => mockFetchRows(...a),
    fetchSpecGenerationSummary: (...a: unknown[]) => mockFetchSummary(...a),
    startBatchGeneration: (...a: unknown[]) => mockStartBatch(...a),
    setSpecManualReady: (...a: unknown[]) => mockSetManualReady(...a),
  };
});
const mockDeleteStory = vi.fn();
const mockGetBook = vi.fn();
vi.mock('../../../../api/migrationBookOfWorkApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/migrationBookOfWorkApi')
  >('../../../../api/migrationBookOfWorkApi');
  return {
    ...actual,
    deleteBookOfWorkStory: (...a: unknown[]) => mockDeleteStory(...a),
    getMigrationBookOfWork: (...a: unknown[]) => mockGetBook(...a),
  };
});
vi.mock('../../../../api/dbMigrationPackApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/dbMigrationPackApi')
  >('../../../../api/dbMigrationPackApi');
  return { ...actual, listDbMigrationPacks: vi.fn().mockResolvedValue([]) };
});
// Carry-over accounting (2026-07-26): the workspace mounts the coverage read
// on render — pin a benign empty result so no test leaks a real fetch.
vi.mock('../../../../api/carryOverCoverageApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/carryOverCoverageApi')
  >('../../../../api/carryOverCoverageApi');
  return {
    ...actual,
    getCarryOverCoverage: vi.fn().mockResolvedValue({
      items: [],
      mustAccount: [],
      unaccounted: [],
      accountedCount: 0,
      totalMustAccount: 0,
      ok: true,
      architectureId: null,
      itemDetails: {},
    }),
  };
});

import MigrationBookOfWorkReviewWorkspace from '../MigrationBookOfWorkReviewWorkspace';
import type {
  MigrationBookOfWorkDraft,
  MigrationBookOfWorkItem,
} from '../../../../api/migrationBookOfWorkApi';

const PROJECT_ID = 'proj-sf';
const BOOK_ID = 'book-sf';

function makeItem(
  overrides: Partial<MigrationBookOfWorkItem> = {},
): MigrationBookOfWorkItem {
  return {
    id: 'i-default',
    type: 'story',
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

function makeDraft(): MigrationBookOfWorkDraft {
  return {
    id: BOOK_ID,
    projectId: PROJECT_ID,
    currentArchitectureId: 'arch-cur',
    targetArchitectureId: 'arch-tgt',
    status: 'draft',
    title: 'Spec-fold plan',
    summary: 'Summary',
    generationInputs: null,
    generationSummary: null,
    qualityAssessment: null,
    bookOfWork: {
      items: [
        makeItem({ id: 's-ok', title: 'OK story', workItemId: 'wi-ok' } as never),
        makeItem({ id: 's-man', title: 'Manual story', workItemId: 'wi-man' } as never),
        makeItem({ id: 's-bad', title: 'Blocked story', workItemId: 'wi-bad' } as never),
      ],
    },
    createdByTask: 'product-manager--migration-delivery-plan',
    savedToBacklogAt: null,
    errorMessage: null,
    createdAt: '2026-07-20T10:00:00Z',
    updatedAt: '2026-07-20T10:00:00Z',
  };
}

function specRow(overrides: Record<string, unknown>) {
  return {
    id: 'sg-1',
    projectId: PROJECT_ID,
    workItemId: 'wi-ok',
    bookOfWorkId: BOOK_ID,
    bookItemId: 's-ok',
    status: 'generated',
    confidence: 'high',
    predictedReadiness: 'ready_for_spec',
    generatedSpecText: '/agent-os:shape-spec OK story',
    warnings: [],
    missingInputs: [],
    focusedContextRefs: null,
    evidenceRefs: [],
    generatedAt: null,
    errorMessage: null,
    generationAttemptNumber: 1,
    createdByTask: null,
    createdAt: null,
    updatedAt: null,
    manuallyEdited: null,
    lastManuallyEditedAt: null,
    lastManuallyEditedBy: null,
    previousSpecText: null,
    structuredTestsJson: null,
    coveredEndpointIds: null,
    manualReady: false,
    manualReadyBy: null,
    ...overrides,
  };
}

function threeRows() {
  return [
    specRow({}),
    specRow({
      id: 'sg-2',
      workItemId: 'wi-man',
      bookItemId: 's-man',
      status: 'generated',
      generatedSpecText: 'human-authored spec',
      manualReady: true,
      manuallyEdited: true,
    }),
    specRow({
      id: 'sg-3',
      workItemId: 'wi-bad',
      bookItemId: 's-bad',
      status: 'insufficient_context',
      confidence: null,
      generatedSpecText: null,
      missingInputs: [{ kind: 'mapping', reason: 'No data mapping' }],
    }),
  ];
}

function renderWorkspace() {
  return render(
    <MemoryRouter>
      <MigrationBookOfWorkReviewWorkspace
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
        initialDraft={makeDraft()}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockRunSpecPreflight.mockReset().mockResolvedValue({ rows: [], warnings: [] });
  mockFetchRows.mockReset().mockResolvedValue(threeRows());
  mockFetchSummary.mockReset().mockResolvedValue({ notAttemptedCount: 0 });
  mockStartBatch.mockReset().mockResolvedValue({ perStoryResults: [] });
  mockSetManualReady.mockReset().mockResolvedValue(specRow({ manualReady: true }));
  mockDeleteStory.mockReset().mockResolvedValue(undefined);
  mockGetBook.mockReset().mockResolvedValue(makeDraft());
});

describe('plan screen — spec lifecycle fold (Phase 1a)', () => {
  it('story rows carry the spec chip (✓ / ✎ manual / ✕) + the header rollup', async () => {
    renderWorkspace();
    await waitFor(() =>
      expect(screen.getByTestId('badge-spec-s-ok')).toHaveTextContent('spec ✓ high'),
    );
    expect(screen.getByTestId('badge-spec-s-man')).toHaveTextContent('spec ✎ manual');
    expect(screen.getByTestId('badge-spec-s-bad')).toHaveTextContent('spec ✕');
    expect(screen.getByTestId('review-spec-summary')).toHaveTextContent(
      'Specs: 1 ✓ · 0 ⚠ · 1 ✕ · 1 ✎',
    );
  });

  it('"Generate specs (saved)" drives the gateway batch, then refreshes rows + preflight', async () => {
    renderWorkspace();
    await waitFor(() => expect(mockFetchRows).toHaveBeenCalled());
    const before = mockFetchRows.mock.calls.length;

    fireEvent.click(screen.getByTestId('generate-specs-saved-button'));
    await waitFor(() => expect(mockStartBatch).toHaveBeenCalledTimes(1));
    expect(mockStartBatch).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      bookOfWorkId: BOOK_ID,
    });
    await waitFor(() =>
      expect(mockFetchRows.mock.calls.length).toBeGreaterThan(before),
    );
  });

  it('drawer: spec text renders; Mark ready (manual) calls the per-story endpoint', async () => {
    renderWorkspace();
    await waitFor(() =>
      expect(screen.getByTestId('badge-spec-s-ok')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('hierarchy-node-row-s-ok'));

    const section = await screen.findByTestId('item-drawer-spec');
    expect(
      within(section).getByTestId('item-drawer-spec-text'),
    ).toHaveTextContent('/agent-os:shape-spec OK story');

    fireEvent.click(within(section).getByTestId('item-drawer-spec-manual-ready'));
    await waitFor(() =>
      expect(mockSetManualReady).toHaveBeenCalledWith(
        PROJECT_ID,
        'sg-1',
        true,
        'plan-screen-user',
      ),
    );
  });

  it('Delete story… opens the per-story confirm; confirming calls the AMS delete endpoint', async () => {
    renderWorkspace();
    await waitFor(() =>
      expect(screen.getByTestId('badge-spec-s-bad')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('hierarchy-node-row-s-bad'));

    fireEvent.click(await screen.findByTestId('item-drawer-delete-story-button'));
    const dialog = screen.getByTestId('delete-story-dialog');
    expect(dialog).toHaveTextContent('Blocked story');

    fireEvent.click(within(dialog).getByTestId('delete-story-confirm'));
    await waitFor(() =>
      expect(mockDeleteStory).toHaveBeenCalledWith(PROJECT_ID, BOOK_ID, 's-bad'),
    );
    // The workspace refetches the draft after deletion.
    await waitFor(() => expect(mockGetBook).toHaveBeenCalled());
  });
});
