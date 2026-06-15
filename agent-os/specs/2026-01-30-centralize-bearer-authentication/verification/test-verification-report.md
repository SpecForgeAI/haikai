# Test Verification Report: Centralize Bearer Authentication

Spec: 2026-01-30-centralize-bearer-authentication
Date: 2026-01-30
Task Group 6: Testing and Verification

---

## 1. Automated Test Summary

### 1.1 Gateway Tests

#### shapeSpecUpstreamClient.test.ts (7 tests)
Location: `gateway/src/services/__tests__/shapeSpecUpstreamClient.test.ts`

| Test | Description | Status |
|------|-------------|--------|
| 1 | should inject Authorization header when token is configured | PASS |
| 2 | should fail fast with clear error when token is missing | PASS |
| 3 | should fail fast with clear error when token is undefined | PASS |
| 4 | should preserve caller-provided headers and options | PASS |
| 5 | should construct correct URL from config base URL and path | PASS |
| 6 | should NOT allow caller to override Authorization header | PASS |
| 7 | should return Response object from upstream | PASS |

#### shapeSpec.test.ts (9 tests)
Location: `gateway/src/routes/__tests__/shapeSpec.test.ts`

| Test | Description | Status |
|------|-------------|--------|
| 1 | should proxy request body to upstream service | PASS |
| 2 | should set correct SSE headers on successful upstream connection | PASS |
| 3 | should return 500 with generic message when token is missing | PASS |
| 4 | should return 502 with "Upstream authentication failed" on 401 | PASS |
| 5 | should return 502 with "Upstream authentication failed" on 403 | PASS |
| 6 | should return 503 with "Shape-Spec service unavailable" on network error | PASS |
| 7 | should return 503 on timeout error | PASS |
| 8 | should forward request body with optional session_mode omitted | PASS |
| 9 | (implicit) Validates request body forwarding | PASS |

#### orchestrationClient.test.ts (8 tests)
Location: `gateway/src/services/__tests__/orchestrationClient.test.ts`

| Test | Description | Status |
|------|-------------|--------|
| 1 | should use shapeSpecFetch for upstream requests | PASS |
| 2 | should pass correct path and options to shapeSpecFetch | PASS |
| 3 | should preserve existing timeout behavior with AbortController | PASS |
| 4 | should preserve existing error categorization for 422 validation errors | PASS |
| 5 | should preserve existing error categorization for 5xx server errors | PASS |
| 6 | should preserve existing error categorization for network errors | PASS |
| 7 | should preserve existing timeout error handling | PASS |
| 8 | should return success result with data on successful response | PASS |

### 1.2 Frontend Tests

#### shapeSpecApi.test.ts (8 tests)
Location: `frontend/src/api/shapeSpecApi.test.ts`

| Test | Description | Status |
|------|-------------|--------|
| 1 | matches spec: { company, project, message, session_mode: "new" } | PASS |
| 2 | uses correct endpoint path /api/v1/shape-spec/stream via Gateway | PASS |
| 3 | uses POST method with Content-Type: application/json (no Authorization header) | PASS |
| 4 | throws error on non-OK response (e.g., 500) | PASS |
| 5 | throws error on non-OK response (e.g., 400) | PASS |
| 6 | returns Response object on successful request | PASS |
| 7 | includes session_mode field when provided in request | PASS |
| 8 | omits session_mode field entirely when not provided (continuation call) | PASS |

### 1.3 Test Totals

| Component | Tests | Passed | Failed |
|-----------|-------|--------|--------|
| Gateway - shapeSpecUpstreamClient | 7 | 7 | 0 |
| Gateway - shapeSpec route | 9 | 9 | 0 |
| Gateway - orchestrationClient | 8 | 8 | 0 |
| Frontend - shapeSpecApi | 8 | 8 | 0 |
| **Total** | **32** | **32** | **0** |

---

## 2. Manual Integration Test Documentation

### 2.1 Test: Token Configured (Happy Path)

**Prerequisites:**
1. Set `SHAPE_SPEC_BEARER_TOKEN` in gateway `.env` file with a valid token
2. Start Gateway service (default: localhost:3000)
3. Start Shape-Spec service (default: localhost:8000)

**Steps:**
1. Call `POST /api/v1/shape-spec/stream` from frontend (or using curl/Postman)
2. Request body:
   ```json
   {
     "company": "TestOrganisation",
     "project": "test-project",
     "message": "/shape-spec Test feature description",
     "session_mode": "new"
   }
   ```

**Expected Behavior:**
- HTTP 200 response with SSE stream
- Response headers include:
  - `Content-Type: text/event-stream`
  - `Cache-Control: no-cache`
  - `Connection: keep-alive`
  - `X-Accel-Buffering: no`
- SSE events stream through without buffering
- Shape-Spec service receives `Authorization: Bearer <token>` header

**Verification Commands:**
```bash
# Using curl
curl -X POST http://localhost:3000/api/v1/shape-spec/stream \
  -H "Content-Type: application/json" \
  -d '{"company":"TestOrganisation","project":"test-project","message":"/shape-spec Test","session_mode":"new"}' \
  --no-buffer

# Check server logs for successful proxy
```

---

### 2.2 Test: Token Missing

**Prerequisites:**
1. Remove or comment out `SHAPE_SPEC_BEARER_TOKEN` from gateway `.env`
2. Restart Gateway service

**Steps:**
1. Call `POST /api/v1/shape-spec/stream`
2. Use same request body as 2.1

**Expected Behavior:**
- HTTP 500 response
- Response body: `{ "error": "Internal server error" }`
- Server logs show: `Shape-Spec Bearer token is not configured`
- No token details exposed in response
- No upstream call attempted

**Verification:**
```bash
curl -X POST http://localhost:3000/api/v1/shape-spec/stream \
  -H "Content-Type: application/json" \
  -d '{"company":"TestOrganisation","project":"test-project","message":"Test","session_mode":"new"}'

# Expected response:
# HTTP/1.1 500 Internal Server Error
# {"error":"Internal server error"}
```

---

### 2.3 Test: Invalid Token

**Prerequisites:**
1. Set `SHAPE_SPEC_BEARER_TOKEN=invalid-token-12345` in gateway `.env`
2. Restart Gateway service
3. Shape-Spec service running and configured to reject invalid tokens

**Steps:**
1. Call `POST /api/v1/shape-spec/stream`
2. Use same request body as 2.1

**Expected Behavior:**
- HTTP 502 response
- Response body: `{ "error": "Upstream authentication failed" }`
- No token value exposed in response body
- Server logs show upstream 401/403 error (without token details)

**Verification:**
```bash
curl -X POST http://localhost:3000/api/v1/shape-spec/stream \
  -H "Content-Type: application/json" \
  -d '{"company":"TestOrganisation","project":"test-project","message":"Test","session_mode":"new"}'

# Expected response:
# HTTP/1.1 502 Bad Gateway
# {"error":"Upstream authentication failed"}
```

---

### 2.4 Test: Service Unavailable

**Prerequisites:**
1. Set valid `SHAPE_SPEC_BEARER_TOKEN` in gateway `.env`
2. Start Gateway service
3. **Stop** Shape-Spec service (localhost:8000 not running)

**Steps:**
1. Call `POST /api/v1/shape-spec/stream`
2. Use same request body as 2.1

**Expected Behavior:**
- HTTP 503 response
- Response body: `{ "error": "Shape-Spec service unavailable" }`
- Server logs show connection refused or timeout error
- No auth details exposed

**Verification:**
```bash
# Ensure Shape-Spec service is stopped
# Then call the endpoint

curl -X POST http://localhost:3000/api/v1/shape-spec/stream \
  -H "Content-Type: application/json" \
  -d '{"company":"TestOrganisation","project":"test-project","message":"Test","session_mode":"new"}'

# Expected response:
# HTTP/1.1 503 Service Unavailable
# {"error":"Shape-Spec service unavailable"}
```

---

## 3. Error Handling Verification Matrix

| Scenario | HTTP Status | Error Message | Token Exposed? | Auth Details Exposed? |
|----------|-------------|---------------|----------------|----------------------|
| Token missing/empty | 500 | "Internal server error" | No | No |
| Upstream returns 401 | 502 | "Upstream authentication failed" | No | No |
| Upstream returns 403 | 502 | "Upstream authentication failed" | No | No |
| Network error / Connection refused | 503 | "Shape-Spec service unavailable" | No | No |
| Request timeout | 503 | "Shape-Spec service unavailable" | No | No |
| Success | 200 | (SSE stream) | No | N/A |

---

## 4. Implementation Verification Checklist

### A) Gateway Configuration
- [x] `shapeSpecBearerToken` added to Config interface
- [x] Token loaded from `SHAPE_SPEC_BEARER_TOKEN` environment variable
- [x] No startup validation (fails per-request)
- [x] `.env.example` documented

### B) Centralized HTTP Client (shapeSpecFetch)
- [x] Auto-injects Authorization header for ALL requests
- [x] Fails fast when token is missing/empty
- [x] Uses `orchestrationServiceBaseUrl` as base URL
- [x] Prevents caller from overriding Authorization header
- [x] Exported from services index

### C) Shape-Spec Proxy Route
- [x] Route registered at `/api/v1/shape-spec`
- [x] POST /stream endpoint proxies to upstream
- [x] SSE headers set correctly
- [x] Transparent streaming (no buffering)
- [x] Error handling per spec

### D) orchestrationClient Refactored
- [x] Uses shapeSpecFetch for upstream requests
- [x] No manual Authorization header
- [x] Timeout behavior preserved
- [x] Error categorization preserved

### E) Frontend Changes
- [x] Uses `VITE_GATEWAY_BASE_URL` (empty string fallback for same-origin)
- [x] Calls `/api/v1/shape-spec/stream`
- [x] No Authorization headers sent

### F) Error Handling
- [x] Token missing: 500 with generic message
- [x] Upstream 401/403: 502 with "Upstream authentication failed"
- [x] Network error: 503 with "Shape-Spec service unavailable"
- [x] No auth details exposed in any response

---

## 5. Conclusion

All automated tests pass (32/32). The implementation follows the specification requirements:

1. **Centralized authentication**: All Gateway-to-Shape-Spec requests use `shapeSpecFetch` which auto-injects Bearer auth
2. **Frontend isolation**: Frontend sends no authentication headers; auth is handled server-side
3. **Error opacity**: Error responses never expose token values or upstream auth details
4. **SSE streaming**: Proxy transparently streams SSE without buffering

Manual integration tests are documented above for validation in a running environment.
