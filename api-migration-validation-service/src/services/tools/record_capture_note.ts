import { ToolHandler, ToolRegistryEntry, ToolValidationError } from './toolTypes';
import { redactJson } from '../redactor';
import type { DiagnosticType } from '../../types/captureSession';
import { createTracer } from '../../trace';

// Haikai workflow trace logger (OFF by default; no-op unless HAIKAI_TRACE is
// set). See docs/trace-logging.md.
const trace = createTracer('capture-svc');

/**
 * Tool: `record_capture_note`
 *
 * Writes a diagnostic / commentary row into `api_behaviour_diagnostics`
 * via `archModelClient.createDiagnostic`. This is also the LLM's
 * "I am done with this scenario" signal -- the loop runner treats this
 * tool as TERMINAL and exits the per-scenario loop after the result is
 * fed back.
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 5.
 */

const VALID_DIAGNOSTIC_TYPES: ReadonlySet<DiagnosticType> = new Set<DiagnosticType>([
  'failed_request',
  'auth_failure',
  'db_sample_failure',
  'llm_generation_failure',
  'redaction_warning',
  'endpoint_skipped',
  'retry_exhausted',
]);

const handler: ToolHandler = async (args, ctx) => {
  const message = typeof args.message === 'string' ? args.message : null;
  if (!message) {
    throw new ToolValidationError(
      'record_capture_note',
      'missing_message',
      '`message` is required.',
    );
  }
  const diagnosticType: DiagnosticType =
    typeof args.diagnosticType === 'string' && VALID_DIAGNOSTIC_TYPES.has(args.diagnosticType as DiagnosticType)
      ? (args.diagnosticType as DiagnosticType)
      : 'endpoint_skipped';
  const detail = args.detail !== undefined ? redactJson(args.detail) : null;

  // Operation FK -- if the LLM passed an OAS operationId, resolve to the AMS
  // row id; otherwise leave null (note can be session-scoped only).
  let operationRowId: string | null = null;
  if (typeof args.operationId === 'string') {
    const persisted = ctx.operationsByOasId.get(args.operationId);
    if (persisted) {
      operationRowId = persisted.id;
    }
  }
  // Scenario FK -- prefer the runner-set current scenario id, fall back to
  // an explicit scenarioId argument if the LLM happens to pass one.
  let scenarioRowId: string | null = ctx.currentScenarioId;
  if (!scenarioRowId && typeof args.scenarioId === 'string') {
    scenarioRowId = args.scenarioId;
  }

  const created = await ctx.archModelClient.createDiagnostic(ctx.session.projectId, {
    session_id: ctx.session.id,
    operation_id: operationRowId,
    scenario_id: scenarioRowId,
    diagnostic_type: diagnosticType,
    message,
    detail_json: detail,
  });

  // DETAIL: the terminal note the LLM used to close the scenario, tagged with
  // the diagnostic type so a "completed-but-no-capture" close is auditable.
  trace.detail(
    'capture.note',
    { diagnosticType },
    {
      project: ctx.session.projectId,
      arch: ctx.session.architectureId,
      session: ctx.session.id,
    },
  );

  return {
    diagnosticId: created.id,
    diagnosticType,
    message,
  };
};

/**
 * Marked `terminal: true` so the loop runner exits the per-scenario loop
 * after this tool's result is fed back to the LLM. The LLM's prompt
 * instructs it to call `record_capture_note` once it is satisfied that the
 * scenario is complete (or determines it cannot be completed).
 */
export const recordCaptureNoteTool: ToolRegistryEntry = {
  name: 'record_capture_note',
  description:
    'Persist a diagnostic / closing note for the current scenario in AMS. Calling this tool ENDS the scenario loop; call it once you are satisfied the scenario is captured (or skipped).',
  parameters: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Free-text note describing the scenario outcome.' },
      diagnosticType: { type: 'string', description: 'One of failed_request, auth_failure, db_sample_failure, llm_generation_failure, redaction_warning, endpoint_skipped, retry_exhausted. Defaults to endpoint_skipped.' },
      detail: { description: 'Optional JSON detail bag (auto-redacted).' },
      operationId: { type: 'string', description: 'Optional OAS operationId for FK linkage.' },
      scenarioId: { type: 'string', description: 'Optional scenario id (defaults to the runner-set current scenario).' },
    },
    required: ['message'],
    additionalProperties: false,
  },
  handler,
  terminal: true,
};
