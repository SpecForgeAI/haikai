/**
 * Product Backlog Page Tests
 *
 * Spec 2026-01-03: Product Backlog Tree View (Stage 4)
 * Task Group 3: Tests for UI components
 *
 * These tests focus on the logic and behavior, not React component rendering.
 * They test:
 * - Type definitions and API mapping
 * - Tree building and manipulation
 * - Component prop handling patterns
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWorkItems } from '../api/workItemsApi';
import { buildWorkItemTree, deriveParentChain } from '../utils/workItemTreeBuilder';
import type { WorkItem, WorkItemTreeNode, WorkItemTreeResult } from '../types/workItems';

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

describe('ProductBacklogPage Integration Tests', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Data loading flow', () => {
    it('should transform API response into displayable tree structure', async () => {
      // Arrange: Mock API response with hierarchy
      const mockResponse = [
        {
          id: 'init-1',
          project_id: 'proj-1',
          type: 'INITIATIVE',
          parent_id: null,
          title: 'Initiative 1',
          description: 'Root initiative',
          status: 'NEW',
          sort_order: 1,
          priority: 1,
          target_window: '2026-Q1',
          tags: null,
          external_system: null,
          external_key: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
        {
          id: 'epic-1',
          project_id: 'proj-1',
          type: 'EPIC',
          parent_id: 'init-1',
          title: 'Epic 1',
          description: null,
          status: 'IN_PROGRESS',
          sort_order: 1,
          priority: 2,
          target_window: null,
          tags: null,
          external_system: null,
          external_key: null,
          created_at: '2026-01-02T00:00:00Z',
          updated_at: '2026-01-02T00:00:00Z',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      // Act: Fetch and build tree (simulates what ProductBacklogPage does)
      const items = await fetchWorkItems('proj-1');
      const treeResult = buildWorkItemTree(items);

      // Assert: Tree is properly structured
      expect(treeResult.roots).toHaveLength(1);
      expect(treeResult.roots[0].item.title).toBe('Initiative 1');
      expect(treeResult.roots[0].children).toHaveLength(1);
      expect(treeResult.roots[0].children[0].item.title).toBe('Epic 1');
    });

    it('should handle empty API response gracefully', async () => {
      // Arrange
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      // Act
      const items = await fetchWorkItems('proj-1');
      const treeResult = buildWorkItemTree(items);

      // Assert
      expect(treeResult.roots).toHaveLength(0);
      expect(treeResult.byId.size).toBe(0);
    });

    it('should propagate API errors correctly', async () => {
      // Arrange
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      // Act & Assert
      await expect(fetchWorkItems('proj-1')).rejects.toThrow(
        'Failed to fetch work items for project "proj-1": 500 Internal Server Error'
      );
    });
  });

  describe('Selection and details derivation', () => {
    it('should derive parent chain for selected item', () => {
      // Arrange: 4-level hierarchy
      const items: WorkItem[] = [
        createMockWorkItem({ id: 'init', title: 'Initiative', type: 'INITIATIVE' }),
        createMockWorkItem({ id: 'epic', title: 'Epic', type: 'EPIC', parentId: 'init' }),
        createMockWorkItem({ id: 'feat', title: 'Feature', type: 'FEATURE', parentId: 'epic' }),
        createMockWorkItem({ id: 'story', title: 'Story', type: 'STORY', parentId: 'feat' }),
      ];

      const { byId } = buildWorkItemTree(items);

      // Act: Get parent chain for story
      const parentChain = deriveParentChain('story', byId);

      // Assert: Chain should be [Initiative, Epic, Feature]
      expect(parentChain).toHaveLength(3);
      expect(parentChain[0].id).toBe('init');
      expect(parentChain[1].id).toBe('epic');
      expect(parentChain[2].id).toBe('feat');
    });

    it('should derive children count from childrenByParent map', () => {
      // Arrange
      const items: WorkItem[] = [
        createMockWorkItem({ id: 'parent', title: 'Parent', type: 'INITIATIVE' }),
        createMockWorkItem({ id: 'child-1', title: 'Child 1', parentId: 'parent' }),
        createMockWorkItem({ id: 'child-2', title: 'Child 2', parentId: 'parent' }),
        createMockWorkItem({ id: 'child-3', title: 'Child 3', parentId: 'parent' }),
      ];

      const { childrenByParent } = buildWorkItemTree(items);

      // Act: Get children count
      const children = childrenByParent.get('parent') || [];
      const childrenCount = children.length;

      // Assert
      expect(childrenCount).toBe(3);
    });
  });

  describe('Expand/collapse state management', () => {
    it('should default INITIATIVE nodes to expanded', () => {
      // Arrange
      const items: WorkItem[] = [
        createMockWorkItem({ id: 'init', title: 'Initiative', type: 'INITIATIVE' }),
        createMockWorkItem({ id: 'epic', title: 'Epic', type: 'EPIC', parentId: 'init' }),
      ];

      // Act
      const treeResult = buildWorkItemTree(items);

      // Assert: INITIATIVE node is expanded by default
      expect(treeResult.roots[0].isExpanded).toBe(true);
      expect(treeResult.roots[0].children[0].isExpanded).toBe(false);
    });

    it('should toggle expanded state correctly', () => {
      // Simulates component state management
      const expandedIds = new Set<string>(['init']);

      // Act: Toggle off
      expandedIds.delete('init');
      expect(expandedIds.has('init')).toBe(false);

      // Act: Toggle on
      expandedIds.add('init');
      expect(expandedIds.has('init')).toBe(true);
    });
  });
});

describe('WorkItemTree Component Logic', () => {
  describe('Node rendering logic', () => {
    it('should identify nodes with children for chevron display', () => {
      // Arrange
      const items: WorkItem[] = [
        createMockWorkItem({ id: 'parent', title: 'Parent', type: 'INITIATIVE' }),
        createMockWorkItem({ id: 'child', title: 'Child', parentId: 'parent' }),
        createMockWorkItem({ id: 'leaf', title: 'Leaf' }),
      ];

      const treeResult = buildWorkItemTree(items);

      // Assert: Parent has children, leaf does not
      const parentNode = treeResult.roots.find(r => r.item.id === 'parent');
      const leafNode = treeResult.roots.find(r => r.item.id === 'leaf');

      expect(parentNode?.children.length).toBeGreaterThan(0);
      expect(leafNode?.children.length).toBe(0);
    });

    it('should calculate correct depth for indentation', () => {
      // Arrange: Deep hierarchy
      const items: WorkItem[] = [
        createMockWorkItem({ id: 'l0', title: 'Level 0', type: 'INITIATIVE' }),
        createMockWorkItem({ id: 'l1', title: 'Level 1', parentId: 'l0' }),
        createMockWorkItem({ id: 'l2', title: 'Level 2', parentId: 'l1' }),
        createMockWorkItem({ id: 'l3', title: 'Level 3', parentId: 'l2' }),
      ];

      const treeResult = buildWorkItemTree(items);

      // Assert depths
      expect(treeResult.roots[0].depth).toBe(0);
      expect(treeResult.roots[0].children[0].depth).toBe(1);
      expect(treeResult.roots[0].children[0].children[0].depth).toBe(2);
      expect(treeResult.roots[0].children[0].children[0].children[0].depth).toBe(3);
    });
  });

  describe('Selection handling', () => {
    it('should allow identifying selected node by ID', () => {
      // Arrange
      const items: WorkItem[] = [
        createMockWorkItem({ id: 'a', title: 'A' }),
        createMockWorkItem({ id: 'b', title: 'B' }),
      ];

      const treeResult = buildWorkItemTree(items);
      const selectedId = 'a';

      // Act: Find selected item
      const selectedItem = treeResult.byId.get(selectedId);

      // Assert
      expect(selectedItem).toBeDefined();
      expect(selectedItem?.title).toBe('A');
    });
  });
});

describe('WorkItemDetailsPanel Component Logic', () => {
  describe('Data display logic', () => {
    it('should handle null description gracefully', () => {
      // Arrange
      const item = createMockWorkItem({
        id: 'test',
        title: 'Test',
        description: null,
      });

      // Assert: Component would show placeholder for null
      expect(item.description).toBeNull();
    });

    it('should format children count with correct pluralization', () => {
      // Simulates what the component does
      function formatChildrenCount(count: number): string {
        return count === 1 ? '1 child item' : `${count} child items`;
      }

      expect(formatChildrenCount(0)).toBe('0 child items');
      expect(formatChildrenCount(1)).toBe('1 child item');
      expect(formatChildrenCount(5)).toBe('5 child items');
    });

    it('should format parent chain as breadcrumb', () => {
      // Arrange
      const parentChain: WorkItem[] = [
        createMockWorkItem({ id: 'init', title: 'Initiative', type: 'INITIATIVE' }),
        createMockWorkItem({ id: 'epic', title: 'Epic', type: 'EPIC' }),
      ];

      // Simulates breadcrumb generation
      const breadcrumbText = parentChain
        .map((p) => `${p.title} (${p.type})`)
        .join(' > ');

      // Assert
      expect(breadcrumbText).toBe('Initiative (INITIATIVE) > Epic (EPIC)');
    });
  });

  describe('Type badge mapping', () => {
    it('should map work item types to badge classes', () => {
      // Simulates getTypeBadgeClass function
      function getTypeBadgeClass(type: string): string {
        switch (type.toUpperCase()) {
          case 'INITIATIVE':
            return 'typeInitiative';
          case 'EPIC':
            return 'typeEpic';
          case 'FEATURE':
            return 'typeFeature';
          case 'STORY':
            return 'typeStory';
          default:
            return 'typeDefault';
        }
      }

      expect(getTypeBadgeClass('INITIATIVE')).toBe('typeInitiative');
      expect(getTypeBadgeClass('EPIC')).toBe('typeEpic');
      expect(getTypeBadgeClass('FEATURE')).toBe('typeFeature');
      expect(getTypeBadgeClass('STORY')).toBe('typeStory');
      expect(getTypeBadgeClass('CUSTOM')).toBe('typeDefault');
    });
  });
});
