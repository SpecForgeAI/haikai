/**
 * CreateProjectModal dual-mode (Single/Poly + Create/Edit) tests.
 *
 * Spec 2026-06-12: Implementation-Service Init and Integration Repair --
 * Task Group 3 (Task 3.1).
 *
 * Covers the critical behaviours:
 *  (a) the Poly radio swaps the single URL field for the 2-column table with
 *      2 starting rows + add/delete row controls;
 *  (b) invalid folder names and duplicate folders/URLs block submit with
 *      inline errors;
 *  (c) Create succeeds and the modal reports init failure INLINE -- the
 *      project is created either way (init never blocks creation);
 *  (d) single-mode create dual-writes repo_url AND sends the one-entry repos
 *      map (normalised identifiers) to the init route, closing on success;
 *  (e) edit mode prefills the stored repo_url as Single with name/org
 *      read-only (radio still available pre-init);
 *  (f) the Single/Poly radio is absent in edit mode once init has succeeded
 *      (the repo CRUD editor takes over).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';

// Mock functions -- defined before vi.mock due to hoisting
const mockCreateProject = vi.fn();
const mockListProjects = vi.fn();
const mockListOrganisations = vi.fn();
const mockCreateOrganisation = vi.fn();
const mockListArchitectures = vi.fn();
const mockInitProjectWorkspace = vi.fn();
const mockGetImplementationRepoMap = vi.fn();
const mockUpdateProjectConfig = vi.fn();

vi.mock('../api/projectsApi', async () => {
  const actual = await vi.importActual('../api/projectsApi');
  return {
    ...actual,
    createProject: (...args: unknown[]) => mockCreateProject(...args),
    listProjects: () => mockListProjects(),
    updateProjectConfig: (...args: unknown[]) => mockUpdateProjectConfig(...args),
  };
});

vi.mock('../api/organisationsApi', async () => {
  const actual = await vi.importActual('../api/organisationsApi');
  return {
    ...actual,
    listOrganisations: () => mockListOrganisations(),
    createOrganisation: (name: string) => mockCreateOrganisation(name),
  };
});

vi.mock('../api/architecturesApi', async () => {
  const actual = await vi.importActual('../api/architecturesApi');
  return {
    ...actual,
    listArchitectures: (...args: unknown[]) => mockListArchitectures(...args),
  };
});

vi.mock('../api/implementationProjectsApi', async () => {
  const actual = await vi.importActual('../api/implementationProjectsApi');
  return {
    ...actual,
    initProjectWorkspace: (...args: unknown[]) => mockInitProjectWorkspace(...args),
    getImplementationRepoMap: (...args: unknown[]) =>
      mockGetImplementationRepoMap(...args),
    addImplementationRepo: vi.fn(),
    updateImplementationRepo: vi.fn(),
    deleteImplementationRepo: vi.fn(),
  };
});

vi.mock('../utils/saveUtils', () => ({
  saveModelToBackend: vi.fn().mockResolvedValue({ success: true }),
}));

// Import after mocks
import { CreateProjectModal } from '../components/Project/CreateProjectModal';
import {
  renderWithProviders,
  makeTestProject,
} from '../test-utils/renderWithProviders';

const sampleOrganisations = [
  { id: 'org-1', name: 'Acme Corp', description: null },
  { id: 'org-2', name: 'Beta Inc', description: null },
];

const createdProjectDto = {
  id: 'new-project-id',
  name: 'My Product',
  projectParentFolder: '/tmp/acme/my-product',
  projectHierarchy: null,
  organisationId: 'org-1',
  repoUrl: 'https://github.com/acme/single.git',
  isActive: true,
  createdAt: '2026-06-12T00:00:00Z',
  updatedAt: '2026-06-12T00:00:00Z',
};

function renderModal(
  props: Partial<React.ComponentProps<typeof CreateProjectModal>> = {},
  refreshActiveProject: () => Promise<void> = async () => {}
) {
  const onClose = vi.fn();
  const result = renderWithProviders(
    <CreateProjectModal isOpen={true} onClose={onClose} {...props} />,
    {
      withTemporaryDiagram: false,
      projectContextOverrides: { refreshActiveProject },
    }
  );
  return { onClose, ...result };
}

async function fillCreateForm() {
  // Wait for the organisations fetch to settle so 'Acme Corp' resolves to an
  // EXISTING organisation id (otherwise create falls into createOrganisation)
  await waitFor(() => {
    expect(screen.queryByTestId('organisations-loading')).not.toBeInTheDocument();
  });
  fireEvent.change(screen.getByTestId('organisation-name-input'), {
    target: { value: 'Acme Corp' },
  });
  fireEvent.change(screen.getByTestId('project-name-input'), {
    target: { value: 'My Product' },
  });
}

describe('CreateProjectModal - Single/Poly repo modes (Spec 2026-06-12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListOrganisations.mockResolvedValue(sampleOrganisations);
    mockListProjects.mockResolvedValue([]);
    mockCreateOrganisation.mockResolvedValue({
      id: 'new-org-id',
      name: 'New Org',
      description: null,
    });
    mockCreateProject.mockResolvedValue(createdProjectDto);
    mockListArchitectures.mockResolvedValue([]);
    mockInitProjectWorkspace.mockResolvedValue({ success: true, persisted: true });
    mockUpdateProjectConfig.mockResolvedValue(createdProjectDto);
    mockGetImplementationRepoMap.mockResolvedValue({
      company: 'acme-corp',
      project: 'test-project',
      repos: { backend: 'https://github.com/acme/backend.git' },
      changed: false,
      synced: true,
    });
  });

  it('Poly radio swaps the single URL field for a 2-column table with 2 starting rows and add/delete controls', () => {
    renderModal();

    // Single is the default: the classic single repo URL field shows
    expect(screen.getByTestId('repo-url-input')).toBeInTheDocument();
    expect(screen.queryByTestId('poly-repo-table')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('repo-mode-poly'));

    expect(screen.queryByTestId('repo-url-input')).not.toBeInTheDocument();
    expect(screen.getByTestId('poly-repo-table')).toBeInTheDocument();
    // 2 starting rows
    expect(screen.getByTestId('poly-repo-row-0')).toBeInTheDocument();
    expect(screen.getByTestId('poly-repo-row-1')).toBeInTheDocument();
    expect(screen.queryByTestId('poly-repo-row-2')).not.toBeInTheDocument();

    // Add-row control appends a third row
    fireEvent.click(screen.getByTestId('poly-add-row'));
    expect(screen.getByTestId('poly-repo-row-2')).toBeInTheDocument();

    // Delete-row control removes it again
    fireEvent.click(screen.getByTestId('poly-delete-row-2'));
    expect(screen.queryByTestId('poly-repo-row-2')).not.toBeInTheDocument();

    // Switching back restores the single URL field
    fireEvent.click(screen.getByTestId('repo-mode-single'));
    expect(screen.getByTestId('repo-url-input')).toBeInTheDocument();
  });

  it('invalid folder names and duplicate folders/URLs show inline errors and block submit', async () => {
    renderModal();
    await fillCreateForm();
    fireEvent.click(screen.getByTestId('repo-mode-poly'));

    // Invalid folder slug (uppercase + space)
    fireEvent.change(screen.getByTestId('poly-folder-input-0'), {
      target: { value: 'Bad Folder' },
    });
    fireEvent.change(screen.getByTestId('poly-url-input-0'), {
      target: { value: 'https://github.com/acme/a.git' },
    });
    expect(screen.getByTestId('poly-folder-error-0')).toBeInTheDocument();
    expect(screen.getByTestId('create-button')).toBeDisabled();

    // Duplicate folder AND duplicate URL across rows
    fireEvent.change(screen.getByTestId('poly-folder-input-0'), {
      target: { value: 'backend' },
    });
    fireEvent.change(screen.getByTestId('poly-folder-input-1'), {
      target: { value: 'backend' },
    });
    fireEvent.change(screen.getByTestId('poly-url-input-1'), {
      target: { value: 'https://github.com/acme/a.git' },
    });
    expect(screen.getByTestId('poly-folder-error-1')).toHaveTextContent(
      'Duplicate folder name'
    );
    expect(screen.getByTestId('poly-url-error-1')).toHaveTextContent(
      'Duplicate repo URL'
    );
    expect(screen.getByTestId('create-button')).toBeDisabled();

    // Fixing uniqueness on both columns enables submit
    fireEvent.change(screen.getByTestId('poly-folder-input-1'), {
      target: { value: 'frontend' },
    });
    fireEvent.change(screen.getByTestId('poly-url-input-1'), {
      target: { value: 'https://github.com/acme/b.git' },
    });
    expect(screen.queryByTestId('poly-folder-error-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('poly-url-error-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('create-button')).toBeEnabled();
  });

  it('reports init failure inline while the project is still created (modal stays open, retry offered)', async () => {
    mockInitProjectWorkspace.mockResolvedValue({
      success: false,
      detail: 'Clone failed: repository not found',
    });
    const { onClose } = renderModal();
    await fillCreateForm();
    fireEvent.change(screen.getByTestId('repo-url-input'), {
      target: { value: 'https://github.com/acme/single.git' },
    });

    fireEvent.click(screen.getByTestId('create-button'));

    await waitFor(() => {
      expect(screen.getByTestId('init-error-message')).toBeInTheDocument();
    });
    // Project creation happened and was NOT rolled back
    expect(mockCreateProject).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('init-error-message')).toHaveTextContent(
      'Clone failed: repository not found'
    );
    // The modal stays open so the user sees the detail; retry is offered
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('create-button')).toHaveTextContent('Retry Setup');
    expect(screen.getByTestId('cancel-button')).toHaveTextContent('Close');

    // Retry re-runs init ONLY -- never a second project creation
    mockInitProjectWorkspace.mockResolvedValue({ success: true });
    fireEvent.click(screen.getByTestId('create-button'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockCreateProject).toHaveBeenCalledTimes(1);
    expect(mockInitProjectWorkspace).toHaveBeenCalledTimes(2);
  });

  it('single-mode create dual-writes repo_url and sends a one-entry repos map to init with normalised identifiers', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { onClose } = renderModal({}, refresh);
    await fillCreateForm();
    fireEvent.change(screen.getByTestId('repo-url-input'), {
      target: { value: 'https://github.com/acme/single.git' },
    });

    fireEvent.click(screen.getByTestId('create-button'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    // Dual-write: repo_url still passed to the existing createProject path
    expect(mockCreateProject).toHaveBeenCalledWith(
      'My Product',
      undefined,
      undefined,
      'org-1',
      'https://github.com/acme/single.git'
    );
    // Init payload: normalised company/project + one-entry map keyed by the
    // normalised product name (the contract's promotion convention)
    expect(mockInitProjectWorkspace).toHaveBeenCalledWith({
      company: 'acme-corp',
      project: 'my-product',
      projectId: 'new-project-id',
      repos: { 'my-product': 'https://github.com/acme/single.git' },
      gitProvider: 'github',
    });
  });

  it('poly-mode create omits repo_url from createProject and sends the full multi-entry repos map to init (Task Group 6 gap analysis)', async () => {
    const { onClose } = renderModal();
    await fillCreateForm();
    fireEvent.click(screen.getByTestId('repo-mode-poly'));

    fireEvent.change(screen.getByTestId('poly-folder-input-0'), {
      target: { value: 'backend' },
    });
    fireEvent.change(screen.getByTestId('poly-url-input-0'), {
      target: { value: 'https://github.com/acme/backend.git' },
    });
    fireEvent.change(screen.getByTestId('poly-folder-input-1'), {
      target: { value: 'frontend' },
    });
    fireEvent.change(screen.getByTestId('poly-url-input-1'), {
      target: { value: 'https://github.com/acme/frontend.git' },
    });

    fireEvent.click(screen.getByTestId('create-button'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    // Poly mode does NOT dual-write projects.repo_url -- the map is the
    // source; single mode keeps the dual-write (covered above).
    expect(mockCreateProject).toHaveBeenCalledWith(
      'My Product',
      undefined,
      undefined,
      'org-1',
      undefined
    );
    // The init payload carries the full folder -> URL map verbatim.
    expect(mockInitProjectWorkspace).toHaveBeenCalledWith({
      company: 'acme-corp',
      project: 'my-product',
      projectId: 'new-project-id',
      repos: {
        backend: 'https://github.com/acme/backend.git',
        frontend: 'https://github.com/acme/frontend.git',
      },
      gitProvider: 'github',
    });
  });

  it('edit-mode conversion path: init failure surfaces detail inline, retry success refreshes the active project then closes (Task Group 6 gap analysis)', async () => {
    mockInitProjectWorkspace.mockResolvedValueOnce({
      success: false,
      detail: 'Clone failed: legacy repo unreachable',
    });
    const refresh = vi.fn().mockResolvedValue(undefined);
    const project = makeTestProject({
      id: 'proj-9',
      name: 'Legacy Product',
      organisationId: 'org-1',
      repoUrl: 'https://github.com/acme/legacy.git',
      implementationInitSuccess: false,
    });
    const { onClose } = renderModal({ mode: 'edit', project }, refresh);

    await waitFor(() => {
      expect(screen.getByTestId('organisation-name-input')).toHaveValue('Acme Corp');
    });

    // First Save: init fails upstream -- the detail surfaces inline and the
    // modal stays open (the project itself is untouched).
    fireEvent.click(screen.getByTestId('create-button'));
    await waitFor(() => {
      expect(screen.getByTestId('init-error-message')).toHaveTextContent(
        'Clone failed: legacy repo unreachable'
      );
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(mockCreateProject).not.toHaveBeenCalled();

    // Retry: init succeeds -- the modal refreshes the active project (so the
    // Implementation gate sees implementation_init_success=true) THEN closes.
    fireEvent.click(screen.getByTestId('create-button'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(refresh).toHaveBeenCalled();
    expect(mockInitProjectWorkspace).toHaveBeenCalledTimes(2);
    expect(mockCreateProject).not.toHaveBeenCalled();
  });

  it('edit mode pre-init: title "Edit project", project fields read-only, repo_url prefilled as Single, radio available', async () => {
    const project = makeTestProject({
      id: 'proj-9',
      name: 'Legacy Product',
      organisationId: 'org-1',
      repoUrl: 'https://github.com/acme/legacy.git',
      implementationInitSuccess: false,
    });
    renderModal({ mode: 'edit', project });

    expect(screen.getByText('Edit project')).toBeInTheDocument();

    // Organisation name resolves from the fetched organisations list
    await waitFor(() => {
      expect(screen.getByTestId('organisation-name-input')).toHaveValue('Acme Corp');
    });

    // Project-determined fields are locked
    expect(screen.getByTestId('organisation-name-input')).toBeDisabled();
    expect(screen.getByTestId('project-name-input')).toBeDisabled();
    expect(screen.getByTestId('project-name-input')).toHaveValue('Legacy Product');

    // Stored repo_url prefills as Single; the radio is still switchable
    expect(screen.getByTestId('repo-mode-radio-group')).toBeInTheDocument();
    expect(screen.getByTestId('repo-url-input')).toHaveValue(
      'https://github.com/acme/legacy.git'
    );
    expect(screen.getByTestId('repo-url-input')).toBeEnabled();

    // Save attempts init for the EXISTING project (no createProject call)
    fireEvent.click(screen.getByTestId('create-button'));
    await waitFor(() => expect(mockInitProjectWorkspace).toHaveBeenCalled());
    expect(mockCreateProject).not.toHaveBeenCalled();
    expect(mockInitProjectWorkspace).toHaveBeenCalledWith({
      company: 'acme-corp',
      project: 'legacy-product',
      projectId: 'proj-9',
      repos: { 'legacy-product': 'https://github.com/acme/legacy.git' },
      gitProvider: 'github',
    });
  });

  it('edit-mode Save PERSISTS the edited repo URL to the database BEFORE running init (2026-07-27)', async () => {
    const project = makeTestProject({
      id: 'proj-9',
      name: 'Legacy Product',
      organisationId: 'org-1',
      repoUrl: 'https://github.com/acme/legacy.git',
      implementationInitSuccess: false,
    });
    renderModal({ mode: 'edit', project });
    await waitFor(() => {
      expect(screen.getByTestId('organisation-name-input')).toHaveValue('Acme Corp');
    });

    // Edit the prefilled URL, then Save.
    fireEvent.change(screen.getByTestId('repo-url-input'), {
      target: { value: 'https://github.com/acme/replatform.git' },
    });
    fireEvent.click(screen.getByTestId('create-button'));

    // The EDITED value lands in the database (pre-fix, Save only re-ran init
    // and the row kept the stale URL)…
    await waitFor(() => {
      expect(mockUpdateProjectConfig).toHaveBeenCalledWith('proj-9', {
        repoUrl: 'https://github.com/acme/replatform.git',
      });
    });
    // …and init receives the SAME edited URL, AFTER the persist.
    await waitFor(() => expect(mockInitProjectWorkspace).toHaveBeenCalled());
    expect(mockInitProjectWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        repos: { 'legacy-product': 'https://github.com/acme/replatform.git' },
      })
    );
    expect(mockUpdateProjectConfig.mock.invocationCallOrder[0]).toBeLessThan(
      mockInitProjectWorkspace.mock.invocationCallOrder[0]
    );
  });

  it('edit-mode Save: a DB-save failure blocks init and surfaces inline (the project row is the source of truth)', async () => {
    mockUpdateProjectConfig.mockRejectedValueOnce(new Error('AMS unavailable'));
    const project = makeTestProject({
      id: 'proj-9',
      name: 'Legacy Product',
      organisationId: 'org-1',
      repoUrl: 'https://github.com/acme/legacy.git',
      implementationInitSuccess: false,
    });
    const { onClose } = renderModal({ mode: 'edit', project });
    await waitFor(() => {
      expect(screen.getByTestId('organisation-name-input')).toHaveValue('Acme Corp');
    });

    fireEvent.click(screen.getByTestId('create-button'));
    await waitFor(() => {
      expect(screen.getByText(/Failed to save project changes: AMS unavailable/)).toBeInTheDocument();
    });
    expect(mockInitProjectWorkspace).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('edit mode post-init: Single/Poly radio is gone and the repo CRUD editor loads the live map', async () => {
    const project = makeTestProject({
      id: 'proj-1',
      name: 'Test Project',
      organisationId: 'org-1',
      implementationInitSuccess: true,
    });
    renderModal({ mode: 'edit', project });

    await waitFor(() => {
      expect(screen.getByTestId('repo-map-editor')).toBeInTheDocument();
    });

    // No radio, no single URL field, no poly table -- CRUD editor instead
    expect(screen.queryByTestId('repo-mode-radio-group')).not.toBeInTheDocument();
    expect(screen.queryByTestId('repo-url-input')).not.toBeInTheDocument();
    expect(screen.queryByTestId('poly-repo-table')).not.toBeInTheDocument();

    // Map loaded through the gateway GET with normalised identifiers
    expect(mockGetImplementationRepoMap).toHaveBeenCalledWith(
      'acme-corp',
      'test-project',
      'proj-1'
    );
    expect(screen.getByTestId('repo-map-row-backend')).toBeInTheDocument();

    // Footer is Close-only (no Save/Create) post-init
    expect(screen.queryByTestId('create-button')).not.toBeInTheDocument();
    expect(screen.getByTestId('cancel-button')).toHaveTextContent('Close');
  });
});
