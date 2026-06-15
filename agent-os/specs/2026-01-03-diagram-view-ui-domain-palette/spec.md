# Specification: Diagram View RHS UI Domain Palette

## Goal
Add a "UI" domain to the Diagram View RHS palette that displays 4 collapsible sections for UI meta-model entity types, with add/delete-from-diagram behavior for UI entities rendered as simple box nodes.

## User Stories
- As an architect, I want to add UI Screens, Components, Actions, and Workflow Transitions to diagrams so that I can visualize UI architecture alongside other architecture domains
- As an architect, I want to see which UI entities are already on my diagram (greyed out rows) so that I can manage diagram contents without accidentally duplicating nodes

## Specific Requirements

**RHS Domain Selector UI Domain Option**
- Add UI domain to the PaletteDomainSelector component with MonitorSmartphone icon from lucide-react
- UI domain should appear after Behavioural in the ALL_DOMAINS ordering (already exists in architectureDomain.ts)
- Domain key: "ui", label: "UI", icon: MonitorSmartphone
- Clicking UI domain switches selectedDomain state via SET_DOMAIN dispatch

**UI Domain Palette Content with 4 Collapsible Sections**
- When selectedDomain === "ui", render 4 CollapsibleSection components in PalettePanel.tsx
- Section 1: "UI Screens" - lists model.metaModel.entities.ui_screens
- Section 2: "UI Workflow Transitions" - lists model.metaModel.relationships.ui_workflow_transitions
- Section 3: "UI Components" - lists model.metaModel.entities.ui_components
- Section 4: "UI Actions" - lists model.metaModel.entities.ui_actions
- Each section uses PaletteSection component following existing Activity/State/ER patterns

**Row Label Display Formatting**
- UIScreen rows: display as "name (route)" if route is present, otherwise just "name"
- UIWorkflowTransition rows: display as "name" plus "source -> target" if source/target screen names can be resolved
- UIComponent rows: display as "name [type]" if component_type is present, otherwise just "name"
- UIAction rows: display as "name [trigger_type/effect_type]" if present, otherwise just "name"

**Is-On-Diagram Detection (Single Source of Truth)**
- Create helper function isEntityOnDiagram(entityType, entityId, diagram) in a new uiDomainPaletteUtils.ts file
- Check diagram.diagram_nodes for nodes where node.entity_type matches and node.entity_id matches
- Grey out row if entity is already on diagram (matches existing State/Activity patterns in PaletteSection.tsx)
- Use RelationshipInfo type with action: 'add' | 'delete' for row state

**Add Behavior (Left-Click and Context Menu)**
- Left-click on non-greyed row adds entity to diagram as simple box node
- Right-click context menu shows "Add" option for non-greyed rows
- Create DiagramNode with: id (uuid via generatePrefixedId), entity_type (UI_SCREEN/UI_WORKFLOW_TRANSITION/UI_COMPONENT/UI_ACTION), entity_id, pos_x/pos_y at DEFAULT_NODE_SPAWN_ORIGIN (100,100)
- Use createDiagramNodeFromEntity() from nodeCreation.ts for node creation
- Dispatch ADD_DIAGRAM_NODE action to persist via existing save pipeline

**Delete Behavior (Context Menu Delete Only)**
- Right-click on greyed row shows "Delete" option only (no "Add")
- Delete removes all diagram nodes matching (entity_type, entity_id) from diagram.diagram_nodes
- Dispatch DELETE_DIAGRAM_ELEMENTS action with node IDs to remove
- Meta-model entities remain unchanged (diagram-only delete)
- After delete, row becomes non-greyed and shows "Add" option again
- No cascading deletes in this increment (deleting UIScreen does not auto-delete UIWorkflowTransition edges)

**Diagram Type Availability Rules**
- UI domain sections work on diagram types: General, ER, Activity, State, UI_Workflow
- If diagram type is Sequence or UI_SCREEN, show disabled state message: "UI palette is not available for this diagram type."
- Use getDiagramType() from diagramType.ts to determine current diagram type
- Disable add operations (no-op on click) when diagram type does not support generic palette adds

**Entity Type Registry Updates**
- Add UI_WORKFLOW_TRANSITION, UI_COMPONENT, and UI_ACTION to DIAGRAM_NODE_ENTITY_TYPE_MAP in entityTypeRegistry.ts
- UI_SCREEN already exists in registry (maps to 'ui_screens')
- UI_WORKFLOW_TRANSITION maps to 'ui_workflow_transitions'
- UI_COMPONENT maps to 'ui_components'
- UI_ACTION maps to 'ui_actions'

## Existing Code to Leverage

**PaletteDomainSelector.tsx**
- Already renders domain icons from ALL_DOMAINS array using DOMAIN_ICONS map
- UI domain already exists in architectureDomain.ts with MonitorSmartphone icon
- handleDomainClick dispatches SET_DOMAIN action to switch selectedDomain
- No changes needed to this component - UI domain already supported

**PaletteSection.tsx**
- Contains getStateEntityInfo(), getUIScreenEntityInfo(), getUIWorkflowTransitionInfo() patterns to follow
- Uses RelationshipInfo type with enabled, disabledReason, and action fields
- getItemInfo() routes to appropriate handler based on sectionId
- Row greying logic via isRelationshipEnabled prop passed to PaletteItem

**uiWorkflowDiagramPaletteUtils.ts**
- Contains uiScreenOnDiagram() and uiWorkflowTransitionOnDiagram() helpers already
- canAddUIWorkflowTransition() validates endpoint presence before adding edges
- createUIWorkflowTransitionEdge() creates edge with proper relationship_type
- Follow this pattern for UI_COMPONENT and UI_ACTION on-diagram detection

**nodeCreation.ts**
- createDiagramNodeFromEntity() creates DiagramNode with proper defaults
- DEFAULT_NODE_SPAWN_ORIGIN provides fixed (100,100) position
- calculateZIndex() determines z_index above existing nodes
- UI_SCREEN case already handled with centered text alignment

**entityTypeRegistry.ts**
- DIAGRAM_NODE_ENTITY_TYPE_MAP provides entity type to collection key mapping
- UI_SCREEN already registered, need to add UI_WORKFLOW_TRANSITION, UI_COMPONENT, UI_ACTION
- getKnownEntityTypes() returns all registered types for validation

## Out of Scope
- No new UI entity creation flows in Diagram View (entity creation remains in Meta-Model View)
- No edges or relationship semantics rendering for UI entities (simple box nodes only)
- No backend changes required (frontend-only increment)
- No changes to UI_SCREEN diagram editor beyond RHS domain selector integration
- No changes to Sequence diagram editor
- No cascading deletes when removing UIScreen nodes (workflow transition edges stay)
- No drag-and-drop from palette to canvas
- No custom node shapes or styling for UI entities beyond default box
- No filtering of UI entities by diagram context (show all entities from project meta-model)
- No undo/redo integration beyond existing diagram save pipeline
