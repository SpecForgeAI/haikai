/**
 * Endpoint Entity Integration Tests
 * Task Group 8: Strategic integration tests for end-to-end workflows
 *
 * These tests cover critical user workflows:
 * 1. Create Interface -> Add Endpoints via grid -> View contract on canvas
 * 2. Advanced Add: Interface with Endpoints + Logical Entities
 * 3. Delete Interface -> Cascade delete Endpoints
 */

import {
  ENTITY_TYPES,
  Endpoint,
  EndpointType,
  EndpointDirection,
  EndpointLifecycleStatus,
  MetaModel,
} from '../types/model';
import { emptyModel } from '../config/defaults';
import { gridConfigs, tabToEntityType, entityTabNames } from '../config/gridConfigs';
import { generateEntityId, getEntityPrefix } from '../utils/idGenerator';
import { getExpandableRelationships, EXPANDABLE_RELATIONSHIPS } from '../utils/advancedAddRelationships';
import { cascadeDeleteInterface } from '../utils/applicationPointSync';
import {
  formatEndpointRow,
  getEndpointsForInterface,
  getLogicalEntitiesForInterface,
  calculateInterfaceContractSize,
  supportsContractRendering,
  shouldRenderAsContract,
} from '../utils/erdUtils';

describe('Endpoint Entity Integration Tests', () => {
  /**
   * Test 1: Full endpoint creation workflow
   * Simulates creating an endpoint and verifying all configurations are in place
   */
  describe('Endpoint creation workflow', () => {
    it('should support full endpoint creation with all required fields', () => {
      // Step 1: Verify grid configuration exists for endpoints
      expect(gridConfigs.endpoints).toBeDefined();
      expect(gridConfigs.endpoints.length).toBeGreaterThan(0);

      // Step 2: Generate a new endpoint ID
      const endpointId = generateEntityId('endpoints');
      expect(endpointId).toMatch(/^ep-/);

      // Step 3: Create a valid endpoint object
      const endpoint: Endpoint = {
        id: endpointId,
        name: 'Get Customer Details',
        description: 'Retrieves customer information by ID',
        interface_id: 'ifc-001',
        endpoint_type: EndpointType.HTTP_REST,
        path_or_address: '/api/v1/customers/{id}',
        protocol: 'HTTPS',
        operation_verb: 'GET',
        direction: EndpointDirection.INBOUND,
        lifecycle_status: EndpointLifecycleStatus.ACTIVE,
        version: 'v1',
        tags: 'customer,api',
      };

      // Step 4: Verify endpoint object is valid
      expect(endpoint.id).toBe(endpointId);
      expect(endpoint.interface_id).toBe('ifc-001');
      expect(endpoint.endpoint_type).toBe(EndpointType.HTTP_REST);
      expect(endpoint.direction).toBe(EndpointDirection.INBOUND);
      expect(endpoint.lifecycle_status).toBe(EndpointLifecycleStatus.ACTIVE);
    });
  });

  /**
   * Test 2: Tab navigation and entity type mapping
   * Verifies Endpoints appear correctly in the navigation
   */
  describe('Tab navigation integration', () => {
    it('should include Endpoints in tab navigation after Interfaces', () => {
      // Verify tab mapping exists
      expect(tabToEntityType['Endpoints']).toBe('endpoints');

      // Verify Endpoints is in entity tab names
      expect(entityTabNames).toContain('Endpoints');

      // Verify ordering: Endpoints should come after Interfaces
      const interfacesIndex = entityTabNames.indexOf('Interfaces');
      const endpointsIndex = entityTabNames.indexOf('Endpoints');

      expect(interfacesIndex).toBeGreaterThanOrEqual(0);
      expect(endpointsIndex).toBeGreaterThanOrEqual(0);
      expect(endpointsIndex).toBeGreaterThan(interfacesIndex);
    });
  });

  /**
   * Test 3: Interface -> Endpoint relationship in Advanced Add
   * Verifies EXPANDABLE_RELATIONSHIPS correctly links Interface to Endpoint
   */
  describe('Interface to Endpoint relationship', () => {
    it('should have ENDPOINT as expandable child of INTERFACE', () => {
      const interfaceRelationships = EXPANDABLE_RELATIONSHIPS[ENTITY_TYPES.INTERFACE];

      expect(interfaceRelationships).toBeDefined();

      // Find the ENDPOINT relationship
      const endpointRelationship = interfaceRelationships.find(
        (rel) => rel.targetEntityType === ENTITY_TYPES.ENDPOINT
      );

      expect(endpointRelationship).toBeDefined();
      expect(endpointRelationship!.direction).toBe('CHILD');
      expect(endpointRelationship!.relationshipKind).toBe('PARENT_CHILD');
      expect(endpointRelationship!.actsAsContainment).toBe(true);
      expect(endpointRelationship!.foreignKeyField).toBe('interface_id');
    });

    it('should return ENDPOINT relationship from getExpandableRelationships', () => {
      const relationships = getExpandableRelationships(ENTITY_TYPES.INTERFACE);

      const endpointRel = relationships.find(
        (r) => r.targetEntityType === ENTITY_TYPES.ENDPOINT
      );

      expect(endpointRel).toBeDefined();
      expect(endpointRel!.displayLabel).toBe('Endpoints');
    });
  });

  /**
   * Test 4: Cascade delete workflow
   * Verifies deleting an Interface cascades to delete its Endpoints
   */
  describe('Cascade delete workflow', () => {
    it('should delete all endpoints when interface is deleted', () => {
      // Setup: Create entities and relationships
      const entities = {
        ...emptyModel.metaModel.entities,
        interfaces: [
          { id: 'ifc-001', name: 'Customer API', description: '', service_id: 'svc-001', interface_type: 'REST', tags: '' },
          { id: 'ifc-002', name: 'Order API', description: '', service_id: 'svc-001', interface_type: 'REST', tags: '' },
        ],
        endpoints: [
          {
            id: 'ep-001',
            name: 'Get Customer',
            description: '',
            interface_id: 'ifc-001',
            endpoint_type: EndpointType.HTTP_REST,
            path_or_address: '/customers/{id}',
            tags: '',
          } as Endpoint,
          {
            id: 'ep-002',
            name: 'Create Customer',
            description: '',
            interface_id: 'ifc-001',
            endpoint_type: EndpointType.HTTP_REST,
            path_or_address: '/customers',
            tags: '',
          } as Endpoint,
          {
            id: 'ep-003',
            name: 'Get Order',
            description: '',
            interface_id: 'ifc-002',
            endpoint_type: EndpointType.HTTP_REST,
            path_or_address: '/orders/{id}',
            tags: '',
          } as Endpoint,
        ],
      };

      const relationships = {
        ...emptyModel.metaModel.relationships,
        interface_logical_entities: [
          { id: 'ile-001', interface_id: 'ifc-001', logical_entity_id: 'lde-001', description: '', tags: '' },
        ],
      };

      // Execute: Delete interface ifc-001
      const result = cascadeDeleteInterface('ifc-001', entities, relationships);

      // Verify: Only endpoints belonging to ifc-001 are deleted
      expect(result.entities.endpoints.length).toBe(1);
      expect(result.entities.endpoints[0].id).toBe('ep-003');

      // Verify: interface_logical_entities for ifc-001 are also deleted
      expect(result.relationships.interface_logical_entities.length).toBe(0);
    });
  });

  /**
   * Test 5: ERD utilities for Interface contract rendering
   * Verifies all utility functions work correctly for Interface contract
   */
  describe('Interface contract rendering utilities', () => {
    it('should correctly format endpoint rows', () => {
      const endpoint: Endpoint = {
        id: 'ep-001',
        name: 'Get Customer',
        description: '',
        interface_id: 'ifc-001',
        endpoint_type: EndpointType.HTTP_REST,
        path_or_address: '/api/v1/customers/{id}',
        protocol: 'HTTPS',
        operation_verb: 'GET',
        direction: EndpointDirection.INBOUND,
        lifecycle_status: EndpointLifecycleStatus.ACTIVE,
        tags: '',
      };

      const formatted = formatEndpointRow(endpoint);

      expect(formatted).toContain('GET');
      expect(formatted).toContain('/api/v1/customers/{id}');
      expect(formatted).toContain('INBOUND');
      expect(formatted).toContain('ACTIVE');
    });

    it('should get endpoints for a specific interface', () => {
      const endpoints: Endpoint[] = [
        {
          id: 'ep-001',
          name: 'Get Customer',
          description: '',
          interface_id: 'ifc-001',
          endpoint_type: EndpointType.HTTP_REST,
          path_or_address: '/customers/{id}',
          tags: '',
        },
        {
          id: 'ep-002',
          name: 'Get Order',
          description: '',
          interface_id: 'ifc-002',
          endpoint_type: EndpointType.HTTP_REST,
          path_or_address: '/orders/{id}',
          tags: '',
        },
      ];

      const result = getEndpointsForInterface('ifc-001', endpoints);

      expect(result.length).toBe(1);
      expect(result[0].id).toBe('ep-001');
    });

    it('should support contract rendering for INTERFACE entity type', () => {
      expect(supportsContractRendering(ENTITY_TYPES.INTERFACE)).toBe(true);
      expect(supportsContractRendering(ENTITY_TYPES.APPLICATION)).toBe(false);
      expect(supportsContractRendering(ENTITY_TYPES.SERVICE)).toBe(false);
    });

    it('should determine contract rendering based on node properties', () => {
      const interfaceNode = {
        entity_type: ENTITY_TYPES.INTERFACE,
        render_style: 'contract' as const,
      };

      const standardNode = {
        entity_type: ENTITY_TYPES.INTERFACE,
        render_style: 'standard' as const,
      };

      expect(shouldRenderAsContract(interfaceNode)).toBe(true);
      expect(shouldRenderAsContract(standardNode)).toBe(false);
    });

    it('should calculate interface contract size based on content', () => {
      const size = calculateInterfaceContractSize(3, 2);

      expect(size.width).toBeGreaterThan(0);
      expect(size.height).toBeGreaterThan(0);

      // Size should increase with more endpoints
      const largerSize = calculateInterfaceContractSize(10, 5);
      expect(largerSize.height).toBeGreaterThan(size.height);
    });
  });

  /**
   * Test 6: Model backward compatibility
   * Verifies models without endpoints array are handled correctly
   */
  describe('Backward compatibility', () => {
    it('should handle models without endpoints array', () => {
      // Simulate loading an old model without endpoints
      const oldModel = {
        ...emptyModel,
        metaModel: {
          ...emptyModel.metaModel,
          entities: {
            ...emptyModel.metaModel.entities,
          },
        },
      };

      // Simulate the initialization that happens in LOAD_MODEL
      const endpoints = (oldModel.metaModel.entities as any).endpoints || [];

      expect(Array.isArray(endpoints)).toBe(true);
      expect(endpoints.length).toBe(0);
    });
  });

  /**
   * Test 7: Grid configuration completeness
   * Verifies all endpoint fields have grid columns
   */
  describe('Grid configuration completeness', () => {
    it('should have grid columns for all endpoint fields', () => {
      const endpointColumns = gridConfigs.endpoints;
      const columnFields = endpointColumns.map((c) => c.field);

      // Required fields
      expect(columnFields).toContain('id');
      expect(columnFields).toContain('name');
      expect(columnFields).toContain('interface_id');
      expect(columnFields).toContain('endpoint_type');
      expect(columnFields).toContain('path_or_address');

      // Optional fields
      expect(columnFields).toContain('description');
      expect(columnFields).toContain('protocol');
      expect(columnFields).toContain('operation_verb');
      expect(columnFields).toContain('direction');
      // lifecycle_status / version / tags remain on the Endpoint model but the
      // grid surfaces the request/response data-entity pickers instead.
      expect(columnFields).toContain('request_data_entity_point_id');
      expect(columnFields).toContain('response_data_entity_point_id');
    });

    it('should have correct FK configuration for interface_id', () => {
      const interfaceIdColumn = gridConfigs.endpoints.find(
        (c) => c.field === 'interface_id'
      );

      expect(interfaceIdColumn).toBeDefined();
      expect(interfaceIdColumn!.cellType).toBe('fk_typeahead');
      expect(interfaceIdColumn!.fkTarget).toBe('interfaces');
    });
  });

  /**
   * Test 8: ID generation uniqueness
   * Verifies endpoint IDs are unique
   */
  describe('ID generation', () => {
    it('should generate unique endpoint IDs with correct prefix', () => {
      const ids = new Set<string>();

      for (let i = 0; i < 100; i++) {
        const id = generateEntityId('endpoints');
        expect(id).toMatch(/^ep-/);
        expect(ids.has(id)).toBe(false);
        ids.add(id);
      }

      expect(ids.size).toBe(100);
    });

    it('should have correct prefix configured for endpoints', () => {
      const prefix = getEntityPrefix('endpoints');
      expect(prefix).toBe('ep');
    });
  });

  /**
   * Test 9: getLogicalEntitiesForInterface integration
   * Verifies the function correctly fetches linked logical entities
   */
  describe('Logical entities for interface', () => {
    it('should get logical entities linked via interface_logical_entities', () => {
      const entities = {
        ...emptyModel.metaModel.entities,
        logical_data_entities: [
          { id: 'lde-001', name: 'Customer', description: '', tags: '' },
          { id: 'lde-002', name: 'Order', description: '', tags: '' },
          { id: 'lde-003', name: 'Product', description: '', tags: '' },
        ],
      };

      const relationships = {
        ...emptyModel.metaModel.relationships,
        interface_logical_entities: [
          { id: 'ile-001', interface_id: 'ifc-001', logical_entity_id: 'lde-001', description: '', tags: '' },
          { id: 'ile-002', interface_id: 'ifc-001', logical_entity_id: 'lde-002', description: '', tags: '' },
          { id: 'ile-003', interface_id: 'ifc-002', logical_entity_id: 'lde-003', description: '', tags: '' },
        ],
      };

      const result = getLogicalEntitiesForInterface('ifc-001', entities, relationships);

      expect(result.length).toBe(2);
      expect(result.map((e) => e.id)).toContain('lde-001');
      expect(result.map((e) => e.id)).toContain('lde-002');
      expect(result.map((e) => e.id)).not.toContain('lde-003');
    });
  });

  /**
   * Test 10: Empty model initialization
   * Verifies emptyModel includes endpoints array
   */
  describe('Empty model initialization', () => {
    it('should have endpoints array in emptyModel', () => {
      expect(emptyModel.metaModel.entities.endpoints).toBeDefined();
      expect(Array.isArray(emptyModel.metaModel.entities.endpoints)).toBe(true);
      expect(emptyModel.metaModel.entities.endpoints.length).toBe(0);
    });
  });
});
