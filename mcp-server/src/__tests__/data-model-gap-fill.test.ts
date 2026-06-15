/**
 * Gap-fill tests for Detailed Data Model Task -- End-to-End Fix
 *
 * Spec 2026-03-14, Task Group 5: Test Review and Gap Analysis
 *
 * These tests fill critical coverage gaps identified during TG5 review:
 *
 * Test 1: mergeWithExisting with null existing model (first-time save) appends
 *         all entities and attributes correctly
 * Test 2: Attribute upsert deduplication with physical attributes interacts
 *         correctly with the merge-with-existing flow
 */

import {
  generateIds,
  resolveRefs,
  buildEntities,
  mergeWithExisting,
  buildRelationships,
  BuiltEntities,
  BuiltRelationships,
} from '../services/architectureBaselineService';
import type { ArchitectureBaselineInput } from '../types/saveArchitectureBaseline';

// ============================================================================
// Test 1: mergeWithExisting with null existing model (first-time save)
// ============================================================================
describe('mergeWithExisting first-time save', () => {
  it('appends all entities and attributes correctly when existing model is null', () => {
    // Build a complete input with entities and attributes
    const input: ArchitectureBaselineInput = {
      logicalDataEntities: [
        { name: 'Customer', description: 'Customer domain entity' },
        { name: 'Invoice', description: 'Invoice domain entity' },
      ],
      physicalDataEntities: [
        { name: 'customers', description: 'Customers table', physicalType: 'TABLE' },
        { name: 'invoices', description: 'Invoices table', physicalType: 'TABLE' },
      ],
      logicalDataAttributes: [
        { name: 'customerId', logicalEntityRef: 'Customer', dataType: 'UUID', isPrimaryKey: true },
        { name: 'fullName', logicalEntityRef: 'Customer', dataType: 'string' },
        { name: 'invoiceNumber', logicalEntityRef: 'Invoice', dataType: 'string', isPrimaryKey: true },
      ],
      physicalDataAttributes: [
        { name: 'customer_id', physicalEntityRef: 'customers', dataType: 'BIGINT', isPrimaryKey: true, isNullable: false },
        { name: 'full_name', physicalEntityRef: 'customers', dataType: 'VARCHAR(200)', isNullable: false },
        { name: 'invoice_number', physicalEntityRef: 'invoices', dataType: 'VARCHAR(50)', isPrimaryKey: true },
      ],
      services: [
        { name: 'CustomerService', description: 'Manages customer data' },
      ],
    };

    const idMaps = generateIds(input);
    const resolved = resolveRefs(input, idMaps);
    expect(resolved.errors).toHaveLength(0);

    const entities = buildEntities(input, idMaps, resolved);
    const relationships = buildRelationships(input, idMaps, resolved, entities.application_points);

    // First-time save: pass null as existing model
    const { model: merged } = mergeWithExisting(null, entities, relationships);

    // Verify the merged model has the correct structure
    expect(merged.metaModel).toBeDefined();
    expect(merged.metaModel.entities).toBeDefined();
    expect(merged.metaModel.relationships).toBeDefined();

    // All logical data entities should be present
    expect(merged.metaModel.entities.logical_data_entities).toHaveLength(2);
    const customerEntity = merged.metaModel.entities.logical_data_entities.find(
      (e: any) => e.name === 'Customer'
    );
    expect(customerEntity).toBeDefined();
    expect(customerEntity.description).toBe('Customer domain entity');

    const invoiceEntity = merged.metaModel.entities.logical_data_entities.find(
      (e: any) => e.name === 'Invoice'
    );
    expect(invoiceEntity).toBeDefined();

    // All physical data entities should be present
    expect(merged.metaModel.entities.physical_data_entities).toHaveLength(2);

    // All logical data attributes should be present with correct parent IDs
    expect(merged.metaModel.entities.logical_data_attributes).toHaveLength(3);
    const customerIdAttr = merged.metaModel.entities.logical_data_attributes.find(
      (a: any) => a.name === 'customerId'
    );
    expect(customerIdAttr).toBeDefined();
    expect(customerIdAttr.logical_entity_id).toBe(customerEntity.id);
    expect(customerIdAttr.data_type).toBe('UUID');
    expect(customerIdAttr.is_primary_key).toBe(true);

    // All physical data attributes should be present with correct parent IDs
    expect(merged.metaModel.entities.physical_data_attributes).toHaveLength(3);
    const physCustomerId = merged.metaModel.entities.physical_data_attributes.find(
      (a: any) => a.name === 'customer_id'
    );
    expect(physCustomerId).toBeDefined();
    expect(physCustomerId.is_nullable).toBe(false);
    expect(physCustomerId.is_primary_key).toBe(true);

    // Services should be present
    expect(merged.metaModel.entities.services).toHaveLength(1);
    expect(merged.metaModel.entities.services[0].name).toBe('CustomerService');

    // Application and app_component should be auto-created (Core Application pattern)
    expect(merged.metaModel.entities.applications.length).toBeGreaterThanOrEqual(1);
    expect(merged.metaModel.entities.app_components.length).toBeGreaterThanOrEqual(1);

    // data_entity_points should be auto-created for data entities
    expect(merged.metaModel.entities.data_entity_points.length).toBeGreaterThanOrEqual(2);

    // Diagrams should be preserved (empty array for first-time save)
    expect(Array.isArray(merged.diagrams)).toBe(true);
  });
});

// ============================================================================
// Test 2: Physical attribute upsert deduplication in merge-with-existing
// ============================================================================
describe('Physical attribute upsert deduplication in merge', () => {
  it('overwrites physical attribute with same name and parent entity ID, appends new ones', () => {
    const existingPhysEntityId = 'pde-existing-orders-123';

    const existingModel = {
      metaModel: {
        entities: {
          physical_data_entities: [
            { id: existingPhysEntityId, name: 'orders', description: 'Orders table' },
          ],
          physical_data_attributes: [
            {
              id: 'pda-existing-total-456',
              name: 'total_amount',
              description: 'Original total',
              physical_entity_id: existingPhysEntityId,
              data_type: 'DECIMAL(8,2)',
              is_primary_key: false,
              is_nullable: true,
              tags: '',
            },
            {
              id: 'pda-existing-status-789',
              name: 'status',
              description: 'Order status',
              physical_entity_id: existingPhysEntityId,
              data_type: 'VARCHAR(50)',
              is_primary_key: false,
              is_nullable: false,
              tags: '',
            },
          ],
          logical_data_entities: [],
          logical_data_attributes: [],
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

    // New entities: update total_amount, add created_at (new attribute)
    const newEntities: BuiltEntities = {
      applications: [],
      app_components: [],
      services: [],
      interfaces: [],
      endpoints: [],
      logical_data_entities: [],
      physical_data_entities: [],
      logical_data_attributes: [],
      physical_data_attributes: [
        {
          id: 'pda-new-total-def',
          name: 'total_amount',
          description: 'Updated total with higher precision',
          physical_entity_id: existingPhysEntityId,
          data_type: 'DECIMAL(12,4)',
          is_primary_key: false,
          is_nullable: false,
          tags: 'updated',
        },
        {
          id: 'pda-new-created-ghi',
          name: 'created_at',
          description: 'Timestamp of creation',
          physical_entity_id: existingPhysEntityId,
          data_type: 'TIMESTAMPTZ',
          is_primary_key: false,
          is_nullable: false,
          tags: 'new',
        },
      ],
      business_logics: [],
      application_points: [],
      data_entity_points: [],
    };

    const newRelationships: BuiltRelationships = {
      data_movements: [],
      interface_logical_entities: [],
      logical_data_entity_physical_data_entities: [],
      application_point_business_logics: [],
    };

    const { model: merged } = mergeWithExisting(existingModel, newEntities, newRelationships);
    const mergedPhysAttrs = merged.metaModel.entities.physical_data_attributes;

    // Should have 3 attributes: total_amount (updated), status (unchanged), created_at (new)
    expect(mergedPhysAttrs).toHaveLength(3);

    // total_amount should be updated (overwritten by upsert)
    const totalAttr = mergedPhysAttrs.find((a: any) => a.name === 'total_amount');
    expect(totalAttr).toBeDefined();
    expect(totalAttr.description).toBe('Updated total with higher precision');
    expect(totalAttr.data_type).toBe('DECIMAL(12,4)');
    expect(totalAttr.is_nullable).toBe(false);
    expect(totalAttr.tags).toBe('updated');

    // status should be unchanged
    const statusAttr = mergedPhysAttrs.find((a: any) => a.name === 'status');
    expect(statusAttr).toBeDefined();
    expect(statusAttr.id).toBe('pda-existing-status-789');
    expect(statusAttr.description).toBe('Order status');

    // created_at should be appended (new)
    const createdAttr = mergedPhysAttrs.find((a: any) => a.name === 'created_at');
    expect(createdAttr).toBeDefined();
    expect(createdAttr.id).toBe('pda-new-created-ghi');
    expect(createdAttr.description).toBe('Timestamp of creation');
    expect(createdAttr.data_type).toBe('TIMESTAMPTZ');
    expect(createdAttr.tags).toBe('new');
  });
});
