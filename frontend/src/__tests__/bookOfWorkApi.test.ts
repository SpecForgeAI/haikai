/**
 * Tests for bookOfWorkApi.
 *
 * Spec 2026-01-10: Upload Book of Work from Markdown
 * Task Group 4.1: Tests for bookOfWorkApi functionality
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  uploadBookOfWork,
  mapBookOfWorkResultDtoToResult,
  type BookOfWorkUploadResultDto,
} from '../api/bookOfWorkApi';

describe('bookOfWorkApi', () => {
  // Store original fetch
  const originalFetch = global.fetch;

  beforeEach(() => {
    // Reset fetch mock before each test
    global.fetch = vi.fn();
  });

  afterEach(() => {
    // Restore original fetch
    global.fetch = originalFetch;
  });

  describe('uploadBookOfWork', () => {
    it('sends correct request format', async () => {
      // Given
      const projectId = 'test-project';
      const content = '## Initiative\n### Epic';

      const mockResponse: BookOfWorkUploadResultDto = {
        project_id: projectId,
        work_items: [],
        import_summary: {
          initiatives_created: 1,
          epics_created: 1,
          features_created: 0,
          stories_created: 0,
          total_created: 2,
        },
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      // When
      await uploadBookOfWork(projectId, content);

      // Then
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/projects/${encodeURIComponent(projectId)}/book-of-work/upload`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ content }),
        })
      );
    });

    it('maps successful response to camelCase correctly', async () => {
      // Given
      const projectId = 'test-project';
      const content = '## Initiative\n### Epic\n#### Feature\n##### Story';

      const mockResponse: BookOfWorkUploadResultDto = {
        project_id: projectId,
        work_items: [
          {
            id: '550e8400-e29b-41d4-a716-446655440000',
            project_id: projectId,
            type: 'INITIATIVE',
            parent_id: null,
            title: 'Initiative',
            description: null,
            status: 'PLANNED',
            sort_order: 0,
            priority: null,
            target_window: null,
            tags: null,
            external_system: null,
            external_key: null,
            created_at: '2026-01-10T00:00:00Z',
            updated_at: '2026-01-10T00:00:00Z',
          },
        ],
        import_summary: {
          initiatives_created: 1,
          epics_created: 1,
          features_created: 1,
          stories_created: 1,
          total_created: 4,
        },
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      // When
      const result = await uploadBookOfWork(projectId, content);

      // Then
      expect(result.projectId).toBe(projectId);
      expect(result.workItems).toHaveLength(1);
      expect(result.workItems[0].projectId).toBe(projectId);
      expect(result.workItems[0].parentId).toBeNull();
      expect(result.workItems[0].sortOrder).toBe(0);
      expect(result.importSummary.initiativesCreated).toBe(1);
      expect(result.importSummary.epicsCreated).toBe(1);
      expect(result.importSummary.featuresCreated).toBe(1);
      expect(result.importSummary.storiesCreated).toBe(1);
      expect(result.importSummary.totalCreated).toBe(4);
    });

    it('returns meaningful message on 400 error', async () => {
      // Given
      const projectId = 'test-project';
      const content = '# Only H1 - invalid';

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({
          message: 'No valid headings (H2-H5) found in the Book of Work file.',
        }),
      });

      // When/Then
      await expect(uploadBookOfWork(projectId, content)).rejects.toThrow(
        'No valid headings'
      );
    });

    it('returns "project not found" message on 404 error', async () => {
      // Given
      const projectId = 'non-existent';
      const content = '## Initiative';

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({
          message: 'Project not found: non-existent',
        }),
      });

      // When/Then
      await expect(uploadBookOfWork(projectId, content)).rejects.toThrow(
        'Project not found: non-existent'
      );
    });
  });

  describe('mapBookOfWorkResultDtoToResult', () => {
    it('correctly maps all fields from snake_case to camelCase', () => {
      // Given
      const dto: BookOfWorkUploadResultDto = {
        project_id: 'my-project',
        work_items: [
          {
            id: '550e8400-e29b-41d4-a716-446655440000',
            project_id: 'my-project',
            type: 'INITIATIVE',
            parent_id: null,
            title: 'My Initiative',
            description: 'Description text',
            status: 'PLANNED',
            sort_order: 0,
            priority: 1,
            target_window: 'Q1 2026',
            tags: { category: 'platform' },
            external_system: 'JIRA',
            external_key: 'PROJ-123',
            created_at: '2026-01-10T10:00:00Z',
            updated_at: '2026-01-10T11:00:00Z',
          },
        ],
        import_summary: {
          initiatives_created: 2,
          epics_created: 5,
          features_created: 10,
          stories_created: 20,
          total_created: 37,
        },
      };

      // When
      const result = mapBookOfWorkResultDtoToResult(dto);

      // Then
      expect(result.projectId).toBe('my-project');
      expect(result.workItems).toHaveLength(1);

      const workItem = result.workItems[0];
      expect(workItem.id).toBe('550e8400-e29b-41d4-a716-446655440000');
      expect(workItem.projectId).toBe('my-project');
      expect(workItem.type).toBe('INITIATIVE');
      expect(workItem.parentId).toBeNull();
      expect(workItem.title).toBe('My Initiative');
      expect(workItem.description).toBe('Description text');
      expect(workItem.status).toBe('PLANNED');
      expect(workItem.sortOrder).toBe(0);
      expect(workItem.priority).toBe(1);
      expect(workItem.targetWindow).toBe('Q1 2026');
      expect(workItem.tags).toEqual({ category: 'platform' });
      expect(workItem.externalSystem).toBe('JIRA');
      expect(workItem.externalKey).toBe('PROJ-123');
      expect(workItem.createdAt).toBe('2026-01-10T10:00:00Z');
      expect(workItem.updatedAt).toBe('2026-01-10T11:00:00Z');

      expect(result.importSummary.initiativesCreated).toBe(2);
      expect(result.importSummary.epicsCreated).toBe(5);
      expect(result.importSummary.featuresCreated).toBe(10);
      expect(result.importSummary.storiesCreated).toBe(20);
      expect(result.importSummary.totalCreated).toBe(37);
    });
  });
});
