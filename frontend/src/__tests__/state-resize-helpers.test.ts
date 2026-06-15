/**
 * State Node Resize Helpers Tests
 * Task Group 1: State Diagram UX Fixes
 *
 * Tests for:
 * - getStateKindForNode(): Returns correct StateKind for STATE nodes
 * - isSymbolStateKind(): Identifies Initial/Final as symbol kinds
 * - calculateSquareResizeForState(): Enforces square aspect ratio
 */

import { DiagramNode, MetaModel, State } from '../types/model';
import {
  getStateKindForNode,
  isSymbolStateKind,
  calculateSquareResizeForState,
  SYMBOL_STATE_KINDS,
} from '../utils/stateNodeRendering';

// Helper to create a mock DiagramNode
function createMockNode(overrides: Partial<DiagramNode> = {}): DiagramNode {
  return {
    id: 'node-1',
    entity_type: 'STATE',
    entity_id: 'state-1',
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

describe('getStateKindForNode', () => {
  it('returns correct StateKind for STATE nodes', () => {
    const states: State[] = [
      { id: 'state-1', name: 'Test State', state_kind: 'Normal' },
    ];
    const metaModel = createMockMetaModel(states);
    const node = createMockNode({ entity_type: 'STATE', entity_id: 'state-1' });

    const result = getStateKindForNode(node, metaModel);

    expect(result).toBe('Normal');
  });

  it('returns Initial for Initial state nodes', () => {
    const states: State[] = [
      { id: 'state-2', name: 'Start', state_kind: 'Initial' },
    ];
    const metaModel = createMockMetaModel(states);
    const node = createMockNode({ entity_type: 'STATE', entity_id: 'state-2' });

    const result = getStateKindForNode(node, metaModel);

    expect(result).toBe('Initial');
  });

  it('returns Final for Final state nodes', () => {
    const states: State[] = [
      { id: 'state-3', name: 'End', state_kind: 'Final' },
    ];
    const metaModel = createMockMetaModel(states);
    const node = createMockNode({ entity_type: 'STATE', entity_id: 'state-3' });

    const result = getStateKindForNode(node, metaModel);

    expect(result).toBe('Final');
  });

  it('returns null for non-STATE nodes', () => {
    const metaModel = createMockMetaModel([]);
    const node = createMockNode({ entity_type: 'APPLICATION', entity_id: 'app-1' });

    const result = getStateKindForNode(node, metaModel);

    expect(result).toBeNull();
  });

  it('returns null when state entity is not found', () => {
    const metaModel = createMockMetaModel([]);
    const node = createMockNode({ entity_type: 'STATE', entity_id: 'non-existent' });

    const result = getStateKindForNode(node, metaModel);

    expect(result).toBeNull();
  });

  it('defaults to Normal when state_kind is undefined', () => {
    const states: State[] = [
      { id: 'state-4', name: 'Unnamed' } as State, // Missing state_kind
    ];
    const metaModel = createMockMetaModel(states);
    const node = createMockNode({ entity_type: 'STATE', entity_id: 'state-4' });

    const result = getStateKindForNode(node, metaModel);

    expect(result).toBe('Normal');
  });
});

describe('isSymbolStateKind', () => {
  it('returns true for Initial', () => {
    expect(isSymbolStateKind('Initial')).toBe(true);
  });

  it('returns true for Final', () => {
    expect(isSymbolStateKind('Final')).toBe(true);
  });

  it('returns false for Normal', () => {
    expect(isSymbolStateKind('Normal')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isSymbolStateKind(null)).toBe(false);
  });

  it('SYMBOL_STATE_KINDS contains only Initial and Final', () => {
    expect(SYMBOL_STATE_KINDS.has('Initial')).toBe(true);
    expect(SYMBOL_STATE_KINDS.has('Final')).toBe(true);
    expect(SYMBOL_STATE_KINDS.has('Normal')).toBe(false);
    expect(SYMBOL_STATE_KINDS.size).toBe(2);
  });
});

describe('calculateSquareResizeForState', () => {
  const originalNode = createMockNode({
    pos_x: 100,
    pos_y: 100,
    width: 50,
    height: 50,
  });

  it('enforces square aspect ratio for BR handle expansion', () => {
    // Drag bottom-right down and right
    const result = calculateSquareResizeForState('BR', originalNode, 30, 20);

    expect(result.width).toBe(result.height);
    expect(result.width).toBeGreaterThan(50);
    // Top-left corner stays fixed
    expect(result.pos_x).toBe(100);
    expect(result.pos_y).toBe(100);
  });

  it('enforces square aspect ratio for TL handle expansion', () => {
    // Drag top-left up and left (negative deltas)
    const result = calculateSquareResizeForState('TL', originalNode, -30, -20);

    expect(result.width).toBe(result.height);
    expect(result.width).toBeGreaterThan(50);
    // Bottom-right corner stays fixed
    expect(result.pos_x + result.width).toBe(originalNode.pos_x + originalNode.width);
    expect(result.pos_y + result.height).toBe(originalNode.pos_y + originalNode.height);
  });

  it('enforces square aspect ratio for TR handle', () => {
    const result = calculateSquareResizeForState('TR', originalNode, 30, -20);

    expect(result.width).toBe(result.height);
    // Bottom-left corner stays fixed
    expect(result.pos_x).toBe(originalNode.pos_x);
    expect(result.pos_y + result.height).toBe(originalNode.pos_y + originalNode.height);
  });

  it('enforces square aspect ratio for BL handle', () => {
    const result = calculateSquareResizeForState('BL', originalNode, -30, 20);

    expect(result.width).toBe(result.height);
    // Top-right corner stays fixed
    expect(result.pos_x + result.width).toBe(originalNode.pos_x + originalNode.width);
    expect(result.pos_y).toBe(originalNode.pos_y);
  });

  it('allows sizes below standard minimums', () => {
    // Shrink to very small size
    const result = calculateSquareResizeForState('BR', originalNode, -45, -45);

    // Should allow sizes down to 1 (not the standard minWidth/minHeight)
    expect(result.width).toBeGreaterThanOrEqual(1);
    expect(result.height).toBeGreaterThanOrEqual(1);
    expect(result.width).toBeLessThan(50);
  });

  it('handles TC edge handle with square constraint', () => {
    // Drag top center up (expands)
    const result = calculateSquareResizeForState('TC', originalNode, 0, -30);

    expect(result.width).toBe(result.height);
    // Width should also increase to match height
    expect(result.height).toBeGreaterThan(50);
  });

  it('handles BC edge handle with square constraint', () => {
    const result = calculateSquareResizeForState('BC', originalNode, 0, 30);

    expect(result.width).toBe(result.height);
  });

  it('handles ML edge handle with square constraint', () => {
    const result = calculateSquareResizeForState('ML', originalNode, -30, 0);

    expect(result.width).toBe(result.height);
  });

  it('handles MR edge handle with square constraint', () => {
    const result = calculateSquareResizeForState('MR', originalNode, 30, 0);

    expect(result.width).toBe(result.height);
  });

  it('prevents negative dimensions (minimum 1x1)', () => {
    const result = calculateSquareResizeForState('BR', originalNode, -200, -200);

    expect(result.width).toBeGreaterThanOrEqual(1);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });
});
