/**
 * Tests for validation and entity building logic in architectureBaselineService.
 * Task Group 3: parseAndValidate, generateIds, resolveRefs, buildEntities
 */

import {
  parseAndValidate,
  generateIds,
  resolveRefs,
  buildEntities,
} from '../services/architectureBaselineService';
import type { ArchitectureBaselineInput } from '../types/saveArchitectureBaseline';

// ============================================================================
// Test 1: parseAndValidate rejects invalid JSON
// ============================================================================
describe('parseAndValidate', () => {
  it('rejects invalid JSON string with descriptive error', () => {
    const result = parseAndValidate('this is not valid json {{{');

    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors[0].field).toBe('architectureBaselineJson');
    expect(result.errors[0].entityType).toBe('root');
    expect(result.errors[0].message).toContain('Invalid JSON');
  });

  // ============================================================================
  // Test 2: parseAndValidate rejects duplicate service names
  // ============================================================================
  it('rejects payload with duplicate service names and returns error listing the duplicates', () => {
    const payload = JSON.stringify({
      services: [
        { name: 'OrderService', description: 'First' },
        { name: 'PaymentService', description: 'OK' },
        { name: 'OrderService', description: 'Duplicate' },
      ],
    });

    const result = parseAndValidate(payload);

    const duplicateErrors = result.errors.filter(
      (e) => e.entityType === 'services' && e.message.includes('Duplicate')
    );
    expect(duplicateErrors.length).toBeGreaterThanOrEqual(1);
    expect(duplicateErrors[0].entityName).toBe('OrderService');
    expect(duplicateErrors[0].message).toContain('OrderService');
  });

  // ============================================================================
  // Test 3: parseAndValidate rejects empty entity names
  // ============================================================================
  it('rejects payload with empty entity names', () => {
    const payload = JSON.stringify({
      services: [
        { name: '', description: 'Empty name' },
        { name: 'ValidService', description: 'OK' },
      ],
      interfaces: [
        { name: '   ', serviceRef: 'ValidService' },
      ],
    });

    const result = parseAndValidate(payload);

    const emptyNameErrors = result.errors.filter(
      (e) => e.field === 'name' && e.message.includes('Empty')
    );
    expect(emptyNameErrors.length).toBeGreaterThanOrEqual(2);

    // Check services error
    const serviceError = emptyNameErrors.find((e) => e.entityType === 'services');
    expect(serviceError).toBeDefined();
    expect(serviceError!.message).toContain('services[0]');

    // Check interfaces error
    const ifaceError = emptyNameErrors.find((e) => e.entityType === 'interfaces');
    expect(ifaceError).toBeDefined();
    expect(ifaceError!.message).toContain('interfaces[0]');
  });

  // ============================================================================
  // Test 4: parseAndValidate rejects unresolvable refs
  // ============================================================================
  it('rejects payload with unresolvable refs', () => {
    const payload = JSON.stringify({
      services: [{ name: 'OrderService' }],
      interfaces: [
        { name: 'Order API', serviceRef: 'NonExistentService' },
      ],
      interfaceEndpoints: [
        {
          name: 'GET /orders',
          interfaceRef: 'NonExistentInterface',
          requestDataEntityRef: 'NonExistentEntity',
        },
      ],
      logicalDataEntities: [{ name: 'Order' }],
      physicalDataEntities: [
        { name: 'orders_table', logicalDataEntityRef: 'NonExistentLogical' },
      ],
      businessLogic: [
        { name: 'ValidateOrder', ownerServiceRef: 'NonExistentOwnerService' },
      ],
      dataMovements: [
        {
          sourceServiceRef: 'NonExistentSourceService',
          targetServiceRef: 'OrderService',
          dataEntityRef: 'Order',
        },
      ],
    });

    const result = parseAndValidate(payload);

    // Should have unresolvable ref errors
    const refErrors = result.errors.filter((e) => e.message.includes('Unresolvable'));
    expect(refErrors.length).toBeGreaterThanOrEqual(5);

    // Check specific ref error types
    const serviceRefError = refErrors.find(
      (e) => e.field === 'serviceRef' && e.entityType === 'interfaces'
    );
    expect(serviceRefError).toBeDefined();
    expect(serviceRefError!.message).toContain('NonExistentService');

    const interfaceRefError = refErrors.find(
      (e) => e.field === 'interfaceRef' && e.entityType === 'interfaceEndpoints'
    );
    expect(interfaceRefError).toBeDefined();
    expect(interfaceRefError!.message).toContain('NonExistentInterface');

    const requestDataEntityRefError = refErrors.find(
      (e) => e.field === 'requestDataEntityRef' && e.entityType === 'interfaceEndpoints'
    );
    expect(requestDataEntityRefError).toBeDefined();
    expect(requestDataEntityRefError!.message).toContain('NonExistentEntity');

    const logicalDataEntityRefError = refErrors.find(
      (e) => e.field === 'logicalDataEntityRef' && e.entityType === 'physicalDataEntities'
    );
    expect(logicalDataEntityRefError).toBeDefined();
    expect(logicalDataEntityRefError!.message).toContain('NonExistentLogical');

    const ownerServiceRefError = refErrors.find(
      (e) => e.field === 'ownerServiceRef' && e.entityType === 'businessLogic'
    );
    expect(ownerServiceRefError).toBeDefined();
    expect(ownerServiceRefError!.message).toContain('NonExistentOwnerService');
  });
});

// ============================================================================
// Test 5: generateIds assigns correct prefixes to all entity types
// ============================================================================
describe('generateIds', () => {
  it('assigns IDs with correct prefixes to all entity types', () => {
    const input: ArchitectureBaselineInput = {
      services: [{ name: 'OrderService' }, { name: 'PaymentService' }],
      interfaces: [{ name: 'Order API', serviceRef: 'OrderService' }],
      interfaceEndpoints: [
        { name: 'GET /orders', interfaceRef: 'Order API' },
      ],
      logicalDataEntities: [{ name: 'Order' }],
      physicalDataEntities: [{ name: 'orders_table' }],
      businessLogic: [{ name: 'ValidateOrder' }],
      dataMovements: [
        {
          sourceServiceRef: 'OrderService',
          targetServiceRef: 'PaymentService',
          dataEntityRef: 'Order',
        },
      ],
    };

    const idMaps = generateIds(input);

    // Services get svc- prefix
    expect(idMaps.services['OrderService']).toBeDefined();
    expect(idMaps.services['OrderService'].startsWith('svc-')).toBe(true);
    expect(idMaps.services['PaymentService']).toBeDefined();
    expect(idMaps.services['PaymentService'].startsWith('svc-')).toBe(true);

    // Interfaces get ifc- prefix
    expect(idMaps.interfaces['Order API']).toBeDefined();
    expect(idMaps.interfaces['Order API'].startsWith('ifc-')).toBe(true);

    // Endpoints get ep- prefix
    expect(idMaps.interfaceEndpoints['GET /orders']).toBeDefined();
    expect(idMaps.interfaceEndpoints['GET /orders'].startsWith('ep-')).toBe(true);

    // Logical data entities get lde- prefix
    expect(idMaps.logicalDataEntities['Order']).toBeDefined();
    expect(idMaps.logicalDataEntities['Order'].startsWith('lde-')).toBe(true);

    // Physical data entities get pde- prefix
    expect(idMaps.physicalDataEntities['orders_table']).toBeDefined();
    expect(idMaps.physicalDataEntities['orders_table'].startsWith('pde-')).toBe(true);

    // Business logic gets bl- prefix
    expect(idMaps.businessLogic['ValidateOrder']).toBeDefined();
    expect(idMaps.businessLogic['ValidateOrder'].startsWith('bl-')).toBe(true);

    // Data movements get dm- prefix
    const dmKeys = Object.keys(idMaps.dataMovements);
    expect(dmKeys.length).toBe(1);
    expect(idMaps.dataMovements[dmKeys[0]].startsWith('dm-')).toBe(true);

    // Placeholder Application gets app- prefix
    expect(idMaps.application.id.startsWith('app-')).toBe(true);
    expect(idMaps.application.name).toBe('Core Application');

    // Placeholder AppComponent gets comp- prefix
    expect(idMaps.appComponent.id.startsWith('comp-')).toBe(true);
    expect(idMaps.appComponent.name).toBe('Core Component');
  });
});

// ============================================================================
// Test 6: resolveRefs maps names to generated IDs
// ============================================================================
describe('resolveRefs', () => {
  it('correctly maps serviceRef name to service ID and interfaceRef name to interface ID', () => {
    const input: ArchitectureBaselineInput = {
      services: [{ name: 'OrderService' }, { name: 'PaymentService' }],
      interfaces: [
        { name: 'Order API', serviceRef: 'OrderService' },
        { name: 'Payment API', serviceRef: 'PaymentService' },
      ],
      interfaceEndpoints: [
        {
          name: 'GET /orders',
          interfaceRef: 'Order API',
          requestDataEntityRef: 'Order',
          responseDataEntityRef: 'orders_table',
        },
      ],
      logicalDataEntities: [{ name: 'Order' }],
      physicalDataEntities: [{ name: 'orders_table' }],
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

    // interfaces[0].serviceRef -> OrderService ID
    expect(resolved.interfaceServiceIds[0]).toBe(idMaps.services['OrderService']);
    // interfaces[1].serviceRef -> PaymentService ID
    expect(resolved.interfaceServiceIds[1]).toBe(idMaps.services['PaymentService']);

    // interfaceEndpoints[0].interfaceRef -> Order API ID
    expect(resolved.endpointInterfaceIds[0]).toBe(idMaps.interfaces['Order API']);

    // interfaceEndpoints[0].requestDataEntityRef -> dep_log_{ldeId}
    const orderLdeId = idMaps.logicalDataEntities['Order'];
    expect(resolved.endpointRequestDepIds[0]).toBe(`dep_log_${orderLdeId}`);

    // interfaceEndpoints[0].responseDataEntityRef -> dep_phy_{pdeId}
    const ordersPdeId = idMaps.physicalDataEntities['orders_table'];
    expect(resolved.endpointResponseDepIds[0]).toBe(`dep_phy_${ordersPdeId}`);

    // businessLogic[0].ownerServiceRef -> OrderService ID
    expect(resolved.businessLogicOwnerServiceIds[0]).toBe(idMaps.services['OrderService']);

    // dataMovements[0].sourceServiceRef -> OrderService ID
    expect(resolved.dataMovementSourceServiceIds[0]).toBe(idMaps.services['OrderService']);

    // dataMovements[0].targetServiceRef -> PaymentService ID
    expect(resolved.dataMovementTargetServiceIds[0]).toBe(idMaps.services['PaymentService']);

    // dataMovements[0].dataEntityRef -> dep_log_{ldeId}
    expect(resolved.dataMovementDataEntityPointIds[0]).toBe(`dep_log_${orderLdeId}`);

    // No resolution errors
    expect(resolved.errors).toHaveLength(0);
  });
});

// ============================================================================
// Test 7: buildEntities creates placeholder "Core Application" and "Core Component"
// ============================================================================
describe('buildEntities', () => {
  it('creates placeholder "Core Application" and "Core Component" and associates services', () => {
    const input: ArchitectureBaselineInput = {
      services: [
        { name: 'OrderService', description: 'Manages orders', serviceType: 'REST', coreTech: 'Java' },
        { name: 'PaymentService', description: 'Handles payments' },
      ],
      interfaces: [{ name: 'Order API', serviceRef: 'OrderService' }],
      interfaceEndpoints: [],
      logicalDataEntities: [],
      physicalDataEntities: [],
      businessLogic: [],
      dataMovements: [],
    };

    const idMaps = generateIds(input);
    const resolved = resolveRefs(input, idMaps);
    const entities = buildEntities(input, idMaps, resolved);

    // Should have exactly 1 application with "Core Application" name
    expect(entities.applications).toHaveLength(1);
    expect(entities.applications[0].name).toBe('Core Application');
    expect(entities.applications[0].id).toBe(idMaps.application.id);
    expect(entities.applications[0].id.startsWith('app-')).toBe(true);

    // Should have exactly 1 app_component with "Core Component" name
    expect(entities.app_components).toHaveLength(1);
    expect(entities.app_components[0].name).toBe('Core Component');
    expect(entities.app_components[0].id).toBe(idMaps.appComponent.id);
    expect(entities.app_components[0].id.startsWith('comp-')).toBe(true);
    expect(entities.app_components[0].application_id).toBe(idMaps.application.id);

    // All services should be associated with the placeholder App and Component
    expect(entities.services).toHaveLength(2);
    for (const svc of entities.services) {
      expect(svc.application_id).toBe(idMaps.application.id);
      expect(svc.app_component_id).toBe(idMaps.appComponent.id);
    }

    // Verify service field shapes match DTO expectations
    const orderSvc = entities.services.find((s: any) => s.name === 'OrderService');
    expect(orderSvc).toBeDefined();
    expect(orderSvc.id).toBe(idMaps.services['OrderService']);
    expect(orderSvc.description).toBe('Manages orders');
    expect(orderSvc.service_type).toBe('REST');
    expect(orderSvc.core_tech).toBe('Java');
    expect(orderSvc.tags).toBe('');
    expect(orderSvc.valid_from).toBeNull();
    expect(orderSvc.valid_to).toBeNull();
    expect(orderSvc.package_set_id).toBeNull();
  });

  // ============================================================================
  // Test 8: buildEntities auto-generates application_points and data_entity_points
  // ============================================================================
  it('auto-generates application_points (ap_{entityId}) and data_entity_points (dep_log_, dep_phy_)', () => {
    const input: ArchitectureBaselineInput = {
      services: [{ name: 'OrderService' }, { name: 'PaymentService' }],
      interfaces: [
        { name: 'Order API', serviceRef: 'OrderService' },
        { name: 'Payment API', serviceRef: 'PaymentService' },
      ],
      interfaceEndpoints: [],
      logicalDataEntities: [
        { name: 'Order', description: 'Order entity' },
        { name: 'Payment', description: 'Payment entity' },
      ],
      physicalDataEntities: [
        { name: 'orders_table', description: 'Orders DB table', physicalType: 'TABLE' },
      ],
      businessLogic: [],
      dataMovements: [],
    };

    const idMaps = generateIds(input);
    const resolved = resolveRefs(input, idMaps);
    const entities = buildEntities(input, idMaps, resolved);

    // Application points: 1 app + 1 comp + 2 services + 2 interfaces = 6
    expect(entities.application_points).toHaveLength(6);

    // Verify APPLICATION kind point
    const appPoint = entities.application_points.find(
      (ap: any) => ap.kind === 'APPLICATION'
    );
    expect(appPoint).toBeDefined();
    expect(appPoint.id).toBe(`ap_${idMaps.application.id}`);
    expect(appPoint.name).toBe('Core Application');
    expect(appPoint.application_id).toBe(idMaps.application.id);
    expect(appPoint.application_component_id).toBeNull();
    expect(appPoint.service_id).toBeNull();
    expect(appPoint.interface_id).toBeNull();

    // Verify APP_COMPONENT kind point
    const compPoint = entities.application_points.find(
      (ap: any) => ap.kind === 'APP_COMPONENT'
    );
    expect(compPoint).toBeDefined();
    expect(compPoint.id).toBe(`ap_${idMaps.appComponent.id}`);
    expect(compPoint.name).toBe('Core Component');
    expect(compPoint.application_id).toBe(idMaps.application.id);
    expect(compPoint.application_component_id).toBe(idMaps.appComponent.id);

    // Verify SERVICE kind points
    const servicePoints = entities.application_points.filter(
      (ap: any) => ap.kind === 'SERVICE'
    );
    expect(servicePoints).toHaveLength(2);

    const orderSvcPoint = servicePoints.find((ap: any) => ap.name === 'OrderService');
    expect(orderSvcPoint).toBeDefined();
    expect(orderSvcPoint.id).toBe(`ap_${idMaps.services['OrderService']}`);
    expect(orderSvcPoint.application_id).toBe(idMaps.application.id);
    expect(orderSvcPoint.service_id).toBe(idMaps.services['OrderService']);
    expect(orderSvcPoint.interface_id).toBeNull();

    // Verify INTERFACE kind points
    const ifacePoints = entities.application_points.filter(
      (ap: any) => ap.kind === 'INTERFACE'
    );
    expect(ifacePoints).toHaveLength(2);

    const orderApiPoint = ifacePoints.find((ap: any) => ap.name === 'Order API');
    expect(orderApiPoint).toBeDefined();
    expect(orderApiPoint.id).toBe(`ap_${idMaps.interfaces['Order API']}`);
    expect(orderApiPoint.interface_id).toBe(idMaps.interfaces['Order API']);

    // Verify all application_points have correct shape fields
    for (const ap of entities.application_points) {
      expect(ap).toHaveProperty('id');
      expect(ap).toHaveProperty('name');
      expect(ap).toHaveProperty('description');
      expect(ap).toHaveProperty('kind');
      expect(ap).toHaveProperty('application_id');
      expect(ap).toHaveProperty('application_component_id');
      expect(ap).toHaveProperty('service_id');
      expect(ap).toHaveProperty('interface_id');
      expect(ap).toHaveProperty('target_type');
      expect(ap).toHaveProperty('target_ref_id');
      expect(ap).toHaveProperty('point_type');
      expect(ap).toHaveProperty('tags');
      expect(ap).toHaveProperty('valid_from');
      expect(ap).toHaveProperty('valid_to');
      expect(ap.description).toBe('');
      expect(ap.target_type).toBeNull();
      expect(ap.target_ref_id).toBeNull();
      expect(ap.point_type).toBe('');
      expect(ap.tags).toBe('');
    }

    // Data entity points: 2 logical + 1 physical = 3
    expect(entities.data_entity_points).toHaveLength(3);

    // Verify logical data entity points
    const logicalPoints = entities.data_entity_points.filter(
      (dep: any) => dep.point_kind === 'LOGICAL_ENTITY'
    );
    expect(logicalPoints).toHaveLength(2);

    const orderDepPoint = logicalPoints.find(
      (dep: any) => dep.id === `dep_log_${idMaps.logicalDataEntities['Order']}`
    );
    expect(orderDepPoint).toBeDefined();
    expect(orderDepPoint.logical_entity_id).toBe(idMaps.logicalDataEntities['Order']);
    expect(orderDepPoint.physical_entity_id).toBeNull();

    const paymentDepPoint = logicalPoints.find(
      (dep: any) => dep.id === `dep_log_${idMaps.logicalDataEntities['Payment']}`
    );
    expect(paymentDepPoint).toBeDefined();
    expect(paymentDepPoint.logical_entity_id).toBe(idMaps.logicalDataEntities['Payment']);
    expect(paymentDepPoint.physical_entity_id).toBeNull();

    // Verify physical data entity point
    const physicalPoints = entities.data_entity_points.filter(
      (dep: any) => dep.point_kind === 'PHYSICAL_ENTITY'
    );
    expect(physicalPoints).toHaveLength(1);

    const ordersTableDepPoint = physicalPoints[0];
    expect(ordersTableDepPoint.id).toBe(
      `dep_phy_${idMaps.physicalDataEntities['orders_table']}`
    );
    expect(ordersTableDepPoint.logical_entity_id).toBeNull();
    expect(ordersTableDepPoint.physical_entity_id).toBe(
      idMaps.physicalDataEntities['orders_table']
    );

    // Verify all data_entity_points have correct shape fields
    for (const dep of entities.data_entity_points) {
      expect(dep).toHaveProperty('id');
      expect(dep).toHaveProperty('point_kind');
      expect(dep).toHaveProperty('logical_entity_id');
      expect(dep).toHaveProperty('physical_entity_id');
      expect(dep).toHaveProperty('description');
      expect(dep).toHaveProperty('tags');
      expect(dep).toHaveProperty('valid_from');
      expect(dep).toHaveProperty('valid_to');
    }
  });
});
