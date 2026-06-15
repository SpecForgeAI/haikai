/**
 * Product Backlog CRUD Integration Tests
 *
 * Spec 2026-01-03: Product Backlog CRUD (Stage 4 - Increment 3)
 * Task Group 5: Strategic tests for gap analysis and edge cases
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorkItem, WorkItemFormData, WorkItemCreatePayload, WorkItemUpdatePayload } from '../types/workItems';
import { STATUS_OPTIONS } from '../types/workItems';
import {
  mapWorkItemCreatePayloadToDto,
  mapWorkItemUpdatePayloadToDto,
} from '../api/workItemsApi';

// ============================================================================
// Test Data Factories
// ============================================================================

function createWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'test-id',
    projectId: 'test-project',
    type: 'FEATURE',
    parentId: 'parent-id',
    title: 'Test Item',
    description: null,
    status: 'PLANNED',
    sortOrder: 1,
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

// ============================================================================
// Integration Tests
// ============================================================================

describe('Product Backlog CRUD - Integration Tests', () => {
  describe('Type Definitions and Constants', () => {
    it('should export STATUS_OPTIONS with exactly 5 values', () => {
      // PLANNED, IN_PROGRESS, DEV_COMPLETE, COMPLETED, CANCELLED
      expect(STATUS_OPTIONS).toHaveLength(5);
      expect(STATUS_OPTIONS[0]).toBe('PLANNED');
      expect(STATUS_OPTIONS[3]).toBe('COMPLETED');
      expect(STATUS_OPTIONS[4]).toBe('CANCELLED');
    });

    it('should support WorkItemFormData interface', () => {
      const formData: WorkItemFormData = {
        title: 'Test Title',
        description: 'Test Description',
        status: 'PLANNED',
        priority: 1,
        targetWindow: '2026-Q1',
      };

      expect(formData.title).toBe('Test Title');
      expect(formData.priority).toBe(1);
    });

    it('should support WorkItemCreatePayload interface', () => {
      const payload: WorkItemCreatePayload = {
        type: 'FEATURE',
        parentId: 'epic-1',
        title: 'New Feature',
        sortOrder: 1,
      };

      expect(payload.type).toBe('FEATURE');
      expect(payload.parentId).toBe('epic-1');
    });

    it('should support WorkItemUpdatePayload interface', () => {
      const payload: WorkItemUpdatePayload = {
        title: 'Updated Title',
        status: 'IN_PROGRESS',
      };

      expect(payload.title).toBe('Updated Title');
      expect(payload.status).toBe('IN_PROGRESS');
    });
  });

  describe('API Payload Edge Cases', () => {
    it('should handle empty description correctly in create payload', () => {
      const payload: WorkItemCreatePayload = {
        type: 'STORY',
        parentId: 'feature-1',
        title: 'Story',
        description: '',
        sortOrder: 1,
      };

      const dto = mapWorkItemCreatePayloadToDto(payload);
      expect(dto.description).toBe('');
    });

    it('should handle zero priority correctly', () => {
      const payload: WorkItemCreatePayload = {
        type: 'FEATURE',
        parentId: 'epic-1',
        title: 'Feature',
        priority: 0,
        sortOrder: 1,
      };

      const dto = mapWorkItemCreatePayloadToDto(payload);
      expect(dto.priority).toBe(0);
    });

    it('should handle empty update payload', () => {
      const payload: WorkItemUpdatePayload = {};
      const dto = mapWorkItemUpdatePayloadToDto(payload);
      expect(Object.keys(dto)).toHaveLength(0);
    });
  });

  describe('Modal Button Visibility Logic', () => {
    const getButtonVisibility = (type: string) => {
      const itemType = type.toUpperCase();
      return {
        showAddFeature: itemType === 'EPIC',
        showAddStory: itemType === 'FEATURE',
        showEdit: itemType === 'FEATURE' || itemType === 'STORY',
        showDelete: itemType === 'FEATURE' || itemType === 'STORY',
      };
    };

    it('should compute correct visibility for all item types', () => {
      const types = ['INITIATIVE', 'EPIC', 'FEATURE', 'STORY'];
      const expected = [
        { showAddFeature: false, showAddStory: false, showEdit: false, showDelete: false },
        { showAddFeature: true, showAddStory: false, showEdit: false, showDelete: false },
        { showAddFeature: false, showAddStory: true, showEdit: true, showDelete: true },
        { showAddFeature: false, showAddStory: false, showEdit: true, showDelete: true },
      ];

      types.forEach((type, index) => {
        expect(getButtonVisibility(type)).toEqual(expected[index]);
      });
    });

    it('should handle case-insensitive type comparison', () => {
      expect(getButtonVisibility('epic')).toEqual(getButtonVisibility('EPIC'));
      expect(getButtonVisibility('Feature')).toEqual(getButtonVisibility('FEATURE'));
    });
  });

  describe('Descendant Counting Logic', () => {
    const buildTestTree = () => {
      const items: WorkItem[] = [
        createWorkItem({ id: 'init-1', type: 'INITIATIVE', parentId: null }),
        createWorkItem({ id: 'epic-1', type: 'EPIC', parentId: 'init-1' }),
        createWorkItem({ id: 'epic-2', type: 'EPIC', parentId: 'init-1' }),
        createWorkItem({ id: 'feature-1', type: 'FEATURE', parentId: 'epic-1' }),
        createWorkItem({ id: 'feature-2', type: 'FEATURE', parentId: 'epic-1' }),
        createWorkItem({ id: 'story-1', type: 'STORY', parentId: 'feature-1' }),
        createWorkItem({ id: 'story-2', type: 'STORY', parentId: 'feature-1' }),
        createWorkItem({ id: 'story-3', type: 'STORY', parentId: 'feature-2' }),
      ];

      const childrenByParent = new Map<string | null, WorkItem[]>();
      for (const item of items) {
        const existing = childrenByParent.get(item.parentId) || [];
        existing.push(item);
        childrenByParent.set(item.parentId, existing);
      }

      return { items, childrenByParent };
    };

    const countDescendants = (
      itemId: string,
      childrenByParent: Map<string | null, WorkItem[]>
    ): number => {
      const directChildren = childrenByParent.get(itemId) || [];
      let count = directChildren.length;
      for (const child of directChildren) {
        count += countDescendants(child.id, childrenByParent);
      }
      return count;
    };

    it('should count deep hierarchy correctly', () => {
      const { childrenByParent } = buildTestTree();

      // initiative -> 2 epics + 2 features + 3 stories = 7
      expect(countDescendants('init-1', childrenByParent)).toBe(7);

      // epic-1 -> 2 features + 3 stories = 5
      expect(countDescendants('epic-1', childrenByParent)).toBe(5);

      // feature-1 -> 2 stories
      expect(countDescendants('feature-1', childrenByParent)).toBe(2);
    });
  });

  describe('SortOrder Computation Logic', () => {
    const computeSortOrder = (siblings: WorkItem[]): number => {
      if (siblings.length === 0) return 1;
      return Math.max(...siblings.map((s) => s.sortOrder)) + 1;
    };

    it('should return 1 for empty siblings array', () => {
      expect(computeSortOrder([])).toBe(1);
    });

    it('should compute next sortOrder from max + 1', () => {
      const siblings = [
        createWorkItem({ id: 'a', sortOrder: 1 }),
        createWorkItem({ id: 'b', sortOrder: 10 }),
        createWorkItem({ id: 'c', sortOrder: 5 }),
      ];

      expect(computeSortOrder(siblings)).toBe(11);
    });

    it('should handle negative sortOrder values', () => {
      const siblings = [
        createWorkItem({ id: 'a', sortOrder: -5 }),
        createWorkItem({ id: 'b', sortOrder: -1 }),
      ];

      expect(computeSortOrder(siblings)).toBe(0);
    });
  });

  describe('Form Validation Logic', () => {
    const validateTitle = (title: string): string | null => {
      if (!title.trim()) {
        return 'Title is required';
      }
      return null;
    };

    it('should reject empty title', () => {
      expect(validateTitle('')).toBe('Title is required');
    });

    it('should reject whitespace-only title', () => {
      expect(validateTitle('   ')).toBe('Title is required');
      expect(validateTitle('\t\n')).toBe('Title is required');
    });

    it('should accept valid title', () => {
      expect(validateTitle('Valid Title')).toBeNull();
      expect(validateTitle('  Title with spaces  ')).toBeNull();
    });
  });

  describe('Optimistic UI Update Patterns', () => {
    it('should add new item to array immutably', () => {
      const original = [createWorkItem({ id: '1' }), createWorkItem({ id: '2' })];
      const newItem = createWorkItem({ id: '3' });

      const updated = [...original, newItem];

      expect(updated).toHaveLength(3);
      expect(original).toHaveLength(2); // Original unchanged
      expect(updated.find((i) => i.id === '3')).toBeDefined();
    });

    it('should update item in array immutably', () => {
      const original = [
        createWorkItem({ id: '1', title: 'Original' }),
        createWorkItem({ id: '2', title: 'Other' }),
      ];
      const updatedItem = createWorkItem({ id: '1', title: 'Updated' });

      const updated = original.map((item) => (item.id === updatedItem.id ? updatedItem : item));

      expect(updated.find((i) => i.id === '1')?.title).toBe('Updated');
      expect(original.find((i) => i.id === '1')?.title).toBe('Original');
    });

    it('should remove items from array immutably', () => {
      const original = [
        createWorkItem({ id: '1' }),
        createWorkItem({ id: '2' }),
        createWorkItem({ id: '3' }),
      ];
      const idsToRemove = new Set(['2']);

      const updated = original.filter((item) => !idsToRemove.has(item.id));

      expect(updated).toHaveLength(2);
      expect(original).toHaveLength(3); // Original unchanged
      expect(updated.find((i) => i.id === '2')).toBeUndefined();
    });
  });

  describe('Selection State After Delete', () => {
    it('should clear selection when deleted item was selected', () => {
      let selectedId: string | null = 'feature-1';
      const deletedId = 'feature-1';
      const descendantIds = ['story-1', 'story-2'];
      const idsToRemove = new Set([deletedId, ...descendantIds]);

      if (selectedId && idsToRemove.has(selectedId)) {
        selectedId = null;
      }

      expect(selectedId).toBeNull();
    });

    it('should clear selection when descendant of deleted item was selected', () => {
      let selectedId: string | null = 'story-1';
      const deletedId = 'feature-1';
      const descendantIds = ['story-1', 'story-2'];
      const idsToRemove = new Set([deletedId, ...descendantIds]);

      if (selectedId && idsToRemove.has(selectedId)) {
        selectedId = null;
      }

      expect(selectedId).toBeNull();
    });

    it('should preserve selection when unrelated item was selected', () => {
      let selectedId: string | null = 'epic-1';
      const deletedId = 'feature-1';
      const descendantIds = ['story-1', 'story-2'];
      const idsToRemove = new Set([deletedId, ...descendantIds]);

      if (selectedId && idsToRemove.has(selectedId)) {
        selectedId = null;
      }

      expect(selectedId).toBe('epic-1');
    });
  });
});
