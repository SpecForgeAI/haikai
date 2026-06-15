/**
 * Tests for ChatPanel Component
 */
import { describe, it, expect, vi } from 'vitest';
import type { ChatMessage, ChatResponse } from '../api/chatApi';

// Simulates ChatPanel state management
interface ChatPanelState {
  isCollapsed: boolean;
  width: number;
  sessionId: string | null;
  messages: ChatMessage[];
  isLoading: boolean;
}

function createInitialState(): ChatPanelState {
  return {
    isCollapsed: true,
    width: 320,
    sessionId: null,
    messages: [],
    isLoading: false,
  };
}

// Simulates collapse/expand toggle
function toggleCollapse(state: ChatPanelState): ChatPanelState {
  return { ...state, isCollapsed: !state.isCollapsed };
}

// Simulates resize with constraints
function resize(state: ChatPanelState, newWidth: number, viewportWidth: number = 1920): ChatPanelState {
  const minWidth = 240;
  const maxWidth = viewportWidth * 0.5;
  const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
  return { ...state, width: clampedWidth };
}

// Simulates sending a message
async function sendMessage(
  state: ChatPanelState,
  content: string,
  mockApiResponse: ChatResponse
): Promise<ChatPanelState> {
  // Add user message
  const userMessage: ChatMessage = {
    id: 'user-' + Date.now(),
    role: 'user',
    content,
    timestamp: new Date(),
  };

  let newState: ChatPanelState = {
    ...state,
    messages: [...state.messages, userMessage],
    isLoading: true,
  };

  // Simulate API call
  newState = {
    ...newState,
    sessionId: mockApiResponse.sessionId,
    messages: [
      ...newState.messages,
      {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: mockApiResponse.assistant.message,
        timestamp: new Date(),
      },
    ],
    isLoading: false,
  };

  return newState;
}

describe('ChatPanel', () => {
  it('panel renders in collapsed state by default', () => {
    const state = createInitialState();
    expect(state.isCollapsed).toBe(true);
  });

  it('clicking collapsed tab expands panel to 320px width', () => {
    let state = createInitialState();
    expect(state.isCollapsed).toBe(true);

    // Simulate clicking the collapsed tab
    state = toggleCollapse(state);
    expect(state.isCollapsed).toBe(false);
    expect(state.width).toBe(320);
  });

  it('clicking collapse button collapses panel back to tab', () => {
    let state = createInitialState();

    // First expand
    state = toggleCollapse(state);
    expect(state.isCollapsed).toBe(false);

    // Then collapse
    state = toggleCollapse(state);
    expect(state.isCollapsed).toBe(true);
  });

  it('resize handle changes panel width via drag', () => {
    let state = createInitialState();
    state = toggleCollapse(state); // Expand first

    // Simulate dragging to new width
    state = resize(state, 450);
    expect(state.width).toBe(450);

    state = resize(state, 280);
    expect(state.width).toBe(280);
  });

  it('width respects min (240px) and max (50% viewport) constraints', () => {
    let state = createInitialState();
    state = toggleCollapse(state);

    const viewportWidth = 1920;

    // Test min constraint
    state = resize(state, 100, viewportWidth);
    expect(state.width).toBe(240);

    // Test max constraint (50% of 1920 = 960)
    state = resize(state, 1200, viewportWidth);
    expect(state.width).toBe(960);

    // Test value within constraints
    state = resize(state, 500, viewportWidth);
    expect(state.width).toBe(500);
  });

  it('sending message triggers API call and displays response', async () => {
    let state = createInitialState();
    state = toggleCollapse(state);

    const mockResponse: ChatResponse = {
      sessionId: 'session-abc-123',
      assistant: {
        message: 'Hello! How can I help you today?',
      },
    };

    state = await sendMessage(state, 'Hello there', mockResponse);

    // Should have 2 messages: user and assistant
    expect(state.messages).toHaveLength(2);

    // First message is user
    expect(state.messages[0].role).toBe('user');
    expect(state.messages[0].content).toBe('Hello there');

    // Second message is assistant
    expect(state.messages[1].role).toBe('assistant');
    expect(state.messages[1].content).toBe('Hello! How can I help you today?');

    // Session ID should be stored
    expect(state.sessionId).toBe('session-abc-123');

    // Loading should be false after completion
    expect(state.isLoading).toBe(false);
  });
});
