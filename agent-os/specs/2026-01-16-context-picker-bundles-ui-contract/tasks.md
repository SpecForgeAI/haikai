# Task Breakdown: Context Picker Bundles - UI and Selection Contract

## Overview
Total Tasks: 23

This feature extends the context picker modal to allow users to select bundle scopes for architecture entities (interfaces, services, physical data entities) and diagrams. Bundle selections are persisted alongside existing context selections in localStorage for future backend expansion.

## Task List

### Type Definitions

#### Task Group 1: Bundle Type Constants and Helpers
**Dependencies:** None

- [x] 1.0 Complete bundle type constants module
  - [x] 1.1 Write 4-6 focused tests for bundle type utilities
    - Test `getDefaultBundleType()` returns correct defaults for interfaces, services, physical_data_entities, diagrams
    - Test `getDefaultBundleType()` returns undefined for unsupported entity types
    - Test `getBundleOptionsForEntityType()` returns correct options array for each supported type
    - Test `getBundleOptionsForEntityType()` returns empty array for unsupported types
  - [x] 1.2 Create `frontend/src/utils/contextBundleTypes.ts` with TypeScript union types
    - Define `InterfaceBundleType` union: `'interface_only' | 'interface_with_endpoints' | 'interface_with_endpoints_and_schemas'`
    - Define `ServiceBundleType` union: `'service_only' | 'service_with_parents_and_children'`
    - Define `PhysicalDataEntityBundleType` union: `'entity_only' | 'entity_with_attributes_and_relationships'`
    - Define `DiagramBundleType` union: `'diagram_only'`
    - Define `BundleType` as union of all bundle type unions
  - [x] 1.3 Implement `getDefaultBundleType(entityType: string): string | undefined`
    - Return `'interface_with_endpoints_and_schemas'` for `'interfaces'`
    - Return `'service_with_parents_and_children'` for `'services'`
    - Return `'entity_with_attributes_and_relationships'` for `'physical_data_entities'`
    - Return `'diagram_only'` for diagrams
    - Return `undefined` for other entity types (no bundle support)
  - [x] 1.4 Implement `getBundleOptionsForEntityType(entityType: string): string[]`
    - Return array of options for interfaces: `['interface_only', 'interface_with_endpoints', 'interface_with_endpoints_and_schemas']`
    - Return array of options for services: `['service_only', 'service_with_parents_and_children']`
    - Return array of options for physical_data_entities: `['entity_only', 'entity_with_attributes_and_relationships']`
    - Return array for diagrams: `['diagram_only']`
    - Return empty array for unsupported entity types
  - [x] 1.5 Export human-readable labels map for bundle options
    - Create `BUNDLE_TYPE_LABELS: Record<string, string>` mapping bundle keys to display labels
    - Example: `'interface_with_endpoints_and_schemas'` -> `'With Endpoints & Schemas'`
  - [x] 1.6 Ensure bundle type tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify all helper functions return correct values

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- Union types provide proper TypeScript type safety
- Helper functions correctly map entity types to bundle options
- Human-readable labels provided for UI display

### Context Storage Interface Updates

#### Task Group 2: Extend EntityRef and DiagramRef Interfaces
**Dependencies:** Task Group 1

- [x] 2.0 Complete context storage interface extensions
  - [x] 2.1 Write 3-4 focused tests for bundle_type persistence
    - Test saveContext/loadContext round-trip preserves bundle_type on EntityRef
    - Test saveContext/loadContext round-trip preserves bundle_type on DiagramRef
    - Test loadContext handles legacy data without bundle_type (backward compatibility)
    - Test loadContext returns refs with undefined bundle_type when not present in storage
  - [x] 2.2 Extend `EntityRef` interface in `frontend/src/utils/contextStorage.ts`
    - Add optional `bundle_type?: string` field after `label` field (around line 29)
    - Add JSDoc comment: `/** Optional bundle scope for context expansion */`
  - [x] 2.3 Extend `DiagramRef` interface in `frontend/src/utils/contextStorage.ts`
    - Add optional `bundle_type?: string` field after `label` field (around line 41)
    - Add JSDoc comment: `/** Optional bundle scope for context expansion */`
  - [x] 2.4 Verify existing loadContext/saveContext work unchanged
    - No modifications needed to loadContext/saveContext functions
    - JSON.parse/stringify automatically handles optional fields
    - Existing validation accepts objects with additional fields
  - [x] 2.5 Ensure context storage tests pass
    - Run ONLY the 3-4 tests written in 2.1
    - Verify backward compatibility with existing saved contexts

**Acceptance Criteria:**
- The 3-4 tests written in 2.1 pass
- EntityRef and DiagramRef interfaces include optional bundle_type
- Existing saved contexts load correctly (backward compatible)
- New contexts can include bundle_type values

### Modal State Management

#### Task Group 3: Bundle Selection State in ContextPickerModal
**Dependencies:** Task Group 1, Task Group 2

- [x] 3.0 Complete modal state management for bundles
  - [x] 3.1 Write 4-6 focused tests for bundle selection state
    - Test bundle state initializes from initialSelected.entity_refs with bundle_type
    - Test bundle state applies default bundle when entity lacks bundle_type
    - Test bundle state updates when user changes dropdown selection
    - Test handleApply includes bundle_type in returned EntityRef objects
    - Test handleApply sets 'diagram_only' bundle_type on DiagramRef objects
  - [x] 3.2 Add bundle selection state to ContextPickerModal
    - Add state: `const [entityBundleSelections, setEntityBundleSelections] = useState<Record<string, string>>({})`
    - Key is entity_id, value is selected bundle_type string
  - [x] 3.3 Initialize bundle state in useEffect when modal opens
    - Modify existing useEffect (lines 70-93) to also initialize entityBundleSelections
    - For each entity in initialSelected.entity_refs:
      - If entity has bundle_type, use that value
      - If entity lacks bundle_type, call `getDefaultBundleType(entity.entity_type)` for default
    - Build Record mapping entity_id to bundle_type
  - [x] 3.4 Create handler for bundle dropdown changes
    - Add: `const handleBundleChange = useCallback((entityId: string, bundleType: string) => {...}, [])`
    - Update entityBundleSelections state with new value
  - [x] 3.5 Update handleEntityToggle to initialize bundle on selection
    - When entity is checked (added to selection), set default bundle in entityBundleSelections
    - Use `getDefaultBundleType(option.entity_type)` to determine default
    - When entity is unchecked, optionally clean up entityBundleSelections entry
  - [x] 3.6 Update handleApply to include bundle_type in refs
    - Modify EntityRef construction (lines 194-200) to include bundle_type from entityBundleSelections
    - Modify DiagramRef construction (lines 208-212) to always include `bundle_type: 'diagram_only'`
  - [x] 3.7 Ensure modal state tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify state initialization, updates, and apply behavior

**Acceptance Criteria:**
- The 4-6 tests written in 3.1 pass
- Bundle selections tracked per entity in component state
- State initializes correctly from existing context (with defaults for missing bundle_type)
- handleApply produces EntityRef/DiagramRef objects with bundle_type

### UI Bundle Selector Component

#### Task Group 4: Bundle Dropdown UI in ContextPickerModal
**Dependencies:** Task Group 3

- [x] 4.0 Complete bundle selector UI implementation
  - [x] 4.1 Write 3-4 focused tests for bundle dropdown rendering
    - Test dropdown renders for selected interface entity with correct options
    - Test dropdown renders for selected service entity with correct options
    - Test dropdown does NOT render for unselected entities
    - Test dropdown does NOT render for entity types without bundle support
  - [x] 4.2 Import bundle type utilities into ContextPickerModal
    - Add import: `import { getDefaultBundleType, getBundleOptionsForEntityType, BUNDLE_TYPE_LABELS } from '../../utils/contextBundleTypes'`
  - [x] 4.3 Create BundleSelector inline component or helper function
    - Renders `<select>` dropdown with bundle options for the entity type
    - Props: entityId, entityType, currentValue, onChange
    - Only renders if `getBundleOptionsForEntityType(entityType).length > 0`
    - Maps options using BUNDLE_TYPE_LABELS for display text
  - [x] 4.4 Add bundle dropdown to architecture tab entity rows
    - Modify entity row rendering (lines 348-363 area)
    - When entity is selected (checkbox checked), render BundleSelector inline after label
    - Pass current bundle value from entityBundleSelections state
    - Pass handleBundleChange as onChange callback
  - [x] 4.5 Add CSS styles for inline bundle dropdown
    - Add `.bundleSelect` class to `ContextPickerModal.module.css`
    - Follow pattern from `AdvancedAddDialog.module.css` `.spacingSelect` class
    - Width approximately 180px to fit inline with option row
    - Match existing color scheme: border `#ddd`, focus border `#1976D2`
  - [x] 4.6 Ensure bundle dropdown does not appear for diagrams tab
    - Diagram rows should not show bundle dropdown (diagram_only is implicit default)
  - [x] 4.7 Ensure bundle selector UI tests pass
    - Run ONLY the 3-4 tests written in 4.1
    - Verify dropdowns render correctly for appropriate entity types

**Acceptance Criteria:**
- The 3-4 tests written in 4.1 pass
- Bundle dropdown appears inline with selected entities that support bundles
- Dropdown options match the entity type (interfaces, services, physical_data_entities)
- No dropdown for entity types without bundle support
- Styling consistent with existing application patterns

### Testing and Backward Compatibility

#### Task Group 5: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 4-6 tests written for bundle types (Task 1.1)
    - Review the 3-4 tests written for context storage (Task 2.1)
    - Review the 4-6 tests written for modal state (Task 3.1)
    - Review the 3-4 tests written for bundle selector UI (Task 4.1)
    - Total existing tests: approximately 14-20 tests
  - [x] 5.2 Analyze test coverage gaps for bundle feature only
    - Identify critical user workflows that lack test coverage
    - Focus on end-to-end flow: open modal -> select entity -> choose bundle -> apply -> verify context saved
    - Verify backward compatibility: load old context -> open modal -> check defaults applied
  - [x] 5.3 Write up to 6 additional strategic tests maximum
    - Add integration test: full modal flow with bundle selection
    - Add backward compatibility test: loading context without bundle_type shows defaults
    - Add test: changing bundle selection and applying preserves new value
    - Add test: re-opening modal preserves previously saved bundle selections
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, and 5.3)
    - Expected total: approximately 20-26 tests maximum
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 20-26 tests total)
- Backward compatibility verified (old contexts load with sensible defaults)
- End-to-end bundle selection flow tested
- No more than 6 additional tests added in this task group

## Execution Order

Recommended implementation sequence:
1. **Task Group 1: Bundle Type Constants** - Foundation for all other work
2. **Task Group 2: Context Storage Interfaces** - Enable bundle_type persistence
3. **Task Group 3: Modal State Management** - Wire up state tracking
4. **Task Group 4: Bundle Selector UI** - User-facing dropdown component
5. **Task Group 5: Test Review and Gap Analysis** - Verify all integration points

## File Summary

**New Files:**
- `frontend/src/utils/contextBundleTypes.ts` - Bundle type constants and helpers
- `frontend/src/__tests__/contextBundleTypes.test.ts` - Tests for bundle type utilities
- `frontend/src/__tests__/ContextPickerModal.bundle.test.tsx` - Tests for bundle selection state
- `frontend/src/__tests__/ContextPickerModal.bundle-ui.test.tsx` - Tests for bundle dropdown UI
- `frontend/src/__tests__/contextBundleIntegration.test.ts` - Integration tests for bundle feature (Task Group 5)

**Modified Files:**
- `frontend/src/utils/contextStorage.ts` - Add bundle_type to EntityRef and DiagramRef interfaces
- `frontend/src/components/ProductView/ContextPickerModal.tsx` - Add bundle state and dropdown UI
- `frontend/src/components/ProductView/ContextPickerModal.module.css` - Add bundleSelect styles
- `frontend/src/__tests__/contextStorage.test.ts` - Add bundle_type persistence tests

## Notes

- **No backend changes required** - bundle_type is stored in localStorage only
- **No LLM payload changes** - bundle_type stored but not expanded in this iteration
- **Backward compatibility critical** - existing saved contexts must continue working
- **UI should be unobtrusive** - dropdown only appears for selected entities with bundle support
