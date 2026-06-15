/**
 * MigrationBookOfWorkSelectionControls
 *
 * Spec 2026-05-17 PM Migration Delivery Plan -- Task Group 12.
 *
 * Selection controls + save-mode buttons for the review workspace.
 * Per Q-16 `saveState` lives in **frontend state only** during review.
 * This component is pure presentational -- the parent (review workspace)
 * owns the `saveStateById` map and applies the transitions.
 *
 * Controls per spec.md:
 *   - Select all / Deselect all
 *   - Select subtree (when an item is focused)
 *   - Exclude selected / Include selected
 *   - Save All
 *   - Save Selected
 *   - Save High-Confidence Only
 *   - Save Ready-for-Spec Only
 *
 * Subtree-selection delegates to the parent because the parent already
 * owns the parent-child adjacency.
 */

import React from 'react';
import type { SaveToBacklogMode } from '../../../api/migrationBookOfWorkApi';
import styles from './MigrationBookOfWork.module.css';

export interface MigrationBookOfWorkSelectionControlsProps {
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onSelectSubtree: () => void;
  onExcludeSelected: () => void;
  onIncludeSelected: () => void;
  onSave: (mode: SaveToBacklogMode) => void;
  /** When true, the "Subtree" affordance is disabled (no focused item). */
  subtreeDisabled?: boolean;
  /** When true (e.g. archived draft), all action buttons are disabled. */
  readOnly?: boolean;
}

export const MigrationBookOfWorkSelectionControls: React.FC<
  MigrationBookOfWorkSelectionControlsProps
> = ({
  onSelectAll,
  onDeselectAll,
  onSelectSubtree,
  onExcludeSelected,
  onIncludeSelected,
  onSave,
  subtreeDisabled,
  readOnly,
}) => {
  const disabled = !!readOnly;
  return (
    <div className={styles.selectionControls} data-testid="selection-controls">
      <button
        type="button"
        className={styles.selectButton}
        onClick={onSelectAll}
        disabled={disabled}
        data-testid="select-all-button"
      >
        Select all
      </button>
      <button
        type="button"
        className={styles.selectButton}
        onClick={onDeselectAll}
        disabled={disabled}
        data-testid="deselect-all-button"
      >
        Deselect all
      </button>
      <button
        type="button"
        className={styles.selectButton}
        onClick={onSelectSubtree}
        disabled={disabled || !!subtreeDisabled}
        data-testid="select-subtree-button"
      >
        Select subtree
      </button>
      <button
        type="button"
        className={styles.selectButton}
        onClick={onExcludeSelected}
        disabled={disabled}
        data-testid="exclude-selected-button"
      >
        Exclude selected
      </button>
      <button
        type="button"
        className={styles.selectButton}
        onClick={onIncludeSelected}
        disabled={disabled}
        data-testid="include-selected-button"
      >
        Include selected
      </button>

      <span style={{ flex: 1 }} />

      <button
        type="button"
        className={`${styles.selectButton} ${styles.selectButtonPrimary}`}
        onClick={() => onSave('all')}
        disabled={disabled}
        data-testid="save-all-button"
      >
        Save all
      </button>
      <button
        type="button"
        className={`${styles.selectButton} ${styles.selectButtonPrimary}`}
        onClick={() => onSave('selected')}
        disabled={disabled}
        data-testid="save-selected-button"
      >
        Save selected
      </button>
      <button
        type="button"
        className={`${styles.selectButton} ${styles.selectButtonPrimary}`}
        onClick={() => onSave('high_confidence_only')}
        disabled={disabled}
        data-testid="save-high-confidence-button"
      >
        Save high-confidence only
      </button>
      <button
        type="button"
        className={`${styles.selectButton} ${styles.selectButtonPrimary}`}
        onClick={() => onSave('ready_for_spec_only')}
        disabled={disabled}
        data-testid="save-ready-for-spec-button"
      >
        Save ready-for-spec only
      </button>
    </div>
  );
};

export default MigrationBookOfWorkSelectionControls;
