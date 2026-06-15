/**
 * MigrationDeliveryEpicDecisionsSummary
 *
 * Spec: 2026-05-20 Cross-Story Context Injection -- Task Group 7.3
 *
 * Read-only collapsed summary of epic captured decisions surfaced on the
 * delivery dashboard. The full edit panel lives on the epic detail page
 * (Task Group 8); this summary just shows counts + status mix and a link
 * back to the epic detail page for editing.
 *
 * The dashboard owns the data; this component is stateless. When the
 * caller hasn't fetched any epic decisions yet, the summary renders an
 * empty-state hint inviting the user to run a batch (auto-seeding happens
 * on pass-1 persistence).
 */

import React from 'react';
import styles from './MigrationDeliveryDashboard.module.css';

// ============================================================================
// Public types
// ============================================================================

export type EpicCapturedDecisionStatus = 'draft' | 'confirmed' | 'superseded';

export interface EpicCapturedDecisionsSummaryByEpic {
  epicWorkItemId: string;
  epicTitle: string;
  draftCount: number;
  confirmedCount: number;
  supersededCount: number;
  /** Optional href the parent route owns; clicking the link navigates here. */
  editHref?: string;
}

// ============================================================================
// Props
// ============================================================================

export interface MigrationDeliveryEpicDecisionsSummaryProps {
  /**
   * One entry per epic. The dashboard derives this from the most recent
   * batch result (auto-seeded `auto_extracted` rows) plus any rows already
   * persisted from a prior batch.
   */
  summaries: ReadonlyArray<EpicCapturedDecisionsSummaryByEpic>;
  /**
   * Invoked when the user clicks an epic's "Edit decisions" link. The
   * parent route owns the navigation push.
   */
  onOpenEpicDetail?: (epicWorkItemId: string) => void;
}

// ============================================================================
// Component
// ============================================================================

export const MigrationDeliveryEpicDecisionsSummary: React.FC<
  MigrationDeliveryEpicDecisionsSummaryProps
> = ({ summaries, onOpenEpicDetail }) => {
  return (
    <section
      className={styles.epicDecisionsSummarySection}
      data-testid="mdd-epic-decisions-summary"
    >
      <h2 className={styles.sectionTitle}>Epic captured decisions</h2>
      {summaries.length === 0 ? (
        <p
          className={styles.emptyPanel}
          data-testid="mdd-epic-decisions-summary-empty"
        >
          No epic captured decisions yet. They are auto-seeded from the
          first batch's parser-extracted decisions.
        </p>
      ) : (
        <ul
          className={styles.epicDecisionsSummaryList}
          data-testid="mdd-epic-decisions-summary-list"
        >
          {summaries.map((s) => {
            const total = s.draftCount + s.confirmedCount + s.supersededCount;
            return (
              <li
                key={s.epicWorkItemId}
                className={styles.epicDecisionsSummaryItem}
                data-testid={`mdd-epic-decisions-summary-item-${s.epicWorkItemId}`}
              >
                <span
                  className={styles.epicDecisionsSummaryTitle}
                  data-testid={`mdd-epic-decisions-summary-item-${s.epicWorkItemId}-title`}
                >
                  {s.epicTitle}
                </span>
                <span
                  className={styles.epicDecisionsSummaryCounts}
                  data-testid={`mdd-epic-decisions-summary-item-${s.epicWorkItemId}-counts`}
                >
                  {total} total
                  {' -- '}
                  {s.confirmedCount} confirmed, {s.draftCount} draft,{' '}
                  {s.supersededCount} superseded
                </span>
                {(s.editHref || onOpenEpicDetail) && (
                  <button
                    type="button"
                    className={styles.headerNavLink}
                    data-testid={`mdd-epic-decisions-summary-item-${s.epicWorkItemId}-edit`}
                    onClick={(e) => {
                      e.preventDefault();
                      onOpenEpicDetail?.(s.epicWorkItemId);
                    }}
                  >
                    Edit
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

export default MigrationDeliveryEpicDecisionsSummary;
