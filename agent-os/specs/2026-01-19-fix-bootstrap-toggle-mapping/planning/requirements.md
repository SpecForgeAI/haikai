# Spec Requirements: Fix Bootstrap Toggle Mapping

## Initial Description

The frontend is not correctly reading the feature toggle values from the `/api/bootstrap` endpoint due to a JSON property naming mismatch between the backend (snake_case) and frontend (camelCase).

## Requirements Discussion

### First Round Questions

No clarifying questions were needed. The user provided clear analysis of the issue with specific file references and the expected fix.

### Analysis Findings

**Backend Jackson Configuration** (`architecture-model-service/src/main/resources/application.yml`):
- Lines 29-30 configure Jackson with `property-naming-strategy: SNAKE_CASE`
- This applies globally to all JSON serialization in the application

**BootstrapResponse.java** (`architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/BootstrapResponse.java`):
- Java record with fields: `includeDelivery` and `includeDatabase` (camelCase)
- With SNAKE_CASE strategy, these serialize to: `include_delivery` and `include_database`

**Frontend AppConfigContext.tsx** (`frontend/src/contexts/AppConfigContext.tsx`):
- Lines 144-147 expect camelCase properties from the response:
  ```typescript
  includeDelivery: validateBoolean(configObj.includeDelivery) ?? DEFAULT_CONFIG.includeDelivery,
  includeDatabase: validateBoolean(configObj.includeDatabase) ?? DEFAULT_CONFIG.includeDatabase,
  ```
- When properties are not found (because they're actually snake_case), `validateBoolean()` returns `undefined`
- This causes fallback to `DEFAULT_CONFIG` values (both `true`)

**Backend Tests** (`architecture-model-service/src/test/java/com/example/architecturemodel/controller/BootstrapControllerTest.java`):
- Tests assert camelCase JSON paths: `$.includeDelivery`, `$.includeDatabase`
- These tests likely pass because `@WebMvcTest` may not load full Jackson configuration from application.yml
- Tests should be updated to assert snake_case keys to match actual runtime behavior

### Existing Code to Reference

**Similar Features Identified:**
- Feature: AppConfigContext.tsx - Path: `frontend/src/contexts/AppConfigContext.tsx`
- The fix is localized to this file for the frontend changes

**Backend Files:**
- `architecture-model-service/src/main/resources/application.yml` - Jackson configuration (no changes needed)
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/BootstrapResponse.java` - DTO (no changes needed)
- `architecture-model-service/src/test/java/com/example/architecturemodel/controller/BootstrapControllerTest.java` - Tests need updating

### Follow-up Questions

No follow-up questions were needed. The issue and solution are well-defined.

## Visual Assets

### Files Provided:
No visual assets provided.

## Requirements Summary

### Functional Requirements
- Frontend must correctly read `include_delivery` and `include_database` (snake_case) from the bootstrap response
- Feature toggles must reflect actual backend configuration values instead of always defaulting to `true`
- Backend tests must assert the actual JSON structure that is produced at runtime (snake_case)

### Reusability Opportunities
- No reusable components identified; this is a targeted bug fix

### Scope Boundaries

**In Scope:**
- Update `frontend/src/contexts/AppConfigContext.tsx` to read snake_case properties from the bootstrap response
- Optionally support both camelCase and snake_case for backward compatibility during transition
- Update `BootstrapControllerTest.java` to assert snake_case JSON keys (`$.include_delivery`, `$.include_database`)

**Out of Scope:**
- Changing the Jackson naming strategy in application.yml
- Modifying the BootstrapResponse.java record
- Adding Jackson annotations to override naming for specific endpoints

### Technical Considerations
- Jackson `SNAKE_CASE` naming strategy is a global setting used throughout the backend
- The fix should be minimal and targeted to avoid unintended side effects
- Frontend change is straightforward: read from `include_delivery` instead of `includeDelivery`
- Backend test change ensures tests validate actual runtime behavior
