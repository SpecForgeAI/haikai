# Specification: Dashboard Increment 2 -- Define Dashboard Summary Contract + Backend Mock Endpoint (Mock Data Only)

## Goal

Define the full DashboardSummaryDto contract, expose a gateway GET endpoint that returns scope-variant mock data, and provide a frontend API client function ready for Increment 3 UI consumption -- with zero database reads and zero LLM calls.

## User Stories

- As a frontend developer building Dashboard Increment 3, I want a typed `getDashboardSummary(projectId, scope?)` function that returns a fully-shaped `DashboardSummaryDto` so that I can wire up the Dashboard cards without waiting for real backend aggregation.
- As a backend developer, I want the mock data factory isolated in its own service file so that I can swap it for real aggregation logic later without modifying the route handler.

## Specific Requirements

**DashboardSummaryDto shape (gateway/src/types/dashboard.ts)**
- Create `gateway/src/types/dashboard.ts` containing all interfaces below, exported as named exports
- `DashboardSummaryDto` is the top-level response type with four required fields: `header`, `strategicFoundation`, `scope`, `detailedDefinitionAndDelivery`
- `DashboardHeader`: `{ projectName: string; generatedAt: string }` where `generatedAt` is ISO-8601
- `ScopeType`: string literal union `'ENTIRE_PRODUCT' | 'NEXT_5_EPICS' | 'QTR' | 'CUSTOM'`
- `DashboardScope`: `{ type: ScopeType; label: string; scopeValue: string | null }`
- `SummaryInsight`: `{ enabled: boolean; message: string | null }` -- in this increment `enabled` MUST be `false` and `message` MUST be `null`
- `MetricCard`: `{ label: string; value: number; status: 'healthy' | 'at_risk' | 'needs_attention' | 'not_started' }` -- status values are hardcoded mock strings, no derivation logic
- `StrategicFoundationSection`: `{ productDefinition: MetricCard; highLevelArchitecture: HighLevelArchitectureMetrics; roadmap: MetricCard; summaryInsight: SummaryInsight }`
- `HighLevelArchitectureMetrics`: `{ overall: MetricCard; applications: MetricCard; services: MetricCard; interfaces: MetricCard; dataStores: MetricCard }`
- `DetailedDefinitionAndDeliverySection`: `{ requirements: MetricCard; detailedArchitecture: DetailedArchitectureMetrics; implementation: MetricCard; summaryInsight: SummaryInsight }`
- `DetailedArchitectureMetrics`: `{ overall: MetricCard; processActivities: MetricCard; interfaceEndpoints: MetricCard; logicalDataEntities: MetricCard; physicalDataEntities: MetricCard }`
- All property names are camelCase; this is the wire format end-to-end with no casing transforms needed on the frontend

**Re-export from gateway/src/types/index.ts**
- Add a new export block in `gateway/src/types/index.ts` that re-exports all named types from `'./dashboard'`, following the existing grouped-comment pattern (e.g., `// Dashboard types (Spec 2026-02-18: Dashboard Increment 2)`)
- Specifically export: `DashboardSummaryDto`, `DashboardHeader`, `ScopeType`, `DashboardScope`, `SummaryInsight`, `MetricCard`, `StrategicFoundationSection`, `HighLevelArchitectureMetrics`, `DetailedDefinitionAndDeliverySection`, `DetailedArchitectureMetrics`

**Gateway mock service (gateway/src/services/dashboardSummaryMockService.ts)**
- Export a function `buildMockDashboardSummary(projectId: string, scopeType: ScopeType, scopeValue: string | null): DashboardSummaryDto`
- The function returns a fully-populated `DashboardSummaryDto` with hardcoded mock data; no database reads, no LLM calls
- `header.projectName` is set to the `projectId` argument; `header.generatedAt` is `new Date().toISOString()`
- Both `summaryInsight` objects (strategic and detailed) MUST have `enabled: false` and `message: null`
- When `scopeType` is `'ENTIRE_PRODUCT'`, return larger mock totals (e.g., values in the range 10-50) to represent product-wide metrics
- When `scopeType` is `'NEXT_5_EPICS'`, return smaller mock totals (e.g., values in the range 2-15) to represent a narrower scope
- When `scopeType` is `'QTR'` or `'CUSTOM'`, return the same values as the `NEXT_5_EPICS` variant but set `scope.label` to a descriptive string reflecting the scope type (e.g., `"Q1 2026"` for QTR, `"Custom Scope"` for CUSTOM)
- Status strings on MetricCards should be a plausible mix of `'healthy'`, `'at_risk'`, `'needs_attention'`, and `'not_started'` -- hardcoded, not computed

**Re-export from gateway/src/services/index.ts**
- Add `export { buildMockDashboardSummary } from './dashboardSummaryMockService';` to `gateway/src/services/index.ts`, following the existing comment-and-export pattern

**Gateway route file (gateway/src/routes/dashboardSummary.ts)**
- Create a new file `gateway/src/routes/dashboardSummary.ts` exporting `dashboardSummaryRouter` as a named `Router()` instance
- Define a single `GET /summary` handler on the router
- Extract `requestId` from `(req as any).requestId || 'unknown'` following the `implementState.ts` pattern
- Validate `projectId` query parameter: if missing or empty string after trim, return `res.status(400).json({ error: 'projectId is required' })` -- inline validation, not global error middleware
- Read optional `scope` query parameter, default to `'NEXT_5_EPICS'` if absent; accepted values are `'ENTIRE_PRODUCT'`, `'NEXT_5_EPICS'`, `'QTR'`, `'CUSTOM'` -- if an unrecognized value is provided, default to `'NEXT_5_EPICS'` (no 400 error)
- Read optional `scopeValue` query parameter, pass it through to the mock service (may be `undefined`/`null`)
- Call `buildMockDashboardSummary(projectId, scopeType, scopeValue)` and return the result as `res.json(dto)`
- Add debug-level logger calls for request receipt and info-level for successful response, following the `implementState.ts` logging pattern
- Import `logger` from `'../services/logger'` and `buildMockDashboardSummary` from `'../services/dashboardSummaryMockService'`

**Re-export route from gateway/src/routes/index.ts**
- Add `export { dashboardSummaryRouter } from './dashboardSummary';` to `gateway/src/routes/index.ts`, following the existing pattern with a spec-reference comment

**Register route in gateway/src/server.ts**
- Import `dashboardSummaryRouter` from `'./routes'` (add to the existing destructured import on line 10)
- Add `app.use('/api/dashboard', dashboardSummaryRouter);` in the route mounting section, with a comment `// Dashboard Summary route (Spec 2026-02-18: Dashboard Increment 2)`
- Add a corresponding `console.log` line in the startup block: `` console.log(`[Gateway] Dashboard Summary endpoint: http://localhost:${config.port}/api/dashboard/summary`); ``

**Frontend types file (frontend/src/types/dashboard.ts)**
- Create `frontend/src/types/dashboard.ts` containing the exact same interface definitions as the gateway types (mirror copy since wire format is camelCase with no mapping needed)
- Export all types as named exports: `DashboardSummaryDto`, `DashboardHeader`, `ScopeType`, `DashboardScope`, `SummaryInsight`, `MetricCard`, `StrategicFoundationSection`, `HighLevelArchitectureMetrics`, `DetailedDefinitionAndDeliverySection`, `DetailedArchitectureMetrics`
- These types live in `frontend/src/types/` (not inline in the API file) so Increment 3 UI components can import them directly

**Frontend API client (frontend/src/api/dashboardApi.ts)**
- Create `frontend/src/api/dashboardApi.ts` with a single exported async function `getDashboardSummary`
- Use the `GATEWAY_BASE` pattern: `const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';` matching the convention in `chatApi.ts` (note: this file uses `VITE_GATEWAY_BASE_URL`, not `VITE_API_BASE_URL` which is used by proxy-to-Java API files like `bookOfWorkApi.ts`)
- Function signature: `getDashboardSummary(projectId: string, scope?: ScopeType): Promise<DashboardSummaryDto>`
- Build the URL as `` `${GATEWAY_BASE}/api/dashboard/summary?projectId=${encodeURIComponent(projectId)}` `` and append `&scope=${encodeURIComponent(scope)}` only when scope is provided
- Use `fetch` with `method: 'GET'`; on non-ok response, throw `new Error(...)` with the status code
- On success, return `res.json()` typed as `DashboardSummaryDto`
- Import `DashboardSummaryDto` and `ScopeType` from `'../types/dashboard'`
- No snake_case-to-camelCase mapping is needed since the gateway sends camelCase natively

**Validation rules**
- Only `projectId` is validated with a 400 response; `scope` silently defaults and `scopeValue` is passed through
- The 400 response body is `{ error: "projectId is required" }` -- a simple JSON object, not using global error middleware

## Existing Code to Leverage

**`gateway/src/routes/implementState.ts` -- Self-contained route with inline validation**
- Demonstrates the exact pattern to follow: `Router()` export, `requestId` extraction from `(req as any).requestId`, inline `validateGetParams` returning a string or null, `res.status(400).json({ error })` for validation failures, `logger` debug/info/warn calls, and `async (req: Request, res: Response)` handler signature
- The dashboard route is simpler (GET only, no PUT, no file I/O) but follows the same structural skeleton

**`gateway/src/types/chat.ts` and `gateway/src/types/index.ts` -- Type definition and re-export pattern**
- `chat.ts` shows how to organize multiple related interfaces in a single file with JSDoc comments and section separators (`// ===`)
- `index.ts` shows the grouped re-export pattern: a comment with the spec reference, then an `export { Type1, Type2, ... } from './module';` block

**`gateway/src/services/index.ts` -- Service re-export pattern**
- Each service is re-exported with a comment referencing the spec, followed by `export { functionName } from './serviceName';`

**`gateway/src/server.ts` -- Route registration and startup logging**
- Line 10 shows the destructured import from `'./routes'`; the new router is added to this import
- Lines 32-51 show the `app.use('/api/...', routerName);` pattern with spec-reference comments
- Lines 74-80 show the `console.log` startup announcements for each endpoint

**`frontend/src/api/chatApi.ts` -- Frontend API client pattern (gateway-native endpoints)**
- Uses `VITE_GATEWAY_BASE_URL` (not `VITE_API_BASE_URL`) for gateway-hosted endpoints
- Shows the `fetch` + `res.ok` check + `res.json()` return pattern with no casing transforms when the gateway sends camelCase natively
- The dashboard API client follows this pattern but is simpler (GET with query params, no POST body)

## Out of Scope

- Any database queries or reads from the architecture-model-service
- Any MCP tools or MCP server changes
- Any LLM insight generation, prompts, or AI-generated summaries
- Any status derivation logic beyond returning hardcoded categorical strings in mock data
- Any Dashboard UI layout, cards, scope selector, or visual component changes (Increment 3)
- Any changes to the DashboardView scaffold created in Increment 1
- Real data aggregation, computation, or metric calculation
- Authentication or authorization on the dashboard endpoint
- Unit tests for the gateway route or frontend API client (can be added in a follow-up)
- Any changes to the existing CORS middleware (GET is already allowed)
