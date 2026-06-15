# Specification: Fix Server Startup Ambiguous Mapping for GET /api/projects/active

## Goal
Resolve Spring Boot startup failure caused by ambiguous request mappings where both `ProjectController` and `ActiveProjectController` map duplicate endpoints under `/api/projects/active`, ensuring exactly one controller handles each route so the server starts reliably.

## User Stories
- As a developer, I want the backend server to start without ambiguous mapping errors so that I can run and test the application
- As a developer, I want a clear controller ownership model so that I know where to find and modify active project endpoint logic

## Specific Requirements

**Remove duplicate GET /api/projects/active from ProjectController**
- Delete the `getActiveProject()` method at lines 230-235 in `ProjectController.java`
- This method duplicates the same endpoint in `ActiveProjectController` at lines 78-84
- After removal, `ProjectController` should no longer have any `/active` or `/active/*` mappings
- Retain all other `ProjectController` endpoints: `POST /api/projects`, `GET /api/projects`, `POST /{id}/activate`, `DELETE /{id}`

**Remove duplicate GET /api/projects/active/export from ProjectController**
- Delete the `exportActiveProject()` method at lines 255-260 in `ProjectController.java`
- This method duplicates the same endpoint in `ActiveProjectController` at lines 94-100
- `ActiveProjectController.exportActiveProjectSnapshot()` already provides this functionality

**Remove duplicate POST /api/projects/import from ProjectController**
- Delete the `importProject()` method at lines 197-205 in `ProjectController.java`
- This method duplicates the same endpoint in `ActiveProjectController` at lines 110-117
- `ActiveProjectController.importSnapshot()` already provides this functionality

**Keep ActiveProjectController as single owner of active-project routes**
- `ActiveProjectController` remains the authoritative handler for:
  - `GET /api/projects/active` - get active project
  - `GET /api/projects/active/export` - export active project snapshot
  - `POST /api/projects/import` - import project snapshot
- No changes to `ActiveProjectController` implementation or annotations
- Maintain the existing `@ConditionalOnProperty` for DB-conditional loading

**Scan for additional duplicates in /api/projects/active namespace**
- Search `ProjectController` for any other `@GetMapping`, `@PostMapping`, `@PutMapping`, or `@DeleteMapping` annotations containing "active" in their path
- Remove any additional duplicates found
- Do not modify endpoints outside the `/api/projects/active` namespace

**Enforce clean build for verification**
- Run `mvn clean compile` to remove stale `.class` files before testing
- Stale bytecode from previous compilations can cause phantom controllers to remain registered
- CI/build pipelines should include clean step when controllers are deleted or renamed

## Visual Design
No visual assets provided - this is a backend controller refactoring task.

## Existing Code to Leverage

**ActiveProjectController.java (keep as-is)**
- Located at `controller/ActiveProjectController.java`
- Already correctly implements all three active-project endpoints
- Uses same service dependencies: `ProjectService`, `ProjectSnapshotService`, `ProjectSnapshotImportService`
- Has proper `@ConditionalOnProperty` annotation for DB-conditional loading

**Controller pattern conventions**
- Controllers use `@RestController` with class-level `@RequestMapping`
- Methods use `@GetMapping`, `@PostMapping`, `@PutMapping`, `@DeleteMapping` with path fragments
- All DB-dependent controllers include `@ConditionalOnProperty(name = "app.features.include-database", havingValue = "true", matchIfMissing = true)`
- Controllers use Lombok `@Slf4j` for logging with `log.debug()` or `log.info()` patterns

**Service layer (no changes needed)**
- `ProjectService.getActiveProject()` - returns active project DTO
- `ProjectSnapshotService.exportActiveProjectSnapshot()` - exports project snapshot
- `ProjectSnapshotImportService.importSnapshot()` - imports project snapshot
- All service methods are already correctly implemented and shared between controllers

## Out of Scope
- Any DB/Liquibase schema changes
- Any DTO shape or response payload modifications
- Any auth/security configuration changes
- Any service layer logic changes
- Refactoring endpoints outside `/api/projects/active` namespace (e.g., `POST /api/projects`, `GET /api/projects`, `POST /{id}/activate`)
- Frontend URL or API client changes
- Adding new endpoints or functionality
- Changing `ActiveProjectController` implementation
- Modifying the `@ConditionalOnProperty` conditional logic
- Changes to `ProjectSessionController` or session-based project handling
