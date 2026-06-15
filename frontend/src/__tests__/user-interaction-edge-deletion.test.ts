/**
 * Tests for User Interaction Edge Deletion with Cascade Logic
 *
 * Task Group 5: Edge Deletion with Cascade Logic
 * Tests for the User Interaction Visualisation feature edge deletion behavior.
 *
 * These tests verify:
 * - Deleting MAIN edge when USER_LINK exists cascades to delete USER_LINK
 * - Deleting USER_LINK only leaves MAIN edge intact
 * - After deleting all edges, RHS row becomes enabled
 * - Deleting MAIN edge with no USER_LINK works correctly
 * - Edge deletion respects temporal validity
 */

import {
  shouldCascadeDeleteUserLink,
  getInteractionEdgeCountForInteraction,
  getInteractionEdgesOnDiagram,
  isUserInteractionRowEnabled,
} from '../utils/userInteractionUtils';
import {
  Interaction,
  Diagram,
  DiagramNode,
  DiagramEdge,
  MetaModel,
  ENTITY_TYPES,
  RELATIONSHIP_EDGE_TYPES,
  AppBusinessPoint,
  BusinessUser,
  Application,
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
  overrides?: Partial<DiagramNode>
): DiagramNode {
  return {
    id: `node-${entityId}`,
    entity_type: entityType,
    entity_id: entityId,
    pos_x: 100,
    pos_y: 100,
    width: 120,
    height: 60,
    z_index: 100,
    parent_node_id: null,
    ...overrides,
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
 * Create a test USER_INTERACTION edge
 */
function createTestUserInteractionEdge(
  id: string,
  interactionId: string,
  sourceNodeId: string,
  targetNodeId: string,
  subType: 'MAIN' | 'USER_LINK'
): DiagramEdge {
  return {
    id,
    relationship_type: RELATIONSHIP_EDGE_TYPES.USER_INTERACTION,
    relationship_id: interactionId,
    source_node_id: sourceNodeId,
    target_node_id: targetNodeId,
    edge_points: [],
    subType,
    line_dashes: '4,4',
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
  overrides?: Partial<Interaction>
): Interaction {
  return {
    id,
    name: `Interaction ${id}`,
    user_id: userId,
    primary_app_business_point_id: primaryAbpId,
    secondary_app_business_point_id: secondaryAbpId,
    ...overrides,
  };
}

// ============================================================================
// Test Suite: shouldCascadeDeleteUserLink Helper
// ============================================================================

describe('shouldCascadeDeleteUserLink', () => {
  it('should return USER_LINK edge when deleting MAIN edge with existing USER_LINK', () => {
    const mainEdge = createTestUserInteractionEdge('edge-main', 'int-1', 'node-p', 'node-s', 'MAIN');
    const userLinkEdge = createTestUserInteractionEdge('edge-user-link', 'int-1', 'node-user', 'midpoint-int-1', 'USER_LINK');

    const diagramEdges: DiagramEdge[] = [mainEdge, userLinkEdge];

    const result = shouldCascadeDeleteUserLink(mainEdge, diagramEdges);
    expect(result).not.toBeNull();
    expect(result?.id).toBe('edge-user-link');
    expect(result?.subType).toBe('USER_LINK');
  });

  it('should return null when deleting MAIN edge with no USER_LINK', () => {
    const mainEdge = createTestUserInteractionEdge('edge-main', 'int-1', 'node-p', 'node-s', 'MAIN');

    const diagramEdges: DiagramEdge[] = [mainEdge];

    const result = shouldCascadeDeleteUserLink(mainEdge, diagramEdges);
    expect(result).toBeNull();
  });

  it('should return null when deleting USER_LINK edge (no cascade needed)', () => {
    const mainEdge = createTestUserInteractionEdge('edge-main', 'int-1', 'node-p', 'node-s', 'MAIN');
    const userLinkEdge = createTestUserInteractionEdge('edge-user-link', 'int-1', 'node-user', 'midpoint-int-1', 'USER_LINK');

    const diagramEdges: DiagramEdge[] = [mainEdge, userLinkEdge];

    // Deleting USER_LINK should NOT cascade to MAIN
    const result = shouldCascadeDeleteUserLink(userLinkEdge, diagramEdges);
    expect(result).toBeNull();
  });

  it('should return null when deleting non-USER_INTERACTION edge', () => {
    const dataMovementEdge: DiagramEdge = {
      id: 'edge-dm',
      relationship_type: RELATIONSHIP_EDGE_TYPES.DATA_MOVEMENT,
      relationship_id: 'dm-1',
      source_node_id: 'node-1',
      target_node_id: 'node-2',
      edge_points: [],
    };

    const diagramEdges: DiagramEdge[] = [dataMovementEdge];

    const result = shouldCascadeDeleteUserLink(dataMovementEdge, diagramEdges);
    expect(result).toBeNull();
  });

  it('should return correct USER_LINK when multiple interactions exist', () => {
    const mainEdge1 = createTestUserInteractionEdge('edge-main-1', 'int-1', 'node-p1', 'node-s1', 'MAIN');
    const userLinkEdge1 = createTestUserInteractionEdge('edge-user-link-1', 'int-1', 'node-user1', 'midpoint-int-1', 'USER_LINK');
    const mainEdge2 = createTestUserInteractionEdge('edge-main-2', 'int-2', 'node-p2', 'node-s2', 'MAIN');
    const userLinkEdge2 = createTestUserInteractionEdge('edge-user-link-2', 'int-2', 'node-user2', 'midpoint-int-2', 'USER_LINK');

    const diagramEdges: DiagramEdge[] = [mainEdge1, userLinkEdge1, mainEdge2, userLinkEdge2];

    // Deleting MAIN edge for int-1 should cascade to USER_LINK for int-1 only
    const result = shouldCascadeDeleteUserLink(mainEdge1, diagramEdges);
    expect(result).not.toBeNull();
    expect(result?.id).toBe('edge-user-link-1');
    expect(result?.relationship_id).toBe('int-1');
  });
});

// ============================================================================
// Test Suite: getInteractionEdgeCountForInteraction Helper
// ============================================================================

describe('getInteractionEdgeCountForInteraction', () => {
  it('should return 0 when no edges exist for interaction', () => {
    const edges: DiagramEdge[] = [];
    const result = getInteractionEdgeCountForInteraction('int-1', edges);
    expect(result).toBe(0);
  });

  it('should count MAIN edge for interaction', () => {
    const mainEdge = createTestUserInteractionEdge('edge-main', 'int-1', 'node-p', 'node-s', 'MAIN');
    const edges: DiagramEdge[] = [mainEdge];
    const result = getInteractionEdgeCountForInteraction('int-1', edges);
    expect(result).toBe(1);
  });

  it('should count both MAIN and USER_LINK edges for interaction', () => {
    const mainEdge = createTestUserInteractionEdge('edge-main', 'int-1', 'node-p', 'node-s', 'MAIN');
    const userLinkEdge = createTestUserInteractionEdge('edge-user-link', 'int-1', 'node-user', 'midpoint', 'USER_LINK');
    const edges: DiagramEdge[] = [mainEdge, userLinkEdge];
    const result = getInteractionEdgeCountForInteraction('int-1', edges);
    expect(result).toBe(2);
  });

  it('should not count edges from different interactions', () => {
    const mainEdge1 = createTestUserInteractionEdge('edge-main-1', 'int-1', 'node-p1', 'node-s1', 'MAIN');
    const mainEdge2 = createTestUserInteractionEdge('edge-main-2', 'int-2', 'node-p2', 'node-s2', 'MAIN');
    const edges: DiagramEdge[] = [mainEdge1, mainEdge2];
    const result = getInteractionEdgeCountForInteraction('int-1', edges);
    expect(result).toBe(1);
  });

  it('should not count non-USER_INTERACTION edges', () => {
    const mainEdge = createTestUserInteractionEdge('edge-main', 'int-1', 'node-p', 'node-s', 'MAIN');
    const dataMovementEdge: DiagramEdge = {
      id: 'edge-dm',
      relationship_type: RELATIONSHIP_EDGE_TYPES.DATA_MOVEMENT,
      relationship_id: 'int-1', // Same ID but different relationship type
      source_node_id: 'node-1',
      target_node_id: 'node-2',
      edge_points: [],
    };
    const edges: DiagramEdge[] = [mainEdge, dataMovementEdge];
    const result = getInteractionEdgeCountForInteraction('int-1', edges);
    expect(result).toBe(1);
  });
});

// ============================================================================
// Test Suite: RHS Row State After Deletion
// ============================================================================

describe('RHS row state after edge deletion', () => {
  // Test: After deleting all edges, RHS row becomes enabled
  it('should re-enable row after deleting all edges for an interaction', () => {
    const app1: Application = { id: 'app-1', name: 'App 1', description: '', app_type: '', status: '', tags: '' };
    const app2: Application = { id: 'app-2', name: 'App 2', description: '', app_type: '', status: '', tags: '' };
    const user1: BusinessUser = { id: 'user-1', name: 'User 1', description: '', tags: '' };

    const abpP = createTestAppBusinessPoint('app-1', 'APPLICATION', 'App 1');
    const abpS = createTestAppBusinessPoint('app-2', 'APPLICATION', 'App 2');

    const metaModel = createTestMetaModel({
      entities: {
        business_users: [user1],
        business_processes: [],
        process_activities: [],
        business_points: [],
        applications: [app1, app2],
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
        app_business_points: [abpP, abpS],
      },
    });

    const nodeP = createTestNode(ENTITY_TYPES.APPLICATION, 'app-1');
    const nodeS = createTestNode(ENTITY_TYPES.APPLICATION, 'app-2');
    const nodeU = createTestNode(ENTITY_TYPES.BUSINESS_USER, 'user-1');

    const interaction = createTestInteractionCaseA('int-1', 'user-1', abpP.id, abpS.id);

    // Before deletion: edges exist, row should be disabled
    const diagramWithEdges = createTestDiagram({
      diagram_nodes: [nodeP, nodeS, nodeU],
      diagram_edges: [
        createTestUserInteractionEdge('edge-main', 'int-1', nodeP.id, nodeS.id, 'MAIN'),
        createTestUserInteractionEdge('edge-user-link', 'int-1', nodeU.id, 'midpoint-int-1', 'USER_LINK'),
      ],
    });

    expect(isUserInteractionRowEnabled(interaction, diagramWithEdges, metaModel)).toBe(false);

    // After deletion: no edges, row should be enabled
    const diagramWithoutEdges = createTestDiagram({
      diagram_nodes: [nodeP, nodeS, nodeU],
      diagram_edges: [],
    });

    expect(isUserInteractionRowEnabled(interaction, diagramWithoutEdges, metaModel)).toBe(true);
  });

  // Test: After deleting MAIN edge (and cascading USER_LINK), row becomes enabled
  it('should re-enable row after cascade deletion removes all edges', () => {
    const app1: Application = { id: 'app-1', name: 'App 1', description: '', app_type: '', status: '', tags: '' };
    const app2: Application = { id: 'app-2', name: 'App 2', description: '', app_type: '', status: '', tags: '' };
    const user1: BusinessUser = { id: 'user-1', name: 'User 1', description: '', tags: '' };

    const abpP = createTestAppBusinessPoint('app-1', 'APPLICATION', 'App 1');
    const abpS = createTestAppBusinessPoint('app-2', 'APPLICATION', 'App 2');

    const metaModel = createTestMetaModel({
      entities: {
        business_users: [user1],
        business_processes: [],
        process_activities: [],
        business_points: [],
        applications: [app1, app2],
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
        app_business_points: [abpP, abpS],
      },
    });

    const nodeP = createTestNode(ENTITY_TYPES.APPLICATION, 'app-1');
    const nodeS = createTestNode(ENTITY_TYPES.APPLICATION, 'app-2');
    const nodeU = createTestNode(ENTITY_TYPES.BUSINESS_USER, 'user-1');

    const interaction = createTestInteractionCaseA('int-1', 'user-1', abpP.id, abpS.id);

    const mainEdge = createTestUserInteractionEdge('edge-main', 'int-1', nodeP.id, nodeS.id, 'MAIN');
    const userLinkEdge = createTestUserInteractionEdge('edge-user-link', 'int-1', nodeU.id, 'midpoint-int-1', 'USER_LINK');

    const diagramWithEdges = createTestDiagram({
      diagram_nodes: [nodeP, nodeS, nodeU],
      diagram_edges: [mainEdge, userLinkEdge],
    });

    // Simulate cascade deletion: find USER_LINK to cascade
    const cascadeEdge = shouldCascadeDeleteUserLink(mainEdge, diagramWithEdges.diagram_edges);
    expect(cascadeEdge).not.toBeNull();
    expect(cascadeEdge?.id).toBe('edge-user-link');

    // After cascade deletion removes both edges
    const remainingEdges = diagramWithEdges.diagram_edges.filter(
      e => e.id !== mainEdge.id && e.id !== cascadeEdge?.id
    );

    expect(remainingEdges).toHaveLength(0);

    // Verify edge count is 0
    expect(getInteractionEdgeCountForInteraction('int-1', remainingEdges)).toBe(0);

    // Row should be re-enabled
    const diagramAfterDeletion = createTestDiagram({
      diagram_nodes: [nodeP, nodeS, nodeU],
      diagram_edges: remainingEdges,
    });

    expect(isUserInteractionRowEnabled(interaction, diagramAfterDeletion, metaModel)).toBe(true);
  });

  // Test: After deleting only USER_LINK, row remains disabled (MAIN still exists)
  it('should keep row disabled after deleting only USER_LINK (MAIN remains)', () => {
    const app1: Application = { id: 'app-1', name: 'App 1', description: '', app_type: '', status: '', tags: '' };
    const app2: Application = { id: 'app-2', name: 'App 2', description: '', app_type: '', status: '', tags: '' };
    const user1: BusinessUser = { id: 'user-1', name: 'User 1', description: '', tags: '' };

    const abpP = createTestAppBusinessPoint('app-1', 'APPLICATION', 'App 1');
    const abpS = createTestAppBusinessPoint('app-2', 'APPLICATION', 'App 2');

    const metaModel = createTestMetaModel({
      entities: {
        business_users: [user1],
        business_processes: [],
        process_activities: [],
        business_points: [],
        applications: [app1, app2],
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
        app_business_points: [abpP, abpS],
      },
    });

    const nodeP = createTestNode(ENTITY_TYPES.APPLICATION, 'app-1');
    const nodeS = createTestNode(ENTITY_TYPES.APPLICATION, 'app-2');
    const nodeU = createTestNode(ENTITY_TYPES.BUSINESS_USER, 'user-1');

    const interaction = createTestInteractionCaseA('int-1', 'user-1', abpP.id, abpS.id);

    const mainEdge = createTestUserInteractionEdge('edge-main', 'int-1', nodeP.id, nodeS.id, 'MAIN');
    const userLinkEdge = createTestUserInteractionEdge('edge-user-link', 'int-1', nodeU.id, 'midpoint-int-1', 'USER_LINK');

    // After deleting USER_LINK only, MAIN edge remains
    const diagramAfterUserLinkDeletion = createTestDiagram({
      diagram_nodes: [nodeP, nodeS, nodeU],
      diagram_edges: [mainEdge], // Only MAIN edge remains
    });

    // Deleting USER_LINK should not cascade to MAIN
    const cascadeEdge = shouldCascadeDeleteUserLink(userLinkEdge, [mainEdge, userLinkEdge]);
    expect(cascadeEdge).toBeNull();

    // Row should remain disabled (MAIN edge still exists)
    expect(isUserInteractionRowEnabled(interaction, diagramAfterUserLinkDeletion, metaModel)).toBe(false);

    // Verify edge count is 1
    expect(getInteractionEdgeCountForInteraction('int-1', diagramAfterUserLinkDeletion.diagram_edges)).toBe(1);
  });
});

// ============================================================================
// Test Suite: Edge Deletion Without USER_LINK
// ============================================================================

describe('Edge deletion without USER_LINK', () => {
  it('should work correctly when deleting MAIN edge with no USER_LINK', () => {
    const app1: Application = { id: 'app-1', name: 'App 1', description: '', app_type: '', status: '', tags: '' };
    const app2: Application = { id: 'app-2', name: 'App 2', description: '', app_type: '', status: '', tags: '' };

    const abpP = createTestAppBusinessPoint('app-1', 'APPLICATION', 'App 1');
    const abpS = createTestAppBusinessPoint('app-2', 'APPLICATION', 'App 2');

    const metaModel = createTestMetaModel({
      entities: {
        business_users: [{ id: 'user-1', name: 'User', description: '', tags: '' }],
        business_processes: [],
        process_activities: [],
        business_points: [],
        applications: [app1, app2],
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
        app_business_points: [abpP, abpS],
      },
    });

    const nodeP = createTestNode(ENTITY_TYPES.APPLICATION, 'app-1');
    const nodeS = createTestNode(ENTITY_TYPES.APPLICATION, 'app-2');

    const interaction = createTestInteractionCaseA('int-1', 'user-1', abpP.id, abpS.id);

    const mainEdge = createTestUserInteractionEdge('edge-main', 'int-1', nodeP.id, nodeS.id, 'MAIN');

    // No USER_LINK edge exists
    const diagramWithMainOnly = createTestDiagram({
      diagram_nodes: [nodeP, nodeS],
      diagram_edges: [mainEdge],
    });

    // Cascade deletion should return null (no USER_LINK to cascade)
    const cascadeEdge = shouldCascadeDeleteUserLink(mainEdge, diagramWithMainOnly.diagram_edges);
    expect(cascadeEdge).toBeNull();

    // After deleting MAIN, no edges remain
    const diagramAfterDeletion = createTestDiagram({
      diagram_nodes: [nodeP, nodeS],
      diagram_edges: [],
    });

    // Row should be re-enabled
    expect(isUserInteractionRowEnabled(interaction, diagramAfterDeletion, metaModel)).toBe(true);
  });
});

// ============================================================================
// Test Suite: Edge Deletion with Temporal Validity
// ============================================================================

describe('Edge deletion respects temporal validity', () => {
  it('should correctly identify edges for specific interaction regardless of temporal state', () => {
    // This test verifies that edge identification works correctly
    // Temporal validity on edges controls visibility, not cascade logic

    const mainEdge = createTestUserInteractionEdge('edge-main', 'int-1', 'node-p', 'node-s', 'MAIN');
    mainEdge.valid_from = '2024-Q1';
    mainEdge.valid_to = '2024-Q4';

    const userLinkEdge = createTestUserInteractionEdge('edge-user-link', 'int-1', 'node-user', 'midpoint-int-1', 'USER_LINK');
    userLinkEdge.valid_from = '2024-Q1';
    userLinkEdge.valid_to = '2024-Q4';

    const diagramEdges: DiagramEdge[] = [mainEdge, userLinkEdge];

    // Cascade logic should still work - temporal validity doesn't prevent cascade
    const result = shouldCascadeDeleteUserLink(mainEdge, diagramEdges);
    expect(result).not.toBeNull();
    expect(result?.id).toBe('edge-user-link');
  });

  it('should count edges correctly regardless of temporal validity fields', () => {
    const mainEdge = createTestUserInteractionEdge('edge-main', 'int-1', 'node-p', 'node-s', 'MAIN');
    mainEdge.valid_from = '2024-Q1';
    mainEdge.valid_to = '2024-Q4';

    const userLinkEdge = createTestUserInteractionEdge('edge-user-link', 'int-1', 'node-user', 'midpoint-int-1', 'USER_LINK');
    // No temporal validity fields on USER_LINK

    const diagramEdges: DiagramEdge[] = [mainEdge, userLinkEdge];

    // Edge count should include all edges regardless of temporal fields
    const result = getInteractionEdgeCountForInteraction('int-1', diagramEdges);
    expect(result).toBe(2);
  });
});
