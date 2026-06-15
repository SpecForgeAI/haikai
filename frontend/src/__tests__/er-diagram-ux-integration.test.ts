/**
 * ER Diagram UX Integration Tests
 * Task Group 7: Integration tests for the complete ER Diagram UX Enhancements feature
 *
 * These tests verify end-to-end workflows and integration between components:
 * - Modal -> relationship creation -> edge on diagram
 * - Delete edge from context menu -> verify meta-model unchanged
 * - Update entity name in Meta-Model -> verify ERD node updates
 * - Change cardinality -> verify label updates
 * - Change relationship type -> verify symbol changes
 * - Multiple ER edges with different relationship types
 * - Auto-add missing nodes when creating relationship
 */

import { describe, it, expect } from 'vitest';
import {
  DiagramNode,
  DiagramEdge,
  MetaModel,
  LogicalDataEntityRelationship,
  ENTITY_TYPES,
  RELATIONSHIP_EDGE_TYPES,
  LogicalERCardinality,
  LogicalERRelationship,
} from '../types/model';
import { generatePrefixedId } from '../utils/idGenerator';
import {
  isLogicalEREdgeOnDiagram,
  getMultiplicityLabels,
  createRelationshipEdge,
  getPolymorphicLogicalERNodes,
  calculateEdgePoints,
  getEntityTypeForLogicalERKind,
} from '../utils/relationshipUtils';
import {
  getEREdgeSymbols,
  getSymbolRenderData,
  getEREdgeStrokeDasharray,
  calculateEdgeAngle,
} from '../utils/erEdgeSymbols';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create a comprehensive mock MetaModel for integration testing
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
        { id: 'lde-customer', name: 'Customer', description: 'Customer entity', tags: '' },
        { id: 'lde-order', name: 'Order', description: 'Order entity', tags: '' },
        { id: 'lde-product', name: 'Product', description: 'Product entity', tags: '' },
        { id: 'lde-address', name: 'Address', description: 'Address entity', tags: '' },
      ],
      logical_data_attributes: [
        { id: 'lda-1', name: 'customer_id', description: '', logical_entity_id: 'lde-customer', data_type: 'integer', is_primary_key: true, is_nullable: false, tags: '' },
        { id: 'lda-2', name: 'customer_name', description: '', logical_entity_id: 'lde-customer', data_type: 'string', is_primary_key: false, is_nullable: false, tags: '' },
      ],
      physical_data_entities: [
        { id: 'pde-customers', name: 'customers_table', description: '', physical_type: 'TABLE', database: 'postgres', tags: '' },
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
    },
    relationships: {
      business_user_business_points: [],
      application_point_business_points: [],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      interface_logical_entities: [],
    },
  };
}

/**
 * Create diagram nodes for testing
 */
function createTestDiagramNodes(): DiagramNode[] {
  return [
    {
      id: 'node-customer',
      entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
      entity_id: 'lde-customer',
      pos_x: 100,
      pos_y: 100,
      width: 150,
      height: 100,
      z_index: 1,
      parent_node_id: null,
    },
    {
      id: 'node-order',
      entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
      entity_id: 'lde-order',
      pos_x: 400,
      pos_y: 100,
      width: 150,
      height: 100,
      z_index: 2,
      parent_node_id: null,
    },
  ];
}

/**
 * Create a LogicalDataEntityRelationship for testing
 */
function createTestRelationship(
  id: string,
  fromEntityId: string,
  toEntityId: string,
  cardinality: LogicalERCardinality = 'ONE_TO_MANY',
  relationship: LogicalERRelationship = 'ASSOCIATION'
): LogicalDataEntityRelationship {
  return {
    id,
    // Legacy from_ref_*/to_ref_* columns were removed -- rows carry
    // Data Entity Point IDs (dep_log_/dep_phy_ prefixed) now.
    fromDataEntityPointId: `dep_log_${fromEntityId}`,
    toDataEntityPointId: `dep_log_${toEntityId}`,
    cardinality,
    relationship,
    description: `Relationship from ${fromEntityId} to ${toEntityId}`,
    tags: '',
  };
}

/**
 * Simulate the Create & Add workflow
 * This function replicates what happens when user fills modal and clicks Create & Add
 */
function simulateCreateAndAddFlow(
  metaModel: MetaModel,
  diagram: { diagram_nodes: DiagramNode[]; diagram_edges: DiagramEdge[] },
  formData: {
    fromKind: 'LOGICAL_ENTITY' | 'PHYSICAL_ENTITY';
    fromEntity: string;
    toKind: 'LOGICAL_ENTITY' | 'PHYSICAL_ENTITY';
    toEntity: string;
    cardinality: LogicalERCardinality;
    relationship: LogicalERRelationship;
    description: string;
  }
): {
  relationship: LogicalDataEntityRelationship;
  edge: DiagramEdge | null;
  addedNodes: DiagramNode[];
} {
  // Step 1: Create relationship in meta-model
  const relationship: LogicalDataEntityRelationship = {
    id: generatePrefixedId('ler'),
    from_ref_kind: formData.fromKind,
    from_ref_id: formData.fromEntity,
    to_ref_kind: formData.toKind,
    to_ref_id: formData.toEntity,
    cardinality: formData.cardinality,
    relationship: formData.relationship,
    description: formData.description,
    tags: '',
  };

  // Add to meta-model
  metaModel.relationships.logical_data_entity_relationships.push(relationship);

  // Step 2: Find or create endpoint nodes
  const addedNodes: DiagramNode[] = [];

  // Check if source node exists
  const fromEntityType = getEntityTypeForLogicalERKind(formData.fromKind);
  let sourceNode = diagram.diagram_nodes.find(
    n => n.entity_type === fromEntityType && n.entity_id === formData.fromEntity
  );

  if (!sourceNode) {
    // Auto-add source node
    sourceNode = {
      id: generatePrefixedId('node'),
      entity_type: fromEntityType,
      entity_id: formData.fromEntity,
      pos_x: 100,
      pos_y: 200,
      width: 150,
      height: 100,
      z_index: diagram.diagram_nodes.length + 1,
      parent_node_id: null,
    };
    addedNodes.push(sourceNode);
    diagram.diagram_nodes.push(sourceNode);
  }

  // Check if target node exists
  const toEntityType = getEntityTypeForLogicalERKind(formData.toKind);
  let targetNode = diagram.diagram_nodes.find(
    n => n.entity_type === toEntityType && n.entity_id === formData.toEntity
  );

  if (!targetNode) {
    // Auto-add target node
    targetNode = {
      id: generatePrefixedId('node'),
      entity_type: toEntityType,
      entity_id: formData.toEntity,
      pos_x: 400,
      pos_y: 200,
      width: 150,
      height: 100,
      z_index: diagram.diagram_nodes.length + 1,
      parent_node_id: null,
    };
    addedNodes.push(targetNode);
    diagram.diagram_nodes.push(targetNode);
  }

  // Step 3: Create edge
  const edge = createRelationshipEdge(
    relationship,
    RELATIONSHIP_EDGE_TYPES.LOGICAL_DATA_ENTITY_RELATIONSHIP,
    sourceNode,
    targetNode,
    { multiplicityType: relationship.cardinality }
  );

  diagram.diagram_edges.push(edge);

  return { relationship, edge, addedNodes };
}

/**
 * Simulate deleting an edge from context menu
 * This should only remove the edge, not the meta-model relationship
 */
function simulateDeleteEdgeFromContextMenu(
  metaModel: MetaModel,
  diagram: { diagram_nodes: DiagramNode[]; diagram_edges: DiagramEdge[] },
  relationshipId: string
): { edgeDeleted: boolean; relationshipStillExists: boolean } {
  // Find the edge to delete
  const edgeIndex = diagram.diagram_edges.findIndex(
    e => e.relationship_type === RELATIONSHIP_EDGE_TYPES.LOGICAL_DATA_ENTITY_RELATIONSHIP &&
         e.relationship_id === relationshipId
  );

  const edgeDeleted = edgeIndex !== -1;
  if (edgeDeleted) {
    diagram.diagram_edges.splice(edgeIndex, 1);
  }

  // Verify relationship still exists in meta-model
  const relationshipStillExists = metaModel.relationships.logical_data_entity_relationships.some(
    r => r.id === relationshipId
  );

  return { edgeDeleted, relationshipStillExists };
}

// ============================================================================
// Integration Test: E2E Create & Add Flow
// ============================================================================

describe('E2E: Complete flow from "+ New Logical ER" to edge on canvas', () => {
  it('should create relationship in meta-model and add edge to diagram', () => {
    const metaModel = createTestMetaModel();
    const diagram = {
      diagram_nodes: createTestDiagramNodes(),
      diagram_edges: [] as DiagramEdge[],
    };

    const formData = {
      fromKind: 'LOGICAL_ENTITY' as const,
      fromEntity: 'lde-customer',
      toKind: 'LOGICAL_ENTITY' as const,
      toEntity: 'lde-order',
      cardinality: 'ONE_TO_MANY' as LogicalERCardinality,
      relationship: 'ASSOCIATION' as LogicalERRelationship,
      description: 'Customer places Orders',
    };

    const result = simulateCreateAndAddFlow(metaModel, diagram, formData);

    // Verify relationship was added to meta-model
    expect(metaModel.relationships.logical_data_entity_relationships).toHaveLength(1);
    expect(metaModel.relationships.logical_data_entity_relationships[0].from_ref_id).toBe('lde-customer');
    expect(metaModel.relationships.logical_data_entity_relationships[0].to_ref_id).toBe('lde-order');

    // Verify edge was added to diagram
    expect(diagram.diagram_edges).toHaveLength(1);
    expect(diagram.diagram_edges[0].relationship_type).toBe(RELATIONSHIP_EDGE_TYPES.LOGICAL_DATA_ENTITY_RELATIONSHIP);
    expect(diagram.diagram_edges[0].relationship_id).toBe(result.relationship.id);

    // Verify no new nodes were added (both endpoints existed)
    expect(result.addedNodes).toHaveLength(0);

    // Verify edge has cardinality labels
    expect(diagram.diagram_edges[0].source_label_text).toBe('1');
    expect(diagram.diagram_edges[0].target_label_text).toBe('m');
  });

  it('should set correct cardinality labels based on form selection', () => {
    const metaModel = createTestMetaModel();
    const diagram = {
      diagram_nodes: createTestDiagramNodes(),
      diagram_edges: [] as DiagramEdge[],
    };

    const testCases: Array<{ cardinality: LogicalERCardinality; expectedSource: string; expectedTarget: string }> = [
      { cardinality: 'ONE_TO_ONE', expectedSource: '1', expectedTarget: '1' },
      { cardinality: 'ONE_TO_MANY', expectedSource: '1', expectedTarget: 'm' },
      { cardinality: 'MANY_TO_ONE', expectedSource: 'm', expectedTarget: '1' },
      { cardinality: 'MANY_TO_MANY', expectedSource: 'm', expectedTarget: 'm' },
    ];

    for (const testCase of testCases) {
      // Reset diagram edges
      diagram.diagram_edges = [];

      const formData = {
        fromKind: 'LOGICAL_ENTITY' as const,
        fromEntity: 'lde-customer',
        toKind: 'LOGICAL_ENTITY' as const,
        toEntity: 'lde-order',
        cardinality: testCase.cardinality,
        relationship: 'ASSOCIATION' as LogicalERRelationship,
        description: '',
      };

      simulateCreateAndAddFlow(metaModel, diagram, formData);

      expect(diagram.diagram_edges[0].source_label_text).toBe(testCase.expectedSource);
      expect(diagram.diagram_edges[0].target_label_text).toBe(testCase.expectedTarget);
    }
  });
});

// ============================================================================
// Integration Test: Delete Edge from Context Menu
// ============================================================================

describe('E2E: Delete edge from context menu, verify meta-model unchanged', () => {
  it('should remove edge from diagram but preserve meta-model relationship', () => {
    const metaModel = createTestMetaModel();
    const diagram = {
      diagram_nodes: createTestDiagramNodes(),
      diagram_edges: [] as DiagramEdge[],
    };

    // First, create a relationship and add edge
    const formData = {
      fromKind: 'LOGICAL_ENTITY' as const,
      fromEntity: 'lde-customer',
      toKind: 'LOGICAL_ENTITY' as const,
      toEntity: 'lde-order',
      cardinality: 'ONE_TO_MANY' as LogicalERCardinality,
      relationship: 'ASSOCIATION' as LogicalERRelationship,
      description: 'Customer places Orders',
    };

    const { relationship } = simulateCreateAndAddFlow(metaModel, diagram, formData);

    // Verify initial state
    expect(diagram.diagram_edges).toHaveLength(1);
    expect(metaModel.relationships.logical_data_entity_relationships).toHaveLength(1);

    // Now simulate delete from context menu
    const result = simulateDeleteEdgeFromContextMenu(metaModel, diagram, relationship.id);

    // Verify edge was deleted
    expect(result.edgeDeleted).toBe(true);
    expect(diagram.diagram_edges).toHaveLength(0);

    // Verify meta-model relationship still exists
    expect(result.relationshipStillExists).toBe(true);
    expect(metaModel.relationships.logical_data_entity_relationships).toHaveLength(1);
    expect(metaModel.relationships.logical_data_entity_relationships[0].id).toBe(relationship.id);

    // Verify edge is no longer on diagram
    expect(isLogicalEREdgeOnDiagram(relationship.id, diagram.diagram_edges)).toBe(false);
  });

  it('should allow re-adding same relationship after delete', () => {
    const metaModel = createTestMetaModel();
    const diagram = {
      diagram_nodes: createTestDiagramNodes(),
      diagram_edges: [] as DiagramEdge[],
    };

    // Create and add relationship
    const relationship = createTestRelationship('ler-test-1', 'lde-customer', 'lde-order');
    metaModel.relationships.logical_data_entity_relationships.push(relationship);

    // Create edge manually (simulating palette click)
    const sourceNode = diagram.diagram_nodes.find(n => n.entity_id === 'lde-customer')!;
    const targetNode = diagram.diagram_nodes.find(n => n.entity_id === 'lde-order')!;
    const edge = createRelationshipEdge(
      relationship,
      RELATIONSHIP_EDGE_TYPES.LOGICAL_DATA_ENTITY_RELATIONSHIP,
      sourceNode,
      targetNode,
      { multiplicityType: relationship.cardinality }
    );
    diagram.diagram_edges.push(edge);

    // Verify edge is on diagram
    expect(isLogicalEREdgeOnDiagram(relationship.id, diagram.diagram_edges)).toBe(true);

    // Delete edge
    diagram.diagram_edges = [];
    expect(isLogicalEREdgeOnDiagram(relationship.id, diagram.diagram_edges)).toBe(false);

    // Re-add edge (should be allowed now)
    const newEdge = createRelationshipEdge(
      relationship,
      RELATIONSHIP_EDGE_TYPES.LOGICAL_DATA_ENTITY_RELATIONSHIP,
      sourceNode,
      targetNode,
      { multiplicityType: relationship.cardinality }
    );
    diagram.diagram_edges.push(newEdge);

    expect(isLogicalEREdgeOnDiagram(relationship.id, diagram.diagram_edges)).toBe(true);
    expect(diagram.diagram_edges).toHaveLength(1);
  });
});

// ============================================================================
// Integration Test: Auto-add Missing Nodes
// ============================================================================

describe('Integration: Auto-add missing nodes when creating relationship', () => {
  it('should auto-add source node when not on diagram', () => {
    const metaModel = createTestMetaModel();
    const diagram = {
      diagram_nodes: [createTestDiagramNodes()[1]], // Only Order node
      diagram_edges: [] as DiagramEdge[],
    };

    const formData = {
      fromKind: 'LOGICAL_ENTITY' as const,
      fromEntity: 'lde-customer', // Not on diagram
      toKind: 'LOGICAL_ENTITY' as const,
      toEntity: 'lde-order', // On diagram
      cardinality: 'ONE_TO_MANY' as LogicalERCardinality,
      relationship: 'ASSOCIATION' as LogicalERRelationship,
      description: '',
    };

    const result = simulateCreateAndAddFlow(metaModel, diagram, formData);

    // Verify source node was auto-added
    expect(result.addedNodes).toHaveLength(1);
    expect(result.addedNodes[0].entity_id).toBe('lde-customer');
    expect(result.addedNodes[0].entity_type).toBe(ENTITY_TYPES.LOGICAL_DATA_ENTITY);

    // Verify edge was created
    expect(result.edge).not.toBeNull();
    expect(diagram.diagram_edges).toHaveLength(1);
  });

  it('should auto-add target node when not on diagram', () => {
    const metaModel = createTestMetaModel();
    const diagram = {
      diagram_nodes: [createTestDiagramNodes()[0]], // Only Customer node
      diagram_edges: [] as DiagramEdge[],
    };

    const formData = {
      fromKind: 'LOGICAL_ENTITY' as const,
      fromEntity: 'lde-customer', // On diagram
      toKind: 'LOGICAL_ENTITY' as const,
      toEntity: 'lde-product', // Not on diagram
      cardinality: 'ONE_TO_MANY' as LogicalERCardinality,
      relationship: 'ASSOCIATION' as LogicalERRelationship,
      description: '',
    };

    const result = simulateCreateAndAddFlow(metaModel, diagram, formData);

    // Verify target node was auto-added
    expect(result.addedNodes).toHaveLength(1);
    expect(result.addedNodes[0].entity_id).toBe('lde-product');
  });

  it('should auto-add both nodes when neither on diagram', () => {
    const metaModel = createTestMetaModel();
    const diagram = {
      diagram_nodes: [] as DiagramNode[],
      diagram_edges: [] as DiagramEdge[],
    };

    const formData = {
      fromKind: 'LOGICAL_ENTITY' as const,
      fromEntity: 'lde-product', // Not on diagram
      toKind: 'LOGICAL_ENTITY' as const,
      toEntity: 'lde-address', // Not on diagram
      cardinality: 'MANY_TO_MANY' as LogicalERCardinality,
      relationship: 'ASSOCIATION' as LogicalERRelationship,
      description: '',
    };

    const result = simulateCreateAndAddFlow(metaModel, diagram, formData);

    // Verify both nodes were auto-added
    expect(result.addedNodes).toHaveLength(2);
    const addedEntityIds = result.addedNodes.map(n => n.entity_id);
    expect(addedEntityIds).toContain('lde-product');
    expect(addedEntityIds).toContain('lde-address');
  });
});

// ============================================================================
// Integration Test: Multiple ER Edges with Different Relationship Types
// ============================================================================

describe('Integration: Multiple ER edges with different relationship types', () => {
  it('should correctly render different symbols for each relationship type', () => {
    const relationshipTypes: LogicalERRelationship[] = [
      'GENERALIZATION',
      'REALIZATION',
      'COMPOSITION',
      'AGGREGATION',
      'ASSOCIATION',
      'DEPENDENCY',
    ];

    for (const relType of relationshipTypes) {
      const symbols = getEREdgeSymbols(relType);

      // Each relationship type should have valid symbols defined
      expect(symbols.sourceSymbol).toBeDefined();
      expect(symbols.targetSymbol).toBeDefined();
      expect(symbols.lineStyle).toBeDefined();

      // Verify render data can be generated for symbols
      if (symbols.sourceSymbol !== 'NONE') {
        const sourceRenderData = getSymbolRenderData(symbols.sourceSymbol, 100, 100, 0);
        expect(sourceRenderData).not.toBeNull();
        expect(sourceRenderData!.pathData).toContain('M');
      }

      if (symbols.targetSymbol !== 'NONE') {
        const targetRenderData = getSymbolRenderData(symbols.targetSymbol, 200, 100, 0);
        expect(targetRenderData).not.toBeNull();
        expect(targetRenderData!.pathData).toContain('M');
      }
    }
  });

  it('should support multiple edges on same diagram with different types', () => {
    const metaModel = createTestMetaModel();
    metaModel.entities.logical_data_entities.push(
      { id: 'lde-invoice', name: 'Invoice', description: '', tags: '' }
    );

    const diagram = {
      diagram_nodes: [
        ...createTestDiagramNodes(),
        {
          id: 'node-product',
          entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
          entity_id: 'lde-product',
          pos_x: 250,
          pos_y: 300,
          width: 150,
          height: 100,
          z_index: 3,
          parent_node_id: null,
        },
      ],
      diagram_edges: [] as DiagramEdge[],
    };

    // Create multiple relationships with different types
    const relationships: LogicalDataEntityRelationship[] = [
      createTestRelationship('ler-1', 'lde-customer', 'lde-order', 'ONE_TO_MANY', 'COMPOSITION'),
      createTestRelationship('ler-2', 'lde-order', 'lde-product', 'MANY_TO_MANY', 'ASSOCIATION'),
      createTestRelationship('ler-3', 'lde-customer', 'lde-product', 'ONE_TO_ONE', 'DEPENDENCY'),
    ];

    // Add edges for each relationship
    for (const rel of relationships) {
      const nodes = getPolymorphicLogicalERNodes(rel, diagram.diagram_nodes);
      if (nodes) {
        const edge = createRelationshipEdge(
          rel,
          RELATIONSHIP_EDGE_TYPES.LOGICAL_DATA_ENTITY_RELATIONSHIP,
          nodes.sourceNode,
          nodes.targetNode,
          { multiplicityType: rel.cardinality }
        );
        diagram.diagram_edges.push(edge);
      }
    }

    // Verify all edges were created
    expect(diagram.diagram_edges).toHaveLength(3);

    // Verify each has correct cardinality labels
    expect(diagram.diagram_edges[0].source_label_text).toBe('1'); // ONE_TO_MANY
    expect(diagram.diagram_edges[0].target_label_text).toBe('m');

    expect(diagram.diagram_edges[1].source_label_text).toBe('m'); // MANY_TO_MANY
    expect(diagram.diagram_edges[1].target_label_text).toBe('m');

    expect(diagram.diagram_edges[2].source_label_text).toBe('1'); // ONE_TO_ONE
    expect(diagram.diagram_edges[2].target_label_text).toBe('1');
  });
});

// ============================================================================
// Integration Test: Cardinality and Symbol Update Pipeline
// ============================================================================

describe('E2E: Change cardinality/relationship type, verify label/symbol updates', () => {
  it('should derive correct multiplicity labels from relationship cardinality', () => {
    const metaModel = createTestMetaModel();
    const relationship = createTestRelationship('ler-test', 'lde-customer', 'lde-order', 'ONE_TO_MANY', 'ASSOCIATION');
    metaModel.relationships.logical_data_entity_relationships.push(relationship);

    // Verify initial labels
    let labels = getMultiplicityLabels(relationship.cardinality);
    expect(labels.source).toBe('1');
    expect(labels.target).toBe('m');

    // Simulate cardinality change in meta-model
    relationship.cardinality = 'MANY_TO_ONE';

    // Verify labels update based on new cardinality
    labels = getMultiplicityLabels(relationship.cardinality);
    expect(labels.source).toBe('m');
    expect(labels.target).toBe('1');
  });

  it('should derive correct symbols from relationship type', () => {
    const metaModel = createTestMetaModel();
    const relationship = createTestRelationship('ler-test', 'lde-customer', 'lde-order', 'ONE_TO_MANY', 'COMPOSITION');
    metaModel.relationships.logical_data_entity_relationships.push(relationship);

    // Verify initial symbols
    let symbols = getEREdgeSymbols(relationship.relationship);
    expect(symbols.sourceSymbol).toBe('FILLED_DIAMOND');
    expect(symbols.targetSymbol).toBe('NONE');
    expect(symbols.lineStyle).toBe('solid');

    // Simulate relationship type change
    relationship.relationship = 'GENERALIZATION';

    // Verify symbols update
    symbols = getEREdgeSymbols(relationship.relationship);
    expect(symbols.sourceSymbol).toBe('NONE');
    expect(symbols.targetSymbol).toBe('HOLLOW_TRIANGLE');
    expect(symbols.lineStyle).toBe('solid');

    // Change to REALIZATION (dashed line)
    relationship.relationship = 'REALIZATION';
    symbols = getEREdgeSymbols(relationship.relationship);
    expect(symbols.lineStyle).toBe('dashed');
    expect(getEREdgeStrokeDasharray(symbols.lineStyle)).toBe('6,3');
  });
});

// ============================================================================
// Integration Test: Edge Rendering Pipeline
// ============================================================================

describe('Integration: Edge rendering pipeline with geometry calculations', () => {
  it('should calculate correct edge endpoints at node boundaries', () => {
    const sourceNode: DiagramNode = {
      id: 'node-source',
      entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
      entity_id: 'lde-customer',
      pos_x: 100,
      pos_y: 100,
      width: 150,
      height: 100,
      z_index: 1,
      parent_node_id: null,
    };

    const targetNode: DiagramNode = {
      id: 'node-target',
      entity_type: ENTITY_TYPES.LOGICAL_DATA_ENTITY,
      entity_id: 'lde-order',
      pos_x: 400,
      pos_y: 100,
      width: 150,
      height: 100,
      z_index: 2,
      parent_node_id: null,
    };

    const edgePoints = calculateEdgePoints(sourceNode, targetNode);

    // Source point should be at right edge of source node
    expect(edgePoints[0].pos_x).toBe(250); // 100 + 150
    expect(edgePoints[0].pos_y).toBe(150); // 100 + 100/2

    // Target point should be at left edge of target node
    expect(edgePoints[1].pos_x).toBe(400);
    expect(edgePoints[1].pos_y).toBe(150);
  });

  it('should calculate correct angle for symbol rotation', () => {
    // Horizontal edge (left to right)
    let angle = calculateEdgeAngle(100, 100, 200, 100);
    expect(angle).toBeCloseTo(0);

    // Vertical edge (top to bottom)
    angle = calculateEdgeAngle(100, 100, 100, 200);
    expect(angle).toBeCloseTo(Math.PI / 2);

    // Diagonal edge (45 degrees)
    angle = calculateEdgeAngle(100, 100, 200, 200);
    expect(angle).toBeCloseTo(Math.PI / 4);
  });

  it('should generate valid symbol paths for all types', () => {
    const symbolTypes: Array<'HOLLOW_TRIANGLE' | 'FILLED_DIAMOND' | 'HOLLOW_DIAMOND' | 'OPEN_ARROW'> = [
      'HOLLOW_TRIANGLE',
      'FILLED_DIAMOND',
      'HOLLOW_DIAMOND',
      'OPEN_ARROW',
    ];

    for (const symbolType of symbolTypes) {
      const renderData = getSymbolRenderData(symbolType, 150, 150, 0);
      expect(renderData).not.toBeNull();
      expect(renderData!.pathData).toMatch(/^M\s+[\d.-]+\s+[\d.-]+/); // Should start with M command
      expect(renderData!.stroke).toBe('#616161');
      expect(renderData!.strokeWidth).toBe(1.5);
    }
  });
});

// ============================================================================
// Integration Test: Duplicate Prevention with Palette State
// ============================================================================

describe('Integration: Duplicate prevention in palette workflow', () => {
  it('should prevent adding same relationship twice via isLogicalEREdgeOnDiagram', () => {
    const relationshipId = 'ler-existing';
    const diagramEdges: DiagramEdge[] = [{
      id: 'edge-1',
      relationship_type: RELATIONSHIP_EDGE_TYPES.LOGICAL_DATA_ENTITY_RELATIONSHIP,
      relationship_id: relationshipId,
      source_node_id: 'node-customer',
      target_node_id: 'node-order',
      edge_points: [],
    }];

    // Should be detected as on diagram
    expect(isLogicalEREdgeOnDiagram(relationshipId, diagramEdges)).toBe(true);

    // Different relationship ID should not be detected
    expect(isLogicalEREdgeOnDiagram('ler-other', diagramEdges)).toBe(false);

    // After removing edge, should be able to add again
    diagramEdges.length = 0;
    expect(isLogicalEREdgeOnDiagram(relationshipId, diagramEdges)).toBe(false);
  });

  it('should handle multiple edges correctly in duplicate detection', () => {
    const diagramEdges: DiagramEdge[] = [
      {
        id: 'edge-1',
        relationship_type: RELATIONSHIP_EDGE_TYPES.LOGICAL_DATA_ENTITY_RELATIONSHIP,
        relationship_id: 'ler-1',
        source_node_id: 'node-1',
        target_node_id: 'node-2',
        edge_points: [],
      },
      {
        id: 'edge-2',
        relationship_type: RELATIONSHIP_EDGE_TYPES.DATA_MOVEMENT, // Different type
        relationship_id: 'dm-1',
        source_node_id: 'node-3',
        target_node_id: 'node-4',
        edge_points: [],
      },
      {
        id: 'edge-3',
        relationship_type: RELATIONSHIP_EDGE_TYPES.LOGICAL_DATA_ENTITY_RELATIONSHIP,
        relationship_id: 'ler-2',
        source_node_id: 'node-5',
        target_node_id: 'node-6',
        edge_points: [],
      },
    ];

    // Both LogicalER edges should be detected
    expect(isLogicalEREdgeOnDiagram('ler-1', diagramEdges)).toBe(true);
    expect(isLogicalEREdgeOnDiagram('ler-2', diagramEdges)).toBe(true);

    // Data Movement should not be detected by LogicalER function
    expect(isLogicalEREdgeOnDiagram('dm-1', diagramEdges)).toBe(false);

    // Non-existent should return false
    expect(isLogicalEREdgeOnDiagram('ler-nonexistent', diagramEdges)).toBe(false);
  });
});
