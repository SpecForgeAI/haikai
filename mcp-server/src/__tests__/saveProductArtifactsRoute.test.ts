import type { Request, Response, NextFunction } from 'express';
import path from 'path';

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock axios
jest.mock('axios');

// Mock sessionManager
jest.mock('../services/sessionManager');

// Mock fs with promises API
const mockMkdir = jest.fn();
const mockWriteFile = jest.fn();
const mockRename = jest.fn();
const mockAccess = jest.fn();

jest.mock('fs', () => ({
  promises: {
    mkdir: (...args: any[]) => mockMkdir(...args),
    writeFile: (...args: any[]) => mockWriteFile(...args),
    rename: (...args: any[]) => mockRename(...args),
    access: (...args: any[]) => mockAccess(...args),
  },
}));

describe('save_product_artifacts Route Handler', () => {
  // ============================================================================
  // Test 1: Valid request with full success
  // ============================================================================
  describe('save_product_artifacts - valid request (full success)', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns HTTP 200 with writtenPaths and productUpserted on full success', async () => {
      const mockProductDef = {
        id: 'prod-def-1',
        projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        productName: 'My Product',
        createdAt: '2025-01-15T10:00:00.000Z',
        updatedAt: '2025-01-15T10:00:00.000Z',
      };

      // Setup axios mock
      const axios = require('axios');
      const mockAxiosInstance = {
        put: jest.fn().mockResolvedValue({ data: mockProductDef, status: 200 }),
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Setup session manager mock
      const sessionManager = require('../services/sessionManager');
      sessionManager.getOrCreateSession = jest.fn().mockReturnValue({
        sessionId: 'session-123',
        lastActivity: new Date(),
      });
      sessionManager.updateSession = jest.fn();

      // Setup fs mocks for success
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
      mockRename.mockResolvedValue(undefined);

      // Import the route handler
      const { saveProductArtifactsRouter } = require('../routes/saveProductArtifactsRoute');

      // Create mock request/response
      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectParentFolder: '/projects/my-project',
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          productName: 'My Product',
          missionMarkdown: '# Mission\n\nOur mission is to build great software.',
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
      const routeLayer = saveProductArtifactsRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify response
        expect(jsonMock).toHaveBeenCalledWith({
          writtenPaths: ['agent-os/product/MISSION.MD'],
          productUpserted: true,
        });
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
  describe('save_product_artifacts - missing sessionId', () => {
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
      const { saveProductArtifactsRouter } = require('../routes/saveProductArtifactsRoute');

      // Create mock request/response without sessionId
      const mockReq = {
        body: {
          projectParentFolder: '/projects/my-project',
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          productName: 'My Product',
          missionMarkdown: '# Mission',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const mockRes = {
        json: jsonMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      // Get the route handler from the router
      const routeLayer = saveProductArtifactsRouter.stack.find(
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
  describe('save_product_artifacts - invalid projectId', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 400 Bad Request when projectId is not a valid UUID', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        put: jest.fn(),
      });

      // Import the route handler
      const { saveProductArtifactsRouter } = require('../routes/saveProductArtifactsRoute');

      // Create mock request/response with invalid projectId
      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectParentFolder: '/projects/my-project',
          projectId: 'not-a-uuid',
          productName: 'My Product',
          missionMarkdown: '# Mission',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const mockRes = {
        json: jsonMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      // Get the route handler from the router
      const routeLayer = saveProductArtifactsRouter.stack.find(
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
  // Test 4: productName exceeding 255 characters returns 400
  // ============================================================================
  describe('save_product_artifacts - productName too long', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 400 Bad Request when productName exceeds 255 characters', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        put: jest.fn(),
      });

      // Import the route handler
      const { saveProductArtifactsRouter } = require('../routes/saveProductArtifactsRoute');

      // Create mock request/response with productName exceeding 255 chars
      const longProductName = 'A'.repeat(256);
      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectParentFolder: '/projects/my-project',
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          productName: longProductName,
          missionMarkdown: '# Mission',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const mockRes = {
        json: jsonMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      // Get the route handler from the router
      const routeLayer = saveProductArtifactsRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify error was passed to next middleware
        expect(mockNext).toHaveBeenCalled();
        const error = (mockNext as jest.Mock).mock.calls[0][0];
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain('productName');
      } else {
        fail('Route handler not found');
      }
    });
  });

  // ============================================================================
  // Test 5: Empty missionMarkdown returns 400
  // ============================================================================
  describe('save_product_artifacts - empty missionMarkdown', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 400 Bad Request when missionMarkdown is empty', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        put: jest.fn(),
      });

      // Import the route handler
      const { saveProductArtifactsRouter } = require('../routes/saveProductArtifactsRoute');

      // Create mock request/response with empty missionMarkdown
      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectParentFolder: '/projects/my-project',
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          productName: 'My Product',
          missionMarkdown: '',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const mockRes = {
        json: jsonMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      // Get the route handler from the router
      const routeLayer = saveProductArtifactsRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify error was passed to next middleware
        expect(mockNext).toHaveBeenCalled();
        const error = (mockNext as jest.Mock).mock.calls[0][0];
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain('missionMarkdown');
      } else {
        fail('Route handler not found');
      }
    });
  });

  // ============================================================================
  // Test 6: missionMarkdown over 200KB returns 400
  // ============================================================================
  describe('save_product_artifacts - missionMarkdown too large', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 400 Bad Request when missionMarkdown exceeds 200KB', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        put: jest.fn(),
      });

      // Import the route handler
      const { saveProductArtifactsRouter } = require('../routes/saveProductArtifactsRoute');

      // Create missionMarkdown that exceeds 204800 bytes
      // Use a string that is clearly over 200KB (204801 bytes of ASCII)
      const largeMissionMarkdown = 'X'.repeat(204801);
      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectParentFolder: '/projects/my-project',
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          productName: 'My Product',
          missionMarkdown: largeMissionMarkdown,
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const mockRes = {
        json: jsonMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      // Get the route handler from the router
      const routeLayer = saveProductArtifactsRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify error was passed to next middleware
        expect(mockNext).toHaveBeenCalled();
        const error = (mockNext as jest.Mock).mock.calls[0][0];
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain('missionMarkdown');
      } else {
        fail('Route handler not found');
      }
    });
  });

  // ============================================================================
  // Test 7: File write failure returns 500 via next(error)
  // ============================================================================
  describe('save_product_artifacts - file write failure', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 500 via next(error) when fs.writeFile rejects', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        put: jest.fn(),
      });

      // Setup session manager mock
      const sessionManager = require('../services/sessionManager');
      sessionManager.getOrCreateSession = jest.fn().mockReturnValue({
        sessionId: 'session-123',
        lastActivity: new Date(),
      });

      // Setup fs mocks: mkdir succeeds, writeFile fails
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockRejectedValue(new Error('Disk full'));

      // Import the route handler
      const { saveProductArtifactsRouter } = require('../routes/saveProductArtifactsRoute');

      // Create mock request/response
      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectParentFolder: '/projects/my-project',
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          productName: 'My Product',
          missionMarkdown: '# Mission',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const mockRes = {
        json: jsonMock,
      } as Partial<Response>;

      const mockNext: NextFunction = jest.fn();

      // Get the route handler from the router
      const routeLayer = saveProductArtifactsRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify error was passed to next middleware
        expect(mockNext).toHaveBeenCalled();
        const error = (mockNext as jest.Mock).mock.calls[0][0];
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toContain('Disk full');
      } else {
        fail('Route handler not found');
      }
    });
  });

  // ============================================================================
  // Test 8: DB upsert failure returns 502 with writtenPaths
  // ============================================================================
  describe('save_product_artifacts - DB upsert failure', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns HTTP 502 with error and writtenPaths when DB upsert fails', async () => {
      // Setup axios mock: upsert will fail
      const axios = require('axios');
      const mockAxiosInstance = {
        put: jest.fn().mockRejectedValue(new Error('Connection refused')),
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Setup session manager mock
      const sessionManager = require('../services/sessionManager');
      sessionManager.getOrCreateSession = jest.fn().mockReturnValue({
        sessionId: 'session-123',
        lastActivity: new Date(),
      });

      // Setup fs mocks for successful file write
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
      mockRename.mockResolvedValue(undefined);

      // Import the route handler
      const { saveProductArtifactsRouter } = require('../routes/saveProductArtifactsRoute');

      // Create mock request/response
      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectParentFolder: '/projects/my-project',
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          productName: 'My Product',
          missionMarkdown: '# Mission\n\nOur mission is to build great software.',
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
      const routeLayer = saveProductArtifactsRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify 502 response with error and writtenPaths
        expect(statusMock).toHaveBeenCalledWith(502);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.objectContaining({
              code: 502,
            }),
            writtenPaths: ['agent-os/product/MISSION.MD'],
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
  // Gap-Filling Tests (Task Group 4)
  // ============================================================================

  // ============================================================================
  // Test A: overwrite=false with existing file returns 409 Conflict
  // ============================================================================
  describe('save_product_artifacts - overwrite=false with existing file (409)', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 409 Conflict when overwrite is false and MISSION.MD already exists', async () => {
      // Setup axios mock
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({
        put: jest.fn(),
      });

      // Setup session manager mock
      const sessionManager = require('../services/sessionManager');
      sessionManager.getOrCreateSession = jest.fn().mockReturnValue({
        sessionId: 'session-456',
        lastActivity: new Date(),
      });

      // Setup fs mocks: access resolves (file exists)
      mockAccess.mockResolvedValue(undefined);

      // Import the route handler
      const { saveProductArtifactsRouter } = require('../routes/saveProductArtifactsRoute');

      // Create mock request with overwrite=false
      const mockReq = {
        body: {
          sessionId: 'session-456',
          projectParentFolder: '/projects/existing-project',
          projectId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
          productName: 'Existing Product',
          missionMarkdown: '# Updated Mission',
          overwrite: false,
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
      const routeLayer = saveProductArtifactsRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify 409 error was passed to next middleware
        expect(mockNext).toHaveBeenCalled();
        const error = (mockNext as jest.Mock).mock.calls[0][0];
        expect(error.statusCode).toBe(409);
        expect(error.message).toContain('MISSION.MD already exists');
        expect(error.message).toContain('overwrite');
      } else {
        fail('Route handler not found');
      }
    });
  });

  // ============================================================================
  // Test B: Success path calls getOrCreateSession and updateSession correctly
  // ============================================================================
  describe('save_product_artifacts - session management verification', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('calls getOrCreateSession(sessionId) and updateSession(sessionId, { productName }) on success', async () => {
      const mockProductDef = {
        id: 'prod-def-2',
        projectId: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
        productName: 'Session Test Product',
        createdAt: '2025-01-15T10:00:00.000Z',
        updatedAt: '2025-01-15T10:00:00.000Z',
      };

      // Setup axios mock
      const axios = require('axios');
      const mockAxiosInstance = {
        put: jest.fn().mockResolvedValue({ data: mockProductDef, status: 200 }),
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Setup session manager mock
      const sessionManager = require('../services/sessionManager');
      sessionManager.getOrCreateSession = jest.fn().mockReturnValue({
        sessionId: 'session-789',
        lastActivity: new Date(),
      });
      sessionManager.updateSession = jest.fn();

      // Setup fs mocks for success
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
      mockRename.mockResolvedValue(undefined);

      // Import the route handler
      const { saveProductArtifactsRouter } = require('../routes/saveProductArtifactsRoute');

      // Create mock request/response
      const mockReq = {
        body: {
          sessionId: 'session-789',
          projectParentFolder: '/projects/session-test',
          projectId: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
          productName: 'Session Test Product',
          missionMarkdown: '# Mission for session test',
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
      const routeLayer = saveProductArtifactsRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify getOrCreateSession was called with correct sessionId
        expect(sessionManager.getOrCreateSession).toHaveBeenCalledWith('session-789');

        // Verify updateSession was called with correct sessionId and productName
        expect(sessionManager.updateSession).toHaveBeenCalledWith('session-789', {
          productName: 'Session Test Product',
        });

        // Verify no error occurred
        expect(mockNext).not.toHaveBeenCalled();
      } else {
        fail('Route handler not found');
      }
    });
  });

  // ============================================================================
  // Test C: Route handler computes correct file paths using path.join
  // ============================================================================
  describe('save_product_artifacts - file path computation', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('passes correct missionDir and missionFile paths to fs calls via path.join', async () => {
      const mockProductDef = {
        id: 'prod-def-3',
        projectId: 'd4e5f6a7-b8c9-0123-defa-234567890123',
        productName: 'Path Test Product',
        createdAt: '2025-01-15T10:00:00.000Z',
        updatedAt: '2025-01-15T10:00:00.000Z',
      };

      // Setup axios mock
      const axios = require('axios');
      const mockAxiosInstance = {
        put: jest.fn().mockResolvedValue({ data: mockProductDef, status: 200 }),
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Setup session manager mock
      const sessionManager = require('../services/sessionManager');
      sessionManager.getOrCreateSession = jest.fn().mockReturnValue({
        sessionId: 'session-path',
        lastActivity: new Date(),
      });
      sessionManager.updateSession = jest.fn();

      // Setup fs mocks for success
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
      mockRename.mockResolvedValue(undefined);

      // Import the route handler
      const { saveProductArtifactsRouter } = require('../routes/saveProductArtifactsRoute');

      const projectParentFolder = '/workspace/my-project';

      // Create mock request/response
      const mockReq = {
        body: {
          sessionId: 'session-path',
          projectParentFolder,
          projectId: 'd4e5f6a7-b8c9-0123-defa-234567890123',
          productName: 'Path Test Product',
          missionMarkdown: '# Path test mission content',
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
      const routeLayer = saveProductArtifactsRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Compute expected paths using path.join (same as route handler)
        const expectedMissionDir = path.join(projectParentFolder, 'agent-os', 'product');
        const expectedMissionFile = path.join(expectedMissionDir, 'MISSION.MD');

        // Verify mkdir was called with the correct directory path
        expect(mockMkdir).toHaveBeenCalledWith(expectedMissionDir, { recursive: true });

        // Verify writeFile was called with the temp file path
        expect(mockWriteFile).toHaveBeenCalledWith(
          expectedMissionFile + '.tmp',
          '# Path test mission content',
          'utf8'
        );

        // Verify rename was called with temp -> final path
        expect(mockRename).toHaveBeenCalledWith(
          expectedMissionFile + '.tmp',
          expectedMissionFile
        );

        // Verify no error occurred
        expect(mockNext).not.toHaveBeenCalled();
      } else {
        fail('Route handler not found');
      }
    });
  });

  // ============================================================================
  // Test E: Success log does not contain missionMarkdown content
  // ============================================================================
  describe('save_product_artifacts - logging does not leak missionMarkdown', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('success log contains missionMarkdownLength but not the markdown content itself', async () => {
      const mockProductDef = {
        id: 'prod-def-4',
        projectId: 'e5f6a7b8-c9d0-1234-efab-345678901234',
        productName: 'Log Test Product',
        createdAt: '2025-01-15T10:00:00.000Z',
        updatedAt: '2025-01-15T10:00:00.000Z',
      };

      // Setup axios mock
      const axios = require('axios');
      const mockAxiosInstance = {
        put: jest.fn().mockResolvedValue({ data: mockProductDef, status: 200 }),
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Setup session manager mock
      const sessionManager = require('../services/sessionManager');
      sessionManager.getOrCreateSession = jest.fn().mockReturnValue({
        sessionId: 'session-log',
        lastActivity: new Date(),
      });
      sessionManager.updateSession = jest.fn();

      // Setup fs mocks for success
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
      mockRename.mockResolvedValue(undefined);

      // Spy on console.log to capture logged arguments
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      // Import the route handler
      const { saveProductArtifactsRouter } = require('../routes/saveProductArtifactsRoute');

      const missionContent = '# Sensitive Mission Content\n\nThis should NOT appear in logs.';

      // Create mock request/response
      const mockReq = {
        body: {
          sessionId: 'session-log',
          projectParentFolder: '/projects/log-test',
          projectId: 'e5f6a7b8-c9d0-1234-efab-345678901234',
          productName: 'Log Test Product',
          missionMarkdown: missionContent,
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
      const routeLayer = saveProductArtifactsRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify console.log was called (success log)
        expect(consoleLogSpy).toHaveBeenCalled();

        // Serialize all console.log arguments to check what was logged
        const allLoggedArgs = consoleLogSpy.mock.calls
          .map(call => JSON.stringify(call))
          .join(' ');

        // Verify the missionMarkdown content string does NOT appear in logs
        expect(allLoggedArgs).not.toContain('Sensitive Mission Content');
        expect(allLoggedArgs).not.toContain('This should NOT appear in logs');

        // Verify that missionMarkdownLength IS logged (the byte length)
        expect(allLoggedArgs).toContain('missionMarkdownLength');

        // Verify no error occurred
        expect(mockNext).not.toHaveBeenCalled();
      } else {
        fail('Route handler not found');
      }

      // Restore console.log
      consoleLogSpy.mockRestore();
    });
  });
});
