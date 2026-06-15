/**
 * Part Types for Frontend
 *
 * Spec 2026-02-06: Implement-Part Sequencing Workflow
 * Task Group 4: Frontend Part State Machine
 *
 * Type definitions for the part-based implementation workflow.
 * These types mirror the gateway types for Part and PartStatus.
 *
 * Spec 2026-06-12: Implementation-Service Init and Integration Repair
 * Task Group 5: Removed 'pending' from the JobStatus union (upstream contract
 * is queued|running|completed|failed|cancelled) and widened JobStatus to carry
 * the full JobDetailResponse pass-through (progress, result, logs_url,
 * started_at, completed_at).
 */

/**
 * A single implementation part within a split implementation plan.
 * Each part represents an independent, sequential unit of work with its own
 * Q&A session and orchestration job.
 *
 * Parts are processed sequentially: for each part, the UI sends details to
 * shape-spec/stream, collects Q&A, calls the orchestration job, polls until
 * complete, then advances to the next part.
 *
 * Spec 2026-02-06: Implement-Part Sequencing Workflow
 */
export interface Part {
  /** 1-based index of this part within the implementation plan */
  partIndex: number;
  /** Short descriptive title for this part */
  title: string;
  /** Detailed intent description for shape-spec handoff */
  intent: string;
  /**
   * Optional list of dependency references (e.g., "Part 1: Database Schema").
   * Used for context in the part payload but NOT for execution ordering
   * (parts are always executed sequentially).
   */
  dependencies?: string[];
}

/**
 * Status of a single part in the split implementation workflow.
 *
 * State transitions:
 * - PENDING: Initial state for all parts
 * - QA_IN_PROGRESS: When shape-spec Q&A starts for this part (session_mode="new")
 * - READY_TO_RUN: When SA indicates ready (no questions remaining)
 * - ORCHESTRATING: When orchestration job is created and polling begins
 * - COMPLETED: Job finished successfully, auto-advance to next part
 * - FAILED: Job failed or error occurred, requires manual intervention
 *
 * Spec 2026-02-06: Implement-Part Sequencing Workflow
 */
export type PartStatus =
  | 'PENDING'
  | 'QA_IN_PROGRESS'
  | 'READY_TO_RUN'
  | 'ORCHESTRATING'
  | 'COMPLETED'
  | 'FAILED';

/**
 * Progress information for a running orchestration job.
 * Mirrors the upstream JobProgress schema (all fields optional — the
 * implementation service may omit any of them).
 *
 * Spec 2026-06-12: Implementation-Service Init and Integration Repair
 */
export interface JobProgress {
  /** Index of the current step (1-based) */
  current_step?: number;
  /** Total number of steps */
  total_steps?: number;
  /** Human-readable description of the current step */
  step_description?: string;
  /** Completion percentage (0-100) */
  percentage?: number;
}

/**
 * Status of an orchestration job for polling purposes.
 *
 * Returned from GET /api/v2/jobs/{job_id} proxy route (a transparent
 * pass-through of the upstream JobDetailResponse).
 * Poll interval is 2 seconds (fixed, no backoff in v1).
 *
 * Spec 2026-02-06: Implement-Part Sequencing Workflow
 * Spec 2026-06-12: Removed 'pending'; added progress/result/logs_url/timestamps.
 */
export interface JobStatus {
  /** Current job status (upstream enum — 'pending' no longer exists) */
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  /** Error message when status is 'failed' (optional) */
  error?: string;
  /** Step-level progress while the job is running (optional) */
  progress?: JobProgress;
  /**
   * Job result payload on completion. UNTYPED upstream
   * (additionalProperties: true) — consume defensively via
   * extractGitOutcome; never assume specific keys exist.
   */
  result?: unknown;
  /** URL to the job's logs, when the upstream service provides one */
  logs_url?: string;
  /** ISO timestamp when the job started running */
  started_at?: string;
  /** ISO timestamp when the job reached a terminal state */
  completed_at?: string;
}
