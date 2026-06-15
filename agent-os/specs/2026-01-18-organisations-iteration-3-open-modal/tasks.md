# Task Breakdown: Organisations Iteration 3 - Update Project Open Modal

## Overview
Total Tasks: 4 Task Groups with 25 sub-tasks

This feature updates the Project Open modal to display projects in a 2-level collapsible tree structure: Organisation Name at the top level, with Project Hierarchy groups nested beneath, enabling users to browse and open projects organized by their owning organisation.

## Task List

### API Layer

#### Task Group 1: Update ProjectDto to Include organisationId
**Dependencies:** None

- [x] 1.0 Complete API layer updates
  - [x] 1.1 Write 2-4 focused tests for organisationId mapping
    - Test `mapProjectFromSnake()` correctly maps `organisation_id` to `organisationId`
    - Test that `organisationId: null` is handled correctly
    - Test that existing ProjectDto fields remain unchanged after mapping
  - [x] 1.2 Add `organisationId` field to `ProjectDto` interface in `projectsApi.ts`
    - Add `organisationId: string | null` field to `ProjectDto`
    - Add `organisation_id: string | null` field to `ProjectDtoSnake`
  - [x] 1.3 Update `mapProjectFromSnake()` function
    - Map `dto.organisation_id` to `organisationId`
    - Handle null values: `organisationId: dto.organisation_id ?? null`
  - [x] 1.4 Ensure API layer tests pass
    - Run ONLY the 2-4 tests written in 1.1
    - Verify TypeScript compilation succeeds
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-4 tests written in 1.1 pass
- `ProjectDto` includes `organisationId: string | null`
- `ProjectDtoSnake` includes `organisation_id: string | null`
- `mapProjectFromSnake()` correctly maps the new field
- TypeScript compilation succeeds without errors

**Files to modify:**
- `frontend/src/api/projectsApi.ts`

---

### Frontend Components

#### Task Group 2: Create OrganisationGroupedProjectList Component
**Dependencies:** Task Group 1

- [x] 2.0 Complete OrganisationGroupedProjectList component
  - [x] 2.1 Write 4-6 focused tests for component functionality
    - Test 2-level grouping: projects grouped by organisation, then by hierarchy within each org
    - Test organisation sections sorted A-Z (case-insensitive)
    - Test "(No hierarchy)" section appears first within each organisation
    - Test projects within hierarchy sections sorted A-Z by name
    - Test expand/collapse state: all orgs collapsed by default
    - Test projects with null organisationId are excluded from rendering
  - [x] 2.2 Create `OrganisationGroupedProjectList.tsx` component file
    - Create file at `frontend/src/components/Project/OrganisationGroupedProjectList.tsx`
    - Define component props interface with: `projects`, `organisationMap`, `selectedProjectId`, `onProjectClick`, `formatDate`
    - Export `OrganisationGroupedProjectList` function component
    - Add JSDoc header comment following pattern from `GroupedProjectList.tsx`
  - [x] 2.3 Implement 2-level grouping data structure with useMemo
    - Level 1: Group projects by `organisationId`, resolve display name via `organisationMap`
    - Level 2: Within each org, group by `projectHierarchy` (reuse logic pattern from `GroupedProjectList`)
    - Filter out projects with null `organisationId`
    - Apply sorting: orgs A-Z, "(No hierarchy)" first within each org, then hierarchies A-Z, projects A-Z
    - Use `localeCompare` with `{ sensitivity: 'base' }` for consistent case-insensitive sorting
  - [x] 2.4 Implement expand/collapse state management
    - Use `Set<string>` for expanded organisation IDs (init empty = all collapsed)
    - Use `Map<string, Set<string>>` for expanded hierarchy keys per organisation
    - Create `toggleOrganisation()` and `toggleHierarchy()` callback functions
    - Expanding organisation does NOT auto-expand child hierarchies
    - Preserve state during modal session (no reset on re-render)
  - [x] 2.5 Render organisation-level sections
    - Render organisation header with chevron, name, and project count
    - Reuse `.sectionHeader` styling pattern from `GroupedProjectList`
    - Add click handler to toggle organisation expand/collapse
    - Add keyboard accessibility (Enter/Space to toggle)
    - Conditionally render hierarchy sections only when organisation is expanded
  - [x] 2.6 Render hierarchy-level sections within expanded organisations
    - Render hierarchy header with chevron, name, and project count
    - Add indentation (16-20px) to visually nest under organisation
    - Add click handler to toggle hierarchy expand/collapse
    - Conditionally render project rows only when hierarchy is expanded
  - [x] 2.7 Render project rows within expanded hierarchies
    - Render project name and formatted date
    - Add indentation (32-40px) to visually nest under hierarchy
    - Reuse `.projectRow`, `.selected`, `.projectName`, `.projectDate` styling
    - Handle selection highlighting when `selectedProjectId` matches
    - Invoke `onProjectClick` callback on row click
  - [x] 2.8 Implement empty state handling
    - Show "No projects available" when projects array is empty
    - Do not render organisation sections with zero projects
    - Reuse `.emptyMessage` styling from `GroupedProjectList`
  - [x] 2.9 Ensure component tests pass
    - Run ONLY the 4-6 tests written in 2.1
    - Verify component renders without errors
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 2.1 pass
- Component groups projects by organisation then hierarchy
- Organisation names display correctly (not IDs)
- Sorting is correct at all levels (orgs A-Z, "(No hierarchy)" first, hierarchies A-Z, projects A-Z)
- Expand/collapse works independently at both levels
- Project selection and click handling works correctly
- Projects with null organisationId are excluded

**Files to create:**
- `frontend/src/components/Project/OrganisationGroupedProjectList.tsx`

---

#### Task Group 3: Create CSS Module and Integrate into ModelFileDialog
**Dependencies:** Task Group 2

- [x] 3.0 Complete CSS and integration
  - [x] 3.1 Write 2-4 focused tests for integration
    - Test ModelFileDialog in 'open' mode fetches both projects and organisations in parallel
    - Test OrganisationGroupedProjectList receives correct props (organisationMap, projects, etc.)
    - Test project selection flow works end-to-end (click project row -> onConfirm receives filename)
    - Test loading and error states still work correctly
  - [x] 3.2 Create `OrganisationGroupedProjectList.module.css` file
    - Create file at `frontend/src/components/Project/OrganisationGroupedProjectList.module.css`
    - Copy base styles from `GroupedProjectList.module.css`
    - Add `.organisationHeader` class with bolder treatment (font-weight: 600)
    - Add `.hierarchyHeader` class with 16-20px left indent
    - Add `.hierarchyProjectRow` class with 32-40px left indent
    - Add visual differentiation (background shade or border-left) for organisation vs hierarchy headers
    - Ensure `.groupedList` max-height and overflow-y match existing styles
  - [x] 3.3 Update `ModelFileDialog.tsx` imports and state
    - Import `OrganisationGroupedProjectList` from `'../Project/OrganisationGroupedProjectList'`
    - Import `listOrganisations`, `OrganisationDto` from `'../../api/organisationsApi'`
    - Add state: `organisations: OrganisationDto[]` with initial value `[]`
    - Add derived state or useMemo for `organisationMap: Map<string, string>` (id -> name mapping)
  - [x] 3.4 Update `loadData()` to fetch organisations in parallel
    - Use `Promise.all([listProjects(), listOrganisations()])` for parallel fetching
    - Destructure results: `[projectList, orgList]`
    - Set both `setProjects(projectList)` and `setOrganisations(orgList)`
    - Maintain existing error handling and loading state patterns
  - [x] 3.5 Build organisation lookup map
    - Create `useMemo` to build `Map<string, string>` from `organisations` array
    - Map `org.id` -> `org.name` for each organisation
    - Pass map to `OrganisationGroupedProjectList` as `organisationMap` prop
  - [x] 3.6 Replace GroupedProjectList with OrganisationGroupedProjectList for open mode
    - In the `mode === 'open'` conditional rendering block, replace `<GroupedProjectList>` with `<OrganisationGroupedProjectList>`
    - Pass props: `projects`, `organisationMap`, `selectedProjectId`, `onProjectClick`, `formatDate`
    - Keep existing `GroupedProjectList` import for potential future use (or remove if not needed elsewhere)
  - [x] 3.7 Ensure integration tests pass
    - Run ONLY the 2-4 tests written in 3.1
    - Verify open modal displays 2-level hierarchy correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-4 tests written in 3.1 pass
- CSS provides clear visual hierarchy (org header -> hierarchy header -> project rows)
- Indentation is correct (0px -> 16-20px -> 32-40px)
- ModelFileDialog fetches projects and organisations in parallel
- Organisation names resolve correctly in the UI
- Existing selection and open functionality works as before

**Files to create:**
- `frontend/src/components/Project/OrganisationGroupedProjectList.module.css`

**Files to modify:**
- `frontend/src/components/file/ModelFileDialog.tsx`

---

### Testing

#### Task Group 4: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 2-4 tests written by API layer (Task 1.1)
    - Review the 4-6 tests written by component layer (Task 2.1)
    - Review the 2-4 tests written by integration layer (Task 3.1)
    - Total existing tests: approximately 8-14 tests
  - [x] 4.2 Analyze test coverage gaps for THIS feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to organisation grouping in the Open modal
    - Do NOT assess entire application test coverage
    - Prioritize end-to-end workflows: user opens modal -> expands org -> expands hierarchy -> selects project -> opens
  - [x] 4.3 Write up to 6 additional strategic tests maximum
    - Add maximum of 6 new tests to fill identified critical gaps
    - Suggested tests if gaps exist:
      - Test organisation with multiple hierarchies renders correctly
      - Test expanding one org does not affect other orgs' expand state
      - Test double-click on project row (if supported) opens immediately
      - Test keyboard navigation through sections (if supported)
      - Test empty organisation (no projects) does not render
      - Test organisation name fallback if org not found in map
    - Do NOT write comprehensive coverage for all scenarios
    - Skip edge cases unless business-critical
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, and 4.3)
    - Expected total: approximately 14-20 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 14-20 tests total)
- Critical user workflows for organisation-grouped Open modal are covered
- No more than 6 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **API Layer (Task Group 1)** - Update ProjectDto to include organisationId
   - Foundation change that other tasks depend on
   - Low risk, isolated to API types and mapping

2. **Component Layer (Task Group 2)** - Create OrganisationGroupedProjectList
   - Core new component with 2-level grouping logic
   - Self-contained, testable independently
   - Follows patterns from existing GroupedProjectList

3. **CSS and Integration (Task Group 3)** - Styling and ModelFileDialog integration
   - Creates CSS module with visual hierarchy
   - Integrates new component into existing modal
   - Adds parallel fetching of organisations

4. **Test Review (Task Group 4)** - Gap analysis and additional tests
   - Reviews all tests written during development
   - Fills critical gaps with strategic tests
   - Final validation of complete feature

---

## Reference Files

**Patterns to reuse:**
- `frontend/src/components/Project/GroupedProjectList.tsx` - Expand/collapse logic, section rendering, project row styling
- `frontend/src/components/Project/GroupedProjectList.module.css` - Base CSS styles for sections, headers, rows
- `frontend/src/api/organisationsApi.ts` - `listOrganisations()` function signature
- `frontend/src/components/file/ModelFileDialog.tsx` - Integration point, `loadData()` pattern

**Key interfaces:**
- `ProjectDto` in `projectsApi.ts` - Add `organisationId: string | null`
- `OrganisationDto` in `organisationsApi.ts` - `{ id, name, description }`

**Visual hierarchy spec:**
- Organisation header: 0px indent, font-weight: 600
- Hierarchy header: 16-20px indent, font-weight: 500
- Project row: 32-40px indent, standard weight
