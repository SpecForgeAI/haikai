/**
 * Type definitions for the save_roadmap_structure MCP tool.
 * Used to persist roadmap structure (Initiatives and Epics) as canonical
 * work_items in the architecture model service.
 */

// ============================================================================
// Work Item DTO (matches WorkItemDto.java)
// ============================================================================

/**
 * DTO representing a work item from the architecture-model-service.
 * All fields nullable except id, project_id, type, title.
 */
export interface WorkItemDto {
  id: string;
  project_id: string;
  type: string;
  parent_id: string | null;
  title: string;
  description: string | null;
  status: string | null;
  sort_order: number | null;
  priority: string | null;
  target_window: string | null;
  tags: string | null;
  external_system: string | null;
  external_key: string | null;
  external_url: string | null;
  created_at: string | null;
  updated_at: string | null;
}

// ============================================================================
// Request Type
// ============================================================================

/**
 * Request body for the save_roadmap_structure MCP tool
 */
export interface SaveRoadmapStructureRequest {
  /** The session ID for tracking state */
  sessionId: string;
  /** Project UUID (v4 format) */
  projectId: string;
  /** JSON string containing the roadmap structure payload */
  roadmapJson: string;
}

// ============================================================================
// Input Payload Types (parsed from roadmapJson)
// ============================================================================

/**
 * Top-level parsed payload from roadmapJson.
 */
export interface RoadmapInput {
  initiatives: InitiativeInput[];
}

/**
 * Input for an Initiative work item.
 */
export interface InitiativeInput {
  /** Initiative title (required, must be non-empty) */
  title: string;
  /** Optional description */
  description?: string;
  /** Optional external reference for upsert matching */
  externalRef?: ExternalRefInput | null;
  /** Optional array of epics under this initiative */
  epics?: EpicInput[];
}

/**
 * Input for an Epic work item.
 */
export interface EpicInput {
  /** Epic title (required, must be non-empty) */
  title: string;
  /** Optional description */
  description?: string;
  /** Optional external reference for upsert matching */
  externalRef?: ExternalRefInput | null;
}

/**
 * External reference for matching against existing work items.
 */
export interface ExternalRefInput {
  /** External system name (e.g., "JIRA", "ADO") */
  system: string;
  /** External key within the system (e.g., "PROJ-123") */
  key: string;
  /** Optional external ID (ignored during persistence) */
  id?: string;
}

// ============================================================================
// Response Types
// ============================================================================

/**
 * Result from the save_roadmap_structure operation.
 */
export interface SaveRoadmapStructureResult {
  /** Number of initiatives created */
  createdInitiatives: number;
  /** Number of initiatives updated */
  updatedInitiatives: number;
  /** Number of epics created */
  createdEpics: number;
  /** Number of epics updated */
  updatedEpics: number;
  /** Warnings about matching decisions (title fallback, title mismatch, etc.) */
  warnings: string[];
}
