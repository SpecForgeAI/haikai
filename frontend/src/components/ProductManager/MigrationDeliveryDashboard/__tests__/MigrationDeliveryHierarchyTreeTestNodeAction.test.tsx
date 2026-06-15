/**
 * MigrationDeliveryHierarchyTree -- TEST chip + node action + show/hide filter
 *
 * Spec: 2026-06-14 Holistic Integration/E2E TEST Work Items (Spec 2 of 4)
 * -- Task Group 4 (D1 / D5(a)).
 *
 * Coverage (focused):
 *   1. A `type === 'TEST'` node renders the distinct TEST chip.
 *   2. The "Define Integration/E2E Tests" action renders on FEATURE and EPIC
 *      nodes ONLY (not on stories/initiatives) and, when clicked, calls
 *      `onDefineIntegrationTests` with that node.
 *   3. The `hideTestItems` flag prunes `TEST` nodes from the tree while its
 *      non-TEST siblings survive.
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

// initiative -> epic -> feature -> { story, TEST sibling }
function buildHierarchy(): MigrationDeliveryHierarchyNodeDto[] {
  return [
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
          workItemId: 'wi-epic-1',
          children: [
            makeNode({
              id: 'feature-1',
              type: 'feature',
              title: 'Feature A.1.1',
              parentId: 'epic-1',
              workItemId: 'wi-feature-1',
              children: [
                makeNode({
                  id: 'story-1',
                  type: 'story',
                  title: 'Story A.1.1.1',
                  parentId: 'feature-1',
                  workItemId: 'wi-story-1',
                  backlogStatus: 'saved',
                  specGenerationStatus: 'generated',
                }),
                // The TEST sibling created by the holistic node action.
                makeNode({
                  id: 'test-1',
                  type: 'TEST',
                  title: 'Auth -> billing integration',
                  parentId: 'feature-1',
                  workItemId: 'wi-test-1',
                  backlogStatus: 'saved',
                  sequenceOrder: 4,
                }),
              ],
            }),
          ],
        }),
      ],
    }),
  ];
}

describe('MigrationDeliveryHierarchyTree -- TEST chip + node action + filter', () => {
  it('renders the distinct TEST chip on a type==="TEST" node', () => {
    render(
      <MigrationDeliveryHierarchyTree
        hierarchy={buildHierarchy()}
        onStorySelected={vi.fn()}
      />,
    );

    const chip = screen.getByTestId('mdd-badge-test-test-1');
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveTextContent('TEST');

    // Stories do not get the TEST chip.
    expect(
      screen.queryByTestId('mdd-badge-test-story-1'),
    ).not.toBeInTheDocument();
  });

  it('shows the Define Integration/E2E Tests action on FEATURE and EPIC nodes only and fires the callback with the node', () => {
    const onDefine = vi.fn();
    render(
      <MigrationDeliveryHierarchyTree
        hierarchy={buildHierarchy()}
        onStorySelected={vi.fn()}
        onDefineIntegrationTests={onDefine}
      />,
    );

    // Present on FEATURE + EPIC.
    expect(screen.getByTestId('mdd-define-tests-feature-1')).toBeInTheDocument();
    expect(screen.getByTestId('mdd-define-tests-epic-1')).toBeInTheDocument();

    // Absent on initiative / story / TEST.
    expect(
      screen.queryByTestId('mdd-define-tests-initiative-1'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('mdd-define-tests-story-1'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('mdd-define-tests-test-1'),
    ).not.toBeInTheDocument();

    // Clicking the feature's button fires the callback with the feature node
    // (and does NOT bubble to a story-selection).
    fireEvent.click(screen.getByTestId('mdd-define-tests-feature-1'));
    expect(onDefine).toHaveBeenCalledTimes(1);
    expect(onDefine.mock.calls[0][0]).toMatchObject({
      id: 'feature-1',
      type: 'feature',
    });
  });

  it('prunes TEST nodes when hideTestItems is true and restores them when false', () => {
    const { rerender } = render(
      <MigrationDeliveryHierarchyTree
        hierarchy={buildHierarchy()}
        onStorySelected={vi.fn()}
        hideTestItems={false}
      />,
    );

    // Visible by default.
    expect(screen.getByTestId('mdd-hierarchy-node-test-1')).toBeInTheDocument();
    // Non-TEST sibling visible.
    expect(screen.getByTestId('mdd-hierarchy-node-story-1')).toBeInTheDocument();

    // Hide TEST items -> TEST node pruned, story sibling preserved.
    rerender(
      <MigrationDeliveryHierarchyTree
        hierarchy={buildHierarchy()}
        onStorySelected={vi.fn()}
        hideTestItems
      />,
    );
    expect(
      screen.queryByTestId('mdd-hierarchy-node-test-1'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('mdd-hierarchy-node-story-1')).toBeInTheDocument();
    // The feature ancestor still renders (only the TEST child was removed).
    expect(screen.getByTestId('mdd-hierarchy-node-feature-1')).toBeInTheDocument();
  });
});
