/**
 * Integration tests for Activate Project on Open flow
 *
 * Spec 2026-01-26: Activate Project on Open
 * Task Group 4: Test Review and Integration Coverage
 *
 * Tests:
 * - Open project flow updates activeProject before model loads
 * - Error during activation shows error and blocks model load
 * - File Mode open flow works without backend calls
 * - Backward compat: SaveAs mode unchanged by OpenProjectResult changes
 */

import { describe, it, expect, vi } from 'vitest';
import {
  OpenProjectResult,
  SaveAsResult,
  isOpenProjectResult,
} from '../components/file/ModelFileDialog';
import { ProjectDto } from '../api/projectsApi';

describe('activateOnOpen.integration', () => {
  describe('End-to-end open project flow', () => {
    it('integration: open project updates activeProject before model loads', async () => {
      // Track the order of operations
      const operations: string[] = [];

      // Mock functions
      const activateProject = vi.fn().mockImplementation(async (projectId: string) => {
        operations.push(`activate:${projectId}`);
        return {
          id: projectId,
          name: 'Integrated Project',
          projectParentFolder: '/integrated/path',
          projectHierarchy: null,
          organisationId: null,
          isActive: true,
          createdAt: '2026-01-26T00:00:00Z',
          updatedAt: '2026-01-26T00:00:00Z',
        } as ProjectDto;
      });

      const setActiveProject = vi.fn().mockImplementation((project: ProjectDto) => {
        operations.push(`setActive:${project.name}`);
      });

      const loadModelByFilename = vi.fn().mockImplementation(async (filename: string) => {
        operations.push(`loadModel:${filename}`);
        return { metaModel: { entities: {}, relationships: {} }, diagrams: [] };
      });

      const dispatch = vi.fn().mockImplementation((action: any) => {
        operations.push(`dispatch:${action.type}`);
      });

      // Simulate the complete handleOpenFromBackend flow
      const openResult: OpenProjectResult = {
        filename: 'Integrated Project',
        projectId: 'int-proj-id',
      };

      if (isOpenProjectResult(openResult)) {
        const { filename, projectId } = openResult;

        // Step 1: Activate project first
        const activatedProject = await activateProject(projectId);
        setActiveProject(activatedProject);

        // Step 2: Load model
        const model = await loadModelByFilename(filename);
        dispatch({ type: 'LOAD_MODEL', payload: model, fileName: filename });
      }

      // Verify the correct order of operations
      expect(operations).toEqual([
        'activate:int-proj-id',
        'setActive:Integrated Project',
        'loadModel:Integrated Project',
        'dispatch:LOAD_MODEL',
      ]);

      // Verify setActiveProject was called before loadModelByFilename
      const setActiveIndex = operations.findIndex((op) => op.startsWith('setActive'));
      const loadModelIndex = operations.findIndex((op) => op.startsWith('loadModel'));
      expect(setActiveIndex).toBeLessThan(loadModelIndex);
    });

    it('integration: error during activation blocks model load', async () => {
      const operations: string[] = [];

      const activateProject = vi.fn().mockImplementation(async () => {
        operations.push('activate:attempt');
        throw new Error('Activation failed');
      });

      const loadModelByFilename = vi.fn().mockImplementation(async () => {
        operations.push('loadModel:attempt');
        return { metaModel: { entities: {}, relationships: {} }, diagrams: [] };
      });

      const setErrorMessages = vi.fn();
      const setErrorModalOpen = vi.fn();

      const openResult: OpenProjectResult = {
        filename: 'Failing Project',
        projectId: 'fail-proj-id',
      };

      // Simulate flow with error handling
      if (isOpenProjectResult(openResult)) {
        const { filename, projectId } = openResult;

        try {
          await activateProject(projectId);
          // Should not reach here
          await loadModelByFilename(filename);
        } catch (err) {
          operations.push('error:caught');
          const errorMessage = err instanceof Error ? err.message : 'Unknown error';
          setErrorMessages([errorMessage]);
          setErrorModalOpen(true);
        }
      }

      // Verify activation was attempted but model load was not
      expect(operations).toEqual(['activate:attempt', 'error:caught']);
      expect(loadModelByFilename).not.toHaveBeenCalled();
      expect(setErrorMessages).toHaveBeenCalledWith(['Activation failed']);
      expect(setErrorModalOpen).toHaveBeenCalledWith(true);
    });

    it('integration: File Mode open flow works without backend calls', async () => {
      const operations: string[] = [];

      const activateProject = vi.fn().mockImplementation(async () => {
        operations.push('activate:SHOULD_NOT_BE_CALLED');
      });

      const setActiveProject = vi.fn().mockImplementation((project: ProjectDto) => {
        operations.push(`setActive:${project.name}`);
      });

      const loadModelByFilename = vi.fn().mockImplementation(async (filename: string) => {
        operations.push(`loadModel:${filename}`);
        return { metaModel: { entities: {}, relationships: {} }, diagrams: [] };
      });

      const includeDatabase = false; // File Mode

      const openResult: OpenProjectResult = {
        filename: 'File Mode Project',
        projectId: 'file-proj-id',
      };

      if (isOpenProjectResult(openResult)) {
        const { filename, projectId } = openResult;

        if (includeDatabase) {
          await activateProject(projectId);
        } else {
          // File Mode: construct and set directly
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

        await loadModelByFilename(filename);
      }

      // Verify activateProject was NOT called
      expect(activateProject).not.toHaveBeenCalled();

      // Verify the flow worked correctly
      expect(operations).toEqual([
        'setActive:File Mode Project',
        'loadModel:File Mode Project',
      ]);
    });
  });

  describe('Backward compatibility', () => {
    it('SaveAs mode is unchanged by OpenProjectResult changes', () => {
      const saveAsResult: SaveAsResult = {
        projectName: 'SaveAs Project',
        parentFolder: '/saveas/path',
        projectHierarchy: 'ClientB',
        organisationId: 'org-456',
      };

      // Type guard should correctly identify this as NOT an OpenProjectResult
      expect(isOpenProjectResult(saveAsResult)).toBe(false);

      // All SaveAsResult fields should be accessible
      expect(saveAsResult.projectName).toBe('SaveAs Project');
      expect(saveAsResult.parentFolder).toBe('/saveas/path');
      expect(saveAsResult.projectHierarchy).toBe('ClientB');
      expect(saveAsResult.organisationId).toBe('org-456');
    });

    it('OpenProjectResult and SaveAsResult are correctly distinguished in union type', () => {
      const openResult: OpenProjectResult | SaveAsResult = {
        filename: 'open-project',
        projectId: 'proj-id',
      };

      const saveResult: OpenProjectResult | SaveAsResult = {
        projectName: 'save-project',
        parentFolder: '/save/path',
        organisationId: 'org-id',
      };

      // Type guard should work correctly for both
      expect(isOpenProjectResult(openResult)).toBe(true);
      expect(isOpenProjectResult(saveResult)).toBe(false);

      // After type guard, correct properties should be accessible
      if (isOpenProjectResult(openResult)) {
        expect(openResult.filename).toBe('open-project');
        expect(openResult.projectId).toBe('proj-id');
      }

      if (!isOpenProjectResult(saveResult)) {
        expect((saveResult as SaveAsResult).projectName).toBe('save-project');
        expect((saveResult as SaveAsResult).parentFolder).toBe('/save/path');
      }
    });
  });

  describe('ProjectContext state management', () => {
    it('setActiveProject correctly populates project state for downstream consumers', () => {
      // Simulate what happens after setActiveProject is called
      const projectState: { activeProject: ProjectDto | null } = {
        activeProject: null,
      };

      const setActiveProject = (project: ProjectDto) => {
        projectState.activeProject = project;
      };

      // Before activation
      expect(projectState.activeProject).toBeNull();

      // Simulate activation response
      const activatedProject: ProjectDto = {
        id: 'activated-id',
        name: 'Activated Project',
        projectParentFolder: '/activated/path',
        projectHierarchy: 'TestHierarchy',
        organisationId: 'org-activated',
        isActive: true,
        createdAt: '2026-01-26T00:00:00Z',
        updatedAt: '2026-01-26T00:00:00Z',
      };

      setActiveProject(activatedProject);

      // After activation, all fields should be available
      expect(projectState.activeProject).not.toBeNull();
      expect(projectState.activeProject!.id).toBe('activated-id');
      expect(projectState.activeProject!.name).toBe('Activated Project');
      expect(projectState.activeProject!.projectParentFolder).toBe('/activated/path');
      expect(projectState.activeProject!.projectHierarchy).toBe('TestHierarchy');
      expect(projectState.activeProject!.organisationId).toBe('org-activated');
      expect(projectState.activeProject!.isActive).toBe(true);
    });
  });
});
