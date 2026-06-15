/**
 * Integration Tests for Implement Conversations Path Alignment
 *
 * Spec 2026-01-16: Fix Implement Conversation Rehydration Path Alignment
 * Task Group 4: End-to-End Path Alignment Verification
 *
 * These integration tests verify that:
 * - PUT then GET returns the same conversation (round-trip test)
 * - Path derivation produces identical results for GET and PUT with same inputs
 * - Real file system test - PUT writes, GET reads from exact same location
 */

import request from 'supertest';
import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Import the router under test
import { implementConversationsRouter } from '../routes/implementConversations';
import { deriveFolderName, buildTranscriptPath } from '../services/transcriptWriter';

// Mock logger to avoid noise in test output
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

describe('Implement Conversations Path Alignment Integration Tests', () => {
  let app: express.Application;
  let tempDir: string;

  beforeAll(async () => {
    // Create a real temporary directory for integration tests
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'implement-conversations-test-'));
  });

  afterAll(async () => {
    // Clean up temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

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
  });

  /**
   * Test 1: PUT then GET returns same conversation (round-trip test)
   *
   * This test verifies the core round-trip functionality:
   * - PUT a conversation with specific parameters
   * - GET the conversation with the same parameters
   * - Verify the retrieved messages match what was written
   */
  it('should return same conversation when GET follows PUT with identical parameters', async () => {
    const projectId = 'test-project-123';
    const featureId = 'feat-roundtrip-abcd1234';
    const featureTitle = 'Round Trip Test Feature';
    const projectParentFolder = tempDir;

    const originalMessages = [
      {
        role: 'system',
        phase: 'bootstrap',
        content: 'You are helping implement this feature.',
        timestamp: '2026-01-16T10:00:00.000Z',
      },
      {
        role: 'assistant',
        phase: 'bootstrap',
        content: 'I understand the feature requirements.',
        timestamp: '2026-01-16T10:00:01.000Z',
      },
      {
        role: 'user',
        phase: 'refine',
        content: 'What about error handling?',
        timestamp: '2026-01-16T10:00:02.000Z',
      },
      {
        role: 'assistant',
        phase: 'refine',
        content: 'Good question! We should handle network errors gracefully.',
        timestamp: '2026-01-16T10:00:03.000Z',
      },
    ];

    // PUT the conversation
    const putResponse = await request(app)
      .put('/api/implement-conversations')
      .send({
        projectId,
        featureId,
        projectParentFolder,
        featureTitle,
        messages: originalMessages,
      });

    expect(putResponse.status).toBe(200);
    expect(putResponse.body.success).toBe(true);

    // GET the conversation with identical parameters
    const getResponse = await request(app)
      .get('/api/implement-conversations')
      .query({
        projectId,
        featureId,
        projectParentFolder,
        featureTitle,
      });

    expect(getResponse.status).toBe(200);
    expect(getResponse.body.exists).toBe(true);
    expect(getResponse.body.messages).toHaveLength(originalMessages.length);

    // Verify each message matches
    for (let i = 0; i < originalMessages.length; i++) {
      expect(getResponse.body.messages[i]).toEqual(originalMessages[i]);
    }
  });

  /**
   * Test 2: Path derivation produces identical result for GET and PUT with same inputs
   *
   * This test directly verifies that:
   * - deriveFolderName produces consistent output for identical inputs
   * - buildTranscriptPath produces consistent output for identical inputs
   * - The final file path is deterministic
   */
  it('should derive identical paths for GET and PUT operations with same inputs', () => {
    const testCases = [
      {
        featureTitle: 'Simple Feature',
        featureId: 'feat-simple-12345678',
        projectParentFolder: '/test/project/path',
      },
      {
        featureTitle: 'Feature with Special Characters & Spaces',
        featureId: 'feat-special-abcdef99',
        projectParentFolder: 'C:\\Users\\Test\\Projects',
      },
      {
        featureTitle: 'UPPERCASE Feature TITLE',
        featureId: 'FEAT-UPPER-AAAABBBB',
        projectParentFolder: '/home/user/my-project',
      },
      {
        featureTitle: '---multiple---hyphens---',
        featureId: 'feat-hyphens-ccccdddd',
        projectParentFolder: '/path/with/many/levels',
      },
    ];

    for (const testCase of testCases) {
      // Call deriveFolderName twice with same inputs
      const folderName1 = deriveFolderName(testCase.featureTitle, testCase.featureId);
      const folderName2 = deriveFolderName(testCase.featureTitle, testCase.featureId);

      // Verify folder names are identical
      expect(folderName1).toBe(folderName2);

      // Call buildTranscriptPath twice with same inputs
      const { dirPath: dirPath1, filePath: filePath1 } = buildTranscriptPath(
        testCase.projectParentFolder,
        folderName1
      );
      const { dirPath: dirPath2, filePath: filePath2 } = buildTranscriptPath(
        testCase.projectParentFolder,
        folderName2
      );

      // Verify paths are identical
      expect(dirPath1).toBe(dirPath2);
      expect(filePath1).toBe(filePath2);

      // Verify the path structure is correct
      expect(dirPath1).toContain('conversations');
      expect(dirPath1).toContain(folderName1);
    }
  });

  /**
   * Test 3: Real file system test - PUT writes, GET reads from exact same location
   *
   * This test verifies real file system behavior:
   * - PUT creates a file at a specific location
   * - Verify the file exists at the expected path
   * - GET reads from the same path
   * - Both operations use identical path construction
   */
  it('should write and read from exact same file system location', async () => {
    const projectId = 'filesystem-test-project';
    const featureId = 'feat-filesystem-eeee1111';
    const featureTitle = 'File System Test Feature';
    const projectParentFolder = tempDir;

    const messages = [
      {
        role: 'assistant',
        phase: 'bootstrap',
        content: 'File system test message.',
        timestamp: '2026-01-16T11:00:00.000Z',
      },
    ];

    // Calculate expected path (same logic as both GET and PUT)
    const expectedFolderName = deriveFolderName(featureTitle, featureId);
    const { dirPath: expectedDirPath } = buildTranscriptPath(projectParentFolder, expectedFolderName);
    const expectedFilePath = path.join(expectedDirPath, 'conversation.json');

    // PUT the conversation
    const putResponse = await request(app)
      .put('/api/implement-conversations')
      .send({
        projectId,
        featureId,
        projectParentFolder,
        featureTitle,
        messages,
      });

    expect(putResponse.status).toBe(200);
    expect(putResponse.body.success).toBe(true);

    // Verify file exists at the expected path
    let fileExists = false;
    try {
      await fs.access(expectedFilePath);
      fileExists = true;
    } catch {
      fileExists = false;
    }
    expect(fileExists).toBe(true);

    // Read the file directly to verify contents
    const fileContent = await fs.readFile(expectedFilePath, 'utf8');
    const parsedContent = JSON.parse(fileContent);
    expect(parsedContent).toEqual(messages);

    // GET should read from the same location
    const getResponse = await request(app)
      .get('/api/implement-conversations')
      .query({
        projectId,
        featureId,
        projectParentFolder,
        featureTitle,
      });

    expect(getResponse.status).toBe(200);
    expect(getResponse.body.exists).toBe(true);
    expect(getResponse.body.messages).toEqual(messages);
  });
});
