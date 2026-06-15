# Task Breakdown: Process Activity User Interaction Level Update

## Overview
Total Tasks: 7 Task Groups (approximately 35-40 sub-tasks)

This refactoring consolidates two fields (`is_manual` and `user_input_amount`) into a single `user_interaction_level` enum field, with migration support for existing data and automatic diagram colour updates.

## Task List

### Meta-model Layer

#### Task Group 1: Meta-model Schema Layer
**Dependencies:** None

- [x] 1.0 Complete meta-model schema updates
  - [x] 1.1 Write 3-4 focused tests for ProcessActivity type changes
    - Test that ProcessActivity interface includes user_interaction_level field
    - Test that UserInteractionLevel type accepts only valid enum values
    - Test that old fields (is_manual, user_input_amount) are not present
    - Test default value assignment for new ProcessActivity objects
  - [x] 1.2 Define UserInteractionLevel type in model.ts
    - Add type: `"AUTOMATED" | "MINIMAL" | "MODERATE" | "SIGNIFICANT"`
    - Location: `frontend/src/types/model.ts`
  - [x] 1.3 Update ProcessActivity interface
    - Remove `is_manual: boolean` field
    - Remove `user_input_amount: UserInputAmount` field
    - Add `user_interaction_level: UserInteractionLevel` field
    - Location: `frontend/src/types/model.ts`
  - [x] 1.4 Remove UserInputAmount type definition
    - Delete type: `'NA' | 'MINIMAL' | 'MODERATE' | 'SIGNIFICANT'`
    - Location: `frontend/src/types/model.ts` (line 31 area)
  - [x] 1.5 Ensure meta-model schema tests pass
    - Run ONLY the 3-4 tests written in 1.1
    - Verify TypeScript compilation succeeds for model.ts

**Acceptance Criteria:**
- The 3-4 tests written in 1.1 pass
- ProcessActivity interface has user_interaction_level field
- UserInteractionLevel type is correctly defined
- Old fields and types are removed
- TypeScript compiles without errors

---

#### Task Group 2: Defaults Configuration Layer
**Dependencies:** Task Group 1

- [x] 2.0 Complete defaults configuration updates
  - [x] 2.1 Write 3-4 focused tests for defaults configuration
    - Test userInteractionLevelOptions array contains correct values
    - Test processActivityColors mapping returns correct colours for each level
    - Test getProcessActivityDefaultFill returns correct colour based on user_interaction_level
    - Test that old userInputAmountOptions no longer exists
  - [x] 2.2 Add userInteractionLevelOptions array
    - Values: `['AUTOMATED', 'MINIMAL', 'MODERATE', 'SIGNIFICANT']`
    - Location: `frontend/src/config/defaults.ts`
  - [x] 2.3 Remove userInputAmountOptions array
    - Delete existing array from defaults.ts
  - [x] 2.4 Update processActivityColors mapping
    - Change keys from UserInputAmount to UserInteractionLevel
    - AUTOMATED: `#a5d6a7` (medium green)
    - MINIMAL: `#c8e6c9` (light green)
    - MODERATE: `#fff9c4` (light yellow)
    - SIGNIFICANT: `#ffcdd2` (light red)
    - Location: `frontend/src/config/defaults.ts` (lines 303-308 area)
  - [x] 2.5 Update getProcessActivityDefaultFill function
    - Change to read `activity.user_interaction_level` instead of `activity.user_input_amount`
    - Return colour from updated processActivityColors mapping
    - Location: `frontend/src/config/defaults.ts` (lines 317-320 area)
  - [x] 2.6 Ensure defaults configuration tests pass
    - Run ONLY the 3-4 tests written in 2.1
    - Verify colour mappings are correct

**Acceptance Criteria:**
- The 3-4 tests written in 2.1 pass
- userInteractionLevelOptions exports correctly
- processActivityColors uses new enum keys and colour values
- getProcessActivityDefaultFill returns correct colours
- Old userInputAmountOptions is removed

---

### Data Migration Layer

#### Task Group 3: Migration Layer
**Dependencies:** Task Group 1

- [x] 3.0 Complete migration logic implementation
  - [x] 3.1 Write 4-5 focused tests for migration scenarios
    - Test migration: is_manual=false (any user_input_amount) -> AUTOMATED
    - Test migration: is_manual=true + user_input_amount="MINIMAL" -> MINIMAL
    - Test migration: is_manual=true + user_input_amount="MODERATE" -> MODERATE
    - Test migration: is_manual=true + user_input_amount="SIGNIFICANT" -> SIGNIFICANT
    - Test default fallback when neither pattern matches -> AUTOMATED
  - [x] 3.2 Add migration logic to buildModelFromData function
    - Location: `frontend/src/utils/fileOperations.ts` (lines 110-144 area)
    - Check for presence of old fields in loaded process_activity data
    - Apply migration mapping:
      - `is_manual === false` (any user_input_amount) -> `"AUTOMATED"`
      - `is_manual === true` AND `user_input_amount === "MINIMAL"` -> `"MINIMAL"`
      - `is_manual === true` AND `user_input_amount === "MODERATE"` -> `"MODERATE"`
      - `is_manual === true` AND `user_input_amount === "SIGNIFICANT"` -> `"SIGNIFICANT"`
      - Default fallback: `"AUTOMATED"`
  - [x] 3.3 Ensure old fields not persisted on save
    - Verify save logic only writes user_interaction_level
    - Old fields (is_manual, user_input_amount) must NOT appear in saved JSON
  - [x] 3.4 Handle edge cases in migration
    - Missing both old fields -> default to AUTOMATED
    - is_manual=true but user_input_amount="NA" -> default to AUTOMATED
    - Already has user_interaction_level (new format) -> use existing value
  - [x] 3.5 Ensure migration tests pass
    - Run ONLY the 4-5 tests written in 3.1
    - Verify all migration scenarios work correctly

**Acceptance Criteria:**
- The 4-5 tests written in 3.1 pass
- Old JSON files load correctly with migrated values
- Save produces clean JSON with only user_interaction_level
- Edge cases handled gracefully
- No data loss during migration

---

### UI Configuration Layer

#### Task Group 4: Grid Configuration Layer
**Dependencies:** Task Groups 1, 2

- [x] 4.0 Complete grid configuration updates
  - [x] 4.1 Write 3-4 focused tests for grid configuration
    - Test that process_activities grid config has "User Interaction Level" column
    - Test dropdown options are Automated, Minimal, Moderate, Significant
    - Test that "Is Manual" column does not exist
    - Test that "User Input Amount" column does not exist
  - [x] 4.2 Remove "Is Manual" column from process_activities config
    - Remove column with field: `is_manual`, cellType: `boolean`
    - Location: `frontend/src/config/gridConfigs.ts` (lines 31-43 area)
  - [x] 4.3 Remove "User Input Amount" column from process_activities config
    - Remove column with field: `user_input_amount`, cellType: `dropdown`
  - [x] 4.4 Add "User Interaction Level" column
    - Header: "User Interaction Level"
    - Field: `user_interaction_level`
    - Cell type: `dropdown`
    - Options source: `userInteractionLevelOptions` from defaults.ts
    - Display labels: Automated, Minimal, Moderate, Significant
    - Required: true
  - [x] 4.5 Remove conditional disable logic
    - Delete any logic that conditionally enabled/disabled user_input_amount based on is_manual
  - [x] 4.6 Ensure grid configuration tests pass
    - Run ONLY the 3-4 tests written in 4.1
    - Verify grid renders with correct column

**Acceptance Criteria:**
- The 3-4 tests written in 4.1 pass
- Single "User Interaction Level" dropdown column displayed
- Old columns removed from configuration
- Dropdown shows all four options
- No conditional enable/disable logic remains

---

### Validation Layer

#### Task Group 5: Validation Layer
**Dependencies:** Task Groups 1, 4

- [x] 5.0 Complete validation updates
  - [x] 5.1 Write 3-4 focused tests for validation changes
    - Test that user_interaction_level is validated as required field
    - Test that validation does not reference is_manual or user_input_amount
    - Test error message format for missing user_interaction_level
    - Test that old constraint validation function is removed
  - [x] 5.2 Remove validateProcessActivityConstraints function
    - Delete function from validation.ts
    - Location: `frontend/src/utils/validation.ts`
  - [x] 5.3 Remove formatProcessActivityConstraintErrorMessage function
    - Delete error message formatter for old constraint
  - [x] 5.4 Remove call to validateProcessActivityConstraints in validateModel
    - Update validateModel function to not call removed function
  - [x] 5.5 Ensure user_interaction_level validation works
    - Required field validation via grid config `required: true`
    - Error message format: `PROCESS_ACTIVITY ['Activity Name'] requires a value in field 'user_interaction_level'.`
  - [x] 5.6 Ensure validation tests pass
    - Run ONLY the 3-4 tests written in 5.1
    - Verify validation works correctly

**Acceptance Criteria:**
- The 3-4 tests written in 5.1 pass
- Old validation functions removed
- Required field validation works for user_interaction_level
- Error messages are clear and correct
- No references to old fields in validation code

---

### Clean-up Layer

#### Task Group 6: Clean-up Layer
**Dependencies:** Task Groups 1-5

- [x] 6.0 Complete codebase clean-up
  - [x] 6.1 Search codebase for remaining is_manual references
    - Search in: `frontend/src/`
    - Remove or update any found references
    - Expected files: types, components, utils, tests
  - [x] 6.2 Search codebase for remaining user_input_amount references
    - Search in: `frontend/src/`
    - Remove or update any found references
  - [x] 6.3 Search codebase for remaining UserInputAmount type references
    - Search in: `frontend/src/`
    - Remove or update any found references
  - [x] 6.4 Update any existing tests that use old fields
    - Modify test data to use user_interaction_level
    - Remove tests that specifically test old field behaviour
  - [x] 6.5 Verify TypeScript compilation
    - Run `npx tsc --noEmit` in frontend directory
    - Fix any type errors found
  - [x] 6.6 Write verification tests
    - Test that no runtime references to old fields exist
    - Test that codebase is clean of deprecated patterns

**Acceptance Criteria:**
- No references to is_manual, user_input_amount, or UserInputAmount remain
- All existing tests updated to use new field
- TypeScript compiles without errors
- Codebase is clean and consistent

---

### Integration Testing Layer

#### Task Group 7: Integration Testing
**Dependencies:** Task Groups 1-6

- [x] 7.0 Complete integration testing
  - [x] 7.1 Review all tests from Task Groups 1-6
    - Review 3-4 tests from meta-model schema (Task 1.1)
    - Review 3-4 tests from defaults configuration (Task 2.1)
    - Review 4-5 tests from migration (Task 3.1)
    - Review 3-4 tests from grid configuration (Task 4.1)
    - Review 3-4 tests from validation (Task 5.1)
    - Total existing tests: approximately 16-21 tests
  - [x] 7.2 Write integration tests (up to 8 additional tests)
    - Test full migration: load old format JSON, verify user_interaction_level set correctly
    - Test grid editing: change user_interaction_level in grid, verify model updates
    - Test diagram colour: verify diagram node uses correct colour for each level
    - Test live update: change level in grid, verify diagram colour updates without refresh
    - Test new row defaults: create new process_activity, verify defaults to AUTOMATED
    - Test save/load round-trip: save model, reload, verify user_interaction_level persisted
    - Test old fields not saved: save migrated model, verify is_manual/user_input_amount not in JSON
    - Test all four colour values: AUTOMATED=#a5d6a7, MINIMAL=#c8e6c9, MODERATE=#fff9c4, SIGNIFICANT=#ffcdd2
  - [x] 7.3 Run TypeScript compilation check
    - Command: `npx tsc --noEmit`
    - Verify no type errors
  - [x] 7.4 Run feature-specific tests only
    - Run all tests from Task Groups 1-6 plus integration tests from 7.2
    - Expected total: approximately 24-29 tests
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 24-29 tests total)
- Full migration workflow verified
- Grid editing updates model correctly
- Diagram colours update live when level changes
- New rows default to AUTOMATED
- TypeScript compiles without errors
- No more than 8 additional integration tests added

---

## Execution Order

Recommended implementation sequence:

1. **Meta-model Schema Layer (Task Group 1)** - Foundation types must be defined first
2. **Defaults Configuration Layer (Task Group 2)** - Colours and options depend on new types
3. **Migration Layer (Task Group 3)** - Can run in parallel with Task Group 2; depends only on Task Group 1
4. **Grid Configuration Layer (Task Group 4)** - Depends on Task Groups 1 and 2
5. **Validation Layer (Task Group 5)** - Depends on Task Groups 1 and 4
6. **Clean-up Layer (Task Group 6)** - Must run after all feature implementation
7. **Integration Testing (Task Group 7)** - Final verification after all changes complete

## Key Technical Details

### Field Mapping Reference

| Old Fields | New Value |
|------------|-----------|
| `is_manual=false` (any user_input_amount) | `"AUTOMATED"` |
| `is_manual=true` + `user_input_amount="MINIMAL"` | `"MINIMAL"` |
| `is_manual=true` + `user_input_amount="MODERATE"` | `"MODERATE"` |
| `is_manual=true` + `user_input_amount="SIGNIFICANT"` | `"SIGNIFICANT"` |
| Default/fallback | `"AUTOMATED"` |

### Colour Mapping Reference

| UserInteractionLevel | Hex Colour | Description |
|---------------------|------------|-------------|
| `AUTOMATED` | `#a5d6a7` | Medium green |
| `MINIMAL` | `#c8e6c9` | Light green |
| `MODERATE` | `#fff9c4` | Light yellow |
| `SIGNIFICANT` | `#ffcdd2` | Light red |

### Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/types/model.ts` | Add UserInteractionLevel type, update ProcessActivity interface, remove old types |
| `frontend/src/config/defaults.ts` | Update options array, colours mapping, getProcessActivityDefaultFill |
| `frontend/src/utils/fileOperations.ts` | Add migration logic in buildModelFromData |
| `frontend/src/config/gridConfigs.ts` | Update process_activities grid columns |
| `frontend/src/utils/validation.ts` | Remove old validation functions and references |

### Live Update Mechanism

- Diagram renderer reads from shared ArchitectureContext
- Grid updates trigger context state change
- React re-render propagates to diagram components
- Diagram re-renders with new colours via getProcessActivityDefaultFill
- No manual refresh required

## Implementation Notes

All 7 task groups have been completed. The following files were modified:

1. **frontend/src/types/model.ts** - Added UserInteractionLevel type, updated ProcessActivity interface to use user_interaction_level, removed is_manual and user_input_amount fields, removed UserInputAmount type

2. **frontend/src/config/defaults.ts** - Added userInteractionLevelOptions array, updated processActivityColors mapping with new colour values, updated getProcessActivityDefaultFill to use user_interaction_level, removed userInputAmountOptions

3. **frontend/src/utils/fileOperations.ts** - Added migrateProcessActivity and migrateProcessActivities functions in buildModelFromData to handle migration from old format to new format

4. **frontend/src/config/gridConfigs.ts** - Removed "Is Manual" and "User Input Amount" columns, added "User Interaction Level" dropdown column with correct options

5. **frontend/src/utils/validation.ts** - Removed validateProcessActivityConstraints and formatProcessActivityConstraintErrorMessage functions, validation now uses required field validation via grid config

6. **frontend/src/utils/rendering.ts** - Updated comments to reference user_interaction_level instead of old fields

7. **frontend/src/__tests__/process-activities.test.ts** - Updated existing tests to use new field and types

8. **frontend/src/__tests__/user-interaction-level.test.ts** - Added new comprehensive test file covering all task groups

TypeScript compilation passes with no errors.
