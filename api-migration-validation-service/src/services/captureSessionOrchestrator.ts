import { archModelClient as defaultArchModelClient } from './archModelClient';
import type {
  MigrationDiscoveryContextDto,
  OperationDto,
  ScenarioSeedSetDto,
  ScenarioSeedDto,
} from './archModelClient';
import { gatewayClient as defaultGatewayClient } from './gatewayClient';
import { runManager } from './runManager';
import { secretsStore } from './secretsStore';
import { createSessionHttpExecutor } from './httpExecutor';
import type { SessionHttpExecutor } from './httpExecutor';
import { BAD_TOKEN_VALUE } from './authOverride';
import { createDbAdapter } from './db/dbAdapterFactory';
import { runScenarioLoop } from './captureLoopRunner';
import { ALL_TOOLS } from './tools';
import type { ToolExecutionContext, ArchModelToolWriteSurface } from './tools';
import { discoveryServiceClient as defaultDiscoveryServiceClient } from './discoveryServiceClient';
import type { DiscoveryServiceClient } from './discoveryServiceClient';
import type { CaptureSession, ScenarioType } from '../types/captureSession';
import type { ParsedOasInventory } from '../types/oas';
import type { ApiAuthSecret } from '../types/secrets';
import type { ChatMessage } from '../types/llm';
import {
  assembleSequenceJson,
  deriveSequenceVolatilePaths,
  type SequenceJson,
} from './sequenceAssembly';
import { createTracer } from '../trace';
// Mode 1(b) Postman + LLM delta (Spec 2026-06-23 Import a Postman Collection
// into Capture, R6). The two-stage bounded subtraction (code pre-filter +
// LLM judge) lives in NET-NEW helpers; this loop only wires the per-op seam.
import { computePostmanDelta } from './postmanDelta';
import type { PostmanCapturedRequest } from './postmanDeltaStage1';
import type { JudgeFn } from './postmanDeltaStage2';

// Haikai workflow trace logger (OFF by default; no-op unless HAIKAI_TRACE is
// set). See docs/trace-logging.md. The corr bag always carries project + arch
// (the workflow-spanning grouping key) and session (the capture sub-thread).
const trace = createTracer('capture-svc');

/**
 * Top-level capture-session driver. Orchestrates the per-session lifecycle:
 *
 *   1. Confirm secrets are present in `secretsStore` (re-entry path lives
 *      in the action endpoint, not here).
 *   2. Build per-session live handles: HTTP executor, DB adapter, AMS
 *      operation map.
 *   3. For each operation marked `included`, generate a baseline scenario
 *      set (the v1 starting set is one `happy_path` per operation; the
 *      LLM tool calls expand it via `record_scenario_candidate`).
 *   4. Drive `runScenarioLoop` per scenario.
 *   5. Mark session `completed` (or `failed` on infrastructure-level
 *      failure) in AMS; purge secrets.
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 5.
 * Spec: 2026-05-16 API Behaviour Capture Fixes -- removes the hardcoded
 * `retryCount: 0` in the per-scenario context (Decision D4); HTTP attempt
 * count is now driven by `runManager.scenarioHttpAttempts`.
 * Spec: 2026-05-16 Migration Discovery Context Integration -- Task Group 3
 * adds optional `discoveryContext` to be injected once per session into the
 * scenario prompt builder (D3 / shaping note "once-per-session injection").
 * Spec: 2026-05-17 SOAP LLM Extraction and Payload Enrichment (Phase 2)
 * -- Task Group 9 wires `discoveryRunId` + `discoveryServiceClient` into
 * every per-scenario `ToolExecutionContext` so the new
 * `get_operation_payload_context` tool can fetch repo-relative JAXB DTO
 * source from the discovery-service source endpoint without each tool
 * re-importing the singleton client. When the capture session has no
 * linked discovery run, both fields are left null/undefined and the tool
 * falls back to WSDL-only output (W-17 graceful fallback).
 * Spec: 2026-06-16 Reconcile-Time Determinism & Volatile-Value Handling --
 * misleading-COMPLETED follow-up: a scenario is only credited to
 * `scenarios_completed` ("captured") when it produced a usable oracle.
 * Spec: 2026-06-17 Intent-Driven Canonical Capture -- the captured/errored
 * decision is now intent-driven: AFTER the per-scenario loop exits, the
 * orchestrator selects the ONE canonical capture matching the scenario's
 * intended outcome (`scenario.expectedStatus`) from the ordered
 * `runManager.getScenarioCaptures(session.id)` list, leaves it pending human
 * accept, and reject-and-hides every OTHER capture (the LLM's intermediate
 * fumbles -- e.g. a malformed-date 400 it later corrected to a 200) with
 * `accepted:false` + a system reason marker on `reviewer_notes`. A scenario
 * counts as CAPTURED iff a canonical was found; otherwise it errored (only
 * fumbles / a 500 came back) and ALL its captures are rejected as
 * non-canonical. INTENTIONAL negatives (404 / 4xx) survive because they are
 * their OWN scenarios carrying that `expectedStatus`. Reject-and-hide (NOT
 * hard delete): there is no AMS capture-delete endpoint and deleting oracle
 * data is unsafe. So an all-fumbled run can never read "N of N captured".
 *
 * Action-endpoint plumbing (`POST /capture-sessions/:id/start` etc.) lives
 * in Task Group 6; this orchestrator is the call target the action endpoint
 * spawns as a fire-and-forget background task.
 */

export interface OrchestratorDeps {
  archModelClient?: typeof defaultArchModelClient;
  gatewayClient?: typeof defaultGatewayClient;
  /**
   * In-memory parsed OAS inventory for the session. Built by the parse-oas
   * action endpoint (Group 6) and handed in here. The orchestrator does
   * NOT re-read OAS files.
   */
  oasInventory: ParsedOasInventory;
  /**
   * Operations already persisted via `archModelClient.createOperation`.
   * The orchestrator indexes these by operationId for tool lookups.
   */
  persistedOperations: ReadonlyArray<OperationDto>;
  /**
   * Optional migration discovery context fetched once at `/start` (before
   * the orchestrator was spawned). When present, `buildScenarioPrompt` will
   * append a bounded per-operation slice of relevant findings, runtime
   * evidence, DB sample hints, unresolved decision tasks, etc. to each
   * scenario prompt. When absent (fail-soft on /start, or
   * `includeDiscoveryContext=false`), the orchestrator continues exactly as
   * before -- the discovery-context block is simply omitted from prompts.
   *
   * Spec: 2026-05-16 Migration Discovery Context Integration -- Task Group 3.
   */
  discoveryContext?: MigrationDiscoveryContextDto;
  /**
   * Discovery run id whose cached clone holds the source files for this
   * capture session's interface. Set by the `/start` route when the
   * caller passes `discoveryRunIds` in the body; passed through to every
   * per-scenario `ToolExecutionContext` so the
   * `get_operation_payload_context` tool can fetch DTO source from the
   * discovery-service source endpoint. When absent, the payload-context
   * tool returns WSDL-only output and adds a structured note explaining
   * why DTO source could not be fetched.
   *
   * Spec: 2026-05-17 SOAP LLM Extraction and Payload Enrichment (Phase 2)
   * -- Task Group 9.
   */
  discoveryRunId?: string | null;
  /**
   * Test-only override for the discovery-service client. Production
   * callers leave this undefined; the orchestrator falls back to the
   * singleton import from `discoveryServiceClient.ts`.
   *
   * Spec: 2026-05-17 SOAP LLM Extraction and Payload Enrichment (Phase 2)
   * -- Task Group 9.
   */
  discoveryServiceClient?: DiscoveryServiceClient;
  /**
   * Mode 1(c) Postman-only run (Spec 2026-06-23, R4c / D3). When true the
   * per-operation loop is SKIPPED entirely -- no planner, no
   * `execute_http_request`. The imported Postman items were already fired as
   * concrete `manual-capture` sends before `/start`, so there is nothing to
   * generate. Defaults to false (today's behaviour unchanged).
   */
  postmanOnly?: boolean;
  /**
   * Mode 1(b) Postman + LLM delta (Spec 2026-06-23, R6 / D3). The captured
   * Postman requests per operation, keyed by `OperationDto.operation_id`. When
   * present for an operation, the per-op loop computes the two-stage bounded
   * subtraction (Stage-1 code pre-filter + Stage-2 LLM judge) and only the
   * survivors top up via `execute_http_request`, capped at
   * `MAX_SCENARIOS_PER_OP` INCLUDING the captured Postman scenarios. Absent /
   * empty -> the operation generates its full candidate set (today's behaviour).
   */
  postmanCapturedByOp?: Record<string, ReadonlyArray<PostmanCapturedRequest>>;
  /**
   * Mode 1(b) Stage-2 redundancy oracle. Injected so the orchestrator owns the
   * gateway wiring and tests inject a deterministic stub. Only invoked for an
   * operation that has captured Postman requests; absent -> the delta degrades
   * to Stage-1-only subtraction (every Stage-1 survivor tops up).
   */
  judgeRedundantScenarios?: JudgeFn;
}

export interface OrchestratorOutcome {
  sessionId: string;
  scenariosAttempted: number;
  scenariosCompleted: number;
  scenariosErrored: number;
  finalStatus: 'completed' | 'failed';
  errorMessage: string | null;
}

/**
 * Maximum number of finding highlights to surface in a single scenario
 * prompt. Bounded summaries only -- per the spec we must never dump 100
 * findings; we pick the top-relevant slice per operation.
 */
const MAX_FINDINGS_IN_PROMPT = 8;
const MAX_RUNTIME_EVIDENCE_IN_PROMPT = 5;
const MAX_DECISION_TASKS_IN_PROMPT = 5;
const MAX_HIGHLIGHTS_WHEN_NO_OPERATION_MATCH = 10;

/**
 * Heuristic test: does this finding/evidence/decision-task reference the
 * given operation? The aggregation DTO does not yet carry per-operation
 * link tables; we rely on the human-readable `title`, `summary`, `source`,
 * and `filePath` strings to spot a match.
 *
 * We accept any of:
 *   - Exact path token match (e.g. `/pets/{id}` or `/pets`)
 *   - HTTP-method-and-path substring match (e.g. `GET /pets`)
 *   - The OAS operationId appearing in the text
 *
 * Returns false if no useful match is found. The session-wide fallback
 * in `buildScenarioPrompt` ensures the LLM still sees a small slice of
 * cross-cutting context when no per-operation match lands.
 */
function findingMatchesOperation(
  text: string | null | undefined,
  method: string,
  path: string,
  operationOasId: string,
): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  const lowerPath = path.toLowerCase();
  const methodToken = `${method.toLowerCase()} ${lowerPath}`;
  if (lower.includes(methodToken)) return true;
  if (lower.includes(lowerPath)) return true;
  // Strip path templating like `{id}` to a permissive match.
  const stripped = lowerPath.replace(/\{[^}]+\}/g, '');
  if (stripped.length > 1 && lower.includes(stripped)) return true;
  if (operationOasId && lower.includes(operationOasId.toLowerCase())) return true;
  return false;
}

interface ScenarioContextBlock {
  highPriorityFindings: Array<{
    findingId: string;
    findingType: string;
    category: string;
    severity: string;
    status: string;
    title: string;
    summary?: string | null;
    source?: string | null;
  }>;
  evidenceHighlights: Array<{
    evidenceId: string;
    type: string;
    source?: string | null;
    filePath?: string | null;
  }>;
  unresolvedDecisionTasks: Array<{
    taskId: string;
    taskType: string;
    status: string;
  }>;
  databaseDiscoverySummary?: {
    sampleDataHintCount?: number;
    databaseFindingCount?: number;
    hasDatabaseDiscovery?: boolean;
  } | null;
  runtimeUsageSummary?: {
    runtimeEvidenceCount?: number;
    runtimeFindingCount?: number;
    hasRuntimeEvidence?: boolean;
  } | null;
  readinessGaps?: string[];
  contextWarnings?: string[];
  hadPerOperationMatches: boolean;
}

/**
 * Build the per-scenario discovery slice. Filters the aggregated context to
 * just what's relevant for THIS operation. Falls back to a small "session-
 * wide highlights" set if nothing matches by path/operationId.
 */
function buildScenarioContextBlock(
  discoveryContext: MigrationDiscoveryContextDto,
  method: string,
  path: string,
  operationOasId: string,
): ScenarioContextBlock {
  const findings = discoveryContext.highPriorityFindings ?? [];
  const evidence = discoveryContext.evidenceHighlights ?? [];
  const decisionTasks = discoveryContext.unresolvedDecisionTasks ?? [];

  // Per-operation match (by path / operationId / method-and-path).
  const matchedFindings = findings.filter((f) =>
    findingMatchesOperation(f.title, method, path, operationOasId) ||
    findingMatchesOperation(f.summary, method, path, operationOasId) ||
    findingMatchesOperation(f.source, method, path, operationOasId),
  );

  const matchedEvidence = evidence.filter((e) =>
    findingMatchesOperation(e.filePath, method, path, operationOasId) ||
    findingMatchesOperation(e.source, method, path, operationOasId),
  );

  // Decision tasks: we don't have title/summary on the DTO, so we surface a
  // bounded slice of unresolved ones unchanged. The prompt guard tells the
  // LLM these are session-wide, not necessarily endpoint-specific.
  const sessionDecisionTasks = decisionTasks.slice(0, MAX_DECISION_TASKS_IN_PROMPT);

  const hadPerOperationMatches = matchedFindings.length > 0 || matchedEvidence.length > 0;

  const findingsToEmit = hadPerOperationMatches
    ? matchedFindings.slice(0, MAX_FINDINGS_IN_PROMPT)
    : findings.slice(0, MAX_HIGHLIGHTS_WHEN_NO_OPERATION_MATCH);

  const evidenceToEmit = hadPerOperationMatches
    ? matchedEvidence.slice(0, MAX_RUNTIME_EVIDENCE_IN_PROMPT)
    : evidence.slice(0, MAX_RUNTIME_EVIDENCE_IN_PROMPT);

  return {
    highPriorityFindings: findingsToEmit.map((f) => ({
      findingId: f.findingId,
      findingType: f.findingType,
      category: f.category,
      severity: f.severity,
      status: f.status,
      title: f.title,
      summary: f.summary ?? null,
      source: f.source ?? null,
    })),
    evidenceHighlights: evidenceToEmit.map((e) => ({
      evidenceId: e.evidenceId,
      type: e.type,
      source: e.source ?? null,
      filePath: e.filePath ?? null,
    })),
    unresolvedDecisionTasks: sessionDecisionTasks.map((t) => ({
      taskId: t.taskId,
      taskType: t.taskType,
      status: t.status,
    })),
    databaseDiscoverySummary: discoveryContext.databaseDiscoverySummary ?? null,
    runtimeUsageSummary: discoveryContext.runtimeUsageSummary ?? null,
    readinessGaps: discoveryContext.readinessAssessment?.gaps ?? undefined,
    contextWarnings: discoveryContext.contextWarnings ?? undefined,
    hadPerOperationMatches,
  };
}

/**
 * Build the per-scenario system + user prompt. Kept compact -- the LLM
 * receives the operation detail via tools, NOT verbatim in the prompt.
 *
 * When `discoveryContext` is provided (fetched once at /start, attached to
 * the orchestrator via `OrchestratorDeps.discoveryContext`), this function
 * appends a "Discovery Context (supporting evidence)" block to the user
 * message containing the operation-relevant slice. The block carries the
 * explicit prompt guard from the raw idea: discovery findings are
 * supporting evidence, do not invent behaviour beyond OAS/API response
 * evidence.
 *
 * Exported for unit-test access (no production caller imports it).
 */
export function buildScenarioPrompt(
  session: CaptureSession,
  operationOasId: string,
  scenarioName: string,
  method?: string,
  path?: string,
  discoveryContext?: MigrationDiscoveryContextDto,
  scenarioSeed?: ScenarioSeedDto,
  knownGoodFacts?: string[],
  scenarioDirective?: string,
  // Capture data-type format defaults (2026-06-20): operator-confirmed
  // per-data-type default formats, threaded from session.dataTypeDefaultsJson.
  // null/undefined whole-map and null per-category values are tolerated here;
  // the block below omits null categories and skips entirely when empty.
  dataTypeDefaults?: Record<string, string | null> | null,
): ChatMessage[] {
  const userPayload: Record<string, unknown> = {
    sessionId: session.id,
    envName: session.envName,
    apiBaseUrl: session.apiBaseUrl,
    operationId: operationOasId,
    scenarioName,
    instructions:
      'Follow this MANDATORY order for the scenario: ' +
      '(1) call get_oas_operation_detail for THIS operation FIRST and read its parameter ' +
      'types/formats/patterns/enums and request schema BEFORE building any request (do not guess shapes); ' +
      '(2) for every id, code, foreign-key or reference value a parameter needs, get a REAL value from the ' +
      'database first (list_db_metadata to find the table, then sample_db_values / run_readonly_sql) -- ' +
      'do NOT invent ids (no 1/0/100) when a database is configured; ' +
      '(3) build the request using the contract formats (e.g. the exact date pattern) and the real values; ' +
      'the path template may have MULTIPLE segments (e.g. /x/{a}/{b}) -- read EVERY path parameter from ' +
      'get_oas_operation_detail and fill EACH segment with a correctly-typed value (from the contract format / ' +
      'database); never collapse a multi-segment path into a single id; ' +
      '(4) call execute_http_request to capture; ' +
      '(5) if the response is non-2xx or an error, READ response.errorSummary / response.body, identify the ' +
      'rejected field, and issue ONE corrected request (limited attempts -- never repeat an identical request); ' +
      '(6) call record_capture_note to finish. ' +
      'Only guess a value when no database is configured AND the contract gives no example or pattern.',
  };

  // Seeded scenario inputs computed from the discovery model. Attached
  // regardless of whether the broader discovery-context block is added so a
  // per-operation seed always reaches the planner. The guidance string makes
  // explicit that seeds are a STARTING point to be refined against live
  // evidence, never trusted blindly.
  if (scenarioSeed) {
    userPayload.scenarioSeed = {
      ...scenarioSeed,
      guidance:
        'These are SEEDED inputs computed from the discovery model. Use them as ' +
        'the starting request; REFINE them against the live OAS/response evidence; ' +
        'do NOT discard them to invent blind. Record a note via record_capture_note ' +
        'if a seeded input is contradicted by evidence.',
    };
  }

  if (discoveryContext && method && path) {
    const block = buildScenarioContextBlock(
      discoveryContext,
      method,
      path,
      operationOasId,
    );
    userPayload.discoveryContext = {
      guidance:
        'Discovery findings and DB sample hints are AUTHORITATIVE signals for input formats and ' +
        'conventions (date formats, id shapes, enum values, required headers) -- use them to construct ' +
        'realistic requests, and prefer a discovered concrete value/format over a guess. Verify against the ' +
        'live OAS/response evidence. Only when discovery genuinely CONTRADICTS the contract should you record ' +
        'a note via record_capture_note instead of proceeding -- do not default to guessing when a discovered ' +
        'value is available.',
      perOperationMatched: block.hadPerOperationMatches,
      highPriorityFindings: block.highPriorityFindings,
      evidenceHighlights: block.evidenceHighlights,
      unresolvedDecisionTasks: block.unresolvedDecisionTasks,
      databaseDiscoverySummary: block.databaseDiscoverySummary,
      runtimeUsageSummary: block.runtimeUsageSummary,
      readinessGaps: block.readinessGaps,
      contextWarnings: block.contextWarnings,
    };
    // Diag boundary -- emit AFTER the prompt block is built so we have the
    // accurate filtered_findings count. Counts only, never titles.
    const filteredFindings = Array.isArray(block.highPriorityFindings)
      ? block.highPriorityFindings.length
      : 0;
    console.log(
      `[diag-amvs] op=build_prompt scenario=${(scenarioName || 'unknown').slice(0, 32)} ` +
        `context_present=true filtered_findings=${filteredFindings}`,
    );
  } else {
    console.log(
      `[diag-amvs] op=build_prompt scenario=${(scenarioName || 'unknown').slice(0, 32)} ` +
        `context_present=false filtered_findings=0`,
    );
  }

  if (scenarioDirective) {
    // The specific variation THIS scenario must exercise (enum value, negative
    // case, filter combo, ...) -- see defaultScenarioSet. The intent class is
    // enforced post-loop by Phase-2 canonical capture.
    userPayload.scenarioDirective = scenarioDirective;
  }

  if (knownGoodFacts && knownGoodFacts.length > 0) {
    // Cross-scenario learning, BOTH directions. Each fact is self-describing
    // via its prefix (`OK` / `OK id:` / `FAILED:`), so the guidance only has
    // to teach the LLM how to read them. (Payload key kept as `knownGood` for
    // wire/test stability even though it now carries known-bad facts too.)
    userPayload.knownGood = {
      guidance:
        'Facts learned earlier in THIS capture session. REUSE the values and formats from `OK` lines ' +
        '(date patterns, id conventions, working query/body shapes), and PREFER an id surfaced by a prior ' +
        'response -- an `OK id:` line -- over a fresh DB lookup or a guess when a later call needs that id. ' +
        'AVOID the inputs on `FAILED` lines: those were rejected by the API and must not be re-tried as-is.',
      examples: knownGoodFacts,
    };
  }

  // Operator-confirmed per-data-type default formats (Capture data-type format
  // defaults, 2026-06-20). A SEPARATE prompt block -- NOT an OAS override (the
  // enrichInventoryWithRequestContracts code>contract>runtime chain is
  // untouched). Categories whose value is null are an explicit "no default"
  // and are OMITTED so the LLM gets no nudge for that type; the block is
  // skipped entirely when no non-null defaults remain. The guidance REFINES
  // (does not contradict) the contract-first instruction above, expressing the
  // scan-time precedence code-evidence(field) > operator-default(type) >
  // contract(field) > LLM.
  if (dataTypeDefaults) {
    const formats: Record<string, string> = {};
    for (const [category, format] of Object.entries(dataTypeDefaults)) {
      // OMIT null (explicit "no default") and any non-string slot.
      if (typeof format === "string") {
        formats[category] = format;
      }
    }
    if (Object.keys(formats).length > 0) {
      userPayload.dataTypeDefaults = {
        guidance:
          "Per-data-type default formats confirmed by the operator. When a field has NO " +
          "code-evidence format, use the default for its data type and PREFER it over the " +
          "contract's declared format. A field's own code-evidence still wins; you may still " +
          "adapt from live response evidence; never retry a rejected format.",
        formats,
      };
    }
  }

  return [
    {
      role: 'system',
      content:
        'You are an API behaviour capture planner. You will draft scenarios, execute them via the registered tools, and record results. ' +
        'You must use `execute_http_request` for any HTTP call (never describe one in prose) and `run_readonly_sql` for any DB read. ' +
        'Do NOT call `execute_http_request` until you have (a) fetched `get_oas_operation_detail` for the operation and (b) resolved real input values from the database where one is configured. ' +
        'After any non-2xx or error response, READ the error before retrying and change the specific value/field the API rejected -- never repeat an identical request. ' +
        'When you are satisfied that the scenario is captured (or determine it cannot be), call `record_capture_note` to end the loop.',
    },
    {
      role: 'user',
      content: JSON.stringify(userPayload),
    },
  ];
}

/**
 * Build the operation seed key matching the AMS side: `"<METHOD> <path>"`
 * with the method upper-cased and both parts trimmed. Used to correlate a
 * persisted operation with its discovery-context seed set.
 */
export function operationSeedKey(method?: string, path?: string): string {
  return `${(method ?? '').trim().toUpperCase()} ${(path ?? '').trim()}`;
}

/**
 * Find the seed set for an operation in the discovery context (if any), by
 * matching `operationKey`.
 */
export function seedsForOperation(
  discoveryContext: MigrationDiscoveryContextDto | undefined,
  method?: string,
  path?: string,
): ScenarioSeedSetDto | undefined {
  if (!discoveryContext?.scenarioSeeds) return undefined;
  const key = operationSeedKey(method, path);
  return discoveryContext.scenarioSeeds.find((set) => set.operationKey === key);
}

/**
 * Default scenario set per operation. When the discovery context carries a
 * matching seed set with a non-empty `seeds` array, one scenario is emitted
 * per seed (names/types preserved). Otherwise we fall back to the single
 * behaviour-preserving `happy_path` scenario; the LLM is encouraged via
 * prompt to call `record_scenario_candidate` to register additional variants.
 *
 * Exported for unit testing.
 */
/**
 * The intended outcome class for a generated scenario. Phase-2 canonical-capture
 * keeps the capture matching this and drops the LLM's intermediate fumbles, so a
 * NEGATIVE scenario (its goal IS an error) survives while a corrected mistake on
 * a POSITIVE scenario does not.
 */
export type ScenarioExpectedStatus = 'success' | 'not_found' | 'client_error';

export interface GeneratedScenario {
  name: string;
  type: string;
  expectedStatus: ScenarioExpectedStatus;
  /** Plain-language variation the LLM must exercise (rendered into the prompt). */
  directive?: string;
}

/**
 * System marker written to a non-canonical capture's `reviewer_notes` when the
 * orchestrator reject-and-hides it (Phase-2 intent-driven canonical capture).
 * It is a BARE string (not the structured `{ text, masks }` reviewer-notes
 * JSON the review UI writes), so the frontend can distinguish a system fumble
 * from a human reject: a human reject either carries no marker or carries the
 * structured payload, while a system fumble's `reviewer_notes` equals this
 * exact literal. `accepted:false` alone is NOT sufficient -- a human can also
 * reject a capture -- so the marker is what the frontend filters on.
 *
 * Reason field chosen: AMS `PatchCaptureRequest` exposes only
 * `accepted` / `accepted_at` / `reviewer_notes` (NO `accepted_reason` /
 * `business_notes` on the capture PATCH surface), so the EXISTING
 * `reviewer_notes` field carries the marker -- no new AMS field invented.
 *
 * Spec: 2026-06-17 Intent-Driven Canonical Capture.
 */
export const NON_CANONICAL_REVIEWER_NOTE = 'superseded_non_canonical';

/**
 * Select the canonical capture for a scenario from the ordered per-scenario
 * capture list, by the scenario's intended `expectedStatus`:
 *
 *   - `success`      -> the LAST capture with a 2xx status;
 *   - `not_found`    -> the LAST capture with status 404, else the LAST 4xx;
 *   - `client_error` -> the LAST capture with a 4xx status.
 *
 * "Last" because the LLM's CORRECTED attempt comes after its fumble(s): a
 * positive scenario that first sent a malformed-date 400 then a fixed 200
 * keeps the 200; a negative `not_found` scenario whose first attempt was a
 * malformed-input 400 (a fumble building the request) then a clean 404 keeps
 * the 404. Returns `null` when no capture matches the intended class -- the
 * scenario then has no usable oracle (e.g. only a 500 came back) and the
 * orchestrator counts it errored and rejects every capture.
 *
 * Exported for unit testing.
 *
 * Spec: 2026-06-17 Intent-Driven Canonical Capture.
 */
export function selectCanonicalCapture(
  captures: ReadonlyArray<{ captureId: string; status: number | null }>,
  expectedStatus: ScenarioExpectedStatus,
): { captureId: string; status: number | null } | null {
  const is2xx = (s: number | null): boolean => s !== null && s >= 200 && s < 300;
  const is4xx = (s: number | null): boolean => s !== null && s >= 400 && s < 500;
  const is404 = (s: number | null): boolean => s === 404;

  // Walk from the end so the FIRST match is the LAST (most-recent / corrected)
  // capture, without mutating the caller's array.
  const lastMatching = (
    pred: (s: number | null) => boolean,
  ): { captureId: string; status: number | null } | null => {
    for (let i = captures.length - 1; i >= 0; i -= 1) {
      if (pred(captures[i].status)) return captures[i];
    }
    return null;
  };

  switch (expectedStatus) {
    case 'success':
      return lastMatching(is2xx);
    case 'not_found':
      return lastMatching(is404) ?? lastMatching(is4xx);
    case 'client_error':
      return lastMatching(is4xx);
    default:
      return null;
  }
}

// ===========================================================================
// Oracle Coverage Scoring (Spec: 2026-06-17 Oracle Coverage Scoring)
//
// SINGLE-SOURCE RUBRIC: the scorer consumes the EXACT `GeneratedScenario[]`
// that `defaultScenarioSet` emits (one dimension == one generated scenario) and
// reuses `selectCanonicalCapture` VERBATIM to decide "achieved", so generation
// and scoring can never drift. The scorer is PURE (inputs in, summary out --
// no I/O, no mutation of inputs); the orchestrator owns the accumulation across
// the per-scenario loop and the final assembly + persistence.
// ===========================================================================

/** One scored coverage dimension == one generated scenario. snake_case wire. */
export interface CoverageDimensionResult {
  name: string;
  type: string;
  expected_status: ScenarioExpectedStatus;
  achieved: boolean;
  /** The canonical capture id when achieved; null on a MISS. */
  canonical_capture_id: string | null;
  /** Honest human-readable reason on a MISS; null when achieved. */
  reason: string | null;
}

/** Per-endpoint coverage: the rubric dimensions + the achieved/total fraction. */
export interface EndpointCoverageResult {
  operation_id: string;
  method: string;
  path: string;
  /** achieved dimensions / total rubric dimensions for this operation. */
  score: number;
  dimensions: CoverageDimensionResult[];
}

/** One session-level auth-negative probe sub-result. */
export interface AuthProbeResult {
  /** `no_token` | `bad_token`. */
  name: string;
  /** Human-readable expectation (e.g. `401`, `401/403`). */
  expected: string;
  achieved: boolean;
  /** Observed HTTP status (null when no response / not run). */
  observed_status: number | null;
  /** Honest reason on a MISS / not-run; null when achieved. */
  reason: string | null;
}

/** The single project-level auth-coverage dimension (rolls up both probes). */
export interface AuthCoverageResult {
  /** Achieved only when BOTH probes returned their expected rejection. */
  achieved: boolean;
  /** The included endpoint the probes ran against; null when none qualified. */
  representative_operation_id: string | null;
  probes: AuthProbeResult[];
}

/** The whole persisted coverage summary (one AMS JSONB field, snake_case). */
export interface CoverageSummary {
  overall_score: number;
  dimensions_total: number;
  dimensions_achieved: number;
  per_endpoint: EndpointCoverageResult[];
  auth_coverage: AuthCoverageResult;
}

/**
 * The per-scenario outcome the scorer reads: the ordered capture list the loop
 * recorded for that scenario (a snapshot of `runManager.getScenarioCaptures`
 * taken BEFORE the next `beginScenario` reset). Keyed by scenario name so the
 * scorer can line each generated dimension up with its outcome.
 */
export type ScenarioOutcomesByName = ReadonlyMap<
  string,
  ReadonlyArray<{ captureId: string; status: number | null }>
>;

/**
 * Derive an honest, human-readable MISS reason for a dimension from its
 * per-scenario captures. Pure. Cases, in order:
 *   - no captures at all                  -> nothing was captured
 *   - only 5xx / no-response came back    -> system returned 5xx on all attempts
 *   - enum dimension, value unreachable   -> value not reachable
 *   - otherwise                           -> no capture matched the intended class
 */
function coverageMissReason(
  scenario: GeneratedScenario,
  captures: ReadonlyArray<{ captureId: string; status: number | null }>,
): string {
  if (captures.length === 0) {
    return `${scenario.name}: no capture was recorded (no HTTP attempt persisted a usable response)`;
  }
  const statuses = captures.map((c) => c.status);
  const allNullOrServerError = statuses.every(
    (st) => st === null || (st >= 500 && st < 600),
  );
  if (allNullOrServerError) {
    const seen = statuses.map((st) => (st === null ? 'transport_failure' : String(st)));
    return `${scenario.name}: system returned 5xx / no response on all attempts (saw ${seen.join(', ')})`;
  }
  // Enum dimensions name the exact unreachable value in their name/directive.
  if (scenario.type === 'enum') {
    return `${scenario.name}: no canonical capture — value not reachable`;
  }
  const seen = statuses.map((st) => (st === null ? 'transport_failure' : String(st)));
  return (
    `${scenario.name}: no capture matched the intended ${scenario.expectedStatus} class ` +
    `(saw ${seen.join(', ')})`
  );
}

/**
 * PURE coverage scorer (sibling to `selectCanonicalCapture`). Scores one
 * operation's rubric: every `GeneratedScenario` becomes exactly one dimension,
 * "achieved" iff `selectCanonicalCapture(captures, scenario.expectedStatus)`
 * returns a non-null capture for that scenario's recorded captures. Because the
 * dimension set IS the generated `scenarios` array, a dimension can never be
 * scored that was not generated, and every generated dimension is scored
 * (no drift). Inputs are not mutated; no I/O.
 *
 * `scenarios` MUST be the same array `defaultScenarioSet(op, ...)` produced for
 * this operation (the rubric). `outcomesByName` maps each scenario name to the
 * ordered captures the loop recorded for it.
 *
 * Exported for unit testing.
 */
export function scoreEndpointCoverage(
  op: Pick<OperationDto, 'operation_id' | 'method' | 'path'>,
  scenarios: ReadonlyArray<GeneratedScenario>,
  outcomesByName: ScenarioOutcomesByName,
): EndpointCoverageResult {
  const dimensions: CoverageDimensionResult[] = scenarios.map((scenario) => {
    const captures = outcomesByName.get(scenario.name) ?? [];
    const canonical = selectCanonicalCapture(captures, scenario.expectedStatus);
    if (canonical) {
      return {
        name: scenario.name,
        type: scenario.type,
        expected_status: scenario.expectedStatus,
        achieved: true,
        canonical_capture_id: canonical.captureId,
        reason: null,
      };
    }
    return {
      name: scenario.name,
      type: scenario.type,
      expected_status: scenario.expectedStatus,
      achieved: false,
      canonical_capture_id: null,
      reason: coverageMissReason(scenario, captures),
    };
  });

  const total = dimensions.length;
  const achieved = dimensions.filter((d) => d.achieved).length;
  return {
    operation_id: op.operation_id,
    method: op.method,
    path: op.path,
    // Score is display-only this iteration. An endpoint with no generated
    // dimensions (should not happen -- happy_path is always added) scores 0.
    score: total > 0 ? achieved / total : 0,
    dimensions,
  };
}

/**
 * Assemble the whole session coverage summary from the per-endpoint results and
 * the single project-level auth dimension. PURE. Overall score folds the auth
 * dimension into the denominator as +1:
 *
 *   overall = (sum of achieved per-endpoint dimensions + auth_achieved?1:0)
 *           / (sum of all per-endpoint dimensions + 1)
 *
 * `dimensions_total` / `dimensions_achieved` are persisted alongside the
 * fraction so a later reader (Spec C) does not recompute.
 *
 * Exported for unit testing.
 */
export function assembleCoverageSummary(
  perEndpoint: ReadonlyArray<EndpointCoverageResult>,
  authCoverage: AuthCoverageResult,
): CoverageSummary {
  const endpointTotal = perEndpoint.reduce((acc, e) => acc + e.dimensions.length, 0);
  const endpointAchieved = perEndpoint.reduce(
    (acc, e) => acc + e.dimensions.filter((d) => d.achieved).length,
    0,
  );
  // The auth dimension always contributes exactly 1 to the denominator.
  const dimensionsTotal = endpointTotal + 1;
  const dimensionsAchieved = endpointAchieved + (authCoverage.achieved ? 1 : 0);
  return {
    overall_score: dimensionsTotal > 0 ? dimensionsAchieved / dimensionsTotal : 0,
    dimensions_total: dimensionsTotal,
    dimensions_achieved: dimensionsAchieved,
    per_endpoint: [...perEndpoint],
    auth_coverage: authCoverage,
  };
}

/**
 * A candidate representative endpoint for the session-level auth-negative
 * probes: it is included, `safe_to_execute` (non-mutating under default
 * policy), achieved its happy_path (so the request shape is known-good), and
 * has NO templated path segments (so the probe can replay it WITHOUT inventing
 * a real id -- staying safe). The orchestrator builds this from the loop
 * accumulation; the probe runner picks the FIRST qualifying candidate.
 */
export interface AuthProbeCandidate {
  operationId: string;
  method: string;
  path: string;
}

/** A path with no `{...}` template segment is safe to replay with no auth. */
function pathHasNoTemplateSegments(path: string): boolean {
  return !/\{[^}]+\}/.test(path);
}

/**
 * Pick the representative endpoint for the auth probes from the qualifying
 * candidates. Pure -- returns the first candidate (deterministic, the loop
 * adds them in operation order) or null when none qualifies.
 *
 * Exported for unit testing.
 */
export function selectAuthProbeEndpoint(
  candidates: ReadonlyArray<AuthProbeCandidate>,
): AuthProbeCandidate | null {
  for (const c of candidates) {
    if (pathHasNoTemplateSegments(c.path)) return c;
  }
  return null;
}

/**
 * Run the SESSION-level auth-negative probes ONCE against the chosen
 * representative endpoint and roll them into the single project-level auth
 * dimension. Two probes:
 *   - no_token  -> send WITH NO auth (`{ type: 'none' }`), expect 401;
 *   - bad_token -> send a garbage bearer token, expect 401 or 403.
 *
 * Both use the executor's SCOPED `requestWithAuthOverride` seam, so neither can
 * leak the override onto a later call. The auth dimension is "achieved" only
 * when BOTH probes returned their expected rejection; otherwise MISSED with a
 * reason naming the failing probe and the observed status. When no safe
 * representative endpoint qualifies, the dimension is MISSED with an honest
 * reason and NO call is fired (respecting safe_to_execute / mutating gates).
 *
 * Defensive: a transport failure or unexpected throw on a probe is recorded as
 * that probe MISSING with an honest reason rather than aborting the run.
 */
async function runAuthNegativeProbes(
  executor: SessionHttpExecutor,
  candidates: ReadonlyArray<AuthProbeCandidate>,
): Promise<AuthCoverageResult> {
  const chosen = selectAuthProbeEndpoint(candidates);
  if (!chosen) {
    const reason =
      'no safe representative endpoint available for auth probes ' +
      '(need an included, safe_to_execute, happy-path-captured endpoint with no path parameters)';
    return {
      achieved: false,
      representative_operation_id: null,
      probes: [
        { name: 'no_token', expected: '401', achieved: false, observed_status: null, reason },
        { name: 'bad_token', expected: '401/403', achieved: false, observed_status: null, reason },
      ],
    };
  }

  const runProbe = async (
    name: 'no_token' | 'bad_token',
    expectedLabel: string,
    override: ApiAuthSecret,
    isExpectedRejection: (status: number) => boolean,
  ): Promise<AuthProbeResult> => {
    try {
      const resp = await executor.requestWithAuthOverride(
        { url: chosen.path, method: chosen.method.toLowerCase() },
        override,
      );
      const status = resp.status;
      if (isExpectedRejection(status)) {
        return { name, expected: expectedLabel, achieved: true, observed_status: status, reason: null };
      }
      return {
        name,
        expected: expectedLabel,
        achieved: false,
        observed_status: status,
        reason:
          `${name} probe expected ${expectedLabel} but the endpoint returned ${status} ` +
          `(auth was NOT enforced as expected)`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        name,
        expected: expectedLabel,
        achieved: false,
        observed_status: null,
        reason: `${name} probe produced no response (transport failure: ${message})`,
      };
    }
  };

  const noToken = await runProbe(
    'no_token',
    '401',
    { type: 'none' },
    (status) => status === 401,
  );
  const badToken = await runProbe(
    'bad_token',
    '401/403',
    { type: 'bearer', bearerToken: BAD_TOKEN_VALUE },
    (status) => status === 401 || status === 403,
  );

  const probes = [noToken, badToken];
  const achieved = probes.every((p) => p.achieved);
  return {
    achieved,
    representative_operation_id: chosen.operationId,
    probes,
  };
}

/** Coverage caps so a param-rich endpoint gets thorough -- but bounded -- coverage. */
const MAX_SCENARIOS_PER_OP = 12;
const MAX_ENUM_VALUES_PER_PARAM = 4;

/** Classify a discovery-seed scenario name into an expected-outcome class. */
function classifyExpectedFromName(name: string): ScenarioExpectedStatus {
  const n = (name ?? '').toLowerCase();
  if (n.includes('404') || n.includes('not_found') || n.includes('notfound')) return 'not_found';
  if (
    n.includes('400') || n.includes('bad') || n.includes('invalid') ||
    n.includes('auth') || n.includes('validation') || n.includes('error')
  ) {
    return 'client_error';
  }
  return 'success';
}

/** Defensively read an OAS operation's parameters (skips $ref params/schemas). */
function extractOasParams(
  oasOperation: unknown,
): Array<{ name: string; location: string; required: boolean; enumValues?: unknown[] }> {
  const raw = (oasOperation as { parameters?: unknown })?.parameters;
  if (!Array.isArray(raw)) return [];
  const out: Array<{ name: string; location: string; required: boolean; enumValues?: unknown[] }> = [];
  for (const p of raw) {
    if (!p || typeof p !== 'object' || '$ref' in (p as object)) continue;
    const param = p as { name?: unknown; in?: unknown; required?: boolean; schema?: unknown };
    if (typeof param.name !== 'string' || typeof param.in !== 'string') continue;
    const schema =
      param.schema && typeof param.schema === 'object' && !('$ref' in (param.schema as object))
        ? (param.schema as { enum?: unknown[] })
        : undefined;
    out.push({
      name: param.name,
      location: param.in,
      required: param.required ?? param.in === 'path',
      enumValues: Array.isArray(schema?.enum) && schema!.enum!.length > 0 ? schema!.enum : undefined,
    });
  }
  return out;
}

/**
 * Build the scenario set for one operation. Scales coverage to the operation's
 * parameter space (your-ask #2 / thoroughness): a bare `GET /{id}` yields 5
 * (happy / not-found / 2x bad-request / boundary id), a body-bearing endpoint
 * at least 2 (happy + malformed-body), a param-less body-less endpoint just the
 * happy path, while a parameter-rich endpoint yields up to `MAX_SCENARIOS_PER_OP`
 * -- one per enum value (each
 * likely exercises a distinct code path we want to replicate), a filter
 * combination, and negatives -- all derived from the now fix-1-enriched param
 * schemas (`oasOperation.parameters` carry `enum`/`format`). Each scenario
 * carries an `expectedStatus` intent (for Phase-2 canonical capture) and a
 * `directive` telling the LLM exactly which variation to exercise. Discovery
 * seeds (when present) are folded in first as authoritative starting points.
 *
 * Exported for unit testing.
 */
export function defaultScenarioSet(
  op: OperationDto,
  discoveryContext?: MigrationDiscoveryContextDto,
  oasOperation?: unknown,
): GeneratedScenario[] {
  const out: GeneratedScenario[] = [];
  const seen = new Set<string>();
  const add = (s: GeneratedScenario): void => {
    if (seen.has(s.name) || out.length >= MAX_SCENARIOS_PER_OP) return;
    seen.add(s.name);
    out.push(s);
  };

  // 1. Discovery seeds first (authoritative, discovery-derived).
  const seedSet = seedsForOperation(discoveryContext, op.method, op.path);
  if (seedSet?.seeds) {
    for (const s of seedSet.seeds) {
      add({ name: s.scenarioName, type: s.scenarioType, expectedStatus: classifyExpectedFromName(s.scenarioName) });
    }
  }

  // 2. Always exercise the happy path.
  add({
    name: 'happy_path',
    type: 'happy_path',
    expectedStatus: 'success',
    directive:
      'Send a fully valid request using REAL values (DB-sourced ids, the contract date/enum ' +
      'formats); expect a 2xx success.',
  });

  // 3. Parameter-derived coverage (uses the fix-1-enriched param schemas).
  const params = extractOasParams(oasOperation);
  const pathParams = params.filter((p) => p.location === 'path');
  const enumParams = params.filter((p) => p.enumValues && p.enumValues.length > 0);
  const queryParams = params.filter((p) => p.location === 'query');

  // 3a. Non-existent path id -> 404 (its own negative scenario, kept as intended).
  if (pathParams.length > 0) {
    const p = pathParams[0];
    add({
      name: `not_found_${p.name}`,
      type: 'not_found',
      expectedStatus: 'not_found',
      directive:
        `Send a well-formed but NON-EXISTENT ${p.name} (matches the format, absent from the data); ` +
        'expect a 404/not-found. This is an INTENDED negative case to capture, not a mistake.',
    });
  }

  // 3b. One scenario per enum value -- each likely exercises a distinct code path.
  for (const p of enumParams) {
    for (const value of (p.enumValues as unknown[]).slice(0, MAX_ENUM_VALUES_PER_PARAM)) {
      add({
        name: `enum_${p.name}_${String(value)}`,
        type: 'enum',
        expectedStatus: 'success',
        directive:
          `Set ${p.name}=${String(value)} (a valid enum value) with all other inputs valid; expect a ` +
          '2xx. Each enum value likely drives a different code path, which we want to capture.',
      });
    }
  }

  // 3c. Filter combination when there are >=2 query params.
  if (queryParams.length >= 2) {
    const names = queryParams.slice(0, 3).map((p) => p.name);
    add({
      name: `filter_combo_${names.join('_')}`,
      type: 'filter_combo',
      expectedStatus: 'success',
      directive:
        `Combine the filters ${names.join(', ')} with valid values in a single request; expect a 2xx. ` +
        'Captures the filtered behaviour.',
    });
  }

  // 3d. Malformed required param -> 4xx validation (its own negative scenario).
  const malformTarget = params.find((p) => p.required && p.location !== 'path') ?? params.find((p) => p.required);
  if (malformTarget) {
    add({
      name: `bad_request_${malformTarget.name}`,
      type: 'bad_request',
      expectedStatus: 'client_error',
      directive:
        `Send a MALFORMED ${malformTarget.name} that violates its declared format/pattern (e.g. wrong ` +
        'date format, out-of-enum value); expect a 4xx validation error. INTENDED negative case to capture.',
    });
  }

  // 3e. Malformed request BODY -> 4xx. Covers body-bearing endpoints that have
  // no malformable path/query param (e.g. POST /things), raising their floor
  // from 1 (happy only) to >=2.
  const hasRequestBody =
    !!oasOperation &&
    typeof oasOperation === 'object' &&
    !!(oasOperation as Record<string, unknown>).requestBody;
  if (hasRequestBody) {
    add({
      name: 'bad_request_body',
      type: 'bad_request',
      expectedStatus: 'client_error',
      directive:
        'Send a MALFORMED request body that violates the schema (wrong field types, a missing ' +
        'required field, or an invalid enum/format value); expect a 4xx validation error. INTENDED negative case.',
    });
  }

  // 3f. Extra path-id negatives so a simple GET /{id} reaches >=5: a wrong-TYPE
  // malformation (distinct from the format violation in 3d) plus a boundary id.
  if (pathParams.length > 0) {
    const idp = pathParams[0];
    add({
      name: `bad_request_${idp.name}_type`,
      type: 'bad_request',
      expectedStatus: 'client_error',
      directive:
        `Send ${idp.name} with the WRONG DATA TYPE (e.g. a non-numeric string where a numeric id is ` +
        'expected, or free text where a date/uuid is expected); expect a 4xx. Distinct from the ' +
        'malformed-format case. INTENDED negative.',
    });
    add({
      name: `edge_${idp.name}`,
      type: 'not_found',
      expectedStatus: 'not_found',
      directive:
        `Send a well-formed but BOUNDARY/extreme ${idp.name} (e.g. a very large value) that is absent ` +
        'from the data; expect a 404. Captures boundary-id handling distinct from a random not-found.',
    });
  }

  return out;
}

/**
 * Map a discovery seed's scenarioType token (the AMS emits the leading token of
 * the seed name, e.g. "happy" / "error" / "edge" / "auth") onto the persisted
 * `ScenarioType` enum used by `createScenario`. Full granularity is preserved in
 * the scenario NAME ("error_404", "auth_missing_token", ...); unknown tokens
 * fall back to `generated_candidate` (these rows ARE generated from discovery seeds).
 */
function seedTypeToScenarioType(seedType: string): ScenarioType {
  switch ((seedType ?? '').trim().toLowerCase()) {
    case 'happy':
    case 'happy_path':
      return 'happy_path';
    case 'auth':
    case 'auth_variant':
    case 'auth_error':
      return 'auth_error';
    case 'validation':
    case 'validation_error':
      return 'validation_error';
    case 'error':
    case 'edge':
    case 'business_edge_case':
    case 'enum':
    case 'filter_combo':
      return 'business_edge_case';
    case 'not_found':
      return 'not_found';
    case 'bad_request':
      return 'validation_error';
    default:
      return 'generated_candidate';
  }
}

/**
 * Reject-and-hide ONE non-canonical capture: PATCH `accepted:false` with the
 * system reason marker on `reviewer_notes`. Defensive -- NEVER throws: a
 * reject-write failure (AMS hiccup, or a test mock with no `patchCapture`)
 * must not abort the run. The canonical capture is durably persisted and the
 * scenario counting already happened by the time we get here; a missed reject
 * just leaves a fumble visible (degrades to the pre-canonical behaviour),
 * which is strictly safer than tearing down the whole capture session.
 *
 * Spec: 2026-06-17 Intent-Driven Canonical Capture.
 */
async function safeRejectNonCanonicalCapture(
  archClient: typeof defaultArchModelClient,
  projectId: string,
  captureId: string,
): Promise<void> {
  try {
    await archClient.patchCapture(projectId, captureId, {
      accepted: false,
      reviewer_notes: NON_CANONICAL_REVIEWER_NOTE,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `captureSessionOrchestrator: failed to reject non-canonical capture ${captureId}`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

export async function orchestrateCaptureSession(
  session: CaptureSession,
  deps: OrchestratorDeps,
): Promise<OrchestratorOutcome> {
  const archClient = deps.archModelClient ?? defaultArchModelClient;
  const gateway = deps.gatewayClient ?? defaultGatewayClient;
  const discoveryContext = deps.discoveryContext;
  // Group 9: thread the discovery-service handle + linked runId into every
  // per-scenario tool execution context so `get_operation_payload_context`
  // can fetch repo-relative JAXB DTO source. Both fields are optional --
  // when absent the tool degrades gracefully to WSDL-only output.
  const discoveryClient: DiscoveryServiceClient =
    deps.discoveryServiceClient ?? defaultDiscoveryServiceClient;
  const discoveryRunId: string | null = deps.discoveryRunId ?? null;
  // Mode 1(b)/(c) Postman import (Spec 2026-06-23). `postmanOnly` skips the
  // whole per-op loop; `postmanCapturedByOp` drives the per-op delta when set.
  const postmanOnly: boolean = deps.postmanOnly === true;
  const postmanCapturedByOp = deps.postmanCapturedByOp ?? {};
  const judgeRedundantScenarios: JudgeFn | undefined = deps.judgeRedundantScenarios;

  // Stable corr bag for every trace call on this session. project + arch are
  // the workflow-spanning grouping key; session is this capture's sub-thread.
  const corr = {
    project: session.projectId,
    arch: session.architectureId,
    session: session.id,
  };

  let scenariosAttempted = 0;
  let scenariosCompleted = 0;
  let scenariosErrored = 0;
  let infraError: string | null = null;

  // ---- Oracle Coverage Scoring (Spec: 2026-06-17). Accumulated INSIDE the
  // per-scenario loop because `runManager.getScenarioCaptures` is RESET every
  // `beginScenario`; we cannot read it once at the end. The scorer stays pure;
  // the orchestrator owns this accumulation + the final assembly. `null` means
  // the summary could not be assembled (defensive -- never blocks completion).
  const perEndpointCoverage: EndpointCoverageResult[] = [];
  // Candidate representative endpoints for the SESSION-level auth probes:
  // included + safe_to_execute + happy_path achieved (built in operation order;
  // `selectAuthProbeEndpoint` filters out templated paths).
  const authProbeCandidates: AuthProbeCandidate[] = [];
  let coverageSummary: CoverageSummary | null = null;

  // ---- Pre-flight: secrets must exist (purged on terminal => fail fast)
  const secrets = secretsStore.get(session.id);
  if (!secrets) {
    await archClient.patchCaptureSession(session.projectId, session.id, {
      status: 'failed',
      error_message: 'secrets_lost_during_run',
      completed_at: new Date().toISOString(),
      scenarios_attempted: 0,
      scenarios_completed: 0,
      scenarios_errored: 0,
    });
    trace.fail('capture COMPLETED but 0/0 captured — secrets_lost_during_run', corr);
    return {
      sessionId: session.id,
      scenariosAttempted: 0,
      scenariosCompleted: 0,
      scenariosErrored: 0,
      finalStatus: 'failed',
      errorMessage: 'secrets_lost_during_run',
    };
  }

  // ---- Build per-session live handles
  const httpExecutor = createSessionHttpExecutor({
    auth: secrets.api,
    baseURL: session.apiBaseUrl ?? undefined,
    timeoutMs: 30_000,
    defaultHeaders: session.defaultHeadersRedactedJson ?? {},
  });

  const dbAdapter = (() => {
    const cfg = session.dbConfigRedactedJson;
    if (!cfg || !cfg.host || !cfg.port || !cfg.database || !cfg.username) return null;
    if (!secrets.db?.password) return null;
    // DB sampling is OPTIONAL: a malformed / absent dbType must degrade to
    // "no DB sampling", never throw. Without this guard a missing or invalid
    // `dbType` reached `createDbAdapter` -> `Unsupported dbType: undefined`,
    // which rejected out of the orchestrator setup (before its try/catch) and
    // left the session stuck in RUNNING. Only the two supported adapters
    // proceed; anything else skips DB sampling entirely.
    if (cfg.dbType !== 'postgres' && cfg.dbType !== 'sybase') return null;
    return createDbAdapter({
      dbType: cfg.dbType,
      host: cfg.host,
      port: cfg.port,
      database: cfg.database,
      schema: cfg.schema,
      username: cfg.username,
      password: secrets.db.password,
    });
  })();

  const operationsByOasId = new Map<string, OperationDto>();
  for (const op of deps.persistedOperations) {
    operationsByOasId.set(op.operation_id, op);
  }

  const archWriteSurface: ArchModelToolWriteSurface = {
    createScenario: archClient.createScenario.bind(archClient),
    createDiagnostic: archClient.createDiagnostic.bind(archClient),
    createCapture: archClient.createCapture.bind(archClient),
  };

  const baseContext: Omit<ToolExecutionContext, 'currentScenarioId'> = {
    session,
    oasInventory: deps.oasInventory,
    operationsByOasId,
    secrets,
    httpExecutor,
    dbAdapter,
    archModelClient: archWriteSurface,
    // Group 9: wire the discovery-service handle + runId so the
    // get_operation_payload_context tool can fetch JAXB DTO source.
    discoveryServiceClient: discoveryClient,
    discoveryRunId,
  };

  // ---- Drive scenarios
  try {
    runManager.start({
      sessionId: session.id,
      projectId: session.projectId,
      architectureId: session.architectureId,
    });

    for (const op of deps.persistedOperations) {
      if (op.included !== true) continue;
      // Mode 1(c) Postman only (R4c): skip the planner + execute_http_request
      // loop entirely. The imported items were already captured via
      // manual-capture before /start; there is nothing for the LLM to top up.
      if (postmanOnly) continue;
      const oasOperation = deps.oasInventory.operations.find(
        (o) => o.operationId === op.operation_id,
      )?.oasOperation;
      let scenarios = defaultScenarioSet(op, discoveryContext, oasOperation);
      // Mode 1(b) delta (R6 / D3 / A5): when this operation carries already-
      // captured Postman requests, subtract the covered candidates BEFORE
      // generating so only the genuine delta tops up. Two-stage bounded
      // subtraction (Stage-1 code pre-filter + Stage-2 LLM judge), capped at
      // MAX_SCENARIOS_PER_OP INCLUDING the captured Postman scenarios. Per-op.
      const postmanCaptured = postmanCapturedByOp[op.operation_id] ?? [];
      if (postmanCaptured.length > 0) {
        const delta = await computePostmanDelta({
          operationId: op.operation_id,
          method: op.method,
          path: op.path,
          candidates: scenarios,
          captured: postmanCaptured,
          // No injected judge -> Stage-1-only subtraction (a no-op judge that
          // returns nothing redundant), so every Stage-1 survivor tops up.
          judge:
            judgeRedundantScenarios ?? (async () => [] as ReadonlyArray<string>),
          maxScenariosPerOp: MAX_SCENARIOS_PER_OP,
        });
        scenarios = delta.topUp;
        trace.detail(
          'capture.postman_delta',
          { operationId: op.operation_id, ...delta.stats },
          corr,
        );
      }
      const seedSet = seedsForOperation(discoveryContext, op.method, op.path);
      // Snapshot each scenario's recorded captures HERE (the loop below resets
      // `runManager.scenarioCaptures` on the next `beginScenario`), keyed by
      // scenario name, so the pure scorer can line each generated dimension up
      // with its outcome after this operation's scenarios finish.
      const outcomesByName = new Map<string, Array<{ captureId: string; status: number | null }>>();
      for (const scenario of scenarios) {
        scenariosAttempted += 1;
        // Resets `scenarioHttpAttempts` AND `scenarioCapturesPersisted` to 0
        // alongside the existing `currentScenarioRounds` reset, so both the
        // attempt counter and the persisted-capture counter restart for each
        // new scenario.
        runManager.beginScenario(session.id);

        // Persist a draft scenario row first so the loop has a stable id
        // for `record_capture_note` to attach to.
        //
        // `request_method` + `request_path` are REQUIRED by AMS
        // (`ApiBehaviourScenarioService.create` throws
        // `IllegalArgumentException` -> HTTP 400 when either is blank, and
        // the underlying `api_behaviour_scenarios` columns are NOT NULL).
        // Source them from the persisted operation row (`op.method` /
        // `op.path`), which always carries an uppercase verb + path.
        // Omitting them previously 400'd the FIRST scenario create and
        // aborted the entire run in ~16ms, before any target API call.
        // The remaining AMS-required fields are already supplied above
        // (`session_id`, `operation_id`, `scenario_name`); `scenario_type`
        // / `status` / `generation_source` are AMS-optional (defaulted
        // server-side) but kept explicit here.
        const scenarioRow = await archClient.createScenario(session.projectId, {
          session_id: session.id,
          operation_id: op.id,
          scenario_name: scenario.name,
          scenario_type: seedTypeToScenarioType(scenario.type),
          status: 'draft',
          generation_source: 'llm_generated',
          request_method: op.method,
          request_path: op.path,
        });

        const ctx: ToolExecutionContext = {
          ...baseContext,
          currentScenarioId: scenarioRow.id,
          // `retryCount` removed: source of truth is now
          // `runManager.scenarioHttpAttempts`. Field is retained as
          // optional on `ToolExecutionContext` for backwards compatibility
          // with existing test mocks (see toolTypes.ts).
        };

        const outcome = await runScenarioLoop({
          context: ctx,
          initialMessages: buildScenarioPrompt(
            session,
            op.operation_id,
            scenario.name,
            op.method,
            op.path,
            discoveryContext,
            seedSet?.seeds?.find((s) => s.scenarioName === scenario.name),
            runManager.getLearnedFacts(session.id),
            scenario.directive,
            session.dataTypeDefaultsJson,
          ),
          tools: ALL_TOOLS,
          gatewayClient: gateway,
          archModelClient: archClient,
          abortSignal: runManager.get(session.id)?.abortController.signal,
        });

        // Intent-driven canonical capture (replaces the misleading-COMPLETED
        // captured/errored decision): the loop typically produces MULTIPLE
        // capture rows for one scenario -- the LLM's intermediate fumbles plus
        // the corrected attempt (e.g. a malformed-date 400 then a fixed 200).
        // Only the ONE capture matching the scenario's intended outcome is the
        // oracle worth keeping; the rest are noise that would pollute the
        // baseline and the human review. We select the canonical capture by
        // `scenario.expectedStatus`, leave it UNTOUCHED (still pending human
        // accept), and reject-and-hide every OTHER capture (`accepted:false`
        // + a system reason marker on `reviewer_notes`). A scenario counts as
        // CAPTURED iff a canonical was found; otherwise it errored (only
        // fumbles / a 500 came back -- no usable oracle) and ALL its captures
        // are rejected as non-canonical. There is no AMS delete endpoint and
        // deleting oracle data is unsafe, so this is reject-and-hide, never a
        // hard delete. The status state-machine is untouched.
        const scenarioCaptures = runManager.getScenarioCaptures(session.id);
        const capturesPersisted = scenarioCaptures.length;

        // ---- Stateful sequence assembly (Spec D, 2026-06-18). When the LLM
        // pinned a sequence for this scenario (via the terminal `pin_sequence`
        // tool), assemble the R1 `sequence_json` from the pin declaration +
        // the ordered captures and derive the ref-derived volatile paths. A
        // sequence stays ONE GeneratedScenario -> ONE CoverageDimensionResult:
        // we DELIBERATELY reuse the existing selectCanonicalCapture /
        // scoreEndpointCoverage path (the ACT step's capture is the canonical
        // one for scoring), so the per-endpoint rubric is NEVER inflated to N
        // dimensions. A NON-sequence scenario takes the existing single-shot
        // path byte-for-byte unchanged (pinnedSequence is null).
        const pinnedSequence = runManager.getPinnedSequence(session.id);
        let assembledSequence: SequenceJson | null = null;
        let sequenceVolatilePaths: Record<string, unknown> | null = null;
        let actStepCapture: { captureId: string; status: number | null } | null = null;
        if (pinnedSequence) {
          assembledSequence = assembleSequenceJson(pinnedSequence, scenarioCaptures);
          if (assembledSequence) {
            // The ACT step's capture is the canonical oracle for scoring + the
            // baseline-item carrier of `sequence_json`.
            const actDecl = pinnedSequence.steps[pinnedSequence.actStepIndex];
            const actCap = scenarioCaptures[actDecl.captureIndex];
            if (actCap) {
              actStepCapture = { captureId: actCap.captureId, status: actCap.status };
            }
            // Ref-derived volatility (R3): record the referenced + generated-id
            // paths into the SAME volatile_paths_json envelope so the diff side
            // tolerates them with NO diff-side change.
            sequenceVolatilePaths = deriveSequenceVolatilePaths(pinnedSequence, scenarioCaptures);
          }
        }

        // For a well-formed sequence, the canonical capture is the ACT step's
        // capture (the behaviour under test). Otherwise the existing
        // intent-driven canonical selection by `expectedStatus` applies,
        // unchanged.
        const canonical = actStepCapture
          ? actStepCapture
          : selectCanonicalCapture(scenarioCaptures, scenario.expectedStatus);

        // Coverage accumulation: snapshot this scenario's ordered captures by
        // name (copy -- the array is reset on the next `beginScenario`). The
        // pure scorer re-runs `selectCanonicalCapture` on this snapshot, so the
        // achieved/missed decision uses the EXACT same function as the canonical
        // selection above (no second definition of coverage).
        outcomesByName.set(
          scenario.name,
          scenarioCaptures.map((c) => ({ captureId: c.captureId, status: c.status })),
        );

        let droppedCount = 0;
        if (canonical) {
          scenariosCompleted += 1;
          // Reject every NON-canonical capture (the fumbles). The canonical
          // capture is deliberately left as-is (pending human accept).
          for (const cap of scenarioCaptures) {
            if (cap.captureId === canonical.captureId) continue;
            droppedCount += 1;
            await safeRejectNonCanonicalCapture(archClient, session.projectId, cap.captureId);
          }
        } else {
          // No capture matched the intended outcome -- the scenario errored.
          // Reject ALL of its captures as non-canonical so none reach the
          // baseline or the human review's default view.
          scenariosErrored += 1;
          for (const cap of scenarioCaptures) {
            droppedCount += 1;
            await safeRejectNonCanonicalCapture(archClient, session.projectId, cap.captureId);
          }
        }

        // DETAIL: per-scenario terminus -- the terminal tool / loop-exit
        // reason, the truthful captures-persisted count, PLUS the canonical
        // captureId kept and the count of fumbles dropped (intent-driven
        // canonical capture). `canonicalCaptureId` is null when the scenario
        // errored (no capture matched its intended outcome).
        // Persist the assembled `sequence_json` (+ ref-derived volatile paths)
        // as a structured diagnostic keyed to the canonical (act-step) capture,
        // so the Save-as-baseline flow can carry it onto the act step's
        // baseline item via the `createBaselineItem` path (write-once,
        // snake_case `sequence_json` + `volatile_paths_json`). Best-effort -- a
        // failed write must not fail the run.
        if (assembledSequence && canonical) {
          try {
            await archClient.createDiagnostic(session.projectId, {
              session_id: session.id,
              operation_id: op.id,
              scenario_id: scenarioRow.id,
              // Reuse the existing `endpoint_skipped` diagnostic type as the
              // carrier (AMS DiagnosticType is a constrained union); the
              // structured `detail_json` carries the sequence + the
              // `sequence_pinned` marker the Save / review surfaces read.
              diagnostic_type: 'endpoint_skipped',
              message:
                `sequence_pinned: stateful sequence for '${scenario.name}' -- ` +
                `${assembledSequence.steps.length} steps, act at index ${assembledSequence.act_step_index}.`,
              detail_json: {
                marker: 'sequence_pinned',
                canonical_capture_id: canonical.captureId,
                sequence_json: assembledSequence as unknown as Record<string, unknown>,
                volatile_paths_json: sequenceVolatilePaths,
              },
            });
          } catch (seqErr) {
            // eslint-disable-next-line no-console
            console.warn(
              `captureSessionOrchestrator: failed to persist sequence_pinned diagnostic for ` +
                `session=${session.id} scenario='${scenario.name}'`,
              seqErr instanceof Error ? seqErr.message : String(seqErr),
            );
          }
        }

        trace.detail(
          'capture.scenario.end',
          {
            scenario: scenario.name,
            terminalTool: outcome.reason,
            capturesPersisted,
            expectedStatus: scenario.expectedStatus,
            canonicalCaptureId: canonical ? canonical.captureId : null,
            dropped: droppedCount,
            sequencePinned: assembledSequence !== null,
            sequenceStepCount: assembledSequence ? assembledSequence.steps.length : 0,
          },
          corr,
        );
      }

      // Operation finished: score its rubric from the accumulated per-scenario
      // outcomes (PURE scorer reads the SAME `scenarios` array generation used).
      const endpointCoverage = scoreEndpointCoverage(op, scenarios, outcomesByName);
      perEndpointCoverage.push(endpointCoverage);

      // Register this endpoint as an auth-probe candidate when it is safe to
      // replay (non-mutating / safe_to_execute) AND it achieved its happy_path
      // (a known-good request shape). `selectAuthProbeEndpoint` additionally
      // rejects templated paths so the probe never has to invent a real id.
      const happyAchieved = endpointCoverage.dimensions.some(
        (d) => d.name === 'happy_path' && d.achieved,
      );
      if (op.safe_to_execute === true && happyAchieved) {
        authProbeCandidates.push({
          operationId: op.operation_id,
          method: op.method,
          path: op.path,
        });
      }
    }

    // ---- Session-level auth-negative coverage (ONE project dimension). Run
    // ONCE, BEFORE the executor is disposed in the `finally`. The probes use
    // the scoped auth-override seam so they can never leak onto a later call;
    // when no safe representative endpoint qualifies the dimension is recorded
    // MISSED with an honest reason rather than firing an unsafe call.
    const authCoverage = await runAuthNegativeProbes(httpExecutor, authProbeCandidates);
    coverageSummary = assembleCoverageSummary(perEndpointCoverage, authCoverage);
  } catch (err) {
    infraError = err instanceof Error ? err.message : String(err);
  } finally {
    httpExecutor.dispose();
    if (dbAdapter) {
      try {
        await dbAdapter.dispose();
      } catch {
        // ignore -- pool teardown errors must not derail teardown.
      }
    }
    runManager.end(session.id);
    secretsStore.purge(session.id);
  }

  const finalStatus: 'completed' | 'failed' = infraError ? 'failed' : 'completed';
  // Persist the per-run scenario tallies alongside the terminal status
  // (misleading-COMPLETED fix): `completed` only means "no INFRASTRUCTURE
  // error" — every scenario can have errored. `scenarios_completed` now
  // means "scenarios that persisted >=1 capture row", NOT "scenarios that
  // reached a terminal tool call", so the dashboard renders an honest
  // "Completed — N of M scenarios captured" and an all-failed run is
  // impossible to mistake for a successful one.
  await archClient.patchCaptureSession(session.projectId, session.id, {
    status: finalStatus,
    completed_at: new Date().toISOString(),
    error_message: infraError,
    scenarios_attempted: scenariosAttempted,
    scenarios_completed: scenariosCompleted,
    scenarios_errored: scenariosErrored,
    // Oracle Coverage Scoring (2026-06-17): the whole coverage summary rides
    // along on the SAME completion PATCH beside the scenario tallies (AMS
    // changeset 189, snake_case wire). Display-only -- no gate. Null when the
    // run aborted before assembly (infra error); a null/absent summary renders
    // as "coverage not recorded", never an error. Cast to the AMS field's
    // Record shape (the summary is a plain JSON object).
    coverage_summary_json: coverageSummary
      ? (coverageSummary as unknown as Record<string, unknown>)
      : null,
  });

  // SUMMARY: capture terminal outcome, using the TRUTHFUL counters above.
  // `scenariosCompleted` == "scenarios that persisted >=1 capture row"
  // ("captured"); `scenariosErrored` == everything else. A 0-captured run
  // is a FAIL line so an all-failed run can never read as success.
  if (scenariosCompleted > 0) {
    trace.ok(
      `capture COMPLETED — ${scenariosCompleted}/${scenariosAttempted} captured, ` +
        `${scenariosErrored} errored`,
      corr,
    );
  } else {
    trace.fail(
      `capture COMPLETED but 0/${scenariosAttempted} captured — ` +
        `${scenariosErrored} scenarios errored`,
      corr,
    );
  }

  return {
    sessionId: session.id,
    scenariosAttempted,
    scenariosCompleted,
    scenariosErrored,
    finalStatus,
    errorMessage: infraError,
  };
}
