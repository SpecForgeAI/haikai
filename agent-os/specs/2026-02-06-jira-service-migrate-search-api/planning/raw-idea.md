# Raw Idea

## Title
Jira-service: migrate search to /rest/api/3/search/jql (fix 410 Gone)

## Description
Update jira-service to stop calling the removed/deprecated Jira search endpoint and instead use the supported Jira Cloud API endpoint: /rest/api/3/search/jql. This resolves 410 GONE errors and keeps paging/fields behavior consistent.

## Scope

### In Scope
- JiraSearchService: replace old search call with /rest/api/3/search/jql
- Ensure request supports jql, startAt, maxResults, and requested fields
- Ensure child-expansion logic uses the same new endpoint for additional queries
- Update DTOs for request/response parsing if needed
- Update tests/mocks to target the new endpoint path and method

### Out of Scope
- Changing higher-level controller contract (GET /jira/issues stays the same)
- Changing mapping to WorkItemDto
- OAuth changes

## Requirements
- Jira searches MUST call /rest/api/3/search/jql
- The jira-service must pass jql, startAt, maxResults, and fields
- Paging must continue to work as before
- Child expansion must also use the same endpoint

## Implementation Notes
- Update Jira API client to use POST with JSON body
- If jira-service uses WebClient, replace old .get() call with .post()
- Ensure error handling continues to surface Jira errors via GlobalExceptionHandler
