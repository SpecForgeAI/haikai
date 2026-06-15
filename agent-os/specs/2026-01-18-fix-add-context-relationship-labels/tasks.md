# Task Breakdown: Fix Add Context Relationship Labels

## Overview
Total Tasks: 6

This is a simple bug fix that requires passing an additional argument to an existing function. The utility functions already support the required behavior - only the call site needs updating.

## Task List

### Frontend Bug Fix

#### Task Group 1: Update Relationship Options Builder Call
**Dependencies:** None

- [x] 1.0 Complete relationship label fix
  - [x] 1.1 Write 2-3 focused tests for the fix
    - Test that `relationshipOptions` contains properly formatted labels when entities are available
    - Test the pipe-separated format: `"<name> [<TYPE>] | <name> [<TYPE>]"`
    - Test that labels no longer show "Unknown Relationship" when entities exist
  - [x] 1.2 Update `buildRelationshipPickList` call in ProductImplementPage.tsx
    - File: `frontend/src/components/ProductView/ProductImplementPage.tsx`
    - Location: lines 288-290 (relationshipOptions useMemo)
    - Change from: `buildRelationshipPickList(model.metaModel.relationships)`
    - Change to: `buildRelationshipPickList(model.metaModel.relationships, model.metaModel.entities)`
  - [x] 1.3 Update useMemo dependency array
    - Add `model.metaModel.entities` to the dependency array
    - Change from: `[model.metaModel.relationships]`
    - Change to: `[model.metaModel.relationships, model.metaModel.entities]`
  - [x] 1.4 Ensure tests pass
    - Run ONLY the 2-3 tests written in 1.1
    - Verify relationship labels display correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-3 tests written in 1.1 pass
- Relationship labels in Add Context modal show pipe-separated format
- Labels display resolved entity names and types (e.g., "Interface Name [INTERFACE] | Entity Name [LOGICAL_DATA_ENTITY]")
- No "Unknown Relationship" labels when entities exist in the model

### Testing

#### Task Group 2: Test Review and Verification
**Dependencies:** Task Group 1

- [x] 2.0 Review existing tests and verify fix
  - [x] 2.1 Review existing test coverage
    - Review tests in `frontend/src/__tests__/contextPickListBuildersRelationshipLabels.test.ts`
    - Review tests in `frontend/src/__tests__/contextPickerUxIntegration.test.ts`
    - Confirm existing tests already cover the utility function behavior
  - [x] 2.2 Identify any critical gaps
    - Check if integration-level test exists for ProductImplementPage relationship options
    - Focus ONLY on gaps related to this specific fix
  - [x] 2.3 Add up to 2 additional tests if gaps found
    - Only if critical integration coverage is missing
    - Test that ProductImplementPage passes entities to buildRelationshipPickList
  - [x] 2.4 Run feature-specific tests only
    - Run tests from 1.1 and any from 2.3
    - Run existing relationship label tests in contextPickListBuildersRelationshipLabels.test.ts
    - Verify all pass
    - Do NOT run the entire application test suite

**Acceptance Criteria:**
- All feature-specific tests pass
- Existing utility function tests continue to pass
- No more than 2 additional tests added if gaps found
- Verified that fix resolves the "Unknown Relationship" display issue

## Execution Order

Recommended implementation sequence:
1. Frontend Bug Fix (Task Group 1)
2. Test Review and Verification (Task Group 2)

## Notes

- This is a **frontend-only fix** - no backend changes required
- The utility functions (`buildRelationshipPickList`, `computeRelationshipLabel`) already support this behavior
- The fix follows an existing pattern - see `architectureOptions` useMemo at lines 277-280 which already uses `model.metaModel.entities`
- Reference test showing correct usage: `contextPickerUxIntegration.test.ts` lines 108-122
