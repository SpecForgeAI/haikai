/**
 * Tests for useChatThread Hook Bootstrap Extensions
 *
 * Spec 2026-02-28: Hub Bootstrap 1 -- Product Definition (PM) End-to-End
 * Task Group 7, Task 7.1: Write 8 focused tests for hook extensions
 *
 * Tests verify:
 * 1. generateArtifact calls postGenerateArtifact and on success appends an assistant message
 *    with structuredResponse.type === 'artifact-preview' and sets artifactPreview state
 * 2. generateArtifact on failure appends a system error message and does NOT set artifactPreview
 * 3. confirmArtifact calls postSaveArtifact and on success appends a completion chip message,
 *    clears artifactPreview, and calls onArtifactSaved callback
 * 4. confirmArtifact on failure appends a system error message and keeps artifactPreview available
 * 5. rejectArtifact clears artifactPreview, sends a follow-up "I'd like to make changes." message
 * 6. When latest assistant message has structuredResponse.phase === 'ready' and user sends a
 *    confirmation message, generateArtifact is auto-triggered
 * 7. sealedTaskIds computation: when messages contain a completion chip with
 *    taskId: 'product-manager--define-product', that taskId is in the sealed set
 * 8. Hook returns isGenerating, isSaving, artifactPreview, sealedTaskIds in the return object
 *
 * Updated for Hub Bootstrap 2 (TG6) generalization:
 * - Error messages now use TASK_ARTIFACT_MAP artifact names (e.g., 'MISSION.MD' instead of 'Mission')
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useChatThread } from '../useChatThread';
import type { ThreadKey, Thread, ChatV2Response } from '../../api/chatV2Api';
import { createProvidersWrapper } from '../../test-utils/renderWithProviders';

// Shared harness: useChatThread reads useActiveArchitectureId(), which
// requires the real ArchitectureProvider (Router + ProjectContext stack).
const providersWrapper = createProvidersWrapper();

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
    postGenerateArtifact: vi.fn(),
    postSaveArtifact: vi.fn(),
  };
});

vi.mock('../../contexts/UserJourneyReviewContext', () => ({
  useActivateJourneyReview: vi.fn(() => vi.fn()),
}));

import {
  postChatV2,
  getThreadHistory,
  postHandoff,
  postGenerateArtifact,
  postSaveArtifact,
} from '../../api/chatV2Api';

const mockPostChatV2 = vi.mocked(postChatV2);
const mockGetThreadHistory = vi.mocked(getThreadHistory);
const mockPostHandoff = vi.mocked(postHandoff);
const mockPostGenerateArtifact = vi.mocked(postGenerateArtifact);
const mockPostSaveArtifact = vi.mocked(postSaveArtifact);

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

/** Thread with an active PM task for generation tests */
const threadWithPmTask: Thread = {
  threadKey: 'project:test-proj-1:hub',
  projectId: 'test-proj-1',
  messages: [],
  activePersonaId: 'product-manager',
  activeTaskId: 'product-manager--define-product',
  createdAt: '2026-02-28T10:00:00.000Z',
  updatedAt: '2026-02-28T10:00:00.000Z',
};

/** Thread with messages including a completion chip for sealed task tests */
const threadWithCompletionChip: Thread = {
  threadKey: 'project:test-proj-1:hub',
  projectId: 'test-proj-1',
  messages: [
    {
      id: 'msg-1',
      role: 'user',
      personaId: null,
      taskId: 'product-manager--define-product',
      content: 'Here are my answers',
      structuredResponse: null,
      timestamp: '2026-02-28T09:00:00.000Z',
    },
    {
      id: 'msg-2',
      role: 'assistant',
      personaId: 'product-manager',
      taskId: 'product-manager--define-product',
      content: 'Product Definition complete.',
      structuredResponse: {
        type: 'completion-chip',
        artifactId: 'mission-md',
        artifactName: 'MISSION.MD',
        taskId: 'product-manager--define-product',
        personaId: 'product-manager',
        timestamp: '2026-02-28T09:01:00.000Z',
      },
      timestamp: '2026-02-28T09:01:00.000Z',
    },
  ],
  activePersonaId: 'product-manager',
  activeTaskId: 'product-manager--define-product',
  createdAt: '2026-02-28T09:00:00.000Z',
  updatedAt: '2026-02-28T09:01:00.000Z',
};

/** Thread with a ready-phase assistant message for auto-trigger tests */
const threadWithReadyPhase: Thread = {
  threadKey: 'project:test-proj-1:hub',
  projectId: 'test-proj-1',
  messages: [
    {
      id: 'msg-ready-1',
      role: 'assistant',
      personaId: 'product-manager',
      taskId: 'product-manager--define-product',
      content: 'I have enough information to generate the mission.',
      structuredResponse: {
        phase: 'ready',
        summary: 'Ready to generate MISSION.MD',
      },
      timestamp: '2026-02-28T09:05:00.000Z',
    },
  ],
  activePersonaId: 'product-manager',
  activeTaskId: 'product-manager--define-product',
  createdAt: '2026-02-28T09:00:00.000Z',
  updatedAt: '2026-02-28T09:05:00.000Z',
};

// ============================================================================
// Tests
// ============================================================================

describe('useChatThread bootstrap extensions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPostHandoff.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // Test 1: generateArtifact on success appends artifact-preview message and
  //         sets artifactPreview state
  // --------------------------------------------------------------------------
  it('generateArtifact calls postGenerateArtifact and on success appends an assistant message with structuredResponse.type === "artifact-preview" and sets artifactPreview state', async () => {
    // Given
    mockGetThreadHistory.mockResolvedValue(threadWithPmTask);
    mockPostGenerateArtifact.mockResolvedValue({
      success: true,
      missionMarkdown: '# Mission\n\nBuild an amazing product.',
    });

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'product-manager' })
    , { wrapper: providersWrapper });

    // Wait for initial load
    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('product-manager--define-product');
    });

    // When
    await act(async () => {
      await result.current.generateArtifact('product-manager--define-product');
    });

    // Then
    expect(mockPostGenerateArtifact).toHaveBeenCalledTimes(1);
    expect(mockPostGenerateArtifact).toHaveBeenCalledWith(
      testThreadKey,
      'product-manager',
      'product-manager--define-product',
      undefined // allowedPersonaIds (not set in this test)
    );

    // Check that an artifact-preview message was appended
    const previewMsg = result.current.messages.find(
      (m) => {
        const sr = m.structuredResponse as { type?: string } | null;
        return sr?.type === 'artifact-preview';
      }
    );
    expect(previewMsg).toBeDefined();
    expect(previewMsg!.role).toBe('assistant');
    expect(
      (previewMsg!.structuredResponse as { markdownContent: string }).markdownContent
    ).toBe('# Mission\n\nBuild an amazing product.');

    // Check artifactPreview state
    expect(result.current.artifactPreview).toEqual({
      taskId: 'product-manager--define-product',
      content: '# Mission\n\nBuild an amazing product.',
    });
  });

  // --------------------------------------------------------------------------
  // Test 2: generateArtifact on failure appends a system error message and
  //         does NOT set artifactPreview
  // Updated for TG6 generalization: error message now uses TASK_ARTIFACT_MAP
  // artifact name 'MISSION.MD' instead of hardcoded 'Mission'
  // --------------------------------------------------------------------------
  it('generateArtifact on failure appends a system error message and does NOT set artifactPreview', async () => {
    // Given
    mockGetThreadHistory.mockResolvedValue(threadWithPmTask);
    mockPostGenerateArtifact.mockResolvedValue({
      success: false,
      error: 'LLM did not return a tool call',
    });

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'product-manager' })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('product-manager--define-product');
    });

    // When
    await act(async () => {
      await result.current.generateArtifact('product-manager--define-product');
    });

    // Then - should have a system error message (uses TASK_ARTIFACT_MAP artifactName)
    const errorMsg = result.current.messages.find(
      (m) => m.role === 'system' && m.content.includes('MISSION.MD generation failed')
    );
    expect(errorMsg).toBeDefined();
    expect(errorMsg!.content).toContain('LLM did not return a tool call');

    // artifactPreview should NOT be set
    expect(result.current.artifactPreview).toBeNull();
  });

  // --------------------------------------------------------------------------
  // Test 3: confirmArtifact on success appends completion chip, clears
  //         artifactPreview, and calls onArtifactSaved callback
  // --------------------------------------------------------------------------
  it('confirmArtifact calls postSaveArtifact and on success appends a completion chip message, clears artifactPreview, and calls onArtifactSaved callback', async () => {
    // Given
    mockGetThreadHistory.mockResolvedValue(threadWithPmTask);
    mockPostGenerateArtifact.mockResolvedValue({
      success: true,
      missionMarkdown: '# Mission\n\nBuild something great.',
    });
    mockPostSaveArtifact.mockResolvedValue({ success: true });

    const onArtifactSaved = vi.fn();

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, {
        initialPersonaId: 'product-manager',
        onArtifactSaved,
      })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('product-manager--define-product');
    });

    // First, generate an artifact to set artifactPreview
    await act(async () => {
      await result.current.generateArtifact('product-manager--define-product');
    });

    // Verify artifactPreview is set
    expect(result.current.artifactPreview).not.toBeNull();

    // When
    await act(async () => {
      await result.current.confirmArtifact();
    });

    // Then - postSaveArtifact was called
    expect(mockPostSaveArtifact).toHaveBeenCalledTimes(1);
    expect(mockPostSaveArtifact).toHaveBeenCalledWith(
      testThreadKey,
      'product-manager--define-product',
      'mission-md',
      '# Mission\n\nBuild something great.',
      undefined, // allowedPersonaIds (not set in this test)
      undefined // targetArchitectureId (not set in this test)
    );

    // A completion chip message was appended
    const chipMsg = result.current.messages.find(
      (m) => {
        const sr = m.structuredResponse as { type?: string } | null;
        return sr?.type === 'completion-chip';
      }
    );
    expect(chipMsg).toBeDefined();
    expect(chipMsg!.role).toBe('assistant');
    expect(chipMsg!.content).toBe('Product Definition complete.');

    // artifactPreview was cleared
    expect(result.current.artifactPreview).toBeNull();

    // onArtifactSaved callback was called
    expect(onArtifactSaved).toHaveBeenCalledTimes(1);
  });

  // --------------------------------------------------------------------------
  // Test 4: confirmArtifact on failure appends error message and keeps
  //         artifactPreview available
  // Updated for TG6 generalization: error message now uses TASK_ARTIFACT_MAP
  // artifact name 'MISSION.MD' instead of hardcoded 'MISSION.md'
  // --------------------------------------------------------------------------
  it('confirmArtifact on failure appends a system error message and keeps artifactPreview available', async () => {
    // Given
    mockGetThreadHistory.mockResolvedValue(threadWithPmTask);
    mockPostGenerateArtifact.mockResolvedValue({
      success: true,
      missionMarkdown: '# Mission\n\nBuild something great.',
    });
    mockPostSaveArtifact.mockResolvedValue({
      success: false,
      error: 'MCP tool execution failed',
    });

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'product-manager' })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('product-manager--define-product');
    });

    // First generate
    await act(async () => {
      await result.current.generateArtifact('product-manager--define-product');
    });

    expect(result.current.artifactPreview).not.toBeNull();

    // When
    await act(async () => {
      await result.current.confirmArtifact();
    });

    // Then - error message appended (uses TASK_ARTIFACT_MAP artifactName)
    const errorMsg = result.current.messages.find(
      (m) => m.role === 'system' && m.content.includes('Failed to save MISSION.MD')
    );
    expect(errorMsg).toBeDefined();
    expect(errorMsg!.content).toContain('MCP tool execution failed');

    // artifactPreview should still be available for retry
    expect(result.current.artifactPreview).not.toBeNull();
    expect(result.current.artifactPreview!.content).toBe(
      '# Mission\n\nBuild something great.'
    );
  });

  // --------------------------------------------------------------------------
  // Test 5: rejectArtifact clears artifactPreview and sends a follow-up
  //         "I'd like to make changes." message
  // --------------------------------------------------------------------------
  it('rejectArtifact clears artifactPreview, sends a follow-up "I\'d like to make changes." message', async () => {
    // Given
    mockGetThreadHistory.mockResolvedValue(threadWithPmTask);
    mockPostGenerateArtifact.mockResolvedValue({
      success: true,
      missionMarkdown: '# Draft Mission',
    });

    // The follow-up message via sendMessage will get a response
    const followUpResponse: ChatV2Response = {
      threadKey: 'project:test-proj-1:hub',
      personaId: 'product-manager',
      taskId: 'product-manager--define-product',
      assistant: { message: 'What would you like to change?' },
      structuredResponse: null,
    };
    mockPostChatV2.mockResolvedValue(followUpResponse);

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'product-manager' })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('product-manager--define-product');
    });

    // First generate
    await act(async () => {
      await result.current.generateArtifact('product-manager--define-product');
    });

    expect(result.current.artifactPreview).not.toBeNull();

    // When
    await act(async () => {
      await result.current.rejectArtifact();
    });

    // Then - artifactPreview is cleared
    expect(result.current.artifactPreview).toBeNull();

    // A user message "I'd like to make changes." was sent
    const userMsg = result.current.messages.find(
      (m) => m.role === 'user' && m.content === "I'd like to make changes."
    );
    expect(userMsg).toBeDefined();

    // postChatV2 was called with the follow-up message
    expect(mockPostChatV2).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "I'd like to make changes.",
      })
    );
  });

  // --------------------------------------------------------------------------
  // Test 6: When latest assistant message has structuredResponse.phase === 'ready'
  //         and user sends a confirmation message, generateArtifact is auto-triggered
  // --------------------------------------------------------------------------
  it('auto-triggers generateArtifact when latest assistant message has phase "ready" and user sends a message', async () => {
    // Given
    mockGetThreadHistory.mockResolvedValue(threadWithReadyPhase);
    mockPostGenerateArtifact.mockResolvedValue({
      success: true,
      missionMarkdown: '# Auto-Generated Mission',
    });

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'product-manager' })
    , { wrapper: providersWrapper });

    // Wait for initial load with ready-phase message
    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
      expect(result.current.activeTaskId).toBe('product-manager--define-product');
    });

    // When - user sends a confirmation message
    await act(async () => {
      await result.current.sendMessage('Yes, generate it!');
    });

    // Then - generateArtifact should have been auto-triggered
    expect(mockPostGenerateArtifact).toHaveBeenCalledTimes(1);
    expect(mockPostGenerateArtifact).toHaveBeenCalledWith(
      testThreadKey,
      'product-manager',
      'product-manager--define-product',
      undefined // allowedPersonaIds (not set in this test)
    );

    // postChatV2 should NOT have been called (phase detection skips normal send)
    expect(mockPostChatV2).not.toHaveBeenCalled();

    // The user message was appended optimistically
    const userMsg = result.current.messages.find(
      (m) => m.role === 'user' && m.content === 'Yes, generate it!'
    );
    expect(userMsg).toBeDefined();

    // An artifact-preview message should be appended
    const previewMsg = result.current.messages.find(
      (m) => {
        const sr = m.structuredResponse as { type?: string } | null;
        return sr?.type === 'artifact-preview';
      }
    );
    expect(previewMsg).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // Test 7: sealedTaskIds computation -- completion chip taskId is in sealed set
  // --------------------------------------------------------------------------
  it('sealedTaskIds contains taskId from completion chip messages', async () => {
    // Given
    mockGetThreadHistory.mockResolvedValue(threadWithCompletionChip);

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'product-manager' })
    , { wrapper: providersWrapper });

    // Wait for thread history to load
    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2);
    });

    // Then - sealedTaskIds should contain the taskId from the completion chip
    expect(result.current.sealedTaskIds).toBeInstanceOf(Set);
    expect(result.current.sealedTaskIds.has('product-manager--define-product')).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Test 8: Hook returns isGenerating, isSaving, artifactPreview, sealedTaskIds
  // --------------------------------------------------------------------------
  it('hook returns isGenerating, isSaving, artifactPreview, sealedTaskIds in the return object', async () => {
    // Given
    mockGetThreadHistory.mockResolvedValue(emptyThread);

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'assistant' })
    , { wrapper: providersWrapper });

    // Wait for initial load
    await waitFor(() => {
      expect(mockGetThreadHistory).toHaveBeenCalled();
    });

    // Then - all new values should be present in the return
    expect(result.current).toHaveProperty('isGenerating');
    expect(result.current).toHaveProperty('isSaving');
    expect(result.current).toHaveProperty('artifactPreview');
    expect(result.current).toHaveProperty('sealedTaskIds');
    expect(result.current).toHaveProperty('generateArtifact');
    expect(result.current).toHaveProperty('confirmArtifact');
    expect(result.current).toHaveProperty('rejectArtifact');

    // Verify initial values
    expect(result.current.isGenerating).toBe(false);
    expect(result.current.isSaving).toBe(false);
    expect(result.current.artifactPreview).toBeNull();
    expect(result.current.sealedTaskIds).toBeInstanceOf(Set);
    expect(result.current.sealedTaskIds.size).toBe(0);

    // Verify functions are callable
    expect(typeof result.current.generateArtifact).toBe('function');
    expect(typeof result.current.confirmArtifact).toBe('function');
    expect(typeof result.current.rejectArtifact).toBe('function');
  });
});
