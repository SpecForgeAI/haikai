# Task Breakdown: Context Picker UX - Relationship Labels and Stable Chips

## Overview
Total Tasks: 30 (across 5 task groups)

**Goal:** Improve Context Picker modal UX by:
1. Increasing modal height from 85vh to 90vh
2. Rendering all relationship rows with human-readable labels (never IDs) for all 9 relationship types
3. Ensuring context summary chips display readable names with proper colors and aggregation rules
4. Making chip labels stable across navigation/reload via proper rehydration

## Task List

### CSS and Layout Updates

#### Task Group 1: Modal Height and Relationship Chip Styles
**Dependencies:** None

- [x] 1.0 Complete modal height and chip style updates
  - [x] 1.1 Write 3-4 focused tests for CSS and styling requirements
    - Test `.modal` max-height is 90vh (verify computed style in JSDOM)
    - Test `.relationshipChip` class exists with green background (#e8f5e9) and text (#2e7d32)
    - Test `.relationshipChip` follows same structure as `.entityChip` and `.diagramChip`
    - Test internal scrolling via `.content` continues to function with 90vh height
  - [x] 1.2 Update `.modal` max-height in `ContextPickerModal.module.css`
    - File: `frontend/src/components/ProductView/ContextPickerModal.module.css` (line 45)
    - Change: `max-height: 85vh;` -> `max-height: 90vh;`
    - Verify footer remains visible and fixed at bottom
  - [x] 1.3 Add `.relationshipChip` CSS class to `WorkItemSummaryPanel.module.css`
    - File: `frontend/src/components/ProductView/WorkItemSummaryPanel.module.css`
    - Add after `.diagramChip` definition (line 308)
    - Apply green tint: `background-color: #e8f5e9; color: #2e7d32; border: 1px solid #c8e6c9;`
    - Copy structure from `.entityChip` (display, padding, border-radius, font-size, max-width)
  - [x] 1.4 Ensure CSS tests pass
    - Run ONLY the 3-4 tests written in 1.1
    - Verify modal displays correctly at 90vh
    - Verify relationship chips render with green styling

**Acceptance Criteria:**
- The 3-4 tests written in 1.1 pass
- Modal height increased to 90vh with proper scrolling
- Relationship chips have distinct green styling
- Footer actions (Cancel/Apply) remain visible

---

### Utility Layer

#### Task Group 2: Relationship Label Utilities and Constants
**Dependencies:** None (can run in parallel with Task Group 1)

- [x] 2.0 Complete relationship label utility functions
  - [x] 2.1 Write 5-6 focused tests for relationship label computation
    - Test `computeRelationshipLabel()` for `business_user_business_points` returns "UserName [BusinessUser] | PointName [BusinessPoint]"
    - Test `computeRelationshipLabel()` for `interactions` with partial participants omits missing
    - Test `computeRelationshipLabel()` for `data_movements` includes all 4 participants when present
    - Test `computeRelationshipLabel()` returns "Unknown [TYPE]" for unresolvable participant
    - Test `RELATIONSHIP_TYPE_DISPLAY_LABELS` map returns correct human-friendly labels
    - Test `RELATIONSHIP_TYPE_DISPLAY_LABELS` for all 9 relationship types
  - [x] 2.2 Create `frontend/src/utils/contextRelationshipLabelUtils.ts`
    - Define `RELATIONSHIP_TYPE_DISPLAY_LABELS` constant mapping 9 relationship types to human-friendly labels:
      - `business_user_business_points` -> "User <-> Business Point"
      - `application_point_business_points` -> "App Point <-> Business Point"
      - `interactions` -> "Interactions"
      - `logical_data_entity_relationships` -> "Data Entity Relationships"
      - `logical_data_entity_physical_data_entities` -> "Logical <-> Physical Entity"
      - `logical_data_attribute_physical_data_attributes` -> "Logical <-> Physical Attribute"
      - `interface_logical_entities` -> "Interface <-> Entity"
      - `data_movements` -> "Data Movements"
      - `application_point_business_logics` -> "App Point <-> Business Logic"
    - Export constant for use in chip aggregation
  - [x] 2.3 Define participant extraction rules per relationship type
    - Create type `RelationshipParticipantConfig` with fields: `participantTypes: string[]`, `optional: boolean[]`
    - Create `RELATIONSHIP_PARTICIPANT_CONFIGS` map with configs for all 9 types:
      - `business_user_business_points`: BusinessUser, BusinessPoint (neither optional)
      - `application_point_business_points`: ApplicationPoint, BusinessPoint (neither optional)
      - `interactions`: BusinessUser, AppBusinessPoint, ApplicationPoint (all optional based on presence)
      - `logical_data_entity_relationships`: LogicalDataEntity, PhysicalDataEntity, DataEntityPoint (all optional)
      - `logical_data_entity_physical_data_entities`: LogicalDataEntity, PhysicalDataEntity (neither optional)
      - `logical_data_attribute_physical_data_attributes`: LogicalDataAttribute, PhysicalDataAttribute (neither optional)
      - `interface_logical_entities`: Interface, LogicalDataEntity, PhysicalDataEntity, DataEntityPoint (some optional)
      - `data_movements`: SourceApplicationPoint, TargetApplicationPoint, DataEntityPoint, Interface (some optional)
      - `application_point_business_logics`: ApplicationPoint, BusinessLogic (partially optional)
  - [x] 2.4 Implement `computeRelationshipLabel()` function
    - Signature: `computeRelationshipLabel(relationship: Record<string, unknown>, relationshipType: string, entityLookup: EntityLookup): string`
    - `EntityLookup` type: function that takes entity_id and returns entity name or null
    - For each participant in config:
      - Extract ID from relationship record (e.g., `user_id`, `business_point_id`, `interface_id`)
      - Look up entity name via entityLookup function
      - If name found: add `"Name [Type]"` to parts array
      - If not found: add `"Unknown [Type]"` to parts array
      - If participant is optional and ID is missing: skip
    - Return parts joined by `" | "`
  - [x] 2.5 Export utility functions from module
    - Export: `computeRelationshipLabel`, `RELATIONSHIP_TYPE_DISPLAY_LABELS`, `RELATIONSHIP_PARTICIPANT_CONFIGS`
    - Add JSDoc documentation for each export
  - [x] 2.6 Ensure relationship label utility tests pass
    - Run ONLY the 5-6 tests written in 2.1
    - Verify label computation for various relationship types
    - Verify fallback to "Unknown [TYPE]" when entity not resolvable

**Acceptance Criteria:**
- The 5-6 tests written in 2.1 pass
- `computeRelationshipLabel()` produces human-readable labels for all 9 relationship types
- Unresolvable participants display "Unknown [TYPE]" (never raw IDs)
- `RELATIONSHIP_TYPE_DISPLAY_LABELS` provides human-friendly names for aggregated chip display

---

### Context Picker Modal Integration

#### Task Group 3: Integrate Computed Labels in ContextPickerModal
**Dependencies:** Task Group 2 (utility functions must exist)

- [x] 3.0 Complete integration of computed labels in modal
  - [x] 3.1 Write 4-5 focused tests for relationship label integration
    - Test `buildRelationshipPickList()` uses `computeRelationshipLabel()` instead of `extractRelationshipLabel()`
    - Test relationship rows in DomainRelationshipsSection render computed labels
    - Test `application_point_business_logics` relationship type included in RELATIONSHIP_COLLECTION_KEYS
    - Test selected relationship stores computed label in relationshipMetadata
    - Test Apply button returns RelationshipRef with computed label
  - [x] 3.2 Update `RELATIONSHIP_COLLECTION_KEYS` in `contextPickListBuilders.ts`
    - File: `frontend/src/utils/contextPickListBuilders.ts` (line 92)
    - Add `'application_point_business_logics'` to the array (9th relationship type)
    - Update `'interactions'` if not already present
  - [x] 3.3 Update `buildRelationshipPickList()` to accept entity lookup parameter
    - File: `frontend/src/utils/contextPickListBuilders.ts` (line 241)
    - Change signature: `buildRelationshipPickList(metaModelRelationships, metaModelEntities)`
    - Import `computeRelationshipLabel` from `contextRelationshipLabelUtils.ts`
    - Create entityLookup function from metaModelEntities to find entity by ID
    - Replace `extractRelationshipLabel()` call with `computeRelationshipLabel()`
  - [x] 3.4 Update `ContextPickerModal.tsx` to pass metaModelEntities
    - File: `frontend/src/components/ProductView/ContextPickerModal.tsx`
    - Update call to `buildRelationshipPickList()` in parent component (or wherever it's called)
    - Ensure `metaModelEntities` from architecture context is available
    - Pass entities to enable name lookup in label computation
  - [x] 3.5 Update `DOMAIN_TO_RELATIONSHIP_TYPES` mapping
    - File: `frontend/src/utils/contextPickerDomainMappings.ts` (line 44)
    - Add `'application_point_business_logics'` to `behavioural` domain array
    - Verify `'interactions'` is in `application` domain
  - [x] 3.6 Ensure relationship label integration tests pass
    - Run ONLY the 4-5 tests written in 3.1
    - Verify relationship rows display computed labels
    - Verify Apply returns refs with computed labels

**Acceptance Criteria:**
- The 4-5 tests written in 3.1 pass
- Relationship rows display human-readable labels (names with types, joined by `|`)
- All 9 relationship types supported and routed to correct domain tabs
- Selected relationships stored with computed labels for persistence

---

### Context Summary Chips

#### Task Group 4: WorkItemSummaryPanel Chip Rendering and Aggregation
**Dependencies:** Task Groups 1, 2, 3

- [x] 4.0 Complete chip rendering with aggregation and relationship support
  - [x] 4.1 Write 5-6 focused tests for chip rendering and aggregation
    - Test single entity renders chip with entity name (not ID)
    - Test multiple entities of same type renders aggregated chip "N EntityTypes" (e.g., "3 Applications")
    - Test RelationshipChip component renders with green styling
    - Test single relationship renders chip with computed relationship label
    - Test multiple relationships of same type renders aggregated chip with `RELATIONSHIP_TYPE_DISPLAY_LABELS`
    - Test chips maintain labels after reload/navigation (rehydration test)
  - [x] 4.2 Create RelationshipChip component in `WorkItemSummaryPanel.tsx`
    - File: `frontend/src/components/ProductView/WorkItemSummaryPanel.tsx`
    - Add after DiagramChip component (line 163)
    - Props: `relationshipRef: RelationshipRef`, `onRemove: (relationshipId: string) => void`
    - Use `styles.relationshipChip` CSS class
    - Display `relationshipRef.label` in `.chipLabel` span
    - Include remove button with `onRemove(relationshipRef.relationship_id)`
  - [x] 4.3 Create entity type plural name helper
    - Add `getEntityTypePluralLabel(entityType: string): string` function
    - Map collection keys to plural display names:
      - `applications` -> "Applications"
      - `services` -> "Services"
      - `interfaces` -> "Interfaces"
      - `logical_data_entities` -> "Logical Data Entities"
      - `physical_data_entities` -> "Physical Data Entities"
      - etc.
    - Return entity_type with first letter capitalized as fallback
  - [x] 4.4 Implement chip aggregation logic in ContextSection
    - File: `frontend/src/components/ProductView/WorkItemSummaryPanel.tsx`
    - Update ContextSection component to aggregate chips by type
    - For entities: group by `entity_type`, if count > 1 show "N TypeName" chip
    - For diagrams: if count > 1 show "N Diagrams" chip
    - For relationships: group by `relationship_type`, if count > 1 show "N RelationshipDisplayLabel" chip
    - Use `RELATIONSHIP_TYPE_DISPLAY_LABELS` for relationship aggregation labels
  - [x] 4.5 Update ContextSection to render relationship chips
    - Import `RelationshipRef` type from `contextStorage.ts`
    - Add `relationship_refs` to ContextSection props (from `contextState.relationship_refs`)
    - Add `onRemoveRelationshipChip: (relationshipId: string) => void` prop
    - Render RelationshipChip components in `.chipContainer`
  - [x] 4.6 Update WorkItemSummaryPanelProps interface
    - Add prop: `onRemoveRelationshipChip: (relationshipId: string) => void`
    - Pass prop through to ContextSection
  - [x] 4.7 Ensure chip rendering tests pass
    - Run ONLY the 5-6 tests written in 4.1
    - Verify aggregation works correctly for entities, diagrams, relationships
    - Verify relationship chips render with green styling

**Acceptance Criteria:**
- The 5-6 tests written in 4.1 pass
- Single items show individual chips with names
- Multiple items of same type show aggregated chip with count
- Relationship chips render with green styling
- All chip labels are human-readable (never IDs)

---

### Persistence and Rehydration

#### Task Group 5: Label Resolution on Rehydration
**Dependencies:** Task Groups 2, 3, 4

- [x] 5.0 Complete persistence and rehydration for stable labels
  - [x] 5.1 Write 4-5 focused tests for label rehydration
    - Test entity_refs rehydrated with resolved names from architecture state
    - Test diagram_refs rehydrated with resolved names from diagrams array
    - Test relationship_refs rehydrated with computed labels from architecture state
    - Test "Loading..." placeholder shown when architecture data not yet loaded
    - Test labels never fall back to displaying IDs permanently
  - [x] 5.2 Create label resolution utility functions
    - File: `frontend/src/utils/contextLabelResolver.ts` (new file)
    - Function: `resolveEntityLabel(entityId: string, entityType: string, metaModelEntities): string | null`
      - Look up entity in appropriate collection by type
      - Return entity.name if found, null otherwise
    - Function: `resolveDiagramLabel(diagramId: string, diagrams: Diagram[]): string | null`
      - Find diagram by ID in diagrams array
      - Return diagram.name if found, null otherwise
    - Function: `resolveRelationshipLabel(relationshipId: string, relationshipType: string, metaModelRelationships, metaModelEntities): string | null`
      - Find relationship by ID in appropriate collection
      - Call `computeRelationshipLabel()` to generate human-readable label
      - Return computed label or null if relationship not found
  - [x] 5.3 Implement `rehydrateContextLabels()` function
    - File: `frontend/src/utils/contextLabelResolver.ts`
    - Signature: `rehydrateContextLabels(contextState: ContextState, metaModel: MetaModel, diagrams: Diagram[]): ContextState`
    - For each entity_ref: resolve label from metaModelEntities, keep existing label if resolution fails
    - For each diagram_ref: resolve label from diagrams array, keep existing label if resolution fails
    - For each relationship_ref: compute label from relationship and entities, keep existing label if resolution fails
    - Return new ContextState with resolved labels
  - [x] 5.4 Integrate rehydration in context loading
    - File: Where contextState is loaded and used (e.g., ImplementView or WorkItemSummaryPanel parent)
    - After loading contextState from localStorage via `loadContext()`
    - Call `rehydrateContextLabels()` with architecture state
    - Use rehydrated context for display
  - [x] 5.5 Handle loading state for unresolved labels
    - In chip rendering, check if architecture data is loaded
    - If not loaded: display "Loading..." as label
    - If loaded but label resolution fails: keep existing label (should already be readable)
    - Never display raw IDs in chip labels
  - [x] 5.6 Ensure rehydration tests pass
    - Run ONLY the 4-5 tests written in 5.1
    - Verify labels resolve correctly from architecture state
    - Verify graceful fallback when data not yet loaded

**Acceptance Criteria:**
- The 4-5 tests written in 5.1 pass
- Entity, diagram, and relationship labels resolved from architecture state on rehydration
- "Loading..." placeholder shown when architecture data not available
- Labels never permanently display raw IDs
- Context chips maintain readable labels across navigation/reload

---

### Integration Testing

#### Task Group 6: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical gaps only
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review the 3-4 tests written for CSS/styles (Task 1.1)
    - Review the 5-6 tests written for label utilities (Task 2.1)
    - Review the 4-5 tests written for modal integration (Task 3.1)
    - Review the 5-6 tests written for chip rendering (Task 4.1)
    - Review the 4-5 tests written for rehydration (Task 5.1)
    - Total existing tests: approximately 21-26 tests
  - [x] 6.2 Analyze test coverage gaps for this feature only
    - Identify critical user workflows that lack coverage
    - Focus on end-to-end flow: select relationship -> apply -> view chip -> reload -> verify label
    - Verify aggregation behavior with mixed single/multiple selections
    - Check modal height change doesn't break scrolling
  - [x] 6.3 Write up to 6 additional strategic tests maximum
    - Test: Full flow selecting relationships, applying, verifying chips display computed labels
    - Test: Aggregation with 1 entity vs 3 entities of same type
    - Test: Mixed selection (some entities, some diagrams, some relationships) renders all chips
    - Test: Reload page and verify chip labels rehydrated correctly
    - Test: Navigate away and back, verify chips maintain labels
    - Test: 90vh modal height allows content scrolling without footer overlap
  - [x] 6.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, 5.1, and 6.3)
    - Expected total: approximately 27-32 tests maximum
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 27-32 tests total)
- Critical end-to-end workflows covered
- No more than 6 additional tests added when filling gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

```
Phase 1: Foundation (Parallel)
  |-- Task Group 1: Modal Height and Chip Styles (CSS only)
  |-- Task Group 2: Relationship Label Utilities (utility functions)

Phase 2: Integration
  |-- Task Group 3: ContextPickerModal Integration (depends on 2)

Phase 3: Display
  |-- Task Group 4: WorkItemSummaryPanel Chips (depends on 1, 2, 3)

Phase 4: Persistence
  |-- Task Group 5: Label Rehydration (depends on 2, 4)

Phase 5: Validation
  |-- Task Group 6: Test Review and Gap Analysis (depends on 1-5)
```

**Parallelization Opportunities:**
- Task Groups 1 and 2 can run in parallel (no dependencies between CSS and utilities)
- Task Group 3 depends only on Task Group 2
- Task Group 4 depends on Task Groups 1, 2, and 3
- Task Group 5 depends on Task Groups 2 and 4
- Task Group 6 depends on all previous groups completing

---

## Key Files to Modify

| Layer | File | Action | Description |
|-------|------|--------|-------------|
| CSS | `ContextPickerModal.module.css` | Modify | Change max-height from 85vh to 90vh |
| CSS | `WorkItemSummaryPanel.module.css` | Modify | Add `.relationshipChip` green styling |
| Utility | `contextRelationshipLabelUtils.ts` | Create | New file with `computeRelationshipLabel()` and `RELATIONSHIP_TYPE_DISPLAY_LABELS` |
| Utility | `contextLabelResolver.ts` | Create | New file with rehydration functions |
| Utility | `contextPickListBuilders.ts` | Modify | Update `buildRelationshipPickList()` to use computed labels, add 9th relationship type |
| Utility | `contextPickerDomainMappings.ts` | Modify | Add `application_point_business_logics` to behavioural domain |
| Component | `ContextPickerModal.tsx` | Modify | Pass metaModelEntities to buildRelationshipPickList |
| Component | `WorkItemSummaryPanel.tsx` | Modify | Add RelationshipChip, aggregation logic, rehydration integration |

---

## New Files

| File Path | Purpose |
|-----------|---------|
| `frontend/src/utils/contextRelationshipLabelUtils.ts` | Relationship label computation utility and constants |
| `frontend/src/utils/contextLabelResolver.ts` | Label resolution and rehydration utilities |
| `frontend/src/__tests__/contextRelationshipLabelUtils.test.ts` | Tests for relationship label utilities |
| `frontend/src/__tests__/contextLabelResolver.test.ts` | Tests for label rehydration |
| `frontend/src/__tests__/WorkItemSummaryPanel.chips.test.tsx` | Tests for chip rendering and aggregation |

---

## Risk Areas and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Entity lookup fails for some IDs | Labels display "Unknown [TYPE]" | Acceptable fallback; never display raw IDs |
| Large number of relationships causes performance issues | Slow modal rendering | Consider lazy loading or virtualization (out of scope for this iteration) |
| 90vh height causes footer overlap on short screens | Apply button not visible | Test on various viewport heights; footer uses flex-shrink: 0 |
| Relationship participant ID field names vary by type | Wrong participants extracted | Document field mappings in `RELATIONSHIP_PARTICIPANT_CONFIGS` |
| Aggregation counts incorrect after chip removal | Incorrect chip display | Recalculate aggregation on every render |
| Rehydration race condition with architecture loading | Labels show "Loading..." too long | Use loading state, resolve when architecture data available |

---

## Out of Scope Reminders

Per spec, the following are explicitly excluded:
- Backend expansion logic changes
- Changes to Planner prompt contents
- New relationship types beyond the 9 listed
- Changes to selection persistence schema (use existing RelationshipRef structure)
- Modifying the ContextPickerModal tab layout or domain structure
- Changes to how relationships are stored in localStorage
- Tooltip or hover behavior on chips
- Chip click-to-navigate functionality
- Search/filter functionality for chips
- Drag-and-drop reordering of chips
