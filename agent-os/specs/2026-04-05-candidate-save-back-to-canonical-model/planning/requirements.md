# Spec Requirements: Candidate Save-Back to Canonical Model

## Initial Description

Build the feature to promote accepted discovery candidates from Phase 1d back into the canonical architecture meta-model. After Phase 1 discovery completes and produces candidates (applications, services, app_components, interfaces, logical_entities, physical_entities, data_entities, business_processes), the user should be able to trigger a "save-back" action that writes accepted candidates into the real meta-model entities (applications, services, interfaces, etc.) stored in the architecture-model-service.

Key areas to design:
- How MCP save tools should be structured (one tool per entity type? batch tool?)
- Whether save-back is a new discovery run step or a separate action
- How idempotent matching works (name+type? name+parent? dedicated matching logic?)
- How candidate-to-entity mapping is stored (new table? field on candidate?)
- How parent resolution works when saving (top-down order? dependency resolution?)
- Gateway API for triggering save-back
- What happens to candidate status after save
- Error handling for partial saves
- Whether the MCP server or discovery service orchestrates the save

## Requirements Discussion

### First Round Questions

**Q1:** Orchestration Location: I'm assuming the save-back logic should live in the discovery-service (not the MCP server), since the discovery-service already owns the run lifecycle and candidate data, and it already communicates with architecture-model-service via its archModelClient. The existing MCP server save patterns (like saveProjectAnchorEntities and saveArchitectureBaseline) use a GET-merge-PUT approach on the full JSON model, but the discovery-service has direct access to candidate data. Should the discovery-service orchestrate the save-back, or should it go through the MCP server layer (which would require the MCP server to first fetch candidates, then merge them into the model)?

**Answer:** Keep save-back orchestrated through the MCP-controlled path, not as a direct ad hoc write from discovery-service.

**Q2:** Trigger Mechanism: Save-back was explicitly out of scope for Phase 1d. Should it be a new discovery run step (e.g., step 2a or commit) added to the VALID_STEPS array in the run manager, meaning it executes automatically as part of the run pipeline? Or should it be a separate, user-triggered action exposed as a new endpoint (e.g., POST /discovery/runs/:runId/commit) that the user invokes after reviewing candidates? I'm assuming a separate action, since candidates may need human review before promotion. Is that correct?

**Answer:** Make save-back a separate action, not a mandatory core Phase 1 step, since later review/approval will naturally sit in front of it.

**Q3:** Save Strategy -- GET-merge-PUT vs. Direct Entity Creation: The existing patterns in the MCP server use a GET-merge-PUT approach: fetch the full JSON model, add entities to the appropriate arrays, and PUT the entire model back. This works because the ModelController.PUT /api/model handles full-model replacement. The alternative would be creating individual entity-level REST endpoints (POST for each entity type). I'm assuming we should follow the existing GET-merge-PUT pattern via archModelClient.getModel() / archModelClient.putModel() for consistency with saveProjectAnchorEntities and saveArchitectureBaseline. Is that correct, or should we build per-entity-type creation endpoints?

**Answer:** Follow the existing GET-merge-PUT style pattern rather than introducing per-entity creation endpoints in this increment.

**Q4:** CandidateType-to-Entity Mapping: The CandidateType union maps to meta-model entity arrays as follows -- application -> applications[], app_component -> app_components[], service -> services[], interface -> interfaces[], logical_entity -> logical_data_entities[], physical_entity -> physical_data_entities[], data_entity -> logical_data_entities[] (or both?), business_process -> business_processes[]. I'm assuming each accepted candidate is converted to the corresponding entity shape (with the right fields like model_file_id, application_id, etc. populated from the candidate's data payload and parent relationships). Is that mapping correct? What should happen with data_entity specifically -- should it produce a logical_data_entity, a physical_data_entity, or both?

**Answer:** Map to the agreed canonical entity types; for data entities, keep the first increment conservative and target the physical data side only unless there is strong evidence for more.

**Q5:** Idempotent Matching / Deduplication: The existing saveProjectAnchorEntities uses name-based deduplication (skip if an entity with the same name already exists). The saveArchitectureBaseline also uses name-based matching for merge operations. I'm assuming save-back should follow the same pattern: when a candidate named "Order Service" of type service is promoted, we first check if a service with that exact name already exists in the model. If it exists, we skip (or optionally update). If not, we create a new entity with a generated ID. Should we support an "update existing" mode, or is skip-if-exists sufficient for the first increment?

**Answer:** Use skip/reuse-style idempotent matching first, not broad update-existing behavior.

**Q6:** Parent Resolution Order: Candidates have a parentCandidateId field creating a hierarchy (e.g., service -> application, interface -> service, app_component -> application). When saving back, parent entities must exist before children (since children reference the parent's generated ID via application_id, service_id, etc.). I'm assuming we should process candidates in topological order: applications first, then app_components and services (which need application_id), then interfaces (which need service_id), then endpoints (which need interface_id). Should we resolve parent references by following the parentCandidateId chain and mapping to already-saved entity IDs, or by name-based lookup in the existing model?

**Answer:** Resolve parents primarily through the candidate parent chain/save order, with existing-model lookup only where needed for idempotent matching.

**Q7:** Candidate Status Update After Save: I'm assuming that after successful save-back, each promoted candidate's status should be updated from proposed (or accepted if we add a review step first) to a new status value like committed. This would require adding committed to the CandidateStatus union. Alternatively, we could just update data with a committedEntityId field linking back to the created entity ID. Which approach do you prefer -- a new status value, a data field, or both?

**Answer:** Use both: a save/commit status and a reference to the committed canonical entity.

**Q8:** Which Candidates Are Eligible: Should save-back promote ALL candidates for a run (regardless of status), only those with status accepted, or only those with status proposed? I'm assuming only accepted candidates should be promoted, which means there needs to be a prior step or UI where candidates are moved from proposed to accepted. For this increment, should we just promote all proposed candidates (since there's no review UI yet), or should we require explicit acceptance first?

**Answer:** Only save candidates that are eligible under the current policy, and in this increment that should mean the strong/high-confidence subset rather than everything.

**Q9:** Error Handling for Partial Saves: If the model contains 10 candidates and saving the 7th fails (e.g., parent resolution failure), should we rollback all 6 previously saved entities (transactional), continue saving the remaining 3 and report partial results, or fail-fast and stop at the first error? I'm assuming fail-fast with a descriptive error, since the GET-merge-PUT pattern means we only call putModel once at the end (so it's naturally atomic). Is that correct?

**Answer:** Keep it simple and deterministic -- fail the save-back operation clearly rather than introducing rollback complexity.

**Q10:** Tracking Provenance: Should we store which discovery run and candidate produced each created entity? This could be done via a new discovery_candidate_entity_mapping table (candidate_id -> entity_type + entity_id), or by adding a source_candidate_id field to the entity's properties, or by storing the mapping in the candidate's data JSONB. I'm assuming the candidate's data payload is the simplest place to store { committedEntityId: "svc-abc123" }. Is that sufficient, or do you want a dedicated mapping table for richer querying?

**Answer:** Use a dedicated mapping shape rather than burying all provenance only inside candidate JSON.

**Q11:** Is anything explicitly out of scope for this increment? I'm assuming the following are OUT of scope: (a) human review UI for accepting/rejecting candidates before save-back, (b) undo/rollback of committed entities, (c) incremental re-save (detecting what changed since last commit), (d) inter-candidate relationship creation (e.g., data_movements between services), and (e) diagram node creation for committed entities. Is that correct, or should any of these be in scope?

**Answer:** Yes -- keep human review UI, undo/rollback, sophisticated incremental re-save behavior, inter-candidate relationship creation, and diagram generation out of scope here.

### Existing Code to Reference

**Similar Features Identified:**

- Feature: Anchor Entities Save Service - Path: `mcp-server/src/services/anchorEntitiesService.ts` -- the closest pattern for save-back: GET-merge-PUT with name-based deduplication, parent resolution by name, entity creation with generated IDs. This is the primary template for the save-back service.
- Feature: Architecture Baseline Service - Path: `mcp-server/src/services/architectureBaselineService.ts` -- more complex GET-merge-PUT pattern handling services, interfaces, endpoints, logical/physical data entities, attributes, business logic, and data movements. Shows ID generation, ref resolution (IdMaps, ResolvedRefs), entity building (BuiltEntities), and merge with existing model. Template for multi-entity-type save logic.
- Feature: Save Anchor Entities Route - Path: `mcp-server/src/routes/saveProjectAnchorEntitiesRoute.ts` -- MCP tool route pattern (session validation, projectId UUID validation, delegate to service, structured error responses).
- Feature: MCP Tools Router - Path: `mcp-server/src/routes/tools.ts` -- where the new save-back tool route would be mounted.
- Feature: MCP Arch Model Client - Path: `mcp-server/src/services/archModelClient.ts` -- `getModel()`, `putModel()`, `getProjectById()` methods used by all save services. Also has `getDiscoveryRun()` but NOT candidate-fetching methods (those are in discovery-service's archModelClient).
- Feature: Discovery Service Arch Model Client - Path: `discovery-service/src/services/archModelClient.ts` -- `getCandidatesByRun()`, `updateCandidate()`, `bulkSaveCandidates()` methods for reading and updating candidates. The MCP server would need to add similar candidate-fetching methods to its own archModelClient.
- Feature: Candidate Controller (architecture-model-service) - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/DiscoveryCandidateController.java` -- REST endpoints for candidates including GET (with type/status filters), PUT (update), and POST (bulk insert). Base path: `/api/model/projects/{projectId}/discovery/runs/{runId}/candidates`.
- Feature: Candidate JPA Stack - Paths: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DiscoveryCandidateEntity.java`, `...model/dto/DiscoveryCandidateDto.java`, `...service/DiscoveryCandidateService.java`, `...repository/entity/DiscoveryCandidateRepository.java` -- existing candidate persistence infrastructure.
- Feature: Canonical Entity JPA Entities - Paths: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ApplicationEntity.java`, `ServiceEntity.java`, `InterfaceEntity.java`, `EndpointEntity.java`, `ApplicationComponentEntity.java`, `LogicalDataEntityEntity.java`, `PhysicalDataEntityEntity.java`, `BusinessProcessEntity.java` -- the target entity shapes that candidates must be converted into.
- Feature: Discovery Gateway Routes - Path: `gateway/src/routes/discovery.ts` -- existing proxy routes for discovery run creation and status. Template for adding a save-back proxy route.
- Feature: Discovery Service Runs Route - Path: `discovery-service/src/routes/runs.ts` -- existing run endpoints (POST create, GET status). Shows the fire-and-forget async pattern.
- Feature: ID Generation Utility - Path: `mcp-server/src/utils/generateId.ts` -- `generateId(prefix)` for creating entity IDs with prefixes like `app-`, `svc-`, `comp-`, `iface-`, etc.
- Feature: Empty Model Shell - Pattern in `anchorEntitiesService.ts` and `architectureBaselineService.ts` -- creates a full empty model structure with all entity/relationship arrays initialized, used when no existing model is found.
- Feature: Candidate Types - Path: `discovery-service/src/types/candidate.ts` -- `CandidateType` union (`application`, `app_component`, `service`, `logical_entity`, `physical_entity`, `interface`, `business_process`, `data_entity`) and `CandidateStatus` union (`proposed`, `accepted`, `rejected`, `merged`).
- Feature: Candidate Generation Rules (for understanding candidate data payloads) - Path: `discovery-service/src/services/candidateGenerationRules/` -- `anchorTypeRule.ts`, `serviceComponentRule.ts`, `interfaceRule.ts`, `dataEntityRule.ts`, `fallbackPackageRule.ts` show how candidate `data` payloads are populated with descriptions, tech stack info, etc.

### Follow-up Questions

No follow-up questions were needed.

## Visual Assets

### Files Provided:
No visual assets provided.

## Requirements Summary

### Functional Requirements

- **MCP-Controlled Save-Back Tool**: Implement save-back as a new MCP tool route (e.g., `save_discovery_candidates_to_model`) in the MCP server, following the existing tool pattern (session management, projectId validation, delegate to service function). The MCP server orchestrates the save, not the discovery-service directly.
- **Separate User-Triggered Action**: Save-back is NOT a mandatory Phase 1 run step. It is a distinct action invoked after discovery completes, decoupled from the run lifecycle. This allows future review/approval workflows to sit in front of it.
- **GET-merge-PUT Save Strategy**: Follow the established pattern from `anchorEntitiesService` and `architectureBaselineService`: fetch the existing model via `getModel()`, merge new entities into the appropriate arrays, and save via `putModel()`. No per-entity-type creation endpoints in this increment.
- **CandidateType-to-Entity Type Mapping**: Convert candidates to canonical entities based on their `candidateType`:
  - `application` -> `metaModel.entities.applications[]`
  - `app_component` -> `metaModel.entities.app_components[]`
  - `service` -> `metaModel.entities.services[]`
  - `interface` -> `metaModel.entities.interfaces[]`
  - `logical_entity` -> `metaModel.entities.logical_data_entities[]`
  - `physical_entity` -> `metaModel.entities.physical_data_entities[]`
  - `data_entity` -> `metaModel.entities.physical_data_entities[]` (conservative; physical side only in first increment)
  - `business_process` -> `metaModel.entities.business_processes[]`
- **Entity Shape Conversion**: Each candidate must be converted to the correct entity shape with all required fields populated. Key fields include `id` (generated via `generateId()`), `model_file_id` (derived from project), `name` (from candidate name), `description` (from candidate `data` payload), and parent FK fields (`application_id`, `service_id`, etc.) resolved from the candidate hierarchy.
- **Skip/Reuse Idempotent Matching**: Use name-based deduplication following the `anchorEntitiesService` pattern. If an entity with the same name already exists in the model for that entity type, skip creation and reuse the existing entity's ID for downstream parent resolution. No broad update-existing behavior in this increment.
- **Topological Parent Resolution via Candidate Chain**: Process candidates in topological order following the `parentCandidateId` hierarchy: top-level entities first (applications, business_processes), then children (app_components, services), then grandchildren (interfaces), etc. Resolve parent FK fields by mapping `parentCandidateId` to the already-created (or already-existing) entity ID. Fall back to existing-model name lookup only where needed for idempotent matching (e.g., a candidate's parent was skipped because it already existed).
- **Eligibility Policy -- High-Confidence Subset**: Only promote candidates that meet the current eligibility policy. In this increment, that means the strong/high-confidence subset (likely candidates with confidence above a threshold, aligned with the auto-accept threshold from Phase 1d triage). Not all candidates are promoted -- only those that passed 1d triage with high confidence.
- **Dual Status + Entity Reference Update**: After successful save-back, update each promoted candidate with BOTH:
  - A new status value (e.g., `committed`) added to the `CandidateStatus` union
  - A reference to the created/reused canonical entity ID stored alongside the candidate
- **Dedicated Provenance Mapping**: Track candidate-to-entity provenance via a dedicated mapping structure (not just buried in candidate JSONB). This could be a new table or a structured mapping object that records which candidate produced which entity, enabling richer querying and traceability.
- **Fail-Fast Error Handling**: If any step in the save-back fails (e.g., parent resolution failure, entity conversion error), fail the entire operation with a clear, descriptive error. The GET-merge-PUT pattern is naturally atomic (putModel is called once at the end), so partial state is not written on failure. No rollback complexity needed.
- **MCP Server Candidate Fetching**: The MCP server's `archModelClient` needs new methods to fetch candidates from the architecture-model-service (the discovery-service's client already has these, but the MCP server does not). At minimum: fetch candidates by run ID with status/type filters.
- **Gateway Proxy Route**: Add a new gateway proxy route to trigger save-back (or expose it via the existing MCP tool routing). The gateway forwards the request to the MCP server's new tool endpoint.

### Reusability Opportunities

- **anchorEntitiesService.ts Pattern**: Primary template for the save-back service -- same GET-merge-PUT flow, name-based dedup, parent resolution by name, entity creation with generateId()
- **architectureBaselineService.ts Pattern**: More complex reference for multi-entity-type saves with IdMaps for cross-entity ref resolution, BuiltEntities/BuiltRelationships assembly, and merge logic
- **MCP Tool Route Pattern**: `saveProjectAnchorEntitiesRoute.ts` provides the exact route skeleton (session validation, UUID validation, service delegation, error handling)
- **generateId() Utility**: Existing ID generation with entity-type prefixes
- **Empty Model Shell**: Reusable model initialization pattern from anchorEntitiesService
- **archModelClient Methods**: `getModel()`, `putModel()`, `getProjectById()` already available in MCP server client
- **DiscoveryCandidateController GET Endpoint**: Existing REST endpoint with type/status filters for fetching eligible candidates
- **DiscoveryCandidateController PUT Endpoint**: Existing REST endpoint for updating individual candidate status after save-back

### Scope Boundaries

**In Scope:**
- New MCP tool route and service for save-back (`save_discovery_candidates_to_model` or similar)
- MCP server archModelClient methods for fetching candidates by run ID with filters
- CandidateType-to-entity-type mapping and entity shape conversion logic
- Topological ordering of candidates by parentCandidateId for correct save order
- Name-based idempotent matching (skip if exists, reuse ID for parent resolution)
- GET-merge-PUT model save following existing patterns
- Eligibility filtering by confidence threshold (high-confidence subset only)
- New `committed` status value added to CandidateStatus union
- Candidate status update after successful save (status + entity reference)
- Dedicated provenance mapping structure (candidate -> entity tracking)
- Fail-fast error handling with descriptive messages
- Gateway proxy route for triggering save-back
- Unit tests for entity conversion, topological ordering, idempotent matching, and merge logic

**Out of Scope:**
- Human review UI for accepting/rejecting candidates before save-back
- Undo/rollback of committed entities
- Sophisticated incremental re-save behavior (detecting changes since last commit)
- Inter-candidate relationship creation (e.g., data_movements between services)
- Diagram node creation for committed entities
- Per-entity-type creation REST endpoints (using GET-merge-PUT instead)
- Update-existing mode for idempotent matching (skip-only in this increment)
- Logical data entity creation from `data_entity` candidates (physical side only)
- Discovery-service direct orchestration of save-back (MCP-controlled path instead)

### Technical Considerations

- **MCP Server Client Extension**: The MCP server's `archModelClient` (at `mcp-server/src/services/archModelClient.ts`) currently has no methods for fetching discovery candidates. New methods are needed to call `GET /api/model/projects/{projectId}/discovery/runs/{runId}/candidates?status=proposed` (or whatever status filter matches the eligibility policy). The discovery-service's `archModelClient` has these methods already and can serve as a reference.
- **Candidate Data Payload Interpretation**: The candidate `data` JSONB payload contains proposed properties like description, tech stack indicators, and evidence summaries. The save-back service must extract relevant fields from `data` to populate entity-specific columns (e.g., `description`, `service_type`, `core_tech`, `physical_type`, `database_name`). The structure of `data` varies by candidate type and generation rule -- see `candidateGenerationRules/` for how data is populated.
- **Entity ID Prefix Conventions**: The existing `generateId()` utility produces IDs like `app-{uuid}`, `svc-{uuid}`, `comp-{uuid}`, `iface-{uuid}`, etc. Save-back should use the same prefix conventions for consistency.
- **model_file_id Resolution**: All canonical entities require a `model_file_id` field. This is derived from the project name (the model filename). The save-back service needs to resolve this from the project ID, same as `anchorEntitiesService` does via `getProjectById()`.
- **CandidateStatus Union Extension**: Adding `committed` requires changes in: `discovery-service/src/types/candidate.ts` (TypeScript union), and the `DiscoveryCandidateEntity.java` status column (no schema change needed since it's a TEXT column, but documentation and validation should be updated).
- **Provenance Mapping Persistence**: The dedicated mapping structure needs a persistence mechanism. Options include: (a) a new `discovery_candidate_entity_mapping` table in architecture-model-service with Liquibase migration, JPA entity, DTO, service, and controller; or (b) a structured field on the candidate DTO/entity that is more than just JSONB data. The spec writer should evaluate the right approach.
- **Confidence Threshold for Eligibility**: The existing `CANDIDATE_AUTO_ACCEPT_THRESHOLD` (from `candidateDefaults.ts`) defines the high-confidence boundary. Save-back should use this same threshold (or a configurable value) to determine which candidates are eligible for promotion.
- **Candidate Update After Save**: After successful putModel, the service must update each promoted candidate's status to `committed` and record the entity reference. This requires calling the candidate update endpoint for each promoted candidate (or a bulk update if one is added). The existing `PUT /api/model/projects/{projectId}/discovery/runs/{runId}/candidates/{candidateId}` endpoint handles individual updates.
- **Topological Sort Implementation**: The parentCandidateId chain forms a forest (multiple trees). A simple topological sort groups candidates by depth: depth-0 (no parent), depth-1 (parent is depth-0), etc. Within each depth, candidates can be processed in any order. This ensures parent entities are created before children.
- **Run ID and Project ID**: The save-back action needs both a projectId and a runId to identify which candidates to promote and which project's model to update. These are the primary input parameters for the MCP tool.
