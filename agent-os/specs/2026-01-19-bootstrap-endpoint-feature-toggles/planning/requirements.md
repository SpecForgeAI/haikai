# Spec Requirements: Bootstrap Endpoint for Feature Toggles

## Initial Description

Create a backend endpoint that exposes feature toggle configuration to the frontend, replacing the current static `/runtime-config.json` file approach with a dynamic API-driven configuration.

The user's requirements are explicit:
- Create GET /api/bootstrap endpoint returning {includeDelivery, includeDatabase} from AppFeaturesProperties
- Replace frontend's /runtime-config.json fetch with /api/bootstrap call
- The UI gating logic already exists - just need to wire the backend values through

## Requirements Discussion

### Codebase Analysis (In Lieu of Q&A)

The user provided detailed guidance alongside comprehensive codebase analysis, making clarifying questions unnecessary.

**Backend Analysis:**

**Q: Where is the feature toggle configuration defined?**
**Answer:** `architecture-model-service/src/main/java/com/example/architecturemodel/config/AppFeaturesProperties.java`
- Already contains `includeDelivery` (boolean, default true) and `includeDatabase` (boolean, default true)
- Configurable via application.yml, environment variables, or command-line arguments
- Annotated with `@ConfigurationProperties(prefix = "app.features")`

**Q: What endpoint patterns exist for simple GET endpoints?**
**Answer:** Existing controllers demonstrate the pattern:
- `ProjectController.java` has `@GetMapping("/active")` returning a DTO
- Standard `ResponseEntity<T>` return types
- `@RestController` + `@RequestMapping` base path pattern

**Q: Is CORS already configured?**
**Answer:** Yes, in `WebConfig.java`
- CORS configured for `/api/**` endpoints
- Allows GET, POST, PUT, DELETE, PATCH, OPTIONS methods
- Frontend origins (localhost:5173, 3000, 8080) already allowed

**Frontend Analysis:**

**Q: How does the frontend currently load configuration?**
**Answer:** `frontend/src/contexts/AppConfigContext.tsx`
- `loadRuntimeConfig()` function fetches from `/runtime-config.json`
- Returns `AppConfig` with `includeDelivery` and `includeDatabase` booleans
- Has fallback to `DEFAULT_CONFIG` on error (both toggles default to true)
- Logs warnings once per lifecycle for missing/invalid config

**Q: What is the API base URL pattern?**
**Answer:** From `frontend/src/api/modelApi.ts`:
```typescript
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';
```
Empty string defaults to same origin for Vite proxy in development.

**Q: Where is the current static config file?**
**Answer:** `frontend/public/runtime-config.json`
```json
{
  "includeDelivery": true,
  "includeDatabase": true
}
```

**Q: Is the UI gating already implemented?**
**Answer:** Yes, fully implemented:
- `TopBar.tsx`: Uses `useIncludeDelivery()` to conditionally render "Product & Delivery" button
- `FileMenu.tsx`: Uses `useIncludeDatabase()` to conditionally render database-dependent menu items (Create, Open, Save, Save As, Delete)
- `App.tsx`: Has view navigation guard that redirects from 'product' to 'metamodel' when includeDelivery=false

### Existing Code to Reference

**Similar Features Identified:**
- Controller: `ProjectController.java` at `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ProjectController.java` - demonstrates GET endpoint pattern
- Config Properties: `AppFeaturesProperties.java` at `architecture-model-service/src/main/java/com/example/architecturemodel/config/AppFeaturesProperties.java` - source of toggle values
- Frontend API: `modelApi.ts` at `frontend/src/api/modelApi.ts` - demonstrates API_BASE pattern and fetch calls
- Config Context: `AppConfigContext.tsx` at `frontend/src/contexts/AppConfigContext.tsx` - file to modify for API integration

### Follow-up Questions

None required - requirements are explicit and codebase analysis provides all necessary context.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A - This is a backend/frontend wiring feature with no UI changes.

## Requirements Summary

### Functional Requirements
- Create GET `/api/bootstrap` endpoint in the backend
- Endpoint returns JSON with `includeDelivery` (boolean) and `includeDatabase` (boolean)
- Values sourced from `AppFeaturesProperties` configuration class
- Frontend `loadRuntimeConfig()` changed to fetch from `/api/bootstrap` instead of `/runtime-config.json`
- Maintain fallback behavior: if endpoint fails, default both toggles to `true`
- Maintain existing warning logging behavior for config load failures

### Reusability Opportunities
- `AppFeaturesProperties` already exists and is fully configured - just inject and use
- Existing `AppConfigContext.tsx` has robust error handling - preserve this pattern
- API_BASE pattern from `modelApi.ts` should be reused for consistency
- CORS already configured for `/api/**` - no changes needed

### Scope Boundaries

**In Scope:**
- New `BootstrapController.java` with GET `/api/bootstrap` endpoint
- DTO class for bootstrap response (optional - could use inline record or Map)
- Update `loadRuntimeConfig()` in `AppConfigContext.tsx` to call API
- Unit tests for new controller
- Update or remove `/public/runtime-config.json` (may keep as fallback or remove entirely)

**Out of Scope:**
- Any UI changes (gating already fully implemented)
- Changes to `AppFeaturesProperties.java` (already complete)
- Additional configuration fields beyond includeDelivery/includeDatabase
- Authentication/authorization for bootstrap endpoint (should be public)
- Caching of bootstrap response

### Technical Considerations
- Bootstrap endpoint should NOT be conditionally loaded based on `includeDatabase` (it's a bootstrap endpoint needed before any feature gating)
- Endpoint should be lightweight and fast (called on every app load)
- Consider: Should the endpoint return additional bootstrap data in the future? (Current requirement: just the two toggles)
- Frontend should handle network errors gracefully with defaults (existing pattern)
- No database dependency for this endpoint (reads from application config only)
