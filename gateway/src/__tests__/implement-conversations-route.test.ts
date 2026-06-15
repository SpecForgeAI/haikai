/**
 * Tests for Implement Conversations Route
 *
 * Spec 2026-01-16: Implement Assistant Conversation Persistence and Rehydration
 * Task Group 2: Implement Conversations Route (GET and PUT)
 *
 * Spec 2026-01-16: Fix Implement Conversation Rehydration Path Alignment
 * - Updated GET tests to include projectParentFolder and featureTitle query params
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

// Mock config
const mockConfig = {
  sessionTtlHours: 24,
  openaiApiKey: 'test-key',
  openaiModel: 'gpt-4o',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiTimeoutMs: 60000,
  mcpBaseUrl: 'http://localhost:8090',
  architectureModelServiceBaseUrl: 'http://localhost:8080',
  orchestrationServiceBaseUrl: 'http://localhost:8085',
  conversationPersistBasePath: '/tmp/test-transcripts',
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

describe('Implement Conversations Route', () => {
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

  describe('GET /', () => {
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
      {
        role: 'assistant',
        phase: 'bootstrap',
        content: 'Assistant response',
        timestamp: '2026-01-16T10:00:02.000Z',
      },
    ];

    // Spec 2026-01-16: Fix Implement Conversation Rehydration Path Alignment
    // GET now requires projectParentFolder and featureTitle
    const validGetQuery = {
      projectId: 'proj-123',
      featureId: 'feat-456',
      projectParentFolder: '/test/project/folder',
      featureTitle: 'Test Feature',
    };

    it('should return { exists: true, messages: [...] } when file exists', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(validMessages));

      const response = await request(app)
        .get('/api/implement-conversations')
        .query(validGetQuery);

      expect(response.status).toBe(200);
      expect(response.body.exists).toBe(true);
      expect(response.body.messages).toEqual(validMessages);
    });

    it('should return { exists: false, messages: [] } when file missing', async () => {
      const error = new Error('ENOENT: no such file or directory');
      (error as any).code = 'ENOENT';
      mockReadFile.mockRejectedValue(error);

      const response = await request(app)
        .get('/api/implement-conversations')
        .query(validGetQuery);

      expect(response.status).toBe(200);
      expect(response.body.exists).toBe(false);
      expect(response.body.messages).toEqual([]);
    });

    it('should handle unreadable file gracefully (returns exists: false)', async () => {
      // Simulate permission denied error
      const error = new Error('EACCES: permission denied');
      (error as any).code = 'EACCES';
      mockReadFile.mockRejectedValue(error);

      const response = await request(app)
        .get('/api/implement-conversations')
        .query(validGetQuery);

      expect(response.status).toBe(200);
      expect(response.body.exists).toBe(false);
      expect(response.body.messages).toEqual([]);
      expect(mockLoggerWarn).toHaveBeenCalled();
    });

    it('should validate required query parameters (projectId, featureId)', async () => {
      // Missing projectId
      let response = await request(app)
        .get('/api/implement-conversations')
        .query({ featureId: 'feat-456', projectParentFolder: '/path', featureTitle: 'Title' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('projectId');

      // Missing featureId
      response = await request(app)
        .get('/api/implement-conversations')
        .query({ projectId: 'proj-123', projectParentFolder: '/path', featureTitle: 'Title' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('featureId');

      // Both missing
      response = await request(app)
        .get('/api/implement-conversations')
        .query({ projectParentFolder: '/path', featureTitle: 'Title' });

      expect(response.status).toBe(400);
    });
  });

  describe('PUT /', () => {
    const validPutBody = {
      projectId: 'proj-123',
      featureId: 'feat-456',
      projectParentFolder: '/test/project/folder',
      featureTitle: 'Test Feature',
      messages: [
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
      ],
    };

    it('should write conversation.json atomically', async () => {
      const response = await request(app)
        .put('/api/implement-conversations')
        .send(validPutBody);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify temp file was written
      expect(mockWriteFile).toHaveBeenCalled();
      const writeArgs = mockWriteFile.mock.calls[0];
      expect(writeArgs[0]).toContain('.tmp');

      // Verify rename was called (atomic write)
      expect(mockRename).toHaveBeenCalled();
      const renameArgs = mockRename.mock.calls[0];
      expect(renameArgs[0]).toContain('.tmp');
      expect(renameArgs[1]).toContain('conversation.json');
    });

    it('should write full-conversation.txt using formatTranscript pattern', async () => {
      const response = await request(app)
        .put('/api/implement-conversations')
        .send(validPutBody);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Should have two writes (one for json, one for txt)
      expect(mockWriteFile).toHaveBeenCalledTimes(2);

      // Find the txt write
      const txtWriteCall = mockWriteFile.mock.calls.find((call) => {
        const filePath = call[0] as string;
        return filePath.includes('full-conversation') && filePath.includes('.tmp');
      });
      expect(txtWriteCall).toBeDefined();

      // Verify transcript format is used
      const txtContent = txtWriteCall![1] as string;
      expect(txtContent).toContain('=== IMPLEMENT ASSISTANT CONVERSATION TRANSCRIPT ===');
    });

    it('should return { success: false } on write failure without throwing', async () => {
      mockWriteFile.mockRejectedValue(new Error('Disk full'));

      const response = await request(app)
        .put('/api/implement-conversations')
        .send(validPutBody);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(false);
      expect(mockLoggerError).toHaveBeenCalled();
    });

    it('should validate required body fields', async () => {
      // Missing projectId
      let response = await request(app)
        .put('/api/implement-conversations')
        .send({ ...validPutBody, projectId: undefined });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('projectId');

      // Missing featureId
      response = await request(app)
        .put('/api/implement-conversations')
        .send({ ...validPutBody, featureId: undefined });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('featureId');

      // Missing projectParentFolder
      response = await request(app)
        .put('/api/implement-conversations')
        .send({ ...validPutBody, projectParentFolder: undefined });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('projectParentFolder');

      // Missing featureTitle
      response = await request(app)
        .put('/api/implement-conversations')
        .send({ ...validPutBody, featureTitle: undefined });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('featureTitle');

      // Missing messages
      response = await request(app)
        .put('/api/implement-conversations')
        .send({ ...validPutBody, messages: undefined });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('messages');
    });
  });
});
