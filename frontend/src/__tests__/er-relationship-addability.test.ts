/**
 * ER Relationship Addability Tests
 * Spec: Fix ER Relationship Addability
 *
 * Tests for ensuring LogicalDataEntityRelationship rows become enabled
 * when their endpoints are on the canvas, using the new dataEntityPointId
 * format (dep_log_<id> and dep_phy_<id>).
 *
 * Task Group 1: Tests for isLogicalEREnabledWithSets() functionality
 * Task Group 2: Tests for getLogicalERNodes() functionality
 * Task Group 3: Tests for edge creation integration
 * Task Group 4: Additional strategic tests for gap coverage
 */

import { describe, it, expect } from 'vitest';
import {
  DiagramNode,
  MetaModel,
  LogicalDataEntityRelationship,
  ENTITY_TYPES,
  RELATIONSHIP_EDGE_TYPES,
} from '../types/model';
import {
  isRelationshipRowEnabled,
  getRelationshipEligibility,
  getLogicalERNodes,
  getEntitiesOnDiagram,
  createRelationshipEdge,
  findNodeForEntity,
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
      business_users: [],
      business_processes: [],
      process_activities: [],
      business_points: [],
      applications: [],
      app_components: [],
      services: [],
      interfaces: [],
      endpoints: [],
      classes: [],
      methods: [],
      application_points: [],
      logical_data_entities: [
        { id: 'log-entity-A', name: 'Logical Entity A', description: '', tags: '' },
        { id: 'log-entity-B', name: 'Logical Entity B', description: '', tags: '' },
        { id: 'log-entity-C', name: 'Logical Entity C', description: '', tags: '' },
        { id: 'log-entity-D', name: 'Logical Entity D', description: '', tags: '' },
        { id: 'log-entity-E', name: 'Logical Entity E', description: '', tags: '' },
      ],
      logical_data_attributes: [],
      physical_data_entities: [
        { id: 'phy-entity-A', name: 'Physical Entity A', description: '', physical_type: 'TABLE', database: 'postgres', tags: '' },
        { id: 'phy-entity-B', name: 'Physical Entity B', description: '', physical_type: 'TABLE', database: 'postgres', tags: '' },
        { id: 'phy-entity-F', name: 'Physical Entity F', description: '', physical_type: 'TABLE', database: 'postgres', tags: '' },
        { id: 'phy-entity-D', name: 'Physical Entity D', description: '', physical_type: 'TABLE', database: 'postgres', tags: '' },
      ],
      physical_data_attributes: [],
      events: [],
      states: [],
      state_transitions: [],
      activities: [],
      activity_flows: [],
      activity_partitions: [],
      interactions: [],
      app_business_points: [],
      business_logics: [],
      ui_screens: [],
      ui_components: [],
      ui_actions: [],
      package_sets: [],
      packages: [],
    },
    relationships: {
      business_user_business_points: [],
      application_point_business_points: [],
      application_point_business_logics: [],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      interface_logical_entities: [],
      ui_workflow_transitions: [],
    },
  };
}

/**
 * Create a diagram node for testing
 */
function createTestNode(
  id: string,
  entityType: string,
  entityId: string,
  posX: number = 100,
  posY: number = 100
): DiagramNode {
  return {
    id,
    entity_type: entityType,
    entity_id: entityId,
    pos_x: posX,
    pos_y: posY,
    width: 150,
    height: 100,
    parent_node_id: null,
  };
}

/**
 * Create a LogicalDataEntityRelationship using dataEntityPointId format
 */
function createTestRelationship(
  id: string,
  fromDataEntityPointId: string,
  toDataEntityPointId: string
): LogicalDataEntityRelationship {
  return {
    id,
    fromDataEntityPointId,
    toDataEntityPointId,
    cardinality: 'ONE_TO_MANY',
    relationship: 'ASSOCIATION',
    description: 'Test relationship',
    tags: '',
  };
}

// ============================================================================
// Task Group 1: Tests for isLogicalEREnabledWithSets() functionality
// ============================================================================

describe('Task Group 1: isLogicalEREnabledWithSets() functionality', () => {
  describe('Addability check with dataEntityPointId format', () => {
    it('1.1.1: Physical-to-physical relationship enabled when both endpoints on diagram (dep_phy_A, dep_phy_B)', () => {
      // Arrange
      const metaModel = createTestMetaModel();
      const diagramNodes: DiagramNode[] = [
        createTestNode('node-phy-A', ENTITY_TYPES.PHYSICAL_DATA_ENTITY, 'phy-entity-A', 100, 100),
        createTestNode('node-phy-B', ENTITY_TYPES.PHYSICAL_DATA_ENTITY, 'phy-entity-B', 400, 100),
      ];
      const relationship = createTestRelationship(
        'rel-phy-phy-1',
        'dep_phy_phy-entity-A',
        'dep_phy_phy-entity-B'
      );

      // Act
      const result = getRelationshipEligibility(
        relationship,
        'logical_data_entity_relationships',
        diagramNodes,
        metaModel
      );

      // Assert
      expect(result.enabled).toBe(true);
      expect(result.disabledReason).toBeNull();
    });

    it('1.1.2: Logical-to-logical relationship enabled when both endpoints on diagram (dep_log_C, dep_log_D)', () => {
      // Arrange
      const metaModel = createTestMetaModel();
      const diagramNodes: DiagramNode[] = [
        createTestNode('node-log-C', ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'log-entity-C', 100, 100),
        createTestNode('node-log-D', ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'log-entity-D', 400, 100),
      ];
      const relationship = createTestRelationship(
        'rel-log-log-1',
        'dep_log_log-entity-C',
        'dep_log_log-entity-D'
      );

      // Act
      const result = getRelationshipEligibility(
        relationship,
        'logical_data_entity_relationships',
        diagramNodes,
        metaModel
      );

      // Assert
      expect(result.enabled).toBe(true);
      expect(result.disabledReason).toBeNull();
    });

    it('1.1.3: Cross-kind logical-to-physical relationship enabled when both endpoints on diagram (dep_log_E, dep_phy_F)', () => {
      // Arrange
      const metaModel = createTestMetaModel();
      const diagramNodes: DiagramNode[] = [
        createTestNode('node-log-E', ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'log-entity-E', 100, 100),
        createTestNode('node-phy-F', ENTITY_TYPES.PHYSICAL_DATA_ENTITY, 'phy-entity-F', 400, 100),
      ];
      const relationship = createTestRelationship(
        'rel-log-phy-1',
        'dep_log_log-entity-E',
        'dep_phy_phy-entity-F'
      );

      // Act
      const result = getRelationshipEligibility(
        relationship,
        'logical_data_entity_relationships',
        diagramNodes,
        metaModel
      );

      // Assert
      expect(result.enabled).toBe(true);
      expect(result.disabledReason).toBeNull();
    });

    it('1.1.4: Relationship disabled when one endpoint missing from diagram', () => {
      // Arrange
      const metaModel = createTestMetaModel();
      const diagramNodes: DiagramNode[] = [
        // Only one entity on diagram
        createTestNode('node-log-A', ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'log-entity-A', 100, 100),
      ];
      const relationship = createTestRelationship(
        'rel-missing-1',
        'dep_log_log-entity-A',
        'dep_log_log-entity-B' // log-entity-B is NOT on diagram
      );

      // Act
      const result = getRelationshipEligibility(
        relationship,
        'logical_data_entity_relationships',
        diagramNodes,
        metaModel
      );

      // Assert
      expect(result.enabled).toBe(false);
      expect(result.disabledReason).toBe('endpoints_missing');
    });

    it('1.1.5: Relationship disabled when dataEntityPointId has invalid format (returns null from parser)', () => {
      // Arrange
      const metaModel = createTestMetaModel();
      const diagramNodes: DiagramNode[] = [
        createTestNode('node-log-A', ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'log-entity-A', 100, 100),
        createTestNode('node-log-B', ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'log-entity-B', 400, 100),
      ];
      // Invalid format - missing dep_ prefix
      const relationship = createTestRelationship(
        'rel-invalid-1',
        'invalid_format_A',
        'dep_log_log-entity-B'
      );

      // Act
      const result = getRelationshipEligibility(
        relationship,
        'logical_data_entity_relationships',
        diagramNodes,
        metaModel
      );

      // Assert
      expect(result.enabled).toBe(false);
      expect(result.disabledReason).toBe('endpoints_missing');
    });
  });
});

// ============================================================================
// Task Group 2: Tests for getLogicalERNodes() functionality
// ============================================================================

describe('Task Group 2: getLogicalERNodes() functionality', () => {
  describe('Node resolution with dataEntityPointId format', () => {
    it('2.1.1: Returns correct diagram nodes for physical-to-physical relationship (dep_phy_A, dep_phy_B)', () => {
      // Arrange
      const diagramNodes: DiagramNode[] = [
        createTestNode('node-phy-A', ENTITY_TYPES.PHYSICAL_DATA_ENTITY, 'phy-entity-A', 100, 100),
        createTestNode('node-phy-B', ENTITY_TYPES.PHYSICAL_DATA_ENTITY, 'phy-entity-B', 400, 100),
      ];
      const relationship = createTestRelationship(
        'rel-phy-phy-1',
        'dep_phy_phy-entity-A',
        'dep_phy_phy-entity-B'
      );

      // Act
      const result = getLogicalERNodes(relationship, diagramNodes);

      // Assert
      expect(result).not.toBeNull();
      expect(result!.sourceNode.id).toBe('node-phy-A');
      expect(result!.sourceNode.entity_id).toBe('phy-entity-A');
      expect(result!.targetNode.id).toBe('node-phy-B');
      expect(result!.targetNode.entity_id).toBe('phy-entity-B');
    });

    it('2.1.2: Returns correct diagram nodes for cross-kind relationship (dep_log_C, dep_phy_D)', () => {
      // Arrange
      const diagramNodes: DiagramNode[] = [
        createTestNode('node-log-C', ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'log-entity-C', 100, 100),
        createTestNode('node-phy-D', ENTITY_TYPES.PHYSICAL_DATA_ENTITY, 'phy-entity-D', 400, 100),
      ];
      const relationship = createTestRelationship(
        'rel-log-phy-1',
        'dep_log_log-entity-C',
        'dep_phy_phy-entity-D'
      );

      // Act
      const result = getLogicalERNodes(relationship, diagramNodes);

      // Assert
      expect(result).not.toBeNull();
      expect(result!.sourceNode.id).toBe('node-log-C');
      expect(result!.sourceNode.entity_type).toBe(ENTITY_TYPES.LOGICAL_DATA_ENTITY);
      expect(result!.targetNode.id).toBe('node-phy-D');
      expect(result!.targetNode.entity_type).toBe(ENTITY_TYPES.PHYSICAL_DATA_ENTITY);
    });

    it('2.1.3: Returns null when dataEntityPointId parse fails', () => {
      // Arrange
      const diagramNodes: DiagramNode[] = [
        createTestNode('node-log-A', ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'log-entity-A', 100, 100),
        createTestNode('node-log-B', ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'log-entity-B', 400, 100),
      ];
      // Invalid format - no valid prefix
      const relationship = createTestRelationship(
        'rel-invalid-1',
        'raw_entity_id_without_prefix',
        'dep_log_log-entity-B'
      );

      // Act
      const result = getLogicalERNodes(relationship, diagramNodes);

      // Assert
      expect(result).toBeNull();
    });

    it('2.1.4: Returns null when node not found on diagram', () => {
      // Arrange
      const diagramNodes: DiagramNode[] = [
        // Only one node on diagram
        createTestNode('node-log-A', ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'log-entity-A', 100, 100),
      ];
      const relationship = createTestRelationship(
        'rel-missing-1',
        'dep_log_log-entity-A',
        'dep_log_log-entity-B' // log-entity-B is NOT on diagram
      );

      // Act
      const result = getLogicalERNodes(relationship, diagramNodes);

      // Assert
      expect(result).toBeNull();
    });
  });
});

// ============================================================================
// Task Group 3: Edge Creation Integration Tests
// ============================================================================

describe('Task Group 3: Edge creation integration', () => {
  describe('Edge source_node_id and target_node_id verification', () => {
    it('3.1.1: edge.source_node_id references diagram node ID (not dep_* string)', () => {
      // Arrange
      const diagramNodes: DiagramNode[] = [
        createTestNode('node-log-A', ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'log-entity-A', 100, 100),
        createTestNode('node-log-B', ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'log-entity-B', 400, 100),
      ];
      const relationship = createTestRelationship(
        'rel-log-log-1',
        'dep_log_log-entity-A',
        'dep_log_log-entity-B'
      );

      // Act
      const nodes = getLogicalERNodes(relationship, diagramNodes);
      expect(nodes).not.toBeNull();

      const edge = createRelationshipEdge(
        relationship,
        RELATIONSHIP_EDGE_TYPES.LOGICAL_DATA_ENTITY_RELATIONSHIP,
        nodes!.sourceNode,
        nodes!.targetNode,
        { multiplicityType: relationship.cardinality }
      );

      // Assert
      expect(edge.source_node_id).toBe('node-log-A');
      expect(edge.source_node_id).not.toContain('dep_');
      expect(edge.source_node_id).not.toBe('dep_log_log-entity-A');
    });

    it('3.1.2: edge.target_node_id references diagram node ID (not dep_* string)', () => {
      // Arrange
      const diagramNodes: DiagramNode[] = [
        createTestNode('node-phy-A', ENTITY_TYPES.PHYSICAL_DATA_ENTITY, 'phy-entity-A', 100, 100),
        createTestNode('node-phy-B', ENTITY_TYPES.PHYSICAL_DATA_ENTITY, 'phy-entity-B', 400, 100),
      ];
      const relationship = createTestRelationship(
        'rel-phy-phy-1',
        'dep_phy_phy-entity-A',
        'dep_phy_phy-entity-B'
      );

      // Act
      const nodes = getLogicalERNodes(relationship, diagramNodes);
      expect(nodes).not.toBeNull();

      const edge = createRelationshipEdge(
        relationship,
        RELATIONSHIP_EDGE_TYPES.LOGICAL_DATA_ENTITY_RELATIONSHIP,
        nodes!.sourceNode,
        nodes!.targetNode
      );

      // Assert
      expect(edge.target_node_id).toBe('node-phy-B');
      expect(edge.target_node_id).not.toContain('dep_');
      expect(edge.target_node_id).not.toBe('dep_phy_phy-entity-B');
    });

    it('3.1.3: Created edge attaches to existing entity nodes', () => {
      // Arrange
      const metaModel = createTestMetaModel();
      const diagramNodes: DiagramNode[] = [
        createTestNode('node-log-C', ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'log-entity-C', 100, 100),
        createTestNode('node-phy-F', ENTITY_TYPES.PHYSICAL_DATA_ENTITY, 'phy-entity-F', 400, 100),
      ];
      const relationship = createTestRelationship(
        'rel-cross-1',
        'dep_log_log-entity-C',
        'dep_phy_phy-entity-F'
      );

      // Act
      const nodes = getLogicalERNodes(relationship, diagramNodes);
      expect(nodes).not.toBeNull();

      const edge = createRelationshipEdge(
        relationship,
        RELATIONSHIP_EDGE_TYPES.LOGICAL_DATA_ENTITY_RELATIONSHIP,
        nodes!.sourceNode,
        nodes!.targetNode
      );

      // Assert - Verify edge references diagram node IDs that exist in diagramNodes
      const sourceNodeExists = diagramNodes.some(n => n.id === edge.source_node_id);
      const targetNodeExists = diagramNodes.some(n => n.id === edge.target_node_id);

      expect(sourceNodeExists).toBe(true);
      expect(targetNodeExists).toBe(true);
      expect(edge.source_node_id).toBe('node-log-C');
      expect(edge.target_node_id).toBe('node-phy-F');
    });
  });
});

// ============================================================================
// Task Group 4: Additional Strategic Tests (Gap Analysis)
// ============================================================================

describe('Task Group 4: Additional strategic tests', () => {
  it('4.3.1: isRelationshipRowEnabled returns boolean correctly for enabled relationship', () => {
    // Arrange
    const metaModel = createTestMetaModel();
    const diagramNodes: DiagramNode[] = [
      createTestNode('node-log-A', ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'log-entity-A', 100, 100),
      createTestNode('node-log-B', ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'log-entity-B', 400, 100),
    ];
    const relationship = createTestRelationship(
      'rel-1',
      'dep_log_log-entity-A',
      'dep_log_log-entity-B'
    );

    // Act
    const enabled = isRelationshipRowEnabled(
      relationship,
      'logical_data_entity_relationships',
      diagramNodes,
      metaModel
    );

    // Assert
    expect(enabled).toBe(true);
  });

  it('4.3.2: getEntitiesOnDiagram correctly populates both logical and physical sets', () => {
    // Arrange
    const metaModel = createTestMetaModel();
    const diagramNodes: DiagramNode[] = [
      createTestNode('node-log-A', ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'log-entity-A', 100, 100),
      createTestNode('node-phy-A', ENTITY_TYPES.PHYSICAL_DATA_ENTITY, 'phy-entity-A', 400, 100),
    ];

    // Act
    const entities = getEntitiesOnDiagram(metaModel, { diagram_nodes: diagramNodes });

    // Assert
    expect(entities.logicalDataEntitiesOnDiagram.has('log-entity-A')).toBe(true);
    expect(entities.physicalDataEntitiesOnDiagram.has('phy-entity-A')).toBe(true);
  });

  it('4.3.3: Physical-to-logical cross-kind relationship (reversed direction) works correctly', () => {
    // Arrange - Physical entity as source, logical entity as target
    const metaModel = createTestMetaModel();
    const diagramNodes: DiagramNode[] = [
      createTestNode('node-phy-A', ENTITY_TYPES.PHYSICAL_DATA_ENTITY, 'phy-entity-A', 100, 100),
      createTestNode('node-log-A', ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'log-entity-A', 400, 100),
    ];
    const relationship = createTestRelationship(
      'rel-phy-to-log-1',
      'dep_phy_phy-entity-A', // Physical as source
      'dep_log_log-entity-A'  // Logical as target
    );

    // Act
    const result = getRelationshipEligibility(
      relationship,
      'logical_data_entity_relationships',
      diagramNodes,
      metaModel
    );
    const nodes = getLogicalERNodes(relationship, diagramNodes);

    // Assert
    expect(result.enabled).toBe(true);
    expect(nodes).not.toBeNull();
    expect(nodes!.sourceNode.entity_type).toBe(ENTITY_TYPES.PHYSICAL_DATA_ENTITY);
    expect(nodes!.targetNode.entity_type).toBe(ENTITY_TYPES.LOGICAL_DATA_ENTITY);
  });

  it('4.3.4: Relationship with empty dataEntityPointId is disabled', () => {
    // Arrange
    const metaModel = createTestMetaModel();
    const diagramNodes: DiagramNode[] = [
      createTestNode('node-log-A', ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'log-entity-A', 100, 100),
    ];
    // Empty fromDataEntityPointId
    const relationship: LogicalDataEntityRelationship = {
      id: 'rel-empty-1',
      fromDataEntityPointId: '',
      toDataEntityPointId: 'dep_log_log-entity-A',
      cardinality: 'ONE_TO_ONE',
      description: '',
      tags: '',
    };

    // Act
    const result = getRelationshipEligibility(
      relationship,
      'logical_data_entity_relationships',
      diagramNodes,
      metaModel
    );

    // Assert
    expect(result.enabled).toBe(false);
    expect(result.disabledReason).toBe('endpoints_missing');
  });

  it('4.3.5: findNodeForEntity works correctly for both entity types', () => {
    // Arrange
    const diagramNodes: DiagramNode[] = [
      createTestNode('node-log-X', ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'log-X', 100, 100),
      createTestNode('node-phy-Y', ENTITY_TYPES.PHYSICAL_DATA_ENTITY, 'phy-Y', 400, 100),
    ];

    // Act
    const logicalNode = findNodeForEntity(diagramNodes, ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'log-X');
    const physicalNode = findNodeForEntity(diagramNodes, ENTITY_TYPES.PHYSICAL_DATA_ENTITY, 'phy-Y');
    const missingNode = findNodeForEntity(diagramNodes, ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'not-exists');

    // Assert
    expect(logicalNode).toBeDefined();
    expect(logicalNode!.id).toBe('node-log-X');
    expect(physicalNode).toBeDefined();
    expect(physicalNode!.id).toBe('node-phy-Y');
    expect(missingNode).toBeUndefined();
  });
});
