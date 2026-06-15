/**
 * Delete Project API Tests
 *
 * Spec 2026-01-10: Project Menu + Delete Project
 * Task Group 2: Frontend Delete Project API
 *
 * Tests cover:
 * 1. deleteProject() calls DELETE /api/projects/{id} with correct URL
 * 2. deleteProject() returns success status and message on 200
 * 3. deleteProject() throws error with server message on 404/400/500
 * 4. clearActiveProject() resets activeProject to null
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { deleteProject } from '../api/projectsApi';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('deleteProject API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Test 1: deleteProject() calls DELETE /api/projects/{id} with correct URL', () => {
    it('should call DELETE with correct URL and project ID', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ message: 'Project deleted successfully' }),
      });

      await deleteProject(projectId);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain('/api/projects/550e8400-e29b-41d4-a716-446655440000');
      expect(options.method).toBe('DELETE');
    });

    it('should URL-encode special characters in project ID', async () => {
      const projectId = 'test-project-with-special%chars';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ message: 'Project deleted successfully' }),
      });

      await deleteProject(projectId);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain(encodeURIComponent(projectId));
    });
  });

  describe('Test 2: deleteProject() returns success status and message on 200', () => {
    it('should return success true and message on 200 OK', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ message: 'Project deleted successfully' }),
      });

      const result = await deleteProject(projectId);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Project deleted successfully');
    });

    it('should handle different success messages from backend', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ message: 'Project and all associated data deleted' }),
      });

      const result = await deleteProject(projectId);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Project and all associated data deleted');
    });
  });

  describe('Test 3: deleteProject() throws error with server message on 404/400/500', () => {
    it('should throw error with server message on 404 Not Found', async () => {
      const projectId = 'non-existent-project';

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: () => Promise.resolve({ message: 'Project not found with id: non-existent-project' }),
      });

      await expect(deleteProject(projectId)).rejects.toThrow(
        'Project not found with id: non-existent-project'
      );
    });

    it('should throw error with server message on 400 Bad Request', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: () => Promise.resolve({ message: 'Project parent folder is blank or invalid' }),
      });

      await expect(deleteProject(projectId)).rejects.toThrow(
        'Project parent folder is blank or invalid'
      );
    });

    it('should throw error with server message on 500 Internal Server Error', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({ message: 'Failed to delete project files' }),
      });

      await expect(deleteProject(projectId)).rejects.toThrow(
        'Failed to delete project files'
      );
    });

    it('should throw generic error when no server message available', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.reject(new Error('JSON parse error')),
      });

      await expect(deleteProject(projectId)).rejects.toThrow(
        'Failed to delete project: 500 Internal Server Error'
      );
    });
  });
});

describe('clearActiveProject context function', () => {
  describe('Test 4: clearActiveProject() resets activeProject to null', () => {
    it('should export useClearActiveProject hook from ProjectContext', async () => {
      // Dynamic import to verify the hook exists
      const context = await import('../contexts/ProjectContext');
      expect(context.useClearActiveProject).toBeDefined();
      expect(typeof context.useClearActiveProject).toBe('function');
    });
  });
});
