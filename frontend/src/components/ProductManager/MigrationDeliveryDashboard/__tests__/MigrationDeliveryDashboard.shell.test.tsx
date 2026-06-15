/**
 * MigrationDeliveryDashboard shell tests
 *
 * Spec: 2026-05-19 Migration Delivery Progress and Evidence Tracking
 * Task Group 8 (Frontend tests 21 + 33 + the soft-warning banner test).
 *
 * Coverage:
 *   1. Frontend test 21 -- header renders title, status, generatedAt, AND the
 *      "Last refreshed HH:mm:ss" label updates on initial load + manual
 *      Refresh click (Q-8).
 *   2. Frontend test 33 (partial roll-up rendering) -- when
 *      `dashboard.warnings[]` names a failed subsection (e.g.
 *      "workstreamSummaries"), that section is replaced inline by a "Could
 *      not load X -- retry" placeholder AND the other sections still render
 *      normally.
 *   3. Soft warning banner -- when `summary.totalStoryCount > 500`, the
 *      soft warning banner appears AND the payload still renders fully (Q-2).
 *
 * Test conventions mirror MigrationShapeSpecGeneration/__tests__/*:
 *   - vi.mock the API client BEFORE component import.
 *   - vi.resetAllMocks() in beforeEach per Standing Constraint 6.
 *   - Mock the CSS module via a Proxy so class-name access does not blow up.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  waitFor,
  fireEvent,
} from '@testing-library/react';

// Mock the CSS module so class-name access does not blow up under jsdom.
vi.mock('../MigrationDeliveryDashboard.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

// Mock the API client BEFORE importing the component.
const mockGetDashboard = vi.fn();

vi.mock('../../../../api/migrationDeliveryDashboardApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/migrationDeliveryDashboardApi')
  >('../../../../api/migrationDeliveryDashboardApi');
  return {
    ...actual,
    getMigrationDeliveryDashboard: (...args: unknown[]) =>
      mockGetDashboard(...args),
  };
});

import { MigrationDeliveryDashboard } from '../MigrationDeliveryDashboard';
import type { MigrationDeliveryDashboardDto } from '../../../../api/migrationDeliveryDashboardApi';

// ============================================================================
// Fixtures
// ============================================================================

const PROJECT_ID = 'proj-1';
const BOOK_ID = 'book-1';

function buildDashboardFixture(
  overrides: Partial<MigrationDeliveryDashboardDto> = {},
): MigrationDeliveryDashboardDto {
  return {
    bookOfWorkId: BOOK_ID,
    projectId: PROJECT_ID,
    currentArchitectureId: 'arch-current-uuid',
    targetArchitectureId: 'arch-target-uuid',
    title: 'Migration Book of Work A',
    status: 'generated',
    generatedAt: '2026-05-19T00:00:00Z',
    summary: {
      totalInitiativeCount: 1,
      totalEpicCount: 2,
      totalFeatureCount: 3,
      totalStoryCount: 8,
      needsAttentionCount: 2,
    },
    hierarchy: [
      {
        id: 'init-1',
        parentId: null,
        type: 'initiative',
        title: 'Initiative A',
        workstream: 'auth',
        sequenceOrder: 1,
        workItemId: null,
        backlogStatus: 'not_saved_to_backlog',
        specGenerationStatus: null,
        specGenerationConfidence: null,
        implementationStatus: null,
        evidenceStatus: 'none',
        needsAttentionCount: 0,
        missingInputsCount: null,
        children: [],
      },
    ],
    workstreamSummaries: [
      {
        workstream: 'auth',
        totalStoryCount: 4,
        savedToBacklogCount: 4,
        specGeneratedCount: 2,
        implementationActiveCount: 1,
        evidenceCoveredCount: 0,
        needsAttentionCount: 1,
      },
      {
        workstream: 'billing',
        totalStoryCount: 4,
        savedToBacklogCount: 4,
        specGeneratedCount: 3,
        implementationActiveCount: 2,
        evidenceCoveredCount: 1,
        needsAttentionCount: 1,
      },
    ],
    specGenerationSummary: {
      notAttemptedCount: 0,
      generatedCount: 5,
      generatedWithWarningsCount: 1,
      insufficientContextCount: 1,
      failedCount: 1,
      skippedBlockedCount: 0,
    },
    backlogSaveSummary: {
      savedCount: 7,
      notSavedToBacklogCount: 1,
    },
    implementationSummary: {
      notStartedCount: 4,
      inProgressCount: 2,
      blockedCount: 1,
      completedCount: 1,
      activeCount: 3,
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
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ============================================================================
// Test 1 -- Frontend test 21: header + "Last refreshed HH:mm:ss" label
// ============================================================================

describe('MigrationDeliveryDashboard -- header + last-refreshed label (Frontend test 21)', () => {
  it('renders title + status + generatedAt and updates Last refreshed on initial load and manual refresh', async () => {
    const dashboard = buildDashboardFixture();
    mockGetDashboard
      .mockResolvedValueOnce(dashboard)
      .mockResolvedValueOnce(dashboard);

    // Deterministic clock: tick 1 = 09:00:00 UTC, tick 2 = 09:15:30 UTC.
    // Using the local timezone-stable formatter inside the component would
    // make this flaky cross-timezone, so we capture whatever the formatter
    // emits at our two test ticks and assert it changes.
    const tickA = new Date('2026-05-19T09:00:00.000Z').getTime();
    const tickB = new Date('2026-05-19T09:15:30.000Z').getTime();
    const clock = vi.fn().mockReturnValueOnce(tickA).mockReturnValueOnce(tickB);

    render(
      <MigrationDeliveryDashboard
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
        now={clock as unknown as () => number}
      />,
    );

    // Header title comes from the loaded dashboard.
    await waitFor(() => {
      expect(screen.getByTestId('mdd-dashboard-title')).toHaveTextContent(
        'Migration Book of Work A',
      );
    });

    // Status + generatedAt present.
    expect(screen.getByTestId('mdd-dashboard-status')).toHaveTextContent(
      /generated/i,
    );
    expect(
      screen.getByTestId('mdd-dashboard-generated-at'),
    ).toHaveTextContent('2026-05-19T00:00:00Z');

    // Last refreshed label visible.
    const labelAfterInitial = screen.getByTestId(
      'mdd-dashboard-last-refreshed',
    );
    expect(labelAfterInitial).toHaveTextContent(/Last refreshed \d{2}:\d{2}:\d{2}/);
    const initialText = labelAfterInitial.textContent ?? '';

    // Click refresh -> the label updates to the new tick.
    fireEvent.click(screen.getByTestId('mdd-dashboard-refresh'));

    await waitFor(() => {
      expect(mockGetDashboard).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      const labelAfterRefresh = screen.getByTestId(
        'mdd-dashboard-last-refreshed',
      );
      expect(labelAfterRefresh.textContent).not.toBe(initialText);
      expect(labelAfterRefresh.textContent).toMatch(
        /Last refreshed \d{2}:\d{2}:\d{2}/,
      );
    });
  });
});

// ============================================================================
// Test 2 -- Frontend test 33: partial roll-up rendering
// ============================================================================

describe('MigrationDeliveryDashboard -- partial roll-up rendering (Frontend test 33)', () => {
  it('replaces a failed subsection with a "Could not load X -- retry" placeholder and renders the rest normally', async () => {
    const dashboard = buildDashboardFixture({
      // AMS partial roll-up: workstream summaries failed.
      warnings: ['workstreamSummaries: AMS rollup failed -- retry'],
    });
    mockGetDashboard.mockResolvedValueOnce(dashboard);

    render(
      <MigrationDeliveryDashboard projectId={PROJECT_ID} bookId={BOOK_ID} />,
    );

    // Wait for fetch + render.
    await waitFor(() => {
      expect(screen.getByTestId('mdd-dashboard-title')).toBeInTheDocument();
    });

    // Workstream strip is replaced by the placeholder.
    expect(
      screen.getByTestId('mdd-workstream-strip-placeholder'),
    ).toHaveTextContent(/Could not load workstream progress -- retry/i);
    expect(screen.queryByTestId('mdd-workstream-strip')).not.toBeInTheDocument();

    // Other sections still render normally.
    expect(screen.getByTestId('mdd-summary-cards')).toBeInTheDocument();
    expect(screen.getByTestId('mdd-hierarchy-section')).toBeInTheDocument();
  });
});

// ============================================================================
// Test 3 -- soft warning banner (Q-2)
// ============================================================================

describe('MigrationDeliveryDashboard -- soft warning banner above ~500 stories (Q-2)', () => {
  it('renders the soft warning banner when totalStoryCount > 500 AND still renders the payload', async () => {
    const dashboard = buildDashboardFixture({
      summary: {
        totalInitiativeCount: 5,
        totalEpicCount: 20,
        totalFeatureCount: 80,
        totalStoryCount: 612, // > 500
        needsAttentionCount: 12,
      },
    });
    mockGetDashboard.mockResolvedValueOnce(dashboard);

    render(
      <MigrationDeliveryDashboard projectId={PROJECT_ID} bookId={BOOK_ID} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mdd-dashboard-soft-warning')).toBeInTheDocument();
    });

    expect(
      screen.getByTestId('mdd-dashboard-soft-warning'),
    ).toHaveTextContent(/This book contains 612 stories/i);

    // Payload still renders fully.
    expect(screen.getByTestId('mdd-summary-cards')).toBeInTheDocument();
    expect(screen.getByTestId('mdd-workstream-strip')).toBeInTheDocument();
    expect(screen.getByTestId('mdd-hierarchy-section')).toBeInTheDocument();
  });
});
