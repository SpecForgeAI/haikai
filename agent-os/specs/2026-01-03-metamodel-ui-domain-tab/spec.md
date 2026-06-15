# Specification: Meta-Model View - UI Domain Tab

## Goal
Add a new "UI" architecture domain to the Meta-Model view, appearing as the 5th domain tab (after Behavioural) with lucide-react MonitorSmartphone icon, containing 4 entity tables (UI Screens, UI Workflow Transitions, UI Components, UI Actions) and no Relationships section.

## User Stories
- As an architect, I want to manage UI Screen entities in the Meta-Model view so I can define the screens in my application
- As an architect, I want to define UI Workflow Transitions to specify navigation flows between screens

## Specific Requirements

**Add "ui" to ArchitectureDomain type and constants**
- In `frontend/src/types/architectureDomain.ts`, extend `ArchitectureDomain` type union to include `'ui'`
- Add `'ui'` to the `ALL_DOMAINS` array after `'behavioural'`
- Add entry to `DOMAIN_LABELS`: `ui: 'UI'`
- Import `MonitorSmartphone` from lucide-react and add to `DOMAIN_ICONS`: `ui: MonitorSmartphone`
- Update `isArchitectureDomain` type guard to include the new domain

**Add UI entity types to model.ts**
- UIScreen and UIWorkflowTransition interfaces already exist in model.ts
- Add new UIComponent interface with fields: id, name, component_type (optional enum), description (optional)
- Add new UIAction interface with fields: id, name, trigger_type (enum), owner_type (enum), owner_id, effect_type (enum)
- Add `ui_components: UIComponent[]` and `ui_actions: UIAction[]` to MetaModelEntities interface
- Add `'ui_components'` and `'ui_actions'` to EntityType union

**Add UI domain entity groupings to gridConfigs.ts**
- Add new entry to `domainGroupings`: `ui: ['UI Screens', 'UI Workflow Transitions', 'UI Components', 'UI Actions']`
- Add new entry to `DOMAIN_ENTITY_TYPES`: `ui: ['ui_screens', 'ui_workflow_transitions', 'ui_components', 'ui_actions']`
- Add mappings to `tabToEntityType`: `'UI Screens': 'ui_screens'`, `'UI Workflow Transitions': 'ui_workflow_transitions'`, `'UI Components': 'ui_components'`, `'UI Actions': 'ui_actions'`
- Add the 4 new tab names to `entityTabNames` array

**Add grid column configurations for UI entity tables**
- Add `ui_screens` grid config: ID (auto-generate), Name (required), Route (required), Description (optional)
- Add `ui_workflow_transitions` grid config: ID (auto-generate), Name, Source Screen (fk_typeahead to ui_screens), Target Screen (fk_typeahead to ui_screens), Trigger (optional), Guard (optional)
- Add `ui_components` grid config: ID (auto-generate), Name (required), Component Type (dropdown), Description (optional)
- Add `ui_actions` grid config: ID (auto-generate), Name (required), Trigger Type (dropdown), Owner Type (dropdown), Owner ID (text), Effect Type (dropdown)

**Hide Relationships row when UI domain is selected**
- In `MetaModelView.tsx`, wrap the Relationships header row in a conditional: only render when `state.selectedDomain !== 'ui'`
- The `getRelationshipTabsForDomain` function will return an empty array for 'ui' domain since no relationship fkTargets reference UI entities

**Initialize UI entity arrays on model load**
- In `emptyModel` (defaults.ts), add `ui_components: []` and `ui_actions: []` to the entities object
- The `ui_screens` and `ui_workflow_transitions` already exist in emptyModel
- Ensure any model normalization/loading logic initializes missing arrays to prevent null crashes

**Add unit tests for UI domain**
- Create `frontend/src/__tests__/meta-model-ui-domain.test.tsx`
- Test that UI tab renders after Behavioural in ALL_DOMAINS order
- Test that selecting UI domain shows exactly 4 entity tabs: UI Screens, UI Workflow Transitions, UI Components, UI Actions
- Test that Relationships row is not rendered when UI domain is selected
- Test that tables render correctly with mock model data containing UI entities

## Visual Design
[No mockups provided - follow existing MetaModelView styling patterns]

## Existing Code to Leverage

**frontend/src/types/architectureDomain.ts**
- Contains ArchitectureDomain type, ALL_DOMAINS array, DOMAIN_LABELS and DOMAIN_ICONS records
- Follow the existing pattern: add 'ui' to type union, add to ALL_DOMAINS, add labels/icons
- Currently imports Users, Boxes, Database, Workflow icons - add MonitorSmartphone import

**frontend/src/config/gridConfigs.ts**
- Contains domainGroupings, DOMAIN_ENTITY_TYPES, tabToEntityType, entityTabNames, relationshipTabNames
- Contains gridConfigs Record with column configurations for all entity types
- Follow existing grid config patterns (e.g., ui_screens pattern already exists conceptually)

**frontend/src/components/MetaModelView/MetaModelView.tsx**
- Uses getRelationshipTabsForDomain to filter relationship tabs by domain
- Renders headerRow for Entities and Relationships based on selected domain
- Add conditional rendering to hide Relationships row when domain is 'ui'

**frontend/src/components/MetaModelView/DomainSelector.tsx**
- Iterates ALL_DOMAINS and renders domain buttons with icons from DOMAIN_ICONS
- No changes needed - will automatically pick up new 'ui' domain from updated constants

**frontend/src/types/model.ts**
- Contains UIScreen, UIWorkflowTransition interfaces and MetaModelEntities
- ui_screens already exists in MetaModelEntities; add ui_components and ui_actions
- Follow existing interface patterns for new UI entity types

## Out of Scope
- No changes to Diagram View RHS palette/editor in this increment
- No new "UI Contract" entity
- No backend changes (assumes entities already exist and are loaded as part of the model)
- No relationship tabs or relationship management for UI domain
- No UIAction referencing existing Interface/InterfaceEndpoint - just simple enum dropdowns for now
- No validation of owner_id against owner_type for UIAction
- No new dropdown option constants for UIComponent.component_type or UIAction enums (use simple string arrays inline)
- No integration with existing relationship grid infrastructure for UI domain
