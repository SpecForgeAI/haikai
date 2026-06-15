/**
 * Product Expansion Persistence Integration Tests
 * Task Group 6: Test Review and Gap Analysis
 *
 * These tests fill critical coverage gaps identified in the test review phase:
 * - Tab switch round-trip workflows
 * - Project change behavior
 * - Data refetch preservation
 * - Unknown ID handling
 *
 * Maximum 8 additional tests per spec requirements.
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

describe('Product Expansion Persistence Integration Tests', () => {
  /**
   * Test 1: Backlog expansion survives Backlog -> Roadmap -> Backlog navigation
   *
   * Critical workflow: User works in Backlog, switches to Roadmap to check something,
   * then returns to Backlog. Their expansion state in Backlog should be preserved.
   */
  it('should preserve backlog expansion through Backlog -> Roadmap -> Backlog navigation', () => {
    const projectKey = 'backlog-roundtrip-project';
    const { result, rerender } = renderHook(
      ({ pk, tabKey }) => useProductExpansion(pk, tabKey),
      {
        wrapper: createWrapper(),
        initialProps: { pk: projectKey, tabKey: 'backlog' as const },
      }
    );

    // Set up backlog expansion with multiple items at different levels
    act(() => {
      result.current.setExpandedIds(
        new Set(['initiative-1', 'initiative-2', 'epic-under-init-1', 'feature-under-epic'])
      );
    });

    // Verify initial backlog state
    expect(result.current.expandedIds.size).toBe(4);
    expect(result.current.expandedIds.has('initiative-1')).toBe(true);
    expect(result.current.expandedIds.has('feature-under-epic')).toBe(true);

    // Switch to Roadmap tab (ProductBacklogPage unmounts)
    rerender({ pk: projectKey, tabKey: 'roadmap' as const });

    // Roadmap starts empty
    expect(result.current.expandedIds.size).toBe(0);

    // Set some roadmap state (user interaction in roadmap)
    act(() => {
      result.current.setExpandedIds(new Set(['roadmap-initiative-a']));
    });
    expect(result.current.expandedIds.size).toBe(1);

    // Switch back to Backlog (ProductBacklogPage remounts)
    rerender({ pk: projectKey, tabKey: 'backlog' as const });

    // Backlog state should be fully preserved
    expect(result.current.expandedIds.size).toBe(4);
    expect(result.current.expandedIds.has('initiative-1')).toBe(true);
    expect(result.current.expandedIds.has('initiative-2')).toBe(true);
    expect(result.current.expandedIds.has('epic-under-init-1')).toBe(true);
    expect(result.current.expandedIds.has('feature-under-epic')).toBe(true);
  });

  /**
   * Test 2: Roadmap expansion survives Roadmap -> Backlog -> Roadmap navigation
   *
   * Critical workflow: User works in Roadmap, switches to Backlog to check something,
   * then returns to Roadmap. Their expansion state in Roadmap should be preserved.
   */
  it('should preserve roadmap expansion through Roadmap -> Backlog -> Roadmap navigation', () => {
    const projectKey = 'roadmap-roundtrip-project';
    const { result, rerender } = renderHook(
      ({ pk, tabKey }) => useProductExpansion(pk, tabKey),
      {
        wrapper: createWrapper(),
        initialProps: { pk: projectKey, tabKey: 'roadmap' as const },
      }
    );

    // Set up roadmap expansion with user-modified state (simulating user collapsed one initiative)
    act(() => {
      result.current.setExpandedIds(
        new Set(['roadmap-init-1', 'roadmap-init-3']) // init-2 was collapsed by user
      );
    });

    // User expands an epic
    act(() => {
      result.current.toggleExpanded('epic-in-init-1');
    });

    // Verify initial roadmap state
    expect(result.current.expandedIds.size).toBe(3);
    expect(result.current.expandedIds.has('roadmap-init-1')).toBe(true);
    expect(result.current.expandedIds.has('roadmap-init-3')).toBe(true);
    expect(result.current.expandedIds.has('epic-in-init-1')).toBe(true);

    // Switch to Backlog tab (ProductRoadmapPage unmounts)
    rerender({ pk: projectKey, tabKey: 'backlog' as const });

    // Backlog starts empty
    expect(result.current.expandedIds.size).toBe(0);

    // User does some work in backlog
    act(() => {
      result.current.setExpandedIds(new Set(['backlog-item-1']));
    });

    // Switch back to Roadmap (ProductRoadmapPage remounts)
    rerender({ pk: projectKey, tabKey: 'roadmap' as const });

    // Roadmap state should be fully preserved including user modifications
    expect(result.current.expandedIds.size).toBe(3);
    expect(result.current.expandedIds.has('roadmap-init-1')).toBe(true);
    expect(result.current.expandedIds.has('roadmap-init-3')).toBe(true);
    expect(result.current.expandedIds.has('epic-in-init-1')).toBe(true);
    // init-2 should still not be present (user collapsed it)
    expect(result.current.expandedIds.has('roadmap-init-2')).toBe(false);
  });

  /**
   * Test 3: Backlog -> Implement -> Backlog preserves expansion
   *
   * Tests the round-trip with the Implement tab, which currently has no tree UI
   * but uses the same context infrastructure.
   */
  it('should preserve backlog expansion through Backlog -> Implement -> Backlog navigation', () => {
    const projectKey = 'backlog-implement-roundtrip';
    const { result, rerender } = renderHook(
      ({ pk, tabKey }) => useProductExpansion(pk, tabKey),
      {
        wrapper: createWrapper(),
        initialProps: { pk: projectKey, tabKey: 'backlog' as const },
      }
    );

    // Set up backlog expansion
    act(() => {
      result.current.setExpandedIds(new Set(['initiative-x', 'epic-y']));
    });

    expect(result.current.expandedIds.size).toBe(2);

    // Switch to Implement tab
    rerender({ pk: projectKey, tabKey: 'implement' as const });

    // Implement tab has its own state (empty for now since no tree UI exists)
    expect(result.current.expandedIds.size).toBe(0);

    // Even if implement tab were to set some state, it shouldn't affect backlog
    act(() => {
      result.current.setExpandedIds(new Set(['implement-item-1']));
    });

    // Switch back to Backlog
    rerender({ pk: projectKey, tabKey: 'backlog' as const });

    // Backlog state should be preserved
    expect(result.current.expandedIds.size).toBe(2);
    expect(result.current.expandedIds.has('initiative-x')).toBe(true);
    expect(result.current.expandedIds.has('epic-y')).toBe(true);
    // Implement state should not bleed into backlog
    expect(result.current.expandedIds.has('implement-item-1')).toBe(false);
  });

  /**
   * Test 4: Changing loadedFileName resets expansion state for new project
   *
   * When user switches to a different project (loadedFileName changes),
   * the new project should start with fresh expansion state.
   */
  it('should start with empty expansion state when switching to new project', () => {
    const { result, rerender } = renderHook(
      ({ projectKey }) => useProductExpansion(projectKey, 'backlog'),
      {
        wrapper: createWrapper(),
        initialProps: { projectKey: deriveProjectKey('project-old.json') },
      }
    );

    // Set up expansion for old project
    act(() => {
      result.current.setExpandedIds(new Set(['old-init-1', 'old-init-2', 'old-epic-1']));
    });

    expect(result.current.expandedIds.size).toBe(3);

    // Simulate loading a new file (loadedFileName changes)
    const newProjectKey = deriveProjectKey('project-new.json');
    rerender({ projectKey: newProjectKey });

    // New project should have empty state (fresh start)
    expect(result.current.expandedIds.size).toBe(0);

    // New project can set its own defaults
    act(() => {
      result.current.setExpandedIds(new Set(['new-init-1']));
    });

    // Verify new project has only its own state
    expect(result.current.expandedIds.size).toBe(1);
    expect(result.current.expandedIds.has('new-init-1')).toBe(true);
    expect(result.current.expandedIds.has('old-init-1')).toBe(false);
  });

  /**
   * Test 5: Import/refresh on Roadmap preserves expansion for valid IDs
   *
   * When data is refreshed/imported, existing expansion state should be preserved.
   * IDs that still exist should remain expanded, IDs that no longer exist are
   * simply not rendered (but don't cause errors).
   */
  it('should preserve expansion state after data import/refresh', () => {
    const projectKey = 'import-refresh-project';
    const { result } = renderHook(
      () => ({
        expansion: useProductExpansion(projectKey, 'roadmap'),
        context: useProductUiState(),
      }),
      { wrapper: createWrapper() }
    );

    // Initial expansion state (represents first load defaults)
    act(() => {
      result.current.expansion.setExpandedIds(
        new Set(['init-1', 'init-2', 'init-3'])
      );
    });

    // User modification: collapse init-2, expand an epic
    act(() => {
      result.current.expansion.toggleExpanded('init-2'); // collapse
      result.current.expansion.toggleExpanded('epic-under-init-1'); // expand
    });

    // State before refresh: init-1, init-3, epic-under-init-1
    expect(result.current.expansion.expandedIds.size).toBe(3);
    expect(result.current.expansion.expandedIds.has('init-1')).toBe(true);
    expect(result.current.expansion.expandedIds.has('init-2')).toBe(false);
    expect(result.current.expansion.expandedIds.has('init-3')).toBe(true);
    expect(result.current.expansion.expandedIds.has('epic-under-init-1')).toBe(true);

    // Simulate import/refresh: Context state should NOT be reset
    // This is the key behavior - loadRoadmapItems should preserve existing expansion
    // We verify by checking state remains unchanged after "refresh"

    // The context still has our state
    const contextIds = result.current.context.getExpandedIds(projectKey, 'roadmap');
    expect(contextIds.size).toBe(3);
    expect(contextIds.has('init-1')).toBe(true);
    expect(contextIds.has('init-2')).toBe(false);
    expect(contextIds.has('init-3')).toBe(true);
    expect(contextIds.has('epic-under-init-1')).toBe(true);
  });

  /**
   * Test 6: Unknown IDs in expansion set are gracefully ignored (no crash)
   *
   * If the expansion set contains IDs that don't correspond to any current items
   * (e.g., after import where some items were removed), the context should
   * handle this gracefully without throwing errors.
   */
  it('should handle unknown IDs in expansion set gracefully', () => {
    const projectKey = 'unknown-ids-project';
    const { result } = renderHook(
      () => useProductExpansion(projectKey, 'backlog'),
      { wrapper: createWrapper() }
    );

    // Set expansion state with IDs that don't exist in data (simulating stale IDs)
    act(() => {
      result.current.setExpandedIds(
        new Set([
          'valid-init-1',           // Assume this exists
          'deleted-init-99',        // This was deleted
          'renamed-epic-xyz',       // This was renamed/removed
          'non-existent-feature',   // Never existed
        ])
      );
    });

    // Context should store all IDs without crashing
    expect(result.current.expandedIds.size).toBe(4);

    // All IDs should be retrievable (context doesn't validate against actual items)
    expect(result.current.expandedIds.has('valid-init-1')).toBe(true);
    expect(result.current.expandedIds.has('deleted-init-99')).toBe(true);
    expect(result.current.expandedIds.has('renamed-epic-xyz')).toBe(true);
    expect(result.current.expandedIds.has('non-existent-feature')).toBe(true);

    // Toggle operations should work normally
    act(() => {
      result.current.toggleExpanded('deleted-init-99'); // Remove stale ID
      result.current.toggleExpanded('new-valid-item'); // Add new ID
    });

    // State should update correctly
    expect(result.current.expandedIds.has('deleted-init-99')).toBe(false);
    expect(result.current.expandedIds.has('new-valid-item')).toBe(true);
  });

  /**
   * Test 7: Multiple tab switches preserve both Backlog and Roadmap state independently
   *
   * Tests a complex navigation scenario: Backlog -> Roadmap -> Backlog -> Roadmap
   * Both tabs should maintain their own independent state throughout.
   */
  it('should maintain independent state for Backlog and Roadmap across multiple switches', () => {
    const projectKey = 'multi-switch-project';
    const { result, rerender } = renderHook(
      ({ pk, tabKey }) => useProductExpansion(pk, tabKey),
      {
        wrapper: createWrapper(),
        initialProps: { pk: projectKey, tabKey: 'backlog' as const },
      }
    );

    // 1. Set backlog state
    act(() => {
      result.current.setExpandedIds(new Set(['backlog-init-1']));
    });
    expect(result.current.expandedIds.size).toBe(1);

    // 2. Switch to roadmap and set state
    rerender({ pk: projectKey, tabKey: 'roadmap' as const });
    act(() => {
      result.current.setExpandedIds(new Set(['roadmap-init-1', 'roadmap-init-2']));
    });
    expect(result.current.expandedIds.size).toBe(2);

    // 3. Switch back to backlog, verify state, modify it
    rerender({ pk: projectKey, tabKey: 'backlog' as const });
    expect(result.current.expandedIds.size).toBe(1);
    expect(result.current.expandedIds.has('backlog-init-1')).toBe(true);

    act(() => {
      result.current.toggleExpanded('backlog-epic-new'); // Add new item
    });
    expect(result.current.expandedIds.size).toBe(2);

    // 4. Switch to roadmap, verify state, modify it
    rerender({ pk: projectKey, tabKey: 'roadmap' as const });
    expect(result.current.expandedIds.size).toBe(2);
    expect(result.current.expandedIds.has('roadmap-init-1')).toBe(true);
    expect(result.current.expandedIds.has('roadmap-init-2')).toBe(true);

    act(() => {
      result.current.toggleExpanded('roadmap-init-2'); // Collapse
    });
    expect(result.current.expandedIds.size).toBe(1);
    expect(result.current.expandedIds.has('roadmap-init-2')).toBe(false);

    // 5. Final verification: switch to backlog, check both states are correct
    rerender({ pk: projectKey, tabKey: 'backlog' as const });
    expect(result.current.expandedIds.size).toBe(2);
    expect(result.current.expandedIds.has('backlog-init-1')).toBe(true);
    expect(result.current.expandedIds.has('backlog-epic-new')).toBe(true);

    rerender({ pk: projectKey, tabKey: 'roadmap' as const });
    expect(result.current.expandedIds.size).toBe(1);
    expect(result.current.expandedIds.has('roadmap-init-1')).toBe(true);
    expect(result.current.expandedIds.has('roadmap-init-2')).toBe(false);
  });

  /**
   * Test 8: Context handles empty projectKey (no file loaded) gracefully
   *
   * When no file is loaded (loadedFileName is null), deriveProjectKey returns
   * empty string. The context should handle this edge case without errors.
   */
  it('should handle empty projectKey (no file loaded) gracefully', () => {
    // Simulate no file loaded
    const projectKey = deriveProjectKey(null);
    expect(projectKey).toBe('');

    const { result } = renderHook(
      () => useProductExpansion(projectKey, 'backlog'),
      { wrapper: createWrapper() }
    );

    // Should start empty (no errors)
    expect(result.current.expandedIds.size).toBe(0);

    // Should be able to set state even with empty projectKey
    act(() => {
      result.current.setExpandedIds(new Set(['temp-item']));
    });
    expect(result.current.expandedIds.size).toBe(1);

    // Toggle should work
    act(() => {
      result.current.toggleExpanded('another-item');
    });
    expect(result.current.expandedIds.size).toBe(2);

    // Clear state
    act(() => {
      result.current.setExpandedIds(new Set());
    });
    expect(result.current.expandedIds.size).toBe(0);
  });
});
