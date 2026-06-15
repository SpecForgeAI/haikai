import { AxiosError } from 'axios';
import type { Request, Response, NextFunction } from 'express';

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock axios
jest.mock('axios');

describe('MCP Server Integration Tests', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // ============================================================================
  // Test 1: Full flow - list_interfaces -> get_interface_oas_context with session
  // ============================================================================
  describe('Full flow with session persistence', () => {
    beforeEach(() => {
      jest.resetModules();
    });

    it('executes list_interfaces then get_interface_oas_context with session state', async () => {
      const mockInterfaces = [
        {
          interfaceId: 'ifc-integration-1',
          interfaceName: 'Integration API',
          interfaceType: 'REST',
          serviceId: 'svc-1',
          serviceName: 'Integration Service',
          applicationId: 'app-1',
          applicationName: 'Integration App',
          endpointCount: 3,
        },
      ];

      const mockContext = {
        interface: {
          id: 'ifc-integration-1',
          name: 'Integration API',
          description: 'API for integration tests',
          interfaceType: 'REST',
          specLink: null,
          tags: 'integration,test',
          validFrom: null,
          validTo: null,
        },
        service: {
          id: 'svc-1',
          name: 'Integration Service',
          description: 'Test service',
          serviceType: 'Backend',
          tags: null,
        },
        application: {
          id: 'app-1',
          name: 'Integration App',
          description: 'Test application',
          appType: 'Web',
          status: 'Active',
          tags: null,
        },
        endpoints: [
          {
            id: 'ep-1',
            name: 'Get Resource',
            description: 'Get a resource',
            endpointType: 'REST',
            pathOrAddress: '/resources/{id}',
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
        logicalEntities: [],
        notes: null,
      };

      // Setup axios mock to return different responses for different endpoints
      const axios = require('axios');
      let callCount = 0;
      const mockAxiosGet = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ data: mockInterfaces });
        } else {
          return Promise.resolve({ data: mockContext });
        }
      });

      axios.create = jest.fn().mockReturnValue({
        get: mockAxiosGet,
      });

      // Import session manager and client
      const {
        getOrCreateSession,
        updateSession,
        getSession,
        clearAllSessions,
      } = require('../services/sessionManager');
      const { archModelClient } = require('../services/archModelClient');

      clearAllSessions();

      const sessionId = 'integration-session-123';
      const filename = 'integration-model.json';
      const interfaceId = 'ifc-integration-1';

      // Act 1: Simulate list_interfaces flow
      getOrCreateSession(sessionId);
      const interfaces = await archModelClient.listInterfaces(filename);
      updateSession(sessionId, {
        filename,
        lastListedInterfaces: interfaces,
      });

      // Assert 1: Verify list_interfaces result
      expect(interfaces).toEqual(mockInterfaces);
      expect(interfaces).toHaveLength(1);

      // Verify session state after list_interfaces
      let session = getSession(sessionId);
      expect(session).toBeDefined();
      expect(session!.filename).toBe(filename);
      expect(session!.lastListedInterfaces).toEqual(mockInterfaces);

      // Act 2: Simulate get_interface_oas_context flow (same session)
      const context = await archModelClient.getInterfaceOasContext(interfaceId);
      updateSession(sessionId, {
        lastSelectedInterfaceId: interfaceId,
      });

      // Assert 2: Verify get_interface_oas_context result
      expect(context).toEqual(mockContext);
      expect(context.interface.id).toBe(interfaceId);

      // Verify session state after get_interface_oas_context
      session = getSession(sessionId);
      expect(session!.lastSelectedInterfaceId).toBe(interfaceId);
      // Previous session state should be preserved
      expect(session!.filename).toBe(filename);
      expect(session!.lastListedInterfaces).toEqual(mockInterfaces);

      // Verify both calls were made
      expect(mockAxiosGet).toHaveBeenCalledTimes(2);

      // Clean up
      clearAllSessions();
    });
  });

  // ============================================================================
  // Test 2: Session expiration behavior
  // ============================================================================
  describe('Session expiration behavior', () => {
    beforeEach(() => {
      jest.resetModules();
    });

    it('expires sessions after TTL and creates new session on subsequent access', () => {
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

      // Create two sessions
      const session1Id = 'session-expire-1';
      const session2Id = 'session-expire-2';

      const session1 = getOrCreateSession(session1Id);
      const session2 = getOrCreateSession(session2Id);

      expect(getSessionCount()).toBe(2);

      // Manually expire session1 by setting lastActivity to past
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
      session1.lastActivity = twoMinutesAgo;

      // Run cleanup
      const removedCount = cleanupExpiredSessions();

      // Verify session1 expired, session2 still active
      expect(removedCount).toBe(1);
      expect(getSessionCount()).toBe(1);
      expect(getSession(session1Id)).toBeUndefined();
      expect(getSession(session2Id)).toBeDefined();

      // Access expired session should create new session
      const newSession1 = getOrCreateSession(session1Id);
      expect(newSession1).toBeDefined();
      expect(newSession1.sessionId).toBe(session1Id);
      // New session should NOT have old state
      expect(newSession1.filename).toBeUndefined();
      expect(newSession1.lastSelectedInterfaceId).toBeUndefined();

      expect(getSessionCount()).toBe(2);

      clearAllSessions();
    });
  });

  // ============================================================================
  // Test 3: Concurrent requests to same session
  // ============================================================================
  describe('Concurrent requests to same session', () => {
    beforeEach(() => {
      jest.resetModules();
    });

    it('handles concurrent updates to the same session correctly', async () => {
      const {
        getOrCreateSession,
        updateSession,
        getSession,
        clearAllSessions,
      } = require('../services/sessionManager');

      clearAllSessions();

      const sessionId = 'concurrent-session';

      // Create initial session
      getOrCreateSession(sessionId);

      // Simulate concurrent updates
      const update1Promise = Promise.resolve().then(() => {
        updateSession(sessionId, { filename: 'model-1.json' });
      });

      const update2Promise = Promise.resolve().then(() => {
        updateSession(sessionId, { lastSelectedInterfaceId: 'ifc-1' });
      });

      const update3Promise = Promise.resolve().then(() => {
        updateSession(sessionId, {
          lastListedInterfaces: [
            {
              interfaceId: 'ifc-1',
              interfaceName: 'Test API',
              interfaceType: 'REST',
              serviceId: null,
              serviceName: null,
              applicationId: null,
              applicationName: null,
              endpointCount: 1,
            },
          ],
        });
      });

      // Wait for all updates to complete
      await Promise.all([update1Promise, update2Promise, update3Promise]);

      // Verify all updates were applied
      const session = getSession(sessionId);
      expect(session).toBeDefined();
      expect(session!.filename).toBe('model-1.json');
      expect(session!.lastSelectedInterfaceId).toBe('ifc-1');
      expect(session!.lastListedInterfaces).toBeDefined();
      expect(session!.lastListedInterfaces).toHaveLength(1);

      clearAllSessions();
    });
  });

  // ============================================================================
  // Test 4: Backend unavailable returns 502
  // ============================================================================
  describe('Backend unavailable returns 502', () => {
    it('maps network error to 502 Bad Gateway', async () => {
      const {
        errorHandler,
        createHttpError,
      } = require('../middleware/errorHandler');

      // Simulate network error (no response from backend)
      const networkError = {
        isAxiosError: true,
        message: 'connect ECONNREFUSED 127.0.0.1:8080',
        response: undefined,
        code: 'ECONNREFUSED',
      } as unknown as AxiosError;

      const mockReq = {} as Partial<Request>;
      const jsonMock = jest.fn();
      const statusMock = jest.fn().mockReturnValue({ json: jsonMock });
      const mockRes = {
        status: statusMock,
        headersSent: false,
      } as Partial<Response>;
      const mockNext: NextFunction = jest.fn();

      // Act
      errorHandler(
        networkError,
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      // Assert
      expect(statusMock).toHaveBeenCalledWith(502);
      expect(jsonMock).toHaveBeenCalledWith({
        error: {
          code: 502,
          message: 'Backend service unavailable',
        },
      });
    });

    it('maps 500 server error to 502 Bad Gateway', async () => {
      const { errorHandler } = require('../middleware/errorHandler');

      // Simulate 500 error from backend
      const serverError = {
        isAxiosError: true,
        message: 'Internal Server Error',
        response: {
          status: 500,
          data: { message: 'Database connection failed' },
          statusText: 'Internal Server Error',
          headers: {},
          config: {} as never,
        },
      } as unknown as AxiosError;

      const mockReq = {} as Partial<Request>;
      const jsonMock = jest.fn();
      const statusMock = jest.fn().mockReturnValue({ json: jsonMock });
      const mockRes = {
        status: statusMock,
        headersSent: false,
      } as Partial<Response>;
      const mockNext: NextFunction = jest.fn();

      // Act
      errorHandler(
        serverError,
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      // Assert
      expect(statusMock).toHaveBeenCalledWith(502);
      expect(jsonMock).toHaveBeenCalledWith({
        error: {
          code: 502,
          message: 'Backend service error',
        },
      });
    });

    it('passes through 404 from backend', async () => {
      const { errorHandler } = require('../middleware/errorHandler');

      // Simulate 404 error from backend
      const notFoundError = {
        isAxiosError: true,
        message: 'Not Found',
        response: {
          status: 404,
          data: { message: 'Model file not found: nonexistent.json' },
          statusText: 'Not Found',
          headers: {},
          config: {} as never,
        },
      } as unknown as AxiosError;

      const mockReq = {} as Partial<Request>;
      const jsonMock = jest.fn();
      const statusMock = jest.fn().mockReturnValue({ json: jsonMock });
      const mockRes = {
        status: statusMock,
        headersSent: false,
      } as Partial<Response>;
      const mockNext: NextFunction = jest.fn();

      // Act
      errorHandler(
        notFoundError,
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      // Assert
      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({
        error: {
          code: 404,
          message: 'Model file not found: nonexistent.json',
        },
      });
    });

    it('passes through 400 from backend', async () => {
      const { errorHandler } = require('../middleware/errorHandler');

      // Simulate 400 error from backend
      const badRequestError = {
        isAxiosError: true,
        message: 'Bad Request',
        response: {
          status: 400,
          data: { message: 'Filename is required' },
          statusText: 'Bad Request',
          headers: {},
          config: {} as never,
        },
      } as unknown as AxiosError;

      const mockReq = {} as Partial<Request>;
      const jsonMock = jest.fn();
      const statusMock = jest.fn().mockReturnValue({ json: jsonMock });
      const mockRes = {
        status: statusMock,
        headersSent: false,
      } as Partial<Response>;
      const mockNext: NextFunction = jest.fn();

      // Act
      errorHandler(
        badRequestError,
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      // Assert
      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: {
          code: 400,
          message: 'Filename is required',
        },
      });
    });
  });
});
