# Specification: Jira Service (Spring Boot) -- GET /jira/issues

## Goal
Introduce a new standalone Spring Boot service (jira-service) that queries Jira Cloud via JQL and returns results mapped to the existing WorkItemDto shape, with configurable auth, per-project type mapping, deterministic UUIDv3 IDs, optional batched child expansion, and a gateway proxy route at GET /api/v1/jira/issues.

## User Stories
- As a product owner, I want to pull Jira issues into the architecture tool as WorkItemDto objects so that I can view and reason about delivery work alongside architectural models without manual data entry.
- As a developer configuring the tool, I want per-project type mapping and dual auth mode (bearer/basic) so that I can connect to any Jira Cloud instance regardless of its issue type scheme or authentication policy.

## Specific Requirements

**Spring Boot Service Scaffolding**
- New Maven project at `jira-service/` in the repository root, following the architecture-model-service pom.xml structure (spring-boot-starter-parent 3.2.5, Java 21)
- Package: `com.example.jiraservice` with sub-packages: config, controller, model.dto, service, util
- Dependencies: spring-boot-starter-web, spring-boot-starter-actuator, jackson-databind, jackson-datatype-jsr310, Lombok, spring-boot-starter-test
- No database dependencies -- this is a stateless proxy to Jira Cloud (no JPA, no PostgreSQL, no Liquibase)
- application.yml with global Jackson SNAKE_CASE naming strategy, `write-dates-as-timestamps: false`, `fail-on-unknown-properties: false`, server port 8078
- Actuator health endpoint enabled (`management.endpoints.web.exposure.include: health`) for Docker healthcheck
- Include `@EnableConfigurationProperties(JiraProperties.class)` on the main application class

**JiraProperties Configuration**
- `@ConfigurationProperties(prefix = "jira")` Java record following the ConfluenceProperties pattern
- Fields: `baseUrl` (String, Jira Cloud base URL), `authMode` (enum: BEARER, BASIC), `bearerToken` (String), `username` (String), `apiToken` (String), `connectTimeoutMs` (int, default 5000), `readTimeoutMs` (int, default 30000)
- Compact constructor validates `baseUrl` is not null and applies timeout defaults for non-positive values, matching the ConfluenceProperties validation pattern
- The `authMode` enum (nested or standalone) determines Authorization header construction: BEARER produces `Bearer <bearerToken>`, BASIC produces Base64-encoded `username:apiToken`
- YAML binding example: `jira.base-url`, `jira.auth-mode`, `jira.bearer-token`, `jira.username`, `jira.api-token`

**Jira REST Client**
- Use Spring `RestClient` (not RestTemplate or WebClient), consistent with architecture-read-service's RestClientConfig
- A `@Configuration` class creates a `RestClient` `@Bean` configured with: base URL from JiraProperties, `SimpleClientHttpRequestFactory` with connect/read timeouts, and an Authorization header driven by authMode
- Client calls Jira Cloud REST API v3 search endpoint (`/rest/api/3/search`) with JQL query string and `fields` parameter
- Requested fields: `summary`, `issuetype`, `status`, `priority`, `parent`, `created`, `updated`, `description`
- Parse the JSON response `issues` array; handle Jira's paginated response shape (`startAt`, `maxResults`, `total`, `issues`)

**Per-Project Type Mapping**
- YAML-based configuration under `jira.type-mapping` keyed by Jira project key, mapping Jira issue type name to WorkItemDto type string (INITIATIVE, EPIC, FEATURE, STORY)
- Example: `jira.type-mapping.PROJ.Epic: INITIATIVE` and `jira.type-mapping.PROJ.Story: FEATURE`
- Bind via `Map<String, Map<String, String>>` field on JiraProperties (or a dedicated mapping properties class)
- Unmapped Jira issue types default to STORY with a WARN-level log including the unmapped type name, Jira project key, and issue key
- Mapping lookup is case-sensitive on the Jira issue type name as returned by the Jira API

**Child Issue Expansion**
- Triggered by optional query parameter `expandChildren=true` (default false)
- After fetching parent issues from the initial JQL query, collect all returned issue keys and issue secondary JQL queries using `parent in (KEY-1, KEY-2, ...)` syntax
- Batch parent keys into groups of 50 per JQL query to avoid Jira JQL length limits
- Children receive their own deterministic UUIDv3 IDs; their `parentId` is set to the deterministic UUID of their parent issue
- Child type mapping follows the same per-project type mapping configuration as parent issues
- Expansion is one level deep only -- children of children are not fetched

**Deterministic UUIDv3 ID Generation**
- Use `UUID.nameUUIDFromBytes()` (UUIDv3 / MD5) for deterministic, reproducible IDs
- Input bytes: UTF-8 encoding of the string `toolProjectId + ":" + externalKey` (e.g., `"my-project:PROJ-123"`)
- Same toolProjectId + externalKey always produces the same UUID across restarts -- this is critical for stable parentId references
- Encapsulate in a utility class `DeterministicIdGenerator` in the `util` sub-package with a static method for testability

**WorkItemDto Mapping**
- Duplicate the WorkItemDto Java record in `com.example.jiraservice.model.dto` with identical 14 fields, types, and @JsonProperty annotations as the architecture-model-service version
- `id`: deterministic UUIDv3 from `toolProjectId + ":" + jiraIssueKey`
- `projectId`: set from the `toolProjectId` request parameter (tool project ID, not Jira project key)
- `type`: resolved via per-project type mapping; unmapped defaults to STORY
- `parentId`: deterministic UUIDv3 of the parent issue key (using same `toolProjectId`) if parent exists and was fetched, otherwise null
- `title`: Jira `summary` field; `description`: Jira `description` field (raw ADF or string, not parsed); `status`: Jira `status.name`
- `externalSystem`: hardcoded `"JIRA"`; `externalKey`: Jira issue key (e.g., `"PROJ-123"`)
- `createdAt` / `updatedAt`: parsed from Jira `created` / `updated` fields as `Instant`
- `sortOrder`: null; `priority`: Jira `priority.id` parsed as Integer or null; `targetWindow`: null; `tags`: null or empty map

**Endpoint Contract**
- `GET /jira/issues` on the jira-service (port 8078)
- Required query parameters: `jiraProjectKey` (String), `toolProjectId` (String) -- return 400 if missing or blank
- Optional query parameters: `jql` (String, overrides default JQL), `maxResults` (Integer, default 50), `expandChildren` (Boolean, default false)
- Default JQL when `jql` param is absent: `project = <jiraProjectKey> ORDER BY created DESC`
- Response: HTTP 200 with a JSON array of WorkItemDto objects (flat list including both parents and children when expanded)

**Gateway Proxy Integration**
- New route file `gateway/src/routes/jiraIssues.ts` following the organisations.ts axios Pattern A (Router, helper for base URL, `handleProxyError`, axios.get with timeout)
- New config field `jiraServiceBaseUrl: string` in the Config interface, loaded from `process.env.JIRA_SERVICE_URL || 'http://localhost:8078'` in `loadConfig()`
- Route: `GET /` on the router proxies to jira-service `GET /jira/issues`, forwarding all query parameters via `params: req.query`
- Export `jiraIssuesRouter` from `gateway/src/routes/index.ts`; mount at `app.use('/api/v1/jira', jiraIssuesRouter)` in server.ts
- Add startup console.log: `[Gateway] Jira Issues endpoint: http://localhost:${config.port}/api/v1/jira/issues`
- Add `JIRA_SERVICE_URL` to `gateway/.env.example` with default `http://localhost:8078`

**Docker Compose Entry**
- Add `jira-service` service to `docker-compose.yml` following the architecture-read-service pattern (Spring Boot service, no DB dependency)
- Build context `./jira-service`, dockerfile `Dockerfile.dev`, port mapping `8078:8078`
- Volume mounts: `./jira-service/src:/app/src:delegated`, `./jira-service/pom.xml:/app/pom.xml:delegated`
- Environment variables: `SERVER_PORT=8078`, `JIRA_BASE_URL=${JIRA_BASE_URL:-}`, `JIRA_AUTH_MODE=${JIRA_AUTH_MODE:-BEARER}`, `JIRA_BEARER_TOKEN=${JIRA_BEARER_TOKEN:-changeit}`, `JIRA_USERNAME=${JIRA_USERNAME:-}`, `JIRA_API_TOKEN=${JIRA_API_TOKEN:-}`
- Network: `arch-tool-network`; no `depends_on` (stateless)
- Healthcheck: `curl -f http://localhost:8078/actuator/health || exit 1` with `start_period: 60s`
- Add `JIRA_SERVICE_URL: http://jira-service:8078` to the gateway service's environment block

**Error Handling**
- Jira API errors (4xx/5xx from Jira Cloud) caught and returned as structured JSON with the upstream status code
- Network timeouts or connection failures to Jira Cloud return HTTP 503 with a descriptive message
- Missing or blank required query parameters (`jiraProjectKey`, `toolProjectId`) return HTTP 400
- Use `@RestControllerAdvice` with `@ExceptionHandler` methods for consistent error response shape, or handle in-controller consistent with WorkItemController patterns

**Unit and Integration Tests**
- Unit tests for `DeterministicIdGenerator`: same inputs produce same UUID, different inputs produce different UUIDs, null safety
- Unit tests for type mapping logic: mapped type resolves correctly, unmapped type defaults to STORY, verify WARN log is emitted
- Unit tests for WorkItemDto mapping service: mock Jira JSON to WorkItemDto field mapping, parentId linkage, externalSystem/externalKey values
- Integration test for the controller endpoint using MockMvc: verify 400 on missing params, 200 with correct response shape, query param forwarding
- All tests use spring-boot-starter-test (JUnit 5, Mockito, MockMvc)

## Visual Design
N/A -- backend service only, no UI component.

## Existing Code to Leverage

**WorkItemDto record (architecture-model-service)**
- Path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/WorkItemDto.java`
- Java record with 14 fields (UUID id, String projectId, String type, UUID parentId, String title, String description, String status, Integer sortOrder, Integer priority, String targetWindow, Map tags, String externalSystem, String externalKey, Instant createdAt, Instant updatedAt) and @JsonProperty annotations for snake_case
- Duplicate this record exactly in jira-service under `com.example.jiraservice.model.dto` with identical field names, types, and annotations

**ConfluenceProperties and RestClientConfig (architecture-read-service)**
- Paths: `architecture-read-service/src/main/java/com/example/archtool/config/ConfluenceProperties.java` and `RestClientConfig.java`
- Use the `@ConfigurationProperties` record pattern with compact constructor validation and timeout defaults as the template for JiraProperties
- Use the RestClient bean pattern (SimpleClientHttpRequestFactory, base URL, default headers, auth header injection) as the template for the Jira RestClient, extending the `addAuthenticationHeader` method to branch on authMode (BEARER vs BASIC)

**Gateway organisations.ts route (axios proxy pattern)**
- Path: `gateway/src/routes/organisations.ts`
- Follow this file's structure for jiraIssues.ts: Router export, helper function for upstream base URL from config, `handleProxyError()` helper for axios error forwarding, and `axios.get()` with timeout
- No auth injection needed -- jira-service is an internal same-network call

**Gateway config.ts and server.ts patterns**
- Paths: `gateway/src/config.ts`, `gateway/src/server.ts`, `gateway/src/routes/index.ts`
- Add `jiraServiceBaseUrl` to Config interface and `loadConfig()` following the `architectureModelServiceBaseUrl` pattern
- Export router from routes/index.ts, mount in server.ts with `app.use()`, and add startup console.log line following established conventions

**Docker Compose service definitions**
- Path: `docker-compose.yml` (architecture-read-service entry, lines 55-77)
- Follow the architecture-read-service service definition for the new jira-service: build context, Dockerfile.dev, port mapping, volume mounts for src/pom.xml, env vars, arch-tool-network, actuator healthcheck with start_period

## Out of Scope
- Write operations to Jira (creating, updating, or deleting issues)
- Jira webhook or event listener support
- Caching of Jira query results (every request hits Jira Cloud live)
- Frontend UI changes to consume the new GET /api/v1/jira/issues endpoint
- Shared Maven module for WorkItemDto across services (deferred to a future iteration)
- UUIDv5 (SHA-1) implementation -- UUIDv3 via nameUUIDFromBytes is sufficient for v1
- Recursive child expansion beyond one level (only direct children are fetched)
- Jira Server or Jira Data Center support (Jira Cloud REST API v3 only)
- OAuth 2.0 or other auth modes beyond BEARER and BASIC
- Pagination support for Jira results beyond the maxResults parameter (no cursor/offset iteration across multiple pages)
