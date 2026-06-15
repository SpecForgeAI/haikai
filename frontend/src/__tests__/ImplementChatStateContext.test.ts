/**
 * ImplementChatStateContext Tests
 * Spec 2026-01-10: Preserve Implement Tab State Across Product & Delivery Tab Switches
 * Task Group 1: Tests for Implement chat state context methods
 *
 * Tests for the Implement chat state storage methods added to ProductUiStateContext:
 * - getLastImplementWorkItemId
 * - setLastImplementWorkItemId
 * - getImplementChatState
 * - setImplementChatState
 */

import { renderHook, act } from '@testing-library/react';
import { createElement, ReactNode } from 'react';
import {
  ProductUiStateProvider,
  useProductUiState,
  ImplementChatUiState,
} from '../contexts/ProductUiStateContext';

/**
 * Helper wrapper component for testing hooks within provider
 */
function createWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(ProductUiStateProvider, null, children);
  };
}

/**
 * Helper to create a sample chat state for testing
 */
function createSampleChatState(overrides?: Partial<ImplementChatUiState>): ImplementChatUiState {
  return {
    sessionId: 'session-123',
    messages: [
      {
        id: 'msg-1',
        role: 'user',
        content: 'Test message',
        timestamp: new Date('2026-01-10T10:00:00Z'),
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: 'Test response',
        timestamp: new Date('2026-01-10T10:00:01Z'),
      },
    ],
    generatedSpecs: null,
    error: null,
    inputDraft: 'draft text',
    ...overrides,
  };
}

describe('ProductUiStateContext - Implement Chat State Methods', () => {
  /**
   * Test 1: getLastImplementWorkItemId returns null for unknown project
   */
  describe('getLastImplementWorkItemId', () => {
    it('should return null for unknown project', () => {
      const { result } = renderHook(() => useProductUiState(), {
        wrapper: createWrapper(),
      });

      const workItemId = result.current.getLastImplementWorkItemId('unknown-project');
      expect(workItemId).toBeNull();
    });

    it('should return null for project with no lastImplementWorkItemId set', () => {
      const { result } = renderHook(() => useProductUiState(), {
        wrapper: createWrapper(),
      });

      // Set some expansion state for the project but not implement work item
      act(() => {
        result.current.setExpandedIds('project-1', 'backlog', new Set(['item-1']));
      });

      const workItemId = result.current.getLastImplementWorkItemId('project-1');
      expect(workItemId).toBeNull();
    });
  });

  /**
   * Test 2: setLastImplementWorkItemId stores and retrieves work item ID
   */
  describe('setLastImplementWorkItemId stores and retrieves work item ID', () => {
    it('should store work item ID and retrieve it correctly', () => {
      const { result } = renderHook(() => useProductUiState(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setLastImplementWorkItemId('my-project', 'work-item-123');
      });

      const workItemId = result.current.getLastImplementWorkItemId('my-project');
      expect(workItemId).toBe('work-item-123');
    });

    it('should overwrite previous work item ID when called again', () => {
      const { result } = renderHook(() => useProductUiState(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setLastImplementWorkItemId('project-x', 'old-work-item');
      });

      act(() => {
        result.current.setLastImplementWorkItemId('project-x', 'new-work-item');
      });

      const workItemId = result.current.getLastImplementWorkItemId('project-x');
      expect(workItemId).toBe('new-work-item');
    });

    it('should allow setting work item ID to null', () => {
      const { result } = renderHook(() => useProductUiState(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setLastImplementWorkItemId('project-y', 'some-item');
      });

      act(() => {
        result.current.setLastImplementWorkItemId('project-y', null);
      });

      const workItemId = result.current.getLastImplementWorkItemId('project-y');
      expect(workItemId).toBeNull();
    });

    it('should isolate work item IDs between different projects', () => {
      const { result } = renderHook(() => useProductUiState(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setLastImplementWorkItemId('project-alpha', 'alpha-item');
        result.current.setLastImplementWorkItemId('project-beta', 'beta-item');
      });

      expect(result.current.getLastImplementWorkItemId('project-alpha')).toBe('alpha-item');
      expect(result.current.getLastImplementWorkItemId('project-beta')).toBe('beta-item');
    });
  });

  /**
   * Test 3: getImplementChatState returns undefined for unknown project/workItem
   */
  describe('getImplementChatState', () => {
    it('should return undefined for unknown project', () => {
      const { result } = renderHook(() => useProductUiState(), {
        wrapper: createWrapper(),
      });

      const chatState = result.current.getImplementChatState('unknown-project', 'work-item-1');
      expect(chatState).toBeUndefined();
    });

    it('should return undefined for unknown workItemId in known project', () => {
      const { result } = renderHook(() => useProductUiState(), {
        wrapper: createWrapper(),
      });

      // Set chat state for one work item
      act(() => {
        result.current.setImplementChatState('project-1', 'work-item-known', createSampleChatState());
      });

      // Query for a different work item
      const chatState = result.current.getImplementChatState('project-1', 'work-item-unknown');
      expect(chatState).toBeUndefined();
    });

    it('should distinguish undefined from empty state (never stored vs empty)', () => {
      const { result } = renderHook(() => useProductUiState(), {
        wrapper: createWrapper(),
      });

      // Get state for never-stored work item
      const neverStored = result.current.getImplementChatState('project-1', 'never-stored');
      expect(neverStored).toBeUndefined();

      // Store an empty-ish state (but still a valid state object)
      const emptyishState: ImplementChatUiState = {
        sessionId: null,
        messages: [],
        generatedSpecs: null,
        error: null,
        inputDraft: '',
      };

      act(() => {
        result.current.setImplementChatState('project-1', 'empty-state', emptyishState);
      });

      // Should return the empty state object, not undefined
      const storedEmpty = result.current.getImplementChatState('project-1', 'empty-state');
      expect(storedEmpty).toBeDefined();
      expect(storedEmpty).toEqual(emptyishState);
    });
  });

  /**
   * Test 4: setImplementChatState stores and retrieves chat state correctly
   */
  describe('setImplementChatState stores and retrieves chat state correctly', () => {
    it('should store full chat state and retrieve it correctly', () => {
      const { result } = renderHook(() => useProductUiState(), {
        wrapper: createWrapper(),
      });

      const chatState = createSampleChatState();

      act(() => {
        result.current.setImplementChatState('my-project', 'work-item-1', chatState);
      });

      const retrieved = result.current.getImplementChatState('my-project', 'work-item-1');
      expect(retrieved).toEqual(chatState);
      expect(retrieved?.sessionId).toBe('session-123');
      expect(retrieved?.messages.length).toBe(2);
      expect(retrieved?.inputDraft).toBe('draft text');
    });

    it('should overwrite previous chat state for same workItem', () => {
      const { result } = renderHook(() => useProductUiState(), {
        wrapper: createWrapper(),
      });

      const initialState = createSampleChatState({ inputDraft: 'initial draft' });
      const updatedState = createSampleChatState({
        sessionId: 'new-session',
        inputDraft: 'updated draft',
        messages: [
          ...createSampleChatState().messages,
          { id: 'msg-3', role: 'user', content: 'New message', timestamp: new Date() },
        ],
      });

      act(() => {
        result.current.setImplementChatState('project-x', 'item-1', initialState);
      });

      act(() => {
        result.current.setImplementChatState('project-x', 'item-1', updatedState);
      });

      const retrieved = result.current.getImplementChatState('project-x', 'item-1');
      expect(retrieved?.sessionId).toBe('new-session');
      expect(retrieved?.inputDraft).toBe('updated draft');
      expect(retrieved?.messages.length).toBe(3);
    });

    it('should isolate chat state between different work items in same project', () => {
      const { result } = renderHook(() => useProductUiState(), {
        wrapper: createWrapper(),
      });

      const state1 = createSampleChatState({ sessionId: 'session-1', inputDraft: 'draft-1' });
      const state2 = createSampleChatState({ sessionId: 'session-2', inputDraft: 'draft-2' });

      act(() => {
        result.current.setImplementChatState('project-a', 'work-item-1', state1);
        result.current.setImplementChatState('project-a', 'work-item-2', state2);
      });

      const retrieved1 = result.current.getImplementChatState('project-a', 'work-item-1');
      const retrieved2 = result.current.getImplementChatState('project-a', 'work-item-2');

      expect(retrieved1?.sessionId).toBe('session-1');
      expect(retrieved2?.sessionId).toBe('session-2');
    });

    it('should isolate chat state between different projects', () => {
      const { result } = renderHook(() => useProductUiState(), {
        wrapper: createWrapper(),
      });

      const stateAlpha = createSampleChatState({ sessionId: 'alpha-session' });
      const stateBeta = createSampleChatState({ sessionId: 'beta-session' });

      act(() => {
        result.current.setImplementChatState('project-alpha', 'work-item-1', stateAlpha);
        result.current.setImplementChatState('project-beta', 'work-item-1', stateBeta);
      });

      const retrievedAlpha = result.current.getImplementChatState('project-alpha', 'work-item-1');
      const retrievedBeta = result.current.getImplementChatState('project-beta', 'work-item-1');

      expect(retrievedAlpha?.sessionId).toBe('alpha-session');
      expect(retrievedBeta?.sessionId).toBe('beta-session');
    });

    it('should create project entry if not exists when storing chat state', () => {
      const { result } = renderHook(() => useProductUiState(), {
        wrapper: createWrapper(),
      });

      const chatState = createSampleChatState();

      // Store chat state for a project that doesn't exist yet
      act(() => {
        result.current.setImplementChatState('new-project', 'work-item-1', chatState);
      });

      // Should retrieve correctly
      const retrieved = result.current.getImplementChatState('new-project', 'work-item-1');
      expect(retrieved).toEqual(chatState);

      // Expansion state should still work for this new project
      act(() => {
        result.current.setExpandedIds('new-project', 'backlog', new Set(['item-1']));
      });
      expect(result.current.getExpandedIds('new-project', 'backlog').has('item-1')).toBe(true);
    });

    it('should not affect existing expansion state when storing chat state', () => {
      const { result } = renderHook(() => useProductUiState(), {
        wrapper: createWrapper(),
      });

      // Set up expansion state first
      act(() => {
        result.current.setExpandedIds('project-z', 'backlog', new Set(['expanded-1', 'expanded-2']));
      });

      // Store chat state
      act(() => {
        result.current.setImplementChatState('project-z', 'work-item-1', createSampleChatState());
      });

      // Expansion state should be preserved
      const expandedIds = result.current.getExpandedIds('project-z', 'backlog');
      expect(expandedIds.size).toBe(2);
      expect(expandedIds.has('expanded-1')).toBe(true);
      expect(expandedIds.has('expanded-2')).toBe(true);
    });
  });
});
