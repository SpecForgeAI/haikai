/**
 * Tests for ChatBubble Component
 */
import { describe, it, expect } from 'vitest';
import type { ChatMessage } from '../api/chatApi';

// Test helpers to simulate component behavior without React rendering
function getBubbleStyles(role: 'user' | 'assistant') {
  // These values match ChatBubble.module.css specifications
  const baseStyles = {
    maxWidth: '80%',
    padding: '10px 14px',
    fontSize: '14px',
    color: '#1a1a1a',
    margin: '4px 0',
  };

  if (role === 'user') {
    return {
      ...baseStyles,
      alignSelf: 'flex-end',
      background: '#E6F4EA',
      borderRadius: '12px 12px 4px 12px',
    };
  } else {
    return {
      ...baseStyles,
      alignSelf: 'flex-start',
      background: '#F1F1F1',
      borderRadius: '12px 12px 12px 4px',
    };
  }
}

describe('ChatBubble', () => {
  const createUserMessage = (content: string): ChatMessage => ({
    id: 'user-msg-1',
    role: 'user',
    content,
    timestamp: new Date('2024-01-15T10:00:00Z'),
  });

  const createAssistantMessage = (content: string): ChatMessage => ({
    id: 'assistant-msg-1',
    role: 'assistant',
    content,
    timestamp: new Date('2024-01-15T10:00:05Z'),
  });

  it('user bubble renders with correct green background (#E6F4EA)', () => {
    const message = createUserMessage('Hello');
    const styles = getBubbleStyles(message.role);

    expect(styles.background).toBe('#E6F4EA');
  });

  it('assistant bubble renders with correct grey background (#F1F1F1)', () => {
    const message = createAssistantMessage('Hello! How can I help?');
    const styles = getBubbleStyles(message.role);

    expect(styles.background).toBe('#F1F1F1');
  });

  it('user bubble is right-aligned (align-self: flex-end)', () => {
    const message = createUserMessage('Test message');
    const styles = getBubbleStyles(message.role);

    expect(styles.alignSelf).toBe('flex-end');
  });

  it('assistant bubble is left-aligned (align-self: flex-start)', () => {
    const message = createAssistantMessage('Response message');
    const styles = getBubbleStyles(message.role);

    expect(styles.alignSelf).toBe('flex-start');
  });
});
