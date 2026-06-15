/**
 * MigrationDeliveryDashboard -- Migrate button + hard-block gate + defer + run-progress
 *
 * Spec: 2026-06-14 Migrate Button + Migration Execution Driver + External
 * Shape-Spec Auto-Answerer (Spec 3 of 4) -- Task Group 5 (5.1).
 *
 * Coverage (focused, the critical behaviours only):
 *   1. HARD-BLOCK (CD-7): the Migrate button is DISABLED with a clear
 *      blocking-reason list when a non-deferred story is un-ready, and the
 *      missing-baseline reason renders when no `kind='current'` baseline
 *      exists. The button is ENABLED only when every in-scope story is ready +
 *      a baseline exists.
 *   2. MIGRATE TRIGGER: confirming Migrate calls the trigger route and surfaces
 *      the started run (per-spec progress appears).
 *   3. DEFER: the per-story "Defer this story" action calls the PATCH, marks
 *      the story "Deferred" (still rendered, not deleted), and removes it from
 *      the blocking set so Migrate becomes enabled.
 *   4. RUN-PROGRESS: per-spec dispatched / implemented / failed / deployed
 *      status + the overall run status render from the run-state read API.
 *
 * Conventions mirror MigrationDeliveryDashboardDefineTests.test.tsx: vi.mock the
 * CSS module via a Proxy; all dashboard side-fetches are stubbed via test-seam
 * props so the render is deterministic and offline.
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
  MigrationDeliveryHierarchyNodeDto,
  MigrationExecutionRunDto,
  TriggerMigrateResult,
} from '../../../../api/migrationDeliveryDashboardApi';

const PROJECT_ID = 'proj-1';
const BOOK_ID = 'book-1';

type TriggerFn = typeof import(
  '../../../../api/migrationDeliveryDashboardApi'
).triggerMigrate;
type FetchRunFn = typeof import(
  '../../../../api/migrationDeliveryDashboardApi'
).getLatestMigrationExecutionRun;
type DeferFn = typeof import(
  '../../../../api/migrationDeliveryDashboardApi'
).setStoryDeferred;

beforeEach(() => {
  vi.resetAllMocks();
});

function makeStory(
  partial: Partial<MigrationDeliveryHierarchyNodeDto> &
    Pick<MigrationDeliveryHierarchyNodeDto, 'id' | 'title' | 'workItemId'>,
): MigrationDeliveryHierarchyNodeDto {
  return {
    parentId: 'feature-1',
    type: 'story',
    workstream: 'auth',
    sequenceOrder: 1,
    backlogStatus: 'saved',
    specGenerationStatus: 'generated',
    specGenerationConfidence: 'high',
    implementationStatus: null,
    evidenceStatus: 'none',
    needsAttentionCount: 0,
    missingInputsCount: null,
    staleReason: null,
    children: [],
    ...partial,
  };
}

/**
 * Build a dashboard with one feature carrying two stories. The second story's
 * readiness is controllable so the hard-block can be exercised.
 */
function buildDashboard(opts: {
  story2Ready: boolean;
}): MigrationDeliveryDashboardDto {
  const story2 = opts.story2Ready
    ? makeStory({ id: 'story-2', title: 'Story Two', workItemId: 'wi-2' })
    : makeStory({
        id: 'story-2',
        title: 'Story Two',
        workItemId: 'wi-2',
        // Un-ready: spec never generated (insufficient context).
        specGenerationStatus: 'insufficient_context',
        specGenerationConfidence: null,
      });
  return {
    bookOfWorkId: BOOK_ID,
    projectId: PROJECT_ID,
    currentArchitectureId: 'arch-c',
    targetArchitectureId: 'arch-t',
    title: 'Book A',
    status: 'generated',
    generatedAt: '2026-06-14T00:00:00Z',
    summary: {
      totalInitiativeCount: 0,
      totalEpicCount: 0,
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
          makeStory({ id: 'story-1', title: 'Story One', workItemId: 'wi-1' }),
          story2,
        ],
      },
    ],
    workstreamSummaries: [],
    specGenerationSummary: {
      notAttemptedCount: 0,
      generatedCount: opts.story2Ready ? 2 : 1,
      generatedWithWarningsCount: 0,
      insufficientContextCount: opts.story2Ready ? 0 : 1,
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

describe('MigrationDeliveryDashboard -- Migrate button + hard-block + defer + progress', () => {
  it('disables Migrate and lists the blocking reasons (un-ready story + missing baseline)', async () => {
    const fetchDashboard = vi
      .fn()
      .mockResolvedValue(buildDashboard({ story2Ready: false }));
    const fetchRun = vi.fn().mockResolvedValue(null);

    render(
      <MigrationDeliveryDashboard
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
        fetchDashboard={fetchDashboard}
        // No active baseline -> the missing-baseline reason must also render.
        hasActiveCurrentBaseline={false}
        triggerMigrateFn={vi.fn() as unknown as TriggerFn}
        fetchLatestRunFn={fetchRun as unknown as FetchRunFn}
        {...sideFetchSeams()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('mdd-migrate-panel')).toBeInTheDocument(),
    );

    // Button disabled.
    expect(screen.getByTestId('mdd-migrate-button')).toBeDisabled();

    // The blocking list names the un-ready story AND the missing baseline.
    const blocked = screen.getByTestId('mdd-migrate-blocked');
    expect(blocked).toBeInTheDocument();
    expect(
      screen.getByTestId('mdd-migrate-blocked-reason-wi-2'),
    ).toHaveTextContent(/Story Two/);
    expect(
      screen.getByTestId('mdd-migrate-blocked-reason-missing_current_baseline'),
    ).toHaveTextContent(/current-state API-behaviour baseline/i);
  });

  it('enables Migrate when every in-scope story is ready and a baseline exists', async () => {
    const fetchDashboard = vi
      .fn()
      .mockResolvedValue(buildDashboard({ story2Ready: true }));
    const fetchRun = vi.fn().mockResolvedValue(null);

    render(
      <MigrationDeliveryDashboard
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
        fetchDashboard={fetchDashboard}
        hasActiveCurrentBaseline
        triggerMigrateFn={vi.fn() as unknown as TriggerFn}
        fetchLatestRunFn={fetchRun as unknown as FetchRunFn}
        {...sideFetchSeams()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('mdd-migrate-button')).toBeInTheDocument(),
    );

    expect(screen.getByTestId('mdd-migrate-button')).not.toBeDisabled();
    expect(screen.queryByTestId('mdd-migrate-blocked')).not.toBeInTheDocument();
  });

  it('confirming Migrate calls the trigger route and shows the started run', async () => {
    const fetchDashboard = vi
      .fn()
      .mockResolvedValue(buildDashboard({ story2Ready: true }));
    const started: TriggerMigrateResult = {
      status: 'started',
      runId: 'run-1',
      itemCount: 2,
    };
    const triggerFn = vi.fn().mockResolvedValue(started);
    // First run read (on mount) is null; after launch it returns the run.
    const runAfter: MigrationExecutionRunDto = {
      id: 'run-1',
      status: 'dispatching',
      current_sequence_position: 0,
      items: [
        {
          id: 'ri-1',
          sequence_position: 0,
          work_item_id: 'wi-1',
          spec_name: 'spec-one',
          status: 'submitted',
          dispatched: true,
        },
      ],
    };
    const fetchRun = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValue(runAfter);

    render(
      <MigrationDeliveryDashboard
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
        fetchDashboard={fetchDashboard}
        hasActiveCurrentBaseline
        company="acme"
        project="billing"
        triggerMigrateFn={triggerFn as unknown as TriggerFn}
        fetchLatestRunFn={fetchRun as unknown as FetchRunFn}
        {...sideFetchSeams()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('mdd-migrate-button')).not.toBeDisabled(),
    );

    // Open the confirm + start.
    fireEvent.click(screen.getByTestId('mdd-migrate-button'));
    fireEvent.click(screen.getByTestId('mdd-migrate-confirm-yes'));

    await waitFor(() => expect(triggerFn).toHaveBeenCalledTimes(1));
    expect(triggerFn).toHaveBeenCalledWith(PROJECT_ID, BOOK_ID, {
      company: 'acme',
      project: 'billing',
    });

    // The started run surfaces in the run-progress view.
    await waitFor(() =>
      expect(screen.getByTestId('mdd-migrate-run-progress')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('mdd-migrate-run-status')).toHaveTextContent(
      /dispatching/i,
    );
  });

  it('deferring an un-ready story calls the PATCH, shows Deferred, and unblocks Migrate', async () => {
    const fetchDashboard = vi
      .fn()
      .mockResolvedValue(buildDashboard({ story2Ready: false }));
    const fetchRun = vi.fn().mockResolvedValue(null);
    const deferFn = vi.fn().mockResolvedValue(undefined);

    render(
      <MigrationDeliveryDashboard
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
        fetchDashboard={fetchDashboard}
        hasActiveCurrentBaseline
        triggerMigrateFn={vi.fn() as unknown as TriggerFn}
        fetchLatestRunFn={fetchRun as unknown as FetchRunFn}
        setStoryDeferredFn={deferFn as unknown as DeferFn}
        {...sideFetchSeams()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('mdd-migrate-button')).toBeInTheDocument(),
    );

    // Blocked initially (story-2 un-ready) even though a baseline exists.
    expect(screen.getByTestId('mdd-migrate-button')).toBeDisabled();
    expect(
      screen.getByTestId('mdd-migrate-blocked-reason-wi-2'),
    ).toBeInTheDocument();

    // Defer story-2.
    fireEvent.click(screen.getByTestId('mdd-defer-story-story-2'));

    await waitFor(() => expect(deferFn).toHaveBeenCalledTimes(1));
    expect(deferFn).toHaveBeenCalledWith(PROJECT_ID, 'wi-2', true);

    // The story still renders, now with the Deferred badge.
    await waitFor(() =>
      expect(screen.getByTestId('mdd-badge-deferred-story-2')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('mdd-hierarchy-node-story-2')).toBeInTheDocument();

    // It drops out of the blocking set -> Migrate becomes enabled, blocker gone.
    await waitFor(() =>
      expect(screen.getByTestId('mdd-migrate-button')).not.toBeDisabled(),
    );
    expect(screen.queryByTestId('mdd-migrate-blocked')).not.toBeInTheDocument();
  });

  it('renders per-spec dispatched/implemented/failed/deployed status + overall run status', async () => {
    const fetchDashboard = vi
      .fn()
      .mockResolvedValue(buildDashboard({ story2Ready: true }));
    const run: MigrationExecutionRunDto = {
      id: 'run-1',
      status: 'halted',
      current_sequence_position: 2,
      target_base_url: 'https://staging.example.com',
      items: [
        {
          id: 'ri-1',
          sequence_position: 0,
          work_item_id: 'wi-1',
          spec_name: 'spec-one',
          status: 'implemented',
          dispatched: true,
          outcome: 'implemented',
          pr_url: 'https://git/pr/1',
          auto_answer_decision_log_json: [
            { question: 'q', answer: 'a', rationale: 'r' },
          ],
        },
        {
          id: 'ri-2',
          sequence_position: 1,
          work_item_id: 'wi-2',
          spec_name: 'spec-two',
          status: 'submitted',
          dispatched: true,
        },
        {
          id: 'ri-3',
          sequence_position: 2,
          work_item_id: 'wi-3',
          spec_name: 'spec-three',
          status: 'failed',
          dispatched: true,
          outcome: 'failed',
          deploy_on_complete: true,
        },
      ],
    };
    const fetchRun = vi.fn().mockResolvedValue(run);

    render(
      <MigrationDeliveryDashboard
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
        fetchDashboard={fetchDashboard}
        hasActiveCurrentBaseline
        triggerMigrateFn={vi.fn() as unknown as TriggerFn}
        fetchLatestRunFn={fetchRun as unknown as FetchRunFn}
        {...sideFetchSeams()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('mdd-migrate-run-progress')).toBeInTheDocument(),
    );

    // Overall run status.
    expect(screen.getByTestId('mdd-migrate-run-status')).toHaveTextContent(
      /halted/i,
    );
    // The deployed target base url surfaces.
    expect(
      screen.getByTestId('mdd-migrate-run-target-base-url'),
    ).toHaveTextContent(/staging\.example\.com/);

    // Per-spec status: implemented + (in-flight) submitted + failed.
    expect(
      screen.getByTestId('mdd-migrate-run-item-status-wi-1'),
    ).toHaveTextContent(/implemented/i);
    expect(
      screen.getByTestId('mdd-migrate-run-item-status-wi-2'),
    ).toHaveTextContent(/submitted|dispatched/i);
    expect(
      screen.getByTestId('mdd-migrate-run-item-status-wi-3'),
    ).toHaveTextContent(/failed/i);

    // The final spec carries the deploy-on-complete marker.
    expect(
      screen.getByTestId('mdd-migrate-run-item-deploy-wi-3'),
    ).toBeInTheDocument();
    // The auto-answer decision log count surfaces on the answered spec.
    expect(
      screen.getByTestId('mdd-migrate-run-item-decisions-wi-1'),
    ).toHaveTextContent(/1 auto-answer/i);
  });
});
