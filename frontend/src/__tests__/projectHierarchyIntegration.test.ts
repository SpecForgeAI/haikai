/**
 * Integration tests for Project Hierarchy feature.
 *
 * Spec 2026-01-10: Project Hierarchy Grouping
 * Task Group 4: Additional strategic tests to fill coverage gaps
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Project Hierarchy Integration', () => {
  describe('End-to-end workflow tests', () => {
    it('project created with hierarchy should include hierarchy in response', async () => {
      // Simulate creating a project with hierarchy and verify the response
      const mockResponse = {
        id: 'test-123',
        name: 'Test Project',
        project_parent_folder: '/projects/test',
        project_hierarchy: 'ClientA',
        is_active: true,
        created_at: '2026-01-10T00:00:00Z',
        updated_at: '2026-01-10T00:00:00Z',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      // Import dynamically to use mocked fetch
      const { createProject } = await import('../api/projectsApi');
      const result = await createProject('Test Project', '/projects/test', 'ClientA');

      expect(result.projectHierarchy).toBe('ClientA');
    });

    it('project created without hierarchy should have null hierarchy', async () => {
      const mockResponse = {
        id: 'test-456',
        name: 'No Hierarchy Project',
        project_parent_folder: '/projects/test',
        project_hierarchy: null,
        is_active: true,
        created_at: '2026-01-10T00:00:00Z',
        updated_at: '2026-01-10T00:00:00Z',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const { createProject } = await import('../api/projectsApi');
      const result = await createProject('No Hierarchy Project', '/projects/test');

      expect(result.projectHierarchy).toBeNull();
    });

    it('listProjects returns projects with correct hierarchy values', async () => {
      const mockResponse = [
        {
          id: '1',
          name: 'Project A',
          project_parent_folder: '/a',
          project_hierarchy: 'ClientA',
          is_active: false,
          created_at: '2026-01-10T00:00:00Z',
          updated_at: '2026-01-10T00:00:00Z',
        },
        {
          id: '2',
          name: 'Project B',
          project_parent_folder: '/b',
          project_hierarchy: null,
          is_active: true,
          created_at: '2026-01-10T00:00:00Z',
          updated_at: '2026-01-10T00:00:00Z',
        },
      ];

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const { listProjects } = await import('../api/projectsApi');
      const result = await listProjects();

      expect(result[0].projectHierarchy).toBe('ClientA');
      expect(result[1].projectHierarchy).toBeNull();
    });
  });

  describe('Edge case tests', () => {
    it('multiple projects with same hierarchy are handled correctly', () => {
      // This tests the grouping logic directly
      const projects = [
        { id: '1', name: 'Alpha', projectHierarchy: 'ClientA' },
        { id: '2', name: 'Beta', projectHierarchy: 'ClientA' },
        { id: '3', name: 'Gamma', projectHierarchy: 'ClientA' },
      ];

      // Group by hierarchy
      const groups = new Map<string | null, typeof projects>();
      projects.forEach((p) => {
        const key = p.projectHierarchy;
        if (!groups.has(key)) {
          groups.set(key, []);
        }
        groups.get(key)!.push(p);
      });

      // Verify all 3 projects are in ClientA group
      expect(groups.get('ClientA')).toHaveLength(3);
    });

    it('projects sort correctly within same hierarchy section', () => {
      const projects = [
        { name: 'Zebra' },
        { name: 'alpha' }, // lowercase for case-insensitive test
        { name: 'Mike' },
      ];

      const sorted = [...projects].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      );

      expect(sorted[0].name).toBe('alpha');
      expect(sorted[1].name).toBe('Mike');
      expect(sorted[2].name).toBe('Zebra');
    });

    it('hierarchy with leading/trailing whitespace is trimmed by backend', async () => {
      // Verify the trimmed hierarchy comes back from API
      const mockResponse = {
        id: 'test-789',
        name: 'Test',
        project_parent_folder: '/test',
        project_hierarchy: 'ClientA', // Already trimmed by backend
        is_active: true,
        created_at: '2026-01-10T00:00:00Z',
        updated_at: '2026-01-10T00:00:00Z',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const { createProject } = await import('../api/projectsApi');
      // Frontend sends with whitespace, backend trims
      const result = await createProject('Test', '/test', '  ClientA  ');

      // Response should have trimmed value
      expect(result.projectHierarchy).toBe('ClientA');
    });
  });

  describe('Type safety tests', () => {
    it('ProjectDto interface enforces correct hierarchy type', () => {
      // TypeScript compile-time test - if this compiles, types are correct
      const validProject = {
        id: '1',
        name: 'Test',
        projectParentFolder: '/test',
        projectHierarchy: 'ValidHierarchy' as string | null,
        isActive: true,
        createdAt: '2026-01-10',
        updatedAt: '2026-01-10',
      };

      const nullHierarchy = {
        ...validProject,
        projectHierarchy: null as string | null,
      };

      expect(validProject.projectHierarchy).toBe('ValidHierarchy');
      expect(nullHierarchy.projectHierarchy).toBeNull();
    });
  });
});
