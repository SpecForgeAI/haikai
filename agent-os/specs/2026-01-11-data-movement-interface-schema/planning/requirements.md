# Spec Requirements: Data Movement Interface Schema

## Initial Description
Extend the Data Movement relationship so it can be defined at either:
- a specific **Data Entity** level (existing behavior), OR
- a higher-level **Interface (with Schema)** level (new behavior - implying multiple valid data movements based on the interface schema)

Also add an explicit **Bi-directional?** flag to capture directionality.

### Rationale
Defining every data movement per entity (table/payload) is overkill for large systems and becomes impractical for diagramming. Selecting an interface whose schema is defined via **Interface <-> Entity** provides a scalable way to represent "many allowed data movements" between a source and target.

## Requirements Discussion

### Codebase Investigation

Based on user's request, the following codebase areas were analyzed:

**Q1:** Current Data Movement relationship implementation
**Findings from gridConfigs.ts (lines 471-483):**
```typescript
data_movements: [
  { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 100, autoGenerate: true },
  { field: 'source_application_point_id', displayName: 'Source App Point', cellType: 'application_point_picker', required: true, width: 180, fkTarget: 'application_points', displayFormatter: applicationPointDisplayFormatter },
  { field: 'target_application_point_id', displayName: 'Target App Point', cellType: 'application_point_picker', required: true, width: 180, fkTarget: 'application_points', displayFormatter: applicationPointDisplayFormatter },
  { field: 'dataEntityPointId', displayName: 'Data Entity', cellType: 'data_entity_point_picker', required: true, width: 160 },
  { field: 'movement_type', displayName: 'Type', cellType: 'dropdown', required: false, width: 100, options: movementTypeOptions },
  { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 120 },
  { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 80 },
  { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
  { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
]
```
- Current `dataEntityPointId` field uses `data_entity_point_picker` cellType
- Field is currently marked as `required: true`
- Uses `dep_log_<entityId>` or `dep_phy_<entityId>` format for data entity references

**Q2:** DataMovementDto.java structure:
```java
public record DataMovementDto(
    String id,
    String sourceApplicationPointId,
    String targetApplicationPointId,
    String dataEntityPointId,  // FK to data_entity_points.id
    String movementType,
    String description,
    String tags,
    String validFrom,
    String validTo
) {}
```

**Q3:** DataMovementEntity.java structure:
```java
@Entity
@Table(name = "data_movements")
public class DataMovementEntity {
    @Column(name = "data_entity_point_id", nullable = false)
    private String dataEntityPointId;
    // ... other fields
}
```
- Database column `data_entity_point_id` is currently `nullable = false`

**Q4:** Interface entity structure and FK patterns
**From InterfaceLogicalEntityDto.java:**
- Uses `interface_id` as FK reference to interfaces
- Uses `dataEntityPointId` for the data entity picker
- Pattern: FK fields use standard naming convention `<entity>_id`

**Q5:** Interface entity relationship (Interface <-> Entity)
**From gridConfigs.ts (lines 453-463):**
```typescript
interface_logical_entities: [
  { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 100, autoGenerate: true },
  { field: 'interface_id', displayName: 'Interface', cellType: 'fk_typeahead', required: true, width: 180, fkTarget: 'interfaces' },
  { field: 'dataEntityPointId', displayName: 'Data Entity', cellType: 'data_entity_point_picker', required: true, width: 180 },
  // ...
]
```
- This relationship defines which data entities belong to an interface's "schema"
- When a Data Movement uses an Interface (with Schema), it implies all entities linked via this relationship

**Q6:** Existing validation patterns (from validation.ts)
- No XOR-style validation currently exists in the codebase
- Validation is field-level (required fields, FK references, duplicate names)
- Validation errors are non-blocking - rows remain visible with error indicators
- Error format: `{ entityType, entityId, entityName, field, message, type }`
- Validation types include: 'required', 'invalid_fk', 'duplicate_id', 'duplicate_name', 'consistency'

**Q7:** XLSX import/export patterns (from excelOperations.ts)
- Export uses display names as column headers
- Boolean fields: `'true'/'yes'/'1'` for true, other for false
- FK reference resolution by ID matching
- Worksheet name for data_movements: `'data_movements'` (key-based naming)
- Non-blocking FK validation during import

**Q8:** Interface reference pattern in existing relationships
**From relationshipDefinitions.ts:**
```typescript
{
  relationshipKey: 'interface_logical_entities',
  displayName: 'Interface <-> Entity',
  endpointEntityTypes: ['interfaces', 'logical_data_entities', 'physical_data_entities', 'data_entity_points'],
}
```

### Existing Code to Reference

**Similar Features Identified:**
- Feature: Interface <-> Entity relationship - Path: `frontend/src/config/gridConfigs.ts` (lines 453-463)
  - Shows pattern for interface FK reference using `fk_typeahead` cellType
- Feature: Data Entity Point picker - Path: `frontend/src/components/Grid/DataEntityPointPickerCell.tsx` (assumed)
  - Shows pattern for unified logical/physical entity selection
- Feature: Boolean column handling - Path: `frontend/src/utils/excelOperations.ts` (line 687)
  - Shows pattern for boolean field conversion in XLSX

**Backend patterns to reference:**
- EntityMapper.java: toDto/toEntity pattern for DataMovement (lines 1397-1431)
- InterfaceLogicalEntityEntity.java: FK reference pattern to interfaces

## Visual Assets

### Files Provided:
No visual assets provided.

## Requirements Summary

### Functional Requirements

#### New Fields for Data Movement Relationship

1. **`interfaceWithSchemaId`** (new field - nullable FK)
   - Field name: `interfaceWithSchemaId`
   - Display name: "Interface (with Schema)"
   - Cell type: `fk_typeahead` with `fkTarget: 'interfaces'`
   - Nullable: YES
   - Purpose: Select an Interface whose schema (defined by Interface <-> Entity relationships) represents the allowed data movements

2. **`biDirectional`** (new field - boolean)
   - Field name: `biDirectional`
   - Display name: "Bi-directional?"
   - Cell type: `boolean` (checkbox)
   - Default: `false`
   - Purpose: If true, movement applies in both directions (Source <-> Target)

#### XOR Validation Rule

For each Data Movement row, enforce:
- Exactly ONE of `dataEntityPointId` OR `interfaceWithSchemaId` must be set
- Both set -> validation error: "Data Movement must specify either Data Entity OR Interface (with Schema), not both"
- Neither set -> validation error: "Data Movement requires either Data Entity or Interface (with Schema)"
- Validation must be **non-blocking**: row remains visible, error displayed in UI

#### UI Behavior Options (to be confirmed)

**Option A - Clear-on-Select (Recommended):**
- When user selects `interfaceWithSchemaId` and `dataEntityPointId` is already set:
  - Clear `dataEntityPointId` automatically
  - Show brief inline hint: "Cleared Data Entity (use one or the other)"
- When user selects `dataEntityPointId` and `interfaceWithSchemaId` is already set:
  - Clear `interfaceWithSchemaId` automatically
  - Show brief inline hint: "Cleared Interface (use one or the other)"

**Option B - Validation-Only:**
- Allow both fields to be temporarily set
- Show immediate validation error on the row
- User must manually clear one field

### Technical Requirements

#### Frontend Changes

**1. gridConfigs.ts - Update data_movements configuration:**
```typescript
data_movements: [
  { field: 'id', ... },
  { field: 'source_application_point_id', ... },
  { field: 'target_application_point_id', ... },
  { field: 'dataEntityPointId', displayName: 'Data Entity', cellType: 'data_entity_point_picker', required: false, width: 160 },  // Change required to false
  { field: 'interfaceWithSchemaId', displayName: 'Interface (with Schema)', cellType: 'fk_typeahead', required: false, width: 180, fkTarget: 'interfaces' },
  { field: 'biDirectional', displayName: 'Bi-directional?', cellType: 'boolean', required: false, width: 100 },
  { field: 'movement_type', ... },
  // ... rest unchanged
]
```

**2. types/model.ts - Update DataMovement interface:**
```typescript
interface DataMovement {
  id: string;
  source_application_point_id: string;
  target_application_point_id: string;
  dataEntityPointId?: string;  // Now optional
  interfaceWithSchemaId?: string;  // NEW - optional FK to interfaces
  biDirectional?: boolean;  // NEW - default false
  movement_type?: string;
  description?: string;
  tags?: string;
  valid_from?: string;
  valid_to?: string;
}
```

**3. validation.ts - Add XOR validation for Data Movements:**
- Add new validation function `validateDataMovementXOR()`
- Add new validation error type: `'xor_constraint'`
- Integrate into `validateModel()` function
- Error messages:
  - Both set: "DATA_MOVEMENT ['<name or id>'] must specify either Data Entity OR Interface (with Schema), not both"
  - Neither set: "DATA_MOVEMENT ['<name or id>'] requires either Data Entity or Interface (with Schema)"

**4. relationshipDefinitions.ts - Update data_movements endpoint types:**
```typescript
{
  relationshipKey: 'data_movements',
  displayName: 'Data Movements',
  endpointEntityTypes: ['application_points', 'data_entity_points', 'interfaces'],  // Add 'interfaces'
}
```

#### Backend Changes

**1. DataMovementDto.java - Add new fields:**
```java
public record DataMovementDto(
    String id,
    String sourceApplicationPointId,
    String targetApplicationPointId,
    String dataEntityPointId,  // Now nullable
    String interfaceWithSchemaId,  // NEW - nullable FK to interfaces
    Boolean biDirectional,  // NEW - default false
    String movementType,
    String description,
    String tags,
    String validFrom,
    String validTo
) {}
```

**2. DataMovementEntity.java - Add new columns:**
```java
@Column(name = "data_entity_point_id", nullable = true)  // Change to nullable = true
private String dataEntityPointId;

@Column(name = "interface_with_schema_id", nullable = true)  // NEW
private String interfaceWithSchemaId;

@Column(name = "bi_directional", nullable = false)  // NEW
private Boolean biDirectional = false;
```

**3. EntityMapper.java - Update toDto/toEntity for DataMovement:**
- Add mapping for `interfaceWithSchemaId`
- Add mapping for `biDirectional` with default false handling

**4. Database Migration:**
```sql
-- Add new columns to data_movements table
ALTER TABLE data_movements ADD COLUMN interface_with_schema_id VARCHAR(255) NULL;
ALTER TABLE data_movements ADD COLUMN bi_directional BOOLEAN NOT NULL DEFAULT FALSE;

-- Make existing data_entity_point_id nullable
ALTER TABLE data_movements ALTER COLUMN data_entity_point_id DROP NOT NULL;
```

#### XLSX Import/Export Changes

**1. Export:**
- Add columns: "Interface (with Schema)", "Bi-directional?"
- Column order: after "Data Entity", before "Type"
- Export `biDirectional` as "TRUE"/"FALSE" (consistent with existing boolean convention)
- Export `interfaceWithSchemaId` as the interface ID (standard FK export)
- If row uses Interface: Data Entity column blank
- If row uses Data Entity: Interface column blank

**2. Import:**
- Read new columns
- Apply XOR validation during import
- If both present or both blank: import row but mark as invalid (non-blocking)
- Resolve interface by ID (standard FK resolution)
- Convert "TRUE"/"YES"/"1" to true for biDirectional

### Scope Boundaries

**In Scope:**
- Frontend: Data Movement grid UI updates (new columns, XOR validation display)
- Model service: persistence model + DTO updates for new fields
- Database: migration for new columns, making dataEntityPointId nullable
- Validation: XOR constraint validation (non-blocking)
- XLSX export/import: add new columns, handle XOR validation

**Out of Scope:**
- Diagram rendering changes
- Auto-generation of per-entity movements from interface schema
- Changing Interface <-> Entity relationship (it's assumed to exist)
- Backend XOR validation (frontend-only for now)

### Technical Considerations

- **Backward Compatibility:** Existing rows with only `dataEntityPointId` must continue to work
- **Default Values:** New rows default to `biDirectional = false`, both nullable fields null
- **ID Format:** `interfaceWithSchemaId` stores the interface ID directly (e.g., `int_123`)
- **Validation Strategy:** Non-blocking validation allows users to see and fix XOR errors
- **Cell Type:** Use existing `fk_typeahead` for interface selection (proven pattern)

### Open Questions for Spec Writer

1. Should the UI use "Clear-on-Select" (Option A) or "Validation-Only" (Option B) for mutual exclusivity?
2. Should backend also enforce XOR constraint, or frontend-only?
3. Column ordering in grid: should new columns be adjacent to Data Entity or at the end?
