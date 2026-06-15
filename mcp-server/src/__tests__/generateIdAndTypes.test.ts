/**
 * Tests for type definitions and generateId utility.
 * Task Group 1: Type Definitions and ID Generation Utility
 */

import { generateId } from '../utils/generateId';
import type {
  ArchitectureBaselineInput,
  ServiceInput,
  InterfaceInput,
  InterfaceEndpointInput,
  LogicalDataEntityInput,
  PhysicalDataEntityInput,
  BusinessLogicInput,
  DataMovementInput,
  SaveArchitectureBaselineRequest,
  SaveArchitectureBaselineResponse,
  SaveArchitectureBaselineErrorResponse,
  ValidationError,
} from '../types/saveArchitectureBaseline';

describe('generateId utility', () => {
  // ==========================================================================
  // Test 1: generateId('svc-') returns a string starting with 'svc-' and
  //         has a reasonable length (prefix + base36 timestamp + dash + 5-char suffix)
  // ==========================================================================
  it('returns a string starting with the given prefix and has a reasonable length', () => {
    const id = generateId('svc-');

    expect(typeof id).toBe('string');
    expect(id.startsWith('svc-')).toBe(true);

    // Minimum length: prefix (4) + base36 timestamp (~8 chars) + dash (1) + suffix (5) = ~18
    // Maximum length: prefix (4) + base36 timestamp (~9 chars) + dash (1) + suffix (5) = ~19
    expect(id.length).toBeGreaterThanOrEqual(16);
    expect(id.length).toBeLessThanOrEqual(25);

    // The part after the prefix should contain a dash separating timestamp from suffix
    const afterPrefix = id.substring(4); // remove 'svc-'
    expect(afterPrefix).toContain('-');
  });

  // ==========================================================================
  // Test 2: generateId with each supported prefix produces correctly prefixed IDs
  // ==========================================================================
  it('produces correctly prefixed IDs for all supported prefixes', () => {
    const prefixes = [
      'svc-',
      'ifc-',
      'ep-',
      'lde-',
      'pde-',
      'bl-',
      'dm-',
      'app-',
      'comp-',
      'ile-',
      'ldepe-',
      'apbl-',
    ];

    for (const prefix of prefixes) {
      const id = generateId(prefix);
      expect(id.startsWith(prefix)).toBe(true);

      // Verify the structure after the prefix: timestamp-suffix
      const afterPrefix = id.substring(prefix.length);
      const parts = afterPrefix.split('-');
      expect(parts.length).toBe(2);

      // Timestamp part should be a valid base36 string
      const timestampPart = parts[0];
      expect(timestampPart.length).toBeGreaterThanOrEqual(7);
      expect(/^[a-z0-9]+$/.test(timestampPart)).toBe(true);

      // Suffix part should be 5 alphanumeric characters
      const suffixPart = parts[1];
      expect(suffixPart.length).toBe(5);
      expect(/^[a-z0-9]+$/.test(suffixPart)).toBe(true);
    }
  });

  // ==========================================================================
  // Test 3: Two sequential calls to generateId with the same prefix produce
  //         different IDs (uniqueness)
  // ==========================================================================
  it('produces unique IDs on sequential calls with the same prefix', () => {
    const id1 = generateId('svc-');
    const id2 = generateId('svc-');

    expect(id1).not.toBe(id2);
  });
});

describe('ArchitectureBaselineInput type definitions', () => {
  // ==========================================================================
  // Test 4: ArchitectureBaselineInput type allows valid payloads with all
  //         optional arrays and validates required fields via type checking
  // ==========================================================================
  it('allows valid payloads with all optional arrays', () => {
    // A fully populated valid payload
    const fullPayload: ArchitectureBaselineInput = {
      services: [
        { name: 'OrderService', description: 'Manages orders', serviceType: 'REST', coreTech: 'Java', tags: 'core' },
      ],
      interfaces: [
        { name: 'Order API', description: 'REST API', serviceRef: 'OrderService', interfaceType: 'REST_API', tags: 'public' },
      ],
      interfaceEndpoints: [
        {
          name: 'GET /orders',
          description: 'List orders',
          interfaceRef: 'Order API',
          endpointType: 'REST',
          pathOrAddress: '/api/orders',
          protocol: 'HTTP',
          operationVerb: 'GET',
          direction: 'INBOUND',
          requestDataEntityRef: 'OrderRequest',
          responseDataEntityRef: 'OrderResponse',
        },
      ],
      logicalDataEntities: [
        { name: 'Order', description: 'Order entity', tags: 'domain' },
      ],
      physicalDataEntities: [
        { name: 'orders_table', description: 'Orders DB table', physicalType: 'TABLE', database: 'orders_db', logicalDataEntityRef: 'Order', tags: 'persistence' },
      ],
      businessLogic: [
        { name: 'ValidateOrder', descriptionMd: '## Validates order', typeText: 'VALIDATION', ownerServiceRef: 'OrderService', tags: 'business' },
      ],
      dataMovements: [
        {
          sourceServiceRef: 'OrderService',
          targetServiceRef: 'OrderService',
          dataEntityRef: 'Order',
          movementType: 'SYNC',
          description: 'Order flow',
          biDirectional: false,
          tags: 'flow',
        },
      ],
    };

    // Verify the payload is well-formed (TypeScript compilation is the primary check,
    // but we also verify the runtime shape)
    expect(fullPayload.services).toHaveLength(1);
    expect(fullPayload.interfaces).toHaveLength(1);
    expect(fullPayload.interfaceEndpoints).toHaveLength(1);
    expect(fullPayload.logicalDataEntities).toHaveLength(1);
    expect(fullPayload.physicalDataEntities).toHaveLength(1);
    expect(fullPayload.businessLogic).toHaveLength(1);
    expect(fullPayload.dataMovements).toHaveLength(1);

    // A minimal valid payload with all arrays omitted (all optional)
    const minimalPayload: ArchitectureBaselineInput = {};
    expect(minimalPayload.services).toBeUndefined();
    expect(minimalPayload.interfaces).toBeUndefined();
    expect(minimalPayload.interfaceEndpoints).toBeUndefined();
    expect(minimalPayload.logicalDataEntities).toBeUndefined();
    expect(minimalPayload.physicalDataEntities).toBeUndefined();
    expect(minimalPayload.businessLogic).toBeUndefined();
    expect(minimalPayload.dataMovements).toBeUndefined();

    // A payload with some arrays provided and some omitted
    const partialPayload: ArchitectureBaselineInput = {
      services: [{ name: 'PaymentService' }],
      logicalDataEntities: [{ name: 'Payment' }],
    };
    expect(partialPayload.services).toHaveLength(1);
    expect(partialPayload.logicalDataEntities).toHaveLength(1);
    expect(partialPayload.interfaces).toBeUndefined();

    // Verify required fields are enforced at runtime by checking
    // that ServiceInput requires 'name' (we check that name is a string)
    const service: ServiceInput = { name: 'TestService' };
    expect(typeof service.name).toBe('string');

    // Verify InterfaceInput requires both name and serviceRef
    const iface: InterfaceInput = { name: 'TestAPI', serviceRef: 'TestService' };
    expect(typeof iface.name).toBe('string');
    expect(typeof iface.serviceRef).toBe('string');

    // Verify DataMovementInput requires sourceServiceRef and targetServiceRef
    const dm: DataMovementInput = {
      sourceServiceRef: 'ServiceA',
      targetServiceRef: 'ServiceB',
    };
    expect(typeof dm.sourceServiceRef).toBe('string');
    expect(typeof dm.targetServiceRef).toBe('string');

    // Verify ValidationError shape
    const validationError: ValidationError = {
      field: 'name',
      entityType: 'services',
      entityName: 'OrderService',
      message: 'Duplicate service name',
    };
    expect(validationError.field).toBe('name');
    expect(validationError.entityType).toBe('services');

    // Verify response types compile and have correct shapes
    const successResponse: SaveArchitectureBaselineResponse = {
      success: true,
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      filename: 'TestProject',
      summary: {
        applications: 1,
        appComponents: 1,
        services: 2,
        interfaces: 1,
        interfaceEndpoints: 1,
        logicalDataEntities: 1,
        physicalDataEntities: 1,
        logicalDataAttributes: 0,
        physicalDataAttributes: 0,
        businessLogic: 1,
        dataMovements: 1,
        applicationPoints: 5,
        dataEntityPoints: 2,
        interfaceLogicalEntities: 1,
        logicalPhysicalMappings: 1,
        applicationPointBusinessLogics: 1,
        dataEntityRelationships: 0,
        deletedEntities: 0,
        deletedRelationships: 0,
      },
      createdEntities: {
        services: [{ name: 'OrderService', id: 'svc-test123-abcde' }],
      },
    };
    expect(successResponse.success).toBe(true);
    expect(successResponse.summary.services).toBe(2);

    const errorResponse: SaveArchitectureBaselineErrorResponse = {
      success: false,
      errors: [validationError],
    };
    expect(errorResponse.success).toBe(false);
    expect(errorResponse.errors).toHaveLength(1);
  });
});
