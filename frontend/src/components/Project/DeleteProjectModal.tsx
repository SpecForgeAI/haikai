/**
 * DeleteProjectModal Component
 *
 * Spec 2026-01-10: Project Menu + Delete Project
 * Spec 2026-01-10: Project Hierarchy Grouping - Updated to use GroupedProjectList
 *
 * Modal dialog for selecting and deleting a project.
 * Displays projects grouped by hierarchy using GroupedProjectList component.
 * Requires single selection before Delete is enabled.
 * Shows loading state during deletion, error state on failure.
 *
 * Follows patterns from ModelFileDialog.tsx for consistent UI/UX.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { listProjects, deleteProject, ProjectDto } from '../../api/projectsApi';
import { GroupedProjectList } from './GroupedProjectList';
import styles from './DeleteProjectModal.module.css';

/**
 * Props for DeleteProjectModal component
 */
export interface DeleteProjectModalProps {
  /** Whether the modal is visible */
  isOpen: boolean;
  /** Callback when modal is closed/cancelled */
  onClose: () => void;
  /** Callback when deletion is successful, receives deleted project ID */
  onDeleteSuccess: (deletedProjectId: string) => void;
}

/**
 * DeleteProjectModal Component
 *
 * Renders a modal dialog for selecting and deleting a project.
 * Uses GroupedProjectList to display projects organized by hierarchy.
 */
export function DeleteProjectModal({
  isOpen,
  onClose,
  onDeleteSuccess,
}: DeleteProjectModalProps) {
  // State for project list
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // State for selection
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  // State for deletion
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  /**
   * Fetch projects from backend
   */
  const loadProjects = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const projectList = await listProjects();
      setProjects(projectList);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Effect: Fetch projects and reset state when modal opens
   */
  useEffect(() => {
    if (isOpen) {
      loadProjects();
      // Reset selection and error state
      setSelectedProjectId(null);
      setDeleteError(null);
    }
  }, [isOpen, loadProjects]);

  /**
   * Handle Delete button click
   */
  const handleDeleteClick = useCallback(async () => {
    if (!selectedProjectId || isDeleting) return;

    setIsDeleting(true);
    setDeleteError(null);

    try {
      await deleteProject(selectedProjectId);

      // Success - close modal and notify parent
      onDeleteSuccess(selectedProjectId);
      onClose();
    } catch (err) {
      // Keep modal open and show error
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete project');
    } finally {
      setIsDeleting(false);
    }
  }, [selectedProjectId, isDeleting, onDeleteSuccess, onClose]);

  /**
   * Effect: Handle keyboard events
   */
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      } else if (event.key === 'Enter' && selectedProjectId && !isDeleting) {
        handleDeleteClick();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, selectedProjectId, isDeleting, handleDeleteClick]);

  // Don't render if not open
  if (!isOpen) {
    return null;
  }

  /**
   * Handle project row click (from GroupedProjectList)
   */
  const handleProjectClick = (projectId: string) => {
    setSelectedProjectId(projectId);
    // Clear delete error when selection changes
    setDeleteError(null);
  };

  /**
   * Handle overlay click (close modal)
   */
  const handleOverlayClick = () => {
    if (!isDeleting) {
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

  // Determine Delete button disabled state
  const isDeleteDisabled = !selectedProjectId || isDeleting;

  // Get selected project name for delete button confirmation echo
  const selectedProject = selectedProjectId
    ? projects.find((p) => p.id === selectedProjectId)
    : null;
  const deleteButtonText = isDeleting
    ? 'Deleting...'
    : selectedProject
      ? `Delete "${selectedProject.name}"`
      : 'Delete';

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div
        className={styles.modal}
        onClick={handleModalClick}
        role="dialog"
        aria-labelledby="delete-project-title"
        aria-modal="true"
      >
        {/* Header */}
        <div className={styles.header}>
          <h2 id="delete-project-title" className={styles.title}>Delete Product</h2>
          <button
            className={styles.closeButton}
            onClick={onClose}
            disabled={isDeleting}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className={styles.content}>
          {/* Warning message */}
          <div className={styles.warningMessage}>
            Warning: Deleting a project will permanently remove all its files and data. This action cannot be undone.
          </div>

          {/* Project list section */}
          <div className={styles.projectListSection}>
            <div className={styles.projectListLabel}>Select a project to delete:</div>

            {/* Loading state */}
            {isLoading && (
              <div className={styles.loadingContainer}>
                <div className={styles.spinner}></div>
                <span>Loading projects...</span>
              </div>
            )}

            {/* Error state */}
            {loadError && !isLoading && (
              <div className={styles.errorContainer}>
                <div className={styles.errorMessage}>{loadError}</div>
                <button className={styles.retryButton} onClick={loadProjects}>
                  Retry
                </button>
              </div>
            )}

            {/* Project list - using GroupedProjectList component */}
            {!isLoading && !loadError && (
              <GroupedProjectList
                projects={projects}
                selectedProjectId={selectedProjectId}
                onProjectClick={handleProjectClick}
                formatDate={formatDate}
              />
            )}
          </div>

          {/* Inline error message for deletion failures */}
          {deleteError && (
            <div className={styles.inlineError}>
              {deleteError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <button
            className={styles.cancelButton}
            onClick={onClose}
            disabled={isDeleting}
          >
            Cancel
          </button>
          <button
            className={styles.deleteButton}
            onClick={handleDeleteClick}
            disabled={isDeleteDisabled}
            data-testid="delete-project-confirm-button"
          >
            {isDeleting && <span className={styles.buttonSpinner}></span>}
            {deleteButtonText}
          </button>
        </div>
      </div>
    </div>
  );
}

export default DeleteProjectModal;
