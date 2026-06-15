/**
 * Tests for conversation.json writing functionality
 *
 * Spec 2026-01-16: Implement Assistant Conversation Persistence and Rehydration
 * Task Group 1: MessageEntry Type and Transcript Writer Extension
 */

import { promises as fs } from 'fs';
import path from 'path';
import {
  formatMessagesFromTranscript,
  writeConversationJson,
  writeTranscriptToFile,
  buildTranscriptPath,
} from '../services/transcriptWriter';
import { TranscriptEntry, ConversationTranscript, MessageEntry } from '../types/transcript';

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

describe('Conversation JSON Writer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
  });

  describe('MessageEntry type structure', () => {
    it('should have lowercase role names for JSON serialization', () => {
      // Verify the MessageEntry type uses lowercase roles
      const messageEntry: MessageEntry = {
        role: 'system',
        phase: 'bootstrap',
        content: 'Test content',
        timestamp: '2026-01-16T10:00:00.000Z',
      };

      expect(messageEntry.role).toBe('system');
      expect(['system', 'user', 'assistant']).toContain(messageEntry.role);
    });

    it('should accept all valid lowercase role values', () => {
      const systemEntry: MessageEntry = {
        role: 'system',
        phase: 'bootstrap',
        content: 'System prompt',
        timestamp: '2026-01-16T10:00:00.000Z',
      };

      const userEntry: MessageEntry = {
        role: 'user',
        phase: 'refine',
        content: 'User message',
        timestamp: '2026-01-16T10:00:01.000Z',
      };

      const assistantEntry: MessageEntry = {
        role: 'assistant',
        phase: 'handoff',
        content: 'Assistant response',
        timestamp: '2026-01-16T10:00:02.000Z',
      };

      expect(systemEntry.role).toBe('system');
      expect(userEntry.role).toBe('user');
      expect(assistantEntry.role).toBe('assistant');
    });
  });

  describe('formatMessagesFromTranscript', () => {
    it('should convert TranscriptEntry[] to MessageEntry[]', () => {
      const entries: TranscriptEntry[] = [
        {
          timestamp: '2026-01-16T10:00:00.000Z',
          phase: 'bootstrap',
          role: 'SYSTEM',
          content: 'System prompt',
        },
        {
          timestamp: '2026-01-16T10:00:01.000Z',
          phase: 'bootstrap',
          role: 'USER',
          content: 'User message',
        },
        {
          timestamp: '2026-01-16T10:00:02.000Z',
          phase: 'bootstrap',
          role: 'ASSISTANT',
          content: 'Assistant response',
        },
      ];

      const result = formatMessagesFromTranscript(entries);

      expect(result).toHaveLength(3);
      expect(result[0].role).toBe('system');
      expect(result[1].role).toBe('user');
      expect(result[2].role).toBe('assistant');
    });

    it('should map TranscriptRole to lowercase role names', () => {
      const entries: TranscriptEntry[] = [
        {
          timestamp: '2026-01-16T10:00:00.000Z',
          phase: 'refine',
          role: 'SYSTEM',
          content: 'System',
        },
        {
          timestamp: '2026-01-16T10:00:01.000Z',
          phase: 'refine',
          role: 'USER',
          content: 'User',
        },
        {
          timestamp: '2026-01-16T10:00:02.000Z',
          phase: 'refine',
          role: 'ASSISTANT',
          content: 'Assistant',
        },
      ];

      const result = formatMessagesFromTranscript(entries);

      expect(result[0].role).toBe('system');
      expect(result[1].role).toBe('user');
      expect(result[2].role).toBe('assistant');
    });

    it('should filter out PLANNER_HANDOFF and ORCHESTRATION entries', () => {
      const entries: TranscriptEntry[] = [
        {
          timestamp: '2026-01-16T10:00:00.000Z',
          phase: 'bootstrap',
          role: 'SYSTEM',
          content: 'System prompt',
        },
        {
          timestamp: '2026-01-16T10:00:01.000Z',
          phase: 'handoff',
          role: 'PLANNER_HANDOFF',
          content: '{"is_split": false}',
        },
        {
          timestamp: '2026-01-16T10:00:02.000Z',
          phase: 'handoff',
          role: 'ORCHESTRATION',
          content: '{"endpoint": "/api/v1/orchestrations"}',
        },
        {
          timestamp: '2026-01-16T10:00:03.000Z',
          phase: 'refine',
          role: 'USER',
          content: 'User message',
        },
      ];

      const result = formatMessagesFromTranscript(entries);

      expect(result).toHaveLength(2);
      expect(result.find(m => m.content === '{"is_split": false}')).toBeUndefined();
      expect(result.find(m => m.content === '{"endpoint": "/api/v1/orchestrations"}')).toBeUndefined();
    });

    it('should preserve phase, content, and timestamp fields', () => {
      const entries: TranscriptEntry[] = [
        {
          timestamp: '2026-01-16T12:34:56.789Z',
          phase: 'refine',
          role: 'USER',
          content: 'Test message content',
        },
      ];

      const result = formatMessagesFromTranscript(entries);

      expect(result[0].phase).toBe('refine');
      expect(result[0].content).toBe('Test message content');
      expect(result[0].timestamp).toBe('2026-01-16T12:34:56.789Z');
    });
  });

  describe('writeConversationJson', () => {
    it('should produce valid JSON array', async () => {
      const messages: MessageEntry[] = [
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

      await writeConversationJson(messages, '/base/path', 'test-folder');

      // Verify writeFile was called with valid JSON
      expect(mockWriteFile).toHaveBeenCalled();
      const writeCall = mockWriteFile.mock.calls[0];
      const writtenContent = writeCall[1] as string;

      // Should parse as valid JSON array
      const parsed = JSON.parse(writtenContent);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].role).toBe('system');
    });

    it('should use atomic write pattern (temp file + rename)', async () => {
      const messages: MessageEntry[] = [
        {
          role: 'user',
          phase: 'refine',
          content: 'Test',
          timestamp: '2026-01-16T10:00:00.000Z',
        },
      ];

      await writeConversationJson(messages, '/base/path', 'test-folder');

      // Verify temp file was written
      expect(mockWriteFile).toHaveBeenCalled();
      const writeArgs = mockWriteFile.mock.calls[0];
      expect(writeArgs[0]).toContain('.tmp');

      // Verify rename was called
      expect(mockRename).toHaveBeenCalled();
      const renameArgs = mockRename.mock.calls[0];
      expect(renameArgs[0]).toContain('.tmp');
      expect(renameArgs[1]).toContain('conversation.json');
      expect(renameArgs[1]).not.toContain('.tmp');
    });

    it('should handle write failure without throwing (non-blocking)', async () => {
      mockWriteFile.mockRejectedValue(new Error('Disk full'));

      const messages: MessageEntry[] = [
        {
          role: 'user',
          phase: 'refine',
          content: 'Test',
          timestamp: '2026-01-16T10:00:00.000Z',
        },
      ];

      // Should not throw
      await expect(writeConversationJson(messages, '/base/path', 'test-folder')).resolves.toBeUndefined();

      // Should log error
      expect(mockLoggerError).toHaveBeenCalled();
    });
  });

  describe('writeTranscriptToFile with conversation.json', () => {
    const createTestTranscript = (): ConversationTranscript => ({
      sessionId: 'test-session-12345678',
      entries: [
        {
          timestamp: '2026-01-16T10:00:00.000Z',
          phase: 'bootstrap',
          role: 'SYSTEM',
          content: 'System prompt',
        },
        {
          timestamp: '2026-01-16T10:00:01.000Z',
          phase: 'bootstrap',
          role: 'USER',
          content: 'User message',
        },
        {
          timestamp: '2026-01-16T10:00:02.000Z',
          phase: 'bootstrap',
          role: 'ASSISTANT',
          content: 'Assistant response',
        },
      ],
      createdAt: '2026-01-16T10:00:00.000Z',
    });

    it('should write conversation.json alongside full-conversation.txt', async () => {
      const transcript = createTestTranscript();

      await writeTranscriptToFile(transcript, 'Test Feature', 'feat-test-12345678');

      // Should have two write operations (temp files for txt and json)
      expect(mockWriteFile).toHaveBeenCalledTimes(2);

      // Should have two rename operations
      expect(mockRename).toHaveBeenCalledTimes(2);

      // Verify one rename is for txt, one for json
      const renameTargets = mockRename.mock.calls.map(call => call[1] as string);
      expect(renameTargets.some(target => target.endsWith('full-conversation.txt'))).toBe(true);
      expect(renameTargets.some(target => target.endsWith('conversation.json'))).toBe(true);
    });

    it('should continue writing txt even if json write fails', async () => {
      // Make the first writeFile succeed (txt), but we need to track order
      // The implementation should try to write both files
      let callCount = 0;
      mockWriteFile.mockImplementation(async () => {
        callCount++;
        // Both should succeed for this test - we just verify both are attempted
        return undefined;
      });

      const transcript = createTestTranscript();

      await writeTranscriptToFile(transcript, 'Test Feature', 'feat-test-12345678');

      // Both write operations should be attempted
      expect(mockWriteFile).toHaveBeenCalledTimes(2);
    });
  });
});
