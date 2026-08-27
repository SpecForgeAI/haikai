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
  // 2026-08-26: captured-as-200-with-business-error-code — a SUCCESSFUL
  // negative capture; `endpoint_skipped` on these mislabelled 108 rows.
  'captured_as_business_error',
  // State-discipline taxonomy (2026-08-27): the LLM finally has a plain
  // success value plus honest non-failure labels. (`state_healed` and
  // `s0_restore_recorded` are orchestrator-emitted receipts — deliberately
  // NOT offered to the LLM.)
  'captured_ok',
  'contract_gap',
  'manual_rec_required',
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

  if (ctx.findingsTally) {
    ctx.findingsTally[diagnosticType] = (ctx.findingsTally[diagnosticType] ?? 0) + 1;
  }

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
      diagnosticType: { type: 'string', description: 'One of captured_ok, captured_as_business_error, contract_gap, manual_rec_required, failed_request, auth_failure, db_sample_failure, llm_generation_failure, redaction_warning, endpoint_skipped, retry_exhausted. Pick honestly: captured_ok = the scenario was captured cleanly (plain success); captured_as_business_error = captured, but the API answered with the legacy 200-plus-business-error-code idiom (a successful negative capture); contract_gap = the endpoint STRUCTURALLY cannot produce the intended scenario (put reason in detail: no_negative_available or format_variant_impossible) — a contract fact, not a failure; manual_rec_required = this scenario cannot be auto-captured (e.g. it needs a second human identity that is not loaded) — a standing human todo; endpoint_skipped ONLY when you did not capture the scenario at all. Defaults to endpoint_skipped.' },
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
