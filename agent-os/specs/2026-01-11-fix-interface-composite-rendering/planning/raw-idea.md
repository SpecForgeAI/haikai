title: Fix Interface composite rendering after Interface↔Entity refactor (dataEntities shape, attribute keying, and legacy dataEntityPointId normalization)
date: 2026-01-11
owner: diagrams-ui
type: bugfix

## Goal
Fully restore diagram rendering for Interface composites after the Interface↔Entity refactor by:
1) Updating Advanced Add → candidate → layout pipeline to pass Interface-selected entities in the new unified shape (logical + physical).
2) Fixing attribute-selection mapping so logical/physical entity attributes render correctly.
3) Eliminating runtime warnings/errors caused by legacy Interface↔Entity rows missing `dataEntityPointId`.

This must remove the canvas render failure:
- `selectedDataEntityIds.logicalEntityIds is not iterable`
and prevent the next likely failures around attribute lookup and missing point-id.

## Scope
### In-scope (frontend)
- Advanced Add selection data structures for Interface schema selection
- Candidate map creation (PalettePanel) and layout builder call sites
- Interface composite builder to support physical entities + attributes consistently
- Normalization of legacy Interface↔Entity relationship rows when loading meta-model into frontend state
- Add/adjust regression tests

### Out-of-scope
- Model service migrations (frontend normalization is sufficient for legacy rows already in DB)
- Any new UI features (purely correctness/regression fix)

## Problem summary
- Interface composite builder now expects:
  - `selectedDataEntityIds = { logicalEntityIds: string[], physicalEntityIds: string[] }`
  but at least one call site still passes the old `string[]` (logical-only).
- Attribute selections are (or can become) keyed by a wrapper/point-id or inconsistent key, which breaks attribute rendering for physical entities.
- Legacy Interface↔Entity rows may still contain old fields (e.g. logical_entity_id / physical_entity_id) and are missing `dataEntityPointId`, producing warnings and breaking resolution in some paths.

## Required changes

### 1) Use Option B: represent Interface schema selections as dataEntities {logical, physical}
Update the Interface-specific selection/candidate shape so it carries both logical and physical entities.

#### Data shape
For Interface candidates produced from Advanced Add selections, use:
- `dataEntities: { logical: TreeNodeData[]; physical: TreeNodeData[] }`

No other part of the pipeline should assume a `logicalEntities: []`-only list.

### 2) Update all Interface composite builder call sites to pass the correct shape
Every call to `buildInterfaceCompositeNodes(...)` must pass:
- `selectedDataEntityIds: { logicalEntityIds: string[]; physicalEntityIds: string[] }`
and never a plain array.

If a selection is absent, pass empty arrays:
- `{ logicalEntityIds: [], physicalEntityIds: [] }`

Update all relevant call sites (non-exhaustive):
- `src/utils/compoundLayout.ts`
- `src/components/DiagramsView/PalettePanel.tsx`
- `src/components/DiagramsView/PalettePanel_tmp.tsx`
(and any other file calling Interface composite builder)

### 3) Fix attribute selection mapping to be keyed by raw entity IDs
Ensure the attribute selection map used by composite builders is keyed consistently:

- Keys MUST be the raw entity IDs:
  - logical entity id for logical attributes
  - physical entity id for physical attributes
- Keys MUST NOT be data-entity-point IDs (e.g. `dep_log_<id>` / `dep_phy_<id>`)

Implementation requirements:
- When building `selectedAttributeIdsByEntity` from Advanced Add selections:
  - derive the owning entity id from the selected attribute node's parent entity node
  - store attributes under that entity id
- In Interface composite builder:
  - when iterating logical entity ids, look up attribute ids by that logical entity id
  - when iterating physical entity ids, look up attribute ids by that physical entity id

Add defensive defaults so missing map entries result in "no attributes" rather than errors.

### 4) Normalize legacy Interface↔Entity relationship rows to ensure dataEntityPointId exists
Eliminate `[DataEntityPointSelect] Missing point-id field detected` by normalizing loaded meta-model relationship rows:

- For each Interface↔Entity relationship row:
  - If `dataEntityPointId` is missing/blank:
    - If legacy `logical_entity_id` exists:
      - set `dataEntityPointId = "dep_log_" + logical_entity_id`
    - Else if legacy `physical_entity_id` exists:
      - set `dataEntityPointId = "dep_phy_" + physical_entity_id`
- Perform this normalization once when meta-model is loaded into frontend state (e.g., in the model load/adapter/mapper layer), not ad-hoc in UI components.

Do not drop legacy fields if they exist; just ensure the unified field is populated for all downstream logic.

### 5) Regression tests
Add/update tests to prevent recurrence:
1) Interface composite builder does not throw when given valid selections and renders both logical and physical entities.
2) Attribute selection mapping:
   - attribute ids are stored under raw entity ids
   - physical attributes render when selected
3) Legacy normalization:
   - given relationship rows missing `dataEntityPointId` but containing legacy ids, the normalized meta-model has valid `dataEntityPointId` and no warning path is triggered.

## Acceptance criteria
1) Advanced Add can select Interface schema entities (logical + physical) and their attributes, and adding to diagram renders successfully on canvas (no runtime exception).
2) `selectedDataEntityIds.logicalEntityIds is not iterable` no longer occurs.
3) Selected attributes for both logical and physical entities appear within the Interface composite in the diagram.
4) Console warning about missing point-id does not appear for legacy-loaded data (because normalization fills it).
5) No regressions to existing Advanced Add behaviour for applications/components/services/endpoints.

## Implementation notes (non-exhaustive)
- Introduce/extend a shared resolver/helper for:
  - extracting `{ logical: [], physical: [] }` selected entities from the Advanced Add tree
  - building `selectedDataEntityIds` and `selectedAttributeIdsByEntity` consistently
- Ensure PalettePanel and compoundLayout use the same helper to avoid drift.
