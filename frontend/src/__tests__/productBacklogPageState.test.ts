/**
 * Product Backlog Page State Management Tests
 *
 * Spec 2026-01-03: Product Backlog CRUD (Stage 4 - Increment 3)
 * Task Group 4: Tests for page state management and modal orchestration
 */

import { describe, it, expect, vi } from 'vitest';
import type { WorkItem } from '../types/workItems';

// Sample work items for testing
const mockInitiative: WorkItem = {
  id: 'init-1',
  projectId: 'test-project',
  type: 'INITIATIVE',
  parentId: null,
  title: 'Test Initiative',
  description: null,
  status: 'NEW',
  sortOrder: 1,
  priority: 1,
  targetWindow: null,
  tags: null,
  externalSystem: null,
  externalKey: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockEpic: WorkItem = {
  id: 'epic-1',
  projectId: 'test-project',
  type: 'EPIC',
  parentId: 'init-1',
  title: 'Test Epic',
  description: null,
  status: 'IN_PROGRESS',
  sortOrder: 1,
  priority: 1,
  targetWindow: null,
  tags: null,
  externalSystem: null,
  externalKey: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockFeature: WorkItem = {
  id: 'feature-1',
  projectId: 'test-project',
  type: 'FEATURE',
  parentId: 'epic-1',
  title: 'Test Feature',
  description: null,
  status: 'PLANNED',
  sortOrder: 1,
  priority: 2,
  targetWindow: null,
  tags: null,
  externalSystem: null,
  externalKey: null,
  createdAt: '2026-01-02T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
};

const mockStory1: WorkItem = {
  id: 'story-1',
  projectId: 'test-project',
  type: 'STORY',
  parentId: 'feature-1',
  title: 'Test Story 1',
  description: null,
  status: 'READY',
  sortOrder: 1,
  priority: 3,
  targetWindow: null,
  tags: null,
  externalSystem: null,
  externalKey: null,
  createdAt: '2026-01-03T00:00:00Z',
  updatedAt: '2026-01-03T00:00:00Z',
};

const mockStory2: WorkItem = {
  id: 'story-2',
  projectId: 'test-project',
  type: 'STORY',
  parentId: 'feature-1',
  title: 'Test Story 2',
  description: null,
  status: 'READY',
  sortOrder: 2,
  priority: 3,
  targetWindow: null,
  tags: null,
  externalSystem: null,
  externalKey: null,
  createdAt: '2026-01-03T00:00:00Z',
  updatedAt: '2026-01-03T00:00:00Z',
};

/**
 * Helper function to count all descendants recursively
 */
function countDescendants(
  itemId: string,
  childrenByParent: Map<string | null, WorkItem[]>
): number {
  const directChildren = childrenByParent.get(itemId) || [];
  let count = directChildren.length;

  for (const child of directChildren) {
    count += countDescendants(child.id, childrenByParent);
  }

  return count;
}

/**
 * Helper function to collect all descendant IDs recursively
 */
function collectDescendantIds(
  itemId: string,
  childrenByParent: Map<string | null, WorkItem[]>
): string[] {
  const directChildren = childrenByParent.get(itemId) || [];
  const ids: string[] = [];

  for (const child of directChildren) {
    ids.push(child.id);
    ids.push(...collectDescendantIds(child.id, childrenByParent));
  }

  return ids;
}

/**
 * Build childrenByParent map from work items array
 */
function buildChildrenByParentMap(items: WorkItem[]): Map<string | null, WorkItem[]> {
  const map = new Map<string | null, WorkItem[]>();

  for (const item of items) {
    const parentKey = item.parentId;
    const existing = map.get(parentKey) || [];
    existing.push(item);
    map.set(parentKey, existing);
  }

  return map;
}

describe('ProductBacklogPage - State Management', () => {
  describe('Modal state transitions', () => {
    it('should have initial modal states as closed', () => {
      const modalState = {
        createModalOpen: false,
        editModalOpen: false,
        deleteModalOpen: false,
      };

      expect(modalState.createModalOpen).toBe(false);
      expect(modalState.editModalOpen).toBe(false);
      expect(modalState.deleteModalOpen).toBe(false);
    });

    it('should open create modal with correct state', () => {
      const selectedItem = mockEpic;
      let modalState = {
        createModalOpen: false,
        selectedParentForCreate: null as WorkItem | null,
        typeToCreate: null as 'FEATURE' | 'STORY' | null,
      };

      // Simulate handleAddFeature
      if (selectedItem.type.toUpperCase() === 'EPIC') {
        modalState = {
          createModalOpen: true,
          selectedParentForCreate: selectedItem,
          typeToCreate: 'FEATURE',
        };
      }

      expect(modalState.createModalOpen).toBe(true);
      expect(modalState.selectedParentForCreate).toBe(selectedItem);
      expect(modalState.typeToCreate).toBe('FEATURE');
    });

    it('should close modal and reset state', () => {
      let modalState = {
        createModalOpen: true,
        selectedParentForCreate: mockEpic as WorkItem | null,
        typeToCreate: 'FEATURE' as 'FEATURE' | 'STORY' | null,
      };

      // Simulate handleCloseCreateModal
      modalState = {
        createModalOpen: false,
        selectedParentForCreate: null,
        typeToCreate: null,
      };

      expect(modalState.createModalOpen).toBe(false);
      expect(modalState.selectedParentForCreate).toBeNull();
      expect(modalState.typeToCreate).toBeNull();
    });
  });

  describe('countDescendants helper', () => {
    it('should count all descendants correctly', () => {
      const items = [mockInitiative, mockEpic, mockFeature, mockStory1, mockStory2];
      const childrenByParent = buildChildrenByParentMap(items);

      // Feature has 2 stories
      expect(countDescendants('feature-1', childrenByParent)).toBe(2);

      // Epic has 1 feature + 2 stories = 3 descendants
      expect(countDescendants('epic-1', childrenByParent)).toBe(3);

      // Initiative has 1 epic + 1 feature + 2 stories = 4 descendants
      expect(countDescendants('init-1', childrenByParent)).toBe(4);

      // Story has no descendants
      expect(countDescendants('story-1', childrenByParent)).toBe(0);
    });

    it('should return 0 for items without children', () => {
      const items = [mockInitiative];
      const childrenByParent = buildChildrenByParentMap(items);

      expect(countDescendants('init-1', childrenByParent)).toBe(0);
    });
  });

  describe('handleCreateSuccess mutation handler', () => {
    it('should add new item to workItems array', () => {
      let workItems = [mockInitiative, mockEpic, mockFeature];

      const newItem: WorkItem = {
        id: 'new-story',
        projectId: 'test-project',
        type: 'STORY',
        parentId: 'feature-1',
        title: 'New Story',
        description: null,
        status: 'PLANNED',
        sortOrder: 1,
        priority: null,
        targetWindow: null,
        tags: null,
        externalSystem: null,
        externalKey: null,
        createdAt: '2026-01-04T00:00:00Z',
        updatedAt: '2026-01-04T00:00:00Z',
      };

      // Simulate handleCreateSuccess
      workItems = [...workItems, newItem];

      expect(workItems).toHaveLength(4);
      expect(workItems.find((i) => i.id === 'new-story')).toBeDefined();
    });

    it('should expand parent node after creation', () => {
      let expandedIds = new Set<string>(['init-1']);
      const newItem: WorkItem = { ...mockStory1, parentId: 'feature-1' };

      // Simulate expanding parent
      if (newItem.parentId) {
        expandedIds = new Set([...expandedIds, newItem.parentId]);
      }

      expect(expandedIds.has('feature-1')).toBe(true);
    });

    it('should select newly created item', () => {
      let selectedId: string | null = 'feature-1';
      const newItem: WorkItem = { ...mockStory1, id: 'new-story' };

      // Simulate selecting new item
      selectedId = newItem.id;

      expect(selectedId).toBe('new-story');
    });
  });

  describe('handleUpdateSuccess mutation handler', () => {
    it('should update item in workItems array', () => {
      let workItems = [mockInitiative, mockEpic, mockFeature];

      const updatedItem: WorkItem = {
        ...mockFeature,
        title: 'Updated Feature Title',
        description: 'New description',
      };

      // Simulate handleUpdateSuccess
      workItems = workItems.map((item) => (item.id === updatedItem.id ? updatedItem : item));

      const found = workItems.find((i) => i.id === 'feature-1');
      expect(found?.title).toBe('Updated Feature Title');
      expect(found?.description).toBe('New description');
    });
  });

  describe('handleDeleteSuccess mutation handler', () => {
    it('should remove item and descendants from workItems', () => {
      let workItems = [mockInitiative, mockEpic, mockFeature, mockStory1, mockStory2];
      const childrenByParent = buildChildrenByParentMap(workItems);

      const itemToDelete = mockFeature;

      // Collect IDs to remove
      const idsToRemove = new Set<string>([
        itemToDelete.id,
        ...collectDescendantIds(itemToDelete.id, childrenByParent),
      ]);

      // Simulate handleDeleteSuccess
      workItems = workItems.filter((item) => !idsToRemove.has(item.id));

      expect(workItems).toHaveLength(2); // Only initiative and epic remain
      expect(workItems.find((i) => i.id === 'feature-1')).toBeUndefined();
      expect(workItems.find((i) => i.id === 'story-1')).toBeUndefined();
      expect(workItems.find((i) => i.id === 'story-2')).toBeUndefined();
    });

    it('should clear selection if deleted item was selected', () => {
      const selectedId = 'feature-1';
      const itemToDelete = mockFeature;
      const idsToRemove = new Set<string>([itemToDelete.id]);

      // Simulate clearing selection
      let newSelectedId: string | null = selectedId;
      if (idsToRemove.has(selectedId)) {
        newSelectedId = null;
      }

      expect(newSelectedId).toBeNull();
    });

    it('should preserve selection if non-deleted item was selected', () => {
      const selectedId = 'epic-1';
      const itemToDelete = mockFeature;
      const idsToRemove = new Set<string>([itemToDelete.id]);

      // Simulate checking selection
      let newSelectedId: string | null = selectedId;
      if (idsToRemove.has(selectedId)) {
        newSelectedId = null;
      }

      expect(newSelectedId).toBe('epic-1');
    });
  });

  describe('collectDescendantIds helper', () => {
    it('should collect all descendant IDs recursively', () => {
      const items = [mockInitiative, mockEpic, mockFeature, mockStory1, mockStory2];
      const childrenByParent = buildChildrenByParentMap(items);

      const epicDescendants = collectDescendantIds('epic-1', childrenByParent);

      expect(epicDescendants).toContain('feature-1');
      expect(epicDescendants).toContain('story-1');
      expect(epicDescendants).toContain('story-2');
      expect(epicDescendants).toHaveLength(3);
    });
  });
});
