/**
 * ConflictResolutionModal
 *
 * Spec 2026-06-02 Unique, Aggregate Discovery Candidates (Spec 0) -- Task Group 7.3.
 *
 * Side-by-side, per-attribute conflict chooser for a single merged discovery
 * candidate. The cross-source MERGE engine (Spec 0 Group 2) records true value
 * conflicts on the candidate `data` (JSONB passthrough):
 *
 *   data._conflicts[attr] = { value, source }[]   -- competing PRESENT values,
 *                                                     one entry per distinct
 *                                                     value across sources.
 *
 * For each UNRESOLVED conflicted attribute this modal shows every competing
 * value beside its contributing source and offers a single chooser. On confirm
 * the parent (`DiscoveryCandidateTable`) writes, per chosen attribute:
 *   - data._conflictResolutions[attr] = { chosenValue, chosenSource,
 *                                          resolvedBy, resolvedAt }
 *   - the canonical attribute slot (data[attr]) = chosenValue
 *   - clears data._conflicts[attr]
 *
 * SINGLE-conflict resolution only -- the within-session bulk-resolve-by-pattern
 * UX ("45 similar -- resolve all?") is OUT of Spec 0 (deferred to Spec 3). This
 * modal is purely UI + an `onResolve(selections)` callback; the parent owns the
 * candidate-state mutation so the conflict data model stays UI-decoupled and
 * reusable by Spec 3.
 *
 * Pattern source: `BulkFindingActionConfirmModal.tsx` (escape key + overlay
 * click + isOpen guard + header/content/footer layout + spinner-free confirm).
 */

import React, { useCallback, useEffect, useState } from 'react';
import styles from './ConflictResolutionModal.module.css';

/** One competing value for a conflicted attribute (mirrors `_conflicts[attr][]`). */
export interface ConflictOption {
  value: unknown;
  source: string;
}

/** A conflicted attribute and its competing options, as surfaced to the chooser. */
export interface ConflictEntry {
  attr: string;
  options: ConflictOption[];
}

/**
 * The reviewer's per-attribute choice. `optionIndex` indexes into the matching
 * `ConflictEntry.options`; absent (`undefined`) means the reviewer left that
 * attribute unresolved this round.
 */
export type ConflictSelections = Record<string, number | undefined>;

export interface ConflictResolutionModalProps {
  isOpen: boolean;
  /** The candidate's display name, echoed in the title. */
  candidateName: string;
  /** The unresolved conflicted attributes + their competing options. */
  conflicts: ConflictEntry[];
  onClose: () => void;
  /**
   * Fired on Confirm with the reviewer's chosen option index per attribute.
   * Only attributes with a chosen index are acted on by the parent; the parent
   * stamps the resolution + canonical slot and clears the conflict.
   */
  onResolve: (selections: ConflictSelections) => void;
}

/**
 * Render an arbitrary competing value as readable text. Strings pass through;
 * everything else is JSON-stringified so object/array media-type lists, headers,
 * etc. stay legible in the side-by-side cells.
 */
function renderValue(value: unknown): string {
  if (value === null || value === undefined) return '(empty)';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function ConflictResolutionModal({
  isOpen,
  candidateName,
  conflicts,
  onClose,
  onResolve,
}: ConflictResolutionModalProps) {
  const [selections, setSelections] = useState<ConflictSelections>({});

  // Reset selections whenever the modal transitions closed->open so a stale
  // choice from a previous open doesn't leak into the next candidate.
  useEffect(() => {
    if (isOpen) {
      setSelections({});
    }
  }, [isOpen]);

  // Escape-key dismiss (mirrors the BulkFindingActionConfirmModal pattern).
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose],
  );

  const handleSelect = useCallback((attr: string, optionIndex: number) => {
    setSelections((prev) => ({ ...prev, [attr]: optionIndex }));
  }, []);

  const handleConfirm = useCallback(() => {
    onResolve(selections);
  }, [onResolve, selections]);

  if (!isOpen) {
    return null;
  }

  // Confirm is enabled once at least one attribute has a chosen value -- a
  // single-conflict resolution is valid even when other attributes are left
  // for a later pass.
  const hasAnySelection = Object.values(selections).some(
    (v) => v !== undefined,
  );

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      data-testid="conflict-resolution-modal"
    >
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title} data-testid="conflict-resolution-title">
            Resolve conflicts -- {candidateName}
          </h2>
          <button
            className={styles.closeButton}
            onClick={onClose}
            title="Close"
            data-testid="conflict-resolution-close-button"
          >
            &times;
          </button>
        </div>

        <div className={styles.content}>
          <p className={styles.intro} data-testid="conflict-resolution-intro">
            Sources disagree on the values below. Pick the correct value for
            each attribute; your choice is recorded with its source and the
            conflict is cleared.
          </p>

          {conflicts.map((entry) => (
            <div
              key={entry.attr}
              className={styles.conflictBlock}
              data-testid={`conflict-block-${entry.attr}`}
            >
              <div className={styles.attrName}>{entry.attr}</div>
              <div className={styles.optionList}>
                {entry.options.map((option, index) => {
                  const selected = selections[entry.attr] === index;
                  return (
                    <button
                      key={`${entry.attr}-${index}`}
                      type="button"
                      className={`${styles.option} ${selected ? styles.optionSelected : ''}`}
                      aria-pressed={selected}
                      onClick={() => handleSelect(entry.attr, index)}
                      data-testid={`conflict-option-${entry.attr}-${index}`}
                    >
                      <span className={styles.optionValue}>
                        {renderValue(option.value)}
                      </span>
                      <span className={styles.optionSource}>
                        {option.source}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className={styles.footer}>
          <button
            className={styles.secondaryButton}
            onClick={onClose}
            data-testid="conflict-resolve-cancel"
          >
            Cancel
          </button>
          <button
            className={styles.primaryButton}
            onClick={handleConfirm}
            disabled={!hasAnySelection}
            title={
              hasAnySelection ? undefined : 'Select a value to resolve'
            }
            data-testid="conflict-resolve-confirm"
          >
            Resolve selected
          </button>
        </div>
      </div>
    </div>
  );
}
