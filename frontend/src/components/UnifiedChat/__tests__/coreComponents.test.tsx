/**
 * Core Components Tests
 *
 * Spec 2026-02-28: Unified Chat Panel v1 (Frontend)
 * Task Group 5, Task 5.1: Write 6 focused tests for core components
 *
 * Spec 2026-03-03: UnifiedChatPanel UX Polish
 * Task Group 2: Updated product-manager color assertion to match updated PERSONA_CONFIGS
 * (changed from #00897B to #C62828).
 *
 * Tests verify:
 * - MessageBubble renders user message right-aligned with "You" label
 * - MessageBubble renders assistant message left-aligned with persona avatar (colored circle with initials) and displayName
 * - MessageBubble renders system message centered with muted styling
 * - ChatThread renders a list of messages and shows typing indicator when isLoading is true
 * - ChatInputBar calls onSend with text on Enter key press (without Shift)
 * - ChatInputBar disables send button when textarea is empty and no files attached
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MessageBubble } from '../MessageBubble';
import { ChatThread } from '../ChatThread';
import { ChatInputBar } from '../ChatInputBar';
import type { ThreadMessage } from '../../../api/chatV2Api';

// ============================================================================
// MessageBubble Tests
// ============================================================================

describe('MessageBubble', () => {
  it('renders user message right-aligned with "You" label', () => {
    const userMessage: ThreadMessage = {
      id: 'msg-1',
      role: 'user',
      personaId: null,
      taskId: null,
      content: 'Hello, how can I start?',
      structuredResponse: null,
      timestamp: '2026-02-28T10:00:00.000Z',
    };

    render(<MessageBubble message={userMessage} />);

    // Should display "You" label
    expect(screen.getByText('You')).toBeInTheDocument();

    // Should display the message content
    expect(screen.getByText('Hello, how can I start?')).toBeInTheDocument();

    // The wrapper should have the user role data attribute for right-alignment
    const wrapper = screen.getByTestId('message-bubble');
    expect(wrapper).toHaveAttribute('data-role', 'user');
  });

  it('renders assistant message left-aligned with persona avatar (colored circle with initials) and displayName', () => {
    const assistantMessage: ThreadMessage = {
      id: 'msg-2',
      role: 'assistant',
      personaId: 'product-manager',
      taskId: 'define-product',
      content: 'Let us define your product vision.',
      structuredResponse: null,
      timestamp: '2026-02-28T10:01:00.000Z',
    };

    render(<MessageBubble message={assistantMessage} />);

    // Should display persona displayName
    expect(screen.getByText('Product Manager')).toBeInTheDocument();

    // Should display the persona avatar with initials
    const avatar = screen.getByTestId('persona-avatar');
    expect(avatar).toBeInTheDocument();
    expect(avatar).toHaveTextContent('PM');
    // Avatar should have the persona color as background
    expect(avatar).toHaveStyle({ backgroundColor: '#C62828' });

    // Should display message content
    expect(screen.getByText('Let us define your product vision.')).toBeInTheDocument();

    // Wrapper should have assistant role
    const wrapper = screen.getByTestId('message-bubble');
    expect(wrapper).toHaveAttribute('data-role', 'assistant');
  });

  it('renders system message centered with muted styling', () => {
    const systemMessage: ThreadMessage = {
      id: 'msg-3',
      role: 'system',
      personaId: null,
      taskId: null,
      content: 'Selected task: Define Product',
      structuredResponse: null,
      timestamp: '2026-02-28T10:02:00.000Z',
    };

    render(<MessageBubble message={systemMessage} />);

    // Should display the system message content
    expect(screen.getByText('Selected task: Define Product')).toBeInTheDocument();

    // Wrapper should have system role
    const wrapper = screen.getByTestId('message-bubble');
    expect(wrapper).toHaveAttribute('data-role', 'system');

    // Should NOT display "You" label or persona avatar
    expect(screen.queryByText('You')).not.toBeInTheDocument();
    expect(screen.queryByTestId('persona-avatar')).not.toBeInTheDocument();
  });
});

// ============================================================================
// ChatThread Tests
// ============================================================================

describe('ChatThread', () => {
  it('renders a list of messages and shows typing indicator when isLoading is true', () => {
    const messages: ThreadMessage[] = [
      {
        id: 'msg-1',
        role: 'user',
        personaId: null,
        taskId: null,
        content: 'Hello',
        structuredResponse: null,
        timestamp: '2026-02-28T10:00:00.000Z',
      },
      {
        id: 'msg-2',
        role: 'assistant',
        personaId: 'assistant',
        taskId: 'unknown',
        content: 'Hi there!',
        structuredResponse: null,
        timestamp: '2026-02-28T10:01:00.000Z',
      },
    ];

    render(<ChatThread messages={messages} isLoading={true} />);

    // Both messages should be rendered
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hi there!')).toBeInTheDocument();

    // Typing indicator should be visible when isLoading is true
    expect(screen.getByTestId('typing-indicator')).toBeInTheDocument();
  });
});

// ============================================================================
// ChatInputBar Tests
// ============================================================================

describe('ChatInputBar', () => {
  it('calls onSend with text on Enter key press (without Shift)', async () => {
    const onSend = vi.fn();
    const onPersonaSelected = vi.fn();

    render(
      <ChatInputBar
        onSend={onSend}
        onPersonaSelected={onPersonaSelected}
      />
    );

    const textarea = screen.getByTestId('mention-input-textarea') as HTMLTextAreaElement;

    // Type a message
    fireEvent.change(textarea, { target: { value: 'Hello world' } });

    // Press Enter (without Shift) to send
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    // onSend should be called with the text
    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });
    expect(onSend).toHaveBeenCalledWith('Hello world', []);
  });

  it('disables send button when textarea is empty and no files attached', () => {
    const onSend = vi.fn();
    const onPersonaSelected = vi.fn();

    render(
      <ChatInputBar
        onSend={onSend}
        onPersonaSelected={onPersonaSelected}
      />
    );

    // Send button should be disabled when textarea is empty
    const sendButton = screen.getByTestId('chat-send-button');
    expect(sendButton).toBeDisabled();

    // Type something
    const textarea = screen.getByTestId('mention-input-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Some text' } });

    // Send button should now be enabled
    expect(sendButton).not.toBeDisabled();

    // Clear the text
    fireEvent.change(textarea, { target: { value: '' } });

    // Send button should be disabled again
    expect(sendButton).toBeDisabled();

    // Whitespace only should also keep it disabled
    fireEvent.change(textarea, { target: { value: '   ' } });
    expect(sendButton).toBeDisabled();
  });
});
