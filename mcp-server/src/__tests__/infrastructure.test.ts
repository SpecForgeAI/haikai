import { AxiosError } from 'axios';
import type { Request, Response, NextFunction } from 'express';

// Mock dotenv before importing config
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

describe('MCP Server Infrastructure', () => {
  // ============================================================================
  // Test 1: Config loads environment variables correctly
  // ============================================================================
  describe('config', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      jest.resetModules();
      process.env = { ...originalEnv };
    });

    afterAll(() => {
      process.env = originalEnv;
    });

    it('loads environment variables correctly', () => {
      // Set custom environment values
      process.env.ARCH_MODEL_SERVICE_BASE_URL = 'http://custom-backend:9000';
      process.env.MCP_SESSION_TTL_MINUTES = '60';
      process.env.PORT = '3000';

      // Re-import config to pick up new env values
      const {
        ARCH_MODEL_SERVICE_BASE_URL,
        MCP_SESSION_TTL_MINUTES,
        PORT,
      } = require('../config');

      expect(ARCH_MODEL_SERVICE_BASE_URL).toBe('http://custom-backend:9000');
      expect(MCP_SESSION_TTL_MINUTES).toBe(60);
      expect(PORT).toBe(3000);
    });

    it('uses default values when environment variables are not set', () => {
      // Clear relevant environment variables
      delete process.env.ARCH_MODEL_SERVICE_BASE_URL;
      delete process.env.MCP_SESSION_TTL_MINUTES;
      delete process.env.PORT;

      // Re-import config to pick up defaults
      const {
        ARCH_MODEL_SERVICE_BASE_URL,
        MCP_SESSION_TTL_MINUTES,
        PORT,
      } = require('../config');

      expect(ARCH_MODEL_SERVICE_BASE_URL).toBe('http://localhost:8080');
      expect(MCP_SESSION_TTL_MINUTES).toBe(30);
      expect(PORT).toBe(8090);
    });
  });

  // ============================================================================
  // Test 2: sessionManager creates new session on first access
  // ============================================================================
  describe('sessionManager - session creation', () => {
    beforeEach(() => {
      jest.resetModules();
    });

    it('creates new session on first access', () => {
      const {
        getOrCreateSession,
        getSession,
        clearAllSessions,
      } = require('../services/sessionManager');

      // Ensure clean state
      clearAllSessions();

      const sessionId = 'test-session-123';

      // Session should not exist initially
      expect(getSession(sessionId)).toBeUndefined();

      // Create session
      const session = getOrCreateSession(sessionId);

      expect(session).toBeDefined();
      expect(session.sessionId).toBe(sessionId);
      expect(session.lastActivity).toBeInstanceOf(Date);
      expect(session.filename).toBeUndefined();
      expect(session.lastListedInterfaces).toBeUndefined();
      expect(session.lastSelectedInterfaceId).toBeUndefined();

      // Session should now exist
      expect(getSession(sessionId)).toBeDefined();

      // Calling again should return the same session
      const session2 = getOrCreateSession(sessionId);
      expect(session2.sessionId).toBe(session.sessionId);

      // Clean up
      clearAllSessions();
    });

    it('updates lastActivity on subsequent access', () => {
      const {
        getOrCreateSession,
        clearAllSessions,
      } = require('../services/sessionManager');

      clearAllSessions();

      const sessionId = 'test-session-456';
      const session1 = getOrCreateSession(sessionId);
      const firstActivity = session1.lastActivity.getTime();

      // Wait a small amount of time
      const delay = 10; // 10ms
      const startTime = Date.now();
      while (Date.now() - startTime < delay) {
        // Busy wait
      }

      const session2 = getOrCreateSession(sessionId);
      const secondActivity = session2.lastActivity.getTime();

      expect(secondActivity).toBeGreaterThanOrEqual(firstActivity);

      clearAllSessions();
    });
  });

  // ============================================================================
  // Test 3: sessionManager expires sessions after TTL
  // ============================================================================
  describe('sessionManager - session expiration', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      jest.resetModules();
      process.env = { ...originalEnv };
    });

    afterAll(() => {
      process.env = originalEnv;
    });

    it('expires sessions after TTL', () => {
      // Set TTL to 1 minute for testing
      process.env.MCP_SESSION_TTL_MINUTES = '1';

      const {
        getOrCreateSession,
        cleanupExpiredSessions,
        getSession,
        getSessionCount,
        clearAllSessions,
      } = require('../services/sessionManager');

      clearAllSessions();

      // Create a session
      const sessionId = 'expiring-session';
      const session = getOrCreateSession(sessionId);

      expect(getSessionCount()).toBe(1);

      // Manually set lastActivity to 2 minutes ago
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
      session.lastActivity = twoMinutesAgo;

      // Run cleanup
      const removedCount = cleanupExpiredSessions();

      expect(removedCount).toBe(1);
      expect(getSessionCount()).toBe(0);
      expect(getSession(sessionId)).toBeUndefined();

      clearAllSessions();
    });

    it('does not expire sessions within TTL', () => {
      // Set TTL to 30 minutes for testing
      process.env.MCP_SESSION_TTL_MINUTES = '30';

      const {
        getOrCreateSession,
        cleanupExpiredSessions,
        getSession,
        getSessionCount,
        clearAllSessions,
      } = require('../services/sessionManager');

      clearAllSessions();

      // Create a session (lastActivity is now)
      const sessionId = 'active-session';
      getOrCreateSession(sessionId);

      expect(getSessionCount()).toBe(1);

      // Run cleanup
      const removedCount = cleanupExpiredSessions();

      expect(removedCount).toBe(0);
      expect(getSessionCount()).toBe(1);
      expect(getSession(sessionId)).toBeDefined();

      clearAllSessions();
    });
  });

  // ============================================================================
  // Test 4: errorHandler maps backend errors correctly
  // ============================================================================
  describe('errorHandler - error mapping', () => {
    // Import errorHandler directly since it doesn't depend on environment
    const { errorHandler, createHttpError } = require('../middleware/errorHandler');

    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let mockNext: jest.MockedFunction<NextFunction>;
    let jsonMock: jest.Mock;
    let statusMock: jest.Mock;

    beforeEach(() => {
      jsonMock = jest.fn();
      statusMock = jest.fn().mockReturnValue({ json: jsonMock });

      mockReq = {};
      mockRes = {
        status: statusMock,
        headersSent: false,
      };
      mockNext = jest.fn();
    });

    it('passes through 400 Bad Request from backend', () => {
      const axiosError = createAxiosError(400, 'Invalid filename');

      errorHandler(
        axiosError,
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: {
          code: 400,
          message: 'Invalid filename',
        },
      });
    });

    it('passes through 404 Not Found from backend', () => {
      const axiosError = createAxiosError(404, 'Interface not found');

      errorHandler(
        axiosError,
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({
        error: {
          code: 404,
          message: 'Interface not found',
        },
      });
    });

    it('maps 500 Internal Server Error to 502 Bad Gateway', () => {
      const axiosError = createAxiosError(500, 'Database error');

      errorHandler(
        axiosError,
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(statusMock).toHaveBeenCalledWith(502);
      expect(jsonMock).toHaveBeenCalledWith({
        error: {
          code: 502,
          message: 'Backend service error',
        },
      });
    });

    it('maps network errors (no response) to 502 Bad Gateway', () => {
      const axiosError = {
        isAxiosError: true,
        message: 'Network Error',
        response: undefined,
      } as unknown as AxiosError;

      errorHandler(
        axiosError,
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(statusMock).toHaveBeenCalledWith(502);
      expect(jsonMock).toHaveBeenCalledWith({
        error: {
          code: 502,
          message: 'Backend service unavailable',
        },
      });
    });

    it('handles non-Axios errors with statusCode', () => {
      const httpError = createHttpError(400, 'Missing sessionId');

      errorHandler(
        httpError,
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: {
          code: 400,
          message: 'Missing sessionId',
        },
      });
    });
  });
});

/**
 * Helper to create mock Axios errors for testing
 */
function createAxiosError(status: number, message: string): AxiosError {
  return {
    isAxiosError: true,
    message,
    response: {
      status,
      data: { message },
      statusText: '',
      headers: {},
      config: {} as never,
    },
  } as unknown as AxiosError;
}
