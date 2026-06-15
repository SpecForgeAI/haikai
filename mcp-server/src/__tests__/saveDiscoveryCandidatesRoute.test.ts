import type { Request, Response, NextFunction } from 'express';

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock axios
jest.mock('axios');

// Mock sessionManager
jest.mock('../services/sessionManager');

// Mock candidateSaveBackService
jest.mock('../services/candidateSaveBackService');

describe('save_discovery_candidates_to_model Route Handler', () => {
  // ============================================================================
  // Test 1: Valid request returns 200 with structured result
  // ============================================================================
  describe('save_discovery_candidates_to_model - valid request returns 200', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns HTTP 200 with structured result { projectId, runId, entitiesCreated, entitiesSkipped, candidatesCommitted }', async () => {
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

      // Setup candidateSaveBackService mock
      const candidateSaveBackService = require('../services/candidateSaveBackService');
      const mockResponse = {
        projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        runId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
        entitiesCreated: 3,
        entitiesSkipped: 1,
        candidatesCommitted: 4,
      };
      candidateSaveBackService.saveDiscoveryCandidatesToModel = jest
        .fn()
        .mockResolvedValue(mockResponse);

      // Import the route handler
      const { saveDiscoveryCandidatesRouter } = require('../routes/saveDiscoveryCandidatesRoute');

      // Create mock request/response
      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          architectureId: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
          runId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
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
      const routeLayer = saveDiscoveryCandidatesRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify session was created
        expect(sessionManager.getOrCreateSession).toHaveBeenCalledWith('session-123');

        // Verify service was called with correct arguments
        expect(candidateSaveBackService.saveDiscoveryCandidatesToModel).toHaveBeenCalledWith(
          'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          'c3d4e5f6-a7b8-9012-cdef-123456789012',
          'b2c3d4e5-f6a7-8901-bcde-f12345678901',
          'auto'
        );

        // Verify response
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            runId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
            entitiesCreated: 3,
            entitiesSkipped: 1,
            candidatesCommitted: 4,
          })
        );

        // Verify no errors
        expect(mockNext).not.toHaveBeenCalled();
        // status should NOT have been called (200 is the default when using res.json)
        expect(statusMock).not.toHaveBeenCalled();
      } else {
        fail('Route handler not found');
      }
    });
  });

  // ============================================================================
  // Test 2: Missing sessionId returns 400
  // ============================================================================
  describe('save_discovery_candidates_to_model - missing sessionId', () => {
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
      const { saveDiscoveryCandidatesRouter } = require('../routes/saveDiscoveryCandidatesRoute');

      // Create mock request without sessionId
      const mockReq = {
        body: {
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          architectureId: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
          runId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
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
      const routeLayer = saveDiscoveryCandidatesRouter.stack.find(
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
  // Test 3: Invalid projectId (non-UUID) returns 400
  // ============================================================================
  describe('save_discovery_candidates_to_model - invalid projectId', () => {
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
      const { saveDiscoveryCandidatesRouter } = require('../routes/saveDiscoveryCandidatesRoute');

      // Create mock request with invalid projectId
      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: 'not-a-uuid',
          architectureId: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
          runId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
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
      const routeLayer = saveDiscoveryCandidatesRouter.stack.find(
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
  // Test 4: Invalid runId (non-UUID) returns 400
  // ============================================================================
  describe('save_discovery_candidates_to_model - invalid runId', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 400 Bad Request when runId is not a valid UUID', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn(),
        put: jest.fn(),
      });

      // Import the route handler
      const { saveDiscoveryCandidatesRouter } = require('../routes/saveDiscoveryCandidatesRoute');

      // Create mock request with invalid runId
      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          architectureId: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
          runId: 'not-a-uuid',
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
      const routeLayer = saveDiscoveryCandidatesRouter.stack.find(
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
              message: expect.stringContaining('runId'),
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
  // Test 5: Upstream service failure (502) returns 502 with error message
  // ============================================================================
  describe('save_discovery_candidates_to_model - upstream failure (502)', () => {
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

      // Setup candidateSaveBackService mock to throw a 502 error
      const candidateSaveBackService = require('../services/candidateSaveBackService');
      const upstreamError = new Error('Failed to fetch candidates from architecture-model-service');
      (upstreamError as any).statusCode = 502;
      candidateSaveBackService.saveDiscoveryCandidatesToModel = jest
        .fn()
        .mockRejectedValue(upstreamError);

      // Import the route handler
      const { saveDiscoveryCandidatesRouter } = require('../routes/saveDiscoveryCandidatesRoute');

      // Create mock request with all valid fields
      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          architectureId: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
          runId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
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
      const routeLayer = saveDiscoveryCandidatesRouter.stack.find(
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
              message: expect.stringContaining('Failed to fetch candidates'),
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
