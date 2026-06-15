# Specification: Diagram-Level Temporality with Versioned Nodes/Edges

## Goal
Extend the diagram layer to support temporal versioning of nodes, edges, and decorations, enabling diagram layouts to evolve across time periods while maintaining historical versions automatically through version splitting when edits occur in past/future time contexts.

## User Stories
- As an architect, I want diagram layouts to reflect the architecture at different time periods so that I can visualize how systems evolve over time.
- As a user editing a diagram in a future period, I want the tool to automatically preserve the current version while creating a new version for my changes so that historical diagrams remain intact.

## Specific Requirements

**Data Model Extension for DiagramNode**
- Add optional `valid_from?: string` field using "YYYY-Qn" format (e.g., "2026-Q2")
- Add optional `valid_to?: string` field using same quarter format
- Null/undefined values indicate "always valid" (timeless) for backward compatibility
- Maintain existing node structure; temporal fields are additive only
- Update DiagramNode interface in `frontend/src/types/model.ts`

**Data Model Extension for DiagramEdge**
- Add optional `valid_from?: string` field to DiagramEdge interface
- Add optional `valid_to?: string` field to DiagramEdge interface
- Apply to all edge types (relationship edges, interaction edges)
- Null values indicate timeless edges for backward compatibility
- DiagramInteractionEdge should also include temporal fields

**Data Model Extension for Decoration**
- Add optional `valid_from?: string` to DecorationBase interface
- Add optional `valid_to?: string` to DecorationBase interface
- Both ShapeDecoration and LineDecoration inherit from DecorationBase
- Enables time-varying annotations and visual elements on diagrams

**Version Splitting Algorithm**
- First creation: element has `valid_from=null, valid_to=null` (valid all time)
- Editing in FUTURE period T (T > diagram.view_quarter): clone element, set `old.valid_to = period_before(T)`, set `new.valid_from = T`, apply changes to new
- Editing in PAST period T (T < diagram.view_quarter): clone element, set `new.valid_to = T`, set `old.valid_from = period_after(T)`, apply changes to new
- Use `addQuarters()` from quarterUtils.ts for period_before/period_after calculations
- Minimal splitting: only split when current time differs from original validity window

**Edit Detection and Splitting Triggers**
- Trigger splitting on position changes (pos_x, pos_y)
- Trigger splitting on dimension changes (width, height)
- Trigger splitting on style changes (colors, line styles)
- Trigger splitting on edge routing changes (edge_points)
- Do NOT trigger splitting for selection changes or z_index reordering
- Track diagram.view_quarter as the canonical time context for edits

**Temporal Rendering Logic**
- Filter DiagramNode elements using `isElementVisibleInPeriod()` helper
- Filter DiagramEdge elements using same visibility logic
- Filter Decoration elements using same visibility logic
- Create new utility function `isDiagramElementVisibleInPeriod()` in quarterUtils.ts
- Visibility rule: `(valid_from is null OR valid_from <= viewQuarter) AND (valid_to is null OR valid_to > viewQuarter)`
- Prefer most specific version when multiple versions overlap (rare edge case)

**Integration with Existing Temporal Filtering**
- Combine with existing entity-level filtering in `getNodesInRenderOrder()`
- A node is visible only if BOTH the diagram element AND the underlying entity are visible
- Update `getEdgesForDiagram()` to also filter by DiagramEdge temporal fields
- Decorations filtering is new (decorations have no underlying entity)

**Persistence and Migration**
- JSON includes optional valid_from/valid_to per element; missing fields default to null
- Backward compatible: existing diagrams without temporal fields remain fully functional
- No migration script needed; null interpretation handles legacy data
- Save/load logic unchanged; TypeScript interfaces define optional fields

## Existing Code to Leverage

**quarterUtils.ts (frontend/src/utils/quarterUtils.ts)**
- `compareQuarters(q1, q2)` - compare two quarter strings chronologically
- `addQuarters(quarter, delta)` - add/subtract quarters for period_before/period_after
- `isEntityVisibleInPeriod(entity, viewQuarter)` - existing visibility check pattern to mirror
- `isRelationshipVisibleInPeriod(relationship, viewQuarter)` - same pattern for relationships

**rendering.ts (frontend/src/utils/rendering.ts)**
- `getNodesInRenderOrder()` - already accepts viewQuarter param; add diagram element filtering
- `getEdgesForDiagram()` - already filters by relationship/entity visibility; add edge-level filtering
- Existing temporal filtering architecture to extend with diagram-level checks

**ArchitectureContext.tsx (frontend/src/contexts/ArchitectureContext.tsx)**
- `UPDATE_DIAGRAM_NODE` action - modify to detect temporal context and trigger splitting
- `UPDATE_DIAGRAM_EDGE` action - same splitting logic for edges
- `UPDATE_DECORATION` action - same splitting logic for decorations
- `MOVE_NODE_WITH_CASCADE` action - splitting for position changes

**model.ts (frontend/src/types/model.ts)**
- DiagramNode interface at line 895 - add valid_from/valid_to fields
- DiagramEdge interface at line 847 - add valid_from/valid_to fields
- DecorationBase interface at line 765 - add valid_from/valid_to fields
- Diagram interface at line 1048 - already has view_quarter field

## Out of Scope
- Manual user editing of valid_from/valid_to fields via UI (automatic only)
- Visual timeline slider or scrubber UI for navigating time periods
- Merging or consolidating multiple temporal versions into one
- Undo/redo support for version splitting operations
- Database-level temporal queries (frontend-only implementation)
- Performance optimization for diagrams with many temporal versions
- Animation or visual transitions between time periods
- Temporal constraints validation (e.g., preventing invalid date ranges)
- Bulk operations on temporal versions (e.g., delete all versions before date)
- Export/import of individual temporal versions separately
