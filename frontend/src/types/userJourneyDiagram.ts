/**
 * User Journey Diagram TypeScript Interfaces
 *
 * Mirrors the backend Java record DTOs with snake_case field names matching
 * the @JsonProperty annotations. These types define the data contract for
 * temporary User Journey diagrams fetched from the architecture-model-service.
 *
 * Spec 2026-04-03: User Journey Temporary Diagram Selection and Review Flow
 * Task Group 1, Task 1.2: TypeScript interfaces for UserJourneyDiagramDto contract
 */

// ============================================================================
// Journey Metadata
// ============================================================================

/**
 * Journey metadata DTO.
 * Contains the journey name, description, linked user role, and parent business process.
 */
export interface UserJourneyDiagramJourneyDto {
  id: string;
  name: string;
  description: string;
  user_role_id: string;
  user_role_name: string;
  parent_business_process_id: string;
  parent_business_process_name: string;
}

// ============================================================================
// Lane
// ============================================================================

/**
 * Lane DTO.
 * Each lane corresponds to a unique Application referenced by the journey's ActivitySteps.
 */
export interface UserJourneyDiagramLaneDto {
  id: string;
  name: string;
  order: number;
}

// ============================================================================
// Step
// ============================================================================

/**
 * Step DTO.
 * Each step corresponds to one ActivityStep, ordered by sequence_order within a lane.
 */
export interface UserJourneyDiagramStepDto {
  id: string;
  journey_id: string;
  order: number;
  lane_id: string;
  process_activity_id: string;
  process_activity_name: string;
  name: string;
  diagram_label: string;
  description: string;
  business_user_id: string;
  business_user_name: string;
  activity_issues: string;
  ui_issues: string;
  /** Frontend-enriched: user interaction level from ProcessActivity */
  user_interaction_level?: 'AUTOMATED' | 'MINIMAL' | 'MODERATE' | 'SIGNIFICANT';
  /** Frontend-enriched: frequency from ProcessActivity */
  frequency?: string;
  /** Frontend-enriched: abbreviation(s) of co-worker business user roles on same activity */
  co_worker_abbreviations?: string[];
  /** Frontend-enriched: co-worker links with abbreviation and their user journey ID for navigation */
  co_worker_links?: CoWorkerLink[];
}

/**
 * Link data for a co-worker on the same process activity.
 * Used to render clickable abbreviations that navigate to the co-worker's journey diagram.
 */
export interface CoWorkerLink {
  abbreviation: string;
  user_journey_id: string;
}

// ============================================================================
// Edge
// ============================================================================

/**
 * Edge DTO.
 * Edges connect sequential steps in the journey flow.
 */
export interface UserJourneyDiagramEdgeDto {
  id: string;
  from_step_id: string;
  to_step_id: string;
  order: number;
  is_cross_lane: boolean;
}

// ============================================================================
// Render Hints
// ============================================================================

/**
 * Render hints DTO.
 * Contains static layout hints for downstream consumers.
 */
export interface UserJourneyDiagramRenderHintsDto {
  lane_axis: string;
  flow_direction: string;
  show_title: boolean;
}

// ============================================================================
// Top-Level Diagram DTO
// ============================================================================

/**
 * Top-level envelope DTO for the User Journey diagram contract v1.
 * Contains the complete diagram representation including journey metadata,
 * lanes, steps, edges, and render hints.
 */
export interface UserJourneyDiagramDto {
  diagram_type: string;
  version: string;
  journey: UserJourneyDiagramJourneyDto;
  lanes: UserJourneyDiagramLaneDto[];
  steps: UserJourneyDiagramStepDto[];
  edges: UserJourneyDiagramEdgeDto[];
  render_hints: UserJourneyDiagramRenderHintsDto;
}
