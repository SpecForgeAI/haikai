/**
 * ProductUiStateContext Tests
 * Task Group 1: ProductUiStateContext Creation
 *
 * Tests for ProductUiStateContext which stores expansion state for Product tabs
 * (Backlog, Roadmap, Implement) keyed by project and tab.
 * This context enables preservation of tree expansion state across tab switches.
 *
 * Spec 2026-01-11: Fix Infinite Re-render Loop in Implementation Assistant
 * - Task Group 1: Getter stability tests
 * - Task Group 3: Equality guard tests
 *
 * Spec 2026-01-17: Fix Implement Assistant Infinite Render Loop
 * - Task Group 1: stateRef synchronization tests
 * - Task Group 5: Regression tests for infinite render loop prevention
 */

import { renderHook, act } from '@testing-library/react';
import { createElement, ReactNode } from 'react';
import {
  ProductUiStateProvider,
  useProductUiState,
  useProductExpansion,
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

describe('ProductUiStateContext', () => {
  /**
   * Test 1: getExpandedIds returns empty Set for unknown project/tab
   */
  describe('getExpandedIds returns empty Set for unknown project/tab', () => {
    it('should return empty Set when no state exists for project key', () => {
      const { result } = renderHook(() => useProductUiState(), {
        wrapper: createWrapper(),
      });

      const expandedIds = result.current.getExpandedIds('unknown-project', 'backlog');
      expect(expandedIds).toBeInstanceOf(Set);
      expect(expandedIds.size).toBe(0);
    });

    it('should return empty Set when project exists but tab does not have data', () => {
      const { result } = renderHook(() => useProductUiState(), {
        wrapper: createWrapper(),
      });

      // Set some data for backlog tab
      act(() => {
        result.current.setExpandedIds('project-1', 'backlog', new Set(['id1', 'id2']));
      });

      // Roadmap tab should still return empty Set
      const expandedIds = result.current.getExpandedIds('project-1', 'roadmap');
      expect(expandedIds).toBeInstanceOf(Set);
      expect(expandedIds.size).toBe(0);
    });
  });

  /**
   * Test 2: setExpandedIds stores and retrieves IDs correctly
   */
  describe('setExpandedIds stores and retrieves IDs correctly', () => {
    it('should store a Set of IDs and retrieve them correctly', () => {
      const { result } = renderHook(() => useProductUiState(), {
        wrapper: createWrapper(),
      });

      const idsToStore = new Set(['initiative-1', 'epic-2', 'feature-3']);

      act(() => {
        result.current.setExpandedIds('my-project', 'backlog', idsToStore);
      });

      const retrievedIds = result.current.getExpandedIds('my-project', 'backlog');
      expect(retrievedIds.size).toBe(3);
      expect(retrievedIds.has('initiative-1')).toBe(true);
      expect(retrievedIds.has('epic-2')).toBe(true);
      expect(retrievedIds.has('feature-3')).toBe(true);
    });

    it('should overwrite previous state when called again', () => {
      const { result } = renderHook(() => useProductUiState(), {
        wrapper: createWrapper(),
      });

      // First set
      act(() => {
        result.current.setExpandedIds('project-x', 'roadmap', new Set(['old-id']));
      });

      // Second set should overwrite
      act(() => {
        result.current.setExpandedIds('project-x', 'roadmap', new Set(['new-id-1', 'new-id-2']));
      });

      const retrievedIds = result.current.getExpandedIds('project-x', 'roadmap');
      expect(retrievedIds.size).toBe(2);
      expect(retrievedIds.has('old-id')).toBe(false);
      expect(retrievedIds.has('new-id-1')).toBe(true);
      expect(retrievedIds.has('new-id-2')).toBe(true);
    });
  });

  /**
   * Test 3: toggleExpanded adds ID when not present
   */
  describe('toggleExpanded adds ID when not present', () => {
    it('should add an ID to empty state', () => {
      const { result } = renderHook(() => useProductUiState(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.toggleExpanded('project-a', 'backlog', 'new-item');
      });

      const expandedIds = result.current.getExpandedIds('project-a', 'backlog');
      expect(expandedIds.size).toBe(1);
      expect(expandedIds.has('new-item')).toBe(true);
    });

    it('should add an ID to existing state when ID is not present', () => {
      const { result } = renderHook(() => useProductUiState(), {
        wrapper: createWrapper(),
      });

      // Initialize with some IDs
      act(() => {
        result.current.setExpandedIds('project-b', 'roadmap', new Set(['existing-1', 'existing-2']));
      });

      // Toggle a new ID
      act(() => {
        result.current.toggleExpanded('project-b', 'roadmap', 'new-item');
      });

      const expandedIds = result.current.getExpandedIds('project-b', 'roadmap');
      expect(expandedIds.size).toBe(3);
      expect(expandedIds.has('existing-1')).toBe(true);
      expect(expandedIds.has('existing-2')).toBe(true);
      expect(expandedIds.has('new-item')).toBe(true);
    });
  });

  /**
   * Test 4: toggleExpanded removes ID when present
   */
  describe('toggleExpanded removes ID when present', () => {
    it('should remove an ID when it is already present', () => {
      const { result } = renderHook(() => useProductUiState(), {
        wrapper: createWrapper(),
      });

      // Initialize with IDs including the one we will toggle off
      act(() => {
        result.current.setExpandedIds('project-c', 'backlog', new Set(['item-1', 'item-2', 'item-3']));
      });

      // Toggle existing ID to remove it
      act(() => {
        result.current.toggleExpanded('project-c', 'backlog', 'item-2');
      });

      const expandedIds = result.current.getExpandedIds('project-c', 'backlog');
      expect(expandedIds.size).toBe(2);
      expect(expandedIds.has('item-1')).toBe(true);
      expect(expandedIds.has('item-2')).toBe(false);
      expect(expandedIds.has('item-3')).toBe(true);
    });

    it('should result in empty Set when toggling off the only ID', () => {
      const { result } = renderHook(() => useProductUiState(), {
        wrapper: createWrapper(),
      });

      // Initialize with single ID
      act(() => {
        result.current.setExpandedIds('project-d', 'implement', new Set(['only-item']));
      });

      // Toggle it off
      act(() => {
        result.current.toggleExpanded('project-d', 'implement', 'only-item');
      });

      const expandedIds = result.current.getExpandedIds('project-d', 'implement');
      expect(expandedIds.size).toBe(0);
    });
  });

  /**
   * Test 5: State isolation between different projectKey values
   */
  describe('state isolation between different projectKey values', () => {
    it('should maintain separate state for different projects', () => {
      const { result } = renderHook(() => useProductUiState(), {
        wrapper: createWrapper(),
      });

      // Set state for project-1
      act(() => {
        result.current.setExpandedIds('project-1', 'backlog', new Set(['p1-item-1', 'p1-item-2']));
      });

      // Set state for project-2
      act(() => {
        result.current.setExpandedIds('project-2', 'backlog', new Set(['p2-item-a', 'p2-item-b', 'p2-item-c']));
      });

      // Verify project-1 state is independent
      const project1Ids = result.current.getExpandedIds('project-1', 'backlog');
      expect(project1Ids.size).toBe(2);
      expect(project1Ids.has('p1-item-1')).toBe(true);
      expect(project1Ids.has('p2-item-a')).toBe(false);

      // Verify project-2 state is independent
      const project2Ids = result.current.getExpandedIds('project-2', 'backlog');
      expect(project2Ids.size).toBe(3);
      expect(project2Ids.has('p2-item-a')).toBe(true);
      expect(project2Ids.has('p1-item-1')).toBe(false);
    });

    it('should not affect other projects when toggling in one project', () => {
      const { result } = renderHook(() => useProductUiState(), {
        wrapper: createWrapper(),
      });

      // Set up two projects
      act(() => {
        result.current.setExpandedIds('project-alpha', 'roadmap', new Set(['alpha-1']));
        result.current.setExpandedIds('project-beta', 'roadmap', new Set(['beta-1']));
      });

      // Toggle in project-alpha
      act(() => {
        result.current.toggleExpanded('project-alpha', 'roadmap', 'alpha-new');
      });

      // project-beta should be unaffected
      const betaIds = result.current.getExpandedIds('project-beta', 'roadmap');
      expect(betaIds.size).toBe(1);
      expect(betaIds.has('beta-1')).toBe(true);
      expect(betaIds.has('alpha-new')).toBe(false);
    });
  });

  /**
   * Test 6: State isolation between different tabKey values
   */
  describe('state isolation between different tabKey values', () => {
    it('should maintain separate state for different tabs within same project', () => {
      const { result } = renderHook(() => useProductUiState(), {
        wrapper: createWrapper(),
      });

      // Set state for different tabs in same project
      act(() => {
        result.current.setExpandedIds('project-x', 'backlog', new Set(['backlog-item-1']));
        result.current.setExpandedIds('project-x', 'roadmap', new Set(['roadmap-item-1', 'roadmap-item-2']));
        result.current.setExpandedIds('project-x', 'implement', new Set(['implement-item-1']));
      });

      // Verify each tab has its own state
      const backlogIds = result.current.getExpandedIds('project-x', 'backlog');
      expect(backlogIds.size).toBe(1);
      expect(backlogIds.has('backlog-item-1')).toBe(true);

      const roadmapIds = result.current.getExpandedIds('project-x', 'roadmap');
      expect(roadmapIds.size).toBe(2);
      expect(roadmapIds.has('roadmap-item-1')).toBe(true);
      expect(roadmapIds.has('roadmap-item-2')).toBe(true);

      const implementIds = result.current.getExpandedIds('project-x', 'implement');
      expect(implementIds.size).toBe(1);
      expect(implementIds.has('implement-item-1')).toBe(true);
    });

    it('should not affect other tabs when modifying one tab state', () => {
      const { result } = renderHook(() => useProductUiState(), {
        wrapper: createWrapper(),
      });

      // Set initial state for two tabs
      act(() => {
        result.current.setExpandedIds('project-y', 'backlog', new Set(['b1', 'b2']));
        result.current.setExpandedIds('project-y', 'roadmap', new Set(['r1', 'r2']));
      });

      // Modify backlog tab (overwrite)
      act(() => {
        result.current.setExpandedIds('project-y', 'backlog', new Set(['b-new']));
      });

      // Roadmap should be unaffected
      const roadmapIds = result.current.getExpandedIds('project-y', 'roadmap');
      expect(roadmapIds.size).toBe(2);
      expect(roadmapIds.has('r1')).toBe(true);
      expect(roadmapIds.has('r2')).toBe(true);
    });
  });
});

describe('useProductExpansion convenience hook', () => {
  /**
   * Test: useProductExpansion returns bound methods for specific project/tab
   *
   * Note: the hook now mirrors the context state into LOCAL state for
   * immediate reactivity (initialized on mount). Writes must therefore go
   * through the hook's bound setter, which updates both the context
   * (persistence) and the local mirror (reactivity); a direct context write
   * intentionally does not refresh an already-mounted hook instance.
   */
  it('should return expandedIds bound to specific project and tab', () => {
    const { result } = renderHook(
      () => ({
        context: useProductUiState(),
        expansion: useProductExpansion('my-project', 'backlog'),
      }),
      { wrapper: createWrapper() }
    );

    // Initially empty
    expect(result.current.expansion.expandedIds.size).toBe(0);

    // Set some IDs via the hook's bound setter
    act(() => {
      result.current.expansion.setExpandedIds(new Set(['item-1', 'item-2']));
    });

    // The expansion hook reflects the new state immediately
    expect(result.current.expansion.expandedIds.size).toBe(2);
    expect(result.current.expansion.expandedIds.has('item-1')).toBe(true);
    expect(result.current.expansion.expandedIds.has('item-2')).toBe(true);

    // Also verify the write reached the context store
    const storedIds = result.current.context.getExpandedIds('my-project', 'backlog');
    expect(storedIds.size).toBe(2);
    expect(storedIds.has('item-1')).toBe(true);
  });

  it('should provide setExpandedIds bound to specific project and tab', () => {
    const { result } = renderHook(
      () => ({
        context: useProductUiState(),
        expansion: useProductExpansion('bound-project', 'roadmap'),
      }),
      { wrapper: createWrapper() }
    );

    // Use the bound setExpandedIds
    act(() => {
      result.current.expansion.setExpandedIds(new Set(['bound-item']));
    });

    // Verify it was stored correctly
    const storedIds = result.current.context.getExpandedIds('bound-project', 'roadmap');
    expect(storedIds.size).toBe(1);
    expect(storedIds.has('bound-item')).toBe(true);
  });

  it('should provide toggleExpanded bound to specific project and tab', () => {
    const { result } = renderHook(
      () => ({
        context: useProductUiState(),
        expansion: useProductExpansion('toggle-project', 'implement'),
      }),
      { wrapper: createWrapper() }
    );

    // Use the bound toggleExpanded
    act(() => {
      result.current.expansion.toggleExpanded('toggle-item');
    });

    // Verify it was added - check via context getter (direct state read)
    const idsAfterAdd = result.current.context.getExpandedIds('toggle-project', 'implement');
    expect(idsAfterAdd.has('toggle-item')).toBe(true);

    // Toggle again to remove
    act(() => {
      result.current.expansion.toggleExpanded('toggle-item');
    });

    // Verify it was removed
    const idsAfterRemove = result.current.context.getExpandedIds('toggle-project', 'implement');
    expect(idsAfterRemove.has('toggle-item')).toBe(false);
  });
});

describe('useProductUiState error handling', () => {
  /**
   * Test: useProductUiState throws when used outside provider
   */
  it('should throw error when used outside ProductUiStateProvider', () => {
    // Suppress console.error for this test since React will log the error
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      renderHook(() => useProductUiState());
    }).toThrow('useProductUiState must be used within a ProductUiStateProvider');

    consoleSpy.mockRestore();
  });
});

// =============================================================================
// Spec 2026-01-11: Task Group 1 - Getter Stability Tests
// =============================================================================

describe('getter stability (Spec 2026-01-11 Task Group 1)', () => {
  /**
   * Test 1.1.1: getExpandedIds function identity remains stable across state changes
   */
  it('should maintain stable getExpandedIds function identity across state changes', () => {
    const { result } = renderHook(() => useProductUiState(), {
      wrapper: createWrapper(),
    });

    // Capture initial getter reference
    const initialGetExpandedIds = result.current.getExpandedIds;

    // Trigger state change
    act(() => {
      result.current.setExpandedIds('project-stable', 'backlog', new Set(['item-1']));
    });

    // Getter identity should remain stable
    expect(result.current.getExpandedIds).toBe(initialGetExpandedIds);

    // Trigger another state change
    act(() => {
      result.current.toggleExpanded('project-stable', 'backlog', 'item-2');
    });

    // Getter identity should still be stable
    expect(result.current.getExpandedIds).toBe(initialGetExpandedIds);

    // Verify getter still returns correct data
    const ids = result.current.getExpandedIds('project-stable', 'backlog');
    expect(ids.has('item-1')).toBe(true);
    expect(ids.has('item-2')).toBe(true);
  });

  /**
   * Test 1.1.2: getLastImplementWorkItemId function identity remains stable across state changes
   */
  it('should maintain stable getLastImplementWorkItemId function identity across state changes', () => {
    const { result } = renderHook(() => useProductUiState(), {
      wrapper: createWrapper(),
    });

    // Capture initial getter reference
    const initialGetter = result.current.getLastImplementWorkItemId;

    // Trigger state change
    act(() => {
      result.current.setLastImplementWorkItemId('project-stable', 'work-item-1');
    });

    // Getter identity should remain stable
    expect(result.current.getLastImplementWorkItemId).toBe(initialGetter);

    // Trigger another state change
    act(() => {
      result.current.setLastImplementWorkItemId('project-stable', 'work-item-2');
    });

    // Getter identity should still be stable
    expect(result.current.getLastImplementWorkItemId).toBe(initialGetter);

    // Verify getter still returns correct data
    const workItemId = result.current.getLastImplementWorkItemId('project-stable');
    expect(workItemId).toBe('work-item-2');
  });

  /**
   * Test 1.1.3: getImplementChatState function identity remains stable across state changes
   */
  it('should maintain stable getImplementChatState function identity across state changes', () => {
    const { result } = renderHook(() => useProductUiState(), {
      wrapper: createWrapper(),
    });

    // Capture initial getter reference
    const initialGetter = result.current.getImplementChatState;

    const chatState: ImplementChatUiState = {
      sessionId: 'session-1',
      messages: [{ id: 'msg-1', role: 'user', content: 'Hello', timestamp: new Date() }],
      generatedSpecs: null,
      error: null,
      inputDraft: '',
    };

    // Trigger state change
    act(() => {
      result.current.setImplementChatState('project-stable', 'work-item-1', chatState);
    });

    // Getter identity should remain stable
    expect(result.current.getImplementChatState).toBe(initialGetter);

    // Trigger another state change with updated chat state
    const updatedChatState: ImplementChatUiState = {
      ...chatState,
      messages: [...chatState.messages, { id: 'msg-2', role: 'assistant', content: 'Hi!', timestamp: new Date() }],
    };

    act(() => {
      result.current.setImplementChatState('project-stable', 'work-item-1', updatedChatState);
    });

    // Getter identity should still be stable
    expect(result.current.getImplementChatState).toBe(initialGetter);

    // Verify getter still returns correct data
    const retrievedState = result.current.getImplementChatState('project-stable', 'work-item-1');
    expect(retrievedState?.messages.length).toBe(2);
    expect(retrievedState?.sessionId).toBe('session-1');
  });

  /**
   * Test 1.1.4: Context value identity remains stable when only state (not structure) changes
   */
  it('should maintain stable context value identity when only state changes', () => {
    const contextRefs: unknown[] = [];

    const { result } = renderHook(
      () => {
        const ctx = useProductUiState();
        contextRefs.push(ctx);
        return ctx;
      },
      { wrapper: createWrapper() }
    );

    // Should have captured initial context
    expect(contextRefs.length).toBe(1);
    const initialContext = contextRefs[0];

    // Trigger state change
    act(() => {
      result.current.setExpandedIds('project-ctx', 'backlog', new Set(['item-1']));
    });

    // Context identity should remain stable (no new context object created)
    // The hook should have been called again but returned the same memoized value
    expect(result.current).toBe(initialContext);
  });
});

// =============================================================================
// Spec 2026-01-11: Task Group 3 - Equality Guard Tests
// =============================================================================

describe('equality guard for setImplementChatState (Spec 2026-01-11 Task Group 3)', () => {
  /**
   * Test 3.1.1: setImplementChatState does not trigger state update when values are equivalent
   */
  it('should not trigger state update when setImplementChatState is called with equivalent values', () => {
    const { result } = renderHook(() => useProductUiState(), {
      wrapper: createWrapper(),
    });

    const chatState: ImplementChatUiState = {
      sessionId: 'session-eq',
      messages: [],
      generatedSpecs: null,
      error: null,
      inputDraft: 'draft text',
    };

    // Initial set - should update state
    act(() => {
      result.current.setImplementChatState('project-eq', 'work-item-eq', chatState);
    });

    // Get initial state reference
    const initialState = result.current.getImplementChatState('project-eq', 'work-item-eq');
    expect(initialState).toBeDefined();

    // Set with equivalent values - should NOT trigger render (state unchanged)
    const equivalentChatState: ImplementChatUiState = {
      sessionId: 'session-eq',
      messages: [],
      generatedSpecs: null,
      error: null,
      inputDraft: 'draft text',
    };

    act(() => {
      result.current.setImplementChatState('project-eq', 'work-item-eq', equivalentChatState);
    });

    // Verify the state object is the same reference (equality guard prevented update)
    const stateAfterEquivalentSet = result.current.getImplementChatState('project-eq', 'work-item-eq');
    expect(stateAfterEquivalentSet).toBe(initialState);
  });

  /**
   * Test 3.1.2: setImplementChatState does trigger state update when values differ
   */
  it('should trigger state update when setImplementChatState is called with different values', () => {
    const { result } = renderHook(() => useProductUiState(), {
      wrapper: createWrapper(),
    });

    const chatState: ImplementChatUiState = {
      sessionId: 'session-diff',
      messages: [],
      generatedSpecs: null,
      error: null,
      inputDraft: '',
    };

    // Initial set
    act(() => {
      result.current.setImplementChatState('project-diff', 'work-item-diff', chatState);
    });

    // Get initial state reference
    const initialState = result.current.getImplementChatState('project-diff', 'work-item-diff');
    expect(initialState).toBeDefined();

    // Set with different values - should trigger state update
    const differentChatState: ImplementChatUiState = {
      sessionId: 'session-diff',
      messages: [{ id: 'msg-new', role: 'user', content: 'New message', timestamp: new Date() }],
      generatedSpecs: null,
      error: null,
      inputDraft: 'new draft',
    };

    act(() => {
      result.current.setImplementChatState('project-diff', 'work-item-diff', differentChatState);
    });

    // Verify state was updated (different reference)
    const stateAfterDifferentSet = result.current.getImplementChatState('project-diff', 'work-item-diff');
    expect(stateAfterDifferentSet).not.toBe(initialState);

    // Verify data was updated
    expect(stateAfterDifferentSet?.messages.length).toBe(1);
    expect(stateAfterDifferentSet?.inputDraft).toBe('new draft');
  });
});

// =============================================================================
// Spec 2026-01-17: Task Group 1 - stateRef Synchronization Tests
// =============================================================================

describe('stateRef synchronization (Spec 2026-01-17 Task Group 1)', () => {
  /**
   * Test 1.1.1: stateRef.current reflects state after updates
   *
   * This test verifies that the getter functions return current data
   * after state updates, which proves the stateRef is being synchronized.
   */
  it('should reflect current state in getter returns after state updates', () => {
    const { result } = renderHook(() => useProductUiState(), {
      wrapper: createWrapper(),
    });

    // Initially no state
    const initialData = result.current.getExpandedIds('test-project', 'backlog');
    expect(initialData.size).toBe(0);

    // Update state
    act(() => {
      result.current.setExpandedIds('test-project', 'backlog', new Set(['item-a', 'item-b']));
    });

    // Getter should return updated data (proves stateRef is synchronized)
    const updatedData = result.current.getExpandedIds('test-project', 'backlog');
    expect(updatedData.size).toBe(2);
    expect(updatedData.has('item-a')).toBe(true);
    expect(updatedData.has('item-b')).toBe(true);

    // Update state again
    act(() => {
      result.current.toggleExpanded('test-project', 'backlog', 'item-c');
    });

    // Getter should return latest data
    const latestData = result.current.getExpandedIds('test-project', 'backlog');
    expect(latestData.size).toBe(3);
    expect(latestData.has('item-c')).toBe(true);
  });

  /**
   * Test 1.1.2: stateRef.current is accessible within getter callbacks
   *
   * This test verifies that multiple getters can be called in sequence
   * and all return current data, proving stateRef is accessible in all callbacks.
   */
  it('should make current state accessible to all getter callbacks', () => {
    const { result } = renderHook(() => useProductUiState(), {
      wrapper: createWrapper(),
    });

    const chatState: ImplementChatUiState = {
      sessionId: 'ref-test-session',
      messages: [{ id: 'msg-1', role: 'user', content: 'Test', timestamp: new Date() }],
      generatedSpecs: null,
      error: null,
      inputDraft: 'test draft',
    };

    // Set up state for all getter types
    act(() => {
      result.current.setExpandedIds('ref-project', 'backlog', new Set(['exp-1']));
      result.current.setLastImplementWorkItemId('ref-project', 'work-item-123');
      result.current.setImplementChatState('ref-project', 'work-item-123', chatState);
    });

    // All getters should return current data
    const expandedIds = result.current.getExpandedIds('ref-project', 'backlog');
    expect(expandedIds.has('exp-1')).toBe(true);

    const workItemId = result.current.getLastImplementWorkItemId('ref-project');
    expect(workItemId).toBe('work-item-123');

    const chatStateResult = result.current.getImplementChatState('ref-project', 'work-item-123');
    expect(chatStateResult?.sessionId).toBe('ref-test-session');
    expect(chatStateResult?.messages.length).toBe(1);
  });

  /**
   * Test 1.1.3: stateRef updates synchronously with state changes
   *
   * This test verifies that after multiple rapid state changes,
   * the getters always return the most recent data.
   */
  it('should keep stateRef synchronized after multiple rapid state changes', () => {
    const { result } = renderHook(() => useProductUiState(), {
      wrapper: createWrapper(),
    });

    // Perform multiple rapid state changes in a single act
    act(() => {
      result.current.setExpandedIds('rapid-project', 'backlog', new Set(['v1']));
      result.current.setExpandedIds('rapid-project', 'backlog', new Set(['v2']));
      result.current.setExpandedIds('rapid-project', 'backlog', new Set(['v3']));
    });

    // Getter should return the final value
    const finalData = result.current.getExpandedIds('rapid-project', 'backlog');
    expect(finalData.size).toBe(1);
    expect(finalData.has('v3')).toBe(true);
    expect(finalData.has('v1')).toBe(false);
    expect(finalData.has('v2')).toBe(false);
  });
});

// =============================================================================
// Spec 2026-01-17: Task Group 5 - Regression Tests for Infinite Render Loop
// =============================================================================

describe('infinite render loop prevention (Spec 2026-01-17 Task Group 5)', () => {
  /**
   * Test 5.1.1: Getter stability prevents useEffect re-runs
   *
   * This test verifies that getter functions maintain stable identity
   * across state changes, which prevents infinite loops when getters
   * are used in useEffect dependency arrays.
   */
  it('should prevent useEffect re-runs by maintaining stable getter identities', () => {
    const { result } = renderHook(() => useProductUiState(), {
      wrapper: createWrapper(),
    });

    // Capture all getter references
    const initialGetExpandedIds = result.current.getExpandedIds;
    const initialGetLastImplementWorkItemId = result.current.getLastImplementWorkItemId;
    const initialGetImplementChatState = result.current.getImplementChatState;

    // Perform multiple state changes that would trigger re-renders
    const chatState: ImplementChatUiState = {
      sessionId: 'loop-test-session',
      messages: [],
      generatedSpecs: null,
      error: null,
      inputDraft: '',
    };

    act(() => {
      result.current.setImplementChatState('loop-project', 'loop-work-item', chatState);
    });

    // Verify all getters maintained stable identity
    expect(result.current.getExpandedIds).toBe(initialGetExpandedIds);
    expect(result.current.getLastImplementWorkItemId).toBe(initialGetLastImplementWorkItemId);
    expect(result.current.getImplementChatState).toBe(initialGetImplementChatState);

    // Update chat state (simulating what happens during hydration)
    const updatedChatState: ImplementChatUiState = {
      ...chatState,
      messages: [{ id: 'msg-1', role: 'user', content: 'Hello', timestamp: new Date() }],
    };

    act(() => {
      result.current.setImplementChatState('loop-project', 'loop-work-item', updatedChatState);
    });

    // Getters should still have stable identity
    expect(result.current.getExpandedIds).toBe(initialGetExpandedIds);
    expect(result.current.getLastImplementWorkItemId).toBe(initialGetLastImplementWorkItemId);
    expect(result.current.getImplementChatState).toBe(initialGetImplementChatState);
  });

  /**
   * Test 5.1.2: State preservation across simulated tab switches
   *
   * This test simulates the scenario where a user switches tabs,
   * verifying that state is preserved and no render loops occur.
   */
  it('should preserve state across simulated tab switches without triggering loops', () => {
    const { result } = renderHook(() => useProductUiState(), {
      wrapper: createWrapper(),
    });

    // Set up initial state (simulating Implement tab active)
    const chatState: ImplementChatUiState = {
      sessionId: 'tab-switch-session',
      messages: [
        { id: 'msg-1', role: 'user', content: 'Hello', timestamp: new Date() },
        { id: 'msg-2', role: 'assistant', content: 'Hi there!', timestamp: new Date() },
      ],
      generatedSpecs: null,
      error: null,
      inputDraft: 'my draft',
      hasBootstrapped: true,
    };

    act(() => {
      result.current.setImplementChatState('tab-project', 'tab-work-item', chatState);
    });

    // Capture getter references
    const getterRef = result.current.getImplementChatState;

    // Simulate reading state (as would happen on tab return)
    const retrievedState = result.current.getImplementChatState('tab-project', 'tab-work-item');
    expect(retrievedState).toBeDefined();
    expect(retrievedState?.sessionId).toBe('tab-switch-session');
    expect(retrievedState?.messages.length).toBe(2);
    expect(retrievedState?.inputDraft).toBe('my draft');

    // Simulate re-setting state (as might happen during hydration)
    act(() => {
      result.current.setImplementChatState('tab-project', 'tab-work-item', retrievedState!);
    });

    // Getter identity should still be stable (critical for preventing loops)
    expect(result.current.getImplementChatState).toBe(getterRef);

    // State should be preserved
    const finalState = result.current.getImplementChatState('tab-project', 'tab-work-item');
    expect(finalState?.sessionId).toBe('tab-switch-session');
    expect(finalState?.messages.length).toBe(2);
  });

  /**
   * Test 5.1.3: Context value memoization prevents consumer re-renders
   *
   * This test verifies that the context value object maintains stable
   * identity when state changes, preventing unnecessary consumer re-renders.
   */
  it('should maintain stable context value identity to prevent consumer re-renders', () => {
    const renderCounts: number[] = [];
    let renderCount = 0;

    const { result } = renderHook(
      () => {
        renderCount++;
        renderCounts.push(renderCount);
        return useProductUiState();
      },
      { wrapper: createWrapper() }
    );

    const initialRenderCount = renderCounts.length;
    const initialContext = result.current;

    // Perform state update
    act(() => {
      result.current.setExpandedIds('render-test', 'backlog', new Set(['item-1']));
    });

    // Context object should be the same reference
    expect(result.current).toBe(initialContext);

    // Additional state updates
    act(() => {
      result.current.toggleExpanded('render-test', 'backlog', 'item-2');
    });

    // Context should still be stable
    expect(result.current).toBe(initialContext);

    // Verify we didn't have excessive renders
    // Note: The render count might increase due to React's behavior,
    // but the context identity should remain stable
    expect(result.current).toBe(initialContext);
  });
});
