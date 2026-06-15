/**
 * Type definitions for the save_discovery_run MCP tool.
 * Used to persist a Phase 1 discovery run payload
 * as a durable discovery run resource in the architecture model service.
 */

// ============================================================================
// Request Type
// ============================================================================

/**
 * Request body for the save_discovery_run MCP tool.
 */
export interface SaveDiscoveryRunRequest {
  /** The session ID for tracking state */
  sessionId: string;
  /** Project UUID (v4 format) */
  projectId: string;
  /** JSON string containing the discovery run payload */
  discoveryRunJson: string;
}

// ============================================================================
// Response Type
// ============================================================================

/**
 * Result from the save_discovery_run operation.
 */
export interface SaveDiscoveryRunResult {
  /** The project UUID */
  projectId: string;
  /** The run lifecycle status (e.g., "PENDING", "RUNNING", "COMPLETED", "FAILED") */
  status: string;
}
