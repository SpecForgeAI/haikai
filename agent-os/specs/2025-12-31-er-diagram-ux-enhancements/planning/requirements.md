# ER Diagram UX + Rendering Enhancements Requirements

title: ER diagram UX + rendering enhancements (Create+Add Logical ER modal, prevent duplicates + context menu, live meta-model sync, UML relationship symbols + cardinality labels)

## Scope

### In Scope
- frontend only (Diagrams ER view + RHS palette/list interactions + ER edge renderer)
- ER diagram type only

### Out of Scope
- backend/schema changes
- meta-model table UI changes (Logical ER already editable there)
- non-ER diagrams

## Goals

1. "+ New Logical ER" opens a modal to define the LogicalER fields, then creates it AND adds it to the ER diagram in one flow.

2. RHS "Logical ER" list prevents adding the same LogicalER multiple times:
   - if already on diagram: greyed/disabled, click does nothing
   - right-click shows "Delete" (remove from diagram), not "Add"

3. ER diagram nodes re-render from live meta-model state:
   - entity/attribute changes in Meta-model view are reflected automatically in ER diagram view.

4. ER edges render:
   - cardinality labels ("1"/"M") near each endpoint based on LogicalER.cardinality
   - UML end-symbols based on LogicalER.relationship enum (6 values)

## Acceptance Criteria

### AC1 Create+Add
- Clicking "+ New Logical ER" opens modal
- On "Create & Add", a new LogicalER row exists in meta-model and appears on canvas as an ER relationship edge
- Modal fields validate (endpoints optional allowed only if your model allows; otherwise require both endpoints)

### AC2 No Duplicates
- Clicking an existing LogicalER in RHS adds it once
- After add, the RHS row is greyed/disabled and cannot be added again
- Right-click on greyed row offers "Delete" and removes only the diagram edge (not the meta-model row)

### AC3 Live Sync
- Update entity name/attributes in Meta-model view; ER diagram updates without reload

### AC4 ER Edge Visuals
- Cardinality text appears near both ends ("1"/"M") according to mapping
- Relationship end symbols match UML mapping below

## UML Symbol Mapping (Rendering Rules)

### Relationship Placement Rule (deterministic for v1)
- Treat LogicalER.fromRef* as SOURCE and LogicalER.toRef* as TARGET.
- For GENERALIZATION / REALIZATION / DEPENDENCY: symbol is drawn at TARGET end (points to target).
- For COMPOSITION / AGGREGATION: diamond is drawn at SOURCE end (source is "whole").
- ASSOCIATION: no end symbol.

### Symbols
1. GENERALIZATION: solid line + hollow triangle at TARGET end
2. REALIZATION: dashed line + hollow triangle at TARGET end
3. COMPOSITION: solid line + filled diamond at SOURCE end
4. AGGREGATION: solid line + hollow diamond at SOURCE end
5. ASSOCIATION: solid line (no end symbol)
6. DEPENDENCY: dashed line + open arrowhead at TARGET end

## Cardinality Label Mapping
- ONE_TO_ONE: startLabel="1", endLabel="1"
- ONE_TO_MANY: startLabel="1", endLabel="M"
- MANY_TO_ONE: startLabel="M", endLabel="1"
- MANY_TO_MANY: startLabel="M", endLabel="M"

## Implementation Details

### A) "+ New Logical ER" Modal Create & Add

#### A1) Add modal component
- create: src/components/DiagramsView/ER/LogicalErCreateModal.tsx
- fields:
  - From Kind (EndpointRefKind: LOGICAL_ENTITY | PHYSICAL_ENTITY)
  - From (entity picker based on kind)
  - To Kind
  - To (entity picker based on kind)
  - Cardinality (Cardinality enum)
  - Relationship (LogicalErRelationship enum)
  - (optional) Description
- buttons: Cancel, Create & Add

#### A2) Wire "+ New Logical ER" button to open modal
- file: src/components/DiagramsView/PalettePanel.tsx (ER diagram branch)

#### A3) On "Create & Add"
- Create new LogicalER meta-model row
- Add diagram edge referencing LogicalER
- Auto-add missing endpoint nodes if needed

### B) RHS "Logical ER" List: Disable If Already On Diagram + Context Menu

#### B1) Compute "isOnDiagram" for each LogicalER row
#### B2) Disable click + grey styling for items on diagram
#### B3) Context menu: "Delete" for on-diagram items, "Add" for off-diagram items

### C) Live Meta-Model Sync for ER Diagram Nodes

#### C1) ER node rendering derives from ArchitectureContext meta-model each render
#### C2) ER edge rendering derives from current LogicalER values

### D) ER Edge Rendering: Cardinality Labels + UML Symbols

#### D1) Use boundary intersection geometry for edge endpoints
#### D2) Render cardinality labels near endpoints
#### D3) Render relationship symbols (triangles, diamonds, arrowheads)
