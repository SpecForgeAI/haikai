import type { Request, Response, NextFunction } from 'express';

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock axios
jest.mock('axios');

// Mock sessionManager
jest.mock('../services/sessionManager');

// Mock architectureBaselineService
jest.mock('../services/architectureBaselineService');

describe('save_architecture_baseline Route Handler', () => {
  // ============================================================================
  // Test 1: Valid request returns 200 with success response shape
  // ============================================================================
  describe('save_architecture_baseline - valid request returns 200', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns HTTP 200 with success response shape (success, projectId, filename, summary, createdEntities)', async () => {
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

      // Setup architectureBaselineService mock
      const architectureBaselineService = require('../services/architectureBaselineService');
      const mockResponse = {
        success: true,
        projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        filename: 'Test Project',
        summary: {
          applications: 1,
          appComponents: 1,
          services: 2,
          interfaces: 1,
          interfaceEndpoints: 1,
          logicalDataEntities: 1,
          physicalDataEntities: 0,
          businessLogic: 0,
          dataMovements: 0,
          applicationPoints: 5,
          dataEntityPoints: 1,
          interfaceLogicalEntities: 0,
          logicalPhysicalMappings: 0,
          applicationPointBusinessLogics: 0,
        },
        createdEntities: {
          services: [
            { name: 'OrderService', id: 'svc-abc123' },
            { name: 'PaymentService', id: 'svc-def456' },
          ],
          interfaces: [{ name: 'OrderAPI', id: 'ifc-ghi789' }],
        },
      };
      architectureBaselineService.saveArchitectureBaseline = jest
        .fn()
        .mockResolvedValue(mockResponse);

      // Import the route handler
      const { saveArchitectureBaselineRouter } = require('../routes/saveArchitectureBaselineRoute');

      // Create mock request/response
      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          architectureBaselineJson: JSON.stringify({
            services: [
              { name: 'OrderService' },
              { name: 'PaymentService' },
            ],
            interfaces: [{ name: 'OrderAPI', serviceRef: 'OrderService' }],
          }),
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
      const routeLayer = saveArchitectureBaselineRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify response
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            success: true,
            projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            filename: 'Test Project',
            summary: expect.objectContaining({
              services: 2,
              interfaces: 1,
            }),
            createdEntities: expect.objectContaining({
              services: expect.arrayContaining([
                expect.objectContaining({ name: 'OrderService' }),
              ]),
            }),
          })
        );
        // Verify no errors
        expect(mockNext).not.toHaveBeenCalled();
      } else {
        fail('Route handler not found');
      }
    });
  });

  // ============================================================================
  // Test 2: Missing sessionId returns 400
  // ============================================================================
  describe('save_architecture_baseline - missing sessionId', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 400 Bad Request when sessionId is missing', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn(),
        put: jest.fn(),
      });

      // Import the route handler
      const { saveArchitectureBaselineRouter } = require('../routes/saveArchitectureBaselineRoute');

      // Create mock request without sessionId
      const mockReq = {
        body: {
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          architectureBaselineJson: '{"services":[]}',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const mockRes = {
        json: jsonMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      // Get the route handler from the router
      const routeLayer = saveArchitectureBaselineRouter.stack.find(
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
  // Test 3: Invalid projectId (non-UUID) returns 400
  // ============================================================================
  describe('save_architecture_baseline - invalid projectId', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 400 Bad Request when projectId is not a valid UUID', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn(),
        put: jest.fn(),
      });

      // Import the route handler
      const { saveArchitectureBaselineRouter } = require('../routes/saveArchitectureBaselineRoute');

      // Create mock request with invalid projectId
      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: 'not-a-uuid',
          architectureBaselineJson: '{"services":[]}',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const mockRes = {
        json: jsonMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      // Get the route handler from the router
      const routeLayer = saveArchitectureBaselineRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify error was passed to next middleware
        expect(mockNext).toHaveBeenCalled();
        const error = (mockNext as jest.Mock).mock.calls[0][0];
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain('projectId');
      } else {
        fail('Route handler not found');
      }
    });
  });

  // ============================================================================
  // Test 4: Invalid architectureBaselineJson returns 400 with validation errors
  // ============================================================================
  describe('save_architecture_baseline - invalid architectureBaselineJson', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 400 with descriptive validation errors when architectureBaselineJson has validation issues', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({
          data: [
            { id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', name: 'Test Project' },
          ],
        }),
        put: jest.fn(),
      });

      // Setup session manager mock
      const sessionManager = require('../services/sessionManager');
      sessionManager.getOrCreateSession = jest.fn().mockReturnValue({
        sessionId: 'session-123',
        lastActivity: new Date(),
      });

      // Setup architectureBaselineService mock to throw a 400 with validation errors
      const architectureBaselineService = require('../services/architectureBaselineService');
      const validationError = new Error(
        JSON.stringify({
          success: false,
          errors: [
            {
              field: 'architectureBaselineJson',
              entityType: 'root',
              entityName: '',
              message: 'Invalid JSON: Unexpected token x in JSON at position 0',
            },
          ],
        })
      );
      (validationError as any).statusCode = 400;
      architectureBaselineService.saveArchitectureBaseline = jest
        .fn()
        .mockRejectedValue(validationError);

      // Import the route handler
      const { saveArchitectureBaselineRouter } = require('../routes/saveArchitectureBaselineRoute');

      // Create mock request with invalid JSON
      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          architectureBaselineJson: 'xxx-not-valid-json',
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
      const routeLayer = saveArchitectureBaselineRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify 400 response with validation errors
        expect(statusMock).toHaveBeenCalledWith(400);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            success: false,
            errors: expect.arrayContaining([
              expect.objectContaining({
                field: 'architectureBaselineJson',
                message: expect.stringContaining('Invalid JSON'),
              }),
            ]),
          })
        );
        // Verify next was NOT called (handler responded directly)
        expect(mockNext).not.toHaveBeenCalled();
      } else {
        fail('Route handler not found');
      }
    });
  });

  // ============================================================================
  // Test 5: Upstream PUT failure results in 502 error response
  // ============================================================================
  describe('save_architecture_baseline - upstream PUT failure (502)', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns HTTP 502 when upstream PUT fails', async () => {
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

      // Setup architectureBaselineService mock to throw a 502 error
      const architectureBaselineService = require('../services/architectureBaselineService');
      const upstreamError = new Error('Failed to save model (upstream 500): Connection refused');
      (upstreamError as any).statusCode = 502;
      architectureBaselineService.saveArchitectureBaseline = jest
        .fn()
        .mockRejectedValue(upstreamError);

      // Import the route handler
      const { saveArchitectureBaselineRouter } = require('../routes/saveArchitectureBaselineRoute');

      // Create mock request/response
      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          architectureBaselineJson: JSON.stringify({
            services: [{ name: 'OrderService' }],
          }),
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
      const routeLayer = saveArchitectureBaselineRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify 502 response with error
        expect(statusMock).toHaveBeenCalledWith(502);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.objectContaining({
              code: 502,
              message: expect.stringContaining('Failed to save model'),
            }),
          })
        );
        // Verify next was NOT called (handler responded directly)
        expect(mockNext).not.toHaveBeenCalled();
      } else {
        fail('Route handler not found');
      }
    });
  });
});
