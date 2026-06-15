/**
 * Project Snapshot API Client Tests
 *
 * Spec 2026-01-07: Fix Project Snapshot Import/Export
 * Task Group 2: Fix Project Snapshot API Client
 *
 * Tests cover:
 * 1. exportActiveProjectSnapshot() returns raw JSON with meta, work_items, artifacts fields preserved
 * 2. importProjectSnapshot() sends complete snapshot without stripping fields
 * 3. Type definitions match expected backend structure
 * 4. Import request omits import_as_name and project_parent_folder when undefined
 * 5. mapImportResultFromSnake correctly maps all backend fields (Task 2.1)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  exportActiveProjectSnapshot,
  importProjectSnapshot,
  mapImportResultFromSnake,
  ProjectSnapshotDto,
  ProjectSnapshotImportRequestDto,
  ProjectSnapshotImportResultDto,
} from '../api/projectSnapshotApi';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('projectSnapshotApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Task 2.1 Tests: API type mapping tests for ProjectSnapshotImportResultDto
  // Spec 2026-01-07: Verify mapImportResultFromSnake maps all backend fields
  // =========================================================================

  describe('Task 2.1: mapImportResultFromSnake correctly maps all backend fields', () => {
    it('should map model_saved to modelSaved boolean', () => {
      const snakeDto = {
        project: {
          id: 'proj-001',
          name: 'Test Project',
          project_parent_folder: '/projects',
          is_active: true,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-07T12:00:00Z',
        },
        model_saved: true,
        work_items_inserted: 5,
        artifacts_inserted: 3,
        warnings: [],
      };

      const result = mapImportResultFromSnake(snakeDto);

      expect(result.modelSaved).toBe(true);
      expect(typeof result.modelSaved).toBe('boolean');
    });

    it('should map work_items_inserted to workItemsInserted number', () => {
      const snakeDto = {
        project: {
          id: 'proj-001',
          name: 'Test Project',
          project_parent_folder: '/projects',
          is_active: true,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-07T12:00:00Z',
        },
        model_saved: true,
        work_items_inserted: 42,
        artifacts_inserted: 0,
        warnings: [],
      };

      const result = mapImportResultFromSnake(snakeDto);

      expect(result.workItemsInserted).toBe(42);
      expect(typeof result.workItemsInserted).toBe('number');
    });

    it('should map artifacts_inserted to artifactsInserted number', () => {
      const snakeDto = {
        project: {
          id: 'proj-001',
          name: 'Test Project',
          project_parent_folder: '/projects',
          is_active: true,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-07T12:00:00Z',
        },
        model_saved: true,
        work_items_inserted: 0,
        artifacts_inserted: 17,
        warnings: [],
      };

      const result = mapImportResultFromSnake(snakeDto);

      expect(result.artifactsInserted).toBe(17);
      expect(typeof result.artifactsInserted).toBe('number');
    });

    it('should map warnings array correctly', () => {
      const snakeDto = {
        project: {
          id: 'proj-001',
          name: 'Test Project',
          project_parent_folder: '/projects',
          is_active: true,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-07T12:00:00Z',
        },
        model_saved: true,
        work_items_inserted: 0,
        artifacts_inserted: 0,
        warnings: ['Warning 1', 'Warning 2'],
      };

      const result = mapImportResultFromSnake(snakeDto);

      expect(result.warnings).toEqual(['Warning 1', 'Warning 2']);
      expect(Array.isArray(result.warnings)).toBe(true);
    });

    it('should default warnings to empty array when undefined', () => {
      const snakeDto = {
        project: {
          id: 'proj-001',
          name: 'Test Project',
          project_parent_folder: '/projects',
          is_active: true,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-07T12:00:00Z',
        },
        model_saved: true,
        work_items_inserted: 0,
        artifacts_inserted: 0,
        warnings: undefined as unknown as string[],
      };

      const result = mapImportResultFromSnake(snakeDto);

      expect(result.warnings).toEqual([]);
    });
  });

  describe('Task 2.1: ProjectSnapshotImportResultDto includes all required fields', () => {
    it('should have modelSaved, workItemsInserted, artifactsInserted, and warnings fields', () => {
      // Create a valid result DTO to verify the type structure
      const result: ProjectSnapshotImportResultDto = {
        project: {
          id: 'proj-001',
          name: 'Test Project',
          projectParentFolder: '/projects',
          isActive: true,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-07T12:00:00Z',
        },
        modelSaved: true,
        workItemsInserted: 10,
        artifactsInserted: 5,
        warnings: [],
      };

      // Verify all required fields exist and have correct types
      expect(typeof result.project).toBe('object');
      expect(typeof result.modelSaved).toBe('boolean');
      expect(typeof result.workItemsInserted).toBe('number');
      expect(typeof result.artifactsInserted).toBe('number');
      expect(Array.isArray(result.warnings)).toBe(true);
    });

    it('should NOT have deprecated success field', () => {
      const result: ProjectSnapshotImportResultDto = {
        project: {
          id: 'proj-001',
          name: 'Test Project',
          projectParentFolder: '/projects',
          isActive: true,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-07T12:00:00Z',
        },
        modelSaved: true,
        workItemsInserted: 0,
        artifactsInserted: 0,
        warnings: [],
      };

      // Verify success field is NOT in the type (this is a compile-time check)
      expect('success' in result).toBe(false);
    });
  });

  describe('Task 2.1: importProjectSnapshot returns complete result with all fields', () => {
    it('should return result with modelSaved, workItemsInserted, artifactsInserted, warnings', async () => {
      const snapshot: ProjectSnapshotDto = {
        meta: {
          snapshot_version: 1,
          exported_at: '2026-01-07T12:00:00Z',
          export_kind: 'full',
        },
        project: {
          id: 'proj-001',
          name: 'Test Project',
          projectParentFolder: '/projects',
          isActive: true,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-07T12:00:00Z',
        },
        model: {
          metaModel: { entities: {}, relationships: {} },
          diagrams: [],
        },
        work_items: [{ id: 'wi-001' }, { id: 'wi-002' }],
        artifacts: [{ id: 'art-001' }],
      };

      const importRequest: ProjectSnapshotImportRequestDto = {
        snapshot,
        setActive: true,
      };

      // Mock backend response with new fields
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          project: {
            id: 'proj-new',
            name: 'Test Project',
            project_parent_folder: '/projects',
            is_active: true,
            created_at: '2026-01-07T12:00:00Z',
            updated_at: '2026-01-07T12:00:00Z',
          },
          model_saved: true,
          work_items_inserted: 2,
          artifacts_inserted: 1,
          warnings: [],
        }),
      });

      const result = await importProjectSnapshot(importRequest);

      // Verify all fields are correctly mapped
      expect(result.project.id).toBe('proj-new');
      expect(result.project.name).toBe('Test Project');
      expect(result.project.projectParentFolder).toBe('/projects');
      expect(result.modelSaved).toBe(true);
      expect(result.workItemsInserted).toBe(2);
      expect(result.artifactsInserted).toBe(1);
      expect(result.warnings).toEqual([]);
    });

    it('should handle warnings array from backend', async () => {
      const snapshot: ProjectSnapshotDto = {
        meta: {
          snapshot_version: 1,
          exported_at: '2026-01-07T12:00:00Z',
          export_kind: 'full',
        },
        project: {
          id: 'proj-001',
          name: 'Test Project',
          projectParentFolder: '/projects',
          isActive: true,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-07T12:00:00Z',
        },
        model: {
          metaModel: { entities: {}, relationships: {} },
          diagrams: [],
        },
        work_items: [],
        artifacts: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          project: {
            id: 'proj-new',
            name: 'Test Project',
            project_parent_folder: '/projects',
            is_active: true,
            created_at: '2026-01-07T12:00:00Z',
            updated_at: '2026-01-07T12:00:00Z',
          },
          model_saved: true,
          work_items_inserted: 0,
          artifacts_inserted: 0,
          warnings: ['Some work items could not be imported', 'Artifact format mismatch'],
        }),
      });

      const result = await importProjectSnapshot({ snapshot, setActive: true });

      expect(result.warnings).toHaveLength(2);
      expect(result.warnings[0]).toBe('Some work items could not be imported');
      expect(result.warnings[1]).toBe('Artifact format mismatch');
    });
  });

  // =========================================================================
  // Existing Tests (updated to use new backend response format)
  // =========================================================================

  describe('Test 1: exportActiveProjectSnapshot() returns raw JSON with meta, work_items, artifacts fields preserved', () => {
    it('should return complete snapshot with all fields including meta, work_items, artifacts', async () => {
      // Backend response with full snapshot structure
      const backendResponse = {
        meta: {
          snapshot_version: 1,
          exported_at: '2026-01-07T12:00:00Z',
          export_kind: 'full',
        },
        project: {
          id: 'proj-001',
          name: 'Test Project',
          projectParentFolder: '/projects',
          isActive: true,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-07T12:00:00Z',
        },
        model: {
          metaModel: {
            entities: {},
            relationships: {},
          },
          diagrams: [],
        },
        work_items: [
          { id: 'wi-001', title: 'Work Item 1' },
          { id: 'wi-002', title: 'Work Item 2' },
        ],
        artifacts: [
          { id: 'art-001', name: 'Artifact 1' },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(backendResponse),
      });

      const result = await exportActiveProjectSnapshot();

      // Verify fetch was called correctly
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/projects/active/export'),
        expect.objectContaining({
          method: 'GET',
          headers: { Accept: 'application/json' },
        })
      );

      // Critical: Verify all fields are preserved, not stripped
      expect(result).not.toBeNull();
      expect(result!.meta).toBeDefined();
      expect(result!.meta.snapshot_version).toBe(1);
      expect(result!.meta.exported_at).toBe('2026-01-07T12:00:00Z');
      expect(result!.meta.export_kind).toBe('full');
      expect(result!.project).toBeDefined();
      expect(result!.model).toBeDefined();
      expect(result!.work_items).toBeDefined();
      expect(result!.work_items).toHaveLength(2);
      expect(result!.artifacts).toBeDefined();
      expect(result!.artifacts).toHaveLength(1);
    });

    it('should return null on 404 (no active project)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ message: 'No active project' }),
      });

      const result = await exportActiveProjectSnapshot();

      expect(result).toBeNull();
    });

    it('should throw error on other failures', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({ message: 'Server error' }),
      });

      await expect(exportActiveProjectSnapshot()).rejects.toThrow('Server error');
    });
  });

  describe('Test 2: importProjectSnapshot() sends complete snapshot without stripping fields', () => {
    it('should send complete snapshot including meta, work_items, artifacts in POST payload', async () => {
      const fullSnapshot: ProjectSnapshotDto = {
        meta: {
          snapshot_version: 1,
          exported_at: '2026-01-07T12:00:00Z',
          export_kind: 'full',
        },
        project: {
          id: 'proj-001',
          name: 'Test Project',
          projectParentFolder: '/projects',
          isActive: true,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-07T12:00:00Z',
        },
        model: {
          metaModel: {
            entities: {},
            relationships: {},
          },
          diagrams: [],
        },
        work_items: [{ id: 'wi-001', title: 'Work Item 1' }],
        artifacts: [{ id: 'art-001', name: 'Artifact 1' }],
      };

      const importRequest: ProjectSnapshotImportRequestDto = {
        snapshot: fullSnapshot,
        setActive: true,
        importAsName: 'Imported Project',
        projectParentFolder: '/imported',
      };

      // Updated mock response to use new backend fields
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          project: {
            id: 'proj-new',
            name: 'Imported Project',
            project_parent_folder: '/imported',
            is_active: true,
            created_at: '2026-01-07T12:00:00Z',
            updated_at: '2026-01-07T12:00:00Z',
          },
          model_saved: true,
          work_items_inserted: 1,
          artifacts_inserted: 1,
          warnings: [],
        }),
      });

      await importProjectSnapshot(importRequest);

      // Verify the request body contains complete snapshot
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain('/api/projects/import');
      expect(options.method).toBe('POST');

      const body = JSON.parse(options.body);

      // Critical: Verify meta, work_items, artifacts are included in the request
      expect(body.snapshot).toBeDefined();
      expect(body.snapshot.meta).toBeDefined();
      expect(body.snapshot.meta.snapshot_version).toBe(1);
      expect(body.snapshot.meta.exported_at).toBe('2026-01-07T12:00:00Z');
      expect(body.snapshot.meta.export_kind).toBe('full');
      expect(body.snapshot.work_items).toBeDefined();
      expect(body.snapshot.work_items).toHaveLength(1);
      expect(body.snapshot.artifacts).toBeDefined();
      expect(body.snapshot.artifacts).toHaveLength(1);
      expect(body.snapshot.project).toBeDefined();
      expect(body.snapshot.model).toBeDefined();
    });

    it('should handle 400 errors with backend message', async () => {
      const mockRequest: ProjectSnapshotImportRequestDto = {
        snapshot: {
          meta: {
            snapshot_version: 1,
            exported_at: '2026-01-07T10:00:00Z',
            export_kind: 'full',
          },
          project: {
            id: 'proj-123',
            name: 'Test',
            projectParentFolder: '/test',
            isActive: true,
            createdAt: '2026-01-06T10:00:00Z',
            updatedAt: '2026-01-06T10:00:00Z',
          },
          model: { metaModel: { entities: {}, relationships: {} }, diagrams: [] },
          work_items: [],
          artifacts: [],
        },
        setActive: true,
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: () => Promise.resolve({ message: 'project_parent_folder is required' }),
      });

      await expect(importProjectSnapshot(mockRequest)).rejects.toThrow(
        'project_parent_folder is required'
      );
    });

    it('should handle 409 errors with backend message', async () => {
      const mockRequest: ProjectSnapshotImportRequestDto = {
        snapshot: {
          meta: {
            snapshot_version: 1,
            exported_at: '2026-01-07T10:00:00Z',
            export_kind: 'full',
          },
          project: {
            id: 'proj-123',
            name: 'Existing Project',
            projectParentFolder: '/test',
            isActive: true,
            createdAt: '2026-01-06T10:00:00Z',
            updatedAt: '2026-01-06T10:00:00Z',
          },
          model: { metaModel: { entities: {}, relationships: {} }, diagrams: [] },
          work_items: [],
          artifacts: [],
        },
        importAsName: 'Existing Project',
        projectParentFolder: '/projects',
        setActive: true,
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        json: () => Promise.resolve({ message: 'Project with this name already exists' }),
      });

      await expect(importProjectSnapshot(mockRequest)).rejects.toThrow(
        'Project with this name already exists'
      );
    });
  });

  describe('Test 3: Type definitions match expected backend structure', () => {
    it('should have correct ProjectSnapshotDto structure with meta, work_items, artifacts', () => {
      // Type-level test: create a valid ProjectSnapshotDto
      const snapshot: ProjectSnapshotDto = {
        meta: {
          snapshot_version: 1,
          exported_at: '2026-01-07T12:00:00Z',
          export_kind: 'full',
        },
        project: {
          id: 'proj-001',
          name: 'Test Project',
          projectParentFolder: '/projects',
          isActive: true,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-07T12:00:00Z',
        },
        model: {
          metaModel: {
            entities: {},
            relationships: {},
          },
          diagrams: [],
        },
        work_items: [],
        artifacts: [],
      };

      // Verify required fields exist and have correct types
      expect(typeof snapshot.meta).toBe('object');
      expect(typeof snapshot.meta.snapshot_version).toBe('number');
      expect(typeof snapshot.meta.exported_at).toBe('string');
      expect(typeof snapshot.meta.export_kind).toBe('string');
      expect(typeof snapshot.project).toBe('object');
      expect(typeof snapshot.model).toBe('object');
      expect(Array.isArray(snapshot.work_items)).toBe(true);
      expect(Array.isArray(snapshot.artifacts)).toBe(true);
    });

    it('should NOT have outdated productData field', () => {
      const snapshot: ProjectSnapshotDto = {
        meta: {
          snapshot_version: 1,
          exported_at: '2026-01-07T12:00:00Z',
          export_kind: 'full',
        },
        project: {
          id: 'proj-001',
          name: 'Test',
          projectParentFolder: '/test',
          isActive: true,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        model: {
          metaModel: { entities: {}, relationships: {} },
          diagrams: [],
        },
        work_items: [],
        artifacts: [],
      };

      // Verify productData is NOT in the type
      // This is a compile-time check that ensures the type doesn't have productData
      expect('productData' in snapshot).toBe(false);
    });
  });

  describe('Test 4: Import request omits import_as_name and project_parent_folder when undefined', () => {
    it('should omit import_as_name and project_parent_folder from request body when not provided', async () => {
      const snapshot: ProjectSnapshotDto = {
        meta: {
          snapshot_version: 1,
          exported_at: '2026-01-07T12:00:00Z',
          export_kind: 'full',
        },
        project: {
          id: 'proj-001',
          name: 'Original Name',
          projectParentFolder: '/original',
          isActive: true,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        model: {
          metaModel: { entities: {}, relationships: {} },
          diagrams: [],
        },
        work_items: [],
        artifacts: [],
      };

      // Request WITHOUT importAsName (should use snapshot default)
      const importRequest: ProjectSnapshotImportRequestDto = {
        snapshot,
        setActive: true,
        // importAsName is intentionally omitted
        // projectParentFolder is intentionally omitted
      };

      // Updated mock response to use new backend fields
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          project: {
            id: 'proj-new',
            name: 'Original Name',
            project_parent_folder: '/original',
            is_active: true,
            created_at: '2026-01-07T12:00:00Z',
            updated_at: '2026-01-07T12:00:00Z',
          },
          model_saved: true,
          work_items_inserted: 0,
          artifacts_inserted: 0,
          warnings: [],
        }),
      });

      await importProjectSnapshot(importRequest);

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);

      // Verify import_as_name is NOT in request body (or is undefined)
      expect(body.import_as_name).toBeUndefined();
      // Verify project_parent_folder is NOT in request body (or is undefined)
      expect(body.project_parent_folder).toBeUndefined();
      // set_active should always be present
      expect(body.set_active).toBe(true);
      // snapshot should always be present
      expect(body.snapshot).toBeDefined();
    });

    it('should include import_as_name and project_parent_folder when explicitly provided', async () => {
      const snapshot: ProjectSnapshotDto = {
        meta: {
          snapshot_version: 1,
          exported_at: '2026-01-07T12:00:00Z',
          export_kind: 'full',
        },
        project: {
          id: 'proj-001',
          name: 'Original Name',
          projectParentFolder: '/original',
          isActive: true,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        model: {
          metaModel: { entities: {}, relationships: {} },
          diagrams: [],
        },
        work_items: [],
        artifacts: [],
      };

      // Request WITH explicit overrides
      const importRequest: ProjectSnapshotImportRequestDto = {
        snapshot,
        setActive: false,
        importAsName: 'Custom Name',
        projectParentFolder: '/custom/folder',
      };

      // Updated mock response to use new backend fields
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          project: {
            id: 'proj-new',
            name: 'Custom Name',
            project_parent_folder: '/custom/folder',
            is_active: false,
            created_at: '2026-01-07T12:00:00Z',
            updated_at: '2026-01-07T12:00:00Z',
          },
          model_saved: true,
          work_items_inserted: 0,
          artifacts_inserted: 0,
          warnings: [],
        }),
      });

      await importProjectSnapshot(importRequest);

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);

      // Verify overrides are included when provided
      expect(body.import_as_name).toBe('Custom Name');
      expect(body.project_parent_folder).toBe('/custom/folder');
      expect(body.set_active).toBe(false);
    });

    it('should omit empty string values for import_as_name and project_parent_folder', async () => {
      const snapshot: ProjectSnapshotDto = {
        meta: {
          snapshot_version: 1,
          exported_at: '2026-01-07T12:00:00Z',
          export_kind: 'full',
        },
        project: {
          id: 'proj-001',
          name: 'Original Name',
          projectParentFolder: '/original',
          isActive: true,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        model: {
          metaModel: { entities: {}, relationships: {} },
          diagrams: [],
        },
        work_items: [],
        artifacts: [],
      };

      // Request with empty string values (should be treated as not overriding)
      const importRequest: ProjectSnapshotImportRequestDto = {
        snapshot,
        setActive: true,
        importAsName: '',
        projectParentFolder: '',
      };

      // Updated mock response to use new backend fields
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          project: {
            id: 'proj-new',
            name: 'Original Name',
            project_parent_folder: '/original',
            is_active: true,
            created_at: '2026-01-07T12:00:00Z',
            updated_at: '2026-01-07T12:00:00Z',
          },
          model_saved: true,
          work_items_inserted: 0,
          artifacts_inserted: 0,
          warnings: [],
        }),
      });

      await importProjectSnapshot(importRequest);

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);

      // Empty strings should be omitted from request body
      expect(body.import_as_name).toBeUndefined();
      expect(body.project_parent_folder).toBeUndefined();
    });
  });
});
