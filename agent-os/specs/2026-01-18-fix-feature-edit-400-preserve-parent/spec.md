# Specification: Fix Feature Edit 400 Error by Preserving Parent Epic on Work Item Updates

## Goal
Allow editing FEATURE and STORY work items (title, description, status, priority, targetWindow) without requiring the client to resend parent_id, by ensuring the backend preserves the existing parent_id when it is omitted/NULL in the update payload.

## User Stories
- As a user, I want to edit a FEATURE's title or description without receiving a 400 error so that I can rename features without disruption.
- As a user, I want my FEATURE's parent EPIC relationship to be preserved when I make simple edits so that the work item hierarchy remains intact.

## Specific Requirements

**Backend Patch Semantics for Update Validation**
- In `WorkItemService.updateWorkItem(id, dto)`, load the existing `WorkItemEntity` before validation
- Derive "effective" values for validation: `effectiveType = dto.type() if non-null/non-blank, else existing entity.getType()`
- Derive `effectiveParentId = dto.parentId() if non-null, else existing entity.getParentId()`
- Pass effectiveType and effectiveParentId to `validateParentRelationship()` instead of raw DTO values
- This ensures editing a FEATURE with an existing EPIC parent passes validation even when dto.parentId is null

**Backend Preserve Parent ID in Mapper**
- In `WorkItemMapper.updateEntityFromDto(entity, dto)`, do NOT overwrite `entity.parentId` with NULL when `dto.parentId()` is null
- Only set `entity.setParentId(dto.parentId())` when `dto.parentId()` is non-null
- Similarly, only set `entity.setType(dto.type())` when `dto.type()` is non-null and non-blank
- Current implementation on line 92-93 unconditionally overwrites type and parentId - this must be changed to conditional logic

**Backend Validation Message Consistency**
- After the change, the error "FEATURE work items require a parent of type EPIC." must only occur if the work item truly has no parent after applying patch semantics
- Or if the provided parent exists but is not of type EPIC
- Or if the parent is in a different project
- Editing a valid FEATURE that already has an EPIC parent must NOT produce this error

**Frontend Include Parent ID on Edit**
- In `WorkItemEditModal.tsx` handleSubmit, include `parentId` from the existing item in the update payload
- Map to `parent_id` (snake_case) in `workItemsApi.ts` `mapWorkItemUpdatePayloadToDto`
- Add `parent_id` field to the `WorkItemUpdateDto` interface in workItemsApi.ts
- This is defensive so that even if backend changes, the frontend sends the complete hierarchy link

**Contract and Serialization Alignment**
- Frontend must use `parent_id` (snake_case) when sending over the wire, matching `WorkItemDto @JsonProperty("parent_id")`
- Update `WorkItemUpdatePayload` type in frontend to include optional `parentId` field
- Ensure the mapper transforms camelCase `parentId` to snake_case `parent_id` for the API

## Visual Design
No visual changes required - this is a backend data handling fix with no UI modifications.

## Existing Code to Leverage

**WorkItemService.java (lines 131-149)**
- Contains the `updateWorkItem` method that loads entity, validates, and updates
- Validation currently passes raw DTO values to `validateWorkItem` - needs to derive effective values first
- The `validateParentRelationship` method at line 249 is where the 400 error originates

**WorkItemMapper.java (lines 87-104)**
- The `updateEntityFromDto` method unconditionally sets type and parentId from DTO
- Lines 92-93 (`entity.setType(dto.type())` and `entity.setParentId(dto.parentId())`) need conditional logic
- Pattern exists for conditional updates: see line 96 for status which preserves existing value if DTO is null

**WorkItemEditModal.tsx (lines 117-125)**
- The `handleSubmit` method constructs the update payload
- Currently sends type but not parentId - needs to add `parentId: item.parentId`
- Pattern for including existing item values already exists (see type on line 119)

**workItemsApi.ts (lines 65-72 and 140-164)**
- `WorkItemUpdateDto` interface needs `parent_id?: string` field added
- `mapWorkItemUpdatePayloadToDto` function needs to map parentId to parent_id
- Pattern for optional field mapping exists on lines 144-161

**WorkItemIntegrationTest.java**
- Contains test patterns for work item CRUD operations
- Can be used as reference for adding new update tests that verify parent preservation

## Out of Scope
- Adding UI controls to change a work item's parent
- Changing hierarchy rules (INITIATIVE->EPIC->FEATURE->STORY enforcement)
- Changing allowed types or statuses
- Migrating IDs or changing persistence schema
- Database schema changes
- Modifying the create work item flow
- Adding parent selection dropdown to edit modal
- Changes to work item deletion behavior
- Changes to work item sorting or ordering
- Performance optimizations to validation logic
