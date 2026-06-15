/**
 * MigrationDeliveryHierarchyTree -- QualityGradeChip integration test
 *
 * Spec: 2026-05-20 Spec Quality Scoring -- Task Group 6.3.
 *
 * Verifies that the hierarchy tree renders the `QualityGradeChip` on a story
 * node when the node DTO carries a `qualityGrade` value. The chip is the
 * surface for the per-story grade badge introduced by the Spec Quality
 * Scoring spec; the parent hierarchy already covers null/N-A behaviour and
 * the chip's own colour/tooltip/disagreement rules are exercised in
 * `QualityGradeChip.test.tsx`. Here we only assert the wiring.
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../MigrationDeliveryDashboard.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

import MigrationDeliveryHierarchyTree from '../MigrationDeliveryHierarchyTree';
import type { MigrationDeliveryHierarchyNodeDto } from '../../../../api/migrationDeliveryDashboardApi';

beforeEach(() => {
  vi.resetAllMocks();
});

function makeNode(
  partial: Partial<MigrationDeliveryHierarchyNodeDto> &
    Pick<MigrationDeliveryHierarchyNodeDto, 'id' | 'type' | 'title'>,
): MigrationDeliveryHierarchyNodeDto {
  return {
    parentId: null,
    workstream: null,
    sequenceOrder: null,
    workItemId: null,
    backlogStatus: 'not_saved_to_backlog',
    specGenerationStatus: null,
    specGenerationConfidence: null,
    implementationStatus: null,
    evidenceStatus: 'none',
    needsAttentionCount: 0,
    missingInputsCount: null,
    children: [],
    ...partial,
  };
}

describe('MigrationDeliveryHierarchyTree -- QualityGradeChip integration', () => {
  it('renders QualityGradeChip with grade B for a story node carrying qualityGrade="B"', () => {
    const hierarchy: MigrationDeliveryHierarchyNodeDto[] = [
      makeNode({
        id: 'story-b',
        type: 'story',
        title: 'Story scored B',
        workItemId: 'wi-b',
        backlogStatus: 'saved',
        specGenerationStatus: 'generated',
        specGenerationConfidence: 'medium',
        implementationStatus: 'not_started',
        evidenceStatus: 'covered',
        qualityGrade: 'B',
      }),
    ];

    render(
      <MigrationDeliveryHierarchyTree
        hierarchy={hierarchy}
        onStorySelected={() => {}}
      />,
    );

    // The hierarchy-tree integration uses `mdd-badge-quality-{nodeId}` as the
    // chip's testId override, per `MigrationDeliveryHierarchyTree.tsx`.
    const chip = screen.getByTestId('mdd-badge-quality-story-b');
    expect(chip).toBeInTheDocument();
    expect(chip.textContent).toBe('B');
    expect(chip.getAttribute('data-grade')).toBe('B');
  });
});
