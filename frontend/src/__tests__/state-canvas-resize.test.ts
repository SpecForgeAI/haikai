/**
 * State Canvas Resize Constraints Tests
 * Task Group 3: State Diagram UX Fixes
 *
 * Tests for Canvas.tsx integration:
 * - Initial state nodes enforce square resize (no min constraints)
 * - Final state nodes enforce square resize (no min constraints)
 * - Normal state nodes allow rectangular resize
 */

import { DiagramNode, MetaModel, State } from '../types/model';
import {
  getStateKindForNode,
  isSymbolStateKind,
  calculateSquareResizeForState,
} from '../utils/stateNodeRendering';
import {
  getActivityKindForNode,
  isSymbolActivityKind,
} from '../utils/activityNodeRendering';

// Helper to create a mock DiagramNode
function createMockStateNode(stateId: string, overrides: Partial<DiagramNode> = {}): DiagramNode {
  return {
    id: `node-${stateId}`,
    entity_type: 'STATE',
    entity_id: stateId,
    pos_x: 100,
    pos_y: 100,
    width: 50,
    height: 50,
    auto_size: false,
    z_index: 1,
    parent_node_id: null,
    style_override: {},
    ...overrides,
  };
}

// Helper to create a mock MetaModel
function createMockMetaModel(states: State[] = []): MetaModel {
  return {
    entities: {
      applications: [],
      app_components: [],
      services: [],
      interfaces: [],
      endpoints: [],
      classes: [],
      methods: [],
      logical_data_entities: [],
      logical_data_attributes: [],
      physical_data_entities: [],
      physical_data_attributes: [],
      business_users: [],
      business_processes: [],
      process_activities: [],
      application_points: [],
      interactions: [],
      events: [],
      states: states,
      state_transitions: [],
      activities: [],
      activity_flows: [],
      activity_partitions: [],
    },
    relationships: {
      app_component_services: [],
      service_interfaces: [],
      business_user_business_points: [],
      application_point_business_points: [],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      process_activities: [],
      class_methods: [],
      interface_logical_entities: [],
    },
  };
}

describe('Canvas Resize Constraints for State Nodes', () => {
  describe('getNodeResizeDimensions integration pattern', () => {
    // This tests the pattern that would be used in Canvas.tsx getNodeResizeDimensions

    it('identifies Initial state as requiring square resize', () => {
      const states: State[] = [
        { id: 'state-initial', name: 'Start', state_kind: 'Initial' },
      ];
      const metaModel = createMockMetaModel(states);
      const node = createMockStateNode('state-initial');

      const stateKind = getStateKindForNode(node, metaModel);

      expect(isSymbolStateKind(stateKind)).toBe(true);
    });

    it('identifies Final state as requiring square resize', () => {
      const states: State[] = [
        { id: 'state-final', name: 'End', state_kind: 'Final' },
      ];
      const metaModel = createMockMetaModel(states);
      const node = createMockStateNode('state-final');

      const stateKind = getStateKindForNode(node, metaModel);

      expect(isSymbolStateKind(stateKind)).toBe(true);
    });

    it('identifies Normal state as NOT requiring square resize', () => {
      const states: State[] = [
        { id: 'state-normal', name: 'Active', state_kind: 'Normal' },
      ];
      const metaModel = createMockMetaModel(states);
      const node = createMockStateNode('state-normal');

      const stateKind = getStateKindForNode(node, metaModel);

      expect(isSymbolStateKind(stateKind)).toBe(false);
    });

    it('Initial state resize produces square dimensions', () => {
      const node = createMockStateNode('state-initial', { width: 30, height: 30 });

      // Simulate BR handle drag
      const result = calculateSquareResizeForState('BR', node, 20, 15);

      expect(result.width).toBe(result.height);
      expect(result.width).toBeGreaterThan(30);
    });

    it('Initial state can be resized below standard minWidth/minHeight', () => {
      const node = createMockStateNode('state-initial', { width: 30, height: 30 });

      // Shrink significantly
      const result = calculateSquareResizeForState('BR', node, -25, -25);

      // Should allow size below standard 20x20 minimum, but not below 1
      expect(result.width).toBeLessThan(20);
      expect(result.width).toBeGreaterThanOrEqual(1);
      expect(result.height).toBe(result.width);
    });

    it('Final state resize produces square dimensions', () => {
      const node = createMockStateNode('state-final', { width: 22, height: 22 });

      // Simulate TL handle drag (expand)
      const result = calculateSquareResizeForState('TL', node, -10, -10);

      expect(result.width).toBe(result.height);
      expect(result.width).toBeGreaterThan(22);
    });
  });

  describe('State vs Activity pattern consistency', () => {
    // Ensure State resize follows the same pattern as Activity resize

    it('State and Activity both detect symbol kinds correctly', () => {
      // State: Initial and Final are symbols
      expect(isSymbolStateKind('Initial')).toBe(true);
      expect(isSymbolStateKind('Final')).toBe(true);
      expect(isSymbolStateKind('Normal')).toBe(false);

      // Activity: Initial, Decision, Merge, Final are symbols
      expect(isSymbolActivityKind('Initial')).toBe(true);
      expect(isSymbolActivityKind('Final')).toBe(true);
      expect(isSymbolActivityKind('Decision')).toBe(true);
      expect(isSymbolActivityKind('Merge')).toBe(true);
      expect(isSymbolActivityKind('Action')).toBe(false);
    });

    it('Both return null for non-matching entity types', () => {
      const metaModel = createMockMetaModel([]);
      const applicationNode: DiagramNode = {
        id: 'node-app',
        entity_type: 'APPLICATION',
        entity_id: 'app-1',
        pos_x: 100,
        pos_y: 100,
        width: 120,
        height: 60,
        auto_size: false,
        z_index: 1,
        parent_node_id: null,
        style_override: {},
      };

      expect(getStateKindForNode(applicationNode, metaModel)).toBeNull();
      expect(getActivityKindForNode(applicationNode, metaModel)).toBeNull();
    });
  });
});
