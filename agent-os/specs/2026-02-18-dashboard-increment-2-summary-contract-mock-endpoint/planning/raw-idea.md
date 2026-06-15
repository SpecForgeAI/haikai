# Dashboard Increment 2 — Define Dashboard Summary Contract + Backend Mock Endpoint (Mock Data Only)

## Raw Idea

Add a backend API endpoint that the frontend Dashboard can call to retrieve a single summary payload. The payload is PURE mock data (hardcoded or via a mock helper), with no DB reads and no LLM insights.

The contract supports:
- Strategic Foundation cards (including High-Level Architecture metrics)
- Detailed Definition & Delivery cards (including Detailed Architecture metrics)
- Scope parameter (accepted but only used to return different mock variants)

## Scope

### Includes
- gateway: new GET endpoint /api/dashboard/summary
- gateway: new DTO/types for DashboardSummary response (server-side)
- gateway: mock data factory (simple constants or helper function)
- frontend: add chatApi-style client function to call the new endpoint (no UI changes yet)

### Excludes
- any DB queries in architecture-model-service
- any mcp tools
- any LLM insight generation or prompts
- any status derivation logic beyond returning mocked categorical strings
- any Dashboard UI layout/cards (handled in Increment 3)

## API Design

- GET /api/dashboard/summary
- Query params: projectId (required), scope (optional, default NEXT_5_EPICS), scopeValue (optional, ignored for now)
- Response: DashboardSummaryDto with header, strategicFoundation, scope, detailedDefinitionAndDelivery sections
- Mock data varies by scopeType (ENTIRE_PRODUCT = larger totals, NEXT_5_EPICS = smaller totals)
- summaryInsight.enabled MUST be false in this increment

## Acceptance Criteria

- GET /api/dashboard/summary?projectId=... returns 200 with DashboardSummaryDto JSON
- Strategic Foundation metrics include High-Level Architecture (Applications, Services, Interfaces, Data Stores)
- Detailed Architecture metrics include Process Activities, Interface Endpoints, Logical Data Entities, Physical Data Entities
- summaryInsight.enabled = false and message = null
- No DB reads and no LLM calls
- Frontend has a callable getDashboardSummary() helper ready for Increment 3
