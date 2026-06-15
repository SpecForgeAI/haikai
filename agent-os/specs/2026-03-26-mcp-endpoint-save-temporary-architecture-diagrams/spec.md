# Specification: MCP Endpoint for Saving Temporary Architecture Diagrams (Increment 3)

## Goal
Implement the save and retrieve endpoints for temporary architecture diagrams across three layers: mcp-server (TypeScript validation and orchestration), architecture-model-service (Java/Spring Boot persistence), and PostgreSQL (JSONB table via Liquibase migration), enabling the Architect task to persist LLM-generated diagram payloads durably with upsert semantics.

## User Stories
- As an Architect task (LLM agent), I want to save a TemporaryArchitectureDiagram payload via the MCP tool so that the diagram is durably persisted and retrievable for future rendering and conversion.
- As a future frontend consumer, I want to retrieve a saved temporary diagram by project ID and diagram ID so that I can render it in the UI.

## Specific Requirements

**MCP Route: saveTemporaryArchitectureDiagramRoute.ts**
- Create `mcp-server/src/routes/saveTemporaryArchitectureDiagramRoute.ts` as an Express Router (mirrors `saveBacklogItemsRoute.ts` pattern)
- POST handler accepts `{ sessionId, projectId, diagramJson }` from request body
- Validate sessionId (required, non-empty string), projectId (required, UUID v4 regex), diagramJson (required, non-empty string, max 500KB byte length)
- Call `getOrCreateSession(sessionId)` for session management
- Delegate to service function; return 200 with `{ id, status: "saved", createdAt }` on success
- Catch and return 400 for validation errors (statusCode 400), 502 for upstream failures (statusCode 502), pass others to `next(error)`
- Mount in `mcp-server/src/routes/tools.ts` at path `/saveTemporaryArchitectureDiagram`

**MCP Types: saveTemporaryArchitectureDiagram.ts**
- Create `mcp-server/src/types/saveTemporaryArchitectureDiagram.ts` following the `saveBacklogItems.ts` pattern
- Define `SaveTemporaryArchitectureDiagramRequest` interface: `{ sessionId: string, projectId: string, diagramJson: string }`
- Define `SaveTemporaryArchitectureDiagramResult` interface: `{ id: string, status: "saved", createdAt: string }`
- The `id` in the result is the client/LLM-provided `TemporaryArchitectureDiagram.id`, not a server-generated ID

**MCP Validator: temporaryArchitectureDiagramValidator.ts**
- Create `mcp-server/src/services/temporaryArchitectureDiagramValidator.ts` as a standalone comprehensive validator
- Align validation semantics with Increment 1 (`frontend/src/types/temporaryArchitectureDiagramValidation.ts`) but do NOT import from frontend; implement independently
- Return an array of error message strings (empty = valid); the calling service throws a single 400 error with all messages joined
- Structural check: required fields `id` (string), `name` (string), `diagram_kind` (string), `source_architecture_domain` (string), `view_mode` (string), `version` (number), `nodes` (array), `edges` (array)
- ER-specific checks: `diagram_kind` must be `"ER"`, `source_architecture_domain` must be `"DATA"`, `view_mode` must be `"LOGICAL"` or `"PHYSICAL"`
- Semantic type consistency: node `semantic_type` must match `view_mode` (LOGICAL -> `LOGICAL_DATA_ENTITY`, PHYSICAL -> `PHYSICAL_DATA_ENTITY`); compartment item `semantic_type` must match similarly (LOGICAL -> `LOGICAL_DATA_ATTRIBUTE`, PHYSICAL -> `PHYSICAL_DATA_ATTRIBUTE`)
- Node validation: unique IDs across nodes, non-empty `ref_name`, `pos_x`/`pos_y`/`width`/`height` must be present numbers; at most one `ATTRIBUTES` compartment per node; no duplicate attribute `ref_name` within a node; compartment item `ref_name` must be non-empty string

**MCP Validator: continued validation rules**
- Edge validation: unique IDs across edges, `source_node_id` and `target_node_id` must reference existing node IDs, `source_ref_name` and `target_ref_name` must match the `ref_name` of the referenced source/target node respectively, `edge_points` must contain at least 2 points, `edge_points[].sequence_order` must be contiguous integers starting from 0
- Group validation (if `groups` array present): all `child_node_ids` must reference existing node IDs
- General rules: no fields named with architecture ID patterns (this is advisory, not enforced by regex), all `ref_name` and `display_name` fields must be non-empty strings where required by the contract
- Export a single function `validateTemporaryArchitectureDiagram(parsed: unknown): string[]` that runs all checks and accumulates all error messages

**MCP Service: temporaryArchitectureDiagramService.ts**
- Create `mcp-server/src/services/temporaryArchitectureDiagramService.ts` following the `backlogItemsService.ts` parse-validate-persist pattern
- Export main function `saveTemporaryArchitectureDiagram(projectId: string, diagramJson: string): Promise<SaveTemporaryArchitectureDiagramResult>`
- Parse `diagramJson` via `JSON.parse`; throw 400 on invalid JSON
- Call the validator; throw 400 with joined messages if any errors
- Call `archModelClient.getProjectById(projectId)` to validate project existence; let AxiosError propagate (error handler maps to 502)
- Call new `archModelClient.saveTemporaryDiagram(projectId, diagramId, parsedPayload)` to persist via architecture-model-service
- Return `{ id: parsed.id, status: "saved", createdAt }` where `createdAt` comes from the backend response

**archModelClient Extension**
- Add two new methods to the `ArchModelClient` class in `mcp-server/src/services/archModelClient.ts`
- `saveTemporaryDiagram(projectId: string, temporaryDiagramId: string, diagramPayload: object): Promise<{ id: string, temporary_diagram_id: string, created_at: string, updated_at: string }>` -- calls PUT to architecture-model-service endpoint
- `getTemporaryDiagram(projectId: string, temporaryDiagramId: string): Promise<{ id: string, temporary_diagram_id: string, diagram_payload: object, created_at: string, updated_at: string } | null>` -- calls GET, returns null on 404
- Use existing axios instance patterns (`this.client.put(...)`, `this.client.get(...)`) with `encodeURIComponent` on path params

**PostgreSQL Table: Liquibase Migration 054**
- Create `architecture-model-service/src/main/resources/db/changelog/sql/054-temporary-diagrams.sql`
- Table `temporary_diagrams` with columns: `id` (UUID PRIMARY KEY), `project_id` (UUID NOT NULL, FK to `project(id)` ON DELETE CASCADE), `temporary_diagram_id` (TEXT NOT NULL), `diagram_payload` (JSONB NOT NULL), `created_at` (TIMESTAMPTZ NOT NULL DEFAULT NOW()), `updated_at` (TIMESTAMPTZ NOT NULL DEFAULT NOW())
- Unique composite index on `(project_id, temporary_diagram_id)` for upsert support
- Index on `project_id` for efficient project-level queries
- Add changeset entry `054-temporary-diagrams` to `db.changelog-master.yaml` with `tableExists` precondition guard, following the exact pattern of changeset `034-work-item-implement-workspace`

**Java Entity: TemporaryDiagramEntity.java**
- Create in `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/TemporaryDiagramEntity.java`
- Follow `WorkItemImplementWorkspaceEntity.java` pattern exactly: JPA `@Entity`, `@Table` with indexes, Lombok annotations (`@Getter`, `@Setter`, `@NoArgsConstructor`, `@AllArgsConstructor`, `@Builder`)
- Fields: `id` (UUID, `@Id`), `projectId` (UUID, NOT NULL), `temporaryDiagramId` (String, NOT NULL), `diagramPayload` (`Map<String, Object>` with `@Type(JsonType.class)` and `columnDefinition = "jsonb"`), `createdAt` (Instant), `updatedAt` (Instant)
- Include `@PrePersist` and `@PreUpdate` lifecycle callbacks for timestamps

**Java Repository: TemporaryDiagramRepository.java**
- Create in `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/TemporaryDiagramRepository.java`
- Extend `JpaRepository<TemporaryDiagramEntity, UUID>`
- Finder method: `Optional<TemporaryDiagramEntity> findByProjectIdAndTemporaryDiagramId(UUID projectId, String temporaryDiagramId)`

**Java Service: TemporaryDiagramService.java**
- Create in `architecture-model-service/src/main/java/com/example/architecturemodel/service/TemporaryDiagramService.java`
- Follow `WorkItemImplementWorkspaceService.java` pattern: `@Service`, `@ConditionalOnProperty`, `@RequiredArgsConstructor`, `@Slf4j`
- `saveDiagram(UUID projectId, String temporaryDiagramId, Map<String,Object> diagramPayload)` -- upsert: find by `(projectId, temporaryDiagramId)`, create new or update existing, save, return DTO
- `getDiagram(UUID projectId, String temporaryDiagramId)` -- find by composite key, return DTO or null (caller handles 404)

**Java Controller: TemporaryDiagramController.java**
- Create in `architecture-model-service/src/main/java/com/example/architecturemodel/controller/TemporaryDiagramController.java`
- Follow `WorkItemImplementWorkspaceController.java` pattern: `@RestController`, `@ConditionalOnProperty`, `@RequestMapping`, `@RequiredArgsConstructor`, `@Slf4j`
- Base path: `/api/projects/{projectId}/temporary-diagrams`
- PUT `/{temporaryDiagramId}` -- accepts `SaveTemporaryDiagramRequest` record with `diagram_payload` (`Map<String, Object>`), delegates to service, returns 200 with DTO
- GET `/{temporaryDiagramId}` -- delegates to service, returns 200 with DTO or 404 if not found
- Define `SaveTemporaryDiagramRequest` as an inner record: `record SaveTemporaryDiagramRequest(@JsonProperty("diagram_payload") Map<String, Object> diagramPayload) {}`

**Java DTO: TemporaryDiagramDto.java**
- Create in `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/TemporaryDiagramDto.java`
- Java record with `@JsonProperty` annotations for snake_case serialization
- Fields: `projectId`, `temporaryDiagramId`, `diagramPayload` (Map<String,Object>), `createdAt` (String, ISO-8601), `updatedAt` (String, ISO-8601)

## Existing Code to Leverage

**saveBacklogItemsRoute.ts + backlogItemsService.ts (MCP route/service pattern)**
- Route pattern at `mcp-server/src/routes/saveBacklogItemsRoute.ts`: Express Router, sessionId/projectId/JSON-string validation, `getOrCreateSession`, delegate to service, error handling with 400/502 status checks
- Service pattern at `mcp-server/src/services/backlogItemsService.ts`: `parseAndValidateBacklogJson` function that parses JSON, validates, throws `createHttpError(400, ...)` on failures
- Replicate the same structural separation: route handles HTTP concerns, service handles business logic

**WorkItemImplementWorkspace (Java JSONB persistence pattern)**
- Entity at `architecture-model-service/.../entity/WorkItemImplementWorkspaceEntity.java`: UUID PK, JSONB column via `@Type(JsonType.class)`, composite unique index, `@PrePersist`/`@PreUpdate` timestamp management
- Repository at `architecture-model-service/.../repository/entity/WorkItemImplementWorkspaceRepository.java`: `findByProjectIdAndWorkItemId` pattern for composite key lookup
- Service at `architecture-model-service/.../service/WorkItemImplementWorkspaceService.java`: find-or-create upsert pattern, `@Transactional`
- Controller at `architecture-model-service/.../controller/WorkItemImplementWorkspaceController.java`: GET + PUT pattern, inner request record, `@ConditionalOnProperty`

**temporaryArchitectureDiagramValidation.ts (Increment 1 validation semantics)**
- Located at `frontend/src/types/temporaryArchitectureDiagramValidation.ts` with three functions: `isTemporaryArchitectureDiagram`, `checkSemanticTypeConsistency`, `checkReferenceConsistency`
- Re-implement these semantics as a standalone validator in mcp-server, adding the additional server-side checks (attribute uniqueness, edge_points contiguity, etc.) that the frontend helpers do not cover
- The canonical contract interfaces at `frontend/src/types/temporaryArchitectureDiagram.ts` define the exact field shapes the validator must check against

**archModelClient.ts (HTTP client pattern)**
- Singleton axios client at `mcp-server/src/services/archModelClient.ts` with `baseURL`, `timeout: 30000`, JSON headers
- Follow existing method patterns using `this.client.put(...)` and `this.client.get(...)` with `encodeURIComponent` for path parameters
- Existing `getProjectById` method is used for project existence validation

**Liquibase migration 034-work-item-implement-workspace.sql (DB table pattern)**
- Located at `architecture-model-service/src/main/resources/db/changelog/sql/034-work-item-implement-workspace.sql`
- Pattern: `CREATE TABLE IF NOT EXISTS`, UUID PK, JSONB column, `TIMESTAMPTZ DEFAULT NOW()`, composite unique index, project_id index, `COMMENT ON TABLE/COLUMN`
- Changeset registration in `db.changelog-master.yaml` with `tableExists` precondition guard

## Out of Scope
- TTL/auto-expiry of temporary diagrams
- Multi-diagram-per-project limits or quotas
- Audit logging or change history for temporary diagrams
- Version history or diff tracking of temporary diagram saves
- Conversion to native diagram format or architecture-ID mapping
- UI rendering of temporary diagrams (future increment)
- Frontend integration, modal, or UX behavior
- Gateway changes (already complete from Increment 2 -- tool registered in `toolExecutor.ts` and `tools.ts`)
- Modification of the canonical TypeScript contract in `frontend/src/types/temporaryArchitectureDiagram.ts` (Increment 1)
- List/query endpoints for multiple temporary diagrams per project
