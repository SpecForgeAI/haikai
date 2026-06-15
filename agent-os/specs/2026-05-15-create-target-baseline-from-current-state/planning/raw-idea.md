Feature name:
Architect — Create Target Baseline from Current State

Feature summary:
Add a generic architecture copy-and-map workflow that allows a tool user to copy selected architecture entities and relationships from a source architecture, typically Current State, into a target architecture, typically Target State, and automatically create explicit cross-architecture mappings between the original source elements and the newly copied target elements.

This is a prerequisite for future migration-planning workflows, where the system needs to understand that a source/current architecture element is equivalent to, replaced by, renamed as, split into, merged into, or otherwise related to a target-state architecture element.

Primary user:
Architect persona / tool user working inside a project with at least two architectures.

Business goal:
Allow users to create a Target State Architecture baseline from an existing Current State Architecture and persist traceable current-to-target element mappings, so later migration planning, backlog generation, data migration, API parity, and test-pack planning can reference exact source and target architecture elements.

V1 scope:
- Generic support across architecture model domains.
- User can select source architecture and target architecture.
- User can select which architecture domains/entity groups/relationship groups to copy.
- User can choose whether to auto-map copied elements.
- System copies selected entities and selected relationships from source architecture to target architecture.
- System creates ArchitectureElementMapping records for copied elements when auto-map is enabled.
- User can review and edit mappings in a post-copy modal.
- User can create, update, delete, and review mappings between architectures.
- Diagrams are explicitly excluded from v1 copy.
- Existing target architecture content must not be overwritten unless explicitly supported by an append-only-safe operation.
- Copy should be additive in v1.

Out of scope for v1:
- Copying diagrams.
- Rendering copied diagrams.
- Deep merge/overwrite of existing target entities.
- Automatic semantic diff between independently created architectures.
- Complex split/merge UX beyond allowing mapping type selection and notes.
- Migration Delivery Plan generation.
- API Behaviour Examples task.
- Data migration execution.
- OAS generation.
- Shape-spec generation for generated backlog items.

Core concepts:

1. Source architecture
The architecture from which entities and relationships are copied. Usually Current State.

2. Target architecture
The architecture into which copied entities and relationships are created. Usually Target State.

3. Architecture element mapping
A persisted cross-architecture link between a source architecture element and a target architecture element.

Example:
Current.CustomerService -> Target.CustomerService, mappingType=equivalent

4. Auto-map
When enabled, every copied source element is mapped to the newly created target element.

V1 user flow:

1. User opens Architect task/action: "Create Target Baseline from Current State"
2. User selects source architecture and target architecture.
3. UI validates: both belong to same project; source != target; both not archived if status available.
4. User selects copy scope: domains, entity groups, relationship groups, include relationships checkbox.
5. User sees checkbox: "Auto-map copied elements as equivalent" (default checked).
6. User executes copy.
7. Backend copies selected entities into target architecture.
8. Backend copies selected relationships only when relationship type is in scope AND both endpoints have been copied AND can be safely recreated using new IDs.
9. Backend creates ArchitectureElementMapping records if autoMap=true.
10. UI shows copy summary (counts, warnings).
11. UI opens Mapping Review modal.
12. User can view, filter, update mapping type/status, add notes, delete, manually add mapping.
13. User saves mapping edits.
14. Target architecture now contains copied baseline entities/relationships and mapping records are persisted.

Backend requirements:

A. ArchitectureElementMapping persistence model
Suggested table: architecture_element_mappings
Required fields: id, project_id, source_architecture_id, target_architecture_id, source_element_type, source_element_id, target_element_type, target_element_id, mapping_type, status, confidence, notes, created_by_task, created_at, updated_at
Optional: created_by, updated_by, mapping_group_id, metadata_json

mapping_type enum: equivalent, renamed, replaced_by, split, merged, retired, new_in_target, manual_review_required
status enum: confirmed, proposed, needs_review, rejected

V1 default for auto-created: mappingType=equivalent, status=confirmed, confidence=1.0, createdByTask=create-target-baseline

Constraints: project_id required; source/target arch ids required and not equal; source_element required unless new_in_target; target_element required unless retired; prevent duplicate active mappings on (project_id, source_arch, target_arch, source_type, source_id, target_type, target_id, mapping_type).

B. DTOs:
- ArchitectureElementMappingDto
- CreateArchitectureElementMappingRequest
- UpdateArchitectureElementMappingRequest
- ArchitectureMappingSearchResponse
- CopyArchitectureBaselineRequest
- CopyArchitectureBaselineResponse
- CopyArchitectureBaselineWarningDto
- MappingReviewItemDto

C. CRUD/search endpoints:
- GET /api/projects/{projectId}/architecture-mappings (with query params)
- POST /api/projects/{projectId}/architecture-mappings
- PUT /api/projects/{projectId}/architecture-mappings/{mappingId}
- DELETE /api/projects/{projectId}/architecture-mappings/{mappingId}

D. Copy-and-map endpoint:
POST /api/projects/{projectId}/architecture-mappings/copy-baseline

Request: { sourceArchitectureId, targetArchitectureId, domains[], entityTypes[]?, relationshipTypes[]?, includeRelationships, autoMap, copyMode: "append" }

Response: { sourceArchitectureId, targetArchitectureId, copiedEntityCount, copiedRelationshipCount, createdMappingCount, skippedEntityCount, skippedRelationshipCount, warnings[], mappingReview[] }

V1 copyMode: append only

E. Copy behaviour:
- Load selected source entities; create new target entities with new IDs; preserve business fields; rewrite architectureId to target; preserve internal relationships only where both endpoints copied; maintain in-memory sourceId->targetId map; recreate eligible relationships; create mapping records; exclude diagrams; return warnings for skipped/unsupported.

F. Relationship copy rules:
- Only if relationship type in scope AND belongs to source architecture AND both endpoints copied AND target endpoint IDs resolvable. Otherwise skip with warning.

G. Element type registry (or reuse):
Should define: element type key, domain, repository/service accessor, display name field, supported copy flag, supported relationship handling.

Example element type keys (align with existing model concepts):
application, application_component, service, interface, endpoint, logical_data_entity, logical_data_attribute, physical_data_entity, physical_data_attribute, business_process, business_logic, ui_screen, ui_component, environment, cloud_account, network, subnet, compute_cluster, compute_resource, deployment_unit, load_balancer, listener, data_store_instance, infrastructure_resource

Do not hardcode the feature only for data entities.

Frontend requirements:

A. API client functions: copyArchitectureBaseline, listArchitectureMappings, createArchitectureMapping, updateArchitectureMapping, deleteArchitectureMapping

B. Entry point — suggested locations: Architect persona task menu, Architecture management area, Target architecture setup area. Label: "Create Target Baseline from Current State"

C. Create Target Baseline modal/page: source/target arch selectors, domain/entity group selection, include relationships checkbox, auto-map checkbox, execute button, validation messages. Use existing arch selector components where possible.

Validation: source/target required; must differ; at least one domain/entity group selected; warn if target already has entities in selected domains; diagrams excluded message visible.

D. Copy summary: copied entities, copied relationships, mappings created, warnings, skipped.

E. Mapping Review modal — table with columns: source element, source element type, target element, target element type, mapping type, status, confidence, notes. Actions: edit type/status/notes, delete, add manual mapping. Filters: domain, element type, mapping type, status, search by source/target name. Defaults: equivalent/confirmed.

F. Manual mapping creation: pickers constrained to selected source/target architectures; select source element, target element, mapping type, status, notes.

G. UX copy warning: "This operation is append-only. It will create new target elements and mappings. It will not overwrite existing target elements."

Testing requirements:

Backend tests:
1. Creates architecture element mappings (persisted and searchable)
2. Prevents source==target architecture
3. Copies selected entities into target with new IDs and target arch ID
4. Auto-maps copied entities when autoMap=true
5. Does not auto-map when autoMap=false
6. Copies relationships when both endpoints copied
7. Skips relationships when one endpoint not copied (with warning)
8. Excludes diagrams
9. Mapping CRUD
10. Transactional safety on partial failure

Frontend tests:
1. Source/target arch selectors render and validate required values
2. Cannot submit with same source==target
3. Auto-map default checked
4. Domain/entity group selection required
5. Copy summary displays counts and warnings
6. Mapping Review modal displays returned rows
7. Edit mapping type/status/notes
8. Delete a mapping
9. Manually add a mapping
10. UI states diagrams are excluded from v1

Acceptance criteria:
1. Can select source and target architecture (different) within the same project.
2. Can select architecture domains/entity groups to copy.
3. Can choose whether to auto-map.
4. System copies selected entities to target with new IDs.
5. System copies relationships only when both endpoints copied.
6. System never copies diagrams in v1.
7. Auto-map creates current-to-target ArchitectureElementMapping records.
8. User can review mappings after copy.
9. User can edit mapping type, status, notes.
10. User can manually add mappings.
11. User can delete incorrect mappings.
12. Copy is append-only.
13. Backend returns clear warnings for skipped/unsupported.
14. Generic across domains, not data-only.
15. Mappings available via API for later migration-planning tasks.

Implementation notes:
- Prefer generic element mapping model over data-specific tables.
- Prefer reusable element type registry over scattered string literals.
- Keep copy logic server-side so IDs and remapping are transactional.
- Keep v1 append-only.
- Mapping records are project-scoped and architecture-pair scoped.
- Future migration-planning tasks will consume these mappings.
- Exclude diagrams completely even if diagram model references copied entities.
