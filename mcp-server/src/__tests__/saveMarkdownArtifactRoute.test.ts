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

jest.mock('fs', () => ({
  promises: {
    mkdir: (...args: any[]) => mockMkdir(...args),
    writeFile: (...args: any[]) => mockWriteFile(...args),
    rename: (...args: any[]) => mockRename(...args),
  },
}));

describe('save_markdown_artifact Route Handler', () => {
  // ============================================================================
  // Test 3: MCP route validates input: rejects missing/invalid fields and
  //         unsafe filenames
  // ============================================================================
  describe('save_markdown_artifact - input validation', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('rejects missing projectId', async () => {
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({ put: jest.fn() });

      const { saveMarkdownArtifactRouter } = require('../routes/saveMarkdownArtifactRoute');

      const mockReq = {
        body: {
          sessionId: 'session-123',
          artifactFilename: 'TECH-STACK.MD',
          markdown: '# Content',
        },
      } as Partial<Request>;

      const mockRes = { json: jest.fn() } as Partial<Response>;
      const mockNext: NextFunction = jest.fn();

      const routeLayer = saveMarkdownArtifactRouter.stack.find(
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

    it('rejects invalid UUID for projectId', async () => {
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({ put: jest.fn() });

      const { saveMarkdownArtifactRouter } = require('../routes/saveMarkdownArtifactRoute');

      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: 'not-a-uuid',
          artifactFilename: 'TECH-STACK.MD',
          markdown: '# Content',
        },
      } as Partial<Request>;

      const mockRes = { json: jest.fn() } as Partial<Response>;
      const mockNext: NextFunction = jest.fn();

      const routeLayer = saveMarkdownArtifactRouter.stack.find(
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

    it('rejects empty markdown', async () => {
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({ put: jest.fn() });

      const { saveMarkdownArtifactRouter } = require('../routes/saveMarkdownArtifactRoute');

      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          artifactFilename: 'TECH-STACK.MD',
          markdown: '',
        },
      } as Partial<Request>;

      const mockRes = { json: jest.fn() } as Partial<Response>;
      const mockNext: NextFunction = jest.fn();

      const routeLayer = saveMarkdownArtifactRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);
        expect(mockNext).toHaveBeenCalled();
        const error = (mockNext as jest.Mock).mock.calls[0][0];
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain('markdown');
      } else {
        fail('Route handler not found');
      }
    });

    it('rejects missing artifactFilename', async () => {
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({ put: jest.fn() });

      const { saveMarkdownArtifactRouter } = require('../routes/saveMarkdownArtifactRoute');

      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          markdown: '# Content',
        },
      } as Partial<Request>;

      const mockRes = { json: jest.fn() } as Partial<Response>;
      const mockNext: NextFunction = jest.fn();

      const routeLayer = saveMarkdownArtifactRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);
        expect(mockNext).toHaveBeenCalled();
        const error = (mockNext as jest.Mock).mock.calls[0][0];
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain('artifactFilename');
      } else {
        fail('Route handler not found');
      }
    });

    it('rejects unsafe filenames containing ..', async () => {
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({ put: jest.fn() });

      const sessionManager = require('../services/sessionManager');
      sessionManager.getOrCreateSession = jest.fn().mockReturnValue({
        sessionId: 'session-123',
        lastActivity: new Date(),
      });

      const { saveMarkdownArtifactRouter } = require('../routes/saveMarkdownArtifactRoute');

      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          artifactFilename: '../etc/passwd.MD',
          markdown: '# Content',
        },
      } as Partial<Request>;

      const mockRes = { json: jest.fn() } as Partial<Response>;
      const mockNext: NextFunction = jest.fn();

      const routeLayer = saveMarkdownArtifactRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);
        expect(mockNext).toHaveBeenCalled();
        const error = (mockNext as jest.Mock).mock.calls[0][0];
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain('path traversal');
      } else {
        fail('Route handler not found');
      }
    });

    it('rejects unsafe filenames containing /', async () => {
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({ put: jest.fn() });

      const { saveMarkdownArtifactRouter } = require('../routes/saveMarkdownArtifactRoute');

      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          artifactFilename: 'subdir/TECH-STACK.MD',
          markdown: '# Content',
        },
      } as Partial<Request>;

      const mockRes = { json: jest.fn() } as Partial<Response>;
      const mockNext: NextFunction = jest.fn();

      const routeLayer = saveMarkdownArtifactRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);
        expect(mockNext).toHaveBeenCalled();
        const error = (mockNext as jest.Mock).mock.calls[0][0];
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain('path traversal');
      } else {
        fail('Route handler not found');
      }
    });

    it('rejects unsafe filenames containing backslash', async () => {
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({ put: jest.fn() });

      const { saveMarkdownArtifactRouter } = require('../routes/saveMarkdownArtifactRoute');

      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          artifactFilename: 'subdir\\TECH-STACK.MD',
          markdown: '# Content',
        },
      } as Partial<Request>;

      const mockRes = { json: jest.fn() } as Partial<Response>;
      const mockNext: NextFunction = jest.fn();

      const routeLayer = saveMarkdownArtifactRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);
        expect(mockNext).toHaveBeenCalled();
        const error = (mockNext as jest.Mock).mock.calls[0][0];
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain('path traversal');
      } else {
        fail('Route handler not found');
      }
    });

    it('rejects filenames with unsupported extension like .txt', async () => {
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({ put: jest.fn() });

      const { saveMarkdownArtifactRouter } = require('../routes/saveMarkdownArtifactRoute');

      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          artifactFilename: 'TECH-STACK.txt',
          markdown: '# Content',
        },
      } as Partial<Request>;

      const mockRes = { json: jest.fn() } as Partial<Response>;
      const mockNext: NextFunction = jest.fn();

      const routeLayer = saveMarkdownArtifactRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);
        expect(mockNext).toHaveBeenCalled();
        const error = (mockNext as jest.Mock).mock.calls[0][0];
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain('artifactFilename must end in');
      } else {
        fail('Route handler not found');
      }
    });

    it('rejects filenames with mixed case extension like .Md', async () => {
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({ put: jest.fn() });

      const { saveMarkdownArtifactRouter } = require('../routes/saveMarkdownArtifactRoute');

      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          artifactFilename: 'TECH-STACK.Md',
          markdown: '# Content',
        },
      } as Partial<Request>;

      const mockRes = { json: jest.fn() } as Partial<Response>;
      const mockNext: NextFunction = jest.fn();

      const routeLayer = saveMarkdownArtifactRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);
        expect(mockNext).toHaveBeenCalled();
        const error = (mockNext as jest.Mock).mock.calls[0][0];
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain('artifactFilename must end in');
      } else {
        fail('Route handler not found');
      }
    });

    it('accepts .yaml extension for OAS specs', async () => {
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({ put: jest.fn() });

      const sessionManager = require('../services/sessionManager');
      sessionManager.getOrCreateSession = jest.fn().mockReturnValue({
        sessionId: 'session-123',
        lastActivity: new Date(),
      });

      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
      mockRename.mockResolvedValue(undefined);

      const { saveMarkdownArtifactRouter } = require('../routes/saveMarkdownArtifactRoute');

      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          projectParentFolder: '/projects/test',
          artifactFilename: 'OAS-SPEC-MyAPI.yaml',
          markdown: 'openapi: 3.0.0\ninfo:\n  title: MyAPI',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const mockRes = { json: jsonMock } as Partial<Response>;
      const mockNext: NextFunction = jest.fn();

      const routeLayer = saveMarkdownArtifactRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);
        expect(jsonMock).toHaveBeenCalledWith({
          writtenPaths: ['agent-os/product/OAS-SPEC-MyAPI.yaml'],
        });
        expect(mockNext).not.toHaveBeenCalled();
      } else {
        fail('Route handler not found');
      }
    });

    it('accepts .json extension for OAS specs', async () => {
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({ put: jest.fn() });

      const sessionManager = require('../services/sessionManager');
      sessionManager.getOrCreateSession = jest.fn().mockReturnValue({
        sessionId: 'session-123',
        lastActivity: new Date(),
      });

      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
      mockRename.mockResolvedValue(undefined);

      const { saveMarkdownArtifactRouter } = require('../routes/saveMarkdownArtifactRoute');

      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          projectParentFolder: '/projects/test',
          artifactFilename: 'OAS-SPEC-MyAPI.json',
          markdown: '{"openapi":"3.0.0"}',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const mockRes = { json: jsonMock } as Partial<Response>;
      const mockNext: NextFunction = jest.fn();

      const routeLayer = saveMarkdownArtifactRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);
        expect(jsonMock).toHaveBeenCalledWith({
          writtenPaths: ['agent-os/product/OAS-SPEC-MyAPI.json'],
        });
        expect(mockNext).not.toHaveBeenCalled();
      } else {
        fail('Route handler not found');
      }
    });
  });

  // ============================================================================
  // Test 4: MCP route accepts valid input and writes file atomically
  // ============================================================================
  describe('save_markdown_artifact - valid request (atomic write)', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns HTTP 200 with writtenPaths on valid input using mkdir + tmp + rename', async () => {
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({ put: jest.fn() });

      const sessionManager = require('../services/sessionManager');
      sessionManager.getOrCreateSession = jest.fn().mockReturnValue({
        sessionId: 'session-123',
        lastActivity: new Date(),
      });

      // Setup fs mocks for success
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
      mockRename.mockResolvedValue(undefined);

      const { saveMarkdownArtifactRouter } = require('../routes/saveMarkdownArtifactRoute');

      const projectParentFolder = '/projects/my-project';
      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          projectParentFolder,
          artifactFilename: 'TECH-STACK.MD',
          markdown: '# Tech Stack\n\nReact, Node.js, PostgreSQL',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const mockRes = { json: jsonMock } as Partial<Response>;
      const mockNext: NextFunction = jest.fn();

      const routeLayer = saveMarkdownArtifactRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        // Verify response
        expect(jsonMock).toHaveBeenCalledWith({
          writtenPaths: ['agent-os/product/TECH-STACK.MD'],
        });
        expect(mockNext).not.toHaveBeenCalled();

        // Verify atomic write pattern
        const expectedDir = path.join(projectParentFolder, 'agent-os', 'product');
        const expectedFile = path.join(expectedDir, 'TECH-STACK.MD');

        expect(mockMkdir).toHaveBeenCalledWith(expectedDir, { recursive: true });
        expect(mockWriteFile).toHaveBeenCalledWith(
          expectedFile + '.tmp',
          '# Tech Stack\n\nReact, Node.js, PostgreSQL',
          'utf8'
        );
        expect(mockRename).toHaveBeenCalledWith(
          expectedFile + '.tmp',
          expectedFile
        );
      } else {
        fail('Route handler not found');
      }
    });

    it('accepts .md lowercase extension', async () => {
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({ put: jest.fn() });

      const sessionManager = require('../services/sessionManager');
      sessionManager.getOrCreateSession = jest.fn().mockReturnValue({
        sessionId: 'session-123',
        lastActivity: new Date(),
      });

      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
      mockRename.mockResolvedValue(undefined);

      const { saveMarkdownArtifactRouter } = require('../routes/saveMarkdownArtifactRoute');

      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          projectParentFolder: '/projects/test',
          artifactFilename: 'test-strategy.md',
          markdown: '# Test Strategy',
        },
      } as Partial<Request>;

      const jsonMock = jest.fn();
      const mockRes = { json: jsonMock } as Partial<Response>;
      const mockNext: NextFunction = jest.fn();

      const routeLayer = saveMarkdownArtifactRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        expect(jsonMock).toHaveBeenCalledWith({
          writtenPaths: ['agent-os/product/test-strategy.md'],
        });
        expect(mockNext).not.toHaveBeenCalled();
      } else {
        fail('Route handler not found');
      }
    });
  });

  // ============================================================================
  // Test 5: MCP route rejects markdown exceeding 200KB byte limit
  // ============================================================================
  describe('save_markdown_artifact - markdown too large', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('returns 400 Bad Request when markdown exceeds 200KB (204800 bytes)', async () => {
      const axios = require('axios');
      axios.create = jest.fn().mockReturnValue({ put: jest.fn() });

      const sessionManager = require('../services/sessionManager');
      sessionManager.getOrCreateSession = jest.fn().mockReturnValue({
        sessionId: 'session-123',
        lastActivity: new Date(),
      });

      const { saveMarkdownArtifactRouter } = require('../routes/saveMarkdownArtifactRoute');

      // Create markdown that exceeds 204800 bytes
      const largeMarkdown = 'X'.repeat(204801);
      const mockReq = {
        body: {
          sessionId: 'session-123',
          projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          artifactFilename: 'TECH-STACK.MD',
          markdown: largeMarkdown,
        },
      } as Partial<Request>;

      const mockRes = { json: jest.fn() } as Partial<Response>;
      const mockNext: NextFunction = jest.fn();

      const routeLayer = saveMarkdownArtifactRouter.stack.find(
        (layer: any) => layer.route?.path === '/'
      );
      const handler = routeLayer?.route?.stack[0]?.handle;

      if (handler) {
        await handler(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
        const error = (mockNext as jest.Mock).mock.calls[0][0];
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain('200KB');
      } else {
        fail('Route handler not found');
      }
    });
  });
});
