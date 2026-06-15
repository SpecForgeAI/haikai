/**
 * MigrationDeliveryDashboard -- add-item form + provenance filter
 *
 * Spec: 2026-06-14 Net-new backlog items + provenance (D5) -- Task Group 4
 * (D4 add-item surface; D6 provenance filter) + Group 5 gaps.
 *
 * The genuinely-uncovered FRONTEND seams:
 *   1. The dashboard "Add work item" form captures provenance + kind + title +
 *      description and submits them to the gateway add-item route (via the
 *      `addWorkItemFn` seam), then refreshes the dashboard so the new story
 *      surfaces. A failed add keeps the modal open + surfaces the error.
 *   2. The provenance filter (all | net_new | carry_over) toggles which stories
 *      the hierarchy tree shows.
 *
 * The describe->generate, the dispatch-unchanged pass-through, and the
 * D4-gate-exclusion are covered GATEWAY-side by
 * migrationNetNewDescriptionGrounded.test.ts; not re-covered here.
 *
 * Conventions mirror MigrationDeliveryDashboardDefineTests.test.tsx: the CSS
 * module is mocked via a Proxy; every dashboard side-fetch is stubbed via
 * test-seam props so the render is deterministic + offline.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('../MigrationDeliveryDashboard.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

import { MigrationDeliveryDashboard } from '../MigrationDeliveryDashboard';
import type {
  MigrationDeliveryDashboardDto,
  AddWorkItemResult,
} from '../../../../api/migrationDeliveryDashboardApi';

const PROJECT_ID = 'proj-1';
const BOOK_ID = 'book-1';

type AddFn = typeof import(
  '../../../../api/migrationDeliveryDashboardApi'
).addWorkItem;

beforeEach(() => {
  vi.resetAllMocks();
});

/**
 * A dashboard with one feature carrying two stories: one `net_new`, one
 * `carry_over`. Drives the provenance-filter visibility assertions.
 */
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
      totalStoryCount: 2,
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
            id: 'story-new',
            parentId: 'feature-1',
            type: 'story',
            title: 'New nightly job',
            workstream: 'auth',
            sequenceOrder: 1,
            workItemId: 'wi-new',
            backlogStatus: 'saved',
            specGenerationStatus: 'generated',
            specGenerationConfidence: 'high',
            implementationStatus: null,
            evidenceStatus: 'none',
            needsAttentionCount: 0,
            missingInputsCount: null,
            provenance: 'net_new',
            children: [],
          },
          {
            id: 'story-carry',
            parentId: 'feature-1',
            type: 'story',
            title: 'Discovered endpoint',
            workstream: 'auth',
            sequenceOrder: 2,
            workItemId: 'wi-carry',
            backlogStatus: 'saved',
            specGenerationStatus: 'generated',
            specGenerationConfidence: 'high',
            implementationStatus: null,
            evidenceStatus: 'none',
            needsAttentionCount: 0,
            missingInputsCount: null,
            provenance: 'carry_over',
            children: [],
          },
        ],
      },
    ],
    workstreamSummaries: [],
    specGenerationSummary: {
      notAttemptedCount: 0,
      generatedCount: 2,
      generatedWithWarningsCount: 0,
      insufficientContextCount: 0,
      failedCount: 0,
      skippedBlockedCount: 0,
    },
    backlogSaveSummary: { savedCount: 2, notSavedToBacklogCount: 0 },
    implementationSummary: {
      notStartedCount: 2,
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

const ADD_RESULT: AddWorkItemResult = {
  workItemId: 'wi-new-2',
  bookItemId: 'NN-S2',
  provenance: 'net_new',
  kind: 'operational',
  message: 'Work item created.',
};

describe('MigrationDeliveryDashboard -- add-item form (D5)', () => {
  it('captures provenance + kind + title + description and submits to the add-item route, then refreshes', async () => {
    const fetchDashboard = vi.fn().mockResolvedValue(buildDashboard());
    const addFn = vi.fn().mockResolvedValue(ADD_RESULT);

    render(
      <MigrationDeliveryDashboard
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
        fetchDashboard={fetchDashboard}
        addWorkItemFn={addFn as unknown as AddFn}
        {...sideFetchSeams()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('mdd-hierarchy-section')).toBeInTheDocument(),
    );
    expect(fetchDashboard).toHaveBeenCalledTimes(1);

    // Open the add-item form from the ONE dashboard add surface.
    fireEvent.click(screen.getByTestId('mdd-dashboard-add-item'));
    expect(screen.getByTestId('mdd-add-item-modal')).toBeInTheDocument();

    // Fill the form: switch provenance + kind, type a title + description.
    fireEvent.change(screen.getByTestId('mdd-add-item-provenance'), {
      target: { value: 'net_new' },
    });
    fireEvent.change(screen.getByTestId('mdd-add-item-kind'), {
      target: { value: 'operational' },
    });
    fireEvent.change(screen.getByTestId('mdd-add-item-title'), {
      target: { value: 'Add a nightly portfolio-revaluation job' },
    });
    fireEvent.change(screen.getByTestId('mdd-add-item-description'), {
      target: {
        value:
          'A new scheduled job that revalues every open portfolio at 02:00.',
      },
    });

    fireEvent.click(screen.getByTestId('mdd-add-item-submit'));

    // The route was called with the captured field values (the describe->generate
    // input flows through to the gateway).
    await waitFor(() => expect(addFn).toHaveBeenCalledTimes(1));
    expect(addFn).toHaveBeenCalledWith(PROJECT_ID, BOOK_ID, {
      provenance: 'net_new',
      kind: 'operational',
      title: 'Add a nightly portfolio-revaluation job',
      description:
        'A new scheduled job that revalues every open portfolio at 02:00.',
    });

    // The dashboard refreshed so the new story surfaces, and the modal closed.
    await waitFor(() => expect(fetchDashboard).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByTestId('mdd-add-item-modal')).not.toBeInTheDocument(),
    );
  });

  it('requires a title (no route call) and keeps the modal open + surfaces an error on a failed add', async () => {
    const fetchDashboard = vi.fn().mockResolvedValue(buildDashboard());
    const addFn = vi.fn().mockRejectedValue(new Error('Unknown book of work'));

    render(
      <MigrationDeliveryDashboard
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
        fetchDashboard={fetchDashboard}
        addWorkItemFn={addFn as unknown as AddFn}
        {...sideFetchSeams()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('mdd-hierarchy-section')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('mdd-dashboard-add-item'));

    // With an empty title the submit affordance is disabled (the title is
    // required) -- the route is never called.
    expect(screen.getByTestId('mdd-add-item-submit')).toBeDisabled();
    expect(addFn).not.toHaveBeenCalled();

    // Now provide a title and submit -> the route rejects; the modal stays open
    // with the surfaced error (the entered values are preserved).
    fireEvent.change(screen.getByTestId('mdd-add-item-title'), {
      target: { value: 'A genuinely new feature' },
    });
    fireEvent.click(screen.getByTestId('mdd-add-item-submit'));

    await waitFor(() => expect(addFn).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('mdd-add-item-error')).toHaveTextContent(
      /Unknown book of work/,
    );
    expect(screen.getByTestId('mdd-add-item-modal')).toBeInTheDocument();
  });
});

describe('MigrationDeliveryDashboard -- provenance filter (D5)', () => {
  it('toggles tree visibility: net_new-only hides carry_over, carry_over-only hides net_new, all shows both', async () => {
    const fetchDashboard = vi.fn().mockResolvedValue(buildDashboard());

    render(
      <MigrationDeliveryDashboard
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
        fetchDashboard={fetchDashboard}
        {...sideFetchSeams()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('mdd-hierarchy-section')).toBeInTheDocument(),
    );

    // Default (all): both stories are visible.
    expect(
      screen.getByTestId('mdd-hierarchy-node-story-new'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('mdd-hierarchy-node-story-carry'),
    ).toBeInTheDocument();

    // net_new only: the carry_over story is pruned.
    fireEvent.click(
      screen.getByTestId('mdd-dashboard-provenance-filter-chip-net_new'),
    );
    await waitFor(() =>
      expect(
        screen.queryByTestId('mdd-hierarchy-node-story-carry'),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByTestId('mdd-hierarchy-node-story-new'),
    ).toBeInTheDocument();

    // carry_over only: the net_new story is pruned.
    fireEvent.click(
      screen.getByTestId('mdd-dashboard-provenance-filter-chip-carry_over'),
    );
    await waitFor(() =>
      expect(
        screen.queryByTestId('mdd-hierarchy-node-story-new'),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByTestId('mdd-hierarchy-node-story-carry'),
    ).toBeInTheDocument();

    // Back to all: both visible again.
    fireEvent.click(
      screen.getByTestId('mdd-dashboard-provenance-filter-chip-all'),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId('mdd-hierarchy-node-story-new'),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId('mdd-hierarchy-node-story-carry'),
    ).toBeInTheDocument();
  });
});
