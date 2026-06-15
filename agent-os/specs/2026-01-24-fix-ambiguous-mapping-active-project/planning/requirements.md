# Spec Requirements: Fix Server Startup Ambiguous Mapping for GET /api/projects/active

## Initial Description

Resolve Spring Boot startup failure caused by ambiguous request mappings: both ProjectController#getActiveProject and an existing ActiveProjectController#getActiveProject are mapped to GET /api/projects/active. Ensure there is exactly one controller/handler mapping for /api/projects/active (and related active-project routes) so the server starts reliably.

**Scope Includes:**
- Remove duplicate GET mapping for /api/projects/active
- Consolidate all "active project" endpoints into a single controller with stable route structure
- Ensure compilation overwrites any stale class artifacts for ActiveProjectController

**Out of Scope:**
- Any DB/liquibase changes (this is not a DB issue)
- Any changes to endpoint URLs consumed by the frontend (routes remain the same)

## Requirements Discussion

### First Round Questions

**Q1:** Controller Consolidation Target - Should we keep a dedicated ActiveProjectController and remove the duplicate mappings from ProjectController, or consolidate everything into ProjectController?
**Answer:** Keep a dedicated `ActiveProjectController` and remove the duplicate mappings from `ProjectController`.

**Q2:** Scope of Changes - Should changes be strictly limited to the active-project routes, or should we scan for other potential duplicates in the project namespace?
**Answer:** Strictly limited to the active-project routes (i.e., anything under `/api/projects/active` and `/api/projects/active/*`). Quickly scan for other duplicates in that namespace, but don't refactor unrelated project endpoints.

**Q3:** Stale Class Artifact Handling - Should we enforce a clean build as part of the fix verification?
**Answer:** Yes - enforce a clean build as part of the fix verification. Run `mvn clean` (and ideally ensure your run config/build pipeline does a clean when controllers are deleted/renamed) so stale `.class` files can't keep phantom controllers around.

**Q4:** Frontend URL Stability - Confirm that we should not change any frontend URLs at all?
**Answer:** Correct - do not change the frontend URLs at all. Keep `/api/projects/active` (and any existing `/api/projects/active/export`, etc.) exactly the same.

**Q5:** Verification - What verification steps should be performed?
**Answer:**
- Confirm the server starts without the ambiguous mapping error
- Run the existing test suite (unit/integration) if present
- If there are any controller mapping tests / Spring context load tests, those should pass too

**Q6:** Additional Constraints - Any other areas that should not be changed?
**Answer:** Do NOT change:
- Any DB/liquibase
- Any DTO shapes / response payloads
- Any auth/security config
- Any service layer logic
- Only remove the duplicate route mapping and ensure a clean build removes stale artifacts

### Existing Code to Reference

No similar existing features identified for reference. The fix involves identifying and removing duplicate mappings within the existing `ProjectController` and `ActiveProjectController` classes.

### Follow-up Questions

None required - all requirements were clearly specified in the user's answers.

## Visual Assets

### Files Provided:

No visual assets provided.

### Visual Insights:

Not applicable for this backend controller refactoring task.

## Requirements Summary

### Functional Requirements

- Remove duplicate GET mapping for `/api/projects/active` from `ProjectController`
- Keep `ActiveProjectController` as the single handler for all active-project routes
- Maintain all existing active-project endpoints: `/api/projects/active`, `/api/projects/active/export`, and any other `/api/projects/active/*` routes
- Ensure server starts without ambiguous mapping errors

### Reusability Opportunities

- No new patterns to introduce; this is a cleanup/fix of existing code
- Standard Spring Boot controller organization patterns apply

### Scope Boundaries

**In Scope:**
- Removing duplicate route mappings from `ProjectController` for `/api/projects/active` namespace
- Quick scan for other duplicates within the `/api/projects/active/*` namespace
- Clean build verification (`mvn clean`)
- Running existing test suite to verify no regressions

**Out of Scope:**
- DB/Liquibase changes
- DTO shape or response payload changes
- Auth/security configuration changes
- Service layer logic changes
- Refactoring unrelated project endpoints outside the `/api/projects/active` namespace
- Frontend URL changes

### Technical Considerations

- Spring Boot ambiguous mapping detection happens at startup
- Stale `.class` files can cause phantom controllers to remain even after source deletion
- Must run `mvn clean` to ensure stale artifacts are removed
- Build pipeline should be configured to clean when controllers are deleted/renamed
- Backend tech stack: Java 21, Spring Boot 3.x, Maven

### Verification Criteria

1. Server starts successfully without ambiguous mapping error
2. All existing unit tests pass
3. All existing integration tests pass
4. Spring context load tests pass (if any exist)
5. `/api/projects/active` endpoint responds correctly
6. Any other `/api/projects/active/*` endpoints continue to work as before
