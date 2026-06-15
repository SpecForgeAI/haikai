# Requirements: Diagram View RHS UI Domain Palette

## Title
Diagram View RHS - add UI domain (monitor-smartphone) with 4 collapsible sections and add/delete-from-diagram behavior for UI entities

## Scope
frontend-only

## Increment
extend Diagram View RHS domain selector + palette behavior for UI entities (simple box nodes only)

## Intent
Add a new "UI" domain to the Diagram View RHS palette/editor panel:
- Selecting UI shows 4 collapsible sections for the 4 UI meta-model entity types
- Rows allow adding/removing those entities to/from the current diagram canvas as simple box nodes
- If an entity is already on the current diagram, its row is greyed out and context menu shows Delete (diagram-only)

This mirrors established patterns in Activity/State/ER palettes:
- diagram references meta-model entities; add/remove affects diagram only; underlying entities remain.

## Non-Goals
- No new UI entity creation flows in Diagram View (creation remains in Meta-Model view / existing flows)
- No edges/semantics rendering for UI entities here (simple boxes only)
- No backend changes
- No changes to UI_SCREEN editor or UI_WORKFLOW editor beyond RHS domain selector integration if needed

## Acceptance Criteria
1) RHS domain selector includes a UI icon (lucide MonitorSmartphone) after Behavioural.
2) Selecting UI shows 4 collapsible sections:
   - UI Screens
   - UI Workflow Transitions
   - UI Components
   - UI Actions
3) Each section lists all entities of that type in the project meta-model (unfiltered), with rows:
   - normal when not on diagram
   - greyed out when already on diagram
4) Adding:
   - left-click row adds to current diagram as a simple box node (or right-click -> Add)
   - placement uses current generic spawn rule (100,100) unless diagram type has its own placement
5) Removing:
   - right-click row shows only Delete when already on diagram
   - Delete removes the diagram node(s) for that entity only (meta-model unchanged)
   - After Delete, row is no longer greyed out and right-click shows Add again
6) Works on diagram types that support generic nodes (General, ER, Activity, State, UI_WORKFLOW, etc.).
   - If a diagram type explicitly does not support generic palette adds (e.g., Sequence, UI_SCREEN), UI domain selector may remain visible but sections should show a clear disabled state or "Not available for this diagram type".

## Implementation Steps

### 1) Add UI to RHS domain selector
- File: frontend/src/components/DiagramsView/RightPanel/DomainSelector.tsx (or wherever domain icons are rendered in Diagram View RHS)
- Add new domain option:
  - key: "UI"
  - label: "UI"
  - icon: MonitorSmartphone from lucide-react
- Ensure ordering places UI after Behavioural.

### 2) Implement UI domain palette content with 4 collapsible sections
- File: frontend/src/components/DiagramsView/PalettePanel.tsx (or domain-specific palette component)
- When selectedDomain === "UI", render:
  - CollapsibleSection "UI Screens"
  - CollapsibleSection "UI Workflow Transitions"
  - CollapsibleSection "UI Components"
  - CollapsibleSection "UI Actions"

Data sources (canonical, unfiltered project meta-model):
- uiScreens = model.metaModel.entities.ui_screens ?? []
- uiWorkflowTransitions = model.metaModel.entities.ui_workflow_transitions ?? []
- uiComponents = model.metaModel.entities.ui_components ?? []
- uiActions = model.metaModel.entities.ui_actions ?? []

Row label display:
- UIScreen: name + (route) if present
- UIWorkflowTransition: name, plus "source -> target" if source/target can be resolved
- UIComponent: name + [type] if present
- UIAction: name + [trigger/effect] if present

### 3) "Is on diagram" computation (single source of truth)
- Determine presence based on diagram contents, not cached UI state.
- Define helper:
  isEntityOnDiagram(entityType, entityId, diagram): boolean
Rules:
- For nodes, check diagram.diagram_nodes for nodes that reference:
  - node.entity_type == <entityType> AND node.entity_id == <entityId>
(Use the same fields/shape used by other entity-backed nodes in your app; do not invent new.)
- Grey-out row if true.

### 4) Add behavior (left-click + context menu Add)
- Left-click on a non-greyed row triggers add-to-diagram:
  - Create a DiagramNode:
    - id: uuid
    - entity_type: UI_SCREEN / UI_WORKFLOW_TRANSITION / UI_COMPONENT / UI_ACTION (matching registered entity types)
    - entity_id: entity.id
    - label: derived from entity (as above)
    - pos_x/pos_y: use standard spawn origin for generic adds (currently 100,100)
    - width/height: default node size (reuse general node defaults)
  - Append to diagram.diagram_nodes
  - Persist diagram using existing update/save pipeline (same as other palette adds)

- Right-click on a non-greyed row opens context menu with single item:
  - Add
  - Selecting Add performs the same as left-click.

### 5) Delete behavior (context menu Delete only; diagram-only)
- Right-click on a greyed row opens context menu with single item:
  - Delete
- Selecting Delete:
  - Remove all diagram nodes matching (entity_type, entity_id) from diagram.diagram_nodes
  - Persist diagram
- Do NOT delete meta-model entities.
- After delete, isEntityOnDiagram becomes false and row un-greys.

No cascading deletes required in this increment (keep simple):
- Deleting a UIScreen box does not auto-delete UIWorkflowTransition boxes, etc.
(If later desired, add as separate increment.)

### 6) Diagram-type availability rules
- If current diagram type is Sequence or UI_SCREEN (custom editors not using palette):
  - UI domain sections should render in a disabled state:
    - show a message: "UI palette is not available for this diagram type."
  - Do not attempt to add nodes (no-op).
This matches existing behavior where palette is not used for those types.

### 7) Ensure UI entity types are registered as "known node entity types"
- If you already added UI_SCREEN to the entity-type registry, extend it to include:
  - UI_WORKFLOW_TRANSITION
  - UI_COMPONENT
  - UI_ACTION
- Update:
  - entity-type whitelist / validation
  - entity lookup (entityType -> model.metaModel.entities.<collection>)
So labels and existence checks work and diagrams load without "unknown entity type" errors.

Mapping requirements:
- UI_SCREEN -> ui_screens
- UI_WORKFLOW_TRANSITION -> ui_workflow_transitions
- UI_COMPONENT -> ui_components
- UI_ACTION -> ui_actions

### 8) Tests
- Add tests:
  - rhs-ui-domain-sections.test.tsx
    - selecting UI domain shows 4 collapsibles
    - lists items from meta-model arrays
  - rhs-ui-domain-add-delete.test.tsx
    - add UIScreen creates a node and greys row
    - delete removes node and un-greys row
  - diagram-validation-ui-entities.test.ts
    - diagrams containing UI_COMPONENT/UI_ACTION/UI_WORKFLOW_TRANSITION nodes validate and resolve labels

## Definition of Done
- UI domain is selectable in Diagram View RHS.
- 4 collapsible sections appear with correct rows.
- Add/Delete behavior works exactly as specified and is diagram-only.
- Rows grey-out correctly based on diagram contents.
- UI entity-backed nodes load without validation errors across refresh/save/load.
