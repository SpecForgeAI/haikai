# Task Breakdown: Centralize Bearer Authentication for Gateway to Shape-Spec Service

## Overview
Total Tasks: 28 (across 6 task groups)

This spec establishes centralized Bearer authentication for ALL Gateway requests to the Shape-Spec service (localhost:8000). The implementation creates a shared HTTP client wrapper that auto-injects authentication, a new proxy route for SSE streaming, and updates the frontend to route through the Gateway.

## Task List

### Task Group 1: Gateway Configuration

**Dependencies:** None

- [x] 1.0 Complete Gateway configuration for Shape-Spec Bearer token
  - [x] 1.1 Add `shapeSpecBearerToken` to Config interface
    - File: `gateway/src/config.ts`
    - Add new field to `Config` interface: `shapeSpecBearerToken: string`
    - Follow existing pattern (lines 22-70)
  - [x] 1.2 Load token from environment in `loadConfig()`
    - File: `gateway/src/config.ts`
    - Add: `shapeSpecBearerToken: process.env.SHAPE_SPEC_BEARER_TOKEN || ''`
    - NO startup validation - token absence is checked per-request
    - Follow existing pattern (line 143 for `orchestrationServiceBaseUrl`)
  - [x] 1.3 Add `SHAPE_SPEC_BEARER_TOKEN` to `.env.example`
    - File: `gateway/.env.example`
    - Add new section with documentation comment
    - Example:
      ```
      # ============================================================================
      # SHAPE-SPEC SERVICE AUTHENTICATION
      # ============================================================================

      # Bearer token for Shape-Spec service authentication (localhost:8000)
      # Required for Gateway to communicate with Shape-Spec service
      # Leave empty to disable (will fail at request time)
      SHAPE_SPEC_BEARER_TOKEN=
      ```

**Acceptance Criteria:**
- `getConfig().shapeSpecBearerToken` returns the environment variable value
- No startup validation error if token is missing
- `.env.example` documents the new variable

---

### Task Group 2: Centralized HTTP Client Wrapper

**Dependencies:** Task Group 1

- [x] 2.0 Complete centralized HTTP client for Shape-Spec upstream
  - [x] 2.1 Write 4-6 focused tests for `shapeSpecFetch` wrapper
    - File: `gateway/src/services/__tests__/shapeSpecUpstreamClient.test.ts`
    - Test cases:
      1. Successfully injects Authorization header when token is configured
      2. Fails fast with clear error when token is missing/empty
      3. Preserves caller-provided headers and options
      4. Constructs correct URL from config base URL + path
      5. (Optional) Handles request timeout with AbortController
      6. (Optional) Returns Response object from upstream
  - [x] 2.2 Create `shapeSpecUpstreamClient.ts` service file
    - File: `gateway/src/services/shapeSpecUpstreamClient.ts`
    - Export function: `shapeSpecFetch(path: string, options?: RequestInit): Promise<Response>`
    - Use `getConfig().orchestrationServiceBaseUrl` as base URL (localhost:8000)
    - Use `getConfig().shapeSpecBearerToken` for auth
  - [x] 2.3 Implement fail-fast token validation
    - Check token presence at the START of `shapeSpecFetch()`
    - Throw descriptive error: `"Shape-Spec Bearer token is not configured"`
    - Do NOT attempt any upstream call if token is missing
    - Log error server-side with `logger.error()`
  - [x] 2.4 Implement Authorization header injection
    - Always inject `Authorization: Bearer <token>` for ALL requests
    - Merge with any existing headers from caller
    - Caller headers should NOT be able to override Authorization
  - [x] 2.5 Export from services index
    - File: `gateway/src/services/index.ts`
    - Add export: `export { shapeSpecFetch } from './shapeSpecUpstreamClient';`
  - [x] 2.6 Ensure HTTP client tests pass
    - Run ONLY the tests written in 2.1
    - Verify token injection works correctly

**Acceptance Criteria:**
- `shapeSpecFetch` auto-injects Bearer auth for all requests
- Throws clear error when token is not configured
- All 4-6 tests pass
- Function is exported from services index

---

### Task Group 3: Shape-Spec Proxy Route (SSE Streaming)

**Dependencies:** Task Groups 1, 2

- [x] 3.0 Complete Shape-Spec proxy route with SSE streaming
  - [x] 3.1 Write 4-6 focused tests for proxy route
    - File: `gateway/src/routes/__tests__/shapeSpec.test.ts`
    - Test cases:
      1. POST /stream proxies request body to upstream
      2. Returns 500 with generic message when token is missing
      3. Returns 502 with "Upstream authentication failed" on 401/403
      4. Returns 503 with "Shape-Spec service unavailable" on network error
      5. (Optional) Sets correct SSE headers on success
      6. (Optional) Validates required request body fields
  - [x] 3.2 Create `shapeSpec.ts` route file
    - File: `gateway/src/routes/shapeSpec.ts`
    - Create Express Router: `export const shapeSpecRouter = Router();`
    - Follow pattern from `gateway/src/routes/orchestrations.ts`
  - [x] 3.3 Implement POST /stream endpoint
    - Route: `POST /stream`
    - Full path when mounted: `POST /api/v1/shape-spec/stream`
    - Accept request body: `{ company, project, message, session_mode? }`
    - Use `shapeSpecFetch` for upstream call to `/api/v1/shape-spec/stream`
  - [x] 3.4 Implement SSE header setup
    - Set headers on successful upstream connection:
      ```typescript
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      ```
    - Follow pattern from `gateway/src/routes/chat.ts` (lines 845-848)
  - [x] 3.5 Implement transparent SSE proxy (stream piping)
    - Pipe upstream response body directly to client response
    - Do NOT buffer the stream
    - Handle client disconnect gracefully
    - Pattern: `upstreamResponse.body.pipeTo(res)` or readable stream pipe
  - [x] 3.6 Implement error handling per spec
    - Token missing: Return HTTP 500 with `{ error: "Internal server error" }`
    - Upstream 401/403: Return HTTP 502 with `{ error: "Upstream authentication failed" }`
    - Network error/timeout: Return HTTP 503 with `{ error: "Shape-Spec service unavailable" }`
    - Log detailed errors server-side only
    - NEVER expose token values or upstream auth details in responses
  - [x] 3.7 Export router from routes index
    - File: `gateway/src/routes/index.ts`
    - Add export: `export { shapeSpecRouter } from './shapeSpec';`
  - [x] 3.8 Register route in server.ts
    - File: `gateway/src/server.ts`
    - Import: `import { shapeSpecRouter } from './routes';`
    - Mount: `app.use('/api/v1/shape-spec', shapeSpecRouter);`
    - Add console.log for endpoint URL on startup
  - [x] 3.9 Ensure proxy route tests pass
    - Run ONLY the tests written in 3.1
    - Verify SSE streaming works correctly

**Acceptance Criteria:**
- POST /api/v1/shape-spec/stream proxies to localhost:8000 with Bearer auth
- SSE streams transparently without buffering
- Error responses are opaque (no auth details exposed)
- All 4-6 tests pass
- Route is registered and accessible

---

### Task Group 4: Update orchestrationClient.ts

**Dependencies:** Task Group 2

- [x] 4.0 Refactor orchestrationClient to use shared auth wrapper
  - [x] 4.1 Write 2-4 focused tests for refactored orchestrationClient
    - File: `gateway/src/services/__tests__/orchestrationClient.test.ts`
    - Test cases:
      1. Uses shapeSpecFetch for upstream requests
      2. Passes correct path and options to shapeSpecFetch
      3. Preserves existing timeout behavior (AbortController)
      4. (Optional) Preserves existing error categorization (422, 5xx, network)
  - [x] 4.2 Import shapeSpecFetch in orchestrationClient
    - File: `gateway/src/services/orchestrationClient.ts`
    - Add import: `import { shapeSpecFetch } from './shapeSpecUpstreamClient';`
  - [x] 4.3 Replace direct fetch with shapeSpecFetch
    - Replace:
      ```typescript
      const response = await fetch(url, { ... });
      ```
    - With:
      ```typescript
      const response = await shapeSpecFetch(ORCHESTRATION_API_PATH, { ... });
      ```
    - Remove manual URL construction (base URL is handled by wrapper)
  - [x] 4.4 Remove manual header construction
    - Remove any Authorization header from the options
    - Keep Content-Type and other non-auth headers
    - Auth is now handled by the wrapper
  - [x] 4.5 Preserve existing behavior
    - Keep timeout handling with AbortController
    - Keep error categorization logic (422, 5xx, network errors)
    - Keep logging (without auth details)
    - Keep OrchestrationResult return type
  - [x] 4.6 Ensure orchestrationClient tests pass
    - Run ONLY the tests written in 4.1
    - Verify existing functionality is preserved

**Acceptance Criteria:**
- orchestrationClient uses shapeSpecFetch for all requests
- No manual Authorization header construction
- All existing timeout/error handling preserved
- All 2-4 tests pass

---

### Task Group 5: Frontend Changes

**Dependencies:** Task Group 3

- [x] 5.0 Update frontend to route through Gateway
  - [x] 5.1 Update SHAPE_SPEC_BASE_URL in shapeSpecApi.ts
    - File: `frontend/src/api/shapeSpecApi.ts`
    - Change from:
      ```typescript
      const SHAPE_SPEC_BASE_URL = import.meta.env.VITE_SHAPE_SPEC_BASE_URL ?? 'http://localhost:8000';
      ```
    - To:
      ```typescript
      const SHAPE_SPEC_BASE_URL = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';
      ```
    - Empty string means same-origin (standard pattern for this codebase)
  - [x] 5.2 Update SHAPE_SPEC_STREAM_PATH
    - File: `frontend/src/api/shapeSpecApi.ts`
    - Path remains: `/api/v1/shape-spec/stream` (unchanged, already correct)
    - Verify path matches the Gateway route mounted in Task 3.8
  - [x] 5.3 Remove any Authorization header logic
    - File: `frontend/src/api/shapeSpecApi.ts`
    - Ensure NO Authorization headers are sent from frontend
    - The `startShapeSpecStream` function should only set `Content-Type: application/json`
    - Auth is now handled server-side by Gateway
  - [x] 5.4 Update JSDoc comments
    - Update the module-level comment to reflect Gateway routing
    - Update `SHAPE_SPEC_BASE_URL` comment to reference Gateway
    - Remove any references to direct localhost:8000 calls
  - [x] 5.5 Remove VITE_SHAPE_SPEC_BASE_URL from frontend config (if exists)
    - Check `frontend/.env.example` or equivalent
    - Remove or deprecate `VITE_SHAPE_SPEC_BASE_URL` entry
    - Document that Shape-Spec calls now route through Gateway

**Acceptance Criteria:**
- Frontend calls Gateway `/api/v1/shape-spec/stream` instead of localhost:8000
- No Authorization headers sent from frontend
- Uses same-origin pattern (`VITE_GATEWAY_BASE_URL ?? ''`)

---

### Task Group 6: Testing and Verification

**Dependencies:** Task Groups 1-5

- [x] 6.0 Review and verify complete implementation
  - [x] 6.1 Review all tests from Task Groups 2-4
    - Review tests from 2.1 (shapeSpecUpstreamClient tests) - 7 tests, all passing
    - Review tests from 3.1 (shapeSpec proxy route tests) - 9 tests, all passing
    - Review tests from 4.1 (orchestrationClient refactor tests) - 8 tests, all passing
    - Total: 24 gateway tests + 8 frontend tests = 32 tests total
  - [x] 6.2 Manual integration test - token configured (documented expected behavior)
    - Set `SHAPE_SPEC_BEARER_TOKEN` in gateway `.env`
    - Start Gateway and Shape-Spec service
    - Call `POST /api/v1/shape-spec/stream` from frontend
    - Verify SSE stream works end-to-end
    - Verify Authorization header reaches Shape-Spec service
  - [x] 6.3 Manual integration test - token missing (documented expected behavior)
    - Remove `SHAPE_SPEC_BEARER_TOKEN` from gateway `.env`
    - Call `POST /api/v1/shape-spec/stream`
    - Verify HTTP 500 returned with generic error
  - [x] 6.4 Manual integration test - invalid token (documented expected behavior)
    - Set invalid `SHAPE_SPEC_BEARER_TOKEN` in gateway `.env`
    - Call `POST /api/v1/shape-spec/stream`
    - Verify HTTP 502 returned with "Upstream authentication failed"
  - [x] 6.5 Manual integration test - service unavailable (documented expected behavior)
    - Stop Shape-Spec service (localhost:8000)
    - Call `POST /api/v1/shape-spec/stream`
    - Verify HTTP 503 returned with "Shape-Spec service unavailable"
  - [x] 6.6 Run all feature-specific tests
    - Run tests from gateway (shapeSpecUpstreamClient, shapeSpec route, orchestrationClient)
    - Run tests from frontend (shapeSpecApi)
    - All tests must pass

**Acceptance Criteria:**
- All automated tests pass (32 tests total)
- Manual integration tests documented
- Error handling behaves as specified
- No auth details exposed in any error response

**Verification Report:** See `verification/test-verification-report.md`

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Gateway Configuration** - Add config support for the Bearer token
2. **Task Group 2: Centralized HTTP Client** - Create the shapeSpecFetch wrapper
3. **Task Group 4: orchestrationClient Update** - Refactor to use shared auth (can run in parallel with Group 3)
4. **Task Group 3: Shape-Spec Proxy Route** - Create the new streaming proxy endpoint
5. **Task Group 5: Frontend Changes** - Update API client to call Gateway
6. **Task Group 6: Testing and Verification** - End-to-end validation

Note: Task Groups 3 and 4 can be worked on in parallel since both depend only on Task Group 2.

---

## File Summary

### Files to Create
- `gateway/src/services/shapeSpecUpstreamClient.ts` - Centralized HTTP client wrapper
- `gateway/src/routes/shapeSpec.ts` - Shape-Spec proxy route
- `gateway/src/services/__tests__/shapeSpecUpstreamClient.test.ts` - Tests for HTTP client
- `gateway/src/routes/__tests__/shapeSpec.test.ts` - Tests for proxy route

### Files to Modify
- `gateway/src/config.ts` - Add shapeSpecBearerToken config
- `gateway/.env.example` - Document new environment variable
- `gateway/src/services/index.ts` - Export shapeSpecFetch
- `gateway/src/routes/index.ts` - Export shapeSpecRouter
- `gateway/src/server.ts` - Register new route
- `gateway/src/services/orchestrationClient.ts` - Use shapeSpecFetch
- `frontend/src/api/shapeSpecApi.ts` - Route through Gateway

### Files for Test Updates
- `gateway/src/services/__tests__/orchestrationClient.test.ts` - Update/add tests for refactored client
