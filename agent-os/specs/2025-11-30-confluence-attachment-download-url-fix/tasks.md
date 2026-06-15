# Task Breakdown: Confluence Attachment Download URL Fix

## Overview
Total Tasks: 24 (across 5 task groups)

This is a backend-only technical refactoring to simplify and harden Confluence attachment download logic by:
- Removing the dual RestClient architecture
- Using the official REST API download endpoint with pageId + attachmentId
- Ensuring compatibility with scoped service account tokens

## Task List

### Configuration Layer

#### Task Group 1: Configuration and Properties Cleanup
**Dependencies:** None

- [x] 1.0 Complete configuration layer cleanup
  - [x] 1.1 Write 2-4 focused tests for configuration changes
    - Test that ConfluenceProperties loads correctly without uiAndFileBaseUrl
    - Test that required properties (apiBaseUrl, username, apiToken) are still validated
    - Test that application context starts successfully with updated config
  - [x] 1.2 Update ConfluenceProperties.java record
    - Remove uiAndFileBaseUrl field from the record definition
    - Remove Objects.requireNonNull(uiAndFileBaseUrl, ...) validation from compact constructor (line 45)
    - Keep apiBaseUrl, username, apiToken, timeout, and depth fields unchanged
    - Update class-level Javadoc to remove mention of dual base URLs
  - [x] 1.3 Update application.yml configuration
    - Remove archtool.confluence.ui-and-file-base-url property (line 7)
    - Keep api-base-url, username, api-token, timeout, and depth settings unchanged
  - [x] 1.4 Update application-local.yml configuration
    - Remove ui-and-file-base-url property if present
    - Keep all other Confluence settings unchanged
  - [x] 1.5 Update test configuration files
    - Remove ui-and-file-base-url from src/test/resources/application.yml if present
    - Ensure test configurations align with production configuration shape
  - [x] 1.6 Ensure configuration tests pass
    - Run ONLY the 2-4 tests written in 1.1
    - Verify application context loads with updated configuration
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-4 tests written in 1.1 pass
- ConfluenceProperties record compiles without uiAndFileBaseUrl field
- All YAML configuration files updated consistently
- Application context starts successfully with simplified configuration

---

### RestClient Bean Layer

#### Task Group 2: RestClient Bean Consolidation
**Dependencies:** Task Group 1

- [x] 2.0 Complete RestClient bean cleanup
  - [x] 2.1 Write 2-4 focused tests for RestClient bean changes
    - Test that only confluenceApiRestClient bean is created
    - Test that confluenceApiRestClient bean has correct base URL and authentication
    - Test that application context starts without confluenceFileRestClient bean
  - [x] 2.2 Update RestClientConfig.java to remove file client bean
    - Delete the confluenceFileRestClient() bean method entirely
    - Remove any @Qualifier annotations referencing confluenceFileRestClient
    - Keep confluenceApiRestClient() bean method unchanged (lines 40-53)
    - Keep createRequestFactory() helper method for timeout configuration
    - Keep addAuthenticationHeader() helper method
    - Update class-level Javadoc to describe single client architecture
  - [x] 2.3 Remove unused imports from RestClientConfig.java
    - Remove any imports that were only used by confluenceFileRestClient bean
    - Ensure remaining imports are used
  - [x] 2.4 Ensure RestClient bean tests pass
    - Run ONLY the 2-4 tests written in 2.1
    - Verify single RestClient bean is created correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-4 tests written in 2.1 pass
- Only confluenceApiRestClient bean exists in RestClientConfig.java
- No references to confluenceFileRestClient remain in config
- Class-level Javadoc updated to reflect single client

---

### Service Layer

#### Task Group 3: ConfluenceClient Service Refactoring
**Dependencies:** Task Groups 1, 2

- [x] 3.0 Complete ConfluenceClient service refactoring
  - [x] 3.1 Write 4-6 focused tests for download logic changes
    - Test URL construction: given pageId="98433" and attachmentId="131287", assert path is /rest/api/content/98433/child/attachment/131287/download
    - Test successful download returns byte[] content via mocked RestClient
    - Test that request is sent to correct path (not using attachment.downloadUrl())
    - Test 404 error handling with correct error message format including pageId and attachmentId
    - Test 401 unauthorized error handling
  - [x] 3.2 Update ConfluenceClient constructor
    - Remove @Qualifier("confluenceFileRestClient") parameter
    - Remove fileRestClient field from the class
    - Keep only apiRestClient field (or rename to restClient if cleaner)
    - Update constructor Javadoc to reflect single client injection
  - [x] 3.3 Update downloadAttachment() method signature
    - Change from downloadAttachment(ConfluenceAttachment attachment) to downloadAttachment(String pageId, ConfluenceAttachment attachment)
    - The pageId parameter is required to construct the REST API download endpoint
  - [x] 3.4 Implement new URL construction logic in downloadAttachment()
    - Construct download path: "/rest/api/content/" + pageId + "/child/attachment/" + attachment.id() + "/download"
    - Use apiRestClient.get().uri(downloadEndpointPath) for the request
    - Do NOT use attachment.downloadUrl() when constructing the HTTP request
  - [x] 3.5 Remove old download logic branches
    - Remove code that checks if attachment.downloadUrl() is absolute (http:// or https://)
    - Remove code that uses fileRestClient
    - Remove code that attempts to prefix downloadUrl with UI or API base URLs
    - Delete any dead code related to the old download approach
  - [x] 3.6 Update error handling and logging
    - Update error message format: "Failed to download attachment via REST API: " + attachment.title() + " (pageId=" + pageId + ", attachmentId=" + attachment.id() + ")"
    - Add DEBUG level log: log.debug("Downloading attachment: {} via REST API path: {}", attachment.title(), downloadEndpointPath)
    - Maintain existing ConfluenceApiException pattern
    - Do not log the full URL at INFO level to avoid potential sensitive data exposure
  - [x] 3.7 Update class-level Javadoc in ConfluenceClient.java
    - Remove references to "dual RestClient" architecture
    - Document that all HTTP calls go through single API client
    - Update downloadAttachment method Javadoc to describe REST API endpoint usage
  - [x] 3.8 Update all call sites of downloadAttachment()
    - Find all locations that call downloadAttachment(attachment)
    - Update to pass pageId parameter: downloadAttachment(pageId, attachment)
    - The pageId is already available in the call chain since getAttachments(String pageId) is called first
  - [x] 3.9 Ensure service layer tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify download logic works with new URL construction
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 3.1 pass
- ConfluenceClient uses only single apiRestClient
- downloadAttachment() accepts pageId parameter
- Download URL is constructed using REST API pattern
- attachment.downloadUrl() is not used in download logic
- Error messages include pageId and attachmentId
- All call sites updated to pass pageId

---

### Test Infrastructure

#### Task Group 4: Test Infrastructure Updates
**Dependencies:** Task Groups 1, 2, 3

- [x] 4.0 Complete test infrastructure updates
  - [x] 4.1 Simplify ConfluenceClientTest.java setup
    - Remove mockFileServer (second MockWebServer instance) if present
    - Update test setup to use single mockApiServer for all tests
    - Remove any @BeforeEach or @AfterEach logic related to file server
    - Update test class-level comments if present
  - [x] 4.2 Update existing download tests
    - Update test method signatures to pass pageId to downloadAttachment()
    - Update mock server expectations to match new REST API path pattern
    - Verify tests check for /rest/api/content/{pageId}/child/attachment/{attachmentId}/download path
  - [x] 4.3 Remove obsolete tests
    - Delete tests that specifically test fileRestClient behavior
    - Delete tests for absolute vs relative downloadUrl handling
    - Delete tests that verify UI base URL usage
  - [x] 4.4 Ensure test infrastructure compiles and passes
    - Run all ConfluenceClientTest tests
    - Verify no compilation errors from removed file client references
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Test setup uses single MockWebServer
- All existing download tests updated for new signature
- Obsolete tests removed
- ConfluenceClientTest passes

---

### Final Validation

#### Task Group 5: Test Review, Gap Analysis, and Final Validation
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and validate full feature
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 2-4 tests written by configuration layer (Task 1.1)
    - Review the 2-4 tests written by RestClient bean layer (Task 2.1)
    - Review the 4-6 tests written by service layer (Task 3.1)
    - Review updated tests in ConfluenceClientTest.java (Task 4.2)
    - Total existing tests: approximately 10-18 tests
  - [x] 5.2 Analyze test coverage gaps for THIS feature only
    - Identify any critical workflows that lack test coverage
    - Focus ONLY on gaps related to the Confluence download URL fix
    - Do NOT assess entire application test coverage
    - Prioritize integration workflows over unit test gaps
  - [x] 5.3 Write up to 6 additional strategic tests maximum (if needed)
    - Add regression test confirming downloadUrl field is ignored
    - Add test verifying single RestClient is used for all Confluence calls
    - Add edge case test for attachment ID with special characters (if applicable)
    - Add test for download of large attachment (verify byte[] handling)
    - Focus on integration points between components
    - Do NOT write comprehensive coverage for all scenarios
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.2, and 5.3)
    - Expected total: approximately 16-24 tests maximum
    - Do NOT run the entire application test suite initially
  - [x] 5.5 Final full test suite validation
    - Run the complete test suite to verify no regressions
    - Fix any failing tests caused by the refactoring
    - Ensure all Confluence-related tests pass
  - [x] 5.6 Code cleanup and documentation review
    - Remove any TODO comments related to the old dual-client approach
    - Verify all Javadoc is updated consistently
    - Remove any commented-out code related to fileRestClient or uiAndFileBaseUrl
    - Ensure no orphaned imports in any modified files

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 16-24 tests total)
- Full test suite passes with no regressions
- Critical workflows for attachment download are covered
- No more than 6 additional tests added when filling in testing gaps
- All dead code and obsolete comments removed
- Javadoc updated across all modified files

---

## Execution Order

Recommended implementation sequence:

1. **Configuration Layer (Task Group 1)** - Remove unused configuration first to establish clean foundation
2. **RestClient Bean Layer (Task Group 2)** - Remove unused bean after configuration is updated
3. **Service Layer (Task Group 3)** - Refactor core download logic using single client
4. **Test Infrastructure (Task Group 4)** - Update test setup to match new architecture
5. **Final Validation (Task Group 5)** - Comprehensive testing and cleanup

## File Change Summary

### Files to Modify:
| File | Task Group | Changes |
|------|------------|---------|
| backend/src/main/java/.../config/ConfluenceProperties.java | 1 | Remove uiAndFileBaseUrl field and validation |
| backend/src/main/java/.../config/RestClientConfig.java | 2 | Remove confluenceFileRestClient bean |
| backend/src/main/java/.../service/ConfluenceClient.java | 3 | Remove fileRestClient, refactor downloadAttachment() |
| backend/src/main/resources/application.yml | 1 | Remove ui-and-file-base-url property |
| backend/src/main/resources/application-local.yml | 1 | Remove ui-and-file-base-url property |
| backend/src/test/resources/application.yml | 1 | Remove ui-and-file-base-url property (if present) |
| backend/src/test/java/.../service/ConfluenceClientTest.java | 4 | Update tests for single-client behavior |

### Files Unchanged:
- ConfluenceAttachment.java - Keep downloadUrl field (just ignore it in download logic)
- ConfluenceApiException.java - No changes needed
- Any controller or public API files - No changes needed (public REST API contract unchanged)

## Technical Notes

**Technology Stack:**
- Java 21
- Spring Boot 3.2.0
- Spring Web (RestClient - synchronous, not WebClient/reactive)
- JUnit 5 with MockWebServer for testing

**Configuration Prefix:**
- archtool.confluence.api-base-url (keep)
- archtool.confluence.ui-and-file-base-url (REMOVE)

**REST API Download Endpoint Pattern:**

    /rest/api/content/{pageId}/child/attachment/{attachmentId}/download

**Example Full URL:**

    https://api.atlassian.com/ex/confluence/{cloudId}/wiki/rest/api/content/98433/child/attachment/131287/download

**Authentication:**
- Basic auth with username:api-token (unchanged)
- Single auth header shared across all calls

**Key Code Changes:**

1. **ConfluenceProperties** (before -> after):

    // BEFORE
    public record ConfluenceProperties(
        String apiBaseUrl,
        String uiAndFileBaseUrl,  // REMOVE THIS
        String username,
        String apiToken,
        ...
    )

    // AFTER
    public record ConfluenceProperties(
        String apiBaseUrl,
        String username,
        String apiToken,
        ...
    )

2. **downloadAttachment()** method (before -> after):

    // BEFORE
    public byte[] downloadAttachment(ConfluenceAttachment attachment) {
        String downloadUrl = attachment.downloadUrl();
        // Complex logic checking absolute vs relative URLs
        // Using fileRestClient
    }

    // AFTER
    public byte[] downloadAttachment(String pageId, ConfluenceAttachment attachment) {
        String downloadPath = "/rest/api/content/" + pageId +
            "/child/attachment/" + attachment.id() + "/download";
        log.debug("Downloading attachment: {} via REST API path: {}",
            attachment.title(), downloadPath);
        return apiRestClient.get()
            .uri(downloadPath)
            .retrieve()
            .onStatus(HttpStatusCode::isError, ...)
            .body(byte[].class);
    }

**Error Message Format:**

    Failed to download attachment via REST API: {title} (pageId={pageId}, attachmentId={attachmentId})

## Implementation Summary

All 5 task groups have been successfully completed:

### Task Group 1: Configuration and Properties Cleanup
- Removed `uiAndFileBaseUrl` from `ConfluenceProperties.java` record
- Updated `application.yml`, `application-local.yml`, and `src/test/resources/application.yml`
- Created 4 tests in `ConfluencePropertiesTest.java`
- Updated `ApplicationContextTest.java` to work with new configuration

### Task Group 2: RestClient Bean Consolidation
- Removed `confluenceFileRestClient` bean from `RestClientConfig.java`
- Updated class-level Javadoc to describe single client architecture
- Created 4 tests in `RestClientConfigTest.java`

### Task Group 3: ConfluenceClient Service Refactoring
- Changed `downloadAttachment(ConfluenceAttachment)` to `downloadAttachment(String pageId, ConfluenceAttachment)`
- Implemented new URL construction: `/rest/api/content/{pageId}/child/attachment/{attachmentId}/download`
- Updated `ConfluenceDiagramService.java` to pass pageId to downloadAttachment
- Added 10 tests in `ConfluenceClientTest.java` for download functionality

### Task Group 4: Test Infrastructure Updates
- Simplified test setup to use single MockWebServer
- Updated all download tests to use new method signature
- Updated `ConfluenceDiagramServiceTest.java` mock expectations
- Updated `FullWorkflowIntegrationTest.java` to use single RestClient

### Task Group 5: Final Validation
- All 79 tests pass with no regressions
- Javadoc updated across all modified files
- No dead code or obsolete comments remain
