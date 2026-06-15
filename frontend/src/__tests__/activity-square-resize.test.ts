/**
 * Activity Diagram UX Fixes - Task Group 1: Square-Only Resize Tests
 * Spec 2026-01-01: Square-only resize enforcement for Activity symbol nodes
 *
 * Tests that Initial/Decision/Merge/Final nodes maintain square aspect ratio
 * during resize operations, with no minimum size constraints.
 */

import {
  getActivityKindForNode,
  isSymbolActivityKind,
  calculateSquareResize,
} from '../utils/activityNodeRendering';
import { DiagramNode, MetaModel, Activity, ActivityKind } from '../types/model';

// Helper to create a mock DiagramNode
function createMockNode(overrides: Partial<DiagramNode> = {}): DiagramNode {
  return {
    id: 'node_1',
    entity_type: 'ACTIVITY',
    entity_id: 'activity_1',
    pos_x: 100,
    pos_y: 100,
    width: 60,
    height: 60,
    auto_size: false,
    z_index: 100,
    style_override: {},
    ...overrides,
  };
}

// Helper to create a mock MetaModel with activities
function createMockMetaModel(activities: Activity[]): MetaModel {
  return {
    entities: {
      activities,
      activity_flows: [],
      activity_partitions: [],
      applications: [],
      app_components: [],
      services: [],
      interfaces: [],
      endpoints: [],
      business_processes: [],
      process_activities: [],
      business_users: [],
      application_points: [],
      business_points: [],
      logical_data_entities: [],
      logical_data_attributes: [],
      physical_data_entities: [],
      physical_data_attributes: [],
      interactions: [],
      app_business_points: [],
      events: [],
      classes: [],
      methods: [],
      states: [],
    },
    relationships: {
      data_movements: [],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      business_user_business_points: [],
      application_point_business_points: [],
      state_transitions: [],
      process_activities: [],
    },
    diagrams: [],
  } as unknown as MetaModel;
}

describe('Task Group 1: Square-Only Resize for Symbol Nodes', () => {
  describe('getActivityKindForNode', () => {
    it('should return activity_kind for ACTIVITY entity type', () => {
      const activity: Activity = {
        id: 'activity_1',
        name: 'Test Decision',
        activity_kind: 'Decision',
      };
      const metaModel = createMockMetaModel([activity]);
      const node = createMockNode({ entity_type: 'ACTIVITY', entity_id: 'activity_1' });

      const result = getActivityKindForNode(node, metaModel);
      expect(result).toBe('Decision');
    });

    it('should return null for non-ACTIVITY entity type', () => {
      const metaModel = createMockMetaModel([]);
      const node = createMockNode({ entity_type: 'APPLICATION', entity_id: 'app_1' });

      const result = getActivityKindForNode(node, metaModel);
      expect(result).toBeNull();
    });

    it('should return null when activity not found in metaModel', () => {
      const metaModel = createMockMetaModel([]);
      const node = createMockNode({ entity_type: 'ACTIVITY', entity_id: 'nonexistent' });

      const result = getActivityKindForNode(node, metaModel);
      expect(result).toBeNull();
    });
  });

  describe('isSymbolActivityKind', () => {
    it('should return true for Initial kind', () => {
      expect(isSymbolActivityKind('Initial')).toBe(true);
    });

    it('should return true for Decision kind', () => {
      expect(isSymbolActivityKind('Decision')).toBe(true);
    });

    it('should return true for Merge kind', () => {
      expect(isSymbolActivityKind('Merge')).toBe(true);
    });

    it('should return true for Final kind', () => {
      expect(isSymbolActivityKind('Final')).toBe(true);
    });

    it('should return false for Action kind', () => {
      expect(isSymbolActivityKind('Action')).toBe(false);
    });

    it('should return false for null', () => {
      expect(isSymbolActivityKind(null)).toBe(false);
    });
  });

  describe('calculateSquareResize - corner handles', () => {
    it('should maintain square aspect ratio for TL handle with dominant dx', () => {
      const originalNode = createMockNode({ pos_x: 100, pos_y: 100, width: 60, height: 60 });
      const result = calculateSquareResize('TL', originalNode, -20, -10);

      // Should use max(|dx|, |dy|) = 20 for both dimensions
      expect(result.width).toBe(80);
      expect(result.height).toBe(80);
      expect(result.width).toBe(result.height); // Square
    });

    it('should maintain square aspect ratio for BR handle with dominant dy', () => {
      const originalNode = createMockNode({ pos_x: 100, pos_y: 100, width: 60, height: 60 });
      const result = calculateSquareResize('BR', originalNode, 10, 30);

      // Should use max(|dx|, |dy|) = 30 for both dimensions
      expect(result.width).toBe(90);
      expect(result.height).toBe(90);
      expect(result.width).toBe(result.height); // Square
    });

    it('should maintain square aspect ratio for TR handle', () => {
      const originalNode = createMockNode({ pos_x: 100, pos_y: 100, width: 60, height: 60 });
      const result = calculateSquareResize('TR', originalNode, 25, -15);

      // Should use max(|dx|, |dy|) = 25 for both dimensions
      expect(result.width).toBe(85);
      expect(result.height).toBe(85);
      expect(result.width).toBe(result.height); // Square
    });

    it('should maintain square aspect ratio for BL handle', () => {
      const originalNode = createMockNode({ pos_x: 100, pos_y: 100, width: 60, height: 60 });
      const result = calculateSquareResize('BL', originalNode, -15, 25);

      // Should use max(|dx|, |dy|) = 25 for both dimensions
      expect(result.width).toBe(85);
      expect(result.height).toBe(85);
      expect(result.width).toBe(result.height); // Square
    });
  });

  describe('calculateSquareResize - edge handles', () => {
    it('should apply delta to both dimensions for TC handle', () => {
      const originalNode = createMockNode({ pos_x: 100, pos_y: 100, width: 60, height: 60 });
      const result = calculateSquareResize('TC', originalNode, 0, -20);

      // TC handle: dy should increase both dimensions
      expect(result.width).toBe(80);
      expect(result.height).toBe(80);
      expect(result.width).toBe(result.height); // Square
    });

    it('should apply delta to both dimensions for BC handle', () => {
      const originalNode = createMockNode({ pos_x: 100, pos_y: 100, width: 60, height: 60 });
      const result = calculateSquareResize('BC', originalNode, 0, 20);

      // BC handle: dy should increase both dimensions
      expect(result.width).toBe(80);
      expect(result.height).toBe(80);
      expect(result.width).toBe(result.height); // Square
    });

    it('should apply delta to both dimensions for ML handle', () => {
      const originalNode = createMockNode({ pos_x: 100, pos_y: 100, width: 60, height: 60 });
      const result = calculateSquareResize('ML', originalNode, -20, 0);

      // ML handle: dx should increase both dimensions
      expect(result.width).toBe(80);
      expect(result.height).toBe(80);
      expect(result.width).toBe(result.height); // Square
    });

    it('should apply delta to both dimensions for MR handle', () => {
      const originalNode = createMockNode({ pos_x: 100, pos_y: 100, width: 60, height: 60 });
      const result = calculateSquareResize('MR', originalNode, 20, 0);

      // MR handle: dx should increase both dimensions
      expect(result.width).toBe(80);
      expect(result.height).toBe(80);
      expect(result.width).toBe(result.height); // Square
    });
  });

  describe('calculateSquareResize - no minimum size constraints', () => {
    it('should allow very small sizes without minimum constraints', () => {
      const originalNode = createMockNode({ pos_x: 100, pos_y: 100, width: 60, height: 60 });
      const result = calculateSquareResize('BR', originalNode, -55, -55);

      // Should allow size down to 5x5 (60 - 55 = 5)
      expect(result.width).toBe(5);
      expect(result.height).toBe(5);
      expect(result.width).toBe(result.height); // Square
    });

    it('should prevent negative dimensions', () => {
      const originalNode = createMockNode({ pos_x: 100, pos_y: 100, width: 60, height: 60 });
      const result = calculateSquareResize('BR', originalNode, -70, -70);

      // Should clamp to minimum of 1x1 (not negative)
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
      expect(result.width).toBe(result.height); // Square
    });
  });

  describe('Action nodes retain standard rectangular resize', () => {
    // This test documents that Action nodes should NOT use square resize
    // The actual enforcement happens in Canvas.tsx calculateResize function
    it('isSymbolActivityKind returns false for Action', () => {
      expect(isSymbolActivityKind('Action')).toBe(false);
    });
  });
});
