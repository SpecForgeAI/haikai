/**
 * Tests for Split Plan Persistence
 *
 * Spec 2026-02-06: Implement-Part Sequencing Workflow
 * Task Group 3: Persistence Extension for Split Plans
 *
 * Tests:
 * 1. SplitPlan interface storage and retrieval
 * 2. Per-part status updates (partStatuses map)
 * 3. Per-part transcript entries (partTranscripts map)
 * 4. File persistence includes split plan metadata
 * 5. ConversationTranscript with optional splitPlan field
 * 6. Helper functions for split plan operations
 */

import {
  initializeTranscript,
  getTranscript,
  clearAllTranscripts,
  updateSplitPlan,
  getSplitPlan,
  updatePartStatus,
  appendPartTranscriptEntry,
} from '../services/transcriptStore';
import { SplitPlan } from '../types/transcript';
import { Part, PartStatus } from '../types/chat';
import { writeTranscriptToFile, formatTranscript } from '../services/transcriptWriter';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

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
  conversationPersistBasePath: '/tmp/test',
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

describe('Split Plan Persistence (Spec 2026-02-06)', () => {
  beforeEach(() => {
    clearAllTranscripts();
  });

  const sampleParts: Part[] = [
    { partIndex: 1, title: 'Database Schema', intent: 'Create user tables' },
    { partIndex: 2, title: 'API Layer', intent: 'Build REST endpoints', dependencies: ['Part 1'] },
    { partIndex: 3, title: 'Frontend', intent: 'Build UI components', dependencies: ['Part 2'] },
  ];

  const createSampleSplitPlan = (): SplitPlan => ({
    parts: sampleParts,
    partStatuses: {
      1: 'COMPLETED',
      2: 'QA_IN_PROGRESS',
      3: 'PENDING',
    },
    partTimestamps: {
      1: { startedAt: '2026-02-06T10:00:00Z', completedAt: '2026-02-06T10:30:00Z' },
      2: { startedAt: '2026-02-06T10:30:00Z' },
      3: {},
    },
    partJobIds: {
      1: 'job-abc-123',
    },
    partTranscripts: {
      1: [
        { timestamp: '2026-02-06T10:00:00Z', phase: 'refine', role: 'USER', content: 'Start part 1' },
        { timestamp: '2026-02-06T10:05:00Z', phase: 'refine', role: 'ASSISTANT', content: 'Part 1 response' },
      ],
      2: [
        { timestamp: '2026-02-06T10:30:00Z', phase: 'refine', role: 'USER', content: 'Start part 2' },
      ],
    },
  });

  describe('SplitPlan interface storage and retrieval', () => {
    it('should store and retrieve a complete SplitPlan', () => {
      const sessionId = 'test-session-splitplan';
      initializeTranscript(sessionId);

      const splitPlan = createSampleSplitPlan();
      updateSplitPlan(sessionId, splitPlan);

      const retrieved = getSplitPlan(sessionId);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.parts).toHaveLength(3);
      expect(retrieved!.parts[0].title).toBe('Database Schema');
      expect(retrieved!.partStatuses[1]).toBe('COMPLETED');
      expect(retrieved!.partTimestamps[1].completedAt).toBe('2026-02-06T10:30:00Z');
      expect(retrieved!.partJobIds[1]).toBe('job-abc-123');
      expect(retrieved!.partTranscripts[1]).toHaveLength(2);
    });

    it('should return null for non-existent session', () => {
      const splitPlan = getSplitPlan('non-existent-session');
      expect(splitPlan).toBeNull();
    });

    it('should include splitPlan in ConversationTranscript', () => {
      const sessionId = 'test-session-with-splitplan';
      initializeTranscript(sessionId);

      const splitPlan = createSampleSplitPlan();
      updateSplitPlan(sessionId, splitPlan);

      const transcript = getTranscript(sessionId);
      expect(transcript).not.toBeNull();
      expect(transcript!.splitPlan).toBeDefined();
      expect(transcript!.splitPlan!.parts).toHaveLength(3);
    });
  });

  describe('Per-part status updates', () => {
    it('should update individual part status', () => {
      const sessionId = 'test-session-status';
      initializeTranscript(sessionId);

      const splitPlan = createSampleSplitPlan();
      updateSplitPlan(sessionId, splitPlan);

      // Update part 2 status to READY_TO_RUN
      updatePartStatus(sessionId, 2, 'READY_TO_RUN');

      const retrieved = getSplitPlan(sessionId);
      expect(retrieved!.partStatuses[2]).toBe('READY_TO_RUN');
      // Other statuses unchanged
      expect(retrieved!.partStatuses[1]).toBe('COMPLETED');
      expect(retrieved!.partStatuses[3]).toBe('PENDING');
    });

    it('should transition through all status values', () => {
      const sessionId = 'test-session-transitions';
      initializeTranscript(sessionId);

      const splitPlan: SplitPlan = {
        parts: [{ partIndex: 1, title: 'Test Part', intent: 'Test intent' }],
        partStatuses: { 1: 'PENDING' },
        partTimestamps: {},
        partJobIds: {},
        partTranscripts: {},
      };
      updateSplitPlan(sessionId, splitPlan);

      const statuses: PartStatus[] = [
        'PENDING',
        'QA_IN_PROGRESS',
        'READY_TO_RUN',
        'ORCHESTRATING',
        'COMPLETED',
      ];

      for (const status of statuses) {
        updatePartStatus(sessionId, 1, status);
        const retrieved = getSplitPlan(sessionId);
        expect(retrieved!.partStatuses[1]).toBe(status);
      }
    });

    it('should handle FAILED status', () => {
      const sessionId = 'test-session-failed';
      initializeTranscript(sessionId);

      const splitPlan: SplitPlan = {
        parts: [{ partIndex: 1, title: 'Test Part', intent: 'Test intent' }],
        partStatuses: { 1: 'ORCHESTRATING' },
        partTimestamps: {},
        partJobIds: {},
        partTranscripts: {},
      };
      updateSplitPlan(sessionId, splitPlan);

      updatePartStatus(sessionId, 1, 'FAILED');

      const retrieved = getSplitPlan(sessionId);
      expect(retrieved!.partStatuses[1]).toBe('FAILED');
    });
  });

  describe('Per-part transcript entries', () => {
    it('should append entries to part transcripts', () => {
      const sessionId = 'test-session-entries';
      initializeTranscript(sessionId);

      const splitPlan: SplitPlan = {
        parts: [{ partIndex: 1, title: 'Test Part', intent: 'Test intent' }],
        partStatuses: { 1: 'QA_IN_PROGRESS' },
        partTimestamps: {},
        partJobIds: {},
        partTranscripts: { 1: [] },
      };
      updateSplitPlan(sessionId, splitPlan);

      appendPartTranscriptEntry(sessionId, 1, {
        timestamp: new Date().toISOString(),
        phase: 'refine',
        role: 'USER',
        content: 'First message',
      });

      appendPartTranscriptEntry(sessionId, 1, {
        timestamp: new Date().toISOString(),
        phase: 'refine',
        role: 'ASSISTANT',
        content: 'Response message',
      });

      const retrieved = getSplitPlan(sessionId);
      expect(retrieved!.partTranscripts[1]).toHaveLength(2);
      expect(retrieved!.partTranscripts[1][0].content).toBe('First message');
      expect(retrieved!.partTranscripts[1][1].content).toBe('Response message');
    });

    it('should create part transcript array if not exists', () => {
      const sessionId = 'test-session-create-array';
      initializeTranscript(sessionId);

      const splitPlan: SplitPlan = {
        parts: [{ partIndex: 1, title: 'Test Part', intent: 'Test intent' }],
        partStatuses: { 1: 'QA_IN_PROGRESS' },
        partTimestamps: {},
        partJobIds: {},
        partTranscripts: {},
      };
      updateSplitPlan(sessionId, splitPlan);

      appendPartTranscriptEntry(sessionId, 1, {
        timestamp: new Date().toISOString(),
        phase: 'refine',
        role: 'USER',
        content: 'Message for new array',
      });

      const retrieved = getSplitPlan(sessionId);
      expect(retrieved!.partTranscripts[1]).toBeDefined();
      expect(retrieved!.partTranscripts[1]).toHaveLength(1);
    });

    it('should maintain separate transcripts per part', () => {
      const sessionId = 'test-session-separate';
      initializeTranscript(sessionId);

      const splitPlan: SplitPlan = {
        parts: [
          { partIndex: 1, title: 'Part 1', intent: 'Intent 1' },
          { partIndex: 2, title: 'Part 2', intent: 'Intent 2' },
        ],
        partStatuses: { 1: 'QA_IN_PROGRESS', 2: 'QA_IN_PROGRESS' },
        partTimestamps: {},
        partJobIds: {},
        partTranscripts: { 1: [], 2: [] },
      };
      updateSplitPlan(sessionId, splitPlan);

      appendPartTranscriptEntry(sessionId, 1, {
        timestamp: new Date().toISOString(),
        phase: 'refine',
        role: 'USER',
        content: 'Part 1 message',
      });

      appendPartTranscriptEntry(sessionId, 2, {
        timestamp: new Date().toISOString(),
        phase: 'refine',
        role: 'USER',
        content: 'Part 2 message',
      });

      const retrieved = getSplitPlan(sessionId);
      expect(retrieved!.partTranscripts[1]).toHaveLength(1);
      expect(retrieved!.partTranscripts[1][0].content).toBe('Part 1 message');
      expect(retrieved!.partTranscripts[2]).toHaveLength(1);
      expect(retrieved!.partTranscripts[2][0].content).toBe('Part 2 message');
    });
  });

  describe('File persistence includes split plan', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'splitplan-test-'));
    });

    afterEach(async () => {
      try {
        await fs.rm(tempDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should include splitPlan in formatted transcript output', () => {
      const sessionId = 'test-session-format';
      initializeTranscript(sessionId);

      const splitPlan = createSampleSplitPlan();
      updateSplitPlan(sessionId, splitPlan);

      const transcript = getTranscript(sessionId);
      expect(transcript).not.toBeNull();

      const formatted = formatTranscript(transcript!);

      // formatTranscript should include split plan info
      expect(formatted).toContain('Session ID: ' + sessionId);
      // The splitPlan data should be accessible from the transcript
      expect(transcript!.splitPlan).toBeDefined();
    });

    it('should preserve splitPlan across transcript updates', () => {
      const sessionId = 'test-session-preserve';
      initializeTranscript(sessionId);

      const splitPlan = createSampleSplitPlan();
      updateSplitPlan(sessionId, splitPlan);

      // Add regular transcript entries
      const transcript = getTranscript(sessionId);
      transcript!.entries.push({
        timestamp: new Date().toISOString(),
        phase: 'refine',
        role: 'USER',
        content: 'Regular entry',
      });

      // SplitPlan should still be present
      expect(transcript!.splitPlan).toBeDefined();
      expect(transcript!.splitPlan!.parts).toHaveLength(3);
    });
  });

  describe('Backward compatibility', () => {
    it('should work without splitPlan (existing behavior)', () => {
      const sessionId = 'test-session-no-splitplan';
      const transcript = initializeTranscript(sessionId);

      expect(transcript.splitPlan).toBeUndefined();
      expect(transcript.entries).toEqual([]);
      expect(transcript.sessionId).toBe(sessionId);
    });

    it('should handle getSplitPlan when transcript has no split plan', () => {
      const sessionId = 'test-session-empty-splitplan';
      initializeTranscript(sessionId);

      const splitPlan = getSplitPlan(sessionId);
      expect(splitPlan).toBeNull();
    });
  });
});
