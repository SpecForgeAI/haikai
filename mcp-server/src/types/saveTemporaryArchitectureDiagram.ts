/**
 * Type definitions for the saveTemporaryArchitectureDiagram MCP tool.
 * Used to persist a TemporaryArchitectureDiagram payload (LLM-generated)
 * as a durable temporary diagram resource in the architecture model service.
 */

// ============================================================================
// Request Type
// ============================================================================

/**
 * Request body for the saveTemporaryArchitectureDiagram MCP tool.
 */
export interface SaveTemporaryArchitectureDiagramRequest {
  /** The session ID for tracking state */
  sessionId: string;
  /** Project UUID (v4 format) */
  projectId: string;
  /**
   * Optional architecture UUID (v4 format). When supplied, the diagram is
   * saved under this architecture. When omitted (e.g. legacy callers), the
   * service falls back to the project's default architecture (oldest
   * non-archived) to preserve backwards compatibility.
   *
   * Hotfix 2026-05-13: the gateway extracts this from the chat request's
   * `architectureId` (the chat panel sends the URL-active id) so the save
   * targets the same architecture the frontend preview will GET from.
   */
  architectureId?: string;
  /** JSON string containing the TemporaryArchitectureDiagram payload */
  diagramJson: string;
}

// ============================================================================
// Response Type
// ============================================================================

/**
 * Result from the saveTemporaryArchitectureDiagram operation.
 */
export interface SaveTemporaryArchitectureDiagramResult {
  /** The client/LLM-provided TemporaryArchitectureDiagram.id */
  id: string;
  /** Status indicator -- always "saved" on success */
  status: 'saved';
  /** ISO-8601 timestamp of when the diagram was created/updated */
  createdAt: string;
}
