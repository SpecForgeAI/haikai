# Task Breakdown: Persist Implement Context per Work Item in Backend

## Overview
Total Tasks: 4 Task Groups with 21 sub-tasks

This feature persists the Implement context (architecture entities and diagrams linked to a work item) in the backend database, replacing localStorage as the primary storage mechanism. This enables context selections to persist across browser sessions and devices.

## Task List

### Backend Database Layer

#### Task Group 1: Database Migration, Entity, and Repository
**Dependencies:** None

- [ ] 1.0 Complete database layer for work item implement context
  - [ ] 1.1 Write 4-6 focused tests for WorkItemImplementContextEntity and Repository
    - Test entity creation with valid JSONB arrays for entity IDs and diagram IDs
    - Test `findByProjectIdAndWorkItemId` returns Optional with correct data
    - Test `findByProjectIdAndWorkItemId` returns empty Optional when not found
    - Test `deleteByProjectIdAndWorkItemId` removes the record
    - Test unique constraint on (project_id, work_item_id) prevents duplicates
    - Test timestamps are properly managed by @PrePersist and @PreUpdate hooks
  - [ ] 1.2 Create database migration `026-work-item-implement-context.sql`
    - Table: `work_item_implement_context`
    - Columns: id (UUID primary key), project_id (TEXT NOT NULL), work_item_id (UUID NOT NULL), selected_entity_ids (JSONB, default empty array), selected_diagram_ids (JSONB, default empty array), created_at (TIMESTAMP), updated_at (TIMESTAMP)
    - Unique constraint on (project_id, work_item_id)
    - Index on project_id for query performance
    - Index on work_item_id for query performance
    - Follow migration pattern from existing `017-package-sets.sql`
  - [ ] 1.3 Add changeset entry to `db.changelog-master.yaml`
    - Add changeset id: `026-work-item-implement-context`
    - Use precondition: `not tableExists work_item_implement_context`
    - Reference SQL file: `db/changelog/sql/026-work-item-implement-context.sql`
  - [ ] 1.4 Create `WorkItemImplementContextEntity.java` in `model/entity/`
    - Follow patterns from `WorkItemEntity.java`
    - Lombok annotations: @Getter, @Setter, @NoArgsConstructor, @AllArgsConstructor, @Builder
    - JPA annotations: @Entity, @Table(name = "work_item_implement_context")
    - Fields: id (UUID, @Id), projectId (String), workItemId (UUID), selectedEntityIds (List<String>), selectedDiagramIds (List<String>), createdAt (Instant), updatedAt (Instant)
    - Map JSONB arrays using `@Type(JsonType.class)` from hypersistence-utils
    - @PrePersist and @PreUpdate hooks for timestamp management
  - [ ] 1.5 Create `WorkItemImplementContextRepository.java` in `repository/entity/`
    - Extend `JpaRepository<WorkItemImplementContextEntity, UUID>`
    - Add `Optional<WorkItemImplementContextEntity> findByProjectIdAndWorkItemId(String projectId, UUID workItemId)`
    - Add `void deleteByProjectIdAndWorkItemId(String projectId, UUID workItemId)`
  - [ ] 1.6 Ensure database layer tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify migration runs successfully
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- Migration creates table with correct schema and constraints
- Entity correctly maps JSONB arrays for entity and diagram IDs
- Repository finder and delete methods work correctly
- Unique constraint on (project_id, work_item_id) is enforced

---

### Backend Service and API Layer

#### Task Group 2: DTO, Service, and Controller
**Dependencies:** Task Group 1

- [ ] 2.0 Complete API layer for work item implement context
  - [ ] 2.1 Write 4-6 focused tests for Service and Controller
    - Test `getContext` returns empty lists when no context exists
    - Test `getContext` returns existing context data correctly
    - Test `saveContext` creates new context record (insert)
    - Test `saveContext` updates existing context record (upsert)
    - Test GET endpoint returns 200 with ImplementContextDto
    - Test PUT endpoint accepts body and returns 200 with updated ImplementContextDto
  - [ ] 2.2 Create `ImplementContextDto.java` record in `model/dto/`
    - Follow patterns from `WorkItemDto.java`
    - Fields: projectId, workItemId (UUID), selectedEntityIds (List<String>), selectedDiagramIds (List<String>)
    - @JsonProperty annotations with snake_case: `project_id`, `work_item_id`, `selected_entity_ids`, `selected_diagram_ids`
  - [ ] 2.3 Create `WorkItemImplementContextService.java` in `service/`
    - Follow patterns from `WorkItemService.java`
    - Annotations: @Service, @RequiredArgsConstructor, @Slf4j
    - Inject `WorkItemImplementContextRepository`
    - Implement `ImplementContextDto getContext(String projectId, UUID workItemId)`:
      - Return existing context mapped to DTO if found
      - Return DTO with empty lists (not null) if not found
      - Log operation using @Slf4j
    - Implement `ImplementContextDto saveContext(String projectId, UUID workItemId, List<String> entityIds, List<String> diagramIds)`:
      - Upsert: find existing or create new entity
      - Update selectedEntityIds and selectedDiagramIds
      - Save entity and return mapped DTO
      - Log operation using @Slf4j
  - [ ] 2.4 Create `WorkItemImplementContextController.java` in `controller/`
    - Follow patterns from `WorkItemController.java`
    - Annotations: @RestController, @RequestMapping("/api/projects/{projectId}/work-items/{workItemId}/implement-context"), @RequiredArgsConstructor, @Slf4j
    - Inject `WorkItemImplementContextService`
    - GET endpoint `@GetMapping`:
      - Path variables: projectId (String), workItemId (UUID)
      - Validate projectId not blank
      - Return `ResponseEntity<ImplementContextDto>`
      - Log debug message
    - PUT endpoint `@PutMapping`:
      - Path variables: projectId (String), workItemId (UUID)
      - @RequestBody with selectedEntityIds and selectedDiagramIds arrays
      - Validate projectId not blank and request body not null
      - Return `ResponseEntity<ImplementContextDto>`
      - Log debug message
  - [ ] 2.5 Ensure API layer tests pass
    - Run ONLY the 4-6 tests written in 2.1
    - Verify GET returns correct or empty context
    - Verify PUT creates/updates context correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 2.1 pass
- DTO serializes to snake_case JSON correctly
- Service returns empty lists (not null) when no context exists
- Service performs upsert on save operations
- Controller endpoints follow REST conventions and error handling patterns

---

### Frontend API and Integration Layer

#### Task Group 3: Frontend API Client and ProductImplementPage Integration
**Dependencies:** Task Group 2

- [ ] 3.0 Complete frontend integration with backend context API
  - [ ] 3.1 Write 4-6 focused tests for frontend API and integration
    - Test `fetchImplementContext` returns ContextState with correct mapping
    - Test `fetchImplementContext` handles empty context (empty arrays)
    - Test `saveImplementContext` sends correct snake_case payload
    - Test ProductImplementPage loads context from API on workItemId change
    - Test ProductImplementPage saves context via API on handleContextApply
    - Test ProductImplementPage shows loading state while fetching context
  - [ ] 3.2 Create `implementContextApi.ts` in `frontend/src/api/`
    - Follow patterns from `workItemsApi.ts`
    - Use `API_BASE` from environment variable
    - Define `ImplementContextDto` interface (snake_case API response):
      - project_id: string
      - work_item_id: string
      - selected_entity_ids: string[]
      - selected_diagram_ids: string[]
    - Implement `fetchImplementContext(projectId: string, workItemId: string): Promise<ContextState>`:
      - URL: `${API_BASE}/api/projects/{projectId}/work-items/{workItemId}/implement-context`
      - Use encodeURIComponent for path parameters
      - Map snake_case response to ContextState (entity_refs, diagram_refs format)
      - Handle errors with descriptive messages
    - Implement `saveImplementContext(projectId: string, workItemId: string, state: ContextState): Promise<ContextState>`:
      - PUT request with JSON body
      - Map ContextState to snake_case request payload (selected_entity_ids, selected_diagram_ids)
      - Map snake_case response to ContextState
      - Handle errors with descriptive messages
  - [ ] 3.3 Modify `ProductImplementPage.tsx` to use backend API
    - Import `fetchImplementContext` and `saveImplementContext` from new API module
    - Add `contextLoading` state for loading indicator
    - Modify `loadContext` useEffect (lines ~99-107):
      - Call `fetchImplementContext(loadedFileName, workItemId)` instead of localStorage `loadContext`
      - Set `contextLoading` true before API call, false after
      - Handle API errors gracefully (fall back to empty context)
      - Keep localStorage `saveContext` as secondary cache after successful API fetch
    - Modify `handleContextApply` callback (lines ~157-166):
      - Call `saveImplementContext(loadedFileName, workItemId, newState)` after state update
      - Keep localStorage save as optional secondary cache
      - Handle API errors gracefully (log warning, don't block UI)
    - Modify `handleRemoveEntityChip` callback (lines ~169-184):
      - Call `saveImplementContext` after state update
      - Keep localStorage save as secondary cache
    - Modify `handleRemoveDiagramChip` callback (lines ~187-202):
      - Call `saveImplementContext` after state update
      - Keep localStorage save as secondary cache
    - Add loading state UI:
      - Show loading indicator in context section while `contextLoading` is true
  - [ ] 3.4 Ensure frontend tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify API client maps snake_case to camelCase correctly
    - Verify ProductImplementPage integrates with API
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 3.1 pass
- API client correctly maps between snake_case API and camelCase frontend types
- ProductImplementPage loads context from backend API on work item selection
- ProductImplementPage saves context to backend API on apply and chip removal
- Loading state is shown while fetching context from backend
- localStorage is used as secondary cache, backend is authoritative

---

### Testing and Verification

#### Task Group 4: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-3

- [ ] 4.0 Review existing tests and fill critical gaps only
  - [ ] 4.1 Review tests from Task Groups 1-3
    - Review the 4-6 tests written by backend-database-engineer (Task 1.1)
    - Review the 4-6 tests written by backend-api-engineer (Task 2.1)
    - Review the 4-6 tests written by frontend-engineer (Task 3.1)
    - Total existing tests: approximately 12-18 tests
  - [ ] 4.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows that lack test coverage
    - Focus ONLY on gaps related to implement context persistence
    - Prioritize integration points between frontend and backend
    - Do NOT assess entire application test coverage
  - [ ] 4.3 Write up to 6 additional strategic tests maximum
    - Add maximum of 6 new tests to fill identified critical gaps
    - Focus on:
      - End-to-end: Context persists after page reload (integration test)
      - End-to-end: Context is available from different browser session (integration test)
      - Error handling: Backend unavailable falls back to localStorage gracefully
      - Concurrent updates: Multiple saves do not corrupt data
    - Do NOT write comprehensive coverage for all scenarios
    - Skip edge cases, performance tests unless business-critical
  - [ ] 4.4 Run feature-specific tests only
    - Run ONLY tests related to implement context persistence (tests from 1.1, 2.1, 3.1, and 4.3)
    - Expected total: approximately 18-24 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 18-24 tests total)
- Critical user workflows for implement context persistence are covered
- No more than 6 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Backend Database Layer (Task Group 1)** - Foundation for data persistence
   - Migration, entity, and repository must be in place before service/controller

2. **Backend Service and API Layer (Task Group 2)** - Business logic and REST endpoints
   - Depends on database layer being complete

3. **Frontend API and Integration (Task Group 3)** - Connect UI to backend
   - Depends on backend API being available

4. **Testing and Verification (Task Group 4)** - Ensure quality and fill gaps
   - Depends on all feature implementation being complete

---

## Technical Reference

### Files to Create
- `architecture-model-service/src/main/resources/db/changelog/sql/026-work-item-implement-context.sql`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/WorkItemImplementContextEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/WorkItemImplementContextRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/ImplementContextDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/WorkItemImplementContextService.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/controller/WorkItemImplementContextController.java`
- `frontend/src/api/implementContextApi.ts`

### Files to Modify
- `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` (add changeset)
- `frontend/src/components/ProductView/ProductImplementPage.tsx` (API integration)

### Existing Patterns to Follow
- `WorkItemEntity.java` - JPA entity with JSONB, Lombok, timestamps
- `WorkItemRepository.java` - Spring Data JPA repository
- `WorkItemDto.java` - Record DTO with @JsonProperty snake_case
- `WorkItemService.java` - Service with @Transactional, @Slf4j logging
- `WorkItemController.java` - REST controller with validation and error handling
- `workItemsApi.ts` - Frontend API client with snake_case mapping
- `contextStorage.ts` - ContextState type definitions
