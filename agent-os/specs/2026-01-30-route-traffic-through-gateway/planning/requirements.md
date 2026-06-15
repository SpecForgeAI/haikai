# Spec Requirements: Route Traffic Through Gateway

## Initial Description

Route all browser-to-upstream traffic through the Gateway service to centralize authentication and eliminate direct browser calls to localhost:8000. The frontend should only communicate with the Gateway, which handles bearer token injection for upstream services.

## Requirements Discussion

### First Round Questions

**Q1:** For useShapeSpecStream.ts, should we follow the same pattern as shapeSpecApi.ts (use Gateway-relative URLs via VITE_GATEWAY_BASE_URL) or implement a different approach for streaming endpoints?
**Answer:** Yes. Change to follow the same pattern as shapeSpecApi.ts:
- Remove the localhost:8000 fallback entirely.
- Use Gateway-relative URLs (VITE_GATEWAY_BASE_URL ?? '') so a missing env var cannot cause direct upstream calls.

**Q2:** For the orchestrations proxy, should the Gateway use browser-forwarded Authorization headers, inject its own server-side Bearer token, or support both modes?
**Answer:** Use shapeSpecFetch() instead of raw fetch().
- Remove browser Authorization forwarding.
- Inject ONLY the server-side Bearer token.
- Treat localhost:8000 as a single authenticated upstream for all endpoints.

**Q3:** Should the Gateway abort upstream requests when the client connection closes (e.g., user navigates away during a long-running orchestration)?
**Answer:** Yes.
- Pass an AbortController.signal into shapeSpecFetch().
- Abort the upstream request when the client connection closes.

**Q4:** What should happen if SHAPE_SPEC_BEARER_TOKEN is missing? Should the Gateway fail on startup, return errors at request time, or have a fallback behavior?
**Answer:** Yes.
- shapeSpecFetch() throwing when SHAPE_SPEC_BEARER_TOKEN is missing is sufficient and desired.
- No need for additional startup-time validation in this spec.

**Q5:** When upstream authentication fails (401/403), should the Gateway forward the upstream status code or return a generic 401/403 to the browser to avoid leaking upstream auth details?
**Answer:** Yes.
- Returning a generic message like { error: 'Upstream authentication failed' } meets the requirement.
- Do not expose upstream auth details or status codes to the frontend.

**Q6:** Should we add a Vite dev proxy for /api/v1/shape-spec endpoints so developers can run the frontend without a full Gateway during local development?
**Answer:** No.
- Do NOT add a Vite dev proxy for /api/v1/shape-spec.
- The frontend should call the Gateway directly; the Gateway is the intended integration boundary.

**Q7:** Are there any endpoints or scenarios where direct localhost:8000 access should be preserved (e.g., debugging, health checks)?
**Answer:** No.
- Do NOT preserve any direct localhost:8000 access paths.
- All browser -> localhost:8000 traffic must be eliminated, even for debugging, to avoid regressions.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: shapeSpecApi.ts - Path: `frontend/src/api/shapeSpecApi.ts` (pattern to follow for Gateway-relative URLs)
- Feature: shapeSpecFetch() - Gateway service utility for authenticated upstream requests
- Backend logic to reference: Existing Gateway proxy implementation for orchestrations endpoints

### Follow-up Questions

No follow-up questions were needed. The user provided comprehensive answers covering all aspects of the implementation.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A - This is a backend infrastructure change with no UI components.

## Requirements Summary

### Functional Requirements
- Frontend useShapeSpecStream.ts must use Gateway-relative URLs via VITE_GATEWAY_BASE_URL
- Remove all localhost:8000 fallback logic from frontend code
- Gateway orchestrations proxy must use shapeSpecFetch() instead of raw fetch()
- Gateway must inject server-side Bearer token only (no browser Authorization forwarding)
- Gateway must abort upstream requests when client connection closes
- Gateway must return generic error messages for upstream auth failures (no status code leakage)

### Reusability Opportunities
- Follow existing shapeSpecApi.ts pattern for Gateway-relative URL construction
- Reuse shapeSpecFetch() utility for authenticated upstream requests
- Leverage existing Gateway proxy infrastructure

### Scope Boundaries

**In Scope:**
- Modify useShapeSpecStream.ts to use Gateway-relative URLs
- Remove localhost:8000 fallback from streaming endpoints
- Update orchestrations proxy to use shapeSpecFetch()
- Remove browser Authorization header forwarding in orchestrations proxy
- Implement AbortController.signal passing for client disconnect handling
- Return generic error responses for upstream auth failures

**Out of Scope:**
- Vite dev proxy configuration (explicitly excluded)
- Startup-time validation of SHAPE_SPEC_BEARER_TOKEN
- Preserving any direct browser-to-localhost:8000 access paths
- Any debugging endpoints that bypass the Gateway

### Technical Considerations
- VITE_GATEWAY_BASE_URL environment variable must be set (empty string default prevents direct upstream calls)
- shapeSpecFetch() throws when SHAPE_SPEC_BEARER_TOKEN is missing (fail-fast at request time)
- AbortController integration required for proper request cleanup
- Error responses must not expose upstream service details or status codes
- Gateway is the single integration boundary for all frontend-to-upstream communication
