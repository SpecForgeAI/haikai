import type { Request, Response, NextFunction } from 'express';

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock axios
jest.mock('axios');

// Mock sessionManager
jest.mock('../services/sessionManager');

// Mock roadmapStructureService
jest.mock('../services/roadmapStructureService');

describe('saveRoadmapStructureRoute', () => {
  // ==========================================================================
  // Test 1: 400 when sessionId is missing
  // ==========================================================================
  describe('missing sessionId', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 400 when sessionId is missing or empty', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn(),
        post: jest.fn(),
        put: jest.fn(),
      });

      // Import the route handler
      const { saveRoadmapStructureRouter } = require('../routes/saveRoadmapStructureRoute');

      const mockReq = {
        body: {
          projectId: '550e8400-e29b-41d4-a716-446655440000',
          roadmapJson: '{"initiatives":[{"title":"Init 1"}]}',
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
      const routeLayer = saveRoadmapStructureRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Route handler catches the 400 error and returns structured response
        expect(statusMock).toHaveBeenCalledWith(400);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.objectContaining({
              code: 400,
              message: expect.stringContaining('sessionId'),
            }),
          })
        );
      } else {
        fail('Route handler not found');
      }
    });
  });

  // ==========================================================================
  // Test 2: 400 when projectId is not UUID v4
  // ==========================================================================
  describe('invalid projectId', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 400 when projectId is not a valid UUID', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn(),
        post: jest.fn(),
        put: jest.fn(),
      });

      // Import the route handler
      const { saveRoadmapStructureRouter } = require('../routes/saveRoadmapStructureRoute');

      const mockReq = {
        body: {
          sessionId: 'test-session',
          projectId: 'not-a-uuid',
          roadmapJson: '{"initiatives":[{"title":"Init 1"}]}',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const statusMock = jest.fn().mockReturnThis();
      const mockRes = {
        json: jsonMock,
        status: statusMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      const routeLayer = saveRoadmapStructureRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.objectContaining({
              code: 400,
              message: expect.stringContaining('projectId'),
            }),
          })
        );
      } else {
        fail('Route handler not found');
      }
    });
  });

  // ==========================================================================
  // Test 3: 400 when roadmapJson is missing
  // ==========================================================================
  describe('missing roadmapJson', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 400 when roadmapJson is missing or empty', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn(),
        post: jest.fn(),
        put: jest.fn(),
      });

      // Import the route handler
      const { saveRoadmapStructureRouter } = require('../routes/saveRoadmapStructureRoute');

      const mockReq = {
        body: {
          sessionId: 'test-session',
          projectId: '550e8400-e29b-41d4-a716-446655440000',
          roadmapJson: '',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const statusMock = jest.fn().mockReturnThis();
      const mockRes = {
        json: jsonMock,
        status: statusMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      const routeLayer = saveRoadmapStructureRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.objectContaining({
              code: 400,
              message: expect.stringContaining('roadmapJson'),
            }),
          })
        );
      } else {
        fail('Route handler not found');
      }
    });
  });

  // ==========================================================================
  // Test 4: 200 on success
  // ==========================================================================
  describe('successful request', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 200 with service result on success', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn(),
        post: jest.fn(),
        put: jest.fn(),
      });

      // Setup session manager mock
      const sessionManager = require('../services/sessionManager');
      sessionManager.getOrCreateSession = jest.fn().mockReturnValue({
        sessionId: 'test-session',
        lastActivity: new Date(),
      });

      // Setup roadmapStructureService mock
      const roadmapStructureService = require('../services/roadmapStructureService');
      const mockResult = {
        createdInitiatives: 2,
        updatedInitiatives: 0,
        createdEpics: 3,
        updatedEpics: 0,
        warnings: [],
      };
      roadmapStructureService.saveRoadmapStructure = jest.fn().mockResolvedValue(mockResult);

      // Import the route handler
      const { saveRoadmapStructureRouter } = require('../routes/saveRoadmapStructureRoute');

      const mockReq = {
        body: {
          sessionId: 'test-session',
          projectId: '550e8400-e29b-41d4-a716-446655440000',
          roadmapJson: '{"initiatives":[{"title":"Init 1"}]}',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const statusMock = jest.fn().mockReturnThis();
      const mockRes = {
        json: jsonMock,
        status: statusMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      const routeLayer = saveRoadmapStructureRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        expect(jsonMock).toHaveBeenCalledWith(mockResult);
        expect(mockNext).not.toHaveBeenCalled();
        expect(roadmapStructureService.saveRoadmapStructure).toHaveBeenCalledWith(
          '550e8400-e29b-41d4-a716-446655440000',
          '{"initiatives":[{"title":"Init 1"}]}'
        );
      } else {
        fail('Route handler not found');
      }
    });
  });

  // ==========================================================================
  // Test 5: 502 when service throws upstream failure
  // ==========================================================================
  describe('upstream failure (502)', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 502 when service throws upstream failure', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn(),
        post: jest.fn(),
        put: jest.fn(),
      });

      // Setup session manager mock
      const sessionManager = require('../services/sessionManager');
      sessionManager.getOrCreateSession = jest.fn().mockReturnValue({
        sessionId: 'test-session',
        lastActivity: new Date(),
      });

      // Setup roadmapStructureService mock to throw 502
      const roadmapStructureService = require('../services/roadmapStructureService');
      const upstreamError = new Error('Failed to fetch existing work items: Connection refused');
      (upstreamError as any).statusCode = 502;
      roadmapStructureService.saveRoadmapStructure = jest.fn().mockRejectedValue(upstreamError);

      // Import the route handler
      const { saveRoadmapStructureRouter } = require('../routes/saveRoadmapStructureRoute');

      const mockReq = {
        body: {
          sessionId: 'test-session',
          projectId: '550e8400-e29b-41d4-a716-446655440000',
          roadmapJson: '{"initiatives":[{"title":"Init 1"}]}',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const statusMock = jest.fn().mockReturnThis();
      const mockRes = {
        json: jsonMock,
        status: statusMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      const routeLayer = saveRoadmapStructureRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(502);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.objectContaining({
              code: 502,
              message: expect.stringContaining('Failed to fetch existing work items'),
            }),
          })
        );
        expect(mockNext).not.toHaveBeenCalled();
      } else {
        fail('Route handler not found');
      }
    });
  });
});
