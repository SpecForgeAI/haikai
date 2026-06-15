/**
 * Project Session API Client
 *
 * Spec 2026-01-22: Explicit Project Session API
 * Task Group 3: Session API Client
 *
 * Provides functions for session-backed project operations.
 * These endpoints work in BOTH DB and no-DB modes.
 *
 * Endpoints:
 * - GET /api/project-session - Get current session project
 * - POST /api/project-session/import - Import snapshot into session
 * - GET /api/project-session/export - Export session snapshot
 * - POST /api/project-session/clear - Clear session project
 *
 * Follows the same patterns as projectSnapshotApi.ts:
 * - Handles 404 as null return (not error)
 * - Maps snake_case responses to camelCase
 * - Preserves raw JSON for snapshots
 */

import { ProjectDto } from './projectsApi';
import {
  ProjectSnapshotDto,
  ProjectSnapshotImportRequestDto,
  ProjectSnapshotImportResultDto,
  mapImportResultFromSnake,
} from './projectSnapshotApi';

/**
 * API base URL from environment variable.
 * Defaults to empty string (same origin) for Vite proxy in development.
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

// ============================================================================
// Internal Snake Case Types (for API response mapping)
// ============================================================================

/**
 * Backend response DTO for project (snake_case).
 * Private to this module.
 */
interface ProjectDtoSnake {
  id: string;
  name: string;
  project_parent_folder: string;
  project_hierarchy: string | null;
  organisation_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Mapping Functions
// ============================================================================

/**
 * Maps a project DTO from snake_case (API response) to camelCase (frontend).
 */
function mapProjectFromSnake(dto: ProjectDtoSnake): ProjectDto {
  return {
    id: dto.id,
    name: dto.name,
    projectParentFolder: dto.project_parent_folder,
    projectHierarchy: dto.project_hierarchy ?? null,
    organisationId: dto.organisation_id ?? null,
    isActive: dto.is_active,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Gets the current session project.
 *
 * GET /api/project-session
 *
 * @returns Promise resolving to ProjectDto, or null if no session project (404)
 * @throws Error on other failures
 */
export async function getSessionProject(): Promise<ProjectDto | null> {
  const response = await fetch(`${API_BASE}/api/project-session`);

  // Return null on 404 (no session project)
  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to get session project: ${response.status}`);
  }

  const dto: ProjectDtoSnake = await response.json();
  return mapProjectFromSnake(dto);
}

/**
 * Imports a project snapshot into the session.
 *
 * POST /api/project-session/import
 *
 * @param req - Import request containing snapshot and options
 * @returns Promise resolving to ProjectSnapshotImportResultDto
 * @throws Error on failure
 */
export async function importToSession(
  req: ProjectSnapshotImportRequestDto
): Promise<ProjectSnapshotImportResultDto> {
  // Build request body with snake_case fields
  const body: Record<string, unknown> = {
    snapshot: req.snapshot,
    set_active: req.setActive ?? true,
  };

  // Only include optional fields if provided
  if (req.importAsName !== undefined && req.importAsName !== '') {
    body.import_as_name = req.importAsName;
  }
  if (req.projectParentFolder !== undefined && req.projectParentFolder !== '') {
    body.project_parent_folder = req.projectParentFolder;
  }
  if (req.overwriteExistingProject !== undefined) {
    body.overwrite_existing_project = req.overwriteExistingProject;
  }

  const response = await fetch(`${API_BASE}/api/project-session/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Failed to import to session: ${response.status}`);
  }

  const dto = await response.json();
  return mapImportResultFromSnake(dto);
}

/**
 * Exports the session project snapshot.
 *
 * GET /api/project-session/export
 *
 * Returns the raw backend JSON without transformation to preserve
 * all fields including meta, work_items, and artifacts.
 *
 * @returns Promise resolving to ProjectSnapshotDto, or null if no session project (404)
 * @throws Error on other failures
 */
export async function exportSessionSnapshot(): Promise<ProjectSnapshotDto | null> {
  const response = await fetch(`${API_BASE}/api/project-session/export`);

  // Return null on 404 (no session project)
  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to export session snapshot: ${response.status}`);
  }

  // Return raw JSON directly - do NOT transform to avoid stripping fields
  const dto: ProjectSnapshotDto = await response.json();
  return dto;
}

/**
 * Clears the session project.
 *
 * POST /api/project-session/clear
 *
 * @returns Promise resolving to void
 * @throws Error on failure
 */
export async function clearSession(): Promise<void> {
  const response = await fetch(`${API_BASE}/api/project-session/clear`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`Failed to clear session: ${response.status}`);
  }
}
