# Specification: Unify Implementation LLM Proxy Service Config

## Goal
Consolidate all Gateway upstream HTTP requests to the Implementation LLM proxy service (localhost:8000) through a single canonical client with guaranteed Bearer token injection, eliminating redundant clients and simplifying environment configuration.

## User Stories
- As a developer, I want a single upstream client for all Implementation LLM proxy service calls, so that authorization is guaranteed and I never accidentally omit it.
- As an operator, I want simplified configuration with clear naming (`IMPLEMENTATION_LLM_SERVICE_*`), so that I understand what each env var controls.

## Specific Requirements

**Configuration Consolidation**
- Remove from `config.ts`: `shapeSpecBearerToken`, `standardsServiceBaseUrl`, `standardsServiceBearerToken`, `orchestrationServiceBaseUrl`
- Add to `config.ts`: `implementationLlmServiceBaseUrl` (default: `http://localhost:8000`), `implementationLlmServiceBearerToken` (required, no default)
- Update the `Config` interface to remove old properties and add new ones
- Token absence is checked per-request (fail-fast), not at startup

**implementationLlmProxyClient.ts Creation**
- Create new file at `gateway/src/services/implementationLlmProxyClient.ts`
- Core function `request(path, options)`: general-purpose HTTP with method, headers, body, timeoutMs, signal (AbortSignal)
- Convenience helper `postJson(path, body)`: POST with JSON body, sets Content-Type and Accept headers
- Convenience helper `getJson(path)`: GET request with Accept: application/json
- Streaming helper `requestStream(path, options)`: for SSE responses, omits Accept: application/json, preserves AbortSignal
- Always inject `Authorization: Bearer <token>` header, overriding any caller-provided value
- Throw Error immediately if base URL or token is missing/blank (caller catches and returns 500)

**Route Refactoring - standardsGenerate.ts**
- Replace `standardsServiceFetch` import with `implementationLlmProxyClient` functions
- Use `postJson` for the upstream call to `/api/v1/standards/global/generate`
- Update error message matching to reference new client name in token absence check
- Preserve all existing error handling, logging, and PATCH orchestration logic

**Route Refactoring - projectStandardsGenerate.ts**
- Replace `standardsServiceFetch` import with `implementationLlmProxyClient` functions
- Use `postJson` for upstream call; Gateway path `/generate` maps to upstream `/api/v1/standards/product/generate`
- Update error message matching for token absence check
- Preserve existing validation, logging, and error handling

**Route Refactoring - shapeSpec.ts**
- Replace `shapeSpecFetch` import with `implementationLlmProxyClient.requestStream`
- Pass AbortController.signal for client disconnect cancellation
- Preserve SSE header configuration, stream piping, and abort handling
- Update error message matching for token absence check

**Service Refactoring - orchestrationClient.ts**
- Replace `shapeSpecFetch` import with `implementationLlmProxyClient` functions
- Use `request` or `postJson` for the `/api/v1/orchestrations` endpoint
- Retain all typed interfaces: `OrchestrationRequest`, `OrchestrationResult`, `OrchestrationError`
- Retain timeout handling via AbortController and all error classification logic

**Client Deletion and Export Cleanup**
- Delete `gateway/src/services/shapeSpecUpstreamClient.ts`
- Delete `gateway/src/services/standardsServiceClient.ts`
- Remove `shapeSpecFetch` export from `gateway/src/services/index.ts`
- Add export for new `implementationLlmProxyClient` functions to `index.ts`

**Environment File Updates**
- Update `gateway/.env.example`: remove `SHAPE_SPEC_BEARER_TOKEN`, `STANDARDS_SERVICE_BASE_URL`, `STANDARDS_SERVICE_BEARER_TOKEN`
- Add to `gateway/.env.example`: `IMPLEMENTATION_LLM_SERVICE_BASE_URL` (default http://localhost:8000), `IMPLEMENTATION_LLM_SERVICE_BEARER_TOKEN` (required)
- Group new vars under a clear section header (e.g., "IMPLEMENTATION LLM PROXY SERVICE")

**Test Requirements**
- Create `gateway/src/services/__tests__/implementationLlmProxyClient.test.ts`
- Test that Authorization header is always present and correct
- Test correct URL construction from base URL + path
- Test request body is forwarded unchanged
- Test missing token throws Error before fetch
- Test missing base URL throws Error before fetch
- Test AbortSignal cancellation propagates correctly
- Update or remove tests for deleted clients

## Visual Design
N/A - Backend/infrastructure changes only.

## Existing Code to Leverage

**shapeSpecUpstreamClient.ts (to be deleted)**
- Header merging pattern: converts Headers/array/object formats to plain object before merging
- Authorization header always overrides caller-provided value (security pattern)
- AbortSignal passthrough in RequestInit options
- Debug logging pattern with url, method, hasBody, hasSignal

**standardsServiceClient.ts (to be deleted)**
- Identical structure to shapeSpecUpstreamClient but without AbortSignal emphasis
- Simpler pattern useful for informing `postJson` convenience helper design

**orchestrationClient.ts (to be refactored)**
- Retain typed interfaces and error classification (422 validation, 5xx server, AbortError timeout)
- AbortController-based timeout pattern (60s default)
- Logging pattern for request metadata without sensitive payload content

**config.ts patterns**
- Use existing `parseIntEnv`, `parseBoolEnv` helper functions
- Follow existing pattern of empty string default for optional tokens (checked per-request)
- Follow existing comment style referencing spec names

## Out of Scope
- Changing frontend API calls or components
- Changing implementation LLM proxy service (localhost:8000) behavior or endpoints
- Adding retry logic, circuit breakers, or async job polling
- Changes to `architectureModelClient.ts` (different upstream service)
- Changes to `openaiClient.ts` (different upstream service)
- Changes to MCP configuration or mcp-server
- Adding new endpoints or routes
- Changing authentication mechanism (remains Bearer token)
- Adding request caching or response caching
- Multi-tenant or per-request token configuration
