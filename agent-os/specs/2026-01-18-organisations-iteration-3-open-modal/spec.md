# Specification: Organisations Iteration 3 - Update Project Open Modal

## Goal
Update the Project Open modal to display projects in a 2-level collapsible tree structure: Organisation Name at the top level, with Project Hierarchy groups nested beneath, enabling users to browse and open projects organized by their owning organisation.

## User Stories
- As a user, I want to see projects grouped by Organisation in the Open modal so that I can quickly find projects belonging to a specific organisation
- As a user, I want collapsible organisation and hierarchy sections so that I can focus on relevant project groups without visual clutter

## Specific Requirements

**Update Frontend ProjectDto to Include organisationId**
- Add `organisationId: string | null` field to `ProjectDto` interface in `projectsApi.ts`
- Add `organisation_id` field to `ProjectDtoSnake` interface
- Update `mapProjectFromSnake()` function to map `organisation_id` to `organisationId`
- Backend already returns `organisation_id` in responses; frontend currently ignores it

**Fetch Organisations List for Name Resolution**
- Call `listOrganisations()` alongside `listProjects()` when the Open modal loads
- Use `Promise.all()` to fetch both in parallel for optimal latency
- Build a lookup map: `Map<string, string>` mapping `organisationId` to `organisationName`
- Pass the organisation map to the grouped list component for display name resolution

**Create OrganisationGroupedProjectList Component**
- Create new component `OrganisationGroupedProjectList.tsx` in `frontend/src/components/Project/`
- Accept props: `projects`, `organisations` (or pre-built orgMap), `selectedProjectId`, `onProjectClick`, `formatDate`
- Render 2-level nested collapsible structure with organisation sections containing hierarchy subsections
- Create accompanying CSS module `OrganisationGroupedProjectList.module.css`

**2-Level Grouping Data Structure**
- Level 1 grouping: Group projects by `organisationId`, resolve to `organisationName` for display
- Level 2 grouping: Within each organisation, group by `projectHierarchy` (reuse existing logic from `GroupedProjectList`)
- Leaf level: Individual project rows, selectable for opening
- Projects with null `organisationId` should not appear (per requirements: no "Unassigned" bucket)

**Sorting Rules (A-Z at All Levels)**
- Organisation sections sorted alphabetically by organisation name (case-insensitive)
- Hierarchy sections within each organisation sorted alphabetically, with "(No hierarchy)" section listed first
- Projects within each hierarchy section sorted alphabetically by project name (case-insensitive)
- Use `localeCompare` with `{ sensitivity: 'base' }` for consistent case-insensitive sorting

**Expand/Collapse State Management**
- Track expanded state separately for organisation level and hierarchy level
- Use `Set<string>` for expanded organisation IDs and nested `Map<string, Set<string>>` for hierarchy keys per org
- Default: All organisation sections collapsed on modal open
- Expanding an organisation does NOT auto-expand its child hierarchy sections
- Preserve expand/collapse state during the modal session (do not reset on re-render)

**Visual Hierarchy and Indentation**
- Organisation header: No indentation, use existing `.sectionHeader` styling with slightly bolder treatment
- Hierarchy header: Indent 16-20px from left edge to indicate nesting under organisation
- Project rows: Indent 32-40px from left edge (increased from current 32px to account for hierarchy level)
- Use visual differentiation (background shade or border-left) to distinguish organisation vs hierarchy headers

**Update ModelFileDialog to Use New Component**
- In `ModelFileDialog.tsx`, import and use `OrganisationGroupedProjectList` for `mode === 'open'`
- Update `loadData()` to fetch both `listProjects()` and `listOrganisations()` in parallel
- Pass organisations data to the new component
- Keep existing `GroupedProjectList` usage for other contexts if needed

**Empty State Handling**
- If no projects exist at all, display existing empty state message: "No projects available"
- Do not render organisation sections that have zero projects
- Do not render hierarchy sections within an organisation that have zero projects (should not occur given proper grouping)

## Existing Code to Leverage

**GroupedProjectList.tsx (frontend/src/components/Project/GroupedProjectList.tsx)**
- Reuse the grouping-by-hierarchy logic and `GroupedSection` interface pattern
- Reuse the section expand/collapse toggle pattern with `Set<string>` state
- Reuse the project row rendering and selection highlighting logic
- Adapt the `useMemo` grouping computation for 2-level nesting

**GroupedProjectList.module.css (frontend/src/components/Project/GroupedProjectList.module.css)**
- Reuse `.sectionHeader`, `.chevron`, `.sectionName`, `.sectionCount` styles for both levels
- Reuse `.projectRow`, `.selected`, `.projectName`, `.projectDate` styles for leaf rows
- Extend with new indentation classes for organisation vs hierarchy level distinction

**organisationsApi.ts (frontend/src/api/organisationsApi.ts)**
- Use `listOrganisations()` function which returns `OrganisationDto[]` with `{ id, name, description }`
- Build lookup map from this response to resolve organisation IDs to display names

**ModelFileDialog.tsx (frontend/src/components/file/ModelFileDialog.tsx)**
- Extend the `loadData()` function to fetch organisations alongside projects
- Replace `GroupedProjectList` usage with new `OrganisationGroupedProjectList` for open mode
- Maintain existing error handling, loading state, and retry patterns

## Out of Scope
- No changes to Create Project modal in this iteration
- No changes to Save As modal in this iteration
- No backend API schema changes (frontend adapts to existing fields)
- No "Unassigned Organisation" bucket for projects without an organisation
- No filtering or search functionality within the Open modal
- No drag-and-drop or project reorganization features
- No persistence of expand/collapse state between modal sessions
- No keyboard navigation enhancements beyond existing behavior
- No organisation creation or management from within the Open modal
- No changes to project deletion or other project management features
