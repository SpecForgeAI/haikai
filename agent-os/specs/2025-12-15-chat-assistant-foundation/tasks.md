# Task Breakdown: Chat Assistant Foundation

## Overview
Total Tasks: 36 (across 5 task groups)

This task breakdown covers:
- Part A: Two new read-only API endpoints on the existing `architecture-model-service` (Spring Boot)
- Part B: A new MCP Server in Node.js/TypeScript

## Task List

### Backend Layer (Part A)

#### Task Group 1: Interface Discovery DTOs
**Dependencies:** None

- [x] 1.0 Complete Interface Discovery DTOs
  - [x] 1.1 Write 4 focused tests for DTO serialization
    - Test InterfaceSummaryDto JSON serialization
    - Test InterfaceOasContextDto JSON serialization with nested objects
    - Test null handling for optional fields
    - Test deterministic ordering in collections
  - [x] 1.2 Create InterfaceSummaryDto
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/interface_discovery/InterfaceSummaryDto.java`
    - Fields: interfaceId, interfaceName, interfaceType, serviceId (nullable), serviceName (nullable), applicationId (nullable), applicationName (nullable), endpointCount
    - Follow existing record pattern from `model/dto/entity/` package
  - [x] 1.3 Create InterfaceDetailDto
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/interface_discovery/InterfaceDetailDto.java`
    - Fields: id, name, description (nullable), interfaceType (nullable), specLink (nullable), tags (nullable), validFrom (nullable), validTo (nullable)
  - [x] 1.4 Create InterfaceEndpointDto
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/interface_discovery/InterfaceEndpointDto.java`
    - Fields: id, name, description, endpointType, pathOrAddress, protocol, operationVerb, direction, lifecycleStatus, version, tags, validFrom, validTo (all nullable except id, name)
  - [x] 1.5 Create ServiceDetailDto
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/interface_discovery/ServiceDetailDto.java`
    - Fields: id, name, description (nullable), serviceType (nullable), tags (nullable)
  - [x] 1.6 Create ApplicationDetailDto
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/interface_discovery/ApplicationDetailDto.java`
    - Fields: id, name, description (nullable), appType (nullable), status (nullable), tags (nullable)
  - [x] 1.7 Create LogicalAttributeDto
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/interface_discovery/LogicalAttributeDto.java`
    - Fields: id, name, description (nullable), dataType (nullable), isPrimaryKey (nullable), isNullable (nullable), tags (nullable)
  - [x] 1.8 Create LogicalEntitySchemaDto
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/interface_discovery/LogicalEntitySchemaDto.java`
    - Fields: id, name, description (nullable), tags (nullable), validFrom (nullable), validTo (nullable), attributes (List<LogicalAttributeDto>)
  - [x] 1.9 Create OasNotesDto
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/interface_discovery/OasNotesDto.java`
    - Fields: basePathCandidates (List<String>), serverUrlCandidates (List<String>)
  - [x] 1.10 Create InterfaceOasContextDto
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/interface_discovery/InterfaceOasContextDto.java`
    - Fields: interfaceInfo (InterfaceDetailDto), service (nullable), application (nullable), endpoints (List), logicalEntities (List), notes (nullable)
    - Add @JsonProperty("interface") annotation for interfaceInfo field
  - [x] 1.11 Ensure DTO tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify JSON serialization works correctly

**Acceptance Criteria:**
- All 10 DTO records compile successfully
- JSON serialization produces expected output
- Nullable fields handled correctly
- @JsonProperty annotation correctly maps "interfaceInfo" to "interface" in JSON

**Files to Create:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/interface_discovery/InterfaceSummaryDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/interface_discovery/InterfaceDetailDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/interface_discovery/InterfaceEndpointDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/interface_discovery/ServiceDetailDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/interface_discovery/ApplicationDetailDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/interface_discovery/LogicalAttributeDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/interface_discovery/LogicalEntitySchemaDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/interface_discovery/OasNotesDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/interface_discovery/InterfaceOasContextDto.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/dto/InterfaceDiscoveryDtoTest.java`

---

#### Task Group 2: Interface Discovery Service Layer
**Dependencies:** Task Group 1

- [x] 2.0 Complete Interface Discovery Service
  - [x] 2.1 Write 6 focused tests for InterfaceDiscoveryService
    - Test listInterfaces returns correct interface summaries for a filename
    - Test listInterfaces throws ResourceNotFoundException for unknown filename
    - Test getInterfaceOasContext returns full context for valid interface ID
    - Test getInterfaceOasContext throws ResourceNotFoundException for unknown ID
    - Test endpoint sorting by (operationVerb, pathOrAddress, name, id)
    - Test logicalEntities and attributes sorting by (name, id)
  - [x] 2.2 Add repository query methods for interface lookup
    - **File to Modify:** `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/EndpointRepository.java`
    - Add: `List<EndpointEntity> findByInterfaceId(String interfaceId);`
  - [x] 2.3 Add repository query method for interface-logical-entity lookup
    - **File to Modify:** `architecture-model-service/src/main/java/com/example/architecturemodel/repository/relationship/InterfaceLogicalEntityRepository.java`
    - Add: `List<InterfaceLogicalEntityEntity> findByInterfaceId(String interfaceId);`
  - [x] 2.4 Add repository query method for logical attributes lookup
    - **File to Modify:** `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/LogicalDataAttributeRepository.java`
    - Add: `List<LogicalDataAttributeEntity> findByLogicalEntityId(String logicalEntityId);`
  - [x] 2.5 Create InterfaceDiscoveryService
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/InterfaceDiscoveryService.java`
    - Inject: ModelFileRepository, InterfaceRepository, ServiceRepository, ApplicationRepository, EndpointRepository, InterfaceLogicalEntityRepository, LogicalDataEntityRepository, LogicalDataAttributeRepository
    - Method: `List<InterfaceSummaryDto> listInterfaces(String filename)`
      - Look up modelFileId by filename (throw 404 if not found)
      - Query interfaces by modelFileId
      - For each interface: join to service (via serviceId), join service to application (via applicationId)
      - Count endpoints per interface
      - Return sorted list of InterfaceSummaryDto
    - Method: `InterfaceOasContextDto getInterfaceOasContext(String interfaceId)`
      - Query interface by ID globally (throw 404 if not found)
      - Load service by serviceId (nullable)
      - Load application by service.applicationId (nullable)
      - Load endpoints by interfaceId, sorted by (operationVerb, pathOrAddress, name, id)
      - Load linked logical entities via InterfaceLogicalEntity join table
      - For each logical entity, load attributes sorted by (name, id)
      - Sort logical entities by (name, id)
      - Return InterfaceOasContextDto with notes = null (v1)
  - [x] 2.6 Ensure service layer tests pass
    - Run ONLY the 6 tests written in 2.1
    - Verify all query methods work correctly

**Acceptance Criteria:**
- All 6 service tests pass
- Repository methods correctly query by interfaceId and logicalEntityId
- Sorting is deterministic per spec requirements
- ResourceNotFoundException thrown for missing filename or interfaceId

**Files to Create:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/InterfaceDiscoveryService.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/service/InterfaceDiscoveryServiceTest.java`

**Files to Modify:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/EndpointRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/relationship/InterfaceLogicalEntityRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/LogicalDataAttributeRepository.java`

---

#### Task Group 3: Interface Discovery Controller (API Endpoints)
**Dependencies:** Task Group 2

- [x] 3.0 Complete Interface Discovery Controller
  - [x] 3.1 Write 6 focused tests for ModelInterfacesController
    - Test GET /api/model/interfaces?filename=valid returns 200 with interface list
    - Test GET /api/model/interfaces without filename returns 400
    - Test GET /api/model/interfaces?filename=unknown returns 404
    - Test GET /api/model/interfaces/{id} with valid ID returns 200 with full context
    - Test GET /api/model/interfaces/{id} with unknown ID returns 404
    - Test GET /api/model/interfaces/{id} with blank ID returns 400
  - [x] 3.2 Create ModelInterfacesController
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ModelInterfacesController.java`
    - @RestController with @RequestMapping("/api/model/interfaces")
    - Use @RequiredArgsConstructor and @Slf4j (following ModelController pattern)
    - Inject InterfaceDiscoveryService
  - [x] 3.3 Implement GET /api/model/interfaces endpoint
    - @GetMapping (maps to /api/model/interfaces)
    - @RequestParam filename (required)
    - Validate filename not blank -> return 400 if blank
    - Call interfaceDiscoveryService.listInterfaces(filename)
    - Return ResponseEntity.ok(result)
    - Let GlobalExceptionHandler handle ResourceNotFoundException -> 404
  - [x] 3.4 Implement GET /api/model/interfaces/{id} endpoint
    - @GetMapping("/{id}")
    - @PathVariable id
    - Validate id not blank -> return 400 if blank
    - Call interfaceDiscoveryService.getInterfaceOasContext(id)
    - Return ResponseEntity.ok(result)
    - Let GlobalExceptionHandler handle ResourceNotFoundException -> 404
  - [x] 3.5 Ensure controller tests pass
    - Run ONLY the 6 tests written in 3.1
    - Verify all HTTP status codes correct

**Acceptance Criteria:**
- All 6 controller tests pass
- GET /api/model/interfaces?filename=X returns interface list or appropriate error
- GET /api/model/interfaces/{id} returns full OAS context or appropriate error
- Error handling follows existing GlobalExceptionHandler pattern

**Files to Create:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ModelInterfacesController.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/controller/ModelInterfacesControllerTest.java`

---

### MCP Server Layer (Part B)

#### Task Group 4: MCP Server Infrastructure
**Dependencies:** None (can run in parallel with Task Groups 1-3)

- [x] 4.0 Complete MCP Server Project Setup
  - [x] 4.1 Write 4 focused tests for core infrastructure
    - Test config loads environment variables correctly
    - Test sessionManager creates new session on first access
    - Test sessionManager expires sessions after TTL
    - Test errorHandler maps backend errors correctly (400/404 passthrough, 500->502)
  - [x] 4.2 Initialize Node.js project
    - **File:** `mcp-server/package.json`
    - Name: @arch-model/mcp-server
    - Dependencies: express, axios, uuid, dotenv
    - DevDependencies: typescript, @types/express, @types/node, @types/uuid, jest, @types/jest, ts-jest, ts-node, nodemon
    - Scripts: build, start, dev, test
  - [x] 4.3 Create TypeScript configuration
    - **File:** `mcp-server/tsconfig.json`
    - Target: ES2020, Module: commonjs
    - outDir: ./dist, rootDir: ./src
    - Strict mode enabled
  - [x] 4.4 Create environment configuration module
    - **File:** `mcp-server/src/config.ts`
    - Export: ARCH_MODEL_SERVICE_BASE_URL (default: http://localhost:8080)
    - Export: MCP_SESSION_TTL_MINUTES (default: 30)
    - Export: PORT (default: 8090)
  - [x] 4.5 Create TypeScript type definitions
    - **File:** `mcp-server/src/types/index.ts`
    - InterfaceSummaryDto interface (matching Java DTO)
    - InterfaceOasContextDto interface (matching Java DTO, nested types)
    - Session interface: sessionId, filename?, lastListedInterfaces?, lastSelectedInterfaceId?, lastActivity
    - ListInterfacesRequest: { sessionId: string, filename: string }
    - GetInterfaceContextRequest: { sessionId: string, interfaceId: string }
    - McpToolResponse<T>: { data?: T, error?: { code: number, message: string } }
  - [x] 4.6 Create session manager service
    - **File:** `mcp-server/src/services/sessionManager.ts`
    - In-memory Map<string, Session>
    - getOrCreateSession(sessionId): creates if not exists, updates lastActivity
    - updateSession(sessionId, updates): partial update of session fields
    - cleanupExpiredSessions(): remove sessions older than TTL
    - Start cleanup interval (every 5 minutes)
  - [x] 4.7 Create error handler middleware
    - **File:** `mcp-server/src/middleware/errorHandler.ts`
    - Map axios errors: 400/404 passthrough, 500+ -> 502
    - Format error response: { error: { code, message } }
  - [x] 4.8 Create request logger middleware
    - **File:** `mcp-server/src/middleware/requestLogger.ts`
    - Log: tool name, sessionId, key identifiers (filename or interfaceId)
    - Do NOT log full payloads
  - [x] 4.9 Ensure infrastructure tests pass
    - Run ONLY the 4 tests written in 4.1

**Acceptance Criteria:**
- All 4 infrastructure tests pass
- Project builds with `npm run build`
- Configuration loads from environment variables
- Session management works with TTL expiration

**Files to Create:**
- `mcp-server/package.json`
- `mcp-server/tsconfig.json`
- `mcp-server/src/config.ts`
- `mcp-server/src/types/index.ts`
- `mcp-server/src/services/sessionManager.ts`
- `mcp-server/src/middleware/errorHandler.ts`
- `mcp-server/src/middleware/requestLogger.ts`
- `mcp-server/src/__tests__/infrastructure.test.ts`

---

#### Task Group 5: MCP Server Tools and HTTP Client
**Dependencies:** Task Group 4 (MCP infrastructure), Task Groups 1-3 (Backend endpoints)

- [x] 5.0 Complete MCP Server Tools Implementation
  - [x] 5.1 Write 6 focused tests for MCP tools
    - Test list_interfaces calls backend and returns interfaces
    - Test list_interfaces stores filename in session
    - Test list_interfaces handles backend 404 error
    - Test get_interface_oas_context calls backend and returns context
    - Test get_interface_oas_context stores lastSelectedInterfaceId in session
    - Test get_interface_oas_context handles backend 404 error
  - [x] 5.2 Create architecture-model-service HTTP client
    - **File:** `mcp-server/src/services/archModelClient.ts`
    - Use axios with base URL from config
    - Method: listInterfaces(filename: string): Promise<InterfaceSummaryDto[]>
      - GET /api/model/interfaces?filename={filename}
    - Method: getInterfaceOasContext(interfaceId: string): Promise<InterfaceOasContextDto>
      - GET /api/model/interfaces/{interfaceId}
    - Throw errors with status code preserved for middleware handling
  - [x] 5.3 Create MCP tools route handler
    - **File:** `mcp-server/src/routes/tools.ts`
    - Express Router
    - POST /mcp/tools/list_interfaces
      - Validate sessionId and filename are non-empty strings -> 400 if invalid
      - Get or create session
      - Call archModelClient.listInterfaces(filename)
      - Update session: filename, lastListedInterfaces
      - Return { interfaces: [...] }
    - POST /mcp/tools/get_interface_oas_context
      - Validate sessionId and interfaceId are non-empty strings -> 400 if invalid
      - Get or create session
      - Call archModelClient.getInterfaceOasContext(interfaceId)
      - Update session: lastSelectedInterfaceId
      - Return InterfaceOasContextDto directly
  - [x] 5.4 Create Express server entry point
    - **File:** `mcp-server/src/index.ts`
    - Initialize Express app
    - Apply JSON body parser
    - Apply request logger middleware
    - Mount tools router at /mcp/tools
    - Apply error handler middleware (after routes)
    - Listen on PORT from config
    - Log startup message with port
  - [x] 5.5 Create .env.example file
    - **File:** `mcp-server/.env.example`
    - ARCH_MODEL_SERVICE_BASE_URL=http://localhost:8080
    - MCP_SESSION_TTL_MINUTES=30
    - PORT=8090
  - [x] 5.6 Create .gitignore
    - **File:** `mcp-server/.gitignore`
    - node_modules/, dist/, .env, *.log
  - [x] 5.7 Ensure MCP tools tests pass
    - Run ONLY the 6 tests written in 5.1
    - Verify tool endpoints work correctly

**Acceptance Criteria:**
- All 6 MCP tool tests pass
- POST /mcp/tools/list_interfaces returns interface list and updates session
- POST /mcp/tools/get_interface_oas_context returns full context and updates session
- Error mapping works: 400/404 passthrough, 500->502
- Session state persists across requests

**Files to Create:**
- `mcp-server/src/services/archModelClient.ts`
- `mcp-server/src/routes/tools.ts`
- `mcp-server/src/index.ts`
- `mcp-server/.env.example`
- `mcp-server/.gitignore`
- `mcp-server/src/__tests__/tools.test.ts`

---

### Integration Testing

#### Task Group 6: Test Review and Integration Verification
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and verify end-to-end integration
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review the 4 DTO tests from Task 1.1
    - Review the 6 service tests from Task 2.1
    - Review the 6 controller tests from Task 3.1
    - Review the 11 infrastructure tests from Task 4.1 (expanded from original 4)
    - Review the 6 MCP tool tests from Task 5.1
    - Total existing tests: 33 tests
  - [x] 6.2 Analyze test coverage gaps for this feature only
    - Identified end-to-end workflows that lack coverage
    - Focus on integration points between backend and MCP server
    - Did NOT assess entire application test coverage
  - [x] 6.3 Write additional integration tests
    - **Backend integration test file:** `architecture-model-service/src/test/java/com/example/architecturemodel/integration/InterfaceDiscoveryIntegrationTest.java`
    - Test 1: End-to-end flow - save model -> list interfaces -> get context
    - Test 2: Multiple interfaces in same model (hierarchy handling)
    - Test 3: Interface with no linked logical entities (empty list)
    - Test 4: Deterministic ordering with multiple endpoints
    - **MCP integration test file:** `mcp-server/src/__tests__/integration.test.ts`
    - Test 1: Full flow - list_interfaces -> get_interface_oas_context with session
    - Test 2: Session expiration behavior
    - Test 3: Concurrent requests to same session
    - Test 4-7: Backend unavailable returns 502 (multiple error scenarios)
  - [x] 6.4 Run feature-specific tests only
    - Run all architecture-model-service tests related to interface discovery: 20 tests passed
    - Run all mcp-server tests: 24 tests passed
    - Did NOT run entire application test suite
    - Verified all 44 tests pass (33 existing + 11 new)

**Acceptance Criteria:**
- All 44 feature-specific tests pass
- End-to-end workflow verified: backend serves data, MCP server proxies correctly
- Session management verified across request lifecycle
- Error handling verified for all error conditions

**Files Created:**
- `architecture-model-service/src/test/java/com/example/architecturemodel/integration/InterfaceDiscoveryIntegrationTest.java`
- `mcp-server/src/__tests__/integration.test.ts`

---

## Execution Order

Recommended implementation sequence:

```
Phase 1 (Parallel):
  - Task Group 1: Interface Discovery DTOs (Backend)
  - Task Group 4: MCP Server Infrastructure (Node.js)

Phase 2 (Sequential after Phase 1):
  - Task Group 2: Interface Discovery Service Layer
    (depends on Task Group 1)

Phase 3 (Sequential after Phase 2):
  - Task Group 3: Interface Discovery Controller
    (depends on Task Group 2)
  - Task Group 5: MCP Server Tools
    (depends on Task Group 4, can start during Phase 2)

Phase 4 (Final):
  - Task Group 6: Integration Testing
    (depends on all previous groups)
```

## Summary of Files

### Files to Create (Backend - 12 files)
| File | Task Group |
|------|------------|
| `.../dto/interface_discovery/InterfaceSummaryDto.java` | 1 |
| `.../dto/interface_discovery/InterfaceDetailDto.java` | 1 |
| `.../dto/interface_discovery/InterfaceEndpointDto.java` | 1 |
| `.../dto/interface_discovery/ServiceDetailDto.java` | 1 |
| `.../dto/interface_discovery/ApplicationDetailDto.java` | 1 |
| `.../dto/interface_discovery/LogicalAttributeDto.java` | 1 |
| `.../dto/interface_discovery/LogicalEntitySchemaDto.java` | 1 |
| `.../dto/interface_discovery/OasNotesDto.java` | 1 |
| `.../dto/interface_discovery/InterfaceOasContextDto.java` | 1 |
| `.../service/InterfaceDiscoveryService.java` | 2 |
| `.../controller/ModelInterfacesController.java` | 3 |
| `.../integration/InterfaceDiscoveryIntegrationTest.java` | 6 |

### Files to Create (MCP Server - 12 files)
| File | Task Group |
|------|------------|
| `mcp-server/package.json` | 4 |
| `mcp-server/tsconfig.json` | 4 |
| `mcp-server/src/config.ts` | 4 |
| `mcp-server/src/types/index.ts` | 4 |
| `mcp-server/src/services/sessionManager.ts` | 4 |
| `mcp-server/src/middleware/errorHandler.ts` | 4 |
| `mcp-server/src/middleware/requestLogger.ts` | 4 |
| `mcp-server/src/services/archModelClient.ts` | 5 |
| `mcp-server/src/routes/tools.ts` | 5 |
| `mcp-server/src/index.ts` | 5 |
| `mcp-server/.env.example` | 5 |
| `mcp-server/.gitignore` | 5 |

### Files to Create (Tests - 6 files)
| File | Task Group |
|------|------------|
| `.../dto/InterfaceDiscoveryDtoTest.java` | 1 |
| `.../service/InterfaceDiscoveryServiceTest.java` | 2 |
| `.../controller/ModelInterfacesControllerTest.java` | 3 |
| `mcp-server/src/__tests__/infrastructure.test.ts` | 4 |
| `mcp-server/src/__tests__/tools.test.ts` | 5 |
| `mcp-server/src/__tests__/integration.test.ts` | 6 |

### Files to Modify (Backend - 3 files)
| File | Changes | Task Group |
|------|---------|------------|
| `.../repository/entity/EndpointRepository.java` | Add `findByInterfaceId` method | 2 |
| `.../repository/relationship/InterfaceLogicalEntityRepository.java` | Add `findByInterfaceId` method | 2 |
| `.../repository/entity/LogicalDataAttributeRepository.java` | Add `findByLogicalEntityId` method | 2 |

## Technical Notes

### Existing Patterns to Follow

1. **Controller Pattern** (from `ModelController.java`):
   - Use `@RestController`, `@RequestMapping`, `@RequiredArgsConstructor`, `@Slf4j`
   - Return `ResponseEntity<T>` from endpoints
   - Let `GlobalExceptionHandler` handle exceptions

2. **DTO Pattern** (from `model/dto/entity/*.java`):
   - Use Java records
   - All fields in constructor
   - Nullable fields for optional data

3. **Repository Pattern** (from existing repositories):
   - Extend `JpaRepository<Entity, String>`
   - Add custom query methods as needed
   - Spring Data JPA derives queries from method names

4. **Service Pattern** (from `ModelService.java`):
   - Use `@Service`, `@RequiredArgsConstructor`, `@Slf4j`
   - Use `@Transactional(readOnly = true)` for read operations
   - Throw `ResourceNotFoundException` for 404 cases

### Key Data Relationships

```
Interface -> Service (via serviceId)
Service -> Application (via applicationId)
Interface -> Endpoint (via interfaceId on Endpoint)
Interface -> LogicalDataEntity (via InterfaceLogicalEntity join table)
LogicalDataEntity -> LogicalDataAttribute (via logicalEntityId on Attribute)
```

### Sorting Requirements

- Endpoints: ORDER BY operationVerb, pathOrAddress, name, id
- LogicalEntities: ORDER BY name, id
- Attributes: ORDER BY name, id

## Test Summary

### Final Test Count (Task Group 6)

| Test Category | File | Tests |
|---------------|------|-------|
| Backend DTO Tests | `InterfaceDiscoveryDtoTest.java` | 4 |
| Backend Service Tests | `InterfaceDiscoveryServiceTest.java` | 6 |
| Backend Controller Tests | `ModelInterfacesControllerTest.java` | 6 |
| Backend Integration Tests | `InterfaceDiscoveryIntegrationTest.java` | 4 |
| MCP Infrastructure Tests | `infrastructure.test.ts` | 11 |
| MCP Tools Tests | `tools.test.ts` | 6 |
| MCP Integration Tests | `integration.test.ts` | 7 |
| **Total** | | **44** |

All 44 tests passing as of Task Group 6 completion.
