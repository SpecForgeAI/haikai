# Requirements: Organisations Iteration 4 — Update Project Save As Modal

## Overview

**Title:** Organisations Iteration 4 — Update Project Save As Modal (Organisation + Project Name + Folder/Hierarchy + Grouped List)

**Context:** Projects are now associated to an Organisation (Organisation 1:M Project). The "Project → Save As" modal is currently out of date: it still uses "Filename" naming and lacks the fields that are now standard in Project Create (Parent Folder, Project Hierarchy). It must be updated to:
- Require Organisation Name (autocomplete, same behavior as Create)
- Rename Filename → Project Name (same underlying value)
- Add Parent Folder and Project Hierarchy fields
- Update the existing project list to match the Open modal grouping: Organisation → Project Hierarchy → Projects

**Goal:** Update the Project Save As modal so saving a project copy is consistent with the new project model:
- Organisation Name is mandatory and determines association
- Project Name uses the existing filename/projectName attribute
- Parent Folder and Project Hierarchy are editable inputs (same semantics as Create)
- Bottom list is grouped by Organisation and hierarchy, like Open modal

## Scope

### In Scope
- Frontend UI only (Save As modal)
- Uses existing Save As backend operation and project listing APIs

### Out of Scope
- No changes to Create/Open modals in this iteration

## UI Changes

### Fields and Order
1. **Organisation Name** (required, autocomplete/combobox)
2. **Project Name** (label change only; wired to existing filename/projectName attribute)
3. **Parent Folder** (required; same component/validation as Create modal)
4. **Project Hierarchy** (optional; same component/behavior as Create modal)
- Existing buttons/actions remain (Save/Cancel)

### Organisation Autocomplete Behavior
- Same as Create modal:
  - Options from GET /api/v1/organisations
  - User may select existing or type a new name
  - On Save, if typed name not found, create organisation via POST /api/v1/organisations then continue
  - Handle 409 by re-fetching list and selecting existing (race-safe)
- Organisation Name is mandatory; Save is disabled until provided

### Validation
- Disable Save until:
  - Organisation Name non-empty
  - Project Name non-empty
  - Parent Folder non-empty
- Show inline validation messages on submit attempt for missing required fields

## Bottom List Grouping

Replace the current flat list with nested collapsible grouping identical to the Open modal:
- **Level 1:** Organisation Name (collapsible, sorted A→Z)
- **Level 2:** Project Hierarchy (collapsible within organisation; includes "No hierarchy")
- **Leaf:** Projects (selectable)

### Selection Behavior
- Selecting a project in the list should populate the form fields to support "Save As" workflows:
  - Project Name default suggestion may be based on selected project name (existing behavior if any)
  - Parent Folder and Project Hierarchy should populate from the selected project (if your current Save As UX does this); otherwise leave unchanged

## Save As Behavior

On clicking Save:
1. **Resolve Organisation:**
   - If selected existing org: use its id
   - If typed new: create org then use its id
2. **Call existing Save As operation, passing:**
   - projectName (same field previously called filename)
   - parentFolder
   - projectHierarchy (optional)
   - organisation association (organisationId preferred; otherwise organisationName per backend support)
3. **On success:**
   - Close modal
   - Refresh project list and active project state as currently done

## Data Requirements

The modal must have access to:
- Organisations list (id + name)
- Project list including organisationName and projectHierarchy

If organisationName is not included in project list API, resolve via organisations list mapping.

## Acceptance Criteria

1. Save As modal shows Organisation Name as first field and it is mandatory
2. "Filename" label is replaced with "Project Name" (same wiring)
3. Parent Folder and Project Hierarchy fields exist and behave like Create modal equivalents
4. Bottom list uses Organisation → Hierarchy → Projects nested collapsible sections
5. User can Save As into an existing organisation or type a new organisation name and Save As creates it and links the saved project
6. Save is disabled until Organisation Name, Project Name, and Parent Folder are provided

## Non-Goals

- No changes to backend Save As contract beyond providing organisation association if already supported
- No changes to Open modal (handled in Iteration 3)
- No UI for editing organisation description
