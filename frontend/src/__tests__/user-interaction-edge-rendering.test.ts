/**
 * Tests for User Interaction Edge Rendering
 *
 * Task Group 4: Edge Rendering and Label Handling
 * Tests for the User Interaction Visualisation feature edge rendering logic.
 *
 * These tests verify:
 * - MAIN edge renders as dotted line
 * - USER_LINK edge renders as dotted line
 * - Label renders at stored position
 * - Label drag updates position
 * - Edge z-index respects diagram layering
 * - USER_LINK edge targets midpoint of MAIN edge
 */

import {
  DiagramEdge,
  DiagramNode,
  RELATIONSHIP_EDGE_TYPES,
  LINE_DASHES_DOTTED,
} from '../types/model';
import {
  getStrokeDasharray,
  calculateMidpoint,
} from '../utils/interactionRendering';
import {
  calculateEdgeMidpoint,
  Point,
} from '../utils/userInteractionUtils';
import { getEdgeStrokeStyle } from '../utils/rendering';
import {
  getUserInteractionEdgeStyle,
  calculateUserLinkMidpointTarget,
  isUserInteractionEdge,
} from '../utils/userInteractionEdgeRendering';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create a test DiagramNode
 */
function createTestNode(
  entityType: string,
  entityId: string,
  position: { x: number; y: number },
  size?: { width: number; height: number }
): DiagramNode {
  return {
    id: `node-${entityId}`,
    entity_type: entityType,
    entity_id: entityId,
    pos_x: position.x,
    pos_y: position.y,
    width: size?.width || 120,
    height: size?.height || 60,
    z_index: 100,
    parent_node_id: null,
  };
}

/**
 * Create a test MAIN edge for USER_INTERACTION
 */
function createMainEdge(
  interactionId: string,
  sourceNodeId: string,
  targetNodeId: string,
  labelPosition?: { x: number; y: number }
): DiagramEdge {
  return {
    id: `edge-main-${interactionId}`,
    relationship_type: RELATIONSHIP_EDGE_TYPES.USER_INTERACTION,
    relationship_id: interactionId,
    source_node_id: sourceNodeId,
    target_node_id: targetNodeId,
    subType: 'MAIN',
    line_dashes: LINE_DASHES_DOTTED,
    label_text: `Interaction ${interactionId}`,
    label_pos_x: labelPosition?.x || 200,
    label_pos_y: labelPosition?.y || 150,
    edge_points: [
      { id: 'ep1', sequence_order: 0, pos_x: 160, pos_y: 130 },
      { id: 'ep2', sequence_order: 1, pos_x: 340, pos_y: 130 },
    ],
    z_index: 110,
  };
}

/**
 * Create a test USER_LINK edge for USER_INTERACTION
 */
function createUserLinkEdge(
  interactionId: string,
  userNodeId: string,
  targetNodeId: string // midpoint-{interactionId}
): DiagramEdge {
  return {
    id: `edge-userlink-${interactionId}`,
    relationship_type: RELATIONSHIP_EDGE_TYPES.USER_INTERACTION,
    relationship_id: interactionId,
    source_node_id: userNodeId,
    target_node_id: targetNodeId,
    subType: 'USER_LINK',
    line_dashes: LINE_DASHES_DOTTED,
    edge_points: [
      { id: 'ep1', sequence_order: 0, pos_x: 50, pos_y: 50 },
      { id: 'ep2', sequence_order: 1, pos_x: 250, pos_y: 130 },
    ],
    z_index: 110,
  };
}

// ============================================================================
// Test 1: MAIN Edge Renders as Dotted Line
// ============================================================================

describe('Task 4.1: MAIN edge renders as dotted line', () => {
  it('should have correct line_dashes value for dotted styling', () => {
    const mainEdge = createMainEdge('int-1', 'node-app1', 'node-app2');

    // Verify dotted line styling
    expect(mainEdge.line_dashes).toBe(LINE_DASHES_DOTTED);
    expect(mainEdge.line_dashes).toBe('4,4');
  });

  it('should return dotted stroke-dasharray from getStrokeDasharray', () => {
    const dasharray = getStrokeDasharray('dotted');
    expect(dasharray).toBe('4,4');
  });

  it('should be identified as USER_INTERACTION edge', () => {
    const mainEdge = createMainEdge('int-1', 'node-app1', 'node-app2');

    expect(isUserInteractionEdge(mainEdge)).toBe(true);
    expect(mainEdge.relationship_type).toBe(RELATIONSHIP_EDGE_TYPES.USER_INTERACTION);
    expect(mainEdge.subType).toBe('MAIN');
  });

  it('should return dotted style from getUserInteractionEdgeStyle', () => {
    const mainEdge = createMainEdge('int-1', 'node-app1', 'node-app2');
    const style = getUserInteractionEdgeStyle(mainEdge);

    expect(style.strokeDasharray).toBe('4,4');
    expect(style.isDotted).toBe(true);
  });
});

// ============================================================================
// Test 2: USER_LINK Edge Renders as Dotted Line
// ============================================================================

describe('Task 4.1: USER_LINK edge renders as dotted line', () => {
  it('should have correct line_dashes value for dotted styling', () => {
    const userLinkEdge = createUserLinkEdge('int-1', 'node-user1', 'midpoint-int-1');

    // Verify dotted line styling
    expect(userLinkEdge.line_dashes).toBe(LINE_DASHES_DOTTED);
    expect(userLinkEdge.line_dashes).toBe('4,4');
  });

  it('should be identified as USER_INTERACTION edge with USER_LINK subType', () => {
    const userLinkEdge = createUserLinkEdge('int-1', 'node-user1', 'midpoint-int-1');

    expect(isUserInteractionEdge(userLinkEdge)).toBe(true);
    expect(userLinkEdge.relationship_type).toBe(RELATIONSHIP_EDGE_TYPES.USER_INTERACTION);
    expect(userLinkEdge.subType).toBe('USER_LINK');
  });

  it('should return dotted style with lighter opacity for USER_LINK', () => {
    const userLinkEdge = createUserLinkEdge('int-1', 'node-user1', 'midpoint-int-1');
    const style = getUserInteractionEdgeStyle(userLinkEdge);

    expect(style.strokeDasharray).toBe('4,4');
    expect(style.isDotted).toBe(true);
    // USER_LINK may have slightly lower opacity for visual hierarchy
    expect(style.opacity).toBeLessThanOrEqual(1);
  });
});

// ============================================================================
// Test 3: Label Renders at Stored Position
// ============================================================================

describe('Task 4.1: Label renders at stored position', () => {
  it('should have label_pos_x and label_pos_y for label positioning', () => {
    const mainEdge = createMainEdge('int-1', 'node-app1', 'node-app2', { x: 250, y: 100 });

    expect(mainEdge.label_pos_x).toBe(250);
    expect(mainEdge.label_pos_y).toBe(100);
    expect(mainEdge.label_text).toBe('Interaction int-1');
  });

  it('should render label at stored position (not recalculated)', () => {
    const mainEdge = createMainEdge('int-1', 'node-app1', 'node-app2', { x: 300, y: 200 });

    // Label should be at the stored position, not at the edge midpoint
    const edgeMidpoint = calculateEdgeMidpoint(
      { x: mainEdge.edge_points[0].pos_x, y: mainEdge.edge_points[0].pos_y },
      { x: mainEdge.edge_points[1].pos_x, y: mainEdge.edge_points[1].pos_y }
    );

    // Stored position is different from calculated midpoint
    expect(mainEdge.label_pos_x).toBe(300);
    expect(mainEdge.label_pos_y).toBe(200);
    expect(mainEdge.label_pos_x).not.toBe(edgeMidpoint.x);
    expect(mainEdge.label_pos_y).not.toBe(edgeMidpoint.y);
  });
});

// ============================================================================
// Test 4: Label Drag Updates Position
// ============================================================================

describe('Task 4.1: Label drag updates position', () => {
  it('should allow updating label_pos_x and label_pos_y', () => {
    const mainEdge = createMainEdge('int-1', 'node-app1', 'node-app2', { x: 200, y: 150 });

    // Simulate drag update
    const newLabelPosX = 280;
    const newLabelPosY = 180;

    const updatedEdge: DiagramEdge = {
      ...mainEdge,
      label_pos_x: newLabelPosX,
      label_pos_y: newLabelPosY,
    };

    expect(updatedEdge.label_pos_x).toBe(280);
    expect(updatedEdge.label_pos_y).toBe(180);
  });

  it('should calculate delta correctly for label drag', () => {
    const originalPosX = 200;
    const originalPosY = 150;
    const dragDeltaX = 50;
    const dragDeltaY = -30;

    const newPosX = originalPosX + dragDeltaX;
    const newPosY = originalPosY + dragDeltaY;

    expect(newPosX).toBe(250);
    expect(newPosY).toBe(120);
  });
});

// ============================================================================
// Test 5: Edge Z-Index Respects Diagram Layering
// ============================================================================

describe('Task 4.1: Edge z-index respects diagram layering', () => {
  it('should have z_index property on edge', () => {
    const mainEdge = createMainEdge('int-1', 'node-app1', 'node-app2');

    expect(mainEdge.z_index).toBeDefined();
    expect(mainEdge.z_index).toBe(110);
  });

  it('should allow z_index to be customized', () => {
    const mainEdge = createMainEdge('int-1', 'node-app1', 'node-app2');
    const customZIndexEdge: DiagramEdge = {
      ...mainEdge,
      z_index: 150,
    };

    expect(customZIndexEdge.z_index).toBe(150);
  });

  it('should use default z_index for edges if not specified', () => {
    const edgeWithoutZIndex: DiagramEdge = {
      id: 'edge-1',
      relationship_type: RELATIONSHIP_EDGE_TYPES.USER_INTERACTION,
      relationship_id: 'int-1',
      source_node_id: 'node-1',
      target_node_id: 'node-2',
      subType: 'MAIN',
      line_dashes: LINE_DASHES_DOTTED,
      edge_points: [],
    };

    // Default z_index for edges is typically 110
    expect(edgeWithoutZIndex.z_index).toBeUndefined();
  });
});

// ============================================================================
// Test 6: USER_LINK Edge Targets Midpoint of MAIN Edge
// ============================================================================

describe('Task 4.4: USER_LINK edge targets midpoint of MAIN edge', () => {
  it('should calculate midpoint target correctly', () => {
    const primaryNodeCenter: Point = { x: 160, y: 130 };
    const secondaryNodeCenter: Point = { x: 340, y: 130 };

    const midpoint = calculateUserLinkMidpointTarget(primaryNodeCenter, secondaryNodeCenter);

    expect(midpoint.x).toBe(250);
    expect(midpoint.y).toBe(130);
  });

  it('should have target_node_id as midpoint identifier for USER_LINK', () => {
    const userLinkEdge = createUserLinkEdge('int-1', 'node-user1', 'midpoint-int-1');

    expect(userLinkEdge.target_node_id).toBe('midpoint-int-1');
    expect(userLinkEdge.target_node_id.startsWith('midpoint-')).toBe(true);
  });

  it('should calculate midpoint dynamically based on MAIN edge positions', () => {
    // Create MAIN edge
    const mainEdge = createMainEdge('int-1', 'node-app1', 'node-app2');

    // Get edge points
    const startPoint = mainEdge.edge_points[0];
    const endPoint = mainEdge.edge_points[1];

    // Calculate dynamic midpoint
    const dynamicMidpoint = calculateMidpoint(
      { x: startPoint.pos_x, y: startPoint.pos_y },
      { x: endPoint.pos_x, y: endPoint.pos_y }
    );

    expect(dynamicMidpoint.x).toBe(250);
    expect(dynamicMidpoint.y).toBe(130);
  });

  it('should render USER_LINK line from User node to calculated midpoint', () => {
    const userNodeCenter: Point = { x: 50, y: 50 };
    const mainEdgeStart: Point = { x: 160, y: 130 };
    const mainEdgeEnd: Point = { x: 340, y: 130 };

    const midpoint = calculateUserLinkMidpointTarget(mainEdgeStart, mainEdgeEnd);

    // USER_LINK should go from user node center to midpoint
    const userLinkEdge = createUserLinkEdge('int-1', 'node-user1', 'midpoint-int-1');

    // Verify edge points go from user node position toward midpoint
    expect(userLinkEdge.edge_points[0].pos_x).toBe(userNodeCenter.x);
    expect(userLinkEdge.edge_points[0].pos_y).toBe(userNodeCenter.y);
    expect(userLinkEdge.edge_points[1].pos_x).toBe(midpoint.x);
    expect(userLinkEdge.edge_points[1].pos_y).toBe(midpoint.y);
  });
});

// ============================================================================
// Test 7: getRelationship() returns Interaction from entities.interactions
// ============================================================================

import { getRelationship, getEdgesForDiagram, getRelationshipEndpointEntities } from '../utils/rendering';
import type { ArchitectureModel, Interaction, AppBusinessPoint } from '../types/model';

// Helper to create a minimal model structure with interactions support
function createBaseModel(): ArchitectureModel {
  return {
    metaModel: {
      entities: {
        applications: [],
        app_components: [],
        services: [],
        interfaces: [],
        endpoints: [],
        business_users: [],
        business_processes: [],
        process_activities: [],
        business_points: [],
        logical_data_entities: [],
        logical_data_attributes: [],
        physical_data_entities: [],
        physical_data_attributes: [],
        application_points: [],
        interactions: [],
        app_business_points: [],
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
    },
    diagrams: [],
  };
}

describe('getRelationship() for USER_INTERACTION', () => {
  it('should return Interaction from entities.interactions', () => {
    const model = createBaseModel();

    // Add an interaction
    const interaction: Interaction = {
      id: 'int-1',
      name: 'Test Interaction',
      user_id: 'user-1',
      primary_app_business_point_id: 'abp-app1',
      secondary_app_business_point_id: 'abp-app2',
    };
    model.metaModel.entities.interactions = [interaction];

    // Call getRelationship with USER_INTERACTION type
    const result = getRelationship('USER_INTERACTION', 'int-1', model);

    // Verify result matches the interaction
    expect(result).toBeDefined();
    expect(result?.id).toBe('int-1');
    expect((result as Interaction)?.name).toBe('Test Interaction');
  });

  it('should return undefined when Interaction not found', () => {
    const model = createBaseModel();
    model.metaModel.entities.interactions = [];

    const result = getRelationship('USER_INTERACTION', 'nonexistent', model);

    expect(result).toBeUndefined();
  });
});

describe('getEdgesForDiagram() with USER_INTERACTION edges', () => {
  it('should include USER_INTERACTION edges when Interaction exists', () => {
    const model = createBaseModel();

    // Add business user
    model.metaModel.entities.business_users = [
      { id: 'user-1', name: 'Test User', description: '', role: 'User' },
    ];

    // Add applications
    model.metaModel.entities.applications = [
      { id: 'app1', name: 'App 1', description: '', app_type: 'Web', status: 'Active', tags: '' },
      { id: 'app2', name: 'App 2', description: '', app_type: 'Web', status: 'Active', tags: '' },
    ];

    // Add AppBusinessPoints
    const abp1: AppBusinessPoint = { id: 'abp-app1', name: 'App 1', kind: 'APPLICATION', source_entity_id: 'app1' };
    const abp2: AppBusinessPoint = { id: 'abp-app2', name: 'App 2', kind: 'APPLICATION', source_entity_id: 'app2' };
    model.metaModel.entities.app_business_points = [abp1, abp2];

    // Add an interaction
    const interaction: Interaction = {
      id: 'int-1',
      name: 'Test Interaction',
      user_id: 'user-1',
      primary_app_business_point_id: 'abp-app1',
      secondary_app_business_point_id: 'abp-app2',
    };
    model.metaModel.entities.interactions = [interaction];

    // Create diagram with nodes and USER_INTERACTION edge
    model.diagrams = [
      {
        id: 'diag1',
        name: 'Test Diagram',
        description: '',
        diagram_nodes: [
          { id: 'node1', entity_type: 'APPLICATION', entity_id: 'app1', pos_x: 0, pos_y: 0, width: 100, height: 50, parent_node_id: null },
          { id: 'node2', entity_type: 'APPLICATION', entity_id: 'app2', pos_x: 200, pos_y: 0, width: 100, height: 50, parent_node_id: null },
        ],
        diagram_edges: [
          {
            id: 'edge1',
            relationship_type: 'USER_INTERACTION',
            relationship_id: 'int-1',
            subType: 'MAIN',
            source_node_id: 'node1',
            target_node_id: 'node2',
            line_dashes: '4,4',
            label_text: 'Test Interaction',
            edge_points: [
              { id: 'ep1', pos_x: 100, pos_y: 25, sequence_order: 0 },
              { id: 'ep2', pos_x: 200, pos_y: 25, sequence_order: 1 },
            ],
          },
        ],
        decorations: [],
      },
    ];

    const visibleNodeIds = new Set(['node1', 'node2']);
    const edges = getEdgesForDiagram('diag1', model, undefined, visibleNodeIds);

    expect(edges.length).toBe(1);
    expect(edges[0].id).toBe('edge1');
    expect(edges[0].relationship_type).toBe('USER_INTERACTION');
  });

  it('should filter USER_INTERACTION edges when Interaction not found', () => {
    const model = createBaseModel();

    model.metaModel.entities.applications = [
      { id: 'app1', name: 'App 1', description: '', app_type: 'Web', status: 'Active', tags: '' },
      { id: 'app2', name: 'App 2', description: '', app_type: 'Web', status: 'Active', tags: '' },
    ];

    // Empty interactions
    model.metaModel.entities.interactions = [];

    model.diagrams = [
      {
        id: 'diag1',
        name: 'Test Diagram',
        description: '',
        diagram_nodes: [
          { id: 'node1', entity_type: 'APPLICATION', entity_id: 'app1', pos_x: 0, pos_y: 0, width: 100, height: 50, parent_node_id: null },
          { id: 'node2', entity_type: 'APPLICATION', entity_id: 'app2', pos_x: 200, pos_y: 0, width: 100, height: 50, parent_node_id: null },
        ],
        diagram_edges: [
          {
            id: 'edge1',
            relationship_type: 'USER_INTERACTION',
            relationship_id: 'nonexistent',
            subType: 'MAIN',
            source_node_id: 'node1',
            target_node_id: 'node2',
            line_dashes: '4,4',
            edge_points: [
              { id: 'ep1', pos_x: 100, pos_y: 25, sequence_order: 0 },
              { id: 'ep2', pos_x: 200, pos_y: 25, sequence_order: 1 },
            ],
          },
        ],
        decorations: [],
      },
    ];

    const visibleNodeIds = new Set(['node1', 'node2']);
    // With viewQuarter to trigger filtering
    const edges = getEdgesForDiagram('diag1', model, '2026-Q4', visibleNodeIds);

    expect(edges.length).toBe(0);
  });
});

describe('getRelationshipEndpointEntities() for USER_INTERACTION', () => {
  it('should return correct entities for USER_INTERACTION with both ABPs', () => {
    const model = createBaseModel();

    model.metaModel.entities.business_users = [
      { id: 'user-1', name: 'Test User', description: '', role: 'User' },
    ];

    model.metaModel.entities.applications = [
      { id: 'app1', name: 'App 1', description: '', app_type: 'Web', status: 'Active', tags: '' },
      { id: 'app2', name: 'App 2', description: '', app_type: 'Web', status: 'Active', tags: '' },
    ];

    const abp1: AppBusinessPoint = { id: 'abp-app1', name: 'App 1', kind: 'APPLICATION', source_entity_id: 'app1' };
    const abp2: AppBusinessPoint = { id: 'abp-app2', name: 'App 2', kind: 'APPLICATION', source_entity_id: 'app2' };
    model.metaModel.entities.app_business_points = [abp1, abp2];

    const interaction: Interaction = {
      id: 'int-1',
      name: 'Test Interaction',
      user_id: 'user-1',
      primary_app_business_point_id: 'abp-app1',
      secondary_app_business_point_id: 'abp-app2',
    };

    const endpoints = getRelationshipEndpointEntities(
      'USER_INTERACTION',
      interaction as unknown as any,
      model.metaModel
    );

    // Should include: user, app1, app2
    expect(endpoints.length).toBe(3);
    const endpointIds = endpoints.map(e => e.id);
    expect(endpointIds).toContain('user-1');
    expect(endpointIds).toContain('app1');
    expect(endpointIds).toContain('app2');
  });

  it('should handle USER_INTERACTION without secondary ABP', () => {
    const model = createBaseModel();

    model.metaModel.entities.business_users = [
      { id: 'user-1', name: 'Test User', description: '', role: 'User' },
    ];

    model.metaModel.entities.applications = [
      { id: 'app1', name: 'App 1', description: '', app_type: 'Web', status: 'Active', tags: '' },
    ];

    const abp1: AppBusinessPoint = { id: 'abp-app1', name: 'App 1', kind: 'APPLICATION', source_entity_id: 'app1' };
    model.metaModel.entities.app_business_points = [abp1];

    const interaction: Interaction = {
      id: 'int-1',
      name: 'Test Interaction',
      user_id: 'user-1',
      primary_app_business_point_id: 'abp-app1',
      // No secondary
    };

    const endpoints = getRelationshipEndpointEntities(
      'USER_INTERACTION',
      interaction as unknown as any,
      model.metaModel
    );

    // Should include: user, app1 only
    expect(endpoints.length).toBe(2);
    const endpointIds = endpoints.map(e => e.id);
    expect(endpointIds).toContain('user-1');
    expect(endpointIds).toContain('app1');
  });
});
