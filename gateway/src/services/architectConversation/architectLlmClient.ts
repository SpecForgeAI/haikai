/**
 * Architect-Conversation LLM Client Boundary — Target State Architect-Persona Conversation
 * (Spec 3, Commit 2 + Spec 2026-05-25 Task Group 2)
 *
 * Spec: 2026-05-24-target-state-architect-conversation
 *       2026-05-25-tech-stack-prefill-and-target-write (callSingleShot sibling method)
 *
 * Typed boundary contract for the gateway-native LLM call surface used by the
 * architect-conversation loop runner (`callLlmToolLoop`) and the tech-stack
 * pre-fill module (`callSingleShot`). This file defines the shapes only — the
 * real implementation lives in the route-level adapter (see
 * `routes/architectConversation.ts`'s `buildArchitectLlmClient()`). Tests mock
 * this boundary directly.
 *
 * The shape mirrors the api-migration-validation-service `gatewayClient.callLlmToolLoop`
 * call surface deliberately so the simplified port in `llmLoopRunner.ts` keeps
 * the same tool-call wire vocabulary (per spec §"Gateway-native LLM orchestration
 * loop"). The diagnostic / redactor concerns from that service are NOT carried
 * forward (Q1 option b — drop emission + redactor for the simplified port).
 */

// ---------------------------------------------------------------------------
// Chat message wire shapes — mirrored from the OpenAI / Azure OpenAI provider
// abstraction the gateway already uses. Kept narrow on purpose: this file
// owns the boundary contract for the architect-conversation loop only.
// ---------------------------------------------------------------------------

export type ArchitectChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ArchitectToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    /** JSON-serialised arguments string per OpenAI tool-call schema. */
    arguments: string;
  };
}

export interface ArchitectChatMessage {
  role: ArchitectChatRole;
  content: string | null;
  /** Tool-call requests issued by an assistant message (when role=assistant). */
  tool_calls?: ArchitectToolCall[];
  /** Set on a tool-result message to correlate with the originating call id. */
  tool_call_id?: string;
  /** Optional name for tool-result messages. */
  name?: string;
}

export interface ArchitectToolDefinitionParameter {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ArchitectToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: ArchitectToolDefinitionParameter;
  };
}

export type ArchitectToolChoice =
  | 'auto'
  | 'none'
  | { type: 'function'; function: { name: string } };

export interface ArchitectAssistantMessage {
  role: 'assistant';
  content: string | null;
  tool_calls?: ArchitectToolCall[];
}

// ---------------------------------------------------------------------------
// The single call surface mocked across all loop runner tests.
// ---------------------------------------------------------------------------

export interface CallLlmToolLoopArgs {
  messages: ArchitectChatMessage[];
  tools: ArchitectToolDefinition[];
  toolChoice?: ArchitectToolChoice;
  model?: string;
  /**
   * Per-call timeout in ms. The runner enforces the spec-fixed 30s per-call
   * cap (Q2) and forwards the same value here so a real provider client can
   * apply its own bound if it wants to. For the mock seam this is informational.
   */
  timeoutMs?: number;
}

export interface CallLlmToolLoopResponse {
  message: ArchitectAssistantMessage;
}

// ---------------------------------------------------------------------------
// Single-shot call surface — Tech-Stack.md Pre-fill (Spec 2026-05-25, Task Group 2)
//
// A synchronous system+user prompt pair returning the assistant message text.
// No tool-call loop. The pre-fill module parses the returned content string
// as JSON and runs it through the hand-rolled validator. The same mock seam
// is exposed here as for `callLlmToolLoop`.
// ---------------------------------------------------------------------------

/**
 * System + user prompt pair for the single-shot call. The system prompt
 * carries the strict pre-fill rules; the user prompt carries the labelled
 * `## ORGANISATION STANDARDS` / `## ProjectStandards` markdown sections,
 * the filtered question library, and brief project context.
 */
export interface SingleShotPrompt {
  system: string;
  user: string;
}

/**
 * Optional call-level settings. The pre-fill module enforces its own wall
 * clock above the LLM call; `timeoutMs` is informational for provider
 * clients that support it.
 */
export interface CallSingleShotOptions {
  timeoutMs?: number;
  model?: string;
}

/**
 * Response envelope for the single-shot call. `content` carries the
 * assistant message text exactly as the provider returned it (the pre-fill
 * module parses it as JSON before handing to the validator).
 */
export interface CallSingleShotResponse {
  content: string;
}

/**
 * Thrown when the single-shot LLM call fails (provider error, malformed
 * response envelope, etc). The pre-fill module catches this and surfaces a
 * failure-variant banner without writing any captured-decision rows.
 */
export class SingleShotLlmCallError extends Error {
  public readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'SingleShotLlmCallError';
    this.cause = cause;
  }
}

/**
 * The boundary contract. All loop runner tests mock `callLlmToolLoop`; the
 * pre-fill module tests mock `callSingleShot`. Production wiring (real
 * gateway LLM relay) and tests (mocks) share one type.
 */
export interface ArchitectLlmClient {
  callLlmToolLoop(args: CallLlmToolLoopArgs): Promise<CallLlmToolLoopResponse>;
  callSingleShot(
    prompt: SingleShotPrompt,
    options?: CallSingleShotOptions,
  ): Promise<CallSingleShotResponse>;
}
