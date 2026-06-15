/**
 * State Diagram RHS Palette Tests
 * Spec: 2026-01-02-state-diagram-ux-fixes
 * Task Group 3: RHS Palette Layer
 *
 * Tests for RHS palette functionality for State diagrams:
 * - Test stateOnDiagram helper returns true when State has a node on diagram
 * - Test transitionOnDiagram helper returns true when StateTransition has an edge
 * - Test Delete State removes node and cascades to remove connected edges
 * - Test Delete StateTransition removes edge only (not nodes)
 * - Test Add State creates node at (100,100)
 * - Test Add StateTransition blocks with warning if endpoints missing
 */

import { describe, it, expect } from 'vitest';
import type { DiagramNode, DiagramEdge, State, StateTransition, MetaModel, Diagram } from '../types/model';
import {
  stateOnDiagram,
  transitionOnDiagram,
  findConnectedStateTransitionEdges,
  canAddStateTransition,
} from '../utils/stateDiagramPaletteUtils';

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
 * Create a State entity
 */
function createState(id: string, name: string, stateKind: 'Initial' | 'Normal' | 'Final' = 'Normal'): State {
  return {
    id,
    name,
    state_kind: stateKind,
  };
}

/**
 * Create a StateTransition entity
 */
function createTransition(id: string, fromStateId: string, toStateId: string): StateTransition {
  return {
    id,
    from_state_id: fromStateId,
    to_state_id: toStateId,
  };
}

/**
 * Create a DiagramNode for a State
 */
function createStateNode(nodeId: string, stateId: string, posX = 100, posY = 100): DiagramNode {
  return {
    id: nodeId,
    entity_type: 'STATE',
    entity_id: stateId,
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
  edgeId: string,
  transitionId: string,
  sourceNodeId: string,
  targetNodeId: string
): DiagramEdge {
  return {
    id: edgeId,
    relationship_type: 'STATE_TRANSITION',
    relationship_id: transitionId,
    source_node_id: sourceNodeId,
    target_node_id: targetNodeId,
    edge_points: [],
    z_index: 110,
  };
}

// ============================================================================
// Test Suite: stateOnDiagram Helper
// ============================================================================

describe('State Diagram RHS Palette - stateOnDiagram Helper', () => {
  /**
   * Test 3.1a: stateOnDiagram returns true when State has a node on diagram
   */
  it('should return true when State has a corresponding DiagramNode', () => {
    const stateId = 'state-1';
    const diagramNodes: DiagramNode[] = [
      createStateNode('node-1', stateId),
    ];

    const result = stateOnDiagram(stateId, diagramNodes);

    expect(result).toBe(true);
  });

  /**
   * Test 3.1b: stateOnDiagram returns false when State has no node on diagram
   */
  it('should return false when State has no corresponding DiagramNode', () => {
    const stateId = 'state-not-on-diagram';
    const diagramNodes: DiagramNode[] = [
      createStateNode('node-1', 'other-state'),
    ];

    const result = stateOnDiagram(stateId, diagramNodes);

    expect(result).toBe(false);
  });

  /**
   * Test 3.1c: stateOnDiagram returns false for empty diagram
   */
  it('should return false for empty diagram', () => {
    const stateId = 'state-1';
    const diagramNodes: DiagramNode[] = [];

    const result = stateOnDiagram(stateId, diagramNodes);

    expect(result).toBe(false);
  });

  /**
   * Test 3.1d: stateOnDiagram ignores nodes with different entity_type
   */
  it('should ignore nodes with non-STATE entity_type', () => {
    const stateId = 'state-1';
    const diagramNodes: DiagramNode[] = [
      {
        id: 'node-1',
        entity_type: 'ACTIVITY', // Wrong type
        entity_id: stateId,
        pos_x: 100,
        pos_y: 100,
        width: 140,
        height: 50,
        z_index: 100,
      },
    ];

    const result = stateOnDiagram(stateId, diagramNodes);

    expect(result).toBe(false);
  });
});

// ============================================================================
// Test Suite: transitionOnDiagram Helper
// ============================================================================

describe('State Diagram RHS Palette - transitionOnDiagram Helper', () => {
  /**
   * Test 3.2a: transitionOnDiagram returns true when StateTransition has an edge
   */
  it('should return true when StateTransition has a corresponding DiagramEdge', () => {
    const transitionId = 'trans-1';
    const diagramEdges: DiagramEdge[] = [
      createTransitionEdge('edge-1', transitionId, 'node-1', 'node-2'),
    ];

    const result = transitionOnDiagram(transitionId, diagramEdges);

    expect(result).toBe(true);
  });

  /**
   * Test 3.2b: transitionOnDiagram returns false when StateTransition has no edge
   */
  it('should return false when StateTransition has no corresponding DiagramEdge', () => {
    const transitionId = 'trans-not-on-diagram';
    const diagramEdges: DiagramEdge[] = [
      createTransitionEdge('edge-1', 'other-trans', 'node-1', 'node-2'),
    ];

    const result = transitionOnDiagram(transitionId, diagramEdges);

    expect(result).toBe(false);
  });

  /**
   * Test 3.2c: transitionOnDiagram returns false for empty edges array
   */
  it('should return false when diagram has no edges', () => {
    const transitionId = 'trans-1';
    const diagramEdges: DiagramEdge[] = [];

    const result = transitionOnDiagram(transitionId, diagramEdges);

    expect(result).toBe(false);
  });

  /**
   * Test 3.2d: transitionOnDiagram ignores edges with different relationship_type
   */
  it('should ignore edges with non-STATE_TRANSITION relationship_type', () => {
    const transitionId = 'trans-1';
    const diagramEdges: DiagramEdge[] = [
      {
        id: 'edge-1',
        relationship_type: 'ACTIVITY_FLOW', // Wrong type
        relationship_id: transitionId,
        source_node_id: 'node-1',
        target_node_id: 'node-2',
        edge_points: [],
        z_index: 110,
      },
    ];

    const result = transitionOnDiagram(transitionId, diagramEdges);

    expect(result).toBe(false);
  });
});

// ============================================================================
// Test Suite: Connected Edge Detection (for Delete Cascade)
// ============================================================================

describe('State Diagram RHS Palette - Connected Edge Detection', () => {
  /**
   * Test 3.3a: findConnectedStateTransitionEdges finds edges by source_node_id
   */
  it('should find edges connected via source_node_id', () => {
    const nodeId = 'node-1';
    const diagramEdges: DiagramEdge[] = [
      createTransitionEdge('edge-1', 'trans-1', nodeId, 'node-2'),
      createTransitionEdge('edge-2', 'trans-2', 'node-3', nodeId), // target, not source
    ];

    const result = findConnectedStateTransitionEdges(nodeId, diagramEdges);

    expect(result).toHaveLength(2);
    expect(result.map(e => e.id)).toContain('edge-1');
    expect(result.map(e => e.id)).toContain('edge-2');
  });

  /**
   * Test 3.3b: findConnectedStateTransitionEdges finds edges by target_node_id
   */
  it('should find edges connected via target_node_id', () => {
    const nodeId = 'node-2';
    const diagramEdges: DiagramEdge[] = [
      createTransitionEdge('edge-1', 'trans-1', 'node-1', nodeId),
    ];

    const result = findConnectedStateTransitionEdges(nodeId, diagramEdges);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('edge-1');
  });

  /**
   * Test 3.3c: findConnectedStateTransitionEdges returns empty array when no connections
   */
  it('should return empty array when no edges connect to node', () => {
    const nodeId = 'node-unconnected';
    const diagramEdges: DiagramEdge[] = [
      createTransitionEdge('edge-1', 'trans-1', 'node-1', 'node-2'),
    ];

    const result = findConnectedStateTransitionEdges(nodeId, diagramEdges);

    expect(result).toHaveLength(0);
  });

  /**
   * Test 3.3d: findConnectedStateTransitionEdges only returns STATE_TRANSITION edges
   */
  it('should only return STATE_TRANSITION relationship_type edges', () => {
    const nodeId = 'node-1';
    const diagramEdges: DiagramEdge[] = [
      createTransitionEdge('edge-1', 'trans-1', nodeId, 'node-2'),
      {
        id: 'edge-2',
        relationship_type: 'ACTIVITY_FLOW',
        relationship_id: 'flow-1',
        source_node_id: nodeId,
        target_node_id: 'node-3',
        edge_points: [],
        z_index: 110,
      },
    ];

    const result = findConnectedStateTransitionEdges(nodeId, diagramEdges);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('edge-1');
  });
});

// ============================================================================
// Test Suite: Add StateTransition Validation
// ============================================================================

describe('State Diagram RHS Palette - Add StateTransition Validation', () => {
  /**
   * Test 3.4a: canAddStateTransition returns true when both endpoints on diagram
   */
  it('should return canAdd: true when both source and target states are on diagram', () => {
    const transition = createTransition('trans-1', 'state-1', 'state-2');
    const diagramNodes: DiagramNode[] = [
      createStateNode('node-1', 'state-1'),
      createStateNode('node-2', 'state-2'),
    ];

    const result = canAddStateTransition(transition, diagramNodes);

    expect(result.canAdd).toBe(true);
    expect(result.sourceNodeId).toBe('node-1');
    expect(result.targetNodeId).toBe('node-2');
  });

  /**
   * Test 3.4b: canAddStateTransition returns false when source not on diagram
   */
  it('should return canAdd: false when source state is not on diagram', () => {
    const transition = createTransition('trans-1', 'state-missing', 'state-2');
    const diagramNodes: DiagramNode[] = [
      createStateNode('node-2', 'state-2'),
    ];

    const result = canAddStateTransition(transition, diagramNodes);

    expect(result.canAdd).toBe(false);
    expect(result.missingEndpoint).toBe('source');
  });

  /**
   * Test 3.4c: canAddStateTransition returns false when target not on diagram
   */
  it('should return canAdd: false when target state is not on diagram', () => {
    const transition = createTransition('trans-1', 'state-1', 'state-missing');
    const diagramNodes: DiagramNode[] = [
      createStateNode('node-1', 'state-1'),
    ];

    const result = canAddStateTransition(transition, diagramNodes);

    expect(result.canAdd).toBe(false);
    expect(result.missingEndpoint).toBe('target');
  });

  /**
   * Test 3.4d: canAddStateTransition returns false when both endpoints missing
   */
  it('should return canAdd: false when both endpoints are missing', () => {
    const transition = createTransition('trans-1', 'state-1', 'state-2');
    const diagramNodes: DiagramNode[] = [];

    const result = canAddStateTransition(transition, diagramNodes);

    expect(result.canAdd).toBe(false);
    expect(result.missingEndpoint).toBe('both');
  });

  /**
   * Test 3.4e: Self-transition is valid when state is on diagram
   */
  it('should allow self-transition when state is on diagram', () => {
    const transition = createTransition('trans-self', 'state-1', 'state-1');
    const diagramNodes: DiagramNode[] = [
      createStateNode('node-1', 'state-1'),
    ];

    const result = canAddStateTransition(transition, diagramNodes);

    expect(result.canAdd).toBe(true);
    expect(result.sourceNodeId).toBe('node-1');
    expect(result.targetNodeId).toBe('node-1');
  });
});
