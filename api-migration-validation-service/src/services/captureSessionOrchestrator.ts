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
import { createDbAdapter } from './db/dbAdapterFactory';
import { runScenarioLoop } from './captureLoopRunner';
import { ALL_TOOLS } from './tools';
import type { ToolExecutionContext, ArchModelToolWriteSurface } from './tools';
import { discoveryServiceClient as defaultDiscoveryServiceClient } from './discoveryServiceClient';
import type { DiscoveryServiceClient } from './discoveryServiceClient';
import type { CaptureSession, ScenarioType } from '../types/captureSession';
import type { ParsedOasInventory } from '../types/oas';
import type { ChatMessage } from '../types/llm';

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
): ChatMessage[] {
  const userPayload: Record<string, unknown> = {
    sessionId: session.id,
    envName: session.envName,
    apiBaseUrl: session.apiBaseUrl,
    operationId: operationOasId,
    scenarioName,
    instructions:
      'Plan and execute this scenario. Use list_oas_operations / get_oas_operation_detail for shape; ' +
      'sample_db_values / list_db_metadata if helpful for realistic inputs; ' +
      'execute_http_request to capture; record_capture_note to finish.',
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
        'Discovery findings are supporting evidence. Do not invent behaviour beyond OAS/API ' +
        'response evidence. Use DB sample hints (sample_db_values) where available. If discovery ' +
        'indicates uncertainty (e.g. missing contract detail, unresolved decision tasks), record ' +
        'a note/warning via record_capture_note rather than guessing.',
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

  return [
    {
      role: 'system',
      content:
        'You are an API behaviour capture planner. You will draft scenarios, execute them via the registered tools, and record results. ' +
        'You must use `execute_http_request` for any HTTP call (never describe one in prose) and `run_readonly_sql` for any DB read. ' +
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
export function defaultScenarioSet(
  op: OperationDto,
  discoveryContext?: MigrationDiscoveryContextDto,
): Array<{ name: string; type: string }> {
  const seedSet = seedsForOperation(discoveryContext, op.method, op.path);
  if (seedSet?.seeds && seedSet.seeds.length > 0) {
    return seedSet.seeds.map((s) => ({ name: s.scenarioName, type: s.scenarioType }));
  }
  return [{ name: 'happy_path', type: 'happy_path' }];
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
      return 'business_edge_case';
    default:
      return 'generated_candidate';
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

  let scenariosAttempted = 0;
  let scenariosCompleted = 0;
  let scenariosErrored = 0;
  let infraError: string | null = null;

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
      const scenarios = defaultScenarioSet(op, discoveryContext);
      const seedSet = seedsForOperation(discoveryContext, op.method, op.path);
      for (const scenario of scenarios) {
        scenariosAttempted += 1;
        // Resets `scenarioHttpAttempts` to 0 alongside the existing
        // `currentScenarioRounds` reset, so the attempt counter restarts
        // at 1 for each new scenario.
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
          ),
          tools: ALL_TOOLS,
          gatewayClient: gateway,
          archModelClient: archClient,
          abortSignal: runManager.get(session.id)?.abortController.signal,
        });

        if (outcome.reason === 'completed') {
          scenariosCompleted += 1;
        } else {
          scenariosErrored += 1;
        }
      }
    }
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
  // error" — every scenario can have errored. The tallies let the dashboard
  // render "Completed — N of M scenarios captured" so an all-failed run is
  // impossible to mistake for a successful one.
  await archClient.patchCaptureSession(session.projectId, session.id, {
    status: finalStatus,
    completed_at: new Date().toISOString(),
    error_message: infraError,
    scenarios_attempted: scenariosAttempted,
    scenarios_completed: scenariosCompleted,
    scenarios_errored: scenariosErrored,
  });

  return {
    sessionId: session.id,
    scenariosAttempted,
    scenariosCompleted,
    scenariosErrored,
    finalStatus,
    errorMessage: infraError,
  };
}
