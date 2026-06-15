/**
 * Integration tests for OAS data type functionality
 * Task Group 4: Integration Testing and ERD Rendering
 */

import { OAS_DATA_TYPE_OPTIONS, SQL_DATA_TYPE_OPTIONS } from '../config/defaults';
import { gridConfigs } from '../config/gridConfigs';
import { migrateDataType, migrateLogicalAttributes, isValidOASDataType } from '../utils/dataTypeMigration';
import { formatAttribute } from '../utils/erdUtils';
import { LogicalDataAttribute, PhysicalDataAttribute } from '../types/model';

describe('Data Type Integration', () => {
  describe('End-to-end attribute creation', () => {
    it('should allow creating Logical Attribute with OAS type', () => {
      const logicalAttr: LogicalDataAttribute = {
        id: 'la-1',
        name: 'user_id',
        description: 'User identifier',
        logical_entity_id: 'le-1',
        data_type: 'string_uuid',
        is_primary_key: true,
        is_nullable: false,
        tags: '',
      };

      expect(isValidOASDataType(logicalAttr.data_type)).toBe(true);
    });

    it('should allow creating Physical Attribute with SQL type', () => {
      const physicalAttr: PhysicalDataAttribute = {
        id: 'pa-1',
        name: 'user_id',
        description: 'User identifier',
        physical_entity_id: 'pe-1',
        data_type: 'VARCHAR',
        is_primary_key: true,
        is_nullable: false,
        tags: '',
      };

      // SQL types are not valid OAS types
      expect(isValidOASDataType(physicalAttr.data_type)).toBe(false);
      // But they should be in the SQL options
      expect(SQL_DATA_TYPE_OPTIONS).toContain('VARCHAR');
    });
  });

  describe('Grid dropdown options', () => {
    it('should provide OAS options for Logical Attribute dropdown', () => {
      const logicalConfig = gridConfigs.logical_data_attributes;
      const dataTypeCol = logicalConfig.find((col) => col.field === 'data_type');

      expect(dataTypeCol?.options).toBeDefined();
      expect(dataTypeCol?.options).toContain('string');
      expect(dataTypeCol?.options).toContain('string_uuid');
      expect(dataTypeCol?.options).toContain('integer');
      expect(dataTypeCol?.options).not.toContain('VARCHAR');
    });

    it('should provide SQL options for Physical Attribute dropdown', () => {
      const physicalConfig = gridConfigs.physical_data_attributes;
      const dataTypeCol = physicalConfig.find((col) => col.field === 'data_type');

      expect(dataTypeCol?.options).toBeDefined();
      expect(dataTypeCol?.options).toContain('VARCHAR');
      expect(dataTypeCol?.options).toContain('INTEGER');
      expect(dataTypeCol?.options).toContain('TIMESTAMP');
      expect(dataTypeCol?.options).not.toContain('string');
    });
  });

  describe('Save/Load cycle simulation', () => {
    it('should preserve OAS types through save/load', () => {
      const originalAttrs: LogicalDataAttribute[] = [
        {
          id: 'la-1',
          name: 'id',
          description: '',
          logical_entity_id: 'le-1',
          data_type: 'string_uuid',
          is_primary_key: true,
          is_nullable: false,
          tags: '',
        },
        {
          id: 'la-2',
          name: 'created_at',
          description: '',
          logical_entity_id: 'le-1',
          data_type: 'string_date-time',
          is_primary_key: false,
          is_nullable: false,
          tags: '',
        },
      ];

      // Simulate save (JSON.stringify) and load (JSON.parse + migration)
      const jsonStr = JSON.stringify(originalAttrs);
      const loaded = JSON.parse(jsonStr) as LogicalDataAttribute[];
      const migrated = migrateLogicalAttributes(loaded);

      // Types should be preserved (already OAS format)
      expect(migrated[0].data_type).toBe('string_uuid');
      expect(migrated[1].data_type).toBe('string_date-time');
    });

    it('should migrate SQL types on load of legacy diagram', () => {
      const legacyAttrs: LogicalDataAttribute[] = [
        {
          id: 'la-1',
          name: 'id',
          description: '',
          logical_entity_id: 'le-1',
          data_type: 'VARCHAR',  // Legacy SQL type
          is_primary_key: true,
          is_nullable: false,
          tags: '',
        },
        {
          id: 'la-2',
          name: 'created_at',
          description: '',
          logical_entity_id: 'le-1',
          data_type: 'TIMESTAMP',  // Legacy SQL type
          is_primary_key: false,
          is_nullable: false,
          tags: '',
        },
      ];

      // Simulate save (JSON.stringify) and load (JSON.parse + migration)
      const jsonStr = JSON.stringify(legacyAttrs);
      const loaded = JSON.parse(jsonStr) as LogicalDataAttribute[];
      const migrated = migrateLogicalAttributes(loaded);

      // Types should be migrated to OAS format
      expect(migrated[0].data_type).toBe('string');
      expect(migrated[1].data_type).toBe('string_date-time');

      // Verify they are valid OAS types
      expect(isValidOASDataType(migrated[0].data_type)).toBe(true);
      expect(isValidOASDataType(migrated[1].data_type)).toBe(true);
    });
  });

  describe('ERD rendering with OAS types', () => {
    it('should format attribute with OAS type correctly', () => {
      const attr = { name: 'user_id', data_type: 'string_uuid' };
      expect(formatAttribute(attr)).toBe('user_id : string_uuid');
    });

    it('should format attribute with complex OAS type', () => {
      const attr = { name: 'created_at', data_type: 'string_date-time' };
      expect(formatAttribute(attr)).toBe('created_at : string_date-time');
    });

    it('should handle attribute without type', () => {
      const attr = { name: 'data', data_type: '' };
      expect(formatAttribute(attr)).toBe('data');
    });

    it('should format all OAS types correctly', () => {
      OAS_DATA_TYPE_OPTIONS.forEach((type) => {
        const attr = { name: 'test_field', data_type: type };
        const formatted = formatAttribute(attr);
        expect(formatted).toBe(`test_field : ${type}`);
      });
    });
  });

  describe('Type differentiation between Logical and Physical', () => {
    it('should have completely different type sets', () => {
      // Get the actual options from grid configs
      const logicalOptions = gridConfigs.logical_data_attributes.find(
        (col) => col.field === 'data_type'
      )?.options || [];
      const physicalOptions = gridConfigs.physical_data_attributes.find(
        (col) => col.field === 'data_type'
      )?.options || [];

      // There should be no overlap
      const overlap = logicalOptions.filter((opt) =>
        physicalOptions.includes(opt)
      );
      expect(overlap).toHaveLength(0);
    });

    it('should use lowercase for OAS types', () => {
      OAS_DATA_TYPE_OPTIONS.forEach((type) => {
        // All OAS base types are lowercase
        const basePart = type.split('_')[0];
        expect(basePart).toBe(basePart.toLowerCase());
      });
    });

    it('should use uppercase for SQL types', () => {
      SQL_DATA_TYPE_OPTIONS.forEach((type) => {
        expect(type).toBe(type.toUpperCase());
      });
    });
  });

  describe('Migration consistency', () => {
    it('should consistently migrate all original dataTypeOptions', () => {
      // These were the original options before the change
      const originalTypes = [
        'VARCHAR',
        'INTEGER',
        'DECIMAL',
        'BOOLEAN',
        'TIMESTAMP',
        'DATE',
        'BLOB',
        'JSON',
      ];

      const expectedMigrations: Record<string, string> = {
        VARCHAR: 'string',
        INTEGER: 'integer',
        DECIMAL: 'number',
        BOOLEAN: 'boolean',
        TIMESTAMP: 'string_date-time',
        DATE: 'string_date',
        BLOB: 'string_binary',
        JSON: 'object',
      };

      originalTypes.forEach((type) => {
        const migrated = migrateDataType(type);
        expect(migrated).toBe(expectedMigrations[type]);
        expect(isValidOASDataType(migrated as string)).toBe(true);
      });
    });

    it('should not affect Physical Attribute types', () => {
      // Physical attributes should keep SQL types
      const physicalAttr: PhysicalDataAttribute = {
        id: 'pa-1',
        name: 'created_at',
        description: '',
        physical_entity_id: 'pe-1',
        data_type: 'TIMESTAMP',
        is_primary_key: false,
        is_nullable: false,
        tags: '',
      };

      // Physical types should remain as-is (not migrated)
      // They're stored and displayed with SQL types
      expect(physicalAttr.data_type).toBe('TIMESTAMP');
      expect(SQL_DATA_TYPE_OPTIONS).toContain('TIMESTAMP');
    });
  });
});
