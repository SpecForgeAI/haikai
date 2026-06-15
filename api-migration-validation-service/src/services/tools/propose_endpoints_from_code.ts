import axios from 'axios';
import {
  gatewayClient as defaultGatewayClient,
  GatewayClient,
} from '../gatewayClient';
import { recordAndCheck } from '../tokenBudget';
import type { ChatMessage, ToolDefinition } from '../../types/llm';
import type { ToolRegistryEntry } from './toolTypes';

/**
 * Tool: `propose_endpoints_from_code` (Workstream A)
 *
 * AMVS LLM tool that asks the configured LLM (via the gateway relay) to
 * propose SOAP endpoint operations from a curated set of Java source files
 * fetched from discovery-service's cached repo clone. Invoked synchronously
 * from the Step 4 wizard when the deterministic Spring Classic SOAP scanner
 * emitted zero candidates (W-3). Reuses AMVS's existing LLM config (W-11) --
 * no new provider/model surface.
 *
 * Inputs:
 *   - `interfaceCandidateId`  -- parent SOAP interface candidate's short id
 *                                (also used in the malformed-LLM finding's
 *                                `links` payload).
 *   - `parentServiceId`       -- parent service candidate id (informational
 *                                only; threaded into the prompt as context
 *                                so the LLM can disambiguate when several
 *                                interfaces sit under the same service).
 *   - `parentServiceName`     -- human-readable parent service name (folded
 *                                into the prompt for the LLM's context).
 *   - `parentInterfaceName`   -- human-readable interface display name
 *                                (folded into the prompt).
 *   - `runId`/`projectId`/`architectureId` -- run-scoped triple used to
 *                                fetch source files from the Group 1 endpoint
 *                                `GET /discovery/projects/:p/architectures/:a/runs/:runId/source/*`.
 *   - `sourceFilePaths`       -- repo-relative paths (e.g.
 *                                `src/main/java/com/foo/FooServlet.java`).
 *                                Each is fetched via the Group 1 endpoint and
 *                                inlined into the prompt.
 *   - `inlineSnippets` (opt)  -- pre-fetched code snippets keyed by path.
 *                                When supplied, the tool skips the
 *                                source-endpoint fetch for those keys
 *                                (useful for tests + Step-4 routes that
 *                                already walked the pack source).
 *   - `sessionId`             -- Step 4 review session id used as the
 *                                key for the per-session token-cap counter
 *                                (W-7).
 *
 * Output schema (strict, validated; W-8 confidence tiers applied):
 *   ```
 *   [{ operationName: string,
 *      soapAction?: string,
 *      path?: string,
 *      requestRootElement?: string,
 *      responseRootElement?: string,
 *      requestDtoClass?: string,
 *      responseDtoClass?: string,
 *      confidence: number }]
 *   ```
 *
 * Confidence-tier handling (configured constants, NOT user-tunable -- W-8):
 *   - `confidence < 0.4`   -> drop silently; one
 *     `[diag-amvs] llm_endpoint_extract action=dropped reason=low_confidence`
 *     log line per drop.
 *   - `0.4 <= conf < 0.7`  -> include with `confidence_tier='low'` so the
 *     frontend renders a "low confidence" chip on the candidate row.
 *   - `confidence >= 0.7`  -> include with `confidence_tier='default'`
 *     (default-accepted-pending-review).
 *
 * Malformed-output retry (W-9):
 *   - First failure: ONE automatic retry with a follow-up prompt that
 *     re-states the schema and prefixes the previous response with
 *     "your previous response was malformed".
 *   - Second failure: emit zero candidates, return one warning, and emit
 *     one `evidence_gap` finding with `gapType='llm_endpoint_extract_malformed'`
 *     via the supplied finding-emit callback. The discovery-service
 *     `emissionSources.ts` builder is the source-of-truth for the finding's
 *     shape; the AMVS-local helper mirrors that shape so the tool does not
 *     have a hard runtime dependency on discovery-service. NEVER cascade-fail
 *     the discovery run; NEVER re-raise.
 *
 * Token caps (W-7):
 *   - Per-call cap: `AMVS_LLM_EXTRACT_CALL_TOKEN_CAP` (default 20000).
 *   - Per-session cap: `AMVS_LLM_EXTRACT_SESSION_TOKEN_CAP` (default 100000).
 *   - On overflow the tool TRUNCATES the inlined source set and surfaces a
 *     truncation marker (`// ...truncated, N more bytes`) plus a `warnings`
 *     entry to the caller. Never hard-fails.
 *
 * Spec: agent-os/specs/2026-05-17-soap-llm-extraction-and-payload-enrichment-phase-2/spec.md
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Strict per-entry shape produced by the LLM and validated by the tool. The
 * snake-case AMS persistence shape is derived from this in Group 7 (NOT in
 * this file).
 */
export interface ProposedOperation {
  operationName: string;
  soapAction?: string;
  path?: string;
  requestRootElement?: string;
  responseRootElement?: string;
  requestDtoClass?: string;
  responseDtoClass?: string;
  confidence: number;
  /** Tier marker added by the tool (NOT in the raw LLM response). */
  confidence_tier?: 'low' | 'default';
}

/**
 * Source endpoint result. `evicted=true` short-circuits the tool to the
 * caller with a `clone_evicted` log line so the frontend can disable the
 * "Extract endpoints with LLM" button (W-17).
 */
export interface SourceFetchResult {
  /** `true` when the file was fetched OK. */
  ok: boolean;
  /** Raw text content when `ok=true`. */
  content?: string;
  /** Repo-relative path echoed for log lines. */
  path: string;
  /** Set to `true` when the cache was GC'd (HTTP 410). */
  evicted?: boolean;
  /** Optional human-readable note (e.g. `file_not_found`). */
  note?: string;
}

/**
 * Pluggable dependency surface so the route handler (Group 6) can inject a
 * production gateway + axios source fetch while tests inject in-memory stubs.
 */
export interface ProposeEndpointsDeps {
  /** Single LLM round-trip. Defaults to the shared gateway client. */
  gatewayClient?: Pick<GatewayClient, 'callLlmToolLoop'>;
  /**
   * Fetch a single source file from discovery-service's source endpoint.
   * Returns `{ ok: false, evicted: true }` on HTTP 410. Tests inject a
   * fake fetcher that maps a known set of `{ path -> content }` pairs.
   */
  fetchSource?: (
    args: {
      projectId: string;
      architectureId: string;
      runId: string;
      path: string;
    },
  ) => Promise<SourceFetchResult>;
  /**
   * Emit an `evidence_gap` finding via discovery-service. Tests inject a
   * jest.fn so they can assert on the malformed-twice payload without
   * the full HTTP round-trip. Defaults to a no-op (Group 6 will wire the
   * real emit path).
   */
  emitFinding?: (input: FindingEmitInputShape) => Promise<void>;
}

/**
 * Mirror of discovery-service's `FindingEmitInput`. Kept local to avoid a
 * cross-service import. AMVS emits this shape via Group 6's route handler;
 * the wire path lives in discovery-service.
 */
export interface FindingEmitInputShape {
  findingType: 'evidence_gap';
  category: 'evidence_gap';
  severity: 'medium';
  title: string;
  summary: string;
  detailJson: {
    gapType: 'llm_endpoint_extract_malformed';
    reason: string;
    interfaceShortId: string;
  };
  source: 'pipeline_evidence_gap';
  createdByStage: 'amvs.llmEndpointExtract';
  links: Array<{
    linkType: 'supports';
    targetType: 'discovery_candidate';
    targetId: string;
  }>;
}

export interface ProposeEndpointsArgs {
  interfaceCandidateId: string;
  parentServiceId: string;
  parentServiceName: string;
  parentInterfaceName: string;
  runId: string;
  projectId: string;
  architectureId: string;
  sessionId: string;
  sourceFilePaths: string[];
  inlineSnippets?: Record<string, string>;
  /** Optional override for the LLM model name forwarded to the gateway. */
  model?: string;
}

export interface ProposeEndpointsResult {
  /** Confidence-filtered + retry-validated list of operations. */
  operations: ProposedOperation[];
  /** Truncation / malformed-LLM warnings the caller surfaces in the UI. */
  warnings: string[];
  /**
   * `true` when the source endpoint returned 410 Gone. The caller (Group 6)
   * uses this to disable the trigger button with secondary text
   * "Source no longer cached -- re-run discovery".
   */
  cloneEvicted?: boolean;
  /**
   * `true` when the LLM returned malformed JSON on BOTH attempts. The caller
   * (Group 6) uses this to surface the "LLM extraction failed -- review
   * manually" toast.
   */
  malformed?: boolean;
}

// ---------------------------------------------------------------------------
// Constants / helpers
// ---------------------------------------------------------------------------

const CONFIDENCE_DROP_THRESHOLD = 0.4;
const CONFIDENCE_LOW_THRESHOLD = 0.7;

/**
 * Coarse token estimator -- 4 chars per token is the standard rough estimate
 * for English-language LLM input and lines up with the 20K-token / 100K-token
 * caps used by the helper. The tool uses this to seed the token-budget
 * helper; the gateway-side counts are authoritative for billing.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Truncate a single source file's content to `maxChars` characters, append a
 * marker noting how many bytes were dropped. Mirrors the Workstream B
 * truncation marker style so the LLM can detect that context is incomplete.
 */
function truncateWithMarker(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  const dropped = content.length - maxChars;
  return `${content.slice(0, maxChars)}\n// ...truncated, ${dropped} more bytes`;
}

/**
 * Schema constant rendered into the LLM prompt. Kept as a single string so
 * the snapshot test can assert it verbatim.
 */
export const PROPOSE_ENDPOINTS_OUTPUT_SCHEMA = `[
  {
    "operationName": "string (required)",
    "soapAction": "string (optional)",
    "path": "string (optional, e.g. /services/Foo)",
    "requestRootElement": "string (optional, the SOAP body request element name)",
    "responseRootElement": "string (optional)",
    "requestDtoClass": "string (optional, FQN of the JAXB / hand-rolled DTO)",
    "responseDtoClass": "string (optional)",
    "confidence": "number in [0.0, 1.0] (required)"
  }
]`.trim();

/**
 * Build the user-role prompt sent to the LLM. Public so the snapshot test
 * (5.1 Test 1) can pin its contents.
 */
export function buildExtractionPrompt(args: {
  parentInterfaceName: string;
  parentServiceName: string;
  sources: Array<{ path: string; content: string }>;
  truncated: boolean;
  retryPrelude?: string;
}): string {
  const sourceSnippets = args.sources
    .map(
      (s) =>
        `// ===== File: ${s.path} =====\n${s.content}\n// ===== End: ${s.path} =====`,
    )
    .join('\n\n');
  const truncationNotice = args.truncated
    ? '\n\nNOTE: The source set above was TRUNCATED to fit within the per-call token cap. Some content was dropped (see `// ...truncated` markers).\n'
    : '';
  const preludeBlock = args.retryPrelude ? `${args.retryPrelude}\n\n` : '';
  return (
    `${preludeBlock}` +
    `You are inspecting Java source code from a parent service named "${args.parentServiceName}" ` +
    `for a SOAP-style interface named "${args.parentInterfaceName}". The deterministic framework ` +
    `scanner produced zero endpoint candidates for this interface, so we are asking you to extract ` +
    `the most likely SOAP operations from the code below.\n\n` +
    `Source files:\n\n${sourceSnippets}${truncationNotice}\n\n` +
    `Return ONLY a JSON array matching this schema, with no surrounding prose:\n\n` +
    `${PROPOSE_ENDPOINTS_OUTPUT_SCHEMA}\n\n` +
    `Confidence guidance: 0.9+ when SOAPAction header + DTO class are both clearly named; ` +
    `0.5-0.7 when the operation name is inferred from method name; <0.4 when guessing.`
  );
}

const SYSTEM_PROMPT =
  'You are an expert reverse-engineer of legacy SOAP service Java code. ' +
  'You receive Java source files and must return a strict JSON array of ' +
  'proposed SOAP operations matching the supplied schema. No prose, no ' +
  'markdown -- the response body must be valid JSON parseable by JSON.parse().';

const RETRY_PRELUDE =
  'Your previous response was malformed: it could not be parsed as a JSON ' +
  'array of objects matching the schema below. Please respond ONLY with a ' +
  'valid JSON array per the schema. Do not include markdown fences.';

// ---------------------------------------------------------------------------
// Default dependency implementations
// ---------------------------------------------------------------------------

/**
 * Default source-file fetcher: GETs from discovery-service's
 * `GET /discovery/projects/:p/architectures/:a/runs/:runId/source/<path>`
 * endpoint. Returns `{ evicted: true }` on HTTP 410.
 */
async function defaultFetchSource(args: {
  projectId: string;
  architectureId: string;
  runId: string;
  path: string;
}): Promise<SourceFetchResult> {
  const baseUrl =
    process.env.DISCOVERY_SERVICE_URL || 'http://localhost:8091';
  const url =
    `${baseUrl.replace(/\/+$/, '')}/discovery/projects/${encodeURIComponent(args.projectId)}` +
    `/architectures/${encodeURIComponent(args.architectureId)}/runs/${encodeURIComponent(args.runId)}` +
    `/source/${args.path.split('/').map(encodeURIComponent).join('/')}`;
  try {
    const resp = await axios.get<string>(url, {
      responseType: 'text',
      transformResponse: (d) => d,
      validateStatus: () => true,
    });
    if (resp.status === 200) {
      return { ok: true, content: String(resp.data ?? ''), path: args.path };
    }
    if (resp.status === 410) {
      return { ok: false, evicted: true, path: args.path };
    }
    if (resp.status === 404) {
      return { ok: false, note: 'file_not_found', path: args.path };
    }
    return {
      ok: false,
      note: `fetch_failed_status_${resp.status}`,
      path: args.path,
    };
  } catch (err) {
    return {
      ok: false,
      note: `fetch_threw_${err instanceof Error ? err.message : String(err)}`,
      path: args.path,
    };
  }
}

/** No-op finding emitter -- Group 6 will swap this for the real wire path. */
async function defaultEmitFinding(_input: FindingEmitInputShape): Promise<void> {
  // Default behaviour: emit a diagnostic log line so the malformed-twice
  // failure leaves a breadcrumb even when no finding-emit wiring has been
  // installed by the caller.
  console.log(
    `[diag-amvs] llm_endpoint_extract finding_emit_skipped reason=no_emitter_provided`,
  );
}

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

/**
 * Parse the LLM's assistant message content into the strict
 * `ProposedOperation[]` shape. Tolerates a single layer of markdown-fence
 * wrapping (` ```json ... ``` `) because some LLMs ignore the "no markdown"
 * instruction. Returns `null` when the content cannot be parsed into the
 * expected shape -- the caller retries on `null`.
 */
export function parseAndValidateOutput(
  content: string | null,
): ProposedOperation[] | null {
  if (!content || typeof content !== 'string') return null;
  // Strip markdown code-fence wrapper if present (defensive: spec says no
  // markdown, but some models add it anyway).
  let raw = content.trim();
  const fenceMatch = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) raw = fenceMatch[1].trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const out: ProposedOperation[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') return null;
    const e = entry as Record<string, unknown>;
    if (typeof e.operationName !== 'string' || e.operationName.length === 0) {
      return null;
    }
    if (typeof e.confidence !== 'number' || !Number.isFinite(e.confidence)) {
      return null;
    }
    const op: ProposedOperation = {
      operationName: e.operationName,
      confidence: e.confidence,
    };
    if (typeof e.soapAction === 'string') op.soapAction = e.soapAction;
    if (typeof e.path === 'string') op.path = e.path;
    if (typeof e.requestRootElement === 'string') {
      op.requestRootElement = e.requestRootElement;
    }
    if (typeof e.responseRootElement === 'string') {
      op.responseRootElement = e.responseRootElement;
    }
    if (typeof e.requestDtoClass === 'string') {
      op.requestDtoClass = e.requestDtoClass;
    }
    if (typeof e.responseDtoClass === 'string') {
      op.responseDtoClass = e.responseDtoClass;
    }
    out.push(op);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Confidence-tier filter (W-8)
// ---------------------------------------------------------------------------

interface ConfidenceFilterResult {
  kept: ProposedOperation[];
  droppedLowConfidence: number;
}

function applyConfidenceTiers(
  ops: ProposedOperation[],
  interfaceCandidateId: string,
): ConfidenceFilterResult {
  const kept: ProposedOperation[] = [];
  let dropped = 0;
  for (const op of ops) {
    if (op.confidence < CONFIDENCE_DROP_THRESHOLD) {
      dropped += 1;
      console.log(
        `[diag-amvs] llm_endpoint_extract action=dropped reason=low_confidence ` +
          `interface=${interfaceCandidateId} operation=${op.operationName} ` +
          `confidence=${op.confidence}`,
      );
      continue;
    }
    if (op.confidence < CONFIDENCE_LOW_THRESHOLD) {
      kept.push({ ...op, confidence_tier: 'low' });
    } else {
      kept.push({ ...op, confidence_tier: 'default' });
    }
  }
  return { kept, droppedLowConfidence: dropped };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Drive the propose-endpoints-from-code flow end-to-end. See module header
 * for the full contract.
 */
export async function proposeEndpointsFromCode(
  args: ProposeEndpointsArgs,
  deps: ProposeEndpointsDeps = {},
): Promise<ProposeEndpointsResult> {
  const gatewayClient = deps.gatewayClient ?? defaultGatewayClient;
  const fetchSource = deps.fetchSource ?? defaultFetchSource;
  const emitFinding = deps.emitFinding ?? defaultEmitFinding;

  const {
    interfaceCandidateId,
    parentServiceName,
    parentInterfaceName,
    runId,
    projectId,
    architectureId,
    sessionId,
    sourceFilePaths,
    inlineSnippets,
    model,
  } = args;

  const warnings: string[] = [];

  console.log(
    `[diag-amvs] llm_endpoint_extract start interface=${interfaceCandidateId} ` +
      `files=${sourceFilePaths.length}`,
  );

  // -------------------------------------------------------------------------
  // Step 1: Resolve source content (inlineSnippets shortcut OR fetch from
  // discovery-service). 410-Gone short-circuits the whole tool (W-17).
  // -------------------------------------------------------------------------
  const sources: Array<{ path: string; content: string }> = [];
  for (const path of sourceFilePaths) {
    if (inlineSnippets && Object.prototype.hasOwnProperty.call(inlineSnippets, path)) {
      sources.push({ path, content: inlineSnippets[path] });
      continue;
    }
    const fetched = await fetchSource({ projectId, architectureId, runId, path });
    if (fetched.evicted) {
      console.log(
        `[diag-amvs] llm_endpoint_extract result=clone_evicted runId=${runId} ` +
          `interface=${interfaceCandidateId}`,
      );
      return {
        operations: [],
        warnings: [
          `Source no longer cached -- discovery-service returned 410 Gone for runId=${runId}.`,
        ],
        cloneEvicted: true,
      };
    }
    if (fetched.ok && typeof fetched.content === 'string') {
      sources.push({ path, content: fetched.content });
    } else {
      warnings.push(
        `Skipped source file ${path}: ${fetched.note ?? 'unknown_fetch_failure'}.`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Step 2: Token-budget enforcement (W-7). The helper records the request
  // against the (sessionId, 'extract') ledger and reports per-call /
  // per-session truncation needs.
  // -------------------------------------------------------------------------
  let truncated = false;
  const initialPromptForEstimation = buildExtractionPrompt({
    parentInterfaceName,
    parentServiceName,
    sources,
    truncated: false,
  });
  const requestedTokens = estimateTokens(initialPromptForEstimation);
  const budget = recordAndCheck(sessionId, 'extract', requestedTokens);
  if (budget.allow === 'truncate') {
    truncated = true;
    warnings.push(budget.warning);
    // Translate the allowed-token budget back into a character budget and
    // distribute it proportionally across the inlined source files. Each
    // file is truncated to its share with the standard marker.
    const totalContentChars = sources.reduce((n, s) => n + s.content.length, 0);
    const allowedChars = Math.max(0, budget.maxAllowedTokens * 4);
    if (totalContentChars > allowedChars && totalContentChars > 0) {
      const ratio = allowedChars / totalContentChars;
      for (let i = 0; i < sources.length; i += 1) {
        const s = sources[i];
        const per = Math.floor(s.content.length * ratio);
        sources[i] = { ...s, content: truncateWithMarker(s.content, per) };
      }
    }
  }

  // -------------------------------------------------------------------------
  // Step 3: First LLM round-trip. Build the prompt (with truncation marker
  // when applicable), call the gateway, parse + validate the response.
  // -------------------------------------------------------------------------
  const baseMessages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: buildExtractionPrompt({
        parentInterfaceName,
        parentServiceName,
        sources,
        truncated,
      }),
    },
  ];
  // Empty tool list -- this is a single-shot completion call, not a
  // tool-loop. The gateway still accepts the relay shape.
  const tools: ToolDefinition[] = [];

  let parsed: ProposedOperation[] | null = null;
  let retries = 0;
  try {
    const first = await gatewayClient.callLlmToolLoop({
      messages: baseMessages,
      tools,
      toolChoice: 'none',
      model,
    });
    parsed = parseAndValidateOutput(first.message.content);
  } catch (err) {
    parsed = null;
    warnings.push(
      `LLM relay error on first attempt: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // -------------------------------------------------------------------------
  // Step 4: Retry on malformed output (W-9). One automatic retry with the
  // schema re-stated and the "your previous response was malformed" prelude.
  // -------------------------------------------------------------------------
  if (parsed === null) {
    retries = 1;
    console.log(
      `[diag-amvs] llm_endpoint_extract retry=1 reason=schema_violation ` +
        `interface=${interfaceCandidateId}`,
    );
    const retryMessages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: buildExtractionPrompt({
          parentInterfaceName,
          parentServiceName,
          sources,
          truncated,
          retryPrelude: RETRY_PRELUDE,
        }),
      },
    ];
    try {
      const second = await gatewayClient.callLlmToolLoop({
        messages: retryMessages,
        tools,
        toolChoice: 'none',
        model,
      });
      parsed = parseAndValidateOutput(second.message.content);
    } catch (err) {
      parsed = null;
      warnings.push(
        `LLM relay error on retry: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Step 5: If still malformed after the retry, emit the evidence_gap
  // finding (W-9) and return zero operations. NEVER cascade-fail the run.
  // -------------------------------------------------------------------------
  if (parsed === null) {
    console.log(
      `[diag-amvs] llm_endpoint_extract result=malformed retries=2 ` +
        `interface=${interfaceCandidateId}`,
    );
    warnings.push(
      `LLM extraction failed -- malformed output on both attempts. ` +
        `One evidence_gap finding was emitted (gapType=llm_endpoint_extract_malformed).`,
    );
    try {
      await emitFinding({
        findingType: 'evidence_gap',
        category: 'evidence_gap',
        severity: 'medium',
        title: `Evidence gap: ${interfaceCandidateId} -- llm_endpoint_extract_malformed`,
        summary:
          'LLM returned invalid JSON on both the initial attempt and the schema-violation retry.',
        detailJson: {
          gapType: 'llm_endpoint_extract_malformed',
          reason: 'LLM returned invalid JSON twice; schema_violation',
          interfaceShortId: interfaceCandidateId,
        },
        source: 'pipeline_evidence_gap',
        createdByStage: 'amvs.llmEndpointExtract',
        links: [
          {
            linkType: 'supports',
            targetType: 'discovery_candidate',
            targetId: interfaceCandidateId,
          },
        ],
      });
    } catch (emitErr) {
      // Per W-9: NEVER cascade-fail. The finding-emit error is logged and
      // the tool still returns the malformed result to the caller.
      console.error(
        `[diag-amvs] llm_endpoint_extract finding_emit_failed ` +
          `interface=${interfaceCandidateId} ` +
          `error=${emitErr instanceof Error ? emitErr.message : String(emitErr)}`,
      );
    }
    return { operations: [], warnings, malformed: true };
  }

  // -------------------------------------------------------------------------
  // Step 6: Apply the W-8 confidence tiers, log the success summary, and
  // return.
  // -------------------------------------------------------------------------
  const filtered = applyConfidenceTiers(parsed, interfaceCandidateId);
  console.log(
    `[diag-amvs] llm_endpoint_extract result=ok ` +
      `operations=${filtered.kept.length} ` +
      `dropped_low_confidence=${filtered.droppedLowConfidence} ` +
      `truncated=${truncated} retries=${retries} ` +
      `interface=${interfaceCandidateId}`,
  );
  return { operations: filtered.kept, warnings };
}

// ---------------------------------------------------------------------------
// Tool registry entry
// ---------------------------------------------------------------------------

/**
 * Registry entry for module-shape parity with `list_oas_operations.ts` and
 * `get_oas_operation_detail.ts`. The tool is NOT registered in the
 * capture-loop's `ALL_TOOLS` array because its invocation point is the
 * Step 4 "Extract endpoints with LLM" button (Group 6), not a per-scenario
 * LLM round-trip.
 *
 * The handler exposed here is a thin adapter that reshapes the
 * tool-call-style argument bag into `ProposeEndpointsArgs` and invokes
 * `proposeEndpointsFromCode`. Future revisions may wire this tool into the
 * capture-loop registry if the LLM benefits from issuing extractions as
 * tool calls inside a wider scenario.
 */
export const proposeEndpointsFromCodeTool: ToolRegistryEntry = {
  name: 'propose_endpoints_from_code',
  description:
    'Propose SOAP endpoint operations from cached Java source files when the ' +
    'deterministic framework scanner emitted zero candidates. Reads source via ' +
    'discovery-service, applies the configured confidence tiers, and returns a ' +
    'list of operations + warnings.',
  parameters: {
    type: 'object',
    properties: {
      interfaceCandidateId: { type: 'string' },
      parentServiceId: { type: 'string' },
      parentServiceName: { type: 'string' },
      parentInterfaceName: { type: 'string' },
      runId: { type: 'string' },
      projectId: { type: 'string' },
      architectureId: { type: 'string' },
      sessionId: { type: 'string' },
      sourceFilePaths: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: [
      'interfaceCandidateId',
      'parentServiceId',
      'parentServiceName',
      'parentInterfaceName',
      'runId',
      'projectId',
      'architectureId',
      'sessionId',
      'sourceFilePaths',
    ],
    additionalProperties: false,
  },
  handler: async (rawArgs) => {
    const args = rawArgs as unknown as ProposeEndpointsArgs;
    return proposeEndpointsFromCode(args);
  },
};
