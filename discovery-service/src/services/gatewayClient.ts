import axios, { AxiosInstance, AxiosError } from 'axios';
import { GATEWAY_BASE_URL } from '../config';
import { DecisionTask, DecisionTaskOutput } from '../types/decisionTask';

/**
 * Maximum number of tasks per batch sent to the gateway.
 * Each task requires an LLM call (~5-10s). A batch of 50 takes ~4-8 minutes,
 * well within the per-request timeout.
 */
const BATCH_SIZE = 50;

/**
 * Result shape for each resolved decision task from the gateway.
 */
export interface DecisionTaskResolutionResult {
  taskId: string;
  status: 'resolved' | 'failed';
  outputData: DecisionTaskOutput | null;
  error: string | null;
}

/**
 * Response shape from the gateway's decision task resolution endpoint.
 */
export interface ResolveDecisionTasksResponse {
  results: DecisionTaskResolutionResult[];
}

// ============================================================================
// V3 Gap-Fill Types
// Spec 2026-04-19: V3 Layered Prompt System (Task Group 3)
// ============================================================================

/**
 * Response shape returned by the V3 gap-fill relay endpoint.
 *
 * `content` is the raw LLM text output (expected to be a JSON array per the
 * layered-prompt schema contract). JSON-schema validation and candidate
 * parsing happen in the caller (llmGapFillStep), not here.
 */
export interface GapFillResponse {
  /** Raw LLM response content -- typically a JSON array of candidates. */
  content: string;
  /** Optional token-usage passthrough from the LLM client. */
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

/**
 * Typed error class for V3 gap-fill failures.
 *
 * llmGapFillStep catches these per-file and records them on
 * steps_payload.gapFill.failures[] without halting the run.
 */
export class GapFillGatewayError extends Error {
  public readonly filePath: string;
  public readonly status: number | null;
  public readonly cause?: unknown;

  constructor(message: string, filePath: string, status: number | null, cause?: unknown) {
    super(message);
    this.name = 'GapFillGatewayError';
    this.filePath = filePath;
    this.status = status;
    this.cause = cause;
  }
}

// ============================================================================
// Behaviour-Capture Types
// Spec 2026-05-29: Business-logic behaviour capture for discovery (Gap C),
// Task Group 2.
// ============================================================================

/**
 * Response shape returned by the behaviour-capture relay endpoint. Identical
 * to {@link GapFillResponse}; aliased for call-site readability — `content`
 * is the raw LLM text output (expected to be the documented 7-part JSON
 * block). Parsing + validation happen in the caller (llmBehaviourCaptureStep).
 */
export type BehaviourCaptureResponse = GapFillResponse;

/**
 * Typed error class for behaviour-capture relay failures.
 *
 * `llmBehaviourCaptureStep` catches these per-method and records them on
 * `steps_payload.v3.behaviourCapture.failures[]` without halting the run
 * (mirrors {@link GapFillGatewayError}). Carries the stable `methodId` for
 * correlation rather than a file path.
 */
export class BehaviourCaptureGatewayError extends Error {
  public readonly methodId: string;
  public readonly status: number | null;
  public readonly cause?: unknown;

  constructor(message: string, methodId: string, status: number | null, cause?: unknown) {
    super(message);
    this.name = 'BehaviourCaptureGatewayError';
    this.methodId = methodId;
    this.status = status;
    this.cause = cause;
  }
}

// ============================================================================
// Log-Recipe Induction Types
// Spec 2026-06-20: Runtime Log Evidence -- Format-Agnostic Extraction (Task Group 5).
// ============================================================================

/**
 * Response shape returned by the log-recipe induction relay. Identical to
 * {@link GapFillResponse}; aliased for call-site readability -- `content` is the
 * raw LLM text output (a STRUCTURED RECIPE JSON object or the literal
 * "no pattern"). Parsing + held-out validation happen in the caller
 * (`logRecipeInduction.induceAndValidateRecipe`).
 */
export type LogRecipeResponse = GapFillResponse;

/**
 * Typed error class for log-recipe induction relay failures.
 *
 * `induceAndValidateRecipe` catches these per-file and treats the attempt as a
 * consumed (bounded) call that falls through to retry / deterministic fallback,
 * without halting the run (mirrors {@link BehaviourCaptureGatewayError}).
 * Carries the stable source `filePath` for correlation.
 */
export class LogRecipeGatewayError extends Error {
  public readonly filePath: string;
  public readonly status: number | null;
  public readonly cause?: unknown;

  constructor(message: string, filePath: string, status: number | null, cause?: unknown) {
    super(message);
    this.name = 'LogRecipeGatewayError';
    this.filePath = filePath;
    this.status = status;
    this.cause = cause;
  }
}

// ============================================================================
// Operational-Artifact Summariser Types
// Spec 2026-06-14: Generic Operational-Artifact Discovery (D1), Task Group 3.
// ============================================================================

/**
 * Response shape returned by the operational-artifact summariser relay. Identical
 * to {@link GapFillResponse}; aliased for call-site readability -- `content` is
 * the raw LLM text output (expected to be the strict summariser JSON object).
 * Parsing + validation happen in the caller (`operationalArtifactScanStep`).
 */
export type OperationalArtifactResponse = GapFillResponse;

/**
 * Typed error class for operational-artifact summariser relay failures.
 *
 * `operationalArtifactScanStep` catches these per-file and records them on a
 * `failures[]` list without halting the run (mirrors {@link GapFillGatewayError}).
 * Carries the stable `filePath` for correlation.
 */
export class OperationalArtifactGatewayError extends Error {
  public readonly filePath: string;
  public readonly status: number | null;
  public readonly cause?: unknown;

  constructor(message: string, filePath: string, status: number | null, cause?: unknown) {
    super(message);
    this.name = 'OperationalArtifactGatewayError';
    this.filePath = filePath;
    this.status = status;
    this.cause = cause;
  }
}

// ============================================================================
// Capability-Naming Types
// Spec 2026-06-14: D2 -- Capability Synthesis + Batch Spines, Task Group 4.
// ============================================================================

/**
 * Response shape returned by the capability-naming relay. Identical to
 * {@link GapFillResponse}; aliased for call-site readability -- `content` is the
 * raw LLM text output (expected to be the strict `{ name, summary, kind }`
 * object). Parsing + validation happen in the caller (`capabilitySynthesisStep`).
 */
export type CapabilityNamingResponse = GapFillResponse;

/**
 * Typed error class for capability-naming relay failures.
 *
 * `capabilitySynthesisStep` catches these per-seed and falls back to a
 * deterministic name (the synthesis never fails the run; the LLM is naming-only
 * and membership is already fixed). Carries the deterministic `seedKey` for
 * correlation rather than a file path.
 */
export class CapabilityNamingGatewayError extends Error {
  public readonly seedKey: string;
  public readonly status: number | null;
  public readonly cause?: unknown;

  constructor(message: string, seedKey: string, status: number | null, cause?: unknown) {
    super(message);
    this.name = 'CapabilityNamingGatewayError';
    this.seedKey = seedKey;
    this.status = status;
    this.cause = cause;
  }
}

// ============================================================================
// Response-Contract Enrichment Types
// Spec 2026-05-30: Per-endpoint response-contract capture (Spec 1),
// Task Group 2.
// ============================================================================

/**
 * Response shape returned by the response-contract-enrichment relay endpoint.
 * Identical to {@link GapFillResponse} / {@link BehaviourCaptureResponse};
 * aliased for call-site readability -- `content` is the raw LLM text output
 * (expected to be a JSON object of prose/semantic sub-fields). Parsing +
 * validation happen in the caller (`responseContractEnrichmentStep`).
 */
export type ResponseContractEnrichResponse = GapFillResponse;

/**
 * Typed error class for response-contract-enrichment relay failures.
 *
 * `responseContractEnrichmentStep` catches these per-endpoint and records them
 * on `steps_payload.v3.responseContract.failures[]` without halting the run
 * (mirrors {@link BehaviourCaptureGatewayError}). Carries the stable
 * `endpointName` for correlation rather than a file path.
 */
export class ResponseContractGatewayError extends Error {
  public readonly endpointName: string;
  public readonly status: number | null;
  public readonly cause?: unknown;

  constructor(message: string, endpointName: string, status: number | null, cause?: unknown) {
    super(message);
    this.name = 'ResponseContractGatewayError';
    this.endpointName = endpointName;
    this.status = status;
    this.cause = cause;
  }
}

// ============================================================================
// Tech Hints LLM Error
// Spec 2026-04-20: Tech Hints LLM Resolution (Task Group 2)
// ============================================================================

/**
 * Typed error class for tech-hints LLM failures.
 *
 * Carries a `reason` tag so the resolver can translate it into the spec's
 * structured error taxonomy (`llm_timeout`, `network_error`, etc.) and
 * emit a single structured log line.
 */
export class TechHintsLlmError extends Error {
  public readonly reason: 'llm_timeout' | 'network_error' | 'llm_malformed';
  public readonly status: number | null;

  constructor(
    message: string,
    reason: 'llm_timeout' | 'network_error' | 'llm_malformed',
    status: number | null,
  ) {
    super(message);
    this.name = 'TechHintsLlmError';
    this.reason = reason;
    this.status = status;
  }
}

/**
 * HTTP client for communicating with the gateway service.
 * Provides methods for DecisionTask resolution and V3 gap-fill relay
 * via the gateway's endpoints.
 *
 * Kept separate from archModelClient to maintain clear separation of concerns
 * between architecture-model-service calls and gateway calls.
 */
class GatewayClient {
  private readonly client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: GATEWAY_BASE_URL,
      timeout: 7200000, // 120 minutes — large batches with many LLM calls need extended time
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    // Log response body on HTTP errors for diagnosability
    this.client.interceptors.response.use(
      response => response,
      (error: AxiosError) => {
        if (error.response) {
          const { status, config } = error.response;
          const method = config?.method?.toUpperCase() || '?';
          const url = config?.url || '?';
          const body = error.response.data;
          const bodySnippet = typeof body === 'string'
            ? body.substring(0, 500)
            : JSON.stringify(body).substring(0, 500);
          console.error(
            `[GatewayClient] ${method} ${url} returned ${status}: ${bodySnippet}`
          );
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Sends pending decision tasks to the gateway for LLM resolution in batches.
   *
   * Large task sets are automatically chunked into batches of BATCH_SIZE to
   * avoid HTTP timeout issues (the gateway processes tasks sequentially).
   * Results from all batches are concatenated into a single response.
   *
   * @param projectId - The project UUID
   * @param runId - The discovery run UUID
   * @param tasks - The decision tasks to resolve (should have status 'pending')
   * @returns Promise resolving to the concatenated resolution results
   * @throws AxiosError with status code preserved for caller handling
   */
  async resolveDecisionTasks(
    projectId: string,
    runId: string,
    tasks: DecisionTask[]
  ): Promise<ResolveDecisionTasksResponse> {
    if (tasks.length === 0) {
      console.log(`[GatewayClient] resolveDecisionTasks called with 0 tasks, returning empty`);
      return { results: [] };
    }

    const overallStart = Date.now();
    console.log(`[GatewayClient] resolveDecisionTasks: ${tasks.length} tasks, gateway=${GATEWAY_BASE_URL}`);

    // Split into batches
    const allResults: DecisionTaskResolutionResult[] = [];
    const totalBatches = Math.ceil(tasks.length / BATCH_SIZE);

    for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
      const batch = tasks.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const batchStart = Date.now();

      const payloadSize = JSON.stringify({ projectId, runId, tasks: batch }).length;
      console.log(
        `[GatewayClient] Decision task batch ${batchNum}/${totalBatches}: ${batch.length} tasks, payload ${Math.round(payloadSize / 1024)}KB, sending...`
      );

      const response = await this.client.post<ResolveDecisionTasksResponse>(
        '/api/v1/discovery/resolve-decision-tasks',
        { projectId, runId, tasks: batch }
      );

      const batchDuration = Date.now() - batchStart;
      allResults.push(...response.data.results);

      const resolved = response.data.results.filter(r => r.status === 'resolved').length;
      const failed = response.data.results.filter(r => r.status === 'failed').length;
      console.log(
        `[GatewayClient] Decision task batch ${batchNum}/${totalBatches} complete in ${batchDuration}ms (${Math.round(batchDuration / 1000)}s): ${resolved} resolved, ${failed} failed. Elapsed: ${Date.now() - overallStart}ms`
      );
    }

    const totalDuration = Date.now() - overallStart;
    const totalResolved = allResults.filter(r => r.status === 'resolved').length;
    const totalFailed = allResults.filter(r => r.status === 'failed').length;
    console.log(`[GatewayClient] resolveDecisionTasks complete in ${totalDuration}ms (${Math.round(totalDuration / 1000)}s): ${totalResolved} resolved, ${totalFailed} failed out of ${tasks.length} total`);

    return { results: allResults };
  }

  /**
   * POSTs a fully-assembled V3 gap-fill prompt to the gateway relay endpoint.
   *
   * Single-file, single-prompt per-call shape -- the caller (llmGapFillStep)
   * controls parallelism.
   *
   * The returned `content` is raw LLM output (typically a JSON array of
   * candidates). Schema validation and candidate parsing happen in the
   * caller; this method only handles transport + typed-error surfacing.
   *
   * Spec 2026-04-19: V3 Layered Prompt System (Task Group 3)
   *
   * @param prompt - The fully-assembled prompt composed by `composePrompt`
   * @param filePath - File path the prompt targets (logging / correlation)
   * @param runId - Discovery run ID (logging / correlation)
   * @returns Promise resolving to the LLM response ready for JSON-schema validation
   * @throws GapFillGatewayError on network failure or non-2xx HTTP response
   */
  async gapFill(
    prompt: string,
    filePath: string,
    runId: string
  ): Promise<GapFillResponse> {
    // Bug-1 fix (rate-limit handling 2026-04-21): on HTTP 429 the provider has
    // told us to back off. Retry up to 4 times with exponential backoff +
    // jitter, honouring any `Retry-After` hint the provider returned. On 5xx
    // we also retry (transient upstream errors). All other errors surface
    // immediately. The original error shape (GapFillGatewayError) is
    // preserved so the stage's failure bookkeeping is unchanged.
    const MAX_RETRIES = 4;
    const start = Date.now();
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        const response = await this.client.post<GapFillResponse>(
          '/api/v1/discovery/v3/gap-fill',
          { prompt, filePath, runId }
        );
        const durationMs = Date.now() - start;
        if (attempt > 0) {
          console.log(
            `[GatewayClient] gapFill ${filePath} recovered after ${attempt} retry(ies) in ${durationMs}ms`
          );
        } else {
          console.log(
            `[GatewayClient] gapFill ${filePath} complete in ${durationMs}ms, contentLen=${response.data?.content?.length ?? 0}`
          );
        }
        return {
          content: response.data?.content ?? '',
          usage: response.data?.usage,
        };
      } catch (error) {
        lastError = error;
        const axiosError = error as AxiosError;
        const status = axiosError.response?.status ?? null;
        const isRetryable = status === 429 || (status !== null && status >= 500 && status < 600);
        if (!isRetryable || attempt === MAX_RETRIES) {
          break;
        }
        // Respect `Retry-After` when the provider sends it (seconds OR HTTP-date).
        let waitMs: number;
        const retryAfter = axiosError.response?.headers?.['retry-after'];
        if (typeof retryAfter === 'string' && retryAfter.length > 0) {
          const asSeconds = Number(retryAfter);
          if (Number.isFinite(asSeconds) && asSeconds > 0) {
            waitMs = Math.min(asSeconds * 1000, 30_000);
          } else {
            const asDate = new Date(retryAfter).getTime();
            waitMs = Number.isFinite(asDate)
              ? Math.max(0, Math.min(asDate - Date.now(), 30_000))
              : 1000 * Math.pow(2, attempt);
          }
        } else {
          // Exponential backoff with jitter: 500ms, 1s, 2s, 4s (± up to 50%).
          const base = 500 * Math.pow(2, attempt);
          const jitter = Math.floor(Math.random() * (base * 0.5));
          waitMs = base + jitter;
        }
        console.warn(
          `[GatewayClient] gapFill ${filePath} got HTTP ${status}, retry ${attempt + 1}/${MAX_RETRIES} after ${waitMs}ms`
        );
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
    // Exhausted retries — surface the last error with the existing shape.
    const durationMs = Date.now() - start;
    const axiosError = lastError as AxiosError;
    const status = axiosError?.response?.status ?? null;
    const baseMessage = lastError instanceof Error ? lastError.message : 'Unknown gap-fill error';
    const message = status !== null
      ? `V3 gap-fill failed for ${filePath} (HTTP ${status}): ${baseMessage}`
      : `V3 gap-fill failed for ${filePath}: ${baseMessage}`;
    console.error(
      `[GatewayClient] gapFill ${filePath} FAILED after ${durationMs}ms: ${message}`
    );
    throw new GapFillGatewayError(message, filePath, status, lastError);
  }

  /**
   * POSTs a fully-assembled behaviour-capture prompt to the gateway relay.
   *
   * Sibling of {@link gapFill}: per-METHOD, single-prompt per-call shape --
   * the caller (`llmBehaviourCaptureStep`) controls parallelism via the same
   * hand-rolled `promisePool`. Reuses the gap-fill retry / backoff transport
   * pattern verbatim (429 + 5xx retried with `Retry-After`-aware backoff).
   *
   * The behaviour-capture stage MUST NOT call the LLM directly; all LLM
   * access flows through this relay, exactly like gap-fill.
   *
   * The returned `content` is raw LLM output (the documented 7-part JSON
   * block). Parsing + validation happen in the caller; this method only
   * handles transport + typed-error surfacing.
   *
   * Spec 2026-05-29: Business-logic behaviour capture (Gap C), Task Group 2.
   *
   * @param prompt - The fully-assembled behaviour-capture prompt
   * @param methodId - Stable method id `FQN#name(ParamTypes)` (logging / correlation)
   * @param runId - Discovery run ID (logging / correlation)
   * @returns Promise resolving to the LLM response ready for 7-part parsing
   * @throws BehaviourCaptureGatewayError on network failure or non-2xx HTTP response
   */
  async captureBehaviour(
    prompt: string,
    methodId: string,
    runId: string,
  ): Promise<BehaviourCaptureResponse> {
    const MAX_RETRIES = 4;
    const start = Date.now();
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        const response = await this.client.post<BehaviourCaptureResponse>(
          '/api/v1/discovery/v3/behaviour-capture',
          { prompt, methodId, runId },
        );
        const durationMs = Date.now() - start;
        if (attempt > 0) {
          console.log(
            `[GatewayClient] captureBehaviour ${methodId} recovered after ${attempt} retry(ies) in ${durationMs}ms`,
          );
        } else {
          console.log(
            `[GatewayClient] captureBehaviour ${methodId} complete in ${durationMs}ms, contentLen=${response.data?.content?.length ?? 0}`,
          );
        }
        return {
          content: response.data?.content ?? '',
          usage: response.data?.usage,
        };
      } catch (error) {
        lastError = error;
        const axiosError = error as AxiosError;
        const status = axiosError.response?.status ?? null;
        const isRetryable =
          status === 429 || (status !== null && status >= 500 && status < 600);
        if (!isRetryable || attempt === MAX_RETRIES) {
          break;
        }
        let waitMs: number;
        const retryAfter = axiosError.response?.headers?.['retry-after'];
        if (typeof retryAfter === 'string' && retryAfter.length > 0) {
          const asSeconds = Number(retryAfter);
          if (Number.isFinite(asSeconds) && asSeconds > 0) {
            waitMs = Math.min(asSeconds * 1000, 30_000);
          } else {
            const asDate = new Date(retryAfter).getTime();
            waitMs = Number.isFinite(asDate)
              ? Math.max(0, Math.min(asDate - Date.now(), 30_000))
              : 1000 * Math.pow(2, attempt);
          }
        } else {
          const base = 500 * Math.pow(2, attempt);
          const jitter = Math.floor(Math.random() * (base * 0.5));
          waitMs = base + jitter;
        }
        console.warn(
          `[GatewayClient] captureBehaviour ${methodId} got HTTP ${status}, retry ${attempt + 1}/${MAX_RETRIES} after ${waitMs}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
    const durationMs = Date.now() - start;
    const axiosError = lastError as AxiosError;
    const status = axiosError?.response?.status ?? null;
    const baseMessage =
      lastError instanceof Error ? lastError.message : 'Unknown behaviour-capture error';
    const message =
      status !== null
        ? `Behaviour capture failed for ${methodId} (HTTP ${status}): ${baseMessage}`
        : `Behaviour capture failed for ${methodId}: ${baseMessage}`;
    console.error(
      `[GatewayClient] captureBehaviour ${methodId} FAILED after ${durationMs}ms: ${message}`,
    );
    throw new BehaviourCaptureGatewayError(message, methodId, status, lastError);
  }

  /**
   * POSTs a log-recipe induction prompt to the gateway relay.
   *
   * Sibling of {@link captureBehaviour}: per-FILE, single-prompt per-call shape
   * -- the caller (`logRecipeInduction.induceAndValidateRecipe`) controls the
   * bounded retry budget (max 3 calls/file). Reuses the gap-fill retry / backoff
   * transport pattern verbatim (429 + 5xx retried with `Retry-After`-aware
   * backoff). The gateway relays at `temperature: 0` (deterministic induction).
   *
   * The recipe-induction stage MUST NOT call the LLM directly; all LLM access
   * flows through this relay, exactly like gap-fill. The `prompt` already embeds
   * the REDACTED sample blocks (redaction happens upstream in the sampler); this
   * method embeds nothing else.
   *
   * The returned `content` is raw LLM output (a STRUCTURED RECIPE JSON object or
   * the literal "no pattern"). Parsing + held-out validation happen in the
   * caller; this method only handles transport + typed-error surfacing.
   *
   * Spec 2026-06-20: Runtime Log Evidence -- Format-Agnostic Extraction (Task Group 5).
   *
   * @param payload - { prompt, filePath? } -- prompt carries redacted sample blocks
   * @param runId - Discovery run ID (logging / correlation)
   * @returns Promise resolving to the LLM response ready for recipe parsing
   * @throws LogRecipeGatewayError on network failure or non-2xx HTTP response
   */
  async induceLogRecipe(
    payload: { prompt: string; filePath?: string },
    runId: string,
  ): Promise<LogRecipeResponse> {
    const filePath = payload.filePath ?? '';
    const MAX_RETRIES = 4;
    const start = Date.now();
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        const response = await this.client.post<LogRecipeResponse>(
          '/api/v1/discovery/v3/log-recipe',
          { prompt: payload.prompt, filePath, runId },
        );
        const durationMs = Date.now() - start;
        if (attempt > 0) {
          console.log(
            `[GatewayClient] induceLogRecipe ${filePath} recovered after ${attempt} retry(ies) in ${durationMs}ms`,
          );
        } else {
          console.log(
            `[GatewayClient] induceLogRecipe ${filePath} complete in ${durationMs}ms, contentLen=${response.data?.content?.length ?? 0}`,
          );
        }
        return {
          content: response.data?.content ?? '',
          usage: response.data?.usage,
        };
      } catch (error) {
        lastError = error;
        const axiosError = error as AxiosError;
        const status = axiosError.response?.status ?? null;
        const isRetryable =
          status === 429 || (status !== null && status >= 500 && status < 600);
        if (!isRetryable || attempt === MAX_RETRIES) {
          break;
        }
        let waitMs: number;
        const retryAfter = axiosError.response?.headers?.['retry-after'];
        if (typeof retryAfter === 'string' && retryAfter.length > 0) {
          const asSeconds = Number(retryAfter);
          if (Number.isFinite(asSeconds) && asSeconds > 0) {
            waitMs = Math.min(asSeconds * 1000, 30_000);
          } else {
            const asDate = new Date(retryAfter).getTime();
            waitMs = Number.isFinite(asDate)
              ? Math.max(0, Math.min(asDate - Date.now(), 30_000))
              : 1000 * Math.pow(2, attempt);
          }
        } else {
          const base = 500 * Math.pow(2, attempt);
          const jitter = Math.floor(Math.random() * (base * 0.5));
          waitMs = base + jitter;
        }
        console.warn(
          `[GatewayClient] induceLogRecipe ${filePath} got HTTP ${status}, retry ${attempt + 1}/${MAX_RETRIES} after ${waitMs}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
    const durationMs = Date.now() - start;
    const axiosError = lastError as AxiosError;
    const status = axiosError?.response?.status ?? null;
    const baseMessage =
      lastError instanceof Error ? lastError.message : 'Unknown log-recipe induction error';
    const message =
      status !== null
        ? `Log-recipe induction failed for ${filePath} (HTTP ${status}): ${baseMessage}`
        : `Log-recipe induction failed for ${filePath}: ${baseMessage}`;
    console.error(
      `[GatewayClient] induceLogRecipe ${filePath} FAILED after ${durationMs}ms: ${message}`,
    );
    throw new LogRecipeGatewayError(message, filePath, status, lastError);
  }

  /**
   * POSTs a fully-assembled operational-artifact summariser prompt to the
   * gateway relay.
   *
   * Sibling of {@link captureBehaviour}: per-FILE, single-prompt per-call shape
   * -- the caller (`operationalArtifactScanStep`) controls parallelism via the
   * same hand-rolled `promisePool`. Reuses the gap-fill retry / backoff transport
   * pattern verbatim (429 + 5xx retried with `Retry-After`-aware backoff). The
   * gateway relays at `temperature: 0` with no tools.
   *
   * The operational-artifact scan MUST NOT call the LLM directly; all LLM access
   * flows through this relay, exactly like gap-fill.
   *
   * The returned `content` is raw LLM output (the strict summariser JSON object:
   * `purpose`, `artifactKind`, `behaviourBearing`, `invokes`, `inputs`,
   * `outputs`, `sideEffects`, `externalSystems`, `evidence`, `language`).
   * Parsing + validation happen in the caller.
   *
   * Spec 2026-06-14: Generic Operational-Artifact Discovery (D1), Task Group 3.
   *
   * @param prompt - The fully-assembled summariser prompt
   * @param filePath - File path the prompt targets (logging / correlation)
   * @param runId - Discovery run ID (logging / correlation)
   * @returns Promise resolving to the LLM response ready for strict-JSON parsing
   * @throws OperationalArtifactGatewayError on network failure or non-2xx HTTP response
   */
  async summariseOperationalArtifact(
    prompt: string,
    filePath: string,
    runId: string,
  ): Promise<OperationalArtifactResponse> {
    const MAX_RETRIES = 4;
    const start = Date.now();
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        const response = await this.client.post<OperationalArtifactResponse>(
          '/api/v1/discovery/v3/operational-artifact',
          { prompt, filePath, runId },
        );
        const durationMs = Date.now() - start;
        if (attempt > 0) {
          console.log(
            `[GatewayClient] summariseOperationalArtifact ${filePath} recovered after ${attempt} retry(ies) in ${durationMs}ms`,
          );
        } else {
          console.log(
            `[GatewayClient] summariseOperationalArtifact ${filePath} complete in ${durationMs}ms, contentLen=${response.data?.content?.length ?? 0}`,
          );
        }
        return {
          content: response.data?.content ?? '',
          usage: response.data?.usage,
        };
      } catch (error) {
        lastError = error;
        const axiosError = error as AxiosError;
        const status = axiosError.response?.status ?? null;
        const isRetryable =
          status === 429 || (status !== null && status >= 500 && status < 600);
        if (!isRetryable || attempt === MAX_RETRIES) {
          break;
        }
        let waitMs: number;
        const retryAfter = axiosError.response?.headers?.['retry-after'];
        if (typeof retryAfter === 'string' && retryAfter.length > 0) {
          const asSeconds = Number(retryAfter);
          if (Number.isFinite(asSeconds) && asSeconds > 0) {
            waitMs = Math.min(asSeconds * 1000, 30_000);
          } else {
            const asDate = new Date(retryAfter).getTime();
            waitMs = Number.isFinite(asDate)
              ? Math.max(0, Math.min(asDate - Date.now(), 30_000))
              : 1000 * Math.pow(2, attempt);
          }
        } else {
          const base = 500 * Math.pow(2, attempt);
          const jitter = Math.floor(Math.random() * (base * 0.5));
          waitMs = base + jitter;
        }
        console.warn(
          `[GatewayClient] summariseOperationalArtifact ${filePath} got HTTP ${status}, retry ${attempt + 1}/${MAX_RETRIES} after ${waitMs}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
    const durationMs = Date.now() - start;
    const axiosError = lastError as AxiosError;
    const status = axiosError?.response?.status ?? null;
    const baseMessage =
      lastError instanceof Error ? lastError.message : 'Unknown operational-artifact summariser error';
    const message =
      status !== null
        ? `Operational-artifact summarisation failed for ${filePath} (HTTP ${status}): ${baseMessage}`
        : `Operational-artifact summarisation failed for ${filePath}: ${baseMessage}`;
    console.error(
      `[GatewayClient] summariseOperationalArtifact ${filePath} FAILED after ${durationMs}ms: ${message}`,
    );
    throw new OperationalArtifactGatewayError(message, filePath, status, lastError);
  }

  /**
   * POSTs a fully-assembled capability-naming prompt to the gateway relay.
   *
   * Sibling of {@link summariseOperationalArtifact}: per-SEED, single-prompt
   * per-call shape -- the caller (`capabilitySynthesisStep`) controls parallelism
   * via the same hand-rolled `promisePool`. Reuses the gap-fill retry / backoff
   * transport pattern verbatim (429 + 5xx retried with `Retry-After`-aware
   * backoff). The gateway relays at `temperature: 0` with no tools.
   *
   * The capability-naming step MUST NOT call the LLM directly; all LLM access
   * flows through this relay. The LLM is NAMING-ONLY: membership is already
   * fixed deterministically before this call, so a relay failure is non-fatal
   * (the caller falls back to a deterministic name).
   *
   * The returned `content` is raw LLM output (the strict `{ name, summary, kind }`
   * JSON object). Parsing + validation happen in the caller.
   *
   * Spec 2026-06-14: D2 -- Capability Synthesis + Batch Spines, Task Group 4.
   *
   * @param prompt - The fully-assembled naming prompt
   * @param seedKey - Deterministic seed identifier (logging / correlation)
   * @param runId - Discovery run ID (logging / correlation)
   * @returns Promise resolving to the LLM response ready for strict-JSON parsing
   * @throws CapabilityNamingGatewayError on network failure or non-2xx HTTP response
   */
  async nameCapability(
    prompt: string,
    seedKey: string,
    runId: string,
  ): Promise<CapabilityNamingResponse> {
    const MAX_RETRIES = 4;
    const start = Date.now();
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        const response = await this.client.post<CapabilityNamingResponse>(
          '/api/v1/discovery/v3/capability-naming',
          { prompt, seedKey, runId },
        );
        const durationMs = Date.now() - start;
        if (attempt > 0) {
          console.log(
            `[GatewayClient] nameCapability ${seedKey} recovered after ${attempt} retry(ies) in ${durationMs}ms`,
          );
        } else {
          console.log(
            `[GatewayClient] nameCapability ${seedKey} complete in ${durationMs}ms, contentLen=${response.data?.content?.length ?? 0}`,
          );
        }
        return {
          content: response.data?.content ?? '',
          usage: response.data?.usage,
        };
      } catch (error) {
        lastError = error;
        const axiosError = error as AxiosError;
        const status = axiosError.response?.status ?? null;
        const isRetryable =
          status === 429 || (status !== null && status >= 500 && status < 600);
        if (!isRetryable || attempt === MAX_RETRIES) {
          break;
        }
        let waitMs: number;
        const retryAfter = axiosError.response?.headers?.['retry-after'];
        if (typeof retryAfter === 'string' && retryAfter.length > 0) {
          const asSeconds = Number(retryAfter);
          if (Number.isFinite(asSeconds) && asSeconds > 0) {
            waitMs = Math.min(asSeconds * 1000, 30_000);
          } else {
            const asDate = new Date(retryAfter).getTime();
            waitMs = Number.isFinite(asDate)
              ? Math.max(0, Math.min(asDate - Date.now(), 30_000))
              : 1000 * Math.pow(2, attempt);
          }
        } else {
          const base = 500 * Math.pow(2, attempt);
          const jitter = Math.floor(Math.random() * (base * 0.5));
          waitMs = base + jitter;
        }
        console.warn(
          `[GatewayClient] nameCapability ${seedKey} got HTTP ${status}, retry ${attempt + 1}/${MAX_RETRIES} after ${waitMs}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
    const durationMs = Date.now() - start;
    const axiosError = lastError as AxiosError;
    const status = axiosError?.response?.status ?? null;
    const baseMessage =
      lastError instanceof Error ? lastError.message : 'Unknown capability-naming error';
    const message =
      status !== null
        ? `Capability naming failed for ${seedKey} (HTTP ${status}): ${baseMessage}`
        : `Capability naming failed for ${seedKey}: ${baseMessage}`;
    console.error(
      `[GatewayClient] nameCapability ${seedKey} FAILED after ${durationMs}ms: ${message}`,
    );
    throw new CapabilityNamingGatewayError(message, seedKey, status, lastError);
  }

  /**
   * POSTs a fully-assembled response-contract-enrichment prompt to the gateway
   * relay.
   *
   * Sibling of {@link captureBehaviour}: per-ENDPOINT, single-prompt per-call
   * shape -- the caller (`responseContractEnrichmentStep`) controls parallelism
   * via the same hand-rolled `promisePool`. Reuses the gap-fill retry / backoff
   * transport pattern verbatim (429 + 5xx retried with `Retry-After`-aware
   * backoff). The gateway relays at `temperature: 0`.
   *
   * The response-contract-enrichment stage MUST NOT call the LLM directly; all
   * LLM access flows through this relay, exactly like behaviour capture.
   *
   * The returned `content` is raw LLM output (a JSON object of prose/semantic
   * sub-fields: `body_shape`, `response_summary`, `message`, `envelope`).
   * Parsing + validation happen in the caller.
   *
   * Spec 2026-05-30: Per-endpoint response-contract capture (Spec 1), Task Group 2.
   *
   * @param prompt - The fully-assembled enrichment prompt
   * @param endpointName - Endpoint identity `${httpMethod} ${path}` (logging / correlation)
   * @param runId - Discovery run ID (logging / correlation)
   * @returns Promise resolving to the LLM response ready for sub-field parsing
   * @throws ResponseContractGatewayError on network failure or non-2xx HTTP response
   */
  async enrichResponseContract(
    prompt: string,
    endpointName: string,
    runId: string,
  ): Promise<ResponseContractEnrichResponse> {
    const MAX_RETRIES = 4;
    const start = Date.now();
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        const response = await this.client.post<ResponseContractEnrichResponse>(
          '/api/v1/discovery/v3/response-contract-enrich',
          { prompt, endpointName, runId },
        );
        const durationMs = Date.now() - start;
        if (attempt > 0) {
          console.log(
            `[GatewayClient] enrichResponseContract ${endpointName} recovered after ${attempt} retry(ies) in ${durationMs}ms`,
          );
        } else {
          console.log(
            `[GatewayClient] enrichResponseContract ${endpointName} complete in ${durationMs}ms, contentLen=${response.data?.content?.length ?? 0}`,
          );
        }
        return {
          content: response.data?.content ?? '',
          usage: response.data?.usage,
        };
      } catch (error) {
        lastError = error;
        const axiosError = error as AxiosError;
        const status = axiosError.response?.status ?? null;
        const isRetryable =
          status === 429 || (status !== null && status >= 500 && status < 600);
        if (!isRetryable || attempt === MAX_RETRIES) {
          break;
        }
        let waitMs: number;
        const retryAfter = axiosError.response?.headers?.['retry-after'];
        if (typeof retryAfter === 'string' && retryAfter.length > 0) {
          const asSeconds = Number(retryAfter);
          if (Number.isFinite(asSeconds) && asSeconds > 0) {
            waitMs = Math.min(asSeconds * 1000, 30_000);
          } else {
            const asDate = new Date(retryAfter).getTime();
            waitMs = Number.isFinite(asDate)
              ? Math.max(0, Math.min(asDate - Date.now(), 30_000))
              : 1000 * Math.pow(2, attempt);
          }
        } else {
          const base = 500 * Math.pow(2, attempt);
          const jitter = Math.floor(Math.random() * (base * 0.5));
          waitMs = base + jitter;
        }
        console.warn(
          `[GatewayClient] enrichResponseContract ${endpointName} got HTTP ${status}, retry ${attempt + 1}/${MAX_RETRIES} after ${waitMs}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
    const durationMs = Date.now() - start;
    const axiosError = lastError as AxiosError;
    const status = axiosError?.response?.status ?? null;
    const baseMessage =
      lastError instanceof Error ? lastError.message : 'Unknown response-contract enrichment error';
    const message =
      status !== null
        ? `Response-contract enrichment failed for ${endpointName} (HTTP ${status}): ${baseMessage}`
        : `Response-contract enrichment failed for ${endpointName}: ${baseMessage}`;
    console.error(
      `[GatewayClient] enrichResponseContract ${endpointName} FAILED after ${durationMs}ms: ${message}`,
    );
    throw new ResponseContractGatewayError(message, endpointName, status, lastError);
  }

  /**
   * POSTs a tech-hints classification prompt to the gateway LLM relay.
   *
   * Reuses the V3 gap-fill relay transport pattern (same single global
   * provider config — no separate fast-model knob) to keep the tech-hints
   * resolver aligned with the rest of the V3 LLM wiring. The caller
   * (`techHintsResolver.resolveTechHints`) composes the prompt, invokes
   * this method, and validates the returned content via a schema guard.
   *
   * Error surfaces are mapped to a typed `TechHintsLlmError` with a
   * `reason` tag so the resolver can emit structured log lines and
   * translate to the spec's HTTP status taxonomy (502 llm_timeout /
   * llm_malformed, etc.).
   *
   * Spec 2026-04-20: Tech Hints LLM Resolution — Task Group 2
   *
   * @param prompt - Fully-assembled system+user prompt from techHintsResolver
   * @returns Promise resolving to `{ content, usage? }`
   * @throws TechHintsLlmError with reason `llm_timeout` | `network_error`
   */
  async callTechHintsLlm(prompt: string): Promise<GapFillResponse> {
    const start = Date.now();
    const correlationId = `tech-hints-resolve-${Date.now()}`;
    try {
      const response = await this.client.post<GapFillResponse>(
        '/api/v1/discovery/v3/gap-fill',
        { prompt, filePath: 'tech-hints-resolve', runId: correlationId }
      );
      const durationMs = Date.now() - start;
      console.log(
        `[GatewayClient] callTechHintsLlm complete in ${durationMs}ms, contentLen=${response.data?.content?.length ?? 0}`
      );
      return {
        content: response.data?.content ?? '',
        usage: response.data?.usage,
      };
    } catch (error) {
      const durationMs = Date.now() - start;
      const axiosError = error as AxiosError;
      const status = axiosError.response?.status ?? null;
      const baseMessage = error instanceof Error ? error.message : 'Unknown tech-hints LLM error';
      // Map transport failure kind to a reason tag.
      let reason: 'llm_timeout' | 'network_error' | 'llm_malformed' = 'network_error';
      const code = (axiosError as any).code;
      if (code === 'ECONNABORTED' || /timeout/i.test(baseMessage)) {
        reason = 'llm_timeout';
      } else if (status !== null && status >= 500) {
        // Upstream 5xx response: treat as network_error so resolver returns 502.
        reason = 'network_error';
      }
      console.error(
        `[GatewayClient] callTechHintsLlm FAILED after ${durationMs}ms (reason=${reason}): ${baseMessage}`
      );
      throw new TechHintsLlmError(baseMessage, reason, status);
    }
  }

  /**
   * POSTs a discovery-performance scoring prompt to the gateway LLM relay.
   *
   * Spec: Discovery Performance Scoring (2026-04-25), Phase 2.
   *
   * The scoring call is **non-critical** — failure here never fails the
   * underlying discovery run. The caller (`performancePostRun.scoreRun`)
   * catches throws here and writes a `_FAILED.md` per-run file. Light
   * retry on 429/5xx (3 attempts, modest backoff) keeps transient
   * upstream errors from converting to permanent scoring failures, but
   * we don't try as hard as `gapFill` because the value of one scored
   * run is much lower than one analysed file.
   *
   * The request body carries the FULL prompt (system + user) so the
   * gateway can plug it into a fresh chat-completion call with
   * jsonMode enabled.
   */
  async scoreDiscoveryPerformance(args: {
    runId: string;
    systemPrompt: string;
    userPrompt: string;
  }): Promise<GapFillResponse> {
    const MAX_RETRIES = 2;
    const start = Date.now();
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        const response = await this.client.post<GapFillResponse>(
          '/api/v1/discovery/performance/score',
          {
            runId: args.runId,
            systemPrompt: args.systemPrompt,
            userPrompt: args.userPrompt,
          },
        );
        const durationMs = Date.now() - start;
        if (attempt > 0) {
          console.log(
            `[GatewayClient] scoreDiscoveryPerformance ${args.runId} recovered after ${attempt} retry(ies) in ${durationMs}ms`,
          );
        } else {
          console.log(
            `[GatewayClient] scoreDiscoveryPerformance ${args.runId} complete in ${durationMs}ms, contentLen=${response.data?.content?.length ?? 0}`,
          );
        }
        return {
          content: response.data?.content ?? '',
          usage: response.data?.usage,
        };
      } catch (error) {
        lastError = error;
        const axiosError = error as AxiosError;
        const status = axiosError.response?.status ?? null;
        const isRetryable =
          status === 429 || (status !== null && status >= 500 && status < 600);
        if (!isRetryable || attempt === MAX_RETRIES) {
          break;
        }
        const waitMs = 1000 * Math.pow(2, attempt) + Math.floor(Math.random() * 500);
        console.warn(
          `[GatewayClient] scoreDiscoveryPerformance ${args.runId} got HTTP ${status}, retry ${attempt + 1}/${MAX_RETRIES} after ${waitMs}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
    const baseMessage =
      lastError instanceof Error ? lastError.message : 'Unknown scoring error';
    const axiosError = lastError as AxiosError;
    const status = axiosError?.response?.status ?? null;
    // Capture the gateway's response body in the thrown error so the
    // performancePostRun.ts FAILED file shows the real upstream cause
    // (e.g. Azure auth, model-deployment missing, JSON-mode 400) instead
    // of a generic "Internal server error" string.
    let gatewayBody = '';
    const respData = axiosError?.response?.data as unknown;
    if (respData) {
      try {
        gatewayBody = typeof respData === 'string' ? respData : JSON.stringify(respData);
      } catch {
        gatewayBody = String(respData);
      }
    }
    const message =
      status !== null
        ? `Discovery performance scoring failed for runId ${args.runId} (HTTP ${status}): ${baseMessage}${gatewayBody ? ` | gateway body: ${gatewayBody.slice(0, 500)}` : ''}`
        : `Discovery performance scoring failed for runId ${args.runId}: ${baseMessage}`;
    console.error(`[GatewayClient] scoreDiscoveryPerformance FAILED: ${message}`);
    throw new Error(message);
  }
}

/**
 * Singleton instance of the gateway client
 */
export const gatewayClient = new GatewayClient();
