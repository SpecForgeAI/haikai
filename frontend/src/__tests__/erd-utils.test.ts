/**
 * ERD Utility Functions Tests
 * Tests for ERD/UML-style rendering utility functions
 * Task Group 2: ERD Utility Functions
 */

import {
  getAttributesForEntity,
  getAttributesByIds,
  calculateERDNodeSize,
  formatAttribute,
  ERD_HEADER_HEIGHT,
  ERD_ATTRIBUTE_ROW_HEIGHT,
  ERD_MIN_WIDTH,
} from '../utils/erdUtils';
import { MetaModel, ENTITY_TYPES } from '../types/model';

// Test factory for creating a minimal MetaModel with attributes
function createTestMetaModel(overrides: Partial<MetaModel> = {}): MetaModel {
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
      ],
      logical_data_attributes: [
        { id: 'lda-1', name: 'customer_id', description: '', logical_entity_id: 'lde-customer', data_type: 'INTEGER', is_primary_key: true, is_nullable: false, tags: '' },
        { id: 'lda-2', name: 'name', description: '', logical_entity_id: 'lde-customer', data_type: 'VARCHAR(100)', is_primary_key: false, is_nullable: false, tags: '' },
        { id: 'lda-3', name: 'email', description: '', logical_entity_id: 'lde-customer', data_type: 'VARCHAR(255)', is_primary_key: false, is_nullable: true, tags: '' },
        { id: 'lda-4', name: 'order_id', description: '', logical_entity_id: 'lde-order', data_type: 'INTEGER', is_primary_key: true, is_nullable: false, tags: '' },
      ],
      physical_data_entities: [
        { id: 'pde-customers', name: 'customers_table', description: '', physical_type: 'TABLE', database: 'main_db', tags: '' },
      ],
      physical_data_attributes: [
        { id: 'pda-1', name: 'cust_id', description: '', physical_entity_id: 'pde-customers', data_type: 'INT', is_primary_key: true, is_nullable: false, tags: '' },
        { id: 'pda-2', name: 'full_name', description: '', physical_entity_id: 'pde-customers', data_type: 'VARCHAR(100)', is_primary_key: false, is_nullable: false, tags: '' },
      ],
      ...overrides.entities,
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
      ...overrides.relationships,
    },
  };
}

describe('ERD Utility Functions', () => {
  describe('getAttributesForEntity', () => {
    it('should return attributes for a logical data entity', () => {
      const metaModel = createTestMetaModel();
      const attributes = getAttributesForEntity(
        metaModel,
        'lde-customer',
        ENTITY_TYPES.LOGICAL_DATA_ENTITY
      );

      expect(attributes).toHaveLength(3);
      expect(attributes[0].id).toBe('lda-1');
      expect(attributes[0].name).toBe('customer_id');
      expect(attributes[0].data_type).toBe('INTEGER');
      expect(attributes[1].name).toBe('name');
      expect(attributes[2].name).toBe('email');
    });

    it('should return attributes for a physical data entity', () => {
      const metaModel = createTestMetaModel();
      const attributes = getAttributesForEntity(
        metaModel,
        'pde-customers',
        ENTITY_TYPES.PHYSICAL_DATA_ENTITY
      );

      expect(attributes).toHaveLength(2);
      expect(attributes[0].id).toBe('pda-1');
      expect(attributes[0].name).toBe('cust_id');
      expect(attributes[0].data_type).toBe('INT');
    });

    it('should return empty array for entity with no attributes', () => {
      const metaModel = createTestMetaModel();
      const attributes = getAttributesForEntity(
        metaModel,
        'non-existent',
        ENTITY_TYPES.LOGICAL_DATA_ENTITY
      );

      expect(attributes).toEqual([]);
    });

    it('should return empty array for non-data entity types', () => {
      const metaModel = createTestMetaModel();
      const attributes = getAttributesForEntity(
        metaModel,
        'some-id',
        ENTITY_TYPES.APPLICATION
      );

      expect(attributes).toEqual([]);
    });
  });

  describe('getAttributesByIds', () => {
    it('should return filtered attributes by IDs for logical entity', () => {
      const metaModel = createTestMetaModel();
      const attributes = getAttributesByIds(
        metaModel,
        ['lda-1', 'lda-3'],
        ENTITY_TYPES.LOGICAL_DATA_ENTITY
      );

      expect(attributes).toHaveLength(2);
      expect(attributes.map(a => a.id)).toContain('lda-1');
      expect(attributes.map(a => a.id)).toContain('lda-3');
    });

    it('should return filtered attributes by IDs for physical entity', () => {
      const metaModel = createTestMetaModel();
      const attributes = getAttributesByIds(
        metaModel,
        ['pda-2'],
        ENTITY_TYPES.PHYSICAL_DATA_ENTITY
      );

      expect(attributes).toHaveLength(1);
      expect(attributes[0].id).toBe('pda-2');
      expect(attributes[0].name).toBe('full_name');
    });

    it('should return empty array for non-existent IDs', () => {
      const metaModel = createTestMetaModel();
      const attributes = getAttributesByIds(
        metaModel,
        ['non-existent-1', 'non-existent-2'],
        ENTITY_TYPES.LOGICAL_DATA_ENTITY
      );

      expect(attributes).toEqual([]);
    });

    it('should return only matching attributes when some IDs do not exist', () => {
      const metaModel = createTestMetaModel();
      const attributes = getAttributesByIds(
        metaModel,
        ['lda-1', 'non-existent'],
        ENTITY_TYPES.LOGICAL_DATA_ENTITY
      );

      expect(attributes).toHaveLength(1);
      expect(attributes[0].id).toBe('lda-1');
    });
  });

  describe('formatAttribute', () => {
    it('should format attribute as "name : type" when type exists', () => {
      const result = formatAttribute({ name: 'customer_id', data_type: 'INTEGER' });
      expect(result).toBe('customer_id : INTEGER');
    });

    it('should format attribute as just "name" when no type', () => {
      const result = formatAttribute({ name: 'unknown_field' });
      expect(result).toBe('unknown_field');
    });

    it('should format attribute as just "name" when type is empty string', () => {
      const result = formatAttribute({ name: 'field', data_type: '' });
      expect(result).toBe('field');
    });

    it('should handle complex type strings', () => {
      const result = formatAttribute({ name: 'email', data_type: 'VARCHAR(255)' });
      expect(result).toBe('email : VARCHAR(255)');
    });
  });

  describe('calculateERDNodeSize', () => {
    it('should calculate correct height based on number of attributes', () => {
      const attributes = [
        { name: 'id', data_type: 'INTEGER' },
        { name: 'name', data_type: 'VARCHAR' },
        { name: 'email', data_type: 'VARCHAR' },
      ];
      const { height } = calculateERDNodeSize('Customer', attributes);

      // Height = header(30) + (3 attributes * 20) + padding(10) = 100
      expect(height).toBe(ERD_HEADER_HEIGHT + (3 * ERD_ATTRIBUTE_ROW_HEIGHT) + 10);
    });

    it('should enforce minimum width', () => {
      const attributes = [{ name: 'id', data_type: 'INT' }];
      const { width } = calculateERDNodeSize('A', attributes);

      expect(width).toBeGreaterThanOrEqual(ERD_MIN_WIDTH);
    });

    it('should calculate width to fit longest attribute text', () => {
      const attributes = [
        { name: 'very_long_attribute_name_here', data_type: 'VARCHAR(1000)' },
      ];
      const { width } = calculateERDNodeSize('Short', attributes);

      // Width should be enough to fit the longest text
      expect(width).toBeGreaterThan(ERD_MIN_WIDTH);
    });

    it('should handle entity with no attributes', () => {
      const { width, height } = calculateERDNodeSize('EmptyEntity', []);

      expect(width).toBeGreaterThanOrEqual(ERD_MIN_WIDTH);
      // Height = header(30) + padding(10) = 40
      expect(height).toBe(ERD_HEADER_HEIGHT + 10);
    });

    it('should return dimensions respecting spacious preset', () => {
      const attributes = [{ name: 'id', data_type: 'INT' }];
      const { width: spaciousWidth } = calculateERDNodeSize('Entity', attributes, 'spacious');
      const { width: normalWidth } = calculateERDNodeSize('Entity', attributes, 'normal');

      // Spacious preset has larger padding, so width should be >= normal
      expect(spaciousWidth).toBeGreaterThanOrEqual(normalWidth);
    });
  });

  describe('ERD Constants', () => {
    it('should export ERD_HEADER_HEIGHT constant', () => {
      expect(ERD_HEADER_HEIGHT).toBe(30);
    });

    it('should export ERD_ATTRIBUTE_ROW_HEIGHT constant', () => {
      expect(ERD_ATTRIBUTE_ROW_HEIGHT).toBe(20);
    });

    it('should export ERD_MIN_WIDTH constant', () => {
      expect(ERD_MIN_WIDTH).toBe(150);
    });
  });
});
