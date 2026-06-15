# Task Breakdown: Global Application Point Picker with Derived ApplicationPoints

## Overview
Total Tasks: 8 Task Groups

Enable relationship grids to select any Application Domain entity (Service, Class, or Method) wherever an Application Point is referenced, auto-creating derived ApplicationPoints on-demand when a Service/Class/Method is selected.

## Task List

### Type System Updates

#### Task Group 1: Expand ApplicationPointKind Type
**Dependencies:** None

- [x] 1.0 Complete type system updates
  - [x] 1.1 Write 3 focused tests for ApplicationPointKind expansion
    - Test that ApplicationPointKind type accepts 'CLASS' value
    - Test that ApplicationPointKind type accepts 'METHOD' value
    - Test APPLICATION_POINT_KIND_LABELS includes labels for CLASS and METHOD
  - [x] 1.2 Expand ApplicationPointKind union type in model.ts
    - **File:** `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/types/model.ts`
    - **Line ~343:** Current definition: `export type ApplicationPointKind = 'APPLICATION' | 'APP_COMPONENT' | 'SERVICE';`
    - **Change to:** `export type ApplicationPointKind = 'APPLICATION' | 'APP_COMPONENT' | 'SERVICE' | 'CLASS' | 'METHOD';`
  - [x] 1.3 Add 'application_point_picker' to CellType union
    - **File:** `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/types/config.ts`
    - **Line ~45:** Current definition: `export type CellType = 'text' | 'tags' | 'boolean' | 'dropdown' | 'fk_typeahead' | 'text_with_suggestions';`
    - **Change to:** `export type CellType = 'text' | 'tags' | 'boolean' | 'dropdown' | 'fk_typeahead' | 'text_with_suggestions' | 'application_point_picker';`
  - [x] 1.4 Ensure type system tests pass
    - Run ONLY the 3 tests written in 1.1
    - Verify TypeScript compilation succeeds
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- ApplicationPointKind type includes 'CLASS' and 'METHOD' values
- CellType includes 'application_point_picker' value
- TypeScript compiles without errors
- The 3 tests from 1.1 pass

---

### Derivation Utility

#### Task Group 2: ApplicationPoint Derivation Utility Module
**Dependencies:** Task Group 1

- [x] 2.0 Complete derivation utility module
  - [x] 2.1 Write 6 focused tests for derivation functions
    - Test `findDerivedApplicationPoint` finds existing AP by target_type and target_ref_id
    - Test `findDerivedApplicationPoint` returns undefined when no match
    - Test `deriveApplicationIdForClass` walks ownership chain to find application_id
    - Test `deriveApplicationIdForMethod` gets class_id then derives application_id
    - Test `ensureDerivedApplicationPoint` returns existing AP id if found
    - Test `ensureDerivedApplicationPoint` creates new AP with correct name format
  - [x] 2.2 Create applicationPointDerivation.ts utility module
    - **File:** `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/utils/applicationPointDerivation.ts`
    - Export function `findDerivedApplicationPoint(targetType, targetRefId, applicationPoints)`
    - Export function `deriveApplicationIdForClass(classId, metaModel)` - walk owned_by_ref_kind/owned_by_ref_id chain
    - Export function `deriveApplicationIdForMethod(methodId, metaModel)` - get class_id, then call deriveApplicationIdForClass
    - Export function `ensureDerivedApplicationPoint(targetType, targetRefId, metaModel)` - find or create derived AP
    - Export function `generateDerivedApplicationPointName(targetType, targetRefId, metaModel)` - naming per spec
  - [x] 2.3 Implement naming convention logic
    - For SERVICE: Use `service.name` directly
    - For CLASS: Use `${namespace}.${className}` if namespace exists, otherwise just `className`
    - For METHOD: Use `${className}#${methodName}` format
    - Reference existing name resolution in applicationPointSync.ts pattern
  - [x] 2.4 Implement ID generation for derived APs
    - Pattern: `ap_derived_${targetType.toLowerCase()}_${targetRefId}`
    - Ensures deterministic ID for find-or-create semantics
  - [x] 2.5 Ensure derivation utility tests pass
    - Run ONLY the 6 tests written in 2.1
    - Verify all functions work correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6 tests from 2.1 pass
- All 5 exported functions work correctly
- Naming conventions match spec exactly
- ID generation is deterministic

---

### Picker Component

#### Task Group 3: ApplicationPointPickerCell Component
**Dependencies:** Task Group 2

- [x] 3.0 Complete ApplicationPointPickerCell component
  - [x] 3.1 Write 5 focused tests for picker component
    - Test dropdown shows 4 grouped sections: "Existing Application Points", "Services", "Classes", "Methods"
    - Test group headers are non-selectable with distinct styling
    - Test search filters across all groups simultaneously
    - Test selecting existing AP returns its id directly
    - Test selecting Service/Class/Method invokes derivation and returns derived AP id
  - [x] 3.2 Create ApplicationPointPickerCell.tsx component
    - **File:** `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/components/Grid/ApplicationPointPickerCell.tsx`
    - Follow TypeaheadCell pattern from `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/components/Grid/TypeaheadCell.tsx`
    - Props: `value`, `entity`, `column`, `entityType`, `model`, `onChange`, `onAddEntity`, `error`
    - Add `onAddEntity` callback prop for dispatching ADD_ENTITY when creating derived AP
  - [x] 3.3 Implement grouped dropdown sections
    - Section 1: "Existing Application Points" - from `model.metaModel.entities.application_points`
    - Section 2: "Services" - from `model.metaModel.entities.services`
    - Section 3: "Classes" - from `model.metaModel.entities.classes`
    - Section 4: "Methods" - from `model.metaModel.entities.methods`
    - Group headers: bold text, gray background (#f5f5f5), non-clickable
  - [x] 3.4 Implement search and filtering logic
    - Filter across all 4 groups simultaneously based on searchText
    - Use custom displayFormatter if provided for display text
    - Reuse getDropdownPosition from TypeaheadCell for positioning
  - [x] 3.5 Implement selection handling with derivation
    - If selecting from "Existing Application Points" - call `onChange(selectedAP.id)` directly
    - If selecting Service/Class/Method:
      1. Call `ensureDerivedApplicationPoint(targetType, targetRefId, metaModel)`
      2. If new AP created, call `onAddEntity('application_points', newAP)`
      3. Call `onChange(derivedAPId)`
  - [x] 3.6 Add component styles to Grid.module.css
    - `.pickerGroupHeader` - bold, gray background, non-clickable
    - `.pickerSectionDivider` - subtle divider between groups
    - Reuse existing `.typeaheadDropdown`, `.typeaheadOption` classes
  - [x] 3.7 Ensure picker component tests pass
    - Run ONLY the 5 tests written in 3.1
    - Verify component renders correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 5 tests from 3.1 pass
- Component renders 4 grouped sections correctly
- Search filters across all groups
- Selection creates derived AP when needed and returns correct id

---

### GridCell Integration

#### Task Group 4: GridCell Switch Case Integration
**Dependencies:** Task Group 3

- [x] 4.0 Complete GridCell integration
  - [x] 4.1 Write 2 focused tests for GridCell integration
    - Test GridCell renders ApplicationPointPickerCell when cellType is 'application_point_picker'
    - Test onChange propagates correctly from picker to grid
  - [x] 4.2 Import ApplicationPointPickerCell in GridCell.tsx
    - **File:** `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/components/Grid/GridCell.tsx`
    - Add import: `import { ApplicationPointPickerCell } from './ApplicationPointPickerCell';`
  - [x] 4.3 Add switch case for 'application_point_picker' cellType
    - **Line ~70 (after fk_typeahead case):** Add new case
    - Pass all required props including new `onAddEntity` prop
    - Ensure error handling matches TypeaheadCell pattern
  - [x] 4.4 Update GridCellProps to include onAddEntity callback
    - Add optional prop: `onAddEntity?: (entityType: string, entity: AnyEntity) => void;`
    - Wire this from Grid component to dispatch ADD_ENTITY action
  - [x] 4.5 Ensure GridCell integration tests pass
    - Run ONLY the 2 tests written in 4.1
    - Verify switch case works correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2 tests from 4.1 pass
- GridCell correctly routes to ApplicationPointPickerCell
- onAddEntity callback wired correctly

---

### Grid Configuration

#### Task Group 5: Update Relationship Grid Configurations
**Dependencies:** Task Group 4

- [x] 5.0 Complete grid configuration updates
  - [x] 5.1 Write 4 focused tests for grid configurations
    - Test application_point_business_points grid uses 'application_point_picker' for application_point_id
    - Test application_point_business_logics grid uses 'application_point_picker' for application_point_id
    - Test data_movements grid uses 'application_point_picker' for source_application_point_id
    - Test data_movements grid uses 'application_point_picker' for target_application_point_id
  - [x] 5.2 Update application_point_business_points configuration
    - **File:** `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/config/gridConfigs.ts`
    - **Line ~376:** Change `cellType: 'fk_typeahead'` to `cellType: 'application_point_picker'`
    - Preserve existing `displayFormatter: applicationPointDisplayFormatter`
  - [x] 5.3 Update application_point_business_logics configuration
    - **Line ~448:** Change `cellType: 'fk_typeahead'` to `cellType: 'application_point_picker'`
    - Preserve existing `displayFormatter: applicationPointDisplayFormatter`
  - [x] 5.4 Update data_movements configuration (source)
    - **Line ~433:** Change `cellType: 'fk_typeahead'` to `cellType: 'application_point_picker'`
    - Preserve existing `displayFormatter: applicationPointDisplayFormatter`
  - [x] 5.5 Update data_movements configuration (target)
    - **Line ~434:** Change `cellType: 'fk_typeahead'` to `cellType: 'application_point_picker'`
    - Preserve existing `displayFormatter: applicationPointDisplayFormatter`
  - [x] 5.6 Ensure grid configuration tests pass
    - Run ONLY the 4 tests written in 5.1
    - Verify all configurations updated correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests from 5.1 pass
- All 4 columns use 'application_point_picker' cellType
- Existing displayFormatter preserved on all columns

---

### Display Formatting

#### Task Group 6: Enhance formatApplicationPointDisplay
**Dependencies:** Task Group 1

- [x] 6.0 Complete display formatting enhancements
  - [x] 6.1 Write 4 focused tests for display formatting
    - Test formatApplicationPointDisplay shows CLASS label for kind='CLASS'
    - Test formatApplicationPointDisplay shows METHOD label for kind='METHOD'
    - Test formatApplicationPointDisplay shows target info when target_type/target_ref_id set
    - Test formatApplicationPointDisplay falls back to standard format when no target set
  - [x] 6.2 Update APPLICATION_POINT_KIND_LABELS in formatters.ts
    - **File:** `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/utils/formatters.ts`
    - **Line ~42-46:** Add entries for CLASS and METHOD
    - Add: `'CLASS': 'Class',`
    - Add: `'METHOD': 'Method',`
  - [x] 6.3 Enhance formatApplicationPointDisplay function
    - **Line ~62-65:** Modify function to handle derived APs
    - If `target_type` and `target_ref_id` are set:
      - Format: `"<name> (targets <TargetType>: <ResolvedTargetName>)"`
      - Example: `"OrderService#processOrder (targets METHOD: processOrder)"`
    - If not set, continue with existing format: `"<name> (<kind>)"`
  - [x] 6.4 Add helper function to resolve target entity name
    - Create `resolveTargetEntityName(targetType, targetRefId, metaModel)` function
    - Look up target_ref_id in appropriate entity collection based on target_type
    - Return entity name or fallback to targetRefId if not found
  - [x] 6.5 Ensure display formatting tests pass
    - Run ONLY the 4 tests written in 6.1
    - Verify formatting works correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests from 6.1 pass
- KIND_LABELS includes CLASS and METHOD
- formatApplicationPointDisplay handles derived APs correctly
- Target entity names resolved properly

---

### Backend Validation

#### Task Group 7: ModelService Validation Hardening
**Dependencies:** None (can run in parallel with frontend tasks)

- [x] 7.0 Complete backend validation hardening
  - [x] 7.1 Write 5 focused tests for backend validation
    - Test validation fails when application_id is null/blank for any ApplicationPoint
    - Test validation passes when application_id is set for derived CLASS AP
    - Test validation passes when application_id is set for derived METHOD AP
    - Test validation fails when target_type=CLASS but class doesn't exist
    - Test validation fails when target_type=METHOD but method doesn't exist
  - [x] 7.2 Add application_id required validation
    - **File:** `C:/Workspaces/SSD/architecture-store-and-diagrams/architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
    - **In `validateApplicationPointTargets` method (line ~881):** Add check at start of loop
    - Error format: `"ApplicationPoint validation failed for id '<id>': application_id is required"`
  - [x] 7.3 Enhance CLASS target validation
    - **Line ~923-930:** Existing validation checks classIds.contains(targetRefId)
    - Verify error message format matches spec: `"ApplicationPoint validation failed for id '<id>': target_ref_id '<refId>' does not reference a valid Class entity"`
  - [x] 7.4 Enhance METHOD target validation
    - **Line ~931-938:** Existing validation checks methodIds.contains(targetRefId)
    - Verify error message format matches spec: `"ApplicationPoint validation failed for id '<id>': target_ref_id '<refId>' does not reference a valid Method entity"`
  - [x] 7.5 Ensure backend validation tests pass
    - Run ONLY the 5 tests written in 7.1
    - Verify all validation scenarios work
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 5 tests from 7.1 pass
- application_id validation enforced for all ApplicationPoints
- CLASS and METHOD target validation works correctly
- Error messages match specified format

---

### Testing

#### Task Group 8: Test Review & Gap Analysis
**Dependencies:** Task Groups 1-7

- [x] 8.0 Review existing tests and fill critical gaps only
  - [x] 8.1 Review tests from Task Groups 1-7
    - Review the 3 tests from Task Group 1 (type system)
    - Review the 6 tests from Task Group 2 (derivation utility)
    - Review the 5 tests from Task Group 3 (picker component)
    - Review the 2 tests from Task Group 4 (GridCell integration)
    - Review the 4 tests from Task Group 5 (grid configuration)
    - Review the 4 tests from Task Group 6 (display formatting)
    - Review the 5 tests from Task Group 7 (backend validation)
    - Total existing tests: 29 tests
  - [x] 8.2 Analyze test coverage gaps for THIS feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to Application Point Picker feature
    - Do NOT assess entire application test coverage
    - Prioritize end-to-end workflows over unit test gaps
  - [x] 8.3 Write up to 5 additional strategic tests maximum
    - Add maximum of 5 new tests to fill identified critical gaps
    - Priority integration tests:
      1. E2E: Select Service from picker, verify derived AP created with correct name
      2. E2E: Select Class from picker, verify ownership chain walked for application_id
      3. E2E: Select Method from picker, verify class lookup then ownership chain
      4. E2E: Select same Service twice, verify reuses existing derived AP (idempotency)
      5. Reducer: Verify ADD_ENTITY dispatch from picker creates AP in state
    - Do NOT write comprehensive coverage for all scenarios
    - Skip edge cases unless business-critical
  - [x] 8.4 Run feature-specific tests only
    - Run ONLY tests related to Application Point Picker feature (tests from 1.1-7.1 and 8.3)
    - Expected total: approximately 34 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 34 tests total)
- Critical user workflows for this feature are covered
- No more than 5 additional tests added when filling gaps
- Testing focused exclusively on Application Point Picker feature requirements

---

## Execution Order

Recommended implementation sequence:

```
Phase 1 (Parallel):
  - Task Group 1: Type System Updates
  - Task Group 7: Backend Validation (independent of frontend)

Phase 2 (Sequential after Phase 1):
  - Task Group 2: Derivation Utility (depends on Task Group 1)
  - Task Group 6: Display Formatting (depends on Task Group 1)

Phase 3 (Sequential after Phase 2):
  - Task Group 3: Picker Component (depends on Task Group 2)

Phase 4 (Sequential after Phase 3):
  - Task Group 4: GridCell Integration (depends on Task Group 3)

Phase 5 (Sequential after Phase 4):
  - Task Group 5: Grid Configuration (depends on Task Group 4)

Phase 6 (After all):
  - Task Group 8: Testing (depends on all previous groups)
```

## Key Files Summary

### Files to Create
| File Path | Task Group |
|-----------|------------|
| `frontend/src/utils/applicationPointDerivation.ts` | Task Group 2 |
| `frontend/src/components/Grid/ApplicationPointPickerCell.tsx` | Task Group 3 |

### Files to Modify
| File Path | Line Reference | Task Group |
|-----------|----------------|------------|
| `frontend/src/types/model.ts` | ~343 (ApplicationPointKind) | Task Group 1 |
| `frontend/src/types/config.ts` | ~45 (CellType) | Task Group 1 |
| `frontend/src/components/Grid/GridCell.tsx` | ~70 (switch case) | Task Group 4 |
| `frontend/src/config/gridConfigs.ts` | ~376, ~433-434, ~448 | Task Group 5 |
| `frontend/src/utils/formatters.ts` | ~42-46, ~62-65 | Task Group 6 |
| `architecture-model-service/.../ModelService.java` | ~881-948 | Task Group 7 |
| `frontend/src/components/Grid/Grid.module.css` | (add styles) | Task Group 3 |

### Existing Code to Reference
| File Path | Purpose |
|-----------|---------|
| `frontend/src/components/Grid/TypeaheadCell.tsx` | Pattern for dropdown, positioning, filtering |
| `frontend/src/utils/applicationPointSync.ts` | ID generation pattern, AP creation pattern |
| `frontend/src/utils/formatters.ts` | Display formatter pattern |
