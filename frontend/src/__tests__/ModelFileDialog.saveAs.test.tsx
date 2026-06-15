/**
 * Tests for ModelFileDialog saveAs mode functionality.
 *
 * Spec 2026-01-18: Organisations Iteration 4 - Update Project Save As Modal
 *
 * Test coverage:
 * - Task Group 1: State management and data fetching
 * - Task Group 2: Form fields and validation
 * - Task Group 3: Grouped list and selection behavior
 * - Task Group 4: Save flow with organisation resolution
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Create mock functions - must be defined before vi.mock due to hoisting
const mockListProjects = vi.fn();
const mockListOrganisations = vi.fn();
const mockCreateOrganisation = vi.fn();

// Mock dependencies before importing component
vi.mock('../api/projectsApi', async () => {
  const actual = await vi.importActual('../api/projectsApi');
  return {
    ...actual,
    listProjects: () => mockListProjects(),
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

// Import after mocks
import { ModelFileDialog } from '../components/file/ModelFileDialog';
import { OrganisationConflictError } from '../api/organisationsApi';

// =============================================================================
// Test Data
// =============================================================================

const sampleProjects = [
  {
    id: 'proj-1',
    name: 'Alpha Project',
    projectParentFolder: '/projects/alpha',
    projectHierarchy: 'Hierarchy1',
    organisationId: 'org-1',
    isActive: false,
    createdAt: '2026-01-18T12:00:00Z',
    updatedAt: '2026-01-18T12:00:00Z',
  },
  {
    id: 'proj-2',
    name: 'Beta Project',
    projectParentFolder: '/projects/beta',
    projectHierarchy: null,
    organisationId: 'org-2',
    isActive: false,
    createdAt: '2026-01-18T12:00:00Z',
    updatedAt: '2026-01-18T12:00:00Z',
  },
];

const sampleOrganisations = [
  { id: 'org-1', name: 'Acme Corporation', description: null },
  { id: 'org-2', name: 'Beta Industries', description: null },
];

// =============================================================================
// Task Group 1: State Management and Data Fetching Tests
// =============================================================================

describe('ModelFileDialog saveAs Mode - State Management and Data Fetching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListProjects.mockResolvedValue(sampleProjects);
    mockListOrganisations.mockResolvedValue(sampleOrganisations);
    mockCreateOrganisation.mockResolvedValue({
      id: 'new-org-id',
      name: 'New Organisation',
      description: null,
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('fetches both listProjects() and listOrganisations() in parallel for saveAs mode', async () => {
    render(
      <ModelFileDialog
        mode="saveAs"
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
      />
    );

    await waitFor(() => {
      // Both APIs should be called for saveAs mode
      expect(mockListProjects).toHaveBeenCalledTimes(1);
      expect(mockListOrganisations).toHaveBeenCalledTimes(1);
    });
  });

  it('builds organisationMap correctly from organisations list', async () => {
    render(
      <ModelFileDialog
        mode="saveAs"
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
      />
    );

    await waitFor(() => {
      // Verify organisations loaded by checking org names are displayed in grouped list
      expect(screen.getByText('Acme Corporation')).toBeInTheDocument();
      expect(screen.getByText('Beta Industries')).toBeInTheDocument();
    });
  });

  it('resets form state when modal reopens', async () => {
    const { rerender } = render(
      <ModelFileDialog
        mode="saveAs"
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
      />
    );

    await waitFor(() => {
      expect(mockListProjects).toHaveBeenCalled();
    });

    // Fill in some values
    const orgInput = screen.getByTestId('organisation-name-input');
    const projectInput = screen.getByTestId('project-name-input');

    fireEvent.change(orgInput, { target: { value: 'Test Org' } });
    fireEvent.change(projectInput, { target: { value: 'Test Project' } });

    expect(orgInput).toHaveValue('Test Org');
    expect(projectInput).toHaveValue('Test Project');

    // Close and reopen modal
    rerender(
      <ModelFileDialog
        mode="saveAs"
        isOpen={false}
        onClose={() => {}}
        onConfirm={() => {}}
      />
    );
    rerender(
      <ModelFileDialog
        mode="saveAs"
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
      />
    );

    await waitFor(() => {
      // Form fields should be reset
      expect(screen.getByTestId('organisation-name-input')).toHaveValue('');
      expect(screen.getByTestId('project-name-input')).toHaveValue('');
      expect(screen.getByTestId('parent-folder-input')).toHaveValue('');
      expect(screen.getByTestId('project-hierarchy-input')).toHaveValue('');
    });
  });

  it('shows loading state while fetching projects', async () => {
    // Make both APIs take longer
    mockListProjects.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(sampleProjects), 200))
    );
    mockListOrganisations.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(sampleOrganisations), 200))
    );

    render(
      <ModelFileDialog
        mode="saveAs"
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
      />
    );

    // Should show main loading indicator initially
    expect(screen.getByText(/Loading projects/i)).toBeInTheDocument();

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.queryByText(/Loading projects/i)).not.toBeInTheDocument();
    });
  });

  it('shows warning when organisations fail to load (non-blocking)', async () => {
    mockListOrganisations.mockRejectedValueOnce(new Error('Network error'));

    render(
      <ModelFileDialog
        mode="saveAs"
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('organisations-warning')).toBeInTheDocument();
      expect(screen.getByTestId('organisations-warning')).toHaveTextContent(
        /failed to load/i
      );
    });

    // Form should still be usable
    fireEvent.change(screen.getByTestId('organisation-name-input'), {
      target: { value: 'New Org' },
    });
    fireEvent.change(screen.getByTestId('project-name-input'), {
      target: { value: 'Test' },
    });
    fireEvent.change(screen.getByTestId('parent-folder-input'), {
      target: { value: '/test' },
    });

    expect(screen.getByTestId('save-button')).not.toBeDisabled();
  });

  it('pre-fills Project Name from currentFilename prop', async () => {
    render(
      <ModelFileDialog
        mode="saveAs"
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
        currentFilename="Existing Project"
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('project-name-input')).toHaveValue('Existing Project');
    });
  });
});

// =============================================================================
// Task Group 2: Form Fields and Validation Tests
// =============================================================================

describe('ModelFileDialog saveAs Mode - Form Fields and Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListProjects.mockResolvedValue(sampleProjects);
    mockListOrganisations.mockResolvedValue(sampleOrganisations);
    mockCreateOrganisation.mockResolvedValue({
      id: 'new-org-id',
      name: 'New Organisation',
      description: null,
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('renders four form fields in correct order for saveAs mode', async () => {
    render(
      <ModelFileDialog
        mode="saveAs"
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('organisation-name-input')).toBeInTheDocument();
    });

    // All four fields should exist
    const orgInput = screen.getByTestId('organisation-name-input');
    const projectInput = screen.getByTestId('project-name-input');
    const folderInput = screen.getByTestId('parent-folder-input');
    const hierarchyInput = screen.getByTestId('project-hierarchy-input');

    expect(orgInput).toBeInTheDocument();
    expect(projectInput).toBeInTheDocument();
    expect(folderInput).toBeInTheDocument();
    expect(hierarchyInput).toBeInTheDocument();

    // Verify DOM order: Org -> Project -> Folder -> Hierarchy
    const orgGroup = orgInput.closest('[class*="inputGroup"]');
    const projectGroup = projectInput.closest('[class*="inputGroup"]');
    const folderGroup = folderInput.closest('[class*="inputGroup"]');
    const hierarchyGroup = hierarchyInput.closest('[class*="inputGroup"]');

    if (orgGroup && projectGroup && folderGroup && hierarchyGroup) {
      expect(orgGroup.compareDocumentPosition(projectGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(projectGroup.compareDocumentPosition(folderGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(folderGroup.compareDocumentPosition(hierarchyGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('has Project Name label instead of Filename', async () => {
    render(
      <ModelFileDialog
        mode="saveAs"
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('organisation-name-input')).toBeInTheDocument();
    });

    // Should have "Product Name" label, not "Filename"
    expect(screen.getByLabelText(/Product Name/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Filename/i)).not.toBeInTheDocument();
  });

  it('populates datalist with organisations for autocomplete', async () => {
    render(
      <ModelFileDialog
        mode="saveAs"
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
      />
    );

    await waitFor(() => {
      expect(mockListOrganisations).toHaveBeenCalled();
    });

    const datalist = screen.getByTestId('organisations-datalist');
    expect(datalist).toBeInTheDocument();

    await waitFor(() => {
      const options = datalist.querySelectorAll('option');
      expect(options).toHaveLength(2);
      expect(options[0]).toHaveAttribute('value', 'Acme Corporation');
      expect(options[1]).toHaveAttribute('value', 'Beta Industries');
    });
  });

  it('disables Save button until Organisation Name, Project Name, and Parent Folder are filled', async () => {
    render(
      <ModelFileDialog
        mode="saveAs"
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('organisation-name-input')).toBeInTheDocument();
    });

    const saveButton = screen.getByTestId('save-button');

    // Initially disabled
    expect(saveButton).toBeDisabled();

    // Fill only organisation name
    fireEvent.change(screen.getByTestId('organisation-name-input'), {
      target: { value: 'Acme Corp' },
    });
    expect(saveButton).toBeDisabled();

    // Fill organisation and project name
    fireEvent.change(screen.getByTestId('project-name-input'), {
      target: { value: 'Test Project' },
    });
    expect(saveButton).toBeDisabled();

    // Fill all required fields (not hierarchy - it's optional)
    fireEvent.change(screen.getByTestId('parent-folder-input'), {
      target: { value: '/test' },
    });
    expect(saveButton).not.toBeDisabled();
  });

  it('does not require Project Hierarchy for form validation', async () => {
    render(
      <ModelFileDialog
        mode="saveAs"
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('organisation-name-input')).toBeInTheDocument();
    });

    // Fill all required fields without hierarchy
    fireEvent.change(screen.getByTestId('organisation-name-input'), {
      target: { value: 'Acme Corp' },
    });
    fireEvent.change(screen.getByTestId('project-name-input'), {
      target: { value: 'Test Project' },
    });
    fireEvent.change(screen.getByTestId('parent-folder-input'), {
      target: { value: '/test' },
    });

    // Leave hierarchy empty - Save button should still be enabled
    expect(screen.getByTestId('project-hierarchy-input')).toHaveValue('');
    expect(screen.getByTestId('save-button')).not.toBeDisabled();
  });

  it('trims whitespace when validating required fields', async () => {
    render(
      <ModelFileDialog
        mode="saveAs"
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('organisation-name-input')).toBeInTheDocument();
    });

    // Fill with whitespace-only values
    fireEvent.change(screen.getByTestId('organisation-name-input'), {
      target: { value: '   ' },
    });
    fireEvent.change(screen.getByTestId('project-name-input'), {
      target: { value: '   ' },
    });
    fireEvent.change(screen.getByTestId('parent-folder-input'), {
      target: { value: '   ' },
    });

    // Should still be disabled
    expect(screen.getByTestId('save-button')).toBeDisabled();
  });
});

// =============================================================================
// Task Group 3: Grouped List and Selection Behavior Tests
// =============================================================================

describe('ModelFileDialog saveAs Mode - Grouped List and Selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListProjects.mockResolvedValue(sampleProjects);
    mockListOrganisations.mockResolvedValue(sampleOrganisations);
    mockCreateOrganisation.mockResolvedValue({
      id: 'new-org-id',
      name: 'New Organisation',
      description: null,
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('renders OrganisationGroupedProjectList in saveAs mode', async () => {
    render(
      <ModelFileDialog
        mode="saveAs"
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('organisation-grouped-project-list')).toBeInTheDocument();
    });

    // Should show organisation names
    expect(screen.getByText('Acme Corporation')).toBeInTheDocument();
    expect(screen.getByText('Beta Industries')).toBeInTheDocument();
  });

  it('populates Organisation Name from organisationMap lookup when project clicked', async () => {
    render(
      <ModelFileDialog
        mode="saveAs"
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Acme Corporation')).toBeInTheDocument();
    });

    // Expand organisation and hierarchy
    fireEvent.click(screen.getByTestId('org-header-org-1'));

    await waitFor(() => {
      expect(screen.getByTestId('hierarchy-header-org-1-Hierarchy1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('hierarchy-header-org-1-Hierarchy1'));

    await waitFor(() => {
      expect(screen.getByTestId('project-row-proj-1')).toBeInTheDocument();
    });

    // Click project
    fireEvent.click(screen.getByTestId('project-row-proj-1'));

    // Organisation Name should be populated
    expect(screen.getByTestId('organisation-name-input')).toHaveValue('Acme Corporation');
  });

  it('populates Project Name from project.name when project clicked', async () => {
    render(
      <ModelFileDialog
        mode="saveAs"
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Acme Corporation')).toBeInTheDocument();
    });

    // Expand organisation and hierarchy
    fireEvent.click(screen.getByTestId('org-header-org-1'));

    await waitFor(() => {
      expect(screen.getByTestId('hierarchy-header-org-1-Hierarchy1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('hierarchy-header-org-1-Hierarchy1'));

    await waitFor(() => {
      expect(screen.getByTestId('project-row-proj-1')).toBeInTheDocument();
    });

    // Click project
    fireEvent.click(screen.getByTestId('project-row-proj-1'));

    // Project Name should be populated
    expect(screen.getByTestId('project-name-input')).toHaveValue('Alpha Project');
  });

  it('populates Parent Folder from project.projectParentFolder when project clicked', async () => {
    render(
      <ModelFileDialog
        mode="saveAs"
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Acme Corporation')).toBeInTheDocument();
    });

    // Expand organisation and hierarchy
    fireEvent.click(screen.getByTestId('org-header-org-1'));

    await waitFor(() => {
      expect(screen.getByTestId('hierarchy-header-org-1-Hierarchy1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('hierarchy-header-org-1-Hierarchy1'));

    await waitFor(() => {
      expect(screen.getByTestId('project-row-proj-1')).toBeInTheDocument();
    });

    // Click project
    fireEvent.click(screen.getByTestId('project-row-proj-1'));

    // Parent Folder should be populated
    expect(screen.getByTestId('parent-folder-input')).toHaveValue('/projects/alpha');
  });

  it('populates Project Hierarchy from project.projectHierarchy (or empty string if null)', async () => {
    render(
      <ModelFileDialog
        mode="saveAs"
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Acme Corporation')).toBeInTheDocument();
    });

    // Test with project that has hierarchy
    fireEvent.click(screen.getByTestId('org-header-org-1'));

    await waitFor(() => {
      expect(screen.getByTestId('hierarchy-header-org-1-Hierarchy1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('hierarchy-header-org-1-Hierarchy1'));

    await waitFor(() => {
      expect(screen.getByTestId('project-row-proj-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('project-row-proj-1'));

    // Project Hierarchy should be populated
    expect(screen.getByTestId('project-hierarchy-input')).toHaveValue('Hierarchy1');

    // Now test with project that has null hierarchy
    fireEvent.click(screen.getByTestId('org-header-org-2'));

    await waitFor(() => {
      expect(screen.getByTestId('hierarchy-header-org-2-(No hierarchy)')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('hierarchy-header-org-2-(No hierarchy)'));

    await waitFor(() => {
      expect(screen.getByTestId('project-row-proj-2')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('project-row-proj-2'));

    // Project Hierarchy should be empty (null becomes empty string)
    expect(screen.getByTestId('project-hierarchy-input')).toHaveValue('');
  });

  it('updates selectedProjectId for visual selection highlight', async () => {
    render(
      <ModelFileDialog
        mode="saveAs"
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Acme Corporation')).toBeInTheDocument();
    });

    // Expand and select project
    fireEvent.click(screen.getByTestId('org-header-org-1'));

    await waitFor(() => {
      expect(screen.getByTestId('hierarchy-header-org-1-Hierarchy1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('hierarchy-header-org-1-Hierarchy1'));

    await waitFor(() => {
      expect(screen.getByTestId('project-row-proj-1')).toBeInTheDocument();
    });

    // Click project
    fireEvent.click(screen.getByTestId('project-row-proj-1'));

    // Project row should have selected state (aria-selected="true")
    expect(screen.getByTestId('project-row-proj-1')).toHaveAttribute('aria-selected', 'true');
  });
});

// =============================================================================
// Task Group 4: Save Flow with Organisation Resolution Tests
// =============================================================================

describe('ModelFileDialog saveAs Mode - Save Flow with Organisation Resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListProjects.mockResolvedValue(sampleProjects);
    mockListOrganisations.mockResolvedValue(sampleOrganisations);
    mockCreateOrganisation.mockResolvedValue({
      id: 'new-org-id',
      name: 'New Organisation',
      description: null,
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('resolves existing organisation by exact name match on save', async () => {
    const onConfirm = vi.fn();

    render(
      <ModelFileDialog
        mode="saveAs"
        isOpen={true}
        onClose={() => {}}
        onConfirm={onConfirm}
      />
    );

    await waitFor(() => {
      expect(mockListOrganisations).toHaveBeenCalled();
    });

    // Wait for data to load
    await waitFor(() => {
      const datalist = screen.getByTestId('organisations-datalist');
      expect(datalist.querySelectorAll('option').length).toBe(2);
    });

    // Use fireEvent for more reliable input handling
    fireEvent.change(screen.getByTestId('organisation-name-input'), {
      target: { value: 'Acme Corporation' },
    });
    fireEvent.change(screen.getByTestId('project-name-input'), {
      target: { value: 'Test Project' },
    });
    fireEvent.change(screen.getByTestId('parent-folder-input'), {
      target: { value: '/test/path' },
    });

    fireEvent.click(screen.getByTestId('save-button'));

    await waitFor(() => {
      // Should NOT call createOrganisation since it matches existing
      expect(mockCreateOrganisation).not.toHaveBeenCalled();
      // Should call onConfirm with correct parameters including existing org ID
      expect(onConfirm).toHaveBeenCalledWith({
        projectName: 'Test Project',
        parentFolder: '/test/path',
        projectHierarchy: undefined,
        organisationId: 'org-1',
      });
    });
  });

  it('creates new organisation when name not found in list', async () => {
    const onConfirm = vi.fn();

    render(
      <ModelFileDialog
        mode="saveAs"
        isOpen={true}
        onClose={() => {}}
        onConfirm={onConfirm}
      />
    );

    await waitFor(() => {
      expect(mockListOrganisations).toHaveBeenCalled();
    });

    // Wait for organisations to be loaded
    await waitFor(() => {
      const datalist = screen.getByTestId('organisations-datalist');
      expect(datalist.querySelectorAll('option').length).toBe(2);
    });

    // Use fireEvent for reliable input
    fireEvent.change(screen.getByTestId('organisation-name-input'), {
      target: { value: 'New Organisation' },
    });
    fireEvent.change(screen.getByTestId('project-name-input'), {
      target: { value: 'Test Project' },
    });
    fireEvent.change(screen.getByTestId('parent-folder-input'), {
      target: { value: '/test/path' },
    });

    fireEvent.click(screen.getByTestId('save-button'));

    await waitFor(() => {
      // Should call createOrganisation with new name
      expect(mockCreateOrganisation).toHaveBeenCalledWith('New Organisation');
    });

    await waitFor(() => {
      // Should call onConfirm with the new org's ID
      expect(onConfirm).toHaveBeenCalledWith({
        projectName: 'Test Project',
        parentFolder: '/test/path',
        projectHierarchy: undefined,
        organisationId: 'new-org-id',
      });
    });
  });

  it('handles 409 OrganisationConflictError by re-fetching and finding match', async () => {
    const onConfirm = vi.fn();

    // First createOrganisation call throws 409
    mockCreateOrganisation.mockRejectedValueOnce(
      new OrganisationConflictError('Organisation already exists')
    );

    // Re-fetch returns the org that already existed
    mockListOrganisations
      .mockResolvedValueOnce(sampleOrganisations)
      .mockResolvedValueOnce([
        ...sampleOrganisations,
        { id: 'conflict-org-id', name: 'Conflict Org', description: null },
      ]);

    render(
      <ModelFileDialog
        mode="saveAs"
        isOpen={true}
        onClose={() => {}}
        onConfirm={onConfirm}
      />
    );

    await waitFor(() => {
      expect(mockListOrganisations).toHaveBeenCalledTimes(1);
    });

    // Wait for loading to complete
    await waitFor(() => {
      const datalist = screen.getByTestId('organisations-datalist');
      expect(datalist.querySelectorAll('option').length).toBe(2);
    });

    // Use fireEvent for reliable input
    fireEvent.change(screen.getByTestId('organisation-name-input'), {
      target: { value: 'Conflict Org' },
    });
    fireEvent.change(screen.getByTestId('project-name-input'), {
      target: { value: 'Test Project' },
    });
    fireEvent.change(screen.getByTestId('parent-folder-input'), {
      target: { value: '/test/path' },
    });

    fireEvent.click(screen.getByTestId('save-button'));

    await waitFor(() => {
      // Should have re-fetched organisations after 409
      expect(mockListOrganisations).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      // Should call onConfirm with the existing org's ID from re-fetch
      expect(onConfirm).toHaveBeenCalledWith({
        projectName: 'Test Project',
        parentFolder: '/test/path',
        projectHierarchy: undefined,
        organisationId: 'conflict-org-id',
      });
    });
  });

  it('passes projectHierarchy when filled', async () => {
    const onConfirm = vi.fn();

    render(
      <ModelFileDialog
        mode="saveAs"
        isOpen={true}
        onClose={() => {}}
        onConfirm={onConfirm}
      />
    );

    await waitFor(() => {
      expect(mockListOrganisations).toHaveBeenCalled();
    });

    // Wait for data to load
    await waitFor(() => {
      const datalist = screen.getByTestId('organisations-datalist');
      expect(datalist.querySelectorAll('option').length).toBe(2);
    });

    // Use fireEvent for reliable input
    fireEvent.change(screen.getByTestId('organisation-name-input'), {
      target: { value: 'Acme Corporation' },
    });
    fireEvent.change(screen.getByTestId('project-name-input'), {
      target: { value: 'Test Project' },
    });
    fireEvent.change(screen.getByTestId('parent-folder-input'), {
      target: { value: '/test/path' },
    });
    fireEvent.change(screen.getByTestId('project-hierarchy-input'), {
      target: { value: 'MyHierarchy' },
    });

    fireEvent.click(screen.getByTestId('save-button'));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith({
        projectName: 'Test Project',
        parentFolder: '/test/path',
        projectHierarchy: 'MyHierarchy',
        organisationId: 'org-1',
      });
    });
  });

  it('displays button as "Save" not "OK"', async () => {
    render(
      <ModelFileDialog
        mode="saveAs"
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('organisation-name-input')).toBeInTheDocument();
    });

    // Should have Save button, not OK
    expect(screen.getByTestId('save-button')).toHaveTextContent('Save');
    expect(screen.queryByRole('button', { name: /^OK$/i })).not.toBeInTheDocument();
  });

  it('shows error message on organisation creation failure (non-409)', async () => {
    mockCreateOrganisation.mockRejectedValueOnce(
      new Error('Failed to create organisation')
    );

    render(
      <ModelFileDialog
        mode="saveAs"
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
      />
    );

    await waitFor(() => {
      expect(mockListOrganisations).toHaveBeenCalled();
    });

    // Wait for data to load
    await waitFor(() => {
      const datalist = screen.getByTestId('organisations-datalist');
      expect(datalist.querySelectorAll('option').length).toBe(2);
    });

    // Use fireEvent for reliable input
    fireEvent.change(screen.getByTestId('organisation-name-input'), {
      target: { value: 'New Organisation' },
    });
    fireEvent.change(screen.getByTestId('project-name-input'), {
      target: { value: 'Test Project' },
    });
    fireEvent.change(screen.getByTestId('parent-folder-input'), {
      target: { value: '/test/path' },
    });

    fireEvent.click(screen.getByTestId('save-button'));

    await waitFor(() => {
      // Should display error message
      expect(screen.getByTestId('error-message')).toHaveTextContent(
        'Failed to create organisation'
      );
    });
  });
});

// =============================================================================
// Task Group 5: Integration and Additional Tests
// =============================================================================

describe('ModelFileDialog saveAs Mode - Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListProjects.mockResolvedValue(sampleProjects);
    mockListOrganisations.mockResolvedValue(sampleOrganisations);
    mockCreateOrganisation.mockResolvedValue({
      id: 'new-org-id',
      name: 'New Organisation',
      description: null,
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('complete flow: select project, modify fields, save', async () => {
    const onConfirm = vi.fn();

    render(
      <ModelFileDialog
        mode="saveAs"
        isOpen={true}
        onClose={() => {}}
        onConfirm={onConfirm}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Acme Corporation')).toBeInTheDocument();
    });

    // Expand and select project
    fireEvent.click(screen.getByTestId('org-header-org-1'));

    await waitFor(() => {
      expect(screen.getByTestId('hierarchy-header-org-1-Hierarchy1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('hierarchy-header-org-1-Hierarchy1'));

    await waitFor(() => {
      expect(screen.getByTestId('project-row-proj-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('project-row-proj-1'));

    // Verify fields are populated
    expect(screen.getByTestId('organisation-name-input')).toHaveValue('Acme Corporation');
    expect(screen.getByTestId('project-name-input')).toHaveValue('Alpha Project');
    expect(screen.getByTestId('parent-folder-input')).toHaveValue('/projects/alpha');
    expect(screen.getByTestId('project-hierarchy-input')).toHaveValue('Hierarchy1');

    // Modify project name for "Save As" using fireEvent
    fireEvent.change(screen.getByTestId('project-name-input'), {
      target: { value: 'Alpha Project Copy' },
    });

    // Click Save
    fireEvent.click(screen.getByTestId('save-button'));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith({
        projectName: 'Alpha Project Copy',
        parentFolder: '/projects/alpha',
        projectHierarchy: 'Hierarchy1',
        organisationId: 'org-1',
      });
    });
  });

  it('handles keyboard Enter to submit when form is valid', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <ModelFileDialog
        mode="saveAs"
        isOpen={true}
        onClose={() => {}}
        onConfirm={onConfirm}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('organisation-name-input')).toBeInTheDocument();
    });

    // Wait for data to load
    await waitFor(() => {
      const datalist = screen.getByTestId('organisations-datalist');
      expect(datalist.querySelectorAll('option').length).toBe(2);
    });

    // Fill required fields using fireEvent
    fireEvent.change(screen.getByTestId('organisation-name-input'), {
      target: { value: 'Acme Corporation' },
    });
    fireEvent.change(screen.getByTestId('project-name-input'), {
      target: { value: 'Test Project' },
    });
    fireEvent.change(screen.getByTestId('parent-folder-input'), {
      target: { value: '/test/path' },
    });

    // Press Enter
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalled();
    });
  });

  it('handles keyboard Escape to close modal', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <ModelFileDialog
        mode="saveAs"
        isOpen={true}
        onClose={onClose}
        onConfirm={() => {}}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('organisation-name-input')).toBeInTheDocument();
    });

    // Press Escape
    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
  });

  it('shows empty state when no projects exist', async () => {
    mockListProjects.mockResolvedValue([]);

    render(
      <ModelFileDialog
        mode="saveAs"
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/No products available/i)).toBeInTheDocument();
    });
  });

  it('Cancel button closes modal', async () => {
    const onClose = vi.fn();

    render(
      <ModelFileDialog
        mode="saveAs"
        isOpen={true}
        onClose={onClose}
        onConfirm={() => {}}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('organisation-name-input')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));

    expect(onClose).toHaveBeenCalled();
  });
});
