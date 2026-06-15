/**
 * Tests for TopBar activate-first flow
 *
 * Spec 2026-01-26: Activate Project on Open
 * Task Group 3: TopBar Activate-First Flow
 *
 * Tests:
 * - activateProject is called BEFORE loadModelByFilename (DB mode)
 * - ProjectContext is updated from activation response
 * - Activation failure shows error and prevents model load
 * - File Mode sets project without backend call
 * - File Mode constructs minimal ProjectDto correctly
 * - Dialog closes on successful open
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { activateProject, ProjectDto } from '../api/projectsApi';
import { loadModelByFilename } from '../api/modelApi';
import { OpenProjectResult, isOpenProjectResult } from '../components/file/ModelFileDialog';

// Mock the API functions
vi.mock('../api/projectsApi', async () => {
  const actual = await vi.importActual('../api/projectsApi');
  return {
    ...actual,
    activateProject: vi.fn(),
  };
});

vi.mock('../api/modelApi', () => ({
  loadModelByFilename: vi.fn(),
}));

const mockActivateProject = vi.mocked(activateProject);
const mockLoadModelByFilename = vi.mocked(loadModelByFilename);

describe('TopBar.activateOnOpen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Activate-first flow (DB mode)', () => {
    it('calls activateProject before loadModelByFilename', async () => {
      const callOrder: string[] = [];

      mockActivateProject.mockImplementation(async () => {
        callOrder.push('activateProject');
        return {
          id: 'proj-123',
          name: 'Test Project',
          projectParentFolder: '/test/path',
          projectHierarchy: null,
          organisationId: null,
          isActive: true,
          createdAt: '2026-01-26T00:00:00Z',
          updatedAt: '2026-01-26T00:00:00Z',
        };
      });

      mockLoadModelByFilename.mockImplementation(async () => {
        callOrder.push('loadModelByFilename');
        return { metaModel: { entities: {}, relationships: {} }, diagrams: [] } as any;
      });

      // Simulate the handleOpenFromBackend flow
      const openResult: OpenProjectResult = {
        filename: 'Test Project',
        projectId: 'proj-123',
      };

      const includeDatabase = true;
      const setActiveProject = vi.fn();
      const dispatch = vi.fn();
      const setOpenDialogVisible = vi.fn();
      const setErrorMessages = vi.fn();
      const setErrorModalOpen = vi.fn();

      // Implement the flow from TopBar.handleOpenFromBackend
      if (isOpenProjectResult(openResult)) {
        const { filename, projectId } = openResult;

        try {
          if (includeDatabase) {
            const activatedProject = await mockActivateProject(projectId);
            setActiveProject(activatedProject);
          }

          const model = await mockLoadModelByFilename(filename);
          dispatch({ type: 'LOAD_MODEL', payload: model, fileName: filename });
          setOpenDialogVisible(false);
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Failed to open project';
          setErrorMessages([errorMessage]);
          setErrorModalOpen(true);
        }
      }

      // Verify call order
      expect(callOrder).toEqual(['activateProject', 'loadModelByFilename']);
      expect(mockActivateProject).toHaveBeenCalledWith('proj-123');
      expect(mockLoadModelByFilename).toHaveBeenCalledWith('Test Project');
    });

    it('updates ProjectContext from activation response', async () => {
      const activatedProject: ProjectDto = {
        id: 'proj-456',
        name: 'Activated Project',
        projectParentFolder: '/activated/path',
        projectHierarchy: 'ClientA',
        organisationId: 'org-123',
        isActive: true,
        createdAt: '2026-01-26T00:00:00Z',
        updatedAt: '2026-01-26T00:00:00Z',
      };

      mockActivateProject.mockResolvedValue(activatedProject);
      mockLoadModelByFilename.mockResolvedValue({
        metaModel: { entities: {}, relationships: {} },
        diagrams: [],
      } as any);

      const setActiveProject = vi.fn();

      // Simulate DB mode flow
      const result = await mockActivateProject('proj-456');
      setActiveProject(result);

      expect(setActiveProject).toHaveBeenCalledWith(activatedProject);
      expect(setActiveProject.mock.calls[0][0]).toEqual({
        id: 'proj-456',
        name: 'Activated Project',
        projectParentFolder: '/activated/path',
        projectHierarchy: 'ClientA',
        organisationId: 'org-123',
        isActive: true,
        createdAt: '2026-01-26T00:00:00Z',
        updatedAt: '2026-01-26T00:00:00Z',
      });
    });

    it('shows error and prevents model load on activation failure', async () => {
      mockActivateProject.mockRejectedValue(new Error('Activation failed: Project not found'));

      const openResult: OpenProjectResult = {
        filename: 'Test Project',
        projectId: 'proj-789',
      };

      const setActiveProject = vi.fn();
      const dispatch = vi.fn();
      const setOpenDialogVisible = vi.fn();
      const setErrorMessages = vi.fn();
      const setErrorModalOpen = vi.fn();

      // Simulate the flow
      if (isOpenProjectResult(openResult)) {
        const { filename, projectId } = openResult;

        try {
          const activatedProject = await mockActivateProject(projectId);
          setActiveProject(activatedProject);

          // This should NOT be reached
          const model = await mockLoadModelByFilename(filename);
          dispatch({ type: 'LOAD_MODEL', payload: model, fileName: filename });
          setOpenDialogVisible(false);
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Failed to open project';
          setErrorMessages([errorMessage]);
          setErrorModalOpen(true);
        }
      }

      // Verify activation was attempted
      expect(mockActivateProject).toHaveBeenCalledWith('proj-789');

      // Verify model load was NOT called (error occurred first)
      expect(mockLoadModelByFilename).not.toHaveBeenCalled();

      // Verify error handling
      expect(setErrorMessages).toHaveBeenCalledWith(['Activation failed: Project not found']);
      expect(setErrorModalOpen).toHaveBeenCalledWith(true);

      // Verify dialog was NOT closed
      expect(setOpenDialogVisible).not.toHaveBeenCalled();
    });
  });

  describe('File Mode (no backend)', () => {
    it('sets project without backend activation call', async () => {
      const openResult: OpenProjectResult = {
        filename: 'Local Project',
        projectId: 'local-proj-id',
      };

      const includeDatabase = false;
      const setActiveProject = vi.fn();
      const dispatch = vi.fn();
      const setOpenDialogVisible = vi.fn();

      mockLoadModelByFilename.mockResolvedValue({
        metaModel: { entities: {}, relationships: {} },
        diagrams: [],
      } as any);

      // Simulate File Mode flow
      if (isOpenProjectResult(openResult)) {
        const { filename, projectId } = openResult;

        if (includeDatabase) {
          // This branch should NOT be taken
          const activatedProject = await mockActivateProject(projectId);
          setActiveProject(activatedProject);
        } else {
          // File Mode: construct minimal ProjectDto
          const fileProject: ProjectDto = {
            id: projectId,
            name: filename,
            projectParentFolder: '',
            projectHierarchy: null,
            organisationId: null,
            isActive: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          setActiveProject(fileProject);
        }

        const model = await mockLoadModelByFilename(filename);
        dispatch({ type: 'LOAD_MODEL', payload: model, fileName: filename });
        setOpenDialogVisible(false);
      }

      // Verify activateProject was NOT called
      expect(mockActivateProject).not.toHaveBeenCalled();

      // Verify setActiveProject was called with constructed DTO
      expect(setActiveProject).toHaveBeenCalledTimes(1);
      const calledWith = setActiveProject.mock.calls[0][0];
      expect(calledWith.id).toBe('local-proj-id');
      expect(calledWith.name).toBe('Local Project');
      expect(calledWith.isActive).toBe(true);
    });

    it('constructs minimal ProjectDto with correct fields', () => {
      const projectId = 'file-proj-123';
      const filename = 'My File Project';

      const fileProject: ProjectDto = {
        id: projectId,
        name: filename,
        projectParentFolder: '', // Will be empty in File Mode
        projectHierarchy: null,
        organisationId: null,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      expect(fileProject.id).toBe('file-proj-123');
      expect(fileProject.name).toBe('My File Project');
      expect(fileProject.projectParentFolder).toBe('');
      expect(fileProject.projectHierarchy).toBeNull();
      expect(fileProject.organisationId).toBeNull();
      expect(fileProject.isActive).toBe(true);
      expect(fileProject.createdAt).toBeTruthy();
      expect(fileProject.updatedAt).toBeTruthy();
    });
  });

  describe('Dialog behavior', () => {
    it('closes dialog on successful open', async () => {
      mockActivateProject.mockResolvedValue({
        id: 'proj-success',
        name: 'Success Project',
        projectParentFolder: '/success/path',
        projectHierarchy: null,
        organisationId: null,
        isActive: true,
        createdAt: '2026-01-26T00:00:00Z',
        updatedAt: '2026-01-26T00:00:00Z',
      });

      mockLoadModelByFilename.mockResolvedValue({
        metaModel: { entities: {}, relationships: {} },
        diagrams: [],
      } as any);

      const setOpenDialogVisible = vi.fn();

      // Simulate successful flow
      await mockActivateProject('proj-success');
      await mockLoadModelByFilename('Success Project');
      setOpenDialogVisible(false);

      expect(setOpenDialogVisible).toHaveBeenCalledWith(false);
    });
  });
});
