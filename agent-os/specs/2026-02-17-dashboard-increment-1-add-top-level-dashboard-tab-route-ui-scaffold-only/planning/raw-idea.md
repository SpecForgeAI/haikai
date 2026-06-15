# Raw Idea

Title: "Dashboard Increment 1 — Add Top-Level Dashboard Tab + Route (UI Scaffold Only)"

Description/Raw Idea:
Introduce a new top-level "Dashboard" entry point that appears before "Product & Delivery" in the main top navigation and routes to a new DashboardPage. This increment is UI-only: no backend calls, no mock data, no LLM, no new DTOs yet.

Scope includes:
- frontend: top nav update to add Dashboard tab/button before Product & Delivery
- frontend: new DashboardPage route + placeholder UI scaffold

Scope excludes:
- any backend endpoints (gateway/mcp/model-service)
- any data fetching or mock data
- any persona panels, scope selector, cards layout
- any persistence or database changes

Frontend changes:
1) Add Dashboard route - new route path "/dashboard", reachable via navigation
2) Create DashboardPage scaffold - placeholder with title "Dashboard" and subtitle "Project delivery overview (coming soon)."
3) Add Dashboard tab/button to main top navigation before "Product & Delivery"
4) Minimal UX: route loads instantly, no console errors, works when switching between areas

Acceptance criteria:
- A new top-level "Dashboard" tab/button appears before "Product & Delivery"
- Navigating to "/dashboard" renders a Dashboard page with placeholder title/subtitle
- Active tab styling correctly indicates Dashboard when on "/dashboard"
- No backend changes, no network calls

The project root is: C:\Workspaces\SSD\architecture-store-and-diagrams
