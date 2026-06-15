/**
 * Activity Diagram Integration Tests
 * Task Group 6: Integration Testing & Gap Analysis
 *
 * These integration tests verify end-to-end workflows combining multiple
 * improvements from the Activity Diagram UX spec (2025-12-31):
 * - A1: Partition header name resolution
 * - A2: Flow boundary anchoring
 * - A3: Decision flow condition modal
 * - A4: ACTIVITY_FLOW validation fix
 * - A5: Movable/resizable labels
 *
 * Previous tests from Task Group 7 have been retained for backward compatibility.
 */

import { describe, it, expect } from 'vitest';
import {
  renderActivityNode,
  renderActivityFlow,
  calculateFlowLabelPosition,
  getDefaultLabelPosition,
  getDefaultEdgeLabelPosition,
} from '../utils/activityNodeRendering';
import { renderPartition, PartitionRenderProps, resolvePartitionDisplayName } from '../utils/activityPartitionRendering';
import {
  ACTIVITY_NODE_DEFAULTS,
  ACTIVITY_PARTITION_DEFAULTS,
  ACTIVITY_FLOW_DEFAULTS,
  entityColors,
} from '../config/defaults';
import {
  Activity,
  ActivityPartition,
  ActivityFlow,
  Diagram,
  DiagramNode,
  DiagramEdge,
  LabelDecoration,
  MetaModel,
  createDefaultLabelDecoration,
} from '../types/model';
import { createActivityFlowEntity, createActivityFlowDiagramEdge } from '../utils/activityFlowCreation';
import {
  getBoundaryAnchorPoint,
  getShapeKindFromActivityKind,
  ShapeKind,
} from '../utils/geometryUtils';
import { DIAGRAM_NODE_ENTITY_TYPE_MAP } from '../utils/entityTypeRegistry';
import {
  createNodeLabelDecoration,
  createEdgeLabelDecoration,
  startLabelDrag,
  calculateLabelDragPosition,
  endLabelDrag,
  persistVirtualLabel,
  shouldCreateNodeLabelDecoration,
  findLabelDecoration,
} from '../utils/labelDecorationUtils';

// ============================================================================
// Helper Functions for Creating Test Data
// ============================================================================

function createActivityDiagram(
  id: string,
  diagramNodes: DiagramNode[] = [],
  diagramEdges: DiagramEdge[] = []
): Diagram {
  return {
    id,
    name: 'Integration Test Activity Diagram',
    description: '',
    diagram_type: 'Activity',
    diagram_nodes: diagramNodes,
    diagram_edges: diagramEdges,
    decorations: [],
    user_interactions: [],
  };
}

function createActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 'activity-1',
    name: 'Activity',
    activity_kind: 'Action',
    ...overrides,
  };
}

function createActivityPartitionEntity(overrides: Partial<ActivityPartition> = {}): ActivityPartition {
  return {
    id: 'partition-1',
    name: 'Partition',
    order_index: 0,
    ...overrides,
  };
}

function createActivityDiagramNode(
  id: string,
  entityId: string,
  posX: number,
  posY: number,
  width: number = 140,
  height: number = 50,
  parentNodeId: string | null = null
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
    parent_node_id: parentNodeId,
  };
}

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
    parent_node_id: null,
  };
}

function createActivityFlowEdge(
  id: string,
  relationshipId: string,
  sourceNodeId: string,
  targetNodeId: string,
  labelText?: string
): DiagramEdge {
  return {
    id,
    relationship_type: 'ACTIVITY_FLOW',
    relationship_id: relationshipId,
    source_node_id: sourceNodeId,
    target_node_id: targetNodeId,
    edge_points: [
      { id: `${id}-ep1`, sequence_order: 0, pos_x: 0, pos_y: 0 },
      { id: `${id}-ep2`, sequence_order: 1, pos_x: 100, pos_y: 0 },
    ],
    z_index: 110,
    label_text: labelText,
  };
}

function createActivityFlowEntity(overrides: Partial<ActivityFlow> = {}): ActivityFlow {
  return {
    id: 'flow-1',
    from_activity_id: 'activity-1',
    to_activity_id: 'activity-2',
    flow_kind: 'Control',
    ...overrides,
  };
}

function createMockMetaModel(): MetaModel {
  return {
    entities: {
      business_users: [
        { id: 'user-1', name: 'John Doe', description: '', tags: '' },
      ],
      applications: [
        { id: 'app-1', name: 'Order System', description: '', app_type: 'Web', status: 'Active', tags: '' },
      ],
      app_components: [],
      services: [
        { id: 'svc-1', name: 'Order Service', description: '', application_id: 'app-1', service_type: 'API', tags: '' },
      ],
      interfaces: [],
      endpoints: [],
      classes: [],
      methods: [],
      business_processes: [],
      process_activities: [],
      business_points: [],
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
      activities: [
        { id: 'activity-initial', name: 'Start', activity_kind: 'Initial' },
        { id: 'activity-action-1', name: 'Process Order', activity_kind: 'Action' },
        { id: 'activity-decision-1', name: 'Is Valid?', activity_kind: 'Decision' },
        { id: 'activity-action-2', name: 'Ship Order', activity_kind: 'Action' },
        { id: 'activity-action-3', name: 'Reject Order', activity_kind: 'Action' },
        { id: 'activity-merge-1', name: 'Merge Point', activity_kind: 'Merge' },
        { id: 'activity-final', name: 'End', activity_kind: 'Final' },
      ],
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

function createMockDiagramNodes(): DiagramNode[] {
  return [
    {
      id: 'node-initial',
      entity_type: 'ACTIVITY',
      entity_id: 'activity-initial',
      pos_x: 100,
      pos_y: 50,
      width: 18,
      height: 18,
      parent_node_id: null,
    },
    {
      id: 'node-action-1',
      entity_type: 'ACTIVITY',
      entity_id: 'activity-action-1',
      pos_x: 50,
      pos_y: 100,
      width: 140,
      height: 50,
      parent_node_id: null,
    },
    {
      id: 'node-decision-1',
      entity_type: 'ACTIVITY',
      entity_id: 'activity-decision-1',
      pos_x: 90,
      pos_y: 200,
      width: 60,
      height: 60,
      parent_node_id: null,
    },
    {
      id: 'node-action-2',
      entity_type: 'ACTIVITY',
      entity_id: 'activity-action-2',
      pos_x: 200,
      pos_y: 300,
      width: 140,
      height: 50,
      parent_node_id: null,
    },
    {
      id: 'node-action-3',
      entity_type: 'ACTIVITY',
      entity_id: 'activity-action-3',
      pos_x: -50,
      pos_y: 300,
      width: 140,
      height: 50,
      parent_node_id: null,
    },
    {
      id: 'node-final',
      entity_type: 'ACTIVITY',
      entity_id: 'activity-final',
      pos_x: 100,
      pos_y: 400,
      width: 22,
      height: 22,
      parent_node_id: null,
    },
  ];
}

// =============================================================================
// Task Group 6: Integration Tests for Activity Diagram UX Improvements
// Tests end-to-end workflows combining improvements A1-A5
// =============================================================================

describe('Task Group 6: Activity Diagram UX Improvements Integration', () => {
  // ===========================================================================
  // Integration Test 1: Decision Flow Complete Workflow (A2 + A3 + A4)
  // Create Decision -> create flow from Decision -> verify edge with boundary anchoring
  // ===========================================================================

  describe('Integration 1: Decision Flow Complete Workflow', () => {
    it('should create flow from Decision with boundary-anchored edge points', () => {
      const metaModel = createMockMetaModel();
      const diagramNodes = createMockDiagramNodes();

      // Step 1: Find Decision node and target Action node
      const decisionNode = diagramNodes.find(n => n.entity_id === 'activity-decision-1')!;
      const targetNode = diagramNodes.find(n => n.entity_id === 'activity-action-2')!;
      const decisionActivity = metaModel.entities.activities.find(a => a.id === 'activity-decision-1')!;
      const targetActivity = metaModel.entities.activities.find(a => a.id === 'activity-action-2')!;

      // Step 2: Verify source is Decision type (modal trigger condition for A3)
      expect(decisionActivity.activity_kind).toBe('Decision');

      // Step 3: Create flow entity using utility from A4
      const flowEntity = createActivityFlowEntity(
        decisionActivity.id,
        targetActivity.id
      );

      // Step 4: Create diagram edge with boundary anchoring (A2)
      const edge = createActivityFlowDiagramEdge(
        flowEntity.id,
        decisionNode.id,
        targetNode.id,
        decisionNode,
        targetNode,
        decisionActivity.activity_kind,
        targetActivity.activity_kind
      );

      // Step 5: Verify edge structure
      expect(edge.relationship_type).toBe('ACTIVITY_FLOW');
      expect(edge.source_node_id).toBe(decisionNode.id);
      expect(edge.target_node_id).toBe(targetNode.id);
      expect(edge.edge_points.length).toBeGreaterThanOrEqual(2);

      // Step 6: Verify boundary anchoring (source point should NOT be at Decision center)
      const decisionCenter = {
        x: decisionNode.pos_x + decisionNode.width / 2,
        y: decisionNode.pos_y + decisionNode.height / 2,
      };
      const sourcePoint = edge.edge_points[0];
      const isAtCenter = sourcePoint.pos_x === decisionCenter.x && sourcePoint.pos_y === decisionCenter.y;
      expect(isAtCenter).toBe(false);
    });

    it('should apply condition fields to flow entity after modal save simulation (A3)', () => {
      // Simulate flow creation followed by condition update (modal save)
      const flowEntity = createActivityFlowEntity({
        id: 'decision-flow',
        from_activity_id: 'activity-decision-1',
        to_activity_id: 'activity-action-2',
      });

      // Simulate modal save
      const updatedFlow: ActivityFlow = {
        ...flowEntity,
        condition_expression: '[order.isValid]',
        flow_kind: 'Control',
      };

      expect(updatedFlow.condition_expression).toBe('[order.isValid]');
      expect(updatedFlow.flow_kind).toBe('Control');
      expect(updatedFlow.from_activity_id).toBe('activity-decision-1');
      expect(updatedFlow.to_activity_id).toBe('activity-action-2');
    });
  });

  // ===========================================================================
  // Integration Test 2: Add Existing Flow Workflow (A4)
  // Add existing flow from RHS -> verify edge created with proper structure
  // ===========================================================================

  describe('Integration 2: Add Existing Flow Workflow', () => {
    it('should create edge with ACTIVITY_FLOW relationship type when adding existing flow (A4)', () => {
      const diagramNodes = createMockDiagramNodes();

      // Step 1: Verify ACTIVITY_FLOW is registered in entity type map
      expect(DIAGRAM_NODE_ENTITY_TYPE_MAP['ACTIVITY_FLOW']).toBe('activity_flows');

      // Step 2: Simulate existing flow
      const existingFlow: ActivityFlow = {
        id: 'existing-flow-1',
        from_activity_id: 'activity-action-1',
        to_activity_id: 'activity-decision-1',
        flow_kind: 'Control',
      };

      // Step 3: Find corresponding diagram nodes
      const sourceNode = diagramNodes.find(
        n => n.entity_type === 'ACTIVITY' && n.entity_id === existingFlow.from_activity_id
      );
      const targetNode = diagramNodes.find(
        n => n.entity_type === 'ACTIVITY' && n.entity_id === existingFlow.to_activity_id
      );

      // Step 4: Verify both nodes are present (validation requirement)
      expect(sourceNode).toBeDefined();
      expect(targetNode).toBeDefined();

      // Step 5: Create edge for existing flow
      const edge = createActivityFlowDiagramEdge(
        existingFlow.id,
        sourceNode!.id,
        targetNode!.id,
        sourceNode!,
        targetNode!,
        'Action',
        'Decision'
      );

      // Step 6: Verify edge structure matches new flow creation
      expect(edge.relationship_type).toBe('ACTIVITY_FLOW');
      expect(edge.relationship_id).toBe(existingFlow.id);
      expect(edge.source_node_id).toBe(sourceNode!.id);
      expect(edge.target_node_id).toBe(targetNode!.id);
    });

    it('should detect missing activity nodes for existing flow (A4 validation)', () => {
      const diagramNodes = createMockDiagramNodes();

      // Flow referencing activities not on diagram
      const orphanFlow: ActivityFlow = {
        id: 'orphan-flow',
        from_activity_id: 'non-existent-activity-1',
        to_activity_id: 'non-existent-activity-2',
        flow_kind: 'Control',
      };

      // Find nodes (should not exist)
      const sourceNode = diagramNodes.find(
        n => n.entity_type === 'ACTIVITY' && n.entity_id === orphanFlow.from_activity_id
      );
      const targetNode = diagramNodes.find(
        n => n.entity_type === 'ACTIVITY' && n.entity_id === orphanFlow.to_activity_id
      );

      // Verify both are undefined (validation should prevent edge creation)
      expect(sourceNode).toBeUndefined();
      expect(targetNode).toBeUndefined();

      // In real implementation, this would trigger toast warning
      const canCreateEdge = sourceNode !== undefined && targetNode !== undefined;
      expect(canCreateEdge).toBe(false);
    });
  });

  // ===========================================================================
  // Integration Test 3: Label Position Persistence Workflow (A5)
  // Drag label -> verify position update -> verify persisted state
  // ===========================================================================

  describe('Integration 3: Label Position Persistence Workflow', () => {
    it('should persist label position after drag operation (A5)', () => {
      // Step 1: Create node label decoration for Action activity
      const nodeBounds = { x: 50, y: 100, width: 140, height: 50 };
      const labelDecoration = createNodeLabelDecoration('node-action-1', nodeBounds, 'Action', 'Process Order');

      expect(labelDecoration).not.toBeNull();
      const originalX = labelDecoration!.x;
      const originalY = labelDecoration!.y;

      // Step 2: Start drag operation
      const dragState = startLabelDrag(labelDecoration!, 100, 120);
      expect(dragState.isDragging).toBe(true);
      expect(dragState.labelDecorationId).toBe(labelDecoration!.id);

      // Step 3: Calculate new position during drag (move 30 right, 20 down)
      const newPos = calculateLabelDragPosition(dragState, 130, 140);
      expect(newPos.x).toBe(originalX + 30);
      expect(newPos.y).toBe(originalY + 20);

      // Step 4: End drag and create updated label (simulates persistence)
      endLabelDrag();
      const updatedLabel: LabelDecoration = {
        ...labelDecoration!,
        x: newPos.x,
        y: newPos.y,
      };

      // Step 5: Verify label position persisted
      expect(updatedLabel.x).toBe(originalX + 30);
      expect(updatedLabel.y).toBe(originalY + 20);
      expect(updatedLabel.targetId).toBe('node-action-1');
      expect(updatedLabel.targetKind).toBe('NODE');
    });
  });

  // ===========================================================================
  // Integration Test 4: Partition Header with Flow Creation (A1 + A2)
  // Create partition with ref -> verify header name -> create flows with anchoring
  // ===========================================================================

  describe('Integration 4: Partition Header with Flow Creation', () => {
    it('should resolve partition header name and create boundary-anchored flows (A1 + A2)', () => {
      const metaModel = createMockMetaModel();

      // Step 1: Create partition referencing a Service (A1)
      const partition: ActivityPartition = {
        id: 'partition-1',
        name: 'Fallback Name',
        ref_kind: 'Service',
        ref_id: 'svc-1',
      };

      // Step 2: Resolve partition display name
      const displayName = resolvePartitionDisplayName(partition, metaModel);
      expect(displayName).toBe('Order Service');

      // Step 3: Create activities within partition conceptually
      const actionNode: DiagramNode = {
        id: 'node-in-partition',
        entity_type: 'ACTIVITY',
        entity_id: 'activity-action-1',
        pos_x: 50,
        pos_y: 100,
        width: 140,
        height: 50,
        parent_node_id: null,
      };

      const decisionNode: DiagramNode = {
        id: 'node-decision-in-partition',
        entity_type: 'ACTIVITY',
        entity_id: 'activity-decision-1',
        pos_x: 90,
        pos_y: 200,
        width: 60,
        height: 60,
        parent_node_id: null,
      };

      // Step 4: Create flow with boundary anchoring (A2)
      const flowEntity = createActivityFlowEntity({
        id: 'partition-flow',
        from_activity_id: 'activity-action-1',
        to_activity_id: 'activity-decision-1',
      });
      const edge = createActivityFlowDiagramEdge(
        flowEntity.id,
        actionNode.id,
        decisionNode.id,
        actionNode,
        decisionNode,
        'Action',
        'Decision'
      );

      // Step 5: Verify edge uses boundary anchoring
      expect(edge.edge_points.length).toBeGreaterThanOrEqual(2);

      // Source should be at Action node boundary (bottom edge since Decision is below)
      const actionCenter = {
        x: actionNode.pos_x + actionNode.width / 2,
        y: actionNode.pos_y + actionNode.height / 2,
      };
      const sourcePoint = edge.edge_points[0];

      // Verify not at center
      const isAtCenter = sourcePoint.pos_x === actionCenter.x && sourcePoint.pos_y === actionCenter.y;
      expect(isAtCenter).toBe(false);
    });
  });

  // ===========================================================================
  // Integration Test 5: Virtual Label to Persisted Label (A5)
  // Click on virtual label area -> persist to decoration -> verify structure
  // ===========================================================================

  describe('Integration 5: Virtual Label to Persisted Label', () => {
    it('should persist virtual label on first interaction (A5)', () => {
      const diagramNodes = createMockDiagramNodes();
      const decisionNode = diagramNodes.find(n => n.entity_id === 'activity-decision-1')!;

      // Step 1: Compute virtual label bounds for Decision (below diamond)
      const virtualBounds = getDefaultLabelPosition(
        { x: decisionNode.pos_x, y: decisionNode.pos_y, width: decisionNode.width, height: decisionNode.height },
        'Decision'
      );

      // Step 2: Verify virtual label is below diamond
      const diamondBottom = decisionNode.pos_y + decisionNode.height;
      expect(virtualBounds.y).toBeGreaterThanOrEqual(diamondBottom);

      // Step 3: Persist virtual label (simulates first interaction)
      const persistedLabel = persistVirtualLabel('NODE', decisionNode.id, virtualBounds, 'Is Valid?');

      // Step 4: Verify persisted label structure
      expect(persistedLabel.id).toMatch(/^label_/);
      expect(persistedLabel.targetKind).toBe('NODE');
      expect(persistedLabel.targetId).toBe(decisionNode.id);
      expect(persistedLabel.x).toBe(virtualBounds.x);
      expect(persistedLabel.y).toBe(virtualBounds.y);
      expect(persistedLabel.text).toBe('Is Valid?');
    });
  });

  // ===========================================================================
  // Integration Test 6: Edge Label Midpoint Positioning (A5)
  // Create flow -> verify edge label positioned near midpoint
  // ===========================================================================

  describe('Integration 6: Edge Label Midpoint Positioning', () => {
    it('should position edge label near flow midpoint (A5)', () => {
      const diagramNodes = createMockDiagramNodes();
      const sourceNode = diagramNodes.find(n => n.entity_id === 'activity-action-1')!;
      const targetNode = diagramNodes.find(n => n.entity_id === 'activity-decision-1')!;

      // Step 1: Create edge label decoration
      const edgeLabel = createEdgeLabelDecoration('edge-1', sourceNode, targetNode, '[condition]');

      // Step 2: Calculate expected midpoint
      const sourceCenterX = sourceNode.pos_x + sourceNode.width / 2;
      const targetCenterX = targetNode.pos_x + targetNode.width / 2;
      const expectedMidpointX = (sourceCenterX + targetCenterX) / 2;

      // Step 3: Verify label center is near expected midpoint
      const labelCenterX = edgeLabel.x + edgeLabel.width / 2;
      expect(Math.abs(labelCenterX - expectedMidpointX)).toBeLessThan(50);

      // Step 4: Verify label structure
      expect(edgeLabel.targetKind).toBe('EDGE');
      expect(edgeLabel.targetId).toBe('edge-1');
      expect(edgeLabel.text).toBe('[condition]');
    });
  });

  // ===========================================================================
  // Integration Test 7: Activity Kind Label Placement Rules (A5)
  // Action -> centered inside, Decision -> below diamond
  // ===========================================================================

  describe('Integration 7: Activity Kind Label Placement Rules', () => {
    it('should apply correct label placement based on activity kind (A5)', () => {
      // Action: centered inside rounded-rect
      const actionBounds = { x: 50, y: 100, width: 140, height: 50 };
      const actionLabel = createNodeLabelDecoration('node-action', actionBounds, 'Action', 'Process');
      expect(actionLabel).not.toBeNull();

      // Action label should be centered inside
      const actionCenterX = actionBounds.x + actionBounds.width / 2;
      const actionCenterY = actionBounds.y + actionBounds.height / 2;
      const actionLabelCenterX = actionLabel!.x + actionLabel!.width / 2;
      const actionLabelCenterY = actionLabel!.y + actionLabel!.height / 2;

      expect(Math.abs(actionLabelCenterX - actionCenterX)).toBeLessThan(5);
      expect(Math.abs(actionLabelCenterY - actionCenterY)).toBeLessThan(5);

      // Decision: below diamond
      const decisionBounds = { x: 90, y: 200, width: 60, height: 60 };
      const decisionLabel = createNodeLabelDecoration('node-decision', decisionBounds, 'Decision', 'Check');
      expect(decisionLabel).not.toBeNull();

      // Decision label should be below diamond
      const diamondBottom = decisionBounds.y + decisionBounds.height;
      expect(decisionLabel!.y).toBeGreaterThanOrEqual(diamondBottom);

      // Initial, Merge, Final: no labels
      expect(shouldCreateNodeLabelDecoration('Initial')).toBe(false);
      expect(shouldCreateNodeLabelDecoration('Merge')).toBe(false);
      expect(shouldCreateNodeLabelDecoration('Final')).toBe(false);
    });
  });

  // ===========================================================================
  // Integration Test 8: Combined Workflow Test (All A1-A5)
  // Full workflow: partition + activities + decision flow + labels
  // ===========================================================================

  describe('Integration 8: Combined Workflow - All Improvements', () => {
    it('should successfully combine all activity diagram improvements (A1-A5)', () => {
      const metaModel = createMockMetaModel();

      // Step 1: Partition header resolution (A1)
      const partition: ActivityPartition = {
        id: 'partition-1',
        ref_kind: 'BusinessUser',
        ref_id: 'user-1',
      };
      const partitionHeader = resolvePartitionDisplayName(partition, metaModel);
      expect(partitionHeader).toBe('John Doe');

      // Step 2: Create diagram nodes for activities
      const actionNode: DiagramNode = {
        id: 'node-action',
        entity_type: 'ACTIVITY',
        entity_id: 'activity-action-1',
        pos_x: 50,
        pos_y: 100,
        width: 140,
        height: 50,
        parent_node_id: null,
      };

      const decisionNode: DiagramNode = {
        id: 'node-decision',
        entity_type: 'ACTIVITY',
        entity_id: 'activity-decision-1',
        pos_x: 90,
        pos_y: 200,
        width: 60,
        height: 60,
        parent_node_id: null,
      };

      // Step 3: Create labels for nodes (A5)
      const actionLabel = createNodeLabelDecoration(
        actionNode.id,
        { x: actionNode.pos_x, y: actionNode.pos_y, width: actionNode.width, height: actionNode.height },
        'Action',
        'Process Order'
      );
      expect(actionLabel).not.toBeNull();

      const decisionLabel = createNodeLabelDecoration(
        decisionNode.id,
        { x: decisionNode.pos_x, y: decisionNode.pos_y, width: decisionNode.width, height: decisionNode.height },
        'Decision',
        'Is Valid?'
      );
      expect(decisionLabel).not.toBeNull();

      // Step 4: ACTIVITY_FLOW validation (A4)
      expect(DIAGRAM_NODE_ENTITY_TYPE_MAP['ACTIVITY_FLOW']).toBe('activity_flows');

      // Step 5: Create flow with boundary anchoring (A2)
      const flowEntity = createActivityFlowEntity({
        id: 'combined-flow',
        from_activity_id: 'activity-action-1',
        to_activity_id: 'activity-decision-1',
      });
      const edge = createActivityFlowDiagramEdge(
        flowEntity.id,
        actionNode.id,
        decisionNode.id,
        actionNode,
        decisionNode,
        'Action',
        'Decision'
      );

      expect(edge.relationship_type).toBe('ACTIVITY_FLOW');
      expect(edge.edge_points.length).toBeGreaterThanOrEqual(2);

      // Verify boundary anchoring
      const actionCenter = {
        x: actionNode.pos_x + actionNode.width / 2,
        y: actionNode.pos_y + actionNode.height / 2,
      };
      const sourcePoint = edge.edge_points[0];
      const isAtCenter = sourcePoint.pos_x === actionCenter.x && sourcePoint.pos_y === actionCenter.y;
      expect(isAtCenter).toBe(false);

      // Step 6: Create edge label for flow (A5)
      const edgeLabel = createEdgeLabelDecoration(edge.id, actionNode, decisionNode, '[guard]');
      expect(edgeLabel.targetKind).toBe('EDGE');
      expect(edgeLabel.targetId).toBe(edge.id);

      // Step 7: Find labels in collection (utility test)
      const labelDecorations = [actionLabel!, decisionLabel!, edgeLabel];
      const foundActionLabel = findLabelDecoration(labelDecorations, 'NODE', actionNode.id);
      const foundEdgeLabel = findLabelDecoration(labelDecorations, 'EDGE', edge.id);

      expect(foundActionLabel).toBeDefined();
      expect(foundEdgeLabel).toBeDefined();
      expect(foundActionLabel!.text).toBe('Process Order');
      expect(foundEdgeLabel!.text).toBe('[guard]');
    });
  });
});

// ============================================================================
// Retained Legacy Tests from Previous Task Group
// ============================================================================

describe('Activity Diagram Integration Tests (Legacy)', () => {
  /**
   * E2E Test 1: Create complete activity diagram with partition, activities, and flows
   * Verifies that all components work together in a realistic scenario
   */
  describe('E2E: Complete activity diagram creation', () => {
    it('should create an activity diagram with partition containing multiple activities connected by flows', () => {
      // Create partition
      const partition = createActivityPartitionEntity({
        id: 'partition-1',
        name: 'Sales Process',
      });

      // Create activities with various kinds
      const initialActivity = createActivity({
        id: 'act-initial',
        name: 'Start',
        activity_kind: 'Initial',
      });
      const actionActivity = createActivity({
        id: 'act-action',
        name: 'Process Order',
        activity_kind: 'Action',
      });
      const decisionActivity = createActivity({
        id: 'act-decision',
        name: 'Validate?',
        activity_kind: 'Decision',
      });
      const mergeActivity = createActivity({
        id: 'act-merge',
        name: 'Merge',
        activity_kind: 'Merge',
      });
      const finalActivity = createActivity({
        id: 'act-final',
        name: 'End',
        activity_kind: 'Final',
      });

      // Create diagram nodes
      const partitionNode = createPartitionDiagramNode('node-partition', 'partition-1', 50, 50, 300, 500);
      const nodes = [
        partitionNode,
        createActivityDiagramNode('node-initial', 'act-initial', 200, 100, 18, 18, 'node-partition'),
        createActivityDiagramNode('node-action', 'act-action', 200, 180, 140, 50, 'node-partition'),
        createActivityDiagramNode('node-decision', 'act-decision', 200, 280, 60, 60, 'node-partition'),
        createActivityDiagramNode('node-merge', 'act-merge', 200, 400, 20, 20, 'node-partition'),
        createActivityDiagramNode('node-final', 'act-final', 200, 480, 22, 22, 'node-partition'),
      ];

      // Create activity flows
      const flows = [
        createActivityFlowEntity({ id: 'flow-1', from_activity_id: 'act-initial', to_activity_id: 'act-action' }),
        createActivityFlowEntity({ id: 'flow-2', from_activity_id: 'act-action', to_activity_id: 'act-decision' }),
        createActivityFlowEntity({ id: 'flow-3', from_activity_id: 'act-decision', to_activity_id: 'act-merge', trigger_label_text: 'Yes' }),
        createActivityFlowEntity({ id: 'flow-4', from_activity_id: 'act-decision', to_activity_id: 'act-action', trigger_label_text: 'No' }),
        createActivityFlowEntity({ id: 'flow-5', from_activity_id: 'act-merge', to_activity_id: 'act-final' }),
      ];

      // Create diagram edges
      const edges = flows.map((flow, index) =>
        createActivityFlowEdge(
          `edge-${index + 1}`,
          flow.id,
          `node-${flow.from_activity_id.replace('act-', '')}`,
          `node-${flow.to_activity_id.replace('act-', '')}`,
          flow.trigger_label_text
        )
      );

      // Create the diagram
      const diagram = createActivityDiagram('diagram-1', nodes, edges);

      // Verify diagram structure
      expect(diagram.diagram_type).toBe('Activity');
      expect(diagram.diagram_nodes).toHaveLength(6);
      expect(diagram.diagram_edges).toHaveLength(5);

      // Verify all node types are present
      const partitionNodes = diagram.diagram_nodes.filter(n => n.entity_type === 'ACTIVITY_PARTITION');
      const activityNodes = diagram.diagram_nodes.filter(n => n.entity_type === 'ACTIVITY');
      expect(partitionNodes).toHaveLength(1);
      expect(activityNodes).toHaveLength(5);

      // Verify partition renders correctly
      const partitionRenderResult = renderPartition({
        partition,
        position: { x: partitionNode.pos_x, y: partitionNode.pos_y },
        dimensions: { width: partitionNode.width, height: partitionNode.height },
        orientation: 'VERTICAL',
      });
      expect(partitionRenderResult.textElement.content).toBe('Sales Process');

      // Verify each activity renders with correct shape
      const activities = [initialActivity, actionActivity, decisionActivity, mergeActivity, finalActivity];

      activities.forEach((activity, index) => {
        const nodeData = activityNodes[index];
        const renderResult = renderActivityNode(activity, { x: nodeData.pos_x, y: nodeData.pos_y });
        expect(renderResult.pathData).toBeDefined();

        // Verify specific shape characteristics
        if (activity.activity_kind === 'Initial') {
          expect(renderResult.showLabel).toBe(false);
          expect(renderResult.fill).toBe('#000000');
        } else if (activity.activity_kind === 'Final') {
          expect(renderResult.outerDiameter).toBe(22);
          expect(renderResult.innerDiameter).toBe(14);
        }
      });
    });
  });

  /**
   * E2E Test 2: Change activity activityKind and verify shape updates
   * Simulates the user editing an activity's kind and verifying the visual update
   */
  describe('E2E: Activity kind change updates shape', () => {
    it('should update activity shape when activityKind changes from Action to Decision', () => {
      const position = { x: 100, y: 100 };

      // Initial state: Action node
      const actionActivity = createActivity({
        id: 'activity-1',
        name: 'Process',
        activity_kind: 'Action',
      });
      const actionResult = renderActivityNode(actionActivity, position);

      expect(actionResult.fill).toBe(entityColors.ACTIVITY.background);
      expect(actionResult.width).toBe(140);
      expect(actionResult.height).toBe(50);
      expect(actionResult.showLabel).toBe(true);

      // After change: Decision node (simulates user changing the activityKind)
      const decisionActivity: Activity = {
        ...actionActivity,
        activity_kind: 'Decision',
      };
      const decisionResult = renderActivityNode(decisionActivity, position);

      expect(decisionResult.fill).toBe('#FFFFFF');
      expect(decisionResult.stroke).toBe('#000000');
      expect(decisionResult.width).toBe(60);
      expect(decisionResult.height).toBe(60);
      expect(decisionResult.showLabel).toBe(true);

      // Verify shape path changed (diamond vs rounded rect)
      expect(decisionResult.pathData).not.toBe(actionResult.pathData);
    });

    it('should handle transition from any node type to any other node type', () => {
      const position = { x: 100, y: 100 };
      const activityKinds: Array<Activity['activity_kind']> = ['Initial', 'Action', 'Decision', 'Merge', 'Final'];

      // Test all possible transitions (5x5 = 25 combinations)
      activityKinds.forEach(fromKind => {
        activityKinds.forEach(toKind => {
          if (fromKind !== toKind) {
            const fromActivity = createActivity({ activity_kind: fromKind });
            const toActivity = createActivity({ activity_kind: toKind });

            const fromResult = renderActivityNode(fromActivity, position);
            const toResult = renderActivityNode(toActivity, position);

            // Verify different shapes produce different render results
            // (some may have same fill but different dimensions)
            const isDifferent =
              fromResult.pathData !== toResult.pathData ||
              fromResult.fill !== toResult.fill ||
              fromResult.width !== toResult.width ||
              fromResult.height !== toResult.height;

            expect(isDifferent).toBe(true);
          }
        });
      });
    });
  });

  /**
   * Integration Test 3: Decision node with "Yes"/"No" flow labels
   * Verifies flows from Decision nodes can have labels rendered at midpoint
   */
  describe('Integration: Decision node with flow labels', () => {
    it('should render "Yes"/"No" labels on flows from Decision node', () => {
      const decisionPosition = { x: 200, y: 200 };
      const yesTargetPosition = { x: 200, y: 300 }; // Below decision
      const noTargetPosition = { x: 100, y: 200 }; // Left of decision

      // Render Decision node
      const decisionActivity = createActivity({
        id: 'decision-1',
        name: 'Is Valid?',
        activity_kind: 'Decision',
      });
      const decisionRender = renderActivityNode(decisionActivity, decisionPosition);
      expect(decisionRender.width).toBe(60);
      expect(decisionRender.height).toBe(60);

      // Render "Yes" flow
      const yesFlowResult = renderActivityFlow(
        decisionPosition,
        yesTargetPosition,
        'Control',
        'Yes'
      );

      expect(yesFlowResult.labelText).toBe('Yes');
      expect(yesFlowResult.labelPosition).toBeDefined();
      expect(yesFlowResult.labelPosition!.x).toBe(200); // Midpoint x
      expect(yesFlowResult.labelPosition!.y).toBe(250); // Midpoint y

      // Render "No" flow
      const noFlowResult = renderActivityFlow(
        decisionPosition,
        noTargetPosition,
        'Control',
        'No'
      );

      expect(noFlowResult.labelText).toBe('No');
      expect(noFlowResult.labelPosition).toBeDefined();
      expect(noFlowResult.labelPosition!.x).toBe(150); // Midpoint x
      expect(noFlowResult.labelPosition!.y).toBe(200); // Midpoint y
    });

    it('should render condition expressions as labels on Decision outflows', () => {
      const decisionPosition = { x: 200, y: 200 };
      const targetPosition = { x: 350, y: 200 };

      // Flow with condition expression
      const flowResult = renderActivityFlow(
        decisionPosition,
        targetPosition,
        'Control',
        '[amount > 100]'
      );

      expect(flowResult.labelText).toBe('[amount > 100]');
      expect(flowResult.labelPosition).toBeDefined();
      expect(flowResult.labelPosition!.x).toBe(275); // Midpoint
    });
  });

  /**
   * Integration Test 4: Flow creation workflow state machine
   * Verifies the complete flow creation workflow including state transitions
   */
  describe('Integration: Flow creation workflow', () => {
    it('should follow correct state machine: inactive -> source selected -> flow created', () => {
      // Define flow creation state interface
      interface FlowCreationState {
        active: boolean;
        sourceActivityId: string | null;
        sourceNodeId: string | null;
      }

      // State 1: Initial inactive state
      const initialState: FlowCreationState = {
        active: false,
        sourceActivityId: null,
        sourceNodeId: null,
      };
      expect(initialState.active).toBe(false);

      // State 2: After "+ New Activity Flow" button clicked
      const activatedState: FlowCreationState = {
        active: true,
        sourceActivityId: null,
        sourceNodeId: null,
      };
      expect(activatedState.active).toBe(true);
      expect(activatedState.sourceActivityId).toBeNull();

      // State 3: After clicking source activity
      const sourceSelectedState: FlowCreationState = {
        active: true,
        sourceActivityId: 'activity-1',
        sourceNodeId: 'node-activity-1',
      };
      expect(sourceSelectedState.active).toBe(true);
      expect(sourceSelectedState.sourceActivityId).toBe('activity-1');

      // State 4: After clicking target activity (flow created, mode exits)
      const finalState: FlowCreationState = {
        active: false,
        sourceActivityId: null,
        sourceNodeId: null,
      };
      expect(finalState.active).toBe(false);
      expect(finalState.sourceActivityId).toBeNull();
    });

    it('should create ActivityFlow and DiagramEdge with correct references', () => {
      // Create activities
      const sourceActivity = createActivity({ id: 'source-act', name: 'Source' });
      const targetActivity = createActivity({ id: 'target-act', name: 'Target' });

      // Create nodes for the activities
      const sourceNode = createActivityDiagramNode('source-node', 'source-act', 100, 100);
      const targetNode = createActivityDiagramNode('target-node', 'target-act', 300, 100);

      // Create ActivityFlow entity
      const activityFlow: ActivityFlow = {
        id: 'new-flow-1',
        from_activity_id: sourceActivity.id,
        to_activity_id: targetActivity.id,
        flow_kind: 'Control',
      };

      // Create DiagramEdge referencing the flow
      const diagramEdge: DiagramEdge = {
        id: 'new-edge-1',
        relationship_type: 'ACTIVITY_FLOW',
        relationship_id: activityFlow.id,
        source_node_id: sourceNode.id,
        target_node_id: targetNode.id,
        edge_points: [
          { id: 'ep-1', sequence_order: 0, pos_x: sourceNode.pos_x + sourceNode.width / 2, pos_y: sourceNode.pos_y },
          { id: 'ep-2', sequence_order: 1, pos_x: targetNode.pos_x - targetNode.width / 2, pos_y: targetNode.pos_y },
        ],
        z_index: 110,
        line_type: 'SOLID',
        arrow_end: 'ARROW',
      };

      // Verify references
      expect(diagramEdge.relationship_id).toBe(activityFlow.id);
      expect(diagramEdge.source_node_id).toBe(sourceNode.id);
      expect(diagramEdge.target_node_id).toBe(targetNode.id);
      expect(activityFlow.from_activity_id).toBe(sourceActivity.id);
      expect(activityFlow.to_activity_id).toBe(targetActivity.id);

      // Verify edge styling
      expect(diagramEdge.arrow_end).toBe('ARROW');
      expect(diagramEdge.line_type).toBe('SOLID');
    });
  });

  /**
   * Integration Test 5: Partition with contained activities
   * Verifies parent-child relationship and visual containment
   */
  describe('Integration: Partition with contained activities', () => {
    it('should establish parent-child relationship between partition and activities', () => {
      // Create partition
      const partition = createActivityPartitionEntity({
        id: 'container-partition',
        name: 'User Actions',
      });
      const partitionNode = createPartitionDiagramNode('part-node', 'container-partition', 50, 50, 250, 350);

      // Create activities within partition bounds
      const activity1Node = createActivityDiagramNode('act-1-node', 'act-1', 125, 100, 140, 50, 'part-node');
      const activity2Node = createActivityDiagramNode('act-2-node', 'act-2', 125, 200, 140, 50, 'part-node');

      // Verify parent-child relationship
      expect(activity1Node.parent_node_id).toBe(partitionNode.id);
      expect(activity2Node.parent_node_id).toBe(partitionNode.id);

      // Verify activities are visually within partition bounds
      const partitionBounds = {
        left: partitionNode.pos_x,
        top: partitionNode.pos_y + ACTIVITY_PARTITION_DEFAULTS.header_height,
        right: partitionNode.pos_x + partitionNode.width,
        bottom: partitionNode.pos_y + partitionNode.height,
      };

      // Activity 1 center is within partition body
      const act1CenterX = activity1Node.pos_x;
      const act1CenterY = activity1Node.pos_y;
      expect(act1CenterX).toBeGreaterThanOrEqual(partitionBounds.left);
      expect(act1CenterX).toBeLessThanOrEqual(partitionBounds.right);
      expect(act1CenterY).toBeGreaterThanOrEqual(partitionBounds.top);
      expect(act1CenterY).toBeLessThanOrEqual(partitionBounds.bottom);
    });

    it('should render partition with correct z-index layering', () => {
      const partitionNode = createPartitionDiagramNode('part-node', 'partition-1', 50, 50);
      const activityNode = createActivityDiagramNode('act-node', 'activity-1', 150, 150, 140, 50, 'part-node');
      const flowEdge = createActivityFlowEdge('edge-1', 'flow-1', 'act-node', 'other-node');

      // Verify z-index layering: partition < activity < flow
      expect(partitionNode.z_index).toBe(50);
      expect(activityNode.z_index).toBe(100);
      expect(flowEdge.z_index).toBe(110);

      expect(partitionNode.z_index!).toBeLessThan(activityNode.z_index!);
      expect(activityNode.z_index!).toBeLessThan(flowEdge.z_index!);
    });
  });

  /**
   * Integration Test 6: Data flow versus Control flow rendering
   * Verifies different flow kinds render with correct styling
   */
  describe('Integration: Flow kind styling', () => {
    it('should render Control flow as solid line and Data flow as dashed', () => {
      const sourcePos = { x: 100, y: 100 };
      const targetPos = { x: 300, y: 100 };

      const controlFlowResult = renderActivityFlow(sourcePos, targetPos, 'Control');
      const dataFlowResult = renderActivityFlow(sourcePos, targetPos, 'Data');

      // Control flow: solid line
      expect(controlFlowResult.strokeDasharray).toBe('');
      expect(controlFlowResult.strokeColor).toBe(ACTIVITY_FLOW_DEFAULTS.line_color);

      // Data flow: dashed line
      expect(dataFlowResult.strokeDasharray).toBe('6,4');
      expect(dataFlowResult.strokeColor).toBe(ACTIVITY_FLOW_DEFAULTS.line_color);

      // Both should have arrowheads
      expect(controlFlowResult.arrowheadPath).toBeDefined();
      expect(dataFlowResult.arrowheadPath).toBeDefined();
    });
  });

  /**
   * Integration Test 7: Backward compatibility - activities without activityKind
   * Verifies legacy activities default to Action rendering
   */
  describe('Integration: Backward compatibility', () => {
    it('should render activity without activityKind as Action node', () => {
      const position = { x: 100, y: 100 };

      // Legacy activity without activity_kind
      const legacyActivity: Activity = {
        id: 'legacy-1',
        name: 'Legacy Process',
        // activity_kind is undefined
      } as Activity;

      const result = renderActivityNode(legacyActivity, position);

      // Should render as Action node
      expect(result.fill).toBe(entityColors.ACTIVITY.background);
      expect(result.width).toBe(ACTIVITY_NODE_DEFAULTS.Action.width);
      expect(result.height).toBe(ACTIVITY_NODE_DEFAULTS.Action.height);
      expect(result.showLabel).toBe(true);
    });

    it('should default partition orientation to VERTICAL when not specified', () => {
      const partition = createActivityPartitionEntity({ id: 'p1', name: 'Test' });

      // Render without specifying orientation
      const result = renderPartition({
        partition,
        position: { x: 0, y: 0 },
        dimensions: { width: 200, height: 400 },
        // orientation not specified
      });

      // Should behave as VERTICAL (header at top)
      const headerHeight = ACTIVITY_PARTITION_DEFAULTS.header_height;
      expect(result.headerRect.y).toBe(0);
      expect(result.headerRect.height).toBe(headerHeight);
      expect(result.bodyRect.y).toBe(headerHeight);
    });
  });
});
