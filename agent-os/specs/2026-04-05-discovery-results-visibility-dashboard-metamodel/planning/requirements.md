# Spec Requirements: Discovery Results Visibility (Dashboard + Meta-Model)

## Initial Description

Increment 12 of 16 for the legacy/current-state discovery capability. Previous increments established the full Phase 1 pipeline (1a-1d), candidate generation, and controlled save-back into the canonical architecture model. This increment introduces read-only visibility of discovery outputs so users can understand what was discovered, inspect candidates and saved entities, and build trust in the system before refinement workflows are added.

The goal is to expose discovery results in a read-only manner across the Dashboard (high-level summary) and Meta-Model view (entity-level visibility). At the end of this increment, users can see discovery runs, their status, and outputs; inspect candidates and saved entities; with no editing or approval actions available yet.

In scope: discovery run visibility on Dashboard, candidate visibility (read-only), saved entity traceability, basic discovery run detail view, and backend read endpoints. Out of scope: editing/approving candidates, manual correction, re-running discovery from UI, deep evidence graph visualization, DecisionTask inspection UI, log-based enrichment, AST enrichment, and language/version-specific analyzer packs.

## Requirements Discussion

### First Round Questions

**Q1:** I assume the discovery run summary should appear as a new collapsible section within the existing Dashboard view (similar to how other project-level summary sections work today), rather than as a separate top-level page. Is that correct, or would you prefer a standalone Discovery page accessible from the navigation?
**Answer:** Put discovery summary into the existing Dashboard as part of the project-level view, not as a separate standalone page in this increment.

**Q2:** The spec mentions showing "existence of discovery runs" and the "latest run status." I'm assuming the Dashboard shows only the most recent run's summary by default, but users can navigate to a detail view that lists all historical runs for the project. Is that right, or should the Dashboard show a full history list?
**Answer:** Show the latest run summary by default, with a way to view historical runs/details rather than making the dashboard a full run-history page.

**Q3:** You mention candidates could be shown in a dedicated view or as an extension of existing Meta-Model/inspection views. I'm assuming the primary candidate listing would be accessible from the discovery run detail flow (i.e., you select a run, then see its candidates), and that the Meta-Model view would instead show a "discovered origin" badge/indicator on saved entities. Is that the intended split, or should candidates also appear inline in the Meta-Model view?
**Answer:** Primary candidate visibility should hang off the discovery run detail flow, while the Meta-Model view should show lightweight discovery-origin indicators on saved entities.

**Q4:** For entities that originated from discovery, I assume a small visual badge or icon in the Meta-Model grid/detail views (e.g., a "Discovered" tag with a link to the originating run) is sufficient, rather than a full inline panel showing discovery details. Should this indicator be present on both the grid rows and any entity detail/inspection panels?
**Answer:** Yes -- a small "Discovered" style badge/link is sufficient in this increment.

**Q5:** The spec lists "saved," "skipped," and "marked for review" as candidate dispositions. Since this increment is read-only with no approval workflows, I assume these statuses are set by the discovery pipeline itself (or earlier increments) and we are purely displaying them. Are there any other statuses we should account for, such as "rejected" or "pending"?
**Answer:** Display the statuses already produced by the pipeline/current model; do not expand into a bigger status model unless the code already naturally has one.

**Q6:** The existing architecture has a gateway (Express/TypeScript) that routes to the architecture-model-service (Spring Boot/Java). I assume the new read endpoints should follow this same pattern: gateway routes that proxy to new Spring Boot controller endpoints. Should the discovery data come from the same PostgreSQL database used by the architecture-model-service, or is there a separate discovery data store from previous increments?
**Answer:** Yes -- follow the normal gateway-to-backend read pattern rather than inventing a special access path.

**Q7:** The spec mentions "coverage indicators (basic counts only)." I assume coverage here means counts like "X of Y entity types had candidates discovered" or "N entities in the model originated from discovery," rather than any percentage-based quality metric. Is that correct, or do you have specific metrics in mind?
**Answer:** Keep coverage indicators simple and count-based in this increment.

**Q8:** Is there anything that should explicitly NOT happen in this increment that isn't already listed in the out-of-scope section? For example, should we avoid any filtering/sorting of candidates, or is basic table sorting acceptable for a read-only view?
**Answer:** Yes -- keep advanced filtering/searching, heavy sorting UX, and richer analytics out of scope; basic read-only presentation is enough.

### Existing Code to Reference

No similar existing features were explicitly identified by the user for reference. The spec-writer should investigate:
- Existing Dashboard sections/components in `frontend/src/components/` for layout patterns to follow
- Gateway route patterns in `gateway/src/routes/` for read-only proxy endpoints
- Backend controller patterns in `architecture-model-service/src/main/java/com/example/architecturemodel/controller/` for project-scoped read endpoints
- Any discovery-related models, DTOs, or database tables established by increments 1-11

### Follow-up Questions

No follow-up questions were needed. The user's answers were clear and specific.

## Visual Assets

### Files Provided:
No visual assets provided.

## Requirements Summary

### Functional Requirements

- **Dashboard discovery section**: Add a new section within the existing project-level Dashboard view showing the latest discovery run's summary (status, high-level counts) with a navigation path to view historical runs and details.
- **Discovery run detail view**: Provide a detail view for a selected discovery run showing phase progression (1a-1d), counts of atoms/clusters/candidates, and completion status. This view is the entry point for viewing candidates associated with that run.
- **Candidate listing**: Display candidates within the discovery run detail flow, showing candidate type, name, confidence, high-level supporting evidence references, and disposition status (saved, skipped, marked for review, or whatever statuses the existing pipeline model produces).
- **Discovery-origin traceability on saved entities**: In Meta-Model views, show a lightweight "Discovered" badge/link on entities that originated from discovery, linking back to the originating run.
- **Summary metrics**: Expose simple count-based metrics (number of candidates generated, number of entities saved, basic coverage counts) -- no percentage-based quality metrics or analytics.
- **Backend read endpoints**: Project-scoped read-only endpoints exposed through the gateway-to-backend pattern for discovery runs, candidates, candidate-to-entity mappings, and summary metrics.

### Reusability Opportunities

- Existing Dashboard section components should be examined for layout and styling patterns to follow
- Gateway proxy route patterns for read-only endpoints can be reused directly
- Backend project-scoped controller/service/repository patterns from existing controllers (e.g., ProjectController) should be followed
- Discovery data models and tables from increments 1-11 should be leveraged -- no new data storage patterns needed

### Scope Boundaries

**In Scope:**
- Dashboard section showing latest discovery run summary with navigation to detail view
- Discovery run detail view with phase progression and counts
- Candidate listing within run detail flow (read-only, basic presentation)
- "Discovered" badge/link on saved entities in Meta-Model views
- Simple count-based summary metrics
- Project-scoped read-only backend endpoints following existing gateway-to-backend patterns
- Basic read-only presentation of all data (no advanced UX)

**Out of Scope:**
- Editing or approving candidates
- Manual correction of entities
- Re-running discovery from UI
- Deep evidence graph visualization (atoms/relationships/clusters)
- DecisionTask inspection UI
- Log-based enrichment
- AST enrichment
- Language/version-specific analyzer packs
- Advanced filtering, searching, or heavy sorting UX on candidate lists
- Richer analytics or percentage-based quality metrics
- Standalone top-level discovery page (discovery lives within existing Dashboard and Meta-Model paradigms)
- Full run history on the Dashboard itself (historical runs accessible via detail navigation, not on the Dashboard surface)

### Technical Considerations

- **Gateway layer**: New Express/TypeScript routes in `gateway/src/routes/` proxying to backend, following existing patterns
- **Backend layer**: New Spring Boot controller(s) and service(s) in `architecture-model-service/` for project-scoped read operations against discovery data in PostgreSQL
- **Frontend layer**: React/TypeScript components in `frontend/src/components/` using existing state management patterns (React Context, hooks), Vitest for tests
- **Data source**: Discovery data should come from the same PostgreSQL database used by the architecture-model-service, leveraging tables/models established by increments 1-11
- **Read-only constraint**: All discovery outputs must be strictly non-editable in this increment -- no mutation endpoints, no edit affordances in the UI
- **Project-scoped**: All visibility and endpoints must be scoped to the currently selected project
- **Integration approach**: Integrate into existing Dashboard and Meta-Model views rather than introducing new top-level navigation concepts or mental models
