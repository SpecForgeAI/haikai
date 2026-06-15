# Dashboard Increment 3 — Build Dashboard Layout + Cards (Wired to Mock Summary Endpoint)

## Raw Idea

Implement the Dashboard UI as the new top-level view that renders a 3-section layout (Header, Strategic Foundation, Detailed Definition & Delivery) with 10 cards using data fetched from the gateway mock endpoint GET /api/dashboard/summary. This is UI + data wiring only — all values are mock data from the backend. No LLM insight generation, no real DB derivation.

## Scope Includes

- frontend: DashboardView renders 3 sections with card grids
- frontend: fetch DashboardSummaryDto from backend and render all metrics
- frontend: loading + error states
- frontend: card primary actions navigate to existing app sections

## Scope Excludes

- scope selector UI (Increment 4)
- persona chat panel/drawer (Increment 5)
- any backend changes (endpoint already exists from Increment 2)
- any LLM insights (summaryInsight.enabled remains false)

## Cards

### Strategic Foundation (4 cards)
- Product Definition
- Roadmap
- Standards
- High-Level Architecture

### Pre-Coding (3 cards)
- Backlog
- Detailed Architecture
- Testing Suite

### Post-Coding (3 cards)
- Implementation
- Verification
- Summary Insight
