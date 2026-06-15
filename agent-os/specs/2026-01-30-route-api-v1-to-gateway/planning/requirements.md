# Spec Requirements: Route /api/v1 to Gateway

## Initial Description

Route all /api/v1 frontend requests to Gateway via Vite proxy. Ensure that all frontend HTTP requests under the /api/v1 path are routed to the Gateway service in development, preventing accidental proxying to the architecture-model-service (localhost:8080) and eliminating "Resource not found" errors for Gateway-owned endpoints.

## Requirements Discussion

### First Round Questions

**Q1:** For the environment variable, should we reuse the existing `chatApiTarget` (which already points to the Gateway on localhost:8081) or introduce a separate `VITE_GATEWAY_TARGET` variable? Reusing `chatApiTarget` seems simpler since the Gateway is the same service.
**Answer:** Yes - reuse the existing `chatApiTarget` (the Gateway target, e.g. localhost:8081). Do not introduce a new `VITE_GATEWAY_TARGET` variable for this spec.

**Q2:** Should the existing `/api/chat` and `/api/chat/stream` proxy rules remain as-is, or should they be consolidated under a broader `/api/v1/*` pattern if chat endpoints are also v1?
**Answer:** Yes - keep the existing `/api/chat` and `/api/chat/stream` proxy rules exactly as-is for backward compatibility. This spec only adds `/api/v1/*` routing.

**Q3:** I assume this change is only for the Vite dev server proxy (`vite.config.ts`) and not for Docker/Nginx configuration, since the production routing would be handled differently. Is that correct?
**Answer:** Correct - this is a `vite.config.ts` dev-proxy fix only. No Docker or compose changes required.

**Q4:** Are there any `/api/v1/*` paths that should NOT go to the Gateway (i.e., should still route to architecture-model-service), or should ALL `/api/v1/*` requests route to Gateway?
**Answer:** No - all `/api/v1/*` paths should route to the Gateway (no carve-outs in this spec).

### Existing Code to Reference

**Similar Features Identified:**
- Feature: Existing chat proxy rules - Path: `frontend/vite.config.ts`
- Components to potentially reuse: The existing proxy configuration pattern with `chatApiTarget` variable
- Backend logic to reference: N/A (frontend-only change)

### Follow-up Questions

No follow-up questions were needed.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A

## Requirements Summary

### Functional Requirements
- Add a new proxy rule for `/api/v1/*` paths in the Vite development server configuration
- Route all `/api/v1/*` requests to the Gateway service (same target as `chatApiTarget`, defaulting to localhost:8081)
- The new rule must be placed before the generic `/api` catch-all rule to ensure it matches first
- Preserve all existing proxy rules (`/api/chat/stream`, `/api/chat`, `/api`) unchanged

### Reusability Opportunities
- Reuse the existing `chatApiTarget` environment variable - no new env vars needed
- Follow the same proxy configuration pattern already established for chat routes
- Reference file: `frontend/vite.config.ts` for existing proxy structure

### Scope Boundaries

**In Scope:**
- Add `/api/v1/*` proxy rule to `vite.config.ts`
- Route to Gateway using existing `chatApiTarget` variable
- Ensure correct rule ordering (before `/api` catch-all)

**Out of Scope:**
- Docker or docker-compose configuration changes
- Nginx configuration changes
- Production deployment routing
- New environment variables
- Modifying existing `/api/chat` or `/api/chat/stream` rules
- Any carve-outs or exceptions for specific `/api/v1/*` paths

### Technical Considerations
- Vite proxy rules are matched in order of specificity/definition - the `/api/v1` rule must come before the generic `/api` rule
- The Gateway service runs on port 8081 by default (same as chat endpoints)
- The existing `chatApiTarget` env var (defaults to `http://localhost:8081`) should be reused
- Standard proxy options should match existing rules: `changeOrigin: true`, `secure: false`
