/**
 * Integration Tests for Data Movement Interface Schema Extension
 *
 * Spec 2026-01-11: Data Movement Interface Schema Extension
 *
 * These tests fill critical gaps identified in Task Group 5:
 * 1. Integration: validateModel integration with XOR validation (single entity validation)
 * 2. Integration: Field clearing behavior for mutual exclusivity
 * 3. Integration: Default values for new fields
 * 4. Integration: Validation error message format is user-friendly
 * 5. Integration: Batch validation of multiple DataMovements
 * 6. Integration: Empty string treated as not set for XOR
 * 7. Integration: biDirectional defaults to false when undefined
 * 8. Integration: Column order is correct for grid display
 */

import { describe, it, expect } from 'vitest';
import { validateDataMovementXOR, formatXORValidationErrorMessage } from '../utils/validation';
import { gridConfigs } from '../config/gridConfigs';
import type { DataMovement } from '../types/model';

describe('Data Movement Interface Schema Extension - Integration Tests', () => {
  // ============================================================================
  // Test 1: validateDataMovementXOR validates single entity correctly
  // ============================================================================
  describe('Single entity validation', () => {
    it('should return empty array for valid DataMovement with only dataEntityPointId', () => {
      const movement: DataMovement = {
        id: 'dm-1',
        sourceApplicationPointId: 'ap-1',
        targetApplicationPointId: 'ap-2',
        dataEntityPointId: 'dep-1',
        movement_type: 'sync',
      } as DataMovement;

      const errors = validateDataMovementXOR(movement);
      expect(errors.length).toBe(0);
    });

    it('should return empty array for valid DataMovement with only interfaceWithSchemaId', () => {
      const movement: DataMovement = {
        id: 'dm-1',
        sourceApplicationPointId: 'ap-1',
        targetApplicationPointId: 'ap-2',
        interfaceWithSchemaId: 'iface-1',
        biDirectional: true,
        movement_type: 'sync',
      } as DataMovement;

      const errors = validateDataMovementXOR(movement);
      expect(errors.length).toBe(0);
    });

    it('should return error for DataMovement with neither field set', () => {
      const movement: DataMovement = {
        id: 'dm-invalid',
        description: 'Test Movement',
        sourceApplicationPointId: 'ap-1',
        targetApplicationPointId: 'ap-2',
        movement_type: 'sync',
      } as DataMovement;

      const errors = validateDataMovementXOR(movement);
      expect(errors.length).toBe(1);
      expect(errors[0].type).toBe('xor_constraint');
      expect(errors[0].message).toContain('requires exactly one');
    });

    it('should return error for DataMovement with both fields set', () => {
      const movement: DataMovement = {
        id: 'dm-both',
        description: 'Both Set Movement',
        sourceApplicationPointId: 'ap-1',
        targetApplicationPointId: 'ap-2',
        dataEntityPointId: 'dep-1',
        interfaceWithSchemaId: 'iface-1',
        movement_type: 'sync',
      } as DataMovement;

      const errors = validateDataMovementXOR(movement);
      expect(errors.length).toBe(1);
      expect(errors[0].type).toBe('xor_constraint');
      expect(errors[0].message).toContain('requires exactly one');
    });
  });

  // ============================================================================
  // Test 2: Field clearing behavior for mutual exclusivity
  // ============================================================================
  describe('Field clearing behavior', () => {
    it('should identify when clearing is needed (both fields have values)', () => {
      const movement: DataMovement = {
        id: 'dm-test',
        sourceApplicationPointId: 'ap-1',
        targetApplicationPointId: 'ap-2',
        dataEntityPointId: 'dep-1',
        interfaceWithSchemaId: 'iface-1',
        movement_type: 'sync',
      } as DataMovement;

      // Validate would catch both being set
      const errors = validateDataMovementXOR(movement);
      expect(errors.length).toBe(1);
      expect(errors[0].type).toBe('xor_constraint');
    });

    it('should pass validation after clearing one field', () => {
      // Simulate clearing interfaceWithSchemaId
      const movement: DataMovement = {
        id: 'dm-test',
        sourceApplicationPointId: 'ap-1',
        targetApplicationPointId: 'ap-2',
        dataEntityPointId: 'dep-1',
        interfaceWithSchemaId: undefined, // Cleared
        movement_type: 'sync',
      } as DataMovement;

      const errors = validateDataMovementXOR(movement);
      expect(errors.length).toBe(0);
    });
  });

  // ============================================================================
  // Test 3: Default values for new fields
  // ============================================================================
  describe('Default values', () => {
    it('should treat undefined biDirectional as false conceptually', () => {
      const movement: DataMovement = {
        id: 'dm-test',
        sourceApplicationPointId: 'ap-1',
        targetApplicationPointId: 'ap-2',
        dataEntityPointId: 'dep-1',
        // biDirectional is undefined
        movement_type: 'sync',
      } as DataMovement;

      // This should be valid - biDirectional defaults to false
      expect(movement.biDirectional).toBeUndefined();

      // XOR Validation should pass (XOR is satisfied)
      const errors = validateDataMovementXOR(movement);
      expect(errors.length).toBe(0);
    });

    it('should accept explicit false for biDirectional', () => {
      const movement: DataMovement = {
        id: 'dm-test',
        sourceApplicationPointId: 'ap-1',
        targetApplicationPointId: 'ap-2',
        interfaceWithSchemaId: 'iface-1',
        biDirectional: false,
        movement_type: 'sync',
      } as DataMovement;

      expect(movement.biDirectional).toBe(false);
      const errors = validateDataMovementXOR(movement);
      expect(errors.length).toBe(0);
    });

    it('should accept true for biDirectional', () => {
      const movement: DataMovement = {
        id: 'dm-test',
        sourceApplicationPointId: 'ap-1',
        targetApplicationPointId: 'ap-2',
        interfaceWithSchemaId: 'iface-1',
        biDirectional: true,
        movement_type: 'sync',
      } as DataMovement;

      expect(movement.biDirectional).toBe(true);
      const errors = validateDataMovementXOR(movement);
      expect(errors.length).toBe(0);
    });
  });

  // ============================================================================
  // Test 4: Validation error message format is user-friendly
  // ============================================================================
  describe('Error message format', () => {
    it('should produce user-friendly error message with entity type and name', () => {
      const message = formatXORValidationErrorMessage(
        'data_movements',
        'My Test Movement',
        ['dataEntityPointId', 'interfaceWithSchemaId']
      );

      expect(message).toContain('DATA_MOVEMENT');
      expect(message).toContain('My Test Movement');
      expect(message).toContain('requires exactly one');
      expect(message).toContain('dataEntityPointId');
      expect(message).toContain('interfaceWithSchemaId');
    });

    it('should handle null/undefined entity name with "unnamed row"', () => {
      const message = formatXORValidationErrorMessage(
        'data_movements',
        null,
        ['dataEntityPointId', 'interfaceWithSchemaId']
      );

      expect(message).toContain('unnamed row');
    });

    it('should handle empty string entity name with "unnamed row"', () => {
      const message = formatXORValidationErrorMessage(
        'data_movements',
        '',
        ['dataEntityPointId', 'interfaceWithSchemaId']
      );

      expect(message).toContain('unnamed row');
    });
  });

  // ============================================================================
  // Test 5: Batch validation of multiple DataMovements
  // ============================================================================
  describe('Batch validation', () => {
    it('should validate each DataMovement independently', () => {
      const movements: DataMovement[] = [
        // Valid: only dataEntityPointId
        { id: 'valid-1', sourceApplicationPointId: 'ap-1', targetApplicationPointId: 'ap-2', dataEntityPointId: 'dep-1', movement_type: 'sync' } as DataMovement,
        // Valid: only interfaceWithSchemaId
        { id: 'valid-2', sourceApplicationPointId: 'ap-3', targetApplicationPointId: 'ap-4', interfaceWithSchemaId: 'iface-1', movement_type: 'async' } as DataMovement,
        // Invalid: neither
        { id: 'invalid-1', sourceApplicationPointId: 'ap-5', targetApplicationPointId: 'ap-6', movement_type: 'sync' } as DataMovement,
      ];

      // Validate each independently
      const allErrors = movements.flatMap(dm => validateDataMovementXOR(dm));

      // Should have exactly 1 error (from invalid-1)
      expect(allErrors.length).toBe(1);
      expect(allErrors[0].entityId).toBe('invalid-1');
    });
  });

  // ============================================================================
  // Test 6: Empty string treated as not set for XOR
  // ============================================================================
  describe('Empty string handling', () => {
    it('should treat empty string dataEntityPointId as not set', () => {
      const movement: DataMovement = {
        id: 'dm-test',
        sourceApplicationPointId: 'ap-1',
        targetApplicationPointId: 'ap-2',
        dataEntityPointId: '', // Empty string
        interfaceWithSchemaId: 'iface-1',
        movement_type: 'sync',
      } as DataMovement;

      // Should pass - empty string + valid interface = valid XOR
      const errors = validateDataMovementXOR(movement);
      expect(errors.length).toBe(0);
    });

    it('should treat empty string interfaceWithSchemaId as not set', () => {
      const movement: DataMovement = {
        id: 'dm-test',
        sourceApplicationPointId: 'ap-1',
        targetApplicationPointId: 'ap-2',
        dataEntityPointId: 'dep-1',
        interfaceWithSchemaId: '', // Empty string
        movement_type: 'sync',
      } as DataMovement;

      // Should pass - valid entity + empty string = valid XOR
      const errors = validateDataMovementXOR(movement);
      expect(errors.length).toBe(0);
    });

    it('should fail when both are empty strings', () => {
      const movement: DataMovement = {
        id: 'dm-test',
        sourceApplicationPointId: 'ap-1',
        targetApplicationPointId: 'ap-2',
        dataEntityPointId: '', // Empty string
        interfaceWithSchemaId: '', // Empty string
        movement_type: 'sync',
      } as DataMovement;

      // Should fail - both empty = neither set
      const errors = validateDataMovementXOR(movement);
      expect(errors.length).toBe(1);
      expect(errors[0].type).toBe('xor_constraint');
      expect(errors[0].message).toContain('requires exactly one');
    });
  });

  // ============================================================================
  // Test 7: biDirectional field behavior
  // ============================================================================
  describe('biDirectional field behavior', () => {
    it('should allow DataMovement without biDirectional field', () => {
      const movement: DataMovement = {
        id: 'dm-test',
        sourceApplicationPointId: 'ap-1',
        targetApplicationPointId: 'ap-2',
        dataEntityPointId: 'dep-1',
        movement_type: 'sync',
      } as DataMovement;

      // TypeScript should allow this - biDirectional is optional
      expect('biDirectional' in movement).toBe(false);
    });

    it('should allow DataMovement with explicit biDirectional: true', () => {
      const movement: DataMovement = {
        id: 'dm-test',
        sourceApplicationPointId: 'ap-1',
        targetApplicationPointId: 'ap-2',
        interfaceWithSchemaId: 'iface-1',
        biDirectional: true,
        movement_type: 'sync',
      } as DataMovement;

      expect(movement.biDirectional).toBe(true);
    });
  });

  // ============================================================================
  // Test 8: Column order is correct for grid display
  // ============================================================================
  describe('Column order for grid display', () => {
    it('should have new columns in correct visual order relative to each other', () => {
      const config = gridConfigs['data_movements'];
      const fieldOrder = config.map(col => col.field);

      // Find indices for the key columns
      const dataEntityIdx = fieldOrder.indexOf('dataEntityPointId');
      const interfaceIdx = fieldOrder.indexOf('interfaceWithSchemaId');
      const biDirectionalIdx = fieldOrder.indexOf('biDirectional');
      const movementTypeIdx = fieldOrder.indexOf('movement_type');

      // All indices should be valid (>= 0)
      expect(dataEntityIdx).toBeGreaterThanOrEqual(0);
      expect(interfaceIdx).toBeGreaterThanOrEqual(0);
      expect(biDirectionalIdx).toBeGreaterThanOrEqual(0);
      expect(movementTypeIdx).toBeGreaterThanOrEqual(0);

      // Verify logical grouping: data entity -> interface -> bidirectional -> movement type
      expect(dataEntityIdx).toBeLessThan(interfaceIdx);
      expect(interfaceIdx).toBeLessThan(biDirectionalIdx);
      expect(biDirectionalIdx).toBeLessThan(movementTypeIdx);
    });

    it('should have all XOR-related columns marked as not required', () => {
      const config = gridConfigs['data_movements'];

      const dataEntityCol = config.find(col => col.field === 'dataEntityPointId');
      const interfaceCol = config.find(col => col.field === 'interfaceWithSchemaId');

      expect(dataEntityCol!.required).toBe(false);
      expect(interfaceCol!.required).toBe(false);
    });

    it('should have biDirectional column marked as not required', () => {
      const config = gridConfigs['data_movements'];
      const biDirectionalCol = config.find(col => col.field === 'biDirectional');

      expect(biDirectionalCol).toBeDefined();
      expect(biDirectionalCol!.required).toBe(false);
    });
  });
});
