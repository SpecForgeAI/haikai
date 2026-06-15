/**
 * UI Workflow Diagram Palette Tests
 * Spec 2026-01-02: Phase 1 UI Architecture - Increment 1
 * Task Group 10: Frontend Tests
 *
 * Tests for the RHS palette behavior when working with UI_Workflow diagrams:
 * - UIScreen grey-out when already on diagram
 * - UIWorkflowTransition grey-out when already on diagram
 * - UIWorkflowTransition disabled when endpoints missing
 */

import {
  uiScreenOnDiagram,
  uiWorkflowTransitionOnDiagram,
  findConnectedUIWorkflowTransitionEdges,
  canAddUIWorkflowTransition,
  createUIWorkflowTransitionEdge,
} from '../utils/uiWorkflowDiagramPaletteUtils';
import type { DiagramNode, DiagramEdge, UIWorkflowTransition } from '../types/model';

// ============================================================================
// Test Data Factories
// ============================================================================

function createMockUIScreenNode(screenId: string, nodeId?: string): DiagramNode {
  return {
    id: nodeId || `node-${screenId}`,
    entity_type: 'UI_SCREEN',
    entity_id: screenId,
    pos_x: 100,
    pos_y: 100,
    width: 150,
    height: 80,
    z_index: 100,
  };
}

function createMockUIWorkflowTransitionEdge(
  transitionId: string,
  sourceNodeId: string,
  targetNodeId: string,
  edgeId?: string
): DiagramEdge {
  return {
    id: edgeId || `edge-${transitionId}`,
    relationship_type: 'UI_WORKFLOW_TRANSITION',
    relationship_id: transitionId,
    source_node_id: sourceNodeId,
    target_node_id: targetNodeId,
    edge_points: [],
    z_index: 110,
  };
}

function createMockUIWorkflowTransition(
  id: string,
  sourceScreenId: string,
  targetScreenId: string
): UIWorkflowTransition {
  return {
    id,
    name: `Transition ${id}`,
    source_screen_id: sourceScreenId,
    target_screen_id: targetScreenId,
  };
}

// ============================================================================
// Tests: uiScreenOnDiagram
// ============================================================================

describe('uiScreenOnDiagram', () => {
  it('returns true when UIScreen has a node on diagram', () => {
    const screenId = 'screen-1';
    const nodes: DiagramNode[] = [createMockUIScreenNode(screenId)];

    expect(uiScreenOnDiagram(screenId, nodes)).toBe(true);
  });

  it('returns false when UIScreen has no node on diagram', () => {
    const nodes: DiagramNode[] = [createMockUIScreenNode('screen-2')];

    expect(uiScreenOnDiagram('screen-1', nodes)).toBe(false);
  });

  it('returns false for empty diagram', () => {
    expect(uiScreenOnDiagram('screen-1', [])).toBe(false);
  });

  it('ignores nodes with different entity types', () => {
    const nodes: DiagramNode[] = [
      {
        id: 'node-1',
        entity_type: 'STATE', // Not UI_SCREEN
        entity_id: 'screen-1',
        pos_x: 100,
        pos_y: 100,
        width: 150,
        height: 80,
        z_index: 100,
      },
    ];

    expect(uiScreenOnDiagram('screen-1', nodes)).toBe(false);
  });
});

// ============================================================================
// Tests: uiWorkflowTransitionOnDiagram
// ============================================================================

describe('uiWorkflowTransitionOnDiagram', () => {
  it('returns true when UIWorkflowTransition has an edge on diagram', () => {
    const transitionId = 'transition-1';
    const edges: DiagramEdge[] = [
      createMockUIWorkflowTransitionEdge(transitionId, 'node-1', 'node-2'),
    ];

    expect(uiWorkflowTransitionOnDiagram(transitionId, edges)).toBe(true);
  });

  it('returns false when UIWorkflowTransition has no edge on diagram', () => {
    const edges: DiagramEdge[] = [
      createMockUIWorkflowTransitionEdge('transition-2', 'node-1', 'node-2'),
    ];

    expect(uiWorkflowTransitionOnDiagram('transition-1', edges)).toBe(false);
  });

  it('returns false for empty diagram edges', () => {
    expect(uiWorkflowTransitionOnDiagram('transition-1', [])).toBe(false);
  });

  it('ignores edges with different relationship types', () => {
    const edges: DiagramEdge[] = [
      {
        id: 'edge-1',
        relationship_type: 'STATE_TRANSITION', // Not UI_WORKFLOW_TRANSITION
        relationship_id: 'transition-1',
        source_node_id: 'node-1',
        target_node_id: 'node-2',
        edge_points: [],
        z_index: 110,
      },
    ];

    expect(uiWorkflowTransitionOnDiagram('transition-1', edges)).toBe(false);
  });
});

// ============================================================================
// Tests: findConnectedUIWorkflowTransitionEdges
// ============================================================================

describe('findConnectedUIWorkflowTransitionEdges', () => {
  it('finds edges where node is the source', () => {
    const nodeId = 'node-1';
    const edges: DiagramEdge[] = [
      createMockUIWorkflowTransitionEdge('t1', nodeId, 'node-2'),
      createMockUIWorkflowTransitionEdge('t2', 'node-3', 'node-4'),
    ];

    const result = findConnectedUIWorkflowTransitionEdges(nodeId, edges);
    expect(result).toHaveLength(1);
    expect(result[0].relationship_id).toBe('t1');
  });

  it('finds edges where node is the target', () => {
    const nodeId = 'node-2';
    const edges: DiagramEdge[] = [
      createMockUIWorkflowTransitionEdge('t1', 'node-1', nodeId),
      createMockUIWorkflowTransitionEdge('t2', 'node-3', 'node-4'),
    ];

    const result = findConnectedUIWorkflowTransitionEdges(nodeId, edges);
    expect(result).toHaveLength(1);
    expect(result[0].relationship_id).toBe('t1');
  });

  it('finds multiple edges connected to a node', () => {
    const nodeId = 'node-1';
    const edges: DiagramEdge[] = [
      createMockUIWorkflowTransitionEdge('t1', nodeId, 'node-2'),
      createMockUIWorkflowTransitionEdge('t2', 'node-3', nodeId),
      createMockUIWorkflowTransitionEdge('t3', 'node-4', 'node-5'),
    ];

    const result = findConnectedUIWorkflowTransitionEdges(nodeId, edges);
    expect(result).toHaveLength(2);
  });

  it('returns empty array when no edges connected', () => {
    const edges: DiagramEdge[] = [
      createMockUIWorkflowTransitionEdge('t1', 'node-1', 'node-2'),
    ];

    const result = findConnectedUIWorkflowTransitionEdges('node-unconnected', edges);
    expect(result).toHaveLength(0);
  });

  it('ignores non-UIWorkflowTransition edges', () => {
    const nodeId = 'node-1';
    const edges: DiagramEdge[] = [
      {
        id: 'edge-1',
        relationship_type: 'STATE_TRANSITION',
        relationship_id: 't1',
        source_node_id: nodeId,
        target_node_id: 'node-2',
        edge_points: [],
        z_index: 110,
      },
    ];

    const result = findConnectedUIWorkflowTransitionEdges(nodeId, edges);
    expect(result).toHaveLength(0);
  });
});

// ============================================================================
// Tests: canAddUIWorkflowTransition
// ============================================================================

describe('canAddUIWorkflowTransition', () => {
  it('returns canAdd: true when both screens are on diagram', () => {
    const transition = createMockUIWorkflowTransition('t1', 'screen-1', 'screen-2');
    const nodes: DiagramNode[] = [
      createMockUIScreenNode('screen-1', 'node-1'),
      createMockUIScreenNode('screen-2', 'node-2'),
    ];

    const result = canAddUIWorkflowTransition(transition, nodes);

    expect(result.canAdd).toBe(true);
    expect(result.sourceNodeId).toBe('node-1');
    expect(result.targetNodeId).toBe('node-2');
    expect(result.missingEndpoint).toBeUndefined();
  });

  it('returns canAdd: false with missingEndpoint: source when source missing', () => {
    const transition = createMockUIWorkflowTransition('t1', 'screen-1', 'screen-2');
    const nodes: DiagramNode[] = [
      createMockUIScreenNode('screen-2', 'node-2'), // Only target on diagram
    ];

    const result = canAddUIWorkflowTransition(transition, nodes);

    expect(result.canAdd).toBe(false);
    expect(result.sourceNodeId).toBeUndefined();
    expect(result.targetNodeId).toBe('node-2');
    expect(result.missingEndpoint).toBe('source');
  });

  it('returns canAdd: false with missingEndpoint: target when target missing', () => {
    const transition = createMockUIWorkflowTransition('t1', 'screen-1', 'screen-2');
    const nodes: DiagramNode[] = [
      createMockUIScreenNode('screen-1', 'node-1'), // Only source on diagram
    ];

    const result = canAddUIWorkflowTransition(transition, nodes);

    expect(result.canAdd).toBe(false);
    expect(result.sourceNodeId).toBe('node-1');
    expect(result.targetNodeId).toBeUndefined();
    expect(result.missingEndpoint).toBe('target');
  });

  it('returns canAdd: false with missingEndpoint: both when both missing', () => {
    const transition = createMockUIWorkflowTransition('t1', 'screen-1', 'screen-2');
    const nodes: DiagramNode[] = [
      createMockUIScreenNode('screen-3', 'node-3'), // Neither endpoint on diagram
    ];

    const result = canAddUIWorkflowTransition(transition, nodes);

    expect(result.canAdd).toBe(false);
    expect(result.sourceNodeId).toBeUndefined();
    expect(result.targetNodeId).toBeUndefined();
    expect(result.missingEndpoint).toBe('both');
  });

  it('returns canAdd: false for empty diagram', () => {
    const transition = createMockUIWorkflowTransition('t1', 'screen-1', 'screen-2');

    const result = canAddUIWorkflowTransition(transition, []);

    expect(result.canAdd).toBe(false);
    expect(result.missingEndpoint).toBe('both');
  });

  it('allows self-loop transitions', () => {
    const transition = createMockUIWorkflowTransition('t1', 'screen-1', 'screen-1');
    const nodes: DiagramNode[] = [createMockUIScreenNode('screen-1', 'node-1')];

    const result = canAddUIWorkflowTransition(transition, nodes);

    expect(result.canAdd).toBe(true);
    expect(result.sourceNodeId).toBe('node-1');
    expect(result.targetNodeId).toBe('node-1');
  });
});

// ============================================================================
// Tests: createUIWorkflowTransitionEdge
// ============================================================================

describe('createUIWorkflowTransitionEdge', () => {
  it('creates a valid DiagramEdge', () => {
    const edge = createUIWorkflowTransitionEdge(
      'edge-1',
      'transition-1',
      'node-source',
      'node-target'
    );

    expect(edge.id).toBe('edge-1');
    expect(edge.relationship_type).toBe('UI_WORKFLOW_TRANSITION');
    expect(edge.relationship_id).toBe('transition-1');
    expect(edge.source_node_id).toBe('node-source');
    expect(edge.target_node_id).toBe('node-target');
    expect(edge.arrow_end).toBe('ARROW');
    expect(edge.z_index).toBe(110);
    expect(edge.edge_points).toEqual([]);
  });
});
