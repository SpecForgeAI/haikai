/**
 * Integration tests for compute_oas_gaps feature
 *
 * These tests verify end-to-end functionality without mocking the core
 * computation service, testing the full flow from route handler through
 * the gap computation logic.
 */

import { AxiosError } from 'axios';
import type { Request, Response, NextFunction } from 'express';

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock axios
jest.mock('axios');

// Mock sessionManager
jest.mock('../services/sessionManager');

// Note: We do NOT mock computeOasGaps - this is an integration test

describe('compute_oas_gaps Integration Tests', () => {
  // ============================================================================
  // Test 1: End-to-end test - complete request through response flow
  // ============================================================================
  describe('End-to-end test: complete request through response flow', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('processes a complete request through the full computation pipeline', async () => {
      // Create a realistic interface context from the backend
      const mockContext = {
        interface: {
          id: 'iface-e2e-test',
          name: 'End-to-End Test API',
          description: 'API for integration testing',
          interfaceType: 'REST_API',
          specLink: null,
          tags: null,
          validFrom: null,
          validTo: null,
        },
        service: {
          id: 'svc-1',
          name: 'Test Service',
          description: 'Test service description',
          serviceType: 'Backend',
          tags: null,
        },
        application: {
          id: 'app-1',
          name: 'Test Application',
          description: 'Test application description',
          appType: 'Web',
          status: 'Active',
          tags: null,
        },
        endpoints: [
          {
            id: 'ep-1',
            name: 'Get Users',
            description: 'Retrieve all users',
            endpointType: 'HTTP_REST',
            pathOrAddress: '/users',
            protocol: 'HTTP',
            operationVerb: 'GET',
            direction: 'Inbound',
            lifecycleStatus: 'Active',
            version: null,
            tags: null,
            validFrom: null,
            validTo: null,
          },
          {
            id: 'ep-2',
            name: 'Create User',
            description: 'Create a new user',
            endpointType: 'HTTP_REST',
            pathOrAddress: '/users',
            protocol: 'HTTP',
            operationVerb: 'POST',
            direction: 'Inbound',
            lifecycleStatus: 'Active',
            version: null,
            tags: null,
            validFrom: null,
            validTo: null,
          },
        ],
        logicalEntities: [
          {
            id: 'entity-user',
            name: 'User',
            description: 'User entity',
            tags: null,
            validFrom: null,
            validTo: null,
            attributes: [
              {
                id: 'attr-id',
                name: 'id',
                description: 'Unique identifier',
                dataType: 'string_uuid',
                isPrimaryKey: true,
                isNullable: false,
                tags: null,
              },
              {
                id: 'attr-email',
                name: 'email',
                description: 'User email',
                dataType: 'string',
                isPrimaryKey: false,
                isNullable: false,
                tags: null,
              },
            ],
          },
        ],
        notes: null,
      };

      // Setup axios mock
      const axios = require('axios');
      const mockAxiosInstance = {
        get: jest.fn().mockResolvedValue({ data: mockContext }),
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Setup session manager mock
      const sessionManager = require('../services/sessionManager');
      sessionManager.getOrCreateSession = jest.fn().mockReturnValue({
        sessionId: 'session-e2e',
        lastActivity: new Date(),
      });
      sessionManager.updateSession = jest.fn();

      // Import the route handler (NOT mocking computeOasGaps)
      const { computeOasGapsRouter } = require('../routes/computeOasGapsRoute');

      // Create mock request/response
      const mockReq = {
        body: {
          sessionId: 'session-e2e',
          interfaceId: 'iface-e2e-test',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const mockRes = {
        json: jsonMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      // Get the route handler
      const routeLayer = computeOasGapsRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify the response was called
        expect(jsonMock).toHaveBeenCalled();
        const gapReport = jsonMock.mock.calls[0][0];

        // Verify GapReport structure
        expect(gapReport.interfaceId).toBe('iface-e2e-test');
        expect(gapReport.generatedAt).toBeDefined();
        expect(Array.isArray(gapReport.gaps)).toBe(true);
        expect(Array.isArray(gapReport.defaults)).toBe(true);
        expect(Array.isArray(gapReport.typeMappings)).toBe(true);
        expect(Array.isArray(gapReport.operationIds)).toBe(true);

        // Verify expected gaps are present
        const gapCodes = gapReport.gaps.map((g: any) => g.code);
        expect(gapCodes).toContain('SERVER_URL_MISSING');
        expect(gapCodes).toContain('SECURITY_NOT_SPECIFIED');
        expect(gapCodes).toContain('INFO_VERSION_DEFAULTED');
        expect(gapCodes).toContain('RESPONSES_UNDEFINED'); // For both endpoints

        // POST endpoint should have REQUEST_BODY_UNDEFINED
        expect(gapCodes).toContain('REQUEST_BODY_UNDEFINED');

        // Verify defaults
        const defaultCodes = gapReport.defaults.map((d: any) => d.code);
        expect(defaultCodes).toContain('DEFAULT_INFO_VERSION');
        expect(defaultCodes).toContain('DEFAULT_MEDIA_TYPE');
        expect(defaultCodes).toContain('SUGGESTED_SUCCESS_STATUS_BY_VERB');

        // Verify type mappings (from User entity attributes)
        expect(gapReport.typeMappings.length).toBe(2);
        const mappedTypes = gapReport.typeMappings.map((m: any) => m.logicalType);
        expect(mappedTypes).toContain('string');
        expect(mappedTypes).toContain('string_uuid');

        // Verify operationIds (2 endpoints x 2 styles)
        expect(gapReport.operationIds.length).toBe(4);
        const opIds = gapReport.operationIds.map((o: any) => o.operationId);
        expect(opIds).toContain('getUsers');
        expect(opIds).toContain('get_users');
        expect(opIds).toContain('postUsers');
        expect(opIds).toContain('post_users');
      } else {
        fail('Route handler not found');
      }
    });
  });

  // ============================================================================
  // Test 2: Complex interface with multiple endpoints and entities
  // ============================================================================
  describe('Complex interface with multiple endpoints and entities', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('handles complex interface with many endpoints, entities, and path parameters', async () => {
      // Create a complex interface context
      const mockComplexContext = {
        interface: {
          id: 'iface-complex',
          name: 'Complex E-Commerce API',
          description: 'Full featured e-commerce API',
          interfaceType: 'REST_API',
          specLink: null,
          tags: null,
          validFrom: null,
          validTo: null,
        },
        service: null,
        application: null,
        endpoints: [
          // User endpoints
          {
            id: 'ep-get-users',
            name: 'List Users',
            description: null,
            endpointType: 'HTTP_REST',
            pathOrAddress: '/users',
            protocol: 'HTTP',
            operationVerb: 'GET',
            direction: 'Inbound',
            lifecycleStatus: 'Active',
            version: null,
            tags: null,
            validFrom: null,
            validTo: null,
          },
          {
            id: 'ep-get-user',
            name: 'Get User by ID',
            description: null,
            endpointType: 'HTTP_REST',
            pathOrAddress: '/users/{userId}',
            protocol: 'HTTP',
            operationVerb: 'GET',
            direction: 'Inbound',
            lifecycleStatus: 'Active',
            version: null,
            tags: null,
            validFrom: null,
            validTo: null,
          },
          {
            id: 'ep-create-user',
            name: 'Create User',
            description: null,
            endpointType: 'HTTP_REST',
            pathOrAddress: '/users',
            protocol: 'HTTP',
            operationVerb: 'POST',
            direction: 'Inbound',
            lifecycleStatus: 'Active',
            version: null,
            tags: null,
            validFrom: null,
            validTo: null,
          },
          {
            id: 'ep-update-user',
            name: 'Update User',
            description: null,
            endpointType: 'HTTP_REST',
            pathOrAddress: '/users/{userId}',
            protocol: 'HTTP',
            operationVerb: 'PUT',
            direction: 'Inbound',
            lifecycleStatus: 'Active',
            version: null,
            tags: null,
            validFrom: null,
            validTo: null,
          },
          // Order endpoints
          {
            id: 'ep-get-orders',
            name: 'List User Orders',
            description: null,
            endpointType: 'HTTP_REST',
            pathOrAddress: '/users/{userId}/orders',
            protocol: 'HTTP',
            operationVerb: 'GET',
            direction: 'Inbound',
            lifecycleStatus: 'Active',
            version: null,
            tags: null,
            validFrom: null,
            validTo: null,
          },
          {
            id: 'ep-create-order',
            name: 'Create Order',
            description: null,
            endpointType: 'HTTP_REST',
            pathOrAddress: '/users/{userId}/orders',
            protocol: 'HTTP',
            operationVerb: 'POST',
            direction: 'Inbound',
            lifecycleStatus: 'Active',
            version: null,
            tags: null,
            validFrom: null,
            validTo: null,
          },
          {
            id: 'ep-get-order',
            name: 'Get Order by ID',
            description: null,
            endpointType: 'HTTP_REST',
            pathOrAddress: '/users/{userId}/orders/{orderId}',
            protocol: 'HTTP',
            operationVerb: 'GET',
            direction: 'Inbound',
            lifecycleStatus: 'Active',
            version: null,
            tags: null,
            validFrom: null,
            validTo: null,
          },
        ],
        logicalEntities: [
          {
            id: 'entity-user',
            name: 'User',
            description: 'User account',
            tags: null,
            validFrom: null,
            validTo: null,
            attributes: [
              { id: 'u1', name: 'id', description: null, dataType: 'string_uuid', isPrimaryKey: true, isNullable: false, tags: null },
              { id: 'u2', name: 'email', description: null, dataType: 'string', isPrimaryKey: false, isNullable: false, tags: null },
              { id: 'u3', name: 'createdAt', description: null, dataType: 'string_date-time', isPrimaryKey: false, isNullable: false, tags: null },
              { id: 'u4', name: 'isActive', description: null, dataType: 'boolean', isPrimaryKey: false, isNullable: false, tags: null },
            ],
          },
          {
            id: 'entity-order',
            name: 'Order',
            description: 'Customer order',
            tags: null,
            validFrom: null,
            validTo: null,
            attributes: [
              { id: 'o1', name: 'id', description: null, dataType: 'string_uuid', isPrimaryKey: true, isNullable: false, tags: null },
              { id: 'o2', name: 'userId', description: null, dataType: 'string_uuid', isPrimaryKey: false, isNullable: false, tags: null },
              { id: 'o3', name: 'totalAmount', description: null, dataType: 'number_double', isPrimaryKey: false, isNullable: false, tags: null },
              { id: 'o4', name: 'itemCount', description: null, dataType: 'integer', isPrimaryKey: false, isNullable: false, tags: null },
              { id: 'o5', name: 'orderDate', description: null, dataType: 'string_date', isPrimaryKey: false, isNullable: false, tags: null },
            ],
          },
          {
            id: 'entity-product',
            name: 'Product',
            description: 'Product in catalog',
            tags: null,
            validFrom: null,
            validTo: null,
            attributes: [
              { id: 'p1', name: 'id', description: null, dataType: 'string_uuid', isPrimaryKey: true, isNullable: false, tags: null },
              { id: 'p2', name: 'name', description: null, dataType: 'string', isPrimaryKey: false, isNullable: false, tags: null },
              { id: 'p3', name: 'price', description: null, dataType: 'number_float', isPrimaryKey: false, isNullable: false, tags: null },
              { id: 'p4', name: 'sku', description: null, dataType: 'custom_sku', isPrimaryKey: false, isNullable: false, tags: null }, // Unknown type
            ],
          },
        ],
        notes: null,
      };

      // Setup axios mock
      const axios = require('axios');
      const mockAxiosInstance = {
        get: jest.fn().mockResolvedValue({ data: mockComplexContext }),
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Setup session manager mock
      const sessionManager = require('../services/sessionManager');
      sessionManager.getOrCreateSession = jest.fn().mockReturnValue({
        sessionId: 'session-complex',
        lastActivity: new Date(),
      });
      sessionManager.updateSession = jest.fn();

      // Import the route handler
      const { computeOasGapsRouter } = require('../routes/computeOasGapsRoute');

      // Create mock request/response
      const mockReq = {
        body: {
          sessionId: 'session-complex',
          interfaceId: 'iface-complex',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const mockRes = {
        json: jsonMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      // Get the route handler
      const routeLayer = computeOasGapsRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        const gapReport = jsonMock.mock.calls[0][0];

        // Verify complex structure
        expect(gapReport.interfaceId).toBe('iface-complex');

        // Check gaps
        const gapCodes = gapReport.gaps.map((g: any) => g.code);

        // Should have 7 RESPONSES_UNDEFINED (one per endpoint)
        const responsesUndefined = gapReport.gaps.filter((g: any) => g.code === 'RESPONSES_UNDEFINED');
        expect(responsesUndefined.length).toBe(7);

        // Should have 3 REQUEST_BODY_UNDEFINED (POST, POST, PUT)
        const requestBodyUndefined = gapReport.gaps.filter((g: any) => g.code === 'REQUEST_BODY_UNDEFINED');
        expect(requestBodyUndefined.length).toBe(3);

        // Should have PATH_PARAMS_NEED_SCHEMA for endpoints with params
        const pathParamsGaps = gapReport.gaps.filter((g: any) => g.code === 'PATH_PARAMS_NEED_SCHEMA');
        expect(pathParamsGaps.length).toBe(5); // All endpoints with {userId} and/or {orderId}

        // Should have UNKNOWN_LOGICAL_TYPE_MAPPING for custom_sku
        expect(gapCodes).toContain('UNKNOWN_LOGICAL_TYPE_MAPPING');
        const unknownTypeGap = gapReport.gaps.find((g: any) => g.code === 'UNKNOWN_LOGICAL_TYPE_MAPPING');
        expect(unknownTypeGap.data.logicalType).toBe('custom_sku');

        // Verify type mappings - should have unique types only
        // Unique types from 3 entities:
        // - boolean, custom_sku, integer, number_double, number_float, string, string_date, string_date-time, string_uuid
        // Total: 9 unique types
        expect(gapReport.typeMappings.length).toBe(9);
        const mappedTypes = gapReport.typeMappings.map((m: any) => m.logicalType);
        expect(mappedTypes).toContain('boolean');
        expect(mappedTypes).toContain('custom_sku');
        expect(mappedTypes).toContain('integer');
        expect(mappedTypes).toContain('number_double');
        expect(mappedTypes).toContain('number_float');
        expect(mappedTypes).toContain('string');
        expect(mappedTypes).toContain('string_date');
        expect(mappedTypes).toContain('string_date-time');
        expect(mappedTypes).toContain('string_uuid');

        // Verify operationIds (7 endpoints x 2 styles = 14)
        expect(gapReport.operationIds.length).toBe(14);
      } else {
        fail('Route handler not found');
      }
    });
  });

  // ============================================================================
  // Test 3: Determinism test with repeated calls
  // ============================================================================
  describe('Determinism with repeated calls', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('produces identical results (except timestamp) for repeated calls with same input', async () => {
      const mockContext = {
        interface: {
          id: 'iface-determinism',
          name: 'Determinism Test API',
          description: 'API for determinism testing',
          interfaceType: 'REST_API',
          specLink: null,
          tags: null,
          validFrom: null,
          validTo: null,
        },
        service: null,
        application: null,
        endpoints: [
          {
            id: 'ep-1',
            name: 'Get Items',
            description: null,
            endpointType: 'HTTP_REST',
            pathOrAddress: '/items/{itemId}',
            protocol: 'HTTP',
            operationVerb: 'GET',
            direction: 'Inbound',
            lifecycleStatus: 'Active',
            version: null,
            tags: null,
            validFrom: null,
            validTo: null,
          },
          {
            id: 'ep-2',
            name: 'Update Item',
            description: null,
            endpointType: 'HTTP_REST',
            pathOrAddress: '/items/{itemId}',
            protocol: 'HTTP',
            operationVerb: 'PATCH',
            direction: 'Inbound',
            lifecycleStatus: 'Active',
            version: null,
            tags: null,
            validFrom: null,
            validTo: null,
          },
        ],
        logicalEntities: [
          {
            id: 'entity-item',
            name: 'Item',
            description: 'Item entity',
            tags: null,
            validFrom: null,
            validTo: null,
            attributes: [
              { id: 'a1', name: 'id', description: null, dataType: 'string_uuid', isPrimaryKey: true, isNullable: false, tags: null },
              { id: 'a2', name: 'name', description: null, dataType: 'string', isPrimaryKey: false, isNullable: false, tags: null },
              { id: 'a3', name: 'quantity', description: null, dataType: 'integer', isPrimaryKey: false, isNullable: false, tags: null },
            ],
          },
        ],
        notes: null,
      };

      // Setup axios mock - will be called multiple times
      const axios = require('axios');
      const mockAxiosInstance = {
        get: jest.fn().mockResolvedValue({ data: mockContext }),
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Setup session manager mock
      const sessionManager = require('../services/sessionManager');
      sessionManager.getOrCreateSession = jest.fn().mockReturnValue({
        sessionId: 'session-determinism',
        lastActivity: new Date(),
      });
      sessionManager.updateSession = jest.fn();

      // Import the route handler
      const { computeOasGapsRouter } = require('../routes/computeOasGapsRoute');

      // Get the route handler
      const routeLayer = computeOasGapsRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        // Make 3 calls with the same input
        const results: any[] = [];

        for (let i = 0; i < 3; i++) {
          const mockReq = {
            body: {
              sessionId: 'session-determinism',
              interfaceId: 'iface-determinism',
            },
          } as Partial<Request>;

          const jsonMock = jest.fn();
          const mockRes = {
            json: jsonMock,
          } as Partial<Response>;

          const mockNext: NextFunction = jest.fn();

          await handler(mockReq as Request, mockRes as Response, mockNext);
          results.push(jsonMock.mock.calls[0][0]);
        }

        // Compare results excluding generatedAt
        const normalize = (report: any) => ({
          interfaceId: report.interfaceId,
          gaps: report.gaps,
          defaults: report.defaults,
          typeMappings: report.typeMappings,
          operationIds: report.operationIds,
        });

        const normalized0 = normalize(results[0]);
        const normalized1 = normalize(results[1]);
        const normalized2 = normalize(results[2]);

        // All three calls should produce identical results
        expect(normalized0).toEqual(normalized1);
        expect(normalized1).toEqual(normalized2);

        // Verify gap codes are in the same order
        expect(results[0].gaps.map((g: any) => g.code)).toEqual(results[1].gaps.map((g: any) => g.code));
        expect(results[1].gaps.map((g: any) => g.code)).toEqual(results[2].gaps.map((g: any) => g.code));

        // Verify type mappings are sorted (alphabetically)
        const types = results[0].typeMappings.map((m: any) => m.logicalType);
        const sortedTypes = [...types].sort();
        expect(types).toEqual(sortedTypes);
      } else {
        fail('Route handler not found');
      }
    });
  });

  // ============================================================================
  // Test 4: Edge case - interface with no endpoints
  // ============================================================================
  describe('Edge case: interface with no endpoints', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('handles interface with no endpoints gracefully', async () => {
      const mockEmptyContext = {
        interface: {
          id: 'iface-empty',
          name: 'Empty API',
          description: 'API with no endpoints yet',
          interfaceType: 'REST_API',
          specLink: null,
          tags: null,
          validFrom: null,
          validTo: null,
        },
        service: null,
        application: null,
        endpoints: [], // No endpoints
        logicalEntities: [], // No entities
        notes: null,
      };

      // Setup axios mock
      const axios = require('axios');
      const mockAxiosInstance = {
        get: jest.fn().mockResolvedValue({ data: mockEmptyContext }),
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Setup session manager mock
      const sessionManager = require('../services/sessionManager');
      sessionManager.getOrCreateSession = jest.fn().mockReturnValue({
        sessionId: 'session-empty',
        lastActivity: new Date(),
      });
      sessionManager.updateSession = jest.fn();

      // Import the route handler
      const { computeOasGapsRouter } = require('../routes/computeOasGapsRoute');

      // Create mock request/response
      const mockReq = {
        body: {
          sessionId: 'session-empty',
          interfaceId: 'iface-empty',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const mockRes = {
        json: jsonMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      // Get the route handler
      const routeLayer = computeOasGapsRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        const gapReport = jsonMock.mock.calls[0][0];

        // Verify basic structure
        expect(gapReport.interfaceId).toBe('iface-empty');
        expect(gapReport.generatedAt).toBeDefined();

        // Should still have interface-level gaps
        const gapCodes = gapReport.gaps.map((g: any) => g.code);
        expect(gapCodes).toContain('SERVER_URL_MISSING');
        expect(gapCodes).toContain('SECURITY_NOT_SPECIFIED');
        expect(gapCodes).toContain('INFO_VERSION_DEFAULTED');

        // Should NOT have endpoint-level gaps
        expect(gapCodes).not.toContain('RESPONSES_UNDEFINED');
        expect(gapCodes).not.toContain('REQUEST_BODY_UNDEFINED');
        expect(gapCodes).not.toContain('PATH_PARAMS_NEED_SCHEMA');

        // Should only have the 3 interface-level gaps
        expect(gapReport.gaps.length).toBe(3);

        // Defaults should still be present
        expect(gapReport.defaults.length).toBe(3);
        const defaultCodes = gapReport.defaults.map((d: any) => d.code);
        expect(defaultCodes).toContain('DEFAULT_INFO_VERSION');
        expect(defaultCodes).toContain('DEFAULT_MEDIA_TYPE');
        expect(defaultCodes).toContain('SUGGESTED_SUCCESS_STATUS_BY_VERB');

        // No type mappings since no entities
        expect(gapReport.typeMappings.length).toBe(0);

        // No operationIds since no endpoints
        expect(gapReport.operationIds.length).toBe(0);
      } else {
        fail('Route handler not found');
      }
    });
  });
});
