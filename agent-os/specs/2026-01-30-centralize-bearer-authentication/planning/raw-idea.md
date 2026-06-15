# Raw Idea

Title: Centralize Bearer Authentication for ALL Gateway → Shape-Spec Service Requests

Intent
Ensure that ALL HTTP requests from the Gateway to the Shape-Spec service (localhost:8000) automatically include Bearer authentication, without exposing credentials to the frontend and without requiring per-endpoint auth handling.

This establishes localhost:8000 as an authenticated upstream service.

Decision (Explicit)
- Authentication is applied at the Gateway integration boundary.
- ALL Gateway → localhost:8000 requests MUST include:
  Authorization: Bearer <configured token>
- Frontend must never send authentication headers for Shape-Spec calls.
- No per-route or per-endpoint auth logic is allowed.

Required Changes

A) Gateway Configuration (Single Source of Truth)
1. Introduce a Gateway-level configuration value:
   - SHAPE_SPEC_BEARER_TOKEN
   - Loaded from environment or existing config system

2. This token represents service-to-service authentication for the Shape-Spec upstream.

B) Gateway HTTP Client Policy (Centralized)
3. Identify the HTTP client / fetch wrapper / axios instance used by the Gateway to call localhost:8000.

4. Modify this client so that:
   - For ALL requests where the target host is localhost:8000
   - The following header is automatically injected:
     Authorization: Bearer <SHAPE_SPEC_BEARER_TOKEN>

5. This must apply to:
   - POST /api/v1/shape-spec/stream
   - Any future Shape-Spec endpoints
   - Any existing or future HTTP method (POST, GET, etc.)

6. Individual route handlers must NOT manually add auth headers.

C) Frontend Contract
7. Frontend continues to:
   - Call only Gateway endpoints (same-origin)
   - Never reference localhost:8000
   - Never send Authorization headers for Shape-Spec operations

D) Error Handling (Minimal)
8. If SHAPE_SPEC_BEARER_TOKEN is missing:
   - Gateway fails fast with a clear internal error
   - Do not attempt upstream calls

9. If localhost:8000 returns 401/403:
   - Gateway forwards a generic failure
   - Frontend displays a user-friendly error message

Out of Scope
- User-scoped authentication
- Token refresh or rotation
- Supporting multiple Shape-Spec upstreams
- Any frontend exposure of credentials

Success Criteria
- Every Gateway → localhost:8000 request includes Authorization header.
- No browser request ever includes Shape-Spec credentials.
- Adding new Shape-Spec endpoints requires zero auth-related changes.
- Authentication behavior is enforced centrally and consistently.
