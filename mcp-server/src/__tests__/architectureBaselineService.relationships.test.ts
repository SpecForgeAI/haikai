/**
 * Tests for FK relationship saving in architectureBaselineService.
 * Feature B: FK Relationship Saving for save_architecture_baseline
 *
 * 6 focused tests covering:
 * 1. resolveDataEntityRelationshipRefs resolves refs from new entities in idMaps
 * 2. resolveDataEntityRelationshipRefs falls back to existing model entities
 * 3. resolveDataEntityRelationshipRefs returns error for unresolvable ref
 * 4. buildDataEntityRelationships generates correct DTO shape with all fields
 * 5. mergeWithExisting upserts relationships (overwrites same from+to, appends new)
 * 6. parseAndValidate catches cross-type dataEntityRelationships (fromEntityType !== toEntityType)
 */

import {
  resolveDataEntityRelationshipRefs,
  buildDataEntityRelationships,
  mergeWithExisting,
  parseAndValidate,
  generateIds,
  BuiltEntities,
  BuiltRelationships,
} from '../services/architectureBaselineService';
import type { DataEntityRelationshipInput } from '../types/saveArchitectureBaseline';

// ============================================================================
// Test 1: resolveDataEntityRelationshipRefs resolves refs from new entities in idMaps
// ============================================================================
describe('resolveDataEntityRelationshipRefs', () => {
  it('resolves refs from new entities in idMaps', () => {
    const idMaps = generateIds({
      logicalDataEntities: [
        { name: 'Order', description: 'Order entity' },
        { name: 'Customer', description: 'Customer entity' },
      ],
    });

    const relationships: DataEntityRelationshipInput[] = [
      {
        fromEntityRef: 'Order',
        fromEntityType: 'logical',
        toEntityRef: 'Customer',
        toEntityType: 'logical',
        cardinality: '1:N',
        relationship: 'ASSOCIATION',
      },
    ];

    const { resolved, errors } = resolveDataEntityRelationshipRefs(relationships, idMaps);

    expect(errors).toHaveLength(0);
    expect(resolved).toHaveLength(1);

    const orderLdeId = idMaps.logicalDataEntities['Order'];
    const customerLdeId = idMaps.logicalDataEntities['Customer'];

    expect(resolved[0].fromDepId).toBe(`dep_log_${orderLdeId}`);
    expect(resolved[0].toDepId).toBe(`dep_log_${customerLdeId}`);
    expect(resolved[0].input).toBe(relationships[0]);
  });

  // ============================================================================
  // Test 2: resolveDataEntityRelationshipRefs falls back to existing model entities
  // ============================================================================
  it('falls back to existing model entities when not in idMaps', () => {
    const idMaps = generateIds({
      logicalDataEntities: [
        { name: 'NewEntity', description: 'New entity' },
      ],
    });

    const existingModel = {
      metaModel: {
        entities: {
          logical_data_entities: [
            { id: 'lde-existing-order-123', name: 'Order', description: 'Existing order' },
          ],
          physical_data_entities: [],
        },
      },
    };

    const relationships: DataEntityRelationshipInput[] = [
      {
        fromEntityRef: 'NewEntity',
        fromEntityType: 'logical',
        toEntityRef: 'Order',
        toEntityType: 'logical',
        cardinality: 'N:1',
      },
    ];

    const { resolved, errors } = resolveDataEntityRelationshipRefs(relationships, idMaps, existingModel);

    expect(errors).toHaveLength(0);
    expect(resolved).toHaveLength(1);

    const newEntityId = idMaps.logicalDataEntities['NewEntity'];
    expect(resolved[0].fromDepId).toBe(`dep_log_${newEntityId}`);
    expect(resolved[0].toDepId).toBe('dep_log_lde-existing-order-123');
  });

  // ============================================================================
  // Test 3: resolveDataEntityRelationshipRefs returns error for unresolvable ref
  // ============================================================================
  it('returns error for unresolvable ref', () => {
    const idMaps = generateIds({
      logicalDataEntities: [
        { name: 'Order', description: 'Order entity' },
      ],
    });

    const relationships: DataEntityRelationshipInput[] = [
      {
        fromEntityRef: 'Order',
        fromEntityType: 'logical',
        toEntityRef: 'NonExistent',
        toEntityType: 'logical',
      },
    ];

    const { resolved, errors } = resolveDataEntityRelationshipRefs(relationships, idMaps);

    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('toEntityRef');
    expect(errors[0].entityName).toBe('NonExistent');
    expect(errors[0].message).toContain('NonExistent');

    // The resolved array should NOT contain the failed pair
    expect(resolved).toHaveLength(0);
  });

  it('resolves physical entity refs correctly', () => {
    const idMaps = generateIds({
      physicalDataEntities: [
        { name: 'users_table', description: 'Users table' },
        { name: 'orders_table', description: 'Orders table' },
      ],
    });

    const relationships: DataEntityRelationshipInput[] = [
      {
        fromEntityRef: 'users_table',
        fromEntityType: 'physical',
        toEntityRef: 'orders_table',
        toEntityType: 'physical',
        cardinality: '1:N',
      },
    ];

    const { resolved, errors } = resolveDataEntityRelationshipRefs(relationships, idMaps);

    expect(errors).toHaveLength(0);
    expect(resolved).toHaveLength(1);

    const usersId = idMaps.physicalDataEntities['users_table'];
    const ordersId = idMaps.physicalDataEntities['orders_table'];

    expect(resolved[0].fromDepId).toBe(`dep_phy_${usersId}`);
    expect(resolved[0].toDepId).toBe(`dep_phy_${ordersId}`);
  });
});

// ============================================================================
// Test 4: buildDataEntityRelationships generates correct DTO shape
// ============================================================================
describe('buildDataEntityRelationships', () => {
  it('generates correct DTO shape with all fields', () => {
    const resolvedRels = [
      {
        fromDepId: 'dep_log_lde-order-001',
        toDepId: 'dep_log_lde-customer-002',
        input: {
          fromEntityRef: 'Order',
          fromEntityType: 'logical' as const,
          toEntityRef: 'Customer',
          toEntityType: 'logical' as const,
          cardinality: '1:N',
          relationship: 'COMPOSITION',
          description: 'Order belongs to Customer',
          tags: 'core',
        },
      },
      {
        fromDepId: 'dep_log_lde-invoice-003',
        toDepId: 'dep_log_lde-order-001',
        input: {
          fromEntityRef: 'Invoice',
          fromEntityType: 'logical' as const,
          toEntityRef: 'Order',
          toEntityType: 'logical' as const,
          // No optional fields - should use defaults
        },
      },
    ];

    const results = buildDataEntityRelationships(resolvedRels);

    expect(results).toHaveLength(2);

    // First relationship - all fields specified
    const rel1 = results[0];
    expect(rel1.id).toBeDefined();
    expect(rel1.id.startsWith('lder-')).toBe(true);
    expect(rel1.fromDataEntityPointId).toBe('dep_log_lde-order-001');
    expect(rel1.toDataEntityPointId).toBe('dep_log_lde-customer-002');
    expect(rel1.cardinality).toBe('1:N');
    expect(rel1.relationship).toBe('COMPOSITION');
    expect(rel1.description).toBe('Order belongs to Customer');
    expect(rel1.tags).toBe('core');
    expect(rel1.valid_from).toBeNull();
    expect(rel1.valid_to).toBeNull();

    // Second relationship - defaults
    const rel2 = results[1];
    expect(rel2.id.startsWith('lder-')).toBe(true);
    expect(rel2.cardinality).toBe('');
    expect(rel2.relationship).toBe('ASSOCIATION');
    expect(rel2.description).toBe('');
    expect(rel2.tags).toBe('');
  });
});

// ============================================================================
// Test 5: mergeWithExisting upserts relationships
// ============================================================================
describe('mergeWithExisting - data entity relationship upsert', () => {
  it('overwrites when same from+to exists, appends when new', () => {
    const existingModel = {
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
          logical_data_entities: [],
          logical_data_attributes: [],
          physical_data_entities: [],
          physical_data_attributes: [],
          data_entity_points: [],
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
              id: 'lder-existing-001',
              fromDataEntityPointId: 'dep_log_lde-order-001',
              toDataEntityPointId: 'dep_log_lde-customer-002',
              cardinality: '1:1',
              relationship: 'ASSOCIATION',
              description: 'Original relationship',
              tags: '',
            },
          ],
          logical_data_entity_physical_data_entities: [],
          logical_data_attribute_physical_data_attributes: [],
          data_movements: [],
          interface_logical_entities: [],
          ui_workflow_transitions: [],
          application_point_business_logics: [],
        },
      },
      diagrams: [],
    };

    const emptyEntities: BuiltEntities = {
      applications: [],
      app_components: [],
      services: [],
      interfaces: [],
      endpoints: [],
      logical_data_entities: [],
      physical_data_entities: [],
      logical_data_attributes: [],
      physical_data_attributes: [],
      business_logics: [],
      application_points: [],
      data_entity_points: [],
    };

    const emptyRelationships: BuiltRelationships = {
      data_movements: [],
      interface_logical_entities: [],
      logical_data_entity_physical_data_entities: [],
      application_point_business_logics: [],
    };

    const newDataEntityRelationships = [
      // Same from+to as existing - should overwrite
      {
        id: 'lder-new-001',
        fromDataEntityPointId: 'dep_log_lde-order-001',
        toDataEntityPointId: 'dep_log_lde-customer-002',
        cardinality: '1:N',
        relationship: 'COMPOSITION',
        description: 'Updated relationship',
        tags: 'updated',
        valid_from: null,
        valid_to: null,
      },
      // New from+to - should append
      {
        id: 'lder-new-002',
        fromDataEntityPointId: 'dep_log_lde-invoice-003',
        toDataEntityPointId: 'dep_log_lde-order-001',
        cardinality: 'N:1',
        relationship: 'ASSOCIATION',
        description: 'New relationship',
        tags: '',
        valid_from: null,
        valid_to: null,
      },
    ];

    const { model: merged } = mergeWithExisting(
      existingModel,
      emptyEntities,
      emptyRelationships,
      undefined,
      newDataEntityRelationships
    );

    const rels = merged.metaModel.relationships.logical_data_entity_relationships;

    // Should have 2: 1 overwritten + 1 new
    expect(rels).toHaveLength(2);

    // The overwritten one should have updated fields
    const overwritten = rels.find(
      (r: any) =>
        r.fromDataEntityPointId === 'dep_log_lde-order-001' &&
        r.toDataEntityPointId === 'dep_log_lde-customer-002'
    );
    expect(overwritten).toBeDefined();
    expect(overwritten.cardinality).toBe('1:N');
    expect(overwritten.relationship).toBe('COMPOSITION');
    expect(overwritten.description).toBe('Updated relationship');
    expect(overwritten.tags).toBe('updated');

    // The new one should be appended
    const appended = rels.find(
      (r: any) =>
        r.fromDataEntityPointId === 'dep_log_lde-invoice-003' &&
        r.toDataEntityPointId === 'dep_log_lde-order-001'
    );
    expect(appended).toBeDefined();
    expect(appended.id).toBe('lder-new-002');
    expect(appended.cardinality).toBe('N:1');
    expect(appended.description).toBe('New relationship');
  });
});

// ============================================================================
// Test 6: parseAndValidate catches cross-type dataEntityRelationships
// ============================================================================
describe('parseAndValidate - dataEntityRelationships validation', () => {
  it('catches cross-type FK links (fromEntityType !== toEntityType)', () => {
    const payload = JSON.stringify({
      dataEntityRelationships: [
        {
          fromEntityRef: 'Order',
          fromEntityType: 'logical',
          toEntityRef: 'orders_table',
          toEntityType: 'physical',
        },
      ],
    });

    const { errors } = parseAndValidate(payload);

    const crossTypeErrors = errors.filter(
      (e) => e.field === 'fromEntityType/toEntityType'
    );
    expect(crossTypeErrors).toHaveLength(1);
    expect(crossTypeErrors[0].message).toContain('Cross-type');
    expect(crossTypeErrors[0].message).toContain('logical');
    expect(crossTypeErrors[0].message).toContain('physical');
  });

  it('accepts same-type FK links', () => {
    const payload = JSON.stringify({
      dataEntityRelationships: [
        {
          fromEntityRef: 'Order',
          fromEntityType: 'logical',
          toEntityRef: 'Customer',
          toEntityType: 'logical',
        },
      ],
    });

    const { errors } = parseAndValidate(payload);

    const crossTypeErrors = errors.filter(
      (e) => e.field === 'fromEntityType/toEntityType'
    );
    expect(crossTypeErrors).toHaveLength(0);
  });

  it('catches invalid entity type values', () => {
    const payload = JSON.stringify({
      dataEntityRelationships: [
        {
          fromEntityRef: 'Order',
          fromEntityType: 'invalid_type',
          toEntityRef: 'Customer',
          toEntityType: 'logical',
        },
      ],
    });

    const { errors } = parseAndValidate(payload);

    const typeErrors = errors.filter(
      (e) => e.field === 'fromEntityType'
    );
    expect(typeErrors).toHaveLength(1);
    expect(typeErrors[0].message).toContain('invalid_type');
  });

  it('catches empty fromEntityRef and toEntityRef', () => {
    const payload = JSON.stringify({
      dataEntityRelationships: [
        {
          fromEntityRef: '',
          fromEntityType: 'logical',
          toEntityRef: '',
          toEntityType: 'logical',
        },
      ],
    });

    const { errors } = parseAndValidate(payload);

    const refErrors = errors.filter(
      (e) => e.field === 'fromEntityRef' || e.field === 'toEntityRef'
    );
    expect(refErrors).toHaveLength(2);
  });
});
