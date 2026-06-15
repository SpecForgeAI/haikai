/**
 * Tests for User Interaction Edge Geometry
 *
 * Spec: User Interaction Edge Geometry - USER_LINK to Midpoint and Border Anchoring
 *
 * This file contains tests for:
 * - Task Group 1: calculateBorderAnchorPoint() helper function
 * - Task Group 2: USER_LINK edge creation with correct target_node_id and border anchoring
 * - Task Group 3: MAIN edge border anchoring using calculateEdgePoints()
 * - Task Group 4: "On diagram" check using MAIN edge subType
 * - Task Group 5: USER_LINK independent deletion semantics
 * - Task Group 6: Integration testing
 */

import {
  createUserInteractionMainEdge,
  createUserInteractionUserLinkEdge,
  addUserInteractionToDiagram,
  shouldCascadeDeleteUserLink,
} from '../utils/userInteractionUtils';
import {
  calculateEdgePoints,
  calculateBorderAnchorPoint,
} from '../utils/relationshipUtils';
import {
  Interaction,
  Diagram,
  DiagramNode,
  DiagramEdge,
  MetaModel,
  ENTITY_TYPES,
  RELATIONSHIP_EDGE_TYPES,
  LINE_DASHES_DOTTED,
  AppBusinessPoint,
} from '../types/model';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create a minimal MetaModel for testing
 */
function createTestMetaModel(overrides?: Partial<MetaModel>): MetaModel {
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
      application_points: [],
      logical_data_entities: [],
      logical_data_attributes: [],
      physical_data_entities: [],
      physical_data_attributes: [],
      interactions: [],
      app_business_points: [],
      ...(overrides?.entities || {}),
    },
    relationships: {
      business_user_business_points: [],
      application_point_business_points: [],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      interface_logical_entities: [],
      ...(overrides?.relationships || {}),
    },
  };
}

/**
 * Create a minimal Diagram for testing
 */
function createTestDiagram(overrides?: Partial<Diagram>): Diagram {
  return {
    id: 'diagram-1',
    name: 'Test Diagram',
    description: 'A test diagram',
    diagram_nodes: [],
    diagram_edges: [],
    view_quarter: '2024-Q4',
    ...overrides,
  };
}

/**
 * Create a test DiagramNode
 */
function createTestNode(
  entityType: string,
  entityId: string,
  position?: { x: number; y: number },
  size?: { width: number; height: number },
  overrides?: Partial<DiagramNode>
): DiagramNode {
  return {
    id: `node-${entityId}`,
    entity_type: entityType,
    entity_id: entityId,
    pos_x: position?.x || 100,
    pos_y: position?.y || 100,
    width: size?.width || 120,
    height: size?.height || 60,
    z_index: 100,
    parent_node_id: null,
    ...overrides,
  };
}

/**
 * Create a test Interaction (Case A - with both primary and secondary ABP)
 */
function createTestInteractionCaseA(
  id: string,
  userId: string,
  primaryAbpId: string,
  secondaryAbpId: string,
  name?: string
): Interaction {
  return {
    id,
    name: name || `Interaction ${id}`,
    user_id: userId,
    primary_app_business_point_id: primaryAbpId,
    secondary_app_business_point_id: secondaryAbpId,
  };
}

/**
 * Create a test Interaction (Case B - with only primary ABP)
 */
function createTestInteractionCaseB(
  id: string,
  userId: string,
  primaryAbpId: string,
  name?: string
): Interaction {
  return {
    id,
    name: name || `Interaction ${id}`,
    user_id: userId,
    primary_app_business_point_id: primaryAbpId,
    secondary_app_business_point_id: undefined,
  };
}

/**
 * Create a test AppBusinessPoint
 */
function createTestAppBusinessPoint(
  sourceEntityId: string,
  kind: 'APPLICATION' | 'APP_COMPONENT' | 'SERVICE' | 'INTERFACE' | 'BUSINESS_PROCESS' | 'PROCESS_ACTIVITY',
  name?: string
): AppBusinessPoint {
  return {
    id: `abp_${sourceEntityId}`,
    name: name || `ABP for ${sourceEntityId}`,
    kind,
    source_entity_id: sourceEntityId,
  };
}

/**
 * Create a USER_INTERACTION edge with specified subType
 */
function createTestUserInteractionEdge(
  id: string,
  relationshipId: string,
  sourceNodeId: string,
  targetNodeId: string,
  subType: 'MAIN' | 'USER_LINK'
): DiagramEdge {
  return {
    id,
    relationship_type: RELATIONSHIP_EDGE_TYPES.USER_INTERACTION,
    relationship_id: relationshipId,
    source_node_id: sourceNodeId,
    target_node_id: targetNodeId,
    subType,
    line_dashes: LINE_DASHES_DOTTED,
    edge_points: [
      { id: 'ep1', sequence_order: 0, pos_x: 0, pos_y: 0 },
      { id: 'ep2', sequence_order: 1, pos_x: 100, pos_y: 100 },
    ],
  };
}

// ============================================================================
// Task Group 1: Tests for calculateBorderAnchorPoint()
// ============================================================================

describe('Task Group 1: calculateBorderAnchorPoint', () => {
  it('Test 1.1.1: Returns right edge center when target point is to the right of node', () => {
    // Node at position (100, 100) with size 120x60
    // Center is at (160, 130)
    const node = createTestNode(ENTITY_TYPES.APPLICATION, 'app-1', { x: 100, y: 100 }, { width: 120, height: 60 });

    // Target point is to the right
    const targetPoint = { x: 400, y: 130 };

    const result = calculateBorderAnchorPoint(node, targetPoint);

    // Should return right edge center: x = 100 + 120 = 220, y = 130 (center y)
    expect(result.x).toBe(220);
    expect(result.y).toBe(130);
  });

  it('Test 1.1.2: Returns left edge center when target point is to the left of node', () => {
    // Node at position (100, 100) with size 120x60
    // Center is at (160, 130)
    const node = createTestNode(ENTITY_TYPES.APPLICATION, 'app-1', { x: 100, y: 100 }, { width: 120, height: 60 });

    // Target point is to the left
    const targetPoint = { x: 0, y: 130 };

    const result = calculateBorderAnchorPoint(node, targetPoint);

    // Should return left edge center: x = 100, y = 130 (center y)
    expect(result.x).toBe(100);
    expect(result.y).toBe(130);
  });

  it('Test 1.1.3: Returns bottom edge center when target point is below node', () => {
    // Node at position (100, 100) with size 120x60
    // Center is at (160, 130)
    const node = createTestNode(ENTITY_TYPES.APPLICATION, 'app-1', { x: 100, y: 100 }, { width: 120, height: 60 });

    // Target point is below (larger y)
    const targetPoint = { x: 160, y: 400 };

    const result = calculateBorderAnchorPoint(node, targetPoint);

    // Should return bottom edge center: x = 160 (center x), y = 100 + 60 = 160
    expect(result.x).toBe(160);
    expect(result.y).toBe(160);
  });

  it('Test 1.1.4: Returns top edge center when target point is above node', () => {
    // Node at position (100, 100) with size 120x60
    // Center is at (160, 130)
    const node = createTestNode(ENTITY_TYPES.APPLICATION, 'app-1', { x: 100, y: 100 }, { width: 120, height: 60 });

    // Target point is above (smaller y)
    const targetPoint = { x: 160, y: 0 };

    const result = calculateBorderAnchorPoint(node, targetPoint);

    // Should return top edge center: x = 160 (center x), y = 100
    expect(result.x).toBe(160);
    expect(result.y).toBe(100);
  });
});

// ============================================================================
// Task Group 2: Tests for USER_LINK Edge Creation
// ============================================================================

describe('Task Group 2: USER_LINK edge creation', () => {
  it('Test 2.1.1: USER_LINK edge has empty string target_node_id (not virtual midpoint ID)', () => {
    const interaction = createTestInteractionCaseA('int-1', 'user-1', 'abp_app-1', 'abp_app-2', 'Test Interaction');

    // User node at (50, 200)
    const userNode = createTestNode(ENTITY_TYPES.BUSINESS_USER, 'user-1', { x: 50, y: 200 }, { width: 80, height: 80 });

    // Midpoint of MAIN edge
    const midpoint = { x: 250, y: 100 };

    const edge = createUserInteractionUserLinkEdge(interaction, userNode, midpoint);

    // Should have empty target_node_id, not a virtual midpoint ID
    expect(edge.target_node_id).toBe('');
    expect(edge.target_node_id).not.toContain('midpoint');
  });

  it('Test 2.1.2: USER_LINK edge_points[0] is at user node border (not center)', () => {
    const interaction = createTestInteractionCaseA('int-1', 'user-1', 'abp_app-1', 'abp_app-2', 'Test Interaction');

    // User node at (50, 200) with size 80x80
    // Center is at (90, 240)
    const userNode = createTestNode(ENTITY_TYPES.BUSINESS_USER, 'user-1', { x: 50, y: 200 }, { width: 80, height: 80 });

    // Midpoint is to the right and above the user node
    const midpoint = { x: 250, y: 100 };

    const edge = createUserInteractionUserLinkEdge(interaction, userNode, midpoint);

    // User center is at (90, 240)
    // Midpoint is at (250, 100)
    // dx = 250 - 90 = 160, dy = 100 - 240 = -140
    // |dx| > |dy|, so horizontal anchor
    // dx > 0, so right edge: x = 50 + 80 = 130, y = 240 (center y)
    expect(edge.edge_points[0].pos_x).toBe(130);
    expect(edge.edge_points[0].pos_y).toBe(240);

    // Should NOT be at center (90, 240)
    expect(edge.edge_points[0].pos_x).not.toBe(90);
  });

  it('Test 2.1.3: USER_LINK edge_points[1] is at MAIN edge midpoint coordinates', () => {
    const interaction = createTestInteractionCaseA('int-1', 'user-1', 'abp_app-1', 'abp_app-2', 'Test Interaction');

    // User node at (50, 200) with size 80x80
    const userNode = createTestNode(ENTITY_TYPES.BUSINESS_USER, 'user-1', { x: 50, y: 200 }, { width: 80, height: 80 });

    // Midpoint of MAIN edge
    const midpoint = { x: 250, y: 100 };

    const edge = createUserInteractionUserLinkEdge(interaction, userNode, midpoint);

    // Second edge point should be exactly at the midpoint
    expect(edge.edge_points[1].pos_x).toBe(250);
    expect(edge.edge_points[1].pos_y).toBe(100);
  });
});

// ============================================================================
// Task Group 3: Tests for MAIN Edge Border Anchoring
// ============================================================================

describe('Task Group 3: MAIN edge border anchoring', () => {
  it('Test 3.1.1: MAIN edge_points[0] is at source node border (not center)', () => {
    const interaction = createTestInteractionCaseA('int-1', 'user-1', 'abp_app-1', 'abp_app-2', 'Test Interaction');

    // Source node at (100, 100) with size 120x60
    // Center is at (160, 130)
    const sourceNode = createTestNode(ENTITY_TYPES.APPLICATION, 'app-1', { x: 100, y: 100 }, { width: 120, height: 60 });

    // Target node at (400, 100) with size 120x60
    // Center is at (460, 130)
    const targetNode = createTestNode(ENTITY_TYPES.APPLICATION, 'app-2', { x: 400, y: 100 }, { width: 120, height: 60 });

    const edge = createUserInteractionMainEdge(interaction, sourceNode, targetNode);

    // dx = 460 - 160 = 300, dy = 0
    // |dx| > |dy|, horizontal anchor
    // dx > 0, so source uses right edge: x = 100 + 120 = 220, y = 130
    expect(edge.edge_points[0].pos_x).toBe(220);
    expect(edge.edge_points[0].pos_y).toBe(130);

    // Should NOT be at center (160, 130)
    expect(edge.edge_points[0].pos_x).not.toBe(160);
  });

  it('Test 3.1.2: MAIN edge_points[1] is at target node border (not center)', () => {
    const interaction = createTestInteractionCaseA('int-1', 'user-1', 'abp_app-1', 'abp_app-2', 'Test Interaction');

    // Source node at (100, 100) with size 120x60
    const sourceNode = createTestNode(ENTITY_TYPES.APPLICATION, 'app-1', { x: 100, y: 100 }, { width: 120, height: 60 });

    // Target node at (400, 100) with size 120x60
    // Center is at (460, 130)
    const targetNode = createTestNode(ENTITY_TYPES.APPLICATION, 'app-2', { x: 400, y: 100 }, { width: 120, height: 60 });

    const edge = createUserInteractionMainEdge(interaction, sourceNode, targetNode);

    // dx = 460 - 160 = 300, dy = 0
    // |dx| > |dy|, horizontal anchor
    // dx > 0, so target uses left edge: x = 400, y = 130
    expect(edge.edge_points[1].pos_x).toBe(400);
    expect(edge.edge_points[1].pos_y).toBe(130);

    // Should NOT be at center (460, 130)
    expect(edge.edge_points[1].pos_x).not.toBe(460);
  });

  it('Test 3.1.3: MAIN edge label position is at midpoint of border-anchored points', () => {
    const interaction = createTestInteractionCaseA('int-1', 'user-1', 'abp_app-1', 'abp_app-2', 'Test Interaction');

    // Source node at (100, 100) with size 120x60
    const sourceNode = createTestNode(ENTITY_TYPES.APPLICATION, 'app-1', { x: 100, y: 100 }, { width: 120, height: 60 });

    // Target node at (400, 100) with size 120x60
    const targetNode = createTestNode(ENTITY_TYPES.APPLICATION, 'app-2', { x: 400, y: 100 }, { width: 120, height: 60 });

    const edge = createUserInteractionMainEdge(interaction, sourceNode, targetNode);

    // Border anchored points: (220, 130) and (400, 130)
    // Midpoint: ((220 + 400) / 2, (130 + 130) / 2) = (310, 130)
    expect(edge.label_pos_x).toBe(310);
    expect(edge.label_pos_y).toBe(130);
  });
});

// ============================================================================
// Task Group 4: Tests for "On Diagram" Determination
// ============================================================================

describe('Task Group 4: "On diagram" determination', () => {
  /**
   * Helper function to simulate the "on diagram" check logic
   * This mirrors the logic in PalettePanel.tsx
   */
  function getAction(interactionId: string, edges: DiagramEdge[]): 'add' | 'delete' {
    const mainEdgeExists = edges.some(
      edge =>
        edge.relationship_type === RELATIONSHIP_EDGE_TYPES.USER_INTERACTION &&
        edge.relationship_id === interactionId &&
        edge.subType === 'MAIN'
    );
    return mainEdgeExists ? 'delete' : 'add';
  }

  it('Test 4.1.1: Interaction with MAIN edge returns action="delete"', () => {
    const interactionId = 'int-1';
    const edges: DiagramEdge[] = [
      createTestUserInteractionEdge('edge-1', interactionId, 'node-1', 'node-2', 'MAIN'),
    ];

    const action = getAction(interactionId, edges);

    expect(action).toBe('delete');
  });

  it('Test 4.1.2: Interaction with only USER_LINK edge returns action="add" (not "delete")', () => {
    const interactionId = 'int-1';
    const edges: DiagramEdge[] = [
      createTestUserInteractionEdge('edge-1', interactionId, 'node-user', '', 'USER_LINK'),
    ];

    const action = getAction(interactionId, edges);

    // Only USER_LINK exists, so should be 'add' (MAIN is missing)
    expect(action).toBe('add');
  });

  it('Test 4.1.3: Interaction with both MAIN and USER_LINK returns action="delete"', () => {
    const interactionId = 'int-1';
    const edges: DiagramEdge[] = [
      createTestUserInteractionEdge('edge-1', interactionId, 'node-1', 'node-2', 'MAIN'),
      createTestUserInteractionEdge('edge-2', interactionId, 'node-user', '', 'USER_LINK'),
    ];

    const action = getAction(interactionId, edges);

    expect(action).toBe('delete');
  });

  it('Test 4.1.4: Interaction with no edges returns action="add"', () => {
    const interactionId = 'int-1';
    const edges: DiagramEdge[] = [];

    const action = getAction(interactionId, edges);

    expect(action).toBe('add');
  });
});

// ============================================================================
// Task Group 5: Tests for Deletion Semantics
// ============================================================================

describe('Task Group 5: Deletion semantics', () => {
  it('Test 5.1.1: Deleting USER_LINK edge via Canvas selection does not delete MAIN edge', () => {
    const interactionId = 'int-1';

    // Both edges exist
    const mainEdge = createTestUserInteractionEdge('edge-main', interactionId, 'node-1', 'node-2', 'MAIN');
    const userLinkEdge = createTestUserInteractionEdge('edge-userlink', interactionId, 'node-user', '', 'USER_LINK');
    const edges = [mainEdge, userLinkEdge];

    // When deleting USER_LINK, shouldCascadeDeleteUserLink should return null (no cascade)
    const cascadeResult = shouldCascadeDeleteUserLink(userLinkEdge, edges);

    expect(cascadeResult).toBeNull();
  });

  it('Test 5.1.2: After USER_LINK deletion, palette still shows "Delete" (MAIN exists)', () => {
    const interactionId = 'int-1';

    // After deleting USER_LINK, only MAIN remains
    const mainEdge = createTestUserInteractionEdge('edge-main', interactionId, 'node-1', 'node-2', 'MAIN');
    const edges = [mainEdge];

    // Check if MAIN edge exists (simulating palette check)
    const mainEdgeExists = edges.some(
      edge =>
        edge.relationship_type === RELATIONSHIP_EDGE_TYPES.USER_INTERACTION &&
        edge.relationship_id === interactionId &&
        edge.subType === 'MAIN'
    );

    expect(mainEdgeExists).toBe(true);

    // Action should be 'delete'
    const action = mainEdgeExists ? 'delete' : 'add';
    expect(action).toBe('delete');
  });

  it('Test 5.1.3: Deleting MAIN edge cascades to delete USER_LINK edge', () => {
    const interactionId = 'int-1';

    // Both edges exist
    const mainEdge = createTestUserInteractionEdge('edge-main', interactionId, 'node-1', 'node-2', 'MAIN');
    const userLinkEdge = createTestUserInteractionEdge('edge-userlink', interactionId, 'node-user', '', 'USER_LINK');
    const edges = [mainEdge, userLinkEdge];

    // When deleting MAIN, shouldCascadeDeleteUserLink should return the USER_LINK edge
    const cascadeResult = shouldCascadeDeleteUserLink(mainEdge, edges);

    expect(cascadeResult).not.toBeNull();
    expect(cascadeResult?.id).toBe('edge-userlink');
    expect(cascadeResult?.subType).toBe('USER_LINK');
  });
});

// ============================================================================
// Task Group 6: Integration Test
// ============================================================================

describe('Task Group 6: Integration testing', () => {
  it('Test 6.2.1: Add interaction with User node present creates both MAIN and USER_LINK with correct geometry', () => {
    // Setup: Case A scenario with P, S, and U all on diagram
    const userId = 'user-1';
    const app1Id = 'app-1';
    const app2Id = 'app-2';

    // Create ABPs
    const abpApp1 = createTestAppBusinessPoint(app1Id, 'APPLICATION', 'ABP App1');
    const abpApp2 = createTestAppBusinessPoint(app2Id, 'APPLICATION', 'ABP App2');

    // Create interaction (Case A)
    const interaction = createTestInteractionCaseA('int-1', userId, abpApp1.id, abpApp2.id, 'Test Interaction');

    // Create nodes
    // Primary (App1) at (100, 100) with size 120x60
    const primaryNode = createTestNode(ENTITY_TYPES.APPLICATION, app1Id, { x: 100, y: 100 }, { width: 120, height: 60 });
    // Secondary (App2) at (400, 100) with size 120x60
    const secondaryNode = createTestNode(ENTITY_TYPES.APPLICATION, app2Id, { x: 400, y: 100 }, { width: 120, height: 60 });
    // User at (50, 300) with size 80x80
    const userNode = createTestNode(ENTITY_TYPES.BUSINESS_USER, userId, { x: 50, y: 300 }, { width: 80, height: 80 });

    const diagram = createTestDiagram({
      diagram_nodes: [primaryNode, secondaryNode, userNode],
      diagram_edges: [],
    });

    const metaModel = createTestMetaModel({
      entities: {
        interactions: [interaction],
        app_business_points: [abpApp1, abpApp2],
        business_users: [{ id: userId, name: 'Test User', description: '', tags: '' }],
        applications: [
          { id: app1Id, name: 'App 1', description: '', tags: '' },
          { id: app2Id, name: 'App 2', description: '', tags: '' },
        ],
        business_processes: [],
        process_activities: [],
        business_points: [],
        app_components: [],
        services: [],
        interfaces: [],
        endpoints: [],
        application_points: [],
        logical_data_entities: [],
        logical_data_attributes: [],
        physical_data_entities: [],
        physical_data_attributes: [],
      },
    });

    // Execute: Add interaction to diagram
    const result = addUserInteractionToDiagram(interaction, diagram, metaModel);

    // Verify MAIN edge exists with correct properties
    expect(result.mainEdge).toBeDefined();
    expect(result.mainEdge.relationship_type).toBe(RELATIONSHIP_EDGE_TYPES.USER_INTERACTION);
    expect(result.mainEdge.relationship_id).toBe(interaction.id);
    expect(result.mainEdge.subType).toBe('MAIN');

    // Verify USER_LINK edge exists with correct properties
    expect(result.userLinkEdge).toBeDefined();
    expect(result.userLinkEdge?.relationship_type).toBe(RELATIONSHIP_EDGE_TYPES.USER_INTERACTION);
    expect(result.userLinkEdge?.relationship_id).toBe(interaction.id);
    expect(result.userLinkEdge?.subType).toBe('USER_LINK');
    expect(result.userLinkEdge?.target_node_id).toBe('');

    // Verify MAIN edge has border-anchored points
    // Primary center: (160, 130), Secondary center: (460, 130)
    // dx = 300, dy = 0, horizontal anchor
    // Primary right edge: (220, 130), Secondary left edge: (400, 130)
    expect(result.mainEdge.edge_points[0].pos_x).toBe(220);
    expect(result.mainEdge.edge_points[0].pos_y).toBe(130);
    expect(result.mainEdge.edge_points[1].pos_x).toBe(400);
    expect(result.mainEdge.edge_points[1].pos_y).toBe(130);

    // Verify USER_LINK edge source is at user node border
    // User center: (90, 340)
    // MAIN midpoint: ((220 + 400) / 2, (130 + 130) / 2) = (310, 130)
    // dx = 310 - 90 = 220, dy = 130 - 340 = -210
    // |dx| > |dy|, horizontal anchor
    // dx > 0, so right edge: (50 + 80, 340) = (130, 340)
    expect(result.userLinkEdge?.edge_points[0].pos_x).toBe(130);
    expect(result.userLinkEdge?.edge_points[0].pos_y).toBe(340);

    // Verify USER_LINK edge target is at MAIN midpoint
    expect(result.userLinkEdge?.edge_points[1].pos_x).toBe(310);
    expect(result.userLinkEdge?.edge_points[1].pos_y).toBe(130);
  });
});
