/**
 * State Diagram UX Fixes - Integration Tests
 * Spec: 2026-01-02-state-diagram-ux-fixes
 * Task Group 4: Test Review and Gap Analysis
 *
 * Strategic integration tests to fill coverage gaps identified during review:
 * - End-to-end boundary anchoring with renderer
 * - Label defaults with renderer integration
 * - RHS palette state management
 * - Cross-feature interactions
 */

import { describe, it, expect } from 'vitest';
import {
  ShapeKind,
  getShapeKindFromStateKind,
  getEdgeBoundaryPoints,
} from '../utils/geometryUtils';
import {
  createDiagramNodeFromEntity,
} from '../utils/nodeCreation';
import {
  stateOnDiagram,
  transitionOnDiagram,
  canAddStateTransition,
  findConnectedStateTransitionEdges,
  createStateTransitionEdge,
} from '../utils/stateDiagramPaletteUtils';
import { ENTITY_TYPES, DiagramNode, DiagramEdge, StateKind, StateTransition } from '../types/model';

// ============================================================================
// Integration Test Suite: Boundary Anchoring with State Kinds
// ============================================================================

describe('State Diagram UX Fixes Integration - Boundary Anchoring', () => {
  /**
   * Test 4.1a: Full flow - Initial state (Circle) to Normal state (RoundedRect)
   * Verifies that shape kind mapping integrates correctly with boundary calculation
   */
  it('should correctly compute boundary for Initial -> Normal transition', () => {
    const initialKind: StateKind = 'Initial';
    const normalKind: StateKind = 'Normal';

    // Get shape kinds
    const sourceShape = getShapeKindFromStateKind(initialKind);
    const targetShape = getShapeKindFromStateKind(normalKind);

    expect(sourceShape).toBe(ShapeKind.Circle);
    expect(targetShape).toBe(ShapeKind.RoundedRect);

    // Create representative rectangles (using known defaults)
    // Initial: circle with diameter ~18px
    const initialRect = {
      x: 50,
      y: 100,
      width: 18,
      height: 18,
    };
    // Normal: rounded rect 140x50px
    const normalRect = {
      x: 200,
      y: 90,
      width: 140,
      height: 50,
    };

    // Calculate boundary points
    const points = getEdgeBoundaryPoints(
      initialRect,
      normalRect,
      sourceShape,
      targetShape
    );

    // Initial center: 50 + 9 = 59, 100 + 9 = 109
    // Source should be to the right of initial's center (toward target)
    expect(points.source.x).toBeGreaterThan(59);

    // Normal left edge: x = 200
    // Target should be on or near the left edge
    expect(points.target.x).toBeCloseTo(200, 0);
  });

  /**
   * Test 4.1b: Full flow - Normal state to Final state (bullseye)
   */
  it('should correctly compute boundary for Normal -> Final transition', () => {
    const normalKind: StateKind = 'Normal';
    const finalKind: StateKind = 'Final';

    const sourceShape = getShapeKindFromStateKind(normalKind);
    const targetShape = getShapeKindFromStateKind(finalKind);

    expect(sourceShape).toBe(ShapeKind.RoundedRect);
    expect(targetShape).toBe(ShapeKind.Circle);

    const normalRect = {
      x: 100,
      y: 100,
      width: 140,
      height: 50,
    };
    // Final: bullseye with outer diameter ~22px
    const finalRect = {
      x: 300,
      y: 115,
      width: 22,
      height: 22,
    };

    const points = getEdgeBoundaryPoints(
      normalRect,
      finalRect,
      sourceShape,
      targetShape
    );

    // Normal right edge: x = 100 + 140 = 240
    expect(points.source.x).toBeCloseTo(240, 0);

    // Final center: 300 + 11 = 311
    // Target should be to the left of Final's center
    const finalCenterX = finalRect.x + finalRect.width / 2;
    expect(points.target.x).toBeLessThan(finalCenterX);
  });

  /**
   * Test 4.1c: Boundary points adjust when node is repositioned
   */
  it('should recalculate boundary when node position changes', () => {
    const sourceShape = ShapeKind.RoundedRect;
    const targetShape = ShapeKind.RoundedRect;

    // Original position
    const sourceRect1 = { x: 100, y: 100, width: 140, height: 50 };
    const targetRect = { x: 400, y: 100, width: 140, height: 50 };

    const points1 = getEdgeBoundaryPoints(sourceRect1, targetRect, sourceShape, targetShape);

    // Move source node
    const sourceRect2 = { x: 200, y: 100, width: 140, height: 50 };

    const points2 = getEdgeBoundaryPoints(sourceRect2, targetRect, sourceShape, targetShape);

    // Source boundary should have moved right by 100px
    expect(points2.source.x - points1.source.x).toBeCloseTo(100, 0);
  });
});

// ============================================================================
// Integration Test Suite: Label Defaults with Rendering
// ============================================================================

describe('State Diagram UX Fixes Integration - Label Defaults', () => {
  /**
   * Test 4.2a: State node creation sets correct alignment for rendering
   */
  it('should create STATE node with alignment fields that renderer can use', () => {
    const node = createDiagramNodeFromEntity(
      ENTITY_TYPES.STATE,
      'state-render-test',
      []
    );

    // Verify fields that StateDiagramRenderer will read
    expect(node.text_h_align).toBe('CENTER');
    expect(node.text_v_align).toBe('MIDDLE');
    expect(node.entity_type).toBe('STATE');
    expect(node.width).toBeDefined();
    expect(node.height).toBeDefined();
    expect(node.pos_x).toBe(100);
    expect(node.pos_y).toBe(100);
  });

  /**
   * Test 4.2b: Non-STATE nodes do not get forced alignment
   */
  it('should not force alignment on ACTIVITY nodes', () => {
    const node = createDiagramNodeFromEntity(
      ENTITY_TYPES.ACTIVITY,
      'activity-test',
      []
    );

    // ACTIVITY nodes should use renderer's default alignment, not forced
    expect(node.text_h_align).toBeUndefined();
    expect(node.text_v_align).toBeUndefined();
  });
});

// ============================================================================
// Integration Test Suite: RHS Palette State Management
// ============================================================================

describe('State Diagram UX Fixes Integration - RHS Palette State', () => {
  /**
   * Test 4.3a: Add State creates node, subsequent check detects on-diagram
   */
  it('should detect state on diagram after node creation', () => {
    const stateId = 'state-flow-test';
    const existingNodes: DiagramNode[] = [];

    // Before: state not on diagram
    expect(stateOnDiagram(stateId, existingNodes)).toBe(false);

    // Simulate adding the node
    const newNode = createDiagramNodeFromEntity(
      ENTITY_TYPES.STATE,
      stateId,
      existingNodes
    );
    const updatedNodes = [...existingNodes, newNode];

    // After: state is on diagram
    expect(stateOnDiagram(stateId, updatedNodes)).toBe(true);
  });

  /**
   * Test 4.3b: Add StateTransition creates edge, subsequent check detects on-diagram
   */
  it('should detect transition on diagram after edge creation', () => {
    const transitionId = 'trans-flow-test';
    const existingEdges: DiagramEdge[] = [];

    // Before: transition not on diagram
    expect(transitionOnDiagram(transitionId, existingEdges)).toBe(false);

    // Simulate adding the edge
    const newEdge = createStateTransitionEdge(
      'edge-1',
      transitionId,
      'node-1',
      'node-2'
    );
    const updatedEdges = [...existingEdges, newEdge];

    // After: transition is on diagram
    expect(transitionOnDiagram(transitionId, updatedEdges)).toBe(true);
  });

  /**
   * Test 4.3c: Delete State should identify connected edges for cascade
   */
  it('should find all connected edges for cascade delete', () => {
    const nodeIdToDelete = 'node-target';

    const edges: DiagramEdge[] = [
      // Edge where node is source
      createStateTransitionEdge('edge-1', 'trans-1', nodeIdToDelete, 'node-other'),
      // Edge where node is target
      createStateTransitionEdge('edge-2', 'trans-2', 'node-other', nodeIdToDelete),
      // Unrelated edge
      createStateTransitionEdge('edge-3', 'trans-3', 'node-a', 'node-b'),
    ];

    const connectedEdges = findConnectedStateTransitionEdges(nodeIdToDelete, edges);

    expect(connectedEdges).toHaveLength(2);
    expect(connectedEdges.map(e => e.id).sort()).toEqual(['edge-1', 'edge-2']);
  });
});

// ============================================================================
// Integration Test Suite: Add StateTransition Validation Flow
// ============================================================================

describe('State Diagram UX Fixes Integration - Add Transition Flow', () => {
  /**
   * Test 4.4a: Full validation flow with valid endpoints
   */
  it('should validate and provide node IDs for valid transition', () => {
    const transition: StateTransition = {
      id: 'trans-valid',
      from_state_id: 'state-a',
      to_state_id: 'state-b',
    };

    const diagramNodes: DiagramNode[] = [
      {
        id: 'node-a',
        entity_type: 'STATE',
        entity_id: 'state-a',
        pos_x: 100,
        pos_y: 100,
        width: 140,
        height: 50,
        z_index: 100,
      },
      {
        id: 'node-b',
        entity_type: 'STATE',
        entity_id: 'state-b',
        pos_x: 300,
        pos_y: 100,
        width: 140,
        height: 50,
        z_index: 100,
      },
    ];

    const result = canAddStateTransition(transition, diagramNodes);

    expect(result.canAdd).toBe(true);
    expect(result.sourceNodeId).toBe('node-a');
    expect(result.targetNodeId).toBe('node-b');
    expect(result.missingEndpoint).toBeUndefined();
  });

  /**
   * Test 4.4b: Validation identifies specific missing endpoint
   */
  it('should identify which endpoint is missing', () => {
    const transition: StateTransition = {
      id: 'trans-partial',
      from_state_id: 'state-present',
      to_state_id: 'state-missing',
    };

    const diagramNodes: DiagramNode[] = [
      {
        id: 'node-present',
        entity_type: 'STATE',
        entity_id: 'state-present',
        pos_x: 100,
        pos_y: 100,
        width: 140,
        height: 50,
        z_index: 100,
      },
    ];

    const result = canAddStateTransition(transition, diagramNodes);

    expect(result.canAdd).toBe(false);
    expect(result.missingEndpoint).toBe('target');
    expect(result.sourceNodeId).toBe('node-present');
    expect(result.targetNodeId).toBeUndefined();
  });

  /**
   * Test 4.4c: Edge creation with validated node IDs
   */
  it('should create valid edge from validation result', () => {
    const transition: StateTransition = {
      id: 'trans-create',
      from_state_id: 'state-src',
      to_state_id: 'state-tgt',
    };

    const diagramNodes: DiagramNode[] = [
      {
        id: 'node-src',
        entity_type: 'STATE',
        entity_id: 'state-src',
        pos_x: 100,
        pos_y: 100,
        width: 140,
        height: 50,
        z_index: 100,
      },
      {
        id: 'node-tgt',
        entity_type: 'STATE',
        entity_id: 'state-tgt',
        pos_x: 300,
        pos_y: 100,
        width: 140,
        height: 50,
        z_index: 100,
      },
    ];

    const validation = canAddStateTransition(transition, diagramNodes);
    expect(validation.canAdd).toBe(true);

    // Create edge using validated IDs
    const edge = createStateTransitionEdge(
      'edge-new',
      transition.id,
      validation.sourceNodeId!,
      validation.targetNodeId!
    );

    expect(edge.id).toBe('edge-new');
    expect(edge.relationship_type).toBe('STATE_TRANSITION');
    expect(edge.relationship_id).toBe('trans-create');
    expect(edge.source_node_id).toBe('node-src');
    expect(edge.target_node_id).toBe('node-tgt');
    expect(edge.z_index).toBe(110);
  });
});

// ============================================================================
// Cross-Feature Integration Tests
// ============================================================================

describe('State Diagram UX Fixes Integration - Cross-Feature', () => {
  /**
   * Test 4.5a: Boundary anchoring uses correct shape for Initial state node
   */
  it('should use Circle boundary for Initial state node', () => {
    // Create a STATE node for an Initial state
    const node = createDiagramNodeFromEntity(
      ENTITY_TYPES.STATE,
      'initial-state-id',
      []
    );

    // The state_kind would come from the State entity in meta-model
    // but we're testing the shape mapping directly
    const initialKind: StateKind = 'Initial';
    const shapeKind = getShapeKindFromStateKind(initialKind);

    expect(shapeKind).toBe(ShapeKind.Circle);

    // Verify the node has the expected structure for boundary calc
    expect(node.pos_x).toBeDefined();
    expect(node.pos_y).toBeDefined();
    expect(node.width).toBeDefined();
    expect(node.height).toBeDefined();
  });

  /**
   * Test 4.5b: Cascade delete finds edges with both Circle and RoundedRect endpoints
   */
  it('should find edges regardless of endpoint state kinds', () => {
    // Node for an Initial state (Circle)
    const initialNodeId = 'node-initial';
    // Node for a Normal state (RoundedRect)
    const normalNodeId = 'node-normal';
    // Node for a Final state (Circle)
    const finalNodeId = 'node-final';

    const edges: DiagramEdge[] = [
      createStateTransitionEdge('edge-1', 'trans-1', initialNodeId, normalNodeId),
      createStateTransitionEdge('edge-2', 'trans-2', normalNodeId, finalNodeId),
    ];

    // Delete Normal node should cascade both edges
    const connectedToNormal = findConnectedStateTransitionEdges(normalNodeId, edges);
    expect(connectedToNormal).toHaveLength(2);

    // Delete Initial should cascade only edge-1
    const connectedToInitial = findConnectedStateTransitionEdges(initialNodeId, edges);
    expect(connectedToInitial).toHaveLength(1);
    expect(connectedToInitial[0].id).toBe('edge-1');

    // Delete Final should cascade only edge-2
    const connectedToFinal = findConnectedStateTransitionEdges(finalNodeId, edges);
    expect(connectedToFinal).toHaveLength(1);
    expect(connectedToFinal[0].id).toBe('edge-2');
  });
});
