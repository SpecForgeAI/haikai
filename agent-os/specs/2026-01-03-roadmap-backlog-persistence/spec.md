# Specification: Roadmap/Backlog Persistence

## Goal
Implement a minimal persistence layer for Roadmap and Backlog storage using a single hierarchical `work_item` table (Initiative/Epic/Feature/Story) with cascading deletes, plus a `project_artifact` table for storing mission/roadmap markdown revisions.

## User Stories
- As a project manager, I want to store hierarchical work items (Initiatives, Epics, Features, Stories) so that I can model a product roadmap and backlog.
- As a system integrator, I want to persist versioned markdown artifacts (mission.md, roadmap.md) so that Agent-OS outputs and tool exports are retained with revision history.

## Specific Requirements

**Liquibase migration 012-work-items-project-artifacts.sql**
- Create `work_item` table with UUID primary key, project_id TEXT, type TEXT, parent_id UUID (self-referential FK)
- Include columns: title, description, status (default 'PLANNED'), sort_order, priority, target_window, tags_json JSONB, external_system, external_key, created_at, updated_at
- FK constraint: `parent_id REFERENCES work_item(id) ON DELETE CASCADE`
- CHECK constraint: `parent_id IS NULL OR parent_id <> id` (prevents self-parent)
- Create indexes: idx_work_item_project_id, idx_work_item_project_type, idx_work_item_project_parent_sort, idx_work_item_parent_id
- Create `project_artifact` table with UUID PK, project_id TEXT, artifact_type TEXT, content TEXT, source TEXT (default 'AGENT_OS'), revision INTEGER, created_at
- Add UNIQUE constraint on (project_id, artifact_type, revision) for project_artifact
- Create indexes: idx_artifact_project_type, idx_artifact_project_type_revision

**WorkItemEntity JPA entity**
- Map to `work_item` table with all columns using standard JPA annotations
- Use `@Type(JsonType.class)` for tags_json column (same pattern as DiagramEntity.typedContentJson)
- Include Lombok annotations: @Entity, @Table, @Getter, @Setter, @NoArgsConstructor, @AllArgsConstructor, @Builder
- Use UUID type for id and parent_id fields with appropriate column mappings

**ProjectArtifactEntity JPA entity**
- Map to `project_artifact` table with all columns
- Use Lombok annotations consistent with existing entities
- Use UUID for id field

**WorkItemDto record**
- Use Java record with @JsonProperty annotations for snake_case serialization
- Include all fields: id, project_id, type, parent_id, title, description, status, sort_order, priority, target_window, tags (as Map), external_system, external_key, created_at, updated_at
- Follow SequenceDiagramDto pattern for JSON property naming

**ProjectArtifactDto record**
- Use Java record with @JsonProperty annotations
- Include all fields: id, project_id, artifact_type, content, source, revision, created_at

**WorkItemRepository interface**
- Extend JpaRepository<WorkItemEntity, UUID>
- Add method: `List<WorkItemEntity> findByProjectIdOrderBySortOrderAscCreatedAtAscIdAsc(String projectId)`
- Add method: `List<WorkItemEntity> findByProjectIdAndTypeOrderBySortOrderAscCreatedAtAscIdAsc(String projectId, String type)`
- Add method: `List<WorkItemEntity> findByProjectIdAndParentIdOrderBySortOrderAscCreatedAtAscIdAsc(String projectId, UUID parentId)`
- Add method: `void deleteByProjectId(String projectId)`

**ProjectArtifactRepository interface**
- Extend JpaRepository<ProjectArtifactEntity, UUID>
- Add method: `List<ProjectArtifactEntity> findByProjectIdAndArtifactTypeOrderByRevisionDesc(String projectId, String artifactType)`
- Add method: `Optional<ProjectArtifactEntity> findByProjectIdAndArtifactTypeAndRevision(String projectId, String artifactType, Integer revision)`
- Add method: `Optional<ProjectArtifactEntity> findFirstByProjectIdAndArtifactTypeOrderByRevisionDesc(String projectId, String artifactType)` for latest revision

**WorkItemService validation rules**
- Validate parent_id belongs to same project_id (query DB to verify parent exists in same project)
- Validate parent_id cannot equal id (reject with 400 Bad Request)
- Enforce type parenting hierarchy: INITIATIVE (parent must be null), EPIC (parent must be INITIATIVE), FEATURE (parent must be EPIC), STORY (parent must be FEATURE)
- Return clear 400 error messages specifying the validation failure reason
- Use @Transactional for write operations

**ProjectArtifactService revisioning logic**
- On create: auto-increment revision by querying max revision for (project_id, artifact_type) and adding 1
- Default revision to 1 if no prior revisions exist
- Validate artifact_type is one of: MISSION_MD, ROADMAP_MD, BACKLOG_MD
- Validate source is one of: AGENT_OS, TOOL, USER_EDIT

**WorkItemController REST endpoints**
- Base path: `/api/model/projects/{projectId}/work-items`
- GET `/` - list all work items for project (deterministic ordering)
- GET `/{id}` - get single work item by ID
- POST `/` - create new work item (validate and return 201 Created)
- PUT `/{id}` - update existing work item
- DELETE `/{id}` - delete work item (cascades to children via DB)
- Use @PathVariable for projectId, @RequestBody for DTOs

**ProjectArtifactController REST endpoints**
- Base path: `/api/model/projects/{projectId}/artifacts`
- GET `/?artifact_type={type}` - list revisions for artifact type (ordered by revision DESC)
- GET `/{id}` - get specific artifact by ID
- GET `/latest?artifact_type={type}` - get latest revision
- POST `/` - create new artifact revision (auto-increment revision)
- Use @RequestParam for artifact_type filter

**Integration tests for cascade delete**
- Create parent work item with children, delete parent, verify children removed
- Use @DataJpaTest or @SpringBootTest with test database
- Assert child count is 0 after parent deletion

**Integration tests for type parenting validation**
- Test INITIATIVE cannot have parent (expect success with null parent)
- Test EPIC requires INITIATIVE parent (expect 400 if parent is EPIC/FEATURE/STORY)
- Test cross-project parent reference rejected with 400

**Integration tests for artifact revisioning**
- Create artifact revision 1, then revision 2, verify auto-increment
- Query latest revision, verify returns highest revision number

## Visual Design
No visual mockups provided for this backend-only increment.

## Existing Code to Leverage

**DiagramEntity.java (entity pattern with JSONB)**
- Reuse @Type(JsonType.class) annotation pattern for tags_json column in WorkItemEntity
- Follow same Lombok annotation structure (@Entity, @Getter, @Setter, @Builder, etc.)
- Use same column definition pattern for JSONB: `@Column(columnDefinition = "jsonb")`

**SequenceDiagramDto.java (DTO record pattern)**
- Follow Java record structure with @JsonProperty annotations for snake_case
- Use same naming convention for JSON properties (snake_case in annotation, camelCase in Java)

**SequenceDiagramService.java (service validation pattern)**
- Reuse validation pattern with allowed value sets and clear error messages
- Follow @Transactional annotation usage for write methods
- Implement validation methods that throw IllegalArgumentException with descriptive messages

**SequenceDiagramController.java (controller pattern)**
- Follow same @RestController, @RequestMapping, @RequiredArgsConstructor structure
- Use ResponseEntity return types with appropriate HTTP status codes
- Handle validation errors via GlobalExceptionHandler

**005-sequence-diagrams.sql (Liquibase SQL pattern)**
- Follow same comment header format with section separators
- Use TIMESTAMPTZ for timestamp columns with DEFAULT CURRENT_TIMESTAMP
- Create indexes with consistent naming: idx_{table}_{columns}

## Out of Scope
- No frontend UI implementation in this increment
- No Agent-OS execution integration or workflow triggers
- No markdown parsing, import, or export logic
- No Jira or external system sync implementation
- No deep cycle detection beyond basic self-parent check (future increment)
- No batch import/export endpoints
- No soft delete or archive functionality
- No audit logging for changes
- No pagination for list endpoints (can be added later)
- No WebSocket notifications for real-time updates
