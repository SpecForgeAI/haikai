# Spec Requirements: Centralize Bearer Authentication for ALL Gateway to Shape-Spec Service Requests

## Initial Description

Ensure that ALL HTTP requests from the Gateway to the Shape-Spec service (localhost:8000) automatically include Bearer authentication, without exposing credentials to the frontend and without requiring per-endpoint auth handling.

This establishes localhost:8000 as an authenticated upstream service.

**Key Principles:**
- Authentication is applied at the Gateway integration boundary
- ALL Gateway to localhost:8000 requests MUST include: `Authorization: Bearer <configured token>`
- Frontend must never send authentication headers for Shape-Spec calls
- No per-route or per-endpoint auth logic is allowed

## Requirements Discussion

### First Round Questions

**Q1:** Routing - Create a new Gateway proxy route for Shape-Spec streaming, or integrate into existing orchestration routes?
**Answer:** Create a new Gateway proxy route that the frontend calls (e.g., POST /api/v1/shape-spec/stream) and have the Gateway forward to localhost:8000 with Bearer auth. Do NOT try to shoehorn this into existing orchestration routes; keep orchestration as-is and add the stream proxy.

**Q2:** Centralized auth mechanism - What approach for the centralized auth wrapper?
**Answer:** Create a small wrapper utility around fetch for the localhost:8000 upstream that auto-injects Authorization for ALL calls to that upstream. Keep it simple and focused (e.g., upstream8000Fetch / shapeSpecUpstreamClient). No need to generalize into a big "authenticated upstream framework" in this spec.

**Q3:** orchestrationClient.ts - Should it use the same centralized upstream auth mechanism?
**Answer:** Yes. Update it to use the SAME centralized upstream auth mechanism. localhost:8000 is one authenticated upstream; /api/v1/orchestrations and /api/v1/shape-spec/stream must be treated the same for auth.

**Q4:** Config behavior - How should missing token be handled?
**Answer:** Add SHAPE_SPEC_BEARER_TOKEN to the existing config.ts pattern. Do NOT fail at startup; fail fast per-request if a call to localhost:8000 is attempted without the token (clear internal error). No "proceed without auth".

**Q5:** Streaming proxy - Should the Gateway transparently proxy SSE?
**Answer:** Yes. The Gateway should transparently proxy SSE without buffering (pipe/stream the upstream response body through to the client, preserving streaming behavior).

**Q6:** 401/403 handling - How should auth failures be surfaced to frontend?
**Answer:** Return a generic, opaque error to the frontend (no upstream auth details). A consistent error shape is fine; message like "Unable to start Shape-Spec stream" / "Upstream authentication failed" is acceptable, without exposing token specifics or full upstream response.

**Q7:** Explicit exclusions - What should be explicitly out of scope?
**Answer:** Exclude/defer token rotation/refresh, multi-tenant or user-scoped auth, logging of sensitive auth material, detailed error diagnostics, retry/backoff, circuit breakers, and any support for multiple upstream hosts.

### Existing Code to Reference

No similar existing features were explicitly identified for reference. The user mentioned:
- `orchestrationClient.ts` - existing client that must be updated to use the new centralized auth mechanism
- `config.ts` - existing configuration pattern to follow for adding SHAPE_SPEC_BEARER_TOKEN

### Follow-up Questions

No follow-up questions were needed. The user's answers were comprehensive and addressed all implementation concerns.

## Visual Assets

### Files Provided:

No visual assets provided.

### Visual Insights:

N/A - No visual files were found in the planning/visuals folder.

## Requirements Summary

### Functional Requirements

- Create a new Gateway proxy route (e.g., POST /api/v1/shape-spec/stream) that forwards requests to localhost:8000
- Build a small, focused fetch wrapper utility (e.g., `upstream8000Fetch` or `shapeSpecUpstreamClient`) that auto-injects Authorization header for ALL calls to localhost:8000
- Update existing `orchestrationClient.ts` to use the same centralized auth mechanism
- Add `SHAPE_SPEC_BEARER_TOKEN` configuration following existing config.ts patterns
- Implement transparent SSE streaming proxy (pipe/stream upstream response without buffering)
- Return generic, opaque errors to frontend on auth failures (401/403)

### Technical Requirements

- **Config Loading**: Token loaded from environment/config, NOT validated at startup
- **Fail-Fast Per Request**: If token is missing when a request is made to localhost:8000, fail immediately with clear internal error
- **No Proceed Without Auth**: Never attempt upstream calls without the Authorization header
- **SSE Streaming**: Preserve Server-Sent Events streaming behavior through the proxy
- **Error Opacity**: Frontend receives sanitized error messages like "Unable to start Shape-Spec stream" or "Upstream authentication failed" without token details or full upstream response

### Reusability Opportunities

- The centralized auth wrapper should be usable by both the new /api/v1/shape-spec/stream route AND the existing orchestrationClient.ts
- Follow existing config.ts pattern for adding new configuration values

### Scope Boundaries

**In Scope:**
- New Gateway proxy route for Shape-Spec streaming
- Centralized fetch wrapper with auto-injected Bearer auth for localhost:8000
- Update orchestrationClient.ts to use centralized auth
- SHAPE_SPEC_BEARER_TOKEN configuration
- Transparent SSE streaming proxy
- Generic error responses for auth failures
- Per-request token validation (fail-fast if missing)

**Out of Scope:**
- Token rotation or refresh mechanisms
- Multi-tenant or user-scoped authentication
- Logging of sensitive authentication material
- Detailed error diagnostics exposed to frontend
- Retry logic or backoff strategies
- Circuit breaker patterns
- Support for multiple upstream hosts
- Frontend changes (beyond consuming the new proxy endpoint)
- Startup-time token validation

### Technical Considerations

- Gateway is a Node.js/TypeScript application using fetch
- localhost:8000 is the Shape-Spec service upstream
- SSE (Server-Sent Events) must be streamed through without buffering
- Existing orchestration routes should remain unchanged (only add new route)
- Single authenticated upstream pattern (localhost:8000 only)
