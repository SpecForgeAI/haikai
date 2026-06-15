# Spec Requirements: Render Temporary Architecture Diagrams in Frontend (Increment 4)

## Initial Description
Implement the frontend rendering pipeline for temporary architecture diagrams that were saved via the MCP endpoint (Increment 3). This is Increment 4 in a series:

- Increment 1: Contract definition (complete) -- TemporaryArchitectureDiagram TypeScript interfaces in `frontend/src/types/temporaryArchitectureDiagram.ts`
- Increment 2: Architect task framework (complete) -- LLM task that generates diagram payloads
- Increment 3: MCP endpoint for saving (complete) -- Backend persistence (PUT/GET) at `/api/projects/{projectId}/temporary-diagrams/{temporaryDiagramId}` in architecture-model-service, with retrieval support via `archModelClient.getTemporaryDiagram()`
- Increment 4: Frontend rendering (THIS increment)

The feature must fetch a saved TemporaryArchitectureDiagram from the backend, render it using a dedicated renderer within the existing Diagrams view (clearly marked as temporary/preview), with the primary entry point being a link from the chat panel after the Architect task generates the diagram. The view is strictly read-only with pan and zoom only.

## Requirements Discussion

### First Round Questions

**Q1:** The existing Canvas component's General/ER rendering path expects native DiagramNode objects with entity_id, entity_type, render_style: 'erd', and embedded_attribute_ids (which are then looked up from the meta-model via getAttributesByIds). The temporary contract uses self-contained compartments with display_name/ref_name items instead. I see two approaches: (a) Write a mapping function that transforms TemporaryArchitectureDiagram into a synthetic Diagram object (with fake DiagramNode[] and DiagramEdge[]) and inject it into the existing Canvas rendering pipeline, which would also require providing synthetic attribute data so getAttributesByIds works, or (b) Create a dedicated TemporaryDiagramRenderer component (similar to SequenceDiagramRenderer, ActivityDiagramRenderer, etc.) that renders the temporary contract directly as SVG without going through the native type system. I'm assuming option (b) is cleaner since the temporary diagram is self-contained and doesn't need meta-model lookups. Is that correct, or should we reuse the existing ER rendering path?
**Answer:** Use approach (b): create a dedicated TemporaryDiagramRenderer for this increment that renders directly from the TemporaryArchitectureDiagram contract, rather than fabricating synthetic native DiagramNode/DiagramEdge objects with fake IDs.

**Q2:** The existing ER edge rendering uses erEdgeSymbols.ts utilities (getEREdgeSymbols, getSymbolRenderData, calculateEdgeAngle, getEREdgeStrokeDasharray) that expect a LogicalERRelationship type. The temporary contract has relationship_type (optional, same enum values) and cardinality fields. I'm assuming the temporary diagram renderer should reuse these erEdgeSymbols.ts utility functions directly, since the enum values align. The renderer would call getEREdgeSymbols(edge.relationship_type) to get the right UML symbols (hollow triangles, diamonds, etc.) and use edge.cardinality for multiplicity labels. Is that correct?
**Answer:** Yes, reuse existing ER edge symbol/cardinality utilities wherever they are compatible (including getEREdgeSymbols() and related helpers), but do not contort the temporary contract to fit native assumptions; adapt at the renderer boundary only.

**Q3:** The app currently has four top-level views: dashboard, product, metamodel, diagrams. Within the diagrams view, the user selects from existing diagrams via DiagramSelector. For temporary diagrams, I see several options: (a) Add a new top-level view temporary-diagrams in the nav bar, (b) Add a section/indicator in the existing Diagrams view that shows available temporary diagrams alongside native ones, (c) Navigate to the temporary diagram from the chat/assistant panel where the LLM generated it (e.g., a "View Diagram" link in the chat bubble), or (d) Some combination. I'm assuming option (c) is the primary entry point -- the user clicks a link in the chat panel after the Architect task generates the diagram, which opens a read-only viewer. Is that the right approach? Should there also be a way to browse temporary diagrams from the Diagrams view?
**Answer:** Primary entry point should be from the chat panel immediately after successful generation (e.g. "View Diagram" / automatic handoff into Diagrams), with the temporary diagram displayed inside the existing Diagrams experience rather than adding a new permanent top-level nav in this increment.

**Q4:** When the user views a temporary diagram, should it: (a) Open in a full-screen overlay/modal with its own Canvas (separate from the Diagrams view), (b) Render inline within the existing Diagrams view as if it were a selected diagram (but marked as "temporary/preview"), or (c) Open in a new browser tab/route? I'm assuming option (a) -- a modal or overlay that hosts a read-only Canvas -- keeps the temporary diagram clearly distinct from the permanent model. Is that correct?
**Answer:** Use inline rendering within the existing Diagrams view, clearly marked as a temporary/preview diagram, not a full-screen overlay or brand-new route/tab.

**Q5:** The backend GET endpoint is at /api/projects/{projectId}/temporary-diagrams/{temporaryDiagramId}. Looking at the Vite proxy config, requests to /api/ (without /api/v1 or /api/v2 prefix) are proxied directly to the architecture-model-service (modelApiTarget). This means the frontend can call the existing endpoint directly without a gateway proxy route, since it matches the /api/ catch-all pattern. I'm assuming we do NOT need a new gateway route -- the frontend API client can call /api/projects/{projectId}/temporary-diagrams/{id} directly through the existing Vite proxy to the architecture-model-service. Is that correct, or should we route through the gateway for consistency?
**Answer:** Call the backend through the existing app/API path consistent with current project architecture; if direct /api proxying to architecture-model-service already exists cleanly, reuse that rather than introducing an unnecessary new gateway route in this increment.

**Q6:** The temporary diagram viewer should be read-only (no node dragging, no edge editing, no palette). I'm assuming we strip out all the editing affordances: no resize handles, no drag-to-move, no palette panel, no inspector panel, no context menus. Should we keep pan and zoom? I'm assuming yes -- the user needs to navigate the diagram. Is there any other interactivity that should be preserved (e.g., hover tooltips showing attribute details)?
**Answer:** Yes: keep the temporary diagram strictly read-only, with pan and zoom enabled; no drag, resize, palette, inspector editing, or mutation affordances in this increment; simple hover states/tooltips are optional but not required.

**Q7:** For ER nodes, the temporary contract's compartments carry display_name, ref_name, and metadata (with is_primary_key, is_foreign_key, data_type, is_nullable). The existing formatAttribute function in erdUtils.ts formats attributes as something like "PK name: VARCHAR(100)". I'm assuming the temporary diagram renderer should format compartment items similarly using the metadata fields (showing PK/FK icons/indicators and data_type). Should the format match the existing formatAttribute output exactly, or is a simpler format acceptable?
**Answer:** Match existing ER attribute presentation as closely as is practical for visual consistency, including PK/FK indication and data type display when available from the temporary contract, but do not block this increment on perfect parity with every native formatting nuance.

**Q8:** Is there anything explicitly out of scope that I haven't mentioned? For example: should we exclude support for the groups field in the temporary contract (schema groupings), exclude style overrides from the style fields on nodes/edges, or exclude any particular visual features?
**Answer:** Explicitly keep groups, advanced style overrides, custom themes, editing interactions, diagram browsing/management, export, printing, non-ER diagram rendering, and persisted/native-diagram replacement out of scope for this increment.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: SequenceDiagramRenderer -- Path: `frontend/src/components/DiagramsView/SequenceDiagramRenderer.tsx`
  - Dedicated renderer pattern that receives typed diagram data and produces SVG directly, without going through the Canvas's native DiagramNode/DiagramEdge rendering pipeline. The TemporaryDiagramRenderer should follow this architectural pattern.
- Feature: ActivityDiagramRenderer -- Path: `frontend/src/components/DiagramsView/ActivityDiagramRenderer.tsx`
  - Another example of a dedicated renderer mounted within the Canvas SVG element.
- Feature: StateDiagramRenderer -- Path: `frontend/src/components/DiagramsView/StateDiagramRenderer.tsx`
  - Same pattern; receives diagram + metaModel + zoom props.
- Feature: ER Edge Symbol Utilities -- Path: `frontend/src/utils/erEdgeSymbols.ts`
  - Provides `getEREdgeSymbols()`, `getSymbolRenderData()`, `calculateEdgeAngle()`, `getEREdgeStrokeDasharray()` for rendering UML relationship symbols (hollow triangles, diamonds, open arrows) and line styles (solid vs dashed). The temporary renderer should reuse these utilities directly since the `relationship_type` enum values align with `LogicalERRelationship`.
- Feature: ERD Rendering Utilities -- Path: `frontend/src/utils/erdUtils.ts`
  - Constants: `ERD_HEADER_HEIGHT` (30px), `ERD_ATTRIBUTE_ROW_HEIGHT` (20px), `ERD_MIN_WIDTH` (150px). Functions: `shouldRenderAsERD()`, `getAttributesByIds()`, `formatAttribute()`. The renderer should use the same constants for visual consistency. The `formatAttribute()` function takes `ERDAttribute { id, name, data_type? }` and produces formatted strings -- the renderer should produce similar output from compartment item fields.
- Feature: Canvas ERD rendering code -- Path: `frontend/src/components/DiagramsView/Canvas.tsx` (lines 2399-2462)
  - Shows exactly how ERD nodes are rendered in SVG: outer rect, header text (bold, centered), divider line, and attribute rows (left-aligned). The TemporaryDiagramRenderer should visually match this output.
- Feature: Canvas diagram type branching -- Path: `frontend/src/components/DiagramsView/Canvas.tsx` (lines 3312-3356)
  - Shows how the Canvas conditionally renders different diagram types (Sequence, Activity, State, UI_Workflow, General). The temporary diagram renderer will need to be integrated into this branching logic or a similar mechanism.
- Feature: TemporaryArchitectureDiagram contract -- Path: `frontend/src/types/temporaryArchitectureDiagram.ts`
  - The canonical TypeScript interfaces for the contract. Defines nodes with compartments, edges with nested labels, points, and groups.
- Feature: TemporaryArchitectureDiagram validation -- Path: `frontend/src/types/temporaryArchitectureDiagramValidation.ts`
  - Lightweight validation: `isTemporaryArchitectureDiagram()`, `isValidERDiagram()`, `checkSemanticTypeConsistency()`, `checkReferenceConsistency()`. May be useful for defensive validation before rendering.
- Feature: Model API client -- Path: `frontend/src/api/modelApi.ts`
  - Pattern for frontend API clients: uses `const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''` and plain `fetch()` calls. New temporary diagram API client should follow this pattern.
- Feature: Projects API client -- Path: `frontend/src/api/projectsApi.ts`
  - Another example of the API client pattern with snake_case-to-camelCase mapping.
- Feature: ArchitectureContext state management -- Path: `frontend/src/contexts/ArchitectureContext.tsx`
  - Manages `currentView`, `selectedDiagramId`, and diagram data. The temporary diagram state (loaded data, active temporary diagram ID) will need to integrate with this or a co-located state mechanism.
- Feature: DiagramsView component -- Path: `frontend/src/components/DiagramsView/DiagramsView.tsx`
  - The parent component hosting DiagramSelector, Canvas, PalettePanel, InspectorPanel, toolbar. The temporary diagram entry point needs to set state so that DiagramsView renders the temporary diagram renderer instead of the normal diagram rendering path.
- Feature: Diagram type system -- Path: `frontend/src/types/diagramType.ts`
  - Defines `DiagramType = 'General' | 'ER' | 'Sequence' | 'Activity' | 'State' | 'UI_Workflow' | 'UI_SCREEN'` and `getDiagramType()`. May need to be referenced or extended conceptually.
- Feature: Rendering utilities -- Path: `frontend/src/utils/rendering.ts`
  - Provides `getEntityColor()`, `getEntityLabel()`, `calculateArrowhead()`, `wrapText()`, etc. Some of these may be reusable by the temporary diagram renderer.
- Feature: Backend response DTO -- Path: `mcp-server/src/services/archModelClient.ts` (lines 19-26)
  - `TemporaryDiagramResponseDto { id, temporary_diagram_id, project_id, diagram_payload: object, created_at, updated_at }`. The `diagram_payload` field contains the full `TemporaryArchitectureDiagram` JSON.
- Feature: Backend controller -- Path: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/TemporaryDiagramController.java`
  - GET endpoint at `/api/projects/{projectId}/temporary-diagrams/{temporaryDiagramId}` returns `TemporaryDiagramDto`.
- Feature: Vite proxy configuration -- Path: `frontend/vite.config.ts`
  - The `/api/` catch-all proxy targets `modelApiTarget` (architecture-model-service at port 8080). The temporary diagram GET endpoint at `/api/projects/{projectId}/temporary-diagrams/{id}` will be proxied through this existing rule without changes.
- Feature: App rendering defaults -- Path: `frontend/src/config/defaults.ts`
  - Contains `appConfig.node.borderWidth`, `appConfig.node.borderRadius`, `diagramEditing.selectionColor`, etc. The renderer should reference these for visual consistency.

### Follow-up Questions
No follow-up questions were needed. All answers were comprehensive and unambiguous.

## Visual Assets

### Files Provided:
No visual assets provided. (Confirmed via mandatory filesystem check of `agent-os/specs/2026-03-26-render-temporary-architecture-diagrams/planning/visuals/`.)

### Visual Insights:
N/A

## Requirements Summary

### Functional Requirements

**Frontend API Client:**
- New API client function to fetch a temporary diagram by projectId + temporaryDiagramId
- Calls `GET /api/projects/{projectId}/temporary-diagrams/{temporaryDiagramId}` via the existing Vite proxy to architecture-model-service (no new gateway route needed)
- Follows existing `modelApi.ts` / `projectsApi.ts` patterns (plain fetch, API_BASE env variable)
- Response contains `TemporaryDiagramResponseDto` with `diagram_payload` field holding the full `TemporaryArchitectureDiagram` JSON
- Defensive validation of the fetched payload using `isTemporaryArchitectureDiagram()` and `isValidERDiagram()` from the existing validation helpers before rendering

**Dedicated TemporaryDiagramRenderer Component:**
- New React component following the pattern of `SequenceDiagramRenderer.tsx` / `ActivityDiagramRenderer.tsx` -- receives the `TemporaryArchitectureDiagram` data and renders SVG directly
- Does NOT fabricate synthetic native `DiagramNode[]` / `DiagramEdge[]` objects
- Renders self-contained data from the temporary contract without meta-model lookups
- ER Node rendering (ERD-style class-box):
  - Outer rect with position and dimensions from node's `pos_x`, `pos_y`, `width`, `height`
  - Header section: entity `display_name` rendered bold and centered, using `ERD_HEADER_HEIGHT` (30px) for visual consistency
  - Divider line below header
  - Attribute rows from `compartments[0].items` (the ATTRIBUTES compartment), rendered left-aligned at `ERD_ATTRIBUTE_ROW_HEIGHT` (20px) intervals
  - Attribute formatting: show PK/FK indicators and data_type from compartment item metadata, closely matching existing `formatAttribute()` output (e.g., "PK attribute_name: VARCHAR(255)")
  - Default entity colors consistent with existing ER node styling (referencing `getEntityColor()` values for LOGICAL_DATA_ENTITY / PHYSICAL_DATA_ENTITY)
- ER Edge rendering:
  - Polyline path from `edge_points` (sorted by `sequence_order`)
  - UML relationship symbols via existing `getEREdgeSymbols(edge.relationship_type)` and `getSymbolRenderData()` utilities
  - Line style (solid/dashed) via `getEREdgeStrokeDasharray()` based on `relationship_type`
  - Source/target labels rendered at the positions specified in `edge.source_label` / `edge.target_label` nested objects
  - Adaptation at the renderer boundary only -- pass `relationship_type` to existing utilities without contorting the contract
- Z-index ordering: respect `z_index` on nodes if present

**Navigation and Integration:**
- Primary entry point: a clickable link/action in the chat panel after the Architect task successfully generates and saves a temporary diagram
- Clicking the link navigates the user to the Diagrams view and triggers loading of the temporary diagram
- The temporary diagram renders inline within the existing Diagrams view experience
- Clear visual indicator that this is a temporary/preview diagram (e.g., banner, badge, or label reading "Preview" or "Temporary Diagram")
- State management: the DiagramsView needs a state flag or mode to indicate it is showing a temporary diagram rather than a native diagram, so that editing affordances are suppressed

**Read-Only View:**
- Pan and zoom enabled (user can navigate the diagram)
- No node dragging, resizing, or movement
- No resize handles shown
- No palette panel shown
- No inspector panel with editing capability shown
- No context menus
- No edge creation or waypoint editing
- No delete operations
- Simple hover states/tooltips are optional, not required

**Temporary Diagram Banner/Indicator:**
- When viewing a temporary diagram, a clear visual indicator must be present so the user knows this is not a native/persisted diagram
- The indicator should be non-intrusive but clearly visible (e.g., a top banner or a badge near the diagram title)
- Should display the diagram name from the temporary contract

### Reusability Opportunities
- ER edge symbol utilities (`erEdgeSymbols.ts`) are directly reusable since `relationship_type` enum values on the temporary contract align with `LogicalERRelationship`
- ERD rendering constants (`ERD_HEADER_HEIGHT`, `ERD_ATTRIBUTE_ROW_HEIGHT`) from `erdUtils.ts` should be used for visual consistency
- The formatting logic of `formatAttribute()` can be adapted for compartment items
- Entity color lookup (`getEntityColor()`) can be used with node `semantic_type` values
- The dedicated renderer pattern (`SequenceDiagramRenderer`, `ActivityDiagramRenderer`) provides an established component architecture to follow
- Rendering utility functions (`calculateArrowhead`, `wrapText`, etc.) from `rendering.ts` may be individually reusable
- App rendering defaults from `config/defaults.ts` should be used for consistent border widths, colors, etc.

### Scope Boundaries

**In Scope:**
- Frontend API client for fetching temporary diagrams (GET endpoint)
- Dedicated `TemporaryDiagramRenderer` component for rendering ER temporary diagrams as SVG
- ER node rendering with header, divider, and attribute rows from compartments
- ER edge rendering with polyline paths, UML symbols, and cardinality labels
- Navigation entry point from the chat panel
- Inline rendering within the Diagrams view with temporary/preview indicator
- Read-only view with pan and zoom
- Attribute formatting with PK/FK indicators and data type display
- Defensive validation of fetched payloads before rendering
- State management for temporary diagram mode in DiagramsView

**Out of Scope:**
- Groups rendering (the `groups` field on the temporary contract is ignored)
- Advanced style overrides from node/edge `style` fields (basic default styling only)
- Custom themes or color customization
- Any editing interactions (drag, resize, create, delete, waypoint editing)
- Diagram browsing/management UI (no list of temporary diagrams)
- Export or printing of temporary diagrams
- Non-ER diagram kind rendering (only `diagram_kind === "ER"` is supported)
- Finalization/confirmation modal to convert temporary diagram to native/persisted diagram
- Architecture ID resolution/mapping (`ref_name` to `entity_id`)
- Modification of the native diagram persistence schema
- New gateway proxy routes
- New top-level navigation entries
- Hover tooltips (optional, not required)

### Technical Considerations

**Data flow:**
1. Chat panel: user receives confirmation that Architect task generated a diagram, sees "View Diagram" link
2. User clicks link: app navigates to Diagrams view, sets temporary diagram mode with projectId + temporaryDiagramId
3. DiagramsView detects temporary diagram mode, triggers fetch via new API client
4. API client calls `GET /api/projects/{projectId}/temporary-diagrams/{temporaryDiagramId}` through the existing Vite `/api/` proxy (port 8080 -> architecture-model-service)
5. Response: `TemporaryDiagramResponseDto` with `diagram_payload` containing full `TemporaryArchitectureDiagram`
6. Frontend validates payload using existing validation helpers
7. `TemporaryDiagramRenderer` receives the validated `TemporaryArchitectureDiagram` and renders SVG inline

**Backend response shape (from mcp-server/archModelClient.ts):**
```typescript
interface TemporaryDiagramResponseDto {
  id: string;                    // internal DB UUID
  temporary_diagram_id: string;  // client/LLM-provided diagram ID
  project_id: string;            // project UUID
  diagram_payload: object;       // full TemporaryArchitectureDiagram JSON
  created_at: string;            // ISO timestamp
  updated_at: string;            // ISO timestamp
}
```

**Key mapping considerations for the renderer:**
- Node positions: `pos_x`, `pos_y`, `width`, `height` map directly (same coordinate system as native `DiagramNode`)
- Node labels: use `display_name` (not `ref_name`) for visual rendering
- Attribute rendering: iterate `compartments[0].items` where `compartment_kind === 'ATTRIBUTES'`, format each item using `display_name`, `metadata.is_primary_key`, `metadata.is_foreign_key`, `metadata.data_type`
- Edge path: convert `edge_points` (sorted by `sequence_order`) into SVG polyline points
- Edge symbols: call `getEREdgeSymbols(edge.relationship_type as LogicalERRelationship)` at the renderer boundary; handle missing/undefined `relationship_type` gracefully (default to no symbol / ASSOCIATION)
- Edge labels: use nested `source_label.text` at `source_label.pos_x`/`source_label.pos_y` (and same for `target_label`), not the flat native field pattern
- Edge line style: derive from `relationship_type` using `getEREdgeStrokeDasharray()` or from `edge.style.line_type` if present

**State management approach:**
- The DiagramsView currently tracks `selectedDiagramId` via `ArchitectureContext`
- For temporary diagrams, a parallel state mechanism is needed (e.g., `temporaryDiagramMode: { active: boolean, projectId: string, temporaryDiagramId: string, data: TemporaryArchitectureDiagram | null }`)
- When `temporaryDiagramMode.active` is true, DiagramsView suppresses normal diagram rendering and shows the TemporaryDiagramRenderer instead
- The existing palette, inspector, and editing toolbar elements should be hidden or disabled in temporary diagram mode

**Proxy configuration (no changes needed):**
- `frontend/vite.config.ts` already proxies `/api/` to `modelApiTarget` (architecture-model-service, default port 8080)
- The backend endpoint `/api/projects/{projectId}/temporary-diagrams/{temporaryDiagramId}` matches this catch-all proxy rule
- No new gateway route is needed; the frontend talks directly to architecture-model-service for this read

**Testing approach:**
- Frontend tests use Vitest with `vi.mock()`
- Component tests for TemporaryDiagramRenderer: provide mock TemporaryArchitectureDiagram data, verify SVG output
- API client tests: mock fetch calls, verify correct URL construction and response parsing
- Integration considerations: verify the renderer produces visually consistent output with existing ERD rendering
