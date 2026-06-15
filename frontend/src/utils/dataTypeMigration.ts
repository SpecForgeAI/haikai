/**
 * Data Type Migration Utilities
 *
 * Provides migration functions for converting legacy SQL-style data types
 * to OAS (OpenAPI) primitive types for Logical Attributes.
 *
 * This is used when loading existing diagrams that may contain SQL-style
 * data types in Logical Attribute records.
 */

import { OAS_DATA_TYPE_OPTIONS } from '../config/defaults';

/**
 * Mapping from legacy SQL data types to OAS equivalents.
 * Used when loading diagrams with old-style data type values.
 */
export const SQL_TO_OAS_MAPPING: Record<string, string> = {
  // String types
  VARCHAR: 'string',
  CHAR: 'string',
  TEXT: 'string',

  // Integer types
  INTEGER: 'integer',
  INT: 'integer',
  BIGINT: 'integer_int64',

  // Number types
  DECIMAL: 'number',
  NUMERIC: 'number',
  FLOAT: 'number_float',
  DOUBLE: 'number_double',

  // Boolean
  BOOLEAN: 'boolean',

  // Date/time types
  DATE: 'string_date',
  DATETIME: 'string_date-time',
  TIMESTAMP: 'string_date-time',

  // Binary types
  BINARY: 'string_binary',
  BLOB: 'string_binary',

  // Complex types
  JSON: 'object',
};

/**
 * Migrates a legacy SQL-style data type to its OAS equivalent.
 *
 * The function:
 * 1. Returns undefined if input is undefined
 * 2. Returns empty string if input is empty
 * 3. Normalizes input to uppercase for matching against SQL types
 * 4. Returns the mapped OAS type if a mapping exists
 * 5. Returns the original value if no mapping exists (may already be OAS format)
 *
 * @param legacyType - The data type value to migrate (may be SQL or OAS format)
 * @returns The migrated OAS type, or the original value if no mapping exists
 *
 * @example
 * migrateDataType('VARCHAR')     // returns 'string'
 * migrateDataType('TIMESTAMP')   // returns 'string_date-time'
 * migrateDataType('string_uuid') // returns 'string_uuid' (already OAS)
 * migrateDataType(undefined)     // returns undefined
 */
export function migrateDataType(legacyType: string | null | undefined): string | undefined {
  // Bug fix (2026-04-21): models saved by the V3 discovery pipeline can
  // persist `data_type: null` on logical_data_attributes (e.g. React prop
  // typed as a function/callback where we intentionally don't emit a type).
  // The JSON deserialises as `null`, NOT `undefined`. The previous
  // `=== undefined` check missed that path and crashed the whole app with
  // `null.toUpperCase()` on model load.
  if (legacyType === undefined || legacyType === null) {
    return undefined;
  }

  if (legacyType === '') {
    return '';
  }

  // Normalize to uppercase for SQL type matching
  const normalized = legacyType.toUpperCase();

  // Check if there's a mapping for this SQL type
  if (SQL_TO_OAS_MAPPING[normalized]) {
    return SQL_TO_OAS_MAPPING[normalized];
  }

  // No mapping found - return original value
  // This handles cases where the value is already an OAS type
  // or is an unknown custom type
  return legacyType;
}

/**
 * Checks if a data type value is a valid OAS data type.
 *
 * @param type - The data type value to validate
 * @returns true if the value is a valid OAS type, false otherwise
 *
 * @example
 * isValidOASDataType('string')       // returns true
 * isValidOASDataType('string_uuid')  // returns true
 * isValidOASDataType('VARCHAR')      // returns false
 * isValidOASDataType('')             // returns false
 */
export function isValidOASDataType(type: string): boolean {
  return (OAS_DATA_TYPE_OPTIONS as readonly string[]).includes(type);
}

/**
 * Migrates an array of Logical Data Attributes, converting any SQL-style
 * data types to OAS equivalents.
 *
 * @param attributes - Array of Logical Data Attribute objects
 * @returns New array with migrated data_type values
 *
 * @example
 * const migrated = migrateLogicalAttributes([
 *   { id: 'la-1', name: 'id', data_type: 'INTEGER', ... },
 *   { id: 'la-2', name: 'created', data_type: 'TIMESTAMP', ... },
 * ]);
 * // Returns:
 * // [
 * //   { id: 'la-1', name: 'id', data_type: 'integer', ... },
 * //   { id: 'la-2', name: 'created', data_type: 'string_date-time', ... },
 * // ]
 */
export function migrateLogicalAttributes<
  T extends { data_type?: string }
>(attributes: T[]): T[] {
  return attributes.map((attr) => ({
    ...attr,
    data_type: migrateDataType(attr.data_type) ?? '',
  }));
}
