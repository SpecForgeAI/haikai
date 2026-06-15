/**
 * User Journey Diagram API Client
 *
 * API client for fetching temporary User Journey diagrams from the backend,
 * and for sync-status and refresh-from-model operations on saved diagrams.
 *
 * Follows the established temporaryDiagramApi.ts pattern: plain fetch() with
 * API_BASE env variable.
 *
 * The endpoints are routed through the existing Vite /api/ catch-all proxy
 * to architecture-model-service on port 8080. No new gateway route is needed.
 *
 * Spec 2026-04-03: User Journey Temporary Diagram Selection and Review Flow
 * Task Group 1, Task 1.3: API client function for fetching temporary user journey diagrams
 *
 * Spec 2026-04-03: User Journey One-Way Sync from Meta-Model
 * Task Group 3: Sync status and refresh API client functions
 *
 * Spec 2026-05-01 Multi-Architecture Plumbing -- Task Group 4
 *   All three functions now require architectureId as a path segment
 *   (Bucket A endpoints). Forgetting it produces a 404 at the backend.
 */

import type { UserJourneyDiagramDto } from '../types/userJourneyDiagram';
import type { Diagram } from '../types/model';

/**
 * API base URL from environment variable.
 * Defaults to empty string (same origin) for Vite proxy in development.
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

// ============================================================================
// Sync Status Response Type
// ============================================================================

/**
 * Response from the user journey sync status endpoint.
 * Matches the backend UserJourneySyncStatusResponse DTO.
 */
export interface UserJourneySyncStatusResponse {
  /** Current sync status */
  sync_status: 'IN_SYNC' | 'STALE' | 'BROKEN_SOURCE' | 'UNLINKED';
  /** Reason for staleness (nullable) */
  stale_reason: string | null;
  /** ISO-8601 timestamp of last sync (nullable) */
  last_synced_at: string | null;
  /** Hash from last sync (nullable) */
  last_synced_hash: string | null;
}

// ============================================================================
// Temporary Diagram API
// ============================================================================

/**
 * Fetches all temporary User Journey diagrams for a project.
 *
 * Calls GET /api/projects/{projectId}/user-journey-diagrams/temporary,
 * which returns the array of generated journey diagram contracts.
 *
 * @param projectId - The project UUID
 * @returns Promise resolving to the array of UserJourneyDiagramDto
 * @throws Error if the HTTP request fails (non-ok status)
 */
export async function fetchTemporaryUserJourneyDiagrams(
  projectId: string,
  architectureId: string
): Promise<UserJourneyDiagramDto[]> {
  const url = `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/user-journey-diagrams/temporary`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch temporary user journey diagrams for project "${projectId}": ${res.status}`
    );
  }

  const data: UserJourneyDiagramDto[] = await res.json();
  return data;
}

// ============================================================================
// Sync Status and Refresh API
// ============================================================================

/**
 * Fetches the sync status of a saved USER_JOURNEY diagram.
 *
 * Calls GET /api/projects/{projectId}/diagrams/{diagramId}/user-journey-sync-status
 *
 * @param projectId - The project UUID
 * @param diagramId - The diagram ID
 * @returns Promise resolving to UserJourneySyncStatusResponse
 * @throws Error if the HTTP request fails (non-ok status)
 */
export async function fetchUserJourneySyncStatus(
  projectId: string,
  architectureId: string,
  diagramId: string
): Promise<UserJourneySyncStatusResponse> {
  const url = `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/diagrams/${encodeURIComponent(diagramId)}/user-journey-sync-status`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch sync status for diagram "${diagramId}": ${res.status}`
    );
  }

  const data: UserJourneySyncStatusResponse = await res.json();
  return data;
}

/**
 * Refreshes a saved USER_JOURNEY diagram from the meta-model.
 *
 * Calls POST /api/projects/{projectId}/diagrams/{diagramId}/refresh-user-journey-from-model
 *
 * @param projectId - The project UUID
 * @param diagramId - The diagram ID
 * @returns Promise resolving to the updated Diagram
 * @throws Error if the HTTP request fails (non-ok status)
 */
export async function refreshUserJourneyFromModel(
  projectId: string,
  architectureId: string,
  diagramId: string
): Promise<Diagram> {
  const url = `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/diagrams/${encodeURIComponent(diagramId)}/refresh-user-journey-from-model`;

  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) {
    throw new Error(
      `Failed to refresh diagram "${diagramId}" from model: ${res.status}`
    );
  }

  const data: Diagram = await res.json();
  return data;
}
