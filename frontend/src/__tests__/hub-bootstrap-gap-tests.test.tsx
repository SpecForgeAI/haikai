/**
 * Hub Bootstrap 1: Gap Analysis Tests (Frontend)
 *
 * Spec 2026-02-28: Hub Bootstrap 1 -- Product Definition (PM) End-to-End
 * Task Group 8: Test Review and Gap Analysis
 *
 * These tests fill critical coverage gaps identified during the TG8 review
 * of tests from Task Groups 1-7. Each test targets a specific workflow or
 * edge case that was missing from the existing 35 tests.
 *
 * Gap tests (7 frontend tests):
 * 1. hasQuestions returns false for empty questions array
 * 2. extractQuestions handles mixed array of strings and objects
 * 3. ArtifactPreviewBubble Reject button calls onReject callback
 * 4. Phase detection does NOT trigger generation when artifactPreview is already set
 * 5. generateArtifact handles thrown network error (exception path)
 * 6. confirmArtifact timeout error shows specific "Save timed out" message
 * 7. missionExists warning is appended when re-running PM define-product task
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { renderHook, act, waitFor } from '@testing-library/react';

// ============================================================================
// Imports for component tests
// ============================================================================

import { MessageBubble } from '../components/UnifiedChat/MessageBubble';
import { ArtifactPreviewBubble } from '../components/UnifiedChat/ArtifactPreviewBubble';
import type { ThreadMessage, Thread, ChatV2Response, ThreadKey } from '../api/chatV2Api';

// ============================================================================
// CSS module mocks
// ============================================================================

vi.mock('../components/UnifiedChat/MessageBubble.module.css', () => ({
  default: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => String(prop),
  }),
}));

vi.mock('../components/UnifiedChat/StructuredQuestionsRenderer.module.css', () => ({
  default: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => String(prop),
  }),
}));

vi.mock('../components/UnifiedChat/TaskMenu.module.css', () => ({
  default: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => String(prop),
  }),
}));

vi.mock('../components/UnifiedChat/ArtifactPreviewBubble.module.css', () => ({
  default: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => String(prop),
  }),
}));

vi.mock('../components/UnifiedChat/CompletionChip.module.css', () => ({
  default: new Proxy({}, {
    get: (_target: object, prop: string | symbol) => String(prop),
  }),
}));

// Catch-all lucide-react mock: components under test pull an evolving set of
// icons (Download, Users, ...). A Proxy serves any icon name so the mock never
// goes stale; Download keeps its original explicit test id.
vi.mock('lucide-react', () => {
  const Download = (props: Record<string, unknown>) => (
    <svg data-testid="download-icon" {...props} />
  );
  const explicit: Record<string, unknown> = { Download };
  return new Proxy(explicit, {
    get(target, prop) {
      if (typeof prop !== 'string' || prop === 'then') return undefined;
      if (prop in target) return target[prop];
      const Icon = (props: Record<string, unknown>) => (
        <svg data-testid={`${prop.toLowerCase()}-icon`} {...props} />
      );
      target[prop] = Icon;
      return Icon;
    },
  });
});

// ============================================================================
// API mocks for hook tests
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
    postGenerateArtifact: vi.fn(),
    postSaveArtifact: vi.fn(),
  };
});

vi.mock('../contexts/UserJourneyReviewContext', () => ({
  useActivateJourneyReview: vi.fn(() => vi.fn()),
}));

import {
  postChatV2,
  getThreadHistory,
  postHandoff,
  postGenerateArtifact,
  postSaveArtifact,
} from '../api/chatV2Api';
import { useChatThread } from '../hooks/useChatThread';
import { createProvidersWrapper } from '../test-utils/renderWithProviders';

// Shared harness: useChatThread reads useActiveArchitectureId(), which
// requires the real ArchitectureProvider (Router + ProjectContext stack).
const providersWrapper = createProvidersWrapper();

const mockPostChatV2 = vi.mocked(postChatV2);
const mockGetThreadHistory = vi.mocked(getThreadHistory);
const mockPostHandoff = vi.mocked(postHandoff);
const mockPostGenerateArtifact = vi.mocked(postGenerateArtifact);
const mockPostSaveArtifact = vi.mocked(postSaveArtifact);

// ============================================================================
// Helpers
// ============================================================================

function createAssistantMessage(overrides: Partial<ThreadMessage> = {}): ThreadMessage {
  return {
    id: 'msg-gap-1',
    role: 'assistant',
    personaId: 'product-manager',
    taskId: 'product-manager--define-product',
    content: 'Test content',
    structuredResponse: null,
    timestamp: '2026-02-28T10:00:00.000Z',
    ...overrides,
  };
}

const testThreadKey: ThreadKey = { type: 'hub', projectId: 'gap-test-proj' };

// ============================================================================
// Gap Test 1: hasQuestions returns false for empty questions array
// ============================================================================

describe('Hub Bootstrap 1: Gap Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPostHandoff.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hasQuestions returns false when structuredResponse.questions is an empty array (no StructuredQuestionsRenderer rendered)', () => {
    const message = createAssistantMessage({
      structuredResponse: {
        questions: [],
      },
    });

    const mockOnSubmitAnswers = vi.fn();
    render(
      <MessageBubble
        message={message}
        onSubmitAnswers={mockOnSubmitAnswers}
      />
    );

    // With an empty questions array, hasQuestions should return false,
    // so StructuredQuestionsRenderer should NOT be rendered
    expect(screen.queryByTestId('structured-questions')).not.toBeInTheDocument();
  });

  // ============================================================================
  // Gap Test 2: extractQuestions handles mixed array of strings and objects
  // ============================================================================

  it('extractQuestions handles a mixed array containing both strings and { id, question } objects', () => {
    const message = createAssistantMessage({
      structuredResponse: {
        questions: [
          'Plain string question',
          { id: 'obj-1', question: 'Structured question' },
        ],
      },
    });

    const mockOnSubmitAnswers = vi.fn();
    render(
      <MessageBubble
        message={message}
        onSubmitAnswers={mockOnSubmitAnswers}
      />
    );

    // The renderer should be shown (hasQuestions returns true for string at index 0)
    expect(screen.getByTestId('structured-questions')).toBeInTheDocument();

    // The string should be normalized to q-0
    expect(screen.getByTestId('question-row-q-0')).toBeInTheDocument();
    expect(screen.getByText('Plain string question')).toBeInTheDocument();

    // The object should keep its original id
    expect(screen.getByTestId('question-row-obj-1')).toBeInTheDocument();
    expect(screen.getByText('Structured question')).toBeInTheDocument();
  });

  // ============================================================================
  // Gap Test 3: ArtifactPreviewBubble Reject button calls onReject callback
  // ============================================================================

  it('ArtifactPreviewBubble calls onReject when Reject button is clicked', () => {
    const mockOnConfirm = vi.fn();
    const mockOnReject = vi.fn();

    render(
      <ArtifactPreviewBubble
        markdownContent="# Test Content"
        onConfirm={mockOnConfirm}
        onReject={mockOnReject}
        isConfirming={false}
        disabled={false}
      />
    );

    const rejectButton = screen.getByRole('button', { name: 'Reject' });
    fireEvent.click(rejectButton);

    expect(mockOnReject).toHaveBeenCalledTimes(1);
    expect(mockOnConfirm).not.toHaveBeenCalled();
  });

  // ============================================================================
  // Gap Test 4: Phase detection does NOT trigger generation when artifactPreview
  //             is already set
  // ============================================================================

  it('phase detection does NOT trigger generation when artifactPreview is already set', async () => {
    // Given: a thread that already has a ready-phase message
    const threadWithReadyPhase: Thread = {
      threadKey: 'project:gap-test-proj:hub',
      projectId: 'gap-test-proj',
      messages: [
        {
          id: 'msg-ready',
          role: 'assistant',
          personaId: 'product-manager',
          taskId: 'product-manager--define-product',
          content: 'I have enough information.',
          structuredResponse: {
            phase: 'ready',
            summary: 'Ready to generate',
          },
          timestamp: '2026-02-28T09:00:00.000Z',
        },
      ],
      activePersonaId: 'product-manager',
      activeTaskId: 'product-manager--define-product',
      createdAt: '2026-02-28T09:00:00.000Z',
      updatedAt: '2026-02-28T09:00:00.000Z',
    };

    mockGetThreadHistory.mockResolvedValue(threadWithReadyPhase);

    // First generate call succeeds and sets artifactPreview
    mockPostGenerateArtifact.mockResolvedValue({
      success: true,
      missionMarkdown: '# Generated Mission',
    });

    // Also mock postChatV2 for the second sendMessage call
    mockPostChatV2.mockResolvedValue({
      threadKey: 'project:gap-test-proj:hub',
      personaId: 'product-manager',
      taskId: 'product-manager--define-product',
      assistant: { message: 'Continuing the conversation.' },
      structuredResponse: null,
    });

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'product-manager' })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });

    // First: user sends confirmation, which triggers generation (phase=ready detected)
    await act(async () => {
      await result.current.sendMessage('Yes, generate it!');
    });

    expect(mockPostGenerateArtifact).toHaveBeenCalledTimes(1);
    expect(result.current.artifactPreview).not.toBeNull();

    // Now: user sends another message while artifactPreview is set
    // This should NOT re-trigger generation; it should go through normal sendMessage
    await act(async () => {
      await result.current.sendMessage('Another message');
    });

    // postGenerateArtifact should still be at 1 (not called again)
    expect(mockPostGenerateArtifact).toHaveBeenCalledTimes(1);
    // postChatV2 should have been called for the normal message
    expect(mockPostChatV2).toHaveBeenCalledTimes(1);
  });

  // ============================================================================
  // Gap Test 5: generateArtifact handles thrown network error (exception path)
  // ============================================================================

  it('generateArtifact appends error message when postGenerateArtifact throws a network error', async () => {
    const threadWithPmTask: Thread = {
      threadKey: 'project:gap-test-proj:hub',
      projectId: 'gap-test-proj',
      messages: [],
      activePersonaId: 'product-manager',
      activeTaskId: 'product-manager--define-product',
      createdAt: '2026-02-28T10:00:00.000Z',
      updatedAt: '2026-02-28T10:00:00.000Z',
    };

    mockGetThreadHistory.mockResolvedValue(threadWithPmTask);
    mockPostGenerateArtifact.mockRejectedValue(new Error('Network timeout'));

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'product-manager' })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('product-manager--define-product');
    });

    await act(async () => {
      await result.current.generateArtifact('product-manager--define-product');
    });

    // Should have an error message mentioning the network error
    const errorMsg = result.current.messages.find(
      (m) => m.role === 'system' && m.content.includes('Network timeout')
    );
    expect(errorMsg).toBeDefined();
    expect(errorMsg!.content).toContain('MISSION.MD generation failed');
    expect(errorMsg!.content).toContain('You can try again');

    // artifactPreview should not be set
    expect(result.current.artifactPreview).toBeNull();

    // isGenerating should be back to false
    expect(result.current.isGenerating).toBe(false);
  });

  // ============================================================================
  // Gap Test 6: confirmArtifact timeout error shows specific "Save timed out" message
  // ============================================================================

  it('confirmArtifact shows "Save timed out" message when postSaveArtifact throws a timeout error', async () => {
    const threadWithPmTask: Thread = {
      threadKey: 'project:gap-test-proj:hub',
      projectId: 'gap-test-proj',
      messages: [],
      activePersonaId: 'product-manager',
      activeTaskId: 'product-manager--define-product',
      createdAt: '2026-02-28T10:00:00.000Z',
      updatedAt: '2026-02-28T10:00:00.000Z',
    };

    mockGetThreadHistory.mockResolvedValue(threadWithPmTask);
    mockPostGenerateArtifact.mockResolvedValue({
      success: true,
      missionMarkdown: '# Mission\n\nTest content.',
    });
    // Simulate a timeout error thrown by the save endpoint
    mockPostSaveArtifact.mockRejectedValue(new Error('Request timeout'));

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, { initialPersonaId: 'product-manager' })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(result.current.activeTaskId).toBe('product-manager--define-product');
    });

    // First generate the artifact
    await act(async () => {
      await result.current.generateArtifact('product-manager--define-product');
    });

    expect(result.current.artifactPreview).not.toBeNull();

    // Then try to confirm (will throw timeout)
    await act(async () => {
      await result.current.confirmArtifact();
    });

    // Should show the specific timeout message
    const timeoutMsg = result.current.messages.find(
      (m) => m.role === 'system' && m.content.includes('Save timed out')
    );
    expect(timeoutMsg).toBeDefined();
    expect(timeoutMsg!.content).toBe('Save timed out. Please try again.');

    // artifactPreview should still be available for retry
    expect(result.current.artifactPreview).not.toBeNull();

    // isSaving should be back to false
    expect(result.current.isSaving).toBe(false);
  });

  // ============================================================================
  // Gap Test 7: missionExists warning is appended when selecting PM define-product task
  // ============================================================================

  it('missionExists warning is appended when selectTask is called for product-manager--define-product with missionExists=true', async () => {
    const emptyThread: Thread = {
      threadKey: 'project:gap-test-proj:hub',
      projectId: 'gap-test-proj',
      messages: [],
      activePersonaId: 'product-manager',
      activeTaskId: 'unknown',
      createdAt: '2026-02-28T10:00:00.000Z',
      updatedAt: '2026-02-28T10:00:00.000Z',
    };

    mockGetThreadHistory.mockResolvedValue(emptyThread);

    // Mock the postChatV2 call that selectTask triggers (via sendMessage)
    mockPostChatV2.mockResolvedValue({
      threadKey: 'project:gap-test-proj:hub',
      personaId: 'product-manager',
      taskId: 'product-manager--define-product',
      assistant: { message: 'Let me help you define your product.' },
      structuredResponse: {
        phase: 'questions',
        questions: ['What does your product do?'],
        summary: 'Starting discovery.',
      },
    });

    const { result } = renderHook(() =>
      useChatThread(testThreadKey, {
        initialPersonaId: 'product-manager',
        artifactExists: { mission: true },
      })
    , { wrapper: providersWrapper });

    await waitFor(() => {
      expect(mockGetThreadHistory).toHaveBeenCalled();
    });

    // Select the define-product task
    await act(async () => {
      result.current.selectTask('product-manager--define-product');
    });

    // Wait for the async operations to complete
    await waitFor(() => {
      // Should find the missionExists warning message
      const warningMsg = result.current.messages.find(
        (m) => m.role === 'system' && m.content.includes('already exists')
      );
      expect(warningMsg).toBeDefined();
      expect(warningMsg!.content).toBe(
        'A Product Definition (MISSION.md) already exists. Completing this conversation will replace it.'
      );
    });
  });
});
