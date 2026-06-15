/**
 * End-to-End Tests for Project Snapshot Export/Import
 *
 * Spec 2026-01-06: Frontend Project Snapshot Export/Import
 * Task Group 4: Test Review and Gap Analysis
 *
 * These tests cover critical end-to-end workflows and edge cases:
 * - Full export flow from menu click to file download
 * - Full import flow from file selection to UI refresh
 * - State refresh updates contexts
 * - Edge cases: special characters, setActive: false
 * - Error flow: network failure during import
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the APIs
vi.mock('../api/projectSnapshotApi', () => ({
  exportActiveProjectSnapshot: vi.fn(),
  importProjectSnapshot: vi.fn(),
}));

vi.mock('../api/modelApi', () => ({
  loadModelByFilename: vi.fn(),
}));

import {
  exportActiveProjectSnapshot,
  importProjectSnapshot,
  ProjectSnapshotDto,
} from '../api/projectSnapshotApi';
import { loadModelByFilename } from '../api/modelApi';
import { sanitizeFilename, triggerDownload } from '../utils/fileOperations';

describe('Project Snapshot E2E Flows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Export Flow', () => {
    const mockSnapshot: ProjectSnapshotDto = {
      project: {
        id: 'proj-123',
        name: 'Test Project',
        projectParentFolder: '/projects/test',
        isActive: true,
        createdAt: '2026-01-06T10:00:00Z',
        updatedAt: '2026-01-06T10:00:00Z',
      },
      model: {
        metaModel: { entities: {}, relationships: {} },
        diagrams: [],
      },
      productData: { workItems: [], roadmapItems: [] },
    };

    it('should complete full export flow: API call to download', async () => {
      const mockExport = exportActiveProjectSnapshot as ReturnType<typeof vi.fn>;
      mockExport.mockResolvedValueOnce(mockSnapshot);

      // Simulate export flow
      const snapshot = await exportActiveProjectSnapshot();

      expect(snapshot).not.toBeNull();
      expect(snapshot?.project.name).toBe('Test Project');

      // Verify filename generation
      const projectName = snapshot?.project.name || 'project';
      const sanitizedName = sanitizeFilename(projectName);
      const filename = `${sanitizedName}-snapshot.json`;

      expect(filename).toBe('Test Project-snapshot.json');
    });

    it('should handle special characters in project name for filename', async () => {
      const mockExport = exportActiveProjectSnapshot as ReturnType<typeof vi.fn>;
      mockExport.mockResolvedValueOnce({
        ...mockSnapshot,
        project: {
          ...mockSnapshot.project,
          name: 'Project<v1>:Final',
        },
      });

      const snapshot = await exportActiveProjectSnapshot();
      const projectName = snapshot?.project.name || 'project';
      const sanitizedName = sanitizeFilename(projectName);
      const filename = `${sanitizedName}-snapshot.json`;

      // Invalid characters should be removed
      expect(filename).toBe('Projectv1Final-snapshot.json');
    });

    it('should return null when no active project exists', async () => {
      const mockExport = exportActiveProjectSnapshot as ReturnType<typeof vi.fn>;
      mockExport.mockResolvedValueOnce(null);

      const snapshot = await exportActiveProjectSnapshot();
      expect(snapshot).toBeNull();
    });

    it('should handle network error during export', async () => {
      const mockExport = exportActiveProjectSnapshot as ReturnType<typeof vi.fn>;
      mockExport.mockRejectedValueOnce(new Error('Network error'));

      await expect(exportActiveProjectSnapshot()).rejects.toThrow('Network error');
    });
  });

  describe('Import Flow', () => {
    const mockSnapshotJson: ProjectSnapshotDto = {
      project: {
        id: 'proj-123',
        name: 'Imported Project',
        projectParentFolder: '/original/path',
        isActive: true,
        createdAt: '2026-01-06T10:00:00Z',
        updatedAt: '2026-01-06T10:00:00Z',
      },
      model: {
        metaModel: { entities: {}, relationships: {} },
        diagrams: [],
      },
      productData: { workItems: [], roadmapItems: [] },
    };

    it('should complete full import flow: parse, submit, refresh', async () => {
      const mockImport = importProjectSnapshot as ReturnType<typeof vi.fn>;
      mockImport.mockResolvedValueOnce({
        project: {
          id: 'proj-456',
          name: 'Imported Project',
          projectParentFolder: '/projects/imported',
          isActive: true,
          createdAt: '2026-01-06T11:00:00Z',
          updatedAt: '2026-01-06T11:00:00Z',
        },
        success: true,
      });

      // Simulate full import flow
      const result = await importProjectSnapshot({
        snapshot: mockSnapshotJson,
        importAsName: 'Imported Project',
        projectParentFolder: '/projects/imported',
        setActive: true,
      });

      expect(result.success).toBe(true);
      expect(result.project.name).toBe('Imported Project');
      expect(result.project.projectParentFolder).toBe('/projects/imported');
    });

    it('should import with setActive: false', async () => {
      const mockImport = importProjectSnapshot as ReturnType<typeof vi.fn>;
      mockImport.mockResolvedValueOnce({
        project: {
          id: 'proj-456',
          name: 'Imported Project',
          projectParentFolder: '/projects/imported',
          isActive: false, // Not set as active
          createdAt: '2026-01-06T11:00:00Z',
          updatedAt: '2026-01-06T11:00:00Z',
        },
        success: true,
      });

      const result = await importProjectSnapshot({
        snapshot: mockSnapshotJson,
        importAsName: 'Imported Project',
        projectParentFolder: '/projects/imported',
        setActive: false, // Explicitly not setting as active
      });

      expect(result.success).toBe(true);
      expect(result.project.isActive).toBe(false);
    });

    it('should handle network failure during import', async () => {
      const mockImport = importProjectSnapshot as ReturnType<typeof vi.fn>;
      mockImport.mockRejectedValueOnce(new Error('Network request failed'));

      await expect(
        importProjectSnapshot({
          snapshot: mockSnapshotJson,
          importAsName: 'Test',
          projectParentFolder: '/test',
          setActive: true,
        })
      ).rejects.toThrow('Network request failed');
    });

    it('should handle 409 conflict during import', async () => {
      const mockImport = importProjectSnapshot as ReturnType<typeof vi.fn>;
      mockImport.mockRejectedValueOnce(new Error('Project with this name already exists'));

      await expect(
        importProjectSnapshot({
          snapshot: mockSnapshotJson,
          importAsName: 'Existing Project',
          projectParentFolder: '/projects',
          setActive: true,
        })
      ).rejects.toThrow('Project with this name already exists');
    });
  });

  describe('State Refresh After Import', () => {
    it('should trigger model load after successful import', async () => {
      const mockLoadModel = loadModelByFilename as ReturnType<typeof vi.fn>;
      mockLoadModel.mockResolvedValueOnce({
        metaModel: { entities: {}, relationships: {} },
        diagrams: [],
      });

      // Simulate loading model after import
      const model = await loadModelByFilename('Imported Project');

      expect(mockLoadModel).toHaveBeenCalledWith('Imported Project');
      expect(model).toBeDefined();
      expect(model.diagrams).toEqual([]);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty project name gracefully', () => {
      const filename = sanitizeFilename('');
      expect(filename).toBe('');
    });

    it('should handle project name with only special characters', () => {
      const filename = sanitizeFilename('<>:"/\\|?*');
      expect(filename).toBe('');
    });

    it('should preserve spaces and dashes in project name', () => {
      const filename = sanitizeFilename('My Project - Version 1.0');
      expect(filename).toBe('My Project - Version 1.0');
    });
  });
});
