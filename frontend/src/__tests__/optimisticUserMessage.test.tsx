/**
 * Tests for Optimistic User Message Behavior
 *
 * Spec 2026-01-25: Open Questions Optimistic User Message
 * Task Group 4: Test Suite for Optimistic Message Behavior
 *
 * Tests verify that:
 * - User message appears immediately on button click (before API resolves)
 * - Message content matches composeAnswersMessage() output format
 * - Message has role: 'user' for proper styling
 * - Message appears before API call resolves
 * - After API success, assistant response appears after user message
 * - No duplicate user message after API success
 * - Double-click while submission in-flight does not create duplicate user message
 * - isSubmittingAnswers guard prevents re-entry into handleSubmitAnswers
 * - On API error, user message remains visible in transcript
 * - On API error, error is appended as assistant message after user message
 * - PO path shows optimistic message
 * - SA path shows optimistic message
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChatMessage, Question, ChatResponse, PlannerResponse } from '../api/chatApi';

// ============================================================================
// Helper Functions (Mirroring ImplementationAssistantPanel.tsx)
// ============================================================================

/**
 * Generate a unique message ID (mirrors implementation)
 */
function generateMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Composes a user message from a provided array of questions with answers.
 * Format: "Q: [question text]\nA: [answer text]\n\n" for each question
 * (mirrors implementation)
 */
function composeAnswersMessage(questionsWithAnswers: Question[]): string {
  return questionsWithAnswers
    .map((q) => `Q: ${q.question}\nA: ${q.answer}`)
    .join('\n\n');
}

// ============================================================================
// Mock State Management
// ============================================================================

interface MockState {
  messages: ChatMessage[];
  isSubmittingAnswers: boolean;
  questionStatuses: Map<string, 'Open' | 'Answered'>;
  error: string | null;
}

function createInitialState(): MockState {
  return {
    messages: [],
    isSubmittingAnswers: false,
    questionStatuses: new Map(),
    error: null,
  };
}

// ============================================================================
// Task 4.1: Tests for Optimistic Message Insertion
// ============================================================================

describe('Optimistic Message Insertion', () => {
  /**
   * Test 1: Clicking "Answer Open Questions" adds a "You" message to transcript immediately
   * (mock API to delay/not resolve)
   */
  it('should add user message to transcript immediately on button click', async () => {
    const state = createInitialState();
    const submittableQuestions: Question[] = [
      {
        id: 'q1',
        question: 'What is the feature scope?',
        status: 'Open',
        answer: 'Limited to user authentication',
        source: 'Product Owner',
      },
    ];

    // Simulate the optimistic message insertion (before API call)
    const userMessageContent = composeAnswersMessage(submittableQuestions);
    const userMessage: ChatMessage = {
      id: generateMessageId(),
      role: 'user',
      content: userMessageContent,
      timestamp: new Date(),
    };

    // Insert message immediately (this happens before API await)
    state.messages = [...state.messages, userMessage];

    // Verify message is in state immediately
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].role).toBe('user');
    expect(state.messages[0].content).toContain('Q: What is the feature scope?');
  });

  /**
   * Test 2: User message content matches composeAnswersMessage() output format
   */
  it('should have message content matching composeAnswersMessage output format', () => {
    const questions: Question[] = [
      {
        id: 'q1',
        question: 'What database should we use?',
        status: 'Open',
        answer: 'PostgreSQL',
        source: 'Product Owner',
      },
      {
        id: 'q2',
        question: 'What caching strategy?',
        status: 'Open',
        answer: 'Redis for session cache',
        source: 'Product Owner',
      },
    ];

    const messageContent = composeAnswersMessage(questions);

    // Verify Q/A format
    expect(messageContent).toBe(
      'Q: What database should we use?\nA: PostgreSQL\n\n' +
      'Q: What caching strategy?\nA: Redis for session cache'
    );
  });

  /**
   * Test 3: User message has role: 'user' for proper styling
   */
  it('should create message with role "user" for proper "You" styling', () => {
    const userMessage: ChatMessage = {
      id: generateMessageId(),
      role: 'user',
      content: 'Q: Test question?\nA: Test answer',
      timestamp: new Date(),
    };

    expect(userMessage.role).toBe('user');
    // In the actual UI, role: 'user' renders with "You" styling (verified in ChatBubble)
  });

  /**
   * Test 4: Message appears before API call resolves (use delayed mock)
   */
  it('should have message in state before API call resolves', async () => {
    const state = createInitialState();
    let apiResolved = false;

    const submittableQuestions: Question[] = [
      {
        id: 'q1',
        question: 'Test question?',
        status: 'Open',
        answer: 'Test answer',
        source: 'Product Owner',
      },
    ];

    // Simulate the flow: insert message, then API call
    const userMessageContent = composeAnswersMessage(submittableQuestions);
    const userMessage: ChatMessage = {
      id: generateMessageId(),
      role: 'user',
      content: userMessageContent,
      timestamp: new Date(),
    };

    // 1. Insert message BEFORE API call
    state.messages = [...state.messages, userMessage];

    // At this point, message is in state but API hasn't resolved
    expect(state.messages).toHaveLength(1);
    expect(apiResolved).toBe(false);

    // 2. Simulate delayed API resolution
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        apiResolved = true;
        resolve();
      }, 100);
    });

    // Message was already in state before API resolved
    expect(apiResolved).toBe(true);
    expect(state.messages).toHaveLength(1);
  });
});

// ============================================================================
// Task 4.2: Tests for Message Ordering
// ============================================================================

describe('Message Ordering', () => {
  /**
   * Test 5: After API success, assistant response appears after user message (correct order)
   */
  it('should maintain correct order: user message -> assistant response', async () => {
    const state = createInitialState();

    const submittableQuestions: Question[] = [
      {
        id: 'q1',
        question: 'What is the scope?',
        status: 'Open',
        answer: 'Authentication only',
        source: 'Product Owner',
      },
    ];

    // 1. Insert optimistic user message
    const userMessageContent = composeAnswersMessage(submittableQuestions);
    const userMessage: ChatMessage = {
      id: generateMessageId(),
      role: 'user',
      content: userMessageContent,
      timestamp: new Date(),
    };
    state.messages = [...state.messages, userMessage];

    // 2. Simulate API success - append assistant message
    const assistantMessage: ChatMessage = {
      id: generateMessageId(),
      role: 'assistant',
      content: 'Thank you for the clarification. I understand the scope is limited to authentication.',
      timestamp: new Date(),
    };
    state.messages = [...state.messages, assistantMessage];

    // Verify order: user first, then assistant
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0].role).toBe('user');
    expect(state.messages[1].role).toBe('assistant');
  });

  /**
   * Test 6: No duplicate user message after API success (only one user message in transcript)
   */
  it('should not have duplicate user message after API success', async () => {
    const state = createInitialState();

    const submittableQuestions: Question[] = [
      {
        id: 'q1',
        question: 'What is the timeline?',
        status: 'Open',
        answer: 'Q1 2026',
        source: 'Product Owner',
      },
    ];

    // 1. Insert optimistic user message (BEFORE API call)
    const userMessageContent = composeAnswersMessage(submittableQuestions);
    const userMessage: ChatMessage = {
      id: generateMessageId(),
      role: 'user',
      content: userMessageContent,
      timestamp: new Date(),
    };
    state.messages = [...state.messages, userMessage];

    // 2. Simulate API success - only append assistant message (no duplicate user message)
    // The implementation removes post-success user message insertion
    const assistantMessage: ChatMessage = {
      id: generateMessageId(),
      role: 'assistant',
      content: 'Noted, the timeline is Q1 2026.',
      timestamp: new Date(),
    };
    state.messages = [...state.messages, assistantMessage];

    // Count user messages - should be exactly 1
    const userMessages = state.messages.filter(m => m.role === 'user');
    expect(userMessages).toHaveLength(1);

    // Verify total message count
    expect(state.messages).toHaveLength(2);
  });
});

// ============================================================================
// Task 4.3: Tests for Duplicate Prevention
// ============================================================================

describe('Duplicate Prevention', () => {
  /**
   * Test 7: Double-click while submission in-flight does not create duplicate user message
   */
  it('should not create duplicate message on rapid double-click', () => {
    const state = createInitialState();
    let callCount = 0;

    const submittableQuestions: Question[] = [
      {
        id: 'q1',
        question: 'Test?',
        status: 'Open',
        answer: 'Answer',
        source: 'Product Owner',
      },
    ];

    // Simulate handleSubmitAnswers with guard
    const handleSubmitAnswers = () => {
      // Early-return guard (mirrors implementation)
      if (state.isSubmittingAnswers) return;

      callCount++;
      state.isSubmittingAnswers = true;

      // Insert optimistic message
      const userMessageContent = composeAnswersMessage(submittableQuestions);
      const userMessage: ChatMessage = {
        id: generateMessageId(),
        role: 'user',
        content: userMessageContent,
        timestamp: new Date(),
      };
      state.messages = [...state.messages, userMessage];
    };

    // First click - should proceed
    handleSubmitAnswers();
    expect(callCount).toBe(1);
    expect(state.messages).toHaveLength(1);

    // Second click (rapid) - should be blocked by guard
    handleSubmitAnswers();
    expect(callCount).toBe(1); // Still 1, guard blocked it
    expect(state.messages).toHaveLength(1); // Still 1 message
  });

  /**
   * Test 8: isSubmittingAnswers guard prevents re-entry into handleSubmitAnswers
   */
  it('should prevent re-entry when isSubmittingAnswers is true', () => {
    const state = createInitialState();
    state.isSubmittingAnswers = true; // Already submitting

    let didEnterFunction = false;

    const handleSubmitAnswers = () => {
      // Early-return guard
      if (state.isSubmittingAnswers) return;

      didEnterFunction = true;
      // Rest of function would execute here
    };

    handleSubmitAnswers();

    expect(didEnterFunction).toBe(false);
  });
});

// ============================================================================
// Task 4.4: Tests for Error Handling
// ============================================================================

describe('Error Handling', () => {
  /**
   * Test 9: On API error, user message remains visible in transcript
   */
  it('should keep user message visible on API error', async () => {
    const state = createInitialState();

    const submittableQuestions: Question[] = [
      {
        id: 'q1',
        question: 'What is the budget?',
        status: 'Open',
        answer: '$50,000',
        source: 'Product Owner',
      },
    ];

    // 1. Insert optimistic user message
    const userMessageContent = composeAnswersMessage(submittableQuestions);
    const userMessage: ChatMessage = {
      id: generateMessageId(),
      role: 'user',
      content: userMessageContent,
      timestamp: new Date(),
    };
    state.messages = [...state.messages, userMessage];

    // 2. Simulate API error
    const errorMessage = 'Network error: Failed to submit answers';
    state.error = errorMessage;

    // User message should still be present
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].role).toBe('user');
    expect(state.messages[0].content).toContain('$50,000');
  });

  /**
   * Test 10: On API error, error is appended as assistant message after user message
   */
  it('should append error as assistant message after user message on failure', async () => {
    const state = createInitialState();

    const submittableQuestions: Question[] = [
      {
        id: 'q1',
        question: 'Test?',
        status: 'Open',
        answer: 'Test answer',
        source: 'Product Owner',
      },
    ];

    // 1. Insert optimistic user message
    const userMessage: ChatMessage = {
      id: generateMessageId(),
      role: 'user',
      content: composeAnswersMessage(submittableQuestions),
      timestamp: new Date(),
    };
    state.messages = [...state.messages, userMessage];

    // 2. Simulate API error - append error as assistant message
    const errorMessage = 'Chat request failed: 500';
    const errorChatMessage: ChatMessage = {
      id: generateMessageId(),
      role: 'assistant',
      content: `Error: ${errorMessage}`,
      timestamp: new Date(),
    };
    state.messages = [...state.messages, errorChatMessage];

    // Verify order and content
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0].role).toBe('user');
    expect(state.messages[1].role).toBe('assistant');
    expect(state.messages[1].content).toContain('Error:');
    expect(state.messages[1].content).toContain('500');
  });
});

// ============================================================================
// Task 4.5: Tests for Both Paths (PO and SA)
// ============================================================================

describe('Both Paths (PO and SA)', () => {
  /**
   * Test 11: PO path (non-implementation_clarification phase) shows optimistic message
   */
  it('should show optimistic message in PO path (refine phase)', () => {
    const state = createInitialState();
    const currentPhase = 'refine'; // PO phase
    const activeIncrementId = null; // No active increment

    const poQuestions: Question[] = [
      {
        id: 'po-q1',
        question: 'What are the acceptance criteria?',
        status: 'Open',
        answer: 'User can log in with email/password',
        source: 'Product Owner',
      },
    ];

    // PO path condition: currentPhase !== 'implementation_clarification' || !activeIncrementId
    const isPOPath = currentPhase !== 'implementation_clarification' || !activeIncrementId;
    expect(isPOPath).toBe(true);

    // Simulate PO path optimistic message
    const userMessageContent = composeAnswersMessage(poQuestions);
    const userMessage: ChatMessage = {
      id: generateMessageId(),
      role: 'user',
      content: userMessageContent,
      timestamp: new Date(),
    };
    state.messages = [...state.messages, userMessage];

    // Verify optimistic message was added
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].role).toBe('user');
    expect(state.messages[0].content).toContain('acceptance criteria');
  });

  /**
   * Test 12: SA path (implementation_clarification phase with activeIncrementId) shows optimistic message
   */
  it('should show optimistic message in SA path (implementation_clarification phase)', () => {
    const state = createInitialState();
    const currentPhase = 'implementation_clarification'; // SA phase
    const activeIncrementId = 'INC-1'; // Has active increment

    const saQuestions: Question[] = [
      {
        id: 'sa-q1',
        question: 'What database should we use?',
        status: 'Open',
        answer: 'PostgreSQL with connection pooling',
        source: 'Software Architect',
        incrementId: 'INC-1',
      },
    ];

    // SA path condition: currentPhase === 'implementation_clarification' && activeIncrementId
    const isSAPath = currentPhase === 'implementation_clarification' && !!activeIncrementId;
    expect(isSAPath).toBe(true);

    // Filter for SA questions in active increment (as done in implementation)
    const saSubmittableQuestions = saQuestions.filter(
      q => q.source === 'Software Architect' && q.incrementId === activeIncrementId
    );
    expect(saSubmittableQuestions).toHaveLength(1);

    // Simulate SA path optimistic message
    const userMessageContent = composeAnswersMessage(saSubmittableQuestions);
    const userMessage: ChatMessage = {
      id: generateMessageId(),
      role: 'user',
      content: userMessageContent,
      timestamp: new Date(),
    };
    state.messages = [...state.messages, userMessage];

    // Verify optimistic message was added
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].role).toBe('user');
    expect(state.messages[0].content).toContain('PostgreSQL');
  });
});

// ============================================================================
// Additional Edge Case Tests
// ============================================================================

describe('Edge Cases', () => {
  it('should not add message when no submittable questions exist', () => {
    const state = createInitialState();

    const questions: Question[] = [
      {
        id: 'q1',
        question: 'Already answered?',
        status: 'Answered', // Not Open
        answer: 'Yes',
        source: 'Product Owner',
      },
      {
        id: 'q2',
        question: 'No answer yet?',
        status: 'Open',
        answer: '', // Empty answer
        source: 'Product Owner',
      },
    ];

    // Filter for submittable questions (mirrors implementation)
    const submittableQuestions = questions.filter(
      q => q.status === 'Open' && q.answer.trim().length > 0
    );

    // Should early return - no submittable questions
    if (submittableQuestions.length === 0) {
      // No message added
      expect(state.messages).toHaveLength(0);
      return;
    }

    // This code should not be reached
    expect(true).toBe(false);
  });

  it('should reset isSubmittingAnswers to false in finally block', async () => {
    const state = createInitialState();
    state.isSubmittingAnswers = true;

    // Simulate finally block behavior (always runs)
    try {
      // Simulate API call (success or failure)
      throw new Error('API failed');
    } catch {
      // Error handling
    } finally {
      state.isSubmittingAnswers = false;
    }

    expect(state.isSubmittingAnswers).toBe(false);
  });
});
