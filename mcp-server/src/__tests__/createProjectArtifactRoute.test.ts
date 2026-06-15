import type { Request, Response, NextFunction } from 'express';

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock axios
jest.mock('axios');

// Mock sessionManager
jest.mock('../services/sessionManager');

describe('createProjectArtifact Route Handler', () => {
  // ============================================================================
  // Test 1: Valid request delegates to archModelClient.createProjectArtifact
  // ============================================================================
  describe('create_project_artifact - valid request', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('delegates to archModelClient.createProjectArtifact and returns the response', async () => {
      // Setup axios mock
      const axios = require('axios');
      const mockPost = jest.fn().mockResolvedValue({
        data: {
          id: 'artifact-uuid-123',
          project_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          artifact_type: 'DISCOVERY_BRIEF_MD',
          content: '# Discovery Brief',
          source: 'discovery-framing',
        },
      });
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn(),
        put: jest.fn(),
        post: mockPost,
      });

      // Setup session manager mock
      const sessionManager = require('../services/sessionManager');
      sessionManager.getOrCreateSession = jest.fn().mockReturnValue({
        sessionId: 'session-123',
        lastActivity: new Date(),
      });

      // Import the route handler
      const { createProjectArtifactRouter } = require('../routes/createProjectArtifactRoute');

      // Create mock request with all valid fields
      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          artifactType: 'DISCOVERY_BRIEF_MD',
          content: '# Discovery Brief\n\nScope summary here.',
          source: 'discovery-framing',
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
      const routeLayer = createProjectArtifactRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify session was created
        expect(sessionManager.getOrCreateSession).toHaveBeenCalledWith('session-123');

        // Verify archModelClient.createProjectArtifact was called
        // (via axios.create().post)
        expect(mockPost).toHaveBeenCalledWith(
          `/api/model/projects/a1b2c3d4-e5f6-7890-abcd-ef1234567890/artifacts/DISCOVERY_BRIEF_MD`,
          { content: '# Discovery Brief\n\nScope summary here.', source: 'discovery-framing' }
        );

        // Verify successful response
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'artifact-uuid-123',
            artifact_type: 'DISCOVERY_BRIEF_MD',
          })
        );

        // Verify no error handling was triggered
        expect(mockNext).not.toHaveBeenCalled();
        expect(statusMock).not.toHaveBeenCalled();
      } else {
        fail('Route handler not found');
      }
    });
  });

  // ============================================================================
  // Test 2: Missing artifactType returns 400
  // ============================================================================
  describe('create_project_artifact - missing artifactType', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 400 when artifactType is missing', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        get: jest.fn(),
        put: jest.fn(),
        post: jest.fn(),
      });

      // Import the route handler
      const { createProjectArtifactRouter } = require('../routes/createProjectArtifactRoute');

      // Create mock request without artifactType
      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          // artifactType is missing
          content: '# Discovery Brief',
          source: 'discovery-framing',
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
      const routeLayer = createProjectArtifactRouter.stack.find(
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
              message: expect.stringContaining('artifactType'),
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
