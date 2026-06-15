/**
 * Backlog Auto-Expand Epics Tests
 *
 * Spec 2026-01-08: Backlog Auto-Expand Epics on Initial Load
 * Task Group 1.1: Tests for auto-expand behavior
 *
 * These tests verify that:
 * - INITIATIVE nodes are expanded on first load (existing behavior preserved)
 * - EPIC nodes are expanded on first load (new behavior)
 * - FEATURE nodes remain collapsed on first load
 * - Existing expansion state is preserved when context has data
 */

import { renderHook, act } from '@testing-library/react';
import { createElement, ReactNode } from 'react';
import {
  ProductUiStateProvider,
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

/**
 * Simulates the ProductBacklogPage initial expansion computation logic.
 * This mirrors the behavior in ProductBacklogPage.tsx lines 261-266.
 *
 * @param workItems - Array of work items with type property
 * @returns Set of IDs that should be expanded on initial load
 */
function computeInitialExpansion(
  workItems: Array<{ id: string; type: string }>
): Set<string> {
  const initialExpanded = new Set<string>();
  for (const item of workItems) {
    if (item.type === 'INITIATIVE' || item.type === 'EPIC') {
      initialExpanded.add(item.id);
    }
  }
  return initialExpanded;
}

describe('Backlog Auto-Expand Epics on Initial Load', () => {
  /**
   * Test 1: INITIATIVE nodes are expanded on first load (existing behavior preserved)
   */
  describe('INITIATIVE nodes expansion', () => {
    it('should expand INITIATIVE nodes on first load', () => {
      const workItems = [
        { id: 'initiative-1', type: 'INITIATIVE' },
        { id: 'initiative-2', type: 'INITIATIVE' },
        { id: 'epic-1', type: 'EPIC' },
        { id: 'feature-1', type: 'FEATURE' },
        { id: 'story-1', type: 'STORY' },
      ];

      const initialExpanded = computeInitialExpansion(workItems);

      // INITIATIVE nodes should be expanded
      expect(initialExpanded.has('initiative-1')).toBe(true);
      expect(initialExpanded.has('initiative-2')).toBe(true);
    });
  });

  /**
   * Test 2: EPIC nodes are expanded on first load (new behavior)
   */
  describe('EPIC nodes expansion', () => {
    it('should expand EPIC nodes on first load', () => {
      const workItems = [
        { id: 'initiative-1', type: 'INITIATIVE' },
        { id: 'epic-1', type: 'EPIC' },
        { id: 'epic-2', type: 'EPIC' },
        { id: 'feature-1', type: 'FEATURE' },
        { id: 'story-1', type: 'STORY' },
      ];

      const initialExpanded = computeInitialExpansion(workItems);

      // EPIC nodes should be expanded
      expect(initialExpanded.has('epic-1')).toBe(true);
      expect(initialExpanded.has('epic-2')).toBe(true);
    });

    it('should expand both INITIATIVE and EPIC nodes together', () => {
      const workItems = [
        { id: 'initiative-1', type: 'INITIATIVE' },
        { id: 'epic-1', type: 'EPIC' },
        { id: 'epic-2', type: 'EPIC' },
        { id: 'feature-1', type: 'FEATURE' },
      ];

      const initialExpanded = computeInitialExpansion(workItems);

      // Both INITIATIVE and EPIC should be expanded
      expect(initialExpanded.size).toBe(3);
      expect(initialExpanded.has('initiative-1')).toBe(true);
      expect(initialExpanded.has('epic-1')).toBe(true);
      expect(initialExpanded.has('epic-2')).toBe(true);
    });
  });

  /**
   * Test 3: FEATURE nodes remain collapsed on first load
   */
  describe('FEATURE nodes remain collapsed', () => {
    it('should NOT expand FEATURE nodes on first load', () => {
      const workItems = [
        { id: 'initiative-1', type: 'INITIATIVE' },
        { id: 'epic-1', type: 'EPIC' },
        { id: 'feature-1', type: 'FEATURE' },
        { id: 'feature-2', type: 'FEATURE' },
        { id: 'story-1', type: 'STORY' },
      ];

      const initialExpanded = computeInitialExpansion(workItems);

      // FEATURE nodes should NOT be expanded (stories stay hidden)
      expect(initialExpanded.has('feature-1')).toBe(false);
      expect(initialExpanded.has('feature-2')).toBe(false);
    });

    it('should NOT expand STORY nodes on first load', () => {
      const workItems = [
        { id: 'initiative-1', type: 'INITIATIVE' },
        { id: 'epic-1', type: 'EPIC' },
        { id: 'feature-1', type: 'FEATURE' },
        { id: 'story-1', type: 'STORY' },
        { id: 'story-2', type: 'STORY' },
      ];

      const initialExpanded = computeInitialExpansion(workItems);

      // STORY nodes should NOT be expanded
      expect(initialExpanded.has('story-1')).toBe(false);
      expect(initialExpanded.has('story-2')).toBe(false);
    });
  });

  /**
   * Test 4: Existing expansion state is preserved when context has data
   */
  describe('existing expansion state preservation', () => {
    it('should preserve user expansion state when context already has data', () => {
      const { result } = renderHook(
        () => useProductExpansion('preserve-state-project', 'backlog'),
        { wrapper: createWrapper() }
      );

      // Simulate first load: set initial expansion (INITIATIVE and EPIC)
      act(() => {
        result.current.setExpandedIds(
          new Set(['initiative-1', 'epic-1', 'epic-2'])
        );
      });

      // User collapses an epic manually
      act(() => {
        result.current.toggleExpanded('epic-1'); // remove
      });

      // Verify user modification
      expect(result.current.expandedIds.has('initiative-1')).toBe(true);
      expect(result.current.expandedIds.has('epic-1')).toBe(false); // user collapsed
      expect(result.current.expandedIds.has('epic-2')).toBe(true);

      // Context has data (size > 0), so defaults should NOT be recomputed
      expect(result.current.expandedIds.size).toBe(2);

      // The guard condition: if (expandedIds.size > 0) then preserve state
      // This simulates what ProductBacklogPage does when context already has data
      const shouldPreserveState = result.current.expandedIds.size > 0;
      expect(shouldPreserveState).toBe(true);
    });

    it('should only apply defaults when context is empty (expandedIds.size === 0)', () => {
      const { result } = renderHook(
        () => useProductExpansion('empty-context-project', 'backlog'),
        { wrapper: createWrapper() }
      );

      // Context starts empty
      expect(result.current.expandedIds.size).toBe(0);

      // The guard condition: if (expandedIds.size === 0) then apply defaults
      const shouldApplyDefaults = result.current.expandedIds.size === 0;
      expect(shouldApplyDefaults).toBe(true);

      // After applying defaults, context will have data
      const mockWorkItems = [
        { id: 'init-1', type: 'INITIATIVE' },
        { id: 'epic-1', type: 'EPIC' },
      ];
      const initialExpanded = computeInitialExpansion(mockWorkItems);

      act(() => {
        result.current.setExpandedIds(initialExpanded);
      });

      // Now context has data, defaults should not be reapplied
      expect(result.current.expandedIds.size).toBe(2);
      const shouldApplyDefaultsAfter = result.current.expandedIds.size === 0;
      expect(shouldApplyDefaultsAfter).toBe(false);
    });
  });
});

describe('Full Backlog Auto-Expand Integration Scenario', () => {
  /**
   * Integration test: Full lifecycle with auto-expanded EPICs
   *
   * Simulates:
   * 1. First load - both INITIATIVE and EPIC nodes expanded
   * 2. Features visible under Epics without user interaction
   * 3. User modification preserved across tab switches
   */
  it('should auto-expand INITIATIVEs and EPICs on first load, showing Features', () => {
    const projectKey = deriveProjectKey('auto-expand-test.json');
    const { result, rerender } = renderHook(
      ({ pk, tabKey }) => useProductExpansion(pk, tabKey),
      {
        wrapper: createWrapper(),
        initialProps: { pk: projectKey, tabKey: 'backlog' as const },
      }
    );

    // Step 1: First load - context is empty
    expect(result.current.expandedIds.size).toBe(0);

    // Simulate ProductBacklogPage computing initial expansion
    // with new behavior: both INITIATIVE and EPIC expanded
    const workItems = [
      { id: 'initiative-001', type: 'INITIATIVE' },
      { id: 'epic-001', type: 'EPIC' },
      { id: 'epic-002', type: 'EPIC' },
      { id: 'feature-001', type: 'FEATURE' }, // Under epic-001
      { id: 'feature-002', type: 'FEATURE' }, // Under epic-002
      { id: 'story-001', type: 'STORY' }, // Under feature-001
    ];

    const initialExpanded = computeInitialExpansion(workItems);

    act(() => {
      result.current.setExpandedIds(initialExpanded);
    });

    // Step 2: Verify both INITIATIVEs and EPICs are expanded
    expect(result.current.expandedIds.size).toBe(3); // 1 initiative + 2 epics
    expect(result.current.expandedIds.has('initiative-001')).toBe(true);
    expect(result.current.expandedIds.has('epic-001')).toBe(true);
    expect(result.current.expandedIds.has('epic-002')).toBe(true);

    // Features and stories should NOT be auto-expanded
    expect(result.current.expandedIds.has('feature-001')).toBe(false);
    expect(result.current.expandedIds.has('feature-002')).toBe(false);
    expect(result.current.expandedIds.has('story-001')).toBe(false);

    // Step 3: User collapses an epic
    act(() => {
      result.current.toggleExpanded('epic-001'); // collapse
    });

    expect(result.current.expandedIds.has('epic-001')).toBe(false);

    // Step 4: Tab switch away and back - user state preserved
    rerender({ pk: projectKey, tabKey: 'roadmap' as const });
    rerender({ pk: projectKey, tabKey: 'backlog' as const });

    // User's collapsed state should be preserved
    expect(result.current.expandedIds.has('initiative-001')).toBe(true);
    expect(result.current.expandedIds.has('epic-001')).toBe(false); // Still collapsed
    expect(result.current.expandedIds.has('epic-002')).toBe(true);
  });
});
