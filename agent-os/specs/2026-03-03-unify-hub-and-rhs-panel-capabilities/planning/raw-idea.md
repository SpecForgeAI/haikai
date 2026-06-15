# Raw Idea

## Title
Unify Hub and RHS Panel Capabilities + Default-Open Hub

## Description/Intent
Make the Dashboard Hub use the same RHS UnifiedChatPanel pattern (default open), and allow RHS panels on other screens to support the same artifact-generating capabilities as Hub, with restriction enforced only via allowedPersonaIds (no new artifact gating abstractions).

## Scope

### Frontend
- Ensure DashboardView renders UnifiedChatPanel as a right-anchored panel with defaultOpen = true.
- Remove any logic that treats Hub as a special artifact-capable variant.
- Ensure UnifiedChatPanel supports artifact preview/confirm/save in all contexts (Hub + screen panels).
- Ensure screen panels (Product, Roadmap, MetaModel) pass allowedPersonaIds to UnifiedChatPanel.
- Remove any conditional UI logic that disables artifact flows for panel threads.
- Ensure panel threadKey remains screen-scoped (e.g., { type: "panel", projectId, screen }).

### Backend
- Do NOT introduce /api/chat/v2/artifact/* or any new artifact endpoints.
- Reuse existing artifact generation + save mechanics (mission, roadmap, architecture, tech-stack, test-strategy).
- Enforce persona restrictions server-side: if a chat request attempts to use a persona/mode not allowed for the given screen context, reject with 400 and descriptive error.
- No new allowedArtifactIds concept; artifact capability derives from task/mode tied to persona.

## Constraints
- No new artifact gating abstractions.
- No refactor of existing save_product_artifacts or other MCP tool contracts.
- No changes to Implement screen.
- No changes to summarisation.
- No new endpoints.

## Acceptance Criteria
- Dashboard Hub appears as RHS panel and is open by default.
- RHS panels on Product, Roadmap, and MetaModel can execute artifact-generating flows when using permitted personas.
- Artifact preview + confirm + save behaves identically in Hub and RHS panels.
- Attempting to invoke a persona not allowed in a given panel is prevented in UI and rejected in backend.
- No regression in existing Hub flows.
