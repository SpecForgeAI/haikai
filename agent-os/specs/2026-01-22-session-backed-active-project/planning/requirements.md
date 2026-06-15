# Spec Requirements: Session-Backed Active Project

## Initial Description

Enable the architecture model service to operate in a "no-database" mode where the active project and snapshot are held in-memory within a session-scoped store. This Phase 1 feature provides three core endpoints (bootstrap, export, import) that work without PostgreSQL, allowing users to work with architecture models in a lightweight, database-free configuration. The existing DB-dependent controllers remain disabled when the database feature is off.

## Requirements Discussion

### First Round Questions

**Q1:** SessionProjectStore Structure - Should this be a simple Spring @Component singleton with in-memory state, or do we need more sophisticated session handling (e.g., HTTP session-scoped beans, concurrent user isolation)?

**Answer:** Simple Spring @Component singleton with in-memory state and basic thread-safety only; no persistence or advanced handling in Phase 1.

**Q2:** Controller Pattern - Should the three Phase 1 endpoints live in a new dedicated controller (e.g., SessionProjectController) that's always enabled, or should we modify existing controllers to conditionally enable these specific endpoints?

**Answer:** Create a new always-on controller for the three endpoints; keep existing ProjectController unchanged and conditionally disabled.

**Q3:** Import Response Shape - When importing a snapshot in no-DB mode, what should the response look like? Should it mirror the existing import endpoint's response structure, or return a simplified acknowledgment?

**Answer:** Return the existing import result DTO shape with a synthetic ProjectDto derived from the snapshot, counts = 0, modelSaved=false, no warnings.

**Q4:** NoResourceFoundException Handling - Should we handle Spring's NoResourceFoundException explicitly in GlobalExceptionHandler to return a proper 404 JSON response instead of the default error page?

**Answer:** Yes - handle Spring's NoResourceFoundException explicitly and map it to HTTP 404.

**Q5:** Synthetic ProjectDto Fields - For the synthetic ProjectDto returned during import, how should we populate fields like id, name, projectParentFolder, and organisationId when no database record exists?

**Answer:** Populate from snapshot where available; otherwise allow null (including projectParentFolder and organisationId) and generate a UUID.

**Q6:** Import Behavior - When a user imports a new snapshot in no-DB mode while one is already active, should the new import replace the existing session project, or should we reject the import?

**Answer:** Import replaces any existing session project/snapshot in DB-disabled mode.

**Q7:** Explicit Exclusions - Are there any specific behaviors or endpoints that should explicitly NOT work in no-DB mode, beyond the obvious database CRUD operations?

**Answer:** Leave DB CRUD controllers unchanged and disabled when DB is off; only the three Phase 1 endpoints are supported in no-DB mode.

### Existing Code to Reference

No similar existing features identified for reference. The user indicated this is backend-only work and no specific existing code patterns were called out.

### Follow-up Questions

None required - all answers were sufficiently detailed.

## Visual Assets

### Files Provided:

No visual assets provided.

### Visual Insights:

Not applicable - this is a backend-only feature with no UI components.

## Requirements Summary

### Functional Requirements

- **SessionProjectStore Component**: A Spring @Component singleton that holds the active project and snapshot in memory with basic thread-safety (e.g., synchronized methods or concurrent data structures)
- **Bootstrap Endpoint**: Returns feature toggle state and application configuration; always available regardless of DB mode
- **Export Endpoint**: Exports the current session-held snapshot as a downloadable file; works in no-DB mode
- **Import Endpoint**: Accepts a snapshot file, stores it in the SessionProjectStore, and returns a response matching the existing import DTO structure with:
  - Synthetic ProjectDto derived from snapshot data
  - UUID generated for project ID
  - Name populated from snapshot if available
  - projectParentFolder and organisationId allowed to be null
  - counts = 0
  - modelSaved = false
  - No warnings
- **Import Replace Behavior**: Subsequent imports in no-DB mode replace any existing session project/snapshot
- **NoResourceFoundException Handling**: GlobalExceptionHandler maps Spring's NoResourceFoundException to HTTP 404 JSON response
- **New Always-On Controller**: Three Phase 1 endpoints live in a dedicated controller that remains enabled regardless of database feature toggle state

### Reusability Opportunities

- Existing import result DTO structure should be reused for import response consistency
- Existing ProjectDto structure should be reused (with synthetic/null values as needed)
- GlobalExceptionHandler pattern for consistent error response formatting

### Scope Boundaries

**In Scope:**
- SessionProjectStore @Component with in-memory state and basic thread-safety
- New controller for bootstrap, export, and import endpoints (always enabled)
- Import endpoint returning existing DTO shapes with synthetic ProjectDto
- Export endpoint serving the session-held snapshot
- Bootstrap endpoint with feature toggle information
- NoResourceFoundException to 404 mapping in GlobalExceptionHandler
- Basic thread-safety for the singleton store

**Out of Scope:**
- HTTP session-scoped beans or per-user session isolation
- Concurrent user support or multi-tenant session management
- Persistence of session state across server restarts
- Modification of existing ProjectController (remains as-is, conditionally disabled)
- Other DB CRUD controllers (remain disabled when DB is off)
- Advanced error handling beyond NoResourceFoundException
- Any frontend/UI changes

### Technical Considerations

- Spring Boot 3.x with Java 21
- @Component singleton pattern for SessionProjectStore
- Basic thread-safety (synchronized or concurrent collections) - no advanced locking
- Existing feature toggle mechanism (app.features.database-enabled) controls DB-dependent beans
- New controller should not be affected by database feature toggle
- Response DTOs should match existing import response structure for frontend compatibility
- GlobalExceptionHandler already exists; extend it for NoResourceFoundException
