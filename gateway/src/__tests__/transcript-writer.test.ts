/**
 * Tests for transcript writer functionality
 *
 * Spec 2026-01-14: Implement Assistant Stage 7 - Full Conversation and Execution Persistence to Disk
 * Task Group 4: Filesystem Write Layer
 * Task Group 5: Test Review and Gap Analysis - Additional strategic tests
 *
 * Spec 2026-01-15: Fix Implement Assistant Conversation Persistence
 * - Updated tests to use new function signature with featureId parameter
 * - deriveFolderName now uses featureId instead of sessionId
 *
 * Spec 2026-02-12: Generalize Conversation Persistence to Support Kind
 * - Updated buildTranscriptPath assertions to expect kind-prefixed paths (conversations/implement/<folderName>)
 */

import { promises as fs } from 'fs';
import path from 'path';
import {
  deriveFolderName,
  buildTranscriptPath,
  formatTranscript,
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

// Mock logger - use factory function to avoid hoisting issues
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

describe('Transcript Writer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
  });

  describe('deriveFolderName', () => {
    // Spec 2026-01-15: Tests now use featureId parameter instead of sessionId
    it('should convert title to lowercase and replace spaces with hyphens', () => {
      const result = deriveFolderName('My Test Feature', 'abc12345xyz');
      expect(result).toBe('my-test-feature-abc12345');
    });

    it('should remove special characters (keep alphanumeric and hyphens only)', () => {
      // featureId 'feature123456' -> slice(0, 8) = 'feature1'
      const result = deriveFolderName('Feature: Add @user login!', 'feature123456');
      expect(result).toBe('feature-add-user-login-feature1');
    });

    it('should append first 8 characters of featureId as suffix', () => {
      const result = deriveFolderName('Test', 'abcdefghijklmnop');
      expect(result).toMatch(/-abcdefgh$/);
    });

    it('should handle empty title by using fallback with featureId', () => {
      const result = deriveFolderName('', 'feature99xyz');
      expect(result).toBe('conversation-feature9');
    });

    it('should truncate very long titles to 50 chars before suffix', () => {
      const longTitle = 'A'.repeat(100);
      const result = deriveFolderName(longTitle, 'feature123456');
      // 50 chars for title (all a's) + 1 for hyphen + 8 for featureId = 59 max
      expect(result.length).toBeLessThanOrEqual(59);
      expect(result).toMatch(/-feature1$/);
    });

    it('should collapse multiple consecutive hyphens into one', () => {
      const result = deriveFolderName('Feature -- with --- dashes', 'feat12345678');
      expect(result).not.toContain('--');
    });
  });

  describe('buildTranscriptPath', () => {
    // Spec 2026-02-12: buildTranscriptPath now defaults to kind="implement", so paths include the kind segment
    it('should construct correct directory and file path', () => {
      const result = buildTranscriptPath('/base/path', 'my-feature-abc12345');
      expect(result.dirPath).toBe(path.join('/base/path', 'conversations', 'implement', 'my-feature-abc12345'));
      expect(result.filePath).toBe(path.join('/base/path', 'conversations', 'implement', 'my-feature-abc12345', 'full-conversation.txt'));
    });

    it('should use conversations subfolder', () => {
      const result = buildTranscriptPath('/tmp', 'test-folder');
      expect(result.dirPath).toContain('conversations');
    });
  });

  describe('formatTranscript', () => {
    it('should begin with header and timestamp', () => {
      const transcript: ConversationTranscript = {
        sessionId: 'test-session',
        entries: [],
        createdAt: '2026-01-14T10:00:00.000Z',
      };

      const result = formatTranscript(transcript);
      expect(result).toContain('=== IMPLEMENT ASSISTANT CONVERSATION TRANSCRIPT ===');
      expect(result).toContain('Generated:');
      expect(result).toContain('Session ID: test-session');
    });

    it('should format entries with role markers and phase', () => {
      const transcript: ConversationTranscript = {
        sessionId: 'test-session',
        entries: [
          {
            timestamp: '2026-01-14T10:00:00.000Z',
            phase: 'bootstrap',
            role: 'SYSTEM',
            content: 'System prompt content',
          },
          {
            timestamp: '2026-01-14T10:00:01.000Z',
            phase: 'bootstrap',
            role: 'USER',
            content: 'User message',
          },
        ],
        createdAt: '2026-01-14T10:00:00.000Z',
      };

      const result = formatTranscript(transcript);
      expect(result).toContain('--- [SYSTEM] (phase: bootstrap) @');
      expect(result).toContain('--- [USER] (phase: bootstrap) @');
      expect(result).toContain('System prompt content');
      expect(result).toContain('User message');
    });

    it('should add clear section label before PLANNER_HANDOFF entry', () => {
      const transcript: ConversationTranscript = {
        sessionId: 'test-session',
        entries: [
          {
            timestamp: '2026-01-14T10:00:00.000Z',
            phase: 'handoff',
            role: 'PLANNER_HANDOFF',
            content: '{"is_split": false}',
          },
        ],
        createdAt: '2026-01-14T10:00:00.000Z',
      };

      const result = formatTranscript(transcript);
      expect(result).toContain('=== FINAL HANDOFF PLAN (PLANNER OUTPUT) ===');
    });

    it('should add clear section label before ORCHESTRATION entry', () => {
      const transcript: ConversationTranscript = {
        sessionId: 'test-session',
        entries: [
          {
            timestamp: '2026-01-14T10:00:00.000Z',
            phase: 'handoff',
            role: 'ORCHESTRATION',
            content: '{"endpoint": "/api/v1/orchestrations"}',
          },
        ],
        createdAt: '2026-01-14T10:00:00.000Z',
      };

      const result = formatTranscript(transcript);
      expect(result).toContain('=== ORCHESTRATION EXECUTION ===');
    });

    it('should use blank lines between entries for readability', () => {
      const transcript: ConversationTranscript = {
        sessionId: 'test-session',
        entries: [
          {
            timestamp: '2026-01-14T10:00:00.000Z',
            phase: 'bootstrap',
            role: 'USER',
            content: 'First entry',
          },
          {
            timestamp: '2026-01-14T10:00:01.000Z',
            phase: 'bootstrap',
            role: 'ASSISTANT',
            content: 'Second entry',
          },
        ],
        createdAt: '2026-01-14T10:00:00.000Z',
      };

      const result = formatTranscript(transcript);
      // Check that there are blank lines separating entries
      const lines = result.split('\n');
      const blankLines = lines.filter(line => line === '');
      expect(blankLines.length).toBeGreaterThan(2);
    });
  });

  describe('writeTranscriptToFile', () => {
    const createTestTranscript = (): ConversationTranscript => ({
      sessionId: 'test-session-12345678',
      entries: [
        {
          timestamp: '2026-01-14T10:00:00.000Z',
          phase: 'bootstrap',
          role: 'USER',
          content: 'Test message',
        },
      ],
      createdAt: '2026-01-14T10:00:00.000Z',
    });

    // Spec 2026-01-15: Updated to use new signature with featureId parameter
    it('should use atomic write pattern (temp file + rename)', async () => {
      const transcript = createTestTranscript();

      await writeTranscriptToFile(transcript, 'Test Feature', 'feat-test-12345678');

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

    it('should create directory with recursive option', async () => {
      const transcript = createTestTranscript();

      await writeTranscriptToFile(transcript, 'Test Feature', 'feat-test-12345678');

      expect(mockMkdir).toHaveBeenCalledWith(
        expect.any(String),
        { recursive: true }
      );
    });

    it('should handle directory creation failure without throwing', async () => {
      mockMkdir.mockRejectedValue(new Error('Permission denied'));
      const transcript = createTestTranscript();

      // Should not throw
      await expect(writeTranscriptToFile(transcript, 'Test Feature', 'feat-test-12345678')).resolves.toBeUndefined();

      // Should log warning
      expect(mockLoggerWarn).toHaveBeenCalled();
      // Should not attempt to write file
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('should handle write failure without throwing (non-blocking)', async () => {
      mockWriteFile.mockRejectedValue(new Error('Disk full'));
      const transcript = createTestTranscript();

      // Should not throw
      await expect(writeTranscriptToFile(transcript, 'Test Feature', 'feat-test-12345678')).resolves.toBeUndefined();

      // Should log error
      expect(mockLoggerError).toHaveBeenCalled();
    });

    it('should log partial persistence when rename fails', async () => {
      mockRename.mockRejectedValue(new Error('Rename failed'));
      const transcript = createTestTranscript();

      await writeTranscriptToFile(transcript, 'Test Feature', 'feat-test-12345678');

      // Should log error about partial persistence
      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.stringContaining('Partial persistence'),
        expect.any(Object)
      );
    });

    it('should log success with full path and sessionId on successful write', async () => {
      const transcript = createTestTranscript();

      await writeTranscriptToFile(transcript, 'Test Feature', 'feat-test-12345678');

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        expect.stringContaining('Transcript written'),
        expect.objectContaining({
          sessionId: transcript.sessionId,
          path: expect.any(String),
        })
      );
    });
  });
});
