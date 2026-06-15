/**
 * ModelFileDialog Component
 *
 * Dialog for selecting or entering a model filename.
 * Used for "Open..." and "Save As..." operations with the backend.
 *
 * Features:
 * - Fetches and displays list of available files from backend
 * - Loading state with spinner
 * - Error handling with retry button
 * - "open" mode: Uses OrganisationGroupedProjectList with 2-level hierarchy
 * - "saveAs" mode: Four form fields (Organisation, Project Name, Parent Folder, Hierarchy)
 *                  + OrganisationGroupedProjectList for project selection
 * - Keyboard support (Enter/Escape)
 *
 * Spec: Fix Open Modal Hierarchy Grouping by Sourcing Projects
 * - "open" mode uses listProjects() API to get real projectHierarchy values
 *
 * Spec 2026-01-18: Organisations Iteration 3 - Update Project Open Modal
 * - "open" mode now uses OrganisationGroupedProjectList for 2-level grouping
 * - Fetches both projects and organisations in parallel with Promise.all
 * - Organisation names are resolved via a lookup map
 *
 * Spec 2026-01-18: Organisations Iteration 4 - Update Project Save As Modal
 * - "saveAs" mode now uses the same grouped list and four form fields
 * - Organisation Name autocomplete with datalist
 * - Project selection populates all form fields
 * - Save flow resolves organisation (existing or new) before calling onConfirm
 *
 * Spec 2026-01-26: Activate Project on Open
 * - "open" mode now passes OpenProjectResult with filename and projectId
 * - Enables TopBar to activate project before loading model
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { listProjects, ProjectDto } from '../../api/projectsApi';
import {
  listOrganisations,
  createOrganisation,
  OrganisationDto,
  OrganisationConflictError,
} from '../../api/organisationsApi';
import { OrganisationGroupedProjectList } from '../Project/OrganisationGroupedProjectList';
import styles from './ModelFileDialog.module.css';

/**
 * Dialog mode type
 * - 'open': Select an existing file from the list
 * - 'saveAs': Enter a new filename or select from list
 */
export type ModelFileDialogMode = 'open' | 'saveAs';

/**
 * Open project result with project ID for activation.
 * Spec 2026-01-26: Activate Project on Open
 *
 * When opening a project, the dialog returns both the filename and projectId
 * so that TopBar can activate the project before loading the model.
 */
export interface OpenProjectResult {
  filename: string;
  projectId: string;
}

/**
 * SaveAs result with all fields needed for saving
 * Spec 2026-01-18: Organisations Iteration 4
 */
export interface SaveAsResult {
  projectName: string;
  parentFolder: string;
  projectHierarchy?: string;
  organisationId: string;
}

/**
 * Type guard to check if a result is an OpenProjectResult.
 * Spec 2026-01-26: Activate Project on Open
 *
 * @param result - The result to check
 * @returns True if the result is an OpenProjectResult (has projectId field)
 */
export function isOpenProjectResult(
  result: OpenProjectResult | SaveAsResult
): result is OpenProjectResult {
  return 'projectId' in result && 'filename' in result;
}

/**
 * Props for ModelFileDialog component
 */
export interface ModelFileDialogProps {
  /** Dialog mode: 'open' or 'saveAs' */
  mode: ModelFileDialogMode;
  /** Whether the dialog is visible */
  isOpen: boolean;
  /** Callback when dialog is closed/cancelled */
  onClose: () => void;
  /**
   * Callback when confirmed.
   * Spec 2026-01-26: Activate Project on Open
   * - open mode: receives OpenProjectResult with filename and projectId
   * - saveAs mode: receives SaveAsResult object with all fields
   */
  onConfirm: (result: OpenProjectResult | SaveAsResult) => void;
  /** Optional current filename to pre-fill (for saveAs mode) */
  currentFilename?: string;
}

/**
 * ModelFileDialog Component
 *
 * Renders a modal dialog for file selection/input.
 */
export function ModelFileDialog({
  mode,
  isOpen,
  onClose,
  onConfirm,
  currentFilename,
}: ModelFileDialogProps) {
  // State for projects data (used in both modes now)
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  // State for organisations data (used in both modes now)
  const [organisations, setOrganisations] = useState<OrganisationDto[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // State for selection/input (both modes)
  const [selectedFilename, setSelectedFilename] = useState<string>('');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState<string>(''); // Project Name

  // Spec 2026-01-18: Organisations Iteration 4 - Additional state for saveAs mode
  const [organisationName, setOrganisationName] = useState<string>('');
  const [parentFolder, setParentFolder] = useState<string>('');
  const [projectHierarchy, setProjectHierarchy] = useState<string>('');
  const [organisationsLoading, setOrganisationsLoading] = useState(false);
  const [organisationsError, setOrganisationsError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Ref for input focus
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * Build organisation lookup map: id -> name
   * Spec 2026-01-18: Organisations Iteration 3 & 4
   */
  const organisationMap = useMemo((): Map<string, string> => {
    const map = new Map<string, string>();
    organisations.forEach((org) => {
      map.set(org.id, org.name);
    });
    return map;
  }, [organisations]);

  /**
   * Fetch data from backend - mode-aware
   *
   * Spec 2026-01-18: Organisations Iteration 4
   * - Both modes now fetch projects and organisations in parallel
   */
  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setOrganisationsLoading(true);
    setOrganisationsError(null);

    try {
      // Both modes now use projects and organisations
      const [projectList, orgList] = await Promise.all([
        listProjects(),
        listOrganisations().catch((err) => {
          // Non-blocking error for organisations
          console.warn('Failed to load organisations:', err);
          setOrganisationsError(
            'Failed to load organisations. You can still enter a new organisation name.'
          );
          return [] as OrganisationDto[];
        }),
      ]);
      setProjects(projectList);
      setOrganisations(orgList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setIsLoading(false);
      setOrganisationsLoading(false);
    }
  }, []);

  /**
   * Effect: Fetch data and reset state when dialog opens
   *
   * Spec 2026-01-18: Organisations Iteration 4 - Reset all form fields
   */
  useEffect(() => {
    if (isOpen) {
      loadData();
      // Reset selection state
      setSelectedFilename('');
      setSelectedProjectId(null);
      // Reset saveAs form fields
      setOrganisationName('');
      setParentFolder('');
      setProjectHierarchy('');
      setOrganisationsLoading(false);
      setOrganisationsError(null);
      setIsSubmitting(false);
      setSubmitError(null);
      // Pre-fill input for saveAs mode
      if (mode === 'saveAs' && currentFilename) {
        setInputValue(currentFilename);
      } else {
        setInputValue('');
      }
    }
  }, [isOpen, loadData, mode, currentFilename]);

  /**
   * Effect: Focus input when dialog opens in saveAs mode
   */
  useEffect(() => {
    if (isOpen && mode === 'saveAs' && inputRef.current) {
      // Small delay to ensure modal is rendered
      const timeoutId = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [isOpen, mode]);

  // Spec 2026-01-18: Organisations Iteration 4 - Form validation for saveAs mode
  const isFormValid = useMemo(() => {
    if (mode !== 'saveAs') {
      return !!selectedFilename;
    }
    return (
      organisationName.trim().length > 0 &&
      inputValue.trim().length > 0 &&
      parentFolder.trim().length > 0
    );
  }, [mode, organisationName, inputValue, parentFolder, selectedFilename]);

  /**
   * Handle Save click with organisation resolution
   *
   * Spec 2026-01-18: Organisations Iteration 4
   * Spec 2026-01-26: Activate Project on Open
   * - Open mode now passes OpenProjectResult with filename and projectId
   */
  const handleSaveClick = useCallback(async () => {
    if (!isFormValid || isSubmitting) return;

    if (mode === 'open') {
      // Spec 2026-01-26: Open mode - pass OpenProjectResult with filename and projectId
      // selectedProjectId is guaranteed to be set when isFormValid is true in open mode
      onConfirm({
        filename: selectedFilename,
        projectId: selectedProjectId!,
      } as OpenProjectResult);
      return;
    }

    // SaveAs mode: resolve organisation and pass all fields
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const trimmedOrgName = organisationName.trim();
      const trimmedProjectName = inputValue.trim();
      const trimmedFolder = parentFolder.trim();
      const trimmedHierarchy = projectHierarchy.trim() || undefined;

      // Step 1: Resolve organisation ID
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
            // Re-throw other errors
            throw orgError;
          }
        }
      }

      // Step 2: Call onConfirm with all fields
      const result: SaveAsResult = {
        projectName: trimmedProjectName,
        parentFolder: trimmedFolder,
        projectHierarchy: trimmedHierarchy,
        organisationId,
      };

      onConfirm(result);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to save project';
      setSubmitError(errorMessage);
      setIsSubmitting(false);
    }
  }, [
    isFormValid,
    isSubmitting,
    mode,
    selectedFilename,
    selectedProjectId,
    organisationName,
    inputValue,
    parentFolder,
    projectHierarchy,
    organisations,
    onConfirm,
  ]);

  /**
   * Effect: Handle keyboard events
   */
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!isSubmitting) {
          onClose();
        }
      } else if (event.key === 'Enter') {
        if (isFormValid && !isSubmitting) {
          handleSaveClick();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, isFormValid, isSubmitting, handleSaveClick]);

  // Don't render if not open
  if (!isOpen) {
    return null;
  }

  /**
   * Handle project click from OrganisationGroupedProjectList
   *
   * Spec 2026-01-18: Organisations Iteration 4
   * In saveAs mode, populates all form fields from the selected project.
   *
   * Spec 2026-01-26: Activate Project on Open
   * In open mode, selectedProjectId is now used to pass to onConfirm.
   */
  const handleProjectClick = (projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    if (project) {
      setSelectedProjectId(projectId);
      setSelectedFilename(project.name);

      if (mode === 'saveAs') {
        // Populate all form fields from selected project
        const orgName = project.organisationId
          ? organisationMap.get(project.organisationId) || ''
          : '';
        setOrganisationName(orgName);
        setInputValue(project.name);
        setParentFolder(project.projectParentFolder);
        setProjectHierarchy(project.projectHierarchy || '');
      }
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

  /**
   * Format date for display
   */
  const formatDate = (dateString?: string): string => {
    if (!dateString) return '';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString();
    } catch {
      return '';
    }
  };

  // Dialog title based on mode
  const title = mode === 'open' ? 'Open Model' : 'Save Model As';

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
          {/* SaveAs mode form fields */}
          {mode === 'saveAs' && (
            <>
              {/* Organisation Name input with autocomplete */}
              <div className={styles.inputGroup}>
                <label className={styles.inputLabel} htmlFor="organisation-name-input">
                  Organisation Name
                </label>
                <input
                  ref={inputRef}
                  id="organisation-name-input"
                  type="text"
                  className={styles.input}
                  value={organisationName}
                  onChange={(e) => setOrganisationName(e.target.value)}
                  placeholder="Select or enter organisation name..."
                  disabled={isSubmitting}
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
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="Enter product name..."
                  disabled={isSubmitting}
                  data-testid="project-name-input"
                />
              </div>

              {/* Parent Folder input */}
              <div className={styles.inputGroup}>
                <label className={styles.inputLabel} htmlFor="parent-folder-input">
                  Parent Folder
                </label>
                <input
                  id="parent-folder-input"
                  type="text"
                  className={styles.input}
                  value={parentFolder}
                  onChange={(e) => setParentFolder(e.target.value)}
                  placeholder="Enter parent folder path..."
                  disabled={isSubmitting}
                  data-testid="parent-folder-input"
                />
                <span className={styles.inputHint}>
                  Path to the product folder (e.g., C:\Projects\MyProject)
                </span>
              </div>

              {/* Project Hierarchy input */}
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
                  placeholder="e.g., ClientA, Internal"
                  disabled={isSubmitting}
                  data-testid="project-hierarchy-input"
                />
                <span className={styles.inputHint}>
                  Optional logical folder for grouping products in menus.
                </span>
              </div>

              {/* Error message */}
              {submitError && (
                <div className={styles.formErrorMessage} data-testid="error-message">
                  {submitError}
                </div>
              )}
            </>
          )}

          {/* File list section */}
          <div className={styles.fileListSection}>
            <div className={styles.fileListLabel}>
              {mode === 'open' ? 'Available Files:' : 'Existing Projects:'}
            </div>

            {/* Loading state */}
            {isLoading && (
              <div className={styles.loadingContainer}>
                <div className={styles.spinner}></div>
                <span>Loading {mode === 'open' ? 'files' : 'projects'}...</span>
              </div>
            )}

            {/* Error state */}
            {error && !isLoading && (
              <div className={styles.errorContainer}>
                <div className={styles.errorMessage}>{error}</div>
                <button className={styles.retryButton} onClick={loadData}>
                  Retry
                </button>
              </div>
            )}

            {/* Project list - OrganisationGroupedProjectList for both modes */}
            {!isLoading && !error && (
              <OrganisationGroupedProjectList
                projects={projects}
                organisationMap={organisationMap}
                selectedProjectId={selectedProjectId}
                onProjectClick={handleProjectClick}
                formatDate={formatDate}
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <button
            className={styles.cancelButton}
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            className={mode === 'saveAs' ? styles.saveButton : styles.okButton}
            onClick={handleSaveClick}
            disabled={!isFormValid || isSubmitting}
            data-testid={mode === 'saveAs' ? 'save-button' : 'ok-button'}
          >
            {mode === 'saveAs' ? (isSubmitting ? 'Saving...' : 'Save') : 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ModelFileDialog;
