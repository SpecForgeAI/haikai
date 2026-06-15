/**
 * Type definitions for the save_users_interactions MCP tool.
 * Used to persist business users, business processes, process activities,
 * and UI screens into the architecture model.
 */

// ============================================================================
// Request Type
// ============================================================================

export interface SaveUsersInteractionsRequest {
  sessionId: string;
  projectId: string;
  usersInteractionsJson: string;
}

// ============================================================================
// Input Payload Types (parsed from usersInteractionsJson)
// ============================================================================

export interface UsersInteractionsInput {
  business_users?: BusinessUserInput[];
  business_processes?: BusinessProcessInput[];
  process_activities?: ProcessActivityInput[];
  ui_screens?: UIScreenInput[];
}

export interface BusinessUserInput {
  name: string;
  description?: string;
  abbreviation?: string;
}

export interface BusinessProcessInput {
  name: string;
  description?: string;
  userRefs?: string[];
}

export interface ProcessActivityInput {
  name: string;
  description?: string;
  processRef?: string;
  actorHint?: string;
  sequenceOrder?: number;
}

export interface UIScreenInput {
  name: string;
  route?: string;
  description?: string;
}

// ============================================================================
// Response Type
// ============================================================================

export interface SaveUsersInteractionsResponse {
  success: boolean;
  projectId: string;
  filename: string;
  summary: {
    businessUsers: number;
    businessProcesses: number;
    processActivities: number;
    uiScreens: number;
  };
  createdEntities: {
    businessUsers: Array<{ name: string; id: string }>;
    businessProcesses: Array<{ name: string; id: string }>;
    processActivities: Array<{ name: string; id: string }>;
    uiScreens: Array<{ name: string; id: string }>;
  };
}
