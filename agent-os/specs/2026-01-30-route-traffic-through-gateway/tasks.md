# Task Breakdown: Route Traffic Through Gateway

## Overview
Total Tasks: 5 Task Groups with approximately 25 sub-tasks

This spec eliminates direct browser-to-localhost:8000 calls by routing all Shape-Spec and Orchestration traffic through the Gateway service. The Gateway handles server-side Bearer token injection for upstream authentication.

## Task List

### Gateway Layer

#### Task Group 1: Add AbortSignal Support to shapeSpecFetch
**Dependencies:** None
**File:** `gateway/src/services/shapeSpecUpstreamClient.ts`

- [x] 1.0 Complete AbortSignal parameter support in shapeSpecFetch
  - [x] 1.1 Write 2-4 focused tests for AbortSignal functionality
    - Test that AbortSignal is passed through to underlying fetch call
    - Test that fetch is aborted when signal is triggered
    - Test that function works correctly when signal is undefined
    - Test that signal abort error propagates correctly
  - [x] 1.2 Update shapeSpecFetch function signature
    - Accept optional AbortSignal in the options parameter
    - Signal is part of standard RequestInit, so minimal changes needed
    - Ensure signal is passed through to the underlying fetch() call
  - [x] 1.3 Update JSDoc documentation
    - Add signal parameter to JSDoc example
    - Document abort behavior in function description
  - [x] 1.4 Ensure AbortSignal tests pass
    - Run ONLY the 2-4 tests written in 1.1
    - Verify signal passthrough works correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-4 tests written in 1.1 pass
- shapeSpecFetch accepts AbortSignal in options parameter
- Signal is correctly passed through to fetch()
- JSDoc is updated with signal usage example

---

#### Task Group 2: Add Client Disconnect Abort to shapeSpec.ts
**Dependencies:** Task Group 1
**File:** `gateway/src/routes/shapeSpec.ts`

- [x] 2.0 Complete client disconnect abort handling
  - [x] 2.1 Write 2-4 focused tests for client disconnect abort
    - Test that AbortController is created before shapeSpecFetch call
    - Test that abort is called when client disconnects (req.on('close'))
    - Test that upstream request is cancelled on client disconnect
    - Test normal flow continues to work when client stays connected
  - [x] 2.2 Create AbortController before making shapeSpecFetch call
    - Create AbortController instance at start of route handler
    - Store reference for use in disconnect handler
  - [x] 2.3 Pass AbortController.signal to shapeSpecFetch
    - Add signal to the options parameter in shapeSpecFetch call
    - Example: `shapeSpecFetch(path, { ...options, signal: abortController.signal })`
  - [x] 2.4 Connect AbortController to req.on('close') handler
    - Enhance existing isClientConnected tracking (lines 120-124)
    - Call abortController.abort() when client disconnects
    - Prevents orphaned upstream requests when users navigate away
  - [x] 2.5 Add logging for abort scenarios
    - Log when upstream request is aborted due to client disconnect
    - Include requestId for traceability
  - [x] 2.6 Ensure client disconnect abort tests pass
    - Run ONLY the 2-4 tests written in 2.1
    - Verify abort behavior on client disconnect
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-4 tests written in 2.1 pass
- AbortController is created and signal passed to shapeSpecFetch
- Client disconnect triggers abort of upstream request
- Logging captures abort scenarios

---

#### Task Group 3: Update orchestrations.ts to Use shapeSpecFetch
**Dependencies:** Task Group 1
**File:** `gateway/src/routes/orchestrations.ts`

- [x] 3.0 Complete orchestrations proxy migration to shapeSpecFetch
  - [x] 3.1 Write 2-4 focused tests for orchestrations shapeSpecFetch migration
    - Test that shapeSpecFetch is used instead of raw fetch
    - Test that server-side Bearer token is injected (not browser auth)
    - Test that browser Authorization header is NOT forwarded
    - Test that upstream auth failures return generic error message
  - [x] 3.2 Import shapeSpecFetch in orchestrations.ts
    - Add import: `import { shapeSpecFetch } from '../services/shapeSpecUpstreamClient';`
    - Remove any now-unused imports if applicable
  - [x] 3.3 Replace raw fetch() with shapeSpecFetch() in POST /v1/orchestrations
    - Current code (lines 401-406) uses raw fetch
    - Replace with shapeSpecFetch() call
    - Use relative path: `ORCHESTRATION_API_PATH` ('/api/v1/orchestrations')
    - shapeSpecFetch automatically adds the base URL
  - [x] 3.4 Remove browser Authorization header forwarding
    - Remove lines 376-380 that forward browser auth header
    - shapeSpecFetch injects ONLY server-side Bearer token
    - This ensures consistent auth handling across all upstream calls
  - [x] 3.5 Update proxyHeaders to exclude Authorization
    - Keep Content-Type, Accept, and User-Agent headers
    - Remove Authorization from proxyHeaders object
    - shapeSpecFetch handles Authorization injection
  - [x] 3.6 Handle upstream auth failures with generic error
    - Add handling for 401/403 responses (like shapeSpec.ts lines 95-101)
    - Return `{ error: 'Upstream authentication failed' }`
    - Do NOT expose upstream status codes or details
  - [x] 3.7 Ensure orchestrations migration tests pass
    - Run ONLY the 2-4 tests written in 3.1
    - Verify shapeSpecFetch is used correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-4 tests written in 3.1 pass
- raw fetch() replaced with shapeSpecFetch()
- Browser Authorization header forwarding removed
- Generic error responses for upstream auth failures
- Server-side Bearer token used for all upstream calls

---

### Frontend Layer

#### Task Group 4: Update useShapeSpecStream.ts to Use Gateway
**Dependencies:** None (can run in parallel with Task Groups 1-3)
**File:** `frontend/src/hooks/useShapeSpecStream.ts`

- [x] 4.0 Complete frontend migration to Gateway-relative URLs
  - [x] 4.1 Write 2-4 focused tests for Gateway URL routing
    - Test that SHAPE_SPEC_BASE_URL uses VITE_GATEWAY_BASE_URL
    - Test that empty string default is used when env var not set
    - Test that localhost:8000 fallback is NOT present
    - Test that requests route to Gateway path correctly
  - [x] 4.2 Update SHAPE_SPEC_BASE_URL constant (line 122)
    - Change from: `import.meta.env.VITE_SHAPE_SPEC_BASE_URL ?? 'http://localhost:8000'`
    - Change to: `import.meta.env.VITE_GATEWAY_BASE_URL ?? ''`
    - Follow pattern from shapeSpecApi.ts (line 27)
  - [x] 4.3 Update code comments
    - Update comment on line 119-121 to reflect Gateway routing
    - Remove references to "localhost" or "direct" Shape-Spec calls
    - Add reference to shapeSpecApi.ts pattern being followed
  - [x] 4.4 Verify fetch call has no Authorization header
    - Confirm lines 293-300 do not send Authorization header
    - Gateway handles Bearer token injection server-side
    - Current code already correct (only sends Content-Type)
  - [x] 4.5 Ensure frontend tests pass
    - Run ONLY the 2-4 tests written in 4.1
    - Verify Gateway URL routing works correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-4 tests written in 4.1 pass
- SHAPE_SPEC_BASE_URL uses VITE_GATEWAY_BASE_URL
- Empty string default prevents direct upstream calls
- localhost:8000 fallback completely removed
- Follows same pattern as shapeSpecApi.ts

---

### Testing & Verification

#### Task Group 5: Test Review and Integration Verification
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and verify integration
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 2-4 tests written for AbortSignal support (Task 1.1)
    - Review the 2-4 tests written for client disconnect abort (Task 2.1)
    - Review the 2-4 tests written for orchestrations migration (Task 3.1)
    - Review the 2-4 tests written for frontend Gateway routing (Task 4.1)
    - Total existing tests: approximately 8-16 tests
  - [x] 5.2 Analyze test coverage gaps for THIS feature only
    - Identify integration points that lack coverage
    - Focus on end-to-end flows: browser -> Gateway -> upstream
    - Check abort signal propagation through full stack
    - Verify error response handling end-to-end
  - [x] 5.3 Write up to 6 additional integration tests if needed
    - Test full request flow: frontend -> Gateway -> shapeSpecFetch -> upstream
    - Test abort propagation: client disconnect -> Gateway abort -> upstream abort
    - Test auth error handling: upstream 401 -> Gateway -> generic error to frontend
    - Test missing token scenario: shapeSpecFetch throws -> 500 to frontend
  - [x] 5.4 Manual verification checklist
    - [x] Verify VITE_GATEWAY_BASE_URL not set results in same-origin requests
    - [x] Verify localhost:8000 is never called directly from browser
    - [x] Verify Gateway injects Bearer token for all upstream calls
    - [x] Verify client disconnect aborts upstream request
    - [x] Verify upstream 401/403 returns generic error (no status code leak)
  - [x] 5.5 Run feature-specific tests only
    - Run all tests related to this spec's feature
    - Expected total: approximately 14-22 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 14-22 tests total)
- Integration points verified end-to-end
- No more than 6 additional tests added for critical gaps
- Manual verification checklist completed
- No direct localhost:8000 calls from browser

---

## Execution Order

Recommended implementation sequence:

```
Task Group 1: AbortSignal Support (Gateway)
    |
    +---> Task Group 2: Client Disconnect Abort (Gateway)
    |
    +---> Task Group 3: Orchestrations Migration (Gateway)

Task Group 4: Frontend Gateway Routing (can run in parallel with 1-3)

    |
    v
Task Group 5: Test Review & Integration Verification
```

**Parallel Execution Notes:**
- Task Groups 2 and 3 both depend on Task Group 1
- Task Group 4 has no dependencies and can run in parallel with Task Groups 1-3
- Task Group 5 must run after all other groups complete

## Files Modified

| File | Task Group | Change Summary |
|------|------------|----------------|
| `gateway/src/services/shapeSpecUpstreamClient.ts` | 1 | Add AbortSignal parameter support |
| `gateway/src/routes/shapeSpec.ts` | 2 | Add client disconnect abort handling |
| `gateway/src/routes/orchestrations.ts` | 3 | Use shapeSpecFetch, remove browser auth forwarding |
| `frontend/src/hooks/useShapeSpecStream.ts` | 4 | Use Gateway-relative URLs |

## Key Patterns to Follow

1. **Gateway-relative URL pattern** (from `shapeSpecApi.ts` line 27):
   ```typescript
   const BASE_URL = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';
   ```

2. **shapeSpecFetch usage pattern** (from `shapeSpec.ts`):
   ```typescript
   const response = await shapeSpecFetch(path, {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify(requestBody),
     signal: abortController.signal, // NEW: abort support
   });
   ```

3. **Client disconnect abort pattern**:
   ```typescript
   const abortController = new AbortController();
   req.on('close', () => {
     abortController.abort();
   });
   ```

4. **Generic error response pattern** (from `shapeSpec.ts` lines 95-101):
   ```typescript
   if (response.status === 401 || response.status === 403) {
     return res.status(502).json({ error: 'Upstream authentication failed' });
   }
   ```
