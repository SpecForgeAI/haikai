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

describe('MCP Server Tools', () => {
  // ============================================================================
  // Test 1: list_interfaces calls backend and returns interfaces
  // ============================================================================
  describe('list_interfaces - backend call and response', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('calls backend and returns interfaces', async () => {
      const mockInterfaces = [
        {
          interfaceId: 'iface-1',
          interfaceName: 'User API',
          interfaceType: 'REST',
          serviceId: 'svc-1',
          serviceName: 'User Service',
          applicationId: 'app-1',
          applicationName: 'Main App',
          endpointCount: 5,
        },
        {
          interfaceId: 'iface-2',
          interfaceName: 'Order API',
          interfaceType: 'REST',
          serviceId: 'svc-2',
          serviceName: 'Order Service',
          applicationId: 'app-1',
          applicationName: 'Main App',
          endpointCount: 3,
        },
      ];

      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({ data: mockInterfaces }),
      });

      // Setup session manager mock
      const sessionManager = require('../services/sessionManager');
      sessionManager.getOrCreateSession = jest.fn().mockReturnValue({
        sessionId: 'session-123',
        lastActivity: new Date(),
      });
      sessionManager.updateSession = jest.fn();

      // Import the client and test
      const { archModelClient } = require('../services/archModelClient');

      const result = await archModelClient.listInterfaces('test-model.json');

      expect(result).toEqual(mockInterfaces);
      expect(result).toHaveLength(2);
      expect(result[0].interfaceId).toBe('iface-1');
      expect(result[1].interfaceName).toBe('Order API');
    });
  });

  // ============================================================================
  // Test 2: list_interfaces stores filename in session
  // ============================================================================
  describe('list_interfaces - session update', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('stores filename in session', async () => {
      const mockInterfaces = [
        {
          interfaceId: 'iface-1',
          interfaceName: 'Test API',
          interfaceType: 'REST',
          serviceId: null,
          serviceName: null,
          applicationId: null,
          applicationName: null,
          endpointCount: 1,
        },
      ];

      // Setup axios mock
      const axios = require('axios');
      const mockAxiosInstance = {
        get: jest.fn().mockResolvedValue({ data: mockInterfaces }),
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Setup session manager mock
      const sessionManager = require('../services/sessionManager');
      const mockSession = {
        sessionId: 'session-456',
        lastActivity: new Date(),
      };
      sessionManager.getOrCreateSession = jest.fn().mockReturnValue(mockSession);
      sessionManager.updateSession = jest.fn().mockReturnValue({
        ...mockSession,
        filename: 'my-model.json',
        lastListedInterfaces: mockInterfaces,
      });

      // Import route handler and create mock request/response
      const express = require('express');
      const { toolsRouter } = require('../routes/tools');

      // Create a mock Express app to test the route
      const mockReq = {
        body: {
          sessionId: 'session-456',
          filename: 'my-model.json',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const statusMock = jest.fn().mockReturnValue({ json: jsonMock });
      const mockRes = {
        json: jsonMock,
        status: statusMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      // Get the route handler from the router
      const routeLayer = toolsRouter.stack.find(
        (layer: any) => layer.route?.path === '/list_interfaces'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify session was updated with filename
        expect(sessionManager.updateSession).toHaveBeenCalledWith('session-456', {
          filename: 'my-model.json',
          lastListedInterfaces: mockInterfaces,
        });
      } else {
        fail('Route handler not found');
      }
    });
  });

  // ============================================================================
  // Test 3: list_interfaces handles backend 404 error
  // ============================================================================
  describe('list_interfaces - error handling', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('handles backend 404 error', async () => {
      // Setup axios mock to throw 404 error
      const axios = require('axios');
      const axiosError = {
        isAxiosError: true,
        message: 'Request failed with status code 404',
        response: {
          status: 404,
          data: { message: 'Model file not found' },
          statusText: 'Not Found',
          headers: {},
          config: {},
        },
      } as AxiosError;

      const mockAxiosInstance = {
        get: jest.fn().mockRejectedValue(axiosError),
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Import the client and test
      const { archModelClient } = require('../services/archModelClient');

      await expect(archModelClient.listInterfaces('nonexistent.json'))
        .rejects
        .toMatchObject({
          isAxiosError: true,
          response: {
            status: 404,
          },
        });
    });
  });

  // ============================================================================
  // Test 4: get_interface_oas_context calls backend and returns context
  // ============================================================================
  describe('get_interface_oas_context - backend call and response', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('calls backend and returns context', async () => {
      const mockContext = {
        interface: {
          id: 'iface-1',
          name: 'User API',
          description: 'User management API',
          interfaceType: 'REST',
          specLink: null,
          tags: 'user,api',
          validFrom: null,
          validTo: null,
        },
        service: {
          id: 'svc-1',
          name: 'User Service',
          description: 'Handles user operations',
          serviceType: 'Backend',
          tags: 'core',
        },
        application: {
          id: 'app-1',
          name: 'Main App',
          description: 'Primary application',
          appType: 'Web',
          status: 'Active',
          tags: null,
        },
        endpoints: [
          {
            id: 'ep-1',
            name: 'Get User',
            description: 'Retrieve user by ID',
            endpointType: 'REST',
            pathOrAddress: '/users/{id}',
            protocol: 'HTTP',
            operationVerb: 'GET',
            direction: 'Inbound',
            lifecycleStatus: 'Active',
            version: '1.0',
            tags: null,
            validFrom: null,
            validTo: null,
          },
        ],
        logicalEntities: [
          {
            id: 'entity-1',
            name: 'User',
            description: 'User entity',
            tags: null,
            validFrom: null,
            validTo: null,
            attributes: [
              {
                id: 'attr-1',
                name: 'id',
                description: 'User ID',
                dataType: 'UUID',
                isPrimaryKey: true,
                isNullable: false,
                tags: null,
              },
              {
                id: 'attr-2',
                name: 'email',
                description: 'User email',
                dataType: 'String',
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
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({ data: mockContext }),
      });

      // Import the client and test
      const { archModelClient } = require('../services/archModelClient');

      const result = await archModelClient.getInterfaceOasContext('iface-1');

      expect(result).toEqual(mockContext);
      expect(result.interface.id).toBe('iface-1');
      expect(result.interface.name).toBe('User API');
      expect(result.endpoints).toHaveLength(1);
      expect(result.logicalEntities).toHaveLength(1);
      expect(result.logicalEntities[0].attributes).toHaveLength(2);
    });
  });

  // ============================================================================
  // Test 5: get_interface_oas_context stores lastSelectedInterfaceId in session
  // ============================================================================
  describe('get_interface_oas_context - session update', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('stores lastSelectedInterfaceId in session', async () => {
      const mockContext = {
        interface: {
          id: 'iface-abc',
          name: 'Test API',
          description: null,
          interfaceType: 'REST',
          specLink: null,
          tags: null,
          validFrom: null,
          validTo: null,
        },
        service: null,
        application: null,
        endpoints: [],
        logicalEntities: [],
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
      const mockSession = {
        sessionId: 'session-789',
        lastActivity: new Date(),
      };
      sessionManager.getOrCreateSession = jest.fn().mockReturnValue(mockSession);
      sessionManager.updateSession = jest.fn().mockReturnValue({
        ...mockSession,
        lastSelectedInterfaceId: 'iface-abc',
      });

      // Import route handler
      const { toolsRouter } = require('../routes/tools');

      // Create mock request/response
      const mockReq = {
        body: {
          sessionId: 'session-789',
          interfaceId: 'iface-abc',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const statusMock = jest.fn().mockReturnValue({ json: jsonMock });
      const mockRes = {
        json: jsonMock,
        status: statusMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      // Get the route handler from the router
      const routeLayer = toolsRouter.stack.find(
        (layer: any) => layer.route?.path === '/get_interface_oas_context'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify session was updated with lastSelectedInterfaceId
        expect(sessionManager.updateSession).toHaveBeenCalledWith('session-789', {
          lastSelectedInterfaceId: 'iface-abc',
        });
      } else {
        fail('Route handler not found');
      }
    });
  });

  // ============================================================================
  // Test 6: get_interface_oas_context handles backend 404 error
  // ============================================================================
  describe('get_interface_oas_context - error handling', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('handles backend 404 error', async () => {
      // Setup axios mock to throw 404 error
      const axios = require('axios');
      const axiosError = {
        isAxiosError: true,
        message: 'Request failed with status code 404',
        response: {
          status: 404,
          data: { message: 'Interface not found' },
          statusText: 'Not Found',
          headers: {},
          config: {},
        },
      } as AxiosError;

      const mockAxiosInstance = {
        get: jest.fn().mockRejectedValue(axiosError),
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Import the client and test
      const { archModelClient } = require('../services/archModelClient');

      await expect(archModelClient.getInterfaceOasContext('nonexistent-iface'))
        .rejects
        .toMatchObject({
          isAxiosError: true,
          response: {
            status: 404,
          },
        });
    });
  });
});
