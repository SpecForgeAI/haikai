/**
 * BatchResolveConflictsModal
 *
 * Spec 2026-06-23 Batch "Resolve Conflicts" Modal -- Task Group 2 (+ TG3.4 wires
 * the commit helper into Confirm/Retry).
 *
 * A scrollable, type-grouped SUPERSET of the single-candidate
 * `ConflictResolutionModal.tsx`. Where that modal resolves one candidate's
 * conflicts, THIS modal aggregates EVERY unresolved cross-source conflict across
 * all candidates in a run into one place. It is PRESENTATIONAL + selection-owning:
 *
 *   - the PARENT (`DiscoveryCandidateTable`, TG4) aggregates the conflict rows
 *     across candidates via `getUnresolvedConflicts` and passes them in as
 *     `rows`;
 *   - the PARENT owns the commit (it calls the TG3 `batchResolveCommit` helper
 *     from within `onConfirm` and feeds the outcome back via the `result` prop);
 *   - THIS modal owns the per-row SELECTION state, the two Resolve-All helpers
 *     (which only PRE-SELECT, never commit), the "* most authoritative" tag, the
 *     pinned result banner, and the all-success auto-close timer.
 *
 * All pre-selection logic comes from `batchResolveConflictsSupport` (TG1); none
 * is re-implemented here. Selection identity is the support module's `rowKey`
 * (candidate id + attribute), so the modal and the commit loop agree on which
 * row is which.
 *
 * Pattern source: `ConflictResolutionModal.tsx` (overlay + header/content/footer,
 * `isOpen` guard, Escape + overlay dismiss, `data-testid` selectors, per-option
 * button showing value + source, `renderValue`) and
 * `BulkCandidateActionConfirmModal.tsx` (grouped list-with-context layout +
 * spinner-on-confirm).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './BatchResolveConflictsModal.module.css';
import {
  candidateTypeLabel,
  markMostAuthoritative,
  presentSourceLabels,
  rowKey,
  selectMostAuthoritative,
  selectPreferredSource,
  type ConflictRow,
} from './batchResolveConflictsSupport';

/**
 * One resolved/failed (candidate, attribute) pair in the commit result. Mirrors
 * the identity the TG3 helper reports so the modal can keep ONLY the failed rows
 * selected and relabel Confirm to "Retry failed (N)".
 */
export interface BatchResolveResultPair {
  candidateId: string;
  attr: string;
}

/**
 * The outcome of a commit pass, surfaced by the parent via the `result` prop.
 * `resolved` / `failed` carry the (candidate, attr) pairs (NOT just counts) so
 * the modal can drive the retry-only-the-failures behaviour.
 */
export interface BatchResolveResult {
  resolved: BatchResolveResultPair[];
  failed: BatchResolveResultPair[];
}

/**
 * The reviewer's chosen option index per row, keyed by {@link rowKey}. `number`
 * = chosen option index into that row's `options`; `undefined` / absent = the
 * row is left unresolved this pass. Mirrors the single-conflict modal's
 * `ConflictSelections = Record<string, number | undefined>` semantics, but keyed
 * by row identity rather than bare attribute (the batch modal spans candidates).
 */
export type BatchRowSelections = Record<string, number | undefined>;

export interface BatchResolveConflictsModalProps {
  isOpen: boolean;
  /**
   * Already-aggregated conflict rows (one per conflicted attribute on a
   * candidate), aggregated across the run by the parent (TG4). The modal groups
   * them by `type` and sorts by candidate `name` within each group.
   */
  rows: ConflictRow[];
  /**
   * True while a commit pass is in flight (the parent's `onConfirm` is awaiting
   * `batchResolveCommit`). Disables the controls and renders a spinner inside
   * Confirm.
   */
  inFlight?: boolean;
  /**
   * The outcome of the most recent commit pass (set by the parent after
   * `onConfirm` resolves). Drives the pinned banner, the Confirm/Retry relabel,
   * and -- on all-success -- the auto-close timer.
   */
  result?: BatchResolveResult | null;
  onClose: () => void;
  /**
   * Fired on Confirm/Retry with the current selections (keyed by row identity).
   * The parent runs the best-effort commit loop (TG3) and reports back via
   * `result`. Only rows with a chosen index are acted on.
   */
  onConfirm: (selections: BatchRowSelections) => void;
}

/**
 * Render an arbitrary competing value as readable text. Strings pass through;
 * everything else is JSON-stringified so object/array values stay legible.
 * null/undefined render as "(empty)". (Verbatim from
 * `ConflictResolutionModal.renderValue`.)
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

/** Milliseconds the all-success summary lingers before the modal auto-closes. */
const SUCCESS_AUTOCLOSE_MS = 1500;

export function BatchResolveConflictsModal({
  isOpen,
  rows,
  inFlight = false,
  result = null,
  onClose,
  onConfirm,
}: BatchResolveConflictsModalProps) {
  const [selections, setSelections] = useState<BatchRowSelections>({});

  // Reset selections whenever the modal transitions closed -> open so a stale
  // choice from a previous open does not leak into the next session.
  useEffect(() => {
    if (isOpen) {
      setSelections({});
    }
  }, [isOpen]);

  // Escape-key dismiss (mirrors ConflictResolutionModal). Suppressed while a
  // commit is in flight so an ill-timed key event cannot dismiss mid-trip.
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !inFlight) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, inFlight, onClose]);

  // All-success auto-close: when the latest result has resolutions and no
  // failures, show the success summary briefly, then close (TG3.4). Cleared on
  // unmount / dependency change so a retry that fails cancels a pending close.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!isOpen) return;
    if (!result) return;
    if (result.failed.length > 0) return;
    if (result.resolved.length === 0) return;
    const timer = window.setTimeout(() => onCloseRef.current(), SUCCESS_AUTOCLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [isOpen, result]);

  // Partial failure (TG3.4): prune the selection down to ONLY the failed rows so
  // the relabelled "Retry failed (N)" Confirm re-fires JUST the failures via the
  // same `onConfirm(selections)` path. Resolved rows drop out of the selection
  // (and, once the parent feeds back the mutated candidates, out of `rows`), so
  // they cannot be re-committed. Keyed off the result identity.
  useEffect(() => {
    if (!isOpen) return;
    if (!result || result.failed.length === 0) return;
    const failedKeys = new Set(
      result.failed.map((pair) =>
        rowKey({ candidateId: pair.candidateId, attr: pair.attr }),
      ),
    );
    setSelections((prev) => {
      const next: BatchRowSelections = {};
      for (const key of Object.keys(prev)) {
        if (failedKeys.has(key) && prev[key] !== undefined) {
          next[key] = prev[key];
        }
      }
      return next;
    });
  }, [isOpen, result]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && !inFlight) {
        onClose();
      }
    },
    [onClose, inFlight],
  );

  const handleSelect = useCallback((key: string, optionIndex: number) => {
    setSelections((prev) => ({ ...prev, [key]: optionIndex }));
  }, []);

  // "Use most authoritative source" -- PRE-SELECT only (TG1 helper). Merge into
  // the existing selection so any manual choices the reviewer already made on
  // rows the helper does not touch are preserved.
  const handleUseMostAuthoritative = useCallback(() => {
    setSelections((prev) => ({ ...prev, ...selectMostAuthoritative(rows) }));
  }, [rows]);

  // "Prefer a source..." -- PRE-SELECT that source's option where present; rows
  // lacking it are left as-is (the TG1 helper omits them). Merge so existing
  // choices on absent-source rows survive.
  const handlePreferSource = useCallback(
    (source: string) => {
      if (!source) return;
      setSelections((prev) => ({ ...prev, ...selectPreferredSource(rows, source) }));
    },
    [rows],
  );

  const handleConfirm = useCallback(() => {
    onConfirm(selections);
  }, [onConfirm, selections]);

  // The de-duplicated, authority-ranked source labels actually present -- drives
  // the prefer-source dropdown so it lists ONLY sources present (TG1).
  const sourceLabels = useMemo(() => presentSourceLabels(rows), [rows]);

  // Group rows by `type`, then sort by candidate `name` within each group;
  // groups themselves are ordered by their friendly label so the headers read
  // alphabetically. The "* most authoritative" index is memoised per row.
  const groups = useMemo(() => {
    const byType = new Map<string, ConflictRow[]>();
    for (const row of rows) {
      const list = byType.get(row.type);
      if (list) list.push(row);
      else byType.set(row.type, [row]);
    }
    return Array.from(byType.entries())
      .map(([type, groupRows]) => ({
        type,
        label: candidateTypeLabel(type),
        rows: [...groupRows].sort((a, b) =>
          a.candidateName.localeCompare(b.candidateName),
        ),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  if (!isOpen) {
    return null;
  }

  const hasFailures = (result?.failed.length ?? 0) > 0;
  const selectedCount = Object.values(selections).filter(
    (v) => v !== undefined,
  ).length;
  // Confirm is enabled once at least one row has a chosen value (and no commit
  // is in flight). After a partial failure the failed rows stay selected, so
  // this stays enabled to drive the retry.
  const confirmEnabled = selectedCount > 0 && !inFlight;
  const confirmLabel = hasFailures
    ? `Retry failed (${result?.failed.length ?? 0})`
    : 'Resolve selected';
  const isEmpty = rows.length === 0;

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      data-testid="batch-resolve-conflicts-modal"
    >
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title} data-testid="batch-resolve-conflicts-title">
            Resolve conflicts
          </h2>
          <button
            className={styles.closeButton}
            onClick={onClose}
            disabled={inFlight}
            title="Close"
            data-testid="batch-resolve-conflicts-close-button"
          >
            &times;
          </button>
        </div>

        <div className={styles.content}>
          {/* Result banner -- pinned at the TOP of the content area (TG3.4). */}
          {result && (result.resolved.length > 0 || result.failed.length > 0) && (
            <div
              className={`${styles.resultBanner} ${
                hasFailures ? styles.resultBannerPartial : styles.resultBannerSuccess
              }`}
              role="status"
              data-testid="batch-resolve-result-banner"
            >
              {result.resolved.length} resolved
              {hasFailures
                ? `, ${result.failed.length} failed -- retry the failures`
                : ''}
            </div>
          )}

          {isEmpty ? (
            <p className={styles.emptyState} data-testid="batch-resolve-empty-state">
              No unresolved conflicts.
            </p>
          ) : (
            <>
              <p className={styles.intro} data-testid="batch-resolve-intro">
                Sources disagree on the values below. Pick the correct value for
                each conflict, or use a Resolve All helper to pre-select by source
                authority; your choices are recorded with their source and the
                conflicts are cleared.
              </p>

              {/* The two Resolve-All controls (both pre-select only). */}
              <div className={styles.resolveAllBar} data-testid="batch-resolve-all-bar">
                <span className={styles.resolveAllLabel}>Resolve all:</span>
                <button
                  type="button"
                  className={styles.resolveAllButton}
                  onClick={handleUseMostAuthoritative}
                  disabled={inFlight}
                  data-testid="batch-resolve-use-most-authoritative"
                >
                  Use most authoritative source
                </button>
                <span className={styles.preferSourceGroup}>
                  <select
                    className={styles.preferSourceSelect}
                    defaultValue=""
                    disabled={inFlight}
                    onChange={(e) => {
                      handlePreferSource(e.target.value);
                      // Reset to the placeholder so re-choosing the same source
                      // fires onChange again.
                      e.target.value = '';
                    }}
                    aria-label="Prefer a source"
                    data-testid="batch-resolve-prefer-source-select"
                  >
                    <option value="" disabled>
                      Prefer a source...
                    </option>
                    {sourceLabels.map((source) => (
                      <option
                        key={source}
                        value={source}
                        data-testid={`batch-resolve-prefer-source-option-${source}`}
                      >
                        {source}
                      </option>
                    ))}
                  </select>
                </span>
              </div>

              {groups.map((group) => (
                <div
                  key={group.type}
                  className={styles.group}
                  data-testid={`batch-resolve-group-${group.type}`}
                >
                  <div
                    className={styles.groupHeader}
                    data-testid={`batch-resolve-group-header-${group.type}`}
                  >
                    {group.label}
                  </div>
                  {group.rows.map((row) => {
                    const key = rowKey(row);
                    const authoritativeIndex = markMostAuthoritative(row);
                    return (
                      <div
                        key={key}
                        className={styles.conflictBlock}
                        data-testid={`batch-resolve-row-${key}`}
                      >
                        <div className={styles.rowMeta}>
                          <span
                            className={styles.candidateName}
                            data-testid={`batch-resolve-row-name-${key}`}
                          >
                            {row.candidateName}
                          </span>
                          <span className={styles.attrName}>{row.attr}</span>
                        </div>
                        <div className={styles.optionList}>
                          {row.options.map((option, index) => {
                            const selected = selections[key] === index;
                            const isAuthoritative = authoritativeIndex === index;
                            return (
                              <button
                                key={`${key}-${index}`}
                                type="button"
                                className={`${styles.option} ${
                                  selected ? styles.optionSelected : ''
                                }`}
                                aria-pressed={selected}
                                disabled={inFlight}
                                onClick={() => handleSelect(key, index)}
                                data-testid={`batch-resolve-option-${key}-${index}`}
                              >
                                <span className={styles.optionValue}>
                                  {renderValue(option.value)}
                                </span>
                                <span className={styles.optionMeta}>
                                  <span className={styles.optionSource}>
                                    {option.source}
                                  </span>
                                  {isAuthoritative && (
                                    <span
                                      className={styles.authoritativeTag}
                                      title="Highest-authority source for this attribute"
                                      data-testid={`batch-resolve-authoritative-tag-${key}`}
                                    >
                                      {'★'} most authoritative
                                    </span>
                                  )}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </>
          )}
        </div>

        <div className={styles.footer}>
          <button
            className={styles.secondaryButton}
            onClick={onClose}
            disabled={inFlight}
            data-testid="batch-resolve-close"
          >
            Close
          </button>
          {!isEmpty && (
            <button
              className={styles.primaryButton}
              onClick={handleConfirm}
              disabled={!confirmEnabled}
              title={confirmEnabled ? undefined : 'Select a value to resolve'}
              data-testid="batch-resolve-confirm"
            >
              {inFlight && <span className={styles.spinner} aria-hidden="true" />}
              {inFlight ? 'Resolving...' : confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
