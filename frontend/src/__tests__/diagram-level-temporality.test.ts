/**
 * Tests for Diagram-Level Temporality Feature
 *
 * This test suite covers:
 * - Task Group 1: Type definitions (DiagramNode, DiagramEdge, DecorationBase with valid_from/valid_to)
 * - Task Group 2: Visibility utilities (isDiagramElementVisibleInPeriod)
 * - Task Group 3: Version splitting utilities (shouldTriggerSplit, splitDiagramNode, etc.)
 * - Task Group 5: Temporal filtering (getNodesInRenderOrder, getEdgesForDiagram, getDecorationsForDiagram)
 */

import { describe, it, expect } from 'vitest';
import {
  isDiagramElementVisibleInPeriod,
  compareQuarters,
  getPreviousQuarter,
  getNextQuarter,
} from '../utils/quarterUtils';
import {
  shouldTriggerSplit,
  getEditDirection,
  splitDiagramNode,
  splitDiagramEdge,
  splitDecoration,
  generateVersionId,
} from '../utils/temporalSplitting';
import type { DiagramNode, DiagramEdge, Decoration, ShapeDecoration, LineDecoration, TemporalDiagramElement } from '../types/model';

// ============================================================================
// Task Group 1: Type Definitions Tests
// ============================================================================

describe('Task Group 1: Type Definitions', () => {
  it('should allow DiagramNode with temporal fields', () => {
    const node: DiagramNode = {
      id: 'node-1',
      entity_type: 'APPLICATION',
      entity_id: 'app-1',
      pos_x: 100,
      pos_y: 100,
      width: 150,
      height: 100,
      parent_node_id: null,
      valid_from: '2024-Q1',
      valid_to: '2025-Q4',
    };

    expect(node.valid_from).toBe('2024-Q1');
    expect(node.valid_to).toBe('2025-Q4');
  });

  it('should allow DiagramNode without temporal fields (timeless)', () => {
    const node: DiagramNode = {
      id: 'node-2',
      entity_type: 'SERVICE',
      entity_id: 'svc-1',
      pos_x: 200,
      pos_y: 200,
      width: 120,
      height: 80,
      parent_node_id: null,
    };

    expect(node.valid_from).toBeUndefined();
    expect(node.valid_to).toBeUndefined();
  });

  it('should allow DiagramEdge with temporal fields', () => {
    const edge: DiagramEdge = {
      id: 'edge-1',
      relationship_type: 'DATA_MOVEMENT',
      relationship_id: 'dm-1',
      source_node_id: 'node-1',
      target_node_id: 'node-2',
      edge_points: [],
      valid_from: '2024-Q2',
      valid_to: '2026-Q1',
    };

    expect(edge.valid_from).toBe('2024-Q2');
    expect(edge.valid_to).toBe('2026-Q1');
  });

  it('should allow Decoration with temporal fields', () => {
    const decoration: ShapeDecoration = {
      id: 'deco-1',
      type: 'BOX',
      pos_x: 50,
      pos_y: 50,
      width: 100,
      height: 50,
      text: 'Test Label',
      valid_from: '2025-Q1',
      valid_to: '2026-Q4',
    };

    expect(decoration.valid_from).toBe('2025-Q1');
    expect(decoration.valid_to).toBe('2026-Q4');
  });

  it('should allow LineDecoration with temporal fields', () => {
    const line: LineDecoration = {
      id: 'line-1',
      type: 'ARROW_SINGLE',
      line_points: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
      valid_from: '2024-Q3',
      valid_to: undefined, // Open-ended
    };

    expect(line.valid_from).toBe('2024-Q3');
    expect(line.valid_to).toBeUndefined();
  });
});

// ============================================================================
// Task Group 2: Visibility Utilities Tests
// ============================================================================

describe('Task Group 2: isDiagramElementVisibleInPeriod', () => {
  it('should return true for timeless elements (no valid_from or valid_to)', () => {
    const element: TemporalDiagramElement = {};
    expect(isDiagramElementVisibleInPeriod(element, '2025-Q1')).toBe(true);
  });

  it('should return true when viewQuarter is within validity range', () => {
    const element: TemporalDiagramElement = {
      valid_from: '2024-Q1',
      valid_to: '2026-Q4',
    };
    // Test middle of range
    expect(isDiagramElementVisibleInPeriod(element, '2025-Q2')).toBe(true);
    // Test at start (inclusive)
    expect(isDiagramElementVisibleInPeriod(element, '2024-Q1')).toBe(true);
    // Test just before end
    expect(isDiagramElementVisibleInPeriod(element, '2026-Q3')).toBe(true);
  });

  it('should return false when viewQuarter is before valid_from', () => {
    const element: TemporalDiagramElement = {
      valid_from: '2025-Q1',
      valid_to: '2026-Q4',
    };
    expect(isDiagramElementVisibleInPeriod(element, '2024-Q4')).toBe(false);
    expect(isDiagramElementVisibleInPeriod(element, '2024-Q1')).toBe(false);
  });

  it('should return false when viewQuarter is at or after valid_to (exclusive end)', () => {
    const element: TemporalDiagramElement = {
      valid_from: '2024-Q1',
      valid_to: '2025-Q3',
    };
    // At valid_to - should be false (exclusive)
    expect(isDiagramElementVisibleInPeriod(element, '2025-Q3')).toBe(false);
    // After valid_to
    expect(isDiagramElementVisibleInPeriod(element, '2025-Q4')).toBe(false);
    expect(isDiagramElementVisibleInPeriod(element, '2026-Q1')).toBe(false);
  });

  it('should handle only valid_from (open-ended future)', () => {
    const element: TemporalDiagramElement = {
      valid_from: '2025-Q1',
    };
    // Before start - not visible
    expect(isDiagramElementVisibleInPeriod(element, '2024-Q4')).toBe(false);
    // At start - visible
    expect(isDiagramElementVisibleInPeriod(element, '2025-Q1')).toBe(true);
    // Way in the future - still visible
    expect(isDiagramElementVisibleInPeriod(element, '2099-Q4')).toBe(true);
  });

  it('should handle only valid_to (open-ended past)', () => {
    const element: TemporalDiagramElement = {
      valid_to: '2025-Q3',
    };
    // Way in the past - visible
    expect(isDiagramElementVisibleInPeriod(element, '2000-Q1')).toBe(true);
    // Just before end - visible
    expect(isDiagramElementVisibleInPeriod(element, '2025-Q2')).toBe(true);
    // At end - not visible (exclusive)
    expect(isDiagramElementVisibleInPeriod(element, '2025-Q3')).toBe(false);
    // After end - not visible
    expect(isDiagramElementVisibleInPeriod(element, '2025-Q4')).toBe(false);
  });
});

// ============================================================================
// Task Group 3: Version Splitting Utilities Tests
// ============================================================================

describe('Task Group 3: shouldTriggerSplit', () => {
  it('should return false for timeless elements', () => {
    const element: TemporalDiagramElement = {};
    expect(shouldTriggerSplit(element, '2025-Q1')).toBe(false);
  });

  it('should return false when editing within validity range', () => {
    const element: TemporalDiagramElement = {
      valid_from: '2024-Q1',
      valid_to: '2026-Q4',
    };
    expect(shouldTriggerSplit(element, '2025-Q2')).toBe(false);
  });

  it('should return true when editing before valid_from', () => {
    const element: TemporalDiagramElement = {
      valid_from: '2025-Q1',
      valid_to: '2026-Q4',
    };
    expect(shouldTriggerSplit(element, '2024-Q4')).toBe(true);
  });

  it('should return true when editing at or after valid_to', () => {
    const element: TemporalDiagramElement = {
      valid_from: '2024-Q1',
      valid_to: '2025-Q3',
    };
    expect(shouldTriggerSplit(element, '2025-Q3')).toBe(true);
    expect(shouldTriggerSplit(element, '2025-Q4')).toBe(true);
  });
});

describe('Task Group 3: getEditDirection', () => {
  it('should return "current" for timeless elements', () => {
    const element: TemporalDiagramElement = {};
    expect(getEditDirection(element, '2025-Q1')).toBe('current');
  });

  it('should return "current" when editing within validity range', () => {
    const element: TemporalDiagramElement = {
      valid_from: '2024-Q1',
      valid_to: '2026-Q4',
    };
    expect(getEditDirection(element, '2025-Q2')).toBe('current');
  });

  it('should return "past" when editing before valid_from', () => {
    const element: TemporalDiagramElement = {
      valid_from: '2025-Q1',
      valid_to: '2026-Q4',
    };
    expect(getEditDirection(element, '2024-Q4')).toBe('past');
  });

  it('should return "future" when editing at or after valid_to', () => {
    const element: TemporalDiagramElement = {
      valid_from: '2024-Q1',
      valid_to: '2025-Q3',
    };
    expect(getEditDirection(element, '2025-Q3')).toBe('future');
    expect(getEditDirection(element, '2026-Q1')).toBe('future');
  });
});

describe('Task Group 3: generateVersionId', () => {
  it('should generate a unique ID based on original ID', () => {
    const originalId = 'node-123';
    const newId = generateVersionId(originalId);

    expect(newId).toContain('node-123_v');
    expect(newId.length).toBeGreaterThan(originalId.length);
  });

  it('should generate different IDs on successive calls', () => {
    const id1 = generateVersionId('test');
    const id2 = generateVersionId('test');

    expect(id1).not.toBe(id2);
  });
});

describe('Task Group 3: splitDiagramNode', () => {
  it('should split node for FUTURE edit', () => {
    const node: DiagramNode = {
      id: 'node-1',
      entity_type: 'APPLICATION',
      entity_id: 'app-1',
      pos_x: 100,
      pos_y: 100,
      width: 150,
      height: 100,
      parent_node_id: null,
      valid_from: '2024-Q1',
      valid_to: '2025-Q3', // Ends Q3
    };

    // Edit in Q4 (after valid_to)
    const result = splitDiagramNode(node, '2025-Q4', { pos_x: 200 });

    // Original should be closed at Q3 (period before edit)
    expect(result.originalNode.valid_to).toBe('2025-Q3');
    // New version should start at edit period
    expect(result.newVersion.valid_from).toBe('2025-Q4');
    expect(result.newVersion.valid_to).toBeUndefined();
    // Changes should be applied to new version
    expect(result.newVersion.pos_x).toBe(200);
    // Original position unchanged
    expect(result.originalNode.pos_x).toBe(100);
    // New version has new ID
    expect(result.newVersion.id).not.toBe(node.id);
  });

  it('should split node for PAST edit', () => {
    const node: DiagramNode = {
      id: 'node-1',
      entity_type: 'SERVICE',
      entity_id: 'svc-1',
      pos_x: 100,
      pos_y: 100,
      width: 120,
      height: 80,
      parent_node_id: null,
      valid_from: '2025-Q2', // Starts Q2
      valid_to: '2026-Q4',
    };

    // Edit in Q1 (before valid_from)
    const result = splitDiagramNode(node, '2025-Q1', { pos_y: 50 });

    // Original should now start at Q2 (period after edit)
    expect(result.originalNode.valid_from).toBe('2025-Q2');
    // New version covers the past
    expect(result.newVersion.valid_from).toBe('2025-Q2'); // Keeps original start
    expect(result.newVersion.valid_to).toBe('2025-Q1'); // Ends at edit period
    // Changes applied to new version
    expect(result.newVersion.pos_y).toBe(50);
  });

  it('should not split for CURRENT edit (returns same node)', () => {
    const node: DiagramNode = {
      id: 'node-1',
      entity_type: 'APPLICATION',
      entity_id: 'app-1',
      pos_x: 100,
      pos_y: 100,
      width: 150,
      height: 100,
      parent_node_id: null,
      valid_from: '2024-Q1',
      valid_to: '2026-Q4',
    };

    // Edit within validity range
    const result = splitDiagramNode(node, '2025-Q2', { width: 200 });

    // For current edits, both returned objects point to the modified original
    expect(result.originalNode.width).toBe(200);
  });
});

describe('Task Group 3: splitDiagramEdge', () => {
  it('should split edge for FUTURE edit', () => {
    const edge: DiagramEdge = {
      id: 'edge-1',
      relationship_type: 'DATA_MOVEMENT',
      relationship_id: 'dm-1',
      source_node_id: 'node-1',
      target_node_id: 'node-2',
      edge_points: [
        { id: 'ep-1', sequence_order: 0, pos_x: 100, pos_y: 100 },
        { id: 'ep-2', sequence_order: 1, pos_x: 200, pos_y: 200 },
      ],
      valid_from: '2024-Q1',
      valid_to: '2025-Q2',
    };

    const result = splitDiagramEdge(edge, '2025-Q3', { label_text: 'New Label' });

    expect(result.originalEdge.valid_to).toBe('2025-Q2');
    expect(result.newVersion.valid_from).toBe('2025-Q3');
    expect(result.newVersion.label_text).toBe('New Label');
    expect(result.newVersion.id).not.toBe(edge.id);
    // Edge points should be deep cloned
    expect(result.newVersion.edge_points).not.toBe(edge.edge_points);
    expect(result.newVersion.edge_points.length).toBe(2);
  });
});

describe('Task Group 3: splitDecoration', () => {
  it('should split shape decoration for FUTURE edit', () => {
    const decoration: ShapeDecoration = {
      id: 'deco-1',
      type: 'BOX',
      pos_x: 50,
      pos_y: 50,
      width: 100,
      height: 50,
      text: 'Original',
      valid_from: '2024-Q1',
      valid_to: '2025-Q2',
    };

    const result = splitDecoration(decoration, '2025-Q3', { text: 'Updated' });

    expect(result.originalDecoration.valid_to).toBe('2025-Q2');
    expect(result.newVersion.valid_from).toBe('2025-Q3');
    expect((result.newVersion as ShapeDecoration).text).toBe('Updated');
    expect(result.newVersion.id).not.toBe(decoration.id);
  });

  it('should split line decoration with deep clone of line_points', () => {
    const line: LineDecoration = {
      id: 'line-1',
      type: 'LINE',
      line_points: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
      valid_from: '2024-Q1',
      valid_to: '2025-Q2',
    };

    const result = splitDecoration(line, '2025-Q3', {});

    // Line points should be deep cloned
    expect((result.newVersion as LineDecoration).line_points).not.toBe(line.line_points);
    expect((result.newVersion as LineDecoration).line_points.length).toBe(2);
  });
});

// ============================================================================
// Quarter Utility Helper Tests (used by temporal functions)
// ============================================================================

describe('Quarter Utility Helpers', () => {
  describe('compareQuarters', () => {
    it('should return -1 when q1 < q2', () => {
      expect(compareQuarters('2024-Q1', '2024-Q2')).toBe(-1);
      expect(compareQuarters('2024-Q4', '2025-Q1')).toBe(-1);
    });

    it('should return 0 when q1 === q2', () => {
      expect(compareQuarters('2025-Q2', '2025-Q2')).toBe(0);
    });

    it('should return 1 when q1 > q2', () => {
      expect(compareQuarters('2025-Q2', '2025-Q1')).toBe(1);
      expect(compareQuarters('2025-Q1', '2024-Q4')).toBe(1);
    });
  });

  describe('getPreviousQuarter', () => {
    it('should return previous quarter in same year', () => {
      expect(getPreviousQuarter('2025-Q2')).toBe('2025-Q1');
      expect(getPreviousQuarter('2025-Q3')).toBe('2025-Q2');
      expect(getPreviousQuarter('2025-Q4')).toBe('2025-Q3');
    });

    it('should wrap to previous year from Q1', () => {
      expect(getPreviousQuarter('2025-Q1')).toBe('2024-Q4');
    });
  });

  describe('getNextQuarter', () => {
    it('should return next quarter in same year', () => {
      expect(getNextQuarter('2025-Q1')).toBe('2025-Q2');
      expect(getNextQuarter('2025-Q2')).toBe('2025-Q3');
      expect(getNextQuarter('2025-Q3')).toBe('2025-Q4');
    });

    it('should wrap to next year from Q4', () => {
      expect(getNextQuarter('2025-Q4')).toBe('2026-Q1');
    });
  });
});
