/**
 * LLM Client interface, factory, and singleton convenience function.
 *
 * Provides a provider-agnostic interface for sending chat completion requests.
 * The factory routes to either the existing OpenAI SDK client or the Azure
 * OpenAI client based on the `llmProvider` config value.
 *
 * Spec 2026-03-06: Azure OpenAI LLM Provider - Task Group 3
 */

import { Config, getConfig } from '../config';
import { OpenAIMessage, OpenAIResponse, ChatRequestOptions, sendChatRequest as openaiSendChatRequest } from './openaiClient';
import { createAzureOpenAIClient } from './azureOpenaiClient';

// ============================================================================
// LlmClient Interface
// ============================================================================

/**
 * Provider-agnostic LLM client interface.
 *
 * Both the OpenAI SDK wrapper and the Azure OpenAI client implement this
 * interface, enabling transparent provider switching via configuration.
 */
export interface LlmClient {
  sendChatRequest(
    messages: OpenAIMessage[],
    requestId: string,
    sessionId: string,
    options?: ChatRequestOptions
  ): Promise<OpenAIResponse>;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an LlmClient instance based on the provided configuration.
 *
 * - When `config.llmProvider === 'openai'`: wraps the existing `sendChatRequest`
 *   from `openaiClient.ts` into an object satisfying the `LlmClient` interface.
 * - When `config.llmProvider === 'azure-openai'`: delegates to
 *   `createAzureOpenAIClient` which returns an `LlmClient`-compatible object.
 *
 * This function is called once to create the client; use `getLlmClient()` for
 * the singleton convenience pattern.
 *
 * @param config - Gateway configuration
 * @returns An LlmClient instance for the configured provider
 */
export function createLlmClient(config: Config): LlmClient {
  if (config.llmProvider === 'azure-openai') {
    return createAzureOpenAIClient(config);
  }

  // Default: OpenAI provider -- wrap the existing function-based export
  return {
    sendChatRequest: openaiSendChatRequest,
  };
}

// ============================================================================
// Singleton
// ============================================================================

/** Cached singleton LlmClient instance */
let _llmClient: LlmClient | null = null;

/**
 * Get the singleton LlmClient instance.
 *
 * Lazily creates the client on first call using `getConfig()` to determine
 * which provider to instantiate, then returns the cached instance on all
 * subsequent calls.
 *
 * @returns The singleton LlmClient instance
 */
export function getLlmClient(): LlmClient {
  if (!_llmClient) {
    _llmClient = createLlmClient(getConfig());
  }
  return _llmClient;
}

/**
 * Reset the singleton LlmClient instance.
 * Exported for testing only -- allows tests to force re-creation of the client.
 */
export function resetLlmClient(): void {
  _llmClient = null;
}

// ============================================================================
// Re-exports for consumer convenience
// ============================================================================

/**
 * Re-export buildToolResultMessages from openaiClient so that consumers can
 * import both getLlmClient and buildToolResultMessages from the same module.
 */
export { buildToolResultMessages } from './openaiClient';
