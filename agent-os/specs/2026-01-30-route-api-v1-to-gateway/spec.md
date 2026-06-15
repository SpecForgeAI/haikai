# Specification: Route /api/v1 to Gateway via Vite Proxy

## Goal
Add a Vite dev server proxy rule to route all `/api/v1/*` requests to the Gateway service, preventing misrouting to architecture-model-service and eliminating "Resource not found" errors for Gateway-owned endpoints.

## User Stories
- As a frontend developer, I want `/api/v1/*` requests to route to the Gateway so that I can develop against Gateway endpoints without encountering proxy errors
- As a developer, I want consistent routing behavior so that Gateway-owned v1 endpoints work correctly in development

## Specific Requirements

**Add /api/v1 proxy rule**
- Add a new proxy rule for the `/api/v1` path pattern in `frontend/vite.config.ts`
- Target the Gateway service using the existing `chatApiTarget` variable (defaults to `http://localhost:8081`)
- Include standard proxy options: `changeOrigin: true`, `secure: false`
- All `/api/v1/*` subpaths must route to Gateway with no exclusions

**Ensure correct proxy rule ordering**
- The `/api/v1` rule MUST be placed BEFORE the generic `/api` catch-all rule
- Vite proxy rules match based on definition order; more specific routes must come first
- Place the new rule after `/api/chat` rules but before the generic `/api` rule
- Recommended order: `/api/chat/stream`, `/api/chat`, `/api/v1`, `/api`

**Preserve existing proxy rules**
- Keep `/api/chat/stream` rule unchanged (targets `chatApiTarget`)
- Keep `/api/chat` rule unchanged (targets `chatApiTarget`)
- Keep generic `/api` rule unchanged (targets `modelApiTarget`)
- Do not modify any existing proxy configuration options

**Reuse existing configuration**
- Use the existing `chatApiTarget` variable (line 12 in current config)
- Do not introduce new environment variables
- Follow the established proxy configuration pattern

## Visual Design
No visual assets provided.

## Existing Code to Leverage

**frontend/vite.config.ts - Proxy Configuration**
- Lines 10-12: Environment variable loading pattern with `loadEnv` and fallback defaults
- Lines 27-45: Existing proxy rules structure within `server.proxy` object
- `chatApiTarget` variable already defined and defaults to `http://localhost:8081`
- Established pattern: each route has `target`, `changeOrigin: true`, `secure: false`
- Comment pattern documents rule ordering requirements (see line 28)

**Proxy rule template from existing chat routes**
- Copy the structure from `/api/chat` rule (lines 34-38)
- Replace path key with `/api/v1`
- Keep same target (`chatApiTarget`) and options
- Add comment explaining the rule purpose

## Out of Scope
- Docker or docker-compose configuration changes
- Nginx configuration changes
- Production deployment routing changes
- Creating new environment variables (e.g., `VITE_GATEWAY_TARGET`)
- Modifying existing `/api/chat` or `/api/chat/stream` proxy rules
- Modifying the generic `/api` proxy rule
- Carve-outs or exceptions for specific `/api/v1/*` subpaths
- Backend service changes
- Testing or validation of specific Gateway endpoints
- Changes to `modelApiTarget` or architecture-model-service routing
