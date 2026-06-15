# Specification: UI Screen Actions Enhancement

## Goal
Enhance the Add Action modal for UI_SCREEN diagrams by populating Navigate and Call API dropdowns from the full project meta-model, and adding support for multiple state mutations with entity/attribute autocomplete in Set State effects.

## User Stories
- As a UI designer, I want to select any UIScreen as a navigation target so that I can model screen-to-screen flows across the entire application
- As a developer, I want to select any Interface and Endpoint for Call API actions so that I can accurately reference the API integration points
- As a developer, I want to set multiple state key/value mutations with autocomplete suggestions from logical entities and attributes so that I can quickly model complex state changes

## Specific Requirements

**Navigate Target Screen Dropdown Population**
- Dropdown must list ALL UIScreens from `metaModel.entities.ui_screens` regardless of current diagram
- Option label format: `${screen.name}${screen.route ? " (" + screen.route + ")" : ""}`
- Persist selection as `effect: { type: "NAVIGATE", to_screen_id: "<UIScreenId>" }`
- Show hint text when no UIScreens exist in the project
- Currently using `uiScreens` prop passed from parent but may be empty

**Call API Interface Dropdown Population**
- Interface dropdown must list ALL Interfaces from `metaModel.entities.interfaces`
- Option label: `interface.name`, value: `interface.id`
- InterfaceEndpointPicker component already exists and filters endpoints by selected interface
- Endpoint dropdown already populates from `metaModel.entities.endpoints` filtered by `interface_id`
- Verify endpoint label uses `${endpoint.name} (${endpoint.operation_verb || endpoint.endpoint_type})`
- Persist as `effect: { type: "CALL_API", interface_endpoint_id: "<EndpointId>" }`

**CALL_API Action Display Label Enhancement**
- In ActionsTab, CALL_API actions currently use `getCallApiDisplayName()` utility
- Display format: `"CALL_API - InterfaceName.EndpointName"`
- Show warning badge with "Missing endpoint reference" text when endpoint/interface not found
- Existing utility in `uiScreenUtils.ts` handles this - verify it receives full meta-model

**Set State Multiple Mutations Support**
- New schema: `effect: { type: "SET_STATE", mutations: [{ key: string, value?: string }] }`
- Back-compat: if `effect.key` exists without `mutations`, convert to `mutations=[{key, value}]` in UI
- On save, always persist using new `mutations` array schema
- UI must show list of mutation rows with Add/Remove buttons
- Minimum one mutation row required; each row requires non-empty key

**Set State Key Autocomplete**
- Build suggestion list from logical entities and their attributes
- Entity suggestions: `logicalEntities.map(e => e.name)` (e.g., "Customer")
- Attribute suggestions: `entity.name + "." + attribute.name` (e.g., "Customer.email")
- Derive attributes from `metaModel.entities.logical_data_attributes` filtering by `logical_entity_id`
- Dedupe and sort alphabetically
- Allow free-text entry (suggestions optional, not required)

**Autocomplete UI Pattern**
- Use HTML5 datalist element for simple type-ahead suggestions
- Or reuse pattern from TypeaheadCell component for dropdown suggestions
- Key input shows suggestions as user types; selection sets exact string
- Optional value field has no autocomplete requirement

**Form Validation**
- Add Action button disabled until: name set, trigger set, effect fields valid
- Navigate: target screen required
- Call API: endpoint required
- Set State: at least one mutation with non-empty key
- Existing validation structure in AddActionModal can be extended

**Props Threading from Parent**
- UIScreenDiagramEditorPanel passes `metaModel` and `uiScreensList` props to AddActionModal
- Must also pass: logical entities, logical attributes (or derive in modal)
- Interfaces and endpoints available via `metaModel.entities.interfaces` and `metaModel.entities.endpoints`

## Existing Code to Leverage

**AddActionModal.tsx**
- Located at `frontend/src/components/DiagramsView/UIScreenEditor/modals/AddActionModal.tsx`
- Already has form state for name, triggerType, effectType, targetScreenId, interfaceEndpointId, stateKey, stateValue
- Receives `metaModel` and `uiScreens` props; extend for logical entities/attributes
- Effect-specific conditional rendering pattern exists in conditionalFields section

**InterfaceEndpointPicker.tsx**
- Located at `frontend/src/components/DiagramsView/UIScreenEditor/modals/InterfaceEndpointPicker.tsx`
- Two-dropdown pattern: Interface then Endpoint filtered by selected interface
- Reads interfaces from `metaModel.entities.interfaces`, endpoints from `metaModel.entities.endpoints`
- Already integrated in AddActionModal for CALL_API effect type

**ActionsTab.tsx and getCallApiDisplayName**
- ActionsTab at `frontend/src/components/DiagramsView/UIScreenEditor/ActionsTab.tsx`
- Uses `getCallApiDisplayName()` from `uiScreenUtils.ts` for CALL_API label derivation
- Already shows warning badge when endpoint lookup fails via `isValid` return flag
- Receives `metaModel` prop for lookups

**TypeaheadCell.tsx**
- Located at `frontend/src/components/Grid/TypeaheadCell.tsx`
- Dropdown typeahead pattern with search filtering and keyboard navigation
- Can be adapted for mutation key autocomplete or use simpler datalist approach

**UIScreenDiagramEditorPanel.tsx**
- Located at `frontend/src/components/DiagramsView/UIScreenDiagramEditorPanel.tsx`
- Passes `metaModel` and `uiScreensList` to AddActionModal
- Extend to pass `logicalEntities` and `logicalAttributes` from `metaModel.entities`

## Out of Scope
- No backend or database schema changes required
- No Meta-Model view CRUD operations for UI entities
- No UIContract usage - CALL_API references InterfaceEndpoint directly
- No automatic derivation of view-model schemas beyond autocomplete suggestions
- No migration of existing persisted actions in database - only in-memory migration for rendering
- No changes to other diagram types (Sequence, Activity, State, ER)
- No new entity types or meta-model collections
- No interface grouping or categorization in dropdowns
- No endpoint request/response body mapping
- No state schema validation against logical entity structure
