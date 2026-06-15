# Requirements: Unify Implementation LLM Proxy Service Config

## Clarifications and Decisions

### 1. Endpoint Path Mapping
**Decision:** Gateway "project" maps to upstream "product" - intentional
- Gateway route: `POST /api/v1/standards/project/generate`
- Upstream path: `POST /api/v1/standards/product/generate`
- This UX-friendly naming is by design

### 2. orchestrationClient.ts Handling
**Decision:** Keep but refactor to use implementationLlmProxyClient.ts internally
- Retain typed interfaces (`OrchestrationRequest`, `OrchestrationResult`)
- Retain error handling logic
- Replace direct `shapeSpecFetch` call with `implementationLlmProxyClient` call

### 3. Shape-Spec Streaming Routes
**Decision:** ALL shape-spec routes use implementationLlmProxyClient.ts
- Include streaming routes (SSE)
- Add dedicated `requestStream(...)` method for streaming use cases
- Preserve streaming-specific logic: AbortSignal, SSE headers, stream forwarding

### 4. Single Base URL
**Decision:** Assume one upstream service at one base URL
- All services (standards, orchestrations, shape-spec) use `IMPLEMENTATION_LLM_SERVICE_BASE_URL`
- Default: `http://localhost:8000`

### 5. AbortSignal Support
**Decision:** Include AbortSignal support in implementationLlmProxyClient.ts
- Required for streaming/cancellation use cases
- Pass through signal to underlying fetch

### 6. ORCHESTRATION_SERVICE_BASE_URL Removal
**Decision:** Remove entirely
- Replace all usage with `IMPLEMENTATION_LLM_SERVICE_BASE_URL`
- No fallback or aliasing

## Env Vars Summary

### Remove (Old)
- `SHAPE_SPEC_BEARER_TOKEN`
- `STANDARDS_SERVICE_BASE_URL`
- `STANDARDS_SERVICE_BEARER_TOKEN`
- `ORCHESTRATION_SERVICE_BASE_URL`

### Add (New)
- `IMPLEMENTATION_LLM_SERVICE_BASE_URL` (default: http://localhost:8000)
- `IMPLEMENTATION_LLM_SERVICE_BEARER_TOKEN` (required, no default)

## Client API Design

### implementationLlmProxyClient.ts

```typescript
// Core request function
request(path: string, options: {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<Response>

// Convenience helpers
postJson(path: string, body: unknown): Promise<Response>
getJson(path: string): Promise<Response>

// Streaming support
requestStream(path: string, options: {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
}): Promise<Response>
```

### Behavior
- Always attach `Authorization: Bearer <token>` header
- Always set `Content-Type: application/json` for JSON bodies
- Always set `Accept: application/json` (except streaming)
- Fail-fast with 500 if base URL or token not configured
- Log requests for debugging

## Files to Delete
- `gateway/src/services/shapeSpecUpstreamClient.ts`
- `gateway/src/services/standardsServiceClient.ts`

## Files to Modify
- `gateway/src/config.ts` - Replace old config with new
- `gateway/src/services/orchestrationClient.ts` - Use new client
- `gateway/src/routes/standardsGenerate.ts` - Use new client
- `gateway/src/routes/projectStandardsGenerate.ts` - Use new client
- `gateway/src/routes/shapeSpec.ts` - Use new client
- `gateway/src/routes/orchestrations.ts` - If direct calls exist
- `gateway/.env.example` - Update env var documentation

## Files to Create
- `gateway/src/services/implementationLlmProxyClient.ts`

## Test Requirements
- Assert Authorization header present on all upstream requests
- Assert correct upstream URL path used
- Assert request body forwarded unchanged
- Test missing token → 500 response
- Test missing base URL → 500 response
- Test streaming with AbortSignal cancellation
