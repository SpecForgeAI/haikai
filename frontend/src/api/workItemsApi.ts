/**
 * Work Items API Client
 *
 * Spec 2026-01-03: Product Backlog Tree View (Stage 4)
 * API client for fetching work items from the backend.
 * Follows patterns from modelApi.ts.
 *
 * Extended in Spec 2026-01-03: Product Backlog CRUD (Stage 4 - Increment 3)
 * Added create, update, and delete operations.
 *
 * Extended in Spec 2026-01-17: Fix Feature Edit 400 Error
 * Added type field to WorkItemUpdateDto and mapper to fix 400 validation error.
 *
 * Extended in Spec 2026-01-18: Fix Feature Edit 400 Error - Preserve Parent
 * Added parent_id field to WorkItemUpdateDto and mapper to preserve parent relationship.
 */

import type { WorkItem, WorkItemCreatePayload, WorkItemUpdatePayload } from '../types/workItems';

/**
 * API base URL from environment variable.
 * Defaults to empty string (same origin) for Vite proxy in development.
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

/**
 * Backend response DTO for work items (snake_case)
 * This mirrors the API response structure before transformation
 */
interface WorkItemDto {
  id: string;
  project_id: string;
  type: string;
  parent_id: string | null;
  title: string;
  description: string | null;
  status: string;
  sort_order: number;
  priority: number | null;
  target_window: string | null;
  tags: Record<string, unknown> | null;
  external_system: string | null;
  external_key: string | null;
  external_url: string | null;
  created_at: string;
  updated_at: string;
  /** Implementation git outcome fields (Spec 2026-06-12, nullable) */
  implementation_branch?: string | null;
  implementation_pr_url?: string | null;
  implementation_logs_url?: string | null;
}

/**
 * Backend request DTO for creating work items (snake_case)
 */
interface WorkItemCreateDto {
  type: string;
  parent_id: string;
  title: string;
  description?: string;
  status?: string;
  priority?: number;
  target_window?: string;
  sort_order: number;
}

/**
 * Backend request DTO for updating work items (snake_case)
 *
 * Spec 2026-01-17: Fix Feature Edit 400 Error
 * Added type field to satisfy backend validation requirements.
 *
 * Spec 2026-01-18: Fix Feature Edit 400 Error - Preserve Parent
 * Added parent_id field to preserve parent relationship on updates.
 */
interface WorkItemUpdateDto {
  type?: string;
  parent_id?: string;
  title?: string;
  description?: string;
  status?: string;
  priority?: number;
  target_window?: string;
  external_system?: string;
  external_key?: string;
  /** Tags pass-through (Spec 2026-06-12) — echo current tags on partial updates */
  tags?: Record<string, unknown>;
  /** Implementation git outcome fields (Spec 2026-06-12) — null-guarded on the backend */
  implementation_branch?: string;
  implementation_pr_url?: string;
  implementation_logs_url?: string;
}

/**
 * Maps a single work item DTO from snake_case (API) to camelCase (frontend)
 *
 * @param dto - The work item DTO from the API
 * @returns The work item with camelCase field names
 */
function mapWorkItemDtoToWorkItem(dto: WorkItemDto): WorkItem {
  return {
    id: dto.id,
    projectId: dto.project_id,
    type: dto.type,
    parentId: dto.parent_id,
    title: dto.title,
    description: dto.description,
    status: dto.status,
    sortOrder: dto.sort_order,
    priority: dto.priority,
    targetWindow: dto.target_window,
    tags: dto.tags,
    externalSystem: dto.external_system,
    externalKey: dto.external_key,
    externalUrl: dto.external_url,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
    implementationBranch: dto.implementation_branch ?? null,
    implementationPrUrl: dto.implementation_pr_url ?? null,
    implementationLogsUrl: dto.implementation_logs_url ?? null,
  };
}

/**
 * Maps a work item create payload from camelCase (frontend) to snake_case (API)
 *
 * @param payload - The create payload with camelCase field names
 * @returns The DTO with snake_case field names for the API
 */
export function mapWorkItemCreatePayloadToDto(payload: WorkItemCreatePayload): WorkItemCreateDto {
  const dto: WorkItemCreateDto = {
    type: payload.type,
    parent_id: payload.parentId,
    title: payload.title,
    sort_order: payload.sortOrder,
  };

  if (payload.description !== undefined) {
    dto.description = payload.description;
  }
  if (payload.status !== undefined) {
    dto.status = payload.status;
  }
  if (payload.priority !== undefined) {
    dto.priority = payload.priority;
  }
  if (payload.targetWindow !== undefined) {
    dto.target_window = payload.targetWindow;
  }

  return dto;
}

/**
 * Maps a work item update payload from camelCase (frontend) to snake_case (API)
 *
 * Spec 2026-01-17: Fix Feature Edit 400 Error
 * Added type mapping to satisfy backend validation requirements.
 * The type is mapped directly (no case transformation needed).
 *
 * Spec 2026-01-18: Fix Feature Edit 400 Error - Preserve Parent
 * Added parentId to parent_id mapping to preserve parent relationship.
 *
 * @param payload - The update payload with camelCase field names
 * @returns The DTO with snake_case field names for the API
 */
export function mapWorkItemUpdatePayloadToDto(payload: WorkItemUpdatePayload): WorkItemUpdateDto {
  const dto: WorkItemUpdateDto = {};

  // Spec 2026-01-17: Include type field (no case transformation needed)
  if (payload.type !== undefined) {
    dto.type = payload.type;
  }
  // Spec 2026-01-18: Include parent_id field to preserve parent relationship
  if (payload.parentId !== undefined) {
    dto.parent_id = payload.parentId;
  }
  if (payload.title !== undefined) {
    dto.title = payload.title;
  }
  if (payload.description !== undefined) {
    dto.description = payload.description;
  }
  if (payload.status !== undefined) {
    dto.status = payload.status;
  }
  if (payload.priority !== undefined) {
    dto.priority = payload.priority;
  }
  if (payload.targetWindow !== undefined) {
    dto.target_window = payload.targetWindow;
  }
  if (payload.externalSystem !== undefined) {
    dto.external_system = payload.externalSystem;
  }
  if (payload.externalKey !== undefined) {
    dto.external_key = payload.externalKey;
  }
  // Spec 2026-06-12: tags pass-through + implementation git outcome fields
  if (payload.tags !== undefined) {
    dto.tags = payload.tags;
  }
  if (payload.implementationBranch !== undefined) {
    dto.implementation_branch = payload.implementationBranch;
  }
  if (payload.implementationPrUrl !== undefined) {
    dto.implementation_pr_url = payload.implementationPrUrl;
  }
  if (payload.implementationLogsUrl !== undefined) {
    dto.implementation_logs_url = payload.implementationLogsUrl;
  }

  return dto;
}

/**
 * Fetches work items for a project from the backend.
 *
 * @param projectId - The project identifier (filename)
 * @returns Promise resolving to array of WorkItem objects
 * @throws Error if the request fails with descriptive message
 */
export async function fetchWorkItems(projectId: string): Promise<WorkItem[]> {
  const encodedProjectId = encodeURIComponent(projectId);
  const url = `${API_BASE}/api/model/projects/${encodedProjectId}/work-items`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch work items for project "${projectId}": ${response.status} ${response.statusText}`
    );
  }

  const dtos: WorkItemDto[] = await response.json();

  // Map snake_case to camelCase
  return dtos.map(mapWorkItemDtoToWorkItem);
}

/**
 * Creates a new work item in a project.
 *
 * @param projectId - The project identifier (filename)
 * @param payload - The work item create payload
 * @returns Promise resolving to the created WorkItem
 * @throws Error if the request fails with descriptive message
 */
export async function createWorkItem(
  projectId: string,
  payload: WorkItemCreatePayload
): Promise<WorkItem> {
  const encodedProjectId = encodeURIComponent(projectId);
  const url = `${API_BASE}/api/model/projects/${encodedProjectId}/work-items`;

  const dto = mapWorkItemCreatePayloadToDto(payload);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(dto),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(
      `Failed to create work item in project "${projectId}": ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`
    );
  }

  const responseDto: WorkItemDto = await response.json();
  return mapWorkItemDtoToWorkItem(responseDto);
}

/**
 * Updates an existing work item in a project.
 *
 * @param projectId - The project identifier (filename)
 * @param id - The work item ID to update
 * @param payload - The work item update payload
 * @returns Promise resolving to the updated WorkItem
 * @throws Error if the request fails with descriptive message
 */
export async function updateWorkItem(
  projectId: string,
  id: string,
  payload: WorkItemUpdatePayload
): Promise<WorkItem> {
  const encodedProjectId = encodeURIComponent(projectId);
  const encodedId = encodeURIComponent(id);
  const url = `${API_BASE}/api/model/projects/${encodedProjectId}/work-items/${encodedId}`;

  const dto = mapWorkItemUpdatePayloadToDto(payload);

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(dto),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(
      `Failed to update work item "${id}" in project "${projectId}": ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`
    );
  }

  const responseDto: WorkItemDto = await response.json();
  return mapWorkItemDtoToWorkItem(responseDto);
}

/**
 * Deletes a work item from a project.
 * Note: This will cascade delete all child work items.
 *
 * @param projectId - The project identifier (filename)
 * @param id - The work item ID to delete
 * @returns Promise resolving when deletion is complete
 * @throws Error if the request fails with descriptive message
 */
export async function deleteWorkItem(projectId: string, id: string): Promise<void> {
  const encodedProjectId = encodeURIComponent(projectId);
  const encodedId = encodeURIComponent(id);
  const url = `${API_BASE}/api/model/projects/${encodedProjectId}/work-items/${encodedId}`;

  const response = await fetch(url, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(
      `Failed to delete work item "${id}" in project "${projectId}": ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`
    );
  }
}
