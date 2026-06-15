/**
 * Tests for Data Movement Interface Schema Extension - XOR Validation
 *
 * Spec: Data Movement Interface Schema Extension
 * Task Group 2: XOR Validation Implementation
 *
 * These tests verify:
 * - XOR validation rule type is defined in ValidationError type
 * - XOR validation config is defined for data_movements
 * - validateDataMovementXOR function correctly validates XOR constraint
 * - validateModel includes XOR validation for data_movements
 */

import { describe, it, expect } from 'vitest';
import { ValidationError } from '../types/config';
import {
  validateDataMovementXOR,
  XOR_VALIDATION_RULES,
  formatXORValidationErrorMessage,
} from '../utils/validation';
import { DataMovement, ArchitectureModel } from '../types/model';
import { createEmptyModel } from '../config/defaults';

describe('Data Movement Interface Schema Extension - XOR Validation', () => {

  // Test 1: XOR validation rule type definition
  it('ValidationError type includes xor_constraint type', () => {
    // TypeScript compile-time check - if this compiles, the type exists
    const error: ValidationError = {
      entityType: 'data_movements',
      entityId: 'dm_1',
      field: 'dataEntityPointId',
      message: 'Test XOR error',
      type: 'xor_constraint',
    };
    expect(error.type).toBe('xor_constraint');
  });

  // Test 2: XOR validation config exists for data_movements
  it('XOR_VALIDATION_RULES includes data_movements rule', () => {
    const dataMovementsRule = XOR_VALIDATION_RULES.find(
      rule => rule.entityType === 'data_movements'
    );
    expect(dataMovementsRule).toBeDefined();
    expect(dataMovementsRule?.fields).toContain('dataEntityPointId');
    expect(dataMovementsRule?.fields).toContain('interfaceWithSchemaId');
    // Case-insensitive check for the message
    expect(dataMovementsRule?.message.toLowerCase()).toContain('exactly one');
  });

  // Test 3: XOR validation - neither field set (invalid)
  it('validates XOR: neither field set is invalid', () => {
    const dataMovement: DataMovement = {
      id: 'dm_1',
      source_application_point_id: 'ap_src_1',
      target_application_point_id: 'ap_tgt_1',
      // Neither dataEntityPointId nor interfaceWithSchemaId set
      movement_type: 'SYNC',
      description: 'Test',
      tags: '',
    };

    const errors = validateDataMovementXOR(dataMovement);
    expect(errors.length).toBe(1);
    expect(errors[0].type).toBe('xor_constraint');
    expect(errors[0].message.toLowerCase()).toContain('exactly one');
  });

  // Test 4: XOR validation - both fields set (invalid)
  it('validates XOR: both fields set is invalid', () => {
    const dataMovement: DataMovement = {
      id: 'dm_2',
      source_application_point_id: 'ap_src_1',
      target_application_point_id: 'ap_tgt_1',
      dataEntityPointId: 'dep_log_lde_123',
      interfaceWithSchemaId: 'int_456',
      movement_type: 'SYNC',
      description: 'Test',
      tags: '',
    };

    const errors = validateDataMovementXOR(dataMovement);
    expect(errors.length).toBe(1);
    expect(errors[0].type).toBe('xor_constraint');
    expect(errors[0].message.toLowerCase()).toContain('exactly one');
  });

  // Test 5: XOR validation - only dataEntityPointId set (valid)
  it('validates XOR: only dataEntityPointId set is valid', () => {
    const dataMovement: DataMovement = {
      id: 'dm_3',
      source_application_point_id: 'ap_src_1',
      target_application_point_id: 'ap_tgt_1',
      dataEntityPointId: 'dep_log_lde_123',
      movement_type: 'SYNC',
      description: 'Test',
      tags: '',
    };

    const errors = validateDataMovementXOR(dataMovement);
    expect(errors.length).toBe(0);
  });

  // Test 6: XOR validation - only interfaceWithSchemaId set (valid)
  it('validates XOR: only interfaceWithSchemaId set is valid', () => {
    const dataMovement: DataMovement = {
      id: 'dm_4',
      source_application_point_id: 'ap_src_1',
      target_application_point_id: 'ap_tgt_1',
      interfaceWithSchemaId: 'int_456',
      movement_type: 'SYNC',
      description: 'Test',
      tags: '',
    };

    const errors = validateDataMovementXOR(dataMovement);
    expect(errors.length).toBe(0);
  });

  // Test 7: formatXORValidationErrorMessage produces correct format
  it('formatXORValidationErrorMessage produces correct format', () => {
    const message = formatXORValidationErrorMessage(
      'data_movements',
      'Test Data Movement',
      ['dataEntityPointId', 'interfaceWithSchemaId']
    );
    expect(message).toContain('DATA_MOVEMENT');
    expect(message).toContain('Test Data Movement');
    expect(message.toLowerCase()).toContain('exactly one');
    expect(message).toContain('dataEntityPointId');
    expect(message).toContain('interfaceWithSchemaId');
  });

  // Test 8: Empty string values are treated as not set (XOR compliant)
  it('treats empty string values as not set for XOR validation', () => {
    const dataMovement: DataMovement = {
      id: 'dm_5',
      source_application_point_id: 'ap_src_1',
      target_application_point_id: 'ap_tgt_1',
      dataEntityPointId: '',
      interfaceWithSchemaId: 'int_456',
      movement_type: 'SYNC',
      description: 'Test',
      tags: '',
    };

    const errors = validateDataMovementXOR(dataMovement);
    expect(errors.length).toBe(0);
  });
});
