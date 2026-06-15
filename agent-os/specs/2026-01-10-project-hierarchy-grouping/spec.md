# Specification: Project Hierarchy Grouping

## Goal
Introduce an optional `projectHierarchy` field for logical one-level project grouping, and update Open/Save As/Delete modals to display projects grouped under collapsible sections by hierarchy value.

## User Stories
- As a user with many projects, I want to organize them into logical groups (e.g., "ClientA", "Internal") so that I can quickly find the project I need in the Open/Delete modals.
- As a user creating a new project, I want to optionally assign it to a hierarchy group so that it appears under that group in project lists.

## Specific Requirements

**Add projectHierarchy field to Project entity and DTOs**
- Add nullable `project_hierarchy` column to the `project` table (VARCHAR/TEXT, nullable)
- Add `projectHierarchy` field to `ProjectEntity.java` with `@Column(name = "project_hierarchy", nullable = true)`
- Add `projectHierarchy` field to `ProjectDto.java` record with `@JsonAlias("projectHierarchy")` for deserialization
- Update `ProjectMapper.java` to map the new field between entity and DTO
- Existing projects will have null hierarchy (displayed under "(No hierarchy)")

**Database migration for project_hierarchy column**
- Create new migration file `027-project-hierarchy.sql` following existing pattern in `db.changelog-master.yaml`
- Use precondition `not columnExists` on `project.project_hierarchy` to ensure idempotency
- Add index on `project_hierarchy` column for efficient grouping queries: `CREATE INDEX idx_project_hierarchy ON project(project_hierarchy)`

**Update ProjectController and CreateProjectRequest**
- Add `projectHierarchy` field to `CreateProjectRequest` record with `@JsonAlias` for both camelCase and snake_case
- Pass `projectHierarchy` to `ProjectService.createProject()` method
- Trim whitespace from `projectHierarchy`; treat blank/whitespace-only as null

**Update ProjectService create logic**
- Extend `createProject()` signature to accept optional `projectHierarchy` parameter
- Store trimmed value or null if blank/empty
- No change to project name uniqueness validation (remains global)

**Update frontend projectsApi types and functions**
- Add `projectHierarchy?: string` to `ProjectDto` interface
- Add `project_hierarchy?: string` to `ProjectDtoSnake` interface
- Update `mapProjectFromSnake()` to include `projectHierarchy: dto.project_hierarchy ?? null`
- Update `createProject()` function to accept optional `projectHierarchy` parameter and include in request payload

**Add Project Hierarchy input to CreateProjectModal**
- Add new optional text input field after "Parent Folder": label "Project Hierarchy"
- Add help text: "Optional logical folder for grouping projects in menus (e.g., ClientA, Internal)."
- Include `projectHierarchy` in the `createProject()` API call (omit or null if blank)
- Follow existing input styling from `CreateProjectModal.module.css`

**Add Project Hierarchy input to ModelFileDialog (saveAs mode)**
- Add optional "Project Hierarchy" text input in saveAs mode, similar to filename input
- Pre-fill with current project's hierarchy if available
- Include hierarchy value in any save-as/rename API calls
- This enables users to change hierarchy when duplicating a project

**Implement grouped project list component**
- Create reusable `GroupedProjectList` component for rendering projects in collapsible hierarchy sections
- Accept props: `projects: ProjectDto[]`, `selectedProjectId: string | null`, `onProjectClick: (id: string) => void`
- Group projects by `projectHierarchy` value using a Map or object keyed by hierarchy
- Render one collapsible section per distinct non-empty hierarchy, plus one "(No hierarchy)" section

**Collapsible section behavior and ordering**
- Each section header shows hierarchy name (or "(No hierarchy)") with expand/collapse chevron icon
- Sections independently expandable/collapsed via click on header
- Default expanded state: all sections expanded initially for discoverability
- Section order: "(No hierarchy)" first, then alphabetical by hierarchy name
- Project order within section: alphabetical by project name

**Update DeleteProjectModal to use grouped list**
- Replace flat project list with `GroupedProjectList` component
- Preserve existing selection behavior (single select, highlight selected row)
- Preserve existing keyboard handling (Enter to delete, Escape to close)

**Update ModelFileDialog Open mode to use grouped list**
- Replace flat file list with grouped project/file display using same grouping logic
- Note: ModelFileDialog currently shows model files, not projects; clarify if this modal should also group by project hierarchy or remain unchanged
- If Open modal is for projects (not files), apply same grouping as Delete modal

## Existing Code to Leverage

**ProjectEntity.java and ProjectDto.java**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ProjectEntity.java`
- Uses Lombok `@Builder`, `@Getter`, `@Setter` pattern for entities
- DTO uses Java record with `@JsonAlias` for camelCase deserialization compatibility
- Add new field following same patterns for consistency

**ProjectController.java CreateProjectRequest**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ProjectController.java`
- Uses nested record `CreateProjectRequest` with `@JsonAlias` for flexible JSON field names
- Extend this record to include `projectHierarchy` field

**CreateProjectModal.tsx**
- Located at `frontend/src/components/Project/CreateProjectModal.tsx`
- Uses `useState` for form fields, validates before submit
- Has existing `inputGroup`, `inputLabel`, `input`, `inputHint` CSS classes for styled inputs
- Add new input group following same pattern after Parent Folder input

**DeleteProjectModal.tsx**
- Located at `frontend/src/components/Project/DeleteProjectModal.tsx`
- Fetches projects via `listProjects()` API on modal open
- Renders flat list with `.projectRow`, `.selected` styling
- Refactor to use grouped rendering with collapsible sections

**projectsApi.ts**
- Located at `frontend/src/api/projectsApi.ts`
- Contains `ProjectDto`, `ProjectDtoSnake` interfaces and `mapProjectFromSnake()` helper
- Contains `createProject()`, `listProjects()` functions
- Update interfaces and functions to include `projectHierarchy` field

## Out of Scope
- Multi-level hierarchy paths (e.g., "ClientA/Portal/PoC") - only single-level string supported
- Separate folder/hierarchy entities or database tables - hierarchy is just a string field on Project
- Changing project name uniqueness model - name remains globally unique across all hierarchies
- Hierarchy CRUD management UI (create/rename/delete hierarchies) - hierarchies are ad-hoc strings
- Drag-and-drop reordering of projects within or between hierarchy groups
- Persisting collapse/expand state across sessions - sections reset to expanded on modal open
- Filtering or searching projects within the grouped list
- Batch operations on multiple projects within a hierarchy group
- Hierarchy field on the existing ModelFileDialog file list (model files remain ungrouped)
- Validation rules on hierarchy string format (any non-empty string is valid)
