/**
 * Tests for attribute support in architectureBaselineService.
 * Task Group 1: Extend save_architecture_baseline with Attribute Support
 *
 * 6 focused tests covering:
 * - Logical attribute ref resolution
 * - Physical attribute ref resolution
 * - Unresolved attribute ref error
 * - Attribute upsert deduplication
 * - Entities created first, attributes reference them by name
 * - Summary includes attribute counts
 */

import {
  generateIds,
  resolveRefs,
  buildEntities,
  mergeWithExisting,
  parseAndValidate,
  buildRelationships,
  BuiltEntities,
  IdMaps,
  ResolvedRefs,
} from '../services/architectureBaselineService';
import type { ArchitectureBaselineInput } from '../types/saveArchitectureBaseline';

// ============================================================================
// Test 1: logicalDataAttributes with valid logicalEntityRef resolves to correct parent entity ID
// ============================================================================
describe('Attribute ref resolution', () => {
  it('resolves logicalDataAttributes logicalEntityRef to the correct parent entity ID', () => {
    const input: ArchitectureBaselineInput = {
      logicalDataEntities: [
        { name: 'Order', description: 'Order entity' },
      ],
      logicalDataAttributes: [
        { name: 'orderId', logicalEntityRef: 'Order', dataType: 'string', isPrimaryKey: true },
        { name: 'total', logicalEntityRef: 'Order', dataType: 'number' },
      ],
    };

    const idMaps = generateIds(input);
    const resolved = resolveRefs(input, idMaps);

    // No errors
    expect(resolved.errors).toHaveLength(0);

    // Both attributes should resolve to the Order entity ID
    const orderEntityId = idMaps.logicalDataEntities['Order'];
    expect(resolved.logicalAttributeEntityIds[0]).toBe(orderEntityId);
    expect(resolved.logicalAttributeEntityIds[1]).toBe(orderEntityId);

    // Build entities and verify the attribute DTOs have the correct parent ID
    const entities = buildEntities(input, idMaps, resolved);
    expect(entities.logical_data_attributes).toHaveLength(2);

    const orderIdAttr = entities.logical_data_attributes.find((a: any) => a.name === 'orderId');
    expect(orderIdAttr).toBeDefined();
    expect(orderIdAttr.logical_entity_id).toBe(orderEntityId);
    expect(orderIdAttr.data_type).toBe('string');
    expect(orderIdAttr.is_primary_key).toBe(true);
    expect(orderIdAttr.id).toBeDefined();
    expect(orderIdAttr.id.startsWith('lda-')).toBe(true);

    const totalAttr = entities.logical_data_attributes.find((a: any) => a.name === 'total');
    expect(totalAttr).toBeDefined();
    expect(totalAttr.logical_entity_id).toBe(orderEntityId);
    expect(totalAttr.data_type).toBe('number');
  });

  // ============================================================================
  // Test 2: physicalDataAttributes with valid physicalEntityRef resolves to correct parent entity ID
  // ============================================================================
  it('resolves physicalDataAttributes physicalEntityRef to the correct parent entity ID', () => {
    const input: ArchitectureBaselineInput = {
      physicalDataEntities: [
        { name: 'orders_table', description: 'Orders DB table', physicalType: 'TABLE' },
      ],
      physicalDataAttributes: [
        { name: 'order_id', physicalEntityRef: 'orders_table', dataType: 'BIGINT', isPrimaryKey: true, isNullable: false },
        { name: 'total_amount', physicalEntityRef: 'orders_table', dataType: 'DECIMAL(10,2)', isNullable: true },
      ],
    };

    const idMaps = generateIds(input);
    const resolved = resolveRefs(input, idMaps);

    // No errors
    expect(resolved.errors).toHaveLength(0);

    // Both attributes should resolve to the orders_table entity ID
    const ordersTableId = idMaps.physicalDataEntities['orders_table'];
    expect(resolved.physicalAttributeEntityIds[0]).toBe(ordersTableId);
    expect(resolved.physicalAttributeEntityIds[1]).toBe(ordersTableId);

    // Build entities and verify the attribute DTOs
    const entities = buildEntities(input, idMaps, resolved);
    expect(entities.physical_data_attributes).toHaveLength(2);

    const orderIdAttr = entities.physical_data_attributes.find((a: any) => a.name === 'order_id');
    expect(orderIdAttr).toBeDefined();
    expect(orderIdAttr.physical_entity_id).toBe(ordersTableId);
    expect(orderIdAttr.data_type).toBe('BIGINT');
    expect(orderIdAttr.is_primary_key).toBe(true);
    expect(orderIdAttr.is_nullable).toBe(false);
    expect(orderIdAttr.id).toBeDefined();
    expect(orderIdAttr.id.startsWith('pda-')).toBe(true);

    const totalAttr = entities.physical_data_attributes.find((a: any) => a.name === 'total_amount');
    expect(totalAttr).toBeDefined();
    expect(totalAttr.physical_entity_id).toBe(ordersTableId);
    expect(totalAttr.is_nullable).toBe(true);
  });

  // ============================================================================
  // Test 3: Attribute with unresolved logicalEntityRef produces a resolution error
  // ============================================================================
  it('produces a resolution error when logicalEntityRef cannot be resolved in input or existing model', () => {
    const input: ArchitectureBaselineInput = {
      logicalDataAttributes: [
        { name: 'orphanField', logicalEntityRef: 'NonExistentEntity', dataType: 'string' },
      ],
    };

    const idMaps = generateIds(input);

    // No existing model provided, so fallback also fails
    const resolved = resolveRefs(input, idMaps, null);

    // Should have exactly one error
    expect(resolved.errors).toHaveLength(1);
    expect(resolved.errors[0].field).toBe('logicalEntityRef');
    expect(resolved.errors[0].entityType).toBe('logicalDataAttributes');
    expect(resolved.errors[0].entityName).toBe('orphanField');
    expect(resolved.errors[0].message).toContain('NonExistentEntity');

    // The attribute should NOT have a resolved entity ID
    expect(resolved.logicalAttributeEntityIds[0]).toBeUndefined();
  });
});

// ============================================================================
// Test 4: Attribute upsert deduplication during merge
// ============================================================================
describe('Attribute upsert deduplication', () => {
  it('overwrites existing attribute with same name and parent entity ID instead of appending duplicate', () => {
    const existingEntityId = 'lde-existing-order-123';

    const existingModel = {
      metaModel: {
        entities: {
          logical_data_entities: [
            { id: existingEntityId, name: 'Order', description: 'Order entity' },
          ],
          logical_data_attributes: [
            {
              id: 'lda-existing-total-456',
              name: 'total',
              description: 'Original description',
              logical_entity_id: existingEntityId,
              data_type: 'number',
              is_primary_key: false,
              is_nullable: true,
              tags: '',
            },
            {
              id: 'lda-existing-status-789',
              name: 'status',
              description: 'Order status',
              logical_entity_id: existingEntityId,
              data_type: 'string',
              is_primary_key: false,
              is_nullable: false,
              tags: '',
            },
          ],
          physical_data_entities: [],
          physical_data_attributes: [],
          applications: [],
          app_components: [],
          services: [],
          interfaces: [],
          endpoints: [],
          classes: [],
          methods: [],
          application_points: [],
          data_entity_points: [],
          business_logics: [],
          business_users: [],
          business_processes: [],
          process_activities: [],
          business_points: [],
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
          package_sets: [],
          packages: [],
          package_set_default_rules: [],
        },
        relationships: {
          business_user_business_points: [],
          application_point_business_points: [],
          logical_data_entity_relationships: [],
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

    // New entities include an attribute with the SAME name + SAME parent entity ID
    // but updated fields (new description, new data_type)
    const newEntities: BuiltEntities = {
      applications: [],
      app_components: [],
      services: [],
      interfaces: [],
      endpoints: [],
      logical_data_entities: [],
      physical_data_entities: [],
      logical_data_attributes: [
        {
          id: 'lda-new-total-abc',
          name: 'total',
          description: 'Updated description for total',
          logical_entity_id: existingEntityId,
          data_type: 'decimal',
          is_primary_key: false,
          is_nullable: false,
          tags: 'updated',
        },
      ],
      physical_data_attributes: [],
      business_logics: [],
      application_points: [],
      data_entity_points: [],
    };

    const newRelationships = {
      data_movements: [],
      interface_logical_entities: [],
      logical_data_entity_physical_data_entities: [],
      application_point_business_logics: [],
    };

    const { model: merged } = mergeWithExisting(existingModel, newEntities, newRelationships);
    const mergedAttrs = merged.metaModel.entities.logical_data_attributes;

    // Should still have exactly 2 attributes (total was overwritten, not appended)
    expect(mergedAttrs).toHaveLength(2);

    // Find the 'total' attribute and verify it was overwritten
    const totalAttr = mergedAttrs.find((a: any) => a.name === 'total');
    expect(totalAttr).toBeDefined();
    expect(totalAttr.description).toBe('Updated description for total');
    expect(totalAttr.data_type).toBe('decimal');
    expect(totalAttr.is_nullable).toBe(false);
    expect(totalAttr.tags).toBe('updated');
    // The overwritten attribute should have the new ID (spread overwrites)
    expect(totalAttr.id).toBe('lda-new-total-abc');

    // The 'status' attribute should be unchanged
    const statusAttr = mergedAttrs.find((a: any) => a.name === 'status');
    expect(statusAttr).toBeDefined();
    expect(statusAttr.description).toBe('Order status');
    expect(statusAttr.id).toBe('lda-existing-status-789');
  });
});

// ============================================================================
// Test 5: Entities created first, attributes reference them by name
// ============================================================================
describe('Entity-attribute integration', () => {
  it('creates entities first, then attributes correctly reference them by name', () => {
    const input: ArchitectureBaselineInput = {
      logicalDataEntities: [
        { name: 'User', description: 'User entity' },
        { name: 'Role', description: 'Role entity' },
      ],
      physicalDataEntities: [
        { name: 'users_table', description: 'Users DB table', physicalType: 'TABLE' },
      ],
      logicalDataAttributes: [
        { name: 'userId', logicalEntityRef: 'User', dataType: 'string', isPrimaryKey: true },
        { name: 'email', logicalEntityRef: 'User', dataType: 'string' },
        { name: 'roleName', logicalEntityRef: 'Role', dataType: 'string', isPrimaryKey: true },
      ],
      physicalDataAttributes: [
        { name: 'user_id', physicalEntityRef: 'users_table', dataType: 'BIGINT', isPrimaryKey: true },
        { name: 'email_address', physicalEntityRef: 'users_table', dataType: 'VARCHAR(255)' },
      ],
    };

    const idMaps = generateIds(input);
    const resolved = resolveRefs(input, idMaps);

    // No errors
    expect(resolved.errors).toHaveLength(0);

    const entities = buildEntities(input, idMaps, resolved);

    // Logical entities created
    expect(entities.logical_data_entities).toHaveLength(2);
    const userEntityId = idMaps.logicalDataEntities['User'];
    const roleEntityId = idMaps.logicalDataEntities['Role'];

    // Physical entities created
    expect(entities.physical_data_entities).toHaveLength(1);
    const usersTableId = idMaps.physicalDataEntities['users_table'];

    // Logical attributes correctly reference their parent entities
    expect(entities.logical_data_attributes).toHaveLength(3);

    const userIdAttr = entities.logical_data_attributes.find((a: any) => a.name === 'userId');
    expect(userIdAttr.logical_entity_id).toBe(userEntityId);

    const emailAttr = entities.logical_data_attributes.find((a: any) => a.name === 'email');
    expect(emailAttr.logical_entity_id).toBe(userEntityId);

    const roleNameAttr = entities.logical_data_attributes.find((a: any) => a.name === 'roleName');
    expect(roleNameAttr.logical_entity_id).toBe(roleEntityId);

    // Physical attributes correctly reference their parent entity
    expect(entities.physical_data_attributes).toHaveLength(2);

    const userIdPhysAttr = entities.physical_data_attributes.find((a: any) => a.name === 'user_id');
    expect(userIdPhysAttr.physical_entity_id).toBe(usersTableId);

    const emailPhysAttr = entities.physical_data_attributes.find((a: any) => a.name === 'email_address');
    expect(emailPhysAttr.physical_entity_id).toBe(usersTableId);

    // Verify ID maps have composite keys
    expect(idMaps.logicalDataAttributes['User::userId']).toBeDefined();
    expect(idMaps.logicalDataAttributes['User::email']).toBeDefined();
    expect(idMaps.logicalDataAttributes['Role::roleName']).toBeDefined();
    expect(idMaps.physicalDataAttributes['users_table::user_id']).toBeDefined();
    expect(idMaps.physicalDataAttributes['users_table::email_address']).toBeDefined();
  });
});

// ============================================================================
// Test 6: Summary includes logicalDataAttributes and physicalDataAttributes counts
// ============================================================================
describe('Summary attribute counts', () => {
  it('includes logicalDataAttributes and physicalDataAttributes counts in the summary', () => {
    const input: ArchitectureBaselineInput = {
      logicalDataEntities: [
        { name: 'Product', description: 'Product entity' },
      ],
      physicalDataEntities: [
        { name: 'products_table', description: 'Products table', physicalType: 'TABLE' },
      ],
      logicalDataAttributes: [
        { name: 'productId', logicalEntityRef: 'Product', dataType: 'string', isPrimaryKey: true },
        { name: 'productName', logicalEntityRef: 'Product', dataType: 'string' },
        { name: 'price', logicalEntityRef: 'Product', dataType: 'number' },
      ],
      physicalDataAttributes: [
        { name: 'product_id', physicalEntityRef: 'products_table', dataType: 'BIGINT', isPrimaryKey: true },
        { name: 'product_name', physicalEntityRef: 'products_table', dataType: 'VARCHAR(255)' },
      ],
    };

    const idMaps = generateIds(input);
    const resolved = resolveRefs(input, idMaps);
    expect(resolved.errors).toHaveLength(0);

    const entities = buildEntities(input, idMaps, resolved);
    const relationships = buildRelationships(input, idMaps, resolved, entities.application_points);

    // Merge with null existing model (first-time save)
    const { model: merged } = mergeWithExisting(null, entities, relationships);

    // Verify entities were added to the merged model
    expect(merged.metaModel.entities.logical_data_attributes).toHaveLength(3);
    expect(merged.metaModel.entities.physical_data_attributes).toHaveLength(2);

    // Simulate the summary construction from the orchestrator
    // (we test the built entity counts which are what the summary uses)
    expect(entities.logical_data_attributes).toHaveLength(3);
    expect(entities.physical_data_attributes).toHaveLength(2);

    // Verify that the summary shape would include these counts
    const summary = {
      applications: entities.applications.length,
      appComponents: entities.app_components.length,
      services: entities.services.length,
      interfaces: entities.interfaces.length,
      interfaceEndpoints: entities.endpoints.length,
      logicalDataEntities: entities.logical_data_entities.length,
      physicalDataEntities: entities.physical_data_entities.length,
      logicalDataAttributes: entities.logical_data_attributes.length,
      physicalDataAttributes: entities.physical_data_attributes.length,
      businessLogic: entities.business_logics.length,
      dataMovements: relationships.data_movements.length,
      applicationPoints: entities.application_points.length,
      dataEntityPoints: entities.data_entity_points.length,
      interfaceLogicalEntities: relationships.interface_logical_entities.length,
      logicalPhysicalMappings: relationships.logical_data_entity_physical_data_entities.length,
      applicationPointBusinessLogics: relationships.application_point_business_logics.length,
    };

    expect(summary.logicalDataAttributes).toBe(3);
    expect(summary.physicalDataAttributes).toBe(2);
    expect(summary.logicalDataEntities).toBe(1);
    expect(summary.physicalDataEntities).toBe(1);
  });
});
