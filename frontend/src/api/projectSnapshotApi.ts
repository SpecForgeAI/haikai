/**
 * Project Snapshot API Client
 *
 * Spec 2026-01-07: Fix Project Snapshot Import/Export
 * Task Group 2: Fix Project Snapshot API Client
 *
 * Spec 2026-01-07: Overwrite Existing Project Option for Snapshot Import
 * Task Group 3: Frontend UI and API Client
 *
 * Spec 2026-01-10: Project Hierarchy Grouping
 * Added project_hierarchy field to ProjectDtoSnake and mapping
 *
 * Spec 2026-01-18: Organisations Iteration 3 - Update Project Open Modal
 * Added organisation_id field to ProjectDtoSnake and mapping
 *
 * Provides functions for exporting and importing full project snapshots.
 * Follows the same patterns established in projectsApi.ts.
 *
 * IMPORTANT: This client preserves raw JSON snapshots without transformation
 * to ensure meta, work_items, and artifacts fields are not stripped during
 * export/import cycles.
 */

import { ProjectDto } from './projectsApi';

/**
 * API base URL from environment variable.
 * Defaults to empty string (same origin) for Vite proxy in development.
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

// ============================================================================
// Project Snapshot Types (Exported)
// ============================================================================

/**
 * Snapshot metadata structure.
 * Contains version and export information.
 */
export interface SnapshotMetaDto {
  snapshot_version: number;
  exported_at: string;
  export_kind: string;
}

/**
 * Project Snapshot DTO matching backend structure.
 * Contains the full project state including model, work items, and artifacts.
 *
 * Note: This type uses snake_case for fields that come directly from the backend
 * to preserve the raw JSON structure and avoid lossy transformations.
 */
export interface ProjectSnapshotDto {
  /** Snapshot metadata (version, export time, export kind) */
  meta: SnapshotMetaDto;
  /** Project information */
  project: ProjectDto;
  /** Architecture model data */
  model: {
    metaModel: {
      entities: Record<string, unknown>;
      relationships: Record<string, unknown>;
    };
    diagrams: unknown[];
  };
  /** Work items associated with the project */
  work_items: unknown[];
  /** Artifacts associated with the project */
  artifacts: unknown[];
}

/**
 * Request DTO for importing a project snapshot.
 * projectParentFolder is optional - if omitted, backend uses snapshot.project.projectParentFolder
 *
 * Spec 2026-01-07: Overwrite Existing Project Option for Snapshot Import
 * Added overwriteExistingProject field for controlling overwrite behavior.
 */
export interface ProjectSnapshotImportRequestDto {
  /** The full snapshot to import */
  snapshot: ProjectSnapshotDto;
  /** Optional name to import as (defaults to snapshot.project.name) */
  importAsName?: string;
  /** Optional parent folder for the imported project (defaults to snapshot.project.projectParentFolder) */
  projectParentFolder?: string;
  /** Whether to set the imported project as active (default: true) */
  setActive?: boolean;
  /**
   * Whether to overwrite an existing project with the same name (default: false).
   * When true, any existing project with the same effective name will be fully
   * replaced by the imported snapshot (not merged).
   *
   * Spec 2026-01-07: Overwrite Existing Project Option for Snapshot Import
   */
  overwriteExistingProject?: boolean;
}

/**
 * Result DTO returned after successfully importing a project snapshot.
 *
 * Spec 2026-01-07: Updated to match backend ProjectSnapshotImportResultDto.java
 * Backend returns: project, model_saved, work_items_inserted, artifacts_inserted, warnings
 */
export interface ProjectSnapshotImportResultDto {
  /** The imported project details */
  project: ProjectDto;
  /** Whether the model was successfully saved */
  modelSaved: boolean;
  /** Count of work items inserted during import */
  workItemsInserted: number;
  /** Count of artifacts inserted during import */
  artifactsInserted: number;
  /** List of warnings encountered during import (empty in v1) */
  warnings: string[];
}

// ============================================================================
// Internal Snake Case Types (for API response mapping)
// ============================================================================

/**
 * Backend response DTO for project (snake_case).
 * Private to this module.
 *
 * Spec 2026-01-10: Project Hierarchy Grouping
 * Added project_hierarchy field
 *
 * Spec 2026-01-18: Organisations Iteration 3
 * Added organisation_id field
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

/**
 * Backend response DTO for import result (snake_case).
 *
 * Spec 2026-01-07: Updated to match backend ProjectSnapshotImportResultDto.java
 * Backend returns: project, model_saved, work_items_inserted, artifacts_inserted, warnings
 */
interface ProjectSnapshotImportResultDtoSnake {
  project: ProjectDtoSnake;
  model_saved: boolean;
  work_items_inserted: number;
  artifacts_inserted: number;
  warnings: string[];
}

// ============================================================================
// Mapping Functions
// ============================================================================

/**
 * Maps a project DTO from snake_case (API response) to camelCase (frontend).
 *
 * Spec 2026-01-10: Project Hierarchy Grouping
 * Added projectHierarchy mapping
 *
 * Spec 2026-01-18: Organisations Iteration 3
 * Added organisationId mapping
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

/**
 * Maps an import result DTO from snake_case (API response) to camelCase (frontend).
 *
 * Spec 2026-01-07: Updated to map all backend fields:
 * - project (mapped via mapProjectFromSnake)
 * - model_saved -> modelSaved
 * - work_items_inserted -> workItemsInserted
 * - artifacts_inserted -> artifactsInserted
 * - warnings -> warnings (defaults to empty array)
 */
export function mapImportResultFromSnake(dto: ProjectSnapshotImportResultDtoSnake): ProjectSnapshotImportResultDto {
  return {
    project: mapProjectFromSnake(dto.project),
    modelSaved: dto.model_saved,
    workItemsInserted: dto.work_items_inserted,
    artifactsInserted: dto.artifacts_inserted,
    warnings: dto.warnings || [],
  };
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Exports the currently active project as a full snapshot.
 *
 * GET /api/projects/active/export
 *
 * IMPORTANT: Returns the raw backend JSON without transformation to preserve
 * all fields including meta, work_items, and artifacts.
 *
 * @returns Promise resolving to ProjectSnapshotDto, or null if no active project (404)
 * @throws Error with backend message on other failures
 */
export async function exportActiveProjectSnapshot(): Promise<ProjectSnapshotDto | null> {
  const url = `${API_BASE}/api/projects/active/export`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  // Return null on 404 (no active project)
  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    // Try to extract server error message
    let serverMessage = '';
    try {
      const errorBody = await response.json();
      serverMessage = errorBody.message || errorBody.error || '';
    } catch {
      // Ignore JSON parse errors
    }

    throw new Error(
      serverMessage || `Failed to export project snapshot: ${response.status} ${response.statusText}`
    );
  }

  // Return raw JSON directly - do NOT transform/map to avoid stripping fields
  const dto: ProjectSnapshotDto = await response.json();
  return dto;
}

/**
 * Exports a specific project by ID as a full snapshot.
 *
 * GET /api/projects/{id}/export
 *
 * More robust than exportActiveProjectSnapshot because it does not rely
 * on the is_active DB flag. Use this when the frontend already knows the
 * project ID from its context (e.g., activeProject.id).
 *
 * @param projectId - The project UUID to export
 * @returns Promise resolving to ProjectSnapshotDto
 * @throws Error with backend message on failure (including 404 if project not found)
 */
export async function exportProjectById(projectId: string): Promise<ProjectSnapshotDto> {
  const url = `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/export`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    let serverMessage = '';
    try {
      const errorBody = await response.json();
      serverMessage = errorBody.message || errorBody.error || '';
    } catch {
      // Ignore JSON parse errors
    }

    throw new Error(
      serverMessage || `Failed to export project snapshot: ${response.status} ${response.statusText}`
    );
  }

  const dto: ProjectSnapshotDto = await response.json();
  return dto;
}

/**
 * Imports a project snapshot, creating a new project with the imported data.
 *
 * POST /api/projects/import
 *
 * IMPORTANT: Sends the raw snapshot object without transformation to preserve
 * all fields including meta, work_items, and artifacts.
 *
 * Spec 2026-01-07: Overwrite Existing Project Option for Snapshot Import
 * Added support for overwrite_existing_project field in request body.
 *
 * @param req - Import request containing snapshot and import options
 * @returns Promise resolving to ProjectSnapshotImportResultDto on success
 * @throws Error with backend message on 400/409 or other failures
 */
export async function importProjectSnapshot(
  req: ProjectSnapshotImportRequestDto
): Promise<ProjectSnapshotImportResultDto> {
  const url = `${API_BASE}/api/projects/import`;

  // Build request body - send snapshot directly without transformation
  // Conditionally include import_as_name and project_parent_folder only when provided
  const body: Record<string, unknown> = {
    snapshot: req.snapshot,
    set_active: req.setActive ?? true,
  };

  // Only include these if override values are provided
  if (req.importAsName !== undefined && req.importAsName !== '') {
    body.import_as_name = req.importAsName;
  }
  if (req.projectParentFolder !== undefined && req.projectParentFolder !== '') {
    body.project_parent_folder = req.projectParentFolder;
  }

  // Spec 2026-01-07: Include overwrite_existing_project field when explicitly set
  // Only include field when it's explicitly set to ensure safe-by-default behavior
  if (req.overwriteExistingProject !== undefined) {
    body.overwrite_existing_project = req.overwriteExistingProject;
  }

  // Debug logging to trace what frontend sends to verify parent folder omission
  // Spec 2026-01-07: Task 2.5 - Added debug logging for import request body
  console.debug('[Import] Request body:', JSON.stringify(body, null, 2));

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    // Try to extract server error message
    let serverMessage = '';
    try {
      const errorBody = await response.json();
      serverMessage = errorBody.message || errorBody.error || '';
    } catch {
      // Ignore JSON parse errors
    }

    throw new Error(
      serverMessage || `Failed to import project snapshot: ${response.status} ${response.statusText}`
    );
  }

  const dto: ProjectSnapshotImportResultDtoSnake = await response.json();
  return mapImportResultFromSnake(dto);
}
