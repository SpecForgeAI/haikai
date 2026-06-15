/**
 * ProductDefinition API Client
 *
 * Spec: Increment 1 -- Add Product Tab + Minimal ProductDefinition (UI + DB only)
 * Task Group 2: Frontend API Module for ProductDefinition
 *
 * Provides functions for retrieving and upserting a product definition per project.
 * Follows patterns from organisationsApi.ts and projectsApi.ts:
 * - API_BASE from environment variable
 * - snake_case response mapping to camelCase
 * - Error message extraction from JSON response body
 */

/**
 * API base URL from environment variable.
 * Defaults to empty string (same origin) for Vite proxy in development.
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

// ============================================================================
// ProductDefinition Types
// ============================================================================

/**
 * ProductDefinition DTO with camelCase field names.
 * Used by UI code throughout the application.
 */
export interface ProductDefinitionDto {
  id: string;
  projectId: string;
  productName: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Backend response DTO for product definitions (snake_case).
 * This mirrors the API response structure before transformation.
 * Private to this module - not exported.
 *
 * The backend uses a global Jackson SNAKE_CASE naming strategy,
 * so all JSON response fields are snake_case.
 */
interface ProductDefinitionDtoSnake {
  id: string;
  project_id: string;
  product_name: string;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Mapping Functions
// ============================================================================

/**
 * Maps a product definition DTO from snake_case (API response) to camelCase (frontend).
 *
 * The backend uses a global Jackson SNAKE_CASE naming strategy, so all
 * response fields arrive as snake_case and must be mapped to camelCase
 * for use in the frontend.
 *
 * @param dto - The product definition DTO from the API with snake_case field names
 * @returns The product definition DTO with camelCase field names for UI use
 */
function mapProductDefinitionFromSnake(dto: ProductDefinitionDtoSnake): ProductDefinitionDto {
  return {
    id: dto.id,
    projectId: dto.project_id,
    productName: dto.product_name,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Gets the product definition for a project.
 *
 * GET /api/projects/{projectId}/product
 *
 * Returns null on 404 (no product definition exists yet), otherwise returns
 * the ProductDefinitionDto.
 *
 * @param projectId - The project UUID
 * @returns Promise resolving to ProductDefinitionDto or null if not found
 * @throws Error for non-404 failures
 */
export async function getProductDefinition(projectId: string): Promise<ProductDefinitionDto | null> {
  const url = `${API_BASE}/api/projects/${projectId}/product`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
  });

  // Return null on 404 (no product definition yet) instead of throwing
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
      serverMessage || `Failed to get product definition: ${response.status} ${response.statusText}`
    );
  }

  const dto: ProductDefinitionDtoSnake = await response.json();
  return mapProductDefinitionFromSnake(dto);
}

/**
 * Creates or updates the product definition for a project.
 *
 * PUT /api/projects/{projectId}/product
 * Body: { "productName": "..." }
 *
 * The request body uses camelCase for the productName field because the
 * backend controller's SaveProductDefinitionRequest record has
 * @JsonProperty("productName") which overrides the global SNAKE_CASE strategy.
 *
 * @param projectId - The project UUID
 * @param productName - The product name to save
 * @returns Promise resolving to the saved ProductDefinitionDto
 * @throws Error if the API request fails
 */
export async function saveProductDefinition(
  projectId: string,
  productName: string
): Promise<ProductDefinitionDto> {
  const url = `${API_BASE}/api/projects/${projectId}/product`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ productName }),
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
      serverMessage || `Failed to save product definition: ${response.status} ${response.statusText}`
    );
  }

  const dto: ProductDefinitionDtoSnake = await response.json();
  return mapProductDefinitionFromSnake(dto);
}
