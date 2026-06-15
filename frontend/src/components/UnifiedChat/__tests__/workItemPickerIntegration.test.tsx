/**
 * Work Item Picker Integration Tests
 *
 * Spec 2026-03-04: What's Next v1-C -- Work Item Picker
 * Task Group 11: Integration tests for picker flow in MessageBubble and ChatThread
 *
 * Tests verify:
 * 1. MessageBubble renders WorkItemSearchResults for work-item-search-results type
 * 2. MessageBubble fires onWorkItemSelect when a result card is clicked
 * 3. MessageBubble fires onPickerCancel when Cancel is clicked
 * 4. ChatThread passes onWorkItemSelect and onPickerCancel through to MessageBubble
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MessageBubble } from '../MessageBubble';
import { ChatThread } from '../ChatThread';
import type { ThreadMessage } from '../../../api/chatV2Api';

// ============================================================================
// Test Data
// ============================================================================

const searchResultsMessage: ThreadMessage = {
  id: 'msg-search-1',
  role: 'assistant',
  personaId: 'assistant',
  taskId: 'assistant--whats-next',
  content: 'Here are the matching work items:',
  structuredResponse: {
    type: 'work-item-search-results',
    query: 'login',
    results: [
      { id: 'feat-1', title: 'Login Page', type: 'FEATURE', status: 'IN_PROGRESS', parentTitle: 'Auth Epic', inScope: true },
      { id: 'story-1', title: 'Login Form Validation', type: 'STORY', status: 'PLANNED', parentTitle: 'Login Page', inScope: false },
    ],
  },
  timestamp: '2026-03-04T10:00:00.000Z',
};

// ============================================================================
// Tests
// ============================================================================

describe('Work Item Picker Integration (Spec 2026-03-04, Task Group 11)', () => {
  // --------------------------------------------------------------------------
  // Test 1: MessageBubble renders WorkItemSearchResults for work-item-search-results type
  // --------------------------------------------------------------------------
  it('MessageBubble renders WorkItemSearchResults when structuredResponse.type is work-item-search-results', () => {
    const onWorkItemSelect = vi.fn();
    const onPickerCancel = vi.fn();

    render(
      <MessageBubble
        message={searchResultsMessage}
        onWorkItemSelect={onWorkItemSelect}
        onPickerCancel={onPickerCancel}
      />
    );

    // The WorkItemSearchResults container should be present
    expect(screen.getByTestId('work-item-search-results')).toBeInTheDocument();

    // Both result cards should be rendered
    expect(screen.getByTestId('work-item-result-feat-1')).toBeInTheDocument();
    expect(screen.getByTestId('work-item-result-story-1')).toBeInTheDocument();

    // The query header should be shown
    expect(screen.getByText("Results for 'login':")).toBeInTheDocument();

    // The message content should also render
    expect(screen.getByText('Here are the matching work items:')).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Test 2: MessageBubble fires onWorkItemSelect when result clicked
  // --------------------------------------------------------------------------
  it('MessageBubble fires onWorkItemSelect with correct id and title when a result card is clicked', () => {
    const onWorkItemSelect = vi.fn();
    const onPickerCancel = vi.fn();

    render(
      <MessageBubble
        message={searchResultsMessage}
        onWorkItemSelect={onWorkItemSelect}
        onPickerCancel={onPickerCancel}
      />
    );

    // Click the first result card
    fireEvent.click(screen.getByTestId('work-item-result-feat-1'));

    expect(onWorkItemSelect).toHaveBeenCalledTimes(1);
    expect(onWorkItemSelect).toHaveBeenCalledWith('feat-1', 'Login Page');
  });

  // --------------------------------------------------------------------------
  // Test 3: MessageBubble fires onPickerCancel when Cancel clicked
  // --------------------------------------------------------------------------
  it('MessageBubble fires onPickerCancel when Cancel button is clicked', () => {
    const onWorkItemSelect = vi.fn();
    const onPickerCancel = vi.fn();

    render(
      <MessageBubble
        message={searchResultsMessage}
        onWorkItemSelect={onWorkItemSelect}
        onPickerCancel={onPickerCancel}
      />
    );

    // Click the cancel button
    fireEvent.click(screen.getByTestId('work-item-cancel'));

    expect(onPickerCancel).toHaveBeenCalledTimes(1);
  });

  // --------------------------------------------------------------------------
  // Test 4: ChatThread passes onWorkItemSelect and onPickerCancel to MessageBubble
  // --------------------------------------------------------------------------
  it('ChatThread passes onWorkItemSelect and onPickerCancel through to MessageBubble', () => {
    const onWorkItemSelect = vi.fn();
    const onPickerCancel = vi.fn();
    const messages: ThreadMessage[] = [searchResultsMessage];

    render(
      <ChatThread
        messages={messages}
        isLoading={false}
        onWorkItemSelect={onWorkItemSelect}
        onPickerCancel={onPickerCancel}
      />
    );

    // The WorkItemSearchResults container should render through ChatThread -> MessageBubble chain
    expect(screen.getByTestId('work-item-search-results')).toBeInTheDocument();

    // Both result cards should be present
    expect(screen.getByTestId('work-item-result-feat-1')).toBeInTheDocument();
    expect(screen.getByTestId('work-item-result-story-1')).toBeInTheDocument();

    // Click a result card -- onWorkItemSelect should fire
    fireEvent.click(screen.getByTestId('work-item-result-feat-1'));
    expect(onWorkItemSelect).toHaveBeenCalledTimes(1);
    expect(onWorkItemSelect).toHaveBeenCalledWith('feat-1', 'Login Page');

    // Click cancel -- onPickerCancel should fire
    fireEvent.click(screen.getByTestId('work-item-cancel'));
    expect(onPickerCancel).toHaveBeenCalledTimes(1);
  });
});
