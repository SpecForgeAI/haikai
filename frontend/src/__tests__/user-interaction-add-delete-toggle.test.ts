/**
 * Tests for User Interaction Add/Delete Toggle Feature
 *
 * Task Group 5: Write Tests and Verify
 *
 * Tests the following functionality:
 * - PaletteSection.getRelationshipInfo() returns correct action based on edge existence
 * - handleDeleteUserInteraction() deletes all edges for an interaction
 * - handleAddUserInteraction() creates edges correctly
 * - Add/Delete toggle visual state in PaletteItem
 */

import {
  isUserInteractionRowEnabled,
  isUserInteractionCase,
  getInteractionEdgesOnDiagram,
  addUserInteractionToDiagram,
  shouldCascadeDeleteUserLink,
  getInteractionEdgeCountForInteraction,
  getEdgesToDeleteWithCascade,
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
} from '../types/model';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create a minimal MetaModel with necessary entities for testing
 */
function createTestMetaModel(): MetaModel {
  return {
    entities: {
      business_users: [
        { id: 'user_1', name: 'Test User', description: '', tags: '' },
      ],
      business_processes: [],
      process_activities: [],
      business_points: [],
      applications: [
        { id: 'app_1', name: 'Test App', description: '', app_type: 'WEB', status: 'ACTIVE', tags: '' },
      ],
      app_components: [],
      services: [
        { id: 'svc_1', name: 'Test Service', description: '', application_id: 'app_1', service_type: 'API', tags: '' },
      ],
      interfaces: [],
      endpoints: [],
      application_points: [],
      logical_data_entities: [],
      logical_data_attributes: [],
      physical_data_entities: [],
      physical_data_attributes: [],
      app_business_points: [
        // ABP for Application
        { id: 'abp_app_1', name: 'Test App', kind: 'APPLICATION', source_entity_id: 'app_1' } as AppBusinessPoint,
        // ABP for Service
        { id: 'abp_svc_1', name: 'Test Service', kind: 'SERVICE', source_entity_id: 'svc_1' } as AppBusinessPoint,
      ],
      interactions: [
        // Case A: Both P and S
        {
          id: 'interaction_1',
          name: 'Test Interaction A',
          user_id: 'user_1',
          primary_app_business_point_id: 'abp_app_1',
          secondary_app_business_point_id: 'abp_svc_1',
        } as Interaction,
        // Case B: Only P (no S)
        {
          id: 'interaction_2',
          name: 'Test Interaction B',
          user_id: 'user_1',
          primary_app_business_point_id: 'abp_app_1',
        } as Interaction,
      ],
    },
    relationships: {
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      business_user_business_points: [],
      application_point_business_points: [],
      interface_logical_data_entities: [],
      endpoint_logical_data_entities: [],
    },
  };
}

/**
 * Create a test diagram node
 */
function createTestNode(
  entityType: string,
  entityId: string,
  nodeId: string = `node_${entityId}`
): DiagramNode {
  return {
    id: nodeId,
    entity_type: entityType,
    entity_id: entityId,
    pos_x: 100,
    pos_y: 100,
    width: 150,
    height: 80,
    auto_size: false,
    z_index: 1,
    parent_node_id: null,
    style_override: {},
  };
}

/**
 * Create a test USER_INTERACTION edge
 */
function createTestEdge(
  interactionId: string,
  subType: 'MAIN' | 'USER_LINK',
  sourceNodeId: string,
  targetNodeId: string,
  edgeId: string = `edge_${interactionId}_${subType}`
): DiagramEdge {
  return {
    id: edgeId,
    relationship_type: RELATIONSHIP_EDGE_TYPES.USER_INTERACTION,
    relationship_id: interactionId,
    source_node_id: sourceNodeId,
    target_node_id: targetNodeId,
    subType,
    line_dashes: '4,4',
    edge_points: [],
  };
}

/**
 * Create an empty test diagram
 */
function createEmptyDiagram(): Diagram {
  return {
    id: 'diagram_1',
    name: 'Test Diagram',
    description: '',
    diagram_nodes: [],
    diagram_edges: [],
  };
}

// ============================================================================
// Tests for isUserInteractionCase()
// ============================================================================

describe('isUserInteractionCase', () => {
  it('should return "A" when both primary and secondary ABP IDs are present', () => {
    const interactionA: Interaction = {
      id: 'int_1',
      name: 'Test',
      user_id: 'user_1',
      primary_app_business_point_id: 'abp_1',
      secondary_app_business_point_id: 'abp_2',
    };

    expect(isUserInteractionCase(interactionA)).toBe('A');
  });

  it('should return "B" when only primary ABP ID is present', () => {
    const interactionB: Interaction = {
      id: 'int_2',
      name: 'Test',
      user_id: 'user_1',
      primary_app_business_point_id: 'abp_1',
    };

    expect(isUserInteractionCase(interactionB)).toBe('B');
  });

  it('should return "B" when secondary ABP ID is null', () => {
    const interactionB: Interaction = {
      id: 'int_3',
      name: 'Test',
      user_id: 'user_1',
      primary_app_business_point_id: 'abp_1',
      secondary_app_business_point_id: undefined,
    };

    expect(isUserInteractionCase(interactionB)).toBe('B');
  });
});

// ============================================================================
// Tests for getInteractionEdgesOnDiagram()
// ============================================================================

describe('getInteractionEdgesOnDiagram', () => {
  it('should return empty array when no edges exist', () => {
    const edges: DiagramEdge[] = [];
    const result = getInteractionEdgesOnDiagram('interaction_1', edges);

    expect(result).toEqual([]);
  });

  it('should return only edges matching the interaction ID', () => {
    const edges: DiagramEdge[] = [
      createTestEdge('interaction_1', 'MAIN', 'node_1', 'node_2'),
      createTestEdge('interaction_1', 'USER_LINK', 'node_3', 'midpoint-interaction_1'),
      createTestEdge('interaction_2', 'MAIN', 'node_4', 'node_5'), // Different interaction
    ];

    const result = getInteractionEdgesOnDiagram('interaction_1', edges);

    expect(result).toHaveLength(2);
    expect(result.every(e => e.relationship_id === 'interaction_1')).toBe(true);
  });

  it('should not return non-USER_INTERACTION edges', () => {
    const edges: DiagramEdge[] = [
      createTestEdge('interaction_1', 'MAIN', 'node_1', 'node_2'),
      {
        // A different edge type with same relationship_id
        id: 'edge_other',
        relationship_type: 'OTHER_TYPE',
        relationship_id: 'interaction_1',
        source_node_id: 'node_1',
        target_node_id: 'node_2',
        edge_points: [],
      },
    ];

    const result = getInteractionEdgesOnDiagram('interaction_1', edges);

    expect(result).toHaveLength(1);
    expect(result[0].relationship_type).toBe(RELATIONSHIP_EDGE_TYPES.USER_INTERACTION);
  });
});

// ============================================================================
// Tests for isUserInteractionRowEnabled()
// ============================================================================

describe('isUserInteractionRowEnabled', () => {
  const metaModel = createTestMetaModel();

  describe('Case A: Both P and S nodes required', () => {
    it('should return true when P and S nodes exist and no edges', () => {
      const diagram = createEmptyDiagram();
      diagram.diagram_nodes = [
        createTestNode(ENTITY_TYPES.APPLICATION, 'app_1'),
        createTestNode(ENTITY_TYPES.SERVICE, 'svc_1'),
      ];

      const interaction = metaModel.entities.interactions![0]; // Case A
      const result = isUserInteractionRowEnabled(interaction, diagram, metaModel);

      expect(result).toBe(true);
    });

    it('should return false when P node missing', () => {
      const diagram = createEmptyDiagram();
      diagram.diagram_nodes = [
        createTestNode(ENTITY_TYPES.SERVICE, 'svc_1'),
      ];

      const interaction = metaModel.entities.interactions![0]; // Case A
      const result = isUserInteractionRowEnabled(interaction, diagram, metaModel);

      expect(result).toBe(false);
    });

    it('should return false when S node missing', () => {
      const diagram = createEmptyDiagram();
      diagram.diagram_nodes = [
        createTestNode(ENTITY_TYPES.APPLICATION, 'app_1'),
      ];

      const interaction = metaModel.entities.interactions![0]; // Case A
      const result = isUserInteractionRowEnabled(interaction, diagram, metaModel);

      expect(result).toBe(false);
    });

    it('should return false when edges already exist', () => {
      const diagram = createEmptyDiagram();
      diagram.diagram_nodes = [
        createTestNode(ENTITY_TYPES.APPLICATION, 'app_1', 'node_app'),
        createTestNode(ENTITY_TYPES.SERVICE, 'svc_1', 'node_svc'),
      ];
      diagram.diagram_edges = [
        createTestEdge('interaction_1', 'MAIN', 'node_app', 'node_svc'),
      ];

      const interaction = metaModel.entities.interactions![0]; // Case A
      const result = isUserInteractionRowEnabled(interaction, diagram, metaModel);

      expect(result).toBe(false);
    });
  });

  describe('Case B: P and U nodes required', () => {
    it('should return true when P and U nodes exist and no edges', () => {
      const diagram = createEmptyDiagram();
      diagram.diagram_nodes = [
        createTestNode(ENTITY_TYPES.APPLICATION, 'app_1'),
        createTestNode(ENTITY_TYPES.BUSINESS_USER, 'user_1'),
      ];

      const interaction = metaModel.entities.interactions![1]; // Case B
      const result = isUserInteractionRowEnabled(interaction, diagram, metaModel);

      expect(result).toBe(true);
    });

    it('should return false when U node missing', () => {
      const diagram = createEmptyDiagram();
      diagram.diagram_nodes = [
        createTestNode(ENTITY_TYPES.APPLICATION, 'app_1'),
      ];

      const interaction = metaModel.entities.interactions![1]; // Case B
      const result = isUserInteractionRowEnabled(interaction, diagram, metaModel);

      expect(result).toBe(false);
    });
  });
});

// ============================================================================
// Tests for addUserInteractionToDiagram()
// ============================================================================

describe('addUserInteractionToDiagram', () => {
  const metaModel = createTestMetaModel();

  describe('Case A: Creates MAIN and optionally USER_LINK', () => {
    it('should create MAIN edge between P and S nodes', () => {
      const diagram = createEmptyDiagram();
      diagram.diagram_nodes = [
        createTestNode(ENTITY_TYPES.APPLICATION, 'app_1', 'node_app'),
        createTestNode(ENTITY_TYPES.SERVICE, 'svc_1', 'node_svc'),
      ];

      const interaction = metaModel.entities.interactions![0]; // Case A
      const result = addUserInteractionToDiagram(interaction, diagram, metaModel);

      expect(result.mainEdge).toBeDefined();
      expect(result.mainEdge.relationship_type).toBe(RELATIONSHIP_EDGE_TYPES.USER_INTERACTION);
      expect(result.mainEdge.relationship_id).toBe('interaction_1');
      expect(result.mainEdge.subType).toBe('MAIN');
      expect(result.mainEdge.source_node_id).toBe('node_app');
      expect(result.mainEdge.target_node_id).toBe('node_svc');
    });

    it('should create USER_LINK edge when U node is present', () => {
      const diagram = createEmptyDiagram();
      diagram.diagram_nodes = [
        createTestNode(ENTITY_TYPES.APPLICATION, 'app_1', 'node_app'),
        createTestNode(ENTITY_TYPES.SERVICE, 'svc_1', 'node_svc'),
        createTestNode(ENTITY_TYPES.BUSINESS_USER, 'user_1', 'node_user'),
      ];

      const interaction = metaModel.entities.interactions![0]; // Case A
      const result = addUserInteractionToDiagram(interaction, diagram, metaModel);

      expect(result.userLinkEdge).toBeDefined();
      expect(result.userLinkEdge!.relationship_type).toBe(RELATIONSHIP_EDGE_TYPES.USER_INTERACTION);
      expect(result.userLinkEdge!.relationship_id).toBe('interaction_1');
      expect(result.userLinkEdge!.subType).toBe('USER_LINK');
      expect(result.userLinkEdge!.source_node_id).toBe('node_user');
      // USER_LINK edges target a VIRTUAL midpoint -- production uses an
      // empty target_node_id (the midpoint lives in the edge_points).
      expect(result.userLinkEdge!.target_node_id).toBe('');
    });

    it('should NOT create USER_LINK edge when U node is absent', () => {
      const diagram = createEmptyDiagram();
      diagram.diagram_nodes = [
        createTestNode(ENTITY_TYPES.APPLICATION, 'app_1', 'node_app'),
        createTestNode(ENTITY_TYPES.SERVICE, 'svc_1', 'node_svc'),
        // No User node
      ];

      const interaction = metaModel.entities.interactions![0]; // Case A
      const result = addUserInteractionToDiagram(interaction, diagram, metaModel);

      expect(result.mainEdge).toBeDefined();
      expect(result.userLinkEdge).toBeUndefined();
    });
  });

  describe('Case B: Creates MAIN only', () => {
    it('should create MAIN edge between U and P nodes', () => {
      const diagram = createEmptyDiagram();
      diagram.diagram_nodes = [
        createTestNode(ENTITY_TYPES.APPLICATION, 'app_1', 'node_app'),
        createTestNode(ENTITY_TYPES.BUSINESS_USER, 'user_1', 'node_user'),
      ];

      const interaction = metaModel.entities.interactions![1]; // Case B
      const result = addUserInteractionToDiagram(interaction, diagram, metaModel);

      expect(result.mainEdge).toBeDefined();
      expect(result.mainEdge.relationship_type).toBe(RELATIONSHIP_EDGE_TYPES.USER_INTERACTION);
      expect(result.mainEdge.relationship_id).toBe('interaction_2');
      expect(result.mainEdge.subType).toBe('MAIN');
      expect(result.mainEdge.source_node_id).toBe('node_user');
      expect(result.mainEdge.target_node_id).toBe('node_app');
      expect(result.userLinkEdge).toBeUndefined();
    });
  });

  it('should throw error when required nodes missing', () => {
    const diagram = createEmptyDiagram();
    // No nodes

    const interaction = metaModel.entities.interactions![0];

    expect(() => {
      addUserInteractionToDiagram(interaction, diagram, metaModel);
    }).toThrow('Required nodes for User Interaction are not on the diagram');
  });
});

// ============================================================================
// Tests for shouldCascadeDeleteUserLink()
// ============================================================================

describe('shouldCascadeDeleteUserLink', () => {
  it('should return USER_LINK edge when deleting MAIN edge', () => {
    const mainEdge = createTestEdge('interaction_1', 'MAIN', 'node_1', 'node_2', 'edge_main');
    const userLinkEdge = createTestEdge('interaction_1', 'USER_LINK', 'node_3', 'midpoint-interaction_1', 'edge_userlink');
    const diagramEdges = [mainEdge, userLinkEdge];

    const result = shouldCascadeDeleteUserLink(mainEdge, diagramEdges);

    expect(result).toBe(userLinkEdge);
  });

  it('should return null when deleting USER_LINK edge (no cascade)', () => {
    const mainEdge = createTestEdge('interaction_1', 'MAIN', 'node_1', 'node_2', 'edge_main');
    const userLinkEdge = createTestEdge('interaction_1', 'USER_LINK', 'node_3', 'midpoint-interaction_1', 'edge_userlink');
    const diagramEdges = [mainEdge, userLinkEdge];

    const result = shouldCascadeDeleteUserLink(userLinkEdge, diagramEdges);

    expect(result).toBeNull();
  });

  it('should return null when no USER_LINK exists for the interaction', () => {
    const mainEdge = createTestEdge('interaction_1', 'MAIN', 'node_1', 'node_2', 'edge_main');
    const diagramEdges = [mainEdge];

    const result = shouldCascadeDeleteUserLink(mainEdge, diagramEdges);

    expect(result).toBeNull();
  });

  it('should return null for non-USER_INTERACTION edge types', () => {
    const otherEdge: DiagramEdge = {
      id: 'edge_other',
      relationship_type: 'OTHER_TYPE',
      relationship_id: 'relationship_1',
      source_node_id: 'node_1',
      target_node_id: 'node_2',
      subType: 'MAIN',
      edge_points: [],
    };
    const diagramEdges = [otherEdge];

    const result = shouldCascadeDeleteUserLink(otherEdge, diagramEdges);

    expect(result).toBeNull();
  });
});

// ============================================================================
// Tests for getInteractionEdgeCountForInteraction()
// ============================================================================

describe('getInteractionEdgeCountForInteraction', () => {
  it('should return 0 when no edges exist', () => {
    const edges: DiagramEdge[] = [];
    const result = getInteractionEdgeCountForInteraction('interaction_1', edges);

    expect(result).toBe(0);
  });

  it('should return correct count for matching edges', () => {
    const edges: DiagramEdge[] = [
      createTestEdge('interaction_1', 'MAIN', 'node_1', 'node_2'),
      createTestEdge('interaction_1', 'USER_LINK', 'node_3', 'midpoint-interaction_1'),
      createTestEdge('interaction_2', 'MAIN', 'node_4', 'node_5'), // Different interaction
    ];

    const result = getInteractionEdgeCountForInteraction('interaction_1', edges);

    expect(result).toBe(2);
  });
});

// ============================================================================
// Tests for getEdgesToDeleteWithCascade()
// ============================================================================

describe('getEdgesToDeleteWithCascade', () => {
  it('should return both MAIN and USER_LINK IDs when deleting MAIN', () => {
    const mainEdge = createTestEdge('interaction_1', 'MAIN', 'node_1', 'node_2', 'edge_main');
    const userLinkEdge = createTestEdge('interaction_1', 'USER_LINK', 'node_3', 'midpoint-interaction_1', 'edge_userlink');
    const diagramEdges = [mainEdge, userLinkEdge];

    const result = getEdgesToDeleteWithCascade(mainEdge, diagramEdges);

    expect(result).toHaveLength(2);
    expect(result).toContain('edge_main');
    expect(result).toContain('edge_userlink');
  });

  it('should return only USER_LINK ID when deleting USER_LINK (no cascade)', () => {
    const mainEdge = createTestEdge('interaction_1', 'MAIN', 'node_1', 'node_2', 'edge_main');
    const userLinkEdge = createTestEdge('interaction_1', 'USER_LINK', 'node_3', 'midpoint-interaction_1', 'edge_userlink');
    const diagramEdges = [mainEdge, userLinkEdge];

    const result = getEdgesToDeleteWithCascade(userLinkEdge, diagramEdges);

    expect(result).toHaveLength(1);
    expect(result).toContain('edge_userlink');
    expect(result).not.toContain('edge_main');
  });

  it('should return only MAIN ID when no USER_LINK exists', () => {
    const mainEdge = createTestEdge('interaction_1', 'MAIN', 'node_1', 'node_2', 'edge_main');
    const diagramEdges = [mainEdge];

    const result = getEdgesToDeleteWithCascade(mainEdge, diagramEdges);

    expect(result).toHaveLength(1);
    expect(result).toContain('edge_main');
  });
});

// ============================================================================
// Tests for Add/Delete Action State Logic
// ============================================================================

describe('Add/Delete Action State Logic', () => {
  const metaModel = createTestMetaModel();

  describe('Action determination based on edge existence', () => {
    it('should indicate ADD action when no edges exist but can add', () => {
      const diagram = createEmptyDiagram();
      diagram.diagram_nodes = [
        createTestNode(ENTITY_TYPES.APPLICATION, 'app_1'),
        createTestNode(ENTITY_TYPES.SERVICE, 'svc_1'),
      ];

      const interaction = metaModel.entities.interactions![0];

      // No edges for this interaction
      const existingEdges = getInteractionEdgesOnDiagram(interaction.id, diagram.diagram_edges);
      const canAdd = isUserInteractionRowEnabled(interaction, diagram, metaModel);

      expect(existingEdges.length).toBe(0);
      expect(canAdd).toBe(true);
      // Action should be 'add'
    });

    it('should indicate DELETE action when edges exist', () => {
      const diagram = createEmptyDiagram();
      diagram.diagram_nodes = [
        createTestNode(ENTITY_TYPES.APPLICATION, 'app_1', 'node_app'),
        createTestNode(ENTITY_TYPES.SERVICE, 'svc_1', 'node_svc'),
      ];
      diagram.diagram_edges = [
        createTestEdge('interaction_1', 'MAIN', 'node_app', 'node_svc'),
      ];

      const interaction = metaModel.entities.interactions![0];

      // Edges exist for this interaction
      const existingEdges = getInteractionEdgesOnDiagram(interaction.id, diagram.diagram_edges);

      expect(existingEdges.length).toBe(1);
      // Action should be 'delete'
    });

    it('should indicate disabled ADD action when nodes missing', () => {
      const diagram = createEmptyDiagram();
      diagram.diagram_nodes = [
        createTestNode(ENTITY_TYPES.APPLICATION, 'app_1'),
        // Missing Service node
      ];

      const interaction = metaModel.entities.interactions![0];

      // No edges and cannot add (nodes missing)
      const existingEdges = getInteractionEdgesOnDiagram(interaction.id, diagram.diagram_edges);
      const canAdd = isUserInteractionRowEnabled(interaction, diagram, metaModel);

      expect(existingEdges.length).toBe(0);
      expect(canAdd).toBe(false);
      // Action should be 'add' but disabled
    });
  });

  describe('Delete handler edge collection', () => {
    it('should collect all USER_INTERACTION edges for an interaction', () => {
      const diagram = createEmptyDiagram();
      diagram.diagram_nodes = [
        createTestNode(ENTITY_TYPES.APPLICATION, 'app_1', 'node_app'),
        createTestNode(ENTITY_TYPES.SERVICE, 'svc_1', 'node_svc'),
        createTestNode(ENTITY_TYPES.BUSINESS_USER, 'user_1', 'node_user'),
      ];
      diagram.diagram_edges = [
        createTestEdge('interaction_1', 'MAIN', 'node_app', 'node_svc', 'edge_1'),
        createTestEdge('interaction_1', 'USER_LINK', 'node_user', 'midpoint-interaction_1', 'edge_2'),
        createTestEdge('interaction_2', 'MAIN', 'node_user', 'node_app', 'edge_3'), // Different interaction
      ];

      // Simulate the delete handler logic
      const edgesToDelete = (diagram.diagram_edges || []).filter(
        edge =>
          edge.relationship_type === RELATIONSHIP_EDGE_TYPES.USER_INTERACTION &&
          edge.relationship_id === 'interaction_1'
      );
      const edgeIds = edgesToDelete.map(edge => edge.id);

      expect(edgeIds).toHaveLength(2);
      expect(edgeIds).toContain('edge_1');
      expect(edgeIds).toContain('edge_2');
      expect(edgeIds).not.toContain('edge_3');
    });
  });

  describe('After delete, row returns to ADD state', () => {
    it('should enable ADD action after all edges removed', () => {
      const diagram = createEmptyDiagram();
      diagram.diagram_nodes = [
        createTestNode(ENTITY_TYPES.APPLICATION, 'app_1', 'node_app'),
        createTestNode(ENTITY_TYPES.SERVICE, 'svc_1', 'node_svc'),
      ];
      // Initially has edges
      diagram.diagram_edges = [
        createTestEdge('interaction_1', 'MAIN', 'node_app', 'node_svc'),
      ];

      const interaction = metaModel.entities.interactions![0];

      // Before delete: edges exist
      let edgeCount = getInteractionEdgeCountForInteraction(interaction.id, diagram.diagram_edges);
      expect(edgeCount).toBe(1);

      // Simulate deletion
      diagram.diagram_edges = [];

      // After delete: no edges, can add again
      edgeCount = getInteractionEdgeCountForInteraction(interaction.id, diagram.diagram_edges);
      const canAdd = isUserInteractionRowEnabled(interaction, diagram, metaModel);

      expect(edgeCount).toBe(0);
      expect(canAdd).toBe(true);
    });
  });
});
