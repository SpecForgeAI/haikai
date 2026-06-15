/**
 * NoProjectEmptyState Component
 *
 * Spec 2026-01-22: No-Database Mode Empty-State UX
 * Task Group 1: NoProjectEmptyState Component
 *
 * Updated for Spec 2026-01-22: Explicit Project Session API
 * Task Group 5: Import/Export Flow Routing
 * - Added isSessionMode prop for session-specific heading
 *
 * A reusable empty-state component displayed when:
 * - includeDatabase=false (no-DB mode)
 * - activeProject===null (no project loaded)
 *
 * Provides a user-friendly message and action buttons to import a project.
 */

import styles from './NoProjectEmptyState.module.css';

/**
 * Props for NoProjectEmptyState component
 *
 * Spec 2026-01-22: Explicit Project Session API
 * Added isSessionMode prop for session-specific heading text.
 */
export interface NoProjectEmptyStateProps {
  /** Handler to trigger Import JSON flow */
  onImportJson: () => void;
  /** Handler to trigger Import XLSX flow */
  onImportXlsx: () => void;
  /**
   * Spec 2026-01-22: Explicit Project Session API
   * When true, displays "No project loaded in this session" instead of "No project loaded"
   * Defaults to false for backwards compatibility.
   */
  isSessionMode?: boolean;
}

/**
 * NoProjectEmptyState Component
 *
 * Displays a centered empty-state layout with:
 * - "No project loaded" heading (or "No project loaded in this session" if isSessionMode)
 * - Sub-text explaining what to do
 * - Import JSON button (primary action)
 * - Import XLSX button (secondary action)
 *
 * @param onImportJson - Handler to trigger Import JSON flow
 * @param onImportXlsx - Handler to trigger Import XLSX flow
 * @param isSessionMode - Whether to show session-specific heading
 */
export function NoProjectEmptyState({
  onImportJson,
  onImportXlsx,
  isSessionMode = false,
}: NoProjectEmptyStateProps) {
  return (
    <div className={styles.container} data-testid="no-project-empty-state">
      <h2 className={styles.heading} data-testid="empty-state-heading">
        No product loaded{isSessionMode ? ' in this session' : ''}
      </h2>
      <p className={styles.subtext} data-testid="empty-state-subtext">
        Import a product snapshot to begin working.
      </p>
      <div className={styles.buttonContainer}>
        <button
          className={styles.primaryButton}
          onClick={onImportJson}
          aria-label="Import product from JSON file"
          data-testid="import-json-button"
        >
          Import JSON
        </button>
        <button
          className={styles.secondaryButton}
          onClick={onImportXlsx}
          aria-label="Import product from Excel file"
          data-testid="import-xlsx-button"
        >
          Import XLSX
        </button>
      </div>
    </div>
  );
}
