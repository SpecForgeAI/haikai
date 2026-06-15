/**
 * Integration tests for CreateProjectModal organisation autocomplete feature.
 *
 * Spec 2026-01-18: Organisations Iteration 2 - Mandatory Organisation Autocomplete
 * Task Group 5: Test Review and Gap Analysis - Additional strategic tests
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Create mock functions
const mockCreateProject = vi.fn();
const mockListOrganisations = vi.fn();
const mockCreateOrganisation = vi.fn();
const mockRefreshActiveProject = vi.fn();
const mockSaveModelToBackend = vi.fn();
const mockListArchitectures = vi.fn();
// Spec 2026-06-12: Create now registers the implementation workspace after
// project creation (init never blocks creation, but the modal only closes
// once init resolves).
const mockInitProjectWorkspace = vi.fn();

// Mock dependencies
vi.mock('../api/projectsApi', async () => {
  const actual = await vi.importActual('../api/projectsApi');
  return {
    ...actual,
    createProject: (...args: unknown[]) => mockCreateProject(...args),
  };
});

vi.mock('../api/organisationsApi', async () => {
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
  useRefreshActiveProject: () => mockRefreshActiveProject,
  useSetActiveProject: () => vi.fn(),
}));

vi.mock('../contexts/ArchitectureContext', () => ({
  useArchitectureContext: () => ({
    state: { model: { nodes: [], edges: [] } },
    dispatch: vi.fn(),
  }),
}));

vi.mock('../utils/saveUtils', () => ({
  saveModelToBackend: (...args: unknown[]) => mockSaveModelToBackend(...args),
}));

// The post-create auto-save now resolves the new project's default
// architecture via listArchitectures before saving. Routed through a stable
// top-level mock fn (re-primed in beforeEach) so the suite's
// afterEach(vi.resetAllMocks) cannot strip the implementation after the
// first test.
vi.mock('../api/architecturesApi', async () => {
  const actual = await vi.importActual('../api/architecturesApi');
  return {
    ...actual,
    listArchitectures: (...args: unknown[]) => mockListArchitectures(...args),
  };
});

vi.mock('../contexts/UserJourneyReviewContext', () => ({
  useActivateJourneyReview: vi.fn(() => vi.fn()),
}));

// Spec 2026-06-12: Create now registers the implementation workspace after
// project creation (init never blocks creation, but the modal only closes
// once init resolves) -- stub it to succeed for these organisation flows.
vi.mock('../api/implementationProjectsApi', async () => {
  const actual = await vi.importActual('../api/implementationProjectsApi');
  return {
    ...actual,
    initProjectWorkspace: (...args: unknown[]) => mockInitProjectWorkspace(...args),
  };
});

// Import after mocks
import { CreateProjectModal } from '../components/Project/CreateProjectModal';
import { OrganisationConflictError } from '../api/organisationsApi';

describe('CreateProjectModal - Organisation Integration Tests', () => {
  const sampleOrganisations = [
    { id: 'org-1', name: 'Acme Corp', description: null },
    { id: 'org-2', name: 'Beta Inc', description: 'A beta company' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockListOrganisations.mockResolvedValue(sampleOrganisations);
    mockRefreshActiveProject.mockResolvedValue(undefined);
    mockSaveModelToBackend.mockResolvedValue({ success: true });
    mockListArchitectures.mockResolvedValue([{ id: 'arch-1', name: 'Default' }]);
    mockInitProjectWorkspace.mockResolvedValue({ success: true });
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

  it('full happy path: select existing org and create project', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<CreateProjectModal isOpen={true} onClose={onClose} />);

    // Wait for organisations to load
    await waitFor(() => {
      expect(mockListOrganisations).toHaveBeenCalled();
    });

    // Fill all required fields (parent folder no longer in form - computed server-side)
    await user.type(screen.getByTestId('organisation-name-input'), 'Acme Corp');
    await user.type(screen.getByTestId('project-name-input'), 'My New Project');
    await user.type(screen.getByTestId('repo-url-input'), 'https://example.com/repo.git');

    // Submit form
    await user.click(screen.getByTestId('create-button'));

    // Verify full flow executed
    await waitFor(() => {
      // Organisation was NOT created (existing was used)
      expect(mockCreateOrganisation).not.toHaveBeenCalled();
      // Project was created with correct org ID (parent folder is undefined - server-side default)
      expect(mockCreateProject).toHaveBeenCalledWith(
        'My New Project',
        undefined,
        undefined,
        'org-1',
        'https://example.com/repo.git'
      );
      // Active project was refreshed
      expect(mockRefreshActiveProject).toHaveBeenCalled();
      // Auto-save was triggered
      expect(mockSaveModelToBackend).toHaveBeenCalled();
      // Modal was closed
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('full happy path: new org name and create project', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    mockCreateOrganisation.mockResolvedValue({
      id: 'new-org-id',
      name: 'New Company',
      description: null,
    });

    render(<CreateProjectModal isOpen={true} onClose={onClose} />);

    // Wait for organisations to load
    await waitFor(() => {
      expect(mockListOrganisations).toHaveBeenCalled();
    });

    // Fill all required fields with new org name
    await user.type(screen.getByTestId('organisation-name-input'), 'New Company');
    await user.type(screen.getByTestId('project-name-input'), 'Brand New Project');
    await user.type(screen.getByTestId('repo-url-input'), 'https://example.com/repo.git');
    await user.type(screen.getByTestId('project-hierarchy-input'), 'ClientX');

    // Submit form
    await user.click(screen.getByTestId('create-button'));

    // Verify full flow executed
    await waitFor(() => {
      // New organisation was created
      expect(mockCreateOrganisation).toHaveBeenCalledWith('New Company');
      // Project was created with new org ID and hierarchy (parent folder undefined - server-side default)
      expect(mockCreateProject).toHaveBeenCalledWith(
        'Brand New Project',
        undefined,
        'ClientX',
        'new-org-id',
        'https://example.com/repo.git'
      );
      // Active project was refreshed
      expect(mockRefreshActiveProject).toHaveBeenCalled();
      // Modal was closed
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('validates empty organisation name prevents submission', () => {
    render(<CreateProjectModal isOpen={true} onClose={() => {}} />);

    // Fill only project name (parent folder no longer in form)
    fireEvent.change(screen.getByTestId('project-name-input'), {
      target: { value: 'Test Project' },
    });

    // Create button should remain disabled
    expect(screen.getByTestId('create-button')).toBeDisabled();
  });

  it('validates whitespace-only organisation name prevents submission', () => {
    render(<CreateProjectModal isOpen={true} onClose={() => {}} />);

    // Fill with whitespace-only org name
    fireEvent.change(screen.getByTestId('organisation-name-input'), {
      target: { value: '   ' },
    });
    fireEvent.change(screen.getByTestId('project-name-input'), {
      target: { value: 'Test Project' },
    });

    // Create button should remain disabled (whitespace is trimmed)
    expect(screen.getByTestId('create-button')).toBeDisabled();
  });

  it('error recovery: org creation fails, project not created', async () => {
    const user = userEvent.setup();

    mockCreateOrganisation.mockRejectedValue(
      new Error('Server error: could not create organisation')
    );

    render(<CreateProjectModal isOpen={true} onClose={() => {}} />);

    // Wait for organisations to load
    await waitFor(() => {
      expect(mockListOrganisations).toHaveBeenCalled();
    });

    // Fill form with new org name
    await user.type(screen.getByTestId('organisation-name-input'), 'Failing Org');
    await user.type(screen.getByTestId('project-name-input'), 'Will Fail');
    await user.type(screen.getByTestId('repo-url-input'), 'https://example.com/repo.git');

    // Submit form
    await user.click(screen.getByTestId('create-button'));

    await waitFor(() => {
      // Error should be displayed
      expect(screen.getByTestId('error-message')).toHaveTextContent(
        'Server error: could not create organisation'
      );
      // Project should NOT be created
      expect(mockCreateProject).not.toHaveBeenCalled();
      // Auto-save should NOT be triggered
      expect(mockSaveModelToBackend).not.toHaveBeenCalled();
    });

    // Create button should be re-enabled for retry
    expect(screen.getByTestId('create-button')).not.toBeDisabled();
  });

  it('409 conflict recovery flow completes successfully', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    // First createOrganisation call throws 409
    mockCreateOrganisation.mockRejectedValueOnce(
      new OrganisationConflictError('Organisation already exists')
    );

    // Initial list does not have the org
    mockListOrganisations.mockResolvedValueOnce(sampleOrganisations);
    // Re-fetch after 409 includes the existing org
    mockListOrganisations.mockResolvedValueOnce([
      ...sampleOrganisations,
      { id: 'race-org-id', name: 'Race Condition Org', description: null },
    ]);

    render(<CreateProjectModal isOpen={true} onClose={onClose} />);

    // Wait for initial organisations to load
    await waitFor(() => {
      expect(mockListOrganisations).toHaveBeenCalledTimes(1);
    });

    // Fill form with org name that causes race condition conflict
    await user.type(screen.getByTestId('organisation-name-input'), 'Race Condition Org');
    await user.type(screen.getByTestId('project-name-input'), 'Race Project');
    await user.type(screen.getByTestId('repo-url-input'), 'https://example.com/repo.git');

    // Submit form
    await user.click(screen.getByTestId('create-button'));

    await waitFor(() => {
      // Create org was attempted
      expect(mockCreateOrganisation).toHaveBeenCalledWith('Race Condition Org');
      // List was re-fetched after 409
      expect(mockListOrganisations).toHaveBeenCalledTimes(2);
      // Project was created with the found org's ID (parent folder undefined - server-side default)
      expect(mockCreateProject).toHaveBeenCalledWith(
        'Race Project',
        undefined,
        undefined,
        'race-org-id',
        'https://example.com/repo.git'
      );
      // Modal was closed (success)
      expect(onClose).toHaveBeenCalled();
    });
  });
});
