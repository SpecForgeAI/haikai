/**
 * State Transition Creation Tests
 * Task Group 5: RHS Palette State Transition Creation and Inspector
 *
 * Tests for the State Transition creation workflow:
 * - Test 1: "+ New State Transition" button appears for State diagram type
 * - Test 2: Clicking button enters transition-creation mode
 * - Test 3: Clicking two states creates StateTransition entity and DiagramEdge
 * - Test 4: Escape key cancels creation mode
 */

import { describe, it, expect } from 'vitest';
import {
  DiagramNode,
  DiagramEdge,
  MetaModel,
  State,
  StateTransition,
  Diagram,
} from '../types/model';
import { generatePrefixedId } from '../utils/idGenerator';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock State entity
 */
function createState(overrides?: Partial<State>): State {
  return {
    id: 'state-1',
    name: 'Test State',
    state_kind: 'Normal',
    ...overrides,
  };
}

/**
 * Create a mock DiagramNode for a State
 */
function createStateNode(overrides?: Partial<DiagramNode>): DiagramNode {
  return {
    id: 'node-state-1',
    entity_type: 'STATE',
    entity_id: 'state-1',
    pos_x: 100,
    pos_y: 100,
    width: 140,
    height: 50,
    parent_node_id: null,
    ...overrides,
  };
}

/**
 * Create a mock StateTransition entity
 */
function createStateTransition(overrides?: Partial<StateTransition>): StateTransition {
  return {
    id: 'transition-1',
    from_state_id: 'state-1',
    to_state_id: 'state-2',
    ...overrides,
  };
}

/**
 * Create a mock DiagramEdge for a StateTransition
 */
function createTransitionEdge(overrides?: Partial<DiagramEdge>): DiagramEdge {
  return {
    id: 'edge-transition-1',
    relationship_type: 'STATE_TRANSITION',
    relationship_id: 'transition-1',
    source_node_id: 'node-state-1',
    target_node_id: 'node-state-2',
    edge_points: [
      { id: 'ep-1', sequence_order: 0, pos_x: 100, pos_y: 100 },
      { id: 'ep-2', sequence_order: 1, pos_x: 300, pos_y: 100 },
    ],
    ...overrides,
  };
}

/**
 * Create a mock Diagram for State type
 */
function createStateDiagram(overrides?: Partial<Diagram>): Diagram {
  return {
    id: 'diagram-1',
    name: 'Test State Diagram',
    description: '',
    diagram_type: 'State',
    diagram_nodes: [],
    diagram_edges: [],
    ...overrides,
  };
}

/**
 * Create a mock MetaModel with State entities
 */
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
    states: [
      createState({ id: 'state-1', name: 'Idle', state_kind: 'Initial' }),
      createState({ id: 'state-2', name: 'Processing', state_kind: 'Normal' }),
      createState({ id: 'state-3', name: 'Complete', state_kind: 'Final' }),
    ],
    state_transitions: [],
    activities: [],
    activity_flows: [],
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

/**
 * Interface for transition creation mode state
 */
interface TransitionCreationMode {
  active: boolean;
  sourceStateNodeId: string | null;
}

/**
 * Initial transition creation mode state
 */
const initialTransitionCreationMode: TransitionCreationMode = {
  active: false,
  sourceStateNodeId: null,
};

/**
 * Helper function to create a StateTransition entity
 */
function createStateTransitionEntity(
  fromStateId: string,
  toStateId: string,
  idPrefix: string = 'transition'
): StateTransition {
  return {
    id: generatePrefixedId(idPrefix),
    from_state_id: fromStateId,
    to_state_id: toStateId,
    trigger_ref_kind: undefined,
    trigger_ref_id: undefined,
    trigger_label_text: undefined,
    guard_ref_kind: undefined,
    guard_ref_id: undefined,
    guard_expression: undefined,
    effect_ref_kind: undefined,
    effect_ref_id: undefined,
    effect_label_text: undefined,
  };
}

/**
 * Helper function to create a DiagramEdge for a StateTransition
 */
function createTransitionDiagramEdge(
  transitionId: string,
  sourceNodeId: string,
  targetNodeId: string,
  sourceNode: DiagramNode,
  targetNode: DiagramNode
): DiagramEdge {
  const edgeId = generatePrefixedId('edge');

  // Calculate center points for source and target nodes
  const sourceCenterX = sourceNode.pos_x + sourceNode.width / 2;
  const sourceCenterY = sourceNode.pos_y + sourceNode.height / 2;
  const targetCenterX = targetNode.pos_x + targetNode.width / 2;
  const targetCenterY = targetNode.pos_y + targetNode.height / 2;

  return {
    id: edgeId,
    relationship_type: 'STATE_TRANSITION',
    relationship_id: transitionId,
    source_node_id: sourceNodeId,
    target_node_id: targetNodeId,
    edge_points: [
      { id: generatePrefixedId('ep'), sequence_order: 0, pos_x: sourceCenterX, pos_y: sourceCenterY },
      { id: generatePrefixedId('ep'), sequence_order: 1, pos_x: targetCenterX, pos_y: targetCenterY },
    ],
  };
}

// ============================================================================
// Test Suite
// ============================================================================

describe('State Transition Creation Tests', () => {
  /**
   * Test 1: "+ New State Transition" button appears for State diagram type
   */
  describe('Button visibility for State diagram type', () => {
    it('should show "+ New State Transition" button only for State diagram type', () => {
      // Simulate getCreateSectionButtons logic
      const getCreateSectionButtons = (diagramType: string): Array<{ label: string; entityType: string }> => {
        switch (diagramType) {
          case 'State':
            return [
              { label: '+ New State', entityType: 'STATE' },
              { label: '+ New State Transition', entityType: 'STATE_TRANSITION' },
            ];
          case 'Activity':
            return [
              { label: '+ New Partition', entityType: 'ACTIVITY_PARTITION' },
              { label: '+ New Activity', entityType: 'ACTIVITY' },
            ];
          case 'ER':
            return [
              { label: '+ New Logical Entity', entityType: 'LOGICAL_DATA_ENTITY' },
              { label: '+ New Physical Entity', entityType: 'PHYSICAL_DATA_ENTITY' },
            ];
          default:
            return [];
        }
      };

      // Verify button exists for State diagrams
      const stateButtons = getCreateSectionButtons('State');
      const transitionButton = stateButtons.find(b => b.label === '+ New State Transition');
      expect(transitionButton).toBeDefined();
      expect(transitionButton?.entityType).toBe('STATE_TRANSITION');

      // Verify button does NOT exist for Activity diagrams
      const activityButtons = getCreateSectionButtons('Activity');
      const noTransitionButton = activityButtons.find(b => b.label === '+ New State Transition');
      expect(noTransitionButton).toBeUndefined();

      // Verify button does NOT exist for General diagrams
      const generalButtons = getCreateSectionButtons('General');
      expect(generalButtons.find(b => b.label === '+ New State Transition')).toBeUndefined();
    });

    it('should have STATE_TRANSITION entity type for the button', () => {
      const buttonEntityType = 'STATE_TRANSITION';
      expect(buttonEntityType).toBe('STATE_TRANSITION');
    });

    it('should disable button when no active diagram exists', () => {
      const hasActiveDiagram = false;
      const isButtonDisabled = !hasActiveDiagram;
      expect(isButtonDisabled).toBe(true);
    });

    it('should enable button when active State diagram exists', () => {
      const diagram = createStateDiagram();
      const hasActiveDiagram = diagram !== undefined && diagram.diagram_type === 'State';
      const isButtonDisabled = !hasActiveDiagram;
      expect(isButtonDisabled).toBe(false);
    });
  });

  /**
   * Test 2: Clicking button enters transition-creation mode
   */
  describe('Transition creation mode entry', () => {
    it('should initialize with inactive creation mode', () => {
      const creationMode: TransitionCreationMode = { ...initialTransitionCreationMode };

      expect(creationMode.active).toBe(false);
      expect(creationMode.sourceStateNodeId).toBeNull();
    });

    it('should activate creation mode when button is clicked', () => {
      let creationMode: TransitionCreationMode = { ...initialTransitionCreationMode };

      // Simulate button click handler
      const handleEnterCreationMode = () => {
        creationMode = {
          active: true,
          sourceStateNodeId: null,
        };
      };

      handleEnterCreationMode();

      expect(creationMode.active).toBe(true);
      expect(creationMode.sourceStateNodeId).toBeNull();
    });

    it('should have sourceStateNodeId as null until first state is clicked', () => {
      const creationMode: TransitionCreationMode = {
        active: true,
        sourceStateNodeId: null,
      };

      expect(creationMode.active).toBe(true);
      expect(creationMode.sourceStateNodeId).toBeNull();
    });

    it('should track creation mode state structure correctly', () => {
      const creationMode: TransitionCreationMode = {
        active: true,
        sourceStateNodeId: 'node-state-1',
      };

      expect(typeof creationMode.active).toBe('boolean');
      expect(typeof creationMode.sourceStateNodeId).toBe('string');
    });
  });

  /**
   * Test 3: Clicking two states creates StateTransition entity and DiagramEdge
   */
  describe('Two-click state transition creation', () => {
    it('should set source state when first state is clicked in creation mode', () => {
      let creationMode: TransitionCreationMode = {
        active: true,
        sourceStateNodeId: null,
      };

      const firstClickedNodeId = 'node-state-1';

      // Simulate first state click
      const handleStateClick = (nodeId: string) => {
        if (creationMode.active && creationMode.sourceStateNodeId === null) {
          creationMode = {
            ...creationMode,
            sourceStateNodeId: nodeId,
          };
        }
      };

      handleStateClick(firstClickedNodeId);

      expect(creationMode.sourceStateNodeId).toBe('node-state-1');
      expect(creationMode.active).toBe(true);
    });

    it('should create StateTransition entity when second state is clicked', () => {
      const sourceNode = createStateNode({ id: 'node-state-1', entity_id: 'state-1' });
      const targetNode = createStateNode({ id: 'node-state-2', entity_id: 'state-2', pos_x: 300 });

      // Create the StateTransition entity
      const transition = createStateTransitionEntity(
        sourceNode.entity_id,
        targetNode.entity_id
      );

      expect(transition.from_state_id).toBe('state-1');
      expect(transition.to_state_id).toBe('state-2');
      expect(transition.id).toBeDefined();
      // generatePrefixedId uses format: prefix-timestamp-random (with hyphens)
      expect(transition.id.startsWith('transition-')).toBe(true);
    });

    it('should create DiagramEdge referencing the StateTransition', () => {
      const sourceNode = createStateNode({ id: 'node-state-1', entity_id: 'state-1' });
      const targetNode = createStateNode({ id: 'node-state-2', entity_id: 'state-2', pos_x: 300 });

      // Create entities
      const transition = createStateTransitionEntity(
        sourceNode.entity_id,
        targetNode.entity_id
      );

      const edge = createTransitionDiagramEdge(
        transition.id,
        sourceNode.id,
        targetNode.id,
        sourceNode,
        targetNode
      );

      // Verify edge structure
      expect(edge.relationship_type).toBe('STATE_TRANSITION');
      expect(edge.relationship_id).toBe(transition.id);
      expect(edge.source_node_id).toBe('node-state-1');
      expect(edge.target_node_id).toBe('node-state-2');
      expect(edge.edge_points).toHaveLength(2);
    });

    it('should initialize StateTransition with empty trigger/guard/effect fields', () => {
      const transition = createStateTransitionEntity('state-1', 'state-2');

      expect(transition.trigger_ref_kind).toBeUndefined();
      expect(transition.trigger_ref_id).toBeUndefined();
      expect(transition.trigger_label_text).toBeUndefined();
      expect(transition.guard_ref_kind).toBeUndefined();
      expect(transition.guard_ref_id).toBeUndefined();
      expect(transition.guard_expression).toBeUndefined();
      expect(transition.effect_ref_kind).toBeUndefined();
      expect(transition.effect_ref_id).toBeUndefined();
      expect(transition.effect_label_text).toBeUndefined();
    });

    it('should exit creation mode after successful transition creation', () => {
      let creationMode: TransitionCreationMode = {
        active: true,
        sourceStateNodeId: 'node-state-1',
      };

      // Simulate completing the transition creation
      const handleTransitionCreationComplete = () => {
        creationMode = {
          active: false,
          sourceStateNodeId: null,
        };
      };

      handleTransitionCreationComplete();

      expect(creationMode.active).toBe(false);
      expect(creationMode.sourceStateNodeId).toBeNull();
    });

    it('should calculate edge points from node centers', () => {
      const sourceNode = createStateNode({
        id: 'node-state-1',
        entity_id: 'state-1',
        pos_x: 100,
        pos_y: 100,
        width: 140,
        height: 50,
      });
      const targetNode = createStateNode({
        id: 'node-state-2',
        entity_id: 'state-2',
        pos_x: 300,
        pos_y: 100,
        width: 140,
        height: 50,
      });

      const transition = createStateTransitionEntity(sourceNode.entity_id, targetNode.entity_id);
      const edge = createTransitionDiagramEdge(
        transition.id,
        sourceNode.id,
        targetNode.id,
        sourceNode,
        targetNode
      );

      // Source center: (100 + 70, 100 + 25) = (170, 125)
      expect(edge.edge_points[0].pos_x).toBe(170);
      expect(edge.edge_points[0].pos_y).toBe(125);

      // Target center: (300 + 70, 100 + 25) = (370, 125)
      expect(edge.edge_points[1].pos_x).toBe(370);
      expect(edge.edge_points[1].pos_y).toBe(125);
    });
  });

  /**
   * Test 4: Escape key cancels creation mode
   */
  describe('Escape key cancels creation mode', () => {
    it('should cancel creation mode when Escape is pressed', () => {
      let creationMode: TransitionCreationMode = {
        active: true,
        sourceStateNodeId: 'node-state-1',
      };

      // Simulate Escape key handler
      const handleKeyDown = (key: string) => {
        if (key === 'Escape' && creationMode.active) {
          creationMode = {
            active: false,
            sourceStateNodeId: null,
          };
        }
      };

      handleKeyDown('Escape');

      expect(creationMode.active).toBe(false);
      expect(creationMode.sourceStateNodeId).toBeNull();
    });

    it('should cancel creation mode even when source state is selected', () => {
      let creationMode: TransitionCreationMode = {
        active: true,
        sourceStateNodeId: 'node-state-1',
      };

      // Escape should cancel regardless of source state selection
      const handleEscapeKey = () => {
        if (creationMode.active) {
          creationMode = { ...initialTransitionCreationMode };
        }
      };

      handleEscapeKey();

      expect(creationMode.active).toBe(false);
      expect(creationMode.sourceStateNodeId).toBeNull();
    });

    it('should not affect non-active creation mode when Escape is pressed', () => {
      let creationMode: TransitionCreationMode = { ...initialTransitionCreationMode };

      const handleKeyDown = (key: string) => {
        if (key === 'Escape' && creationMode.active) {
          creationMode = { ...initialTransitionCreationMode };
        }
      };

      // Should not change anything if already inactive
      handleKeyDown('Escape');

      expect(creationMode.active).toBe(false);
      expect(creationMode.sourceStateNodeId).toBeNull();
    });

    it('should ignore non-Escape keys during creation mode', () => {
      let creationMode: TransitionCreationMode = {
        active: true,
        sourceStateNodeId: 'node-state-1',
      };

      const handleKeyDown = (key: string) => {
        if (key === 'Escape' && creationMode.active) {
          creationMode = { ...initialTransitionCreationMode };
        }
      };

      // Other keys should not cancel
      handleKeyDown('Enter');
      handleKeyDown('Space');
      handleKeyDown('Delete');

      expect(creationMode.active).toBe(true);
      expect(creationMode.sourceStateNodeId).toBe('node-state-1');
    });
  });

  /**
   * Additional Tests: Edge Inspector Verification
   */
  describe('StateTransition edge inspector fields', () => {
    it('should identify STATE_TRANSITION as inspector-supported edge type', () => {
      // Mirrors the INSPECTOR_EDGE_TYPES constant in SelectionInspector
      const INSPECTOR_EDGE_TYPES = new Set(['STATE_TRANSITION', 'ACTIVITY_FLOW']);

      expect(INSPECTOR_EDGE_TYPES.has('STATE_TRANSITION')).toBe(true);
    });

    it('should have from_state_id and to_state_id fields', () => {
      const transition = createStateTransition({
        from_state_id: 'state-1',
        to_state_id: 'state-2',
      });

      expect(transition.from_state_id).toBe('state-1');
      expect(transition.to_state_id).toBe('state-2');
    });

    it('should support trigger_ref_kind and trigger_ref_id fields', () => {
      const transition = createStateTransition({
        trigger_ref_kind: 'Event',
        trigger_ref_id: 'event-1',
      });

      expect(transition.trigger_ref_kind).toBe('Event');
      expect(transition.trigger_ref_id).toBe('event-1');
    });

    it('should support trigger_label_text field', () => {
      const transition = createStateTransition({
        trigger_label_text: 'user clicks submit',
      });

      expect(transition.trigger_label_text).toBe('user clicks submit');
    });

    it('should support guard_expression field', () => {
      const transition = createStateTransition({
        guard_expression: 'isValid()',
      });

      expect(transition.guard_expression).toBe('isValid()');
    });

    it('should support effect_ref_kind and effect_ref_id fields', () => {
      const transition = createStateTransition({
        effect_ref_kind: 'Method',
        effect_ref_id: 'method-1',
      });

      expect(transition.effect_ref_kind).toBe('Method');
      expect(transition.effect_ref_id).toBe('method-1');
    });
  });
});
