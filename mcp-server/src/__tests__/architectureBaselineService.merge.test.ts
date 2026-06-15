/**
 * Tests for relationship generation and merge logic in architectureBaselineService.
 * Task Group 4: buildRelationships, mergeWithExisting, and main orchestration
 */

import {
  buildRelationships,
  mergeWithExisting,
  generateIds,
  resolveRefs,
  buildEntities,
  BuiltEntities,
  IdMaps,
  ResolvedRefs,
} from '../services/architectureBaselineService';
import type { ArchitectureBaselineInput } from '../types/saveArchitectureBaseline';

// ============================================================================
// Helper: build a full test input with all entity types
// ============================================================================
function buildFullTestInput(): ArchitectureBaselineInput {
  return {
    services: [
      { name: 'OrderService', description: 'Manages orders', serviceType: 'REST', coreTech: 'Java' },
      { name: 'PaymentService', description: 'Handles payments' },
    ],
    interfaces: [
      { name: 'Order API', serviceRef: 'OrderService', interfaceType: 'REST_API' },
      { name: 'Payment API', serviceRef: 'PaymentService', interfaceType: 'REST_API' },
    ],
    interfaceEndpoints: [
      {
        name: 'GET /orders',
        interfaceRef: 'Order API',
        requestDataEntityRef: 'OrderRequest',
        responseDataEntityRef: 'Order',
        endpointType: 'HTTP_REST',
        pathOrAddress: '/orders',
        operationVerb: 'GET',
      },
      {
        name: 'POST /payments',
        interfaceRef: 'Payment API',
        requestDataEntityRef: 'Order',
        endpointType: 'HTTP_REST',
        pathOrAddress: '/payments',
        operationVerb: 'POST',
      },
    ],
    logicalDataEntities: [
      { name: 'Order', description: 'Order entity' },
      { name: 'OrderRequest', description: 'Order request entity' },
    ],
    physicalDataEntities: [
      { name: 'orders_table', description: 'Orders DB table', physicalType: 'TABLE', logicalDataEntityRef: 'Order' },
      { name: 'payments_table', description: 'Payments DB table', physicalType: 'TABLE' },
    ],
    businessLogic: [
      { name: 'ValidateOrder', descriptionMd: 'Validates order input', ownerServiceRef: 'OrderService' },
      { name: 'ProcessPayment', descriptionMd: 'Processes payment', ownerServiceRef: 'PaymentService' },
      { name: 'OrphanLogic', descriptionMd: 'No owner' },
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
}

// ============================================================================
// Test 1: buildRelationships generates data_movements with resolved application_point IDs
// ============================================================================
describe('buildRelationships', () => {
  it('generates data_movements entries with resolved source and target application_point IDs', () => {
    const input = buildFullTestInput();
    const idMaps = generateIds(input);
    const resolved = resolveRefs(input, idMaps);
    const entities = buildEntities(input, idMaps, resolved);
    const relationships = buildRelationships(input, idMaps, resolved, entities.application_points);

    // Should produce exactly 1 data_movement
    expect(relationships.data_movements).toHaveLength(1);

    const dm = relationships.data_movements[0];

    // ID should have dm- prefix
    expect(dm.id).toBeDefined();
    expect(dm.id.startsWith('dm-')).toBe(true);

    // source_application_point_id should be ap_{sourceServiceId}
    const orderSvcId = idMaps.services['OrderService'];
    expect(dm.source_application_point_id).toBe(`ap_${orderSvcId}`);

    // target_application_point_id should be ap_{targetServiceId}
    const paymentSvcId = idMaps.services['PaymentService'];
    expect(dm.target_application_point_id).toBe(`ap_${paymentSvcId}`);

    // dataEntityPointId should be resolved to dep_log_{ldeId} for "Order"
    const orderLdeId = idMaps.logicalDataEntities['Order'];
    expect(dm.dataEntityPointId).toBe(`dep_log_${orderLdeId}`);

    // interfaceWithSchemaId should be null since dataEntityRef was used
    expect(dm.interfaceWithSchemaId).toBeNull();

    // Check other fields
    expect(dm.movement_type).toBe('SYNC');
    expect(dm.description).toBe('Order to Payment flow');
    expect(dm.biDirectional).toBeNull();
  });

  // ============================================================================
  // Test 2: buildRelationships generates interface_logical_entities from endpoint data entity refs
  // ============================================================================
  it('generates interface_logical_entities from endpoint requestDataEntityRef and responseDataEntityRef', () => {
    const input = buildFullTestInput();
    const idMaps = generateIds(input);
    const resolved = resolveRefs(input, idMaps);
    const entities = buildEntities(input, idMaps, resolved);
    const relationships = buildRelationships(input, idMaps, resolved, entities.application_points);

    // Endpoint "GET /orders" has requestDataEntityRef=OrderRequest (logical) and responseDataEntityRef=Order (logical)
    // Endpoint "POST /payments" has requestDataEntityRef=Order (logical)
    //
    // ILEs link the endpoint's interface to the data entity point.
    // Deduplication by (interface_id, dataEntityPointId):
    //   - Order API + dep_log_{OrderRequest} (from GET /orders request)
    //   - Order API + dep_log_{Order} (from GET /orders response)
    //   - Payment API + dep_log_{Order} (from POST /payments request)
    // Total: 3 unique ILEs
    expect(relationships.interface_logical_entities.length).toBe(3);

    const orderApiId = idMaps.interfaces['Order API'];
    const paymentApiId = idMaps.interfaces['Payment API'];
    const orderRequestDepId = `dep_log_${idMaps.logicalDataEntities['OrderRequest']}`;
    const orderDepId = `dep_log_${idMaps.logicalDataEntities['Order']}`;

    // Find each expected ILE
    const ile1 = relationships.interface_logical_entities.find(
      (ile: any) => ile.interface_id === orderApiId && ile.dataEntityPointId === orderRequestDepId
    );
    expect(ile1).toBeDefined();
    expect(ile1.id.startsWith('ile-')).toBe(true);

    const ile2 = relationships.interface_logical_entities.find(
      (ile: any) => ile.interface_id === orderApiId && ile.dataEntityPointId === orderDepId
    );
    expect(ile2).toBeDefined();

    const ile3 = relationships.interface_logical_entities.find(
      (ile: any) => ile.interface_id === paymentApiId && ile.dataEntityPointId === orderDepId
    );
    expect(ile3).toBeDefined();

    // Verify ILE shape
    for (const ile of relationships.interface_logical_entities) {
      expect(ile).toHaveProperty('id');
      expect(ile).toHaveProperty('interface_id');
      expect(ile).toHaveProperty('dataEntityPointId');
      expect(ile).toHaveProperty('description');
      expect(ile).toHaveProperty('tags');
      expect(ile).toHaveProperty('valid_from');
      expect(ile).toHaveProperty('valid_to');
    }
  });

  // ============================================================================
  // Test 3: buildRelationships generates logical_data_entity_physical_data_entities
  // ============================================================================
  it('generates logical_data_entity_physical_data_entities from logicalDataEntityRef on physical entities', () => {
    const input = buildFullTestInput();
    const idMaps = generateIds(input);
    const resolved = resolveRefs(input, idMaps);
    const entities = buildEntities(input, idMaps, resolved);
    const relationships = buildRelationships(input, idMaps, resolved, entities.application_points);

    // Only orders_table has logicalDataEntityRef='Order'
    // payments_table has no logicalDataEntityRef
    expect(relationships.logical_data_entity_physical_data_entities).toHaveLength(1);

    const ldepe = relationships.logical_data_entity_physical_data_entities[0];

    // ID should have ldepe- prefix
    expect(ldepe.id.startsWith('ldepe-')).toBe(true);

    // logical_entity_id should be the resolved logical entity ID for 'Order'
    expect(ldepe.logical_entity_id).toBe(idMaps.logicalDataEntities['Order']);

    // physical_entity_id should be the physical entity ID for 'orders_table'
    expect(ldepe.physical_entity_id).toBe(idMaps.physicalDataEntities['orders_table']);

    // Verify shape
    expect(ldepe).toHaveProperty('description');
    expect(ldepe).toHaveProperty('tags');
    expect(ldepe).toHaveProperty('valid_from');
    expect(ldepe).toHaveProperty('valid_to');
  });

  // ============================================================================
  // Test 4: buildRelationships generates application_point_business_logics from ownerServiceRef
  // ============================================================================
  it('generates application_point_business_logics from ownerServiceRef on business logic items', () => {
    const input = buildFullTestInput();
    const idMaps = generateIds(input);
    const resolved = resolveRefs(input, idMaps);
    const entities = buildEntities(input, idMaps, resolved);
    const relationships = buildRelationships(input, idMaps, resolved, entities.application_points);

    // ValidateOrder -> ownerServiceRef='OrderService'
    // ProcessPayment -> ownerServiceRef='PaymentService'
    // OrphanLogic -> no ownerServiceRef (should not generate an APBL)
    expect(relationships.application_point_business_logics).toHaveLength(2);

    const orderSvcId = idMaps.services['OrderService'];
    const paymentSvcId = idMaps.services['PaymentService'];
    const validateOrderId = idMaps.businessLogic['ValidateOrder'];
    const processPaymentId = idMaps.businessLogic['ProcessPayment'];

    // Find the APBL for ValidateOrder -> OrderService
    const apbl1 = relationships.application_point_business_logics.find(
      (apbl: any) =>
        apbl.application_point_id === `ap_${orderSvcId}` &&
        apbl.business_logic_id === validateOrderId
    );
    expect(apbl1).toBeDefined();
    expect(apbl1.id.startsWith('apbl-')).toBe(true);

    // Find the APBL for ProcessPayment -> PaymentService
    const apbl2 = relationships.application_point_business_logics.find(
      (apbl: any) =>
        apbl.application_point_id === `ap_${paymentSvcId}` &&
        apbl.business_logic_id === processPaymentId
    );
    expect(apbl2).toBeDefined();

    // Verify shape
    for (const apbl of relationships.application_point_business_logics) {
      expect(apbl).toHaveProperty('id');
      expect(apbl).toHaveProperty('application_point_id');
      expect(apbl).toHaveProperty('business_logic_id');
      expect(apbl).toHaveProperty('description');
      expect(apbl).toHaveProperty('tags');
      expect(apbl).toHaveProperty('valid_from');
      expect(apbl).toHaveProperty('valid_to');
    }
  });
});

// ============================================================================
// Test 5: mergeWithExisting appends new entities and preserves diagrams
// ============================================================================
describe('mergeWithExisting', () => {
  it('appends new entities to existing arrays without removing existing entities, and preserves diagrams', () => {
    const existingModel = {
      metaModel: {
        entities: {
          business_users: [],
          business_processes: [],
          process_activities: [],
          business_points: [],
          applications: [
            { id: 'app-existing-123', name: 'Existing App', description: '', app_type: '', status: '', tags: '' },
          ],
          app_components: [
            { id: 'comp-existing-456', name: 'Existing Component', description: '', application_id: 'app-existing-123', tags: '' },
          ],
          services: [
            { id: 'svc-existing-789', name: 'ExistingService', description: '', application_id: 'app-existing-123', app_component_id: 'comp-existing-456' },
          ],
          interfaces: [],
          endpoints: [],
          classes: [],
          methods: [],
          application_points: [
            { id: 'ap_app-existing-123', name: 'Existing App', kind: 'APPLICATION' },
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
      diagrams: [
        { id: 'diag-existing-001', name: 'Existing Diagram', description: 'Should be preserved' },
      ],
    };

    const newEntities: BuiltEntities = {
      applications: [
        { id: 'app-new-111', name: 'New Application', description: '', app_type: '', status: '', tags: '' },
      ],
      app_components: [
        { id: 'comp-new-222', name: 'New Component', description: '', application_id: 'app-new-111', tags: '' },
      ],
      services: [
        { id: 'svc-new-333', name: 'NewService', description: '', application_id: 'app-new-111', app_component_id: 'comp-new-222' },
      ],
      interfaces: [],
      endpoints: [],
      logical_data_entities: [],
      physical_data_entities: [],
      logical_data_attributes: [],
      physical_data_attributes: [],
      business_logics: [],
      application_points: [
        { id: 'ap_app-new-111', name: 'New Application', kind: 'APPLICATION' },
      ],
      data_entity_points: [],
    };

    const newRelationships = {
      data_movements: [
        { id: 'dm-new-444', source_application_point_id: 'ap_svc-new-333', target_application_point_id: 'ap_svc-existing-789' },
      ],
      interface_logical_entities: [],
      logical_data_entity_physical_data_entities: [],
      application_point_business_logics: [],
    };

    const { model: merged } = mergeWithExisting(existingModel, newEntities, newRelationships);

    // Applications: 1 existing + 1 new = 2
    expect(merged.metaModel.entities.applications).toHaveLength(2);
    expect(merged.metaModel.entities.applications[0].name).toBe('Existing App');
    expect(merged.metaModel.entities.applications[1].name).toBe('New Application');

    // App components: 1 existing + 1 new = 2
    expect(merged.metaModel.entities.app_components).toHaveLength(2);

    // Services: 1 existing + 1 new = 2
    expect(merged.metaModel.entities.services).toHaveLength(2);
    expect(merged.metaModel.entities.services[0].name).toBe('ExistingService');
    expect(merged.metaModel.entities.services[1].name).toBe('NewService');

    // Application points: 1 existing + 1 new = 2
    expect(merged.metaModel.entities.application_points).toHaveLength(2);

    // Relationships: data_movements 0 existing + 1 new = 1
    expect(merged.metaModel.relationships.data_movements).toHaveLength(1);

    // Diagrams: preserved unchanged
    expect(merged.diagrams).toHaveLength(1);
    expect(merged.diagrams[0].name).toBe('Existing Diagram');
    expect(merged.diagrams[0].description).toBe('Should be preserved');
  });

  // ============================================================================
  // Test 6: mergeWithExisting starts with empty shell when existing model is null
  // ============================================================================
  it('starts with an empty shell when existing model is null (GET returned 404)', () => {
    const newEntities: BuiltEntities = {
      applications: [
        { id: 'app-fresh-001', name: 'Fresh Application', description: '' },
      ],
      app_components: [
        { id: 'comp-fresh-002', name: 'Fresh Component', description: '', application_id: 'app-fresh-001' },
      ],
      services: [
        { id: 'svc-fresh-003', name: 'FreshService', description: '' },
      ],
      interfaces: [],
      endpoints: [],
      logical_data_entities: [
        { id: 'lde-fresh-004', name: 'FreshEntity' },
      ],
      physical_data_entities: [],
      logical_data_attributes: [],
      physical_data_attributes: [],
      business_logics: [],
      application_points: [
        { id: 'ap_app-fresh-001', name: 'Fresh Application', kind: 'APPLICATION' },
      ],
      data_entity_points: [
        { id: 'dep_log_lde-fresh-004', point_kind: 'LOGICAL_ENTITY', logical_entity_id: 'lde-fresh-004' },
      ],
    };

    const newRelationships = {
      data_movements: [],
      interface_logical_entities: [],
      logical_data_entity_physical_data_entities: [],
      application_point_business_logics: [],
    };

    const { model: merged } = mergeWithExisting(null, newEntities, newRelationships);

    // Should have the structure of a valid ArchitectureModelDto
    expect(merged).toHaveProperty('metaModel');
    expect(merged).toHaveProperty('metaModel.entities');
    expect(merged).toHaveProperty('metaModel.relationships');
    expect(merged).toHaveProperty('diagrams');

    // Diagrams should be empty (no existing diagrams)
    expect(merged.diagrams).toEqual([]);

    // New entities should be present
    expect(merged.metaModel.entities.applications).toHaveLength(1);
    expect(merged.metaModel.entities.applications[0].name).toBe('Fresh Application');

    expect(merged.metaModel.entities.services).toHaveLength(1);
    expect(merged.metaModel.entities.services[0].name).toBe('FreshService');

    expect(merged.metaModel.entities.logical_data_entities).toHaveLength(1);
    expect(merged.metaModel.entities.logical_data_entities[0].name).toBe('FreshEntity');

    expect(merged.metaModel.entities.data_entity_points).toHaveLength(1);
    expect(merged.metaModel.entities.data_entity_points[0].id).toBe('dep_log_lde-fresh-004');

    // All entity arrays that had no new entries should exist but be empty
    expect(merged.metaModel.entities.business_users).toEqual([]);
    expect(merged.metaModel.entities.business_processes).toEqual([]);
    expect(merged.metaModel.entities.interfaces).toEqual([]);
    expect(merged.metaModel.entities.endpoints).toEqual([]);

    // All relationship arrays should exist
    expect(merged.metaModel.relationships.data_movements).toEqual([]);
    expect(merged.metaModel.relationships.interface_logical_entities).toEqual([]);
    expect(merged.metaModel.relationships.logical_data_entity_physical_data_entities).toEqual([]);
    expect(merged.metaModel.relationships.application_point_business_logics).toEqual([]);
  });
});
