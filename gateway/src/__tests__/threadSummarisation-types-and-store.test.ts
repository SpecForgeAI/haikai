/**
 * Tests for Thread Interface Extension and ThreadStore Updates
 *
 * Spec 2026-03-02: Increment 11 -- Hub Bootstrap 6: Summarisation End-to-End
 * Task Group 1: Thread Interface Extension and ThreadStore Updates
 *
 * Tests:
 * 1. Thread interface accepts an object with summary: null and summarisedUpToIndex: 0 (compile-time type assertion)
 * 2. Thread interface accepts an object with summary: 'Some summary text' and summarisedUpToIndex: 25 (non-default values type assertion)
 * 3. createThread returns a Thread with summary: null and summarisedUpToIndex: 0 as defaults
 * 4. getThread successfully reads a legacy thread.json file that lacks summary and summarisedUpToIndex fields (backward compatibility)
 * 5. saveThread persists a thread with updated summary and summarisedUpToIndex values, and a subsequent getThread returns the updated fields
 * 6. saveThread uses atomic write pattern (writes to .tmp then renames) -- verify the final thread.json contains the expected JSON content
 *
 * All tests use a temporary directory (os.tmpdir()) to avoid polluting project directories.
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { ThreadKey, Thread, threadKeyToString } from '../types/chatV2';

let tmpDir: string;

// We must mock getConfig before importing the module under test
jest.mock('../config', () => ({
  getConfig: () => ({
    openaiApiKey: 'test-key',
    openaiModel: 'gpt-4o',
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiTimeoutMs: 120000,
    logLevel: 'error',
  }),
}));

// ---- Mock architectureModelClient ----
jest.mock('../services/architectureModelClient', () => ({
  fetchProjectFolder: jest.fn(async () => tmpDir),
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
  saveThread,
} from '../services/threadStore';

describe('Thread Interface Extension and ThreadStore Updates (Spec 2026-03-02, Task Group 1)', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'threadSummarisation-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // ==========================================================================
  // Test 1: Thread interface accepts summary: null and summarisedUpToIndex: 0
  // ==========================================================================
  it('should accept a Thread object with summary: null and summarisedUpToIndex: 0 (default values)', () => {
    const thread: Thread = {
      threadKey: 'project:proj-001:hub',
      projectId: 'proj-001',
      messages: [],
      activePersonaId: null,
      activeTaskId: null,
      summary: null,
      summarisedUpToIndex: 0,
      createdAt: '2026-03-02T00:00:00.000Z',
      updatedAt: '2026-03-02T00:00:00.000Z',
    };

    // Compile-time type assertion: these fields exist and accept default values
    expect(thread.summary).toBeNull();
    expect(thread.summarisedUpToIndex).toBe(0);
  });

  // ==========================================================================
  // Test 2: Thread interface accepts non-default summary and summarisedUpToIndex values
  // ==========================================================================
  it('should accept a Thread object with summary: "Some summary text" and summarisedUpToIndex: 25 (non-default values)', () => {
    const thread: Thread = {
      threadKey: 'project:proj-002:hub',
      projectId: 'proj-002',
      messages: [],
      activePersonaId: null,
      activeTaskId: null,
      summary: 'Some summary text',
      summarisedUpToIndex: 25,
      createdAt: '2026-03-02T00:00:00.000Z',
      updatedAt: '2026-03-02T00:00:00.000Z',
    };

    expect(thread.summary).toBe('Some summary text');
    expect(thread.summarisedUpToIndex).toBe(25);
  });

  // ==========================================================================
  // Test 3: createThread returns a Thread with summary: null and summarisedUpToIndex: 0
  // ==========================================================================
  it('should create a thread with summary: null and summarisedUpToIndex: 0 as defaults', async () => {
    const threadKey: ThreadKey = { type: 'hub', projectId: 'proj-create-summary' };

    const thread = await createThread(threadKey);

    expect(thread.summary).toBeNull();
    expect(thread.summarisedUpToIndex).toBe(0);
    // Also verify the existing fields are still correct
    expect(thread.threadKey).toBe(threadKeyToString(threadKey));
    expect(thread.messages).toEqual([]);
    expect(thread.activePersonaId).toBeNull();
    expect(thread.activeTaskId).toBeNull();
  });

  // ==========================================================================
  // Test 4: getThread reads a legacy thread.json lacking summary fields (backward compatibility)
  // ==========================================================================
  it('should default summary to null and summarisedUpToIndex to 0 for legacy thread files', async () => {
    const threadKey: ThreadKey = { type: 'hub', projectId: 'proj-legacy' };
    const filePath = threadKeyToPath(threadKey, tmpDir);

    // Write a legacy thread.json WITHOUT summary and summarisedUpToIndex fields
    const legacyThread = {
      threadKey: threadKeyToString(threadKey),
      projectId: 'proj-legacy',
      messages: [],
      activePersonaId: null,
      activeTaskId: null,
      createdAt: '2026-02-28T00:00:00.000Z',
      updatedAt: '2026-02-28T00:00:00.000Z',
    };

    const dirPath = path.dirname(filePath);
    await fs.mkdir(dirPath, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(legacyThread, null, 2), 'utf8');

    // Read it back via getThread -- should add defaults
    const thread = await getThread(threadKey);

    expect(thread).not.toBeNull();
    expect(thread!.summary).toBeNull();
    expect(thread!.summarisedUpToIndex).toBe(0);
    // Original fields should still be intact
    expect(thread!.threadKey).toBe(threadKeyToString(threadKey));
    expect(thread!.projectId).toBe('proj-legacy');
  });

  // ==========================================================================
  // Test 5: saveThread persists updated summary fields and getThread returns them
  // ==========================================================================
  it('should persist a thread with updated summary and summarisedUpToIndex via saveThread', async () => {
    const threadKey: ThreadKey = { type: 'hub', projectId: 'proj-save-summary' };

    // Create the thread first
    const thread = await createThread(threadKey);
    expect(thread.summary).toBeNull();
    expect(thread.summarisedUpToIndex).toBe(0);

    // Update summary fields
    thread.summary = '**Goals**\n- Build a product\n\n**Decisions**\n- Use React';
    thread.summarisedUpToIndex = 15;

    // Persist via saveThread
    await saveThread(threadKey, thread);

    // Read back via getThread
    const reloaded = await getThread(threadKey);

    expect(reloaded).not.toBeNull();
    expect(reloaded!.summary).toBe('**Goals**\n- Build a product\n\n**Decisions**\n- Use React');
    expect(reloaded!.summarisedUpToIndex).toBe(15);
  });

  // ==========================================================================
  // Test 6: saveThread uses atomic write pattern -- verify final thread.json content
  // ==========================================================================
  it('should use atomic write pattern and produce valid thread.json with summary fields', async () => {
    const threadKey: ThreadKey = { type: 'hub', projectId: 'proj-atomic-write' };
    const filePath = threadKeyToPath(threadKey, tmpDir);

    // Create and then save with updated summary
    const thread = await createThread(threadKey);
    thread.summary = 'Atomic write test summary';
    thread.summarisedUpToIndex = 10;

    await saveThread(threadKey, thread);

    // Directly read the file from disk to verify content
    const fileContent = await fs.readFile(filePath, 'utf8');
    const diskThread = JSON.parse(fileContent);

    expect(diskThread.summary).toBe('Atomic write test summary');
    expect(diskThread.summarisedUpToIndex).toBe(10);
    expect(diskThread.threadKey).toBe(threadKeyToString(threadKey));
    expect(diskThread.updatedAt).toBeDefined();

    // Verify the .tmp file does NOT exist (atomic write renames it away)
    const tmpPath = filePath + '.tmp';
    let tmpExists = true;
    try {
      await fs.access(tmpPath);
    } catch {
      tmpExists = false;
    }
    expect(tmpExists).toBe(false);
  });
});
