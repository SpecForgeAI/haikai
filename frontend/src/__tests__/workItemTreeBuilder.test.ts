/**
 * Work Item Tree Builder Tests
 *
 * Spec 2026-01-03: Product Backlog Tree View (Stage 4)
 * Task Group 2: Tests for tree builder functions
 */

import { describe, it, expect } from 'vitest';
import { buildWorkItemTree, deriveParentChain } from '../utils/workItemTreeBuilder';
import type { WorkItem } from '../types/workItems';

/**
 * Helper function to create a mock work item with defaults
 */
function createWorkItem(overrides: Partial<WorkItem> & { id: string; title: string }): WorkItem {
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

describe('workItemTreeBuilder', () => {
  describe('buildWorkItemTree', () => {
    it('should correctly group items by parentId', () => {
      // Arrange: Items with parent-child relationships
      const items: WorkItem[] = [
        createWorkItem({ id: 'init-1', title: 'Initiative 1', type: 'INITIATIVE' }),
        createWorkItem({ id: 'epic-1', title: 'Epic 1', type: 'EPIC', parentId: 'init-1' }),
        createWorkItem({ id: 'epic-2', title: 'Epic 2', type: 'EPIC', parentId: 'init-1' }),
        createWorkItem({ id: 'feat-1', title: 'Feature 1', type: 'FEATURE', parentId: 'epic-1' }),
      ];

      // Act
      const result = buildWorkItemTree(items);

      // Assert: Check structure
      expect(result.roots).toHaveLength(1);
      expect(result.roots[0].item.id).toBe('init-1');
      expect(result.roots[0].children).toHaveLength(2);
      expect(result.roots[0].children[0].children).toHaveLength(1);
      expect(result.roots[0].children[0].children[0].item.id).toBe('feat-1');
    });

    it('should sort siblings by sortOrder, createdAt, and id (fallback chain)', () => {
      // Arrange: Items with different sort orders and timestamps
      const items: WorkItem[] = [
        createWorkItem({ id: 'b', title: 'B', sortOrder: 2, createdAt: '2026-01-01T00:00:00Z' }),
        createWorkItem({ id: 'c', title: 'C', sortOrder: 1, createdAt: '2026-01-01T00:00:00Z' }),
        createWorkItem({ id: 'a', title: 'A', sortOrder: 1, createdAt: '2026-01-01T00:00:00Z' }),
        createWorkItem({ id: 'd', title: 'D', sortOrder: 1, createdAt: '2025-12-01T00:00:00Z' }),
      ];

      // Act
      const result = buildWorkItemTree(items);

      // Assert: Should be sorted by sortOrder first, then createdAt, then id
      // d (sortOrder:1, createdAt:2025-12) -> a (sortOrder:1, createdAt:2026-01, id:a) -> c (sortOrder:1, createdAt:2026-01, id:c) -> b (sortOrder:2)
      expect(result.roots[0].item.id).toBe('d');
      expect(result.roots[1].item.id).toBe('a');
      expect(result.roots[2].item.id).toBe('c');
      expect(result.roots[3].item.id).toBe('b');
    });

    it('should treat items with null parentId as roots', () => {
      // Arrange
      const items: WorkItem[] = [
        createWorkItem({ id: 'root-1', title: 'Root 1', parentId: null }),
        createWorkItem({ id: 'root-2', title: 'Root 2', parentId: null }),
        createWorkItem({ id: 'child-1', title: 'Child 1', parentId: 'root-1' }),
      ];

      // Act
      const result = buildWorkItemTree(items);

      // Assert
      expect(result.roots).toHaveLength(2);
      const rootIds = result.roots.map((r) => r.item.id);
      expect(rootIds).toContain('root-1');
      expect(rootIds).toContain('root-2');
    });

    it('should treat items with missing/invalid parent as roots (orphan handling)', () => {
      // Arrange: Item with parentId that doesn't exist in the list
      const items: WorkItem[] = [
        createWorkItem({ id: 'orphan-1', title: 'Orphan 1', parentId: 'non-existent' }),
        createWorkItem({ id: 'root-1', title: 'Root 1', parentId: null }),
      ];

      // Act
      const result = buildWorkItemTree(items);

      // Assert: Orphan should be treated as root
      expect(result.roots).toHaveLength(2);
      const rootIds = result.roots.map((r) => r.item.id);
      expect(rootIds).toContain('orphan-1');
      expect(rootIds).toContain('root-1');
    });

    it('should set depth correctly for nested items', () => {
      // Arrange: 4-level deep hierarchy
      const items: WorkItem[] = [
        createWorkItem({ id: 'init', title: 'Initiative', type: 'INITIATIVE' }),
        createWorkItem({ id: 'epic', title: 'Epic', type: 'EPIC', parentId: 'init' }),
        createWorkItem({ id: 'feat', title: 'Feature', type: 'FEATURE', parentId: 'epic' }),
        createWorkItem({ id: 'story', title: 'Story', type: 'STORY', parentId: 'feat' }),
      ];

      // Act
      const result = buildWorkItemTree(items);

      // Assert: Check depths
      expect(result.roots[0].depth).toBe(0);
      expect(result.roots[0].children[0].depth).toBe(1);
      expect(result.roots[0].children[0].children[0].depth).toBe(2);
      expect(result.roots[0].children[0].children[0].children[0].depth).toBe(3);
    });

    it('should set isExpanded true for INITIATIVE nodes, false for others', () => {
      // Arrange
      const items: WorkItem[] = [
        createWorkItem({ id: 'init', title: 'Initiative', type: 'INITIATIVE' }),
        createWorkItem({ id: 'epic', title: 'Epic', type: 'EPIC', parentId: 'init' }),
        createWorkItem({ id: 'feat', title: 'Feature', type: 'FEATURE', parentId: 'epic' }),
      ];

      // Act
      const result = buildWorkItemTree(items);

      // Assert
      expect(result.roots[0].isExpanded).toBe(true); // INITIATIVE
      expect(result.roots[0].children[0].isExpanded).toBe(false); // EPIC
      expect(result.roots[0].children[0].children[0].isExpanded).toBe(false); // FEATURE
    });

    it('should build byId and childrenByParent maps correctly', () => {
      // Arrange
      const items: WorkItem[] = [
        createWorkItem({ id: 'root', title: 'Root', type: 'INITIATIVE' }),
        createWorkItem({ id: 'child-1', title: 'Child 1', parentId: 'root' }),
        createWorkItem({ id: 'child-2', title: 'Child 2', parentId: 'root' }),
      ];

      // Act
      const result = buildWorkItemTree(items);

      // Assert: byId map
      expect(result.byId.size).toBe(3);
      expect(result.byId.get('root')).toBeDefined();
      expect(result.byId.get('child-1')).toBeDefined();

      // Assert: childrenByParent map
      expect(result.childrenByParent.get('root')).toHaveLength(2);
      expect(result.childrenByParent.get(null)).toHaveLength(1);
    });
  });

  describe('deriveParentChain', () => {
    it('should walk up to root correctly', () => {
      // Arrange: 3-level hierarchy
      const items: WorkItem[] = [
        createWorkItem({ id: 'init', title: 'Initiative', type: 'INITIATIVE' }),
        createWorkItem({ id: 'epic', title: 'Epic', type: 'EPIC', parentId: 'init' }),
        createWorkItem({ id: 'feat', title: 'Feature', type: 'FEATURE', parentId: 'epic' }),
      ];

      const { byId } = buildWorkItemTree(items);

      // Act: Get parent chain for feature
      const chain = deriveParentChain('feat', byId);

      // Assert: Chain should be [Initiative, Epic]
      expect(chain).toHaveLength(2);
      expect(chain[0].id).toBe('init');
      expect(chain[1].id).toBe('epic');
    });

    it('should handle circular reference gracefully', () => {
      // Arrange: Create a circular reference manually
      const itemA = createWorkItem({ id: 'a', title: 'A', parentId: 'b' });
      const itemB = createWorkItem({ id: 'b', title: 'B', parentId: 'a' });

      const byId = new Map<string, WorkItem>();
      byId.set('a', itemA);
      byId.set('b', itemB);

      // Act: Should not infinite loop
      const chainA = deriveParentChain('a', byId);
      const chainB = deriveParentChain('b', byId);

      // Assert: Should return something reasonable without crashing
      expect(chainA).toBeDefined();
      expect(chainB).toBeDefined();
      // With circular reference detection, it should stop when seeing a repeated ID
      expect(chainA.length).toBeLessThan(10); // Reasonable limit
    });

    it('should return empty array for root items', () => {
      // Arrange
      const items: WorkItem[] = [
        createWorkItem({ id: 'root', title: 'Root', parentId: null }),
      ];

      const { byId } = buildWorkItemTree(items);

      // Act
      const chain = deriveParentChain('root', byId);

      // Assert
      expect(chain).toEqual([]);
    });

    it('should return empty array for non-existent item', () => {
      // Arrange
      const items: WorkItem[] = [
        createWorkItem({ id: 'root', title: 'Root' }),
      ];

      const { byId } = buildWorkItemTree(items);

      // Act
      const chain = deriveParentChain('non-existent', byId);

      // Assert
      expect(chain).toEqual([]);
    });

    it('should stop at missing parent (orphan case)', () => {
      // Arrange: Item whose parent doesn't exist
      const orphan = createWorkItem({ id: 'orphan', title: 'Orphan', parentId: 'missing' });

      const byId = new Map<string, WorkItem>();
      byId.set('orphan', orphan);

      // Act
      const chain = deriveParentChain('orphan', byId);

      // Assert: Should be empty because parent doesn't exist
      expect(chain).toEqual([]);
    });
  });
});
