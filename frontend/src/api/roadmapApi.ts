/**
 * Roadmap API Client
 *
 * Spec 2026-01-04: Product Roadmap Review Page
 * Task Group 1: API client for roadmap import operations.
 *
 * Spec 2026-01-04: Roadmap Import UX Glue
 * Task Group 3: Extended with detailed counts and artifact metadata.
 *
 * Follows patterns from workItemsApi.ts.
 */

/**
 * API base URL from environment variable.
 * Defaults to empty string (same origin) for Vite proxy in development.
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

// ============================================================================
// Import Result Types
// ============================================================================

/**
 * Backend response DTO for import result (snake_case)
 * This mirrors the API response structure before transformation
 */
export interface ImportResultDto {
  project_id: string;
  artifact_revision: number;
  initiatives_created: number;
  epics_created: number;
  // Detailed counts (Spec 2026-01-04: Roadmap Import UX Glue)
  initiatives_inserted: number;
  initiatives_updated: number;
  initiatives_archived: number;
  initiatives_deleted: number;
  epics_inserted: number;
  epics_updated: number;
  epics_archived: number;
  epics_deleted: number;
}

/**
 * Frontend interface for import result (camelCase)
 * Transformed from ImportResultDto for consistent frontend usage
 */
export interface ImportResult {
  projectId: string;
  artifactRevision: number;
  initiativesCreated: number;
  epicsCreated: number;
  // Detailed counts (Spec 2026-01-04: Roadmap Import UX Glue)
  initiativesInserted: number;
  initiativesUpdated: number;
  initiativesArchived: number;
  initiativesDeleted: number;
  epicsInserted: number;
  epicsUpdated: number;
  epicsArchived: number;
  epicsDeleted: number;
}

/**
 * Maps an import result DTO from snake_case (API) to camelCase (frontend)
 *
 * @param dto - The import result DTO from the API
 * @returns The import result with camelCase field names
 */
export function mapImportResultDtoToImportResult(dto: ImportResultDto): ImportResult {
  return {
    projectId: dto.project_id,
    artifactRevision: dto.artifact_revision,
    initiativesCreated: dto.initiatives_created,
    epicsCreated: dto.epics_created,
    // Detailed counts
    initiativesInserted: dto.initiatives_inserted ?? 0,
    initiativesUpdated: dto.initiatives_updated ?? 0,
    initiativesArchived: dto.initiatives_archived ?? 0,
    initiativesDeleted: dto.initiatives_deleted ?? 0,
    epicsInserted: dto.epics_inserted ?? 0,
    epicsUpdated: dto.epics_updated ?? 0,
    epicsArchived: dto.epics_archived ?? 0,
    epicsDeleted: dto.epics_deleted ?? 0,
  };
}

// ============================================================================
// Artifact Metadata Types
// ============================================================================

/**
 * Backend response DTO for artifact metadata (snake_case)
 * Spec 2026-01-04: Roadmap Import UX Glue - Task Group 3
 */
export interface ArtifactMetadataDto {
  project_id: string;
  artifact_type: string;
  revision: number;
  created_at: string;
  source: string;
}

/**
 * Frontend interface for artifact metadata (camelCase)
 * Spec 2026-01-04: Roadmap Import UX Glue - Task Group 3
 */
export interface ArtifactMetadata {
  projectId: string;
  artifactType: string;
  revision: number;
  createdAt: Date;
  source: string;
}

/**
 * Maps artifact metadata DTO from snake_case (API) to camelCase (frontend)
 *
 * @param dto - The artifact metadata DTO from the API
 * @returns The artifact metadata with camelCase field names
 */
export function mapArtifactMetadataDtoToArtifactMetadata(dto: ArtifactMetadataDto): ArtifactMetadata {
  return {
    projectId: dto.project_id,
    artifactType: dto.artifact_type,
    revision: dto.revision,
    createdAt: new Date(dto.created_at),
    source: dto.source,
  };
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Imports the roadmap.md file for a project.
 *
 * Calls POST /api/model/projects/{projectId}/roadmap/import
 *
 * Spec 2026-01-04: Roadmap Import UX Glue - Enhanced error handling.
 *
 * @param projectId - The project identifier (filename)
 * @returns Promise resolving to ImportResult with import statistics
 * @throws Error with specific message for 404 (roadmap.md not found)
 * @throws Error with specific message for 400 (parse error)
 * @throws Error with specific message for 409 (conflict)
 * @throws Error with server message for other failures
 */
export async function importRoadmap(projectId: string): Promise<ImportResult> {
  const encodedProjectId = encodeURIComponent(projectId);
  const url = `${API_BASE}/api/model/projects/${encodedProjectId}/roadmap/import`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
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
      throw new Error('roadmap.md not found. Expected at: agent-os/product/roadmap.md');
    }
    if (response.status === 400) {
      throw new Error(
        serverMessage ||
        "Couldn't parse roadmap.md. Supported formats: headings, lists, initiative bullets, tables."
      );
    }
    if (response.status === 409) {
      throw new Error(serverMessage || 'Import conflict. Please retry.');
    }
    // Generic error for other failures
    throw new Error(serverMessage || `Import failed: ${response.status} ${response.statusText}`);
  }

  const dto: ImportResultDto = await response.json();
  return mapImportResultDtoToImportResult(dto);
}

/**
 * Fetches the latest artifact metadata for a project.
 *
 * Calls GET /api/model/projects/{projectId}/artifacts/{artifactType}/latest-metadata
 *
 * Spec 2026-01-04: Roadmap Import UX Glue - Task Group 3.
 *
 * @param projectId - The project identifier
 * @param artifactType - The artifact type (e.g., 'ROADMAP_MD', 'MISSION_MD')
 * @returns Promise resolving to ArtifactMetadata or null if not found (404)
 * @throws Error for 400/500 and other non-404 errors
 */
export async function fetchLatestArtifactMetadata(
  projectId: string,
  artifactType: string
): Promise<ArtifactMetadata | null> {
  const encodedProjectId = encodeURIComponent(projectId);
  const encodedArtifactType = encodeURIComponent(artifactType);
  const url = `${API_BASE}/api/model/projects/${encodedProjectId}/artifacts/${encodedArtifactType}/latest-metadata`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
  });

  // Return null on 404 (no artifact found) instead of throwing
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
      serverMessage || `Failed to fetch artifact metadata: ${response.status} ${response.statusText}`
    );
  }

  const dto: ArtifactMetadataDto = await response.json();
  return mapArtifactMetadataDtoToArtifactMetadata(dto);
}
