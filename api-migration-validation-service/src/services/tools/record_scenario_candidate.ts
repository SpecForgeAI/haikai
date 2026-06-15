import { ToolHandler, ToolRegistryEntry, ToolValidationError } from './toolTypes';
import { redactHeaders, redactJson } from '../redactor';
import type { GenerationSource, ScenarioType } from '../../types/captureSession';

/**
 * Tool: `record_scenario_candidate`
 *
 * Persists a candidate scenario row via `archModelClient.createScenario`.
 * Inputs are passed through the redactor BEFORE the AMS write so secrets
 * never cross the AMS boundary. The returned scenario id is fed back to the
 * LLM so it can use it on subsequent `record_capture_note` / capture rows.
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 5.
 */

const VALID_SCENARIO_TYPES: ReadonlySet<ScenarioType> = new Set<ScenarioType>([
  'happy_path',
  'not_found',
  'validation_error',
  'empty_result',
  'boundary_value',
  'auth_error',
  'business_edge_case',
  'generated_candidate',
]);

const VALID_GENERATION_SOURCES: ReadonlySet<GenerationSource> = new Set<GenerationSource>([
  'oas_example',
  'db_sample',
  'llm_generated',
  'llm_refined',
  'user_edited',
]);

/** Flatten an arbitrary header bag into Record<string, string>. Multi-valued
 * headers are joined with `, ` so the AMS column type matches. */
function normaliseHeaders(input: Record<string, string | string[]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    out[k] = Array.isArray(v) ? v.join(', ') : v;
  }
  return out;
}

const handler: ToolHandler = async (args, ctx) => {
  const operationOasId = typeof args.operationId === 'string' ? args.operationId : null;
  const scenarioName = typeof args.scenarioName === 'string' ? args.scenarioName : null;
  if (!operationOasId || !scenarioName) {
    throw new ToolValidationError(
      'record_scenario_candidate',
      'missing_args',
      '`operationId` and `scenarioName` are required.',
    );
  }
  const persisted = ctx.operationsByOasId.get(operationOasId);
  if (!persisted) {
    throw new ToolValidationError(
      'record_scenario_candidate',
      'operation_not_persisted',
      `operationId='${operationOasId}' is not registered for this session.`,
    );
  }

  const scenarioType: ScenarioType =
    typeof args.scenarioType === 'string' && VALID_SCENARIO_TYPES.has(args.scenarioType as ScenarioType)
      ? (args.scenarioType as ScenarioType)
      : 'generated_candidate';
  const generationSource: GenerationSource =
    typeof args.generationSource === 'string' && VALID_GENERATION_SOURCES.has(args.generationSource as GenerationSource)
      ? (args.generationSource as GenerationSource)
      : 'llm_generated';

  const requestMethod = typeof args.requestMethod === 'string' ? args.requestMethod : null;
  const requestPath = typeof args.requestPath === 'string' ? args.requestPath : null;
  const requestQuery = (args.requestQuery && typeof args.requestQuery === 'object') ? args.requestQuery : null;
  const requestHeaders = (args.requestHeaders && typeof args.requestHeaders === 'object')
    ? normaliseHeaders(redactHeaders(args.requestHeaders as Record<string, string>))
    : null;
  const requestBody = args.requestBody !== undefined ? redactJson(args.requestBody) : null;
  const notes = typeof args.notes === 'string' ? args.notes : null;

  const created = await ctx.archModelClient.createScenario(ctx.session.projectId, {
    session_id: ctx.session.id,
    operation_id: persisted.id,
    scenario_name: scenarioName,
    scenario_type: scenarioType,
    status: 'draft',
    generation_source: generationSource,
    request_method: requestMethod,
    request_path: requestPath,
    request_query_json: requestQuery,
    request_headers_redacted_json: requestHeaders,
    request_body_json: requestBody,
    notes,
  });

  return {
    scenarioId: created.id,
    scenarioName,
    operationId: operationOasId,
    scenarioType,
    generationSource,
  };
};

export const recordScenarioCandidateTool: ToolRegistryEntry = {
  name: 'record_scenario_candidate',
  description:
    'Persist a candidate scenario in AMS for the current session. Headers + body are redacted before write. Returns the new scenario id.',
  parameters: {
    type: 'object',
    properties: {
      operationId: { type: 'string', description: 'OAS operationId this scenario targets.' },
      scenarioName: { type: 'string', description: 'Short human-readable scenario label.' },
      scenarioType: { type: 'string', description: 'One of happy_path, not_found, validation_error, empty_result, boundary_value, auth_error, business_edge_case, generated_candidate.' },
      generationSource: { type: 'string', description: 'One of oas_example, db_sample, llm_generated, llm_refined, user_edited.' },
      requestMethod: { type: 'string', description: 'Optional HTTP verb.' },
      requestPath: { type: 'string', description: 'Optional URL path.' },
      requestQuery: { type: 'object', description: 'Optional query bag.' },
      requestHeaders: { type: 'object', description: 'Optional headers (auto-redacted).' },
      requestBody: { description: 'Optional JSON body (auto-redacted).' },
      notes: { type: 'string', description: 'Optional free-text notes.' },
    },
    required: ['operationId', 'scenarioName'],
    additionalProperties: false,
  },
  handler,
};
