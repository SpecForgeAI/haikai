/**
 * Tests for delete support in architectureBaselineService.
 * Feature A: Delete Support for save_architecture_baseline
 *
 * 6 focused tests covering:
 * 1. applyDeletions removes a logical entity, its attributes, data_entity_point, and cascading relationships
 * 2. applyDeletions removes a physical entity similarly
 * 3. applyDeletions with entity not found returns warning, not error
 * 4. applyDeletions with relationship not found returns warning, not error
 * 5. Delete followed by add in same mergeWithExisting works correctly
 * 6. parseAndValidate catches invalid entityType in entitiesToDelete
 */

import {
  applyDeletions,
  mergeWithExisting,
  parseAndValidate,
  BuiltEntities,
  BuiltRelationships,
} from '../services/architectureBaselineService';

// ============================================================================
// Helper: create a model with logical and physical entities, attributes, and relationships
// ============================================================================
function createModelWithEntities(): any {
  return {
    metaModel: {
      entities: {
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
          { id: 'lde-order-001', name: 'Order', description: 'Order entity' },
          { id: 'lde-customer-002', name: 'Customer', description: 'Customer entity' },
        ],
        logical_data_attributes: [
          { id: 'lda-order-id-001', name: 'orderId', logical_entity_id: 'lde-order-001', data_type: 'string' },
          { id: 'lda-order-total-002', name: 'total', logical_entity_id: 'lde-order-001', data_type: 'number' },
          { id: 'lda-customer-name-003', name: 'name', logical_entity_id: 'lde-customer-002', data_type: 'string' },
        ],
        physical_data_entities: [
          { id: 'pde-orders-001', name: 'orders_table', description: 'Orders DB table' },
        ],
        physical_data_attributes: [
          { id: 'pda-order-id-001', name: 'order_id', physical_entity_id: 'pde-orders-001', data_type: 'BIGINT' },
          { id: 'pda-total-002', name: 'total_amount', physical_entity_id: 'pde-orders-001', data_type: 'DECIMAL' },
        ],
        data_entity_points: [
          { id: 'dep_log_lde-order-001', point_kind: 'LOGICAL_ENTITY', logical_entity_id: 'lde-order-001', physical_entity_id: null },
          { id: 'dep_log_lde-customer-002', point_kind: 'LOGICAL_ENTITY', logical_entity_id: 'lde-customer-002', physical_entity_id: null },
          { id: 'dep_phy_pde-orders-001', point_kind: 'PHYSICAL_ENTITY', logical_entity_id: null, physical_entity_id: 'pde-orders-001' },
        ],
        interactions: [],
        app_business_points: [],
        events: [],
        states: [],
        state_transitions: [],
        activities: [],
        activity_flows: [],
        activity_partitions: [],
        ui_screens: [],
        ui_contracts: [],
        ui_components: [],
        ui_actions: [],
        ui_characteristics: [],
        business_logics: [],
        package_sets: [],
        packages: [],
        package_set_default_rules: [],
      },
      relationships: {
        business_user_business_points: [],
        application_point_business_points: [],
        logical_data_entity_relationships: [
          {
            id: 'lder-001',
            fromDataEntityPointId: 'dep_log_lde-order-001',
            toDataEntityPointId: 'dep_log_lde-customer-002',
            cardinality: '1:N',
            relationship: 'ASSOCIATION',
          },
        ],
        logical_data_entity_physical_data_entities: [
          {
            id: 'ldepe-001',
            logical_entity_id: 'lde-order-001',
            physical_entity_id: 'pde-orders-001',
          },
        ],
        logical_data_attribute_physical_data_attributes: [],
        data_movements: [
          {
            id: 'dm-001',
            source_application_point_id: 'ap_svc-001',
            target_application_point_id: 'ap_svc-002',
            dataEntityPointId: 'dep_log_lde-order-001',
          },
        ],
        interface_logical_entities: [],
        ui_workflow_transitions: [],
        application_point_business_logics: [],
      },
    },
    diagrams: [],
  };
}

// ============================================================================
// Test 1: applyDeletions removes a logical entity and cascades
// ============================================================================
describe('applyDeletions - logical entity', () => {
  it('removes a logical entity, its attributes, data_entity_point, and cascading relationships', () => {
    const model = createModelWithEntities();

    const result = applyDeletions(
      model,
      [{ entityType: 'logical_data_entities', name: 'Order' }],
      []
    );

    expect(result.deletedEntities).toBe(1);
    expect(result.deletedRelationships).toBe(0);
    expect(result.warnings).toHaveLength(0);

    // The Order entity should be removed
    const remainingEntities = model.metaModel.entities.logical_data_entities;
    expect(remainingEntities).toHaveLength(1);
    expect(remainingEntities[0].name).toBe('Customer');

    // Attributes belonging to Order should be removed (orderId, total)
    const remainingAttrs = model.metaModel.entities.logical_data_attributes;
    expect(remainingAttrs).toHaveLength(1);
    expect(remainingAttrs[0].name).toBe('name'); // Customer's attribute remains

    // The data_entity_point for Order should be removed
    const remainingDeps = model.metaModel.entities.data_entity_points;
    expect(remainingDeps).toHaveLength(2); // Customer DEP + physical DEP remain
    expect(remainingDeps.find((d: any) => d.id === 'dep_log_lde-order-001')).toBeUndefined();

    // The logical_data_entity_relationship referencing Order's DEP should be removed
    expect(model.metaModel.relationships.logical_data_entity_relationships).toHaveLength(0);

    // The logical_data_entity_physical_data_entities referencing Order's ID should be removed
    expect(model.metaModel.relationships.logical_data_entity_physical_data_entities).toHaveLength(0);

    // The data_movement referencing Order's DEP should be removed
    expect(model.metaModel.relationships.data_movements).toHaveLength(0);
  });
});

// ============================================================================
// Test 2: applyDeletions removes a physical entity and cascades
// ============================================================================
describe('applyDeletions - physical entity', () => {
  it('removes a physical entity, its attributes, data_entity_point, and cascading relationships', () => {
    const model = createModelWithEntities();

    const result = applyDeletions(
      model,
      [{ entityType: 'physical_data_entities', name: 'orders_table' }],
      []
    );

    expect(result.deletedEntities).toBe(1);
    expect(result.warnings).toHaveLength(0);

    // The orders_table entity should be removed
    expect(model.metaModel.entities.physical_data_entities).toHaveLength(0);

    // Physical attributes belonging to orders_table should be removed
    expect(model.metaModel.entities.physical_data_attributes).toHaveLength(0);

    // The physical DEP should be removed
    const physDeps = model.metaModel.entities.data_entity_points.filter(
      (d: any) => d.id === 'dep_phy_pde-orders-001'
    );
    expect(physDeps).toHaveLength(0);

    // The logical_data_entity_physical_data_entities mapping should be removed
    expect(model.metaModel.relationships.logical_data_entity_physical_data_entities).toHaveLength(0);

    // Logical entities should remain untouched
    expect(model.metaModel.entities.logical_data_entities).toHaveLength(2);
    expect(model.metaModel.entities.logical_data_attributes).toHaveLength(3);
  });
});

// ============================================================================
// Test 3: applyDeletions with entity not found returns warning
// ============================================================================
describe('applyDeletions - entity not found', () => {
  it('returns a warning when entity is not found, not an error', () => {
    const model = createModelWithEntities();

    const result = applyDeletions(
      model,
      [{ entityType: 'logical_data_entities', name: 'NonExistent' }],
      []
    );

    expect(result.deletedEntities).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('NonExistent');
    expect(result.warnings[0]).toContain('not found');

    // Nothing should be removed from the model
    expect(model.metaModel.entities.logical_data_entities).toHaveLength(2);
    expect(model.metaModel.entities.logical_data_attributes).toHaveLength(3);
  });
});

// ============================================================================
// Test 4: applyDeletions with relationship not found returns warning
// ============================================================================
describe('applyDeletions - relationship not found', () => {
  it('returns a warning when relationship is not found, not an error', () => {
    const model = createModelWithEntities();

    const result = applyDeletions(
      model,
      [],
      [{ relationshipType: 'logical_data_entity_relationships', id: 'non-existent-id' }]
    );

    expect(result.deletedRelationships).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('non-existent-id');
    expect(result.warnings[0]).toContain('not found');

    // Existing relationship should remain
    expect(model.metaModel.relationships.logical_data_entity_relationships).toHaveLength(1);
  });

  it('returns a warning when relationship type does not exist', () => {
    const model = createModelWithEntities();

    const result = applyDeletions(
      model,
      [],
      [{ relationshipType: 'non_existent_type', id: 'some-id' }]
    );

    expect(result.deletedRelationships).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('non_existent_type');
  });

  it('deletes an existing relationship by ID', () => {
    const model = createModelWithEntities();

    const result = applyDeletions(
      model,
      [],
      [{ relationshipType: 'logical_data_entity_relationships', id: 'lder-001' }]
    );

    expect(result.deletedRelationships).toBe(1);
    expect(result.warnings).toHaveLength(0);
    expect(model.metaModel.relationships.logical_data_entity_relationships).toHaveLength(0);
  });
});

// ============================================================================
// Test 5: Delete followed by add in same mergeWithExisting
// ============================================================================
describe('Delete then add in mergeWithExisting', () => {
  it('deletes entity A then adds new entity A with same name in same merge', () => {
    const existingModel = createModelWithEntities();

    // New entities: add a new Order entity with different attributes
    const newEntities: BuiltEntities = {
      applications: [],
      app_components: [],
      services: [],
      interfaces: [],
      endpoints: [],
      logical_data_entities: [
        { id: 'lde-new-order-999', name: 'Order', description: 'Redesigned Order entity' },
      ],
      physical_data_entities: [],
      logical_data_attributes: [
        {
          id: 'lda-new-order-id-999',
          name: 'orderId',
          logical_entity_id: 'lde-new-order-999',
          data_type: 'UUID',
          is_primary_key: true,
          is_nullable: false,
        },
      ],
      physical_data_attributes: [],
      business_logics: [],
      application_points: [],
      data_entity_points: [
        { id: 'dep_log_lde-new-order-999', point_kind: 'LOGICAL_ENTITY', logical_entity_id: 'lde-new-order-999', physical_entity_id: null },
      ],
    };

    const newRelationships: BuiltRelationships = {
      data_movements: [],
      interface_logical_entities: [],
      logical_data_entity_physical_data_entities: [],
      application_point_business_logics: [],
    };

    const deletions = {
      entitiesToDelete: [{ entityType: 'logical_data_entities' as const, name: 'Order' }],
      relationshipsToDelete: [],
    };

    const { model: merged, deletedEntities, deletedRelationships } = mergeWithExisting(
      existingModel,
      newEntities,
      newRelationships,
      deletions
    );

    expect(deletedEntities).toBe(1);
    expect(deletedRelationships).toBe(0);

    // The old Order should be gone, new Order should be present
    const orders = merged.metaModel.entities.logical_data_entities.filter(
      (e: any) => e.name === 'Order'
    );
    expect(orders).toHaveLength(1);
    expect(orders[0].id).toBe('lde-new-order-999');
    expect(orders[0].description).toBe('Redesigned Order entity');

    // Customer should still be present
    const customers = merged.metaModel.entities.logical_data_entities.filter(
      (e: any) => e.name === 'Customer'
    );
    expect(customers).toHaveLength(1);

    // New Order attributes should be present
    const orderAttrs = merged.metaModel.entities.logical_data_attributes.filter(
      (a: any) => a.logical_entity_id === 'lde-new-order-999'
    );
    expect(orderAttrs).toHaveLength(1);
    expect(orderAttrs[0].name).toBe('orderId');
    expect(orderAttrs[0].data_type).toBe('UUID');

    // Customer attributes should remain
    const customerAttrs = merged.metaModel.entities.logical_data_attributes.filter(
      (a: any) => a.logical_entity_id === 'lde-customer-002'
    );
    expect(customerAttrs).toHaveLength(1);

    // New DEP should exist
    const newDeps = merged.metaModel.entities.data_entity_points.filter(
      (d: any) => d.id === 'dep_log_lde-new-order-999'
    );
    expect(newDeps).toHaveLength(1);
  });
});

// ============================================================================
// Test 6: parseAndValidate catches invalid entityType in entitiesToDelete
// ============================================================================
describe('parseAndValidate - entitiesToDelete validation', () => {
  it('catches invalid entityType in entitiesToDelete', () => {
    const payload = JSON.stringify({
      entitiesToDelete: [
        { entityType: 'services', name: 'SomeService' },
      ],
    });

    const { errors } = parseAndValidate(payload);

    const entityTypeErrors = errors.filter(
      (e) => e.field === 'entityType' && e.entityType === 'entitiesToDelete'
    );
    expect(entityTypeErrors).toHaveLength(1);
    expect(entityTypeErrors[0].message).toContain('services');
    expect(entityTypeErrors[0].message).toContain('must be');
  });

  it('catches missing name in entitiesToDelete', () => {
    const payload = JSON.stringify({
      entitiesToDelete: [
        { entityType: 'logical_data_entities', name: '' },
      ],
    });

    const { errors } = parseAndValidate(payload);

    const nameErrors = errors.filter(
      (e) => e.field === 'name' && e.entityType === 'entitiesToDelete'
    );
    expect(nameErrors).toHaveLength(1);
  });

  it('validates relationshipsToDelete fields', () => {
    const payload = JSON.stringify({
      relationshipsToDelete: [
        { relationshipType: '', id: 'some-id' },
        { relationshipType: 'logical_data_entity_relationships', id: '' },
      ],
    });

    const { errors } = parseAndValidate(payload);

    const relErrors = errors.filter((e) => e.entityType === 'relationshipsToDelete');
    expect(relErrors).toHaveLength(2);
  });
});
