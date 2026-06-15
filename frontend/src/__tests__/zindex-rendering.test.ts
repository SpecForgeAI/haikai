/**
 * Tests for Z-Index Rendering and Persistence
 *
 * Task Group 5: Z-Index Rendering and Persistence
 * Tests z-index utilities and rendering order
 */

import {
  DiagramNode,
  DiagramEdge,
  ShapeDecoration,
  LineDecoration,
  Decoration,
} from '../types/model';

// Z-Index defaults from spec
const Z_INDEX_DEFAULTS = {
  BOX_DECORATION: 50,
  DIAGRAM_NODE: 100,
  DIAGRAM_EDGE: 110,
  LINE_DECORATION: 120,
};

/**
 * Get the default z-index for a diagram element
 */
function getDefaultZIndex(
  elementType: 'node' | 'edge' | 'shape-decoration' | 'line-decoration'
): number {
  switch (elementType) {
    case 'node':
      return Z_INDEX_DEFAULTS.DIAGRAM_NODE;
    case 'edge':
      return Z_INDEX_DEFAULTS.DIAGRAM_EDGE;
    case 'shape-decoration':
      return Z_INDEX_DEFAULTS.BOX_DECORATION;
    case 'line-decoration':
      return Z_INDEX_DEFAULTS.LINE_DECORATION;
    default:
      return 100;
  }
}

/**
 * Get z-index bounds across all diagram elements
 */
function getZIndexBounds(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  decorations: Decoration[]
): { min: number; max: number } {
  const zIndices: number[] = [];

  // Collect z-indices from nodes
  for (const node of nodes) {
    zIndices.push(node.z_index ?? Z_INDEX_DEFAULTS.DIAGRAM_NODE);
  }

  // Collect z-indices from edges
  for (const edge of edges) {
    zIndices.push(edge.z_index ?? Z_INDEX_DEFAULTS.DIAGRAM_EDGE);
  }

  // Collect z-indices from decorations
  for (const dec of decorations) {
    if ('pos_x' in dec) {
      // Shape decoration
      zIndices.push(dec.z_index ?? Z_INDEX_DEFAULTS.BOX_DECORATION);
    } else {
      // Line decoration
      zIndices.push(dec.z_index ?? Z_INDEX_DEFAULTS.LINE_DECORATION);
    }
  }

  if (zIndices.length === 0) {
    return { min: 0, max: 0 };
  }

  return {
    min: Math.min(...zIndices),
    max: Math.max(...zIndices),
  };
}

/**
 * Calculate new z-index based on action
 */
function calculateNewZIndex(
  currentZIndex: number,
  action: 'bring-forward' | 'send-backward' | 'bring-to-front' | 'send-to-back',
  bounds: { min: number; max: number }
): number {
  switch (action) {
    case 'bring-forward':
      return currentZIndex + 1;
    case 'send-backward':
      return Math.max(1, currentZIndex - 1);
    case 'bring-to-front':
      return bounds.max + 1;
    case 'send-to-back':
      return Math.max(1, bounds.min - 1);
    default:
      return currentZIndex;
  }
}

interface RenderableElement {
  id: string;
  type: 'node' | 'edge' | 'shape-decoration' | 'line-decoration';
  zIndex: number;
  element: DiagramNode | DiagramEdge | Decoration;
}

/**
 * Collect all elements and sort by z-index for rendering
 */
function getSortedRenderOrder(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  decorations: Decoration[]
): RenderableElement[] {
  const elements: RenderableElement[] = [];

  // Add nodes
  for (const node of nodes) {
    elements.push({
      id: node.id,
      type: 'node',
      zIndex: node.z_index ?? Z_INDEX_DEFAULTS.DIAGRAM_NODE,
      element: node,
    });
  }

  // Add edges
  for (const edge of edges) {
    elements.push({
      id: edge.id,
      type: 'edge',
      zIndex: edge.z_index ?? Z_INDEX_DEFAULTS.DIAGRAM_EDGE,
      element: edge,
    });
  }

  // Add decorations
  for (const dec of decorations) {
    if ('pos_x' in dec) {
      elements.push({
        id: dec.id,
        type: 'shape-decoration',
        zIndex: dec.z_index ?? Z_INDEX_DEFAULTS.BOX_DECORATION,
        element: dec,
      });
    } else {
      elements.push({
        id: dec.id,
        type: 'line-decoration',
        zIndex: dec.z_index ?? Z_INDEX_DEFAULTS.LINE_DECORATION,
        element: dec,
      });
    }
  }

  // Sort by z-index (lowest first = rendered behind)
  return elements.sort((a, b) => a.zIndex - b.zIndex);
}

describe('Z-Index Rendering Tests', () => {
  // Test 1: Elements render in z_index order
  describe('Element render order', () => {
    it('should sort elements by z_index (lowest first)', () => {
      const nodes: DiagramNode[] = [
        {
          id: 'node-1',
          entity_type: 'APPLICATION',
          entity_id: 'app-1',
          pos_x: 0,
          pos_y: 0,
          width: 100,
          height: 50,
          parent_node_id: null,
          z_index: 100,
        },
        {
          id: 'node-2',
          entity_type: 'SERVICE',
          entity_id: 'svc-1',
          pos_x: 50,
          pos_y: 50,
          width: 100,
          height: 50,
          parent_node_id: null,
          z_index: 150,
        },
      ];

      const decorations: ShapeDecoration[] = [
        {
          id: 'box-1',
          type: 'BOX',
          pos_x: 0,
          pos_y: 0,
          width: 200,
          height: 150,
          z_index: 50,
        },
      ];

      const sorted = getSortedRenderOrder(nodes, [], decorations);

      expect(sorted[0].id).toBe('box-1'); // z=50
      expect(sorted[1].id).toBe('node-1'); // z=100
      expect(sorted[2].id).toBe('node-2'); // z=150
    });
  });

  // Test 2: Higher z_index renders on top
  describe('Higher z_index renders on top', () => {
    it('should place higher z_index elements later in render order', () => {
      const nodes: DiagramNode[] = [
        {
          id: 'bottom-node',
          entity_type: 'APPLICATION',
          entity_id: 'app-1',
          pos_x: 0,
          pos_y: 0,
          width: 100,
          height: 50,
          parent_node_id: null,
          z_index: 10,
        },
        {
          id: 'top-node',
          entity_type: 'APPLICATION',
          entity_id: 'app-2',
          pos_x: 0,
          pos_y: 0,
          width: 100,
          height: 50,
          parent_node_id: null,
          z_index: 200,
        },
      ];

      const sorted = getSortedRenderOrder(nodes, [], []);
      const lastElement = sorted[sorted.length - 1];

      expect(lastElement.id).toBe('top-node');
      expect(lastElement.zIndex).toBe(200);
    });
  });

  // Test 3: "Bring to Front" results in highest z_index
  describe('Bring to Front action', () => {
    it('should set z_index higher than current max', () => {
      const bounds = { min: 50, max: 150 };
      const currentZIndex = 100;

      const newZIndex = calculateNewZIndex(currentZIndex, 'bring-to-front', bounds);

      expect(newZIndex).toBe(151);
      expect(newZIndex).toBeGreaterThan(bounds.max);
    });
  });

  // Test 4: "Send to Back" results in lowest z_index
  describe('Send to Back action', () => {
    it('should set z_index lower than current min', () => {
      const bounds = { min: 50, max: 150 };
      const currentZIndex = 100;

      const newZIndex = calculateNewZIndex(currentZIndex, 'send-to-back', bounds);

      expect(newZIndex).toBe(49);
      expect(newZIndex).toBeLessThan(bounds.min);
    });

    it('should not go below 1', () => {
      const bounds = { min: 1, max: 150 };
      const currentZIndex = 5;

      const newZIndex = calculateNewZIndex(currentZIndex, 'send-to-back', bounds);

      // min - 1 would be 0, but we clamp to 1
      expect(newZIndex).toBeGreaterThanOrEqual(1);
    });
  });

  // Test 5: Default z-index values
  describe('Default z-index values', () => {
    it('should use correct defaults for each element type', () => {
      expect(getDefaultZIndex('node')).toBe(100);
      expect(getDefaultZIndex('edge')).toBe(110);
      expect(getDefaultZIndex('shape-decoration')).toBe(50);
      expect(getDefaultZIndex('line-decoration')).toBe(120);
    });
  });

  // Test 6: Z-index bounds calculation
  describe('Z-index bounds calculation', () => {
    it('should calculate correct min and max', () => {
      const nodes: DiagramNode[] = [
        {
          id: 'node-1',
          entity_type: 'APPLICATION',
          entity_id: 'app-1',
          pos_x: 0,
          pos_y: 0,
          width: 100,
          height: 50,
          parent_node_id: null,
          z_index: 100,
        },
      ];

      const edges: DiagramEdge[] = [
        {
          id: 'edge-1',
          relationship_type: 'DATA_MOVEMENT',
          relationship_id: 'dm-1',
          source_node_id: 'node-1',
          target_node_id: 'node-2',
          edge_points: [],
          z_index: 200,
        },
      ];

      const decorations: ShapeDecoration[] = [
        {
          id: 'box-1',
          type: 'BOX',
          pos_x: 0,
          pos_y: 0,
          width: 100,
          height: 50,
          z_index: 25,
        },
      ];

      const bounds = getZIndexBounds(nodes, edges, decorations);

      expect(bounds.min).toBe(25);
      expect(bounds.max).toBe(200);
    });

    it('should return 0,0 for empty diagram', () => {
      const bounds = getZIndexBounds([], [], []);

      expect(bounds.min).toBe(0);
      expect(bounds.max).toBe(0);
    });

    it('should use defaults when z_index is undefined', () => {
      const nodes: DiagramNode[] = [
        {
          id: 'node-1',
          entity_type: 'APPLICATION',
          entity_id: 'app-1',
          pos_x: 0,
          pos_y: 0,
          width: 100,
          height: 50,
          parent_node_id: null,
          // z_index is undefined
        },
      ];

      const bounds = getZIndexBounds(nodes, [], []);

      expect(bounds.min).toBe(100); // default DIAGRAM_NODE z-index
      expect(bounds.max).toBe(100);
    });
  });

  // Test 7: Bring Forward and Send Backward
  describe('Bring Forward and Send Backward actions', () => {
    it('should increment z_index by 1 for bring-forward', () => {
      const bounds = { min: 50, max: 150 };
      const currentZIndex = 100;

      const newZIndex = calculateNewZIndex(currentZIndex, 'bring-forward', bounds);

      expect(newZIndex).toBe(101);
    });

    it('should decrement z_index by 1 for send-backward', () => {
      const bounds = { min: 50, max: 150 };
      const currentZIndex = 100;

      const newZIndex = calculateNewZIndex(currentZIndex, 'send-backward', bounds);

      expect(newZIndex).toBe(99);
    });

    it('should not go below 1 for send-backward', () => {
      const bounds = { min: 1, max: 150 };
      const currentZIndex = 1;

      const newZIndex = calculateNewZIndex(currentZIndex, 'send-backward', bounds);

      expect(newZIndex).toBe(1);
    });
  });

  // Test 8: Mixed element types in render order
  describe('Mixed element types in render order', () => {
    it('should correctly interleave different element types by z_index', () => {
      const nodes: DiagramNode[] = [
        {
          id: 'node-1',
          entity_type: 'APPLICATION',
          entity_id: 'app-1',
          pos_x: 0,
          pos_y: 0,
          width: 100,
          height: 50,
          parent_node_id: null,
          z_index: 100,
        },
      ];

      const edges: DiagramEdge[] = [
        {
          id: 'edge-1',
          relationship_type: 'DATA_MOVEMENT',
          relationship_id: 'dm-1',
          source_node_id: 'node-1',
          target_node_id: 'node-2',
          edge_points: [],
          z_index: 75,
        },
      ];

      const decorations: Decoration[] = [
        {
          id: 'box-1',
          type: 'BOX',
          pos_x: 0,
          pos_y: 0,
          width: 100,
          height: 50,
          z_index: 50,
        } as ShapeDecoration,
        {
          id: 'line-1',
          type: 'LINE',
          line_points: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
          z_index: 125,
        } as LineDecoration,
      ];

      const sorted = getSortedRenderOrder(nodes, edges, decorations);

      // Expected order: box-1 (50), edge-1 (75), node-1 (100), line-1 (125)
      expect(sorted[0].id).toBe('box-1');
      expect(sorted[1].id).toBe('edge-1');
      expect(sorted[2].id).toBe('node-1');
      expect(sorted[3].id).toBe('line-1');
    });
  });
});
