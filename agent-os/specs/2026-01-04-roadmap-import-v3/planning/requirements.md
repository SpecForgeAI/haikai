# Roadmap Import v3 - Stable IDs + Safe Archive/Delete

## Title
Roadmap import v3 - make import repeatable & deterministic with stable IDs (UUIDv5-style) + safe archive/delete of removed items

## Scope
Backend-only (architecture-model-service)
Increment: 3 (import safety + determinism; no UI changes)

## Intent
Upgrade the roadmap importer so it is safe to run repeatedly, including after backlog features/stories exist, without breaking links from FEATURE/STORY to EPIC.
Achieve this by:
- Generating deterministic, stable IDs for INITIATIVE and EPIC work_items derived from (projectId + type + logical key)
- Upserting INITIATIVE/EPIC rows on each import (insert new, update existing)
- Handling initiatives/epics removed from roadmap.md safely:
  - If removed item has children (FEATURE/STORY or EPIC/FEATURE), mark as ARCHIVED (do not delete)
  - If removed item has no children, delete it
- Keep artifact revisioning unchanged (always store ROADMAP_MD content in project_artifact)

## Non-Goals
- No alias/rename reconciliation beyond deterministic ID strategy (renames will create new IDs)
- No status mapping from markdown checkboxes (still ignore)
- No stable IDs for FEATURE/STORY (created by UI, not importer)
- No export generation (DB -> roadmap.md) in this increment

## Acceptance Criteria
1) Import can run successfully even if FEATURE/STORY exist for the project (remove v1 409 block).
2) INITIATIVE and EPIC IDs are deterministic and stable across imports as long as their logical key remains unchanged.
3) Re-import does not break existing FEATURE/STORY links:
   - Features under an Epic remain under the same Epic after import if the epic key is unchanged.
4) Upsert behavior:
   - Existing initiative/epic rows are updated (title/description/sort_order/updated_at) rather than duplicated.
   - Newly discovered initiatives/epics are inserted.
5) Removed initiatives/epics from the latest parsed roadmap:
   - If they have children, they are set to status="ARCHIVED"
   - If they have no children, they are deleted
6) Sort order is refreshed based on appearance order in the imported roadmap.
7) Tests verify stable IDs, upsert, and archive/delete behavior.

## Design / Key Definitions

### Deterministic ID Strategy (UUIDv5-style)
- Generate UUIDs from a stable string key using a standard name-based UUID algorithm.
- Use `java.util.UUID.nameUUIDFromBytes(bytes)` (MD5-based) for v1 simplicity.
- Ensure bytes are UTF-8 of the key string.

### Key Strings
- Initiative key string:
  `"work_item|{projectId}|INITIATIVE|{initiativeTitleNormalized}"`
- Epic key string:
  `"work_item|{projectId}|EPIC|{initiativeTitleNormalized}|{epicTitleNormalized}"`

### Normalization
- Trim leading/trailing whitespace
- Collapse consecutive whitespace to single spaces
- Lowercase
- Do NOT strip punctuation beyond whitespace normalization

### Important Implication
- If initiative title changes, its ID changes; same for epic titles or if an epic moves to a different initiative title.
- This is acceptable for v3; alias/move handling can be added later.

### ARCHIVED State
- Use existing status TEXT column; add new value "ARCHIVED" (no DB enum change).
- Importer transitions INITIATIVE/EPIC status to ARCHIVED when removed but has children.
- Importer should NOT automatically un-archive items unless they reappear in roadmap (then status becomes PLANNED on upsert).

## Implementation Changes

### 1) Remove v1 import blocking
- Delete the 409 CONFLICT behavior that blocked import when FEATURE/STORY exist.
- Import should proceed regardless of existing children.

### 2) Refactor parser output model to include deterministic keys
- Update intermediate parser nodes (InitiativeNode, EpicNode) to carry:
  - rawTitle
  - normalizedTitle
  - computedId (UUID)
  - sortOrder
  - description (for epics)

### 3) Upsert persistence for INITIATIVE and EPIC
Implement in RoadmapImportService.importFromAgentOsFile(projectId):

3.1 Read file, store project_artifact (unchanged from v1/v2)
3.2 Parse roadmap.md to get initiatives/epics (same parser as v2)
3.3 Compute deterministic IDs for each initiative/epic
3.4 Upsert algorithm (single transaction):
  A) Load existing imported scope
  B) Upsert INITIATIVE rows (update if exists, insert if new)
  C) Upsert EPIC rows (update if exists, insert if new)

### 4) Safe handling of removed initiatives/epics
After upsert:
- For removed epics: archive if has children, delete if no children
- For removed initiatives: archive if has children, delete if no children
- Do NOT automatically delete/alter FEATURES/STORIES under archived epics

### 5) Repository additions
WorkItemRepository add methods:
- Optional<WorkItemEntity> findByIdAndProjectId(UUID id, String projectId)
- List<WorkItemEntity> findByProjectIdAndType(String projectId, String type)
- long countByProjectIdAndParentId(String projectId, UUID parentId)

### 6) Ensure projectId scoping on writes
Every update/delete must ensure the targeted row belongs to the projectId.

### 7) No changes to endpoints
- Keep POST /api/model/projects/{projectId}/roadmap/import unchanged.
- Response fields remain the same.

## Tests

1) Deterministic IDs stable across repeated imports
2) Upsert updates description/sort order
3) Removed epic with features is archived (not deleted)
4) Removed epic with no children is deleted
5) Removed initiative with epics/features is archived

## Definition of Done
- Import is repeatable and deterministic for INITIATIVE/EPIC with stable IDs.
- Existing backlog links are preserved on re-import when titles/initiative associations are unchanged.
- Removed items archive safely when children exist; otherwise delete.
- Tests cover stability and safety semantics.
