# Task Breakdown: Fix Bootstrap Toggle Mapping

## Overview
Total Tasks: 3 Task Groups, 12 Sub-tasks

This is a targeted bug fix to resolve the JSON property naming mismatch between the backend (snake_case) and frontend (camelCase) for feature toggles in the `/api/bootstrap` endpoint.

## Task List

### Backend Testing

#### Task Group 1: Backend Test Assertions Update
**Dependencies:** None

- [x] 1.0 Complete backend test assertion updates
  - [x] 1.1 Review current BootstrapControllerTest.java assertions
    - Identify all jsonPath assertions using camelCase keys
    - Document lines that need updating (lines 40-43, 56-57, 65, 78-79, 87)
  - [x] 1.2 Update jsonPath assertions to use snake_case keys
    - Change `$.includeDelivery` to `$.include_delivery`
    - Change `$.includeDatabase` to `$.include_database`
    - Update all 4 test methods with correct assertions
  - [x] 1.3 Run BootstrapControllerTest to verify assertions
    - Execute only `BootstrapControllerTest.java`
    - Verify tests pass with snake_case assertions
    - Confirm tests now validate actual runtime JSON structure

**Acceptance Criteria:**
- All jsonPath assertions in BootstrapControllerTest.java use snake_case keys
- Tests pass successfully validating snake_case JSON structure
- Test assertions match actual runtime behavior of Jackson SNAKE_CASE strategy

### Frontend Implementation

#### Task Group 2: Frontend Config Parsing Fix
**Dependencies:** None (can run in parallel with Task Group 1)

- [x] 2.0 Complete frontend config parsing fix
  - [x] 2.1 Write test for snake_case payload parsing
    - Create test that mocks bootstrap response with `{"include_delivery": false, "include_database": false}`
    - Assert that `loadRuntimeConfig()` correctly maps to `{ includeDelivery: false, includeDatabase: false }`
    - Verify snake_case values take precedence over defaults
  - [x] 2.2 Update loadRuntimeConfig() to read snake_case keys
    - Modify lines 144-147 in AppConfigContext.tsx
    - Read `include_delivery` as primary key with `includeDelivery` fallback
    - Read `include_database` as primary key with `includeDatabase` fallback
    - Use nullish coalescing: `configObj.include_delivery ?? configObj.includeDelivery`
  - [x] 2.3 Run frontend tests to verify implementation
    - Execute the new snake_case parsing test from 2.1
    - Verify existing AppConfigContext tests still pass
    - Confirm feature toggles correctly reflect backend values

**Acceptance Criteria:**
- New test for snake_case payload parsing passes
- `loadRuntimeConfig()` correctly reads snake_case keys from bootstrap response
- Backward compatibility maintained with camelCase fallback
- Existing default value fallback preserved when neither property exists

### Integration Verification

#### Task Group 3: End-to-End Verification
**Dependencies:** Task Groups 1 and 2

- [x] 3.0 Complete integration verification
  - [x] 3.1 Run full backend test suite for BootstrapController
    - Execute all BootstrapControllerTest methods
    - Verify no regressions in bootstrap endpoint behavior
  - [x] 3.2 Run frontend AppConfigContext test suite
    - Execute all tests related to AppConfigContext
    - Verify snake_case parsing and backward compatibility
  - [ ] 3.3 Manual verification (optional)
    - Start backend with `include_delivery: false` and `include_database: false`
    - Verify frontend correctly hides gated features
    - Confirm toggle values reflect backend configuration

**Acceptance Criteria:**
- All backend BootstrapController tests pass
- All frontend AppConfigContext tests pass
- Feature toggles correctly control UI gating based on backend values

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `architecture-model-service/src/test/java/com/example/architecturemodel/controller/BootstrapControllerTest.java` | Modify | Update jsonPath assertions from camelCase to snake_case |
| `frontend/src/contexts/AppConfigContext.tsx` | Modify | Update loadRuntimeConfig() to read snake_case keys with camelCase fallback |
| `frontend/src/__tests__/AppConfigContext.test.tsx` or similar | Create/Modify | Add test for snake_case payload parsing |

## Execution Order

Recommended implementation sequence:

```
Task Group 1 (Backend Tests) ─────┐
                                  ├──> Task Group 3 (Integration Verification)
Task Group 2 (Frontend Fix) ──────┘
```

1. **Task Groups 1 and 2 can run in parallel** - They have no dependencies on each other
   - Task Group 1: Update backend test assertions to snake_case
   - Task Group 2: Fix frontend config parsing and add test

2. **Task Group 3 runs after both complete** - Verifies the full fix works end-to-end

## Technical Notes

### Root Cause Reference
The backend uses Jackson with `property-naming-strategy: SNAKE_CASE` configured in `application.yml` (lines 29-30). This causes Java record fields like `includeDelivery` to serialize as `include_delivery` in JSON responses.

### Code Change Details

**BootstrapControllerTest.java changes:**
```java
// Before
.andExpect(jsonPath("$.includeDelivery").value(true))
.andExpect(jsonPath("$.includeDatabase").value(true))

// After
.andExpect(jsonPath("$.include_delivery").value(true))
.andExpect(jsonPath("$.include_database").value(true))
```

**AppConfigContext.tsx changes (lines 144-147):**
```typescript
// Before
includeDelivery: validateBoolean(configObj.includeDelivery) ?? DEFAULT_CONFIG.includeDelivery,
includeDatabase: validateBoolean(configObj.includeDatabase) ?? DEFAULT_CONFIG.includeDatabase,

// After
includeDelivery: validateBoolean(configObj.include_delivery ?? configObj.includeDelivery) ?? DEFAULT_CONFIG.includeDelivery,
includeDatabase: validateBoolean(configObj.include_database ?? configObj.includeDatabase) ?? DEFAULT_CONFIG.includeDatabase,
```

### Out of Scope Reminders
- Do NOT modify `application.yml` Jackson configuration
- Do NOT modify `BootstrapResponse.java` record
- Do NOT add Jackson annotations
- Do NOT refactor beyond the targeted fix
