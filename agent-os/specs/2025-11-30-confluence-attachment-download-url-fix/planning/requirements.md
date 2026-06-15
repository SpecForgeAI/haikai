# Spec Requirements: Confluence Attachment Download URL Fix (Simplified)

## Initial Description

Simplify and harden the Confluence attachment download logic:

- Remove the separate UI/file RestClient.
- Use only the existing API RestClient (configured with `confluence.api-base-url` and the scoped service account token).
- Ignore the UI-relative download URLs returned by Confluence.
- Always download attachments via the official REST API download endpoint using pageId + attachmentId.

This change is purely backend and should not affect any public API contracts of our own service.

## Context & Current Behaviour

Current situation:

- We have:
  - A main Confluence API RestClient (e.g. `restClient` or `apiRestClient`) configured with:
    - `confluence.api-base-url`, e.g. `https://api.atlassian.com/ex/confluence/{cloudId}/wiki`
    - Basic auth using `username: api-token` for the service account.
  - A second "file" or "UI" RestClient (e.g. `fileRestClient`) intended for:
    - `confluence.ui-and-file-base-url`, e.g. `https://<site>.atlassian.net/wiki`.

- `ConfluenceAttachment` records contain a `downloadUrl` returned by the Confluence API. For Confluence Cloud this is typically a **relative UI path**, such as:
  - `/download/attachments/98433/My Architecture?version=1&...`

- The current `downloadAttachment(ConfluenceAttachment)` logic:
  - Checks if `attachment.downloadUrl()` is absolute (`http://` or `https://`). If so, it calls it directly.
  - If it is relative, it uses the `restClient` with its base URL to call the relative path.
  - This is problematic because:
    - The API base URL (`api.atlassian.com/.../wiki`) is not the correct host for the UI-style `/download/attachments/...` path.
    - Scoped tokens are not guaranteed to work reliably against that UI-style host/path combination.

We have now confirmed that the correct, supported approach with scoped tokens is to use the Confluence REST API attachment download endpoint:

- `GET {api-base-url}/rest/api/content/{pageId}/child/attachment/{attachmentId}/download`

…rather than the `_links.download` UI-relative URL.

## Goal

Refactor the code so that:

1) We **remove** the unused UI/file RestClient and its configuration.
2) We **ignore** the UI-relative `downloadUrl` from `ConfluenceAttachment`.
3) We **always** construct the attachment download URL using:
   - `{api-base-url}/rest/api/content/{pageId}/child/attachment/{attachmentId}/download`
4) We **always** call this URL via the existing API RestClient, using our existing Basic auth with the service account scoped token.

This will make attachment download:

- Consistent,
- Compatible with scoped tokens,
- Independent of the UI host.

## Requirements Summary

### Configuration Changes

Update configuration to:

- Keep:
  - `confluence.api-base-url` (already in place)
  - `confluence.username`
  - `confluence.api-token`

- Remove:
  - `confluence.ui-and-file-base-url` (no longer needed for backend downloads)
  - Any configuration, beans, or properties that exist solely to support a separate "file" or "UI" RestClient.

Example new config shape:

```yaml
confluence:
  api-base-url: https://api.atlassian.com/ex/confluence/<cloudId>/wiki
  username: <service-account-email>
  api-token: <scoped-api-token>
```

There should be only the API base URL in play for Confluence HTTP calls.

### RestClient / WebClient Beans

- Ensure we have a **single** Confluence client bean (e.g. `confluenceApiClient` or `restClient`) configured as before:

  - Base URL: `confluence.api-base-url`
  - Default headers:
    - `Authorization: Basic <base64(username:api-token)>`
    - `Accept: application/json` for JSON endpoints (we can still call binary download with this client).

- Remove:
  - Any `fileRestClient` / `confluenceFileClient` bean.
  - Any injection or usage of a secondary client dedicated to the UI / file host.

- All Confluence HTTP calls (including attachment downloads) must now go through this single API client.

### New Attachment Download Logic

Update the `downloadAttachment` method (or equivalent) in the Confluence integration service (e.g. `ConfluenceClient`, `ConfluenceAttachmentService`) to:

- No longer rely on `attachment.downloadUrl()` for building the HTTP URL.
- Instead, construct the URL from:
  - `confluence.api-base-url`
  - `pageId` (the Confluence page id on which the attachment resides)
  - `attachmentId` (`attachment.id` from the metadata)

#### New URL construction

Given:
- `apiBaseUrl` = `confluence.api-base-url` (e.g. `https://api.atlassian.com/ex/confluence/867ce29e-9357-480a-9da6-830c0e2fd5c0/wiki`)
- `pageId` = `page.id`
- `attachmentId` = `attachment.id`

Construct:

- `downloadEndpointPath = "/rest/api/content/" + pageId + "/child/attachment/" + attachmentId + "/download"`

Resulting full URL:

- `{apiBaseUrl}{downloadEndpointPath}`

Example:

- `https://api.atlassian.com/ex/confluence/867ce29e-9357-480a-9da6-830c0e2fd5c0/wiki/rest/api/content/98433/child/attachment/131287/download`

#### New method behaviour (conceptual)

Replace the existing logic with something like:

- Build the URL:
  - `String url = apiBaseUrl + "/rest/api/content/" + pageId + "/child/attachment/" + attachmentId + "/download";`

- Use the existing API RestClient:
  - `restClient.get()`
    - `.uri(url)` or `.uri(downloadEndpointPath)` if using baseUrl
    - `.header("Authorization", authHeader)` (if not already defaulted)
    - `.retrieve()`
    - `.onStatus(HttpStatusCode::isError, ...)`
    - `.body(byte[].class)`

- Remove all code branches that:
  - Check for absolute vs relative `attachment.downloadUrl()`
  - Use `fileRestClient`
  - Attempt to prefix `downloadUrl` with UI or API base URLs

**Important:** The `ConfluenceAttachment` model may continue to store `downloadUrl` if it's part of the API response, but this field should now be **ignored** when downloading attachments via the server.

### Data Dependencies (pageId vs attachment metadata)

Ensure that:

- For the method that downloads attachments, both:
  - `pageId` (the parent content ID) and
  - `attachment.id` (attachment ID)

are available.

If the current method signature only receives a `ConfluenceAttachment` (without pageId), update it to either:

- Accept `pageId` as an explicit parameter, OR
- Ensure that the attachment record contains its parent pageId field (and that it's populated when fetching attachments).

We must not rely on `_links.download` or UI-like fields to infer the parent.

### Error Handling & Logging

- Preserve existing error handling patterns, but update messages to reflect the new URL path.

Example updated error message:

- `"Failed to download attachment via REST API download endpoint: " + attachment.title() + " (pageId=" + pageId + ", attachmentId=" + attachment.id() + ")"`

- Log the constructed URL at debug level only (to avoid leaking token-containing URLs if ever added to query strings).

### Tests

Add / update tests for the Confluence download logic:

1) Unit tests for URL construction:
   - Given:
     - `apiBaseUrl = "https://api.atlassian.com/ex/confluence/<cloudId>/wiki"`
     - `pageId = "98433"`
     - `attachmentId = "131287"`
   - Assert that the constructed URL is:
     - `"https://api.atlassian.com/ex/confluence/<cloudId>/wiki/rest/api/content/98433/child/attachment/131287/download"`

2) Unit / integration test using a mocked RestClient / WebClient:
   - Mock a successful HTTP 200 response with binary content.
   - Ensure `downloadAttachment` returns the byte[] as expected.
   - Verify that the request was sent to the correct path and host.
   - Verify that `attachment.downloadUrl()` is not used in the request.

3) Regression test (optional):
   - If we previously used `_links.download` or `attachment.downloadUrl`, add a test to confirm we no longer rely on it.

## Visual Assets

No visual assets provided - this is a backend-only technical refactoring with no UI components.

## Scope Boundaries

### In Scope

- Remove `uiAndFileBaseUrl` configuration property (if it exists)
- Remove any `fileRestClient` / `confluenceFileRestClient` bean
- Update `ConfluenceClient` to use only the single API RestClient
- Refactor `downloadAttachment()` to construct URL from pageId + attachmentId
- Update method signature to accept pageId if not already available
- Update `application.yml` and `application-local.yml` to remove unused properties
- Update existing tests and add new tests for the simplified behavior
- Remove dead code related to the old download logic

### Out of Scope

- Changing the Confluence API version or endpoints
- Modifying attachment metadata retrieval logic
- Adding retry logic or circuit breaker patterns
- Caching of downloaded attachments
- Support for OAuth or other authentication methods
- Introducing any new Confluence capabilities or endpoints
- Re-introducing `ui-and-file-base-url` or a secondary RestClient
- Changing the public API of our backend (clients still call our service the same way)

## Technical Considerations

**Technology Stack:**
- Java 21
- Spring Boot 3.2.0
- Spring Web (RestClient - not WebClient/reactive)
- JUnit 5 with MockWebServer for testing

**Configuration Prefix:**
- `archtool.confluence.api-base-url` (keep)
- `archtool.confluence.ui-and-file-base-url` (remove)

**Error Handling:**
- Maintain existing `ConfluenceApiException` pattern for download failures
- Include attachment title, pageId, and attachmentId in error messages for debugging
