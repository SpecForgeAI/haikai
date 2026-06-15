/**
 * Hub Chat MVP v1: Gap Analysis Tests
 *
 * Spec 2026-02-28: Hub Chat MVP v1 (Frontend + Backend Wiring)
 * Task Group 6, Task 6.3: Strategic tests to fill critical coverage gaps
 *
 * These tests cover workflows NOT tested by TG1-5:
 * 1. selectPersona with the same persona that is already active does NOT insert a system message (no-op check)
 * 2. postHandoff failure is caught and logged, persona switch still completes
 * 3. sendMessage strips @UX Designer (multi-word with space) correctly
 * 4. pendingMessageRef is cleared after auto-send -- calling selectTask twice does not double-send
 * 5. @-mention stripping is case-insensitive (e.g., @architect vs @Architect)
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

const testThreadKey: ThreadKey = { type: 'hub', projectId: 'gap-test-proj' };

const emptyThread: Thread = {
  threadKey: 'project:gap-test-proj:hub',
  projectId: 'gap-test-proj',
  messages: [],
  activePersonaId: null,
  activeTaskId: null,
  createdAt: '2026-02-28T10:00:00.000Z',
  updatedAt: '2026-02-28T10:00:00.000Z',
};

/** Standard assistant response for normal flow tests */
const standardResponse: ChatV2Response = {
  threadKey: 'project:gap-test-proj:hub',
  personaId: 'ux-designer',
  taskId: 'design-wireframes',
  assistant: { message: 'I can help with wireframes.' },
  structuredResponse: null,
};

/** Task-menu response for queuing tests */
const taskMenuResponse: ChatV2Response = {
  threadKey: 'project:gap-test-proj:hub',
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
  threadKey: 'project:gap-test-proj:hub',
  personaId: 'architect',
  taskId: 'review-architecture',
  assistant: { message: 'Let us review your architecture.' },
  structuredResponse: null,
};

// ============================================================================
// Tests
// ============================================================================

describe('Hub Chat MVP v1: Gap Analysis Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: empty thread, resolve immediately
    mockGetThreadHistory.mockResolvedValue(emptyThread);
    // Default: postHandoff resolves successfully
    mockPostHandoff.mockResolvedValue(undefined);
    // Default: postChatV2 resolves with task-menu (needed because selectPersona
    // now auto-sends via sendMessage('') per FR2 UX Polish spec)
    mockPostChatV2.mockResolvedValue(taskMenuResponse);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // Gap 1: selectPersona with the same persona does NOT insert a system message
  // --------------------------------------------------------------------------
  it('selectPersona with the same persona that is already active does NOT insert a system message', async () => {
    // Given - hook starts with 'assistant' persona
    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'assistant' })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(mockGetThreadHistory).toHaveBeenCalled();
    });

    expect(result.current.activePersonaId).toBe('assistant');
    expect(result.current.messages).toHaveLength(0);

    // When - select the same persona that is already active
    act(() => {
      result.current.selectPersona('assistant');
    });

    // Then - no system message should be inserted
    const systemMessages = result.current.messages.filter(
      m => m.role === 'system' && m.content.includes('Switched to')
    );
    expect(systemMessages).toHaveLength(0);

    // postHandoff should NOT have been called
    expect(mockPostHandoff).not.toHaveBeenCalled();

    // activePersonaId remains the same
    expect(result.current.activePersonaId).toBe('assistant');

    // activeTaskId is reset to 'unknown' (always happens in selectPersona)
    expect(result.current.activeTaskId).toBe('unknown');
  });

  // --------------------------------------------------------------------------
  // Gap 2: postHandoff failure is caught and logged, persona switch still completes
  // --------------------------------------------------------------------------
  it('postHandoff failure is caught and logged, persona switch still completes', async () => {
    // Given - postHandoff will reject
    mockPostHandoff.mockRejectedValue(new Error('Network error'));

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'assistant' })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(mockGetThreadHistory).toHaveBeenCalled();
    });

    // When - switch persona (postHandoff will fail)
    act(() => {
      result.current.selectPersona('architect');
    });

    // Then - persona switch should still complete
    expect(result.current.activePersonaId).toBe('architect');
    expect(result.current.activeTaskId).toBe('unknown');

    // System message should still be inserted locally
    const systemMsg = result.current.messages.find(
      m => m.role === 'system' && m.content.includes('Switched to')
    );
    expect(systemMsg).toBeDefined();
    expect(systemMsg!.content).toBe('Switched to Architect');

    // Wait for the rejected promise to be caught
    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to persist handoff:',
        expect.any(Error)
      );
    });

    // Verify error was logged but did NOT propagate to the hook's error state
    expect(result.current.error).toBeNull();

    consoleErrorSpy.mockRestore();
  });

  // --------------------------------------------------------------------------
  // Gap 3: sendMessage strips @UX Designer (multi-word with space) correctly
  // --------------------------------------------------------------------------
  it('sendMessage strips @UX Designer (multi-word with space) correctly', async () => {
    // Given - thread with a non-unknown taskId so we test the normal send path
    const threadWithTask: Thread = {
      ...emptyThread,
      activeTaskId: 'design-wireframes',
    };
    mockGetThreadHistory.mockResolvedValue(threadWithTask);
    mockPostChatV2.mockResolvedValue(standardResponse);

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'ux-designer' })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('design-wireframes');
    });

    // When
    await act(async () => {
      await result.current.sendMessage('@UX Designer create a wireframe for the login page');
    });

    // Then - user message should have stripped text
    const userMsg = result.current.messages.find(m => m.role === 'user');
    expect(userMsg).toBeDefined();
    expect(userMsg!.content).toBe('create a wireframe for the login page');

    // API should also receive stripped text
    expect(mockPostChatV2).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'create a wireframe for the login page',
      })
    );
  });

  // --------------------------------------------------------------------------
  // Gap 4: pendingMessageRef is cleared after auto-send -- calling selectTask
  //        twice does not double-send the queued message
  //
  // The key assertion: the second selectTask sends a fallback "Selected task: ..."
  // message, NOT the previously queued "what about the database?" message.
  //
  // Note: After the first selectTask auto-sends the queued message, the API
  // response (taskSelectedResponse) has structuredResponse: null, which
  // overwrites lastStructuredResponseRef. So the second selectTask cannot
  // look up the menuLabel from the task-menu and falls back to the raw taskId.
  // --------------------------------------------------------------------------
  it('pendingMessageRef is cleared after auto-send -- second selectTask does not re-send queued message', async () => {
    // Given - queue a message by sending while taskId is 'unknown'
    mockPostChatV2
      .mockResolvedValueOnce(taskMenuResponse)      // first call: task menu
      .mockResolvedValueOnce(taskSelectedResponse)   // second call: auto-send queued message
      .mockResolvedValueOnce({                       // third call: selectTask fallback
        ...taskSelectedResponse,
        taskId: 'define-components',
        assistant: { message: 'Let me define the components.' },
      });

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

    expect(mockPostChatV2).toHaveBeenCalledTimes(1);

    // First selectTask: should auto-send the queued message
    await act(async () => {
      result.current.selectTask('review-architecture');
    });

    await waitFor(() => {
      expect(mockPostChatV2).toHaveBeenCalledTimes(2);
    });

    // Verify second call used the queued message
    const secondCall = mockPostChatV2.mock.calls[1][0];
    expect(secondCall.message).toBe('what about the database?');
    expect(secondCall.taskId).toBe('review-architecture');

    // Second selectTask: pendingMessage should be cleared, so it falls back
    // to raw taskId (taskId used as-is because lastStructuredResponseRef
    // was overwritten by the auto-send response)
    await act(async () => {
      result.current.selectTask('define-components');
    });

    await waitFor(() => {
      expect(mockPostChatV2).toHaveBeenCalledTimes(3);
    });

    // CRITICAL ASSERTION: The third call must NOT contain the queued message
    // "what about the database?" -- it should be the fallback message instead.
    // The fallback uses the raw taskId because the task-menu structuredResponse
    // was overwritten when the auto-send response came back.
    const thirdCall = mockPostChatV2.mock.calls[2][0];
    expect(thirdCall.message).not.toBe('what about the database?');
    expect(thirdCall.message).toBe('define-components');
    expect(thirdCall.taskId).toBe('define-components');
  });

  // --------------------------------------------------------------------------
  // Gap 5: @-mention stripping is case-insensitive
  // --------------------------------------------------------------------------
  it('@-mention stripping is case-insensitive (e.g., @architect vs @Architect)', async () => {
    // Given - thread with a non-unknown taskId
    const threadWithTask: Thread = {
      ...emptyThread,
      activeTaskId: 'review-architecture',
    };
    mockGetThreadHistory.mockResolvedValue(threadWithTask);
    mockPostChatV2.mockResolvedValue({
      ...standardResponse,
      personaId: 'architect',
      taskId: 'review-architecture',
    });

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'architect' })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('review-architecture');
    });

    // When - send with lowercase @architect (not the canonical @Architect)
    await act(async () => {
      await result.current.sendMessage('@architect review the system');
    });

    // Then - should still strip the @-mention (case-insensitive regex)
    const userMsg = result.current.messages.find(m => m.role === 'user');
    expect(userMsg).toBeDefined();
    expect(userMsg!.content).toBe('review the system');

    expect(mockPostChatV2).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'review the system',
      })
    );
  });
});
