/**
 * CloneArchitectureModal
 *
 * Spec 2026-05-01 Multi-Architecture Full Clone (Spec #6) -- Task Group 6
 *
 * Standalone modal for the per-row "Clone" action surfaced in
 * `ManageArchitecturesModal` (Group 7). Per requirement decision #18 this is
 * its OWN component -- NOT a `mode='clone'` extension of
 * `EditArchitectureModal` -- so the default-population logic, copy, and
 * submit label stay distinct without overloading a `mode` prop.
 *
 * Defaults on open (per requirement decisions #2 + #3):
 *   - Name        -- pre-populated as `Copy of <source.name>` (e.g.
 *                    `Copy of Default`); the user can edit before submit.
 *   - Description -- pre-populated from `source.description` (or empty
 *                    string if the source has none).
 *   - Tags        -- start EMPTY; tags imply intent that clones usually
 *                    want to flip (e.g. `current-state` -> `target-state`),
 *                    so we deliberately avoid copying them.
 *
 * Submit pipeline:
 *   - Disabled while invalid OR while a request is in flight.
 *   - On submit: call `cloneArchitecture(projectId, source.id, payload)`.
 *   - On success:
 *       1. `await refreshArchitectures()` so the dropdown + Manage modal
 *          re-render against the freshly-cloned list.
 *       2. `setActiveArchitecture(newArch.id)` to navigate the user into
 *          the cloned architecture (safety property (h)).
 *       3. Fire a brief success toast (`Cloned <source.name> as <new.name>`).
 *       4. `onClose()`.
 *   - On 409 `duplicate_name` -> inline error rendered under the Name
 *     field; modal stays open. Mirrors `EditArchitectureModal`'s 409 path.
 *   - On 422 `archived_source` -> footer error banner (rare path -- the
 *     UI hides archived rows but a stale frontend / race could still hit
 *     it; backend 422 is defence-in-depth).
 *   - On 400 validation -> footer error banner with the server message.
 *   - On any other error -> generic footer error message; modal stays open.
 *
 * Clone scope NEVER opens for an archived source from the UI: the Manage
 * modal in Group 7 already filters archived rows out (carried over from
 * spec #3). The 422 branch above exists purely as defence-in-depth.
 *
 * Modal shell + click-outside / Escape / focus-on-mount mirror
 * `EditArchitectureModal.tsx` so the two modals look + feel identical.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Architecture,
  ArchitecturesApiError,
  cloneArchitecture,
} from '../../api/architecturesApi';
import { useArchitectureContext } from '../../contexts/ArchitectureContext';
import { useToast } from '../../contexts/ToastContext';
import styles from './CloneArchitectureModal.module.css';

// ---------------------------------------------------------------------------
// Validation rules (mirror server-side limits in the spec, identical to the
// Edit modal -- duplicated locally so this file is self-contained per the
// "do NOT extend EditArchitectureModal" decision).
// ---------------------------------------------------------------------------
const NAME_MAX = 100;
const DESCRIPTION_MAX = 500;
const TAG_MAX = 50;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface CloneArchitectureModalProps {
  /** Whether the modal is rendered. Internal state resets when this flips to true. */
  open: boolean;
  /** Called when the modal should close (Cancel, Escape, click-outside, success). */
  onClose: () => void;
  /** Project the source (and the resulting clone) lives in. */
  projectId: string;
  /** The architecture being cloned. Drives the Name + Description defaults
   *  and the success toast copy. Must NOT be archived (UI filters at the
   *  Manage modal level; backend 422 is defence-in-depth). */
  source: Architecture;
}

// ---------------------------------------------------------------------------
// Pure helpers
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
export function CloneArchitectureModal({
  open,
  onClose,
  projectId,
  source,
}: CloneArchitectureModalProps) {
  const { refreshArchitectures, setActiveArchitecture } = useArchitectureContext();
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
  // the form from the (current) `source` so re-opening the modal never
  // shows stale data from a previous interaction.
  useEffect(() => {
    if (!open) return;
    setName(`Copy of ${source.name}`);
    setDescription(source.description ?? '');
    setTags([]); // deliberate: tags start empty per requirement decision #3.
    setTagDraft('');
    setNameError(null);
    setDescriptionError(null);
    setTagError(null);
    setSubmitError(null);
    setIsSubmitting(false);
  }, [open, source]);

  // ---- Focus first input on open -----------------------------------------
  useEffect(() => {
    if (!open) return;
    // Defer one tick so the input is in the DOM before we focus it.
    const id = window.setTimeout(() => {
      nameInputRef.current?.focus();
      // Select-all so the user can immediately overtype `Copy of <source>`
      // with their own name -- this is the most common path.
      nameInputRef.current?.select();
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
  // Mirrors the chip primitive from `EditArchitectureModal` exactly
  // (Enter / comma commits, backspace-on-empty pops the last chip,
  // duplicate / empty silently rejected, >50 chars inline error).
  const commitDraft = useCallback(
    (raw: string): boolean => {
      const trimmed = raw.trim();
      if (!trimmed) {
        return false;
      }
      if (trimmed.length > TAG_MAX) {
        setTagError(`Tag must be ${TAG_MAX} characters or fewer`);
        return false;
      }
      if (tags.includes(trimmed)) {
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
      const candidate = tagDraft.replace(/,$/, '');
      if (commitDraft(candidate)) {
        setTagDraft('');
      }
      return;
    }
    if (e.key === 'Backspace' && tagDraft === '' && tags.length > 0) {
      setTags(prev => prev.slice(0, -1));
    }
  };

  const handleTagChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setTagDraft(next);
    if (tagError) setTagError(null);
  };

  const handleRemoveChip = (index: number) => {
    setTags(prev => prev.filter((_, i) => i !== index));
  };

  // ---- Submit -------------------------------------------------------------
  const trimmedName = name.trim();
  const isValid = !validateName(name) && !validateDescription(description);
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
      const newArch = await cloneArchitecture(projectId, source.id, payload);
      // Order matters per safety property (h):
      //   1. Refresh the list so the new arch is in context state before...
      //   2. ...switching the active architecture (URL navigation).
      //   3. Toast + close.
      await refreshArchitectures();
      setActiveArchitecture(newArch.id);
      showToast(`Cloned ${source.name} as ${newArch.name}`, 'success');
      onClose();
    } catch (err) {
      if (err instanceof ArchitecturesApiError) {
        if (err.status === 409 && err.body?.code === 'duplicate_name') {
          setNameError(
            err.body.message ?? 'An architecture with this name already exists.'
          );
        } else if (err.status === 422 && err.body?.code === 'archived_source') {
          setSubmitError(
            err.body.message ??
              'This architecture has been archived and can no longer be cloned.'
          );
        } else if (err.status === 400) {
          setSubmitError(
            err.body?.message ?? 'Could not clone -- please check your input.'
          );
        } else {
          setSubmitError(err.body?.message ?? 'Could not clone -- please try again.');
        }
      } else {
        setSubmitError('Could not clone -- please try again.');
      }
      setIsSubmitting(false);
    }
  };

  // ---- Render -------------------------------------------------------------
  if (!open) return null;

  const title = `Clone architecture: ${source.name}`;

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      data-testid="clone-architecture-modal"
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="clone-architecture-modal-title"
      >
        {/* Header */}
        <div className={styles.header}>
          <h2
            className={styles.title}
            id="clone-architecture-modal-title"
            title={title}
          >
            {title}
          </h2>
          <button
            className={styles.closeButton}
            onClick={onClose}
            title="Close"
            data-testid="clone-architecture-modal-close"
            disabled={isSubmitting}
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className={styles.content}>
          {/* Name */}
          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="clone-architecture-name">
              Name
            </label>
            <input
              id="clone-architecture-name"
              ref={nameInputRef}
              className={styles.formInput}
              type="text"
              value={name}
              onChange={handleNameChange}
              maxLength={NAME_MAX + 1 /* allow one over for the inline error */}
              data-testid="clone-architecture-name-input"
              disabled={isSubmitting}
            />
            {nameError && (
              <div
                className={styles.validationError}
                data-testid="clone-architecture-name-error"
              >
                {nameError}
              </div>
            )}
          </div>

          {/* Description */}
          <div className={styles.formGroup}>
            <label
              className={styles.formLabel}
              htmlFor="clone-architecture-description"
            >
              Description
            </label>
            <textarea
              id="clone-architecture-description"
              className={styles.formTextarea}
              value={description}
              onChange={handleDescriptionChange}
              data-testid="clone-architecture-description-input"
              disabled={isSubmitting}
            />
            <div className={styles.charCount}>
              {description.length} / {DESCRIPTION_MAX}
            </div>
            {descriptionError && (
              <div
                className={styles.validationError}
                data-testid="clone-architecture-description-error"
              >
                {descriptionError}
              </div>
            )}
          </div>

          {/* Tags */}
          <div className={styles.formGroup}>
            <label
              className={styles.formLabel}
              htmlFor="clone-architecture-tag-input"
            >
              Tags
            </label>
            <div className={styles.chipArea} data-testid="clone-architecture-chip-area">
              {tags.length === 0 && (
                <span
                  className={styles.chipHelp}
                  data-testid="clone-architecture-chip-empty"
                >
                  No tags yet
                </span>
              )}
              {tags.map((tag, index) => (
                <span
                  key={`${tag}-${index}`}
                  className={styles.chip}
                  data-testid={`clone-architecture-chip-${tag}`}
                >
                  {tag}
                  <button
                    type="button"
                    className={styles.chipRemove}
                    onClick={() => handleRemoveChip(index)}
                    title={`Remove ${tag}`}
                    data-testid={`clone-architecture-chip-remove-${tag}`}
                    disabled={isSubmitting}
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
            <div className={styles.chipInputRow}>
              <input
                id="clone-architecture-tag-input"
                className={styles.chipInput}
                type="text"
                value={tagDraft}
                onChange={handleTagChange}
                onKeyDown={handleTagKeyDown}
                placeholder="Type a tag and press Enter or comma to add"
                data-testid="clone-architecture-tag-input"
                disabled={isSubmitting}
              />
            </div>
            {tagError && (
              <div
                className={styles.validationError}
                data-testid="clone-architecture-tag-error"
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
              data-testid="clone-architecture-submit-error"
            >
              {submitError}
            </div>
          )}
          <button
            className={styles.secondaryButton}
            onClick={onClose}
            data-testid="clone-architecture-cancel-button"
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            className={styles.primaryButton}
            onClick={handleSubmit}
            data-testid="clone-architecture-submit-button"
            disabled={isPrimaryDisabled}
          >
            {isSubmitting ? 'Cloning...' : 'Clone'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CloneArchitectureModal;
