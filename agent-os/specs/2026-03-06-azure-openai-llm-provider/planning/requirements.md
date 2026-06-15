# Spec Requirements: Azure OpenAI LLM Provider

## Initial Description
Add AzureOpenAI LLM provider support alongside existing OpenAI provider. The gateway currently only supports OpenAI via the official SDK. This spec adds a configurable `llmProvider` switch and a new AzureOpenAI provider that uses hand-crafted HTTP requests with two-step auth (token fetch + chat request). Both providers sit behind a common LlmClient interface with a factory pattern.

## Requirements Discussion

### First Round Questions

**Q1:** The current `openaiClient.ts` uses the official `openai` npm SDK (v4.24.1). Since the Azure provider will use hand-crafted `fetch` calls, should the OpenAI provider ALSO be refactored away from the SDK to use raw `fetch`? This would give both providers a symmetric implementation behind the `LlmClient` interface, and you could eventually remove the `openai` npm dependency. There is already a clean precedent for this pattern in `implementationLlmProxyClient.ts` which uses native `fetch`. Or would you prefer to keep the SDK for OpenAI and only hand-craft the Azure side?
**Answer:** No. Do NOT change the existing OpenAI provider. Keep the SDK as-is. The Azure provider is specific and will hopefully be the thing refactored in the future.

**Q2:** For the Azure auth token (fetched via POST to `azureAuthEndpoint`), how should we handle caching and refresh? Assumption was: cache the token in a module-level variable with its expiry timestamp, and proactively re-fetch when the token is within N minutes of expiry. Does the Azure auth endpoint return an expiry time in the response body (e.g., `expires_in` seconds), or do we need a configurable TTL? What buffer before expiry should trigger a refresh?
**Answer:** Just assume it needs refreshed every 5 minutes. No expires_in parsing needed - simple TTL of 5 minutes.

**Q3:** `sendStreamingRequest` is used only by the v1 chat route (`chat.ts`), NOT by `chatV2.ts`. Should the Azure provider support streaming, or is it acceptable to initially support only non-streaming `sendChatRequest`?
**Answer:** Match OpenAI v2 chat only. No streaming needed (v2 chat doesn't use streaming).

**Q4:** Planning the `LlmClient` interface to expose `sendChatRequest`, `sendStreamingRequest` (if streaming is in scope), and `buildToolResultMessages`. Should `buildToolResultMessages` be on the interface (it is currently pure logic with no provider-specific behavior), or should it remain a standalone utility function?
**Answer:** You decide - try to match OpenAI for v2 chat as best as possible.

**Q5:** Currently the shared types are named `OpenAIMessage`, `OpenAIResponse`, `ContentPart`, and `ChatRequestOptions`. These are also duplicated in `types/session.ts`. Since both providers will use the same message/response shapes, should we: (a) keep the `OpenAI*` naming since it is the wire format for both, (b) rename to provider-neutral names, or (c) leave renaming as a future cleanup and just alias in the new interface?
**Answer:** Option C - don't touch existing OpenAI code, change as little as possible. Reuse existing OpenAI* type names.

**Q6:** Currently `validateRequiredEnvVars()` only checks `OPENAI_API_KEY`. When `llmProvider` is `'azure-openai'`, the Azure-specific fields become required while `openaiApiKey` presumably becomes optional. Should startup validation be conditional based on `llmProvider`?
**Answer:** Yes, check based on llmProvider that the necessary config for that llmProvider is set.

**Q7:** The current client catches `OpenAI.APIError` and re-throws as `Error` with `name: 'OpenAIError'`. For Azure, should both providers throw errors with the same `.name` so callers don't need provider-specific catch logic, or separate names?
**Answer:** Separate error names. Try not to change whatever OpenAI has so far. Add 'AzureOpenAIError' for Azure.

**Q8:** The existing test suite (30+ test files) mocks `../services/openaiClient` at the module level with `jest.mock`. With the factory pattern, tests will need to mock differently. What approach for testing?
**Answer:** You decide what is best.

**Q9:** Is there anything explicitly out of scope? For example: Azure AD / managed identity authentication, multi-region failover, request retry logic within the client, or rate limiting differences between providers.
**Answer:** Just get the 2 requests/responses for Azure working, nothing else. No streaming, no retries, no failover, no managed identity.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: Implementation LLM Proxy Client - Path: `gateway/src/services/implementationLlmProxyClient.ts`
  - Uses native `fetch()` directly with Bearer token injection
  - Fail-fast pattern for missing config
  - Debug logging without sensitive data
  - Good precedent for the Azure provider's HTTP request pattern
- Feature: OpenAI Client (existing, do not modify) - Path: `gateway/src/services/openaiClient.ts`
  - Defines the current `sendChatRequest` signature and `OpenAIResponse` shape that the Azure provider must match
  - Existing types (`OpenAIMessage`, `OpenAIResponse`, `ChatRequestOptions`, `ContentPart`) to be reused as-is
- Feature: Config singleton - Path: `gateway/src/config.ts`
  - Pattern for adding new config fields, env var loading, and startup validation
- Feature: Services barrel export - Path: `gateway/src/services/index.ts`
  - Currently re-exports all openaiClient functions; will need updating for factory pattern

### Follow-up Questions

No follow-up questions were needed. The user's answers were clear and definitive on all points.

## Visual Assets

### Files Provided:
No visual assets provided.

## Requirements Summary

### Functional Requirements
- Add `llmProvider` config switch supporting `'openai'` (default) and `'azure-openai'` values
- Add Azure-specific config fields: `azureAuthEndpoint`, `azureApiUsername`, `azureApiPassword`, `azureChatEndpoint`, `azureApiVersion`, `azureApiModel`
- Implement Azure auth flow: POST to auth endpoint with Basic auth (username:password base64-encoded) to receive a bearer token string
- Implement Azure chat flow: POST to chat endpoint with Bearer token, using OpenAI-compatible request/response body format
- Cache Azure auth token in memory with a simple 5-minute TTL (no expires_in parsing)
- Proactively refresh token when TTL has expired before making a chat request
- Create an `LlmClient` interface with factory pattern that returns the appropriate provider based on config
- Azure provider must produce `OpenAIResponse` objects matching the existing shape (id, content, toolCalls, isFinal, usage)
- Azure provider errors should throw with error name `'AzureOpenAIError'`
- Route layer (`chatV2.ts`) and thread summariser should use the factory-provided client with minimal import changes
- Existing OpenAI provider code (`openaiClient.ts`) must NOT be modified (beyond possibly re-exporting through the factory)

### Reusability Opportunities
- `implementationLlmProxyClient.ts` pattern for native `fetch` with bearer token injection
- Existing `OpenAIMessage`, `OpenAIResponse`, `ChatRequestOptions`, `ContentPart` types reused as-is (option C)
- Existing `sendChatRequest` function signature matched exactly for the Azure implementation
- `config.ts` patterns for env var parsing and validation

### Scope Boundaries
**In Scope:**
- Azure OpenAI provider with two-step auth (token fetch + chat completion)
- Token caching with 5-minute TTL
- LlmClient interface and factory function
- Config additions: llmProvider switch and Azure-specific fields
- Conditional config validation at startup based on selected provider
- Non-streaming `sendChatRequest` for Azure (matches v2 chat usage)
- `'AzureOpenAIError'` error naming for Azure-specific failures
- Minimal route layer changes (swap import to use factory)
- Testing for Azure token fetch, caching, chat request, and factory selection

**Out of Scope:**
- Modifying existing OpenAI provider code or removing the OpenAI SDK
- Streaming support (`sendStreamingRequest`) for Azure
- Renaming existing `OpenAI*` types to provider-neutral names
- Azure AD / managed identity authentication
- Multi-region failover
- Request retry logic within the client
- Rate limiting differences between providers
- Any frontend changes (LLM provider is entirely a backend concern)

### Technical Considerations
- Native `fetch` (Node.js 18+ global) to be used for Azure HTTP requests, consistent with `implementationLlmProxyClient.ts`
- Azure uses OpenAI-compatible chat completions request/response body format, so the same `OpenAIMessage` array goes to both providers
- Token cache is module-level (in-memory), with 5-minute fixed TTL -- no parsing of auth response expiry fields
- The 30+ existing test files mock `../services/openaiClient` at module level -- the factory pattern must preserve testability, ideally keeping the same mock surface or providing a clean migration path
- `buildToolResultMessages` is pure logic with no provider-specific behavior -- decision on whether it goes on the interface or stays standalone is deferred to spec writer
- Type duplication in `types/session.ts` (OpenAIMessage, ContentPart) exists intentionally to avoid circular deps -- this should not be disturbed
- Tool definitions (`TOOL_DEFINITIONS`) are in a generic format already compatible with both providers
