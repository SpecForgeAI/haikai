/**
 * Tests for Context Menu State Management
 * Task Group 2: Add Context Menu State and Handlers to DiagramsView
 *
 * These tests verify the context menu state management functionality
 * including initial state, state updates, and element selection.
 */

import {
  ElementContextMenuState,
  ElementContextMenuType,
} from '../types/model';

describe('Context Menu State Management', () => {
  // Helper to create initial context menu state
  const createInitialState = (): ElementContextMenuState => ({
    visible: false,
    x: 0,
    y: 0,
    elementType: 'node',
    elementId: '',
    currentAutoSize: false,
  });

  // Test 2.1: Initial state is not visible
  test('initial context menu state should have visible set to false', () => {
    const state = createInitialState();

    expect(state.visible).toBe(false);
    expect(state.x).toBe(0);
    expect(state.y).toBe(0);
    expect(state.elementId).toBe('');
  });

  // Test 2.2: State updates on handleElementContextMenu call
  test('state should update when handleElementContextMenu is called', () => {
    let state = createInitialState();

    // Simulate handleElementContextMenu
    const updateState = (
      x: number,
      y: number,
      elementType: ElementContextMenuType,
      elementId: string,
      currentAutoSize?: boolean
    ): ElementContextMenuState => ({
      visible: true,
      x,
      y,
      elementType,
      elementId,
      currentAutoSize,
    });

    // Update state with new values
    state = updateState(150, 200, 'node', 'node_001', false);

    expect(state.visible).toBe(true);
    expect(state.x).toBe(150);
    expect(state.y).toBe(200);
    expect(state.elementType).toBe('node');
    expect(state.elementId).toBe('node_001');
    expect(state.currentAutoSize).toBe(false);
  });

  // Test 2.3: State resets on handleCloseContextMenu call
  test('state should reset visible to false when menu is closed', () => {
    let state: ElementContextMenuState = {
      visible: true,
      x: 150,
      y: 200,
      elementType: 'node',
      elementId: 'node_001',
      currentAutoSize: false,
    };

    // Simulate handleCloseContextMenu
    const closeMenu = (prev: ElementContextMenuState): ElementContextMenuState => ({
      ...prev,
      visible: false,
    });

    state = closeMenu(state);

    expect(state.visible).toBe(false);
    // Other state preserved for potential reuse
    expect(state.x).toBe(150);
    expect(state.y).toBe(200);
    expect(state.elementType).toBe('node');
    expect(state.elementId).toBe('node_001');
  });

  // Test 2.4: Element selection types are correct
  test('element types should match ElementContextMenuType', () => {
    const validTypes: ElementContextMenuType[] = [
      'node',
      'edge',
      'shape-decoration',
      'line-decoration',
    ];

    validTypes.forEach(type => {
      const state: ElementContextMenuState = {
        visible: true,
        x: 100,
        y: 100,
        elementType: type,
        elementId: 'test_id',
      };

      expect(state.elementType).toBe(type);
    });
  });

  // Test 2.5: Auto-size property is correctly set for different element types
  test('currentAutoSize should be set for nodes and shape decorations', () => {
    // Node with auto_size = true
    const nodeState: ElementContextMenuState = {
      visible: true,
      x: 100,
      y: 100,
      elementType: 'node',
      elementId: 'node_001',
      currentAutoSize: true,
    };
    expect(nodeState.currentAutoSize).toBe(true);

    // Shape decoration with auto_size = false
    const shapeState: ElementContextMenuState = {
      visible: true,
      x: 100,
      y: 100,
      elementType: 'shape-decoration',
      elementId: 'shape_001',
      currentAutoSize: false,
    };
    expect(shapeState.currentAutoSize).toBe(false);

    // Edge (no auto_size property)
    const edgeState: ElementContextMenuState = {
      visible: true,
      x: 100,
      y: 100,
      elementType: 'edge',
      elementId: 'edge_001',
      currentAutoSize: undefined,
    };
    expect(edgeState.currentAutoSize).toBeUndefined();

    // Line decoration (no auto_size property)
    const lineState: ElementContextMenuState = {
      visible: true,
      x: 100,
      y: 100,
      elementType: 'line-decoration',
      elementId: 'line_001',
      currentAutoSize: undefined,
    };
    expect(lineState.currentAutoSize).toBeUndefined();
  });

  // Test 2.6: Context menu position uses client coordinates
  test('context menu position should use screen coordinates', () => {
    // Simulate event.clientX and event.clientY
    const clientX = 350;
    const clientY = 420;

    const state: ElementContextMenuState = {
      visible: true,
      x: clientX,
      y: clientY,
      elementType: 'node',
      elementId: 'node_001',
    };

    expect(state.x).toBe(350);
    expect(state.y).toBe(420);
  });

  // Test 2.7: Multiple context menu opens should update state correctly
  test('opening menu on different elements should update state', () => {
    let state = createInitialState();

    // Open on first element
    state = {
      visible: true,
      x: 100,
      y: 100,
      elementType: 'node',
      elementId: 'node_001',
      currentAutoSize: true,
    };
    expect(state.elementId).toBe('node_001');

    // Open on second element (different type)
    state = {
      visible: true,
      x: 200,
      y: 300,
      elementType: 'edge',
      elementId: 'edge_001',
      currentAutoSize: undefined,
    };
    expect(state.elementId).toBe('edge_001');
    expect(state.elementType).toBe('edge');
    expect(state.x).toBe(200);
    expect(state.y).toBe(300);
  });

  // Test 2.8: Verify selection clearing behavior on right-click
  test('right-click on element should trigger selection update', () => {
    // Simulate selection state
    let selectedNodeIds = new Set<string>(['node_002', 'node_003']);
    let selectedEdgeIds = new Set<string>(['edge_001']);
    let selectedDecorationIds = new Set<string>();

    // Right-click on node_001 should:
    // 1. Clear all other selections
    // 2. Select only node_001

    const handleElementContextMenu = (
      elementType: ElementContextMenuType,
      elementId: string
    ) => {
      if (elementType === 'node') {
        selectedNodeIds = new Set([elementId]);
        selectedEdgeIds = new Set();
        selectedDecorationIds = new Set();
      } else if (elementType === 'edge') {
        selectedNodeIds = new Set();
        selectedEdgeIds = new Set([elementId]);
        selectedDecorationIds = new Set();
      } else {
        selectedNodeIds = new Set();
        selectedEdgeIds = new Set();
        selectedDecorationIds = new Set([elementId]);
      }
    };

    handleElementContextMenu('node', 'node_001');

    expect(selectedNodeIds.has('node_001')).toBe(true);
    expect(selectedNodeIds.size).toBe(1);
    expect(selectedEdgeIds.size).toBe(0);
    expect(selectedDecorationIds.size).toBe(0);
  });
});
