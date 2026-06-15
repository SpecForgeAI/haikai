/**
 * Tests for Data Movement Interface Schema Extension - Type & Config
 *
 * Spec: Data Movement Interface Schema Extension
 * Task Group 1: Frontend Type & Config Updates
 *
 * These tests verify:
 * - DataMovement interface accepts optional dataEntityPointId
 * - DataMovement interface accepts optional interfaceWithSchemaId
 * - DataMovement interface accepts optional biDirectional boolean
 * - gridConfigs data_movements has correct column definitions
 */

import { describe, it, expect } from 'vitest';
import { DataMovement } from '../types/model';
import { gridConfigs } from '../config/gridConfigs';
import { RELATIONSHIP_DEFINITIONS } from '../config/relationshipDefinitions';

describe('Data Movement Interface Schema Extension - Type & Config', () => {

  // Test 1: DataMovement interface accepts optional dataEntityPointId
  it('DataMovement interface accepts optional dataEntityPointId', () => {
    // Create a DataMovement with dataEntityPointId
    const dmWithEntity: DataMovement = {
      id: 'dm_1',
      source_application_point_id: 'ap_src_1',
      target_application_point_id: 'ap_tgt_1',
      dataEntityPointId: 'dep_log_lde_123',
      movement_type: 'SYNC',
      description: 'Test movement',
      tags: '',
    };
    expect(dmWithEntity.dataEntityPointId).toBe('dep_log_lde_123');

    // Create a DataMovement without dataEntityPointId (using interface instead)
    const dmWithoutEntity: DataMovement = {
      id: 'dm_2',
      source_application_point_id: 'ap_src_1',
      target_application_point_id: 'ap_tgt_1',
      interfaceWithSchemaId: 'int_456',
      movement_type: 'ASYNC',
      description: 'Test movement via interface',
      tags: '',
    };
    expect(dmWithoutEntity.dataEntityPointId).toBeUndefined();
    expect(dmWithoutEntity.interfaceWithSchemaId).toBe('int_456');
  });

  // Test 2: DataMovement interface accepts optional interfaceWithSchemaId
  it('DataMovement interface accepts optional interfaceWithSchemaId', () => {
    // Create a DataMovement with interfaceWithSchemaId
    const dmWithInterface: DataMovement = {
      id: 'dm_3',
      source_application_point_id: 'ap_src_1',
      target_application_point_id: 'ap_tgt_1',
      interfaceWithSchemaId: 'int_789',
      movement_type: 'SYNC',
      description: 'Test movement via interface',
      tags: '',
    };
    expect(dmWithInterface.interfaceWithSchemaId).toBe('int_789');

    // Create a DataMovement without interfaceWithSchemaId (using data entity instead)
    const dmWithoutInterface: DataMovement = {
      id: 'dm_4',
      source_application_point_id: 'ap_src_1',
      target_application_point_id: 'ap_tgt_1',
      dataEntityPointId: 'dep_log_lde_456',
      movement_type: 'SYNC',
      description: 'Test movement via entity',
      tags: '',
    };
    expect(dmWithoutInterface.interfaceWithSchemaId).toBeUndefined();
    expect(dmWithoutInterface.dataEntityPointId).toBe('dep_log_lde_456');
  });

  // Test 3: DataMovement interface accepts optional biDirectional boolean
  it('DataMovement interface accepts optional biDirectional boolean', () => {
    // Create a DataMovement with biDirectional = true
    const dmBiDirectional: DataMovement = {
      id: 'dm_5',
      source_application_point_id: 'ap_src_1',
      target_application_point_id: 'ap_tgt_1',
      dataEntityPointId: 'dep_log_lde_789',
      biDirectional: true,
      movement_type: 'SYNC',
      description: 'Test bi-directional movement',
      tags: '',
    };
    expect(dmBiDirectional.biDirectional).toBe(true);

    // Create a DataMovement with biDirectional = false
    const dmNotBiDirectional: DataMovement = {
      id: 'dm_6',
      source_application_point_id: 'ap_src_1',
      target_application_point_id: 'ap_tgt_1',
      dataEntityPointId: 'dep_log_lde_101',
      biDirectional: false,
      movement_type: 'SYNC',
      description: 'Test uni-directional movement',
      tags: '',
    };
    expect(dmNotBiDirectional.biDirectional).toBe(false);

    // Create a DataMovement without biDirectional (defaults to false)
    const dmDefaultDirection: DataMovement = {
      id: 'dm_7',
      source_application_point_id: 'ap_src_1',
      target_application_point_id: 'ap_tgt_1',
      dataEntityPointId: 'dep_log_lde_102',
      movement_type: 'SYNC',
      description: 'Test default direction',
      tags: '',
    };
    expect(dmDefaultDirection.biDirectional).toBeUndefined();
  });

  // Test 4: gridConfigs data_movements has correct column definitions
  it('gridConfigs data_movements has correct column definitions', () => {
    const dataMovementsConfig = gridConfigs['data_movements'];
    expect(dataMovementsConfig).toBeDefined();

    // Find dataEntityPointId column - should be optional (required: false)
    const dataEntityPointIdCol = dataMovementsConfig.find(c => c.field === 'dataEntityPointId');
    expect(dataEntityPointIdCol).toBeDefined();
    expect(dataEntityPointIdCol?.required).toBe(false);
    expect(dataEntityPointIdCol?.cellType).toBe('data_entity_point_picker');

    // Find interfaceWithSchemaId column - should be after dataEntityPointId
    const interfaceWithSchemaIdCol = dataMovementsConfig.find(c => c.field === 'interfaceWithSchemaId');
    expect(interfaceWithSchemaIdCol).toBeDefined();
    expect(interfaceWithSchemaIdCol?.displayName).toBe('Interface (with Schema)');
    expect(interfaceWithSchemaIdCol?.cellType).toBe('fk_typeahead');
    expect(interfaceWithSchemaIdCol?.fkTarget).toBe('interfaces');
    expect(interfaceWithSchemaIdCol?.required).toBe(false);

    // Find biDirectional column - should be after interfaceWithSchemaId
    const biDirectionalCol = dataMovementsConfig.find(c => c.field === 'biDirectional');
    expect(biDirectionalCol).toBeDefined();
    expect(biDirectionalCol?.displayName).toBe('Bi-directional?');
    expect(biDirectionalCol?.cellType).toBe('boolean');
    expect(biDirectionalCol?.required).toBe(false);

    // Check column order: interfaceWithSchemaId should come after dataEntityPointId
    const dataEntityIdx = dataMovementsConfig.findIndex(c => c.field === 'dataEntityPointId');
    const interfaceIdx = dataMovementsConfig.findIndex(c => c.field === 'interfaceWithSchemaId');
    const biDirectionalIdx = dataMovementsConfig.findIndex(c => c.field === 'biDirectional');
    const movementTypeIdx = dataMovementsConfig.findIndex(c => c.field === 'movement_type');

    expect(interfaceIdx).toBeGreaterThan(dataEntityIdx);
    expect(biDirectionalIdx).toBeGreaterThan(interfaceIdx);
    expect(movementTypeIdx).toBeGreaterThan(biDirectionalIdx);
  });

  // Test 5: relationshipDefinitions includes interfaces in data_movements endpoints
  it('relationshipDefinitions includes interfaces in data_movements endpoint types', () => {
    const dataMovementsRelDef = RELATIONSHIP_DEFINITIONS.find(
      def => def.relationshipKey === 'data_movements'
    );
    expect(dataMovementsRelDef).toBeDefined();
    expect(dataMovementsRelDef?.endpointEntityTypes).toContain('interfaces');
  });
});
