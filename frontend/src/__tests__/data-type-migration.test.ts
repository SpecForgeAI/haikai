/**
 * Tests for legacy data type migration utilities
 * Task Group 3: Implement Legacy Data Type Migration
 */

import {
  SQL_TO_OAS_MAPPING,
  migrateDataType,
  isValidOASDataType,
} from '../utils/dataTypeMigration';
import { OAS_DATA_TYPE_OPTIONS } from '../config/defaults';

describe('Data Type Migration', () => {
  describe('SQL_TO_OAS_MAPPING', () => {
    it('should have mappings for common SQL types', () => {
      expect(SQL_TO_OAS_MAPPING).toHaveProperty('VARCHAR');
      expect(SQL_TO_OAS_MAPPING).toHaveProperty('INTEGER');
      expect(SQL_TO_OAS_MAPPING).toHaveProperty('DECIMAL');
      expect(SQL_TO_OAS_MAPPING).toHaveProperty('TIMESTAMP');
    });

    it('should map VARCHAR to string', () => {
      expect(SQL_TO_OAS_MAPPING['VARCHAR']).toBe('string');
    });

    it('should map INTEGER to integer', () => {
      expect(SQL_TO_OAS_MAPPING['INTEGER']).toBe('integer');
    });

    it('should map TIMESTAMP to string_date-time', () => {
      expect(SQL_TO_OAS_MAPPING['TIMESTAMP']).toBe('string_date-time');
    });

    it('should map DECIMAL to number', () => {
      expect(SQL_TO_OAS_MAPPING['DECIMAL']).toBe('number');
    });

    it('should map BIGINT to integer_int64', () => {
      expect(SQL_TO_OAS_MAPPING['BIGINT']).toBe('integer_int64');
    });

    it('should map DATE to string_date', () => {
      expect(SQL_TO_OAS_MAPPING['DATE']).toBe('string_date');
    });

    it('should map JSON to object', () => {
      expect(SQL_TO_OAS_MAPPING['JSON']).toBe('object');
    });

    it('should map BLOB to string_binary', () => {
      expect(SQL_TO_OAS_MAPPING['BLOB']).toBe('string_binary');
    });
  });

  describe('migrateDataType', () => {
    it('should migrate VARCHAR to string', () => {
      expect(migrateDataType('VARCHAR')).toBe('string');
    });

    it('should migrate INTEGER to integer', () => {
      expect(migrateDataType('INTEGER')).toBe('integer');
    });

    it('should migrate TIMESTAMP to string_date-time', () => {
      expect(migrateDataType('TIMESTAMP')).toBe('string_date-time');
    });

    it('should migrate DECIMAL to number', () => {
      expect(migrateDataType('DECIMAL')).toBe('number');
    });

    it('should handle lowercase input', () => {
      expect(migrateDataType('varchar')).toBe('string');
      expect(migrateDataType('integer')).toBe('integer');
    });

    it('should handle mixed case input', () => {
      expect(migrateDataType('VarChar')).toBe('string');
      expect(migrateDataType('Integer')).toBe('integer');
    });

    it('should preserve already-valid OAS type', () => {
      expect(migrateDataType('string')).toBe('string');
      expect(migrateDataType('string_uuid')).toBe('string_uuid');
      expect(migrateDataType('integer_int64')).toBe('integer_int64');
    });

    it('should preserve unknown type as-is', () => {
      expect(migrateDataType('UNKNOWN_TYPE')).toBe('UNKNOWN_TYPE');
      expect(migrateDataType('custom_type')).toBe('custom_type');
    });

    it('should return undefined for undefined input', () => {
      expect(migrateDataType(undefined)).toBeUndefined();
    });

    it('should return empty string for empty string input', () => {
      expect(migrateDataType('')).toBe('');
    });

    it('should handle null-like values correctly', () => {
      // Empty string is returned as-is
      expect(migrateDataType('')).toBe('');
    });
  });

  describe('isValidOASDataType', () => {
    it('should return true for valid OAS types', () => {
      expect(isValidOASDataType('string')).toBe(true);
      expect(isValidOASDataType('string_uuid')).toBe(true);
      expect(isValidOASDataType('integer')).toBe(true);
      expect(isValidOASDataType('boolean')).toBe(true);
    });

    it('should return true for all OAS_DATA_TYPE_OPTIONS values', () => {
      OAS_DATA_TYPE_OPTIONS.forEach((type) => {
        expect(isValidOASDataType(type)).toBe(true);
      });
    });

    it('should return false for SQL types', () => {
      expect(isValidOASDataType('VARCHAR')).toBe(false);
      expect(isValidOASDataType('INTEGER')).toBe(false);
      expect(isValidOASDataType('TIMESTAMP')).toBe(false);
    });

    it('should return false for unknown types', () => {
      expect(isValidOASDataType('UNKNOWN')).toBe(false);
      expect(isValidOASDataType('')).toBe(false);
    });

    it('should be case-sensitive', () => {
      // OAS types are lowercase, so uppercase should fail
      expect(isValidOASDataType('STRING')).toBe(false);
      expect(isValidOASDataType('Boolean')).toBe(false);
    });
  });

  describe('Migration edge cases', () => {
    it('should migrate all original dataTypeOptions values', () => {
      // Original values: VARCHAR, INTEGER, DECIMAL, BOOLEAN, TIMESTAMP, DATE, BLOB, JSON
      const originalTypes = ['VARCHAR', 'INTEGER', 'DECIMAL', 'BOOLEAN', 'TIMESTAMP', 'DATE', 'BLOB', 'JSON'];

      originalTypes.forEach((type) => {
        const migrated = migrateDataType(type);
        expect(migrated).toBeDefined();
        expect(isValidOASDataType(migrated as string)).toBe(true);
      });
    });

    it('should handle DATETIME as alias for TIMESTAMP', () => {
      expect(migrateDataType('DATETIME')).toBe('string_date-time');
    });

    it('should handle INT as alias for INTEGER', () => {
      expect(migrateDataType('INT')).toBe('integer');
    });

    it('should handle NUMERIC as alias for DECIMAL', () => {
      expect(migrateDataType('NUMERIC')).toBe('number');
    });

    it('should handle FLOAT to number_float', () => {
      expect(migrateDataType('FLOAT')).toBe('number_float');
    });

    it('should handle DOUBLE to number_double', () => {
      expect(migrateDataType('DOUBLE')).toBe('number_double');
    });
  });
});
