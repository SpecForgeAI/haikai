/**
 * ProductUiStateProvider Placement Tests
 * Task Group 2: Provider Placement and Project Key Derivation
 *
 * Tests for verifying ProductUiStateProvider is correctly placed to survive
 * tab unmount/remount cycles and that projectKey derivation works correctly.
 */

import { renderHook, act } from '@testing-library/react';
import { createElement, ReactNode, useState } from 'react';
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

describe('ProductUiStateProvider Placement Tests', () => {
  /**
   * Test 1: Context is accessible within a component hierarchy (simulates ProductView)
   */
  describe('context is accessible within ProductView hierarchy', () => {
    it('should allow nested components to access context', () => {
      const { result } = renderHook(() => useProductUiState(), {
        wrapper: createWrapper(),
      });

      // Context should be accessible and functional
      expect(result.current.getExpandedIds).toBeDefined();
      expect(result.current.setExpandedIds).toBeDefined();
      expect(result.current.toggleExpanded).toBeDefined();
    });

    it('should allow setting and getting expansion state from nested component', () => {
      const { result } = renderHook(() => useProductUiState(), {
        wrapper: createWrapper(),
      });

      // Set some expansion state
      act(() => {
        result.current.setExpandedIds('test-project', 'backlog', new Set(['item-1', 'item-2']));
      });

      // Verify it was stored correctly
      const expandedIds = result.current.getExpandedIds('test-project', 'backlog');
      expect(expandedIds.size).toBe(2);
      expect(expandedIds.has('item-1')).toBe(true);
      expect(expandedIds.has('item-2')).toBe(true);
    });
  });

  /**
   * Test 2: Context state survives simulated ProductBacklogPage unmount/remount
   *
   * This test simulates what happens when switching from Backlog tab to another tab
   * and back. The key point is that as long as ProductUiStateProvider remains mounted,
   * the state should persist even when child components unmount.
   */
  describe('context survives ProductBacklogPage unmount/remount', () => {
    it('should preserve backlog expansion state across simulated tab switches', () => {
      // Create a wrapper that stays mounted (like ProductUiStateProvider wrapping ProductView)
      const { result, rerender } = renderHook(
        ({ projectKey, tabKey }) => useProductExpansion(projectKey, tabKey),
        {
          wrapper: createWrapper(),
          initialProps: { projectKey: 'project-1', tabKey: 'backlog' as const },
        }
      );

      // Set some expansion state for backlog
      act(() => {
        result.current.setExpandedIds(new Set(['initiative-1', 'epic-1']));
      });

      // Verify initial state
      expect(result.current.expandedIds.size).toBe(2);
      expect(result.current.expandedIds.has('initiative-1')).toBe(true);

      // Simulate switching to a different tab (roadmap)
      // In real app, ProductBacklogPage unmounts, but provider stays mounted
      rerender({ projectKey: 'project-1', tabKey: 'roadmap' as const });

      // Roadmap tab has no state yet
      expect(result.current.expandedIds.size).toBe(0);

      // Simulate switching back to backlog tab
      // ProductBacklogPage remounts, but context state should be preserved
      rerender({ projectKey: 'project-1', tabKey: 'backlog' as const });

      // State should be preserved!
      expect(result.current.expandedIds.size).toBe(2);
      expect(result.current.expandedIds.has('initiative-1')).toBe(true);
      expect(result.current.expandedIds.has('epic-1')).toBe(true);
    });
  });

  /**
   * Test 3: Context state survives simulated ProductRoadmapPage unmount/remount
   */
  describe('context survives ProductRoadmapPage unmount/remount', () => {
    it('should preserve roadmap expansion state across simulated tab switches', () => {
      const { result, rerender } = renderHook(
        ({ projectKey, tabKey }) => useProductExpansion(projectKey, tabKey),
        {
          wrapper: createWrapper(),
          initialProps: { projectKey: 'my-project', tabKey: 'roadmap' as const },
        }
      );

      // Set some expansion state for roadmap
      act(() => {
        result.current.setExpandedIds(new Set(['roadmap-init-1', 'roadmap-init-2', 'roadmap-init-3']));
      });

      // Verify initial state
      expect(result.current.expandedIds.size).toBe(3);

      // Simulate switching to backlog tab
      rerender({ projectKey: 'my-project', tabKey: 'backlog' as const });

      // Backlog should have its own empty state
      expect(result.current.expandedIds.size).toBe(0);

      // Simulate switching to implement tab
      rerender({ projectKey: 'my-project', tabKey: 'implement' as const });

      // Implement should have its own empty state
      expect(result.current.expandedIds.size).toBe(0);

      // Simulate switching back to roadmap tab
      rerender({ projectKey: 'my-project', tabKey: 'roadmap' as const });

      // Roadmap state should be preserved!
      expect(result.current.expandedIds.size).toBe(3);
      expect(result.current.expandedIds.has('roadmap-init-1')).toBe(true);
      expect(result.current.expandedIds.has('roadmap-init-2')).toBe(true);
      expect(result.current.expandedIds.has('roadmap-init-3')).toBe(true);
    });
  });

  /**
   * Test 4: Project key derivation from loadedFileName
   */
  describe('project key derivation from loadedFileName', () => {
    it('should return file name as-is when loadedFileName is provided', () => {
      const projectKey = deriveProjectKey('my-architecture-project.json');
      expect(projectKey).toBe('my-architecture-project.json');
    });

    it('should return empty string when loadedFileName is null', () => {
      const projectKey = deriveProjectKey(null);
      expect(projectKey).toBe('');
    });

    it('should handle different file name formats', () => {
      // Standard JSON file
      expect(deriveProjectKey('project.json')).toBe('project.json');

      // File with spaces (should preserve as-is)
      expect(deriveProjectKey('my project file.json')).toBe('my project file.json');

      // File with path separators (should preserve as-is)
      expect(deriveProjectKey('folder/project.json')).toBe('folder/project.json');

      // Empty string (edge case)
      expect(deriveProjectKey('')).toBe('');
    });

    it('should create isolated state per project key', () => {
      const { result } = renderHook(() => useProductUiState(), {
        wrapper: createWrapper(),
      });

      // Set state for project A
      act(() => {
        const projectKeyA = deriveProjectKey('project-a.json');
        result.current.setExpandedIds(projectKeyA, 'backlog', new Set(['a-item-1']));
      });

      // Set state for project B
      act(() => {
        const projectKeyB = deriveProjectKey('project-b.json');
        result.current.setExpandedIds(projectKeyB, 'backlog', new Set(['b-item-1', 'b-item-2']));
      });

      // Verify isolation
      const projectAIds = result.current.getExpandedIds(deriveProjectKey('project-a.json'), 'backlog');
      expect(projectAIds.size).toBe(1);
      expect(projectAIds.has('a-item-1')).toBe(true);
      expect(projectAIds.has('b-item-1')).toBe(false);

      const projectBIds = result.current.getExpandedIds(deriveProjectKey('project-b.json'), 'backlog');
      expect(projectBIds.size).toBe(2);
      expect(projectBIds.has('b-item-1')).toBe(true);
      expect(projectBIds.has('a-item-1')).toBe(false);
    });
  });

  /**
   * Test 5: Provider state persists across multiple tab changes (round-trip verification)
   */
  describe('provider survives multiple tab switches', () => {
    it('should preserve state across Backlog -> Roadmap -> Implement -> Backlog', () => {
      const { result, rerender } = renderHook(
        ({ projectKey, tabKey }) => useProductExpansion(projectKey, tabKey),
        {
          wrapper: createWrapper(),
          initialProps: { projectKey: 'round-trip-project', tabKey: 'backlog' as const },
        }
      );

      // Set backlog state
      act(() => {
        result.current.setExpandedIds(new Set(['backlog-init-1']));
      });

      // Set roadmap state
      rerender({ projectKey: 'round-trip-project', tabKey: 'roadmap' as const });
      act(() => {
        result.current.setExpandedIds(new Set(['roadmap-init-1', 'roadmap-init-2']));
      });

      // Set implement state (even though it might be unused)
      rerender({ projectKey: 'round-trip-project', tabKey: 'implement' as const });
      act(() => {
        result.current.setExpandedIds(new Set(['implement-item-1']));
      });

      // Go back to backlog
      rerender({ projectKey: 'round-trip-project', tabKey: 'backlog' as const });

      // Backlog state should be preserved
      expect(result.current.expandedIds.size).toBe(1);
      expect(result.current.expandedIds.has('backlog-init-1')).toBe(true);

      // Verify roadmap state is still there
      rerender({ projectKey: 'round-trip-project', tabKey: 'roadmap' as const });
      expect(result.current.expandedIds.size).toBe(2);

      // Verify implement state is still there
      rerender({ projectKey: 'round-trip-project', tabKey: 'implement' as const });
      expect(result.current.expandedIds.size).toBe(1);
    });
  });
});
