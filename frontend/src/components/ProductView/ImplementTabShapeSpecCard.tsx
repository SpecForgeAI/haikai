/**
 * ImplementTabShapeSpecCard
 *
 * Spec: 2026-05-19 PM Migration Shape-Spec Batch Generation
 * Task Group 12 - WorkItem Implement-tab integration.
 *
 * Renders the "Generated shape-spec available" chip + stored-spec display
 * on the WorkItem Implement tab when a spec-generation row exists for the
 * WorkItem (R-9). The chip is sourced by querying the existing per-WorkItem
 * spec-generation endpoint:
 *
 *   GET /api/projects/{projectId}/work-items/{workItemId}/spec-generations
 *
 * Behaviour:
 *   - Mount-effect fetches the per-WorkItem rows. When the response is
 *     non-empty, the card mounts; otherwise it renders nothing (so the
 *     Implement tab is unchanged for WorkItems with no generated spec).
 *   - The chip itself is read-only (text + colour); a sibling drill-back
 *     button surfaces the workspace drawer for this WorkItem.
 *   - The inline display includes status + confidence indicators and the
 *     full spec text with a copy-to-clipboard button.
 *
 * Constraints (per tasks.md line 553-554):
 *   - NO new field on `WorkItemEntity` (R-9). The chip is driven entirely by
 *     the spec-generation rows endpoint, not by a denormalised flag on the
 *     work item itself.
 *   - The regenerate affordance is intentionally OMITTED here. The existing
 *     Implement-flow does not have a regenerate affordance for shape-specs,
 *     and tasks.md says "defer per tasks.md line 553" until that flow
 *     supports one. Users wanting to regenerate drill back to the workspace
 *     drawer which exposes the regenerate action.
 *
 * Implementation-Ready Migration Spec Generation (2026-06-14, Spec 1 of 4),
 * Task Group 4: mirrors the StoryResultDrawer review tiles on the Implement
 * tab so a reviewer sees readiness here too -- READ-ONLY scope-in/out +
 * acceptance criteria (derived from the combined spec text) and the
 * unit/functional Test Pack (from `structuredTestsJson`), alongside the
 * existing status + confidence chips. Editing remains combined-spec-text-only
 * (D7); the tiles are read-only and MAY drift from a manually-edited body.
 *
 * Styling notes:
 *   - Phase 1c (2026-07-20): the standalone spec-generation workspace was
 *     removed; its stylesheet moved here as
 *     `ImplementTabShapeSpecCard.module.css` (this card is its last consumer).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchSpecGenerationsForWorkItem,
  type SpecGenerationRow,
  type SpecGenerationStatus,
  type SpecGenerationConfidence,
} from '../../api/specGenerationApi';
import {
  extractSpecSection,
  toStructuredTestTiles,
  testTypeLabel,
  SCOPE_IN_ALIASES,
  SCOPE_OUT_ALIASES,
  ACCEPTANCE_CRITERIA_ALIASES,
} from '../../utils/migrationSpecSection';
import styles from './ImplementTabShapeSpecCard.module.css';

// ============================================================================
// Label helpers (mirrored from BatchResultsTable / StoryResultDrawer)
// ============================================================================

function statusLabel(s: SpecGenerationStatus): string {
  switch (s) {
    case 'not_attempted':
      return 'Not attempted';
    case 'generated':
      return 'Generated';
    case 'generated_with_warnings':
      return 'Generated with warnings';
    case 'insufficient_context':
      return 'Insufficient context';
    case 'failed':
      return 'Failed';
    case 'skipped_blocked':
      return 'Skipped (blocked)';
    default:
      return s;
  }
}

function statusChipClass(s: SpecGenerationStatus): string {
  switch (s) {
    case 'generated':
      return styles.statusGenerated;
    case 'generated_with_warnings':
      return styles.statusGeneratedWithWarnings;
    case 'insufficient_context':
      return styles.statusInsufficientContext;
    case 'failed':
      return styles.statusFailed;
    case 'skipped_blocked':
      return styles.statusSkippedBlocked;
    case 'not_attempted':
    default:
      return styles.statusNotAttempted;
  }
}

function confidenceLabel(c: SpecGenerationConfidence | null): string {
  if (!c) return '-';
  switch (c) {
    case 'high':
      return 'High';
    case 'medium':
      return 'Medium';
    case 'low':
      return 'Low';
  }
}

function confidenceChipClass(c: SpecGenerationConfidence | null): string {
  switch (c) {
    case 'high':
      return styles.confidenceHigh;
    case 'medium':
      return styles.confidenceMedium;
    case 'low':
      return styles.confidenceLow;
    default:
      return styles.statusNotAttempted;
  }
}

// ============================================================================
// Drill-back callback shape
// ============================================================================

export interface DrillBackInput {
  workItemId: string;
  /**
   * The bookOfWorkId of the spec-generation row. Callers use this to route
   * to the correct migration-book-of-work-scoped workspace surface. May be
   * null when the row is missing the field (defensive - production rows
   * always carry it).
   */
  bookOfWorkId: string | null;
}

// ============================================================================
// Component
// ============================================================================

export interface ImplementTabShapeSpecCardProps {
  projectId: string;
  workItemId: string;
  /**
   * Invoked when the user clicks "Open in spec workspace". The caller is
   * responsible for navigating to the workspace route with a `workItemId`
   * query param that causes the workspace to auto-open the story result
   * drawer (see `SpecGenerationWorkspace.initialDrawerWorkItemId`).
   */
  onDrillBackToWorkspace?: (input: DrillBackInput) => void;
  /**
   * Test seam: when provided, the component uses this fetcher instead of
   * the default `fetchSpecGenerationsForWorkItem`.
   */
  fetchRows?: typeof fetchSpecGenerationsForWorkItem;
}

export function ImplementTabShapeSpecCard({
  projectId,
  workItemId,
  onDrillBackToWorkspace,
  fetchRows = fetchSpecGenerationsForWorkItem,
}: ImplementTabShapeSpecCardProps) {
  const [row, setRow] = useState<SpecGenerationRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchRows(projectId, workItemId)
      .then((rows) => {
        if (cancelled) return;
        // Spec text uses the first row (today the relation is 1:1 per
        // WorkItem; future regeneration history may surface a list).
        setRow(rows.length > 0 ? rows[0] : null);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : 'Failed to load spec-generation';
        setError(message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, workItemId, fetchRows]);

  const handleCopy = useCallback(async () => {
    if (!row?.generatedSpecText) return;
    try {
      await navigator.clipboard.writeText(row.generatedSpecText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Silently swallow - the user can still copy from the visible pre block.
    }
  }, [row?.generatedSpecText]);

  const handleDrillBack = useCallback(() => {
    if (!onDrillBackToWorkspace || !row) return;
    onDrillBackToWorkspace({
      workItemId,
      bookOfWorkId: row.bookOfWorkId ?? null,
    });
  }, [onDrillBackToWorkspace, row, workItemId]);

  // Read-only review tiles (Implementation-Ready Migration Spec Generation,
  // Task Group 4). Mirror the drawer: scope-in/out + acceptance criteria are
  // DERIVED from the combined spec text; the Test Pack is sourced from the
  // persisted `structuredTestsJson`. All read-only; may drift from edits (D7).
  const scopeIn = useMemo(
    () => extractSpecSection(row?.generatedSpecText, SCOPE_IN_ALIASES),
    [row?.generatedSpecText],
  );
  const scopeOut = useMemo(
    () => extractSpecSection(row?.generatedSpecText, SCOPE_OUT_ALIASES),
    [row?.generatedSpecText],
  );
  const acceptanceCriteria = useMemo(
    () =>
      extractSpecSection(row?.generatedSpecText, ACCEPTANCE_CRITERIA_ALIASES),
    [row?.generatedSpecText],
  );
  const testPack = useMemo(
    () => toStructuredTestTiles(row?.structuredTestsJson),
    [row?.structuredTestsJson],
  );

  // R-9: the card renders nothing when no generation row exists for this
  // WorkItem (the Implement tab is unchanged for WorkItems with no spec).
  if (loading || error || !row) {
    return null;
  }

  return (
    <section
      className={styles.implementSpecCard}
      data-testid="msg-implement-spec-card"
      aria-label="Generated shape-spec for this work item"
    >
      <header className={styles.implementSpecHeader}>
        <div className={styles.implementSpecHeaderLeft}>
          <span
            className={styles.implementSpecChip}
            data-testid="msg-implement-spec-card-chip"
          >
            Generated shape-spec available
          </span>
          <span
            className={`${styles.breakdownChip} ${statusChipClass(row.status)}`}
            data-testid="msg-implement-spec-card-status"
          >
            {statusLabel(row.status)}
          </span>
          <span
            className={`${styles.breakdownChip} ${confidenceChipClass(
              row.confidence,
            )}`}
            data-testid="msg-implement-spec-card-confidence"
          >
            Confidence: {confidenceLabel(row.confidence)}
          </span>
        </div>
        <div className={styles.implementSpecHeaderLeft}>
          {row.generatedSpecText && (
            <button
              type="button"
              className={`${styles.button} ${styles.buttonSecondary}`}
              onClick={handleCopy}
              data-testid="msg-implement-spec-card-copy"
            >
              {copied ? 'Copied' : 'Copy to clipboard'}
            </button>
          )}
          {onDrillBackToWorkspace && (
            <button
              type="button"
              className={`${styles.button} ${styles.buttonSecondary}`}
              onClick={handleDrillBack}
              data-testid="msg-implement-spec-card-drill-back"
            >
              Open in spec workspace
            </button>
          )}
        </div>
      </header>

      {/* Read-only review tiles (scope / AC / Test Pack). */}
      {scopeIn.length > 0 && (
        <div className={styles.drawerSection}>
          <h4 className={styles.drawerSectionTitle}>Scope in</h4>
          <ul
            className={styles.drawerList}
            data-testid="msg-implement-spec-card-scope-in"
          >
            {scopeIn.map((item, idx) => (
              <li key={idx}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {scopeOut.length > 0 && (
        <div className={styles.drawerSection}>
          <h4 className={styles.drawerSectionTitle}>Scope out</h4>
          <ul
            className={styles.drawerList}
            data-testid="msg-implement-spec-card-scope-out"
          >
            {scopeOut.map((item, idx) => (
              <li key={idx}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {acceptanceCriteria.length > 0 && (
        <div className={styles.drawerSection}>
          <h4 className={styles.drawerSectionTitle}>Acceptance criteria</h4>
          <ul
            className={styles.drawerList}
            data-testid="msg-implement-spec-card-acceptance-criteria"
          >
            {acceptanceCriteria.map((item, idx) => (
              <li key={idx}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {testPack.length > 0 && (
        <div className={styles.drawerSection}>
          <h4 className={styles.drawerSectionTitle}>
            Test pack ({testPack.length})
          </h4>
          <ul
            className={styles.drawerList}
            data-testid="msg-implement-spec-card-test-pack"
          >
            {testPack.map((t, idx) => (
              <li key={idx}>
                <span className={styles.breakdownChip}>
                  {testTypeLabel(t.type)}
                </span>{' '}
                <strong>{t.title}</strong>
                {t.description ? ` - ${t.description}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {row.generatedSpecText ? (
        <pre
          className={styles.implementSpecPre}
          data-testid="msg-implement-spec-card-spec-text"
        >
          {row.generatedSpecText}
        </pre>
      ) : (
        <p
          className={styles.subtle}
          data-testid="msg-implement-spec-card-no-spec"
        >
          No spec text was generated on the most recent attempt. Use the spec
          workspace for details.
        </p>
      )}
    </section>
  );
}

export default ImplementTabShapeSpecCard;
