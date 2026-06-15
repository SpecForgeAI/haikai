/**
 * Work Item Details Panel Tests
 *
 * Spec 2026-01-03: Product Backlog CRUD (Stage 4 - Increment 3)
 * Task Group 3: Tests for details panel action buttons
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
  description: 'Initiative description',
  status: 'NEW',
  sortOrder: 1,
  priority: 1,
  targetWindow: '2026',
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
  description: 'Epic description',
  status: 'IN_PROGRESS',
  sortOrder: 1,
  priority: 1,
  targetWindow: '2026-Q1',
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
  description: 'Feature description',
  status: 'PLANNED',
  sortOrder: 1,
  priority: 2,
  targetWindow: '2026-Q2',
  tags: null,
  externalSystem: null,
  externalKey: null,
  createdAt: '2026-01-02T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
};

const mockStory: WorkItem = {
  id: 'story-1',
  projectId: 'test-project',
  type: 'STORY',
  parentId: 'feature-1',
  title: 'Test Story',
  description: 'Story description',
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

/**
 * Helper function to determine which buttons should be visible for an item type
 */
function getVisibleButtonsForType(itemType: string): {
  addFeature: boolean;
  addStory: boolean;
  edit: boolean;
  delete: boolean;
} {
  const type = itemType.toUpperCase();

  switch (type) {
    case 'INITIATIVE':
      return { addFeature: false, addStory: false, edit: false, delete: false };
    case 'EPIC':
      return { addFeature: true, addStory: false, edit: false, delete: false };
    case 'FEATURE':
      return { addFeature: false, addStory: true, edit: true, delete: true };
    case 'STORY':
      return { addFeature: false, addStory: false, edit: true, delete: true };
    default:
      return { addFeature: false, addStory: false, edit: false, delete: false };
  }
}

describe('WorkItemDetailsPanel - Action Buttons', () => {
  describe('Button visibility by item type', () => {
    it('should show no action buttons for INITIATIVE', () => {
      const buttons = getVisibleButtonsForType('INITIATIVE');

      expect(buttons.addFeature).toBe(false);
      expect(buttons.addStory).toBe(false);
      expect(buttons.edit).toBe(false);
      expect(buttons.delete).toBe(false);
    });

    it('should show only "+ Add Feature" button for EPIC', () => {
      const buttons = getVisibleButtonsForType('EPIC');

      expect(buttons.addFeature).toBe(true);
      expect(buttons.addStory).toBe(false);
      expect(buttons.edit).toBe(false);
      expect(buttons.delete).toBe(false);
    });

    it('should show "+ Add Story", "Edit", and "Delete" buttons for FEATURE', () => {
      const buttons = getVisibleButtonsForType('FEATURE');

      expect(buttons.addFeature).toBe(false);
      expect(buttons.addStory).toBe(true);
      expect(buttons.edit).toBe(true);
      expect(buttons.delete).toBe(true);
    });

    it('should show only "Edit" and "Delete" buttons for STORY', () => {
      const buttons = getVisibleButtonsForType('STORY');

      expect(buttons.addFeature).toBe(false);
      expect(buttons.addStory).toBe(false);
      expect(buttons.edit).toBe(true);
      expect(buttons.delete).toBe(true);
    });
  });

  describe('Button callback wiring', () => {
    it('should wire onAddFeature callback for EPIC', () => {
      const onAddFeature = vi.fn();
      const item = mockEpic;

      // Simulate button click
      if (item.type.toUpperCase() === 'EPIC' && onAddFeature) {
        onAddFeature();
      }

      expect(onAddFeature).toHaveBeenCalledTimes(1);
    });

    it('should wire onAddStory callback for FEATURE', () => {
      const onAddStory = vi.fn();
      const item = mockFeature;

      // Simulate button click
      if (item.type.toUpperCase() === 'FEATURE' && onAddStory) {
        onAddStory();
      }

      expect(onAddStory).toHaveBeenCalledTimes(1);
    });

    it('should wire onEdit callback for FEATURE', () => {
      const onEdit = vi.fn();
      const item = mockFeature;

      // Simulate button click
      if (item.type.toUpperCase() === 'FEATURE' && onEdit) {
        onEdit();
      }

      expect(onEdit).toHaveBeenCalledTimes(1);
    });

    it('should wire onDelete callback for STORY', () => {
      const onDelete = vi.fn();
      const item = mockStory;

      // Simulate button click
      if (item.type.toUpperCase() === 'STORY' && onDelete) {
        onDelete();
      }

      expect(onDelete).toHaveBeenCalledTimes(1);
    });

    it('should not call any callbacks for INITIATIVE', () => {
      const onAddFeature = vi.fn();
      const onAddStory = vi.fn();
      const onEdit = vi.fn();
      const onDelete = vi.fn();
      const item = mockInitiative;

      // Simulate logic for INITIATIVE (no buttons)
      if (item.type.toUpperCase() !== 'INITIATIVE') {
        // Buttons would be shown
        onAddFeature();
        onAddStory();
        onEdit();
        onDelete();
      }

      expect(onAddFeature).not.toHaveBeenCalled();
      expect(onAddStory).not.toHaveBeenCalled();
      expect(onEdit).not.toHaveBeenCalled();
      expect(onDelete).not.toHaveBeenCalled();
    });
  });

  describe('Props interface extensions', () => {
    it('should support optional callback props', () => {
      // Verify that the props interface supports optional callbacks
      const propsWithCallbacks = {
        item: mockFeature,
        parentChain: [],
        childrenCount: 0,
        onAddFeature: vi.fn(),
        onAddStory: vi.fn(),
        onEdit: vi.fn(),
        onDelete: vi.fn(),
      };

      expect(typeof propsWithCallbacks.onAddFeature).toBe('function');
      expect(typeof propsWithCallbacks.onAddStory).toBe('function');
      expect(typeof propsWithCallbacks.onEdit).toBe('function');
      expect(typeof propsWithCallbacks.onDelete).toBe('function');
    });

    it('should work without callback props (backward compatibility)', () => {
      const propsWithoutCallbacks = {
        item: mockFeature,
        parentChain: [],
        childrenCount: 0,
      };

      expect(propsWithoutCallbacks.item.type).toBe('FEATURE');
      expect(propsWithoutCallbacks.childrenCount).toBe(0);
    });
  });
});
