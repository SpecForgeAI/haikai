# Task Breakdown: Implement Context Resolution - Iteration 3

## Overview
Total Tasks: 19
Estimated Complexity: Medium

This feature enables the OpenAI Planner in `implement_feature` mode to receive resolved, structured details about architecture entities and diagrams linked to the selected work item, rather than only raw IDs. This supports more grounded exploratory discussions in steps 1a-1e without generating specs.

## Execution Order

Recommended implementation sequence:
1. Backend DTOs (Task Group 1) - Foundation types needed by service and controller
2. Backend Service Layer (Task Group 2) - Core resolution logic
3. Backend Controller Layer (Task Group 3) - REST API endpoint
4. Gateway Layer (Task Group 4) - Integration and prompt injection
5. Test Review & Gap Analysis (Task Group 5) - Final verification

---

## Task List

### Backend Layer - DTOs

#### Task Group 1: Data Transfer Objects
**Dependencies:** None

- [x] 1.0 Complete backend DTO layer
  - [x] 1.1 Write 4-6 focused tests for DTO serialization
    - Test ResolvedImplementContextDto JSON serialization with snake_case
    - Test ResolvedEntitySummary fields serialize correctly
    - Test ResolvedDiagramSummary fields serialize correctly
    - Test empty lists serialize as empty arrays (not null)
    - Test relevantFields Map serialization
  - [x] 1.2 Create ResolvedEntitySummary record
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/ResolvedEntitySummary.java`
    - Fields: id (String), name (String), entityType (String), category (String), relevantFields (Map<String, Object>)
    - Add @JsonProperty annotations with snake_case: `id`, `name`, `entity_type`, `category`, `relevant_fields`
    - Category values: "application", "business", "data", "behavioural", "ui"
  - [x] 1.3 Create ResolvedDiagramSummary record
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/diagram/ResolvedDiagramSummary.java`
    - Fields: id (String), name (String), diagramType (String), referencedEntityIds (List<String>)
    - Add @JsonProperty annotations: `id`, `name`, `diagram_type`, `referenced_entity_ids`
  - [x] 1.4 Create ResolvedImplementContextDto record
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/ResolvedImplementContextDto.java`
    - Fields: resolvedEntities (List<ResolvedEntitySummary>), resolvedDiagrams (List<ResolvedDiagramSummary>)
    - Add @JsonProperty annotations: `resolved_entities`, `resolved_diagrams`
  - [x] 1.5 Create ImplementContextResolveRequestDto record
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/ImplementContextResolveRequestDto.java`
    - Fields: selectedEntityIds (List<String>), selectedDiagramIds (List<String>)
    - Add @JsonProperty annotations: `selected_entity_ids`, `selected_diagram_ids`
  - [x] 1.6 Ensure DTO tests pass
    - Run ONLY the tests written in 1.1
    - Verify JSON serialization matches snake_case conventions

**Acceptance Criteria:**
- All 4-6 DTO serialization tests pass
- DTOs use @JsonProperty with snake_case naming
- Records are immutable and follow existing DTO patterns
- Empty lists serialize as `[]` not `null`

---

### Backend Layer - Service

#### Task Group 2: Resolution Service Implementation
**Dependencies:** Task Group 1

- [x] 2.0 Complete backend service layer
  - [x] 2.1 Write 6-8 focused tests for ImplementContextResolutionService
    - Test entity ID parsing: "services::svc-123" extracts type="services", id="svc-123"
    - Test entity resolution for a known service entity returns correct summary
    - Test unknown entity type returns null (gracefully omitted)
    - Test entity ID not found returns null (gracefully omitted)
    - Test diagram resolution returns correct summary with referenced entity IDs
    - Test diagram not found returns null (gracefully omitted)
    - Test multiple entities/diagrams are resolved in batch
    - Test debug logging occurs for unresolved IDs
  - [x] 2.2 Create ImplementContextResolutionService class
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/service/ImplementContextResolutionService.java`
    - Follow patterns from WorkItemImplementContextService.java
    - Use @Service, @RequiredArgsConstructor, @Slf4j annotations
    - Inject: ModelFileRepository, all entity repositories (ServiceRepository, ClassRepository, MethodRepository, InterfaceRepository, ApplicationRepository, ApplicationComponentRepository, EndpointRepository, BusinessProcessRepository, BusinessPointRepository, LogicalDataEntityRepository, PhysicalDataEntityRepository, UIScreenRepository), DiagramRepository, DiagramNodeRepository
  - [x] 2.3 Implement parseEntityId method
    - Signature: `private EntityIdParts parseEntityId(String compositeId)`
    - Create inner record: `record EntityIdParts(String entityType, String entityId) {}`
    - Split on "::" delimiter
    - Return null for malformed IDs (no "::" or empty parts)
  - [x] 2.4 Implement resolveEntity method
    - Signature: `private ResolvedEntitySummary resolveEntity(String compositeId, String modelFileId)`
    - Parse the composite ID using parseEntityId
    - Route to appropriate repository based on entityType
    - Supported entity types mapping:
      - "services" -> ServiceRepository
      - "classes" -> ClassRepository
      - "methods" -> MethodRepository
      - "interfaces" -> InterfaceRepository
      - "applications" -> ApplicationRepository
      - "appComponents" -> ApplicationComponentRepository
      - "endpoints" -> EndpointRepository
      - "businessProcesses" -> BusinessProcessRepository
      - "businessPoints" -> BusinessPointRepository
      - "logicalDataEntities" -> LogicalDataEntityRepository
      - "physicalDataEntities" -> PhysicalDataEntityRepository
      - "uiScreens" -> UIScreenRepository
    - Query repository by ID and modelFileId
    - Build relevantFields Map based on entity type (e.g., namespace for classes, applicationId for services, domain for applications)
    - Return null for unknown types or not found; log debug message
  - [x] 2.5 Implement resolveDiagram method
    - Signature: `private ResolvedDiagramSummary resolveDiagram(String diagramId, String modelFileId)`
    - Query DiagramRepository.findByIdAndModelFileId(diagramId, modelFileId)
    - Query DiagramNodeRepository.findByDiagramId(diagramId) to collect referenced entity IDs
    - Extract entityId field from each DiagramNodeEntity, filter nulls
    - Build ResolvedDiagramSummary with diagramType and referencedEntityIds
    - Return null if diagram not found; log debug message
  - [x] 2.6 Implement resolveContext public method
    - Signature: `@Transactional(readOnly = true) public ResolvedImplementContextDto resolveContext(String projectId, List<String> selectedEntityIds, List<String> selectedDiagramIds)`
    - Look up ModelFileEntity by projectId (filename) to get modelFileId
    - Throw ResourceNotFoundException if project/model file not found
    - Map selectedEntityIds through resolveEntity, filter nulls
    - Map selectedDiagramIds through resolveDiagram, filter nulls
    - Return ResolvedImplementContextDto with resolved lists
  - [x] 2.7 Ensure service layer tests pass
    - Run ONLY the 6-8 tests written in 2.1
    - Verify entity routing logic works for all supported types
    - Verify graceful handling of unknown types and missing entities

**Acceptance Criteria:**
- All 6-8 service tests pass
- Entity ID parsing correctly splits "entityType::entityId" format
- All 12 entity types are routable to their repositories
- Diagrams are resolved with their referenced entity IDs extracted from nodes
- Unresolved IDs are omitted gracefully with debug logging
- Service follows @Transactional(readOnly = true) pattern

---

### Backend Layer - Controller

#### Task Group 3: REST Controller Implementation
**Dependencies:** Task Group 2

- [x] 3.0 Complete backend controller layer
  - [x] 3.1 Write 4-6 focused tests for ImplementContextResolutionController
    - Test POST /api/projects/{projectId}/implement-context/resolve returns 200 with valid request
    - Test empty entity/diagram lists return empty resolved lists
    - Test missing projectId returns 400 Bad Request
    - Test non-existent projectId returns 404 Not Found
    - Test request body validation (null body returns 400)
  - [x] 3.2 Create ImplementContextResolutionController class
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ImplementContextResolutionController.java`
    - Follow patterns from WorkItemImplementContextController.java
    - Use @RestController, @RequestMapping("/api/projects/{projectId}/implement-context"), @RequiredArgsConstructor, @Slf4j annotations
    - Inject: ImplementContextResolutionService
  - [x] 3.3 Implement POST /resolve endpoint
    - Annotation: @PostMapping("/resolve")
    - Path variable: @PathVariable String projectId
    - Request body: @RequestBody ImplementContextResolveRequestDto request
    - Return: ResponseEntity<ResolvedImplementContextDto>
    - Validation: projectId not blank (throw IllegalArgumentException)
    - Validation: request not null (throw IllegalArgumentException)
    - Call service.resolveContext(projectId, request.selectedEntityIds(), request.selectedDiagramIds())
    - Return ResponseEntity.ok(result)
  - [x] 3.4 Add logging and error handling
    - Log debug: "POST /api/projects/{projectId}/implement-context/resolve"
    - ResourceNotFoundException from service will be handled by GlobalExceptionHandler (404)
    - IllegalArgumentException for validation will return 400 via GlobalExceptionHandler
  - [x] 3.5 Ensure controller tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify endpoint responds correctly to valid and invalid inputs

**Acceptance Criteria:**
- All 4-6 controller tests pass
- POST endpoint is accessible at /api/projects/{projectId}/implement-context/resolve
- Valid requests return 200 with ResolvedImplementContextDto
- Invalid projectId returns 400
- Non-existent projectId returns 404
- Response uses snake_case JSON field names

---

### Gateway Layer

#### Task Group 4: Gateway Integration
**Dependencies:** Task Group 3

- [x] 4.0 Complete gateway integration layer
  - [x] 4.1 Write 4-6 focused tests for gateway context resolution
    - Test resolveImplementContext function calls backend API correctly
    - Test resolveImplementContext returns null on HTTP error (graceful fallback)
    - Test buildImplementPlannerPrompt includes resolved context when provided
    - Test buildImplementPlannerPrompt works without resolved context (fallback)
    - Test chat.ts calls resolution when mode is 'implement_feature'
    - Test chat.ts proceeds without resolution on API failure
  - [x] 4.2 Add architectureModelServiceBaseUrl to gateway config
    - Location: `gateway/src/config.ts`
    - Add to Config interface: `architectureModelServiceBaseUrl: string`
    - Add to loadConfig: `architectureModelServiceBaseUrl: process.env.ARCHITECTURE_MODEL_SERVICE_URL || 'http://localhost:8080'`
  - [x] 4.3 Create ResolvedImplementContext types in gateway
    - Location: `gateway/src/types/chat.ts`
    - Add interface ResolvedEntitySummary: id, name, entityType, category, relevantFields
    - Add interface ResolvedDiagramSummary: id, name, diagramType, referencedEntityIds
    - Add interface ResolvedImplementContextDto: resolvedEntities, resolvedDiagrams
    - Export from `gateway/src/types/index.ts`
  - [x] 4.4 Create resolveImplementContext API client function
    - Location: `gateway/src/services/architectureModelClient.ts` (new file)
    - Function signature: `async function resolveImplementContext(projectId: string, entityIds: string[], diagramIds: string[]): Promise<ResolvedImplementContextDto | null>`
    - Use fetch to POST to `${config.architectureModelServiceBaseUrl}/api/projects/${projectId}/implement-context/resolve`
    - Request body: `{ selected_entity_ids: entityIds, selected_diagram_ids: diagramIds }`
    - On success: parse JSON response and return typed DTO
    - On error: log warning, return null (graceful fallback)
    - Export from `gateway/src/services/index.ts`
  - [x] 4.5 Update buildImplementPlannerPrompt to accept resolved context
    - Location: `gateway/src/services/promptBuilder.ts`
    - Update function signature: `function buildImplementPlannerPrompt(context: ChatContext, resolvedContext?: ResolvedImplementContextDto | null): string`
    - Add new section to IMPLEMENT_PLANNER_PROMPT_TEMPLATE after "LINKED ARCHITECTURE CONTEXT":
      ```
      RESOLVED ARCHITECTURE CONTEXT:
      {resolvedContext}
      ```
    - Format resolvedContext as compact JSON if present, else "No resolved context available"
    - Add two new rules to RULES section:
      - "Reference entities by their names from the resolved context, not by raw IDs"
      - "Do not invent entities or capabilities that are not present in the resolved context"
  - [x] 4.6 Update chat.ts to call resolution before building prompt
    - Location: `gateway/src/routes/chat.ts`
    - In POST /api/chat handler, after `shouldBypassToolExecution(context)` check:
    - If context.mode === 'implement_feature' and context has architectureContext:
      - Extract projectId from context.filename
      - Call resolveImplementContext(projectId, context.architectureContext.entityIds, context.architectureContext.diagramIds)
      - Store result in local variable `resolvedContext`
    - Pass resolvedContext to buildSystemPrompt (update buildSystemPrompt to forward it)
    - Handle errors gracefully: if resolution fails, proceed with null resolvedContext
  - [x] 4.7 Update buildSystemPrompt to forward resolved context
    - Update buildSystemPrompt signature to accept optional resolvedContext parameter
    - Pass resolvedContext to buildImplementPlannerPrompt when mode is 'implement_feature'
  - [x] 4.8 Ensure gateway tests pass
    - Run ONLY the 4-6 tests written in 4.1
    - Verify API client correctly calls backend
    - Verify prompt builder includes resolved context
    - Verify chat route integrates resolution

**Acceptance Criteria:**
- All 4-6 gateway tests pass
- Gateway calls backend resolution API when mode is 'implement_feature'
- Resolved context is injected into system prompt as JSON
- API failures are handled gracefully (fallback to raw IDs)
- New config value for architecture-model-service URL is added
- System prompt includes rules about using entity names from resolved context

---

### Testing

#### Task Group 5: Test Review & Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review 4-6 DTO serialization tests (Task 1.1)
    - Review 6-8 service tests (Task 2.1)
    - Review 4-6 controller tests (Task 3.1)
    - Review 4-6 gateway tests (Task 4.1)
    - Total existing tests: approximately 18-26 tests
  - [x] 5.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows that lack coverage
    - Focus on integration between gateway and backend
    - Check edge cases: malformed entity IDs, mixed valid/invalid IDs
    - Verify error propagation from backend to gateway
  - [x] 5.3 Write up to 8 additional strategic tests maximum
    - Integration test: full resolution flow from gateway to backend and back
    - Integration test: gateway prompt includes resolved entity names
    - Edge case: entity ID with multiple "::" delimiters
    - Edge case: empty projectId in request
    - Edge case: resolution with only diagrams (no entities)
    - Edge case: resolution with only entities (no diagrams)
    - Verify category assignment is correct for each entity type
    - Verify relevantFields extraction for key entity types
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature
    - Expected total: approximately 26-34 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 26-34 tests total)
- Critical integration between gateway and backend is tested
- Edge cases for malformed inputs are covered
- No more than 8 additional tests added when filling gaps
- Testing focused exclusively on this spec's feature requirements

---

## File Summary

### New Files to Create

**Backend (architecture-model-service):**
- `src/main/java/com/example/architecturemodel/model/dto/entity/ResolvedEntitySummary.java`
- `src/main/java/com/example/architecturemodel/model/dto/diagram/ResolvedDiagramSummary.java`
- `src/main/java/com/example/architecturemodel/model/dto/ResolvedImplementContextDto.java`
- `src/main/java/com/example/architecturemodel/model/dto/ImplementContextResolveRequestDto.java`
- `src/main/java/com/example/architecturemodel/service/ImplementContextResolutionService.java`
- `src/main/java/com/example/architecturemodel/controller/ImplementContextResolutionController.java`

**Gateway:**
- `src/services/architectureModelClient.ts`

### Files to Modify

**Gateway:**
- `src/config.ts` - Add architectureModelServiceBaseUrl
- `src/types/chat.ts` - Add ResolvedImplementContext types
- `src/types/index.ts` - Export new types
- `src/services/promptBuilder.ts` - Update buildImplementPlannerPrompt
- `src/services/index.ts` - Export architectureModelClient
- `src/routes/chat.ts` - Add resolution call in implement_feature mode

---

## Entity Type to Category Mapping

For reference in Task 2.4:

| Entity Type | Category | Relevant Fields to Extract |
|-------------|----------|---------------------------|
| services | application | applicationId, namespace |
| classes | application | namespace, serviceId |
| methods | application | classId, visibility |
| interfaces | application | applicationId |
| applications | application | domain, type |
| appComponents | application | applicationId |
| endpoints | application | interfaceId, httpMethod, path |
| businessProcesses | business | domain |
| businessPoints | business | processId |
| logicalDataEntities | data | domain |
| physicalDataEntities | data | database, schema |
| uiScreens | ui | applicationId, screenType |

---

## Notes

- The resolution is read-only and does not persist any data
- All unresolved IDs are silently omitted from the response with debug logging
- The gateway should gracefully fall back to raw IDs if the resolution API fails
- Snake_case JSON naming is required for API consistency with frontend expectations
