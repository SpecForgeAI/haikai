/**
 * Unit tests for logicalTypeToOas service
 *
 * Tests the mapping of logical data types from the architecture model
 * to OpenAPI Schema representations.
 */

import { mapLogicalTypeToOas, LOGICAL_TYPE_MAPPINGS } from '../services/logicalTypeToOas';

describe('logicalTypeToOas Service', () => {
  // ============================================================================
  // Test 1: string maps to { type: "string" }
  // ============================================================================
  describe('string type mapping', () => {
    it('maps "string" to { type: "string" }', () => {
      const result = mapLogicalTypeToOas('string');

      expect(result.schema).toEqual({ type: 'string' });
      expect(result.isUnknown).toBe(false);
    });

    it('handles case-insensitive matching for "STRING"', () => {
      const result = mapLogicalTypeToOas('STRING');

      expect(result.schema).toEqual({ type: 'string' });
      expect(result.isUnknown).toBe(false);
    });
  });

  // ============================================================================
  // Test 2: string_uuid maps to { type: "string", format: "uuid" }
  // ============================================================================
  describe('string_uuid type mapping', () => {
    it('maps "string_uuid" to { type: "string", format: "uuid" }', () => {
      const result = mapLogicalTypeToOas('string_uuid');

      expect(result.schema).toEqual({ type: 'string', format: 'uuid' });
      expect(result.isUnknown).toBe(false);
    });

    it('handles case-insensitive matching for "String_UUID"', () => {
      const result = mapLogicalTypeToOas('String_UUID');

      expect(result.schema).toEqual({ type: 'string', format: 'uuid' });
      expect(result.isUnknown).toBe(false);
    });
  });

  // ============================================================================
  // Test 3: integer_int64 maps to { type: "integer", format: "int64" }
  // ============================================================================
  describe('integer_int64 type mapping', () => {
    it('maps "integer_int64" to { type: "integer", format: "int64" }', () => {
      const result = mapLogicalTypeToOas('integer_int64');

      expect(result.schema).toEqual({ type: 'integer', format: 'int64' });
      expect(result.isUnknown).toBe(false);
    });

    it('handles case-insensitive matching for "INTEGER_INT64"', () => {
      const result = mapLogicalTypeToOas('INTEGER_INT64');

      expect(result.schema).toEqual({ type: 'integer', format: 'int64' });
      expect(result.isUnknown).toBe(false);
    });
  });

  // ============================================================================
  // Test 4: number_double maps to { type: "number", format: "double" }
  // ============================================================================
  describe('number_double type mapping', () => {
    it('maps "number_double" to { type: "number", format: "double" }', () => {
      const result = mapLogicalTypeToOas('number_double');

      expect(result.schema).toEqual({ type: 'number', format: 'double' });
      expect(result.isUnknown).toBe(false);
    });

    it('handles case-insensitive matching for "Number_Double"', () => {
      const result = mapLogicalTypeToOas('Number_Double');

      expect(result.schema).toEqual({ type: 'number', format: 'double' });
      expect(result.isUnknown).toBe(false);
    });
  });

  // ============================================================================
  // Test 5: boolean maps to { type: "boolean" }
  // ============================================================================
  describe('boolean type mapping', () => {
    it('maps "boolean" to { type: "boolean" }', () => {
      const result = mapLogicalTypeToOas('boolean');

      expect(result.schema).toEqual({ type: 'boolean' });
      expect(result.isUnknown).toBe(false);
    });

    it('handles case-insensitive matching for "BOOLEAN"', () => {
      const result = mapLogicalTypeToOas('BOOLEAN');

      expect(result.schema).toEqual({ type: 'boolean' });
      expect(result.isUnknown).toBe(false);
    });
  });

  // ============================================================================
  // Test 6: unknown type returns { type: "string" } and emits warning flag
  // ============================================================================
  describe('unknown type handling', () => {
    it('returns { type: "string" } with isUnknown: true for unknown types', () => {
      const result = mapLogicalTypeToOas('custom_unknown_type');

      expect(result.schema).toEqual({ type: 'string' });
      expect(result.isUnknown).toBe(true);
    });

    it('handles empty string as unknown type', () => {
      const result = mapLogicalTypeToOas('');

      expect(result.schema).toEqual({ type: 'string' });
      expect(result.isUnknown).toBe(true);
    });

    it('handles whitespace-only string as unknown type', () => {
      const result = mapLogicalTypeToOas('   ');

      expect(result.schema).toEqual({ type: 'string' });
      expect(result.isUnknown).toBe(true);
    });
  });

  // ============================================================================
  // Additional coverage: verify all 15 mappings are present
  // ============================================================================
  describe('LOGICAL_TYPE_MAPPINGS dictionary', () => {
    it('contains exactly 16 mappings', () => {
      const mappingCount = Object.keys(LOGICAL_TYPE_MAPPINGS).length;
      expect(mappingCount).toBe(16);
    });

    it('contains all string type variants', () => {
      expect(LOGICAL_TYPE_MAPPINGS['string']).toEqual({ type: 'string' });
      expect(LOGICAL_TYPE_MAPPINGS['string_uuid']).toEqual({ type: 'string', format: 'uuid' });
      expect(LOGICAL_TYPE_MAPPINGS['string_date']).toEqual({ type: 'string', format: 'date' });
      expect(LOGICAL_TYPE_MAPPINGS['string_date-time']).toEqual({ type: 'string', format: 'date-time' });
      expect(LOGICAL_TYPE_MAPPINGS['string_password']).toEqual({ type: 'string', format: 'password' });
      expect(LOGICAL_TYPE_MAPPINGS['string_byte']).toEqual({ type: 'string', format: 'byte' });
      expect(LOGICAL_TYPE_MAPPINGS['string_binary']).toEqual({ type: 'string', format: 'binary' });
    });

    it('contains boolean type', () => {
      expect(LOGICAL_TYPE_MAPPINGS['boolean']).toEqual({ type: 'boolean' });
    });

    it('contains all integer type variants', () => {
      expect(LOGICAL_TYPE_MAPPINGS['integer']).toEqual({ type: 'integer' });
      expect(LOGICAL_TYPE_MAPPINGS['integer_int32']).toEqual({ type: 'integer', format: 'int32' });
      expect(LOGICAL_TYPE_MAPPINGS['integer_int64']).toEqual({ type: 'integer', format: 'int64' });
    });

    it('contains all number type variants', () => {
      expect(LOGICAL_TYPE_MAPPINGS['number']).toEqual({ type: 'number' });
      expect(LOGICAL_TYPE_MAPPINGS['number_float']).toEqual({ type: 'number', format: 'float' });
      expect(LOGICAL_TYPE_MAPPINGS['number_double']).toEqual({ type: 'number', format: 'double' });
    });

    it('contains complex types', () => {
      expect(LOGICAL_TYPE_MAPPINGS['array']).toEqual({ type: 'array' });
      expect(LOGICAL_TYPE_MAPPINGS['object']).toEqual({ type: 'object' });
    });
  });

  // ============================================================================
  // Pure function verification
  // ============================================================================
  describe('function purity', () => {
    it('returns new schema object on each call (no mutation)', () => {
      const result1 = mapLogicalTypeToOas('string_uuid');
      const result2 = mapLogicalTypeToOas('string_uuid');

      // Verify they are equal but not the same reference
      expect(result1.schema).toEqual(result2.schema);
      expect(result1.schema).not.toBe(result2.schema);
    });

    it('does not mutate the LOGICAL_TYPE_MAPPINGS constant', () => {
      const originalMapping = { ...LOGICAL_TYPE_MAPPINGS['string_uuid'] };

      const result = mapLogicalTypeToOas('string_uuid');
      result.schema.customField = 'test';

      // Verify original mapping is unchanged
      expect(LOGICAL_TYPE_MAPPINGS['string_uuid']).toEqual(originalMapping);
    });
  });
});
