# Specification: UX and Validation Refinements

## Goal
Improve user experience and data quality in the Meta-model view and Diagram right-hand panel through four targeted refinements: fixing the Application Point dropdown display, enforcing name uniqueness validation, simplifying palette item display, and collapsing palette sections by default.

## User Stories
- As an architect, I want the Application Point dropdown to show meaningful labels instead of IDs so that I can quickly identify and select the correct entity.
- As a user, I want validation warnings when I enter duplicate names within a table so that I avoid accidental naming conflicts.
- As a user, I want the right-hand palette to show clean, single-line item names so that I can quickly scan available entities.
- As a user, I want palette sections collapsed by default so that the panel is not cluttered when I first open a diagram.

## Specific Requirements

### 1. Application Point Dropdown Contents and Label Fix

**1.1 Dropdown Contents**
- In the Relationships tab "App Point <-> Process", the "Application Point" FK dropdown (`application_point_id` field) must list ONLY Application Point records
- No Application, App Component, or Service rows should appear directly in this dropdown
- The stored FK value remains `application_point.id` unchanged

**1.2 Dropdown Display Format**
- Each option in the dropdown must be displayed as: `<Application Point Name> (<entity type>)`
- The `<entity type>` label is derived from the Application Point's `kind` field:
  - `kind='APPLICATION'` → displays as "(Application)"
  - `kind='APP_COMPONENT'` → displays as "(Application Component)"
  - `kind='SERVICE'` → displays as "(Service)"
- Example dropdown options:
  - "OMS System (Application)"
  - "Risk System (Application)"
  - "Pricing UI (Application Component)"
  - "Risk Pricing Service (Service)"
- Internal IDs must NOT appear in this dropdown

**1.3 Search/Typeahead Behaviour**
- The typeahead filter must allow searching by:
  - Application Point name (partial match)
  - Entity type label (e.g., typing "Application" matches all APPLICATION kind points)
- Searching by ID is no longer supported for this dropdown

**1.4 Implementation Approach**
- Add a `displayFormatter` option to the `fk_typeahead` cell type configuration
- For `application_point_id` fields, use a custom formatter that:
  1. Looks up the Application Point by ID
  2. Returns `${applicationPoint.name} (${kindLabel})` where kindLabel maps kind to human-readable label
- Update the typeahead filter logic to search against the formatted display string

### 2. Duplicate Name Validation per Entity/Relationship Type

**2.1 Uniqueness Rule**
- For each entity or relationship table, the `name` field must be unique within that table
- Uniqueness check is case-insensitive (e.g., "Risk" and "risk" are considered duplicates)
- When a user creates or edits a row with a name that duplicates an existing row's name in the same table:
  - Display a validation warning: "Name must be unique within this table"
  - Prevent the row from being saved/committed until the conflict is resolved
  - Highlight the field with a red underline or error styling

**2.2 Cross-Table Duplicates Allowed**
- The uniqueness rule applies per table, not globally
- It is acceptable to have the same name across different entity types
- Example allowed: Application named "Risk", App Component named "Risk", Service named "Risk"

**2.3 Explicit Exceptions (No Uniqueness Required)**
- The following tables allow duplicate names without validation warnings:
  - `logical_data_attributes` (Logical Attributes)
  - `physical_data_attributes` (Physical Attributes)
  - `physical_data_entities` (Physical Entities)
- Rationale: These tables often contain legitimately repeated names (e.g., multiple "id" or "created_at" attributes)

**2.4 Implementation Approach**
- Add a `validateUniqueName()` function in `validation.ts`
- Check is performed client-side within the in-memory model on edit/add operations
- Add a new validation error type: `'duplicate_name'`
- Integrate with existing `getCellValidationError()` for grid cell display
- The validation function receives the table name and checks if it's in the exception list before validating

### 3. Right-Hand Diagram Panel: Show Name Only

**3.1 Current Behaviour (To Change)**
- Items in the diagram's right-hand palette panel currently display:
  ```
  <name>
  (<id>)
  ```
  i.e., name and ID on separate lines

**3.2 New Behaviour**
- Each palette item displays only the name on a single line:
  ```
  <name>
  ```
- Examples:
  - "OMS System"
  - "Risk System"
  - "VaR Interrogation and Reporting"
- IDs remain internal and must not be shown in the UI
- Long names should truncate with ellipsis but remain on a single line

**3.3 Implementation Approach**
- In `PaletteItem.tsx`, remove the `<div className={styles.id}>({item.id})</div>` element
- Keep only the name div
- Update CSS to handle text overflow with ellipsis if needed

### 4. Right-Hand Panel Sections: Collapsed by Default

**4.1 Current Behaviour (To Change)**
- Sections (e.g., "Applications", "Application Components", "Services", "Processes") may be expanded by default when the diagram view loads

**4.2 New Behaviour**
- When the Diagram view first opens (or when the app loads):
  - All right-hand panel sections must be collapsed by default
  - Only section headers with expand/collapse triangles are visible
- User interaction:
  - Clicking a header or triangle expands that section
  - Expanded/collapsed state can persist within the session
  - Default initial state is always "all collapsed"

**4.3 Implementation Approach**
- In `PalettePanel.tsx` or `DiagramsView.tsx`, update the initial state of `sectionExpandStates`
- Default all section keys to `false` (collapsed)
- Preserve the existing toggle logic for user interaction

## Existing Code to Leverage

**gridConfigs.ts - FK Typeahead Configuration**
- Line 122: `application_point_business_processes` grid config with `application_point_id` field
- Add optional `displayFormatter` property to `GridColumnConfig` type in `types/config.ts`
- Implement formatter lookup in grid FK typeahead rendering logic

**validation.ts - Existing Validation Patterns**
- Lines 17-40: `validateRequiredFields()` pattern for field-level validation
- Lines 80-104: `validateUniqueIds()` as template for `validateUniqueName()`
- Add new error type `'duplicate_name'` to `ValidationError` interface in `types/config.ts`

**PaletteItem.tsx - Item Display**
- Line 51: Remove the ID display element `<div className={styles.id}>({item.id})</div>`
- Line 50: Keep name display `<div className={styles.name}>{item.name}</div>`

**PaletteSection.tsx / PalettePanel.tsx - Section Expand State**
- Update initial state generation to default all sections to collapsed (`false`)
- Current props include `isExpanded` boolean per section

**model.ts - ApplicationPoint Interface**
- `kind: 'APPLICATION' | 'APP_COMPONENT' | 'SERVICE'` field available for display mapping

## Visual Design
No mockups required. Changes are refinements to existing UI patterns:
- Dropdown options follow existing typeahead styling with new label format
- Validation warnings use existing red underline/error tooltip patterns
- Palette items use existing name styling, just without the ID line
- Section collapse/expand uses existing triangle toggle behaviour

## Acceptance Criteria

**Application Point Dropdown:**
- [ ] The "Application Point" dropdown in "App Point <-> Process" tab lists only Application Points
- [ ] Each option displays as `<Name> (<entity type>)` format
- [ ] No IDs are shown in dropdown options
- [ ] Typeahead allows searching by name or entity type label

**Name Uniqueness Validation:**
- [ ] Creating a duplicate name within the same table shows validation warning
- [ ] Validation message reads "Name must be unique within this table"
- [ ] Save/commit is blocked until duplicate is resolved
- [ ] Duplicate names across different tables are allowed (no warning)
- [ ] Logical Attributes, Physical Attributes, and Physical Entities tables allow duplicate names

**Palette Item Display:**
- [ ] Items in right-hand palette show only name on one line
- [ ] No IDs appear below item names
- [ ] Long names truncate with ellipsis

**Palette Section State:**
- [ ] On entering Diagram view, all sections are collapsed by default
- [ ] Only section headers are visible initially
- [ ] User can manually expand sections by clicking
- [ ] Expanded state persists during the session

## Out of Scope
- Changing the stored FK value format (remains `application_point.id`)
- Global name uniqueness across all tables
- Persisting palette section expand/collapse state across sessions
- Customizable exception list for name uniqueness validation
- Internationalization of entity type labels or validation messages
- Batch name conflict resolution UI
- Name uniqueness validation for diagram names (already exists separately)
