# Task Breakdown: Fix Feature Edit 400 Error

## Overview
Total Tasks: 14

This is a focused bug fix to ensure work item update requests include the required `type` field. The backend returns a 400 "Work item type is required" error when editing Features because the frontend mapper omits the `type` field from the update payload.

## Task List

### Type Layer

#### Task Group 1: Type Definitions
**Dependencies:** None

- [x] 1.0 Complete type layer updates
  - [x] 1.1 Write 2 focused tests for type extension verification
    - Test that WorkItemUpdatePayload accepts `type: WorkItemType` field
    - Test that WorkItemUpdateDto accepts `type: string` field
  - [x] 1.2 Add `type` field to WorkItemUpdatePayload interface
    - File: `frontend/src/types/workItems.ts`
    - Add `type: WorkItemType` as required field (line ~134-145)
    - Follow pattern from `WorkItemCreatePayload` which already includes type
  - [x] 1.3 Add `type` field to WorkItemUpdateDto interface
    - File: `frontend/src/api/workItemsApi.ts`
    - Add `type?: string` to WorkItemUpdateDto (line ~59-65)
    - Compare with WorkItemCreateDto which correctly includes type
  - [x] 1.4 Ensure type layer tests pass
    - Run ONLY the 2 tests written in 1.1
    - Verify TypeScript compilation succeeds

**Acceptance Criteria:**
- The 2 tests written in 1.1 pass
- WorkItemUpdatePayload includes required `type: WorkItemType` field
- WorkItemUpdateDto includes optional `type?: string` field
- TypeScript compilation succeeds with no errors

### API Layer

#### Task Group 2: Mapper Function Update
**Dependencies:** Task Group 1

- [x] 2.0 Complete API layer mapper update
  - [x] 2.1 Write 3 focused tests for mapWorkItemUpdatePayloadToDto
    - Test that payload with `type: 'FEATURE'` returns DTO with `type: 'FEATURE'`
    - Test that payload with `type: 'STORY'` returns DTO with `type: 'STORY'`
    - Test that all other fields (title, description, status, priority, targetWindow) still map correctly
  - [x] 2.2 Update mapWorkItemUpdatePayloadToDto to include type
    - File: `frontend/src/api/workItemsApi.ts`
    - Add `type` mapping in function (line ~129-149)
    - Map directly: `dto.type = payload.type` (no case transformation needed)
    - Follow pattern from mapWorkItemCreatePayloadToDto
  - [x] 2.3 Ensure API layer tests pass
    - Run ONLY the 3 tests written in 2.1
    - Verify mapper includes type in output DTO

**Acceptance Criteria:**
- The 3 tests written in 2.1 pass
- mapWorkItemUpdatePayloadToDto includes `type` in returned DTO
- All existing field mappings continue to work correctly

### UI Layer

#### Task Group 3: Modal Component Update
**Dependencies:** Task Group 2

- [x] 3.0 Complete UI layer updates
  - [x] 3.1 Write 3 focused tests for WorkItemEditModal
    - Test that handleSubmit includes `type: item.type` in update payload
    - Test that missing `item.type` triggers validation error
    - Test that validation error appears in `formError` div
  - [x] 3.2 Add type validation guard in validateForm
    - File: `frontend/src/components/ProductView/WorkItemEditModal.tsx`
    - Check if `item.type` is falsy in validateForm function (line ~85-95)
    - If missing, set error: "Work item type is missing; please reload the project."
    - Use existing `errors._form` pattern for error display
  - [x] 3.3 Update handleSubmit to include type in payload
    - File: `frontend/src/components/ProductView/WorkItemEditModal.tsx`
    - Add `type: item.type` to updateWorkItem payload (line ~105-111)
    - Preserve all existing fields: title, description, status, priority, targetWindow
    - Add `item.type` to useCallback dependency array if needed
  - [x] 3.4 Ensure UI layer tests pass
    - Run ONLY the 3 tests written in 3.1
    - Verify type is included in API call
    - Verify validation error displays correctly

**Acceptance Criteria:**
- The 3 tests written in 3.1 pass
- handleSubmit includes `type: item.type` in update payload
- Missing type triggers user-friendly validation error
- Save button disabled when type validation fails

### Testing

#### Task Group 4: Test Review and Integration Verification
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review tests and verify end-to-end fix
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review 2 type tests from Task 1.1
    - Review 3 mapper tests from Task 2.1
    - Review 3 component tests from Task 3.1
    - Total existing tests: 8 tests
  - [x] 4.2 Analyze test coverage gaps for this feature only
    - Verify complete edit flow is covered (type included in request)
    - Verify error handling path is covered
    - Focus ONLY on gaps related to this bug fix
  - [x] 4.3 Write up to 2 additional integration tests if needed
    - Test complete Feature edit flow with fetch mock capturing request body
    - Assert request body includes `type` field matching original work item
    - Follow patterns from `bookOfWorkApi.test.ts`
  - [x] 4.4 Run feature-specific tests only
    - Run all tests from 1.1, 2.1, 3.1, and 4.3
    - Expected total: approximately 8-10 tests
    - Verify the 400 error scenario is now resolved

**Acceptance Criteria:**
- All feature-specific tests pass (8-10 tests total)
- Complete edit flow verified with type field included
- No regression in existing work item functionality

## Execution Order

Recommended implementation sequence:
1. Type Layer (Task Group 1) - Extend interfaces first
2. API Layer (Task Group 2) - Update mapper function
3. UI Layer (Task Group 3) - Update modal component
4. Testing (Task Group 4) - Verify end-to-end fix

## Key Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/types/workItems.ts` | Add `type: WorkItemType` to WorkItemUpdatePayload |
| `frontend/src/api/workItemsApi.ts` | Add `type?: string` to WorkItemUpdateDto; update mapper |
| `frontend/src/components/ProductView/WorkItemEditModal.tsx` | Add type to payload; add validation guard |
| `frontend/src/__tests__/workItemsApi.test.ts` | New test file for mapper tests |

## Notes

- This is a data contract fix; no visual changes required
- The `type` field comes from the existing work item (not user-editable)
- Follow existing test patterns from `bookOfWorkApi.test.ts`
- Use vitest with vi.fn() for mocking fetch

## Implementation Summary

**Completed on:** 2026-01-17

**Total tests:** 34 tests passing (25 workItemsApi + 9 WorkItemEditModal)

**Files Modified:**
1. `frontend/src/types/workItems.ts` - Added `type: WorkItemType` to WorkItemUpdatePayload interface
2. `frontend/src/api/workItemsApi.ts` - Added `type?: string` to WorkItemUpdateDto; updated mapWorkItemUpdatePayloadToDto to include type mapping
3. `frontend/src/components/ProductView/WorkItemEditModal.tsx` - Added type validation guard in validateForm; added `type: item.type` to update payload in handleSubmit
4. `frontend/src/__tests__/workItemsApi.test.ts` - Extended with type definition tests and integration tests
5. `frontend/src/__tests__/WorkItemEditModal.test.tsx` - New test file for component tests

**Key Changes:**
- WorkItemUpdatePayload now requires `type: WorkItemType` field
- WorkItemUpdateDto now includes optional `type?: string` field
- mapWorkItemUpdatePayloadToDto maps `type` directly (no case transformation)
- WorkItemEditModal validates item.type presence before submission
- WorkItemEditModal includes `type: item.type` in update payload
