/**
 * Fixed Spawn Position Tests
 * Tests for the fixed node spawn position at (100,100) feature
 *
 * This test file verifies that all node creation functions return a fixed
 * position of (100, 100) regardless of the viewportCenter input.
 */

import { describe, it, expect } from 'vitest';
import {
  createDiagramNodeFromEntity,
  createERDNodeFromEntity,
  calculateNodePlacement,
  DEFAULT_NODE_SPAWN_ORIGIN,
} from '../utils/nodeCreation';
import { ENTITY_TYPES, MetaModel } from '../types/model';

// ============================================================================
// Task Group 1.1: Fixed Spawn Position Tests
// ============================================================================

describe('Fixed Spawn Position - Node Creation Utilities', () => {
  describe('DEFAULT_NODE_SPAWN_ORIGIN constant', () => {
    it('should export DEFAULT_NODE_SPAWN_ORIGIN with x=100 and y=100', () => {
      expect(DEFAULT_NODE_SPAWN_ORIGIN).toBeDefined();
      expect(DEFAULT_NODE_SPAWN_ORIGIN.x).toBe(100);
      expect(DEFAULT_NODE_SPAWN_ORIGIN.y).toBe(100);
    });
  });

  describe('calculateNodePlacement', () => {
    it('should return pos_x=100 and pos_y=100 unconditionally', () => {
      const existingNodes: any[] = [];
      const result = calculateNodePlacement(existingNodes);

      expect(result.pos_x).toBe(100);
      expect(result.pos_y).toBe(100);
    });

    it('should return pos_x=100 and pos_y=100 regardless of existing nodes count', () => {
      // With 5 existing nodes (previously would have offset)
      const existingNodes = [
        { id: 'node-1', z_index: 1 },
        { id: 'node-2', z_index: 2 },
        { id: 'node-3', z_index: 3 },
        { id: 'node-4', z_index: 4 },
        { id: 'node-5', z_index: 5 },
      ] as any[];

      const result = calculateNodePlacement(existingNodes);

      expect(result.pos_x).toBe(100);
      expect(result.pos_y).toBe(100);
    });
  });

  describe('createDiagramNodeFromEntity', () => {
    it('should return pos_x=100, pos_y=100 regardless of viewportCenter input', () => {
      const existingNodes: any[] = [];
      const viewportCenter = { x: 600, y: 500 };

      const node = createDiagramNodeFromEntity(
        ENTITY_TYPES.STATE,
        'state-123',
        existingNodes,
        viewportCenter
      );

      expect(node.pos_x).toBe(100);
      expect(node.pos_y).toBe(100);
    });

    it('should return pos_x=100, pos_y=100 with various viewportCenter values', () => {
      const existingNodes: any[] = [];

      // Test with various viewport centers
      const viewportCenters = [
        { x: 0, y: 0 },
        { x: 1000, y: 1000 },
        { x: 500, y: 400 },
        { x: 3000, y: 2000 },
      ];

      for (const viewportCenter of viewportCenters) {
        const node = createDiagramNodeFromEntity(
          ENTITY_TYPES.APPLICATION,
          `app-${viewportCenter.x}`,
          existingNodes,
          viewportCenter
        );

        expect(node.pos_x).toBe(100);
        expect(node.pos_y).toBe(100);
      }
    });

    it('should return pos_x=100, pos_y=100 when viewportCenter is omitted', () => {
      const existingNodes: any[] = [];

      const node = createDiagramNodeFromEntity(
        ENTITY_TYPES.BUSINESS_PROCESS,
        'bp-123',
        existingNodes
        // No viewportCenter provided
      );

      expect(node.pos_x).toBe(100);
      expect(node.pos_y).toBe(100);
    });

    it('should preserve all other node properties', () => {
      const existingNodes = [{ id: 'node-1', z_index: 5 }] as any[];
      const viewportCenter = { x: 600, y: 500 };

      const node = createDiagramNodeFromEntity(
        ENTITY_TYPES.STATE,
        'state-abc',
        existingNodes,
        viewportCenter
      );

      // Position should be fixed
      expect(node.pos_x).toBe(100);
      expect(node.pos_y).toBe(100);

      // Other properties should be preserved
      expect(node.entity_type).toBe(ENTITY_TYPES.STATE);
      expect(node.entity_id).toBe('state-abc');
      expect(node.id).toContain('node-');
      expect(node.z_index).toBe(6); // Max existing + 1
      expect(node.width).toBeDefined();
      expect(node.height).toBeDefined();
    });
  });

  describe('createERDNodeFromEntity', () => {
    // Mock minimal metaModel for ERD node creation
    // Note: uses logical_entity_id (not logical_data_entity_id) to match erdUtils.ts
    const mockMetaModel: MetaModel = {
      entities: {
        logical_data_entities: [
          { id: 'lde-1', name: 'Customer', description: '', tags: '' },
        ],
        logical_data_attributes: [
          {
            id: 'attr-1',
            name: 'id',
            logical_entity_id: 'lde-1', // matches erdUtils.ts filtering
            data_type: 'INTEGER',
            description: '',
            is_primary_key: true,
            is_nullable: false,
            tags: '',
          },
          {
            id: 'attr-2',
            name: 'name',
            logical_entity_id: 'lde-1', // matches erdUtils.ts filtering
            data_type: 'VARCHAR',
            description: '',
            is_primary_key: false,
            is_nullable: true,
            tags: '',
          },
        ] as any[],
        physical_data_entities: [],
        physical_data_attributes: [],
        applications: [],
        app_components: [],
        services: [],
        interfaces: [],
        endpoints: [],
        business_users: [],
        business_processes: [],
        process_activities: [],
        application_points: [],
        business_points: [],
        interactions: [],
        states: [],
        activities: [],
        activity_partitions: [],
      },
      relationships: {
        logical_data_entity_relationships: [],
        logical_data_entity_physical_data_entities: [],
        logical_data_attribute_physical_data_attributes: [],
        data_movements: [],
        business_user_business_points: [],
        application_point_business_points: [],
        state_transitions: [],
        activity_flows: [],
      },
    };

    it('should return pos_x=100, pos_y=100 regardless of viewportCenter input', () => {
      const existingNodes: any[] = [];
      const viewportCenter = { x: 600, y: 500 };

      const node = createERDNodeFromEntity(
        ENTITY_TYPES.LOGICAL_DATA_ENTITY,
        'lde-1',
        existingNodes,
        mockMetaModel,
        viewportCenter
      );

      expect(node).not.toBeNull();
      expect(node!.pos_x).toBe(100);
      expect(node!.pos_y).toBe(100);
    });

    it('should return pos_x=100, pos_y=100 with various viewportCenter values', () => {
      const existingNodes: any[] = [];

      const viewportCenters = [
        { x: 0, y: 0 },
        { x: 1000, y: 1000 },
        { x: 500, y: 400 },
      ];

      for (const viewportCenter of viewportCenters) {
        const node = createERDNodeFromEntity(
          ENTITY_TYPES.LOGICAL_DATA_ENTITY,
          'lde-1',
          existingNodes,
          mockMetaModel,
          viewportCenter
        );

        expect(node).not.toBeNull();
        expect(node!.pos_x).toBe(100);
        expect(node!.pos_y).toBe(100);
      }
    });

    it('should return pos_x=100, pos_y=100 when viewportCenter is omitted', () => {
      const existingNodes: any[] = [];

      const node = createERDNodeFromEntity(
        ENTITY_TYPES.LOGICAL_DATA_ENTITY,
        'lde-1',
        existingNodes,
        mockMetaModel
        // No viewportCenter provided
      );

      expect(node).not.toBeNull();
      expect(node!.pos_x).toBe(100);
      expect(node!.pos_y).toBe(100);
    });

    it('should preserve all ERD-specific properties', () => {
      const existingNodes: any[] = [];
      const viewportCenter = { x: 600, y: 500 };

      const node = createERDNodeFromEntity(
        ENTITY_TYPES.LOGICAL_DATA_ENTITY,
        'lde-1',
        existingNodes,
        mockMetaModel,
        viewportCenter
      );

      expect(node).not.toBeNull();

      // Position should be fixed
      expect(node!.pos_x).toBe(100);
      expect(node!.pos_y).toBe(100);

      // ERD-specific properties should be preserved
      expect(node!.render_style).toBe('erd');
      expect(node!.embedded_attribute_ids).toBeDefined();
      expect(node!.embedded_attribute_ids!.length).toBe(2); // attr-1 and attr-2
      expect(node!.entity_type).toBe(ENTITY_TYPES.LOGICAL_DATA_ENTITY);
      expect(node!.entity_id).toBe('lde-1');
    });
  });
});
