/**
 * Bounded-concurrency pool for Migration Delivery Plan LLM calls.
 *
 * Spec: 2026-06-11 Two-Phase Migration Delivery Plan Generation
 * (Skeleton → Expand) — Task Group 1.
 *
 * The Azure OpenAI relay enforces a hard ~300s request cap, and its behaviour
 * under multiple concurrent requests is UNKNOWN — hence the hard user
 * requirement that the number of in-flight LLM requests is configurable via
 * env alone: `MIGRATION_PLAN_LLM_CONCURRENCY` (default 4, tunable down to 1
 * for fully serial execution WITHOUT a code change).
 *
 * ONE shared pool instance ({@link getMigrationPlanLlmPool}) bounds ALL
 * migration-plan LLM traffic:
 *   - phase-1 per-stream skeleton calls (the per-stream split in
 *     `migrationBookOfWorkHandler.ts`), and
 *   - every phase-2 call (expansion batches, judge passes, bespoke rewrites),
 * so total in-flight LLM requests never exceed the configured limit no matter
 * how many epics expand concurrently during "Expand all".
 *
 * Deliberately small and purpose-built: a fixed in-flight limit with a FIFO
 * wait queue. NO general job/queue framework, no persistence, no priorities —
 * all explicitly out of scope per the spec.
 */

import { getConfig } from '../config';

/**
 * A minimal bounded-concurrency pool. Submit async tasks via
 * {@link LlmConcurrencyPool.run}; at most `limit` tasks execute at once, the
 * rest wait in FIFO submission order. A task's rejection propagates to its
 * own caller and never stalls the pool — the next queued task starts as soon
 * as the slot frees.
 */
export class LlmConcurrencyPool {
  private readonly limit: number;
  private inFlight = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(limit: number) {
    // Defensive clamp: a limit below 1 (misconfigured env) degrades to fully
    // serial rather than deadlocking the pool.
    this.limit = Number.isFinite(limit) && Math.floor(limit) >= 1 ? Math.floor(limit) : 1;
  }

  /** The configured maximum number of concurrently-executing tasks. */
  get concurrencyLimit(): number {
    return this.limit;
  }

  /** Number of tasks currently executing (diagnostics / tests). */
  get inFlightCount(): number {
    return this.inFlight;
  }

  /**
   * Run `task` under the pool's in-flight limit. Resolves/rejects with the
   * task's own outcome. Tasks acquire slots in submission (FIFO) order.
   */
  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.inFlight < this.limit) {
      this.inFlight += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.inFlight += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.inFlight -= 1;
    const next = this.waiters.shift();
    if (next) {
      next();
    }
  }
}

/** Documented default for `MIGRATION_PLAN_LLM_CONCURRENCY` (see config.ts). */
export const DEFAULT_MIGRATION_PLAN_LLM_CONCURRENCY = 4;

// The ONE shared pool instance for the whole migration-plan flow (phase 1 +
// phase 2). Constructed lazily so importing this module never forces a config
// load at module-evaluation time.
let sharedMigrationPlanLlmPool: LlmConcurrencyPool | null = null;

/**
 * The shared migration-plan LLM pool, sized from
 * `MIGRATION_PLAN_LLM_CONCURRENCY` (default 4). Every migration-plan LLM call
 * — phase-1 skeleton-per-stream AND all phase-2 expansion/judge/rewrite calls
 * — MUST go through this single instance.
 */
export function getMigrationPlanLlmPool(): LlmConcurrencyPool {
  if (!sharedMigrationPlanLlmPool) {
    let limit = DEFAULT_MIGRATION_PLAN_LLM_CONCURRENCY;
    try {
      limit = getConfig().migrationPlanLlmConcurrency;
    } catch {
      // getConfig() throws when required LLM env vars are absent (e.g. unit
      // tests that inject their own callLlm). The pool itself has no env
      // dependency, so fall back to the documented default rather than fail
      // the flow on an unrelated config-validation error.
    }
    sharedMigrationPlanLlmPool = new LlmConcurrencyPool(limit);
  }
  return sharedMigrationPlanLlmPool;
}

/** Test seam: drop the shared instance so the next call re-reads config. */
export function resetMigrationPlanLlmPoolForTests(): void {
  sharedMigrationPlanLlmPool = null;
}
