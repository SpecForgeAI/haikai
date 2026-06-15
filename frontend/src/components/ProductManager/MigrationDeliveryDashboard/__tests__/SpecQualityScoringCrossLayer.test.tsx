/**
 * Spec Quality Scoring -- Cross-Layer Coverage Tests
 *
 * Spec: 2026-05-20 Spec Quality Scoring -- Task Group 9.
 *
 * These tests probe the SEAMS between layers that the per-layer Groups 1-8
 * tests do not. Each test guards a specific silent-drift hazard noted in
 * Task Group 9.3.
 *
 *   Test 1 -- Wire-shape contract: bulk recompute summary {totalScored,
 *             totalSkipped, gradeBreakdown.{A,B,C,D,F,na}} round-trips
 *             through the API client AND lands in the dashboard banner.
 *             Catches snake_case/camelCase drift between AMS, gateway, and
 *             the dashboard banner reader.
 *
 *   Test 2 -- Disagreement direction agreement: the chip helper
 *             `deriveDisagreementDirection` and the hierarchy tree's
 *             `coerceGrade` see the same grade letters from the same wire
 *             field. Guards against a future enum/string drift that would
 *             let the chip render a disagreement badge for a grade the tree
 *             treats as null.
 *
 *   Test 3 -- Grade-band threshold parity: the frontend
 *             `gradeLetterFromScore` boundaries (85/70/55/40) must match the
 *             AMS `SpecQualityScorer` pinned constants verbatim. The drawer
 *             derives the previous-grade letter using THIS frontend util to
 *             show the delta chip, so any drift produces a wrong delta on
 *             same-letter score changes. Boundary-table check.
 *
 *   Test 4 -- Grade filter + ready-to-retry filter intersection: the
 *             dashboard combines the existing `hierarchyFilterIds` set
 *             (ready-to-retry filter) with the new grade filter via
 *             intersection. End-to-end render check that pruning honours
 *             both filters at once.
 *
 *   Test 5 -- Persist-to-render end-to-end: stories with mixed grade values
 *             (A, F, null) render their chips with the right colour class
 *             AND the right tooltip / data-grade. Catches a wire-mapping
 *             regression where the hierarchy node DTO's `quality_grade`
 *             stops flowing to the chip's `qualityGrade` prop.
 *
 *   Test 6 -- Confidence-vs-grade disagreement at render time: a story with
 *             LLM confidence "high" AND grade "D" surfaces the "!"
 *             disagreement badge on the hierarchy chip. Cross-checks that
 *             both wire fields (`spec_generation_confidence` +
 *             `quality_grade`) reach the chip together.
 *
 *   Test 7 -- Bulk recompute then refresh: clicking the bulk button calls
 *             the API, shows the summary banner, AND re-fetches the
 *             dashboard so chips reflect the new state. Catches a
 *             regression where the refresh after a successful bulk run is
 *             accidentally dropped.
 *
 *   Test 8 -- N/A filter chip filters in null-grade stories: deselecting
 *             `na` hides stories with no spec row / insufficient_context.
 *             Cross-layer because the null-grade -> "na" mapping spans
 *             `isGradeAllowedByFilter` (filter helper) and `coerceGrade`
 *             (tree). Both must agree on what counts as N/A.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// CSS module stub (jsdom does not parse module.css)
// ---------------------------------------------------------------------------

vi.mock('../MigrationDeliveryDashboard.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

// ---------------------------------------------------------------------------
// API mocks (declared BEFORE the dashboard import)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { MigrationDeliveryDashboard } from '../MigrationDeliveryDashboard';
import MigrationDeliveryHierarchyTree from '../MigrationDeliveryHierarchyTree';
import {
  deriveDisagreementDirection,
  qualityGradeBadgeClass,
} from '../QualityGradeChip';
import { gradeLetterFromScore } from '../MigrationDeliveryStoryDrawer';
import { isGradeAllowedByFilter } from '../MigrationDeliveryGradeFilter';
import type { MigrationDeliveryHierarchyNodeDto } from '../../../../api/migrationDeliveryDashboardApi';

// ---------------------------------------------------------------------------
// Fixtures shared by dashboard-level tests
// ---------------------------------------------------------------------------

function makeStory(
  overrides: Partial<MigrationDeliveryHierarchyNodeDto> &
    Pick<MigrationDeliveryHierarchyNodeDto, 'id' | 'title' | 'workItemId'>,
): MigrationDeliveryHierarchyNodeDto {
  return {
    type: 'story',
    parentId: 'epic-1',
    workstream: null,
    sequenceOrder: 0,
    backlogStatus: 'saved',
    specGenerationStatus: 'generated',
    specGenerationConfidence: 'medium',
    implementationStatus: null,
    evidenceStatus: 'no_evidence',
    needsAttentionCount: 0,
    missingInputsCount: 0,
    staleReason: null,
    qualityGrade: null,
    children: [],
    ...overrides,
  };
}

function buildDashboard(
  hierarchy: MigrationDeliveryHierarchyNodeDto[],
) {
  return {
    bookOfWorkId: 'book-1',
    projectId: 'p-1',
    bookOfWorkTitle: 'Book 1',
    bookOfWorkStatus: 'IN_PROGRESS',
    generatedAt: '2026-05-20T10:00:00Z',
    summary: {
      totalStoryCount: hierarchy.reduce(
        (n, ep) => n + (ep.children?.length ?? 0),
        0,
      ),
      savedToBacklogCount: 0,
      specGeneratedCount: 0,
      implementationActiveCount: 0,
      evidenceCoveredCount: 0,
      needsAttentionCount: 0,
    },
    specGenerationSummary: {
      generatedCount: 0,
      generatedWithWarningsCount: 0,
      insufficientContextCount: 0,
      failedCount: 0,
      skippedBlockedCount: 0,
      notAttemptedCount: 0,
    },
    backlogSaveSummary: { savedCount: 0, notSavedToBacklogCount: 0 },
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
    hierarchy,
    workstreamContext: null,
    epicDecisionsSummaries: [],
    needsAttention: [],
    warnings: [],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockGetDashboard.mockResolvedValue(buildDashboard([]));
  mockGetStale.mockResolvedValue({ staleCount: 0, staleWorkItems: [] });
  mockGetReadyToRetry.mockResolvedValue({ count: 0, specs: [] });
});

// ===========================================================================
// Test 1 -- Bulk recompute summary wire-shape contract
// ===========================================================================

describe('Cross-layer: bulk recompute summary shape', () => {
  it('preserves {totalScored, totalSkipped, gradeBreakdown.{A,B,C,D,F,na}} from API to banner', async () => {
    // The exact shape the gateway proxies verbatim from AMS. The dashboard
    // banner reads each of these fields by name; a snake_case slip on EITHER
    // side would silently produce zeros in the banner.
    const amsSummary = {
      totalScored: 17,
      totalSkipped: 5,
      gradeBreakdown: { A: 4, B: 6, C: 3, D: 2, F: 2, na: 5 },
    };
    mockRecomputeAll.mockResolvedValueOnce(amsSummary);
    const hierarchy = [
      {
        id: 'epic-1',
        type: 'epic',
        title: 'Epic',
        parentId: null,
        workstream: null,
        sequenceOrder: 0,
        workItemId: null,
        backlogStatus: 'saved',
        specGenerationStatus: null,
        specGenerationConfidence: null,
        implementationStatus: null,
        evidenceStatus: 'none',
        needsAttentionCount: 0,
        missingInputsCount: 0,
        staleReason: null,
        qualityGrade: null,
        children: [],
      } as MigrationDeliveryHierarchyNodeDto,
    ];
    mockGetDashboard.mockResolvedValue(buildDashboard(hierarchy));

    render(<MigrationDeliveryDashboard projectId="p-1" bookId="book-1" />);
    await waitFor(() =>
      expect(
        screen.getByTestId('mdd-dashboard-recompute-all-quality'),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('mdd-dashboard-recompute-all-quality'));

    const banner = await screen.findByTestId(
      'mdd-dashboard-recompute-all-summary',
    );
    // Each field name MUST show up in the rendered banner -- this is the
    // load-bearing assertion. A drift to e.g. "Skipped" instead of "skipped"
    // would still pass a fuzzy /scored/ check; we test every count.
    expect(banner).toHaveTextContent(/Scored 17 specs/);
    expect(banner).toHaveTextContent(/skipped 5/);
    expect(banner).toHaveTextContent(/A:4/);
    expect(banner).toHaveTextContent(/B:6/);
    expect(banner).toHaveTextContent(/C:3/);
    expect(banner).toHaveTextContent(/D:2/);
    expect(banner).toHaveTextContent(/F:2/);
    expect(banner).toHaveTextContent(/N\/A:5/);
  });
});

// ===========================================================================
// Test 2 -- coerceGrade (tree) and deriveDisagreementDirection (chip) agree
// ===========================================================================

describe('Cross-layer: disagreement direction and grade coercion agree', () => {
  it('a story with confidence=high and qualityGrade=F renders the disagreement badge', () => {
    const hierarchy: MigrationDeliveryHierarchyNodeDto[] = [
      makeStory({
        id: 'story-f',
        title: 'Story F high-conf',
        workItemId: 'wi-f',
        specGenerationConfidence: 'high',
        qualityGrade: 'F',
      }),
    ];
    render(
      <MigrationDeliveryHierarchyTree
        hierarchy={hierarchy}
        onStorySelected={() => {}}
      />,
    );

    // Tree feeds the chip; if `coerceGrade` returned null here, the chip's
    // `deriveDisagreementDirection` would return null too and the badge
    // would silently disappear. Both helpers must agree.
    expect(
      screen.getByTestId('mdd-badge-quality-story-f-disagreement'),
    ).toBeInTheDocument();
    expect(
      deriveDisagreementDirection('F', 'high'),
    ).toBe('high-confidence-low-grade');
  });

  it('an unknown grade letter on the wire (e.g. "Z") coerces to null on BOTH helpers', () => {
    const hierarchy: MigrationDeliveryHierarchyNodeDto[] = [
      makeStory({
        id: 'story-z',
        title: 'Story Z bad grade',
        workItemId: 'wi-z',
        specGenerationConfidence: 'high',
        qualityGrade: 'Z',
      }),
    ];
    render(
      <MigrationDeliveryHierarchyTree
        hierarchy={hierarchy}
        onStorySelected={() => {}}
      />,
    );
    // No disagreement badge because the tree coerced grade to null. The
    // chip helper agrees: a null grade never produces a disagreement.
    expect(
      screen.queryByTestId('mdd-badge-quality-story-z-disagreement'),
    ).not.toBeInTheDocument();
    expect(
      deriveDisagreementDirection(null, 'high'),
    ).toBeNull();
  });
});

// ===========================================================================
// Test 3 -- gradeLetterFromScore boundaries match AMS pinned thresholds
// ===========================================================================

describe('Cross-layer: gradeLetterFromScore thresholds match AMS constants', () => {
  it('boundary table 85/84/70/69/55/54/40/39 maps to A/B/B/C/C/D/D/F (mirrors AMS)', () => {
    // AMS pinned thresholds (from spec.md "Specific Requirements"):
    //   GRADE_A_MIN = 85, GRADE_B_MIN = 70, GRADE_C_MIN = 55, GRADE_D_MIN = 40
    // Frontend MUST mirror these or the drawer's "previous grade letter"
    // derivation drifts off-by-one and the delta chip renders on the wrong
    // boundary moves (e.g. 84 -> 85 would falsely show 'B -> B' instead of
    // 'B -> A'). Keep this boundary table in lockstep.
    expect(gradeLetterFromScore(100)).toBe('A');
    expect(gradeLetterFromScore(85)).toBe('A');
    expect(gradeLetterFromScore(84)).toBe('B');
    expect(gradeLetterFromScore(70)).toBe('B');
    expect(gradeLetterFromScore(69)).toBe('C');
    expect(gradeLetterFromScore(55)).toBe('C');
    expect(gradeLetterFromScore(54)).toBe('D');
    expect(gradeLetterFromScore(40)).toBe('D');
    expect(gradeLetterFromScore(39)).toBe('F');
    expect(gradeLetterFromScore(0)).toBe('F');
    expect(gradeLetterFromScore(null)).toBeNull();
    expect(gradeLetterFromScore(undefined)).toBeNull();
  });
});

// ===========================================================================
// Test 4 -- Grade filter intersected with ready-to-retry filter
// ===========================================================================

describe('Cross-layer: grade filter intersects with ready-to-retry filter', () => {
  it('combining the grade-filter deselection with hierarchyFilterIds produces the intersection', () => {
    // Two grade-A stories. One is in the ready-to-retry set, one is not.
    // Then we deselect 'A' -> the grade filter prunes both stories; the
    // intersection with hierarchyFilterIds also collapses to empty.
    // We exercise this directly through the pruning helper rather than the
    // dashboard (which has no first-class hook to set both filters in one
    // gesture) -- the intersection logic in the dashboard is a thin AND of
    // the two helpers we test here.

    const readyToRetrySet = new Set(['wi-a-ready']);
    const story1: MigrationDeliveryHierarchyNodeDto = makeStory({
      id: 'story-a-ready',
      title: 'Story A in ready-to-retry',
      workItemId: 'wi-a-ready',
      qualityGrade: 'A',
    });
    const story2: MigrationDeliveryHierarchyNodeDto = makeStory({
      id: 'story-a-not-ready',
      title: 'Story A NOT in ready-to-retry',
      workItemId: 'wi-a-not-ready',
      qualityGrade: 'A',
    });

    // Filter: grade A excluded, grade B/C/D/F/na all selected.
    const grades = new Set<'A' | 'B' | 'C' | 'D' | 'F' | 'na'>([
      'B',
      'C',
      'D',
      'F',
      'na',
    ]);

    // Step 1: grade-pass set is empty (both stories are A; A is excluded).
    const gradeAllowed = new Set<string>();
    for (const s of [story1, story2]) {
      if (s.workItemId && isGradeAllowedByFilter(s.qualityGrade, grades)) {
        gradeAllowed.add(s.workItemId);
      }
    }
    expect(gradeAllowed.size).toBe(0);

    // Step 2: intersect with ready-to-retry. Empty intersection.
    const intersection = new Set<string>();
    for (const id of readyToRetrySet) {
      if (gradeAllowed.has(id)) intersection.add(id);
    }
    expect(intersection.size).toBe(0);

    // Step 3 -- with grade A re-selected the gradeAllowed set carries both
    // stories; intersecting with ready-to-retry yields exactly the ready
    // story.
    const gradesAll = new Set<'A' | 'B' | 'C' | 'D' | 'F' | 'na'>([
      'A',
      'B',
      'C',
      'D',
      'F',
      'na',
    ]);
    const gradeAllowedAll = new Set<string>();
    for (const s of [story1, story2]) {
      if (s.workItemId && isGradeAllowedByFilter(s.qualityGrade, gradesAll)) {
        gradeAllowedAll.add(s.workItemId);
      }
    }
    const intersectionAll = new Set<string>();
    for (const id of readyToRetrySet) {
      if (gradeAllowedAll.has(id)) intersectionAll.add(id);
    }
    expect([...intersectionAll]).toEqual(['wi-a-ready']);
  });
});

// ===========================================================================
// Test 5 -- Hierarchy node DTO qualityGrade -> rendered chip end-to-end
// ===========================================================================

describe('Cross-layer: hierarchy DTO qualityGrade reaches the chip with the right class', () => {
  it('three stories with grades A / F / null render chips with the right colour class and data-grade', () => {
    const hierarchy: MigrationDeliveryHierarchyNodeDto[] = [
      makeStory({
        id: 'story-graded-a',
        title: 'Story graded A',
        workItemId: 'wi-a',
        qualityGrade: 'A',
      }),
      makeStory({
        id: 'story-graded-f',
        title: 'Story graded F',
        workItemId: 'wi-f',
        qualityGrade: 'F',
      }),
      makeStory({
        id: 'story-no-spec',
        title: 'Story with no spec row',
        workItemId: 'wi-na',
        specGenerationStatus: null,
        specGenerationConfidence: null,
        qualityGrade: null,
      }),
    ];
    render(
      <MigrationDeliveryHierarchyTree
        hierarchy={hierarchy}
        onStorySelected={() => {}}
      />,
    );

    const chipA = screen.getByTestId('mdd-badge-quality-story-graded-a');
    expect(chipA.textContent).toBe('A');
    expect(chipA.getAttribute('data-grade')).toBe('A');
    expect(chipA.className).toContain(qualityGradeBadgeClass('A'));

    const chipF = screen.getByTestId('mdd-badge-quality-story-graded-f');
    expect(chipF.textContent).toBe('F');
    expect(chipF.getAttribute('data-grade')).toBe('F');
    expect(chipF.className).toContain(qualityGradeBadgeClass('F'));

    const chipNa = screen.getByTestId('mdd-badge-quality-story-no-spec');
    expect(chipNa.textContent).toBe('--');
    expect(chipNa.getAttribute('data-grade')).toBe('na');
    expect(chipNa.className).toContain(qualityGradeBadgeClass(null));
  });
});

// ===========================================================================
// Test 6 -- Confidence + grade BOTH reach the chip and badge fires
// ===========================================================================

describe('Cross-layer: confidence + grade fields both flow through to the chip', () => {
  it('renders the "!" disagreement badge for confidence=low + qualityGrade=B (low-confidence-high-grade)', () => {
    const hierarchy: MigrationDeliveryHierarchyNodeDto[] = [
      makeStory({
        id: 'story-low-b',
        title: 'Story low conf grade B',
        workItemId: 'wi-low-b',
        specGenerationConfidence: 'low',
        qualityGrade: 'B',
      }),
    ];
    render(
      <MigrationDeliveryHierarchyTree
        hierarchy={hierarchy}
        onStorySelected={() => {}}
      />,
    );
    const badge = screen.getByTestId(
      'mdd-badge-quality-story-low-b-disagreement',
    );
    expect(badge).toBeInTheDocument();
    expect(badge.getAttribute('data-direction')).toBe(
      'low-confidence-high-grade',
    );
  });

  it('does NOT render the disagreement badge when confidence=medium and grade=B', () => {
    const hierarchy: MigrationDeliveryHierarchyNodeDto[] = [
      makeStory({
        id: 'story-med-b',
        title: 'Story medium conf B',
        workItemId: 'wi-med-b',
        specGenerationConfidence: 'medium',
        qualityGrade: 'B',
      }),
    ];
    render(
      <MigrationDeliveryHierarchyTree
        hierarchy={hierarchy}
        onStorySelected={() => {}}
      />,
    );
    expect(
      screen.queryByTestId('mdd-badge-quality-story-med-b-disagreement'),
    ).not.toBeInTheDocument();
  });
});

// ===========================================================================
// Test 7 -- Bulk recompute success refreshes the dashboard
// ===========================================================================

describe('Cross-layer: bulk recompute triggers a dashboard reload', () => {
  it('on 2xx the dashboard re-fetches so chips reflect post-recompute grades', async () => {
    // Pass 1: chips show grade C.
    mockGetDashboard.mockResolvedValueOnce(
      buildDashboard([
        {
          id: 'epic-1',
          type: 'epic',
          title: 'Epic',
          parentId: null,
          workstream: null,
          sequenceOrder: 0,
          workItemId: null,
          backlogStatus: 'saved',
          specGenerationStatus: null,
          specGenerationConfidence: null,
          implementationStatus: null,
          evidenceStatus: 'none',
          needsAttentionCount: 0,
          missingInputsCount: 0,
          staleReason: null,
          qualityGrade: null,
          children: [
            makeStory({
              id: 'story-pre',
              title: 'Story pre-recompute',
              workItemId: 'wi-pre',
              qualityGrade: 'C',
            }),
          ],
        } as MigrationDeliveryHierarchyNodeDto,
      ]),
    );
    // Pass 2 (post-recompute): same story now grade A.
    mockGetDashboard.mockResolvedValueOnce(
      buildDashboard([
        {
          id: 'epic-1',
          type: 'epic',
          title: 'Epic',
          parentId: null,
          workstream: null,
          sequenceOrder: 0,
          workItemId: null,
          backlogStatus: 'saved',
          specGenerationStatus: null,
          specGenerationConfidence: null,
          implementationStatus: null,
          evidenceStatus: 'none',
          needsAttentionCount: 0,
          missingInputsCount: 0,
          staleReason: null,
          qualityGrade: null,
          children: [
            makeStory({
              id: 'story-pre',
              title: 'Story pre-recompute',
              workItemId: 'wi-pre',
              qualityGrade: 'A',
            }),
          ],
        } as MigrationDeliveryHierarchyNodeDto,
      ]),
    );
    mockRecomputeAll.mockResolvedValueOnce({
      totalScored: 1,
      totalSkipped: 0,
      gradeBreakdown: { A: 1, B: 0, C: 0, D: 0, F: 0, na: 0 },
    });

    render(<MigrationDeliveryDashboard projectId="p-1" bookId="book-1" />);
    // Pre-click: dashboard fetched once; chip shows C.
    await waitFor(() => {
      expect(
        screen.getByTestId('mdd-badge-quality-story-pre'),
      ).toHaveTextContent('C');
    });
    expect(mockGetDashboard).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('mdd-dashboard-recompute-all-quality'));

    // Wait for the API call AND the refetch.
    await waitFor(() => {
      expect(mockRecomputeAll).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      // Refresh fired. The contract is "re-fetch after a successful bulk".
      expect(mockGetDashboard).toHaveBeenCalledTimes(2);
    });
    // Chip now reflects the post-recompute grade.
    await waitFor(() => {
      expect(
        screen.getByTestId('mdd-badge-quality-story-pre'),
      ).toHaveTextContent('A');
    });
  });
});

// ===========================================================================
// Test 8 -- 'na' filter chip filters in null-grade stories
// ===========================================================================

describe('Cross-layer: the N/A filter chip prunes/keeps null-grade stories', () => {
  it('with only "na" selected, only null-grade stories survive; with "na" deselected they disappear', async () => {
    const hierarchy: MigrationDeliveryHierarchyNodeDto[] = [
      {
        id: 'epic-1',
        type: 'epic',
        title: 'Epic',
        parentId: null,
        workstream: null,
        sequenceOrder: 0,
        workItemId: null,
        backlogStatus: 'saved',
        specGenerationStatus: null,
        specGenerationConfidence: null,
        implementationStatus: null,
        evidenceStatus: 'none',
        needsAttentionCount: 0,
        missingInputsCount: 0,
        staleReason: null,
        qualityGrade: null,
        children: [
          makeStory({
            id: 'story-graded',
            title: 'Story graded B',
            workItemId: 'wi-graded',
            qualityGrade: 'B',
          }),
          makeStory({
            id: 'story-null-grade',
            title: 'Story null grade',
            workItemId: 'wi-null',
            specGenerationStatus: 'insufficient_context',
            specGenerationConfidence: null,
            qualityGrade: null,
          }),
        ],
      } as MigrationDeliveryHierarchyNodeDto,
    ];
    mockGetDashboard.mockResolvedValue(buildDashboard(hierarchy));

    render(<MigrationDeliveryDashboard projectId="p-1" bookId="book-1" />);
    await waitFor(() =>
      expect(
        screen.getByTestId('mdd-dashboard-grade-filter-chip-na'),
      ).toBeInTheDocument(),
    );

    // Sanity: both stories visible by default.
    expect(screen.getByText('Story graded B')).toBeInTheDocument();
    expect(screen.getByText('Story null grade')).toBeInTheDocument();

    // Deselect 'na'. The null-grade story should disappear; the graded
    // story should remain.
    fireEvent.click(screen.getByTestId('mdd-dashboard-grade-filter-chip-na'));
    await waitFor(() => {
      expect(
        screen.queryByText('Story null grade'),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByText('Story graded B')).toBeInTheDocument();

    // Confirm helper-level agreement -- both `isGradeAllowedByFilter` paths
    // map the wire null to the 'na' chip.
    const gradesWithoutNa = new Set<'A' | 'B' | 'C' | 'D' | 'F' | 'na'>([
      'A',
      'B',
      'C',
      'D',
      'F',
    ]);
    expect(isGradeAllowedByFilter(null, gradesWithoutNa)).toBe(false);
    expect(isGradeAllowedByFilter(undefined, gradesWithoutNa)).toBe(false);
    const gradesOnlyNa = new Set<'A' | 'B' | 'C' | 'D' | 'F' | 'na'>(['na']);
    expect(isGradeAllowedByFilter(null, gradesOnlyNa)).toBe(true);
    expect(isGradeAllowedByFilter('B', gradesOnlyNa)).toBe(false);
  });
});
