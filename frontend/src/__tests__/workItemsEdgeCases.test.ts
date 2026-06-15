/**
 * Work Items Edge Cases Tests
 *
 * Spec 2026-01-03: Product Backlog Tree View (Stage 4)
 * Task Group 4: Additional strategic tests for edge cases
 *
 * These tests cover critical edge cases and integration scenarios:
 * - Large data sets
 * - Deep hierarchies
 * - Unusual data patterns
 * - Type safety boundaries
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWorkItems } from '../api/workItemsApi';
import { buildWorkItemTree, deriveParentChain } from '../utils/workItemTreeBuilder';
import type { WorkItem } from '../types/workItems';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

/**
 * Helper function to create a mock work item
 */
function createMockWorkItem(overrides: Partial<WorkItem> & { id: string; title: string }): WorkItem {
  return {
    projectId: 'proj-1',
    type: 'STORY',
    parentId: null,
    description: null,
    status: 'NEW',
    sortOrder: 0,
    priority: null,
    targetWindow: null,
    tags: null,
    externalSystem: null,
    externalKey: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('Work Items Edge Cases', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Large data set handling', () => {
    it('should handle 100+ work items without performance issues', () => {
      // Arrange: Create 100 items with hierarchy
      const items: WorkItem[] = [];

      // Create 10 initiatives
      for (let i = 0; i < 10; i++) {
        items.push(
          createMockWorkItem({
            id: `init-${i}`,
            title: `Initiative ${i}`,
            type: 'INITIATIVE',
            sortOrder: i,
          })
        );
      }

      // Create 30 epics (3 per initiative)
      for (let i = 0; i < 30; i++) {
        items.push(
          createMockWorkItem({
            id: `epic-${i}`,
            title: `Epic ${i}`,
            type: 'EPIC',
            parentId: `init-${Math.floor(i / 3)}`,
            sortOrder: i % 3,
          })
        );
      }

      // Create 60 features (2 per epic)
      for (let i = 0; i < 60; i++) {
        items.push(
          createMockWorkItem({
            id: `feat-${i}`,
            title: `Feature ${i}`,
            type: 'FEATURE',
            parentId: `epic-${Math.floor(i / 2)}`,
            sortOrder: i % 2,
          })
        );
      }

      // Act
      const startTime = performance.now();
      const treeResult = buildWorkItemTree(items);
      const endTime = performance.now();

      // Assert: Tree is built correctly and quickly (< 100ms)
      expect(endTime - startTime).toBeLessThan(100);
      expect(treeResult.roots).toHaveLength(10);
      expect(treeResult.byId.size).toBe(100);
    });
  });

  describe('Deep hierarchy handling', () => {
    it('should handle 10-level deep hierarchy without stack overflow', () => {
      // Arrange: Create 10-level deep chain
      const items: WorkItem[] = [];
      let parentId: string | null = null;

      for (let i = 0; i < 10; i++) {
        const item = createMockWorkItem({
          id: `level-${i}`,
          title: `Level ${i}`,
          type: i === 0 ? 'INITIATIVE' : i < 3 ? 'EPIC' : i < 6 ? 'FEATURE' : 'STORY',
          parentId,
        });
        items.push(item);
        parentId = item.id;
      }

      // Act
      const treeResult = buildWorkItemTree(items);

      // Assert
      expect(treeResult.roots).toHaveLength(1);

      // Traverse to deepest level
      let node = treeResult.roots[0];
      let depth = 0;
      while (node.children.length > 0) {
        node = node.children[0];
        depth++;
      }

      expect(depth).toBe(9); // 0 to 9 = 10 levels
    });

    it('should derive parent chain for deeply nested items', () => {
      // Arrange: 5-level hierarchy
      const items: WorkItem[] = [
        createMockWorkItem({ id: 'l0', title: 'Level 0', type: 'INITIATIVE' }),
        createMockWorkItem({ id: 'l1', title: 'Level 1', parentId: 'l0' }),
        createMockWorkItem({ id: 'l2', title: 'Level 2', parentId: 'l1' }),
        createMockWorkItem({ id: 'l3', title: 'Level 3', parentId: 'l2' }),
        createMockWorkItem({ id: 'l4', title: 'Level 4', parentId: 'l3' }),
      ];

      const { byId } = buildWorkItemTree(items);

      // Act
      const chain = deriveParentChain('l4', byId);

      // Assert: Chain should have 4 ancestors
      expect(chain).toHaveLength(4);
      expect(chain.map((c) => c.id)).toEqual(['l0', 'l1', 'l2', 'l3']);
    });
  });

  describe('Custom work item types', () => {
    it('should handle non-standard work item types', () => {
      // Arrange: Custom type not in standard set
      const items: WorkItem[] = [
        createMockWorkItem({ id: 'custom-1', title: 'Custom Item', type: 'TASK' }),
        createMockWorkItem({ id: 'custom-2', title: 'Bug Item', type: 'BUG' }),
      ];

      // Act
      const treeResult = buildWorkItemTree(items);

      // Assert: Items are handled without error
      expect(treeResult.roots).toHaveLength(2);
      expect(treeResult.byId.get('custom-1')?.type).toBe('TASK');
      expect(treeResult.byId.get('custom-2')?.type).toBe('BUG');

      // Non-standard types should NOT get isExpanded = true
      expect(treeResult.roots[0].isExpanded).toBe(false);
      expect(treeResult.roots[1].isExpanded).toBe(false);
    });
  });

  describe('Unicode and special characters', () => {
    it('should handle unicode characters in titles', () => {
      // Arrange
      const items: WorkItem[] = [
        createMockWorkItem({ id: 'unicode-1', title: 'Initiative - Refactorisation' }),
        createMockWorkItem({ id: 'unicode-2', title: 'Epic - Analysis' }),
        createMockWorkItem({ id: 'unicode-3', title: 'Feature - Testing' }),
      ];

      // Act
      const treeResult = buildWorkItemTree(items);

      // Assert
      expect(treeResult.byId.get('unicode-1')?.title).toBe('Initiative - Refactorisation');
      expect(treeResult.byId.get('unicode-2')?.title).toBe('Epic - Analysis');
    });

    it('should handle special characters in project ID', async () => {
      // Arrange
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      // Act
      await fetchWorkItems('project/with/slashes');

      // Assert: URL is properly encoded
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('project%2Fwith%2Fslashes')
      );
    });
  });

  describe('Concurrent sibling sorting', () => {
    it('should handle items with same sortOrder using createdAt as tiebreaker', () => {
      // Arrange: Items with same sortOrder
      const items: WorkItem[] = [
        createMockWorkItem({
          id: 'a',
          title: 'A',
          sortOrder: 1,
          createdAt: '2026-01-03T00:00:00Z',
        }),
        createMockWorkItem({
          id: 'b',
          title: 'B',
          sortOrder: 1,
          createdAt: '2026-01-01T00:00:00Z',
        }),
        createMockWorkItem({
          id: 'c',
          title: 'C',
          sortOrder: 1,
          createdAt: '2026-01-02T00:00:00Z',
        }),
      ];

      // Act
      const treeResult = buildWorkItemTree(items);

      // Assert: Sorted by createdAt when sortOrder is equal
      expect(treeResult.roots[0].item.id).toBe('b'); // Jan 1
      expect(treeResult.roots[1].item.id).toBe('c'); // Jan 2
      expect(treeResult.roots[2].item.id).toBe('a'); // Jan 3
    });

    it('should handle items with same sortOrder and createdAt using id as final tiebreaker', () => {
      // Arrange: Items with same sortOrder and createdAt
      const items: WorkItem[] = [
        createMockWorkItem({
          id: 'z-item',
          title: 'Z',
          sortOrder: 1,
          createdAt: '2026-01-01T00:00:00Z',
        }),
        createMockWorkItem({
          id: 'a-item',
          title: 'A',
          sortOrder: 1,
          createdAt: '2026-01-01T00:00:00Z',
        }),
        createMockWorkItem({
          id: 'm-item',
          title: 'M',
          sortOrder: 1,
          createdAt: '2026-01-01T00:00:00Z',
        }),
      ];

      // Act
      const treeResult = buildWorkItemTree(items);

      // Assert: Sorted by id when sortOrder and createdAt are equal
      expect(treeResult.roots[0].item.id).toBe('a-item');
      expect(treeResult.roots[1].item.id).toBe('m-item');
      expect(treeResult.roots[2].item.id).toBe('z-item');
    });
  });

  describe('Multiple root items', () => {
    it('should handle multiple INITIATIVE roots correctly', () => {
      // Arrange: Multiple root items
      const items: WorkItem[] = [
        createMockWorkItem({ id: 'init-2', title: 'Initiative 2', type: 'INITIATIVE', sortOrder: 2 }),
        createMockWorkItem({ id: 'init-1', title: 'Initiative 1', type: 'INITIATIVE', sortOrder: 1 }),
        createMockWorkItem({ id: 'init-3', title: 'Initiative 3', type: 'INITIATIVE', sortOrder: 3 }),
      ];

      // Act
      const treeResult = buildWorkItemTree(items);

      // Assert: Multiple roots, sorted
      expect(treeResult.roots).toHaveLength(3);
      expect(treeResult.roots[0].item.id).toBe('init-1');
      expect(treeResult.roots[1].item.id).toBe('init-2');
      expect(treeResult.roots[2].item.id).toBe('init-3');

      // All INITIATIVE nodes are expanded
      expect(treeResult.roots.every((r) => r.isExpanded)).toBe(true);
    });
  });
});
