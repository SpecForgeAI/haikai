# Specification: Relationship Temporal Columns in Meta-Model Grids

## Goal

Expose the `valid_from` and `valid_to` temporal fields in the Meta-model relationship grids so users can edit them from the UI. These fields already exist in the TypeScript interfaces (added in the previous time-based relationships spec); this spec surfaces them in the grid columns.

## User Stories

- As an architect, I want to set validity periods on relationships in the Meta-model grids so I can model changes over time.
- As a user, I want to edit `valid_from` and `valid_to` directly in the relationship tables so I don't need to manually edit JSON.
- As a user, I want my temporal edits to persist when saving and loading the model.

## Design Principle

**Minimal UI change - leverage existing patterns.**

- Use the same column configuration pattern already used for entities
- Use simple text input cells (same as existing temporal columns on entities)
- No new components required - only grid configuration changes

## Current State

### Temporal Fields Already in Model

From the previous time-based relationships implementation, all relationship interfaces in `model.ts` now have:
```typescript
valid_from?: string;  // Format: "YYYY-Qn" (e.g., "2026-Q2")
valid_to?: string;    // Format: "YYYY-Qn" (e.g., "2026-Q2")
```

### Grid Configurations

Located in `frontend/src/config/gridConfigs.ts`:

| Relationship Type | Grid Tab Name | Has Temporal Columns |
|---|---|---|
| `business_user_processes` | User <-> Process | No |
| `application_point_business_processes` | App Point <-> Process | No |
| `logical_data_entity_relationships` | Logical ER | No |
| `logical_data_entity_physical_data_entities` | Logical <-> Physical Entities | No |
| `logical_data_attribute_physical_data_attributes` | Logical <-> Physical Attributes | No |
| `data_movements` | Data Movements | **Yes** (already has columns) |

### Existing Temporal Column Pattern

The `data_movements` grid already includes temporal columns:
```typescript
{ field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
{ field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
```

Entity grids (e.g., `business_processes`, `applications`) also use this exact pattern.

## Specific Requirements

### 1. Add Temporal Columns to Relationship Grids

Add `valid_from` and `valid_to` columns to the following relationship grids in `gridConfigs.ts`:

#### 1.1 business_user_processes

Current columns: `[ID, Business User, Business Process, Description, Tags]`

Updated columns: `[ID, Business User, Business Process, Description, Valid From, Valid To, Tags]`

```typescript
business_user_processes: [
  { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 100, autoGenerate: true },
  { field: 'business_user_id', displayName: 'Business User', cellType: 'fk_typeahead', required: true, width: 180, fkTarget: 'business_users' },
  { field: 'business_process_id', displayName: 'Business Process', cellType: 'fk_typeahead', required: true, width: 180, fkTarget: 'business_processes' },
  { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 200 },
  { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
  { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
  { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 130 },
],
```

#### 1.2 application_point_business_processes

Current columns: `[ID, Application Point, Business Process, Description, Tags]`

Updated columns: `[ID, Application Point, Business Process, Description, Valid From, Valid To, Tags]`

```typescript
application_point_business_processes: [
  { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 100, autoGenerate: true },
  { field: 'application_point_id', displayName: 'Application Point', cellType: 'fk_typeahead', required: true, width: 200, fkTarget: 'application_points' },
  { field: 'business_process_id', displayName: 'Business Process', cellType: 'fk_typeahead', required: true, width: 200, fkTarget: 'business_processes' },
  { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 200 },
  { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
  { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
  { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 130 },
],
```

#### 1.3 logical_data_entity_relationships

Current columns: `[ID, Source Entity, Target Entity, Type, Description, Tags]`

Updated columns: `[ID, Source Entity, Target Entity, Type, Description, Valid From, Valid To, Tags]`

```typescript
logical_data_entity_relationships: [
  { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 100, autoGenerate: true },
  { field: 'source_entity_id', displayName: 'Source Entity', cellType: 'fk_typeahead', required: true, width: 180, fkTarget: 'logical_data_entities' },
  { field: 'target_entity_id', displayName: 'Target Entity', cellType: 'fk_typeahead', required: true, width: 180, fkTarget: 'logical_data_entities' },
  { field: 'relationship_type', displayName: 'Type', cellType: 'dropdown', required: false, width: 120, options: [...] },
  { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 200 },
  { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
  { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
  { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 130 },
],
```

#### 1.4 logical_data_entity_physical_data_entities

Current columns: `[ID, Logical Entity, Physical Entity, Description, Tags]`

Updated columns: `[ID, Logical Entity, Physical Entity, Description, Valid From, Valid To, Tags]`

```typescript
logical_data_entity_physical_data_entities: [
  { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 100, autoGenerate: true },
  { field: 'logical_entity_id', displayName: 'Logical Entity', cellType: 'fk_typeahead', required: true, width: 200, fkTarget: 'logical_data_entities' },
  { field: 'physical_entity_id', displayName: 'Physical Entity', cellType: 'fk_typeahead', required: true, width: 200, fkTarget: 'physical_data_entities' },
  { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 200 },
  { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
  { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
  { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 130 },
],
```

#### 1.5 logical_data_attribute_physical_data_attributes

Current columns: `[ID, Logical Attribute, Physical Attribute, Description, Tags]`

Updated columns: `[ID, Logical Attribute, Physical Attribute, Description, Valid From, Valid To, Tags]`

```typescript
logical_data_attribute_physical_data_attributes: [
  { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 100, autoGenerate: true },
  { field: 'logical_attribute_id', displayName: 'Logical Attribute', cellType: 'fk_typeahead', required: true, width: 200, fkTarget: 'logical_data_attributes' },
  { field: 'physical_attribute_id', displayName: 'Physical Attribute', cellType: 'fk_typeahead', required: true, width: 200, fkTarget: 'physical_data_attributes' },
  { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 200 },
  { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
  { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
  { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 130 },
],
```

#### 1.6 data_movements (Already Has Columns)

The `data_movements` grid already includes temporal columns. No changes needed.

### 2. Column Behaviour

#### 2.1 Input Type

- Use `cellType: 'text'` (simple text input)
- Same component as `name`, `description`, and existing temporal columns on entities

#### 2.2 Field Binding

- `field: 'valid_from'` binds to the `valid_from` property on the relationship object
- `field: 'valid_to'` binds to the `valid_to` property on the relationship object

#### 2.3 Optional Field Handling

- `required: false` - both columns are optional
- Empty cell → field remains `undefined` in the relationship object
- Non-empty cell → field is set to the entered string value

#### 2.4 Value Format

- Expected format: `"YYYY-Qn"` (e.g., `"2024-Q1"`, `"2026-Q3"`)
- For v0.x: No validation - accept any string value
- Future enhancement: Add format validation with warning (not blocking)

### 3. Data Persistence

#### 3.1 Save to JSON

When the model is saved:
- `valid_from` and `valid_to` values are serialized as part of each relationship object
- Empty/undefined values are omitted from JSON (standard JSON serialization behaviour)

#### 3.2 Load from JSON

When the model is loaded:
- `valid_from` and `valid_to` values are read into the relationship objects
- These values populate the grid columns automatically (existing data binding)

**Note:** This should already work correctly due to:
1. The TypeScript interfaces already have these fields
2. The `UPDATE_RELATIONSHIP` reducer action uses spread operator to preserve all fields
3. JSON serialization/deserialization is already in place

### 4. Interaction with Diagram Filtering

#### 4.1 Existing Filtering Logic

The time-based filtering implemented in the previous spec:
- Uses `isRelationshipVisibleInPeriod()` to check relationship validity
- Uses `isEntityVisibleInPeriod()` to check endpoint entity validity
- Filters edges in `getEdgesForDiagram()` based on `viewQuarter`

#### 4.2 Expected Behaviour After This Change

After editing temporal fields in the Meta-model grids:
1. The in-memory relationship data is updated immediately
2. Switching to Diagram view and changing the view quarter reflects the temporal changes
3. Saving and reloading preserves the temporal values

**No changes to filtering logic are required** - it already reads from the relationship objects.

## Implementation Approach

### Single File Change

This spec requires changes to only one file:

**`frontend/src/config/gridConfigs.ts`**

Add two columns to 5 relationship grid configurations:
```typescript
{ field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
{ field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
```

### No Component Changes Required

- `RelationshipGrid.tsx` already handles arbitrary columns from config
- `GridCell.tsx` already supports `'text'` cell type
- `ArchitectureContext.tsx` reducer already preserves all fields on update

## Acceptance Criteria

### Grid Columns
- [ ] `business_user_processes` grid has "Valid From" and "Valid To" columns
- [ ] `application_point_business_processes` grid has "Valid From" and "Valid To" columns
- [ ] `logical_data_entity_relationships` grid has "Valid From" and "Valid To" columns
- [ ] `logical_data_entity_physical_data_entities` grid has "Valid From" and "Valid To" columns
- [ ] `logical_data_attribute_physical_data_attributes` grid has "Valid From" and "Valid To" columns
- [ ] `data_movements` grid continues to have "Valid From" and "Valid To" columns (no change)

### Editing Behaviour
- [ ] Editing "Valid From" updates `valid_from` in the relationship data
- [ ] Editing "Valid To" updates `valid_to` in the relationship data
- [ ] Empty cells leave the field undefined
- [ ] Non-empty cells set the field to the entered string

### Data Persistence
- [ ] Saving JSON includes `valid_from` and `valid_to` when set
- [ ] Loading JSON populates the grid columns with saved values
- [ ] Round-trip (save then load) preserves temporal values

### Diagram Integration
- [ ] Temporal changes affect edge visibility in diagrams
- [ ] Setting `valid_to` to a past quarter hides the edge at current view date
- [ ] Setting `valid_from` to a future quarter hides the edge at current view date

### No Regressions
- [ ] Existing relationship editing functionality works unchanged
- [ ] Other relationship columns continue to work correctly
- [ ] Adding new relationships works correctly

## Out of Scope

- Format validation for `valid_from` / `valid_to` values
- Date picker UI for temporal columns
- Visual indicators for temporally-filtered relationships
- Bulk editing of temporal fields

## Testing Strategy

### Unit Tests
- Test that grid configs include temporal columns for all relationship types
- Test that column definitions match expected structure

### Integration Tests
- Test editing temporal fields updates relationship data
- Test JSON save/load preserves temporal values
- Test diagram filtering reflects temporal changes

## Files to Modify

| File | Purpose |
|------|---------|
| `frontend/src/config/gridConfigs.ts` | Add temporal columns to 5 relationship grid configs |

## TypeScript Types (No Changes)

The relationship interfaces already have temporal fields from the previous spec:
```typescript
// Already in model.ts
interface BusinessUserProcess {
  // ... existing fields ...
  valid_from?: string;
  valid_to?: string;
}
// Same for other relationship types
```

No type changes required.
