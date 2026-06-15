# Specification: Route all Shape-Spec + Orchestration traffic through Gateway with upstream Bearer auth

## Goal

Fix the Implement flow so the browser never calls localhost:8000 directly, routing all Shape-Spec and Orchestration traffic through the Gateway service which handles server-side Bearer token injection for upstream authentication.

## User Stories

- As a frontend user, I want all Shape-Spec API calls to route through the Gateway so that I never encounter 401 errors from direct localhost:8000 calls
- As a developer, I want a single authentication boundary at the Gateway so that upstream credentials are never exposed to the browser

## Specific Requirements

**Frontend useShapeSpecStream.ts must use Gateway-relative URLs**
- Remove the localhost:8000 fallback entirely from the SHAPE_SPEC_BASE_URL constant
- Change from `VITE_SHAPE_SPEC_BASE_URL ?? 'http://localhost:8000'` to `VITE_GATEWAY_BASE_URL ?? ''`
- Follow the same pattern already established in shapeSpecApi.ts (line 27)
- Empty string default ensures missing env var routes to same-origin Gateway, not direct upstream
- This eliminates any possibility of the frontend calling localhost:8000 directly

**Gateway orchestrations.ts proxy must use shapeSpecFetch()**
- Replace raw fetch() call in the POST /v1/orchestrations route with shapeSpecFetch()
- shapeSpecFetch() automatically injects SHAPE_SPEC_BEARER_TOKEN for all upstream calls
- Remove browser Authorization header forwarding (lines 377-380 in current code)
- The Gateway treats localhost:8000 as a single authenticated upstream for all endpoints
- Inject ONLY the server-side Bearer token, never forward client-provided auth headers

**Gateway shapeSpec.ts must abort upstream requests on client disconnect**
- Create AbortController before making the shapeSpecFetch() call
- Pass the AbortController.signal to shapeSpecFetch() via the options parameter
- Connect the AbortController to the existing req.on('close') client disconnect handler
- When client disconnects, call abortController.abort() to cancel the upstream request
- This prevents orphaned upstream requests when users navigate away during long streams

**shapeSpecFetch() must accept AbortSignal parameter**
- Update shapeSpecFetch() to accept an optional AbortSignal in the options parameter
- Pass the signal through to the underlying fetch() call
- The signal is part of standard RequestInit, so minimal changes needed
- Document the signal parameter in the JSDoc example

**Generic error responses for upstream auth failures**
- Return `{ error: 'Upstream authentication failed' }` for 401/403 responses (already implemented in shapeSpec.ts)
- Do not expose upstream status codes, auth details, or error messages to the frontend
- Log detailed error information server-side for debugging purposes
- Consistent error response format across all Gateway proxy routes

**No Vite dev proxy for shape-spec endpoints**
- Do NOT add a Vite dev proxy for /api/v1/shape-spec endpoints
- Frontend must call the Gateway directly in all environments
- Gateway is the intended integration boundary for frontend-to-upstream communication
- Developers must run the Gateway service for local development

## Existing Code to Leverage

**shapeSpecApi.ts pattern for Gateway-relative URLs**
- Located at `frontend/src/api/shapeSpecApi.ts` (line 27)
- Uses `VITE_GATEWAY_BASE_URL ?? ''` pattern that should be replicated in useShapeSpecStream.ts
- Empty string default routes to same-origin, preventing direct upstream calls
- This is the canonical pattern for all frontend-to-Gateway URL construction

**shapeSpecFetch() utility for authenticated upstream requests**
- Located at `gateway/src/services/shapeSpecUpstreamClient.ts`
- Automatically injects Bearer token from SHAPE_SPEC_BEARER_TOKEN config
- Already used by shapeSpec.ts route, should be adopted by orchestrations.ts
- Fails fast with clear error if token not configured
- Handles header merging and always overrides any caller-provided Authorization

**shapeSpec.ts client disconnect handling pattern**
- Located at `gateway/src/routes/shapeSpec.ts` (lines 120-124)
- Already tracks isClientConnected via req.on('close') handler
- Needs enhancement to also abort the upstream request via AbortController
- Web ReadableStream pump loop already respects isClientConnected flag

**orchestrations.ts existing proxy implementation**
- Located at `gateway/src/routes/orchestrations.ts` (lines 333-464)
- POST /v1/orchestrations route currently uses raw fetch() with browser auth forwarding
- Has timeout handling via AbortController (but for timeout only, not client disconnect)
- Should be refactored to use shapeSpecFetch() and remove browser auth forwarding

## Out of Scope

- Vite dev proxy configuration for shape-spec endpoints (explicitly excluded per requirements)
- Startup-time validation of SHAPE_SPEC_BEARER_TOKEN (request-time validation is sufficient)
- Preserving any direct browser-to-localhost:8000 access paths
- Debugging endpoints that bypass the Gateway
- Changes to the upstream Shape-Spec service (localhost:8000)
- Changes to authentication token configuration or rotation
- Frontend error handling UI changes beyond existing patterns
- Load balancing or multiple upstream instances
- Rate limiting or request throttling at the Gateway
- Caching of upstream responses
