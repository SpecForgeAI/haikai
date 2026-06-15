/**
 * Tool registry barrel. Exports the canonical list of tools wired into the
 * LLM capture loop, plus a `buildToolDefinitions()` helper that projects
 * them to the OpenAI tool-definition wire shape consumed by
 * `gatewayClient.callLlmToolLoop`.
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 5.
 * Spec: 2026-05-17 SOAP LLM Extraction and Payload Enrichment (Phase 2)
 *   -- Task Group 9 adds `get_operation_payload_context` as a sibling of
 *   `list_oas_operations`, mirroring its module shape (the listing tool
 *   stays cheap; the new payload-context tool returns rich WSDL metadata
 *   + JAXB DTO source for envelope construction). The propose-endpoints
 *   tool (Group 5) is intentionally NOT registered here -- its invocation
 *   point is the Step 4 wizard button, not a per-scenario LLM round-trip.
 */

import type { ToolDefinition } from '../../types/llm';
import type { ToolRegistryEntry } from './toolTypes';
import { listOasOperationsTool } from './list_oas_operations';
import { getOasOperationDetailTool } from './get_oas_operation_detail';
import { getOperationPayloadContextTool } from './get_operation_payload_context';
import { listDbMetadataTool } from './list_db_metadata';
import { sampleDbValuesTool } from './sample_db_values';
import { runReadonlySqlTool } from './run_readonly_sql';
import { executeHttpRequestTool } from './execute_http_request';
import { recordScenarioCandidateTool } from './record_scenario_candidate';
import { recordCaptureNoteTool } from './record_capture_note';

export const ALL_TOOLS: ReadonlyArray<ToolRegistryEntry> = [
  listOasOperationsTool,
  getOasOperationDetailTool,
  getOperationPayloadContextTool,
  listDbMetadataTool,
  sampleDbValuesTool,
  runReadonlySqlTool,
  executeHttpRequestTool,
  recordScenarioCandidateTool,
  recordCaptureNoteTool,
];

export function buildToolRegistry(
  tools: ReadonlyArray<ToolRegistryEntry> = ALL_TOOLS,
): Map<string, ToolRegistryEntry> {
  const m = new Map<string, ToolRegistryEntry>();
  for (const t of tools) m.set(t.name, t);
  return m;
}

export function buildToolDefinitions(
  tools: ReadonlyArray<ToolRegistryEntry> = ALL_TOOLS,
): ToolDefinition[] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

export type {
  ArchModelToolWriteSurface,
  ToolExecutionContext,
  ToolHandler,
  ToolRegistryEntry,
} from './toolTypes';
export { ToolValidationError } from './toolTypes';
