/**
 * CreateProjectModal Component
 *
 * Spec 2026-01-05: Project Model with Active Project
 * Spec 2026-01-05: Auto-Save After Create Project
 * Spec 2026-01-10: Project Hierarchy Grouping - Added Project Hierarchy input field
 * Spec 2026-01-18: Organisations Iteration 2 - Added Organisation Name autocomplete field
 * Spec 2026-06-06: Product Hierarchy field autocompletes from the existing hierarchies in the selected organisation
 * Spec 2026-06-12: Implementation-Service Init and Integration Repair (Task Groups 3+4)
 *   - Dual-mode component: Create Product ("create") AND "Edit project" ("edit").
 *   - Single/Poly repo selection: Single keeps the mandatory single repo URL
 *     field; Poly is a 2-column (folder, repo URL) table with add/delete rows.
 *   - After project creation the gateway init route (POST
 *     /api/implementation/projects/init) registers the workspace. Init NEVER
 *     blocks creation: on failure the upstream detail surfaces inline and the
 *     project remains created (init-success=false persisted by the gateway).
 *   - Edit mode: project-determined fields read-only; pre-init the stored
 *     repo_url prefills as Single (radio switchable until init succeeds);
 *     post-init the radio disappears and the Repositories section becomes the
 *     repo-CRUD home (RepoMapEditor).
 *
 * Modal dialog for creating a new project.
 * Features:
 * - Four input fields: Organisation Name (required), Product Name (required), Git Repo (required), Product Hierarchy (optional)
 * - Organisation Name field with autocomplete from loaded organisations list
 * - Parent folder is computed server-side as <projectRootDir>/<orgName>/<productName>/
 * - Create button disabled until required fields (organisationName, name) have non-empty trimmed values
 * - Cancel button closes modal without action
 * - On Create success: calls refreshActiveProject, auto-saves, and closes modal
 * - Shows inline error message below inputs if API returns error
 * - Auto-save failure shows non-blocking notification (project creation still succeeds)
 *
 * Follows styling pattern from ModelFileDialog.tsx.
 */

import React, { useState, useEffect, useRef } from 'react';
import { createProject, listProjects, updateProjectConfig, ProjectDto } from '../../api/projectsApi';
// Spec 2026-05-11: architecture-scoped save needs the new project's default architecture id
import { listArchitectures } from '../../api/architecturesApi';
import {
  listOrganisations,
  createOrganisation,
  OrganisationDto,
  OrganisationConflictError,
} from '../../api/organisationsApi';
import { useRefreshActiveProject } from '../../contexts/ProjectContext';
// Spec 2026-01-05: Import ArchitectureContext for auto-save
import { useArchitectureContext } from '../../contexts/ArchitectureContext';
// Spec 2026-01-05: Import saveModelToBackend utility for auto-save
import { saveModelToBackend } from '../../utils/saveUtils';
import { emptyModel } from '../../config/defaults';
import { validateName, MAX_NAME_LENGTH } from '../../utils/validateName';
import styles from './CreateProjectModal.module.css';
// Spec 2026-06-06: pure derivation for the Product Hierarchy autocomplete
import { deriveHierarchySuggestions } from './createProjectHierarchy';
// Spec 2026-06-12: workspace registration + repo-map validation
import { initProjectWorkspace } from '../../api/implementationProjectsApi';
import { normalizeIdentifier } from '../../utils/normalizeIdentifier';
import {
  RepoRow,
  validateRepoRows,
  deriveSingleRepoFolder,
} from './repoMapValidation';
import { RepoMapEditor } from './RepoMapEditor';
import {
  GitProvider,
  GIT_PROVIDERS,
  GIT_PROVIDER_LABELS,
  DEFAULT_GIT_PROVIDER,
  deriveGitProvider,
} from './gitProvider';

/** Repo selection mode (Spec 2026-06-12). */
export type RepoSelectionMode = 'single' | 'poly';

/**
 * Props for CreateProjectModal component
 */
export interface CreateProjectModalProps {
  /** Whether the modal is visible */
  isOpen: boolean;
  /** Callback when modal is closed (via Cancel or successful create) */
  onClose: () => void;
  /**
   * Dual-mode switch (Spec 2026-06-12). 'create' (default) is the classic
   * Create Product flow. 'edit' retitles the modal "Edit project", locks the
   * project-determined fields, and makes the Repositories section the
   * editable home (Single/Poly + init pre-init; repo CRUD post-init).
   */
  mode?: 'create' | 'edit';
  /** The project being edited. Required when mode='edit'. */
  project?: ProjectDto | null;
}

const EMPTY_POLY_ROWS: RepoRow[] = [
  { folder: '', url: '' },
  { folder: '', url: '' },
];

/**
 * CreateProjectModal Component
 *
 * Renders a modal dialog for creating a new project (or editing an existing
 * one's Repositories in edit mode).
 */
export function CreateProjectModal({
  isOpen,
  onClose,
  mode = 'create',
  project = null,
}: CreateProjectModalProps) {
  const isEdit = mode === 'edit' && project !== null;
  /**
   * The stored init-success flag can DRIFT from reality (2026-07-27): AMS
   * says initialised, but the workspace directory is gone (wiped host dir,
   * different machine). When the post-init repo-map read FAILS, this holds
   * the failure message and the modal falls back to the PRE-INIT form so the
   * user can RE-INITIALISE — the whole point of Edit. Pre-fix the modal
   * dead-ended: the error rendered inside the CRUD editor and the footer was
   * Close-only, with no path to re-run projects/init.
   */
  const [workspaceLoadError, setWorkspaceLoadError] = useState<string | null>(null);
  // Post-init: workspace registration already succeeded for this project --
  // the Single/Poly radio disappears and repo changes go through repo CRUD.
  // A FAILED workspace read cancels post-init (the re-initialise fallback).
  const postInit =
    isEdit &&
    project?.implementationInitSuccess === true &&
    workspaceLoadError === null;

  // Form state
  const [projectName, setProjectName] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [projectHierarchy, setProjectHierarchy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Spec 2026-06-12: Single/Poly repo selection + workspace init state
  const [repoMode, setRepoMode] = useState<RepoSelectionMode>('single');
  const [polyRows, setPolyRows] = useState<RepoRow[]>(EMPTY_POLY_ROWS);
  /**
   * Workspace-wide git provider sent to init. Auto-derived from the repo URL
   * (so the common case needs no interaction) until the user picks one
   * explicitly, after which `providerTouched` pins their choice.
   */
  const [gitProvider, setGitProvider] = useState<GitProvider>(DEFAULT_GIT_PROVIDER);
  const [providerTouched, setProviderTouched] = useState(false);
  /** 'creating' while the Haikai project is created; 'initialising' during init. */
  const [submitStage, setSubmitStage] = useState<'idle' | 'creating' | 'initialising'>('idle');
  /** Upstream init failure detail, surfaced inline (project still created). */
  const [initError, setInitError] = useState<string | null>(null);
  /**
   * Set once the Haikai project has been created in this modal session.
   * Subsequent submits ONLY retry init -- creation never re-runs and is
   * never rolled back by an init failure.
   */
  const [createdProject, setCreatedProject] = useState<ProjectDto | null>(null);

  // Spec 2026-01-18: Organisation state
  const [organisationName, setOrganisationName] = useState('');
  const [organisations, setOrganisations] = useState<OrganisationDto[]>([]);
  const [organisationsLoading, setOrganisationsLoading] = useState(false);
  const [organisationsError, setOrganisationsError] = useState<string | null>(null);

  // Spec 2026-06-06: Existing products, fetched once on open. The Product
  // Hierarchy autocomplete suggestions are derived from these (distinct
  // hierarchy values of the products in the SELECTED organisation).
  const [projects, setProjects] = useState<ProjectDto[]>([]);

  // Get refresh function from context
  const refreshActiveProject = useRefreshActiveProject();

  // Spec 2026-01-05: Get dispatch from ArchitectureContext for auto-save and reset
  const { dispatch } = useArchitectureContext();

  // Ref for input focus
  const orgInputRef = useRef<HTMLInputElement>(null);

  /**
   * Reset form state and load organisations when modal opens
   *
   * Spec 2026-01-18: Also reset organisation-related state and fetch organisations
   * Spec 2026-06-12: Edit mode prefills the project-determined fields from the
   * project prop (read-only) and the stored repo_url as Single; the
   * organisation name resolves from the fetched organisations list.
   */
  useEffect(() => {
    if (isOpen) {
      // Reset form state (edit mode prefills from the project prop)
      setProjectName(isEdit && project ? project.name : '');
      setRepoUrl(isEdit && project ? project.repoUrl ?? '' : '');
      setProjectHierarchy(isEdit && project ? project.projectHierarchy ?? '' : '');
      setOrganisationName('');
      setOrganisations([]);
      setProjects([]);
      setOrganisationsError(null);
      setError(null);
      setIsSubmitting(false);
      setRepoMode('single');
      setPolyRows(EMPTY_POLY_ROWS);
      // Seed the provider from any prefilled repo URL (edit mode); leave it
      // un-touched so it keeps auto-tracking the URL until the user overrides.
      const prefillUrl = isEdit && project ? project.repoUrl ?? '' : '';
      setGitProvider(deriveGitProvider(prefillUrl) ?? DEFAULT_GIT_PROVIDER);
      setProviderTouched(false);
      setSubmitStage('idle');
      setInitError(null);
      setCreatedProject(null);
      setWorkspaceLoadError(null);

      // Fetch organisations
      setOrganisationsLoading(true);
      listOrganisations()
        .then((orgs) => {
          setOrganisations(orgs);
          // Spec 2026-06-12: edit mode -- resolve the project's organisation
          // name (read-only display + company identifier derivation).
          if (isEdit && project?.organisationId) {
            const org = orgs.find((o) => o.id === project.organisationId);
            if (org) {
              setOrganisationName(org.name);
            }
          }
          setOrganisationsLoading(false);
        })
        .catch((err) => {
          console.warn('Failed to load organisations:', err);
          setOrganisationsError('Failed to load organisations. You can still enter a new organisation name.');
          setOrganisationsLoading(false);
        });

      // Spec 2026-06-06: Fetch existing products to power the Product Hierarchy
      // autocomplete (filtered to the selected organisation at render time).
      // Non-blocking — on failure the field simply has no suggestions and stays
      // a plain free-text input.
      listProjects()
        .then((loadedProjects) => setProjects(loadedProjects))
        .catch((err) => {
          console.warn('Failed to load products for hierarchy autocomplete:', err);
          setProjects([]);
        });

      // Focus organisation input with small delay
      const timeoutId = setTimeout(() => {
        orgInputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timeoutId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  /**
   * Handle keyboard events (Escape to close)
   */
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  /**
   * Auto-track the git provider from the repo URL until the user overrides it.
   * Uses the single-mode URL, or the first non-empty poly row URL. A URL that
   * matches no known provider leaves the current selection intact.
   */
  useEffect(() => {
    if (providerTouched) return;
    const url =
      repoMode === 'single'
        ? repoUrl
        : polyRows.find((r) => r.url.trim().length > 0)?.url ?? '';
    const derived = deriveGitProvider(url);
    if (derived) setGitProvider(derived);
  }, [repoMode, repoUrl, polyRows, providerTouched]);

  // Don't render if not open
  if (!isOpen) {
    return null;
  }

  // Inline validation using shared validateName utility
  const orgNameError = organisationName.length > 0 ? validateName(organisationName, 'Organisation name') : null;
  const productNameError = projectName.length > 0 ? validateName(projectName, 'Product name') : null;

  // Spec 2026-06-12: Poly table validation (folder slug rule + uniqueness on
  // BOTH columns). Errors render inline per row; emptiness blocks submit
  // silently (matching the existing required-field convention).
  const { rowErrors: polyRowErrors, valid: polyRowsValid } = validateRepoRows(polyRows);

  const reposSectionValid =
    repoMode === 'single' ? repoUrl.trim().length > 0 : polyRowsValid;

  // Project-determined fields are locked once the project exists: in edit
  // mode, and in create mode after creation succeeded (init retry phase).
  const projectFieldsLocked = isEdit || createdProject !== null;

  // Form is valid when: all required fields are non-empty after trim AND pass validation
  const isFormValid =
    organisationName.trim().length > 0 &&
    projectName.trim().length > 0 &&
    reposSectionValid &&
    orgNameError === null &&
    productNameError === null;

  // Spec 2026-06-06: Product Hierarchy autocomplete suggestions — the distinct
  // hierarchy values of existing products in the SELECTED organisation only
  // (see deriveHierarchySuggestions). Empty until an organisation is identified;
  // the field stays free-text (suggest, not restrict).
  const hierarchySuggestions = deriveHierarchySuggestions(
    projects,
    organisations,
    organisationName,
  );

  /**
   * Builds the folder -> URL repos map sent to init. The map form is used
   * for BOTH modes: single mode sends a one-entry map keyed consistently
   * with the contract's repo_url promotion convention (normalised product
   * name).
   */
  const buildReposMap = (forProjectName: string): Record<string, string> => {
    if (repoMode === 'single') {
      return { [deriveSingleRepoFolder(forProjectName)]: repoUrl.trim() };
    }
    return Object.fromEntries(
      polyRows.map((row) => [row.folder.trim(), row.url.trim()])
    );
  };

  /**
   * Registers the project workspace with the implementation service via the
   * gateway. Returns true on success (modal closes). On failure the upstream
   * detail surfaces inline -- the project is ALREADY created and stays
   * created (the gateway persists init-success=false).
   */
  const runInit = async (targetProject: ProjectDto): Promise<boolean> => {
    setSubmitStage('initialising');
    setInitError(null);
    try {
      const result = await initProjectWorkspace({
        company: normalizeIdentifier(organisationName.trim()),
        project: normalizeIdentifier(targetProject.name),
        projectId: targetProject.id,
        repos: buildReposMap(targetProject.name),
        gitProvider,
      });
      if (result.success) {
        // Pick up the persisted init-status fields on the active project so
        // the Implementation gate opens without a reload.
        await refreshActiveProject();
        onClose();
        return true;
      }
      setInitError(result.detail || 'Workspace setup failed');
    } catch (err) {
      setInitError(err instanceof Error ? err.message : 'Workspace setup failed');
    }
    setSubmitStage('idle');
    setIsSubmitting(false);
    return false;
  };

  /**
   * Handle Create button click
   *
   * Spec 2026-01-05: After successful project creation and refresh,
   * automatically saves the model using the project name as the filename.
   * The save is non-blocking - modal closes regardless of save outcome.
   *
   * Spec 2026-01-10: Project Hierarchy Grouping - Pass trimmed projectHierarchy
   * (or undefined if blank) to createProject API call.
   *
   * Spec 2026-01-18: Organisations Iteration 2 - Resolve organisation ID before
   * creating project. Either match existing org or create new one, handling 409.
   *
   * Spec 2026-06-12: After creation, calls the workspace init route. Init
   * NEVER fails or rolls back creation: on init failure the modal stays open
   * with the upstream detail inline and the primary button becomes a
   * "Retry Setup" that re-runs init only. Edit mode skips creation entirely
   * (Save attempts init for the existing project).
   */
  const handleCreate = async () => {
    if (!isFormValid || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);
    setInitError(null);

    // Edit mode: the project already exists. Save PERSISTS the edited values
    // to the database FIRST (2026-07-27 — previously Save only re-ran init,
    // silently discarding the edited repo URL from the project row), then
    // registers/refreshes the workspace via POST /projects/init. Post-init
    // projects edit repos through the RepoMapEditor's own CRUD (which
    // persists as it goes), so the row write applies to the pre-init form.
    if (isEdit && project) {
      if (!postInit) {
        try {
          await updateProjectConfig(project.id, {
            // Single mode saves the URL; poly mode explicitly clears the
            // single-repo column (the workspace repo map, persisted by the
            // init route, becomes the authoritative store).
            repoUrl: repoMode === 'single' ? repoUrl.trim() : '',
          });
        } catch (err) {
          setError(
            err instanceof Error
              ? `Failed to save project changes: ${err.message}`
              : 'Failed to save project changes'
          );
          setSubmitStage('idle');
          setIsSubmitting(false);
          return;
        }
      }
      await runInit(project);
      return;
    }

    // Create mode, init-retry phase: project already created in this session.
    if (createdProject) {
      await runInit(createdProject);
      return;
    }

    setSubmitStage('creating');

    try {
      const trimmedOrgName = organisationName.trim();
      const trimmedName = projectName.trim();
      const trimmedRepoUrl = repoUrl.trim();
      // Spec 2026-01-10: Only pass hierarchy if non-empty after trimming
      const trimmedHierarchy = projectHierarchy.trim() || undefined;

      // Spec 2026-01-18: Step 1 - Resolve organisation ID
      let organisationId: string;

      // Check if organisation name matches an existing one (case-sensitive exact match)
      const existingOrg = organisations.find((org) => org.name === trimmedOrgName);

      if (existingOrg) {
        // Use existing organisation's ID
        organisationId = existingOrg.id;
      } else {
        // Create new organisation
        try {
          const newOrg = await createOrganisation(trimmedOrgName);
          organisationId = newOrg.id;
        } catch (orgError) {
          // Handle 409 Conflict: re-fetch organisations and find matching one
          if (orgError instanceof OrganisationConflictError) {
            const refreshedOrgs = await listOrganisations();
            setOrganisations(refreshedOrgs);

            const conflictOrg = refreshedOrgs.find((org) => org.name === trimmedOrgName);
            if (conflictOrg) {
              organisationId = conflictOrg.id;
            } else {
              // Should not happen, but handle gracefully
              throw new Error('Organisation conflict but could not find matching organisation');
            }
          } else {
            // Re-throw other errors with appropriate message
            const errorMessage =
              orgError instanceof Error ? orgError.message : 'Failed to create organisation';
            throw new Error(errorMessage);
          }
        }
      }

      // Step 2: Create the project with organisation ID (parentFolder omitted — backend defaults it).
      // Spec 2026-06-12: single-repo mode keeps DUAL-WRITING projects.repo_url;
      // poly mode omits it (the repo map is persisted via the init route).
      const created = await createProject(
        trimmedName,
        undefined,
        trimmedHierarchy,
        organisationId,
        repoMode === 'single' ? trimmedRepoUrl : undefined
      );
      setCreatedProject(created);

      // Step 3: Refresh active project to update context
      await refreshActiveProject();

      // Step 4: Reset architecture state for blank slate, then save empty model
      dispatch({ type: 'RESET_MODEL' });

      // Spec 2026-05-11: architecture-scoped save requires the project's
      // default architecture id. The backend auto-creates a default
      // architecture when a project is created (spec 2026-05-01 Multi-
      // Architecture Plumbing). We list the new project's architectures
      // and pick the oldest non-archived one (which `listArchitectures`
      // returns first, ordered by created_at ASC).
      (async () => {
        try {
          const architectures = await listArchitectures(created.id);
          const defaultArch = architectures.find((a) => !a.archived);
          if (!defaultArch) {
            console.warn(
              `Auto-save after project creation skipped: project "${created.id}" has no non-archived architecture.`
            );
            return;
          }
          const result = await saveModelToBackend(
            { ...emptyModel },
            trimmedName,
            created.id,
            defaultArch.id,
            dispatch
          );
          if (!result.success) {
            // Log error for debugging but don't block user
            console.warn(
              'Auto-save after project creation failed:',
              result.error || (result.validationErrors ? 'Validation errors' : 'Unknown error')
            );
          }
        } catch (err) {
          console.error('Unexpected error during auto-save:', err);
        }
      })();

      // Step 5 (Spec 2026-06-12): Register the workspace. On success the
      // modal closes inside runInit; on failure the detail surfaces inline
      // and the project REMAINS created (never rolled back).
      await runInit(created);
    } catch (err) {
      // Project/organisation creation failed - do NOT trigger auto-save
      const errorMessage = err instanceof Error ? err.message : 'Failed to create project';
      setError(errorMessage);
      setSubmitStage('idle');
      setIsSubmitting(false);
    }
  };

  /**
   * Handle Enter key in form
   */
  const handleKeyPress = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && isFormValid && !isSubmitting && !postInit) {
      handleCreate();
    }
  };

  /**
   * Handle overlay click (close dialog)
   */
  const handleOverlayClick = () => {
    if (!isSubmitting) {
      onClose();
    }
  };

  /**
   * Handle modal content click (prevent propagation)
   */
  const handleModalClick = (event: React.MouseEvent) => {
    event.stopPropagation();
  };

  // Spec 2026-06-12: Poly table row handlers
  const updatePolyRow = (index: number, field: keyof RepoRow, value: string) => {
    setPolyRows((rows) =>
      rows.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    );
  };
  const addPolyRow = () => {
    setPolyRows((rows) => [...rows, { folder: '', url: '' }]);
  };
  const deletePolyRow = (index: number) => {
    setPolyRows((rows) => (rows.length > 1 ? rows.filter((_, i) => i !== index) : rows));
  };

  // Identifier derivations for the post-init repo CRUD editor.
  const companyIdentifier = normalizeIdentifier(organisationName.trim());
  const projectIdentifier = isEdit && project ? normalizeIdentifier(project.name) : '';

  const title = isEdit ? 'Edit project' : 'Create Product';
  const primaryLabel =
    submitStage === 'creating'
      ? 'Creating...'
      : submitStage === 'initialising'
        ? 'Setting up workspace...'
        : isEdit
          ? 'Save'
          : createdProject
            ? 'Retry Setup'
            : 'Create';
  // Once the project exists (edit mode, or create succeeded but init failed),
  // dismissing the modal is a "Close", not a "Cancel".
  const dismissLabel = projectFieldsLocked ? 'Close' : 'Cancel';

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={styles.modal} onClick={handleModalClick}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          <button
            className={styles.closeButton}
            onClick={onClose}
            disabled={isSubmitting}
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className={styles.content}>
          {/* Spec 2026-01-18: Organisation Name input with autocomplete - at TOP of form */}
          <div className={styles.inputGroup}>
            <label className={styles.inputLabel} htmlFor="organisation-name-input">
              Organisation Name
            </label>
            <input
              ref={orgInputRef}
              id="organisation-name-input"
              type="text"
              className={styles.input}
              value={organisationName}
              onChange={(e) => setOrganisationName(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Select or enter organisation name..."
              disabled={isSubmitting || projectFieldsLocked}
              readOnly={projectFieldsLocked}
              maxLength={MAX_NAME_LENGTH}
              list="organisations-datalist"
              data-testid="organisation-name-input"
            />
            <datalist id="organisations-datalist" data-testid="organisations-datalist">
              {organisations.map((org) => (
                <option key={org.id} value={org.name} />
              ))}
            </datalist>
            {/* Loading indicator */}
            {organisationsLoading && (
              <span className={styles.organisationLoading} data-testid="organisations-loading">
                Loading organisations...
              </span>
            )}
            {/* Non-blocking warning for load failure */}
            {organisationsError && (
              <span className={styles.organisationWarning} data-testid="organisations-warning">
                {organisationsError}
              </span>
            )}
            {/* Inline validation error */}
            {orgNameError && (
              <span className={styles.validationError} data-testid="org-name-validation-error">
                {orgNameError}
              </span>
            )}
          </div>

          {/* Project Name input */}
          <div className={styles.inputGroup}>
            <label className={styles.inputLabel} htmlFor="project-name-input">
              Product Name
            </label>
            <input
              id="project-name-input"
              type="text"
              className={styles.input}
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Enter product name..."
              disabled={isSubmitting || projectFieldsLocked}
              readOnly={projectFieldsLocked}
              maxLength={MAX_NAME_LENGTH}
              data-testid="project-name-input"
            />
            {/* Inline validation error */}
            {productNameError && (
              <span className={styles.validationError} data-testid="product-name-validation-error">
                {productNameError}
              </span>
            )}
          </div>

          {/* Repositories section - Spec 2026-03-21 (single URL) +
              Spec 2026-06-12 (Single/Poly + post-init CRUD) */}
          {!postInit && (
            <div className={styles.inputGroup}>
              <span className={styles.inputLabel}>Repo:</span>
              <div
                className={styles.radioGroup}
                role="radiogroup"
                aria-label="Repo mode"
                data-testid="repo-mode-radio-group"
              >
                <label className={styles.radioLabel}>
                  <input
                    type="radio"
                    name="repo-mode"
                    value="single"
                    checked={repoMode === 'single'}
                    onChange={() => setRepoMode('single')}
                    disabled={isSubmitting}
                    data-testid="repo-mode-single"
                  />
                  Single
                </label>
                <label className={styles.radioLabel}>
                  <input
                    type="radio"
                    name="repo-mode"
                    value="poly"
                    checked={repoMode === 'poly'}
                    onChange={() => setRepoMode('poly')}
                    disabled={isSubmitting}
                    data-testid="repo-mode-poly"
                  />
                  Poly
                </label>
              </div>
            </div>
          )}

          {/* Git Repo URL input - Spec 2026-03-21: Project Repo URL (Single mode) */}
          {!postInit && repoMode === 'single' && (
            <div className={styles.inputGroup}>
              <label className={styles.inputLabel} htmlFor="repo-url-input">
                Git Repo
              </label>
              <input
                id="repo-url-input"
                type="text"
                className={styles.input}
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="e.g., https://github.com/acme/backend.git"
                disabled={isSubmitting}
                data-testid="repo-url-input"
              />
            </div>
          )}

          {/* Poly repo table - Spec 2026-06-12 */}
          {!postInit && repoMode === 'poly' && (
            <div className={styles.inputGroup}>
              <table className={styles.repoTable} data-testid="poly-repo-table">
                <thead>
                  <tr>
                    <th className={styles.repoTableHeader}>Folder</th>
                    <th className={styles.repoTableHeader}>Repo URL</th>
                    <th className={styles.repoTableHeader} aria-hidden="true"></th>
                  </tr>
                </thead>
                <tbody>
                  {polyRows.map((row, index) => (
                    <tr key={index} data-testid={`poly-repo-row-${index}`}>
                      <td className={styles.repoTableCell}>
                        <input
                          type="text"
                          className={styles.input}
                          value={row.folder}
                          onChange={(e) => updatePolyRow(index, 'folder', e.target.value)}
                          placeholder="e.g., backend"
                          disabled={isSubmitting}
                          aria-label={`Folder name for repo ${index + 1}`}
                          data-testid={`poly-folder-input-${index}`}
                        />
                        {row.folder.trim().length > 0 && polyRowErrors[index]?.folder && (
                          <span
                            className={styles.validationError}
                            data-testid={`poly-folder-error-${index}`}
                          >
                            {polyRowErrors[index].folder}
                          </span>
                        )}
                      </td>
                      <td className={styles.repoTableCell}>
                        <input
                          type="text"
                          className={styles.input}
                          value={row.url}
                          onChange={(e) => updatePolyRow(index, 'url', e.target.value)}
                          placeholder="e.g., https://github.com/acme/backend.git"
                          disabled={isSubmitting}
                          aria-label={`Repo URL for repo ${index + 1}`}
                          data-testid={`poly-url-input-${index}`}
                        />
                        {row.url.trim().length > 0 && polyRowErrors[index]?.url && (
                          <span
                            className={styles.validationError}
                            data-testid={`poly-url-error-${index}`}
                          >
                            {polyRowErrors[index].url}
                          </span>
                        )}
                      </td>
                      <td className={styles.repoTableActionCell}>
                        <button
                          type="button"
                          className={styles.repoRowDeleteButton}
                          onClick={() => deletePolyRow(index)}
                          disabled={isSubmitting || polyRows.length <= 1}
                          aria-label={`Delete repo row ${index + 1}`}
                          data-testid={`poly-delete-row-${index}`}
                        >
                          &times;
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button
                type="button"
                className={styles.addRowButton}
                onClick={addPolyRow}
                disabled={isSubmitting}
                data-testid="poly-add-row"
              >
                + Add repo
              </button>
            </div>
          )}

          {/* Git Provider selector. The IV service /projects/init endpoint
              needs the workspace's provider to pick the right auth strategy.
              Auto-derived from the repo URL (see the effect above); the user
              can override. Shown for both Single and Poly, pre-init only. */}
          {!postInit && (
            <div className={styles.inputGroup}>
              <label className={styles.inputLabel} htmlFor="git-provider-select">
                Git Provider
              </label>
              <select
                id="git-provider-select"
                className={styles.input}
                value={gitProvider}
                onChange={(e) => {
                  setGitProvider(e.target.value as GitProvider);
                  setProviderTouched(true);
                }}
                disabled={isSubmitting}
                data-testid="git-provider-select"
              >
                {GIT_PROVIDERS.map((provider) => (
                  <option key={provider} value={provider}>
                    {GIT_PROVIDER_LABELS[provider]}
                  </option>
                ))}
              </select>
              <span className={styles.inputHint}>
                Auto-selected from the repo URL where possible; change it if the
                detected provider is wrong.
              </span>
            </div>
          )}

          {/* Post-init Repositories home (Spec 2026-06-12 Task Group 4):
              the live workspace map with add / re-point / delete CRUD. */}
          {postInit && isEdit && project && (
            <div className={styles.inputGroup}>
              <span className={styles.inputLabel}>Repositories</span>
              {companyIdentifier ? (
                <RepoMapEditor
                  company={companyIdentifier}
                  project={projectIdentifier}
                  projectId={project.id}
                  onLoadFailed={(message) => setWorkspaceLoadError(message)}
                />
              ) : (
                <span className={styles.organisationWarning} data-testid="repo-editor-org-pending">
                  {organisationsLoading
                    ? 'Loading organisation...'
                    : 'Cannot edit repositories: the project has no resolvable organisation.'}
                </span>
              )}
            </div>
          )}

          {/* Workspace-drift fallback (2026-07-27): the stored init-success
              said "initialised" but the live workspace read failed — most
              commonly the workspace directory is gone (wiped host dir, a
              different machine). The pre-init form above is back in play:
              check the repo URL and Save to RE-INITIALISE (re-clone). */}
          {isEdit && workspaceLoadError !== null && (
            <div
              className={styles.errorMessage}
              data-testid="workspace-reinit-notice"
            >
              The implementation workspace for this project could not be read:{' '}
              {workspaceLoadError} — it may have been deleted or never created
              on this machine. Check the repository details above and click
              Save to re-initialise the workspace (the repos will be
              re-cloned).
            </div>
          )}

          {/* Project Hierarchy input - Spec 2026-01-10: Project Hierarchy Grouping */}
          <div className={styles.inputGroup}>
            <label className={styles.inputLabel} htmlFor="project-hierarchy-input">
              Product Hierarchy
            </label>
            <input
              id="project-hierarchy-input"
              type="text"
              className={styles.input}
              value={projectHierarchy}
              onChange={(e) => setProjectHierarchy(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="e.g., ClientA, Internal"
              disabled={isSubmitting || projectFieldsLocked}
              readOnly={projectFieldsLocked}
              list="project-hierarchies-datalist"
              data-testid="project-hierarchy-input"
            />
            <datalist id="project-hierarchies-datalist" data-testid="project-hierarchies-datalist">
              {hierarchySuggestions.map((hierarchy) => (
                <option key={hierarchy} value={hierarchy} />
              ))}
            </datalist>
            <span className={styles.inputHint}>
              Optional logical folder for grouping products in menus (e.g., ClientA, Internal).
            </span>
          </div>

          {/* Error message */}
          {error && (
            <div className={styles.errorMessage} data-testid="error-message">
              {error}
            </div>
          )}

          {/* Spec 2026-06-12: Workspace init failure detail (inline).
              The project is created either way -- init never blocks it. */}
          {initError && (
            <div className={styles.errorMessage} data-testid="init-error-message">
              {isEdit
                ? `Workspace setup failed: ${initError}`
                : `The product was created, but workspace setup failed: ${initError} — you can retry now or set up repositories later from the Implement screen.`}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <button
            className={styles.cancelButton}
            onClick={onClose}
            disabled={isSubmitting}
            data-testid="cancel-button"
          >
            {dismissLabel}
          </button>
          {!postInit && (
            <button
              className={styles.createButton}
              onClick={handleCreate}
              disabled={!isFormValid || isSubmitting}
              data-testid="create-button"
            >
              {primaryLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default CreateProjectModal;
