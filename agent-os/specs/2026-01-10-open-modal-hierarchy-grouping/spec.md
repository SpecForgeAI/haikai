# Specification: Update Open Project Modal to Use Hierarchy-Collapsible Project List

## Goal
Replace the Open modal's flat file list UI with the same collapsible hierarchy-grouped list component used by the Delete Project modal, ensuring visual and interaction parity.

## User Stories
- As a user, I want to see projects grouped by hierarchy in the Open modal so that I can quickly find projects in large project collections.
- As a user, I want the Open modal to have the same expand/collapse behaviour as the Delete modal for a consistent experience across the application.

## Specific Requirements

**Replace file list rendering with GroupedProjectList component**
- Remove the current flat `.fileList` rendering block (lines 260-278 in ModelFileDialog.tsx)
- Import and use `GroupedProjectList` component from `../Project/GroupedProjectList`
- The component should only render in "open" mode, not "saveAs" mode
- Pass projects data and selection callbacks as props

**Convert ModelFileSummaryDto to ProjectDto for GroupedProjectList**
- GroupedProjectList expects `ProjectDto[]` with `projectHierarchy` field
- Create a mapping function to convert `ModelFileSummaryDto[]` to compatible format
- Map `filename` to `name`, `id` to `id`, `updated_at`/`created_at` to `updatedAt`
- Set `projectHierarchy` to null (files don't have hierarchy) unless hierarchy data is added later

**Update selection state handling**
- Current state uses `selectedFilename: string` for file selection
- GroupedProjectList callback provides `projectId: string` via `onProjectClick`
- Update `handleFileClick` to work with the id-based selection from GroupedProjectList
- Map selected project ID back to filename for the `onConfirm` callback

**Maintain OK button enablement logic**
- OK button should remain disabled until a project is selected
- Current logic: `isOkDisabled = !effectiveFilename` must continue to work
- Ensure selection state correctly drives button state

**Keep "saveAs" mode unchanged**
- GroupedProjectList is only for "open" mode
- "saveAs" mode retains the current flat file list with filename input
- Add conditional rendering to show GroupedProjectList only when `mode === 'open'`

**Update section label text**
- Current label: "Available Files:" in `.fileListLabel`
- Keep existing label for now (or optionally change to "Available Projects:" for consistency)

## Visual Design
No mockups provided. Reference the Delete Project modal (`DeleteProjectModal.tsx`) for the target visual appearance:
- Collapsible sections with chevron expand/collapse icons
- Section headers showing hierarchy name and item count
- Project rows with name (left) and date (right)
- Highlight styling for selected row
- Scroll behaviour within the list panel

## Existing Code to Leverage

**GroupedProjectList component (`frontend/src/components/Project/GroupedProjectList.tsx`)**
- Reusable component that groups projects by `projectHierarchy` value
- Accepts `projects: ProjectDto[]`, `selectedProjectId: string | null`, `onProjectClick: (projectId: string) => void`, and optional `formatDate` function
- Displays "(No hierarchy)" section for projects with null hierarchy
- All sections default to expanded state
- Handles keyboard navigation and accessibility

**GroupedProjectList.module.css styling**
- Contains all styling for sections, headers, chevrons, project rows, and selection states
- Matches DeleteProjectModal visual patterns
- No additional CSS changes needed for the Open modal

**DeleteProjectModal usage pattern (`frontend/src/components/Project/DeleteProjectModal.tsx`)**
- Lines 220-229 show how to integrate GroupedProjectList
- Passes `projects`, `selectedProjectId`, `onProjectClick`, and `formatDate` props
- Handles project click by updating `selectedProjectId` state

**ModelFileSummaryDto interface (`frontend/src/api/modelApi.ts`)**
- Current data shape returned by `fetchModelFilenames()`: `{ id, filename, description?, created_at?, updated_at?, is_default?, tags? }`
- Must be mapped to ProjectDto shape for GroupedProjectList compatibility

**formatDate utility pattern (both modals)**
- Both modals use identical date formatting: `new Date(dateString).toLocaleDateString()`
- Keep the existing `formatDate` function in ModelFileDialog.tsx

## Out of Scope
- Backend API changes to add hierarchy data to model files
- Changes to the "saveAs" mode file list rendering
- Changes to DeleteProjectModal behaviour or styling
- Adding real `projectHierarchy` values to model files (all will be null for now)
- Renaming the modal title from "Open Model" to "Open Project"
- Changes to loading/error state rendering
- Changes to keyboard handling (Enter/Escape)
- Adding multi-select functionality
- Changing the data fetching logic (`fetchModelFilenames` API)
