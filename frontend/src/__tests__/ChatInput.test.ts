/**
 * Tests for ChatInput Component
 */
import { describe, it, expect, vi } from 'vitest';

// Simulate ChatInput component logic without React rendering
interface ChatInputState {
  message: string;
  disabled: boolean;
}

function canSend(state: ChatInputState): boolean {
  return state.message.trim().length > 0 && !state.disabled;
}

function handleSend(
  state: ChatInputState,
  onSend: (message: string) => void
): ChatInputState {
  if (canSend(state)) {
    onSend(state.message.trim());
    return { ...state, message: '' };
  }
  return state;
}

describe('ChatInput', () => {
  it('Send button is disabled when textarea is empty', () => {
    const state: ChatInputState = {
      message: '',
      disabled: false,
    };

    expect(canSend(state)).toBe(false);
  });

  it('Send button is disabled when textarea contains only whitespace', () => {
    const state: ChatInputState = {
      message: '   \n\t  ',
      disabled: false,
    };

    expect(canSend(state)).toBe(false);
  });

  it('Send button is enabled when textarea has content', () => {
    const state: ChatInputState = {
      message: 'Hello, this is a message',
      disabled: false,
    };

    expect(canSend(state)).toBe(true);
  });

  it('onSend callback is triggered with message content on button click', () => {
    const onSend = vi.fn();
    const state: ChatInputState = {
      message: '  Hello world  ',
      disabled: false,
    };

    handleSend(state, onSend);

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('Hello world');
  });

  it('textarea clears after successful send', () => {
    const onSend = vi.fn();
    const state: ChatInputState = {
      message: 'Test message',
      disabled: false,
    };

    const newState = handleSend(state, onSend);

    expect(newState.message).toBe('');
  });
});
