/**
 * Tests for User Interaction Enable/Disable Logic
 *
 * Task Group 2: Enable/Disable Logic for User Interaction Rows
 * Tests for the User Interaction Visualisation feature enable/disable logic.
 *
 * These tests verify:
 * - Case A enabled: P and S nodes on diagram, no edges exist
 * - Case A disabled: P and S on diagram, MAIN edge exists
 * - Case A disabled: P on diagram but S missing
 * - Case B enabled: P and U nodes on diagram, no edges exist
 * - Case B disabled: P and U on diagram, MAIN edge exists
 * - Case B disabled: P on diagram but U missing
 * - Temporal filtering: Interaction not visible if invalid at T
 * - Edge presence check: USER_LINK only also disables row
 */

import {
  isUserInteractionCase,
  getInteractionEdgesOnDiagram,
  isUserInteractionRowEnabled,
  getAppBusinessPointNodeId,
  isInteractionVisibleAtTime,
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
  BusinessProcess,
  Service,
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

/**
 * Create a test Interaction (Case B - with only primary ABP)
 */
function createTestInteractionCaseB(
  id: string,
  userId: string,
  primaryAbpId: string,
  overrides?: Partial<Interaction>
): Interaction {
  return {
    id,
    name: `Interaction ${id}`,
    user_id: userId,
    primary_app_business_point_id: primaryAbpId,
    secondary_app_business_point_id: undefined,
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

// ============================================================================
// Test Suite: isUserInteractionCase Helper
// ============================================================================

describe('isUserInteractionCase', () => {
  it('should return "A" when both primary and secondary ABP are set', () => {
    const interaction = createTestInteractionCaseA('int-1', 'user-1', 'abp_app-1', 'abp_app-2');
    expect(isUserInteractionCase(interaction)).toBe('A');
  });

  it('should return "B" when only primary ABP is set (secondary is undefined)', () => {
    const interaction = createTestInteractionCaseB('int-2', 'user-1', 'abp_app-1');
    expect(isUserInteractionCase(interaction)).toBe('B');
  });

  it('should return "B" when secondary ABP is null', () => {
    const interaction: Interaction = {
      id: 'int-3',
      name: 'Test',
      user_id: 'user-1',
      primary_app_business_point_id: 'abp_app-1',
      secondary_app_business_point_id: undefined,
    };
    expect(isUserInteractionCase(interaction)).toBe('B');
  });
});

// ============================================================================
// Test Suite: getInteractionEdgesOnDiagram Helper
// ============================================================================

describe('getInteractionEdgesOnDiagram', () => {
  it('should return empty array when no edges exist', () => {
    const edges: DiagramEdge[] = [];
    const result = getInteractionEdgesOnDiagram('int-1', edges);
    expect(result).toEqual([]);
  });

  it('should return matching USER_INTERACTION edges', () => {
    const edges: DiagramEdge[] = [
      createTestUserInteractionEdge('edge-1', 'int-1', 'node-1', 'node-2', 'MAIN'),
      createTestUserInteractionEdge('edge-2', 'int-1', 'node-user', 'node-mid', 'USER_LINK'),
      createTestUserInteractionEdge('edge-3', 'int-2', 'node-3', 'node-4', 'MAIN'), // Different interaction
    ];
    const result = getInteractionEdgesOnDiagram('int-1', edges);
    expect(result).toHaveLength(2);
    expect(result.map(e => e.id)).toContain('edge-1');
    expect(result.map(e => e.id)).toContain('edge-2');
  });

  it('should not return edges with different relationship_type', () => {
    const edges: DiagramEdge[] = [
      {
        id: 'edge-dm',
        relationship_type: RELATIONSHIP_EDGE_TYPES.DATA_MOVEMENT,
        relationship_id: 'int-1', // Same ID but different type
        source_node_id: 'node-1',
        target_node_id: 'node-2',
        edge_points: [],
      },
    ];
    const result = getInteractionEdgesOnDiagram('int-1', edges);
    expect(result).toHaveLength(0);
  });
});

// ============================================================================
// Test Suite: Case A Enable/Disable Logic
// ============================================================================

describe('isUserInteractionRowEnabled - Case A', () => {
  // Test Case A enabled: P and S nodes on diagram, no edges exist
  it('should be ENABLED when P and S nodes on diagram and no edges exist', () => {
    // Setup: Application nodes on diagram representing P and S
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

    const diagram = createTestDiagram({
      diagram_nodes: [
        createTestNode(ENTITY_TYPES.APPLICATION, 'app-1'),
        createTestNode(ENTITY_TYPES.APPLICATION, 'app-2'),
      ],
      diagram_edges: [],
    });

    const interaction = createTestInteractionCaseA('int-1', 'user-1', abpP.id, abpS.id);

    const result = isUserInteractionRowEnabled(interaction, diagram, metaModel);
    expect(result).toBe(true);
  });

  // Test Case A disabled: P and S on diagram, MAIN edge exists
  it('should be DISABLED when P and S on diagram but MAIN edge exists', () => {
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

    const diagram = createTestDiagram({
      diagram_nodes: [nodeP, nodeS],
      diagram_edges: [
        createTestUserInteractionEdge('edge-main', 'int-1', nodeP.id, nodeS.id, 'MAIN'),
      ],
    });

    const interaction = createTestInteractionCaseA('int-1', 'user-1', abpP.id, abpS.id);

    const result = isUserInteractionRowEnabled(interaction, diagram, metaModel);
    expect(result).toBe(false);
  });

  // Test Case A disabled: P on diagram but S missing
  it('should be DISABLED when P on diagram but S missing', () => {
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

    const diagram = createTestDiagram({
      diagram_nodes: [
        createTestNode(ENTITY_TYPES.APPLICATION, 'app-1'), // Only P node
        // S node missing
      ],
      diagram_edges: [],
    });

    const interaction = createTestInteractionCaseA('int-1', 'user-1', abpP.id, abpS.id);

    const result = isUserInteractionRowEnabled(interaction, diagram, metaModel);
    expect(result).toBe(false);
  });
});

// ============================================================================
// Test Suite: Case B Enable/Disable Logic
// ============================================================================

describe('isUserInteractionRowEnabled - Case B', () => {
  // Test Case B enabled: P and U nodes on diagram, no edges exist
  it('should be ENABLED when P and U nodes on diagram and no edges exist', () => {
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

    const diagram = createTestDiagram({
      diagram_nodes: [
        createTestNode(ENTITY_TYPES.APPLICATION, 'app-1'),
        createTestNode(ENTITY_TYPES.BUSINESS_USER, 'user-1'),
      ],
      diagram_edges: [],
    });

    const interaction = createTestInteractionCaseB('int-1', 'user-1', abpP.id);

    const result = isUserInteractionRowEnabled(interaction, diagram, metaModel);
    expect(result).toBe(true);
  });

  // Test Case B disabled: P and U on diagram, MAIN edge exists
  it('should be DISABLED when P and U on diagram but MAIN edge exists', () => {
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

    const nodeP = createTestNode(ENTITY_TYPES.APPLICATION, 'app-1');
    const nodeU = createTestNode(ENTITY_TYPES.BUSINESS_USER, 'user-1');

    const diagram = createTestDiagram({
      diagram_nodes: [nodeP, nodeU],
      diagram_edges: [
        createTestUserInteractionEdge('edge-main', 'int-1', nodeU.id, nodeP.id, 'MAIN'),
      ],
    });

    const interaction = createTestInteractionCaseB('int-1', 'user-1', abpP.id);

    const result = isUserInteractionRowEnabled(interaction, diagram, metaModel);
    expect(result).toBe(false);
  });

  // Test Case B disabled: P on diagram but U missing
  it('should be DISABLED when P on diagram but U (User) missing', () => {
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

    const diagram = createTestDiagram({
      diagram_nodes: [
        createTestNode(ENTITY_TYPES.APPLICATION, 'app-1'), // Only P node
        // User node missing
      ],
      diagram_edges: [],
    });

    const interaction = createTestInteractionCaseB('int-1', 'user-1', abpP.id);

    const result = isUserInteractionRowEnabled(interaction, diagram, metaModel);
    expect(result).toBe(false);
  });
});

// ============================================================================
// Test Suite: Temporal Validity
// ============================================================================

describe('isInteractionVisibleAtTime - Temporal Filtering', () => {
  it('should return true when interaction is valid at time T', () => {
    const interaction: Interaction = {
      id: 'int-1',
      name: 'Test',
      user_id: 'user-1',
      primary_app_business_point_id: 'abp-1',
      valid_from: '2024-Q1',
      valid_to: '2024-Q4',
    };

    expect(isInteractionVisibleAtTime(interaction, '2024-Q2')).toBe(true);
    expect(isInteractionVisibleAtTime(interaction, '2024-Q1')).toBe(true);
    expect(isInteractionVisibleAtTime(interaction, '2024-Q4')).toBe(true);
  });

  it('should return false when interaction is invalid at time T', () => {
    const interaction: Interaction = {
      id: 'int-1',
      name: 'Test',
      user_id: 'user-1',
      primary_app_business_point_id: 'abp-1',
      valid_from: '2024-Q1',
      valid_to: '2024-Q4',
    };

    expect(isInteractionVisibleAtTime(interaction, '2023-Q4')).toBe(false);
    expect(isInteractionVisibleAtTime(interaction, '2025-Q1')).toBe(false);
  });

  it('should treat null valid_from as always valid from beginning', () => {
    const interaction: Interaction = {
      id: 'int-1',
      name: 'Test',
      user_id: 'user-1',
      primary_app_business_point_id: 'abp-1',
      valid_from: undefined,
      valid_to: '2024-Q4',
    };

    expect(isInteractionVisibleAtTime(interaction, '2020-Q1')).toBe(true);
    expect(isInteractionVisibleAtTime(interaction, '2024-Q4')).toBe(true);
    expect(isInteractionVisibleAtTime(interaction, '2025-Q1')).toBe(false);
  });

  it('should treat null valid_to as always valid until end', () => {
    const interaction: Interaction = {
      id: 'int-1',
      name: 'Test',
      user_id: 'user-1',
      primary_app_business_point_id: 'abp-1',
      valid_from: '2024-Q1',
      valid_to: undefined,
    };

    expect(isInteractionVisibleAtTime(interaction, '2023-Q4')).toBe(false);
    expect(isInteractionVisibleAtTime(interaction, '2024-Q1')).toBe(true);
    expect(isInteractionVisibleAtTime(interaction, '2030-Q4')).toBe(true);
  });

  it('should treat both null as always valid (timeless)', () => {
    const interaction: Interaction = {
      id: 'int-1',
      name: 'Test',
      user_id: 'user-1',
      primary_app_business_point_id: 'abp-1',
      valid_from: undefined,
      valid_to: undefined,
    };

    expect(isInteractionVisibleAtTime(interaction, '2020-Q1')).toBe(true);
    expect(isInteractionVisibleAtTime(interaction, '2030-Q4')).toBe(true);
  });
});

// ============================================================================
// Test Suite: USER_LINK Edge Presence
// ============================================================================

describe('isUserInteractionRowEnabled - USER_LINK edge presence', () => {
  // Test edge presence check: USER_LINK only also disables row
  it('should be DISABLED when USER_LINK edge exists (even without MAIN)', () => {
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

    const diagram = createTestDiagram({
      diagram_nodes: [nodeP, nodeS, nodeU],
      diagram_edges: [
        // Only USER_LINK edge exists
        createTestUserInteractionEdge('edge-user-link', 'int-1', nodeU.id, 'midpoint', 'USER_LINK'),
      ],
    });

    const interaction = createTestInteractionCaseA('int-1', 'user-1', abpP.id, abpS.id);

    const result = isUserInteractionRowEnabled(interaction, diagram, metaModel);
    expect(result).toBe(false);
  });
});

// ============================================================================
// Test Suite: getAppBusinessPointNodeId Helper
// ============================================================================

describe('getAppBusinessPointNodeId', () => {
  it('should find APPLICATION node for ABP with APPLICATION kind', () => {
    const abp = createTestAppBusinessPoint('app-1', 'APPLICATION');
    const nodes: DiagramNode[] = [
      createTestNode(ENTITY_TYPES.APPLICATION, 'app-1'),
    ];
    const metaModel = createTestMetaModel({
      entities: {
        business_users: [],
        business_processes: [],
        process_activities: [],
        business_points: [],
        applications: [{ id: 'app-1', name: 'App 1', description: '', app_type: '', status: '', tags: '' }],
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
        app_business_points: [abp],
      },
    });

    const result = getAppBusinessPointNodeId(abp.id, nodes, metaModel);
    expect(result).toBe('node-app-1');
  });

  it('should find SERVICE node for ABP with SERVICE kind', () => {
    const abp = createTestAppBusinessPoint('svc-1', 'SERVICE');
    const nodes: DiagramNode[] = [
      createTestNode(ENTITY_TYPES.SERVICE, 'svc-1'),
    ];
    const metaModel = createTestMetaModel({
      entities: {
        business_users: [],
        business_processes: [],
        process_activities: [],
        business_points: [],
        applications: [],
        app_components: [],
        services: [{ id: 'svc-1', name: 'Service 1', description: '', application_id: 'app-1', service_type: '', tags: '' }],
        interfaces: [],
        endpoints: [],
        application_points: [],
        logical_data_entities: [],
        logical_data_attributes: [],
        physical_data_entities: [],
        physical_data_attributes: [],
        interactions: [],
        app_business_points: [abp],
      },
    });

    const result = getAppBusinessPointNodeId(abp.id, nodes, metaModel);
    expect(result).toBe('node-svc-1');
  });

  it('should find BUSINESS_PROCESS node for ABP with BUSINESS_PROCESS kind', () => {
    const abp = createTestAppBusinessPoint('bp-1', 'BUSINESS_PROCESS');
    const nodes: DiagramNode[] = [
      createTestNode(ENTITY_TYPES.BUSINESS_PROCESS, 'bp-1'),
    ];
    const metaModel = createTestMetaModel({
      entities: {
        business_users: [],
        business_processes: [{ id: 'bp-1', name: 'Process 1', description: '', tags: '' }],
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
        app_business_points: [abp],
      },
    });

    const result = getAppBusinessPointNodeId(abp.id, nodes, metaModel);
    expect(result).toBe('node-bp-1');
  });

  it('should return null when ABP not found', () => {
    const nodes: DiagramNode[] = [];
    const metaModel = createTestMetaModel();

    const result = getAppBusinessPointNodeId('non-existent-abp', nodes, metaModel);
    expect(result).toBeNull();
  });

  it('should return null when entity node not on diagram', () => {
    const abp = createTestAppBusinessPoint('app-1', 'APPLICATION');
    const nodes: DiagramNode[] = []; // No nodes on diagram
    const metaModel = createTestMetaModel({
      entities: {
        business_users: [],
        business_processes: [],
        process_activities: [],
        business_points: [],
        applications: [{ id: 'app-1', name: 'App 1', description: '', app_type: '', status: '', tags: '' }],
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
        app_business_points: [abp],
      },
    });

    const result = getAppBusinessPointNodeId(abp.id, nodes, metaModel);
    expect(result).toBeNull();
  });
});
