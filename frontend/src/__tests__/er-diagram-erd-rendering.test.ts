/**
 * ER Diagram ERD-Style Rendering Tests
 * Task Group 1: Tests for ERD node creation in ER diagrams
 *
 * These tests verify that nodes created for ER diagrams have the correct
 * render_style: 'erd' and embedded_attribute_ids populated.
 */

import { describe, it, expect } from 'vitest';
import { ENTITY_TYPES, MetaModel, DiagramNode } from '../types/model';
import { DiagramType } from '../types/diagramType';
import {
  createERDNodeFromEntity,
  shouldCreateERDNode,
  createDiagramNodeFromEntity,
} from '../utils/nodeCreation';
import {
  getAttributesForEntity,
  ERD_HEADER_HEIGHT,
  ERD_ATTRIBUTE_ROW_HEIGHT,
} from '../utils/erdUtils';

// ============================================================================
// Test Data Fixtures
// ============================================================================

/**
 * Create a minimal MetaModel for testing
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
          id: 'lde-1',
          name: 'Customer',
          description: 'Customer entity',
          tags: '',
        },
        {
          id: 'lde-2',
          name: 'Order',
          description: 'Order entity',
          tags: '',
        },
      ],
      logical_data_attributes: [
        {
          id: 'lda-1',
          logical_entity_id: 'lde-1',
          name: 'customer_id',
          data_type: 'UUID',
          is_primary_key: true,
        },
        {
          id: 'lda-2',
          logical_entity_id: 'lde-1',
          name: 'name',
          data_type: 'VARCHAR(100)',
          is_primary_key: false,
        },
        {
          id: 'lda-3',
          logical_entity_id: 'lde-1',
          name: 'email',
          data_type: 'VARCHAR(255)',
          is_primary_key: false,
        },
      ],
      physical_data_entities: [
        {
          id: 'pde-1',
          name: 'customers_table',
          description: 'Physical customers table',
          physical_type: 'TABLE',
          database: 'main_db',
          tags: '',
        },
      ],
      physical_data_attributes: [
        {
          id: 'pda-1',
          physical_entity_id: 'pde-1',
          name: 'CUST_ID',
          data_type: 'BIGINT',
          is_primary_key: true,
        },
        {
          id: 'pda-2',
          physical_entity_id: 'pde-1',
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

// ============================================================================
// shouldCreateERDNode Tests
// ============================================================================

describe('shouldCreateERDNode - ER Diagram Detection', () => {
  it('should return true for LOGICAL_DATA_ENTITY in ER diagram', () => {
    const result = shouldCreateERDNode(ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'ER');
    expect(result).toBe(true);
  });

  it('should return true for PHYSICAL_DATA_ENTITY in ER diagram', () => {
    const result = shouldCreateERDNode(ENTITY_TYPES.PHYSICAL_DATA_ENTITY, 'ER');
    expect(result).toBe(true);
  });

  it('should return false for LOGICAL_DATA_ENTITY in General diagram', () => {
    const result = shouldCreateERDNode(ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'General');
    expect(result).toBe(false);
  });

  it('should return false for PHYSICAL_DATA_ENTITY in General diagram', () => {
    const result = shouldCreateERDNode(ENTITY_TYPES.PHYSICAL_DATA_ENTITY, 'General');
    expect(result).toBe(false);
  });

  it('should return false for non-data entity types in ER diagram', () => {
    const result = shouldCreateERDNode(ENTITY_TYPES.APPLICATION, 'ER');
    expect(result).toBe(false);
  });

  it('should return false for State diagram', () => {
    const result = shouldCreateERDNode(ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'State');
    expect(result).toBe(false);
  });
});

// ============================================================================
// createERDNodeFromEntity Tests - LOGICAL_DATA_ENTITY
// ============================================================================

describe('createERDNodeFromEntity - LOGICAL_DATA_ENTITY', () => {
  it('should create node with render_style: erd for LOGICAL_DATA_ENTITY in ER diagram', () => {
    const metaModel = createTestMetaModel();
    const existingNodes: DiagramNode[] = [];
    const viewportCenter = { x: 500, y: 500 };

    const node = createERDNodeFromEntity(
      ENTITY_TYPES.LOGICAL_DATA_ENTITY,
      'lde-1',
      existingNodes,
      metaModel,
      viewportCenter
    );

    expect(node).not.toBeNull();
    expect(node!.render_style).toBe('erd');
    expect(node!.entity_type).toBe(ENTITY_TYPES.LOGICAL_DATA_ENTITY);
    expect(node!.entity_id).toBe('lde-1');
  });

  it('should populate embedded_attribute_ids with matching logical_data_attributes', () => {
    const metaModel = createTestMetaModel();
    const existingNodes: DiagramNode[] = [];
    const viewportCenter = { x: 500, y: 500 };

    const node = createERDNodeFromEntity(
      ENTITY_TYPES.LOGICAL_DATA_ENTITY,
      'lde-1',
      existingNodes,
      metaModel,
      viewportCenter
    );

    expect(node).not.toBeNull();
    expect(node!.embedded_attribute_ids).toBeDefined();
    expect(node!.embedded_attribute_ids).toHaveLength(3);
    expect(node!.embedded_attribute_ids).toContain('lda-1');
    expect(node!.embedded_attribute_ids).toContain('lda-2');
    expect(node!.embedded_attribute_ids).toContain('lda-3');
  });

  it('should calculate height based on attribute count', () => {
    const metaModel = createTestMetaModel();
    const existingNodes: DiagramNode[] = [];
    const viewportCenter = { x: 500, y: 500 };

    const node = createERDNodeFromEntity(
      ENTITY_TYPES.LOGICAL_DATA_ENTITY,
      'lde-1',
      existingNodes,
      metaModel,
      viewportCenter
    );

    // lde-1 has 3 attributes
    // Expected height: ERD_HEADER_HEIGHT + (3 * ERD_ATTRIBUTE_ROW_HEIGHT) + bottom padding
    const expectedMinHeight = ERD_HEADER_HEIGHT + (3 * ERD_ATTRIBUTE_ROW_HEIGHT);

    expect(node).not.toBeNull();
    expect(node!.height).toBeGreaterThanOrEqual(expectedMinHeight);
  });

  it('should return empty embedded_attribute_ids for entity with no attributes', () => {
    const metaModel = createTestMetaModel();
    const existingNodes: DiagramNode[] = [];
    const viewportCenter = { x: 500, y: 500 };

    // lde-2 (Order) has no attributes in our test data
    const node = createERDNodeFromEntity(
      ENTITY_TYPES.LOGICAL_DATA_ENTITY,
      'lde-2',
      existingNodes,
      metaModel,
      viewportCenter
    );

    expect(node).not.toBeNull();
    expect(node!.embedded_attribute_ids).toBeDefined();
    expect(node!.embedded_attribute_ids).toHaveLength(0);
  });
});

// ============================================================================
// createERDNodeFromEntity Tests - PHYSICAL_DATA_ENTITY
// ============================================================================

describe('createERDNodeFromEntity - PHYSICAL_DATA_ENTITY', () => {
  it('should create node with render_style: erd for PHYSICAL_DATA_ENTITY in ER diagram', () => {
    const metaModel = createTestMetaModel();
    const existingNodes: DiagramNode[] = [];
    const viewportCenter = { x: 500, y: 500 };

    const node = createERDNodeFromEntity(
      ENTITY_TYPES.PHYSICAL_DATA_ENTITY,
      'pde-1',
      existingNodes,
      metaModel,
      viewportCenter
    );

    expect(node).not.toBeNull();
    expect(node!.render_style).toBe('erd');
    expect(node!.entity_type).toBe(ENTITY_TYPES.PHYSICAL_DATA_ENTITY);
    expect(node!.entity_id).toBe('pde-1');
  });

  it('should populate embedded_attribute_ids with matching physical_data_attributes', () => {
    const metaModel = createTestMetaModel();
    const existingNodes: DiagramNode[] = [];
    const viewportCenter = { x: 500, y: 500 };

    const node = createERDNodeFromEntity(
      ENTITY_TYPES.PHYSICAL_DATA_ENTITY,
      'pde-1',
      existingNodes,
      metaModel,
      viewportCenter
    );

    expect(node).not.toBeNull();
    expect(node!.embedded_attribute_ids).toBeDefined();
    expect(node!.embedded_attribute_ids).toHaveLength(2);
    expect(node!.embedded_attribute_ids).toContain('pda-1');
    expect(node!.embedded_attribute_ids).toContain('pda-2');
  });

  it('should calculate height based on physical attribute count', () => {
    const metaModel = createTestMetaModel();
    const existingNodes: DiagramNode[] = [];
    const viewportCenter = { x: 500, y: 500 };

    const node = createERDNodeFromEntity(
      ENTITY_TYPES.PHYSICAL_DATA_ENTITY,
      'pde-1',
      existingNodes,
      metaModel,
      viewportCenter
    );

    // pde-1 has 2 attributes
    // Expected height: ERD_HEADER_HEIGHT + (2 * ERD_ATTRIBUTE_ROW_HEIGHT) + bottom padding
    const expectedMinHeight = ERD_HEADER_HEIGHT + (2 * ERD_ATTRIBUTE_ROW_HEIGHT);

    expect(node).not.toBeNull();
    expect(node!.height).toBeGreaterThanOrEqual(expectedMinHeight);
  });
});

// ============================================================================
// General Diagram Behavior Tests (Unchanged Behavior)
// ============================================================================

describe('General diagram behavior - unchanged', () => {
  it('should NOT get render_style: erd when not using createERDNodeFromEntity', () => {
    // This test verifies that the standard createDiagramNodeFromEntity function
    // does NOT add render_style: 'erd' - that behavior is unchanged
    // The new createERDNodeFromEntity is a separate function specifically for ER diagrams

    const existingNodes: DiagramNode[] = [];
    const viewportCenter = { x: 500, y: 500 };

    const node = createDiagramNodeFromEntity(
      ENTITY_TYPES.LOGICAL_DATA_ENTITY,
      'lde-1',
      existingNodes,
      viewportCenter
    );

    // Standard node creation should NOT have render_style set
    expect(node.render_style).toBeUndefined();
    expect(node.embedded_attribute_ids).toBeUndefined();
  });
});

// ============================================================================
// Utility Function Tests
// ============================================================================

describe('getAttributesForEntity - Integration', () => {
  it('should return logical attributes for LOGICAL_DATA_ENTITY', () => {
    const metaModel = createTestMetaModel();
    const attributes = getAttributesForEntity(metaModel, 'lde-1', ENTITY_TYPES.LOGICAL_DATA_ENTITY);

    expect(attributes).toHaveLength(3);
    expect(attributes.map(a => a.id)).toContain('lda-1');
    expect(attributes.map(a => a.id)).toContain('lda-2');
    expect(attributes.map(a => a.id)).toContain('lda-3');
  });

  it('should return physical attributes for PHYSICAL_DATA_ENTITY', () => {
    const metaModel = createTestMetaModel();
    const attributes = getAttributesForEntity(metaModel, 'pde-1', ENTITY_TYPES.PHYSICAL_DATA_ENTITY);

    expect(attributes).toHaveLength(2);
    expect(attributes.map(a => a.id)).toContain('pda-1');
    expect(attributes.map(a => a.id)).toContain('pda-2');
  });

  it('should return empty array for entity with no attributes', () => {
    const metaModel = createTestMetaModel();
    const attributes = getAttributesForEntity(metaModel, 'lde-2', ENTITY_TYPES.LOGICAL_DATA_ENTITY);

    expect(attributes).toHaveLength(0);
  });
});
