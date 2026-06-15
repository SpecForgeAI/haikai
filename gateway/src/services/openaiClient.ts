/**
 * OpenAI API client wrapper using the Responses API
 */

import OpenAI from 'openai';
import { getConfig } from '../config';
import { logger, logOpenAIRequest } from './logger';
import { assertNotLlmTestSentinel } from './llmTestGuard';
import { ToolCall, ToolDefinition, TOOL_DEFINITIONS } from '../types';

// OpenAI client instance (lazy initialized)
let openaiClient: OpenAI | null = null;

/**
 * Get or create the OpenAI client instance.
 */
function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    const config = getConfig();
    // Jest guard: reject loudly if an un-mocked test reached the real client.
    // (No-op outside tests -- the sentinel is only injected by jest setup.)
    assertNotLlmTestSentinel(config.openaiApiKey, 'OpenAI');
    openaiClient = new OpenAI({
      apiKey: config.openaiApiKey,
      baseURL: config.openaiBaseUrl,
      timeout: config.openaiTimeoutMs,
    });
  }
  return openaiClient;
}

/**
 * Reset the OpenAI client (for testing)
 */
export function resetOpenAIClient(): void {
  openaiClient = null;
}

/**
 * Content part union type for multimodal OpenAI messages.
 * Supports text, image, and file content parts in a single user message.
 *
 * Spec 2026-02-17: Multi-File Upload + URL References for SA and PM Chat
 */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: string } }
  | { type: 'file'; file: { file_data: string; filename: string } };

/**
 * Message format for OpenAI conversations
 *
 * Spec 2026-02-17: Multi-File Upload + URL References for SA and PM Chat
 * - Changed content from `string` to `string | ContentPart[]` to support
 *   multimodal messages with text, image, and file content parts.
 */
export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[];
  tool_call_id?: string;
  tool_calls?: {
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }[];
}

/**
 * Response from OpenAI API call
 */
export interface OpenAIResponse {
  /** Response ID from OpenAI */
  id: string;
  /** Conversation ID for maintaining history */
  conversationId?: string;
  /** Assistant's text content (if final response) */
  content?: string;
  /** Tool calls requested by the model */
  toolCalls?: ToolCall[];
  /** Whether this is a final response (no more tool calls) */
  isFinal: boolean;
  /** Token usage information */
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

/**
 * Parse tool calls from OpenAI response
 */
function parseToolCalls(
  toolCalls?: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[]
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

/**
 * Get OpenAI-compatible tool definitions
 */
function getOpenAITools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  // Cast through unknown to avoid TypeScript strict type checking issues
  // The TOOL_DEFINITIONS structure matches OpenAI's expected format
  return TOOL_DEFINITIONS as unknown as OpenAI.Chat.Completions.ChatCompletionTool[];
}

/**
 * Options for sendChatRequest.
 */
export interface ChatRequestOptions {
  /**
   * When true, adds response_format: { type: 'json_object' } to the OpenAI
   * request and omits tool definitions. This forces the model to return
   * syntactically valid JSON, which is required for planner responses
   * (refine / implementation_planning phases).
   */
  jsonMode?: boolean;

  /**
   * When provided, use this array of tool definitions instead of the default
   * getOpenAITools() (all TOOL_DEFINITIONS). This enables callers to restrict
   * the available tools for a specific call (e.g. mission generation sends
   * only save_product_artifacts).
   */
  tools?: ToolDefinition[];

  /**
   * When provided, use this value as the OpenAI `tool_choice` parameter
   * instead of the default 'auto'. Accepts any value supported by the
   * OpenAI API, e.g. 'auto', 'none', or a forced function call object
   * like { type: "function", function: { name: "save_product_artifacts" } }.
   */
  toolChoice?: unknown;

  /**
   * When provided, sets the temperature for the OpenAI request.
   * Lower values (e.g., 0.2) produce more deterministic output;
   * higher values (e.g., 0.8) produce more creative output.
   * If not provided, the OpenAI default is used.
   *
   * Spec 2026-02-14: SA Increment 5 - Wire Confirmation, Baseline Generation, Tool Execution
   * Task Group 3: Baseline Generation Flow
   */
  temperature?: number;

  /**
   * When provided, sets max_completion_tokens for the OpenAI request.
   * Limits the number of tokens in the generated response.
   * If not provided, the OpenAI default is used.
   *
   * Spec 2026-02-14: SA Increment 5 - Wire Confirmation, Baseline Generation, Tool Execution
   * Task Group 3: Baseline Generation Flow
   */
  maxTokens?: number;
}

/**
 * Send a chat completion request to OpenAI.
 *
 * Uses the Chat Completions API with tools.
 *
 * @param messages - Array of messages (system, user, assistant, tool)
 * @param requestId - Request ID for logging
 * @param sessionId - Session ID for logging
 * @param options - Optional request options (e.g. jsonMode)
 * @returns OpenAI response with content or tool calls
 */
export async function sendChatRequest(
  messages: OpenAIMessage[],
  requestId: string,
  sessionId: string,
  options?: ChatRequestOptions
): Promise<OpenAIResponse> {
  const config = getConfig();
  const client = getOpenAIClient();
  const startTime = Date.now();

  try {
    logger.debug('Sending OpenAI request', {
      requestId,
      sessionId,
      model: config.openaiModel,
      messageCount: messages.length,
      jsonMode: options?.jsonMode || false,
      hasCustomTools: !!options?.tools,
      hasCustomToolChoice: !!options?.toolChoice,
    });

    // In JSON mode: enforce JSON output and skip tools (planner never uses tools).
    // When custom tools are explicitly provided: use the caller's tools and toolChoice.
    //   - Empty array (tools: []) means "no tools" -- pure text completion.
    //   - Non-empty array means use those specific tools.
    // When tools option is not provided at all: include all tools for the OAS assistant agent loop.
    const createParams: Record<string, unknown> = {
      model: config.openaiModel,
      messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    };

    if (options?.jsonMode) {
      createParams.response_format = { type: 'json_object' };
    } else if (options?.tools !== undefined) {
      // Caller explicitly specified tools
      if (options.tools.length > 0) {
        createParams.tools = options.tools;
        createParams.tool_choice = options.toolChoice || 'auto';
      }
      // Empty array: no tools sent, pure text completion
    } else {
      createParams.tools = getOpenAITools();
      createParams.tool_choice = 'auto';
    }

    // Spec 2026-02-14: SA Increment 5 - Wire temperature and maxTokens into createParams
    // These are backward-compatible optional fields; existing callers are unaffected.
    // OpenAI reasoning models (o1, o3, o3-mini, gpt-5, etc.) only support temperature=1;
    // skip the parameter for those models to avoid 400 errors.
    const isReasoningModel = /^(o[0-9]|gpt-5)/.test(config.openaiModel);
    if (options?.temperature !== undefined && !isReasoningModel) {
      createParams.temperature = options.temperature;
    }
    if (options?.maxTokens !== undefined) {
      createParams.max_completion_tokens = options.maxTokens;
    }

    const response = await client.chat.completions.create(
      createParams as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
    );

    const durationMs = Date.now() - startTime;

    // Log usage
    logOpenAIRequest(requestId, sessionId, durationMs, {
      promptTokens: response.usage?.prompt_tokens,
      completionTokens: response.usage?.completion_tokens,
      totalTokens: response.usage?.total_tokens,
    });

    const choice = response.choices[0];
    const message = choice?.message;

    // Check if there are tool calls
    const toolCalls = parseToolCalls(message?.tool_calls);
    const hasToolCalls = toolCalls.length > 0;

    return {
      id: response.id,
      content: message?.content || '',
      toolCalls: hasToolCalls ? toolCalls : undefined,
      isFinal: !hasToolCalls,
      usage: {
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
        totalTokens: response.usage?.total_tokens,
      },
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;

    logger.error('OpenAI request failed', {
      requestId,
      sessionId,
      durationMs,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    // Re-throw with more context
    if (error instanceof OpenAI.APIError) {
      const apiError = new Error(`OpenAI API error: ${error.message}`);
      apiError.name = 'OpenAIError';
      throw apiError;
    }

    throw error;
  }
}

/**
 * Send a streaming chat completion request to OpenAI.
 *
 * Returns an async iterator that yields events.
 *
 * @param messages - Array of messages
 * @param requestId - Request ID for logging
 * @param sessionId - Session ID for logging
 * @returns Async iterator of stream events
 */
export async function* sendStreamingRequest(
  messages: OpenAIMessage[],
  requestId: string,
  sessionId: string
): AsyncGenerator<{
  type: 'token' | 'tool_call' | 'done';
  content?: string;
  toolCall?: ToolCall;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}> {
  const config = getConfig();
  const client = getOpenAIClient();
  const startTime = Date.now();

  try {
    logger.debug('Sending OpenAI streaming request', {
      requestId,
      sessionId,
      model: config.openaiModel,
      messageCount: messages.length,
    });

    const stream = await client.chat.completions.create({
      model: config.openaiModel,
      messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      tools: getOpenAITools(),
      tool_choice: 'auto',
      stream: true,
    });

    let currentToolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      // Handle content tokens
      if (delta?.content) {
        yield { type: 'token', content: delta.content };
      }

      // Handle tool calls
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const existing = currentToolCalls.get(tc.index) || { id: '', name: '', arguments: '' };

          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.name = tc.function.name;
          if (tc.function?.arguments) existing.arguments += tc.function.arguments;

          currentToolCalls.set(tc.index, existing);
        }
      }

      // Check if this is the last chunk
      if (chunk.choices[0]?.finish_reason) {
        // Emit completed tool calls
        for (const tc of currentToolCalls.values()) {
          if (tc.id && tc.name) {
            yield {
              type: 'tool_call',
              toolCall: {
                callId: tc.id,
                name: tc.name,
                arguments: JSON.parse(tc.arguments || '{}'),
              },
            };
          }
        }
      }
    }

    const durationMs = Date.now() - startTime;

    logOpenAIRequest(requestId, sessionId, durationMs);

    yield { type: 'done' };
  } catch (error) {
    const durationMs = Date.now() - startTime;

    logger.error('OpenAI streaming request failed', {
      requestId,
      sessionId,
      durationMs,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    if (error instanceof OpenAI.APIError) {
      const apiError = new Error(`OpenAI API error: ${error.message}`);
      apiError.name = 'OpenAIError';
      throw apiError;
    }

    throw error;
  }
}

/**
 * Build tool result messages for OpenAI.
 *
 * @param assistantMessage - The assistant's message with tool calls
 * @param results - Array of tool results
 * @returns Messages to append for the next request
 */
export function buildToolResultMessages(
  assistantMessage: OpenAIMessage,
  results: { callId: string; output?: unknown; error?: string }[]
): OpenAIMessage[] {
  const messages: OpenAIMessage[] = [];

  // Add the assistant message with tool_calls
  messages.push(assistantMessage);

  // Add tool result messages
  for (const result of results) {
    const content = result.error
      ? JSON.stringify({ error: result.error })
      : JSON.stringify(result.output);

    messages.push({
      role: 'tool',
      content,
      tool_call_id: result.callId,
    });
  }

  return messages;
}
