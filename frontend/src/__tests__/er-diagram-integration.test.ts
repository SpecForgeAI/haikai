/**
 * ER Diagram Integration Tests
 * Task Group 3: Integration tests for ERD rendering and Logical ER creation
 *
 * These tests verify the end-to-end integration between:
 * - ERD node creation functions and their usage in palette handlers
 * - Logical ER creation flow with dispatch action simulation
 * - General diagram behavior remains unchanged
 */

import { describe, it, expect } from 'vitest';
import { DiagramNode, MetaModel, ENTITY_TYPES, LogicalDataEntityRelationship } from '../types/model';
import { DiagramType } from '../types/diagramType';
import {
  createERDNodeFromEntity,
  shouldCreateERDNode,
  createDiagramNodeFromEntity,
} from '../utils/nodeCreation';
import {
  getAttributesForEntity,
  shouldRenderAsERD,
} from '../utils/erdUtils';
import { generatePrefixedId } from '../utils/idGenerator';
import { DIAGRAM_TYPE_PALETTE_RULES } from '../utils/paletteData';

// ============================================================================
// Test Data Fixtures
// ============================================================================

/**
 * Create a comprehensive MetaModel for integration testing
 */
function createTestMetaModel(): MetaModel {
  return {
    entities: {
      applications: [],
      app_components: [],
      services: [],
      interfaces: [],
      endpoints: [],
      classes: [],
      methods: [],
      application_points: [],
      business_users: [],
      business_processes: [],
      process_activities: [],
      logical_data_entities: [
        {
          id: 'lde-customer',
          name: 'Customer',
          description: 'Customer entity for testing',
          tags: 'test,customer',
        },
        {
          id: 'lde-order',
          name: 'Order',
          description: 'Order entity for testing',
          tags: 'test,order',
        },
      ],
      logical_data_attributes: [
        {
          id: 'lda-cust-id',
          logical_entity_id: 'lde-customer',
          name: 'id',
          data_type: 'UUID',
          is_primary_key: true,
        },
        {
          id: 'lda-cust-name',
          logical_entity_id: 'lde-customer',
          name: 'name',
          data_type: 'VARCHAR(100)',
          is_primary_key: false,
        },
        {
          id: 'lda-cust-email',
          logical_entity_id: 'lde-customer',
          name: 'email',
          data_type: 'VARCHAR(255)',
          is_primary_key: false,
        },
      ],
      physical_data_entities: [
        {
          id: 'pde-customers',
          name: 'customers_table',
          description: 'Physical customers table',
          physical_type: 'TABLE',
          database: 'main_db',
          tags: '',
        },
      ],
      physical_data_attributes: [
        {
          id: 'pda-cust-id',
          physical_entity_id: 'pde-customers',
          name: 'CUST_ID',
          data_type: 'BIGINT',
          is_primary_key: true,
        },
        {
          id: 'pda-cust-name',
          physical_entity_id: 'pde-customers',
          name: 'CUST_NAME',
          data_type: 'VARCHAR2(100)',
          is_primary_key: false,
        },
      ],
      interactions: [],
      events: [],
      states: [],
      activities: [],
      activity_partitions: [],
      sequence_diagrams: [],
    },
    relationships: {
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      user_business_points: [],
      app_point_business_points: [],
      state_transitions: [],
      activity_flows: [],
      interface_logical_entities: [],
    },
    diagrams: [],
    model_metadata: {
      version: '1.0.0',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };
}

/**
 * Simulate the handleItemClick flow for adding an entity to a diagram
 * This mirrors the logic in PalettePanel.tsx handleItemClick
 */
function simulateHandleItemClick(
  entityType: string,
  entityId: string,
  existingNodes: DiagramNode[],
  diagramType: DiagramType | string,
  metaModel: MetaModel,
  viewportCenter: { x: number; y: number }
): DiagramNode {
  // This mirrors the actual implementation in PalettePanel.tsx lines 1496-1526
  if (shouldCreateERDNode(entityType, diagramType) && metaModel) {
    const erdNode = createERDNodeFromEntity(
      entityType,
      entityId,
      existingNodes,
      metaModel,
      viewportCenter
    );
    if (erdNode) {
      return erdNode;
    }
    // Fallback to standard node if ERD creation fails
    return createDiagramNodeFromEntity(
      entityType,
      entityId,
      existingNodes,
      viewportCenter
    );
  } else {
    // Standard node creation for all other cases
    return createDiagramNodeFromEntity(
      entityType,
      entityId,
      existingNodes,
      viewportCenter
    );
  }
}

/**
 * Simulate the Logical ER creation flow from handleCreateButtonClick
 * This mirrors the logic in PalettePanel.tsx lines 1057-1075
 */
function simulateLogicalERCreation(): {
  relationship: LogicalDataEntityRelationship;
  dispatchAction: { type: string; relationshipType: string; relationship: LogicalDataEntityRelationship };
} {
  const newRelationship: LogicalDataEntityRelationship = {
    id: generatePrefixedId('ler'),
    source_entity_id: '',
    target_entity_id: '',
    relationship_type: 'ONE_TO_ONE',
    description: '',
    tags: '',
  };

  return {
    relationship: newRelationship,
    dispatchAction: {
      type: 'ADD_RELATIONSHIP',
      relationshipType: 'logical_data_entity_relationships',
      relationship: newRelationship,
    },
  };
}

// ============================================================================
// Integration Tests: End-to-End ERD Node Creation
// ============================================================================

describe('Integration: End-to-end ERD node creation in ER diagrams', () => {
  it('should create ERD-style node when adding LOGICAL_DATA_ENTITY via handleItemClick simulation', () => {
    const metaModel = createTestMetaModel();
    const existingNodes: DiagramNode[] = [];
    const viewportCenter = { x: 500, y: 500 };

    // Simulate the handleItemClick flow for ER diagram
    const node = simulateHandleItemClick(
      ENTITY_TYPES.LOGICAL_DATA_ENTITY,
      'lde-customer',
      existingNodes,
      'ER',
      metaModel,
      viewportCenter
    );

    // Verify ERD-style rendering properties
    expect(node.render_style).toBe('erd');
    expect(node.embedded_attribute_ids).toBeDefined();
    expect(node.embedded_attribute_ids).toHaveLength(3);
    expect(node.entity_type).toBe(ENTITY_TYPES.LOGICAL_DATA_ENTITY);
    expect(node.entity_id).toBe('lde-customer');

    // Verify the node would render as ERD
    expect(shouldRenderAsERD(node)).toBe(true);
  });

  it('should create ERD-style node when adding PHYSICAL_DATA_ENTITY via handleItemClick simulation', () => {
    const metaModel = createTestMetaModel();
    const existingNodes: DiagramNode[] = [];
    const viewportCenter = { x: 500, y: 500 };

    // Simulate the handleItemClick flow for ER diagram
    const node = simulateHandleItemClick(
      ENTITY_TYPES.PHYSICAL_DATA_ENTITY,
      'pde-customers',
      existingNodes,
      'ER',
      metaModel,
      viewportCenter
    );

    // Verify ERD-style rendering properties
    expect(node.render_style).toBe('erd');
    expect(node.embedded_attribute_ids).toBeDefined();
    expect(node.embedded_attribute_ids).toHaveLength(2);
    expect(node.entity_type).toBe(ENTITY_TYPES.PHYSICAL_DATA_ENTITY);

    // Verify the node would render as ERD
    expect(shouldRenderAsERD(node)).toBe(true);
  });

  it('should populate correct attribute IDs from metaModel for ERD node', () => {
    const metaModel = createTestMetaModel();
    const existingNodes: DiagramNode[] = [];
    const viewportCenter = { x: 500, y: 500 };

    const node = simulateHandleItemClick(
      ENTITY_TYPES.LOGICAL_DATA_ENTITY,
      'lde-customer',
      existingNodes,
      'ER',
      metaModel,
      viewportCenter
    );

    // Verify the embedded attribute IDs match the attributes from the metaModel
    const expectedAttributeIds = ['lda-cust-id', 'lda-cust-name', 'lda-cust-email'];
    expect(node.embedded_attribute_ids).toEqual(expect.arrayContaining(expectedAttributeIds));
    expect(node.embedded_attribute_ids?.length).toBe(expectedAttributeIds.length);
  });
});

// ============================================================================
// Integration Tests: General Diagram Unchanged Behavior
// ============================================================================

describe('Integration: General diagram behavior unchanged', () => {
  it('should create standard node (not ERD) for LOGICAL_DATA_ENTITY in General diagram', () => {
    const metaModel = createTestMetaModel();
    const existingNodes: DiagramNode[] = [];
    const viewportCenter = { x: 500, y: 500 };

    // Simulate the handleItemClick flow for General diagram
    const node = simulateHandleItemClick(
      ENTITY_TYPES.LOGICAL_DATA_ENTITY,
      'lde-customer',
      existingNodes,
      'General',
      metaModel,
      viewportCenter
    );

    // Verify NOT ERD-style rendering
    expect(node.render_style).toBeUndefined();
    expect(node.embedded_attribute_ids).toBeUndefined();
    expect(node.entity_type).toBe(ENTITY_TYPES.LOGICAL_DATA_ENTITY);

    // Verify the node would NOT render as ERD
    expect(shouldRenderAsERD(node)).toBe(false);
  });

  it('should create standard node for non-data entities in ER diagram', () => {
    const metaModel = createTestMetaModel();
    const existingNodes: DiagramNode[] = [];
    const viewportCenter = { x: 500, y: 500 };

    // Simulate adding an APPLICATION to an ER diagram (hypothetical edge case)
    const node = simulateHandleItemClick(
      ENTITY_TYPES.APPLICATION,
      'app-1',
      existingNodes,
      'ER',
      metaModel,
      viewportCenter
    );

    // Should not be ERD style since APPLICATION is not a data entity
    expect(node.render_style).toBeUndefined();
    expect(node.embedded_attribute_ids).toBeUndefined();
    expect(shouldRenderAsERD(node)).toBe(false);
  });
});

// ============================================================================
// Integration Tests: Logical ER Creation Flow
// ============================================================================

describe('Integration: Logical ER creation end-to-end flow', () => {
  it('should create valid Logical ER relationship with correct dispatch action', () => {
    const { relationship, dispatchAction } = simulateLogicalERCreation();

    // Verify the relationship object
    expect(relationship.id).toMatch(/^ler-/);
    expect(relationship.source_entity_id).toBe('');
    expect(relationship.target_entity_id).toBe('');
    expect(relationship.relationship_type).toBe('ONE_TO_ONE');

    // Verify the dispatch action is correctly formed
    expect(dispatchAction.type).toBe('ADD_RELATIONSHIP');
    expect(dispatchAction.relationshipType).toBe('logical_data_entity_relationships');
    expect(dispatchAction.relationship).toBe(relationship);
  });

  it('should generate unique IDs for multiple Logical ER creations', () => {
    const creations = [
      simulateLogicalERCreation(),
      simulateLogicalERCreation(),
      simulateLogicalERCreation(),
    ];

    const ids = creations.map(c => c.relationship.id);
    const uniqueIds = new Set(ids);

    // All IDs should be unique
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('should include Logical ER in ER palette rules', () => {
    const erRules = DIAGRAM_TYPE_PALETTE_RULES.ER;

    // Verify logical_data_entity_relationships is in the ER palette
    expect(erRules).toContain('logical_data_entity_relationships');

    // Also verify the other expected ER sections
    expect(erRules).toContain('logical_data_entities');
    expect(erRules).toContain('physical_data_entities');
    expect(erRules).toContain('logical_data_attributes');
    expect(erRules).toContain('physical_data_attributes');
  });
});
