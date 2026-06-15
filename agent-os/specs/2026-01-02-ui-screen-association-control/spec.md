# Specification: UI Screen Diagram Association Control

## Goal
Enable users to associate UI_SCREEN diagrams with existing UIScreen entities through an explicit selector control in the Overview tab, persisting the association in `typed_content.screen_id` and allowing changes or clearing.

## User Stories
- As a user, I want to associate a UI_SCREEN diagram with an existing UIScreen entity so that the diagram is linked to the correct screen definition from the UI Workflow.
- As a user, I want to see which UIScreen is currently associated with a diagram and change or clear that association when needed.

## Specific Requirements

**UIScreen picker dropdown in OverviewTab**
- Replace static "No screen associated..." message with an always-visible dropdown selector
- Dropdown label: "Associated UIScreen"
- Dropdown placeholder: "Select a UIScreen..."
- Options format: `{screen.name} ({screen.route})`
- When a screen is selected, display name (bold) and route (muted) below the dropdown
- Include a "Clear" link/button visible only when a selection exists

**Pass UIScreen list to OverviewTab**
- UIScreenDiagramEditorPanel must pass `uiScreens` array to OverviewTab as props
- Source UIScreens from `metaModel.entities.ui_screens`
- Pass `selectedScreenId` (from `content.screen_id`) and `onSelectScreenId` callback
- OverviewTab interface already has `onScreenIdChange?: (screenId: string | null) => void` - wire this up

**Persist association via useUIScreenDiagram hook**
- The hook already exposes `setScreenId(screenId: string | null)` function
- Calling `setScreenId` updates `content.screen_id` and triggers debounced autosave
- Ensure typed_content envelope structure is preserved: `{ type: 'UI_SCREEN', version: 1, content: {...} }`
- Mark editor dirty state when association changes

**Handle missing associated UIScreen gracefully**
- When `content.screen_id` is set but screen not found in `uiScreens` list, show warning
- Warning text: "Associated UIScreen not found"
- Keep dropdown enabled so user can select a replacement
- Do not crash or throw errors

**Support clearing the association**
- "Clear" button/link sets `screen_id` to `null` via `onSelectScreenId(null)`
- Clearing marks editor as dirty and enables Save
- After clearing, dropdown returns to placeholder state

**Initialize screen_id from UIScreen creation flow (optional enhancement)**
- When creating a UI_SCREEN diagram from a UIScreen entity row, pre-populate `typed_content.screen_id`
- Initial typed_content: `{ schema_version: 1, screen_id: <sourceUIScreen.id>, components: [], actions: [] }`

## Existing Code to Leverage

**`frontend/src/components/DiagramsView/UIScreenEditor/OverviewTab.tsx`**
- Already accepts `content`, `screenName`, `screenRoute`, and `onScreenIdChange` props
- Currently displays static message when no screen associated
- Add dropdown control and clear button to replace static message

**`frontend/src/components/DiagramsView/UIScreenDiagramEditorPanel.tsx`**
- Already receives `metaModel` prop and computes `uiScreensList` from `metaModel.entities.ui_screens`
- Already uses `useUIScreenDiagram` hook with `content` and `setScreenId`
- Wire `onScreenIdChange` callback from `setScreenId` to OverviewTab

**`frontend/src/hooks/useUIScreenDiagram.ts`**
- Already implements `setScreenId(screenId: string | null)` function
- Handles content state update and debounced save scheduling
- Returns `isDirty` and `saveNow` for save state management

**`frontend/src/types/typedContent.ts` - UIScreenContent interface**
- Defines `screen_id: string | null` field in UIScreenContent
- `createDefaultUIScreenContent()` initializes `screen_id` to `null`

**`frontend/src/components/DiagramsView/UIScreenEditor/modals/AddActionModal.tsx`**
- Contains UIScreen dropdown pattern for NAVIGATE effect type (lines 310-337)
- Shows format: `{screen.name} ({screen.route})`
- Includes empty state hint when no screens available

## Out of Scope
- Backend changes to the architecture-model-service
- Changes to UI Workflow diagrams or UIWorkflowTransition entities
- Screen composition changes (Components/Actions tabs) beyond association reference
- Creating new UIScreen entities from the UI Screen Editor
- Validation of screen route uniqueness or format
- Bulk association of multiple diagrams to screens
- History/audit trail of association changes
- Association of diagrams to multiple screens
- Automatic screen creation when no UIScreens exist
