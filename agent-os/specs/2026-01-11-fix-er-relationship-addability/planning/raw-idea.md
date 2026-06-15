title: Fix ER relationship addability checks to support unified dataEntityPointId endpoints (enable/disable + edge attachment)
date: 2026-01-11
owner: diagrams-ui
type: bugfix

## Goal
Fix the ER diagram relationship palette so relationship rows become selectable/enabled when their endpoints are already on the canvas, even when relationship endpoints are stored using unified `dataEntityPointId` values (e.g. `dep_log_<id>` / `dep_phy_<id>`).

Also ensure that when the relationship is added to the diagram, the created edge correctly attaches to the existing entity nodes (uses raw entity IDs, not `dep_*` point IDs).

## Problem
After refactoring to store certain data-entity references as a unified `dataEntityPointId`, the relationship palette "endpoints present" check compares:
- diagram node IDs (raw entity IDs) vs
- relationship endpoint values (point IDs like `dep_phy_<id>`)

These never match, so all relationships remain greyed out with:
> "Both endpoints must be on the diagram to add this relationship"

Additionally, if an edge is created using `dep_*` IDs, it will not attach to entity nodes on the canvas.

## Scope
### In-scope
- Frontend-only changes:
  - Normalize relationship endpoints before performing addability checks
  - Normalize endpoints when creating diagram edges
  - Add regression tests

### Out-of-scope
- Changing the meta-model data itself (no DB migrations)
- Any changes to ER relationship authoring UI beyond correctness of addability and edge creation

## Requirements

### 1) Introduce a shared resolver for DataEntityPoint IDs
Add a utility function that converts a stored endpoint reference into a concrete entity target:

- Input: `dataEntityPointId: string`
- Output: `{ kind: 'logical' | 'physical', entityId: string } | null`

Rules:
- `dep_log_<id>` => `{ kind: 'logical', entityId: <id> }`
- `dep_phy_<id>` => `{ kind: 'physical', entityId: <id> }`
- Any invalid/missing value => `null`

Also support legacy/raw IDs defensively:
- If the value does not start with `dep_` and looks like an existing entity id, treat it as `{ kind: 'physical' | 'logical' }` only when the calling context can infer kind; otherwise return null.
  - (Preferred: only allow this fallback where needed and safe; do not guess incorrectly.)

### 2) Fix relationship palette enable/disable logic (addability)
Wherever the ER relationship palette determines "both endpoints are on diagram":
- Build a lookup of nodes currently on the canvas, keyed by BOTH:
  - node type (LOGICAL_DATA_ENTITY or PHYSICAL_DATA_ENTITY)
  - raw entity id

Then, for each relationship row endpoint:
- Resolve the stored endpoint via the resolver:
  - if `kind === logical` => require LOGICAL_DATA_ENTITY node with `entityId` exists on diagram
  - if `kind === physical` => require PHYSICAL_DATA_ENTITY node with `entityId` exists on diagram
- Only enable the relationship row if both resolved endpoints are present.

Tooltip behaviour:
- If disabled, show the existing tooltip ("Both endpoints…").
- If enabled, tooltip should not appear (or should be neutral).

### 3) Fix edge creation to attach to the correct node IDs
When a relationship is added to the diagram from the palette:
- Use the same resolver to obtain raw entity IDs
- Create the diagram edge endpoints referencing the concrete node IDs/types used by the existing diagram nodes
- Do NOT store `dep_*` ids as the edge endpoints.

This must work for:
- physical↔physical ER
- logical↔logical ER
- logical↔physical ER (if supported by the relationship table)

### 4) Regression tests
Add/update tests to prevent recurrence:

Test A: Addability
- Given a diagram containing two PHYSICAL_DATA_ENTITY nodes with ids A and B
- Given an ER relationship row whose endpoints are `dep_phy_A` and `dep_phy_B`
- Expect the relationship row to be enabled (addable).

Test B: Edge attachment
- When adding the relationship, assert the created edge references endpoints A and B (raw ids), not `dep_phy_A/dep_phy_B`.

If there is an existing test harness for palette addability, extend it; otherwise create a focused unit test for:
- endpoint resolver
- addability predicate
- edge endpoint mapping

## Implementation notes (non-exhaustive)

### Likely files/areas to update
- Relationship palette component / section where rows are greyed out and tooltip is shown (search for tooltip string)
- The function/predicate often named:
  - `canAddRelationshipToDiagram`, `isRelationshipAddable`, `endpointsOnDiagram`, etc.
- Edge creation handler for selecting a relationship row and adding it to the canvas
- Add a shared utility:
  - e.g. `src/utils/dataEntityPointId.ts` or similar, used by both palette and edge creation

### Node type mapping
Ensure resolver kind maps to the exact diagram node types used in ER diagrams:
- logical => LOGICAL_DATA_ENTITY node type
- physical => PHYSICAL_DATA_ENTITY node type

## Acceptance criteria
1) In an ER diagram with physical entities on the canvas, physical ER relationships referencing those entities via `dep_phy_<id>` become enabled (not greyed out).
2) The tooltip "Both endpoints must be on the diagram…" only appears when one or both endpoints truly are not on the canvas.
3) Adding an enabled relationship creates an edge that correctly attaches to the existing entity nodes (raw ids), and renders on canvas.
4) No regressions to existing relationship add behaviour for non-data-entity relationships.
5) Automated tests cover the dep_* endpoint scenario and pass.
