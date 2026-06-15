/**
 * Task Group 3: Cascade Delete Tests
 *
 * Tests for comprehensive cascade delete functionality across all entity types.
 * Each entity type has a dedicated cascade delete function that removes all
 * referencing relationships from the MetaModelRelationships object.
 */

import { describe, test, expect } from 'vitest';

import {
  MetaModelRelationships,
  BusinessUserBusinessPoint,
  ApplicationPointBusinessPoint,
  LogicalDataEntityRelationship,
  LogicalDataEntityPhysicalDataEntity,
  LogicalDataAttributePhysicalDataAttribute,
  DataMovement,
  InterfaceLogicalEntity,
} from '../types/model';

import {
  cascadeDeleteBusinessUser,
  cascadeDeleteBusinessProcess,
  cascadeDeleteLogicalDataEntity,
  cascadeDeletePhysicalDataEntity,
  cascadeDeleteLogicalDataAttribute,
  cascadeDeletePhysicalDataAttribute,
  cascadeDeleteApplicationPoint,
} from '../utils/applicationPointSync';
import { cascadeDeleteBusinessPoint } from '../utils/businessPointSync';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create a minimal MetaModelRelationships object for testing
 */
function createTestRelationships(): MetaModelRelationships {
  return {
    // Business Point relationships (bp_<sourceEntityId> deterministic ids)
    business_user_business_points: [
      {
        id: 'bup_1',
        business_user_id: 'bu_1',
        business_point_id: 'bpt_1',
        description: 'User 1 - Point 1',
        tags: '',
      },
      {
        id: 'bup_2',
        business_user_id: 'bu_1',
        business_point_id: 'bpt_2',
        description: 'User 1 - Point 2',
        tags: '',
      },
      {
        id: 'bup_3',
        business_user_id: 'bu_2',
        business_point_id: 'bpt_1',
        description: 'User 2 - Point 1',
        tags: '',
      },
    ] as BusinessUserBusinessPoint[],
    application_point_business_points: [
      {
        id: 'apbp_1',
        application_point_id: 'ap_1',
        business_point_id: 'bpt_1',
        description: 'AP 1 - Point 1',
        tags: '',
      },
      {
        id: 'apbp_2',
        application_point_id: 'ap_1',
        business_point_id: 'bpt_2',
        description: 'AP 1 - Point 2',
        tags: '',
      },
      {
        id: 'apbp_3',
        application_point_id: 'ap_2',
        business_point_id: 'bpt_1',
        description: 'AP 2 - Point 1',
        tags: '',
      },
    ] as ApplicationPointBusinessPoint[],
    logical_data_entity_relationships: [
      {
        id: 'lder_1',
        fromDataEntityPointId: 'dep_log_lde_1',
        toDataEntityPointId: 'dep_log_lde_2',
        description: 'Entity 1 to Entity 2',
        tags: '',
      },
      {
        id: 'lder_2',
        fromDataEntityPointId: 'dep_log_lde_2',
        toDataEntityPointId: 'dep_log_lde_3',
        description: 'Entity 2 to Entity 3',
        tags: '',
      },
      {
        id: 'lder_3',
        fromDataEntityPointId: 'dep_log_lde_3',
        toDataEntityPointId: 'dep_log_lde_1',
        description: 'Entity 3 to Entity 1',
        tags: '',
      },
    ] as LogicalDataEntityRelationship[],
    logical_data_entity_physical_data_entities: [
      {
        id: 'ldepde_1',
        logical_entity_id: 'lde_1',
        physical_entity_id: 'pde_1',
        description: 'Logical 1 to Physical 1',
        tags: '',
      },
      {
        id: 'ldepde_2',
        logical_entity_id: 'lde_1',
        physical_entity_id: 'pde_2',
        description: 'Logical 1 to Physical 2',
        tags: '',
      },
      {
        id: 'ldepde_3',
        logical_entity_id: 'lde_2',
        physical_entity_id: 'pde_1',
        description: 'Logical 2 to Physical 1',
        tags: '',
      },
    ] as LogicalDataEntityPhysicalDataEntity[],
    logical_data_attribute_physical_data_attributes: [
      {
        id: 'ldapda_1',
        logical_attribute_id: 'lda_1',
        physical_attribute_id: 'pda_1',
        description: 'Logical Attr 1 to Physical Attr 1',
        tags: '',
      },
      {
        id: 'ldapda_2',
        logical_attribute_id: 'lda_1',
        physical_attribute_id: 'pda_2',
        description: 'Logical Attr 1 to Physical Attr 2',
        tags: '',
      },
      {
        id: 'ldapda_3',
        logical_attribute_id: 'lda_2',
        physical_attribute_id: 'pda_1',
        description: 'Logical Attr 2 to Physical Attr 1',
        tags: '',
      },
    ] as LogicalDataAttributePhysicalDataAttribute[],
    data_movements: [
      {
        id: 'dm_1',
        source_application_point_id: 'ap_1',
        target_application_point_id: 'ap_2',
        dataEntityPointId: 'dep_log_lde_1',
        movement_type: 'SYNC',
        description: 'AP 1 to AP 2 - Entity 1',
        tags: '',
      },
      {
        id: 'dm_2',
        source_application_point_id: 'ap_2',
        target_application_point_id: 'ap_3',
        dataEntityPointId: 'dep_log_lde_2',
        movement_type: 'ASYNC',
        description: 'AP 2 to AP 3 - Entity 2',
        tags: '',
      },
      {
        id: 'dm_3',
        source_application_point_id: 'ap_1',
        target_application_point_id: 'ap_3',
        dataEntityPointId: 'dep_log_lde_1',
        movement_type: 'BATCH',
        description: 'AP 1 to AP 3 - Entity 1',
        tags: '',
      },
    ] as DataMovement[],
    interface_logical_entities: [
      {
        id: 'ile_1',
        interface_id: 'int_1',
        dataEntityPointId: 'dep_log_lde_1',
        description: 'Interface 1 exposes Entity 1',
        tags: '',
      },
      {
        id: 'ile_2',
        interface_id: 'int_1',
        dataEntityPointId: 'dep_log_lde_2',
        description: 'Interface 1 exposes Entity 2',
        tags: '',
      },
    ] as InterfaceLogicalEntity[],
  };
}

// ============================================================================
// Test Suite: Cascade Delete for BusinessUser
// ============================================================================

describe('cascadeDeleteBusinessUser', () => {
  test('removes all business_user_business_points where business_user_id matches', () => {
    const relationships = createTestRelationships();

    // Delete bu_1 - should remove bup_1 and bup_2 (both reference bu_1)
    const result = cascadeDeleteBusinessUser('bu_1', relationships);

    // Should only have bup_3 remaining (references bu_2)
    expect(result.business_user_business_points).toHaveLength(1);
    expect(result.business_user_business_points[0].id).toBe('bup_3');
    expect(result.business_user_business_points[0].business_user_id).toBe('bu_2');

    // Other relationships should be unchanged
    expect(result.application_point_business_points).toHaveLength(3);
    expect(result.logical_data_entity_relationships).toHaveLength(3);
    expect(result.data_movements).toHaveLength(3);
  });

  test('returns unchanged relationships when no matches found', () => {
    const relationships = createTestRelationships();

    // Delete non-existent user
    const result = cascadeDeleteBusinessUser('bu_nonexistent', relationships);

    // All relationships should remain unchanged
    expect(result.business_user_business_points).toHaveLength(3);
    expect(result.application_point_business_points).toHaveLength(3);
  });
});

// ============================================================================
// Test Suite: Cascade Delete for BusinessProcess
// ============================================================================

describe('cascadeDeleteBusinessProcess / cascadeDeleteBusinessPoint', () => {
  test('business process deletion cascades via its Business Point (cascadeDeleteBusinessPoint)', () => {
    // Production routes Business Process deletion through
    // cascadeDeleteForBusinessSourceEntity -> cascadeDeleteBusinessPoint
    // (the BP wrapping the process). cascadeDeleteBusinessProcess itself
    // is a deliberate no-op kept for backward compatibility.
    const relationships = createTestRelationships();

    // Delete the Business Point bpt_1 (wraps bp_1) -> removes bup_1, bup_3, apbp_1, apbp_3
    const result = cascadeDeleteBusinessPoint('bpt_1', relationships);

    // business_user_business_points: only bup_2 remains (references bpt_2)
    expect(result.business_user_business_points).toHaveLength(1);
    expect(result.business_user_business_points[0].id).toBe('bup_2');
    expect(result.business_user_business_points[0].business_point_id).toBe('bpt_2');

    // application_point_business_points: only apbp_2 remains (references bpt_2)
    expect(result.application_point_business_points).toHaveLength(1);
    expect(result.application_point_business_points[0].id).toBe('apbp_2');
    expect(result.application_point_business_points[0].business_point_id).toBe('bpt_2');

    // Other relationships should be unchanged
    expect(result.logical_data_entity_relationships).toHaveLength(3);
    expect(result.data_movements).toHaveLength(3);
  });

  test('cascadeDeleteBusinessProcess itself is a no-op (BP cascade owns the deletion)', () => {
    const relationships = createTestRelationships();

    const result = cascadeDeleteBusinessProcess('bp_1', relationships);

    // All relationship arrays unchanged - the Business Point cascade is the
    // mechanism that removes the rows.
    expect(result.business_user_business_points).toHaveLength(3);
    expect(result.application_point_business_points).toHaveLength(3);
  });
});

// ============================================================================
// Test Suite: Cascade Delete for LogicalDataEntity
// ============================================================================

describe('cascadeDeleteLogicalDataEntity', () => {
  test('removes logical_data_entity_relationships (from OR to), logical_data_entity_physical_data_entities, data_movements AND interface_logical_entities referencing the entity', () => {
    const relationships = createTestRelationships();

    // Delete lde_1 - should remove:
    // - lder_1 (fromDataEntityPointId = dep_log_lde_1)
    // - lder_3 (toDataEntityPointId = dep_log_lde_1)
    // - ldepde_1, ldepde_2 (logical_entity_id = lde_1)
    // - dm_1, dm_3 (dataEntityPointId = dep_log_lde_1)
    // - ile_1 (dataEntityPointId = dep_log_lde_1)
    const result = cascadeDeleteLogicalDataEntity('lde_1', relationships);

    // logical_data_entity_relationships: only lder_2 remains
    expect(result.logical_data_entity_relationships).toHaveLength(1);
    expect(result.logical_data_entity_relationships[0].id).toBe('lder_2');

    // logical_data_entity_physical_data_entities: only ldepde_3 remains
    expect(result.logical_data_entity_physical_data_entities).toHaveLength(1);
    expect(result.logical_data_entity_physical_data_entities[0].id).toBe('ldepde_3');

    // data_movements: only dm_2 remains
    expect(result.data_movements).toHaveLength(1);
    expect(result.data_movements[0].id).toBe('dm_2');

    // interface_logical_entities: only ile_2 remains
    expect(result.interface_logical_entities).toHaveLength(1);
    expect(result.interface_logical_entities[0].id).toBe('ile_2');

    // Other relationships should be unchanged
    expect(result.business_user_business_points).toHaveLength(3);
    expect(result.application_point_business_points).toHaveLength(3);
    expect(result.logical_data_attribute_physical_data_attributes).toHaveLength(3);
  });

  test('removes relationships where entity is target (not just source)', () => {
    const relationships = createTestRelationships();

    // Delete lde_2 - should remove:
    // - lder_1 (toDataEntityPointId = dep_log_lde_2)
    // - lder_2 (fromDataEntityPointId = dep_log_lde_2)
    // - ldepde_3 (logical_entity_id = lde_2)
    // - dm_2 (dataEntityPointId = dep_log_lde_2)
    const result = cascadeDeleteLogicalDataEntity('lde_2', relationships);

    // logical_data_entity_relationships: only lder_3 remains
    expect(result.logical_data_entity_relationships).toHaveLength(1);
    expect(result.logical_data_entity_relationships[0].id).toBe('lder_3');

    // logical_data_entity_physical_data_entities: ldepde_1, ldepde_2 remain
    expect(result.logical_data_entity_physical_data_entities).toHaveLength(2);

    // data_movements: dm_1, dm_3 remain
    expect(result.data_movements).toHaveLength(2);
  });
});

// ============================================================================
// Test Suite: Cascade Delete for PhysicalDataEntity
// ============================================================================

describe('cascadeDeletePhysicalDataEntity', () => {
  test('removes logical_data_entity_physical_data_entities where physical_entity_id matches', () => {
    const relationships = createTestRelationships();

    // Delete pde_1 - should remove ldepde_1, ldepde_3 (both reference pde_1)
    const result = cascadeDeletePhysicalDataEntity('pde_1', relationships);

    // logical_data_entity_physical_data_entities: only ldepde_2 remains
    expect(result.logical_data_entity_physical_data_entities).toHaveLength(1);
    expect(result.logical_data_entity_physical_data_entities[0].id).toBe('ldepde_2');
    expect(result.logical_data_entity_physical_data_entities[0].physical_entity_id).toBe('pde_2');

    // Other relationships should be unchanged (no rows reference dep_phy_pde_1)
    expect(result.business_user_business_points).toHaveLength(3);
    expect(result.logical_data_entity_relationships).toHaveLength(3);
    expect(result.data_movements).toHaveLength(3);
  });

  test('returns unchanged relationships when no matches found', () => {
    const relationships = createTestRelationships();

    // Delete non-existent physical entity
    const result = cascadeDeletePhysicalDataEntity('pde_nonexistent', relationships);

    // All relationships should remain unchanged
    expect(result.logical_data_entity_physical_data_entities).toHaveLength(3);
  });
});

// ============================================================================
// Test Suite: Cascade Delete for LogicalDataAttribute
// ============================================================================

describe('cascadeDeleteLogicalDataAttribute', () => {
  test('removes logical_data_attribute_physical_data_attributes where logical_attribute_id matches', () => {
    const relationships = createTestRelationships();

    // Delete lda_1 - should remove ldapda_1, ldapda_2 (both reference lda_1)
    const result = cascadeDeleteLogicalDataAttribute('lda_1', relationships);

    // logical_data_attribute_physical_data_attributes: only ldapda_3 remains
    expect(result.logical_data_attribute_physical_data_attributes).toHaveLength(1);
    expect(result.logical_data_attribute_physical_data_attributes[0].id).toBe('ldapda_3');
    expect(result.logical_data_attribute_physical_data_attributes[0].logical_attribute_id).toBe('lda_2');

    // Other relationships should be unchanged
    expect(result.business_user_business_points).toHaveLength(3);
    expect(result.logical_data_entity_relationships).toHaveLength(3);
  });

  test('returns unchanged relationships when no matches found', () => {
    const relationships = createTestRelationships();

    // Delete non-existent logical attribute
    const result = cascadeDeleteLogicalDataAttribute('lda_nonexistent', relationships);

    // All relationships should remain unchanged
    expect(result.logical_data_attribute_physical_data_attributes).toHaveLength(3);
  });
});

// ============================================================================
// Test Suite: Cascade Delete for PhysicalDataAttribute
// ============================================================================

describe('cascadeDeletePhysicalDataAttribute', () => {
  test('removes logical_data_attribute_physical_data_attributes where physical_attribute_id matches', () => {
    const relationships = createTestRelationships();

    // Delete pda_1 - should remove ldapda_1, ldapda_3 (both reference pda_1)
    const result = cascadeDeletePhysicalDataAttribute('pda_1', relationships);

    // logical_data_attribute_physical_data_attributes: only ldapda_2 remains
    expect(result.logical_data_attribute_physical_data_attributes).toHaveLength(1);
    expect(result.logical_data_attribute_physical_data_attributes[0].id).toBe('ldapda_2');
    expect(result.logical_data_attribute_physical_data_attributes[0].physical_attribute_id).toBe('pda_2');

    // Other relationships should be unchanged
    expect(result.business_user_business_points).toHaveLength(3);
    expect(result.logical_data_entity_relationships).toHaveLength(3);
  });

  test('returns unchanged relationships when no matches found', () => {
    const relationships = createTestRelationships();

    // Delete non-existent physical attribute
    const result = cascadeDeletePhysicalDataAttribute('pda_nonexistent', relationships);

    // All relationships should remain unchanged
    expect(result.logical_data_attribute_physical_data_attributes).toHaveLength(3);
  });
});

// ============================================================================
// Test Suite: Existing ApplicationPoint Cascade Delete (Regression Test)
// ============================================================================

describe('cascadeDeleteApplicationPoint (existing functionality)', () => {
  test('removes application_point_business_points where application_point_id matches', () => {
    const relationships = createTestRelationships();

    // Delete ap_1 - should remove apbp_1, apbp_2 (both reference ap_1)
    const result = cascadeDeleteApplicationPoint('ap_1', relationships);

    // application_point_business_points: only apbp_3 remains
    expect(result.application_point_business_points).toHaveLength(1);
    expect(result.application_point_business_points[0].id).toBe('apbp_3');
    expect(result.application_point_business_points[0].application_point_id).toBe('ap_2');

    // Other relationships should be unchanged
    expect(result.business_user_business_points).toHaveLength(3);
    expect(result.logical_data_entity_relationships).toHaveLength(3);
  });

  test('removes data_movements referencing the deleted application point', () => {
    const relationships = createTestRelationships();

    // Delete ap_1 - data movements now reference application POINTS, so
    // dm_1 (source ap_1) and dm_3 (source ap_1) are removed; dm_2 remains.
    const result = cascadeDeleteApplicationPoint('ap_1', relationships);

    expect(result.data_movements).toHaveLength(1);
    expect(result.data_movements.map(dm => dm.id)).toEqual(['dm_2']);
  });
});
