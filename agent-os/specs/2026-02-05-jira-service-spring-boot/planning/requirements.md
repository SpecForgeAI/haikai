# Spec Requirements: New Jira Service (Spring Boot) -- GET /jira/issues

## Initial Description

Introduce a dedicated Jira integration service (Java/Spring Boot) whose first capability is to query Jira Cloud using JQL and return results mapped into the tool's WorkItemDto shape (not raw Jira DTOs). Support optional parent/child expansion using modern Jira Cloud parent.key linkage. Include toolProjectId request param to set WorkItemDto.projectId (tool project, not Jira project). Gateway route: GET /api/v1/jira/issues -> jira-service GET /jira/issues. UUIDv3 (`nameUUIDFromBytes`) for deterministic IDs (namespace + toolProjectId + external_key). Configurable type mapping: Jira issue types -> WorkItemDto.type per Jira project key. Configurable auth (bearer token or basic auth with API token).

**Endpoint Path Decision:** The jira-service exposes `GET /jira/issues` (not `/jira/work-items` as originally proposed in the raw idea). The gateway proxies `GET /api/v1/jira/issues` to jira-service `GET /jira/issues`, keeping the path name consistent end-to-end.

## Raw Idea (from raw-idea.md)

**Title:** New Jira Service (Spring Boot) -- GET /jira/work-items with configurable type mapping + optional child expansion

**Intent:** Introduce a dedicated Jira integration service (Java/Spring Boot) whose first capability is to query Jira Cloud using JQL and return results mapped into the tool's WorkItemDto shape (not raw Jira DTOs). Support optional parent/child expansion using modern Jira Cloud parent.key linkage. Include toolProjectId request param to set WorkItemDto.projectId (tool project, not Jira project).

**Date Initiated:** 2026-02-05

## Codebase Findings

### 1. Existing WorkItemDto (architecture-model-service)

**File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/WorkItemDto.java`

The existing WorkItemDto is a Java record with @JsonProperty annotations for snake_case serialization:

```java
public record WorkItemDto(
    UUID id,
    String projectId,      // "project_id"
    String type,           // e.g., "INITIATIVE", "EPIC", "FEATURE", "STORY"
    UUID parentId,         // "parent_id"
    String title,
    String description,
    String status,
    Integer sortOrder,     // "sort_order"
    Integer priority,
    String targetWindow,   // "target_window"
    Map<String, Object> tags,
    String externalSystem, // "external_system"
    String externalKey,    // "external_key"
    Instant createdAt,     // "created_at"
    Instant updatedAt      // "updated_at"
)
```

Key observations:
- Uses Java records (not Lombok classes) for DTOs
- snake_case JSON via @JsonProperty annotations
- Global Jackson config in application.yml also sets `property-naming-strategy: SNAKE_CASE`
- `externalSystem` and `externalKey` fields already exist -- designed for external integrations
- `tags` is `Map<String, Object>` -- flexible JSON storage
- `type` is a plain String (not an enum), values are uppercase: INITIATIVE, EPIC, FEATURE, STORY

### 2. Architecture-Model-Service Conventions

**Build tool:** Maven (pom.xml)
**Spring Boot version:** 3.2.5
**Java version:** 21
**Package structure:** `com.example.architecturemodel` with sub-packages: config, controller, exception, mapper, model (dto/entity), repository, service, store, util
**Key dependencies:**
- spring-boot-starter-web
- spring-boot-starter-data-jpa (with PostgreSQL + Liquibase)
- spring-boot-starter-validation
- spring-boot-starter-actuator
- jackson-databind + jackson-datatype-jsr310
- Lombok
- H2 for tests

**Application config:** YAML-based (application.yml)
- Global Jackson SNAKE_CASE naming strategy
- `write-dates-as-timestamps: false` (ISO-8601 dates)
- `fail-on-unknown-properties: false`
- Port 8080
- Actuator endpoints: health, env

**Controller pattern:** Uses `@RestController`, `@RequestMapping`, `@RequiredArgsConstructor`, `@Slf4j`, `@ConditionalOnProperty` for feature toggles.

### 3. Architecture-Read-Service Conventions (Second Java Service)

**File:** `architecture-read-service/pom.xml`
**Package:** `com.example.archtool`
**Spring Boot version:** 3.2.0
**Build tool:** Maven
**Key pattern -- External API config:**

Uses `@ConfigurationProperties` record for Confluence API settings:
```java
@ConfigurationProperties(prefix = "archtool.confluence")
public record ConfluenceProperties(
    String apiBaseUrl,
    String username,
    String apiToken,
    int connectTimeoutMs,
    int readTimeoutMs,
    int maxPageDepth
)
```

Uses Spring's `RestClient` (not RestTemplate or WebClient) for HTTP calls, with Basic Auth via `username:apiToken` pattern.

### 4. Gateway Proxy Patterns

**Technology:** Node.js/Express/TypeScript (gateway runs on port 8081)

**Two distinct proxy patterns exist:**

**Pattern A -- Direct axios proxy to architecture-model-service (organisations.ts):**
- Uses `axios` for HTTP calls
- Reads `config.architectureModelServiceBaseUrl` (env: `ARCHITECTURE_MODEL_SERVICE_URL`)
- No auth injection needed (same-network call)
- Simple error forwarding with `handleProxyError()`
- Route mounted at `/api/v1/organisations`

**Pattern B -- Authenticated proxy via implementationLlmProxyClient (shapeSpec.ts, standardsGenerate.ts):**
- Uses custom `requestStream()` / `postJson()` / `getJson()` helpers
- Auto-injects Bearer token from `config.implementationLlmServiceBearerToken`
- Route mounted at `/api/v1/shape-spec`

**Config pattern for upstream services (gateway/src/config.ts):**
- Interface-level field: e.g., `architectureModelServiceBaseUrl: string`
- loadConfig() reads from env var: `process.env.ARCHITECTURE_MODEL_SERVICE_URL || 'http://localhost:8080'`
- Singleton pattern via `getConfig()`

**Route registration (gateway/src/server.ts):**
- Import router from routes/index.ts
- Mount with `app.use('/api/v1/...', routerName)`
- Add console.log for the endpoint URL at startup

### 5. Docker Compose Infrastructure

Current services: postgres (5432), architecture-model-service (8080), architecture-read-service (8079), mcp-server (8090), gateway (8081), frontend (5173).

New jira-service would need:
- Its own service entry
- A port assignment (no existing service uses 8078, for example)
- Connection to `arch-tool-network`
- No PostgreSQL dependency (stateless proxy to Jira Cloud)

### 6. Frontend API Configuration

**File:** `frontend/.env.development`
The frontend talks to the gateway (port 8081), not directly to backend services. The gateway would need to proxy jira-service endpoints so the frontend can reach them.

## Requirements Discussion

### First Round Questions

**Q1:** The jira-service will produce WorkItemDto objects with identical structure to the architecture-model-service's WorkItemDto. I see two options: (a) duplicate the WorkItemDto record in the new jira-service codebase (simple, no coupling), or (b) extract a shared Maven module that both services depend on. Given that this is only one DTO today and the services are independently deployed, I am assuming option (a) -- duplicate the record in the jira-service with the same fields and @JsonProperty annotations. Is that correct, or do you want a shared module?

**Answer:** For v1, duplicate the WorkItemDto record in jira-service (same fields/JsonProperty). Extract shared module later if needed.

**Q2:** The architecture-model-service uses Maven (pom.xml) and Spring Boot 3.2.5. The architecture-read-service also uses Maven but Spring Boot 3.2.0. I am assuming the jira-service should use Maven and match the architecture-model-service at Spring Boot 3.2.5 for consistency. The package would be something like `com.example.jiraservice`. Is that correct, or do you prefer a different groupId/artifactId or package naming convention?

**Answer:** Maven + Spring Boot 3.2.5. Package: `com.example.jiraservice`. WorkItemDto stays identical structure; package doesn't need to match architecture-model-service.

**Q3:** For the gateway proxy route, the existing pattern for proxying to architecture-model-service uses `axios` with no auth injection (Pattern A from organisations.ts). Since the jira-service is a same-network internal service (not an external LLM proxy), I am assuming the gateway route should follow Pattern A -- use axios, add a new config field `jiraServiceBaseUrl` (env: `JIRA_SERVICE_URL`, default `http://localhost:8078`), and proxy GET /api/v1/jira/issues to the jira-service's GET /jira/work-items. Is that correct?

**Answer:** Follow existing pattern: axios + new config `JIRA_SERVICE_URL` (default `http://localhost:8078`). Proxy `GET /api/v1/jira/issues` to jira-service `GET /jira/issues` (keep path name consistent -- use `/jira/issues` not `/jira/work-items`).

**Q4:** For configurable Jira auth, the architecture-read-service's Confluence integration uses `@ConfigurationProperties` with `username` + `apiToken` (Basic Auth). Your spec mentions supporting either bearer token OR basic auth (email + API token). I am assuming we use a `@ConfigurationProperties(prefix = "jira")` record with fields like `baseUrl`, `authMode` (enum: BEARER, BASIC), `bearerToken`, `username`, `apiToken`, plus connection/read timeout settings. The service would build the appropriate Authorization header based on `authMode`. Is that the right approach, or should we handle auth differently (e.g., only support one mode)?

**Answer:** Support both via config: `authMode` enum (BEARER vs BASIC) using `@ConfigurationProperties`, building Authorization header accordingly.

**Q5:** For the configurable type mapping (Jira issue types -> WorkItemDto.type per Jira project key), I am assuming this would be YAML-based configuration, something like:

```yaml
jira:
  type-mapping:
    PROJECT_KEY_1:
      Epic: INITIATIVE
      Story: FEATURE
      Task: STORY
    PROJECT_KEY_2:
      Initiative: INITIATIVE
      Epic: EPIC
```

With a sensible default mapping for unmapped types (e.g., unmapped Jira types could either be excluded or mapped to a fallback like "STORY"). Should unmapped Jira issue types be excluded from results, mapped to a configurable default, or cause an error?

**Answer:** Map to STORY with a warning (do not exclude, do not error).

**Q6:** For UUIDv5 deterministic IDs, you specified namespace + toolProjectId + externalKey as the inputs. I am assuming: (a) the namespace UUID is a fixed constant defined in the service (e.g., a well-known UUID specific to this tool), (b) the name string is the concatenation of `toolProjectId + ":" + externalKey` (e.g., `"my-project:PROJ-123"`), and (c) the standard java.util.UUID.nameUUIDFromBytes() method (which is actually UUIDv3/MD5) is NOT what we want -- we need a proper UUIDv5 (SHA-1) implementation. Should we use a library (e.g., `com.fasterxml.uuid:java-uuid-generator`) or implement UUIDv5 manually?

**Answer:** UUIDv3 (`nameUUIDFromBytes`) is acceptable for v1. Library optional, not required.

**Q7:** For the optional child expansion using Jira Cloud's modern `parent.key` traversal, I have a few sub-questions: (a) Is this triggered by a query parameter on the endpoint (e.g., `?expandChildren=true`)? (b) Does it fetch children by issuing a secondary JQL query like `parent = PROJ-123` for each returned issue? (c) Should the child expansion be limited to one level, or recursive? (d) For expanded children, do they get their own UUIDv5 IDs, and their `parentId` is set to the UUIDv5 of their parent issue?

**Answer:** Children get deterministic IDs and parentId set via deterministic parent UUID. Batch parent-key JQL queries with safe size (e.g., 50) to avoid JQL length limits.

**Q8:** Regarding the endpoint contract -- the jira-service endpoint is GET /jira/work-items. I am assuming the required query parameters include at minimum: `jiraProjectKey` (the Jira project to query), `toolProjectId` (for setting WorkItemDto.projectId), and optionally JQL override, maxResults, and expandChildren. The response would be a JSON array of WorkItemDto objects. Is that the right parameter set, or are there additional parameters needed (e.g., status filter, specific Jira fields)?

**Answer:** (Not explicitly answered separately -- see combined decisions in summary below. The endpoint is `GET /jira/issues` per the path decision in Q3.)

**Q9:** Is there anything that should be explicitly excluded from the scope of this spec? For example: write operations to Jira (creating/updating issues), webhook support, caching of Jira results, or frontend UI changes to consume this new endpoint?

**Answer:** Docker Compose entry for jira-service IS in scope for this iteration so it is runnable locally with gateway, using sensible defaults and env placeholders. (No explicit exclusion list provided beyond the original scope.)

### Existing Code to Reference

**Similar Features Identified:**
- Feature: WorkItemDto -- Path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/WorkItemDto.java`
- Feature: WorkItemController -- Path: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/WorkItemController.java`
- Feature: Confluence external API config -- Path: `architecture-read-service/src/main/java/com/example/archtool/config/ConfluenceProperties.java`
- Feature: RestClient config with auth -- Path: `architecture-read-service/src/main/java/com/example/archtool/config/RestClientConfig.java`
- Feature: Gateway proxy route (axios pattern) -- Path: `gateway/src/routes/organisations.ts`
- Feature: Gateway config for upstream services -- Path: `gateway/src/config.ts`
- Feature: Gateway server route mounting -- Path: `gateway/src/server.ts`
- Feature: Docker service definition -- Path: `docker-compose.yml`

### Follow-up Questions

No follow-up questions required. All first-round questions were answered with sufficient detail to proceed.

## Visual Assets

### Files Provided:
No visual assets provided. This is a backend-only service with no UI component.

### Visual Insights:
N/A -- backend service only.

## Requirements Summary

### Formal Decisions

The following decisions were made during the clarifying questions phase:

1. **WorkItemDto approach (v1):** Duplicate the WorkItemDto record in jira-service with identical fields and @JsonProperty annotations. No shared Maven module. Extract to shared module later if needed.

2. **Tech stack:** Maven + Spring Boot 3.2.5, Java 21. Package: `com.example.jiraservice`. WorkItemDto structure is identical to architecture-model-service but the package does not need to match.

3. **Endpoint path decision:** The jira-service exposes `GET /jira/issues` (NOT `/jira/work-items` as originally proposed in the raw idea). The gateway proxies `GET /api/v1/jira/issues` to jira-service `GET /jira/issues`, keeping the path name consistent end-to-end.

4. **Gateway proxy pattern:** Follow the existing axios Pattern A (from organisations.ts). New config field `jiraServiceBaseUrl` with env var `JIRA_SERVICE_URL`, default `http://localhost:8078`. No auth injection needed (same-network internal call).

5. **Jira auth configuration:** Support both BEARER and BASIC auth modes via `@ConfigurationProperties`. An `authMode` enum selects the mode, and the service builds the appropriate Authorization header accordingly. Follows the ConfluenceProperties pattern from architecture-read-service.

6. **Unmapped Jira issue types:** Map to STORY with a warning log. Do not exclude unmapped types. Do not error on unmapped types.

7. **Deterministic IDs:** UUIDv3 via `UUID.nameUUIDFromBytes()` is acceptable for v1. A dedicated UUID library is optional and not required.

8. **Child expansion:** Children receive their own deterministic IDs. The child's `parentId` is set to the deterministic UUID of the parent issue. Batch parent-key JQL queries with a safe batch size (e.g., 50 parent keys per query) to avoid JQL length limits.

9. **Docker Compose:** Add jira-service to docker-compose.yml in this iteration so it is runnable locally alongside the gateway. Use sensible defaults and environment variable placeholders for Jira credentials.

### Functional Requirements
- New standalone Spring Boot service (jira-service) querying Jira Cloud REST API
- Single endpoint: `GET /jira/issues` returning WorkItemDto-shaped JSON (array)
- Configurable auth supporting bearer token and basic auth modes via `authMode` enum
- Configurable type mapping from Jira issue types to WorkItemDto.type values, per Jira project key (YAML-based)
- Unmapped Jira issue types default to STORY with a warning log
- UUIDv3 deterministic ID generation via `UUID.nameUUIDFromBytes()` from namespace + toolProjectId + externalKey
- Optional child issue expansion using Jira Cloud parent.key linkage
- Child expansion uses batched JQL queries (batch size ~50) to avoid JQL length limits
- Children receive deterministic IDs; `parentId` set to deterministic UUID of parent
- Gateway proxy route: `GET /api/v1/jira/issues` -> jira-service `GET /jira/issues`
- WorkItemDto.externalSystem set to "JIRA", externalKey set to Jira issue key
- Docker Compose entry for jira-service with sensible defaults and env placeholders

### Reusability Opportunities
- WorkItemDto record structure (duplicate from architecture-model-service)
- `@ConfigurationProperties` pattern for external API config (from architecture-read-service's ConfluenceProperties)
- RestClient with auth header injection (from architecture-read-service's RestClientConfig)
- Gateway axios proxy pattern (from organisations.ts route)
- Gateway config field pattern for new upstream service URLs
- Docker Compose service entry pattern (from existing services in docker-compose.yml)
- Maven pom.xml structure (from architecture-model-service)

### Scope Boundaries

**In Scope:**
- jira-service Spring Boot application with Maven build (package: `com.example.jiraservice`)
- `GET /jira/issues` endpoint with query parameters (jiraProjectKey, toolProjectId, expandChildren, maxResults, etc.)
- Jira Cloud REST API client with configurable auth (BEARER / BASIC via `@ConfigurationProperties`)
- Type mapping configuration (YAML-based, per Jira project key, unmapped -> STORY with warning)
- UUIDv3 deterministic ID generation
- Optional child expansion with batched JQL queries
- Gateway proxy route (`GET /api/v1/jira/issues` -> jira-service)
- Gateway config for `JIRA_SERVICE_URL`
- Docker Compose entry for jira-service (port 8078, sensible defaults, env placeholders)
- Unit tests for mapping, ID generation, and type resolution

**Out of Scope:**
- Write operations to Jira (creating/updating issues)
- Webhook support for Jira events
- Caching of Jira results
- Frontend UI changes to consume the new endpoint
- Shared Maven module for WorkItemDto (deferred to later iteration)
- UUIDv5 (SHA-1) -- v3 is acceptable for v1

### Technical Considerations
- Java 21, Spring Boot 3.2.5, Maven
- Package: `com.example.jiraservice`
- Jackson SNAKE_CASE naming strategy (matching architecture-model-service)
- No database dependency (stateless Jira proxy)
- Spring Boot Actuator for health checks
- RestClient (not RestTemplate) for Jira API calls, consistent with architecture-read-service
- Port 8078 (no conflicts with existing services: 8080, 8079, 8090, 8081, 5173, 5432)
- Gateway environment variable: `JIRA_SERVICE_URL` (default: `http://localhost:8078`)
- `@ConfigurationProperties(prefix = "jira")` for auth, base URL, timeouts, and type mapping
- `authMode` enum: BEARER vs BASIC, driving Authorization header construction
- `UUID.nameUUIDFromBytes()` for deterministic ID generation (UUIDv3/MD5)
- Batched JQL queries for child expansion (batch size ~50)
