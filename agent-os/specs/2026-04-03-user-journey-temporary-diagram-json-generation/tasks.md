# Task Breakdown: User Journey Temporary Diagram JSON Generation

## Overview
Total Tasks: 4 task groups, ~30 sub-tasks

This feature creates a stateless projection service that deterministically generates User Journey diagram JSON from persisted USER_JOURNEY and ACTIVITY_STEP meta-model data. All work is in `architecture-model-service` (Java/Spring Boot). No gateway or frontend changes.

## Key References
- Controller pattern: `TemporaryDiagramController.java`
- Test pattern: `TemporaryDiagramControllerTest.java` (`@WebMvcTest` + `@MockBean`)
- DTO record pattern: `ActivityStepDto.java`, `SequenceDiagramDto.java`
- Entity pattern: `UserJourneyEntity.java`, `ActivityStepEntity.java`
- Repository pattern: `ActivityStepRepository.java`, `UserJourneyRepository.java`
- Deterministic sorting: `DiagramCanonicalizer.java`
- Entity mapping: `EntityMapper.java` (lines 99-133)
- Project scoping: `ModelFileRepository.findByProjectId(UUID)`
- Exception handling: `ResourceNotFoundException.java`, `GlobalExceptionHandler.java`

## Task List

### DTO Layer

#### Task Group 1: Diagram Contract v1 DTOs
**Dependencies:** None

All files created under `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/diagram/`

- [x] 1.0 Complete diagram contract v1 DTO records
  - [x] 1.1 Create `UserJourneyDiagramLaneDto` record
  - [x] 1.2 Create `UserJourneyDiagramStepDto` record
  - [x] 1.3 Create `UserJourneyDiagramEdgeDto` record
  - [x] 1.4 Create `UserJourneyDiagramRenderHintsDto` record
  - [x] 1.5 Create `UserJourneyDiagramJourneyDto` record
  - [x] 1.6 Create `UserJourneyDiagramDto` record (top-level envelope)

---

### Repository + Service Layer

#### Task Group 2: Repository Query, Projection Service, and Service Unit Tests
**Dependencies:** Task Group 1

- [x] 2.0 Complete repository query and projection service with unit tests
  - [x] 2.1 Add `findByUserJourneyId` to `ActivityStepRepository`
  - [x] 2.2 Create `UserJourneyDiagramProjectionService`
  - [x] 2.3 Write 8 focused unit tests for `UserJourneyDiagramProjectionService`
  - [x] 2.4 Ensure projection service unit tests pass

---

### Controller Layer

#### Task Group 3: REST Controller and Controller Tests
**Dependencies:** Task Group 2

- [x] 3.0 Complete REST controller and controller tests
  - [x] 3.1 Create `UserJourneyDiagramController`
  - [x] 3.2 Write 5 focused `@WebMvcTest` controller tests
  - [x] 3.3 Ensure controller tests pass

---

### Integration Testing and Regression Verification

#### Task Group 4: Integration Tests, Test Review, and Regression
**Dependencies:** Task Groups 1-3

- [x] 4.0 Complete integration testing and regression verification
  - [x] 4.1 Write lightweight Spring integration test for `findByUserJourneyId` repository query
    - File: `architecture-model-service/src/test/java/com/example/architecturemodel/repository/ActivityStepRepositoryIntegrationTest.java`
    - 2 tests: persist and query, empty result for non-existent ID
    - Both pass with @DataJpaTest and H2
  - [x] 4.2 Review existing tests from Task Groups 2-3
    - Reviewed 13 tests (8 service + 5 controller)
    - Identified 5 gaps: step-level business user enrichment, multiple journeys, duplicate sequence_order, render hints, edge ID determinism
  - [x] 4.3 Write up to 5 additional strategic tests to fill critical gaps
    - File: `architecture-model-service/src/test/java/com/example/architecturemodel/service/UserJourneyDiagramProjectionServiceAdditionalTest.java`
    - 5 gap-fill tests:
      1. Step-level business user enrichment with distinct step vs journey users
      2. projectAllJourneys with multiple journeys producing independent contracts
      3. Step ordering with duplicate sequence_order, deterministic fallback by id
      4. Render hints always correct (VERTICAL, LEFT_TO_RIGHT, true)
      5. Edge ID determinism with non-trivial sequence_order values
    - All 5 pass
  - [x] 4.4 Regression verification: confirm existing endpoints unaffected
    - TemporaryDiagramControllerTest: 2 tests pass
    - DiagramExportControllerTest: 7 tests pass
    - SequenceDiagramControllerTest: pre-existing compilation error (.bak from prior increment), not caused by this feature
    - Confirmed: only ActivityStepRepository.java was modified (1 line added), no other existing files changed
  - [x] 4.5 Run all feature-specific tests
    - Total: 20 tests, all pass
      - 8 projection service unit tests (UserJourneyDiagramProjectionServiceTest)
      - 5 gap-fill tests (UserJourneyDiagramProjectionServiceAdditionalTest)
      - 5 controller tests (UserJourneyDiagramControllerTest)
      - 2 repository integration tests (ActivityStepRepositoryIntegrationTest)

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: DTO Layer** -- Pure data records with no dependencies; enables compilation of service and controller
2. **Task Group 2: Repository + Service Layer** -- Core projection logic with unit tests; depends on DTOs from Group 1
3. **Task Group 3: Controller Layer** -- Thin REST endpoints with `@WebMvcTest` tests; depends on service from Group 2
4. **Task Group 4: Integration Testing and Regression** -- Repository integration test, gap analysis, regression verification; depends on all prior groups

## Files Created/Modified Summary

**New files (12):**
- `model/dto/diagram/UserJourneyDiagramDto.java`
- `model/dto/diagram/UserJourneyDiagramJourneyDto.java`
- `model/dto/diagram/UserJourneyDiagramLaneDto.java`
- `model/dto/diagram/UserJourneyDiagramStepDto.java`
- `model/dto/diagram/UserJourneyDiagramEdgeDto.java`
- `model/dto/diagram/UserJourneyDiagramRenderHintsDto.java`
- `service/UserJourneyDiagramProjectionService.java`
- `controller/UserJourneyDiagramController.java`
- `test/.../service/UserJourneyDiagramProjectionServiceTest.java`
- `test/.../service/UserJourneyDiagramProjectionServiceAdditionalTest.java`
- `test/.../controller/UserJourneyDiagramControllerTest.java`
- `test/.../repository/ActivityStepRepositoryIntegrationTest.java`

**Modified files (1):**
- `repository/entity/ActivityStepRepository.java` -- add `findByUserJourneyId` method

All paths relative to `architecture-model-service/src/main/java/com/example/architecturemodel/` (source) or `architecture-model-service/src/test/java/com/example/architecturemodel/` (test).
