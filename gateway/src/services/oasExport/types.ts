/**
 * OAS Export types.
 *
 * Direct build 2026-06-11: deterministic OpenAPI export from the target
 * architecture (oracle weaknesses item #5 — "OAS gen unwired").
 *
 * The interface-context and gap-report shapes mirror the mcp-server types
 * (`mcp-server/src/types/index.ts` / `oasGaps.ts`) field-for-field, because
 * the gateway obtains both payloads through the existing mcp tool endpoints
 * (`get_interface_oas_context`, `compute_oas_gaps`) via `toolExecutor`.
 */

// ---------------------------------------------------------------------------
// Interface OAS context (mirrors InterfaceOasContextDto)
// ---------------------------------------------------------------------------

export interface OasInterfaceDetail {
  id: string;
  name: string;
  description: string | null;
  interfaceType: string | null;
  specLink: string | null;
}

export interface OasServiceDetail {
  id: string;
  name: string;
}

export interface OasApplicationDetail {
  id: string;
  name: string;
}

export interface OasInterfaceEndpoint {
  id: string;
  name: string;
  description: string | null;
  endpointType: string | null;
  pathOrAddress: string | null;
  protocol: string | null;
  operationVerb: string | null;
}

export interface OasLogicalAttribute {
  id: string;
  name: string;
  description: string | null;
  dataType: string | null;
  isPrimaryKey: boolean | null;
  isNullable: boolean | null;
}

export interface OasLogicalEntity {
  id: string;
  name: string;
  description: string | null;
  attributes: OasLogicalAttribute[];
}

export interface OasNotes {
  basePathCandidates: string[];
  serverUrlCandidates: string[];
}

export interface InterfaceOasContext {
  interface: OasInterfaceDetail;
  service: OasServiceDetail | null;
  application: OasApplicationDetail | null;
  endpoints: OasInterfaceEndpoint[];
  logicalEntities: OasLogicalEntity[];
  notes: OasNotes | null;
}

// ---------------------------------------------------------------------------
// Gap report (mirrors mcp-server GapReport)
// ---------------------------------------------------------------------------

export type OasGapSeverity = 'BLOCKING' | 'RECOMMENDED' | 'INFO';

export interface OasGapItem {
  code: string;
  severity: OasGapSeverity;
  message: string;
  location?: {
    interfaceId?: string;
    endpointId?: string;
    method?: string;
    path?: string;
  };
  suggestedQuestions?: string[];
  data?: Record<string, unknown>;
}

export interface OasGapReport {
  interfaceId: string;
  generatedAt: string;
  gaps: OasGapItem[];
  defaults: Array<{ code: string; value: unknown; rationale: string }>;
  typeMappings: Array<{ logicalType: string; oasSchema: Record<string, unknown> }>;
  operationIds: Array<{
    endpointId: string;
    method?: string;
    path?: string;
    style: 'camelCase' | 'snake_case';
    operationId: string;
  }>;
}

// ---------------------------------------------------------------------------
// Assembly output
// ---------------------------------------------------------------------------

/** An endpoint that could not be expressed as an OAS path operation. */
export interface UnmappedEndpoint {
  endpointId: string;
  name: string;
  reason: string;
}

export interface OasAssemblySummary {
  endpointCount: number;
  mappedEndpointCount: number;
  unmappedEndpoints: UnmappedEndpoint[];
  schemaCount: number;
  gapCounts: { blocking: number; recommended: number; info: number };
}

export interface OasAssemblyResult {
  /** The assembled OpenAPI 3.0 document (plain JSON object, key-order stable). */
  document: Record<string, unknown>;
  summary: OasAssemblySummary;
}

/** Per-interface result returned by the generate routes. */
export interface OasExportResult {
  interfaceId: string;
  interfaceName: string;
  suggestedFilename: string;
  document: Record<string, unknown>;
  gapReport: OasGapReport;
  summary: OasAssemblySummary;
}
