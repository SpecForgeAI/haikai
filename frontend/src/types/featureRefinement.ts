/**
 * Feature Refinement Types
 *
 * Types for multi-story cycling in the refinement workflow.
 * When a user clicks "Refine" or "Refine and Implement" on a FEATURE,
 * the system cycles through the feature's child stories one at a time,
 * running the PM → TE flow for each. After all stories are refined,
 * a holistic TE review produces integration/E2E test definitions.
 */

import type { PlannerResponse, TestPlannerResponse } from '../api/chatApi';

/**
 * Phases of the multi-story refinement orchestration.
 *
 * - idle: No multi-story cycling active (standard mode or feature has no stories)
 * - story_refine: Cycling through child stories (PM → TE per story)
 * - holistic_review: TE reviews all story specs together, defines integration/E2E tests
 * - complete: All items refined
 */
export type RefinementPhase =
  | 'idle'
  | 'story_refine'
  | 'holistic_review'
  | 'complete';

/**
 * Refinement modes including the standalone holistic review.
 */
export type RefinementMode =
  | 'standard'
  | 'refine'
  | 'refine_and_implement'
  | 'holistic_only';

/**
 * Output captured from a single story's refinement.
 * Passed back via onRefinementComplete so the orchestration hook can accumulate results.
 */
export interface StoryRefinementOutput {
  storyId: string;
  storyTitle: string;
  plannerResponse: PlannerResponse | null;
  testPlannerResponse: TestPlannerResponse | null;
}

/**
 * Result recorded per story after its refinement completes.
 */
export interface StoryRefinementResult {
  storyId: string;
  storyTitle: string;
  completedAt: Date;
  plannerResponse: PlannerResponse | null;
  testPlannerResponse: TestPlannerResponse | null;
}

/**
 * Accumulated story data for the holistic TE review.
 * Passed to ImplementationAssistantPanel when in holistic_review phase.
 */
export interface HolisticReviewData {
  /** All story refinement results with their specs and test plans */
  storyResults: StoryRefinementResult[];
}

/**
 * Progress information for the multi-story cycling UI.
 */
export interface RefinementProgress {
  /** 1-based index of the current story */
  current: number;
  /** Total number of stories to refine */
  total: number;
  /** Current phase */
  phase: RefinementPhase;
  /** Human-readable label for progress display */
  label: string;
}
