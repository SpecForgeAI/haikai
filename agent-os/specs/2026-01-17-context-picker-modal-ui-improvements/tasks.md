# Task Breakdown: Context Picker Modal UI Improvements

## Overview
Total Tasks: 38

This feature modernizes the Context Picker modal with:
1. Expanded modal dimensions (100% wider, 50% taller content area)
2. Six icon-based domain tabs replacing the current 2-text-tab layout
3. Entities and Relationships sections within each domain tab
4. New relationship selection capability with `selectedRelationshipIds` state
5. Extended `ContextState` with `relationship_refs` for Apply payload

## Task List

### Type Layer

#### Task Group 1: Type Definitions and Domain Mappings
**Dependencies:** None

- [x] 1.0 Complete type layer definitions
  - [x] 1.1 Write 4 focused tests for new types and mappings
    - Test `RelationshipPickOption` interface has required fields (value, label, relationship_type)
    - Test `RelationshipRef` interface has required fields (kind, relationship_type, relationship_id, label)
    - Test `DOMAIN_TO_ENTITY_TYPES` mapping returns correct entity types for each domain
    - Test `DOMAIN_TO_RELATIONSHIP_TYPES` mapping returns correct relationship types for each domain
  - [x] 1.2 Define `RelationshipPickOption` type in `contextPickListBuilders.ts`
    - Fields: `value: string` (relationship id), `label: string`, `relationship_type: string`
    - Follow existing `PickOption` interface pattern
  - [x] 1.3 Define `RelationshipRef` type in `contextStorage.ts`
    - Fields: `kind: 'RELATIONSHIP'`, `relationship_type: string`, `relationship_id: string`, `label: string`
    - Follow existing `EntityRef` and `DiagramRef` patterns
  - [x] 1.4 Extend `ContextState` interface in `contextStorage.ts`
    - Add optional field: `relationship_refs?: RelationshipRef[]`
    - Maintain backward compatibility with existing code
  - [x] 1.5 Create domain-to-entity-type mapping constant
    - File: `frontend/src/utils/contextPickerDomainMappings.ts` (new file)
    - Define `DOMAIN_TO_ENTITY_TYPES: Record<ArchitectureDomain, string[]>`
    - Business: `['business_users', 'business_processes', 'process_activities']`
    - Application: `['applications', 'app_components', 'services', 'interfaces', 'endpoints']`
    - Data: `['logical_data_entities', 'physical_data_entities']`
    - Behavioural: `['events', 'states', 'activities']`
    - UI: `['ui_screens', 'ui_components', 'ui_actions']`
  - [x] 1.6 Create domain-to-relationship-type mapping constant
    - Same file as 1.5
    - Define `DOMAIN_TO_RELATIONSHIP_TYPES: Record<ArchitectureDomain, string[]>`
    - Business: `['business_user_business_points']`
    - Application: `['application_point_business_points', 'interface_logical_data_entity']`
    - Data: `['logical_data_entity_relationships', 'logical_data_entity_physical_data_entity', 'logical_data_attribute_physical_data_attribute', 'data_movements']`
    - Behavioural: `['state_transitions', 'activity_flows']`
    - UI: `['ui_workflow_transitions']`
  - [x] 1.7 Ensure type layer tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify TypeScript compilation succeeds

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- `RelationshipPickOption` and `RelationshipRef` types defined
- `ContextState` extended with optional `relationship_refs`
- Domain mapping constants defined for both entities and relationships
- TypeScript compilation succeeds with no errors

---

### Pick List Builder Layer

#### Task Group 2: Relationship Pick List Builder
**Dependencies:** Task Group 1

- [x] 2.0 Complete relationship pick list builder
  - [x] 2.1 Write 4 focused tests for `buildRelationshipPickList`
    - Test function returns grouped relationships by relationship type key
    - Test labels are extracted from relationship `name` field with fallback
    - Test empty metaModel.relationships returns empty object
    - Test function handles missing relationship collections gracefully
  - [x] 2.2 Define `RELATIONSHIP_COLLECTION_KEYS` constant
    - File: `frontend/src/utils/contextPickListBuilders.ts`
    - Array of valid relationship type keys from `MetaModelRelationships`
    - Keys: `['business_user_business_points', 'application_point_business_points', 'interface_logical_data_entity', 'logical_data_entity_relationships', 'logical_data_entity_physical_data_entity', 'logical_data_attribute_physical_data_attribute', 'data_movements', 'state_transitions', 'activity_flows', 'ui_workflow_transitions']`
  - [x] 2.3 Implement `buildRelationshipPickList` function
    - File: `frontend/src/utils/contextPickListBuilders.ts`
    - Signature: `(metaModelRelationships: MetaModelRelationships) => Record<string, RelationshipPickOption[]>`
    - Iterate over `RELATIONSHIP_COLLECTION_KEYS`
    - For each relationship, extract label from `name` field with fallback to `relationship_type + id`
    - Return grouped options by relationship type key
    - Follow `buildArchitecturePickList` pattern
  - [x] 2.4 Export new function and types from module
    - Export `RelationshipPickOption` type
    - Export `buildRelationshipPickList` function
    - Export `RELATIONSHIP_COLLECTION_KEYS` constant
  - [x] 2.5 Ensure pick list builder tests pass
    - Run ONLY the 4 tests written in 2.1
    - Verify function produces correct output structure

**Acceptance Criteria:**
- The 4 tests written in 2.1 pass
- `buildRelationshipPickList` produces grouped relationship options
- Labels extracted correctly with fallback handling
- Empty/missing collections handled gracefully

---

### CSS Layer

#### Task Group 3: Modal Size and Layout Styles
**Dependencies:** None

- [x] 3.0 Complete CSS modal size and layout updates
  - [x] 3.1 Write 3 focused tests for modal dimension changes
    - Test `.modal` class has `max-width: 1200px` (increased from 600px)
    - Test `.modal` class has `max-height: 85vh` (increased from 80vh)
    - Test `.content` class maintains `overflow-y: auto` for independent scrolling
  - [x] 3.2 Update `.modal` dimensions in `ContextPickerModal.module.css`
    - Change `max-width` from `600px` to `1200px`
    - Change `max-height` from `80vh` to `85vh`
    - Preserve existing flexbox column layout
  - [x] 3.3 Update `.content` min/max height for larger content area
    - Increase `min-height` from `300px` to `450px`
    - Increase `max-height` from `400px` to `600px`
    - Maintain `overflow-y: auto` and `flex: 1`
  - [x] 3.4 Ensure header and footer remain sticky
    - Verify `.header` has no conflicting overflow properties
    - Verify `.footer` has no conflicting overflow properties
    - Both should remain outside the scroll area (existing behavior)
  - [x] 3.5 Ensure CSS tests pass
    - Run ONLY the 3 tests written in 3.1
    - Verify modal renders at correct dimensions

**Acceptance Criteria:**
- The 3 tests written in 3.1 pass
- Modal is 1200px wide (100% increase)
- Content area is approximately 50% taller
- Header and footer remain fixed while content scrolls

---

#### Task Group 4: Icon Tab Strip Styles
**Dependencies:** None

- [x] 4.0 Complete icon tab strip CSS
  - [x] 4.1 Write 3 focused tests for tab strip styling
    - Test `.domainTab` class has 28px width and height matching `PaletteDomainSelector`
    - Test `.domainTab.selected` class has blue highlight (#1976D2) and white background
    - Test `.domainTabStrip` displays tabs in a row with proper spacing
  - [x] 4.2 Add domain tab strip styles to `ContextPickerModal.module.css`
    - Create `.domainTabStrip` class: `display: flex`, `gap: 4px`, centered alignment
    - Follow `.domainSelector` pattern from `PaletteDomainSelector.module.css`
    - Add border-bottom separator line
  - [x] 4.3 Add individual domain tab button styles
    - Create `.domainTab` class: 28px square, transparent background, centered icon
    - Create `.domainTab:hover` state: subtle background highlight
    - Create `.domainTab.selected` state: #1976D2 color, white background, subtle shadow
    - Follow `.domainButton` pattern from `PaletteDomainSelector.module.css`
  - [x] 4.4 Add icon styling within tab
    - Create `.domainTabIcon` class: 16px size, proper flex alignment
    - Ensure icon inherits color from parent button state
  - [x] 4.5 Ensure tab strip CSS tests pass
    - Run ONLY the 3 tests written in 4.1
    - Verify tabs match visual pattern from PaletteDomainSelector

**Acceptance Criteria:**
- The 3 tests written in 4.1 pass
- Tab strip displays 6 icon buttons in a row
- Selected tab has blue (#1976D2) styling
- Styling matches existing PaletteDomainSelector pattern

---

#### Task Group 5: Collapsible Section Styles
**Dependencies:** None

- [x] 5.0 Complete collapsible section CSS
  - [x] 5.1 Write 2 focused tests for section styling
    - Test `.domainSection` header has triangle indicator and uppercase label
    - Test `.domainSection` body collapses/expands correctly
  - [x] 5.2 Add domain section container styles
    - Create `.domainSection` class: margin-bottom for separation
    - Create `.domainSectionHeader` class: flex row, clickable cursor, padding
    - Add triangle indicator styling matching `.groupToggle` pattern
    - Add uppercase label styling matching `.groupTitle` pattern
    - Add count badge styling matching `.groupCount` pattern
  - [x] 5.3 Add section body styles
    - Create `.domainSectionBody` class: left padding for indent
    - Reuse existing `.optionRow`, `.optionItem`, `.checkbox`, `.optionLabel` for rows
  - [x] 5.4 Ensure section CSS tests pass
    - Run ONLY the 2 tests written in 5.1
    - Verify sections match PaletteSection visual pattern

**Acceptance Criteria:**
- The 2 tests written in 5.1 pass
- Sections have collapsible headers with triangle indicators
- Section styling matches PaletteSection pattern

---

### Component Layer

#### Task Group 6: Domain Tab Strip Component
**Dependencies:** Task Groups 3, 4

- [x] 6.0 Complete domain tab strip component
  - [x] 6.1 Write 4 focused tests for DomainTabStrip component
    - Test renders 6 icon buttons (5 domains + diagrams)
    - Test clicking a tab calls onTabChange with correct domain/diagrams value
    - Test selected tab shows `.selected` class
    - Test arrow key navigation moves focus between tabs (accessibility)
  - [x] 6.2 Create `DomainTabStrip` sub-component in `ContextPickerModal.tsx`
    - Props: `activeTab: ArchitectureDomain | 'diagrams'`, `onTabChange: (tab) => void`
    - Import `ALL_DOMAINS`, `DOMAIN_LABELS`, `DOMAIN_ICONS` from `architectureDomain.ts`
    - Import `ChartNetwork` icon from `lucide-react` for Diagrams tab
  - [x] 6.3 Implement tab rendering logic
    - Map over `ALL_DOMAINS` to render 5 domain tabs
    - Add 6th tab for Diagrams with `ChartNetwork` icon
    - Apply `.selected` class when tab matches `activeTab`
    - Add `title` attribute with domain label for tooltip
    - Add `data-testid` for each tab
  - [x] 6.4 Implement keyboard navigation
    - Add `onKeyDown` handler to tab strip container
    - Arrow left/right to move focus between tabs
    - Enter/Space to activate focused tab
    - Use `tabIndex` appropriately (0 for selected, -1 for others)
  - [x] 6.5 Ensure tab strip component tests pass
    - Run ONLY the 4 tests written in 6.1
    - Verify tab interactions work correctly

**Acceptance Criteria:**
- The 4 tests written in 6.1 pass
- 6 icon tabs render correctly (5 domains + Diagrams)
- Tab selection updates state
- Keyboard navigation works for accessibility

---

#### Task Group 7: Domain Section Components (Entities/Relationships)
**Dependencies:** Task Groups 1, 2, 5, 6

- [x] 7.0 Complete domain section components
  - [x] 7.1 Write 5 focused tests for domain sections
    - Test Entities section renders filtered entities for selected domain
    - Test Relationships section renders filtered relationships for selected domain
    - Test both sections default to expanded state
    - Test clicking section header toggles collapse state
    - Test checkbox selection updates correct state (entity vs relationship)
  - [x] 7.2 Create `DomainEntitiesSection` sub-component
    - Props: `domain: ArchitectureDomain`, `architectureOptions`, `selectedEntityIds`, `onEntityToggle`, etc.
    - Filter `architectureOptions` using `DOMAIN_TO_ENTITY_TYPES[domain]`
    - Render collapsible section with "Entities" header and count badge
    - Reuse existing entity row rendering pattern with BundleSelector and DepthSelector
  - [x] 7.3 Create `DomainRelationshipsSection` sub-component
    - Props: `domain: ArchitectureDomain`, `relationshipOptions`, `selectedRelationshipIds`, `onRelationshipToggle`
    - Filter `relationshipOptions` using `DOMAIN_TO_RELATIONSHIP_TYPES[domain]`
    - Render collapsible section with "Relationships" header and count badge
    - Render flat checkbox rows (no nested groups, no bundle dropdown)
  - [x] 7.4 Add section expand/collapse state management
    - Track `entitiesSectionExpanded` and `relationshipsSectionExpanded` per domain
    - Default both to `true` on modal open
    - Toggle on header click
  - [x] 7.5 Ensure domain section tests pass
    - Run ONLY the 5 tests written in 7.1
    - Verify sections filter and render correctly

**Acceptance Criteria:**
- The 5 tests written in 7.1 pass
- Entities section filters by domain correctly
- Relationships section filters by domain correctly
- Both sections collapsible with proper state management

---

#### Task Group 8: Main Component Refactoring
**Dependencies:** Task Groups 6, 7

- [x] 8.0 Complete main component refactoring
  - [x] 8.1 Write 5 focused tests for refactored ContextPickerModal
    - Test modal renders with 6 domain tabs instead of 2 text tabs
    - Test default tab is "Business" (or last-used from component state)
    - Test switching tabs shows correct Entities/Relationships sections
    - Test Diagrams tab shows existing diagram content (no regression)
    - Test Apply builds `relationship_refs` array in ContextState
  - [x] 8.2 Update state management in `ContextPickerModal`
    - Change `activeTab` type from `TabType` to `ArchitectureDomain | 'diagrams'`
    - Add `selectedRelationshipIds: Set<string>` state
    - Add `lastUsedTab` state for tab persistence within component lifecycle
    - Initialize `lastUsedTab` to 'business' on first mount
  - [x] 8.3 Replace tab rendering with `DomainTabStrip`
    - Remove existing text tab buttons
    - Render `DomainTabStrip` with current active tab and change handler
    - Update tab change to set `lastUsedTab` for persistence
  - [x] 8.4 Update content area for domain tabs
    - For 5 architecture domains: render `DomainEntitiesSection` and `DomainRelationshipsSection`
    - For Diagrams tab: render existing diagram content unchanged
    - Remove old architecture/diagrams tab conditional
  - [x] 8.5 Add `relationshipOptions` prop
    - Extend `ContextPickerModalProps` to accept `relationshipOptions: Record<string, RelationshipPickOption[]>`
    - Pass to domain sections for relationship rendering
  - [x] 8.6 Update `handleApply` to include `relationship_refs`
    - Build `relationship_refs` array from `selectedRelationshipIds`
    - Add to `ContextState` returned to `onApply` callback
    - Preserve existing entity_refs and diagram_refs logic
  - [x] 8.7 Add relationship toggle handler
    - Create `handleRelationshipToggle(relationshipId: string)` callback
    - Toggle relationship in `selectedRelationshipIds` set
    - Similar pattern to `handleDiagramToggle`
  - [x] 8.8 Ensure main component tests pass
    - Run ONLY the 5 tests written in 8.1
    - Verify refactored component works correctly

**Acceptance Criteria:**
- The 5 tests written in 8.1 pass
- 6 icon tabs replace 2 text tabs
- Domain switching shows correct content
- Diagrams tab unchanged (no regression)
- Apply includes relationship_refs

---

### Integration Layer

#### Task Group 9: Parent Component Integration
**Dependencies:** Task Group 8

- [x] 9.0 Complete parent component integration
  - [x] 9.1 Write 3 focused tests for parent integration
    - Test parent component builds and passes `relationshipOptions` prop
    - Test `onApply` handler receives `relationship_refs` in ContextState
    - Test relationship_refs are persisted to localStorage (if applicable)
  - [x] 9.2 Update parent component to build relationship options
    - Identify parent component that renders `ContextPickerModal`
    - Import `buildRelationshipPickList` function
    - Call with `metaModel.relationships` and pass result as `relationshipOptions` prop
  - [x] 9.3 Update `onApply` handler to process relationship_refs
    - Handle new `relationship_refs` field in ContextState
    - Persist to context state storage if applicable
    - Log relationship count for debugging
  - [x] 9.4 Ensure parent integration tests pass
    - Run ONLY the 3 tests written in 9.1
    - Verify end-to-end relationship selection flow

**Acceptance Criteria:**
- The 3 tests written in 9.1 pass
- Relationship options passed to modal correctly
- Relationship refs handled in onApply callback

---

### Testing

#### Task Group 10: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-9

- [x] 10.0 Review existing tests and fill critical gaps only
  - [x] 10.1 Review tests from Task Groups 1-9
    - Review 4 tests from Task Group 1 (type definitions)
    - Review 4 tests from Task Group 2 (pick list builder)
    - Review 3 tests from Task Group 3 (modal size CSS)
    - Review 3 tests from Task Group 4 (tab strip CSS)
    - Review 2 tests from Task Group 5 (section CSS)
    - Review 4 tests from Task Group 6 (tab strip component)
    - Review 5 tests from Task Group 7 (domain sections)
    - Review 5 tests from Task Group 8 (main component)
    - Review 3 tests from Task Group 9 (parent integration)
    - Total existing tests: approximately 33 tests
  - [x] 10.2 Analyze test coverage gaps for this feature only
    - Verify domain filtering logic is tested for all 5 domains
    - Verify relationship selection end-to-end flow is tested
    - Check keyboard accessibility is tested for tab navigation
    - Focus ONLY on gaps related to this spec's feature requirements
  - [x] 10.3 Write up to 5 additional strategic tests maximum
    - Test domain tab persistence within component lifecycle
    - Test relationship selection does not affect entity selection (isolation)
    - Test Apply button disabled state when nothing selected (if applicable)
    - Test modal close via Escape key still works with new layout
    - Test search filtering still works within domain tabs (diagrams only per spec)
  - [x] 10.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature
    - Expected total: approximately 33-38 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 33-38 tests total)
- Domain filtering and relationship selection flows covered
- Keyboard accessibility verified
- No more than 5 additional tests added when filling in gaps

---

## Execution Order

Recommended implementation sequence:

1. **Type Layer (Task Group 1)** - Foundation types and mappings
2. **Pick List Builder (Task Group 2)** - Relationship pick list builder
3. **CSS Layer (Task Groups 3, 4, 5)** - Can run in parallel; no interdependencies
4. **Tab Strip Component (Task Group 6)** - Depends on CSS layer
5. **Domain Sections (Task Group 7)** - Depends on types, pick list builder, and CSS
6. **Main Component (Task Group 8)** - Depends on tab strip and domain sections
7. **Parent Integration (Task Group 9)** - Depends on main component
8. **Test Review (Task Group 10)** - Final verification

**Parallel Execution Opportunities:**
- Task Groups 3, 4, 5 (CSS) can run in parallel with each other
- Task Groups 1 and 2 can run in parallel with Task Groups 3, 4, 5
- Task Group 6 can start once Task Groups 3 and 4 are complete
- Task Group 7 can start once Task Groups 1, 2, and 5 are complete

---

## Key Files to Modify

### New Files
| File | Purpose |
|------|---------|
| `frontend/src/utils/contextPickerDomainMappings.ts` | Domain-to-entity and domain-to-relationship type mappings |
| `frontend/src/__tests__/contextPickerDomainMappings.test.ts` | Tests for domain mappings |
| `frontend/src/__tests__/ContextPickerModal.domain-tabs.test.tsx` | Tests for domain tab functionality |

### Modified Files
| File | Changes |
|------|---------|
| `frontend/src/utils/contextStorage.ts` | Add `RelationshipRef` type; extend `ContextState` with `relationship_refs` |
| `frontend/src/utils/contextPickListBuilders.ts` | Add `RelationshipPickOption` type; add `buildRelationshipPickList` function; add `RELATIONSHIP_COLLECTION_KEYS` |
| `frontend/src/components/ProductView/ContextPickerModal.tsx` | Replace 2-tab layout with 6-icon-tab layout; add domain sections; add relationship selection state; update Apply payload |
| `frontend/src/components/ProductView/ContextPickerModal.module.css` | Increase modal size; add domain tab strip styles; add section styles |

### Reference Files (Read Only)
| File | Purpose |
|------|---------|
| `frontend/src/types/architectureDomain.ts` | Source of `ALL_DOMAINS`, `DOMAIN_LABELS`, `DOMAIN_ICONS` |
| `frontend/src/components/DiagramsView/PaletteDomainSelector.module.css` | Pattern for tab button styling |
| `frontend/src/components/DiagramsView/PaletteSection.tsx` | Pattern for collapsible sections |

---

## Risk Areas and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Regression in existing entity/diagram selection | High | Preserve existing handlers; add explicit non-regression tests for Diagrams tab |
| Modal size causes clipping on small screens | Medium | Use responsive breakpoints; test on 1024px minimum width |
| Keyboard navigation conflicts | Medium | Test Tab key flow; ensure focus trap still works correctly |
| Relationship types missing from metaModel | Low | Graceful fallback to empty arrays; log warnings for debugging |
| Performance with large relationship lists | Low | Relationship sections render flat lists (no nesting); reuse existing virtualization if available |
| Bundle/Depth selectors interfere with relationship rows | Low | Relationship rows explicitly exclude bundle dropdown per spec |
| Search filtering behavior changes | Medium | Verify search only applies to Diagrams tab per spec; disable in Entities/Relationships sections |

---

## Notes

- The `ChartNetwork` icon from `lucide-react` is used for the Diagrams tab (6th tab)
- Last-used tab persists in component state only (resets on modal remount) - not localStorage per spec
- Relationship rows do not have bundle dropdown or depth selector per spec (simple selection only)
- Search filtering applies to Diagrams tab only (Entities/Relationships sections do not filter by search per spec)
- Suggestions section behavior unchanged (existing logic preserved)
