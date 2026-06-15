/**
 * Unit tests for saveUserJourneysRoute.ts and tool registration
 *
 * Tests cover: route validation for sessionId, projectId, userJourneysJson,
 * and route export verification.
 */

import type { Request, Response, NextFunction } from 'express';

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock axios
jest.mock('axios');

// Mock sessionManager
jest.mock('../services/sessionManager');

// Mock userJourneysService
jest.mock('../services/userJourneysService');

describe('save_user_journeys Route Handler', () => {
  // ============================================================================
  // Test 1: Route rejects request with missing/empty sessionId (400)
  // ============================================================================

  describe('missing sessionId', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 400 Bad Request when sessionId is missing', async () => {
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn(),
        put: jest.fn(),
      });

      const { saveUserJourneysRouter } = require('../routes/saveUserJourneysRoute');

      const mockReq = {
        body: {
          sessionId: '',
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          userJourneysJson: '{"user_journeys":[{"name":"Journey"}]}',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const mockRes = {
        json: jsonMock,
        status: jest.fn().mockReturnThis(),
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      const routeLayer = saveUserJourneysRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

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
  // Test 2: Route rejects request with invalid projectId (non-UUID) (400)
  // ============================================================================

  describe('invalid projectId', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 400 Bad Request when projectId is not a valid UUID', async () => {
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn(),
        put: jest.fn(),
      });

      const { saveUserJourneysRouter } = require('../routes/saveUserJourneysRoute');

      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: 'not-a-uuid',
          userJourneysJson: '{"user_journeys":[{"name":"Journey"}]}',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const mockRes = {
        json: jsonMock,
        status: jest.fn().mockReturnThis(),
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      const routeLayer = saveUserJourneysRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

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
  // Test 3: Route rejects request with missing/empty userJourneysJson (400)
  // ============================================================================

  describe('missing userJourneysJson', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 400 Bad Request when userJourneysJson is empty', async () => {
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn(),
        put: jest.fn(),
      });

      const { saveUserJourneysRouter } = require('../routes/saveUserJourneysRoute');

      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          userJourneysJson: '',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const mockRes = {
        json: jsonMock,
        status: jest.fn().mockReturnThis(),
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      const routeLayer = saveUserJourneysRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
        const error = (mockNext as jest.Mock).mock.calls[0][0];
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain('userJourneysJson');
      } else {
        fail('Route handler not found');
      }
    });
  });
});

// ============================================================================
// Test 4: Route exports and has correct structure
// ============================================================================

describe('save_user_journeys route structure', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('exports a Router with a POST / handler', () => {
    const axios = require('axios');
    axios.create = jest.fn().mockReturnValue({
      get: jest.fn(),
      put: jest.fn(),
    });

    const { saveUserJourneysRouter } = require('../routes/saveUserJourneysRoute');
    expect(saveUserJourneysRouter).toBeDefined();

    const routes = saveUserJourneysRouter.stack;
    expect(routes.length).toBeGreaterThan(0);
    expect(routes[0].route.path).toBe('/');
    expect(routes[0].route.methods.post).toBe(true);
  });
});
