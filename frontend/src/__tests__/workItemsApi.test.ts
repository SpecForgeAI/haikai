/**
 * Work Items API Tests
 *
 * Spec 2026-01-03: Product Backlog Tree View (Stage 4)
 * Task Group 1: Tests for WorkItems API and type definitions
 *
 * Extended in Spec 2026-01-03: Product Backlog CRUD (Stage 4 - Increment 3)
 * Added tests for create, update, and delete operations
 *
 * Extended in Spec 2026-01-17: Fix Feature Edit 400 Error
 * Added tests for type field inclusion in update payload
 *
 * Extended in Spec 2026-01-18: Fix Feature Edit 400 Error - Preserve Parent
 * Added tests for parentId field inclusion in update payload
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchWorkItems,
  createWorkItem,
  updateWorkItem,
  deleteWorkItem,
  mapWorkItemCreatePayloadToDto,
  mapWorkItemUpdatePayloadToDto,
} from '../api/workItemsApi';
import type { WorkItem, WorkItemCreatePayload, WorkItemUpdatePayload } from '../types/workItems';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('workItemsApi', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchWorkItems', () => {
    it('should return expected array structure from API response', async () => {
      // Arrange: Mock API response with snake_case fields
      const mockResponse = [
        {
          id: 'wi-1',
          project_id: 'proj-1',
          type: 'INITIATIVE',
          parent_id: null,
          title: 'Initiative 1',
          description: 'Test description',
          status: 'NEW',
          sort_order: 1,
          priority: 1,
          target_window: '2026-Q1',
          tags: { key: 'value' },
          external_system: 'JIRA',
          external_key: 'PROJ-123',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-02T00:00:00Z',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      // Act
      const result = await fetchWorkItems('proj-1');

      // Assert
      expect(result).toBeInstanceOf(Array);
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('id', 'wi-1');
      expect(result[0]).toHaveProperty('title', 'Initiative 1');
    });

    it('should correctly map snake_case to camelCase field names', async () => {
      // Arrange: Mock API response with all snake_case fields
      const mockResponse = [
        {
          id: 'wi-1',
          project_id: 'proj-1',
          type: 'EPIC',
          parent_id: 'wi-parent',
          title: 'Epic 1',
          description: 'Epic description',
          status: 'IN_PROGRESS',
          sort_order: 5,
          priority: 2,
          target_window: '2026-Q2',
          tags: { category: 'core' },
          external_system: 'GitHub',
          external_key: 'GH-456',
          created_at: '2026-01-03T10:00:00Z',
          updated_at: '2026-01-03T12:00:00Z',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      // Act
      const result = await fetchWorkItems('proj-1');

      // Assert: Verify all snake_case fields are mapped to camelCase
      const item: WorkItem = result[0];
      expect(item.projectId).toBe('proj-1');
      expect(item.parentId).toBe('wi-parent');
      expect(item.sortOrder).toBe(5);
      expect(item.targetWindow).toBe('2026-Q2');
      expect(item.externalSystem).toBe('GitHub');
      expect(item.externalKey).toBe('GH-456');
      expect(item.createdAt).toBe('2026-01-03T10:00:00Z');
      expect(item.updatedAt).toBe('2026-01-03T12:00:00Z');
    });

    it('should throw descriptive error for failed API requests', async () => {
      // Arrange: Mock a failed response
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      // Act & Assert
      await expect(fetchWorkItems('non-existent-project')).rejects.toThrow(
        'Failed to fetch work items for project "non-existent-project": 404 Not Found'
      );
    });

    it('should handle empty work items array response', async () => {
      // Arrange: Mock empty array response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      // Act
      const result = await fetchWorkItems('proj-empty');

      // Assert
      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });

    it('should handle null/undefined optional fields correctly', async () => {
      // Arrange: Mock response with null optional fields
      const mockResponse = [
        {
          id: 'wi-1',
          project_id: 'proj-1',
          type: 'STORY',
          parent_id: null,
          title: 'Story 1',
          description: null,
          status: 'NEW',
          sort_order: 1,
          priority: null,
          target_window: null,
          tags: null,
          external_system: null,
          external_key: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      // Act
      const result = await fetchWorkItems('proj-1');

      // Assert: All nullable fields should be null, not undefined
      const item: WorkItem = result[0];
      expect(item.parentId).toBeNull();
      expect(item.description).toBeNull();
      expect(item.priority).toBeNull();
      expect(item.targetWindow).toBeNull();
      expect(item.tags).toBeNull();
      expect(item.externalSystem).toBeNull();
      expect(item.externalKey).toBeNull();
    });

    it('should encode projectId in URL to handle special characters', async () => {
      // Arrange
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      // Act
      await fetchWorkItems('project with spaces');

      // Assert: Check that fetch was called with encoded URL
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('project%20with%20spaces')
      );
    });
  });

  // Task Group 1: Product Backlog CRUD Tests

  describe('mapWorkItemCreatePayloadToDto', () => {
    it('should map camelCase to snake_case for create payload', () => {
      const payload: WorkItemCreatePayload = {
        type: 'FEATURE',
        parentId: 'epic-123',
        title: 'New Feature',
        description: 'Feature description',
        status: 'PLANNED',
        priority: 1,
        targetWindow: '2026-Q2',
        sortOrder: 5,
      };

      const dto = mapWorkItemCreatePayloadToDto(payload);

      expect(dto).toEqual({
        type: 'FEATURE',
        parent_id: 'epic-123',
        title: 'New Feature',
        description: 'Feature description',
        status: 'PLANNED',
        priority: 1,
        target_window: '2026-Q2',
        sort_order: 5,
      });
    });

    it('should omit undefined optional fields', () => {
      const payload: WorkItemCreatePayload = {
        type: 'STORY',
        parentId: 'feature-456',
        title: 'New Story',
        sortOrder: 1,
      };

      const dto = mapWorkItemCreatePayloadToDto(payload);

      expect(dto).toEqual({
        type: 'STORY',
        parent_id: 'feature-456',
        title: 'New Story',
        sort_order: 1,
      });
      expect(dto).not.toHaveProperty('description');
      expect(dto).not.toHaveProperty('status');
      expect(dto).not.toHaveProperty('priority');
      expect(dto).not.toHaveProperty('target_window');
    });
  });

  describe('mapWorkItemUpdatePayloadToDto', () => {
    it('should map camelCase to snake_case for update payload', () => {
      const payload: WorkItemUpdatePayload = {
        title: 'Updated Title',
        description: 'Updated description',
        status: 'IN_PROGRESS',
        priority: 2,
        targetWindow: '2026-Q3',
      };

      const dto = mapWorkItemUpdatePayloadToDto(payload);

      expect(dto).toEqual({
        title: 'Updated Title',
        description: 'Updated description',
        status: 'IN_PROGRESS',
        priority: 2,
        target_window: '2026-Q3',
      });
    });

    it('should only include defined fields in update payload', () => {
      const payload: WorkItemUpdatePayload = {
        title: 'Only Title Updated',
      };

      const dto = mapWorkItemUpdatePayloadToDto(payload);

      expect(dto).toEqual({
        title: 'Only Title Updated',
      });
      expect(Object.keys(dto)).toHaveLength(1);
    });

    // ============================================
    // Spec 2026-01-17: Fix Feature Edit 400 Error
    // Task Group 2: Type field mapping tests
    // ============================================

    it('should map payload with type: FEATURE to DTO with type: FEATURE', () => {
      // Given
      const payload: WorkItemUpdatePayload = {
        type: 'FEATURE',
        title: 'Test Feature',
      };

      // When
      const dto = mapWorkItemUpdatePayloadToDto(payload);

      // Then - type should be copied directly (no case transformation)
      expect(dto.type).toBe('FEATURE');
    });

    it('should map payload with type: STORY to DTO with type: STORY', () => {
      // Given
      const payload: WorkItemUpdatePayload = {
        type: 'STORY',
        title: 'Test Story',
      };

      // When
      const dto = mapWorkItemUpdatePayloadToDto(payload);

      // Then
      expect(dto.type).toBe('STORY');
    });

    it('should map all fields correctly alongside type', () => {
      // Given
      const payload: WorkItemUpdatePayload = {
        type: 'FEATURE',
        title: 'Test Feature',
        description: 'Test description',
        status: 'IN_PROGRESS',
        priority: 5,
        targetWindow: '2026-Q3',
      };

      // When
      const dto = mapWorkItemUpdatePayloadToDto(payload);

      // Then - Verify all fields map correctly
      expect(dto.type).toBe('FEATURE');
      expect(dto.title).toBe('Test Feature');
      expect(dto.description).toBe('Test description');
      expect(dto.status).toBe('IN_PROGRESS');
      expect(dto.priority).toBe(5);
      expect(dto.target_window).toBe('2026-Q3');
    });

    // ============================================
    // Spec 2026-01-18: Fix Feature Edit 400 Error - Preserve Parent
    // Task Group 2.1: parentId field mapping tests
    // ============================================

    it('should map parentId to parent_id in update DTO', () => {
      // Given - Spec 2026-01-18: parentId should be included in update payload
      const payload: WorkItemUpdatePayload = {
        type: 'FEATURE',
        title: 'Test Feature',
        parentId: 'epic-123',
      };

      // When
      const dto = mapWorkItemUpdatePayloadToDto(payload);

      // Then - parentId should be mapped to parent_id (snake_case)
      expect(dto.parent_id).toBe('epic-123');
    });

    it('should map all fields correctly including parentId', () => {
      // Given - Complete update payload with parentId
      const payload: WorkItemUpdatePayload = {
        type: 'FEATURE',
        parentId: 'epic-456',
        title: 'Complete Feature',
        description: 'Full description',
        status: 'IN_PROGRESS',
        priority: 3,
        targetWindow: '2026-Q4',
      };

      // When
      const dto = mapWorkItemUpdatePayloadToDto(payload);

      // Then - Verify all fields including parent_id
      expect(dto.type).toBe('FEATURE');
      expect(dto.parent_id).toBe('epic-456');
      expect(dto.title).toBe('Complete Feature');
      expect(dto.description).toBe('Full description');
      expect(dto.status).toBe('IN_PROGRESS');
      expect(dto.priority).toBe(3);
      expect(dto.target_window).toBe('2026-Q4');
    });

    it('should not include parent_id when parentId is undefined', () => {
      // Given - Payload without parentId
      const payload: WorkItemUpdatePayload = {
        type: 'STORY',
        title: 'Story without parent change',
      };

      // When
      const dto = mapWorkItemUpdatePayloadToDto(payload);

      // Then - parent_id should not be in DTO
      expect(dto).not.toHaveProperty('parent_id');
    });
  });

  describe('createWorkItem', () => {
    it('should call POST with correct snake_case payload', async () => {
      const mockResponse: Record<string, unknown> = {
        id: 'new-item-id',
        project_id: 'test-project',
        type: 'FEATURE',
        parent_id: 'epic-123',
        title: 'New Feature',
        description: 'Description',
        status: 'PLANNED',
        sort_order: 1,
        priority: 1,
        target_window: '2026-Q2',
        tags: null,
        external_system: null,
        external_key: null,
        created_at: '2026-01-03T10:00:00Z',
        updated_at: '2026-01-03T10:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const payload: WorkItemCreatePayload = {
        type: 'FEATURE',
        parentId: 'epic-123',
        title: 'New Feature',
        description: 'Description',
        status: 'PLANNED',
        priority: 1,
        targetWindow: '2026-Q2',
        sortOrder: 1,
      };

      const result = await createWorkItem('test-project', payload);

      // Verify fetch was called with correct URL and method
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('/api/model/projects/test-project/work-items');
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');

      // Verify the body contains snake_case fields
      const body = JSON.parse(options.body);
      expect(body.parent_id).toBe('epic-123');
      expect(body.target_window).toBe('2026-Q2');
      expect(body.sort_order).toBe(1);

      // Verify response is mapped to camelCase
      expect(result.id).toBe('new-item-id');
      expect(result.parentId).toBe('epic-123');
      expect(result.targetWindow).toBe('2026-Q2');
      expect(result.sortOrder).toBe(1);
    });

    it('should throw error with descriptive message on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'Invalid payload',
      });

      const payload: WorkItemCreatePayload = {
        type: 'FEATURE',
        parentId: 'epic-123',
        title: '',
        sortOrder: 1,
      };

      await expect(createWorkItem('test-project', payload)).rejects.toThrow(
        'Failed to create work item in project "test-project": 400 Bad Request - Invalid payload'
      );
    });
  });

  describe('updateWorkItem', () => {
    it('should call PUT with correct payload and ID', async () => {
      const mockResponse: Record<string, unknown> = {
        id: 'item-123',
        project_id: 'test-project',
        type: 'FEATURE',
        parent_id: 'epic-123',
        title: 'Updated Feature',
        description: 'Updated description',
        status: 'IN_PROGRESS',
        sort_order: 1,
        priority: 2,
        target_window: '2026-Q3',
        tags: null,
        external_system: null,
        external_key: null,
        created_at: '2026-01-03T10:00:00Z',
        updated_at: '2026-01-03T11:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const payload: WorkItemUpdatePayload = {
        title: 'Updated Feature',
        description: 'Updated description',
        status: 'IN_PROGRESS',
      };

      const result = await updateWorkItem('test-project', 'item-123', payload);

      // Verify fetch was called with correct URL and method
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('/api/model/projects/test-project/work-items/item-123');
      expect(options.method).toBe('PUT');

      // Verify response is mapped correctly
      expect(result.id).toBe('item-123');
      expect(result.title).toBe('Updated Feature');
      expect(result.status).toBe('IN_PROGRESS');
    });

    it('should throw error on update failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'Work item not found',
      });

      const payload: WorkItemUpdatePayload = {
        title: 'Updated Title',
      };

      await expect(updateWorkItem('test-project', 'nonexistent-id', payload)).rejects.toThrow(
        'Failed to update work item "nonexistent-id" in project "test-project": 404 Not Found - Work item not found'
      );
    });

    // ============================================
    // Spec 2026-01-17: Fix Feature Edit 400 Error
    // Task Group 2 & 4: Type field in update request tests
    // ============================================

    it('should include type field in request body when provided', async () => {
      // Given - This test verifies the fix for 400 error
      const mockResponse: Record<string, unknown> = {
        id: 'feature-123',
        project_id: 'test-project',
        type: 'FEATURE',
        parent_id: 'epic-123',
        title: 'Updated Feature Title',
        description: null,
        status: 'IN_PROGRESS',
        sort_order: 1,
        priority: null,
        target_window: null,
        tags: null,
        external_system: null,
        external_key: null,
        created_at: '2026-01-17T00:00:00Z',
        updated_at: '2026-01-17T00:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const payload: WorkItemUpdatePayload = {
        type: 'FEATURE',
        title: 'Updated Feature Title',
        status: 'IN_PROGRESS',
      };

      // When
      await updateWorkItem('test-project', 'feature-123', payload);

      // Then - Verify request body contains type field
      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body).toHaveProperty('type', 'FEATURE');
    });

    it('should include type field for STORY updates', async () => {
      // Given
      const mockResponse: Record<string, unknown> = {
        id: 'story-456',
        project_id: 'test-project',
        type: 'STORY',
        parent_id: 'feature-123',
        title: 'Updated Story',
        description: null,
        status: 'PLANNED',
        sort_order: 0,
        priority: null,
        target_window: null,
        tags: null,
        external_system: null,
        external_key: null,
        created_at: '2026-01-17T00:00:00Z',
        updated_at: '2026-01-17T00:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const payload: WorkItemUpdatePayload = {
        type: 'STORY',
        title: 'Updated Story',
      };

      // When
      await updateWorkItem('test-project', 'story-456', payload);

      // Then
      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body).toHaveProperty('type', 'STORY');
    });

    // ============================================
    // Spec 2026-01-18: Fix Feature Edit 400 Error - Preserve Parent
    // Task Group 2.1: parentId in update request tests
    // ============================================

    it('should include parent_id in request body when parentId is provided', async () => {
      // Given - Spec 2026-01-18: parentId should be sent to preserve parent relationship
      const mockResponse: Record<string, unknown> = {
        id: 'feature-123',
        project_id: 'test-project',
        type: 'FEATURE',
        parent_id: 'epic-123',
        title: 'Updated Feature Title',
        description: null,
        status: 'IN_PROGRESS',
        sort_order: 1,
        priority: null,
        target_window: null,
        tags: null,
        external_system: null,
        external_key: null,
        created_at: '2026-01-18T00:00:00Z',
        updated_at: '2026-01-18T00:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const payload: WorkItemUpdatePayload = {
        type: 'FEATURE',
        parentId: 'epic-123',
        title: 'Updated Feature Title',
      };

      // When
      await updateWorkItem('test-project', 'feature-123', payload);

      // Then - Verify request body contains parent_id field
      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body).toHaveProperty('parent_id', 'epic-123');
    });

    it('should include parent_id for STORY updates to preserve parent FEATURE', async () => {
      // Given - Spec 2026-01-18: STORY update should include parent_id
      const mockResponse: Record<string, unknown> = {
        id: 'story-456',
        project_id: 'test-project',
        type: 'STORY',
        parent_id: 'feature-789',
        title: 'Updated Story',
        description: null,
        status: 'PLANNED',
        sort_order: 0,
        priority: null,
        target_window: null,
        tags: null,
        external_system: null,
        external_key: null,
        created_at: '2026-01-18T00:00:00Z',
        updated_at: '2026-01-18T00:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const payload: WorkItemUpdatePayload = {
        type: 'STORY',
        parentId: 'feature-789',
        title: 'Updated Story',
      };

      // When
      await updateWorkItem('test-project', 'story-456', payload);

      // Then
      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body).toHaveProperty('parent_id', 'feature-789');
    });
  });

  describe('deleteWorkItem', () => {
    it('should call DELETE with correct endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      await deleteWorkItem('test-project', 'item-to-delete');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('/api/model/projects/test-project/work-items/item-to-delete');
      expect(options.method).toBe('DELETE');
    });

    it('should throw error with descriptive message on delete failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Database error',
      });

      await expect(deleteWorkItem('test-project', 'item-id')).rejects.toThrow(
        'Failed to delete work item "item-id" in project "test-project": 500 Internal Server Error - Database error'
      );
    });
  });

  // ============================================
  // Spec 2026-01-17: Fix Feature Edit 400 Error
  // Task Group 1: Type Definition Tests
  // ============================================

  describe('Type Definition Tests (Spec 2026-01-17)', () => {
    it('WorkItemUpdatePayload accepts type: WorkItemType field', () => {
      // Given - Create a payload with type field
      const payload: WorkItemUpdatePayload = {
        type: 'FEATURE',
        title: 'Test Feature',
        description: 'Test description',
        status: 'PLANNED',
        priority: 1,
        targetWindow: '2026-Q2',
      };

      // Then - Verify the payload is valid with type field
      expect(payload.type).toBe('FEATURE');
      expect(payload.title).toBe('Test Feature');
    });

    it('WorkItemUpdatePayload accepts all standard work item types', () => {
      // Given - Create payloads with different types
      const featurePayload: WorkItemUpdatePayload = { type: 'FEATURE', title: 'Feature' };
      const storyPayload: WorkItemUpdatePayload = { type: 'STORY', title: 'Story' };
      const epicPayload: WorkItemUpdatePayload = { type: 'EPIC', title: 'Epic' };
      const initiativePayload: WorkItemUpdatePayload = { type: 'INITIATIVE', title: 'Initiative' };

      // Then - All should be valid
      expect(featurePayload.type).toBe('FEATURE');
      expect(storyPayload.type).toBe('STORY');
      expect(epicPayload.type).toBe('EPIC');
      expect(initiativePayload.type).toBe('INITIATIVE');
    });
  });

  // ============================================
  // Spec 2026-01-17: Fix Feature Edit 400 Error
  // Task Group 4: Integration Tests
  // ============================================

  describe('Complete Feature Edit Flow Integration (Spec 2026-01-17)', () => {
    it('Feature edit request body includes type matching original work item', async () => {
      // Given - Simulating the complete edit flow
      const projectId = 'integration-project';
      const workItemId = 'feature-integration-001';

      // This simulates what WorkItemEditModal does: include item.type in payload
      const originalItemType = 'FEATURE';
      const payload: WorkItemUpdatePayload = {
        type: originalItemType,
        title: 'Renamed Feature',
        description: 'Updated description',
        status: 'READY',
        priority: 2,
        targetWindow: '2026-Q4',
      };

      const mockResponse = {
        id: workItemId,
        project_id: projectId,
        type: 'FEATURE',
        parent_id: 'epic-001',
        title: 'Renamed Feature',
        description: 'Updated description',
        status: 'READY',
        sort_order: 1,
        priority: 2,
        target_window: '2026-Q4',
        tags: null,
        external_system: null,
        external_key: null,
        created_at: '2026-01-15T00:00:00Z',
        updated_at: '2026-01-17T12:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      // When
      const result = await updateWorkItem(projectId, workItemId, payload);

      // Then - Verify request included type
      const [, options] = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(options.body);

      expect(requestBody.type).toBe('FEATURE');
      expect(requestBody.type).toBe(originalItemType);

      // Verify response is mapped correctly
      expect(result.type).toBe('FEATURE');
      expect(result.title).toBe('Renamed Feature');
    });

    it('Story edit request body includes type preventing 400 error', async () => {
      // Given - This test verifies the 400 error scenario is resolved
      const projectId = 'integration-project';
      const workItemId = 'story-integration-002';

      const payload: WorkItemUpdatePayload = {
        type: 'STORY',
        title: 'Updated Story',
      };

      const mockResponse = {
        id: workItemId,
        project_id: projectId,
        type: 'STORY',
        parent_id: 'feature-001',
        title: 'Updated Story',
        description: null,
        status: 'PLANNED',
        sort_order: 0,
        priority: null,
        target_window: null,
        tags: null,
        external_system: null,
        external_key: null,
        created_at: '2026-01-17T00:00:00Z',
        updated_at: '2026-01-17T00:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      // When
      const result = await updateWorkItem(projectId, workItemId, payload);

      // Then - Request should succeed (no 400 error)
      const [, options] = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(options.body);

      // The key fix: type is included in request body
      expect(requestBody).toHaveProperty('type', 'STORY');
      expect(result.type).toBe('STORY');
    });
  });

  // ============================================
  // Spec 2026-01-18: Fix Feature Edit 400 Error - Preserve Parent
  // Task Group 2.1: Integration Tests for parentId
  // ============================================

  describe('Complete Feature Edit Flow with parentId (Spec 2026-01-18)', () => {
    it('Feature edit request body includes parent_id to preserve EPIC parent', async () => {
      // Given - Simulating the complete edit flow with parentId
      const projectId = 'integration-project';
      const workItemId = 'feature-integration-003';
      const originalParentId = 'epic-parent-001';

      // This simulates what WorkItemEditModal does: include item.parentId in payload
      const payload: WorkItemUpdatePayload = {
        type: 'FEATURE',
        parentId: originalParentId,
        title: 'Renamed Feature with Parent',
        description: 'Updated description',
        status: 'READY',
      };

      const mockResponse = {
        id: workItemId,
        project_id: projectId,
        type: 'FEATURE',
        parent_id: originalParentId,
        title: 'Renamed Feature with Parent',
        description: 'Updated description',
        status: 'READY',
        sort_order: 1,
        priority: null,
        target_window: null,
        tags: null,
        external_system: null,
        external_key: null,
        created_at: '2026-01-18T00:00:00Z',
        updated_at: '2026-01-18T12:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      // When
      const result = await updateWorkItem(projectId, workItemId, payload);

      // Then - Verify request included parent_id
      const [, options] = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(options.body);

      expect(requestBody.parent_id).toBe(originalParentId);
      expect(requestBody.type).toBe('FEATURE');

      // Verify response preserves parent
      expect(result.parentId).toBe(originalParentId);
    });
  });
});
