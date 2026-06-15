/**
 * MigrationDeliveryHierarchyTree tests
 *
 * Spec: 2026-05-19 Migration Delivery Progress and Evidence Tracking
 * Task Group 9 (Frontend test 24).
 *
 * Coverage:
 *   Test (Frontend test 24): the tree renders initiative -> epic -> feature
 *   -> story; on an `insufficient_context` node the rendered badges include
 *   `missingInputsCount` (Addition C); and on a node where `workItemId`
 *   is set AND backlog status is saved, the saved-to-backlog badge is
 *   rendered (Addition B).
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock the CSS module so class-name access does not blow up under jsdom.
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

// ============================================================================
// Fixtures
// ============================================================================

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

const HIERARCHY: MigrationDeliveryHierarchyNodeDto[] = [
  makeNode({
    id: 'initiative-1',
    type: 'initiative',
    title: 'Initiative A',
    children: [
      makeNode({
        id: 'epic-1',
        type: 'epic',
        title: 'Epic A.1',
        parentId: 'initiative-1',
        children: [
          makeNode({
            id: 'feature-1',
            type: 'feature',
            title: 'Feature A.1.1',
            parentId: 'epic-1',
            children: [
              // Saved story (Addition B coverage): workItemId set + backlogStatus saved.
              makeNode({
                id: 'story-saved',
                type: 'story',
                title: 'Saved story',
                parentId: 'feature-1',
                workItemId: 'wi-saved-1',
                backlogStatus: 'saved',
                specGenerationStatus: 'generated',
                specGenerationConfidence: 'high',
                implementationStatus: 'not_started',
                evidenceStatus: 'covered',
                needsAttentionCount: 0,
                missingInputsCount: 0,
              }),
              // Insufficient-context story (Addition C coverage): missingInputsCount
              // populated and surfaced on the node.
              makeNode({
                id: 'story-insufficient',
                type: 'story',
                title: 'Insufficient context story',
                parentId: 'feature-1',
                workItemId: null,
                backlogStatus: 'not_saved_to_backlog',
                specGenerationStatus: 'insufficient_context',
                specGenerationConfidence: 'low',
                implementationStatus: null,
                evidenceStatus: 'none',
                needsAttentionCount: 1,
                missingInputsCount: 7,
              }),
            ],
          }),
        ],
      }),
    ],
  }),
];

// ============================================================================
// Test -- Frontend test 24
// ============================================================================

describe('MigrationDeliveryHierarchyTree -- expansion + badges (Frontend test 24)', () => {
  it('expands initiative -> epic -> feature -> story, surfaces missingInputsCount on insufficient-context nodes (Addition C), and the saved-to-backlog badge on saved nodes (Addition B)', () => {
    const onStorySelected = vi.fn();

    render(
      <MigrationDeliveryHierarchyTree
        hierarchy={HIERARCHY}
        onStorySelected={onStorySelected}
      />,
    );

    // The full 4-level hierarchy renders (tree starts expanded by default).
    expect(screen.getByTestId('mdd-hierarchy-node-initiative-1')).toBeInTheDocument();
    expect(screen.getByTestId('mdd-hierarchy-node-epic-1')).toBeInTheDocument();
    expect(screen.getByTestId('mdd-hierarchy-node-feature-1')).toBeInTheDocument();
    expect(screen.getByTestId('mdd-hierarchy-node-story-saved')).toBeInTheDocument();
    expect(
      screen.getByTestId('mdd-hierarchy-node-story-insufficient'),
    ).toBeInTheDocument();

    // Node type chips identify each level.
    expect(
      screen.getByTestId('mdd-hierarchy-node-type-initiative-1'),
    ).toHaveTextContent('initiative');
    expect(
      screen.getByTestId('mdd-hierarchy-node-type-epic-1'),
    ).toHaveTextContent('epic');
    expect(
      screen.getByTestId('mdd-hierarchy-node-type-feature-1'),
    ).toHaveTextContent('feature');
    expect(
      screen.getByTestId('mdd-hierarchy-node-type-story-saved'),
    ).toHaveTextContent('story');

    // Addition B: saved-to-backlog badge appears on the saved story.
    const savedBadge = screen.getByTestId('mdd-badge-backlog-story-saved');
    expect(savedBadge).toHaveTextContent(/saved/i);
    expect(savedBadge).not.toHaveTextContent(/not saved/i);

    // The not-saved story renders the "not saved" badge.
    const notSavedBadge = screen.getByTestId(
      'mdd-badge-backlog-story-insufficient',
    );
    expect(notSavedBadge).toHaveTextContent(/not saved/i);

    // Addition C: missingInputsCount badge appears on the insufficient-
    // context story (count = 7).
    const missingBadge = screen.getByTestId(
      'mdd-badge-missing-inputs-story-insufficient',
    );
    expect(missingBadge).toHaveTextContent(/missing inputs:\s*7/i);

    // The saved story (status 'generated', missingInputsCount = 0) does
    // NOT render a missing-inputs badge.
    expect(
      screen.queryByTestId('mdd-badge-missing-inputs-story-saved'),
    ).not.toBeInTheDocument();

    // Spec generation status badge present on both story rows.
    expect(screen.getByTestId('mdd-badge-spec-story-saved')).toHaveTextContent(
      /generated/i,
    );
    expect(
      screen.getByTestId('mdd-badge-spec-story-insufficient'),
    ).toHaveTextContent(/insufficient_context/i);

    // Clicking the saved story node calls onStorySelected with its workItemId.
    fireEvent.click(screen.getByTestId('mdd-hierarchy-node-row-story-saved'));
    expect(onStorySelected).toHaveBeenCalledWith('wi-saved-1', 'story-saved');

    // Clicking the insufficient story node calls onStorySelected with null work item id.
    fireEvent.click(
      screen.getByTestId('mdd-hierarchy-node-row-story-insufficient'),
    );
    expect(onStorySelected).toHaveBeenCalledWith(null, 'story-insufficient');
  });
});
