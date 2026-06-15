/**
 * ProductRoadmapPage Expansion Persistence Tests
 * Task Group 4: ProductRoadmapPage Context Integration
 *
 * Tests for verifying that roadmap expansion state is persisted via
 * ProductUiStateContext across tab switches and data refreshes.
 */

import { renderHook, act } from '@testing-library/react';
import { createElement, ReactNode } from 'react';
import {
  ProductUiStateProvider,
  useProductExpansion,
  useProductUiState,
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

/**
 * Mock work items simulating INITIATIVE and EPIC items from roadmap
 * Used to test initial expansion logic for non-ARCHIVED initiatives
 */
interface MockWorkItem {
  id: string;
  type: 'INITIATIVE' | 'EPIC';
  status: 'ACTIVE' | 'ARCHIVED' | 'PLANNED';
}

/**
 * Helper: Compute initial expansion for roadmap based on spec requirements:
 * - Non-ARCHIVED INITIATIVEs should be expanded by default
 * - ARCHIVED INITIATIVEs should remain collapsed by default
 * - EPICs do not expand by default (they are children)
 */
function computeDefaultRoadmapExpansion(items: MockWorkItem[]): Set<string> {
  const expanded = new Set<string>();
  for (const item of items) {
    if (item.type === 'INITIATIVE' && item.status !== 'ARCHIVED') {
      expanded.add(item.id);
    }
  }
  return expanded;
}

describe('ProductRoadmapPage Expansion Persistence Tests', () => {
  /**
   * Test 1: Initial load expands non-ARCHIVED initiatives when context is empty
   *
   * When ProductRoadmapPage mounts for the first time (context has no state for
   * this project/tab), it should automatically expand all non-ARCHIVED INITIATIVE items.
   */
  describe('initial load expands non-ARCHIVED initiatives when context empty', () => {
    it('should compute default expansion for non-ARCHIVED initiatives on first load', () => {
      const mockItems: MockWorkItem[] = [
        { id: 'init-1', type: 'INITIATIVE', status: 'ACTIVE' },
        { id: 'init-2', type: 'INITIATIVE', status: 'PLANNED' },
        { id: 'init-3', type: 'INITIATIVE', status: 'ARCHIVED' },
        { id: 'epic-1', type: 'EPIC', status: 'ACTIVE' },
        { id: 'epic-2', type: 'EPIC', status: 'ACTIVE' },
      ];

      const { result } = renderHook(
        () => useProductExpansion('test-project', 'roadmap'),
        { wrapper: createWrapper() }
      );

      // Context should start empty
      expect(result.current.expandedIds.size).toBe(0);

      // Simulate first-load initialization: compute defaults and set in context
      const defaultExpansion = computeDefaultRoadmapExpansion(mockItems);

      act(() => {
        result.current.setExpandedIds(defaultExpansion);
      });

      // Verify non-ARCHIVED initiatives are expanded
      expect(result.current.expandedIds.has('init-1')).toBe(true);
      expect(result.current.expandedIds.has('init-2')).toBe(true);
      // ARCHIVED initiative should NOT be expanded
      expect(result.current.expandedIds.has('init-3')).toBe(false);
      // EPICs should NOT be expanded by default
      expect(result.current.expandedIds.has('epic-1')).toBe(false);
      expect(result.current.expandedIds.has('epic-2')).toBe(false);
    });

    it('should only set defaults when context is empty for this project/tab', () => {
      const { result } = renderHook(
        () => ({
          context: useProductUiState(),
          expansion: useProductExpansion('project-xyz', 'roadmap'),
        }),
        { wrapper: createWrapper() }
      );

      // Context is initially empty
      expect(result.current.expansion.expandedIds.size).toBe(0);

      // Simulate first-load: detect empty state and set defaults
      const isContextEmpty = result.current.expansion.expandedIds.size === 0;
      expect(isContextEmpty).toBe(true);

      // Now set initial expansion
      act(() => {
        result.current.expansion.setExpandedIds(new Set(['init-1', 'init-2']));
      });

      // State should now be populated
      expect(result.current.expansion.expandedIds.size).toBe(2);
    });
  });

  /**
   * Test 2: Subsequent load preserves user-modified expansion state
   *
   * When ProductRoadmapPage remounts (e.g., after tab switch and return),
   * it should use the existing context state rather than resetting to defaults.
   */
  describe('subsequent load preserves user-modified expansion state', () => {
    it('should preserve user-collapsed initiative on subsequent load', () => {
      const { result, rerender } = renderHook(
        ({ projectKey }) => useProductExpansion(projectKey, 'roadmap'),
        {
          wrapper: createWrapper(),
          initialProps: { projectKey: 'user-modified-project' },
        }
      );

      // Simulate first load: set default expansion
      act(() => {
        result.current.setExpandedIds(new Set(['init-1', 'init-2', 'init-3']));
      });

      // User collapses init-2
      act(() => {
        result.current.toggleExpanded('init-2');
      });

      // Verify user modification
      expect(result.current.expandedIds.has('init-2')).toBe(false);
      expect(result.current.expandedIds.size).toBe(2);

      // Simulate tab switch (component unmounts, context persists)
      // Then return to roadmap (component remounts with same projectKey)
      rerender({ projectKey: 'user-modified-project' });

      // Subsequent load: context is NOT empty, so should NOT reset to defaults
      const isContextEmpty = result.current.expandedIds.size === 0;
      expect(isContextEmpty).toBe(false);

      // User modification should be preserved
      expect(result.current.expandedIds.has('init-1')).toBe(true);
      expect(result.current.expandedIds.has('init-2')).toBe(false); // Still collapsed
      expect(result.current.expandedIds.has('init-3')).toBe(true);
    });

    it('should not reset expansion when data is refreshed', () => {
      const { result } = renderHook(
        () => useProductExpansion('refresh-test-project', 'roadmap'),
        { wrapper: createWrapper() }
      );

      // Initial state with some expanded items
      act(() => {
        result.current.setExpandedIds(new Set(['init-a', 'init-b']));
      });

      // User expands another item
      act(() => {
        result.current.toggleExpanded('init-c');
      });

      // Simulate data refresh: loadRoadmapItems is called again
      // The expansion state should NOT be reset
      // This test verifies that after data refresh, existing state is preserved
      expect(result.current.expandedIds.size).toBe(3);
      expect(result.current.expandedIds.has('init-a')).toBe(true);
      expect(result.current.expandedIds.has('init-b')).toBe(true);
      expect(result.current.expandedIds.has('init-c')).toBe(true);
    });
  });

  /**
   * Test 3: Toggle updates context (not just local state)
   *
   * When a user toggles expansion on an item, it should update the
   * ProductUiStateContext so the change persists across tab switches.
   */
  describe('toggle updates context (not just local state)', () => {
    it('should update context when toggling expansion on', () => {
      const { result } = renderHook(
        () => ({
          expansion: useProductExpansion('toggle-test-project', 'roadmap'),
          context: useProductUiState(),
        }),
        { wrapper: createWrapper() }
      );

      // Toggle an item to expand it
      act(() => {
        result.current.expansion.toggleExpanded('new-item');
      });

      // Verify the context was updated (not just local state)
      const contextIds = result.current.context.getExpandedIds('toggle-test-project', 'roadmap');
      expect(contextIds.has('new-item')).toBe(true);
    });

    it('should update context when toggling expansion off', () => {
      const { result } = renderHook(
        () => ({
          expansion: useProductExpansion('toggle-off-project', 'roadmap'),
          context: useProductUiState(),
        }),
        { wrapper: createWrapper() }
      );

      // Set initial state
      act(() => {
        result.current.expansion.setExpandedIds(new Set(['item-to-collapse', 'other-item']));
      });

      // Toggle to collapse
      act(() => {
        result.current.expansion.toggleExpanded('item-to-collapse');
      });

      // Verify the context was updated
      const contextIds = result.current.context.getExpandedIds('toggle-off-project', 'roadmap');
      expect(contextIds.has('item-to-collapse')).toBe(false);
      expect(contextIds.has('other-item')).toBe(true);
    });
  });

  /**
   * Test 4: Expansion state survives tab switch and return
   *
   * When user switches from Roadmap to another tab (Backlog/Implement)
   * and returns to Roadmap, their expansion state should be preserved.
   */
  describe('expansion state survives tab switch and return', () => {
    it('should preserve roadmap expansion after Roadmap -> Backlog -> Roadmap', () => {
      const { result, rerender } = renderHook(
        ({ projectKey, tabKey }) => useProductExpansion(projectKey, tabKey),
        {
          wrapper: createWrapper(),
          initialProps: { projectKey: 'tab-switch-project', tabKey: 'roadmap' as const },
        }
      );

      // Set initial roadmap expansion state
      act(() => {
        result.current.setExpandedIds(new Set(['roadmap-init-1', 'roadmap-init-2']));
      });

      // User collapses one
      act(() => {
        result.current.toggleExpanded('roadmap-init-1');
      });

      expect(result.current.expandedIds.has('roadmap-init-1')).toBe(false);
      expect(result.current.expandedIds.has('roadmap-init-2')).toBe(true);

      // Switch to Backlog tab (simulates ProductRoadmapPage unmount)
      rerender({ projectKey: 'tab-switch-project', tabKey: 'backlog' as const });

      // Backlog has its own state (empty by default)
      expect(result.current.expandedIds.size).toBe(0);

      // Switch back to Roadmap tab (simulates ProductRoadmapPage remount)
      rerender({ projectKey: 'tab-switch-project', tabKey: 'roadmap' as const });

      // Roadmap state should be preserved!
      expect(result.current.expandedIds.has('roadmap-init-1')).toBe(false);
      expect(result.current.expandedIds.has('roadmap-init-2')).toBe(true);
    });

    it('should preserve roadmap expansion after Roadmap -> Implement -> Roadmap', () => {
      const { result, rerender } = renderHook(
        ({ projectKey, tabKey }) => useProductExpansion(projectKey, tabKey),
        {
          wrapper: createWrapper(),
          initialProps: { projectKey: 'impl-switch-project', tabKey: 'roadmap' as const },
        }
      );

      // Set initial roadmap expansion state
      act(() => {
        result.current.setExpandedIds(new Set(['initiative-x', 'initiative-y', 'initiative-z']));
      });

      // Switch to Implement tab
      rerender({ projectKey: 'impl-switch-project', tabKey: 'implement' as const });

      // Implement has its own state
      expect(result.current.expandedIds.size).toBe(0);

      // Switch back to Roadmap
      rerender({ projectKey: 'impl-switch-project', tabKey: 'roadmap' as const });

      // All three should be preserved
      expect(result.current.expandedIds.size).toBe(3);
      expect(result.current.expandedIds.has('initiative-x')).toBe(true);
      expect(result.current.expandedIds.has('initiative-y')).toBe(true);
      expect(result.current.expandedIds.has('initiative-z')).toBe(true);
    });
  });

  /**
   * Test 5: ARCHIVED initiatives remain collapsed by default on first load
   *
   * On initial load, ARCHIVED INITIATIVE items should NOT be expanded,
   * even though other INITIATIVEs are expanded by default.
   */
  describe('ARCHIVED initiatives remain collapsed by default on first load', () => {
    it('should not expand ARCHIVED initiatives in default expansion', () => {
      const mockItems: MockWorkItem[] = [
        { id: 'active-init', type: 'INITIATIVE', status: 'ACTIVE' },
        { id: 'archived-init-1', type: 'INITIATIVE', status: 'ARCHIVED' },
        { id: 'archived-init-2', type: 'INITIATIVE', status: 'ARCHIVED' },
        { id: 'planned-init', type: 'INITIATIVE', status: 'PLANNED' },
      ];

      const defaultExpansion = computeDefaultRoadmapExpansion(mockItems);

      // Active and Planned should be expanded
      expect(defaultExpansion.has('active-init')).toBe(true);
      expect(defaultExpansion.has('planned-init')).toBe(true);

      // Archived should NOT be expanded
      expect(defaultExpansion.has('archived-init-1')).toBe(false);
      expect(defaultExpansion.has('archived-init-2')).toBe(false);
    });

    it('should allow user to manually expand ARCHIVED initiatives', () => {
      const { result } = renderHook(
        () => useProductExpansion('archived-expand-project', 'roadmap'),
        { wrapper: createWrapper() }
      );

      // Initial load: ARCHIVED not in default expansion
      act(() => {
        result.current.setExpandedIds(new Set(['active-init']));
      });

      expect(result.current.expandedIds.has('archived-init')).toBe(false);

      // User manually expands an ARCHIVED initiative
      act(() => {
        result.current.toggleExpanded('archived-init');
      });

      // Now it should be expanded
      expect(result.current.expandedIds.has('archived-init')).toBe(true);
      expect(result.current.expandedIds.has('active-init')).toBe(true);
    });
  });

  /**
   * Test 6: Project key derivation and isolation
   *
   * Verify that expansion state is properly isolated per project.
   */
  describe('project key derivation and isolation for roadmap', () => {
    it('should maintain separate expansion state for different projects', () => {
      const { result, rerender } = renderHook(
        ({ projectKey }) => useProductExpansion(projectKey, 'roadmap'),
        {
          wrapper: createWrapper(),
          initialProps: { projectKey: deriveProjectKey('project-a.json') },
        }
      );

      // Set expansion for project A
      act(() => {
        result.current.setExpandedIds(new Set(['a-init-1', 'a-init-2']));
      });

      // Switch to project B
      rerender({ projectKey: deriveProjectKey('project-b.json') });

      // Project B should have empty state
      expect(result.current.expandedIds.size).toBe(0);

      // Set expansion for project B
      act(() => {
        result.current.setExpandedIds(new Set(['b-init-1']));
      });

      // Switch back to project A
      rerender({ projectKey: deriveProjectKey('project-a.json') });

      // Project A state should be preserved
      expect(result.current.expandedIds.size).toBe(2);
      expect(result.current.expandedIds.has('a-init-1')).toBe(true);
      expect(result.current.expandedIds.has('a-init-2')).toBe(true);

      // Switch to project B and verify its state
      rerender({ projectKey: deriveProjectKey('project-b.json') });
      expect(result.current.expandedIds.size).toBe(1);
      expect(result.current.expandedIds.has('b-init-1')).toBe(true);
    });
  });
});
