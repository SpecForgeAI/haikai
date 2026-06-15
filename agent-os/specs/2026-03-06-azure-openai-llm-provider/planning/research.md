# Research Findings: Azure OpenAI LLM Provider

## 1. Current OpenAI Client (`gateway/src/services/openaiClient.ts`)

### Exports
The file exports the following public API:
- `resetOpenAIClient()` -- resets the lazy-initialized OpenAI SDK client instance (for testing)
- `ContentPart` type -- union of text, image_url, and file content parts for multimodal messages
- `OpenAIMessage` interface -- message format with role, content (string | ContentPart[]), optional tool_call_id and tool_calls
- `OpenAIResponse` interface -- response shape with id, content, toolCalls, isFinal, usage
- `ChatRequestOptions` interface -- options for sendChatRequest: jsonMode, tools, toolChoice, temperature, maxTokens
- `sendChatRequest(messages, requestId, sessionId, options?)` -- non-streaming chat completion using the OpenAI SDK
- `sendStreamingRequest(messages, requestId, sessionId)` -- streaming chat completion (async generator yielding token/tool_call/done events)
- `buildToolResultMessages(assistantMessage, results)` -- constructs tool result messages for multi-turn tool calling

### SDK Usage
Currently uses the official `openai` npm package (v4.24.1):
- Lazy-initializes an `OpenAI` client with `apiKey`, `baseURL`, and `timeout` from config
- Uses `client.chat.completions.create()` for both streaming and non-streaming
- Error handling catches `OpenAI.APIError` specifically and re-throws with context
- Handles reasoning model detection (o1, o3, gpt-5 patterns) to skip temperature parameter

### Key Behavior
- `sendChatRequest` supports: jsonMode (response_format: json_object), custom tools/toolChoice, temperature, maxTokens
- Tool definitions come from `../types/tools` TOOL_DEFINITIONS
- Token usage is logged via `logOpenAIRequest`
- Streaming support exists and is used by the v1 chat route (chat.ts), but NOT used by chatV2.ts

## 2. Consumers of openaiClient Exports

### Direct Importers (non-test files):
1. **`gateway/src/routes/chatV2.ts`** (line 46) -- imports `sendChatRequest`, `OpenAIMessage`, `ContentPart`
   - Uses `sendChatRequest` extensively for: main chat flow, /generate endpoints (mission, roadmap, architecture-baseline, tech-stack, test-strategy), /save-artifact endpoint
   - Does NOT use `sendStreamingRequest`
2. **`gateway/src/routes/chat.ts`** (lines 68-93) -- imports `sendChatRequest`, `sendStreamingRequest`, `buildToolResultMessages`, `OpenAIMessage`, `ContentPart`
   - Full v1 chat route using both streaming and non-streaming
3. **`gateway/src/routes/chatValidation.ts`** (line 19) -- imports `OpenAIMessage` type only
4. **`gateway/src/services/threadSummariser.ts`** (line 21) -- imports `sendChatRequest`, `OpenAIMessage`
   - Calls sendChatRequest for thread summarisation LLM calls
5. **`gateway/src/services/index.ts`** (lines 38-47) -- barrel re-export of all openaiClient exports
6. **`gateway/src/types/session.ts`** (lines 19-49) -- DUPLICATES `ContentPart` and `OpenAIMessage` types to avoid circular deps
7. **`gateway/src/types/index.ts`** (line 91) -- re-exports `OpenAIMessage` from session.ts

### Test files (30+ test files):
- All test files mock `../services/openaiClient` using `jest.mock`
- Pattern: `jest.mock('../services/openaiClient', () => ({ sendChatRequest: (...args) => mockFn(...args) }))`
- Tests never make real OpenAI calls; they mock at the module level

## 3. Current Config Structure (`gateway/src/config.ts`)

### OpenAI Config Fields:
- `openaiApiKey: string` -- REQUIRED, validated at startup (throws if missing)
- `openaiModel: string` -- default 'gpt-4o'
- `openaiBaseUrl: string` -- default 'https://api.openai.com/v1'
- `openaiTimeoutMs: number` -- default 1200000 (20 minutes)

### Config Pattern:
- Uses `dotenv` for env var loading
- Singleton pattern with lazy `getConfig()` + `resetConfig()` for testing
- `validateRequiredEnvVars()` runs at startup -- currently only checks OPENAI_API_KEY
- Helper functions: `parseIntEnv`, `parseBoolEnv`, `parseCommaSeparated`

## 4. Existing HTTP Client Pattern (`gateway/src/services/implementationLlmProxyClient.ts`)

This file provides a precedent for hand-crafted HTTP clients:
- Uses native `fetch()` directly (no axios or node-fetch)
- Exports `request()`, `postJson()`, `getJson()`, `requestStream()` functions
- Injects Bearer token from config on every request
- Fail-fast pattern: throws immediately if token/base URL not configured
- Debug logging without sensitive data
- AbortSignal support for cancellation

## 5. Route Layer Impact (`gateway/src/routes/chatV2.ts`)

Line 46: `import { sendChatRequest, OpenAIMessage, ContentPart } from '../services/openaiClient';`

The chatV2 route calls `sendChatRequest` in many places:
- Main POST /api/chat/v2 handler (line 2436)
- POST /api/chat/v2/generate endpoint for mission, roadmap, architecture-baseline, tech-stack, test-strategy (lines 946, 977, 1078, 1105, 1204, 1231, 1297)
- Thread summariser (called indirectly via maybeSummariseThread)

All calls use the same signature: `sendChatRequest(messages, requestId, sessionId/threadKey, options?)`. The route does NOT import the OpenAI SDK directly -- it only uses the wrapped functions.

## 6. Streaming Usage

- `sendStreamingRequest` is ONLY used by `chat.ts` (v1 route), NOT by chatV2.ts
- The v1 route at chat.ts line 1223 calls `sendStreamingRequest` for SSE streaming to the frontend
- chatV2.ts uses only non-streaming `sendChatRequest`

## 7. Dependencies

From `gateway/package.json`:
- `openai`: "^4.24.1" -- the official OpenAI SDK
- `axios`: "^1.6.2" -- available but not used for OpenAI calls
- Native `fetch` is available (Node.js 18+ global fetch, used by implementationLlmProxyClient.ts)

## 8. Type Duplication Issue

`OpenAIMessage` and `ContentPart` are defined in TWO places:
1. `gateway/src/services/openaiClient.ts` -- primary definition
2. `gateway/src/types/session.ts` -- duplicate to avoid circular deps

This duplication is noted in comments as intentional. The LlmClient interface will need to consider whether to keep the "OpenAI" naming or introduce provider-neutral type names.

## 9. Tool Definitions

- `TOOL_DEFINITIONS` is imported from `../types/tools` (not from the OpenAI SDK)
- Currently cast to `OpenAI.Chat.Completions.ChatCompletionTool[]` via `unknown`
- The tool definitions themselves are already in a generic format compatible with OpenAI's API

## 10. Error Handling

Current pattern in openaiClient.ts:
- Catches `OpenAI.APIError` specifically, wraps in a new Error with name 'OpenAIError'
- Logs error with requestId, sessionId, durationMs
- All other errors are re-thrown as-is
- No retry logic in the client itself (retry is handled at the route level for specific cases)
