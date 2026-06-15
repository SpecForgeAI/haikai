# Meta-model View Enhancements - Specification

## Overview

Five enhancements to the Meta-model view in v0.1:
1. Services grid: allow both Application and App Component selection with automatic inference and validation
2. Table rows area should always fill viewport height with grey background and scrolling
3. Autocomplete dropdown positioning based on cell position (top half vs bottom half)
4. Autocomplete search by id as well as name, with display format showing both
5. Two-row header distinguishing Entities vs Relationships tabs

## Problem Statement

The current Meta-model view has several limitations:
- Services grid only allows Application selection, not App Component
- No automatic inference of Application from App Component parent
- No validation that Application matches App Component's parent
- Table rows area collapses when few/no rows, making autocomplete dropdowns clip off-screen
- Autocomplete dropdowns always appear below cell, clipping for rows near bottom
- FK typeahead only searches by name, not by id
- Single header row with all entity tabs, no clear separation of Entities vs Relationships

## Requirements

### 1. Services Grid: Editable Fields with Automatic Inference and Validation

#### Schema Changes

Update `Service` interface to include optional `app_component_id`:

```typescript
interface Service {
  id: string;             // Unique identifier (required)
  name: string;           // Display name (required)
  description: string;    // Optional description
  application_id: string; // FK to Application (optional in v0.1)
  app_component_id?: string; // FK to AppComponent (optional)
  service_type: string;   // e.g., "REST", "SOAP", "gRPC"
  tags: string;           // Comma-separated tags
}
```

#### Services Grid Configuration

Update Services Grid columns:

| Column | Field | Type | Required |
|--------|-------|------|----------|
| ID | id | Text (auto-gen) | Yes |
| Name | name | Text | Yes |
| Description | description | Text | No |
| Application | application_id | FK Typeahead (Applications) | No |
| App Component | app_component_id | FK Typeahead (App Components) | No |
| Service Type | service_type | Dropdown | No |
| Tags | tags | Tags | No |

Both Application and App Component are now optional and editable.

#### Automatic Application Inference

When the user selects an Application Component:

```typescript
function onAppComponentSelected(service: Service, selectedComponentId: string, model: ArchitectureModel) {
  // Look up the component
  const component = model.metaModel.entities.app_components
    .find(c => c.id === selectedComponentId);

  if (component && component.application_id) {
    // Auto-fill the Application field
    service.application_id = component.application_id;
  }
}
```

This should happen immediately after a valid component is selected (on select, not on blur).

#### Validation Rule: Application-Component Consistency

Add validation rule for services (enforced on Save, ideally also on cell blur):

```typescript
function validateServiceApplicationConsistency(
  service: Service,
  model: ArchitectureModel
): ValidationError | null {
  // If no app_component_id, no validation needed
  if (!service.app_component_id) {
    return null;
  }

  // Look up the component
  const component = model.metaModel.entities.app_components
    .find(c => c.id === service.app_component_id);

  if (!component) {
    // Component not found - this is a separate FK validation error
    return null;
  }

  const parentAppId = component.application_id;

  // If service has application_id and it doesn't match component's parent
  if (service.application_id && service.application_id !== parentAppId) {
    return {
      entityType: 'services',
      entityId: service.id,
      field: 'application_id',
      message: 'Service Application must match the parent Application of the selected Application Component.'
    };
  }

  return null;
}
```

**Validation Behavior:**
- Row marked as invalid with red highlighting
- Clear error message displayed
- Cannot save JSON while mismatch exists
- If `app_component_id` is empty: no additional validation
- If both `application_id` and `app_component_id` are empty: allowed

### 2. Table Rows Area: Full Viewport Height with Grey Background

#### Current Behavior
- Rows area collapses with few/no rows
- Cannot see table space
- Autocomplete dropdowns clip off-screen

#### Required Behavior

**Visual Layout:**
```
+------------------------------------------------------------------+
|  [+ Add Row]                                        [Delete Row]  |
+------------------------------------------------------------------+
|  Column1   |  Column2   |  Column3   |  Column4   |  Column5     |  <- Header
+------------------------------------------------------------------+
|                                                                  |
|         Grey background area that fills viewport height          |
|                                                                  |
|  (data rows here, scrollable when many)                          |
|                                                                  |
|  (even when zero rows, this area remains visible)                |
|                                                                  |
+------------------------------------------------------------------+
```

**Requirements:**
- Rows area MUST fill remaining vertical space below header(s) and above any footer
- Visible height extends to viewport bottom
- Background color: light grey (e.g., `#f5f5f5` or `#e0e0e0`)
- When zero rows: blank grey area still visible
- When many rows: vertically scrollable within this fixed-height container
- Applies to all tabs (entities and relationships)
- Grid height does NOT shrink as rows are deleted

**CSS Implementation Approach:**
```css
.rowsContainer {
  flex: 1;
  overflow-y: auto;
  background-color: #f5f5f5;
  min-height: 200px; /* Minimum even when empty */
}
```

### 3. Autocomplete Dropdown Positioning

#### Current Behavior
- Dropdown always appears below the cell
- For cells near bottom, dropdown is clipped

#### Required Behavior

Compute dropdown position based on cell's vertical position:

```typescript
function getDropdownPosition(
  cellRect: DOMRect,
  rowsContainerRect: DOMRect
): 'below' | 'above' {
  // Calculate midpoint of visible rows area
  const containerMidY = rowsContainerRect.top + (rowsContainerRect.height / 2);

  // Cell center position
  const cellCenterY = cellRect.top + (cellRect.height / 2);

  // If cell is in top half, show dropdown below
  // If cell is in bottom half, show dropdown above
  return cellCenterY < containerMidY ? 'below' : 'above';
}
```

**Dropdown Positioning:**

When position is **'below'** (cell in top half):
- Dropdown renders below the cell
- Top of dropdown = bottom of cell + small gap
- This is current behavior

When position is **'above'** (cell in bottom half):
- Dropdown renders above the cell
- Bottom of dropdown = top of cell - small gap
- Dropdown still constrained to rows container

**Combined with Full-Height Rows Area:**
- Autocomplete options always visible
- Never clipped off-screen
- Works for both top and bottom positions

### 4. Autocomplete Search and Display: Match by ID or Name

#### Current Behavior
- FK typeahead searches only by entity name
- Displays only name in dropdown

#### Required Behavior

**Search Matching:**

For all FK typeahead columns:

```typescript
function filterOptions(
  options: Array<{ id: string; name: string }>,
  searchText: string
): Array<{ id: string; name: string }> {
  const search = searchText.toLowerCase();

  return options.filter(option =>
    option.name.toLowerCase().includes(search) ||
    option.id.toLowerCase().includes(search)
  );
}
```

**Display Format in Dropdown:**

Show both name and id for each option:

```
+--------------------------------+
| Risk System (app_risk)         |
| OMS System (app_oms)           |
| Trade Capture (app_trade)      |
+--------------------------------+
```

Format: `"{name} ({id})"`

If name is empty/missing: show just `"{id}"`

**Selection Behavior:**
- Cell stores only the `id` in the underlying JSON
- Cell display (when not editing) shows `name` if present, otherwise `id`

**Apply to All FK Typeahead Columns:**
- Applications
- App Components
- Users
- Processes
- Logical Entities
- Physical Entities
- All relationship source/target fields

### 5. Meta-model View: Two Header Rows for Entities vs Relationships

#### Current Behavior
- Single header row with all entity tabs
- Relationships accessible separately or not exposed as first-class tabs

#### Required Behavior

**Visual Layout:**

```
+------------------------------------------------------------------+
| Entities:      [Users] [Processes] [Applications] [App Components] |
|                [Services] [App Points] [Logical Entities] ...      |
+------------------------------------------------------------------+
| Relationships: [User ↔ Process] [App Point ↔ Process] [Logical ER] |
|                [Logical ↔ Physical Entities] [Data Movements] ...  |
+------------------------------------------------------------------+
|  Column1   |  Column2   |  Column3   |  ...                       |
+------------------------------------------------------------------+
|                        (data rows area)                           |
+------------------------------------------------------------------+
```

**First Header Row (Entities):**
- Label on left: "Entities:"
- Tab buttons for each entity table:
  - [Users]
  - [Processes]
  - [Applications]
  - [App Components]
  - [Services]
  - [Application Points]
  - [Logical Entities]
  - [Logical Attributes]
  - [Physical Entities]
  - [Physical Attributes]

**Second Header Row (Relationships):**
- Label on left: "Relationships:"
- Tab buttons for each relationship table:
  - [User ↔ Process]
  - [App Point ↔ Process]
  - [Logical ER]
  - [Logical ↔ Physical Entities]
  - [Logical ↔ Physical Attributes]
  - [Data Movements]

**Tab Behavior:**
- Only ONE tab is active at any time (either entity or relationship)
- Clicking an entity tab shows that entity's data in the grid
- Clicking a relationship tab shows that relationship array in the grid
- Active tab clearly highlighted (distinct background/border)
- All other tabs in non-active state

**Relationship Tab Data Sources:**

| Tab Label | Array in Model |
|-----------|----------------|
| User ↔ Process | metaModel.relationships.business_user_processes |
| App Point ↔ Process | metaModel.relationships.application_point_business_processes |
| Logical ER | metaModel.relationships.logical_data_entity_relationships |
| Logical ↔ Physical Entities | metaModel.relationships.logical_data_entity_physical_data_entities |
| Logical ↔ Physical Attributes | metaModel.relationships.logical_data_attribute_physical_data_attributes |
| Data Movements | metaModel.relationships.data_movements |

**Visual Grouping:**
- Both header rows visually grouped with the grid
- Clear visual connection showing they control the same table
- Consistent styling between the two rows

## Implementation Changes

### Files to Modify

1. **`frontend/src/types/model.ts`**
   - Add `app_component_id?: string` to Service interface (if not already present)

2. **`frontend/src/utils/validation.ts`**
   - Add `validateServiceApplicationConsistency()` function
   - Integrate into save validation

3. **`frontend/src/components/MetaModelView/MetaModelView.tsx`**
   - Add second header row for Relationships
   - Update tab state management to handle both entity and relationship tabs
   - Style the two-row header layout

4. **`frontend/src/components/Grid/Grid.tsx`**
   - Update rows container to fill viewport height
   - Add grey background styling
   - Ensure scrollable behavior

5. **`frontend/src/components/Grid/TypeaheadCell.tsx`**
   - Update search to match both id and name
   - Update dropdown display format to show "name (id)"
   - Implement dropdown positioning logic (above/below based on cell position)
   - Add auto-inference for Service Application when App Component selected

6. **`frontend/src/components/MetaModelView/MetaModelView.module.css`** (or similar)
   - Style the two header rows
   - Style the full-height rows container with grey background

7. **`frontend/src/config/defaults.ts`**
   - Add Services grid configuration with App Component column

### Grid Configuration Updates

**Services Grid (updated):**

```typescript
const servicesGridConfig = {
  columns: [
    { key: 'id', label: 'ID', type: 'text', required: true, autoGen: true },
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'description', label: 'Description', type: 'text', required: false },
    { key: 'application_id', label: 'Application', type: 'fk-typeahead', target: 'applications', required: false },
    { key: 'app_component_id', label: 'App Component', type: 'fk-typeahead', target: 'app_components', required: false },
    { key: 'service_type', label: 'Service Type', type: 'dropdown', options: serviceTypeOptions, required: false },
    { key: 'tags', label: 'Tags', type: 'tags', required: false },
  ],
  onFieldChange: (row, field, value, model) => {
    if (field === 'app_component_id' && value) {
      // Auto-infer application from component
      const component = model.metaModel.entities.app_components.find(c => c.id === value);
      if (component?.application_id) {
        row.application_id = component.application_id;
      }
    }
  }
};
```

### Validation Updates

Add to existing validation flow:

```typescript
function validateModel(model: ArchitectureModel): ValidationError[] {
  const errors: ValidationError[] = [];

  // ... existing validation ...

  // Service application-component consistency
  for (const service of model.metaModel.entities.services) {
    const error = validateServiceApplicationConsistency(service, model);
    if (error) {
      errors.push(error);
    }
  }

  return errors;
}
```

## Acceptance Criteria

### 1. Services Grid

- [ ] Both Application and App Component columns are visible and editable
- [ ] Both columns use FK typeahead behavior
- [ ] Selecting an App Component with a parent Application auto-fills Application column
- [ ] Setting an Application that doesn't match component's parent shows validation error
- [ ] Validation error prevents save
- [ ] Empty App Component allows any Application (no error)
- [ ] Both empty is allowed

### 2. Rows Area Height

- [ ] Rows area fills remaining viewport height below headers
- [ ] Rows area has light grey background
- [ ] Rows area visible even with zero rows
- [ ] Rows area scrolls when many rows
- [ ] Applies to all tabs (entities and relationships)
- [ ] Grid height doesn't shrink when rows deleted

### 3. Autocomplete Positioning

- [ ] Cell in top half of rows area: dropdown appears below
- [ ] Cell in bottom half of rows area: dropdown appears above
- [ ] Dropdown never clipped off-screen
- [ ] All autocomplete options visible

### 4. Autocomplete Search and Display

- [ ] Typing part of name shows matching options
- [ ] Typing part of id shows matching options
- [ ] Both search criteria are case-insensitive
- [ ] Dropdown items display "name (id)" format
- [ ] Selected value stores only id
- [ ] Cell display shows name when available

### 5. Two-Row Header

- [ ] First row labeled "Entities:" with entity tabs
- [ ] Second row labeled "Relationships:" with relationship tabs
- [ ] Only one tab active at a time
- [ ] Clicking entity tab shows entity data
- [ ] Clicking relationship tab shows relationship data
- [ ] Active tab clearly highlighted
- [ ] Both rows visually grouped with grid

### Visual Verification

**Services Grid Test:**
1. Add new service row
2. Select an App Component that has a parent Application
3. Verify Application column auto-fills
4. Manually change Application to a different value
5. Verify validation error appears
6. Verify save is blocked

**Rows Area Test:**
1. Select any tab
2. Delete all rows
3. Verify grey rows area remains visible and fills viewport
4. Add rows until scrolling is needed
5. Verify scrolling works within fixed-height container

**Autocomplete Position Test:**
1. Add many rows to cause scrolling
2. Edit FK field in a row near the top
3. Verify dropdown appears below cell
4. Edit FK field in a row near the bottom
5. Verify dropdown appears above cell

**Autocomplete Search Test:**
1. In any FK field, type part of an entity name
2. Verify matching options shown
3. Clear and type part of an entity id
4. Verify matching options shown
5. Verify dropdown displays "name (id)" format
6. Select an option and verify correct id stored

**Header Rows Test:**
1. Open Meta-model view
2. Verify two header rows visible
3. Click entity tabs, verify data changes
4. Click relationship tabs, verify relationship data shown
5. Verify only one tab active at a time

## Out of Scope

- Filtering App Components dropdown by selected Application
- Cascade clearing of App Component when Application changes
- Auto-sizing rows area based on content
- Horizontal scrolling for rows
- Tab reordering or customization
- Relationship grid configurations (beyond what's in existing spec)

## Testing

### Test 1: Services Auto-Inference

1. Load model with Applications and App Components
2. Add new service row
3. Select App Component with parent Application
4. Verify Application auto-fills
5. Save and reload
6. Verify both values persisted

### Test 2: Services Validation

1. Load model with services
2. Set App Component to one value
3. Manually set Application to non-matching value
4. Verify validation error shown
5. Try to save
6. Verify save blocked with error message
7. Fix mismatch
8. Verify save succeeds

### Test 3: Rows Area Height

1. Delete all rows from an entity tab
2. Verify rows area still visible with grey background
3. Resize browser window
4. Verify rows area adjusts to fill viewport
5. Add rows until overflow
6. Verify scrolling enabled

### Test 4: Autocomplete Dropdown Position

1. Add 20+ rows to cause scrolling
2. Scroll to top
3. Edit FK in first row
4. Verify dropdown appears below
5. Scroll to bottom
6. Edit FK in last visible row
7. Verify dropdown appears above

### Test 5: Autocomplete Search

1. Edit FK field
2. Type entity name substring
3. Verify filtered results
4. Clear and type id substring
5. Verify filtered results
6. Verify display format is "name (id)"
7. Select option
8. Verify stored value is id only

### Test 6: Header Rows

1. Open Meta-model view
2. Verify two header rows present
3. Click through all entity tabs
4. Verify correct data displayed
5. Click through all relationship tabs
6. Verify correct relationship data displayed
7. Verify active tab styling

### Test 7: Round-Trip

1. Load model with services having app_component_id
2. Verify both columns display correctly
3. Save model
4. Reload
5. Verify all values preserved

## Key Constants

These values are fixed for v0.1:

- **Rows area background color:** #f5f5f5 (light grey)
- **Rows area minimum height:** 200px
- **Dropdown max items:** 10
- **Autocomplete display format:** "{name} ({id})"
