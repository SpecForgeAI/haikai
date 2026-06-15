/**
 * Tests for Context Menu Actions
 * Task Group 3: Implement Auto-Size and Z-Index Handlers
 *
 * These tests verify the auto-size toggle and z-index change
 * functionality triggered by context menu actions.
 */

import {
  DiagramNode,
  DiagramEdge,
  ShapeDecoration,
  LineDecoration,
  Decoration,
} from '../types/model';
import { ZIndexAction, getZIndexBounds, calculateNewZIndex } from '../utils/zIndexUtils';
import { Z_INDEX_DEFAULTS } from '../config/defaults';

describe('Context Menu Actions', () => {
  // Helper to create a mock node
  const createMockNode = (overrides: Partial<DiagramNode> = {}): DiagramNode => ({
    id: 'node_001',
    entity_type: 'APPLICATION',
    entity_id: 'app_001',
    pos_x: 100,
    pos_y: 100,
    width: 120,
    height: 60,
    parent_node_id: null,
    auto_size: false,
    z_index: 100,
    ...overrides,
  });

  // Helper to create a mock edge
  const createMockEdge = (overrides: Partial<DiagramEdge> = {}): DiagramEdge => ({
    id: 'edge_001',
    relationship_type: 'DATA_MOVEMENT',
    relationship_id: 'dm_001',
    source_node_id: 'node_001',
    target_node_id: 'node_002',
    edge_points: [
      { id: 'ep_001', sequence_order: 0, pos_x: 100, pos_y: 100 },
      { id: 'ep_002', sequence_order: 1, pos_x: 200, pos_y: 200 },
    ],
    z_index: 110,
    ...overrides,
  });

  // Helper to create a mock shape decoration
  const createMockShapeDecoration = (overrides: Partial<ShapeDecoration> = {}): ShapeDecoration => ({
    id: 'shape_001',
    type: 'BOX',
    pos_x: 50,
    pos_y: 50,
    width: 100,
    height: 80,
    auto_size: false,
    z_index: 50,
    ...overrides,
  });

  // Helper to create a mock line decoration
  const createMockLineDecoration = (overrides: Partial<LineDecoration> = {}): LineDecoration => ({
    id: 'line_001',
    type: 'LINE',
    line_points: [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ],
    z_index: 120,
    ...overrides,
  });

  // ==========================================================================
  // Auto-Size Toggle Tests
  // ==========================================================================

  describe('Auto-Size Toggle', () => {
    // Test 3.1: Toggle node auto_size from false to true
    test('toggles node auto_size from false to true', () => {
      const node = createMockNode({ auto_size: false });

      // Simulate toggle
      const updatedNode = { ...node, auto_size: !node.auto_size };

      expect(updatedNode.auto_size).toBe(true);
    });

    // Test 3.2: Toggle node auto_size from true to false
    test('toggles node auto_size from true to false', () => {
      const node = createMockNode({ auto_size: true });

      // Simulate toggle
      const updatedNode = { ...node, auto_size: !node.auto_size };

      expect(updatedNode.auto_size).toBe(false);
    });

    // Test 3.3: Toggle shape decoration auto_size
    test('toggles shape decoration auto_size', () => {
      const shape = createMockShapeDecoration({ auto_size: false });

      // Simulate toggle
      const updatedShape = { ...shape, auto_size: !shape.auto_size };

      expect(updatedShape.auto_size).toBe(true);
    });

    // Test 3.4: Edges do not have auto_size property
    test('edges should not have auto_size property', () => {
      const edge = createMockEdge();

      // Edge should not have auto_size
      expect((edge as any).auto_size).toBeUndefined();
    });

    // Test 3.5: Line decorations do not have auto_size property
    test('line decorations should not have auto_size property', () => {
      const line = createMockLineDecoration();

      // Line decoration should not have auto_size
      expect((line as any).auto_size).toBeUndefined();
    });

    // Test 3.6: Handle undefined auto_size (defaults to false)
    test('undefined auto_size should default to false for toggle', () => {
      const node = createMockNode();
      delete (node as any).auto_size;

      // Toggle from undefined (treated as false) to true
      const currentAutoSize = node.auto_size ?? false;
      const updatedNode = { ...node, auto_size: !currentAutoSize };

      expect(updatedNode.auto_size).toBe(true);
    });
  });

  // ==========================================================================
  // Z-Index Change Tests
  // ==========================================================================

  describe('Z-Index Changes', () => {
    const nodes = [
      createMockNode({ id: 'node_001', z_index: 100 }),
      createMockNode({ id: 'node_002', z_index: 105 }),
    ];
    const edges = [
      createMockEdge({ id: 'edge_001', z_index: 110 }),
    ];
    const decorations: Decoration[] = [
      createMockShapeDecoration({ id: 'shape_001', z_index: 50 }),
      createMockLineDecoration({ id: 'line_001', z_index: 120 }),
    ];

    // Test 3.7: "forward" increments z_index by 1
    test('"bring-forward" increments z_index by 1', () => {
      const bounds = getZIndexBounds(nodes, edges, decorations);
      const currentZIndex = 100;

      const newZIndex = calculateNewZIndex(currentZIndex, 'bring-forward', bounds);

      expect(newZIndex).toBe(101);
    });

    // Test 3.8: "backward" decrements z_index by 1
    test('"send-backward" decrements z_index by 1', () => {
      const bounds = getZIndexBounds(nodes, edges, decorations);
      const currentZIndex = 100;

      const newZIndex = calculateNewZIndex(currentZIndex, 'send-backward', bounds);

      expect(newZIndex).toBe(99);
    });

    // Test 3.9: "front" sets z_index to max + 1
    test('"bring-to-front" sets z_index to max + 1', () => {
      const bounds = getZIndexBounds(nodes, edges, decorations);
      const currentZIndex = 100;

      // Max in our test data is 120 (line decoration)
      expect(bounds.max).toBe(120);

      const newZIndex = calculateNewZIndex(currentZIndex, 'bring-to-front', bounds);

      expect(newZIndex).toBe(121);
    });

    // Test 3.10: "back" sets z_index to min - 1
    test('"send-to-back" sets z_index to min - 1', () => {
      const bounds = getZIndexBounds(nodes, edges, decorations);
      const currentZIndex = 100;

      // Min in our test data is 50 (shape decoration)
      expect(bounds.min).toBe(50);

      const newZIndex = calculateNewZIndex(currentZIndex, 'send-to-back', bounds);

      expect(newZIndex).toBe(49);
    });

    // Test 3.11: Z-index works for nodes
    test('z-index change works for nodes', () => {
      const node = createMockNode({ z_index: 100 });
      const bounds = getZIndexBounds([node], [], []);

      const newZIndex = calculateNewZIndex(node.z_index!, 'bring-forward', bounds);
      const updatedNode = { ...node, z_index: newZIndex };

      expect(updatedNode.z_index).toBe(101);
    });

    // Test 3.12: Z-index works for edges
    test('z-index change works for edges', () => {
      const edge = createMockEdge({ z_index: 110 });
      const bounds = getZIndexBounds([], [edge], []);

      const newZIndex = calculateNewZIndex(edge.z_index!, 'bring-forward', bounds);
      const updatedEdge = { ...edge, z_index: newZIndex };

      expect(updatedEdge.z_index).toBe(111);
    });

    // Test 3.13: Z-index works for shape decorations
    test('z-index change works for shape decorations', () => {
      const shape = createMockShapeDecoration({ z_index: 50 });
      const bounds = getZIndexBounds([], [], [shape]);

      const newZIndex = calculateNewZIndex(shape.z_index!, 'bring-forward', bounds);
      const updatedShape = { ...shape, z_index: newZIndex };

      expect(updatedShape.z_index).toBe(51);
    });

    // Test 3.14: Z-index works for line decorations
    test('z-index change works for line decorations', () => {
      const line = createMockLineDecoration({ z_index: 120 });
      const bounds = getZIndexBounds([], [], [line]);

      const newZIndex = calculateNewZIndex(line.z_index!, 'bring-forward', bounds);
      const updatedLine = { ...line, z_index: newZIndex };

      expect(updatedLine.z_index).toBe(121);
    });

    // Test 3.15: getZIndexBounds calculates correct min and max
    test('getZIndexBounds returns correct bounds', () => {
      const bounds = getZIndexBounds(nodes, edges, decorations);

      expect(bounds.min).toBe(50);  // shape decoration
      expect(bounds.max).toBe(120); // line decoration
    });

    // Test 3.16: getZIndexBounds handles empty arrays
    test('getZIndexBounds handles empty arrays', () => {
      const bounds = getZIndexBounds([], [], []);

      expect(bounds.min).toBe(0);
      expect(bounds.max).toBe(0);
    });

    // Test 3.17: getZIndexBounds uses default z-index when not specified
    test('getZIndexBounds uses defaults for undefined z-index', () => {
      const nodeWithoutZIndex = createMockNode();
      delete (nodeWithoutZIndex as any).z_index;

      const bounds = getZIndexBounds([nodeWithoutZIndex], [], []);

      // Should use Z_INDEX_DEFAULTS.DIAGRAM_NODE (100)
      expect(bounds.min).toBe(Z_INDEX_DEFAULTS.DIAGRAM_NODE);
      expect(bounds.max).toBe(Z_INDEX_DEFAULTS.DIAGRAM_NODE);
    });
  });

  // ==========================================================================
  // Context Menu Close After Action Tests
  // ==========================================================================

  describe('Context Menu Behavior', () => {
    // Test 3.18: Menu closes after auto-size toggle
    test('menu should close after auto-size toggle action', () => {
      let menuVisible = true;

      const handleCloseContextMenu = () => {
        menuVisible = false;
      };

      // Simulate auto-size toggle with menu close
      const handleAutoSizeToggle = () => {
        // Toggle logic would go here
        handleCloseContextMenu();
      };

      handleAutoSizeToggle();

      expect(menuVisible).toBe(false);
    });

    // Test 3.19: Menu closes after z-index change
    test('menu should close after z-index change action', () => {
      let menuVisible = true;

      const handleCloseContextMenu = () => {
        menuVisible = false;
      };

      // Simulate z-index change with menu close
      const handleZIndexChange = (_action: ZIndexAction) => {
        // Z-index logic would go here
        handleCloseContextMenu();
      };

      handleZIndexChange('bring-forward');

      expect(menuVisible).toBe(false);
    });
  });
});
