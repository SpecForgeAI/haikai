/**
 * MigrationBookOfWorkHierarchyTree — execution chip + right-click (2026-09-11,
 * start-from-work-item).
 *
 * An item with a durable execution outcome shows THAT ("Implemented",
 * "Implemented 3/7") in place of the review-time "saved" chip; a right-click
 * on a row selects it and reports the pointer position to the parent, which
 * owns the context menu.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

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
    workstream: 'target_infrastructure_environment_implementation',
    sequenceOrder: 0,
    tags: [],
    confidence: 'medium',
    readiness: 'ready_for_spec',
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

const items: MigrationBookOfWorkItem[] = [
  item({ id: 'F1', type: 'feature', title: 'Orders' }),
  item({ id: 's1', type: 'story', parentId: 'F1', title: 'Create order', workItemId: 'wi-1' }),
  item({ id: 's2', type: 'story', parentId: 'F1', title: 'Cancel order', workItemId: 'wi-2' }),
];

describe('MigrationBookOfWorkHierarchyTree — execution outcome chip', () => {
  it('an implemented story shows "Implemented" INSTEAD of "saved"; a partially done parent shows the rollup', () => {
    render(
      <MigrationBookOfWorkHierarchyTree
        items={items}
        selectedItemId={null}
        saveStateById={{ F1: 'saved', s1: 'saved', s2: 'saved' }}
        onSelectItem={() => undefined}
        executionById={{
          F1: { label: 'Implemented 1/2', kind: 'partial' },
          s1: { label: 'Implemented', kind: 'implemented' },
        }}
      />,
    );
    expect(screen.getByTestId('badge-execution-s1').textContent).toBe('Implemented');
    expect(screen.getByTestId('badge-execution-s1').getAttribute('data-execution-kind')).toBe('implemented');
    expect(screen.queryByTestId('badge-savestate-s1')).toBeNull();
    expect(screen.getByTestId('badge-execution-F1').textContent).toBe('Implemented 1/2');
    expect(screen.queryByTestId('badge-savestate-F1')).toBeNull();
    // A story with no outcome keeps the review-time chip.
    expect(screen.getByTestId('badge-savestate-s2').textContent).toBe('saved');
    expect(screen.queryByTestId('badge-execution-s2')).toBeNull();
  });

  it('right-click selects the row and reports the pointer position to the parent', () => {
    const onSelect = vi.fn();
    const onMenu = vi.fn();
    render(
      <MigrationBookOfWorkHierarchyTree
        items={items}
        selectedItemId={null}
        saveStateById={{}}
        onSelectItem={onSelect}
        onContextMenuItem={onMenu}
      />,
    );
    fireEvent.contextMenu(screen.getByTestId('hierarchy-node-row-s2'), { clientX: 120, clientY: 300 });
    expect(onSelect).toHaveBeenCalledWith('s2');
    expect(onMenu).toHaveBeenCalledWith('s2', 120, 300);
  });
});
