/**
 * Integration tests for the conversation "kind" feature
 *
 * Spec 2026-02-12: Generalize Conversation Persistence to Support Kind
 * Task Group 4: Test Review and Gap Analysis
 *
 * These tests fill critical coverage gaps not addressed by Task Groups 1-3:
 * - Null coercion safety for normalizeKind
 * - Whitespace handling in normalizeKind
 * - End-to-end path verification for writeTranscriptToFile with and without kind
 * - Uppercase kind normalization through HTTP route
 * - Co-location verification for implement-state PUT/GET round-trip without kind
 */

import path from 'path';
import { promises as fs } from 'fs';
import request from 'supertest';
import express from 'express';

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

import {
  normalizeKind,
  buildTranscriptPath,
  writeTranscriptToFile,
} from '../services/transcriptWriter';
import { implementConversationsRouter } from '../routes/implementConversations';
import { implementStateRouter } from '../routes/implementState';
import { ConversationTranscript } from '../types/transcript';

describe('Kind Feature Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
  });

  describe('normalizeKind boundary cases', () => {
    /**
     * Gap Test 1: null coercion safety
     * Ensures normalizeKind handles null input gracefully (JavaScript callers
     * may pass null even though TypeScript declares the param as string | undefined)
     */
    it('should return "implement" when called with null (coercion safety)', () => {
      const result = normalizeKind(null as any);
      expect(result).toBe('implement');
    });

    /**
     * Gap Test 2: whitespace handling
     * normalizeKind does NOT trim before toLowerCase/validation, so a whitespace-padded
     * valid kind like "  Product  " becomes "  product  " which is not in the allowlist.
     * This test documents the expected behavior: whitespace-padded inputs are rejected.
     */
    it('should throw for whitespace-padded kind "  Product  " (not trimmed before validation)', () => {
      expect(() => normalizeKind('  Product  ')).toThrow('Invalid kind');
    });
  });

  describe('writeTranscriptToFile end-to-end path verification', () => {
    const createTestTranscript = (): ConversationTranscript => ({
      sessionId: 'test-session-e2e',
      entries: [
        {
          timestamp: '2026-02-12T10:00:00.000Z',
          phase: 'bootstrap',
          role: 'USER',
          content: 'Test message for kind integration',
        },
      ],
      createdAt: '2026-02-12T10:00:00.000Z',
    });

    /**
     * Gap Test 3: writeTranscriptToFile with kind="product" produces files
     * under conversations/product/<folderName>/
     */
    it('should produce files under conversations/product/<folderName>/ with kind="product"', async () => {
      const transcript = createTestTranscript();
      const projectParentFolder = '/test/project';

      await writeTranscriptToFile(transcript, 'My Feature', 'feat-prod-12345678', projectParentFolder, 'product');

      // Verify mkdir was called and all mkdir paths contain /conversations/product/
      expect(mockMkdir).toHaveBeenCalled();
      const allMkdirPaths = mockMkdir.mock.calls.map(call => call[0] as string);
      for (const mkdirPath of allMkdirPaths) {
        expect(mkdirPath).toContain(path.join('conversations', 'product'));
        // Ensure it does NOT contain /conversations/implement/
        expect(mkdirPath).not.toContain(path.join('conversations', 'implement'));
      }
    });

    /**
     * Gap Test 4: writeTranscriptToFile without kind produces files
     * under conversations/implement/<folderName>/ (default)
     */
    it('should produce files under conversations/implement/<folderName>/ when kind is omitted', async () => {
      const transcript = createTestTranscript();
      const projectParentFolder = '/test/project';

      await writeTranscriptToFile(transcript, 'My Feature', 'feat-impl-12345678', projectParentFolder);

      // Verify mkdir was called and all mkdir paths contain /conversations/implement/
      expect(mockMkdir).toHaveBeenCalled();
      const allMkdirPaths = mockMkdir.mock.calls.map(call => call[0] as string);
      for (const mkdirPath of allMkdirPaths) {
        expect(mkdirPath).toContain(path.join('conversations', 'implement'));
      }
    });
  });

  describe('Route handler uppercase kind normalization', () => {
    let app: express.Application;

    beforeEach(() => {
      app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        (req as any).requestId = 'test-request-id';
        next();
      });
      app.use('/api/implement-conversations', implementConversationsRouter);
      app.use('/api/implement-state', implementStateRouter);
    });

    /**
     * Gap Test 5: PUT /api/implement-conversations with body.kind="IMPLEMENT" (uppercase)
     * succeeds after normalization
     */
    it('PUT /api/implement-conversations with uppercase kind="IMPLEMENT" succeeds', async () => {
      const response = await request(app)
        .put('/api/implement-conversations')
        .send({
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
          kind: 'IMPLEMENT',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify the path uses the normalized lowercase "implement"
      expect(mockMkdir).toHaveBeenCalled();
      const mkdirPath = mockMkdir.mock.calls[0][0] as string;
      expect(mkdirPath).toContain(path.join('conversations', 'implement'));
    });

    /**
     * Gap Test 6: PUT and GET /api/implement-state without kind ensures
     * co-location (both operations target the same default "implement" path)
     */
    it('PUT and GET /api/implement-state without kind use same default path (co-location)', async () => {
      const stateData = {
        schemaVersion: '1.0',
        someField: 'test-value',
      };

      // PUT state without kind
      const putResponse = await request(app)
        .put('/api/implement-state')
        .send({
          projectId: 'proj-123',
          featureId: 'feat-789',
          projectParentFolder: '/test/coloc/project',
          featureTitle: 'Co-Location Test',
          state: stateData,
        });

      expect(putResponse.status).toBe(200);
      expect(putResponse.body.success).toBe(true);

      // Capture the path used by PUT (from mkdir call)
      expect(mockMkdir).toHaveBeenCalled();
      const putDirPath = mockMkdir.mock.calls[0][0] as string;

      // Verify the PUT path uses the default "implement" kind segment
      expect(putDirPath).toContain(path.join('conversations', 'implement'));

      // Now GET state without kind
      mockReadFile.mockResolvedValue(JSON.stringify(stateData));
      const getResponse = await request(app)
        .get('/api/implement-state')
        .query({
          projectId: 'proj-123',
          featureId: 'feat-789',
          projectParentFolder: '/test/coloc/project',
          featureTitle: 'Co-Location Test',
        });

      expect(getResponse.status).toBe(200);

      // Verify readFile was called
      expect(mockReadFile).toHaveBeenCalled();
      const getFilePath = mockReadFile.mock.calls[0][0] as string;

      // Verify both PUT and GET use the same directory (both under conversations/implement/)
      // Extract the directory portion from the GET file path
      const getDirPath = path.dirname(getFilePath);
      expect(getDirPath).toBe(putDirPath);
    });
  });
});
