---
title: Fix architecture-model-service testCompile after adding Class/Method (update tests for new DTO + ModelService constructor)

intent:
  - Resolve Maven testCompile failures introduced by Spec #1 (Class/Method) by updating test code to match:
    1) MetaModelEntitiesDto record constructor signature (now includes ClassDto + MethodDto)
    2) ModelService constructor signature (now requires ClassRepository + MethodRepository)
  - Keep changes isolated to tests (no production logic changes).

scope:
  in:
    - src/test/java/com/example/architecturemodel/controller/ModelControllerTest.java
    - src/test/java/com/example/architecturemodel/service/ModelServiceLoadTest.java
    - src/test/java/com/example/architecturemodel/service/ModelServiceSaveTest.java
  out:
    - any production code changes
    - any new features beyond test updates

background_observation:
  - The compilation errors show MetaModelEntitiesDto now requires 18 lists including:
      ... EndpointDto,
      ClassDto, MethodDto,
      ApplicationPointDto,
      LogicalDataEntityDto, LogicalDataAttributeDto,
      PhysicalDataEntityDto, PhysicalDataAttributeDto,
      InteractionDto, AppBusinessPointDto
  - The compilation errors show ModelService now requires additional constructor params:
      ... EndpointRepository,
      ClassRepository, MethodRepository,
      ApplicationPointRepository,
      ...
  - Current tests still construct MetaModelEntitiesDto with only 16 args and instantiate ModelService without the new repos.

acceptance_criteria:
  - `mvn test` (or `mvn -q test`) passes compilation stage (testCompile) successfully.
  - No runtime behaviour expectations are changed; only test wiring/constructors updated.
  - Tests use typed empty lists for MetaModelEntitiesDto construction to avoid raw List<Object> inference.

implementation_steps:

  1) Update ModelControllerTest MetaModelEntitiesDto construction
    file: src/test/java/com/example/architecturemodel/controller/ModelControllerTest.java
    change:
      - In createEmptyModel(), update MetaModelEntitiesDto constructor call to supply ALL required parameters
      - Provide empty lists with explicit generic types to avoid `List<Object>` inference.

  2) Update ModelServiceLoadTest to mock new repositories and pass them into ModelService constructor
    file: src/test/java/com/example/architecturemodel/service/ModelServiceLoadTest.java
    changes:
      - Add new @Mock fields for ClassRepository and MethodRepository
      - Update setUp() ModelService constructor invocation
      - Update setupEmptyRepositoryMocks helper to include new repos

  3) Update ModelServiceSaveTest to mock new repositories and pass them into ModelService constructor
    file: src/test/java/com/example/architecturemodel/service/ModelServiceSaveTest.java
    changes:
      - Add new @Mock fields for ClassRepository and MethodRepository
      - Update setUp() ModelService constructor invocation
      - Update helper methods for delete/insert calls

  4) Update MetaModelEntitiesDto constructions in ModelServiceSaveTest
    - Replace old MetaModelEntitiesDto constructor calls (16 args) with new (18 args)

  5) Sanity check imports in tests
    - Ensure tests import ClassDto, MethodDto, ClassRepository, MethodRepository

verification:
  - Run: mvn -q test
  - Confirm testCompile passes and containers start

deliverable:
  - Updated tests compile and run after Spec #1 additions, unblocking `docker compose up`.
---
