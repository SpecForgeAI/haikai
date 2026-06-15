/**
 * Service for mapping logical data types from the architecture model
 * to OpenAPI Schema (OAS) representations.
 *
 * This is a pure, stateless mapping service that provides deterministic
 * type conversions for OAS generation.
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Result of mapping a logical type to OAS schema
 */
export interface LogicalTypeMapResult {
  /** The OAS schema object */
  schema: Record<string, unknown>;
  /** True if the logical type was not found in the mapping dictionary */
  isUnknown: boolean;
}

// ============================================================================
// Logical Type Mappings
// ============================================================================

/**
 * Static mapping dictionary from logical types to OAS schema definitions.
 * All keys are stored in lowercase for case-insensitive matching.
 *
 * Includes all 15 standard mappings as per spec:
 * - String types: string, string_uuid, string_date, string_date-time,
 *                 string_password, string_byte, string_binary
 * - Boolean: boolean
 * - Integer types: integer, integer_int32, integer_int64
 * - Number types: number, number_float, number_double
 * - Complex types: array, object
 */
export const LOGICAL_TYPE_MAPPINGS: Record<string, Record<string, unknown>> = {
  // String types
  'string': { type: 'string' },
  'string_uuid': { type: 'string', format: 'uuid' },
  'string_date': { type: 'string', format: 'date' },
  'string_date-time': { type: 'string', format: 'date-time' },
  'string_password': { type: 'string', format: 'password' },
  'string_byte': { type: 'string', format: 'byte' },
  'string_binary': { type: 'string', format: 'binary' },

  // Boolean type
  'boolean': { type: 'boolean' },

  // Integer types
  'integer': { type: 'integer' },
  'integer_int32': { type: 'integer', format: 'int32' },
  'integer_int64': { type: 'integer', format: 'int64' },

  // Number types
  'number': { type: 'number' },
  'number_float': { type: 'number', format: 'float' },
  'number_double': { type: 'number', format: 'double' },

  // Complex types
  'array': { type: 'array' },
  'object': { type: 'object' },
};

// ============================================================================
// Mapping Function
// ============================================================================

/**
 * Maps a logical data type to its corresponding OpenAPI schema representation.
 *
 * @param logicalType - The logical type name from the architecture model
 * @returns Object containing the OAS schema and a flag indicating if the type was unknown
 *
 * @example
 * // Known type
 * mapLogicalTypeToOas('string_uuid')
 * // Returns: { schema: { type: 'string', format: 'uuid' }, isUnknown: false }
 *
 * @example
 * // Unknown type falls back to string
 * mapLogicalTypeToOas('custom_type')
 * // Returns: { schema: { type: 'string' }, isUnknown: true }
 */
export function mapLogicalTypeToOas(logicalType: string): LogicalTypeMapResult {
  // Handle null/undefined/empty input
  if (!logicalType || typeof logicalType !== 'string') {
    return {
      schema: { type: 'string' },
      isUnknown: true,
    };
  }

  // Normalize to lowercase for case-insensitive matching
  const normalizedType = logicalType.toLowerCase().trim();

  // Look up in the mapping dictionary
  const mapping = LOGICAL_TYPE_MAPPINGS[normalizedType];

  if (mapping) {
    // Return a shallow copy to prevent mutation of the constant
    return {
      schema: { ...mapping },
      isUnknown: false,
    };
  }

  // Unknown type: return string as fallback with warning flag
  return {
    schema: { type: 'string' },
    isUnknown: true,
  };
}
