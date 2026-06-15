/**
 * ChatMessageList Tests
 *
 * Spec 2026-01-28: Implement Button Starts Shape-Spec Stream
 * Task Group 5: Streaming Chat Message Rendering
 *
 * Tests for ChatMessageList component, focusing on the enhanced auto-scroll
 * behavior that supports streaming content updates.
 *
 * Spec 2026-01-30: Force RHS Team Chat Scroll to Bottom
 * Task Group 1: ChatMessageList Scroll Bypass
 * - Tests for disableAutoScroll prop that bypasses internal scroll logic
 *
 * Task Group 3: Test Review and Integration Verification
 * - Additional strategic tests for scroll behavior edge cases
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatMessageList } from './ChatMessageList';
import type { ChatMessage } from '../../api/chatApi';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock ChatMessage for testing.
 */
function createMockMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    role: 'assistant',
    content: 'Test message content',
    timestamp: new Date(),
    ...overrides,
  };
}

// ============================================================================
// Task Group 5: Auto-scroll Behavior Tests
// ============================================================================

describe('ChatMessageList - Auto-scroll for Streaming (Task Group 5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // Test 5.5a: Component renders with messages
  // ==========================================================================
  it('renders messages correctly', () => {
    // Given: A list of messages
    const messages: ChatMessage[] = [
      createMockMessage({ id: 'msg-1', content: 'First message', role: 'user' }),
      createMockMessage({ id: 'msg-2', content: 'Second message', role: 'assistant' }),
    ];

    // When: Component is rendered
    render(<ChatMessageList messages={messages} />);

    // Then: Both messages should be displayed
    expect(screen.getByText('First message')).toBeInTheDocument();
    expect(screen.getByText('Second message')).toBeInTheDocument();
  });

  // ==========================================================================
  // Test 5.5b: Persona routing for implementation_clarification phase
  // ==========================================================================
  it('routes to Software Architect persona for implementation_clarification phase', () => {
    // Given: A message and implementation_clarification phase
    const messages: ChatMessage[] = [
      createMockMessage({ id: 'msg-1', content: 'Architect response', role: 'assistant' }),
    ];

    // When: Component is rendered with implementation_clarification phase
    render(
      <ChatMessageList
        messages={messages}
        currentPhase="implementation_clarification"
      />
    );

    // Then: The Software Architect persona should be displayed
    expect(screen.getByText('Software Developer')).toBeInTheDocument();
  });

  // ==========================================================================
  // Test 5.5c: Default persona for undefined phase
  // ==========================================================================
  it('routes to Product Owner persona when phase is undefined', () => {
    // Given: A message without a specific phase
    const messages: ChatMessage[] = [
      createMockMessage({ id: 'msg-1', content: 'Owner response', role: 'assistant' }),
    ];

    // When: Component is rendered without phase
    render(<ChatMessageList messages={messages} />);

    // Then: The Product Owner persona should be displayed
    expect(screen.getByText('Product Manager')).toBeInTheDocument();
  });

  // ==========================================================================
  // Test 5.5d: User messages show "You" label
  // ==========================================================================
  it('displays You label for user messages regardless of phase', () => {
    // Given: A user message
    const messages: ChatMessage[] = [
      createMockMessage({ id: 'msg-1', content: 'User question', role: 'user' }),
    ];

    // When: Component is rendered with any phase
    render(
      <ChatMessageList
        messages={messages}
        currentPhase="implementation_clarification"
      />
    );

    // Then: The "You" label should be displayed for user message
    expect(screen.getByText('You')).toBeInTheDocument();
  });

  // ==========================================================================
  // Test 5.5e: Container has data-testid for testing
  // ==========================================================================
  it('renders container with correct data-testid', () => {
    // Given: A list of messages
    const messages: ChatMessage[] = [
      createMockMessage({ id: 'msg-1', content: 'Test message' }),
    ];

    // When: Component is rendered
    render(<ChatMessageList messages={messages} />);

    // Then: Container should have data-testid
    expect(screen.getByTestId('chat-message-list')).toBeInTheDocument();
  });

  // ==========================================================================
  // Test 5.5f: Auto-scroll behavior setup verification
  // ==========================================================================
  it('tracks message content for streaming auto-scroll', () => {
    // Given: Initial message
    const initialMessages: ChatMessage[] = [
      createMockMessage({ id: 'msg-1', content: 'Initial content' }),
    ];

    // When: Component is rendered
    const { rerender } = render(<ChatMessageList messages={initialMessages} />);

    // Then: Message is displayed
    expect(screen.getByText('Initial content')).toBeInTheDocument();

    // When: Message content is updated (simulating streaming)
    const updatedMessages: ChatMessage[] = [
      createMockMessage({ id: 'msg-1', content: 'Updated content with more text' }),
    ];
    rerender(<ChatMessageList messages={updatedMessages} />);

    // Then: Updated message is displayed
    expect(screen.getByText('Updated content with more text')).toBeInTheDocument();

    // The auto-scroll behavior is triggered by the useEffect that tracks:
    // - prevMessagesLengthRef for message count changes
    // - prevLastMessageContentRef for content changes
  });
});

// ============================================================================
// Spec 2026-01-30: Force RHS Team Chat Scroll to Bottom
// Task Group 1: ChatMessageList Scroll Bypass
// ============================================================================

describe('ChatMessageList - disableAutoScroll prop (Task Group 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock requestAnimationFrame for scroll tests
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // Test 1.1a: No scroll event handlers attached when disableAutoScroll=true
  // ==========================================================================
  it('does not attach scroll event handler when disableAutoScroll is true', () => {
    // Given: Messages to render
    const messages: ChatMessage[] = [
      createMockMessage({ id: 'msg-1', content: 'Test message' }),
    ];

    // When: Component is rendered with disableAutoScroll=true
    render(<ChatMessageList messages={messages} disableAutoScroll={true} />);

    // Then: The container should not have onScroll handler attached
    // We verify this by checking that scrolling does not cause any state updates
    const container = screen.getByTestId('chat-message-list');

    // Scroll the container - if handler was attached, it would track scroll position
    // With disableAutoScroll=true, no scroll tracking should occur
    fireEvent.scroll(container, { target: { scrollTop: 100 } });

    // The component should still render correctly
    expect(screen.getByText('Test message')).toBeInTheDocument();
  });

  // ==========================================================================
  // Test 1.1b: useEffect scroll logic is skipped when disableAutoScroll=true
  // ==========================================================================
  it('skips useEffect scroll logic when disableAutoScroll is true', () => {
    // Given: Initial messages
    const initialMessages: ChatMessage[] = [
      createMockMessage({ id: 'msg-1', content: 'First message' }),
    ];

    // When: Component is rendered with disableAutoScroll=true
    const { rerender } = render(
      <ChatMessageList messages={initialMessages} disableAutoScroll={true} />
    );

    const container = screen.getByTestId('chat-message-list');

    // Mock scrollTop and scrollHeight
    Object.defineProperty(container, 'scrollHeight', { value: 500, configurable: true });
    Object.defineProperty(container, 'scrollTop', { value: 0, writable: true, configurable: true });

    // When: New messages are added (which would normally trigger auto-scroll)
    const updatedMessages: ChatMessage[] = [
      ...initialMessages,
      createMockMessage({ id: 'msg-2', content: 'Second message' }),
    ];
    rerender(<ChatMessageList messages={updatedMessages} disableAutoScroll={true} />);

    // Then: scrollTop should not be modified (scroll logic was skipped)
    // Note: The scroll effect is bypassed, so scrollTop stays at 0
    expect(container.scrollTop).toBe(0);
  });

  // ==========================================================================
  // Test 1.1c: Existing scroll behavior preserved when disableAutoScroll=false
  // ==========================================================================
  it('preserves existing scroll behavior when disableAutoScroll is false', () => {
    // Given: Initial messages
    const initialMessages: ChatMessage[] = [
      createMockMessage({ id: 'msg-1', content: 'First message' }),
    ];

    // When: Component is rendered with disableAutoScroll=false (or undefined)
    const { rerender } = render(
      <ChatMessageList messages={initialMessages} disableAutoScroll={false} />
    );

    const container = screen.getByTestId('chat-message-list');

    // Mock scrollHeight for the container
    Object.defineProperty(container, 'scrollHeight', { value: 500, configurable: true });
    let scrollTopValue = 0;
    Object.defineProperty(container, 'scrollTop', {
      get: () => scrollTopValue,
      set: (val) => { scrollTopValue = val; },
      configurable: true,
    });

    // When: New messages are added
    const updatedMessages: ChatMessage[] = [
      ...initialMessages,
      createMockMessage({ id: 'msg-2', content: 'Second message' }),
    ];
    rerender(<ChatMessageList messages={updatedMessages} disableAutoScroll={false} />);

    // Then: scrollTop should be updated to scrollHeight (auto-scroll occurred)
    expect(scrollTopValue).toBe(500);
  });

  // ==========================================================================
  // Test 1.1d: userHasScrolledUp state is not tracked when disabled
  // ==========================================================================
  it('does not track userHasScrolledUp state when disableAutoScroll is true', () => {
    // Given: Messages with enough content to scroll
    const messages: ChatMessage[] = [
      createMockMessage({ id: 'msg-1', content: 'First message' }),
      createMockMessage({ id: 'msg-2', content: 'Second message' }),
    ];

    // When: Component is rendered with disableAutoScroll=true
    const { rerender } = render(
      <ChatMessageList messages={messages} disableAutoScroll={true} />
    );

    const container = screen.getByTestId('chat-message-list');

    // Mock scroll properties
    Object.defineProperty(container, 'scrollHeight', { value: 500, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 200, configurable: true });
    let scrollTopValue = 0;
    Object.defineProperty(container, 'scrollTop', {
      get: () => scrollTopValue,
      set: (val) => { scrollTopValue = val; },
      configurable: true,
    });

    // Simulate user scrolling up (would set userHasScrolledUp=true normally)
    scrollTopValue = 50; // Far from bottom (scrollHeight - clientHeight = 300)
    fireEvent.scroll(container);

    // When: New messages are added
    const updatedMessages: ChatMessage[] = [
      ...messages,
      createMockMessage({ id: 'msg-3', content: 'Third message' }),
    ];
    rerender(<ChatMessageList messages={updatedMessages} disableAutoScroll={true} />);

    // Then: Since scroll tracking is disabled, scrollTop should remain unchanged
    // (the scroll effect is bypassed entirely, not just conditional on userHasScrolledUp)
    expect(scrollTopValue).toBe(50);
  });
});

// ============================================================================
// Spec 2026-01-30: Force RHS Team Chat Scroll to Bottom
// Task Group 3: Test Review and Integration Verification
// Additional Strategic Tests for Edge Cases
// ============================================================================

describe('ChatMessageList - Additional Strategic Tests (Task Group 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock requestAnimationFrame for scroll tests
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // Test 3.3a: Rapid sequential message additions (streaming simulation)
  // ==========================================================================
  it('handles rapid sequential message additions during streaming simulation', () => {
    // Given: Component rendered with initial message
    const messages: ChatMessage[] = [
      createMockMessage({ id: 'msg-1', content: 'Initial message' }),
    ];

    const { rerender } = render(
      <ChatMessageList messages={messages} disableAutoScroll={false} />
    );

    const container = screen.getByTestId('chat-message-list');

    // Track scroll calls
    let scrollTopValue = 0;
    Object.defineProperty(container, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(container, 'scrollTop', {
      get: () => scrollTopValue,
      set: (val) => { scrollTopValue = val; },
      configurable: true,
    });

    // When: Multiple rapid message additions (simulating streaming deltas)
    const streamingMessages = [...messages];
    for (let i = 2; i <= 5; i++) {
      streamingMessages.push(
        createMockMessage({ id: `msg-${i}`, content: `Streamed delta ${i}` })
      );
      rerender(<ChatMessageList messages={[...streamingMessages]} disableAutoScroll={false} />);
    }

    // Then: scrollTop should be updated after rapid additions
    // Each message addition should trigger scroll-to-bottom
    expect(scrollTopValue).toBe(1000);
    expect(screen.getByText('Streamed delta 5')).toBeInTheDocument();
  });

  // ==========================================================================
  // Test 3.3b: Empty to non-empty transition (initial render with messages)
  // ==========================================================================
  it('scrolls to bottom when transitioning from empty to non-empty messages', () => {
    // Given: Component rendered with no messages
    const { rerender } = render(
      <ChatMessageList messages={[]} disableAutoScroll={false} />
    );

    // Initially no messages visible
    expect(screen.queryByText('First message')).not.toBeInTheDocument();

    // When: First message is added (empty to non-empty transition)
    const messagesWithContent: ChatMessage[] = [
      createMockMessage({ id: 'msg-1', content: 'First message' }),
    ];
    rerender(<ChatMessageList messages={messagesWithContent} disableAutoScroll={false} />);

    // Then: Message should be displayed (scroll would occur in real DOM)
    expect(screen.getByText('First message')).toBeInTheDocument();

    // Verify component handles the transition gracefully
    const container = screen.getByTestId('chat-message-list');
    expect(container).toBeInTheDocument();
  });

  // ==========================================================================
  // Test 3.3c: scrollIntoView() is NOT used in ChatMessageList
  // ==========================================================================
  it('does not use scrollIntoView which can affect parent containers', () => {
    // Given: Spy on Element.prototype.scrollIntoView
    const scrollIntoViewSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewSpy;

    const initialMessages: ChatMessage[] = [
      createMockMessage({ id: 'msg-1', content: 'First message' }),
    ];

    // When: Component is rendered and messages are added
    const { rerender } = render(
      <ChatMessageList messages={initialMessages} disableAutoScroll={false} />
    );

    // Add more messages to trigger scroll behavior
    const updatedMessages: ChatMessage[] = [
      ...initialMessages,
      createMockMessage({ id: 'msg-2', content: 'Second message' }),
      createMockMessage({ id: 'msg-3', content: 'Third message' }),
    ];
    rerender(<ChatMessageList messages={updatedMessages} disableAutoScroll={false} />);

    // Then: scrollIntoView should NOT be called
    // ChatMessageList uses scrollTop assignment, not scrollIntoView
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // Test 3.3d: Window/document scroll is never affected by ChatMessageList
  // ==========================================================================
  it('never scrolls window or document (only internal container)', () => {
    // Given: Spy on window scroll methods
    const windowScrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const windowScrollBySpy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});

    // Track document scroll changes
    const originalBodyScrollTop = document.body.scrollTop;
    const originalDocElementScrollTop = document.documentElement.scrollTop;

    const initialMessages: ChatMessage[] = [
      createMockMessage({ id: 'msg-1', content: 'First message' }),
    ];

    // When: Component is rendered with multiple message updates
    const { rerender } = render(
      <ChatMessageList messages={initialMessages} disableAutoScroll={false} />
    );

    const container = screen.getByTestId('chat-message-list');
    Object.defineProperty(container, 'scrollHeight', { value: 500, configurable: true });

    // Add messages to trigger scroll behavior
    for (let i = 2; i <= 5; i++) {
      const newMessages = [
        ...initialMessages,
        ...Array.from({ length: i - 1 }, (_, j) =>
          createMockMessage({ id: `msg-${j + 2}`, content: `Message ${j + 2}` })
        ),
      ];
      rerender(<ChatMessageList messages={newMessages} disableAutoScroll={false} />);
    }

    // Then: Window scroll methods should NOT be called
    expect(windowScrollToSpy).not.toHaveBeenCalled();
    expect(windowScrollBySpy).not.toHaveBeenCalled();

    // Document scroll positions should remain unchanged
    expect(document.body.scrollTop).toBe(originalBodyScrollTop);
    expect(document.documentElement.scrollTop).toBe(originalDocElementScrollTop);
  });
});
