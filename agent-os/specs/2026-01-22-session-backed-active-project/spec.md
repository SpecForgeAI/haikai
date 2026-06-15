# Specification: Session-Backed Active Project When DB Disabled

## Goal

Enable the architecture model service to operate in "no-database" mode where the active project and snapshot are held in-memory within a thread-safe singleton store, providing three core endpoints (get active project, export, import) that function without PostgreSQL.

## User Stories

- As a user running the application without a database, I want to import a project snapshot so that I can view and work with architecture models in a lightweight configuration
- As a user in no-DB mode, I want to export my current session project so that I can save my work to a file

## Specific Requirements

**SessionProjectStore Component**
- Create a new Spring @Component singleton class `SessionProjectStore` in package `com.example.architecturemodel.store`
- Store two fields: `ProjectDto activeProject` and `ProjectSnapshotDto activeSnapshot`
- Use `synchronized` keyword on all public methods for basic thread-safety
- Provide methods: `setActiveProject(ProjectDto, ProjectSnapshotDto)`, `getActiveProject()`, `getActiveSnapshot()`, `clear()`
- Both getter methods return `Optional<T>` to handle null state cleanly
- No persistence - state is lost on server restart (expected for Phase 1)

**ActiveProjectController**
- Create a new controller class `ActiveProjectController` in the controller package
- Map to `/api/projects` base path (same as existing ProjectController)
- DO NOT use `@ConditionalOnProperty` - this controller is always active regardless of database toggle
- Inject both `AppFeaturesProperties` (always available) and optionally `ProjectService`, `ProjectSnapshotService`, `ProjectSnapshotImportService` (only when DB enabled)
- Use `@Autowired(required = false)` for DB-dependent service injections to allow startup when DB is disabled

**GET /api/projects/active Endpoint**
- When `app.features.include-database=true`: delegate to injected `ProjectService.getActiveProject()`
- When `app.features.include-database=false`: return `SessionProjectStore.getActiveProject()` or throw `ResourceNotFoundException` with message "No active project."
- Return HTTP 200 with `ProjectDto` on success, HTTP 404 if no active project

**GET /api/projects/active/export Endpoint**
- When `app.features.include-database=true`: delegate to injected `ProjectSnapshotService.exportActiveProjectSnapshot()`
- When `app.features.include-database=false`: return `SessionProjectStore.getActiveSnapshot()` or throw `ResourceNotFoundException` with message "No active project."
- Return HTTP 200 with `ProjectSnapshotDto` on success, HTTP 404 if no active snapshot

**POST /api/projects/import Endpoint**
- Accept `ProjectSnapshotImportRequestDto` as request body
- When `app.features.include-database=true`: delegate to injected `ProjectSnapshotImportService.importSnapshot(request)` and return HTTP 201
- When `app.features.include-database=false`: create synthetic response and store in SessionProjectStore
- Synthetic ProjectDto construction: generate `UUID.randomUUID()` for id, extract name from snapshot, allow null for projectParentFolder/organisationId, set isActive=true, use `Instant.now()` for timestamps
- Synthetic `ProjectSnapshotImportResultDto`: use synthetic ProjectDto, modelSaved=false, workItemsInserted=0, artifactsInserted=0, warnings=empty list
- Import replaces any existing session project/snapshot (no rejection logic)
- Return HTTP 201 with `ProjectSnapshotImportResultDto`

**GlobalExceptionHandler NoResourceFoundException Fix**
- Add new `@ExceptionHandler` method for `org.springframework.web.servlet.resource.NoResourceFoundException`
- Map to HTTP 404 with JSON body matching existing error response structure: timestamp, status, error, message
- Message should use `ex.getMessage()` or a default "Resource not found" string
- Import `org.springframework.web.servlet.resource.NoResourceFoundException` (Spring 6.1+)

**Existing ProjectController Unchanged**
- The existing `ProjectController` retains its `@ConditionalOnProperty` annotation and remains disabled when DB is off
- No modifications to `ProjectController` are required for this spec

## Visual Design

No visual assets provided - this is a backend-only feature.

## Existing Code to Leverage

**`BootstrapController` Pattern (always-on controller)**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/controller/BootstrapController.java`
- Demonstrates a controller without `@ConditionalOnProperty` that remains active regardless of feature toggles
- Use same logging pattern and response structure approach

**`AppFeaturesProperties` Configuration**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/config/AppFeaturesProperties.java`
- Provides `isIncludeDatabase()` method to check database feature toggle state
- Inject this to determine whether to use DB services or SessionProjectStore

**`GlobalExceptionHandler` Error Response Pattern**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/exception/GlobalExceptionHandler.java`
- Follow existing `LinkedHashMap` response body structure with timestamp, status, error, message fields
- Use `@ExceptionHandler` annotation and return `ResponseEntity<Map<String, Object>>`

**`ProjectSnapshotImportResultDto` Static Factory**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/export/ProjectSnapshotImportResultDto.java`
- Use `ProjectSnapshotImportResultDto.of(project, modelSaved, workItemsInserted, artifactsInserted)` to create result with empty warnings list

**`ProjectDto` Record Structure**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/ProjectDto.java`
- 8-field record: id (UUID), name, projectParentFolder, projectHierarchy, organisationId, isActive, createdAt, updatedAt
- Use this structure when creating synthetic ProjectDto for no-DB import response

## Out of Scope

- HTTP session-scoped beans or per-user session isolation
- Concurrent user support or multi-tenant session management
- Persistence of session state across server restarts
- Modification of existing ProjectController (remains conditionally disabled)
- Other DB CRUD controllers (remain disabled when DB is off)
- Frontend/UI changes
- Advanced error handling beyond NoResourceFoundException
- Work item or artifact operations in no-DB mode
- Model save operations in no-DB mode (modelSaved always false)
- Project hierarchy or organisation lookup in no-DB mode
