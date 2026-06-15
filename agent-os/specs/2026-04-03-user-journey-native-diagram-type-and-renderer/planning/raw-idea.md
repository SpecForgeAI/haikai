# Raw Idea: User Journey Native Diagram Type and Renderer

## Feature Name

user-journey-native-diagram-type-and-renderer

## Summary

Introduce a new native diagram type called "User Journey" and implement its first deterministic renderer in the existing diagram workspace, using the temporary diagram JSON contract as the source model.

---

## Motivation

The product currently lacks a first-class User Journey diagram type. User Journey diagrams are a key artifact in product and architecture workflows, allowing teams to visualise how users move through a system across swimlanes of actors or phases. The existing diagram workspace supports multiple diagram types, but there is no native, deterministic renderer for User Journey diagrams. Instead, teams may fall back to generic tools or Mermaid-like syntax, which produces inconsistent visual output and is not integrated into the native workspace experience.

This feature introduces a proper first-class User Journey diagram type with deterministic, data-driven rendering. The renderer will be used initially to display User Journey diagrams generated as part of the Increment 6 review flow, where a temporary diagram JSON is produced and must be rendered faithfully without user editing.

---

## Scope

The following is in scope for this feature:

- Register a new diagram type: "User Journey" in the diagram type registry
- Implement a native renderer for User Journey diagrams supporting:
  - Swimlanes (horizontal bands representing actors or phases)
  - Activity step boxes within lanes
  - Issues associated with steps (displayed as annotations or badges)
  - Edges between steps, including cross-lane edges
- Use the Increment 5 temporary diagram JSON contract as the source model (input to the renderer)
- Integrate the renderer into the existing diagram workspace loading pipeline
- Support the Increment 6 review flow, where a temporary User Journey diagram is loaded and displayed using this renderer

---

## Out of Scope

The following is explicitly out of scope for this increment:

- Persistence of User Journey diagrams to the backend store (diagrams remain temporary)
- User editing of User Journey diagrams within the canvas (no drag, resize, or property editing)
- Complex canvas tools specific to User Journey (no toolbar extensions beyond what is needed for read-only display)
- Branching flows or conditional paths within the diagram
- Exporting User Journey diagrams to external formats (PDF, PNG, etc.) beyond what the existing workspace already supports for all diagram types

---

## Architectural Intent

- The renderer must be deterministic: the same input JSON always produces the same visual layout
- The renderer is data-driven: all layout decisions are derived from the input contract, with no random or user-driven positioning
- The implementation must be extensible: the renderer architecture should allow future increments to add editing capabilities without a full rewrite
- The renderer is a native canvas renderer, not a Mermaid wrapper or SVG embed

---

## Diagram Type Registration

A new diagram type entry must be added to the diagram type registry (wherever existing types such as "Component", "Sequence", etc. are registered). The new type must:

- Have a unique identifier (e.g. `user-journey`)
- Have a human-readable display name: "User Journey"
- Be associated with the new renderer implementation
- Be loadable via the existing diagram workspace loading pipeline when a diagram of this type is encountered

---

## Renderer Input Contract (Increment 5 Contract)

The renderer consumes a temporary diagram JSON with the following top-level structure:

```
{
  "type": "user-journey",
  "journey": {
    "title": string,
    "lanes": Lane[],
    "steps": Step[],
    "edges": Edge[],
    "render_hints": RenderHints (optional)
  }
}
```

### Lane

```
{
  "id": string,
  "label": string,
  "actor": string (optional)
}
```

### Step

```
{
  "id": string,
  "lane_id": string,
  "label": string,
  "description": string (optional),
  "issues": Issue[] (optional)
}
```

### Issue

```
{
  "severity": "info" | "warning" | "error",
  "message": string
}
```

### Edge

```
{
  "id": string,
  "from_step_id": string,
  "to_step_id": string,
  "label": string (optional),
  "cross_lane": boolean (optional)
}
```

### RenderHints

```
{
  "step_width": number (optional),
  "step_height": number (optional),
  "lane_height": number (optional),
  "padding": number (optional)
}
```

---

## Rendering Requirements

### Title Area

- The diagram title (from `journey.title`) must be rendered at the top of the canvas
- The title must be visually distinct (larger text, clear separation from the swimlane area)

### Swimlanes

- Each lane in `journey.lanes` is rendered as a horizontal band spanning the full width of the diagram
- Lanes are stacked vertically in the order they appear in the `lanes` array
- Each lane displays its `label` (and optionally `actor`) in a left-hand header cell
- Lane header cells are fixed-width; the remaining canvas width is used for steps

### Activity Step Boxes

- Each step in `journey.steps` is rendered as a box within its corresponding lane (matched by `lane_id`)
- Step boxes display the step `label` prominently
- If a `description` is provided, it is shown in smaller text below the label
- If a step has `issues`, each issue is rendered as a badge or annotation on the step box:
  - `info` severity: neutral/blue indicator
  - `warning` severity: amber/yellow indicator
  - `error` severity: red indicator
- Steps within a lane are positioned left-to-right in the order they appear in the `steps` array (filtered by lane)

### Edges

- Each edge in `journey.edges` connects two steps (by `from_step_id` and `to_step_id`)
- Edges are rendered as arrows between step boxes
- If `cross_lane` is true, the edge must route between steps in different lanes, crossing swimlane boundaries visually
- If an edge `label` is provided, it is displayed alongside the arrow
- Edges must not overlap step boxes where avoidable; routing may be simplified (e.g. orthogonal or straight lines) for this increment

---

## Layout Rules

- Swimlanes are horizontal (each lane is a row)
- Flow direction is left-to-right (steps progress from left to right within each lane)
- Layout is deterministic: step positions are calculated purely from the input data and render hints, with no force-directed or iterative layout
- Steps are evenly spaced within their lane unless `render_hints` override sizing
- The canvas auto-sizes to fit all lanes and steps; no clipping of content is permitted
- If `render_hints` provides sizing values, they override the defaults for that render

---

## Styling

- The renderer must produce output that matches the native tool visual language (consistent with other diagram types in the workspace)
- The output must not resemble Mermaid diagram output or external SVG embeds
- Fonts, colours, border radii, and spacing must be consistent with the existing design system used by other native diagram renderers
- Issue badges must be visually prominent but must not obscure the step label

---

## Frontend Integration

- The diagram type registry in the frontend must be updated to include the `user-journey` type
- The diagram workspace loading pipeline must recognise the `user-journey` type and invoke the new renderer
- The renderer is invoked when a temporary diagram JSON of type `user-journey` is present in the workspace state
- The renderer must coexist with all existing diagram type renderers without conflict

---

## Temporary Diagram Behavior

- In the Increment 6 review flow, a temporary User Journey diagram JSON is produced and placed into the workspace
- The new native renderer is used to display this temporary diagram
- The diagram is read-only in this context: no editing interactions are expected or supported
- When the temporary diagram is cleared or replaced, the renderer should cleanly unmount with no residual state

---

## Error Handling

- If the input JSON is missing required fields (e.g. no `lanes`, no `steps`), the renderer must display a clear error state rather than crashing
- If a step references a `lane_id` that does not exist in `lanes`, the step is either skipped or placed in an "unknown lane" overflow area, with a visible warning
- If an edge references a step that does not exist, the edge is silently skipped (no crash)
- All error states must be recoverable: if corrected input is provided, the renderer re-renders correctly

---

## Compatibility with Existing Diagram Types

- The new diagram type and renderer must not affect the behaviour of any existing diagram types
- The type registry extension must be additive only
- No existing renderer code is modified as part of this feature

---

## Acceptance Criteria

1. A diagram type with identifier `user-journey` is registered in the frontend diagram type registry.
2. Given a valid temporary diagram JSON of type `user-journey`, the diagram workspace loads and renders it using the new native renderer.
3. The rendered diagram displays a title area at the top of the canvas, derived from `journey.title`.
4. The rendered diagram displays one horizontal swimlane per entry in `journey.lanes`, in order, each with its label visible in a lane header.
5. Each step in `journey.steps` is rendered as a box within the correct lane, displaying its label.
6. Steps with issues render visible issue badges indicating the correct severity (info, warning, error).
7. Edges between steps are rendered as directional arrows; cross-lane edges visibly route between different swimlane rows.
8. Layout is deterministic: rendering the same input JSON twice produces an identical visual output.
9. The renderer does not modify or interfere with any existing diagram type's rendering.
10. If the input JSON has missing required fields, the renderer displays an error state without throwing an unhandled exception.
11. The Increment 6 review flow can successfully display a generated User Journey temporary diagram using this renderer.
12. The rendered output uses the native tool visual style and does not resemble Mermaid or external SVG output.

---

## Testing Requirements

- Unit tests for the renderer covering:
  - Correct lane rendering from a minimal valid input
  - Correct step placement within lanes
  - Issue badge rendering for each severity level
  - Edge rendering including cross-lane edges
  - Error state rendering for invalid/incomplete input
- Integration test verifying that the diagram workspace correctly loads and renders a `user-journey` type temporary diagram end-to-end
- No existing diagram type tests should be broken by this change
