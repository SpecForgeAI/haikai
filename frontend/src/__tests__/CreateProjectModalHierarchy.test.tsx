/**
 * Unit tests for CreateProjectModal project hierarchy functionality.
 *
 * Spec 2026-01-10: Project Hierarchy Grouping
 * Task Group 3: UI Component Tests
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Create mock function for createProject
const mockCreateProject = vi.fn();
const mockListProjects = vi.fn();
const mockListOrganisations = vi.fn();
const mockCreateOrganisation = vi.fn();
const mockListArchitectures = vi.fn();

// Mock dependencies before importing component
vi.mock('../api/projectsApi', async () => {
  const actual = await vi.importActual('../api/projectsApi');
  return {
    ...actual,
    createProject: (...args: any[]) => mockCreateProject(...args),
    listProjects: (...args: any[]) => mockListProjects(...args),
  };
});

// Organisation resolution + default-architecture lookup now run during create
vi.mock('../api/organisationsApi', async () => {
  const actual = await vi.importActual('../api/organisationsApi');
  return {
    ...actual,
    listOrganisations: (...args: any[]) => mockListOrganisations(...args),
    createOrganisation: (...args: any[]) => mockCreateOrganisation(...args),
  };
});

vi.mock('../api/architecturesApi', async () => {
  const actual = await vi.importActual('../api/architecturesApi');
  return {
    ...actual,
    listArchitectures: (...args: any[]) => mockListArchitectures(...args),
  };
});

vi.mock('../contexts/ProjectContext', () => ({
  useRefreshActiveProject: () => vi.fn().mockResolvedValue(undefined),
  useSetActiveProject: () => vi.fn(),
}));

vi.mock('../contexts/ArchitectureContext', () => ({
  useArchitectureContext: () => ({
    state: { model: {} },
    dispatch: vi.fn(),
  }),
}));

vi.mock('../utils/saveUtils', () => ({
  saveModelToBackend: vi.fn().mockResolvedValue({ success: true }),
}));

// Import after mocks
import { CreateProjectModal } from '../components/Project/CreateProjectModal';

describe('CreateProjectModal - Project Hierarchy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListProjects.mockResolvedValue([]);
    mockListOrganisations.mockResolvedValue([{ id: 'org-1', name: 'Acme Org' }]);
    mockCreateOrganisation.mockResolvedValue({ id: 'org-1', name: 'Acme Org' });
    mockListArchitectures.mockResolvedValue([{ id: 'arch-1', name: 'Default' }]);
    mockCreateProject.mockResolvedValue({
      id: 'new-id',
      name: 'Test',
      projectParentFolder: '/test',
      projectHierarchy: null,
      isActive: true,
      createdAt: '2026-01-10T00:00:00Z',
      updatedAt: '2026-01-10T00:00:00Z',
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('renders "Project Hierarchy" input field', () => {
    render(<CreateProjectModal isOpen={true} onClose={() => {}} />);

    expect(screen.getByLabelText('Product Hierarchy')).toBeInTheDocument();
    expect(screen.getByTestId('project-hierarchy-input')).toBeInTheDocument();
  });

  it('displays help text for Project Hierarchy field', () => {
    render(<CreateProjectModal isOpen={true} onClose={() => {}} />);

    expect(
      screen.getByText(/optional logical folder for grouping products/i)
    ).toBeInTheDocument();
  });

  it('passes projectHierarchy to createProject API when provided', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<CreateProjectModal isOpen={true} onClose={onClose} />);

    // parent-folder-input was removed: the backend now defaults the parent
    // folder. Organisation Name + Git Repo are required instead.
    await user.type(screen.getByTestId('organisation-name-input'), 'Acme Org');
    await user.type(screen.getByTestId('project-name-input'), 'Test Project');
    await user.type(screen.getByTestId('repo-url-input'), 'https://example.com/repo.git');
    await user.type(screen.getByTestId('project-hierarchy-input'), 'ClientA');

    await user.click(screen.getByTestId('create-button'));

    await waitFor(() => {
      expect(mockCreateProject).toHaveBeenCalledWith(
        'Test Project',
        undefined, // parent folder omitted -- backend defaults it
        'ClientA',
        'org-1',
        'https://example.com/repo.git'
      );
    });
  });

  it('passes undefined for projectHierarchy when field is empty', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<CreateProjectModal isOpen={true} onClose={onClose} />);

    await user.type(screen.getByTestId('organisation-name-input'), 'Acme Org');
    await user.type(screen.getByTestId('project-name-input'), 'Test Project');
    await user.type(screen.getByTestId('repo-url-input'), 'https://example.com/repo.git');
    // Leave hierarchy field empty

    await user.click(screen.getByTestId('create-button'));

    await waitFor(() => {
      expect(mockCreateProject).toHaveBeenCalledWith(
        'Test Project',
        undefined,
        undefined,
        'org-1',
        'https://example.com/repo.git'
      );
    });
  });

  it('trims whitespace from projectHierarchy', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<CreateProjectModal isOpen={true} onClose={onClose} />);

    await user.type(screen.getByTestId('organisation-name-input'), 'Acme Org');
    await user.type(screen.getByTestId('project-name-input'), 'Test Project');
    await user.type(screen.getByTestId('repo-url-input'), 'https://example.com/repo.git');
    await user.type(screen.getByTestId('project-hierarchy-input'), '  ClientA  ');

    await user.click(screen.getByTestId('create-button'));

    await waitFor(() => {
      expect(mockCreateProject).toHaveBeenCalledWith(
        'Test Project',
        undefined,
        'ClientA',
        'org-1',
        'https://example.com/repo.git'
      );
    });
  });

  it('treats whitespace-only hierarchy as undefined', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<CreateProjectModal isOpen={true} onClose={onClose} />);

    await user.type(screen.getByTestId('organisation-name-input'), 'Acme Org');
    await user.type(screen.getByTestId('project-name-input'), 'Test Project');
    await user.type(screen.getByTestId('repo-url-input'), 'https://example.com/repo.git');
    await user.type(screen.getByTestId('project-hierarchy-input'), '   ');

    await user.click(screen.getByTestId('create-button'));

    await waitFor(() => {
      expect(mockCreateProject).toHaveBeenCalledWith(
        'Test Project',
        undefined,
        undefined,
        'org-1',
        'https://example.com/repo.git'
      );
    });
  });

  it('resets hierarchy field when modal reopens', async () => {
    const { rerender } = render(
      <CreateProjectModal isOpen={true} onClose={() => {}} />
    );

    // Enter hierarchy value
    fireEvent.change(screen.getByTestId('project-hierarchy-input'), {
      target: { value: 'ClientA' },
    });

    // Close and reopen modal
    rerender(<CreateProjectModal isOpen={false} onClose={() => {}} />);
    rerender(<CreateProjectModal isOpen={true} onClose={() => {}} />);

    // Field should be reset
    expect(screen.getByTestId('project-hierarchy-input')).toHaveValue('');
  });

  it('allows form submission even with empty hierarchy (optional field)', async () => {
    render(<CreateProjectModal isOpen={true} onClose={() => {}} />);

    // Fill only required fields using fireEvent for synchronous behavior
    fireEvent.change(screen.getByTestId('organisation-name-input'), {
      target: { value: 'Acme Org' },
    });
    fireEvent.change(screen.getByTestId('project-name-input'), {
      target: { value: 'Test' },
    });
    fireEvent.change(screen.getByTestId('repo-url-input'), {
      target: { value: 'https://example.com/repo.git' },
    });

    // Create button should be enabled
    expect(screen.getByTestId('create-button')).not.toBeDisabled();
  });
});
