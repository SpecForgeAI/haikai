/**
 * Relationship Eligibility Per-Diagram Tests
 *
 * Tests for the relationship eligibility bug fix that ensures:
 * 1. Eligibility is computed from the ACTIVE diagram's nodes only
 * 2. Eligibility updates when switching diagrams
 * 3. Eligibility updates when nodes are added/removed
 * 4. Data Movement arrow rendering is preserved
 * 5. Distinct tooltip messages are shown for different disabled states
 */

import { describe, test, expect } from 'vitest';

import {
  MetaModel,
  DiagramNode,
  Diagram,
  ENTITY_TYPES,
  RELATIONSHIP_EDGE_TYPES,
  BusinessUserBusinessPoint,
  ApplicationPointBusinessPoint,
  LogicalDataEntityRelationship,
  LogicalDataEntityPhysicalDataEntity,
  LogicalDataAttributePhysicalDataAttribute,
  DataMovement,
} from '../types/model';

import {
  getEntitiesOnDiagram,
  EntitiesOnDiagram,
  isRelationshipRowEnabled,
  getRelationshipEligibility,
  createRelationshipEdge,
  getContainmentState,
} from '../utils/relationshipUtils';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create a minimal MetaModel for testing
 */
function createTestMetaModel(): MetaModel {
  return {
    entities: {
      business_users: [
        { id: 'bu_1', name: 'User 1', description: '', tags: '' },
        { id: 'bu_2', name: 'User 2', description: '', tags: '' },
      ],
      business_processes: [
        { id: 'bp_1', name: 'Process 1', description: '', tags: '' },
        { id: 'bp_2', name: 'Process 2', description: '', tags: '' },
      ],
      applications: [
        { id: 'app_1', name: 'App 1', description: '', app_type: '', status: '', tags: '' },
        { id: 'app_2', name: 'App 2', description: '', app_type: '', status: '', tags: '' },
      ],
      app_components: [
        { id: 'comp_1', name: 'Component 1', description: '', application_id: 'app_1', tags: '' },
      ],
      services: [
        { id: 'svc_1', name: 'Service 1', description: '', application_id: 'app_1', service_type: '', tags: '' },
      ],
      application_points: [
        { id: 'ap_1', name: 'AP 1', description: '', kind: 'APPLICATION', application_id: 'app_1', point_type: '', tags: '' },
        { id: 'ap_2', name: 'AP 2', description: '', kind: 'APPLICATION', application_id: 'app_2', point_type: '', tags: '' },
        { id: 'ap_comp_1', name: 'AP Comp 1', description: '', kind: 'APP_COMPONENT', application_id: 'app_1', application_component_id: 'comp_1', point_type: '', tags: '' },
        { id: 'ap_svc_1', name: 'AP Svc 1', description: '', kind: 'SERVICE', application_id: 'app_1', service_id: 'svc_1', point_type: '', tags: '' },
      ],
      logical_data_entities: [
        { id: 'lde_1', name: 'Entity 1', description: '', tags: '' },
        { id: 'lde_2', name: 'Entity 2', description: '', tags: '' },
      ],
      logical_data_attributes: [
        { id: 'lda_1', name: 'Attr 1', description: '', logical_entity_id: 'lde_1', data_type: '', is_primary_key: false, is_nullable: true, tags: '' },
      ],
      physical_data_entities: [
        { id: 'pde_1', name: 'Physical 1', description: '', logical_entity_id: 'lde_1', physical_type: '', database: '', tags: '' },
      ],
      physical_data_attributes: [
        { id: 'pda_1', name: 'Physical Attr 1', description: '', physical_entity_id: 'pde_1', data_type: '', is_primary_key: false, is_nullable: true, tags: '' },
      ],
    },
    relationships: {
      // Business Point relationships use deterministic bp_{sourceEntityId} ids
      // matched by getEntitiesOnDiagram's BUSINESS_PROCESS -> businessPoints mapping.
      business_user_business_points: [
        { id: 'bup_1', business_user_id: 'bu_1', business_point_id: 'bp_bp_1', description: '', tags: '' },
        { id: 'bup_2', business_user_id: 'bu_1', business_point_id: 'bp_bp_2', description: '', tags: '' },
      ],
      application_point_business_points: [
        { id: 'apbp_1', application_point_id: 'ap_1', business_point_id: 'bp_bp_1', description: '', tags: '' },
      ],
      logical_data_entity_relationships: [
        // Logical ER rows carry data-entity-point ids (dep_log_/dep_phy_ prefixed)
        { id: 'lder_1', fromDataEntityPointId: 'dep_log_lde_1', toDataEntityPointId: 'dep_log_lde_2', relationship_type: 'ONE_TO_MANY', description: '', tags: '' },
      ],
      logical_data_entity_physical_data_entities: [
        { id: 'ldepe_1', logical_entity_id: 'lde_1', physical_entity_id: 'pde_1', description: '', tags: '' },
      ],
      logical_data_attribute_physical_data_attributes: [
        { id: 'ldapa_1', logical_attribute_id: 'lda_1', physical_attribute_id: 'pda_1', description: '', tags: '' },
      ],
      data_movements: [
        // Data movements reference application POINTS (not application ids)
        { id: 'dm_1', source_application_point_id: 'ap_1', target_application_point_id: 'ap_2', dataEntityPointId: 'dep_log_lde_1', movement_type: '', description: '', tags: '' },
      ],
    },
  };
}

/**
 * Create a diagram node for testing
 */
function createNode(entityType: string, entityId: string, nodeId?: string, parentNodeId?: string | null): DiagramNode {
  return {
    id: nodeId || `node_${entityId}`,
    entity_type: entityType,
    entity_id: entityId,
    pos_x: 100,
    pos_y: 100,
    width: 100,
    height: 60,
    z_index: 1,
    parent_node_id: parentNodeId ?? null,
    style_override: {},
  };
}

/**
 * Create a diagram for testing
 */
function createDiagram(nodes: DiagramNode[], id?: string): Diagram {
  return {
    id: id || 'diagram_1',
    name: 'Test Diagram',
    description: '',
    diagram_nodes: nodes,
    diagram_edges: [],
  };
}

// ============================================================================
// Task Group 1: getEntitiesOnDiagram Helper Tests
// ============================================================================

describe('Task Group 1: getEntitiesOnDiagram Helper', () => {
  test('1.1.1 Empty diagram returns empty Sets for all entity types', () => {
    const metaModel = createTestMetaModel();
    const diagram = createDiagram([]);

    const result = getEntitiesOnDiagram(metaModel, diagram);

    expect(result.applicationPointsOnDiagram.size).toBe(0);
    expect(result.businessUsersOnDiagram.size).toBe(0);
    expect(result.businessProcessesOnDiagram.size).toBe(0);
    expect(result.logicalDataEntitiesOnDiagram.size).toBe(0);
    expect(result.physicalDataEntitiesOnDiagram.size).toBe(0);
    expect(result.logicalDataAttributesOnDiagram.size).toBe(0);
    expect(result.physicalDataAttributesOnDiagram.size).toBe(0);
  });

  test('1.1.2 Diagram with single Business User node populates businessUsersOnDiagram Set correctly', () => {
    const metaModel = createTestMetaModel();
    const nodes = [createNode(ENTITY_TYPES.BUSINESS_USER, 'bu_1')];
    const diagram = createDiagram(nodes);

    const result = getEntitiesOnDiagram(metaModel, diagram);

    expect(result.businessUsersOnDiagram.has('bu_1')).toBe(true);
    expect(result.businessUsersOnDiagram.size).toBe(1);
  });

  test('1.1.3 APPLICATION node correctly maps to applicationPointsOnDiagram via application_id lookup', () => {
    const metaModel = createTestMetaModel();
    const nodes = [createNode(ENTITY_TYPES.APPLICATION, 'app_1')];
    const diagram = createDiagram(nodes);

    const result = getEntitiesOnDiagram(metaModel, diagram);

    // Application 'app_1' should map to application_point 'ap_1' (and others with same application_id)
    expect(result.applicationPointsOnDiagram.has('ap_1')).toBe(true);
    expect(result.applicationPointsOnDiagram.has('ap_comp_1')).toBe(true);
    expect(result.applicationPointsOnDiagram.has('ap_svc_1')).toBe(true);
  });

  test('1.1.4 APP_COMPONENT node correctly maps to applicationPointsOnDiagram via application_component_id', () => {
    const metaModel = createTestMetaModel();
    const nodes = [createNode(ENTITY_TYPES.APP_COMPONENT, 'comp_1')];
    const diagram = createDiagram(nodes);

    const result = getEntitiesOnDiagram(metaModel, diagram);

    // Component 'comp_1' should map to application_point 'ap_comp_1'
    expect(result.applicationPointsOnDiagram.has('ap_comp_1')).toBe(true);
    // Should NOT include ap_1 (which is for the application, not component)
    expect(result.applicationPointsOnDiagram.has('ap_1')).toBe(false);
  });

  test('1.1.5 SERVICE node correctly maps to applicationPointsOnDiagram via service_id', () => {
    const metaModel = createTestMetaModel();
    const nodes = [createNode(ENTITY_TYPES.SERVICE, 'svc_1')];
    const diagram = createDiagram(nodes);

    const result = getEntitiesOnDiagram(metaModel, diagram);

    // Service 'svc_1' should map to application_point 'ap_svc_1'
    expect(result.applicationPointsOnDiagram.has('ap_svc_1')).toBe(true);
  });

  test('1.1.6 Diagram with mixed entity types populates multiple Sets correctly', () => {
    const metaModel = createTestMetaModel();
    const nodes = [
      createNode(ENTITY_TYPES.BUSINESS_USER, 'bu_1'),
      createNode(ENTITY_TYPES.BUSINESS_PROCESS, 'bp_1'),
      createNode(ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'lde_1'),
      createNode(ENTITY_TYPES.PHYSICAL_DATA_ENTITY, 'pde_1'),
    ];
    const diagram = createDiagram(nodes);

    const result = getEntitiesOnDiagram(metaModel, diagram);

    expect(result.businessUsersOnDiagram.has('bu_1')).toBe(true);
    expect(result.businessProcessesOnDiagram.has('bp_1')).toBe(true);
    expect(result.logicalDataEntitiesOnDiagram.has('lde_1')).toBe(true);
    expect(result.physicalDataEntitiesOnDiagram.has('pde_1')).toBe(true);
  });

  test('1.1.7 Undefined diagram returns empty Sets', () => {
    const metaModel = createTestMetaModel();

    const result = getEntitiesOnDiagram(metaModel, undefined);

    expect(result.applicationPointsOnDiagram.size).toBe(0);
    expect(result.businessUsersOnDiagram.size).toBe(0);
  });
});

// ============================================================================
// Task Group 2: Per-Relationship Eligibility Function Tests
// ============================================================================

describe('Task Group 2: Per-Relationship Eligibility Functions', () => {
  test('2.1.1 isUserProcessEnabled: enabled when both user_id AND process_id in respective Sets', () => {
    const metaModel = createTestMetaModel();
    const nodes = [
      createNode(ENTITY_TYPES.BUSINESS_USER, 'bu_1'),
      createNode(ENTITY_TYPES.BUSINESS_PROCESS, 'bp_1'),
    ];
    const relationship = metaModel.relationships.business_user_business_points[0] as BusinessUserBusinessPoint;

    const result = isRelationshipRowEnabled(relationship, 'business_user_business_points', nodes, metaModel);

    expect(result).toBe(true);
  });

  test('2.1.2 isUserProcessEnabled: disabled when user_id missing from Set', () => {
    const metaModel = createTestMetaModel();
    const nodes = [
      createNode(ENTITY_TYPES.BUSINESS_PROCESS, 'bp_1'),
      // No business user node
    ];
    const relationship = metaModel.relationships.business_user_business_points[0] as BusinessUserBusinessPoint;

    const result = isRelationshipRowEnabled(relationship, 'business_user_business_points', nodes, metaModel);

    expect(result).toBe(false);
  });

  // App Point <-> Business Point eligibility follows the same rule as every
  // other relationship now: enabled only when BOTH endpoints are on the
  // diagram (the old containment-aware "enabled when missing" behaviour and
  // the already_visualised gating moved up to the palette's edge-exists check).
  test('2.1.3 isAppPointBusinessPointEnabled: disabled when either endpoint NOT on diagram', () => {
    const metaModel = createTestMetaModel();
    const nodes = [
      createNode(ENTITY_TYPES.APPLICATION_POINT, 'ap_1'),
      // No business point / process node
    ];
    const relationship = metaModel.relationships.application_point_business_points[0] as ApplicationPointBusinessPoint;

    const result = isRelationshipRowEnabled(relationship, 'application_point_business_points', nodes, metaModel);

    expect(result).toBe(false);
  });

  test('2.1.4 isAppPointBusinessPointEnabled: enabled when BOTH endpoints on diagram', () => {
    const metaModel = createTestMetaModel();
    const appPointNode = createNode(ENTITY_TYPES.APPLICATION_POINT, 'ap_1', 'node_ap_1');
    const processNode = createNode(ENTITY_TYPES.BUSINESS_PROCESS, 'bp_1', 'node_bp_1', 'node_ap_1');
    const nodes = [appPointNode, processNode];
    const relationship = metaModel.relationships.application_point_business_points[0] as ApplicationPointBusinessPoint;

    const result = isRelationshipRowEnabled(relationship, 'application_point_business_points', nodes, metaModel);

    expect(result).toBe(true);
  });

  test('2.1.5 isLogicalEREnabled: enabled when both source AND target entity IDs in logicalDataEntitiesOnDiagram', () => {
    const metaModel = createTestMetaModel();
    const nodes = [
      createNode(ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'lde_1'),
      createNode(ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'lde_2'),
    ];
    const relationship = metaModel.relationships.logical_data_entity_relationships[0] as LogicalDataEntityRelationship;

    const result = isRelationshipRowEnabled(relationship, 'logical_data_entity_relationships', nodes, metaModel);

    expect(result).toBe(true);
  });

  test('2.1.6 isDataMovementEnabled: enabled when both source AND target app point IDs in applicationPointsOnDiagram', () => {
    const metaModel = createTestMetaModel();
    // Add APPLICATION nodes which should map to application_points
    const nodes = [
      createNode(ENTITY_TYPES.APPLICATION, 'app_1'),
      createNode(ENTITY_TYPES.APPLICATION, 'app_2'),
    ];
    const relationship = metaModel.relationships.data_movements[0] as DataMovement;

    const result = isRelationshipRowEnabled(relationship, 'data_movements', nodes, metaModel);

    expect(result).toBe(true);
  });

  test('2.1.7 isDataMovementEnabled: disabled when one app point missing from Set', () => {
    const metaModel = createTestMetaModel();
    // Only add one application
    const nodes = [
      createNode(ENTITY_TYPES.APPLICATION, 'app_1'),
    ];
    const relationship = metaModel.relationships.data_movements[0] as DataMovement;

    const result = isRelationshipRowEnabled(relationship, 'data_movements', nodes, metaModel);

    expect(result).toBe(false);
  });

  test('2.1.8 isLogicalPhysicalEntityEnabled: enabled when both IDs in respective Sets', () => {
    const metaModel = createTestMetaModel();
    const nodes = [
      createNode(ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'lde_1'),
      createNode(ENTITY_TYPES.PHYSICAL_DATA_ENTITY, 'pde_1'),
    ];
    const relationship = metaModel.relationships.logical_data_entity_physical_data_entities[0] as LogicalDataEntityPhysicalDataEntity;

    const result = isRelationshipRowEnabled(relationship, 'logical_data_entity_physical_data_entities', nodes, metaModel);

    expect(result).toBe(true);
  });
});

// ============================================================================
// Task Group 3: Palette Integration Tests
// ============================================================================

describe('Task Group 3: Palette Integration', () => {
  test('3.1.1 Eligibility uses active diagram nodes for computation', () => {
    const metaModel = createTestMetaModel();

    // Diagram 1: Has both users and processes
    const diagram1Nodes = [
      createNode(ENTITY_TYPES.BUSINESS_USER, 'bu_1'),
      createNode(ENTITY_TYPES.BUSINESS_PROCESS, 'bp_1'),
    ];
    const diagram1 = createDiagram(diagram1Nodes, 'diagram_1');

    // Diagram 2: Empty
    const diagram2 = createDiagram([], 'diagram_2');

    const relationship = metaModel.relationships.business_user_business_points[0] as BusinessUserBusinessPoint;

    // Check eligibility for diagram 1
    const result1 = isRelationshipRowEnabled(relationship, 'business_user_business_points', diagram1.diagram_nodes, metaModel);
    expect(result1).toBe(true);

    // Check eligibility for diagram 2 - should be different
    const result2 = isRelationshipRowEnabled(relationship, 'business_user_business_points', diagram2.diagram_nodes, metaModel);
    expect(result2).toBe(false);
  });

  test('3.1.2 Empty diagram results in all relationship rows disabled', () => {
    const metaModel = createTestMetaModel();
    const emptyDiagram = createDiagram([]);

    const entities = getEntitiesOnDiagram(metaModel, emptyDiagram);

    // All Sets should be empty
    expect(entities.businessUsersOnDiagram.size).toBe(0);
    expect(entities.businessProcessesOnDiagram.size).toBe(0);
    expect(entities.applicationPointsOnDiagram.size).toBe(0);
    expect(entities.logicalDataEntitiesOnDiagram.size).toBe(0);

    // All relationships should be disabled
    const userProcessRel = metaModel.relationships.business_user_business_points[0];
    const dataMovementRel = metaModel.relationships.data_movements[0];

    expect(isRelationshipRowEnabled(userProcessRel, 'business_user_business_points', [], metaModel)).toBe(false);
    expect(isRelationshipRowEnabled(dataMovementRel, 'data_movements', [], metaModel)).toBe(false);
  });

  test('3.1.3 Switching diagrams updates eligibility correctly', () => {
    const metaModel = createTestMetaModel();
    const relationship = metaModel.relationships.data_movements[0] as DataMovement;

    // Diagram A: Both applications present
    const diagramANodes = [
      createNode(ENTITY_TYPES.APPLICATION, 'app_1'),
      createNode(ENTITY_TYPES.APPLICATION, 'app_2'),
    ];

    // Diagram B: Only one application
    const diagramBNodes = [
      createNode(ENTITY_TYPES.APPLICATION, 'app_1'),
    ];

    // In Diagram A: Data Movement should be enabled
    expect(isRelationshipRowEnabled(relationship, 'data_movements', diagramANodes, metaModel)).toBe(true);

    // Switch to Diagram B: Same Data Movement should be disabled
    expect(isRelationshipRowEnabled(relationship, 'data_movements', diagramBNodes, metaModel)).toBe(false);

    // Switch back to Diagram A: Should be enabled again
    expect(isRelationshipRowEnabled(relationship, 'data_movements', diagramANodes, metaModel)).toBe(true);
  });

  test('3.1.4 Pre-computed EntitiesOnDiagram is used for O(1) lookups', () => {
    const metaModel = createTestMetaModel();
    const nodes = [
      createNode(ENTITY_TYPES.BUSINESS_USER, 'bu_1'),
      createNode(ENTITY_TYPES.BUSINESS_PROCESS, 'bp_1'),
    ];
    const diagram = createDiagram(nodes);

    // Pre-compute EntitiesOnDiagram
    const entitiesOnDiagram = getEntitiesOnDiagram(metaModel, diagram);

    const relationship = metaModel.relationships.business_user_business_points[0] as BusinessUserBusinessPoint;

    // Pass pre-computed entities
    const result = isRelationshipRowEnabled(relationship, 'business_user_business_points', nodes, metaModel, entitiesOnDiagram);

    expect(result).toBe(true);
  });
});

// ============================================================================
// Task Group 4: Tooltip Message Tests
// ============================================================================

describe('Task Group 4: Tooltip Messages', () => {
  test('4.1.1 Disabled relationship shows endpoints_missing reason', () => {
    const metaModel = createTestMetaModel();
    const nodes: DiagramNode[] = []; // Empty diagram
    const relationship = metaModel.relationships.business_user_business_points[0] as BusinessUserBusinessPoint;

    const result = getRelationshipEligibility(relationship, 'business_user_business_points', nodes, metaModel);

    expect(result.enabled).toBe(false);
    expect(result.disabledReason).toBe('endpoints_missing');
  });

  test('4.1.2 App Point <-> Business Point when both on diagram is enabled with null reason', () => {
    // The already_visualised reason is now produced by the palette's
    // edge-exists check (PaletteSection), not by getRelationshipEligibility.
    const metaModel = createTestMetaModel();
    const appPointNode = createNode(ENTITY_TYPES.APPLICATION_POINT, 'ap_1', 'node_ap_1');
    const processNode = createNode(ENTITY_TYPES.BUSINESS_PROCESS, 'bp_1', 'node_bp_1', 'node_ap_1'); // Child of app point
    const nodes = [appPointNode, processNode];
    const relationship = metaModel.relationships.application_point_business_points[0] as ApplicationPointBusinessPoint;

    const result = getRelationshipEligibility(relationship, 'application_point_business_points', nodes, metaModel);

    expect(result.enabled).toBe(true);
    expect(result.disabledReason).toBe(null);
  });

  test('4.1.3 Enabled relationship shows null disabledReason', () => {
    const metaModel = createTestMetaModel();
    const nodes = [
      createNode(ENTITY_TYPES.BUSINESS_USER, 'bu_1'),
      createNode(ENTITY_TYPES.BUSINESS_PROCESS, 'bp_1'),
    ];
    const relationship = metaModel.relationships.business_user_business_points[0] as BusinessUserBusinessPoint;

    const result = getRelationshipEligibility(relationship, 'business_user_business_points', nodes, metaModel);

    expect(result.enabled).toBe(true);
    expect(result.disabledReason).toBe(null);
  });
});

// ============================================================================
// Task Group 5: Data Movement Arrow Regression Tests
// ============================================================================

describe('Task Group 5: Data Movement Arrow Regression', () => {
  test('5.1.1 createRelationshipEdge for DATA_MOVEMENT sets line_type to SOLID', () => {
    const metaModel = createTestMetaModel();
    const relationship = metaModel.relationships.data_movements[0] as DataMovement;
    const sourceNode = createNode(ENTITY_TYPES.APPLICATION_POINT, 'ap_1');
    const targetNode = createNode(ENTITY_TYPES.APPLICATION_POINT, 'ap_2');

    const edge = createRelationshipEdge(
      relationship,
      RELATIONSHIP_EDGE_TYPES.DATA_MOVEMENT,
      sourceNode,
      targetNode,
      { labelText: 'Entity 1' }
    );

    expect(edge.line_type).toBe('SOLID');
  });

  test('5.1.2 createRelationshipEdge for DATA_MOVEMENT sets arrow_end to ARROW', () => {
    const metaModel = createTestMetaModel();
    const relationship = metaModel.relationships.data_movements[0] as DataMovement;
    const sourceNode = createNode(ENTITY_TYPES.APPLICATION_POINT, 'ap_1');
    const targetNode = createNode(ENTITY_TYPES.APPLICATION_POINT, 'ap_2');

    const edge = createRelationshipEdge(
      relationship,
      RELATIONSHIP_EDGE_TYPES.DATA_MOVEMENT,
      sourceNode,
      targetNode,
      { labelText: 'Entity 1' }
    );

    expect(edge.arrow_end).toBe('ARROW');
  });

  test('5.1.3 createRelationshipEdge for DATA_MOVEMENT sets label_text from options', () => {
    const metaModel = createTestMetaModel();
    const relationship = metaModel.relationships.data_movements[0] as DataMovement;
    const sourceNode = createNode(ENTITY_TYPES.APPLICATION_POINT, 'ap_1');
    const targetNode = createNode(ENTITY_TYPES.APPLICATION_POINT, 'ap_2');

    const edge = createRelationshipEdge(
      relationship,
      RELATIONSHIP_EDGE_TYPES.DATA_MOVEMENT,
      sourceNode,
      targetNode,
      { labelText: 'Customer Data' }
    );

    expect(edge.label_text).toBe('Customer Data');
  });
});

// ============================================================================
// Task Group 6: Integration Tests
// ============================================================================

describe('Task Group 6: Integration Tests', () => {
  test('6.3.1 Start with empty diagram, all relationship rows disabled', () => {
    const metaModel = createTestMetaModel();
    const emptyNodes: DiagramNode[] = [];

    // Check all relationship types are disabled
    const userProcess = metaModel.relationships.business_user_business_points[0];
    const logicalER = metaModel.relationships.logical_data_entity_relationships[0];
    const dataMovement = metaModel.relationships.data_movements[0];
    const logicalPhysicalEntity = metaModel.relationships.logical_data_entity_physical_data_entities[0];

    expect(isRelationshipRowEnabled(userProcess, 'business_user_business_points', emptyNodes, metaModel)).toBe(false);
    expect(isRelationshipRowEnabled(logicalER, 'logical_data_entity_relationships', emptyNodes, metaModel)).toBe(false);
    expect(isRelationshipRowEnabled(dataMovement, 'data_movements', emptyNodes, metaModel)).toBe(false);
    expect(isRelationshipRowEnabled(logicalPhysicalEntity, 'logical_data_entity_physical_data_entities', emptyNodes, metaModel)).toBe(false);
  });

  test('6.3.2 Add both endpoints for a Data Movement, row becomes enabled', () => {
    const metaModel = createTestMetaModel();
    const relationship = metaModel.relationships.data_movements[0] as DataMovement;

    // Initially no nodes - disabled
    let nodes: DiagramNode[] = [];
    expect(isRelationshipRowEnabled(relationship, 'data_movements', nodes, metaModel)).toBe(false);

    // Add source application
    nodes = [createNode(ENTITY_TYPES.APPLICATION, 'app_1')];
    expect(isRelationshipRowEnabled(relationship, 'data_movements', nodes, metaModel)).toBe(false);

    // Add target application - now enabled
    nodes = [
      createNode(ENTITY_TYPES.APPLICATION, 'app_1'),
      createNode(ENTITY_TYPES.APPLICATION, 'app_2'),
    ];
    expect(isRelationshipRowEnabled(relationship, 'data_movements', nodes, metaModel)).toBe(true);
  });

  test('6.3.3 Switch to new empty Diagram 2, same Data Movement row is disabled', () => {
    const metaModel = createTestMetaModel();
    const relationship = metaModel.relationships.data_movements[0] as DataMovement;

    // Diagram 1 with both apps
    const diagram1Nodes = [
      createNode(ENTITY_TYPES.APPLICATION, 'app_1'),
      createNode(ENTITY_TYPES.APPLICATION, 'app_2'),
    ];

    // Diagram 2 is empty
    const diagram2Nodes: DiagramNode[] = [];

    // Enabled in Diagram 1
    expect(isRelationshipRowEnabled(relationship, 'data_movements', diagram1Nodes, metaModel)).toBe(true);

    // Disabled in Diagram 2
    expect(isRelationshipRowEnabled(relationship, 'data_movements', diagram2Nodes, metaModel)).toBe(false);
  });

  test('6.3.4 Add nodes to Diagram 2, row becomes enabled for Diagram 2', () => {
    const metaModel = createTestMetaModel();
    const relationship = metaModel.relationships.data_movements[0] as DataMovement;

    // Initially empty
    let diagram2Nodes: DiagramNode[] = [];
    expect(isRelationshipRowEnabled(relationship, 'data_movements', diagram2Nodes, metaModel)).toBe(false);

    // Add both apps
    diagram2Nodes = [
      createNode(ENTITY_TYPES.APPLICATION, 'app_1'),
      createNode(ENTITY_TYPES.APPLICATION, 'app_2'),
    ];
    expect(isRelationshipRowEnabled(relationship, 'data_movements', diagram2Nodes, metaModel)).toBe(true);
  });

  test('6.3.5 Switch back to Diagram 1, eligibility reflects Diagram 1 nodes', () => {
    const metaModel = createTestMetaModel();
    const relationship = metaModel.relationships.data_movements[0] as DataMovement;

    // Diagram 1 with both apps
    const diagram1Nodes = [
      createNode(ENTITY_TYPES.APPLICATION, 'app_1'),
      createNode(ENTITY_TYPES.APPLICATION, 'app_2'),
    ];

    // Diagram 2 with only one app
    const diagram2Nodes = [
      createNode(ENTITY_TYPES.APPLICATION, 'app_1'),
    ];

    // In Diagram 1: enabled
    expect(isRelationshipRowEnabled(relationship, 'data_movements', diagram1Nodes, metaModel)).toBe(true);

    // In Diagram 2: disabled
    expect(isRelationshipRowEnabled(relationship, 'data_movements', diagram2Nodes, metaModel)).toBe(false);

    // Back to Diagram 1: still enabled
    expect(isRelationshipRowEnabled(relationship, 'data_movements', diagram1Nodes, metaModel)).toBe(true);
  });

  test('6.3.6 App Point <-> Business Point row enables only when both endpoints are on diagram', () => {
    const metaModel = createTestMetaModel();
    const relationship = metaModel.relationships.application_point_business_points[0] as ApplicationPointBusinessPoint;

    // Initially neither on diagram - disabled (endpoints missing)
    let nodes: DiagramNode[] = [];
    expect(isRelationshipRowEnabled(relationship, 'application_point_business_points', nodes, metaModel)).toBe(false);

    // Add app point only - still disabled
    const appPointNode = createNode(ENTITY_TYPES.APPLICATION_POINT, 'ap_1', 'node_ap_1');
    nodes = [appPointNode];
    expect(isRelationshipRowEnabled(relationship, 'application_point_business_points', nodes, metaModel)).toBe(false);

    // Add process (maps to its business point) - now enabled
    const processNode = createNode(ENTITY_TYPES.BUSINESS_PROCESS, 'bp_1', 'node_bp_1', 'node_ap_1');
    nodes = [appPointNode, processNode];
    expect(isRelationshipRowEnabled(relationship, 'application_point_business_points', nodes, metaModel)).toBe(true);
  });

  test('6.3.7 Delete one endpoint node, relationship row becomes disabled', () => {
    const metaModel = createTestMetaModel();
    const relationship = metaModel.relationships.business_user_business_points[0] as BusinessUserBusinessPoint;

    // Both endpoints present - enabled
    let nodes = [
      createNode(ENTITY_TYPES.BUSINESS_USER, 'bu_1'),
      createNode(ENTITY_TYPES.BUSINESS_PROCESS, 'bp_1'),
    ];
    expect(isRelationshipRowEnabled(relationship, 'business_user_business_points', nodes, metaModel)).toBe(true);

    // Remove user node - disabled
    nodes = [
      createNode(ENTITY_TYPES.BUSINESS_PROCESS, 'bp_1'),
    ];
    expect(isRelationshipRowEnabled(relationship, 'business_user_business_points', nodes, metaModel)).toBe(false);
  });

  test('6.3.8 getContainmentState returns BOTH when process is child of app point', () => {
    const appPointNode = createNode(ENTITY_TYPES.APPLICATION_POINT, 'ap_1', 'node_ap_1');
    const processNode = createNode(ENTITY_TYPES.BUSINESS_PROCESS, 'bp_1', 'node_bp_1', 'node_ap_1');
    const nodes = [appPointNode, processNode];

    const state = getContainmentState(nodes, 'ap_1', 'bp_1');

    expect(state).toBe('BOTH');
  });
});
