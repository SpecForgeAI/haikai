# Spec Requirements: Jira-service -- migrate search to /rest/api/3/search/jql (fix 410 Gone)

## Initial Description

Update jira-service to stop calling the removed/deprecated Jira search endpoint and instead use the supported Jira Cloud API endpoint: /rest/api/3/search/jql. This resolves 410 GONE errors and keeps paging/fields behavior consistent.

### In Scope (from raw idea)
- JiraSearchService: replace old search call with /rest/api/3/search/jql
- Ensure request supports jql, startAt, maxResults, and requested fields
- Ensure child-expansion logic uses the same new endpoint for additional queries
- Update DTOs for request/response parsing if needed
- Update tests/mocks to target the new endpoint path and method

### Out of Scope (from raw idea)
- Changing higher-level controller contract (GET /jira/issues stays the same)
- Changing mapping to WorkItemDto
- OAuth changes

## Requirements Discussion

### First Round Questions

**Q1:** I assume the `JiraSearchResponse` record (with fields `startAt`, `maxResults`, `total`, `issues`) will remain compatible with the new `/rest/api/3/search/jql` response shape. The new Jira endpoint documentation is not easily machine-readable -- have you already confirmed that the response JSON structure from the new POST endpoint uses the same field names (`startAt`, `maxResults`, `total`, `issues`), or do we need to account for any renamed/restructured fields in the response?
**Answer:** Confirmed -- `/rest/api/3/search/jql` returns the same top-level fields: `startAt`, `maxResults`, `total`, `issues`. No DTO changes needed for the response.

**Q2:** I notice the current `JiraSearchService.searchIssues()` method signature is `searchIssues(String jql, int maxResults)` and it does not accept a `startAt` parameter. The `ChildExpansionService` also never passes `startAt`. I'm assuming `startAt` is not needed today (i.e., we always fetch from offset 0 and do not page through large result sets). Is that correct, or should we add `startAt` support as part of this migration to future-proof the method signature?
**Answer:** Yes -- add `startAt` support now (default to 0) for future-proofing. Update the `searchIssues()` method signature.

**Q3:** The new endpoint requires a POST with a JSON request body. I'm assuming we should create a simple request DTO (e.g., `JiraSearchRequest`) to represent the POST body with fields `jql`, `maxResults`, `fields`, and optionally `startAt`. Is that the right approach, or would you prefer to build the body inline as a `Map<String, Object>` to keep changes minimal?
**Answer:** Create a proper request DTO (`JiraSearchRequest`) -- cleaner and safer than inline maps.

**Q4:** The current `RestClient` bean is configured with `defaultHeader("Accept", "application/json")` but does NOT set a `Content-Type` header. Since the new endpoint requires a POST with a JSON body, we will need to ensure `Content-Type: application/json` is sent. I'm assuming we should add this as a default header on the `RestClient` bean in `JiraRestClientConfig`, since all future Jira API POST calls would need it. Is that acceptable, or do you prefer setting it only on the individual request?
**Answer:** Set `Content-Type: application/json` on the individual POST request only -- do NOT modify the `RestClient` bean in `JiraRestClientConfig`.

**Q5:** The `REQUESTED_FIELDS` constant in `JiraSearchService` is currently a comma-separated string (`"summary,issuetype,status,priority,parent,created,updated,description"`) suitable for a query parameter. The new POST endpoint's `fields` property in the JSON body expects an array of strings (e.g., `["summary", "issuetype", ...]`). I'm assuming we should convert this to a `List<String>` constant and update the request body accordingly. Is that correct?
**Answer:** Yes -- convert from comma-separated `String` to a `List<String>` constant.

**Q6:** The existing tests in `JiraSearchServiceTest` mock the `RestClient` chain starting with `restClient.get()` and use URI builder argument captors to verify query parameters. These will need to change to mock `restClient.post()` and verify the JSON request body instead. I'm assuming we should update all three existing test methods to use the new POST-based mock chain and verify the request body contents rather than URI parameters. Are there any additional test scenarios you want covered beyond what exists today?
**Answer:** No additional scenarios -- just update existing tests to mock `post()` + verify body, paging params, and fields array.

**Q7:** Is there anything that should be explicitly excluded from this change? For example, should we avoid touching the `JiraRestClientConfig`, `GlobalExceptionHandler`, `JiraIssueController`, or any gateway routes?
**Answer:** Explicitly do NOT touch `JiraRestClientConfig` (except if needed for headers), `GlobalExceptionHandler`, `JiraIssueController`, or gateway routes.

### Existing Code to Reference

No similar existing features identified for reference. The jira-service is the only Spring Boot service in this codebase making outbound REST calls to an external API using `RestClient` with a POST + JSON body pattern.

### Follow-up Questions

No follow-up questions were needed. All answers were clear and unambiguous.

## Visual Assets

### Files Provided:
No visual assets provided. The mandatory bash check of the `planning/visuals/` folder confirmed no image files are present.

### Visual Insights:
Not applicable -- this is a backend-only API migration with no UI changes.

## Requirements Summary

### Functional Requirements
- `JiraSearchService.searchIssues()` must call `POST /rest/api/3/search/jql` instead of `GET /rest/api/3/search`
- The method signature must be updated to accept `startAt` (int, default 0) in addition to existing `jql` and `maxResults` parameters
- The request body must be a JSON object containing `jql` (string), `startAt` (int), `maxResults` (int), and `fields` (array of strings)
- A new request DTO `JiraSearchRequest` must be created to represent the POST body
- The `REQUESTED_FIELDS` constant must change from a comma-separated `String` to a `List<String>`
- The `Content-Type: application/json` header must be set on the individual POST request, not on the `RestClient` bean
- The `JiraSearchResponse` record requires no changes (response structure is identical)
- `ChildExpansionService` requires no direct changes -- it delegates to `JiraSearchService.searchIssues()` which will be updated. However, its call sites must pass the new `startAt` parameter (defaulting to 0)
- Paging and child expansion must continue to function as before
- The external controller contract (`GET /jira/issues`) is unchanged

### Reusability Opportunities
- No existing POST + JSON body `RestClient` patterns exist in this codebase to model after
- The existing `JiraSearchResponse`, `JiraIssue`, `JiraIssueFields`, and related response DTOs are fully reusable without changes
- The `JiraRestClientConfig` bean (auth, base URL, timeouts) is reusable as-is

### Scope Boundaries

**In Scope:**
- `JiraSearchService.java` -- replace GET with POST, update URI, add request body, add `startAt` parameter
- New file: `JiraSearchRequest.java` -- request DTO record for the POST body
- `JiraSearchService.REQUESTED_FIELDS` -- convert from `String` to `List<String>`
- `JiraSearchServiceTest.java` -- update all 3 tests to mock `restClient.post()` and verify request body
- `ChildExpansionService.java` -- update call to `searchIssues()` to pass `startAt` (0)
- `ChildExpansionServiceTest.java` -- update mock setup to match new method signature (add `startAt` arg matcher)
- `JiraIssueController.java` -- update call to `searchIssues()` to pass `startAt` (0). Note: this is the minimal change to the call site only; the controller contract and behavior remain identical

**Out of Scope:**
- `JiraRestClientConfig.java` -- do NOT modify (no default Content-Type header)
- `GlobalExceptionHandler.java` -- do NOT modify
- Gateway routes (`gateway/src/routes/jiraIssues.ts`) -- do NOT modify
- `JiraIssueMappingService.java` -- do NOT modify
- `TypeMappingService.java` -- do NOT modify
- `WorkItemDto.java` -- do NOT modify
- OAuth or authentication changes
- Full pagination iteration (fetching all pages in a loop) -- only the `startAt` parameter is being added for future-proofing

### Technical Considerations
- The `RestClient` mock chain in tests must change from `restClient.get()` -> `requestHeadersUriSpec.uri(Function)` -> `requestHeadersSpec.retrieve()` to a POST-based chain: `restClient.post()` -> `requestBodyUriSpec.uri(String)` -> `requestBodySpec.contentType(MediaType.APPLICATION_JSON)` -> `requestBodySpec.body(JiraSearchRequest)` -> `requestBodySpec.retrieve()`
- The existing test `searchIssuesUsesProvidedJqlQuery` uses `ArgumentCaptor<Function<UriBuilder, URI>>` to verify query params. This must be replaced with an `ArgumentCaptor<JiraSearchRequest>` to verify the request body fields
- The existing test `searchIssuesRequestsCorrectFieldsParameter` must verify that `JiraSearchRequest.fields()` contains the expected `List<String>` instead of checking a URI query parameter
- The `ChildExpansionServiceTest` mocks `jiraSearchService.searchIssues(anyString(), anyInt())` -- this must be updated to `searchIssues(anyString(), anyInt(), anyInt())` to match the new 3-arg signature
- The `JiraIssueController` calls `jiraSearchService.searchIssues(effectiveJql, maxResults)` on line 73 -- this must be updated to pass `0` as the `startAt` value
- The `application.yml` uses `SNAKE_CASE` Jackson naming strategy globally. The new `JiraSearchRequest` fields must use camelCase in Java (e.g., `maxResults`, `startAt`) which will serialize to `max_results` and `start_at` under SNAKE_CASE. However, the Jira API expects `maxResults` and `startAt` (camelCase). This means the `JiraSearchRequest` record must either use `@JsonNaming(PropertyNamingStrategies.LowerCamelCaseStrategy.class)` or explicit `@JsonProperty` annotations to override the global SNAKE_CASE strategy for this outbound DTO
- The new `JiraSearchRequest` should be placed in the existing package `com.example.jiraservice.model.dto.jira` alongside the other Jira DTOs
