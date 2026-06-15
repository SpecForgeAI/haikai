# Specification: Confluence Attachment Download URL Fix

## Goal

Simplify and harden Confluence attachment download logic by removing the dual RestClient architecture and always using the official REST API download endpoint with pageId + attachmentId, ensuring compatibility with scoped service account tokens.

## User Stories

- As a backend developer, I want attachment downloads to use a single RestClient so that the code is simpler and authentication is consistent.
- As a system administrator, I want attachment downloads to work reliably with scoped API tokens so that the service operates correctly in production environments.

## Specific Requirements

**Remove the secondary fileRestClient bean and configuration**
- Delete the `confluenceFileRestClient` bean from `RestClientConfig.java`
- Remove the `uiAndFileBaseUrl` property from `ConfluenceProperties.java` record
- Remove the validation for `uiAndFileBaseUrl` in the compact constructor (line 45: `Objects.requireNonNull(uiAndFileBaseUrl, ...)`)
- Update the `ConfluenceClient` constructor to only accept a single RestClient (remove the `@Qualifier("confluenceFileRestClient")` parameter)
- Remove the `fileRestClient` field from `ConfluenceClient.java`

**Update configuration YAML files to remove unused property**
- Remove `ui-and-file-base-url` from `application.yml` (currently line 7)
- Remove `ui-and-file-base-url` from `application-local.yml` if present
- Keep `api-base-url`, `username`, `api-token`, timeout, and depth settings unchanged
- Update any test configuration files in `src/test/resources/application.yml`

**Refactor downloadAttachment method signature to accept pageId**
- Change method signature from `downloadAttachment(ConfluenceAttachment attachment)` to `downloadAttachment(String pageId, ConfluenceAttachment attachment)`
- The pageId is required to construct the REST API download endpoint
- Update all call sites of `downloadAttachment` to pass the pageId parameter
- The pageId is already available in the call chain since `getAttachments(String pageId)` is called first

**Construct download URL using REST API endpoint pattern**
- Build the download URL as: `"/rest/api/content/" + pageId + "/child/attachment/" + attachmentId + "/download"`
- Use `attachment.id()` to extract the attachment ID (the `id` field from `ConfluenceAttachment` record)
- The URL is relative to the `apiBaseUrl`, so use `apiRestClient.get().uri(downloadEndpointPath)`
- Example full URL: `https://api.atlassian.com/ex/confluence/{cloudId}/wiki/rest/api/content/98433/child/attachment/131287/download`

**Ignore the downloadUrl field from ConfluenceAttachment**
- Do NOT use `attachment.downloadUrl()` when constructing the HTTP request
- The `downloadUrl` field may remain in the `ConfluenceAttachment` record (it is populated from API response `_links.download`)
- The field is simply not used for download requests; no need to remove it from the model

**Use apiRestClient for all Confluence HTTP calls**
- Replace `fileRestClient.get()` call in `downloadAttachment()` with `apiRestClient.get()`
- The `apiRestClient` is already configured with the correct base URL and authentication header
- No changes needed to the existing error handling pattern using `onStatus(HttpStatusCode::isError, ...)`

**Update error messages to include pageId and attachmentId**
- Error message format: `"Failed to download attachment via REST API: " + attachment.title() + " (pageId=" + pageId + ", attachmentId=" + attachment.id() + ")"`
- Log the constructed download path at DEBUG level: `log.debug("Downloading attachment: {} via REST API path: {}", attachment.title(), downloadEndpointPath)`
- Do not log the full URL at INFO level to avoid potential sensitive data exposure

**Update Javadoc comments to reflect single-client architecture**
- Remove references to "dual RestClient" from class-level Javadoc in `ConfluenceClient.java`
- Update `RestClientConfig.java` class-level Javadoc to describe single client
- Update `ConfluenceProperties.java` Javadoc to remove mention of dual base URLs
- Update `downloadAttachment` method Javadoc to describe REST API endpoint usage

## Existing Code to Leverage

**ConfluenceClient.java (service/ConfluenceClient.java)**
- Existing `apiRestClient` field and its usage pattern in `getPage()`, `getChildPages()`, `getAttachments()`
- Existing error handling pattern with `onStatus(HttpStatusCode::isError, ...)` and `ConfluenceApiException`
- Existing `authHeader` field and `createAuthHeader()` method
- Use the same pattern for `downloadAttachment()` but change from `fileRestClient` to `apiRestClient`

**RestClientConfig.java (config/RestClientConfig.java)**
- Keep the `confluenceApiRestClient()` bean method unchanged (lines 40-53)
- Keep `createRequestFactory()` helper method for timeout configuration
- Keep `addAuthenticationHeader()` helper method

**ConfluenceClientTest.java (test/service/ConfluenceClientTest.java)**
- Existing `MockWebServer` setup pattern can be simplified to single server
- Existing test methods for error handling (401, 404) can be reused as patterns
- Update test setup to use single mock server instead of `mockApiServer` and `mockFileServer`

**ConfluenceApiException.java (exception/ConfluenceApiException.java)**
- Use existing exception class unchanged for error reporting
- Leverage `getStatusCode()`, `isNotFound()`, `isUnauthorized()` methods in tests

**ConfluenceAttachment.java (model/confluence/ConfluenceAttachment.java)**
- Keep record structure unchanged; `id()` accessor is needed for URL construction
- The `downloadUrl()` accessor exists but will be ignored in download logic

## Out of Scope

- Removing the `downloadUrl` field from `ConfluenceAttachment` record (keep for potential future use or debugging)
- Changing the Confluence REST API version or using different endpoints
- Modifying attachment metadata retrieval logic in `getAttachments()` method
- Adding retry logic, circuit breaker patterns, or resilience features
- Implementing caching of downloaded attachment content
- Supporting OAuth, PAT, or other authentication methods besides Basic auth
- Adding new Confluence capabilities or integrating new API endpoints
- Re-introducing `ui-and-file-base-url` or a secondary RestClient for any purpose
- Changing the public REST API contract of our backend service
- Modifying the `ConfluenceDiagramController` or `ConfluenceDiagramService` public interfaces
