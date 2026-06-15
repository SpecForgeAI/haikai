# Task Breakdown: Chat Assistant - Save OAS Spec

## Overview
Total Tasks: 4 Task Groups (approximately 25 sub-tasks)

This feature adds the ability to save OpenAPI specs to disk via MCP and architecture-model-service. The implementation spans two layers:
1. **Java Backend (architecture-model-service)**: Configuration, DTOs, utility classes, service layer, REST controller
2. **MCP Server (Node/TypeScript)**: Types, client method, route handler, route mounting

## Task List

### Java Backend Layer

#### Task Group 1: Configuration and Data Types
**Dependencies:** None

- [x] 1.0 Complete configuration and DTO layer
  - [x] 1.1 Write 3-4 focused tests for DTOs and configuration
    - Test SaveOasSpecRequestDto record instantiation and field access
    - Test SaveOasSpecSummaryDto record instantiation with all fields
    - Test configuration properties binding (parentFolder, maxBytes defaults)
  - [x] 1.2 Add OAS configuration properties to application.yml
    - Add `architectureModel.oas.parentFolder` with default `./oas-specs`
    - Add `architectureModel.oas.maxBytes` with default `2097152` (2MB)
    - Follow existing configuration patterns in application.yml
  - [x] 1.3 Create SaveOasSpecRequestDto record
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/oas/SaveOasSpecRequestDto.java`
    - Fields: format (String), contents (String), title (String), version (String)
    - Follow existing DTO patterns (e.g., InterfaceSummaryDto)
  - [x] 1.4 Create SaveOasSpecSummaryDto record
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/oas/SaveOasSpecSummaryDto.java`
    - Fields: interfaceId, interfaceName, architectureFilename, format, savedPath, specLink, updatedAt (Instant), created (boolean)
  - [x] 1.5 Ensure configuration and DTO tests pass
    - Run ONLY the 3-4 tests written in 1.1
    - Verify DTOs compile and instantiate correctly

**Acceptance Criteria:**
- Configuration properties load from application.yml
- DTOs can be instantiated and serialized to JSON
- The 3-4 tests written in 1.1 pass

---

#### Task Group 2: Utility Classes
**Dependencies:** Task Group 1

- [x] 2.0 Complete FilenameSanitizer utility
  - [x] 2.1 Write 5-6 focused tests for FilenameSanitizer
    - Test sanitization of normal names (e.g., "Order API" -> "Order API")
    - Test replacement of invalid characters (`/\:*?"<>|` -> `-`)
    - Test collapse of multiple consecutive dashes
    - Test trim of leading/trailing dashes and whitespace
    - Test empty result after sanitization throws exception
    - Test path traversal detection (names containing `..`)
  - [x] 2.2 Create FilenameSanitizer utility class
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/util/FilenameSanitizer.java`
    - Method: `sanitize(String input)` returns sanitized filename or throws IllegalArgumentException
    - Method: `validateNoPathTraversal(Path basePath, Path resolvedPath)` throws if path escapes base
    - Replace characters: `/` `\` `:` `*` `?` `"` `<` `>` `|` with `-`
    - Trim whitespace, collapse multiple `-`, trim leading/trailing `-`
    - Return 400-appropriate exception if result is empty
  - [x] 2.3 Ensure FilenameSanitizer tests pass
    - Run ONLY the 5-6 tests written in 2.1
    - File: `architecture-model-service/src/test/java/com/example/architecturemodel/util/FilenameSanitizerTest.java`

**Acceptance Criteria:**
- FilenameSanitizer correctly sanitizes all invalid characters
- Empty sanitized names throw appropriate exception
- Path traversal attempts are detected and rejected
- The 5-6 tests written in 2.1 pass

---

#### Task Group 3: Service and Controller Layer
**Dependencies:** Task Groups 1, 2

- [x] 3.0 Complete OAS service and controller
  - [x] 3.1 Write 6-8 focused tests for OasSpecService
    - Test successful YAML save (new file -> created=true)
    - Test successful JSON save
    - Test overwrite existing file (created=false)
    - Test invalid YAML content returns 400
    - Test invalid JSON content returns 400
    - Test content exceeds maxBytes returns 400
    - Test interface not found returns 404
    - Test filename not found in model_files returns 404
  - [x] 3.2 Create OasSpecService class
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/OasSpecService.java`
    - Inject: InterfaceRepository, ModelFileRepository, configuration properties
    - Method: `saveOasSpec(String interfaceId, String filename, SaveOasSpecRequestDto request)` returns SaveOasSpecSummaryDto
    - Validate format is "yaml" or "json"
    - Validate content size against maxBytes
    - Parse and validate YAML (SnakeYAML) or JSON (Jackson ObjectMapper)
    - Construct path: parentFolder / sanitize(filename) / sanitize(interfaceName) + extension
    - Create directories if needed
    - Write atomically (temp file + move with ATOMIC_MOVE or REPLACE_EXISTING fallback)
    - Update interface.spec_link with absolute path
    - Return summary with created flag based on file existence check
  - [x] 3.3 Write 4-5 focused tests for OasSpecController
    - Test PUT endpoint with valid request returns 201 (new file)
    - Test PUT endpoint with valid request returns 200 (overwrite)
    - Test missing filename query param returns 400
    - Test missing format in body returns 400
    - Test missing contents in body returns 400
  - [x] 3.4 Create OasSpecController class
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/OasSpecController.java`
    - Endpoint: `PUT /api/model/interfaces/{id}/oas`
    - Query param: `filename` (required)
    - Request body: SaveOasSpecRequestDto
    - Response: SaveOasSpecSummaryDto
    - Return 201 if created=true, 200 if created=false
    - Follow existing controller patterns (e.g., ModelInterfacesController)
  - [x] 3.5 Update InterfaceRepository if needed
    - Add method to find interface by ID if not already present
    - Ensure spec_link field can be updated
  - [x] 3.6 Ensure service and controller tests pass
    - Run ONLY the tests written in 3.1 and 3.3
    - File: `architecture-model-service/src/test/java/com/example/architecturemodel/service/OasSpecServiceTest.java`
    - File: `architecture-model-service/src/test/java/com/example/architecturemodel/controller/OasSpecControllerTest.java`

**Acceptance Criteria:**
- OasSpecService validates input and saves files atomically
- OasSpecController exposes PUT endpoint with correct status codes
- Interface spec_link is updated in database
- The 10-13 tests written in 3.1 and 3.3 pass

---

### MCP Server Layer

#### Task Group 4: MCP Types, Client, and Route
**Dependencies:** Task Groups 1-3 (Java backend must be complete)

- [x] 4.0 Complete MCP server save_oas_spec tool
  - [x] 4.1 Write 6-8 focused tests for saveOasSpecRoute
    - Test successful save request returns summary
    - Test missing sessionId returns 400
    - Test missing filename returns 400
    - Test missing interfaceId returns 400
    - Test invalid format (not yaml/json) returns 400
    - Test backend 404 response is forwarded as 404
    - Test backend 500 response returns 502
    - Test session is updated with filename and lastSelectedInterfaceId
  - [x] 4.2 Create TypeScript type definitions
    - File: `mcp-server/src/types/saveOasSpec.ts`
    - Interface: SaveOasSpecRequest (sessionId, filename, interfaceId, format, oasContents)
    - Interface: SaveOasSpecSummaryDto (interfaceId, interfaceName, architectureFilename, format, savedPath, specLink, updatedAt, created)
  - [x] 4.3 Update types/index.ts to re-export saveOasSpec types
    - Add export statement for saveOasSpec types
    - Follow existing pattern with oasGaps types
  - [x] 4.4 Add saveOasSpec method to archModelClient
    - File: `mcp-server/src/services/archModelClient.ts`
    - Method: `saveOasSpec(interfaceId: string, filename: string, format: string, contents: string)` returns Promise<SaveOasSpecSummaryDto>
    - Construct PUT request to `/api/model/interfaces/{interfaceId}/oas?filename={filename}`
    - Body: `{ format, contents }`
    - Handle response status codes appropriately
  - [x] 4.5 Create saveOasSpecRoute handler
    - File: `mcp-server/src/routes/saveOasSpecRoute.ts`
    - Validate all required fields (sessionId, filename, interfaceId, format, oasContents)
    - Normalize format to lowercase
    - Call archModelClient.saveOasSpec
    - Update session with filename and lastSelectedInterfaceId
    - Map backend errors: 400->400, 404->404, 5xx->502
    - Follow existing pattern from computeOasGapsRoute.ts
  - [x] 4.6 Mount saveOasSpecRoute in tools.ts
    - File: `mcp-server/src/routes/tools.ts`
    - Import saveOasSpecRoute
    - Add POST route for `/mcp/tools/save_oas_spec`
    - Follow existing mounting pattern
  - [x] 4.7 Ensure MCP server tests pass
    - Run ONLY the 6-8 tests written in 4.1
    - File: `mcp-server/src/__tests__/saveOasSpecRoute.test.ts`

**Acceptance Criteria:**
- TypeScript types match Java DTOs
- archModelClient correctly calls Java backend
- Route handler validates input and maps errors correctly
- Session is updated on successful save
- The 6-8 tests written in 4.1 pass

---

### Integration and Verification

#### Task Group 5: Test Review and Integration Testing
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review and verify end-to-end functionality
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review 3-4 tests from Task Group 1 (DTOs/config)
    - Review 5-6 tests from Task Group 2 (FilenameSanitizer)
    - Review 10-13 tests from Task Group 3 (Service/Controller)
    - Review 6-8 tests from Task Group 4 (MCP route)
    - Total existing tests: approximately 24-31 tests
  - [x] 5.2 Identify critical integration gaps
    - Focus on end-to-end flow: MCP -> Java -> filesystem -> database
    - Verify atomic write behavior
    - Verify path traversal prevention works end-to-end
  - [x] 5.3 Write up to 5 additional integration tests if needed
    - Test full MCP to Java backend round trip (mock or integration)
    - Test file actually appears on disk at expected path
    - Test interface.spec_link is updated in database
    - Test overwrite scenario end-to-end
    - Test error propagation from backend to MCP response
  - [x] 5.4 Run all feature-specific tests
    - Run all tests from Task Groups 1-4 plus any new tests from 5.3
    - Expected total: approximately 29-36 tests maximum
    - Verify all pass before marking feature complete

**Acceptance Criteria:**
- All feature-specific tests pass
- End-to-end flow works correctly
- Files are saved to correct locations
- Database is updated correctly
- Error handling works as specified

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Configuration and Data Types**
   - No dependencies
   - Foundation for all other work
   - Specialist: Java backend engineer

2. **Task Group 2: Utility Classes**
   - Depends on Task Group 1
   - FilenameSanitizer is critical for security
   - Specialist: Java backend engineer

3. **Task Group 3: Service and Controller Layer**
   - Depends on Task Groups 1 and 2
   - Core business logic and API endpoint
   - Specialist: Java backend engineer

4. **Task Group 4: MCP Types, Client, and Route**
   - Depends on Task Groups 1-3 (needs Java backend complete)
   - MCP integration layer
   - Specialist: TypeScript/Node engineer

5. **Task Group 5: Test Review and Integration Testing**
   - Depends on Task Groups 1-4
   - Final verification
   - Specialist: QA engineer or full-stack engineer

---

## Files Summary

### Files to Create

| File | Task | Description |
|------|------|-------------|
| `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/oas/SaveOasSpecRequestDto.java` | 1.3 | Request DTO record |
| `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/oas/SaveOasSpecSummaryDto.java` | 1.4 | Response DTO record |
| `architecture-model-service/src/main/java/com/example/architecturemodel/util/FilenameSanitizer.java` | 2.2 | Filename sanitization utility |
| `architecture-model-service/src/main/java/com/example/architecturemodel/service/OasSpecService.java` | 3.2 | Service layer for save logic |
| `architecture-model-service/src/main/java/com/example/architecturemodel/controller/OasSpecController.java` | 3.4 | REST controller |
| `architecture-model-service/src/test/java/com/example/architecturemodel/util/FilenameSanitizerTest.java` | 2.1 | Sanitizer unit tests |
| `architecture-model-service/src/test/java/com/example/architecturemodel/service/OasSpecServiceTest.java` | 3.1 | Service unit tests |
| `architecture-model-service/src/test/java/com/example/architecturemodel/controller/OasSpecControllerTest.java` | 3.3 | Controller tests |
| `mcp-server/src/types/saveOasSpec.ts` | 4.2 | TypeScript type definitions |
| `mcp-server/src/routes/saveOasSpecRoute.ts` | 4.5 | MCP route handler |
| `mcp-server/src/__tests__/saveOasSpecRoute.test.ts` | 4.1 | Route handler tests |

### Files to Modify

| File | Task | Changes |
|------|------|---------|
| `architecture-model-service/src/main/resources/application.yml` | 1.2 | Add `architectureModel.oas.*` config properties |
| `architecture-model-service/src/main/java/com/example/architecturemodel/repository/InterfaceRepository.java` | 3.5 | Add findById method if needed |
| `mcp-server/src/types/index.ts` | 4.3 | Re-export saveOasSpec types |
| `mcp-server/src/services/archModelClient.ts` | 4.4 | Add `saveOasSpec()` method |
| `mcp-server/src/routes/tools.ts` | 4.6 | Import and mount saveOasSpecRoute |

---

## Test Count Summary

| Task Group | Test Count | Test File(s) |
|------------|------------|--------------|
| 1. Configuration/DTOs | 4 | SaveOasSpecDtoTest.java |
| 2. FilenameSanitizer | 7 | FilenameSanitizerTest.java |
| 3. Service/Controller | 18 | OasSpecServiceTest.java (11), OasSpecControllerTest.java (7) |
| 4. MCP Route | 8 | saveOasSpecRoute.test.ts |
| 5. Integration | 0 | (covered by existing tests) |
| **Total** | **37** | |

---

## Key Technical Notes

1. **Atomic File Writes**: Use temp file + `Files.move()` with `ATOMIC_MOVE` option, falling back to `REPLACE_EXISTING` if atomic move is not supported on the filesystem.

2. **Path Security**: FilenameSanitizer must be thoroughly tested for path traversal prevention. Use `Path.resolve().normalize()` and verify resolved path starts with base path.

3. **Content Validation**: Parse YAML with SnakeYAML, JSON with Jackson ObjectMapper. Syntax validation only (not full OpenAPI schema validation).

4. **Status Code Logic**: Check file existence BEFORE atomic write to determine 200 vs 201 response. The actual write always replaces.

5. **MCP Session**: Update session with `filename` and `lastSelectedInterfaceId` after successful save for context continuity.
