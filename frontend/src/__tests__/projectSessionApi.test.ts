/**
 * Project Session API Tests
 *
 * Spec 2026-01-22: Explicit Project Session API
 * Task Group 3: Session API Client
 *
 * Tests for the projectSessionApi module:
 * - getSessionProject() returns project data on 200
 * - getSessionProject() returns null on 404
 * - importToSession() sends correct request body and returns result
 * - exportSessionSnapshot() returns snapshot on 200, null on 404
 * - clearSession() calls POST and handles success
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getSessionProject,
  importToSession,
  exportSessionSnapshot,
  clearSession,
} from '../api/projectSessionApi';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Task Group 3: projectSessionApi Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Test 1: getSessionProject() returns project data on 200
  // =========================================================================

  describe('Test 3.1: getSessionProject()', () => {
    it('should return project data on 200 response', async () => {
      // Arrange
      const mockProject = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Test Project',
        project_parent_folder: '/test/folder',
        project_hierarchy: null,
        organisation_id: null,
        is_active: true,
        created_at: '2026-01-22T00:00:00Z',
        updated_at: '2026-01-22T00:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockProject),
      });

      // Act
      const result = await getSessionProject();

      // Assert
      expect(mockFetch).toHaveBeenCalledWith('/api/project-session');
      expect(result).not.toBeNull();
      expect(result?.name).toBe('Test Project');
      expect(result?.isActive).toBe(true);
      expect(result?.projectParentFolder).toBe('/test/folder');
    });

    // =========================================================================
    // Test 2: getSessionProject() returns null on 404
    // =========================================================================

    it('should return null on 404 response', async () => {
      // Arrange
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      // Act
      const result = await getSessionProject();

      // Assert
      expect(mockFetch).toHaveBeenCalledWith('/api/project-session');
      expect(result).toBeNull();
    });

    it('should throw Error on other failures', async () => {
      // Arrange
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      // Act & Assert
      await expect(getSessionProject()).rejects.toThrow('Failed to get session project');
    });
  });

  // =========================================================================
  // Test 3: importToSession() sends correct request body and returns result
  // =========================================================================

  describe('Test 3.3: importToSession()', () => {
    it('should send correct request body and return result', async () => {
      // Arrange
      const mockSnapshot = {
        meta: {
          snapshot_version: 1,
          exported_at: '2026-01-22T00:00:00Z',
          export_kind: 'FULL',
        },
        project: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          name: 'Test Project',
          project_parent_folder: '/test/folder',
          project_hierarchy: null,
          organisation_id: null,
          is_active: true,
          created_at: '2026-01-22T00:00:00Z',
          updated_at: '2026-01-22T00:00:00Z',
        },
        model: null,
        work_items: [],
        artifacts: [],
      };

      const mockResult = {
        project: {
          id: '123e4567-e89b-12d3-a456-426614174001',
          name: 'Test Project',
          project_parent_folder: '/test/folder',
          project_hierarchy: null,
          organisation_id: null,
          is_active: true,
          created_at: '2026-01-22T00:00:00Z',
          updated_at: '2026-01-22T00:00:00Z',
        },
        model_saved: false,
        work_items_inserted: 0,
        artifacts_inserted: 0,
        warnings: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: () => Promise.resolve(mockResult),
      });

      // Act
      const result = await importToSession({
        snapshot: mockSnapshot as any,
        importAsName: 'New Name',
        setActive: true,
      });

      // Assert
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/project-session/import',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );

      // Verify request body
      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.snapshot).toBeDefined();
      expect(body.import_as_name).toBe('New Name');
      expect(body.set_active).toBe(true);

      // Verify result mapping
      expect(result.project.name).toBe('Test Project');
      expect(result.modelSaved).toBe(false);
      expect(result.workItemsInserted).toBe(0);
      expect(result.artifactsInserted).toBe(0);
    });
  });

  // =========================================================================
  // Test 4: exportSessionSnapshot() returns snapshot on 200, null on 404
  // =========================================================================

  describe('Test 3.4: exportSessionSnapshot()', () => {
    it('should return snapshot on 200 response', async () => {
      // Arrange
      const mockSnapshot = {
        meta: {
          snapshot_version: 1,
          exported_at: '2026-01-22T00:00:00Z',
          export_kind: 'FULL',
        },
        project: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          name: 'Test Project',
        },
        model: null,
        work_items: [],
        artifacts: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockSnapshot),
      });

      // Act
      const result = await exportSessionSnapshot();

      // Assert
      expect(mockFetch).toHaveBeenCalledWith('/api/project-session/export');
      expect(result).not.toBeNull();
      expect(result?.project.name).toBe('Test Project');
      expect(result?.meta.snapshot_version).toBe(1);
    });

    it('should return null on 404 response', async () => {
      // Arrange
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      // Act
      const result = await exportSessionSnapshot();

      // Assert
      expect(mockFetch).toHaveBeenCalledWith('/api/project-session/export');
      expect(result).toBeNull();
    });

    it('should throw Error on other failures', async () => {
      // Arrange
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      // Act & Assert
      await expect(exportSessionSnapshot()).rejects.toThrow('Failed to export session snapshot');
    });
  });

  // =========================================================================
  // Test 5: clearSession() calls POST and handles success
  // =========================================================================

  describe('Test 3.5: clearSession()', () => {
    it('should call POST and handle success', async () => {
      // Arrange
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
      });

      // Act
      await clearSession();

      // Assert
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/project-session/clear',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should throw Error on failure', async () => {
      // Arrange
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      // Act & Assert
      await expect(clearSession()).rejects.toThrow('Failed to clear session');
    });
  });
});
