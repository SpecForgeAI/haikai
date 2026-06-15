/**
 * CreateOrganisationModal Component
 *
 * Spec 2026-01-31: Create Organisation Modal
 * Task Group 3: CreateOrganisationModal Component
 *
 * Spec 2026-01-31: Trigger Global Standards Generation
 * Task Group 6: CreateOrganisationModal Integration
 *
 * Spec 2026-01-31: Fix Create Organisation Standards Flow
 * Task Group 2: CreateOrganisationModal Flush Before Submit + Payload Update
 *
 * Modal dialog for creating a new organisation with full payload including
 * name, description, and six standards document lists. After successful
 * creation, triggers global standards generation and shows toast notification.
 *
 * Features:
 * - Name field with validation (required, unique case-insensitively)
 * - Description textarea (3 visible lines, not resizable)
 * - Six MultiValueChipsInput fields for standards documents
 * - Escape key closes modal (unless submitting or generating standards)
 * - Overlay click closes modal (unless submitting or generating standards)
 * - Auto-focus on Name input when modal opens
 * - Sequential flow: flush inputs -> create organisation -> generate standards -> toast -> close
 * - Toast notifications for success/failure of standards generation
 *
 * Follows CreateProjectModal.tsx structure and styling patterns.
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  listOrganisations,
  createOrganisationFull,
  generateGlobalStandards,
  CreateOrganisationPayload,
  StandardsGenerationPayload,
  OrganisationDto,
  OrganisationConflictError,
} from '../../api/organisationsApi';
import { MultiValueChipsInput, MultiValueChipsInputHandle } from '../common/MultiValueChipsInput';
import { Toast, ToastType } from '../common/Toast';
import { validateName as validateNameFormat, MAX_NAME_LENGTH } from '../../utils/validateName';
import styles from './CreateOrganisationModal.module.css';

/**
 * Props for CreateOrganisationModal component
 */
export interface CreateOrganisationModalProps {
  /** Whether the modal is visible */
  isOpen: boolean;
  /** Callback when modal is closed (via Cancel, overlay click, or successful create) */
  onClose: () => void;
  /** Optional callback after successful organisation creation */
  onCreated?: () => void;
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
 * CreateOrganisationModal Component
 *
 * Renders a modal dialog for creating a new organisation with all fields.
 */
export function CreateOrganisationModal({
  isOpen,
  onClose,
  onCreated,
}: CreateOrganisationModalProps) {
  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [docsAppliedToAllSources, setDocsAppliedToAllSources] = useState<string[]>([]);
  const [docsAppliedToTechStack, setDocsAppliedToTechStack] = useState<string[]>([]);
  const [docsAppliedToCodingStyles, setDocsAppliedToCodingStyles] = useState<string[]>([]);
  const [docsAppliedToConventions, setDocsAppliedToConventions] = useState<string[]>([]);
  const [docsAppliedToErrorHandling, setDocsAppliedToErrorHandling] = useState<string[]>([]);
  const [docsAppliedToValidation, setDocsAppliedToValidation] = useState<string[]>([]);

  // UI state
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [existingOrganisations, setExistingOrganisations] = useState<OrganisationDto[]>([]);
  const [isLoadingOrganisations, setIsLoadingOrganisations] = useState(false);

  // Standards generation state (Spec 2026-01-31: Trigger Global Standards Generation)
  const [isGeneratingStandards, setIsGeneratingStandards] = useState(false);
  const [standardsError, setStandardsError] = useState<string | null>(null);

  // Toast state
  const [toast, setToast] = useState<ToastState>({
    visible: false,
    message: '',
    type: 'success',
  });

  // Ref for input focus
  const nameInputRef = useRef<HTMLInputElement>(null);

  /**
   * Refs for all six MultiValueChipsInput instances.
   *
   * Spec 2026-01-31: Fix Create Organisation Standards Flow
   * Task Group 2: Used to call flush() before submit to commit pending values.
   */
  const allSourcesRef = useRef<MultiValueChipsInputHandle>(null);
  const techStackRef = useRef<MultiValueChipsInputHandle>(null);
  const codingStylesRef = useRef<MultiValueChipsInputHandle>(null);
  const conventionsRef = useRef<MultiValueChipsInputHandle>(null);
  const errorHandlingRef = useRef<MultiValueChipsInputHandle>(null);
  const validationRef = useRef<MultiValueChipsInputHandle>(null);

  /**
   * Reset form state and load organisations when modal opens
   */
  useEffect(() => {
    if (isOpen) {
      // Reset form state
      setName('');
      setDescription('');
      setDocsAppliedToAllSources([]);
      setDocsAppliedToTechStack([]);
      setDocsAppliedToCodingStyles([]);
      setDocsAppliedToConventions([]);
      setDocsAppliedToErrorHandling([]);
      setDocsAppliedToValidation([]);
      setErrorMessage(null);
      setNameError(null);
      setIsSubmitting(false);
      setIsGeneratingStandards(false);
      setStandardsError(null);

      // Fetch existing organisations for uniqueness validation
      setIsLoadingOrganisations(true);
      listOrganisations()
        .then((orgs) => {
          setExistingOrganisations(orgs);
          setIsLoadingOrganisations(false);
        })
        .catch((err) => {
          console.warn('Failed to load organisations for validation:', err);
          setIsLoadingOrganisations(false);
          // Continue without validation - backend will catch conflicts
        });

      // Focus name input with small delay
      const timeoutId = setTimeout(() => {
        nameInputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [isOpen]);

  /**
   * Handle keyboard events (Escape to close)
   * Disabled during submitting or generating standards
   */
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSubmitting && !isGeneratingStandards) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, isGeneratingStandards, onClose]);

  /**
   * Validate name: format (length, forbidden chars) + uniqueness (case-insensitive)
   */
  const validateName = useCallback(
    (value: string): string | null => {
      // First check format (empty, max length, forbidden chars)
      const formatError = validateNameFormat(value, 'Organisation name');
      if (formatError) {
        return formatError;
      }

      // Then check for duplicate (case-insensitive)
      const lowerName = value.trim().toLowerCase();
      const isDuplicate = existingOrganisations.some(
        (org) => org.name.toLowerCase() === lowerName
      );

      if (isDuplicate) {
        return 'Organisation with this name already exists';
      }

      return null;
    },
    [existingOrganisations]
  );

  /**
   * Handle name change and validate
   */
  const handleNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newName = e.target.value;
      setName(newName);

      // Validate and update error message
      const error = validateName(newName);
      setNameError(error);
    },
    [validateName]
  );

  /**
   * Check if form is valid (format + uniqueness)
   */
  const isFormValid = useMemo(() => {
    return validateName(name) === null;
  }, [name, validateName]);

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
   * Handle Create button click
   *
   * Spec 2026-01-31: Fix Create Organisation Standards Flow - Task Group 2
   * Sequential flow:
   * 1. Flush all chip inputs to commit pending values
   * 2. Create organisation
   * 3. Generate standards (with external-compatible payload)
   * 4. Show toast (success or error)
   * 5. Close modal
   * 6. Call onCreated callback
   */
  const handleCreate = useCallback(async () => {
    if (!isFormValid || isSubmitting || isGeneratingStandards) return;

    /**
     * Spec 2026-01-31: Fix Create Organisation Standards Flow
     * Task Group 2: Flush all chip inputs BEFORE setIsSubmitting(true) and before reading state.
     * This commits any pending typed values synchronously.
     */
    allSourcesRef.current?.flush();
    techStackRef.current?.flush();
    codingStylesRef.current?.flush();
    conventionsRef.current?.flush();
    errorHandlingRef.current?.flush();
    validationRef.current?.flush();

    setIsSubmitting(true);
    setErrorMessage(null);
    setNameError(null);
    setStandardsError(null);

    try {
      // Step 1: Create organisation
      const payload: CreateOrganisationPayload = {
        name: name.trim(),
        description: description.trim() || null,
        docsAppliedToAllSources,
        docsAppliedToTechStack,
        docsAppliedToCodingStyles,
        docsAppliedToConventions,
        docsAppliedToErrorHandling,
        docsAppliedToValidation,
      };

      const createdOrg = await createOrganisationFull(payload);

      // Organisation created - now generate standards
      setIsSubmitting(false);
      setIsGeneratingStandards(true);

      try {
        /**
         * Step 2: Generate standards
         *
         * Spec 2026-01-31: Fix Create Organisation Standards Flow
         * Task Group 2: Use external-compatible payload schema.
         * - Remove organisationId (gateway resolves by company name)
         * - Use 'company' instead of 'name'
         * - Map docsAppliedToAllSources to 'sources'
         * - Use 'technical_documents' object with snake_case keys
         */
        const standardsPayload: StandardsGenerationPayload = {
          company: name.trim(),
          sources: docsAppliedToAllSources,
          technical_documents: {
            tech_stack: docsAppliedToTechStack,
            coding_style: docsAppliedToCodingStyles,
            conventions: docsAppliedToConventions,
            error_handling: docsAppliedToErrorHandling,
            validation: docsAppliedToValidation,
          },
        };

        await generateGlobalStandards(standardsPayload);

        // Step 3: Success - show success toast
        setIsGeneratingStandards(false);
        showToast('Organisation created and standards generated successfully', 'success');

      } catch (standardsErr) {
        // Standards generation failed - org is still created
        setIsGeneratingStandards(false);
        const errorMsg = standardsErr instanceof Error
          ? standardsErr.message
          : 'Standards generation failed';
        setStandardsError(errorMsg);
        showToast('Organisation created but standards generation failed', 'error');
      }

      // Step 4 & 5: Close modal and call onCreated callback
      // (happens regardless of standards generation outcome)
      if (onCreated) {
        onCreated();
      }
      onClose();

    } catch (err) {
      setIsSubmitting(false);
      setIsGeneratingStandards(false);

      if (err instanceof OrganisationConflictError) {
        // 409 Conflict - show inline name error
        setNameError('Organisation with this name already exists');
      } else {
        // Other error - show general error message
        const errorMsg = err instanceof Error ? err.message : 'Failed to create organisation';
        setErrorMessage(errorMsg);
      }
    }
  }, [
    isFormValid,
    isSubmitting,
    isGeneratingStandards,
    name,
    description,
    docsAppliedToAllSources,
    docsAppliedToTechStack,
    docsAppliedToCodingStyles,
    docsAppliedToConventions,
    docsAppliedToErrorHandling,
    docsAppliedToValidation,
    onCreated,
    onClose,
    showToast,
  ]);

  /**
   * Handle Enter key in form
   */
  const handleKeyPress = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' && isFormValid && !isSubmitting && !isGeneratingStandards) {
        handleCreate();
      }
    },
    [isFormValid, isSubmitting, isGeneratingStandards, handleCreate]
  );

  /**
   * Handle overlay click (close dialog)
   * Disabled during submitting or generating standards
   */
  const handleOverlayClick = useCallback(() => {
    if (!isSubmitting && !isGeneratingStandards) {
      onClose();
    }
  }, [isSubmitting, isGeneratingStandards, onClose]);

  /**
   * Handle modal content click (prevent propagation)
   */
  const handleModalClick = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
  }, []);

  // Compute disabled state for all inputs
  const inputsDisabled = isSubmitting || isGeneratingStandards || isLoadingOrganisations;

  // Compute button text
  const createButtonText = isGeneratingStandards
    ? 'Generating standards...'
    : isSubmitting
    ? 'Creating...'
    : 'Create';

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
          data-testid="organisation-toast"
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
            <h2 className={styles.title}>Create Organisation</h2>
            <button
              className={styles.closeButton}
              onClick={onClose}
              disabled={isSubmitting || isGeneratingStandards}
              aria-label="Close"
            >
              &times;
            </button>
          </div>

          {/* Content */}
          <div className={styles.content}>
            {/* Name input */}
            <div className={styles.inputGroup}>
              <label className={styles.inputLabel} htmlFor="organisation-name-input">
                Name
              </label>
              <input
                ref={nameInputRef}
                id="organisation-name-input"
                type="text"
                className={`${styles.input} ${nameError ? styles.inputError : ''}`}
                value={name}
                onChange={handleNameChange}
                onKeyPress={handleKeyPress}
                placeholder="Enter organisation name..."
                disabled={inputsDisabled}
                maxLength={MAX_NAME_LENGTH}
                data-testid="organisation-name-input"
              />
              {nameError && (
                <span className={styles.inlineError} data-testid="name-error">
                  {nameError}
                </span>
              )}
            </div>

            {/* Description textarea */}
            <div className={styles.inputGroup}>
              <label className={styles.inputLabel} htmlFor="organisation-description-input">
                Description
              </label>
              <textarea
                id="organisation-description-input"
                className={styles.textarea}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Enter organisation description..."
                disabled={inputsDisabled}
                data-testid="organisation-description-input"
              />
            </div>

            {/* Standards section */}
            <div className={styles.standardsSection}>
              <h3 className={styles.standardsHeader}>Standards</h3>
              <p className={styles.standardsIntro}>
                Documents applied to standards generation (optional). Enter URLs, file paths, or
                document references.
              </p>

              {/* All */}
              <div className={styles.standardsField}>
                <MultiValueChipsInput
                  ref={allSourcesRef}
                  values={docsAppliedToAllSources}
                  onChange={setDocsAppliedToAllSources}
                  placeholder="Add document references..."
                  label="All"
                  disabled={inputsDisabled}
                />
              </div>

              {/* Tech Stack */}
              <div className={styles.standardsField}>
                <MultiValueChipsInput
                  ref={techStackRef}
                  values={docsAppliedToTechStack}
                  onChange={setDocsAppliedToTechStack}
                  placeholder="Add document references..."
                  label="Tech Stack"
                  disabled={inputsDisabled}
                />
              </div>

              {/* Coding Styles */}
              <div className={styles.standardsField}>
                <MultiValueChipsInput
                  ref={codingStylesRef}
                  values={docsAppliedToCodingStyles}
                  onChange={setDocsAppliedToCodingStyles}
                  placeholder="Add document references..."
                  label="Coding Styles"
                  disabled={inputsDisabled}
                />
              </div>

              {/* Conventions */}
              <div className={styles.standardsField}>
                <MultiValueChipsInput
                  ref={conventionsRef}
                  values={docsAppliedToConventions}
                  onChange={setDocsAppliedToConventions}
                  placeholder="Add document references..."
                  label="Conventions"
                  disabled={inputsDisabled}
                />
              </div>

              {/* Error Handling */}
              <div className={styles.standardsField}>
                <MultiValueChipsInput
                  ref={errorHandlingRef}
                  values={docsAppliedToErrorHandling}
                  onChange={setDocsAppliedToErrorHandling}
                  placeholder="Add document references..."
                  label="Error Handling"
                  disabled={inputsDisabled}
                />
              </div>

              {/* Validation */}
              <div className={styles.standardsField}>
                <MultiValueChipsInput
                  ref={validationRef}
                  values={docsAppliedToValidation}
                  onChange={setDocsAppliedToValidation}
                  placeholder="Add document references..."
                  label="Validation"
                  disabled={inputsDisabled}
                />
              </div>
            </div>

            {/* General error message */}
            {errorMessage && (
              <div className={styles.errorMessage} data-testid="error-message">
                {errorMessage}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className={styles.footer}>
            <button
              className={styles.cancelButton}
              onClick={onClose}
              disabled={isSubmitting || isGeneratingStandards}
              data-testid="cancel-button"
            >
              Cancel
            </button>
            <button
              className={styles.createButton}
              onClick={handleCreate}
              disabled={!isFormValid || isSubmitting || isGeneratingStandards}
              data-testid="create-button"
            >
              {createButtonText}
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
        data-testid="organisation-toast"
      />
    </>
  );
}

export default CreateOrganisationModal;
