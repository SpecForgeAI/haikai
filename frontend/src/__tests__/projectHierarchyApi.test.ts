/**
 * Unit tests for projectsApi project hierarchy functionality.
 *
 * Spec 2026-01-10: Project Hierarchy Grouping
 * Task Group 2: Frontend API Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch before importing the module
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Import after setting up mock
import { createProject, listProjects, ProjectDto } from '../api/projectsApi';

describe('projectsApi - Project Hierarchy', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('ProjectDto interface', () => {
    it('includes projectHierarchy field', () => {
      const project: ProjectDto = {
        id: '123',
        name: 'Test',
        projectParentFolder: '/path',
        projectHierarchy: 'ClientA',
        isActive: true,
        createdAt: '2026-01-10T00:00:00Z',
        updatedAt: '2026-01-10T00:00:00Z',
      };
      expect(project.projectHierarchy).toBe('ClientA');
    });

    it('allows null projectHierarchy', () => {
      const project: ProjectDto = {
        id: '123',
        name: 'Test',
        projectParentFolder: '/path',
        projectHierarchy: null,
        isActive: true,
        createdAt: '2026-01-10T00:00:00Z',
        updatedAt: '2026-01-10T00:00:00Z',
      };
      expect(project.projectHierarchy).toBeNull();
    });
  });

  describe('mapProjectFromSnake', () => {
    it('correctly maps project_hierarchy to projectHierarchy', async () => {
      const snakeResponse = {
        id: '123',
        name: 'Test Project',
        project_parent_folder: '/projects/test',
        project_hierarchy: 'Internal',
        is_active: true,
        created_at: '2026-01-10T00:00:00Z',
        updated_at: '2026-01-10T00:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [snakeResponse],
      });

      const result = await listProjects();

      expect(result[0].projectHierarchy).toBe('Internal');
    });

    it('maps null project_hierarchy to null', async () => {
      const snakeResponse = {
        id: '123',
        name: 'Test Project',
        project_parent_folder: '/projects/test',
        project_hierarchy: null,
        is_active: true,
        created_at: '2026-01-10T00:00:00Z',
        updated_at: '2026-01-10T00:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [snakeResponse],
      });

      const result = await listProjects();

      expect(result[0].projectHierarchy).toBeNull();
    });
  });

  describe('createProject', () => {
    it('includes project_hierarchy in request payload when provided', async () => {
      const responseDto = {
        id: '123',
        name: 'Test Project',
        project_parent_folder: '/projects/test',
        project_hierarchy: 'ClientA',
        is_active: true,
        created_at: '2026-01-10T00:00:00Z',
        updated_at: '2026-01-10T00:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => responseDto,
      });

      await createProject('Test Project', '/projects/test', 'ClientA');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"project_hierarchy":"ClientA"'),
        })
      );
    });

    it('sends null for project_hierarchy when not provided', async () => {
      const responseDto = {
        id: '123',
        name: 'Test Project',
        project_parent_folder: '/projects/test',
        project_hierarchy: null,
        is_active: true,
        created_at: '2026-01-10T00:00:00Z',
        updated_at: '2026-01-10T00:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => responseDto,
      });

      await createProject('Test Project', '/projects/test');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"project_hierarchy":null'),
        })
      );
    });

    it('returns created project with projectHierarchy', async () => {
      const responseDto = {
        id: '123',
        name: 'Test Project',
        project_parent_folder: '/projects/test',
        project_hierarchy: 'Internal',
        is_active: true,
        created_at: '2026-01-10T00:00:00Z',
        updated_at: '2026-01-10T00:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => responseDto,
      });

      const result = await createProject('Test Project', '/projects/test', 'Internal');

      expect(result.projectHierarchy).toBe('Internal');
    });
  });
});
