/**
 * Type definitions for OAS Gap Report and related structures
 * Used by the compute_oas_gaps MCP tool to analyze interface context
 * and produce deterministic gap reports for OpenAPI generation
 */

// ============================================================================
// Gap Severity
// ============================================================================

/**
 * Severity levels for gaps identified in the interface context
 * - BLOCKING: Must be resolved before OAS can be generated
 * - RECOMMENDED: Should be addressed for a complete OAS
 * - INFO: Informational notice, defaults will be applied
 */
export type GapSeverity = 'BLOCKING' | 'RECOMMENDED' | 'INFO';

// ============================================================================
// Gap Location
// ============================================================================

/**
 * Location information for a gap, identifying where in the interface
 * the gap was detected
 */
export interface GapLocation {
  /** The interface ID where the gap was found */
  interfaceId?: string;
  /** The endpoint ID if gap is endpoint-specific */
  endpointId?: string;
  /** The HTTP method (GET, POST, etc.) */
  method?: string;
  /** The path/address of the endpoint */
  path?: string;
  /** The parameter name if gap relates to a specific parameter */
  paramName?: string;
}

// ============================================================================
// Gap Item
// ============================================================================

/**
 * A single gap item representing missing or incomplete data
 * that affects OAS generation
 */
export interface GapItem {
  /** Unique code identifying the type of gap (e.g., 'SERVER_URL_MISSING') */
  code: string;
  /** Severity level of the gap */
  severity: GapSeverity;
  /** Human-readable description of the gap */
  message: string;
  /** Optional location information for the gap */
  location?: GapLocation;
  /** Optional suggested questions to ask the user to resolve the gap */
  suggestedQuestions?: string[];
  /** Optional additional data related to the gap */
  data?: Record<string, unknown>;
}

// ============================================================================
// Default Assumption
// ============================================================================

/**
 * A default value that will be assumed during OAS generation
 * when no explicit value is provided
 */
export interface DefaultAssumption {
  /** Unique code identifying the default (e.g., 'DEFAULT_INFO_VERSION') */
  code: string;
  /** The default value that will be used */
  value: unknown;
  /** Explanation of why this default is being applied */
  rationale: string;
}

// ============================================================================
// Type Mapping
// ============================================================================

/**
 * Mapping from a logical data type to its OpenAPI schema representation
 */
export interface TypeMapping {
  /** The logical type name from the architecture model (e.g., 'string_uuid') */
  logicalType: string;
  /** The corresponding OpenAPI schema object */
  oasSchema: Record<string, unknown>;
}

// ============================================================================
// Operation ID Suggestion
// ============================================================================

/**
 * A suggested operationId for an endpoint in a specific naming style
 */
export interface OperationIdSuggestion {
  /** The endpoint ID this suggestion is for */
  endpointId: string;
  /** The HTTP method of the endpoint */
  method?: string;
  /** The path/address of the endpoint */
  path?: string;
  /** The naming style used: camelCase or snake_case */
  style: 'camelCase' | 'snake_case';
  /** The suggested operationId value */
  operationId: string;
}

// ============================================================================
// Gap Report
// ============================================================================

/**
 * Complete gap report for an interface, containing all analysis results
 * for OAS generation
 */
export interface GapReport {
  /** The interface ID that was analyzed */
  interfaceId: string;
  /** ISO timestamp when the report was generated */
  generatedAt: string;
  /** List of gaps identified in the interface */
  gaps: GapItem[];
  /** List of default assumptions that will be applied */
  defaults: DefaultAssumption[];
  /** List of type mappings for logical types to OAS schemas */
  typeMappings: TypeMapping[];
  /** List of operationId suggestions for each endpoint */
  operationIds: OperationIdSuggestion[];
}

// ============================================================================
// Request Type
// ============================================================================

/**
 * Request body for the compute_oas_gaps MCP tool
 */
export interface ComputeOasGapsRequest {
  /** The session ID for tracking state */
  sessionId: string;
  /** The interface ID to analyze */
  interfaceId: string;
  /** Optional draft OAS content for incremental analysis (ignored in v1) */
  draftOas?: string;
}
