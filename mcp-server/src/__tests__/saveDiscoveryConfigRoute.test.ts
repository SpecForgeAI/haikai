import type { Request, Response, NextFunction } from 'express';

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock axios
jest.mock('axios');

// Mock sessionManager
jest.mock('../services/sessionManager');

// Mock discoveryConfigService
jest.mock('../services/discoveryConfigService');

describe('saveDiscoveryConfig Route Handler', () => {
  // ============================================================================
  // Test 1: Route handler returns 400 when sessionId is missing or empty
  // ============================================================================
  describe('save_discovery_config - missing sessionId', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 400 when sessionId is missing', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn(),
        put: jest.fn(),
      });

      // Import the route handler
      const { saveDiscoveryConfigRouter } = require('../routes/saveDiscoveryConfigRoute');

      // Create mock request without sessionId
      const mockReq = {
        body: {
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          discoveryConfigJson: '{"repos":[],"techHints":[]}',
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
      const routeLayer = saveDiscoveryConfigRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify 400 response
        expect(statusMock).toHaveBeenCalledWith(400);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.objectContaining({
              code: 400,
              message: expect.stringContaining('sessionId'),
            }),
          })
        );
        expect(mockNext).not.toHaveBeenCalled();
      } else {
        fail('Route handler not found');
      }
    });
  });

  // ============================================================================
  // Test 2: Route handler returns 400 when projectId is not a valid UUID
  // ============================================================================
  describe('save_discovery_config - invalid projectId', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 400 when projectId is not a valid UUID', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn(),
        put: jest.fn(),
      });

      // Import the route handler
      const { saveDiscoveryConfigRouter } = require('../routes/saveDiscoveryConfigRoute');

      // Create mock request with invalid projectId
      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: 'not-a-uuid',
          discoveryConfigJson: '{"repos":[],"techHints":[]}',
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
      const routeLayer = saveDiscoveryConfigRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify 400 response
        expect(statusMock).toHaveBeenCalledWith(400);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.objectContaining({
              code: 400,
              message: expect.stringContaining('projectId'),
            }),
          })
        );
        expect(mockNext).not.toHaveBeenCalled();
      } else {
        fail('Route handler not found');
      }
    });
  });

  // ============================================================================
  // Test 3: Route handler returns 400 when discoveryConfigJson is empty
  // ============================================================================
  describe('save_discovery_config - empty discoveryConfigJson', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 400 when discoveryConfigJson is an empty string', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn(),
        put: jest.fn(),
      });

      // Import the route handler
      const { saveDiscoveryConfigRouter } = require('../routes/saveDiscoveryConfigRoute');

      // Create mock request with empty discoveryConfigJson
      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          discoveryConfigJson: '',
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
      const routeLayer = saveDiscoveryConfigRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify 400 response
        expect(statusMock).toHaveBeenCalledWith(400);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.objectContaining({
              code: 400,
              message: expect.stringContaining('discoveryConfigJson'),
            }),
          })
        );
        expect(mockNext).not.toHaveBeenCalled();
      } else {
        fail('Route handler not found');
      }
    });
  });

  // ============================================================================
  // Test 4: Route handler returns 200 with { projectId, status } for valid request
  // ============================================================================
  describe('save_discovery_config - valid request', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 200 with { projectId, status } for a complete valid request', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn(),
        put: jest.fn(),
      });

      // Setup session manager mock
      const sessionManager = require('../services/sessionManager');
      sessionManager.getOrCreateSession = jest.fn().mockReturnValue({
        sessionId: 'session-123',
        lastActivity: new Date(),
      });

      // Setup service mock to return a successful result
      const service = require('../services/discoveryConfigService');
      service.saveDiscoveryConfig = jest.fn().mockResolvedValue({
        projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        status: 'DRAFT',
      });

      // Import the route handler
      const { saveDiscoveryConfigRouter } = require('../routes/saveDiscoveryConfigRoute');

      const validConfig = {
        repos: [{ url: 'https://github.com/example/repo', branch: 'main' }],
        techHints: [{ language: 'Java' }],
      };

      // Create mock request with all valid fields
      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          discoveryConfigJson: JSON.stringify(validConfig),
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
      const routeLayer = saveDiscoveryConfigRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify session was created
        expect(sessionManager.getOrCreateSession).toHaveBeenCalledWith('session-123');

        // Verify service was called with correct arguments
        expect(service.saveDiscoveryConfig).toHaveBeenCalledWith(
          'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          JSON.stringify(validConfig)
        );

        // Verify successful response
        expect(jsonMock).toHaveBeenCalledWith({
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          status: 'DRAFT',
        });

        // Verify no error handling was triggered
        expect(mockNext).not.toHaveBeenCalled();
        // status should NOT have been called (200 is the default when using res.json)
        expect(statusMock).not.toHaveBeenCalled();
      } else {
        fail('Route handler not found');
      }
    });
  });

  // ============================================================================
  // Gap Test 4 (Task Group 7): Route returns 502 on upstream failure
  // ============================================================================
  describe('save_discovery_config - upstream failure (502)', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 502 when service throws a 502 upstream error', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn(),
        put: jest.fn(),
      });

      // Setup session manager mock
      const sessionManager = require('../services/sessionManager');
      sessionManager.getOrCreateSession = jest.fn().mockReturnValue({
        sessionId: 'session-123',
        lastActivity: new Date(),
      });

      // Setup service mock to throw a 502 error (simulating upstream failure)
      const service = require('../services/discoveryConfigService');
      const upstreamError = new Error('Backend service unavailable');
      (upstreamError as any).statusCode = 502;
      service.saveDiscoveryConfig = jest.fn().mockRejectedValue(upstreamError);

      // Import the route handler
      const { saveDiscoveryConfigRouter } = require('../routes/saveDiscoveryConfigRoute');

      const validConfig = {
        repos: [{ url: 'https://github.com/example/repo', branch: 'main' }],
      };

      // Create mock request with all valid fields
      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          discoveryConfigJson: JSON.stringify(validConfig),
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
      const routeLayer = saveDiscoveryConfigRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify 502 response
        expect(statusMock).toHaveBeenCalledWith(502);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.objectContaining({
              code: 502,
              message: expect.stringContaining('Backend service unavailable'),
            }),
          })
        );

        // Verify next was NOT called (error was handled in the route)
        expect(mockNext).not.toHaveBeenCalled();
      } else {
        fail('Route handler not found');
      }
    });
  });
});
