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
 * Spec: 2026-06-16 Reconcile-Time Determinism & Volatile-Value Handling --
 * adds `scenarioCapturesPersisted` so the orchestrator can tell whether a
 * scenario actually persisted any capture rows (misleading-COMPLETED fix).
 * Spec: 2026-06-17 Intent-Driven Canonical Capture -- adds `scenarioCaptures`
 * (the per-scenario list of { captureId, status }) so the orchestrator can,
 * AFTER the per-scenario loop exits, pick the ONE canonical capture matching
 * the scenario's intended outcome and reject-and-hide the LLM's intermediate
 * fumbles (a 400 it later corrected to a 200, etc.).
 * Spec: 2026-06-18 Stateful Sequence Scenarios (Spec D) -- each recorded
 * capture additionally carries the captured request/response shape so the
 * orchestrator can assemble a pinned sequence's `sequence_json` from the
 * ordered scenario captures; adds the per-scenario `pinnedSequence`
 * declaration the new `pin_sequence` terminal tool records.
 *
 * The map is keyed by `sessionId` (NOT `runId` -- this service has no
 * separate run concept). Entries are added when a session transitions to
 * `running` and removed on terminal status (completed / failed / cancelled)
 * or on `cancel()` from the action endpoint.
 */

/**
 * The captured request/response shape carried alongside a recorded capture so
 * the orchestrator can assemble a pinned sequence's `sequence_json` from the
 * ordered scenario captures. All fields are already secret-redacted by
 * `execute_http_request` before this is recorded.
 *
 * Spec: 2026-06-18 Stateful Sequence Scenarios (Spec D).
 */
export interface ScenarioCaptureData {
  method: string;
  path: string;
  query: Record<string, unknown> | null;
  headers: Record<string, string> | null;
  body: unknown;
  responseStatus: number | null;
  responseHeaders: Record<string, string> | null;
  responseBody: unknown;
}

/**
 * One persisted capture from the CURRENT scenario, recorded by
 * `execute_http_request` immediately after a `createCapture` write succeeds.
 * `status` is the HTTP response status (`null` on a transport / auth failure
 * that produced no response). The orchestrator reads the ordered list after
 * the per-scenario loop exits to pick the canonical capture by the scenario's
 * intended `expectedStatus` and reject the rest.
 *
 * `data` (Spec D) is the optional captured request/response shape used to
 * assemble a pinned sequence's `sequence_json`; absent for older callers /
 * test mocks that did not supply it (the canonical-capture selection only
 * needs the id + status).
 *
 * Spec: 2026-06-17 Intent-Driven Canonical Capture.
 */
export interface ScenarioCaptureRef {
  captureId: string;
  status: number | null;
  data?: ScenarioCaptureData;
}

/**
 * The declarative sequence pin the `pin_sequence` terminal tool records for
 * the CURRENT scenario. The LLM is the only actor that knows which executed
 * captures were setup/act/cleanup and which response fields are referenced by
 * a later step (`$N.<jsonpath>`); replay never re-derives them. The
 * orchestrator reads this after the per-scenario loop exits and assembles the
 * persisted `sequence_json` from it + the ordered `scenarioCaptures`.
 *
 * `steps[i].captureIndex` is the 0-based index into the ordered
 * `scenarioCaptures` list that this step's executed call corresponds to.
 *
 * Spec: 2026-06-18 Stateful Sequence Scenarios (Spec D).
 */
export interface PinnedSequenceStepDeclaration {
  /** Index into the ordered `scenarioCaptures` list for this step's call. */
  captureIndex: number;
  role: 'setup' | 'act' | 'cleanup';
  /** Only `'http'` is implemented; reserved `'sql'`/`'e2e'` are rejected. */
  kind: string;
  expectedStatus: number;
  /** Inter-step references: a field pulled from an EARLIER step's response. */
  responseRefs?: Array<{ ref: string; fromStep: number; jsonPath: string }>;
}

export interface PinnedSequenceDeclaration {
  steps: PinnedSequenceStepDeclaration[];
  /** Step index (into `steps`) of the single ACT step. */
  actStepIndex: number;
  cleanupBestEffort?: boolean;
}

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
  /** Item #3 (2026-08-27): setup calls (non-target endpoints) count here,
   *  never against the target-attempt budget. */
  scenarioSetupAttempts: number;
  /**
   * Count of capture rows SUCCESSFULLY persisted for the CURRENT scenario.
   * Incremented by `execute_http_request` immediately after a `createCapture`
   * write succeeds; reset at each scenario boundary via `beginScenario`.
   *
   * Spec: 2026-06-16 Reconcile-Time Determinism & Volatile-Value Handling --
   * misleading-COMPLETED follow-up.
   */
  scenarioCapturesPersisted: number;
  /**
   * Ordered list of capture rows persisted for the CURRENT scenario (one entry
   * per successful `createCapture`, in attempt order). Reset at each scenario
   * boundary via `beginScenario`.
   *
   * Spec: 2026-06-17 Intent-Driven Canonical Capture.
   */
  scenarioCaptures: ScenarioCaptureRef[];
  /**
   * The declarative sequence pin recorded by `pin_sequence` for the CURRENT
   * scenario, or null when the scenario was a single-shot (no pin). Reset at
   * each scenario boundary via `beginScenario`.
   *
   * Spec: 2026-06-18 Stateful Sequence Scenarios (Spec D).
   */
  pinnedSequence: PinnedSequenceDeclaration | null;
  /**
   * Wall-clock start of the CURRENT scenario. Reset by the loop runner when
   * a scenario starts; checked against `LLM_SCENARIO_WALL_CLOCK_MS`.
   */
  currentScenarioStartedAt: number;
  /**
   * Session-level learned facts accumulated ACROSS scenarios (NOT reset by
   * beginScenario), recorded by execute_http_request as concise, secret-redacted
   * lines. Threaded into each scenario's prompt so the LLM reuses what worked
   * and stops repeating what the API already rejected (cross-scenario
   * learning). Capped to recent entries.
   */
  learnedFacts: string[];
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
      scenarioSetupAttempts: 0,
      scenarioCapturesPersisted: 0,
      scenarioCaptures: [],
      pinnedSequence: null,
      currentScenarioStartedAt: now,
      learnedFacts: [],
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
    r.scenarioSetupAttempts = 0;
    r.scenarioCapturesPersisted = 0;
    // Canonical-capture selection is per-scenario, so the recorded capture
    // list starts empty at every scenario boundary alongside the counters.
    r.scenarioCaptures = [];
    // The pinned sequence is per-scenario too -- a new scenario starts unpinned.
    r.pinnedSequence = null;
    r.currentScenarioStartedAt = Date.now();
    // NOTE: learnedFacts is session-level cross-scenario memory -- deliberately
    // NOT reset here.
  }

  /**
   * Record a session-level learned fact, deduped and capped to the most recent
   * 40. NOT reset per scenario. No-op if the session has no live run.
   */
  recordLearnedFact(sessionId: string, fact: string): void {
    const r = this.runs.get(sessionId);
    if (!r || !fact) return;
    if (r.learnedFacts.includes(fact)) return;
    r.learnedFacts.push(fact);
    if (r.learnedFacts.length > 40) r.learnedFacts.shift();
  }

  /** The session-level learned facts accumulated across scenarios. */
  getLearnedFacts(sessionId: string): string[] {
    return this.runs.get(sessionId)?.learnedFacts ?? [];
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
   *
   * Spec: 2026-05-16 API Behaviour Capture Fixes -- D4.
   */
  incrementSetupAttempts(sessionId: string): number {
    const r = this.runs.get(sessionId);
    if (!r) return 0;
    r.scenarioSetupAttempts += 1;
    return r.scenarioSetupAttempts;
  }

  incrementHttpAttempts(sessionId: string): number {
    const r = this.runs.get(sessionId);
    if (!r) throw new Error(`runManager: no live run for session ${sessionId}`);
    r.scenarioHttpAttempts += 1;
    return r.scenarioHttpAttempts;
  }

  /**
   * Read the current per-scenario HTTP-attempt counter without incrementing.
   */
  getScenarioHttpAttempts(sessionId: string): number | undefined {
    return this.runs.get(sessionId)?.scenarioHttpAttempts;
  }

  /**
   * Increment the per-scenario persisted-capture counter and return the new
   * value. Called by `execute_http_request` only AFTER a `createCapture`
   * write has succeeded.
   *
   * Spec: 2026-06-16 Reconcile-Time Determinism & Volatile-Value Handling --
   * misleading-COMPLETED follow-up.
   */
  incrementCapturesPersisted(sessionId: string): number {
    const r = this.runs.get(sessionId);
    if (!r) throw new Error(`runManager: no live run for session ${sessionId}`);
    r.scenarioCapturesPersisted += 1;
    return r.scenarioCapturesPersisted;
  }

  /**
   * Read the current per-scenario persisted-capture counter without
   * incrementing.
   *
   * Spec: 2026-06-16 Reconcile-Time Determinism & Volatile-Value Handling --
   * misleading-COMPLETED follow-up.
   */
  getScenarioCapturesPersisted(sessionId: string): number | undefined {
    return this.runs.get(sessionId)?.scenarioCapturesPersisted;
  }

  /**
   * Record one persisted capture (id + HTTP status, plus the optional captured
   * request/response `data` used for sequence assembly) for the CURRENT
   * scenario, in attempt order. Called by `execute_http_request` immediately
   * after a `createCapture` write succeeds. No-op when the session has no live
   * run (defensive -- a missing run must never break capture persistence).
   *
   * Spec: 2026-06-17 Intent-Driven Canonical Capture (id + status);
   *       2026-06-18 Stateful Sequence Scenarios (Spec D) -- optional `data`.
   */
  recordScenarioCapture(
    sessionId: string,
    captureId: string,
    status: number | null,
    data?: ScenarioCaptureData,
  ): void {
    const r = this.runs.get(sessionId);
    if (!r) return;
    r.scenarioCaptures.push(data ? { captureId, status, data } : { captureId, status });
  }

  /**
   * Read the ordered per-scenario capture list without mutating it. Returns an
   * empty array when no run is live for this session.
   *
   * Spec: 2026-06-17 Intent-Driven Canonical Capture.
   */
  getScenarioCaptures(sessionId: string): ScenarioCaptureRef[] {
    return this.runs.get(sessionId)?.scenarioCaptures ?? [];
  }

  /**
   * Record the declarative sequence pin for the CURRENT scenario (the
   * `pin_sequence` terminal tool's output). Overwrites any prior pin for the
   * scenario (the LLM pins once at the end). No-op when the session has no
   * live run.
   *
   * Spec: 2026-06-18 Stateful Sequence Scenarios (Spec D).
   */
  recordPinnedSequence(sessionId: string, declaration: PinnedSequenceDeclaration): void {
    const r = this.runs.get(sessionId);
    if (!r) return;
    r.pinnedSequence = declaration;
  }

  /**
   * Read the per-scenario pinned-sequence declaration, or null when the
   * current scenario was a single-shot (no pin) or no run is live.
   *
   * Spec: 2026-06-18 Stateful Sequence Scenarios (Spec D).
   */
  getPinnedSequence(sessionId: string): PinnedSequenceDeclaration | null {
    return this.runs.get(sessionId)?.pinnedSequence ?? null;
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
