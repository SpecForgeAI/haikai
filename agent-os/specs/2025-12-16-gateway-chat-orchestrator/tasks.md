# Task Breakdown: Gateway Chat Orchestrator

## Overview
Total Tasks: 38 (across 6 task groups)

This task breakdown covers the implementation of a new Node.js/TypeScript Express Gateway service that:
1. Receives chat messages from the frontend
2. Calls OpenAI Responses API with tool definitions
3. Executes tool calls by proxying to the MCP server (4 tools)
4. Returns responses (streaming via SSE or non-streaming)

## Task List

### Project Setup

#### Task Group 1: Project Initialization and Configuration
**Dependencies:** None

- [x] 1.0 Complete project setup and configuration
  - [x] 1.1 Write 2-4 focused tests for configuration loading
    - Test config loads required environment variables
    - Test config provides defaults for optional variables
    - Test config throws error when OPENAI_API_KEY is missing
    - Test config parses comma-separated ALLOWED_ORIGINS correctly
  - [x] 1.2 Create gateway directory structure
    - Create `gateway/` root directory
    - Create `gateway/src/` directory
    - Create subdirectories: `routes/`, `services/`, `types/`, `middleware/`, `__tests__/`
  - [x] 1.3 Create package.json with dependencies
    - Runtime: express, openai, uuid, express-rate-limit, cors, dotenv, winston
    - Dev: typescript, ts-node, jest, ts-jest, @types/*, supertest, nock
    - Scripts: start, dev, build, test, lint
  - [x] 1.4 Create tsconfig.json
    - Target: ES2020
    - Module: CommonJS
    - Strict mode enabled
    - OutDir: dist/
  - [x] 1.5 Create .env.example with all environment variables
    - Include all variables from spec table
    - Add comments explaining each variable
  - [x] 1.6 Create src/config.ts configuration loader
    - Load all environment variables with defaults
    - Validate required variables (OPENAI_API_KEY)
    - Parse comma-separated ALLOWED_ORIGINS into array
    - Export typed Config interface
  - [x] 1.7 Ensure configuration tests pass
    - Run ONLY the 2-4 tests written in 1.1
    - Verify config loads correctly with valid .env
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-4 tests written in 1.1 pass
- Project structure matches spec design
- npm install succeeds without errors
- TypeScript compiles without errors
- Config loads environment variables correctly

### Types Layer

#### Task Group 2: TypeScript Type Definitions
**Dependencies:** Task Group 1

- [x] 2.0 Complete type definitions
  - [x] 2.1 Write 2-4 focused tests for type validation utilities
    - Test ChatRequest validation (required fields)
    - Test context validation (preferredFormat enum)
    - Test sessionId validation (non-empty string)
    - Test message size limit validation
  - [x] 2.2 Create src/types/chat.ts
    - ChatRequest interface (sessionId, message, context)
    - ChatContext interface (filename, interfaceId, draftOas, preferredFormat)
    - ChatResponse interface (sessionId, assistant)
    - AssistantResponse interface (message, toolTrace, artifacts)
    - ToolTraceItem interface (toolName, status, durationMs)
    - SSE event types (token, tool_call_started, tool_call_finished, final, error)
  - [x] 2.3 Create src/types/session.ts
    - GatewaySession interface with all fields from spec
    - SessionStore interface (get, set, delete, cleanup)
  - [x] 2.4 Create src/types/tools.ts
    - ToolName type (union of 4 allowed tools)
    - ToolDefinition interface for OpenAI schema
    - ToolCall interface (name, arguments, callId)
    - ToolResult interface (callId, output, error)
    - MCP tool parameter types for each of the 4 tools
  - [x] 2.5 Create src/types/index.ts
    - Export all types from chat.ts, session.ts, tools.ts
  - [x] 2.6 Ensure type validation tests pass
    - Run ONLY the 2-4 tests written in 2.1
    - Verify type guards work correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-4 tests written in 2.1 pass
- All types match spec definitions
- Types compile without errors
- Type exports are accessible from index.ts

### Middleware Layer

#### Task Group 3: Express Middleware Implementation
**Dependencies:** Task Group 2

- [x] 3.0 Complete middleware layer
  - [x] 3.1 Write 4-6 focused tests for middleware
    - Test CORS allows configured origins
    - Test CORS rejects unauthorized origins
    - Test rate limiter returns 429 after limit exceeded
    - Test requestId middleware adds X-Request-ID header
    - Test error handler returns safe error messages (no stack traces)
    - Test validation middleware rejects invalid requests
  - [x] 3.2 Create src/middleware/cors.ts
    - Configure CORS with ALLOWED_ORIGINS from config
    - Handle preflight requests
    - Export configured cors middleware
  - [x] 3.3 Create src/middleware/rateLimit.ts
    - Use express-rate-limit library
    - Configure windowMs from RATE_LIMIT_RPM
    - Configure max from RATE_LIMIT_RPM with RATE_LIMIT_BURST
    - Return 429 with retry-after header
    - Key by IP address
  - [x] 3.4 Create src/middleware/requestId.ts
    - Generate UUID for each request
    - Attach to req object and response header X-Request-ID
    - Make available for logging context
  - [x] 3.5 Create src/middleware/errorHandler.ts
    - Global Express error handler
    - Map known errors to appropriate HTTP status codes
    - Return safe error messages (never expose internals)
    - Log full error details with requestId
    - Handle OpenAI errors -> 502
    - Handle MCP errors -> 502
    - Handle validation errors -> 400
  - [x] 3.6 Create src/middleware/validateRequest.ts
    - Validate sessionId is non-empty string
    - Validate message is non-empty and within MAX_MESSAGE_BYTES
    - Validate draftOas within MAX_OAS_BYTES if provided
    - Validate preferredFormat is 'yaml' or 'json' if provided
    - Return 400 with specific validation messages
  - [x] 3.7 Ensure middleware tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify each middleware functions correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 3.1 pass
- CORS blocks unauthorized origins
- Rate limiting returns 429 after threshold
- Request IDs are generated and attached
- Errors are handled gracefully
- Validation rejects invalid requests

### Services Layer

#### Task Group 4: Core Services Implementation
**Dependencies:** Task Groups 2, 3

- [x] 4.0 Complete services layer
  - [x] 4.1 Write 6-8 focused tests for services
    - Test sessionStore creates new session
    - Test sessionStore retrieves existing session
    - Test sessionStore expires old sessions
    - Test toolExecutor executes allowed tool via MCP
    - Test toolExecutor rejects unknown tool
    - Test toolExecutor validates tool arguments
    - Test promptBuilder constructs system prompt with context
    - Test openaiClient sends request and parses response
  - [x] 4.2 Create src/services/sessionStore.ts
    - In-memory Map storage for GatewaySession
    - getSession(sessionId): retrieve or return null
    - createSession(sessionId): create new session with mcpSessionId
    - updateSession(sessionId, updates): partial update
    - deleteSession(sessionId): remove session
    - cleanup(): remove expired sessions (based on SESSION_TTL_HOURS)
    - Start periodic cleanup interval on init
  - [x] 4.3 Create src/services/promptBuilder.ts
    - Build system prompt from spec template
    - Inject context (filename, interfaceId, preferredFormat)
    - Handle missing context gracefully
    - Export buildSystemPrompt(session, context) function
  - [x] 4.4 Create src/services/toolExecutor.ts
    - Define ALLOWED_TOOLS constant (4 tool names)
    - Define TOOL_DEFINITIONS array for OpenAI
    - isToolAllowed(toolName): check against allow-list
    - validateToolArguments(toolName, args): schema validation
    - executeTool(toolName, args, mcpSessionId): call MCP endpoint
    - Map tool names to MCP endpoints
    - Handle MCP errors and timeouts
    - Return ToolResult with output or error
  - [x] 4.5 Create src/services/openaiClient.ts
    - Initialize OpenAI client with config
    - sendRequest(messages, conversationId?, stream?): call Responses API
    - Handle tool call responses
    - Parse and return tool calls array
    - Support streaming mode (return stream iterator)
    - Handle OpenAI errors with proper error types
    - Track token usage for logging
  - [x] 4.6 Ensure services tests pass
    - Run ONLY the 6-8 tests written in 4.1
    - Verify all services function correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6-8 tests written in 4.1 pass
- Session store manages sessions with TTL
- Tool executor enforces allow-list and validates args
- Prompt builder creates correct system prompts
- OpenAI client handles responses and errors

### API Layer

#### Task Group 5: Chat Routes and Server Bootstrap
**Dependencies:** Task Group 4

- [x] 5.0 Complete API routes and server
  - [x] 5.1 Write 6-8 focused tests for chat endpoints
    - Test POST /api/chat returns assistant response
    - Test POST /api/chat validates sessionId required
    - Test POST /api/chat validates message required
    - Test POST /api/chat rejects oversized message
    - Test GET /api/chat/stream returns SSE stream
    - Test GET /health returns ok status
    - Test POST /api/chat handles tool calls correctly
    - Test POST /api/chat includes artifacts when save_oas_spec called
  - [x] 5.2 Create src/routes/chat.ts
    - POST /api/chat handler:
      - Extract sessionId, message, context from body
      - Get or create session
      - Build system prompt with promptBuilder
      - Implement agent loop:
        - Send to OpenAI with tools
        - Execute tool calls (up to MAX_TOOL_CALLS_PER_TURN)
        - Loop until final assistant message
      - Update session with conversationId and context
      - Return ChatResponse with message, toolTrace, artifacts
    - GET /api/chat/stream handler:
      - Extract params from query string
      - Set SSE headers (text/event-stream)
      - Stream tokens via SSE events
      - Emit tool_call_started/finished events
      - Emit final event with complete response
      - Handle errors with error event
    - GET /health handler:
      - Return { status: 'ok', timestamp: ISO string }
  - [x] 5.3 Create src/server.ts
    - Import and configure Express
    - Apply middleware in order: cors, rateLimit, requestId, validateRequest
    - Mount /api/chat routes
    - Mount /health route
    - Apply errorHandler as last middleware
    - Start server on configured PORT
    - Log startup message
    - Export app for testing
  - [x] 5.4 Add agent loop implementation in chat route
    - Track tool calls count
    - Loop while response has tool_calls and count < MAX_TOOL_CALLS_PER_TURN
    - For each tool call:
      - Validate tool name in allow-list
      - Validate tool arguments
      - Execute via toolExecutor
      - Collect results
      - Emit trace events if ENABLE_TOOL_TRACE
    - Send tool results back to OpenAI
    - Extract artifacts from save_oas_spec results
  - [x] 5.5 Add structured logging
    - Use winston for structured JSON logs
    - Log request start with sessionId, requestId
    - Log tool calls with name, duration, status
    - Log OpenAI latency and token usage
    - Log errors with full details (internal only)
    - Respect LOG_LEVEL config
  - [x] 5.6 Ensure API tests pass
    - Run ONLY the 6-8 tests written in 5.1
    - Verify endpoints respond correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6-8 tests written in 5.1 pass
- POST /api/chat returns valid ChatResponse
- GET /api/chat/stream emits SSE events correctly
- GET /health returns 200 with status
- Agent loop executes tools correctly
- Structured logging is working

### Testing & Integration

#### Task Group 6: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical gaps only
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review the 2-4 tests written by project setup (Task 1.1)
    - Review the 2-4 tests written by types layer (Task 2.1)
    - Review the 4-6 tests written by middleware layer (Task 3.1)
    - Review the 6-8 tests written by services layer (Task 4.1)
    - Review the 6-8 tests written by API layer (Task 5.1)
    - Total existing tests: approximately 20-30 tests
  - [x] 6.2 Analyze test coverage gaps for THIS feature only
    - Identify critical user workflows that lack test coverage:
      - Full conversation flow (user message -> tool calls -> response)
      - Multi-turn conversation with session persistence
      - Error recovery scenarios
    - Focus ONLY on gaps related to this spec's feature requirements
    - Do NOT assess entire application test coverage
    - Prioritize end-to-end workflows over unit test gaps
  - [x] 6.3 Write up to 10 additional strategic tests maximum
    - Integration test: full conversation with mocked OpenAI and MCP
    - Integration test: tool execution round-trip with mocked MCP
    - Integration test: streaming event sequence
    - Integration test: session persistence across requests
    - Integration test: rate limit enforcement
    - Integration test: error handling (OpenAI timeout, MCP error)
    - Do NOT write comprehensive coverage for all scenarios
    - Skip edge cases, performance tests unless business-critical
  - [x] 6.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature
    - Expected total: approximately 30-40 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass
  - [x] 6.5 Create manual verification checklist
    - Document steps to manually verify with all services running
    - Include commands to start services
    - Include sample curl/httpie commands for testing

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 30-40 tests total)
- Critical user workflows for this feature are covered:
  - Chat request -> tool execution -> response
  - Streaming response with SSE events
  - Session management and conversation history
  - Error handling for OpenAI/MCP failures
- No more than 10 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements

## Execution Order

Recommended implementation sequence:
1. **Project Setup (Task Group 1):** Foundation - project structure, config, dependencies
2. **Types Layer (Task Group 2):** Type definitions required by all other layers
3. **Middleware Layer (Task Group 3):** Cross-cutting concerns (CORS, rate limit, validation)
4. **Services Layer (Task Group 4):** Core business logic (session, tools, OpenAI, prompts)
5. **API Layer (Task Group 5):** HTTP endpoints and server bootstrap
6. **Test Review & Gap Analysis (Task Group 6):** Final integration testing

## File Summary

Files to be created (in execution order):

**Task Group 1:**
- `gateway/package.json`
- `gateway/tsconfig.json`
- `gateway/.env.example`
- `gateway/src/config.ts`
- `gateway/src/__tests__/config.test.ts`

**Task Group 2:**
- `gateway/src/types/chat.ts`
- `gateway/src/types/session.ts`
- `gateway/src/types/tools.ts`
- `gateway/src/types/index.ts`
- `gateway/src/__tests__/types.test.ts`

**Task Group 3:**
- `gateway/src/middleware/cors.ts`
- `gateway/src/middleware/rateLimit.ts`
- `gateway/src/middleware/requestId.ts`
- `gateway/src/middleware/errorHandler.ts`
- `gateway/src/middleware/validateRequest.ts`
- `gateway/src/__tests__/middleware.test.ts`

**Task Group 4:**
- `gateway/src/services/sessionStore.ts`
- `gateway/src/services/promptBuilder.ts`
- `gateway/src/services/toolExecutor.ts`
- `gateway/src/services/openaiClient.ts`
- `gateway/src/__tests__/sessionStore.test.ts`
- `gateway/src/__tests__/toolExecutor.test.ts`
- `gateway/src/__tests__/openaiClient.test.ts`

**Task Group 5:**
- `gateway/src/routes/chat.ts`
- `gateway/src/server.ts`
- `gateway/src/__tests__/chat.test.ts`

**Task Group 6:**
- `gateway/src/__tests__/integration.test.ts`

## Dependencies Diagram

```
Task Group 1 (Project Setup)
        |
        v
Task Group 2 (Types)
        |
        v
Task Group 3 (Middleware)
        |
        v
Task Group 4 (Services)
        |
        v
Task Group 5 (API Routes & Server)
        |
        v
Task Group 6 (Test Review & Integration)
```

## Notes

- **OpenAI Responses API:** Use the conversation ID feature for maintaining conversation history without manually managing message arrays
- **MCP Integration:** Tool execution proxies to existing MCP server endpoints (POST /mcp/tools/{toolName})
- **Streaming:** SSE streaming requires careful handling of the Express response object and proper cleanup on client disconnect
- **Security:** Never log OPENAI_API_KEY, always sanitize error messages before returning to clients
- **Testing:** Use nock for HTTP mocking (OpenAI, MCP), supertest for endpoint testing

## Implementation Summary

**Implementation Completed:** 2024-12-16

**Test Results:**
- Total Tests: 61
- Passed: 61
- Failed: 0

**Files Created:**
- `gateway/package.json` - Package configuration with dependencies
- `gateway/tsconfig.json` - TypeScript configuration
- `gateway/jest.config.js` - Jest test configuration
- `gateway/.env.example` - Environment variable template with documentation
- `gateway/VERIFICATION.md` - Manual verification checklist
- `gateway/src/config.ts` - Configuration loader with validation
- `gateway/src/types/chat.ts` - Chat request/response types and SSE events
- `gateway/src/types/session.ts` - Session management types
- `gateway/src/types/tools.ts` - Tool definitions and types for OpenAI
- `gateway/src/types/validation.ts` - Request validation utilities
- `gateway/src/types/index.ts` - Type exports
- `gateway/src/middleware/cors.ts` - CORS middleware
- `gateway/src/middleware/rateLimit.ts` - Rate limiting middleware
- `gateway/src/middleware/requestId.ts` - Request ID middleware
- `gateway/src/middleware/errorHandler.ts` - Global error handler
- `gateway/src/middleware/validateRequest.ts` - Request validation middleware
- `gateway/src/middleware/index.ts` - Middleware exports
- `gateway/src/services/logger.ts` - Structured logging service
- `gateway/src/services/sessionStore.ts` - In-memory session storage
- `gateway/src/services/promptBuilder.ts` - System prompt construction
- `gateway/src/services/toolExecutor.ts` - MCP tool execution
- `gateway/src/services/openaiClient.ts` - OpenAI API client
- `gateway/src/services/index.ts` - Service exports
- `gateway/src/routes/chat.ts` - Chat API routes (POST /api/chat, GET /api/chat/stream, GET /health)
- `gateway/src/routes/index.ts` - Route exports
- `gateway/src/server.ts` - Express server bootstrap
- `gateway/src/__tests__/config.test.ts` - Configuration tests (4 tests)
- `gateway/src/__tests__/types.test.ts` - Type validation tests (15 tests)
- `gateway/src/__tests__/middleware.test.ts` - Middleware tests (12 tests)
- `gateway/src/__tests__/services.test.ts` - Services tests (14 tests)
- `gateway/src/__tests__/chat.test.ts` - Chat endpoint tests (10 tests)
- `gateway/src/__tests__/integration.test.ts` - Integration tests (6 tests)
