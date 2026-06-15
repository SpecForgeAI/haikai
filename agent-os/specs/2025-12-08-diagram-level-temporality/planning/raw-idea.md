# Raw Idea: Add Diagram-Level Temporality with Versioned Nodes/Edges (valid_from / valid_to)

## Summary

The meta-model already supports temporality via valid_from / valid_to on entities and relationships. However, diagram layout (nodes, edges, decorations) is currently timeless, which produces incorrect/ugly diagrams when the architecture changes over time (e.g. business processes move from App A to App B). This spec introduces full temporality for the diagram layer:

- Diagram nodes, edges, and decorations gain their own valid_from / valid_to.
- When a user edits a diagram element in a different time period (past or future), the tool **splits** that element into temporal versions:
  - Closes the old version's validity window.
  - Creates a new version starting or ending at the current period.
  - Applies the change only to the new version.
- At render time, the diagram engine selects the appropriate version of meta-model + diagram elements for the selected time.

## Key Changes

### 1. Data Model Extensions
- DiagramNode: add valid_from, valid_to fields
- DiagramEdge: add valid_from, valid_to fields
- Decoration: add valid_from, valid_to fields
- Use same time representation as meta-model (date/period)

### 2. Version Splitting Behavior
- First creation: valid_from=null, valid_to=null (valid for all time)
- Editing in FUTURE: clone element, set old.valid_to=before_T, new.valid_from=T
- Editing in PAST: clone element, set new.valid_to=T, old.valid_from=after_T
- Minimal splitting: only split when crossing time boundaries

### 3. Rendering Logic
- Filter meta-model elements by validity at time T
- Filter diagram elements by validity at time T
- Use most specific version if overlap
- Hide element if no valid version exists

### 4. Scope
- All meta-model-based nodes
- Composite nodes (Interface with children)
- All relationship edges
- User Interaction edges
- Decorations (shapes, annotations)

### 5. UX Considerations
- Subtle indicator when temporal split occurs
- No manual validity management by user
- Automatic validity changes based on time context

### 6. Persistence
- JSON includes optional valid_from/valid_to per element
- Backward compatible (missing = always valid)

## Acceptance Criteria

- AC1: Data model has valid_from/valid_to on nodes, edges, decorations
- AC2: Editing in future creates split with old.valid_to, new.valid_from
- AC3: Editing in past creates split with new.valid_to, old.valid_from
- AC4: Edges and decorations also support temporal versioning
- AC5: Rendering shows correct version for selected time period
