# Task Breakdown: Jira Search API Migration (fix 410 GONE)

## Overview
Total Tasks: 17 (across 4 task groups)

This migration replaces the deprecated `GET /rest/api/3/search` endpoint (now returning `410 GONE`) with `POST /rest/api/3/search/jql` in the jira-service. The work is entirely backend -- no UI, gateway, or database changes are involved.

**Base path for all source files:**
`C:\Workspaces\SSD\architecture-store-and-diagrams\jira-service\src`

---

## Task List

### DTO Layer

#### Task Group 1: Create JiraSearchRequest DTO
**Dependencies:** None

This task group is done first because the new DTO is a leaf dependency -- nothing existing references it yet, so creating it cannot break the build.

- [x] 1.0 Complete JiraSearchRequest DTO
  - [x] 1.1 Write 2 focused tests for JiraSearchRequest serialization
    - Create test file: `test/java/com/example/jiraservice/model/dto/jira/JiraSearchRequestTest.java`
    - **Test 1 -- camelCase serialization**: Instantiate a `JiraSearchRequest` with sample values, serialize it to JSON using an `ObjectMapper` configured with `PropertyNamingStrategies.SNAKE_CASE` (mimicking the global `application.yml` config at line 6: `property-naming-strategy: SNAKE_CASE`), and assert the output JSON contains the keys `jql`, `startAt`, `maxResults`, `fields` (camelCase), NOT `start_at` or `max_results` (snake_case). This validates the `@JsonNaming(LowerCamelCaseStrategy.class)` annotation works correctly against the global SNAKE_CASE strategy.
    - **Test 2 -- fields list serialization**: Instantiate a `JiraSearchRequest` with `fields = List.of("summary", "issuetype", "status")`, serialize to JSON, and assert the `fields` key is a JSON array `["summary","issuetype","status"]`, not a comma-separated string.
  - [x] 1.2 Create `JiraSearchRequest` record
    - Create new file: `main/java/com/example/jiraservice/model/dto/jira/JiraSearchRequest.java`
    - Package: `com.example.jiraservice.model.dto.jira` (same package as the existing `JiraSearchResponse.java`, `JiraIssue.java`, etc.)
    - Define as a Java record with four fields: `String jql`, `int startAt`, `int maxResults`, `List<String> fields`
    - Add class-level annotation: `@JsonNaming(PropertyNamingStrategies.LowerCamelCaseStrategy.class)` -- this overrides the global `SNAKE_CASE` Jackson strategy from `application.yml` line 6, ensuring the Jira API receives camelCase keys (`startAt`, `maxResults`) instead of snake_case (`start_at`, `max_results`)
    - Required imports: `com.fasterxml.jackson.databind.PropertyNamingStrategies`, `com.fasterxml.jackson.databind.annotation.JsonNaming`, `java.util.List`
    - Follow the same record-style pattern as the existing DTOs in this package (e.g., `JiraSearchResponse.java` at lines 14-19, `JiraIssue.java` at lines 12-15)
  - [x] 1.3 Run Task Group 1 tests
    - Run ONLY `JiraSearchRequestTest` to verify the DTO serializes correctly
    - Command: `mvn test -pl jira-service -Dtest=com.example.jiraservice.model.dto.jira.JiraSearchRequestTest`

**Acceptance Criteria:**
- `JiraSearchRequest` record exists in the `model.dto.jira` package
- Serialization produces camelCase keys despite the global SNAKE_CASE Jackson config
- The `fields` property serializes as a JSON array of strings
- The 2 tests pass

---

### Service Layer

#### Task Group 2: Migrate JiraSearchService from GET to POST
**Dependencies:** Task Group 1 (requires `JiraSearchRequest` DTO)

This is the core migration. The method signature change, constant type change, and RestClient call chain change all happen atomically in a single file. The build will temporarily break callers (fixed in Task Group 3), but this group's own tests will pass.

- [x] 2.0 Complete JiraSearchService migration
  - [x] 2.1 Convert `REQUESTED_FIELDS` from `String` to `List<String>`
    - File: `main/java/com/example/jiraservice/service/JiraSearchService.java`
    - **Lines 21-22**: Replace:
      ```java
      public static final String REQUESTED_FIELDS =
          "summary,issuetype,status,priority,parent,created,updated,description";
      ```
      With:
      ```java
      public static final List<String> REQUESTED_FIELDS = List.of(
          "summary", "issuetype", "status", "priority", "parent", "created", "updated", "description");
      ```
    - Add import: `java.util.List`
    - The same eight field names are preserved; only the data structure changes
  - [x] 2.2 Add `startAt` parameter to the `searchIssues()` method signature
    - File: `main/java/com/example/jiraservice/service/JiraSearchService.java`
    - **Line 37**: Change method signature from:
      ```java
      public JiraSearchResponse searchIssues(String jql, int maxResults)
      ```
      To:
      ```java
      public JiraSearchResponse searchIssues(String jql, int startAt, int maxResults)
      ```
    - **Lines 30-36**: Update the Javadoc to include the new `@param startAt` doc between `@param jql` and `@param maxResults`:
      ```
      @param startAt   the zero-based index of the first result to return (for pagination)
      ```
  - [x] 2.3 Replace the GET RestClient call chain with POST
    - File: `main/java/com/example/jiraservice/service/JiraSearchService.java`
    - **Lines 40-48**: Replace the entire GET-based RestClient chain:
      ```java
      JiraSearchResponse response = jiraRestClient.get()
          .uri(uriBuilder -> uriBuilder
              .path("/rest/api/3/search")
              .queryParam("jql", jql)
              .queryParam("maxResults", maxResults)
              .queryParam("fields", REQUESTED_FIELDS)
              .build())
          .retrieve()
          .body(JiraSearchResponse.class);
      ```
      With the POST-based chain:
      ```java
      JiraSearchRequest requestDto = new JiraSearchRequest(jql, startAt, maxResults, REQUESTED_FIELDS);

      JiraSearchResponse response = jiraRestClient.post()
          .uri("/rest/api/3/search/jql")
          .contentType(MediaType.APPLICATION_JSON)
          .body(requestDto)
          .retrieve()
          .body(JiraSearchResponse.class);
      ```
    - Add imports: `com.example.jiraservice.model.dto.jira.JiraSearchRequest`, `org.springframework.http.MediaType`
    - Note: `Content-Type` is set on the individual request (`.contentType(MediaType.APPLICATION_JSON)`), NOT as a default header on the RestClient bean (per spec requirement)
  - [x] 2.4 Update class and method Javadoc
    - File: `main/java/com/example/jiraservice/service/JiraSearchService.java`
    - **Lines 10-15**: Update the class-level Javadoc from:
      ```
      Calls {@code GET /rest/api/3/search} with JQL query and field parameters
      ```
      To:
      ```
      Calls {@code POST /rest/api/3/search/jql} with a JSON request body containing
      JQL query, pagination, and field parameters
      ```
  - [x] 2.5 Rewrite `JiraSearchServiceTest` to mock the POST chain
    - File: `test/java/com/example/jiraservice/service/JiraSearchServiceTest.java`
    - **Lines 34-36**: Replace the GET-oriented mock fields:
      ```java
      @Mock
      private RestClient.RequestHeadersUriSpec<?> requestHeadersUriSpec;
      @Mock
      private RestClient.RequestHeadersSpec<?> requestHeadersSpec;
      ```
      With POST-oriented mock fields:
      ```java
      @Mock
      private RestClient.RequestBodyUriSpec requestBodyUriSpec;
      @Mock
      private RestClient.RequestBodySpec requestBodySpec;
      ```
    - **Lines 50-56**: Rewrite the `setupMockChain()` helper from the GET chain:
      ```java
      when(restClient.get()).thenReturn((RestClient.RequestHeadersUriSpec) requestHeadersUriSpec);
      when(requestHeadersUriSpec.uri(any(Function.class))).thenReturn((RestClient.RequestHeadersSpec) requestHeadersSpec);
      when(requestHeadersSpec.retrieve()).thenReturn(responseSpec);
      ```
      To the POST chain:
      ```java
      when(restClient.post()).thenReturn(requestBodyUriSpec);
      when(requestBodyUriSpec.uri("/rest/api/3/search/jql")).thenReturn(requestBodySpec);
      when(requestBodySpec.contentType(MediaType.APPLICATION_JSON)).thenReturn(requestBodySpec);
      when(requestBodySpec.body(any(JiraSearchRequest.class))).thenReturn(requestBodySpec);
      when(requestBodySpec.retrieve()).thenReturn(responseSpec);
      ```
    - Add import: `org.springframework.http.MediaType`
    - Remove unused imports: `java.net.URI`, `java.util.function.Function` (no longer needed since we are not building URIs)
    - **Lines 90-91** (test `searchIssuesParsesResponseIntoIssueObjects`): Update the method call from 2 args to 3:
      ```java
      // Before:
      jiraSearchService.searchIssues("project = PROJ ORDER BY created DESC", 50);
      // After:
      jiraSearchService.searchIssues("project = PROJ ORDER BY created DESC", 0, 50);
      ```
    - **Lines 103-137** (test `searchIssuesUsesProvidedJqlQuery`): Replace the entire test body. Remove the `ArgumentCaptor<Function<...>>` URI approach and replace with an `ArgumentCaptor<JiraSearchRequest>`:
      - Set up the POST mock chain (call `setupMockChain(mockResponse)`)
      - Call `jiraSearchService.searchIssues(customJql, 0, 25)`
      - Use `ArgumentCaptor<JiraSearchRequest>` to capture the body passed to `requestBodySpec.body(...)`
      - Assert `capturedRequest.jql()` equals the custom JQL string
      - Assert `capturedRequest.startAt()` equals `0`
      - Assert `capturedRequest.maxResults()` equals `25`
    - **Lines 139-166** (test `searchIssuesRequestsCorrectFieldsParameter`): Replace the entire test body. Remove the URI-based verification and replace with an `ArgumentCaptor<JiraSearchRequest>`:
      - Set up the POST mock chain (call `setupMockChain(mockResponse)`)
      - Call `jiraSearchService.searchIssues("project = PROJ", 0, 50)`
      - Use `ArgumentCaptor<JiraSearchRequest>` to capture the body passed to `requestBodySpec.body(...)`
      - Assert `capturedRequest.fields()` equals `JiraSearchService.REQUESTED_FIELDS` (the `List<String>` of eight field names)
  - [x] 2.6 Run Task Group 2 tests
    - Run ONLY `JiraSearchServiceTest` to verify the service migration
    - Command: `mvn test -pl jira-service -Dtest=com.example.jiraservice.service.JiraSearchServiceTest`
    - All 3 existing tests (now rewritten for POST) must pass

**Acceptance Criteria:**
- `JiraSearchService.searchIssues()` calls `POST /rest/api/3/search/jql` with a JSON body
- Method signature accepts `(String jql, int startAt, int maxResults)`
- `REQUESTED_FIELDS` is a `List<String>` with the same eight field names
- `Content-Type: application/json` is set on the individual request, not on the RestClient bean
- All 3 rewritten tests in `JiraSearchServiceTest` pass
- Note: The build will have compile errors in `ChildExpansionService`, `JiraIssueController`, and their tests due to the method signature change -- these are fixed in Task Group 3

---

### Call-Site Updates

#### Task Group 3: Update All Callers to Pass `startAt = 0`
**Dependencies:** Task Group 2 (method signature has changed)

This group fixes all compilation errors caused by the method signature change in Task Group 2. Each file requires a single-line change. After this group, the project compiles cleanly again.

- [x] 3.0 Complete call-site updates
  - [x] 3.1 Update `ChildExpansionService.java` call site
    - File: `main/java/com/example/jiraservice/service/ChildExpansionService.java`
    - **Line 56**: Change from:
      ```java
      JiraSearchResponse response = jiraSearchService.searchIssues(jql, BATCH_SIZE);
      ```
      To:
      ```java
      JiraSearchResponse response = jiraSearchService.searchIssues(jql, 0, BATCH_SIZE);
      ```
    - No other changes to this file -- the batching, aggregation, and JQL-building logic are all unaffected
  - [x] 3.2 Update `JiraIssueController.java` call site
    - File: `main/java/com/example/jiraservice/controller/JiraIssueController.java`
    - **Line 73**: Change from:
      ```java
      JiraSearchResponse searchResponse = jiraSearchService.searchIssues(effectiveJql, maxResults);
      ```
      To:
      ```java
      JiraSearchResponse searchResponse = jiraSearchService.searchIssues(effectiveJql, 0, maxResults);
      ```
    - The external HTTP contract (`GET /jira/issues` with the same query parameters and response shape) is completely unchanged
  - [x] 3.3 Update `ChildExpansionServiceTest.java` mock matchers
    - File: `test/java/com/example/jiraservice/service/ChildExpansionServiceTest.java`
    - **Line 49**: Change the mock setup from 2-arg matcher to 3-arg matcher:
      ```java
      // Before:
      when(jiraSearchService.searchIssues(anyString(), anyInt())).thenReturn(emptyResponse);
      // After:
      when(jiraSearchService.searchIssues(anyString(), anyInt(), anyInt())).thenReturn(emptyResponse);
      ```
    - **Line 56**: Change the verify call from 2-arg to 3-arg, inserting `eq(0)` for `startAt`:
      ```java
      // Before:
      verify(jiraSearchService, times(3)).searchIssues(jqlCaptor.capture(), eq(50));
      // After:
      verify(jiraSearchService, times(3)).searchIssues(jqlCaptor.capture(), eq(0), eq(50));
      ```
  - [x] 3.4 Update `JiraIssueControllerTest.java` mock matchers
    - File: `test/java/com/example/jiraservice/controller/JiraIssueControllerTest.java`
    - **Line 112**: Change from 2-arg to 3-arg matcher:
      ```java
      // Before:
      when(jiraSearchService.searchIssues(anyString(), anyInt())).thenReturn(searchResponse);
      // After:
      when(jiraSearchService.searchIssues(anyString(), anyInt(), anyInt())).thenReturn(searchResponse);
      ```
    - **Line 179**: Change from 2-arg to 3-arg matcher:
      ```java
      // Before:
      when(jiraSearchService.searchIssues(anyString(), anyInt())).thenReturn(parentResponse);
      // After:
      when(jiraSearchService.searchIssues(anyString(), anyInt(), anyInt())).thenReturn(parentResponse);
      ```
  - [x] 3.5 Run Task Group 3 tests
    - Run `ChildExpansionServiceTest` and `JiraIssueControllerTest` to verify call-site updates
    - Command: `mvn test -pl jira-service -Dtest="com.example.jiraservice.service.ChildExpansionServiceTest,com.example.jiraservice.controller.JiraIssueControllerTest"`
    - `ChildExpansionServiceTest`: 1 test must pass
    - `JiraIssueControllerTest`: 5 tests must pass

**Acceptance Criteria:**
- `ChildExpansionService` passes `startAt = 0` to `searchIssues()`
- `JiraIssueController` passes `startAt = 0` to `searchIssues()`
- All test mocks use the 3-argument signature
- `ChildExpansionServiceTest` (1 test) passes
- `JiraIssueControllerTest` (5 tests) pass
- The project compiles cleanly with zero errors

---

### Verification

#### Task Group 4: Full Test Suite Verification and Gap Analysis
**Dependencies:** Task Groups 1, 2, 3

- [x] 4.0 Verify the complete migration
  - [x] 4.1 Review all tests from Task Groups 1-3
    - Review the 2 tests from Task Group 1 (`JiraSearchRequestTest` -- DTO serialization)
    - Review the 3 tests from Task Group 2 (`JiraSearchServiceTest` -- POST chain, JQL body, fields body)
    - Review the 6 tests from Task Group 3 (`ChildExpansionServiceTest` -- 1 test, `JiraIssueControllerTest` -- 5 tests)
    - Total existing tests covering this feature: 11
  - [x] 4.2 Analyze test coverage gaps for this feature only
    - Confirm the following critical paths are covered:
      - JiraSearchRequest serializes with camelCase keys (covered by Task 1.1)
      - POST endpoint is called instead of GET (covered by Task 2.5 mock chain)
      - JQL, startAt, maxResults, and fields are passed in the request body (covered by Task 2.5)
      - ChildExpansionService passes startAt=0 (covered by Task 3.3 verify)
      - Controller passes startAt=0 (covered by Task 3.4 mock setup -- controller integration tests exercise the path)
    - Identify any gaps: the primary gap is that there is no explicit test verifying `startAt` is passed to the body in the controller integration path, but this is implicitly covered because the mock uses `anyInt()` matchers and the controller is tested end-to-end with MockMvc
  - [x] 4.3 Write up to 3 additional strategic tests if needed
    - If all critical paths are already covered by Tasks 1-3, no additional tests are required
    - If a gap is identified (e.g., missing verification that `Content-Type: application/json` is set on the POST request), add a focused test to `JiraSearchServiceTest` that verifies `requestBodySpec.contentType(MediaType.APPLICATION_JSON)` was called
    - Maximum of 3 additional tests
  - [x] 4.4 Run the full jira-service test suite
    - Command: `mvn test -pl jira-service`
    - This runs ALL tests in the jira-service module, including tests for files that were NOT modified (e.g., `JiraPropertiesTest`, `JiraRestClientConfigTest`, `GlobalExceptionHandlerTest`, `JiraIssueMappingServiceTest`, `TypeMappingServiceTest`, `DeterministicIdGeneratorTest`, `JiraIntegrationGapTests`) to confirm no regressions
    - All tests must pass (expected: ~20+ tests across all test classes)
  - [x] 4.5 Verify the project compiles and packages successfully
    - Command: `mvn package -pl jira-service -DskipTests`
    - Confirms the JAR builds cleanly with all changes
  - [x] 4.6 Final checklist -- verify out-of-scope files are untouched
    - Confirm NO changes to: `JiraRestClientConfig.java` (lines 1-84 unchanged)
    - Confirm NO changes to: `GlobalExceptionHandler.java`
    - Confirm NO changes to: `JiraIssueMappingService.java`
    - Confirm NO changes to: `TypeMappingService.java`
    - Confirm NO changes to: `WorkItemDto.java`
    - Confirm NO changes to: `JiraSearchResponse.java` (lines 1-19 unchanged)
    - Confirm NO changes to: `JiraIssue.java`, `JiraIssueFields.java`, `JiraNamedField.java`, `JiraParentField.java`, `JiraPriorityField.java`
    - Confirm NO changes to: `application.yml`
    - Confirm NO changes to: `gateway/src/routes/jiraIssues.ts`

**Acceptance Criteria:**
- All jira-service tests pass (full suite, including unmodified test files)
- The project compiles and packages without errors
- No out-of-scope files were modified
- Total tests covering this feature: approximately 11-14

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1 -- DTO Layer** (JiraSearchRequest): Creates the new DTO with zero impact on existing code. Build remains green.
2. **Task Group 2 -- Service Layer** (JiraSearchService): Migrates the core service from GET to POST. Build will have compile errors in callers.
3. **Task Group 3 -- Call-Site Updates** (ChildExpansionService, JiraIssueController, and their tests): Fixes all callers to use the new 3-arg signature. Build is green again.
4. **Task Group 4 -- Verification** (Full test suite, gap analysis, out-of-scope check): Confirms everything works end-to-end with no regressions.

**Alternative approach**: Task Groups 2 and 3 can be done as a single atomic commit to avoid any intermediate compile-error state. If doing this, complete all sub-tasks from both groups before running any tests, then run the combined test suite.

---

## Files Modified (Summary)

| File | Action | Task |
|------|--------|------|
| `model/dto/jira/JiraSearchRequest.java` | **NEW** | 1.2 |
| `model/dto/jira/JiraSearchRequestTest.java` | **NEW** | 1.1 |
| `service/JiraSearchService.java` | MODIFY (lines 10-48) | 2.1, 2.2, 2.3, 2.4 |
| `service/JiraSearchServiceTest.java` | REWRITE (lines 34-166) | 2.5 |
| `service/ChildExpansionService.java` | MODIFY (line 56) | 3.1 |
| `service/ChildExpansionServiceTest.java` | MODIFY (lines 49, 56) | 3.3 |
| `controller/JiraIssueController.java` | MODIFY (line 73) | 3.2 |
| `controller/JiraIssueControllerTest.java` | MODIFY (lines 112, 179) | 3.4 |

## Files NOT Modified (Confirmed Out of Scope)

- `config/JiraRestClientConfig.java`
- `config/JiraProperties.java`
- `controller/GlobalExceptionHandler.java`
- `service/JiraIssueMappingService.java`
- `service/TypeMappingService.java`
- `model/dto/WorkItemDto.java`
- `model/dto/jira/JiraSearchResponse.java`
- `model/dto/jira/JiraIssue.java`
- `model/dto/jira/JiraIssueFields.java`
- `model/dto/jira/JiraNamedField.java`
- `model/dto/jira/JiraParentField.java`
- `model/dto/jira/JiraPriorityField.java`
- `resources/application.yml`
- `gateway/src/routes/jiraIssues.ts`
