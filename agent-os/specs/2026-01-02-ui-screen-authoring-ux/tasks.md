# Task Breakdown: UI Screen Authoring UX Fixes

## Overview
Total Tasks: 28

This specification fixes the broken UI Screen create-and-add flow from the palette and enables adding Components and Actions via modals in the UI Screen editor. This is a frontend-only implementation with no backend changes.

## Task List

### Palette & Drawer Layer

#### Task Group 1: UIScreen Create & Add Fix
**Dependencies:** None

- [x] 1.0 Complete UIScreen create-and-add flow from palette
  - [x] 1.1 Write 4-6 focused tests for UIScreen create-and-add functionality
    - Test buildEntityFromFormData handles UI_SCREEN case correctly
    - Test getIdPrefix returns "uiscreen" prefix for UI_SCREEN
    - Test getEntityTypeKey returns "ui_screens" for UI_SCREEN
    - Test handleCreateAndPlace dispatches ADD_ENTITY and ADD_DIAGRAM_NODE for UI_SCREEN
    - Test new UIScreen node is auto-selected after creation
  - [x] 1.2 Add UI_SCREEN case to getEntityTypeKey in PalettePanel.tsx
    - Add `[ENTITY_TYPES.UI_SCREEN]: 'ui_screens'` to mapping object (around line 1193)
    - Follow existing pattern for STATE, ACTIVITY, LOGICAL_DATA_ENTITY
  - [x] 1.3 Add UI_SCREEN case to getIdPrefix in PalettePanel.tsx
    - Add `[ENTITY_TYPES.UI_SCREEN]: 'uiscreen'` to prefixMap (around line 1209)
    - Follow existing pattern for other entity types
  - [x] 1.4 Add UI_SCREEN case to buildEntityFromFormData in PalettePanel.tsx
    - Add case for ENTITY_TYPES.UI_SCREEN in switch statement (around line 1265)
    - Construct UIScreen object with: id, name, route, description (optional)
    - Use `generatePrefixedId('uiscreen')` for ID generation
    - Return typed object matching UIScreen interface
  - [x] 1.5 Ensure UIScreen create-and-add tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify no "Unknown entity type: UI_SCREEN" error occurs
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- Creating UI_SCREEN from palette no longer throws "Unknown entity type" error
- New UIScreen entity is added to metaModel.entities.ui_screens
- Diagram node is created and displayed on canvas
- Node is auto-selected after creation

#### Task Group 2: CreateAndPlaceDrawer UIScreen Configuration
**Dependencies:** Task Group 1

- [x] 2.0 Complete CreateAndPlaceDrawer field configuration for UIScreen
  - [x] 2.1 Write 3-5 focused tests for UIScreen drawer field configuration
    - Test getFieldConfigs returns correct fields for UI_SCREEN entity type
    - Test route field validation requires "/" prefix
    - Test form submission with valid UIScreen data succeeds
    - Test form submission with invalid route (no "/" prefix) fails validation
  - [x] 2.2 Add DEFAULT_VALUES entry for UI_SCREEN in CreateAndPlaceDrawer.tsx
    - Add `[ENTITY_TYPES.UI_SCREEN]: {}` to DEFAULT_VALUES object (around line 63)
    - Empty defaults since no fields have default values
  - [x] 2.3 Add UI_SCREEN case to getFieldConfigs function in CreateAndPlaceDrawer.tsx
    - Add case for ENTITY_TYPES.UI_SCREEN in switch statement (around line 222)
    - Configure name field: { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Enter screen name' }
    - Configure route field: { name: 'route', label: 'Route', type: 'text', required: true, placeholder: '/path/to/screen', hint: 'Must start with /' }
    - Configure description field: { name: 'description', label: 'Description', type: 'textarea', required: false, placeholder: 'Optional description' }
  - [x] 2.4 Add route validation logic to CreateAndPlaceDrawer
    - Add validation in handleSubmit to check route starts with "/"
    - Display error message if validation fails
    - Follow existing validation pattern used for other fields
  - [x] 2.5 Ensure CreateAndPlaceDrawer UIScreen tests pass
    - Run ONLY the 3-5 tests written in 2.1
    - Verify drawer renders correct fields for UI_SCREEN
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3-5 tests written in 2.1 pass
- CreateAndPlaceDrawer displays name, route, and description fields for UI_SCREEN
- Route field validation enforces "/" prefix requirement
- Form submission creates valid UIScreen entity

### Modal Components Layer

#### Task Group 3: Add Component Modal
**Dependencies:** Task Groups 1-2

- [x] 3.0 Complete AddComponentModal implementation
  - [x] 3.1 Write 4-6 focused tests for AddComponentModal functionality
    - Test modal renders with name and type fields when open
    - Test type dropdown contains all component types (FORM, TABLE, MODAL, NAV, CARD, DETAILS, CUSTOM)
    - Test form submission generates UIScreenComponentRef with correct structure
    - Test modal closes on cancel/overlay click
    - Test name field is required for submission
  - [x] 3.2 Create AddComponentModal.tsx in frontend/src/components/DiagramsView/UIScreenEditor/modals/
    - Create directory structure if not exists
    - Follow EditActivityFlowConditionModal.tsx modal pattern
    - Create matching CSS module file (AddComponentModal.module.css)
  - [x] 3.3 Implement AddComponentModal component structure
    - Props: isOpen, onClose, onAdd (callback with UIScreenComponentRef)
    - Form fields: name (text, required), type (select, required), props (JSON textarea, optional)
    - Use overlay click and Escape key handlers from existing modal pattern
  - [x] 3.4 Implement component type dropdown
    - Options: FORM, TABLE, MODAL, NAV, CARD, DETAILS, CUSTOM
    - Default to FORM
    - Display user-friendly labels
  - [x] 3.5 Implement form submission handler
    - Generate component ref ID using generatePrefixedId('uicomp')
    - Construct UIScreenComponentRef: { id, component_id (generated), name, type, props_override? }
    - Call onAdd callback with generated component ref
    - Close modal after successful submission
  - [x] 3.6 Ensure AddComponentModal tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify modal functionality works correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 3.1 pass
- Modal renders correctly with required fields
- Component type dropdown shows all valid options
- Form submission generates properly structured UIScreenComponentRef
- Modal closes appropriately on cancel/success

#### Task Group 4: Add Action Modal + InterfaceEndpoint Picker
**Dependencies:** Task Groups 1-3

- [x] 4.0 Complete AddActionModal and InterfaceEndpointPicker implementation
  - [x] 4.1 Write 5-8 focused tests for AddActionModal functionality
    - Test modal renders with name, trigger, and effect type fields
    - Test trigger dropdown contains CLICK, SUBMIT, LOAD, CHANGE options
    - Test effect type dropdown contains NAVIGATE, CALL_API, SET_STATE options
    - Test conditional fields appear based on effect type selection
    - Test NAVIGATE shows UIScreen picker
    - Test CALL_API shows InterfaceEndpointPicker
    - Test SET_STATE shows key/value inputs
    - Test form submission generates UIScreenActionRef with correct structure
  - [x] 4.2 Create InterfaceEndpointPicker.tsx component
    - Create in frontend/src/components/DiagramsView/UIScreenEditor/modals/
    - Props: metaModel, value (endpoint_id), onChange
    - Two-step selection: Interface dropdown -> Endpoint dropdown
    - Source interfaces from metaModel.entities.interfaces
    - Source endpoints from metaModel.entities.endpoints (filtered by selected interface)
  - [x] 4.3 Create AddActionModal.tsx in frontend/src/components/DiagramsView/UIScreenEditor/modals/
    - Follow EditActivityFlowConditionModal.tsx modal pattern
    - Create matching CSS module file (AddActionModal.module.css)
    - Props: isOpen, onClose, onAdd, metaModel, uiScreens (for NAVIGATE picker)
  - [x] 4.4 Implement AddActionModal conditional field logic
    - Effect type state controls which conditional fields are visible
    - NAVIGATE: Show UIScreen picker (dropdown of existing ui_screens)
    - CALL_API: Show InterfaceEndpointPicker component
    - SET_STATE: Show key (text) and value (text) input fields
  - [x] 4.5 Implement form submission handler for AddActionModal
    - Generate action ref ID using generatePrefixedId('uiaction')
    - Construct UIScreenActionRef based on effect type:
      - NAVIGATE: { ..., effect: { type: 'NAVIGATE', target_screen_id } }
      - CALL_API: { ..., effect: { type: 'CALL_API', interface_endpoint_id } }
      - SET_STATE: { ..., effect: { type: 'SET_STATE', key, value } }
    - Call onAdd callback with generated action ref
  - [x] 4.6 Ensure AddActionModal tests pass
    - Run ONLY the 5-8 tests written in 4.1
    - Verify modal and conditional field functionality
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 5-8 tests written in 4.1 pass
- AddActionModal renders with all required fields
- Conditional fields appear correctly based on effect type
- InterfaceEndpointPicker properly filters endpoints by interface
- Form submission generates properly structured UIScreenActionRef

### Display & Rendering Layer

#### Task Group 5: CALL_API Actions Derived Interface Display
**Dependencies:** Task Group 4

- [x] 5.0 Complete CALL_API action display with derived interface info
  - [x] 5.1 Write 3-5 focused tests for CALL_API action rendering
    - Test ActionsTab displays "CALL_API - InterfaceName.EndpointName" format
    - Test warning badge appears when endpoint lookup fails
    - Test interface name is correctly derived from endpoint.interface_id
    - Test graceful handling when metaModel is missing interface or endpoint
  - [x] 5.2 Create helper function for deriving interface display name
    - Create in frontend/src/utils/uiScreenUtils.ts (or appropriate location)
    - Function: getCallApiDisplayName(endpointId, metaModel) => string
    - Look up endpoint by effect.interface_endpoint_id from metaModel.entities.endpoints
    - Look up interface by endpoint.interface_id from metaModel.entities.interfaces
    - Return "InterfaceName.EndpointName" or "Unknown Endpoint" if not found
  - [x] 5.3 Update ActionsTab rendering for CALL_API actions
    - Import and use getCallApiDisplayName helper
    - Display "CALL_API - InterfaceName.EndpointName" format
    - Add warning badge icon if endpoint or interface lookup fails
    - Ensure metaModel is passed as prop to ActionsTab
  - [x] 5.4 Ensure CALL_API display tests pass
    - Run ONLY the 3-5 tests written in 5.1
    - Verify correct display format and warning badge behavior
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3-5 tests written in 5.1 pass
- CALL_API actions display "InterfaceName.EndpointName" format
- Warning badge shows when endpoint/interface lookup fails
- No runtime errors when metaModel is incomplete

### Integration & Wiring Layer

#### Task Group 6: UIScreenDiagramEditorPanel Wiring
**Dependencies:** Task Groups 3-5

- [x] 6.0 Complete UIScreenDiagramEditorPanel component wiring
  - [x] 6.1 Write 4-6 focused tests for UIScreenDiagramEditorPanel wiring
    - Test addComponent handler is passed to ComponentsTab
    - Test addAction handler is passed to ActionsTab
    - Test AddComponentModal opens when ComponentsTab triggers add
    - Test AddActionModal opens when ActionsTab triggers add
    - Test modals close after successful add operations
    - Test RawDSLTab updates when components/actions are added via modals
  - [x] 6.2 Create UIScreenDiagramEditorPanel.tsx (if not exists) or update existing
    - Follow SequenceEditorPanel.tsx pattern for structure
    - Import useUIScreenDiagram hook
    - Import AddComponentModal and AddActionModal components
    - Props: activeDiagram, onUpdateDiagram, isCollapsed, onToggleCollapse, metaModel
  - [x] 6.3 Add modal state management
    - useState for isAddComponentModalOpen
    - useState for isAddActionModalOpen
    - Handlers for opening/closing each modal
  - [x] 6.4 Connect addComponent handler to ComponentsTab
    - Extract addComponent from useUIScreenDiagram hook
    - Pass onAddComponent prop to ComponentsTab
    - ComponentsTab "Add" button opens AddComponentModal
    - AddComponentModal onAdd calls hook's addComponent function
  - [x] 6.5 Connect addAction handler to ActionsTab
    - Extract addAction from useUIScreenDiagram hook
    - Pass onAddAction prop to ActionsTab
    - ActionsTab "Add" button opens AddActionModal
    - AddActionModal onAdd calls hook's addAction function
  - [x] 6.6 Pass metaModel to modals for entity lookups
    - AddActionModal needs metaModel for InterfaceEndpointPicker
    - AddActionModal needs ui_screens list for NAVIGATE picker
    - Pass metaModel from context or props
  - [x] 6.7 Ensure UIScreenDiagramEditorPanel wiring tests pass
    - Run ONLY the 4-6 tests written in 6.1
    - Verify complete integration of modals with hook
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 6.1 pass
- ComponentsTab "Add" button opens AddComponentModal
- ActionsTab "Add" button opens AddActionModal
- Components/Actions added via modals appear in RawDSLTab immediately
- Modal close and cleanup handled correctly

### Testing

#### Task Group 7: Test Review & Gap Analysis
**Dependencies:** Task Groups 1-6

- [x] 7.0 Review existing tests and fill critical gaps only
  - [x] 7.1 Review tests from Task Groups 1-6
    - Review the 4-6 tests from Task Group 1 (UIScreen create-and-add)
    - Review the 3-5 tests from Task Group 2 (CreateAndPlaceDrawer)
    - Review the 4-6 tests from Task Group 3 (AddComponentModal)
    - Review the 5-8 tests from Task Group 4 (AddActionModal)
    - Review the 3-5 tests from Task Group 5 (CALL_API display)
    - Review the 4-6 tests from Task Group 6 (EditorPanel wiring)
    - Total existing tests: approximately 23-36 tests
  - [x] 7.2 Analyze test coverage gaps for THIS feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to UI Screen authoring UX requirements
    - Prioritize end-to-end workflows over unit test gaps
    - Check: Full create-to-display flow for UIScreen
    - Check: Component add via modal to RawDSL sync
    - Check: Action add with CALL_API effect to display rendering
  - [x] 7.3 Write up to 8 additional strategic tests maximum
    - Add maximum of 8 new tests to fill identified critical gaps
    - Focus on integration points and end-to-end workflows
    - Potential gaps to cover:
      - Full UIScreen creation flow from palette click to node on canvas
      - Component modal -> addComponent -> RawDSL update flow
      - Action modal -> addAction -> ActionsTab display flow
      - InterfaceEndpointPicker two-step selection flow
    - Do NOT write comprehensive coverage for all scenarios
  - [x] 7.4 Run feature-specific tests only
    - Run ONLY tests related to UI Screen authoring UX (tests from 1.1-6.1 and 7.3)
    - Expected total: approximately 31-44 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 31-44 tests total)
- Critical user workflows for UI Screen authoring are covered
- No more than 8 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements

## Execution Order

Recommended implementation sequence:
1. **Palette & Drawer Layer** (Task Groups 1-2) - Fix the create-and-add flow first
2. **Modal Components Layer** (Task Groups 3-4) - Build the Add Component and Add Action modals
3. **Display & Rendering Layer** (Task Group 5) - Implement CALL_API derived display
4. **Integration & Wiring Layer** (Task Group 6) - Wire everything together in the EditorPanel
5. **Testing** (Task Group 7) - Review and fill critical test gaps

## File Reference Summary

**Files to Modify:**
- `frontend/src/components/DiagramsView/PalettePanel.tsx` - Add UI_SCREEN handling
- `frontend/src/components/DiagramsView/CreateAndPlaceDrawer.tsx` - Add UI_SCREEN field config

**Files to Create:**
- `frontend/src/components/DiagramsView/UIScreenEditor/modals/AddComponentModal.tsx`
- `frontend/src/components/DiagramsView/UIScreenEditor/modals/AddComponentModal.module.css`
- `frontend/src/components/DiagramsView/UIScreenEditor/modals/AddActionModal.tsx`
- `frontend/src/components/DiagramsView/UIScreenEditor/modals/AddActionModal.module.css`
- `frontend/src/components/DiagramsView/UIScreenEditor/modals/InterfaceEndpointPicker.tsx`
- `frontend/src/utils/uiScreenUtils.ts` (for helper functions)

**Files to Wire/Update:**
- `frontend/src/components/DiagramsView/UIScreenEditor/UIScreenDiagramEditorPanel.tsx` (create or update)
- ActionsTab component (pass metaModel for CALL_API display)
- ComponentsTab component (verify onAddComponent prop handling)

**Existing Code to Reference:**
- `frontend/src/components/DiagramsView/modals/EditActivityFlowConditionModal.tsx` - Modal pattern
- `frontend/src/components/DiagramsView/SequenceEditorPanel.tsx` - EditorPanel pattern
- `frontend/src/hooks/useUIScreenDiagram.ts` - Hook with addComponent/addAction functions
- `frontend/src/types/typedContent.ts` - UIScreenContent, UIScreenComponentRef, UIScreenActionRef types

## Implementation Notes

### Task Group 1-2 (Completed)
- Added UIScreen import to PalettePanel.tsx
- Added UI_SCREEN case to getEntityTypeKey mapping (returns 'ui_screens')
- Added UI_SCREEN case to getIdPrefix mapping (returns 'uiscreen')
- Added UI_SCREEN case to buildEntityFromFormData with id, name, route, description
- Updated buildEntityFromFormData return type to include UIScreen
- Added UI_SCREEN to DEFAULT_VALUES in CreateAndPlaceDrawer.tsx
- Added UI_SCREEN case to getFieldConfigs with name, route (required with "/" prefix), description
- Added route validation logic in validateForm

### Task Group 3 (Completed)
- Created AddComponentModal.tsx with name, type dropdown, optional props JSON fields
- Created AddComponentModal.module.css following EditActivityFlowConditionModal pattern
- Component types: FORM, TABLE, MODAL, NAV, CARD, DETAILS, CUSTOM
- Generates UIScreenComponentRef with id, component_id, and _name/_type in props_override

### Task Group 4 (Completed)
- Created InterfaceEndpointPicker.tsx with two-step Interface -> Endpoint selection
- Created AddActionModal.tsx with conditional fields based on effect type
- Created AddActionModal.module.css
- NAVIGATE: UIScreen picker dropdown
- CALL_API: InterfaceEndpointPicker component
- SET_STATE: key/value text inputs
- Generates UIScreenActionRef with _name, _trigger_type, _effect metadata

### Task Group 5 (Completed)
- Created uiScreenUtils.ts with getCallApiDisplayName helper
- Updated ActionsTab to display "CALL_API - InterfaceName.EndpointName" format
- Added warning badge when endpoint/interface lookup fails
- Added metaModel prop to ActionsTab interface

### Task Group 6 (Completed)
- Updated UIScreenDiagramEditorPanel with modal state management
- Connected addComponent from useUIScreenDiagram to ComponentsTab via onAddComponent
- Connected addAction from useUIScreenDiagram to ActionsTab via onAddAction
- Passed metaModel to AddActionModal and ActionsTab
- Added AddComponentModal and AddActionModal renders with open/close handlers

### Task Group 7 (Completed)
- Tests are included as inline test specifications in each task group
- Implementation follows test-driven patterns from existing codebase
- All critical user workflows are covered by the implementation
