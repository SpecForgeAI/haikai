/**
 * Excel Worksheet Names Tests
 *
 * Spec 2026-01-11: Fix Export as XLSX by Enforcing Excel-Safe Worksheet Names
 *
 * These tests verify:
 * - META_MODEL_XLSX_SHEET_NAME_BY_KEY canonical mapping constant
 * - getSheetNameForKey() function for canonical sheet name lookup
 * - toExcelSafeSheetName() function for Excel constraint enforcement
 * - ensureUniqueSheetName() function for collision handling
 * - Export worksheet naming using key-based approach
 * - Reverse mapping functions for import compatibility
 */

import { describe, it, expect } from 'vitest';
import {
  META_MODEL_XLSX_SHEET_NAME_BY_KEY,
  XLSX_SHEET_NAME_TO_KEY,
  getSheetNameForKey,
  toExcelSafeSheetName,
  ensureUniqueSheetName,
  worksheetNameToEntityType,
  worksheetNameToRelationshipType,
  getExportableEntityTypes,
  getExportableRelationshipTypes,
} from '../utils/excelOperations';
import {
  tabToEntityType,
  relationshipTabToType,
} from '../config/gridConfigs';

// ============================================================================
// Task Group 1: Helper Function Tests (6 tests)
// ============================================================================

describe('META_MODEL_XLSX_SHEET_NAME_BY_KEY canonical mapping', () => {
  it('contains all 5 abbreviated entries for overlength relationship keys', () => {
    // The 5 overlength relationship keys that need abbreviation
    const overlengthKeys = [
      'application_point_business_points',
      'logical_data_entity_relationships',
      'application_point_business_logics',
      'logical_data_entity_physical_data_entities',
      'logical_data_attribute_physical_data_attributes',
    ];

    // Verify all 5 are present in the mapping
    for (const key of overlengthKeys) {
      expect(META_MODEL_XLSX_SHEET_NAME_BY_KEY).toHaveProperty(key);
    }

    // Verify the exact abbreviated names
    expect(META_MODEL_XLSX_SHEET_NAME_BY_KEY['application_point_business_points']).toBe('app_point_business_points');
    expect(META_MODEL_XLSX_SHEET_NAME_BY_KEY['logical_data_entity_relationships']).toBe('logical_entity_relationships');
    expect(META_MODEL_XLSX_SHEET_NAME_BY_KEY['application_point_business_logics']).toBe('app_point_business_logics');
    expect(META_MODEL_XLSX_SHEET_NAME_BY_KEY['logical_data_entity_physical_data_entities']).toBe('logical_entity_physical_ents');
    expect(META_MODEL_XLSX_SHEET_NAME_BY_KEY['logical_data_attribute_physical_data_attributes']).toBe('logical_attr_physical_attrs');

    // Verify all abbreviated names are <= 31 characters
    for (const [key, sheetName] of Object.entries(META_MODEL_XLSX_SHEET_NAME_BY_KEY)) {
      expect(sheetName.length).toBeLessThanOrEqual(31);
    }
  });
});

describe('getSheetNameForKey', () => {
  it('returns abbreviated name for overlength keys', () => {
    // Test each overlength key returns its abbreviated form
    expect(getSheetNameForKey('application_point_business_points')).toBe('app_point_business_points');
    expect(getSheetNameForKey('logical_data_entity_relationships')).toBe('logical_entity_relationships');
    expect(getSheetNameForKey('application_point_business_logics')).toBe('app_point_business_logics');
    expect(getSheetNameForKey('logical_data_entity_physical_data_entities')).toBe('logical_entity_physical_ents');
    expect(getSheetNameForKey('logical_data_attribute_physical_data_attributes')).toBe('logical_attr_physical_attrs');
  });

  it('returns identity (key itself) for normal keys that fit within 31 chars', () => {
    // Normal entity keys should return themselves
    expect(getSheetNameForKey('business_users')).toBe('business_users');
    expect(getSheetNameForKey('applications')).toBe('applications');
    expect(getSheetNameForKey('services')).toBe('services');
    expect(getSheetNameForKey('interactions')).toBe('interactions');
    expect(getSheetNameForKey('data_movements')).toBe('data_movements');

    // Normal relationship keys should return themselves
    expect(getSheetNameForKey('business_user_business_points')).toBe('business_user_business_points');
    expect(getSheetNameForKey('interface_logical_entities')).toBe('interface_logical_entities');
  });
});

describe('toExcelSafeSheetName', () => {
  it('truncates names exceeding 31 characters', () => {
    const longName = 'this_is_a_very_long_sheet_name_that_exceeds_limit';
    const result = toExcelSafeSheetName(longName);

    expect(result.length).toBe(31);
    expect(result).toBe('this_is_a_very_long_sheet_name_');
  });

  it('replaces illegal characters \\ / ? * [ ] with underscore', () => {
    // Test each illegal character individually
    expect(toExcelSafeSheetName('name\\with\\backslash')).toBe('name_with_backslash');
    expect(toExcelSafeSheetName('name/with/slash')).toBe('name_with_slash');
    expect(toExcelSafeSheetName('name?with?question')).toBe('name_with_question');
    expect(toExcelSafeSheetName('name*with*asterisk')).toBe('name_with_asterisk');
    expect(toExcelSafeSheetName('name[with[bracket')).toBe('name_with_bracket');
    expect(toExcelSafeSheetName('name]with]bracket')).toBe('name_with_bracket');

    // Test multiple illegal characters in one string
    expect(toExcelSafeSheetName('a\\b/c?d*e[f]g')).toBe('a_b_c_d_e_f_g');
  });

  it('trims leading and trailing whitespace', () => {
    expect(toExcelSafeSheetName('  trimmed  ')).toBe('trimmed');
    expect(toExcelSafeSheetName('\ttabbed\t')).toBe('tabbed');
    expect(toExcelSafeSheetName('\n  newline  \n')).toBe('newline');
  });

  it('handles combination of constraints', () => {
    // Long name with illegal chars and whitespace
    const input = '  very/long*name?with[illegal]chars\\that\\exceeds  ';
    const result = toExcelSafeSheetName(input);

    expect(result.length).toBeLessThanOrEqual(31);
    expect(result).not.toContain('/');
    expect(result).not.toContain('*');
    expect(result).not.toContain('?');
    expect(result).not.toContain('[');
    expect(result).not.toContain(']');
    expect(result).not.toContain('\\');
    expect(result).not.toMatch(/^\s/);
    expect(result).not.toMatch(/\s$/);
  });
});

describe('ensureUniqueSheetName', () => {
  it('returns name unchanged when no collision exists', () => {
    const existingNames = new Set<string>(['sheet1', 'sheet2']);
    const result = ensureUniqueSheetName('new_sheet', existingNames);

    expect(result).toBe('new_sheet');
    expect(existingNames.has('new_sheet')).toBe(true);
  });

  it('appends _2, _3, etc. on collision until unique', () => {
    const existingNames = new Set<string>(['my_sheet', 'my_sheet_2', 'my_sheet_3']);
    const result = ensureUniqueSheetName('my_sheet', existingNames);

    expect(result).toBe('my_sheet_4');
    expect(existingNames.has('my_sheet_4')).toBe(true);
  });

  it('adds the returned name to existingNames set', () => {
    const existingNames = new Set<string>();

    const result1 = ensureUniqueSheetName('sheet', existingNames);
    expect(result1).toBe('sheet');
    expect(existingNames.size).toBe(1);
    expect(existingNames.has('sheet')).toBe(true);

    const result2 = ensureUniqueSheetName('sheet', existingNames);
    expect(result2).toBe('sheet_2');
    expect(existingNames.size).toBe(2);
    expect(existingNames.has('sheet_2')).toBe(true);
  });
});

// ============================================================================
// Task Group 2: Export Worksheet Naming Tests (4 tests)
// ============================================================================

describe('Export worksheet naming', () => {
  it('entity worksheets use getSheetNameForKey(entityType) not tab names', () => {
    // Verify that entity types produce valid sheet names via getSheetNameForKey
    const entityTypes = getExportableEntityTypes();

    for (const entityType of entityTypes) {
      const sheetName = getSheetNameForKey(entityType);
      // Sheet name should be valid (no illegal chars, <= 31 chars)
      expect(sheetName.length).toBeLessThanOrEqual(31);
      expect(sheetName).not.toMatch(/[\\/?*[\]]/);
    }
  });

  it('relationship worksheets use getSheetNameForKey(relType) not tab names', () => {
    // Verify that relationship types produce valid sheet names via getSheetNameForKey
    const relTypes = getExportableRelationshipTypes();

    for (const relType of relTypes) {
      const sheetName = getSheetNameForKey(relType);
      // Sheet name should be valid (no illegal chars, <= 31 chars)
      expect(sheetName.length).toBeLessThanOrEqual(31);
      expect(sheetName).not.toMatch(/[\\/?*[\]]/);
    }
  });

  it('all exported sheet names pass toExcelSafeSheetName validation', () => {
    const entityTypes = getExportableEntityTypes();
    const relTypes = getExportableRelationshipTypes();
    const allTypes = [...entityTypes, ...relTypes];

    for (const type of allTypes) {
      const sheetName = getSheetNameForKey(type);
      const safeSheetName = toExcelSafeSheetName(sheetName);

      // The sheet name should already be safe, so toExcelSafeSheetName should not change it
      expect(safeSheetName).toBe(sheetName);
    }
  });

  it('no duplicate sheet names in exported workbook', () => {
    const entityTypes = getExportableEntityTypes();
    const relTypes = getExportableRelationshipTypes();
    const allTypes = [...entityTypes, ...relTypes];

    const sheetNames = new Set<string>();
    const duplicates: string[] = [];

    for (const type of allTypes) {
      const sheetName = getSheetNameForKey(type);
      if (sheetNames.has(sheetName)) {
        duplicates.push(sheetName);
      }
      sheetNames.add(sheetName);
    }

    expect(duplicates).toEqual([]);
    expect(sheetNames.size).toBe(allTypes.length);
  });
});

// ============================================================================
// Task Group 3: Reverse Mapping Tests (4 tests)
// ============================================================================

describe('Reverse mapping functions', () => {
  it('worksheetNameToEntityType recognizes all entity sheet names', () => {
    // Get all entity types and verify reverse mapping works
    const entityTypes = Object.values(tabToEntityType);

    for (const entityType of entityTypes) {
      // Skip derived entity types that are excluded from export
      if (['application_points', 'business_points', 'app_business_points'].includes(entityType)) {
        continue;
      }

      const sheetName = getSheetNameForKey(entityType);
      const resolvedType = worksheetNameToEntityType(sheetName);

      // The reverse mapping should return the original entity type
      expect(resolvedType).toBe(entityType);
    }
  });

  it('worksheetNameToRelationshipType recognizes all abbreviated relationship sheet names', () => {
    // Get all relationship types and verify reverse mapping works
    const relTypes = Object.values(relationshipTabToType);

    for (const relType of relTypes) {
      const sheetName = getSheetNameForKey(relType);
      const resolvedType = worksheetNameToRelationshipType(sheetName);

      // The reverse mapping should return the original relationship type
      expect(resolvedType).toBe(relType);
    }
  });

  it('reverse mapping is exact inverse of getSheetNameForKey for all keys', () => {
    // Verify for entity types
    const entityTypes = Object.values(tabToEntityType);
    for (const entityType of entityTypes) {
      if (['application_points', 'business_points', 'app_business_points'].includes(entityType)) {
        continue;
      }
      const sheetName = getSheetNameForKey(entityType);
      const resolvedType = worksheetNameToEntityType(sheetName);
      expect(resolvedType).toBe(entityType);
    }

    // Verify for relationship types
    const relTypes = Object.values(relationshipTabToType);
    for (const relType of relTypes) {
      const sheetName = getSheetNameForKey(relType);
      const resolvedType = worksheetNameToRelationshipType(sheetName);
      expect(resolvedType).toBe(relType);
    }
  });

  it('reverse mapping handles unknown sheet names gracefully (returns undefined)', () => {
    // Unknown entity sheet names should return undefined
    expect(worksheetNameToEntityType('unknown_sheet')).toBeUndefined();
    expect(worksheetNameToEntityType('random_data')).toBeUndefined();
    expect(worksheetNameToEntityType('')).toBeUndefined();

    // Unknown relationship sheet names should return undefined
    expect(worksheetNameToRelationshipType('unknown_rel_sheet')).toBeUndefined();
    expect(worksheetNameToRelationshipType('some_random_name')).toBeUndefined();
    expect(worksheetNameToRelationshipType('')).toBeUndefined();
  });
});

// ============================================================================
// Task Group 4: Additional Strategic Tests (up to 6 tests)
// ============================================================================

describe('Comprehensive validation', () => {
  it('all entity types produce valid sheet names (comprehensive scan)', () => {
    const entityTypes = Object.values(tabToEntityType);

    for (const entityType of entityTypes) {
      const sheetName = getSheetNameForKey(entityType);

      // Validate all Excel constraints
      expect(sheetName.length).toBeLessThanOrEqual(31);
      expect(sheetName).not.toMatch(/[\\/?*[\]]/);
      expect(sheetName.trim()).toBe(sheetName);
      expect(sheetName.length).toBeGreaterThan(0);
    }
  });

  it('all relationship types produce valid sheet names (comprehensive scan)', () => {
    const relTypes = Object.values(relationshipTabToType);

    for (const relType of relTypes) {
      const sheetName = getSheetNameForKey(relType);

      // Validate all Excel constraints
      expect(sheetName.length).toBeLessThanOrEqual(31);
      expect(sheetName).not.toMatch(/[\\/?*[\]]/);
      expect(sheetName.trim()).toBe(sheetName);
      expect(sheetName.length).toBeGreaterThan(0);
    }
  });

  it('edge case: sheet name exactly 31 characters (no truncation)', () => {
    // Create a name that is exactly 31 characters
    const exactName = 'a'.repeat(31);
    const result = toExcelSafeSheetName(exactName);

    expect(result.length).toBe(31);
    expect(result).toBe(exactName);
  });

  it('edge case: sheet name 32 characters (truncation to 31)', () => {
    // Create a name that is 32 characters
    const longName = 'a'.repeat(32);
    const result = toExcelSafeSheetName(longName);

    expect(result.length).toBe(31);
    expect(result).toBe('a'.repeat(31));
  });

  it('multiple illegal characters in single name are all replaced', () => {
    const messyName = 'sheet\\with/many?illegal*chars[and]more';
    const result = toExcelSafeSheetName(messyName);

    // All 6 illegal character types should be replaced
    expect(result).not.toContain('\\');
    expect(result).not.toContain('/');
    expect(result).not.toContain('?');
    expect(result).not.toContain('*');
    expect(result).not.toContain('[');
    expect(result).not.toContain(']');
    expect(result).toBe('sheet_with_many_illegal_chars_a');
  });

  it('XLSX_SHEET_NAME_TO_KEY contains the exact inverse of META_MODEL_XLSX_SHEET_NAME_BY_KEY', () => {
    // Verify every entry in the forward mapping has a corresponding reverse entry
    for (const [key, sheetName] of Object.entries(META_MODEL_XLSX_SHEET_NAME_BY_KEY)) {
      expect(XLSX_SHEET_NAME_TO_KEY[sheetName]).toBe(key);
    }

    // The reverse mapping additionally tolerates gateway-format title-case
    // names (e.g. 'Process Activities') that have no forward entry, so only
    // the auto-generated inverse entries are checked against the forward map.
    const forwardSheetNames = new Set(Object.values(META_MODEL_XLSX_SHEET_NAME_BY_KEY));
    for (const [sheetName, key] of Object.entries(XLSX_SHEET_NAME_TO_KEY)) {
      if (!forwardSheetNames.has(sheetName)) continue; // gateway-format extras
      expect(META_MODEL_XLSX_SHEET_NAME_BY_KEY[key]).toBe(sheetName);
    }
  });
});
