/**
 * In-memory coverage-closure run store (2026-09-02). Keyed by `sessionId` —
 * one closure run per session at a time.
 *
 * Why this exists: `retry-uncovered` used to run its multi-minute closure
 * (Pass A + Pass B + dimensional retries + auth reprobe) INSIDE the request
 * handler and only then respond. The gateway proxies that as a single fetch
 * with default (~5 min) timeouts, so a long closure surfaced as a false
 * `503 "API migration validation service unavailable"` banner while the run
 * kept going and finished in the background — the operator only saw the real
 * outcome by refreshing the whole screen. The route now responds 202 and
 * records progress here; the frontend polls `closure-status` until terminal.
 *
 * Same posture as `secretsStore` / `oasInventoryStore`: in-memory only, lost
 * on process restart. A poll that finds no entry (404) means "the record is
 * gone — refresh the session for the durable outcome": the closure's coverage
 * patch persists to AMS at the end of the run, so the session row is always
 * the durable truth.
 */

export type ClosureRunStatus = 'running' | 'completed' | 'failed';

export interface ClosureRunEntry {
  closureRunId: string;
  status: ClosureRunStatus;
  startedAt: string;
  completedAt: string | null;
  /** The full synchronous-era response body, present when `completed`. */
  result: Record<string, unknown> | null;
  /** Failure message, present when `failed`. */
  error: string | null;
}

class ClosureRunStore {
  private readonly runs = new Map<string, ClosureRunEntry>();

  begin(sessionId: string, closureRunId: string): ClosureRunEntry {
    const entry: ClosureRunEntry = {
      closureRunId,
      status: 'running',
      startedAt: new Date().toISOString(),
      completedAt: null,
      result: null,
      error: null,
    };
    this.runs.set(sessionId, entry);
    return entry;
  }

  complete(sessionId: string, result: Record<string, unknown>): void {
    const entry = this.runs.get(sessionId);
    if (!entry) return;
    this.runs.set(sessionId, {
      ...entry,
      status: 'completed',
      completedAt: new Date().toISOString(),
      result,
      error: null,
    });
  }

  fail(sessionId: string, error: string): void {
    const entry = this.runs.get(sessionId);
    if (!entry) return;
    this.runs.set(sessionId, {
      ...entry,
      status: 'failed',
      completedAt: new Date().toISOString(),
      result: null,
      error,
    });
  }

  get(sessionId: string): ClosureRunEntry | undefined {
    return this.runs.get(sessionId);
  }

  /** True when a run is currently in flight for the session. */
  isRunning(sessionId: string): boolean {
    return this.runs.get(sessionId)?.status === 'running';
  }

  /** Test-only: drop every entry. */
  clearAll(): void {
    this.runs.clear();
  }
}

export const closureRunStore = new ClosureRunStore();

/** Exported for tests. */
export { ClosureRunStore };
