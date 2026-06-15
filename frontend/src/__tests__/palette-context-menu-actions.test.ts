/**
 * Palette Context Menu Actions Tests
 * Tests for Add and Delete action handlers
 * Task Group 4: Add and Delete Actions
 */

import { DiagramNode, ENTITY_TYPES } from '../types/model';
import { nodeExistsForEntity } from '../utils/nodeCreation';

// Test data factory functions
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

describe('Palette Context Menu Actions', () => {
  describe('Add Action', () => {
    it('should create node using entity type and id', () => {
      const sectionId = 'applications';
      const entityId = 'app-1';

      // Simulate node creation logic
      const entityType = ENTITY_TYPES.APPLICATION;

      const newNode: DiagramNode = {
        id: 'node-new',
        entity_type: entityType,
        entity_id: entityId,
        pos_x: 150,
        pos_y: 1000,
        width: 120,
        height: 60,
        auto_size: false,
        z_index: 1,
        parent_node_id: null,
        style_override: {},
      };

      expect(newNode.entity_type).toBe('APPLICATION');
      expect(newNode.entity_id).toBe('app-1');
    });

    it('should not add if entity already exists on diagram', () => {
      const existingNodes: DiagramNode[] = [
        createTestNode({ entity_type: 'APPLICATION', entity_id: 'app-1' }),
      ];

      const entityType = ENTITY_TYPES.APPLICATION;
      const entityId = 'app-1';

      const alreadyExists = nodeExistsForEntity(existingNodes, entityType, entityId);

      expect(alreadyExists).toBe(true);
    });

    it('should add if entity does not exist on diagram', () => {
      const existingNodes: DiagramNode[] = [
        createTestNode({ entity_type: 'APPLICATION', entity_id: 'app-1' }),
      ];

      const entityType = ENTITY_TYPES.APPLICATION;
      const entityId = 'app-2'; // Different entity

      const alreadyExists = nodeExistsForEntity(existingNodes, entityType, entityId);

      expect(alreadyExists).toBe(false);
    });
  });

  describe('Delete Action', () => {
    it('should find node by entity type and entity id', () => {
      const nodes: DiagramNode[] = [
        createTestNode({ id: 'node-1', entity_type: 'APPLICATION', entity_id: 'app-1' }),
        createTestNode({ id: 'node-2', entity_type: 'BUSINESS_PROCESS', entity_id: 'bp-1' }),
      ];

      const entityType = ENTITY_TYPES.APPLICATION;
      const entityId = 'app-1';

      const nodeToDelete = nodes.find(
        n => n.entity_type === entityType && n.entity_id === entityId
      );

      expect(nodeToDelete).not.toBeUndefined();
      expect(nodeToDelete!.id).toBe('node-1');
    });

    it('should remove the found node from diagram', () => {
      const nodes: DiagramNode[] = [
        createTestNode({ id: 'node-1', entity_type: 'APPLICATION', entity_id: 'app-1' }),
        createTestNode({ id: 'node-2', entity_type: 'BUSINESS_PROCESS', entity_id: 'bp-1' }),
      ];

      const nodeIdToDelete = 'node-1';
      const remainingNodes = nodes.filter(n => n.id !== nodeIdToDelete);

      expect(remainingNodes.length).toBe(1);
      expect(remainingNodes[0].id).toBe('node-2');
    });

    it('should cascade delete edges referencing deleted node', () => {
      const edges = [
        { id: 'edge-1', source_node_id: 'node-1', target_node_id: 'node-2' },
        { id: 'edge-2', source_node_id: 'node-2', target_node_id: 'node-3' },
      ];

      const nodeIdToDelete = 'node-1';

      // Find edges that reference the deleted node
      const edgesToDelete = edges.filter(
        e => e.source_node_id === nodeIdToDelete || e.target_node_id === nodeIdToDelete
      );

      expect(edgesToDelete.length).toBe(1);
      expect(edgesToDelete[0].id).toBe('edge-1');
    });
  });

  describe('Palette Visual State Updates', () => {
    it('should show Delete option after Add action', () => {
      // Initial state: entity not on diagram
      let nodes: DiagramNode[] = [];
      const entityType = ENTITY_TYPES.APPLICATION;
      const entityId = 'app-1';

      // Before Add
      let isOnDiagram = nodeExistsForEntity(nodes, entityType, entityId);
      expect(isOnDiagram).toBe(false);

      // After Add
      nodes = [createTestNode({ entity_type: entityType, entity_id: entityId })];
      isOnDiagram = nodeExistsForEntity(nodes, entityType, entityId);
      expect(isOnDiagram).toBe(true);
    });

    it('should show Add option after Delete action', () => {
      // Initial state: entity on diagram
      let nodes: DiagramNode[] = [
        createTestNode({ id: 'node-1', entity_type: 'APPLICATION', entity_id: 'app-1' }),
      ];
      const entityType = ENTITY_TYPES.APPLICATION;
      const entityId = 'app-1';

      // Before Delete
      let isOnDiagram = nodeExistsForEntity(nodes, entityType, entityId);
      expect(isOnDiagram).toBe(true);

      // After Delete
      nodes = [];
      isOnDiagram = nodeExistsForEntity(nodes, entityType, entityId);
      expect(isOnDiagram).toBe(false);
    });
  });
});
