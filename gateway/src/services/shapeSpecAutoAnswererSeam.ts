/**
 * Shape-Spec Auto-Answerer seam (Spec 3).
 *
 * The Driver's per-spec runner (Task Group 2) drives the headless shape-spec
 * stream THROUGH this seam: it feeds the spec's combined `generated_spec_text`,
 * the auto-answerer answers each `questions` batch without a human (it DECIDES,
 * never abstains -- the LOCK), and on stream conclusion (`folder` + `session`)
 * returns the captured `spec_name` (folder) for the orchestration handoff, the
 * `session_id` (for the SpecIntent only -- CD-1), and the per-spec decision log
 * (CD-4).
 *
 * Task Group 4 OWNS the concrete implementation (the `requestStream` headless
 * drive + the `parseSSELine` event-union loop + the resume re-POST + the
 * architect-chassis answer tool). Task Group 2 depends ONLY on this interface,
 * so the runner is unit-testable with a mocked auto-answerer and the live-LLM
 * guard is respected (the LLM is only ever reached through the Group-4
 * implementation of this seam, mocked in tests).
 *
 * The {@link noopAutoAnswerer} default is a SAFE placeholder: until the Group-4
 * implementation is wired in, it returns a structured failure so a real run
 * halts cleanly rather than dispatching an unanswered spec. It NEVER throws.
 *
 * Spec: Migrate Button + Migration Execution Driver + External Shape-Spec
 * Auto-Answerer (2026-06-14, Spec 3 of 4) -- Task Group 2 (seam); Task Group 4
 * (implementation).
 */

import { logger } from './logger';

/** Inputs the runner hands the auto-answerer for one spec. */
export interface ShapeSpecAnswerInput {
  /** Owning project UUID (grounding scope). */
  projectId: string;
  /** Normalised organisation (shape-spec `company`). */
  company: string;
  /** Normalised product (shape-spec `project`). */
  project: string;
  /** The run-item the decision log is appended to (CD-4). */
  runItemId: string;
  /** The combined `/agent-os:shape-spec ...` body fed as the first message. */
  generatedSpecText: string;
}

/**
 * A single auto-answer decision (CD-4). The `question` / `answer` / `rationale`
 * fields are the documented shape surfaced in the run-progress view; the index
 * signature makes the decision JSONB-assignable (it is persisted inline on the
 * run-item as `auto_answer_decision_log_json`, AMS `List<Map<String,Object>>`).
 */
export interface AutoAnswerDecision {
  question: string;
  answer: string;
  rationale: string;
  [key: string]: unknown;
}

/** The result of driving + answering one spec's shape-spec stream. */
export interface ShapeSpecAnswerResult {
  /** True when the stream concluded and a `spec_name` (folder) was captured. */
  ok: boolean;
  /** The spec folder name (the `folder` event) -> SpecIntent.spec_name. */
  specName: string | null;
  /** The session id (the `session` event), ONLY for the orchestration handoff. */
  sessionId: string | null;
  /** The per-spec decision log appended to the run-item (CD-4). */
  decisionLog: AutoAnswerDecision[];
  /** Error detail on a non-concluded drive. */
  error?: string | null;
}

/** The auto-answerer seam the Driver's runner calls. */
export interface ShapeSpecAutoAnswerer {
  /**
   * Drive the headless shape-spec stream for one spec and answer every
   * `questions` batch automatically (deciding, never abstaining). Resolve on
   * stream conclusion with the captured `spec_name` + `session_id` + the
   * decision log. NEVER throws -- failures surface as `{ ok: false, error }`.
   */
  driveAndAnswer(input: ShapeSpecAnswerInput): Promise<ShapeSpecAnswerResult>;
}

/**
 * SAFE default until the Group-4 implementation is wired in. Returns a
 * structured failure so a real run halts cleanly (the Driver records the error
 * + marks the run halted) rather than dispatching an unanswered spec.
 */
export const noopAutoAnswerer: ShapeSpecAutoAnswerer = {
  async driveAndAnswer(input: ShapeSpecAnswerInput): Promise<ShapeSpecAnswerResult> {
    logger.warn('[diag-gateway] migration_execution_driver auto_answerer_not_wired', {
      projectId: input.projectId,
      runItemId: input.runItemId,
    });
    return {
      ok: false,
      specName: null,
      sessionId: null,
      decisionLog: [],
      error: 'Shape-spec auto-answerer (Task Group 4) is not wired in.',
    };
  },
};
