/**
 * Tests for Projects API Client
 *
 * Spec 2026-01-05: Project Model with Active Project
 * Task Group 6: Frontend Projects API Client Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createProject,
  listProjects,
  getActiveProject,
  activateProject,
  ProjectDto,
} from '../api/projectsApi';

describe('projectsApi', () => {
  // Mock fetch
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // The wire format is snake_case (the API maps it to a camelCase ProjectDto)
  const sampleProjectWire = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Test Project',
    project_parent_folder: '/projects/test',
    is_active: true,
    created_at: '2026-01-05T12:00:00Z',
    updated_at: '2026-01-05T12:00:00Z',
  };

  // Mapped camelCase DTO (optional fields default to null in the mapper)
  const sampleProject: ProjectDto = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Test Project',
    projectParentFolder: '/projects/test',
    projectHierarchy: null,
    organisationId: null,
    repoUrl: null,
    isActive: true,
    createdAt: '2026-01-05T12:00:00Z',
    updatedAt: '2026-01-05T12:00:00Z',
    perStoryContextTokenCap: null,
    crossStoryContextTokenCap: null,
    autoRunPass2: null,
    maxContractUploadFileSizeMb: null,
    // Spec 2026-06-12: implementation-service init/repo-map fields
    implementationInitSuccess: null,
    implementationMode: null,
    implementationProjectDir: null,
    implementationRepos: [],
  };

  describe('createProject', () => {
    it('sends POST with correct body and returns ProjectDto', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => sampleProjectWire,
      });

      const result = await createProject('Test Project', '/projects/test');

      // Verify fetch was called correctly (the request body is snake_case)
      expect(mockFetch).toHaveBeenCalledWith('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Test Project',
          project_hierarchy: null,
          set_active: true,
          project_parent_folder: '/projects/test',
        }),
      });

      // Verify return value
      expect(result).toEqual(sampleProject);
    });

    it('throws error when request fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ message: 'Invalid input' }),
      });

      await expect(createProject('', '')).rejects.toThrow('Invalid input');
    });
  });

  describe('listProjects', () => {
    it('sends GET and returns array of ProjectDto', async () => {
      const projects = [sampleProjectWire, { ...sampleProjectWire, id: 'other-id', name: 'Other' }];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => projects,
      });

      const result = await listProjects();

      // Verify fetch was called correctly
      expect(mockFetch).toHaveBeenCalledWith('/api/projects', {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      // Verify return value
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Test Project');
    });
  });

  describe('getActiveProject', () => {
    it('returns null on 404', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await getActiveProject();

      expect(result).toBeNull();
    });

    it('returns ProjectDto on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => sampleProjectWire,
      });

      const result = await getActiveProject();

      expect(mockFetch).toHaveBeenCalledWith('/api/projects/active', {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      expect(result).toEqual(sampleProject);
      expect(result?.isActive).toBe(true);
    });

    it('throws error on non-404 failures', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({}),
      });

      await expect(getActiveProject()).rejects.toThrow();
    });
  });

  describe('activateProject', () => {
    it('sends POST and returns updated ProjectDto', async () => {
      const activatedProject = { ...sampleProject, isActive: true };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...sampleProjectWire, is_active: true }),
      });

      const result = await activateProject('550e8400-e29b-41d4-a716-446655440000');

      // Verify fetch was called correctly
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/projects/550e8400-e29b-41d4-a716-446655440000/activate',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      expect(result).toEqual(activatedProject);
    });

    it('encodes special characters in project ID', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => sampleProjectWire,
      });

      await activateProject('test/id');

      expect(mockFetch).toHaveBeenCalledWith('/api/projects/test%2Fid/activate', expect.any(Object));
    });
  });
});
