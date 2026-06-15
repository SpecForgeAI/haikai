/**
 * Tests for route handler kind parameter handling
 *
 * Spec 2026-02-12: Generalize Conversation Persistence to Support Kind
 * Task Group 2: Route Handler Updates (implementConversations and implementState)
 *
 * 8 focused tests verifying that both implementConversations and implementState
 * routes correctly extract, validate, and pass the kind parameter through to
 * buildTranscriptPath.
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
jest.mock('../services/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

const mockMkdir = fs.mkdir as jest.MockedFunction<typeof fs.mkdir>;
const mockWriteFile = fs.writeFile as jest.MockedFunction<typeof fs.writeFile>;
const mockRename = fs.rename as jest.MockedFunction<typeof fs.rename>;
const mockReadFile = fs.readFile as jest.MockedFunction<typeof fs.readFile>;

// Import routers after mocks are set up
import { implementConversationsRouter } from '../routes/implementConversations';
import { implementStateRouter } from '../routes/implementState';

describe('Route Handler Kind Parameter Handling', () => {
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
    app.use('/api/implement-state', implementStateRouter);

    jest.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
  });

  // Shared test data
  const validGetQuery = {
    projectId: 'proj-123',
    featureId: 'feat-456',
    projectParentFolder: '/test/project/folder',
    featureTitle: 'Test Feature',
  };

  const validConversationPutBody = {
    projectId: 'proj-123',
    featureId: 'feat-456',
    projectParentFolder: '/test/project/folder',
    featureTitle: 'Test Feature',
    messages: [
      {
        role: 'user',
        phase: 'bootstrap',
        content: 'Hello',
        timestamp: '2026-02-12T10:00:00.000Z',
      },
    ],
  };

  const validStatePutBody = {
    projectId: 'proj-123',
    featureId: 'feat-456',
    projectParentFolder: '/test/project/folder',
    featureTitle: 'Test Feature',
    state: {
      schemaVersion: '1.0',
      someField: 'value',
    },
  };

  describe('implementConversations', () => {
    /**
     * Test 1: GET /api/implement-conversations?...&kind=product uses the correct kind-prefixed path
     */
    it('GET with kind=product reads from kind-prefixed path', async () => {
      const messages = [{ role: 'user', phase: 'bootstrap', content: 'Hi', timestamp: '2026-02-12T10:00:00.000Z' }];
      mockReadFile.mockResolvedValue(JSON.stringify(messages));

      await request(app)
        .get('/api/implement-conversations')
        .query({ ...validGetQuery, kind: 'product' });

      // Verify fs.readFile was called with a path containing /conversations/product/
      expect(mockReadFile).toHaveBeenCalledTimes(1);
      const readPath = mockReadFile.mock.calls[0][0] as string;
      expect(readPath).toContain(path.join('conversations', 'product'));
    });

    /**
     * Test 2: GET /api/implement-conversations without kind defaults to "implement" path segment
     */
    it('GET without kind defaults to "implement" path segment', async () => {
      const messages = [{ role: 'user', phase: 'bootstrap', content: 'Hi', timestamp: '2026-02-12T10:00:00.000Z' }];
      mockReadFile.mockResolvedValue(JSON.stringify(messages));

      await request(app)
        .get('/api/implement-conversations')
        .query(validGetQuery);

      expect(mockReadFile).toHaveBeenCalledTimes(1);
      const readPath = mockReadFile.mock.calls[0][0] as string;
      expect(readPath).toContain(path.join('conversations', 'implement'));
    });

    /**
     * Test 3: PUT /api/implement-conversations with body.kind="product" writes to kind-prefixed path
     */
    it('PUT with body.kind="product" writes to kind-prefixed path', async () => {
      const response = await request(app)
        .put('/api/implement-conversations')
        .send({ ...validConversationPutBody, kind: 'product' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify mkdir was called with a path containing /conversations/product/
      expect(mockMkdir).toHaveBeenCalled();
      const mkdirPath = mockMkdir.mock.calls[0][0] as string;
      expect(mkdirPath).toContain(path.join('conversations', 'product'));
    });

    /**
     * Test 4: PUT /api/implement-conversations with invalid kind="design" returns HTTP 400
     */
    it('PUT with invalid kind="design" returns HTTP 400 with error message', async () => {
      const response = await request(app)
        .put('/api/implement-conversations')
        .send({ ...validConversationPutBody, kind: 'design' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid kind');
      expect(response.body.error).toContain('Allowed values');
    });
  });

  describe('implementState', () => {
    /**
     * Test 5: GET /api/implement-state?...&kind=product uses the correct kind-prefixed path
     */
    it('GET with kind=product reads from kind-prefixed path', async () => {
      const state = { schemaVersion: '1.0', someField: 'value' };
      mockReadFile.mockResolvedValue(JSON.stringify(state));

      await request(app)
        .get('/api/implement-state')
        .query({ ...validGetQuery, kind: 'product' });

      expect(mockReadFile).toHaveBeenCalledTimes(1);
      const readPath = mockReadFile.mock.calls[0][0] as string;
      expect(readPath).toContain(path.join('conversations', 'product'));
    });

    /**
     * Test 6: GET /api/implement-state without kind defaults to "implement" path segment
     */
    it('GET without kind defaults to "implement" path segment', async () => {
      const state = { schemaVersion: '1.0', someField: 'value' };
      mockReadFile.mockResolvedValue(JSON.stringify(state));

      await request(app)
        .get('/api/implement-state')
        .query(validGetQuery);

      expect(mockReadFile).toHaveBeenCalledTimes(1);
      const readPath = mockReadFile.mock.calls[0][0] as string;
      expect(readPath).toContain(path.join('conversations', 'implement'));
    });

    /**
     * Test 7: PUT /api/implement-state with body.kind="product" writes to kind-prefixed path
     */
    it('PUT with body.kind="product" writes to kind-prefixed path', async () => {
      const response = await request(app)
        .put('/api/implement-state')
        .send({ ...validStatePutBody, kind: 'product' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify mkdir was called with a path containing /conversations/product/
      expect(mockMkdir).toHaveBeenCalled();
      const mkdirPath = mockMkdir.mock.calls[0][0] as string;
      expect(mkdirPath).toContain(path.join('conversations', 'product'));
    });

    /**
     * Test 8: PUT /api/implement-state with body.kind takes precedence over query.kind
     */
    it('PUT with body.kind takes precedence over query.kind', async () => {
      const response = await request(app)
        .put('/api/implement-state?kind=implement')
        .send({ ...validStatePutBody, kind: 'product' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // body.kind="product" should take precedence over query.kind="implement"
      expect(mockMkdir).toHaveBeenCalled();
      const mkdirPath = mockMkdir.mock.calls[0][0] as string;
      expect(mkdirPath).toContain(path.join('conversations', 'product'));
      // Ensure it does NOT contain the query kind path
      expect(mkdirPath).not.toContain(path.join('conversations', 'implement'));
    });
  });
});
