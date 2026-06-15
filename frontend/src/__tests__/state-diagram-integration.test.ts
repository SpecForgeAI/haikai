/**
 * State Diagram Integration Tests
 * Task Group 6: Test Review and Gap Analysis
 *
 * Strategic tests to fill coverage gaps identified during review:
 * - Validation: STATE_TRANSITION nodes no longer cause errors on load
 * - Backward compatibility: states without state_kind render as Normal
 * - Live updates: edge point recalculation patterns
 * - Label rendering with various trigger/guard/effect combinations
 * - Self-transition edge case (transition from state to itself)
 */

import { describe, it, expect } from 'vitest';
import { DIAGRAM_NODE_ENTITY_TYPE_MAP } from '../utils/entityTypeRegistry';
import { validateModel, validateStateTransitionReferences } from '../utils/validation';
import {
  renderStateNode,
  renderNormalStateNode,
} from '../utils/stateNodeRendering';
import {
  renderStateTransition,
  resolveTransitionLabel,
  calculateTransitionLabelPosition,
} from '../utils/stateTransitionRendering';
import { STATE_NODE_DEFAULTS, entityColors } from '../config/defaults';
import type {
  ArchitectureModel,
  State,
  StateTransition,
  Diagram,
  DiagramNode,
  DiagramEdge,
  MetaModel,
} from '../types/model';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a minimal MetaModel for testing
 */
function createMinimalMetaModel(): MetaModel {
  return {
    entities: {
      business_users: [],
      business_processes: [],
      process_activities: [],
      business_points: [],
      applications: [],
      app_components: [],
      services: [],
      interfaces: [],
      endpoints: [],
      classes: [],
      methods: [],
      application_points: [],
      logical_data_entities: [],
      logical_data_attributes: [],
      physical_data_entities: [],
      physical_data_attributes: [],
      interactions: [],
      app_business_points: [],
      events: [],
      states: [],
      state_transitions: [],
      activities: [],
      activity_flows: [],
      activity_partitions: [],
    },
    relationships: {
      business_user_business_points: [],
      application_point_business_points: [],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      interface_logical_entities: [],
    },
  };
}

/**
 * Create a minimal ArchitectureModel for validation tests
 */
function createMinimalModel(
  states: State[] = [],
  stateTransitions: StateTransition[] = [],
  diagrams: Diagram[] = []
): ArchitectureModel {
  const metaModel = createMinimalMetaModel();
  metaModel.entities.states = states;
  metaModel.entities.state_transitions = stateTransitions;

  return {
    model_file_id: 'test-model',
    name: 'Test Model',
    metaModel,
    diagrams,
  };
}

/**
 * Create a State entity
 */
function createState(overrides: Partial<State> = {}): State {
  return {
    id: 'state-1',
    name: 'Test State',
    state_kind: 'Normal',
    ...overrides,
  };
}

/**
 * Create a StateTransition entity
 */
function createTransition(overrides: Partial<StateTransition> = {}): StateTransition {
  return {
    id: 'trans-1',
    from_state_id: 'state-1',
    to_state_id: 'state-2',
    ...overrides,
  };
}

/**
 * Create a DiagramNode for a State
 */
function createStateNode(
  id: string,
  entityId: string,
  posX: number,
  posY: number
): DiagramNode {
  return {
    id,
    entity_type: 'STATE',
    entity_id: entityId,
    pos_x: posX,
    pos_y: posY,
    width: 140,
    height: 50,
    z_index: 100,
  };
}

/**
 * Create a DiagramEdge for a StateTransition
 */
function createTransitionEdge(
  id: string,
  relationshipId: string,
  sourceNodeId: string,
  targetNodeId: string
): DiagramEdge {
  return {
    id,
    relationship_type: 'STATE_TRANSITION',
    relationship_id: relationshipId,
    source_node_id: sourceNodeId,
    target_node_id: targetNodeId,
    edge_points: [],
    z_index: 110,
  };
}

// ============================================================================
// Test Suite: Validation Integration
// ============================================================================

describe('State Diagram Integration - Validation', () => {
  /**
   * Test 1: STATE_TRANSITION is registered in entity type map (validation fix)
   * From Task 6.3: Test validation: STATE_TRANSITION nodes no longer cause errors on load
   */
  it('STATE_TRANSITION should be registered in DIAGRAM_NODE_ENTITY_TYPE_MAP', () => {
    // This ensures validation.ts recognizes STATE_TRANSITION as valid
    expect(DIAGRAM_NODE_ENTITY_TYPE_MAP).toHaveProperty('STATE_TRANSITION');
    expect(DIAGRAM_NODE_ENTITY_TYPE_MAP.STATE_TRANSITION).toBe('state_transitions');
  });

  /**
   * Test 2: Valid StateTransition references pass validation
   */
  it('should validate StateTransition with valid state references', () => {
    const states = [
      createState({ id: 'state-1', name: 'Initial' }),
      createState({ id: 'state-2', name: 'Final' }),
    ];
    const transitions = [
      createTransition({
        id: 'trans-1',
        from_state_id: 'state-1',
        to_state_id: 'state-2',
      }),
    ];
    const model = createMinimalModel(states, transitions);

    const errors = validateStateTransitionReferences(transitions, model);

    expect(errors).toHaveLength(0);
  });

  /**
   * Test 3: Invalid StateTransition references produce validation errors
   */
  it('should detect invalid from_state_id references', () => {
    const states = [createState({ id: 'state-2', name: 'Target' })];
    const transitions = [
      createTransition({
        id: 'trans-1',
        from_state_id: 'nonexistent-state',
        to_state_id: 'state-2',
      }),
    ];
    const model = createMinimalModel(states, transitions);

    const errors = validateStateTransitionReferences(transitions, model);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].field).toBe('from_state_id');
    expect(errors[0].type).toBe('invalid_fk');
  });

  /**
   * Test 4: Missing to_state_id produces validation error
   */
  it('should detect missing to_state_id', () => {
    const states = [createState({ id: 'state-1', name: 'Source' })];
    const transitions = [
      {
        id: 'trans-1',
        from_state_id: 'state-1',
        to_state_id: '', // Empty/missing
      } as StateTransition,
    ];
    const model = createMinimalModel(states, transitions);

    const errors = validateStateTransitionReferences(transitions, model);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].field).toBe('to_state_id');
  });
});

// ============================================================================
// Test Suite: Backward Compatibility
// ============================================================================

describe('State Diagram Integration - Backward Compatibility', () => {
  /**
   * Test 5: States without state_kind render as Normal
   * From Task 6.3: Test backward compatibility: states without state_kind render as Normal
   */
  it('should render state without state_kind as Normal (green rounded rectangle)', () => {
    const legacyState: State = {
      id: 'legacy-state',
      name: 'Legacy State',
      // No state_kind property - simulates legacy data
    } as State;
    const position = { x: 100, y: 100 };

    const result = renderStateNode(legacyState, position);

    // Should have Normal node characteristics
    expect(result.showLabel).toBe(true);
    expect(result.fill).toBe(entityColors.STATE.background);
    expect(result.stroke).toBe(entityColors.STATE.border);
    expect(result.width).toBe(STATE_NODE_DEFAULTS.Normal.width);
    expect(result.height).toBe(STATE_NODE_DEFAULTS.Normal.height);
  });

  /**
   * Test 6: States with undefined state_kind render as Normal
   */
  it('should handle explicitly undefined state_kind', () => {
    const stateWithUndefined: State = {
      id: 'state-undefined',
      name: 'Undefined Kind',
      state_kind: undefined,
    } as State;
    const position = { x: 200, y: 200 };

    const result = renderStateNode(stateWithUndefined, position);

    expect(result.showLabel).toBe(true);
    expect(result.fill).toBe(entityColors.STATE.background);
  });
});

// ============================================================================
// Test Suite: Edge Cases and Integration
// ============================================================================

describe('State Diagram Integration - Edge Cases', () => {
  /**
   * Test 7: Self-transition (transition from state to itself)
   */
  it('should render self-transition correctly', () => {
    const sourcePosition = { x: 100, y: 100 };
    const targetPosition = { x: 100, y: 100 }; // Same position for self-transition

    const result = renderStateTransition(sourcePosition, targetPosition, 'self');

    // Should still produce valid path data even for zero-length line
    expect(result.linePath).toBeDefined();
    expect(result.arrowheadPath).toBeDefined();
    expect(result.labelPosition).toBeDefined();
    // Label position should be at the same point
    expect(result.labelPosition!.x).toBe(100);
    expect(result.labelPosition!.y).toBe(100);
  });

  /**
   * Test 8: Transition with all label fields populated
   * From Task 6.3: Test label rendering with various trigger/guard/effect combinations
   */
  it('should render complete UML transition label (trigger [guard] / effect)', () => {
    const metaModel = createMinimalMetaModel();
    metaModel.entities.methods = [
      { id: 'method-trigger', class_id: 'class-1', name: 'onButtonClick' },
      { id: 'method-guard', class_id: 'class-1', name: 'isValid' },
      { id: 'method-effect', class_id: 'class-1', name: 'submitForm' },
    ];

    const transition: StateTransition = {
      id: 'trans-complete',
      from_state_id: 'state-1',
      to_state_id: 'state-2',
      trigger_ref_kind: 'Method',
      trigger_ref_id: 'method-trigger',
      guard_ref_kind: 'Method',
      guard_ref_id: 'method-guard',
      effect_ref_kind: 'Method',
      effect_ref_id: 'method-effect',
    };

    const label = resolveTransitionLabel(transition, metaModel);

    // Full UML format: trigger [guard] / effect
    expect(label).toBe('onButtonClick [isValid] / submitForm');
  });

  /**
   * Test 9: Transition with only trigger label text (no references)
   */
  it('should render simple trigger label text', () => {
    const metaModel = createMinimalMetaModel();
    const transition: StateTransition = {
      id: 'trans-simple',
      from_state_id: 'state-1',
      to_state_id: 'state-2',
      trigger_label_text: 'click',
    };

    const label = resolveTransitionLabel(transition, metaModel);

    expect(label).toBe('click');
  });

  /**
   * Test 10: Label position calculation for various angles
   */
  it('should calculate label position at edge midpoint for any angle', () => {
    // Horizontal line
    const horizontalMid = calculateTransitionLabelPosition(
      { x: 0, y: 100 },
      { x: 200, y: 100 }
    );
    expect(horizontalMid).toEqual({ x: 100, y: 100 });

    // Vertical line
    const verticalMid = calculateTransitionLabelPosition(
      { x: 100, y: 0 },
      { x: 100, y: 200 }
    );
    expect(verticalMid).toEqual({ x: 100, y: 100 });

    // Diagonal line (45 degrees)
    const diagonalMid = calculateTransitionLabelPosition(
      { x: 0, y: 0 },
      { x: 100, y: 100 }
    );
    expect(diagonalMid).toEqual({ x: 50, y: 50 });
  });
});
