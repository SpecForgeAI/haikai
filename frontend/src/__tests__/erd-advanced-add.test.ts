/**
 * ERD Advanced Add Tests
 * Tests for Advanced Add dialog ERD-style support
 * Task Group 4: Advanced Add ERD Support
 */

import { describe, it, expect } from 'vitest';
import { ENTITY_TYPES, MetaModel } from '../types/model';
import { TreeNodeData } from '../types/advancedAdd';
import {
  findERDCandidates,
  ERDCandidate,
} from '../utils/erdAdvancedAddUtils';

// Test factory for creating a minimal MetaModel with data entities and attributes
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
      application_points: [],
      logical_data_entities: [
        { id: 'lde-customer', name: 'Customer', description: '', tags: '' },
        { id: 'lde-order', name: 'Order', description: '', tags: '' },
        { id: 'lde-empty', name: 'EmptyEntity', description: '', tags: '' },
      ],
      logical_data_attributes: [
        { id: 'lda-1', name: 'customer_id', description: '', logical_entity_id: 'lde-customer', data_type: 'INTEGER', is_primary_key: true, is_nullable: false, tags: '' },
        { id: 'lda-2', name: 'name', description: '', logical_entity_id: 'lde-customer', data_type: 'VARCHAR(100)', is_primary_key: false, is_nullable: false, tags: '' },
        { id: 'lda-3', name: 'order_id', description: '', logical_entity_id: 'lde-order', data_type: 'INTEGER', is_primary_key: true, is_nullable: false, tags: '' },
      ],
      physical_data_entities: [
        { id: 'pde-customers', name: 'customers_table', description: '', physical_type: 'TABLE', database: 'main_db', tags: '' },
      ],
      physical_data_attributes: [
        { id: 'pda-1', name: 'cust_id', description: '', physical_entity_id: 'pde-customers', data_type: 'INT', is_primary_key: true, is_nullable: false, tags: '' },
        { id: 'pda-2', name: 'full_name', description: '', physical_entity_id: 'pde-customers', data_type: 'VARCHAR(100)', is_primary_key: false, is_nullable: false, tags: '' },
      ],
    },
    relationships: {
      business_user_processes: [],
      application_point_business_processes: [],
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

// Test factory for creating TreeNodeData
function createTestTreeNode(
  entityType: string,
  entityId: string,
  children: TreeNodeData[] = []
): TreeNodeData {
  return {
    key: `${entityType}:${entityId}`,
    entityType,
    entityId,
    children,
    label: entityId,
  };
}

describe('ERD Advanced Add', () => {
  describe('findERDCandidates', () => {
    it('should identify logical entity with selected attribute children as ERD candidate', () => {
      const metaModel = createTestMetaModel();
      const customerNode = createTestTreeNode(ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'lde-customer', [
        createTestTreeNode(ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE, 'lda-1'),
        createTestTreeNode(ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE, 'lda-2'),
      ]);
      const selectedKeys = new Set([
        customerNode.key,
        customerNode.children[0].key,
        customerNode.children[1].key,
      ]);

      const candidates = findERDCandidates([customerNode], selectedKeys, metaModel);

      expect(candidates).toHaveLength(1);
      expect(candidates[0].entity.entityId).toBe('lde-customer');
      expect(candidates[0].attributes).toHaveLength(2);
    });

    it('should identify physical entity with selected attribute children as ERD candidate', () => {
      const metaModel = createTestMetaModel();
      const tableNode = createTestTreeNode(ENTITY_TYPES.PHYSICAL_DATA_ENTITY, 'pde-customers', [
        createTestTreeNode(ENTITY_TYPES.PHYSICAL_DATA_ATTRIBUTE, 'pda-1'),
        createTestTreeNode(ENTITY_TYPES.PHYSICAL_DATA_ATTRIBUTE, 'pda-2'),
      ]);
      const selectedKeys = new Set([
        tableNode.key,
        tableNode.children[0].key,
        tableNode.children[1].key,
      ]);

      const candidates = findERDCandidates([tableNode], selectedKeys, metaModel);

      expect(candidates).toHaveLength(1);
      expect(candidates[0].entity.entityId).toBe('pde-customers');
      expect(candidates[0].attributes).toHaveLength(2);
    });

    it('should NOT identify entity without selected attributes as ERD candidate', () => {
      const metaModel = createTestMetaModel();
      const customerNode = createTestTreeNode(ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'lde-customer', [
        createTestTreeNode(ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE, 'lda-1'),
      ]);
      // Only select the entity, not its attributes
      const selectedKeys = new Set([customerNode.key]);

      const candidates = findERDCandidates([customerNode], selectedKeys, metaModel);

      expect(candidates).toHaveLength(0);
    });

    it('should NOT identify non-data entity types as ERD candidates', () => {
      const metaModel = createTestMetaModel();
      const appNode = createTestTreeNode(ENTITY_TYPES.APPLICATION, 'app-1', [
        createTestTreeNode(ENTITY_TYPES.APP_COMPONENT, 'comp-1'),
      ]);
      const selectedKeys = new Set([appNode.key, appNode.children[0].key]);

      const candidates = findERDCandidates([appNode], selectedKeys, metaModel);

      expect(candidates).toHaveLength(0);
    });

    it('should handle multiple ERD candidates', () => {
      const metaModel = createTestMetaModel();
      const customerNode = createTestTreeNode(ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'lde-customer', [
        createTestTreeNode(ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE, 'lda-1'),
      ]);
      const orderNode = createTestTreeNode(ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'lde-order', [
        createTestTreeNode(ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE, 'lda-3'),
      ]);
      const selectedKeys = new Set([
        customerNode.key,
        customerNode.children[0].key,
        orderNode.key,
        orderNode.children[0].key,
      ]);

      const candidates = findERDCandidates([customerNode, orderNode], selectedKeys, metaModel);

      expect(candidates).toHaveLength(2);
    });

    it('should only include selected attributes in ERD candidate', () => {
      const metaModel = createTestMetaModel();
      const customerNode = createTestTreeNode(ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'lde-customer', [
        createTestTreeNode(ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE, 'lda-1'),
        createTestTreeNode(ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE, 'lda-2'),
      ]);
      // Only select entity and first attribute
      const selectedKeys = new Set([
        customerNode.key,
        customerNode.children[0].key,
      ]);

      const candidates = findERDCandidates([customerNode], selectedKeys, metaModel);

      expect(candidates).toHaveLength(1);
      expect(candidates[0].attributes).toHaveLength(1);
      expect(candidates[0].attributes[0].entityId).toBe('lda-1');
    });
  });

  describe('ERD candidate structure', () => {
    it('should have correct structure for ERD candidate', () => {
      const metaModel = createTestMetaModel();
      const customerNode = createTestTreeNode(ENTITY_TYPES.LOGICAL_DATA_ENTITY, 'lde-customer', [
        createTestTreeNode(ENTITY_TYPES.LOGICAL_DATA_ATTRIBUTE, 'lda-1'),
      ]);
      const selectedKeys = new Set([
        customerNode.key,
        customerNode.children[0].key,
      ]);

      const candidates = findERDCandidates([customerNode], selectedKeys, metaModel);
      const candidate = candidates[0];

      // Verify structure
      expect(candidate).toHaveProperty('entity');
      expect(candidate).toHaveProperty('attributes');
      expect(candidate.entity.entityType).toBe(ENTITY_TYPES.LOGICAL_DATA_ENTITY);
      expect(Array.isArray(candidate.attributes)).toBe(true);
    });
  });
});
