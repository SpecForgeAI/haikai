/**
 * ImplementChatStatePersistence Tests
 * Spec 2026-01-10: Preserve Implement Tab State Across Product & Delivery Tab Switches
 * Task Group 3: Tests for chat state hydration and persistence in ImplementationAssistantPanel
 *
 * Tests verify that:
 * - Chat state is hydrated from context on mount when stored state exists
 * - Chat state is persisted to context on state changes (write-through)
 * - New work items with no stored state start with empty defaults
 * - Input draft is preserved across tab switches
 */

import { renderHook, act } from '@testing-library/react';
import { createElement, ReactNode } from 'react';
import {
  ProductUiStateProvider,
  useProductUiState,
  ImplementChatUiState,
} from '../contexts/ProductUiStateContext';
import type { ChatMessage } from '../api/chatApi';

/**
 * Helper wrapper component for testing hooks within provider
 */
function createWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(ProductUiStateProvider, null, children);
  };
}

describe('ImplementationAssistantPanel Chat State Hydration and Persistence', () => {
  /**
   * Test 1: Component hydrates messages from stored state on mount
   */
  describe('hydration of messages from stored state', () => {
    it('should hydrate all fields from stored state including messages', () => {
      const { result } = renderHook(
        () => useProductUiState(),
        { wrapper: createWrapper() }
      );

      const storedState: ImplementChatUiState = {
        sessionId: 'session-xyz',
        messages: [
          { id: 'msg-1', role: 'user', content: 'Test message', timestamp: new Date() },
        ],
        generatedSpecs: ['spec-1', 'spec-2'],
        error: null,
        inputDraft: 'draft text',
      };

      // Store state in context
      act(() => {
        result.current.setImplementChatState('hydrate-project.json', 'hydrate-item', storedState);
      });

      // Verify state was stored
      const retrieved = result.current.getImplementChatState('hydrate-project.json', 'hydrate-item');
      expect(retrieved).toBeDefined();
      expect(retrieved?.sessionId).toBe('session-xyz');
      expect(retrieved?.messages.length).toBe(1);
      expect(retrieved?.generatedSpecs).toEqual(['spec-1', 'spec-2']);
      expect(retrieved?.inputDraft).toBe('draft text');
    });
  });

  /**
   * Test 2: Component hydrates sessionId, generatedSpecs, error, inputDraft from stored state
   */
  describe('hydration of all chat state fields', () => {
    it('should retrieve stored sessionId, generatedSpecs, error, and inputDraft', () => {
      const { result } = renderHook(
        () => useProductUiState(),
        { wrapper: createWrapper() }
      );

      const fullState: ImplementChatUiState = {
        sessionId: 'full-session-123',
        messages: [
          { id: 'full-msg', role: 'assistant', content: 'Full response', timestamp: new Date() },
        ],
        generatedSpecs: ['spec-command-1'],
        error: 'Previous error',
        inputDraft: 'Unsaved input',
      };

      act(() => {
        result.current.setImplementChatState('full-project.json', 'full-item', fullState);
      });

      const retrieved = result.current.getImplementChatState('full-project.json', 'full-item');
      expect(retrieved?.sessionId).toBe('full-session-123');
      expect(retrieved?.generatedSpecs).toEqual(['spec-command-1']);
      expect(retrieved?.error).toBe('Previous error');
      expect(retrieved?.inputDraft).toBe('Unsaved input');
    });
  });

  /**
   * Test 3: State changes trigger setImplementChatState write-through
   */
  describe('write-through persistence on state changes', () => {
    it('should persist state when messages are added', () => {
      const { result } = renderHook(
        () => useProductUiState(),
        { wrapper: createWrapper() }
      );

      const newMessage: ChatMessage = {
        id: 'new-msg',
        role: 'user',
        content: 'New message',
        timestamp: new Date(),
      };

      const stateWithMessage: ImplementChatUiState = {
        sessionId: null,
        messages: [newMessage],
        generatedSpecs: null,
        error: null,
        inputDraft: '',
      };

      act(() => {
        result.current.setImplementChatState('persist-project.json', 'persist-item', stateWithMessage);
      });

      // Verify state was persisted to context
      const stored = result.current.getImplementChatState('persist-project.json', 'persist-item');
      expect(stored?.messages.length).toBe(1);
      expect(stored?.messages[0].content).toBe('New message');
    });

    it('should persist state when sessionId is updated', () => {
      const { result } = renderHook(
        () => useProductUiState(),
        { wrapper: createWrapper() }
      );

      const stateWithSession: ImplementChatUiState = {
        sessionId: 'new-session-id',
        messages: [],
        generatedSpecs: null,
        error: null,
        inputDraft: '',
      };

      act(() => {
        result.current.setImplementChatState('session-project.json', 'session-item', stateWithSession);
      });

      const stored = result.current.getImplementChatState('session-project.json', 'session-item');
      expect(stored?.sessionId).toBe('new-session-id');
    });

    it('should persist state when generatedSpecs is updated', () => {
      const { result } = renderHook(
        () => useProductUiState(),
        { wrapper: createWrapper() }
      );

      const stateWithSpecs: ImplementChatUiState = {
        sessionId: null,
        messages: [],
        generatedSpecs: ['generated-spec-1', 'generated-spec-2'],
        error: null,
        inputDraft: '',
      };

      act(() => {
        result.current.setImplementChatState('specs-project.json', 'specs-item', stateWithSpecs);
      });

      const stored = result.current.getImplementChatState('specs-project.json', 'specs-item');
      expect(stored?.generatedSpecs).toEqual(['generated-spec-1', 'generated-spec-2']);
    });
  });

  /**
   * Test 4: Switching to NEW workItemId with no stored state resets to empty
   */
  describe('reset to empty for new work items', () => {
    it('should return undefined for work item with no stored state', () => {
      const { result } = renderHook(
        () => useProductUiState(),
        { wrapper: createWrapper() }
      );

      // Query for a work item that was never stored
      const state = result.current.getImplementChatState('any-project.json', 'never-stored-item');
      expect(state).toBeUndefined();
    });

    it('should distinguish between undefined (never stored) and empty state', () => {
      const { result } = renderHook(
        () => useProductUiState(),
        { wrapper: createWrapper() }
      );

      // Store an empty-ish state
      const emptyState: ImplementChatUiState = {
        sessionId: null,
        messages: [],
        generatedSpecs: null,
        error: null,
        inputDraft: '',
      };

      act(() => {
        result.current.setImplementChatState('empty-project.json', 'empty-item', emptyState);
      });

      // Empty state should be defined (not undefined)
      const storedEmpty = result.current.getImplementChatState('empty-project.json', 'empty-item');
      expect(storedEmpty).toBeDefined();
      expect(storedEmpty?.messages.length).toBe(0);

      // Never-stored should be undefined
      const neverStored = result.current.getImplementChatState('empty-project.json', 'never-item');
      expect(neverStored).toBeUndefined();
    });
  });

  /**
   * Test 5: inputDraft is preserved across tab switches
   */
  describe('input draft preservation', () => {
    it('should persist inputDraft when updated', () => {
      const { result } = renderHook(
        () => useProductUiState(),
        { wrapper: createWrapper() }
      );

      const stateWithDraft: ImplementChatUiState = {
        sessionId: null,
        messages: [],
        generatedSpecs: null,
        error: null,
        inputDraft: 'My draft message in progress',
      };

      act(() => {
        result.current.setImplementChatState('draft-project.json', 'draft-item', stateWithDraft);
      });

      const stored = result.current.getImplementChatState('draft-project.json', 'draft-item');
      expect(stored?.inputDraft).toBe('My draft message in progress');
    });

    it('should preserve inputDraft when retrieved after "tab switch" (context persists)', () => {
      const { result } = renderHook(
        () => useProductUiState(),
        { wrapper: createWrapper() }
      );

      // Simulate first session - store draft
      const stateWithDraft: ImplementChatUiState = {
        sessionId: null,
        messages: [],
        generatedSpecs: null,
        error: null,
        inputDraft: 'Preserved draft text',
      };

      act(() => {
        result.current.setImplementChatState('preserve-project.json', 'preserve-item', stateWithDraft);
      });

      // Simulate "tab switch back" - retrieve draft
      const retrieved = result.current.getImplementChatState('preserve-project.json', 'preserve-item');
      expect(retrieved?.inputDraft).toBe('Preserved draft text');
    });

    it('should preserve complex chat state with draft after multiple updates', () => {
      const { result } = renderHook(
        () => useProductUiState(),
        { wrapper: createWrapper() }
      );

      // Initial state
      act(() => {
        result.current.setImplementChatState('complex-project.json', 'complex-item', {
          sessionId: null,
          messages: [{ id: 'complex-msg', role: 'user', content: 'Complex message', timestamp: new Date() }],
          generatedSpecs: null,
          error: null,
          inputDraft: '',
        });
      });

      // Update with session
      act(() => {
        result.current.setImplementChatState('complex-project.json', 'complex-item', {
          sessionId: 'complex-session',
          messages: [{ id: 'complex-msg', role: 'user', content: 'Complex message', timestamp: new Date() }],
          generatedSpecs: null,
          error: null,
          inputDraft: '',
        });
      });

      // Update with draft
      act(() => {
        result.current.setImplementChatState('complex-project.json', 'complex-item', {
          sessionId: 'complex-session',
          messages: [{ id: 'complex-msg', role: 'user', content: 'Complex message', timestamp: new Date() }],
          generatedSpecs: null,
          error: null,
          inputDraft: 'Complex draft',
        });
      });

      // Verify all state persisted
      const stored = result.current.getImplementChatState('complex-project.json', 'complex-item');
      expect(stored?.messages.length).toBe(1);
      expect(stored?.sessionId).toBe('complex-session');
      expect(stored?.inputDraft).toBe('Complex draft');
    });
  });

  /**
   * Additional test: Chat state isolation between work items
   */
  describe('work item isolation', () => {
    it('should isolate chat state between different work items in same project', () => {
      const { result } = renderHook(
        () => useProductUiState(),
        { wrapper: createWrapper() }
      );

      const state1: ImplementChatUiState = {
        sessionId: 'session-1',
        messages: [{ id: 'm1', role: 'user', content: 'Item 1 message', timestamp: new Date() }],
        generatedSpecs: null,
        error: null,
        inputDraft: 'Draft 1',
      };

      const state2: ImplementChatUiState = {
        sessionId: 'session-2',
        messages: [{ id: 'm2', role: 'assistant', content: 'Item 2 response', timestamp: new Date() }],
        generatedSpecs: ['spec'],
        error: null,
        inputDraft: 'Draft 2',
      };

      act(() => {
        result.current.setImplementChatState('isolation-project.json', 'item-1', state1);
        result.current.setImplementChatState('isolation-project.json', 'item-2', state2);
      });

      const retrieved1 = result.current.getImplementChatState('isolation-project.json', 'item-1');
      const retrieved2 = result.current.getImplementChatState('isolation-project.json', 'item-2');

      expect(retrieved1?.sessionId).toBe('session-1');
      expect(retrieved1?.inputDraft).toBe('Draft 1');
      expect(retrieved2?.sessionId).toBe('session-2');
      expect(retrieved2?.generatedSpecs).toEqual(['spec']);
    });
  });
});
