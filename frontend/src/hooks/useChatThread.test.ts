/**
 * Tests for useChatThread Hook
 *
 * Spec 2026-02-28: Unified Chat Panel v1 (Frontend)
 * Task Group 4, Task 4.1: Write 6 focused tests for the hook
 *
 * Updated for Spec 2026-02-28: Hub Chat MVP v1 (Frontend + Backend Wiring)
 * - Added postHandoff to mock setup
 * - Tests 3 and 6 use threads with non-unknown activeTaskId to avoid
 *   message queuing (queuing behavior is tested in useChatThread-enhancements.test.ts)
 *
 * Tests verify:
 * 1. Hook initializes with empty messages and calls getThreadHistory on mount
 * 2. Hook populates messages from loaded thread history
 * 3. sendMessage appends optimistic user message, calls postChatV2, and appends assistant response
 * 4. sendMessage sets isLoading true during request and false after
 * 5. selectPersona updates activePersonaId and resets activeTaskId to 'unknown'
 * 6. selectTask updates activeTaskId and auto-sends a system-style message
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useChatThread } from './useChatThread';
import type { ThreadKey, Thread, ChatV2Response } from '../api/chatV2Api';

// ============================================================================
// Mock the API module
// ============================================================================

vi.mock('../api/chatV2Api', async () => {
  const actual = await vi.importActual<typeof import('../api/chatV2Api')>(
    '../api/chatV2Api'
  );
  return {
    ...actual,
    postChatV2: vi.fn(),
    getThreadHistory: vi.fn(),
    postHandoff: vi.fn(),
  };
});

// Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) -- TG11:
//   Group 7 added useActiveArchitectureId() to useChatThread (line 442). The
//   pre-existing test had no ArchitectureContext mock, so the hook threw
//   'must be used within an ArchitectureProvider'. Stub the hook to return
//   null (no architecture binding active) so the existing assertions on
//   message + persona + task behaviour are preserved.
vi.mock('../contexts/ArchitectureContext', () => ({
  useActiveArchitectureId: vi.fn(() => null),
}));

import { postChatV2, getThreadHistory, postHandoff } from '../api/chatV2Api';

const mockPostChatV2 = vi.mocked(postChatV2);
const mockGetThreadHistory = vi.mocked(getThreadHistory);
const mockPostHandoff = vi.mocked(postHandoff);

// ============================================================================
// Test Data
// ============================================================================

const testThreadKey: ThreadKey = { type: 'hub', projectId: 'test-proj-1' };

const emptyThread: Thread = {
  threadKey: 'project:test-proj-1:hub',
  projectId: 'test-proj-1',
  messages: [],
  activePersonaId: null,
  activeTaskId: null,
  createdAt: '2026-02-28T10:00:00.000Z',
  updatedAt: '2026-02-28T10:00:00.000Z',
};

/** Thread with an active task so sendMessage does not trigger queuing */
const threadWithTask: Thread = {
  threadKey: 'project:test-proj-1:hub',
  projectId: 'test-proj-1',
  messages: [],
  activePersonaId: 'assistant',
  activeTaskId: 'some-task',
  createdAt: '2026-02-28T10:00:00.000Z',
  updatedAt: '2026-02-28T10:00:00.000Z',
};

const populatedThread: Thread = {
  threadKey: 'project:test-proj-1:hub',
  projectId: 'test-proj-1',
  messages: [
    {
      id: 'msg-existing-1',
      role: 'user',
      personaId: null,
      taskId: null,
      content: 'Hello there',
      structuredResponse: null,
      timestamp: '2026-02-28T09:00:00.000Z',
    },
    {
      id: 'msg-existing-2',
      role: 'assistant',
      personaId: 'assistant',
      taskId: 'unknown',
      content: 'Hi! How can I help?',
      structuredResponse: null,
      timestamp: '2026-02-28T09:00:01.000Z',
    },
  ],
  activePersonaId: 'product-manager',
  activeTaskId: 'define-product',
  createdAt: '2026-02-28T09:00:00.000Z',
  updatedAt: '2026-02-28T09:00:01.000Z',
};

// ============================================================================
// Tests
// ============================================================================

describe('useChatThread', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPostHandoff.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // Test 1: Hook initializes with empty messages and calls getThreadHistory
  // --------------------------------------------------------------------------
  it('initializes with empty messages and calls getThreadHistory on mount', async () => {
    // Given
    mockGetThreadHistory.mockResolvedValue(emptyThread);

    // When
    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'assistant' })
    );

    // Then - initial state before async resolution
    expect(result.current.messages).toEqual([]);
    expect(result.current.activePersonaId).toBe('assistant');
    expect(result.current.activeTaskId).toBe('unknown');
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();

    // Verify getThreadHistory was called with the thread key
    expect(mockGetThreadHistory).toHaveBeenCalledTimes(1);
    expect(mockGetThreadHistory).toHaveBeenCalledWith(testThreadKey);

    // Wait for the async effect to complete
    await waitFor(() => {
      // After loading empty thread, messages remain empty
      expect(result.current.messages).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // Test 2: Hook populates messages from loaded thread history
  // --------------------------------------------------------------------------
  it('populates messages from loaded thread history', async () => {
    // Given
    mockGetThreadHistory.mockResolvedValue(populatedThread);

    // When
    const { result } = renderHook(() => useChatThread(testThreadKey));

    // Then - wait for thread history to load
    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2);
    });

    expect(result.current.messages[0].content).toBe('Hello there');
    expect(result.current.messages[1].content).toBe('Hi! How can I help?');

    // activePersonaId and activeTaskId should come from the thread
    expect(result.current.activePersonaId).toBe('product-manager');
    expect(result.current.activeTaskId).toBe('define-product');
  });

  // --------------------------------------------------------------------------
  // Test 3: sendMessage appends optimistic user message, calls postChatV2,
  //          and appends assistant response
  //
  // Uses a thread with a non-unknown activeTaskId to test the normal
  // (non-queuing) send path.
  // --------------------------------------------------------------------------
  it('sendMessage appends optimistic user message, calls postChatV2, and appends assistant response', async () => {
    // Given - thread has an active task so message is sent directly (not queued)
    mockGetThreadHistory.mockResolvedValue(threadWithTask);

    const mockResponse: ChatV2Response = {
      threadKey: 'project:test-proj-1:hub',
      personaId: 'assistant',
      taskId: 'some-task',
      assistant: { message: 'I can help you with that.' },
      structuredResponse: null,
    };
    mockPostChatV2.mockResolvedValue(mockResponse);

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'assistant' })
    );

    // Wait for initial load and task to be set
    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('some-task');
    });

    // When
    await act(async () => {
      await result.current.sendMessage('Help me with something');
    });

    // Then
    // Should have appended user message + assistant response
    expect(result.current.messages).toHaveLength(2);

    // Optimistic user message
    const userMsg = result.current.messages[0];
    expect(userMsg.role).toBe('user');
    expect(userMsg.content).toBe('Help me with something');
    expect(userMsg.personaId).toBeNull();
    expect(userMsg.id).toMatch(/^msg-/);

    // Assistant response
    const assistantMsg = result.current.messages[1];
    expect(assistantMsg.role).toBe('assistant');
    expect(assistantMsg.content).toBe('I can help you with that.');
    expect(assistantMsg.personaId).toBe('assistant');

    // Verify postChatV2 was called with correct request
    expect(mockPostChatV2).toHaveBeenCalledTimes(1);
    expect(mockPostChatV2).toHaveBeenCalledWith(
      expect.objectContaining({
        personaId: 'assistant',
        taskId: 'some-task',
        message: 'Help me with something',
      })
    );
  });

  // --------------------------------------------------------------------------
  // Test 4: sendMessage sets isLoading true during request and false after
  // --------------------------------------------------------------------------
  it('sendMessage sets isLoading true during request and false after', async () => {
    // Given - thread with active task to avoid queuing
    mockGetThreadHistory.mockResolvedValue(threadWithTask);

    // Create a deferred promise we can resolve manually
    let resolvePost: (value: ChatV2Response) => void;
    const postPromise = new Promise<ChatV2Response>((resolve) => {
      resolvePost = resolve;
    });
    mockPostChatV2.mockReturnValue(postPromise);

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'assistant' })
    );

    // Wait for initial load
    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('some-task');
    });

    // Verify initial state
    expect(result.current.isLoading).toBe(false);

    // When - start sending (don't await)
    let sendPromise: Promise<void>;
    act(() => {
      sendPromise = result.current.sendMessage('Test message');
    });

    // Then - isLoading should be true while request is in flight
    await waitFor(() => {
      expect(result.current.isLoading).toBe(true);
    });

    // Resolve the API call
    await act(async () => {
      resolvePost!({
        threadKey: 'project:test-proj-1:hub',
        personaId: 'assistant',
        taskId: 'some-task',
        assistant: { message: 'Response' },
        structuredResponse: null,
      });
      await sendPromise!;
    });

    // After completion, isLoading should be false
    expect(result.current.isLoading).toBe(false);
  });

  // --------------------------------------------------------------------------
  // Test 5: selectPersona updates activePersonaId and resets activeTaskId
  // --------------------------------------------------------------------------
  it('selectPersona updates activePersonaId and resets activeTaskId to unknown', async () => {
    // Given - load a thread with a non-default persona and task
    mockGetThreadHistory.mockResolvedValue(populatedThread);

    const { result } = renderHook(() => useChatThread(testThreadKey));

    // Wait for thread history to load
    await waitFor(() => {
      expect(result.current.activePersonaId).toBe('product-manager');
      expect(result.current.activeTaskId).toBe('define-product');
    });

    // When
    act(() => {
      result.current.selectPersona('architect');
    });

    // Then
    expect(result.current.activePersonaId).toBe('architect');
    expect(result.current.activeTaskId).toBe('unknown');
  });

  // --------------------------------------------------------------------------
  // Test 6: selectTask updates activeTaskId and auto-sends a system-style message
  //
  // Uses a thread with a non-unknown activeTaskId for the initial send,
  // so no queuing occurs. The task-menu response resets activeTaskId to
  // 'unknown', then selectTask falls back to "Selected task: {label}".
  // --------------------------------------------------------------------------
  it('selectTask updates activeTaskId and auto-sends a system-style message', async () => {
    // Given - thread starts with a non-unknown task so first send is not queued
    const threadForSelectTask: Thread = {
      ...emptyThread,
      activePersonaId: 'product-manager',
      activeTaskId: 'some-task',
    };
    mockGetThreadHistory.mockResolvedValue(threadForSelectTask);

    // First call: returns a task-menu with tasks (resets activeTaskId to 'unknown')
    const taskMenuResponse: ChatV2Response = {
      threadKey: 'project:test-proj-1:hub',
      personaId: 'product-manager',
      taskId: 'unknown',
      assistant: { message: 'Please select a task:' },
      structuredResponse: {
        type: 'task-menu',
        tasks: [
          { taskId: 'define-product', menuLabel: 'Define Product', description: 'Define the product mission' },
          { taskId: 'build-roadmap', menuLabel: 'Build Roadmap', description: 'Create the product roadmap' },
        ],
      },
    };

    // Second call: response after task selection auto-send
    const taskSelectedResponse: ChatV2Response = {
      threadKey: 'project:test-proj-1:hub',
      personaId: 'product-manager',
      taskId: 'define-product',
      assistant: { message: 'Let us define your product.' },
      structuredResponse: null,
    };

    mockPostChatV2
      .mockResolvedValueOnce(taskMenuResponse)
      .mockResolvedValueOnce(taskSelectedResponse);

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'product-manager' })
    );

    // Wait for initial load
    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('some-task');
    });

    // Send a message to get the task menu (not queued because taskId is 'some-task')
    await act(async () => {
      await result.current.sendMessage('What can you help me with?');
    });

    // Verify the task-menu response was received
    expect(result.current.messages).toHaveLength(2); // user msg + assistant task-menu msg

    // When - select a task (no pending message, so falls back to "Selected task: ...")
    await act(async () => {
      result.current.selectTask('define-product');
    });

    // Then - activeTaskId should be updated
    // Note: selectTask calls sendMessage which is async, so wait for it
    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('define-product');
    });

    // Should have auto-sent a message with the task's menuLabel
    await waitFor(() => {
      // Messages: 1) user "What can you help me with?", 2) assistant task-menu,
      //           3) user "Define Product", 4) assistant response
      expect(result.current.messages.length).toBeGreaterThanOrEqual(3);
    });

    // Find the auto-sent message
    const autoSentMsg = result.current.messages.find(
      (m) => m.content === 'Define Product'
    );
    expect(autoSentMsg).toBeDefined();
    expect(autoSentMsg!.role).toBe('user');

    // Verify postChatV2 was called twice (initial message + auto-send from selectTask)
    expect(mockPostChatV2).toHaveBeenCalledTimes(2);

    // The second call should contain the selected task message
    const secondCallArgs = mockPostChatV2.mock.calls[1][0];
    expect(secondCallArgs.message).toBe('Define Product');
  });
});
