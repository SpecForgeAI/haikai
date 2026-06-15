# Task Breakdown: Roadmap Import v1

## Overview
Total Tasks: 23

This task breakdown implements a backend feature to import roadmap.md files from disk, store them as versioned artifacts, and parse initiatives/epics into work items. The feature supports Format A (heading-based epics) and Format B/C (list-based epics) markdown structures.

## Task List

### Configuration Layer

#### Task Group 1: Application Configuration
**Dependencies:** None

- [x] 1.0 Complete configuration layer
  - [x] 1.1 Write 3 focused tests for configuration injection
    - Test that `app.projectRootDir` property is injected correctly
    - Test default value fallback when property is not set
    - Test path resolution with configured value
  - [x] 1.2 Add configuration property to `application.yml`
    - File: `architecture-model-service/src/main/resources/application.yml`
    - Property: `app.projectRootDir` with default value `.`
    - Map to environment variable: `APP_PROJECT_ROOT_DIR`
  - [x] 1.3 Ensure configuration tests pass
    - Run ONLY the 3 tests written in 1.1
    - Verify property injection works with default and custom values

**Acceptance Criteria:**
- The 3 tests written in 1.1 pass
- Property `app.projectRootDir` is configurable via environment variable
- Default value of `.` (current directory) works for development

---

### Repository Layer

#### Task Group 2: WorkItemRepository Extensions
**Dependencies:** Task Group 1

- [x] 2.0 Complete repository layer extensions
  - [x] 2.1 Write 4 focused tests for new repository methods
    - Test `countByProjectIdAndTypeIn()` returns correct count for FEATURE/STORY types
    - Test `countByProjectIdAndTypeIn()` returns 0 when no matching types exist
    - Test `deleteByProjectIdAndTypeIn()` removes only specified types
    - Test `deleteByProjectIdAndTypeIn()` leaves unspecified types intact
  - [x] 2.2 Add `countByProjectIdAndTypeIn` method to WorkItemRepository
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/WorkItemRepository.java`
    - Signature: `long countByProjectIdAndTypeIn(String projectId, Collection<String> types)`
    - Spring Data JPA derived query method
  - [x] 2.3 Add `deleteByProjectIdAndTypeIn` method to WorkItemRepository
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/WorkItemRepository.java`
    - Signature: `void deleteByProjectIdAndTypeIn(String projectId, Collection<String> types)`
    - Spring Data JPA derived query method
  - [x] 2.4 Ensure repository tests pass
    - Run ONLY the 4 tests written in 2.1
    - Verify query methods execute correctly

**Acceptance Criteria:**
- The 4 tests written in 2.1 pass
- Count method correctly counts work items by project and type list
- Delete method correctly removes work items by project and type list
- Existing repository methods remain unaffected

---

### Parsing Layer

#### Task Group 3: Roadmap Markdown Parser
**Dependencies:** None (can run in parallel with Task Groups 1-2)

- [x] 3.0 Complete markdown parsing layer
  - [x] 3.1 Write 8 focused tests for RoadmapParser
    - Test Format A: initiatives from `## ` headings, epics from `### ` headings
    - Test Format A: epic description collects content until next heading
    - Test Format B/C: epics from unordered list items (`- ` or `* `)
    - Test Format B/C: epics from ordered list items (`1. `, `2. `)
    - Test checkbox stripping (`[ ]` and `[x]`) from epic titles
    - Test prefix stripping (`Epic:` and `EPIC:`) case-insensitive
    - Test format precedence (Format A when `### ` exists, else Format B/C)
    - Test initiative with zero epics is still created
  - [x] 3.2 Create InitiativeNode intermediate model class
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/parser/InitiativeNode.java`
    - Fields: `String title`, `int sortOrder`, `List<EpicNode> epics`
    - Lombok `@Data` and `@Builder` annotations
  - [x] 3.3 Create EpicNode intermediate model class
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/parser/EpicNode.java`
    - Fields: `String title`, `String description`, `int sortOrder`
    - Lombok `@Data` and `@Builder` annotations
  - [x] 3.4 Create RoadmapParser utility class
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/util/RoadmapParser.java`
    - Method: `List<InitiativeNode> parse(String markdownContent)`
    - Implement Format A detection and parsing
    - Implement Format B/C detection and parsing
    - Implement format precedence logic
  - [x] 3.5 Implement title sanitization in parser
    - Strip checkbox syntax `[ ]` and `[x]` from epic titles
    - Strip prefix `Epic:` or `EPIC:` (case-insensitive) from epic titles
    - Trim whitespace after stripping
  - [x] 3.6 Ensure parser tests pass
    - Run ONLY the 8 tests written in 3.1
    - Verify all parsing scenarios work correctly

**Acceptance Criteria:**
- The 8 tests written in 3.1 pass
- Parser correctly handles Format A (heading-based epics)
- Parser correctly handles Format B/C (list-based epics)
- Format precedence logic works correctly
- Title sanitization removes checkboxes and prefixes

---

### Service Layer

#### Task Group 4: RoadmapImportService
**Dependencies:** Task Groups 1, 2, 3

- [x] 4.0 Complete import service layer
  - [x] 4.1 Write 6 focused tests for RoadmapImportService
    - Test successful import creates artifact with correct revision
    - Test successful import creates initiatives with correct sort order
    - Test successful import creates epics linked to parent initiatives
    - Test import throws ResourceNotFoundException when file not found
    - Test import throws ConflictException when FEATURE/STORY work items exist
    - Test import replaces existing INITIATIVE/EPIC work items
  - [x] 4.2 Create RoadmapImportResultDto response class
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/roadmap/RoadmapImportResultDto.java`
    - Fields: `String projectId`, `Integer artifactRevision`, `Integer initiativesCreated`, `Integer epicsCreated`
    - Record class pattern
  - [x] 4.3 Create RoadmapImportService class
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/RoadmapImportService.java`
    - Inject: `WorkItemRepository`, `ProjectArtifactService`, `RoadmapParser`
    - Inject: `@Value("${app.projectRootDir:}")` for path configuration
    - Follow pattern from `OasSpecService` for `@Value` injection
  - [x] 4.4 Implement file reading logic
    - Resolve path: `{projectRootDir}/agent-os/product/roadmap.md`
    - Read file using `Files.readString()` with UTF-8 encoding
    - Throw `ResourceNotFoundException` if file not found
    - Log resolved path for debugging
  - [x] 4.5 Implement safety check for existing features/stories
    - Use `workItemRepository.countByProjectIdAndTypeIn(projectId, List.of("FEATURE", "STORY"))`
    - Throw `ConflictException` (409) if count > 0
    - Include descriptive message explaining v1 limitation
  - [x] 4.6 Implement replace strategy for initiatives/epics
    - Delete existing: `workItemRepository.deleteByProjectIdAndTypeIn(projectId, List.of("INITIATIVE", "EPIC"))`
    - Parse markdown using `RoadmapParser.parse()`
    - Persist initiatives with type=INITIATIVE, parent_id=null, status=PLANNED
    - Persist epics with type=EPIC, parent_id=initiative.id, status=PLANNED
  - [x] 4.7 Implement artifact storage
    - Use `ProjectArtifactService.createArtifact()` to store raw content
    - Artifact type: `ROADMAP_MD`
    - Source: `AGENT_OS`
    - Auto-incrementing revision handled by existing service
  - [x] 4.8 Ensure service tests pass
    - Run ONLY the 6 tests written in 4.1
    - Verify all import scenarios work correctly

**Acceptance Criteria:**
- The 6 tests written in 4.1 pass
- File reading works with configurable project root
- Safety check prevents import when FEATURE/STORY exist
- Replace strategy clears old initiatives/epics before import
- Artifact is versioned correctly
- Work items are created with correct parent relationships

---

### Controller Layer

#### Task Group 5: RoadmapImportController
**Dependencies:** Task Group 4

- [x] 5.0 Complete controller layer
  - [x] 5.1 Write 5 focused tests for RoadmapImportController
    - Test POST returns 200 with correct JSON response on success
    - Test POST returns 404 when roadmap.md not found
    - Test POST returns 400 for parse failures
    - Test POST returns 409 when features/stories exist
    - Test POST returns 500 for unexpected IO errors
  - [x] 5.2 Create RoadmapImportController class
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/RoadmapImportController.java`
    - Endpoint: `POST /api/model/projects/{projectId}/roadmap/import`
    - Inject: `RoadmapImportService`
    - Return: `RoadmapImportResultDto` as JSON
  - [x] 5.3 Implement exception handling
    - Map `ResourceNotFoundException` to 404 Not Found
    - Map `IllegalArgumentException` to 400 Bad Request
    - Map `ConflictException` to 409 Conflict
    - Map `RuntimeException` (IO errors) to 500 Internal Server Error
  - [x] 5.4 Ensure controller tests pass
    - Run ONLY the 5 tests written in 5.1
    - Verify all HTTP status codes are correct

**Acceptance Criteria:**
- The 5 tests written in 5.1 pass
- Endpoint path matches specification
- All error codes map correctly
- Success response includes all required fields

---

### Testing Layer

#### Task Group 6: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical gaps only
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review 3 configuration tests from Task 1.1
    - Review 4 repository tests from Task 2.1
    - Review 8 parser tests from Task 3.1
    - Review 6 service tests from Task 4.1
    - Review 5 controller tests from Task 5.1
    - Total existing tests: 26 tests
  - [x] 6.2 Analyze test coverage gaps for this feature only
    - Identify critical end-to-end workflows lacking coverage
    - Focus ONLY on gaps related to roadmap import feature
    - Prioritize integration scenarios over unit test gaps
  - [x] 6.3 Write up to 5 additional integration tests if needed
    - Integration test: full import flow from file to database
    - Integration test: re-import updates artifacts and work items
    - Integration test: Format A parsing end-to-end
    - Integration test: Format B/C parsing end-to-end
    - Integration test: mixed content file with edge cases
    - File: `architecture-model-service/src/test/java/com/example/architecturemodel/integration/RoadmapImportIntegrationTest.java`
    - Use `@TempDir` for file system operations
  - [x] 6.4 Run feature-specific tests only
    - Run ONLY tests related to roadmap import feature
    - Expected total: approximately 26-31 tests
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 26-31 tests total)
- Critical end-to-end import workflows are covered
- No more than 5 additional tests added when filling gaps
- Testing focused exclusively on roadmap import feature

---

## Execution Order

Recommended implementation sequence:

```
Phase 1: Foundation (can run in parallel)
  - Task Group 1: Configuration Layer
  - Task Group 2: Repository Layer
  - Task Group 3: Parsing Layer

Phase 2: Core Logic
  - Task Group 4: Service Layer (depends on 1, 2, 3)

Phase 3: API Surface
  - Task Group 5: Controller Layer (depends on 4)

Phase 4: Quality Assurance
  - Task Group 6: Test Review & Gap Analysis (depends on 1-5)
```

## File Reference

### New Files to Create
| File Path | Task |
|-----------|------|
| `src/main/java/com/example/architecturemodel/model/parser/InitiativeNode.java` | 3.2 |
| `src/main/java/com/example/architecturemodel/model/parser/EpicNode.java` | 3.3 |
| `src/main/java/com/example/architecturemodel/util/RoadmapParser.java` | 3.4 |
| `src/main/java/com/example/architecturemodel/model/dto/roadmap/RoadmapImportResultDto.java` | 4.2 |
| `src/main/java/com/example/architecturemodel/service/RoadmapImportService.java` | 4.3 |
| `src/main/java/com/example/architecturemodel/controller/RoadmapImportController.java` | 5.2 |
| `src/test/java/com/example/architecturemodel/util/RoadmapParserTest.java` | 3.1 |
| `src/test/java/com/example/architecturemodel/service/RoadmapImportServiceTest.java` | 4.1 |
| `src/test/java/com/example/architecturemodel/controller/RoadmapImportControllerTest.java` | 5.1 |
| `src/test/java/com/example/architecturemodel/integration/RoadmapImportIntegrationTest.java` | 6.3 |

### Existing Files to Modify
| File Path | Task |
|-----------|------|
| `src/main/resources/application.yml` | 1.2 |
| `src/main/java/com/example/architecturemodel/repository/entity/WorkItemRepository.java` | 2.2, 2.3 |

## Notes

- All file paths are relative to `architecture-model-service/`
- Follow existing patterns from `OasSpecService` for `@Value` injection
- Follow existing patterns from `WorkItemService` for repository interaction
- Follow existing patterns from `ProjectArtifactService` for artifact versioning
- Use `ResourceNotFoundException` for 404 responses
- Create new `ConflictException` class if not exists, or use Spring's `ResponseStatusException` with 409 status
- Use Lombok annotations (`@Data`, `@Builder`, `@RequiredArgsConstructor`) consistent with codebase
