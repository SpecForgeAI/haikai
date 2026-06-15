/**
 * Type definitions for the save_product_artifacts MCP tool.
 * Used to save product artifacts (MISSION.MD) and upsert a minimal ProductDefinition.
 */

// ============================================================================
// Request Type
// ============================================================================

/**
 * Request body for the save_product_artifacts MCP tool
 */
export interface SaveProductArtifactsRequest {
  /** The session ID for tracking state */
  sessionId: string;
  /** Absolute path to the project root folder */
  projectParentFolder: string;
  /** Project UUID (v4 format) */
  projectId: string;
  /** Product name (max 255 characters) */
  productName: string;
  /** Full markdown content for MISSION.MD */
  missionMarkdown: string;
  /** Whether to overwrite existing MISSION.MD (default: true) */
  overwrite?: boolean;
}

// ============================================================================
// Response Type
// ============================================================================

/**
 * Response from the save_product_artifacts operation.
 * Contains the list of written file paths and whether the product was upserted.
 */
export interface SaveProductArtifactsResponse {
  /** Relative paths of files written (e.g., ['agent-os/product/MISSION.MD']) */
  writtenPaths: string[];
  /** Whether the ProductDefinition was successfully upserted in the database */
  productUpserted: boolean;
}

// ============================================================================
// ProductDefinition DTO (matches Java ProductDefinitionDto)
// ============================================================================

/**
 * DTO returned by the architecture-model-service PUT /api/projects/{projectId}/product endpoint.
 */
export interface ProductDefinitionDto {
  /** Unique identifier for the product definition */
  id: string;
  /** Project UUID this product belongs to */
  projectId: string;
  /** Product name */
  productName: string;
  /** ISO-8601 timestamp of creation */
  createdAt: string;
  /** ISO-8601 timestamp of last update */
  updatedAt: string;
}
