/**
 * Tests for User Interaction Edge Creation
 *
 * Task Group 3: Adding User Interaction Edges (Case A and Case B)
 * Tests for the User Interaction Visualisation feature edge creation logic.
 *
 * These tests verify:
 * - Case A: Creates MAIN edge between P and S nodes
 * - Case A: Creates USER_LINK edge when U node present
 * - Case A: Omits USER_LINK edge when U node absent
 * - Case B: Creates MAIN edge between U and P nodes
 * - Label positioning at edge midpoint
 * - Dotted line styling applied to edges
 * - subType field correctly set ('MAIN' or 'USER_LINK')
 *
 * UPDATED: Tests now use the new function signatures:
 * - createUserInteractionMainEdge(interaction, sourceNode, targetNode)
 * - createUserInteractionUserLinkEdge(interaction, userNode, midpoint)
 */

import {
  createUserInteractionMainEdge,
  createUserInteractionUserLinkEdge,
  calculateEdgeMidpoint,
  addUserInteractionToDiagram,
} from '../utils/userInteractionUtils';
import {
  Interaction,
  Diagram,
  DiagramNode,
  MetaModel,
  ENTITY_TYPES,
  RELATIONSHIP_EDGE_TYPES,
  LINE_DASHES_DOTTED,
  AppBusinessPoint,
  Application,
  BusinessUser,
} from '../types/model';

// ============================================================================
// Test Fixtures
// ============================================================================

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

// ============================================================================
// Test Suite: calculateEdgeMidpoint Helper
// ============================================================================

describe('calculateEdgeMidpoint', () => {
  it('should calculate midpoint between two positions', () => {
    const midpoint = calculateEdgeMidpoint({ x: 0, y: 0 }, { x: 100, y: 100 });
    expect(midpoint.x).toBe(50);
    expect(midpoint.y).toBe(50);
  });

  it('should handle negative coordinates', () => {
    const midpoint = calculateEdgeMidpoint({ x: -100, y: -50 }, { x: 100, y: 50 });
    expect(midpoint.x).toBe(0);
    expect(midpoint.y).toBe(0);
  });

  it('should handle same positions (edge case)', () => {
    const midpoint = calculateEdgeMidpoint({ x: 50, y: 50 }, { x: 50, y: 50 });
    expect(midpoint.x).toBe(50);
    expect(midpoint.y).toBe(50);
  });
});

// ============================================================================
// Test Suite: createUserInteractionMainEdge (NEW SIGNATURE)
// ============================================================================

describe('createUserInteractionMainEdge', () => {
  it('should create MAIN edge with correct relationship_type', () => {
    const interaction = createTestInteractionCaseA('int-1', 'user-1', 'abp_app-1', 'abp_app-2', 'Login Flow');
    const sourceNode = createTestNode(ENTITY_TYPES.APPLICATION, 'app-1', { x: 100, y: 100 }, { width: 120, height: 60 });
    const targetNode = createTestNode(ENTITY_TYPES.APPLICATION, 'app-2', { x: 300, y: 100 }, { width: 120, height: 60 });

    const edge = createUserInteractionMainEdge(interaction, sourceNode, targetNode);

    expect(edge.relationship_type).toBe(RELATIONSHIP_EDGE_TYPES.USER_INTERACTION);
  });

  it('should set subType to MAIN', () => {
    const interaction = createTestInteractionCaseA('int-1', 'user-1', 'abp_app-1', 'abp_app-2');
    const sourceNode = createTestNode(ENTITY_TYPES.APPLICATION, 'app-1', { x: 100, y: 100 }, { width: 120, height: 60 });
    const targetNode = createTestNode(ENTITY_TYPES.APPLICATION, 'app-2', { x: 300, y: 100 }, { width: 120, height: 60 });

    const edge = createUserInteractionMainEdge(interaction, sourceNode, targetNode);

    expect(edge.subType).toBe('MAIN');
  });

  it('should set line_dashes for dotted styling', () => {
    const interaction = createTestInteractionCaseA('int-1', 'user-1', 'abp_app-1', 'abp_app-2');
    const sourceNode = createTestNode(ENTITY_TYPES.APPLICATION, 'app-1', { x: 100, y: 100 }, { width: 120, height: 60 });
    const targetNode = createTestNode(ENTITY_TYPES.APPLICATION, 'app-2', { x: 300, y: 100 }, { width: 120, height: 60 });

    const edge = createUserInteractionMainEdge(interaction, sourceNode, targetNode);

    expect(edge.line_dashes).toBe(LINE_DASHES_DOTTED);
  });

  it('should set label_text from interaction name', () => {
    const interaction = createTestInteractionCaseA('int-1', 'user-1', 'abp_app-1', 'abp_app-2', 'User Login');
    const sourceNode = createTestNode(ENTITY_TYPES.APPLICATION, 'app-1', { x: 100, y: 100 }, { width: 120, height: 60 });
    const targetNode = createTestNode(ENTITY_TYPES.APPLICATION, 'app-2', { x: 300, y: 100 }, { width: 120, height: 60 });

    const edge = createUserInteractionMainEdge(interaction, sourceNode, targetNode);

    expect(edge.label_text).toBe('User Login');
  });

  it('should position label at geometric center of border-anchored edge', () => {
    const interaction = createTestInteractionCaseA('int-1', 'user-1', 'abp_app-1', 'abp_app-2');
    // Source node at (100, 100) with size 120x60 -> center (160, 130)
    const sourceNode = createTestNode(ENTITY_TYPES.APPLICATION, 'app-1', { x: 100, y: 100 }, { width: 120, height: 60 });
    // Target node at (400, 100) with size 120x60 -> center (460, 130)
    const targetNode = createTestNode(ENTITY_TYPES.APPLICATION, 'app-2', { x: 400, y: 100 }, { width: 120, height: 60 });

    const edge = createUserInteractionMainEdge(interaction, sourceNode, targetNode);

    // Source right edge: (100 + 120, 130) = (220, 130)
    // Target left edge: (400, 130)
    // Midpoint: ((220 + 400) / 2, 130) = (310, 130)
    expect(edge.label_pos_x).toBe(310);
    expect(edge.label_pos_y).toBe(130);
  });

  it('should set relationship_id to interaction id', () => {
    const interaction = createTestInteractionCaseA('int-123', 'user-1', 'abp_app-1', 'abp_app-2');
    const sourceNode = createTestNode(ENTITY_TYPES.APPLICATION, 'app-1', { x: 100, y: 100 }, { width: 120, height: 60 });
    const targetNode = createTestNode(ENTITY_TYPES.APPLICATION, 'app-2', { x: 300, y: 100 }, { width: 120, height: 60 });

    const edge = createUserInteractionMainEdge(interaction, sourceNode, targetNode);

    expect(edge.relationship_id).toBe('int-123');
  });
});

// ============================================================================
// Test Suite: createUserInteractionUserLinkEdge (NEW SIGNATURE)
// ============================================================================

describe('createUserInteractionUserLinkEdge', () => {
  it('should set subType to USER_LINK', () => {
    const interaction = createTestInteractionCaseA('int-1', 'user-1', 'abp_app-1', 'abp_app-2');
    const userNode = createTestNode(ENTITY_TYPES.BUSINESS_USER, 'user-1', { x: 160, y: 260 }, { width: 80, height: 80 });

    const edge = createUserInteractionUserLinkEdge(interaction, userNode, { x: 200, y: 100 });

    expect(edge.subType).toBe('USER_LINK');
  });

  it('should set relationship_type to USER_INTERACTION', () => {
    const interaction = createTestInteractionCaseA('int-1', 'user-1', 'abp_app-1', 'abp_app-2');
    const userNode = createTestNode(ENTITY_TYPES.BUSINESS_USER, 'user-1', { x: 160, y: 260 }, { width: 80, height: 80 });

    const edge = createUserInteractionUserLinkEdge(interaction, userNode, { x: 200, y: 100 });

    expect(edge.relationship_type).toBe(RELATIONSHIP_EDGE_TYPES.USER_INTERACTION);
  });

  it('should set line_dashes for dotted styling', () => {
    const interaction = createTestInteractionCaseA('int-1', 'user-1', 'abp_app-1', 'abp_app-2');
    const userNode = createTestNode(ENTITY_TYPES.BUSINESS_USER, 'user-1', { x: 160, y: 260 }, { width: 80, height: 80 });

    const edge = createUserInteractionUserLinkEdge(interaction, userNode, { x: 200, y: 100 });

    expect(edge.line_dashes).toBe(LINE_DASHES_DOTTED);
  });

  it('should set relationship_id to interaction id', () => {
    const interaction = createTestInteractionCaseA('int-456', 'user-1', 'abp_app-1', 'abp_app-2');
    const userNode = createTestNode(ENTITY_TYPES.BUSINESS_USER, 'user-1', { x: 160, y: 260 }, { width: 80, height: 80 });

    const edge = createUserInteractionUserLinkEdge(interaction, userNode, { x: 200, y: 100 });

    expect(edge.relationship_id).toBe('int-456');
  });

  it('should set target_node_id to empty string', () => {
    const interaction = createTestInteractionCaseA('int-1', 'user-1', 'abp_app-1', 'abp_app-2');
    const userNode = createTestNode(ENTITY_TYPES.BUSINESS_USER, 'user-1', { x: 160, y: 260 }, { width: 80, height: 80 });

    const edge = createUserInteractionUserLinkEdge(interaction, userNode, { x: 200, y: 100 });

    expect(edge.target_node_id).toBe('');
  });
});

// ============================================================================
// Test Suite: addUserInteractionToDiagram - Case A
// ============================================================================

describe('addUserInteractionToDiagram - Case A', () => {
  it('should create MAIN edge between P and S nodes', () => {
    const app1: Application = { id: 'app-1', name: 'App 1', description: '', app_type: '', status: '', tags: '' };
    const app2: Application = { id: 'app-2', name: 'App 2', description: '', app_type: '', status: '', tags: '' };
    const abpP = createTestAppBusinessPoint('app-1', 'APPLICATION', 'App 1');
    const abpS = createTestAppBusinessPoint('app-2', 'APPLICATION', 'App 2');

    const metaModel = createTestMetaModel({
      entities: {
        business_users: [{ id: 'user-1', name: 'User 1', description: '', tags: '' }],
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
    const diagram = createTestDiagram({ diagram_nodes: [nodeP, nodeS], diagram_edges: [] });
    const interaction = createTestInteractionCaseA('int-1', 'user-1', abpP.id, abpS.id);

    const result = addUserInteractionToDiagram(interaction, diagram, metaModel);

    expect(result.mainEdge).toBeDefined();
    expect(result.mainEdge.source_node_id).toBe(nodeP.id);
    expect(result.mainEdge.target_node_id).toBe(nodeS.id);
    expect(result.mainEdge.subType).toBe('MAIN');
  });

  it('should create USER_LINK edge when U node present', () => {
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
    const diagram = createTestDiagram({ diagram_nodes: [nodeP, nodeS, nodeU], diagram_edges: [] });
    const interaction = createTestInteractionCaseA('int-1', 'user-1', abpP.id, abpS.id);

    const result = addUserInteractionToDiagram(interaction, diagram, metaModel);

    expect(result.userLinkEdge).toBeDefined();
    expect(result.userLinkEdge!.source_node_id).toBe(nodeU.id);
    expect(result.userLinkEdge!.subType).toBe('USER_LINK');
  });

  it('should omit USER_LINK edge when U node absent', () => {
    const app1: Application = { id: 'app-1', name: 'App 1', description: '', app_type: '', status: '', tags: '' };
    const app2: Application = { id: 'app-2', name: 'App 2', description: '', app_type: '', status: '', tags: '' };
    const abpP = createTestAppBusinessPoint('app-1', 'APPLICATION', 'App 1');
    const abpS = createTestAppBusinessPoint('app-2', 'APPLICATION', 'App 2');

    const metaModel = createTestMetaModel({
      entities: {
        business_users: [{ id: 'user-1', name: 'User 1', description: '', tags: '' }],
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
    const diagram = createTestDiagram({ diagram_nodes: [nodeP, nodeS], diagram_edges: [] });
    const interaction = createTestInteractionCaseA('int-1', 'user-1', abpP.id, abpS.id);

    const result = addUserInteractionToDiagram(interaction, diagram, metaModel);

    expect(result.mainEdge).toBeDefined();
    expect(result.userLinkEdge).toBeUndefined();
  });
});

// ============================================================================
// Test Suite: addUserInteractionToDiagram - Case B
// ============================================================================

describe('addUserInteractionToDiagram - Case B', () => {
  it('should create MAIN edge between U and P nodes', () => {
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
    const diagram = createTestDiagram({ diagram_nodes: [nodeP, nodeU], diagram_edges: [] });
    const interaction = createTestInteractionCaseB('int-1', 'user-1', abpP.id);

    const result = addUserInteractionToDiagram(interaction, diagram, metaModel);

    expect(result.mainEdge).toBeDefined();
    expect(result.mainEdge.source_node_id).toBe(nodeU.id);
    expect(result.mainEdge.target_node_id).toBe(nodeP.id);
    expect(result.mainEdge.subType).toBe('MAIN');
  });

  it('should NOT create USER_LINK edge in Case B', () => {
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
    const diagram = createTestDiagram({ diagram_nodes: [nodeP, nodeU], diagram_edges: [] });
    const interaction = createTestInteractionCaseB('int-1', 'user-1', abpP.id);

    const result = addUserInteractionToDiagram(interaction, diagram, metaModel);

    expect(result.userLinkEdge).toBeUndefined();
  });
});
