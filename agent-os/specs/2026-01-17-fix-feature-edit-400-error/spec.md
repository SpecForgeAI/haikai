# Specification: Fix Feature Edit 400 Error

## Goal
Ensure all work item update requests include the work item `type` field so that editing a Feature (or any work item) succeeds without a 400 "Work item type is required" error from the backend.

## User Stories
- As a product manager, I want to edit a Feature's title and save it so that I can keep my backlog up to date without encountering errors.
- As a user, I want clear feedback if something goes wrong during editing so that I understand how to resolve the issue.

## Specific Requirements

**Extend WorkItemUpdatePayload type to include type**
- Add `type: WorkItemType` as a required field to `WorkItemUpdatePayload` interface in `frontend/src/types/workItems.ts`
- This aligns the frontend payload with the backend's validation requirements
- The type field must match the existing work item's type (no type changes allowed)

**Extend WorkItemUpdateDto to include type**
- Add `type: string` to `WorkItemUpdateDto` interface in `frontend/src/api/workItemsApi.ts`
- This ensures the snake_case request body sent to the backend includes the `type` field

**Update mapWorkItemUpdatePayloadToDto mapper**
- Modify `mapWorkItemUpdatePayloadToDto()` in `frontend/src/api/workItemsApi.ts` to include `type` in the returned DTO
- The `type` should be mapped directly (no case transformation needed)
- This is the key fix: the mapper currently omits `type`, causing the 400 error

**Update updateWorkItem API call site**
- Modify the `updateWorkItem()` call in `WorkItemEditModal.tsx` to include `type: item.type` in the payload
- The type comes from the existing work item passed to the modal (not user-editable)
- Preserve all other existing payload fields (title, description, status, priority, targetWindow)

**Add validation guard for missing type**
- In `WorkItemEditModal.tsx`, add a validation check in `validateForm()` for missing `item.type`
- If `item.type` is falsy, set error: "Work item type is missing; please reload the project."
- Block form submission if type validation fails
- This handles edge cases where the item might be malformed in state

**Display type validation error in UI**
- Use the existing `errors._form` pattern to display the type validation error
- The error should appear in the `formError` div at the bottom of the form
- User should not be able to click Save when type is missing

**Unit test for mapWorkItemUpdatePayloadToDto**
- Create test in `frontend/src/__tests__/workItemsApi.test.ts`
- Test that when given a payload with `type: 'FEATURE'`, the returned DTO includes `type: 'FEATURE'`
- Follow existing test patterns from `bookOfWorkApi.test.ts`
- Verify all other fields still map correctly

**Component test for Feature edit flow**
- Create test that simulates editing a Feature title
- Mock `fetch` to capture the request body
- Assert the request body includes `type` matching the original work item
- Verify successful update does not throw an error

## Visual Design
No visual mockups provided. The UI remains unchanged; this is a data contract fix.

## Existing Code to Leverage

**frontend/src/types/workItems.ts - WorkItemUpdatePayload interface**
- Currently defines optional fields: title, description, status, priority, targetWindow
- Add required `type: WorkItemType` field following the same pattern as `WorkItemCreatePayload`
- `WorkItemType` type already exists in this file

**frontend/src/api/workItemsApi.ts - mapWorkItemUpdatePayloadToDto function**
- Currently maps title, description, status, priority, targetWindow from camelCase to snake_case
- Add `type` mapping (no case transformation needed, just copy the value)
- Follow the pattern of `mapWorkItemCreatePayloadToDto` which already includes type

**frontend/src/api/workItemsApi.ts - WorkItemUpdateDto interface**
- Currently omits `type` field
- Add `type: string` to match backend expectations
- Compare with `WorkItemCreateDto` which correctly includes type

**frontend/src/components/ProductView/WorkItemEditModal.tsx - handleSubmit function**
- Currently constructs update payload without `type`
- Add `type: item.type` to the payload object
- The `item` prop already contains the full `WorkItem` with `type` property

**frontend/src/__tests__/bookOfWorkApi.test.ts - test patterns**
- Use vitest with vi.fn() for mocking fetch
- Use beforeEach/afterEach for setup/teardown
- Assert on fetch call arguments using expect.objectContaining()
- Follow same structure for workItemsApi tests

## Out of Scope
- No backend changes to validation logic
- No ability to change a work item's type via the Edit modal
- No changes to WorkItemCreateModal (create flow already includes type)
- No changes to delete work item functionality
- No changes to work item tree display or selection logic
- No changes to INITIATIVE or EPIC editing (currently blocked by guard)
- No changes to work item status options or other field enums
- No refactoring of WorkItemEditModal beyond the required fix
- No internationalization of the new validation error message
- No E2E tests; only unit and component tests
