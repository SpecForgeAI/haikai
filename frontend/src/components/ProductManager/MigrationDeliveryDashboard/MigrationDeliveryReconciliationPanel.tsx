/**
 * MigrationDeliveryReconciliationPanel
 *
 * Spec: 2026-06-14 Migration Reconciliation + Bug Loop (Spec 4 of 4) --
 * Task Group 5. Extended 2026-06-14 Non-Reconciling Work at Reconcile Time
 * (D6) -- Task Group 5: the `expected_net_new` recognised badge + matched
 * work-item reference.
 *
 * The run-scoped reconciliation REVIEW surface on the Migration Delivery
 * Dashboard, sitting directly below the Spec-3 Migrate / run-progress panel
 * (`MigrationDeliveryMigratePanel`) once a run exists. Modelled on the existing
 * breaks UI (`DriftReportTab` -- the break == drifting `api_behaviour_diff_item`
 * table) and the Spec-2/3 result-banner idioms.
 *
 * Responsibilities:
 *   1. LIST the run's breaks (`getReconciliationBreaks`): per break the source
 *      operation/area (method/path/summary from `detail_json` +
 *      `source_baseline_item_id`), the disposition status, the attempt/round
 *      counter, and the circuit-breaker / needs-human ESCALATED badge. The
 *      break == drifting `api_behaviour_diff_item` equivalence is made explicit
 *      in the copy (UI keeps the "drift" wording per the existing convention).
 *   2. The HUMAN GATE: the user SELECTS breaks (checkboxes) and either
 *      (a) "Send as bugs" (`sendReconciliationBreaksAsBugs`) -- creates a bug for
 *      the external implementation/verification service to fix -- or (b) assigns
 *      a terminal disposition (`disposeReconciliationBreaks`:
 *      accepted | wont_report | intentional_deviation) -- records an
 *      intentional / accepted / deferred deviation that will NOT be sent. The
 *      current-state oracle is UNCHANGED either way (CD-A). Nothing auto-sends.
 *      After either action the list refreshes.
 *   3. Re-reconcile OUTCOMES: `fixed_confirmed` (resolved), `still_broken`
 *      (looped, with attempt count), `circuit_broken_escalated` (terminal
 *      needs-human) render with distinct visual states; escalated breaks also
 *      collect into a needs-review queue.
 *   4. The `needs_target_credentials` PAUSE state (CD-2): when the run is waiting
 *      on creds (restart / long-running run), surface it with a register action
 *      (`registerTargetCredentials`; `type:'none'` for a like-for-like
 *      unauthenticated target) so the run can re-enter. Creds are held in-memory
 *      for the run only -- NEVER persisted, NEVER logged.
 *   5. (D6) An auto-dispositioned `expected_net_new` break -- the gateway
 *      post-diff pass recognised a `target_only` diff as an ADDITIVE net_new
 *      endpoint -- renders VISIBLY RECOGNISED ("Expected -- net_new endpoint"
 *      badge + the matched work-item reference read from
 *      `detail_json.net_new_match`), NOT hidden, while staying overridable so a
 *      human can re-classify a wrongly-matched endpoint via the existing
 *      disposition path (D7).
 *
 * Presentational: every client is a test-seam prop (defaults to the real api
 * client) so the dashboard test renders deterministically + offline. The panel
 * owns no routing and never imports a context hook.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getReconciliationBreaks as defaultGetBreaks,
  sendReconciliationBreaksAsBugs as defaultSendBreaks,
  disposeReconciliationBreaks as defaultDisposeBreaks,
  registerTargetCredentials as defaultRegisterCreds,
  BREAK_DISPOSITION,
  TERMINAL_BREAK_STATES,
  type MigrationReconciliationBreakDto,
  type ReconciliationDisposition,
} from '../../../api/migrationReconciliationApi';
import styles from './MigrationDeliveryDashboard.module.css';

// ============================================================================
// Helpers
// ============================================================================

/** Pull the source operation + summary off a break's inline `detail_json`. */
function breakDetail(b: MigrationReconciliationBreakDto): {
  method: string;
  path: string;
  summary: string;
} {
  const d = (b.detail_json ?? {}) as Record<string, unknown>;
  return {
    method: typeof d.method === 'string' ? d.method : '',
    path: typeof d.path === 'string' ? d.path : '',
    summary:
      typeof d.summary === 'string'
        ? d.summary
        : typeof d.diff === 'string'
          ? d.diff
          : '',
  };
}

/**
 * The matched work-item reference (D6) written by the gateway auto-disposition
 * pass onto `detail_json.net_new_match` when a `target_only` diff was uniquely
 * recognised as an additive net_new endpoint. Returns null unless the break was
 * auto-recognised (`outcome === 'auto_recognised'`).
 */
function netNewMatch(b: MigrationReconciliationBreakDto): {
  title: string;
  workItemId: string;
  operation: string;
} | null {
  const d = (b.detail_json ?? {}) as Record<string, unknown>;
  const m = d.net_new_match;
  if (!m || typeof m !== 'object') return null;
  const match = m as Record<string, unknown>;
  if (match.outcome !== 'auto_recognised') return null;
  return {
    title:
      typeof match.matched_work_item_title === 'string'
        ? match.matched_work_item_title
        : '',
    workItemId:
      typeof match.matched_work_item_id === 'string'
        ? match.matched_work_item_id
        : '',
    operation:
      typeof match.matched_operation === 'string'
        ? match.matched_operation
        : '',
  };
}

/** Human label for a disposition status. */
function dispositionLabel(status: string | null | undefined): string {
  switch (status) {
    case BREAK_DISPOSITION.OPEN:
      return 'Open';
    case BREAK_DISPOSITION.SENT_AS_BUG:
      return 'Sent as bug';
    case BREAK_DISPOSITION.FIXED_CONFIRMED:
      return 'Fixed (confirmed)';
    case BREAK_DISPOSITION.STILL_BROKEN:
      return 'Still broken';
    case BREAK_DISPOSITION.CIRCUIT_BROKEN_ESCALATED:
      return 'Escalated — needs review';
    case BREAK_DISPOSITION.ACCEPTED:
      return 'Accepted';
    case BREAK_DISPOSITION.WONT_REPORT:
      return "Won't report";
    case BREAK_DISPOSITION.INTENTIONAL_DEVIATION:
      return 'Intentional deviation';
    case BREAK_DISPOSITION.EXPECTED_NET_NEW:
      return 'Expected — net_new endpoint';
    default:
      return status ?? 'unknown';
  }
}

/**
 * Map a disposition status to a distinct badge class. The three re-reconcile
 * outcomes get their own purpose-built classes (resolved-green /
 * still-looping-amber / escalated-red); the D6 auto-recognised additive
 * net_new endpoint gets its own recognised-state class; the other states reuse
 * the dashboard's existing chip palette.
 */
function dispositionBadgeClass(status: string | null | undefined): string {
  switch (status) {
    case BREAK_DISPOSITION.FIXED_CONFIRMED:
      return styles.badgeFixedConfirmed ?? styles.badgeSaved ?? styles.badge;
    case BREAK_DISPOSITION.STILL_BROKEN:
      return styles.badgeStillBroken ?? styles.badgeSpecWarning ?? styles.badge;
    case BREAK_DISPOSITION.CIRCUIT_BROKEN_ESCALATED:
      return styles.badgeCircuitBroken ?? styles.badgeSpecFailed ?? styles.badge;
    case BREAK_DISPOSITION.EXPECTED_NET_NEW:
      return styles.badgeExpectedNetNew ?? styles.badgeNetNew ?? styles.badge;
    case BREAK_DISPOSITION.SENT_AS_BUG:
      return styles.badgeSpecGenerated ?? styles.badge;
    case BREAK_DISPOSITION.ACCEPTED:
    case BREAK_DISPOSITION.WONT_REPORT:
    case BREAK_DISPOSITION.INTENTIONAL_DEVIATION:
      return styles.badgeNotSaved ?? styles.badge;
    default:
      return styles.badge;
  }
}

/** A break is terminal (not sent, not re-run) iff in a terminal state. */
function isTerminal(b: MigrationReconciliationBreakDto): boolean {
  return TERMINAL_BREAK_STATES.includes(b.disposition_status ?? '');
}

/**
 * A break is auto-recognised additive net_new (D6) iff the gateway set its
 * disposition to `expected_net_new`. It is terminal in the gateway/idempotent
 * sense, but MACHINE-set, so the review surface keeps it overridable (D7).
 */
function isAutoRecognisedNetNew(b: MigrationReconciliationBreakDto): boolean {
  return b.disposition_status === BREAK_DISPOSITION.EXPECTED_NET_NEW;
}

/**
 * A break is SELECTABLE for the human gate iff it is not terminal, OR it is an
 * auto-recognised net_new endpoint -- the latter is machine-set, so a human may
 * still re-classify a wrong match via the existing disposition path (D7).
 */
function isSelectable(b: MigrationReconciliationBreakDto): boolean {
  return !isTerminal(b) || isAutoRecognisedNetNew(b);
}

/** A break is escalated (needs human) iff circuit-broken or flagged. */
function isEscalated(b: MigrationReconciliationBreakDto): boolean {
  return (
    Boolean(b.circuit_broken) ||
    Boolean(b.needs_human) ||
    b.disposition_status === BREAK_DISPOSITION.CIRCUIT_BROKEN_ESCALATED
  );
}

// ============================================================================
// Props
// ============================================================================

export interface MigrationDeliveryReconciliationPanelProps {
  projectId: string;
  /** The migration-execution run whose breaks this surface reviews. */
  runId: string;
  /**
   * The run's current status. When `needs_target_credentials`, the panel
   * surfaces the creds-pause (CD-2) with a register action.
   */
  runStatus?: string | null;
  /** Orchestration scope: organisation name (threaded on the bug send). */
  company: string;
  /** Orchestration scope: product name (threaded on the bug send). */
  project: string;
  /** Test seam: override the breaks read. Defaults to the real client. */
  fetchBreaksFn?: typeof defaultGetBreaks;
  /** Test seam: override the bug send. Defaults to the real client. */
  sendBreaksFn?: typeof defaultSendBreaks;
  /** Test seam: override the dispose. Defaults to the real client. */
  disposeBreaksFn?: typeof defaultDisposeBreaks;
  /** Test seam: override the target-credentials register. */
  registerCredsFn?: typeof defaultRegisterCreds;
}

// ============================================================================
// Component
// ============================================================================

export const MigrationDeliveryReconciliationPanel: React.FC<
  MigrationDeliveryReconciliationPanelProps
> = ({
  projectId,
  runId,
  runStatus,
  company,
  project,
  fetchBreaksFn = defaultGetBreaks,
  sendBreaksFn = defaultSendBreaks,
  disposeBreaksFn = defaultDisposeBreaks,
  registerCredsFn = defaultRegisterCreds,
}) => {
  const [breaks, setBreaks] = useState<MigrationReconciliationBreakDto[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [disposition, setDisposition] = useState<ReconciliationDisposition>(
    BREAK_DISPOSITION.ACCEPTED,
  );
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [credsRegistered, setCredsRegistered] = useState<boolean>(false);

  const needsCredentials =
    (runStatus ?? '') === 'needs_target_credentials' && !credsRegistered;

  // ----- Breaks read ------------------------------------------------------
  const loadBreaks = useCallback(async () => {
    try {
      const rows = await fetchBreaksFn(projectId, runId);
      setBreaks(rows);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to read reconciliation breaks',
      );
    }
  }, [fetchBreaksFn, projectId, runId]);

  useEffect(() => {
    void loadBreaks();
  }, [loadBreaks]);

  // Drop any now-unselectable ids from the selection whenever breaks change
  // (an auto-recognised net_new break stays selectable for human override).
  useEffect(() => {
    setSelected((prev) => {
      const stillSelectable = new Set(
        breaks.filter((b) => b.id && isSelectable(b)).map((b) => b.id as string),
      );
      const next = new Set<string>();
      for (const id of prev) if (stillSelectable.has(id)) next.add(id);
      return next;
    });
  }, [breaks]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const hasSelection = selectedIds.length > 0;

  // ----- The human gate: Send selected breaks as ONE bug report -----------
  const handleSend = useCallback(async () => {
    if (!hasSelection || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await sendBreaksFn(projectId, runId, {
        company,
        project,
        breakIds: selectedIds,
      });
      if (result.status === 'sent') {
        setNotice(
          `Sent ${result.breakCount} break${result.breakCount === 1 ? '' : 's'} as bug ${result.bugId}. ` +
            'The external service will investigate and redeploy; the oracle is unchanged.',
        );
        setSelected(new Set());
        await loadBreaks();
      } else if (result.status === 'no_breaks') {
        setError('None of the selected breaks could be sent (already terminal).');
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send the bug report');
    } finally {
      setBusy(false);
    }
  }, [
    hasSelection,
    busy,
    sendBreaksFn,
    projectId,
    runId,
    company,
    project,
    selectedIds,
    loadBreaks,
  ]);

  // ----- Dispose selected breaks (terminal; oracle unchanged -- CD-A) ------
  const handleDispose = useCallback(async () => {
    if (!hasSelection || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await disposeBreaksFn(projectId, runId, {
        breakIds: selectedIds,
        disposition,
      });
      setNotice(
        `Disposed ${result.count} break${result.count === 1 ? '' : 's'} as "${dispositionLabel(disposition)}". ` +
          'This records an intentional / accepted deviation — it is NOT sent as a bug and the oracle is unchanged.',
      );
      setSelected(new Set());
      await loadBreaks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to dispose the breaks');
    } finally {
      setBusy(false);
    }
  }, [
    hasSelection,
    busy,
    disposeBreaksFn,
    projectId,
    runId,
    selectedIds,
    disposition,
    loadBreaks,
  ]);

  // ----- Register target credentials (CD-2 pause re-entry) ----------------
  const handleRegisterCreds = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // type:'none' -- the common like-for-like unauthenticated target. The
      // creds bundle is held in-memory for the run only, never persisted.
      await registerCredsFn(projectId, runId, { type: 'none' });
      setCredsRegistered(true);
      setNotice(
        'Target credentials registered for this run. Reconciliation can re-enter ' +
          'on the next deploy callback.',
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to register target credentials',
      );
    } finally {
      setBusy(false);
    }
  }, [busy, registerCredsFn, projectId, runId]);

  // ----- Derived views ----------------------------------------------------
  const needsReviewBreaks = useMemo(
    () => breaks.filter((b) => isEscalated(b)),
    [breaks],
  );

  return (
    <section className={styles.hierarchySection} data-testid="mdd-recon-panel">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <h2 className={styles.sectionTitle}>Reconciliation review</h2>
        <button
          type="button"
          className={styles.headerNavLink}
          data-testid="mdd-recon-refresh"
          onClick={() => void loadBreaks()}
        >
          Refresh
        </button>
      </div>

      <p className={styles.needsAttentionReason} data-testid="mdd-recon-intro">
        Each break is a drifting operation: the migrated target diverged from the
        pinned current-state baseline (the oracle) for the same request. Select
        breaks and either send them as a bug for the external service to fix, or
        dispose them as an intentional / accepted deviation (not sent — the oracle
        is never changed). A break recognised as a deliberately-added net_new
        endpoint is auto-marked "Expected — net_new endpoint"; you can still
        re-classify it if the match was wrong.
      </p>

      {/* ----- needs_target_credentials pause (CD-2) ----- */}
      {needsCredentials && (
        <div
          className={styles.warningBanner}
          role="alert"
          data-testid="mdd-recon-needs-creds"
        >
          <span>
            This run is paused: it needs target credentials before it can
            reconcile against the deployed target. Credentials are held in memory
            for the run only and are never stored.
          </span>
          <button
            type="button"
            className={styles.bulkButton}
            data-testid="mdd-recon-register-creds-button"
            disabled={busy}
            onClick={() => void handleRegisterCreds()}
          >
            Register target credentials (no auth)
          </button>
        </div>
      )}

      {/* ----- Error / notice banners ----- */}
      {error && (
        <div
          className={styles.errorBanner}
          role="alert"
          data-testid="mdd-recon-error"
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          className={styles.bulkInFlightBanner}
          role="status"
          data-testid="mdd-recon-notice"
        >
          {notice}
        </div>
      )}

      {/* ----- The human gate: select -> Send / Dispose ----- */}
      <div
        className={styles.needsAttentionActions}
        data-testid="mdd-recon-actions"
        style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
      >
        <span data-testid="mdd-recon-selected-count">
          {selectedIds.length} selected
        </span>
        <button
          type="button"
          className={styles.bulkButton}
          data-testid="mdd-recon-send-button"
          disabled={!hasSelection || busy}
          onClick={() => void handleSend()}
          title="Send the selected breaks as one bug report for the external service to fix. Nothing auto-sends."
        >
          Send as bugs
        </button>
        <label className={styles.testFilterToggle}>
          Disposition:{' '}
          <select
            data-testid="mdd-recon-disposition-select"
            value={disposition}
            onChange={(e) =>
              setDisposition(e.target.value as ReconciliationDisposition)
            }
          >
            <option value={BREAK_DISPOSITION.ACCEPTED}>Accepted</option>
            <option value={BREAK_DISPOSITION.WONT_REPORT}>Won&apos;t report</option>
            <option value={BREAK_DISPOSITION.INTENTIONAL_DEVIATION}>
              Intentional deviation
            </option>
          </select>
        </label>
        <button
          type="button"
          className={styles.bulkButton}
          data-testid="mdd-recon-dispose-button"
          disabled={!hasSelection || busy}
          onClick={() => void handleDispose()}
          title="Record the selected breaks as an intentional / accepted deviation. NOT sent as a bug; the oracle is unchanged."
        >
          Dispose (won&apos;t send)
        </button>
      </div>

      {/* ----- Breaks table (break == drifting api_behaviour_diff_item) ----- */}
      {breaks.length === 0 ? (
        <div className={styles.needsAttentionReason} data-testid="mdd-recon-empty">
          No reconciliation breaks recorded for this run.
        </div>
      ) : (
        <table
          className={styles.reconBreaksTable}
          data-testid="mdd-recon-breaks-table"
        >
          <thead>
            <tr>
              <th />
              <th>Source operation</th>
              <th>Drift summary</th>
              <th>Disposition</th>
              <th>Attempts</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {breaks.map((b) => {
              const id = b.id ?? '';
              const { method, path, summary } = breakDetail(b);
              const terminal = isTerminal(b);
              const escalated = isEscalated(b);
              const match = netNewMatch(b);
              return (
                <tr key={id} data-testid={`mdd-recon-break-row-${id}`}>
                  <td>
                    <input
                      type="checkbox"
                      data-testid={`mdd-recon-select-${id}`}
                      checked={selected.has(id)}
                      disabled={!isSelectable(b) || busy}
                      onChange={() => toggleSelect(id)}
                      aria-label={`Select break ${method} ${path}`}
                    />
                  </td>
                  <td data-testid={`mdd-recon-break-op-${id}`}>
                    <strong>{method}</strong> {path}
                  </td>
                  <td>
                    {summary || '—'}
                    {/* D6: the matched work-item reference for an auto-recognised
                        additive net_new endpoint -- surfaced inline, NOT hidden. */}
                    {match && (
                      <div
                        className={styles.needsAttentionReason}
                        data-testid={`mdd-recon-break-net-new-match-${id}`}
                      >
                        Recognised as net_new — matched work item{' '}
                        <strong>{match.title || match.workItemId}</strong>
                        {match.workItemId ? ` (${match.workItemId})` : ''}
                        {match.operation ? ` via ${match.operation}` : ''}.
                      </div>
                    )}
                  </td>
                  <td>
                    <span
                      className={`${styles.badge} ${dispositionBadgeClass(b.disposition_status)}`}
                      data-testid={`mdd-recon-break-disposition-${id}`}
                      data-state={b.disposition_status ?? ''}
                    >
                      {dispositionLabel(b.disposition_status)}
                    </span>
                  </td>
                  <td data-testid={`mdd-recon-break-attempt-${id}`}>
                    {b.attempt_count ?? 0}
                  </td>
                  <td>
                    {escalated ? (
                      <span
                        className={`${styles.badge} ${styles.badgeNeedsAttention ?? styles.badge}`}
                        data-testid={`mdd-recon-break-escalated-${id}`}
                        title="The bounded re-run round tripped (or a failed/rejected outcome arrived); needs a human disposition."
                      >
                        Escalated
                      </span>
                    ) : (
                      <span className={styles.badge}>
                        {terminal ? 'Terminal' : 'Active'}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* ----- Needs-review queue (escalated breaks awaiting a disposition) ----- */}
      {needsReviewBreaks.length > 0 && (
        <div data-testid="mdd-recon-needs-review-queue">
          <h3 className={styles.sectionTitle}>
            Needs review ({needsReviewBreaks.length})
          </h3>
          <ul className={styles.defineTestsBannerList}>
            {needsReviewBreaks.map((b) => {
              const id = b.id ?? '';
              const { method, path } = breakDetail(b);
              return (
                <li key={id} data-testid={`mdd-recon-needs-review-item-${id}`}>
                  <strong>{method}</strong> {path} — attempt {b.attempt_count ?? 0}
                  {b.error_detail ? ` (${b.error_detail})` : ''}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
};

export default MigrationDeliveryReconciliationPanel;
