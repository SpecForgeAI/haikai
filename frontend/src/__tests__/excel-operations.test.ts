/**
 * Excel Operations Tests
 *
 * Tests for Excel import/export functionality including:
 * - Worksheet naming conventions
 * - Entity/relationship type mappings
 * - Export/import utility functions
 */

import { describe, it, expect } from 'vitest';
import {
  getEntityWorksheetName,
  getRelationshipWorksheetName,
  getExportableEntityTypes,
  getExportableRelationshipTypes,
  worksheetNameToEntityType,
  worksheetNameToRelationshipType,
} from '../utils/excelOperations';

describe('Excel Operations - Worksheet Naming', () => {
  describe('getEntityWorksheetName', () => {
    it('should return tab name as-is when under 31 characters', () => {
      expect(getEntityWorksheetName('Users')).toBe('Users');
      expect(getEntityWorksheetName('Applications')).toBe('Applications');
      expect(getEntityWorksheetName('Logical Entities')).toBe('Logical Entities');
    });

    it('should truncate names longer than 31 characters', () => {
      const longName = 'This Is A Very Long Tab Name That Exceeds Thirty One Characters';
      expect(getEntityWorksheetName(longName).length).toBe(31);
    });
  });

  describe('getRelationshipWorksheetName', () => {
    it('should replace <-> with - in relationship names', () => {
      expect(getRelationshipWorksheetName('User <-> Business Point')).toBe('User - Business Point');
      expect(getRelationshipWorksheetName('Logical <-> Physical Entities')).toBe('Logical - Physical Entities');
    });

    it('should handle relationship names without <->', () => {
      expect(getRelationshipWorksheetName('Logical ER')).toBe('Logical ER');
      expect(getRelationshipWorksheetName('Data Movements')).toBe('Data Movements');
    });

    it('should truncate names longer than 31 characters after replacement', () => {
      const result = getRelationshipWorksheetName('Logical <-> Physical Attributes');
      expect(result.length).toBeLessThanOrEqual(31);
      expect(result).toBe('Logical - Physical Attributes');
    });
  });
});

describe('Excel Operations - Entity Type Mappings', () => {
  describe('getExportableEntityTypes', () => {
    it('should return entity types that are NOT derived', () => {
      const exportableTypes = getExportableEntityTypes();

      // Should include standard entity types
      expect(exportableTypes).toContain('business_users');
      expect(exportableTypes).toContain('business_processes');
      expect(exportableTypes).toContain('applications');
      expect(exportableTypes).toContain('logical_data_entities');

      // Should NOT include derived entity types
      expect(exportableTypes).not.toContain('application_points');
      expect(exportableTypes).not.toContain('business_points');
      expect(exportableTypes).not.toContain('app_business_points');
    });

    it('should include the original core exportable entity types', () => {
      const exportableTypes = getExportableEntityTypes();
      // The exportable registry has grown well beyond the original 13 types
      // (behavioural, UI, user-journey, infrastructure, libraries, ...).
      // Assert membership of the original core set instead of a brittle total.
      const coreTypes = [
        'business_users',
        'business_processes',
        'process_activities',
        'applications',
        'app_components',
        'services',
        'interfaces',
        'endpoints',
        'logical_data_entities',
        'logical_data_attributes',
        'physical_data_entities',
        'physical_data_attributes',
      ];
      for (const t of coreTypes) {
        expect(exportableTypes).toContain(t);
      }
      expect(exportableTypes.length).toBeGreaterThanOrEqual(coreTypes.length);
    });
  });

  describe('getExportableRelationshipTypes', () => {
    it('should return all relationship types', () => {
      const relTypes = getExportableRelationshipTypes();

      expect(relTypes).toContain('business_user_business_points');
      expect(relTypes).toContain('application_point_business_points');
      expect(relTypes).toContain('logical_data_entity_relationships');
      expect(relTypes).toContain('data_movements');
    });

    it('should include the original core relationship types', () => {
      const relTypes = getExportableRelationshipTypes();
      // The relationship registry has grown beyond the original 7 types.
      const coreTypes = [
        'business_user_business_points',
        'application_point_business_points',
        'logical_data_entity_relationships',
        'logical_data_entity_physical_data_entities',
        'logical_data_attribute_physical_data_attributes',
        'interface_logical_entities',
        'data_movements',
      ];
      for (const t of coreTypes) {
        expect(relTypes).toContain(t);
      }
      expect(relTypes.length).toBeGreaterThanOrEqual(coreTypes.length);
    });
  });
});

describe('Excel Operations - Reverse Mappings', () => {
  describe('worksheetNameToEntityType', () => {
    it('should map worksheet names back to entity types', () => {
      // Spec 2026-01-11: worksheet names are now KEY-based (the type key
      // itself), not display tab names. Title-case gateway-format names are
      // recognised only for the explicit XLSX_SHEET_NAME_TO_KEY extras.
      expect(worksheetNameToEntityType('business_users')).toBe('business_users');
      expect(worksheetNameToEntityType('applications')).toBe('applications');
      expect(worksheetNameToEntityType('logical_data_entities')).toBe('logical_data_entities');
      expect(worksheetNameToEntityType('physical_data_attributes')).toBe('physical_data_attributes');
      // Gateway-format title-case extra
      expect(worksheetNameToEntityType('Process Activities')).toBe('process_activities');
    });

    it('should return undefined for unknown worksheet names', () => {
      expect(worksheetNameToEntityType('Unknown Sheet')).toBeUndefined();
      expect(worksheetNameToEntityType('Random Name')).toBeUndefined();
    });
  });

  describe('worksheetNameToRelationshipType', () => {
    it('should map worksheet names back to relationship types', () => {
      // Spec 2026-01-11: relationship worksheet names are key-based, with
      // canonical abbreviations for overlength keys.
      expect(worksheetNameToRelationshipType('business_user_business_points')).toBe('business_user_business_points');
      expect(worksheetNameToRelationshipType('logical_entity_physical_ents')).toBe('logical_data_entity_physical_data_entities');
      expect(worksheetNameToRelationshipType('app_point_business_points')).toBe('application_point_business_points');
      expect(worksheetNameToRelationshipType('data_movements')).toBe('data_movements');
    });

    it('should return undefined for unknown relationship worksheet names', () => {
      expect(worksheetNameToRelationshipType('Unknown Relationship')).toBeUndefined();
      expect(worksheetNameToRelationshipType('Users')).toBeUndefined(); // Entity name, not relationship
    });
  });
});

describe('Excel Operations - Entity Type Exclusions', () => {
  it('should exclude derived entities (application_points, business_points, app_business_points)', () => {
    const exportableTypes = getExportableEntityTypes();

    // These are derived/computed entities that should not be exported
    expect(exportableTypes).not.toContain('application_points');
    expect(exportableTypes).not.toContain('business_points');
    expect(exportableTypes).not.toContain('app_business_points');
  });
});
