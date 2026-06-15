/**
 * Tests for Implement Conversations Rehydration Path Alignment
 *
 * Spec 2026-01-16: Fix Implement Conversation Rehydration Path Alignment
 * Task Group 1: GET Endpoint Validation and Path Derivation
 *
 * These tests verify that the GET endpoint:
 * - Requires projectParentFolder and featureTitle query parameters
 * - Uses the same path derivation as the PUT endpoint
 * - Does NOT fall back to config.conversationPersistBasePath
 */

import request from 'supertest';
import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';

// Mock fs module
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn(),
    writeFile: jest.fn(),
    rename: jest.fn(),
    readFile: jest.fn(),
  },
}));

// Mock config - note: GET endpoint should NOT use this anymore
const mockConfig = {
  sessionTtlHours: 24,
  openaiApiKey: 'test-key',
  openaiModel: 'gpt-4o',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiTimeoutMs: 60000,
  mcpBaseUrl: 'http://localhost:8090',
  architectureModelServiceBaseUrl: 'http://localhost:8080',
  orchestrationServiceBaseUrl: 'http://localhost:8085',
  conversationPersistBasePath: '/config/default/path',
  port: 8081,
  maxToolCallsPerTurn: 8,
  maxOasBytes: 2097152,
  maxMessageBytes: 32768,
  rateLimitRpm: 60,
  rateLimitBurst: 20,
  maxConversationMessages: 80,
  maxConversationBytes: 200000,
  logLevel: 'info',
  allowedOrigins: ['http://localhost:5173'],
  enableToolTrace: false,
};

jest.mock('../config', () => ({
  getConfig: () => mockConfig,
}));

// Mock logger
const mockLoggerInfo = jest.fn();
const mockLoggerWarn = jest.fn();
const mockLoggerError = jest.fn();
const mockLoggerDebug = jest.fn();

jest.mock('../services/logger', () => ({
  logger: {
    info: jest.fn((...args) => mockLoggerInfo(...args)),
    debug: jest.fn((...args) => mockLoggerDebug(...args)),
    error: jest.fn((...args) => mockLoggerError(...args)),
    warn: jest.fn((...args) => mockLoggerWarn(...args)),
  },
}));

const mockMkdir = fs.mkdir as jest.MockedFunction<typeof fs.mkdir>;
const mockWriteFile = fs.writeFile as jest.MockedFunction<typeof fs.writeFile>;
const mockRename = fs.rename as jest.MockedFunction<typeof fs.rename>;
const mockReadFile = fs.readFile as jest.MockedFunction<typeof fs.readFile>;

// Import router after mocks are set up
import { implementConversationsRouter } from '../routes/implementConversations';
import { deriveFolderName, buildTranscriptPath } from '../services/transcriptWriter';

describe('Implement Conversations Rehydration Path Alignment', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    // Add requestId middleware simulation
    app.use((req, _res, next) => {
      (req as any).requestId = 'test-request-id';
      next();
    });
    app.use('/api/implement-conversations', implementConversationsRouter);

    jest.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
  });

  describe('GET / - Validation for projectParentFolder and featureTitle', () => {
    it('should return 400 when projectParentFolder is missing', async () => {
      const response = await request(app)
        .get('/api/implement-conversations')
        .query({
          projectId: 'proj-123',
          featureId: 'feat-456',
          featureTitle: 'Test Feature',
          // projectParentFolder is missing
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('projectParentFolder is required');
    });

    it('should return 400 when featureTitle is missing', async () => {
      const response = await request(app)
        .get('/api/implement-conversations')
        .query({
          projectId: 'proj-123',
          featureId: 'feat-456',
          projectParentFolder: '/test/project/folder',
          // featureTitle is missing
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('featureTitle is required');
    });

    it('should return 400 when projectParentFolder is empty string', async () => {
      const response = await request(app)
        .get('/api/implement-conversations')
        .query({
          projectId: 'proj-123',
          featureId: 'feat-456',
          projectParentFolder: '',
          featureTitle: 'Test Feature',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('projectParentFolder is required');
    });

    it('should return 400 when featureTitle is empty string', async () => {
      const response = await request(app)
        .get('/api/implement-conversations')
        .query({
          projectId: 'proj-123',
          featureId: 'feat-456',
          projectParentFolder: '/test/project/folder',
          featureTitle: '',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('featureTitle is required');
    });
  });

  describe('GET / - Path derivation matches PUT endpoint', () => {
    const validMessages = [
      {
        role: 'system',
        phase: 'bootstrap',
        content: 'System prompt',
        timestamp: '2026-01-16T10:00:00.000Z',
      },
      {
        role: 'user',
        phase: 'bootstrap',
        content: 'User message',
        timestamp: '2026-01-16T10:00:01.000Z',
      },
    ];

    it('should find conversation at correct path when all params provided (matching PUT path)', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(validMessages));

      const projectParentFolder = '/test/project/folder';
      const featureTitle = 'Test Feature';
      const featureId = 'feat-456-abcdefgh';

      const response = await request(app)
        .get('/api/implement-conversations')
        .query({
          projectId: 'proj-123',
          featureId,
          projectParentFolder,
          featureTitle,
        });

      expect(response.status).toBe(200);
      expect(response.body.exists).toBe(true);
      expect(response.body.messages).toEqual(validMessages);

      // Verify the path used matches what PUT would use
      const expectedFolderName = deriveFolderName(featureTitle, featureId);
      const { dirPath: expectedDirPath } = buildTranscriptPath(projectParentFolder, expectedFolderName);
      const expectedFilePath = path.join(expectedDirPath, 'conversation.json');

      expect(mockReadFile).toHaveBeenCalledTimes(1);
      // Normalize paths for comparison (handle Windows vs Unix)
      const actualPath = (mockReadFile.mock.calls[0][0] as string).replace(/\\/g, '/');
      const normalizedExpectedPath = expectedFilePath.replace(/\\/g, '/');
      expect(actualPath).toBe(normalizedExpectedPath);
    });

    it('should return exists:false when file not found at correct path', async () => {
      const error = new Error('ENOENT: no such file or directory');
      (error as any).code = 'ENOENT';
      mockReadFile.mockRejectedValue(error);

      const projectParentFolder = '/test/project/folder';
      const featureTitle = 'Test Feature';
      const featureId = 'feat-456-abcdefgh';

      const response = await request(app)
        .get('/api/implement-conversations')
        .query({
          projectId: 'proj-123',
          featureId,
          projectParentFolder,
          featureTitle,
        });

      expect(response.status).toBe(200);
      expect(response.body.exists).toBe(false);
      expect(response.body.messages).toEqual([]);

      // Verify the path checked matches what PUT would use
      const expectedFolderName = deriveFolderName(featureTitle, featureId);
      const { dirPath: expectedDirPath } = buildTranscriptPath(projectParentFolder, expectedFolderName);
      const expectedFilePath = path.join(expectedDirPath, 'conversation.json');

      expect(mockReadFile).toHaveBeenCalledTimes(1);
      const actualPath = (mockReadFile.mock.calls[0][0] as string).replace(/\\/g, '/');
      const normalizedExpectedPath = expectedFilePath.replace(/\\/g, '/');
      expect(actualPath).toBe(normalizedExpectedPath);
    });
  });

  describe('GET/PUT path alignment integration', () => {
    const validMessages = [
      {
        role: 'system',
        phase: 'bootstrap',
        content: 'System prompt',
        timestamp: '2026-01-16T10:00:00.000Z',
      },
    ];

    it('should use identical path derivation for GET and PUT with same inputs', async () => {
      // First, simulate a PUT request and capture the path
      const putBody = {
        projectId: 'proj-123',
        featureId: 'feat-456-abcdefgh',
        projectParentFolder: '/my/project/path',
        featureTitle: 'My Amazing Feature',
        messages: validMessages,
      };

      await request(app)
        .put('/api/implement-conversations')
        .send(putBody);

      // Capture the path that PUT used for writing
      const putWritePath = mockWriteFile.mock.calls.find((call) => {
        const filePath = call[0] as string;
        return filePath.includes('conversation.json');
      });
      expect(putWritePath).toBeDefined();
      const putDirPath = path.dirname(putWritePath![0] as string).replace(/\\/g, '/');

      // Clear mocks for GET test
      jest.clearAllMocks();
      mockReadFile.mockResolvedValue(JSON.stringify(validMessages));

      // Now make a GET request with the same params
      await request(app)
        .get('/api/implement-conversations')
        .query({
          projectId: putBody.projectId,
          featureId: putBody.featureId,
          projectParentFolder: putBody.projectParentFolder,
          featureTitle: putBody.featureTitle,
        });

      // Capture the path that GET used for reading
      const getReadPath = mockReadFile.mock.calls[0][0] as string;
      const getDirPath = path.dirname(getReadPath).replace(/\\/g, '/');

      // The paths should be identical
      expect(getDirPath).toBe(putDirPath);
    });

    it('should NOT use config.conversationPersistBasePath as fallback', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(validMessages));

      const projectParentFolder = '/explicit/project/path';
      const featureTitle = 'Test Feature';
      const featureId = 'feat-456-abcdefgh';

      await request(app)
        .get('/api/implement-conversations')
        .query({
          projectId: 'proj-123',
          featureId,
          projectParentFolder,
          featureTitle,
        });

      // Verify the path does NOT start with the config default path
      const readPath = mockReadFile.mock.calls[0][0] as string;
      expect(readPath).not.toContain('/config/default/path');

      // Verify it DOES use the projectParentFolder provided
      expect(readPath.replace(/\\/g, '/')).toContain(projectParentFolder);
    });
  });
});
