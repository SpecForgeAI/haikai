# Specification: Fix Context Chips Hydrate Labels After Navigation

## Goal
Fix the bug where Work Item context chips flip between showing human-readable names and raw IDs depending on navigation. After navigating away and returning (or reloading), chips should continue showing names, never IDs.

## User Stories
- As a user viewing a work item, I want context chips to always display readable names so I can understand my selected context at a glance
- As a user returning to a work item after navigation, I want my context chips to show the same labels as before so I'm not confused by raw IDs

## Specific Requirements

**Label Hydration After Context Fetch**
- In `ProductImplementPage.tsx`, after `fetchImplementContext()` resolves, call `rehydrateContextLabels()` before calling `setContextState()`
- Pass `metaModel.entities`, `model.diagrams`, and `metaModel.relationships` from architecture context state
- This ensures labels are resolved immediately when context data arrives from backend

**Re-Hydration on Architecture Data Load**
- Add a `useEffect` hook in `ProductImplementPage.tsx` that watches for changes in architecture data
- When `metaModel.entities`, `model.diagrams`, or `metaModel.relationships` update, re-run `rehydrateContextLabels()` against current contextState
- Only call `setContextState()` if at least one label actually changed (deep compare to prevent infinite loops)
- This handles the case where context loads before architecture data is fully available

**Infinite Loop Prevention**
- Before calling `setContextState()` with re-hydrated labels, compare old vs new labels
- Use a simple string comparison of concatenated labels or JSON.stringify() on the refs arrays
- Only update state if the comparison shows a difference
- Add a guard ref (`isHydrating`) to skip the re-hydration effect while already updating

**Remove ID Fallback in Chip Rendering**
- In `WorkItemSummaryPanel.tsx`, update `EntityChip`, `DiagramChip`, and `RelationshipChip` components
- If `ref.label` is falsy, empty, or equals the ID value, display "Loading..." instead
- Never render raw `entity_id`, `diagram_id`, or `relationship_id` as fallback text

**Regression Tests**
- Test: context loaded with labels matching IDs + loaded metaModel -> hydrated labels resolve to entity names
- Test: diagram refs hydrate to diagram.name from diagrams array
- Test: relationship refs hydrate to computed label using `resolveRelationshipLabel()`
- Test: navigation simulation - mount, fetch, display; unmount; remount, fetch again -> labels remain names

## Existing Code to Leverage

**`frontend/src/utils/contextLabelResolver.ts`**
- Already has `rehydrateContextLabels(contextState, metaModelEntities, diagrams, metaModelRelationships)` function
- Already has `resolveEntityLabel()` that returns name or "Loading..." or "Unknown Entity"
- Already has `resolveDiagramLabel()` that returns name or "Loading..." or "Unknown Diagram"
- Already has `resolveRelationshipLabel()` for relationship label computation

**`frontend/src/utils/contextRelationshipLabelUtils.ts`**
- `computeRelationshipLabel()` computes labels in format "NameA [TYPE_A] | NameB [TYPE_B]"
- Used by `resolveRelationshipLabel()` in contextLabelResolver.ts

**`frontend/src/components/ProductView/WorkItemSummaryPanel.tsx`**
- Contains `EntityChip`, `DiagramChip`, `RelationshipChip` components that render context chips
- Currently renders `ref.label` directly without fallback handling

**`frontend/src/components/ProductView/ProductImplementPage.tsx`**
- Fetches context via `fetchImplementContext()` in a useEffect
- Calls `setContextState()` after fetch resolves
- Has access to `model.metaModel.entities`, `model.diagrams`, and `model.metaModel.relationships`

**`frontend/src/contexts/ArchitectureContext.tsx`**
- Provides `AppState` with `model.metaModel.entities`, `model.diagrams`, and `model.metaModel.relationships`
- Use `useArchitecture()` hook to access this state

## Out of Scope
- Backend DTO or persistence format changes
- Planner prompt context changes
- New relationship types
- Tooltip or hover behavior changes
- Changes to ContextPickerModal component
- Changes to context save/persistence logic
- ImplementationAssistantPanel changes (it receives contextState as a prop)
