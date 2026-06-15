/**
 * MigrationDeliverySectionRetryPlaceholder
 *
 * Spec: 2026-05-19 Migration Delivery Progress and Evidence Tracking
 * Task Group 12 -- Partial roll-up rendering + warnings placeholders.
 *
 * Renders the inline "Could not load X -- retry" placeholder used when a
 * subsection of the dashboard payload is named in `dashboard.warnings[]`
 * (Q-11, AC 16). One placeholder substitutes for the corresponding section
 * in the dashboard while the rest of the page continues to render.
 *
 * Behaviour:
 *   - "Could not load {sectionName} -- retry" is the literal copy spec.md
 *     mandates (test 33). The {sectionName} prop is rendered verbatim so the
 *     caller controls the user-facing wording (e.g. "workstream progress",
 *     "needs-attention panel").
 *   - Clicking the retry button invokes the `onRetry` callback. The parent
 *     dashboard wires this to its `loadDashboard()` which re-fires
 *     `getMigrationDeliveryDashboard(projectId, bookId)` and re-stamps the
 *     "Last refreshed" label (Q-8). The placeholder itself owns no state.
 *
 * Visual treatment matches the existing `.placeholder` rule in
 * `MigrationDeliveryDashboard.module.css` (dashed border, muted background)
 * plus a secondary-action retry button.
 *
 * Conventions:
 *   - Stateless functional component; no internal store/state.
 *   - All field access on the dashboard payload elsewhere uses snake_case;
 *     this component does not touch the payload directly so the rule is
 *     not exercised here.
 */

import React from 'react';
import styles from './MigrationDeliveryDashboard.module.css';

export interface MigrationDeliverySectionRetryPlaceholderProps {
  /**
   * Human-readable section label rendered into the placeholder copy.
   * Rendered verbatim into "Could not load {sectionName} -- retry".
   */
  sectionName: string;
  /**
   * Invoked when the user clicks the retry button. The parent dashboard
   * triggers a full `getMigrationDeliveryDashboard` re-fetch in response.
   */
  onRetry: () => void;
  /**
   * Optional test id override. Defaults to "mdd-section-retry-placeholder";
   * callers usually pass a section-specific id (e.g.
   * "mdd-workstream-strip-placeholder") so multiple placeholders on the
   * same page can be queried independently.
   */
  testId?: string;
}

export const MigrationDeliverySectionRetryPlaceholder: React.FC<
  MigrationDeliverySectionRetryPlaceholderProps
> = ({ sectionName, onRetry, testId }) => {
  return (
    <div
      className={styles.placeholder}
      role="alert"
      data-testid={testId ?? 'mdd-section-retry-placeholder'}
    >
      <span className={styles.placeholderText}>
        {`Could not load ${sectionName} -- `}
      </span>
      <button
        type="button"
        className={styles.placeholderRetryButton}
        onClick={onRetry}
        data-testid={`${testId ?? 'mdd-section-retry-placeholder'}-button`}
      >
        retry
      </button>
    </div>
  );
};

export default MigrationDeliverySectionRetryPlaceholder;
