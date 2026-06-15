import axios, { AxiosInstance, AxiosError } from 'axios';
import { GATEWAY_BASE_URL } from '../config';
import { redactLogString } from './redactor';
import type {
  ChatMessage,
  LlmToolLoopRequest,
  LlmToolLoopResponse,
  ToolChoice,
  ToolDefinition,
} from '../types/llm';

/**
 * HTTP client for talking to the gateway from the api-migration-validation
 * service. Mirrors `discovery-service/src/services/gatewayClient.ts` shape.
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 4.
 *
 * Only one method matters for v1: `callLlmToolLoop` -- POSTs to the gateway
 * relay endpoint `/api/v1/api-migration-validation/llm-tool-loop`. The
 * gateway does ONE provider round-trip per call; loop control (round
 * counting, abort signals, tool dispatch) lives in this service. See
 * `captureLoopRunner.ts` (Group 5).
 */

export type LlmRelayErrorReason =
  | 'llm_timeout'
  | 'network_error'
  | 'llm_malformed'
  | 'rate_limited'
  | 'provider_error';

/**
 * Typed error class for gateway LLM relay failures. Carries a reason tag
 * the loop runner translates into the appropriate diagnostic
 * (`llm_generation_failure` for timeouts, `retry_exhausted` for repeated
 * 429s, etc.).
 */
export class LlmRelayError extends Error {
  public readonly reason: LlmRelayErrorReason;
  public readonly status: number | null;
  public readonly cause?: unknown;

  constructor(
    message: string,
    reason: LlmRelayErrorReason,
    status: number | null,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'LlmRelayError';
    this.reason = reason;
    this.status = status;
    this.cause = cause;
  }
}

interface CallLlmToolLoopArgs {
  messages: ChatMessage[];
  tools: ToolDefinition[];
  toolChoice?: ToolChoice;
  model?: string;
  /**
   * Per-call timeout in ms. Defaults to LLM_TOOL_CALL_TIMEOUT_MS;
   * passed in by the loop runner so the gateway-relay call is bounded by
   * the same hard limit as the tool execution that follows.
   */
  timeoutMs?: number;
}

class GatewayClient {
  private readonly client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: GATEWAY_BASE_URL,
      // No global timeout -- per-call timeout is supplied by the caller so
      // the loop runner can enforce the spec-fixed 30s tool-call cap.
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    // Mirror the discovery gatewayClient pattern: log non-2xx response
    // bodies as a single line for diagnosability, scrub through the
    // redactor in case the provider echoed payload contents.
    this.client.interceptors.response.use(
      (response) => response,
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
            redactLogString(
              `[GatewayClient] ${method} ${url} returned ${status}: ${bodySnippet}`,
            ),
          );
        }
        return Promise.reject(error);
      },
    );
  }

  /**
   * Single round-trip relay through the gateway's LLM tool-loop endpoint.
   * Returns the raw assistant message (which may carry `tool_calls`) and
   * an optional usage block. Loop control / tool dispatch lives in the
   * caller.
   */
  async callLlmToolLoop(args: CallLlmToolLoopArgs): Promise<LlmToolLoopResponse> {
    const endpoint = '/api/v1/api-migration-validation/llm-tool-loop';
    const body: LlmToolLoopRequest = {
      messages: args.messages,
      tools: args.tools,
      toolChoice: args.toolChoice,
      model: args.model,
    };
    const start = Date.now();
    try {
      const res = await this.client.post<LlmToolLoopResponse>(endpoint, body, {
        timeout: args.timeoutMs,
      });
      const duration = Date.now() - start;
      const toolCallCount = res.data?.message?.tool_calls?.length ?? 0;
      console.log(
        `[GatewayClient] callLlmToolLoop complete in ${duration}ms (toolCalls=${toolCallCount})`,
      );
      return res.data;
    } catch (err) {
      const axiosErr = err as AxiosError;
      const status = axiosErr.response?.status ?? null;
      const baseMessage = err instanceof Error ? err.message : 'unknown LLM relay error';
      const code = (axiosErr as { code?: string }).code;
      let reason: LlmRelayErrorReason;
      if (code === 'ECONNABORTED' || /timeout/i.test(baseMessage)) {
        reason = 'llm_timeout';
      } else if (status === 429) {
        reason = 'rate_limited';
      } else if (status !== null && status >= 500) {
        reason = 'provider_error';
      } else if (status !== null && status >= 400) {
        reason = 'llm_malformed';
      } else {
        reason = 'network_error';
      }
      const message = status !== null
        ? `LLM tool-loop relay failed (HTTP ${status}, reason=${reason}): ${baseMessage}`
        : `LLM tool-loop relay failed (reason=${reason}): ${baseMessage}`;
      console.error(`[GatewayClient] callLlmToolLoop FAILED: ${message}`);
      throw new LlmRelayError(message, reason, status, err);
    }
  }
}

/**
 * Singleton instance.
 */
export const gatewayClient = new GatewayClient();

/** Exported for tests that need to construct an isolated instance. */
export { GatewayClient };
