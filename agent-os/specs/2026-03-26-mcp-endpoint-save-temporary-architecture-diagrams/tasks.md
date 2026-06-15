# Task Breakdown: MCP Endpoint for Saving Temporary Architecture Diagrams (Increment 3)

## Overview
Total Tasks: 30
Layers: Architecture Model Service (Java/Spring Boot), MCP Server (TypeScript/Express), Gateway (verify only)

This is a bottom-up, three-layer implementation. The database schema must exist before the Java persistence layer, the Java backend must exist before the MCP server can call it, and the MCP server route/service must exist before the gateway can invoke it. Gateway wiring was completed in Increment 2, so only compatibility verification is needed.

## Task List

### Database and Java Persistence Layer (Architecture Model Service)

#### Task Group 1: Liquibase Migration and JPA Entity
**Dependencies:** None

- [x] 1.0 Complete database migration and JPA entity
  - [x] 1.1 Write 4 focused tests for the TemporaryDiagram persistence layer
    - Test 1: `TemporaryDiagramEntity` can be built via Lombok `@Builder` with all required fields (id, projectId, temporaryDiagramId, diagramPayload, createdAt, updatedAt)
    - Test 2: `TemporaryDiagramRepository.findByProjectIdAndTemporaryDiagramId` returns the entity when it exists
    - Test 3: `TemporaryDiagramRepository.findByProjectIdAndTemporaryDiagramId` returns empty Optional when no match
    - Test 4: Saving an entity with the same `(projectId, temporaryDiagramId)` composite key updates (not duplicates) the record
    - Place tests in `architecture-model-service/src/test/java/com/example/architecturemodel/repository/TemporaryDiagramRepositoryTest.java`
  - [x] 1.2 Create Liquibase migration SQL file `054-temporary-diagrams.sql`
    - File: `architecture-model-service/src/main/resources/db/changelog/sql/054-temporary-diagrams.sql`
    - `CREATE TABLE IF NOT EXISTS temporary_diagrams` with columns:
      - `id` UUID PRIMARY KEY
      - `project_id` UUID NOT NULL, FK to `project(id)` ON DELETE CASCADE
      - `temporary_diagram_id` TEXT NOT NULL
      - `diagram_payload` JSONB NOT NULL
      - `created_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
      - `updated_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
    - `CREATE UNIQUE INDEX IF NOT EXISTS idx_temp_diagram_project_diagram_id ON temporary_diagrams (project_id, temporary_diagram_id)` for upsert support
    - `CREATE INDEX IF NOT EXISTS idx_temp_diagram_project_id ON temporary_diagrams (project_id)` for project-level queries
    - Add `COMMENT ON TABLE` and `COMMENT ON COLUMN` documentation
    - Follow the exact pattern from `034-work-item-implement-workspace.sql`
  - [x] 1.3 Register migration in `db.changelog-master.yaml`
    - Add changeset `054-temporary-diagrams` to end of `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
    - Use `tableExists` precondition guard with `onFail: MARK_RAN` and `onError: HALT`
    - Reference SQL file path: `db/changelog/sql/054-temporary-diagrams.sql`
    - Follow the exact YAML structure of changeset `034-work-item-implement-workspace`
  - [x] 1.4 Create `TemporaryDiagramEntity.java`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/TemporaryDiagramEntity.java`
    - Follow `WorkItemImplementWorkspaceEntity.java` pattern exactly
    - JPA `@Entity`, `@Table(name = "temporary_diagrams")` with indexes matching the SQL migration
    - Lombok annotations: `@Getter`, `@Setter`, `@NoArgsConstructor`, `@AllArgsConstructor`, `@Builder`
    - Fields: `id` (UUID, `@Id`), `projectId` (UUID, `@Column(name = "project_id")`), `temporaryDiagramId` (String, `@Column(name = "temporary_diagram_id")`), `diagramPayload` (Map<String, Object> with `@Type(JsonType.class)` and `columnDefinition = "jsonb"`), `createdAt` (Instant), `updatedAt` (Instant)
    - Include `@PrePersist` and `@PreUpdate` lifecycle callbacks for timestamps
    - Use `@Builder.Default` for `diagramPayload = new HashMap<>()`, `createdAt = Instant.now()`, `updatedAt = Instant.now()`
  - [x] 1.5 Create `TemporaryDiagramRepository.java`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/TemporaryDiagramRepository.java`
    - `@Repository` interface extending `JpaRepository<TemporaryDiagramEntity, UUID>`
    - Finder method: `Optional<TemporaryDiagramEntity> findByProjectIdAndTemporaryDiagramId(UUID projectId, String temporaryDiagramId)`
    - Follow the exact pattern from `WorkItemImplementWorkspaceRepository.java`
  - [x] 1.6 Ensure persistence layer tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify the entity builds correctly and repository queries work
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- Migration SQL creates the `temporary_diagrams` table with correct columns, indexes, and FK constraint
- Changeset registered in `db.changelog-master.yaml` with precondition guard
- `TemporaryDiagramEntity` maps all fields with correct JPA/Hibernate annotations
- `TemporaryDiagramRepository` provides composite key finder method

---

#### Task Group 2: Java Service, DTO, and Controller
**Dependencies:** Task Group 1

- [x] 2.0 Complete Java service layer and REST controller
  - [x] 2.1 Write 6 focused tests for the Java service and controller
    - Test 1: `TemporaryDiagramService.saveDiagram` creates a new entity when none exists for the given (projectId, temporaryDiagramId)
    - Test 2: `TemporaryDiagramService.saveDiagram` updates the existing entity (upsert) when one already exists for the same composite key
    - Test 3: `TemporaryDiagramService.getDiagram` returns DTO when entity exists
    - Test 4: `TemporaryDiagramService.getDiagram` returns null when no entity exists
    - Test 5: `TemporaryDiagramController` PUT endpoint returns 200 with DTO on success
    - Test 6: `TemporaryDiagramController` GET endpoint returns 404 when diagram not found
    - Place service tests in `architecture-model-service/src/test/java/com/example/architecturemodel/service/TemporaryDiagramServiceTest.java`
    - Place controller tests in `architecture-model-service/src/test/java/com/example/architecturemodel/controller/TemporaryDiagramControllerTest.java`
  - [x] 2.2 Create `TemporaryDiagramDto.java`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/TemporaryDiagramDto.java`
    - Java record with `@JsonProperty` annotations for snake_case serialization
    - Fields: `id` (UUID, maps to internal DB id), `temporaryDiagramId` (String, `@JsonProperty("temporary_diagram_id")`), `projectId` (UUID, `@JsonProperty("project_id")`), `diagramPayload` (Map<String,Object>, `@JsonProperty("diagram_payload")`), `createdAt` (String, ISO-8601, `@JsonProperty("created_at")`), `updatedAt` (String, ISO-8601, `@JsonProperty("updated_at")`)
  - [x] 2.3 Create `TemporaryDiagramService.java`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/TemporaryDiagramService.java`
    - Annotations: `@Service`, `@ConditionalOnProperty(name = "app.features.include-database", havingValue = "true", matchIfMissing = true)`, `@RequiredArgsConstructor`, `@Slf4j`
    - Inject `TemporaryDiagramRepository`
    - `saveDiagram(UUID projectId, String temporaryDiagramId, Map<String,Object> diagramPayload)`:
      - Find existing by `(projectId, temporaryDiagramId)` using repository finder
      - If not found, create new entity with `UUID.randomUUID()` as id
      - Set `diagramPayload` on entity
      - Save and return `TemporaryDiagramDto` (convert via private `toDto` method)
      - Annotate with `@Transactional`
    - `getDiagram(UUID projectId, String temporaryDiagramId)`:
      - Find by composite key, return DTO or null
      - Annotate with `@Transactional(readOnly = true)`
    - Private `toDto(TemporaryDiagramEntity entity)` method converting entity to DTO with ISO-8601 timestamp strings
    - Follow the exact upsert pattern from `WorkItemImplementWorkspaceService.java`
  - [x] 2.4 Create `TemporaryDiagramController.java`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/TemporaryDiagramController.java`
    - Annotations: `@RestController`, `@ConditionalOnProperty`, `@RequestMapping("/api/projects/{projectId}/temporary-diagrams")`, `@RequiredArgsConstructor`, `@Slf4j`
    - Inject `TemporaryDiagramService`
    - PUT `/{temporaryDiagramId}`:
      - Accepts `SaveTemporaryDiagramRequest` record body (inner record with `@JsonProperty("diagram_payload") Map<String, Object> diagramPayload`)
      - Delegates to `service.saveDiagram(projectId, temporaryDiagramId, request.diagramPayload())`
      - Returns `ResponseEntity.ok(dto)`
    - GET `/{temporaryDiagramId}`:
      - Delegates to `service.getDiagram(projectId, temporaryDiagramId)`
      - Returns `ResponseEntity.ok(dto)` if found, `ResponseEntity.notFound().build()` if null
    - Define `SaveTemporaryDiagramRequest` as inner record
    - Follow the exact pattern from `WorkItemImplementWorkspaceController.java`
  - [x] 2.5 Ensure Java service and controller tests pass
    - Run ONLY the 6 tests written in 2.1
    - Verify upsert, retrieval, and HTTP status code behavior
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6 tests written in 2.1 pass
- DTO serializes with snake_case JSON property names and ISO-8601 timestamps
- Service implements find-or-create upsert by `(projectId, temporaryDiagramId)`
- PUT endpoint returns 200 with DTO
- GET endpoint returns 200 with DTO or 404 when not found
- All classes use `@ConditionalOnProperty` consistent with the existing pattern

---

### MCP Server Layer (TypeScript/Express)

#### Task Group 3: Types, Validator, and archModelClient Extension
**Dependencies:** Task Group 2 (Java endpoints must exist for archModelClient to call)

- [x] 3.0 Complete MCP server types, validator, and client methods
  - [x] 3.1 Write 8 focused tests for the validator and archModelClient methods
    - Test 1: Validator returns empty array for a fully valid LOGICAL ER diagram payload
    - Test 2: Validator returns errors for missing required top-level fields (id, name, diagram_kind, etc.)
    - Test 3: Validator returns errors for incorrect ER-specific values (diagram_kind != "ER", source_architecture_domain != "DATA", invalid view_mode)
    - Test 4: Validator returns errors for semantic type inconsistency (LOGICAL view_mode with PHYSICAL_DATA_ENTITY node semantic_type)
    - Test 5: Validator returns errors for duplicate node IDs
    - Test 6: Validator returns errors for edge referencing non-existent node IDs
    - Test 7: Validator returns errors for edge_points with fewer than 2 points or non-contiguous sequence_order
    - Test 8: Validator returns errors for duplicate attribute ref_name within a single node
    - Place tests in `mcp-server/src/__tests__/temporaryArchitectureDiagramValidator.test.ts`
  - [x] 3.2 Create types file `saveTemporaryArchitectureDiagram.ts`
    - File: `mcp-server/src/types/saveTemporaryArchitectureDiagram.ts`
    - Define `SaveTemporaryArchitectureDiagramRequest` interface: `{ sessionId: string, projectId: string, diagramJson: string }`
    - Define `SaveTemporaryArchitectureDiagramResult` interface: `{ id: string, status: "saved", createdAt: string }`
    - Follow the exact pattern from `saveBacklogItems.ts`
  - [x] 3.3 Create validator `temporaryArchitectureDiagramValidator.ts`
    - File: `mcp-server/src/services/temporaryArchitectureDiagramValidator.ts`
    - Export single function: `validateTemporaryArchitectureDiagram(parsed: unknown): string[]`
    - Returns array of error message strings; empty array means valid
    - Implement all validation rules as a standalone validator (do NOT import from frontend):
      - **Structural checks**: required fields `id` (string), `name` (string), `diagram_kind` (string), `source_architecture_domain` (string), `view_mode` (string), `version` (number), `nodes` (array), `edges` (array)
      - **ER-specific checks**: `diagram_kind` must be `"ER"`, `source_architecture_domain` must be `"DATA"`, `view_mode` must be `"LOGICAL"` or `"PHYSICAL"`
      - **Node validation**: unique IDs across nodes, non-empty `ref_name`, `pos_x`/`pos_y`/`width`/`height` must be present numbers, at most one `ATTRIBUTES` compartment per node
      - **Compartment item validation**: non-empty `ref_name`, no duplicate attribute `ref_name` within a node
      - **Semantic type consistency**: node `semantic_type` must match `view_mode` (LOGICAL -> `LOGICAL_DATA_ENTITY`, PHYSICAL -> `PHYSICAL_DATA_ENTITY`); compartment item `semantic_type` must match (LOGICAL -> `LOGICAL_DATA_ATTRIBUTE`, PHYSICAL -> `PHYSICAL_DATA_ATTRIBUTE`)
      - **Edge validation**: unique IDs across edges, `source_node_id` and `target_node_id` must reference existing node IDs, `source_ref_name` and `target_ref_name` must match the `ref_name` of the referenced source/target node, `edge_points` must contain at least 2 points, `edge_points[].sequence_order` must be contiguous integers starting from 0
      - **Group validation** (if `groups` array present): all `child_node_ids` must reference existing node IDs
    - Align semantics with `frontend/src/types/temporaryArchitectureDiagramValidation.ts` but implemented independently
  - [x] 3.4 Add two new methods to `archModelClient.ts`
    - File: `mcp-server/src/services/archModelClient.ts`
    - Method 1: `saveTemporaryDiagram(projectId: string, temporaryDiagramId: string, diagramPayload: object): Promise<{ id: string, temporary_diagram_id: string, diagram_payload: object, created_at: string, updated_at: string }>`
      - Calls `this.client.put(`/api/projects/${encodeURIComponent(projectId)}/temporary-diagrams/${encodeURIComponent(temporaryDiagramId)}`, { diagram_payload: diagramPayload })`
      - Returns `response.data`
    - Method 2: `getTemporaryDiagram(projectId: string, temporaryDiagramId: string): Promise<{ id: string, temporary_diagram_id: string, diagram_payload: object, created_at: string, updated_at: string } | null>`
      - Calls `this.client.get(`/api/projects/${encodeURIComponent(projectId)}/temporary-diagrams/${encodeURIComponent(temporaryDiagramId)}`)`
      - Returns `response.data`, or `null` on 404 (catch AxiosError, check `response?.status === 404`)
      - Follow the null-on-404 pattern from `getModel()`
  - [x] 3.5 Ensure validator tests pass
    - Run ONLY the 8 tests written in 3.1
    - Verify all validation rules produce correct error messages
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 8 tests written in 3.1 pass
- Types define clean request/response interfaces with correct field types
- Validator catches all structural, ER-specific, semantic, node, edge, and group validation errors
- Validator returns accumulated error messages (not just the first error)
- archModelClient methods use correct HTTP verbs (PUT for save, GET for retrieve) and URL patterns
- archModelClient `getTemporaryDiagram` returns null on 404

---

#### Task Group 4: MCP Service and Route
**Dependencies:** Task Group 3

- [x] 4.0 Complete MCP service and route with mounting
  - [x] 4.1 Write 6 focused tests for the MCP service and route
    - Test 1: Service `saveTemporaryArchitectureDiagram` returns `{ id, status: "saved", createdAt }` for a valid request
    - Test 2: Service throws 400 when `diagramJson` is not valid JSON
    - Test 3: Service throws 400 when parsed diagram fails validation (e.g., missing required fields)
    - Test 4: Route handler returns 400 when `sessionId` is missing or empty
    - Test 5: Route handler returns 400 when `projectId` is not a valid UUID
    - Test 6: Route handler returns 502 when upstream `archModelClient` call fails
    - Place service tests in `mcp-server/src/__tests__/temporaryArchitectureDiagramService.test.ts`
    - Place route tests in `mcp-server/src/__tests__/saveTemporaryArchitectureDiagramRoute.test.ts`
    - Follow the `jest.mock` pattern from `saveArchitectureBaselineRoute.test.ts`
  - [x] 4.2 Create service `temporaryArchitectureDiagramService.ts`
    - File: `mcp-server/src/services/temporaryArchitectureDiagramService.ts`
    - Export main function: `saveTemporaryArchitectureDiagram(projectId: string, diagramJson: string): Promise<SaveTemporaryArchitectureDiagramResult>`
    - Implementation steps:
      1. Parse `diagramJson` via `JSON.parse`; throw `createHttpError(400, ...)` on invalid JSON
      2. Validate payload size: `Buffer.byteLength(diagramJson, 'utf8') > 500 * 1024` throws 400
      3. Call `validateTemporaryArchitectureDiagram(parsed)`; if errors non-empty, throw `createHttpError(400, errors.join('; '))`
      4. Call `archModelClient.getProjectById(projectId)` to validate project exists; let AxiosError propagate (error handler maps to 502)
      5. Call `archModelClient.saveTemporaryDiagram(projectId, parsed.id, parsed)` to persist
      6. Return `{ id: parsed.id, status: "saved", createdAt: backendResponse.created_at }`
    - Follow the parse-validate-persist pattern from `backlogItemsService.ts`
  - [x] 4.3 Create route `saveTemporaryArchitectureDiagramRoute.ts`
    - File: `mcp-server/src/routes/saveTemporaryArchitectureDiagramRoute.ts`
    - Export `saveTemporaryArchitectureDiagramRouter` as Express Router
    - POST `/` handler:
      1. Destructure `{ sessionId, projectId, diagramJson }` from `req.body`
      2. Validate `sessionId` (required, non-empty string); throw `createHttpError(400, ...)` if invalid
      3. Validate `projectId` (required, UUID v4 regex); throw `createHttpError(400, ...)` if invalid
      4. Validate `diagramJson` (required, non-empty string); throw `createHttpError(400, ...)` if invalid
      5. Call `getOrCreateSession(sessionId)`
      6. Delegate to `saveTemporaryArchitectureDiagram(projectId, diagramJson)`
      7. Return `res.json(response)` with 200
    - Error handling: catch 400 errors (return 400 JSON), catch 502 errors (return 502 JSON), pass others to `next(error)`
    - Follow the exact pattern from `saveBacklogItemsRoute.ts`
  - [x] 4.4 Mount route in `tools.ts`
    - File: `mcp-server/src/routes/tools.ts`
    - Import `saveTemporaryArchitectureDiagramRouter` from `./saveTemporaryArchitectureDiagramRoute`
    - Add mount line: `toolsRouter.use('/saveTemporaryArchitectureDiagram', saveTemporaryArchitectureDiagramRouter);`
    - Place after the existing `save_backlog_items` mount
  - [x] 4.5 Ensure MCP service and route tests pass
    - Run ONLY the 6 tests written in 4.1
    - Verify service orchestration (parse, validate, persist, return)
    - Verify route validation (sessionId, projectId, diagramJson) and error status codes
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6 tests written in 4.1 pass
- Service follows parse-validate-persist pattern with proper error handling
- Service validates payload size (500KB limit) before parsing
- Route validates all three request fields before delegating to service
- Route is mounted at `/saveTemporaryArchitectureDiagram` in `tools.ts`
- 400 responses include descriptive error messages
- 502 responses handle upstream failures gracefully

---

### Gateway Compatibility Verification

#### Task Group 5: Gateway Integration Verification
**Dependencies:** Task Groups 1-4

- [x] 5.0 Verify gateway compatibility with the new MCP endpoint
  - [x] 5.1 Verify tool registration in gateway
    - Confirm `saveTemporaryArchitectureDiagram` is already registered in `gateway/src/types/tools.ts` (Increment 2)
    - Confirm endpoint mapping `/mcp/tools/saveTemporaryArchitectureDiagram` exists in `gateway/src/services/toolExecutor.ts` (Increment 2)
    - Confirm `SaveTemporaryArchitectureDiagramParams` type includes `projectId` and `diagramJson` fields
    - No code changes needed -- read-only verification
  - [x] 5.2 Verify MCP server mount path matches gateway expectation
    - The gateway calls `POST /mcp/tools/saveTemporaryArchitectureDiagram`
    - The MCP server mounts the route at `toolsRouter.use('/saveTemporaryArchitectureDiagram', ...)`
    - The MCP server mounts `toolsRouter` at `/mcp/tools` (verify in `mcp-server/src/index.ts`)
    - Resulting full path: `/mcp/tools/saveTemporaryArchitectureDiagram` -- must match gateway expectation

**Acceptance Criteria:**
- Gateway tool registration confirmed (no changes needed)
- MCP mount path `/mcp/tools/saveTemporaryArchitectureDiagram` matches gateway endpoint mapping
- Full request flow Gateway -> MCP Server -> Architecture Model Service is wired correctly

---

### Test Review and Gap Analysis

#### Task Group 6: Test Review and Critical Gap Analysis
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical gaps only
  - [x] 6.1 Review tests from Task Groups 1-4
    - Review the 4 repository tests from Task Group 1 (1.1)
    - Review the 6 service/controller tests from Task Group 2 (2.1)
    - Review the 8 validator tests from Task Group 3 (3.1)
    - Review the 6 service/route tests from Task Group 4 (4.1)
    - Total existing tests: 24 tests
  - [x] 6.2 Analyze test coverage gaps for this feature only
    - Identify critical end-to-end workflows that lack test coverage
    - Focus ONLY on gaps related to this spec's feature requirements
    - Likely gap areas:
      - archModelClient method integration (mock axios calls for saveTemporaryDiagram/getTemporaryDiagram)
      - Payload size limit enforcement (500KB boundary)
      - Upsert semantics end-to-end (save twice with same key, verify update not duplicate)
      - GET retrieval via MCP service layer (if only the Java GET was tested but not MCP-level retrieval)
      - Edge case: valid PHYSICAL view_mode diagram (if only LOGICAL was tested)
    - Do NOT assess entire application test coverage
  - [x] 6.3 Write up to 10 additional strategic tests maximum
    - Fill identified critical gaps with focused tests
    - Prioritize integration points and end-to-end workflows
    - Candidate tests (select from based on gap analysis):
      - archModelClient `saveTemporaryDiagram` calls PUT with correct URL and body
      - archModelClient `getTemporaryDiagram` returns null on 404
      - Service rejects diagramJson exceeding 500KB
      - Validator accepts valid PHYSICAL ER diagram (if not already covered)
      - Validator rejects edge with source_ref_name not matching source node's ref_name
      - Validator rejects node with more than one ATTRIBUTES compartment
      - Route handler returns 400 when diagramJson is empty string
      - Full save flow: valid request through route -> service -> validator -> archModelClient mock
    - Do NOT write comprehensive coverage for all scenarios
  - [x] 6.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature:
      - `TemporaryDiagramRepositoryTest.java` (4 tests)
      - `TemporaryDiagramServiceTest.java` + `TemporaryDiagramControllerTest.java` (6 tests)
      - `temporaryArchitectureDiagramValidator.test.ts` (8 tests)
      - `temporaryArchitectureDiagramService.test.ts` + `saveTemporaryArchitectureDiagramRoute.test.ts` (6 tests)
      - Gap-fill tests from 6.3 (up to 10 tests)
    - Expected total: approximately 24-34 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 24-34 tests total)
- Critical user workflows for this feature are covered:
  - Valid diagram save and retrieval (both layers)
  - Validation rejects invalid payloads with descriptive errors
  - Upsert semantics work correctly
  - Error handling returns correct HTTP status codes (400, 404, 502)
  - Payload size limit enforced
- No more than 10 additional tests added when filling gaps
- Testing focused exclusively on this spec's feature requirements

## Execution Order

Recommended implementation sequence:

1. **Task Group 1** -- Liquibase Migration and JPA Entity (database foundation)
2. **Task Group 2** -- Java Service, DTO, and Controller (Java REST endpoints)
3. **Task Group 3** -- MCP Types, Validator, and archModelClient Extension (TypeScript foundation)
4. **Task Group 4** -- MCP Service and Route (TypeScript orchestration layer)
5. **Task Group 5** -- Gateway Compatibility Verification (read-only check)
6. **Task Group 6** -- Test Review and Critical Gap Analysis (final validation)

## Key Reference Files

| Reference | Path |
|-----------|------|
| Migration pattern | `architecture-model-service/src/main/resources/db/changelog/sql/034-work-item-implement-workspace.sql` |
| Changelog | `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` |
| Entity pattern | `architecture-model-service/.../entity/WorkItemImplementWorkspaceEntity.java` |
| Repository pattern | `architecture-model-service/.../repository/entity/WorkItemImplementWorkspaceRepository.java` |
| Service pattern | `architecture-model-service/.../service/WorkItemImplementWorkspaceService.java` |
| Controller pattern | `architecture-model-service/.../controller/WorkItemImplementWorkspaceController.java` |
| Route pattern | `mcp-server/src/routes/saveBacklogItemsRoute.ts` |
| Service pattern (TS) | `mcp-server/src/services/backlogItemsService.ts` |
| Types pattern | `mcp-server/src/types/saveBacklogItems.ts` |
| Client pattern | `mcp-server/src/services/archModelClient.ts` |
| Route mount | `mcp-server/src/routes/tools.ts` |
| Test pattern | `mcp-server/src/__tests__/saveArchitectureBaselineRoute.test.ts` |
| Validation semantics | `frontend/src/types/temporaryArchitectureDiagramValidation.ts` |
| Contract interfaces | `frontend/src/types/temporaryArchitectureDiagram.ts` |
| Gateway tool types | `gateway/src/types/tools.ts` |
| Gateway tool executor | `gateway/src/services/toolExecutor.ts` |
