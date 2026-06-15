# Specification: Time-Based Architecture Views

## Goal
Enable temporal navigation of architecture diagrams by introducing quarter-based validity periods on meta-model objects and time navigation controls in the Diagram view to show architecture "as of" any chosen period.

## User Stories
- As an architect, I want to mark entities and relationships with validity periods so that I can model when systems are commissioned or decommissioned
- As a user, I want to navigate through time using quarter/half/year periods so that I can visualize how the architecture evolves
- As a stakeholder, I want to view the architecture "as of the end" of a specific period so that I can see what was active at that point in time

## Specific Requirements

**Quarter-Based Validity Fields on Meta-Model Objects**
- Add two optional string fields `valid_from` and `valid_to` to all time-aware entities and relationships
- Field format: "YYYY-Qn" where YYYY is 4-digit year and Qn is Q1/Q2/Q3/Q4 (e.g. "2026-Q2", "2027-Q4")
- Apply to entities: `business_processes`, `applications`, `app_components`, `services`, `application_points`, `logical_data_entities`, `physical_data_entities`
- Apply to relationships: `data_movements` (and optionally all relationship types for consistency)
- `valid_from` is inclusive start quarter - object becomes active at the beginning of that quarter
- `valid_to` is exclusive end quarter - object is decommissioned by end of that quarter and should NOT appear in views at or after that quarter
- Null/missing values mean "timeless" - object is always active across all periods
- TypeScript interfaces must be updated to include these optional fields

**Visibility Rule for Time-Based Filtering**
- For a given view quarter V, an object is visible if: `(valid_from is null OR valid_from <= V) AND (valid_to is null OR valid_to > V)`
- Quarter comparison uses chronological ordering by (year, quarter_number)
- Example: Application with `valid_to="2026-Q4"` is visible in Q2 2026 but NOT visible in Q4 2026 or later
- Timeless objects (both fields null) must always be visible regardless of selected period

**Diagram-Level view_quarter Field**
- Add `view_quarter` (string, optional) to Diagram type to store the canonical time state for each diagram
- Format: "YYYY-Qn" quarter code representing the period "as of which" the diagram should be viewed
- On diagram load, if `view_quarter` is missing, default to a sensible value like current quarter or "2026-Q4"
- This field persists to JSON and is the single source of truth for time-based filtering
- Period dropdown selection (Quarter/Half/Year) is UI-only and does NOT persist

**Time Navigation Controls in Diagram Top Bar**
- Extend DiagramsView header bar to include time controls between diagram selector and zoom controls
- Layout: `Diagram: [Dropdown] New Diagram [Input] [+New] [+Copy] | Period: [Quarter/Half/Year ▼] [<] [Period Label] [>] | [+] 100% [-] [Fit to View]`
- Period dropdown with three options: "Quarter", "Half", "Year" - controls time step size and label format
- [<] button navigates backward in time by the selected period increment
- [>] button navigates forward in time by the selected period increment
- Period Label displays human-readable period with clear "End of" phrasing

**Period Label Formatting and Navigation Logic**
- When Period = Quarter: Label shows "End of Q[n] [YYYY]" (e.g. "End of Q1 2027"), stepping moves by 1 quarter
- When Period = Half: Label shows "End of H[1/2] [YYYY]" (e.g. "End of H2 2026"), stepping moves by 2 quarters (H1=Q2, H2=Q4)
- When Period = Year: Label shows "End of [YYYY]" (e.g. "End of 2026"), stepping moves by 4 quarters (always Q4)
- Navigation buttons update `view_quarter` based on Period type, then re-render diagram with new visibility filter
- Period dropdown changes reinterpret current `view_quarter` without changing it (e.g. switching from Quarter to Half rounds to nearest half)

**Time-Based Rendering in Canvas Component**
- Canvas must read diagram's `view_quarter` and apply visibility rule to all nodes and edges before rendering
- For each diagram_node: lookup underlying entity via `entity_type` and `entity_id`, check validity against `view_quarter`
- For each diagram_edge: lookup underlying relationship via `relationship_type` and `relationship_id`, check validity
- Edges should only render if both the relationship is valid AND both source/target nodes are visible
- Non-visible nodes and edges should not be rendered at all (no ghosting or fading in v1)
- Canvas re-renders whenever `view_quarter` changes via navigation controls

**JSON Persistence and State Management**
- Add `valid_from` and `valid_to` fields to entity/relationship TypeScript interfaces in `types/model.ts`
- Add `view_quarter` field to Diagram interface in `types/model.ts`
- Update reducer in ArchitectureContext to handle `UPDATE_DIAGRAM_VIEW_QUARTER` action for time navigation
- Ensure JSON save serializes all new fields, and load deserializes them correctly
- Grid views for entities/relationships should display `valid_from` and `valid_to` as editable text columns

**Quarter Comparison Utility Function**
- Create utility function `compareQuarters(q1: string, q2: string): number` that returns -1, 0, or 1 for chronological ordering
- Parse quarter strings "YYYY-Qn" into {year, quarter} and compare numerically
- Handle null/undefined gracefully by treating null as "always valid" in visibility checks
- Use this function consistently for all time-based filtering logic

## Visual Design

No visual mockups provided. Time controls should follow existing DiagramsView header bar patterns with consistent spacing, button styling, and dropdown styling matching the diagram selector.

## Existing Code to Leverage

**DiagramsView.tsx and DiagramSelector.tsx**
- DiagramsView contains the header bar layout with diagram selector and zoom controls
- Time controls should be added as a new section between selector and zoom controls using flexbox layout
- DiagramSelector component pattern can be referenced for dropdown and button styling
- Uses `useArchitecture()` and `useArchitectureDispatch()` hooks for state management

**Canvas.tsx rendering logic**
- Canvas component already iterates through diagram_nodes and diagram_edges for rendering
- Add time-based filtering before rendering using `view_quarter` from diagram state
- Lookup entity/relationship from metaModel using existing patterns in `rendering.ts`
- Re-render when `view_quarter` changes by including it in useEffect dependencies

**ArchitectureContext.tsx reducer pattern**
- Add new action type `UPDATE_DIAGRAM_VIEW_QUARTER` with payload containing diagramId and new view_quarter
- Follow existing patterns like `UPDATE_DIAGRAM_NODE` for immutable state updates
- Ensure `view_quarter` is updated on correct diagram in diagrams array

**rendering.ts utility functions**
- Contains `getEntityLabel()`, `getEntityColor()`, `getNodesInRenderOrder()`, `getEdgesForDiagram()`
- Add new utility `isEntityVisibleInPeriod(entity, viewQuarter)` to apply visibility rule
- Add `isRelationshipVisibleInPeriod(relationship, viewQuarter)` for edge filtering
- These functions should handle null/undefined validity fields as "always valid"

**Button.tsx and existing CSS patterns**
- Use Button component with secondary variant for [<] and [>] navigation buttons
- Follow existing `.selector` and `.fitButton` styling patterns for dropdown and label
- Period Label should use similar styling to existing `.zoomLevel` span for consistency

## Out of Scope
- Ghost rendering or faded styling for decommissioned or future entities
- Persisting Period dropdown selection (Quarter/Half/Year) to JSON
- Supporting finer-grained dates than quarters (months, weeks, days)
- Timeline slider or calendar picker for date selection
- Automated "diff" views showing changes between two periods
- Visual indicators on entities showing their validity periods
- Filtering or searching for entities by validity period
- Bulk operations to set validity periods on multiple entities
- Validation warnings for invalid quarter codes or logical inconsistencies
- Copy-forward functionality to clone entities across periods
