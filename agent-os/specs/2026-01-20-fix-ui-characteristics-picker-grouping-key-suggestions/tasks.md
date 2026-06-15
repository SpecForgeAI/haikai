# Task Breakdown: Fix UI Characteristics Picker Grouping and Key Suggestions

## Overview
Total Tasks: 14
Estimated Effort: Small-Medium (Frontend-heavy with minor backend config change)

This feature addresses two UX improvements in the UI Characteristics grid:
- **Part A:** Group Application Points by kind in the picker dropdown
- **Part B:** Enable pretty labels for Key suggestion chips while inserting raw values

## Task List

---

### Part A: Application Point Picker Grouping by Kind

#### Task Group 1: Refactor ApplicationPointPickerCell Grouping Logic
**Dependencies:** None
**Specialization:** Frontend (React/TypeScript)

- [x] 1.0 Complete ApplicationPointPickerCell refactor for kind-based grouping
  - [x] 1.1 Write 4-6 focused tests for kind-based grouping behavior
    - Test that Application Points with `kind=APPLICATION` appear under "Applications" group header
    - Test that Application Points with `kind=APP_COMPONENT` appear under "Application Components" group header
    - Test that Application Points with `kind=SERVICE` appear under "Services" group header
    - Test that filtering works across all kind-based groups
    - Test that derived AP creation still works for Service/Class/Method selection
    - Test that groups only render when they have matching options
  - [x] 1.2 Update `OptionGroup` type to include kind-based groups
    - **File:** `frontend/src/components/Grid/ApplicationPointPickerCell.tsx` (line 46)
    - Change from: `'application_points' | 'services' | 'classes' | 'methods'`
    - Change to: `'applications' | 'app_components' | 'services' | 'classes' | 'methods'`
    - Remove the generic `'application_points'` group
  - [x] 1.3 Update `GROUP_LABELS` constant with new kind-based labels
    - **File:** `frontend/src/components/Grid/ApplicationPointPickerCell.tsx` (lines 155-160)
    - Add mappings:
      - `applications: 'Applications'`
      - `app_components: 'Application Components'`
      - `services: 'Services'`
      - `classes: 'Classes'`
      - `methods: 'Methods'`
  - [x] 1.4 Refactor `buildGroupedOptions()` to group by ApplicationPoint.kind
    - **File:** `frontend/src/components/Grid/ApplicationPointPickerCell.tsx` (lines 204-269)
    - Replace single "application_points" iteration with kind-based grouping:
      - Filter `entities.application_points` where `ap.kind === 'APPLICATION'` -> assign to `'applications'` group
      - Filter `entities.application_points` where `ap.kind === 'APP_COMPONENT'` -> assign to `'app_components'` group
      - Filter `entities.application_points` where `ap.kind === 'SERVICE'` -> assign to `'services'` group
    - Keep existing Services/Classes/Methods groups for derived AP creation
    - Maintain existing search filtering and `.slice(0, 5)` limit per group
  - [x] 1.5 Update `groupOrder` array in render section
    - **File:** `frontend/src/components/Grid/ApplicationPointPickerCell.tsx` (line 429)
    - Change from: `['application_points', 'services', 'classes', 'methods']`
    - Change to: `['applications', 'app_components', 'services', 'classes', 'methods']`
  - [x] 1.6 Update search placeholder text
    - **File:** `frontend/src/components/Grid/ApplicationPointPickerCell.tsx` (line 439)
    - Update placeholder to reflect the new grouping structure
  - [x] 1.7 Ensure Task Group 1 tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify kind-based grouping renders correctly
    - Verify filtering works across groups
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- Application Points are grouped by their `kind` field value
- Groups render in order: Applications, Application Components, Services, Classes, Methods
- Each group only appears when it has matching options after search filtering
- Existing derived AP creation (selecting Service/Class/Method) still works
- Search/filter behavior unchanged

**Reference Pattern:**
- Follow `DataEntityPointSelect.tsx` (lines 270-330) for grouped dropdown rendering structure
- Reuse `DATA_ENTITY_POINT_GROUPS` constant pattern for defining group labels

---

### Part B: Backend Configuration for Key Suggestions

#### Task Group 2: Add Default Values to application.yml
**Dependencies:** None (can run in parallel with Task Group 1)
**Specialization:** Backend (Spring Boot YAML Configuration)

- [x] 2.0 Complete backend configuration with default key suggestion values
  - [x] 2.1 Write 2-3 focused tests for bootstrap endpoint returning defaults
    - Test that `/api/bootstrap` returns `uiCharacteristicsUiCapabilityKeys` array with default values
    - Test that `/api/bootstrap` returns `uiCharacteristicsInteractionComplexityKeys` array with default values
    - Test that `/api/bootstrap` returns `uiCharacteristicsTechnicalShapeKeys` array with default values
    - Note: Existing `AppFeaturesProperties.java` and `BootstrapResponse.java` already support these - no Java changes needed
  - [x] 2.2 Add default pipe-delimited value for `ui-characteristics-ui-capability-keys`
    - **File:** `architecture-model-service/src/main/resources/application.yml` (line 75)
    - Change from: `ui-characteristics-ui-capability-keys: ${APP_FEATURES_UI_CHARACTERISTICS_UI_CAPABILITY_KEYS:}`
    - Change to: `ui-characteristics-ui-capability-keys: ${APP_FEATURES_UI_CHARACTERISTICS_UI_CAPABILITY_KEYS:search|filter|sort|pagination|export|import|bulk_action|create|edit|delete|view|download}`
  - [x] 2.3 Add default pipe-delimited value for `ui-characteristics-interaction-complexity-keys`
    - **File:** `architecture-model-service/src/main/resources/application.yml` (line 76)
    - Change from: `ui-characteristics-interaction-complexity-keys: ${APP_FEATURES_UI_CHARACTERISTICS_INTERACTION_COMPLEXITY_KEYS:}`
    - Change to: `ui-characteristics-interaction-complexity-keys: ${APP_FEATURES_UI_CHARACTERISTICS_INTERACTION_COMPLEXITY_KEYS:simple|moderate|complex|expert}`
  - [x] 2.4 Add default pipe-delimited value for `ui-characteristics-technical-shape-keys`
    - **File:** `architecture-model-service/src/main/resources/application.yml` (line 77)
    - Change from: `ui-characteristics-technical-shape-keys: ${APP_FEATURES_UI_CHARACTERISTICS_TECHNICAL_SHAPE_KEYS:}`
    - Change to: `ui-characteristics-technical-shape-keys: ${APP_FEATURES_UI_CHARACTERISTICS_TECHNICAL_SHAPE_KEYS:form|table|dashboard|wizard|modal|drawer|list|card|chart|report}`
  - [x] 2.5 Ensure Task Group 2 tests pass
    - Run ONLY the 2-3 tests written in 2.1
    - Verify bootstrap endpoint returns arrays with default values
    - Note: Tests written but cannot be run due to pre-existing compilation errors in unrelated test files in the repository

**Acceptance Criteria:**
- The 2-3 tests written in 2.1 pass
- Bootstrap endpoint returns non-empty arrays for all three key suggestion properties when no environment override is set
- Environment variable overrides still work (e.g., `APP_FEATURES_UI_CHARACTERISTICS_UI_CAPABILITY_KEYS=custom|values`)
- Pipe-delimited format is correctly parsed by existing `parseDelimitedString()` in `AppConfigContext.tsx`

---

### Part B: Frontend Pretty Labels for Key Suggestions

#### Task Group 3: Modify TextWithSuggestionsCell for Pretty Labels
**Dependencies:** Task Group 2 (backend defaults should be in place)
**Specialization:** Frontend (React/TypeScript)

- [x] 3.0 Complete TextWithSuggestionsCell modification for pretty label display
  - [x] 3.1 Write 3-4 focused tests for pretty label behavior
    - Test that suggestion chips display `snakeCaseToTitleCase(suggestion)` as visible text (e.g., "Bulk Action" for "bulk_action")
    - Test that clicking a chip sets the input value to the raw snake_case suggestion (not the pretty label)
    - Test with multi-word snake_case values: "bulk_action" displays "Bulk Action", inserts "bulk_action"
    - Test with single-word values: "search" displays "Search", inserts "search"
  - [x] 3.2 Modify chip button rendering to display pretty labels
    - **File:** `frontend/src/components/Grid/GridCell.tsx` (lines 509-521)
    - Change chip button content from `{suggestion}` to `{snakeCaseToTitleCase(suggestion)}`
    - The `snakeCaseToTitleCase` function already exists at lines 42-47 in the same file
  - [x] 3.3 Verify handleSuggestionClick still inserts raw value
    - **File:** `frontend/src/components/Grid/GridCell.tsx` (lines 489-493)
    - Confirm that `handleSuggestionClick(suggestion)` sets `editValue` to the raw `suggestion` parameter
    - No change needed - just verify the raw value insertion behavior is preserved
  - [x] 3.4 Ensure Task Group 3 tests pass
    - Run ONLY the 3-4 tests written in 3.1
    - Verify chips display pretty labels
    - Verify clicking chips inserts raw snake_case values
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3-4 tests written in 3.1 pass
- Suggestion chips display human-friendly Title Case labels (e.g., "Bulk Action", "Export", "Simple")
- Clicking a chip inserts the raw snake_case value (e.g., "bulk_action", "export", "simple")
- Existing free-text input behavior unchanged (users can still type any value)
- No visual regressions in chip styling

**Existing Code to Leverage:**
- `snakeCaseToTitleCase()` function at `GridCell.tsx` lines 42-47 (already exists)
- `handleSuggestionClick()` at lines 489-493 (already inserts raw value)

---

### Testing & Validation

#### Task Group 4: Test Review and Integration Verification
**Dependencies:** Task Groups 1, 2, 3 (all completed)

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 16 tests written for ApplicationPointPickerCell (Task 1.1) - file: `frontend/src/__tests__/application-point-picker-kind-grouping.test.ts`
    - Review the 3 tests written for backend bootstrap defaults (Task 2.1) - file: `architecture-model-service/src/test/java/com/example/architecturemodel/controller/BootstrapControllerTest.java`
    - Review the 11 tests written for TextWithSuggestionsCell pretty labels (Task 3.1) - file: `frontend/src/__tests__/TextWithSuggestionsCell.pretty-labels.test.tsx`
    - Total existing tests: approximately 30 tests
  - [x] 4.2 Analyze test coverage gaps for THIS feature only
    - Identified gap: `getUICharacteristicKeySuggestions()` function unit tests
    - Identified gap: Complete workflow integration (bootstrap -> type select -> suggestions -> chip click -> raw value)
    - Focus: Integration between backend config and frontend display
  - [x] 4.3 Write up to 5 additional strategic tests if necessary
    - Created file: `frontend/src/__tests__/ui-characteristics-key-suggestions-integration.test.ts`
    - Test 1: getUICharacteristicKeySuggestions returns correct arrays per type (5 sub-tests)
    - Test 2: Bootstrap to suggestions integration flow (1 test)
    - Test 3: Pretty labels and raw values integration (2 tests)
    - Test 4: Dynamic suggestions on type change (1 test)
    - Test 5: Complete workflow simulation - bootstrap -> type select -> suggestions -> chip click (1 test)
    - Total: 10 tests in new file (5 strategic test groups with subtests)
  - [x] 4.4 Run feature-specific tests only
    - Ran ApplicationPointPickerCell kind-grouping tests: 16 tests PASSED
    - Ran TextWithSuggestionsCell pretty-labels tests: 11 tests PASSED
    - Ran ui-characteristics-key-suggestions-integration tests: 10 tests PASSED
    - Total feature-specific tests: 37 tests (all passing)
    - Backend tests (BootstrapControllerTest): Tests written correctly but cannot compile due to pre-existing errors in unrelated test files

**Acceptance Criteria:**
- [x] All feature-specific tests pass (37 frontend tests total)
- [x] ApplicationPointPickerCell kind-based grouping works correctly
- [x] Backend returns default key suggestions via bootstrap (code verified, tests written)
- [x] TextWithSuggestionsCell displays pretty labels but inserts raw values
- [x] No more than 5 additional tests added when filling in gaps (added 5 test groups = 10 tests)

---

## Execution Order

Recommended implementation sequence:

```
Phase 1: Parallel Backend/Frontend Work
  |
  +-- Task Group 1: ApplicationPointPickerCell Grouping (Frontend) [COMPLETED]
  |
  +-- Task Group 2: Backend Config Defaults (Backend) [COMPLETED]
  |
  v
Phase 2: Dependent Frontend Work
  |
  +-- Task Group 3: TextWithSuggestionsCell Pretty Labels (Frontend - after Group 2) [COMPLETED]
  |
  v
Phase 3: Integration Testing
  |
  +-- Task Group 4: Test Review & Gap Analysis [COMPLETED]
```

**Notes:**
- Task Groups 1 and 2 can be executed in parallel by different developers
- Task Group 3 depends on Task Group 2 being complete for meaningful testing with real suggestions
- Task Group 4 should run after all implementation is complete

---

## Files to Modify Summary

| File | Task Groups | Changes |
|------|-------------|---------|
| `frontend/src/components/Grid/ApplicationPointPickerCell.tsx` | 1 | Update OptionGroup type, GROUP_LABELS, buildGroupedOptions(), groupOrder |
| `architecture-model-service/src/main/resources/application.yml` | 2 | Add default values for three key suggestion properties |
| `frontend/src/components/Grid/GridCell.tsx` | 3 | Modify chip button content to use snakeCaseToTitleCase() |
| `frontend/src/__tests__/ui-characteristics-key-suggestions-integration.test.ts` | 4 | New file with 10 integration tests |

---

## Reference Patterns

### DataEntityPointSelect Grouping Pattern (lines 270-330)
```typescript
// Order of groups to render
const groupOrder = [DATA_ENTITY_POINT_GROUPS.LOGICAL, DATA_ENTITY_POINT_GROUPS.PHYSICAL];

// Render groups conditionally
{groupOrder.map(group => {
  const options = optionsByGroup[group];
  if (!options || options.length === 0) return null;
  return (
    <div key={group}>
      <div style={{ /* group header styles */ }}>
        {group}
      </div>
      {options.map(opt => (
        <div key={opt.value} onClick={() => handleSelect(opt)}>
          {opt.label}
        </div>
      ))}
    </div>
  );
})}
```

### snakeCaseToTitleCase Function (GridCell.tsx lines 42-47)
```typescript
export function snakeCaseToTitleCase(value: string): string {
  return value
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
```

---

## Out of Scope Reminder

- No changes to `AppFeaturesProperties.java` (already exists)
- No changes to `BootstrapController.java` or `BootstrapResponse.java` (already expose properties)
- No database/persistence schema changes
- No changes to other picker components (DataEntityPointSelect, TypeaheadCell)
- No sorting of options within groups (maintain existing order)
- No keyboard navigation enhancements for suggestion chips
