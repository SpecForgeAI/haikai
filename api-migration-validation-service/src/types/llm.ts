/**
 * LLM tool-call relay types. These mirror the OpenAI / Azure OpenAI
 * chat-completion shapes -- the gateway's `/api/v1/api-migration-validation/
 * llm-tool-loop` endpoint is a thin pass-through to the same provider
 * abstraction, so we keep the wire format identical here.
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 4.
 */

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    /** JSON-serialised arguments string per OpenAI tool-call schema. */
    arguments: string;
  };
}

export interface ChatMessage {
  role: ChatRole;
  content: string | null;
  /** Tool-call requests issued by an assistant message (when role=assistant). */
  tool_calls?: ToolCall[];
  /** Set on a tool-result message to correlate with the originating call id. */
  tool_call_id?: string;
  /** Optional name for tool-result messages. */
  name?: string;
}

export interface ToolDefinitionParameter {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: ToolDefinitionParameter;
  };
}

export type ToolChoice =
  | 'auto'
  | 'none'
  | { type: 'function'; function: { name: string } };

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface AssistantMessage {
  role: 'assistant';
  content: string | null;
  tool_calls?: ToolCall[];
}

export interface LlmToolLoopRequest {
  messages: ChatMessage[];
  tools: ToolDefinition[];
  toolChoice?: ToolChoice;
  model?: string;
}

export interface LlmToolLoopResponse {
  message: AssistantMessage;
  usage?: TokenUsage;
}
