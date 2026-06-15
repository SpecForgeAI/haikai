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

describe('save_oas_spec Route Handler', () => {
  // ============================================================================
  // Test 1: Valid request returns summary with created=true
  // ============================================================================
  describe('save_oas_spec - valid request (new file)', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns SaveOasSpecSummaryDto with created=true for new file', async () => {
      const mockSummary = {
        interfaceId: 'iface-123',
        interfaceName: 'Customer API',
        architectureFilename: 'my-model.json',
        format: 'yaml',
        savedPath: '/data/oas-specs/my-model/Customer-API.yml',
        specLink: '/data/oas-specs/my-model/Customer-API.yml',
        updatedAt: '2025-01-15T10:00:00.000Z',
        created: true,
      };

      // Setup axios mock
      const axios = require('axios');
      const mockAxiosInstance = {
        put: jest.fn().mockResolvedValue({ data: mockSummary, status: 201 }),
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Setup session manager mock
      const sessionManager = require('../services/sessionManager');
      sessionManager.getOrCreateSession = jest.fn().mockReturnValue({
        sessionId: 'session-123',
        lastActivity: new Date(),
      });
      sessionManager.updateSession = jest.fn();

      // Import the route handler
      const { saveOasSpecRouter } = require('../routes/saveOasSpecRoute');

      // Create mock request/response
      const mockReq = {
        body: {
          sessionId: 'session-123',
          filename: 'my-model.json',
          interfaceId: 'iface-123',
          format: 'yaml',
          oasContents: 'openapi: 3.0.3\ninfo:\n  title: Test\n  version: 1.0.0',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const statusMock = jest.fn().mockReturnThis();
      const mockRes = {
        json: jsonMock,
        status: statusMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      // Get the route handler from the router
      const routeLayer = saveOasSpecRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify response
        expect(statusMock).toHaveBeenCalledWith(201);
        expect(jsonMock).toHaveBeenCalledWith(mockSummary);
        expect(mockSummary.created).toBe(true);
      } else {
        fail('Route handler not found');
      }
    });
  });

  // ============================================================================
  // Test 2: Missing sessionId returns 400 Bad Request
  // ============================================================================
  describe('save_oas_spec - missing sessionId', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 400 Bad Request when sessionId is missing', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        put: jest.fn(),
      });

      // Import the route handler
      const { saveOasSpecRouter } = require('../routes/saveOasSpecRoute');

      // Create mock request/response without sessionId
      const mockReq = {
        body: {
          filename: 'my-model.json',
          interfaceId: 'iface-123',
          format: 'yaml',
          oasContents: 'openapi: 3.0.3',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const mockRes = {
        json: jsonMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      // Get the route handler from the router
      const routeLayer = saveOasSpecRouter.stack.find(
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
  // Test 3: Missing filename returns 400 Bad Request
  // ============================================================================
  describe('save_oas_spec - missing filename', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 400 Bad Request when filename is missing', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        put: jest.fn(),
      });

      // Import the route handler
      const { saveOasSpecRouter } = require('../routes/saveOasSpecRoute');

      // Create mock request/response without filename
      const mockReq = {
        body: {
          sessionId: 'session-123',
          interfaceId: 'iface-123',
          format: 'yaml',
          oasContents: 'openapi: 3.0.3',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const mockRes = {
        json: jsonMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      // Get the route handler from the router
      const routeLayer = saveOasSpecRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify error was passed to next middleware
        expect(mockNext).toHaveBeenCalled();
        const error = (mockNext as jest.Mock).mock.calls[0][0];
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain('filename');
      } else {
        fail('Route handler not found');
      }
    });
  });

  // ============================================================================
  // Test 4: Missing interfaceId returns 400 Bad Request
  // ============================================================================
  describe('save_oas_spec - missing interfaceId', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 400 Bad Request when interfaceId is missing', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        put: jest.fn(),
      });

      // Import the route handler
      const { saveOasSpecRouter } = require('../routes/saveOasSpecRoute');

      // Create mock request/response without interfaceId
      const mockReq = {
        body: {
          sessionId: 'session-123',
          filename: 'my-model.json',
          format: 'yaml',
          oasContents: 'openapi: 3.0.3',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const mockRes = {
        json: jsonMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      // Get the route handler from the router
      const routeLayer = saveOasSpecRouter.stack.find(
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
  // Test 5: Invalid format (not yaml/json) returns 400 Bad Request
  // ============================================================================
  describe('save_oas_spec - invalid format', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 400 Bad Request when format is not yaml or json', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        put: jest.fn(),
      });

      // Import the route handler
      const { saveOasSpecRouter } = require('../routes/saveOasSpecRoute');

      // Create mock request/response with invalid format
      const mockReq = {
        body: {
          sessionId: 'session-123',
          filename: 'my-model.json',
          interfaceId: 'iface-123',
          format: 'xml',
          oasContents: 'openapi: 3.0.3',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const mockRes = {
        json: jsonMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      // Get the route handler from the router
      const routeLayer = saveOasSpecRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify error was passed to next middleware
        expect(mockNext).toHaveBeenCalled();
        const error = (mockNext as jest.Mock).mock.calls[0][0];
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain("'yaml' or 'json'");
      } else {
        fail('Route handler not found');
      }
    });
  });

  // ============================================================================
  // Test 6: Backend 404 response is forwarded as 404
  // ============================================================================
  describe('save_oas_spec - backend 404', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 404 Not Found when backend returns 404', async () => {
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
        put: jest.fn().mockRejectedValue(axiosError),
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Setup session manager mock
      const sessionManager = require('../services/sessionManager');
      sessionManager.getOrCreateSession = jest.fn().mockReturnValue({
        sessionId: 'session-123',
        lastActivity: new Date(),
      });

      // Import the route handler
      const { saveOasSpecRouter } = require('../routes/saveOasSpecRoute');

      // Create mock request/response
      const mockReq = {
        body: {
          sessionId: 'session-123',
          filename: 'my-model.json',
          interfaceId: 'nonexistent-iface',
          format: 'yaml',
          oasContents: 'openapi: 3.0.3',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const mockRes = {
        json: jsonMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      // Get the route handler from the router
      const routeLayer = saveOasSpecRouter.stack.find(
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
  // Test 7: Backend 500 response returns 502 Bad Gateway
  // ============================================================================
  describe('save_oas_spec - backend 500', () => {
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
        put: jest.fn().mockRejectedValue(axiosError),
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Setup session manager mock
      const sessionManager = require('../services/sessionManager');
      sessionManager.getOrCreateSession = jest.fn().mockReturnValue({
        sessionId: 'session-123',
        lastActivity: new Date(),
      });

      // Import the route handler
      const { saveOasSpecRouter } = require('../routes/saveOasSpecRoute');

      // Create mock request/response
      const mockReq = {
        body: {
          sessionId: 'session-123',
          filename: 'my-model.json',
          interfaceId: 'iface-123',
          format: 'yaml',
          oasContents: 'openapi: 3.0.3',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const mockRes = {
        json: jsonMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      // Get the route handler from the router
      const routeLayer = saveOasSpecRouter.stack.find(
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
  });

  // ============================================================================
  // Test 8: Session is updated with filename and lastSelectedInterfaceId
  // ============================================================================
  describe('save_oas_spec - session update', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('updates session with filename and lastSelectedInterfaceId', async () => {
      const mockSummary = {
        interfaceId: 'iface-abc',
        interfaceName: 'Test API',
        architectureFilename: 'test-model.json',
        format: 'json',
        savedPath: '/data/oas-specs/test-model/Test-API.json',
        specLink: '/data/oas-specs/test-model/Test-API.json',
        updatedAt: '2025-01-15T10:00:00.000Z',
        created: false,
      };

      // Setup axios mock
      const axios = require('axios');
      const mockAxiosInstance = {
        put: jest.fn().mockResolvedValue({ data: mockSummary, status: 200 }),
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
        filename: 'test-model.json',
        lastSelectedInterfaceId: 'iface-abc',
      });

      // Import the route handler
      const { saveOasSpecRouter } = require('../routes/saveOasSpecRoute');

      // Create mock request/response
      const mockReq = {
        body: {
          sessionId: 'session-xyz',
          filename: 'test-model.json',
          interfaceId: 'iface-abc',
          format: 'JSON', // Test case-insensitivity
          oasContents: '{"openapi": "3.0.3"}',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const statusMock = jest.fn().mockReturnThis();
      const mockRes = {
        json: jsonMock,
        status: statusMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      // Get the route handler from the router
      const routeLayer = saveOasSpecRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify session was updated with filename and lastSelectedInterfaceId
        expect(sessionManager.updateSession).toHaveBeenCalledWith('session-xyz', {
          filename: 'test-model.json',
          lastSelectedInterfaceId: 'iface-abc',
        });

        // Verify getOrCreateSession was called
        expect(sessionManager.getOrCreateSession).toHaveBeenCalledWith('session-xyz');

        // Verify response was returned (created=false means 200)
        expect(statusMock).toHaveBeenCalledWith(200);
        expect(jsonMock).toHaveBeenCalledWith(mockSummary);
      } else {
        fail('Route handler not found');
      }
    });
  });
});
