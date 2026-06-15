/**
 * Tests for Thread Persistence Store
 *
 * Spec 2026-02-28: Unified Conversation Engine v1 (Backend)
 * Task Group 5: Thread Persistence Store
 *
 * Updated for thread storage relocation: threadStore now resolves base paths
 * via fetchProjectFolder (architectureModelClient) instead of config.threadPersistBasePath.
 * Path patterns no longer include {projectId} segment.
 *
 * Tests:
 * 1. createThread() creates a new thread JSON file on disk at the correct path
 * 2. getThread() returns null when no thread file exists (ENOENT graceful degradation)
 * 3. getThread() returns the thread when the file exists
 * 4. appendMessage() adds a message to an existing thread and persists to disk
 * 5. rehydrate() loads a full thread from disk including all messages
 * 6. threadKeyToPath() produces deterministic filesystem paths for each ThreadKey variant
 * 7. deleteThread() deletes a thread file and returns true, returns false for ENOENT
 *
 * All tests use a temporary directory (os.tmpdir()) to avoid polluting project directories.
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { ThreadKey, ThreadMessage, Thread, threadKeyToString } from '../types/chatV2';

// Shared mutable test state for the tmpDir returned by fetchProjectFolder mock
let _testBasePath = '';

// Mock architectureModelClient.fetchProjectFolder to return tmpDir
jest.mock('../services/architectureModelClient', () => ({
  fetchProjectFolder: jest.fn(async () => _testBasePath),
}));

// Mock the logger to suppress output during tests
jest.mock('../services/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import {
  threadKeyToPath,
  createThread,
  getThread,
  appendMessage,
  rehydrate,
  deleteThread,
} from '../services/threadStore';

describe('Thread Persistence Store (Spec 2026-02-28, Task Group 5)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    // Create a unique temporary directory for each test
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'threadStore-test-'));
    _testBasePath = tmpDir;
  });

  afterEach(async () => {
    // Clean up temp directory after each test
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // ==========================================================================
  // Test 6: threadKeyToPath() produces deterministic filesystem paths
  // (Listed first because it is a pure function with no disk I/O)
  // Path patterns no longer include {projectId} segment.
  // ==========================================================================
  describe('threadKeyToPath()', () => {
    it('should produce deterministic filesystem paths for each ThreadKey variant', () => {
      const basePath = '/data/store';

      // Hub: {basePath}/threads/hub/thread.json
      const hubKey: ThreadKey = { type: 'hub', projectId: 'proj-001' };
      expect(threadKeyToPath(hubKey, basePath)).toBe(
        path.join('/data/store', 'threads', 'hub', 'thread.json')
      );

      // Feature: {basePath}/threads/feature/{featureId}/thread.json
      const featureKey: ThreadKey = { type: 'feature', projectId: 'proj-002', featureId: 'feat-abc' };
      expect(threadKeyToPath(featureKey, basePath)).toBe(
        path.join('/data/store', 'threads', 'feature', 'feat-abc', 'thread.json')
      );

      // Panel with entityId: {basePath}/threads/panel/{screen}/{entityId}/thread.json
      const panelKeyWithEntity: ThreadKey = { type: 'panel', projectId: 'proj-003', screen: 'entity-detail', entityId: 'ent-xyz' };
      expect(threadKeyToPath(panelKeyWithEntity, basePath)).toBe(
        path.join('/data/store', 'threads', 'panel', 'entity-detail', 'ent-xyz', 'thread.json')
      );

      // Panel without entityId: {basePath}/threads/panel/{screen}/_/thread.json
      const panelKeyNoEntity: ThreadKey = { type: 'panel', projectId: 'proj-004', screen: 'dashboard' };
      expect(threadKeyToPath(panelKeyNoEntity, basePath)).toBe(
        path.join('/data/store', 'threads', 'panel', 'dashboard', '_', 'thread.json')
      );
    });
  });

  // ==========================================================================
  // Test 1: createThread() creates a new thread JSON file on disk
  // ==========================================================================
  describe('createThread()', () => {
    it('should create a new thread JSON file on disk at the correct path', async () => {
      const threadKey: ThreadKey = { type: 'hub', projectId: 'proj-create-test' };
      const expectedPath = threadKeyToPath(threadKey, tmpDir);

      const thread = await createThread(threadKey);

      // Verify the returned Thread object has correct structure
      expect(thread.threadKey).toBe(threadKeyToString(threadKey));
      expect(thread.projectId).toBe('proj-create-test');
      expect(thread.messages).toEqual([]);
      expect(thread.activePersonaId).toBeNull();
      expect(thread.activeTaskId).toBeNull();
      expect(thread.createdAt).toBeDefined();
      expect(thread.updatedAt).toBeDefined();

      // Verify the file was actually written to disk
      const fileContent = await fs.readFile(expectedPath, 'utf8');
      const diskThread: Thread = JSON.parse(fileContent);

      expect(diskThread.threadKey).toBe(thread.threadKey);
      expect(diskThread.projectId).toBe(thread.projectId);
      expect(diskThread.messages).toEqual([]);
      expect(diskThread.createdAt).toBe(thread.createdAt);
      expect(diskThread.updatedAt).toBe(thread.updatedAt);
    });
  });

  // ==========================================================================
  // Test 2: getThread() returns null when no thread file exists (ENOENT)
  // ==========================================================================
  describe('getThread() ENOENT handling', () => {
    it('should return null when no thread file exists (ENOENT graceful degradation)', async () => {
      const threadKey: ThreadKey = { type: 'hub', projectId: 'nonexistent-project' };

      const result = await getThread(threadKey);

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // Test 3: getThread() returns the thread when the file exists
  // ==========================================================================
  describe('getThread() with existing file', () => {
    it('should return the thread when the file exists', async () => {
      const threadKey: ThreadKey = { type: 'feature', projectId: 'proj-get-test', featureId: 'feat-001' };

      // First create the thread
      const createdThread = await createThread(threadKey);

      // Then read it back
      const retrievedThread = await getThread(threadKey);

      expect(retrievedThread).not.toBeNull();
      expect(retrievedThread!.threadKey).toBe(createdThread.threadKey);
      expect(retrievedThread!.projectId).toBe(createdThread.projectId);
      expect(retrievedThread!.messages).toEqual(createdThread.messages);
      expect(retrievedThread!.createdAt).toBe(createdThread.createdAt);
      expect(retrievedThread!.updatedAt).toBe(createdThread.updatedAt);
      expect(retrievedThread!.activePersonaId).toBeNull();
      expect(retrievedThread!.activeTaskId).toBeNull();
    });
  });

  // ==========================================================================
  // Test 4: appendMessage() adds a message to an existing thread
  // ==========================================================================
  describe('appendMessage()', () => {
    it('should add a message to an existing thread and persist to disk', async () => {
      const threadKey: ThreadKey = { type: 'hub', projectId: 'proj-append-test' };

      // Create the thread first
      await createThread(threadKey);

      // Create a user message
      const userMessage: ThreadMessage = {
        id: 'msg-user-001',
        role: 'user',
        personaId: null,
        taskId: null,
        content: 'I want to build a task management application.',
        structuredResponse: null,
        timestamp: '2026-02-28T12:00:00.000Z',
      };

      // Append the message
      const updatedThread = await appendMessage(threadKey, userMessage);

      // Verify the returned thread has the message
      expect(updatedThread.messages).toHaveLength(1);
      expect(updatedThread.messages[0]).toEqual(userMessage);

      // Append a second message (assistant response)
      const assistantMessage: ThreadMessage = {
        id: 'msg-asst-001',
        role: 'assistant',
        personaId: 'product-manager',
        taskId: 'product-manager--define-product',
        content: 'Let me help you define your product.',
        structuredResponse: { phase: 'questions', questions: ['What is the target audience?'], summary: 'Starting discovery.' },
        timestamp: '2026-02-28T12:01:00.000Z',
      };

      const threadWithTwo = await appendMessage(threadKey, assistantMessage);
      expect(threadWithTwo.messages).toHaveLength(2);
      expect(threadWithTwo.messages[0]).toEqual(userMessage);
      expect(threadWithTwo.messages[1]).toEqual(assistantMessage);

      // Verify persistence by reading directly from disk
      const expectedPath = threadKeyToPath(threadKey, tmpDir);
      const fileContent = await fs.readFile(expectedPath, 'utf8');
      const diskThread: Thread = JSON.parse(fileContent);

      expect(diskThread.messages).toHaveLength(2);
      expect(diskThread.messages[0].id).toBe('msg-user-001');
      expect(diskThread.messages[1].id).toBe('msg-asst-001');
      expect(diskThread.messages[1].structuredResponse).toEqual(assistantMessage.structuredResponse);
    });
  });

  // ==========================================================================
  // Test 5: rehydrate() loads a full thread from disk including all messages
  // ==========================================================================
  describe('rehydrate()', () => {
    it('should load a full thread from disk including all messages', async () => {
      const threadKey: ThreadKey = { type: 'panel', projectId: 'proj-rehydrate', screen: 'entity-detail', entityId: 'ent-007' };

      // Create thread and add multiple messages
      await createThread(threadKey);

      const msg1: ThreadMessage = {
        id: 'msg-r-001',
        role: 'user',
        personaId: null,
        taskId: null,
        content: 'Show me the architecture.',
        structuredResponse: null,
        timestamp: '2026-02-28T14:00:00.000Z',
      };

      const msg2: ThreadMessage = {
        id: 'msg-r-002',
        role: 'assistant',
        personaId: 'architect',
        taskId: 'architect--define-architecture',
        content: 'Here is the current architecture overview.',
        structuredResponse: { phase: 'discovery', section: 'overview', questions: [], summary: 'Architecture overview provided.' },
        timestamp: '2026-02-28T14:01:00.000Z',
      };

      const msg3: ThreadMessage = {
        id: 'msg-r-003',
        role: 'user',
        personaId: null,
        taskId: null,
        content: 'Can you elaborate on the data model?',
        structuredResponse: null,
        timestamp: '2026-02-28T14:02:00.000Z',
      };

      await appendMessage(threadKey, msg1);
      await appendMessage(threadKey, msg2);
      await appendMessage(threadKey, msg3);

      // Rehydrate the thread from disk
      const rehydratedThread = await rehydrate(threadKey);

      expect(rehydratedThread).not.toBeNull();
      expect(rehydratedThread!.threadKey).toBe(threadKeyToString(threadKey));
      expect(rehydratedThread!.projectId).toBe('proj-rehydrate');
      expect(rehydratedThread!.messages).toHaveLength(3);
      expect(rehydratedThread!.messages[0].id).toBe('msg-r-001');
      expect(rehydratedThread!.messages[0].role).toBe('user');
      expect(rehydratedThread!.messages[1].id).toBe('msg-r-002');
      expect(rehydratedThread!.messages[1].role).toBe('assistant');
      expect(rehydratedThread!.messages[1].personaId).toBe('architect');
      expect(rehydratedThread!.messages[1].structuredResponse).toEqual(msg2.structuredResponse);
      expect(rehydratedThread!.messages[2].id).toBe('msg-r-003');
      expect(rehydratedThread!.messages[2].content).toBe('Can you elaborate on the data model?');
    });

    it('should return null when rehydrating a non-existent thread', async () => {
      const threadKey: ThreadKey = { type: 'hub', projectId: 'nonexistent-rehydrate' };

      const result = await rehydrate(threadKey);

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // Test 7: deleteThread() deletes a thread file and handles ENOENT
  // ==========================================================================
  describe('deleteThread()', () => {
    it('should delete an existing thread file and return true', async () => {
      const threadKey: ThreadKey = { type: 'hub', projectId: 'proj-delete-test' };

      // Create thread first
      await createThread(threadKey);

      // Verify file exists
      const filePath = threadKeyToPath(threadKey, tmpDir);
      const exists = await fs.access(filePath).then(() => true).catch(() => false);
      expect(exists).toBe(true);

      // Delete the thread
      const result = await deleteThread(threadKey);
      expect(result).toBe(true);

      // Verify file no longer exists
      const existsAfter = await fs.access(filePath).then(() => true).catch(() => false);
      expect(existsAfter).toBe(false);
    });

    it('should return false when deleting a non-existent thread', async () => {
      const threadKey: ThreadKey = { type: 'hub', projectId: 'nonexistent-delete' };

      const result = await deleteThread(threadKey);

      expect(result).toBe(false);
    });
  });
});
