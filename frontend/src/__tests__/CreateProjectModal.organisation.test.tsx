/**
 * Unit tests for CreateProjectModal organisation autocomplete functionality.
 *
 * Spec 2026-01-18: Organisations Iteration 2 - Mandatory Organisation Autocomplete
 * Task Group 3: CreateProjectModal UI Tests
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Create mock functions - must be defined before vi.mock due to hoisting
const mockCreateProject = vi.fn();
const mockListOrganisations = vi.fn();
const mockCreateOrganisation = vi.fn();

// Mock OrganisationConflictError class for testing
class MockOrganisationConflictError extends Error {
  isConflict = true;
  constructor(message: string) {
    super(message);
    this.name = 'OrganisationConflictError';
  }
}

// Mock dependencies before importing component
vi.mock('../api/projectsApi', async () => {
  const actual = await vi.importActual('../api/projectsApi');
  return {
    ...actual,
    createProject: (...args: unknown[]) => mockCreateProject(...args),
  };
});

vi.mock('../api/organisationsApi', async () => {
  // Define the error class inside the factory function
  class OrganisationConflictError extends Error {
    isConflict = true;
    constructor(message: string) {
      super(message);
      this.name = 'OrganisationConflictError';
    }
  }

  const actual = await vi.importActual('../api/organisationsApi');

  return {
    ...actual,
    listOrganisations: () => mockListOrganisations(),
    createOrganisation: (name: string) => mockCreateOrganisation(name),
    OrganisationConflictError,
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
import { OrganisationConflictError } from '../api/organisationsApi';

describe('CreateProjectModal - Organisation Autocomplete', () => {
  const sampleOrganisations = [
    { id: 'org-1', name: 'Acme Corp', description: null },
    { id: 'org-2', name: 'Beta Inc', description: 'A beta company' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockListOrganisations.mockResolvedValue(sampleOrganisations);
    mockCreateOrganisation.mockResolvedValue({
      id: 'new-org-id',
      name: 'New Organisation',
      description: null,
    });
    mockCreateProject.mockResolvedValue({
      id: 'new-project-id',
      name: 'Test Project',
      projectParentFolder: '/test',
      projectHierarchy: null,
      isActive: true,
      createdAt: '2026-01-18T00:00:00Z',
      updatedAt: '2026-01-18T00:00:00Z',
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('renders Organisation Name field at the top of the form', () => {
    render(<CreateProjectModal isOpen={true} onClose={() => {}} />);

    const orgInput = screen.getByTestId('organisation-name-input');
    expect(orgInput).toBeInTheDocument();

    // Verify it appears before Project Name by checking DOM order
    const projectInput = screen.getByTestId('project-name-input');
    const orgInputGroup = orgInput.closest('[class*="inputGroup"]');
    const projectInputGroup = projectInput.closest('[class*="inputGroup"]');

    if (orgInputGroup && projectInputGroup) {
      // Organisation input should come before project input in DOM
      const comparison = orgInputGroup.compareDocumentPosition(projectInputGroup);
      expect(comparison & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('populates datalist with organisations on modal open', async () => {
    render(<CreateProjectModal isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(mockListOrganisations).toHaveBeenCalled();
    });

    // Check datalist contains options
    const datalist = screen.getByTestId('organisations-datalist');
    expect(datalist).toBeInTheDocument();

    await waitFor(() => {
      const options = datalist.querySelectorAll('option');
      expect(options).toHaveLength(2);
      expect(options[0]).toHaveAttribute('value', 'Acme Corp');
      expect(options[1]).toHaveAttribute('value', 'Beta Inc');
    });
  });

  it('disables Create button when Organisation Name is empty', () => {
    render(<CreateProjectModal isOpen={true} onClose={() => {}} />);

    // Fill project name only (parent folder no longer exists in the form)
    fireEvent.change(screen.getByTestId('project-name-input'), {
      target: { value: 'Test Project' },
    });

    // Leave organisation name empty - Create button should be disabled
    expect(screen.getByTestId('create-button')).toBeDisabled();
  });

  it('disables Create button when any required field is empty', () => {
    render(<CreateProjectModal isOpen={true} onClose={() => {}} />);

    // Fill only organisation name - should be disabled (product name missing)
    fireEvent.change(screen.getByTestId('organisation-name-input'), {
      target: { value: 'Acme Corp' },
    });
    expect(screen.getByTestId('create-button')).toBeDisabled();

    // Fill organisation + product name - still disabled (Git Repo now required)
    fireEvent.change(screen.getByTestId('project-name-input'), {
      target: { value: 'Test' },
    });
    expect(screen.getByTestId('create-button')).toBeDisabled();

    // Fill the Git Repo too - now enabled
    fireEvent.change(screen.getByTestId('repo-url-input'), {
      target: { value: 'https://example.com/repo.git' },
    });
    expect(screen.getByTestId('create-button')).not.toBeDisabled();
  });

  it('uses existing organisation ID when name matches cached list', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<CreateProjectModal isOpen={true} onClose={onClose} />);

    // Wait for organisations to load
    await waitFor(() => {
      expect(mockListOrganisations).toHaveBeenCalled();
    });

    // Fill form with existing organisation name and product name
    await user.type(screen.getByTestId('organisation-name-input'), 'Acme Corp');
    await user.type(screen.getByTestId('project-name-input'), 'Test Project');
    await user.type(screen.getByTestId('repo-url-input'), 'https://example.com/repo.git');

    await user.click(screen.getByTestId('create-button'));

    await waitFor(() => {
      // Should NOT call createOrganisation since it matches existing
      expect(mockCreateOrganisation).not.toHaveBeenCalled();
      // Should call createProject with the existing org's ID
      // Parent folder is now undefined (computed server-side)
      expect(mockCreateProject).toHaveBeenCalledWith(
        'Test Project',
        undefined,
        undefined,
        'org-1',
        'https://example.com/repo.git'
      );
    });
  });

  it('creates new organisation when name does not match cached list', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<CreateProjectModal isOpen={true} onClose={onClose} />);

    // Wait for organisations to load
    await waitFor(() => {
      expect(mockListOrganisations).toHaveBeenCalled();
    });

    // Fill form with new organisation name
    await user.type(screen.getByTestId('organisation-name-input'), 'New Organisation');
    await user.type(screen.getByTestId('project-name-input'), 'Test Project');
    await user.type(screen.getByTestId('repo-url-input'), 'https://example.com/repo.git');

    await user.click(screen.getByTestId('create-button'));

    await waitFor(() => {
      // Should call createOrganisation with new name
      expect(mockCreateOrganisation).toHaveBeenCalledWith('New Organisation');
      // Should call createProject with the new org's ID
      expect(mockCreateProject).toHaveBeenCalledWith(
        'Test Project',
        undefined,
        undefined,
        'new-org-id',
        'https://example.com/repo.git'
      );
    });
  });

  it('handles 409 conflict by re-fetching organisations and finding match', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    // First createOrganisation call throws 409
    mockCreateOrganisation.mockRejectedValueOnce(
      new OrganisationConflictError('Organisation already exists')
    );

    // Second listOrganisations call returns the org that already existed
    mockListOrganisations
      .mockResolvedValueOnce(sampleOrganisations)
      .mockResolvedValueOnce([
        ...sampleOrganisations,
        { id: 'conflict-org-id', name: 'Conflict Org', description: null },
      ]);

    render(<CreateProjectModal isOpen={true} onClose={onClose} />);

    // Wait for initial organisations to load
    await waitFor(() => {
      expect(mockListOrganisations).toHaveBeenCalledTimes(1);
    });

    // Fill form with org name that will cause conflict
    await user.type(screen.getByTestId('organisation-name-input'), 'Conflict Org');
    await user.type(screen.getByTestId('project-name-input'), 'Test Project');
    await user.type(screen.getByTestId('repo-url-input'), 'https://example.com/repo.git');

    await user.click(screen.getByTestId('create-button'));

    await waitFor(() => {
      // Should have re-fetched organisations after 409
      expect(mockListOrganisations).toHaveBeenCalledTimes(2);
      // Should call createProject with the existing org's ID from re-fetch
      expect(mockCreateProject).toHaveBeenCalledWith(
        'Test Project',
        undefined,
        undefined,
        'conflict-org-id',
        'https://example.com/repo.git'
      );
    });
  });

  it('displays error when organisation creation fails (non-409)', async () => {
    const user = userEvent.setup();

    // createOrganisation throws non-409 error
    mockCreateOrganisation.mockRejectedValueOnce(
      new Error('Failed to create organisation')
    );

    render(<CreateProjectModal isOpen={true} onClose={() => {}} />);

    // Wait for organisations to load
    await waitFor(() => {
      expect(mockListOrganisations).toHaveBeenCalled();
    });

    // Fill form with new organisation name
    await user.type(screen.getByTestId('organisation-name-input'), 'New Organisation');
    await user.type(screen.getByTestId('project-name-input'), 'Test Project');
    await user.type(screen.getByTestId('repo-url-input'), 'https://example.com/repo.git');

    await user.click(screen.getByTestId('create-button'));

    await waitFor(() => {
      // Should display error message
      expect(screen.getByTestId('error-message')).toHaveTextContent(
        'Failed to create organisation'
      );
      // Should NOT call createProject
      expect(mockCreateProject).not.toHaveBeenCalled();
    });
  });

  it('shows loading indicator while fetching organisations', async () => {
    // Make listOrganisations take longer
    mockListOrganisations.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(sampleOrganisations), 100))
    );

    render(<CreateProjectModal isOpen={true} onClose={() => {}} />);

    // Should show loading indicator initially
    expect(screen.getByTestId('organisations-loading')).toBeInTheDocument();

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.queryByTestId('organisations-loading')).not.toBeInTheDocument();
    });
  });

  it('shows warning when organisations load fails (non-blocking)', async () => {
    mockListOrganisations.mockRejectedValueOnce(
      new Error('Network error')
    );

    render(<CreateProjectModal isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('organisations-warning')).toBeInTheDocument();
      expect(screen.getByTestId('organisations-warning')).toHaveTextContent(
        /failed to load/i
      );
    });

    // Form should still be usable - org name, product name and git repo are required
    fireEvent.change(screen.getByTestId('organisation-name-input'), {
      target: { value: 'New Org' },
    });
    fireEvent.change(screen.getByTestId('project-name-input'), {
      target: { value: 'Test' },
    });
    fireEvent.change(screen.getByTestId('repo-url-input'), {
      target: { value: 'https://example.com/repo.git' },
    });

    expect(screen.getByTestId('create-button')).not.toBeDisabled();
  });

  it('resets organisation name when modal reopens', async () => {
    const { rerender } = render(
      <CreateProjectModal isOpen={true} onClose={() => {}} />
    );

    // Enter organisation name
    fireEvent.change(screen.getByTestId('organisation-name-input'), {
      target: { value: 'Acme Corp' },
    });

    // Close and reopen modal
    rerender(<CreateProjectModal isOpen={false} onClose={() => {}} />);
    rerender(<CreateProjectModal isOpen={true} onClose={() => {}} />);

    // Field should be reset
    expect(screen.getByTestId('organisation-name-input')).toHaveValue('');
  });
});
