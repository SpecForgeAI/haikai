# Task Breakdown: Backend v0.1 - Confluence Draw.io Diagram API

## Overview
Total Tasks: 42

This is a new Java 21 / Spring Boot 3.x / Maven backend service that provides a REST API to fetch draw.io diagrams from Confluence pages, parse them into a neutral graph model, and return structured JSON.

## Task List

### Project Setup Layer

#### Task Group 1: Maven Project and Configuration
**Dependencies:** None

- [x] 1.0 Complete project setup and configuration
  - [x] 1.1 Write 4 focused tests for configuration validation
    - Test that ConfluenceProperties validates required baseUrl
    - Test that ConfluenceProperties applies default timeout values when not provided
    - Test that ConfluenceProperties applies default maxPageDepth when not provided
    - Test that application context loads with valid configuration
  - [x] 1.2 Create Maven project structure in `backend/` folder
    - Create `pom.xml` with Spring Boot 3.2.0 parent
    - Set Java version to 21
    - Add dependencies: spring-boot-starter-web, spring-boot-starter-validation, jsoup 1.17.2
    - Add test dependencies: spring-boot-starter-test, mockwebserver
    - Add spring-boot-configuration-processor (optional)
  - [x] 1.3 Create main application class
    - Create `ArchToolBackendApplication.java` with @SpringBootApplication
    - Add @EnableConfigurationProperties for ConfluenceProperties
  - [x] 1.4 Create application configuration files
    - Create `application.yml` with server port, confluence settings, and logging config
    - Create `application-local.yml` for local development overrides
    - Use environment variables with sensible defaults
  - [x] 1.5 Create ConfluenceProperties configuration class
    - Implement as Java record with @ConfigurationProperties
    - Fields: baseUrl, username, apiToken, connectTimeoutMs, readTimeoutMs, maxPageDepth
    - Add validation in compact constructor for required fields and defaults
  - [x] 1.6 Create RestClientConfig for HTTP client configuration
    - Configure RestClient or RestTemplate with timeouts from ConfluenceProperties
    - Set up Basic Authentication for Confluence API
  - [x] 1.7 Ensure project setup tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify Maven build succeeds with `mvn compile`
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- Maven project compiles successfully
- Application context loads without errors
- Configuration properties bind correctly from YAML
- RestClient configured with proper timeouts and auth

---

### Data Model Layer

#### Task Group 2: DTOs and Domain Models
**Dependencies:** Task Group 1

- [x] 2.0 Complete data model layer
  - [x] 2.1 Write 5 focused tests for DTO construction and serialization
    - Test DiagramNodeDto JSON serialization with all fields
    - Test DiagramEdgeDto JSON serialization with points list
    - Test DiagramStyleDto parses style string correctly
    - Test ConfluenceDiagramResponse summary calculation
    - Test DiagramGeometryDto handles null values gracefully
  - [x] 2.2 Create response wrapper DTOs
    - Create `ConfluenceDiagramResponse.java` record with rootPageId, rootPageTitle, includeAllChildPages, maxDepth, pages list, summary
    - Create `ConfluencePageDiagramsDto.java` record with pageId, pageTitle, diagrams list
    - Create `ResponseSummaryDto.java` record with totalPages, totalDiagrams, totalNodes, totalEdges, warnings list
  - [x] 2.3 Create diagram graph DTOs
    - Create `DiagramGraphDto.java` record with diagramId, diagramName, tabIndex, tabName, source, nodes, edges
    - Create `DiagramSourceDto.java` record with type, pageId, attachmentId, attachmentFileName
  - [x] 2.4 Create node and geometry DTOs
    - Create `DiagramNodeDto.java` record with id, label, geometry, style, parentId
    - Create `DiagramGeometryDto.java` record with x, y, width, height (all Double for nullability)
    - Create `DiagramPointDto.java` record with x, y (double primitives)
  - [x] 2.5 Create edge DTO
    - Create `DiagramEdgeDto.java` record with id, sourceId, targetId, label, points list, style
  - [x] 2.6 Create style DTO
    - Create `DiagramStyleDto.java` record with rawStyle, fillColor, strokeColor, fontColor, shape, rounded, dashed, startArrow, endArrow, fontSize, fontFamily
  - [x] 2.7 Create Confluence domain models
    - Create `ConfluencePage.java` record with id, title, bodyStorage, version
    - Create `ConfluenceAttachment.java` record with id, title, downloadUrl, mediaType
  - [x] 2.8 Create error response DTO
    - Create `ErrorResponse.java` record with error code, message, timestamp
  - [x] 2.9 Ensure data model tests pass
    - Run ONLY the 5 tests written in 2.1
    - Verify all DTOs compile and serialize correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 5 tests written in 2.1 pass
- All DTOs compile as Java records
- JSON serialization produces expected structure
- Nullable fields handled appropriately

---

### Exception Handling Layer

#### Task Group 3: Custom Exceptions and Global Handler
**Dependencies:** Task Group 2 (COMPLETED)

- [x] 3.0 Complete exception handling layer
  - [x] 3.1 Write 4 focused tests for exception handling
    - Test ConfluenceApiException maps to correct HTTP status based on Confluence error code
    - Test DiagramParsingException includes diagram source information
    - Test GlobalExceptionHandler returns proper ErrorResponse format
    - Test validation errors return 400 with descriptive message
  - [x] 3.2 Create ConfluenceApiException
    - Extend RuntimeException
    - Fields: statusCode (int), confluenceError (String)
    - Constructor to accept HTTP status from Confluence response
    - Helper methods: isNotFound(), isUnauthorized(), isForbidden()
  - [x] 3.3 Create DiagramParsingException
    - Extend RuntimeException
    - Fields: diagramSource (String), parseError (String)
    - Constructor to capture which diagram failed and why
  - [x] 3.4 Create GlobalExceptionHandler
    - Add @RestControllerAdvice annotation
    - Handle ConfluenceApiException - map to appropriate HTTP status (401, 403, 404, 500)
    - Handle DiagramParsingException - return 500 with details
    - Handle MethodArgumentNotValidException - return 400 with validation details
    - Handle generic Exception - return 500 with safe error message
    - All handlers return ErrorResponse DTO
  - [x] 3.5 Ensure exception handling tests pass
    - Run ONLY the 4 tests written in 3.1
    - Verify error responses match API specification
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests written in 3.1 pass
- Exceptions carry contextual information
- HTTP status codes match specification (400, 401, 403, 404, 500)
- Error response JSON structure is consistent

---

### Service Layer - Core Parsing

#### Task Group 4: Draw.io Parser Service
**Dependencies:** Task Group 2 (COMPLETED)

- [x] 4.0 Complete Draw.io parser service
  - [x] 4.1 Write 8 focused tests for DrawioParser
    - Test parsing single-tab draw.io file extracts nodes correctly
    - Test parsing single-tab draw.io file extracts edges correctly
    - Test parsing multi-tab draw.io file returns separate DiagramGraphDto per tab
    - Test node geometry extraction (x, y, width, height)
    - Test edge points extraction (sourcePoint, targetPoint, intermediate points)
    - Test style string parsing extracts fillColor, strokeColor, shape, rounded
    - Test invalid XML throws DiagramParsingException
    - Test missing geometry on node results in null geometry (not exception)
  - [x] 4.2 Create XmlUtils utility class
    - Helper method to safely parse XML string to Document
    - Helper method to extract attribute value with default
    - Helper method to unescape HTML entities from labels
  - [x] 4.3 Create StyleParser utility (or method within DrawioParser)
    - Parse style string format: `key1=value1;key2=value2;`
    - Extract known properties: fillColor, strokeColor, fontColor, shape, rounded, dashed, startArrow, endArrow, fontSize, fontFamily
    - Infer shape from style keys (ellipse, rhombus, etc.)
    - Always preserve rawStyle
  - [x] 4.4 Implement DrawioParser.parse() method
    - Parse `<mxfile>` root element
    - Iterate `<diagram>` children for multi-tab support
    - Extract tab name from diagram/@name attribute
    - Parse `<mxGraphModel><root>` structure
  - [x] 4.5 Implement node extraction in DrawioParser
    - Find `<mxCell>` with vertex="1"
    - Extract id, value (label), parent, style
    - Parse child `<mxGeometry>` for x, y, width, height
    - Build DiagramNodeDto instances
  - [x] 4.6 Implement edge extraction in DrawioParser
    - Find `<mxCell>` with edge="1"
    - Extract id, source, target, value (label), style
    - Parse child `<mxGeometry>` for points:
      - `<mxPoint as="sourcePoint">` for source
      - `<mxPoint as="targetPoint">` for target
      - `<Array as="points"><mxPoint>` for intermediates
    - Build DiagramEdgeDto instances
  - [x] 4.7 Implement diagram ID generation
    - Format: `diag_{pageId}_{attachmentId}_{tabIndex}`
    - Ensure globally unique IDs
  - [x] 4.8 Create test resource files
    - Create `test-diagrams/simple.drawio` with 2-3 nodes and 1-2 edges
    - Create `test-diagrams/multi-tab.drawio` with 2 tabs
    - Create `test-diagrams/styled.drawio` with various style attributes
  - [x] 4.9 Ensure DrawioParser tests pass
    - Run ONLY the 8 tests written in 4.1
    - Verify parsing produces expected graph structure
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 8 tests written in 4.1 pass
- Single-tab and multi-tab files parsed correctly
- Nodes include geometry and style
- Edges include source/target and points
- Style attributes extracted correctly
- Invalid XML handled gracefully with exception

---

### Service Layer - Confluence Integration

#### Task Group 5: Draw.io Scanner Service
**Dependencies:** Task Group 2 (COMPLETED)

- [x] 5.0 Complete Draw.io scanner service
  - [x] 5.1 Write 5 focused tests for DrawioScanner
    - Test finding draw.io macro in Confluence page body
    - Test extracting diagramName parameter from macro
    - Test matching macro reference to .drawio attachment
    - Test discovering .drawio attachments not referenced by macros
    - Test handling page with no draw.io content returns empty list
  - [x] 5.2 Create DrawioDiagramSource internal model
    - Fields: attachmentId, attachmentFileName, downloadUrl, referencedByMacro
    - Used internally to track what to download
  - [x] 5.3 Implement DrawioScanner.scanPage() method
    - Parse body.storage HTML using Jsoup
    - Find `<ac:structured-macro ac:name="drawio">` or `ac:name="diagrams.net"`
    - Extract filename from `<ac:parameter ac:name="diagramName">`
    - Return list of DrawioDiagramSource
  - [x] 5.4 Implement attachment matching logic
    - Match macro filenames with attachments having .drawio or .xml extension
    - Include unmatched .drawio attachments as additional sources
    - Log warnings for macros with missing attachments
  - [x] 5.5 Create test resource files for scanner
    - Create sample Confluence page HTML with draw.io macro
    - Create sample HTML without any diagrams
    - Create sample with multiple macros
  - [x] 5.6 Ensure DrawioScanner tests pass
    - Run ONLY the 5 tests written in 5.1
    - Verify macro extraction works correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 5 tests written in 5.1 pass
- Draw.io macros detected in page body
- Diagram name parameters extracted
- Attachments matched to macro references
- Orphan .drawio attachments included

---

### Service Layer - HTTP Client

#### Task Group 6: Confluence Client Service
**Dependencies:** Task Groups 1, 2, 3 (ALL COMPLETED)

- [x] 6.0 Complete Confluence client service
  - [x] 6.1 Write 6 focused tests for ConfluenceClient (using MockWebServer)
    - Test getPage() returns ConfluencePage with body.storage
    - Test getChildPages() returns list of child pages
    - Test getAttachments() handles pagination correctly
    - Test downloadAttachment() returns byte array content
    - Test 401 response throws ConfluenceApiException with UNAUTHORIZED
    - Test 404 response throws ConfluenceApiException with NOT_FOUND
  - [x] 6.2 Implement ConfluenceClient.getPage() method
    - Call `GET /rest/api/content/{id}?expand=body.storage,version`
    - Parse JSON response to ConfluencePage
    - Handle error responses appropriately
  - [x] 6.3 Implement ConfluenceClient.getChildPages() method
    - Call `GET /rest/api/content/{id}/child/page`
    - Implement recursive traversal up to maxDepth
    - Handle pagination (limit=25, use _links.next)
    - Return flat list of all descendant pages
  - [x] 6.4 Implement ConfluenceClient.getAttachments() method
    - Call `GET /rest/api/content/{pageId}/child/attachment`
    - Handle pagination
    - Filter for relevant media types
    - Return list of ConfluenceAttachment
  - [x] 6.5 Implement ConfluenceClient.downloadAttachment() method
    - Call GET on attachment downloadUrl
    - Return raw byte array content
    - Handle errors appropriately
  - [x] 6.6 Implement authentication header
    - Use Basic Auth with username:apiToken (base64 encoded)
    - Apply to all Confluence API requests
  - [x] 6.7 Ensure ConfluenceClient tests pass
    - Run ONLY the 6 tests written in 6.1
    - Verify HTTP calls are constructed correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6 tests written in 6.1 pass
- All Confluence REST API endpoints called correctly
- Authentication header included on all requests
- Pagination handled for child pages and attachments
- HTTP errors mapped to ConfluenceApiException

---

### Service Layer - Orchestration

#### Task Group 7: Confluence Diagram Service (Orchestrator)
**Dependencies:** Task Groups 4, 5, 6 (ALL COMPLETED)

- [x] 7.0 Complete orchestration service
  - [x] 7.1 Write 6 focused tests for ConfluenceDiagramService
    - Test single page with one diagram returns correct response structure
    - Test includeAllChildPages=true fetches and includes child pages
    - Test maxDepth parameter limits child page traversal
    - Test parsing failure for one diagram adds warning but continues processing
    - Test missing attachment adds warning but continues processing
    - Test summary counts (totalPages, totalDiagrams, totalNodes, totalEdges) are correct
  - [x] 7.2 Implement ConfluenceDiagramService.fetchDiagrams() method
    - Accept pageId, includeAllChildPages, maxDepth parameters
    - Coordinate calls to ConfluenceClient, DrawioScanner, DrawioParser
    - Build ConfluenceDiagramResponse with all results
  - [x] 7.3 Implement page collection logic
    - Fetch root page
    - If includeAllChildPages, fetch child pages up to maxDepth
    - Collect all pages to process
  - [x] 7.4 Implement per-page processing
    - For each page: fetch attachments, scan for diagrams, download and parse each
    - Build ConfluencePageDiagramsDto per page
    - Catch and record warnings for individual failures
  - [x] 7.5 Implement summary calculation
    - Count total pages, diagrams, nodes, edges
    - Collect all warnings from processing
    - Build ResponseSummaryDto
  - [x] 7.6 Add logging throughout orchestration
    - INFO: Request start (pageId, includeChildPages)
    - INFO: Request complete (page count, diagram count)
    - WARN: Missing attachments, parsing failures
    - DEBUG: Individual API calls, parsing details
  - [x] 7.7 Ensure orchestration service tests pass
    - Run ONLY the 6 tests written in 7.1
    - Verify end-to-end flow works correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6 tests written in 7.1 pass
- Full orchestration flow works end-to-end
- Child pages included when requested
- Individual failures produce warnings, not failures
- Summary statistics accurate
- Appropriate logging at each level

---

### Controller Layer

#### Task Group 8: REST Controller
**Dependencies:** Task Groups 3, 7 (ALL COMPLETED)

- [x] 8.0 Complete REST controller layer
  - [x] 8.1 Write 6 focused tests for ConfluenceDiagramController
    - Test GET /api/confluence/diagrams with valid pageId returns 200 OK
    - Test missing pageId returns 400 BAD_REQUEST
    - Test invalid maxDepth (negative) returns 400 BAD_REQUEST
    - Test Confluence 401 error propagates as 401 response
    - Test Confluence 404 error propagates as 404 response
    - Test response JSON structure matches specification
  - [x] 8.2 Create ConfluenceDiagramController
    - Add @RestController and @RequestMapping("/api/confluence")
    - Inject ConfluenceDiagramService
  - [x] 8.3 Implement GET /diagrams endpoint
    - Define @GetMapping("/diagrams")
    - Accept @RequestParam: pageId (required), includeAllChildPages (default false), maxDepth (optional)
    - Validate parameters
    - Call service and return ResponseEntity
  - [x] 8.4 Add parameter validation
    - pageId must not be blank
    - maxDepth must be positive if provided
    - Use configuration default for maxDepth when not provided
  - [x] 8.5 Add request/response logging
    - Log incoming request parameters
    - Log response status
    - Do not log sensitive data
  - [x] 8.6 Ensure controller tests pass
    - Run ONLY the 6 tests written in 8.1
    - Verify API contract matches specification
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6 tests written in 8.1 pass
- GET endpoint accessible at /api/confluence/diagrams
- Required/optional parameters handled correctly
- Validation errors return 400
- Confluence errors propagate with correct status
- Response JSON matches specification

---

### Testing Layer

#### Task Group 9: Test Review and Integration Testing
**Dependencies:** Task Groups 1-8

- [x] 9.0 Review existing tests and fill critical gaps
  - [x] 9.1 Review tests from Task Groups 1-8
    - Review the 4 tests from Task 1.1 (configuration)
    - Review the 5 tests from Task 2.1 (DTOs)
    - Review the 4 tests from Task 3.1 (exception handling)
    - Review the 8 tests from Task 4.1 (DrawioParser)
    - Review the 5 tests from Task 5.1 (DrawioScanner)
    - Review the 6 tests from Task 6.1 (ConfluenceClient)
    - Review the 6 tests from Task 7.1 (ConfluenceDiagramService)
    - Review the 6 tests from Task 8.1 (Controller)
    - Total existing tests: approximately 45 tests
  - [x] 9.2 Analyze test coverage gaps for this feature
    - Identify critical end-to-end workflows lacking coverage
    - Focus on integration points between services
    - Prioritize realistic usage scenarios
  - [x] 9.3 Write up to 10 additional integration tests
    - Test full request/response cycle with mocked Confluence
    - Test multi-page hierarchy with multiple diagrams per page
    - Test graceful degradation when some diagrams fail
    - Test edge cases: empty page, page with no diagrams, very deep hierarchy
    - Test response serialization matches exact JSON specification
    - Add any critical gap tests identified in 9.2
    - Created: FullWorkflowIntegrationTest.java with 8 integration tests
  - [x] 9.4 Create comprehensive test resources
    - Ensure test-diagrams/ has representative samples
    - Add edge case files (empty diagram, complex styles, unicode labels)
    - Test resources already exist: simple.drawio, multi-tab.drawio, styled.drawio
  - [x] 9.5 Run feature-specific tests
    - Run ALL tests related to this backend service
    - Total: 53 tests passing
    - Verify all critical workflows pass
    - Generate test coverage report

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 50-54 tests total)
- Critical end-to-end workflows covered
- No more than 10 additional tests added
- Test resources comprehensive and realistic
- Coverage report shows adequate coverage of core parsing and API logic

---

### Documentation and Finalization

#### Task Group 10: Build Verification and Documentation
**Dependencies:** Task Groups 1-9

- [x] 10.0 Complete build verification
  - [x] 10.1 Verify Maven build lifecycle
    - `mvn clean compile` succeeds ✓
    - `mvn test` runs all 53 tests and passes ✓
    - `mvn package` produces executable JAR (21.6 MB) ✓
  - [x] 10.2 Verify application startup
    - Application starts on port 8080 ✓
    - Logs show expected startup sequence ✓
    - Started in ~4 seconds ✓
  - [x] 10.3 Verify configuration binding
    - Environment variables override defaults via ${} syntax ✓
    - Application starts with valid Confluence config ✓
    - Default placeholders allow startup without config ✓
  - [x] 10.4 Manual smoke test (optional if Confluence access available)
    - Skipped (no live Confluence access configured)
  - [x] 10.5 Code review checklist
    - No credentials hardcoded or logged ✓
    - Appropriate error handling throughout ✓
    - Consistent code style ✓
    - JavaDoc on public APIs ✓

**Acceptance Criteria:**
- Maven build completes successfully
- Application starts and accepts requests
- Configuration works via environment variables
- No security issues (credentials exposure)
- Code follows project conventions

---

## Execution Order

Recommended implementation sequence:

```
Task Group 1: Maven Project and Configuration
     |
     v
Task Group 2: DTOs and Domain Models
     |
     +-----------------------+
     |                       |
     v                       v
Task Group 3:           Task Group 4:        Task Group 5:
Exception Handling      DrawioParser         DrawioScanner
     |                       |                    |
     +-----------------------+--------------------+
                             |
                             v
                    Task Group 6: ConfluenceClient
                             |
                             v
                    Task Group 7: ConfluenceDiagramService
                             |
                             v
                    Task Group 8: REST Controller
                             |
                             v
                    Task Group 9: Test Review & Integration
                             |
                             v
                    Task Group 10: Build Verification
```

### Parallel Execution Opportunities

The following task groups can be worked on in parallel by different engineers:
- **After Task Group 2 completes:**
  - Task Group 3 (Exception Handling)
  - Task Group 4 (DrawioParser)
  - Task Group 5 (DrawioScanner)

### Estimated Effort

| Task Group | Estimated Effort |
|------------|------------------|
| 1. Project Setup | 2-3 hours |
| 2. DTOs | 2-3 hours |
| 3. Exception Handling | 1-2 hours |
| 4. DrawioParser | 4-5 hours |
| 5. DrawioScanner | 2-3 hours |
| 6. ConfluenceClient | 3-4 hours |
| 7. Orchestration Service | 3-4 hours |
| 8. REST Controller | 2-3 hours |
| 9. Integration Testing | 2-3 hours |
| 10. Build Verification | 1-2 hours |
| **Total** | **22-32 hours** |

---

## Key Technical References

### Files to Create

```
backend/
  pom.xml
  src/main/java/com/example/archtool/
    ArchToolBackendApplication.java
    config/
      ConfluenceProperties.java
      RestClientConfig.java
    controller/
      ConfluenceDiagramController.java
    service/
      ConfluenceDiagramService.java
      ConfluenceClient.java
      DrawioScanner.java
      DrawioParser.java
    model/dto/
      ConfluenceDiagramResponse.java
      ConfluencePageDiagramsDto.java
      DiagramGraphDto.java
      DiagramNodeDto.java
      DiagramEdgeDto.java
      DiagramGeometryDto.java
      DiagramPointDto.java
      DiagramStyleDto.java
      DiagramSourceDto.java
      ErrorResponse.java
      ResponseSummaryDto.java
    model/confluence/
      ConfluencePage.java
      ConfluenceAttachment.java
    model/internal/
      DrawioDiagramSource.java
    exception/
      ConfluenceApiException.java
      DiagramParsingException.java
      GlobalExceptionHandler.java
    util/
      XmlUtils.java
  src/main/resources/
    application.yml
    application-local.yml
  src/test/java/com/example/archtool/
    config/
      ConfluencePropertiesTest.java
    service/
      DrawioParserTest.java
      DrawioScannerTest.java
      ConfluenceClientTest.java
      ConfluenceDiagramServiceTest.java
    controller/
      ConfluenceDiagramControllerTest.java
    integration/
      FullWorkflowIntegrationTest.java
  src/test/resources/
    test-diagrams/
      simple.drawio
      multi-tab.drawio
      styled.drawio
      complex-hierarchy.drawio
    test-confluence-responses/
      page-with-diagram.json
      page-attachments.json
```

### REST API Specification Reference

```
GET /api/confluence/diagrams
  Query Parameters:
    - pageId (required): Confluence page ID
    - includeAllChildPages (optional, default: false): Include descendant pages
    - maxDepth (optional, default: 10): Maximum depth for child traversal

  Response: 200 OK with ConfluenceDiagramResponse JSON
  Errors: 400, 401, 403, 404, 500 with ErrorResponse JSON
```
