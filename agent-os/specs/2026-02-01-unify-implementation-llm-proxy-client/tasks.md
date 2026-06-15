# Task Breakdown: Unify Implementation LLM Proxy Service Config

## Overview
Total Tasks: 32 sub-tasks across 6 task groups

This spec consolidates all Gateway upstream HTTP requests to the Implementation LLM proxy service (localhost:8000) through a single canonical client (`implementationLlmProxyClient.ts`) with guaranteed Bearer token injection. It eliminates redundant clients (`shapeSpecUpstreamClient.ts`, `standardsServiceClient.ts`) and simplifies environment configuration by replacing multiple service-specific env vars with unified `IMPLEMENTATION_LLM_SERVICE_*` variables.

## Task List

### Task Group 1: Configuration Changes

**Dependencies:** None

- [x] 1.0 Complete configuration consolidation
  - [x] 1.1 Update `Config` interface in `config.ts`
    - File: `gateway/src/config.ts`
    - Remove from interface: `shapeSpecBearerToken`, `standardsServiceBaseUrl`, `standardsServiceBearerToken`, `orchestrationServiceBaseUrl`
    - Add to interface: `implementationLlmServiceBaseUrl: string`, `implementationLlmServiceBearerToken: string`
    - Update spec reference comments to reference this spec
  - [x] 1.2 Update `loadConfig()` function in `config.ts`
    - File: `gateway/src/config.ts`
    - Remove loading of: `SHAPE_SPEC_BEARER_TOKEN`, `STANDARDS_SERVICE_BASE_URL`, `STANDARDS_SERVICE_BEARER_TOKEN`, `ORCHESTRATION_SERVICE_BASE_URL`
    - Add: `implementationLlmServiceBaseUrl: process.env.IMPLEMENTATION_LLM_SERVICE_BASE_URL || 'http://localhost:8000'`
    - Add: `implementationLlmServiceBearerToken: process.env.IMPLEMENTATION_LLM_SERVICE_BEARER_TOKEN || ''`
    - NO startup validation - token absence is checked per-request (fail-fast pattern)
  - [x] 1.3 Update `gateway/.env.example` with new env vars
    - File: `gateway/.env.example`
    - Remove sections: `SHAPE-SPEC SERVICE AUTHENTICATION`, `STANDARDS SERVICE CONFIGURATION`
    - Add new section header: `# IMPLEMENTATION LLM PROXY SERVICE`
    - Add: `IMPLEMENTATION_LLM_SERVICE_BASE_URL=http://localhost:8000` with comment (default)
    - Add: `IMPLEMENTATION_LLM_SERVICE_BEARER_TOKEN=` with comment (required, no default)
    - Explain that all calls to localhost:8000 (standards, orchestrations, shape-spec) use these vars

**Acceptance Criteria:**
- `getConfig().implementationLlmServiceBaseUrl` returns the env var value or default `http://localhost:8000`
- `getConfig().implementationLlmServiceBearerToken` returns the env var value or empty string
- Old config properties (`shapeSpecBearerToken`, `standardsServiceBaseUrl`, etc.) no longer exist
- `.env.example` documents the new variables with clear section header
- No startup validation error if token is missing

---

### Task Group 2: New Client Creation

**Dependencies:** Task Group 1

- [x] 2.0 Complete implementationLlmProxyClient.ts implementation
  - [x] 2.1 Write 6-8 focused tests for `implementationLlmProxyClient`
    - File: `gateway/src/services/__tests__/implementationLlmProxyClient.test.ts`
    - Test cases:
      1. `request()` injects Authorization header correctly when token is configured
      2. `request()` throws Error with descriptive message when token is missing/blank
      3. `request()` throws Error with descriptive message when token is undefined
      4. `request()` constructs correct URL from base URL + path
      5. `request()` does NOT allow caller to override Authorization header
      6. `request()` preserves caller-provided headers and options
      7. `postJson()` sets Content-Type and Accept headers to application/json
      8. `getJson()` sets Accept header to application/json
      9. `requestStream()` does NOT set Accept: application/json (for SSE)
      10. `requestStream()` propagates AbortSignal correctly
      11. `requestStream()` aborts fetch when AbortSignal is triggered
  - [x] 2.2 Create `implementationLlmProxyClient.ts` service file
    - File: `gateway/src/services/implementationLlmProxyClient.ts`
    - Export core function: `request(path: string, options: RequestOptions): Promise<Response>`
    - Options interface: `{ method?: string; headers?: Record<string, string>; body?: unknown; timeoutMs?: number; signal?: AbortSignal }`
    - Use `getConfig().implementationLlmServiceBaseUrl` as base URL
    - Use `getConfig().implementationLlmServiceBearerToken` for auth
  - [x] 2.3 Implement fail-fast validation in `request()`
    - Check token presence at START of `request()` function
    - Throw descriptive error: `"Implementation LLM Service Bearer token is not configured"`
    - Check base URL presence (base URL has default, so only checked for empty string)
    - Do NOT attempt fetch if token is missing
  - [x] 2.4 Implement Authorization header injection
    - Always inject `Authorization: Bearer <token>` for ALL requests
    - Override any caller-provided Authorization header (security pattern)
    - Merge with other headers from caller
    - Follow header merging pattern from deleted `shapeSpecUpstreamClient.ts`
  - [x] 2.5 Implement `postJson(path, body)` convenience helper
    - File: `gateway/src/services/implementationLlmProxyClient.ts`
    - Set `Content-Type: application/json` header
    - Set `Accept: application/json` header
    - JSON-stringify the body
    - Call core `request()` function with method POST
  - [x] 2.6 Implement `getJson(path)` convenience helper
    - File: `gateway/src/services/implementationLlmProxyClient.ts`
    - Set `Accept: application/json` header
    - Call core `request()` function with method GET
  - [x] 2.7 Implement `requestStream(path, options)` for SSE responses
    - File: `gateway/src/services/implementationLlmProxyClient.ts`
    - Omit `Accept: application/json` header (SSE responses use text/event-stream)
    - Preserve AbortSignal passthrough for client disconnect cancellation
    - Call core `request()` function
  - [x] 2.8 Add debug logging
    - Log request metadata: url, method, hasBody, hasSignal
    - Follow logging pattern from existing clients
    - Do NOT log sensitive data (token value, request body contents)
  - [x] 2.9 Ensure client tests pass
    - Run ONLY the tests written in 2.1
    - Verify token injection works correctly
    - Verify fail-fast behavior works correctly
    - **Result: 11 tests pass**

**Acceptance Criteria:**
- `implementationLlmProxyClient.ts` exists with all four exported functions
- `request()` always injects Bearer auth
- `request()` throws clear error when token is missing
- `postJson()` and `getJson()` set appropriate headers
- `requestStream()` works for SSE without Accept: application/json
- All 11 tests pass

---

### Task Group 3: Route Refactoring

**Dependencies:** Task Group 2

- [x] 3.0 Complete route refactoring to use new client
  - [x] 3.1 Write 4-6 focused tests for refactored routes
    - File: `gateway/src/routes/__tests__/routeRefactoring.test.ts` (new file created)
    - Test cases:
      1. `standardsGenerate.ts` uses `postJson` for upstream call
      2. `standardsGenerate.ts` returns 500 with generic error when token is missing
      3. `projectStandardsGenerate.ts` uses `postJson` for upstream call
      4. `projectStandardsGenerate.ts` returns 500 with generic error when token is missing
      5. `shapeSpec.ts` uses `requestStream` for upstream call
      6. `shapeSpec.ts` returns 500 with generic error when token is missing
  - [x] 3.2 Refactor `standardsGenerate.ts`
    - File: `gateway/src/routes/standardsGenerate.ts`
    - Replace `standardsServiceFetch` import with `postJson` from `implementationLlmProxyClient`
    - Use `postJson('/api/v1/standards/global/generate', requestBody)` for upstream call
    - Update error message matching to reference new client name in token absence check
    - Preserve all existing error handling, logging, and PATCH orchestration logic
  - [x] 3.3 Refactor `projectStandardsGenerate.ts`
    - File: `gateway/src/routes/projectStandardsGenerate.ts`
    - Replace `standardsServiceFetch` import with `postJson` from `implementationLlmProxyClient`
    - Use `postJson('/api/v1/standards/product/generate', requestBody)` for upstream call
    - Note: Gateway path `/generate` maps to upstream path `/api/v1/standards/product/generate` (intentional UX naming)
    - Update error message matching for token absence check
    - Preserve existing validation, logging, and error handling
  - [x] 3.4 Refactor `shapeSpec.ts`
    - File: `gateway/src/routes/shapeSpec.ts`
    - Replace `shapeSpecFetch` import with `requestStream` from `implementationLlmProxyClient`
    - Pass AbortController.signal for client disconnect cancellation
    - Preserve SSE header configuration (`text/event-stream`, `no-cache`, etc.)
    - Preserve stream piping and abort handling
    - Update error message matching for token absence check
  - [x] 3.5 Ensure route refactoring tests pass
    - Run ONLY the tests written in 3.1
    - Verify routes use new client correctly
    - Verify error handling is preserved
    - **Result: 6 tests pass**

**Additional refactoring:**
- [x] 3.6 Refactor `orchestrations.ts` route (found during cleanup)
  - File: `gateway/src/routes/orchestrations.ts`
  - Replace `shapeSpecFetch` import with `request` from `implementationLlmProxyClient`
  - Updated existing test file `orchestrations.test.ts` to use new mocks

**Acceptance Criteria:**
- All routes use `implementationLlmProxyClient` functions
- No direct imports of old clients (`shapeSpecUpstreamClient`, `standardsServiceClient`)
- Existing functionality preserved (error handling, logging, SSE streaming)
- All 6 tests pass

---

### Task Group 4: Service Refactoring

**Dependencies:** Task Group 2

- [x] 4.0 Complete service refactoring
  - [x] 4.1 Write 3-4 focused tests for refactored orchestrationClient
    - File: `gateway/src/services/__tests__/orchestrationClient.test.ts` (updated existing)
    - Test cases:
      1. Uses `implementationLlmProxyClient.request` for upstream requests
      2. Passes correct path `/api/v1/orchestrations` to client
      3. Preserves timeout behavior (AbortController signal)
      4. Preserves error categorization (422 validation)
      5. Preserves error categorization (5xx server errors)
      6. Preserves error categorization (network errors)
      7. Preserves timeout error handling (AbortError)
      8. Returns success result with data on successful response
  - [x] 4.2 Refactor `orchestrationClient.ts`
    - File: `gateway/src/services/orchestrationClient.ts`
    - Replace `shapeSpecFetch` import with `request` from `implementationLlmProxyClient`
    - Use client for upstream call to `/api/v1/orchestrations`
    - Retain all typed interfaces: `OrchestrationRequest`, `OrchestrationResult`, `OrchestrationError`
    - Retain timeout handling via AbortController (60s default)
    - Retain all error classification logic (422, 5xx, network errors, AbortError)
    - Retain logging (without sensitive payload content)
  - [x] 4.3 Ensure orchestrationClient tests pass
    - Run ONLY the tests written in 4.1
    - Verify existing functionality is preserved
    - Verify new client is used correctly
    - **Result: 8 tests pass**

**Acceptance Criteria:**
- `orchestrationClient.ts` uses `implementationLlmProxyClient` for all upstream requests
- All typed interfaces preserved (`OrchestrationRequest`, `OrchestrationResult`, `OrchestrationError`)
- Timeout and error handling preserved
- All 8 tests pass

---

### Task Group 5: Cleanup (Delete Old Files and Update Exports)

**Dependencies:** Task Groups 3, 4

- [x] 5.0 Complete cleanup of old clients
  - [x] 5.1 Delete `shapeSpecUpstreamClient.ts`
    - File to delete: `gateway/src/services/shapeSpecUpstreamClient.ts`
    - Verified no remaining imports in codebase before deletion
  - [x] 5.2 Delete `standardsServiceClient.ts`
    - File to delete: `gateway/src/services/standardsServiceClient.ts`
    - Verified no remaining imports in codebase before deletion
  - [x] 5.3 Update `gateway/src/services/index.ts` exports
    - File: `gateway/src/services/index.ts`
    - Remove: `export { shapeSpecFetch } from './shapeSpecUpstreamClient';`
    - Add: Export for new `implementationLlmProxyClient` functions:
      ```typescript
      export { request, postJson, getJson, requestStream, RequestOptions, StreamRequestOptions } from './implementationLlmProxyClient';
      ```
    - Update spec reference comment
  - [x] 5.4 Delete old test files (if they exist)
    - Deleted: `gateway/src/services/__tests__/shapeSpecUpstreamClient.test.ts`
    - Updated: `gateway/src/routes/__tests__/orchestrations.test.ts` (refactored for new client)
    - Updated: `gateway/src/routes/__tests__/shapeSpec.test.ts` (refactored for new client)

**Acceptance Criteria:**
- `shapeSpecUpstreamClient.ts` deleted
- `standardsServiceClient.ts` deleted
- No remaining imports of deleted files in codebase
- `services/index.ts` exports new client functions
- Old test files cleaned up

---

### Task Group 6: Testing and Verification

**Dependencies:** Task Groups 1-5

- [x] 6.0 Review and verify complete implementation
  - [x] 6.1 Review all tests from Task Groups 2-4
    - Review tests from 2.1 (implementationLlmProxyClient tests) - 11 tests
    - Review tests from 3.1 (route refactoring tests) - 6 tests
    - Review tests from 4.1 (orchestrationClient tests) - 8 tests
    - Total: 25 tests in core feature tests
  - [x] 6.2 Analyze test coverage gaps for this feature only
    - Analyzed existing test files that used old clients
    - Found `orchestrations.test.ts` and `shapeSpec.test.ts` needed updates
    - Updated both to use new client mocks
  - [x] 6.3 Write up to 5 additional strategic tests if necessary
    - Updated existing tests in `orchestrations.test.ts` (5 tests) and `shapeSpec.test.ts` (12 tests)
    - Total additional tests: 17 tests updated
  - [x] 6.4 Run feature-specific tests only
    - Ran all related tests: 42 tests total
    - All tests pass
  - [ ] 6.5 Manual integration test - verify env var migration
    - Update local `.env` file with new env vars
    - Remove old env vars (`SHAPE_SPEC_BEARER_TOKEN`, `STANDARDS_SERVICE_*`, `ORCHESTRATION_SERVICE_BASE_URL`)
    - Add new env vars (`IMPLEMENTATION_LLM_SERVICE_BASE_URL`, `IMPLEMENTATION_LLM_SERVICE_BEARER_TOKEN`)
    - Start Gateway and verify no startup errors
  - [ ] 6.6 Manual integration test - verify routes work end-to-end
    - Test `POST /api/v1/standards/global/generate` works with new client
    - Test `POST /api/v1/standards/project/generate` works with new client
    - Test `POST /api/v1/shape-spec/stream` works with new client
    - Test orchestration calls work with new client
    - Verify Authorization header reaches upstream service

**Acceptance Criteria:**
- All feature-specific tests pass (42 tests total)
- Existing test files updated to use new client mocks
- Manual integration tests pass (pending user verification)
- Old env vars successfully migrated to new naming
- All routes function correctly with unified client

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Configuration Changes** - Update config.ts and .env.example first (foundation) - COMPLETE
2. **Task Group 2: New Client Creation** - Create implementationLlmProxyClient.ts - COMPLETE
3. **Task Group 3: Route Refactoring** - Update routes to use new client - COMPLETE
4. **Task Group 4: Service Refactoring** - Update orchestrationClient.ts - COMPLETE
5. **Task Group 5: Cleanup** - Delete old files and update exports - COMPLETE
6. **Task Group 6: Testing and Verification** - End-to-end validation - COMPLETE (automated tests), PENDING (manual integration tests)

**Parallel Execution Opportunity:** Task Groups 3 and 4 have no dependencies on each other and can be implemented simultaneously after Task Group 2 is complete.

---

## File Summary

### Files Created
| File | Description | Task Group |
|------|-------------|------------|
| `gateway/src/services/implementationLlmProxyClient.ts` | Unified HTTP client for Implementation LLM proxy service | 2 |
| `gateway/src/services/__tests__/implementationLlmProxyClient.test.ts` | Tests for new client (11 tests) | 2 |
| `gateway/src/routes/__tests__/routeRefactoring.test.ts` | Tests for route refactoring (6 tests) | 3 |

### Files Modified
| File | Description | Task Group |
|------|-------------|------------|
| `gateway/src/config.ts` | Remove old config, add new `implementationLlmService*` config | 1 |
| `gateway/.env.example` | Update env var documentation | 1 |
| `gateway/src/routes/standardsGenerate.ts` | Use `postJson` from new client | 3 |
| `gateway/src/routes/projectStandardsGenerate.ts` | Use `postJson` from new client | 3 |
| `gateway/src/routes/shapeSpec.ts` | Use `requestStream` from new client | 3 |
| `gateway/src/routes/orchestrations.ts` | Use `request` from new client | 3 |
| `gateway/src/services/orchestrationClient.ts` | Use new client instead of `shapeSpecFetch` | 4 |
| `gateway/src/services/index.ts` | Update exports (remove old, add new) | 5 |
| `gateway/src/routes/__tests__/orchestrations.test.ts` | Update mocks for new client | 5 |
| `gateway/src/routes/__tests__/shapeSpec.test.ts` | Update mocks for new client | 5 |
| `gateway/src/services/__tests__/orchestrationClient.test.ts` | Update mocks for new client | 4 |

### Files Deleted
| File | Description | Task Group |
|------|-------------|------------|
| `gateway/src/services/shapeSpecUpstreamClient.ts` | Replaced by implementationLlmProxyClient | 5 |
| `gateway/src/services/standardsServiceClient.ts` | Replaced by implementationLlmProxyClient | 5 |
| `gateway/src/services/__tests__/shapeSpecUpstreamClient.test.ts` | Tests for deleted client | 5 |

---

## Notes

- **Single base URL assumption**: All upstream services (standards, orchestrations, shape-spec) use `IMPLEMENTATION_LLM_SERVICE_BASE_URL` (default: `http://localhost:8000`)
- **Fail-fast pattern**: Token validated per-request, not at startup (base URL has default so always present)
- **Security pattern**: Authorization header always overrides caller-provided value
- **Out of scope**: Frontend changes, implementation LLM proxy service changes, retry logic, circuit breakers, caching
- **Pre-existing TypeScript errors**: Found unrelated TypeScript errors in `chat.ts` that were not introduced by this spec

## Test Summary

| Test File | Test Count | Status |
|-----------|------------|--------|
| `implementationLlmProxyClient.test.ts` | 11 | PASS |
| `orchestrationClient.test.ts` | 8 | PASS |
| `routeRefactoring.test.ts` | 6 | PASS |
| `orchestrations.test.ts` | 5 | PASS |
| `shapeSpec.test.ts` | 12 | PASS |
| **Total** | **42** | **ALL PASS** |
