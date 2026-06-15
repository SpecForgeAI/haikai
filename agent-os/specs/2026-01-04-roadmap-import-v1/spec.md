# Specification: Roadmap Import v1

## Goal
Enable the backend to import an existing Agent-OS generated roadmap.md file from disk, store the raw content as a versioned artifact, and parse it into hierarchical work items (Initiatives and Epics) supporting Format A and Format B/C markdown structures.

## User Stories
- As a product manager, I want to import my existing roadmap.md file so that my initiatives and epics are automatically extracted and stored in the database for tracking.
- As a developer, I want the import to be repeatable and deterministic so that I can re-import updated roadmap files without creating duplicates.

## Specific Requirements

**Configuration for project root directory**
- Add configurable property `app.projectRootDir` mapped to environment variable `APP_PROJECT_ROOT_DIR`
- Default value should be the current working directory for development
- Path resolution strategy: `{projectRootDir}/agent-os/product/roadmap.md` (single workspace mode)
- Log the resolved path when importing for debugging purposes

**REST endpoint for roadmap import**
- Path: `POST /api/model/projects/{projectId}/roadmap/import`
- Success response (200 OK): JSON with `project_id`, `artifact_revision`, `initiatives_created`, `epics_created`
- Error 404 if roadmap.md file not found at expected path
- Error 400 for parse failures with descriptive error message
- Error 409 if FEATURE or STORY work items exist for the project (v1 safety constraint)
- Error 500 for unexpected I/O or system errors

**RoadmapImportService implementation**
- Read roadmap.md content from resolved path using UTF-8 encoding
- Store the raw file content as a ROADMAP_MD artifact with source=AGENT_OS and auto-incrementing revision
- Parse markdown into intermediate model (List of InitiativeNode, each containing List of EpicNode)
- Persist initiatives as work_item with type=INITIATIVE, parent_id=null
- Persist epics as work_item with type=EPIC, parent_id referencing the parent initiative

**Import replace strategy (v1)**
- Before import, check if any work_item with type FEATURE or STORY exists for the projectId
- If features/stories exist, reject import with 409 CONFLICT status and message explaining v1 limitation
- If safe to proceed, delete all existing INITIATIVE and EPIC rows for the projectId (cascade handles children)
- Insert freshly parsed initiatives/epics with new UUIDs
- This ensures import is repeatable without duplicates during early project phases

**Format A parsing (headings-based epics)**
- Initiatives are level-2 headings (lines starting with `## `)
- Epics are level-3 headings (lines starting with `### `) within an initiative section
- Epic description collects all content (bullets, text) under the epic heading until the next `###` or `##`
- Preserve original markdown formatting in epic descriptions

**Format B/C parsing (list-based epics)**
- Initiatives are level-2 headings (lines starting with `## `)
- Epics are first-level list items (unordered: `- ` or `* `, ordered: `^\d+\.\s+`)
- Strip checkbox syntax `[ ]` or `[x]` from epic titles without interpreting as status
- Strip common prefixes `Epic:` or `EPIC:` (case-insensitive) from epic titles
- Epic details are nested/indented bullets following the epic list item
- Append detail bullets to epic.description preserving markdown format

**Parsing precedence and edge cases**
- If an initiative section contains any `### ` headings, use Format A (ignore list items for epics)
- Otherwise use Format B/C (list items become epics)
- Ignore content before the first `## ` heading (title, intro text)
- Ignore content after the last initiative section
- Create INITIATIVE work_item even if it has zero epics

**Work item persistence mapping**
- INITIATIVE: id=new UUID, project_id from path, type="INITIATIVE", parent_id=null, title from heading, description=null, status="PLANNED", sort_order by appearance order
- EPIC: id=new UUID, project_id from path, type="EPIC", parent_id=initiative.id, title from parsed text, description from collected detail bullets or null, status="PLANNED", sort_order by appearance order within initiative

## Existing Code to Leverage

**ProjectArtifactService and ProjectArtifactRepository**
- Existing service at `com.example.architecturemodel.service.ProjectArtifactService` handles artifact revision auto-increment
- Repository method `findFirstByProjectIdAndArtifactTypeOrderByRevisionDesc` enables calculating next revision
- ROADMAP_MD is already a valid artifact type in the allowed set
- Reuse `ProjectArtifactMapper.toEntity()` for creating artifact records

**WorkItemService and WorkItemRepository**
- Existing service at `com.example.architecturemodel.service.WorkItemService` with validation logic for type hierarchy
- Repository at `com.example.architecturemodel.repository.entity.WorkItemRepository` with query methods
- Need to add `countByProjectIdAndTypeIn(projectId, types)` and `deleteByProjectIdAndTypeIn(projectId, types)` methods
- Reuse `WorkItemMapper.toEntity()` pattern for creating work item records

**OasSpecService configuration pattern**
- Example at `com.example.architecturemodel.service.OasSpecService` shows how to inject `@Value` properties for file paths
- Pattern: constructor injection with `@Value("${property.name:default}")` annotation
- Use `Path.of()` for path construction and `Files.readString()` for reading content

**Exception handling patterns**
- `ResourceNotFoundException` for 404 responses (file not found)
- `IllegalArgumentException` for 400 responses (parse errors, validation failures)
- Standard Spring Boot exception handling converts these to proper HTTP status codes

**Test patterns from existing services**
- `ProjectArtifactServiceTest` and `WorkItemServiceTest` use Mockito with `@ExtendWith(MockitoExtension.class)`
- Use `@TempDir` JUnit annotation for integration tests involving file system operations
- Use `assertThat` from AssertJ for fluent assertions

## Out of Scope
- Format F (Initiatives section with nested bullets for both initiatives and epics) is NOT supported in this increment
- Format E (tables) is NOT supported in this increment
- Status parsing/mapping from markdown checkboxes or keywords (all items default to PLANNED)
- Any UI/frontend changes for roadmap import
- Editing or exporting roadmap.md (import only, one-way flow)
- Stable ID re-import strategy for preserving existing work item IDs (v1 replaces all)
- Import when features/stories already exist (blocked in v1 for data safety)
- Per-project folder structure `{projectRootDir}/{projectId}/agent-os/product/roadmap.md` (future enhancement)
- Partial import or selective update of specific initiatives/epics
- Import progress reporting or async processing for large files
