# Task Breakdown: Context Picker Smart Defaults and Heuristic Suggestions

## Overview
Total Tasks: 32

This spec implements smart default bundle type assignment, heuristic-driven context suggestions, and depth control for entity relationship expansion in the Context Picker modal.

## Task List

### Types and Contracts Layer

#### Task Group 1: Type Extensions for Depth Control
**Dependencies:** None

- [x] 1.0 Complete type extensions for depth parameter
  - [x] 1.1 Write 3-5 focused tests for depth type extensions
    - Test EntityRef with optional depth field accepts valid values (1, 2, undefined)
    - Test EntityBundleSelection with depth field serialization
    - Test backward compatibility when depth is omitted
    - Test depth type narrowing (1 | 2 union type)
  - [x] 1.2 Extend EntityRef interface in contextStorage.ts
    - Add optional `depth?: 1 | 2` field after bundle_type (line 30)
    - Add JSDoc documenting depth semantics and default value
    - Maintain backward compatibility - undefined means depth 1
  - [x] 1.3 Extend EntityBundleSelection interface in gateway chat.ts
    - Add optional `depth?: number` field after bundle_type (line 593)
    - Add JSDoc documenting depth parameter usage
  - [x] 1.4 Add depth-related constants to contextBundleTypes.ts
    - Add `DEPTH_OPTIONS: Array<1 | 2>` constant
    - Add `DEPTH_LABELS: Record<number, string>` mapping (1 -> "Depth 1", 2 -> "Depth 2 (Extended)")
    - Add `DEPTH_WARNING` constant for depth 2 warning message
  - [x] 1.5 Ensure type extension tests pass
    - Run ONLY the 3-5 tests written in 1.1
    - Verify TypeScript compilation succeeds
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3-5 tests written in 1.1 pass
- EntityRef interface accepts optional depth field
- EntityBundleSelection interface accepts optional depth field
- TypeScript types enforce 1 | 2 union for frontend depth values
- Backward compatibility maintained when depth is undefined

**Files to modify:**
- `frontend/src/utils/contextStorage.ts` (line 30)
- `frontend/src/utils/contextBundleTypes.ts` (add constants after line 110)
- `gateway/src/types/chat.ts` (line 593)

---

### Heuristics Engine Layer

#### Task Group 2: Heuristic Rule Types and Engine
**Dependencies:** Task Group 1

- [x] 2.0 Complete heuristic rules engine
  - [x] 2.1 Write 4-6 focused tests for heuristic engine
    - Test Suggestion interface shape validation
    - Test computeSuggestions returns empty array when no rules trigger
    - Test rule_interface_needs_schema triggers for interface_only selections
    - Test rule_service_needs_interfaces triggers for service_only selections
    - Test maximum 3 suggestions enforced
  - [x] 2.2 Create new heuristics module file
    - Create `frontend/src/utils/contextHeuristics.ts`
    - Define `Suggestion` interface with id, title, rationale, action, targetEntityId fields
    - Define `SuggestionAction` type: 'upgrade_bundle' | 'add_entity'
    - Export rule identifiers as constants
  - [x] 2.3 Implement rule_interface_needs_schema heuristic
    - Trigger when interface selected with interface_only or interface_with_endpoints
    - Generate suggestion to upgrade to interface_with_endpoints_and_schemas
    - Use rationale: "Including schemas helps the LLM understand the data contracts for this interface's endpoints."
  - [x] 2.4 Implement rule_service_needs_interfaces heuristic
    - Trigger when service selected with service_only bundle_type
    - Check if related interfaces already selected (skip if so)
    - Generate suggestion to upgrade to service_with_parents_and_children
    - Use rationale: "Including parent and child context helps the LLM understand how this service fits in the architecture hierarchy."
  - [x] 2.5 Implement rule_entity_relationships_depth heuristic
    - Trigger when 2+ data entities selected with entity_only bundle_type
    - Generate suggestion to upgrade to entity_with_attributes_and_relationships
    - Use rationale: "Including relationships between these entities helps the LLM understand the data model connections."
  - [x] 2.6 Implement computeSuggestions orchestrator function
    - Accept current selections, bundle selections, and entity option map
    - Run all heuristic rules
    - Deduplicate and limit to maximum 3 suggestions
    - Return array of Suggestion objects
  - [x] 2.7 Ensure heuristic engine tests pass
    - Run ONLY the 4-6 tests written in 2.1
    - Verify all heuristic rules trigger correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 2.1 pass
- Suggestion interface properly defined
- All three bundle upgrade heuristics implemented
- computeSuggestions limits output to 3 suggestions
- Rationale messages match spec exactly

**Files to create/modify:**
- `frontend/src/utils/contextHeuristics.ts` (new file)

---

#### Task Group 3: Diagram Context Heuristic
**Dependencies:** Task Group 2

- [x] 3.0 Complete diagram suggestion heuristic
  - [x] 3.1 Write 3-4 focused tests for diagram heuristic
    - Test rule_diagram_as_context does not trigger with fewer than 3 entity selections
    - Test rule_diagram_as_context finds diagram referencing 50%+ of selected entities
    - Test maximum 1 diagram suggestion enforced
    - Test diagram already selected is not suggested
  - [x] 3.2 Implement rule_diagram_as_context heuristic
    - Trigger when 3+ entities selected from Architecture tab
    - Scan diagramOptions for diagrams referencing 50%+ of selected entities
    - Generate suggestion with action 'add_entity' and diagram_only bundle_type
    - Use rationale: "This diagram references multiple selected entities and may provide useful visual context."
    - Limit to 1 diagram suggestion maximum
  - [x] 3.3 Integrate diagram heuristic into computeSuggestions
    - Add diagramOptions parameter to computeSuggestions function
    - Add selectedDiagramIds parameter to exclude already-selected diagrams
    - Ensure diagram suggestions count toward the 3-suggestion limit
  - [x] 3.4 Ensure diagram heuristic tests pass
    - Run ONLY the 3-4 tests written in 3.1
    - Verify diagram matching logic works correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3-4 tests written in 3.1 pass
- Diagram heuristic triggers only with 3+ entity selections
- 50% overlap threshold correctly calculated
- Only 1 diagram suggestion generated at a time
- Already-selected diagrams excluded from suggestions

**Files to modify:**
- `frontend/src/utils/contextHeuristics.ts`

---

### UI Components Layer

#### Task Group 4: Depth Selector UI Component
**Dependencies:** Task Group 1

- [x] 4.0 Complete depth selector UI
  - [x] 4.1 Write 3-4 focused tests for depth selector
    - Test DepthSelector renders only for entity_with_attributes_and_relationships bundle
    - Test DepthSelector displays warning label for depth 2
    - Test depth change callback invoked with correct value
    - Test depth selector does not render for non-entity bundles
  - [x] 4.2 Create DepthSelector component in ContextPickerModal.tsx
    - Add after BundleSelector component definition (after line 89)
    - Accept props: entityId, currentDepth, onChange
    - Render dropdown with options 1 and 2
    - Display warning text when depth 2 selected
    - Use DEPTH_LABELS and DEPTH_WARNING from contextBundleTypes.ts
  - [x] 4.3 Add CSS styles for depth selector
    - Add .depthSelectContainer style for inline layout with warning
    - Add .depthSelect style following .bundleSelect pattern
    - Add .depthWarning style for warning text (smaller, orange/amber color)
  - [x] 4.4 Integrate DepthSelector into entity option rows
    - Add entityDepthSelections state alongside entityBundleSelections (line 118)
    - Render DepthSelector when bundle is entity_with_attributes_and_relationships
    - Position inline after BundleSelector dropdown
    - Add handleDepthChange callback
  - [x] 4.5 Ensure depth selector tests pass
    - Run ONLY the 3-4 tests written in 4.1
    - Verify depth selector renders conditionally
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3-4 tests written in 4.1 pass
- Depth selector only appears for entity bundle type
- Warning message displays for depth 2
- Depth state tracked separately from bundle state
- Styling consistent with existing bundle selector

**Files to modify:**
- `frontend/src/components/ProductView/ContextPickerModal.tsx`
- `frontend/src/components/ProductView/ContextPickerModal.module.css`

---

#### Task Group 5: Suggestions UI Section
**Dependencies:** Task Groups 2, 3

- [x] 5.0 Complete suggestions UI section
  - [x] 5.1 Write 4-5 focused tests for suggestions UI
    - Test suggestions section renders when suggestions exist
    - Test suggestions section collapses when empty or all dismissed
    - Test Add button applies suggestion action (upgrade bundle or add entity)
    - Test Dismiss button removes suggestion from display
    - Test maximum 3 suggestion cards displayed
  - [x] 5.2 Add CSS styles for suggestions section
    - Add .suggestionsSection container style (collapsible, margin-bottom)
    - Add .suggestionsSectionHeader style with title "Suggested Context"
    - Add .suggestionCard style following .optionRow pattern
    - Add .suggestionTitle and .suggestionRationale styles
    - Add .suggestionActions container for Add/Dismiss buttons
    - Add .addButton and .dismissButton styles
  - [x] 5.3 Create SuggestionCard component
    - Accept props: suggestion, onAdd, onDismiss
    - Render title, rationale, Add button, Dismiss button
    - Use data-testid for each interactive element
  - [x] 5.4 Create SuggestionsSection component
    - Accept props: suggestions, onAddSuggestion, onDismissSuggestion
    - Render section header and list of SuggestionCard components
    - Return null when suggestions array is empty
    - Limit display to 3 cards
  - [x] 5.5 Integrate SuggestionsSection into modal
    - Add after search input container (after line 406)
    - Add dismissedSuggestionIds state for tracking dismissed suggestions
    - Wire up suggestion add/dismiss handlers
    - Filter out dismissed suggestions before display
  - [x] 5.6 Ensure suggestions UI tests pass
    - Run ONLY the 4-5 tests written in 5.1
    - Verify suggestion cards render correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-5 tests written in 5.1 pass
- Suggestions section appears below search input
- Each card displays title, rationale, Add and Dismiss buttons
- Section collapses when empty
- Maximum 3 suggestions visible at once

**Files to modify:**
- `frontend/src/components/ProductView/ContextPickerModal.tsx`
- `frontend/src/components/ProductView/ContextPickerModal.module.css`

---

### Integration Layer

#### Task Group 6: Suggestion Action Handlers
**Dependencies:** Task Groups 4, 5

- [x] 6.0 Complete suggestion action integration
  - [x] 6.1 Write 3-4 focused tests for suggestion actions
    - Test handleAddSuggestion upgrades bundle_type for upgrade_bundle action
    - Test handleAddSuggestion adds diagram to selection for add_entity action
    - Test dismissed suggestions persist through re-renders
    - Test suggestions recalculate when selections change
  - [x] 6.2 Implement handleAddSuggestion callback
    - Check suggestion.action type
    - For 'upgrade_bundle': update entityBundleSelections with new bundle_type
    - For 'add_entity': add entity/diagram to appropriate selection set
    - Remove suggestion from display after action
  - [x] 6.3 Implement handleDismissSuggestion callback
    - Add suggestion.id to dismissedSuggestionIds set
    - Do not persist dismissals across modal open/close (per spec out of scope)
  - [x] 6.4 Wire suggestions computation to selection state
    - Call computeSuggestions in useMemo when selections change
    - Pass selectedEntityIds, entityBundleSelections, entityOptionMap, diagramOptions, selectedDiagramIds
    - Filter out dismissed suggestions before rendering
  - [x] 6.5 Ensure suggestion action tests pass
    - Run ONLY the 3-4 tests written in 6.1
    - Verify suggestion actions update state correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3-4 tests written in 6.1 pass
- Upgrade actions modify bundle_type in selection state
- Add actions add entities/diagrams to selection sets
- Dismissed suggestions hidden until modal reopens
- Suggestions recalculate dynamically on selection changes

**Files to modify:**
- `frontend/src/components/ProductView/ContextPickerModal.tsx`

---

#### Task Group 7: Depth Passthrough to Apply
**Dependencies:** Task Group 6

- [x] 7.0 Complete depth passthrough integration
  - [x] 7.1 Write 2-3 focused tests for depth in Apply flow
    - Test handleApply includes depth in EntityRef when depth !== 1
    - Test handleApply omits depth field when depth is 1 (default)
    - Test depth passed to ArchitectureContext.entities array
  - [x] 7.2 Update handleApply to include depth
    - Modify entityRefs construction (lines 281-293)
    - Include depth from entityDepthSelections when !== 1
    - Omit depth field for default value (backward compatibility)
  - [x] 7.3 Update initialization to restore depth from initialSelected
    - In useEffect (lines 121-161), restore depth values from entity_refs
    - Default to 1 if depth not present in saved ref
  - [x] 7.4 Ensure depth passthrough tests pass
    - Run ONLY the 2-3 tests written in 7.1
    - Verify depth correctly round-trips through Apply
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-3 tests written in 7.1 pass
- Depth value included in EntityRef output when non-default
- Depth value restored when modal reopens with existing selections
- Backward compatibility maintained for refs without depth

**Files to modify:**
- `frontend/src/components/ProductView/ContextPickerModal.tsx`

---

### Testing Layer

#### Task Group 8: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-7

- [x] 8.0 Review existing tests and fill critical gaps only
  - [x] 8.1 Review tests from Task Groups 1-7
    - Review the 3-5 tests written by type extensions (Task 1.1)
    - Review the 4-6 tests written by heuristic engine (Task 2.1)
    - Review the 3-4 tests written by diagram heuristic (Task 3.1)
    - Review the 3-4 tests written by depth selector (Task 4.1)
    - Review the 4-5 tests written by suggestions UI (Task 5.1)
    - Review the 3-4 tests written by suggestion actions (Task 6.1)
    - Review the 2-3 tests written by depth passthrough (Task 7.1)
    - Total existing tests: approximately 22-31 tests
  - [x] 8.2 Analyze test coverage gaps for THIS feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to this spec's feature requirements
    - Do NOT assess entire application test coverage
    - Prioritize end-to-end workflows over unit test gaps
  - [x] 8.3 Write up to 6 additional strategic tests maximum
    - Add maximum of 6 new tests to fill identified critical gaps
    - Focus on integration scenarios:
      - Full workflow: select entity -> see suggestion -> add suggestion -> apply
      - Edge case: all suggestions dismissed leaves section hidden
      - Interaction: changing bundle_type removes/adds related suggestions
      - Depth + bundle: entity with depth 2 and full bundle persists correctly
    - Do NOT write comprehensive coverage for all scenarios
    - Skip edge cases, performance tests, and accessibility tests unless business-critical
  - [x] 8.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature
    - Expected total: approximately 28-37 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 28-37 tests total)
- Critical user workflows for this feature are covered
- No more than 6 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements

**Files to create/modify:**
- `frontend/src/__tests__/contextHeuristics.test.ts` (new file)
- `frontend/src/__tests__/ContextPickerModal.depth-selector.test.tsx` (new file)
- `frontend/src/__tests__/ContextPickerModal.suggestions.test.tsx` (new file)

---

## Execution Order

Recommended implementation sequence:

1. **Types and Contracts Layer (Task Group 1)** - Foundation for depth parameter
2. **Heuristics Engine Layer (Task Groups 2, 3)** - Core suggestion logic
3. **UI Components Layer (Task Groups 4, 5)** - Visual components
4. **Integration Layer (Task Groups 6, 7)** - Wire everything together
5. **Testing Layer (Task Group 8)** - Validate and fill gaps

```
Task Group 1: Type Extensions
         |
         v
Task Group 2: Heuristic Engine -----> Task Group 4: Depth Selector UI
         |                                       |
         v                                       |
Task Group 3: Diagram Heuristic                  |
         |                                       |
         v                                       v
Task Group 5: Suggestions UI <-------------------+
         |
         v
Task Group 6: Suggestion Action Handlers
         |
         v
Task Group 7: Depth Passthrough
         |
         v
Task Group 8: Test Review & Gap Analysis
```

## Summary of Files to Create/Modify

**New Files:**
- `frontend/src/utils/contextHeuristics.ts` - Heuristic rules and suggestion engine
- `frontend/src/__tests__/contextHeuristics.test.ts` - Heuristic tests
- `frontend/src/__tests__/ContextPickerModal.depth-selector.test.tsx` - Depth selector tests
- `frontend/src/__tests__/ContextPickerModal.suggestions.test.tsx` - Suggestions UI tests
- `frontend/src/__tests__/context-picker-depth-types.test.ts` - Depth type extension tests
- `frontend/src/__tests__/context-picker-smart-defaults-integration.test.ts` - Integration tests

**Modified Files:**
- `frontend/src/utils/contextStorage.ts` - Add depth field to EntityRef
- `frontend/src/utils/contextBundleTypes.ts` - Add depth constants and labels
- `frontend/src/components/ProductView/ContextPickerModal.tsx` - Add depth selector, suggestions section, action handlers
- `frontend/src/components/ProductView/ContextPickerModal.module.css` - Add styles for depth selector and suggestions
- `gateway/src/types/chat.ts` - Add depth field to EntityBundleSelection
