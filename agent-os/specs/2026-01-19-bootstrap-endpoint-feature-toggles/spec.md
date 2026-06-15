# Specification: Bootstrap Endpoint for Feature Toggles

## Goal

Create a backend `/api/bootstrap` endpoint that exposes feature toggle configuration to the frontend, replacing the static `/runtime-config.json` file with a dynamic API-driven approach where the backend is the single source of truth for feature toggles.

## User Stories

- As a system administrator, I want feature toggles to be configured in one place (backend application.yml) so that the UI automatically reflects the correct mode without manual file editing.
- As a developer, I want the frontend to fetch its configuration from the backend API so that configuration is consistent across the entire stack.

## Specific Requirements

**Backend Bootstrap Controller**
- Create `BootstrapController.java` in the controller package with `@RestController` and `@RequestMapping("/api/bootstrap")`
- Implement GET endpoint that returns JSON with `includeDelivery` and `includeDatabase` boolean fields
- Inject `AppFeaturesProperties` via constructor injection and call its getter methods
- Must NOT use `@ConditionalOnProperty` annotation - endpoint must always be available regardless of feature toggle values
- No authentication or authorization required - endpoint is public

**Bootstrap Response Structure**
- Return a simple JSON object: `{ "includeDelivery": boolean, "includeDatabase": boolean }`
- Use a Java record as the response DTO for clean, immutable data transfer
- Field names must match exactly what the frontend AppConfig interface expects

**Frontend Configuration Loading**
- Modify `loadRuntimeConfig()` in `AppConfigContext.tsx` to fetch from `/api/bootstrap` instead of `/runtime-config.json`
- Use the existing `API_BASE` pattern from `modelApi.ts` for URL construction
- Maintain all existing error handling: fallback to DEFAULT_CONFIG on network error, non-OK response, or invalid JSON
- Update warning messages to reference `/api/bootstrap` instead of `/runtime-config.json`

**Error Handling and Resilience**
- Frontend must gracefully handle backend being unavailable (network errors)
- On any error, default both toggles to `true` (full-feature mode)
- Preserve the existing `logWarningOnce` pattern to avoid console spam

## Existing Code to Leverage

**AppFeaturesProperties.java**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/config/AppFeaturesProperties.java`
- Already contains `includeDelivery` and `includeDatabase` with getters (`isIncludeDelivery()`, `isIncludeDatabase()`)
- Inject this class into the new controller to read configuration values

**ProjectController.java**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ProjectController.java`
- Demonstrates the standard controller pattern: `@RestController`, `@RequestMapping`, `@GetMapping`
- Use the same `ResponseEntity<T>` return pattern for GET endpoints
- Note: Do NOT copy the `@ConditionalOnProperty` annotation from this controller

**AppConfigContext.tsx**
- Located at `frontend/src/contexts/AppConfigContext.tsx`
- Contains `loadRuntimeConfig()` function to modify
- Has robust error handling with `logWarningOnce()` helper
- Defines `AppConfig` interface and `DEFAULT_CONFIG` constant to reuse

**modelApi.ts**
- Located at `frontend/src/api/modelApi.ts`
- Shows the `API_BASE` pattern: `const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''`
- Reuse this pattern for constructing the bootstrap endpoint URL

## Out of Scope

- Changes to `AppFeaturesProperties.java` - already complete with required fields
- UI gating logic in TopBar.tsx, FileMenu.tsx, and App.tsx - already implemented and working
- Adding new feature toggles beyond `includeDelivery` and `includeDatabase`
- Authentication or authorization for the bootstrap endpoint
- Caching of bootstrap responses (either frontend or backend)
- Removing or modifying the static `/public/runtime-config.json` file
- Unit tests for the new controller
- Integration tests for the endpoint
- Changes to CORS configuration - already supports `/api/**` endpoints
- Response compression or performance optimization
