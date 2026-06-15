/**
 * MigrationDeliveryHierarchyTree -- provenance badge tests
 *
 * Spec: 2026-06-14 Net-new backlog items + provenance (D5) -- Task Group 4
 * (D6: provenance badge) + Group 5 gap.
 *
 * The uncovered FRONTEND seam: the provenance badge renders the correct value
 * on a story row, distinguishing `net_new` from `carry_over`, and a null/absent
 * wire value normalises to `carry_over` (the AMS column default -- discovered +
 * legacy rows read carry_over with no backfill).
 *
 * (The describe->generate, dispatch-unchanged, and D4-gate-exclusion seams are
 * covered gateway-side by migrationNetNewDescriptionGrounded.test.ts; not
 * re-covered here.)
 */

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

beforeEach(() => {
  vi.resetAllMocks();
});

describe('MigrationDeliveryHierarchyTree -- provenance badge (D5)', () => {
  it('renders a net_new badge for a net_new story and a carry_over badge for a carry_over story', () => {
    const hierarchy: MigrationDeliveryHierarchyNodeDto[] = [
      makeNode({
        id: 'story-new',
        type: 'story',
        title: 'New nightly job',
        workItemId: 'wi-new',
        backlogStatus: 'saved',
        specGenerationStatus: 'generated',
        provenance: 'net_new',
      }),
      makeNode({
        id: 'story-carry',
        type: 'story',
        title: 'Discovered endpoint',
        workItemId: 'wi-carry',
        backlogStatus: 'saved',
        specGenerationStatus: 'generated',
        provenance: 'carry_over',
      }),
    ];

    render(
      <MigrationDeliveryHierarchyTree
        hierarchy={hierarchy}
        onStorySelected={() => {}}
      />,
    );

    const newBadge = screen.getByTestId('mdd-badge-provenance-story-new');
    expect(newBadge).toHaveTextContent('net_new');
    expect(newBadge).toHaveAttribute('data-provenance', 'net_new');

    const carryBadge = screen.getByTestId('mdd-badge-provenance-story-carry');
    expect(carryBadge).toHaveTextContent('carry_over');
    expect(carryBadge).toHaveAttribute('data-provenance', 'carry_over');
  });

  it('normalises a null/absent provenance to carry_over (the column default; no backfill)', () => {
    const hierarchy: MigrationDeliveryHierarchyNodeDto[] = [
      makeNode({
        id: 'story-legacy',
        type: 'story',
        title: 'Legacy discovered story',
        workItemId: 'wi-legacy',
        backlogStatus: 'saved',
        specGenerationStatus: 'generated',
        // provenance omitted entirely (legacy fixture / discovered row).
      }),
    ];

    render(
      <MigrationDeliveryHierarchyTree
        hierarchy={hierarchy}
        onStorySelected={() => {}}
      />,
    );

    const badge = screen.getByTestId('mdd-badge-provenance-story-legacy');
    expect(badge).toHaveTextContent('carry_over');
    expect(badge).toHaveAttribute('data-provenance', 'carry_over');
  });

  it('does NOT render a provenance badge on non-story nodes (initiative/epic/feature)', () => {
    const hierarchy: MigrationDeliveryHierarchyNodeDto[] = [
      makeNode({
        id: 'feature-1',
        type: 'feature',
        title: 'A feature',
        provenance: 'net_new',
        children: [
          makeNode({
            id: 'story-1',
            type: 'story',
            title: 'A story',
            workItemId: 'wi-1',
            provenance: 'net_new',
          }),
        ],
      }),
    ];

    render(
      <MigrationDeliveryHierarchyTree
        hierarchy={hierarchy}
        onStorySelected={() => {}}
      />,
    );

    // The feature node carries no provenance badge; only the story does.
    expect(
      screen.queryByTestId('mdd-badge-provenance-feature-1'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId('mdd-badge-provenance-story-1'),
    ).toBeInTheDocument();
  });
});
