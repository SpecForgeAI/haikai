# Specification: UI Screen Authoring UX Fixes

## Goal
Fix the broken UI Screen create-and-add flow from the palette, and enable adding Components and Actions via modals in the UI Screen editor rather than requiring Raw DSL editing.

## User Stories
- As a user, I want to create a new UIScreen from the UI Workflow palette so that I can add screens to my workflow diagram without encountering errors.
- As a user, I want to add Components and Actions to a UI Screen via modal dialogs so that I can author screen specifications without manually editing JSON.

## Specific Requirements

**Fix "Unknown entity type: UI_SCREEN" on Create & Add**
- Update PalettePanel.tsx entity-type dispatcher to handle UI_SCREEN entity type
- Add case for "UI_SCREEN" in buildEntityFromFormData function alongside existing STATE, ACTIVITY, etc. cases
- Construct UIScreen object with id (generated via generatePrefixedId), name, route, and optional description
- Add entity to model via dispatch({ type: 'ADD_ENTITY', entityType: 'ui_screens', entity }) pattern
- Create diagram node via createDiagramNodeFromEntity and dispatch ADD_DIAGRAM_NODE action
- Auto-select new node after creation using onSelectNode callback

**Extend CreateAndPlaceDrawer for UIScreen**
- Add case for ENTITY_TYPES.UI_SCREEN in getFieldConfigs function
- Required fields: name (text, required), route (text, required, starts with "/")
- Optional field: description (textarea, optional)
- Add DEFAULT_VALUES entry for UI_SCREEN with empty defaults
- Add route validation to ensure non-empty string starting with "/"

**Wire Add Component modal in UI Screen Editor**
- Pass addComponent function from useUIScreenDiagram hook to ComponentsTab via onAddComponent prop
- Implement AddComponentModal in frontend/src/components/DiagramsView/UIScreens/modals/
- Modal fields: name (required), type dropdown (FORM, TABLE, MODAL, NAV, CARD, DETAILS, CUSTOM), optional props JSON
- Generate component ref object with id, component_id (generated), name, type fields
- Append new component to typed_content.components array without reordering existing

**Wire Add Action modal in UI Screen Editor**
- Pass addAction function from useUIScreenDiagram hook to ActionsTab via onAddAction prop
- Implement AddActionModal in frontend/src/components/DiagramsView/UIScreens/modals/
- Modal fields: name (required), trigger dropdown (CLICK, SUBMIT, LOAD, CHANGE), effect type dropdown (NAVIGATE, CALL_API, SET_STATE)
- Conditional fields based on effect type: NAVIGATE shows UIScreen picker, CALL_API shows InterfaceEndpoint picker, SET_STATE shows key/value inputs
- Append new action to typed_content.actions array

**InterfaceEndpoint Picker for CALL_API Actions**
- Create InterfaceEndpointPicker component for selecting Interface + Endpoint combination
- Source data from metaModel.entities.interfaces and metaModel.entities.endpoints
- Display as two-step or grouped dropdown: first select Interface, then select Endpoint
- Store only interface_endpoint_id on the action effect, not redundant interface_id
- Derive Interface name at render time by looking up endpoint.interface_id in interfaces array

**Render CALL_API Actions with Derived Interface Info**
- Update ActionsTab rendering to display "CALL_API - InterfaceName.EndpointName" format
- Look up endpoint by action effect.interface_endpoint_id from metaModel
- Look up interface by endpoint.interface_id from metaModel
- Show warning badge if endpoint lookup fails (missing entity)

**Keep Raw DSL Tab Synchronized**
- Adding components/actions via modals must update the content displayed in RawDSLTab immediately
- RawDSLTab already watches content prop from useUIScreenDiagram hook - no additional wiring needed
- Validate on "Apply Changes" from Raw DSL: screen_id present or null, components/actions must be arrays

**Update UIScreenDiagramEditorPanel Component Wiring**
- Connect addComponent handler from useUIScreenDiagram hook to ComponentsTab
- Connect addAction handler from useUIScreenDiagram hook to ActionsTab
- Import and render AddComponentModal and AddActionModal with open/close state management
- Pass metaModel (from context or props) to modals for entity lookups

## Existing Code to Leverage

**PalettePanel.tsx entity creation pattern**
- Lines 1200-1270: buildEntityFromFormData function shows existing pattern for STATE, ACTIVITY, LOGICAL_DATA_ENTITY
- Lines 1274-1337: handleCreateAndPlace function shows full create-and-place flow with dispatch calls
- Reuse getIdPrefix and getEntityTypeKey patterns for UI_SCREEN

**CreateAndPlaceDrawer.tsx field configuration pattern**
- Lines 68-225: getFieldConfigs function shows field config structure for each entity type
- Lines 56-63: DEFAULT_VALUES object structure for initial form values
- Add UI_SCREEN case following same FieldConfig[] pattern

**useUIScreenDiagram hook**
- Lines 200-213: addComponent function already implemented and ready to use
- Lines 264-276: addAction function already implemented and ready to use
- Hook returns both functions - just need to wire to tab props

**EditActivityFlowConditionModal.tsx modal pattern**
- Lines 60-285: Complete modal implementation showing overlay, form fields, save/skip handlers
- Use same CSS module pattern and form structure for new modals
- Follow handleOverlayClick and Escape key handler patterns

**ActionsTab.tsx and ComponentsTab.tsx**
- Both already accept onAddComponent/onAddAction optional props
- Both render "Add" button when prop is provided
- Only need to implement modal and pass handler from parent

## Out of Scope
- Meta-Model View CRUD UIs for UI entities
- Figma integration or visual design import
- Backend changes to UIAction/UIComponent entity schemas
- New persistence format or typed_content schema changes beyond UI Screen
- Complex component hierarchy/nesting in AddComponentModal (flat list only for v1)
- UIContract entity - CALL_API actions reference InterfaceEndpoint directly
- Auto-generation of UIScreen diagrams from UIScreen entities
- Drag-and-drop reordering of components/actions in tabs
- Inline editing of component/action properties in tabs
