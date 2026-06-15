# Requirements Decisions

## 1. DEP Label Fix Approach
Leverage the existing `resolveDataEntityPointLabel()` in `dataEntityPointOptions.ts`. Prefer fixing label rendering (and/or the label utility path) rather than expanding `createEntityLookupFromMetaModel()` to "pretend" DEP IDs are normal entity IDs. If a small enhancement to lookup helps (e.g., detect DEP prefixes and delegate to `resolveDataEntityPointLabel`), that's fine, but the canonical resolution logic should be centralized in `resolveDataEntityPointLabel()`.

## 2. Section-Level Select All Position
Option A — put the checkbox before the section label:
- `[x] Entities (15)`
- `[x] Relationships (10)`

## 3. Group-Level Select All Position
Checkbox before the group title as well (consistent with section-level):
- `[x] INTERFACE_LOGICAL_ENTITIES (3)`

## 4. Indeterminate State
Yes — use indeterminate for partially selected scopes (section and group). This is the preferred UX; unchecked-while-partial is acceptable only if indeterminate is painful to implement, but indeterminate is the target.

## 5. Three-State Checkbox Behavior
- Unchecked -> click -> selects all
- Checked -> click -> clears all
- Indeterminate -> click -> selects all

## 6. Relationship Metadata for Bulk Selection
Pre-compute at selection time. Bulk selection must populate `relationshipMetadata` immediately so Apply/commit is deterministic and never depends on later lazy computation.

## 7. Explicit Out-of-Scope
- No changes to Diagrams tab or any non-context-picker UI.
- No changes to Apply payload structure/contract (only ensure metadata is present as it already expects).
- No backend/schema/API changes unless absolutely necessary (should not be).
- No redesign of checkbox styling beyond reusing the existing `AdvancedAddDialog.tsx` pattern.

## Visual Assets
None provided.
