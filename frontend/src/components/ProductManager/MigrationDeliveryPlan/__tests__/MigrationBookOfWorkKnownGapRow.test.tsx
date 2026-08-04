/**
 * MigrationBookOfWorkHierarchyTree — known-gap rows
 *
 * Spec 2026-08-04-2 — Structural findings dispositions. A structural finding
 * dispositioned `known_gap` materialises in the plan as a `known_gap` item
 * under the "Known gaps (accepted debt)" feature, tagged
 * `execution:manual` + `known_gap`. The tree must:
 *   (a) render it like a story row WITH the amber "Known gap" chip;
 *   (b) apply the existing manual-execution chip machinery to it;
 *   (c) never crash on an item type outside the known union.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../MigrationBookOfWork.module.css', () => ({
  default: new Proxy({}, { get: (_t, p) => String(p) }),
}));

import { MigrationBookOfWorkHierarchyTree } from '../MigrationBookOfWorkHierarchyTree';
import type { MigrationBookOfWorkItem } from '../../../../api/migrationBookOfWorkApi';

function item(
  over: Partial<MigrationBookOfWorkItem> & Pick<MigrationBookOfWorkItem, 'id' | 'type'>,
): MigrationBookOfWorkItem {
  return {
    parentId: null,
    title: over.id,
    description: '',
    acceptanceCriteria: [],
    workstream: 'target_database_schema_implementation',
    sequenceOrder: 0,
    tags: [],
    confidence: 'medium',
    readiness: 'blocked',
    readinessReasons: [],
    missingInputs: [],
    recommendedNextAction: '',
    traceabilitySummary: '',
    evidenceReferences: [],
    architectureReferences: [],
    apiBaselineReferences: [],
    discoveryFindingReferences: [],
    mappingReferences: [],
    sourceContextRefs: [],
    ...over,
  };
}

describe('MigrationBookOfWorkHierarchyTree — known-gap rows', () => {
  it('renders a known_gap item with the Known gap chip AND the manual chip', () => {
    const items: MigrationBookOfWorkItem[] = [
      item({ id: 'epic-db', type: 'epic' }),
      item({ id: 'feat-kg', type: 'feature', parentId: 'epic-db', title: 'Known gaps (accepted debt)' }),
      item({
        id: 'kg-1',
        type: 'known_gap',
        parentId: 'feat-kg',
        title: 'Known gap: no primary keys captured',
        tags: ['provenance:pack', 'execution:manual', 'known_gap'],
      }),
    ];

    render(
      <MigrationBookOfWorkHierarchyTree
        items={items}
        selectedItemId={null}
        saveStateById={{}}
        onSelectItem={() => {}}
      />,
    );

    const row = screen.getByTestId('hierarchy-node-row-kg-1');
    expect(row).toBeInTheDocument();
    expect(screen.getByTestId('hierarchy-node-type-kg-1')).toHaveTextContent(
      'known_gap',
    );
    // The amber Known gap chip.
    const chip = screen.getByTestId('badge-known-gap-kg-1');
    expect(chip).toHaveTextContent('Known gap');
    expect(chip.className).toContain('badgeKnownGap');
    // The existing manual-execution machinery applies (execution:manual tag).
    expect(screen.getByTestId('badge-manual-execution-kg-1')).toHaveTextContent(
      'manual',
    );
  });

  it('a story row without the known_gap type gets no Known gap chip', () => {
    render(
      <MigrationBookOfWorkHierarchyTree
        items={[item({ id: 's-1', type: 'story' })]}
        selectedItemId={null}
        saveStateById={{}}
        onSelectItem={() => {}}
      />,
    );
    expect(screen.queryByTestId('badge-known-gap-s-1')).not.toBeInTheDocument();
  });

  it('never crashes on an item type outside the known union', () => {
    const rogue = item({ id: 'weird-1', type: 'story' });
    // Simulate a future/unknown wire value reaching the tree.
    (rogue as { type: string }).type = 'mystery_type';

    render(
      <MigrationBookOfWorkHierarchyTree
        items={[rogue]}
        selectedItemId={null}
        saveStateById={{}}
        onSelectItem={() => {}}
      />,
    );
    expect(screen.getByTestId('hierarchy-node-type-weird-1')).toHaveTextContent(
      'mystery_type',
    );
    expect(screen.queryByTestId('badge-known-gap-weird-1')).not.toBeInTheDocument();
  });
});
