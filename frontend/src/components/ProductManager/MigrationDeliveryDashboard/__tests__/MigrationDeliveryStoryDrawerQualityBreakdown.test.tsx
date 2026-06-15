/**
 * MigrationDeliveryStoryDrawer -- Quality breakdown section tests
 *
 * Spec: 2026-05-20 Spec Quality Scoring -- Task Group 7.
 *
 * Coverage:
 *   1. The Quality breakdown section renders the five dimension rows when
 *      `qualityScore` is set on the spec generation data.
 *   2. The section is HIDDEN (not present) when `qualityScore` is null --
 *      `insufficient_context` / `failed` rows intentionally store nulls
 *      per spec.md.
 *   3. Clicking the recompute icon button POSTs to the gateway single-row
 *      endpoint and updates the drawer state with the response.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock the CSS module so class-name access does not blow up under jsdom.
vi.mock('../MigrationDeliveryDashboard.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

// Mock the spec-generation API client so we can assert the recompute POST.
const mockRecomputeSpecQuality = vi.fn();
vi.mock('../../../../api/specGenerationApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/specGenerationApi')
  >('../../../../api/specGenerationApi');
  return {
    ...actual,
    recomputeSpecQuality: (...args: unknown[]) =>
      mockRecomputeSpecQuality(...args),
  };
});

import {
  MigrationDeliveryStoryDrawer,
  type StoryPassTwoDetail,
} from '../MigrationDeliveryStoryDrawer';
import type { MigrationDeliveryHierarchyNodeDto } from '../../../../api/migrationDeliveryDashboardApi';

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

function makeStory(
  overrides: Partial<MigrationDeliveryHierarchyNodeDto> = {},
): MigrationDeliveryHierarchyNodeDto {
  return {
    id: 'story-q',
    parentId: 'feature-1',
    type: 'story',
    title: 'Story with scored quality',
    workstream: 'order-service',
    sequenceOrder: 1,
    workItemId: 'wi-q',
    backlogStatus: 'saved',
    specGenerationStatus: 'generated',
    specGenerationConfidence: 'medium',
    implementationStatus: 'not_started',
    evidenceStatus: 'no_evidence',
    needsAttentionCount: 0,
    missingInputsCount: 0,
    children: [],
    ...overrides,
  };
}

function makeScoredSpecGeneration(
  overrides: Partial<StoryPassTwoDetail> = {},
): StoryPassTwoDetail {
  return {
    generationPass: 1,
    pass1SpecText: null,
    generatedSpecText: 'spec body',
    pass2ChangesSummary: null,
    budgetMetaJson: null,
    noMeaningfulChange: null,
    warnings: [],
    specGenerationId: 'spec-q-1',
    qualityScore: 78,
    qualityGrade: 'B',
    qualityDimensions: [
      { name: 'completeness', score: 86, reason: '6/7 expected sections present' },
      { name: 'ac_measurability', score: 75, reason: '3 of 4 ACs measurable' },
      { name: 'implementation_concreteness', score: 70, reason: '7 concrete references found' },
      { name: 'evidence_density', score: 60, reason: '3 evidence refs across 150 words' },
      { name: 'sibling_parent_alignment', score: 50, reason: '0 contradictions, 0 alignments' },
    ],
    previousQualityScore: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ============================================================================
// Test 1 -- section renders five dimension rows when qualityScore is set
// ============================================================================

describe('MigrationDeliveryStoryDrawer -- Quality breakdown rendering', () => {
  it('renders the section with five dimension rows when qualityScore is set', () => {
    const story = makeStory();
    const specGen = makeScoredSpecGeneration();

    render(
      <MigrationDeliveryStoryDrawer
        story={story}
        specGeneration={specGen}
        projectId="proj-1"
        onClose={() => {}}
      />,
    );

    // Section is present.
    expect(
      screen.getByTestId('mdd-story-drawer-quality-breakdown'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('mdd-story-drawer-quality-breakdown-title'),
    ).toHaveTextContent(/quality breakdown/i);

    // Grade badge + composite score visible.
    const gradeBadge = screen.getByTestId('mdd-story-drawer-quality-grade-badge');
    expect(gradeBadge).toHaveTextContent('B');
    expect(
      screen.getByTestId('mdd-story-drawer-quality-score-value'),
    ).toHaveTextContent('78/100');

    // Five dimension rows.
    for (let i = 0; i < 5; i++) {
      expect(
        screen.getByTestId(`mdd-story-drawer-quality-dimension-${i}`),
      ).toBeInTheDocument();
    }
    expect(
      screen.getByTestId('mdd-story-drawer-quality-dimension-0-name'),
    ).toHaveTextContent('completeness');
    expect(
      screen.getByTestId('mdd-story-drawer-quality-dimension-4-name'),
    ).toHaveTextContent('sibling_parent_alignment');
  });

  // ==========================================================================
  // Test 2 -- section hidden when qualityScore is null
  // ==========================================================================

  it('does NOT render the section when qualityScore is null', () => {
    const story = makeStory({ specGenerationStatus: 'insufficient_context' });
    const specGen: StoryPassTwoDetail = {
      generationPass: 1,
      pass1SpecText: null,
      generatedSpecText: null,
      pass2ChangesSummary: null,
      budgetMetaJson: null,
      noMeaningfulChange: null,
      warnings: [],
      specGenerationId: 'spec-na-1',
      qualityScore: null,
      qualityGrade: null,
      qualityDimensions: null,
      previousQualityScore: null,
    };

    render(
      <MigrationDeliveryStoryDrawer
        story={story}
        specGeneration={specGen}
        projectId="proj-1"
        onClose={() => {}}
      />,
    );

    expect(
      screen.queryByTestId('mdd-story-drawer-quality-breakdown'),
    ).not.toBeInTheDocument();
  });

  // ==========================================================================
  // Test 3 -- recompute button POSTs and refreshes drawer state
  // ==========================================================================

  it('clicking the recompute button calls recomputeSpecQuality and refreshes the drawer', async () => {
    const story = makeStory();
    const specGen = makeScoredSpecGeneration();
    mockRecomputeSpecQuality.mockResolvedValueOnce({
      qualityScore: 88,
      qualityGrade: 'A',
      qualityDimensions: [
        { name: 'completeness', score: 100, reason: '7/7 expected sections present' },
        { name: 'ac_measurability', score: 85, reason: '4 of 4 ACs measurable' },
        { name: 'implementation_concreteness', score: 80, reason: '8 concrete references found' },
        { name: 'evidence_density', score: 90, reason: '5 evidence refs across 150 words' },
        { name: 'sibling_parent_alignment', score: 80, reason: '0 contradictions, 2 alignments' },
      ],
      previousQualityScore: 78,
    });

    render(
      <MigrationDeliveryStoryDrawer
        story={story}
        specGeneration={specGen}
        projectId="proj-1"
        onClose={() => {}}
      />,
    );

    // Before click: B / 78.
    expect(
      screen.getByTestId('mdd-story-drawer-quality-grade-badge'),
    ).toHaveTextContent('B');
    expect(
      screen.getByTestId('mdd-story-drawer-quality-score-value'),
    ).toHaveTextContent('78/100');

    fireEvent.click(
      screen.getByTestId('mdd-story-drawer-quality-recompute'),
    );

    await waitFor(() => {
      expect(mockRecomputeSpecQuality).toHaveBeenCalledWith(
        'proj-1',
        'spec-q-1',
      );
    });

    // After resolve: A / 88, plus delta chip surfaces (78 -> C maps to C; 88 -> A; differ).
    await waitFor(() => {
      expect(
        screen.getByTestId('mdd-story-drawer-quality-grade-badge'),
      ).toHaveTextContent('A');
    });
    expect(
      screen.getByTestId('mdd-story-drawer-quality-score-value'),
    ).toHaveTextContent('88/100');
    // 78 -> B, 88 -> A: delta chip renders because letters differ.
    expect(
      screen.getByTestId('mdd-story-drawer-quality-delta'),
    ).toBeInTheDocument();
  });
});
