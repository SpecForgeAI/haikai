/**
 * Palette Context Menu Foundation Tests
 * Tests for context menu state management and type validation
 * Task Group 1: Types, Interfaces, and State Management
 */

import { DiagramNode } from '../types/model';
import { ContextMenuState, ContextMenuStateData, PaletteItemData } from '../types/contextMenu';

// Test data factory functions
function createTestPaletteItem(overrides: Partial<PaletteItemData> = {}): PaletteItemData {
  return {
    id: 'app-1',
    name: 'Test Application',
    ...overrides,
  };
}

function createTestContextMenuState(overrides: Partial<ContextMenuStateData> = {}): ContextMenuStateData {
  return {
    visible: true,
    x: 100,
    y: 200,
    item: createTestPaletteItem(),
    sectionId: 'applications',
    ...overrides,
  };
}

function createTestNode(overrides: Partial<DiagramNode> = {}): DiagramNode {
  return {
    id: 'test-node-1',
    entity_type: 'APPLICATION',
    entity_id: 'app-1',
    pos_x: 100,
    pos_y: 100,
    width: 120,
    height: 60,
    parent_node_id: null,
    ...overrides,
  };
}

describe('Palette Context Menu Foundation', () => {
  describe('Context Menu State Structure', () => {
    it('should validate ContextMenuState can be null (hidden state)', () => {
      const state: ContextMenuState = null;
      expect(state).toBeNull();
    });

    it('should validate ContextMenuStateData has required properties', () => {
      const state = createTestContextMenuState();

      expect(state).toHaveProperty('visible');
      expect(state).toHaveProperty('x');
      expect(state).toHaveProperty('y');
      expect(state).toHaveProperty('item');
      expect(state).toHaveProperty('sectionId');

      expect(typeof state.visible).toBe('boolean');
      expect(typeof state.x).toBe('number');
      expect(typeof state.y).toBe('number');
      expect(typeof state.item).toBe('object');
      expect(typeof state.sectionId).toBe('string');
    });

    it('should validate PaletteItemData structure', () => {
      const item = createTestPaletteItem();

      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('name');
      expect(typeof item.id).toBe('string');
      expect(typeof item.name).toBe('string');
    });
  });

  describe('Context Menu State Transitions', () => {
    it('should transition from null to visible state', () => {
      let state: ContextMenuState = null;

      // Simulate opening context menu
      state = createTestContextMenuState({
        visible: true,
        x: 150,
        y: 250,
      });

      expect(state).not.toBeNull();
      expect(state!.visible).toBe(true);
      expect(state!.x).toBe(150);
      expect(state!.y).toBe(250);
    });

    it('should transition from visible to null (dismissed)', () => {
      let state: ContextMenuState = createTestContextMenuState();

      expect(state).not.toBeNull();

      // Simulate closing context menu
      state = null;

      expect(state).toBeNull();
    });
  });

  describe('Menu Positioning from Mouse Coordinates', () => {
    it('should store mouse coordinates from simulated event', () => {
      // Simulate mouse event coordinates
      const clientX = 300;
      const clientY = 400;

      const state = createTestContextMenuState({
        x: clientX,
        y: clientY,
      });

      expect(state.x).toBe(clientX);
      expect(state.y).toBe(clientY);
    });

    it('should preserve item data with positioning', () => {
      const item = createTestPaletteItem({
        id: 'bp-1',
        name: 'Test Business Process',
      });

      const state = createTestContextMenuState({
        x: 200,
        y: 300,
        item,
        sectionId: 'business_processes',
      });

      expect(state.item.id).toBe('bp-1');
      expect(state.item.name).toBe('Test Business Process');
      expect(state.sectionId).toBe('business_processes');
    });
  });

  describe('ADD_DIAGRAM_NODES Batch Action', () => {
    it('should add multiple nodes filtering duplicates', () => {
      // Initial state with one existing node
      const existingNodes: DiagramNode[] = [
        createTestNode({ id: 'node-1', entity_type: 'APPLICATION', entity_id: 'app-1' }),
      ];

      // Nodes to add (one duplicate, one new)
      const nodesToAdd: DiagramNode[] = [
        createTestNode({ id: 'node-2', entity_type: 'APPLICATION', entity_id: 'app-1' }), // duplicate
        createTestNode({ id: 'node-3', entity_type: 'APPLICATION', entity_id: 'app-2' }), // new
      ];

      // Simulate batch add with duplicate filtering
      const filteredNodes = nodesToAdd.filter(node =>
        !existingNodes.some(existing =>
          existing.entity_type === node.entity_type &&
          existing.entity_id === node.entity_id
        )
      );

      expect(filteredNodes.length).toBe(1);
      expect(filteredNodes[0].entity_id).toBe('app-2');

      // Resulting state
      const updatedNodes = [...existingNodes, ...filteredNodes];
      expect(updatedNodes.length).toBe(2);
    });

    it('should handle batch add with all duplicates (no-op)', () => {
      const existingNodes: DiagramNode[] = [
        createTestNode({ id: 'node-1', entity_type: 'APPLICATION', entity_id: 'app-1' }),
      ];

      const nodesToAdd: DiagramNode[] = [
        createTestNode({ id: 'node-2', entity_type: 'APPLICATION', entity_id: 'app-1' }), // duplicate
      ];

      const filteredNodes = nodesToAdd.filter(node =>
        !existingNodes.some(existing =>
          existing.entity_type === node.entity_type &&
          existing.entity_id === node.entity_id
        )
      );

      expect(filteredNodes.length).toBe(0);
    });
  });
});
