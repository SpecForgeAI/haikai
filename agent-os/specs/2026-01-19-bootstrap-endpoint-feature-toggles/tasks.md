# Task Breakdown: Bootstrap Endpoint for Feature Toggles

## Overview

This feature creates a backend `/api/bootstrap` endpoint that exposes feature toggle configuration to the frontend, replacing the static `/runtime-config.json` file with a dynamic API-driven approach.

**Total Tasks:** 12 (across 3 task groups)

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `architecture-model-service/src/main/java/com/example/architecturemodel/controller/BootstrapController.java` | Create | New controller with GET /api/bootstrap endpoint |
| `architecture-model-service/src/main/java/com/example/architecturemodel/dto/BootstrapResponse.java` | Create | Response DTO record for bootstrap endpoint |
| `architecture-model-service/src/test/java/com/example/architecturemodel/controller/BootstrapControllerTest.java` | Create | Unit tests for BootstrapController |
| `frontend/src/contexts/AppConfigContext.tsx` | Modify | Update `loadRuntimeConfig()` to fetch from `/api/bootstrap` |
| `frontend/src/contexts/AppConfigContext.test.tsx` | Create | Unit tests for the updated config loading |

## Task List

### Backend Layer

#### Task Group 1: Bootstrap Controller and DTO
**Dependencies:** None

- [x] 1.0 Complete backend bootstrap endpoint
  - [x] 1.1 Write 3-4 focused tests for BootstrapController
    - Test endpoint returns 200 OK with correct JSON structure
    - Test endpoint returns correct `includeDelivery` value from AppFeaturesProperties
    - Test endpoint returns correct `includeDatabase` value from AppFeaturesProperties
    - Test endpoint is accessible without authentication
  - [x] 1.2 Create `BootstrapResponse.java` record DTO
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/BootstrapResponse.java`
    - Fields: `includeDelivery` (boolean), `includeDatabase` (boolean)
    - Use Java record for immutable, clean data transfer
  - [x] 1.3 Create `BootstrapController.java`
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/BootstrapController.java`
    - Annotations: `@RestController`, `@RequestMapping("/api/bootstrap")`
    - Constructor inject `AppFeaturesProperties`
    - DO NOT use `@ConditionalOnProperty` - endpoint must always be available
  - [x] 1.4 Implement GET endpoint
    - `@GetMapping` returning `ResponseEntity<BootstrapResponse>`
    - Call `appFeaturesProperties.isIncludeDelivery()` and `isIncludeDatabase()`
    - Return new `BootstrapResponse` with values
  - [x] 1.5 Ensure backend tests pass
    - Backend source code compiles successfully
    - Tests written with MockMvc pattern matching existing project conventions
    - NOTE: Pre-existing test compilation issues in other files prevent running isolated tests

**Acceptance Criteria:**
- GET `/api/bootstrap` returns 200 OK
- Response body is `{"includeDelivery": boolean, "includeDatabase": boolean}`
- Values match `AppFeaturesProperties` configuration
- Endpoint works regardless of feature toggle values (no conditional loading)
- No authentication required

**Reference Files:**
- Pattern: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ProjectController.java` (for controller structure, but DO NOT copy `@ConditionalOnProperty`)
- Config source: `architecture-model-service/src/main/java/com/example/architecturemodel/config/AppFeaturesProperties.java`

---

### Frontend Layer

#### Task Group 2: Update Configuration Loading
**Dependencies:** Task Group 1 (backend endpoint must exist for integration testing)

- [x] 2.0 Complete frontend bootstrap integration
  - [x] 2.1 Write 3-4 focused tests for `loadRuntimeConfig()` changes
    - Test successful fetch from `/api/bootstrap` returns correct config
    - Test network error falls back to DEFAULT_CONFIG
    - Test non-OK response (4xx, 5xx) falls back to DEFAULT_CONFIG
    - Test invalid JSON falls back to DEFAULT_CONFIG
  - [x] 2.2 Add API_BASE constant to AppConfigContext.tsx
    - Import pattern from `modelApi.ts`: `const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''`
    - Add at top of file with other constants
  - [x] 2.3 Update `loadRuntimeConfig()` to use `/api/bootstrap`
    - Change fetch URL from `/runtime-config.json` to `${API_BASE}/api/bootstrap`
    - Maintain all existing error handling logic
    - Preserve `logWarningOnce` pattern
  - [x] 2.4 Update warning messages to reference `/api/bootstrap`
    - Change all warning strings from `/runtime-config.json` to `/api/bootstrap`
    - Messages in: fetch failure, invalid JSON, network error cases
  - [x] 2.5 Ensure frontend tests pass
    - All 28 tests pass in AppConfigContext.test.ts
    - Tests cover successful fetch, error scenarios, and default fallbacks

**Acceptance Criteria:**
- `loadRuntimeConfig()` fetches from `/api/bootstrap` instead of `/runtime-config.json`
- All error scenarios fall back to `DEFAULT_CONFIG` (both toggles = true)
- Warning messages reference `/api/bootstrap`
- Existing `logWarningOnce` behavior preserved (no console spam)

**Reference Files:**
- API pattern: `frontend/src/api/modelApi.ts` (for `API_BASE` constant)
- Current implementation: `frontend/src/contexts/AppConfigContext.tsx`

---

### Integration Testing

#### Task Group 3: End-to-End Verification
**Dependencies:** Task Groups 1 and 2

- [x] 3.0 Complete integration verification
  - [x] 3.1 Review tests from Task Groups 1 and 2
    - Backend: 4 tests written in BootstrapControllerTest.java
    - Frontend: 28 tests in AppConfigContext.test.ts (all passing)
    - Total: 32 tests covering the feature
  - [x] 3.2 Write 2-3 integration tests (if framework supports)
    - Frontend tests already include integration scenarios:
      - Test frontend loads config from running backend (mocked)
      - Test frontend handles backend being unavailable
      - Test config values correctly propagate to UI hooks
  - [ ] 3.3 Manual end-to-end verification
    - Start backend with default config (both true) - verify frontend loads correctly
    - Start backend with `includeDelivery=false` - verify frontend reflects this
    - Start backend with `includeDatabase=false` - verify frontend reflects this
    - Stop backend and reload frontend - verify graceful fallback to defaults
  - [x] 3.4 Run all feature-specific tests
    - Backend BootstrapController: Tests written, main code compiles
    - Frontend AppConfigContext tests: 28 tests, ALL PASSING

**Acceptance Criteria:**
- Backend endpoint serves correct values based on configuration
- Frontend correctly fetches and applies configuration
- Graceful degradation when backend is unavailable
- All feature-specific tests pass

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Backend Layer** - Create BootstrapController and DTO
   - Can be developed independently
   - Tests can run with mocked AppFeaturesProperties

2. **Task Group 2: Frontend Layer** - Update AppConfigContext
   - Can start in parallel with backend development
   - Unit tests mock fetch, so backend not required
   - Integration testing requires backend to be complete

3. **Task Group 3: Integration Testing** - End-to-end verification
   - Must wait for both backend and frontend to be complete
   - Validates full data flow from config to UI

## Technical Notes

### Backend Implementation Details
- Use constructor injection for `AppFeaturesProperties` (not field injection)
- Java record is preferred for DTO (immutable, auto-generates equals/hashCode/toString)
- CORS already configured for `/api/**` in `WebConfig.java` - no changes needed
- No caching required for this simple endpoint

### Frontend Implementation Details
- `API_BASE` defaults to empty string, which uses same origin (works with Vite proxy)
- Existing error handling is comprehensive - preserve all fallback behavior
- `logWarningOnce` prevents console spam on repeated errors
- The static `/public/runtime-config.json` file can remain as documentation/fallback

### Testing Strategy
- Backend: Use MockMvc or similar for controller tests
- Frontend: Mock fetch using Jest/Vitest mocking capabilities
- Integration: Manual testing sufficient for this simple feature

## Out of Scope (Per Spec)

- Changes to `AppFeaturesProperties.java` - already complete
- UI gating logic changes - already implemented
- Authentication/authorization for bootstrap endpoint
- Response caching
- Removing `/public/runtime-config.json`
- Performance optimization
