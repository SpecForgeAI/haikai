/**
 * Endpoint Context and State Layer Tests
 * Task Group 4: Tests for context layer additions for Endpoint entity
 */

import { emptyModel } from '../config/defaults';
import { EndpointType, MetaModelEntities, MetaModelRelationships } from '../types/model';

// Mock the cascade delete function
import { cascadeDeleteInterface } from '../utils/applicationPointSync';

describe('Endpoint Context and State Layer', () => {
  describe('LOAD_MODEL action - endpoints initialization', () => {
    it('should have endpoints array in emptyModel entities', () => {
      expect(emptyModel.metaModel.entities.endpoints).toBeDefined();
      expect(Array.isArray(emptyModel.metaModel.entities.endpoints)).toBe(true);
      expect(emptyModel.metaModel.entities.endpoints.length).toBe(0);
    });

    it('should accept a model with endpoints array', () => {
      const modelWithEndpoints = {
        ...emptyModel,
        metaModel: {
          ...emptyModel.metaModel,
          entities: {
            ...emptyModel.metaModel.entities,
            endpoints: [
              {
                id: 'ep-001',
                name: 'Get Customer',
                description: '',
                interface_id: 'ifc-001',
                endpoint_type: EndpointType.HTTP_REST,
                path_or_address: '/api/v1/customers/{id}',
                tags: '',
              },
            ],
          },
        },
      };

      expect(modelWithEndpoints.metaModel.entities.endpoints.length).toBe(1);
      expect(modelWithEndpoints.metaModel.entities.endpoints[0].id).toBe('ep-001');
    });
  });

  describe('cascadeDeleteInterface - endpoint cleanup', () => {
    it('should delete endpoints when their parent Interface is deleted', () => {
      // Create test data
      const entities: MetaModelEntities = {
        ...emptyModel.metaModel.entities,
        interfaces: [
          {
            id: 'ifc-001',
            name: 'Customer API',
            description: '',
            service_id: 'svc-001',
            interface_type: 'REST_API',
            tags: '',
          },
          {
            id: 'ifc-002',
            name: 'Order API',
            description: '',
            service_id: 'svc-001',
            interface_type: 'REST_API',
            tags: '',
          },
        ],
        endpoints: [
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
        ],
      };

      const relationships: MetaModelRelationships = {
        ...emptyModel.metaModel.relationships,
      };

      // Delete interface ifc-001
      const result = cascadeDeleteInterface('ifc-001', entities, relationships);

      // Endpoints ep-001 and ep-002 should be deleted (they belong to ifc-001)
      // Endpoint ep-003 should remain (it belongs to ifc-002)
      expect(result.entities.endpoints.length).toBe(1);
      expect(result.entities.endpoints[0].id).toBe('ep-003');
    });

    it('should handle interface with no endpoints', () => {
      const entities: MetaModelEntities = {
        ...emptyModel.metaModel.entities,
        interfaces: [
          {
            id: 'ifc-001',
            name: 'Customer API',
            description: '',
            service_id: 'svc-001',
            interface_type: 'REST_API',
            tags: '',
          },
        ],
        endpoints: [],
      };

      const relationships: MetaModelRelationships = {
        ...emptyModel.metaModel.relationships,
      };

      // Delete interface - should not throw
      const result = cascadeDeleteInterface('ifc-001', entities, relationships);

      expect(result.entities.endpoints.length).toBe(0);
    });
  });
});
