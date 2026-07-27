/**
 * Projects API Client
 *
 * Spec 2026-01-05: Project Model with Active Project
 * Provides functions for managing projects and active project state.
 *
 * Spec 2026-01-05: Fix Create Project parent folder null
 * Updated to send snake_case payloads and map snake_case responses to camelCase.
 * Follows patterns from workItemsApi.ts.
 *
 * Spec 2026-01-10: Project Menu + Delete Project
 * Added deleteProject() function for deleting projects.
 *
 * Spec 2026-01-10: Project Hierarchy Grouping
 * Added projectHierarchy field to ProjectDto and createProject() function.
 *
 * Spec 2026-01-18: Organisations Iteration 2 - Mandatory Organisation Autocomplete
 * Added optional organisationId parameter to createProject() function.
 *
 * Spec 2026-01-18: Organisations Iteration 3 - Update Project Open Modal
 * Added organisationId field to ProjectDto and ProjectDtoSnake, updated mapProjectFromSnake().
 *
 * Spec 2026-05-20: Bulk-Resolve OAS/WSDL Parser -- Task Group 7
 * Added maxContractUploadFileSizeMb field to ProjectDto + ProjectDtoSnake
 * and wired it through updateProjectConfig so the project settings modal can
 * patch the column.
 */

/**
 * API base URL from environment variable.
 * Defaults to empty string (same origin) for Vite proxy in development.
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

// ============================================================================
// Project Types
// ============================================================================

/**
 * Project DTO with camelCase field names.
 * Used by UI code throughout the application.
 *
 * Spec 2026-01-10: Project Hierarchy Grouping - Added projectHierarchy field
 * Spec 2026-01-18: Organisations Iteration 3 - Added organisationId field
 */
export interface ProjectDto {
  id: string;
  name: string;
  projectParentFolder: string;
  /** Optional logical grouping for organizing projects in menus. Null = "(No hierarchy)" */
  projectHierarchy: string | null;
  /** Organisation ID this project belongs to. Null if not linked to an organisation. */
  organisationId: string | null;
  /** Git repository URL for the project. Null if not set. */
  repoUrl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /**
   * Per-project cap on tokens spent on per-story content (focused context,
   * evidence refs, findings) when assembling each shape-spec generation
   * payload. Null when not configured (DB default 24000 applies).
   *
   * Spec 2026-05-20: Cross-Story Context Injection -- Task Group 9
   */
  perStoryContextTokenCap: number | null;
  /**
   * Per-project cap on tokens spent on cross-story content (sibling
   * summaries, workstream context) on pass 2. Null when not configured
   * (DB default 12000 applies).
   *
   * Spec 2026-05-20: Cross-Story Context Injection -- Task Group 9
   */
  crossStoryContextTokenCap: number | null;
  /**
   * Per-project default for whether the gateway should automatically run
   * pass 2 after pass 1 completes. Null when not configured (DB default
   * true applies).
   *
   * Spec 2026-05-20: Cross-Story Context Injection -- Task Group 9
   */
  autoRunPass2: boolean | null;
  /**
   * Per-project cap on the size of each uploaded contract file (OAS / WSDL)
   * accepted by the bulk-resolve parse-files endpoint, in megabytes. Null
   * when not configured (DB default 10 applies; AMS falls back to 10 in code
   * as a defence-in-depth guard per
   * `project_primitive_double_dto_overwrite.md`).
   *
   * Spec 2026-05-20: Bulk-Resolve OAS/WSDL Parser -- Task Group 7
   */
  maxContractUploadFileSizeMb: number | null;
  /**
   * Whether the external implementation-service workspace registration
   * (POST /projects/init) has succeeded for this project. Null/undefined =
   * never attempted; false = last attempt failed. Gates the Implement flow.
   *
   * Spec 2026-06-12: Implementation-Service Init and Integration Repair
   */
  implementationInitSuccess?: boolean | null;
  /** Overall workspace mode from init: 'brownfield' | 'greenfield' | 'polyrepo'. */
  implementationMode?: string | null;
  /** Workspace root directory reported by the implementation service. */
  implementationProjectDir?: string | null;
  /** Stored workspace repo map (one entry per cloned repo). */
  implementationRepos?: ImplementationRepoDto[];
}

/**
 * One entry of the implementation-service workspace repo map, as persisted
 * in AMS (`project_implementation_repos`).
 *
 * Spec 2026-06-12: Implementation-Service Init and Integration Repair
 */
export interface ImplementationRepoDto {
  folder: string;
  gitUrl: string;
  workspaceDir: string | null;
  /** Per-repo detected mode: 'greenfield' | 'brownfield'. Null pre-init. */
  mode: string | null;
}

/**
 * Delete project result with success status and message.
 *
 * Spec 2026-01-10: Project Menu + Delete Project
 */
export interface DeleteProjectResult {
  success: boolean;
  message: string;
}

/**
 * Backend response DTO for projects (snake_case).
 * This mirrors the API response structure before transformation.
 * Private to this module - not exported.
 *
 * Spec 2026-01-05: Fix Create Project parent folder null
 * Task 2.1: Define ProjectDtoSnake interface
 *
 * Spec 2026-01-10: Project Hierarchy Grouping - Added project_hierarchy field
 * Spec 2026-01-18: Organisations Iteration 3 - Added organisation_id field
 * Spec 2026-05-20: Bulk-Resolve OAS/WSDL Parser -- Added max_contract_upload_file_size_mb
 */
interface ProjectDtoSnake {
  id: string;
  name: string;
  project_parent_folder: string;
  project_hierarchy: string | null;
  organisation_id: string | null;
  repo_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  per_story_context_token_cap: number | null;
  cross_story_context_token_cap: number | null;
  auto_run_pass_2: boolean | null;
  max_contract_upload_file_size_mb: number | null;
  implementation_init_success?: boolean | null;
  implementation_mode?: string | null;
  implementation_project_dir?: string | null;
  implementation_repos?: Array<{
    folder: string;
    git_url: string;
    workspace_dir: string | null;
    mode: string | null;
  }> | null;
}

// ============================================================================
// Mapping Functions
// ============================================================================

/**
 * Maps a project DTO from snake_case (API response) to camelCase (frontend).
 *
 * Spec 2026-01-05: Fix Create Project parent folder null
 * Task 2.2: Create mapProjectFromSnake mapping function
 *
 * Spec 2026-01-10: Project Hierarchy Grouping - Added projectHierarchy mapping
 * Spec 2026-01-18: Organisations Iteration 3 - Added organisationId mapping
 *
 * @param dto - The project DTO from the API with snake_case field names
 * @returns The project DTO with camelCase field names for UI use
 */
function mapProjectFromSnake(dto: ProjectDtoSnake): ProjectDto {
  return {
    id: dto.id,
    name: dto.name,
    projectParentFolder: dto.project_parent_folder,
    projectHierarchy: dto.project_hierarchy ?? null,
    organisationId: dto.organisation_id ?? null,
    repoUrl: dto.repo_url ?? null,
    isActive: dto.is_active,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
    perStoryContextTokenCap: dto.per_story_context_token_cap ?? null,
    crossStoryContextTokenCap: dto.cross_story_context_token_cap ?? null,
    autoRunPass2: dto.auto_run_pass_2 ?? null,
    maxContractUploadFileSizeMb: dto.max_contract_upload_file_size_mb ?? null,
    implementationInitSuccess: dto.implementation_init_success ?? null,
    implementationMode: dto.implementation_mode ?? null,
    implementationProjectDir: dto.implementation_project_dir ?? null,
    implementationRepos: (dto.implementation_repos ?? []).map((repo) => ({
      folder: repo.folder,
      gitUrl: repo.git_url,
      workspaceDir: repo.workspace_dir ?? null,
      mode: repo.mode ?? null,
    })),
  };
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Creates a new project and sets it as active.
 *
 * POST /api/projects with body { name, project_parent_folder?, project_hierarchy?, organisation_id?, set_active: true }
 *
 * Parent folder is optional - when omitted, the backend defaults it to
 * <projectRootDir>/<organisationName>/<projectName>/
 *
 * @param name - The project name
 * @param projectParentFolder - Optional parent folder path (backend defaults when omitted)
 * @param projectHierarchy - Optional logical grouping for the project
 * @param organisationId - Optional organisation ID to link the project to
 * @param repoUrl - Git repository URL for the project
 * @returns Promise resolving to the created ProjectDto
 * @throws Error if the API request fails
 */
export async function createProject(
  name: string,
  projectParentFolder?: string,
  projectHierarchy?: string,
  organisationId?: string,
  repoUrl?: string
): Promise<ProjectDto> {
  const url = `${API_BASE}/api/projects`;

  // Build request body - only include optional fields when provided
  const requestBody: Record<string, unknown> = {
    name,
    project_hierarchy: projectHierarchy ?? null,
    set_active: true,
  };

  // Only include parent folder if explicitly provided
  if (projectParentFolder !== undefined) {
    requestBody.project_parent_folder = projectParentFolder;
  }

  // Spec 2026-01-18: Include organisation_id only when provided (snake_case for API)
  if (organisationId !== undefined) {
    requestBody.organisation_id = organisationId;
  }

  // Spec 2026-03-21: Include repo_url when provided
  if (repoUrl !== undefined) {
    requestBody.repo_url = repoUrl;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
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
      serverMessage || `Failed to create project: ${response.status} ${response.statusText}`
    );
  }

  const dto: ProjectDtoSnake = await response.json();
  return mapProjectFromSnake(dto);
}

/**
 * Lists all projects.
 *
 * GET /api/projects
 *
 * Spec 2026-01-05: Fix Create Project parent folder null
 * Task 2.4: Updated to map snake_case response
 *
 * @returns Promise resolving to array of ProjectDto
 * @throws Error if the API request fails
 */
export async function listProjects(): Promise<ProjectDto[]> {
  const url = `${API_BASE}/api/projects`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
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

    throw new Error(
      serverMessage || `Failed to list projects: ${response.status} ${response.statusText}`
    );
  }

  const dtos: ProjectDtoSnake[] = await response.json();
  return dtos.map(mapProjectFromSnake);
}

/**
 * Gets the currently active project.
 *
 * GET /api/projects/active
 *
 * Returns null on 404 (no active project), otherwise returns ProjectDto.
 *
 * Spec 2026-01-05: Fix Create Project parent folder null
 * Task 2.5: Updated to map snake_case response
 *
 * @returns Promise resolving to ProjectDto or null if no active project
 * @throws Error for non-404 failures
 */
export async function getActiveProject(): Promise<ProjectDto | null> {
  const url = `${API_BASE}/api/projects/active`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
  });

  // Return null on 404 (no active project) instead of throwing
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
      serverMessage || `Failed to get active project: ${response.status} ${response.statusText}`
    );
  }

  const dto: ProjectDtoSnake = await response.json();
  return mapProjectFromSnake(dto);
}

/**
 * Activates a specific project by ID.
 *
 * POST /api/projects/{id}/activate
 *
 * Spec 2026-01-05: Fix Create Project parent folder null
 * Task 2.6: Updated to map snake_case response
 *
 * @param id - The project ID to activate
 * @returns Promise resolving to the activated ProjectDto
 * @throws Error if the API request fails
 */
export async function activateProject(id: string): Promise<ProjectDto> {
  const url = `${API_BASE}/api/projects/${encodeURIComponent(id)}/activate`;

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

    throw new Error(
      serverMessage || `Failed to activate project: ${response.status} ${response.statusText}`
    );
  }

  const dto: ProjectDtoSnake = await response.json();
  return mapProjectFromSnake(dto);
}

/**
 * Deletes a project by ID.
 *
 * DELETE /api/projects/{id}
 *
 * Deletes both the project's filesystem contents and all database records
 * associated with the project.
 *
 * Spec 2026-01-10: Project Menu + Delete Project
 *
 * @param projectId - The project ID to delete
 * @returns Promise resolving to DeleteProjectResult with success status and message
 * @throws Error if the API request fails (404, 400, 500, etc.)
 */
export async function deactivateAllProjects(): Promise<{ message: string }> {
  const url = `${API_BASE}/api/projects/deactivate-all`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
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
      serverMessage || `Failed to deactivate projects: ${response.status} ${response.statusText}`
    );
  }

  return await response.json();
}

export async function deleteProject(projectId: string): Promise<DeleteProjectResult> {
  const url = `${API_BASE}/api/projects/${encodeURIComponent(projectId)}`;

  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      'Accept': 'application/json',
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

    throw new Error(
      serverMessage || `Failed to delete project: ${response.status} ${response.statusText}`
    );
  }

  const result = await response.json();
  return {
    success: true,
    message: result.message || 'Project deleted successfully',
  };
}

/**
 * Patches the per-project shape-spec generation config.
 *
 * PATCH /api/projects/{projectId} with body containing the supported config
 * fields (any subset). Fields omitted (or sent as undefined) are preserved
 * on the row -- the AMS service layer null-guards each assignment. Sending
 * `null` for a numeric cap explicitly clears the column back to the DB
 * default; sending a number sets it.
 *
 * Spec 2026-05-20: Cross-Story Context Injection -- Task Group 9
 * Spec 2026-05-20: Bulk-Resolve OAS/WSDL Parser -- Task Group 7
 *   Added `maxContractUploadFileSizeMb` to the PATCH payload.
 *
 * @param projectId - The project ID to update
 * @param updates - Partial config: any subset of the supported fields
 * @returns Promise resolving to the updated ProjectDto
 */
export async function updateProjectConfig(
  projectId: string,
  updates: {
    perStoryContextTokenCap?: number | null;
    crossStoryContextTokenCap?: number | null;
    autoRunPass2?: boolean | null;
    maxContractUploadFileSizeMb?: number | null;
    /**
     * Single-repo git URL (Edit-project flow, 2026-07-27). Omit = do not
     * change; EMPTY STRING = explicitly clear the stored URL (the poly-repo
     * convention — the workspace repo map is the authoritative store);
     * non-empty = set.
     */
    repoUrl?: string;
  }
): Promise<ProjectDto> {
  const url = `${API_BASE}/api/projects/${encodeURIComponent(projectId)}`;

  // Only include keys the caller actually passed. Omitting a key entirely
  // (as opposed to passing `null`) tells the backend "do not change this
  // field" per project_primitive_double_dto_overwrite.md.
  const body: Record<string, unknown> = {};
  if (updates.perStoryContextTokenCap !== undefined) {
    body.per_story_context_token_cap = updates.perStoryContextTokenCap;
  }
  if (updates.crossStoryContextTokenCap !== undefined) {
    body.cross_story_context_token_cap = updates.crossStoryContextTokenCap;
  }
  if (updates.autoRunPass2 !== undefined) {
    body.auto_run_pass_2 = updates.autoRunPass2;
  }
  if (updates.maxContractUploadFileSizeMb !== undefined) {
    body.max_contract_upload_file_size_mb =
      updates.maxContractUploadFileSizeMb;
  }
  if (updates.repoUrl !== undefined) {
    body.repo_url = updates.repoUrl;
  }

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
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
      serverMessage ||
        `Failed to update project config: ${response.status} ${response.statusText}`
    );
  }

  const dto: ProjectDtoSnake = await response.json();
  return mapProjectFromSnake(dto);
}

/**
 * Fetches a single project by ID.
 *
 * GET /api/projects/{projectId}
 *
 * Spec 2026-05-20: Cross-Story Context Injection -- Task Group 8 the project
 * config trigger on the migration delivery dashboard needs to fetch the
 * project's current config so the ProjectConfigModal can seed its inputs.
 *
 * @param projectId - The project ID to fetch
 * @returns Promise resolving to the ProjectDto
 * @throws Error on any non-2xx response
 */
export async function getProjectById(projectId: string): Promise<ProjectDto> {
  const url = `${API_BASE}/api/projects/${encodeURIComponent(projectId)}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
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
      serverMessage ||
        `Failed to fetch project: ${response.status} ${response.statusText}`
    );
  }

  const dto: ProjectDtoSnake = await response.json();
  return mapProjectFromSnake(dto);
}
