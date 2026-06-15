/**
 * TypeScript type definitions for conversation transcript persistence.
 *
 * Spec 2026-01-14: Implement Assistant Stage 7 - Full Conversation and Execution Persistence to Disk
 * Spec 2026-01-16: Implement Assistant Conversation Persistence and Rehydration
 *
 * Spec 2026-02-06: Implement-Part Sequencing Workflow
 * - Added SplitPlan interface for part-based workflow state
 * - Extended ConversationTranscript with optional splitPlan field
 *
 * These types define the structure for capturing the complete conversation lifecycle
 * including system prompts, user messages, assistant responses, handoff plans, and
 * orchestration execution records.
 */

import { Part, PartStatus } from './chat';

// ============================================================================
// Transcript Role Types
// ============================================================================

/**
 * Role of a transcript entry.
 * - SYSTEM: System prompt sent to the LLM
 * - USER: User message from the frontend
 * - ASSISTANT: LLM response content
 * - PLANNER_HANDOFF: Final validated handoff plan JSON
 * - ORCHESTRATION: Orchestration execution request/response record
 */
export type TranscriptRole =
  | 'SYSTEM'
  | 'USER'
  | 'ASSISTANT'
  | 'PLANNER_HANDOFF'
  | 'ORCHESTRATION';

// ============================================================================
// Transcript Phase Types
// ============================================================================

/**
 * Phase of a transcript entry within the implement_feature workflow.
 * - bootstrap: Initial context loading phase
 * - refine: Exploratory dialog phase for requirement clarification
 * - handoff: Transition phase to spec generation
 * - implementation_planning: Plan generation phase (Spec 2026-01-22)
 * - test_planning: Test Engineer review phase for adding test definitions
 * - generate_specs: JSON spec commands generation
 * - implementation_clarification: SA per-increment clarification (Spec 2026-01-23)
 */
export type TranscriptPhase =
  | 'bootstrap'
  | 'refine'
  | 'handoff'
  | 'implementation_planning'
  | 'test_planning'
  | 'test_planning_holistic'
  | 'generate_specs'
  | 'implementation_clarification';

// ============================================================================
// Message Entry Role Types (for JSON serialization)
// ============================================================================

/**
 * Lowercase role names for MessageEntry JSON serialization.
 * Used in conversation.json for rehydration purposes.
 *
 * Spec 2026-01-16: Maps to TranscriptRole but uses lowercase for JSON compatibility.
 */
export type MessageEntryRole = 'system' | 'user' | 'assistant';

// ============================================================================
// Transcript Entry Interface
// ============================================================================

/**
 * A single entry in the conversation transcript.
 * Each entry captures a moment in the conversation lifecycle with
 * timestamp, phase, role, and content.
 */
export interface TranscriptEntry {
  /** ISO-8601 timestamp of when this entry was created */
  timestamp: string;
  /** Phase of the conversation when this entry was created */
  phase: TranscriptPhase;
  /** Role/type of this entry */
  role: TranscriptRole;
  /** Content of the entry (message text, JSON, or structured record) */
  content: string;
}

// ============================================================================
// Message Entry Interface (for JSON serialization)
// ============================================================================

/**
 * A message entry for conversation.json persistence and rehydration.
 *
 * Spec 2026-01-16: Implement Assistant Conversation Persistence and Rehydration
 *
 * This type aligns with TranscriptEntry but uses lowercase role names for JSON
 * serialization compatibility. It excludes PLANNER_HANDOFF and ORCHESTRATION
 * roles which are not needed for conversation rehydration.
 *
 * Structure:
 * - role: "system" | "user" | "assistant" (lowercase for JSON)
 * - phase: TranscriptPhase (bootstrap | refine | handoff | implementation_planning | test_planning | implementation_clarification)
 * - content: The message content
 * - timestamp: ISO-8601 timestamp
 */
export interface MessageEntry {
  /** Lowercase role for JSON serialization: "system", "user", or "assistant" */
  role: MessageEntryRole;
  /** Phase of the conversation when this entry was created */
  phase: TranscriptPhase;
  /** Content of the message */
  content: string;
  /** ISO-8601 timestamp of when this entry was created */
  timestamp: string;
}

// ============================================================================
// Split Plan Types
// Spec 2026-02-06: Implement-Part Sequencing Workflow
// ============================================================================

/**
 * Timestamp tracking for a single part's execution lifecycle.
 *
 * Spec 2026-02-06: Implement-Part Sequencing Workflow
 */
export interface PartTimestamp {
  /** ISO-8601 timestamp when Q&A started for this part */
  startedAt?: string;
  /** ISO-8601 timestamp when orchestration completed for this part */
  completedAt?: string;
}

/**
 * Split plan state for part-based implementation workflow.
 *
 * This interface captures the complete state of a split implementation plan
 * including parts, their statuses, timestamps, job IDs, and per-part transcripts.
 *
 * State is stored in-memory as part of ConversationTranscript and persisted
 * to disk when writeTranscriptToFile is called.
 *
 * Spec 2026-02-06: Implement-Part Sequencing Workflow
 */
export interface SplitPlan {
  /** Array of implementation parts (derived from ImplementationPlan.increments) */
  parts: Part[];

  /**
   * Status of each part, keyed by partIndex (1-based).
   * Example: { 1: 'COMPLETED', 2: 'QA_IN_PROGRESS', 3: 'PENDING' }
   */
  partStatuses: Record<number, PartStatus>;

  /**
   * Timestamps for each part's lifecycle, keyed by partIndex.
   * Tracks when Q&A started and when orchestration completed.
   */
  partTimestamps: Record<number, PartTimestamp>;

  /**
   * Job IDs for orchestration jobs, keyed by partIndex.
   * Only populated after job creation during ORCHESTRATING phase.
   * Example: { 1: 'job-abc-123', 2: 'job-def-456' }
   */
  partJobIds: Record<number, string>;

  /**
   * Per-part conversation transcripts, keyed by partIndex.
   * Each part has its own Q&A history for the shape-spec session.
   * Example: { 1: [entry1, entry2], 2: [entry3] }
   */
  partTranscripts: Record<number, TranscriptEntry[]>;
}

// ============================================================================
// Conversation Transcript Interface
// ============================================================================

/**
 * Complete conversation transcript for a session.
 * Contains all entries captured during an implement_feature conversation
 * from bootstrap through orchestration execution.
 *
 * Spec 2026-02-06: Added optional splitPlan field for part-based workflow state.
 */
export interface ConversationTranscript {
  /** Session ID this transcript belongs to */
  sessionId: string;
  /** Array of transcript entries in chronological order */
  entries: TranscriptEntry[];
  /** ISO-8601 timestamp of when this transcript was created */
  createdAt: string;

  /**
   * Split plan state for part-based implementation workflow.
   * Only present when the implementation plan uses isSplit=true.
   * Contains parts, statuses, timestamps, job IDs, and per-part transcripts.
   *
   * Spec 2026-02-06: Implement-Part Sequencing Workflow
   */
  splitPlan?: SplitPlan;
}
