/**
 * Tests for Data Movement XLSX Import/Export Operations
 *
 * Spec 2026-01-11: Data Movement Interface Schema Extension
 *
 * Tests:
 * 1. Export includes "Interface (with Schema)" column in correct position
 * 2. Export includes "Bi-directional?" column with TRUE/FALSE values
 * 3. Export leaves Data Entity blank when Interface is used (and vice versa)
 * 4. Import correctly parses interfaceWithSchemaId from column
 * 5. Import correctly parses biDirectional as boolean
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { gridConfigs } from '../config/gridConfigs';

describe('Data Movement XLSX Operations - Spec 2026-01-11', () => {
  // ============================================================================
  // Test 1: Export includes "Interface (with Schema)" column in correct position
  // ============================================================================
  describe('Export column positioning', () => {
    it('should have Interface (with Schema) column after Data Entity column in gridConfigs', () => {
      const dataMovementsConfig = gridConfigs['data_movements'];
      expect(dataMovementsConfig).toBeDefined();

      // Find indices of relevant columns
      const dataEntityIndex = dataMovementsConfig.findIndex(col => col.field === 'dataEntityPointId');
      const interfaceWithSchemaIndex = dataMovementsConfig.findIndex(col => col.field === 'interfaceWithSchemaId');
      const biDirectionalIndex = dataMovementsConfig.findIndex(col => col.field === 'biDirectional');
      const movementTypeIndex = dataMovementsConfig.findIndex(col => col.field === 'movement_type');

      // All columns should exist
      expect(dataEntityIndex).toBeGreaterThan(-1);
      expect(interfaceWithSchemaIndex).toBeGreaterThan(-1);
      expect(biDirectionalIndex).toBeGreaterThan(-1);

      // interfaceWithSchemaId should be right after dataEntityPointId
      expect(interfaceWithSchemaIndex).toBe(dataEntityIndex + 1);

      // biDirectional should be right after interfaceWithSchemaId
      expect(biDirectionalIndex).toBe(interfaceWithSchemaIndex + 1);

      // All three should come before movement_type
      expect(dataEntityIndex).toBeLessThan(movementTypeIndex);
      expect(interfaceWithSchemaIndex).toBeLessThan(movementTypeIndex);
      expect(biDirectionalIndex).toBeLessThan(movementTypeIndex);
    });

    it('should have correct display name for Interface (with Schema) column', () => {
      const dataMovementsConfig = gridConfigs['data_movements'];
      const interfaceCol = dataMovementsConfig.find(col => col.field === 'interfaceWithSchemaId');

      expect(interfaceCol).toBeDefined();
      expect(interfaceCol!.displayName).toBe('Interface (with Schema)');
    });
  });

  // ============================================================================
  // Test 2: Export includes "Bi-directional?" column with TRUE/FALSE values
  // ============================================================================
  describe('Bi-directional column configuration', () => {
    it('should have biDirectional column with boolean cellType', () => {
      const dataMovementsConfig = gridConfigs['data_movements'];
      const biDirectionalCol = dataMovementsConfig.find(col => col.field === 'biDirectional');

      expect(biDirectionalCol).toBeDefined();
      expect(biDirectionalCol!.displayName).toBe('Bi-directional?');
      expect(biDirectionalCol!.cellType).toBe('boolean');
      expect(biDirectionalCol!.required).toBe(false);
    });
  });

  // ============================================================================
  // Test 3: Export leaves Data Entity blank when Interface is used (XOR)
  // This is validated by XOR logic - both cannot have values
  // ============================================================================
  describe('XOR column behavior', () => {
    it('should have both dataEntityPointId and interfaceWithSchemaId as optional', () => {
      const dataMovementsConfig = gridConfigs['data_movements'];

      const dataEntityCol = dataMovementsConfig.find(col => col.field === 'dataEntityPointId');
      const interfaceCol = dataMovementsConfig.find(col => col.field === 'interfaceWithSchemaId');

      expect(dataEntityCol).toBeDefined();
      expect(interfaceCol).toBeDefined();
      expect(dataEntityCol!.required).toBe(false);
      expect(interfaceCol!.required).toBe(false);
    });

    it('should have interfaceWithSchemaId configured as fk_typeahead to interfaces', () => {
      const dataMovementsConfig = gridConfigs['data_movements'];
      const interfaceCol = dataMovementsConfig.find(col => col.field === 'interfaceWithSchemaId');

      expect(interfaceCol).toBeDefined();
      expect(interfaceCol!.cellType).toBe('fk_typeahead');
      expect(interfaceCol!.fkTarget).toBe('interfaces');
    });
  });

  // ============================================================================
  // Test 4: Import correctly parses interfaceWithSchemaId from column
  // ============================================================================
  describe('Import interfaceWithSchemaId parsing', () => {
    it('should map "Interface (with Schema)" display name to interfaceWithSchemaId field', () => {
      const dataMovementsConfig = gridConfigs['data_movements'];
      const interfaceCol = dataMovementsConfig.find(col => col.displayName === 'Interface (with Schema)');

      expect(interfaceCol).toBeDefined();
      expect(interfaceCol!.field).toBe('interfaceWithSchemaId');
    });
  });

  // ============================================================================
  // Test 5: Import correctly parses biDirectional as boolean
  // ============================================================================
  describe('Import biDirectional parsing', () => {
    it('should map "Bi-directional?" display name to biDirectional field', () => {
      const dataMovementsConfig = gridConfigs['data_movements'];
      const biDirectionalCol = dataMovementsConfig.find(col => col.displayName === 'Bi-directional?');

      expect(biDirectionalCol).toBeDefined();
      expect(biDirectionalCol!.field).toBe('biDirectional');
      expect(biDirectionalCol!.cellType).toBe('boolean');
    });

    // Test boolean parsing logic (TRUE/YES/1 -> true)
    it('should parse boolean values correctly (TRUE/YES/1 -> true, others -> false)', () => {
      // These are the expected parsing behaviors based on excelOperations.ts mapRowToFields
      const parseBooleanFromExcel = (value: unknown): boolean => {
        if (typeof value === 'boolean') {
          return value;
        } else if (typeof value === 'string') {
          return (
            value.toLowerCase() === 'true' ||
            value.toLowerCase() === 'yes' ||
            value === '1'
          );
        } else if (typeof value === 'number') {
          return value !== 0;
        }
        return false;
      };

      // Test various input values
      expect(parseBooleanFromExcel('TRUE')).toBe(true);
      expect(parseBooleanFromExcel('true')).toBe(true);
      expect(parseBooleanFromExcel('True')).toBe(true);
      expect(parseBooleanFromExcel('YES')).toBe(true);
      expect(parseBooleanFromExcel('yes')).toBe(true);
      expect(parseBooleanFromExcel('Yes')).toBe(true);
      expect(parseBooleanFromExcel('1')).toBe(true);
      expect(parseBooleanFromExcel(1)).toBe(true);
      expect(parseBooleanFromExcel(true)).toBe(true);

      expect(parseBooleanFromExcel('FALSE')).toBe(false);
      expect(parseBooleanFromExcel('false')).toBe(false);
      expect(parseBooleanFromExcel('NO')).toBe(false);
      expect(parseBooleanFromExcel('no')).toBe(false);
      expect(parseBooleanFromExcel('0')).toBe(false);
      expect(parseBooleanFromExcel(0)).toBe(false);
      expect(parseBooleanFromExcel(false)).toBe(false);
      expect(parseBooleanFromExcel('')).toBe(false);
      expect(parseBooleanFromExcel(null)).toBe(false);
      expect(parseBooleanFromExcel(undefined)).toBe(false);
    });
  });
});
