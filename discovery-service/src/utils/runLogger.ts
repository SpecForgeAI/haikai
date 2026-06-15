/**
 * Structured Logger Utility for Discovery Run-Level Events
 *
 * Spec: Discovery Refinement, Consolidation, and System Hardening (Increment 16)
 * Task Group 6: Structured Logging, Diagnostics Endpoint, and Request Logger
 *
 * Emits structured JSON log entries via console.log for container-friendly
 * logging. Each log entry includes runId, projectId, and event metadata
 * for queryability in aggregated log systems.
 *
 * Event types:
 *   - step_start: Emitted before a step begins execution
 *   - step_complete: Emitted after a step finishes successfully
 *   - step_failed: Emitted when a step throws an error
 *   - run_complete: Emitted when the entire run completes successfully
 *   - run_failed: Emitted when the run terminates due to a step failure
 */

/**
 * Supported structured log event types for discovery runs.
 */
export type RunEventType =
  | 'step_start'
  | 'step_complete'
  | 'step_failed'
  | 'run_complete'
  | 'run_failed'
  | 'run_resume';

/**
 * Parameters for a structured run log event.
 */
export interface RunEventParams {
  /** The discovery run UUID */
  runId: string;
  /** The project UUID */
  projectId: string;
  /** The step identifier (e.g., '1a', '1b') -- omitted for run-level events */
  step?: string;
  /** The event type */
  event: RunEventType;
  /** ISO-8601 timestamp of the event */
  timestamp: string;
  /** Wall-clock duration in milliseconds (for step_complete, step_failed, run_complete, run_failed) */
  durationMs?: number;
  /** Counts associated with the step result (e.g., evidence, relationship, cluster, candidate counts) */
  counts?: Record<string, number>;
  /** Error message (for step_failed, run_failed) */
  error?: string;
  /** Error stack trace (for step_failed, run_failed) */
  stack?: string;
}

/**
 * Emits a structured JSON log entry for a discovery run event.
 *
 * Outputs the event as a single-line JSON string via console.log,
 * suitable for container log aggregation and structured querying.
 *
 * @param params - The structured event parameters
 */
export function logRunEvent(params: RunEventParams): void {
  const entry: Record<string, unknown> = {
    runId: params.runId,
    projectId: params.projectId,
    event: params.event,
    timestamp: params.timestamp,
  };

  if (params.step !== undefined) {
    entry.step = params.step;
  }

  if (params.durationMs !== undefined) {
    entry.durationMs = params.durationMs;
  }

  if (params.counts !== undefined) {
    entry.counts = params.counts;
  }

  if (params.error !== undefined) {
    entry.error = params.error;
  }

  if (params.stack !== undefined) {
    entry.stack = params.stack;
  }

  console.log(JSON.stringify(entry));
}
