/**
 * LandingPage Component
 *
 * Displayed when the app is in DB mode and no project is active.
 * Presents three action cards: Create New Project, Open Existing, and Import JSON.
 * Each action triggers the corresponding modal/flow, and on success the activeProject
 * is set, causing the guard in AppContent to re-evaluate and render the normal app.
 *
 * Self-contained: manages its own modal state and renders CreateProjectModal
 * and ModelFileDialog independently of TopBar.
 *
 * Spec 2026-03-05: Import Product Snapshot Redesign
 * Task Group 3: LandingPage Direct Load (No Active Project)
 * - Replaced ImportProjectSnapshotModal with direct load logic (Flow A)
 * - Uses shared validateSnapshotSchema from importMergeUtils.ts
 * - On valid JSON: dispatches LOAD_MODEL, calls backend API, refreshes project
 * - No modal opens for JSON import -- loads directly
 */

import React, { useRef, useState } from 'react';
import { useArchitectureDispatch } from '../../contexts/ArchitectureContext';
import { useIncludeDatabase } from '../../contexts/AppConfigContext';
import { useRefreshActiveProject, useSetActiveProject } from '../../contexts/ProjectContext';
import { CreateProjectModal } from '../Project/CreateProjectModal';
import { ModelFileDialog, OpenProjectResult, SaveAsResult, isOpenProjectResult } from '../file/ModelFileDialog';
import { activateProject } from '../../api/projectsApi';
import { loadModelByProjectId } from '../../api/modelApi';
// Spec 2026-05-01 Multi-Architecture Plumbing -- Task Group 4
// listArchitectures is called inline here because no active project exists yet
// when LandingPage is shown -- ArchitectureContext can't resolve activeArchitectureId
// until after activateProject sets the active project. We resolve the Default
// architecture id inline so we can pass it to loadModelByProjectId in the same flow.
import { listArchitectures } from '../../api/architecturesApi';
import { importProjectSnapshot } from '../../api/projectSnapshotApi';
import { importToSession } from '../../api/projectSessionApi';
import { validateSnapshotSchema, MAX_SNAPSHOT_FILE_SIZE } from '../../utils/importMergeUtils';
import styles from './LandingPage.module.css';

interface LandingPageProps {
  onCreateOrganisation?: () => void;
}

export function LandingPage({ onCreateOrganisation }: LandingPageProps) {
  const dispatch = useArchitectureDispatch();
  const includeDatabase = useIncludeDatabase();
  const refreshActiveProject = useRefreshActiveProject();
  const setActiveProject = useSetActiveProject();

  // Create Project modal state
  const [isCreateModalOpen, setCreateModalOpen] = useState(false);

  // Open Project dialog state
  const [isOpenDialogOpen, setOpenDialogOpen] = useState(false);

  // Import JSON state
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Error state
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  /**
   * Handle opening a project from the ModelFileDialog.
   * Replicates the activate-first flow from TopBar.handleOpenFromBackend.
   */
  const handleOpenFromBackend = async (result: OpenProjectResult | SaveAsResult) => {
    if (!isOpenProjectResult(result)) {
      setErrorMessage('Invalid open result: missing project ID');
      return;
    }

    const { filename, projectId } = result;

    try {
      // Activate project in backend
      const activatedProject = await activateProject(projectId);
      setActiveProject(activatedProject);

      // Spec 2026-05-01 Multi-Architecture Plumbing -- Task Group 4
      // Resolve the Default architecture id inline (oldest non-archived).
      // ArchitectureContext's resolver also runs in parallel, but we need the
      // id NOW for the upcoming loadModelByProjectId call.
      const architectures = await listArchitectures(projectId);
      const nonArchived = architectures.filter(a => !a.archived);
      if (nonArchived.length === 0) {
        throw new Error(`No non-archived architecture found for project "${projectId}"`);
      }
      const architectureId = nonArchived[0].id;

      // Load model
      const model = await loadModelByProjectId(projectId, architectureId);
      dispatch({ type: 'LOAD_MODEL', payload: model, fileName: filename });

      setOpenDialogOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to open project';
      setErrorMessage(msg);
    }
  };

  /**
   * Handle file selection for JSON import -- Direct Load (Flow A).
   *
   * Spec 2026-03-05: Import Product Snapshot Redesign
   * When no active project exists, the user picks a JSON file and it loads
   * directly without any modal:
   * 1. Read and parse the file
   * 2. Validate using shared validateSnapshotSchema
   * 3. Dispatch LOAD_MODEL with snapshot.model and fileName: snapshot.project.name
   * 4. Call importProjectSnapshot (DB mode) or importToSession (File Mode)
   * 5. Refresh active project after successful backend call
   */
  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Reset file input to allow re-selecting the same file
    try { event.target.value = ''; } catch { /* jsdom may throw for file inputs */ }

    try {
      // File size check
      if (file.size > MAX_SNAPSHOT_FILE_SIZE) {
        const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
        setErrorMessage(`File too large (${sizeMB} MB). Maximum allowed size is 50 MB.`);
        return;
      }

      // Read file content
      const content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsText(file);
      });

      // Parse JSON
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        setErrorMessage('Invalid JSON file: Failed to parse JSON');
        return;
      }

      // Validate schema using shared utility
      const validation = validateSnapshotSchema(parsed);
      if (!validation.valid || !validation.snapshot) {
        setErrorMessage('Invalid snapshot file: ' + validation.errors.join('; '));
        return;
      }

      const snapshot = validation.snapshot;
      const projectName = snapshot.project.name || 'Unknown Project';

      // Flow A: Direct load -- dispatch LOAD_MODEL immediately
      dispatch({ type: 'LOAD_MODEL', payload: snapshot.model, fileName: projectName });

      // Persist to backend
      const importRequest = {
        snapshot,
        setActive: true,
        overwriteExistingProject: true,
      };

      try {
        if (includeDatabase) {
          // DB mode: call importProjectSnapshot
          await importProjectSnapshot(importRequest);
        } else {
          // File mode: call importToSession
          await importToSession(importRequest);
        }

        // Refresh ProjectContext after successful backend call
        await refreshActiveProject();
      } catch (apiErr) {
        const msg = apiErr instanceof Error ? apiErr.message : 'Failed to persist imported project';
        setErrorMessage(msg);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to read file');
    }
  };

  return (
    <div className={styles.container} data-testid="landing-page">
      <div className={styles.content}>
        <h1 className={styles.title}>Welcome to Haikai</h1>
        <p className={styles.subtitle}>Select or create a project to begin</p>

        {errorMessage && (
          <p
            className={styles.subtitle}
            style={{ color: 'var(--error, #dc2626)' }}
            data-testid="landing-error"
            onClick={() => setErrorMessage(null)}
          >
            {errorMessage}
          </p>
        )}

        <div className={styles.cardGrid}>
          {/* Create Organisation */}
          {onCreateOrganisation && (
            <div
              className={styles.card}
              onClick={onCreateOrganisation}
              data-testid="landing-create-org-card"
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onCreateOrganisation(); }}
            >
              <div className={styles.cardIcon}>&#9733;</div>
              <h2 className={styles.cardTitle}>Create Organisation</h2>
              <p className={styles.cardDescription}>Set up a new organisation workspace</p>
            </div>
          )}

          {/* Create New Project */}
          <div
            className={styles.card}
            onClick={() => setCreateModalOpen(true)}
            data-testid="landing-create-card"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setCreateModalOpen(true); }}
          >
            <div className={styles.cardIcon}>+</div>
            <h2 className={styles.cardTitle}>Create New Project</h2>
            <p className={styles.cardDescription}>Start a new product from scratch</p>
          </div>

          {/* Open Existing Project */}
          <div
            className={styles.card}
            onClick={() => setOpenDialogOpen(true)}
            data-testid="landing-open-card"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setOpenDialogOpen(true); }}
          >
            <div className={styles.cardIcon}>&darr;</div>
            <h2 className={styles.cardTitle}>Open Existing</h2>
            <p className={styles.cardDescription}>Resume work on an existing project</p>
          </div>

          {/* Import JSON */}
          <div
            className={styles.card}
            onClick={() => fileInputRef.current?.click()}
            data-testid="landing-import-card"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
          >
            <div className={styles.cardIcon}>&uarr;</div>
            <h2 className={styles.cardTitle}>Import JSON</h2>
            <p className={styles.cardDescription}>Load from an exported snapshot file</p>
          </div>
        </div>

        {/* Hidden file input for JSON import */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept=".json"
          className={styles.hiddenInput}
          data-testid="landing-json-file-input"
        />
      </div>

      {/* Create Project Modal */}
      <CreateProjectModal
        isOpen={isCreateModalOpen}
        onClose={() => setCreateModalOpen(false)}
      />

      {/* Open Project Dialog */}
      <ModelFileDialog
        mode="open"
        isOpen={isOpenDialogOpen}
        onClose={() => setOpenDialogOpen(false)}
        onConfirm={handleOpenFromBackend}
      />
    </div>
  );
}
