/**
 * Tests for the MCP save_discovery_run tool chain.
 *
 * Spec: Discovery Run Model and Orchestration (Increment 5)
 * Task Group 5: MCP Tool for Discovery Run Persistence
 *
 * Tests the archModelClient saveDiscoveryRun/getDiscoveryRun methods,
 * the discoveryRunService orchestration, and the saveDiscoveryRunRoute handler.
 *
 * Gap Tests (Task Group 8):
 * - Gap Test 5: discoveryRunService rejects JSON array input
 * - Gap Test 6: discoveryRunService enforces 500KB payload size limit
 */

import { AxiosError } from 'axios';
import type { Request, Response, NextFunction } from 'express';

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock axios
jest.mock('axios');

describe('MCP save_discovery_run chain', () => {
  // ==========================================================================
  // Test 1: archModelClient saveDiscoveryRun calls PUT with correct URL and body
  // (follows archModelClient.discoveryConfig.test.ts Test 8 pattern)
  // ==========================================================================
  describe('archModelClient - saveDiscoveryRun', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('calls PUT with correct URL and body, returns DiscoveryRunResponseDto', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';
      const runId = 'run-uuid-789';
      const discoveryRunPayload = {
        current_step: '1a',
        steps_payload: {
          '1a': { status: 'running' },
          '1b': { status: 'pending' },
          '1c': { status: 'pending' },
          '1d': { status: 'pending' },
        },
      };
      const status = 'RUNNING';

      const mockResponse = {
        id: runId,
        project_id: projectId,
        status: 'RUNNING',
        current_step: '1a',
        config_snapshot: { repos: [] },
        steps_payload: {
          '1a': { status: 'running' },
          '1b': { status: 'pending' },
          '1c': { status: 'pending' },
          '1d': { status: 'pending' },
        },
        error_message: null,
        created_at: '2026-04-04T10:00:00Z',
        updated_at: '2026-04-04T10:00:00Z',
      };

      // Setup axios mock
      const axios = require('axios');
      const mockPut = jest.fn().mockResolvedValue({ data: mockResponse });
      const mockAxiosInstance = {
        put: mockPut,
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Import the client (after mocks are set up)
      const { archModelClient } = require('../services/archModelClient');

      const architectureId = '770e8400-e29b-41d4-a716-446655440002';
      const result = await archModelClient.saveDiscoveryRun(
        projectId,
        architectureId,
        runId,
        discoveryRunPayload,
        status
      );

      // Verify PUT was called with the architecture-scoped URL and body
      expect(mockPut).toHaveBeenCalledTimes(1);
      expect(mockPut).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}`,
        { status, ...discoveryRunPayload }
      );

      // Verify the returned data matches the mock response
      expect(result).toEqual(mockResponse);
      expect(result.id).toBe(runId);
      expect(result.project_id).toBe(projectId);
      expect(result.status).toBe('RUNNING');
      expect(result.created_at).toBe('2026-04-04T10:00:00Z');
    });
  });

  // ==========================================================================
  // Test 2: archModelClient getDiscoveryRun returns null on 404
  // (follows archModelClient.discoveryConfig.test.ts Test 9 pattern)
  // ==========================================================================
  describe('archModelClient - getDiscoveryRun', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns null when backend returns 404 (run not found)', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';
      const runId = 'non-existent-run-id';

      // Create a 404 AxiosError
      const axiosError = {
        isAxiosError: true,
        message: 'Request failed with status code 404',
        response: {
          status: 404,
          data: { message: 'Not Found' },
          statusText: 'Not Found',
          headers: {},
          config: {},
        },
      } as AxiosError;

      // Setup axios mock
      const axios = require('axios');
      const mockGet = jest.fn().mockRejectedValue(axiosError);
      const mockAxiosInstance = {
        get: mockGet,
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Import the client (after mocks are set up)
      const { archModelClient } = require('../services/archModelClient');

      const architectureId = '770e8400-e29b-41d4-a716-446655440002';
      const result = await archModelClient.getDiscoveryRun(projectId, architectureId, runId);

      // Verify null is returned on 404
      expect(result).toBeNull();

      // Verify the GET call was made with the architecture-scoped URL
      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(mockGet).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}`
      );
    });
  });

  // ==========================================================================
  // Test 3: discoveryRunService returns { projectId, status } for valid JSON
  // (follows discoveryConfigService.test.ts Test 5 pattern)
  // ==========================================================================
  describe('discoveryRunService - valid request', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns { projectId, status } for a valid JSON run payload', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn().mockImplementation((url: string) => {
          if (url === '/api/projects') {
            return Promise.resolve({
              data: [{ id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', name: 'Test Project' }],
            });
          }
          if (url.endsWith('/architectures')) {
            return Promise.resolve({
              data: [{ id: '770e8400-e29b-41d4-a716-446655440002', project_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', name: 'Default', archived_at: null }],
            });
          }
          return Promise.reject(new Error(`Unexpected GET: ${url}`));
        }),
        put: jest.fn().mockResolvedValue({
          data: {
            id: 'run-uuid-123',
            project_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            status: 'RUNNING',
            current_step: '1a',
            config_snapshot: {},
            steps_payload: { '1a': { status: 'running' } },
            error_message: null,
            created_at: '2026-04-04T10:00:00Z',
            updated_at: '2026-04-04T10:00:00Z',
          },
        }),
      });

      // Import the service (after mocks are set up -- no top-level mock for discoveryRunService)
      const { saveDiscoveryRun } = require('../services/discoveryRunService');

      const validRun = {
        id: 'run-uuid-123',
        status: 'RUNNING',
        current_step: '1a',
        steps_payload: { '1a': { status: 'running' } },
      };

      const result = await saveDiscoveryRun(
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        JSON.stringify(validRun)
      );

      expect(result).toEqual({
        projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        status: 'RUNNING',
      });
    });
  });

  // ==========================================================================
  // Test 4: discoveryRunService throws 400 for invalid JSON string
  // (follows discoveryConfigService.test.ts Test 6 pattern)
  // ==========================================================================
  describe('discoveryRunService - invalid JSON', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('throws 400 for invalid JSON string', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn(),
        put: jest.fn(),
      });

      // Import the service (after mocks are set up)
      const { saveDiscoveryRun } = require('../services/discoveryRunService');

      try {
        await saveDiscoveryRun(
          'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          'not-valid-json{{'
        );
        fail('Expected error to be thrown');
      } catch (error: any) {
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain('Invalid JSON');
      }
    });
  });

  // ==========================================================================
  // Test 5: saveDiscoveryRunRoute returns 400 when sessionId is missing
  // (follows saveDiscoveryConfigRoute.test.ts Test 1 pattern)
  // ==========================================================================
  describe('saveDiscoveryRunRoute - missing sessionId', () => {
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

      // Mock sessionManager for route tests
      jest.doMock('../services/sessionManager', () => ({
        getOrCreateSession: jest.fn(),
      }));

      // Mock discoveryRunService for route tests
      jest.doMock('../services/discoveryRunService', () => ({
        saveDiscoveryRun: jest.fn(),
      }));

      // Import the route handler
      const { saveDiscoveryRunRouter } = require('../routes/saveDiscoveryRunRoute');

      // Create mock request without sessionId
      const mockReq = {
        body: {
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          discoveryRunJson: '{"status":"PENDING"}',
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
      const routeLayer = saveDiscoveryRunRouter.stack.find(
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

  // ==========================================================================
  // Test 6: saveDiscoveryRunRoute returns 200 with { projectId, status }
  // (follows saveDiscoveryConfigRoute.test.ts Test 4 pattern)
  // ==========================================================================
  describe('saveDiscoveryRunRoute - valid request', () => {
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

      // Mock sessionManager
      jest.doMock('../services/sessionManager', () => ({
        getOrCreateSession: jest.fn().mockReturnValue({
          sessionId: 'session-123',
          lastActivity: new Date(),
        }),
      }));

      // Mock discoveryRunService
      jest.doMock('../services/discoveryRunService', () => ({
        saveDiscoveryRun: jest.fn().mockResolvedValue({
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          status: 'PENDING',
        }),
      }));

      // Import the route handler
      const { saveDiscoveryRunRouter } = require('../routes/saveDiscoveryRunRoute');
      const sessionManager = require('../services/sessionManager');
      const service = require('../services/discoveryRunService');

      const validRun = {
        status: 'PENDING',
        steps_payload: {
          '1a': { status: 'pending' },
          '1b': { status: 'pending' },
          '1c': { status: 'pending' },
          '1d': { status: 'pending' },
        },
      };

      // Create mock request with all valid fields
      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          discoveryRunJson: JSON.stringify(validRun),
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
      const routeLayer = saveDiscoveryRunRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify session was created
        expect(sessionManager.getOrCreateSession).toHaveBeenCalledWith('session-123');

        // Verify service was called with correct arguments
        expect(service.saveDiscoveryRun).toHaveBeenCalledWith(
          'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          JSON.stringify(validRun)
        );

        // Verify successful response
        expect(jsonMock).toHaveBeenCalledWith({
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          status: 'PENDING',
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

  // ==========================================================================
  // Gap Tests (Task Group 8: Test Review and Integration Verification)
  // ==========================================================================

  // ==========================================================================
  // Gap Test 5: discoveryRunService rejects JSON array input
  // (follows discoveryConfigService gap test pattern)
  //
  // Note: Explicitly unmocks discoveryRunService and sessionManager to clear
  // doMock registrations from the route tests above.
  // ==========================================================================
  describe('discoveryRunService - rejects JSON array', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
      // Clear doMock registrations from route tests
      jest.unmock('../services/discoveryRunService');
      jest.unmock('../services/sessionManager');
    });

    it('throws 400 when discoveryRunJson is a JSON array instead of object', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn(),
        put: jest.fn(),
      });

      // Import the REAL service (doMock cleared via unmock above)
      const { saveDiscoveryRun } = require('../services/discoveryRunService');

      // A JSON array is valid JSON but not a valid discovery run
      // (the service requires a non-null object, not an array)
      let thrownError: any;
      try {
        await saveDiscoveryRun(
          'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          '[1,2,3]'
        );
        // If no error thrown, force test failure
        thrownError = null;
      } catch (error: any) {
        thrownError = error;
      }

      expect(thrownError).not.toBeNull();
      expect(thrownError.statusCode).toBe(400);
      expect(thrownError.message).toContain('must be a JSON object');
    });
  });

  // ==========================================================================
  // Gap Test 6: discoveryRunService enforces 500KB payload size limit
  // ==========================================================================
  describe('discoveryRunService - payload size limit', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
      // Clear doMock registrations from route tests
      jest.unmock('../services/discoveryRunService');
      jest.unmock('../services/sessionManager');
    });

    it('throws 400 when discoveryRunJson exceeds 500KB', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn(),
        put: jest.fn(),
      });

      // Import the REAL service (doMock cleared via unmock above)
      const { saveDiscoveryRun } = require('../services/discoveryRunService');

      // Create a payload that exceeds 500KB (500 * 1024 = 512000 bytes)
      const largeString = 'x'.repeat(500 * 1024 + 1);
      const oversizedPayload = JSON.stringify({ data: largeString });

      let thrownError: any;
      try {
        await saveDiscoveryRun(
          'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          oversizedPayload
        );
        // If no error thrown, force test failure
        thrownError = null;
      } catch (error: any) {
        thrownError = error;
      }

      expect(thrownError).not.toBeNull();
      expect(thrownError.statusCode).toBe(400);
      expect(thrownError.message).toContain('exceeds maximum size of 500KB');
    });
  });
});
