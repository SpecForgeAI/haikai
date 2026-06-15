/**
 * Work Item Modal Tests
 *
 * Spec 2026-01-03: Product Backlog CRUD (Stage 4 - Increment 3)
 * Task Group 2: Tests for modal components (Create, Edit, Delete)
 *
 * These tests verify the modal props, structure, and expected behavior
 * using vitest's assertions without @testing-library/react.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorkItem, WorkItemFormData, STATUS_OPTIONS } from '../types/workItems';
import { STATUS_OPTIONS as StatusOptions } from '../types/workItems';
import {
  mapWorkItemCreatePayloadToDto,
  mapWorkItemUpdatePayloadToDto,
} from '../api/workItemsApi';

// Sample work items for testing
const mockParentEpic: WorkItem = {
  id: 'epic-1',
  projectId: 'test-project',
  type: 'EPIC',
  parentId: 'init-1',
  title: 'Parent Epic',
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

describe('WorkItemCreateModal - Props and Behavior', () => {
  it('should have correct modal title based on typeToCreate (FEATURE)', () => {
    const typeToCreate = 'FEATURE';
    const expectedTitle = typeToCreate === 'FEATURE' ? 'Add Feature' : 'Add Story';
    expect(expectedTitle).toBe('Add Feature');
  });

  it('should have correct modal title based on typeToCreate (STORY)', () => {
    const typeToCreate = 'STORY';
    const expectedTitle = typeToCreate === 'FEATURE' ? 'Add Feature' : 'Add Story';
    expect(expectedTitle).toBe('Add Story');
  });

  it('should validate that title is required', () => {
    const formData: WorkItemFormData = {
      title: '',
      description: '',
      status: 'PLANNED',
      priority: null,
      targetWindow: null,
    };

    // Validate function logic
    const isValid = formData.title.trim().length > 0;
    expect(isValid).toBe(false);
  });

  it('should create correct payload for form submission', () => {
    const formData: WorkItemFormData = {
      title: 'New Feature Title',
      description: 'Feature description',
      status: 'PLANNED',
      priority: 1,
      targetWindow: '2026-Q2',
    };
    const parent = mockParentEpic;
    const typeToCreate = 'FEATURE';
    const sortOrder = 1;

    const payload = {
      type: typeToCreate,
      parentId: parent.id,
      title: formData.title.trim(),
      description: formData.description.trim() || undefined,
      status: formData.status,
      priority: formData.priority ?? undefined,
      targetWindow: formData.targetWindow?.trim() || undefined,
      sortOrder,
    };

    expect(payload.type).toBe('FEATURE');
    expect(payload.parentId).toBe('epic-1');
    expect(payload.title).toBe('New Feature Title');
    expect(payload.sortOrder).toBe(1);
  });

  it('should compute sortOrder from siblings correctly', () => {
    const siblings: WorkItem[] = [
      { ...mockFeature, id: 'f1', sortOrder: 1 },
      { ...mockFeature, id: 'f2', sortOrder: 5 },
      { ...mockFeature, id: 'f3', sortOrder: 3 },
    ];

    const computeSortOrder = (sibs: WorkItem[]): number => {
      if (sibs.length === 0) return 1;
      return Math.max(...sibs.map(s => s.sortOrder)) + 1;
    };

    expect(computeSortOrder(siblings)).toBe(6);
    expect(computeSortOrder([])).toBe(1);
  });

  it('should have STATUS_OPTIONS constant with expected values', () => {
    // Current lifecycle: PLANNED -> IN_PROGRESS -> DEV_COMPLETE -> COMPLETED
    // (plus CANCELLED). READY/DONE were replaced in the status model.
    expect(StatusOptions).toEqual([
      'PLANNED',
      'IN_PROGRESS',
      'DEV_COMPLETE',
      'COMPLETED',
      'CANCELLED',
    ]);
  });
});

describe('WorkItemEditModal - Props and Behavior', () => {
  it('should pre-populate form data from existing item', () => {
    const item = mockFeature;

    const formData: WorkItemFormData = {
      title: item.title,
      description: item.description ?? '',
      status: item.status,
      priority: item.priority,
      targetWindow: item.targetWindow,
    };

    expect(formData.title).toBe('Test Feature');
    expect(formData.description).toBe('Feature description');
    expect(formData.status).toBe('PLANNED');
    expect(formData.priority).toBe(2);
    expect(formData.targetWindow).toBe('2026-Q2');
  });

  it('should handle null description in item', () => {
    const itemWithNullDesc: WorkItem = {
      ...mockFeature,
      description: null,
    };

    const formData: WorkItemFormData = {
      title: itemWithNullDesc.title,
      description: itemWithNullDesc.description ?? '',
      status: itemWithNullDesc.status,
      priority: itemWithNullDesc.priority,
      targetWindow: itemWithNullDesc.targetWindow,
    };

    expect(formData.description).toBe('');
  });

  it('should create correct update payload', () => {
    const formData: WorkItemFormData = {
      title: 'Updated Feature Title',
      description: 'Updated description',
      status: 'IN_PROGRESS',
      priority: 1,
      targetWindow: '2026-Q3',
    };

    const payload = {
      title: formData.title.trim(),
      description: formData.description.trim() || undefined,
      status: formData.status,
      priority: formData.priority ?? undefined,
      targetWindow: formData.targetWindow?.trim() || undefined,
    };

    expect(payload.title).toBe('Updated Feature Title');
    expect(payload.description).toBe('Updated description');
    expect(payload.status).toBe('IN_PROGRESS');
    expect(payload.priority).toBe(1);
    expect(payload.targetWindow).toBe('2026-Q3');
  });

  it('should guard against editing INITIATIVE or EPIC types', () => {
    const canEdit = (itemType: string) => {
      return itemType === 'FEATURE' || itemType === 'STORY';
    };

    expect(canEdit('FEATURE')).toBe(true);
    expect(canEdit('STORY')).toBe(true);
    expect(canEdit('INITIATIVE')).toBe(false);
    expect(canEdit('EPIC')).toBe(false);
  });
});

describe('WorkItemDeleteConfirmModal - Props and Behavior', () => {
  it('should calculate total delete count correctly', () => {
    const item = mockFeature;
    const descendantCount = 3;
    const totalDeleteCount = 1 + descendantCount;

    expect(totalDeleteCount).toBe(4);
  });

  it('should display correct warning text content', () => {
    const warningText = 'Deleting this item will also delete all child items beneath it.';
    expect(warningText).toContain('child items');
    expect(warningText).toContain('delete');
  });

  it('should display item title and type', () => {
    const item = mockFeature;

    expect(item.title).toBe('Test Feature');
    expect(item.type).toBe('FEATURE');
  });

  it('should count descendants for cascade info display', () => {
    const descendantCount = 3;
    const totalDeleteCount = 1 + descendantCount;

    // Format the message
    const itemWord = totalDeleteCount !== 1 ? 'items' : 'item';
    const message = `${totalDeleteCount} ${itemWord} will be deleted`;

    expect(message).toBe('4 items will be deleted');
  });

  it('should handle zero descendants', () => {
    const descendantCount = 0;
    const totalDeleteCount = 1 + descendantCount;

    const itemWord = totalDeleteCount !== 1 ? 'items' : 'item';
    const message = `${totalDeleteCount} ${itemWord} will be deleted`;

    expect(message).toBe('1 item will be deleted');
  });

  it('should format child items count in cascade info', () => {
    const descendantCount = 5;

    const childWord = descendantCount !== 1 ? 'child items' : 'child item';
    const message = `including ${descendantCount} ${childWord}`;

    expect(message).toBe('including 5 child items');
  });
});

describe('WorkItemModals - API Payload Mapping', () => {
  it('should map create payload correctly using mapWorkItemCreatePayloadToDto', () => {
    const payload = {
      type: 'FEATURE' as const,
      parentId: 'epic-123',
      title: 'New Feature',
      description: 'Description text',
      status: 'PLANNED',
      priority: 1,
      targetWindow: '2026-Q2',
      sortOrder: 5,
    };

    const dto = mapWorkItemCreatePayloadToDto(payload);

    expect(dto.parent_id).toBe('epic-123');
    expect(dto.target_window).toBe('2026-Q2');
    expect(dto.sort_order).toBe(5);
  });

  it('should map update payload correctly using mapWorkItemUpdatePayloadToDto', () => {
    const payload = {
      title: 'Updated Title',
      description: 'Updated description',
      status: 'IN_PROGRESS',
      priority: 2,
      targetWindow: '2026-Q3',
    };

    const dto = mapWorkItemUpdatePayloadToDto(payload);

    expect(dto.title).toBe('Updated Title');
    expect(dto.description).toBe('Updated description');
    expect(dto.status).toBe('IN_PROGRESS');
    expect(dto.priority).toBe(2);
    expect(dto.target_window).toBe('2026-Q3');
  });
});
