# Task Breakdown: Roadmap Import v3 - Stable IDs + Safe Archive/Delete

## Overview
Total Tasks: 23 sub-tasks across 5 task groups

**Goal:** Upgrade the roadmap importer to be safely repeatable by using deterministic UUIDs for INITIATIVE/EPIC items and implementing safe archive/delete logic for removed items, preserving existing FEATURE/STORY links.

**Stack:** Backend-only (Java/Spring Boot/JPA)

## Task List

### Utilities Layer

#### Task Group 1: Title Normalization and Deterministic ID Utilities
**Dependencies:** None

- [x] 1.0 Complete utility layer for stable ID generation
  - [x] 1.1 Write 4 focused tests for normalization and ID generation utilities
    - Test title normalization: whitespace trimming, collapsing consecutive spaces, lowercase conversion
    - Test title normalization preserves punctuation (e.g., "Auth - v2.0" normalizes correctly)
    - Test initiative UUID generation produces consistent IDs across calls
    - Test epic UUID generation includes parent initiative title in key
  - [x] 1.2 Create `StableIdGenerator` utility class
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/util/StableIdGenerator.java`
    - Method: `String normalizeTitle(String title)` - trim, collapse whitespace, lowercase
    - Method: `UUID generateInitiativeId(String projectId, String normalizedTitle)`
    - Method: `UUID generateEpicId(String projectId, String parentNormalizedTitle, String normalizedTitle)`
    - Use `java.util.UUID.nameUUIDFromBytes(keyString.getBytes(StandardCharsets.UTF_8))`
    - Initiative key format: `"work_item|{projectId}|INITIATIVE|{normalizedTitle}"`
    - Epic key format: `"work_item|{projectId}|EPIC|{parentNormalizedTitle}|{normalizedTitle}"`
  - [x] 1.3 Ensure utility tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify deterministic ID generation is consistent

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- Title normalization handles edge cases (multiple spaces, tabs, mixed case)
- Same input always produces same UUID output
- Different inputs produce different UUIDs

---

### Parser Layer

#### Task Group 2: Parser Model Extensions for Deterministic Keys
**Dependencies:** Task Group 1

- [x] 2.0 Complete parser model extensions
  - [x] 2.1 Write 4 focused tests for parser node extensions
    - Test InitiativeNode stores normalizedTitle and computedId
    - Test EpicNode stores normalizedTitle and computedId
    - Test parser populates computed fields during parsing
    - Test computed IDs are stable across repeated parse calls
  - [x] 2.2 Extend `InitiativeNode` model
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/parser/InitiativeNode.java`
    - Add field: `private String normalizedTitle`
    - Add field: `private UUID computedId`
    - Maintain backward compatibility with existing builder pattern
  - [x] 2.3 Extend `EpicNode` model
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/parser/EpicNode.java`
    - Add field: `private String normalizedTitle`
    - Add field: `private UUID computedId`
    - Maintain backward compatibility with existing builder pattern
  - [x] 2.4 Update `RoadmapParser` to compute IDs during parsing
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/util/RoadmapParser.java`
    - Inject or instantiate `StableIdGenerator`
    - After building each `InitiativeNode`, compute and set `normalizedTitle` and `computedId`
    - After building each `EpicNode`, compute and set `normalizedTitle` and `computedId` (using parent initiative's normalizedTitle)
    - Update all three parsing strategies (Strategy 1, 2, 3)
  - [x] 2.5 Ensure parser tests pass
    - Run ONLY the 4 tests written in 2.1
    - Verify parsed nodes contain computed IDs

**Acceptance Criteria:**
- The 4 tests written in 2.1 pass
- InitiativeNode and EpicNode have new fields populated after parsing
- Computed IDs are deterministic based on titles and project context
- Existing parsing strategies continue to work

---

### Repository Layer

#### Task Group 3: Repository Methods for Upsert and Archive Logic
**Dependencies:** None (can run in parallel with Task Groups 1-2)

- [x] 3.0 Complete repository layer additions
  - [x] 3.1 Write 4 focused tests for new repository methods
    - Test `findByIdAndProjectId` returns entity when exists
    - Test `findByProjectIdAndTypeIn` returns filtered list
    - Test `countByProjectIdAndParentId` returns correct child count
    - Test repository methods enforce projectId scoping
  - [x] 3.2 Add new query methods to `WorkItemRepository`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/WorkItemRepository.java`
    - Add: `Optional<WorkItemEntity> findByIdAndProjectId(UUID id, String projectId)`
    - Add: `List<WorkItemEntity> findByProjectIdAndTypeIn(String projectId, Collection<String> types)`
    - Add: `long countByProjectIdAndParentId(String projectId, UUID parentId)`
  - [x] 3.3 Ensure repository tests pass
    - Run ONLY the 4 tests written in 3.1
    - Verify query methods return expected results

**Acceptance Criteria:**
- The 4 tests written in 3.1 pass
- All new methods include projectId in query for scoping safety
- Methods follow existing Spring Data JPA naming conventions
- Child count query correctly counts direct children only

---

### Service Layer

#### Task Group 4: Upsert and Archive/Delete Service Logic
**Dependencies:** Task Groups 1, 2, 3

- [x] 4.0 Complete service layer refactoring
  - [x] 4.1 Write 6 focused tests for upsert and archive/delete behavior
    - Test import succeeds when FEATURE/STORY exist (v1 block removed)
    - Test existing initiative is updated (not duplicated) on re-import
    - Test existing epic is updated (not duplicated) on re-import
    - Test removed epic with children is archived (status = "ARCHIVED")
    - Test removed epic with no children is deleted
    - Test archived item is un-archived when it reappears (status = "PLANNED")
  - [x] 4.2 Remove v1 import blocking in `RoadmapImportService`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/RoadmapImportService.java`
    - Delete or disable `checkForExistingFeaturesOrStories()` method
    - Remove call to this method in `importFromAgentOsFile()`
    - Import should proceed regardless of existing FEATURE/STORY work items
  - [x] 4.3 Implement upsert logic for INITIATIVE and EPIC
    - Replace `deleteExistingInitiativesAndEpics()` call with upsert approach
    - Load existing INITIATIVE/EPIC items for project using `findByProjectIdAndTypeIn()`
    - Build map of existing items by ID for O(1) lookup
    - For each parsed initiative: update if ID exists, insert if new
    - For each parsed epic: update if ID exists, insert if new
    - On update: modify title, description, sortOrder, updatedAt; preserve createdAt
    - On insert: set status to "PLANNED"
    - On un-archive (existing item was ARCHIVED): set status to "PLANNED"
  - [x] 4.4 Implement safe archive/delete logic for removed items
    - After upsert, identify items no longer in parsed roadmap (compare IDs)
    - Process removed EPICS first (before initiatives)
    - For each removed item: call `countByProjectIdAndParentId()` to check children
    - If children > 0: set status = "ARCHIVED", save entity
    - If children = 0: delete entity
    - Then process removed INITIATIVES with same logic
  - [x] 4.5 Update entity creation to use computed IDs
    - Modify `createInitiativeEntity()` to use `initNode.getComputedId()` instead of `UUID.randomUUID()`
    - Modify `createEpicEntity()` to use `epicNode.getComputedId()` instead of `UUID.randomUUID()`
  - [x] 4.6 Ensure service tests pass
    - Run ONLY the 6 tests written in 4.1
    - Verify upsert and archive/delete behavior

**Acceptance Criteria:**
- The 6 tests written in 4.1 pass
- Import no longer blocked by existing FEATURE/STORY items
- Re-import updates existing items rather than creating duplicates
- Removed items are safely archived when they have children
- Removed items are deleted when they have no children
- sortOrder is refreshed based on markdown appearance order

---

### Testing Layer

#### Task Group 5: Test Review and Integration Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review 4 tests from utility layer (Task 1.1)
    - Review 4 tests from parser layer (Task 2.1)
    - Review 4 tests from repository layer (Task 3.1)
    - Review 6 tests from service layer (Task 4.1)
    - Total existing tests: 18 tests
  - [x] 5.2 Analyze test coverage gaps for this feature only
    - Identify critical end-to-end workflows lacking coverage
    - Focus on integration between parser -> service -> repository
    - Prioritize multi-import scenarios with changing roadmap content
  - [x] 5.3 Write up to 6 additional integration tests if needed
    - Test full import flow: parse -> compute IDs -> upsert -> archive
    - Test initiative rename creates new ID, archives old initiative
    - Test epic moved to different initiative creates new ID, archives old epic
    - Test sortOrder updates correctly on re-import with reordered items
    - Test parent-child relationships preserved after re-import
    - Test response DTO returns correct counts after upsert operations
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, and 5.3)
    - Expected total: approximately 18-24 tests
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 18-24 tests total)
- Critical user workflows for repeatable import are covered
- No more than 6 additional integration tests added
- Testing focused exclusively on v3 import feature requirements

---

## Execution Order

Recommended implementation sequence:

```
Phase 1 (Parallel):
  - Task Group 1: Utilities (normalization + ID generation)
  - Task Group 3: Repository (new query methods)

Phase 2:
  - Task Group 2: Parser (model extensions + ID computation)
    Depends on: Task Group 1

Phase 3:
  - Task Group 4: Service (upsert + archive/delete logic)
    Depends on: Task Groups 1, 2, 3

Phase 4:
  - Task Group 5: Test Review and Integration
    Depends on: Task Groups 1-4
```

## Key File Paths

| Component | File Path |
|-----------|-----------|
| StableIdGenerator (new) | `architecture-model-service/src/main/java/com/example/architecturemodel/util/StableIdGenerator.java` |
| InitiativeNode | `architecture-model-service/src/main/java/com/example/architecturemodel/model/parser/InitiativeNode.java` |
| EpicNode | `architecture-model-service/src/main/java/com/example/architecturemodel/model/parser/EpicNode.java` |
| RoadmapParser | `architecture-model-service/src/main/java/com/example/architecturemodel/util/RoadmapParser.java` |
| WorkItemRepository | `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/WorkItemRepository.java` |
| RoadmapImportService | `architecture-model-service/src/main/java/com/example/architecturemodel/service/RoadmapImportService.java` |
| WorkItemEntity | `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/WorkItemEntity.java` |

## Test File Paths

| Test Suite | File Path |
|------------|-----------|
| StableIdGenerator tests (new) | `architecture-model-service/src/test/java/com/example/architecturemodel/util/StableIdGeneratorTest.java` |
| Parser node tests (new) | `architecture-model-service/src/test/java/com/example/architecturemodel/model/parser/RoadmapParserNodeExtensionsTest.java` |
| Repository tests (new) | `architecture-model-service/src/test/java/com/example/architecturemodel/repository/WorkItemRepositoryV3Test.java` |
| Service tests (new) | `architecture-model-service/src/test/java/com/example/architecturemodel/service/RoadmapImportServiceV3Test.java` |
| Integration tests (new) | `architecture-model-service/src/test/java/com/example/architecturemodel/service/RoadmapImportV3IntegrationTest.java` |

## Notes

- **No database migrations required:** ARCHIVED status uses existing TEXT status column
- **No endpoint changes:** POST /api/model/projects/{projectId}/roadmap/import unchanged
- **No UI changes:** Backend-only scope
- **Backward compatibility:** Parser changes maintain compatibility with existing parsing strategies
