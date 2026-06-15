/**
 * Gap-Filling Tests for Increment 11 Summarisation Feature
 *
 * Spec 2026-03-02: Increment 11 -- Hub Bootstrap 6: Summarisation End-to-End
 * Task Group 5: Test Review and Gap Analysis
 *
 * These tests fill critical coverage gaps identified in the review of TG1-TG4.
 *
 * Gap Analysis Summary:
 * - TG1 (6 tests): Thread type, createThread defaults, getThread backward compat, saveThread persistence -- well covered.
 * - TG2 (8 tests): getSealedTaskIds, countEligibleMessages, maybeSummariseThread threshold/first-time/rolling -- covered
 *   but missing exact boundary (40 vs 41), formatMessagesForSummary output verification, and post-summarise state checks.
 * - TG3 (7 tests): Route handler integration with maybeSummariseThread trigger, summary injection, trimming, error handling -- well covered.
 * - TG4 (3 tests): Frontend Thread type assertions -- well covered.
 *
 * Gaps filled by this file:
 * 1. Boundary: exactly 40 eligible messages does NOT trigger summarisation
 * 2. Boundary: exactly 41 eligible messages DOES trigger summarisation
 * 3. formatMessagesForSummary (via maybeSummariseThread) excludes system and sealed messages, formats as User:/Assistant:
 * 4. Rolling summarisation only includes messages from summarisedUpToIndex onward (not earlier messages)
 * 5. loadSummarisationPrompt reads from disk on first call and caches for subsequent calls
 * 6. After maybeSummariseThread succeeds, saveThread is called with correct summary and summarisedUpToIndex values
 * 7. Thread with all messages belonging to sealed tasks has countEligibleMessages return 0
 * 8. maybeSummariseThread with mixed sealed/unsealed messages only sends unsealed messages to the LLM
 * 9. System messages reduce eligible count below threshold even when total message count is high
 * 10. The system message sent to the LLM contains the loaded prompt (non-empty) as first message
 */

import { Thread, ThreadKey, ThreadMessage } from '../types/chatV2';

// ---- Mocks ----

// Mock sendChatRequest
jest.mock('../services/openaiClient', () => ({
  sendChatRequest: jest.fn(),
}));

// Mock threadStore
jest.mock('../services/threadStore', () => ({
  getThread: jest.fn(),
  saveThread: jest.fn(),
}));

// Track fs.readFile calls for prompt loading tests
const mockReadFile = jest.fn().mockResolvedValue(
  'You are a summarisation assistant. Produce a concise summary.'
);
jest.mock('fs', () => ({
  promises: {
    readFile: (...args: unknown[]) => mockReadFile(...args),
  },
}));

// Mock logger
jest.mock('../services/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { getSealedTaskIds, countEligibleMessages, maybeSummariseThread } from '../services/threadSummariser';
import { sendChatRequest } from '../services/openaiClient';
import { getThread, saveThread } from '../services/threadStore';

const mockSendChatRequest = sendChatRequest as jest.MockedFunction<typeof sendChatRequest>;
const mockGetThread = getThread as jest.MockedFunction<typeof getThread>;
const mockSaveThread = saveThread as jest.MockedFunction<typeof saveThread>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function makeThread(messages: ThreadMessage[], overrides?: Partial<Thread>): Thread {
  return {
    threadKey: overrides?.threadKey || 'project:proj-gap:hub',
    projectId: overrides?.projectId || 'proj-gap',
    messages,
    activePersonaId: overrides?.activePersonaId ?? null,
    activeTaskId: overrides?.activeTaskId ?? null,
    summary: overrides?.summary ?? null,
    summarisedUpToIndex: overrides?.summarisedUpToIndex ?? 0,
    createdAt: overrides?.createdAt || '2026-03-02T00:00:00.000Z',
    updatedAt: overrides?.updatedAt || '2026-03-02T00:00:00.000Z',
  };
}

/** Generates N individual eligible messages (alternating user/assistant) */
function generateEligibleMessages(count: number): ThreadMessage[] {
  const msgs: ThreadMessage[] = [];
  for (let i = 0; i < count; i++) {
    const role = i % 2 === 0 ? 'user' : 'assistant';
    msgs.push(makeMessage({ role: role as 'user' | 'assistant', content: `${role === 'user' ? 'User' : 'Assistant'} message ${i + 1}` }));
  }
  return msgs;
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Increment 11 Summarisation -- Gap-Filling Tests (TG5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSaveThread.mockResolvedValue(undefined);
  });

  // ==========================================================================
  // Gap Test 1: Exactly 40 eligible messages does NOT trigger summarisation
  // The threshold is "exceeds 40" (count > 40), so 40 is NOT enough.
  // ==========================================================================
  it('should NOT trigger summarisation when thread has exactly 40 eligible messages (boundary)', async () => {
    const messages = generateEligibleMessages(40);
    const thread = makeThread(messages);
    const threadKey: ThreadKey = { type: 'hub', projectId: 'proj-gap' };

    await maybeSummariseThread(thread, threadKey, 'req-gap-1');

    // 40 eligible messages is NOT above threshold (threshold is > 40)
    expect(mockSendChatRequest).not.toHaveBeenCalled();
    expect(mockSaveThread).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // Gap Test 2: Exactly 41 eligible messages DOES trigger summarisation
  // 41 > 40 should trigger.
  // ==========================================================================
  it('should trigger summarisation when thread has exactly 41 eligible messages (boundary)', async () => {
    const messages = generateEligibleMessages(41);
    const thread = makeThread(messages);
    const threadKey: ThreadKey = { type: 'hub', projectId: 'proj-gap' };

    mockSendChatRequest.mockResolvedValue({
      id: 'resp-gap-2',
      content: '**Goals**\n- Test boundary',
      isFinal: true,
    });
    mockGetThread.mockResolvedValue({ ...thread });

    await maybeSummariseThread(thread, threadKey, 'req-gap-2');

    // 41 eligible messages exceeds threshold -> summarisation triggered
    expect(mockSendChatRequest).toHaveBeenCalledTimes(1);
    expect(mockSaveThread).toHaveBeenCalledTimes(1);
  });

  // ==========================================================================
  // Gap Test 3: formatMessagesForSummary (via maybeSummariseThread) excludes
  // system-role and sealed messages, formats as "User: ..." / "Assistant: ..."
  // ==========================================================================
  it('should format only eligible messages as User:/Assistant: lines, excluding system and sealed messages', async () => {
    const messages = [
      makeMessage({ role: 'system', content: 'System prompt to be excluded' }),
      makeMessage({ role: 'user', content: 'Sealed user msg', taskId: 'sealed-task' }),
      makeMessage({
        role: 'assistant',
        content: 'Sealed completion',
        taskId: 'sealed-task',
        structuredResponse: { type: 'completion-chip', taskId: 'sealed-task' },
      }),
      // Generate enough eligible messages to exceed threshold
      ...generateEligibleMessages(41),
    ];
    const thread = makeThread(messages);
    const threadKey: ThreadKey = { type: 'hub', projectId: 'proj-gap' };

    mockSendChatRequest.mockResolvedValue({
      id: 'resp-gap-3',
      content: '**Goals**\n- Format test',
      isFinal: true,
    });
    mockGetThread.mockResolvedValue({ ...thread });

    await maybeSummariseThread(thread, threadKey, 'req-gap-3');

    expect(mockSendChatRequest).toHaveBeenCalledTimes(1);

    const userContent = mockSendChatRequest.mock.calls[0][0][1].content as string;

    // System message content should NOT appear in the formatted output
    expect(userContent).not.toContain('System prompt to be excluded');

    // Sealed task messages should NOT appear
    expect(userContent).not.toContain('Sealed user msg');
    expect(userContent).not.toContain('Sealed completion');

    // Eligible messages should appear with the correct formatting
    expect(userContent).toContain('User: User message 1');
    expect(userContent).toContain('Assistant: Assistant message 2');
  });

  // ==========================================================================
  // Gap Test 4: Rolling summarisation includes only messages from
  // summarisedUpToIndex onward (not earlier messages)
  // ==========================================================================
  it('should include only messages from summarisedUpToIndex onward in rolling summarisation user-content', async () => {
    // Create 50 messages total, summary covers first 30
    const allMessages = generateEligibleMessages(50);
    const thread = makeThread(allMessages, {
      summary: 'Previous goals and decisions summary',
      summarisedUpToIndex: 30,
    });
    const threadKey: ThreadKey = { type: 'hub', projectId: 'proj-gap' };

    mockSendChatRequest.mockResolvedValue({
      id: 'resp-gap-4',
      content: '**Goals**\n- Rolling test',
      isFinal: true,
    });
    mockGetThread.mockResolvedValue({ ...thread });

    await maybeSummariseThread(thread, threadKey, 'req-gap-4');

    expect(mockSendChatRequest).toHaveBeenCalledTimes(1);
    const userContent = mockSendChatRequest.mock.calls[0][0][1].content as string;

    // Should contain the previous summary
    expect(userContent).toContain('PREVIOUS SUMMARY:');
    expect(userContent).toContain('Previous goals and decisions summary');
    expect(userContent).toContain('NEW MESSAGES:');

    // Messages from index 30 onward should appear (message 31 is at index 30)
    expect(userContent).toContain('User message 31');
    expect(userContent).toContain('Assistant message 32');
    expect(userContent).toContain('User message 49');
    expect(userContent).toContain('Assistant message 50');

    // Messages from before summarisedUpToIndex should NOT appear in the NEW MESSAGES section
    const newMessagesSection = userContent.split('NEW MESSAGES:')[1];
    expect(newMessagesSection).not.toContain('User message 1');
    expect(newMessagesSection).not.toContain('Assistant message 2');
    expect(newMessagesSection).not.toContain('User message 29');
    expect(newMessagesSection).not.toContain('Assistant message 30');
  });

  // ==========================================================================
  // Gap Test 5: loadSummarisationPrompt reads from disk on first call and
  // caches for subsequent calls (combined test because the module-level cache
  // persists across tests within the same Jest module instance)
  // ==========================================================================
  it('should load the summarisation prompt from disk on first call and cache for subsequent calls', async () => {
    const messages = generateEligibleMessages(41);
    const thread = makeThread(messages);
    const threadKey: ThreadKey = { type: 'hub', projectId: 'proj-gap' };

    mockSendChatRequest.mockResolvedValue({
      id: 'resp-gap-5a',
      content: 'Summary A',
      isFinal: true,
    });
    mockGetThread.mockResolvedValue({ ...thread });

    // First summarisation call: loadSummarisationPrompt should read from disk
    // Note: the prompt may have been loaded by an earlier test (test 2) due to
    // module-level caching. We verify caching behavior by checking that the
    // system message is non-empty (prompt was loaded at some point) and that
    // the readFile count does not increase on subsequent calls.
    await maybeSummariseThread(thread, threadKey, 'req-gap-5a');

    // Verify the system message contains the loaded prompt content (non-empty)
    const systemMessage = mockSendChatRequest.mock.calls[0][0][0];
    expect(systemMessage.role).toBe('system');
    expect(typeof systemMessage.content).toBe('string');
    expect((systemMessage.content as string).length).toBeGreaterThan(0);
    expect(systemMessage.content).toContain('summarisation');

    // Record readFile call count after first summarisation trigger in this test
    const readFileCountAfterFirst = mockReadFile.mock.calls.length;

    // Second summarisation call: should use cached prompt (no new readFile call)
    mockSendChatRequest.mockResolvedValue({
      id: 'resp-gap-5b',
      content: 'Summary B',
      isFinal: true,
    });
    mockGetThread.mockResolvedValue({ ...thread });

    await maybeSummariseThread(thread, threadKey, 'req-gap-5b');

    // readFile should NOT have been called again -- the prompt is cached
    expect(mockReadFile.mock.calls.length).toBe(readFileCountAfterFirst);

    // The second call should still use the same prompt content
    const systemMessage2 = mockSendChatRequest.mock.calls[1][0][0];
    expect(systemMessage2.content).toBe(systemMessage.content);
  });

  // ==========================================================================
  // Gap Test 6: After maybeSummariseThread succeeds, saveThread is called with
  // the correct summary text and summarisedUpToIndex = messages.length
  // ==========================================================================
  it('should call saveThread with summary set to LLM response and summarisedUpToIndex equal to messages.length', async () => {
    const messages = generateEligibleMessages(42);
    const thread = makeThread(messages);
    const threadKey: ThreadKey = { type: 'hub', projectId: 'proj-gap' };
    const expectedSummary = '**Goals**\n- Save test\n\n**Decisions**\n- Use atomic writes';

    mockSendChatRequest.mockResolvedValue({
      id: 'resp-gap-6',
      content: expectedSummary,
      isFinal: true,
    });
    // Re-read returns the same thread (simulating atomic read-modify-write)
    mockGetThread.mockResolvedValue({ ...thread, messages: [...messages] });

    await maybeSummariseThread(thread, threadKey, 'req-gap-6');

    // Verify saveThread was called with the correct values
    expect(mockSaveThread).toHaveBeenCalledTimes(1);
    const savedThread = mockSaveThread.mock.calls[0][1] as Thread;
    expect(savedThread.summary).toBe(expectedSummary);
    expect(savedThread.summarisedUpToIndex).toBe(42);
  });

  // ==========================================================================
  // Gap Test 7: Thread with all messages belonging to sealed tasks has
  // countEligibleMessages return 0
  // ==========================================================================
  it('should return 0 from countEligibleMessages when all messages belong to sealed tasks', () => {
    const messages = [
      makeMessage({ role: 'user', content: 'Task A msg', taskId: 'task-a' }),
      makeMessage({ role: 'assistant', content: 'Task A reply', taskId: 'task-a' }),
      makeMessage({
        role: 'assistant',
        content: 'Task A complete',
        taskId: 'task-a',
        structuredResponse: { type: 'completion-chip', taskId: 'task-a' },
      }),
      makeMessage({ role: 'user', content: 'Task B msg', taskId: 'task-b' }),
      makeMessage({ role: 'assistant', content: 'Task B reply', taskId: 'task-b' }),
      makeMessage({
        role: 'assistant',
        content: 'Task B complete',
        taskId: 'task-b',
        structuredResponse: { type: 'completion-chip', taskId: 'task-b' },
      }),
    ];
    const thread = makeThread(messages);

    const count = countEligibleMessages(thread);

    expect(count).toBe(0);
  });

  // ==========================================================================
  // Gap Test 8: maybeSummariseThread with mixed sealed and unsealed messages
  // only sends unsealed messages to the LLM
  // ==========================================================================
  it('should only send unsealed messages to the LLM when thread has mixed sealed and unsealed messages', async () => {
    // Create sealed task messages
    const sealedMessages: ThreadMessage[] = [
      makeMessage({ role: 'user', content: 'Sealed question', taskId: 'sealed-x' }),
      makeMessage({ role: 'assistant', content: 'Sealed answer', taskId: 'sealed-x' }),
      makeMessage({
        role: 'assistant',
        content: 'Sealed done',
        taskId: 'sealed-x',
        structuredResponse: { type: 'completion-chip', taskId: 'sealed-x' },
      }),
    ];

    // Create 41 unsealed eligible messages to exceed threshold
    const unsealedMessages = generateEligibleMessages(41);

    const allMessages = [...sealedMessages, ...unsealedMessages];
    const thread = makeThread(allMessages);
    const threadKey: ThreadKey = { type: 'hub', projectId: 'proj-gap' };

    mockSendChatRequest.mockResolvedValue({
      id: 'resp-gap-8',
      content: '**Goals**\n- Mixed test',
      isFinal: true,
    });
    mockGetThread.mockResolvedValue({ ...thread });

    await maybeSummariseThread(thread, threadKey, 'req-gap-8');

    expect(mockSendChatRequest).toHaveBeenCalledTimes(1);
    const userContent = mockSendChatRequest.mock.calls[0][0][1].content as string;

    // Sealed messages should NOT appear
    expect(userContent).not.toContain('Sealed question');
    expect(userContent).not.toContain('Sealed answer');
    expect(userContent).not.toContain('Sealed done');

    // Unsealed messages SHOULD appear
    expect(userContent).toContain('User message 1');
    expect(userContent).toContain('Assistant message 2');
  });

  // ==========================================================================
  // Gap Test 9: System messages reduce eligible count below threshold even
  // when total message count is high
  // ==========================================================================
  it('should NOT trigger summarisation when 42 total messages include 3 system messages leaving only 39 eligible', async () => {
    // Create 39 eligible messages
    const eligible = generateEligibleMessages(39);
    // Add 3 system messages
    const systemMsgs = [
      makeMessage({ role: 'system', content: 'System 1' }),
      makeMessage({ role: 'system', content: 'System 2' }),
      makeMessage({ role: 'system', content: 'System 3' }),
    ];
    const allMessages = [...systemMsgs, ...eligible];
    const thread = makeThread(allMessages);
    const threadKey: ThreadKey = { type: 'hub', projectId: 'proj-gap' };

    await maybeSummariseThread(thread, threadKey, 'req-gap-9');

    // 42 total messages but only 39 eligible (3 system excluded) -> no trigger
    expect(mockSendChatRequest).not.toHaveBeenCalled();
    expect(mockSaveThread).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // Gap Test 10: The LLM messages array has exactly 2 entries: system prompt
  // and user content (no tools, no extra messages)
  // ==========================================================================
  it('should send exactly 2 messages to the LLM: system prompt and user content with formatted conversation', async () => {
    const messages = generateEligibleMessages(42);
    const thread = makeThread(messages);
    const threadKey: ThreadKey = { type: 'hub', projectId: 'proj-gap' };

    mockSendChatRequest.mockResolvedValue({
      id: 'resp-gap-10',
      content: '**Goals**\n- LLM array test',
      isFinal: true,
    });
    mockGetThread.mockResolvedValue({ ...thread });

    await maybeSummariseThread(thread, threadKey, 'req-gap-10');

    expect(mockSendChatRequest).toHaveBeenCalledTimes(1);

    const llmMessages = mockSendChatRequest.mock.calls[0][0];

    // Exactly 2 messages: system prompt + user content
    expect(llmMessages).toHaveLength(2);
    expect(llmMessages[0].role).toBe('system');
    expect(llmMessages[1].role).toBe('user');

    // The request identifier should be 'summarisation'
    const requestLabel = mockSendChatRequest.mock.calls[0][2];
    expect(requestLabel).toBe('summarisation');

    // Options should have temperature: 0.2 and maxTokens: 2000
    const options = mockSendChatRequest.mock.calls[0][3];
    expect(options).toEqual({ temperature: 0.2, maxTokens: 2000, tools: [], toolChoice: 'none' });
  });
});
