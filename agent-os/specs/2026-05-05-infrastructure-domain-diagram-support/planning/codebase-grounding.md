# Codebase Grounding Notes — Spec 5 (Infrastructure Diagram Support)

Notes captured during Pass A research before drafting requirements. Frontend-only spec.

## Diagram engine — custom SVG, NOT React Flow

- No `react-flow` / `@xyflow` / `dagre` / `elkjs` dependencies anywhere in `frontend/` (grepped src + package.json).
- Renderer is hand-rolled SVG in `frontend/src/components/DiagramsView/Canvas.tsx` (3782 lines) plus type-specific renderers (`StateDiagramRenderer.tsx`, `ActivityDiagramRenderer.tsx`, `SequenceDiagramRenderer.tsx`, `UIScreenDiagramRenderer.tsx`, `UIWorkflowDiagramRenderer.tsx`, `UserJourney*.tsx`).
- Helpers: `frontend/src/utils/rendering.ts` (2016 lines), `frontend/src/utils/shapeRendering.ts` (decoration shapes), `frontend/src/utils/nodeCreation.ts` (creates `DiagramNode`s from entity refs), `frontend/src/utils/relationshipUtils.ts` (creates `DiagramEdge`s).

## Native nesting — `parent_node_id` already supported

`DiagramNode` (model.ts:1895) already has `parent_node_id: string | null`. Containment hierarchy is a first-class concept. Existing precedents:

- `APPLICATION` -> `APP_COMPONENT` parent/child (Application domain).
- `BUSINESS_PROCESS` -> `PROCESS_ACTIVITY` parent/child (Business domain).
- `INTERFACE` -> `ENDPOINT` parent/child (Application domain).
- `ACTIVITY_PARTITION` swimlanes contain `ACTIVITY` nodes (Behavioural).

`compoundLayout.ts` provides `calculateChildPositionWithHeights`, `calculateParentSizeWithHeights` and similar helpers for parent-with-children sizing. The "Add child to parent" flow in PalettePanel auto-resizes parents.

Implication: the raw idea's hierarchy (Environment > CloudAccount > Location > Network > Subnet > resources) maps directly onto repeated `parent_node_id` chains. No new engine code needed. Container vs node distinction is purely cosmetic (default size + auto-resize-on-children).

## DiagramType enum

`frontend/src/types/diagramType.ts` — `DiagramType` union: `'General' | 'ER' | 'Sequence' | 'Activity' | 'State' | 'UI_Workflow' | 'UI_SCREEN' | 'USER_JOURNEY' | 'USER_JOURNEY_OVERVIEW'`.

- `CREATABLE_DIAGRAM_TYPES` excludes the two generated user-journey types.
- `DIAGRAM_TYPE_LABELS: Record<DiagramType, string>`.
- `DIAGRAM_TYPE_MAP` for case-insensitive normalisation.
- `Diagram.diagram_type?: string` (model.ts:2077) — stored loose, normalised on read via `getDiagramType`.

To add a new diagram type, you extend the union, add a label, add to `CREATABLE_DIAGRAM_TYPES` (or not), and add a normalisation key. Then add a row to `DIAGRAM_TYPE_PALETTE_RULES` in `paletteData.ts`.

## Palette pattern

- `frontend/src/utils/paletteData.ts` — single big function `getPaletteSections(metaModel, search, domain?, diagramType?)` returns `PaletteSection[]`. Each section has `id`, `label`, `items: {id, name}[]`, `type: 'entity' | 'relationship'`.
- `entitySections` is a hardcoded array literal listing every entity type, mapping `metaModel.entities.<key>` to `{id, name}` items.
- `relationshipSections` is the same for relationships.
- Two layers of filtering applied AFTER section construction:
  1. `domainToPaletteSections[domain]` — entity-section IDs allowed for that domain.
  2. `DIAGRAM_TYPE_PALETTE_RULES[diagramType]` — section IDs allowed for that diagram type (or `null` for "all").
- **Spec 3 already added `infrastructure: []` placeholders to both `DOMAIN_ENTITY_SECTIONS` and `domainToPaletteSections`.** Spec 5 must replace those with real lists.
- `getEntityTypeConstant(entityKey)` maps palette section IDs to `ENTITY_TYPES.<CONST>` for node creation.

## Click-to-add (NOT drag-drop)

`PalettePanel.tsx:1674` — `handleItemClick(item, sectionId, itemType)` is the entry point. Dispatches to `createDiagramNodeFromEntity(entity_type, entity_id, existingNodes, viewportCenter)` from `frontend/src/utils/nodeCreation.ts`.

- Default node spawns at `(100, 100)` with `DEFAULT_NODE_WIDTH=120` / `DEFAULT_NODE_HEIGHT=60`, `parent_node_id: null`.
- ER-specific override: `shouldCreateERDNode(entityType, diagramType)` returns true for ER + LOGICAL/PHYSICAL_DATA_ENTITY, then `createERDNodeFromEntity` is used instead.
- Auto-parent-wrapping is handled inline in PalettePanel for known parent/child pairs (Application -> AppComponent, BusinessProcess -> ProcessActivity, Interface -> Endpoint).

## Color/visual treatment

`frontend/src/config/defaults.ts:417` — `entityColors: Record<string, EntityColors>` is a flat map keyed by `ENTITY_TYPES.<CONST>` value. Each entry: `{ background: hex, border: hex }`. Lookup in `rendering.ts` via `getEntityColor`, `getNodeFillColor`, `getNodeBorderColor`. Falls back to grey `#f5f5f5/#616161`.

To add Infrastructure entities: append 12 (or 13 with `INFRASTRUCTURE_POINT`) entries to this map.

## Shape rendering

Default node shape is rectangle. Specialised cases:
- `BUSINESS_USER` -> stick man (special path).
- `LOGICAL_DATA_ENTITY` / `PHYSICAL_DATA_ENTITY` with `render_style: 'erd'` -> ERD class-box.
- `INTERFACE` with custom rendering -> contract style with embedded endpoints.
- `STATE` -> shape varies by `state_kind` (Initial=filled circle, Final=double circle, Normal=rounded rect).
- `ACTIVITY` -> shape varies by `activity_kind` (Initial/Final/Decision/Merge/Action).

`shapeRendering.ts` provides `renderOval`, `renderDiamond`, `renderHexagon`, `renderCylinder`, `renderTrapezoid`, `renderCircle`, `renderParallelogram`, `renderNote` — but these are for **decorations**, not entity nodes. Entity-node shape choice is hardcoded per-entity-type in Canvas.tsx and renderers.

For Infrastructure V1, easiest path: all 12 entity types render as standard rounded rectangles, differentiated by colour + label. The 6 "container-like" types (Environment, CloudAccount, Location, Network, Subnet, ComputeCluster) get bigger default sizes and rely on `parent_node_id` for nesting. No new shape paths required.

If we want a database cylinder for `DATA_STORE_INSTANCE` we could reuse `renderCylinder` from `shapeRendering.ts`, but this adds complexity — recommend deferring.

## SelectionInspector — hand-rolled per entity type, NOT gridConfigs-driven

`frontend/src/components/DiagramsView/SelectionInspector.tsx` (1179 lines) has hard-coded field lists per `entity_type` and `relationship_type`. Currently supports STATE, ACTIVITY, ACTIVITY_PARTITION, LOGICAL_DATA_ENTITY, PHYSICAL_DATA_ENTITY, STATE_TRANSITION, ACTIVITY_FLOW.

`gridConfigs` from spec 4 is NOT consumed by the inspector. Adding all 12 + 3 to the inspector would be a major hand-coded extension. Two reasonable options for spec 5:

1. **Minimal**: only show name + description fields for Infra nodes (mirrors LOGICAL_DATA_ENTITY today). Edits flow through existing entity update dispatch. Power users edit the rest in the Tables UI.
2. **Full**: hand-roll a new branch for each of the 12 + 3 with field sets mirroring spec 4's gridConfigs columns. Several hundred extra lines.

This is the single biggest scope question for spec 5.

## Diagram serialization / save

- Diagrams live inside `MetaModel.diagrams: Diagram[]` (NOT a separate file).
- Saved via the full-model `PUT /api/model/projects/{projectId}/architectures/{architectureId}` endpoint (frontend/src/api/modelApi.ts:106 `saveModelByFilename`).
- Each `Diagram` carries `diagram_nodes: DiagramNode[]` + `diagram_edges: DiagramEdge[]` + `decorations`, `interaction_edges`, `typedContent`, `view_quarter`, etc.
- `DiagramNode.entity_id` references the underlying meta-model entity by id; `DiagramEdge.relationship_id` references the relationship by id.
- Spec 3's `normalizeModelFromApi` already backfills the 13 + 3 Infra arrays. Round-trip is already wired.

## Edge creation (relationship -> diagram edge)

`frontend/src/utils/relationshipUtils.ts:874` — `createRelationshipEdge(relationship, edgeType, sourceNode, targetNode, options)` returns a `DiagramEdge` with type-specific styling. Adds cases per `RELATIONSHIP_EDGE_TYPES` constant. `RELATIONSHIP_EDGE_TYPES` (model.ts:1418) has no Infrastructure entries — needs 3 new ones added.

`isRelationshipRowEnabled` (line 329) — pure switch on relationship-type key — has no Infrastructure cases (returns `endpoints_missing` for unknown types). Needs 3 new arms or a polymorphic-aware extension.

`getEntitiesOnDiagram` builds Sets per entity-type to enable O(1) row-enable checks. Today it special-cases `business_points` and `application_points` (mapping concrete-entity nodes -> derived-point ids). For Infra, the analogous mapping is `infrastructure_points` <- 12 concrete entity types. Either mirror that pattern or accept the simpler "edge enables only when both polymorphic-resolved-targets are on the diagram" check.

## Auto-layout

`compoundLayout.ts` does parent-with-children layout (existing parent/child entity pairs). No general-purpose Dagre-style auto-layout. New nodes spawn at `(100, 100)` and the user drags from there.

For Infrastructure V1, the raw idea explicitly says "good enough for high-level architecture agreement" and out-of-scope says "Avoid building complex cloud-specific layout automation". Manual placement only is consistent with existing diagram types. No new layout code needed.

## Tests

`frontend/src/components/DiagramsView/__tests__/` is Vitest. Patterns:
- Renderer-specific tests (e.g. `StateDiagramRenderer.test.tsx`, `UserJourneyDiagramRenderer.test.tsx`).
- `DiagramSelector.test.tsx` for selector / new-modal flows.
- `diagramExtractionUtils.test.ts` for utilities.

Spec 4 added `frontend/src/config/__tests__/infrastructureTablesConfig.test.ts`. A sibling `infrastructureDiagramConfig.test.ts` (palette, diagram-type registration, edge-type constants) is the cheapest viable test for spec 5.

## What spec 3 / 4 already gave us

- Type interfaces for all 12 + InfrastructurePoint + 3 relationships (model.ts:2150+).
- `ArchitectureDomain.infrastructure` registered with Server icon.
- `RELATIONSHIP_DEFINITIONS` has 3 Infra entries (relationshipDefinitions.ts:117/124/131) — `endpointEntityTypes` already declared. Palette-section-derivation will pick these up the moment we put the relationship section into `relationshipSections` array in `paletteData.ts`.
- `ENTITY_TYPE_TO_DOMAIN` has 13 mappings to `'infrastructure'`.
- `RELATIONSHIP_TAB_ORDER` has the 3 Infra display names.
- `infrastructure_point_picker` cellType + `InfrastructurePointPickerCell.tsx` for tables UI.
- `infrastructurePointDerivation.ts` find-or-create helper.
- `infrastructurePointDisplayFormatter` in `formatters.ts`.

## What's deferred / placeholder

- `paletteData.ts` `DOMAIN_ENTITY_SECTIONS.infrastructure: []` and `domainToPaletteSections.infrastructure: []` (lines 86 + 147) — left for spec 5.
- `DIAGRAM_TYPE_PALETTE_RULES` has no entry for any new infrastructure diagram type. Spec 5 must add it.
- `DiagramType` union has no `'Infrastructure'` value. Spec 5 must extend.
- `entityColors` has no Infra entries.
- `RELATIONSHIP_EDGE_TYPES` has no Infra entries.
- `isRelationshipRowEnabled` switch has no Infra cases.
- `getEntityTypeConstant` mapping has no Infra entries.
- `entitySections` array in `paletteData.ts:351` has no Infra sections.
- `ENTITY_TYPES` (model.ts:1376) has no Infra constants — though spec 3's interfaces don't depend on these. But `DiagramNode.entity_type` carries SCREAMING_SNAKE_CASE values that match `point_kind` discriminator values in spec 3.

## Open scope questions feeding the question list

1. Diagram type name and granularity — one `'Infrastructure'` type, or split into multiple sub-types (e.g. Network vs Compute) like UI was split into UI_Workflow + UI_SCREEN?
2. Container types — special rendering or just bigger default size + colour + nesting?
3. Polymorphic point endpoints on the diagram — mirror the BUSINESS_POINT pattern (concrete entity nodes auto-map to a point, edges target points), or attach edges directly to the concrete entity nodes (no point nodes ever drawn)?
4. SelectionInspector scope — minimal name+description, or full per-entity field set?
5. Edge creation UX — palette-list-of-existing-relationships click-to-add (current pattern for ER, data movements), or canvas-click-source-then-target draw mode (current pattern for State, Activity, UI Workflow)?
6. "Resource hosted in Subnet" — drawn as edge OR auto-set `parent_node_id` (containment). The raw idea allows both; we should pick one for V1.
7. Test scope — config-only test like spec 4, or also a renderer/integration test?
8. Provider icons — provider-neutral by mandate; do we still allow tiny GCP/AWS/Azure indicators on shapes, or fully neutral?
9. Secondary labels (provider, region, CIDR, etc.) — render below the main name, or only show in inspector?
