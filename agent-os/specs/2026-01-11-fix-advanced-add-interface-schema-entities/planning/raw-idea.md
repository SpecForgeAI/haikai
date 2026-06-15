title: Fix Advanced Add to include Interface schema entities after Interface↔Entity refactor (resolve dataEntityPointId for logical+physical)
date: 2026-01-11
owner: diagrams-ui
type: bugfix

## Goal
Restore the previously working behaviour where the **Advanced Add** modal (right-click Application → Advanced Add) can show and allow selecting **schema entities nested under an Interface**, based on the meta-model relationship.

This regressed after changing the relationship from **Interface <-> Logical Entity** to **Interface <-> Entity** (logical OR physical).

## Problem
- The Interface schema relationship rows are now stored using a unified field (e.g. `dataEntityPointId`) that can refer to either:
  - a Logical Data Entity, or
  - a Physical Data Entity
- The Advanced Add tree-builder and Interface composite builder still use the old logical-only relationship shape (e.g. reading `logical_entity_id` and/or only scanning logical entities).
- Result: Advanced Add shows Interfaces but does not show any selectable entities under them, even though the "Interface <-> Entity" relationship grid contains rows.

## Scope
### In-scope
- Frontend-only fix:
  - Update Advanced Add relationship resolution for Interface schema entities.
  - Update Interface composite/contract rendering builder (if used by diagram node rendering) to use the same resolved entities.
  - Update any stale config/constants used for Advanced Add relationship mapping.
  - Add a regression test.

### Out-of-scope
- Backend/model-service changes (relationship data already exists and is visible in the UI grid)
- Changes to how the Interface↔Entity relationship is authored in the tables (only consumption/rendering is fixed)

## Requirements

### 1) Correctly resolve Interface schema entities from relationship rows
When building the Advanced Add tree for an Interface:
- Use the **Interface↔Entity** relationship rows (current source of truth).
- For each relationship row where `interfaceId` matches:
  - read the unified data-entity reference field (e.g. `dataEntityPointId`)
  - resolve whether it points to a logical or physical entity
  - collect the corresponding entity IDs from:
    - `metaModel.entities.logical_data_entities`
    - `metaModel.entities.physical_data_entities`

### 2) Display schema entities under Interface in Advanced Add
- The Advanced Add modal must show the entities nested under each Interface node in the tree, so the user can tick them for inclusion.
- Presentation should mirror existing "Data Entity" selection conventions:
  - either group into "Logical Data Entities" and "Physical Data Entities", OR
  - show as a single list with type tags (recommended: same tag style used elsewhere, e.g. `[LOGICAL_DATA_ENTITY]` / `[PHYSICAL_DATA_ENTITY]`).

### 3) Ensure diagram "contract/composite" interface rendering includes these entities
If Interface nodes render a composite/contract area that lists entities:
- Update the Interface composite builder/utilities to use the same resolver logic as Advanced Add so the entities actually appear in the diagram once selected.

### 4) Update stale relationship config for Interface schema links
Any Advanced Add mapping/config that still points to logical-only relationship keys/fields must be updated to the new reality:
- Stop assuming `logical_entity_id`
- Stop assuming target collection is logical-only
- Ensure the mapping recognizes Interface schema entities as "data entities (logical or physical)".

## Implementation tasks (non-exhaustive)

### A) Add a shared resolver utility
Create a shared utility to avoid divergence (used by both Advanced Add and Interface composite builder), e.g.:
- `resolveDataEntitiesForInterface(metaModel, interfaceId) -> { logicalEntityIds: string[], physicalEntityIds: string[] }`
This utility:
- filters Interface↔Entity relationship rows by interfaceId
- reads `dataEntityPointId`
- decodes kind + ID
- returns IDs grouped by kind

### B) Update Advanced Add tree builder
- In the Advanced Add tree build logic for Interface nodes:
  - call the shared resolver
  - attach resolved entities as child nodes under the Interface

### C) Update Interface composite/contract builder
- Replace any logic that fetches only logical entities for an interface with the shared resolver.
- Ensure the renderer can display both logical and physical entities.

### D) Regression test
Add/update a test that:
- constructs a minimal metaModel containing:
  - an Interface
  - one logical data entity
  - one physical data entity
  - Interface↔Entity relationship rows referencing both via `dataEntityPointId`
- asserts Advanced Add tree includes both entities under that interface

## Acceptance criteria
1. Given Interface↔Entity rows exist for an Interface, Advanced Add shows those entities under the Interface node.
2. Both logical and physical entities are supported and displayed.
3. Selecting those entities in Advanced Add results in them being included in the diagram (nested under the Interface contract/composite area where applicable).
4. No regression to other Advanced Add nesting behaviour (applications/components/services/endpoints).
5. Automated test prevents reintroducing the logical-only assumption.

## Notes
- This bug is a consumer-side mismatch: relationship authoring works; Advanced Add and contract rendering must be updated to the new unified reference field.
