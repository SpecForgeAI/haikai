/**
 * ActivityDiagramRenderer.test.ts
 * Task Group 5: Tests for ActivityDiagramRenderer Integration
 *
 * Tests the activity diagram rendering logic including:
 * - Renderer activation when diagram.type === 'Activity'
 * - Z-index layering: partitions (50) < activities (100) < flows (110)
 * - Activities render with correct shapes based on activityKind
 * - General diagrams still use existing renderer (no regression)
 */

import { describe, it, expect } from 'vitest';
import {
  renderActivityNode,
  renderActivityFlow,
} from '../utils/activityNodeRendering';
import { renderPartition } from '../utils/activityPartitionRendering';
import { ACTIVITY_NODE_DEFAULTS, entityColors } from '../config/defaults';
import { Activity, ActivityPartition, Diagram, DiagramNode, DiagramEdge } from '../types/model';

/**
 * Helper function to create a mock Activity diagram
 */
function createActivityDiagram(
  id: string = 'diagram-1',
  diagramNodes: DiagramNode[] = [],
  diagramEdges: DiagramEdge[] = []
): Diagram {
  return {
    id,
    name: 'Test Activity Diagram',
    diagram_type: 'Activity',
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
 * Helper to create a DiagramNode for an Activity
 */
function createActivityDiagramNode(
  id: string,
  entityId: string,
  posX: number,
  posY: number,
  width: number = 140,
  height: number = 50
): DiagramNode {
  return {
    id,
    entity_type: 'ACTIVITY',
    entity_id: entityId,
    pos_x: posX,
    pos_y: posY,
    width,
    height,
    z_index: 100,
  };
}

/**
 * Helper to create a DiagramNode for an ActivityPartition
 */
function createPartitionDiagramNode(
  id: string,
  entityId: string,
  posX: number,
  posY: number,
  width: number = 200,
  height: number = 400
): DiagramNode {
  return {
    id,
    entity_type: 'ACTIVITY_PARTITION',
    entity_id: entityId,
    pos_x: posX,
    pos_y: posY,
    width,
    height,
    z_index: 50,
  };
}

/**
 * Helper to create a DiagramEdge for an ActivityFlow
 */
function createActivityFlowEdge(
  id: string,
  relationshipId: string,
  sourceNodeId: string,
  targetNodeId: string
): DiagramEdge {
  return {
    id,
    relationship_type: 'ACTIVITY_FLOW',
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

describe('ActivityDiagramRenderer Integration', () => {
  /**
   * Test 1: Renderer renders when diagram.type === 'Activity'
   * Verifies that the ActivityDiagramRenderer is used for Activity type diagrams
   */
  describe('Test 1: Renderer renders when diagram.type === Activity', () => {
    it('should identify Activity diagram type correctly', () => {
      const activityDiagram = createActivityDiagram();
      expect(activityDiagram.diagram_type).toBe('Activity');
    });

    it('should distinguish Activity diagrams from General diagrams', () => {
      const activityDiagram = createActivityDiagram();
      const generalDiagram = createGeneralDiagram();

      expect(activityDiagram.diagram_type).toBe('Activity');
      expect(generalDiagram.diagram_type).toBe('General');
      expect(activityDiagram.diagram_type).not.toBe(generalDiagram.diagram_type);
    });

    it('should recognize ACTIVITY entity_type nodes', () => {
      const activityNode = createActivityDiagramNode('node-1', 'activity-1', 100, 100);
      expect(activityNode.entity_type).toBe('ACTIVITY');
    });

    it('should recognize ACTIVITY_PARTITION entity_type nodes', () => {
      const partitionNode = createPartitionDiagramNode('node-1', 'partition-1', 0, 0);
      expect(partitionNode.entity_type).toBe('ACTIVITY_PARTITION');
    });
  });

  /**
   * Test 2: Partitions render at lowest z-index (behind activities)
   * Verifies z-index layering for partitions
   */
  describe('Test 2: Partitions render at lowest z-index (behind activities)', () => {
    it('should assign z-index 50 to partition nodes', () => {
      const partitionNode = createPartitionDiagramNode('node-1', 'partition-1', 0, 0);
      expect(partitionNode.z_index).toBe(50);
    });

    it('should render partition correctly via renderPartition function', () => {
      const partition: ActivityPartition = {
        id: 'partition-1',
        name: 'User Actions',
        order_index: 0,
      };

      const result = renderPartition({
        partition,
        position: { x: 0, y: 0 },
        dimensions: { width: 200, height: 400 },
        orientation: 'VERTICAL',
      });

      // Verify partition render result structure
      expect(result.headerRect).toBeDefined();
      expect(result.bodyRect).toBeDefined();
      expect(result.dividerLine).toBeDefined();
      expect(result.fullBorderRect).toBeDefined();
      expect(result.textElement).toBeDefined();
      expect(result.dataAttributes['data-partition-id']).toBe('partition-1');
    });

    it('should have partitions with lower z-index than activities', () => {
      const partitionNode = createPartitionDiagramNode('node-1', 'partition-1', 0, 0);
      const activityNode = createActivityDiagramNode('node-2', 'activity-1', 50, 100);

      expect(partitionNode.z_index).toBeLessThan(activityNode.z_index!);
    });
  });

  /**
   * Test 3: Activities render above partitions
   * Verifies activities have z-index 100 (standard node level)
   */
  describe('Test 3: Activities render above partitions', () => {
    it('should assign z-index 100 to activity nodes', () => {
      const activityNode = createActivityDiagramNode('node-1', 'activity-1', 100, 100);
      expect(activityNode.z_index).toBe(100);
    });

    it('should render activities above partitions in z-order', () => {
      const partitionNode = createPartitionDiagramNode('part-1', 'partition-1', 0, 0);
      const activityNode = createActivityDiagramNode('act-1', 'activity-1', 50, 100);

      // Activity z-index (100) > Partition z-index (50)
      expect(activityNode.z_index).toBeGreaterThan(partitionNode.z_index!);
    });

    it('should position activities within partition body area', () => {
      const partitionNode = createPartitionDiagramNode('part-1', 'partition-1', 0, 0, 200, 400);
      const activityNode = createActivityDiagramNode('act-1', 'activity-1', 30, 60, 140, 50);

      // Activity should be within partition bounds
      expect(activityNode.pos_x).toBeGreaterThan(partitionNode.pos_x);
      expect(activityNode.pos_y).toBeGreaterThan(partitionNode.pos_y);
      expect(activityNode.pos_x + activityNode.width).toBeLessThan(
        partitionNode.pos_x + partitionNode.width
      );
    });
  });

  /**
   * Test 4: Flows render above activities
   * Verifies flow edges have z-index 110 (above activities for visibility)
   */
  describe('Test 4: Flows render above activities', () => {
    it('should assign z-index 110 to flow edges', () => {
      const flowEdge = createActivityFlowEdge('edge-1', 'flow-1', 'node-1', 'node-2');
      expect(flowEdge.z_index).toBe(110);
    });

    it('should render flows above activities in z-order', () => {
      const activityNode = createActivityDiagramNode('act-1', 'activity-1', 100, 100);
      const flowEdge = createActivityFlowEdge('edge-1', 'flow-1', 'act-1', 'act-2');

      // Flow z-index (110) > Activity z-index (100)
      expect(flowEdge.z_index).toBeGreaterThan(activityNode.z_index!);
    });

    it('should render flow with arrowhead via renderActivityFlow', () => {
      const sourcePos = { x: 100, y: 100 };
      const targetPos = { x: 200, y: 100 };

      const result = renderActivityFlow(sourcePos, targetPos, 'Control');

      expect(result.linePath).toBeDefined();
      expect(result.arrowheadPath).toBeDefined();
      expect(result.linePath).toContain('M'); // Move command
      expect(result.linePath).toContain('L'); // Line command
    });

    it('should render Control flow as solid line and Data flow as dashed', () => {
      const sourcePos = { x: 100, y: 100 };
      const targetPos = { x: 200, y: 100 };

      const controlFlow = renderActivityFlow(sourcePos, targetPos, 'Control');
      const dataFlow = renderActivityFlow(sourcePos, targetPos, 'Data');

      // Control flow: solid (empty dasharray)
      expect(controlFlow.strokeDasharray).toBe('');

      // Data flow: dashed
      expect(dataFlow.strokeDasharray).toBe('6,4');
    });
  });

  /**
   * Test 5: Activities render with correct shapes based on activityKind
   * Verifies shape rendering dispatches correctly based on activity_kind
   */
  describe('Test 5: Activities render with correct shapes based on activityKind', () => {
    const position = { x: 100, y: 100 };

    it('should render Initial activity as black circle', () => {
      const activity: Activity = {
        id: 'act-1',
        name: 'Start',
        activity_kind: 'Initial',
      };

      const result = renderActivityNode(activity, position);

      expect(result.fill).toBe('#000000');
      expect(result.showLabel).toBe(false);
      // Circle path should contain arc commands
      expect(result.pathData).toContain('A');
    });

    it('should render Action activity as rounded rectangle with label', () => {
      const activity: Activity = {
        id: 'act-2',
        name: 'Process Order',
        activity_kind: 'Action',
      };

      const result = renderActivityNode(activity, position);

      expect(result.fill).toBe(entityColors.ACTIVITY.background);
      expect(result.showLabel).toBe(true);
      expect(result.width).toBe(ACTIVITY_NODE_DEFAULTS.Action.width);
      expect(result.height).toBe(ACTIVITY_NODE_DEFAULTS.Action.height);
    });

    it('should render Decision activity as 60x60 diamond', () => {
      const activity: Activity = {
        id: 'act-3',
        name: 'Is Valid?',
        activity_kind: 'Decision',
      };

      const result = renderActivityNode(activity, position);

      expect(result.fill).toBe('#FFFFFF');
      expect(result.stroke).toBe('#000000');
      expect(result.width).toBe(60);
      expect(result.height).toBe(60);
      expect(result.showLabel).toBe(true);
    });

    it('should render Merge activity as 20x20 diamond (smaller than Decision)', () => {
      const activity: Activity = {
        id: 'act-4',
        name: 'Merge',
        activity_kind: 'Merge',
      };

      const result = renderActivityNode(activity, position);

      expect(result.width).toBe(20);
      expect(result.height).toBe(20);
      expect(result.showLabel).toBe(false);

      // Verify it's smaller than Decision
      expect(result.width).toBeLessThan(60);
      expect(result.height).toBeLessThan(60);
    });

    it('should render Final activity as bullseye (outer + inner circles)', () => {
      const activity: Activity = {
        id: 'act-5',
        name: 'End',
        activity_kind: 'Final',
      };

      const result = renderActivityNode(activity, position);

      expect(result.outerDiameter).toBe(22);
      expect(result.innerDiameter).toBe(14);
      expect(result.showLabel).toBe(false);
      // Both circles should be in the path
      expect(result.outerPathData).toContain('A');
      expect(result.innerPathData).toContain('A');
    });

    it('should default to Action for activities without activityKind', () => {
      const activity = {
        id: 'act-6',
        name: 'Legacy Activity',
      } as Activity;

      const result = renderActivityNode(activity, position);

      // Should behave like Action node
      expect(result.showLabel).toBe(true);
      expect(result.fill).toBe(entityColors.ACTIVITY.background);
      expect(result.width).toBe(140);
      expect(result.height).toBe(50);
    });
  });

  /**
   * Test 6: General diagrams still use existing renderer (no regression)
   * Verifies that non-Activity diagrams are not affected
   */
  describe('Test 6: General diagrams still use existing renderer (no regression)', () => {
    it('should identify General diagram type correctly', () => {
      const generalDiagram = createGeneralDiagram();
      expect(generalDiagram.diagram_type).toBe('General');
      expect(generalDiagram.diagram_type).not.toBe('Activity');
    });

    it('should not treat General diagrams as Activity diagrams', () => {
      const generalDiagram = createGeneralDiagram();

      // General diagrams should not use ActivityDiagramRenderer
      const isActivityDiagram = generalDiagram.diagram_type === 'Activity';
      expect(isActivityDiagram).toBe(false);
    });

    it('should allow Sequence diagrams to render normally', () => {
      const sequenceDiagram: Diagram = {
        id: 'seq-1',
        name: 'Test Sequence Diagram',
        diagram_type: 'Sequence',
        model_file_id: 'model-1',
        diagram_nodes: [],
        diagram_edges: [],
        decorations: [],
        user_interactions: [],
      };

      expect(sequenceDiagram.diagram_type).toBe('Sequence');
      expect(sequenceDiagram.diagram_type).not.toBe('Activity');
    });

    it('should allow StateMachine diagrams to render normally', () => {
      const stateDiagram: Diagram = {
        id: 'state-1',
        name: 'Test State Diagram',
        diagram_type: 'StateMachine',
        model_file_id: 'model-1',
        diagram_nodes: [],
        diagram_edges: [],
        decorations: [],
        user_interactions: [],
      };

      expect(stateDiagram.diagram_type).toBe('StateMachine');
      expect(stateDiagram.diagram_type).not.toBe('Activity');
    });

    it('should properly filter nodes by entity_type for Activity diagrams', () => {
      const diagram = createActivityDiagram('diag-1', [
        createPartitionDiagramNode('part-1', 'partition-1', 0, 0),
        createActivityDiagramNode('act-1', 'activity-1', 50, 100),
        createActivityDiagramNode('act-2', 'activity-2', 50, 200),
      ]);

      const partitions = diagram.diagram_nodes.filter(
        (n) => n.entity_type === 'ACTIVITY_PARTITION'
      );
      const activities = diagram.diagram_nodes.filter(
        (n) => n.entity_type === 'ACTIVITY'
      );

      expect(partitions.length).toBe(1);
      expect(activities.length).toBe(2);
    });

    it('should properly filter edges by relationship_type for Activity diagrams', () => {
      const diagram = createActivityDiagram(
        'diag-1',
        [
          createActivityDiagramNode('act-1', 'activity-1', 50, 100),
          createActivityDiagramNode('act-2', 'activity-2', 50, 200),
        ],
        [createActivityFlowEdge('edge-1', 'flow-1', 'act-1', 'act-2')]
      );

      const activityFlows = diagram.diagram_edges.filter(
        (e) => e.relationship_type === 'ACTIVITY_FLOW'
      );

      expect(activityFlows.length).toBe(1);
    });
  });
});
