/**
 * Business Point Relationship Tests
 *
 * Tests for relationship eligibility, edge creation, and dropdown formatting
 * for the new Business Point relationships:
 * - User <-> Business Point
 * - App Point <-> Business Point
 *
 * Note: These tests use Vitest for testing.
 */

import { describe, test, expect } from 'vitest';

import {
  getEntitiesOnDiagram,
  getRelationshipEligibility,
  isRelationshipRowEnabled,
  createRelationshipEdge,
  getUserBusinessPointNodes,
  getAppPointBusinessPointNodes,
  EntitiesOnDiagram,
} from '../utils/relationshipUtils';

import { generateBusinessPointId } from '../utils/businessPointSync';

import {
  formatBusinessPointDisplay,
  BUSINESS_POINT_KIND_LABELS,
  businessPointDisplayFormatter,
} from '../utils/formatters';

import {
  BusinessPoint,
  BusinessProcess,
  ProcessActivity,
  BusinessUserBusinessPoint,
  ApplicationPointBusinessPoint,
  DiagramNode,
  MetaModel,
  MetaModelEntities,
  MetaModelRelationships,
  ENTITY_TYPES,
  RELATIONSHIP_EDGE_TYPES,
} from '../types/model';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create empty MetaModelRelationships for testing
 */
function createEmptyRelationships(): MetaModelRelationships {
  return {
    business_user_processes: [],
    application_point_business_processes: [],
    business_user_business_points: [],
    application_point_business_points: [],
    logical_data_entity_relationships: [],
    logical_data_entity_physical_data_entities: [],
    logical_data_attribute_physical_data_attributes: [],
    data_movements: [],
    interface_logical_entities: [],
  };
}

/**
 * Create empty MetaModelEntities for testing
 */
function createEmptyEntities(): MetaModelEntities {
  return {
    business_users: [],
    business_processes: [],
    process_activities: [],
    business_points: [],
    applications: [],
    app_components: [],
    services: [],
    interfaces: [],
    application_points: [],
    logical_data_entities: [],
    logical_data_attributes: [],
    physical_data_entities: [],
    physical_data_attributes: [],
  };
}

/**
 * Create a test Business Point
 */
function createTestBusinessPoint(overrides: Partial<BusinessPoint> = {}): BusinessPoint {
  return {
    id: 'bp_proc-1',
    name: 'Test Business Point',
    description: '',
    kind: 'BUSINESS_PROCESS',
    business_process_id: 'proc-1',
    tags: '',
    ...overrides,
  };
}

/**
 * Create a test DiagramNode
 */
function createTestNode(overrides: Partial<DiagramNode> = {}): DiagramNode {
  return {
    id: 'node-1',
    entity_type: ENTITY_TYPES.BUSINESS_PROCESS,
    entity_id: 'proc-1',
    pos_x: 100,
    pos_y: 100,
    width: 150,
    height: 60,
    parent_node_id: null,
    ...overrides,
  };
}

/**
 * Create a test MetaModel
 */
function createTestMetaModel(): MetaModel {
  return {
    entities: {
      ...createEmptyEntities(),
      business_points: [
        createTestBusinessPoint({
          id: 'bp_proc-1',
          name: 'Order Processing',
          kind: 'BUSINESS_PROCESS',
          business_process_id: 'proc-1',
        }),
        createTestBusinessPoint({
          id: 'bp_act-1',
          name: 'Validate Order',
          kind: 'PROCESS_ACTIVITY',
          business_process_id: 'proc-1',
          process_activity_id: 'act-1',
        }),
      ],
      application_points: [
        {
          id: 'ap-1',
          name: 'OMS System',
          description: '',
          kind: 'APPLICATION',
          application_id: 'app-1',
          point_type: '',
          tags: '',
        },
      ],
    },
    relationships: createEmptyRelationships(),
  };
}

// ============================================================================
// Test Suite: User <-> Business Point Eligibility
// ============================================================================

describe('User <-> Business Point eligibility when both on diagram', () => {
  test('enabled when both Business User and Business Point are on diagram', () => {
    const metaModel = createTestMetaModel();
    const nodes: DiagramNode[] = [
      createTestNode({
        id: 'node-user',
        entity_type: ENTITY_TYPES.BUSINESS_USER,
        entity_id: 'user-1',
      }),
      createTestNode({
        id: 'node-proc',
        entity_type: ENTITY_TYPES.BUSINESS_PROCESS,
        entity_id: 'proc-1',
      }),
    ];

    const relationship: BusinessUserBusinessPoint = {
      id: 'bubp-1',
      business_user_id: 'user-1',
      business_point_id: 'bp_proc-1',
      description: '',
      tags: '',
    };

    const result = getRelationshipEligibility(
      relationship,
      'business_user_business_points',
      nodes,
      metaModel
    );

    expect(result.enabled).toBe(true);
    expect(result.disabledReason).toBeNull();
  });

  test('enabled when Business User and Process Activity (as BP) are on diagram', () => {
    const metaModel = createTestMetaModel();
    const nodes: DiagramNode[] = [
      createTestNode({
        id: 'node-user',
        entity_type: ENTITY_TYPES.BUSINESS_USER,
        entity_id: 'user-1',
      }),
      createTestNode({
        id: 'node-act',
        entity_type: ENTITY_TYPES.PROCESS_ACTIVITY,
        entity_id: 'act-1',
      }),
    ];

    const relationship: BusinessUserBusinessPoint = {
      id: 'bubp-1',
      business_user_id: 'user-1',
      business_point_id: 'bp_act-1',
      description: '',
      tags: '',
    };

    const result = getRelationshipEligibility(
      relationship,
      'business_user_business_points',
      nodes,
      metaModel
    );

    expect(result.enabled).toBe(true);
  });
});

describe('User <-> Business Point eligibility when one missing', () => {
  test('disabled when Business User is missing from diagram', () => {
    const metaModel = createTestMetaModel();
    const nodes: DiagramNode[] = [
      createTestNode({
        id: 'node-proc',
        entity_type: ENTITY_TYPES.BUSINESS_PROCESS,
        entity_id: 'proc-1',
      }),
    ];

    const relationship: BusinessUserBusinessPoint = {
      id: 'bubp-1',
      business_user_id: 'user-1',
      business_point_id: 'bp_proc-1',
      description: '',
      tags: '',
    };

    const result = getRelationshipEligibility(
      relationship,
      'business_user_business_points',
      nodes,
      metaModel
    );

    expect(result.enabled).toBe(false);
    expect(result.disabledReason).toBe('endpoints_missing');
  });

  test('disabled when Business Point is missing from diagram', () => {
    const metaModel = createTestMetaModel();
    const nodes: DiagramNode[] = [
      createTestNode({
        id: 'node-user',
        entity_type: ENTITY_TYPES.BUSINESS_USER,
        entity_id: 'user-1',
      }),
    ];

    const relationship: BusinessUserBusinessPoint = {
      id: 'bubp-1',
      business_user_id: 'user-1',
      business_point_id: 'bp_proc-1',
      description: '',
      tags: '',
    };

    const result = getRelationshipEligibility(
      relationship,
      'business_user_business_points',
      nodes,
      metaModel
    );

    expect(result.enabled).toBe(false);
    expect(result.disabledReason).toBe('endpoints_missing');
  });

  test('disabled when both endpoints are missing from diagram', () => {
    const metaModel = createTestMetaModel();
    const nodes: DiagramNode[] = [];

    const relationship: BusinessUserBusinessPoint = {
      id: 'bubp-1',
      business_user_id: 'user-1',
      business_point_id: 'bp_proc-1',
      description: '',
      tags: '',
    };

    const result = getRelationshipEligibility(
      relationship,
      'business_user_business_points',
      nodes,
      metaModel
    );

    expect(result.enabled).toBe(false);
    expect(result.disabledReason).toBe('endpoints_missing');
  });
});

// ============================================================================
// Test Suite: App Point <-> Business Point Eligibility
// ============================================================================

describe('App Point <-> Business Point eligibility', () => {
  test('enabled when both Application Point and Business Point are on diagram', () => {
    const metaModel = createTestMetaModel();
    const nodes: DiagramNode[] = [
      createTestNode({
        id: 'node-ap',
        entity_type: ENTITY_TYPES.APPLICATION,
        entity_id: 'app-1',
      }),
      createTestNode({
        id: 'node-proc',
        entity_type: ENTITY_TYPES.BUSINESS_PROCESS,
        entity_id: 'proc-1',
      }),
    ];

    const relationship: ApplicationPointBusinessPoint = {
      id: 'apbp-1',
      application_point_id: 'ap-1',
      business_point_id: 'bp_proc-1',
      description: '',
      tags: '',
    };

    const result = getRelationshipEligibility(
      relationship,
      'application_point_business_points',
      nodes,
      metaModel
    );

    expect(result.enabled).toBe(true);
  });

  test('disabled when Application Point is missing from diagram', () => {
    const metaModel = createTestMetaModel();
    const nodes: DiagramNode[] = [
      createTestNode({
        id: 'node-proc',
        entity_type: ENTITY_TYPES.BUSINESS_PROCESS,
        entity_id: 'proc-1',
      }),
    ];

    const relationship: ApplicationPointBusinessPoint = {
      id: 'apbp-1',
      application_point_id: 'ap-1',
      business_point_id: 'bp_proc-1',
      description: '',
      tags: '',
    };

    const result = getRelationshipEligibility(
      relationship,
      'application_point_business_points',
      nodes,
      metaModel
    );

    expect(result.enabled).toBe(false);
    expect(result.disabledReason).toBe('endpoints_missing');
  });

  test('disabled when Business Point is missing from diagram', () => {
    const metaModel = createTestMetaModel();
    const nodes: DiagramNode[] = [
      createTestNode({
        id: 'node-app',
        entity_type: ENTITY_TYPES.APPLICATION,
        entity_id: 'app-1',
      }),
    ];

    const relationship: ApplicationPointBusinessPoint = {
      id: 'apbp-1',
      application_point_id: 'ap-1',
      business_point_id: 'bp_proc-1',
      description: '',
      tags: '',
    };

    const result = getRelationshipEligibility(
      relationship,
      'application_point_business_points',
      nodes,
      metaModel
    );

    expect(result.enabled).toBe(false);
    expect(result.disabledReason).toBe('endpoints_missing');
  });
});

// ============================================================================
// Test Suite: getEntitiesOnDiagram - Business Point Mapping
// ============================================================================

describe('getEntitiesOnDiagram Business Point mapping', () => {
  test('maps BUSINESS_PROCESS node to businessPointsOnDiagram', () => {
    const metaModel = createTestMetaModel();
    const diagram = {
      diagram_nodes: [
        createTestNode({
          entity_type: ENTITY_TYPES.BUSINESS_PROCESS,
          entity_id: 'proc-1',
        }),
      ],
    };

    const entities = getEntitiesOnDiagram(metaModel, diagram);

    expect(entities.businessPointsOnDiagram.has('bp_proc-1')).toBe(true);
    expect(entities.businessProcessesOnDiagram.has('proc-1')).toBe(true);
  });

  test('maps PROCESS_ACTIVITY node to businessPointsOnDiagram', () => {
    const metaModel = createTestMetaModel();
    const diagram = {
      diagram_nodes: [
        createTestNode({
          entity_type: ENTITY_TYPES.PROCESS_ACTIVITY,
          entity_id: 'act-1',
        }),
      ],
    };

    const entities = getEntitiesOnDiagram(metaModel, diagram);

    expect(entities.businessPointsOnDiagram.has('bp_act-1')).toBe(true);
    expect(entities.processActivitiesOnDiagram.has('act-1')).toBe(true);
  });

  test('includes direct BUSINESS_POINT nodes', () => {
    const metaModel = createTestMetaModel();
    const diagram = {
      diagram_nodes: [
        createTestNode({
          entity_type: ENTITY_TYPES.BUSINESS_POINT,
          entity_id: 'bp_direct',
        }),
      ],
    };

    const entities = getEntitiesOnDiagram(metaModel, diagram);

    expect(entities.businessPointsOnDiagram.has('bp_direct')).toBe(true);
  });

  test('returns empty sets when no diagram', () => {
    const metaModel = createTestMetaModel();

    const entities = getEntitiesOnDiagram(metaModel, undefined);

    expect(entities.businessPointsOnDiagram.size).toBe(0);
    expect(entities.businessProcessesOnDiagram.size).toBe(0);
    expect(entities.processActivitiesOnDiagram.size).toBe(0);
  });
});

// ============================================================================
// Test Suite: Relationship Edge Creation and Styling
// ============================================================================

describe('Relationship edge creation and styling', () => {
  test('User-Business Point edge has DASHED line type', () => {
    const sourceNode = createTestNode({
      id: 'node-user',
      entity_type: ENTITY_TYPES.BUSINESS_USER,
      entity_id: 'user-1',
      pos_x: 100,
      pos_y: 100,
    });
    const targetNode = createTestNode({
      id: 'node-proc',
      entity_type: ENTITY_TYPES.BUSINESS_PROCESS,
      entity_id: 'proc-1',
      pos_x: 300,
      pos_y: 100,
    });

    const relationship: BusinessUserBusinessPoint = {
      id: 'bubp-1',
      business_user_id: 'user-1',
      business_point_id: 'bp_proc-1',
      description: '',
      tags: '',
    };

    const edge = createRelationshipEdge(
      relationship,
      RELATIONSHIP_EDGE_TYPES.USER_BUSINESS_POINT,
      sourceNode,
      targetNode
    );

    expect(edge.line_type).toBe('DASHED');
    expect(edge.relationship_type).toBe(RELATIONSHIP_EDGE_TYPES.USER_BUSINESS_POINT);
    expect(edge.relationship_id).toBe('bubp-1');
  });

  test('App Point-Business Point edge has SOLID line type', () => {
    const sourceNode = createTestNode({
      id: 'node-ap',
      entity_type: ENTITY_TYPES.APPLICATION_POINT,
      entity_id: 'ap-1',
      pos_x: 100,
      pos_y: 100,
    });
    const targetNode = createTestNode({
      id: 'node-proc',
      entity_type: ENTITY_TYPES.BUSINESS_PROCESS,
      entity_id: 'proc-1',
      pos_x: 300,
      pos_y: 100,
    });

    const relationship: ApplicationPointBusinessPoint = {
      id: 'apbp-1',
      application_point_id: 'ap-1',
      business_point_id: 'bp_proc-1',
      description: '',
      tags: '',
    };

    const edge = createRelationshipEdge(
      relationship,
      RELATIONSHIP_EDGE_TYPES.APP_POINT_BUSINESS_POINT,
      sourceNode,
      targetNode
    );

    expect(edge.line_type).toBe('SOLID');
    expect(edge.relationship_type).toBe(RELATIONSHIP_EDGE_TYPES.APP_POINT_BUSINESS_POINT);
    expect(edge.relationship_id).toBe('apbp-1');
  });

  test('edge includes calculated edge points', () => {
    const sourceNode = createTestNode({
      id: 'node-user',
      pos_x: 100,
      pos_y: 100,
      width: 150,
      height: 60,
    });
    const targetNode = createTestNode({
      id: 'node-proc',
      pos_x: 400,
      pos_y: 100,
      width: 150,
      height: 60,
    });

    const relationship: BusinessUserBusinessPoint = {
      id: 'bubp-1',
      business_user_id: 'user-1',
      business_point_id: 'bp_proc-1',
      description: '',
      tags: '',
    };

    const edge = createRelationshipEdge(
      relationship,
      RELATIONSHIP_EDGE_TYPES.USER_BUSINESS_POINT,
      sourceNode,
      targetNode
    );

    expect(edge.edge_points).toHaveLength(2);
    expect(edge.edge_points[0].sequence_order).toBe(0);
    expect(edge.edge_points[1].sequence_order).toBe(1);
  });
});

// ============================================================================
// Test Suite: Dropdown Formatting
// ============================================================================

describe('Business Point dropdown formatting', () => {
  test('formatBusinessPointDisplay formats BUSINESS_PROCESS kind correctly', () => {
    const bp = createTestBusinessPoint({
      name: 'Order Processing',
      kind: 'BUSINESS_PROCESS',
    });

    const display = formatBusinessPointDisplay(bp);

    expect(display).toBe('Order Processing (Business Process)');
  });

  test('formatBusinessPointDisplay formats PROCESS_ACTIVITY kind correctly', () => {
    const bp = createTestBusinessPoint({
      name: 'Validate Order',
      kind: 'PROCESS_ACTIVITY',
    });

    const display = formatBusinessPointDisplay(bp);

    expect(display).toBe('Validate Order (Process Activity)');
  });

  test('BUSINESS_POINT_KIND_LABELS has correct labels', () => {
    expect(BUSINESS_POINT_KIND_LABELS['BUSINESS_PROCESS']).toBe('Business Process');
    expect(BUSINESS_POINT_KIND_LABELS['PROCESS_ACTIVITY']).toBe('Process Activity');
  });

  test('businessPointDisplayFormatter returns formatted display for valid ID', () => {
    const businessPoints: BusinessPoint[] = [
      createTestBusinessPoint({
        id: 'bp_proc-1',
        name: 'Order Processing',
        kind: 'BUSINESS_PROCESS',
      }),
    ];

    const display = businessPointDisplayFormatter('bp_proc-1', businessPoints);

    expect(display).toBe('Order Processing (Business Process)');
  });

  test('businessPointDisplayFormatter returns ID for unknown ID', () => {
    const businessPoints: BusinessPoint[] = [];

    const display = businessPointDisplayFormatter('unknown-id', businessPoints);

    expect(display).toBe('unknown-id');
  });

  test('businessPointDisplayFormatter returns empty string for empty ID', () => {
    const businessPoints: BusinessPoint[] = [];

    const display = businessPointDisplayFormatter('', businessPoints);

    expect(display).toBe('');
  });
});

// ============================================================================
// Test Suite: Node Finding for Relationships
// ============================================================================

describe('getUserBusinessPointNodes', () => {
  test('finds nodes for User-Business Point relationship', () => {
    const metaModel = createTestMetaModel();
    const nodes: DiagramNode[] = [
      createTestNode({
        id: 'node-user',
        entity_type: ENTITY_TYPES.BUSINESS_USER,
        entity_id: 'user-1',
      }),
      createTestNode({
        id: 'node-proc',
        entity_type: ENTITY_TYPES.BUSINESS_PROCESS,
        entity_id: 'proc-1',
      }),
    ];

    const relationship: BusinessUserBusinessPoint = {
      id: 'bubp-1',
      business_user_id: 'user-1',
      business_point_id: 'bp_proc-1',
      description: '',
      tags: '',
    };

    const result = getUserBusinessPointNodes(relationship, nodes, metaModel);

    expect(result).not.toBeNull();
    expect(result?.sourceNode.id).toBe('node-user');
    expect(result?.targetNode.id).toBe('node-proc');
  });

  test('returns null when source node not found', () => {
    const metaModel = createTestMetaModel();
    const nodes: DiagramNode[] = [
      createTestNode({
        id: 'node-proc',
        entity_type: ENTITY_TYPES.BUSINESS_PROCESS,
        entity_id: 'proc-1',
      }),
    ];

    const relationship: BusinessUserBusinessPoint = {
      id: 'bubp-1',
      business_user_id: 'user-1',
      business_point_id: 'bp_proc-1',
      description: '',
      tags: '',
    };

    const result = getUserBusinessPointNodes(relationship, nodes, metaModel);

    expect(result).toBeNull();
  });
});

describe('getAppPointBusinessPointNodes', () => {
  test('finds nodes for App Point-Business Point relationship', () => {
    const metaModel = createTestMetaModel();
    const nodes: DiagramNode[] = [
      createTestNode({
        id: 'node-app',
        entity_type: ENTITY_TYPES.APPLICATION,
        entity_id: 'app-1',
      }),
      createTestNode({
        id: 'node-proc',
        entity_type: ENTITY_TYPES.BUSINESS_PROCESS,
        entity_id: 'proc-1',
      }),
    ];

    const relationship: ApplicationPointBusinessPoint = {
      id: 'apbp-1',
      application_point_id: 'ap-1',
      business_point_id: 'bp_proc-1',
      description: '',
      tags: '',
    };

    const result = getAppPointBusinessPointNodes(relationship, nodes, metaModel);

    expect(result).not.toBeNull();
    expect(result?.sourceNode.id).toBe('node-app');
    expect(result?.targetNode.id).toBe('node-proc');
  });

  test('finds Process Activity node for PROCESS_ACTIVITY kind BP', () => {
    const metaModel = createTestMetaModel();
    const nodes: DiagramNode[] = [
      createTestNode({
        id: 'node-app',
        entity_type: ENTITY_TYPES.APPLICATION,
        entity_id: 'app-1',
      }),
      createTestNode({
        id: 'node-act',
        entity_type: ENTITY_TYPES.PROCESS_ACTIVITY,
        entity_id: 'act-1',
      }),
    ];

    const relationship: ApplicationPointBusinessPoint = {
      id: 'apbp-1',
      application_point_id: 'ap-1',
      business_point_id: 'bp_act-1',
      description: '',
      tags: '',
    };

    const result = getAppPointBusinessPointNodes(relationship, nodes, metaModel);

    expect(result).not.toBeNull();
    expect(result?.targetNode.id).toBe('node-act');
    expect(result?.targetNode.entity_type).toBe(ENTITY_TYPES.PROCESS_ACTIVITY);
  });

  test('returns null when target node not found', () => {
    const metaModel = createTestMetaModel();
    const nodes: DiagramNode[] = [
      createTestNode({
        id: 'node-app',
        entity_type: ENTITY_TYPES.APPLICATION,
        entity_id: 'app-1',
      }),
    ];

    const relationship: ApplicationPointBusinessPoint = {
      id: 'apbp-1',
      application_point_id: 'ap-1',
      business_point_id: 'bp_proc-1',
      description: '',
      tags: '',
    };

    const result = getAppPointBusinessPointNodes(relationship, nodes, metaModel);

    expect(result).toBeNull();
  });
});

// ============================================================================
// Test Suite: isRelationshipRowEnabled convenience function
// ============================================================================

describe('isRelationshipRowEnabled for Business Point relationships', () => {
  test('returns true for enabled User-Business Point relationship', () => {
    const metaModel = createTestMetaModel();
    const nodes: DiagramNode[] = [
      createTestNode({
        entity_type: ENTITY_TYPES.BUSINESS_USER,
        entity_id: 'user-1',
      }),
      createTestNode({
        entity_type: ENTITY_TYPES.BUSINESS_PROCESS,
        entity_id: 'proc-1',
      }),
    ];

    const relationship: BusinessUserBusinessPoint = {
      id: 'bubp-1',
      business_user_id: 'user-1',
      business_point_id: 'bp_proc-1',
      description: '',
      tags: '',
    };

    const enabled = isRelationshipRowEnabled(
      relationship,
      'business_user_business_points',
      nodes,
      metaModel
    );

    expect(enabled).toBe(true);
  });

  test('returns false for disabled User-Business Point relationship', () => {
    const metaModel = createTestMetaModel();
    const nodes: DiagramNode[] = [];

    const relationship: BusinessUserBusinessPoint = {
      id: 'bubp-1',
      business_user_id: 'user-1',
      business_point_id: 'bp_proc-1',
      description: '',
      tags: '',
    };

    const enabled = isRelationshipRowEnabled(
      relationship,
      'business_user_business_points',
      nodes,
      metaModel
    );

    expect(enabled).toBe(false);
  });
});
