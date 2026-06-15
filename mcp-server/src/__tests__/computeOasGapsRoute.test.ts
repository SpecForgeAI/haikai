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

// Mock computeOasGaps service
jest.mock('../services/computeOasGaps');

describe('compute_oas_gaps Route Handler', () => {
  // ============================================================================
  // Test 1: Valid request returns GapReport with correct structure
  // ============================================================================
  describe('compute_oas_gaps - valid request', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns GapReport with correct structure for valid request', async () => {
      const mockContext = {
        interface: {
          id: 'iface-123',
          name: 'Test API',
          description: 'Test API description',
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
            name: 'Get Resource',
            description: null,
            endpointType: 'HTTP_REST',
            pathOrAddress: '/resources',
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
        logicalEntities: [],
        notes: null,
      };

      const mockGapReport = {
        interfaceId: 'iface-123',
        generatedAt: '2025-01-15T10:00:00.000Z',
        gaps: [
          { code: 'SERVER_URL_MISSING', severity: 'BLOCKING', message: 'No server base URL is specified for this API.' },
        ],
        defaults: [
          { code: 'DEFAULT_INFO_VERSION', value: '1.0.0', rationale: 'OpenAPI requires info.version; interface does not provide one.' },
        ],
        typeMappings: [],
        operationIds: [
          { endpointId: 'ep-1', method: 'GET', path: '/resources', style: 'camelCase', operationId: 'getResources' },
        ],
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
        sessionId: 'session-123',
        lastActivity: new Date(),
      });
      sessionManager.updateSession = jest.fn();

      // Setup computeOasGaps mock
      const computeOasGapsModule = require('../services/computeOasGaps');
      computeOasGapsModule.computeOasGaps = jest.fn().mockReturnValue(mockGapReport);

      // Import the route handler
      const { computeOasGapsRouter } = require('../routes/computeOasGapsRoute');

      // Create mock request/response
      const mockReq = {
        body: {
          sessionId: 'session-123',
          interfaceId: 'iface-123',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const mockRes = {
        json: jsonMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      // Get the route handler from the router
      const routeLayer = computeOasGapsRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify response
        expect(jsonMock).toHaveBeenCalledWith(mockGapReport);
        expect(mockGapReport.interfaceId).toBe('iface-123');
        expect(mockGapReport.gaps).toBeDefined();
        expect(mockGapReport.defaults).toBeDefined();
        expect(mockGapReport.typeMappings).toBeDefined();
        expect(mockGapReport.operationIds).toBeDefined();
        expect(mockGapReport.generatedAt).toBeDefined();
      } else {
        fail('Route handler not found');
      }
    });
  });

  // ============================================================================
  // Test 2: Missing sessionId returns 400 Bad Request
  // ============================================================================
  describe('compute_oas_gaps - missing sessionId', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 400 Bad Request when sessionId is missing', async () => {
      // Setup axios mock (won't be called due to validation)
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn(),
      });

      // Import the route handler
      const { computeOasGapsRouter } = require('../routes/computeOasGapsRoute');

      // Create mock request/response without sessionId
      const mockReq = {
        body: {
          interfaceId: 'iface-123',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const mockRes = {
        json: jsonMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      // Get the route handler from the router
      const routeLayer = computeOasGapsRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify error was passed to next middleware
        expect(mockNext).toHaveBeenCalled();
        const error = (mockNext as jest.Mock).mock.calls[0][0];
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain('sessionId');
      } else {
        fail('Route handler not found');
      }
    });

    it('returns 400 Bad Request when sessionId is empty string', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn(),
      });

      // Import the route handler
      const { computeOasGapsRouter } = require('../routes/computeOasGapsRoute');

      // Create mock request/response with empty sessionId
      const mockReq = {
        body: {
          sessionId: '   ',
          interfaceId: 'iface-123',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const mockRes = {
        json: jsonMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      // Get the route handler from the router
      const routeLayer = computeOasGapsRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify error was passed to next middleware
        expect(mockNext).toHaveBeenCalled();
        const error = (mockNext as jest.Mock).mock.calls[0][0];
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain('sessionId');
      } else {
        fail('Route handler not found');
      }
    });
  });

  // ============================================================================
  // Test 3: Missing interfaceId returns 400 Bad Request
  // ============================================================================
  describe('compute_oas_gaps - missing interfaceId', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 400 Bad Request when interfaceId is missing', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn(),
      });

      // Import the route handler
      const { computeOasGapsRouter } = require('../routes/computeOasGapsRoute');

      // Create mock request/response without interfaceId
      const mockReq = {
        body: {
          sessionId: 'session-123',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const mockRes = {
        json: jsonMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      // Get the route handler from the router
      const routeLayer = computeOasGapsRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify error was passed to next middleware
        expect(mockNext).toHaveBeenCalled();
        const error = (mockNext as jest.Mock).mock.calls[0][0];
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain('interfaceId');
      } else {
        fail('Route handler not found');
      }
    });

    it('returns 400 Bad Request when interfaceId is empty string', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn(),
      });

      // Import the route handler
      const { computeOasGapsRouter } = require('../routes/computeOasGapsRoute');

      // Create mock request/response with empty interfaceId
      const mockReq = {
        body: {
          sessionId: 'session-123',
          interfaceId: '',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const mockRes = {
        json: jsonMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      // Get the route handler from the router
      const routeLayer = computeOasGapsRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify error was passed to next middleware
        expect(mockNext).toHaveBeenCalled();
        const error = (mockNext as jest.Mock).mock.calls[0][0];
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain('interfaceId');
      } else {
        fail('Route handler not found');
      }
    });
  });

  // ============================================================================
  // Test 4: Interface not found (backend 404) returns 404 Not Found
  // ============================================================================
  describe('compute_oas_gaps - backend 404', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 404 Not Found when interface not found in backend', async () => {
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

      // Setup session manager mock
      const sessionManager = require('../services/sessionManager');
      sessionManager.getOrCreateSession = jest.fn().mockReturnValue({
        sessionId: 'session-123',
        lastActivity: new Date(),
      });

      // Import the route handler
      const { computeOasGapsRouter } = require('../routes/computeOasGapsRoute');

      // Create mock request/response
      const mockReq = {
        body: {
          sessionId: 'session-123',
          interfaceId: 'nonexistent-iface',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const mockRes = {
        json: jsonMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      // Get the route handler from the router
      const routeLayer = computeOasGapsRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify error was passed to next middleware (error handler will map to 404)
        expect(mockNext).toHaveBeenCalled();
        const error = (mockNext as jest.Mock).mock.calls[0][0];
        expect(error.isAxiosError).toBe(true);
        expect(error.response.status).toBe(404);
      } else {
        fail('Route handler not found');
      }
    });
  });

  // ============================================================================
  // Test 5: Backend 5xx returns 502 Bad Gateway
  // ============================================================================
  describe('compute_oas_gaps - backend 5xx', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 502 Bad Gateway when backend returns 500', async () => {
      // Setup axios mock to throw 500 error
      const axios = require('axios');
      const axiosError = {
        isAxiosError: true,
        message: 'Request failed with status code 500',
        response: {
          status: 500,
          data: { message: 'Internal Server Error' },
          statusText: 'Internal Server Error',
          headers: {},
          config: {},
        },
      } as AxiosError;

      const mockAxiosInstance = {
        get: jest.fn().mockRejectedValue(axiosError),
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Setup session manager mock
      const sessionManager = require('../services/sessionManager');
      sessionManager.getOrCreateSession = jest.fn().mockReturnValue({
        sessionId: 'session-123',
        lastActivity: new Date(),
      });

      // Import the route handler
      const { computeOasGapsRouter } = require('../routes/computeOasGapsRoute');

      // Create mock request/response
      const mockReq = {
        body: {
          sessionId: 'session-123',
          interfaceId: 'iface-123',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const mockRes = {
        json: jsonMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      // Get the route handler from the router
      const routeLayer = computeOasGapsRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify error was passed to next middleware (error handler will map to 502)
        expect(mockNext).toHaveBeenCalled();
        const error = (mockNext as jest.Mock).mock.calls[0][0];
        expect(error.isAxiosError).toBe(true);
        expect(error.response.status).toBe(500);
        // The errorHandler middleware will convert this to 502
      } else {
        fail('Route handler not found');
      }
    });

    it('returns 502 Bad Gateway when backend returns 503', async () => {
      // Setup axios mock to throw 503 error
      const axios = require('axios');
      const axiosError = {
        isAxiosError: true,
        message: 'Request failed with status code 503',
        response: {
          status: 503,
          data: { message: 'Service Unavailable' },
          statusText: 'Service Unavailable',
          headers: {},
          config: {},
        },
      } as AxiosError;

      const mockAxiosInstance = {
        get: jest.fn().mockRejectedValue(axiosError),
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Setup session manager mock
      const sessionManager = require('../services/sessionManager');
      sessionManager.getOrCreateSession = jest.fn().mockReturnValue({
        sessionId: 'session-123',
        lastActivity: new Date(),
      });

      // Import the route handler
      const { computeOasGapsRouter } = require('../routes/computeOasGapsRoute');

      // Create mock request/response
      const mockReq = {
        body: {
          sessionId: 'session-123',
          interfaceId: 'iface-123',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const mockRes = {
        json: jsonMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      // Get the route handler from the router
      const routeLayer = computeOasGapsRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify error was passed to next middleware (error handler will map to 502)
        expect(mockNext).toHaveBeenCalled();
        const error = (mockNext as jest.Mock).mock.calls[0][0];
        expect(error.isAxiosError).toBe(true);
        expect(error.response.status).toBe(503);
      } else {
        fail('Route handler not found');
      }
    });
  });

  // ============================================================================
  // Test 6: Session is updated with lastSelectedInterfaceId
  // ============================================================================
  describe('compute_oas_gaps - session update', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('updates session with lastSelectedInterfaceId', async () => {
      const mockContext = {
        interface: {
          id: 'iface-abc',
          name: 'Test API',
          description: null,
          interfaceType: 'REST_API',
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

      const mockGapReport = {
        interfaceId: 'iface-abc',
        generatedAt: '2025-01-15T10:00:00.000Z',
        gaps: [],
        defaults: [],
        typeMappings: [],
        operationIds: [],
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
        sessionId: 'session-xyz',
        lastActivity: new Date(),
      };
      sessionManager.getOrCreateSession = jest.fn().mockReturnValue(mockSession);
      sessionManager.updateSession = jest.fn().mockReturnValue({
        ...mockSession,
        lastSelectedInterfaceId: 'iface-abc',
      });

      // Setup computeOasGaps mock
      const computeOasGapsModule = require('../services/computeOasGaps');
      computeOasGapsModule.computeOasGaps = jest.fn().mockReturnValue(mockGapReport);

      // Import the route handler
      const { computeOasGapsRouter } = require('../routes/computeOasGapsRoute');

      // Create mock request/response
      const mockReq = {
        body: {
          sessionId: 'session-xyz',
          interfaceId: 'iface-abc',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const mockRes = {
        json: jsonMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      // Get the route handler from the router
      const routeLayer = computeOasGapsRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify session was updated with lastSelectedInterfaceId
        expect(sessionManager.updateSession).toHaveBeenCalledWith('session-xyz', {
          lastSelectedInterfaceId: 'iface-abc',
        });

        // Verify getOrCreateSession was called
        expect(sessionManager.getOrCreateSession).toHaveBeenCalledWith('session-xyz');
      } else {
        fail('Route handler not found');
      }
    });
  });
});
