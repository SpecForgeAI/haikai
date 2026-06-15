# Specification: Centralize Bearer Authentication for Gateway to Shape-Spec Service Requests

## Goal

Ensure that ALL HTTP requests from the Gateway to the Shape-Spec service (localhost:8000) automatically include Bearer authentication, without exposing credentials to the frontend and without requiring per-endpoint auth handling. This establishes localhost:8000 as an authenticated upstream service with centralized, consistent auth injection.

## User Stories

- As a backend developer, I want all Gateway-to-Shape-Spec requests to automatically include Bearer auth so that I never need to add auth handling per-endpoint
- As a security engineer, I want frontend requests to never contain Shape-Spec credentials so that authentication tokens are not exposed to client-side code

## Specific Requirements

**A) Gateway Configuration - SHAPE_SPEC_BEARER_TOKEN**
- Add `shapeSpecBearerToken` to the `Config` interface in `gateway/src/config.ts`
- Load from environment variable `SHAPE_SPEC_BEARER_TOKEN` with no default value (empty string or undefined if not set)
- DO NOT validate at startup; the token presence is checked per-request
- Follow the existing pattern: use `process.env.SHAPE_SPEC_BEARER_TOKEN || ''` in `loadConfig()`
- Add entry to `.env.example` with documentation comment

**B) Centralized HTTP Client - upstream8000Fetch Wrapper**
- Create new file `gateway/src/services/shapeSpecUpstreamClient.ts`
- Export a single function: `shapeSpecFetch(path: string, options: RequestInit): Promise<Response>`
- Auto-inject `Authorization: Bearer <token>` header for ALL requests
- Fail fast with clear error if `shapeSpecBearerToken` is missing/empty when called
- Use `getConfig().orchestrationServiceBaseUrl` as the base URL (localhost:8000)
- Preserve all other headers and options passed by caller
- Do NOT attempt any upstream call if token is missing

**C) New Proxy Route - POST /api/v1/shape-spec/stream**
- Create new file `gateway/src/routes/shapeSpec.ts` with a dedicated router
- Register as `app.use('/api/v1/shape-spec', shapeSpecRouter)` in server.ts
- Implement `POST /stream` endpoint that proxies to `localhost:8000/api/v1/shape-spec/stream`
- Use the `shapeSpecFetch` wrapper for upstream requests
- Transparently proxy SSE without buffering (pipe upstream response body directly to client)
- Set SSE headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`
- Forward request body unchanged (company, project, message, session_mode)

**D) Update orchestrationClient.ts to Use Shared Auth**
- Modify `gateway/src/services/orchestrationClient.ts` to use `shapeSpecFetch` wrapper
- Replace direct `fetch()` calls with `shapeSpecFetch(ORCHESTRATION_API_PATH, {...})`
- Remove any manual header construction for Authorization
- All existing behavior (timeout, error handling) remains unchanged

**E) Frontend Changes - Call Gateway Instead of localhost:8000**
- Update `frontend/src/api/shapeSpecApi.ts` to call Gateway endpoint
- Change `SHAPE_SPEC_BASE_URL` to use `VITE_GATEWAY_BASE_URL ?? ''` (same-origin)
- Update `SHAPE_SPEC_STREAM_PATH` to `/api/v1/shape-spec/stream`
- Remove any Authorization header logic from frontend (never send auth headers)
- The frontend fetch request body remains unchanged

**F) Error Handling - Opaque Errors and Fail-Fast**
- If `SHAPE_SPEC_BEARER_TOKEN` is missing at request time, return HTTP 500 with generic message
- Do NOT expose token absence to frontend; log detailed error server-side only
- If upstream returns 401/403, return HTTP 502 with message "Upstream authentication failed"
- If upstream is unreachable, return HTTP 503 with message "Shape-Spec service unavailable"
- Never include token value or upstream auth details in any response body

## Existing Code to Leverage

**gateway/src/config.ts - Configuration Pattern**
- Follow exact pattern for adding new config fields (interface + loadConfig function)
- Use existing helper functions: `parseIntEnv`, `parseBoolEnv` if needed
- Config is accessed via `getConfig()` singleton throughout codebase

**gateway/src/services/orchestrationClient.ts - Upstream Client Pattern**
- Shows the existing pattern for calling localhost:8000 with fetch
- Demonstrates timeout handling with AbortController
- Shows error categorization (422, 5xx, network errors)
- Must be refactored to use the new shapeSpecFetch wrapper

**gateway/src/routes/orchestrations.ts - Proxy Route Pattern**
- Lines 322-464: Existing `/v1/orchestrations` proxy route implementation
- Shows header forwarding pattern, timeout handling, response proxying
- Currently forwards Authorization from request; new pattern injects from config
- Use as template for new shape-spec streaming proxy route

**gateway/src/routes/chat.ts - SSE Streaming Pattern**
- Lines 845-848: SSE header setup for streaming responses
- Line 861: Writing SSE events with `res.write()`
- Shows proper streaming response handling for Express

**frontend/src/api/orchestrationApi.ts - Frontend API Client Pattern**
- Uses `GATEWAY_BASE` from `VITE_GATEWAY_BASE_URL` environment variable
- Pattern to follow for updating shapeSpecApi.ts

## Out of Scope

- Token rotation or refresh mechanisms (static token only)
- Multi-tenant or user-scoped authentication (single service token)
- Logging of sensitive auth material (token values)
- Detailed error diagnostics exposed to frontend
- Retry logic or backoff strategies for failed requests
- Circuit breaker patterns
- Support for multiple upstream hosts (localhost:8000 only)
- Startup-time token validation (fail-fast per-request only)
- Frontend changes beyond calling Gateway endpoint (no UI changes)
- Rate limiting specific to the shape-spec proxy route
