/**
 * OPTIONAL per-endpoint response-contract ENRICHMENT stage.
 *
 * Spec: 2026-05-30 Per-endpoint response-contract capture for discovery
 * (Java / Spring Classic first) -- Task Group 2 (sub-task 2.6).
 *
 * A NEW sibling of `llmBehaviourCaptureStep.ts`. The DETERMINISTIC
 * `responseContractScanner` (always-on, in the springClassic adapter) fills the
 * statically-knowable contract fields and attaches a `response_contract` blob to
 * each `endpoints` candidate's `data`. This stage fills ONLY the prose/semantic
 * sub-fields the static pass cannot read:
 *   - `error_responses[].body_shape`
 *   - `conditional_variants[].response_summary`
 *   - `validation[].message`        (interpolation, when the template has params)
 *   - `serialization.envelope`       (bare object | wrapped { data } | list | page)
 *
 * It NEVER overwrites a statically-filled value with a guess and NEVER changes
 * the contract's deterministic `confidence`; it only fills gaps.
 *
 * It REUSES the behaviour-capture conventions verbatim rather than re-inventing
 * them:
 *   - the gateway relay (`gatewayClient.enrichResponseContract`) at
 *     `temperature: 0` -- NEVER a direct LLM call from discovery;
 *   - the hand-rolled `promisePool` concurrency limiter (env-tunable);
 *   - `getConfidenceForTag('llm-response-contract', ...)` for clamp/midpoint;
 *   - a per-run METHOD cap + per-run TOKEN ceiling (skip, not fail, past either);
 *   - a `failures[]` + max-failure-rate gate that flips the stage to `failed`.
 *
 * The deterministic spine BOUNDS the enrichment set: only endpoint candidates
 * that already carry a `response_contract` are eligible, and only those with at
 * least one empty prose sub-field are sent to the LLM (the rest are skipped).
 *
 * TIER-GATED exactly like `llmBehaviourCaptureStep` -- NOT an off-by-default
 * opt-in flag. The caller (`discoveryV3Pipeline`) gates the invocation; the env
 * override `RESPONSE_CONTRACT_TIERS` widens / narrows the gate.
 */

import {
  gatewayClient,
  ResponseContractGatewayError,
} from './gatewayClient';
import { getConfidenceForTag } from './confidence';
import type { DiscoveryCandidate } from '../types/candidate';

const CONFIDENCE_TAG = 'llm-response-contract';

// ============================================================================
// Env-tunable defaults (mirror llmBehaviourCaptureStep)
// ============================================================================

/** Concurrent in-flight LLM calls. */
const DEFAULT_CONCURRENCY = 2;
/** Per-run cap on the number of endpoints sent to the LLM. */
const DEFAULT_ENDPOINT_CAP = 200;
/** Per-run estimated-token ceiling; remaining endpoints are SKIPPED past it. */
const DEFAULT_TOKEN_CEILING = 400_000;
/** Failure-rate gate (over endpoints that actually attempted the LLM). */
const DEFAULT_MAX_FAILURE_RATE = 0.2;

function readIntEnv(name: string, fallback: number, min = 1): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

function readRateEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

function readConcurrency(): number {
  return readIntEnv('RESPONSE_CONTRACT_CONCURRENCY', DEFAULT_CONCURRENCY);
}
function readEndpointCap(): number {
  return readIntEnv('RESPONSE_CONTRACT_MAX_ENDPOINTS', DEFAULT_ENDPOINT_CAP, 0);
}
function readTokenCeiling(): number {
  return readIntEnv('RESPONSE_CONTRACT_TOKEN_CEILING', DEFAULT_TOKEN_CEILING, 0);
}
function readMaxFailureRate(): number {
  return readRateEnv('RESPONSE_CONTRACT_MAX_FAILURE_RATE', DEFAULT_MAX_FAILURE_RATE);
}

// ============================================================================
// Input / output types
// ============================================================================

export interface ResponseContractEnrichInput {
  runId: string;
  /** Run tier -- the caller only invokes when tier-gating admits the stage. */
  tier: 'A' | 'B' | 'C';
  /**
   * The `endpoints` candidates from the run. Only those carrying a
   * deterministic `data.response_contract` with at least one empty prose
   * sub-field are eligible; the rest are ignored. Mutated in place.
   */
  endpointCandidates: DiscoveryCandidate[];
}

export interface ResponseContractEnrichFailure {
  endpointName: string;
  error: string;
}

export interface ResponseContractEnrichOutput {
  stageStatus: 'completed' | 'failed';
  /** Endpoints sent to the LLM and successfully enriched. */
  processed: number;
  /** Endpoints skipped (no gap to fill OR over the endpoint/token caps). */
  skipped: number;
  failures: ResponseContractEnrichFailure[];
  /** Total endpoints the selector admitted (before caps). */
  selectedCount: number;
}

// ============================================================================
// Selection: endpoints with a deterministic contract that has prose gaps.
// ============================================================================

interface ContractShape {
  schema_version?: unknown;
  error_responses?: Array<Record<string, unknown>>;
  validation?: Array<Record<string, unknown>>;
  serialization?: Record<string, unknown>;
  conditional_variants?: Array<Record<string, unknown>>;
  confidence?: unknown;
  [key: string]: unknown;
}

function getContract(candidate: DiscoveryCandidate): ContractShape | null {
  const data = (candidate.data ?? {}) as Record<string, unknown>;
  const rc = data.response_contract;
  if (rc && typeof rc === 'object' && !Array.isArray(rc)) {
    return rc as ContractShape;
  }
  return null;
}

/** True when the contract has at least one prose sub-field the LLM should fill. */
function hasProseGap(contract: ContractShape): boolean {
  for (const e of contract.error_responses ?? []) {
    if (e.body_shape === null || e.body_shape === undefined) return true;
  }
  for (const v of contract.conditional_variants ?? []) {
    if (v.response_summary === null || v.response_summary === undefined) return true;
  }
  const ser = contract.serialization;
  if (ser && (ser.envelope === null || ser.envelope === undefined)) return true;
  for (const val of contract.validation ?? []) {
    if (val.message === null || val.message === undefined) return true;
  }
  return false;
}

interface SelectedEndpoint {
  candidate: DiscoveryCandidate;
  contract: ContractShape;
  endpointName: string;
}

/**
 * Deterministic selector (no LLM judgement). An endpoint qualifies iff it
 * carries a deterministic `response_contract` AND that contract has at least
 * one empty prose sub-field. Pure.
 */
export function selectResponseContractEndpoints(
  endpointCandidates: DiscoveryCandidate[],
): SelectedEndpoint[] {
  const selected: SelectedEndpoint[] = [];
  for (const candidate of endpointCandidates) {
    if (candidate.candidateType !== 'endpoints') continue;
    const contract = getContract(candidate);
    if (!contract) continue;
    if (!hasProseGap(contract)) continue;
    selected.push({ candidate, contract, endpointName: candidate.name });
  }
  return selected;
}

// ============================================================================
// Prompt composition + response parsing
// ============================================================================

/**
 * Compose the enrichment prompt. Self-contained (the gateway relay is stateless
 * and injects no system prompt). Embeds the deterministic contract so the LLM
 * fills ONLY the prose sub-fields and returns STRICT JSON.
 */
export function composeResponseContractPrompt(sel: SelectedEndpoint): string {
  return [
    'You are a migration analyst. A deterministic scanner has captured the',
    'statically-knowable RESPONSE CONTRACT for ONE HTTP endpoint. Fill ONLY the',
    'prose/semantic sub-fields the scanner left null -- describe WHAT the response',
    'looks like, not framework specifics. Do NOT change any non-null value.',
    '',
    `Endpoint: ${sel.endpointName}`,
    '',
    'Return STRICT JSON only (no markdown, no prose outside the object) with these',
    'OPTIONAL keys (include only the ones you can fill):',
    '  "error_responses": [{ "exception": <string, matches the input>, "body_shape": <string> }]',
    '       // describe the JSON body each error returns (fields + meaning)',
    '  "conditional_variants": [{ "condition": <string, matches the input>, "response_summary": <string> }]',
    '       // describe how the response differs under each config condition',
    '  "validation": [{ "field": <string, matches the input>, "message": <string> }]',
    '       // the human-facing validation message, with any {param} interpolation resolved',
    '  "serialization": { "envelope": "bare object" | "wrapped { data: ... }" | "list" | "page" | null }',
    'Also include "confidence": number in [0,1].',
    'Use null / omit keys for parts you cannot determine. Do not fabricate.',
    '',
    '=== DETERMINISTIC CONTRACT (fill the null prose fields) ===',
    JSON.stringify(sel.contract, null, 2),
  ].join('\n');
}

export function parseEnrichmentResponse(content: string): Record<string, unknown> {
  let text = (content ?? '').trim();
  if (text.length === 0) {
    throw new Error('Response-contract enrichment LLM response was empty');
  }
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text);
  if (fence) text = fence[1].trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Response-contract enrichment response was not valid JSON: ${msg}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Response-contract enrichment response JSON was not an object');
  }
  return parsed as Record<string, unknown>;
}

// ============================================================================
// Merge: fill ONLY the null prose sub-fields (never overwrite static values).
// ============================================================================

/**
 * Merge an LLM enrichment object into the deterministic contract, filling ONLY
 * prose sub-fields that are currently null/undefined. Never overwrites a
 * statically-filled value, never changes the deterministic `confidence`.
 * Mutates the contract in place. Returns true when at least one field was filled.
 */
export function mergeEnrichment(
  contract: ContractShape,
  enrichment: Record<string, unknown>,
): boolean {
  let filled = false;

  const fillNull = (
    obj: Record<string, unknown>,
    key: string,
    value: unknown,
  ): void => {
    if (
      (obj[key] === null || obj[key] === undefined) &&
      typeof value === 'string' &&
      value.trim().length > 0
    ) {
      obj[key] = value;
      filled = true;
    }
  };

  // error_responses[].body_shape, matched by exception name.
  if (Array.isArray(enrichment.error_responses)) {
    for (const e of enrichment.error_responses as Array<Record<string, unknown>>) {
      const target = (contract.error_responses ?? []).find(
        (c) => c.exception === e.exception,
      );
      if (target) fillNull(target, 'body_shape', e.body_shape);
    }
  }
  // conditional_variants[].response_summary, matched by condition.
  if (Array.isArray(enrichment.conditional_variants)) {
    for (const v of enrichment.conditional_variants as Array<Record<string, unknown>>) {
      const target = (contract.conditional_variants ?? []).find(
        (c) => c.condition === v.condition,
      );
      if (target) fillNull(target, 'response_summary', v.response_summary);
    }
  }
  // validation[].message, matched by field + constraint when present.
  if (Array.isArray(enrichment.validation)) {
    for (const val of enrichment.validation as Array<Record<string, unknown>>) {
      const target = (contract.validation ?? []).find((c) => c.field === val.field);
      if (target) fillNull(target, 'message', val.message);
    }
  }
  // serialization.envelope.
  const ser = contract.serialization;
  const enrSer = enrichment.serialization;
  if (ser && enrSer && typeof enrSer === 'object' && !Array.isArray(enrSer)) {
    fillNull(ser, 'envelope', (enrSer as Record<string, unknown>).envelope);
  }

  return filled;
}

// ============================================================================
// Concurrency pool (hand-rolled, mirrors llmBehaviourCaptureStep)
// ============================================================================

async function promisePool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers: Promise<void>[] = [];
  const effectiveLimit = Math.max(1, Math.min(limit, items.length || 1));
  for (let w = 0; w < effectiveLimit; w += 1) {
    workers.push(
      (async () => {
        while (true) {
          const i = cursor;
          cursor += 1;
          if (i >= items.length) return;
          results[i] = await worker(items[i], i);
        }
      })(),
    );
  }
  await Promise.all(workers);
  return results;
}

// ============================================================================
// Per-endpoint processing
// ============================================================================

interface PreparedEndpoint {
  selected: SelectedEndpoint;
  prompt: string;
  estTokens: number;
}

type PerEndpointResult =
  | { kind: 'processed'; endpointName: string; selected: SelectedEndpoint; enrichment: Record<string, unknown> }
  | { kind: 'failure'; endpointName: string; error: string };

async function processEndpoint(
  prepared: PreparedEndpoint,
  runId: string,
): Promise<PerEndpointResult> {
  const { selected, prompt } = prepared;
  let content: string;
  try {
    const response = await gatewayClient.enrichResponseContract(
      prompt,
      selected.endpointName,
      runId,
    );
    content = response?.content ?? '';
  } catch (err) {
    const message =
      err instanceof ResponseContractGatewayError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    return { kind: 'failure', endpointName: selected.endpointName, error: message };
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = parseEnrichmentResponse(content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'failure', endpointName: selected.endpointName, error: message };
  }
  return { kind: 'processed', endpointName: selected.endpointName, selected, enrichment: parsed };
}

// ============================================================================
// Public entry point
// ============================================================================

/**
 * Run the per-endpoint response-contract enrichment stage. Mutates the selected
 * `endpoints` candidates IN PLACE, filling the null prose sub-fields of their
 * `data.response_contract`. The caller is responsible for tier-gating (only
 * invoking when the run tier admits the stage) and for persisting metrics.
 */
export async function runResponseContractEnrichment(
  input: ResponseContractEnrichInput,
): Promise<ResponseContractEnrichOutput> {
  const { runId } = input;
  const concurrency = readConcurrency();
  const endpointCap = readEndpointCap();
  const tokenCeiling = readTokenCeiling();
  const maxFailureRate = readMaxFailureRate();

  const selected = selectResponseContractEndpoints(input.endpointCandidates);

  console.log(
    `[ResponseContract] Stage start: runId=${runId}, tier=${input.tier}, ` +
      `selected=${selected.length}, endpointCap=${endpointCap}, tokenCeiling=${tokenCeiling}, ` +
      `concurrency=${concurrency}, maxFailureRate=${maxFailureRate}`,
  );

  let skipped = 0;
  const failures: ResponseContractEnrichFailure[] = [];

  // 1) Prepare each endpoint, honouring the per-run endpoint + token caps.
  const toCall: PreparedEndpoint[] = [];
  let cumulativeTokens = 0;
  for (const sel of selected) {
    if (endpointCap > 0 && toCall.length >= endpointCap) {
      skipped += 1;
      continue;
    }
    const prompt = composeResponseContractPrompt(sel);
    const estTokens = Math.ceil(prompt.length / 4);
    if (tokenCeiling > 0 && cumulativeTokens + estTokens > tokenCeiling) {
      skipped += 1;
      continue;
    }
    cumulativeTokens += estTokens;
    toCall.push({ selected: sel, prompt, estTokens });
  }

  // 2) Fire the LLM calls under the concurrency pool.
  const results = await promisePool<PreparedEndpoint, PerEndpointResult>(
    toCall,
    concurrency,
    (prepared) => processEndpoint(prepared, runId),
  );

  let processed = 0;
  for (const r of results) {
    if (r.kind === 'failure') {
      failures.push({ endpointName: r.endpointName, error: r.error });
      continue;
    }
    const filled = mergeEnrichment(r.selected.contract, r.enrichment);
    // Clamp the contract confidence into the enrichment tag range ONLY if the
    // deterministic pass left it null (never lower a proven static confidence).
    const contract = r.selected.contract;
    if (contract.confidence === null || contract.confidence === undefined) {
      const rawConf =
        typeof r.enrichment.confidence === 'number'
          ? (r.enrichment.confidence as number)
          : undefined;
      contract.confidence = getConfidenceForTag(CONFIDENCE_TAG, rawConf);
    }
    if (filled) processed += 1;
    else skipped += 1;
  }

  // 3) Failure-rate gate over endpoints that ATTEMPTED the LLM.
  const attempted = toCall.length;
  const failureRate = attempted > 0 ? failures.length / attempted : 0;
  const stageStatus: 'completed' | 'failed' =
    failureRate > maxFailureRate ? 'failed' : 'completed';

  console.log(
    `[ResponseContract] Stage done: runId=${runId}, selected=${selected.length}, ` +
      `processed=${processed}, skipped=${skipped}, failures=${failures.length}, ` +
      `failureRate=${failureRate.toFixed(3)}, status=${stageStatus}`,
  );

  return {
    stageStatus,
    processed,
    skipped,
    failures,
    selectedCount: selected.length,
  };
}
