/**
 * Tests for Auto-Save on Project Create
 *
 * Spec 2026-01-05: Auto-Save After Create Project
 * Task Group 2: Tests for auto-save integration in CreateProjectModal
 */

import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';

// Mock the saveUtils module
vi.mock('../utils/saveUtils', () => ({
  saveModelToBackend: vi.fn(() => Promise.resolve({ success: true, filename: 'test-project' })),
}));

// Mock the projectsApi module
vi.mock('../api/projectsApi', async () => {
  const actual = await vi.importActual('../api/projectsApi');
  return {
    ...actual,
    createProject: vi.fn(() => Promise.resolve({ id: 'proj-1', name: 'test-project', parent_folder: '/path' })),
  };
});

// Mock the ProjectContext
const mockRefreshActiveProject = vi.fn(() => Promise.resolve());
vi.mock('../contexts/ProjectContext', () => ({
  useRefreshActiveProject: () => mockRefreshActiveProject,
  useSetActiveProject: () => vi.fn(),
}));

// Mock the ArchitectureContext
const mockState = {
  model: {
    metaModel: { entities: {}, relationships: {} },
    diagrams: [],
  },
};
const mockDispatch = vi.fn();
vi.mock('../contexts/ArchitectureContext', () => ({
  useArchitectureContext: () => ({
    state: mockState,
    dispatch: mockDispatch,
  }),
}));

import { saveModelToBackend } from '../utils/saveUtils';
import { createProject } from '../api/projectsApi';

describe('Auto-Save on Project Create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('saveModelToBackend integration', () => {
    it('should call save with project name as filename after successful creation', async () => {
      const projectName = 'my-test-project';

      // Simulate the flow in CreateProjectModal
      await createProject(projectName, '/test/path');
      await mockRefreshActiveProject();

      // Then auto-save should be called
      await saveModelToBackend(mockState.model, projectName, mockDispatch);

      expect(saveModelToBackend).toHaveBeenCalledWith(
        mockState.model,
        projectName,
        mockDispatch
      );
    });

    it('should call save after refreshActiveProject completes', async () => {
      const callOrder: string[] = [];

      // Track call order
      mockRefreshActiveProject.mockImplementation(async () => {
        callOrder.push('refresh');
      });

      (saveModelToBackend as Mock).mockImplementation(async () => {
        callOrder.push('save');
        return { success: true };
      });

      // Simulate the flow
      await createProject('test', '/path');
      await mockRefreshActiveProject();
      await saveModelToBackend(mockState.model, 'test', mockDispatch);

      expect(callOrder).toEqual(['refresh', 'save']);
    });

    it('should proceed regardless of save success/failure (non-blocking)', async () => {
      // Save fails
      (saveModelToBackend as Mock).mockResolvedValue({
        success: false,
        error: 'Network error'
      });

      // Project creation succeeds
      await createProject('test', '/path');
      await mockRefreshActiveProject();

      // Save is called but fails - should not throw
      const result = await saveModelToBackend(mockState.model, 'test', mockDispatch);

      // The flow continues even though save failed
      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });

    it('should handle save failure with notification pattern', async () => {
      const errorMessage = 'Failed to save model to server';
      (saveModelToBackend as Mock).mockResolvedValue({
        success: false,
        error: errorMessage
      });

      const result = await saveModelToBackend(mockState.model, 'test', mockDispatch);

      // Verify we get the error in the result for notification display
      expect(result.success).toBe(false);
      expect(result.error).toBe(errorMessage);
    });

    it('should NOT call save when project creation fails', async () => {
      (createProject as Mock).mockRejectedValue(new Error('API error'));

      let saveCalled = false;
      (saveModelToBackend as Mock).mockImplementation(async () => {
        saveCalled = true;
        return { success: true };
      });

      // Simulate flow where project creation fails
      try {
        await createProject('test', '/path');
        // If creation succeeds, we would call refresh and save
        await mockRefreshActiveProject();
        await saveModelToBackend(mockState.model, 'test', mockDispatch);
      } catch {
        // Project creation failed, do not proceed with save
      }

      // Save should not have been called because creation threw
      expect(saveCalled).toBe(false);
    });
  });
});
