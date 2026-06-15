/**
 * User Journey Overview Diagram API Client
 *
 * API client for fetching temporary User Journey Overview diagrams from the backend.
 *
 * Follows the established userJourneyDiagramApi.ts pattern: plain fetch() with
 * API_BASE env variable.
 *
 * The endpoint is routed through the existing Vite /api/ catch-all proxy
 * to architecture-model-service on port 8080. No new gateway route is needed.
 *
 * Spec 2026-04-07: User Journey Overview Parent Diagram Generation
 * Task Group 4, Task 4.5: API client function for fetching temporary overview diagrams
 */

import type { UserJourneyOverviewDiagramDto } from '../types/userJourneyOverviewDiagram';

/**
 * API base URL from environment variable.
 * Defaults to empty string (same origin) for Vite proxy in development.
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

/**
 * Fetches a temporary User Journey Overview diagram for a project, architecture, and business user.
 *
 * Calls GET /api/projects/{projectId}/architectures/{architectureId}/user-journey-overview-diagrams/temporary?businessUserId={businessUserId},
 * which returns the generated overview diagram contract.
 *
 * Spec 2026-05-01 Multi-Architecture Plumbing -- Task Group 4
 *   architectureId is now a REQUIRED path segment (Bucket A endpoint).
 *   Forgetting it produces a 404 at the backend (no silent fallback).
 *
 * @param projectId - The project UUID
 * @param architectureId - The architecture UUID -- REQUIRED, no fallback
 * @param businessUserId - The business user ID to generate the overview for
 * @returns Promise resolving to the UserJourneyOverviewDiagramDto
 * @throws Error if the HTTP request fails (non-ok status)
 */
export async function fetchTemporaryUserJourneyOverviewDiagram(
  projectId: string,
  architectureId: string,
  businessUserId: string
): Promise<UserJourneyOverviewDiagramDto> {
  const url = `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/user-journey-overview-diagrams/temporary?businessUserId=${encodeURIComponent(businessUserId)}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch temporary user journey overview diagram for project "${projectId}": ${res.status}`
    );
  }

  const data: UserJourneyOverviewDiagramDto = await res.json();
  return data;
}
