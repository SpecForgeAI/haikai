/**
 * ERD Utilities Tests for Interface Contract Rendering
 * Task Group 5: Tests for ERD utilities that support Interface contract rendering
 */

import {
  ERDEndpoint,
  formatEndpointRow,
  getEndpointsForInterface,
  getLogicalEntitiesForInterface,
  calculateInterfaceContractSize,
  supportsContractRendering,
} from '../utils/erdUtils';
import {
  EndpointType,
  EndpointDirection,
  EndpointLifecycleStatus,
  Endpoint,
  ENTITY_TYPES,
} from '../types/model';
import { emptyModel } from '../config/defaults';

describe('ERD Utilities for Interface Contract Rendering', () => {
  describe('ERDEndpoint interface', () => {
    it('should allow creation of ERDEndpoint object', () => {
      const erdEndpoint: ERDEndpoint = {
        id: 'ep-001',
        name: 'Get Customer',
        path_or_address: '/api/v1/customers/{id}',
        operation_verb: 'GET',
        direction: EndpointDirection.INBOUND,
        lifecycle_status: EndpointLifecycleStatus.ACTIVE,
      };

      expect(erdEndpoint.id).toBe('ep-001');
      expect(erdEndpoint.operation_verb).toBe('GET');
    });
  });

  describe('formatEndpointRow', () => {
    it('should format endpoint with verb, path, direction, and status', () => {
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

    it('should handle missing optional fields', () => {
      const endpoint: Endpoint = {
        id: 'ep-002',
        name: 'Post Order',
        description: '',
        interface_id: 'ifc-001',
        endpoint_type: EndpointType.HTTP_REST,
        path_or_address: '/api/v1/orders',
        tags: '',
      };

      const formatted = formatEndpointRow(endpoint);

      // Should not throw and should include the path
      expect(formatted).toContain('/api/v1/orders');
    });
  });

  describe('getEndpointsForInterface', () => {
    it('should return endpoints for a specific interface', () => {
      const endpoints: Endpoint[] = [
        {
          id: 'ep-001',
          name: 'Get Customer',
          description: '',
          interface_id: 'ifc-001',
          endpoint_type: EndpointType.HTTP_REST,
          path_or_address: '/api/v1/customers/{id}',
          tags: '',
        },
        {
          id: 'ep-002',
          name: 'Create Customer',
          description: '',
          interface_id: 'ifc-001',
          endpoint_type: EndpointType.HTTP_REST,
          path_or_address: '/api/v1/customers',
          tags: '',
        },
        {
          id: 'ep-003',
          name: 'Get Order',
          description: '',
          interface_id: 'ifc-002',
          endpoint_type: EndpointType.HTTP_REST,
          path_or_address: '/api/v1/orders/{id}',
          tags: '',
        },
      ];

      const result = getEndpointsForInterface('ifc-001', endpoints);

      expect(result.length).toBe(2);
      expect(result[0].id).toBe('ep-001');
      expect(result[1].id).toBe('ep-002');
    });

    it('should return empty array when no endpoints match', () => {
      const endpoints: Endpoint[] = [
        {
          id: 'ep-001',
          name: 'Get Customer',
          description: '',
          interface_id: 'ifc-001',
          endpoint_type: EndpointType.HTTP_REST,
          path_or_address: '/api/v1/customers/{id}',
          tags: '',
        },
      ];

      const result = getEndpointsForInterface('ifc-999', endpoints);

      expect(result.length).toBe(0);
    });
  });

  describe('getLogicalEntitiesForInterface', () => {
    it('should return logical entities linked to an interface', () => {
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
      expect(result.map(e => e.id)).toContain('lde-001');
      expect(result.map(e => e.id)).toContain('lde-002');
      expect(result.map(e => e.id)).not.toContain('lde-003');
    });
  });

  describe('calculateInterfaceContractSize', () => {
    it('should calculate size based on endpoints and entities', () => {
      const numEndpoints = 3;
      const numEntities = 2;

      const size = calculateInterfaceContractSize(numEndpoints, numEntities);

      expect(size.width).toBeGreaterThan(0);
      expect(size.height).toBeGreaterThan(0);
    });

    it('should return minimum size for empty interface', () => {
      const size = calculateInterfaceContractSize(0, 0);

      expect(size.width).toBeGreaterThan(0);
      expect(size.height).toBeGreaterThan(0);
    });
  });

  describe('supportsContractRendering', () => {
    it('should return true for INTERFACE entity type', () => {
      expect(supportsContractRendering(ENTITY_TYPES.INTERFACE)).toBe(true);
    });

    it('should return false for other entity types', () => {
      expect(supportsContractRendering(ENTITY_TYPES.APPLICATION)).toBe(false);
      expect(supportsContractRendering(ENTITY_TYPES.SERVICE)).toBe(false);
      expect(supportsContractRendering(ENTITY_TYPES.LOGICAL_DATA_ENTITY)).toBe(false);
    });
  });
});
