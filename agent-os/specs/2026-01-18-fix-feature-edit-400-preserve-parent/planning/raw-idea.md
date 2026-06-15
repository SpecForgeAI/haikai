# Raw Idea

## Title
Fix Feature Edit 400 Error by Preserving Parent Epic on Work Item Updates

## Context
Editing an existing FEATURE in the UI fails with 400 Bad Request: "FEATURE work items require a parent of type EPIC."
The FEATURE already has a valid EPIC parent in the database, but the update request does not include parent_id.
In the current backend implementation, update validation and mapping treat a missing/NULL parent_id as an attempt
to clear the parent, causing validation to fail and preventing simple edits (e.g., renaming a feature).

## Goal
Allow editing FEATURE and STORY work items (title/description/status/priority/targetWindow) without requiring the
client to resend parent_id, by ensuring the backend preserves the existing parent_id when it is omitted/NULL in
the update payload; additionally, ensure the frontend includes parent_id for robustness.

## Scope
- architecture-model-service: WorkItemService update validation + WorkItemMapper update behavior
- frontend: WorkItemEditModal/updateWorkItem payload construction
- No DB schema changes
- No changes to work item hierarchy rules themselves (INITIATIVE->EPIC->FEATURE->STORY remain enforced)

## Requirements

### backend_patch_semantics_for_update
- In architecture-model-service WorkItemService.updateWorkItem(id, dto):
    - Load the existing WorkItemEntity as currently done.
    - Derive "effective" values for validation:
        - effectiveType = dto.type if present/non-blank, else existing entity.type
        - effectiveParentId = dto.parentId if present (non-null), else existing entity.parentId
    - Validate using effectiveType and effectiveParentId so that editing a FEATURE with an existing EPIC parent
      passes validation even when dto.parentId is null/omitted.

### backend_preserve_parent_id_in_mapper
- In WorkItemMapper.updateEntityFromDto(entity, dto):
    - MUST NOT overwrite entity.parentId with NULL when dto.parentId is null/omitted.
    - Only set entity.parentId when dto.parentId is non-null.
    - (This ensures existing parent relationships are preserved on partial updates.)
- Similarly, type should not be accidentally cleared:
    - Only set entity.type if dto.type is non-null and non-blank (otherwise preserve entity.type).

### backend_validation_message_consistency
- After the change, the error "FEATURE work items require a parent of type EPIC." MUST only occur if:
    - the work item truly has no parent (after applying patch semantics), OR
    - the provided parent exists but is not EPIC, OR
    - the parent is in a different project
- Editing a valid FEATURE that already has an EPIC parent MUST NOT produce this error.

### frontend_include_parent_id_on_edit
- In frontend WorkItemEditModal.tsx (or the update payload assembly used by updateWorkItem):
    - Include parentId (snake_case parent_id at the API boundary) from the existing item in the update payload:
        - parent_id: item.parentId
    - This is defensive so that even if other code paths change, the backend receives the required hierarchy link.
- Do not change the UI (no new fields); parent_id is preserved automatically.

### contract_and_serialization_alignment
- Ensure frontend uses the correct field name expected by backend JSON mapping:
    - parent_id (not parentId) when sending over the wire, consistent with WorkItemDto @JsonProperty("parent_id").
- Ensure type continues to be sent as currently required by backend ("type" must be present).

## Tests and Regression

### backend_tests
- Add/adjust a WorkItemService update test to cover:
    - given an existing FEATURE with EPIC parent,
    - when updateWorkItem is called with dto.parentId = null and dto.type = "FEATURE",
    - then update succeeds and parent_id remains unchanged.

### frontend_smoke
- Editing a FEATURE title and clicking Save must succeed without 400, and parent chain remains intact in UI.

## Acceptance Criteria
- Editing a FEATURE (e.g., changing title/description) succeeds with HTTP 200 and no 400 validation error.
- The FEATURE's parent_id remains the same EPIC after the update (verified by reloading work items).
- The backend no longer treats missing/NULL parent_id in update payloads as clearing the parent.
- Frontend update request includes parent_id (existing value) for FEATURE/STORY edits.

## Non-Goals
- Adding UI controls to change a work item's parent
- Changing hierarchy rules or allowed types/statuses
- Migrating IDs or changing persistence schema
