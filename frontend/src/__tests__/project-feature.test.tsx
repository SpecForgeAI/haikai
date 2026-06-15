/**
 * Tests for Project Model Feature
 *
 * Spec 2026-01-05: Project Model with Active Project
 * Task Group 11: Integration tests for Project Model feature
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// Mock AppConfigContext to provide useIncludeDatabase hook
// (ProjectContext internally calls useIncludeDatabase)
// Harness: CreateProjectModal reads useArchitectureContext().dispatch
// (multi-architecture plumbing); stub the hook so the real
// ArchitectureProvider stack is not required around these renders.
vi.mock('../contexts/ArchitectureContext', () => ({
  useArchitectureContext: vi.fn(() => ({
    state: { model: { metaModel: { entities: {}, relationships: {} }, diagrams: [] } },
    dispatch: vi.fn(),
    undo: vi.fn(),
    canUndo: false,
    activeArchitectureId: 'arch-1',
    architectures: [],
    setActiveArchitecture: vi.fn(),
    refreshArchitectures: vi.fn(),
    invalidateArchitectureModelCache: vi.fn(),
    setArchitectureModelCacheInvalidator: vi.fn(),
  })),
  useActiveArchitectureId: vi.fn(() => 'arch-1'),
}));

// DB mode: ProjectContext only calls getActiveProject when includeDatabase
// is true (no-DB mode uses getSessionProject instead).
vi.mock('../contexts/AppConfigContext', () => ({
  useIncludeDelivery: () => true,
  useIncludeDatabase: () => true,
}));

// Mock the projectsApi module
vi.mock('../api/projectsApi', async () => {
  const actual = await vi.importActual('../api/projectsApi');
  return {
    ...actual,
    createProject: vi.fn(),
  // Default: resolve an empty list -- CreateProjectModal's mount effect calls
  // listProjects().then(...) for hierarchy suggestions before tests override.
  listProjects: vi.fn(() => Promise.resolve([])),
  getActiveProject: vi.fn(),
  activateProject: vi.fn(),
  };
});

// CreateProjectModal now loads organisations on open and resolves the new
// project's default architecture during the post-create auto-save.
vi.mock('../api/organisationsApi', async () => {
  const actual = await vi.importActual('../api/organisationsApi');
  return {
    ...actual,
    listOrganisations: vi.fn().mockResolvedValue([{ id: 'org-1', name: 'Acme Org' }]),
    createOrganisation: vi.fn().mockResolvedValue({ id: 'org-1', name: 'Acme Org' }),
  };
});

vi.mock('../api/architecturesApi', async () => {
  const actual = await vi.importActual('../api/architecturesApi');
  return {
    ...actual,
    listArchitectures: vi.fn().mockResolvedValue([{ id: 'arch-1', name: 'Default' }]),
  };
});

vi.mock('../utils/saveUtils', () => ({
  saveModelToBackend: vi.fn().mockResolvedValue({ success: true }),
}));

import {
  createProject,
  listProjects,
  getActiveProject,
  activateProject,
  ProjectDto,
} from '../api/projectsApi';
import { ProjectProvider, useProject, useRefreshActiveProject } from '../contexts/ProjectContext';
import { CreateProjectModal } from '../components/Project/CreateProjectModal';
import { renderWithRouter } from '../test-utils/renderWithProviders';

// Test helper component
function TestProjectConsumer() {
  const activeProject = useProject();
  const refreshActiveProject = useRefreshActiveProject();

  return (
    <div>
      <div data-testid="active-project">{activeProject ? activeProject.name : 'No project'}</div>
      <button onClick={refreshActiveProject} data-testid="refresh-button">
        Refresh
      </button>
    </div>
  );
}

// Sample project for testing
const sampleProject: ProjectDto = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  name: 'Test Project',
  projectParentFolder: '/projects/test',
  isActive: true,
  createdAt: '2026-01-05T12:00:00Z',
  updatedAt: '2026-01-05T12:00:00Z',
};

describe('ProjectContext', () => {
  beforeEach(() => {
    vi.mocked(getActiveProject).mockReset();
    vi.mocked(createProject).mockReset();
  });

  it('provides activeProject state (initially null before API call)', async () => {
    vi.mocked(getActiveProject).mockResolvedValue(null);

    renderWithRouter(
      <ProjectProvider>
        <TestProjectConsumer />
      </ProjectProvider>
    );

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByTestId('active-project')).toHaveTextContent('No project');
    });
  });

  it('refreshActiveProject() calls API and updates state', async () => {
    vi.mocked(getActiveProject)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(sampleProject);

    renderWithRouter(
      <ProjectProvider>
        <TestProjectConsumer />
      </ProjectProvider>
    );

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByTestId('active-project')).toHaveTextContent('No project');
    });

    // Click refresh
    await act(async () => {
      fireEvent.click(screen.getByTestId('refresh-button'));
    });

    // Wait for updated state
    await waitFor(() => {
      expect(screen.getByTestId('active-project')).toHaveTextContent('Test Project');
    });

    expect(getActiveProject).toHaveBeenCalledTimes(2);
  });

  it('app initialization calls getActiveProject()', async () => {
    vi.mocked(getActiveProject).mockResolvedValue(sampleProject);

    renderWithRouter(
      <ProjectProvider>
        <TestProjectConsumer />
      </ProjectProvider>
    );

    await waitFor(() => {
      expect(getActiveProject).toHaveBeenCalled();
    });
  });

  it('context re-renders consumers when activeProject changes', async () => {
    vi.mocked(getActiveProject)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(sampleProject);

    renderWithRouter(
      <ProjectProvider>
        <TestProjectConsumer />
      </ProjectProvider>
    );

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByTestId('active-project')).toHaveTextContent('No project');
    });

    // Trigger refresh
    await act(async () => {
      fireEvent.click(screen.getByTestId('refresh-button'));
    });

    // Verify re-render with new data
    await waitFor(() => {
      expect(screen.getByTestId('active-project')).toHaveTextContent('Test Project');
    });
  });
});

describe('CreateProjectModal', () => {
  beforeEach(() => {
    vi.mocked(getActiveProject).mockResolvedValue(null);
    vi.mocked(createProject).mockReset();
  });

  it('renders with Organisation, Product Name, Git Repo and Hierarchy inputs', async () => {
    renderWithRouter(
      <ProjectProvider>
        <CreateProjectModal isOpen={true} onClose={() => {}} />
      </ProjectProvider>
    );

    // parent-folder-input was removed: the backend defaults the parent folder.
    await waitFor(() => {
      expect(screen.getByTestId('organisation-name-input')).toBeInTheDocument();
      expect(screen.getByTestId('project-name-input')).toBeInTheDocument();
      expect(screen.getByTestId('repo-url-input')).toBeInTheDocument();
      expect(screen.getByTestId('project-hierarchy-input')).toBeInTheDocument();
      expect(screen.queryByTestId('parent-folder-input')).not.toBeInTheDocument();
    });
  });

  it('Create button is disabled when fields are empty/whitespace', async () => {
    renderWithRouter(
      <ProjectProvider>
        <CreateProjectModal isOpen={true} onClose={() => {}} />
      </ProjectProvider>
    );

    await waitFor(() => {
      const createButton = screen.getByTestId('create-button');
      expect(createButton).toBeDisabled();
    });

    // Enter only whitespace
    fireEvent.change(screen.getByTestId('organisation-name-input'), { target: { value: '   ' } });
    fireEvent.change(screen.getByTestId('project-name-input'), { target: { value: '   ' } });
    fireEvent.change(screen.getByTestId('repo-url-input'), { target: { value: '   ' } });

    expect(screen.getByTestId('create-button')).toBeDisabled();
  });

  it('Create button is enabled when both fields have values', async () => {
    renderWithRouter(
      <ProjectProvider>
        <CreateProjectModal isOpen={true} onClose={() => {}} />
      </ProjectProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('project-name-input')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('organisation-name-input'), { target: { value: 'Acme Org' } });
    fireEvent.change(screen.getByTestId('project-name-input'), { target: { value: 'My Project' } });
    fireEvent.change(screen.getByTestId('repo-url-input'), { target: { value: 'https://example.com/repo.git' } });

    expect(screen.getByTestId('create-button')).not.toBeDisabled();
  });

  it('Cancel button closes modal without calling API', async () => {
    const onClose = vi.fn();
    renderWithRouter(
      <ProjectProvider>
        <CreateProjectModal isOpen={true} onClose={onClose} />
      </ProjectProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('cancel-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('cancel-button'));

    expect(onClose).toHaveBeenCalled();
    expect(createProject).not.toHaveBeenCalled();
  });

  it('Create success calls refreshActiveProject and closes modal', async () => {
    const onClose = vi.fn();
    vi.mocked(createProject).mockResolvedValue(sampleProject);
    vi.mocked(getActiveProject).mockResolvedValue(sampleProject);

    renderWithRouter(
      <ProjectProvider>
        <CreateProjectModal isOpen={true} onClose={onClose} />
      </ProjectProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('project-name-input')).toBeInTheDocument();
    });

    // Fill form (org + product name + repo are the required fields now)
    fireEvent.change(screen.getByTestId('organisation-name-input'), { target: { value: 'Acme Org' } });
    fireEvent.change(screen.getByTestId('project-name-input'), { target: { value: 'My Project' } });
    fireEvent.change(screen.getByTestId('repo-url-input'), { target: { value: 'https://example.com/repo.git' } });

    // Submit
    await act(async () => {
      fireEvent.click(screen.getByTestId('create-button'));
    });

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith(
        'My Project',
        undefined, // parent folder omitted -- backend defaults it
        undefined,
        'org-1',
        'https://example.com/repo.git'
      );
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('displays error message when API returns error', async () => {
    vi.mocked(createProject).mockRejectedValue(new Error('Project creation failed'));

    renderWithRouter(
      <ProjectProvider>
        <CreateProjectModal isOpen={true} onClose={() => {}} />
      </ProjectProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('project-name-input')).toBeInTheDocument();
    });

    // Fill form
    fireEvent.change(screen.getByTestId('organisation-name-input'), { target: { value: 'Acme Org' } });
    fireEvent.change(screen.getByTestId('project-name-input'), { target: { value: 'My Project' } });
    fireEvent.change(screen.getByTestId('repo-url-input'), { target: { value: 'https://example.com/repo.git' } });

    // Submit
    await act(async () => {
      fireEvent.click(screen.getByTestId('create-button'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toHaveTextContent('Project creation failed');
    });
  });
});
