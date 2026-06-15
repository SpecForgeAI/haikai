# Requirements: Project Model with Active Project

## Title
Introduce Project model with active project, Create Project UI, and project-scoped roadmap import path

## Intent
Add a first-class Project concept so the tool operates against one active project at a time (while storing many projects).
A Project captures the current "filename/project name" plus a local parent folder that acts as the root for
Agent-OS/SDD artifacts. Roadmap import must read from:
  [project_parent_folder]/agent-os/product/roadmap.md
instead of the tool's own repo folder.

## Scope
- backend: schema + APIs + roadmap importer path resolution using active project
- frontend: add File > Create Project (modal) and establish active project in UI state
- minimal changes only; do not redesign navigation or other features

## Non-Goals
- Multi-project view/dashboard UX beyond "open/set active"
- Migrating all domain tables to be project-scoped in this increment (only what is required to support roadmap import correctness)
- Implementing filesystem browsing dialog (use text input for folder path)

## Requirements

### Project Model
- Persist multiple Projects in DB.
- Exactly one Project can be "active" at any time.
- Project attributes (minimum viable):
  - id (UUID)
  - name (string)  // this is the existing "filename / project name"
  - project_parent_folder (string)  // absolute local folder path
  - is_active (boolean)
  - created_at, updated_at timestamps

### Active Project Semantics
- The UI shows/operates on exactly one active project at a time.
- Backend provides:
  - Create Project (and optionally set active)
  - List Projects
  - Get Active Project
  - Set Active Project (by id)
- Enforce "only one active" at service level (transactionally), and additionally enforce via DB constraint where feasible.

### Roadmap Import
- Roadmap import must resolve roadmap.md from the ACTIVE project:
  - Path: <project_parent_folder>/agent-os/product/roadmap.md
- If no active project is set:
  - Return a clear error: "No active project. Create or open a project first."
- If active project has missing/blank parent folder:
  - Return a clear error: "Active project has no parent folder configured."
- Preserve existing deterministic import guarantees and import summary output (inserted/updated/archived/deleted).

### Frontend UX
- File menu:
  - Add new menu item "Create Project" ABOVE existing "Open" and "Save"
  - Text only; do not rename any internal identifiers tied to "Open" / "Save"
- Create Project modal:
  - Fields:
    - Project Name (required)
    - Parent Folder (required; text input)
  - Buttons at bottom:
    - Create (primary)
    - Cancel
  - Validation:
    - Disable Create until both fields are non-empty
    - Show inline validation message(s) if user attempts Create with invalid fields
  - On Create success:
    - Set created project as ACTIVE
    - Close modal
    - Refresh active project state in the app

## Implementation Details

### Backend (architecture-model-service)

#### 1) DB / Liquibase
- Create table: project
  - id UUID PK
  - name VARCHAR not null
  - project_parent_folder VARCHAR not null
  - is_active BOOLEAN not null default false
  - created_at TIMESTAMP not null default now()
  - updated_at TIMESTAMP not null default now()
- Add an index on (is_active)
- Enforce single active:
  - Preferred: partial unique index where is_active = true (PostgreSQL supports this)
    - UNIQUE INDEX project_single_active_idx ON project((is_active)) WHERE is_active = true
  - If Liquibase/DB constraints make partial unique awkward, enforce in service + add a safety check.

#### 2) API
- Add REST endpoints under /api/projects:
  - POST /api/projects
    - body: { name, projectParentFolder, setActive?: boolean } (default setActive=true)
    - returns: created project
  - POST /api/projects (when setActive is true, deactivate current active first)
  - GET /api/projects
    - returns: list
  - GET /api/projects/active
    - returns: active project or 404 with clear message
  - POST /api/projects/{id}/activate
    - sets active project (transaction: deactivate all, activate this)
    - returns: active project

#### 3) Service logic
- Activating a project must be transactional and guarantee only one active.
- Creating a project with setActive=true must also deactivate any currently active project.

#### 4) Roadmap importer update
- Modify roadmap import flow to:
  - look up active project
  - compute roadmap path: Paths.get(projectParentFolder, "agent-os", "product", "roadmap.md")
  - read file from that location
- Update "file missing" errors to include the resolved absolute path.

### Frontend (React + TS)

#### 1) Add Project API client:
- src/api/projectsApi.ts:
  - createProject(name, projectParentFolder)
  - listProjects()
  - getActiveProject()
  - activateProject(id)

#### 2) Add Project context (or extend existing top-level App state):
- Provide activeProject state + refreshActiveProject()
- On app boot:
  - call GET /api/projects/active
  - if none, store null and show non-blocking banner/toast where relevant (no forced redirect in this increment)

#### 3) File menu changes:
- In the existing File menu component:
  - Insert "Create Project" above Open/Save
  - Wire to open Create Project modal

#### 4) Create Project modal component:
- New component: src/components/Project/CreateProjectModal.tsx
- Controlled inputs for name + parent folder
- Create action:
  - call createProject()
  - then refresh activeProject context
  - close modal on success
  - show error message on failure (e.g., validation, backend errors)

#### 5) Roadmap import UI gating (minimal):
- Wherever roadmap import CTA exists:
  - If no active project, show message: "Create or open a project to import roadmap."
  - Disable import action until active project exists
  - Keep existing import summary panel behavior once import runs

## Compatibility / Migration
- Do not attempt to auto-create a default project in this increment.
- Existing data remains; roadmap import simply becomes unavailable until a project is created and active.

## Acceptance Criteria
- User can create a project via File > Create Project modal with name + parent folder and set it active.
- Backend stores multiple projects; only one is_active=true at any time.
- GET /api/projects/active returns the active project after creation.
- Roadmap import reads from:
  <active_project_parent_folder>/agent-os/product/roadmap.md
  and the previous useNavigate/Router issues are unaffected by this change.
- If no active project, roadmap import returns a clear error and UI disables import with guidance.
