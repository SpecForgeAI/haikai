# Task Breakdown: Persist + Rehydrate Implement Workspace

## Overview
Total Tasks: 47

This breakdown implements persistence and rehydration of the full Implement workspace state, enabling developers to resume shaping, planning, clarification, and execution workflows after page reloads, tab switches, and application restarts.

## Task List

### Backend Layer

#### Task Group 1: Database Entity and Repository
**Dependencies:** None

- [x] 1.0 Complete WorkItemImplementWorkspaceEntity and Repository
  - [x] 1.1 Write 4 focused tests for entity and repository
    - Test 1: Repository findByProjectIdAndWorkItemId returns entity when exists
    - Test 2: Repository findByProjectIdAndWorkItemId returns empty Optional when not exists
    - Test 3: Entity @PrePersist sets createdAt and updatedAt timestamps
    - Test 4: Entity @PreUpdate modifies only updatedAt timestamp
  - [x] 1.2 Create WorkItemImplementWorkspaceEntity
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/WorkItemImplementWorkspaceEntity.java`
    - Fields:
      - `id: UUID` (primary key)
      - `projectId: String` (not null)
      - `workItemId: UUID` (not null)
      - `workspaceState: Map<String, Object>` (JSONB column for atomic snapshot)
      - `createdAt: Instant` (not null, updatable=false)
      - `updatedAt: Instant` (not null)
    - Annotations: `@Entity`, `@Table(name = "work_item_implement_workspace")`
    - Use `@Type(JsonType.class)` from Hypersistence for JSONB (follow WorkItemImplementContextEntity pattern)
    - Add `@PrePersist` and `@PreUpdate` lifecycle hooks for timestamps
    - Add `@Builder`, `@Getter`, `@Setter` Lombok annotations
    - Add composite unique index on (project_id, work_item_id)
  - [x] 1.3 Create database migration for work_item_implement_workspace table
    - File: `architecture-model-service/src/main/resources/db/changelog/sql/034-work-item-implement-workspace.sql`
    - Columns: id (uuid, pk), project_id (varchar, not null), work_item_id (uuid, not null), workspace_state (jsonb), created_at (timestamptz), updated_at (timestamptz)
    - Add unique index on (project_id, work_item_id)
    - Add index on project_id for query performance
  - [x] 1.4 Create WorkItemImplementWorkspaceRepository
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/WorkItemImplementWorkspaceRepository.java`
    - Extend JpaRepository<WorkItemImplementWorkspaceEntity, UUID>
    - Add finder: `Optional<WorkItemImplementWorkspaceEntity> findByProjectIdAndWorkItemId(String projectId, UUID workItemId)`
    - Follow pattern from WorkItemImplementContextRepository
  - [x] 1.5 Ensure entity and repository tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify migration runs successfully

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- Entity persists JSONB data correctly
- Migration creates table with proper indexes
- Repository finder method works as expected

---

#### Task Group 2: Backend Service Layer
**Dependencies:** Task Group 1

- [x] 2.0 Complete WorkItemImplementWorkspaceService
  - [x] 2.1 Write 5 focused tests for service methods
    - Test 1: getWorkspace returns empty default when no workspace exists
    - Test 2: getWorkspace returns persisted workspace when exists
    - Test 3: saveWorkspace creates new workspace when none exists
    - Test 4: saveWorkspace updates existing workspace (upsert)
    - Test 5: saveWorkspace preserves createdAt but updates updatedAt
  - [x] 2.2 Create WorkItemImplementWorkspaceDto
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/ImplementWorkspaceDto.java`
    - Use Java record for immutability
    - Fields match frontend workspace state schema:
      - `projectId: String`
      - `workItemId: UUID`
      - `schemaVersion: Integer`
      - `implementationMode: Boolean`
      - `plannerPayload: Map<String, Object>` (nested object)
      - `activeIncrementId: String` (nullable)
      - `questions: List<Map<String, Object>>` (array of question objects)
      - `executionArtifactsByIncrement: Map<String, Object>` (keyed by incrementId)
      - `teamChatTranscript: List<Map<String, Object>>` (array of transcript entries)
    - Use @JsonProperty for snake_case JSON serialization
  - [x] 2.3 Create WorkItemImplementWorkspaceService
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/WorkItemImplementWorkspaceService.java`
    - Add `@Service`, `@RequiredArgsConstructor`, `@Slf4j`
    - Add `@ConditionalOnProperty(name = "app.features.include-database", havingValue = "true", matchIfMissing = true)`
    - Inject WorkItemImplementWorkspaceRepository
    - Methods:
      - `getWorkspace(String projectId, UUID workItemId): ImplementWorkspaceDto`
      - `saveWorkspace(String projectId, UUID workItemId, Map<String, Object> workspaceState): ImplementWorkspaceDto`
    - getWorkspace returns empty default DTO when no entity exists
    - saveWorkspace performs upsert (create or update)
    - Follow pattern from WorkItemImplementContextService
  - [x] 2.4 Implement toDto and fromDto mapping
    - toDto: Convert entity to DTO, extract schemaVersion from JSON
    - Ensure backward compatibility: if schemaVersion missing, default to 1
  - [x] 2.5 Ensure service tests pass
    - Run ONLY the 5 tests written in 2.1
    - Verify upsert behavior works correctly

**Acceptance Criteria:**
- The 5 tests written in 2.1 pass
- Service correctly performs upsert operations
- Empty default returned when no workspace exists
- Timestamps handled correctly

---

#### Task Group 3: Backend Controller Layer (REST Endpoints)
**Dependencies:** Task Group 2

- [x] 3.0 Complete WorkItemImplementWorkspaceController
  - [x] 3.1 Write 4 focused tests for controller endpoints
    - Test 1: GET returns 200 with empty workspace when none exists
    - Test 2: GET returns 200 with populated workspace when exists
    - Test 3: PUT returns 200 and saves workspace correctly
    - Test 4: GET/PUT return 400 for blank projectId or null workItemId
  - [x] 3.2 Create WorkItemImplementWorkspaceController
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/WorkItemImplementWorkspaceController.java`
    - Add `@RestController`, `@RequiredArgsConstructor`, `@Slf4j`
    - Add `@ConditionalOnProperty(name = "app.features.include-database", havingValue = "true", matchIfMissing = true)`
    - Base path: `@RequestMapping("/api/projects/{projectId}/work-items/{workItemId}/implement-workspace")`
    - Inject WorkItemImplementWorkspaceService
  - [x] 3.3 Implement GET endpoint
    - `GET /api/projects/{projectId}/work-items/{workItemId}/implement-workspace`
    - Returns `ResponseEntity<ImplementWorkspaceDto>`
    - Validate projectId not blank, workItemId not null
    - Returns 200 OK with workspace (empty default or populated)
  - [x] 3.4 Implement PUT endpoint
    - `PUT /api/projects/{projectId}/work-items/{workItemId}/implement-workspace`
    - Request body: `SaveWorkspaceRequest` record with `workspaceState: Map<String, Object>`
    - Returns `ResponseEntity<ImplementWorkspaceDto>`
    - Validate inputs, delegate to service.saveWorkspace()
  - [x] 3.5 Ensure controller tests pass
    - Run ONLY the 4 tests written in 3.1
    - Use @WebMvcTest for controller slice testing
    - Mock service layer

**Acceptance Criteria:**
- The 4 tests written in 3.1 pass
- GET returns 200 with appropriate response
- PUT saves and returns updated workspace
- Input validation rejects invalid requests

---

### Frontend API Layer

#### Task Group 4: Frontend API Functions
**Dependencies:** Task Group 3

- [x] 4.0 Complete implementWorkspaceApi
  - [x] 4.1 Write 3 focused tests for API functions
    - Test 1: fetchImplementWorkspace calls GET endpoint and returns parsed response
    - Test 2: saveImplementWorkspace calls PUT endpoint with correct payload
    - Test 3: API functions handle errors gracefully (throw on non-OK response)
  - [x] 4.2 Create implementWorkspaceApi.ts
    - File: `frontend/src/api/implementWorkspaceApi.ts`
    - Define ImplementWorkspaceDto TypeScript interface matching backend DTO
    - Define PersistedWorkspaceState interface for typed workspace state
  - [x] 4.3 Implement fetchImplementWorkspace function
    - `async function fetchImplementWorkspace(projectId: string, workItemId: string): Promise<ImplementWorkspaceDto>`
    - Uses MODEL_SERVICE_BASE from environment
    - Calls GET `/api/projects/{projectId}/work-items/{workItemId}/implement-workspace`
    - Returns parsed JSON response
  - [x] 4.4 Implement saveImplementWorkspace function
    - `async function saveImplementWorkspace(projectId: string, workItemId: string, workspaceState: PersistedWorkspaceState): Promise<ImplementWorkspaceDto>`
    - Calls PUT with JSON body containing workspace_state
    - Returns parsed JSON response
  - [x] 4.5 Ensure API function tests pass
    - Run ONLY the 3 tests written in 4.1
    - Use fetch mocking (vi.mock or jest.mock)

**Acceptance Criteria:**
- The 3 tests written in 4.1 pass
- API functions correctly call backend endpoints
- Type definitions align with backend DTO

---

### Frontend State Management

#### Task Group 5: Workspace State Mapping
**Dependencies:** Task Group 4

- [x] 5.0 Complete state mapping utilities
  - [x] 5.1 Write 4 focused tests for state mapping
    - Test 1: mapStateToPersisted correctly extracts persistable fields
    - Test 2: mapStateToPersisted excludes transient fields (isLoading, isBootstrapping, etc.)
    - Test 3: mapPersistedToState restores state from persisted format
    - Test 4: mapPersistedToState applies safe defaults for missing fields
  - [x] 5.2 Create workspaceStateMapper.ts
    - File: `frontend/src/utils/workspaceStateMapper.ts`
    - Define TransientFields type (fields NOT to persist)
    - Define PersistedWorkspaceState type (fields TO persist)
  - [x] 5.3 Implement mapStateToPersisted function
    - Extract and return only persistable fields:
      - schemaVersion (hardcode to 1 initially)
      - implementationMode
      - plannerPayload (from latestPlannerResponse)
      - activeIncrementId
      - questions (merged PO + SA questions array)
      - executionArtifactsByIncrement (serialized Map)
      - teamChatTranscript (messages array with persona attribution)
    - Exclude: isLoading, isBootstrapping, isImplementing, isSubmittingAnswers, activeTab, isConfirmModalOpen, error, sessionId, inputDraft
  - [x] 5.4 Implement mapPersistedToState function
    - Takes PersistedWorkspaceState, returns partial state object
    - Apply defaults for missing fields (fail-soft)
    - Log warnings for unknown fields but continue
  - [x] 5.5 Ensure mapping tests pass
    - Run ONLY the 4 tests written in 5.1

**Acceptance Criteria:**
- The 4 tests written in 5.1 pass
- Transient fields are correctly excluded
- Missing fields default safely
- Round-trip mapping preserves data integrity

---

#### Task Group 6: Rehydration Logic
**Dependencies:** Task Groups 4, 5

- [x] 6.0 Complete workspace rehydration in ImplementationAssistantPanel
  - [x] 6.1 Write 4 focused tests for rehydration
    - Test 1: On mount, calls fetchImplementWorkspace if no context state
    - Test 2: If workspace exists, applies persisted state to component
    - Test 3: If workspace does not exist, initializes with defaults and triggers bootstrap
    - Test 4: Uses equality guards to prevent unnecessary re-renders
  - [x] 6.2 Add rehydration useEffect hook
    - Location: `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Add new useEffect for workspace rehydration
    - Triggers on mount when messages empty and context state empty
    - Waits for disk hydration complete (existing pattern)
    - Calls fetchImplementWorkspace(projectId, workItemId)
  - [x] 6.3 Apply persisted state to component state
    - On successful fetch with populated workspace:
      - Set implementationMode from persisted state
      - Set latestPlannerResponse from plannerPayload
      - Set activeIncrementId from persisted state
      - Set answers from persisted questions
      - Set saQuestions from persisted questions (filter by source)
      - Set incrementStatuses from persisted state
      - Set messages from teamChatTranscript
      - Mark hasBootstrapped = true to prevent duplicate bootstrap
  - [x] 6.4 Integrate with existing context state hydration
    - Hydration order: context state -> disk -> workspace API -> bootstrap
    - Add isWorkspaceHydrationComplete flag
    - Only trigger workspace fetch if context state is empty
  - [x] 6.5 Ensure rehydration tests pass
    - Run ONLY the 4 tests written in 6.1

**Acceptance Criteria:**
- The 4 tests written in 6.1 pass
- Workspace loaded on component mount (full page reload)
- Existing context state takes precedence (tab switch optimization)
- Bootstrap skipped when workspace loaded

---

#### Task Group 7: Save Triggers
**Dependencies:** Task Groups 4, 5, 6

- [x] 7.0 Complete persistence triggers
  - [x] 7.1 Write 4 focused tests for save triggers
    - Test 1: Saves workspace after plan generation completes
    - Test 2: Saves workspace when SA questions received
    - Test 3: Saves workspace on increment status transition
    - Test 4: Does NOT save on loading flag changes or transient state changes
  - [x] 7.2 Create usePersistWorkspace custom hook
    - File: `frontend/src/hooks/usePersistWorkspace.ts`
    - Accepts workspace state and persist function
    - Debounces saves (300ms) to prevent rapid-fire API calls
    - Returns trigger function for explicit saves
  - [x] 7.3 Add save triggers to ImplementationAssistantPanel
    - Trigger 1: After generateImplementationPlan success (plannerPayload updated)
    - Trigger 2: When SA questions received (after handleSubmitAnswers)
    - Trigger 3: On increment status transitions (EXECUTING, COMPLETED, FAILED)
    - Trigger 4: When execution artifacts captured
    - Trigger 5: When team chat transcript updated (significant messages only)
  - [x] 7.4 Implement save function
    - Calls mapStateToPersisted to extract persistable state
    - Calls saveImplementWorkspace API
    - Logs errors but does not block UI (fail-soft)
  - [x] 7.5 Ensure trigger tests pass
    - Run ONLY the 4 tests written in 7.1

**Acceptance Criteria:**
- The 4 tests written in 7.1 pass
- Workspace saved at meaningful state changes
- Loading flags do not trigger saves
- Debouncing prevents excessive API calls

---

### Schema Versioning and Validation

#### Task Group 8: Schema Versioning and Migration
**Dependencies:** Task Group 5

- [x] 8.0 Complete schema versioning
  - [x] 8.1 Write 3 focused tests for schema versioning
    - Test 1: Current schema (v1) round-trips correctly
    - Test 2: Missing schemaVersion defaults to 1
    - Test 3: Future version handling logs warning and attempts load
  - [x] 8.2 Define CURRENT_SCHEMA_VERSION constant
    - File: `frontend/src/utils/workspaceSchemaVersion.ts`
    - Export `CURRENT_SCHEMA_VERSION = 1`
    - Export interface VersionedWorkspaceState with schemaVersion field
  - [x] 8.3 Implement schema migration framework
    - Create migrations map: Record<number, MigrationFn>
    - MigrationFn type: (state: unknown) => VersionedWorkspaceState
    - migrateWorkspace function applies migrations sequentially
  - [x] 8.4 Implement v1 schema validator
    - Validates required fields exist
    - Applies defaults for missing optional fields
    - Returns { valid: boolean, errors: string[], migrated: VersionedWorkspaceState }
  - [x] 8.5 Ensure versioning tests pass
    - Run ONLY the 3 tests written in 8.1

**Acceptance Criteria:**
- The 3 tests written in 8.1 pass
- Schema version tracked in persisted data
- Migration framework ready for future versions
- Unknown versions handled gracefully

---

#### Task Group 9: Validation and Error Handling
**Dependencies:** Task Groups 5, 8

- [x] 9.0 Complete validation and error handling
  - [x] 9.1 Write 4 focused tests for validation
    - Test 1: Valid PlannerResponse payload passes validation
    - Test 2: Malformed PlannerResponse is rejected (keeps last-known-good)
    - Test 3: Valid Question array passes validation
    - Test 4: Structurally unreadable JSON fails hard with parse error
  - [x] 9.2 Create validateLLMPayload utility
    - File: `frontend/src/utils/validateLLMPayload.ts`
    - Validates PlannerResponse structure (schemaVersion, required fields)
    - Validates Question structure (id, question, status, source)
    - Returns { valid: boolean, errors: string[] }
  - [x] 9.3 Integrate validation before save
    - In mapStateToPersisted, validate plannerPayload before including
    - If invalid, log warning and exclude (keep previous good state)
    - Never overwrite with invalid data
  - [x] 9.4 Implement fail-soft loading
    - On load: parse JSON, validate structure
    - If parse fails: return empty default, log error
    - If validation fails: apply defaults for bad fields, log warnings
    - If structural corruption: throw and display error in Team Chat
  - [x] 9.5 Ensure validation tests pass
    - Run ONLY the 4 tests written in 9.1

**Acceptance Criteria:**
- The 4 tests written in 9.1 pass
- LLM payloads validated before persistence
- Malformed data does not overwrite good state
- Parse errors fail hard, validation errors fail soft

---

### Testing

#### Task Group 10: Contract Tests
**Dependencies:** Task Groups 1-9

- [x] 10.0 Complete contract validation tests
  - [x] 10.1 Write PlannerResponse contract tests
    - Test 1: Valid PlannerResponse with all required fields
    - Test 2: PlannerResponse with optional implementationPlan
    - Test 3: PlannerResponse with openQuestions array
  - [x] 10.2 Write ImplementerResponse contract tests
    - Test 1: Valid ImplementerResponse with schemaVersion "1.0"
    - Test 2: ImplementerResponse with empty openQuestions (ready state)
    - Test 3: ImplementerResponse with populated openQuestions
  - [x] 10.3 Write Question interface contract tests
    - Test 1: PO Question without incrementId
    - Test 2: SA Question with incrementId
    - Test 3: Question status derivation from answer presence
  - [x] 10.4 Ensure contract tests pass
    - Run contract tests written in 10.1-10.3
    - Verify type safety and interface compliance

**Acceptance Criteria:**
- All contract tests pass
- PlannerResponse and ImplementerResponse schemas validated
- Question interface handles both PO and SA questions

---

#### Task Group 11: Persistence Round-Trip Tests
**Dependencies:** Task Groups 1-9

- [x] 11.0 Complete round-trip persistence tests
  - [x] 11.1 Write frontend round-trip tests
    - Test 1: Save workspace -> Load workspace -> State equality
    - Test 2: Complex state with all fields populated round-trips
    - Test 3: Empty/default state round-trips correctly
  - [x] 11.2 Write backend round-trip tests
    - Test 1: Service save -> get returns identical data
    - Test 2: JSONB serialization preserves nested structures
    - Test 3: Map<String, IncrementArtifacts> serializes correctly
  - [x] 11.3 Ensure round-trip tests pass
    - Run tests written in 11.1-11.2

**Acceptance Criteria:**
- All round-trip tests pass
- Data integrity preserved through save/load cycle
- Complex nested structures serialize correctly

---

#### Task Group 12: Backward Compatibility Tests
**Dependencies:** Task Groups 8, 11

- [x] 12.0 Complete backward compatibility tests
  - [x] 12.1 Create test fixtures for schema versions
    - v1 fixture: Full workspace state snapshot
    - Future: v0 fixture (for when v2 is added)
  - [x] 12.2 Write schema migration tests
    - Test 1: Load v1 schema with current loader
    - Test 2: Missing fields in v1 default correctly
    - Test 3: Extra unknown fields are ignored with warning
  - [x] 12.3 Ensure backward compatibility tests pass
    - Run tests written in 12.2

**Acceptance Criteria:**
- All backward compatibility tests pass
- Older schemas load and migrate correctly
- Unknown fields handled gracefully

---

#### Task Group 13: Integration Tests
**Dependencies:** All previous groups

- [x] 13.0 Complete E2E integration tests
  - [x] 13.1 Write resume-after-reload E2E flow test
    - Setup: Create workspace with plan and questions
    - Action: Simulate page reload (unmount/remount)
    - Verify: State restored from backend
  - [x] 13.2 Write tab-switch optimization test
    - Setup: Create workspace, switch tabs
    - Action: Return to Implement tab
    - Verify: Context state used (no API call)
  - [x] 13.3 Run full feature test suite
    - Run all tests from Task Groups 1-12
    - Verify no regressions

**Acceptance Criteria:**
- Resume-after-reload flow works end-to-end
- Tab-switch uses context state (performance optimization)
- All feature tests pass

---

## Execution Order

Recommended implementation sequence:

1. **Backend Database Layer** (Task Group 1)
   - Entity, migration, repository

2. **Backend Service Layer** (Task Group 2)
   - DTO, service with get/save methods

3. **Backend Controller Layer** (Task Group 3)
   - REST endpoints for GET/PUT

4. **Frontend API Layer** (Task Group 4)
   - API functions for fetch/save

5. **Frontend State Mapping** (Task Group 5)
   - Map component state to/from persisted format

6. **Frontend Rehydration** (Task Group 6)
   - Load workspace on mount, apply to state

7. **Frontend Save Triggers** (Task Group 7)
   - Persist on meaningful state changes

8. **Schema Versioning** (Task Group 8)
   - Version field and migration framework

9. **Validation** (Task Group 9)
   - Validate LLM payloads, fail-soft loading

10. **Contract Tests** (Task Group 10)
    - PlannerResponse, ImplementerResponse validation

11. **Round-Trip Tests** (Task Group 11)
    - Save -> load equality verification

12. **Backward Compatibility Tests** (Task Group 12)
    - Schema migration verification

13. **Integration Tests** (Task Group 13)
    - E2E flows and regression testing

---

## Reference Files

**Backend Patterns:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/WorkItemImplementContextEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/WorkItemImplementContextService.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/controller/WorkItemImplementContextController.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/WorkItemImplementContextRepository.java`

**Frontend Patterns:**
- `frontend/src/api/chatApi.ts` - Type definitions for PlannerResponse, Question, etc.
- `frontend/src/contexts/ProductUiStateContext.tsx` - State persistence patterns, equality guards
- `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` - Component state structure

**Test Patterns:**
- `architecture-model-service/src/test/java/com/example/architecturemodel/service/WorkItemImplementContextServiceTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/controller/WorkItemImplementContextControllerTest.java`
