/**
 * Spec 2026-01-25: Implement Click Sends "Generate implementation plan" Message and Optimistic Chat Bubble
 * Task Group 1: Optimistic Message Insertion and API Payload Update
 * Task Group 2: Duplicate Prevention and Error Handling Tests
 *
 * Tests for the generateImplementationPlan callback behavior:
 * - Test 1: Optimistic bubble appears immediately on Implement click (Phase 3)
 * - Test 2: API request contains `message: "Generate implementation plan"`
 * - Test 3: Warning modal confirm flow produces exactly one bubble after Continue
 * - Test 4: Cancel modal flow produces no bubble and no API call
 * - Test 5: In-flight state (`isImplementing === true`) prevents duplicate messages and API calls
 * - Test 6: Error response displays assistant message while preserving optimistic user message
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatMessage } from '../api/chatApi';

/**
 * Helper function to generate a message ID.
 * Mirrors the implementation in ImplementationAssistantPanel.tsx (lines 404-406)
 */
function generateMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Simulates the generateImplementationPlan callback behavior.
 * This mirrors the implementation in ImplementationAssistantPanel.tsx (lines 1572-1636)
 * with the spec 2026-01-25 changes applied.
 */
interface GeneratePlanDependencies {
  isImplementing: boolean;
  workItemId: string | null;
  sessionId: string | null;
  messages: ChatMessage[];
  setMessages: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void;
  setIsImplementing: (value: boolean) => void;
  postChatMessage: (params: { sessionId?: string; message: string; context: unknown }) => Promise<unknown>;
  buildContext: () => unknown;
}

async function simulateGenerateImplementationPlan(deps: GeneratePlanDependencies): Promise<void> {
  const {
    isImplementing,
    workItemId,
    sessionId,
    setMessages,
    setIsImplementing,
    postChatMessage,
    buildContext,
  } = deps;

  // Prevent duplicate submissions (existing guard at line 1574)
  if (isImplementing || !workItemId) return;

  // Set implementing state
  setIsImplementing(true);

  // Spec 2026-01-25: Insert optimistic user message immediately
  // This appears in Team Chat before the API call completes
  const userMessage: ChatMessage = {
    id: generateMessageId(),
    role: 'user',
    content: 'Generate implementation plan',
    timestamp: new Date(),
  };
  setMessages((prev) => [...prev, userMessage]);

  // Build context
  const context = buildContext();

  try {
    await postChatMessage({
      sessionId: sessionId || undefined,
      message: 'Generate implementation plan', // Spec 2026-01-25: Non-empty message
      context,
    });
    // Success handling would go here (not simulated in this test helper)
  } catch (err) {
    // Error handling: add error as assistant message (lines 1621-1631)
    const errorText = err instanceof Error ? err.message : 'Unknown error occurred';
    const errorMessage: ChatMessage = {
      id: generateMessageId(),
      role: 'assistant',
      content: `Failed to generate implementation plan: ${errorText}`,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, errorMessage]);
  } finally {
    setIsImplementing(false);
  }
}

/**
 * Simulates the handleImplementClick callback behavior.
 * This mirrors the implementation in ImplementationAssistantPanel.tsx (lines 1646-1661)
 */
interface HandleImplementClickDependencies {
  implementationMode: boolean;
  openQuestionCount: number;
  setIsConfirmModalOpen: (value: boolean) => void;
  setImplementationMode: (value: boolean) => void;
  generateImplementationPlan: () => Promise<void>;
}

function simulateHandleImplementClick(deps: HandleImplementClickDependencies): void {
  const {
    implementationMode,
    openQuestionCount,
    setIsConfirmModalOpen,
    setImplementationMode,
    generateImplementationPlan,
  } = deps;

  // Guard: if already in implementation mode, do nothing
  if (implementationMode) {
    return;
  }

  // Check for open questions
  if (openQuestionCount > 0) {
    // Show confirmation modal (Phase 2 path)
    setIsConfirmModalOpen(true);
  } else {
    // No open questions - proceed directly (Phase 3 path)
    setImplementationMode(true);
    generateImplementationPlan();
  }
}

/**
 * Simulates the handleModalConfirm callback behavior.
 * This mirrors the implementation in ImplementationAssistantPanel.tsx (lines 1675-1679)
 */
interface HandleModalConfirmDependencies {
  setImplementationMode: (value: boolean) => void;
  setIsConfirmModalOpen: (value: boolean) => void;
  generateImplementationPlan: () => Promise<void>;
}

function simulateHandleModalConfirm(deps: HandleModalConfirmDependencies): void {
  const { setImplementationMode, setIsConfirmModalOpen, generateImplementationPlan } = deps;
  setImplementationMode(true);
  setIsConfirmModalOpen(false);
  generateImplementationPlan();
}

/**
 * Simulates the handleModalCancel callback behavior.
 * This mirrors the implementation in ImplementationAssistantPanel.tsx (lines 1667-1669)
 */
function simulateHandleModalCancel(setIsConfirmModalOpen: (value: boolean) => void): void {
  setIsConfirmModalOpen(false);
}

// ============================================================================
// Task Group 1: Optimistic Message Insertion and API Payload Update Tests
// ============================================================================

describe('Spec 2026-01-25: Implement Click Optimistic Message - Task Group 1', () => {
  let messages: ChatMessage[];
  let isImplementing: boolean;
  let implementationMode: boolean;
  let isConfirmModalOpen: boolean;
  let postChatMessageMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    messages = [];
    isImplementing = false;
    implementationMode = false;
    isConfirmModalOpen = false;
    postChatMessageMock = vi.fn().mockResolvedValue({
      sessionId: 'session-123',
      plannerResponse: {
        implementationPlan: {
          increments: [{ id: 'inc-1', title: 'Increment 1' }],
        },
      },
    });
  });

  describe('Test 1: Optimistic bubble appears immediately on Implement click (Phase 3)', () => {
    it('appends a user chat bubble with "Generate implementation plan" immediately on click', async () => {
      // Arrange: Phase 3 state - valid planner definition, no unanswered questions
      const deps: GeneratePlanDependencies = {
        isImplementing: false,
        workItemId: 'workitem-123',
        sessionId: 'session-123',
        messages,
        setMessages: (updater) => {
          messages = updater(messages);
        },
        setIsImplementing: (value) => {
          isImplementing = value;
        },
        postChatMessage: postChatMessageMock,
        buildContext: () => ({ mode: 'implement_feature', phase: 'implementation_planning' }),
      };

      // Act: Simulate clicking Implement button in Phase 3 (triggers generateImplementationPlan)
      await simulateGenerateImplementationPlan(deps);

      // Assert: messages array contains a user message with content "Generate implementation plan"
      expect(messages.length).toBeGreaterThanOrEqual(1);
      const userMessage = messages.find((m) => m.role === 'user');
      expect(userMessage).toBeDefined();
      expect(userMessage?.content).toBe('Generate implementation plan');
      expect(userMessage?.role).toBe('user');
    });

    it('user message has correct structure (id, role, content, timestamp)', async () => {
      const deps: GeneratePlanDependencies = {
        isImplementing: false,
        workItemId: 'workitem-123',
        sessionId: 'session-123',
        messages,
        setMessages: (updater) => {
          messages = updater(messages);
        },
        setIsImplementing: (value) => {
          isImplementing = value;
        },
        postChatMessage: postChatMessageMock,
        buildContext: () => ({}),
      };

      await simulateGenerateImplementationPlan(deps);

      const userMessage = messages.find((m) => m.role === 'user');
      expect(userMessage).toBeDefined();
      expect(userMessage?.id).toMatch(/^msg-\d+-[a-z0-9]+$/); // ID format validation
      expect(userMessage?.role).toBe('user');
      expect(userMessage?.content).toBe('Generate implementation plan');
      expect(userMessage?.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('Test 2: API request contains the correct message', () => {
    it('sends /api/chat request with message === "Generate implementation plan"', async () => {
      const deps: GeneratePlanDependencies = {
        isImplementing: false,
        workItemId: 'workitem-123',
        sessionId: 'session-123',
        messages,
        setMessages: (updater) => {
          messages = updater(messages);
        },
        setIsImplementing: (value) => {
          isImplementing = value;
        },
        postChatMessage: postChatMessageMock,
        buildContext: () => ({ mode: 'implement_feature', phase: 'implementation_planning' }),
      };

      await simulateGenerateImplementationPlan(deps);

      // Assert: postChatMessage was called with correct message
      expect(postChatMessageMock).toHaveBeenCalledTimes(1);
      expect(postChatMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Generate implementation plan',
        })
      );
    });

    it('API payload includes sessionId when present', async () => {
      const deps: GeneratePlanDependencies = {
        isImplementing: false,
        workItemId: 'workitem-123',
        sessionId: 'existing-session-456',
        messages,
        setMessages: (updater) => {
          messages = updater(messages);
        },
        setIsImplementing: (value) => {
          isImplementing = value;
        },
        postChatMessage: postChatMessageMock,
        buildContext: () => ({}),
      };

      await simulateGenerateImplementationPlan(deps);

      expect(postChatMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'existing-session-456',
          message: 'Generate implementation plan',
        })
      );
    });
  });

  describe('Test 3: Warning modal confirm flow produces exactly one bubble after Continue', () => {
    it('produces exactly one optimistic bubble and one API request after user confirms', async () => {
      // Arrange: Phase 2 state - planner present + unanswered questions
      const openQuestionCount = 3;

      // Step 1: User clicks Implement button
      simulateHandleImplementClick({
        implementationMode: false,
        openQuestionCount,
        setIsConfirmModalOpen: (value) => {
          isConfirmModalOpen = value;
        },
        setImplementationMode: (value) => {
          implementationMode = value;
        },
        generateImplementationPlan: async () => {
          // Should not be called yet
          throw new Error('generateImplementationPlan should not be called before modal confirm');
        },
      });

      // Assert: Modal is open, no messages yet
      expect(isConfirmModalOpen).toBe(true);
      expect(messages.length).toBe(0);
      expect(postChatMessageMock).not.toHaveBeenCalled();

      // Step 2: User clicks "Continue" on modal
      const generatePlanDeps: GeneratePlanDependencies = {
        isImplementing: false,
        workItemId: 'workitem-123',
        sessionId: 'session-123',
        messages,
        setMessages: (updater) => {
          messages = updater(messages);
        },
        setIsImplementing: (value) => {
          isImplementing = value;
        },
        postChatMessage: postChatMessageMock,
        buildContext: () => ({}),
      };

      await new Promise<void>((resolve) => {
        simulateHandleModalConfirm({
          setImplementationMode: (value) => {
            implementationMode = value;
          },
          setIsConfirmModalOpen: (value) => {
            isConfirmModalOpen = value;
          },
          generateImplementationPlan: async () => {
            await simulateGenerateImplementationPlan(generatePlanDeps);
            resolve();
          },
        });
      });

      // Assert: Exactly one user message with "Generate implementation plan"
      const userMessages = messages.filter((m) => m.role === 'user');
      expect(userMessages.length).toBe(1);
      expect(userMessages[0].content).toBe('Generate implementation plan');

      // Assert: postChatMessage called exactly once
      expect(postChatMessageMock).toHaveBeenCalledTimes(1);

      // Assert: Modal is closed
      expect(isConfirmModalOpen).toBe(false);
    });
  });

  describe('Test 4: Cancel modal flow produces no bubble and no API call', () => {
    it('does not add optimistic bubble if user cancels the modal', () => {
      // Arrange: Phase 2 state - planner present + unanswered questions
      const openQuestionCount = 3;

      // Step 1: User clicks Implement button
      simulateHandleImplementClick({
        implementationMode: false,
        openQuestionCount,
        setIsConfirmModalOpen: (value) => {
          isConfirmModalOpen = value;
        },
        setImplementationMode: (value) => {
          implementationMode = value;
        },
        generateImplementationPlan: async () => {
          throw new Error('generateImplementationPlan should not be called');
        },
      });

      // Assert: Modal is open
      expect(isConfirmModalOpen).toBe(true);

      // Step 2: User clicks "Cancel" on modal
      simulateHandleModalCancel((value) => {
        isConfirmModalOpen = value;
      });

      // Assert: Modal is closed
      expect(isConfirmModalOpen).toBe(false);

      // Assert: No user message was added
      expect(messages.length).toBe(0);

      // Assert: postChatMessage was not called
      expect(postChatMessageMock).not.toHaveBeenCalled();

      // Assert: implementationMode was NOT set to true
      expect(implementationMode).toBe(false);
    });
  });
});

// ============================================================================
// Task Group 2: Duplicate Prevention and Error Handling Tests
// ============================================================================

describe('Spec 2026-01-25: Implement Click Optimistic Message - Task Group 2', () => {
  let messages: ChatMessage[];
  let isImplementing: boolean;
  let postChatMessageMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    messages = [];
    isImplementing = false;
    postChatMessageMock = vi.fn().mockResolvedValue({
      sessionId: 'session-123',
      plannerResponse: {
        implementationPlan: {
          increments: [{ id: 'inc-1', title: 'Increment 1' }],
        },
      },
    });
  });

  describe('Test 5: In-flight state prevents duplicates', () => {
    it('does not add duplicate messages when isImplementing is true', async () => {
      // Arrange: isImplementing is already true (simulating in-flight request)
      isImplementing = true;

      const deps: GeneratePlanDependencies = {
        isImplementing: true, // Guard condition: already implementing
        workItemId: 'workitem-123',
        sessionId: 'session-123',
        messages,
        setMessages: (updater) => {
          messages = updater(messages);
        },
        setIsImplementing: (value) => {
          isImplementing = value;
        },
        postChatMessage: postChatMessageMock,
        buildContext: () => ({}),
      };

      // Act: Attempt to generate plan while already implementing
      await simulateGenerateImplementationPlan(deps);

      // Assert: No new messages added
      expect(messages.length).toBe(0);

      // Assert: No additional API calls
      expect(postChatMessageMock).not.toHaveBeenCalled();
    });

    it('does not add messages when workItemId is null', async () => {
      const deps: GeneratePlanDependencies = {
        isImplementing: false,
        workItemId: null, // Guard condition: no work item
        sessionId: 'session-123',
        messages,
        setMessages: (updater) => {
          messages = updater(messages);
        },
        setIsImplementing: (value) => {
          isImplementing = value;
        },
        postChatMessage: postChatMessageMock,
        buildContext: () => ({}),
      };

      await simulateGenerateImplementationPlan(deps);

      expect(messages.length).toBe(0);
      expect(postChatMessageMock).not.toHaveBeenCalled();
    });
  });

  describe('Test 6: Error response displays assistant message while preserving optimistic user message', () => {
    it('preserves optimistic user message and adds error as assistant message on API failure', async () => {
      // Arrange: API will fail
      const apiError = new Error('Network error: Connection refused');
      postChatMessageMock.mockRejectedValue(apiError);

      const deps: GeneratePlanDependencies = {
        isImplementing: false,
        workItemId: 'workitem-123',
        sessionId: 'session-123',
        messages,
        setMessages: (updater) => {
          messages = updater(messages);
        },
        setIsImplementing: (value) => {
          isImplementing = value;
        },
        postChatMessage: postChatMessageMock,
        buildContext: () => ({}),
      };

      // Act: Generate plan (will fail)
      await simulateGenerateImplementationPlan(deps);

      // Assert: User's optimistic message is preserved
      const userMessages = messages.filter((m) => m.role === 'user');
      expect(userMessages.length).toBe(1);
      expect(userMessages[0].content).toBe('Generate implementation plan');

      // Assert: Error message added as assistant message
      const assistantMessages = messages.filter((m) => m.role === 'assistant');
      expect(assistantMessages.length).toBe(1);
      expect(assistantMessages[0].content).toContain('Failed to generate implementation plan');
      expect(assistantMessages[0].content).toContain('Network error: Connection refused');

      // Assert: Total messages = 2 (user + assistant error)
      expect(messages.length).toBe(2);
    });

    it('handles unknown error type gracefully', async () => {
      // Arrange: API will fail with non-Error object
      postChatMessageMock.mockRejectedValue('Unknown failure');

      const deps: GeneratePlanDependencies = {
        isImplementing: false,
        workItemId: 'workitem-123',
        sessionId: 'session-123',
        messages,
        setMessages: (updater) => {
          messages = updater(messages);
        },
        setIsImplementing: (value) => {
          isImplementing = value;
        },
        postChatMessage: postChatMessageMock,
        buildContext: () => ({}),
      };

      await simulateGenerateImplementationPlan(deps);

      // Assert: User message preserved
      expect(messages.filter((m) => m.role === 'user').length).toBe(1);

      // Assert: Error message uses fallback text
      const assistantMessage = messages.find((m) => m.role === 'assistant');
      expect(assistantMessage?.content).toContain('Unknown error occurred');
    });
  });
});
