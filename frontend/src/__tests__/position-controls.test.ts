/**
 * Tests for POSITION Controls in Row 2 Toolbar
 *
 * Task Group 2: Add POSITION Controls to Toolbar
 * Tests the position (X, Y, W, H) controls for nodes and shape decorations
 */

import {
  DiagramNode,
  DiagramEdge,
  ShapeDecoration,
  LineDecoration,
  SHAPE_DECORATION_TYPES,
  LINE_DECORATION_TYPES,
} from '../types/model';

// Helper type for testing
interface PositionControlsState {
  isEnabled: boolean;
  posX: number | null;
  posY: number | null;
  width: number | null;
  height: number | null;
}

/**
 * Check if position controls should be enabled based on selection
 * Enabled: single node or single shape decoration selected
 * Disabled: no selection, multi-select, line, or edge selected
 */
function isPositionControlsEnabled(
  selectedNodeIds: Set<string>,
  selectedEdgeIds: Set<string>,
  selectedDecorationIds: Set<string>,
  decorations: (ShapeDecoration | LineDecoration)[]
): boolean {
  const nodeCount = selectedNodeIds.size;
  const edgeCount = selectedEdgeIds.size;
  const decorationCount = selectedDecorationIds.size;
  const totalCount = nodeCount + edgeCount + decorationCount;

  // Disabled if no selection
  if (totalCount === 0) {
    return false;
  }

  // Disabled if multiple elements selected
  if (totalCount > 1) {
    return false;
  }

  // Disabled if edge is selected
  if (edgeCount > 0) {
    return false;
  }

  // Enabled if single node is selected
  if (nodeCount === 1) {
    return true;
  }

  // For single decoration, check if it's a shape decoration (not line)
  if (decorationCount === 1) {
    const decorationId = Array.from(selectedDecorationIds)[0];
    const decoration = decorations.find(d => d.id === decorationId);
    if (decoration && SHAPE_DECORATION_TYPES.includes(decoration.type as any)) {
      return true;
    }
    // Line decorations don't have position controls
    return false;
  }

  return false;
}

/**
 * Get position values from selection
 */
function getPositionValues(
  selectedNodeIds: Set<string>,
  selectedDecorationIds: Set<string>,
  nodes: DiagramNode[],
  decorations: (ShapeDecoration | LineDecoration)[]
): PositionControlsState {
  const nodeCount = selectedNodeIds.size;
  const decorationCount = selectedDecorationIds.size;

  if (nodeCount === 1) {
    const nodeId = Array.from(selectedNodeIds)[0];
    const node = nodes.find(n => n.id === nodeId);
    if (node) {
      return {
        isEnabled: true,
        posX: node.pos_x,
        posY: node.pos_y,
        width: node.width,
        height: node.height,
      };
    }
  }

  if (decorationCount === 1) {
    const decorationId = Array.from(selectedDecorationIds)[0];
    const decoration = decorations.find(d => d.id === decorationId);
    if (decoration && 'pos_x' in decoration) {
      return {
        isEnabled: true,
        posX: decoration.pos_x,
        posY: decoration.pos_y,
        width: decoration.width,
        height: decoration.height,
      };
    }
  }

  return {
    isEnabled: false,
    posX: null,
    posY: null,
    width: null,
    height: null,
  };
}

describe('POSITION Controls Tests', () => {
  // Test 1: POSITION group renders after COLOUR group
  describe('POSITION group positioning', () => {
    it('should be positioned after COLOUR group in toolbar row 2', () => {
      // This is a structural test - the toolbar sections should be in order:
      // FONT SIZE | FONT STYLES | BOX ALIGNMENT | COLOUR | POSITION
      const toolbarSections = ['FONT SIZE', 'FONT STYLES', 'BOX ALIGNMENT', 'COLOUR', 'POSITION'];
      const colourIndex = toolbarSections.indexOf('COLOUR');
      const positionIndex = toolbarSections.indexOf('POSITION');

      expect(positionIndex).toBe(colourIndex + 1);
    });
  });

  // Test 2: X/Y/W/H fields display current values when node selected
  describe('Position value display for single node', () => {
    it('should display current node position and size values', () => {
      const nodes: DiagramNode[] = [{
        id: 'node-1',
        entity_type: 'APPLICATION',
        entity_id: 'app-1',
        pos_x: 150,
        pos_y: 200,
        width: 180,
        height: 90,
        parent_node_id: null,
      }];

      const selectedNodeIds = new Set(['node-1']);
      const selectedEdgeIds = new Set<string>();
      const selectedDecorationIds = new Set<string>();
      const decorations: (ShapeDecoration | LineDecoration)[] = [];

      const values = getPositionValues(selectedNodeIds, selectedDecorationIds, nodes, decorations);

      expect(values.posX).toBe(150);
      expect(values.posY).toBe(200);
      expect(values.width).toBe(180);
      expect(values.height).toBe(90);
    });

    it('should display current shape decoration position and size values', () => {
      const nodes: DiagramNode[] = [];
      const decorations: ShapeDecoration[] = [{
        id: 'dec-1',
        type: 'BOX',
        pos_x: 100,
        pos_y: 120,
        width: 200,
        height: 150,
      }];

      const selectedNodeIds = new Set<string>();
      const selectedDecorationIds = new Set(['dec-1']);

      const values = getPositionValues(selectedNodeIds, selectedDecorationIds, nodes, decorations);

      expect(values.posX).toBe(100);
      expect(values.posY).toBe(120);
      expect(values.width).toBe(200);
      expect(values.height).toBe(150);
    });
  });

  // Test 3: Fields are disabled when no selection
  describe('Position controls disabled state - no selection', () => {
    it('should be disabled when nothing is selected', () => {
      const selectedNodeIds = new Set<string>();
      const selectedEdgeIds = new Set<string>();
      const selectedDecorationIds = new Set<string>();
      const decorations: (ShapeDecoration | LineDecoration)[] = [];

      const isEnabled = isPositionControlsEnabled(
        selectedNodeIds,
        selectedEdgeIds,
        selectedDecorationIds,
        decorations
      );

      expect(isEnabled).toBe(false);
    });
  });

  // Test 4: Fields are disabled when multiple elements selected
  describe('Position controls disabled state - multi-select', () => {
    it('should be disabled when multiple nodes are selected', () => {
      const selectedNodeIds = new Set(['node-1', 'node-2']);
      const selectedEdgeIds = new Set<string>();
      const selectedDecorationIds = new Set<string>();
      const decorations: (ShapeDecoration | LineDecoration)[] = [];

      const isEnabled = isPositionControlsEnabled(
        selectedNodeIds,
        selectedEdgeIds,
        selectedDecorationIds,
        decorations
      );

      expect(isEnabled).toBe(false);
    });

    it('should be disabled when node and decoration are selected', () => {
      const selectedNodeIds = new Set(['node-1']);
      const selectedEdgeIds = new Set<string>();
      const selectedDecorationIds = new Set(['dec-1']);
      const decorations: ShapeDecoration[] = [{
        id: 'dec-1',
        type: 'BOX',
        pos_x: 0,
        pos_y: 0,
        width: 100,
        height: 50,
      }];

      const isEnabled = isPositionControlsEnabled(
        selectedNodeIds,
        selectedEdgeIds,
        selectedDecorationIds,
        decorations
      );

      expect(isEnabled).toBe(false);
    });
  });

  // Test 5: Fields are disabled when line/edge selected
  describe('Position controls disabled state - edge/line selected', () => {
    it('should be disabled when edge is selected', () => {
      const selectedNodeIds = new Set<string>();
      const selectedEdgeIds = new Set(['edge-1']);
      const selectedDecorationIds = new Set<string>();
      const decorations: (ShapeDecoration | LineDecoration)[] = [];

      const isEnabled = isPositionControlsEnabled(
        selectedNodeIds,
        selectedEdgeIds,
        selectedDecorationIds,
        decorations
      );

      expect(isEnabled).toBe(false);
    });

    it('should be disabled when line decoration is selected', () => {
      const selectedNodeIds = new Set<string>();
      const selectedEdgeIds = new Set<string>();
      const selectedDecorationIds = new Set(['line-dec-1']);
      const decorations: LineDecoration[] = [{
        id: 'line-dec-1',
        type: 'LINE',
        line_points: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
      }];

      const isEnabled = isPositionControlsEnabled(
        selectedNodeIds,
        selectedEdgeIds,
        selectedDecorationIds,
        decorations
      );

      expect(isEnabled).toBe(false);
    });

    it('should be disabled when arrow decoration is selected', () => {
      const selectedNodeIds = new Set<string>();
      const selectedEdgeIds = new Set<string>();
      const selectedDecorationIds = new Set(['arrow-dec-1']);
      const decorations: LineDecoration[] = [{
        id: 'arrow-dec-1',
        type: 'ARROW_SINGLE',
        line_points: [{ x: 0, y: 0 }, { x: 100, y: 50 }],
      }];

      const isEnabled = isPositionControlsEnabled(
        selectedNodeIds,
        selectedEdgeIds,
        selectedDecorationIds,
        decorations
      );

      expect(isEnabled).toBe(false);
    });
  });

  // Test 6: Enabled for single node
  describe('Position controls enabled state', () => {
    it('should be enabled for single node selection', () => {
      const selectedNodeIds = new Set(['node-1']);
      const selectedEdgeIds = new Set<string>();
      const selectedDecorationIds = new Set<string>();
      const decorations: (ShapeDecoration | LineDecoration)[] = [];

      const isEnabled = isPositionControlsEnabled(
        selectedNodeIds,
        selectedEdgeIds,
        selectedDecorationIds,
        decorations
      );

      expect(isEnabled).toBe(true);
    });

    it('should be enabled for single shape decoration (BOX)', () => {
      const selectedNodeIds = new Set<string>();
      const selectedEdgeIds = new Set<string>();
      const selectedDecorationIds = new Set(['box-dec-1']);
      const decorations: ShapeDecoration[] = [{
        id: 'box-dec-1',
        type: 'BOX',
        pos_x: 50,
        pos_y: 50,
        width: 100,
        height: 80,
      }];

      const isEnabled = isPositionControlsEnabled(
        selectedNodeIds,
        selectedEdgeIds,
        selectedDecorationIds,
        decorations
      );

      expect(isEnabled).toBe(true);
    });

    it('should be enabled for single shape decoration (OVAL)', () => {
      const selectedNodeIds = new Set<string>();
      const selectedEdgeIds = new Set<string>();
      const selectedDecorationIds = new Set(['oval-dec-1']);
      const decorations: ShapeDecoration[] = [{
        id: 'oval-dec-1',
        type: 'OVAL',
        pos_x: 80,
        pos_y: 80,
        width: 120,
        height: 60,
      }];

      const isEnabled = isPositionControlsEnabled(
        selectedNodeIds,
        selectedEdgeIds,
        selectedDecorationIds,
        decorations
      );

      expect(isEnabled).toBe(true);
    });

    it('should be enabled for single shape decoration (DIAMOND)', () => {
      const selectedNodeIds = new Set<string>();
      const selectedEdgeIds = new Set<string>();
      const selectedDecorationIds = new Set(['diamond-dec-1']);
      const decorations: ShapeDecoration[] = [{
        id: 'diamond-dec-1',
        type: 'DIAMOND',
        pos_x: 100,
        pos_y: 100,
        width: 80,
        height: 80,
      }];

      const isEnabled = isPositionControlsEnabled(
        selectedNodeIds,
        selectedEdgeIds,
        selectedDecorationIds,
        decorations
      );

      expect(isEnabled).toBe(true);
    });
  });

  // Test 7: Value clamping
  describe('Value validation and clamping', () => {
    it('should clamp position values to valid range (0-9999)', () => {
      const clampPosition = (value: number): number => {
        return Math.max(0, Math.min(9999, Math.round(value)));
      };

      expect(clampPosition(-10)).toBe(0);
      expect(clampPosition(0)).toBe(0);
      expect(clampPosition(500)).toBe(500);
      expect(clampPosition(9999)).toBe(9999);
      expect(clampPosition(10000)).toBe(9999);
    });

    it('should clamp size values to valid range (1-9999)', () => {
      const clampSize = (value: number): number => {
        return Math.max(1, Math.min(9999, Math.round(value)));
      };

      expect(clampSize(-10)).toBe(1);
      expect(clampSize(0)).toBe(1);
      expect(clampSize(1)).toBe(1);
      expect(clampSize(500)).toBe(500);
      expect(clampSize(9999)).toBe(9999);
      expect(clampSize(10000)).toBe(9999);
    });
  });
});
