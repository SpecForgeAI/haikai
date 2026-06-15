/**
 * Tests for useChatThread Hook Enhancements
 *
 * Spec 2026-02-28: Hub Chat MVP v1 (Frontend + Backend Wiring)
 * Task Group 3, Task 3.1: Write 8 focused tests for hook enhancements
 *
 * Spec 2026-03-03: UnifiedChatPanel UX Polish
 * Task Group 1: FR4 -- Updated Test 7 to expect menuLabel directly (no "Selected task:" prefix)
 *
 * Tests verify:
 * 1. sendMessage strips leading @Architect from message text
 * 2. sendMessage strips leading @Product Manager (multi-word) from message text
 * 3. sendMessage does NOT strip @-patterns not at the start of the message
 * 4. sendMessage when activeTaskId === 'unknown' stores stripped text in pendingMessage and appends optimistic user message
 * 5. sendMessage when activeTaskId === 'unknown' fires POST with taskId='unknown' and message='' (empty string)
 * 6. selectTask when pendingMessage exists auto-sends queued message with newly selected taskId
 * 7. selectTask when no pendingMessage exists sends the menuLabel directly (FR4)
 * 8. selectPersona with different personaId inserts system message and calls postHandoff
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useChatThread } from '../useChatThread';
import type { ThreadKey, Thread, ChatV2Response } from '../../api/chatV2Api';

// ============================================================================
// Mock the API module
// ============================================================================

vi.mock('../../api/chatV2Api', async () => {
  const actual = await vi.importActual<typeof import('../../api/chatV2Api')>(
    '../../api/chatV2Api'
  );
  return {
    ...actual,
    postChatV2: vi.fn(),
    getThreadHistory: vi.fn(),
    postHandoff: vi.fn(),
  };
});

import { postChatV2, getThreadHistory, postHandoff } from '../../api/chatV2Api';
import { createProvidersWrapper } from '../../test-utils/renderWithProviders';

// Shared harness: useChatThread reads useActiveArchitectureId(), which
// requires the real ArchitectureProvider (Router + ProjectContext stack).
const providersWrapper = createProvidersWrapper();

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

/** Standard assistant response for normal flow tests */
const standardResponse: ChatV2Response = {
  threadKey: 'project:test-proj-1:hub',
  personaId: 'architect',
  taskId: 'review-architecture',
  assistant: { message: 'I can help with that.' },
  structuredResponse: null,
};

/** Task-menu response for queuing tests */
const taskMenuResponse: ChatV2Response = {
  threadKey: 'project:test-proj-1:hub',
  personaId: 'architect',
  taskId: 'unknown',
  assistant: { message: 'Please select a task:' },
  structuredResponse: {
    type: 'task-menu',
    tasks: [
      { taskId: 'review-architecture', menuLabel: 'Review Architecture', description: 'Review the architecture' },
      { taskId: 'define-components', menuLabel: 'Define Components', description: 'Define system components' },
    ],
  },
};

/** Response after task selection */
const taskSelectedResponse: ChatV2Response = {
  threadKey: 'project:test-proj-1:hub',
  personaId: 'architect',
  taskId: 'review-architecture',
  assistant: { message: 'Let us review your architecture.' },
  structuredResponse: null,
};

// ============================================================================
// Tests
// ============================================================================

describe('useChatThread enhancements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: empty thread, resolve immediately
    mockGetThreadHistory.mockResolvedValue(emptyThread);
    // Default: postHandoff resolves successfully
    mockPostHandoff.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // Test 1: sendMessage strips leading @Architect from message text
  // --------------------------------------------------------------------------
  it('sendMessage strips leading @Architect from message text before building the optimistic user message', async () => {
    // Given
    mockPostChatV2.mockResolvedValue(standardResponse);

    // Need a non-unknown taskId so we don't trigger queuing
    const threadWithTask: Thread = {
      ...emptyThread,
      activeTaskId: 'review-architecture',
    };
    mockGetThreadHistory.mockResolvedValue(threadWithTask);

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'architect' })
    , { wrapper: providersWrapper });

    // Wait for initial load
    await waitFor(() => {
      expect(mockGetThreadHistory).toHaveBeenCalled();
    });

    // Wait for task to be set from thread history
    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('review-architecture');
    });

    // When
    await act(async () => {
      await result.current.sendMessage('@Architect what about the database?');
    });

    // Then - user message should have stripped text
    const userMsg = result.current.messages.find(m => m.role === 'user');
    expect(userMsg).toBeDefined();
    expect(userMsg!.content).toBe('what about the database?');

    // API should also receive stripped text
    expect(mockPostChatV2).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'what about the database?',
      })
    );
  });

  // --------------------------------------------------------------------------
  // Test 2: sendMessage strips leading @Product Manager (multi-word)
  // --------------------------------------------------------------------------
  it('sendMessage strips leading @Product Manager (multi-word display name) from message text', async () => {
    // Given
    mockPostChatV2.mockResolvedValue(standardResponse);

    const threadWithTask: Thread = {
      ...emptyThread,
      activeTaskId: 'define-product',
    };
    mockGetThreadHistory.mockResolvedValue(threadWithTask);

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'product-manager' })
    , { wrapper: providersWrapper });

    // Wait for initial load
    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('define-product');
    });

    // When
    await act(async () => {
      await result.current.sendMessage('@Product Manager define the mission');
    });

    // Then
    const userMsg = result.current.messages.find(m => m.role === 'user');
    expect(userMsg).toBeDefined();
    expect(userMsg!.content).toBe('define the mission');

    expect(mockPostChatV2).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'define the mission',
      })
    );
  });

  // --------------------------------------------------------------------------
  // Test 3: sendMessage does NOT strip @-patterns not at the start
  // --------------------------------------------------------------------------
  it('sendMessage does NOT strip @-patterns that are not at the start of the message', async () => {
    // Given
    mockPostChatV2.mockResolvedValue(standardResponse);

    const threadWithTask: Thread = {
      ...emptyThread,
      activeTaskId: 'review-architecture',
    };
    mockGetThreadHistory.mockResolvedValue(threadWithTask);

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'architect' })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('review-architecture');
    });

    // When
    await act(async () => {
      await result.current.sendMessage('ask @Architect about this');
    });

    // Then - text should remain unchanged
    const userMsg = result.current.messages.find(m => m.role === 'user');
    expect(userMsg).toBeDefined();
    expect(userMsg!.content).toBe('ask @Architect about this');

    expect(mockPostChatV2).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'ask @Architect about this',
      })
    );
  });

  // --------------------------------------------------------------------------
  // Test 4: sendMessage when activeTaskId === 'unknown' stores stripped text
  //         in pendingMessage and appends optimistic user message
  // --------------------------------------------------------------------------
  it('sendMessage when activeTaskId === "unknown" stores stripped text in pendingMessage and appends optimistic user message', async () => {
    // Given - hook starts with activeTaskId === 'unknown' (default)
    mockPostChatV2.mockResolvedValue(taskMenuResponse);

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'architect' })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(mockGetThreadHistory).toHaveBeenCalled();
    });

    // activeTaskId should be 'unknown' by default
    expect(result.current.activeTaskId).toBe('unknown');

    // When - send a message with @-mention while taskId is 'unknown'
    await act(async () => {
      await result.current.sendMessage('@Architect what about the database?');
    });

    // Then - optimistic user message should appear with stripped text
    const userMsg = result.current.messages.find(m => m.role === 'user');
    expect(userMsg).toBeDefined();
    expect(userMsg!.content).toBe('what about the database?');

    // The task menu response should also be appended
    const assistantMsg = result.current.messages.find(m => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.content).toBe('Please select a task:');
  });

  // --------------------------------------------------------------------------
  // Test 5: sendMessage when activeTaskId === 'unknown' fires POST with
  //         taskId='unknown' and message='' (empty string)
  // --------------------------------------------------------------------------
  it('sendMessage when activeTaskId === "unknown" fires POST with taskId="unknown" and message="" (empty string)', async () => {
    // Given
    mockPostChatV2.mockResolvedValue(taskMenuResponse);

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'architect' })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(mockGetThreadHistory).toHaveBeenCalled();
    });

    // When
    await act(async () => {
      await result.current.sendMessage('@Architect what about the database?');
    });

    // Then - API should receive empty message with taskId='unknown'
    expect(mockPostChatV2).toHaveBeenCalledTimes(1);
    expect(mockPostChatV2).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'unknown',
        message: '',
      })
    );
  });

  // --------------------------------------------------------------------------
  // Test 6: selectTask when pendingMessage exists auto-sends queued message
  //         with newly selected taskId and clears pendingMessage
  // --------------------------------------------------------------------------
  it('selectTask when pendingMessage exists auto-sends queued message with newly selected taskId and clears pendingMessage', async () => {
    // Given - send a message while taskId is 'unknown' to queue it
    mockPostChatV2
      .mockResolvedValueOnce(taskMenuResponse)      // first call: task menu
      .mockResolvedValueOnce(taskSelectedResponse);  // second call: after auto-send

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'architect' })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(mockGetThreadHistory).toHaveBeenCalled();
    });

    // Send message to queue it (taskId is 'unknown')
    await act(async () => {
      await result.current.sendMessage('@Architect what about the database?');
    });

    // Verify the queuing POST was called
    expect(mockPostChatV2).toHaveBeenCalledTimes(1);

    // When - select a task, which should auto-send the queued message
    await act(async () => {
      result.current.selectTask('review-architecture');
    });

    // Then - the queued message should be sent with the selected taskId
    await waitFor(() => {
      expect(mockPostChatV2).toHaveBeenCalledTimes(2);
    });

    // Second call should have the queued message text and the selected task ID
    const secondCall = mockPostChatV2.mock.calls[1][0];
    expect(secondCall.message).toBe('what about the database?');
    expect(secondCall.taskId).toBe('review-architecture');

    // Verify the auto-sent user message appears in the messages
    const userMessages = result.current.messages.filter(m => m.role === 'user');
    expect(userMessages).toHaveLength(2); // original + auto-sent
    expect(userMessages[1].content).toBe('what about the database?');
  });

  // --------------------------------------------------------------------------
  // Test 7: selectTask when no pendingMessage exists sends the menuLabel
  //         directly (FR4: no "Selected task:" prefix)
  // --------------------------------------------------------------------------
  it('selectTask when no pendingMessage exists sends the menuLabel directly', async () => {
    // Given - set up a thread, send a normal message to get task menu, but without queuing
    // First, we need to get a task menu via a normal send (with a non-unknown taskId)
    const threadWithTask: Thread = {
      ...emptyThread,
      activeTaskId: 'some-task',
    };
    mockGetThreadHistory.mockResolvedValue(threadWithTask);

    // The first sendMessage call returns a task-menu (which resets activeTaskId to 'unknown')
    mockPostChatV2
      .mockResolvedValueOnce(taskMenuResponse)      // first call: returns task menu
      .mockResolvedValueOnce(taskSelectedResponse);  // second call: after selectTask

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'architect' })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('some-task');
    });

    // Send a message (taskId is 'some-task', not 'unknown', so no queuing)
    await act(async () => {
      await result.current.sendMessage('What tasks are available?');
    });

    // The response was a task-menu, so activeTaskId should be reset to 'unknown'
    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('unknown');
    });

    // When - select a task without any pending message
    await act(async () => {
      result.current.selectTask('review-architecture');
    });

    // Then - should send the menuLabel directly (FR4: no "Selected task:" prefix)
    await waitFor(() => {
      expect(mockPostChatV2).toHaveBeenCalledTimes(2);
    });

    const secondCall = mockPostChatV2.mock.calls[1][0];
    expect(secondCall.message).toBe('Review Architecture');
  });

  // --------------------------------------------------------------------------
  // Test 8: selectPersona with different personaId inserts system message
  //         and calls postHandoff
  // --------------------------------------------------------------------------
  it('selectPersona with different personaId inserts system message "Switched to {displayName}" and calls postHandoff', async () => {
    // Given
    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'assistant' })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(mockGetThreadHistory).toHaveBeenCalled();
    });

    // Verify starting persona
    expect(result.current.activePersonaId).toBe('assistant');

    // When
    act(() => {
      result.current.selectPersona('architect');
    });

    // Then - system message should be inserted
    const systemMsg = result.current.messages.find(
      m => m.role === 'system' && m.content.includes('Switched to')
    );
    expect(systemMsg).toBeDefined();
    expect(systemMsg!.content).toBe('Switched to Architect');
    expect(systemMsg!.personaId).toBeNull();
    expect(systemMsg!.taskId).toBeNull();

    // Persona should be updated
    expect(result.current.activePersonaId).toBe('architect');

    // Task should be reset to unknown
    expect(result.current.activeTaskId).toBe('unknown');

    // postHandoff should have been called (fire-and-forget)
    expect(mockPostHandoff).toHaveBeenCalledTimes(1);
    expect(mockPostHandoff).toHaveBeenCalledWith(testThreadKey, 'architect');
  });
});
