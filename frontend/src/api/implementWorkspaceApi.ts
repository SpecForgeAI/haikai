/**
 * Implement Workspace API Client
 *
 * API client for backend implement workspace endpoints.
 * Provides functions to fetch and save the full workspace state.
 *
 * Spec 2026-01-23: Persist + Rehydrate Implement Workspace
 * Task Group 4: Frontend API Functions
 */

/**
 * Model Service base URL from environment variable.
 * Defaults to empty string (same origin) for Vite proxy in development.
 */
const MODEL_SERVICE_BASE = import.meta.env.VITE_MODEL_SERVICE_BASE_URL ?? '';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Question object for persistence.
 * Contains all fields needed for both PO and SA questions.
 */
export interface PersistedQuestion {
  /** Unique identifier for this question (UUID) */
  id: string;
  /** The question text */
  question: string;
  /** Current status - derived from answer presence */
  status: 'Open' | 'Answered';
  /** User-provided answer text */
  answer: string;
  /** Source of the question */
  source: 'Product Manager' | 'Software Developer';
  /** Optional increment ID for SA questions */
  incrementId?: string;
  /** ISO-8601 timestamp when question was created */
  createdAt?: string;
  /** ISO-8601 timestamp when question was answered */
  answeredAt?: string;
}

/**
 * Team chat transcript entry for persistence.
 */
export interface PersistedTranscriptEntry {
  /** Unique message ID */
  id: string;
  /** Role: user, assistant, or system */
  role: 'user' | 'assistant' | 'system';
  /** Message content */
  message: string;
  /** ISO-8601 timestamp */
  createdAt: string;
  /** Optional linked increment ID for context */
  linkedIncrementId?: string;
}

/**
 * Increment artifacts captured during pipeline execution.
 */
export interface PersistedIncrementArtifacts {
  /** Output from Shape Spec step */
  shapeSpecArtifact?: string;
  /** Output from Write Spec step */
  writeSpecArtifact?: string;
  /** Output from Create Tasks step */
  tasksSummary?: string;
  /** Output from Implement Tasks step */
  implementationResult?: string;
  /** Error message if pipeline failed */
  error?: string;
}

/**
 * Persisted workspace state structure.
 * This is the frontend representation of what gets stored in JSONB.
 */
export interface PersistedWorkspaceState {
  /** Schema version for migration support */
  schemaVersion: number;
  /** User-controlled implementation phase flag */
  implementationMode: boolean;
  /** Planner payload with feature understanding, scope, etc. */
  plannerPayload: Record<string, unknown> | null;
  /** Currently selected increment ID */
  activeIncrementId: string | null;
  /** Array of questions (PO and SA) */
  questions: PersistedQuestion[];
  /** Execution artifacts keyed by increment ID */
  executionArtifactsByIncrement: Record<string, PersistedIncrementArtifacts>;
  /** Team chat transcript entries */
  teamChatTranscript: PersistedTranscriptEntry[];
}

/**
 * DTO returned from the backend.
 * Uses snake_case for JSON serialization compatibility.
 */
export interface ImplementWorkspaceDto {
  /** Project identifier */
  project_id: string;
  /** Work item UUID */
  work_item_id: string;
  /** Schema version */
  schema_version: number;
  /** Implementation mode flag */
  implementation_mode: boolean;
  /** Planner payload */
  planner_payload: Record<string, unknown> | null;
  /** Active increment ID */
  active_increment_id: string | null;
  /** Questions array */
  questions: PersistedQuestion[];
  /** Execution artifacts by increment */
  execution_artifacts_by_increment: Record<string, PersistedIncrementArtifacts>;
  /** Team chat transcript */
  team_chat_transcript: PersistedTranscriptEntry[];
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Fetches the implement workspace for a work item from the backend.
 *
 * Calls GET /api/projects/{projectId}/work-items/{workItemId}/implement-workspace
 *
 * @param projectId - The project identifier
 * @param workItemId - The work item UUID
 * @returns Promise resolving to the ImplementWorkspaceDto
 * @throws Error if the request fails (non-OK response)
 */
export async function fetchImplementWorkspace(
  projectId: string,
  workItemId: string
): Promise<ImplementWorkspaceDto> {
  const url = `${MODEL_SERVICE_BASE}/api/projects/${encodeURIComponent(projectId)}/work-items/${encodeURIComponent(workItemId)}/implement-workspace`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch implement workspace: ${response.status}`);
  }

  return response.json();
}

/**
 * Saves the implement workspace for a work item to the backend.
 *
 * Calls PUT /api/projects/{projectId}/work-items/{workItemId}/implement-workspace
 *
 * @param projectId - The project identifier
 * @param workItemId - The work item UUID
 * @param workspaceState - The full workspace state to persist
 * @returns Promise resolving to the saved ImplementWorkspaceDto
 * @throws Error if the request fails (non-OK response)
 */
export async function saveImplementWorkspace(
  projectId: string,
  workItemId: string,
  workspaceState: PersistedWorkspaceState
): Promise<ImplementWorkspaceDto> {
  const url = `${MODEL_SERVICE_BASE}/api/projects/${encodeURIComponent(projectId)}/work-items/${encodeURIComponent(workItemId)}/implement-workspace`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      workspace_state: workspaceState,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to save implement workspace: ${response.status}`);
  }

  return response.json();
}

// ============================================================================
// Conversion Helpers
// ============================================================================

/**
 * Converts a backend DTO to the frontend PersistedWorkspaceState format.
 *
 * @param dto - The DTO from the backend
 * @returns The converted PersistedWorkspaceState
 */
export function dtoToPersistedState(dto: ImplementWorkspaceDto): PersistedWorkspaceState {
  return {
    schemaVersion: dto.schema_version,
    implementationMode: dto.implementation_mode,
    plannerPayload: dto.planner_payload,
    activeIncrementId: dto.active_increment_id,
    questions: dto.questions ?? [],
    executionArtifactsByIncrement: dto.execution_artifacts_by_increment ?? {},
    teamChatTranscript: dto.team_chat_transcript ?? [],
  };
}
