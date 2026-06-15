# Spec: Gateway Chat Orchestrator

## Overview

Introduce a new Gateway service that receives chat messages from the frontend, calls the OpenAI API (LLM), executes tool calls by invoking the existing MCP server (4 tools), and returns the final assistant response to the frontend (optionally streaming). The LLM is an external component (OpenAI API). The Gateway is the only component that holds OpenAI credentials. MCP and architecture-model-service already exist.

## Problem Statement

### Current State
- MCP server provides 4 tools: `list_interfaces`, `get_interface_oas_context`, `compute_oas_gaps`, `save_oas_spec`
- No orchestration layer exists to connect a frontend chat UI to an LLM that can use these tools
- No way for users to conversationally generate and save OpenAPI specs

### Desired State
- Gateway service orchestrates chat conversations between frontend and OpenAI
- Gateway executes tool calls against MCP server on behalf of the LLM
- Users can conversationally explore interfaces, analyze gaps, and save generated OAS specs
- Supports both streaming (SSE) and non-streaming response modes

## Solution

Create a new Node.js/TypeScript Gateway service that:
1. Exposes HTTP endpoints for frontend chat UI
2. Manages conversation state using OpenAI's conversation ID feature
3. Calls OpenAI Responses API with tool definitions for the 4 MCP tools
4. Executes tool calls by proxying to MCP server
5. Streams or returns final assistant responses to the frontend

## Requirements

### Functional Requirements

#### Gateway Service Configuration

**Runtime:** Node.js with TypeScript
**Framework:** Express
**Port:** 8081 (configurable)

**Environment Variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8081` | Gateway server port |
| `OPENAI_API_KEY` | (required) | OpenAI API key |
| `OPENAI_MODEL` | `gpt-4o` | OpenAI model to use |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI API base URL |
| `OPENAI_TIMEOUT_MS` | `60000` | OpenAI request timeout |
| `MCP_BASE_URL` | `http://localhost:8090` | MCP server base URL |
| `MAX_TOOL_CALLS_PER_TURN` | `8` | Max tool calls per conversation turn |
| `MAX_OAS_BYTES` | `2097152` | Max OAS content size (2MB) |
| `MAX_MESSAGE_BYTES` | `32768` | Max user message size (32KB) |
| `RATE_LIMIT_RPM` | `60` | Rate limit requests per minute per IP |
| `RATE_LIMIT_BURST` | `20` | Rate limit burst allowance |
| `SESSION_TTL_HOURS` | `24` | Session expiration time |
| `LOG_LEVEL` | `info` | Logging level |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | CORS allowed origins (comma-separated) |
| `ENABLE_TOOL_TRACE` | `false` | Include tool trace in responses |

#### REST API Endpoints

##### POST /api/chat

Send a user chat message and receive an assistant response (non-streaming).

**Request Body:**

```typescript
interface ChatRequest {
  sessionId: string;          // Client-generated or Gateway-generated session ID
  message: string;            // User message (required, max MAX_MESSAGE_BYTES)
  context?: {                 // Optional UI context
    filename?: string;        // Architecture model filename
    interfaceId?: string;     // Selected interface ID
    draftOas?: string;        // Partial OAS pasted by user
    preferredFormat?: 'yaml' | 'json';
  };
}
```

**Response Body:**

```typescript
interface ChatResponse {
  sessionId: string;
  assistant: {
    message: string;          // Assistant response text
    toolTrace?: ToolTraceItem[];  // Optional debug info (if ENABLE_TOOL_TRACE)
    artifacts?: {
      savedSpec?: SaveOasSpecSummaryDto;  // If save_oas_spec was called
    };
  };
}

interface ToolTraceItem {
  toolName: string;
  status: number;
  durationMs: number;
}
```

**Status Codes:**

| Code | Condition |
|------|-----------|
| 200 OK | Successful response |
| 400 Bad Request | Invalid request (missing sessionId/message, too large, etc.) |
| 429 Too Many Requests | Rate limit exceeded |
| 502 Bad Gateway | OpenAI or MCP error |
| 500 Internal Server Error | Unexpected error |

##### GET /api/chat/stream

Server-Sent Events stream for chat responses (streaming).

**Query Parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `sessionId` | Yes | Session ID |
| `message` | Yes | User message (URL-encoded) |
| `filename` | No | Architecture filename context |
| `interfaceId` | No | Interface ID context |
| `preferredFormat` | No | `yaml` or `json` |

Note: `draftOas` is NOT supported via streaming endpoint due to URL length limits. Use POST /api/chat for draftOas.

**Response:** `text/event-stream`

**Event Types:**

```
event: token
data: {"content": "partial text"}

event: tool_call_started
data: {"toolName": "list_interfaces", "callId": "call_123"}

event: tool_call_finished
data: {"toolName": "list_interfaces", "callId": "call_123", "status": 200, "durationMs": 150}

event: final
data: {"message": "full response", "artifacts": {...}}

event: error
data: {"code": 502, "message": "OpenAI error"}
```

##### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-12-16T10:30:00.000Z"
}
```

#### Tool Integration

**Strategy:** OpenAI function/tool calling; Gateway executes tools by calling MCP endpoints.

**Allowed Tools (Strict Allow-List):**

| Tool Name | MCP Endpoint | Description |
|-----------|--------------|-------------|
| `list_interfaces` | POST /mcp/tools/list_interfaces | List interfaces for a model file |
| `get_interface_oas_context` | POST /mcp/tools/get_interface_oas_context | Get interface details for OAS generation |
| `compute_oas_gaps` | POST /mcp/tools/compute_oas_gaps | Analyze gaps in interface data |
| `save_oas_spec` | POST /mcp/tools/save_oas_spec | Save generated OAS to disk |

**Tool Schemas for OpenAI:**

```typescript
const tools = [
  {
    type: 'function',
    function: {
      name: 'list_interfaces',
      description: 'List all interfaces for a given architecture model filename',
      parameters: {
        type: 'object',
        required: ['filename'],
        properties: {
          filename: { type: 'string', description: 'Architecture model filename' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_interface_oas_context',
      description: 'Get full OAS-ready context for a specific interface including endpoints, logical entities, and service details',
      parameters: {
        type: 'object',
        required: ['interfaceId'],
        properties: {
          interfaceId: { type: 'string', description: 'Interface ID' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'compute_oas_gaps',
      description: 'Compute gaps, defaults, type mappings, and operationId suggestions for OAS generation',
      parameters: {
        type: 'object',
        required: ['interfaceId'],
        properties: {
          interfaceId: { type: 'string', description: 'Interface ID' },
          draftOas: { type: 'string', description: 'Optional draft OAS content' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'save_oas_spec',
      description: 'Save a generated OpenAPI spec to disk and update the interface record',
      parameters: {
        type: 'object',
        required: ['filename', 'interfaceId', 'format', 'oasContents'],
        properties: {
          filename: { type: 'string', description: 'Architecture model filename' },
          interfaceId: { type: 'string', description: 'Interface ID' },
          format: { type: 'string', enum: ['yaml', 'json'], description: 'Output format' },
          oasContents: { type: 'string', description: 'Full OpenAPI spec content' }
        }
      }
    }
  }
];
```

#### Session Management

**Gateway Session State:**

```typescript
interface GatewaySession {
  sessionId: string;              // Frontend session ID
  mcpSessionId: string;           // Internal MCP session ID (generated by Gateway)
  openaiConversationId?: string;  // OpenAI conversation ID for history
  filename?: string;              // Last used architecture filename
  interfaceId?: string;           // Last selected interface ID
  lastDraftOas?: string;          // Last draft OAS (for context)
  lastSavedSpecSummary?: SaveOasSpecSummaryDto;
  createdAt: Date;
  lastActivity: Date;
}
```

**Session Behavior:**
- Gateway generates internal `mcpSessionId` for MCP tool calls (frontend never sees this)
- OpenAI conversation history is maintained via `openaiConversationId` using OpenAI's Responses API conversation feature
- Sessions expire after `SESSION_TTL_HOURS` (default 24h)
- Session cleanup runs periodically to prevent memory growth
- UI context (filename, interfaceId) from requests is stored in session for subsequent turns

#### Conversation Flow

**Agent Loop Algorithm:**

```
1. Receive user message + optional context
2. Get or create session
3. Build OpenAI request:
   - Use existing openaiConversationId if available
   - Include system prompt + tools
   - Add user message as input
4. Send to OpenAI Responses API
5. If response requests tool calls:
   a. For each tool call (up to MAX_TOOL_CALLS_PER_TURN):
      - Validate tool name is in allow-list
      - Validate arguments against schema
      - Execute tool by calling MCP endpoint
      - Collect result or error
   b. Send tool results back to OpenAI
   c. Repeat from step 4
6. When final assistant message received:
   - Store openaiConversationId for future turns
   - Extract any artifacts (e.g., savedSpec from save_oas_spec)
   - Return response to frontend
```

#### System Prompt (Policy)

The system instruction must enforce:

1. **Prefer tools over guessing:** Always use tools to retrieve architecture facts rather than fabricating data.

2. **Gap-driven questioning:** When `compute_oas_gaps` returns BLOCKING or RECOMMENDED gaps, ask the user for the missing information before proceeding.

3. **No fabrication:** Never invent endpoints, paths, or schemas not present in `get_interface_oas_context` output unless the user explicitly provides them.

4. **Confirmation before save:** Only call `save_oas_spec` after the user explicitly confirms the final OAS content or requests to save.

5. **Context awareness:** Use provided context (filename, interfaceId, draftOas, preferredFormat) to reduce unnecessary questions.

**Example System Prompt:**

```
You are an OpenAPI specification assistant that helps users generate and save OpenAPI specs for their architecture interfaces.

RULES:
1. Always use the available tools to retrieve interface data. Never guess or fabricate endpoints, schemas, or paths.
2. When compute_oas_gaps returns gaps, explain them to the user and ask for the missing information.
3. Only call save_oas_spec when the user explicitly confirms they want to save the spec.
4. Use the user's preferred format (yaml/json) when generating specs.
5. Be concise and helpful. Guide the user through the process step by step.

AVAILABLE CONTEXT:
- filename: {filename or "not provided"}
- interfaceId: {interfaceId or "not provided"}
- preferredFormat: {preferredFormat or "yaml"}
```

#### Safety and Limits

**Input Validation:**
- Reject messages exceeding `MAX_MESSAGE_BYTES` (32KB default)
- Reject draftOas/oasContents exceeding `MAX_OAS_BYTES` (2MB default)
- Validate sessionId is non-empty string
- Validate format is 'yaml' or 'json' when provided

**Tool Execution Safety:**
- Strict allow-list: Only execute tools in the allowed_tools list
- Schema validation: Validate tool arguments before execution
- Bounded iterations: Max `MAX_TOOL_CALLS_PER_TURN` tool calls per conversation turn
- Timeout: Tool calls timeout after reasonable duration (use MCP's existing timeouts)

**Rate Limiting:**
- Apply per-IP rate limiting to /api/chat and /api/chat/stream
- `RATE_LIMIT_RPM` requests per minute with `RATE_LIMIT_BURST` burst allowance

**CORS:**
- Restrict to `ALLOWED_ORIGINS`

**Secret Protection:**
- Never log or return `OPENAI_API_KEY`
- Do not expose internal error details to clients

#### Observability

**Logging:**
- Add `requestId` middleware for correlation
- Log per request: sessionId, requestId, tool calls (name, duration, status), OpenAI latency
- Log token usage when available from OpenAI response
- Do NOT log full OAS contents (log length + hash only for debugging)

**Structured Logs:**
```json
{
  "level": "info",
  "requestId": "req_abc123",
  "sessionId": "sess_xyz789",
  "event": "tool_call",
  "toolName": "list_interfaces",
  "durationMs": 150,
  "status": 200
}
```

#### Error Handling

| Error Source | HTTP Response | Behavior |
|--------------|---------------|----------|
| OpenAI API error | 502 Bad Gateway | Return safe message, log details |
| OpenAI timeout | 502 Bad Gateway | Return timeout message |
| MCP tool error | Varies | Feed error to model for retry/user notification |
| MCP unreachable | 502 Bad Gateway | Return safe message |
| Validation error | 400 Bad Request | Return specific validation message |
| Rate limit | 429 Too Many Requests | Return retry-after header |
| Unknown error | 500 Internal Server Error | Return safe message, log details |

### Non-Functional Requirements

1. **Stateful conversations:** Full conversation history via OpenAI conversation ID
2. **Streaming support:** SSE streaming for real-time token delivery
3. **Security:** Never leak secrets, strict tool allow-list
4. **Observability:** Structured logging with correlation IDs
5. **Resilience:** Graceful handling of OpenAI/MCP failures

## Technical Design

### Project Structure

```
gateway/
├── package.json
├── tsconfig.json
├── .env.example
├── src/
│   ├── server.ts                    # Express bootstrap
│   ├── config.ts                    # Environment config
│   ├── routes/
│   │   └── chat.ts                  # Chat endpoints
│   ├── services/
│   │   ├── openaiClient.ts          # OpenAI Responses API wrapper
│   │   ├── toolExecutor.ts          # Tool allow-list + MCP caller
│   │   ├── sessionStore.ts          # In-memory session store
│   │   └── promptBuilder.ts         # System prompt construction
│   ├── types/
│   │   ├── index.ts                 # Type exports
│   │   ├── chat.ts                  # Chat request/response types
│   │   ├── session.ts               # Session types
│   │   └── tools.ts                 # Tool-related types
│   ├── middleware/
│   │   ├── cors.ts                  # CORS middleware
│   │   ├── rateLimit.ts             # Rate limiting
│   │   ├── requestId.ts             # Request ID injection
│   │   ├── errorHandler.ts          # Global error handler
│   │   └── validateRequest.ts       # Input validation
│   └── __tests__/
│       ├── chat.test.ts             # Chat endpoint tests
│       ├── openaiClient.test.ts     # OpenAI client tests
│       ├── toolExecutor.test.ts     # Tool executor tests
│       └── sessionStore.test.ts     # Session store tests
```

### Files to Create

| File | Description |
|------|-------------|
| `gateway/package.json` | Package configuration |
| `gateway/tsconfig.json` | TypeScript configuration |
| `gateway/.env.example` | Environment variable template |
| `gateway/src/server.ts` | Express server bootstrap |
| `gateway/src/config.ts` | Configuration loader |
| `gateway/src/routes/chat.ts` | Chat route handlers |
| `gateway/src/services/openaiClient.ts` | OpenAI API client |
| `gateway/src/services/toolExecutor.ts` | Tool execution service |
| `gateway/src/services/sessionStore.ts` | Session management |
| `gateway/src/services/promptBuilder.ts` | Prompt construction |
| `gateway/src/types/index.ts` | Type exports |
| `gateway/src/types/chat.ts` | Chat types |
| `gateway/src/types/session.ts` | Session types |
| `gateway/src/types/tools.ts` | Tool types |
| `gateway/src/middleware/cors.ts` | CORS middleware |
| `gateway/src/middleware/rateLimit.ts` | Rate limiter |
| `gateway/src/middleware/requestId.ts` | Request ID middleware |
| `gateway/src/middleware/errorHandler.ts` | Error handler |
| `gateway/src/middleware/validateRequest.ts` | Request validation |

### Request Flow

```
POST /api/chat
        │
        ▼
┌─────────────────────────┐
│  Middleware Pipeline    │
│  - CORS                 │
│  - Rate Limit           │
│  - Request ID           │
│  - Validate Request     │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  Get/Create Session     │
│  - Generate mcpSessionId│
│  - Load conversation    │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  Build OpenAI Request   │
│  - System prompt        │
│  - User message         │
│  - Tools                │
│  - Conversation ID      │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  OpenAI Responses API   │◄──────────────┐
│  (with conversation)    │               │
└───────────┬─────────────┘               │
            │                             │
            ▼                             │
    ┌───────────────┐                     │
    │ Tool Calls?   │──No──┐              │
    └───────┬───────┘      │              │
            │Yes           │              │
            ▼              │              │
┌─────────────────────────┐│              │
│  Execute Tools via MCP  ││              │
│  (bounded loop)         ││              │
└───────────┬─────────────┘│              │
            │              │              │
            ▼              │              │
┌─────────────────────────┐│              │
│  Send Tool Results      │├──────────────┘
│  Back to OpenAI         │
└─────────────────────────┘
            │
            │ (Final response)
            ▼
┌─────────────────────────┐
│  Update Session         │
│  - Store conversation ID│
│  - Store context        │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  Return Response        │
│  - message              │
│  - toolTrace (optional) │
│  - artifacts            │
└─────────────────────────┘
```

### Streaming Flow

```
GET /api/chat/stream?sessionId=...&message=...
        │
        ▼
┌─────────────────────────┐
│  Same validation &      │
│  session setup          │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  OpenAI Streaming       │
│  (stream: true)         │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  Forward Events via SSE │
│  - token                │
│  - tool_call_started    │
│  - tool_call_finished   │
│  - final                │
└─────────────────────────┘
```

## Out of Scope

- Frontend UI changes (handled separately)
- MCP server modifications (already implemented)
- Architecture-model-service modifications (already implemented)
- Long-term chat transcript persistence (v1 in-memory only)
- User authentication/authorization (v2)
- Multi-tenant isolation (v2)

## Acceptance Criteria

1. **POST /api/chat works:**
   - Accepts sessionId + message
   - Returns assistant response with message
   - Supports optional context (filename, interfaceId, draftOas, preferredFormat)

2. **GET /api/chat/stream works:**
   - Streams tokens via SSE
   - Emits tool_call_started/finished events
   - Emits final event with complete response

3. **Tool execution:**
   - All 4 tools (list_interfaces, get_interface_oas_context, compute_oas_gaps, save_oas_spec) work
   - Tool allow-list is enforced (unknown tools rejected)
   - Tool calls are bounded by MAX_TOOL_CALLS_PER_TURN

4. **Session management:**
   - Conversation history is maintained via OpenAI conversation ID
   - Sessions expire after TTL
   - Context from requests is persisted in session

5. **Safety:**
   - Rate limiting is applied
   - Input size limits are enforced
   - CORS is restricted to allowed origins
   - Secrets are never exposed

6. **Error handling:**
   - OpenAI errors return 502
   - MCP errors are handled gracefully
   - Validation errors return 400

## Verification Steps

### Unit Tests

1. **sessionStore.test.ts:**
   - Test session creation
   - Test session retrieval
   - Test session update
   - Test session expiration

2. **toolExecutor.test.ts:**
   - Test execution of each allowed tool
   - Test rejection of unknown tool
   - Test argument validation
   - Test MCP error handling

3. **openaiClient.test.ts:**
   - Test non-streaming request
   - Test streaming request
   - Test tool call parsing
   - Test error handling

4. **chat.test.ts:**
   - Test POST /api/chat with valid request
   - Test POST /api/chat with missing sessionId
   - Test POST /api/chat with oversized message
   - Test GET /api/chat/stream
   - Test rate limiting

### Integration Tests

1. Test full conversation flow with mocked OpenAI
2. Test tool execution round-trip with mocked MCP
3. Test streaming event sequence

### Manual Verification

1. Start all services (architecture-model-service, mcp-server, gateway)
2. Send chat request to list interfaces
3. Send follow-up to get interface context
4. Send request to compute gaps
5. Send request to generate and save OAS spec
6. Verify file is saved and response includes savedPath

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| OpenAI API changes | Low | High | Abstract behind client wrapper |
| Tool call loops | Medium | Medium | Bounded by MAX_TOOL_CALLS_PER_TURN |
| Memory growth from sessions | Medium | Medium | TTL expiration + periodic cleanup |
| Rate limit bypass | Low | Medium | Use proven rate-limit library |
| Streaming connection drops | Medium | Low | Client-side retry logic (frontend) |
| Large OAS causes timeouts | Low | Medium | Size limits + streaming |
