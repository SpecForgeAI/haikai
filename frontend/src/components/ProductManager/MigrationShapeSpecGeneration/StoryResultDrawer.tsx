/**
 * StoryResultDrawer
 *
 * Spec: 2026-05-19 PM Migration Shape-Spec Batch Generation
 * Task Group 11 - Story result detail drawer.
 *
 * Right-hand side-panel drawer (480-560px wide, per A-8). Overlays the batch
 * results table. Dismissible via:
 *   - Esc key
 *   - Backdrop click
 *   - Explicit X close button
 *
 * Contents per spec.md UI surface 5:
 *   - Story description (title)
 *   - Predicted readiness
 *   - Actual status
 *   - Confidence
 *   - Generated spec text with a copy-to-clipboard button
 *   - missingInputs
 *   - warnings
 *   - evidence refs
 *   - focused-context refs
 *   - recommendedNextAction
 *   - Link to WorkItem
 *   - Link to Implement tab
 *
 * Manual-edit-protected confirm flow (acceptance signal 17): when the
 * gateway returns `errorMessage='manual_edit_protected'` on a regenerate
 * attempt, the drawer surfaces a confirm dialog. On confirm, the drawer
 * re-invokes the regenerate callback with `confirmOverwrite=true`.
 *
 * Implementation-Ready Migration Spec Generation (2026-06-14, Spec 1 of 4),
 * Task Group 4: adds READ-ONLY tiles for scope-in / scope-out / acceptance
 * criteria (derived from the combined spec text) and the unit/functional Test
 * Pack (from `structuredTestsJson`), plus a prominent `insufficient_context`
 * flag, so a reviewer can judge readiness. Editing stays combined-spec-text-
 * only via the existing `manualEditSpec` path (D7); the tiles are read-only and
 * MAY drift from the edited text (accepted v1).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  SpecGenerationRow,
  SpecGenerationStatus,
  SpecGenerationConfidence,
  SpecGenerationPredictedReadiness,
} from '../../../api/specGenerationApi';
import {
  extractSpecSection,
  toStructuredTestTiles,
  testTypeLabel,
  SCOPE_IN_ALIASES,
  SCOPE_OUT_ALIASES,
  ACCEPTANCE_CRITERIA_ALIASES,
} from '../../../utils/migrationSpecSection';
import styles from './MigrationShapeSpecGeneration.module.css';

// ============================================================================
// Label helpers (mirrored from BatchResultsTable for consistency)
// ============================================================================

function readinessLabel(
  r: SpecGenerationPredictedReadiness | null | undefined,
): string {
  switch (r) {
    case 'ready_for_spec':
      return 'Ready for spec';
    case 'needs_focused_context':
      return 'Needs focused context';
    case 'needs_user_decision':
      return 'Needs user decision';
    case 'blocked':
      return 'Blocked';
    default:
      return 'Unknown';
  }
}

function statusLabel(s: SpecGenerationStatus | null | undefined): string {
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
      return s ?? 'Unknown';
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

// ============================================================================
// Regenerate input shape - shared with the workspace shell
// ============================================================================

export interface RegenerateInput {
  workItemId: string;
  confirmOverwrite?: boolean;
}

// ============================================================================
// Component props
// ============================================================================

export interface StoryResultDrawerProps {
  /** The row whose detail is being displayed. */
  row: SpecGenerationRow;
  projectId: string;
  bookOfWorkId: string;
  /** Invoked when the drawer should close (X / Esc / backdrop). */
  onClose: () => void;
  /**
   * Invoked when the user clicks the regenerate action inside the drawer.
   * Must throw on failure; the drawer inspects thrown errors for the
   * `manual_edit_protected` sentinel and surfaces a confirm dialog when
   * detected (acceptance signal 17).
   */
  onRegenerate: (input: RegenerateInput) => Promise<unknown>;
  /**
   * Optional URL to the WorkItem detail surface. When provided, the drawer
   * renders a "Open work item" link.
   */
  workItemHref?: string;
  /**
   * Optional URL to the WorkItem Implement tab. When provided, the drawer
   * renders an "Open Implement tab" link.
   */
  implementTabHref?: string;
}

// ============================================================================
// Helpers
// ============================================================================

function describeMissingInput(item: Record<string, unknown>): string {
  // The fixture shape is `{ field, reason }` but the underlying type allows
  // any string-keyed map. We extract whichever recognised keys exist.
  const field = typeof item.field === 'string' ? item.field : null;
  const reason = typeof item.reason === 'string' ? item.reason : null;
  const description =
    typeof item.description === 'string' ? item.description : null;
  if (field && reason) return `${field}: ${reason}`;
  if (field && description) return `${field}: ${description}`;
  if (field) return field;
  if (reason) return reason;
  if (description) return description;
  // Fallback: serialise the entire entry so the user sees something useful.
  try {
    return JSON.stringify(item);
  } catch {
    return String(item);
  }
}

function describeWarning(item: Record<string, unknown>): string {
  const code = typeof item.code === 'string' ? item.code : null;
  const message = typeof item.message === 'string' ? item.message : null;
  if (code && message) return `${code}: ${message}`;
  if (message) return message;
  if (code) return code;
  try {
    return JSON.stringify(item);
  } catch {
    return String(item);
  }
}

function focusedContextRefsToList(
  refs: Record<string, unknown> | null,
): string[] {
  if (!refs) return [];
  const out: string[] = [];
  for (const [key, value] of Object.entries(refs)) {
    if (Array.isArray(value)) {
      for (const v of value) {
        out.push(`${key}: ${String(v)}`);
      }
    } else if (value !== null && value !== undefined) {
      out.push(`${key}: ${String(value)}`);
    }
  }
  return out;
}

// ============================================================================
// Component
// ============================================================================

export function StoryResultDrawer({
  row,
  onClose,
  onRegenerate,
  workItemHref,
  implementTabHref,
}: StoryResultDrawerProps) {
  const [copied, setCopied] = useState(false);
  const [regenerateError, setRegenerateError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [protectedDialogOpen, setProtectedDialogOpen] = useState(false);

  // ----- Esc-to-close ------------------------------------------------------
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        // Esc closes the drawer; if the protected-confirm dialog is open it
        // closes that instead (lighter "back out" semantics).
        if (protectedDialogOpen) {
          setProtectedDialogOpen(false);
        } else {
          onClose();
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, protectedDialogOpen]);

  // ----- Copy to clipboard --------------------------------------------------
  const handleCopySpec = useCallback(async () => {
    if (!row.generatedSpecText) return;
    try {
      await navigator.clipboard.writeText(row.generatedSpecText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Defensive: clipboard write can fail in restricted contexts. We
      // intentionally swallow the error - the user can manually copy from
      // the visible pre block.
    }
  }, [row.generatedSpecText]);

  // ----- Regenerate (with manual-edit-protected handling) ------------------
  const handleRegenerate = useCallback(
    async (opts: { confirmOverwrite: boolean }) => {
      if (!row.workItemId) return;
      setRegenerateError(null);
      setRegenerating(true);
      try {
        await onRegenerate({
          workItemId: row.workItemId,
          confirmOverwrite: opts.confirmOverwrite,
        });
        // On success, also close any open protected-confirm dialog.
        setProtectedDialogOpen(false);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Regenerate failed';
        // Acceptance signal 17: when the gateway returns the
        // manual_edit_protected sentinel, the drawer surfaces a confirm
        // dialog rather than treating it as a generic error.
        if (message.includes('manual_edit_protected')) {
          setProtectedDialogOpen(true);
        } else {
          setRegenerateError(message);
        }
      } finally {
        setRegenerating(false);
      }
    },
    [onRegenerate, row.workItemId],
  );

  // ----- Render -------------------------------------------------------------
  const missingInputs = row.missingInputs ?? [];
  const warnings = row.warnings ?? [];
  const evidenceRefs = row.evidenceRefs ?? [];
  const focusedContextRefs = focusedContextRefsToList(row.focusedContextRefs);

  // Read-only review tiles (Implementation-Ready Migration Spec Generation,
  // Task Group 4). Scope-in/out + acceptance criteria are DERIVED from the
  // combined spec text (they are not discrete AMS columns); the Test Pack is
  // sourced from the persisted `structuredTestsJson`. All are read-only and may
  // drift from a manually-edited combined spec text (D7).
  const scopeIn = useMemo(
    () => extractSpecSection(row.generatedSpecText, SCOPE_IN_ALIASES),
    [row.generatedSpecText],
  );
  const scopeOut = useMemo(
    () => extractSpecSection(row.generatedSpecText, SCOPE_OUT_ALIASES),
    [row.generatedSpecText],
  );
  const acceptanceCriteria = useMemo(
    () => extractSpecSection(row.generatedSpecText, ACCEPTANCE_CRITERIA_ALIASES),
    [row.generatedSpecText],
  );
  const testPack = useMemo(
    () => toStructuredTestTiles(row.structuredTestsJson),
    [row.structuredTestsJson],
  );
  const isInsufficient = row.status === 'insufficient_context';

  return (
    <div
      className={styles.drawerBackdrop}
      data-testid="msg-story-drawer-backdrop"
      onClick={(e) => {
        // Backdrop click closes only when the click is on the backdrop
        // itself (not on the drawer panel).
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        className={styles.drawer}
        data-testid="msg-story-drawer"
        role="dialog"
        aria-labelledby="msg-story-drawer-title"
        aria-modal="true"
      >
        {/* Header */}
        <header className={styles.drawerHeader}>
          <h2
            id="msg-story-drawer-title"
            data-testid="msg-story-drawer-title"
            className={styles.drawerTitle}
          >
            {row.storyTitle ?? row.workItemId ?? 'Story result'}
          </h2>
          <button
            type="button"
            className={styles.drawerCloseButton}
            data-testid="msg-story-drawer-close"
            onClick={onClose}
            aria-label="Close story result drawer"
          >
            X
          </button>
        </header>

        {/* Body */}
        <div className={styles.drawerBody}>
          {/* Status / readiness / confidence row */}
          <section className={styles.drawerSection}>
            <div className={styles.breakdownRow}>
              <span
                className={`${styles.breakdownChip} ${styles.readinessReady}`}
                data-testid="msg-story-drawer-predicted-readiness"
              >
                Predicted: {readinessLabel(row.predictedReadiness)}
              </span>
              <span
                className={styles.breakdownChip}
                data-testid="msg-story-drawer-status"
              >
                Actual: {statusLabel(row.status)}
              </span>
              <span
                className={styles.breakdownChip}
                data-testid="msg-story-drawer-confidence"
              >
                Confidence: {confidenceLabel(row.confidence)}
              </span>
            </div>
          </section>

          {/* Insufficient-context readiness flag (prominent gap signal). */}
          {isInsufficient && (
            <section className={styles.drawerSection}>
              <p
                className={styles.errorBanner}
                data-testid="msg-story-drawer-insufficient-flag"
              >
                Not ready to implement - insufficient context. Resolve the
                missing inputs below and regenerate; no implementation-ready
                spec was synthesised for this story.
              </p>
            </section>
          )}

          {/* Parent feature / workstream */}
          {(row.parentTitle || row.workstream) && (
            <section className={styles.drawerSection}>
              {row.parentTitle && (
                <p
                  className={styles.drawerSubtle}
                  data-testid="msg-story-drawer-parent"
                >
                  Parent: {row.parentTitle}
                </p>
              )}
              {row.workstream && (
                <p
                  className={styles.drawerSubtle}
                  data-testid="msg-story-drawer-workstream"
                >
                  Workstream: {row.workstream}
                </p>
              )}
            </section>
          )}

          {/* Scope-in tile (read-only, derived from the combined spec text). */}
          {scopeIn.length > 0 && (
            <section className={styles.drawerSection}>
              <h3 className={styles.drawerSectionTitle}>Scope in</h3>
              <ul
                className={styles.drawerList}
                data-testid="msg-story-drawer-scope-in"
              >
                {scopeIn.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </section>
          )}

          {/* Scope-out tile. */}
          {scopeOut.length > 0 && (
            <section className={styles.drawerSection}>
              <h3 className={styles.drawerSectionTitle}>Scope out</h3>
              <ul
                className={styles.drawerList}
                data-testid="msg-story-drawer-scope-out"
              >
                {scopeOut.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </section>
          )}

          {/* Acceptance-criteria tile. */}
          {acceptanceCriteria.length > 0 && (
            <section className={styles.drawerSection}>
              <h3 className={styles.drawerSectionTitle}>Acceptance criteria</h3>
              <ul
                className={styles.drawerList}
                data-testid="msg-story-drawer-acceptance-criteria"
              >
                {acceptanceCriteria.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </section>
          )}

          {/* Test Pack tile (read-only; sourced from structuredTestsJson). */}
          {testPack.length > 0 && (
            <section className={styles.drawerSection}>
              <h3 className={styles.drawerSectionTitle}>
                Test pack ({testPack.length})
              </h3>
              <ul
                className={styles.drawerList}
                data-testid="msg-story-drawer-test-pack"
              >
                {testPack.map((t, idx) => (
                  <li key={idx}>
                    <span
                      className={styles.breakdownChip}
                      data-testid="msg-story-drawer-test-type"
                    >
                      {testTypeLabel(t.type)}
                    </span>{' '}
                    <strong>{t.title}</strong>
                    {t.description ? ` - ${t.description}` : ''}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Generated spec text + copy button (only when present) */}
          {row.generatedSpecText ? (
            <section className={styles.drawerSection}>
              <div className={styles.drawerSectionHeader}>
                <h3 className={styles.drawerSectionTitle}>Generated spec</h3>
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonSecondary}`}
                  data-testid="msg-story-drawer-copy-spec"
                  onClick={handleCopySpec}
                >
                  {copied ? 'Copied' : 'Copy to clipboard'}
                </button>
              </div>
              <pre
                className={styles.drawerSpecPre}
                data-testid="msg-story-drawer-spec-text"
              >
                {row.generatedSpecText}
              </pre>
            </section>
          ) : (
            <section className={styles.drawerSection}>
              <p
                className={styles.drawerSubtle}
                data-testid="msg-story-drawer-no-spec"
              >
                No generated spec text - the story did not produce a
                spec on this attempt.
              </p>
            </section>
          )}

          {/* Missing inputs */}
          {missingInputs.length > 0 && (
            <section className={styles.drawerSection}>
              <h3 className={styles.drawerSectionTitle}>Missing inputs</h3>
              <ul
                className={styles.drawerList}
                data-testid="msg-story-drawer-missing-inputs"
              >
                {missingInputs.map((m, idx) => (
                  <li key={idx}>{describeMissingInput(m)}</li>
                ))}
              </ul>
            </section>
          )}

          {/* Warnings */}
          {warnings.length > 0 && (
            <section className={styles.drawerSection}>
              <h3 className={styles.drawerSectionTitle}>Warnings</h3>
              <ul
                className={styles.drawerList}
                data-testid="msg-story-drawer-warnings"
              >
                {warnings.map((w, idx) => (
                  <li key={idx}>{describeWarning(w)}</li>
                ))}
              </ul>
            </section>
          )}

          {/* Evidence refs */}
          {evidenceRefs.length > 0 && (
            <section className={styles.drawerSection}>
              <h3 className={styles.drawerSectionTitle}>Evidence references</h3>
              <ul
                className={styles.drawerList}
                data-testid="msg-story-drawer-evidence-refs"
              >
                {evidenceRefs.map((ref, idx) => (
                  <li key={idx}>{ref}</li>
                ))}
              </ul>
            </section>
          )}

          {/* Focused-context refs */}
          {focusedContextRefs.length > 0 && (
            <section className={styles.drawerSection}>
              <h3 className={styles.drawerSectionTitle}>
                Focused-context references
              </h3>
              <ul
                className={styles.drawerList}
                data-testid="msg-story-drawer-focused-context-refs"
              >
                {focusedContextRefs.map((ref, idx) => (
                  <li key={idx}>{ref}</li>
                ))}
              </ul>
            </section>
          )}

          {/* Recommended next action */}
          {row.recommendedNextAction && (
            <section className={styles.drawerSection}>
              <h3 className={styles.drawerSectionTitle}>
                Recommended next action
              </h3>
              <p
                className={styles.drawerParagraph}
                data-testid="msg-story-drawer-recommended-next-action"
              >
                {row.recommendedNextAction}
              </p>
            </section>
          )}

          {/* Error message (for failed rows) */}
          {row.errorMessage && (
            <section className={styles.drawerSection}>
              <h3 className={styles.drawerSectionTitle}>Error</h3>
              <p
                className={styles.errorBanner}
                data-testid="msg-story-drawer-error-message"
              >
                {row.errorMessage}
              </p>
            </section>
          )}

          {/* Action row: regenerate + drill-out links */}
          <section className={styles.drawerSection}>
            <div className={styles.drawerActionRow}>
              {row.workItemId && (
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonPrimary}`}
                  data-testid="msg-story-drawer-regenerate"
                  onClick={() =>
                    handleRegenerate({ confirmOverwrite: false })
                  }
                  disabled={regenerating}
                >
                  {regenerating ? 'Regenerating...' : 'Regenerate this story'}
                </button>
              )}
              {workItemHref && (
                <a
                  href={workItemHref}
                  className={styles.linkButton}
                  data-testid="msg-story-drawer-work-item-link"
                >
                  Open work item
                </a>
              )}
              {implementTabHref && (
                <a
                  href={implementTabHref}
                  className={styles.linkButton}
                  data-testid="msg-story-drawer-implement-link"
                >
                  Open Implement tab
                </a>
              )}
            </div>
            {regenerateError && (
              <p
                className={styles.errorBanner}
                role="alert"
                data-testid="msg-story-drawer-regenerate-error"
              >
                {regenerateError}
              </p>
            )}
          </section>
        </div>

        {/* Manual-edit-protected confirm dialog */}
        {protectedDialogOpen && (
          <div
            className={styles.confirmDialogBackdrop}
            data-testid="msg-story-drawer-protected-confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="msg-story-drawer-protected-dialog-title"
          >
            <div className={styles.confirmDialog}>
              <h3
                id="msg-story-drawer-protected-dialog-title"
                className={styles.confirmDialogTitle}
              >
                This spec has been manually edited
              </h3>
              <p className={styles.confirmDialogBody}>
                The stored spec for this story was edited after generation.
                Regenerating will overwrite the manual edits. Are you sure you
                want to continue?
              </p>
              <div className={styles.confirmDialogActions}>
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonSecondary}`}
                  data-testid="msg-story-drawer-protected-confirm-cancel"
                  onClick={() => setProtectedDialogOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonDanger}`}
                  data-testid="msg-story-drawer-protected-confirm-overwrite"
                  onClick={() =>
                    handleRegenerate({ confirmOverwrite: true })
                  }
                  disabled={regenerating}
                >
                  Yes, overwrite manual edits
                </button>
              </div>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

export default StoryResultDrawer;
