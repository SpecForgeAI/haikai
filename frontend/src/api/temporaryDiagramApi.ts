/**
 * Temporary Diagram API Client
 *
 * API client for fetching temporary architecture diagrams from the backend.
 * Follows the established modelApi.ts pattern: plain fetch() with API_BASE env variable.
 *
 * The GET endpoint at /api/projects/{projectId}/temporary-diagrams/{temporaryDiagramId}
 * is routed through the existing Vite /api/ catch-all proxy to architecture-model-service
 * on port 8080. No new gateway route is needed.
 *
 * Spec 2026-03-26: Render Temporary Architecture Diagrams in Frontend (Increment 4)
 * Task Group 1: Frontend API Client for Temporary Diagrams
 */

import type { TemporaryArchitectureDiagram } from '../types/temporaryArchitectureDiagram';
import {
  isTemporaryArchitectureDiagram,
  isValidERDiagram,
} from '../types/temporaryArchitectureDiagramValidation';

/**
 * API base URL from environment variable.
 * Defaults to empty string (same origin) for Vite proxy in development.
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

/**
 * Response DTO from the backend GET endpoint.
 * Mirrors the Java TemporaryDiagramDto record with snake_case field names.
 */
export interface TemporaryDiagramResponseDto {
  /** Internal database UUID */
  id: string;
  /** Client/LLM-provided diagram identifier */
  temporary_diagram_id: string;
  /** Project UUID */
  project_id: string;
  /** Full TemporaryArchitectureDiagram JSON payload */
  diagram_payload: unknown;
  /** ISO-8601 timestamp of creation */
  created_at: string;
  /** ISO-8601 timestamp of last update */
  updated_at: string;
}

/**
 * Fetches a temporary architecture diagram by project ID, architecture ID, and temporary diagram ID.
 *
 * Calls GET /api/projects/{projectId}/architectures/{architectureId}/temporary-diagrams/{temporaryDiagramId},
 * parses the response, extracts the diagram_payload field, and validates it
 * using isTemporaryArchitectureDiagram() and isValidERDiagram() before returning.
 *
 * Spec 2026-05-01 Multi-Architecture Plumbing -- Task Group 4
 *   architectureId is now a REQUIRED path segment (Bucket A endpoint).
 *   Forgetting it produces a 404 at the backend (no silent fallback).
 *
 * @param projectId - The project UUID
 * @param architectureId - The architecture UUID -- REQUIRED, no fallback
 * @param temporaryDiagramId - The client/LLM-provided diagram identifier
 * @returns Promise resolving to the validated TemporaryArchitectureDiagram
 * @throws Error if the HTTP request fails (non-ok status)
 * @throws Error if diagram_payload fails structural validation (isTemporaryArchitectureDiagram)
 * @throws Error if diagram_payload fails ER validation (isValidERDiagram)
 */
export async function fetchTemporaryDiagram(
  projectId: string,
  architectureId: string,
  temporaryDiagramId: string
): Promise<TemporaryArchitectureDiagram> {
  const url = `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/temporary-diagrams/${encodeURIComponent(temporaryDiagramId)}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch temporary diagram "${temporaryDiagramId}" for project "${projectId}": ${res.status}`
    );
  }

  const dto: TemporaryDiagramResponseDto = await res.json();
  const payload = dto.diagram_payload;

  // Structural validation: check that the payload has the shape of a TemporaryArchitectureDiagram
  if (!isTemporaryArchitectureDiagram(payload)) {
    throw new Error(
      `Temporary diagram "${temporaryDiagramId}" has an invalid diagram_payload: failed structural validation (isTemporaryArchitectureDiagram)`
    );
  }

  // ER-specific validation: check that it is a valid ER diagram
  if (!isValidERDiagram(payload)) {
    throw new Error(
      `Temporary diagram "${temporaryDiagramId}" has an invalid diagram_payload: failed ER validation (isValidERDiagram). diagram_kind="${payload.diagram_kind}", view_mode="${payload.view_mode}"`
    );
  }

  return payload;
}
