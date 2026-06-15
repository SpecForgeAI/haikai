/**
 * Tests for Target State Conversation Store
 *
 * Spec 2026-05-24: Target State Captured Decisions -- Data Plane
 * Task Group 7.1
 *
 * The store persists target-state conversation threads at
 *   {projectParentFolder}/threads/target-state-conversation/{targetArchitectureId}/thread.json
 *
 * It is a sibling to threadStore.ts (not an extension) and follows the same
 * fetchProjectFolder base-path resolution + atomic-write pattern.
 *
 * Tests:
 * 1. loadTargetStateConversation() on a project with no existing thread file
 *    returns the default envelope { schemaVersion: 1, threadId, turns: [] }.
 * 2. appendTurn() followed by loadTargetStateConversation() round-trips the
 *    appended turn in turns[].
 * 3. appendTurn() against a path whose parent directory does not exist
 *    auto-creates the directory (no thrown ENOENT).
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Shared mutable state for the tmpDir returned by the fetchProjectFolder mock
let _testBasePath = '';

jest.mock('../services/architectureModelClient', () => ({
  fetchProjectFolder: jest.fn(async () => _testBasePath),
}));

jest.mock('../services/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import {
  loadTargetStateConversation,
  appendTurn,
  targetStateConversationPath,
} from '../services/targetStateConversationStore';

describe('Target State Conversation Store (Spec 2026-05-24, Task Group 7)', () => {
  let tmpDir: string;
  const PROJECT_ID = 'proj-tsc-001';
  const TARGET_ARCH_ID = 'tgt-arch-aaa';

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'targetStateConversationStore-test-'));
    _testBasePath = tmpDir;
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // ==========================================================================
  // Test 1: load returns default envelope when file does not exist
  // ==========================================================================
  describe('loadTargetStateConversation()', () => {
    it('returns the default empty envelope when no thread file exists', async () => {
      const thread = await loadTargetStateConversation(PROJECT_ID, TARGET_ARCH_ID);

      expect(thread.schemaVersion).toBe(1);
      expect(typeof thread.threadId).toBe('string');
      expect(thread.threadId.length).toBeGreaterThan(0);
      expect(thread.turns).toEqual([]);

      // The default thread is NOT written to disk on load -- only on append
      const expectedPath = targetStateConversationPath(tmpDir, TARGET_ARCH_ID);
      const exists = await fs.access(expectedPath).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    });
  });

  // ==========================================================================
  // Test 2: append-then-load round-trips the turn
  // ==========================================================================
  describe('appendTurn() round-trip', () => {
    it('appends a turn and loadTargetStateConversation reads it back', async () => {
      const turn = {
        role: 'assistant',
        content: 'What database engine do you want?',
        timestamp: '2026-05-24T10:00:00.000Z',
      };

      await appendTurn(PROJECT_ID, TARGET_ARCH_ID, turn);

      const thread = await loadTargetStateConversation(PROJECT_ID, TARGET_ARCH_ID);

      expect(thread.schemaVersion).toBe(1);
      expect(thread.turns).toHaveLength(1);
      expect(thread.turns[0]).toEqual(turn);

      // Append a second turn and verify ordering preserved
      const secondTurn = { role: 'user', content: 'Postgres', timestamp: '2026-05-24T10:01:00.000Z' };
      await appendTurn(PROJECT_ID, TARGET_ARCH_ID, secondTurn);

      const reloaded = await loadTargetStateConversation(PROJECT_ID, TARGET_ARCH_ID);
      expect(reloaded.turns).toHaveLength(2);
      expect(reloaded.turns[0]).toEqual(turn);
      expect(reloaded.turns[1]).toEqual(secondTurn);
      // threadId stable across appends
      expect(reloaded.threadId).toBe(thread.threadId);
    });
  });

  // ==========================================================================
  // Test 3: append auto-creates parent directories when missing
  // ==========================================================================
  describe('appendTurn() directory creation', () => {
    it('auto-creates the parent directory when it does not exist', async () => {
      // tmpDir exists but neither threads/ nor target-state-conversation/{id}/ do
      const expectedPath = targetStateConversationPath(tmpDir, TARGET_ARCH_ID);
      const parentDir = path.dirname(expectedPath);

      const parentExistsBefore = await fs.access(parentDir).then(() => true).catch(() => false);
      expect(parentExistsBefore).toBe(false);

      // Should not throw ENOENT
      await expect(
        appendTurn(PROJECT_ID, TARGET_ARCH_ID, { role: 'user', content: 'hi' })
      ).resolves.not.toThrow();

      const parentExistsAfter = await fs.access(parentDir).then(() => true).catch(() => false);
      expect(parentExistsAfter).toBe(true);

      const fileExists = await fs.access(expectedPath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);
    });
  });
});
