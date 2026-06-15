# Task Breakdown: Dashboard Increment 2 -- Define Dashboard Summary Contract + Backend Mock Endpoint

## Overview
Total Tasks: 20

This increment defines the `DashboardSummaryDto` contract, exposes a gateway GET endpoint returning scope-variant mock data, and provides a frontend API client function ready for Increment 3 UI consumption. No database reads. No LLM calls.

The work spans two layers (gateway and frontend) that share a contract but have no import dependency on each other. The gateway side has internal ordering constraints (types -> mock service -> route -> registration). The frontend side is independent and can be done in parallel.

## Task List

### Gateway Layer

#### Task Group 1: Gateway Types, Mock Service, Route, and Registration
**Dependencies:** None

- [x] 1.0 Complete gateway types, mock service, route, and server registration
  - [x] 1.1 Write 4-6 focused tests for the dashboard summary endpoint
    - Test 1: GET `/api/dashboard/summary?projectId=test-proj` returns 200 with a valid `DashboardSummaryDto` shape (assert top-level keys `header`, `strategicFoundation`, `scope`, `detailedDefinitionAndDelivery` exist)
    - Test 2: GET `/api/dashboard/summary` without `projectId` returns 400 with `{ error: "projectId is required" }`
    - Test 3: GET `/api/dashboard/summary?projectId=test-proj&scope=ENTIRE_PRODUCT` returns `scope.type` of `'ENTIRE_PRODUCT'` and larger mock metric values
    - Test 4: GET `/api/dashboard/summary?projectId=test-proj&scope=NEXT_5_EPICS` returns `scope.type` of `'NEXT_5_EPICS'` and smaller mock metric values
    - Test 5: GET `/api/dashboard/summary?projectId=test-proj&scope=INVALID_VALUE` silently defaults to `'NEXT_5_EPICS'` (no 400 error)
    - Test 6: Both `summaryInsight` objects in the response have `enabled: false` and `message: null`
    - Place tests in `gateway/src/__tests__/dashboardSummary.test.ts`
    - Use supertest + express app pattern from existing route tests (e.g., `gateway/src/routes/__tests__/jiraImport.test.ts`)
  - [x] 1.2 Create `gateway/src/types/dashboard.ts` with all DTO interfaces
    - Define `ScopeType` as string literal union: `'ENTIRE_PRODUCT' | 'NEXT_5_EPICS' | 'QTR' | 'CUSTOM'`
    - Define `DashboardHeader`: `{ projectName: string; generatedAt: string }`
    - Define `DashboardScope`: `{ type: ScopeType; label: string; scopeValue: string | null }`
    - Define `SummaryInsight`: `{ enabled: boolean; message: string | null }`
    - Define `MetricCard`: `{ label: string; value: number; status: 'healthy' | 'at_risk' | 'needs_attention' | 'not_started' }`
    - Define `HighLevelArchitectureMetrics`: `{ overall: MetricCard; applications: MetricCard; services: MetricCard; interfaces: MetricCard; dataStores: MetricCard }`
    - Define `StrategicFoundationSection`: `{ productDefinition: MetricCard; highLevelArchitecture: HighLevelArchitectureMetrics; roadmap: MetricCard; summaryInsight: SummaryInsight }`
    - Define `DetailedArchitectureMetrics`: `{ overall: MetricCard; processActivities: MetricCard; interfaceEndpoints: MetricCard; logicalDataEntities: MetricCard; physicalDataEntities: MetricCard }`
    - Define `DetailedDefinitionAndDeliverySection`: `{ requirements: MetricCard; detailedArchitecture: DetailedArchitectureMetrics; implementation: MetricCard; summaryInsight: SummaryInsight }`
    - Define `DashboardSummaryDto`: `{ header: DashboardHeader; strategicFoundation: StrategicFoundationSection; scope: DashboardScope; detailedDefinitionAndDelivery: DetailedDefinitionAndDeliverySection }`
    - All property names camelCase; all interfaces exported as named exports
    - Follow `gateway/src/types/chat.ts` organization style (JSDoc comments, section separators)
  - [x] 1.3 Re-export all types from `gateway/src/types/index.ts`
    - Add a new block: `// Dashboard types (Spec 2026-02-18: Dashboard Increment 2)`
    - Export: `DashboardSummaryDto`, `DashboardHeader`, `ScopeType`, `DashboardScope`, `SummaryInsight`, `MetricCard`, `StrategicFoundationSection`, `HighLevelArchitectureMetrics`, `DetailedDefinitionAndDeliverySection`, `DetailedArchitectureMetrics`
    - Follow the existing grouped-comment-then-export pattern in `gateway/src/types/index.ts`
  - [x] 1.4 Create `gateway/src/services/dashboardSummaryMockService.ts`
    - Export function: `buildMockDashboardSummary(projectId: string, scopeType: ScopeType, scopeValue: string | null): DashboardSummaryDto`
    - `header.projectName` = `projectId` argument; `header.generatedAt` = `new Date().toISOString()`
    - Both `summaryInsight` objects MUST have `enabled: false` and `message: null`
    - When `scopeType` is `'ENTIRE_PRODUCT'`: return larger mock totals (values in range 10-50)
    - When `scopeType` is `'NEXT_5_EPICS'`: return smaller mock totals (values in range 2-15)
    - When `scopeType` is `'QTR'`: same values as `NEXT_5_EPICS` but `scope.label` is `"Q1 2026"`
    - When `scopeType` is `'CUSTOM'`: same values as `NEXT_5_EPICS` but `scope.label` is `"Custom Scope"`
    - Status strings on MetricCards: hardcoded plausible mix of `'healthy'`, `'at_risk'`, `'needs_attention'`, `'not_started'`
    - No database reads, no LLM calls -- pure hardcoded mock data
  - [x] 1.5 Re-export `buildMockDashboardSummary` from `gateway/src/services/index.ts`
    - Add: `// Dashboard Summary Mock Service (Spec 2026-02-18: Dashboard Increment 2)`
    - Add: `export { buildMockDashboardSummary } from './dashboardSummaryMockService';`
    - Follow the existing comment-and-export pattern in `gateway/src/services/index.ts`
  - [x] 1.6 Create `gateway/src/routes/dashboardSummary.ts`
    - Export `dashboardSummaryRouter` as a named `Router()` instance
    - Define a single `GET /summary` handler with `async (req: Request, res: Response)` signature
    - Extract `requestId` from `(req as any).requestId || 'unknown'` (following `implementState.ts` pattern)
    - Validate `projectId` query parameter: if missing or empty after trim, return `res.status(400).json({ error: 'projectId is required' })`
    - Read optional `scope` query parameter, default to `'NEXT_5_EPICS'` if absent or unrecognized (no 400 error for invalid scope)
    - Read optional `scopeValue` query parameter, pass through to mock service (may be `undefined`/`null`)
    - Call `buildMockDashboardSummary(projectId, scopeType, scopeValue ?? null)` and return `res.json(dto)`
    - Import `logger` from `'../services/logger'`
    - Import `buildMockDashboardSummary` from `'../services/dashboardSummaryMockService'`
    - Add debug-level log on request receipt; info-level log on successful response
  - [x] 1.7 Re-export `dashboardSummaryRouter` from `gateway/src/routes/index.ts`
    - Add: `// Dashboard Summary route (Spec 2026-02-18: Dashboard Increment 2)`
    - Add: `export { dashboardSummaryRouter } from './dashboardSummary';`
    - Follow the existing comment-and-export pattern in `gateway/src/routes/index.ts`
  - [x] 1.8 Register route in `gateway/src/server.ts`
    - Add `dashboardSummaryRouter` to the destructured import from `'./routes'` on line 10
    - Add `app.use('/api/dashboard', dashboardSummaryRouter);` in the route mounting section with comment: `// Dashboard Summary route (Spec 2026-02-18: Dashboard Increment 2)`
    - Add startup `console.log` line: `` console.log(`[Gateway] Dashboard Summary endpoint: http://localhost:${config.port}/api/dashboard/summary`); ``
  - [x] 1.9 Ensure gateway tests pass
    - Run ONLY the 4-6 tests written in 1.1 (`gateway/src/__tests__/dashboardSummary.test.ts`)
    - Verify all assertions pass: 200 responses with correct shape, 400 for missing projectId, scope defaulting, summaryInsight constraints
    - Do NOT run the entire gateway test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- `DashboardSummaryDto` and all nested types are defined and exported from `gateway/src/types/dashboard.ts`
- Types are re-exported from `gateway/src/types/index.ts`
- `buildMockDashboardSummary` returns valid mock data with scope-variant values
- Mock service is re-exported from `gateway/src/services/index.ts`
- `GET /api/dashboard/summary` returns 200 with correct DTO shape when `projectId` is provided
- `GET /api/dashboard/summary` returns 400 when `projectId` is missing
- Invalid `scope` values silently default to `'NEXT_5_EPICS'`
- Both `summaryInsight.enabled` are `false` and `summaryInsight.message` are `null`
- Route is registered in `server.ts` with startup logging

### Frontend Layer

#### Task Group 2: Frontend Types and API Client
**Dependencies:** None (shares contract with gateway but no import dependency)

- [x] 2.0 Complete frontend types and API client
  - [x] 2.1 Write 3-4 focused tests for the frontend API client
    - Test 1: `getDashboardSummary('test-proj')` calls fetch with correct URL including `projectId` query param and no `scope` param when scope is omitted
    - Test 2: `getDashboardSummary('test-proj', 'ENTIRE_PRODUCT')` appends `&scope=ENTIRE_PRODUCT` to the URL
    - Test 3: `getDashboardSummary` returns parsed JSON typed as `DashboardSummaryDto` on success (200 response)
    - Test 4: `getDashboardSummary` throws an Error containing the status code on non-ok response
    - Place tests in `frontend/src/__tests__/dashboardApi.test.ts`
    - Use vitest + fetch mock pattern from existing tests (e.g., `frontend/src/api/__tests__/productDefinitionApi.test.ts`)
  - [x] 2.2 Create `frontend/src/types/dashboard.ts` with all DTO interfaces
    - Mirror the exact same interface definitions from gateway types (camelCase wire format, no mapping needed)
    - Export all types as named exports: `DashboardSummaryDto`, `DashboardHeader`, `ScopeType`, `DashboardScope`, `SummaryInsight`, `MetricCard`, `StrategicFoundationSection`, `HighLevelArchitectureMetrics`, `DetailedDefinitionAndDeliverySection`, `DetailedArchitectureMetrics`
    - Place in `frontend/src/types/` (not inline in the API file) so Increment 3 UI components can import them directly
  - [x] 2.3 Create `frontend/src/api/dashboardApi.ts` with `getDashboardSummary` function
    - Add `const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';` (matching `chatApi.ts` convention -- NOT `VITE_API_BASE_URL`)
    - Function signature: `getDashboardSummary(projectId: string, scope?: ScopeType): Promise<DashboardSummaryDto>`
    - Build URL: `` `${GATEWAY_BASE}/api/dashboard/summary?projectId=${encodeURIComponent(projectId)}` ``
    - Append `&scope=${encodeURIComponent(scope)}` only when `scope` is provided
    - Use `fetch` with `method: 'GET'`
    - On non-ok response: `throw new Error(...)` with the status code
    - On success: `return res.json()` typed as `DashboardSummaryDto`
    - Import `DashboardSummaryDto` and `ScopeType` from `'../types/dashboard'`
    - No snake_case-to-camelCase mapping (gateway sends camelCase natively)
    - Follow `chatApi.ts` pattern for fetch + error handling
  - [x] 2.4 Ensure frontend tests pass
    - Run ONLY the 3-4 tests written in 2.1 (`frontend/src/__tests__/dashboardApi.test.ts`)
    - Verify fetch URL construction, scope parameter appending, success parsing, and error throwing
    - Do NOT run the entire frontend test suite at this stage

**Acceptance Criteria:**
- The 3-4 tests written in 2.1 pass
- `DashboardSummaryDto` and all nested types are defined and exported from `frontend/src/types/dashboard.ts`
- Frontend types exactly mirror gateway types (same property names, same casing)
- `getDashboardSummary` constructs the correct URL with `projectId` and optional `scope`
- `getDashboardSummary` uses `VITE_GATEWAY_BASE_URL` (not `VITE_API_BASE_URL`)
- Successful responses return parsed JSON typed as `DashboardSummaryDto`
- Non-ok responses throw an Error with the status code

### Test Review

#### Task Group 3: Test Review and Gap Analysis
**Dependencies:** Task Groups 1 and 2

- [x] 3.0 Review existing tests and fill critical gaps only
  - [x] 3.1 Review tests from Task Groups 1-2
    - Review the 4-6 gateway route tests from Task 1.1
    - Review the 3-4 frontend API client tests from Task 2.1
    - Total existing tests: approximately 7-10 tests
  - [x] 3.2 Analyze test coverage gaps for this feature only
    - Check whether `buildMockDashboardSummary` scope variants (QTR, CUSTOM) are tested at the route level
    - Check whether `projectId` with empty string (after trim) triggers 400
    - Check whether `scopeValue` query param is correctly passed through
    - Check whether `header.generatedAt` is a valid ISO-8601 string
    - Focus ONLY on gaps related to this spec -- do NOT assess entire application coverage
  - [x] 3.3 Write up to 5 additional tests maximum to fill identified gaps
    - Add tests only for critical gaps identified in 3.2
    - Place additional gateway tests in `gateway/src/__tests__/dashboardSummary.test.ts` (extend existing file)
    - Place additional frontend tests in `frontend/src/__tests__/dashboardApi.test.ts` (extend existing file)
    - Do NOT write exhaustive edge case tests
  - [x] 3.4 Run all feature-specific tests
    - Run all tests from `gateway/src/__tests__/dashboardSummary.test.ts`
    - Run all tests from `frontend/src/__tests__/dashboardApi.test.ts`
    - Expected total: approximately 10-15 tests maximum
    - Do NOT run the entire application test suite

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 10-15 tests total)
- Critical workflows for this feature are covered: valid requests, missing projectId, scope defaulting, scope variants, frontend URL construction, frontend error handling
- No more than 5 additional tests added when filling gaps
- Testing focused exclusively on this spec's feature requirements

## Execution Order

Recommended implementation sequence:

1. **Task Group 1** (Gateway Layer) and **Task Group 2** (Frontend Layer) can be implemented **in parallel** since they share a contract but have no import dependency on each other. Within Task Group 1, the internal order must be: types (1.2-1.3) -> mock service (1.4-1.5) -> route (1.6-1.7) -> registration (1.8).
2. **Task Group 3** (Test Review and Gap Analysis) runs after both Task Groups 1 and 2 are complete.

## Files Created or Modified

**New files:**
- `gateway/src/types/dashboard.ts` -- all DTO interfaces
- `gateway/src/services/dashboardSummaryMockService.ts` -- mock data factory
- `gateway/src/routes/dashboardSummary.ts` -- route handler
- `frontend/src/types/dashboard.ts` -- frontend type mirrors
- `frontend/src/api/dashboardApi.ts` -- API client function
- `gateway/src/__tests__/dashboardSummary.test.ts` -- gateway tests
- `frontend/src/__tests__/dashboardApi.test.ts` -- frontend tests

**Modified files:**
- `gateway/src/types/index.ts` -- add dashboard type re-exports
- `gateway/src/services/index.ts` -- add mock service re-export
- `gateway/src/routes/index.ts` -- add route re-export
- `gateway/src/server.ts` -- add route registration and startup log
