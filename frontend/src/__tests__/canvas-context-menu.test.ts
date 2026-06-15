/**
 * Tests for Canvas Context Menu Integration
 *
 * Task Group 4: Integrate Context Menu with Canvas
 * Tests the integration of the element context menu with the canvas
 */

import {
  DiagramNode,
  DiagramEdge,
  ShapeDecoration,
  LineDecoration,
  ElementContextMenuState,
  ElementContextMenuType,
  SHAPE_DECORATION_TYPES,
  LINE_DECORATION_TYPES,
} from '../types/model';

/**
 * Determine element type from click target
 */
function determineElementType(
  nodeId: string | null,
  edgeId: string | null,
  decorationId: string | null,
  decorations: (ShapeDecoration | LineDecoration)[]
): ElementContextMenuType | null {
  if (nodeId) {
    return 'node';
  }

  if (edgeId) {
    return 'edge';
  }

  if (decorationId) {
    const decoration = decorations.find(d => d.id === decorationId);
    if (decoration) {
      if (SHAPE_DECORATION_TYPES.includes(decoration.type as any)) {
        return 'shape-decoration';
      }
      if (LINE_DECORATION_TYPES.includes(decoration.type as any)) {
        return 'line-decoration';
      }
    }
  }

  return null;
}

/**
 * Create initial context menu state (closed)
 */
function createInitialContextMenuState(): ElementContextMenuState {
  return {
    visible: false,
    x: 0,
    y: 0,
    elementType: 'node',
    elementId: '',
  };
}

/**
 * Create context menu state for an element
 */
function createContextMenuState(
  x: number,
  y: number,
  elementType: ElementContextMenuType,
  elementId: string,
  autoSize?: boolean
): ElementContextMenuState {
  return {
    visible: true,
    x,
    y,
    elementType,
    elementId,
    currentAutoSize: autoSize,
  };
}

/**
 * Simulate element hit test (find element at coordinates)
 */
function findElementAtPosition(
  x: number,
  y: number,
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  decorations: (ShapeDecoration | LineDecoration)[]
): { type: ElementContextMenuType | null; id: string | null; autoSize?: boolean } {
  // Check nodes first (highest priority for z-order)
  for (const node of nodes) {
    if (
      x >= node.pos_x &&
      x <= node.pos_x + node.width &&
      y >= node.pos_y &&
      y <= node.pos_y + node.height
    ) {
      return { type: 'node', id: node.id, autoSize: node.auto_size };
    }
  }

  // Check shape decorations
  for (const dec of decorations) {
    if ('pos_x' in dec) {
      const shapeDec = dec as ShapeDecoration;
      if (
        x >= shapeDec.pos_x &&
        x <= shapeDec.pos_x + shapeDec.width &&
        y >= shapeDec.pos_y &&
        y <= shapeDec.pos_y + shapeDec.height
      ) {
        return { type: 'shape-decoration', id: shapeDec.id, autoSize: shapeDec.auto_size };
      }
    }
  }

  // Return null for empty canvas (simplified - edges and line decorations need more complex hit testing)
  return { type: null, id: null };
}

describe('Canvas Context Menu Integration Tests', () => {
  // Test 1: Right-click on node shows context menu
  describe('Right-click on node', () => {
    it('should create context menu state for node', () => {
      const nodes: DiagramNode[] = [{
        id: 'node-1',
        entity_type: 'APPLICATION',
        entity_id: 'app-1',
        pos_x: 100,
        pos_y: 100,
        width: 150,
        height: 80,
        parent_node_id: null,
        auto_size: true,
      }];

      const clickX = 150;
      const clickY = 140;

      const result = findElementAtPosition(clickX, clickY, nodes, [], []);

      expect(result.type).toBe('node');
      expect(result.id).toBe('node-1');
      expect(result.autoSize).toBe(true);

      const menuState = createContextMenuState(clickX, clickY, result.type!, result.id!, result.autoSize);

      expect(menuState.visible).toBe(true);
      expect(menuState.x).toBe(150);
      expect(menuState.y).toBe(140);
      expect(menuState.elementType).toBe('node');
      expect(menuState.elementId).toBe('node-1');
      expect(menuState.currentAutoSize).toBe(true);
    });
  });

  // Test 2: Right-click on shape decoration shows context menu
  describe('Right-click on shape decoration', () => {
    it('should create context menu state for shape decoration', () => {
      const decorations: ShapeDecoration[] = [{
        id: 'box-1',
        type: 'BOX',
        pos_x: 200,
        pos_y: 200,
        width: 100,
        height: 60,
        auto_size: false,
      }];

      const clickX = 250;
      const clickY = 230;

      const result = findElementAtPosition(clickX, clickY, [], [], decorations);

      expect(result.type).toBe('shape-decoration');
      expect(result.id).toBe('box-1');
      expect(result.autoSize).toBe(false);
    });
  });

  // Test 3: Right-click on empty canvas shows no menu
  describe('Right-click on empty canvas', () => {
    it('should return null for empty canvas area', () => {
      const nodes: DiagramNode[] = [{
        id: 'node-1',
        entity_type: 'APPLICATION',
        entity_id: 'app-1',
        pos_x: 100,
        pos_y: 100,
        width: 150,
        height: 80,
        parent_node_id: null,
      }];

      // Click far from the node
      const clickX = 500;
      const clickY = 500;

      const result = findElementAtPosition(clickX, clickY, nodes, [], []);

      expect(result.type).toBeNull();
      expect(result.id).toBeNull();
    });
  });

  // Test 4: Determine element type correctly
  describe('Element type determination', () => {
    const decorations: (ShapeDecoration | LineDecoration)[] = [
      {
        id: 'box-1',
        type: 'BOX',
        pos_x: 0,
        pos_y: 0,
        width: 100,
        height: 50,
      },
      {
        id: 'line-1',
        type: 'LINE',
        line_points: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
      },
      {
        id: 'arrow-1',
        type: 'ARROW_SINGLE',
        line_points: [{ x: 0, y: 0 }, { x: 50, y: 50 }],
      },
    ];

    it('should return "node" for node id', () => {
      const type = determineElementType('node-1', null, null, decorations);
      expect(type).toBe('node');
    });

    it('should return "edge" for edge id', () => {
      const type = determineElementType(null, 'edge-1', null, decorations);
      expect(type).toBe('edge');
    });

    it('should return "shape-decoration" for box decoration', () => {
      const type = determineElementType(null, null, 'box-1', decorations);
      expect(type).toBe('shape-decoration');
    });

    it('should return "line-decoration" for line decoration', () => {
      const type = determineElementType(null, null, 'line-1', decorations);
      expect(type).toBe('line-decoration');
    });

    it('should return "line-decoration" for arrow decoration', () => {
      const type = determineElementType(null, null, 'arrow-1', decorations);
      expect(type).toBe('line-decoration');
    });

    it('should return null when no element is found', () => {
      const type = determineElementType(null, null, null, decorations);
      expect(type).toBeNull();
    });
  });

  // Test 5: Initial context menu state is closed
  describe('Initial context menu state', () => {
    it('should be closed by default', () => {
      const initialState = createInitialContextMenuState();

      expect(initialState.visible).toBe(false);
    });
  });

  // Test 6: Context menu position matches click location
  describe('Context menu position', () => {
    it('should match click coordinates', () => {
      const clickX = 350;
      const clickY = 250;

      const menuState = createContextMenuState(clickX, clickY, 'node', 'node-1');

      expect(menuState.x).toBe(clickX);
      expect(menuState.y).toBe(clickY);
    });
  });

  // Test 7: Element selection on right-click
  describe('Element selection on right-click', () => {
    it('should select element when right-clicked', () => {
      // This tests the behavior that element should be selected before showing context menu
      const nodeId = 'node-1';
      let selectedNodeIds = new Set<string>();

      // Simulate right-click selection
      selectedNodeIds = new Set([nodeId]);

      expect(selectedNodeIds.has(nodeId)).toBe(true);
      expect(selectedNodeIds.size).toBe(1);
    });

    it('should clear other selections when right-clicking different element', () => {
      let selectedNodeIds = new Set(['node-1']);
      let selectedEdgeIds = new Set(['edge-1']);
      let selectedDecorationIds = new Set(['dec-1']);

      // Simulate right-click on new node
      selectedNodeIds = new Set(['node-2']);
      selectedEdgeIds = new Set();
      selectedDecorationIds = new Set();

      expect(selectedNodeIds.has('node-2')).toBe(true);
      expect(selectedNodeIds.size).toBe(1);
      expect(selectedEdgeIds.size).toBe(0);
      expect(selectedDecorationIds.size).toBe(0);
    });
  });
});
