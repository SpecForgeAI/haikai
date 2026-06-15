/**
 * Tests for OAS and SQL data type option definitions
 * Task Group 1: Define OAS and SQL Data Type Options
 */

import {
  OAS_DATA_TYPE_OPTIONS,
  SQL_DATA_TYPE_OPTIONS,
  dataTypeOptions,
} from '../config/defaults';
import { OASDataType, SQLDataType } from '../types/model';

describe('Data Type Options', () => {
  describe('OAS_DATA_TYPE_OPTIONS', () => {
    it('should contain all 16 OAS data types', () => {
      expect(OAS_DATA_TYPE_OPTIONS).toHaveLength(16);
    });

    it('should include string category types', () => {
      const stringTypes = [
        'string',
        'string_uuid',
        'string_date',
        'string_date-time',
        'string_password',
        'string_byte',
        'string_binary',
      ];
      stringTypes.forEach((type) => {
        expect(OAS_DATA_TYPE_OPTIONS).toContain(type);
      });
    });

    it('should include number category types', () => {
      const numberTypes = ['number', 'number_float', 'number_double'];
      numberTypes.forEach((type) => {
        expect(OAS_DATA_TYPE_OPTIONS).toContain(type);
      });
    });

    it('should include integer category types', () => {
      const integerTypes = ['integer', 'integer_int32', 'integer_int64'];
      integerTypes.forEach((type) => {
        expect(OAS_DATA_TYPE_OPTIONS).toContain(type);
      });
    });

    it('should include boolean type', () => {
      expect(OAS_DATA_TYPE_OPTIONS).toContain('boolean');
    });

    it('should include complex types (array and object)', () => {
      expect(OAS_DATA_TYPE_OPTIONS).toContain('array');
      expect(OAS_DATA_TYPE_OPTIONS).toContain('object');
    });

    it('should be defined as const for type inference', () => {
      // This test verifies that the array is readonly
      // The type system would catch attempts to mutate it
      expect(Object.isFrozen(OAS_DATA_TYPE_OPTIONS)).toBe(true);
    });
  });

  describe('SQL_DATA_TYPE_OPTIONS', () => {
    it('should contain SQL-style data types', () => {
      // Should have at least the original 8 types plus expanded types
      expect(SQL_DATA_TYPE_OPTIONS.length).toBeGreaterThanOrEqual(8);
    });

    it('should include VARCHAR, INTEGER, DECIMAL, TIMESTAMP', () => {
      expect(SQL_DATA_TYPE_OPTIONS).toContain('VARCHAR');
      expect(SQL_DATA_TYPE_OPTIONS).toContain('INTEGER');
      expect(SQL_DATA_TYPE_OPTIONS).toContain('DECIMAL');
      expect(SQL_DATA_TYPE_OPTIONS).toContain('TIMESTAMP');
    });

    it('should include additional SQL types (CHAR, TEXT, BIGINT)', () => {
      expect(SQL_DATA_TYPE_OPTIONS).toContain('CHAR');
      expect(SQL_DATA_TYPE_OPTIONS).toContain('TEXT');
      expect(SQL_DATA_TYPE_OPTIONS).toContain('BIGINT');
    });

    it('should include BOOLEAN, DATE, BLOB, JSON', () => {
      expect(SQL_DATA_TYPE_OPTIONS).toContain('BOOLEAN');
      expect(SQL_DATA_TYPE_OPTIONS).toContain('DATE');
      expect(SQL_DATA_TYPE_OPTIONS).toContain('BLOB');
      expect(SQL_DATA_TYPE_OPTIONS).toContain('JSON');
    });

    it('should be defined as const for type inference', () => {
      expect(Object.isFrozen(SQL_DATA_TYPE_OPTIONS)).toBe(true);
    });
  });

  describe('dataTypeOptions (deprecated)', () => {
    it('should still be available for backward compatibility', () => {
      expect(dataTypeOptions).toBeDefined();
      expect(Array.isArray(dataTypeOptions)).toBe(true);
    });

    it('should equal SQL_DATA_TYPE_OPTIONS', () => {
      expect(dataTypeOptions).toEqual(SQL_DATA_TYPE_OPTIONS);
    });
  });

  describe('TypeScript Types', () => {
    it('should accept valid OAS data type values', () => {
      // Type assertion test - if this compiles, the type accepts these values
      const validOASTypes: OASDataType[] = [
        'string',
        'string_uuid',
        'string_date',
        'string_date-time',
        'string_password',
        'string_byte',
        'string_binary',
        'number',
        'number_float',
        'number_double',
        'integer',
        'integer_int32',
        'integer_int64',
        'boolean',
        'array',
        'object',
      ];
      expect(validOASTypes).toHaveLength(16);
    });

    it('should accept valid SQL data type values', () => {
      // Type assertion test - if this compiles, the type accepts these values
      const validSQLTypes: SQLDataType[] = [
        'VARCHAR',
        'CHAR',
        'TEXT',
        'INTEGER',
        'BIGINT',
        'DECIMAL',
        'NUMERIC',
        'FLOAT',
        'DOUBLE',
        'BOOLEAN',
        'DATE',
        'DATETIME',
        'TIMESTAMP',
        'BINARY',
        'BLOB',
        'JSON',
      ];
      expect(validSQLTypes).toHaveLength(16);
    });
  });

  describe('OAS type format conventions', () => {
    it('should use underscore to separate type from format', () => {
      // Types with format should have underscore separator
      const typesWithFormat = OAS_DATA_TYPE_OPTIONS.filter((t) =>
        t.includes('_')
      );
      expect(typesWithFormat.length).toBeGreaterThan(0);

      // All underscore types should follow pattern: basetype_format
      typesWithFormat.forEach((type) => {
        const parts = type.split('_');
        expect(parts.length).toBe(2);
        expect(['string', 'number', 'integer']).toContain(parts[0]);
      });
    });

    it('should have base types without underscore', () => {
      // Base types without format shouldn't have underscore
      const baseTypes = ['string', 'number', 'integer', 'boolean', 'array', 'object'];
      baseTypes.forEach((type) => {
        expect(OAS_DATA_TYPE_OPTIONS).toContain(type);
        expect(type.includes('_')).toBe(false);
      });
    });
  });
});
