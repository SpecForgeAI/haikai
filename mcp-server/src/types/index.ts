/**
 * TypeScript type definitions for MCP Server
 * These types match the corresponding Java DTOs in architecture-model-service
 */

// ============================================================================
// Interface Summary DTO (matches InterfaceSummaryDto.java)
// ============================================================================

export interface InterfaceSummaryDto {
  interfaceId: string;
  interfaceName: string;
  interfaceType: string;
  serviceId: string | null;
  serviceName: string | null;
  applicationId: string | null;
  applicationName: string | null;
  endpointCount: number;
}

// ============================================================================
// Interface OAS Context DTOs (matches InterfaceOasContextDto.java and nested)
// ============================================================================

export interface InterfaceDetailDto {
  id: string;
  name: string;
  description: string | null;
  interfaceType: string | null;
  specLink: string | null;
  tags: string | null;
  validFrom: string | null;
  validTo: string | null;
}

export interface ServiceDetailDto {
  id: string;
  name: string;
  description: string | null;
  serviceType: string | null;
  tags: string | null;
}

export interface ApplicationDetailDto {
  id: string;
  name: string;
  description: string | null;
  appType: string | null;
  status: string | null;
  tags: string | null;
}

export interface InterfaceEndpointDto {
  id: string;
  name: string;
  description: string | null;
  endpointType: string | null;
  pathOrAddress: string | null;
  protocol: string | null;
  operationVerb: string | null;
  direction: string | null;
  lifecycleStatus: string | null;
  version: string | null;
  tags: string | null;
  validFrom: string | null;
  validTo: string | null;
}

export interface LogicalAttributeDto {
  id: string;
  name: string;
  description: string | null;
  dataType: string | null;
  isPrimaryKey: boolean | null;
  isNullable: boolean | null;
  tags: string | null;
}

export interface LogicalEntitySchemaDto {
  id: string;
  name: string;
  description: string | null;
  tags: string | null;
  validFrom: string | null;
  validTo: string | null;
  attributes: LogicalAttributeDto[];
}

export interface OasNotesDto {
  basePathCandidates: string[];
  serverUrlCandidates: string[];
}

export interface InterfaceOasContextDto {
  interface: InterfaceDetailDto;
  service: ServiceDetailDto | null;
  application: ApplicationDetailDto | null;
  endpoints: InterfaceEndpointDto[];
  logicalEntities: LogicalEntitySchemaDto[];
  notes: OasNotesDto | null;
}

// ============================================================================
// Session Types
// ============================================================================

export interface Session {
  sessionId: string;
  filename?: string;
  lastListedInterfaces?: InterfaceSummaryDto[];
  lastSelectedInterfaceId?: string;
  productName?: string;
  lastActivity: Date;
}

// ============================================================================
// MCP Request Types
// ============================================================================

export interface ListInterfacesRequest {
  sessionId: string;
  filename: string;
}

export interface GetInterfaceContextRequest {
  sessionId: string;
  interfaceId: string;
}

// ============================================================================
// MCP Response Types
// ============================================================================

export interface McpErrorResponse {
  code: number;
  message: string;
}

export interface McpToolResponse<T> {
  data?: T;
  error?: McpErrorResponse;
}

// ============================================================================
// OAS Gaps Types (for compute_oas_gaps tool)
// ============================================================================

export * from './oasGaps';

// ============================================================================
// Save OAS Spec Types (for save_oas_spec tool)
// ============================================================================

export * from './saveOasSpec';

// ============================================================================
// Save Product Artifacts Types (for save_product_artifacts tool)
// ============================================================================

export * from './saveProductArtifacts';

// ============================================================================
// Save Architecture Baseline Types (for save_architecture_baseline tool)
// ============================================================================

export * from './saveArchitectureBaseline';

// ============================================================================
// Save Roadmap Structure Types (for save_roadmap_structure tool)
// ============================================================================

export * from './saveRoadmapStructure';

// ============================================================================
// Save Markdown Artifact Types (for save_markdown_artifact tool)
// ============================================================================

export * from './saveMarkdownArtifact';

// ============================================================================
// Save Users & Interactions Types (for save_users_interactions tool)
// ============================================================================

export * from './saveUsersInteractions';

// ============================================================================
// Save Backlog Items Types (for save_backlog_items tool)
// ============================================================================

export * from './saveBacklogItems';

// ============================================================================
// Save User Journeys Types (for save_user_journeys tool)
// ============================================================================

export * from './saveUserJourneys';
// Both ./saveUsersInteractions and ./saveUserJourneys declare a
// `ProcessActivityInput`; the star exports above make the barrel name
// ambiguous (TS2308). Explicitly re-export the saveUserJourneys shape as
// the barrel winner. (All current consumers import the type directly from
// its own module, so this only settles the barrel ambiguity.)
export { ProcessActivityInput } from './saveUserJourneys';

// ============================================================================
// Save Discovery Config Types (for save_discovery_config tool)
// ============================================================================

export * from './saveDiscoveryConfig';
