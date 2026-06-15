/**
 * Type definitions for the save_backlog_items MCP tool.
 * Used to persist features and stories as canonical work_items
 * under a specific epic in the architecture model service.
 */

// ============================================================================
// Input Payload Types (parsed from backlogJson)
// ============================================================================

/**
 * A single story input within a feature.
 */
export interface BacklogStoryInput {
  /** Existing work item ID (for updates/renames). Null or omitted for new stories. */
  id?: string | null;
  /** Story title (required, must be non-empty) */
  title: string;
  /** Optional story description */
  description?: string;
  /** Optional acceptance criteria list */
  acceptanceCriteria?: string[];
  /** Optional external reference for upsert matching */
  externalRef?: { system: string; key: string };
}

/**
 * A single feature input containing stories.
 */
export interface BacklogFeatureInput {
  /** Existing work item ID (for updates/renames). Null or omitted for new features. */
  id?: string | null;
  /** Feature title (required, must be non-empty) */
  title: string;
  /** Optional feature description */
  description?: string;
  /** Stories under this feature */
  stories: BacklogStoryInput[];
  /** Optional external reference for upsert matching */
  externalRef?: { system: string; key: string };
}

/**
 * An epic priority update entry.
 */
export interface EpicPriorityUpdate {
  /** Epic work item ID */
  id: string;
  /** Epic title (for logging/display) */
  title: string;
  /** New priority value */
  priority: number;
}

/**
 * Top-level parsed payload from backlogJson.
 */
export interface BacklogInput {
  /** ID of the epic to create features/stories under */
  epicId: string;
  /** Optional epic title (for logging/display) */
  epicTitle?: string;
  /** Array of features with nested stories */
  features: BacklogFeatureInput[];
  /** IDs of work items (features or stories) to delete */
  deletedWorkItemIds?: string[];
  /** Optional array of epic priority updates */
  epicPriorityUpdates?: EpicPriorityUpdate[];
}

// ============================================================================
// Request Type
// ============================================================================

/**
 * Request body for the save_backlog_items MCP tool.
 */
export interface SaveBacklogItemsRequest {
  /** The session ID for tracking state */
  sessionId: string;
  /** Project UUID (v4 format) */
  projectId: string;
  /** JSON string containing the backlog payload */
  backlogJson: string;
}

// ============================================================================
// Response Type
// ============================================================================

/**
 * Result from the save_backlog_items operation.
 */
export interface SaveBacklogItemsResult {
  /** Number of features created */
  createdFeatures: number;
  /** Number of features updated */
  updatedFeatures: number;
  /** Number of stories created */
  createdStories: number;
  /** Number of stories updated */
  updatedStories: number;
  /** Number of work items deleted */
  deletedWorkItems: number;
  /** Number of epic priorities updated */
  updatedEpicPriorities: number;
  /** Warnings about matching decisions */
  warnings: string[];
}
