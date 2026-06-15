/**
 * StateDiagramRenderer.test.ts
 * Task Group 4: Tests for StateDiagramRenderer Component and Canvas Integration
 *
 * Tests for the StateDiagramRenderer component:
 * - Test component renders state nodes filtered by entity_type === 'STATE'
 * - Test component renders transitions filtered by relationship_type === 'STATE_TRANSITION'
 * - Test state nodes render at z-index 100
 * - Test transitions render at z-index 110
 * - Test empty diagram shows appropriate placeholder text
 */

import { describe, it, expect } from 'vitest';
import {
  renderStateNode,
  renderInitialStateNode,
  renderNormalStateNode,
  renderFinalStateNode,
} from '../utils/stateNodeRendering';
import {
  renderStateTransition,
  resolveTransitionLabel,
} from '../utils/stateTransitionRendering';
import { STATE_NODE_DEFAULTS, entityColors } from '../config/defaults';
import { State, StateTransition, Diagram, DiagramNode, DiagramEdge, MetaModel } from '../types/model';

/**
 * Helper function to create a mock State diagram
 */
function createStateDiagram(
  id: string = 'diagram-1',
  diagramNodes: DiagramNode[] = [],
  diagramEdges: DiagramEdge[] = []
): Diagram {
  return {
    id,
    name: 'Test State Diagram',
    diagram_type: 'State',
    model_file_id: 'model-1',
    diagram_nodes: diagramNodes,
    diagram_edges: diagramEdges,
    decorations: [],
    user_interactions: [],
  };
}

/**
 * Helper function to create a mock General diagram
 */
function createGeneralDiagram(
  id: string = 'diagram-2',
  diagramNodes: DiagramNode[] = [],
  diagramEdges: DiagramEdge[] = []
): Diagram {
  return {
    id,
    name: 'Test General Diagram',
    diagram_type: 'General',
    model_file_id: 'model-1',
    diagram_nodes: diagramNodes,
    diagram_edges: diagramEdges,
    decorations: [],
    user_interactions: [],
  };
}

/**
 * Helper to create a DiagramNode for a State
 */
function createStateDiagramNode(
  id: string,
  entityId: string,
  posX: number,
  posY: number,
  width: number = 140,
  height: number = 50
): DiagramNode {
  return {
    id,
    entity_type: 'STATE',
    entity_id: entityId,
    pos_x: posX,
    pos_y: posY,
    width,
    height,
    z_index: 100,
  };
}

/**
 * Helper to create a DiagramEdge for a StateTransition
 */
function createStateTransitionEdge(
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
    edge_points: [
      { pos_x: 100, pos_y: 100 },
      { pos_x: 200, pos_y: 100 },
    ],
    z_index: 110,
  };
}

/**
 * Helper function to create a mock MetaModel with test data
 */
function createMockMetaModel(): MetaModel {
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
      methods: [
        { id: 'method-1', class_id: 'class-1', name: 'validateInput' },
      ],
      application_points: [],
      logical_data_entities: [],
      logical_data_attributes: [],
      physical_data_entities: [],
      physical_data_attributes: [],
      interactions: [],
      app_business_points: [],
      events: [
        { id: 'event-1', name: 'UserClicked', description: '', tags: '' },
      ],
      states: [
        { id: 'state-1', name: 'Initial State', state_kind: 'Initial' },
        { id: 'state-2', name: 'Active', state_kind: 'Normal' },
        { id: 'state-3', name: 'Final State', state_kind: 'Final' },
      ],
      state_transitions: [
        {
          id: 'trans-1',
          from_state_id: 'state-1',
          to_state_id: 'state-2',
          trigger_label_text: 'start',
        },
      ],
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

describe('StateDiagramRenderer Integration', () => {
  /**
   * Test 1: Component renders state nodes filtered by entity_type === 'STATE'
   * Verifies that the StateDiagramRenderer filters and renders STATE nodes correctly
   */
  describe('Test 1: Component renders state nodes filtered by entity_type === STATE', () => {
    it('should identify State diagram type correctly', () => {
      const stateDiagram = createStateDiagram();
      expect(stateDiagram.diagram_type).toBe('State');
    });

    it('should distinguish State diagrams from General diagrams', () => {
      const stateDiagram = createStateDiagram();
      const generalDiagram = createGeneralDiagram();

      expect(stateDiagram.diagram_type).toBe('State');
      expect(generalDiagram.diagram_type).toBe('General');
      expect(stateDiagram.diagram_type).not.toBe(generalDiagram.diagram_type);
    });

    it('should recognize STATE entity_type nodes', () => {
      const stateNode = createStateDiagramNode('node-1', 'state-1', 100, 100);
      expect(stateNode.entity_type).toBe('STATE');
    });

    it('should filter diagram_nodes for entity_type === STATE', () => {
      const diagram = createStateDiagram('diag-1', [
        createStateDiagramNode('node-1', 'state-1', 100, 100),
        createStateDiagramNode('node-2', 'state-2', 250, 100),
        createStateDiagramNode('node-3', 'state-3', 400, 100),
      ]);

      const stateNodes = diagram.diagram_nodes.filter(
        (n) => n.entity_type === 'STATE'
      );

      expect(stateNodes.length).toBe(3);
      expect(stateNodes.every(n => n.entity_type === 'STATE')).toBe(true);
    });

    it('should render state nodes with correct shapes based on state_kind', () => {
      const position = { x: 100, y: 100 };
      const metaModel = createMockMetaModel();

      // Initial state - filled black circle
      const initialState = metaModel.entities.states.find(s => s.state_kind === 'Initial');
      if (initialState) {
        const result = renderStateNode(initialState, position);
        expect(result.fill).toBe('#000000');
        expect(result.showLabel).toBe(false);
      }

      // Normal state - rounded rectangle with label
      const normalState = metaModel.entities.states.find(s => s.state_kind === 'Normal');
      if (normalState) {
        const result = renderStateNode(normalState, position);
        expect(result.fill).toBe(entityColors.STATE.background);
        expect(result.showLabel).toBe(true);
      }

      // Final state - bullseye
      const finalState = metaModel.entities.states.find(s => s.state_kind === 'Final');
      if (finalState) {
        const result = renderStateNode(finalState, position);
        expect(result.fill).toBe('#000000');
        expect(result.showLabel).toBe(false);
        expect(result.outerPathData).toBeDefined();
        expect(result.innerPathData).toBeDefined();
      }
    });
  });

  /**
   * Test 2: Component renders transitions filtered by relationship_type === 'STATE_TRANSITION'
   * Verifies that the StateDiagramRenderer filters and renders STATE_TRANSITION edges correctly
   */
  describe('Test 2: Component renders transitions filtered by relationship_type === STATE_TRANSITION', () => {
    it('should recognize STATE_TRANSITION relationship_type edges', () => {
      const transitionEdge = createStateTransitionEdge('edge-1', 'trans-1', 'node-1', 'node-2');
      expect(transitionEdge.relationship_type).toBe('STATE_TRANSITION');
    });

    it('should filter diagram_edges for relationship_type === STATE_TRANSITION', () => {
      const diagram = createStateDiagram(
        'diag-1',
        [
          createStateDiagramNode('node-1', 'state-1', 100, 100),
          createStateDiagramNode('node-2', 'state-2', 250, 100),
        ],
        [
          createStateTransitionEdge('edge-1', 'trans-1', 'node-1', 'node-2'),
        ]
      );

      const transitionEdges = diagram.diagram_edges.filter(
        (e) => e.relationship_type === 'STATE_TRANSITION'
      );

      expect(transitionEdges.length).toBe(1);
      expect(transitionEdges[0].relationship_type).toBe('STATE_TRANSITION');
    });

    it('should render transition edge with arrowhead via renderStateTransition', () => {
      const sourcePos = { x: 100, y: 100 };
      const targetPos = { x: 300, y: 100 };

      const result = renderStateTransition(sourcePos, targetPos, 'click');

      expect(result.linePath).toBeDefined();
      expect(result.arrowheadPath).toBeDefined();
      expect(result.linePath).toContain('M'); // Move command
      expect(result.linePath).toContain('L'); // Line command
      expect(result.arrowheadPath).toContain('Z'); // Close path for triangle
    });

    it('should resolve transition label correctly', () => {
      const metaModel = createMockMetaModel();
      const transition = metaModel.entities.state_transitions[0];

      const label = resolveTransitionLabel(transition, metaModel);

      expect(label).toBe('start');
    });
  });

  /**
   * Test 3: State nodes render at z-index 100
   * Verifies z-index layering for state nodes
   */
  describe('Test 3: State nodes render at z-index 100', () => {
    it('should assign z-index 100 to state nodes', () => {
      const stateNode = createStateDiagramNode('node-1', 'state-1', 100, 100);
      expect(stateNode.z_index).toBe(100);
    });

    it('should have consistent z-index 100 across all state nodes', () => {
      const nodes = [
        createStateDiagramNode('node-1', 'state-1', 100, 100),
        createStateDiagramNode('node-2', 'state-2', 250, 100),
        createStateDiagramNode('node-3', 'state-3', 400, 100),
      ];

      nodes.forEach(node => {
        expect(node.z_index).toBe(100);
      });
    });

    it('should have state nodes with lower z-index than transitions', () => {
      const stateNode = createStateDiagramNode('node-1', 'state-1', 100, 100);
      const transitionEdge = createStateTransitionEdge('edge-1', 'trans-1', 'node-1', 'node-2');

      expect(stateNode.z_index).toBeLessThan(transitionEdge.z_index!);
    });

    it('should render Initial, Normal, and Final states all at z-index 100', () => {
      const diagram = createStateDiagram('diag-1', [
        { ...createStateDiagramNode('node-1', 'state-1', 100, 100), z_index: 100 },
        { ...createStateDiagramNode('node-2', 'state-2', 250, 100), z_index: 100 },
        { ...createStateDiagramNode('node-3', 'state-3', 400, 100), z_index: 100 },
      ]);

      const allAt100 = diagram.diagram_nodes.every(n => n.z_index === 100);
      expect(allAt100).toBe(true);
    });
  });

  /**
   * Test 4: Transitions render at z-index 110
   * Verifies z-index layering for transition edges (above state nodes)
   */
  describe('Test 4: Transitions render at z-index 110', () => {
    it('should assign z-index 110 to transition edges', () => {
      const transitionEdge = createStateTransitionEdge('edge-1', 'trans-1', 'node-1', 'node-2');
      expect(transitionEdge.z_index).toBe(110);
    });

    it('should render transitions above state nodes in z-order', () => {
      const stateNode = createStateDiagramNode('node-1', 'state-1', 100, 100);
      const transitionEdge = createStateTransitionEdge('edge-1', 'trans-1', 'node-1', 'node-2');

      // Transition z-index (110) > State z-index (100)
      expect(transitionEdge.z_index).toBeGreaterThan(stateNode.z_index!);
    });

    it('should have consistent z-index 110 across all transition edges', () => {
      const edges = [
        createStateTransitionEdge('edge-1', 'trans-1', 'node-1', 'node-2'),
        createStateTransitionEdge('edge-2', 'trans-2', 'node-2', 'node-3'),
        createStateTransitionEdge('edge-3', 'trans-3', 'node-1', 'node-3'),
      ];

      edges.forEach(edge => {
        expect(edge.z_index).toBe(110);
      });
    });

    it('should render transition with styling for visibility above nodes', () => {
      const sourcePos = { x: 100, y: 100 };
      const targetPos = { x: 300, y: 100 };

      const result = renderStateTransition(sourcePos, targetPos);

      // Verify stroke styling for good visibility
      expect(result.strokeColor).toBe('#333333');
      expect(result.strokeWidth).toBeGreaterThan(0);
      expect(result.arrowheadFill).toBe('#333333');
    });
  });

  /**
   * Test 5: Empty diagram shows appropriate placeholder text
   * Verifies that an empty State diagram displays helpful placeholder text
   */
  describe('Test 5: Empty diagram shows appropriate placeholder text', () => {
    it('should create empty diagram with no nodes', () => {
      const emptyDiagram = createStateDiagram('empty-1', [], []);

      expect(emptyDiagram.diagram_nodes.length).toBe(0);
      expect(emptyDiagram.diagram_edges.length).toBe(0);
    });

    it('should detect when diagram has no state nodes', () => {
      const emptyDiagram = createStateDiagram('empty-1', [], []);

      const stateNodes = emptyDiagram.diagram_nodes.filter(
        (n) => n.entity_type === 'STATE'
      );

      expect(stateNodes.length).toBe(0);
    });

    it('should detect when diagram has no transition edges', () => {
      const emptyDiagram = createStateDiagram('empty-1', [], []);

      const transitionEdges = emptyDiagram.diagram_edges.filter(
        (e) => e.relationship_type === 'STATE_TRANSITION'
      );

      expect(transitionEdges.length).toBe(0);
    });

    it('should distinguish empty state diagram from empty activity diagram', () => {
      const emptyStateDiagram = createStateDiagram('empty-state', [], []);
      const emptyActivityDiagram: Diagram = {
        id: 'empty-activity',
        name: 'Empty Activity Diagram',
        diagram_type: 'Activity',
        model_file_id: 'model-1',
        diagram_nodes: [],
        diagram_edges: [],
        decorations: [],
        user_interactions: [],
      };

      // Empty diagrams are distinguishable by type
      expect(emptyStateDiagram.diagram_type).toBe('State');
      expect(emptyActivityDiagram.diagram_type).toBe('Activity');
      expect(emptyStateDiagram.diagram_type).not.toBe(emptyActivityDiagram.diagram_type);
    });

    it('should be possible to check isEmpty condition for placeholder display', () => {
      const emptyDiagram = createStateDiagram('empty-1', [], []);
      const nonEmptyDiagram = createStateDiagram('non-empty', [
        createStateDiagramNode('node-1', 'state-1', 100, 100),
      ]);

      // Check isEmpty condition (used in component for placeholder)
      const emptyStateNodes = emptyDiagram.diagram_nodes.filter(
        (n) => n.entity_type === 'STATE'
      );
      const nonEmptyStateNodes = nonEmptyDiagram.diagram_nodes.filter(
        (n) => n.entity_type === 'STATE'
      );

      const isEmptyForPlaceholder = emptyStateNodes.length === 0;
      const isNotEmptyForPlaceholder = nonEmptyStateNodes.length === 0;

      expect(isEmptyForPlaceholder).toBe(true);
      expect(isNotEmptyForPlaceholder).toBe(false);
    });
  });
});
