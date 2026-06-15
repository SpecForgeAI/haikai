/**
 * Tests for threadSummariser.ts -- Summarisation Service Module
 *
 * Spec 2026-03-02: Increment 11 -- Hub Bootstrap 6: Summarisation End-to-End
 * Task Group 2: threadSummariser.ts and Summarisation Prompt
 *
 * Tests:
 * 1. getSealedTaskIds returns an empty Set for a thread with no completion-chip messages
 * 2. getSealedTaskIds returns a Set containing 'task-1' and 'task-2' when thread has completion-chip messages with those taskIds
 * 3. countEligibleMessages returns 0 for a thread containing only system-role messages
 * 4. countEligibleMessages excludes messages whose taskId matches a sealed task ID (thread with 5 user+assistant messages, 2 belonging to a sealed task, returns 3)
 * 5. countEligibleMessages excludes system-role messages and sealed messages simultaneously (mixed thread returns correct count)
 * 6. maybeSummariseThread does NOT call sendChatRequest when eligible message count is below 40
 * 7. maybeSummariseThread calls sendChatRequest when eligible message count exceeds 40 (first-time summarisation)
 * 8. maybeSummariseThread for rolling summarisation includes PREVIOUS SUMMARY: prefix and NEW MESSAGES: section
 */

import { Thread, ThreadKey, ThreadMessage } from '../types/chatV2';

// Mock sendChatRequest via llmClient (threadSummariser now uses getLlmClient().sendChatRequest)
const mockSendChatRequest = jest.fn();
jest.mock('../services/llmClient', () => ({
  getLlmClient: () => ({
    sendChatRequest: (...args: unknown[]) => mockSendChatRequest(...args),
  }),
}));

// Mock threadStore before importing the module under test
jest.mock('../services/threadStore', () => ({
  getThread: jest.fn(),
  saveThread: jest.fn(),
}));

// Mock fs for prompt loading
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn().mockResolvedValue(
      'You are a summarisation assistant. Produce a concise summary with four sections: **Goals**, **Decisions**, **Open Questions**, **Current State**.'
    ),
  },
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

import { getSealedTaskIds, countEligibleMessages, maybeSummariseThread } from '../services/threadSummariser';
import { getThread, saveThread } from '../services/threadStore';

const mockGetThread = getThread as jest.MockedFunction<typeof getThread>;
const mockSaveThread = saveThread as jest.MockedFunction<typeof saveThread>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a minimal ThreadMessage with the given overrides */
function makeMessage(overrides: Partial<ThreadMessage> & { role: ThreadMessage['role']; content: string }): ThreadMessage {
  return {
    id: overrides.id || `msg-${Math.random().toString(36).slice(2, 8)}`,
    role: overrides.role,
    personaId: overrides.personaId ?? null,
    taskId: overrides.taskId ?? null,
    content: overrides.content,
    structuredResponse: overrides.structuredResponse ?? null,
    timestamp: overrides.timestamp || '2026-03-02T00:00:00.000Z',
  };
}

/** Creates a minimal Thread with the given messages and optional overrides */
function makeThread(messages: ThreadMessage[], overrides?: Partial<Thread>): Thread {
  return {
    threadKey: overrides?.threadKey || 'project:proj-001:hub',
    projectId: overrides?.projectId || 'proj-001',
    messages,
    activePersonaId: overrides?.activePersonaId ?? null,
    activeTaskId: overrides?.activeTaskId ?? null,
    summary: overrides?.summary ?? null,
    summarisedUpToIndex: overrides?.summarisedUpToIndex ?? 0,
    createdAt: overrides?.createdAt || '2026-03-02T00:00:00.000Z',
    updatedAt: overrides?.updatedAt || '2026-03-02T00:00:00.000Z',
  };
}

/** Generates N user+assistant message pairs (2 messages per pair) with optional taskId */
function generateMessages(count: number, taskId: string | null = null): ThreadMessage[] {
  const msgs: ThreadMessage[] = [];
  for (let i = 0; i < count; i++) {
    msgs.push(makeMessage({ role: 'user', content: `User message ${i + 1}`, taskId }));
    msgs.push(makeMessage({ role: 'assistant', content: `Assistant message ${i + 1}`, taskId }));
  }
  return msgs;
}

describe('threadSummariser (Spec 2026-03-02, Task Group 2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSaveThread.mockResolvedValue(undefined);
  });

  // ==========================================================================
  // Test 1: getSealedTaskIds returns empty Set for no completion-chip messages
  // ==========================================================================
  it('should return an empty Set when thread has no completion-chip messages', () => {
    const messages = [
      makeMessage({ role: 'user', content: 'Hello' }),
      makeMessage({ role: 'assistant', content: 'Hi there', taskId: 'task-1' }),
      makeMessage({ role: 'system', content: 'System prompt' }),
    ];
    const thread = makeThread(messages);

    const sealedIds = getSealedTaskIds(thread);

    expect(sealedIds).toBeInstanceOf(Set);
    expect(sealedIds.size).toBe(0);
  });

  // ==========================================================================
  // Test 2: getSealedTaskIds returns Set with task-1 and task-2 for completion-chip messages
  // ==========================================================================
  it('should return a Set containing task-1 and task-2 when thread has completion-chip messages', () => {
    const messages = [
      makeMessage({ role: 'user', content: 'Start task 1', taskId: 'task-1' }),
      makeMessage({
        role: 'assistant',
        content: 'Task 1 complete',
        taskId: 'task-1',
        structuredResponse: { type: 'completion-chip', taskId: 'task-1' },
      }),
      makeMessage({ role: 'user', content: 'Start task 2', taskId: 'task-2' }),
      makeMessage({
        role: 'assistant',
        content: 'Task 2 complete',
        taskId: 'task-2',
        structuredResponse: { type: 'completion-chip', taskId: 'task-2' },
      }),
      makeMessage({ role: 'user', content: 'Freeform message' }),
    ];
    const thread = makeThread(messages);

    const sealedIds = getSealedTaskIds(thread);

    expect(sealedIds).toBeInstanceOf(Set);
    expect(sealedIds.size).toBe(2);
    expect(sealedIds.has('task-1')).toBe(true);
    expect(sealedIds.has('task-2')).toBe(true);
  });

  // ==========================================================================
  // Test 3: countEligibleMessages returns 0 for thread with only system-role messages
  // ==========================================================================
  it('should return 0 when thread contains only system-role messages', () => {
    const messages = [
      makeMessage({ role: 'system', content: 'System prompt 1' }),
      makeMessage({ role: 'system', content: 'System prompt 2' }),
      makeMessage({ role: 'system', content: 'System prompt 3' }),
    ];
    const thread = makeThread(messages);

    const count = countEligibleMessages(thread);

    expect(count).toBe(0);
  });

  // ==========================================================================
  // Test 4: countEligibleMessages excludes messages with sealed taskId
  // ==========================================================================
  it('should exclude messages whose taskId matches a sealed task ID (5 msgs, 2 sealed = 3)', () => {
    const messages = [
      // 2 messages belonging to sealed task-1
      makeMessage({ role: 'user', content: 'User sealed 1', taskId: 'task-1' }),
      makeMessage({ role: 'assistant', content: 'Asst sealed 1', taskId: 'task-1' }),
      // Completion chip sealing task-1
      makeMessage({
        role: 'assistant',
        content: 'Task 1 complete',
        taskId: 'task-1',
        structuredResponse: { type: 'completion-chip', taskId: 'task-1' },
      }),
      // 3 non-sealed user+assistant messages
      makeMessage({ role: 'user', content: 'User msg 1' }),
      makeMessage({ role: 'assistant', content: 'Asst msg 1' }),
      makeMessage({ role: 'user', content: 'User msg 2' }),
    ];
    const thread = makeThread(messages);

    const count = countEligibleMessages(thread);

    // 3 sealed messages (2 task-1 messages + 1 completion-chip with task-1) excluded,
    // 3 non-sealed user/assistant messages remain
    expect(count).toBe(3);
  });

  // ==========================================================================
  // Test 5: countEligibleMessages excludes system-role AND sealed messages
  // ==========================================================================
  it('should exclude both system-role messages and sealed messages simultaneously', () => {
    const messages = [
      makeMessage({ role: 'system', content: 'System prompt' }),
      makeMessage({ role: 'user', content: 'Sealed user', taskId: 'task-x' }),
      makeMessage({
        role: 'assistant',
        content: 'Sealed completion',
        taskId: 'task-x',
        structuredResponse: { type: 'completion-chip', taskId: 'task-x' },
      }),
      makeMessage({ role: 'user', content: 'Eligible 1' }),
      makeMessage({ role: 'assistant', content: 'Eligible 2' }),
      makeMessage({ role: 'system', content: 'Another system msg' }),
      makeMessage({ role: 'user', content: 'Eligible 3' }),
    ];
    const thread = makeThread(messages);

    const count = countEligibleMessages(thread);

    // 2 system messages excluded, 2 sealed messages excluded (task-x user + completion-chip)
    // Remaining: 3 eligible messages (Eligible 1, Eligible 2, Eligible 3)
    expect(count).toBe(3);
  });

  // ==========================================================================
  // Test 6: maybeSummariseThread does NOT call sendChatRequest below threshold
  // ==========================================================================
  it('should NOT call sendChatRequest when eligible message count is below 40', async () => {
    // Generate 15 user+assistant pairs = 30 messages, all eligible (no sealed, no system)
    const messages = generateMessages(15);
    const thread = makeThread(messages);
    const threadKey: ThreadKey = { type: 'hub', projectId: 'proj-001' };

    await maybeSummariseThread(thread, threadKey, 'req-001');

    expect(mockSendChatRequest).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // Test 7: maybeSummariseThread calls sendChatRequest for first-time summarisation
  // ==========================================================================
  it('should call sendChatRequest when eligible count exceeds 40 (first-time summarisation)', async () => {
    // Generate 21 user+assistant pairs = 42 messages, all eligible
    const messages = generateMessages(21);
    const thread = makeThread(messages);
    const threadKey: ThreadKey = { type: 'hub', projectId: 'proj-001' };

    // Mock the LLM response
    mockSendChatRequest.mockResolvedValue({
      id: 'resp-001',
      content: '**Goals**\n- Build something\n\n**Decisions**\n- Use TypeScript',
      isFinal: true,
    });

    // Mock re-read of thread for atomic write
    mockGetThread.mockResolvedValue({ ...thread });

    await maybeSummariseThread(thread, threadKey, 'req-002');

    // Verify sendChatRequest was called
    expect(mockSendChatRequest).toHaveBeenCalledTimes(1);

    // Verify the messages array structure
    const callArgs = mockSendChatRequest.mock.calls[0];
    const llmMessages = callArgs[0];

    // First message should be system (summarisation prompt)
    expect(llmMessages[0].role).toBe('system');
    expect(typeof llmMessages[0].content).toBe('string');

    // Second message should be user (formatted conversation content)
    expect(llmMessages[1].role).toBe('user');
    expect(typeof llmMessages[1].content).toBe('string');
    // For first-time summarisation, user content should contain the formatted messages
    // but NOT contain 'PREVIOUS SUMMARY:'
    expect(llmMessages[1].content).not.toContain('PREVIOUS SUMMARY:');

    // Verify temperature and maxTokens options
    const options = callArgs[3];
    expect(options).toEqual({ temperature: 0.2, maxTokens: 2000, tools: [], toolChoice: 'none' });

    // Verify saveThread was called with updated summary
    expect(mockSaveThread).toHaveBeenCalledTimes(1);
  });

  // ==========================================================================
  // Test 8: maybeSummariseThread includes PREVIOUS SUMMARY and NEW MESSAGES for rolling
  // ==========================================================================
  it('should include PREVIOUS SUMMARY: and NEW MESSAGES: for rolling summarisation', async () => {
    // Generate 21 user+assistant pairs = 42 messages
    const messages = generateMessages(21);
    // Thread already has a summary and summarisedUpToIndex set to 30
    const thread = makeThread(messages, {
      summary: 'Previous summary content here',
      summarisedUpToIndex: 30,
    });
    const threadKey: ThreadKey = { type: 'hub', projectId: 'proj-001' };

    // Mock the LLM response
    mockSendChatRequest.mockResolvedValue({
      id: 'resp-002',
      content: '**Goals**\n- Updated goals\n\n**Decisions**\n- Updated decisions',
      isFinal: true,
    });

    // Mock re-read of thread for atomic write
    mockGetThread.mockResolvedValue({ ...thread });

    await maybeSummariseThread(thread, threadKey, 'req-003');

    // Verify sendChatRequest was called
    expect(mockSendChatRequest).toHaveBeenCalledTimes(1);

    const callArgs = mockSendChatRequest.mock.calls[0];
    const llmMessages = callArgs[0];
    const userContent = llmMessages[1].content as string;

    // Rolling summarisation should include the previous summary prefix
    expect(userContent).toContain('PREVIOUS SUMMARY:');
    expect(userContent).toContain('Previous summary content here');

    // Rolling summarisation should include the NEW MESSAGES section
    expect(userContent).toContain('NEW MESSAGES:');

    // Verify temperature and maxTokens options
    const options = callArgs[3];
    expect(options).toEqual({ temperature: 0.2, maxTokens: 2000, tools: [], toolChoice: 'none' });
  });
});
