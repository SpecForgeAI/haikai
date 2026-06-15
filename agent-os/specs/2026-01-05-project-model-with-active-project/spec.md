# Specification: Project Model with Active Project

## Goal
Introduce a first-class Project entity enabling the tool to manage multiple projects while operating on exactly one "active" project at a time, with roadmap import resolving files from the active project's configured parent folder path.

## User Stories
- As a user, I want to create a new project with a name and local folder path so that I can organize my architecture work into separate project contexts.
- As a user, I want the roadmap import to read from my project's folder structure so that I can keep my agent-os artifacts co-located with my project code.

## Specific Requirements

**Project Entity and Database Schema**
- Create `project` table with columns: id (UUID PK), name (TEXT NOT NULL), project_parent_folder (TEXT NOT NULL), is_active (BOOLEAN NOT NULL DEFAULT FALSE), created_at (TIMESTAMPTZ), updated_at (TIMESTAMPTZ)
- Add index on is_active column for efficient active project lookup
- Implement partial unique index `WHERE is_active = true` to enforce single active project at DB level (PostgreSQL)
- Follow existing Liquibase migration pattern from `012-work-items-project-artifacts.sql`

**Project Entity and DTO Classes**
- Create `ProjectEntity.java` following the pattern of `WorkItemEntity.java` with @Entity, @Table, Lombok annotations
- Create `ProjectDto` record with camelCase field names for API responses
- Create `ProjectMapper` for entity-to-DTO conversion following existing mapper patterns

**Project Repository**
- Create `ProjectRepository` interface extending JpaRepository with custom query methods
- Include findByIsActiveTrue() method returning Optional<ProjectEntity>
- Include deactivateAll() method using @Modifying @Query to set is_active=false for all rows

**Project Service Layer**
- Implement ProjectService with @Transactional methods for create, list, getActive, activate operations
- createProject(name, parentFolder, setActive): when setActive=true, deactivate all projects first, then create and activate new one
- activateProject(id): deactivate all projects first, then set specified project active (atomic transaction)
- Throw ResourceNotFoundException with clear message when getActiveProject finds no active project

**Project REST Controller**
- Create ProjectController at base path `/api/projects`
- POST /api/projects: create project, body includes name, projectParentFolder, optional setActive (default true)
- GET /api/projects: return list of all projects
- GET /api/projects/active: return active project or 404 with message "No active project. Create or open a project first."
- POST /api/projects/{id}/activate: set specified project as active

**Roadmap Import Service Update**
- Modify RoadmapImportService.importFromAgentOsFile() to resolve path from active project
- Inject ProjectService dependency; call getActiveProject() at start of import
- Compute roadmap path as: Paths.get(activeProject.getProjectParentFolder(), "agent-os", "product", "roadmap.md")
- If no active project: throw exception with message "No active project. Create or open a project first."
- If parentFolder is null or blank: throw exception with message "Active project has no parent folder configured."
- Update error messages to include the resolved absolute path for troubleshooting

**Frontend API Client for Projects**
- Create `src/api/projectsApi.ts` following pattern of modelApi.ts and roadmapApi.ts
- Export createProject(name, projectParentFolder): POST to /api/projects with setActive=true
- Export listProjects(): GET from /api/projects
- Export getActiveProject(): GET from /api/projects/active, return null on 404
- Export activateProject(id): POST to /api/projects/{id}/activate

**Frontend Active Project State**
- Extend ArchitectureContext or create separate ProjectContext to hold activeProject state
- Add refreshActiveProject() function that calls getActiveProject() API and updates state
- On app initialization (useEffect in App.tsx or ArchitectureProvider): call getActiveProject() and store result
- When activeProject is null, roadmap-related features should show appropriate messaging

**File Menu Update for Create Project**
- Modify FileMenu.tsx to add "Create Project" menu item as FIRST item (above "Open...")
- Add new prop onCreateProject to FileMenu component interface
- Add corresponding handler in TopBar.tsx to open the Create Project modal
- Maintain existing menu structure and styling; do not modify Open/Save identifiers

**Create Project Modal Component**
- Create new component at `src/components/Project/CreateProjectModal.tsx`
- Two controlled input fields: Project Name (text), Parent Folder (text)
- Create button disabled until both fields have non-empty trimmed values
- Cancel button closes modal without action
- On Create click: call createProject API, on success call refreshActiveProject and close modal
- Show inline error message below inputs if API returns error
- Follow styling pattern from ModelFileDialog.tsx with overlay, modal container, header, content, footer structure

**Roadmap Import UI Gating**
- In ProductRoadmapPage.tsx: check if activeProject exists before enabling import button
- When no activeProject: show "Create or open a project to import roadmap." message where import button would be
- Preserve all existing import summary, error display, and tree rendering behavior

## Existing Code to Leverage

**WorkItemEntity.java (lines 1-98)**
- Reuse entity structure pattern: @Entity, @Table, @Getter/@Setter, @NoArgsConstructor/@AllArgsConstructor, @Builder
- Follow same timestamp handling with @PrePersist and @PreUpdate lifecycle callbacks
- Use same UUID primary key pattern and Instant for timestamps

**012-work-items-project-artifacts.sql (lines 1-69)**
- Follow same table creation syntax with TEXT, UUID, TIMESTAMPTZ column types
- Reuse index creation patterns for performance optimization
- Reference constraint syntax for the partial unique index enforcement

**RoadmapImportService.java (lines 44-159)**
- Current projectRootDir @Value injection pattern to be replaced with active project lookup
- readRoadmapFile() method and error handling to remain mostly unchanged, just path source changes
- Preserve all import logic, upsert behavior, and detailed count tracking

**FileMenu.tsx (lines 74-236)**
- Reuse menu item styling and click handler patterns
- Follow same portal rendering approach for proper z-index
- Add new prop and menu item at top of existing menu items list

**ModelFileDialog.tsx (lines 48-303)**
- Reference modal structure: overlay, modal container, header with title and close button, content area, footer with buttons
- Reuse controlled input patterns with useState
- Follow keyboard event handling for Escape to close

## Out of Scope
- Multi-project dashboard or project list view in the UI (only create and activate via API)
- Project deletion or editing capabilities in this increment
- Migrating existing domain tables (diagrams, work_items, etc.) to be project-scoped
- Filesystem browsing/picker dialog for selecting parent folder (text input only)
- Auto-creating a default project during migration or startup
- Project switching UI beyond what is needed for Create Project flow
- Validation of parent folder path existence on the filesystem
- Any changes to the existing Open/Save model file functionality
- Renaming or refactoring existing loadedFileName concept in ArchitectureContext
- Project-scoping of existing work items or artifacts in this increment
