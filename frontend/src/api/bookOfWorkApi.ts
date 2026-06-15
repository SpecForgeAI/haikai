/**
 * Book of Work API Client
 *
 * Spec 2026-01-10: Upload Book of Work from Markdown
 * Task Group 4.2: Create bookOfWorkApi.ts following roadmapApi.ts patterns
 *
 * Provides API client for uploading Book of Work markdown files
 * and handling the response with proper snake_case to camelCase mapping.
 */

/**
 * API base URL from environment variable.
 * Defaults to empty string (same origin) for Vite proxy in development.
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

// ============================================================================
// Work Item DTO Types (snake_case from API)
// ============================================================================

/**
 * Work item DTO from API (snake_case)
 */
export interface WorkItemDto {
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
  created_at: string;
  updated_at: string;
}

/**
 * Work item for frontend (camelCase)
 */
export interface WorkItem {
  id: string;
  projectId: string;
  type: string;
  parentId: string | null;
  title: string;
  description: string | null;
  status: string;
  sortOrder: number;
  priority: number | null;
  targetWindow: string | null;
  tags: Record<string, unknown> | null;
  externalSystem: string | null;
  externalKey: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Import Summary Types
// ============================================================================

/**
 * Import summary from API (snake_case)
 */
export interface ImportSummaryDto {
  initiatives_created: number;
  epics_created: number;
  features_created: number;
  stories_created: number;
  total_created: number;
}

/**
 * Import summary for frontend (camelCase)
 */
export interface ImportSummary {
  initiativesCreated: number;
  epicsCreated: number;
  featuresCreated: number;
  storiesCreated: number;
  totalCreated: number;
}

// ============================================================================
// Upload Result Types
// ============================================================================

/**
 * Backend response DTO for upload result (snake_case)
 * This mirrors the API response structure before transformation
 */
export interface BookOfWorkUploadResultDto {
  project_id: string;
  work_items: WorkItemDto[];
  import_summary: ImportSummaryDto;
}

/**
 * Frontend interface for upload result (camelCase)
 * Transformed from BookOfWorkUploadResultDto for consistent frontend usage
 */
export interface BookOfWorkUploadResult {
  projectId: string;
  workItems: WorkItem[];
  importSummary: ImportSummary;
}

// ============================================================================
// Mapping Functions
// ============================================================================

/**
 * Maps a work item DTO from snake_case (API) to camelCase (frontend)
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
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}

/**
 * Maps an import summary DTO from snake_case (API) to camelCase (frontend)
 *
 * @param dto - The import summary DTO from the API
 * @returns The import summary with camelCase field names
 */
function mapImportSummaryDtoToImportSummary(dto: ImportSummaryDto): ImportSummary {
  return {
    initiativesCreated: dto.initiatives_created,
    epicsCreated: dto.epics_created,
    featuresCreated: dto.features_created,
    storiesCreated: dto.stories_created,
    totalCreated: dto.total_created,
  };
}

/**
 * Maps an upload result DTO from snake_case (API) to camelCase (frontend)
 *
 * @param dto - The upload result DTO from the API
 * @returns The upload result with camelCase field names
 */
export function mapBookOfWorkResultDtoToResult(
  dto: BookOfWorkUploadResultDto
): BookOfWorkUploadResult {
  return {
    projectId: dto.project_id,
    workItems: dto.work_items.map(mapWorkItemDtoToWorkItem),
    importSummary: mapImportSummaryDtoToImportSummary(dto.import_summary),
  };
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Uploads a Book of Work markdown file for a project.
 *
 * Calls POST /api/projects/{projectId}/book-of-work/upload
 *
 * Spec 2026-01-10: Upload Book of Work from Markdown
 *
 * @param projectId - The project identifier (project name)
 * @param content - The markdown content of the Book of Work file
 * @returns Promise resolving to BookOfWorkUploadResult with work items and counts
 * @throws Error with specific message for 404 (project not found)
 * @throws Error with specific message for 400 (parse error or validation)
 * @throws Error with server message for other failures
 */
export async function uploadBookOfWork(
  projectId: string,
  content: string
): Promise<BookOfWorkUploadResult> {
  const encodedProjectId = encodeURIComponent(projectId);
  const url = `${API_BASE}/api/projects/${encodedProjectId}/book-of-work/upload`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content }),
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

    // Handle specific error cases with user-friendly messages
    if (response.status === 404) {
      throw new Error(serverMessage || 'Product not found.');
    }
    if (response.status === 400) {
      throw new Error(
        serverMessage ||
          "Couldn't parse Book of Work. Ensure it has valid headings (##, ###, ####, #####)."
      );
    }
    // Generic error for other failures
    throw new Error(
      serverMessage || `Upload failed: ${response.status} ${response.statusText}`
    );
  }

  const dto: BookOfWorkUploadResultDto = await response.json();
  return mapBookOfWorkResultDtoToResult(dto);
}
