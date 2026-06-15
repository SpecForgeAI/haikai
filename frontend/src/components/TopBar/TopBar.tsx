/**
 * TopBar Component
 *
 * Spec 2026-01-06: Frontend Project Snapshot Export/Import
 * Updated to use project snapshot endpoints for JSON export/import instead of
 * legacy architecture-only JSON export/import.
 *
 * Spec 2026-01-07: Fix Project Snapshot Import Parent Folder and Auto-Open
 * Task Group 3: Updated handleImportSuccess to accept result and setActive parameters
 * - Uses result.project.name (fresh) instead of activeProject?.name (stale closure)
 * - Conditionally loads model only when setActive is true
 *
 * Spec 2026-01-10: Fix Roadmap Tab Buttons Incorrectly Disabled When a Project is Open
 * Task Group 1: Updated handleOpenFromBackend to call refreshActiveProject after model load
 * - Ensures ProjectContext.activeProject is updated when opening a model from backend
 * - Enables Roadmap buttons to reflect correct project state after open
 *
 * Spec 2026-01-10: Project Menu + Delete Project
 * - Renamed "File" menu to "Project" menu
 * - Updated data-testid from "file-menu-trigger" to "project-menu-trigger"
 * - Added DeleteProjectModal integration
 *
 * Spec 2026-01-11: Add Project Save Menu Item
 * - Added handleSave function for immediate save without prompt
 * - Added isSaving state to prevent duplicate save requests
 * - Pass onSave and saveDisabled props to FileMenu
 *
 * Spec 2026-01-11: Redesign Import as XLSX
 * - Added importXlsxDisabled prop (now always false per Spec 2026-01-19)
 * - (ImportModeModal removed in TG6 of Spec 2026-03-05)
 *
 * Spec 2026-01-11: Project Menu Disable When No Active Project
 * - Added saveAsDisabled, importJsonDisabled props
 * - saveAsDisabled computed based on !state.loadedFileName (no active project)
 * - importJsonDisabled now always false (per Spec 2026-01-19)
 *
 * Spec 2026-01-19: UI Route Gating for Startup Feature Toggles
 * Task Group 1: TopBar Navigation Gating (includeDelivery)
 * - Added useIncludeDelivery hook import from AppConfigContext
 * - Conditionally render Product & Delivery button based on includeDelivery toggle
 * - Button is completely absent from DOM when includeDelivery=false (not hidden via CSS)
 *
 * Spec 2026-01-19: Export Project Name Prompt
 * Task Group 3: TopBar Export Flow Integration
 * - Added ExportProjectNameModal integration
 * - Export JSON/XLSX prompts for project name when loadedFileName is unset
 * - Dispatches SET_PROJECT_NAME action to persist name after modal confirmation
 * - Changed exportJsonDisabled and exportXlsxDisabled to always be false
 *   (modal handles the case where project name is not set)
 *
 * Spec 2026-01-19: Project Menu Import/Export Always Enabled
 * - Changed importXlsxDisabled and importJsonDisabled to always be false
 * - Import items are always clickable regardless of whether a project is loaded
 * - Users can import files immediately on fresh app startup
 *
 * Spec 2026-01-22: File Mode Blank Start UX
 * Task Group 4: Remove Export Guards
 * - REMOVED toast guards from handleExportJsonClick and handleExportXlsxClick
 * - Export now proceeds to call API which returns valid (possibly blank) snapshot
 * - Backend auto-initializes blank project, so export always works
 *
 * Spec 2026-01-22: Explicit Project Session API
 * Task Group 5: Import/Export Flow Routing
 * - Updated executeJsonExport to route by mode (DB vs session)
 * - Updated import flow to use importToSession in no-DB mode
 *
 * Spec 2026-01-22: File Mode JSON Export/Import Fix
 * Task Group 1: Fix File Mode JSON Export
 * - Added buildLocalSnapshot function to create snapshot from current UI state
 * - Updated executeJsonExport to use buildLocalSnapshot in File Mode
 *
 * Spec 2026-01-26: Activate Project on Open
 * - Updated handleOpenFromBackend to implement activate-first flow
 * - In DB mode: calls activateProject before loadModelByFilename
 * - In File Mode: constructs minimal ProjectDto and sets state directly
 * - Updates ProjectContext directly from POST response (no extra GET)
 *
 * Spec 2026-01-31: Project-level Standards Generation
 * Task Group 4: FileMenu and TopBar Integration
 * - Added GenerateProjectStandardsModal import and state
 * - Added handleGenerateStandards handler
 * - Added generateStandardsDisabled computed property
 * - Pass onGenerateStandards and generateStandardsDisabled to FileMenu
 *
 * Spec 2026-02-01: Disable Generate Standards When No Active Project
 * - Updated generateStandardsDisabled computation to include !state.loadedFileName check
 * - Matches the existing disable logic applied to Save and Save As
 *
 * Spec 2026-02-17: Dashboard Increment 1
 * - Extended handleViewChange parameter type to include 'dashboard'
 * - Added Dashboard button as FIRST item in .viewToggle nav (always visible)
 *
 * Spec 2026-03-04: What's Next v1-B -- Modal Launch
 * Task Group 5: TopBar Provider Wiring
 * - Imported ModalActionProvider from ModalActionContext
 * - Wrapped children with ModalActionProvider (nested inside ImportActionsProvider)
 * - Passes handleGenerateStandards as openGenerateStandardsModal prop
 *
 * Spec 2026-03-05: Import Product Snapshot Redesign
 * Task Group 4: Import Decision Modal (Save-and-Replace vs. Merge)
 * - Replaced ImportProjectSnapshotModal with ImportDecisionModal
 * - Refactored handleFileChange to use shared validateSnapshotSchema
 * - Added handleSaveAndReplace for Flow B Option 1 (JSON only)
 * - Added ImportDecisionModal state: isImportDecisionModalOpen, pendingImportSnapshot, pendingImportSource
 * - Removed old ImportProjectSnapshotModal state and JSX
 *
 * Task Group 6: XLSX Import Redesign (Replace ImportModeModal with Cherry-Pick)
 * - Removed ImportModeModal and ImportSummaryModal references
 * - Removed hasExistingMetaModelData, executeXlsxImport, handleImportModeConfirm, handleImportModeClose
 * - Removed isImportModeModalOpen, pendingXlsxFile, importSummaryOpen, importResult state
 * - Refactored handleExcelFileChange to parse XLSX and open ImportDecisionModal (auto-skips to merge for XLSX)
 * - Wired CherryPickMergeModal for both JSON and XLSX merge flows
 * - Updated handleMergeSelected to extract CherryPickData and open CherryPickMergeModal
 * - Added handleMergeComplete callback for dispatching MERGE_IMPORT after cherry-pick
 *
 * Task Group 7: Cleanup and Test Review
 * - Removed unused handleImportSuccess legacy callback (no longer referenced)
 * - Removed unused imports: ImportResult, ProjectSnapshotImportResultDto,
 *   ProjectSnapshotImportRequestDto, exportSessionSnapshot
 */

import React, { useRef, useState, ReactNode } from 'react';
// Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
// Routing hooks replace the removed SET_VIEW dispatch path.
import { useNavigate, useLocation } from 'react-router-dom';
import {
  useArchitecture,
  useArchitectureDispatch,
  useActiveArchitectureId as useActiveArchitectureIdLocal,
} from '../../contexts/ArchitectureContext';
// Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
// useCurrentView replaces state.currentView for active-style derivation on
// the view-toggle buttons.
import { useCurrentView } from '../../hooks/useCurrentView';
// Spec 2026-01-19: Import useIncludeDelivery hook for navigation gating
// Spec 2026-01-22: Import useIncludeDatabase hook for File Mode indicator
import { useIncludeDelivery, useIncludeDatabase } from '../../contexts/AppConfigContext';
// Spec 2026-01-22: Import ImportActionsProvider for cross-component import triggering
import { ImportActionsProvider } from '../../contexts/ImportActionsContext';
// Spec 2026-03-04: Import ModalActionProvider for cross-component modal triggering
import { ModalActionProvider } from '../../contexts/ModalActionContext';
import { sanitizeFilename, triggerDownload } from '../../utils/fileOperations';
// Spec 2026-03-05 TG7: Removed unused ImportResult (no longer needed after handleImportSuccess removal)
import { exportMetaModelToExcel, importMetaModelFromExcel } from '../../utils/excelOperations';
import { loadModelByFilename } from '../../api/modelApi';
// Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
// The previous inline listArchitectures call in handleOpenFromBackend is
// now gone in DB mode -- after setActiveProject navigates to
// /projects/<id>, <ProjectLayout> redirects to the canonical
// /projects/<id>/architectures/<archId>/dashboard URL, and <AppShell>'s
// auto-load effect issues the model-load call once both ids are present.
// In File mode we still call loadModelByFilename inline because there is
// no architecture-scoped URL or auto-load effect for that path.
// Spec 2026-01-22: Import both DB and session snapshot APIs
// Spec 2026-03-05 TG7: Removed ProjectSnapshotImportResultDto, ProjectSnapshotImportRequestDto (unused after handleImportSuccess removal)
import { exportActiveProjectSnapshot, exportProjectById, importProjectSnapshot, ProjectSnapshotDto } from '../../api/projectSnapshotApi';
// Spec 2026-03-05 TG7: Removed exportSessionSnapshot (unused)
import { importToSession } from '../../api/projectSessionApi';
// Spec 2026-01-26: Import activateProject and ProjectDto for activate-first flow
import { activateProject, deactivateAllProjects, ProjectDto } from '../../api/projectsApi';
import { ErrorModal } from '../common/Modal';
// Spec 2026-01-26: Import OpenProjectResult type and type guard from ModelFileDialog
import { ModelFileDialog, OpenProjectResult, SaveAsResult, isOpenProjectResult } from '../file/ModelFileDialog';
import { FileMenu } from './FileMenu';
// Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 3
// New pill/chip + dropdown selector mounted next to the project name in the
// top bar. Reuses ArchitectureContext.architectures + setActiveArchitecture
// added in Task Group 2.
import { ArchitectureSelector } from './ArchitectureSelector';
// Spec 2026-01-05: Import CreateProjectModal
import { CreateProjectModal } from '../Project/CreateProjectModal';
// Spec 2026-01-10: Import DeleteProjectModal
import { DeleteProjectModal } from '../Project/DeleteProjectModal';
// Spec 2026-01-31: Import GenerateProjectStandardsModal
import { GenerateProjectStandardsModal } from '../Project/GenerateProjectStandardsModal';
// Spec 2026-03-05: Import ImportDecisionModal for new import decision flow
import { ImportDecisionModal } from '../Import/ImportDecisionModal';
// Spec 2026-03-05 TG6: Import CherryPickMergeModal for cherry-pick merge flow
import { CherryPickMergeModal } from '../Import/CherryPickMergeModal';
// Spec 2026-01-19: Import ExportProjectNameModal for export project name prompt
import { ExportProjectNameModal } from '../Export/ExportProjectNameModal';
// Spec 2026-05-08: Import InfrastructureTerraformExportModal for Terraform export
import { InfrastructureTerraformExportModal } from '../Export/InfrastructureTerraformExportModal';
// Spec 2026-05-08: Import InfrastructureTerraformImportModal for Terraform import
import { InfrastructureTerraformImportModal } from '../Import/InfrastructureTerraformImportModal';
import { ValidationError } from '../../types/config';
// Spec 2026-01-05: Import saveModelToBackend utility for reusable save logic
import { saveModelToBackend } from '../../utils/saveUtils';
// Spec 2026-03-05: Import shared validation and cherry-pick utilities
import { validateSnapshotSchema, MAX_SNAPSHOT_FILE_SIZE, extractCherryPickData, applyMergeToModel, applyXlsxImportToModel } from '../../utils/importMergeUtils';
import type { CherryPickData, MergeableData } from '../../utils/importMergeUtils';
// Spec 2026-01-06: Import ProjectContext hook for state refresh
// Spec 2026-01-10: Added useProject and useClearActiveProject for delete project handling
// Spec 2026-01-26: Added useSetActiveProject for activate-first flow
import { useProject, useRefreshActiveProject, useClearActiveProject, useSetActiveProject } from '../../contexts/ProjectContext';
// Spec 2026-04-20: Tech Hints LLM Resolution — gate Save on pending/conflict resolutions
import {
  pendingResolutionsStore,
  usePendingCount,
  useHasConflict,
} from '../../stores/pendingResolutionsStore';
import styles from './TopBar.module.css';

/**
 * Type for pending export operation
 * Spec 2026-01-19: Export Project Name Prompt
 */
type PendingExportType = 'json' | 'xlsx' | null;

/**
 * Props for TopBar component
 * Spec 2026-01-22: Added optional children prop for ImportActionsProvider wrapping
 */
interface TopBarProps {
  /** Optional children to wrap with ImportActionsProvider */
  children?: ReactNode;
}

export function TopBar({ children }: TopBarProps) {
  const state = useArchitecture();
  const dispatch = useArchitectureDispatch();
  // Spec 2026-01-19: Get includeDelivery toggle for navigation gating
  const includeDelivery = useIncludeDelivery();
  // Spec 2026-01-22: Get includeDatabase toggle for File Mode indicator
  const includeDatabase = useIncludeDatabase();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);
  const fileButtonRef = useRef<HTMLButtonElement>(null);
  const [errorModalOpen, setErrorModalOpen] = useState(false);
  const [errorMessages, setErrorMessages] = useState<string[]>([]);
  const [fileMenuVisible, setFileMenuVisible] = useState(false);
  const [fileMenuPosition, setFileMenuPosition] = useState({ x: 0, y: 0 });

  // Backend file dialog state
  const [isOpenDialogVisible, setOpenDialogVisible] = useState(false);
  const [isSaveAsDialogVisible, setSaveAsDialogVisible] = useState(false);

  // Spec 2026-01-05: Create Project modal state
  const [isCreateProjectModalOpen, setCreateProjectModalOpen] = useState(false);

  // Spec 2026-03-05: Import Decision Modal state (replaces ImportProjectSnapshotModal)
  const [isImportDecisionModalOpen, setImportDecisionModalOpen] = useState(false);
  const [pendingImportSnapshot, setPendingImportSnapshot] = useState<ProjectSnapshotDto | null>(null);
  const [pendingImportSource, setPendingImportSource] = useState<'json' | 'xlsx'>('json');

  // Spec 2026-01-10: Delete Project modal state
  const [isDeleteProjectModalOpen, setDeleteProjectModalOpen] = useState(false);

  // Spec 2026-01-31: Generate Project Standards modal state
  const [isGenerateStandardsModalOpen, setGenerateStandardsModalOpen] = useState(false);

  // Spec 2026-03-05 TG6: CherryPickMergeModal state
  const [isCherryPickModalOpen, setCherryPickModalOpen] = useState(false);
  const [pendingCherryPickData, setPendingCherryPickData] = useState<CherryPickData | null>(null);

  // Spec 2026-01-19: Export Project Name Modal state
  const [isExportProjectNameModalOpen, setExportProjectNameModalOpen] = useState(false);
  const [pendingExportType, setPendingExportType] = useState<PendingExportType>(null);

  // Spec 2026-05-08: Infrastructure Terraform Export Modal state
  const [isInfrastructureTerraformModalOpen, setInfrastructureTerraformModalOpen] = useState(false);

  // Spec 2026-05-08: Infrastructure Terraform Import Modal state
  const [isInfrastructureTerraformImportModalOpen, setInfrastructureTerraformImportModalOpen] = useState(false);

  // Notification state for success messages
  const [notification, setNotification] = useState<string | null>(null);

  // Validation warning state for save gate
  const [validationWarnings, setValidationWarnings] = useState<ValidationError[]>([]);
  const [validationWarningModalOpen, setValidationWarningModalOpen] = useState(false);

  // Spec 2026-01-11: Saving state to prevent duplicate save requests
  const [isSaving, setIsSaving] = useState(false);

  // Spec 2026-01-06: Get project context hook for state refresh
  const refreshActiveProject = useRefreshActiveProject();
  // Spec 2026-01-10: Get active project and clear function for delete handling
  const activeProject = useProject();
  const clearActiveProject = useClearActiveProject();
  // Spec 2026-01-26: Get setActiveProject for activate-first flow
  const setActiveProject = useSetActiveProject();

  // Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
  //   - useNavigate drives the URL-based view-toggle buttons.
  //   - useCurrentView reports the trailing view segment so the active
  //     toggle button styling reflects the URL.
  //   - useActiveArchitectureIdLocal is URL-derived (Group 2); used by
  //     handleViewChange to compose the canonical URL.
  const navigate = useNavigate();
  const location = useLocation();
  const currentView = useCurrentView();
  const activeArchitectureId = useActiveArchitectureIdLocal();

  // The Target State sub-tab lives under the "Architecture & Design" surface at
  // /architectures/:a/architecture-design/...; its trailing URL segment is not
  // 'metamodel', so useCurrentView() reports the 'dashboard' fallback. Treat the
  // whole architecture-design route family as "Architecture & Design" for the
  // top-nav active styling so that tab (not Dashboard) is highlighted there.
  const architectureTabActive =
    currentView === 'metamodel' ||
    /\/architectures\/[^/]+\/architecture-design(?:\/|$)/.test(location.pathname);

  // Spec 2026-04-20: Tech Hints LLM Resolution — subscribe to pending-resolutions store.
  // `usePendingCount` ensures the component re-renders as resolves settle (e.g. so the
  // in-flight "Resolving N rows..." notification stays in sync if we ever expose count
  // in the menu). `useHasConflict` folds into `saveDisabled`.
  usePendingCount();
  const hasResolveConflict = useHasConflict();

  // Spec 2026-01-11: Compute saveDisabled - disabled when no project open or save in progress
  // Spec 2026-04-20: also disabled while any service row has a tech-hints repoCrossCheck conflict
  const saveDisabled = !state.loadedFileName || isSaving || hasResolveConflict;

  // Spec 2026-01-19: Project Menu Import/Export Always Enabled
  // Import XLSX is always enabled - users can import files on fresh app startup
  const importXlsxDisabled = false;

  // Spec 2026-01-11: Project Menu Disable When No Active Project
  // Save As is disabled when no project open
  const saveAsDisabled = !state.loadedFileName;

  // Spec 2026-01-19: Project Menu Import/Export Always Enabled
  // Import JSON is always enabled - ImportDecisionModal handles the flow
  const importJsonDisabled = false;

  // Spec 2026-01-19: Export Project Name Prompt
  // Export buttons are never disabled - modal handles the case where project name is not set
  const exportJsonDisabled = false;
  const exportXlsxDisabled = false;

  // Spec 2026-01-31: Generate Standards disabled when no active project with organisationId
  // Spec 2026-02-01: Added !state.loadedFileName check to match Save/Save As disabled behavior
  const generateStandardsDisabled = !state.loadedFileName || !activeProject || !activeProject.organisationId;

  // Close Project is disabled when no project is open
  const closeProjectDisabled = !activeProject;

  // Spec 2026-05-08: Export Infrastructure as Terraform disabled when:
  //   - no model loaded (state.loadedFileName falsy), OR
  //   - the model has no environments defined.
  const exportInfrastructureTerraformDisabled =
    !state.loadedFileName ||
    !activeProject ||
    !activeArchitectureId ||
    !state.model ||
    !state.model.metaModel ||
    !state.model.metaModel.entities ||
    !state.model.metaModel.entities.environments ||
    state.model.metaModel.entities.environments.length === 0;

  // Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
  // View selection is URL-driven now. handleViewChange navigates to the
  // canonical architecture-scoped URL; the active-button styling is read
  // from useCurrentView (also URL-derived). The buttons no-op gracefully
  // when no project / architecture is active (e.g. on the bare landing
  // page in File mode); this matches the previous behaviour where the
  // dispatch had no visible effect because no view component was mounted
  // to observe state.currentView.
  const handleViewChange = (view: 'product' | 'metamodel' | 'diagrams' | 'dashboard') => {
    if (!activeProject) return;
    if (!activeArchitectureId) return;
    navigate(
      `/projects/${activeProject.id}/architectures/${activeArchitectureId}/${view}`
    );
  };

  const handleFileButtonClick = () => {
    if (fileButtonRef.current) {
      const rect = fileButtonRef.current.getBoundingClientRect();
      setFileMenuPosition({ x: rect.left, y: rect.bottom + 2 });
      setFileMenuVisible(true);
    }
  };

  const handleFileMenuClose = () => {
    setFileMenuVisible(false);
  };

  // =========================================================================
  // Spec 2026-01-05: Create Project handler
  // =========================================================================

  const handleCreateProject = () => {
    setCreateProjectModalOpen(true);
  };

  // =========================================================================
  // Backend handlers (Open... and Save As...)
  // =========================================================================

  const handleOpenBackend = () => {
    setOpenDialogVisible(true);
  };

  const handleSaveAsBackend = () => {
    setSaveAsDialogVisible(true);
  };

  /**
   * Handle opening a model from the backend.
   *
   * Spec 2026-01-26: Activate Project on Open
   * - Implements activation-first flow: activate project BEFORE loading model
   * - Uses project ID from dialog selection (not filename resolution)
   * - Updates ProjectContext directly from POST response
   * - Handles File Mode by setting state directly (no backend call)
   *
   * Flow:
   * 1. If DB mode: POST /api/projects/{id}/activate
   * 2. Update ProjectContext with activated project
   * 3. Load model via loadModelByFilename
   * 4. Dispatch LOAD_MODEL to ArchitectureContext
   *
   * Error Handling:
   * - Activation failure: show error, do NOT proceed to model load
   * - Model load failure: show error (project is now active)
   */
  const handleOpenFromBackend = async (result: OpenProjectResult | SaveAsResult) => {
    // Spec 2026-01-26: Type guard for open mode result
    if (!isOpenProjectResult(result)) {
      // This shouldn't happen for open mode, but handle gracefully
      setErrorMessages(['Invalid open result: missing project ID']);
      setErrorModalOpen(true);
      return;
    }

    const { filename, projectId } = result;

    try {
      // Step 1: Activate project (DB mode) or set state directly (File mode)
      if (includeDatabase) {
        // DB mode: Call activation endpoint FIRST
        const activatedProject = await activateProject(projectId);
        // Update ProjectContext directly from response (no extra GET needed)
        setActiveProject(activatedProject);
      } else {
        // File Mode: Create a minimal ProjectDto and set directly
        // In File Mode, we don't have full project data, so construct it from available info
        const fileProject: ProjectDto = {
          id: projectId,
          name: filename,
          projectParentFolder: '', // Will be set from model if available
          projectHierarchy: null,
          organisationId: null,
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setActiveProject(fileProject);
      }

      // Step 2: Load the model (now that project is active).
      //
      // Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
      //   In DB mode the model load happens automatically inside <AppShell>
      //   once setActiveProject -> useNavigate -> <ProjectLayout> redirect
      //   resolves the architecture id and the architecture-scoped URL is
      //   active. The inline listArchitectures + loadModelByProjectId
      //   calls are gone. In File mode there is no auto-load effect, so
      //   we still load from the filename here.
      if (!includeDatabase) {
        const model = await loadModelByFilename(filename);
        dispatch({ type: 'LOAD_MODEL', payload: model, fileName: filename });
      }

      // Step 3: Close dialog on success
      setOpenDialogVisible(false);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to open project';
      setErrorMessages([errorMessage]);
      setErrorModalOpen(true);
      // Note: Do NOT close dialog on error - let user retry or cancel
    }
  };

  /**
   * Spec 2026-01-05: Refactored to use saveModelToBackend utility.
   * Handles the result to show notifications/modals while preserving existing UI behavior.
   *
   * Spec 2026-01-26: Updated to accept SaveAsResult from ModelFileDialog
   */
  const handleSaveToBackend = async (result: OpenProjectResult | SaveAsResult) => {
    // SaveAs mode always receives SaveAsResult
    if (isOpenProjectResult(result)) {
      // This shouldn't happen for saveAs mode
      setErrorMessages(['Invalid save result: expected SaveAsResult']);
      setErrorModalOpen(true);
      return;
    }

    // Extract filename from SaveAsResult
    const filename = result.projectName;

    // Spec 2026-05-11: architecture-scoped save requires active project + architecture
    if (!activeProject?.id || !activeArchitectureId) {
      setErrorMessages(['No active project or architecture. Open a project first.']);
      setErrorModalOpen(true);
      return;
    }

    const saveResult = await saveModelToBackend(state.model, filename, activeProject.id, activeArchitectureId, dispatch);

    if (saveResult.success) {
      // Close dialog and show success notification
      setSaveAsDialogVisible(false);
      setNotification(`Model saved as "${filename}"`);
      setTimeout(() => setNotification(null), 3000);
    } else if (saveResult.validationErrors && saveResult.validationErrors.length > 0) {
      // Show validation warning modal
      setValidationWarnings(saveResult.validationErrors);
      setValidationWarningModalOpen(true);
    } else if (saveResult.error) {
      // Show error modal for API errors
      setErrorMessages([saveResult.error]);
      setErrorModalOpen(true);
    }
  };

  // =========================================================================
  // Spec 2026-01-11: Save handler (immediate save without prompt)
  // =========================================================================

  /**
   * Handle Save action - immediately saves the current project without prompting.
   *
   * Guards:
   * - Returns early if no loadedFileName (should not happen if UI is correct)
   * - Returns early if already saving (prevents double-click)
   *
   * Uses saveModelToBackend utility with the current loadedFileName.
   * Shows "Saved" notification on success, or error/validation modal on failure.
   */
  const handleSave = async () => {
    // Guard: Return early if no filename (should not happen if button is disabled correctly)
    if (!state.loadedFileName) {
      return;
    }

    // Guard: Return early if already saving (prevent double-click)
    if (isSaving) {
      return;
    }

    // Spec 2026-04-20: Tech Hints LLM Resolution — block save if any service row has
    // an unresolved repoCrossCheck conflict. User must edit core_tech or repo fields
    // to clear the conflict before discovery can run.
    if (pendingResolutionsStore.hasConflict()) {
      setErrorMessages(['Resolve tech hints conflicts before saving.']);
      setErrorModalOpen(true);
      return;
    }

    setIsSaving(true);

    try {
      // Spec 2026-04-20: await any in-flight tech-hints resolve promises so the
      // whole-model PUT carries the latest resolved columns for every dirty row.
      // Individual row rejections fall through to the toast path (the row saves
      // with NULL resolved fields); overall Save proceeds for the remaining rows.
      const pendingPromises = pendingResolutionsStore.getPendingPromises();
      if (pendingPromises.length > 0) {
        setNotification(`Resolving ${pendingPromises.length} row${pendingPromises.length === 1 ? '' : 's'}...`);
        await Promise.allSettled(pendingPromises);
      }

      // Spec 2026-05-11: architecture-scoped save requires active project + architecture
      if (!activeProject?.id || !activeArchitectureId) {
        setErrorMessages(['No active project or architecture. Open a project first.']);
        setErrorModalOpen(true);
        return;
      }
      const result = await saveModelToBackend(state.model, state.loadedFileName, activeProject.id, activeArchitectureId, dispatch);

      if (result.success) {
        // Show simple "Saved" notification
        setNotification('Saved');
        setTimeout(() => setNotification(null), 3000);
      } else if (result.validationErrors && result.validationErrors.length > 0) {
        // Show validation warning modal
        setValidationWarnings(result.validationErrors);
        setValidationWarningModalOpen(true);
      } else if (result.error) {
        // Show error modal for API errors
        setErrorMessages([result.error]);
        setErrorModalOpen(true);
      }
    } finally {
      setIsSaving(false);
    }
  };

  // =========================================================================
  // Spec 2026-01-10: Delete Project handler
  // =========================================================================

  const handleDeleteProject = () => {
    setDeleteProjectModalOpen(true);
  };

  /**
   * Handle successful project deletion.
   *
   * Spec 2026-01-10: Project Menu + Delete Project
   * - If the deleted project was the active project, clear the context and reset the model
   * - Show success notification
   * - Refresh the active project state
   */
  const handleDeleteSuccess = async (deletedProjectId: string) => {
    // Check if the deleted project was the active project
    if (activeProject && activeProject.id === deletedProjectId) {
      // Clear the active project context
      clearActiveProject();
      // Reset the architecture model
      dispatch({ type: 'RESET_MODEL' });
      // Navigate to the landing page so the URL no longer matches an
      // architecture-scoped route (otherwise AppShell stays mounted with
      // an empty model after the project is gone).
      navigate('/', { replace: true });
    }

    // Show success notification
    setNotification('Project deleted successfully');
    setTimeout(() => setNotification(null), 3000);

    // Refresh active project state
    try {
      await refreshActiveProject();
    } catch (refreshErr) {
      console.warn('Failed to refresh active project after delete:', refreshErr);
    }
  };

  // =========================================================================
  // Spec 2026-01-31: Generate Project Standards handler
  // =========================================================================

  const handleGenerateStandards = () => {
    setGenerateStandardsModalOpen(true);
  };

  // =========================================================================
  // Close Project handler
  // =========================================================================

  const handleCloseProject = async () => {
    try {
      await deactivateAllProjects();
      clearActiveProject();
      dispatch({ type: 'RESET_MODEL' });
      // Navigate to the landing page so the URL no longer matches an
      // architecture-scoped route (otherwise AppShell stays mounted on
      // /projects/.../metamodel/application with an empty model).
      navigate('/', { replace: true });
    } catch (err) {
      console.error('Failed to close project:', err);
      setErrorMessages([err instanceof Error ? err.message : 'Failed to close project']);
      setErrorModalOpen(true);
    }
  };

  // =========================================================================
  // Spec 2026-01-06: JSON Snapshot Export/Import handlers
  // Spec 2026-01-19: Export Project Name Prompt integration
  // Spec 2026-01-22: File Mode Blank Start UX - Export always works
  // Spec 2026-01-22: Mode-aware export routing
  // Spec 2026-01-22: File Mode JSON Export/Import Fix - buildLocalSnapshot
  // Spec 2026-03-05: Import Decision Modal integration
  // =========================================================================

  /**
   * Build a ProjectSnapshotDto from current frontend state.
   * Used for File Mode export where backend doesn't have current UI edits.
   *
   * Spec 2026-01-22: File Mode JSON Export/Import Fix
   * Task Group 1: Fix File Mode JSON Export
   *
   * @param projectName - The project name to use in the snapshot
   * @returns A complete ProjectSnapshotDto built from current UI state
   */
  const buildLocalSnapshot = (projectName: string): ProjectSnapshotDto => {
    const now = new Date().toISOString();

    return {
      meta: {
        snapshot_version: 1,
        exported_at: now,
        export_kind: 'session',
      },
      project: activeProject ?? {
        id: crypto.randomUUID(),
        name: projectName,
        projectParentFolder: '',
        projectHierarchy: null,
        organisationId: null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      model: state.model, // Current ArchitectureContext model with user's edits
      work_items: [], // Empty in File Mode (no ProductContext sync needed)
      artifacts: [], // Empty in File Mode
    };
  };

  /**
   * Execute JSON export with the given project name.
   * This is the actual export logic, called either directly or after modal confirmation.
   *
   * Spec 2026-01-19: Extracted from handleExportJsonClick for reuse with modal flow.
   * Spec 2026-01-22: Routes to correct endpoint based on includeDatabase mode.
   * Spec 2026-01-22: File Mode JSON Export/Import Fix - uses buildLocalSnapshot in File Mode
   */
  const executeJsonExport = async (projectName: string) => {
    try {
      let snapshot: ProjectSnapshotDto | null;

      // Spec 2026-01-22: Route by mode
      if (includeDatabase) {
        // DB mode: prefer export by project ID (robust -- does not rely on is_active flag)
        // Fall back to active export endpoint if activeProject context is unavailable
        if (activeProject?.id) {
          snapshot = await exportProjectById(activeProject.id);
        } else {
          snapshot = await exportActiveProjectSnapshot();
        }

        if (snapshot === null) {
          // No active project - show error
          setErrorMessages(['No active project to export']);
          setErrorModalOpen(true);
          return;
        }
      } else {
        // File Mode: build snapshot locally from current ArchitectureContext state
        // This ensures exported JSON contains current UI edits, not stale backend data
        snapshot = buildLocalSnapshot(projectName);
      }

      // Generate filename from project name
      const sanitizedName = sanitizeFilename(projectName);
      const filename = `${sanitizedName}-snapshot.json`;

      // Trigger download
      const json = JSON.stringify(snapshot, null, 2);
      triggerDownload(json, filename);

    } catch (err) {
      setErrorMessages([err instanceof Error ? err.message : 'Failed to export project snapshot']);
      setErrorModalOpen(true);
    }
  };

  /**
   * Handle Export JSON click.
   *
   * Spec 2026-01-19: Export Project Name Prompt
   * - If loadedFileName is unset, shows ExportProjectNameModal
   * - If loadedFileName is set, proceeds directly with export
   *
   * Spec 2026-01-22: File Mode Blank Start UX
   * Task Group 4: Remove Export Guards
   * - REMOVED toast guard - backend now auto-initializes blank project
   * - Export proceeds to call API which returns valid (possibly blank) snapshot
   */
  const handleExportJsonClick = async () => {
    // Spec 2026-01-22: REMOVED toast guard
    // Backend auto-initializes blank "Untitled" project, so export always works

    if (!state.loadedFileName) {
      // Show modal to prompt for project name
      setPendingExportType('json');
      setExportProjectNameModalOpen(true);
      return;
    }

    // Proceed with export using existing project name
    await executeJsonExport(state.loadedFileName);
  };

  /**
   * Handle Import JSON click.
   * Opens file picker for .json files.
   */
  const handleImportJsonClick = () => {
    fileInputRef.current?.click();
  };

  /**
   * Handle file selection for JSON import.
   *
   * Spec 2026-03-05: Refactored to use shared validateSnapshotSchema
   * and open ImportDecisionModal instead of ImportProjectSnapshotModal.
   *
   * Validation checks:
   * 1. File size limit (50 MB)
   * 2. Valid JSON
   * 3. Required fields: project, project.name, meta, model
   */
  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      // Validate file size before reading
      if (file.size > MAX_SNAPSHOT_FILE_SIZE) {
        const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
        setErrorMessages([`File too large (${sizeMB} MB). Maximum allowed size is 50 MB.`]);
        setErrorModalOpen(true);
        event.target.value = '';
        return;
      }

      // Read file content
      const content = await readFileAsText(file);

      // Parse JSON
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        setErrorMessages(['Invalid JSON file: Failed to parse JSON']);
        setErrorModalOpen(true);
        event.target.value = '';
        return;
      }

      // Spec 2026-03-05: Use shared validateSnapshotSchema
      const validation = validateSnapshotSchema(parsed);
      if (!validation.valid || !validation.snapshot) {
        setErrorMessages(['Invalid snapshot file:', ...validation.errors]);
        setErrorModalOpen(true);
        event.target.value = '';
        return;
      }

      // Spec 2026-03-05: Open ImportDecisionModal instead of ImportProjectSnapshotModal
      setPendingImportSnapshot(validation.snapshot);
      setPendingImportSource('json');
      setImportDecisionModalOpen(true);

    } catch (err) {
      setErrorMessages([err instanceof Error ? err.message : 'Failed to read file']);
      setErrorModalOpen(true);
    }

    // Reset input to allow loading same file again
    event.target.value = '';
  };

  /**
   * Helper function to read file as text.
   */
  function readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        resolve(content);
      };
      reader.onerror = () => {
        reject(new Error('Failed to read file'));
      };
      reader.readAsText(file);
    });
  }

  // =========================================================================
  // Spec 2026-03-05: Save-and-Replace handler (Flow B Option 1, JSON only)
  // =========================================================================

  /**
   * Handle Save-and-Replace flow for JSON import.
   *
   * DB Mode:
   * 1. Save current project via saveModelToBackend
   * 2. If save fails (validation errors), abort and show error
   * 3. If save succeeds, import snapshot via importProjectSnapshot
   * 4. Dispatch LOAD_MODEL with imported model
   * 5. Refresh active project
   *
   * File Mode:
   * 1. Build local snapshot and trigger JSON download for current project
   * 2. Load imported snapshot into ArchitectureContext via LOAD_MODEL
   * 3. Call importToSession to persist in session
   */
  const handleSaveAndReplace = async () => {
    if (!pendingImportSnapshot) return;

    // Close the decision modal
    setImportDecisionModalOpen(false);

    const snapshot = pendingImportSnapshot;
    const projectName = snapshot.project?.name || 'Unknown Project';

    try {
      if (includeDatabase) {
        // DB Mode: Save current project first
        if (state.loadedFileName) {
          // Spec 2026-05-11: architecture-scoped save requires active project + architecture
          if (!activeProject?.id || !activeArchitectureId) {
            setErrorMessages(['No active project or architecture. Open a project first.']);
            setErrorModalOpen(true);
            return;
          }
          const saveResult = await saveModelToBackend(state.model, state.loadedFileName, activeProject.id, activeArchitectureId, dispatch);

          if (!saveResult.success) {
            // Save failed - abort import
            if (saveResult.validationErrors && saveResult.validationErrors.length > 0) {
              setValidationWarnings(saveResult.validationErrors);
              setValidationWarningModalOpen(true);
            } else if (saveResult.error) {
              setErrorMessages([saveResult.error]);
              setErrorModalOpen(true);
            }
            return;
          }
        }

        // Import the snapshot via backend
        const importResult = await importProjectSnapshot({
          snapshot,
          setActive: true,
          overwriteExistingProject: true,
        });

        // Dispatch LOAD_MODEL with imported model
        dispatch({
          type: 'LOAD_MODEL',
          payload: snapshot.model,
          fileName: importResult.project.name,
        });

        // Refresh active project
        await refreshActiveProject();

      } else {
        // File Mode: Download current project as JSON first
        if (state.loadedFileName) {
          const currentSnapshot = buildLocalSnapshot(state.loadedFileName);
          const sanitizedName = sanitizeFilename(state.loadedFileName);
          const filename = `${sanitizedName}-snapshot.json`;
          const json = JSON.stringify(currentSnapshot, null, 2);
          triggerDownload(json, filename);
        }

        // Load imported snapshot into ArchitectureContext
        dispatch({
          type: 'LOAD_MODEL',
          payload: snapshot.model,
          fileName: projectName,
        });

        // Persist to session
        await importToSession({
          snapshot,
          setActive: true,
          overwriteExistingProject: true,
        });

        // Refresh active project
        await refreshActiveProject();
      }

      // Show success notification
      setNotification('Project imported successfully');
      setTimeout(() => setNotification(null), 3000);

    } catch (err) {
      setErrorMessages([err instanceof Error ? err.message : 'Failed to import project']);
      setErrorModalOpen(true);
    }

    // Clear pending state
    setPendingImportSnapshot(null);
  };

  /**
   * Handle Merge selection from ImportDecisionModal.
   *
   * Spec 2026-03-05 TG6: Opens the CherryPickMergeModal.
   * - For JSON import: extracts CherryPickData from the pending snapshot
   * - For XLSX import: pendingCherryPickData is already populated by handleExcelFileChange
   */
  const handleMergeSelected = () => {
    // Close the decision modal
    setImportDecisionModalOpen(false);

    // If JSON import and no cherry-pick data yet, extract it from the snapshot
    if (pendingImportSnapshot && !pendingCherryPickData) {
      const cherryData = extractCherryPickData(pendingImportSnapshot);
      setPendingCherryPickData(cherryData);
    }

    // Open the cherry-pick merge modal
    setCherryPickModalOpen(true);
  };

  /**
   * Handle closing the Import Decision Modal.
   * Clears all pending import state.
   */
  const handleImportDecisionClose = () => {
    setImportDecisionModalOpen(false);
    setPendingImportSnapshot(null);
    setPendingImportSource('json');
    setPendingCherryPickData(null);
  };

  // =========================================================================
  // XLSX import/export handlers
  // Spec 2026-01-19: Export Project Name Prompt integration
  // Spec 2026-01-22: File Mode Blank Start UX - Export always works
  // Spec 2026-03-05 TG6: Refactored XLSX import to use cherry-pick merge flow
  // =========================================================================

  /**
   * Execute XLSX export with the given project name.
   * This is the actual export logic, called either directly or after modal confirmation.
   *
   * Spec 2026-01-19: Extracted from handleExportXlsxClick for reuse with modal flow.
   */
  const executeXlsxExport = (projectName: string) => {
    exportMetaModelToExcel(state.model, projectName);
  };

  /**
   * Handle Export XLSX click.
   *
   * Spec 2026-01-19: Export Project Name Prompt
   * - If loadedFileName is unset, shows ExportProjectNameModal
   * - If loadedFileName is set, proceeds directly with export
   *
   * Spec 2026-01-22: File Mode Blank Start UX
   * Task Group 4: Remove Export Guards
   * - REMOVED toast guard - backend now auto-initializes blank project
   * - Export proceeds directly (XLSX export uses in-memory model)
   */
  const handleExportXlsxClick = () => {
    // Spec 2026-01-22: REMOVED toast guard
    // Backend auto-initializes blank "Untitled" project, so export always works

    if (!state.loadedFileName) {
      // Show modal to prompt for project name
      setPendingExportType('xlsx');
      setExportProjectNameModalOpen(true);
      return;
    }

    // Proceed with export using existing project name
    executeXlsxExport(state.loadedFileName);
  };

  const handleImportXlsxClick = () => {
    excelInputRef.current?.click();
  };

  /**
   * Handle Excel file selection.
   *
   * Spec 2026-03-05 TG6: Refactored XLSX import flow.
   * - Parses XLSX via importMetaModelFromExcel ('overwrite' mode to update existing entities)
   * - Applies import directly via applyXlsxImportToModel (replaces by ID, appends new)
   * - Bypasses cherry-pick modal — XLSX import is a direct merge, not a selection flow
   */
  const handleExcelFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      // Parse XLSX using 'overwrite' mode so existing entities are updated with new field values
      const result = await importMetaModelFromExcel(file, state.model, 'overwrite');

      console.log('[XLSX Import] Parse result:', {
        success: result.success,
        worksheets: result.worksheetResults?.map(ws => ({ name: ws.worksheetName, imported: ws.rowsImported, updated: ws.rowsUpdated, skipped: ws.rowsSkipped, errors: ws.errors })),
        newEntityKeys: Object.keys(result.newEntities || {}),
        updatedEntityKeys: Object.keys(result.updatedEntities || {}),
        newRelKeys: Object.keys(result.newRelationships || {}),
        updatedRelKeys: Object.keys(result.updatedRelationships || {}),
        ignoredWorksheets: result.ignoredWorksheets,
      });

      // Log sample updated entity to verify field mapping
      for (const [type, items] of Object.entries(result.updatedEntities || {})) {
        if (items.length > 0) {
          console.log(`[XLSX Import] Updated ${type} sample:`, items[0]);
        }
      }

      if (!result.success) {
        const errorDetails = result.worksheetResults?.flatMap(ws => ws.errors.map(e => e.message)).join(', ') || 'Unknown error';
        setErrorMessages(['XLSX import failed: ' + errorDetails]);
        setErrorModalOpen(true);
        return;
      }

      // Build merged model directly — bypass cherry-pick modal for XLSX.
      // Updated entities replace existing ones by ID; new entities/relationships are appended.
      const mergedModel = applyXlsxImportToModel(state.model, result);

      if (includeDatabase) {
        // Spec 2026-05-11: architecture-scoped save requires active project + architecture
        if (!activeProject?.id || !activeArchitectureId) {
          setErrorMessages(['No active project or architecture. Open a project first.']);
          setErrorModalOpen(true);
          return;
        }
        try {
          const saveResult = await saveModelToBackend(mergedModel, state.loadedFileName || '', activeProject.id, activeArchitectureId, dispatch);
          if (!saveResult.success) {
            console.error('[XLSX Import] Save FAILED:', saveResult.validationErrors || saveResult.error);
          } else {
            console.log('[XLSX Import] Save succeeded');
          }
        } catch (err) {
          console.error('[XLSX Import] Save threw:', err);
        }
      } else {
        dispatch({ type: 'LOAD_MODEL', payload: mergedModel, fileName: state.loadedFileName || '' });
        console.log('[XLSX Import] Dispatched LOAD_MODEL (file mode)');
      }
    } catch (err) {
      setErrorMessages(['Failed to parse XLSX file: ' + (err instanceof Error ? err.message : String(err))]);
      setErrorModalOpen(true);
    }

    // Reset input to allow importing same file again
    event.target.value = '';
  };

  // =========================================================================
  // Spec 2026-03-05 TG6: CherryPickMergeModal merge complete handler
  // =========================================================================

  /**
   * Handle merge completion from CherryPickMergeModal.
   *
   * Dispatches MERGE_IMPORT with the resolved data, persists if in DB mode,
   * and shows a success notification with the merge summary.
   */
  const handleMergeComplete = async (resolvedData: MergeableData, summary: string) => {
    if (includeDatabase) {
      // DB mode: build merged model locally to avoid stale closure issue.
      // state.model is the pre-merge value from this render cycle's closure.
      // saveModelToBackend dispatches LOAD_MODEL with the prepared model,
      // so it will set the correct merged state.
      const mergedModel = applyMergeToModel(state.model, resolvedData);
      // Spec 2026-05-11: architecture-scoped save requires active project + architecture
      if (!activeProject?.id || !activeArchitectureId) {
        setErrorMessages(['No active project or architecture. Open a project first.']);
        setErrorModalOpen(true);
        return;
      }
      try {
        const saveResult = await saveModelToBackend(mergedModel, state.loadedFileName || '', activeProject.id, activeArchitectureId, dispatch);
        if (!saveResult.success) {
          console.error('Failed to save after merge:', saveResult.error || 'validation errors');
        }
      } catch (err) {
        console.error('Failed to save after merge:', err);
      }
    } else {
      // File mode: no save needed, just update in-memory state via reducer
      dispatch({ type: 'MERGE_IMPORT', payload: resolvedData });
    }

    // Auto-select the first imported diagram so it's visible immediately
    if (resolvedData.diagrams.length > 0) {
      dispatch({ type: 'SELECT_DIAGRAM', payload: resolvedData.diagrams[0].id });
    }

    // Close cherry-pick modal
    setCherryPickModalOpen(false);
    setPendingCherryPickData(null);
    setPendingImportSnapshot(null);

    // Show success notification
    setNotification(summary);
    setTimeout(() => setNotification(null), 5000);
  };

  // =========================================================================
  // Spec 2026-01-19: Export Project Name Modal handlers
  // =========================================================================

  /**
   * Handle Export Project Name Modal confirmation.
   * Called when user enters a project name and clicks Export.
   *
   * Spec 2026-01-19: Export Project Name Prompt
   * - Dispatches SET_PROJECT_NAME action to persist the name
   * - Executes the pending export (JSON or XLSX)
   * - Closes modal and resets pending export type
   */
  const handleExportProjectNameConfirm = async (projectName: string) => {
    // Dispatch SET_PROJECT_NAME to persist the name in state
    dispatch({ type: 'SET_PROJECT_NAME', fileName: projectName });

    // Execute the pending export
    if (pendingExportType === 'json') {
      await executeJsonExport(projectName);
    } else if (pendingExportType === 'xlsx') {
      executeXlsxExport(projectName);
    }

    // Close modal and reset state
    setExportProjectNameModalOpen(false);
    setPendingExportType(null);
  };

  /**
   * Handle Export Project Name Modal close/cancel.
   *
   * Spec 2026-01-19: Export Project Name Prompt
   * - Closes modal without any state changes
   * - Resets pending export type
   */
  const handleExportProjectNameCancel = () => {
    setExportProjectNameModalOpen(false);
    setPendingExportType(null);
  };

  return (
    <>
      <header className={styles.topBar}>
        <div className={styles.fileMenuContainer}>
          {/* Spec 2026-01-10: Renamed from "File" to "Project" */}
          <button
            ref={fileButtonRef}
            className={styles.fileMenuButton}
            onClick={handleFileButtonClick}
            data-testid="project-menu-trigger"
          >
            Product
            <span className={styles.chevron}>&#9662;</span>
          </button>
        </div>

        {/* Spec 2026-01-03: Task Group 2 - Updated navigation buttons order: Product, Architecture, Diagrams */}
        {/* Spec 2026-01-05: Updated button labels to "Product & Delivery" and "Architecture & Design" */}
        {/* Spec 2026-01-19: Product & Delivery button conditionally rendered based on includeDelivery toggle */}
        {/* Spec 2026-02-17: Dashboard Increment 1 - Dashboard button added as FIRST item (always visible) */}
        <div className={styles.viewToggle}>
          {/* Spec 2026-02-17: Dashboard button as FIRST item - always visible (no feature-toggle gating) */}
          <button
            className={`${styles.toggleButton} ${currentView === 'dashboard' ? styles.active : ''}`}
            onClick={() => handleViewChange('dashboard')}
            data-testid="dashboard-nav-button"
          >
            Dashboard
          </button>
          {/* Task 2.3: Product button - conditionally rendered */}
          {includeDelivery && (
            <button
              className={`${styles.toggleButton} ${currentView === 'product' ? styles.active : ''}`}
              onClick={() => handleViewChange('product')}
              data-testid="product-nav-button"
            >
              Product & Delivery
            </button>
          )}
          {/* Task 2.4: Renamed "Meta-model" to "Architecture", internal value remains 'metamodel' */}
          <button
            className={`${styles.toggleButton} ${architectureTabActive ? styles.active : ''}`}
            onClick={() => handleViewChange('metamodel')}
            data-testid="architecture-nav-button"
          >
            Architecture & Design
          </button>
          <button
            className={`${styles.toggleButton} ${currentView === 'diagrams' ? styles.active : ''}`}
            onClick={() => handleViewChange('diagrams')}
            data-testid="diagrams-nav-button"
          >
            Diagrams
          </button>
          {/*
            Spec 2026-05-24 Target State Sub-tab + Deterministic Suggest -- Task Group 3.4
            The top-level "Target Architecture" nav button has been removed.
            Target State is now reachable as a sub-tab under the "Architecture
            & Design" surface (the metamodel button above stays the entry
            point) or directly via the URL
              /projects/:p/architectures/:a/architecture-design/target-state.
            The legacy /target-architecture route remains as a <Navigate
            replace> redirect for bookmark compatibility (see App.tsx).
          */}
        </div>

        <div className={styles.actions}>
          {/* Spec 2026-01-22: File Mode indicator when includeDatabase=false */}
          {!includeDatabase && (
            <span
              className={styles.fileModeIndicator}
              title="Database features are disabled. Use Import/Export for file-based workflows."
              data-testid="file-mode-indicator"
            >
              File Mode
            </span>
          )}
          <span className={styles.fileName}>
            {state.loadedFileName || 'Untitled'}
          </span>
          {/* Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 3 */}
          {/* Pill/chip selector for the active architecture. Mounted next to the */}
          {/* project name; only rendered when an active project exists. */}
          {activeProject && <ArchitectureSelector />}
          {/* Spec 2026-01-06: JSON file input for snapshot import */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".json"
            className={styles.fileInput}
            data-testid="json-file-input"
          />
          <input
            type="file"
            ref={excelInputRef}
            onChange={handleExcelFileChange}
            accept=".xlsx"
            className={styles.fileInput}
            data-testid="xlsx-file-input"
          />
        </div>
      </header>

      {/* Notification toast */}
      {notification && (
        <div className={styles.notification} data-testid="notification-toast">
          {notification}
        </div>
      )}

      {/* Spec 2026-01-22: Wrap children with ImportActionsProvider */}
      {/* Spec 2026-03-04: Nest ModalActionProvider inside ImportActionsProvider */}
      {children && (
        <ImportActionsProvider
          triggerImportJson={handleImportJsonClick}
          triggerImportXlsx={handleImportXlsxClick}
        >
          <ModalActionProvider
            openGenerateStandardsModal={handleGenerateStandards}
          >
            {children}
          </ModalActionProvider>
        </ImportActionsProvider>
      )}

      {/* Spec 2026-01-10: Added onDelete prop for Delete Project */}
      {/* Spec 2026-01-11: Added onSave, saveDisabled, importXlsxDisabled, and new disabled props */}
      {/* Spec 2026-01-31: Added onGenerateStandards and generateStandardsDisabled props */}
      <FileMenu
        visible={fileMenuVisible}
        x={fileMenuPosition.x}
        y={fileMenuPosition.y}
        onClose={handleFileMenuClose}
        onCreateProject={handleCreateProject}
        onOpenBackend={handleOpenBackend}
        onSave={handleSave}
        saveDisabled={saveDisabled}
        onSaveAsBackend={handleSaveAsBackend}
        saveAsDisabled={saveAsDisabled}
        onDelete={handleDeleteProject}
        onImportJson={handleImportJsonClick}
        importJsonDisabled={importJsonDisabled}
        onExportJson={handleExportJsonClick}
        exportJsonDisabled={exportJsonDisabled}
        onImportXlsx={handleImportXlsxClick}
        importXlsxDisabled={importXlsxDisabled}
        onExportXlsx={handleExportXlsxClick}
        exportXlsxDisabled={exportXlsxDisabled}
        onGenerateStandards={handleGenerateStandards}
        generateStandardsDisabled={generateStandardsDisabled}
        onCloseProject={handleCloseProject}
        closeProjectDisabled={closeProjectDisabled}
        onExportInfrastructureTerraform={() => setInfrastructureTerraformModalOpen(true)}
        exportInfrastructureTerraformDisabled={exportInfrastructureTerraformDisabled}
        onImportInfrastructureTerraform={() => setInfrastructureTerraformImportModalOpen(true)}
        importInfrastructureTerraformDisabled={exportInfrastructureTerraformDisabled}
      />

      {/* Spec 2026-01-05: Create Project Modal */}
      <CreateProjectModal
        isOpen={isCreateProjectModalOpen}
        onClose={() => setCreateProjectModalOpen(false)}
      />

      {/* Spec 2026-01-10: Delete Project Modal */}
      <DeleteProjectModal
        isOpen={isDeleteProjectModalOpen}
        onClose={() => setDeleteProjectModalOpen(false)}
        onDeleteSuccess={handleDeleteSuccess}
      />

      {/* Spec 2026-01-31: Generate Project Standards Modal */}
      <GenerateProjectStandardsModal
        isOpen={isGenerateStandardsModalOpen}
        onClose={() => setGenerateStandardsModalOpen(false)}
        activeProject={activeProject}
      />

      {/* Spec 2026-03-05: Import Decision Modal (replaces ImportProjectSnapshotModal) */}
      <ImportDecisionModal
        isOpen={isImportDecisionModalOpen}
        onClose={handleImportDecisionClose}
        importedProjectName={pendingImportSnapshot?.project?.name || 'Unknown Project'}
        importSource={pendingImportSource}
        onSaveAndReplace={handleSaveAndReplace}
        onMerge={handleMergeSelected}
      />

      {/* Spec 2026-03-05 TG6: CherryPickMergeModal for cherry-pick merge flow */}
      {pendingCherryPickData && (
        <CherryPickMergeModal
          isOpen={isCherryPickModalOpen}
          onClose={() => {
            setCherryPickModalOpen(false);
            setPendingCherryPickData(null);
            setPendingImportSnapshot(null);
          }}
          cherryPickData={pendingCherryPickData}
          currentModel={state.model}
          onMergeComplete={handleMergeComplete}
          includeDatabase={includeDatabase}
        />
      )}

      {/* Spec 2026-01-19: Export Project Name Modal */}
      <ExportProjectNameModal
        isOpen={isExportProjectNameModalOpen}
        onClose={handleExportProjectNameCancel}
        onConfirm={handleExportProjectNameConfirm}
        data-testid="export-project-name-modal"
      />

      {/* Spec 2026-05-08: Infrastructure Terraform Export Modal */}
      {state.model && activeProject && activeArchitectureId && (
        <InfrastructureTerraformExportModal
          isOpen={isInfrastructureTerraformModalOpen}
          onClose={() => setInfrastructureTerraformModalOpen(false)}
          projectId={activeProject.id}
          architectureId={activeArchitectureId}
          metaModel={state.model.metaModel}
          data-testid="infrastructure-terraform-export-modal"
        />
      )}

      {/* Spec 2026-05-08: Infrastructure Terraform Import Modal */}
      {state.model && activeProject && activeArchitectureId && (
        <InfrastructureTerraformImportModal
          isOpen={isInfrastructureTerraformImportModalOpen}
          onClose={() => setInfrastructureTerraformImportModalOpen(false)}
          projectId={activeProject.id}
          architectureId={activeArchitectureId}
          metaModel={state.model.metaModel}
          data-testid="infrastructure-terraform-import-modal"
        />
      )}

      {/* Backend file dialogs */}
      <ModelFileDialog
        mode="open"
        isOpen={isOpenDialogVisible}
        onClose={() => setOpenDialogVisible(false)}
        onConfirm={handleOpenFromBackend}
      />

      <ModelFileDialog
        mode="saveAs"
        isOpen={isSaveAsDialogVisible}
        onClose={() => setSaveAsDialogVisible(false)}
        onConfirm={handleSaveToBackend}
        currentFilename={state.loadedFileName || undefined}
      />

      <ErrorModal
        isOpen={errorModalOpen}
        onClose={() => setErrorModalOpen(false)}
        errors={errorMessages}
      />

      {/* Validation Warning Modal */}
      {validationWarningModalOpen && (
        <ErrorModal
          isOpen={validationWarningModalOpen}
          onClose={() => {
            setValidationWarningModalOpen(false);
            setValidationWarnings([]);
          }}
          title="Cannot Save"
          errors={[
            'Please fix the following issues before saving:',
            ...validationWarnings.map(err => `- ${err.message}`),
          ]}
        />
      )}
    </>
  );
}
