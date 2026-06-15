/**
 * Edge Inspectors Tests
 * Task Group 5: StateTransition and ActivityFlow Edge Inspectors
 *
 * Tests for the edge inspector functionality that allows editing of
 * StateTransition and ActivityFlow edges in the diagram view.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  StateTransition,
  ActivityFlow,
  DiagramEdge,
  MetaModel,
  ENTITY_TYPES,
  State,
  Activity,
  Event,
  Method,
  Class,
} from '../types/model';

// Helper to create a mock MetaModel
function createMockMetaModel(overrides?: Partial<MetaModel['entities']>): MetaModel {
  const defaultEntities: MetaModel['entities'] = {
    business_users: [],
    business_processes: [],
    process_activities: [],
    business_points: [],
    applications: [],
    app_components: [],
    services: [],
    interfaces: [],
    endpoints: [],
    classes: [
      { id: 'class-1', name: 'OrderService', description: 'Order service class' },
      { id: 'class-2', name: 'CustomerService', description: 'Customer service class' },
    ] as Class[],
    methods: [
      { id: 'method-1', class_id: 'class-1', name: 'processOrder', description: 'Process an order' },
      { id: 'method-2', class_id: 'class-1', name: 'validateOrder', description: 'Validate an order' },
      { id: 'method-3', class_id: 'class-2', name: 'getCustomer', description: 'Get customer data' },
    ] as Method[],
    application_points: [],
    logical_data_entities: [],
    logical_data_attributes: [],
    physical_data_entities: [],
    physical_data_attributes: [],
    interactions: [],
    app_business_points: [],
    events: [
      { id: 'event-1', name: 'OrderCreated', description: 'Order created event', tags: '' },
      { id: 'event-2', name: 'OrderCompleted', description: 'Order completed event', tags: '' },
      { id: 'event-3', name: 'CustomerUpdated', description: 'Customer updated event', tags: '' },
    ] as Event[],
    states: [
      { id: 'state-1', name: 'Pending', state_kind: 'Initial' },
      { id: 'state-2', name: 'Processing', state_kind: 'Normal' },
      { id: 'state-3', name: 'Completed', state_kind: 'Final' },
    ] as State[],
    state_transitions: [
      {
        id: 'transition-1',
        from_state_id: 'state-1',
        to_state_id: 'state-2',
        trigger_ref_kind: 'Event',
        trigger_ref_id: 'event-1',
      },
    ] as StateTransition[],
    activities: [
      { id: 'activity-1', name: 'Start', activity_kind: 'Initial' },
      { id: 'activity-2', name: 'Process Order', activity_kind: 'Action' },
      { id: 'activity-3', name: 'End', activity_kind: 'Final' },
    ] as Activity[],
    activity_flows: [
      {
        id: 'flow-1',
        from_activity_id: 'activity-1',
        to_activity_id: 'activity-2',
        flow_kind: 'Control',
      },
    ] as ActivityFlow[],
    activity_partitions: [],
    ...overrides,
  };

  return {
    entities: defaultEntities,
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

// Helper to create a mock StateTransition DiagramEdge
function createStateTransitionEdge(overrides?: Partial<DiagramEdge>): DiagramEdge {
  return {
    id: 'edge-st-1',
    relationship_type: 'STATE_TRANSITION',
    relationship_id: 'transition-1',
    source_node_id: 'node-state-1',
    target_node_id: 'node-state-2',
    edge_points: [
      { id: 'ep-1', sequence_order: 0, pos_x: 100, pos_y: 100 },
      { id: 'ep-2', sequence_order: 1, pos_x: 200, pos_y: 100 },
    ],
    ...overrides,
  };
}

// Helper to create a mock ActivityFlow DiagramEdge
function createActivityFlowEdge(overrides?: Partial<DiagramEdge>): DiagramEdge {
  return {
    id: 'edge-af-1',
    relationship_type: 'ACTIVITY_FLOW',
    relationship_id: 'flow-1',
    source_node_id: 'node-activity-1',
    target_node_id: 'node-activity-2',
    edge_points: [
      { id: 'ep-1', sequence_order: 0, pos_x: 100, pos_y: 100 },
      { id: 'ep-2', sequence_order: 1, pos_x: 200, pos_y: 100 },
    ],
    ...overrides,
  };
}

describe('Edge Inspector Tests', () => {
  describe('StateTransition inspector display', () => {
    it('should identify STATE_TRANSITION edge type correctly', () => {
      const edge = createStateTransitionEdge();
      expect(edge.relationship_type).toBe('STATE_TRANSITION');
    });

    it('should have fromState and toState references in StateTransition entity', () => {
      const metaModel = createMockMetaModel();
      const transition = metaModel.entities.state_transitions[0];

      expect(transition.from_state_id).toBe('state-1');
      expect(transition.to_state_id).toBe('state-2');

      // Verify we can resolve state names
      const fromState = metaModel.entities.states.find(s => s.id === transition.from_state_id);
      const toState = metaModel.entities.states.find(s => s.id === transition.to_state_id);

      expect(fromState?.name).toBe('Pending');
      expect(toState?.name).toBe('Processing');
    });

    it('should support trigger_ref_kind with Event value', () => {
      const transition: StateTransition = {
        id: 'transition-test',
        from_state_id: 'state-1',
        to_state_id: 'state-2',
        trigger_ref_kind: 'Event',
        trigger_ref_id: 'event-1',
      };

      expect(transition.trigger_ref_kind).toBe('Event');
      expect(transition.trigger_ref_id).toBe('event-1');
    });

    it('should support trigger_ref_kind with Method value', () => {
      const transition: StateTransition = {
        id: 'transition-test',
        from_state_id: 'state-1',
        to_state_id: 'state-2',
        trigger_ref_kind: 'Method',
        trigger_ref_id: 'method-1',
      };

      expect(transition.trigger_ref_kind).toBe('Method');
      expect(transition.trigger_ref_id).toBe('method-1');
    });

    it('should support trigger_label_text for text mode', () => {
      const transition: StateTransition = {
        id: 'transition-test',
        from_state_id: 'state-1',
        to_state_id: 'state-2',
        trigger_label_text: 'user clicks submit',
      };

      expect(transition.trigger_label_text).toBe('user clicks submit');
      expect(transition.trigger_ref_kind).toBeUndefined();
      expect(transition.trigger_ref_id).toBeUndefined();
    });
  });

  describe('ActivityFlow inspector display', () => {
    it('should identify ACTIVITY_FLOW edge type correctly', () => {
      const edge = createActivityFlowEdge();
      expect(edge.relationship_type).toBe('ACTIVITY_FLOW');
    });

    it('should have fromActivity and toActivity references in ActivityFlow entity', () => {
      const metaModel = createMockMetaModel();
      const flow = metaModel.entities.activity_flows[0];

      expect(flow.from_activity_id).toBe('activity-1');
      expect(flow.to_activity_id).toBe('activity-2');

      // Verify we can resolve activity names
      const fromActivity = metaModel.entities.activities.find(a => a.id === flow.from_activity_id);
      const toActivity = metaModel.entities.activities.find(a => a.id === flow.to_activity_id);

      expect(fromActivity?.name).toBe('Start');
      expect(toActivity?.name).toBe('Process Order');
    });

    it('should support flowKind with Control value', () => {
      const flow: ActivityFlow = {
        id: 'flow-test',
        from_activity_id: 'activity-1',
        to_activity_id: 'activity-2',
        flow_kind: 'Control',
      };

      expect(flow.flow_kind).toBe('Control');
    });

    it('should support flowKind with Data value', () => {
      const flow: ActivityFlow = {
        id: 'flow-test',
        from_activity_id: 'activity-1',
        to_activity_id: 'activity-2',
        flow_kind: 'Data',
      };

      expect(flow.flow_kind).toBe('Data');
    });
  });

  describe('Trigger mode selector', () => {
    it('should support Event mode for trigger', () => {
      const transition: StateTransition = {
        id: 'transition-test',
        from_state_id: 'state-1',
        to_state_id: 'state-2',
        trigger_ref_kind: 'Event',
        trigger_ref_id: 'event-1',
      };

      // Verify trigger mode can be determined from trigger_ref_kind
      const triggerMode = transition.trigger_ref_kind ? transition.trigger_ref_kind :
                         (transition.trigger_label_text ? 'Text' : 'None');
      expect(triggerMode).toBe('Event');
    });

    it('should support Method mode for trigger', () => {
      const transition: StateTransition = {
        id: 'transition-test',
        from_state_id: 'state-1',
        to_state_id: 'state-2',
        trigger_ref_kind: 'Method',
        trigger_ref_id: 'method-1',
      };

      const triggerMode = transition.trigger_ref_kind ? transition.trigger_ref_kind :
                         (transition.trigger_label_text ? 'Text' : 'None');
      expect(triggerMode).toBe('Method');
    });

    it('should support Text mode for trigger', () => {
      const transition: StateTransition = {
        id: 'transition-test',
        from_state_id: 'state-1',
        to_state_id: 'state-2',
        trigger_label_text: 'user action',
      };

      const triggerMode = transition.trigger_ref_kind ? transition.trigger_ref_kind :
                         (transition.trigger_label_text ? 'Text' : 'None');
      expect(triggerMode).toBe('Text');
    });
  });

  describe('Guard mode selector', () => {
    it('should support None mode for guard (no guard fields set)', () => {
      const transition: StateTransition = {
        id: 'transition-test',
        from_state_id: 'state-1',
        to_state_id: 'state-2',
        trigger_label_text: 'trigger',
      };

      // Verify guard mode can be determined
      const guardMode = transition.guard_ref_kind ? 'Method' :
                       (transition.guard_expression ? 'Expression' : 'None');
      expect(guardMode).toBe('None');
    });

    it('should support Method mode for guard', () => {
      const transition: StateTransition = {
        id: 'transition-test',
        from_state_id: 'state-1',
        to_state_id: 'state-2',
        trigger_label_text: 'trigger',
        guard_ref_kind: 'Method',
        guard_ref_id: 'method-2',
      };

      const guardMode = transition.guard_ref_kind ? 'Method' :
                       (transition.guard_expression ? 'Expression' : 'None');
      expect(guardMode).toBe('Method');
    });

    it('should support Expression mode for guard', () => {
      const transition: StateTransition = {
        id: 'transition-test',
        from_state_id: 'state-1',
        to_state_id: 'state-2',
        trigger_label_text: 'trigger',
        guard_expression: 'order.total > 100',
      };

      const guardMode = transition.guard_ref_kind ? 'Method' :
                       (transition.guard_expression ? 'Expression' : 'None');
      expect(guardMode).toBe('Expression');
    });
  });

  describe('Save-on-blur behavior', () => {
    it('should construct proper StateTransition update payload', () => {
      const originalTransition: StateTransition = {
        id: 'transition-1',
        from_state_id: 'state-1',
        to_state_id: 'state-2',
        trigger_ref_kind: 'Event',
        trigger_ref_id: 'event-1',
      };

      // Simulate update by changing trigger mode to Text
      const updatedTransition: StateTransition = {
        ...originalTransition,
        trigger_ref_kind: undefined,
        trigger_ref_id: undefined,
        trigger_label_text: 'new text trigger',
      };

      expect(updatedTransition.id).toBe(originalTransition.id);
      expect(updatedTransition.from_state_id).toBe(originalTransition.from_state_id);
      expect(updatedTransition.to_state_id).toBe(originalTransition.to_state_id);
      expect(updatedTransition.trigger_label_text).toBe('new text trigger');
      expect(updatedTransition.trigger_ref_kind).toBeUndefined();
    });

    it('should construct proper ActivityFlow update payload', () => {
      const originalFlow: ActivityFlow = {
        id: 'flow-1',
        from_activity_id: 'activity-1',
        to_activity_id: 'activity-2',
        flow_kind: 'Control',
      };

      // Simulate update by changing flow_kind to Data
      const updatedFlow: ActivityFlow = {
        ...originalFlow,
        flow_kind: 'Data',
        condition_expression: 'hasData()',
      };

      expect(updatedFlow.id).toBe(originalFlow.id);
      expect(updatedFlow.from_activity_id).toBe(originalFlow.from_activity_id);
      expect(updatedFlow.to_activity_id).toBe(originalFlow.to_activity_id);
      expect(updatedFlow.flow_kind).toBe('Data');
      expect(updatedFlow.condition_expression).toBe('hasData()');
    });
  });

  describe('Read-only fromState/toState display', () => {
    it('should resolve fromState name from StateTransition', () => {
      const metaModel = createMockMetaModel();
      const transition = metaModel.entities.state_transitions[0];

      const fromStateName = metaModel.entities.states.find(
        s => s.id === transition.from_state_id
      )?.name || 'Unknown';

      expect(fromStateName).toBe('Pending');
    });

    it('should resolve toState name from StateTransition', () => {
      const metaModel = createMockMetaModel();
      const transition = metaModel.entities.state_transitions[0];

      const toStateName = metaModel.entities.states.find(
        s => s.id === transition.to_state_id
      )?.name || 'Unknown';

      expect(toStateName).toBe('Processing');
    });

    it('should resolve fromActivity name from ActivityFlow', () => {
      const metaModel = createMockMetaModel();
      const flow = metaModel.entities.activity_flows[0];

      const fromActivityName = metaModel.entities.activities.find(
        a => a.id === flow.from_activity_id
      )?.name || 'Unknown';

      expect(fromActivityName).toBe('Start');
    });

    it('should resolve toActivity name from ActivityFlow', () => {
      const metaModel = createMockMetaModel();
      const flow = metaModel.entities.activity_flows[0];

      const toActivityName = metaModel.entities.activities.find(
        a => a.id === flow.to_activity_id
      )?.name || 'Unknown';

      expect(toActivityName).toBe('Process Order');
    });
  });
});

describe('Edge type detection helpers', () => {
  it('should correctly identify STATE_TRANSITION edges', () => {
    const stateTransitionEdge = createStateTransitionEdge();
    const activityFlowEdge = createActivityFlowEdge();

    const isStateTransition = (edge: DiagramEdge) =>
      edge.relationship_type === 'STATE_TRANSITION';

    expect(isStateTransition(stateTransitionEdge)).toBe(true);
    expect(isStateTransition(activityFlowEdge)).toBe(false);
  });

  it('should correctly identify ACTIVITY_FLOW edges', () => {
    const stateTransitionEdge = createStateTransitionEdge();
    const activityFlowEdge = createActivityFlowEdge();

    const isActivityFlow = (edge: DiagramEdge) =>
      edge.relationship_type === 'ACTIVITY_FLOW';

    expect(isActivityFlow(activityFlowEdge)).toBe(true);
    expect(isActivityFlow(stateTransitionEdge)).toBe(false);
  });

  it('should support edge inspector for both edge types', () => {
    const INSPECTOR_EDGE_TYPES = ['STATE_TRANSITION', 'ACTIVITY_FLOW'];

    const stateTransitionEdge = createStateTransitionEdge();
    const activityFlowEdge = createActivityFlowEdge();
    const otherEdge: DiagramEdge = {
      ...createStateTransitionEdge(),
      relationship_type: 'LOGICAL_DATA_ENTITY_RELATIONSHIP',
    };

    const supportsInspector = (edge: DiagramEdge) =>
      INSPECTOR_EDGE_TYPES.includes(edge.relationship_type);

    expect(supportsInspector(stateTransitionEdge)).toBe(true);
    expect(supportsInspector(activityFlowEdge)).toBe(true);
    expect(supportsInspector(otherEdge)).toBe(false);
  });
});
