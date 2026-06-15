# Specification: Roadmap Import v3 - Stable IDs + Safe Archive/Delete

## Goal
Upgrade the roadmap importer to be safely repeatable by using deterministic UUIDs for INITIATIVE/EPIC items and implementing safe archive/delete logic for removed items, preserving existing FEATURE/STORY links.

## User Stories
- As a project manager, I want to re-import the roadmap.md file multiple times so that I can update initiative/epic titles and descriptions without losing the features and stories already created under them.
- As a developer, I want stable IDs for initiatives and epics so that features linked to an epic remain correctly associated after subsequent imports.

## Specific Requirements

**Remove v1 import blocking**
- Delete the 409 CONFLICT check in `RoadmapImportService.checkForExistingFeaturesOrStories()`
- Import should proceed regardless of existing FEATURE/STORY work items
- This enables safe repeated imports after backlog population begins

**Deterministic ID generation using UUIDv5-style hashing**
- Use `java.util.UUID.nameUUIDFromBytes(keyString.getBytes(StandardCharsets.UTF_8))` for MD5-based UUID generation
- Initiative key string format: `"work_item|{projectId}|INITIATIVE|{normalizedTitle}"`
- Epic key string format: `"work_item|{projectId}|EPIC|{parentInitiativeNormalizedTitle}|{normalizedTitle}"`
- IDs remain stable as long as titles and initiative associations remain unchanged

**Title normalization algorithm**
- Trim leading and trailing whitespace
- Collapse consecutive whitespace characters to single spaces
- Convert to lowercase
- Do NOT strip punctuation beyond whitespace normalization
- Apply to both initiative and epic titles before key generation

**Refactor parser output model for deterministic keys**
- Extend `InitiativeNode` with: `normalizedTitle`, `computedId` (UUID)
- Extend `EpicNode` with: `normalizedTitle`, `computedId` (UUID)
- Compute IDs during parsing phase, after title extraction and normalization
- Pass parent initiative's normalized title when computing epic keys

**Upsert persistence logic for INITIATIVE and EPIC**
- Replace delete-and-recreate strategy with proper upsert
- Load existing INITIATIVE/EPIC items for project at start of transaction
- For each parsed item: update if ID exists (title, description, sort_order, updated_at), insert if new
- Preserve createdAt on existing items, only update updatedAt
- Set status to "PLANNED" on insert or when previously archived item reappears

**Safe archive/delete for removed items**
- After upsert, identify items no longer in parsed roadmap (by comparing IDs)
- For each removed item: count children using `countByProjectIdAndParentId()`
- If children exist: set status = "ARCHIVED" (do not delete)
- If no children: delete the item
- Process epics before initiatives to correctly evaluate initiative children

**Repository additions to WorkItemRepository**
- `Optional<WorkItemEntity> findByIdAndProjectId(UUID id, String projectId)` for scoped lookups
- `List<WorkItemEntity> findByProjectIdAndTypeIn(String projectId, Collection<String> types)` for loading existing scope
- `long countByProjectIdAndParentId(String projectId, UUID parentId)` for child existence checks
- Ensure all update/delete operations include projectId in WHERE clause for safety

**ARCHIVED status handling**
- Use existing TEXT status column with new value "ARCHIVED"
- No database schema changes required
- Un-archive automatically when item reappears in roadmap (set status back to "PLANNED")
- Archived items remain queryable and maintain parent-child relationships

**Sort order refresh**
- Update sortOrder for all parsed items based on appearance order in markdown (0-indexed)
- Existing items get their sortOrder updated on upsert
- Sort order changes should trigger updatedAt timestamp update

**No endpoint changes**
- Keep `POST /api/model/projects/{projectId}/roadmap/import` unchanged
- Response DTO (`RoadmapImportResultDto`) fields remain the same
- Consider adding archived/deleted counts to response in future iteration

## Existing Code to Leverage

**RoadmapImportService (service/RoadmapImportService.java)**
- Refactor `importFromAgentOsFile()` to use upsert instead of delete-all strategy
- Remove `checkForExistingFeaturesOrStories()` method entirely
- Keep artifact storage logic unchanged (storeArtifact method)
- Reuse file reading and parser invocation patterns

**RoadmapParser (util/RoadmapParser.java)**
- Extend to compute normalized titles and deterministic IDs during parsing
- Add utility method for title normalization
- Add utility method for UUID generation from key strings
- Existing parsing strategies (Strategy 1/2/3) remain unchanged

**WorkItemRepository (repository/entity/WorkItemRepository.java)**
- Add new query methods for scoped lookups and child counting
- Existing methods like `findByProjectIdAndTypeOrderBy...` can be reused
- Pattern follows existing Spring Data JPA conventions

**WorkItemEntity (model/entity/WorkItemEntity.java)**
- No changes needed; existing status field supports "ARCHIVED" value
- Use builder pattern for creating/updating entities
- Leverage @PreUpdate hook for automatic updatedAt management

**InitiativeNode and EpicNode (model/parser/)**
- Extend with normalizedTitle and computedId fields
- Maintain backward compatibility with existing builder patterns
- Add Lombok @Builder.Default for new fields where appropriate

## Out of Scope
- Alias or rename reconciliation (title renames create new IDs, old items get archived)
- Status mapping from markdown checkboxes (checkbox state continues to be ignored)
- Stable IDs for FEATURE or STORY items (these are created by UI, not importer)
- Export/generation from DB back to roadmap.md (no reverse sync in this increment)
- UI changes or frontend updates (backend-only scope)
- Migration of existing data to new ID scheme (existing items remain until next import)
- Batch import from multiple roadmap files
- Conflict detection for concurrent imports
- Audit logging of archive/delete operations
- Soft-delete with retention period (archive is the retention strategy)
