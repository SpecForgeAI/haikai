# Specification: Fix Test Compilation After Class/Method Entity Additions

## Goal
Update test files to compile correctly after Class and Method entities were added to MetaModelEntitiesDto (now 18 parameters) and ModelService (now requires ClassRepository and MethodRepository).

## User Stories
- As a developer, I want tests to compile after the Class/Method entity additions so that I can run the test suite and verify functionality.
- As a CI/CD pipeline, I want `mvn test` to pass the compilation stage so that builds can complete successfully.

## Specific Requirements

**Update MetaModelEntitiesDto constructor calls to 18 arguments**
- The record now requires 18 list parameters in this order: businessUsers, businessProcesses, processActivities, businessPoints, applications, appComponents, services, interfaces, endpoints, classes, methods, applicationPoints, logicalDataEntities, logicalDataAttributes, physicalDataEntities, physicalDataAttributes, interactions, appBusinessPoints
- Insert `Collections.<ClassDto>emptyList()` at position 10 (after endpoints)
- Insert `Collections.<MethodDto>emptyList()` at position 11 (after classes)
- Use explicit generic types to avoid `List<Object>` inference warnings

**Add ClassRepository and MethodRepository mocks to ModelServiceLoadTest**
- Add `@Mock private ClassRepository classRepository;` field declaration
- Add `@Mock private MethodRepository methodRepository;` field declaration
- Update ModelService constructor call in setUp() to include both repositories after endpointRepository and before applicationPointRepository
- Add `when(classRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());` to setupOtherEmptyRepositoryMocks()
- Add `when(methodRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());` to setupOtherEmptyRepositoryMocks()

**Add ClassRepository and MethodRepository mocks to ModelServiceSaveTest**
- Add `@Mock private ClassRepository classRepository;` field declaration
- Add `@Mock private MethodRepository methodRepository;` field declaration
- Update ModelService constructor call in setUp() to include both repositories after endpointRepository and before applicationPointRepository

**Update ModelService constructor argument order in tests**
- Current order stops at endpointRepository then jumps to applicationPointRepository
- New order must insert classRepository, methodRepository between endpointRepository and applicationPointRepository
- Match the field declaration order in ModelService.java exactly

**Update createEmptyEntities() helper in ModelServiceSaveTest**
- Change from 16 to 18 arguments
- Insert two empty lists for classes and methods at positions 10 and 11

**Update createEntitiesWithBusinessUsers() helper in ModelServiceSaveTest**
- Change from 16 to 18 arguments
- Insert two empty lists for classes and methods at positions 10 and 11

**Update createEntitiesWithApplications() helper in ModelServiceSaveTest**
- Change from 16 to 18 arguments
- Insert two empty lists for classes and methods at positions 10 and 11

**Update createEmptyModel() helper in ModelControllerTest**
- Change MetaModelEntitiesDto construction from 16 to 18 arguments
- Insert two empty lists for classes and methods at positions 10 and 11

**Add required imports to test files**
- Add `import com.example.architecturemodel.repository.entity.ClassRepository;` to ModelServiceLoadTest and ModelServiceSaveTest
- Add `import com.example.architecturemodel.repository.entity.MethodRepository;` to ModelServiceLoadTest and ModelServiceSaveTest
- Add `import com.example.architecturemodel.model.dto.entity.ClassDto;` to all test files using MetaModelEntitiesDto
- Add `import com.example.architecturemodel.model.dto.entity.MethodDto;` to all test files using MetaModelEntitiesDto

**Verification**
- Run `mvn -q test` from architecture-model-service directory
- Confirm testCompile phase completes without errors
- Confirm all existing tests pass (no behavioral changes)

## Existing Code to Leverage

**MetaModelEntitiesDto record signature (production code)**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelEntitiesDto.java`
- Defines the exact 18-parameter constructor order that tests must match
- Parameters 10 and 11 are `List<ClassDto> classes` and `List<MethodDto> methods`

**ModelService constructor field order (production code)**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
- Uses Lombok @RequiredArgsConstructor so constructor order matches field declaration order
- Fields at lines 43-44 show `classRepository` followed by `methodRepository` positioned after `endpointRepository` and before `applicationPointRepository`

**Existing test mock patterns (test code)**
- ModelServiceLoadTest and ModelServiceSaveTest already mock 28+ repositories using @Mock annotations
- Tests use `Collections.emptyList()` for empty repository returns
- setupOtherEmptyRepositoryMocks() helper centralizes mock setup for load tests
- Pattern: declare @Mock field, add to constructor call, add when().thenReturn() stub

**ClassRepository and MethodRepository interfaces**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/`
- Both extend JpaRepository and have `findByModelFileId(String)` and `deleteByModelFileId(String)` methods
- Tests need to mock `findByModelFileId()` for load tests only (save tests use lenient mocking)

## Out of Scope
- Adding new test cases for Class or Method functionality
- Modifying production code in any way
- Adding integration tests for Class/Method entities
- Changing test assertions or expected behaviors
- Updating any files outside the three test files listed in scope
- Adding repository delete mock verifications for new repositories
- Testing Class-Method FK relationships
- Adding ClassDto or MethodDto test data fixtures
- Modifying the ModelControllerTest mock setup for ModelService
- Any refactoring of existing test helper methods beyond parameter count changes
