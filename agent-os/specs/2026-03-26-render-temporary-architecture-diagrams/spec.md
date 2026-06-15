# Specification: Render Temporary Architecture Diagrams in Frontend (Increment 4)

## Goal
Implement the frontend rendering pipeline that fetches a saved TemporaryArchitectureDiagram from the backend, renders it as a read-only ER diagram inside the existing Diagrams view (clearly marked as temporary/preview), with the primary entry point being a clickable link from the chat panel after the Architect task generates the diagram.

## User Stories
- As an architect using the chat panel, I want to click a "View Diagram" link after the LLM generates an ER diagram so that I can immediately see the visual output inline within the Diagrams view.
- As a user viewing a temporary diagram, I want a clear visual indicator that this is a preview/temporary diagram (not a persisted native diagram) so that I understand its status, and I want pan and zoom to navigate the diagram without any editing affordances.

## Specific Requirements

**Frontend API Client for Temporary Diagrams**
- Create a new API client function `fetchTemporaryDiagram(projectId: string, temporaryDiagramId: string)` in a new file `frontend/src/api/temporaryDiagramApi.ts`
- Follow the established `modelApi.ts` pattern: use `const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''` and plain `fetch()` calls
- Call `GET /api/projects/{projectId}/temporary-diagrams/{temporaryDiagramId}` -- this routes through the existing Vite `/api/` catch-all proxy to `modelApiTarget` (architecture-model-service on port 8080); no new gateway route is needed
- Parse the response as `TemporaryDiagramResponseDto` (fields: `id`, `temporary_diagram_id`, `project_id`, `diagram_payload`, `created_at`, `updated_at`) and extract `diagram_payload` as the `TemporaryArchitectureDiagram`
- Validate the extracted payload using `isTemporaryArchitectureDiagram()` and `isValidERDiagram()` from `temporaryArchitectureDiagramValidation.ts` before returning it; throw a descriptive error if validation fails

**TemporaryDiagramRenderer Component**
- Create a new React component `TemporaryDiagramRenderer` in `frontend/src/components/DiagramsView/TemporaryDiagramRenderer.tsx`
- Follow the dedicated renderer pattern established by `SequenceDiagramRenderer.tsx`, `ActivityDiagramRenderer.tsx`, and `StateDiagramRenderer.tsx` -- receive typed diagram data and produce SVG elements directly, without fabricating synthetic native `DiagramNode[]`/`DiagramEdge[]` objects
- Props interface: `{ diagram: TemporaryArchitectureDiagram; zoom: number }`
- The component does NOT perform meta-model lookups; all data is self-contained in the `TemporaryArchitectureDiagram` contract
- Only `diagram_kind === "ER"` is supported in this increment; render an empty state or warning message for unsupported diagram kinds

**ER Node Rendering**
- Render each node as an ERD-style class-box following the exact SVG structure from `Canvas.tsx` lines 2399-2462 for visual consistency
- Outer `<rect>` positioned at `node.pos_x`, `node.pos_y` with `node.width`, `node.height`; use `appConfig.node.borderWidth` (2px) for stroke width, `rx={0}` (square corners matching native ERD)
- Header section: render `node.display_name` bold and centered within the top `ERD_HEADER_HEIGHT` (30px) band
- Divider `<line>` at `y = node.pos_y + ERD_HEADER_HEIGHT`
- Attribute rows: iterate `compartments` array, find the compartment with `compartment_kind === 'ATTRIBUTES'`, and render each item at `ERD_ATTRIBUTE_ROW_HEIGHT` (20px) intervals, left-aligned with 8px x-padding
- Format each attribute item to match existing `formatAttribute()` output: show `display_name : data_type` when `metadata.data_type` is present, prefix with "PK " for `metadata.is_primary_key` and "FK " for `metadata.is_foreign_key`
- Default node fill/stroke colors: use `getEntityColor(node.semantic_type)` which returns `{ background: '#FFF3E0', border: '#F57C00' }` for both `LOGICAL_DATA_ENTITY` and `PHYSICAL_DATA_ENTITY`
- Sort nodes by `z_index` (ascending, nulls treated as 0) before rendering to respect draw order

**ER Edge Rendering**
- Render each edge as a polyline from `edge_points` sorted by `sequence_order` ascending
- Reuse existing ER edge symbol utilities at the renderer boundary: call `getEREdgeSymbols(edge.relationship_type as LogicalERRelationship)` to get `sourceSymbol`, `targetSymbol`, and `lineStyle`; handle `undefined` `relationship_type` gracefully (defaults to ASSOCIATION -- no symbols, solid line)
- Render UML endpoint symbols using `getSymbolRenderData()` and `calculateEdgeAngle()` from `erEdgeSymbols.ts`
- Derive line dash pattern from `getEREdgeStrokeDasharray(lineStyle)` for the polyline stroke-dasharray
- Render `source_label` and `target_label` as `<text>` elements at their respective `pos_x`/`pos_y` coordinates when present -- these use the nested object structure from the temporary contract, not the native flat field pattern

**Temporary Diagram State Management in DiagramsView**
- Add a new state object to `DiagramsView` component (via `useState`): `temporaryDiagramState: { active: boolean; projectId: string; temporaryDiagramId: string; data: TemporaryArchitectureDiagram | null; loading: boolean; error: string | null }`
- When `temporaryDiagramState.active` is true, DiagramsView renders the `TemporaryDiagramRenderer` instead of the normal Canvas/diagram-type branching
- When in temporary diagram mode, hide or suppress: PalettePanel, InspectorPanel, editing toolbar, DiagramSelector, context menus, resize handles, and all mutation affordances
- Provide a "close" or "back" action that clears `temporaryDiagramState` and returns to the normal diagram view
- Pan and zoom remain enabled (reuse existing Canvas zoom/pan machinery or replicate the SVG viewBox transform approach used by the Canvas)

**Temporary Diagram Banner/Indicator**
- When viewing a temporary diagram, display a clearly visible banner or badge indicating this is a "Temporary Diagram" or "Preview"
- The banner should show the diagram name from the `TemporaryArchitectureDiagram.name` field
- Position the banner non-intrusively (e.g., above the SVG canvas or as an overlay bar) so it does not obscure diagram content
- Include a close/dismiss button or "Back to Diagrams" action on the banner

**Chat Panel Entry Point (View Diagram Link)**
- After the Architect task (`architect--generate-architecture-diagram`) successfully generates and saves a temporary diagram, the assistant's response message in the chat panel contains the diagram payload in a `json:temporaryArchitectureDiagram` code block
- Parse the assistant message in the chat panel to detect this code block; when present, render a clickable "View Diagram" link/button below or within the message bubble
- When clicked, extract the `diagram.id` from the parsed payload, then trigger navigation: dispatch `SET_VIEW` with `'diagrams'` to navigate to the Diagrams view, and set `temporaryDiagramState` with the `projectId` (from the active project context) and `temporaryDiagramId` (the `diagram.id`)
- The DiagramsView component detects the active temporary diagram state, triggers the API fetch, and renders the diagram upon successful load

**Error Handling**
- API fetch failure (network error, 404, 500): display an error state within the DiagramsView temporary diagram area with the error message and a retry/close action
- Validation failure (payload does not pass `isTemporaryArchitectureDiagram()` or `isValidERDiagram()`): display a descriptive error indicating the diagram data is malformed
- Unsupported `diagram_kind` (non-ER): display a message indicating only ER diagrams are supported in this version
- Missing or empty `compartments` on a node: render the node with header only (no attribute rows), do not crash
- Missing `edge_points` or empty array on an edge: skip rendering that edge gracefully

## Visual Design
No visual mockups provided. The renderer should visually match the existing ERD node rendering in `Canvas.tsx` (lines 2399-2462) as closely as practical, using the same constants, fonts, and colors.

## Existing Code to Leverage

**Dedicated Renderer Pattern (SequenceDiagramRenderer, ActivityDiagramRenderer, StateDiagramRenderer)**
- These components demonstrate the established pattern: receive typed data props and produce SVG elements directly, mounted within the Canvas SVG container
- `TemporaryDiagramRenderer` should follow the same architectural approach but with its own props interface (`TemporaryArchitectureDiagram` + `zoom`)
- The Canvas diagram-type branching at `Canvas.tsx` lines 3312-3356 shows how renderers are conditionally selected; a similar mechanism (at the DiagramsView level) should switch between normal Canvas rendering and TemporaryDiagramRenderer

**ER Edge Symbol Utilities (`erEdgeSymbols.ts`)**
- `getEREdgeSymbols(relationshipType)` returns `{ sourceSymbol, targetSymbol, lineStyle }` -- directly compatible with the temporary contract's `relationship_type` enum values (GENERALIZATION, REALIZATION, COMPOSITION, AGGREGATION, ASSOCIATION, DEPENDENCY)
- `getSymbolRenderData(symbolType, x, y, angle)` produces SVG path data for UML symbols (hollow triangles, filled/hollow diamonds, open arrows)
- `calculateEdgeAngle(x1, y1, x2, y2)` and `getEREdgeStrokeDasharray(lineStyle)` are directly reusable

**ERD Rendering Utilities and Constants (`erdUtils.ts`)**
- Constants `ERD_HEADER_HEIGHT` (30px), `ERD_ATTRIBUTE_ROW_HEIGHT` (20px), `ERD_MIN_WIDTH` (150px) should be reused for visual consistency
- `formatAttribute()` produces `"name : type"` format; the temporary renderer should produce equivalent output from compartment item fields with added PK/FK prefix

**Entity Colors and App Config (`config/defaults.ts`, `utils/rendering.ts`)**
- `entityColors` map provides `LOGICAL_DATA_ENTITY` and `PHYSICAL_DATA_ENTITY` colors: `{ background: '#FFF3E0', border: '#F57C00' }`
- `getEntityColor(entityType)` in `rendering.ts` wraps this lookup with a fallback
- `appConfig.node.borderWidth` (2px) should be used for ERD node stroke width

**API Client Pattern (`modelApi.ts`, `projectsApi.ts`)**
- Both use `const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''` and plain `fetch()` with error handling via `res.ok` check
- The Vite proxy config in `vite.config.ts` already routes `/api/` to `modelApiTarget` (port 8080), which covers the `/api/projects/{projectId}/temporary-diagrams/{id}` endpoint with no changes needed

## Out of Scope
- Groups rendering (the `groups` field on the temporary contract is ignored in this increment)
- Advanced style overrides from node/edge `style` fields (only default styling based on `semantic_type` is applied)
- Custom themes or color customization for temporary diagrams
- Any editing interactions: drag, resize, create, delete, waypoint editing, context menus
- Diagram browsing/management UI (no list or gallery of temporary diagrams)
- Export or printing of temporary diagrams
- Non-ER diagram kind rendering (only `diagram_kind === "ER"` is supported)
- Finalization/confirmation workflow to convert a temporary diagram into a persisted native diagram
- Architecture ID resolution/mapping (`ref_name` to `entity_id`)
- Modification of the native diagram persistence schema or native `Diagram`/`DiagramNode`/`DiagramEdge` types
- New gateway proxy routes
- New top-level navigation entries in the nav bar
- Hover tooltips on nodes or edges (optional, not required)
