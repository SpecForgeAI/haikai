# Task Breakdown: Azure OpenAI LLM Provider

## Overview
Total Tasks: 29 (across 5 task groups)

This spec adds a configurable Azure OpenAI LLM provider alongside the existing OpenAI provider. The gateway gains the ability to route chat completion requests to an Azure-hosted endpoint using a two-step auth flow (token fetch + chat request). All work is backend-only (gateway service); no frontend or Java service changes are required.

**Key files created:**
- `gateway/src/services/llmClient.ts` (interface + factory)
- `gateway/src/services/azureOpenaiClient.ts` (Azure provider implementation)

**Key files modified:**
- `gateway/src/config.ts` (config fields + conditional validation)
- `gateway/src/services/index.ts` (barrel exports)
- `gateway/src/routes/chatV2.ts` (import swap)
- `gateway/src/services/threadSummariser.ts` (import swap)

---

## Task List

### Configuration Layer

#### Task Group 1: Config Extension and Conditional Validation
**Dependencies:** None

- [x] 1.0 Complete configuration layer for Azure OpenAI provider
  - [x] 1.1 Write 4 focused tests for config changes
    - Test 1: When `LLM_PROVIDER` is unset, `loadConfig()` defaults `llmProvider` to `'openai'`
    - Test 2: When `LLM_PROVIDER=azure-openai` and all six Azure env vars are set, `loadConfig()` succeeds and populates all Azure fields
    - Test 3: When `LLM_PROVIDER=azure-openai` and one or more Azure env vars are missing, `validateRequiredEnvVars()` throws a descriptive error listing the missing vars
    - Test 4: When `LLM_PROVIDER=openai` (or unset), `OPENAI_API_KEY` is still validated as required (existing behaviour preserved)
    - Place tests in: `gateway/src/__tests__/config-azure-provider.test.ts`
    - Follow the existing test pattern from `gateway/src/__tests__/config.test.ts` (lines 1-50): `jest.resetModules()`, clone `process.env`, require config fresh
  - [x] 1.2 Add `llmProvider` field to the `Config` interface
    - File: `gateway/src/config.ts`, line ~86 (end of `Config` interface)
    - Add: `llmProvider: 'openai' | 'azure-openai'`
    - Add a comment block: `// LLM Provider Switch` and `// Spec 2026-03-06: Azure OpenAI LLM Provider`
  - [x] 1.3 Add six Azure-specific config fields to the `Config` interface
    - File: `gateway/src/config.ts`, after the `llmProvider` field
    - Fields: `azureAuthEndpoint: string`, `azureApiUsername: string`, `azureApiPassword: string`, `azureChatEndpoint: string`, `azureApiVersion: string`, `azureApiModel: string`
    - Add a comment block: `// Azure OpenAI Configuration`
  - [x] 1.4 Populate new fields in `loadConfig()` from environment variables
    - File: `gateway/src/config.ts`, inside the return object of `loadConfig()` (line ~143)
    - `llmProvider`: read from `process.env.LLM_PROVIDER`, default to `'openai'`, cast to union type
    - Six Azure fields: read from `AZURE_AUTH_ENDPOINT`, `AZURE_API_USERNAME`, `AZURE_API_PASSWORD`, `AZURE_CHAT_ENDPOINT`, `AZURE_API_VERSION`, `AZURE_API_MODEL`, each defaulting to `''`
  - [x] 1.5 Make `validateRequiredEnvVars()` conditional on `llmProvider`
    - File: `gateway/src/config.ts`, function at line 92
    - Read `process.env.LLM_PROVIDER` directly (since validation runs before config object is built)
    - When value is `'azure-openai'`: validate all six Azure env vars are present and non-empty; do NOT require `OPENAI_API_KEY`; throw descriptive error listing all missing vars
    - When value is `'openai'` or unset: keep existing `OPENAI_API_KEY` check unchanged
  - [x] 1.6 Ensure config tests pass
    - Run ONLY `gateway/src/__tests__/config-azure-provider.test.ts`
    - Also run `gateway/src/__tests__/config.test.ts` to confirm no regression in existing config behaviour

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- Existing config tests continue to pass (no regression)
- `llmProvider` defaults to `'openai'` when `LLM_PROVIDER` is unset
- Azure fields default to empty string when not set
- Startup validation correctly gates on `llmProvider` value

---

### Azure Client Implementation

#### Task Group 2: Azure OpenAI Client
**Dependencies:** Task Group 1

- [x] 2.0 Complete Azure OpenAI client implementation
  - [x] 2.1 Write 8 focused tests for Azure client
    - Test 1: `fetchBearerToken` sends POST to `azureAuthEndpoint` with Basic auth header and returns trimmed token text
    - Test 2: `fetchBearerToken` throws `AzureOpenAIError` on non-2xx response with status code and body in message
    - Test 3: Token caching -- second call within 5 minutes reuses cached token (no second fetch)
    - Test 4: Token expiry -- call after 5 minutes fetches a new token
    - Test 5: `sendChatRequest` constructs correct URL: `${azureChatEndpoint}/${azureApiModel}/chat/completions?api-version=${azureApiVersion}`
    - Test 6: `sendChatRequest` sends Bearer token in Authorization header and correct JSON body (model, messages, tools, tool_choice)
    - Test 7: `sendChatRequest` maps response to `OpenAIResponse` shape (id, content, toolCalls, isFinal, usage)
    - Test 8: `sendChatRequest` throws `AzureOpenAIError` on non-2xx chat response
    - Place tests in: `gateway/src/__tests__/azureOpenaiClient.test.ts`
    - Mock `global.fetch` for all HTTP interactions (follow pattern from `implementationLlmProxyClient`)
    - Use `resetAzureTokenCache()` in `beforeEach` to ensure test isolation
  - [x] 2.2 Create `gateway/src/services/azureOpenaiClient.ts` with module structure
    - Module-level variables: `let cachedToken: string | null = null`, `let tokenFetchedAt: number = 0`
    - Constant: `const TOKEN_TTL_MS = 5 * 60 * 1000`
    - Export `resetAzureTokenCache(): void` for testing (sets both variables to initial values)
    - Internal function `isTokenExpired(): boolean` -- returns `true` when `cachedToken` is null or `Date.now() - tokenFetchedAt >= TOKEN_TTL_MS`
    - Import `Config` from `../config`, `logger` from `./logger`
    - Import `OpenAIMessage`, `OpenAIResponse`, `ChatRequestOptions` from `./openaiClient` (types only)
    - Import `ToolCall` from `../types`
  - [x] 2.3 Implement `fetchBearerToken(config: Config): Promise<string>`
    - POST to `config.azureAuthEndpoint` with headers: `Content-Type: application/json`, `Authorization: Basic <base64(username:password)>`
    - Use `Buffer.from(\`${config.azureApiUsername}:${config.azureApiPassword}\`).toString('base64')` for encoding
    - On success: read body via `response.text()`, trim whitespace, store in `cachedToken`, update `tokenFetchedAt = Date.now()`
    - On non-2xx: throw Error with `name = 'AzureOpenAIError'`, include status code and response body snippet in message
    - Add debug logging (do NOT log token value or credentials)
  - [x] 2.4 Implement `getValidToken(config: Config): Promise<string>`
    - If `isTokenExpired()`, call `fetchBearerToken(config)` and return the new token
    - Otherwise return `cachedToken!`
    - This is the internal function called before every chat request
  - [x] 2.5 Implement `sendChatRequest` method satisfying the `LlmClient` interface
    - Call `getValidToken(config)` to get a bearer token
    - Construct URL: `${config.azureChatEndpoint}/${config.azureApiModel}/chat/completions?api-version=${config.azureApiVersion}`
    - Build JSON body from messages and options: `model`, `messages`, optionally `tools`, `tool_choice`, `response_format` (for jsonMode), `temperature`, `max_completion_tokens`
    - Follow the same options-to-body mapping as `openaiClient.ts` lines 200-225 (jsonMode, tools, toolChoice, temperature, maxTokens)
    - POST with headers: `Authorization: Bearer <token>`, `Content-Type: application/json`
    - Parse JSON response
    - Map to `OpenAIResponse`: extract `id`, `content` from `choices[0].message.content`, parse `tool_calls` from `choices[0].message.tool_calls` (replicate `parseToolCalls` logic from `openaiClient.ts` lines 92-104), extract `usage` fields
    - On non-2xx: throw Error with `name = 'AzureOpenAIError'`, include status code, body snippet, and requestId
    - Add debug logging for request/response metadata (model, message count, duration)
  - [x] 2.6 Export the Azure client as an `LlmClient`-compatible object or class
    - Export a factory function (e.g., `createAzureOpenAIClient(config: Config): LlmClient`) that returns an object with `sendChatRequest` bound to the provided config
    - The returned object satisfies the `LlmClient` interface (defined in Task Group 3)
  - [x] 2.7 Ensure Azure client tests pass
    - Run ONLY `gateway/src/__tests__/azureOpenaiClient.test.ts`
    - Verify all 8 tests pass

**Acceptance Criteria:**
- All 8 tests written in 2.1 pass
- Token fetch uses correct Basic auth encoding
- Token caching respects the 5-minute TTL
- Chat request constructs the correct URL with api-version query parameter
- Response is mapped to exact `OpenAIResponse` shape
- Errors use the `AzureOpenAIError` name
- No modifications to `openaiClient.ts`

---

### LLM Client Interface and Factory

#### Task Group 3: LlmClient Interface, Factory, and Barrel Exports
**Dependencies:** Task Group 1, Task Group 2

- [x] 3.0 Complete LlmClient interface and factory pattern
  - [x] 3.1 Write 4 focused tests for the LlmClient factory
    - Test 1: `createLlmClient` with `llmProvider: 'openai'` returns an object whose `sendChatRequest` delegates to `openaiClient.sendChatRequest`
    - Test 2: `createLlmClient` with `llmProvider: 'azure-openai'` returns an Azure client instance
    - Test 3: `getLlmClient()` lazily creates a singleton and returns the same instance on subsequent calls
    - Test 4: `getLlmClient()` uses `getConfig()` to determine provider
    - Place tests in: `gateway/src/__tests__/llmClient.test.ts`
    - Mock both `openaiClient.sendChatRequest` and `azureOpenaiClient.createAzureOpenAIClient`
  - [x] 3.2 Create `gateway/src/services/llmClient.ts` with the `LlmClient` interface
    - Define interface: `export interface LlmClient { sendChatRequest(messages: OpenAIMessage[], requestId: string, sessionId: string, options?: ChatRequestOptions): Promise<OpenAIResponse> }`
    - Import `OpenAIMessage`, `OpenAIResponse`, `ChatRequestOptions` from `./openaiClient`
  - [x] 3.3 Implement `createLlmClient(config: Config): LlmClient` factory function
    - When `config.llmProvider === 'openai'`: import `sendChatRequest` from `./openaiClient` and wrap it in an object: `{ sendChatRequest }`
    - When `config.llmProvider === 'azure-openai'`: import `createAzureOpenAIClient` from `./azureOpenaiClient` and return the result
    - This function is called once to create the client
  - [x] 3.4 Implement `getLlmClient(): LlmClient` singleton convenience function
    - Module-level variable: `let _llmClient: LlmClient | null = null`
    - On first call: create via `createLlmClient(getConfig())` and cache
    - Return the cached instance on subsequent calls
    - Export `resetLlmClient(): void` for testing (sets `_llmClient = null`)
  - [x] 3.5 Re-export `buildToolResultMessages` from `llmClient.ts` for convenience
    - Add: `export { buildToolResultMessages } from './openaiClient'`
    - This allows consumers to import both `getLlmClient` and `buildToolResultMessages` from the same module
  - [x] 3.6 Update barrel exports in `gateway/src/services/index.ts`
    - Add a new export block after the existing `openaiClient` exports (after line 47)
    - Export: `getLlmClient`, `createLlmClient`, `LlmClient`, `resetLlmClient` from `./llmClient`
    - Add a comment block: `// LLM Client Factory (Spec 2026-03-06: Azure OpenAI LLM Provider)`
    - Keep all existing `openaiClient` exports unchanged
  - [x] 3.7 Ensure factory tests pass
    - Run ONLY `gateway/src/__tests__/llmClient.test.ts`
    - Verify all 4 tests pass

**Acceptance Criteria:**
- All 4 tests written in 3.1 pass
- `LlmClient` interface matches the `sendChatRequest` signature from `openaiClient.ts`
- Factory correctly routes to the appropriate provider based on config
- Singleton pattern works correctly with lazy initialization
- `buildToolResultMessages` is re-exported for consumer convenience
- Barrel exports are updated without disturbing existing exports

---

### Route Integration

#### Task Group 4: Consumer Integration (chatV2.ts and threadSummariser.ts)
**Dependencies:** Task Group 3

- [x] 4.0 Complete consumer integration
  - [x] 4.1 Write 3 focused tests for consumer integration
    - Test 1: `chatV2.ts` calls `getLlmClient().sendChatRequest(...)` instead of directly calling `sendChatRequest(...)` -- verify via mock that the factory-provided client is invoked
    - Test 2: `threadSummariser.ts` calls `getLlmClient().sendChatRequest(...)` instead of directly calling `sendChatRequest(...)` -- verify via mock
    - Test 3: Existing chatV2 integration test continues to pass (pick one from `gateway/src/__tests__/chatV2-integration.test.ts` and run it to verify no regression)
    - Place tests in: `gateway/src/__tests__/llmClient-integration.test.ts`
  - [x] 4.2 Update imports in `gateway/src/routes/chatV2.ts`
    - Line 46: Change from `import { sendChatRequest, OpenAIMessage, ContentPart } from '../services/openaiClient'` to:
      - `import { OpenAIMessage, ContentPart } from '../services/openaiClient'` (types only)
      - `import { getLlmClient } from '../services/llmClient'`
    - This is a two-line import change; no other code in this line range changes
  - [x] 4.3 Replace all `sendChatRequest(...)` call sites in `chatV2.ts` with `getLlmClient().sendChatRequest(...)`
    - Line 946: `await sendChatRequest(...)` --> `await getLlmClient().sendChatRequest(...)`
    - Line 977: `await sendChatRequest(...)` --> `await getLlmClient().sendChatRequest(...)`
    - Line 1078: `await sendChatRequest(...)` --> `await getLlmClient().sendChatRequest(...)`
    - Line 1105: `await sendChatRequest(...)` --> `await getLlmClient().sendChatRequest(...)`
    - Line 1204: `await sendChatRequest(...)` --> `await getLlmClient().sendChatRequest(...)`
    - Line 1231: `await sendChatRequest(...)` --> `await getLlmClient().sendChatRequest(...)`
    - Line 1297: `await sendChatRequest(...)` --> `await getLlmClient().sendChatRequest(...)`
    - Line 2436: `await sendChatRequest(...)` --> `await getLlmClient().sendChatRequest(...)`
    - This is a mechanical find-and-replace; no logic changes
  - [x] 4.4 Update imports in `gateway/src/services/threadSummariser.ts`
    - Line 21: Change from `import { sendChatRequest, OpenAIMessage } from './openaiClient'` to:
      - `import { OpenAIMessage } from './openaiClient'` (type only)
      - `import { getLlmClient } from './llmClient'`
  - [x] 4.5 Replace `sendChatRequest(...)` call in `threadSummariser.ts`
    - Line 131: `await sendChatRequest(messages, requestId, 'summarisation', {...})` --> `await getLlmClient().sendChatRequest(messages, requestId, 'summarisation', {...})`
  - [x] 4.6 Verify no other files directly import `sendChatRequest` from `openaiClient` that should be migrated
    - The v1 chat route (`gateway/src/routes/chat.ts`) should NOT be changed (explicitly out of scope)
    - Any test files that mock `sendChatRequest` from `openaiClient` do not need to change (they still test at the unit level)
    - Only `chatV2.ts` and `threadSummariser.ts` are in scope for migration
  - [x] 4.7 Ensure integration tests pass
    - Run `gateway/src/__tests__/llmClient-integration.test.ts`
    - Run `gateway/src/__tests__/chatV2-integration.test.ts` to verify no regression
    - Run `gateway/src/__tests__/threadSummariser.test.ts` to verify no regression

**Acceptance Criteria:**
- All 3 tests written in 4.1 pass
- `chatV2.ts` no longer directly imports `sendChatRequest` from `openaiClient`
- `threadSummariser.ts` no longer directly imports `sendChatRequest` from `openaiClient`
- Both files import `getLlmClient` from `llmClient` and call `getLlmClient().sendChatRequest(...)`
- `OpenAIMessage`, `ContentPart` types are still imported from `openaiClient` (type-only usage)
- The v1 chat route (`chat.ts`) is completely untouched
- Existing chatV2 and threadSummariser tests still pass

---

### Verification and Cleanup

#### Task Group 5: Test Review, Regression Check, and Cleanup
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review, verify, and clean up
  - [x] 5.1 Review all tests from Task Groups 1-4
    - Review 4 tests from Task Group 1 (config-azure-provider.test.ts)
    - Review 8 tests from Task Group 2 (azureOpenaiClient.test.ts)
    - Review 4 tests from Task Group 3 (llmClient.test.ts)
    - Review 3 tests from Task Group 4 (llmClient-integration.test.ts)
    - Total existing: 19 tests
  - [x] 5.2 Analyze test coverage gaps for this feature only
    - Identify any critical flows that lack coverage
    - Focus on: end-to-end provider switching, edge cases in token caching, error propagation
    - Do NOT assess entire application test coverage
  - [x] 5.3 Write up to 5 additional strategic tests to fill critical gaps
    - Potential gap: Config validation error message lists ALL missing Azure vars, not just the first
    - Potential gap: Azure client handles malformed JSON response from chat endpoint gracefully
    - Potential gap: `getLlmClient()` returns correct provider type after `resetLlmClient()` with changed config
    - Potential gap: Tool call parsing in Azure client matches the exact shape from `openaiClient.ts` `parseToolCalls`
    - Potential gap: `buildToolResultMessages` re-export from `llmClient.ts` works correctly
    - Place in: `gateway/src/__tests__/azure-openai-gaps.test.ts`
  - [x] 5.4 Run all feature-specific tests together
    - Run: `config-azure-provider.test.ts`, `azureOpenaiClient.test.ts`, `llmClient.test.ts`, `llmClient-integration.test.ts`, `azure-openai-gaps.test.ts`
    - Expected total: approximately 19-24 tests
    - Verify all pass
  - [x] 5.5 Run critical existing tests for regression check
    - Run: `config.test.ts` (existing config tests)
    - Run: `chatV2-integration.test.ts` (existing chatV2 tests)
    - Run: `chatV2-endpoint.test.ts` (existing endpoint tests)
    - Run: `threadSummariser.test.ts` (existing summariser tests)
    - Run: `services.test.ts` (barrel export smoke test if it exists)
    - Verify none of these are broken by the changes
  - [x] 5.6 Verify `openaiClient.ts` is completely unmodified
    - Confirm via `git diff gateway/src/services/openaiClient.ts` that zero changes were made
    - This is an explicit spec constraint
  - [x] 5.7 Verify `chat.ts` (v1 route) is completely untouched
    - Confirm via `git diff gateway/src/routes/chat.ts` that zero changes were made
    - This is an explicit spec constraint

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 19-24 tests total)
- Existing config, chatV2, and threadSummariser tests pass with no regressions
- `openaiClient.ts` has zero modifications
- `chat.ts` (v1 route) has zero modifications
- No more than 5 additional gap tests added
- All new files follow existing code patterns and conventions

---

## Execution Order

```
Task Group 1: Config Extension           (no dependencies -- start here)
       |
       v
Task Group 2: Azure Client              (depends on Config types from TG1)
       |
       v
Task Group 3: LlmClient Interface       (depends on Azure client from TG2)
       |
       v
Task Group 4: Consumer Integration      (depends on factory from TG3)
       |
       v
Task Group 5: Verification & Cleanup    (depends on all prior groups)
```

**Parallelization notes:**
- Task Groups 1 and 2 could partially overlap: TG2 test writing (2.1) can begin while TG1 implementation is in progress, since the test file only needs to know the Azure client's API shape (defined in the spec), not the final config code.
- Task Groups 2 and 3 could partially overlap: TG3 interface definition (3.2) can begin while TG2 implementation is in progress, since the interface is defined by the spec independently.
- Task Group 4 is strictly sequential after TG3 (it imports from the factory).
- Task Group 5 is strictly sequential after all implementation groups.

## File Summary

### New files to create:
| File | Task Group | Purpose |
|------|-----------|---------|
| `gateway/src/services/azureOpenaiClient.ts` | TG2 | Azure OpenAI provider with two-step auth |
| `gateway/src/services/llmClient.ts` | TG3 | LlmClient interface + factory + singleton |
| `gateway/src/__tests__/config-azure-provider.test.ts` | TG1 | Config extension tests |
| `gateway/src/__tests__/azureOpenaiClient.test.ts` | TG2 | Azure client tests |
| `gateway/src/__tests__/llmClient.test.ts` | TG3 | Factory and interface tests |
| `gateway/src/__tests__/llmClient-integration.test.ts` | TG4 | Consumer integration tests |
| `gateway/src/__tests__/azure-openai-gaps.test.ts` | TG5 | Gap analysis tests |

### Existing files to modify:
| File | Task Group | Change |
|------|-----------|--------|
| `gateway/src/config.ts` | TG1 | Add `llmProvider` + 6 Azure fields + conditional validation |
| `gateway/src/services/index.ts` | TG3 | Add barrel exports for `llmClient` |
| `gateway/src/routes/chatV2.ts` | TG4 | Swap import from `openaiClient` to `llmClient` |
| `gateway/src/services/threadSummariser.ts` | TG4 | Swap import from `openaiClient` to `llmClient` |

### Files explicitly NOT modified:
| File | Reason |
|------|--------|
| `gateway/src/services/openaiClient.ts` | Spec constraint: do not modify |
| `gateway/src/routes/chat.ts` | Spec constraint: v1 route untouched |
| Any frontend files | Spec constraint: entirely backend change |
