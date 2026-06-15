# Specification: Fix Bootstrap Toggle Mapping

## Goal
Fix the JSON property naming mismatch between backend (snake_case) and frontend (camelCase) so that feature toggles from `/api/bootstrap` correctly control UI gating instead of always falling back to default true values.

## User Stories
- As a platform administrator, I want the `include_delivery` and `include_database` settings from the backend to be correctly applied in the UI so that I can control which features are available to users.
- As a developer, I want the backend tests to assert the actual JSON structure produced at runtime so that test failures accurately reflect production behavior.

## Specific Requirements

**Frontend config parsing must read snake_case keys**
- Update `loadRuntimeConfig()` in `AppConfigContext.tsx` to read `include_delivery` from the response object
- Update `loadRuntimeConfig()` to read `include_database` from the response object
- Prefer snake_case keys (`include_delivery`, `include_database`) as the primary property names
- Support camelCase keys (`includeDelivery`, `includeDatabase`) as fallback for backward compatibility
- Use nullish coalescing to fall back to camelCase if snake_case is undefined
- Maintain existing default value fallback when neither property exists

**Backend test assertions must use snake_case JSON paths**
- Update `BootstrapControllerTest.java` to assert `$.include_delivery` instead of `$.includeDelivery`
- Update `BootstrapControllerTest.java` to assert `$.include_database` instead of `$.includeDatabase`
- Ensure all jsonPath assertions in the test file use snake_case keys
- Tests should validate the actual JSON structure that the frontend receives at runtime

**Frontend test for snake_case payload parsing**
- Add a new test in the frontend test suite that verifies snake_case payload parsing
- Test should mock a bootstrap response with `{"include_delivery": false, "include_database": false}`
- Test should verify that `loadRuntimeConfig()` returns `{ includeDelivery: false, includeDatabase: false }`
- Test should confirm that snake_case values are correctly mapped to the camelCase AppConfig interface

## Visual Design
No visual assets provided.

## Existing Code to Leverage

**AppConfigContext.tsx (frontend/src/contexts/AppConfigContext.tsx)**
- Contains `loadRuntimeConfig()` function at lines 112-156 that needs modification
- Lines 144-147 currently read camelCase properties: `configObj.includeDelivery` and `configObj.includeDatabase`
- Uses `validateBoolean()` helper function to validate boolean values
- Has `DEFAULT_CONFIG` constant with fallback values (both true)

**BootstrapControllerTest.java (architecture-model-service/src/test/java/.../controller/BootstrapControllerTest.java)**
- Contains 4 test methods with jsonPath assertions that need updating
- Uses MockMvc with `@WebMvcTest` annotation which may not load full Jackson configuration
- Current assertions at lines 40-43, 56-57, 65, 78-79, 87 use camelCase paths

**application.yml (architecture-model-service/src/main/resources/application.yml)**
- Lines 29-30 define global Jackson `property-naming-strategy: SNAKE_CASE`
- This configuration causes all Java record fields to serialize as snake_case
- No changes needed to this file; this is the root cause reference

**feature-toggle-integration.test.tsx (frontend/src/__tests__/feature-toggle-integration.test.tsx)**
- Existing test patterns for feature toggle behavior
- Mocks `useIncludeDelivery` and `useIncludeDatabase` hooks
- Can serve as a reference for test structure and mocking patterns

## Out of Scope
- Changing the Jackson naming strategy in application.yml
- Modifying the BootstrapResponse.java record or adding Jackson annotations
- Adding any new API endpoints or backend functionality
- Refactoring the AppConfigContext beyond fixing the property name mapping
- Adding UI indicators or messages about feature toggle states
- Changing the AppConfig TypeScript interface property names (keep camelCase internally)
- Modifying any other backend controllers or DTOs
- Adding integration tests beyond the specific snake_case parsing test
- Performance optimizations or caching changes
- Error handling improvements beyond the current implementation
