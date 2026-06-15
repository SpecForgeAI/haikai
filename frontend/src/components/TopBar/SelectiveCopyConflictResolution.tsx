/**
 * SelectiveCopyConflictResolution
 *
 * Spec 2026-05-01 Multi-Architecture Selective Cross-Architecture Copy
 * (Spec #7) -- Task Group 8
 *
 * Pure presentation component that renders the preflight summary, the
 * auto-included list, and the per-conflict resolution UI for the Selective
 * Copy wizard's resolution step.
 *
 * Behaviour overview:
 *   - Top section renders the four summary stats from the preflight response
 *     (`Total selected | Conflicts | Auto-included | Will copy`).
 *   - When `conflicts.length > 10` a soft banner renders above the conflict
 *     list with the spec'd copy. The banner is dismissible (local component
 *     state) and informational only -- it does NOT block the commit
 *     (safety properties (i) + (j)). Dismissal is intentionally local to
 *     this render: if the conflict count drops to <= 10 and back above
 *     after a re-preflight, the banner reappears so the user is reminded.
 *   - Auto-included section is collapsible and rendered above the conflict
 *     list so nothing is hidden from the user. Default expanded when the
 *     list is non-empty, collapsed when empty.
 *   - Conflict header strip provides three bulk-action buttons --
 *     `Skip all`, `Overwrite all`, `Duplicate all` -- that overwrite every
 *     row's resolution in the emitted map.
 *   - Per-row: element name + type + conflict reason + a three-radio
 *     `Skip / Overwrite / Duplicate` group, bound to the per-element entry
 *     in the `resolutions` map. Changing one row's radio mutates only that
 *     row's entry (other rows keep their current values, including any
 *     prior bulk default).
 *
 * Default-Skip behaviour:
 *   On first transition to this step the wizard is responsible for
 *   initialising the `resolutions` prop with `skip` for every conflict in
 *   the preflight response (safety property (i)). The wizard layer owns
 *   the source of truth for the resolution state so the commit payload
 *   stays in sync with whatever the user sees here.
 *
 * No API calls, no React Context dependencies -- this component is purely
 * presentational and is testable in isolation per the spec.
 */

import { useMemo, useState } from 'react';
import {
  SelectiveCopyAutoIncluded,
  SelectiveCopyConflict,
  SelectiveCopyPreflightSummary,
} from '../../api/architecturesApi';
import styles from './SelectiveCopyConflictResolution.module.css';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type ResolutionAction = 'skip' | 'overwrite' | 'duplicate';

export interface SelectiveCopyConflictResolutionProps {
  /** Conflict rows from the most recent preflight response. */
  conflicts: SelectiveCopyConflict[];
  /**
   * Auto-included elements from the most recent preflight response. Rendered
   * in their own labelled group above the conflict list. These rows have no
   * resolution radios -- they are inserted verbatim with source ids preserved
   * (per the spec).
   */
  autoIncluded: SelectiveCopyAutoIncluded[];
  /** Aggregate counts surfaced in the summary header. */
  summary: SelectiveCopyPreflightSummary;
  /**
   * The current resolution map keyed by `elementId`. The wizard is
   * responsible for initialising this on first transition with `skip` for
   * every conflict (safety property (i)).
   */
  resolutions: Record<string, ResolutionAction>;
  /**
   * Called whenever the user changes any resolution -- bulk action or
   * per-row radio. Receives a brand-new object so the wizard can rely on
   * referential inequality to trigger downstream effects.
   */
  onResolutionsChange: (resolutions: Record<string, ResolutionAction>) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MANY_CONFLICTS_THRESHOLD = 10;

const ACTIONS: ResolutionAction[] = ['skip', 'overwrite', 'duplicate'];

const ACTION_LABEL: Record<ResolutionAction, string> = {
  skip: 'Skip',
  overwrite: 'Overwrite',
  duplicate: 'Duplicate',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SelectiveCopyConflictResolution({
  conflicts,
  autoIncluded,
  summary,
  resolutions,
  onResolutionsChange,
}: SelectiveCopyConflictResolutionProps): JSX.Element {
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [autoExpanded, setAutoExpanded] = useState<boolean>(autoIncluded.length > 0);

  const conflictCount = conflicts.length;
  const showBanner = conflictCount > MANY_CONFLICTS_THRESHOLD && !bannerDismissed;

  // Stable lookup of conflicts by id so per-row updates don't iterate.
  const conflictIds = useMemo(() => conflicts.map((c) => c.elementId), [conflicts]);

  // ----- Mutations -----

  /** Apply one action to every conflict row. */
  const handleBulkAction = (action: ResolutionAction) => {
    const next: Record<string, ResolutionAction> = { ...resolutions };
    for (const id of conflictIds) {
      next[id] = action;
    }
    onResolutionsChange(next);
  };

  /** Update one row's resolution -- other rows untouched. */
  const handleRowChange = (elementId: string, action: ResolutionAction) => {
    const next: Record<string, ResolutionAction> = { ...resolutions, [elementId]: action };
    onResolutionsChange(next);
  };

  // ----- Render -----

  return (
    <div className={styles.root} data-testid="selective-copy-conflict-resolution">
      {/* ----- Summary stats ----- */}
      <div className={styles.summary} data-testid="selective-copy-resolution-summary">
        <span className={styles.summaryItem} data-testid="selective-copy-summary-total">
          <strong>Total selected:</strong> {summary.totalSelected}
        </span>
        <span className={styles.summaryDivider} aria-hidden="true">
          |
        </span>
        <span className={styles.summaryItem} data-testid="selective-copy-summary-conflicts">
          <strong>Conflicts:</strong> {summary.conflictCount}
        </span>
        <span className={styles.summaryDivider} aria-hidden="true">
          |
        </span>
        <span className={styles.summaryItem} data-testid="selective-copy-summary-auto-included">
          <strong>Auto-included:</strong> {summary.autoIncludedCount}
        </span>
        <span className={styles.summaryDivider} aria-hidden="true">
          |
        </span>
        <span className={styles.summaryItem} data-testid="selective-copy-summary-will-copy">
          <strong>Will copy:</strong> {summary.willCopyCount}
        </span>
      </div>

      {/* ----- Many-conflicts soft banner ----- */}
      {showBanner ? (
        <div
          className={styles.banner}
          role="alert"
          data-testid="selective-copy-many-conflicts-banner"
        >
          <span className={styles.bannerText}>
            Many conflicts detected ({conflictCount}). Consider cancelling and refining your
            selection &mdash; this often means the target already overlaps significantly with the
            source.
          </span>
          <button
            type="button"
            className={styles.bannerDismiss}
            onClick={() => setBannerDismissed(true)}
            data-testid="selective-copy-many-conflicts-banner-dismiss"
            aria-label="Dismiss many-conflicts banner"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {/* ----- Auto-included section ----- */}
      {autoIncluded.length > 0 ? (
        <section className={styles.section} data-testid="selective-copy-auto-included-section">
          <header className={styles.sectionHeader}>
            <button
              type="button"
              className={styles.toggleButton}
              onClick={() => setAutoExpanded((v) => !v)}
              aria-expanded={autoExpanded}
              data-testid="selective-copy-auto-included-toggle"
            >
              {autoExpanded ? '\u25BE' : '\u25B8'}
            </button>
            <span className={styles.sectionTitle}>
              Auto-included elements ({autoIncluded.length})
            </span>
            <span className={styles.sectionHint}>
              Inserted verbatim &mdash; no resolution required.
            </span>
          </header>
          {autoExpanded ? (
            <ul className={styles.autoList} data-testid="selective-copy-auto-included-list">
              {autoIncluded.map((a) => (
                <li
                  key={a.elementId}
                  className={styles.autoRow}
                  data-testid={`selective-copy-auto-included-row-${a.elementId}`}
                >
                  <span className={styles.elementName}>{a.name}</span>
                  <span className={styles.elementType}>{a.elementType}</span>
                  <span className={styles.includedBecause}>
                    Included because referenced by <em>{a.includedBecause}</em>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {/* ----- Conflict section ----- */}
      <section className={styles.section} data-testid="selective-copy-conflicts-section">
        <header className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>Conflicts ({conflictCount})</span>
          <div className={styles.bulkActions} role="group" aria-label="Bulk conflict actions">
            <button
              type="button"
              className={styles.bulkButton}
              onClick={() => handleBulkAction('skip')}
              disabled={conflictCount === 0}
              data-testid="selective-copy-bulk-skip"
            >
              Skip all
            </button>
            <button
              type="button"
              className={styles.bulkButton}
              onClick={() => handleBulkAction('overwrite')}
              disabled={conflictCount === 0}
              data-testid="selective-copy-bulk-overwrite"
            >
              Overwrite all
            </button>
            <button
              type="button"
              className={styles.bulkButton}
              onClick={() => handleBulkAction('duplicate')}
              disabled={conflictCount === 0}
              data-testid="selective-copy-bulk-duplicate"
            >
              Duplicate all
            </button>
          </div>
        </header>

        {conflictCount === 0 ? (
          <div className={styles.emptyState} data-testid="selective-copy-conflicts-empty">
            No conflicts.
          </div>
        ) : (
          <ul className={styles.conflictList} data-testid="selective-copy-conflicts-list">
            {conflicts.map((c) => {
              const action = resolutions[c.elementId] ?? 'skip';
              return (
                <li
                  key={c.elementId}
                  className={styles.conflictRow}
                  data-testid={`selective-copy-conflict-row-${c.elementId}`}
                >
                  <div className={styles.conflictMeta}>
                    <span
                      className={styles.elementName}
                      data-testid={`selective-copy-conflict-name-${c.elementId}`}
                    >
                      {c.name}
                    </span>
                    <span
                      className={styles.elementType}
                      data-testid={`selective-copy-conflict-type-${c.elementId}`}
                    >
                      {c.elementType}
                    </span>
                    <span
                      className={styles.conflictReason}
                      data-testid={`selective-copy-conflict-reason-${c.elementId}`}
                    >
                      {c.conflictReason === 'same_uuid'
                        ? 'Same UUID already in target'
                        : 'Missing reference'}
                    </span>
                  </div>
                  <div
                    className={styles.radioGroup}
                    role="radiogroup"
                    aria-label={`Resolution for ${c.name}`}
                  >
                    {ACTIONS.map((a) => (
                      <label
                        key={a}
                        className={styles.radioLabel}
                        data-testid={`selective-copy-conflict-radio-label-${c.elementId}-${a}`}
                      >
                        <input
                          type="radio"
                          name={`resolution-${c.elementId}`}
                          value={a}
                          checked={action === a}
                          onChange={() => handleRowChange(c.elementId, a)}
                          data-testid={`selective-copy-conflict-radio-${c.elementId}-${a}`}
                        />
                        <span>{ACTION_LABEL[a]}</span>
                      </label>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

export default SelectiveCopyConflictResolution;
