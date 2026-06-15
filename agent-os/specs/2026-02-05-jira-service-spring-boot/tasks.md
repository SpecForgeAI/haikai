# Task Breakdown: Jira Service (Spring Boot) -- GET /jira/issues

## Overview
Total Tasks: 45 (across 7 task groups)

This spec introduces a new standalone Spring Boot service (`jira-service`) that queries Jira Cloud via JQL and returns results mapped to `WorkItemDto`, plus gateway proxy integration and Docker Compose entry. There are no database or frontend components -- this is a stateless backend proxy service.

## Reference Files

| Reference | Path |
|-----------|------|
| WorkItemDto (source of truth) | `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/WorkItemDto.java` |
| ConfluenceProperties pattern | `architecture-read-service/src/main/java/com/example/archtool/config/ConfluenceProperties.java` |
| RestClientConfig pattern | `architecture-read-service/src/main/java/com/example/archtool/config/RestClientConfig.java` |
| Gateway organisations.ts (axios proxy Pattern A) | `gateway/src/routes/organisations.ts` |
| Gateway config.ts | `gateway/src/config.ts` |
| Gateway server.ts | `gateway/src/server.ts` |
| Gateway routes/index.ts | `gateway/src/routes/index.ts` |
| architecture-model-service pom.xml | `architecture-model-service/pom.xml` |
| Docker Compose | `docker-compose.yml` |
| Gateway .env.example | `gateway/.env.example` |

---

## Task List

### Spring Boot Scaffolding

#### Task Group 1: Maven Project and Application Bootstrap
**Dependencies:** None

This group creates the bare-bones runnable Spring Boot application with health endpoint. Everything else builds on this foundation.

- [x] 1.0 Complete Spring Boot project scaffolding
  - [x] 1.1 Create Maven `pom.xml` at `jira-service/pom.xml`
    - Parent: `spring-boot-starter-parent` 3.2.5
    - GroupId: `com.example`, ArtifactId: `jira-service`, Version: `1.0.0-SNAPSHOT`
    - Java version: 21
    - Dependencies: `spring-boot-starter-web`, `spring-boot-starter-actuator`, `jackson-databind`, `jackson-datatype-jsr310`, Lombok (optional), `spring-boot-starter-test` (test scope)
    - No database dependencies (no JPA, no PostgreSQL, no Liquibase, no H2)
    - spring-boot-maven-plugin with Lombok exclusion
    - Reuse structure from: `architecture-model-service/pom.xml` (strip DB-related deps)
  - [x] 1.2 Create main application class `JiraServiceApplication.java`
    - Package: `com.example.jiraservice`
    - Path: `jira-service/src/main/java/com/example/jiraservice/JiraServiceApplication.java`
    - Annotations: `@SpringBootApplication`, `@EnableConfigurationProperties(JiraProperties.class)`
    - Standard `SpringApplication.run()` main method
  - [x] 1.3 Create `application.yml` at `jira-service/src/main/resources/application.yml`
    - `server.port: 8078`
    - Jackson config: `spring.jackson.property-naming-strategy: SNAKE_CASE`, `serialization.write-dates-as-timestamps: false`, `deserialization.fail-on-unknown-properties: false`
    - Actuator: `management.endpoints.web.exposure.include: health`
    - Jira placeholder config: `jira.base-url`, `jira.auth-mode`, `jira.bearer-token`, `jira.username`, `jira.api-token` with sensible defaults
    - Type mapping placeholder: `jira.type-mapping` with an example project key entry
  - [x] 1.4 Create stub `JiraProperties.java` configuration record
    - Package: `com.example.jiraservice.config`
    - Path: `jira-service/src/main/java/com/example/jiraservice/config/JiraProperties.java`
    - Minimal record with `baseUrl` field so the application boots without errors
    - Will be fully implemented in Task Group 2; this stub unblocks `@EnableConfigurationProperties`
  - [x] 1.5 Create empty sub-package marker classes or `package-info.java` for planned packages
    - `com.example.jiraservice.config`
    - `com.example.jiraservice.controller`
    - `com.example.jiraservice.model.dto`
    - `com.example.jiraservice.service`
    - `com.example.jiraservice.util`
  - [x] 1.6 Verify application boots and health endpoint responds
    - Run `mvn spring-boot:run` (or equivalent) from `jira-service/`
    - Confirm `GET http://localhost:8078/actuator/health` returns `{"status":"UP"}`
    - Confirm server starts on port 8078 with no errors

**Acceptance Criteria:**
- Maven project compiles with `mvn compile`
- Application starts on port 8078
- `GET /actuator/health` returns HTTP 200 with `{"status":"UP"}`
- No database connectivity required or attempted at startup
- Jackson SNAKE_CASE naming strategy is active

---

### Configuration and Utility Layer

#### Task Group 2: JiraProperties, DeterministicIdGenerator, and WorkItemDto
**Dependencies:** Task Group 1

This group builds the three foundational building blocks that every subsequent group depends on: configuration, deterministic IDs, and the output DTO.

- [x] 2.0 Complete configuration and utility layer
  - [x] 2.1 Write 6 focused unit tests for this group
    - Test 1: `DeterministicIdGenerator` -- same inputs produce same UUID
    - Test 2: `DeterministicIdGenerator` -- different inputs produce different UUIDs
    - Test 3: `DeterministicIdGenerator` -- null or empty input handling (defensive)
    - Test 4: `JiraProperties` compact constructor -- null `baseUrl` throws `NullPointerException`
    - Test 5: `JiraProperties` compact constructor -- non-positive timeouts default to 5000/30000
    - Test 6: `JiraProperties` -- `authMode` BEARER and BASIC enum values exist and are resolved
  - [x] 2.2 Fully implement `JiraProperties.java` configuration record
    - `@ConfigurationProperties(prefix = "jira")`
    - Fields: `baseUrl` (String), `authMode` (enum `AuthMode`: BEARER, BASIC), `bearerToken` (String), `username` (String), `apiToken` (String), `connectTimeoutMs` (int, default 5000), `readTimeoutMs` (int, default 30000), `typeMapping` (Map<String, Map<String, String>>)
    - Compact constructor: validate `baseUrl` not null, apply timeout defaults for non-positive values
    - `AuthMode` enum nested inside the record or as standalone enum in config package
    - Reuse pattern from: `architecture-read-service/.../ConfluenceProperties.java`
  - [x] 2.3 Create `DeterministicIdGenerator.java` utility class
    - Package: `com.example.jiraservice.util`
    - Static method: `public static UUID generateId(String toolProjectId, String externalKey)`
    - Implementation: `UUID.nameUUIDFromBytes((toolProjectId + ":" + externalKey).getBytes(StandardCharsets.UTF_8))`
    - Defensive: throw `IllegalArgumentException` if either argument is null or blank
  - [x] 2.4 Duplicate `WorkItemDto.java` record in jira-service
    - Package: `com.example.jiraservice.model.dto`
    - Path: `jira-service/src/main/java/com/example/jiraservice/model/dto/WorkItemDto.java`
    - Identical 14 fields, types, and `@JsonProperty` annotations as `architecture-model-service` version
    - Fields: `id` (UUID), `projectId` (String), `type` (String), `parentId` (UUID), `title` (String), `description` (String), `status` (String), `sortOrder` (Integer), `priority` (Integer), `targetWindow` (String), `tags` (Map<String,Object>), `externalSystem` (String), `externalKey` (String), `createdAt` (Instant), `updatedAt` (Instant)
  - [x] 2.5 Ensure all 6 tests from 2.1 pass
    - Run ONLY the tests written in 2.1
    - Verify `DeterministicIdGenerator` produces stable, deterministic UUIDs
    - Verify `JiraProperties` validates and applies defaults correctly

**Acceptance Criteria:**
- All 6 unit tests pass
- `JiraProperties` loads from `application.yml` without errors (app still boots)
- `DeterministicIdGenerator.generateId("proj", "KEY-1")` returns the same UUID on every call
- `WorkItemDto` record compiles with all 14 fields and `@JsonProperty` annotations

---

### Jira REST Client Layer

#### Task Group 3: RestClient Configuration and Jira API Client Service
**Dependencies:** Task Group 2

This group creates the HTTP client for Jira Cloud and the service that calls the Jira search endpoint, parses the paginated response, and returns raw Jira issue data structures.

- [x] 3.0 Complete Jira REST client layer
  - [x] 3.1 Write 5 focused unit tests for this group
    - Test 1: `JiraRestClientConfig` -- BEARER auth mode sets `Authorization: Bearer <token>` header
    - Test 2: `JiraRestClientConfig` -- BASIC auth mode sets `Authorization: Basic <base64>` header
    - Test 3: `JiraSearchService.searchIssues()` -- parses mock Jira JSON response into issue objects
    - Test 4: `JiraSearchService.searchIssues()` -- uses default JQL when no custom JQL provided
    - Test 5: `JiraSearchService.searchIssues()` -- requests correct fields parameter (`summary,issuetype,status,priority,parent,created,updated,description`)
  - [x] 3.2 Create `JiraRestClientConfig.java` configuration class
    - Package: `com.example.jiraservice.config`
    - `@Configuration` class with constructor injection of `JiraProperties`
    - `@Bean @Qualifier("jiraRestClient")` method returning `RestClient`
    - Configure: base URL from `JiraProperties.baseUrl()`, `SimpleClientHttpRequestFactory` with connect/read timeouts
    - Default headers: `Accept: application/json`
    - Auth header: branch on `authMode` -- BEARER sets `Authorization: Bearer <bearerToken>`, BASIC sets `Authorization: Basic <base64(username:apiToken)>`
    - Reuse pattern from: `architecture-read-service/.../RestClientConfig.java`
  - [x] 3.3 Create internal Jira response model classes (for JSON deserialization)
    - Package: `com.example.jiraservice.model.dto` (or a nested `jira` sub-package)
    - `JiraSearchResponse` record: `startAt` (int), `maxResults` (int), `total` (int), `issues` (List<JiraIssue>)
    - `JiraIssue` record: `key` (String), `fields` (JiraIssueFields)
    - `JiraIssueFields` record: `summary` (String), `issuetype` (JiraNamedField), `status` (JiraNamedField), `priority` (JiraPriorityField), `parent` (JiraParentField), `created` (String), `updated` (String), `description` (Object)
    - `JiraNamedField` record: `name` (String)
    - `JiraPriorityField` record: `id` (String), `name` (String)
    - `JiraParentField` record: `key` (String)
    - Use `@JsonIgnoreProperties(ignoreUnknown = true)` on all records for forward compatibility
  - [x] 3.4 Create `JiraSearchService.java`
    - Package: `com.example.jiraservice.service`
    - `@Service` with `@RequiredArgsConstructor` and `@Slf4j`
    - Inject `RestClient` (qualified `jiraRestClient`)
    - Method: `JiraSearchResponse searchIssues(String jql, int maxResults)`
    - Calls `GET /rest/api/3/search` with query params: `jql`, `maxResults`, `fields=summary,issuetype,status,priority,parent,created,updated,description`
    - Parses response body into `JiraSearchResponse`
    - Logs the JQL query at DEBUG level and result count at INFO level
  - [x] 3.5 Ensure all 5 tests from 3.1 pass
    - Run ONLY the tests written in 3.1
    - Use Mockito to mock the `RestClient` for service tests
    - Verify auth header construction for both BEARER and BASIC modes

**Acceptance Criteria:**
- All 5 unit tests pass
- `RestClient` bean is created with correct auth headers based on `authMode`
- `JiraSearchService` correctly calls Jira search endpoint and deserializes the response
- Jira response model classes handle unknown JSON properties gracefully

---

### Mapping and Business Logic Layer

#### Task Group 4: Type Mapping, WorkItemDto Mapping, and Child Expansion
**Dependencies:** Task Groups 2 and 3

This group implements the core business logic: mapping Jira issues to WorkItemDto objects using per-project type mapping, resolving deterministic IDs and parent references, and optionally expanding child issues via batched JQL.

- [x] 4.0 Complete mapping and business logic layer
  - [x] 4.1 Write 8 focused unit tests for this group
    - Test 1: Type mapping -- mapped Jira issue type resolves to configured WorkItemDto type (e.g., `Epic` -> `INITIATIVE`)
    - Test 2: Type mapping -- unmapped Jira issue type defaults to `STORY`
    - Test 3: Type mapping -- unmapped type emits WARN-level log with type name, project key, and issue key
    - Test 4: WorkItemDto mapping -- `externalSystem` is hardcoded to `"JIRA"`, `externalKey` is Jira issue key
    - Test 5: WorkItemDto mapping -- `id` is deterministic UUIDv3 from `toolProjectId + ":" + issueKey`
    - Test 6: WorkItemDto mapping -- `parentId` is deterministic UUID of parent issue key when parent exists
    - Test 7: WorkItemDto mapping -- `parentId` is null when no parent
    - Test 8: Child expansion -- batches parent keys into groups of 50 for secondary JQL queries
  - [x] 4.2 Create `TypeMappingService.java`
    - Package: `com.example.jiraservice.service`
    - `@Service` with `@RequiredArgsConstructor` and `@Slf4j`
    - Inject `JiraProperties` for access to `typeMapping` map
    - Method: `String resolveType(String jiraProjectKey, String jiraIssueTypeName, String issueKey)`
    - Lookup: `typeMapping.get(jiraProjectKey).get(jiraIssueTypeName)` with null-safe navigation
    - If unmapped: log WARN with issue type name, project key, and issue key; return `"STORY"`
    - Case-sensitive lookup on Jira issue type name (as returned by Jira API)
  - [x] 4.3 Create `JiraIssueMappingService.java`
    - Package: `com.example.jiraservice.service`
    - `@Service` with `@RequiredArgsConstructor` and `@Slf4j`
    - Inject `TypeMappingService`
    - Method: `WorkItemDto mapToWorkItem(JiraIssue issue, String jiraProjectKey, String toolProjectId, Set<String> fetchedParentKeys)`
    - Mapping rules:
      - `id`: `DeterministicIdGenerator.generateId(toolProjectId, issue.key())`
      - `projectId`: `toolProjectId` parameter
      - `type`: via `TypeMappingService.resolveType()`
      - `parentId`: if `issue.fields().parent()` is not null AND parent key is in `fetchedParentKeys`, then `DeterministicIdGenerator.generateId(toolProjectId, parentKey)`, else null
      - `title`: `issue.fields().summary()`
      - `description`: `issue.fields().description()` (raw, toString if Object)
      - `status`: `issue.fields().status().name()`
      - `externalSystem`: `"JIRA"`
      - `externalKey`: `issue.key()`
      - `createdAt` / `updatedAt`: parse from Jira ISO-8601 strings to `Instant`
      - `sortOrder`: null
      - `priority`: parse `issue.fields().priority().id()` as Integer, or null
      - `targetWindow`: null
      - `tags`: null or empty map
  - [x] 4.4 Create `ChildExpansionService.java`
    - Package: `com.example.jiraservice.service`
    - `@Service` with `@RequiredArgsConstructor` and `@Slf4j`
    - Inject `JiraSearchService`
    - Method: `List<JiraIssue> fetchChildren(List<String> parentKeys)`
    - Batch parent keys into groups of 50
    - For each batch, build JQL: `parent in (KEY-1, KEY-2, ..., KEY-N) ORDER BY created DESC`
    - Call `JiraSearchService.searchIssues()` for each batch with `maxResults=50` (per batch)
    - Aggregate and return all child issues
    - Expansion is one level deep only -- do not recurse
    - Log batch count and total children fetched at INFO level
  - [x] 4.5 Ensure all 8 tests from 4.1 pass
    - Run ONLY the tests written in 4.1
    - Use Mockito to mock `JiraProperties`, `JiraSearchService`, and dependent services
    - Verify type mapping, DTO field mapping, parent linkage, and batch sizing

**Acceptance Criteria:**
- All 8 unit tests pass
- Type mapping resolves configured types and defaults unmapped to `STORY` with WARN log
- WorkItemDto fields are correctly mapped from Jira issue data
- Deterministic IDs are stable and parent references use the same ID generation
- Child expansion batches keys into groups of 50

---

### REST Endpoint and Error Handling

#### Task Group 5: Controller, Error Handling, and Integration Tests
**Dependencies:** Task Groups 2, 3, and 4

This group exposes the `GET /jira/issues` endpoint, wires up query parameter handling, orchestrates the service calls, and implements structured error responses.

- [x] 5.0 Complete REST endpoint and error handling
  - [x] 5.1 Write 7 focused tests (mix of unit and integration/MockMvc)
    - Test 1 (MockMvc): `GET /jira/issues` without `jiraProjectKey` returns 400
    - Test 2 (MockMvc): `GET /jira/issues` without `toolProjectId` returns 400
    - Test 3 (MockMvc): `GET /jira/issues` with blank `jiraProjectKey` returns 400
    - Test 4 (MockMvc): `GET /jira/issues` with valid params returns 200 and JSON array
    - Test 5 (MockMvc): `GET /jira/issues?expandChildren=true` includes child issues in response
    - Test 6 (unit): Jira API 4xx error is caught and returned with upstream status code
    - Test 7 (unit): Network timeout to Jira returns 503 with descriptive message
  - [x] 5.2 Create `JiraIssueController.java`
    - Package: `com.example.jiraservice.controller`
    - `@RestController` with `@RequestMapping("/jira")` and `@RequiredArgsConstructor` and `@Slf4j`
    - Method: `@GetMapping("/issues") public ResponseEntity<List<WorkItemDto>> getIssues(@RequestParam String jiraProjectKey, @RequestParam String toolProjectId, @RequestParam(required = false) String jql, @RequestParam(defaultValue = "50") int maxResults, @RequestParam(defaultValue = "false") boolean expandChildren)`
    - Validate `jiraProjectKey` and `toolProjectId` are not blank; return 400 if blank
    - Build default JQL if `jql` param is absent: `project = <jiraProjectKey> ORDER BY created DESC`
    - Call `JiraSearchService.searchIssues(jql, maxResults)`
    - Collect parent issue keys into a Set for parent reference resolution
    - Map each Jira issue to `WorkItemDto` via `JiraIssueMappingService`
    - If `expandChildren=true`: call `ChildExpansionService.fetchChildren()` with parent keys, map children to WorkItemDto, append to result list
    - Return flat list of all WorkItemDto objects (parents + children when expanded)
  - [x] 5.3 Create `GlobalExceptionHandler.java` (or handle in-controller)
    - Package: `com.example.jiraservice.controller` (or `com.example.jiraservice.config`)
    - `@RestControllerAdvice` with `@ExceptionHandler` methods
    - Handle `HttpClientErrorException` / `HttpServerErrorException` from RestClient: return upstream status code with structured JSON `{ "error": ..., "status": ..., "message": ... }`
    - Handle `ResourceAccessException` (network timeout/connection failure): return HTTP 503 with `{ "error": "Service Unavailable", "message": "Unable to connect to Jira Cloud" }`
    - Handle `IllegalArgumentException` for missing/blank params: return HTTP 400 with descriptive message
    - Consistent error response shape across all exception types
  - [x] 5.4 Create a test `application.yml` for tests at `jira-service/src/test/resources/application.yml`
    - Override `jira.base-url` to a mock/test value
    - Set `jira.auth-mode: BEARER` and `jira.bearer-token: test-token`
    - Include a test type mapping entry for assertions
  - [x] 5.5 Ensure all 7 tests from 5.1 pass
    - Run ONLY the tests written in 5.1
    - Use `@WebMvcTest(JiraIssueController.class)` with `@MockBean` for service dependencies
    - Verify HTTP status codes, response shapes, and query parameter handling

**Acceptance Criteria:**
- All 7 tests pass
- `GET /jira/issues?jiraProjectKey=PROJ&toolProjectId=my-proj` returns HTTP 200 with JSON array of `WorkItemDto`
- Missing or blank required params return HTTP 400 with structured error
- Jira API errors are caught and forwarded with appropriate status codes
- Network failures return HTTP 503

---

### Gateway Integration Layer

#### Task Group 6: Gateway Proxy Route, Config, and Wiring
**Dependencies:** Task Group 5 (jira-service must have its endpoint defined)

This group adds the gateway proxy route so the frontend can reach `GET /api/v1/jira/issues` through the gateway on port 8081.

- [x] 6.0 Complete gateway proxy integration
  - [x] 6.1 Write 3 focused tests for the gateway route
    - Test 1: `GET /api/v1/jira/issues` proxies to jira-service and forwards query params
    - Test 2: `GET /api/v1/jira/issues` returns 503 when jira-service is unavailable
    - Test 3: Config loads `jiraServiceBaseUrl` from `JIRA_SERVICE_URL` env var with correct default
  - [x] 6.2 Add `jiraServiceBaseUrl` to gateway config
    - File: `gateway/src/config.ts`
    - Add `jiraServiceBaseUrl: string` to the `Config` interface
    - Add to `loadConfig()`: `jiraServiceBaseUrl: process.env.JIRA_SERVICE_URL || 'http://localhost:8078'`
  - [x] 6.3 Create `gateway/src/routes/jiraIssues.ts` route file
    - Follow `gateway/src/routes/organisations.ts` (axios Pattern A) exactly
    - Export `jiraIssuesRouter` as `Router`
    - Helper function `getJiraServiceUrl()` reads from `getConfig().jiraServiceBaseUrl`
    - `handleProxyError()` helper for axios error forwarding (same pattern as organisations.ts)
    - Route: `GET /` -- proxies to `${getJiraServiceUrl()}/jira/issues` via `axios.get()` with `params: req.query` and `timeout: 30000`
    - No auth injection needed (same-network internal call)
  - [x] 6.4 Export and mount the router
    - File: `gateway/src/routes/index.ts` -- add `export { jiraIssuesRouter } from './jiraIssues';`
    - File: `gateway/src/server.ts` -- import `jiraIssuesRouter`, mount at `app.use('/api/v1/jira', jiraIssuesRouter)`
    - Add startup console.log: `[Gateway] Jira Issues endpoint: http://localhost:${config.port}/api/v1/jira/issues`
  - [x] 6.5 Update `gateway/.env.example`
    - Add section header: `# JIRA SERVICE CONFIGURATION`
    - Add: `JIRA_SERVICE_URL=http://localhost:8078`
  - [x] 6.6 Ensure all 3 tests from 6.1 pass
    - Run ONLY the tests written in 6.1
    - Verify query parameter forwarding, error handling, and config loading

**Acceptance Criteria:**
- All 3 gateway tests pass
- `GET http://localhost:8081/api/v1/jira/issues?jiraProjectKey=PROJ&toolProjectId=my-proj` proxies correctly to `http://localhost:8078/jira/issues` with all query params forwarded
- Gateway config loads `JIRA_SERVICE_URL` with default `http://localhost:8078`
- `.env.example` documents the new environment variable
- Gateway startup log includes the Jira Issues endpoint URL

---

### Infrastructure Layer

#### Task Group 7: Docker Compose and Environment Configuration
**Dependencies:** Task Groups 1 and 6

This group adds the Docker Compose service definition and wires up the environment variables so `jira-service` runs alongside all other services with `docker-compose up`.

- [x] 7.0 Complete Docker Compose and infrastructure setup
  - [x] 7.1 Create `jira-service/Dockerfile.dev`
    - Follow the same pattern as `architecture-read-service/Dockerfile.dev` (Spring Boot dev Dockerfile)
    - Base image with JDK 21, Maven build, spring-boot:run with devtools
    - Working directory `/app`
    - Copy pom.xml, download dependencies, copy src, run
  - [x] 7.2 Add `jira-service` service to `docker-compose.yml`
    - Build context: `./jira-service`, dockerfile: `Dockerfile.dev`
    - Container name: `arch-jira-service`
    - Port mapping: `8078:8078`
    - Volume mounts: `./jira-service/src:/app/src:delegated`, `./jira-service/pom.xml:/app/pom.xml:delegated`
    - Environment variables:
      - `SERVER_PORT=8078`
      - `JIRA_BASE_URL=${JIRA_BASE_URL:-}`
      - `JIRA_AUTH_MODE=${JIRA_AUTH_MODE:-BEARER}`
      - `JIRA_BEARER_TOKEN=${JIRA_BEARER_TOKEN:-changeit}`
      - `JIRA_USERNAME=${JIRA_USERNAME:-}`
      - `JIRA_API_TOKEN=${JIRA_API_TOKEN:-}`
    - Network: `arch-tool-network`
    - No `depends_on` (stateless, no DB dependency)
    - Healthcheck: `curl -f http://localhost:8078/actuator/health || exit 1` with `interval: 30s`, `timeout: 10s`, `retries: 5`, `start_period: 60s`
    - Follow pattern from: `architecture-read-service` entry in `docker-compose.yml`
  - [x] 7.3 Add `JIRA_SERVICE_URL` to the gateway service's environment block in `docker-compose.yml`
    - Add: `JIRA_SERVICE_URL: http://jira-service:8078` to the `gateway` service environment
    - This enables the gateway container to reach jira-service by Docker service name
  - [x] 7.4 Verify Docker Compose configuration is valid
    - Run `docker-compose config` to validate the YAML syntax and variable substitution
    - Confirm jira-service appears in the service list
    - Confirm gateway environment includes `JIRA_SERVICE_URL`

**Acceptance Criteria:**
- `docker-compose config` passes without errors
- `jira-service` is defined with correct port, volumes, env vars, network, and healthcheck
- Gateway service environment includes `JIRA_SERVICE_URL: http://jira-service:8078`
- `Dockerfile.dev` follows established Spring Boot dev container pattern
- `docker-compose up jira-service` builds and starts the service (health check passes when Jira creds are not configured -- actuator health should still respond UP)

---

### Test Review

#### Task Group 8: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-7

- [x] 8.0 Review existing tests and fill critical gaps only
  - [x] 8.1 Review tests from Task Groups 2-6
    - Review the 6 tests written in Task 2.1 (configuration and utilities)
    - Review the 5 tests written in Task 3.1 (Jira REST client)
    - Review the 8 tests written in Task 4.1 (mapping and business logic)
    - Review the 7 tests written in Task 5.1 (controller and error handling)
    - Review the 3 tests written in Task 6.1 (gateway proxy)
    - Total existing tests: approximately 29 tests
  - [x] 8.2 Analyze test coverage gaps for THIS feature only
    - Identify any critical end-to-end workflows not covered
    - Focus ONLY on gaps related to this spec's Jira integration requirements
    - Do NOT assess entire application test coverage
    - Prioritize integration flow: controller -> service -> client -> mapping chain
  - [x] 8.3 Write up to 5 additional strategic tests maximum (if needed)
    - Potential gap: full integration test -- controller receives request, mocks Jira response, verifies complete WorkItemDto output with all fields mapped
    - Potential gap: child expansion with parent linkage -- verify child `parentId` matches parent `id` in the combined response list
    - Potential gap: type mapping with multiple project keys -- verify correct per-project resolution
    - Potential gap: `maxResults` and `jql` override parameters are forwarded correctly
    - Potential gap: WorkItemDto JSON serialization -- verify snake_case output matches expected contract
  - [x] 8.4 Run all feature-specific tests
    - Run ONLY tests related to jira-service and gateway jira route
    - Expected total: approximately 29-34 tests maximum
    - Do NOT run the entire application test suite
    - Verify all tests pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 29-34 tests total)
- Critical integration workflows for Jira -> WorkItemDto mapping are covered
- No more than 5 additional tests added
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

```
Task Group 1: Maven Project and Application Bootstrap
       |
       v
Task Group 2: JiraProperties, DeterministicIdGenerator, WorkItemDto
       |
       v
Task Group 3: RestClient Configuration and Jira API Client Service
       |
       v
Task Group 4: Type Mapping, WorkItemDto Mapping, and Child Expansion
       |
       v
Task Group 5: Controller, Error Handling, and Integration Tests
       |
       v
Task Group 6: Gateway Proxy Route, Config, and Wiring ----+
       |                                                    |
       v                                                    |
Task Group 7: Docker Compose and Environment Configuration -+
       |
       v
Task Group 8: Test Review and Gap Analysis
```

**Notes on parallelism:**
- Task Groups 6 and 7 can be worked in parallel once Task Group 5 is complete, as they modify different codebases (gateway vs. docker/infrastructure).
- Task Group 8 must run last, after all implementation groups are complete.
- Task Groups 1-5 are strictly sequential within the jira-service Java codebase, as each builds on the layer below it.

## Summary of Test Counts

| Task Group | Tests Written | Scope |
|------------|--------------|-------|
| Group 2 (Config/Util) | 6 | JiraProperties validation, DeterministicIdGenerator |
| Group 3 (REST Client) | 5 | Auth header, JiraSearchService |
| Group 4 (Mapping/Logic) | 8 | Type mapping, DTO mapping, child batching |
| Group 5 (Controller) | 7 | MockMvc endpoint tests, error handling |
| Group 6 (Gateway) | 3 | Proxy route, config, error forwarding |
| Group 8 (Gap Fill) | 5 | Integration flows, serialization, multi-project mapping |
| **Total** | **34** | |
