# Task Breakdown: Process Activity Frequency Attribute

## Overview
Total Tasks: 18

This feature adds a new optional `frequency` enum attribute to Process Activities with 9 possible values, displayed as an editable dropdown column in the Activity table positioned between Description and Sequence Order.

## Task List

### Type Definitions Layer

#### Task Group 1: TypeScript Type Definitions
**Dependencies:** None

- [x] 1.0 Complete type definitions layer
  - [x] 1.1 Write 3 focused tests for ProcessActivityFrequency type
    - Test that ProcessActivityFrequency type accepts all 9 valid enum values
    - Test that ProcessActivity interface accepts optional frequency field
    - Test type compatibility with existing ProcessActivity usage patterns
  - [x] 1.2 Define ProcessActivityFrequency type alias in model.ts
    - Add type alias as string literal union after line 32 (following UserInteractionLevel pattern)
    - Include all 9 values: CONTINUOUSLY, DAILY, WEEKLY, MONTHLY, QUARTERLY, SEMI-ANNUALLY, ANNUALLY, ADHOC, OTHER
    - Follow existing pattern from ActorHint (lines 20-28) and UserInteractionLevel (line 32)
    - Add descriptive comment block explaining the type purpose
  - [x] 1.3 Add frequency field to ProcessActivity interface
    - Add `frequency?: ProcessActivityFrequency` to ProcessActivity interface (lines 47-59)
    - Position field logically after `sequence_order` (line 52)
    - Field is optional with no default value
  - [x] 1.4 Ensure type definition tests pass
    - Run ONLY the 3 tests written in 1.1
    - Verify TypeScript compilation succeeds
    - Verify no type errors in dependent files

**Acceptance Criteria:**
- The 3 tests written in 1.1 pass
- ProcessActivityFrequency type is exported from model.ts
- ProcessActivity interface includes optional frequency field
- No TypeScript compilation errors

**Files modified:**
- `frontend/src/types/model.ts` - Add type alias and update interface

**Reference patterns:**
```typescript
// Existing pattern (lines 20-32 of model.ts):
export type ActorHint =
  | 'END_USER'
  | 'EXTERNAL_USER'
  | 'INTERNAL_SYSTEM'
  | 'EXTERNAL_SYSTEM'
  | 'HYBRID_USER_SYSTEM'
  | 'BATCH_JOB'
  | 'BOT_OR_RPA'
  | 'OTHER';

export type UserInteractionLevel = 'AUTOMATED' | 'MINIMAL' | 'MODERATE' | 'SIGNIFICANT';
```

---

### Configuration Layer

#### Task Group 2: Dropdown Options and Grid Configuration
**Dependencies:** Task Group 1

- [x] 2.0 Complete configuration layer
  - [x] 2.1 Write 4 focused tests for configuration
    - Test processActivityFrequencyOptions array contains all 9 enum values
    - Test processActivityFrequencyOptions array order matches spec
    - Test process_activities grid config includes frequency column
    - Test frequency column is at correct index position (index 4, between description and sequence_order)
  - [x] 2.2 Create processActivityFrequencyOptions array in defaults.ts
    - Add typed array after line 344 (following userInteractionLevelOptions pattern)
    - Export array with all 9 ProcessActivityFrequency values
    - Maintain order: CONTINUOUSLY, DAILY, WEEKLY, MONTHLY, QUARTERLY, SEMI-ANNUALLY, ANNUALLY, ADHOC, OTHER
    - Import ProcessActivityFrequency type from model.ts
  - [x] 2.3 Add frequency column to process_activities grid config
    - Update import in gridConfigs.ts to include processActivityFrequencyOptions
    - Insert column config at index 4 (between description at index 3 and sequence_order at index 4)
    - Column config: `{ field: 'frequency', displayName: 'Frequency', cellType: 'dropdown', required: false, width: 120, options: processActivityFrequencyOptions }`
    - Follow existing dropdown column pattern from actor_hint and user_interaction_level
  - [x] 2.4 Ensure configuration tests pass
    - Run ONLY the 4 tests written in 2.1
    - Verify options array exports correctly
    - Verify grid config compiles without errors

**Acceptance Criteria:**
- The 4 tests written in 2.1 pass
- processActivityFrequencyOptions array is exported from defaults.ts
- Grid config shows frequency column between description and sequence_order
- Column uses dropdown cellType with correct options

**Files modified:**
- `frontend/src/config/defaults.ts` - Add processActivityFrequencyOptions array (after line 344)
- `frontend/src/config/gridConfigs.ts` - Add frequency column to process_activities config (line 37 area)

**Reference patterns:**
```typescript
// Existing pattern (lines 328-344 of defaults.ts):
export const actorHintOptions: ActorHint[] = [
  'END_USER',
  'EXTERNAL_USER',
  // ...
];

export const userInteractionLevelOptions: UserInteractionLevel[] = [
  'AUTOMATED',
  'MINIMAL',
  'MODERATE',
  'SIGNIFICANT',
];
```

```typescript
// Existing grid column pattern (lines 38-39 of gridConfigs.ts):
{ field: 'actor_hint', displayName: 'Actor Hint', cellType: 'dropdown', required: true, width: 140, options: actorHintOptions },
{ field: 'user_interaction_level', displayName: 'User Interaction Level', cellType: 'dropdown', required: true, width: 160, options: userInteractionLevelOptions },
```

---

### Data Persistence Layer

#### Task Group 3: JSON Loading and Migration
**Dependencies:** Task Group 1

- [x] 3.0 Complete data persistence layer
  - [x] 3.1 Write 4 focused tests for JSON loading
    - Test loading JSON with frequency field preserves the value
    - Test loading JSON without frequency field results in undefined (backward compatibility)
    - Test loading JSON with valid frequency enum value passes through correctly
    - Test migrateProcessActivity function returns object with frequency property
  - [x] 3.2 Update migrateProcessActivity function in fileOperations.ts
    - Add frequency field to the returned object in both code paths (lines 132-143 and 171-182)
    - Cast value: `frequency: rawActivity.frequency as ProcessActivityFrequency | undefined`
    - Import ProcessActivityFrequency type from model.ts
    - No migration logic needed - simple pass-through of existing value
  - [x] 3.3 Verify JSON serialization works automatically
    - Confirm serializeModel function handles frequency field via standard JSON.stringify
    - When frequency is undefined, field is omitted from JSON output
    - When frequency is set, value is saved as string
    - No code changes required - verify existing behavior
  - [x] 3.4 Ensure data persistence tests pass
    - Run ONLY the 4 tests written in 3.1
    - Verify backward compatibility with JSON files lacking frequency field
    - Verify round-trip: load -> edit -> save -> reload preserves frequency

**Acceptance Criteria:**
- The 4 tests written in 3.1 pass
- Loading old JSON without frequency field works without errors
- Loading new JSON with frequency field preserves the value
- Saving includes frequency when set, omits when undefined

**Files modified:**
- `frontend/src/utils/fileOperations.ts` - Update migrateProcessActivity function (lines 127-183)

**Reference patterns:**
```typescript
// Existing field pass-through pattern (lines 141-142 of fileOperations.ts):
valid_from: rawActivity.valid_from as string | undefined,
valid_to: rawActivity.valid_to as string | undefined,
```

---

### Testing and Verification

#### Task Group 4: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 3 type definition tests from Task 1.1
    - Review the 4 configuration tests from Task 2.1
    - Review the 4 data persistence tests from Task 3.1
    - Total existing tests: 11 tests
  - [x] 4.2 Analyze test coverage gaps for frequency feature only
    - Identify any critical user workflows lacking test coverage
    - Focus ONLY on gaps related to this spec's frequency feature
    - Do NOT assess entire application test coverage
    - Prioritize end-to-end workflows over unit test gaps
  - [x] 4.3 Write up to 7 additional strategic tests maximum
    - Add maximum of 7 new tests to fill identified critical gaps
    - Suggested test areas if gaps exist:
      - End-to-end: Edit frequency in grid, verify state update
      - Integration: Dropdown renders with all 9 options
      - Integration: Empty option renders for undefined frequency
      - Validation: Invalid frequency value rejected on load
      - UI: Column displays at correct position in Activity table
    - Do NOT write comprehensive coverage for all scenarios
    - Skip edge cases and accessibility tests unless business-critical
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's frequency feature
    - Expected total: approximately 11-18 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 11-18 tests total)
- Critical user workflows for frequency feature are covered
- No more than 7 additional tests added when filling in testing gaps
- Testing focused exclusively on frequency feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Type Definitions Layer (Task Group 1)** - Foundation types required by all other groups
2. **Configuration Layer (Task Group 2)** - Dropdown options and grid config depend on types
3. **Data Persistence Layer (Task Group 3)** - JSON loading depends on types
4. **Test Review and Gap Analysis (Task Group 4)** - Final verification after implementation

Note: Task Groups 2 and 3 can be executed in parallel after Task Group 1 completes, as they have no dependencies on each other.

---

## Implementation Notes

### Column Positioning Detail
The current process_activities grid config (gridConfigs.ts lines 32-43) has this column order:
```
0: id
1: business_process_id
2: name
3: description
4: frequency  <-- NEW column inserted here
5: sequence_order
6: actor_hint
7: user_interaction_level
8: tags
9: valid_from
10: valid_to
```

After insertion, frequency is at index 4, and sequence_order shifted to index 5.

### No Component Changes Required
The existing grid components handle dropdown cellType automatically:
- Empty option rendered for nullable fields when value is undefined
- Dropdown selection triggers existing UPDATE_ENTITY dispatch
- No component modifications needed - purely configuration-driven

### Backward Compatibility Guarantee
- Field is optional (`frequency?: ProcessActivityFrequency`)
- migrateProcessActivity passes through undefined when field is missing
- No default value assignment
- Existing JSON files will load with frequency as undefined

---

## Implementation Summary

**Completed:** 2025-12-03

**Test Results:**
- All 19 tests pass (4 type definition tests + 4 configuration tests + 4 data persistence tests + 7 additional strategic tests)
- TypeScript compilation successful with no errors

**Files Modified:**
1. `frontend/src/types/model.ts` - Added ProcessActivityFrequency type and updated ProcessActivity interface
2. `frontend/src/config/defaults.ts` - Added processActivityFrequencyOptions array
3. `frontend/src/config/gridConfigs.ts` - Added frequency column to process_activities config
4. `frontend/src/utils/fileOperations.ts` - Updated migrateProcessActivity function to include frequency field

**Test File Created:**
- `frontend/src/__tests__/process-activity-frequency.test.ts` - Comprehensive test suite for the feature
- `frontend/src/__tests__/run-process-activity-frequency-tests.ts` - Test runner documentation
