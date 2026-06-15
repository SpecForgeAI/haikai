/**
 * Integration and gap-fill tests for the save_architecture_baseline feature.
 * Task Group 7: Test Review and Gap Fill
 *
 * These tests cover critical gaps identified during review of TG1-TG6 tests:
 * 1. End-to-end integration: full payload produces correct merged DTO
 * 2. dataMovements XOR constraint validation
 * 3. "Core Application" reuse when existing model already has one
 * 4. resolveRefs for requestDataEntityRef resolves to data_entity_point IDs
 * 5. Response shape includes correct summary counts
 * 6. Empty architectureBaselineJson ({}) succeeds with zero entities
 */

import {
  parseAndValidate,
  generateIds,
  resolveRefs,
  buildEntities,
  buildRelationships,
  mergeWithExisting,
} from '../services/architectureBaselineService';
import type { ArchitectureBaselineInput } from '../types/saveArchitectureBaseline';

// ============================================================================
// Test 1: End-to-end integration - valid full payload with all entity types
//         produces correct merged DTO structure
// ============================================================================
describe('End-to-end integration', () => {
  it('valid full payload with all entity types produces correct merged DTO structure', () => {
    const payload: ArchitectureBaselineInput = {
      services: [
        { name: 'OrderService', description: 'Manages orders', serviceType: 'REST', coreTech: 'Java' },
        { name: 'PaymentService', description: 'Handles payments', serviceType: 'REST', coreTech: 'Node.js' },
      ],
      interfaces: [
        { name: 'Order API', serviceRef: 'OrderService', interfaceType: 'REST_API' },
        { name: 'Payment API', serviceRef: 'PaymentService', interfaceType: 'REST_API' },
      ],
      interfaceEndpoints: [
        {
          name: 'GET /orders',
          interfaceRef: 'Order API',
          endpointType: 'HTTP_REST',
          pathOrAddress: '/orders',
          operationVerb: 'GET',
          requestDataEntityRef: 'OrderRequest',
          responseDataEntityRef: 'Order',
        },
        {
          name: 'POST /payments',
          interfaceRef: 'Payment API',
          endpointType: 'HTTP_REST',
          pathOrAddress: '/payments',
          operationVerb: 'POST',
          requestDataEntityRef: 'Order',
        },
      ],
      logicalDataEntities: [
        { name: 'Order', description: 'Order entity' },
        { name: 'OrderRequest', description: 'Order request DTO' },
      ],
      physicalDataEntities: [
        { name: 'orders_table', description: 'Orders DB table', physicalType: 'TABLE', logicalDataEntityRef: 'Order' },
      ],
      businessLogic: [
        { name: 'ValidateOrder', descriptionMd: 'Validates order input', ownerServiceRef: 'OrderService' },
        { name: 'ProcessPayment', descriptionMd: 'Processes payment', ownerServiceRef: 'PaymentService' },
      ],
      dataMovements: [
        {
          sourceServiceRef: 'OrderService',
          targetServiceRef: 'PaymentService',
          dataEntityRef: 'Order',
          movementType: 'SYNC',
          description: 'Order to Payment flow',
        },
      ],
    };

    const architectureBaselineJson = JSON.stringify(payload);

    // Step 1: Parse and validate
    const { input, errors: validationErrors } = parseAndValidate(architectureBaselineJson);
    expect(validationErrors).toHaveLength(0);

    // Step 2: Generate IDs
    const idMaps = generateIds(input);
    expect(Object.keys(idMaps.services)).toHaveLength(2);
    expect(Object.keys(idMaps.interfaces)).toHaveLength(2);
    expect(Object.keys(idMaps.interfaceEndpoints)).toHaveLength(2);
    expect(Object.keys(idMaps.logicalDataEntities)).toHaveLength(2);
    expect(Object.keys(idMaps.physicalDataEntities)).toHaveLength(1);
    expect(Object.keys(idMaps.businessLogic)).toHaveLength(2);
    expect(Object.keys(idMaps.dataMovements)).toHaveLength(1);

    // Step 3: Resolve refs
    const resolved = resolveRefs(input, idMaps);
    expect(resolved.errors).toHaveLength(0);

    // Step 4: Build entities
    const entities = buildEntities(input, idMaps, resolved);

    // Verify entity counts
    expect(entities.applications).toHaveLength(1);
    expect(entities.app_components).toHaveLength(1);
    expect(entities.services).toHaveLength(2);
    expect(entities.interfaces).toHaveLength(2);
    expect(entities.endpoints).toHaveLength(2);
    expect(entities.logical_data_entities).toHaveLength(2);
    expect(entities.physical_data_entities).toHaveLength(1);
    expect(entities.business_logics).toHaveLength(2);
    // app_points: 1 app + 1 comp + 2 svc + 2 ifc = 6
    expect(entities.application_points).toHaveLength(6);
    // data entity points: 2 logical + 1 physical = 3
    expect(entities.data_entity_points).toHaveLength(3);

    // Step 5: Build relationships
    const relationships = buildRelationships(input, idMaps, resolved, entities.application_points);

    expect(relationships.data_movements).toHaveLength(1);
    // ILEs: GET /orders -> (OrderRequest, Order) via Order API = 2
    //        POST /payments -> (Order) via Payment API = 1
    // Total = 3
    expect(relationships.interface_logical_entities).toHaveLength(3);
    // LDEPE: orders_table -> Order = 1
    expect(relationships.logical_data_entity_physical_data_entities).toHaveLength(1);
    // APBL: ValidateOrder -> OrderService, ProcessPayment -> PaymentService = 2
    expect(relationships.application_point_business_logics).toHaveLength(2);

    // Step 6: Merge with null (no existing model)
    const { model: merged } = mergeWithExisting(null, entities, relationships);

    // Verify the merged DTO has the correct top-level structure
    expect(merged).toHaveProperty('metaModel');
    expect(merged).toHaveProperty('metaModel.entities');
    expect(merged).toHaveProperty('metaModel.relationships');
    expect(merged).toHaveProperty('diagrams');
    expect(merged.diagrams).toEqual([]);

    // Verify entities are in the merged model
    expect(merged.metaModel.entities.applications).toHaveLength(1);
    expect(merged.metaModel.entities.app_components).toHaveLength(1);
    expect(merged.metaModel.entities.services).toHaveLength(2);
    expect(merged.metaModel.entities.interfaces).toHaveLength(2);
    expect(merged.metaModel.entities.endpoints).toHaveLength(2);
    expect(merged.metaModel.entities.logical_data_entities).toHaveLength(2);
    expect(merged.metaModel.entities.physical_data_entities).toHaveLength(1);
    expect(merged.metaModel.entities.business_logics).toHaveLength(2);
    expect(merged.metaModel.entities.application_points).toHaveLength(6);
    expect(merged.metaModel.entities.data_entity_points).toHaveLength(3);

    // Verify relationships are in the merged model
    expect(merged.metaModel.relationships.data_movements).toHaveLength(1);
    expect(merged.metaModel.relationships.interface_logical_entities).toHaveLength(3);
    expect(merged.metaModel.relationships.logical_data_entity_physical_data_entities).toHaveLength(1);
    expect(merged.metaModel.relationships.application_point_business_logics).toHaveLength(2);

    // Verify empty entity arrays exist in merged model (structural completeness)
    expect(merged.metaModel.entities.business_users).toEqual([]);
    expect(merged.metaModel.entities.business_processes).toEqual([]);
    expect(merged.metaModel.entities.classes).toEqual([]);
    expect(merged.metaModel.entities.methods).toEqual([]);

    // Verify empty relationship arrays exist in merged model
    expect(merged.metaModel.relationships.business_user_business_points).toEqual([]);
    expect(merged.metaModel.relationships.application_point_business_points).toEqual([]);
    expect(merged.metaModel.relationships.ui_workflow_transitions).toEqual([]);
  });
});

// ============================================================================
// Test 2: dataMovements XOR constraint validation
// ============================================================================
describe('dataMovements XOR constraint', () => {
  it('rejects dataMovement with both dataEntityRef and interfaceWithSchemaRef (XOR violation)', () => {
    const payload = JSON.stringify({
      services: [
        { name: 'ServiceA' },
        { name: 'ServiceB' },
      ],
      interfaces: [
        { name: 'API A', serviceRef: 'ServiceA' },
      ],
      logicalDataEntities: [
        { name: 'Entity1' },
      ],
      dataMovements: [
        {
          sourceServiceRef: 'ServiceA',
          targetServiceRef: 'ServiceB',
          dataEntityRef: 'Entity1',
          interfaceWithSchemaRef: 'API A',
          movementType: 'SYNC',
        },
      ],
    });

    const result = parseAndValidate(payload);

    const xorErrors = result.errors.filter(
      (e) => e.field === 'dataEntityRef/interfaceWithSchemaRef'
    );
    expect(xorErrors).toHaveLength(1);
    expect(xorErrors[0].message).toContain('XOR');
    expect(xorErrors[0].entityType).toBe('dataMovements');
  });

  it('rejects dataMovement with neither dataEntityRef nor interfaceWithSchemaRef (XOR violation)', () => {
    const payload = JSON.stringify({
      services: [
        { name: 'ServiceA' },
        { name: 'ServiceB' },
      ],
      dataMovements: [
        {
          sourceServiceRef: 'ServiceA',
          targetServiceRef: 'ServiceB',
          movementType: 'ASYNC',
        },
      ],
    });

    const result = parseAndValidate(payload);

    const xorErrors = result.errors.filter(
      (e) => e.field === 'dataEntityRef/interfaceWithSchemaRef'
    );
    expect(xorErrors).toHaveLength(1);
    expect(xorErrors[0].message).toContain('XOR');
  });
});

// ============================================================================
// Test 3: "Core Application" reuse when existing model already has one
// ============================================================================
describe('Core Application reuse', () => {
  it('does not duplicate Core Application or Core Component when existing model already has them', () => {
    const existingModel = {
      metaModel: {
        entities: {
          business_users: [],
          business_processes: [],
          process_activities: [],
          business_points: [],
          applications: [
            { id: 'app-existing-core', name: 'Core Application', description: '', app_type: '', status: '', tags: '' },
          ],
          app_components: [
            { id: 'comp-existing-core', name: 'Core Component', description: '', application_id: 'app-existing-core', tags: '' },
          ],
          services: [],
          interfaces: [],
          endpoints: [],
          classes: [],
          methods: [],
          application_points: [
            { id: 'ap_app-existing-core', name: 'Core Application', kind: 'APPLICATION', application_id: 'app-existing-core' },
            { id: 'ap_comp-existing-core', name: 'Core Component', kind: 'APP_COMPONENT', application_id: 'app-existing-core', application_component_id: 'comp-existing-core' },
          ],
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

    const input: ArchitectureBaselineInput = {
      services: [{ name: 'NewService' }],
      interfaces: [],
      interfaceEndpoints: [],
      logicalDataEntities: [],
      physicalDataEntities: [],
      businessLogic: [],
      dataMovements: [],
    };

    const idMaps = generateIds(input);
    const resolved = resolveRefs(input, idMaps);
    const entities = buildEntities(input, idMaps, resolved);

    // The new entities will have their own Core Application, but mergeWithExisting
    // should filter out the duplicate
    const relationships = buildRelationships(input, idMaps, resolved, entities.application_points);
    const { model: merged } = mergeWithExisting(existingModel, entities, relationships);

    // Should still have exactly 1 application named "Core Application" (the existing one)
    const coreApps = merged.metaModel.entities.applications.filter(
      (app: any) => app.name === 'Core Application'
    );
    expect(coreApps).toHaveLength(1);
    expect(coreApps[0].id).toBe('app-existing-core');

    // Should still have exactly 1 app component named "Core Component"
    const coreComps = merged.metaModel.entities.app_components.filter(
      (comp: any) => comp.name === 'Core Component'
    );
    expect(coreComps).toHaveLength(1);
    expect(coreComps[0].id).toBe('comp-existing-core');

    // The new service should still be added
    expect(merged.metaModel.entities.services).toHaveLength(1);
    expect(merged.metaModel.entities.services[0].name).toBe('NewService');

    // APPLICATION and APP_COMPONENT kind application_points should not be duplicated
    const appKindPoints = merged.metaModel.entities.application_points.filter(
      (ap: any) => ap.kind === 'APPLICATION'
    );
    expect(appKindPoints).toHaveLength(1);
    expect(appKindPoints[0].id).toBe('ap_app-existing-core');

    const compKindPoints = merged.metaModel.entities.application_points.filter(
      (ap: any) => ap.kind === 'APP_COMPONENT'
    );
    expect(compKindPoints).toHaveLength(1);
    expect(compKindPoints[0].id).toBe('ap_comp-existing-core');

    // The SERVICE kind point for NewService should be added
    const serviceKindPoints = merged.metaModel.entities.application_points.filter(
      (ap: any) => ap.kind === 'SERVICE'
    );
    expect(serviceKindPoints).toHaveLength(1);
    expect(serviceKindPoints[0].name).toBe('NewService');
  });
});

// ============================================================================
// Test 4: Response shape includes correct summary counts
// ============================================================================
describe('Response shape and summary counts', () => {
  it('produces summary counts that match the actual number of created entities', () => {
    const input: ArchitectureBaselineInput = {
      services: [
        { name: 'OrderService' },
        { name: 'PaymentService' },
        { name: 'ShippingService' },
      ],
      interfaces: [
        { name: 'Order API', serviceRef: 'OrderService' },
        { name: 'Payment API', serviceRef: 'PaymentService' },
      ],
      interfaceEndpoints: [
        { name: 'GET /orders', interfaceRef: 'Order API', requestDataEntityRef: 'Order' },
      ],
      logicalDataEntities: [
        { name: 'Order' },
        { name: 'Payment' },
      ],
      physicalDataEntities: [
        { name: 'orders_table', logicalDataEntityRef: 'Order' },
      ],
      businessLogic: [
        { name: 'ValidateOrder', ownerServiceRef: 'OrderService' },
      ],
      dataMovements: [
        {
          sourceServiceRef: 'OrderService',
          targetServiceRef: 'PaymentService',
          dataEntityRef: 'Order',
        },
      ],
    };

    const idMaps = generateIds(input);
    const resolved = resolveRefs(input, idMaps);
    const entities = buildEntities(input, idMaps, resolved);
    const relationships = buildRelationships(input, idMaps, resolved, entities.application_points);

    // Verify counts match expected values
    expect(entities.applications).toHaveLength(1);     // Core Application
    expect(entities.app_components).toHaveLength(1);   // Core Component
    expect(entities.services).toHaveLength(3);         // 3 services
    expect(entities.interfaces).toHaveLength(2);       // 2 interfaces
    expect(entities.endpoints).toHaveLength(1);        // 1 endpoint
    expect(entities.logical_data_entities).toHaveLength(2);  // 2 logical
    expect(entities.physical_data_entities).toHaveLength(1); // 1 physical
    expect(entities.business_logics).toHaveLength(1);  // 1 business logic

    // App points: 1 app + 1 comp + 3 svcs + 2 ifcs = 7
    expect(entities.application_points).toHaveLength(7);

    // Data entity points: 2 logical + 1 physical = 3
    expect(entities.data_entity_points).toHaveLength(3);

    // Relationships
    expect(relationships.data_movements).toHaveLength(1);
    expect(relationships.interface_logical_entities).toHaveLength(1); // 1 endpoint with requestDataEntityRef
    expect(relationships.logical_data_entity_physical_data_entities).toHaveLength(1);
    expect(relationships.application_point_business_logics).toHaveLength(1);
  });
});

// ============================================================================
// Test 5: Empty architectureBaselineJson ({}) succeeds with zero entities
// ============================================================================
describe('Empty payload handling', () => {
  it('empty architectureBaselineJson ({}) succeeds with zero entities and relationships', () => {
    const result = parseAndValidate('{}');

    // No validation errors
    expect(result.errors).toHaveLength(0);

    // All arrays should default to empty
    expect(result.input.services).toEqual([]);
    expect(result.input.interfaces).toEqual([]);
    expect(result.input.interfaceEndpoints).toEqual([]);
    expect(result.input.logicalDataEntities).toEqual([]);
    expect(result.input.physicalDataEntities).toEqual([]);
    expect(result.input.businessLogic).toEqual([]);
    expect(result.input.dataMovements).toEqual([]);

    // Generate IDs -- should still create Core Application and Core Component
    const idMaps = generateIds(result.input);
    expect(idMaps.application.id).toBeDefined();
    expect(idMaps.appComponent.id).toBeDefined();
    expect(Object.keys(idMaps.services)).toHaveLength(0);
    expect(Object.keys(idMaps.interfaces)).toHaveLength(0);

    // Resolve refs -- nothing to resolve, no errors
    const resolved = resolveRefs(result.input, idMaps);
    expect(resolved.errors).toHaveLength(0);

    // Build entities -- only Core Application, Core Component, and their app points
    const entities = buildEntities(result.input, idMaps, resolved);
    expect(entities.applications).toHaveLength(1);
    expect(entities.app_components).toHaveLength(1);
    expect(entities.services).toHaveLength(0);
    expect(entities.interfaces).toHaveLength(0);
    expect(entities.endpoints).toHaveLength(0);
    expect(entities.logical_data_entities).toHaveLength(0);
    expect(entities.physical_data_entities).toHaveLength(0);
    expect(entities.business_logics).toHaveLength(0);
    // Only 2 application_points: 1 for app + 1 for comp
    expect(entities.application_points).toHaveLength(2);
    expect(entities.data_entity_points).toHaveLength(0);

    // Build relationships -- none
    const relationships = buildRelationships(result.input, idMaps, resolved, entities.application_points);
    expect(relationships.data_movements).toHaveLength(0);
    expect(relationships.interface_logical_entities).toHaveLength(0);
    expect(relationships.logical_data_entity_physical_data_entities).toHaveLength(0);
    expect(relationships.application_point_business_logics).toHaveLength(0);

    // Merge with null -- should produce valid DTO structure
    const { model: merged } = mergeWithExisting(null, entities, relationships);
    expect(merged.metaModel.entities.applications).toHaveLength(1);
    expect(merged.metaModel.entities.services).toHaveLength(0);
    expect(merged.diagrams).toEqual([]);
  });
});

// ============================================================================
// Test 6: resolveRefs for requestDataEntityRef resolves to data_entity_point IDs
//         (specifically testing physical entity resolution for responseDataEntityRef)
// ============================================================================
describe('resolveRefs data_entity_point resolution', () => {
  it('requestDataEntityRef resolves to dep_log_ for logical entities and responseDataEntityRef resolves to dep_phy_ for physical entities', () => {
    const input: ArchitectureBaselineInput = {
      services: [{ name: 'DataService' }],
      interfaces: [{ name: 'Data API', serviceRef: 'DataService' }],
      interfaceEndpoints: [
        {
          name: 'GET /data',
          interfaceRef: 'Data API',
          requestDataEntityRef: 'LogicalEntity',
          responseDataEntityRef: 'PhysicalEntity',
        },
      ],
      logicalDataEntities: [{ name: 'LogicalEntity' }],
      physicalDataEntities: [{ name: 'PhysicalEntity' }],
    };

    const idMaps = generateIds(input);
    const resolved = resolveRefs(input, idMaps);

    expect(resolved.errors).toHaveLength(0);

    // requestDataEntityRef 'LogicalEntity' -> dep_log_{ldeId}
    const ldeId = idMaps.logicalDataEntities['LogicalEntity'];
    expect(resolved.endpointRequestDepIds[0]).toBe(`dep_log_${ldeId}`);

    // responseDataEntityRef 'PhysicalEntity' -> dep_phy_{pdeId}
    const pdeId = idMaps.physicalDataEntities['PhysicalEntity'];
    expect(resolved.endpointResponseDepIds[0]).toBe(`dep_phy_${pdeId}`);

    // Verify these are NOT the entity IDs directly, but the data_entity_point IDs
    expect(resolved.endpointRequestDepIds[0]).not.toBe(ldeId);
    expect(resolved.endpointResponseDepIds[0]).not.toBe(pdeId);
    expect(resolved.endpointRequestDepIds[0]).toContain('dep_log_');
    expect(resolved.endpointResponseDepIds[0]).toContain('dep_phy_');
  });
});
