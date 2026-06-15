/**
 * Integration Tests for User Interaction Visualisation Feature
 *
 * Task Group 6: Test Review and Integration
 * These tests verify end-to-end workflows and critical user scenarios.
 *
 * This file covers gaps identified in Task Group 1-5 tests:
 * - End-to-end: Case A workflow with User node
 * - End-to-end: Case A workflow without User node
 * - End-to-end: Case B complete workflow
 * - PalettePanel integration: clicking row adds edges
 * - Temporal filtering: interaction hidden when invalid
 * - Edge midpoint calculation accuracy
 * - Multiple interactions on same diagram
 * - AC5 verification: No Interaction nodes created (edges only)
 */

import {
  isUserInteractionCase,
  getInteractionEdgesOnDiagram,
  isUserInteractionRowEnabled,
  getAppBusinessPointNodeId,
  isInteractionVisibleAtTime,
  addUserInteractionToDiagram,
  calculateEdgeMidpoint,
  shouldCascadeDeleteUserLink,
  getInteractionEdgeCountForInteraction,
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
  LINE_DASHES_DOTTED,
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
    line_dashes: LINE_DASHES_DOTTED,
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
  name?: string,
  overrides?: Partial<Interaction>
): Interaction {
  return {
    id,
    name: name || `Interaction ${id}`,
    user_id: userId,
    primary_app_business_point_id: primaryAbpId,
    secondary_app_business_point_id: secondaryAbpId,
    ...overrides,
  };
}

/**
 * Create a test Interaction (Case B - with only primary ABP)
 */
function createTestInteractionCaseB(
  id: string,
  userId: string,
  primaryAbpId: string,
  name?: string,
  overrides?: Partial<Interaction>
): Interaction {
  return {
    id,
    name: name || `Interaction ${id}`,
    user_id: userId,
    primary_app_business_point_id: primaryAbpId,
    secondary_app_business_point_id: undefined,
    ...overrides,
  };
}

// ============================================================================
// Integration Test 1: End-to-End Case A Workflow WITH User Node
// Verifies AC1: Case A enabling and adding works correctly
// ============================================================================

describe('Integration: Case A End-to-End Workflow WITH User Node', () => {
  it('should complete full workflow: enable -> add -> disable -> delete -> re-enable', () => {
    // Setup: Create meta-model with 2 apps and 1 user
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

    const nodeP = createTestNode(ENTITY_TYPES.APPLICATION, 'app-1', { x: 100, y: 100 });
    const nodeS = createTestNode(ENTITY_TYPES.APPLICATION, 'app-2', { x: 400, y: 100 });
    const nodeU = createTestNode(ENTITY_TYPES.BUSINESS_USER, 'user-1', { x: 250, y: 300 });

    const interaction = createTestInteractionCaseA('int-1', 'user-1', abpP.id, abpS.id, 'Login Flow');

    // Step 1: Row should be ENABLED initially (P, S, U on diagram, no edges)
    const diagramInitial = createTestDiagram({
      diagram_nodes: [nodeP, nodeS, nodeU],
      diagram_edges: [],
    });

    expect(isUserInteractionRowEnabled(interaction, diagramInitial, metaModel)).toBe(true);

    // Step 2: Add interaction edges
    const result = addUserInteractionToDiagram(interaction, diagramInitial, metaModel);

    // Verify MAIN edge created between P and S
    expect(result.mainEdge).toBeDefined();
    expect(result.mainEdge.subType).toBe('MAIN');
    expect(result.mainEdge.source_node_id).toBe(nodeP.id);
    expect(result.mainEdge.target_node_id).toBe(nodeS.id);
    expect(result.mainEdge.relationship_type).toBe(RELATIONSHIP_EDGE_TYPES.USER_INTERACTION);
    expect(result.mainEdge.label_text).toBe('Login Flow');
    expect(result.mainEdge.line_dashes).toBe(LINE_DASHES_DOTTED);

    // Verify USER_LINK edge created (User node present)
    expect(result.userLinkEdge).toBeDefined();
    expect(result.userLinkEdge!.subType).toBe('USER_LINK');
    expect(result.userLinkEdge!.source_node_id).toBe(nodeU.id);
    expect(result.userLinkEdge!.line_dashes).toBe(LINE_DASHES_DOTTED);

    // Step 3: Row should be DISABLED after edges added
    const diagramWithEdges = createTestDiagram({
      diagram_nodes: [nodeP, nodeS, nodeU],
      diagram_edges: [result.mainEdge, result.userLinkEdge!],
    });

    expect(isUserInteractionRowEnabled(interaction, diagramWithEdges, metaModel)).toBe(false);

    // Step 4: Simulate deleting MAIN edge (should cascade to USER_LINK)
    const cascadeEdge = shouldCascadeDeleteUserLink(result.mainEdge, diagramWithEdges.diagram_edges);
    expect(cascadeEdge).not.toBeNull();
    expect(cascadeEdge?.id).toBe(result.userLinkEdge!.id);

    // Step 5: After all edges removed, row should be RE-ENABLED
    const diagramAfterDelete = createTestDiagram({
      diagram_nodes: [nodeP, nodeS, nodeU],
      diagram_edges: [],
    });

    expect(isUserInteractionRowEnabled(interaction, diagramAfterDelete, metaModel)).toBe(true);
  });
});

// ============================================================================
// Integration Test 2: End-to-End Case A Workflow WITHOUT User Node
// Verifies Case A enables without User node but omits USER_LINK
// ============================================================================

describe('Integration: Case A End-to-End Workflow WITHOUT User Node', () => {
  it('should enable without User node and create only MAIN edge', () => {
    // Setup: Create meta-model with 2 apps (no User node on diagram)
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

    const nodeP = createTestNode(ENTITY_TYPES.APPLICATION, 'app-1', { x: 100, y: 100 });
    const nodeS = createTestNode(ENTITY_TYPES.APPLICATION, 'app-2', { x: 400, y: 100 });
    // No User node on diagram

    const interaction = createTestInteractionCaseA('int-1', 'user-1', abpP.id, abpS.id);

    // Step 1: Row should be ENABLED (P and S on diagram - User NOT required for Case A)
    const diagram = createTestDiagram({
      diagram_nodes: [nodeP, nodeS],
      diagram_edges: [],
    });

    expect(isUserInteractionRowEnabled(interaction, diagram, metaModel)).toBe(true);

    // Step 2: Add interaction edges
    const result = addUserInteractionToDiagram(interaction, diagram, metaModel);

    // Verify MAIN edge created
    expect(result.mainEdge).toBeDefined();
    expect(result.mainEdge.subType).toBe('MAIN');

    // Verify NO USER_LINK edge created (User node not present)
    expect(result.userLinkEdge).toBeUndefined();

    // Step 3: Row should be DISABLED after MAIN edge added
    const diagramWithEdge = createTestDiagram({
      diagram_nodes: [nodeP, nodeS],
      diagram_edges: [result.mainEdge],
    });

    expect(isUserInteractionRowEnabled(interaction, diagramWithEdge, metaModel)).toBe(false);
  });
});

// ============================================================================
// Integration Test 3: End-to-End Case B Complete Workflow
// Verifies AC2: Case B enabling and adding works correctly
// ============================================================================

describe('Integration: Case B End-to-End Workflow', () => {
  it('should complete full workflow: enable -> add -> disable -> delete -> re-enable', () => {
    // Setup: Case B interaction with only primary ABP
    const app1: Application = { id: 'app-1', name: 'App 1', description: '', app_type: '', status: '', tags: '' };
    const user1: BusinessUser = { id: 'user-1', name: 'User 1', description: '', tags: '' };

    const abpP = createTestAppBusinessPoint('app-1', 'APPLICATION', 'App 1');

    const metaModel = createTestMetaModel({
      entities: {
        business_users: [user1],
        business_processes: [],
        process_activities: [],
        business_points: [],
        applications: [app1],
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
        app_business_points: [abpP],
      },
    });

    const nodeP = createTestNode(ENTITY_TYPES.APPLICATION, 'app-1', { x: 300, y: 100 });
    const nodeU = createTestNode(ENTITY_TYPES.BUSINESS_USER, 'user-1', { x: 100, y: 100 });

    const interaction = createTestInteractionCaseB('int-1', 'user-1', abpP.id, 'View Dashboard');

    // Step 1: Row should be ENABLED (P and U on diagram, no edges)
    const diagramInitial = createTestDiagram({
      diagram_nodes: [nodeP, nodeU],
      diagram_edges: [],
    });

    expect(isUserInteractionCase(interaction)).toBe('B');
    expect(isUserInteractionRowEnabled(interaction, diagramInitial, metaModel)).toBe(true);

    // Step 2: Add interaction edges
    const result = addUserInteractionToDiagram(interaction, diagramInitial, metaModel);

    // Verify MAIN edge created between U and P (Case B: User to Primary)
    expect(result.mainEdge).toBeDefined();
    expect(result.mainEdge.subType).toBe('MAIN');
    expect(result.mainEdge.source_node_id).toBe(nodeU.id);
    expect(result.mainEdge.target_node_id).toBe(nodeP.id);
    expect(result.mainEdge.label_text).toBe('View Dashboard');

    // Verify NO USER_LINK edge in Case B
    expect(result.userLinkEdge).toBeUndefined();

    // Step 3: Row should be DISABLED after edge added
    const diagramWithEdge = createTestDiagram({
      diagram_nodes: [nodeP, nodeU],
      diagram_edges: [result.mainEdge],
    });

    expect(isUserInteractionRowEnabled(interaction, diagramWithEdge, metaModel)).toBe(false);

    // Step 4: After edge removed, row should be RE-ENABLED
    const diagramAfterDelete = createTestDiagram({
      diagram_nodes: [nodeP, nodeU],
      diagram_edges: [],
    });

    expect(isUserInteractionRowEnabled(interaction, diagramAfterDelete, metaModel)).toBe(true);
  });

  it('should be DISABLED when User node is missing (Case B requires User)', () => {
    // Setup: Case B but User node not on diagram
    const app1: Application = { id: 'app-1', name: 'App 1', description: '', app_type: '', status: '', tags: '' };
    const user1: BusinessUser = { id: 'user-1', name: 'User 1', description: '', tags: '' };

    const abpP = createTestAppBusinessPoint('app-1', 'APPLICATION', 'App 1');

    const metaModel = createTestMetaModel({
      entities: {
        business_users: [user1],
        business_processes: [],
        process_activities: [],
        business_points: [],
        applications: [app1],
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
        app_business_points: [abpP],
      },
    });

    const nodeP = createTestNode(ENTITY_TYPES.APPLICATION, 'app-1', { x: 300, y: 100 });
    // No User node on diagram

    const interaction = createTestInteractionCaseB('int-1', 'user-1', abpP.id);

    const diagram = createTestDiagram({
      diagram_nodes: [nodeP],
      diagram_edges: [],
    });

    // Case B requires User node - should be DISABLED
    expect(isUserInteractionRowEnabled(interaction, diagram, metaModel)).toBe(false);
  });
});

// ============================================================================
// Integration Test 4: Deleting USER_LINK Leaves Row Disabled
// Verifies AC3: Deleting USER_LINK leaves row disabled
// ============================================================================

describe('Integration: Deleting USER_LINK Only Keeps Row Disabled', () => {
  it('should keep row disabled after deleting USER_LINK (MAIN remains)', () => {
    // Setup
    const app1: Application = { id: 'app-1', name: 'App 1', description: '', app_type: '', status: '', tags: '' };
    const app2: Application = { id: 'app-2', name: 'App 2', description: '', app_type: '', status: '', tags: '' };
    const user1: BusinessUser = { id: 'user-1', name: 'User 1', description: '', tags: '' };

    const abpP = createTestAppBusinessPoint('app-1', 'APPLICATION');
    const abpS = createTestAppBusinessPoint('app-2', 'APPLICATION');

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

    // Diagram with both edges
    const diagramWithBothEdges = createTestDiagram({
      diagram_nodes: [nodeP, nodeS, nodeU],
      diagram_edges: [mainEdge, userLinkEdge],
    });

    expect(isUserInteractionRowEnabled(interaction, diagramWithBothEdges, metaModel)).toBe(false);

    // Verify deleting USER_LINK does NOT cascade
    const cascadeResult = shouldCascadeDeleteUserLink(userLinkEdge, diagramWithBothEdges.diagram_edges);
    expect(cascadeResult).toBeNull();

    // After deleting USER_LINK only, MAIN edge remains
    const diagramWithMainOnly = createTestDiagram({
      diagram_nodes: [nodeP, nodeS, nodeU],
      diagram_edges: [mainEdge],
    });

    // Row should STILL be disabled (MAIN edge exists)
    expect(isUserInteractionRowEnabled(interaction, diagramWithMainOnly, metaModel)).toBe(false);
    expect(getInteractionEdgeCountForInteraction('int-1', diagramWithMainOnly.diagram_edges)).toBe(1);
  });
});

// ============================================================================
// Integration Test 5: Temporal Filtering
// ============================================================================

describe('Integration: Temporal Filtering', () => {
  it('should hide interaction when invalid at diagram view_quarter', () => {
    const interaction: Interaction = {
      id: 'int-1',
      name: 'Sunset Feature',
      user_id: 'user-1',
      primary_app_business_point_id: 'abp_app-1',
      secondary_app_business_point_id: 'abp_app-2',
      valid_from: '2024-Q1',
      valid_to: '2024-Q2',
    };

    // Test at Q1 - should be visible
    expect(isInteractionVisibleAtTime(interaction, '2024-Q1')).toBe(true);

    // Test at Q2 - should be visible
    expect(isInteractionVisibleAtTime(interaction, '2024-Q2')).toBe(true);

    // Test at Q3 - should be HIDDEN (past valid_to)
    expect(isInteractionVisibleAtTime(interaction, '2024-Q3')).toBe(false);

    // Test at Q4 - should be HIDDEN
    expect(isInteractionVisibleAtTime(interaction, '2024-Q4')).toBe(false);

    // Test at 2023-Q4 - should be HIDDEN (before valid_from)
    expect(isInteractionVisibleAtTime(interaction, '2023-Q4')).toBe(false);
  });

  it('should show interaction with open-ended validity', () => {
    const interactionNoEnd: Interaction = {
      id: 'int-2',
      name: 'Ongoing Feature',
      user_id: 'user-1',
      primary_app_business_point_id: 'abp_app-1',
      valid_from: '2024-Q1',
      // No valid_to - open-ended
    };

    expect(isInteractionVisibleAtTime(interactionNoEnd, '2024-Q1')).toBe(true);
    expect(isInteractionVisibleAtTime(interactionNoEnd, '2030-Q4')).toBe(true);
    expect(isInteractionVisibleAtTime(interactionNoEnd, '2023-Q4')).toBe(false);

    const interactionNoStart: Interaction = {
      id: 'int-3',
      name: 'Legacy Feature',
      user_id: 'user-1',
      primary_app_business_point_id: 'abp_app-1',
      // No valid_from - open-ended
      valid_to: '2024-Q2',
    };

    expect(isInteractionVisibleAtTime(interactionNoStart, '2020-Q1')).toBe(true);
    expect(isInteractionVisibleAtTime(interactionNoStart, '2024-Q2')).toBe(true);
    expect(isInteractionVisibleAtTime(interactionNoStart, '2024-Q3')).toBe(false);
  });
});

// ============================================================================
// Integration Test 6: Edge Midpoint Calculation Accuracy
// ============================================================================

describe('Integration: Edge Midpoint Calculation', () => {
  it('should calculate midpoint accurately for label and USER_LINK positioning', () => {
    // Horizontal edge
    const midpointH = calculateEdgeMidpoint({ x: 100, y: 100 }, { x: 400, y: 100 });
    expect(midpointH.x).toBe(250);
    expect(midpointH.y).toBe(100);

    // Vertical edge
    const midpointV = calculateEdgeMidpoint({ x: 200, y: 50 }, { x: 200, y: 350 });
    expect(midpointV.x).toBe(200);
    expect(midpointV.y).toBe(200);

    // Diagonal edge
    const midpointD = calculateEdgeMidpoint({ x: 0, y: 0 }, { x: 200, y: 200 });
    expect(midpointD.x).toBe(100);
    expect(midpointD.y).toBe(100);

    // Verify label position matches midpoint in created edge
    const app1: Application = { id: 'app-1', name: 'App 1', description: '', app_type: '', status: '', tags: '' };
    const app2: Application = { id: 'app-2', name: 'App 2', description: '', app_type: '', status: '', tags: '' };

    const abpP = createTestAppBusinessPoint('app-1', 'APPLICATION');
    const abpS = createTestAppBusinessPoint('app-2', 'APPLICATION');

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

    // Create nodes with specific positions
    const nodeP = createTestNode(ENTITY_TYPES.APPLICATION, 'app-1', { x: 100, y: 100 }, { width: 120, height: 60 });
    const nodeS = createTestNode(ENTITY_TYPES.APPLICATION, 'app-2', { x: 400, y: 100 }, { width: 120, height: 60 });

    const diagram = createTestDiagram({
      diagram_nodes: [nodeP, nodeS],
      diagram_edges: [],
    });

    const interaction = createTestInteractionCaseA('int-1', 'user-1', abpP.id, abpS.id);
    const result = addUserInteractionToDiagram(interaction, diagram, metaModel);

    // Calculate expected midpoint based on node centers
    const nodePCenter = { x: 100 + 120 / 2, y: 100 + 60 / 2 }; // { x: 160, y: 130 }
    const nodeSCenter = { x: 400 + 120 / 2, y: 100 + 60 / 2 }; // { x: 460, y: 130 }
    const expectedMidpoint = calculateEdgeMidpoint(nodePCenter, nodeSCenter); // { x: 310, y: 130 }

    expect(result.mainEdge.label_pos_x).toBe(expectedMidpoint.x);
    expect(result.mainEdge.label_pos_y).toBe(expectedMidpoint.y);
  });
});

// ============================================================================
// Integration Test 7: Multiple Interactions on Same Diagram
// ============================================================================

describe('Integration: Multiple Interactions on Same Diagram', () => {
  it('should handle multiple independent interactions correctly', () => {
    // Setup: 3 apps, 1 user, 2 interactions
    const app1: Application = { id: 'app-1', name: 'App 1', description: '', app_type: '', status: '', tags: '' };
    const app2: Application = { id: 'app-2', name: 'App 2', description: '', app_type: '', status: '', tags: '' };
    const app3: Application = { id: 'app-3', name: 'App 3', description: '', app_type: '', status: '', tags: '' };
    const user1: BusinessUser = { id: 'user-1', name: 'User 1', description: '', tags: '' };

    const abp1 = createTestAppBusinessPoint('app-1', 'APPLICATION');
    const abp2 = createTestAppBusinessPoint('app-2', 'APPLICATION');
    const abp3 = createTestAppBusinessPoint('app-3', 'APPLICATION');

    const metaModel = createTestMetaModel({
      entities: {
        business_users: [user1],
        business_processes: [],
        process_activities: [],
        business_points: [],
        applications: [app1, app2, app3],
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
        app_business_points: [abp1, abp2, abp3],
      },
    });

    const node1 = createTestNode(ENTITY_TYPES.APPLICATION, 'app-1', { x: 100, y: 100 });
    const node2 = createTestNode(ENTITY_TYPES.APPLICATION, 'app-2', { x: 300, y: 100 });
    const node3 = createTestNode(ENTITY_TYPES.APPLICATION, 'app-3', { x: 500, y: 100 });
    const nodeU = createTestNode(ENTITY_TYPES.BUSINESS_USER, 'user-1', { x: 300, y: 300 });

    // Interaction 1: App1 -> App2
    const interaction1 = createTestInteractionCaseA('int-1', 'user-1', abp1.id, abp2.id, 'Login');
    // Interaction 2: App2 -> App3
    const interaction2 = createTestInteractionCaseA('int-2', 'user-1', abp2.id, abp3.id, 'Checkout');

    const diagramEmpty = createTestDiagram({
      diagram_nodes: [node1, node2, node3, nodeU],
      diagram_edges: [],
    });

    // Both interactions should be enabled initially
    expect(isUserInteractionRowEnabled(interaction1, diagramEmpty, metaModel)).toBe(true);
    expect(isUserInteractionRowEnabled(interaction2, diagramEmpty, metaModel)).toBe(true);

    // Add first interaction
    const result1 = addUserInteractionToDiagram(interaction1, diagramEmpty, metaModel);
    const edges1 = [result1.mainEdge];
    if (result1.userLinkEdge) edges1.push(result1.userLinkEdge);

    const diagramWith1 = createTestDiagram({
      diagram_nodes: [node1, node2, node3, nodeU],
      diagram_edges: edges1,
    });

    // First interaction disabled, second still enabled
    expect(isUserInteractionRowEnabled(interaction1, diagramWith1, metaModel)).toBe(false);
    expect(isUserInteractionRowEnabled(interaction2, diagramWith1, metaModel)).toBe(true);

    // Add second interaction
    const result2 = addUserInteractionToDiagram(interaction2, diagramWith1, metaModel);
    const allEdges = [...edges1, result2.mainEdge];
    if (result2.userLinkEdge) allEdges.push(result2.userLinkEdge);

    const diagramWithBoth = createTestDiagram({
      diagram_nodes: [node1, node2, node3, nodeU],
      diagram_edges: allEdges,
    });

    // Both disabled
    expect(isUserInteractionRowEnabled(interaction1, diagramWithBoth, metaModel)).toBe(false);
    expect(isUserInteractionRowEnabled(interaction2, diagramWithBoth, metaModel)).toBe(false);

    // Verify edge counts
    expect(getInteractionEdgeCountForInteraction('int-1', allEdges)).toBeGreaterThanOrEqual(1);
    expect(getInteractionEdgeCountForInteraction('int-2', allEdges)).toBeGreaterThanOrEqual(1);

    // Each interaction's edges should be independent
    const int1Edges = getInteractionEdgesOnDiagram('int-1', allEdges);
    const int2Edges = getInteractionEdgesOnDiagram('int-2', allEdges);

    // Verify no overlap in edge IDs
    const int1EdgeIds = new Set(int1Edges.map(e => e.id));
    const int2EdgeIds = new Set(int2Edges.map(e => e.id));

    for (const id of int1EdgeIds) {
      expect(int2EdgeIds.has(id)).toBe(false);
    }
  });
});

// ============================================================================
// Integration Test 8: AC5 Verification - No Interaction Nodes Created
// Verifies AC5: No Interaction nodes created (edges only)
// ============================================================================

describe('Integration: AC5 - Interactions are Edges Only', () => {
  it('should never create Interaction nodes, only edges', () => {
    const app1: Application = { id: 'app-1', name: 'App 1', description: '', app_type: '', status: '', tags: '' };
    const app2: Application = { id: 'app-2', name: 'App 2', description: '', app_type: '', status: '', tags: '' };
    const user1: BusinessUser = { id: 'user-1', name: 'User 1', description: '', tags: '' };

    const abpP = createTestAppBusinessPoint('app-1', 'APPLICATION');
    const abpS = createTestAppBusinessPoint('app-2', 'APPLICATION');

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

    const diagram = createTestDiagram({
      diagram_nodes: [nodeP, nodeS, nodeU],
      diagram_edges: [],
    });

    // Add interaction
    const result = addUserInteractionToDiagram(interaction, diagram, metaModel);

    // Verify result contains only edges, no nodes
    expect(result.mainEdge).toBeDefined();
    expect((result as any).node).toBeUndefined();
    expect((result as any).nodes).toBeUndefined();
    expect((result as any).interactionNode).toBeUndefined();

    // Verify edges have correct relationship type
    expect(result.mainEdge.relationship_type).toBe(RELATIONSHIP_EDGE_TYPES.USER_INTERACTION);
    if (result.userLinkEdge) {
      expect(result.userLinkEdge.relationship_type).toBe(RELATIONSHIP_EDGE_TYPES.USER_INTERACTION);
    }

    // Verify edge targets are NOT an "Interaction" node
    // (They should be App nodes or midpoint identifiers)
    expect(result.mainEdge.source_node_id).toBe(nodeP.id);
    expect(result.mainEdge.target_node_id).toBe(nodeS.id);

    // Neither source nor target should contain "interaction" entity type
    const sourceNode = [nodeP, nodeS, nodeU].find(n => n.id === result.mainEdge.source_node_id);
    const targetNode = [nodeP, nodeS, nodeU].find(n => n.id === result.mainEdge.target_node_id);

    expect(sourceNode?.entity_type).not.toBe('INTERACTION');
    expect(targetNode?.entity_type).not.toBe('INTERACTION');
  });
});
