# Specification: Context Picker UX - Relationship Labels and Stable Chips

## Goal
Improve Context Picker modal UX by increasing modal height to 90vh, rendering all relationship rows with human-readable labels (never IDs) for all 9 relationship types, and ensuring context summary chips always display desired values with proper colors and aggregation rules, stable across navigation/reload.

## User Stories
- As a user selecting implementation context, I want relationship rows to display meaningful labels so I can understand which entities are connected
- As a user viewing my selected context, I want chips to show names (not IDs) so I can quickly verify my selections
- As a user returning to a work item, I want my context chips to maintain readable labels (not regress to IDs) so I can continue working without confusion

## Specific Requirements

**Modal Height Increase to 90vh**
- Update `.modal` in ContextPickerModal.module.css: change max-height from 85vh to 90vh
- Verify internal scrolling with `.content` continues to function correctly
- Ensure footer actions (Cancel/Apply) remain visible and fixed at bottom

**Relationship Label Utility Function**
- Create `computeRelationshipLabel()` utility in a new file (e.g., `contextRelationshipLabelUtils.ts`)
- Accept relationship record and relationship type as parameters
- Return formatted string: `"<NameA> [<TYPE_A>] | <NameB> [<TYPE_B>] | ..."`
- Look up participant entity names from architecture state via `metaModel.entities`
- If a participant cannot be resolved, display `"Unknown [<TYPE>]"` (never an ID)

**Label Rules for 9 Relationship Types**
- `business_user_business_points`: BusinessUser then BusinessPoint, no optional participants
- `application_point_business_points`: ApplicationPoint then BusinessPoint, no optional participants
- `interactions`: Include existing participants in order: BusinessUser, AppBusinessPoint, ApplicationPoint; omit missing
- `logical_data_entity_relationships`: Include existing in order: LogicalDataEntity, PhysicalDataEntity, DataEntityPoint; omit missing
- `logical_data_entity_physical_data_entities`: LogicalDataEntity then PhysicalDataEntity, no optional participants
- `logical_data_attribute_physical_data_attributes`: LogicalDataAttribute then PhysicalDataAttribute, no optional participants
- `interface_logical_entities`: Include existing in order: Interface, LogicalDataEntity, PhysicalDataEntity, DataEntityPoint; omit missing
- `data_movements`: Include existing in order: SourceApplicationPoint, TargetApplicationPoint, DataEntityPoint, Interface; omit missing

**Integrate Computed Labels in ContextPickerModal**
- Update `buildRelationshipPickList()` in `contextPickListBuilders.ts` to use `computeRelationshipLabel()`
- Replace current `extractRelationshipLabel()` fallback logic with the new utility
- DomainRelationshipsSection will render rows using the computed label from `RelationshipPickOption.label`

**Context Summary Chips - Color Scheme**
- Diagram chips: Purple background (existing `.diagramChip` style already purple)
- Entity chips: Blue background (existing `.entityChip` style already blue)
- Relationship chips: Green background - add new `.relationshipChip` CSS class with green tint (#e8f5e9, #2e7d32)

**Context Summary Chips - Aggregation Rules**
- Single entity of a type: Show chip with entity name
- Multiple entities of same type: Show aggregated chip with `"<N> <PluralTypeName>"` (e.g., "2 Applications")
- Single relationship of a type: Show chip with computed relationship label
- Multiple relationships of same type: Show aggregated chip with `"<N> <RelationshipTypeLabel>"` (e.g., "3 Interface <-> Entity")

**Relationship Type Human-Friendly Labels Map**
- Create `RELATIONSHIP_TYPE_DISPLAY_LABELS` constant mapping relationship type keys to display labels
- `business_user_business_points` -> "User <-> Business Point"
- `application_point_business_points` -> "App Point <-> Business Point"
- `interactions` -> "Interactions"
- `logical_data_entity_relationships` -> "Data Entity Relationships"
- `logical_data_entity_physical_data_entities` -> "Logical <-> Physical Entity"
- `logical_data_attribute_physical_data_attributes` -> "Logical <-> Physical Attribute"
- `interface_logical_entities` -> "Interface <-> Entity"
- `data_movements` -> "Data Movements"
- `application_point_business_logics` -> "App Point <-> Business Logic"

**Persistence and Rehydration for Labels**
- On rehydration from localStorage, resolve entity names from entity_id via architecture state
- Resolve relationship labels from relationship_id + relationship_type via architecture state
- Resolve diagram names from diagram_id via diagrams array
- If architecture data is not yet loaded, show "Loading..." placeholder; replace once available
- Never permanently fall back to displaying IDs in chip labels

## Visual Design
No visual mockups provided for this specification.

## Existing Code to Leverage

**`frontend/src/components/ProductView/ContextPickerModal.tsx`**
- DomainRelationshipsSection at line 473 renders relationship rows with `option.label`
- handleRelationshipToggle stores label in relationshipMetadata for building refs
- Update to use new computed label utility

**`frontend/src/utils/contextPickListBuilders.ts`**
- `buildRelationshipPickList()` at line 241 iterates relationships and builds RelationshipPickOption
- `extractRelationshipLabel()` at line 131 is current fallback - replace with new computed label approach
- RELATIONSHIP_COLLECTION_KEYS at line 92 lists the 8 relationship types (need to add `application_point_business_logics`)

**`frontend/src/components/ProductView/WorkItemSummaryPanel.tsx`**
- EntityChip and DiagramChip components render individual chips using entityRef.label/diagramRef.label
- ContextSection renders chips in `.chipContainer`
- Add RelationshipChip component and aggregation logic for multi-select display

**`frontend/src/components/ProductView/WorkItemSummaryPanel.module.css`**
- `.entityChip` (blue) and `.diagramChip` (purple) already exist
- Add `.relationshipChip` with green tint styling

**`frontend/src/contexts/ArchitectureContext.tsx`**
- `useArchitecture()` hook provides `state.model.metaModel.entities` and `state.model.metaModel.relationships`
- Entity lookup by ID can be performed against the entity arrays

## Out of Scope
- Backend expansion logic changes
- Changes to Planner prompt contents
- New relationship types beyond the 9 listed
- Changes to selection persistence schema (use existing fields)
- Modifying the ContextPickerModal tab layout or domain structure
- Changes to how relationships are stored in localStorage (continue using existing RelationshipRef structure)
- Tooltip or hover behavior on chips
- Chip click-to-navigate functionality
- Search/filter functionality for chips
- Drag-and-drop reordering of chips
