/**
 * ImplementTabStateEdgeCases Tests
 * Spec 2026-01-10: Preserve Implement Tab State Across Product & Delivery Tab Switches
 * Task Group 4: Edge case tests for state preservation feature
 *
 * Tests for edge cases and boundary conditions:
 * - Deleted work item fallback to empty state
 * - Project switch isolation
 * - Rapid tab switches
 * - Empty projectKey handling
 * - Date object preservation in messages
 */

import { renderHook, act } from '@testing-library/react';
import { createElement, ReactNode, useState, useCallback, useMemo } from 'react';
import {
  ProductUiStateProvider,
  useProductUiState,
  deriveProjectKey,
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

/**
 * Simulate ProductView's tab handling logic for edge case testing
 */
function useProductViewTabLogicForEdgeCases(loadedFileName: string | null) {
  const projectKey = deriveProjectKey(loadedFileName);
  const context = useProductUiState();

  // Local state similar to ProductView
  const [activeTab, setActiveTab] = useState<'backlog' | 'implement' | 'roadmap'>('backlog');
  const [urlWorkItemId, setUrlWorkItemId] = useState<string | null>(null);

  // Simulate handleWorkOnThis - navigates to implement with a work item
  const handleWorkOnThis = useCallback((itemId: string) => {
    setUrlWorkItemId(itemId);
    setActiveTab('implement');
    // Store the work item ID in context
    if (projectKey) {
      context.setLastImplementWorkItemId(projectKey, itemId);
    }
  }, [context, projectKey]);

  // Simulate handleTabChange - switches tab without URL work item
  const handleTabChange = useCallback((tab: 'backlog' | 'implement' | 'roadmap') => {
    setActiveTab(tab);
    if (tab !== 'implement') {
      // Clear URL work item when leaving implement, but DON'T clear context
      setUrlWorkItemId(null);
    }
  }, []);

  // Compute effective work item ID when on implement tab
  const effectiveWorkItemId = useMemo(() => {
    if (activeTab !== 'implement') {
      return null;
    }
    // URL takes precedence, then fall back to context
    if (urlWorkItemId) {
      return urlWorkItemId;
    }
    if (projectKey) {
      return context.getLastImplementWorkItemId(projectKey);
    }
    return null;
  }, [activeTab, urlWorkItemId, context, projectKey]);

  return {
    activeTab,
    urlWorkItemId,
    effectiveWorkItemId,
    handleWorkOnThis,
    handleTabChange,
    projectKey,
    context,
  };
}

describe('Implement Tab State Edge Cases', () => {
  /**
   * Test 1: Stored lastImplementWorkItemId references deleted work item
   * Behavior: The context retains the ID, but the component consuming it
   * should handle the case where the work item no longer exists gracefully
   */
  describe('deleted work item handling', () => {
    it('should return stored work item ID even if work item was deleted (consumer handles gracefully)', () => {
      const { result } = renderHook(
        () => useProductViewTabLogicForEdgeCases('deleted-item-project.json'),
        { wrapper: createWrapper() }
      );

      // Store a work item ID
      act(() => {
        result.current.handleWorkOnThis('work-item-that-will-be-deleted');
      });

      // Switch away
      act(() => {
        result.current.handleTabChange('backlog');
      });

      // Switch back - the context still has the ID (it doesn't know about deletion)
      act(() => {
        result.current.handleTabChange('implement');
      });

      // effectiveWorkItemId should still return the stored ID
      // The consuming component (ProductImplementPage) is responsible for
      // handling the case where this ID no longer maps to a valid work item
      expect(result.current.effectiveWorkItemId).toBe('work-item-that-will-be-deleted');
    });

    it('should allow chat state retrieval for deleted work item ID (empty state returned if never stored)', () => {
      const { result } = renderHook(
        () => useProductUiState(),
        { wrapper: createWrapper() }
      );

      // Try to get chat state for a work item that was never stored
      const chatState = result.current.getImplementChatState('some-project.json', 'deleted-work-item-id');

      // Should return undefined, not throw an error
      expect(chatState).toBeUndefined();
    });
  });

  /**
   * Test 2: Project switch isolates Implement state completely
   */
  describe('project switch isolation', () => {
    it('should isolate lastImplementWorkItemId between different projects', () => {
      const { result } = renderHook(
        () => useProductUiState(),
        { wrapper: createWrapper() }
      );

      // Set work item for project A
      act(() => {
        result.current.setLastImplementWorkItemId('project-a.json', 'work-item-a');
      });

      // Set different work item for project B
      act(() => {
        result.current.setLastImplementWorkItemId('project-b.json', 'work-item-b');
      });

      // Verify complete isolation
      expect(result.current.getLastImplementWorkItemId('project-a.json')).toBe('work-item-a');
      expect(result.current.getLastImplementWorkItemId('project-b.json')).toBe('work-item-b');
      expect(result.current.getLastImplementWorkItemId('project-c.json')).toBeNull();
    });

    it('should isolate chat state between different projects', () => {
      const { result } = renderHook(
        () => useProductUiState(),
        { wrapper: createWrapper() }
      );

      const stateA: ImplementChatUiState = {
        sessionId: 'session-a',
        messages: [{ id: 'msg-a', role: 'user', content: 'Project A message', timestamp: new Date() }],
        generatedSpecs: ['spec-a'],
        error: null,
        inputDraft: 'Draft A',
      };

      const stateB: ImplementChatUiState = {
        sessionId: 'session-b',
        messages: [{ id: 'msg-b', role: 'assistant', content: 'Project B response', timestamp: new Date() }],
        generatedSpecs: null,
        error: null,
        inputDraft: 'Draft B',
      };

      // Store chat state for same workItemId but different projects
      act(() => {
        result.current.setImplementChatState('project-a.json', 'same-work-item', stateA);
        result.current.setImplementChatState('project-b.json', 'same-work-item', stateB);
      });

      // Verify complete isolation
      const retrievedA = result.current.getImplementChatState('project-a.json', 'same-work-item');
      const retrievedB = result.current.getImplementChatState('project-b.json', 'same-work-item');

      expect(retrievedA?.sessionId).toBe('session-a');
      expect(retrievedA?.inputDraft).toBe('Draft A');
      expect(retrievedB?.sessionId).toBe('session-b');
      expect(retrievedB?.inputDraft).toBe('Draft B');
    });
  });

  /**
   * Test 3: Multiple rapid tab switches do not corrupt state
   */
  describe('rapid tab switch stability', () => {
    it('should preserve state correctly through rapid tab switches', () => {
      const { result } = renderHook(
        () => ({
          context: useProductUiState(),
          tabLogic: useProductViewTabLogicForEdgeCases('rapid-switch-project.json'),
        }),
        { wrapper: createWrapper() }
      );

      // Store initial state
      act(() => {
        result.current.tabLogic.handleWorkOnThis('stable-item');
      });

      // Store some chat state
      act(() => {
        result.current.context.setImplementChatState('rapid-switch-project.json', 'stable-item', {
          sessionId: 'stable-session',
          messages: [{ id: 'msg-1', role: 'user', content: 'Stable message', timestamp: new Date() }],
          generatedSpecs: null,
          error: null,
          inputDraft: 'Stable draft',
        });
      });

      // Rapid tab switches
      act(() => {
        result.current.tabLogic.handleTabChange('backlog');
      });
      act(() => {
        result.current.tabLogic.handleTabChange('roadmap');
      });
      act(() => {
        result.current.tabLogic.handleTabChange('backlog');
      });
      act(() => {
        result.current.tabLogic.handleTabChange('roadmap');
      });
      act(() => {
        result.current.tabLogic.handleTabChange('implement');
      });

      // Verify state is preserved
      expect(result.current.tabLogic.effectiveWorkItemId).toBe('stable-item');
      const chatState = result.current.context.getImplementChatState('rapid-switch-project.json', 'stable-item');
      expect(chatState?.sessionId).toBe('stable-session');
      expect(chatState?.inputDraft).toBe('Stable draft');
    });

    it('should handle rapid work item switches within implement tab', () => {
      const { result } = renderHook(
        () => ({
          context: useProductUiState(),
          tabLogic: useProductViewTabLogicForEdgeCases('work-item-switch-project.json'),
        }),
        { wrapper: createWrapper() }
      );

      // Store chat state for item 1
      act(() => {
        result.current.context.setImplementChatState('work-item-switch-project.json', 'item-1', {
          sessionId: 'session-1',
          messages: [],
          generatedSpecs: null,
          error: null,
          inputDraft: 'Draft 1',
        });
      });

      // Store chat state for item 2
      act(() => {
        result.current.context.setImplementChatState('work-item-switch-project.json', 'item-2', {
          sessionId: 'session-2',
          messages: [],
          generatedSpecs: null,
          error: null,
          inputDraft: 'Draft 2',
        });
      });

      // Rapidly switch between work items
      act(() => {
        result.current.tabLogic.handleWorkOnThis('item-1');
      });
      act(() => {
        result.current.tabLogic.handleWorkOnThis('item-2');
      });
      act(() => {
        result.current.tabLogic.handleWorkOnThis('item-1');
      });
      act(() => {
        result.current.tabLogic.handleWorkOnThis('item-2');
      });

      // Verify final state is correct for item-2
      expect(result.current.tabLogic.effectiveWorkItemId).toBe('item-2');
      expect(result.current.context.getLastImplementWorkItemId('work-item-switch-project.json')).toBe('item-2');

      // Verify both states are still preserved
      const state1 = result.current.context.getImplementChatState('work-item-switch-project.json', 'item-1');
      const state2 = result.current.context.getImplementChatState('work-item-switch-project.json', 'item-2');
      expect(state1?.inputDraft).toBe('Draft 1');
      expect(state2?.inputDraft).toBe('Draft 2');
    });
  });

  /**
   * Test 4: Context handles empty projectKey (no project loaded) gracefully
   */
  describe('empty projectKey handling', () => {
    it('should return empty string for null loadedFileName', () => {
      const projectKey = deriveProjectKey(null);
      expect(projectKey).toBe('');
    });

    it('should handle operations with empty projectKey gracefully', () => {
      const { result } = renderHook(
        () => useProductUiState(),
        { wrapper: createWrapper() }
      );

      // These operations should not throw, even with empty projectKey
      expect(() => {
        result.current.getLastImplementWorkItemId('');
      }).not.toThrow();

      expect(() => {
        result.current.getImplementChatState('', 'any-item');
      }).not.toThrow();

      // Returns should be graceful defaults
      expect(result.current.getLastImplementWorkItemId('')).toBeNull();
      expect(result.current.getImplementChatState('', 'any-item')).toBeUndefined();
    });

    it('should handle effectiveWorkItemId resolution with no project loaded', () => {
      const { result } = renderHook(
        () => useProductViewTabLogicForEdgeCases(null),
        { wrapper: createWrapper() }
      );

      // Switch to implement with no project
      act(() => {
        result.current.handleTabChange('implement');
      });

      // Should return null gracefully
      expect(result.current.effectiveWorkItemId).toBeNull();
      expect(result.current.projectKey).toBe('');
    });
  });

  /**
   * Test 5: Chat state with Date objects in messages preserves correctly
   */
  describe('Date object preservation in messages', () => {
    it('should preserve Date objects in messages through store/retrieve cycle', () => {
      const { result } = renderHook(
        () => useProductUiState(),
        { wrapper: createWrapper() }
      );

      const testDate = new Date('2026-01-10T15:30:00.000Z');
      const testMessages: ChatMessage[] = [
        { id: 'msg-1', role: 'user', content: 'Test', timestamp: testDate },
        { id: 'msg-2', role: 'assistant', content: 'Response', timestamp: new Date('2026-01-10T15:30:05.000Z') },
      ];

      const stateWithDates: ImplementChatUiState = {
        sessionId: 'date-session',
        messages: testMessages,
        generatedSpecs: null,
        error: null,
        inputDraft: '',
      };

      act(() => {
        result.current.setImplementChatState('date-project.json', 'date-item', stateWithDates);
      });

      const retrieved = result.current.getImplementChatState('date-project.json', 'date-item');

      // Verify messages are preserved
      expect(retrieved?.messages.length).toBe(2);
      expect(retrieved?.messages[0].timestamp).toEqual(testDate);
      expect(retrieved?.messages[0].timestamp instanceof Date).toBe(true);
      expect(retrieved?.messages[1].timestamp instanceof Date).toBe(true);
    });

    it('should preserve message content and role through store/retrieve cycle', () => {
      const { result } = renderHook(
        () => useProductUiState(),
        { wrapper: createWrapper() }
      );

      const complexMessages: ChatMessage[] = [
        { id: 'cm-1', role: 'user', content: 'Complex\nmultiline\nmessage', timestamp: new Date() },
        { id: 'cm-2', role: 'assistant', content: 'Response with special chars: <>&"\'', timestamp: new Date() },
        { id: 'cm-3', role: 'user', content: '', timestamp: new Date() }, // empty content
      ];

      const stateWithComplexMessages: ImplementChatUiState = {
        sessionId: 'complex-session',
        messages: complexMessages,
        generatedSpecs: ['spec with\nnewlines', 'spec with "quotes"'],
        error: 'Error with <special> chars',
        inputDraft: 'Draft with\ttabs\tand\nnewlines',
      };

      act(() => {
        result.current.setImplementChatState('complex-project.json', 'complex-item', stateWithComplexMessages);
      });

      const retrieved = result.current.getImplementChatState('complex-project.json', 'complex-item');

      expect(retrieved?.messages[0].content).toBe('Complex\nmultiline\nmessage');
      expect(retrieved?.messages[1].content).toBe('Response with special chars: <>&"\'');
      expect(retrieved?.messages[2].content).toBe('');
      expect(retrieved?.generatedSpecs?.[0]).toBe('spec with\nnewlines');
      expect(retrieved?.error).toBe('Error with <special> chars');
      expect(retrieved?.inputDraft).toBe('Draft with\ttabs\tand\nnewlines');
    });
  });

  /**
   * Additional edge case: Concurrent updates to same work item
   */
  describe('concurrent update handling', () => {
    it('should handle multiple updates to same work item state', () => {
      const { result } = renderHook(
        () => useProductUiState(),
        { wrapper: createWrapper() }
      );

      // Simulate rapid updates that might occur during typing
      act(() => {
        result.current.setImplementChatState('concurrent-project.json', 'concurrent-item', {
          sessionId: null,
          messages: [],
          generatedSpecs: null,
          error: null,
          inputDraft: 'a',
        });
        result.current.setImplementChatState('concurrent-project.json', 'concurrent-item', {
          sessionId: null,
          messages: [],
          generatedSpecs: null,
          error: null,
          inputDraft: 'ab',
        });
        result.current.setImplementChatState('concurrent-project.json', 'concurrent-item', {
          sessionId: null,
          messages: [],
          generatedSpecs: null,
          error: null,
          inputDraft: 'abc',
        });
      });

      // Final state should be the last update
      const retrieved = result.current.getImplementChatState('concurrent-project.json', 'concurrent-item');
      expect(retrieved?.inputDraft).toBe('abc');
    });
  });
});
