/**
 * Type definitions for the save_user_journeys MCP tool.
 * Used to persist user journeys and activity steps into the architecture model.
 * Follows the pattern from saveUsersInteractions.ts with added per-entity
 * CREATED/UPDATED status tracking and name-based FK reference resolution.
 */

// ============================================================================
// Request Type
// ============================================================================

export interface SaveUserJourneysRequest {
  sessionId: string;
  projectId: string;
  userJourneysJson: string;
}

// ============================================================================
// Input Payload Types (parsed from userJourneysJson)
// ============================================================================

export interface UserJourneysInput {
  user_journeys: UserJourneyInput[];
  process_activities?: ProcessActivityInput[];
  activity_steps?: ActivityStepInput[];
  user_journey_links?: UserJourneyLinkInput[];
}

export interface ProcessActivityInput {
  name: string;
  parent_business_process_name?: string;
  description?: string;
  frequency?: string;
  user_interaction_level?: string;
}

export interface UserJourneyInput {
  name: string;
  description?: string;
  primary_business_user_abbreviation?: string;
  parent_business_process_name?: string;
}

export interface ActivityStepInput {
  user_journey_name: string;
  process_activity_name: string;
  parent_business_process_name?: string;
  business_user_abbreviation: string;
  application_abbreviation: string;
  activity_step_name: string;
  diagram_label: string;
  sequence_order?: number;
  description?: string;
  activity_issues?: string;
  ui_issues?: string;
}

export interface UserJourneyLinkInput {
  source_user_journey_name: string;
  target_user_journey_name: string;
  relationship_type: string;
  relationship_label?: string;
  relationship_description?: string;
}

// ============================================================================
// Response Types
// ============================================================================

export type EntityStatus = 'CREATED' | 'UPDATED';

export interface UserJourneyEntityResult {
  name: string;
  id: string;
  status: EntityStatus;
}

export interface ActivityStepEntityResult {
  userJourneyName: string;
  sequenceOrder: number;
  id: string;
  status: EntityStatus;
}

export interface UserJourneyLinkEntityResult {
  sourceJourneyName: string;
  targetJourneyName: string;
  relationshipType: string;
  id: string;
  status: EntityStatus;
}

export interface SaveUserJourneysResponse {
  success: true;
  projectId: string;
  filename: string;
  summary: {
    userJourneys: { created: number; updated: number };
    activitySteps: { created: number; updated: number };
    userJourneyLinks: { created: number; updated: number };
    autoCreatedEntities: {
      businessUsers: number;
      businessProcesses: number;
      processActivities: number;
      applications: number;
    };
  };
  entities: {
    userJourneys: UserJourneyEntityResult[];
    activitySteps: ActivityStepEntityResult[];
    userJourneyLinks: UserJourneyLinkEntityResult[];
  };
}

// ============================================================================
// Error Response Type
// ============================================================================

export interface SaveUserJourneysValidationError {
  type: string;
  message: string;
  context: string;
}

export interface SaveUserJourneysErrorResponse {
  success: false;
  errors: SaveUserJourneysValidationError[];
}
