/**
 * Tool registry shared types. Every LLM tool function exposed to the capture
 * loop conforms to the `ToolHandler` shape: takes a strongly-typed `args`
 * object and a `ToolExecutionContext` (per-session live handles), returns a
 * JSON-serialisable result that has been passed through the redactor before
 * the loop runner sends it back to the LLM.
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 5.
 */

import type { ParsedOasInventory } from '../../types/oas';
import type { SecretsBundle } from '../../types/secrets';
import type { CaptureSession } from '../../types/captureSession';
import type {
  CaptureDto,
  CreateCaptureRequest,
  CreateDiagnosticRequest,
  CreateScenarioRequest,
  DiagnosticDto,
  OperationDto,
  ScenarioDto,
} from '../archModelClient';
import type { DbAdapter } from '../db/DbAdapter';
import type { SessionHttpExecutor } from '../httpExecutor';
import type { DiscoveryServiceClient } from '../discoveryServiceClient';

/**
 * Narrowed AMS write surface exposed to tools. Wider methods on
 * `archModelClient` are not allowed at the tool boundary -- tools may only
 * write scenarios / diagnostics / captures (NEVER touch sessions or
 * baselines).
 */
export interface ArchModelToolWriteSurface {
  createScenario: (projectId: string, body: CreateScenarioRequest) => Promise<ScenarioDto>;
  createDiagnostic: (projectId: string, body: CreateDiagnosticRequest) => Promise<DiagnosticDto>;
  createCapture: (projectId: string, body: CreateCaptureRequest) => Promise<CaptureDto>;
}

/**
 * Per-session execution handles passed into every tool. Live for the
 * duration of a single capture-session run. Tools MUST NOT cache anything
 * across sessions.
 *
 * `currentScenarioId` is set by the loop runner when a scenario starts so
 * that AMS-write tools (`record_scenario_candidate`, `record_capture_note`)
 * can attach the right FK without the LLM having to thread the id through
 * every argument bag.
 */
export interface ToolExecutionContext {
  session: CaptureSession;
  /** Inventory parsed once at the start of the session. */
  oasInventory: ParsedOasInventory;
  /**
   * Operations that landed in `api_behaviour_operations` for this session,
   * keyed by `operation_id` (the OAS operationId, NOT the AMS row id).
   * Tools that gate on `included` / `safe_to_execute` consult this map.
   */
  operationsByOasId: Map<string, OperationDto>;
  /** In-memory plaintext secrets -- consumed by execute_http_request only. */
  secrets: SecretsBundle;
  /** Per-session HTTP executor with auth interceptor + redaction wired in. */
  httpExecutor: SessionHttpExecutor | null;
  /** Per-session DB adapter -- null when DB sampling is not configured. */
  dbAdapter: DbAdapter | null;
  /** AMS write surface (narrowed to the writes a tool may issue). */
  archModelClient: ArchModelToolWriteSurface;
  /**
   * The AMS row id for the scenario currently being explored. Set by the
   * loop runner via `setCurrentScenarioId` when a scenario starts; cleared
   * between scenarios.
   */
  currentScenarioId: string | null;
  /**
   * @deprecated Source of truth for HTTP attempt count is
   * `runManager.scenarioHttpAttempts`, incremented at the top of
   * `execute_http_request`. The field is retained on the context for
   * backwards compatibility with existing test mocks but is no longer
   * read by any tool handler. Spec: 2026-05-16 API Behaviour Capture Fixes
   * (Task Group 2 sub-task 2.8).
   */
  retryCount?: number;
  /**
   * Discovery-service client. Optional so existing tools and tests do not
   * need to provide it; the Workstream B `get_operation_payload_context`
   * tool uses this to fetch repo-relative JAXB DTO source files from the
   * run's cached clone. When absent (e.g. unit tests for sibling tools),
   * the payload-context tool falls back to the singleton import.
   *
   * Spec: 2026-05-17 SOAP LLM Extraction and Payload Enrichment (Phase 2)
   * -- Task Group 8.
   */
  discoveryServiceClient?: DiscoveryServiceClient;
  /**
   * Optional discovery run id whose cached clone holds the source files
   * for this capture session's interface. Set when the wizard's Step 1 /
   * Step 4 wiring binds the capture session to a specific discovery run.
   * When absent, the payload-context tool returns WSDL-only output and
   * adds a structured note explaining why DTO source could not be fetched.
   *
   * Spec: 2026-05-17 SOAP LLM Extraction and Payload Enrichment (Phase 2)
   * -- Task Group 8 (W-17 graceful fallback).
   */
  discoveryRunId?: string | null;
  /**
   * TRUE when the orchestrator wraps mutating scenarios in compensation
   * brackets (Capture-State Discipline Spec 3). Tools use this to keep
   * cross-scenario knowledge honest: identifiers harvested from a MUTATING
   * response reference state the bracket will undo, so they are not recorded
   * as learned facts. Optional so existing tests/contexts are unaffected.
   */
  compensationActive?: boolean;
}

/**
 * The handler signature every tool exports. The `args` are already
 * JSON-parsed from the LLM's `tool_call.function.arguments` string.
 *
 * The handler returns a plain JSON-serialisable value. The loop runner is
 * responsible for stringifying it (via JSON.stringify) AFTER passing it
 * through the redactor.
 */
export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
) => Promise<unknown>;

export interface ToolRegistryEntry {
  name: string;
  description: string;
  /** OpenAI tool-definition shape used by `gatewayClient.callLlmToolLoop`. */
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
  handler: ToolHandler;
  /**
   * Marker tool names that signal the loop runner to terminate the
   * scenario gracefully after this tool's result is fed back to the LLM.
   */
  terminal?: boolean;
  /**
   * Read-only RESEARCH tool (contract/OAS reads, DB metadata + sampling,
   * read-only SQL, source search/read): a round whose tool calls are ALL
   * research is FREE against the scenario round cap, mirroring the
   * fired-attempt budget's "research is free" rule (2026-08-26 — once DB
   * metadata started working, per-scenario research legitimately grew and
   * the flat cap abandoned 59 scenarios as retry_exhausted). The wall-clock
   * cap and the research-round safety ceiling still bound free rounds.
   */
  research?: boolean;
}

/**
 * A standardised error shape tools throw when an argument fails validation
 * or a guarded operation is rejected (e.g. mutating verb without
 * confirmation). The loop runner catches these and feeds the error back to
 * the LLM as a tool result rather than aborting the scenario.
 */
export class ToolValidationError extends Error {
  public readonly toolName: string;
  public readonly reason: string;

  constructor(toolName: string, reason: string, message: string) {
    super(message);
    this.name = 'ToolValidationError';
    this.toolName = toolName;
    this.reason = reason;
  }
}
