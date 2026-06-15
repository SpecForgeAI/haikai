/**
 * Type definitions for the save_oas_spec MCP tool.
 * Used to save OpenAPI specifications for interfaces.
 */

// ============================================================================
// Request Type
// ============================================================================

/**
 * Request body for the save_oas_spec MCP tool
 */
export interface SaveOasSpecRequest {
  /** The session ID for tracking state */
  sessionId: string;
  /** The architecture filename (used as folder name) */
  filename: string;
  /** The interface ID to save the spec for */
  interfaceId: string;
  /** Format of the OAS content: 'yaml' or 'json' */
  format: 'yaml' | 'json' | string;
  /** The full OAS document content */
  oasContents: string;
}

// ============================================================================
// Response Type (matches Java SaveOasSpecSummaryDto)
// ============================================================================

/**
 * Response from the save_oas_spec operation.
 * Contains information about the saved file and the updated interface.
 */
export interface SaveOasSpecSummaryDto {
  /** The interface ID */
  interfaceId: string;
  /** The interface name */
  interfaceName: string;
  /** The architecture filename used */
  architectureFilename: string;
  /** Format of the saved content: 'yaml' or 'json' */
  format: string;
  /** Absolute file path where spec was saved */
  savedPath: string;
  /** Same as savedPath (stored in interface.specLink) */
  specLink: string;
  /** ISO-8601 timestamp of the update */
  updatedAt: string;
  /** true if file was newly created, false if overwritten */
  created: boolean;
}
