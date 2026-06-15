/**
 * Organisations API Client
 *
 * Spec 2026-01-18: Organisations Iteration 2 - Mandatory Organisation Autocomplete
 * Provides functions for listing and creating organisations.
 *
 * Spec 2026-01-18: Planner to Implementor Handoff via Orchestrations API
 * Added getOrganisationById function for looking up organisation name by ID.
 *
 * Spec 2026-01-31: Create Organisation Modal
 * Added CreateOrganisationPayload interface and createOrganisationFull function
 * for creating organisations with full payload (name, description, all docs fields).
 *
 * Spec 2026-01-31: Trigger Global Standards Generation
 * Added StandardsGenerationPayload interface and generateGlobalStandards function
 * for triggering global standards generation after organisation creation.
 *
 * Spec 2026-01-31: Fix Create Organisation Standards Flow
 * Task Group 2B: Updated StandardsGenerationPayload to external-compatible schema.
 *
 * Spec 2026-01-31: Project-level Standards Generation
 * Task Group 2: Added ProjectStandardsPayload interface and generateProjectStandards function.
 *
 * Follows patterns from projectsApi.ts and workItemsApi.ts:
 * - API_BASE from environment variable
 * - snake_case request/response mapping
 * - Error message extraction from JSON response body
 */

/**
 * API base URL from environment variable.
 * Defaults to empty string (same origin) for Vite proxy in development.
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

// ============================================================================
// Organisation Types
// ============================================================================

/**
 * Organisation DTO with camelCase field names.
 * Used by UI code throughout the application.
 */
export interface OrganisationDto {
  id: string;
  name: string;
  description: string | null;
}

/**
 * Payload for creating an organisation with all fields.
 *
 * Spec 2026-01-31: Create Organisation Modal - Task Group 2
 * Contains all fields needed for creating an organisation including
 * standards document lists.
 */
export interface CreateOrganisationPayload {
  /** Organisation name (required) */
  name: string;
  /** Organisation description (optional) */
  description: string | null;
  /** Documents applied to all standards sources */
  docsAppliedToAllSources: string[];
  /** Documents applied to tech stack standards */
  docsAppliedToTechStack: string[];
  /** Documents applied to coding styles standards */
  docsAppliedToCodingStyles: string[];
  /** Documents applied to conventions standards */
  docsAppliedToConventions: string[];
  /** Documents applied to error handling standards */
  docsAppliedToErrorHandling: string[];
  /** Documents applied to validation standards */
  docsAppliedToValidation: string[];
}

/**
 * Payload for generating global standards.
 *
 * Spec 2026-01-31: Fix Create Organisation Standards Flow - Task Group 2B
 * External-compatible schema: no organisationId, gateway resolves by company name.
 * Frontend sends directly in external format with snake_case keys in technical_documents.
 */
export interface StandardsGenerationPayload {
  /** Company name (required, maps to organisation name) */
  company: string;
  /** Documents applied to all standards sources */
  sources: string[];
  /** Technical documents with snake_case keys */
  technical_documents: {
    tech_stack: string[];
    coding_style: string[];
    conventions: string[];
    error_handling: string[];
    validation: string[];
  };
}

/**
 * Payload for generating project-level standards.
 *
 * Spec 2026-01-31: Project-level Standards Generation - Task Group 2
 * Used to trigger project standards generation with company name, project name, and sources.
 */
export interface ProjectStandardsPayload {
  /** Company name (required, maps to organisation name) */
  company: string;
  /** Project name (required) */
  project: string;
  /** Source URLs or file paths for standards generation */
  sources: string[];
}

/**
 * Backend response DTO for organisations (snake_case).
 * This mirrors the API response structure before transformation.
 * Private to this module - not exported.
 */
interface OrganisationDtoSnake {
  id: string;
  name: string;
  description: string | null;
}

/**
 * Error class for organisation creation conflicts (409 response).
 * Used to identify when an organisation with the same name already exists.
 */
export class OrganisationConflictError extends Error {
  public readonly isConflict: boolean = true;

  constructor(message: string) {
    super(message);
    this.name = 'OrganisationConflictError';
    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, OrganisationConflictError.prototype);
  }
}

// ============================================================================
// Mapping Functions
// ============================================================================

/**
 * Maps an organisation DTO from snake_case (API response) to camelCase (frontend).
 *
 * Note: For organisations, the fields happen to be the same in both cases
 * (id, name, description), but we keep this mapping function for consistency
 * with the codebase patterns and future-proofing.
 *
 * @param dto - The organisation DTO from the API with snake_case field names
 * @returns The organisation DTO with camelCase field names for UI use
 */
function mapOrganisationFromSnake(dto: OrganisationDtoSnake): OrganisationDto {
  return {
    id: dto.id,
    name: dto.name,
    description: dto.description,
  };
}

/**
 * Maps a CreateOrganisationPayload to snake_case for the API request body.
 *
 * Spec 2026-01-31: Create Organisation Modal - Task Group 2
 *
 * @param payload - The payload with camelCase field names
 * @returns The request body with snake_case field names for the API
 */
function mapPayloadToSnake(payload: CreateOrganisationPayload): Record<string, unknown> {
  return {
    name: payload.name,
    description: payload.description,
    docs_applied_to_all_sources: payload.docsAppliedToAllSources,
    docs_applied_to_tech_stack: payload.docsAppliedToTechStack,
    docs_applied_to_coding_styles: payload.docsAppliedToCodingStyles,
    docs_applied_to_conventions: payload.docsAppliedToConventions,
    docs_applied_to_error_handling: payload.docsAppliedToErrorHandling,
    docs_applied_to_validation: payload.docsAppliedToValidation,
  };
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Lists all organisations.
 *
 * GET /api/v1/organisations
 *
 * @returns Promise resolving to array of OrganisationDto
 * @throws Error if the API request fails
 */
export async function listOrganisations(): Promise<OrganisationDto[]> {
  const url = `${API_BASE}/api/v1/organisations`;

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
      serverMessage || `Failed to list organisations: ${response.status} ${response.statusText}`
    );
  }

  const dtos: OrganisationDtoSnake[] = await response.json();
  return dtos.map(mapOrganisationFromSnake);
}

/**
 * Gets an organisation by its ID.
 *
 * Spec 2026-01-18: Planner to Implementor Handoff via Orchestrations API
 * Task Group 4: Used to resolve organisation name for the `company` field
 * in the orchestration request.
 *
 * Note: This function fetches all organisations and filters by ID since
 * there is no dedicated GET /api/v1/organisations/:id endpoint.
 * Consider adding a dedicated endpoint if performance becomes an issue.
 *
 * @param id - The organisation ID to look up
 * @returns Promise resolving to OrganisationDto or null if not found
 * @throws Error if the API request fails
 */
export async function getOrganisationById(id: string): Promise<OrganisationDto | null> {
  const organisations = await listOrganisations();
  return organisations.find((org) => org.id === id) ?? null;
}

/**
 * Creates a new organisation with minimal fields.
 *
 * POST /api/v1/organisations with body { name, description: null }
 *
 * @param name - The organisation name
 * @returns Promise resolving to the created OrganisationDto
 * @throws OrganisationConflictError if organisation with same name already exists (409)
 * @throws Error if the API request fails for other reasons
 */
export async function createOrganisation(name: string): Promise<OrganisationDto> {
  const url = `${API_BASE}/api/v1/organisations`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      description: null,
    }),
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

    const errorMessage =
      serverMessage || `Failed to create organisation: ${response.status} ${response.statusText}`;

    // Handle 409 Conflict specially
    if (response.status === 409) {
      throw new OrganisationConflictError(errorMessage);
    }

    throw new Error(errorMessage);
  }

  const dto: OrganisationDtoSnake = await response.json();
  return mapOrganisationFromSnake(dto);
}

/**
 * Creates a new organisation with full payload.
 *
 * Spec 2026-01-31: Create Organisation Modal - Task Group 2
 *
 * POST /api/v1/organisations with full body including all document fields.
 *
 * @param payload - The full organisation payload
 * @returns Promise resolving to the created OrganisationDto
 * @throws OrganisationConflictError if organisation with same name already exists (409)
 * @throws Error if the API request fails for other reasons
 */
export async function createOrganisationFull(
  payload: CreateOrganisationPayload
): Promise<OrganisationDto> {
  const url = `${API_BASE}/api/v1/organisations`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(mapPayloadToSnake(payload)),
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

    const errorMessage =
      serverMessage || `Failed to create organisation: ${response.status} ${response.statusText}`;

    // Handle 409 Conflict specially
    if (response.status === 409) {
      throw new OrganisationConflictError(errorMessage);
    }

    throw new Error(errorMessage);
  }

  const dto: OrganisationDtoSnake = await response.json();
  return mapOrganisationFromSnake(dto);
}

/**
 * Triggers global standards generation for an organisation.
 *
 * Spec 2026-01-31: Fix Create Organisation Standards Flow - Task Group 2B
 *
 * POST /api/v1/standards/global/generate
 *
 * This function calls the Gateway endpoint which:
 * 1. Receives external-compatible schema directly (no mapping needed)
 * 2. Forwards to external Standards service
 * 3. Resolves organisationId by company name
 * 4. Orchestrates the backend PATCH to set techStandardsGenerated=true
 *
 * @param payload - The standards generation payload in external-compatible format
 * @returns Promise resolving when generation completes successfully
 * @throws Error if the API request fails or standards generation fails
 */
export async function generateGlobalStandards(
  payload: StandardsGenerationPayload
): Promise<void> {
  const url = `${API_BASE}/api/v1/standards/global/generate`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
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
      serverMessage || `Standards generation failed: ${response.status} ${response.statusText}`
    );
  }

  // Success - no return value needed
  // The gateway has already orchestrated the backend PATCH
}

/**
 * Triggers project-level standards generation.
 *
 * Spec 2026-01-31: Project-level Standards Generation - Task Group 2
 *
 * POST /api/v1/standards/product/generate
 *
 * This function calls the Gateway endpoint which:
 * 1. Receives company name, project name, and sources
 * 2. Forwards to external Standards service with Bearer auth
 * 3. Returns success/failure for toast notification
 *
 * @param payload - The project standards generation payload
 * @returns Promise resolving when generation completes successfully
 * @throws Error if the API request fails or standards generation fails
 */
export async function generateProjectStandards(
  payload: ProjectStandardsPayload
): Promise<void> {
  const url = `${API_BASE}/api/v1/standards/product/generate`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
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
      serverMessage || `Project standards generation failed: ${response.status} ${response.statusText}`
    );
  }

  // Success - no return value needed
  // The external service handles persistence internally
}
