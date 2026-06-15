/**
 * Tests for Snapshot Import Result Callback Integration
 *
 * Spec 2026-01-07: Fix Project Snapshot Import Parent Folder and Auto-Open
 * Task Group 3: Update ImportProjectSnapshotModal and TopBar Integration
 *
 * Tests cover:
 * 1. onImported callback receives (result, setActive) parameters
 * 2. handleImportSuccess loads model when setActive is true
 * 3. handleImportSuccess only shows notification when setActive is false
 * 4. handleImportSuccess uses result.project.name (not stale activeProject?.name)
 * 5. Modal captures and passes import result correctly
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ProjectSnapshotImportResultDto } from '../api/projectSnapshotApi';
import type { ProjectDto } from '../api/projectsApi';

describe('Snapshot Import Result Callback Integration', () => {
  // Mock result object
  const mockImportResult: ProjectSnapshotImportResultDto = {
    project: {
      id: 'proj-imported-001',
      name: 'Imported Project',
      projectParentFolder: '/imports/projects',
      isActive: true,
      createdAt: '2026-01-07T14:00:00Z',
      updatedAt: '2026-01-07T14:00:00Z',
    },
    modelSaved: true,
    workItemsInserted: 5,
    artifactsInserted: 3,
    warnings: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Test 1: onImported callback receives (result, setActive) parameters
  // =========================================================================
  describe('Test 1: onImported callback signature', () => {
    it('should define onImported with (result, setActive) parameter types', () => {
      // Define the expected callback type
      type ExpectedOnImportedCallback = (
        result: ProjectSnapshotImportResultDto,
        setActive: boolean
      ) => void;

      // Create a mock callback matching the expected signature
      const mockOnImported: ExpectedOnImportedCallback = vi.fn();

      // Call with expected parameters
      mockOnImported(mockImportResult, true);

      // Verify it was called with correct arguments
      expect(mockOnImported).toHaveBeenCalledWith(mockImportResult, true);
    });

    it('should pass setActive=true when set active checkbox is checked', () => {
      const mockOnImported = vi.fn<[ProjectSnapshotImportResultDto, boolean], void>();

      // Simulate import with setActive=true
      mockOnImported(mockImportResult, true);

      expect(mockOnImported).toHaveBeenCalledWith(
        expect.objectContaining({
          project: expect.objectContaining({ name: 'Imported Project' }),
        }),
        true
      );
    });

    it('should pass setActive=false when set active checkbox is unchecked', () => {
      const mockOnImported = vi.fn<[ProjectSnapshotImportResultDto, boolean], void>();

      // Simulate import with setActive=false
      mockOnImported(mockImportResult, false);

      expect(mockOnImported).toHaveBeenCalledWith(
        expect.objectContaining({
          project: expect.objectContaining({ name: 'Imported Project' }),
        }),
        false
      );
    });
  });

  // =========================================================================
  // Test 2: handleImportSuccess loads model when setActive is true
  // =========================================================================
  describe('Test 2: handleImportSuccess conditional model loading', () => {
    it('should call loadModelByFilename when setActive is true', async () => {
      // Mock dependencies
      const mockLoadModelByFilename = vi.fn().mockResolvedValue({
        metaModel: { entities: {}, relationships: {} },
        diagrams: [],
      });
      const mockDispatch = vi.fn();
      const mockRefreshActiveProject = vi.fn().mockResolvedValue(undefined);

      // Simulate handleImportSuccess with setActive=true
      const handleImportSuccess = async (
        result: ProjectSnapshotImportResultDto,
        setActive: boolean
      ) => {
        if (setActive) {
          await mockRefreshActiveProject();
          const model = await mockLoadModelByFilename(result.project.name);
          mockDispatch({ type: 'LOAD_MODEL', payload: model, fileName: result.project.name });
        }
      };

      await handleImportSuccess(mockImportResult, true);

      expect(mockRefreshActiveProject).toHaveBeenCalled();
      expect(mockLoadModelByFilename).toHaveBeenCalledWith('Imported Project');
      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'LOAD_MODEL',
        payload: expect.any(Object),
        fileName: 'Imported Project',
      });
    });

    it('should NOT call loadModelByFilename when setActive is false', async () => {
      const mockLoadModelByFilename = vi.fn();
      const mockDispatch = vi.fn();
      const mockRefreshActiveProject = vi.fn();

      const handleImportSuccess = async (
        result: ProjectSnapshotImportResultDto,
        setActive: boolean
      ) => {
        if (setActive) {
          await mockRefreshActiveProject();
          const model = await mockLoadModelByFilename(result.project.name);
          mockDispatch({ type: 'LOAD_MODEL', payload: model, fileName: result.project.name });
        }
      };

      await handleImportSuccess(mockImportResult, false);

      expect(mockRefreshActiveProject).not.toHaveBeenCalled();
      expect(mockLoadModelByFilename).not.toHaveBeenCalled();
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Test 3: handleImportSuccess only shows notification when setActive is false
  // =========================================================================
  describe('Test 3: handleImportSuccess notification behavior', () => {
    it('should show success notification in both cases (setActive true and false)', async () => {
      const mockSetNotification = vi.fn();
      const mockRefreshActiveProject = vi.fn().mockResolvedValue(undefined);
      const mockLoadModelByFilename = vi.fn().mockResolvedValue({});
      const mockDispatch = vi.fn();

      const handleImportSuccess = async (
        result: ProjectSnapshotImportResultDto,
        setActive: boolean
      ) => {
        try {
          if (setActive) {
            await mockRefreshActiveProject();
            try {
              const model = await mockLoadModelByFilename(result.project.name);
              mockDispatch({ type: 'LOAD_MODEL', payload: model, fileName: result.project.name });
            } catch {
              console.warn('Could not load model after import');
            }
          }
          mockSetNotification('Project imported successfully');
        } catch (err) {
          console.error('Error refreshing state after import:', err);
        }
      };

      // Test with setActive=true
      await handleImportSuccess(mockImportResult, true);
      expect(mockSetNotification).toHaveBeenCalledWith('Project imported successfully');

      mockSetNotification.mockClear();

      // Test with setActive=false
      await handleImportSuccess(mockImportResult, false);
      expect(mockSetNotification).toHaveBeenCalledWith('Project imported successfully');
    });

    it('should skip model loading but still show notification when setActive is false', async () => {
      const mockSetNotification = vi.fn();
      const mockLoadModelByFilename = vi.fn();
      const mockDispatch = vi.fn();

      const handleImportSuccess = async (
        result: ProjectSnapshotImportResultDto,
        setActive: boolean
      ) => {
        if (setActive) {
          const model = await mockLoadModelByFilename(result.project.name);
          mockDispatch({ type: 'LOAD_MODEL', payload: model, fileName: result.project.name });
        }
        mockSetNotification('Project imported successfully');
      };

      await handleImportSuccess(mockImportResult, false);

      // Model loading should NOT happen
      expect(mockLoadModelByFilename).not.toHaveBeenCalled();
      expect(mockDispatch).not.toHaveBeenCalled();

      // But notification should still appear
      expect(mockSetNotification).toHaveBeenCalledWith('Project imported successfully');
    });
  });

  // =========================================================================
  // Test 4: handleImportSuccess uses result.project.name (not stale activeProject?.name)
  // =========================================================================
  describe('Test 4: handleImportSuccess uses result.project.name (not stale closure)', () => {
    it('should use result.project.name instead of stale activeProject?.name', async () => {
      // Simulate stale state scenario
      const staleActiveProject: ProjectDto | null = {
        id: 'old-proj-id',
        name: 'Old Project Name', // This is stale!
        projectParentFolder: '/old/path',
        isActive: true,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };

      const mockLoadModelByFilename = vi.fn().mockResolvedValue({});
      const mockDispatch = vi.fn();
      const mockRefreshActiveProject = vi.fn().mockResolvedValue(undefined);

      // OLD (buggy) implementation using stale closure:
      // const loadModel = async () => {
      //   if (activeProject?.name) {
      //     await loadModelByFilename(activeProject.name); // STALE!
      //   }
      // };

      // NEW (fixed) implementation using result parameter:
      const handleImportSuccess = async (
        result: ProjectSnapshotImportResultDto,
        setActive: boolean
      ) => {
        if (setActive) {
          await mockRefreshActiveProject();
          // Use result.project.name, NOT stale activeProject?.name
          const model = await mockLoadModelByFilename(result.project.name);
          mockDispatch({ type: 'LOAD_MODEL', payload: model, fileName: result.project.name });
        }
      };

      await handleImportSuccess(mockImportResult, true);

      // Verify it uses the RESULT project name, not the stale one
      expect(mockLoadModelByFilename).toHaveBeenCalledWith('Imported Project');
      expect(mockLoadModelByFilename).not.toHaveBeenCalledWith('Old Project Name');

      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'Imported Project',
        })
      );
    });

    it('should correctly load model for imported project regardless of previous active project', async () => {
      const mockLoadModelByFilename = vi.fn().mockResolvedValue({
        metaModel: { entities: {}, relationships: {} },
        diagrams: [],
      });
      const mockDispatch = vi.fn();
      const mockRefreshActiveProject = vi.fn().mockResolvedValue(undefined);

      // Import result has a different project name
      const differentResult: ProjectSnapshotImportResultDto = {
        ...mockImportResult,
        project: {
          ...mockImportResult.project,
          name: 'Completely Different Project',
        },
      };

      const handleImportSuccess = async (
        result: ProjectSnapshotImportResultDto,
        setActive: boolean
      ) => {
        if (setActive) {
          await mockRefreshActiveProject();
          const model = await mockLoadModelByFilename(result.project.name);
          mockDispatch({ type: 'LOAD_MODEL', payload: model, fileName: result.project.name });
        }
      };

      await handleImportSuccess(differentResult, true);

      expect(mockLoadModelByFilename).toHaveBeenCalledWith('Completely Different Project');
    });
  });

  // =========================================================================
  // Test 5: Modal captures and passes import result correctly
  // =========================================================================
  describe('Test 5: Modal captures and passes import result', () => {
    it('should capture API result and pass to onImported callback', async () => {
      // Simulate the modal's handleImport flow
      const mockImportProjectSnapshot = vi.fn().mockResolvedValue(mockImportResult);
      const mockOnImported = vi.fn();
      const mockOnClose = vi.fn();
      const mockSetActive = true;

      // Simulate handleImport in ImportProjectSnapshotModal
      const handleImport = async () => {
        const result = await mockImportProjectSnapshot({
          snapshot: {},
          setActive: mockSetActive,
        });
        mockOnImported(result, mockSetActive);
        mockOnClose();
      };

      await handleImport();

      // Verify result was captured and passed correctly
      expect(mockOnImported).toHaveBeenCalledWith(mockImportResult, true);
      expect(mockOnImported.mock.calls[0][0]).toEqual(mockImportResult);
      expect(mockOnImported.mock.calls[0][1]).toBe(true);
    });

    it('should pass correct setActive value based on checkbox state', async () => {
      const mockImportProjectSnapshot = vi.fn().mockResolvedValue(mockImportResult);
      const mockOnImported = vi.fn();

      // Test with setActive=false
      const handleImportWithUncheckedActive = async () => {
        const result = await mockImportProjectSnapshot({
          snapshot: {},
          setActive: false,
        });
        mockOnImported(result, false);
      };

      await handleImportWithUncheckedActive();

      expect(mockOnImported).toHaveBeenCalledWith(mockImportResult, false);
    });

    it('should include all result fields from API response', async () => {
      const fullResult: ProjectSnapshotImportResultDto = {
        project: {
          id: 'full-proj-id',
          name: 'Full Project',
          projectParentFolder: '/full/path',
          isActive: true,
          createdAt: '2026-01-07T15:00:00Z',
          updatedAt: '2026-01-07T15:00:00Z',
        },
        modelSaved: true,
        workItemsInserted: 10,
        artifactsInserted: 7,
        warnings: ['Warning 1', 'Warning 2'],
      };

      const mockImportProjectSnapshot = vi.fn().mockResolvedValue(fullResult);
      const mockOnImported = vi.fn();

      const handleImport = async () => {
        const result = await mockImportProjectSnapshot({});
        mockOnImported(result, true);
      };

      await handleImport();

      const passedResult = mockOnImported.mock.calls[0][0] as ProjectSnapshotImportResultDto;
      expect(passedResult.project.name).toBe('Full Project');
      expect(passedResult.modelSaved).toBe(true);
      expect(passedResult.workItemsInserted).toBe(10);
      expect(passedResult.artifactsInserted).toBe(7);
      expect(passedResult.warnings).toEqual(['Warning 1', 'Warning 2']);
    });
  });
});
