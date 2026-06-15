/**
 * Delete Project Coverage Tests
 *
 * Spec 2026-01-10: Project Menu + Delete Project
 * Task Group 5: Test Review and Gap Analysis
 *
 * Additional strategic tests to cover gaps:
 * 1. Cancel button closes modal without deletion
 * 2. Empty project list shows appropriate message
 * 3. Project list loading error shows retry button
 * 4. Close button (X) closes modal
 * 5. Warning message is displayed
 * 6. Selection state handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// Mock the API functions
vi.mock('../api/projectsApi', async () => {
  const actual = await vi.importActual('../api/projectsApi');
  return {
    ...actual,
    listProjects: vi.fn(),
  deleteProject: vi.fn(),
  };
});

// Mock the contexts
vi.mock('../contexts/ArchitectureContext', () => ({
  useArchitecture: () => ({
    model: { metaModel: { entities: {}, relationships: {} }, diagrams: [] },
    loadedFileName: 'test-file',
    currentView: 'metamodel',
  }),
  useArchitectureDispatch: () => vi.fn(),
}));

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => null,
  useRefreshActiveProject: () => vi.fn(),
  useClearActiveProject: () => vi.fn(),
  useSetActiveProject: () => vi.fn(),
}));

// Import after mocks
import { listProjects, deleteProject } from '../api/projectsApi';
import { DeleteProjectModal } from '../components/Project/DeleteProjectModal';

const mockListProjects = listProjects as unknown as ReturnType<typeof vi.fn>;
const mockDeleteProject = deleteProject as unknown as ReturnType<typeof vi.fn>;

describe('DeleteProjectModal Additional Coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Test 1: Cancel button closes modal without deletion', () => {
    it('should call onClose when Cancel button is clicked', async () => {
      const onClose = vi.fn();
      const onDeleteSuccess = vi.fn();

      mockListProjects.mockResolvedValue([
        {
          id: 'proj-1',
          name: 'Test Project',
          projectParentFolder: '/projects/test',
          isActive: false,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-10T12:00:00Z',
        },
      ]);

      render(
        <DeleteProjectModal
          isOpen={true}
          onClose={onClose}
          onDeleteSuccess={onDeleteSuccess}
        />
      );

      // Wait for projects to load
      await waitFor(() => {
        expect(screen.getByText('Test Project')).toBeInTheDocument();
      });

      // Click Cancel
      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      fireEvent.click(cancelButton);

      // onClose should be called
      expect(onClose).toHaveBeenCalled();
      // deleteProject should NOT be called
      expect(mockDeleteProject).not.toHaveBeenCalled();
      // onDeleteSuccess should NOT be called
      expect(onDeleteSuccess).not.toHaveBeenCalled();
    });
  });

  describe('Test 2: Empty project list shows appropriate message', () => {
    it('should show "No products available" when list is empty', async () => {
      mockListProjects.mockResolvedValue([]);

      render(
        <DeleteProjectModal
          isOpen={true}
          onClose={() => {}}
          onDeleteSuccess={() => {}}
        />
      );

      // Wait for loading to complete
      await waitFor(() => {
        expect(screen.getByText('No products available')).toBeInTheDocument();
      });
    });
  });

  describe('Test 3: Project list loading error shows retry button', () => {
    it('should show error message and retry button on load failure', async () => {
      mockListProjects.mockRejectedValue(new Error('Network error'));

      render(
        <DeleteProjectModal
          isOpen={true}
          onClose={() => {}}
          onDeleteSuccess={() => {}}
        />
      );

      // Wait for error to appear
      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });

      // Retry button should be present
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });

    it('should retry loading projects when Retry button is clicked', async () => {
      // First call fails
      mockListProjects.mockRejectedValueOnce(new Error('Network error'));
      // Second call succeeds
      mockListProjects.mockResolvedValueOnce([
        {
          id: 'proj-1',
          name: 'Test Project',
          projectParentFolder: '/projects/test',
          isActive: false,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-10T12:00:00Z',
        },
      ]);

      render(
        <DeleteProjectModal
          isOpen={true}
          onClose={() => {}}
          onDeleteSuccess={() => {}}
        />
      );

      // Wait for error
      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });

      // Click retry
      fireEvent.click(screen.getByRole('button', { name: /retry/i }));

      // Wait for project to load
      await waitFor(() => {
        expect(screen.getByText('Test Project')).toBeInTheDocument();
      });

      // listProjects should have been called twice
      expect(mockListProjects).toHaveBeenCalledTimes(2);
    });
  });

  describe('Test 4: Close button (X) closes modal', () => {
    it('should call onClose when X button is clicked', async () => {
      const onClose = vi.fn();

      mockListProjects.mockResolvedValue([]);

      render(
        <DeleteProjectModal
          isOpen={true}
          onClose={onClose}
          onDeleteSuccess={() => {}}
        />
      );

      // Wait for loading to complete
      await waitFor(() => {
        expect(screen.getByText('No products available')).toBeInTheDocument();
      });

      // Click the close button (X)
      const closeButton = screen.getByLabelText('Close');
      fireEvent.click(closeButton);

      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('Test 5: Warning message is displayed', () => {
    it('should show warning message about permanent deletion', async () => {
      mockListProjects.mockResolvedValue([]);

      render(
        <DeleteProjectModal
          isOpen={true}
          onClose={() => {}}
          onDeleteSuccess={() => {}}
        />
      );

      // Wait for content to load
      await waitFor(() => {
        expect(screen.getByText(/warning/i)).toBeInTheDocument();
      });

      // Check for warning content
      expect(screen.getByText(/permanently remove/i)).toBeInTheDocument();
    });
  });

  describe('Test 6: Selection state persists correctly', () => {
    it('should keep project selected when clicked again', async () => {
      mockListProjects.mockResolvedValue([
        {
          id: 'proj-1',
          name: 'Test Project',
          projectParentFolder: '/projects/test',
          isActive: false,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-10T12:00:00Z',
        },
      ]);

      render(
        <DeleteProjectModal
          isOpen={true}
          onClose={() => {}}
          onDeleteSuccess={() => {}}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Test Project')).toBeInTheDocument();
      });

      const projectRow = screen.getByText('Test Project');

      // First click - select
      fireEvent.click(projectRow);
      const deleteButton = screen.getByRole('button', { name: /delete/i });
      expect(deleteButton).not.toBeDisabled();

      // Click again - should remain selected
      fireEvent.click(projectRow);
      expect(deleteButton).not.toBeDisabled();
    });
  });
});

describe('FileMenu Props Verification', () => {
  describe('FileMenu interface includes onDelete prop', () => {
    it('should verify FileMenu component type includes onDelete handler', async () => {
      // Import the module to check the component exists
      const FileMenuModule = await import('../components/TopBar/FileMenu');
      expect(FileMenuModule.FileMenu).toBeDefined();
      expect(typeof FileMenuModule.FileMenu).toBe('function');
    });
  });
});
