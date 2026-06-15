/**
 * GenerateProjectStandardsModal Component
 *
 * Spec 2026-01-31: Project-level Standards Generation
 * Task Group 3: GenerateProjectStandardsModal Component
 *
 * Modal dialog for generating project-level standards. Collects source URLs/paths
 * and calls the standards service to generate project-specific standards.
 *
 * Features:
 * - Single MultiValueChipsInput field for Sources
 * - Escape key closes modal (unless generating)
 * - Overlay click closes modal (unless generating)
 * - Toast notifications for success/failure
 * - Sequential flow: flush input -> lookup org -> generate standards -> toast -> close
 *
 * Follows CreateOrganisationModal.tsx structure and styling patterns.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  getOrganisationById,
  generateProjectStandards,
  ProjectStandardsPayload,
} from '../../api/organisationsApi';
import { ProjectDto } from '../../api/projectsApi';
import { MultiValueChipsInput, MultiValueChipsInputHandle } from '../common/MultiValueChipsInput';
import { Toast, ToastType } from '../common/Toast';
import styles from './GenerateProjectStandardsModal.module.css';

/**
 * Props for GenerateProjectStandardsModal component
 */
export interface GenerateProjectStandardsModalProps {
  /** Whether the modal is visible */
  isOpen: boolean;
  /** Callback when modal is closed (via Cancel, overlay click, or successful generation) */
  onClose: () => void;
  /** The currently active project */
  activeProject: ProjectDto | null;
}

/**
 * Toast state for displaying notifications
 */
interface ToastState {
  visible: boolean;
  message: string;
  type: ToastType;
}

/**
 * GenerateProjectStandardsModal Component
 *
 * Renders a modal dialog for generating project-level standards.
 */
export function GenerateProjectStandardsModal({
  isOpen,
  onClose,
  activeProject,
}: GenerateProjectStandardsModalProps) {
  // Form state
  const [sources, setSources] = useState<string[]>([]);

  // UI state
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // Toast state
  const [toast, setToast] = useState<ToastState>({
    visible: false,
    message: '',
    type: 'success',
  });

  // Ref for MultiValueChipsInput flush pattern
  const sourcesRef = useRef<MultiValueChipsInputHandle>(null);

  /**
   * Reset form state when modal opens
   */
  useEffect(() => {
    if (isOpen) {
      setSources([]);
      setError(null);
      setIsGenerating(false);
    }
  }, [isOpen]);

  /**
   * Handle keyboard events (Escape to close)
   * Disabled during generating
   */
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isGenerating) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isGenerating, onClose]);

  /**
   * Show toast notification
   */
  const showToast = useCallback((message: string, type: ToastType) => {
    setToast({ visible: true, message, type });
  }, []);

  /**
   * Hide toast notification
   */
  const hideToast = useCallback(() => {
    setToast((prev) => ({ ...prev, visible: false }));
  }, []);

  /**
   * Handle Generate Standards button click
   *
   * Sequential flow:
   * 1. Flush sources input to commit pending values
   * 2. Set isGenerating=true, clear previous error
   * 3. Look up organisation name via getOrganisationById
   * 4. Build payload and call generateProjectStandards
   * 5. On success: show success toast, close modal
   * 6. On failure: show error toast, keep modal open for retry
   */
  const handleGenerate = useCallback(async () => {
    if (!activeProject || isGenerating) return;

    // Step 1: Flush sources input to commit any pending value
    sourcesRef.current?.flush();

    // Step 2: Set generating state, clear error
    setIsGenerating(true);
    setError(null);

    try {
      // Step 3: Look up organisation name
      if (!activeProject.organisationId) {
        setError('Project is not linked to an organisation');
        setIsGenerating(false);
        return;
      }

      const organisation = await getOrganisationById(activeProject.organisationId);
      if (!organisation) {
        setError('Failed to resolve organisation');
        setIsGenerating(false);
        return;
      }

      // Step 4: Build payload and call API
      const payload: ProjectStandardsPayload = {
        company: organisation.name,
        project: activeProject.name,
        sources,
      };

      await generateProjectStandards(payload);

      // Step 5: Success - show toast and close modal
      setIsGenerating(false);
      showToast('Project standards generated successfully', 'success');
      onClose();

    } catch (err) {
      // Step 6: Failure - show error toast, keep modal open
      setIsGenerating(false);
      showToast('Project standards generation failed. You can retry or cancel.', 'error');
    }
  }, [activeProject, isGenerating, sources, onClose, showToast]);

  /**
   * Handle overlay click (close dialog)
   * Disabled during generating
   */
  const handleOverlayClick = useCallback(() => {
    if (!isGenerating) {
      onClose();
    }
  }, [isGenerating, onClose]);

  /**
   * Handle modal content click (prevent propagation)
   */
  const handleModalClick = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
  }, []);

  /**
   * Handle Cancel button click
   */
  const handleCancel = useCallback(() => {
    if (!isGenerating) {
      onClose();
    }
  }, [isGenerating, onClose]);

  // Compute disabled state for all inputs
  const inputsDisabled = isGenerating;

  // Compute button text
  const generateButtonText = isGenerating ? 'Generating...' : 'Generate Standards';

  // Button is disabled when sources is empty or when generating
  const generateButtonDisabled = sources.length === 0 || isGenerating;

  // Don't render if not open
  if (!isOpen) {
    return (
      <>
        {/* Toast is rendered outside modal for proper positioning */}
        <Toast
          message={toast.message}
          type={toast.type}
          visible={toast.visible}
          onDismiss={hideToast}
          data-testid="project-standards-toast"
        />
      </>
    );
  }

  return (
    <>
      <div
        className={styles.overlay}
        onClick={handleOverlayClick}
        data-testid="modal-overlay"
      >
        <div className={styles.modal} onClick={handleModalClick}>
          {/* Header */}
          <div className={styles.header}>
            <h2 className={styles.title}>Generate Project Standards</h2>
            <button
              className={styles.closeButton}
              onClick={handleCancel}
              disabled={isGenerating}
              aria-label="Close"
            >
              &times;
            </button>
          </div>

          {/* Content */}
          <div className={styles.content}>
            {/* Body text */}
            <p className={styles.bodyText}>
              Choose the input documents (local files, external URLs) that will generate the project standards.
            </p>

            {/* Note text */}
            <p className={styles.noteText}>
              Note - project standards override your company standards if the same topic, otherwise company standards remain.
            </p>

            {/* Sources field */}
            <div className={styles.sourcesField}>
              <MultiValueChipsInput
                ref={sourcesRef}
                values={sources}
                onChange={setSources}
                placeholder="Enter URLs or file paths..."
                label="Sources"
                disabled={inputsDisabled}
              />
            </div>

            {/* Error message */}
            {error && (
              <div className={styles.errorMessage} data-testid="error-message">
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className={styles.footer}>
            <button
              className={styles.cancelButton}
              onClick={handleCancel}
              disabled={isGenerating}
              data-testid="cancel-button"
            >
              Cancel
            </button>
            <button
              className={styles.generateButton}
              onClick={handleGenerate}
              disabled={generateButtonDisabled}
              data-testid="generate-button"
            >
              {generateButtonText}
            </button>
          </div>
        </div>
      </div>

      {/* Toast notification - rendered outside modal overlay */}
      <Toast
        message={toast.message}
        type={toast.type}
        visible={toast.visible}
        onDismiss={hideToast}
        data-testid="project-standards-toast"
      />
    </>
  );
}

export default GenerateProjectStandardsModal;
