# Spec Requirements: Dashboard Increment 2 -- Define Dashboard Summary Contract + Backend Mock Endpoint

## Initial Description

Add a backend API endpoint that the frontend Dashboard can call to retrieve a single summary payload. The payload is PURE mock data (hardcoded or via a mock helper), with no DB reads and no LLM insights.

The contract supports:
- Strategic Foundation cards (including High-Level Architecture metrics)
- Detailed Definition & Delivery cards (including Detailed Architecture metrics)
- Scope parameter (accepted but only used to return different mock variants)

Scope includes:
- gateway: new GET endpoint /api/dashboard/summary
- gateway: new DTO/types for DashboardSummary response (server-side)
- gateway: mock data factory (simple constants or helper function)
- frontend: add chatApi-style client function to call the new endpoint (no UI changes yet)

Scope excludes:
- any DB queries in architecture-model-service
- any mcp tools
- any LLM insight generation or prompts
- any status derivation logic beyond returning mocked categorical strings
- any Dashboard UI layout/cards (handled in Increment 3)

## Requirements Discussion

### First Round Questions

**Q1:** Your existing gateway routes fall into two categories: (a) proxy routes that forward to an external service (e.g., `organisations.ts` uses axios to call another service), and (b) self-contained routes that handle logic directly. Since the dashboard endpoint returns pure mock data with no external service call, should this be a self-contained route file that builds and returns the mock DTO directly in the handler, or should the mock data factory be extracted into a separate service file under `gateway/src/services/`?
**Answer:** Extract into a small service/helper under `gateway/src/services/` (e.g., `dashboardSummaryMockService.ts`) so the route stays thin and we can swap mock-to-real later cleanly.

**Q2:** Your existing patterns are mixed regarding DTO casing. Routes proxying to the Java backend receive snake_case and map to camelCase on the frontend. But the gateway's own TypeScript types use camelCase natively (e.g., `ChatResponse`, `PlannerResponse`). Since this endpoint is a gateway-native mock (no Java service involved), should the DTO be camelCase on the wire, meaning the frontend client can consume the response directly with no snake_case-to-camelCase mapping?
**Answer:** Yes -- camelCase on the wire end-to-end (no casing transforms on frontend).

**Q3:** Your gateway types are organized into dedicated files under `gateway/src/types/` and re-exported through `gateway/src/types/index.ts`. Should the `DashboardSummaryDto` and its nested types go into a new file `gateway/src/types/dashboard.ts` and be re-exported from `gateway/src/types/index.ts`?
**Answer:** Yes -- create `gateway/src/types/dashboard.ts` and re-export it from `gateway/src/types/index.ts`.

**Q4:** The endpoint path `/api/dashboard/summary` will be mounted at the server.ts level using the established `app.use('/api/dashboard', dashboardSummaryRouter)` pattern with a sub-path `/summary` in the router. Is that correct, or is there a different mount structure preference (e.g., `/api/v1/dashboard` to match newer versioned routes)?
**Answer:** Mount as `/api/dashboard` with router sub-path `/summary` (i.e., `GET /api/dashboard/summary`) to match existing internal API patterns.

**Q5:** For the frontend `getDashboardSummary()` client function, since the wire format is camelCase, the frontend will need its own copy of the TypeScript interfaces. Should these types live inside the API module file itself (like `bookOfWorkApi.ts` defines its DTOs inline), or in a separate file under `frontend/src/types/` for reuse by the upcoming Increment 3 UI components?
**Answer:** Put frontend types in a reusable place (e.g., `frontend/src/types/dashboard.ts`) so Increment 3 components can import them cleanly.

**Q6:** The raw idea says `projectId` is required. Should the route return a 400 Bad Request with a simple JSON body if the query param is missing or empty, or should it use the `createValidationError` helper from the error handler middleware to throw into the global error handler?
**Answer:** Follow the existing route-level pattern -- return 400 with a simple JSON body (e.g., `{ error: "projectId is required" }`) rather than relying on global middleware for this simple validation.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: Gateway route patterns (proxy style) - Path: `gateway/src/routes/organisations.ts`
- Feature: Gateway route patterns (self-contained) - Path: `gateway/src/routes/implementState.ts` (if it exists) or inline route handlers
- Feature: Gateway types organization and re-export pattern - Path: `gateway/src/types/index.ts`, `gateway/src/types/chat.ts`
- Feature: Gateway route test pattern (supertest + express) - Path: `gateway/src/routes/__tests__/jiraImport.test.ts`
- Feature: Frontend API client with inline DTO definitions and snake_case mapping - Path: `frontend/src/api/bookOfWorkApi.ts`
- Feature: Frontend API client test pattern (vitest + fetch mock) - Path: `frontend/src/api/__tests__/productDefinitionApi.test.ts`
- Feature: Frontend API base URL configuration - Pattern: `const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';` used across all API files
- Feature: Gateway service extraction pattern - Path: `gateway/src/services/` (mock service should follow similar export patterns)
- Feature: Dashboard Increment 1 scaffold (existing UI) - Path: `frontend/src/components/DashboardView/DashboardView.tsx`
- Feature: Dashboard Increment 1 spec (context for this increment) - Path: `agent-os/specs/2026-02-17-dashboard-increment-1-add-top-level-dashboard-tab-route-ui-scaffold-only/spec.md`

### Follow-up Questions

No follow-up questions were needed. All answers were clear and unambiguous.

## Visual Assets

### Files Provided:
No visual assets provided (confirmed by both user statement and mandatory filesystem check).

### Visual Insights:
Not applicable -- this increment is backend API + frontend client helper only, with no UI changes.

## Requirements Summary

### Functional Requirements
- GET `/api/dashboard/summary` endpoint in the gateway returning a `DashboardSummaryDto` JSON payload
- Query parameter `projectId` is required; return 400 with `{ error: "projectId is required" }` if missing/empty
- Query parameter `scope` is optional, defaults to `NEXT_5_EPICS`; accepted values include `ENTIRE_PRODUCT` and `NEXT_5_EPICS`
- Query parameter `scopeValue` is optional, ignored in this increment
- Response includes sections: `header`, `strategicFoundation`, `scope`, `detailedDefinitionAndDelivery`
- Strategic Foundation metrics include High-Level Architecture items (Applications, Services, Interfaces, Data Stores)
- Detailed Architecture metrics include Process Activities, Interface Endpoints, Logical Data Entities, Physical Data Entities
- `summaryInsight.enabled` MUST be `false` and `message` MUST be `null` in this increment
- Mock data varies by scope type: `ENTIRE_PRODUCT` returns larger totals, `NEXT_5_EPICS` returns smaller totals
- No database reads and no LLM calls -- pure mock/hardcoded data only
- Frontend `getDashboardSummary(projectId, scope?)` helper function callable by Increment 3 UI

### Reusability Opportunities
- Gateway route pattern: follow `organisations.ts` structure (Router export, requestId extraction, logger usage) but with local mock service instead of axios proxy
- Gateway types pattern: follow `chat.ts` structure for type definitions, re-export through `index.ts`
- Gateway test pattern: follow `jiraImport.test.ts` structure (supertest, express app setup, mock service)
- Frontend API client pattern: follow `bookOfWorkApi.ts` structure for fetch-based client, but simplified (no snake_case mapping needed since wire format is camelCase)
- Frontend API test pattern: follow `productDefinitionApi.test.ts` structure (vitest, fetch mock)
- Mock service can be swapped for a real service later without changing the route handler

### Scope Boundaries

**In Scope:**
- New gateway route file: `gateway/src/routes/dashboardSummary.ts`
- New gateway types file: `gateway/src/types/dashboard.ts` with DashboardSummaryDto and all nested types
- Re-export from `gateway/src/types/index.ts`
- New gateway mock service: `gateway/src/services/dashboardSummaryMockService.ts`
- Route registration in `gateway/src/server.ts` under `/api/dashboard`
- New frontend types file: `frontend/src/types/dashboard.ts` (reusable for Increment 3)
- New frontend API client: `frontend/src/api/dashboardApi.ts` with `getDashboardSummary()` function
- Unit tests for gateway route (supertest pattern)
- Unit tests for frontend API client (vitest + fetch mock pattern)

**Out of Scope:**
- Any database queries in architecture-model-service
- Any MCP tools
- Any LLM insight generation or prompts
- Any status derivation logic beyond returning mocked categorical strings
- Any Dashboard UI layout, cards, or component changes (Increment 3)
- Any changes to the DashboardView scaffold created in Increment 1
- Real data aggregation or computation
- Authentication/authorization on the endpoint

### Technical Considerations
- DTO uses camelCase on the wire (gateway-native convention, not Java snake_case convention)
- Frontend types are a direct mirror of gateway types (no mapping layer needed)
- Frontend types placed in `frontend/src/types/dashboard.ts` for reuse across API client and future UI components
- Route mounted as `app.use('/api/dashboard', dashboardSummaryRouter)` in server.ts
- Router defines `GET /summary` sub-path (full path: `GET /api/dashboard/summary`)
- Route handler is thin: validates `projectId` query param, delegates to mock service, returns JSON
- Mock service extracted to `gateway/src/services/dashboardSummaryMockService.ts` for clean swap to real service later
- Error handling is inline in route (400 for missing projectId) rather than via global error middleware
- Existing CORS middleware already allows GET method -- no CORS changes needed
