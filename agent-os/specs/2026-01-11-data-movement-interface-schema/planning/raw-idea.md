title: Extend Data Movement relationship with Interface-with-Schema option, XOR validation, and Bi-directional flag
date: 2026-01-11
owner: architecture-meta-model
type: feature

## Goal
Update the **Data Movement** relationship so it can be defined at either:
- a specific **Data Entity** level, OR
- a higher-level **Interface (with Schema)** level (implying multiple valid data movements based on the interface schema)

Also add an explicit **Bi-directional?** flag to capture directionality.

## Rationale
Defining every data movement per entity (table/payload) is overkill for large systems and becomes impractical for diagramming. Selecting an interface whose schema is defined via **Interface <-> Entity** provides a scalable way to represent "many allowed data movements" between a source and target.

## Scope
### In-scope
- Frontend: Data Movement table/form UI updates, selector UI, validation, and display
- Model service: persistence model + DTO updates for new fields
- Validation: enforce "one and only one of Data Entity vs Interface (with Schema)"
- XLSX export/import: update to include the new columns for Data Movements (meta-model XLSX scope)

### Out-of-scope
- Diagram rendering changes (unless diagrams currently read Data Movement fields directly)
- Auto-generation of per-entity movements (this is an implied semantics only)
- Changing other relationships beyond what's required for integration (e.g. Interface <-> Entity is assumed to exist already)

## Data Movement model changes

### New columns/fields
Add to Data Movement relationship row:

1) `interfaceWithSchemaId` (nullable)
- Selected Interface reference.
- Represents "schema-defined movements" where schema entities are those linked by **Interface <-> Entity**.

2) `biDirectional` (boolean, default false)
- If true: movement is both directions.
- If false: movement is only Source App Point -> Target App Point.

### Existing columns/fields (unchanged)
- `sourceAppPointId`
- `targetAppPointId`
- `dataEntity` selection (existing field; supports logical or physical entities)

## Validation rules (XOR constraint)
For each Data Movement row, enforce:

- Exactly one of:
  - `dataEntity` (existing) OR
  - `interfaceWithSchemaId` (new)
  must be set.

That means:
- If both are set -> invalid (show validation error)
- If neither is set -> invalid (show validation error)
- If exactly one is set -> valid (subject to any other existing validations)

Validation must be non-blocking:
- The row remains visible in the table.
- The UI shows a clear validation error on the row and/or field(s).

## UI requirements (frontend)

### Data Movement table/form
1) Add a new column/field:
   - Label: **Interface (with Schema)**
   - Type: Interface selector (single select)
2) Add a new column/field:
   - Label: **Bi-directional?**
   - Type: checkbox (default unchecked)

### Selector behaviour
- "Interface (with Schema)" must allow selecting any Interface.
- If an Interface is selected here, it semantically implies that the movable entities are those defined by **Interface <-> Entity** for that interface.

### Mutual exclusivity UX
- The UI must make the XOR rule obvious and enforceable:
  - When `dataEntity` is selected and user selects an Interface, either:
    - clear the other field automatically and show a small inline hint, OR
    - allow both to be temporarily set but show immediate validation error
- Choose one approach and use it consistently (recommended: prevent invalid state by clearing the other field with a brief hint).

### Display behaviour
- In the Data Movements list/table, show:
  - Source App Point
  - Target App Point
  - Either:
    - Data Entity (logical/physical) OR
    - Interface (with Schema)
  - Bi-directional flag indicator

## Model service requirements (architecture-model-service)

### Persistence
- Add nullable column/field for `interfaceWithSchemaId`
- Add boolean column/field for `biDirectional` (default false)
- Ensure CRUD endpoints for meta-model relationships persist and return these new fields.

### Compatibility
- Existing Data Movement rows that only have Data Entity must continue to load and be valid.
- For existing rows, `interfaceWithSchemaId` will be null and `biDirectional` defaults false.

## XLSX import/export requirements
Data Movements worksheet must be updated to include the new columns:
- `interface_with_schema` (or consistent column naming used by other exports)
- `bi_directional`

Export:
- If row uses Data Entity:
  - export Data Entity fields as today
  - leave `interface_with_schema` blank
- If row uses Interface-with-Schema:
  - export interface name/id per existing export conventions for references
  - leave Data Entity columns blank
- Export `bi_directional` as TRUE/FALSE (or 1/0) consistent with existing XLSX boolean conventions.

Import:
- Read the new columns.
- Apply XOR validation during/after import:
  - if both present or both blank -> import row but mark invalid and show validation error
- For `interface_with_schema`, resolve Interface by name (consistent with current import reference resolution).

## Acceptance criteria
1) Data Movement relationship UI contains new fields:
   - Interface (with Schema)
   - Bi-directional?
2) A Data Movement row can be validly saved using either:
   - Data Entity only, OR
   - Interface (with Schema) only
3) The XOR rule is enforced and clearly validated in the UI.
4) Bi-directional flag correctly persists and reloads.
5) Existing rows remain compatible and unchanged.
6) XLSX Export includes the new columns and produces valid workbooks.
7) XLSX Import can read the new columns and applies XOR validation without crashing.

## Notes
- The semantics of Interface-with-Schema depends on the relationship **Interface <-> Entity** (schema definition).
- This feature does not expand a schema-based movement into many rows; it represents the allowance compactly.
