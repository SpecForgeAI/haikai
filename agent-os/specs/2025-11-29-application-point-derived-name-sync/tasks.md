# Task Breakdown: Application Point Derived Name Synchronisation

## Overview
Total Tasks: 24

This feature treats `application_point.name` as a fully derived field that stays in sync with its source entity (Application, App Component, or Service). The implementation strengthens existing sync functions and adds triggers at key moments: load, edit, and pre-validation/pre-save.

## Task List

### Sync Logic Layer

#### Task Group 1: Strengthen Load-Time Sync
**Dependencies:** None

- [x] 1.0 Complete load-time sync enhancements
  - [x] 1.1 Write 4-6 focused tests for load-time sync functionality
    - Test: AP name is overwritten when it differs from source entity name
    - Test: AP name is populated when AP exists with empty name
    - Test: Orphaned APs (no corresponding entity) are removed on load
    - Test: Post-load guarantee - no APs with empty names when source has valid name
    - Test: AP is created with correct name for entity missing its AP
    - Test: AP foreign keys (kind, application_id, etc.) are set correctly
  - [x] 1.2 Enhance `syncApplicationPointNames()` to always overwrite with source entity name
    - Current behavior preserves AP name if source entity name is empty - this is correct
    - Current behavior preserves AP name if source entity exists - CHANGE to always overwrite
    - Modify condition: always set `ap.name = sourceEntity.name` when source entity exists
    - Location: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\applicationPointSync.ts` lines 210-241
  - [x] 1.3 Verify `reconcileApplicationPoints()` name overwrite behavior
    - Confirm Step 4 (name sync) runs after AP creation (Steps 1-3)
    - Confirm Step 5 (orphan removal) works correctly
    - Add explicit name force-write in Steps 1-3 when AP already exists
    - Location: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\applicationPointSync.ts` lines 380-455
  - [x] 1.4 Add logic to overwrite existing AP name even when AP already exists
    - When iterating Applications/App Components/Services, if AP exists but name differs, update it
    - This ensures legacy APs with stale names get corrected on load
  - [x] 1.5 Ensure load-time sync tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify reconciliation handles all edge cases
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- After load, every Application Point has the same name as its source entity
- Orphaned Application Points are removed
- APs with stale/different names are corrected

---

### Reducer/State Management Layer

#### Task Group 2: Add Edit-Time Sync (Reducer Integration)
**Dependencies:** Task Group 1

- [x] 2.0 Complete edit-time sync in reducer
  - [x] 2.1 Write 4-6 focused tests for edit-time sync functionality
    - Test: Renaming an Application updates its AP name immediately
    - Test: Renaming an App Component updates its AP name immediately
    - Test: Renaming a Service updates its AP name immediately
    - Test: Changing name from empty to non-empty updates AP name
    - Test: Changing name from non-empty to empty updates AP name
    - Test: AP is created if missing when source entity name changes
  - [x] 2.2 Modify `UPDATE_ENTITY` case in reducer to detect name changes
    - When `entityType` is `applications`, `app_components`, or `services`
    - Compare old entity name with new entity name from action.entity
    - If name has changed, trigger AP name update
    - Location: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\contexts\ArchitectureContext.tsx` lines 146-164
  - [x] 2.3 Implement AP lookup and update within `UPDATE_ENTITY` case
    - Use `findApplicationPointForEntity()` to find corresponding AP
    - If AP found, update its name to match new entity name
    - Return updated state with both entity and AP changes
  - [x] 2.4 Handle case where AP does not exist during entity edit
    - If AP not found during name change, create it using `createApplicationPointFromEntity()`
    - Add new AP to `application_points` array in returned state
  - [x] 2.5 Extract sync logic into helper function for cleaner reducer code
    - Create helper: `syncApplicationPointNameForEntity(entities, entityType, entityId, newName)`
    - Returns updated application_points array
    - Handles both update and creation scenarios
  - [x] 2.6 Ensure edit-time sync tests pass
    - Run ONLY the 4-6 tests written in 2.1
    - Verify immediate sync on entity name changes
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 2.1 pass
- Renaming Application/App Component/Service instantly updates corresponding AP name
- Works for name changes from empty to non-empty and vice versa
- Creates missing AP if needed during entity edit

---

### Validation Layer

#### Task Group 3: Add Pre-Validation/Pre-Save Sync
**Dependencies:** Task Groups 1-2

- [x] 3.0 Complete pre-validation and pre-save sync integration
  - [x] 3.1 Write 4-6 focused tests for pre-validation/pre-save sync
    - Test: `syncApplicationPointNames()` is called before `validateModel()`
    - Test: After sync, no AP validation errors for `name` when source entities have names
    - Test: Validation errors for AP `name` only appear when source entity has no name
    - Test: Pre-save sync ensures all AP names are aligned before JSON serialization
    - Test: Missing APs are created during pre-save sync
  - [x] 3.2 Create `prepareModelForValidation()` function
    - Calls `syncApplicationPointNames()` on model's application_points
    - Returns model with synchronized AP names
    - Location: Create in `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\validation.ts`
  - [x] 3.3 Integrate `prepareModelForValidation()` into `validateModel()`
    - At the start of `validateModel()`, call sync logic
    - Ensure validation runs on the synced model, not original
    - Location: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\validation.ts` line 373
  - [x] 3.4 Create `prepareModelForSave()` function for pre-save sync
    - Runs full `reconcileApplicationPoints()` or at minimum `syncApplicationPointNames()`
    - Ensures AP names and existence are correct before serialization
    - Can be same as or call `prepareModelForValidation()`
  - [x] 3.5 Integrate pre-save sync into save workflow
    - Identify save handler (likely in a component or hook)
    - Call `prepareModelForSave()` before JSON serialization
    - Ensure saved JSON has correct AP names
  - [x] 3.6 Ensure pre-validation/pre-save sync tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify sync occurs before validation and save
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 3.1 pass
- `validateModel()` runs on synced model
- No `APPLICATION_POINT ['unnamed row']` errors when source entities have names
- Saved JSON has correct, synchronized AP names

---

### Testing

#### Task Group 4: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 4-6 tests written by sync-logic engineer (Task 1.1)
    - Review the 4-6 tests written by reducer engineer (Task 2.1)
    - Review the 4-6 tests written by validation engineer (Task 3.1)
    - Total existing tests: approximately 12-18 tests
  - [x] 4.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows that lack coverage
    - Focus ONLY on gaps related to AP name sync requirements
    - Check for integration gaps between load, edit, and validation flows
    - Prioritize user-facing scenarios from acceptance criteria
  - [x] 4.3 Write up to 6 additional strategic tests maximum
    - Add maximum of 6 new tests to fill identified critical gaps
    - Suggested gap tests:
      - E2E: Load model with stale AP names, verify corrected, validate, no errors
      - E2E: Create new entity, rename it multiple times, verify AP stays in sync
      - E2E: Save model, reload, verify AP names preserved correctly
      - Integration: Dropdown displays (App Point <-> Process) show correct names
      - Edge case: Entity with special characters in name syncs correctly
      - Edge case: Concurrent rapid name changes handled correctly
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, and 4.3)
    - Expected total: approximately 18-24 tests maximum
    - Do NOT run the entire application test suite
    - Verify all acceptance criteria from spec are covered

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 18-24 tests total)
- Critical user workflows for AP name sync are covered
- No more than 6 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Sync Logic Layer (Task Group 1)** - Strengthen the core sync functions
   - This is foundational; all other work depends on correct sync logic
   - Focus on `applicationPointSync.ts` modifications

2. **Reducer/State Management Layer (Task Group 2)** - Add real-time sync triggers
   - Depends on Task Group 1 for sync helper functions
   - Focus on `ArchitectureContext.tsx` modifications

3. **Validation Layer (Task Group 3)** - Add pre-validation/pre-save sync
   - Depends on Task Groups 1-2 for sync functions
   - Focus on `validation.ts` modifications and save workflow integration

4. **Test Review and Gap Analysis (Task Group 4)** - Verify coverage and fill gaps
   - Depends on all previous groups completing their tests
   - Focus on integration and end-to-end scenarios

---

## Key Files to Modify

| File Path | Purpose |
|-----------|---------|
| `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\applicationPointSync.ts` | Core sync logic - strengthen `syncApplicationPointNames()` and `reconcileApplicationPoints()` |
| `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\contexts\ArchitectureContext.tsx` | Reducer - add sync trigger to `UPDATE_ENTITY` case |
| `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\validation.ts` | Pre-validation sync - create `prepareModelForValidation()` and integrate |

---

## Out of Scope Reminders

Per the spec, the following are explicitly out of scope:
- Bidirectional name sync (AP names do NOT update source entities)
- User ability to override or customize Application Point names
- Persisting sync preferences
- Internationalization of sync-related messages
- Application Point name uniqueness validation
