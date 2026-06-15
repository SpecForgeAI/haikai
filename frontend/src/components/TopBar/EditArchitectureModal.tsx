/**
 * EditArchitectureModal
 *
 * Spec 2026-05-02 Multi-Architecture CRUD UI + Tag Management -- Task Group 4
 *
 * Combined Create / Edit modal driven by a `mode: 'create' | 'edit'` prop.
 * Single component is reused for both flows (decision #5 in the spec) so the
 * field set + validation + chip primitive live in exactly one place.
 *
 * Fields:
 *   - Name        -- required, trimmed, <=100 chars, server-enforced unique.
 *   - Description -- optional, <=500 chars.
 *   - Tags        -- chip primitive (local to this file): existing tags as
 *                    removable chips + a text input below; Enter or comma
 *                    commits the trimmed value; empty / >50 chars / duplicate
 *                    rejected (silent for empty + dup, inline error for
 *                    over-length).
 *
 * Submit pipeline:
 *   - Disabled while invalid OR while a request is in flight.
 *   - On submit: call createArchitecture / updateArchitecture; on success
 *     await refreshArchitectures(), fire a success toast, then onClose().
 *   - On 409 (duplicate name) the typed ArchitecturesApiError carries
 *     status + body.{code, field, message}; render the message inline
 *     under the Name field. Modal stays open.
 *   - On any other error, surface a generic message in the footer.
 *
 * PATCH atomicity (safety property c): edit mode always sends the full
 * {name, description, tags} payload so server-side replace is atomic.
 *
 * Modal shell + click-outside / Escape / focus-on-mount mirror
 * RenameDiagramModal.tsx.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Architecture,
  ArchitecturesApiError,
  createArchitecture,
  updateArchitecture,
} from '../../api/architecturesApi';
import { useArchitectureContext } from '../../contexts/ArchitectureContext';
import { useToast } from '../../contexts/ToastContext';
import styles from './EditArchitectureModal.module.css';

// ---------------------------------------------------------------------------
// Validation rules (mirror server-side limits in the spec)
// ---------------------------------------------------------------------------
const NAME_MAX = 100;
const DESCRIPTION_MAX = 500;
const TAG_MAX = 50;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface EditArchitectureModalProps {
  /** 'create' for the new-architecture flow, 'edit' for an existing row. */
  mode: 'create' | 'edit';
  /** Whether the modal is rendered. Internal state resets when this flips to true. */
  open: boolean;
  /** Called when the modal should close (Cancel, Escape, click-outside, success). */
  onClose: () => void;
  /** Project the architecture lives in. */
  projectId: string;
  /** Pre-populated row in edit mode. Ignored in create mode. */
  architecture?: Architecture;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for test-style introspection if ever needed --
// kept module-private otherwise so the API surface stays small).
// ---------------------------------------------------------------------------

function validateName(rawName: string): string | null {
  const trimmed = rawName.trim();
  if (!trimmed) return 'Name is required';
  if (trimmed.length > NAME_MAX) {
    return `Name must be ${NAME_MAX} characters or fewer`;
  }
  return null;
}

function validateDescription(raw: string): string | null {
  if (raw.length > DESCRIPTION_MAX) {
    return `Description must be ${DESCRIPTION_MAX} characters or fewer`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function EditArchitectureModal({
  mode,
  open,
  onClose,
  projectId,
  architecture,
}: EditArchitectureModalProps) {
  const { refreshArchitectures } = useArchitectureContext();
  const { showToast } = useToast();

  // ---- Form state ---------------------------------------------------------
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState('');

  // ---- Validation / error state ------------------------------------------
  const [nameError, setNameError] = useState<string | null>(null);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [tagError, setTagError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ---- Submission state ---------------------------------------------------
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ---- Refs ---------------------------------------------------------------
  const nameInputRef = useRef<HTMLInputElement>(null);

  // ---- Reset state when the modal opens ----------------------------------
  // The parent controls `open`; whenever it flips false -> true we re-seed
  // the form (for edit) or clear it (for create) so re-opening the modal
  // never shows stale data from a previous interaction.
  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && architecture) {
      setName(architecture.name);
      setDescription(architecture.description ?? '');
      setTags([...architecture.tags]);
    } else {
      setName('');
      setDescription('');
      setTags([]);
    }
    setTagDraft('');
    setNameError(null);
    setDescriptionError(null);
    setTagError(null);
    setSubmitError(null);
    setIsSubmitting(false);
  }, [open, mode, architecture]);

  // ---- Focus first input on open -----------------------------------------
  useEffect(() => {
    if (!open) return;
    // Defer one tick so the input is in the DOM before we focus it.
    const id = window.setTimeout(() => {
      nameInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(id);
  }, [open]);

  // ---- Escape-to-close ----------------------------------------------------
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  // ---- Field handlers -----------------------------------------------------
  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value);
    setNameError(validateName(e.target.value));
    // Clear any stale 409 surfaced under the name field.
    setSubmitError(null);
  };

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDescription(e.target.value);
    setDescriptionError(validateDescription(e.target.value));
  };

  // ---- Tag chip primitive ------------------------------------------------
  /**
   * Commit the current draft as a new chip if it passes validation.
   * Returns true on success so the caller can clear the input.
   */
  const commitDraft = useCallback(
    (raw: string): boolean => {
      const trimmed = raw.trim();
      if (!trimmed) {
        // Silent reject for empty / whitespace-only.
        return false;
      }
      if (trimmed.length > TAG_MAX) {
        setTagError(`Tag must be ${TAG_MAX} characters or fewer`);
        return false;
      }
      // Case-sensitive duplicate check (tags are free-form strings per the spec).
      if (tags.includes(trimmed)) {
        // Silent reject for duplicates per the spec.
        return false;
      }
      setTags(prev => [...prev, trimmed]);
      setTagError(null);
      return true;
    },
    [tags]
  );

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      // For comma, strip the trailing comma the user may already have typed
      // before the keydown fired (some IMEs / browsers commit the char first).
      const candidate = tagDraft.replace(/,$/, '');
      if (commitDraft(candidate)) {
        setTagDraft('');
      }
      return;
    }
    if (e.key === 'Backspace' && tagDraft === '' && tags.length > 0) {
      // Convenience: backspace on empty input pops the last chip.
      setTags(prev => prev.slice(0, -1));
    }
  };

  const handleTagChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setTagDraft(next);
    // Clear length error as soon as the user starts editing again.
    if (tagError) setTagError(null);
  };

  const handleRemoveChip = (index: number) => {
    setTags(prev => prev.filter((_, i) => i !== index));
  };

  // ---- Submit -------------------------------------------------------------
  const trimmedName = name.trim();
  const isValid =
    !validateName(name) &&
    !validateDescription(description);
  const isPrimaryDisabled = !isValid || isSubmitting;

  const handleSubmit = async () => {
    // Re-run validation in case the user clicked submit before blurring.
    const nErr = validateName(name);
    const dErr = validateDescription(description);
    setNameError(nErr);
    setDescriptionError(dErr);
    if (nErr || dErr) return;

    setIsSubmitting(true);
    setSubmitError(null);
    setNameError(null);

    const payload = {
      name: trimmedName,
      description,
      tags,
    };

    try {
      if (mode === 'create') {
        await createArchitecture(projectId, payload);
        await refreshArchitectures();
        showToast('Architecture created.', 'success');
      } else {
        if (!architecture) {
          // Defensive guard -- edit mode requires a row.
          throw new Error('Cannot edit without an architecture');
        }
        await updateArchitecture(projectId, architecture.id, payload);
        await refreshArchitectures();
        showToast('Architecture saved.', 'success');
      }
      onClose();
    } catch (err) {
      if (err instanceof ArchitecturesApiError) {
        if (err.status === 409 && err.body?.code === 'duplicate_name') {
          setNameError(err.body.message ?? 'An architecture with this name already exists.');
        } else if (err.status === 400) {
          setSubmitError('Could not save -- please check your input.');
        } else {
          setSubmitError(err.body?.message ?? 'Could not save -- please try again.');
        }
      } else {
        setSubmitError('Could not save -- please try again.');
      }
      setIsSubmitting(false);
    }
  };

  // ---- Render -------------------------------------------------------------
  if (!open) return null;

  const submitLabel = mode === 'create' ? 'Create' : 'Save changes';
  const title = mode === 'create' ? 'Create Architecture' : 'Edit Architecture';

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      data-testid="edit-architecture-modal"
    >
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="edit-architecture-modal-title">
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title} id="edit-architecture-modal-title">{title}</h2>
          <button
            className={styles.closeButton}
            onClick={onClose}
            title="Close"
            data-testid="edit-architecture-modal-close"
            disabled={isSubmitting}
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className={styles.content}>
          {/* Name */}
          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="edit-architecture-name">
              Name
            </label>
            <input
              id="edit-architecture-name"
              ref={nameInputRef}
              className={styles.formInput}
              type="text"
              value={name}
              onChange={handleNameChange}
              maxLength={NAME_MAX + 1 /* allow one over for the inline error */}
              data-testid="edit-architecture-name-input"
              disabled={isSubmitting}
            />
            {nameError && (
              <div
                className={styles.validationError}
                data-testid="edit-architecture-name-error"
              >
                {nameError}
              </div>
            )}
          </div>

          {/* Description */}
          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="edit-architecture-description">
              Description
            </label>
            <textarea
              id="edit-architecture-description"
              className={styles.formTextarea}
              value={description}
              onChange={handleDescriptionChange}
              data-testid="edit-architecture-description-input"
              disabled={isSubmitting}
            />
            <div className={styles.charCount}>{description.length} / {DESCRIPTION_MAX}</div>
            {descriptionError && (
              <div
                className={styles.validationError}
                data-testid="edit-architecture-description-error"
              >
                {descriptionError}
              </div>
            )}
          </div>

          {/* Tags */}
          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="edit-architecture-tag-input">
              Tags
            </label>
            <div className={styles.chipArea} data-testid="edit-architecture-chip-area">
              {tags.length === 0 && (
                <span className={styles.chipHelp} data-testid="edit-architecture-chip-empty">
                  No tags yet
                </span>
              )}
              {tags.map((tag, index) => (
                <span
                  key={`${tag}-${index}`}
                  className={styles.chip}
                  data-testid={`edit-architecture-chip-${tag}`}
                >
                  {tag}
                  <button
                    type="button"
                    className={styles.chipRemove}
                    onClick={() => handleRemoveChip(index)}
                    title={`Remove ${tag}`}
                    data-testid={`edit-architecture-chip-remove-${tag}`}
                    disabled={isSubmitting}
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
            <div className={styles.chipInputRow}>
              <input
                id="edit-architecture-tag-input"
                className={styles.chipInput}
                type="text"
                value={tagDraft}
                onChange={handleTagChange}
                onKeyDown={handleTagKeyDown}
                placeholder="Type a tag and press Enter or comma to add"
                data-testid="edit-architecture-tag-input"
                disabled={isSubmitting}
              />
            </div>
            {tagError && (
              <div
                className={styles.validationError}
                data-testid="edit-architecture-tag-error"
              >
                {tagError}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          {submitError && (
            <div
              className={styles.footerError}
              data-testid="edit-architecture-submit-error"
            >
              {submitError}
            </div>
          )}
          <button
            className={styles.secondaryButton}
            onClick={onClose}
            data-testid="edit-architecture-cancel-button"
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            className={styles.primaryButton}
            onClick={handleSubmit}
            data-testid="edit-architecture-submit-button"
            disabled={isPrimaryDisabled}
          >
            {isSubmitting ? 'Saving...' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default EditArchitectureModal;
