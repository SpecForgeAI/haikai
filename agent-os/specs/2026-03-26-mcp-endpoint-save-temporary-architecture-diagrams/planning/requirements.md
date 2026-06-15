# Spec Requirements: MCP Endpoint for Saving Temporary Architecture Diagrams

## Initial Description
Implement a backend/MCP endpoint that accepts a TemporaryArchitectureDiagram payload (from Increment 1 and 2), validates it, persists it as a temporary diagram resource, and returns a reference that the frontend can later use to load and render the diagram.

This is Increment 3 in the series:
- Increment 1: Contract definition (complete)
- Increment 2: Architect task framework (complete)
- Increment 3: MCP endpoint for saving (THIS increment)

The endpoint must:
- Accept only the TemporaryArchitectureDiagram contract (no native diagram payloads)
- Perform structural validation and basic semantic validation
- Store the diagram as a temporary (non-finalized) artifact
- NOT perform any mapping to architecture IDs
- NOT convert to native diagram format yet
- Be accessible to the Architect task via MCP tool call

## Requirements Discussion

### First Round Questions

**Q1:** Persistence layer location: The raw idea mentions both "in-memory store" and "database table: temporary_diagrams" as options. Given the existing patterns, I see three viable approaches: (a) A simple in-memory Map in the mcp-server Node.js process (fast, lost on restart, matches mcp-server session pattern), (b) A new PostgreSQL table via the Java architecture-model-service (durable, requires a Liquibase migration + new Java controller + new archModelClient method, but consistent with the JSONB pattern used by work_item_implement_workspace), or (c) File-based JSON persistence to the project folder (like save_markdown_artifact). I'm assuming option (b) -- a new temporary_diagrams PostgreSQL table with a JSONB column -- is the right choice since diagrams need to survive restarts and be retrievable later. Is that correct, or should we start simpler with option (a) or (c)?
**Answer:** Use option (b): persist temporary diagrams durably in PostgreSQL via architecture-model-service with a dedicated table (JSONB payload), Liquibase migration, Java controller/service/repository support, and corresponding client/MCP wiring; avoid in-memory or file-based storage for this feature.

**Q2:** Validation placement: Increment 1 already has comprehensive TypeScript validation helpers in frontend/src/types/temporaryArchitectureDiagramValidation.ts (isTemporaryArchitectureDiagram, isValidERDiagram, checkSemanticTypeConsistency, checkReferenceConsistency). Since the MCP endpoint lives in the mcp-server (also TypeScript/Node.js), I'm assuming we can directly import or copy these validation functions into mcp-server/ rather than re-implementing from scratch. However, the frontend validation is lightweight (structural type guards). The raw idea specifies more detailed validation (attribute uniqueness per node, edge_points contiguity, etc.) that goes beyond what Increment 1 provides. Should we: (a) import/duplicate the Increment 1 validators and add the additional checks on top, or (b) write a standalone, comprehensive validator in mcp-server from scratch?
**Answer:** Reuse the Increment 1 contract validation semantics, but implement a standalone comprehensive validator in mcp-server/backend-facing code rather than importing from frontend; keep the rules aligned with the canonical contract and add the extra server-side checks there.

**Q3:** Overwrite semantics: The TemporaryArchitectureDiagram contract includes an id field (a local diagram ID). If a second save arrives with the same id value and same projectId, should we: (a) overwrite/upsert the existing record (idempotent saves), or (b) always insert a new row and return a server-generated ID regardless? I'm assuming (a) -- upsert by (projectId, diagramId) -- which matches the workspace pattern. Is that correct?
**Answer:** Use upsert semantics on (projectId, temporaryDiagramId): if the same TemporaryArchitectureDiagram.id is saved again for the same project, overwrite/update the existing temporary record rather than creating duplicates.

**Q4:** Server-generated vs. client-provided ID: The raw idea says the response includes id: string. Should this be the same id that the LLM provided in the TemporaryArchitectureDiagram.id field, or should the server generate a new unique identifier (e.g., using the generateId('tmpdiag-') pattern from mcp-server/src/utils/generateId.ts)? I'm assuming the server should return the client-provided id as the primary identifier (since the LLM already created it and the gateway logged it), but also store a server-generated database primary key internally. Is that correct?
**Answer:** Keep the externally visible response id equal to the client/LLM-provided TemporaryArchitectureDiagram.id, while using a separate internal server/DB primary key if needed.

**Q5:** Project validation: Other MCP tools (e.g., save_architecture_baseline) validate that the projectId exists by calling archModelClient.getProjectById(projectId). Should we perform the same project existence check before persisting, or is it acceptable to store the diagram with a projectId that may not exist yet (since diagram generation might happen before the project is fully set up)?
**Answer:** Yes, validate that projectId exists before persisting, consistent with other MCP tool patterns.

**Q6:** Maximum payload size: The TemporaryArchitectureDiagram payloads from an LLM could be large (many nodes with compartments, many edges with points). Existing limits in the codebase include 200KB for markdown artifacts. Should we impose a maximum payload size for the diagram JSON, and if so, what limit? I'm assuming 500KB would be generous enough for even complex ER diagrams while preventing abuse. Is that reasonable?
**Answer:** Yes, impose a payload size limit; 500KB is a reasonable initial maximum.

**Q7:** Scope boundary -- retrieval endpoint: The raw idea explicitly places "Diagram retrieval endpoint" as out of scope. However, the acceptance criteria state "Diagrams are stored and retrievable by id." Should this increment include a minimal GET retrieval endpoint for testing/verification purposes, or is the "retrievable" criterion satisfied simply by the data being in persistent storage (and a future increment will add the retrieval API)?
**Answer:** Yes, include a minimal GET retrieval endpoint in this increment so the saved temporary diagram is retrievable by projectId + temporary diagram id; needed for the next increment and satisfies acceptance criteria.

**Q8:** Is there anything that should be explicitly excluded from this increment that I haven't mentioned? For example: TTL/auto-expiry of temporary diagrams, multi-diagram-per-project limits, audit logging, or any other cross-cutting concerns?
**Answer:** Explicitly exclude TTL/auto-expiry, multi-diagram-per-project limits, audit logging/history, version history, and any final/native diagram conversion or architecture-ID mapping in this increment.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: Save Backlog Items Route - Path: `mcp-server/src/routes/saveBacklogItemsRoute.ts` -- route pattern (session validation, UUID validation, delegate to service)
- Feature: Backlog Items Service - Path: `mcp-server/src/services/backlogItemsService.ts` -- service pattern with parse-validate-persist
- Feature: Save Backlog Items Types - Path: `mcp-server/src/types/saveBacklogItems.ts` -- request/response type pattern
- Feature: Save Architecture Baseline Route Test - Path: `mcp-server/src/__tests__/saveArchitectureBaselineRoute.test.ts` -- test pattern (jest.mock, mock req/res, handler invocation)
- Feature: Work Item Implement Workspace Migration - Path: `architecture-model-service/src/main/resources/db/changelog/sql/034-work-item-implement-workspace.sql` -- JSONB column storage migration pattern for PostgreSQL
- Feature: Temporary Architecture Diagram Validation - Path: `frontend/src/types/temporaryArchitectureDiagramValidation.ts` -- validation semantics to align with (do NOT import directly; re-implement in mcp-server with aligned rules)
- Feature: ID Generation Utility - Path: `mcp-server/src/utils/generateId.ts` -- ID generation pattern if server-side IDs are needed
- Feature: Architecture Model Client - Path: `mcp-server/src/services/archModelClient.ts` -- HTTP client pattern for calling architecture-model-service Java backend
- Feature: Temporary Architecture Diagram Contract - Path: `frontend/src/types/temporaryArchitectureDiagram.ts` -- canonical TypeScript interfaces defining the full contract shape
- Feature: Tool Executor - Path: `gateway/src/services/toolExecutor.ts` -- shows how gateway calls MCP server; tool endpoint mapping already registered
- Feature: Tool Types - Path: `gateway/src/types/tools.ts` -- SaveTemporaryArchitectureDiagramParams already defined with projectId + diagramJson
- Feature: Chat V2 Route - Path: `gateway/src/routes/chatV2.ts` (lines 3389-3439) -- server-side extraction calling executeToolCall for this tool
- Feature: Error Handler - Path: `mcp-server/src/middleware/errorHandler.ts` -- createHttpError pattern for consistent error responses
- Feature: Session Manager - Path: `mcp-server/src/services/sessionManager.ts` -- getOrCreateSession pattern used by all MCP routes
- Feature: MCP Server Tools Router - Path: `mcp-server/src/routes/tools.ts` -- where new route must be mounted
- Feature: MCP Server Index - Path: `mcp-server/src/index.ts` -- Express app setup for reference
- Feature: Liquibase Changelog Master - Path: `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` -- where new migration changeset must be added (next sequence number is 054)

### Follow-up Questions

No follow-up questions were needed. All answers were clear and comprehensive.

## Visual Assets

### Files Provided:
No visual assets provided. (Confirmed by mandatory bash check of the visuals directory.)

### Visual Insights:
Not applicable -- no visual files found.

## Requirements Summary

### Functional Requirements

**Save Endpoint (POST):**
- Accept POST requests at `/mcp/tools/saveTemporaryArchitectureDiagram` in the mcp-server
- Request body: `{ sessionId, projectId, diagramJson }` where diagramJson is a stringified TemporaryArchitectureDiagram
- Validate sessionId (required, non-empty string)
- Validate projectId (required, UUID v4 format, must reference an existing project via archModelClient.getProjectById)
- Validate diagramJson (required, non-empty string, max 500KB, valid JSON)
- Parse and validate the TemporaryArchitectureDiagram payload comprehensively (see Validation Rules below)
- Persist the validated diagram to a PostgreSQL `temporary_diagrams` table via the Java architecture-model-service
- Upsert semantics: if (projectId, temporaryDiagramId) already exists, overwrite the existing record
- Return response: `{ id, status: "saved", createdAt }` where id is the client/LLM-provided TemporaryArchitectureDiagram.id
- Return 400 for validation failures with descriptive error messages
- Return 502 for upstream persistence failures

**Retrieve Endpoint (GET):**
- Minimal GET endpoint to retrieve a saved temporary diagram by projectId + temporary diagram id
- Accessible via the architecture-model-service Java backend (with corresponding archModelClient method in mcp-server)
- Returns the full TemporaryArchitectureDiagram JSON payload plus metadata (id, createdAt, updatedAt)
- Returns 404 if not found

**Validation Rules (standalone validator in mcp-server, aligned with Increment 1 semantics):**
- Structural type guard: required fields id, name, diagram_kind, source_architecture_domain, view_mode, version, nodes[], edges[]
- ER-specific: diagram_kind must be "ER", source_architecture_domain must be "DATA", view_mode must be "LOGICAL" or "PHYSICAL"
- Semantic type consistency: node semantic_type must match view_mode (LOGICAL -> LOGICAL_DATA_ENTITY, PHYSICAL -> PHYSICAL_DATA_ENTITY); compartment item semantic_type must match similarly
- Reference consistency: edge source_node_id/target_node_id must reference existing node IDs; group child_node_ids must reference existing node IDs
- Node validation: unique IDs across nodes, non-empty ref_name, pos_x/pos_y/width/height present
- Attribute validation: at most one ATTRIBUTES compartment per node, non-empty attribute ref_name, no duplicate attribute names within a node
- Edge validation: unique IDs across edges, source_ref_name/target_ref_name must match node ref_names, edge_points must contain at least 2 points, sequence_order must be contiguous starting from 0
- General: no architecture IDs allowed, all names must be strings

**Persistence Layer (Java/Spring Boot in architecture-model-service):**
- New Liquibase migration (054-temporary-diagrams.sql) creating `temporary_diagrams` table:
  - Internal UUID primary key (server-generated)
  - project_id (UUID, FK to project, NOT NULL)
  - temporary_diagram_id (TEXT, NOT NULL) -- the client/LLM-provided id
  - diagram_payload (JSONB, NOT NULL) -- full TemporaryArchitectureDiagram JSON
  - created_at (TIMESTAMPTZ, NOT NULL, DEFAULT NOW())
  - updated_at (TIMESTAMPTZ, NOT NULL, DEFAULT NOW())
  - Unique composite index on (project_id, temporary_diagram_id) for upsert support
- New Java entity, repository, service, and controller
- POST endpoint in Java backend for receiving from mcp-server archModelClient
- GET endpoint in Java backend for retrieval
- Controller path pattern consistent with existing architecture-model-service conventions

**MCP Server Wiring:**
- New route file: `mcp-server/src/routes/saveTemporaryArchitectureDiagramRoute.ts`
- New service file: `mcp-server/src/services/temporaryArchitectureDiagramService.ts`
- New types file: `mcp-server/src/types/saveTemporaryArchitectureDiagram.ts`
- New validation file: `mcp-server/src/services/temporaryArchitectureDiagramValidator.ts` (standalone, aligned with Increment 1 rules)
- New archModelClient methods for save and retrieve calls to Java backend
- Mount new route in `mcp-server/src/routes/tools.ts`

**Gateway (already complete from Increment 2):**
- Tool name `saveTemporaryArchitectureDiagram` already registered in `gateway/src/types/tools.ts`
- Endpoint mapping `/mcp/tools/saveTemporaryArchitectureDiagram` already in `gateway/src/services/toolExecutor.ts`
- Server-side extraction in `gateway/src/routes/chatV2.ts` already calls executeToolCall

### Reusability Opportunities
- Route structure mirrors `saveBacklogItemsRoute.ts` pattern (session + UUID validation, delegate to service)
- Service structure mirrors `backlogItemsService.ts` pattern (parse JSON, validate, call archModelClient)
- Type definitions mirror `saveBacklogItems.ts` pattern (request/response interfaces)
- Test structure mirrors `saveArchitectureBaselineRoute.test.ts` pattern (jest.mock, mock req/res)
- Database migration mirrors `034-work-item-implement-workspace.sql` pattern (JSONB column, composite unique index)
- Validation logic is semantically aligned with `temporaryArchitectureDiagramValidation.ts` but re-implemented standalone
- archModelClient extension follows existing patterns (axios calls to Java backend)

### Scope Boundaries

**In Scope:**
- MCP route, service, types, and validator in mcp-server (TypeScript/Node.js)
- PostgreSQL table creation via Liquibase migration in architecture-model-service
- Java entity, repository, service, and controller in architecture-model-service
- archModelClient methods for save (POST/PUT) and retrieve (GET) in mcp-server
- Comprehensive server-side validation of the TemporaryArchitectureDiagram contract
- Upsert semantics on (projectId, temporaryDiagramId)
- Project existence validation before persist
- 500KB payload size limit
- Minimal GET retrieval endpoint (by projectId + temporary diagram id)
- Unit tests for route handler, validator, and service in mcp-server
- Response with client-provided id, status, and createdAt timestamp

**Out of Scope:**
- TTL/auto-expiry of temporary diagrams
- Multi-diagram-per-project limits or quotas
- Audit logging or change history
- Version history of temporary diagrams
- Final/native diagram conversion or architecture-ID mapping
- UI rendering of temporary diagrams
- Frontend integration or modal/UX behavior
- Gateway changes (already complete from Increment 2)
- Modification of the canonical TypeScript contract (Increment 1)

### Technical Considerations
- **Multi-layer implementation:** Changes span three codebases -- mcp-server (TypeScript), architecture-model-service (Java/Spring Boot), and a Liquibase SQL migration
- **Request flow:** Gateway -> mcp-server (validation + orchestration) -> architecture-model-service (persistence)
- **JSONB storage:** PostgreSQL JSONB column enables future querying of diagram contents if needed
- **Upsert strategy:** Unique composite index on (project_id, temporary_diagram_id) supports ON CONFLICT upsert in PostgreSQL
- **Validation independence:** Server-side validator is standalone in mcp-server, not imported from frontend, but semantically aligned with Increment 1 rules
- **ID strategy:** Externally visible ID is the client/LLM-provided TemporaryArchitectureDiagram.id; internal DB primary key is a separate server-generated UUID
- **Test framework:** mcp-server uses Jest; architecture-model-service uses JUnit 5 + Spring Boot Test
- **Migration sequencing:** Next available Liquibase changeset ID is 054 (after 053-project-repo-url)
- **Existing Increment 2 wiring:** The gateway tool registration, endpoint mapping, and chatV2 extraction code are already in place and should not be modified
