/**
 * MigrationDeliveryHierarchyTree -- defer-this-story action + Deferred badge
 *
 * Spec: 2026-06-14 Migrate Button + Migration Execution Driver (Spec 3 of 4)
 * -- Task Group 5 (5.4).
 *
 * Coverage (focused):
 *   1. The "Defer this story" action renders on STORY nodes ONLY (not on
 *      features/epics/initiatives) and fires `onDeferStory(workItemId, true)`.
 *   2. A story whose `workItemId` is in `deferredWorkItemIds` shows the distinct
 *      "Deferred" badge and an "Un-defer" toggle (fires `onDeferStory(id, false)`),
 *      and the story still renders (it is excluded, not deleted).
 */

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

// feature -> { story-1, story-2 }
function buildHierarchy(): MigrationDeliveryHierarchyNodeDto[] {
  return [
    makeNode({
      id: 'feature-1',
      type: 'feature',
      title: 'Feature A',
      workItemId: 'wi-feature-1',
      children: [
        makeNode({
          id: 'story-1',
          type: 'story',
          title: 'Story One',
          parentId: 'feature-1',
          workItemId: 'wi-1',
          backlogStatus: 'saved',
          specGenerationStatus: 'generated',
        }),
        makeNode({
          id: 'story-2',
          type: 'story',
          title: 'Story Two',
          parentId: 'feature-1',
          workItemId: 'wi-2',
          backlogStatus: 'saved',
          specGenerationStatus: 'insufficient_context',
        }),
      ],
    }),
  ];
}

describe('MigrationDeliveryHierarchyTree -- defer-this-story action + Deferred badge', () => {
  it('renders the Defer action on stories only and fires onDeferStory(id, true)', () => {
    const onDefer = vi.fn();
    render(
      <MigrationDeliveryHierarchyTree
        hierarchy={buildHierarchy()}
        onStorySelected={vi.fn()}
        onDeferStory={onDefer}
      />,
    );

    // Present on both stories.
    expect(screen.getByTestId('mdd-defer-story-story-1')).toBeInTheDocument();
    expect(screen.getByTestId('mdd-defer-story-story-2')).toBeInTheDocument();
    // Absent on the feature node.
    expect(
      screen.queryByTestId('mdd-defer-story-feature-1'),
    ).not.toBeInTheDocument();

    // Clicking fires the callback with the story's workItemId + nextDeferred=true
    // (and does NOT bubble to a story-selection).
    fireEvent.click(screen.getByTestId('mdd-defer-story-story-2'));
    expect(onDefer).toHaveBeenCalledTimes(1);
    expect(onDefer).toHaveBeenCalledWith('wi-2', true);
  });

  it('shows the Deferred badge + an Un-defer toggle for a deferred story (still rendered)', () => {
    const onDefer = vi.fn();
    render(
      <MigrationDeliveryHierarchyTree
        hierarchy={buildHierarchy()}
        onStorySelected={vi.fn()}
        onDeferStory={onDefer}
        deferredWorkItemIds={new Set(['wi-2'])}
      />,
    );

    // The deferred story shows the distinct badge and is still in the tree.
    expect(screen.getByTestId('mdd-badge-deferred-story-2')).toHaveTextContent(
      'Deferred',
    );
    expect(screen.getByTestId('mdd-hierarchy-node-story-2')).toBeInTheDocument();
    // The non-deferred story has no Deferred badge.
    expect(
      screen.queryByTestId('mdd-badge-deferred-story-1'),
    ).not.toBeInTheDocument();

    // Its action is now an Un-defer toggle that fires nextDeferred=false.
    const toggle = screen.getByTestId('mdd-defer-story-story-2');
    expect(toggle).toHaveTextContent(/Un-defer/i);
    fireEvent.click(toggle);
    expect(onDefer).toHaveBeenCalledWith('wi-2', false);
  });
});
