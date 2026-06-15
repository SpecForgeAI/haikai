# Shaping Notes: Migration Delivery Progress and Evidence Tracking

Spec folder: `agent-os/specs/2026-05-19-migration-delivery-progress-and-evidence-tracking`
Date: 2026-05-19
Source: 12 clarifying questions raised in `planning/clarifying-questions.md`; user accepted all recommended defaults verbatim.

This document captures the resolved shaping decisions. It is NOT the requirements doc — the spec-writer will produce `requirements.md` in a later phase using these decisions as authoritative input.

---

## Decisions

### Decision 1 — Needs-attention thresholds

**Resolved:** Accept the recommended default.
- "Active" staleness window = 14 days (a story is considered to have implementation activity if its `WorkItem.updatedAt` is within 14 days of dashboard read time).
- `status=blocked` surfaces in needs-attention only when explicitly set to `blocked` (no inference from other states).
- `generated_with_warnings` surfaces in needs-attention only when the story has no implementation activity yet (i.e. there is no associated WorkItem progress past `not_started`); once implementation has begun, warnings are not by themselves grounds for needs-attention.

**Rationale:** Keeps the needs-attention panel signal-rich. A 14-day window aligns with typical sprint cadence; treating `generated_with_warnings` as transient (only meaningful pre-implementation) avoids re-surfacing already-actioned shape-spec quality issues forever.

---

### Decision 2 — Pagination

**Resolved:** Accept the recommended default.
- v1 dashboard returns a single payload sized for the ~500-story ceiling we expect per book of work.
- If a book exceeds that, render a soft warning banner ("This book contains N stories; rendering may be slow") but DO NOT page server-side.
- No real server-side pagination, cursoring, or virtualisation in v1.

**Rationale:** Defers the engineering cost of pagination until we see real books that break the assumption. The soft banner gives us telemetry on when we need to revisit. Matches the precedent of the Spec 1 review workspace which also renders everything client-side.

---

### Decision 3 — Bulk-regenerate concurrency safety

**Resolved:** Accept the recommended default.
- This dashboard performs NO cross-surface locking.
- The Spec 2 gateway endpoint (bulk regenerate target) is the single source of truth for in-flight detection / overlap handling.
- The dashboard does NOT poll Spec 2 for in-flight state before submitting.

**Rationale:** Keeps responsibilities clean: this spec is a read-mostly dashboard. Concurrency safety lives where the mutation lives. Re-implementing in-flight detection here would duplicate logic and risk drift.

---

### Decision 4 — Scope of "current filter" for bulk regenerate

**Resolved:** Accept the recommended default.
- Bulk-regenerate is scoped to the needs-attention panel's own filters only:
  - workstream selector
  - failed / insufficient toggle
- The hierarchy-tree expansion / selection state is NOT a filter on the bulk action.

**Rationale:** Bulk-regenerate is a property of the needs-attention list; binding it to a different surface's selection state would surprise users. Keeps the contract narrow and predictable.

---

### Decision 5 — Stale `workItemId` orphans

**Resolved:** Accept the recommended default.
- At dashboard read time, AMS validates each stored `workItemId` against the WorkItem store.
- An orphan (stored id with no matching WorkItem) is rendered as `not_saved_to_backlog` AND a warning entry is appended to `dashboard.warnings[]` naming the affected item.
- No automatic repair: AMS does not null the stored id, does not retry, does not rewrite.

**Rationale:** Validate-and-report keeps the dashboard honest without overstepping. Automatic repair could mask real data issues; a warning in the response lets the user act explicitly.

---

### Decision 6 — Hide vs grey-out for missing `workItemId`

**Resolved:** Accept the recommended default.
- V1 renders both "never saved to backlog" and "save was attempted but failed" as a single greyed-out `not_saved_to_backlog` treatment.
- No visual distinction between the two cases in v1.
- The (a)/(b) distinction (tracking whether a save was attempted) is explicitly DEFERRED. V1 does not add the persistence needed to differentiate.

**Rationale:** Adds zero schema changes to v1. The distinction is real but the value of surfacing it is low until we have user feedback. Deferring keeps the v1 footprint tight.

---

### Decision 7 — Refresh strategy after bulk regen

**Resolved:** Accept the recommended default.
- On bulk-regenerate completion, the dashboard does a full re-fetch via the GET endpoint.
- No patch-style row mutation, no optimistic UI, no per-row streaming updates in v1.

**Rationale:** Simplest correct behaviour. Re-fetch matches the existing dashboard refresh path, eliminates state-merge bugs, and is acceptable at the v1 ~500-story scale.

---

### Decision 8 — "Last refreshed" timestamp

**Resolved:** Accept the recommended default.
- A small "Last refreshed HH:mm:ss" label is rendered next to the manual Refresh button in the dashboard header.
- Timestamp updates on every successful GET (initial load, manual refresh, post-bulk-regen refresh).

**Rationale:** Cheap to implement, materially improves user trust in the data being shown, and matches conventions on the existing Discovery dashboard surfaces.

---

### Decision 9 — Visual treatment for many missing-inputs in the drawer

**Resolved:** Accept the recommended default.
- Missing-inputs render as a vertical list grouped by `kind` (e.g. "Mappings (4)", "Baselines (3)", "Contracts (5)").
- Each entry shows its `id` and `reason`.
- No truncation; the drawer body scrolls if needed.

**Rationale:** Grouping by kind makes scan-ability good even with high cardinality. No truncation avoids the user wondering whether they're seeing the full picture. Drawer scroll is the established pattern (see `StoryResultDrawer.tsx`).

---

### Decision 10 — Route placement

**Resolved:** Accept option (b).
- Route: `/projects/:projectId/architectures/:architectureId/migration-books-of-work/:bookId/delivery`
- Architecture-scoped, inherits the AppShell chrome.
- URL self-describes as a sub-view of the book-of-work detail page.

**Rationale:** Matches the conceptual model: this is a view of a specific book inside a specific architecture inside a specific project. Architecture-scoping plugs into AppShell's project/architecture context automatically; no bespoke chrome wiring needed.

---

### Decision 11 — Partial roll-up error handling

**Resolved:** Accept the recommended default.
- AMS returns 200 with available sections populated.
- A `warnings[]` entry names each failed subsection.
- The frontend renders all sections; failed sections show an inline "Could not load X — retry" placeholder.
- A single sub-query failure does NOT 5xx the entire dashboard.

**Rationale:** Resilience matters here — a single slow / failing sub-query (e.g. progress roll-up vs warnings roll-up) shouldn't blank the whole page. Surfacing the failure inline lets the user retry just that piece.

---

### Decision 12 — Additional exclusions

**Resolved:** Accept the recommended default.
- Nothing additional marked out-of-scope beyond what was already listed in the raw idea.
- Confirmed deferred (NOT in v1):
  - In-product spec editor
  - Missing-input resolver flow
  - Dependency model
  - Migration execution engine

**Rationale:** The raw idea's exclusion list is already comprehensive; no surprise scope-creep surfaced during shaping.

---

## Existing Surfaces to Reuse

User confirmed the precedents named in the raw idea AND added the following explicit reuse targets. The spec-writer should reference these by path when shaping component / API decisions; the dashboard should match their conventions where applicable.

### Spec 1 (Migration Delivery Plan) precedents
- `frontend/src/components/ProductManager/MigrationDeliveryPlan/MigrationDeliveryPlanProgressSummary.tsx` — pattern for summary cards + breakdown counts at the top of the dashboard.
- `frontend/src/components/ProductManager/MigrationDeliveryPlan/MigrationBookOfWorkReviewWorkspace.tsx` — pattern for the hierarchy review tree (book of work → workstream → feature → story expansion).

### Spec 2 (Migration Shape Spec Generation) precedents
- `frontend/src/components/ProductManager/MigrationShapeSpecGeneration/StoryResultDrawer.tsx` — drawer pattern for the per-story detail drawer (missing inputs list, evidence pointers, jump-to-backlog link).
- `frontend/src/components/ProductManager/MigrationShapeSpecGeneration/BatchResultsTable.tsx` — per-row badges + clickable rows pattern for the needs-attention table.
- `frontend/src/components/ProductManager/MigrationShapeSpecGeneration/SpecGenerationFilters.tsx` — filter-panel pattern (workstream selector + toggles) for the needs-attention filters.

### Generic dashboard precedents
- `frontend/src/components/DashboardView/DashboardView.tsx` — existing dashboard list + roll-up layout convention.
- Discovery surfaces (`DiscoveryListPage.tsx`, `DiscoveryRunDetailPage.tsx`) — patterns for warnings-display + retry placeholders + roll-up rendering. Useful precedent for Decision 11's inline failure placeholders.

**Note for spec-writer:** Do not re-explore these files yourself unless necessary; the user has confirmed they are the right reference points. Cite their paths in the spec where you make component/API shape decisions that match their conventions.

---

## Visual Assets

**No mockups provided.** The `planning/visuals/` folder is empty and will remain empty for this spec.

The spec-writer should work from:
1. The 12 resolved decisions above.
2. The named existing surfaces (see "Existing Surfaces to Reuse").
3. The raw idea (`planning/raw-idea.md`).

If the spec-writer feels a visual is essential at requirements time, raise that as a blocking question rather than inventing one.
