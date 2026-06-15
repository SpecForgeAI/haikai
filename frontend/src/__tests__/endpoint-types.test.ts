/**
 * Endpoint Type Definitions Tests
 * Task Group 1: Tests for Endpoint entity type definitions
 */

import {
  EndpointType,
  EndpointDirection,
  EndpointLifecycleStatus,
  Endpoint,
  ENTITY_TYPES,
  MetaModelEntities,
  EntityType,
  AnyEntity,
} from '../types/model';

describe('Endpoint Type Definitions', () => {
  describe('EndpointType enum', () => {
    it('should have HTTP_REST value', () => {
      expect(EndpointType.HTTP_REST).toBe('HTTP_REST');
    });

    it('should have MESSAGE_QUEUE value', () => {
      expect(EndpointType.MESSAGE_QUEUE).toBe('MESSAGE_QUEUE');
    });

    it('should have MESSAGE_TOPIC value', () => {
      expect(EndpointType.MESSAGE_TOPIC).toBe('MESSAGE_TOPIC');
    });

    it('should have FILE_TRANSFER value', () => {
      expect(EndpointType.FILE_TRANSFER).toBe('FILE_TRANSFER');
    });

    it('should have OTHER value', () => {
      expect(EndpointType.OTHER).toBe('OTHER');
    });
  });

  describe('EndpointDirection enum', () => {
    it('should have INBOUND value', () => {
      expect(EndpointDirection.INBOUND).toBe('INBOUND');
    });

    it('should have OUTBOUND value', () => {
      expect(EndpointDirection.OUTBOUND).toBe('OUTBOUND');
    });

    it('should have BIDIRECTIONAL value', () => {
      expect(EndpointDirection.BIDIRECTIONAL).toBe('BIDIRECTIONAL');
    });
  });

  describe('EndpointLifecycleStatus enum', () => {
    it('should have ACTIVE value', () => {
      expect(EndpointLifecycleStatus.ACTIVE).toBe('ACTIVE');
    });

    it('should have DEPRECATED value', () => {
      expect(EndpointLifecycleStatus.DEPRECATED).toBe('DEPRECATED');
    });

    it('should have PLANNED value', () => {
      expect(EndpointLifecycleStatus.PLANNED).toBe('PLANNED');
    });

    it('should have RETIRED value', () => {
      expect(EndpointLifecycleStatus.RETIRED).toBe('RETIRED');
    });
  });

  describe('Endpoint interface', () => {
    it('should allow creation of a valid Endpoint object', () => {
      const endpoint: Endpoint = {
        id: 'ep-001',
        name: 'Get Customer',
        description: 'Retrieves customer information',
        interface_id: 'if-001',
        endpoint_type: EndpointType.HTTP_REST,
        path_or_address: '/api/v1/customers/{id}',
        protocol: 'HTTPS',
        operation_verb: 'GET',
        direction: EndpointDirection.INBOUND,
        lifecycle_status: EndpointLifecycleStatus.ACTIVE,
        version: '1.0',
        tags: 'customer,api',
        valid_from: '2024-01-01',
        valid_to: '2025-12-31',
      };

      expect(endpoint.id).toBe('ep-001');
      expect(endpoint.name).toBe('Get Customer');
      expect(endpoint.interface_id).toBe('if-001');
      expect(endpoint.endpoint_type).toBe(EndpointType.HTTP_REST);
      expect(endpoint.direction).toBe(EndpointDirection.INBOUND);
      expect(endpoint.lifecycle_status).toBe(EndpointLifecycleStatus.ACTIVE);
    });

    it('should allow optional fields to be undefined', () => {
      const endpoint: Endpoint = {
        id: 'ep-002',
        name: 'Post Order',
        description: '',
        interface_id: 'if-002',
        endpoint_type: EndpointType.HTTP_REST,
        path_or_address: '/api/v1/orders',
        tags: '',
      };

      expect(endpoint.protocol).toBeUndefined();
      expect(endpoint.operation_verb).toBeUndefined();
      expect(endpoint.direction).toBeUndefined();
      expect(endpoint.lifecycle_status).toBeUndefined();
      expect(endpoint.version).toBeUndefined();
      expect(endpoint.valid_from).toBeUndefined();
      expect(endpoint.valid_to).toBeUndefined();
    });
  });

  describe('ENTITY_TYPES constant', () => {
    it('should include ENDPOINT', () => {
      expect(ENTITY_TYPES.ENDPOINT).toBe('ENDPOINT');
    });
  });

  describe('MetaModelEntities interface', () => {
    it('should include endpoints array', () => {
      const entities: Partial<MetaModelEntities> = {
        endpoints: [
          {
            id: 'ep-001',
            name: 'Test Endpoint',
            description: '',
            interface_id: 'if-001',
            endpoint_type: EndpointType.HTTP_REST,
            path_or_address: '/api/test',
            tags: '',
          },
        ],
      };

      expect(entities.endpoints).toBeDefined();
      expect(entities.endpoints?.length).toBe(1);
    });
  });

  describe('EntityType union', () => {
    it('should accept "endpoints" as a valid EntityType', () => {
      const entityType: EntityType = 'endpoints';
      expect(entityType).toBe('endpoints');
    });
  });

  describe('AnyEntity union', () => {
    it('should accept Endpoint as a valid AnyEntity', () => {
      const endpoint: AnyEntity = {
        id: 'ep-001',
        name: 'Test Endpoint',
        description: '',
        interface_id: 'if-001',
        endpoint_type: EndpointType.HTTP_REST,
        path_or_address: '/api/test',
        tags: '',
      };

      expect(endpoint.id).toBe('ep-001');
      expect((endpoint as Endpoint).interface_id).toBe('if-001');
    });
  });
});
