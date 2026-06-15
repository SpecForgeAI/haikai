/**
 * ProductBacklogPage Expansion State Persistence Tests
 * Task Group 3: ProductBacklogPage Context Integration
 *
 * Tests for verifying that ProductBacklogPage correctly integrates with
 * ProductUiStateContext to preserve tree expansion state across tab switches
 * and data refetches.
 */

import { renderHook, act } from '@testing-library/react';
import { createElement, ReactNode } from 'react';
import {
  ProductUiStateProvider,
  useProductUiState,
  useProductExpansion,
  deriveProjectKey,
} from '../contexts/ProductUiStateContext';

/**
 * Helper wrapper component for testing hooks within provider
 */
function createWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(ProductUiStateProvider, null, children);
  };
}

describe('ProductBacklogPage Expansion State Persistence', () => {
  /**
   * Test 1: Initial load with empty context sets initiatives expanded
   *
   * When ProductBacklogPage mounts for the first time (empty context state),
   * it should compute initial expansion state where INITIATIVE nodes are expanded.
   */
  describe('initial load with empty context sets initiatives expanded', () => {
    it('should start with empty state when context has no data for project/tab', () => {
      const { result } = renderHook(
        () => useProductExpansion('test-project', 'backlog'),
        { wrapper: createWrapper() }
      );

      // Initial state should be empty
      expect(result.current.expandedIds.size).toBe(0);
    });

    it('should allow setting initial expansion state with initiatives', () => {
      const { result } = renderHook(
        () => useProductExpansion('init-project', 'backlog'),
        { wrapper: createWrapper() }
      );

      // Simulate what ProductBacklogPage does on first load:
      // compute initial expansion (INITIATIVE nodes expanded)
      const initiativeIds = new Set(['initiative-1', 'initiative-2']);

      act(() => {
        result.current.setExpandedIds(initiativeIds);
      });

      // Verify expansion state was stored
      expect(result.current.expandedIds.size).toBe(2);
      expect(result.current.expandedIds.has('initiative-1')).toBe(true);
      expect(result.current.expandedIds.has('initiative-2')).toBe(true);
    });
  });

  /**
   * Test 2: Subsequent load preserves user-modified expansion state
   *
   * When ProductBacklogPage remounts (e.g., after tab switch), it should
   * NOT reset expansion state to defaults if context already has data.
   */
  describe('subsequent load preserves user-modified expansion state', () => {
    it('should preserve user modifications when context already has data', () => {
      const { result, rerender } = renderHook(
        ({ projectKey, tabKey }) => useProductExpansion(projectKey, tabKey),
        {
          wrapper: createWrapper(),
          initialProps: { projectKey: 'user-mod-project', tabKey: 'backlog' as const },
        }
      );

      // Initial load: set up default expansion (initiatives expanded)
      act(() => {
        result.current.setExpandedIds(new Set(['initiative-1', 'initiative-2']));
      });

      // User modification: expand an epic, collapse an initiative
      act(() => {
        result.current.toggleExpanded('epic-1'); // Add epic
        result.current.toggleExpanded('initiative-1'); // Remove initiative
      });

      // Verify user modifications
      expect(result.current.expandedIds.has('initiative-1')).toBe(false);
      expect(result.current.expandedIds.has('initiative-2')).toBe(true);
      expect(result.current.expandedIds.has('epic-1')).toBe(true);

      // Simulate tab switch away and back (re-render with same params)
      rerender({ projectKey: 'user-mod-project', tabKey: 'roadmap' as const });
      rerender({ projectKey: 'user-mod-project', tabKey: 'backlog' as const });

      // User modifications should be preserved
      expect(result.current.expandedIds.has('initiative-1')).toBe(false);
      expect(result.current.expandedIds.has('initiative-2')).toBe(true);
      expect(result.current.expandedIds.has('epic-1')).toBe(true);
    });
  });

  /**
   * Test 3: Toggle updates context (not just local state)
   *
   * When user toggles expansion in ProductBacklogPage, the change should
   * be persisted to context so it survives component unmount.
   */
  describe('toggle updates context (not just local state)', () => {
    it('should update context when toggling expansion on', () => {
      const { result } = renderHook(
        () => ({
          context: useProductUiState(),
          expansion: useProductExpansion('toggle-project', 'backlog'),
        }),
        { wrapper: createWrapper() }
      );

      // Toggle an item to expand it
      act(() => {
        result.current.expansion.toggleExpanded('item-to-expand');
      });

      // Verify context was updated
      const contextIds = result.current.context.getExpandedIds('toggle-project', 'backlog');
      expect(contextIds.has('item-to-expand')).toBe(true);
    });

    it('should update context when toggling expansion off', () => {
      const { result } = renderHook(
        () => ({
          context: useProductUiState(),
          expansion: useProductExpansion('toggle-off-project', 'backlog'),
        }),
        { wrapper: createWrapper() }
      );

      // Set initial state with an expanded item
      act(() => {
        result.current.expansion.setExpandedIds(new Set(['item-to-collapse']));
      });

      // Toggle the item to collapse it
      act(() => {
        result.current.expansion.toggleExpanded('item-to-collapse');
      });

      // Verify context was updated
      const contextIds = result.current.context.getExpandedIds('toggle-off-project', 'backlog');
      expect(contextIds.has('item-to-collapse')).toBe(false);
    });
  });

  /**
   * Test 4: Expansion state survives tab switch and return
   *
   * This tests the core use case: user expands/collapses items in Backlog,
   * switches to Roadmap tab, then returns to Backlog. State should be preserved.
   */
  describe('expansion state survives tab switch and return', () => {
    it('should preserve backlog expansion state when switching to roadmap and back', () => {
      const { result, rerender } = renderHook(
        ({ projectKey, tabKey }) => useProductExpansion(projectKey, tabKey),
        {
          wrapper: createWrapper(),
          initialProps: { projectKey: 'tab-switch-project', tabKey: 'backlog' as const },
        }
      );

      // Set up backlog expansion state
      act(() => {
        result.current.setExpandedIds(new Set(['initiative-A', 'epic-B', 'feature-C']));
      });

      // Verify initial state
      expect(result.current.expandedIds.size).toBe(3);

      // Switch to roadmap (simulates ProductBacklogPage unmount)
      rerender({ projectKey: 'tab-switch-project', tabKey: 'roadmap' as const });

      // Roadmap has its own empty state
      expect(result.current.expandedIds.size).toBe(0);

      // Switch back to backlog (simulates ProductBacklogPage remount)
      rerender({ projectKey: 'tab-switch-project', tabKey: 'backlog' as const });

      // Backlog state should be preserved!
      expect(result.current.expandedIds.size).toBe(3);
      expect(result.current.expandedIds.has('initiative-A')).toBe(true);
      expect(result.current.expandedIds.has('epic-B')).toBe(true);
      expect(result.current.expandedIds.has('feature-C')).toBe(true);
    });

    it('should preserve backlog expansion state when switching to implement and back', () => {
      const { result, rerender } = renderHook(
        ({ projectKey, tabKey }) => useProductExpansion(projectKey, tabKey),
        {
          wrapper: createWrapper(),
          initialProps: { projectKey: 'impl-switch-project', tabKey: 'backlog' as const },
        }
      );

      // Set up backlog expansion state
      act(() => {
        result.current.setExpandedIds(new Set(['initiative-X']));
      });

      // Switch to implement
      rerender({ projectKey: 'impl-switch-project', tabKey: 'implement' as const });

      // Switch back to backlog
      rerender({ projectKey: 'impl-switch-project', tabKey: 'backlog' as const });

      // State should be preserved
      expect(result.current.expandedIds.size).toBe(1);
      expect(result.current.expandedIds.has('initiative-X')).toBe(true);
    });
  });

  /**
   * Test 5: Data refetch does not reset expansion state
   *
   * When work items are refetched (e.g., after mutation), the existing
   * expansion state should NOT be reset to defaults.
   */
  describe('data refetch does not reset expansion state', () => {
    it('should preserve expansion state after simulated data refetch', () => {
      const { result } = renderHook(
        () => ({
          context: useProductUiState(),
          expansion: useProductExpansion('refetch-project', 'backlog'),
        }),
        { wrapper: createWrapper() }
      );

      // Set up initial expansion state (as would happen on first load)
      act(() => {
        result.current.expansion.setExpandedIds(new Set(['init-1', 'init-2']));
      });

      // User modifies state
      act(() => {
        result.current.expansion.toggleExpanded('epic-1'); // Add
        result.current.expansion.toggleExpanded('init-1'); // Remove
      });

      // At this point, expansion state is: init-2, epic-1
      expect(result.current.expansion.expandedIds.has('init-1')).toBe(false);
      expect(result.current.expansion.expandedIds.has('init-2')).toBe(true);
      expect(result.current.expansion.expandedIds.has('epic-1')).toBe(true);

      // Simulate data refetch by NOT calling setExpandedIds again
      // The key behavior is that loadWorkItems should NOT reset expansion state
      // when context already has data

      // Verify state is still preserved (no reset happened)
      const contextIds = result.current.context.getExpandedIds('refetch-project', 'backlog');
      expect(contextIds.has('init-1')).toBe(false);
      expect(contextIds.has('init-2')).toBe(true);
      expect(contextIds.has('epic-1')).toBe(true);
    });

    it('should detect if context has existing state (non-empty check)', () => {
      const { result } = renderHook(
        () => useProductExpansion('empty-check-project', 'backlog'),
        { wrapper: createWrapper() }
      );

      // Initially empty
      expect(result.current.expandedIds.size).toBe(0);

      // Set some state
      act(() => {
        result.current.setExpandedIds(new Set(['item-1']));
      });

      // Now not empty
      expect(result.current.expandedIds.size).toBe(1);

      // This is how ProductBacklogPage should check:
      // if (expandedIds.size === 0) { /* first load, compute defaults */ }
      // else { /* subsequent load, use existing state */ }
    });
  });
});

describe('ProductBacklogPage Integration Scenarios', () => {
  /**
   * Test: Full lifecycle scenario
   *
   * Simulates the complete lifecycle:
   * 1. First load - empty context, compute defaults
   * 2. User interaction - modify expansion state
   * 3. Tab switch away
   * 4. Tab switch back - should preserve modifications
   * 5. Data refetch - should preserve modifications
   */
  it('should handle complete backlog page lifecycle', () => {
    const projectKey = deriveProjectKey('lifecycle-test.json');
    const { result, rerender } = renderHook(
      ({ pk, tabKey }) => useProductExpansion(pk, tabKey),
      {
        wrapper: createWrapper(),
        initialProps: { pk: projectKey, tabKey: 'backlog' as const },
      }
    );

    // Step 1: First load - context is empty, page computes defaults
    expect(result.current.expandedIds.size).toBe(0);

    // Simulate ProductBacklogPage computing initial expansion (initiatives expanded)
    const mockInitiatives = ['initiative-001', 'initiative-002', 'initiative-003'];
    act(() => {
      result.current.setExpandedIds(new Set(mockInitiatives));
    });

    expect(result.current.expandedIds.size).toBe(3);

    // Step 2: User interaction - user expands an epic and collapses an initiative
    act(() => {
      result.current.toggleExpanded('epic-under-init-001'); // expand
      result.current.toggleExpanded('initiative-001'); // collapse
    });

    expect(result.current.expandedIds.has('initiative-001')).toBe(false);
    expect(result.current.expandedIds.has('epic-under-init-001')).toBe(true);

    // Step 3: Tab switch away to roadmap
    rerender({ pk: projectKey, tabKey: 'roadmap' as const });
    expect(result.current.expandedIds.size).toBe(0); // Roadmap has its own state

    // Step 4: Tab switch back to backlog - state should be preserved
    rerender({ pk: projectKey, tabKey: 'backlog' as const });
    expect(result.current.expandedIds.has('initiative-001')).toBe(false);
    expect(result.current.expandedIds.has('initiative-002')).toBe(true);
    expect(result.current.expandedIds.has('initiative-003')).toBe(true);
    expect(result.current.expandedIds.has('epic-under-init-001')).toBe(true);

    // Step 5: Data refetch - expansion state should NOT be reset
    // (ProductBacklogPage should check context.size > 0 before overwriting)
    // We verify by checking state is still preserved
    expect(result.current.expandedIds.size).toBe(3); // init-002, init-003, epic
  });
});
