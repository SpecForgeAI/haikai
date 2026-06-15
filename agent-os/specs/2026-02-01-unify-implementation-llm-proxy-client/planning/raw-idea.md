# Raw Idea: Unify Implementation LLM Proxy Service Config + Single Upstream Client

## Title
Unify Implementation LLM proxy service config + single upstream client for all gateway calls

## Intent
Prevent missing-auth regressions by enforcing that ALL Gateway -> Implementation LLM proxy service requests (current and future) go through a single canonical client that always attaches the bearer token. Rename/standardize configuration to IMPLEMENTATION_LLM_SERVICE_* and delete old unused clients/config.

## Scope

### In Scope
- Gateway config rename:
  - IMPLEMENTATION_LLM_SERVICE_BASE_URL
  - IMPLEMENTATION_LLM_SERVICE_BEARER_TOKEN
- Add canonical upstream helper: `src/services/implementationLlmProxyClient.ts`
- Refactor the following gateway endpoints to use ONLY the canonical client:
  1. POST /api/v1/standards/global/generate
  2. POST /api/v1/standards/project/generate
  3. POST /api/v1/jobs/orchestrations
- Delete old upstream client files that are now redundant (shape-spec/standards specific clients)
- Remove old config keys and references throughout gateway code
- Add regression tests ensuring Authorization header is present on upstream requests

### Out of Scope
- Changing frontend behavior
- Changing implementation LLM proxy service behavior
- Adding async job polling/retry logic

## Configuration

### Remove Old Env Vars
- SHAPE_SPEC_BEARER_TOKEN
- STANDARDS_SERVICE_BASE_URL
- STANDARDS_SERVICE_BEARER_TOKEN

### Add New Env Vars
- IMPLEMENTATION_LLM_SERVICE_BASE_URL (e.g. http://localhost:8000)
- IMPLEMENTATION_LLM_SERVICE_BEARER_TOKEN

### Gateway Startup Validation
- If IMPLEMENTATION_LLM_SERVICE_BASE_URL is missing/blank, log error and fail fast at request time with 500.
- If IMPLEMENTATION_LLM_SERVICE_BEARER_TOKEN is missing/blank, log error and fail fast at request time with 500.

## implementationLlmProxyClient

**File:** `gateway/src/services/implementationLlmProxyClient.ts`

### Responsibilities
- Read base URL + bearer token from config (IMPLEMENTATION_LLM_SERVICE_*).
- Provide a single request function for upstream calls:
  `request(path, { method, headers, body, timeoutMs? }) -> { status, headers, json/text }`
- Always attach header:
  `Authorization: "Bearer <IMPLEMENTATION_LLM_SERVICE_BEARER_TOKEN>"`
  unless caller explicitly overrides (discouraged); default must be enforced.
- Always set:
  - Content-Type: application/json (for JSON bodies)
  - Accept: application/json
- Normalize upstream errors:
  - If upstream is unreachable -> return 502 with gateway-standard error shape
  - If upstream returns non-2xx -> pass through status and a safe error payload
- Provide small helpers used by routes:
  - `postJson(path, body)`
  - `getJson(path)`

### Constraints
- No route should call fetch/axios to the implementation LLM proxy service directly.
- All such calls must go through this client.

## Gateway Routes Refactor

### Endpoints to Update
1. **POST /api/v1/standards/global/generate**
   - Upstream target: POST <IMPLEMENTATION_LLM_SERVICE_BASE_URL>/api/v1/standards/global/generate
   - Behavior: forward request body unchanged; return upstream response status/body

2. **POST /api/v1/standards/project/generate**
   - Upstream target: POST <IMPLEMENTATION_LLM_SERVICE_BASE_URL>/api/v1/standards/product/generate
   - Behavior: forward request body unchanged; return upstream response status/body

3. **POST /api/v1/jobs/orchestrations**
   - Upstream target: POST <IMPLEMENTATION_LLM_SERVICE_BASE_URL>/api/v1/jobs/orchestrations
   - Behavior: forward request body unchanged; return upstream response status/body

### Notes
- Ensure these routes do not attempt to read any old token/base-url env vars.
- Ensure all three routes rely on the canonical client so Authorization is always set.

## Delete Unused Clients
- Remove any service modules that previously handled auth/base-url separately for shape-spec/standards/orchestrations (e.g., shapeSpecUpstreamClient.ts, standardsServiceClient.ts, orchestrationServiceClient.ts if applicable), after refactoring routes to use implementationLlmProxyClient.ts.
- Remove associated config fields/types that referenced old env vars.

## Tests

### Add or Update Gateway Tests
- For each of the three routes, mock upstream request and assert:
  - Authorization header is present and equals "Bearer <token>"
  - Correct upstream URL path is used
  - Request body is forwarded unchanged
- Test missing token:
  - Route returns 500 with clear message indicating IMPLEMENTATION_LLM_SERVICE_BEARER_TOKEN not configured
- Test missing base url:
  - Route returns 500 with clear message indicating IMPLEMENTATION_LLM_SERVICE_BASE_URL not configured

## Acceptance Criteria
- Gateway uses IMPLEMENTATION_LLM_SERVICE_BASE_URL and IMPLEMENTATION_LLM_SERVICE_BEARER_TOKEN exclusively for all upstream calls to the implementation LLM proxy service.
- The three current endpoints (/standards/global/generate, /standards/project/generate, /jobs/orchestrations) all call upstream via implementationLlmProxyClient.ts.
- Authorization header is always included on upstream requests.
- Old env vars and old upstream client files are removed and no longer referenced.
- Regression tests prevent future routes from omitting Authorization headers.
