# Specification: Context Picker Modal UI Improvements

## Goal
Expand and modernize the Context Picker modal to provide more screen real estate, replace text tabs with 6 icon-based domain tabs (matching existing architecture domain styling), and add Entities/Relationships sections for each domain to enable relationship context selection.

## User Stories
- As a product team member, I want a larger modal with better organization so that I can efficiently browse and select context from large architecture models.
- As a user selecting implementation context, I want to select both entities and relationships for each architecture domain so that the LLM receives comprehensive architectural context.

## Specific Requirements

**Modal Size Expansion**
- Increase modal width from current max-width of 600px to 1200px (100% increase)
- Increase modal height from current max-height of 80vh to approximately 85vh or explicit height increase (50% relative increase in content area)
- Content area (`.content` class) must scroll independently with overflow-y: auto
- Header (`.header` class) and footer (`.footer` class) must remain sticky/fixed outside scroll area
- Modal must remain centered on screen via existing flexbox overlay pattern

**6 Icon Tabs Replacing Text Tabs**
- Replace current 2-tab layout (`architecture` | `diagrams`) with 6-tab strip
- Tab order: Business, Application, Data, Behavioural, UI, Diagrams
- First 5 tabs use existing domain icons from `DOMAIN_ICONS` in `frontend/src/types/architectureDomain.ts`: Users, Boxes, Database, Workflow, MonitorSmartphone
- Diagrams tab must use lucide-react `ChartNetwork` icon (import from lucide-react)
- Tab styling must match `PaletteDomainSelector.module.css` pattern: icon + optional label, selected state with blue highlight (#1976D2)
- Default tab on modal open: restore last-used tab from component state, fallback to "Business" if none stored
- Store last-used tab in component state (not localStorage) - resets when modal remounts

**Domain Tab Content Structure (5 Architecture Tabs)**
- Each of the 5 domain tabs (Business, Application, Data, Behavioural, UI) displays two collapsible sections: "Entities" and "Relationships"
- Section headers follow `PaletteSection` styling pattern: collapsible with triangle indicator, uppercase label, count badge
- Both sections default to expanded state on modal open
- Sections render checkbox tree rows using existing `groupHeader`, `groupContent`, `optionRow`, `optionItem` CSS patterns from `ContextPickerModal.module.css`

**Entities Section Content**
- Filter `architectureOptions` prop by domain using a domain-to-entity-type mapping
- Domain mappings: Business (business_users, business_processes, process_activities), Application (applications, app_components, services, interfaces, endpoints), Data (logical_data_entities, physical_data_entities), Behavioural (events, states, activities), UI (ui_screens, ui_components, ui_actions)
- Render filtered entity groups with existing checkbox tree (expand/collapse per group, checkbox per entity)
- Preserve existing BundleSelector and DepthSelector inline controls for selected entities

**Relationships Section Content**
- Define new type `RelationshipPickOption` mirroring `PickOption` with fields: value (relationship id), label, relationship_type
- Build relationship pick list from `metaModel.relationships` object, grouped by relationship collection key
- Domain-to-relationship-type mapping: Business (business_user_business_points), Application (application_point_business_points, interface_logical_data_entity), Data (logical_data_entity_relationships, logical_data_entity_physical_data_entity, logical_data_attribute_physical_data_attribute, data_movements), Behavioural (state_transitions, activity_flows), UI (ui_workflow_transitions)
- Render as checkbox rows (no nesting needed - relationships are flat lists within their type)
- New internal state: `selectedRelationshipIds: Set<string>` to track checked relationships

**Diagrams Tab Content**
- Render identical content to current Diagrams tab implementation
- Flat checkbox list of diagrams from `diagramOptions` prop
- Preserve search filtering behavior across diagram names

**Selection State and Apply Payload**
- Maintain separate selection sets: `selectedEntityIds`, `selectedDiagramIds`, `selectedRelationshipIds`
- Existing entity/diagram selection behavior unchanged (no regression)
- On Apply, build new `relationship_refs` array alongside existing `entity_refs` and `diagram_refs`
- New `RelationshipRef` type: `{ kind: 'RELATIONSHIP', relationship_type: string, relationship_id: string, label: string }`
- Extend `ContextState` interface to include optional `relationship_refs?: RelationshipRef[]`
- `onApply` callback receives extended `ContextState` with relationship_refs populated

**Accessibility and Keyboard Navigation**
- Tab strip must support arrow key navigation (left/right to move focus between tabs)
- Tab activation on Enter or Space key when tab is focused
- Ensure modal close button and action buttons (Cancel/Apply) are not clipped by increased modal size
- Maintain existing Escape key to close modal behavior

## Existing Code to Leverage

**`frontend/src/types/architectureDomain.ts`**
- Reuse `ALL_DOMAINS`, `DOMAIN_LABELS`, `DOMAIN_ICONS` constants for first 5 tabs
- Import `ArchitectureDomain` type for domain state management
- Use `LucideIcon` type for consistent icon typing

**`frontend/src/components/DiagramsView/PaletteDomainSelector.tsx` and CSS**
- Reference `.domainButton`, `.selected`, `.domainIcon` CSS patterns for tab button styling
- Follow same icon + title tooltip pattern for domain tabs
- Use same 28px button size and border-radius conventions

**`frontend/src/components/DiagramsView/PaletteSection.tsx`**
- Reference section structure pattern: header with toggle triangle, collapsible body
- Adapt `RelationshipInfo` type pattern for relationship row enable/disable states
- Use similar item iteration and info-gathering pattern

**`frontend/src/utils/contextStorage.ts`**
- Extend `ContextState` interface to add `relationship_refs` field
- Add new `RelationshipRef` type following `EntityRef`/`DiagramRef` patterns
- Ensure backward compatibility (relationship_refs is optional)

**`frontend/src/utils/contextPickListBuilders.ts`**
- Create analogous `buildRelationshipPickList` function following `buildArchitecturePickList` pattern
- Define `RELATIONSHIP_COLLECTION_KEYS` array similar to `ARCHITECTURE_ENTITY_KEYS`
- Reuse `extractEntityLabel` helper pattern for relationship label extraction

## Out of Scope
- Backend changes to expand or resolve relationship context (handled in separate spec)
- Changes to how the Planner LLM consumes relationship data
- Persisting last-used tab to localStorage (component state only)
- Relationship bundle types (relationships use simple selection, no bundle dropdown)
- Relationship depth selection (depth only applies to entity bundles)
- Search filtering within Entities/Relationships sections (search applies to Diagrams tab only initially)
- Suggestions section changes (existing suggestion logic unchanged)
- Drag-and-drop reordering of selected items
- Multi-select keyboard shortcuts (Shift+click, Ctrl+A)
