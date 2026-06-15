/**
 * Tests for transcript writer with projectParentFolder support
 *
 * Spec 2026-01-15: Fix Implement Assistant Conversation Persistence
 * Task Group 2: Update Transcript Writer for Project Parent Folder
 */

import { promises as fs } from 'fs';
import path from 'path';
import {
  deriveFolderName,
  buildTranscriptPath,
  writeTranscriptToFile,
} from '../services/transcriptWriter';
import { ConversationTranscript } from '../types/transcript';

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
  conversationPersistBasePath: '/tmp/fallback-transcripts',
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

jest.mock('../services/logger', () => {
  return {
    logger: {
      info: jest.fn((...args) => mockLoggerInfo(...args)),
      debug: jest.fn((...args) => mockLoggerDebug(...args)),
      error: jest.fn((...args) => mockLoggerError(...args)),
      warn: jest.fn((...args) => mockLoggerWarn(...args)),
    },
  };
});

// Mock fs module
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn(),
    writeFile: jest.fn(),
    rename: jest.fn(),
  },
}));

const mockMkdir = fs.mkdir as jest.MockedFunction<typeof fs.mkdir>;
const mockWriteFile = fs.writeFile as jest.MockedFunction<typeof fs.writeFile>;
const mockRename = fs.rename as jest.MockedFunction<typeof fs.rename>;

describe('Transcript Writer with projectParentFolder', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
  });

  const createTestTranscript = (): ConversationTranscript => ({
    sessionId: 'test-session-12345678',
    entries: [
      {
        timestamp: '2026-01-15T10:00:00.000Z',
        phase: 'bootstrap',
        role: 'USER',
        content: 'Test message',
      },
    ],
    createdAt: '2026-01-15T10:00:00.000Z',
  });

  describe('deriveFolderName with featureId', () => {
    it('should use featureId (first 8 chars) as suffix instead of sessionId', () => {
      // Task 2.2: deriveFolderName uses featureId for deterministic folder naming
      const result = deriveFolderName('My Feature', 'feat-123-abc-xyz-999');
      // First 8 chars of featureId: "feat-123"
      expect(result).toBe('my-feature-feat-123');
    });

    it('should construct folder name in format: <sanitized_title>-<featureId_prefix>', () => {
      const result = deriveFolderName('Add User Login', 'feature-456-def');
      // Sanitized: add-user-login, featureId prefix: feature-
      expect(result).toBe('add-user-login-feature-');
    });

    it('should handle short featureId (less than 8 chars)', () => {
      const result = deriveFolderName('Test', 'abc');
      // featureId is only 3 chars, use all of it
      expect(result).toBe('test-abc');
    });

    it('should handle empty featureId by using title with empty suffix', () => {
      // When featureId is empty but title is provided, use sanitized title with empty suffix
      const result = deriveFolderName('Test Feature', '');
      // Uses fallback - title is sanitized, suffix from empty featureId is empty
      expect(result).toBe('test-feature-');
    });

    it('should handle empty title with fallback', () => {
      const result = deriveFolderName('', 'feat12345678');
      // Empty title uses fallback: 'conversation-' + first 8 chars of featureId
      expect(result).toBe('conversation-feat1234');
    });

    it('should handle both empty title and empty featureId', () => {
      const result = deriveFolderName('', '');
      // Both empty uses the most basic fallback
      expect(result).toBe('conversation-');
    });
  });

  describe('writeTranscriptToFile with projectParentFolder', () => {
    it('should use projectParentFolder as base path when provided', async () => {
      const transcript = createTestTranscript();
      const projectParentFolder = '/home/user/my-project';

      await writeTranscriptToFile(
        transcript,
        'Test Feature',
        'feat-abc-12345678',
        projectParentFolder
      );

      // Verify mkdir was called with path under projectParentFolder
      expect(mockMkdir).toHaveBeenCalled();
      const mkdirPath = mockMkdir.mock.calls[0][0] as string;
      expect(mkdirPath).toContain('my-project');
      expect(mkdirPath).toContain('conversations');
    });

    it('should fall back to config.conversationPersistBasePath when projectParentFolder is not provided', async () => {
      const transcript = createTestTranscript();

      await writeTranscriptToFile(
        transcript,
        'Test Feature',
        'feat-abc-12345678'
        // No projectParentFolder provided
      );

      // Verify mkdir was called with path under config base path
      expect(mockMkdir).toHaveBeenCalled();
      const mkdirPath = mockMkdir.mock.calls[0][0] as string;
      expect(mkdirPath).toContain('fallback-transcripts');
    });

    it('should fall back to config when projectParentFolder is empty string', async () => {
      const transcript = createTestTranscript();

      await writeTranscriptToFile(
        transcript,
        'Test Feature',
        'feat-abc-12345678',
        '' // Empty string
      );

      // Verify mkdir was called with path under config base path
      expect(mockMkdir).toHaveBeenCalled();
      const mkdirPath = mockMkdir.mock.calls[0][0] as string;
      expect(mkdirPath).toContain('fallback-transcripts');
    });

    it('should preserve atomic write behavior (temp file then rename)', async () => {
      const transcript = createTestTranscript();

      await writeTranscriptToFile(
        transcript,
        'Test Feature',
        'feat-xyz-00000000',
        '/projects/myapp'
      );

      // Verify temp file was written
      expect(mockWriteFile).toHaveBeenCalled();
      const writeArgs = mockWriteFile.mock.calls[0];
      expect(writeArgs[0]).toContain('.tmp');

      // Verify rename was called
      expect(mockRename).toHaveBeenCalled();
      const renameArgs = mockRename.mock.calls[0];
      expect(renameArgs[0]).toContain('.tmp');
      expect(renameArgs[1]).toContain('full-conversation.txt');
      expect(renameArgs[1]).not.toContain('.tmp');
    });

    it('should include featureId in error logs', async () => {
      mockMkdir.mockRejectedValue(new Error('Permission denied'));
      const transcript = createTestTranscript();

      await writeTranscriptToFile(
        transcript,
        'Test Feature',
        'feat-error-test',
        '/invalid/path'
      );

      // Should log warning with featureId
      expect(mockLoggerWarn).toHaveBeenCalled();
      const logCall = mockLoggerWarn.mock.calls[0];
      expect(logCall[1]).toHaveProperty('featureId', 'feat-error-test');
    });

    it('should include projectParentFolder in error logs', async () => {
      mockWriteFile.mockRejectedValue(new Error('Disk full'));
      const transcript = createTestTranscript();

      await writeTranscriptToFile(
        transcript,
        'Test Feature',
        'feat-log-test',
        '/custom/project/path'
      );

      // Should log error with projectParentFolder
      expect(mockLoggerError).toHaveBeenCalled();
      const logCall = mockLoggerError.mock.calls[0];
      expect(logCall[1]).toHaveProperty('projectParentFolder', '/custom/project/path');
    });
  });
});
