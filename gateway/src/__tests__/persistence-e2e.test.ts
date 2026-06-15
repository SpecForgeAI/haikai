/**
 * End-to-End Integration Tests for Conversation Persistence
 *
 * Spec 2026-01-15: Fix Implement Assistant Conversation Persistence
 * Task Group 6: End-to-End Verification
 */

import { promises as fs } from 'fs';
import path from 'path';
import { deriveFolderName, buildTranscriptPath, formatTranscript, writeTranscriptToFile } from '../services/transcriptWriter';
import { ConversationTranscript, TranscriptEntry } from '../types/transcript';

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
  conversationPersistBasePath: '/tmp/e2e-transcripts',
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
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock fs for controlled testing
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

describe('Conversation Persistence E2E', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
  });

  describe('Full Persistence Flow', () => {
    it('should persist transcript to correct folder structure when all metadata provided', async () => {
      const transcript: ConversationTranscript = {
        sessionId: 'session-e2e-123',
        entries: [
          {
            timestamp: '2026-01-15T10:00:00.000Z',
            phase: 'bootstrap',
            role: 'SYSTEM',
            content: 'System prompt',
          },
          {
            timestamp: '2026-01-15T10:00:01.000Z',
            phase: 'refine',
            role: 'USER',
            content: 'Hello, I need help with this feature',
          },
          {
            timestamp: '2026-01-15T10:00:02.000Z',
            phase: 'refine',
            role: 'ASSISTANT',
            content: 'I can help you with that. What would you like to know?',
          },
        ],
        createdAt: '2026-01-15T10:00:00.000Z',
      };

      const projectParentFolder = '/home/user/my-project';
      const featureId = 'feat-abc-12345678';
      const featureTitle = 'Add User Login';

      await writeTranscriptToFile(transcript, featureTitle, featureId, projectParentFolder);

      // Verify folder was created with correct path
      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining('my-project'),
        { recursive: true }
      );
      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining('conversations'),
        { recursive: true }
      );
      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining('add-user-login-feat-abc'),
        { recursive: true }
      );

      // Verify file was written
      expect(mockWriteFile).toHaveBeenCalled();

      // Verify rename was called (atomic write)
      expect(mockRename).toHaveBeenCalled();
      const renameArgs = mockRename.mock.calls[0];
      expect(renameArgs[1]).toContain('full-conversation.txt');
    });

    it('should use config base path when projectParentFolder not provided', async () => {
      const transcript: ConversationTranscript = {
        sessionId: 'session-e2e-456',
        entries: [],
        createdAt: '2026-01-15T10:00:00.000Z',
      };

      await writeTranscriptToFile(transcript, 'Test Feature', 'feat-xyz-99999999');

      // Should use config base path
      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining('e2e-transcripts'),
        { recursive: true }
      );
    });

    it('should use featureId for deterministic folder naming across sessions', async () => {
      const featureId = 'feat-same-feature';
      const featureTitle = 'Same Feature';

      // Simulate two different sessions for the same feature
      const session1: ConversationTranscript = {
        sessionId: 'session-111',
        entries: [{ timestamp: '2026-01-15T10:00:00.000Z', phase: 'refine', role: 'USER', content: 'Message 1' }],
        createdAt: '2026-01-15T10:00:00.000Z',
      };

      const session2: ConversationTranscript = {
        sessionId: 'session-222',
        entries: [{ timestamp: '2026-01-15T11:00:00.000Z', phase: 'refine', role: 'USER', content: 'Message 2' }],
        createdAt: '2026-01-15T11:00:00.000Z',
      };

      await writeTranscriptToFile(session1, featureTitle, featureId, '/project');
      await writeTranscriptToFile(session2, featureTitle, featureId, '/project');

      // Both should use the same folder (based on featureId, not sessionId)
      const folder1 = deriveFolderName(featureTitle, featureId);
      const folder2 = deriveFolderName(featureTitle, featureId);
      expect(folder1).toBe(folder2);
      expect(folder1).toBe('same-feature-feat-sam');
    });
  });

  describe('Folder Structure Verification', () => {
    it('should build correct path structure: <base>/conversations/<kind>/<folder>/full-conversation.txt', () => {
      const basePath = '/home/user/project';
      const folderName = 'add-login-feat-123';

      const { dirPath, filePath } = buildTranscriptPath(basePath, folderName);

      expect(dirPath).toBe(path.join('/home/user/project', 'conversations', 'implement', 'add-login-feat-123'));
      expect(filePath).toBe(path.join('/home/user/project', 'conversations', 'implement', 'add-login-feat-123', 'full-conversation.txt'));
    });

    it('should derive folder name with format: <sanitized_title>-<featureId_prefix>', () => {
      const testCases = [
        { title: 'Add User Login', featureId: 'feat-123-abc-xyz', expected: 'add-user-login-feat-123' },
        { title: 'Create Dashboard', featureId: 'feature-99', expected: 'create-dashboard-feature-' },
        { title: 'Fix Bug #42', featureId: 'bug-42-fix', expected: 'fix-bug-42-bug-42-f' },
        { title: '', featureId: 'orphan-feat', expected: 'conversation-orphan-f' },
      ];

      for (const tc of testCases) {
        const result = deriveFolderName(tc.title, tc.featureId);
        expect(result).toBe(tc.expected);
      }
    });
  });

  describe('File Content Format Verification', () => {
    it('should format transcript with header, session info, and entries', () => {
      const transcript: ConversationTranscript = {
        sessionId: 'session-format-test',
        entries: [
          {
            timestamp: '2026-01-15T10:00:00.000Z',
            phase: 'bootstrap',
            role: 'SYSTEM',
            content: 'You are an implementation assistant.',
          },
          {
            timestamp: '2026-01-15T10:00:01.000Z',
            phase: 'refine',
            role: 'USER',
            content: 'What are the requirements?',
          },
          {
            timestamp: '2026-01-15T10:00:02.000Z',
            phase: 'refine',
            role: 'ASSISTANT',
            content: 'The requirements include: 1. User authentication 2. Dashboard',
          },
        ],
        createdAt: '2026-01-15T10:00:00.000Z',
      };

      const formatted = formatTranscript(transcript);

      // Verify header
      expect(formatted).toContain('=== IMPLEMENT ASSISTANT CONVERSATION TRANSCRIPT ===');
      expect(formatted).toContain('Session ID: session-format-test');

      // Verify entries
      expect(formatted).toContain('--- [SYSTEM] (phase: bootstrap) @');
      expect(formatted).toContain('--- [USER] (phase: refine) @');
      expect(formatted).toContain('--- [ASSISTANT] (phase: refine) @');

      // Verify content
      expect(formatted).toContain('You are an implementation assistant.');
      expect(formatted).toContain('What are the requirements?');
      expect(formatted).toContain('The requirements include:');
    });

    it('should add section labels for PLANNER_HANDOFF and ORCHESTRATION entries', () => {
      const transcript: ConversationTranscript = {
        sessionId: 'session-special-entries',
        entries: [
          {
            timestamp: '2026-01-15T10:00:00.000Z',
            phase: 'handoff',
            role: 'PLANNER_HANDOFF',
            content: '{"is_split": false, "handoff_intents": []}',
          },
          {
            timestamp: '2026-01-15T10:00:01.000Z',
            phase: 'handoff',
            role: 'ORCHESTRATION',
            content: '{"endpoint": "/api/v1/orchestrations", "success": true}',
          },
        ],
        createdAt: '2026-01-15T10:00:00.000Z',
      };

      const formatted = formatTranscript(transcript);

      expect(formatted).toContain('=== FINAL HANDOFF PLAN (PLANNER OUTPUT) ===');
      expect(formatted).toContain('=== ORCHESTRATION EXECUTION ===');
    });
  });

  describe('Atomic Write Behavior', () => {
    it('should write to temp file then rename for atomicity', async () => {
      const transcript: ConversationTranscript = {
        sessionId: 'session-atomic-test',
        entries: [],
        createdAt: '2026-01-15T10:00:00.000Z',
      };

      await writeTranscriptToFile(transcript, 'Atomic Test', 'feat-atomic', '/test/path');

      // Verify temp file was written first
      const writeArgs = mockWriteFile.mock.calls[0];
      expect(writeArgs[0]).toContain('.tmp');

      // Verify rename moves temp to final
      const renameArgs = mockRename.mock.calls[0];
      expect(renameArgs[0]).toContain('.tmp');
      expect(renameArgs[1]).not.toContain('.tmp');
      expect(renameArgs[1]).toContain('full-conversation.txt');
    });

    it('should not leave temp file if rename succeeds', async () => {
      const transcript: ConversationTranscript = {
        sessionId: 'session-cleanup-test',
        entries: [],
        createdAt: '2026-01-15T10:00:00.000Z',
      };

      await writeTranscriptToFile(transcript, 'Cleanup Test', 'feat-cleanup', '/test/path');

      // If rename succeeds, the temp file is effectively moved (not copied)
      // The mock just records the calls, but in real fs, temp file would be gone
      expect(mockRename).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should not throw on filesystem errors (non-blocking persistence)', async () => {
      mockMkdir.mockRejectedValue(new Error('Permission denied'));

      const transcript: ConversationTranscript = {
        sessionId: 'session-error-test',
        entries: [],
        createdAt: '2026-01-15T10:00:00.000Z',
      };

      // Should not throw
      await expect(
        writeTranscriptToFile(transcript, 'Error Test', 'feat-error', '/invalid/path')
      ).resolves.toBeUndefined();
    });
  });
});
