/**
 * MigrationBookOfWorkHierarchyTree — gap-badge roll-up (2026-06-27 fix).
 *
 * The gap badge on a node shows the total MISSING INPUTS across the stories in
 * its subtree (a feature/epic/initiative = the sum of its descendant stories;
 * a story = its own). Readiness reasons are NOT counted. This guards the fix
 * for the bug where a feature showed its own (missingInputs + readinessReasons)
 * instead of the rolled-up story total.
 */

import React from 'react';
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
    workstream: 'target_infrastructure_environment_implementation',
    sequenceOrder: 0,
    tags: [],
    confidence: 'medium',
    readiness: 'needs_focused_context',
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

function gapText(itemId: string): string {
  return screen.getByTestId(`badge-gap-${itemId}`).textContent ?? '';
}

describe('MigrationBookOfWorkHierarchyTree — gap roll-up', () => {
  it('a feature badge sums its child stories missing inputs (2+5+4 = 11), not its own', () => {
    const items: MigrationBookOfWorkItem[] = [
      item({ id: 'init', type: 'initiative' }),
      item({ id: 'epic', type: 'epic', parentId: 'init' }),
      // Feature has its OWN 2 missing inputs + 2 readiness reasons (the old
      // formula would have shown 4); these must NOT drive the badge.
      item({
        id: 'feat',
        type: 'feature',
        parentId: 'epic',
        missingInputs: ['ci.pipeline', 'deployment.target'],
        readinessReasons: ['reason a', 'reason b'],
      }),
      item({ id: 's1', type: 'story', parentId: 'feat', missingInputs: ['a', 'b'] }),
      item({
        id: 's2',
        type: 'story',
        parentId: 'feat',
        missingInputs: ['a', 'b', 'c', 'd', 'e'],
        readinessReasons: ['noise'],
      }),
      item({ id: 's3', type: 'story', parentId: 'feat', missingInputs: ['a', 'b', 'c', 'd'] }),
    ];

    render(
      <MigrationBookOfWorkHierarchyTree
        items={items}
        selectedItemId={null}
        saveStateById={{}}
        onSelectItem={() => {}}
      />,
    );

    // Leaves show their own missing-input counts.
    expect(gapText('s1')).toMatch(/2 gaps/);
    expect(gapText('s2')).toMatch(/5 gaps/);
    expect(gapText('s3')).toMatch(/4 gaps/);
    // Feature/epic/initiative roll up to the story total (11), NOT the
    // feature's own 4 (2 missing + 2 readiness).
    expect(gapText('feat')).toMatch(/11 gaps/);
    expect(gapText('epic')).toMatch(/11 gaps/);
    expect(gapText('init')).toMatch(/11 gaps/);
  });

  it('readiness reasons alone produce no gap badge (missing inputs only)', () => {
    const items: MigrationBookOfWorkItem[] = [
      item({
        id: 'lonely',
        type: 'story',
        readinessReasons: ['just an explanation', 'another'],
        missingInputs: [],
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
    expect(screen.queryByTestId('badge-gap-lonely')).not.toBeInTheDocument();
  });
});
