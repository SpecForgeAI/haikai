# Specification: Azure OpenAI LLM Provider

## Goal
Add a configurable Azure OpenAI LLM provider alongside the existing OpenAI provider so the gateway can route chat completion requests to an Azure-hosted OpenAI-compatible endpoint using a two-step auth flow (token fetch + chat request), without modifying any existing OpenAI provider code.

## User Stories
- As a platform operator, I want to switch the gateway's LLM backend to Azure OpenAI via a single config flag so that I can use my organisation's Azure-managed endpoint without code changes.
- As a developer, I want the Azure provider to produce the same `OpenAIResponse` shape as the existing provider so that all downstream route and service code works identically regardless of which provider is active.

## Specific Requirements

**LLM Provider config switch**
- Add `llmProvider` field to the `Config` interface with type `'openai' | 'azure-openai'`, defaulting to `'openai'`
- Env var: `LLM_PROVIDER` (values: `openai`, `azure-openai`)
- When `llmProvider` is `'openai'`, all existing behaviour is unchanged and Azure config fields are ignored
- When `llmProvider` is `'azure-openai'`, the Azure-specific config fields become required at startup validation

**Azure-specific config fields**
- `azureAuthEndpoint: string` -- env var `AZURE_AUTH_ENDPOINT` (e.g. `https://<host>/token`)
- `azureApiUsername: string` -- env var `AZURE_API_USERNAME`
- `azureApiPassword: string` -- env var `AZURE_API_PASSWORD`
- `azureChatEndpoint: string` -- env var `AZURE_CHAT_ENDPOINT` (e.g. `https://nwgateway-appdev.../genai/oai`)
- `azureApiVersion: string` -- env var `AZURE_API_VERSION` (e.g. `2025-11-13`)
- `azureApiModel: string` -- env var `AZURE_API_MODEL` (e.g. `gpt-5.1-2025-11-13`)
- All six fields default to empty string `''` in `loadConfig()` and are only validated when `llmProvider` is `'azure-openai'`

**Conditional startup validation**
- Modify `validateRequiredEnvVars()` in `config.ts` to accept the current `llmProvider` value (or read it from `process.env.LLM_PROVIDER` directly)
- When `llmProvider` is `'openai'`: validate `OPENAI_API_KEY` is present (existing behaviour)
- When `llmProvider` is `'azure-openai'`: validate that all six Azure env vars are present and non-empty; do NOT require `OPENAI_API_KEY`
- Throw a descriptive error listing any missing Azure env vars

**Azure token fetch (Step 1 of auth flow)**
- POST to `azureAuthEndpoint` with `Content-Type: application/json` header
- Include HTTP Basic auth via `Authorization: Basic <base64(username:password)>` header
- Use Node.js global `Buffer.from(username:password).toString('base64')` for encoding
- The response body is a plain-text bearer token string (not JSON)
- Read it via `response.text()`, trim whitespace
- On non-2xx response, throw an `AzureOpenAIError` with the status code and response body

**Azure token caching**
- Store the token and its fetch timestamp in module-level variables inside the Azure client file
- Before each chat request, check if the cached token is missing or older than 5 minutes (300,000 ms)
- If expired or missing, fetch a new token before proceeding
- This is a simple fixed TTL -- no parsing of `expires_in` or any response field

**Azure chat request (Step 2 of auth flow)**
- POST to `${azureChatEndpoint}/${azureApiModel}/chat/completions?api-version=${azureApiVersion}`
- Headers: `Authorization: Bearer <token>`, `Content-Type: application/json`
- Body: standard OpenAI chat completions JSON with `model`, `messages`, and optionally `tools`, `tool_choice`, `response_format`, `temperature`, `max_completion_tokens`
- Parse the response as JSON (standard OpenAI-compatible chat completion response)
- Map the response to the existing `OpenAIResponse` shape: `{ id, content, toolCalls, isFinal, usage }`
- Reuse the same tool-call parsing logic as the existing `openaiClient.ts` (extract `id`, `function.name`, `function.arguments` from `choices[0].message.tool_calls`)

**LlmClient interface and factory**
- Define an `LlmClient` interface in a new file `gateway/src/services/llmClient.ts` with a single method: `sendChatRequest(messages: OpenAIMessage[], requestId: string, sessionId: string, options?: ChatRequestOptions): Promise<OpenAIResponse>`
- `buildToolResultMessages` stays as a standalone function (it is pure logic with no provider-specific behaviour); re-export it from `llmClient.ts` for convenience
- Export a `createLlmClient(config: Config): LlmClient` factory function that returns the appropriate provider based on `config.llmProvider`
- When `'openai'`: wrap the existing `sendChatRequest` from `openaiClient.ts` into an object satisfying `LlmClient`
- When `'azure-openai'`: return the Azure client instance
- Export a `getLlmClient(): LlmClient` convenience function that lazily creates the client using `getConfig()`, similar to the singleton pattern used by `getConfig()` and `getOpenAIClient()`

**Azure client implementation file**
- Create `gateway/src/services/azureOpenaiClient.ts`
- Module-level variables for cached token: `let cachedToken: string | null = null` and `let tokenFetchedAt: number = 0`
- Constant `TOKEN_TTL_MS = 5 * 60 * 1000` (5 minutes)
- Internal function `fetchBearerToken(config: Config): Promise<string>` for the auth POST
- Internal function `isTokenExpired(): boolean` checking `Date.now() - tokenFetchedAt >= TOKEN_TTL_MS`
- Export `resetAzureTokenCache(): void` for testing (sets `cachedToken = null`, `tokenFetchedAt = 0`)
- The exported class or object implements `LlmClient` with the `sendChatRequest` method
- Use native `fetch()` for both HTTP requests (consistent with `implementationLlmProxyClient.ts`)

**AzureOpenAIError naming**
- All Azure-specific errors (token fetch failure, chat request failure, non-2xx responses) throw an `Error` with `error.name = 'AzureOpenAIError'`
- This is separate from the existing `'OpenAIError'` name used by the OpenAI provider
- Include status code, response body snippet, and request context (requestId) in the error message

**Integration into chatV2.ts**
- Change the import on line 46 from `import { sendChatRequest, OpenAIMessage, ContentPart } from '../services/openaiClient'` to import `OpenAIMessage` and `ContentPart` from `openaiClient` (types only) and import `getLlmClient` from `llmClient`
- At each call site currently calling `sendChatRequest(...)`, replace with `getLlmClient().sendChatRequest(...)`
- This is a mechanical find-and-replace; no logic changes required

**Integration into threadSummariser.ts**
- Same pattern: change line 21 import to get `getLlmClient` from `llmClient` and `OpenAIMessage` from `openaiClient`
- Replace `sendChatRequest(...)` call on line 131 with `getLlmClient().sendChatRequest(...)`

**Barrel export update**
- In `gateway/src/services/index.ts`, add re-exports from the new `llmClient.ts` file: `getLlmClient`, `createLlmClient`, `LlmClient`
- Keep existing `openaiClient` re-exports unchanged (other consumers like `chat.ts` v1 route still use them directly)

**Preserve existing OpenAI code**
- Do NOT modify `gateway/src/services/openaiClient.ts` in any way
- Do NOT rename any existing `OpenAI*` types
- Do NOT remove the `openai` npm dependency
- The v1 chat route (`chat.ts`) continues to import directly from `openaiClient` and is not touched

## Visual Design
No visual assets provided. This is an entirely backend/infrastructure change with no UI impact.

## Existing Code to Leverage

**`gateway/src/services/implementationLlmProxyClient.ts` -- native fetch pattern**
- Uses Node.js global `fetch()` with Bearer token injection, which is the exact pattern needed for the Azure chat request
- Demonstrates fail-fast error checking for missing config values before making HTTP calls
- Shows debug logging without exposing sensitive data (token values, passwords)
- The `postJson()` helper's request construction (method, headers, JSON body) is a direct template for the Azure chat POST

**`gateway/src/services/openaiClient.ts` -- response mapping and type definitions**
- The `OpenAIResponse` interface (lines 70-87) defines the exact shape the Azure provider must produce
- The `parseToolCalls()` function (lines 92-104) shows how to extract `callId`, `name`, `arguments` from raw tool call objects -- Azure should replicate this logic
- The `ChatRequestOptions` interface (lines 118-163) defines `jsonMode`, `tools`, `toolChoice`, `temperature`, `maxTokens` -- the Azure provider must honour these same options
- The `sendChatRequest` function (lines 176-277) shows how to build `createParams` from options -- Azure must construct an equivalent JSON body

**`gateway/src/config.ts` -- config extension pattern**
- Shows how to add fields to the `Config` interface and populate them from `process.env` in `loadConfig()`
- `validateRequiredEnvVars()` at line 92 is where conditional validation logic will be added
- `parseIntEnv`, `parseBoolEnv` helpers are available if needed for any Azure config parsing

**`gateway/src/services/index.ts` -- barrel export pattern**
- Lines 38-47 show the existing re-export pattern for `openaiClient`; the new `llmClient` exports should follow this same grouped pattern with a comment block

## Out of Scope
- Modifying `gateway/src/services/openaiClient.ts` in any way
- Removing or replacing the `openai` npm SDK dependency
- Streaming support (`sendStreamingRequest`) for the Azure provider
- Renaming existing `OpenAI*` types to provider-neutral names
- Azure AD / Managed Identity authentication (only Basic auth token fetch is supported)
- Multi-region failover or endpoint discovery
- Request retry logic within the Azure client (retries remain a route-layer concern)
- Rate limiting differences between providers
- Any frontend changes (LLM provider selection is entirely a backend concern)
- Changes to the v1 chat route (`chat.ts`) -- it continues to use `openaiClient` directly
