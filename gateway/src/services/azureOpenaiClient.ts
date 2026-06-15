/**
 * Azure OpenAI API client using native fetch with two-step auth flow.
 *
 * Step 1: Fetch a bearer token from the Azure auth endpoint (Basic auth).
 * Step 2: Send chat completion requests using the bearer token.
 *
 * Token is cached in-memory with a 5-minute TTL.
 *
 * Spec 2026-03-06: Azure OpenAI LLM Provider - Task Group 2
 */

import { Config } from '../config';
import { logger } from './logger';
import { assertNotLlmTestSentinel } from './llmTestGuard';
import { OpenAIMessage, OpenAIResponse, ChatRequestOptions } from './openaiClient';
import { ToolCall } from '../types';

// ============================================================================
// Token Cache (module-level)
// ============================================================================

/** Cached bearer token from Azure auth endpoint */
let cachedToken: string | null = null;

/** Timestamp (ms) when the token was last fetched */
let tokenFetchedAt: number = 0;

/** Token time-to-live: 5 minutes */
const TOKEN_TTL_MS = 5 * 60 * 1000;

/**
 * Reset the Azure token cache. Exported for testing only.
 */
export function resetAzureTokenCache(): void {
  cachedToken = null;
  tokenFetchedAt = 0;
}

/**
 * Check whether the cached token is expired or missing.
 */
function isTokenExpired(): boolean {
  return cachedToken === null || Date.now() - tokenFetchedAt >= TOKEN_TTL_MS;
}

// ============================================================================
// Token Fetch (Step 1)
// ============================================================================

/**
 * Fetch a bearer token from the Azure auth endpoint using Basic auth.
 *
 * POST to config.azureAuthEndpoint with:
 *   - Content-Type: application/json
 *   - Authorization: Basic <base64(username:password)>
 *
 * The response body is a plain-text bearer token string (not JSON).
 *
 * @param config - Gateway configuration with Azure fields
 * @returns The bearer token string
 * @throws Error with name 'AzureOpenAIError' on non-2xx response
 */
export async function fetchBearerToken(config: Config): Promise<string> {
  // Jest guard: reject loudly if an un-mocked test reached the real client.
  // (No-op outside tests -- the sentinel is only injected by jest setup.)
  assertNotLlmTestSentinel(config.azureApiPassword, 'Azure OpenAI');

  const basicCredentials = Buffer.from(
    `${config.azureApiUsername}:${config.azureApiPassword}`
  ).toString('base64');

  logger.debug('Azure OpenAI: Fetching bearer token', {
    authEndpoint: config.azureAuthEndpoint,
  });

  const response = await fetch(config.azureAuthEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${basicCredentials}`,
    },
  });

  if (!response.ok) {
    const bodySnippet = await response.text();
    const error = new Error(
      `Azure auth token fetch failed: HTTP ${response.status} - ${bodySnippet.substring(0, 200)}`
    );
    error.name = 'AzureOpenAIError';
    throw error;
  }

  const tokenText = await response.text();
  const token = tokenText.trim();

  // Cache the token
  cachedToken = token;
  tokenFetchedAt = Date.now();

  logger.debug('Azure OpenAI: Bearer token fetched successfully');

  return token;
}

// ============================================================================
// Token Validation
// ============================================================================

/**
 * Get a valid bearer token, fetching a new one if expired.
 *
 * @param config - Gateway configuration with Azure fields
 * @returns A valid bearer token string
 */
async function getValidToken(config: Config): Promise<string> {
  if (isTokenExpired()) {
    return fetchBearerToken(config);
  }
  return cachedToken!;
}

// ============================================================================
// Tool Call Parsing
// ============================================================================

/**
 * Parse tool calls from Azure OpenAI response.
 * Replicates the logic from openaiClient.ts parseToolCalls (lines 92-104).
 */
function parseToolCalls(
  toolCalls?: { id: string; type: string; function: { name: string; arguments: string } }[]
): ToolCall[] {
  if (!toolCalls || toolCalls.length === 0) {
    return [];
  }

  return toolCalls.map(tc => ({
    callId: tc.id,
    name: tc.function.name,
    arguments: JSON.parse(tc.function.arguments),
  }));
}

// ============================================================================
// Chat Request (Step 2)
// ============================================================================

/**
 * Send a chat completion request to Azure OpenAI.
 *
 * @param config - Gateway configuration with Azure fields
 * @param messages - Array of messages (system, user, assistant, tool)
 * @param requestId - Request ID for logging
 * @param sessionId - Session ID for logging
 * @param options - Optional request options (jsonMode, tools, toolChoice, temperature, maxTokens)
 * @returns OpenAI-compatible response with content or tool calls
 * @throws Error with name 'AzureOpenAIError' on non-2xx response
 */
async function sendChatRequestInternal(
  config: Config,
  messages: OpenAIMessage[],
  requestId: string,
  sessionId: string,
  options?: ChatRequestOptions
): Promise<OpenAIResponse> {
  const startTime = Date.now();

  // Jest guard: also covers the cached-token path where fetchBearerToken
  // (and its own guard) would be skipped.
  assertNotLlmTestSentinel(config.azureApiPassword, 'Azure OpenAI');

  // Step 1: Get a valid bearer token
  const token = await getValidToken(config);

  // Step 2: Construct URL
  const url = `${config.azureChatEndpoint}/${config.azureApiModel}/chat/completions?api-version=${config.azureApiVersion}`;

  // Build request body following the same options-to-body mapping as openaiClient.ts lines 200-225
  const body: Record<string, unknown> = {
    model: config.azureApiModel,
    messages,
  };

  if (options?.jsonMode) {
    body.response_format = { type: 'json_object' };
  } else if (options?.tools !== undefined) {
    // Caller explicitly specified tools
    if (options.tools.length > 0) {
      body.tools = options.tools;
      body.tool_choice = options.toolChoice || 'auto';
    }
    // Empty array: no tools sent, pure text completion
  }

  // Temperature: skip for reasoning models (matching openaiClient.ts pattern)
  const isReasoningModel = /^(o[0-9]|gpt-5)/.test(config.azureApiModel);
  if (options?.temperature !== undefined && !isReasoningModel) {
    body.temperature = options.temperature;
  }

  if (options?.maxTokens !== undefined) {
    body.max_completion_tokens = options.maxTokens;
  }

  logger.debug('Azure OpenAI: Sending chat request', {
    requestId,
    sessionId,
    model: config.azureApiModel,
    messageCount: messages.length,
    jsonMode: options?.jsonMode || false,
    hasCustomTools: !!options?.tools,
    hasCustomToolChoice: !!options?.toolChoice,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const durationMs = Date.now() - startTime;

  if (!response.ok) {
    const bodySnippet = await response.text();
    const error = new Error(
      `Azure OpenAI chat request failed: HTTP ${response.status} - ${bodySnippet.substring(0, 200)} (requestId: ${requestId})`
    );
    error.name = 'AzureOpenAIError';
    throw error;
  }

  const data = await response.json();

  const choice = data.choices?.[0];
  const message = choice?.message;

  // Parse tool calls (replicating openaiClient.ts parseToolCalls logic)
  const toolCalls = parseToolCalls(message?.tool_calls);
  const hasToolCalls = toolCalls.length > 0;

  logger.debug('Azure OpenAI: Chat response received', {
    requestId,
    sessionId,
    durationMs,
    model: config.azureApiModel,
    hasToolCalls,
    promptTokens: data.usage?.prompt_tokens,
    completionTokens: data.usage?.completion_tokens,
  });

  return {
    id: data.id,
    content: message?.content || '',
    toolCalls: hasToolCalls ? toolCalls : undefined,
    isFinal: !hasToolCalls,
    usage: {
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
      totalTokens: data.usage?.total_tokens,
    },
  };
}

// ============================================================================
// LlmClient-compatible Factory
// ============================================================================

/**
 * LlmClient interface shape (will be formally defined in Task Group 3).
 * For now, matches the sendChatRequest signature from openaiClient.ts.
 */
export interface LlmClient {
  sendChatRequest(
    messages: OpenAIMessage[],
    requestId: string,
    sessionId: string,
    options?: ChatRequestOptions
  ): Promise<OpenAIResponse>;
}

/**
 * Create an Azure OpenAI client that satisfies the LlmClient interface.
 *
 * @param config - Gateway configuration with Azure fields populated
 * @returns An LlmClient-compatible object with sendChatRequest bound to the config
 */
export function createAzureOpenAIClient(config: Config): LlmClient {
  return {
    sendChatRequest: (
      messages: OpenAIMessage[],
      requestId: string,
      sessionId: string,
      options?: ChatRequestOptions
    ): Promise<OpenAIResponse> => {
      return sendChatRequestInternal(config, messages, requestId, sessionId, options);
    },
  };
}
