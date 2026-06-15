# Specification: Architecture Domain Selectors

## Goal
Add domain selectors (Business, Application, Data, Behavioural) to filter entity/relationship tabs in Meta-Model View and palette sections in Diagram View, reducing UI clutter by showing one architecture domain at a time while applying enterprise-density styling.

## User Stories
- As an architect, I want to filter Meta-Model tabs by domain so that I can focus on one architecture layer at a time without visual clutter
- As an architect, I want the Diagram palette to filter by domain so that I only see relevant entities when building domain-specific diagrams

## Specific Requirements

**Domain Selector in Meta-Model View Header**
- Replace the "Entities:" label with a domain icon selector on the LEFT side of the Entities row
- Use lucide-react icons: Users (business), Boxes (application), Database (data), Workflow (behavioural)
- Display active domain name inline next to the selected icon (e.g., icon + "Application")
- Clicking an icon switches the domain and filters both entity and relationship tabs
- Add tooltip on hover showing full domain name
- If the currently selected tab is not in the new domain, auto-select the first entity tab of that domain

**Domain Selector in Diagram Palette Panel**
- Add a horizontal icon-tab domain selector at the TOP of the palette panel (above search input)
- Use same 4 lucide-react icons with tooltips on hover
- Filter palette sections based on selected domain
- Share selectedDomain state with Meta-Model View via ArchitectureContext
- Selection persists when switching between Meta-Model View and Diagrams View

**Dynamic Entity Tab Filtering by Domain**
- Render only entity tabs from domainGroupings[selectedDomain] instead of all domain groups
- Remove domain group separators; render "|" separator between ALL individual entity tabs
- Add 'Application Points' and 'Business Points' to tabToEntityType and domainGroupings for cross-domain relationship visibility

**Dynamic Relationship Tab Filtering by FK Targets**
- Compute visible relationship tabs by inspecting gridConfigs[relTypeKey] columns for fkTarget values
- Include a relationship tab if any fkTarget intersects with the selected domain's entity type keys
- Render "|" separator between ALL individual relationship tabs
- Algorithm: for each relationship, collect fkTargets from columns where cellType === 'fk_typeahead', include if intersection with domainEntityTypeKeys is non-empty

**Behavioural Domain and Events Entity**
- Add 'behavioural' to ArchitectureDomain type with entity tab 'Events'
- Add gridConfigs['events'] with columns: id (autoGenerate), name (required), description (optional), tags (optional)
- Add 'Events': 'events' to tabToEntityType mapping
- Add 'events' to EntityType union in model.ts
- Initialize state.model.metaModel.entities.events = [] in ArchitectureContext
- Add 'behavioural': ['Events'] to domainGroupings
- Events operates frontend-only (no server persistence in this spec)

**Enterprise Density Styling**
- Meta-model header tabs: font-size 12px (was 13px), padding 4px 8px (was 8px 12px)
- Meta-model header row: reduce padding to match enterprise density
- Palette selector: use 12px font where applicable, tighter spacing
- Palette icons: keep 16px for readability while text is 12px

**Shared Domain State in ArchitectureContext**
- Add selectedDomain: ArchitectureDomain to AppState with default 'business'
- Add SET_DOMAIN action to update selectedDomain
- Derive initial domain from selectedTab if possible on load
- Ensure domain persists when switching between views

## Existing Code to Leverage

**gridConfigs.ts domain and tab structures**
- domainGroupings already defines business, application, data entity tab groupings
- tabToEntityType maps tab names to entity type keys
- relationshipTabToType maps relationship tab names to type keys
- gridConfigs defines columns with fkTarget for FK relationships - use for dynamic filtering

**MetaModelView.tsx tab rendering pattern**
- renderTab() function creates tab buttons with active state styling
- renderDomainGroup() renders tabs with "|" separators between groups
- handleTabClick dispatches SELECT_TAB action
- isEntityTab and isRelationshipTab checks determine which Grid to render

**ArchitectureContext.tsx state pattern**
- AppState interface defines state shape with currentView, selectedTab, selectedDiagramId
- AppAction union type with SELECT_TAB, SET_VIEW patterns to follow for SET_DOMAIN
- appReducer switch cases show pattern for state updates
- useArchitecture and useArchitectureDispatch hooks for consuming state

**PalettePanel.tsx and paletteData.ts section structure**
- getPaletteSections() builds entity and relationship sections with items
- PaletteSection component renders collapsible sections with items
- Existing header, searchContainer, and sectionsContainer layout to insert domain selector above

**MetaModelView.module.css existing styles**
- .tab class with padding: 8px 12px, font-size: 13px - modify for enterprise density
- .domainSeparator styles "|" separator - reuse for tabSeparator
- .headerRow, .headerLabel, .tabsContainer provide layout structure

## Out of Scope
- Diagram rendering changes (sequence/state/activity/ER visuals)
- Adding the other 11 new Behavioural entities (Class, Method, etc.)
- Adding Infrastructure Architecture domain
- Backend persistence/APIs for Events entity
- Diagram-type awareness in palette filtering
- Domain badges on relationship tabs
- Any changes to Grid or RelationshipGrid components
- Changes to entity/relationship CRUD operations
- Changes to diagram node/edge creation logic
- Attribute grid configurations or data type changes
