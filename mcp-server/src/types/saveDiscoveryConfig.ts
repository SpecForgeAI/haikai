/**
 * Type definitions for the save_discovery_config MCP tool.
 * Used to persist a Phase 0 discovery configuration payload
 * as a durable discovery config resource in the architecture model service.
 */

// ============================================================================
// Request Type
// ============================================================================

/**
 * Request body for the save_discovery_config MCP tool.
 */
export interface SaveDiscoveryConfigRequest {
  /** The session ID for tracking state */
  sessionId: string;
  /** Project UUID (v4 format) */
  projectId: string;
  /** JSON string containing the discovery config payload */
  discoveryConfigJson: string;
}

// ============================================================================
// Response Type
// ============================================================================

/**
 * Result from the save_discovery_config operation.
 */
export interface SaveDiscoveryConfigResult {
  /** The project UUID */
  projectId: string;
  /** The config lifecycle status (e.g., "DRAFT" or "COMPLETE") */
  status: string;
}
