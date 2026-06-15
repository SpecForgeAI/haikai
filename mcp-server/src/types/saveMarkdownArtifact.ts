/**
 * Type definitions for the save_markdown_artifact MCP tool.
 * Used to save arbitrary markdown files to agent-os/product/.
 * Supports TECH-STACK.MD, TEST-STRATEGY.MD, and any future markdown artifacts.
 */

// ============================================================================
// Request Type
// ============================================================================

/**
 * Request body for the save_markdown_artifact MCP tool
 */
export interface SaveMarkdownArtifactRequest {
  /** The session ID for tracking state */
  sessionId: string;
  /** Project UUID (v4 format) */
  projectId: string;
  /** Optional absolute path to the project root folder (resolved from config if omitted) */
  projectParentFolder?: string;
  /** Target filename (must end in .MD, .md, .yaml, .yml, or .json; no path traversal) */
  artifactFilename: string;
  /** Full markdown content to write */
  markdown: string;
}

// ============================================================================
// Response Type
// ============================================================================

/**
 * Response from the save_markdown_artifact operation.
 * Contains the list of written file paths.
 */
export interface SaveMarkdownArtifactResponse {
  /** Relative paths of files written (e.g., ['agent-os/product/TECH-STACK.MD']) */
  writtenPaths: string[];
}
