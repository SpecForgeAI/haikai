/**
 * In-memory `runManager` -- per-session live run handle, abort signal, round
 * counter, wall-clock start. Mirrors `discovery-service/src/services/
 * runManager.ts` shape but pruned to the bits the api-migration-validation
 * service needs (no per-step persistence, no result merging -- AMS holds all
 * durable state).
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 4.
 * Spec: 2026-05-16 API Behaviour Capture Fixes -- adds `scenarioHttpAttempts`
 * counter (Decision D4) so `execute_http_request` can drive `attempt_number`
 * from a single source of truth rather than the discarded `ctx.retryCount`.
 *
 * The map is keyed by `sessionId` (NOT `runId` -- this service has no
 * separate run concept). Entries are added when a session transitions to
 * `running` and removed on terminal status (completed / failed / cancelled)
 * or on `cancel()` from the action endpoint.
 */

export interface RunState {
  sessionId: string;
  projectId: string;
  architectureId: string;
  /** Wall-clock start of the entire session (across scenarios). */
  startedAt: number;
  /**
   * Round counter for the CURRENT scenario. Reset by the loop runner when a
   * scenario starts; checked against `LLM_SCENARIO_ROUND_LIMIT`.
   */
  currentScenarioRounds: number;
  /**
   * HTTP attempt counter for the CURRENT scenario. Incremented by
   * `execute_http_request` at the top of every handler invocation. Reset at
   * each scenario boundary via `beginScenario`. Checked against
   * `LLM_HTTP_ATTEMPTS_PER_SCENARIO`.
   *
   * Spec: 2026-05-16 API Behaviour Capture Fixes -- D4.
   */
  scenarioHttpAttempts: number;
  /**
   * Wall-clock start of the CURRENT scenario. Reset by the loop runner when
   * a scenario starts; checked against `LLM_SCENARIO_WALL_CLOCK_MS`.
   */
  currentScenarioStartedAt: number;
  /** AbortController whose signal is wired into every per-tool axios call. */
  abortController: AbortController;
}

class RunManager {
  private readonly runs = new Map<string, RunState>();

  start(args: {
    sessionId: string;
    projectId: string;
    architectureId: string;
  }): RunState {
    if (this.runs.has(args.sessionId)) {
      throw new Error(`runManager: session already running: ${args.sessionId}`);
    }
    const now = Date.now();
    const state: RunState = {
      sessionId: args.sessionId,
      projectId: args.projectId,
      architectureId: args.architectureId,
      startedAt: now,
      currentScenarioRounds: 0,
      scenarioHttpAttempts: 0,
      currentScenarioStartedAt: now,
      abortController: new AbortController(),
    };
    this.runs.set(args.sessionId, state);
    return state;
  }

  get(sessionId: string): RunState | undefined {
    return this.runs.get(sessionId);
  }

  has(sessionId: string): boolean {
    return this.runs.has(sessionId);
  }

  /** Reset the per-scenario counters at scenario boundary. */
  beginScenario(sessionId: string): void {
    const r = this.runs.get(sessionId);
    if (!r) throw new Error(`runManager: no live run for session ${sessionId}`);
    r.currentScenarioRounds = 0;
    r.scenarioHttpAttempts = 0;
    r.currentScenarioStartedAt = Date.now();
  }

  /** Increment the per-scenario round counter and return the new value. */
  incrementScenarioRounds(sessionId: string): number {
    const r = this.runs.get(sessionId);
    if (!r) throw new Error(`runManager: no live run for session ${sessionId}`);
    r.currentScenarioRounds += 1;
    return r.currentScenarioRounds;
  }

  /**
   * Increment the per-scenario HTTP-attempt counter and return the new value.
   * Mirrors `incrementScenarioRounds` -- throws if the session has no live
   * run state.
   *
   * Spec: 2026-05-16 API Behaviour Capture Fixes -- D4.
   */
  incrementHttpAttempts(sessionId: string): number {
    const r = this.runs.get(sessionId);
    if (!r) throw new Error(`runManager: no live run for session ${sessionId}`);
    r.scenarioHttpAttempts += 1;
    return r.scenarioHttpAttempts;
  }

  /**
   * Read the current per-scenario HTTP-attempt counter without incrementing.
   * Returns `undefined` when no run is live for this session. (Read access
   * is also available via `get(sessionId)?.scenarioHttpAttempts`.)
   */
  getScenarioHttpAttempts(sessionId: string): number | undefined {
    return this.runs.get(sessionId)?.scenarioHttpAttempts;
  }

  /** Trigger the per-session abort signal -- causes in-flight tool calls to reject. */
  cancel(sessionId: string): boolean {
    const r = this.runs.get(sessionId);
    if (!r) return false;
    r.abortController.abort();
    return true;
  }

  /** Remove a session entry. Called by the orchestrator on terminal status. */
  end(sessionId: string): void {
    this.runs.delete(sessionId);
  }

  /** Diagnostic: list every live session id. */
  listLive(): string[] {
    return Array.from(this.runs.keys());
  }
}

export const runManager = new RunManager();

/** Exported for tests. */
export { RunManager };
