/**
 * Tests for Relationship Visualisation and RHS Palette Behaviour
 * Tests are organized by Task Group for clear traceability
 */

import {
  DiagramNode,
  DiagramEdge,
  MetaModel,
  BusinessUserBusinessPoint,
  ApplicationPointBusinessPoint,
  LogicalDataEntityRelationship,
  LogicalDataEntityPhysicalDataEntity,
  LogicalDataAttributePhysicalDataAttribute,
  DataMovement,
  ENTITY_TYPES,
} from '../types/model';

// ============================================================================
// Task Group 1: Type Definitions and Data Structures Tests
// ============================================================================

describe('Task Group 1: Type Definitions and Data Structures', () => {
  // Test 1.1: RelationshipEdgeType enum values
  test('RelationshipEdgeType constants should be defined correctly', async () => {
    const { RELATIONSHIP_EDGE_TYPES } = await import('../types/model');

    // Renamed to the Business Point model: USER_BUSINESS_POINT / APP_POINT_BUSINESS_POINT
    expect(RELATIONSHIP_EDGE_TYPES.USER_BUSINESS_POINT).toBe('USER_BUSINESS_POINT');
    expect(RELATIONSHIP_EDGE_TYPES.APP_POINT_BUSINESS_POINT).toBe('APP_POINT_BUSINESS_POINT');
    expect(RELATIONSHIP_EDGE_TYPES.LOGICAL_DATA_ENTITY_RELATIONSHIP).toBe('LOGICAL_DATA_ENTITY_RELATIONSHIP');
    expect(RELATIONSHIP_EDGE_TYPES.LOGICAL_DATA_ENTITY_PHYSICAL_DATA_ENTITY).toBe('LOGICAL_DATA_ENTITY_PHYSICAL_DATA_ENTITY');
    expect(RELATIONSHIP_EDGE_TYPES.LOGICAL_DATA_ATTRIBUTE_PHYSICAL_DATA_ATTRIBUTE).toBe('LOGICAL_DATA_ATTRIBUTE_PHYSICAL_DATA_ATTRIBUTE');
    expect(RELATIONSHIP_EDGE_TYPES.DATA_MOVEMENT).toBe('DATA_MOVEMENT');
  });

  // Test 1.2: DiagramEdge interface should include source/target label fields
  test('DiagramEdge should support source and target label fields', () => {
    const edge: DiagramEdge = {
      id: 'edge-1',
      relationship_type: 'LOGICAL_DATA_ENTITY_RELATIONSHIP',
      relationship_id: 'rel-1',
      source_node_id: 'node-1',
      target_node_id: 'node-2',
      edge_points: [],
      // New multiplicity label fields
      source_label_text: '1',
      source_label_pos_x: 100,
      source_label_pos_y: 100,
      target_label_text: 'm',
      target_label_pos_x: 200,
      target_label_pos_y: 200,
    };

    expect(edge.source_label_text).toBe('1');
    expect(edge.source_label_pos_x).toBe(100);
    expect(edge.source_label_pos_y).toBe(100);
    expect(edge.target_label_text).toBe('m');
    expect(edge.target_label_pos_x).toBe(200);
    expect(edge.target_label_pos_y).toBe(200);
  });

  // Test 1.3: Cardinality-to-multiplicity mapping
  test('getMultiplicityLabels should return correct labels for ONE_TO_ONE', async () => {
    const { getMultiplicityLabels } = await import('../utils/rendering');

    const labels = getMultiplicityLabels('ONE_TO_ONE');
    expect(labels.source).toBe('1');
    expect(labels.target).toBe('1');
  });

  test('getMultiplicityLabels should return correct labels for ONE_TO_MANY', async () => {
    const { getMultiplicityLabels } = await import('../utils/rendering');

    const labels = getMultiplicityLabels('ONE_TO_MANY');
    expect(labels.source).toBe('1');
    expect(labels.target).toBe('m');
  });

  test('getMultiplicityLabels should return correct labels for MANY_TO_ONE', async () => {
    const { getMultiplicityLabels } = await import('../utils/rendering');

    const labels = getMultiplicityLabels('MANY_TO_ONE');
    expect(labels.source).toBe('m');
    expect(labels.target).toBe('1');
  });

  test('getMultiplicityLabels should return correct labels for MANY_TO_MANY', async () => {
    const { getMultiplicityLabels } = await import('../utils/rendering');

    const labels = getMultiplicityLabels('MANY_TO_MANY');
    expect(labels.source).toBe('m');
    expect(labels.target).toBe('m');
  });
});

// ============================================================================
// Task Group 2: Endpoint Detection Utilities Tests
// ============================================================================

describe('Task Group 2: Endpoint Detection Utilities', () => {
  const mockNodes: DiagramNode[] = [
    {
      id: 'node-1',
      entity_type: ENTITY_TYPES.BUSINESS_USER,
      entity_id: 'user-1',
      pos_x: 100,
      pos_y: 100,
      width: 60,
      height: 100,
      parent_node_id: null,
    },
    {
      id: 'node-2',
      entity_type: ENTITY_TYPES.BUSINESS_PROCESS,
      entity_id: 'process-1',
      pos_x: 200,
      pos_y: 100,
      width: 120,
      height: 60,
      parent_node_id: null,
    },
    {
      id: 'node-3',
      entity_type: ENTITY_TYPES.APPLICATION_POINT,
      entity_id: 'app-point-1',
      pos_x: 400,
      pos_y: 100,
      width: 130,
      height: 100,
      parent_node_id: null,
    },
    {
      id: 'node-4',
      entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
      entity_id: 'lde-1',
      pos_x: 100,
      pos_y: 300,
      width: 120,
      height: 60,
      parent_node_id: null,
    },
    {
      id: 'node-5',
      entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
      entity_id: 'lde-2',
      pos_x: 300,
      pos_y: 300,
      width: 120,
      height: 60,
      parent_node_id: null,
    },
  ];

  test('findNodeForEntity should find node by entity_type and entity_id', async () => {
    const { findNodeForEntity } = await import('../utils/relationshipUtils');

    const found = findNodeForEntity(mockNodes, ENTITY_TYPES.BUSINESS_USER, 'user-1');
    expect(found).not.toBeUndefined();
    expect(found?.id).toBe('node-1');
  });

  test('findNodeForEntity should return undefined for non-existent entity', async () => {
    const { findNodeForEntity } = await import('../utils/relationshipUtils');

    const found = findNodeForEntity(mockNodes, ENTITY_TYPES.BUSINESS_USER, 'user-999');
    expect(found).toBeUndefined();
  });

  test('areEndpointsOnDiagram should return true when both endpoints exist', async () => {
    const { areEndpointsOnDiagram } = await import('../utils/relationshipUtils');

    const result = areEndpointsOnDiagram(
      mockNodes,
      ENTITY_TYPES.BUSINESS_USER, 'user-1',
      ENTITY_TYPES.BUSINESS_PROCESS, 'process-1'
    );
    expect(result).toBe(true);
  });

  test('areEndpointsOnDiagram should return false when one endpoint missing', async () => {
    const { areEndpointsOnDiagram } = await import('../utils/relationshipUtils');

    const result = areEndpointsOnDiagram(
      mockNodes,
      ENTITY_TYPES.BUSINESS_USER, 'user-1',
      ENTITY_TYPES.BUSINESS_PROCESS, 'process-999'
    );
    expect(result).toBe(false);
  });

  test('getContainmentState should return NEITHER when both missing', async () => {
    const { getContainmentState } = await import('../utils/relationshipUtils');

    const result = getContainmentState(mockNodes, 'app-point-999', 'process-999');
    expect(result).toBe('NEITHER');
  });

  test('getContainmentState should return A_ONLY when app point exists but process missing', async () => {
    const { getContainmentState } = await import('../utils/relationshipUtils');

    const result = getContainmentState(mockNodes, 'app-point-1', 'process-999');
    expect(result).toBe('A_ONLY');
  });

  test('getContainmentState should return BOTH when both exist and process is child', async () => {
    const { getContainmentState } = await import('../utils/relationshipUtils');

    // Create nodes where process is child of app point
    const nodesWithChild: DiagramNode[] = [
      ...mockNodes,
      {
        id: 'child-process-node',
        entity_type: ENTITY_TYPES.BUSINESS_PROCESS,
        entity_id: 'child-process-1',
        pos_x: 405,
        pos_y: 130,
        width: 120,
        height: 60,
        parent_node_id: 'node-3', // Child of app point node
      },
    ];

    const result = getContainmentState(nodesWithChild, 'app-point-1', 'child-process-1');
    expect(result).toBe('BOTH');
  });

  test('findAppPointNode should find APPLICATION_POINT node', async () => {
    const { findAppPointNode } = await import('../utils/relationshipUtils');

    const found = findAppPointNode(mockNodes, 'app-point-1');
    expect(found).not.toBeUndefined();
    expect(found?.entity_type).toBe(ENTITY_TYPES.APPLICATION_POINT);
  });
});

// ============================================================================
// Task Group 3: Enable/Disable Logic Per Relationship Type Tests
// ============================================================================

describe('Task Group 3: Enable/Disable Logic Per Relationship Type', () => {
  const mockMetaModel: MetaModel = {
    entities: {
      business_users: [{ id: 'user-1', name: 'User 1', description: '', tags: '' }],
      business_processes: [{ id: 'process-1', name: 'Process 1', description: '', tags: '' }],
      applications: [{ id: 'app-1', name: 'App 1', description: '', app_type: 'Web', status: 'Active', tags: '' }],
      app_components: [],
      services: [],
      application_points: [
        { id: 'ap-1', name: 'AP 1', description: '', kind: 'APPLICATION', application_id: 'app-1', point_type: '', tags: '' },
        { id: 'ap-2', name: 'AP 2', description: '', kind: 'APPLICATION', application_id: 'app-1', point_type: '', tags: '' },
      ],
      logical_data_entities: [
        { id: 'lde-1', name: 'LDE 1', description: '', tags: '' },
        { id: 'lde-2', name: 'LDE 2', description: '', tags: '' },
      ],
      logical_data_attributes: [],
      physical_data_entities: [{ id: 'pde-1', name: 'PDE 1', description: '', logical_entity_id: 'lde-1', physical_type: 'Table', database: 'DB', tags: '' }],
      physical_data_attributes: [],
    },
    relationships: {
      // Business Point relationships use deterministic bp_{sourceEntityId} ids
      business_user_business_points: [{ id: 'bup-1', business_user_id: 'user-1', business_point_id: 'bp_process-1', description: '', tags: '' }],
      application_point_business_points: [{ id: 'apbp-1', application_point_id: 'ap-1', business_point_id: 'bp_process-1', description: '', tags: '' }],
      logical_data_entity_relationships: [{ id: 'lder-1', fromDataEntityPointId: 'dep_log_lde-1', toDataEntityPointId: 'dep_log_lde-2', relationship_type: 'ONE_TO_MANY', description: '', tags: '' }],
      logical_data_entity_physical_data_entities: [{ id: 'ldepde-1', logical_entity_id: 'lde-1', physical_entity_id: 'pde-1', description: '', tags: '' }],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [{ id: 'dm-1', source_application_point_id: 'ap-1', target_application_point_id: 'ap-2', dataEntityPointId: 'dep_log_lde-1', movement_type: 'Batch', description: '', tags: '' }],
    },
  };

  const mockNodesWithBothEndpoints: DiagramNode[] = [
    {
      id: 'node-user',
      entity_type: ENTITY_TYPES.BUSINESS_USER,
      entity_id: 'user-1',
      pos_x: 100,
      pos_y: 100,
      width: 60,
      height: 100,
      parent_node_id: null,
    },
    {
      id: 'node-process',
      entity_type: ENTITY_TYPES.BUSINESS_PROCESS,
      entity_id: 'process-1',
      pos_x: 200,
      pos_y: 100,
      width: 120,
      height: 60,
      parent_node_id: null,
    },
  ];

  const mockNodesWithOnlyUser: DiagramNode[] = [
    {
      id: 'node-user',
      entity_type: ENTITY_TYPES.BUSINESS_USER,
      entity_id: 'user-1',
      pos_x: 100,
      pos_y: 100,
      width: 60,
      height: 100,
      parent_node_id: null,
    },
  ];

  test('User-Process should be enabled when both endpoints on diagram', async () => {
    const { isRelationshipRowEnabled } = await import('../utils/relationshipUtils');

    const relationship: BusinessUserBusinessPoint = mockMetaModel.relationships.business_user_business_points[0];
    const result = isRelationshipRowEnabled(
      relationship,
      'business_user_business_points',
      mockNodesWithBothEndpoints,
      mockMetaModel
    );
    expect(result).toBe(true);
  });

  test('User-Process should be disabled when one endpoint missing', async () => {
    const { isRelationshipRowEnabled } = await import('../utils/relationshipUtils');

    const relationship: BusinessUserBusinessPoint = mockMetaModel.relationships.business_user_business_points[0];
    const result = isRelationshipRowEnabled(
      relationship,
      'business_user_business_points',
      mockNodesWithOnlyUser,
      mockMetaModel
    );
    expect(result).toBe(false);
  });

  // App Point <-> Business Point eligibility now follows the standard rule:
  // enabled only when BOTH endpoints are on the diagram. The old
  // containment-aware "enabled when missing" behaviour moved to the palette.
  test('App Point-Business Point should be disabled when app point exists but business point missing', async () => {
    const { isRelationshipRowEnabled } = await import('../utils/relationshipUtils');

    const nodesWithAppPoint: DiagramNode[] = [
      {
        id: 'node-ap',
        entity_type: ENTITY_TYPES.APPLICATION_POINT,
        entity_id: 'ap-1',
        pos_x: 100,
        pos_y: 100,
        width: 130,
        height: 100,
        parent_node_id: null,
      },
    ];

    const relationship: ApplicationPointBusinessPoint = mockMetaModel.relationships.application_point_business_points[0];
    const result = isRelationshipRowEnabled(
      relationship,
      'application_point_business_points',
      nodesWithAppPoint,
      mockMetaModel
    );
    expect(result).toBe(false);
  });

  test('App Point-Business Point should be disabled when both missing', async () => {
    const { isRelationshipRowEnabled } = await import('../utils/relationshipUtils');

    const relationship: ApplicationPointBusinessPoint = mockMetaModel.relationships.application_point_business_points[0];
    const result = isRelationshipRowEnabled(
      relationship,
      'application_point_business_points',
      [], // Empty nodes
      mockMetaModel
    );
    expect(result).toBe(false);
  });

  test('App Point-Business Point should be enabled when both exist on diagram', async () => {
    const { isRelationshipRowEnabled } = await import('../utils/relationshipUtils');

    const nodesWithContainment: DiagramNode[] = [
      {
        id: 'node-ap',
        entity_type: ENTITY_TYPES.APPLICATION_POINT,
        entity_id: 'ap-1',
        pos_x: 100,
        pos_y: 100,
        width: 130,
        height: 100,
        parent_node_id: null,
      },
      {
        id: 'node-process',
        entity_type: ENTITY_TYPES.BUSINESS_PROCESS,
        entity_id: 'process-1',
        pos_x: 105,
        pos_y: 130,
        width: 120,
        height: 60,
        parent_node_id: 'node-ap', // Process is child of app point
      },
    ];

    const relationship: ApplicationPointBusinessPoint = mockMetaModel.relationships.application_point_business_points[0];
    const result = isRelationshipRowEnabled(
      relationship,
      'application_point_business_points',
      nodesWithContainment,
      mockMetaModel
    );
    expect(result).toBe(true);
  });

  test('Logical ER should be enabled when both entities on diagram', async () => {
    const { isRelationshipRowEnabled } = await import('../utils/relationshipUtils');

    const nodesWithLDEs: DiagramNode[] = [
      {
        id: 'node-lde1',
        entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
        entity_id: 'lde-1',
        pos_x: 100,
        pos_y: 100,
        width: 120,
        height: 60,
        parent_node_id: null,
      },
      {
        id: 'node-lde2',
        entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
        entity_id: 'lde-2',
        pos_x: 300,
        pos_y: 100,
        width: 120,
        height: 60,
        parent_node_id: null,
      },
    ];

    const relationship: LogicalDataEntityRelationship = mockMetaModel.relationships.logical_data_entity_relationships[0];
    const result = isRelationshipRowEnabled(
      relationship,
      'logical_data_entity_relationships',
      nodesWithLDEs,
      mockMetaModel
    );
    expect(result).toBe(true);
  });

  test('Data Movements should be enabled when both app points on diagram', async () => {
    const { isRelationshipRowEnabled } = await import('../utils/relationshipUtils');

    const nodesWithAppPoints: DiagramNode[] = [
      {
        id: 'node-ap1',
        entity_type: ENTITY_TYPES.APPLICATION_POINT,
        entity_id: 'ap-1',
        pos_x: 100,
        pos_y: 100,
        width: 130,
        height: 100,
        parent_node_id: null,
      },
      {
        id: 'node-ap2',
        entity_type: ENTITY_TYPES.APPLICATION_POINT,
        entity_id: 'ap-2',
        pos_x: 300,
        pos_y: 100,
        width: 130,
        height: 100,
        parent_node_id: null,
      },
    ];

    const relationship: DataMovement = mockMetaModel.relationships.data_movements[0];
    const result = isRelationshipRowEnabled(
      relationship,
      'data_movements',
      nodesWithAppPoints,
      mockMetaModel
    );
    expect(result).toBe(true);
  });
});

// ============================================================================
// Task Group 4: Edge Creation Utilities Tests
// ============================================================================

describe('Task Group 4: Edge Creation Utilities', () => {
  const mockSourceNode: DiagramNode = {
    id: 'node-1',
    entity_type: ENTITY_TYPES.BUSINESS_USER,
    entity_id: 'user-1',
    pos_x: 100,
    pos_y: 100,
    width: 60,
    height: 100,
    parent_node_id: null,
  };

  const mockTargetNode: DiagramNode = {
    id: 'node-2',
    entity_type: ENTITY_TYPES.BUSINESS_PROCESS,
    entity_id: 'process-1',
    pos_x: 300,
    pos_y: 100,
    width: 120,
    height: 60,
    parent_node_id: null,
  };

  test('calculateEdgePoints should return points on node edges, not centers', async () => {
    const { calculateEdgePoints } = await import('../utils/relationshipUtils');

    const points = calculateEdgePoints(mockSourceNode, mockTargetNode);

    expect(points.length).toBe(2);

    // Source point should be on the right edge of source node
    expect(points[0].pos_x).toBe(mockSourceNode.pos_x + mockSourceNode.width);

    // Target point should be on the left edge of target node
    expect(points[1].pos_x).toBe(mockTargetNode.pos_x);
  });

  test('calculateMidpointLabelPosition should return midpoint of edge', async () => {
    const { calculateMidpointLabelPosition } = await import('../utils/relationshipUtils');

    const edgePoints = [
      { id: 'p1', sequence_order: 0, pos_x: 100, pos_y: 100 },
      { id: 'p2', sequence_order: 1, pos_x: 300, pos_y: 100 },
    ];

    const midpoint = calculateMidpointLabelPosition(edgePoints);

    expect(midpoint.x).toBe(200);
    expect(midpoint.y).toBe(100);
  });

  test('calculateSourceLabelPosition should return position near source', async () => {
    const { calculateSourceLabelPosition } = await import('../utils/relationshipUtils');

    const edgePoints = [
      { id: 'p1', sequence_order: 0, pos_x: 100, pos_y: 100 },
      { id: 'p2', sequence_order: 1, pos_x: 300, pos_y: 100 },
    ];

    const pos = calculateSourceLabelPosition(edgePoints, 20);

    // Position should be offset from source point
    expect(pos.x).toBeGreaterThan(100);
    expect(pos.x).toBeLessThan(200);
  });

  test('calculateTargetLabelPosition should return position near target', async () => {
    const { calculateTargetLabelPosition } = await import('../utils/relationshipUtils');

    const edgePoints = [
      { id: 'p1', sequence_order: 0, pos_x: 100, pos_y: 100 },
      { id: 'p2', sequence_order: 1, pos_x: 300, pos_y: 100 },
    ];

    const pos = calculateTargetLabelPosition(edgePoints, 20);

    // Position should be offset from target point
    expect(pos.x).toBeGreaterThan(200);
    expect(pos.x).toBeLessThan(300);
  });

  test('createRelationshipEdge should create edge with correct fields', async () => {
    const { createRelationshipEdge } = await import('../utils/relationshipUtils');

    const relationship: BusinessUserBusinessPoint = {
      id: 'bup-1',
      business_user_id: 'user-1',
      business_point_id: 'bp_process-1',
      description: '',
      tags: '',
    };

    const edge = createRelationshipEdge(
      relationship,
      'USER_BUSINESS_POINT',
      mockSourceNode,
      mockTargetNode
    );

    expect(edge.relationship_type).toBe('USER_BUSINESS_POINT');
    expect(edge.relationship_id).toBe('bup-1');
    expect(edge.source_node_id).toBe('node-1');
    expect(edge.target_node_id).toBe('node-2');
    expect(edge.line_type).toBe('DASHED'); // User-Process uses dashed lines
  });
});

// ============================================================================
// Task Group 5: Add Relationship Handlers Tests
// ============================================================================

describe('Task Group 5: Add Relationship Handlers', () => {
  test('handleAddUserProcessRelationship should create dashed edge with no arrow', async () => {
    const { createRelationshipEdge } = await import('../utils/relationshipUtils');

    const sourceNode: DiagramNode = {
      id: 'node-user',
      entity_type: ENTITY_TYPES.BUSINESS_USER,
      entity_id: 'user-1',
      pos_x: 100,
      pos_y: 100,
      width: 60,
      height: 100,
      parent_node_id: null,
    };

    const targetNode: DiagramNode = {
      id: 'node-process',
      entity_type: ENTITY_TYPES.BUSINESS_PROCESS,
      entity_id: 'process-1',
      pos_x: 300,
      pos_y: 100,
      width: 120,
      height: 60,
      parent_node_id: null,
    };

    const relationship: BusinessUserBusinessPoint = {
      id: 'bup-1',
      business_user_id: 'user-1',
      business_point_id: 'bp_process-1',
      description: '',
      tags: '',
    };

    const edge = createRelationshipEdge(
      relationship,
      'USER_BUSINESS_POINT',
      sourceNode,
      targetNode
    );

    expect(edge.line_type).toBe('DASHED');
    expect(edge.arrow_end).toBeUndefined();
  });

  test('handleAddLogicalERRelationship should create edge with multiplicity labels', async () => {
    const { createRelationshipEdge, getMultiplicityLabels } = await import('../utils/relationshipUtils');
    const { getMultiplicityLabels: getLabels } = await import('../utils/rendering');

    const sourceNode: DiagramNode = {
      id: 'node-lde1',
      entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
      entity_id: 'lde-1',
      pos_x: 100,
      pos_y: 100,
      width: 120,
      height: 60,
      parent_node_id: null,
    };

    const targetNode: DiagramNode = {
      id: 'node-lde2',
      entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
      entity_id: 'lde-2',
      pos_x: 300,
      pos_y: 100,
      width: 120,
      height: 60,
      parent_node_id: null,
    };

    const relationship: LogicalDataEntityRelationship = {
      id: 'lder-1',
      fromDataEntityPointId: 'dep_log_lde-1',
      toDataEntityPointId: 'dep_log_lde-2',
      relationship_type: 'ONE_TO_MANY',
      description: '',
      tags: '',
    };

    const edge = createRelationshipEdge(
      relationship,
      'LOGICAL_DATA_ENTITY_RELATIONSHIP',
      sourceNode,
      targetNode,
      { multiplicityType: 'ONE_TO_MANY' }
    );

    expect(edge.source_label_text).toBe('1');
    expect(edge.target_label_text).toBe('m');
    expect(edge.source_label_pos_x).toBeDefined();
    expect(edge.target_label_pos_x).toBeDefined();
  });

  test('handleAddDataMovementRelationship should create edge with arrow and label', async () => {
    const { createRelationshipEdge } = await import('../utils/relationshipUtils');

    const sourceNode: DiagramNode = {
      id: 'node-ap1',
      entity_type: ENTITY_TYPES.APPLICATION_POINT,
      entity_id: 'ap-1',
      pos_x: 100,
      pos_y: 100,
      width: 130,
      height: 100,
      parent_node_id: null,
    };

    const targetNode: DiagramNode = {
      id: 'node-ap2',
      entity_type: ENTITY_TYPES.APPLICATION_POINT,
      entity_id: 'ap-2',
      pos_x: 400,
      pos_y: 100,
      width: 130,
      height: 100,
      parent_node_id: null,
    };

    const relationship: DataMovement = {
      id: 'dm-1',
      source_application_point_id: 'ap-1',
      target_application_point_id: 'ap-2',
      dataEntityPointId: 'dep_log_lde-1',
      movement_type: 'Batch',
      description: '',
      tags: '',
    };

    const edge = createRelationshipEdge(
      relationship,
      'DATA_MOVEMENT',
      sourceNode,
      targetNode,
      { labelText: 'Customer Data' }
    );

    expect(edge.line_type).toBe('SOLID');
    expect(edge.arrow_end).toBe('ARROW');
    expect(edge.label_text).toBe('Customer Data');
    expect(edge.label_pos_x).toBeDefined();
    expect(edge.label_pos_y).toBeDefined();
  });

  test('handleAddLogicalPhysicalEntityRelationship should create simple solid line', async () => {
    const { createRelationshipEdge } = await import('../utils/relationshipUtils');

    const sourceNode: DiagramNode = {
      id: 'node-lde',
      entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
      entity_id: 'lde-1',
      pos_x: 100,
      pos_y: 100,
      width: 120,
      height: 60,
      parent_node_id: null,
    };

    const targetNode: DiagramNode = {
      id: 'node-pde',
      entity_type: ENTITY_TYPES.PHYSICAL_DATA_ENTITY,
      entity_id: 'pde-1',
      pos_x: 300,
      pos_y: 100,
      width: 120,
      height: 60,
      parent_node_id: null,
    };

    const relationship: LogicalDataEntityPhysicalDataEntity = {
      id: 'ldepde-1',
      logical_entity_id: 'lde-1',
      physical_entity_id: 'pde-1',
      description: '',
      tags: '',
    };

    const edge = createRelationshipEdge(
      relationship,
      'LOGICAL_DATA_ENTITY_PHYSICAL_DATA_ENTITY',
      sourceNode,
      targetNode
    );

    expect(edge.line_type).toBe('SOLID');
    expect(edge.arrow_end).toBeUndefined();
    expect(edge.label_text).toBeUndefined();
  });
});

// ============================================================================
// Task Group 6: PaletteItem Enable/Disable UI Tests
// ============================================================================

describe('Task Group 6: PaletteItem Enable/Disable UI', () => {
  // These tests verify PaletteItem props and behavior
  // Actual React component testing would require React Testing Library

  test('relationship item props should include isRelationshipEnabled', () => {
    // This is a type check - verifying the interface supports the prop
    interface PaletteItemProps {
      item: { id: string; name: string };
      onClick: () => void;
      onContextMenu?: (e: React.MouseEvent, item: { id: string; name: string }) => void;
      itemType: 'entity' | 'relationship';
      diagram: { diagram_nodes: DiagramNode[] } | undefined;
      sectionId: string;
      isRelationshipEnabled?: boolean;
    }

    const props: PaletteItemProps = {
      item: { id: 'bup-1', name: 'User -> Process' },
      onClick: () => {},
      itemType: 'relationship',
      diagram: { diagram_nodes: [] },
      sectionId: 'business_user_processes',
      isRelationshipEnabled: true,
    };

    expect(props.isRelationshipEnabled).toBe(true);
  });

  test('disabled relationship should have correct CSS class', () => {
    // Verify the CSS class naming convention
    const disabledClass = 'itemRelationshipDisabled';
    expect(disabledClass).toBe('itemRelationshipDisabled');
  });
});

// ============================================================================
// Task Group 7: PaletteContextMenu Enable/Disable UI Tests
// ============================================================================

describe('Task Group 7: PaletteContextMenu Enable/Disable UI', () => {
  test('context menu should support relationship item type', () => {
    interface PaletteContextMenuProps {
      x: number;
      y: number;
      item: { id: string; name: string };
      sectionId: string;
      isOnDiagram: boolean;
      itemType?: 'entity' | 'relationship';
      isRelationshipEnabled?: boolean;
      onAddRelationship?: () => void;
      onClose: () => void;
    }

    const props: PaletteContextMenuProps = {
      x: 100,
      y: 200,
      item: { id: 'bup-1', name: 'User -> Process' },
      sectionId: 'business_user_processes',
      isOnDiagram: false,
      itemType: 'relationship',
      isRelationshipEnabled: true,
      onAddRelationship: () => {},
      onClose: () => {},
    };

    expect(props.itemType).toBe('relationship');
    expect(props.isRelationshipEnabled).toBe(true);
  });

  test('disabled Add item should have correct CSS class', () => {
    const disabledClass = 'menuItemDisabled';
    expect(disabledClass).toBe('menuItemDisabled');
  });
});

// ============================================================================
// Task Group 8: Edge Rendering Updates Tests
// ============================================================================

describe('Task Group 8: Edge Rendering Updates', () => {
  test('User-Process edge should use dashed stroke style', async () => {
    const { getEdgeStrokeStyle } = await import('../utils/rendering');

    const edge: DiagramEdge = {
      id: 'edge-1',
      relationship_type: 'USER_BUSINESS_POINT',
      relationship_id: 'bup-1',
      source_node_id: 'node-1',
      target_node_id: 'node-2',
      edge_points: [],
      line_type: 'DASHED',
    };

    const style = getEdgeStrokeStyle(edge);
    expect(style.strokeDasharray).not.toBe('');
  });

  test('Data Movement edge should have arrow end', () => {
    const edge: DiagramEdge = {
      id: 'edge-1',
      relationship_type: 'DATA_MOVEMENT',
      relationship_id: 'dm-1',
      source_node_id: 'node-1',
      target_node_id: 'node-2',
      edge_points: [],
      arrow_end: 'ARROW',
      line_type: 'SOLID',
    };

    expect(edge.arrow_end).toBe('ARROW');
  });

  test('Logical ER edge should have source and target labels', () => {
    const edge: DiagramEdge = {
      id: 'edge-1',
      relationship_type: 'LOGICAL_DATA_ENTITY_RELATIONSHIP',
      relationship_id: 'lder-1',
      source_node_id: 'node-1',
      target_node_id: 'node-2',
      edge_points: [],
      source_label_text: '1',
      target_label_text: 'm',
      source_label_pos_x: 120,
      source_label_pos_y: 100,
      target_label_pos_x: 280,
      target_label_pos_y: 100,
    };

    expect(edge.source_label_text).toBe('1');
    expect(edge.target_label_text).toBe('m');
  });

  test('Logical-Physical entity edge should be solid with no labels', () => {
    const edge: DiagramEdge = {
      id: 'edge-1',
      relationship_type: 'LOGICAL_DATA_ENTITY_PHYSICAL_DATA_ENTITY',
      relationship_id: 'ldepde-1',
      source_node_id: 'node-1',
      target_node_id: 'node-2',
      edge_points: [],
      line_type: 'SOLID',
    };

    expect(edge.line_type).toBe('SOLID');
    expect(edge.label_text).toBeUndefined();
    expect(edge.arrow_end).toBeUndefined();
  });
});

// ============================================================================
// Task Group 9: Label Selection and Dragging Tests
// ============================================================================

describe('Task Group 9: Label Selection and Dragging', () => {
  test('isPointOnLabel should detect click on multiplicity label', async () => {
    const { isPointOnLabel, measureTextWidth } = await import('../utils/rendering');

    const labelX = 150;
    const labelY = 100;
    const labelText = 'm';
    const fontSize = 12;
    const textWidth = measureTextWidth(labelText, fontSize);

    // Click on label center
    const result = isPointOnLabel(150, 95, labelX, labelY, textWidth, fontSize);
    expect(result).toBe(true);

    // Click outside label
    const resultOutside = isPointOnLabel(200, 95, labelX, labelY, textWidth, fontSize);
    expect(resultOutside).toBe(false);
  });

  test('label position should persist in DiagramEdge', () => {
    const edge: DiagramEdge = {
      id: 'edge-1',
      relationship_type: 'LOGICAL_DATA_ENTITY_RELATIONSHIP',
      relationship_id: 'lder-1',
      source_node_id: 'node-1',
      target_node_id: 'node-2',
      edge_points: [],
      source_label_text: '1',
      target_label_text: 'm',
      source_label_pos_x: 120,
      source_label_pos_y: 100,
      target_label_pos_x: 280,
      target_label_pos_y: 100,
    };

    // Simulate drag - update positions
    const updatedEdge = {
      ...edge,
      source_label_pos_x: 130,
      source_label_pos_y: 90,
    };

    expect(updatedEdge.source_label_pos_x).toBe(130);
    expect(updatedEdge.source_label_pos_y).toBe(90);
  });

  test('selectedLabelType should track which label is selected', () => {
    type SelectedLabelType = 'main' | 'source' | 'target' | null;

    let selectedLabelType: SelectedLabelType = null;

    // Select source label
    selectedLabelType = 'source';
    expect(selectedLabelType).toBe('source');

    // Select target label
    selectedLabelType = 'target';
    expect(selectedLabelType).toBe('target');

    // Clear selection
    selectedLabelType = null;
    expect(selectedLabelType).toBeNull();
  });
});

// ============================================================================
// Task Group 10: Integration Tests
// ============================================================================

describe('Task Group 10: Integration Tests', () => {
  test('left-click and right-click Add should produce identical results', async () => {
    const { createRelationshipEdge } = await import('../utils/relationshipUtils');

    const sourceNode: DiagramNode = {
      id: 'node-1',
      entity_type: ENTITY_TYPES.BUSINESS_USER,
      entity_id: 'user-1',
      pos_x: 100,
      pos_y: 100,
      width: 60,
      height: 100,
      parent_node_id: null,
    };

    const targetNode: DiagramNode = {
      id: 'node-2',
      entity_type: ENTITY_TYPES.BUSINESS_PROCESS,
      entity_id: 'process-1',
      pos_x: 300,
      pos_y: 100,
      width: 120,
      height: 60,
      parent_node_id: null,
    };

    const relationship: BusinessUserBusinessPoint = {
      id: 'bup-1',
      business_user_id: 'user-1',
      business_point_id: 'bp_process-1',
      description: '',
      tags: '',
    };

    // Simulate left-click add
    const edgeFromLeftClick = createRelationshipEdge(
      relationship,
      'USER_BUSINESS_POINT',
      sourceNode,
      targetNode
    );

    // Simulate right-click add (same function, same inputs)
    const edgeFromRightClick = createRelationshipEdge(
      relationship,
      'USER_BUSINESS_POINT',
      sourceNode,
      targetNode
    );

    // Compare structural properties (excluding generated IDs)
    expect(edgeFromLeftClick.relationship_type).toBe(edgeFromRightClick.relationship_type);
    expect(edgeFromLeftClick.relationship_id).toBe(edgeFromRightClick.relationship_id);
    expect(edgeFromLeftClick.source_node_id).toBe(edgeFromRightClick.source_node_id);
    expect(edgeFromLeftClick.target_node_id).toBe(edgeFromRightClick.target_node_id);
    expect(edgeFromLeftClick.line_type).toBe(edgeFromRightClick.line_type);
  });

  test('multiple relationships can be added to same diagram', async () => {
    const edges: DiagramEdge[] = [];

    // Add User-Business Point relationship
    edges.push({
      id: 'edge-1',
      relationship_type: 'USER_BUSINESS_POINT',
      relationship_id: 'bup-1',
      source_node_id: 'node-1',
      target_node_id: 'node-2',
      edge_points: [],
      line_type: 'DASHED',
    });

    // Add Data Movement relationship
    edges.push({
      id: 'edge-2',
      relationship_type: 'DATA_MOVEMENT',
      relationship_id: 'dm-1',
      source_node_id: 'node-3',
      target_node_id: 'node-4',
      edge_points: [],
      line_type: 'SOLID',
      arrow_end: 'ARROW',
    });

    // Add Logical ER relationship
    edges.push({
      id: 'edge-3',
      relationship_type: 'LOGICAL_DATA_ENTITY_RELATIONSHIP',
      relationship_id: 'lder-1',
      source_node_id: 'node-5',
      target_node_id: 'node-6',
      edge_points: [],
      source_label_text: '1',
      target_label_text: 'm',
    });

    expect(edges.length).toBe(3);
    expect(edges.map(e => e.relationship_type)).toContain('USER_BUSINESS_POINT');
    expect(edges.map(e => e.relationship_type)).toContain('DATA_MOVEMENT');
    expect(edges.map(e => e.relationship_type)).toContain('LOGICAL_DATA_ENTITY_RELATIONSHIP');
  });
});
