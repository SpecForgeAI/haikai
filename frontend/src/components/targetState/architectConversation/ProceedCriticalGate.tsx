/**
 * ProceedCriticalGate — critical hard-gate at the "proceed" step
 * (Spec 4 — 2026-06-24-vulnerability-reduction-and-steering, Task Group 6).
 *
 * The "proceed" step HARD-GATES on any REMAINING CRITICAL CVE — proceeding is
 * blocked until either every remaining critical is addressed OR the gate is
 * explicitly overridden with a justification. ONLY criticals gate; every other
 * severity remains non-blocking (the inline nudge is the steer for those).
 *
 * This reuses the EXACT coverage-override pattern:
 *   - a blocking override dialog at the final step whose "Proceed anyway
 *     (override)" button stays DISABLED until a justification is entered
 *     (mirrors `StartCaptureSessionWizard`'s 409 INVENTORY_UNACCOUNTED_ENDPOINTS
 *     override dialog), persisting the audit trio
 *     (justification + remaining-critical count at override time + timestamp)
 *     via Task Group 4 (`upsertProceedCriticalOverride`);
 *   - a later READ-ONLY override banner (mirrors `CaptureSessionDetailView`'s
 *     coverage-override banner) showing the persisted justification + count +
 *     timestamp.
 *
 * The remaining-critical set is READ from the shared Task Group 2 delta (via
 * `remainingCriticalCves`) — never re-derived here. When there is no delta (no
 * target snapshot) or no remaining critical, the gate is OPEN and proceeding is
 * unobstructed.
 */

import { useState } from 'react';
import {
  ClassifiedVulnerability,
  ProceedCriticalOverrideDto,
  VulnerabilityDeltaResult,
  remainingCriticalCves,
  upsertProceedCriticalOverride,
} from '../../../api/vulnerabilityReductionApi';
import styles from './ProceedCriticalGate.module.css';

export interface ProceedCriticalGateProps {
  projectId: string;
  /** The TARGET architecture id the override trio is persisted against. */
  architectureId: string;
  /**
   * The shared reduction delta (Task Group 2). The remaining-critical set is
   * read from here. `null` => no target snapshot => the gate is open.
   */
  delta: VulnerabilityDeltaResult | null;
  /**
   * The previously-persisted override trio (read by the host via
   * `getProceedCriticalOverride`), surfaced as the read-only banner. `null` =>
   * not yet loaded / never overridden.
   */
  persistedOverride: ProceedCriticalOverrideDto | null;
  /** Whether the underlying proceed control is otherwise enabled (e.g. close gate met). */
  proceedEnabled: boolean;
  /** Busy flag while a proceed is in flight (disables the action). */
  busy?: boolean;
  /**
   * Proceed for real. Called when the gate is open OR after a successful
   * override persist. The host performs the actual close/proceed.
   */
  onProceed: () => Promise<void> | void;
  /** Notifies the host that the override trio changed (so it can refresh the banner). */
  onOverridePersisted?: (override: ProceedCriticalOverrideDto) => void;
  /** The proceed button label (defaults to "Proceed"). */
  proceedLabel?: string;
}

/** Build the audit banner copy from a persisted override trio. */
function bannerText(override: ProceedCriticalOverrideDto): {
  count: number | 'Some';
  at: string | null;
  justification: string;
} {
  return {
    count:
      typeof override.remaining_critical_count === 'number'
        ? override.remaining_critical_count
        : 'Some',
    at: override.proceed_critical_override_at ?? null,
    justification: override.proceed_critical_override_justification ?? '',
  };
}

export function ProceedCriticalGate({
  projectId,
  architectureId,
  delta,
  persistedOverride,
  proceedEnabled,
  busy = false,
  onProceed,
  onOverridePersisted,
  proceedLabel = 'Proceed',
}: ProceedCriticalGateProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [justification, setJustification] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read the remaining criticals from the SHARED delta (single source of truth).
  const criticals: ClassifiedVulnerability[] = remainingCriticalCves(delta);
  const gateBlocked = criticals.length > 0;

  // An override already recorded? (drives the read-only banner — mirrors the
  // coverage-override banner's "justification present" guard.)
  const alreadyOverridden =
    !!persistedOverride &&
    persistedOverride.overridden === true &&
    typeof persistedOverride.proceed_critical_override_justification === 'string' &&
    persistedOverride.proceed_critical_override_justification.length > 0;

  // The primary proceed button: when the gate is blocked AND not yet overridden,
  // pressing it OPENS the override dialog rather than proceeding.
  const handlePrimary = async () => {
    if (!proceedEnabled || busy) return;
    if (gateBlocked && !alreadyOverridden) {
      setError(null);
      setJustification('');
      setDialogOpen(true);
      return;
    }
    await onProceed();
  };

  // The override confirm: persist the trio (justification + count + timestamp),
  // then proceed. The button is disabled until a justification is entered.
  const handleOverrideConfirm = async () => {
    if (justification.trim().length === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const persisted = await upsertProceedCriticalOverride(projectId, architectureId, {
        proceed_critical_override_justification: justification.trim(),
        remaining_critical_count: criticals.length,
      });
      onOverridePersisted?.(persisted);
      setDialogOpen(false);
      await onProceed();
    } catch (err) {
      setError(
        err instanceof Error
          ? `Could not record the override: ${err.message}`
          : 'Could not record the override.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const banner = alreadyOverridden && persistedOverride ? bannerText(persistedOverride) : null;

  return (
    <div
      className={styles.gate}
      data-testid="proceed-critical-gate"
      data-gate-blocked={gateBlocked ? 'true' : 'false'}
    >
      {/* Read-only override banner — mirrors CaptureSessionDetailView's
          coverage-override banner (justification + count + timestamp). */}
      {banner && (
        <div
          className={styles.overrideBanner}
          role="alert"
          data-testid="proceed-critical-override-banner"
        >
          <strong>Critical vulnerability gate was overridden to proceed.</strong>
          <span>
            {banner.count} remaining critical CVE(s) were unaddressed when this target
            proceeded
            {banner.at ? ` (overridden at ${banner.at})` : ''}. Justification: &ldquo;
            {banner.justification}&rdquo;
          </span>
        </div>
      )}

      {/* The hard-gate hint when blocked + not yet overridden. Only criticals gate. */}
      {gateBlocked && !alreadyOverridden && (
        <p
          className={styles.gateHint}
          data-testid="proceed-critical-gate-hint"
        >
          {criticals.length} remaining critical vulnerabilit
          {criticals.length === 1 ? 'y' : 'ies'} block proceeding (estimate). Address
          {criticals.length === 1 ? ' it' : ' them'} — or proceed anyway with a recorded
          justification.
        </p>
      )}

      <button
        type="button"
        className={styles.primaryButton}
        disabled={!proceedEnabled || busy}
        onClick={() => void handlePrimary()}
        data-testid="proceed-critical-gate-button"
        title={
          gateBlocked && !alreadyOverridden
            ? `Blocked by ${criticals.length} remaining critical CVE(s) — override requires a justification`
            : proceedLabel
        }
      >
        {proceedLabel}
      </button>

      {/* The blocking override dialog — "Proceed anyway (override)" stays DISABLED
          until a justification is entered (mirrors the 409 override dialog). */}
      {dialogOpen && (
        <div
          className={styles.overrideDialog}
          role="alertdialog"
          aria-label="Remaining critical vulnerabilities override"
          data-testid="proceed-critical-override-dialog"
        >
          <strong>
            Proceed blocked: {criticals.length} remaining critical vulnerabilit
            {criticals.length === 1 ? 'y' : 'ies'} (estimate).
          </strong>
          <span className={styles.helperText}>
            These critical CVEs are not addressed by the current target choices. Address
            them, or provide a justification to proceed anyway. The override
            (justification, remaining-critical count, timestamp) is persisted for audit.
          </span>
          <ul className={styles.criticalList} data-testid="proceed-critical-override-list">
            {criticals.slice(0, 50).map((c) => (
              <li
                key={c.cveId}
                className={styles.criticalItem}
                data-testid={`proceed-critical-override-cve-${c.cveId}`}
              >
                <strong>{c.cveId}</strong>
                {c.remainingReason ? ` — ${c.remainingReason}` : ''}
              </li>
            ))}
          </ul>
          {criticals.length > 50 && (
            <span className={styles.helperText}>
              …and {criticals.length - 50} more not shown.
            </span>
          )}
          <label className={styles.label} htmlFor="proceed-critical-override-justification">
            Override justification (required)
          </label>
          <textarea
            id="proceed-critical-override-justification"
            className={styles.textarea}
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            data-testid="proceed-critical-override-justification"
          />
          {error && (
            <div className={styles.dialogError} role="alert" data-testid="proceed-critical-override-error">
              {error}
            </div>
          )}
          <div className={styles.overrideActions}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => setDialogOpen(false)}
              disabled={submitting}
              data-testid="proceed-critical-override-cancel"
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => void handleOverrideConfirm()}
              disabled={submitting || justification.trim().length === 0}
              data-testid="proceed-critical-override-confirm"
            >
              {submitting ? 'Proceeding…' : 'Proceed anyway (override)'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
