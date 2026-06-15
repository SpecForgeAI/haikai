# Specification: Jira Search API Migration (fix 410 GONE)

## Goal
Migrate `JiraSearchService` from the deprecated `GET /rest/api/3/search` endpoint (which now returns `410 GONE`) to the supported `POST /rest/api/3/search/jql` endpoint, preserving all existing paging, field-selection, and child-expansion behavior.

## User Stories
- As the jira-service, I want to call the supported Jira Cloud search endpoint so that issue fetching no longer fails with a 410 GONE error.
- As a developer, I want a `startAt` parameter on `searchIssues()` so that future pagination work can be added without another method-signature change.

## Specific Requirements

**Replace GET with POST in JiraSearchService.searchIssues()**
- Change the `RestClient` call chain from `restClient.get().uri(Function<UriBuilder, URI>)` to `restClient.post().uri("/rest/api/3/search/jql")`
- Set `Content-Type: application/json` on the individual request via `.contentType(MediaType.APPLICATION_JSON)` -- do NOT add it as a default header on the `RestClient` bean
- Pass a `JiraSearchRequest` object as the POST body via `.body(requestDto)`
- The rest of the chain (`.retrieve().body(JiraSearchResponse.class)`) remains the same
- Update the Javadoc on the class and method to reference `POST /rest/api/3/search/jql` instead of `GET /rest/api/3/search`

**Add startAt parameter to searchIssues() method signature**
- Change the signature from `searchIssues(String jql, int maxResults)` to `searchIssues(String jql, int startAt, int maxResults)`
- The new `startAt` parameter is positioned as the second argument, between `jql` and `maxResults`
- All existing callers must be updated to pass `0` as the `startAt` value

**Convert REQUESTED_FIELDS from String to List<String>**
- Change `public static final String REQUESTED_FIELDS = "summary,issuetype,..."` to `public static final List<String> REQUESTED_FIELDS = List.of("summary", "issuetype", "status", "priority", "parent", "created", "updated", "description")`
- The same eight field names are preserved; only the data structure changes from comma-separated string to an immutable list
- This list is passed directly into the `JiraSearchRequest` DTO's `fields` property

**Create JiraSearchRequest DTO**
- Create a new Java record `JiraSearchRequest` in package `com.example.jiraservice.model.dto.jira` (alongside the existing Jira DTOs)
- Fields: `String jql`, `int startAt`, `int maxResults`, `List<String> fields`
- Annotate with `@JsonNaming(PropertyNamingStrategies.LowerCamelCaseStrategy.class)` to override the global `SNAKE_CASE` Jackson strategy configured in `application.yml` -- this is critical because the Jira API expects `startAt`, `maxResults` (camelCase), but the global config would serialize them as `start_at`, `max_results`
- The `@JsonNaming` annotation is preferred over individual `@JsonProperty` annotations because all four fields need camelCase and a single class-level annotation is cleaner

**Update ChildExpansionService call site**
- Line 56 of `ChildExpansionService.java` calls `jiraSearchService.searchIssues(jql, BATCH_SIZE)` -- update to `jiraSearchService.searchIssues(jql, 0, BATCH_SIZE)` to pass `startAt = 0`
- No other changes to `ChildExpansionService` are needed; its batching and aggregation logic is unaffected

**Update JiraIssueController call site**
- Line 73 of `JiraIssueController.java` calls `jiraSearchService.searchIssues(effectiveJql, maxResults)` -- update to `jiraSearchService.searchIssues(effectiveJql, 0, maxResults)` to pass `startAt = 0`
- The controller's external HTTP contract (`GET /jira/issues` with the same query parameters) is completely unchanged

**Update JiraSearchServiceTest to mock POST chain**
- Replace the `RestClient.RequestHeadersUriSpec<?>` and `RestClient.RequestHeadersSpec<?>` mocks with `RestClient.RequestBodyUriSpec` and `RestClient.RequestBodySpec` mocks appropriate for a POST chain
- The `setupMockChain()` helper must change from `restClient.get()` -> `requestHeadersUriSpec.uri(Function)` -> `requestHeadersSpec.retrieve()` to `restClient.post()` -> `requestBodyUriSpec.uri(String)` -> `requestBodySpec.contentType(MediaType.APPLICATION_JSON)` -> `requestBodySpec.body(JiraSearchRequest)` -> `requestBodySpec.retrieve()`
- Test `searchIssuesParsesResponseIntoIssueObjects`: update mock chain, update `searchIssues()` call to pass 3 args (add `0` for `startAt`), assertions remain the same
- Test `searchIssuesUsesProvidedJqlQuery`: replace the `ArgumentCaptor<Function<UriBuilder, URI>>` with an `ArgumentCaptor<JiraSearchRequest>` to capture the POST body. Verify that `capturedRequest.jql()` equals the custom JQL string and `capturedRequest.maxResults()` equals 25. Also verify `capturedRequest.startAt()` equals 0
- Test `searchIssuesRequestsCorrectFieldsParameter`: replace the URI-based verification with an `ArgumentCaptor<JiraSearchRequest>`. Verify that `capturedRequest.fields()` equals the expected `List<String>` of eight field names (matching `JiraSearchService.REQUESTED_FIELDS`)

**Update ChildExpansionServiceTest mock matchers**
- Line 49 mocks `jiraSearchService.searchIssues(anyString(), anyInt())` -- update to `jiraSearchService.searchIssues(anyString(), anyInt(), anyInt())` to match the new 3-argument signature
- Line 56 verifies `searchIssues(jqlCaptor.capture(), eq(50))` -- update to `searchIssues(jqlCaptor.capture(), eq(0), eq(50))` to verify `startAt = 0` is passed

**Update JiraIssueControllerTest mock matchers**
- Lines 112 and 179 mock `jiraSearchService.searchIssues(anyString(), anyInt())` -- update both to `searchIssues(anyString(), anyInt(), anyInt())` to match the new 3-argument signature

**JiraSearchResponse requires no changes**
- Confirmed: the `POST /rest/api/3/search/jql` response returns the same top-level fields (`startAt`, `maxResults`, `total`, `issues`) as the deprecated GET endpoint
- The existing `@JsonIgnoreProperties(ignoreUnknown = true)` on `JiraSearchResponse` and all nested DTOs (`JiraIssue`, `JiraIssueFields`, etc.) ensures forward compatibility if Jira adds new response fields

## Visual Design
No visual assets -- this is a backend-only API migration with no UI changes.

## Existing Code to Leverage

**JiraSearchService.java (service/JiraSearchService.java)**
- This is the primary file being modified; the existing `RestClient` injection via `@Qualifier("jiraRestClient")` constructor pattern is retained
- The existing null-check and logging after the API call (`if (response != null)`) is retained as-is
- The `REQUESTED_FIELDS` constant stays in this class but changes from `String` to `List<String>`

**JiraSearchResponse.java and nested DTOs (model/dto/jira/)**
- `JiraSearchResponse`, `JiraIssue`, `JiraIssueFields`, `JiraNamedField`, `JiraParentField`, `JiraPriorityField` -- all remain completely unchanged
- All use `@JsonIgnoreProperties(ignoreUnknown = true)` which ensures safe deserialization from the new endpoint's response
- The new `JiraSearchRequest` record should follow the same record-style pattern as these existing DTOs and be placed in the same `model.dto.jira` package

**JiraRestClientConfig.java (config/JiraRestClientConfig.java)**
- The `RestClient` bean already configures base URL, auth headers, and timeouts -- all of this is reused without modification
- The bean sets `Accept: application/json` as a default header but does NOT set `Content-Type` -- this is intentional and must remain unchanged per requirements

**WorkItemDto.java (model/dto/WorkItemDto.java)**
- Uses explicit `@JsonProperty` annotations for snake_case field names -- this is a different pattern from the `@JsonNaming` approach recommended for `JiraSearchRequest`, but it works because `WorkItemDto` is a response DTO subject to the global SNAKE_CASE strategy, whereas `JiraSearchRequest` is an outbound request that must serialize as camelCase for the Jira API

**application.yml Jackson configuration**
- `spring.jackson.property-naming-strategy: SNAKE_CASE` is configured globally -- this is the reason the new `JiraSearchRequest` must explicitly use `@JsonNaming(PropertyNamingStrategies.LowerCamelCaseStrategy.class)` to override serialization for outbound Jira requests

## Out of Scope
- Do NOT modify `JiraRestClientConfig.java` (no default Content-Type header changes)
- Do NOT modify `GlobalExceptionHandler.java`
- Do NOT modify gateway routes (`gateway/src/routes/jiraIssues.ts`)
- Do NOT modify `JiraIssueMappingService.java` or `TypeMappingService.java`
- Do NOT modify `WorkItemDto.java`
- Do NOT modify any response DTOs (`JiraSearchResponse`, `JiraIssue`, `JiraIssueFields`, `JiraNamedField`, `JiraParentField`, `JiraPriorityField`)
- Do NOT implement full pagination iteration (fetching all pages in a loop) -- the `startAt` parameter is added for future-proofing only
- Do NOT make OAuth or authentication changes
- Do NOT change the external controller contract (`GET /jira/issues` query parameters and response shape)
- Do NOT modify `JiraProperties.java` or `application.yml`
