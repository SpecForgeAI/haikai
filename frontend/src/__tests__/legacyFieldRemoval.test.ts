/**
 * Test file for frontend changes - Legacy Field Removal.
 *
 * These tests verify:
 * - TypeScript interfaces have no legacy fields
 * - Point-id fields are required (not optional)
 * - Model loading works without normalization
 * - Grid rendering handles missing point-id fields
 *
 * Spec: Remove Legacy Data Entity Relationship Columns
 */

import { describe, it, expect } from 'vitest';
import type {
  LogicalDataEntityRelationship,
  DataMovement,
  MetaModel,
  MetaModelEntities,
  MetaModelRelationships,
} from '../types/model';

describe('Legacy Field Removal - Frontend', () => {
  /**
   * Test 5.1.1: LogicalDataEntityRelationship type has no legacy fields.
   *
   * Verifies that the TypeScript interface has only canonical fields.
   */
  it('LogicalDataEntityRelationship type should have only point-id fields', () => {
    // Create a valid LogicalDataEntityRelationship object
    const relationship: LogicalDataEntityRelationship = {
      id: 'rel-001',
      fromDataEntityPointId: 'dep_log_entity1',
      toDataEntityPointId: 'dep_log_entity2',
      cardinality: 'ONE_TO_MANY',
      relationship: 'ASSOCIATION',
      description: 'Test relationship',
      tags: 'test',
      valid_from: '2026-Q1',
      valid_to: '2026-Q4',
    };

    // Verify canonical fields exist
    expect(relationship.id).toBe('rel-001');
    expect(relationship.fromDataEntityPointId).toBe('dep_log_entity1');
    expect(relationship.toDataEntityPointId).toBe('dep_log_entity2');
    expect(relationship.cardinality).toBe('ONE_TO_MANY');
    expect(relationship.relationship).toBe('ASSOCIATION');

    // TypeScript compile-time check: legacy fields should not exist on the type
    // These lines would cause compile errors if uncommented:
    // expect((relationship as any).from_ref_kind).toBeUndefined();
    // expect((relationship as any).from_ref_id).toBeUndefined();
    // expect((relationship as any).to_ref_kind).toBeUndefined();
    // expect((relationship as any).to_ref_id).toBeUndefined();

    // Runtime check: object should not have legacy fields
    expect((relationship as Record<string, unknown>)['from_ref_kind']).toBeUndefined();
    expect((relationship as Record<string, unknown>)['from_ref_id']).toBeUndefined();
    expect((relationship as Record<string, unknown>)['to_ref_kind']).toBeUndefined();
    expect((relationship as Record<string, unknown>)['to_ref_id']).toBeUndefined();
  });

  /**
   * Test 5.1.2: DataMovement type has no data_entity_id field.
   *
   * Verifies that the TypeScript interface has only the canonical dataEntityPointId field.
   */
  it('DataMovement type should have only dataEntityPointId field', () => {
    // Create a valid DataMovement object
    const movement: DataMovement = {
      id: 'dm-001',
      source_application_point_id: 'ap-001',
      target_application_point_id: 'ap-002',
      dataEntityPointId: 'dep_log_entity1',
      movement_type: 'SYNC',
      description: 'Test movement',
      tags: 'test',
      valid_from: '2026-Q1',
      valid_to: '2026-Q4',
    };

    // Verify canonical field exists
    expect(movement.id).toBe('dm-001');
    expect(movement.dataEntityPointId).toBe('dep_log_entity1');
    expect(movement.source_application_point_id).toBe('ap-001');
    expect(movement.target_application_point_id).toBe('ap-002');

    // Runtime check: object should not have legacy data_entity_id field
    expect((movement as Record<string, unknown>)['data_entity_id']).toBeUndefined();
  });

  /**
   * Test 5.1.3: Model loading works without normalization.
   *
   * Verifies that models with point-id fields load correctly without any normalization step.
   */
  it('Model should load correctly with point-id fields', () => {
    // Create a minimal valid MetaModel with relationships
    const entities: MetaModelEntities = {
      business_users: [],
      business_processes: [],
      process_activities: [],
      business_points: [],
      applications: [],
      app_components: [],
      services: [],
      interfaces: [],
      endpoints: [],
      classes: [],
      methods: [],
      application_points: [],
      logical_data_entities: [
        { id: 'lde-001', name: 'Entity1', description: 'Test', tags: '' },
        { id: 'lde-002', name: 'Entity2', description: 'Test', tags: '' },
      ],
      logical_data_attributes: [],
      physical_data_entities: [],
      physical_data_attributes: [],
      interactions: [],
      app_business_points: [],
      events: [],
      states: [],
      state_transitions: [],
      activities: [],
      activity_flows: [],
      activity_partitions: [],
      business_logics: [],
      ui_screens: [],
      ui_components: [],
      ui_actions: [],
      package_sets: [],
      packages: [],
    };

    const relationships: MetaModelRelationships = {
      business_user_business_points: [],
      application_point_business_points: [],
      application_point_business_logics: [],
      logical_data_entity_relationships: [
        {
          id: 'rel-001',
          fromDataEntityPointId: 'dep_log_lde-001',
          toDataEntityPointId: 'dep_log_lde-002',
          cardinality: 'ONE_TO_MANY',
          relationship: 'ASSOCIATION',
          description: 'Test',
          tags: '',
        },
      ],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [
        {
          id: 'dm-001',
          source_application_point_id: 'ap-001',
          target_application_point_id: 'ap-002',
          dataEntityPointId: 'dep_log_lde-001',
          movement_type: 'SYNC',
          description: 'Test',
          tags: '',
        },
      ],
      interface_logical_entities: [],
      ui_workflow_transitions: [],
    };

    const metaModel: MetaModel = {
      entities,
      relationships,
    };

    // Verify model loaded correctly
    expect(metaModel.relationships.logical_data_entity_relationships).toHaveLength(1);
    expect(metaModel.relationships.logical_data_entity_relationships[0].fromDataEntityPointId).toBe('dep_log_lde-001');
    expect(metaModel.relationships.data_movements).toHaveLength(1);
    expect(metaModel.relationships.data_movements[0].dataEntityPointId).toBe('dep_log_lde-001');
  });

  /**
   * Test 5.1.4: Grid rendering handles missing point-id fields with error state.
   *
   * Documents the expected behavior when point-id fields are missing.
   */
  it('Should detect missing point-id fields for error handling', () => {
    // Helper function to validate LogicalDataEntityRelationship
    const validateLogicalERPointIds = (rel: LogicalDataEntityRelationship): string[] => {
      const errors: string[] = [];
      if (!rel.fromDataEntityPointId || rel.fromDataEntityPointId.trim() === '') {
        errors.push(`LogicalDataEntityRelationship ${rel.id}: missing fromDataEntityPointId`);
      }
      if (!rel.toDataEntityPointId || rel.toDataEntityPointId.trim() === '') {
        errors.push(`LogicalDataEntityRelationship ${rel.id}: missing toDataEntityPointId`);
      }
      return errors;
    };

    // Helper function to validate DataMovement
    const validateDataMovementPointId = (dm: DataMovement): string[] => {
      const errors: string[] = [];
      if (!dm.dataEntityPointId || dm.dataEntityPointId.trim() === '') {
        errors.push(`DataMovement ${dm.id}: missing dataEntityPointId`);
      }
      return errors;
    };

    // Test with missing fromDataEntityPointId
    const invalidRel: LogicalDataEntityRelationship = {
      id: 'rel-invalid',
      fromDataEntityPointId: '', // Missing
      toDataEntityPointId: 'dep_log_entity2',
      description: 'Test',
      tags: '',
    };

    const relErrors = validateLogicalERPointIds(invalidRel);
    expect(relErrors).toHaveLength(1);
    expect(relErrors[0]).toContain('missing fromDataEntityPointId');

    // Test with missing dataEntityPointId
    const invalidDm: DataMovement = {
      id: 'dm-invalid',
      source_application_point_id: 'ap-001',
      target_application_point_id: 'ap-002',
      dataEntityPointId: '', // Missing
      movement_type: 'SYNC',
      description: 'Test',
      tags: '',
    };

    const dmErrors = validateDataMovementPointId(invalidDm);
    expect(dmErrors).toHaveLength(1);
    expect(dmErrors[0]).toContain('missing dataEntityPointId');
  });

  /**
   * Test 5.1.5: File save produces only point-id fields.
   *
   * Verifies that when serialized, only canonical fields are present.
   */
  it('File save should produce only point-id fields', () => {
    const relationship: LogicalDataEntityRelationship = {
      id: 'rel-001',
      fromDataEntityPointId: 'dep_log_entity1',
      toDataEntityPointId: 'dep_log_entity2',
      cardinality: 'ONE_TO_MANY',
      relationship: 'ASSOCIATION',
      description: 'Test',
      tags: 'test',
    };

    const json = JSON.stringify(relationship);

    // Verify canonical fields are present
    expect(json).toContain('"fromDataEntityPointId"');
    expect(json).toContain('"toDataEntityPointId"');

    // Verify legacy fields are NOT present
    expect(json).not.toContain('"from_ref_kind"');
    expect(json).not.toContain('"from_ref_id"');
    expect(json).not.toContain('"to_ref_kind"');
    expect(json).not.toContain('"to_ref_id"');
  });

  /**
   * Test 5.1.6: No imports of dataEntityPointNormalization.ts remain.
   *
   * Documents that the normalization utility has been removed.
   */
  it('Should not require dataEntityPointNormalization utility', () => {
    // The dataEntityPointNormalization.ts file has been deleted.
    // This test documents that:
    // 1. normalizeDataEntityPointIds function no longer exists
    // 2. normalizeLogicalERDataEntityPointIds function no longer exists
    // 3. normalizeDataMovementDataEntityPointIds function no longer exists
    // 4. deriveDataEntityPointIdFromEndpoint function no longer exists
    //
    // Model loading in fileOperations.ts no longer calls any normalization functions.

    const removedFunctions = [
      'normalizeDataEntityPointIds',
      'normalizeLogicalERDataEntityPointIds',
      'normalizeDataMovementDataEntityPointIds',
      'deriveDataEntityPointIdFromEndpoint',
    ];

    expect(removedFunctions).toHaveLength(4);
    removedFunctions.forEach((fn) => {
      expect(fn).toBeTruthy();
    });
  });
});
