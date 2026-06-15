/**
 * FeatureHeader Component
 *
 * Spec 2026-01-22: Feature Shaping UI Consumes Planner JSON
 * Task Group 3: Create FeatureHeader Component
 *
 * A dark banner component that displays the feature title.
 * Used at the top of the Feature Definition panel.
 *
 * Spec 2026-01-23: Two-Flag Workflow State Machine
 * Task Group 2: Added isReadyForSpec prop and "Ready for Spec" badge
 *
 * Spec 2026-01-24: Implement Screen Change 1 - Remove RHS WorkItemSummaryPanel
 * Task Group 2: Epic Display in Feature Header
 * - Added epicName prop for displaying parent Epic
 * - Display format: "Epic: [name max 30 chars] -> Feature: [name]"
 * - Truncates epic name at 30 characters with ellipsis
 * - Epic display is read-only with no interactivity
 *
 * Features:
 * - Dark background with white text
 * - "Feature:" label followed by the title (or "Story:" for story items)
 * - Optional "Epic:" label when epicName is provided
 * - Optional "Feature:" breadcrumb segment when featureName is provided (story items)
 * - Handles empty/undefined titles gracefully
 * - Optional green badge when planner is ready for spec
 */

import styles from './FeatureHeader.module.css';

/**
 * Truncate a string to a maximum length with ellipsis.
 * Spec 2026-01-24: Task Group 2 - Epic name truncation
 *
 * @param str - The string to truncate
 * @param maxLength - Maximum length (default 30)
 * @returns Truncated string with "..." if it exceeds maxLength
 */
function truncateWithEllipsis(str: string, maxLength = 30): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

/**
 * Props interface for FeatureHeader
 *
 * Spec 2026-01-23: Added isReadyForSpec for Two-Flag Workflow
 * Spec 2026-01-24: Added epicName for Epic display
 */
export interface FeatureHeaderProps {
  /** Feature title to display */
  title: string;
  /**
   * Spec 2026-01-24: Optional parent Epic name.
   * When provided, displays "Epic: [name max 30 chars] -> Feature: [title]"
   * Truncated with ellipsis if longer than 30 characters.
   */
  epicName?: string;
  /** Optional parent Feature name (when working on a Story) */
  featureName?: string;
  /** Work item type (e.g. 'FEATURE', 'STORY') — determines the final label */
  workItemType?: string;
  /**
   * Spec 2026-01-23: Two-Flag Workflow State Machine
   * Optional flag indicating planner has sufficient information for spec.
   * When true, displays a green "Ready for Spec" badge.
   */
  isReadyForSpec?: boolean;
  /** Inline refinement progress label (e.g. "Refining story 1 of 2") */
  refinementProgressLabel?: string;
  /** When true, overrides the final breadcrumb segment to "Tests (Integration/E2E)" */
  isHolisticReview?: boolean;
}

/**
 * FeatureHeader Component
 *
 * Renders a dark banner with the work item type label and title.
 * For FEATURE: "Epic: X -> Feature: Y"
 * For STORY:   "Epic: X -> Feature: Y -> Story: Z"
 * Optionally displays a "Ready for Spec" badge when isReadyForSpec is true.
 */
export function FeatureHeader({ title, epicName, featureName, workItemType, isReadyForSpec, refinementProgressLabel, isHolisticReview }: FeatureHeaderProps) {
  const isStory = workItemType?.toUpperCase() === 'STORY';

  // During holistic review, show: Epic -> Feature -> Tests (Integration/E2E)
  if (isHolisticReview) {
    return (
      <div className={styles.featureHeader} data-testid="feature-header">
        {epicName && (
          <>
            <span className={styles.epicLabel}>Epic:</span>
            <span className={styles.epicName} data-testid="epic-name">
              {truncateWithEllipsis(epicName)}
            </span>
            <span className={styles.arrowSeparator} data-testid="arrow-separator">
              -&gt;
            </span>
          </>
        )}
        <span className={styles.featureLabel}>Feature:</span>
        <span className={styles.epicName}>
          {truncateWithEllipsis(title)}
        </span>
        <span className={styles.arrowSeparator}>
          -&gt;
        </span>
        <span className={styles.featureLabel}>Tests</span>
        <span className={styles.featureTitle}>(Integration/E2E)</span>
        {refinementProgressLabel && (
          <span className={styles.progressLabel} data-testid="refinement-progress-label">
            ({refinementProgressLabel})
          </span>
        )}
      </div>
    );
  }

  const itemLabel = isStory ? 'Story:' : 'Feature:';

  return (
    <div className={styles.featureHeader} data-testid="feature-header">
      {epicName && (
        <>
          <span className={styles.epicLabel}>Epic:</span>
          <span className={styles.epicName} data-testid="epic-name">
            {truncateWithEllipsis(epicName)}
          </span>
          <span className={styles.arrowSeparator} data-testid="arrow-separator">
            -&gt;
          </span>
        </>
      )}
      {isStory && featureName && (
        <>
          <span className={styles.featureLabel}>Feature:</span>
          <span className={styles.epicName}>
            {truncateWithEllipsis(featureName)}
          </span>
          <span className={styles.arrowSeparator}>
            -&gt;
          </span>
        </>
      )}
      <span className={styles.featureLabel}>{itemLabel}</span>
      <span className={styles.featureTitle}>{title}</span>
      {refinementProgressLabel && (
        <span className={styles.progressLabel} data-testid="refinement-progress-label">
          ({refinementProgressLabel})
        </span>
      )}
      {isReadyForSpec && (
        <span className={styles.readyBadge} data-testid="ready-for-spec-badge">
          Ready for Spec
        </span>
      )}
    </div>
  );
}
