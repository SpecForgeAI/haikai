/**
 * Dashboard API Client
 *
 * API client for Gateway dashboard endpoints.
 * Provides functions to retrieve dashboard summary data.
 *
 * Spec 2026-02-18: Dashboard Increment 2 -- Define Dashboard Summary Contract + Backend Mock Endpoint
 */

import type { DashboardSummaryDto, ScopeType } from '../types/dashboard';

/**
 * Gateway API base URL from environment variable.
 * Defaults to empty string (same origin) for Vite proxy in development.
 */
const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';

/**
 * Retrieves the dashboard summary for a given project.
 *
 * @param projectId - The project identifier (required)
 * @param scope - Optional scope type to control metric breadth (defaults to NEXT_5_EPICS on the server)
 * @returns Promise resolving to the DashboardSummaryDto
 * @throws Error if the request fails (non-ok response)
 */
export async function getDashboardSummary(
  projectId: string,
  scope?: ScopeType
): Promise<DashboardSummaryDto> {
  let url = `${GATEWAY_BASE}/api/dashboard/summary?projectId=${encodeURIComponent(projectId)}`;

  if (scope) {
    url += `&scope=${encodeURIComponent(scope)}`;
  }

  const res = await fetch(url, {
    method: 'GET',
  });

  if (!res.ok) {
    throw new Error(`Dashboard summary request failed: ${res.status}`);
  }

  return res.json() as Promise<DashboardSummaryDto>;
}
