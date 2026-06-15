/**
 * User Journey Overview Diagram TypeScript Interfaces
 *
 * Mirrors the backend Java record DTOs with snake_case field names matching
 * the @JsonProperty annotations. These types define the data contract for
 * the User Journey Overview parent diagram generated from existing Business
 * Architecture entities (USER_JOURNEY nodes grouped by Business Process lanes,
 * connected by USER_JOURNEY_LINK edges).
 *
 * Spec 2026-04-07: User Journey Overview Parent Diagram Generation
 * Task Group 4, Task 4.3: TypeScript interfaces for UserJourneyOverviewDiagramDto contract v1
 */

// ============================================================================
// Overview Header
// ============================================================================

/**
 * Overview header DTO.
 * Contains business user context and the generated title for the overview diagram.
 */
export interface UserJourneyOverviewHeaderDto {
  business_user_id: string;
  business_user_name: string;
  title: string;
}

// ============================================================================
// Lane
// ============================================================================

/**
 * Lane DTO.
 * Each lane corresponds to a unique Business Process that the selected
 * business user's journeys belong to. An "Unassigned" lane is used for
 * journeys with no parent business process.
 */
export interface UserJourneyOverviewLaneDto {
  id: string;
  name: string;
  order: number;
}

// ============================================================================
// Node Metadata
// ============================================================================

/**
 * Node metadata sub-interface.
 * Contains computed counts derived from the meta-model for each journey node.
 */
export interface UserJourneyOverviewNodeMetadataDto {
  step_count: number;
  application_count: number;
  relationship_in_count: number;
  relationship_out_count: number;
  /** Optional enriched application list (populated on frontend from meta-model) */
  applications?: { id: string; abbreviation: string }[];
}

// ============================================================================
// Node Link
// ============================================================================

/**
 * Node link sub-interface.
 * Contains parent-child diagram linking metadata resolved during projection.
 * Links connect overview journey nodes to their detailed child USER_JOURNEY diagrams.
 *
 * Spec 2026-04-07: User Journey Overview Parent-Child Diagram Linking
 * Task Group 3, Task 3.2
 */
export interface UserJourneyOverviewNodeLinkDto {
  /** ID of the linked child USER_JOURNEY diagram, null when UNLINKED */
  linked_diagram_id: string | null;
  /** Name of the linked child USER_JOURNEY diagram, null when UNLINKED */
  linked_diagram_name: string | null;
  /** Link resolution status: LINKED (exact match), UNLINKED (no match), AMBIGUOUS_RESOLVED (multiple matches, best selected) */
  link_status: 'LINKED' | 'UNLINKED' | 'AMBIGUOUS_RESOLVED';
}

// ============================================================================
// Node
// ============================================================================

/**
 * Node DTO.
 * Each node corresponds to one USER_JOURNEY entity belonging to the selected
 * business user, with metadata counts computed from the meta-model.
 */
export interface UserJourneyOverviewNodeDto {
  id: string;
  lane_id: string;
  name: string;
  description: string;
  primary_business_user_id: string;
  primary_business_user_name: string;
  parent_business_process_id: string;
  parent_business_process_name: string;
  metadata: UserJourneyOverviewNodeMetadataDto;
  /**
   * Optional parent-child diagram link metadata.
   * Present when the backend projection service resolves child diagram links.
   * Absent (undefined) for pre-increment-14 saved overviews -- treated as UNLINKED.
   *
   * Spec 2026-04-07: User Journey Overview Parent-Child Diagram Linking
   * Task Group 3, Task 3.3
   */
  link?: UserJourneyOverviewNodeLinkDto;
}

// ============================================================================
// Edge
// ============================================================================

/**
 * Edge DTO.
 * Each edge corresponds to one USER_JOURNEY_LINK relationship where both
 * source and target journeys belong to the selected business user's journey set.
 */
export interface UserJourneyOverviewEdgeDto {
  id: string;
  source_node_id: string;
  target_node_id: string;
  relationship_type: string;
  label: string;
  description: string;
}

// ============================================================================
// Render Hints
// ============================================================================

/**
 * Render hints DTO.
 * Contains static layout hints for the overview diagram renderer.
 */
export interface UserJourneyOverviewRenderHintsDto {
  lane_axis: string;
  flow_direction: string;
  show_title: boolean;
  show_lane_headers: boolean;
  show_node_description: boolean;
  show_relationship_labels: boolean;
}

// ============================================================================
// Summary Counts
// ============================================================================

/**
 * Summary counts DTO.
 * Contains the four derived counts used to compose the overview summary sentence.
 * Computed on the frontend from the enriched overview DTO data.
 *
 * Spec 2026-04-10: User Journey Overview Diagram Enhancements
 * Task Group 3, Task 3.2
 */
export interface OverviewSummaryCountsDto {
  /** A = number of journey nodes (dto.nodes.length) */
  journey_count: number;
  /** B = number of business process lanes, excluding the 'unassigned' lane */
  business_process_count: number;
  /** C = sum of all node.metadata.step_count values */
  activity_step_count: number;
  /** D = count of unique application IDs across all nodes' metadata.applications arrays */
  application_count: number;
}

// ============================================================================
// Related Colleague
// ============================================================================

/**
 * Related colleague DTO.
 * Represents a business user who shares BusinessPoints with the current overview's
 * business user, indicating they participate in overlapping business processes.
 *
 * Populated by frontend enrichment logic from meta-model data:
 * - Finds all business_point_ids linked to the current business_user_id
 * - Finds all OTHER business_user_ids linked to those same business_point_ids
 * - Resolves names from entities.business_users
 * - Determines has_overview by checking if the colleague has any user_journeys
 *
 * Spec 2026-04-10: User Journey Overview Diagram Enhancements
 * Task Group 2, Task 2.2
 */
export interface RelatedColleagueDto {
  /** The unique identifier of the related business user */
  business_user_id: string;
  /** The display name of the related business user */
  business_user_name: string;
  /** Whether this colleague has an overview diagram available (at least one user journey) */
  has_overview: boolean;
}

// ============================================================================
// Top-Level Overview Diagram DTO
// ============================================================================

/**
 * Top-level envelope DTO for the User Journey Overview diagram contract v1.
 * Contains the complete overview diagram representation including header,
 * lanes (one per Business Process), nodes (one per USER_JOURNEY), edges
 * (one per USER_JOURNEY_LINK), and render hints.
 */
export interface UserJourneyOverviewDiagramDto {
  diagram_type: string;
  version: string;
  overview: UserJourneyOverviewHeaderDto;
  lanes: UserJourneyOverviewLaneDto[];
  nodes: UserJourneyOverviewNodeDto[];
  edges: UserJourneyOverviewEdgeDto[];
  render_hints: UserJourneyOverviewRenderHintsDto;
  /**
   * Optional summary counts derived from the enriched overview data.
   * Computed on the frontend by the enrichment logic.
   *
   * Spec 2026-04-10: User Journey Overview Diagram Enhancements
   * Task Group 3, Task 3.2
   */
  summary_counts?: OverviewSummaryCountsDto;
  /**
   * Optional list of related colleagues who share BusinessPoints with this
   * overview's business user. Populated by frontend enrichment logic (not
   * from the backend projection).
   *
   * Spec 2026-04-10: User Journey Overview Diagram Enhancements
   * Task Group 2, Task 2.3
   */
  related_colleagues?: RelatedColleagueDto[];
}
