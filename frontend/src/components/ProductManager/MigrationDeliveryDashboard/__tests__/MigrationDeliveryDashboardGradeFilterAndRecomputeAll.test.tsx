/**
 * Dashboard Grade Filter + Bulk Recompute Quality tests.
 *
 * Spec: 2026-05-20 Spec Quality Scoring -- Task Group 8.
 *
 * Three focused tests:
 *   1. Grade filter chips render and toggle their selected state.
 *   2. Toggling a chip off causes the hierarchy tree to receive a
 *      filterStoryWorkItemIds set that excludes the deselected grade.
 *   3. "Recompute all quality" button calls the bulk endpoint and shows the
 *      summary banner with the returned grade breakdown.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ----- API mocks: declared BEFORE the dashboard import -----

const mockGetDashboard = vi.fn();
const mockGetStale = vi.fn();
const mockGetReadyToRetry = vi.fn();
const mockRecomputeAll = vi.fn();
const mockStartBatch = vi.fn();

vi.mock('../../../../api/migrationDeliveryDashboardApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/migrationDeliveryDashboardApi')
  >('../../../../api/migrationDeliveryDashboardApi');
  return {
    ...actual,
    getMigrationDeliveryDashboard: (...args: unknown[]) =>
      mockGetDashboard(...args),
    getStaleSpecSummary: (...args: unknown[]) => mockGetStale(...args),
  };
});

vi.mock('../../../../api/specGenerationApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/specGenerationApi')
  >('../../../../api/specGenerationApi');
  return {
    ...actual,
    startBatchGeneration: (...args: unknown[]) => mockStartBatch(...args),
    recomputeAllSpecQuality: (...args: unknown[]) => mockRecomputeAll(...args),
  };
});

vi.mock('../../../../api/missingInputResolutionsApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/missingInputResolutionsApi')
  >('../../../../api/missingInputResolutionsApi');
  return {
    ...actual,
    getReadyToRetry: (...args: unknown[]) => mockGetReadyToRetry(...args),
  };
});

import { MigrationDeliveryDashboard } from '../MigrationDeliveryDashboard';

function buildHierarchy() {
  return [
    {
      id: 'epic-1',
      type: 'epic',
      title: 'Epic 1',
      workItemId: null,
      backlogStatus: 'saved',
      specGenerationStatus: null,
      specGenerationConfidence: null,
      implementationStatus: null,
      evidenceStatus: null,
      needsAttentionCount: 0,
      missingInputsCount: 0,
      staleReason: null,
      qualityGrade: null,
      children: [
        {
          id: 'story-a',
          type: 'story',
          title: 'Story A (graded B)',
          workItemId: 'wi-a',
          backlogStatus: 'saved',
          specGenerationStatus: 'generated',
          specGenerationConfidence: 'high',
          implementationStatus: null,
          evidenceStatus: null,
          needsAttentionCount: 0,
          missingInputsCount: 0,
          staleReason: null,
          qualityGrade: 'B',
          children: [],
        },
        {
          id: 'story-c',
          type: 'story',
          title: 'Story C (graded F)',
          workItemId: 'wi-c',
          backlogStatus: 'saved',
          specGenerationStatus: 'generated',
          specGenerationConfidence: 'low',
          implementationStatus: null,
          evidenceStatus: null,
          needsAttentionCount: 0,
          missingInputsCount: 0,
          staleReason: null,
          qualityGrade: 'F',
          children: [],
        },
      ],
    },
  ];
}

const baseDashboard = () => ({
  bookOfWorkId: 'book-1',
  projectId: 'p-1',
  bookOfWorkTitle: 'Book 1',
  bookOfWorkStatus: 'IN_PROGRESS',
  generatedAt: '2026-05-20T10:00:00Z',
  summary: {
    totalStoryCount: 2,
    savedToBacklogCount: 2,
    specGeneratedCount: 2,
    implementationActiveCount: 0,
    evidenceCoveredCount: 0,
    needsAttentionCount: 0,
  },
  specGenerationSummary: {
    generatedCount: 2,
    generatedWithWarningsCount: 0,
    insufficientContextCount: 0,
    failedCount: 0,
    skippedBlockedCount: 0,
    notAttemptedCount: 0,
  },
  backlogSaveSummary: {
    savedCount: 2,
    notSavedToBacklogCount: 0,
  },
  implementationSummary: {
    activeCount: 0,
    inProgressCount: 0,
    completedCount: 0,
    blockedCount: 0,
  },
  evidenceSummary: {
    anyCoverageCount: 0,
    evidenceReferenceCount: 0,
    discoveryFindingReferenceCount: 0,
    apiBaselineReferenceCount: 0,
    mappingReferenceCount: 0,
    architectureReferenceCount: 0,
  },
  workstreamSummaries: [],
  hierarchy: buildHierarchy(),
  workstreamContext: null,
  epicDecisionsSummaries: [],
  needsAttention: [],
  warnings: [],
});

beforeEach(() => {
  vi.resetAllMocks();
  mockGetDashboard.mockResolvedValue(baseDashboard());
  mockGetStale.mockResolvedValue({
    staleCount: 0,
    staleWorkItems: [],
  });
  mockGetReadyToRetry.mockResolvedValue({ count: 0, specs: [] });
});

describe('Dashboard grade filter and bulk recompute (Task Group 8)', () => {
  it('renders the grade filter chip group with all chips selected by default', async () => {
    render(<MigrationDeliveryDashboard projectId="p-1" bookId="book-1" />);
    await waitFor(() => {
      expect(
        screen.getByTestId('mdd-dashboard-grade-filter'),
      ).toBeInTheDocument();
    });
    // All six chips visible
    for (const v of ['A', 'B', 'C', 'D', 'F', 'na']) {
      const chip = screen.getByTestId(`mdd-dashboard-grade-filter-chip-${v}`);
      expect(chip).toBeInTheDocument();
      expect(chip).toHaveAttribute('aria-pressed', 'true');
    }
  });

  it('toggling a chip off hides matching stories from the hierarchy', async () => {
    render(<MigrationDeliveryDashboard projectId="p-1" bookId="book-1" />);
    await waitFor(() => {
      expect(
        screen.getByTestId('mdd-dashboard-grade-filter-chip-F'),
      ).toBeInTheDocument();
    });
    // Both story rows initially visible
    expect(screen.getByText('Story A (graded B)')).toBeInTheDocument();
    expect(screen.getByText('Story C (graded F)')).toBeInTheDocument();

    // Deselect F
    fireEvent.click(screen.getByTestId('mdd-dashboard-grade-filter-chip-F'));

    // Story C (graded F) gets pruned; Story A (graded B) still visible
    await waitFor(() => {
      expect(screen.queryByText('Story C (graded F)')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Story A (graded B)')).toBeInTheDocument();
  });

  it('Recompute all quality button POSTs to the bulk endpoint and shows the summary banner', async () => {
    mockRecomputeAll.mockResolvedValueOnce({
      totalScored: 12,
      totalSkipped: 3,
      gradeBreakdown: { A: 2, B: 5, C: 3, D: 1, F: 1, na: 3 },
    });
    render(<MigrationDeliveryDashboard projectId="p-1" bookId="book-1" />);
    await waitFor(() => {
      expect(
        screen.getByTestId('mdd-dashboard-recompute-all-quality'),
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('mdd-dashboard-recompute-all-quality'));
    await waitFor(() => {
      expect(mockRecomputeAll).toHaveBeenCalledWith('p-1');
    });
    const summary = await screen.findByTestId(
      'mdd-dashboard-recompute-all-summary',
    );
    expect(summary).toHaveTextContent(/Scored 12 specs/);
    expect(summary).toHaveTextContent(/skipped 3/);
    expect(summary).toHaveTextContent(/A:2/);
    expect(summary).toHaveTextContent(/B:5/);
    expect(summary).toHaveTextContent(/N\/A:3/);
  });
});
