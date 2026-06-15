# Specification: Fix Empty UIScreen/Interface Dropdowns in UI Screen Editor

## Goal
Wire the canonical project metaModel into UIScreenDiagramEditorPanel so that UIScreen and Interface dropdowns populate correctly instead of showing empty lists.

## User Stories
- As a user editing a UI Screen diagram, I want to see all project UIScreens in the "Associated UIScreen" dropdown so that I can associate my diagram with screens created anywhere in the project.
- As a user adding a Navigate action, I want the Target Screen dropdown to list all UIScreens so that I can navigate to any screen in the project.

## Specific Requirements

**Pass metaModel prop to UIScreenDiagramEditorPanel**
- In DiagramsView.tsx, locate the branch where UI_SCREEN diagrams render UIScreenDiagramEditorPanel (around line 2373)
- Currently the component is rendered without the metaModel prop: `<UIScreenDiagramEditorPanel diagram={diagram} onUpdateDiagram={handleUpdateDiagramById} />`
- Add metaModel={state.model.metaModel} to the props, matching the pattern used for SequenceEditorPanel (line 2370) and PalettePanel (line 2381)
- This is the canonical, unfiltered metaModel from the architecture context state

**Verify UIScreenDiagramEditorPanel prop interface accepts metaModel**
- UIScreenDiagramEditorPanel already declares metaModel?: MetaModel | null in its props interface (line 41 of UIScreenDiagramEditorPanel.tsx)
- The component defaults metaModel to null when not provided, causing uiScreensList to resolve to empty array
- No interface changes required; only the wiring in DiagramsView.tsx needs to be fixed

**Verify uiScreensList derivation from metaModel**
- UIScreenDiagramEditorPanel derives uiScreensList from metaModel.entities.ui_screens (lines 111-114)
- This list is passed to OverviewTab and AddActionModal as the uiScreens prop
- Once metaModel is wired, these dropdowns will automatically populate

**Verify AddActionModal Interface/Endpoint picker receives metaModel**
- AddActionModal already receives metaModel prop from UIScreenDiagramEditorPanel (line 328)
- InterfaceEndpointPicker uses metaModel.entities.interfaces and metaModel.entities.endpoints (lines 41-52 of InterfaceEndpointPicker.tsx)
- No additional wiring needed once parent receives metaModel

**Add regression test for dropdown population**
- Create test file: frontend/src/__tests__/ui-screen-editor-dropdowns-populate.test.tsx
- Mock ArchitectureContext with model.metaModel containing test UIScreens and Interfaces
- Render DiagramsView with a UI_SCREEN diagram selected
- Assert OverviewTab dropdown contains expected UIScreen names
- Assert AddActionModal Navigate dropdown contains expected UIScreen names
- Assert AddActionModal Call API interface dropdown contains expected Interface names

**Ensure no domain filtering is applied**
- The metaModel passed must be the full project metaModel, not a domain-filtered subset
- UIScreen dropdowns must show ALL UIScreens in the project regardless of current view context
- Interface dropdowns must show ALL Interfaces in the project

## Visual Design
No visual assets provided for this specification.

## Existing Code to Leverage

**SequenceEditorPanel metaModel wiring pattern (DiagramsView.tsx line 2370)**
- SequenceEditorPanel already receives metaModel={state.model.metaModel} correctly
- Use this as the reference pattern for how to wire UIScreenDiagramEditorPanel
- Both editors are rendered in the same conditional block and should follow identical patterns

**UIScreenDiagramEditorPanel uiScreensList derivation (lines 111-114)**
- Already implements useMemo to derive UIScreen[] from metaModel.entities.ui_screens
- Already passes this list to OverviewTab (line 285) and AddActionModal (line 329)
- Logic is correct; only the metaModel input is missing

**AddActionModal allUIScreens derivation (lines 77-84)**
- Prefers metaModel.entities.ui_screens when available and non-empty
- Falls back to uiScreens prop for backward compatibility
- Correctly handles null metaModel case

**InterfaceEndpointPicker interface/endpoint filtering (lines 41-52)**
- Derives interfaces from metaModel.entities.interfaces
- Filters endpoints by selected interface_id from metaModel.entities.endpoints
- Handles null metaModel gracefully with empty arrays

**PalettePanel metaModel wiring pattern (DiagramsView.tsx line 2381)**
- Another example of passing state.model.metaModel to a panel component
- Confirms the pattern is consistent across the codebase

## Out of Scope
- Backend changes or API modifications
- Creating new UIScreen or Interface entities from within the editor
- Changes to how UIScreens or Interfaces are stored in the database
- Domain filtering logic or per-domain entity views
- Modifying the OverviewTab, AddActionModal, or InterfaceEndpointPicker component implementations
- Changes to the useUIScreenDiagram hook logic
- UI styling or layout changes to the editor panels
- Adding new tabs or features to UIScreenDiagramEditorPanel
- Modifications to other diagram type editors (Activity, State, Sequence, ER)
- Changes to the ArchitectureContext state structure
