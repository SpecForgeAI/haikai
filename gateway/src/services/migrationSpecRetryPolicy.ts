/**
 * Migration spec auto-retry policy (Robustness R2, 2026-08-05).
 *
 * Decides whether a FAILED build-results callback should be absorbed by a
 * driver-level retry instead of halting the run. The live incident behind the
 * whole robustness spec: a 13.5s Kiro-backend blip failed one step, which
 * failed the spec, which stopped a 12-spec Stage run — with a human needed to
 * re-start the entire stage.
 *
 * Classification comes from TWO sources, in trust order:
 *   1. `failure_class` on the callback (R1 — the IVS orchestrator classifies
 *      each fatal step via `src/chat/transient_failure.py` and now sends
 *      'transient_upstream' | 'real' on the build-results wire). When present
 *      it is AUTHORITATIVE: 'real' NEVER retries (incoherent spec, unticked
 *      tasks, questions-in-non-interactive — retrying would only mask), and
 *      'transient_upstream' retries while attempts remain.
 *   2. When the class is ABSENT (an older IVS build, or a failure shape that
 *      never reached the classifier — e.g. the submit itself 502'd), a small
 *      LOCAL signature scan over the callback summary/errors mirrors the IVS
 *      TRANSIENT_SIGNATURES list. The two lists MUST stay in sync by hand —
 *      the IVS one is the source of truth
 *      (implement-verify-service/src/chat/transient_failure.py).
 *
 * Attempt budget: env MIGRATION_SPEC_RETRY_MAX_ATTEMPTS (default 3 = TOTAL
 * tries, matching the spec's "max 3 tries, short gaps" ruling). Backoff: env
 * MIGRATION_SPEC_RETRY_BACKOFF_SECONDS (default "60,180"; the last entry
 * repeats) — deliberately longer than the IVS in-step backoff (30,120) so a
 * driver-level retry lands after the upstream blip window the step-level
 * retries already failed to outlast.
 *
 * Pure module: no I/O, no timers — the driver owns scheduling/persistence so
 * this stays trivially unit-testable.
 */

/**
 * Case-insensitive substrings that mark a TRANSIENT upstream condition.
 * MIRRORS implement-verify-service/src/chat/transient_failure.py
 * TRANSIENT_SIGNATURES — keep the two lists in sync when either changes.
 */
export const TRANSIENT_SIGNATURES: readonly string[] = [
  'internalservererror',
  'internalserverexception',
  'having trouble responding',
  'encountered an unexpected error when processing the request',
  'serviceunavailable',
  'service unavailable',
  'service is temporarily',
  'overloaded',
  'throttl',
  'rate limit',
  'too many requests',
  'error 429',
  'code: 429',
  'error 529',
  'code: 529',
  'timed out',
  'timeoutexpired',
  'connection reset',
  'connection aborted',
  'temporarily unavailable',
  'bedrock is unable',
  'modeltimeout',
];

/** Wire values of the R1 failure classifier. */
export const FAILURE_CLASS_TRANSIENT = 'transient_upstream';
export const FAILURE_CLASS_REAL = 'real';

/** True when `text` carries any known transient-upstream signature. */
export function isTransientFailureText(text: string | null | undefined): boolean {
  const lowered = (text ?? '').toLowerCase();
  if (lowered === '') return false;
  return TRANSIENT_SIGNATURES.some((sig) => lowered.includes(sig));
}

/**
 * TOTAL tries allowed per run-item (initial dispatch + retries).
 * Env MIGRATION_SPEC_RETRY_MAX_ATTEMPTS, default 3; parsed defensively
 * (mirrors the IVS knob-parsing posture — a bad value falls back, never throws).
 */
export function maxRetryAttempts(defaultValue = 3): number {
  const raw = process.env.MIGRATION_SPEC_RETRY_MAX_ATTEMPTS;
  const parsed = raw === undefined ? NaN : Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return defaultValue;
  return parsed;
}

/**
 * The backoff schedule (seconds) between tries; the LAST entry repeats for any
 * further attempts. Env MIGRATION_SPEC_RETRY_BACKOFF_SECONDS, default "60,180"
 * (short gaps per the spec ruling); bad entries are skipped, an entirely bad
 * value falls back to the default.
 */
export function retryBackoffSeconds(defaultValue = '60,180'): number[] {
  const raw = process.env.MIGRATION_SPEC_RETRY_BACKOFF_SECONDS ?? defaultValue;
  const delays: number[] = [];
  for (const part of String(raw).split(',')) {
    const value = Number.parseFloat(part.trim());
    if (Number.isFinite(value) && value >= 0) delays.push(value);
  }
  return delays.length > 0 ? delays : [60, 180];
}

/**
 * Milliseconds to wait BEFORE dispatch attempt `nextAttemptNumber` (2-based:
 * attempt 1 is the original dispatch and has no delay). Attempt 2 waits
 * schedule[0], attempt 3 waits schedule[1], beyond that the last entry repeats.
 */
export function backoffMsBeforeAttempt(nextAttemptNumber: number): number {
  const schedule = retryBackoffSeconds();
  const index = Math.max(0, Math.min(nextAttemptNumber - 2, schedule.length - 1));
  return Math.round(schedule[index] * 1000);
}

/** Inputs for the auto-retry decision (see {@link shouldAutoRetry}). */
export interface AutoRetryDecisionInput {
  /** The raw build-results outcome ('failed' | 'error' | 'rejected' | ...). */
  outcome: string;
  /** The R1 classifier verdict, when the callback carried one. */
  failureClass?: string | null;
  /** The callback summary (scanned when no failure_class is present). */
  summary?: string | null;
  /** Optional extra error text (same scan; the door has none today). */
  errors?: string[] | null;
  /**
   * Dispatch attempts ALREADY USED for this item, INCLUDING the attempt whose
   * failure is being judged (so the first failure arrives with attemptCount=1).
   */
  attemptCount: number;
}

/** The auto-retry decision + its human-readable reason (logged + persisted). */
export interface AutoRetryDecision {
  /** True -> schedule a re-dispatch instead of halting. */
  retry: boolean;
  /** True when the failure is classified transient (even if the budget is spent). */
  transient: boolean;
  /** WHY — logged and folded into the run-item error_detail. */
  reason: string;
}

/**
 * The single retry decision. Transient iff the R1 `failure_class` says
 * 'transient_upstream', OR the class is ABSENT and the local signature scan
 * matches the summary/errors. An explicit 'real' class never retries, and only
 * 'failed'/'error' outcomes are retryable at all ('rejected' is a human
 * verdict; 'fix_unserved'/'not_fixed' are bug-path terminals).
 */
export function shouldAutoRetry(input: AutoRetryDecisionInput): AutoRetryDecision {
  if (input.outcome !== 'failed' && input.outcome !== 'error') {
    return {
      retry: false,
      transient: false,
      reason: `outcome '${input.outcome}' is not retryable`,
    };
  }

  let transient: boolean;
  let source: string;
  if (input.failureClass === FAILURE_CLASS_TRANSIENT) {
    transient = true;
    source = 'IVS classifier';
  } else if (input.failureClass === FAILURE_CLASS_REAL) {
    // AUTHORITATIVE: the orchestrator judged the work itself failed.
    return { retry: false, transient: false, reason: 'IVS classified the failure as real' };
  } else {
    // No class on the wire — fall back to the local signature scan.
    const text = [input.summary ?? '', ...(input.errors ?? [])].join('\n');
    transient = isTransientFailureText(text);
    source = 'local signature scan (no failure_class on the callback)';
  }

  if (!transient) {
    return { retry: false, transient: false, reason: `no transient signature matched (${source})` };
  }

  const max = maxRetryAttempts();
  if (input.attemptCount >= max) {
    return {
      retry: false,
      transient: true,
      reason: `transient failure but the retry budget is exhausted (${input.attemptCount}/${max} tries)`,
    };
  }
  return {
    retry: true,
    transient: true,
    reason: `transient upstream failure (${source}); try ${input.attemptCount}/${max} failed`,
  };
}
