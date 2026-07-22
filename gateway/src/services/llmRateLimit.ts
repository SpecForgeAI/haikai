/**
 * LLM provider rate-limit handling (Spec 2026-07-22).
 *
 * Azure OpenAI enforces brute-force token quotas — a per-MINUTE limit and a
 * per-DAY limit — and returns HTTP 429 when either is hit (the capture loop is
 * the heaviest LLM consumer and reliably trips the per-minute one under load).
 * The two need OPPOSITE responses:
 *
 *   - per-minute: the window clears on its own in ~60s. Freeze ALL LLM traffic
 *     for a fixed 60s (a shared cool-down, not a per-call wait — one 429 must
 *     stop every other in-flight/subsequent LLM request too, exactly as the
 *     operator specified), then retry. Brute force by design — no exponential
 *     backoff; the limit is a flat per-minute ceiling.
 *   - per-day: waiting is pointless (hours away). Signal a distinct terminal
 *     error so the caller STOPS the whole capture cleanly and the operator
 *     resumes after reset (via the Coverage Closure "Retry uncovered APIs").
 *
 * The cool-down is a single module-level timestamp — the gateway is the one
 * chokepoint to Azure OpenAI, so every consumer (capture tool-loop, chat,
 * discovery) shares one honest view of "we are rate-limited until T".
 */
import { logger } from './logger';

/** Fixed per-minute freeze duration (ms). Env-overridable. */
export const LLM_RATE_LIMIT_WAIT_MS = parseInt(
  process.env.LLM_RATE_LIMIT_WAIT_MS || '60000',
  10,
);
/** Max per-minute waits inside ONE call before giving up (bounds the wait). */
export const LLM_RATE_LIMIT_MAX_WAITS = parseInt(
  process.env.LLM_RATE_LIMIT_MAX_WAITS || '2',
  10,
);

export type RateLimitKind = 'per_minute' | 'per_day';

/**
 * Classify a 429 body as a per-minute or per-day quota breach. Returns null for
 * a non-429. CONSERVATIVE: only explicit day markers ("per day", "daily",
 * "24 hour", "tokens per day") classify per-day (which STOPS the run); every
 * other 429 — including the explicit "Per min token limit exceeded" — is
 * per-minute (which only WAITS), so an ambiguous limit never wrongly aborts a
 * capture. Pure.
 */
export function classifyRateLimit(status: number, bodyText: string): RateLimitKind | null {
  if (status !== 429) return null;
  const t = (bodyText || '').toLowerCase();
  if (/per[\s-]*day|tokens?\s*per\s*day|daily|24\s*hour/.test(t)) return 'per_day';
  return 'per_minute';
}

/**
 * Thrown when Azure reports the per-DAY quota. Carries `status = 429` and the
 * `isDailyLimit` marker so the relay route can respond with a distinct
 * `reason: 'llm_daily_limit'` (vs a plain rate-limited 429) and the capture
 * orchestrator can stop the whole run rather than retry.
 */
export class LlmDailyLimitError extends Error {
  readonly status = 429;
  readonly isDailyLimit = true;
  constructor(message: string) {
    super(message);
    this.name = 'LlmDailyLimitError';
  }
}

// ---- Shared cool-down gate (module-level; one per gateway process) ----------
let cooldownUntil = 0;

/** ms remaining on the shared cool-down (0 when clear). */
export function getCooldownRemainingMs(now: number = Date.now()): number {
  return Math.max(0, cooldownUntil - now);
}

/** True while the shared cool-down is active. */
export function isCoolingDown(now: number = Date.now()): boolean {
  return getCooldownRemainingMs(now) > 0;
}

/**
 * Open (or extend) the shared cool-down: no LLM request proceeds for the next
 * `waitMs`. Idempotent under concurrency — the latest 429 wins the longer wait.
 */
export function openCooldown(now: number = Date.now(), waitMs: number = LLM_RATE_LIMIT_WAIT_MS): void {
  cooldownUntil = Math.max(cooldownUntil, now + waitMs);
  logger.warn(
    `[llmRateLimit] per-minute token limit hit — freezing all LLM traffic for ${Math.round(
      getCooldownRemainingMs(now) / 1000,
    )}s`,
  );
}

/** Clear the cool-down. Test-only. */
export function resetCooldown(): void {
  cooldownUntil = 0;
}

/** Await `ms` (module-level so callers/tests can spy). */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
