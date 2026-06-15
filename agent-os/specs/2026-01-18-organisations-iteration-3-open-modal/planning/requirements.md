# Requirements: Organisations Iteration 3 — Update Project Open Modal (Group by Organisation → Project Hierarchy)

## Overview

**Title:** Organisations Iteration 3 — Update Project Open Modal (Group by Organisation → Project Hierarchy)

**Context:** Projects are now associated to an Organisation (Organisation 1:M Project). The Project Open modal currently groups projects by "Project Hierarchy" (and a "No hierarchy" bucket). It must be updated to introduce a new top-level grouping by Organisation Name, with the existing hierarchy grouping nested beneath each organisation.

**Goal:** Update the Project → Open modal so users browse/open projects via a 2-level collapsible tree:
- Level 1: Organisation Name (top-level collapsible sections)
- Level 2: Project Hierarchy group (existing collapsible sections, including "No hierarchy")
- Leaf: Projects (selectable/openable)

## Scope

### In Scope
- Frontend UI only (Open modal)
- Uses existing project listing/open behavior and APIs

### Out of Scope
- No changes to Create or Save As modals in this iteration
- No backend/API schema changes in this iteration (frontend adapts to available fields)

**Assumption:** Projects returned by the backend include organisation association sufficient to display organisation name (either organisationName directly or organisationId resolvable to name)

## Requirements

### Data Requirements for Open List
- The Open modal must have access to, for each project:
  - projectId (or filename identifier used to open)
  - projectName (display)
  - projectHierarchy (string|null)
  - organisationName (string)
- If project list API does not currently provide organisationName, the frontend must:
  - fetch organisations list and map organisationId -> name, OR
  - call a project list endpoint variant that includes organisationName
- Prefer the lowest-latency option available in current API surface

### UI Structure
- Replace the current single-level grouping UI with a nested tree:
  - **Top-level:** one collapsible section per organisationName, sorted A→Z
  - **Within each organisation section:**
    - Second-level collapsible sections:
      - one per projectHierarchy value (sorted A→Z)
      - plus a "No hierarchy" section for null/empty hierarchy
    - Within each hierarchy section:
      - list of projects, sorted A→Z by projectName
- **Collapsible behavior:**
  - Organisation sections can be expanded/collapsed independently
  - Hierarchy sections expand/collapse within an expanded organisation
- **Default expansion:**
  - All organisations collapsed by default
  - Expanding one organisation does not auto-expand its hierarchies
  - Preserve expand/collapse state during modal open session

### Interaction
- Clicking a project row selects it (existing behavior)
- Primary action "Open" opens the selected project (existing behavior)
- Double-click (if supported today) continues to open immediately

### Empty States
- If no projects exist, show the existing empty state message
- If an organisation has no projects, it should not render a section

### Visual Consistency
- Organisation and hierarchy headers should match current styling for collapsible groups
- Clearly indicate nesting (indentation or spacing) between levels

### No Unassigned Handling
- Do not implement an "Unassigned" organisation bucket in this iteration
- User will manually ensure projects are linked to organisations

## Acceptance Criteria
1. Open modal displays projects grouped by Organisation Name at top level
2. Under each organisation, projects are grouped by Project Hierarchy (including "No hierarchy")
3. Selecting and opening a project works as before
4. Organisation name is displayed (not organisation id)
5. Sorting is stable and intuitive (A→Z for organisations, hierarchies, and projects)

## Non-Goals
- No changes to project creation
- No changes to Save As modal
- No backend/API schema changes in this iteration (frontend adapts to available fields)
