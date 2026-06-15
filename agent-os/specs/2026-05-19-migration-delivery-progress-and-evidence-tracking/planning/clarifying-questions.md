# Clarifying Questions: Migration Delivery Progress and Evidence Tracking

The raw idea is already very specific about feature shape, V1 scope, the three surgical additions (A/B/C), the AMS DTO field set, aggregation rules, frontend sections, the 38 test cases, and the 19 acceptance criteria. The questions below cover only the genuinely open design points.

1. **Needs-attention threshold heuristics.** The aggregation rules prioritise `failed > insufficient_context > blocked > not_saved_to_backlog > generated_with_warnings`, but they do not define what counts as "blocked" vs an "active" vs "planned" implementation status. I am assuming:
   - "blocked" = the WorkItem's status field is literally `blocked` (or equivalent), OR the implementation workspace exists but its last activity is older than 14 days AND status is not `done`.
   - "active implementation" = WorkItemImplementWorkspace exists AND has had any write in the last 14 days.
   - "planned" = WorkItem exists with a non-terminal status but no implementation workspace yet.
   - "generated_with_warnings" only shows in needs-attention if the spec has warnings AND no implementation activity yet (so warnings on an already-shipped story don't nag).
   Are these the right cut-offs, or do you want a different staleness window (7 days? 30 days?), or do you want activity-based "blocked" detection out and only treat explicit status=blocked as blocked?

2. **Pagination / load shedding for large books.** I'm assuming V1 returns the full dashboard payload in one request and the frontend renders the full hierarchy tree client-side, sized for books up to ~500 stories. Beyond that, I'd add a soft warning banner ("Large book — some sections may be slower") but no real pagination. Is that acceptable, or do you want server-side pagination of the hierarchy / needs-attention list from day one (e.g. needs-attention capped at top 100 with a "show more" affordance)?

3. **Bulk-regenerate concurrency safety.** When the user clicks "Regenerate all failed specs" while a previous batch from the Spec 2 workspace is already in flight for some of those WorkItems, my assumption is:
   - The button stays enabled (we do not poll Spec 2 for in-flight state from this dashboard).
   - The Spec 2 gateway endpoint is responsible for de-duplicating or rejecting overlapping targets — we surface whatever it returns in the in-flight banner.
   - We do NOT add cross-surface locking.
   Is that the right line, or do you want this dashboard to detect "already in flight" and disable the bulk buttons for any WorkItems currently being regenerated?

4. **Scope of "current filter" honoured by bulk regenerate.** The raw idea says the bulk-regen buttons "honour the current filters" of the needs-attention panel. I'm reading this as: only the workstream filter and the failed-vs-insufficient-context selector on the needs-attention panel itself. The hierarchy tree's selection / expansion state is NOT a filter on the bulk action. Confirm? Or should selecting a specific epic/feature in the tree also narrow the bulk-regen targets?

5. **Stale `workItemId` on `book_of_work_json` from a previous failed save-to-backlog.** Addition B persists the WorkItem id during save. There may be existing rows in production where a partial / failed save left an orphan `workItemId` that no longer points to a real WorkItem. My assumption:
   - At dashboard read time, the aggregation service validates each stored `workItemId` against the WorkItem store; orphan ids are treated as "not saved to backlog" AND a warning is added to the dashboard `warnings[]` array naming the affected item.
   - No automatic repair — operators see the warning and re-run save-to-backlog.
   Is that correct, or should the aggregation service silently treat orphan ids as missing without surfacing a warning, or should it actively rewrite/clear the stale id?

6. **Hide vs grey-out stories with no `workItemId`.** Two distinct cases:
   - (a) Story has never been saved to backlog (no workItemId, no prior attempt).
   - (b) Story attempted save-to-backlog but it failed (no workItemId, but we know it was attempted).
   I'm assuming both render as a single "not_saved_to_backlog" needs-attention row and are shown greyed-out (not hidden) in the hierarchy tree, with no distinction in V1 between (a) and (b). Confirm — or do you want (b) to render differently (e.g. red "save failed" badge) so the user knows to retry rather than to initiate save for the first time? Note: V1 likely cannot distinguish (a) from (b) without additional persistence; if you want the distinction, that becomes a second data-model write beyond Addition B.

7. **Refresh strategy after a bulk regenerate completes for a subset of targets.** When the Spec 2 batch endpoint returns having regenerated N of M stories, my default is to re-fetch the entire dashboard payload via the GET endpoint on completion (simpler, matches the "refresh" affordance in the header). Acceptable, or do you want a patch-style update (frontend mutates only the rows that were in the batch) to avoid a full re-render on books with hundreds of nodes?

8. **"Last refreshed" timestamp in the header.** Adding a small "Last refreshed HH:mm:ss" label next to the manual Refresh button is cheap and useful for an operational dashboard. I'm assuming we add it. Confirm, or do you prefer keeping the header minimal?

9. **Visual treatment for many missing-inputs entries in the story drawer (Addition C).** When a single story has, say, 12 missing-inputs entries, my default is to render them as a vertical list grouped by `kind` (e.g. "Mappings (4)", "Baselines (3)", "Contracts (5)") with each entry showing `id` and `reason`, no truncation, scroll inside the drawer if needed. Acceptable, or do you want a flat list, a "show first 5 / show all" toggle, or a different grouping (e.g. by reason rather than by kind)?

10. **Route placement.** Two candidates:
    - (a) `/projects/:projectId/architectures/:architectureId/product/migration-delivery/:bookId`
    - (b) `/projects/:projectId/architectures/:architectureId/migration-books-of-work/:bookId/delivery`
    I lean (b) because it keeps the dashboard physically adjacent to the existing book-of-work detail route and makes the URL self-describing as a sub-view of a specific book of work. Confirm (b), or do you want (a) to align with a future "Product" navigation hub?

11. **Error handling when AMS returns partial roll-up.** If, e.g., the implementation-workspace sub-query fails but spec-generation and backlog-save sub-queries succeed, my assumption is:
    - AMS returns 200 with the available sections populated and a `warnings[]` entry naming the failed subsection (e.g. "Implementation workspace data unavailable").
    - The frontend renders all sections, replaces the affected section's content with a non-blocking "Could not load implementation activity — retry" inline placeholder, and the rest of the dashboard remains usable.
    - We do NOT 500 the whole dashboard for a single sub-query failure.
    Confirm, or do you want stricter fail-fast behaviour (502/503 if any sub-query fails)?

12. **Exclusions / anything missing.** Is there anything else in scope for V1 that the raw idea didn't already commit to, or anything that you'd like to explicitly mark as out-of-scope beyond what's already listed (in-product spec editor, missing-input resolver flow, dependency model, execution engines)?

---

**Existing Code Reuse:**

The raw idea already names the existing artefacts to reference (`migrationShapeSpecGenerationHandler.ts` `targetWorkItemIds` support, Liquibase changesets 139 and 140, `BatchGenerationControls.tsx` UX, `specGenerationApi.startBatchGeneration`). Beyond those, are there other existing dashboard-style surfaces in the codebase (e.g. discovery run dashboards, roadmap/backlog views, or other roll-up screens) whose page layout, summary-card components, hierarchy-tree rendering, or refresh-banner UX we should reuse rather than build fresh?

If yes, please name them or give paths.

---

**Visual Assets Request:**

Do you have any design mockups, wireframes, or screenshots that could help guide the layout of the dashboard surfaces (header, summary cards, workstream progress strip, hierarchy tree, needs-attention panel, story detail drawer)?

If yes, please place them in: `agent-os/specs/2026-05-19-migration-delivery-progress-and-evidence-tracking/planning/visuals/`

Use descriptive file names like:
- migration-delivery-dashboard-mockup.png
- needs-attention-panel-lofi.png
- story-drawer-missing-inputs.png
- hierarchy-tree-wireframe.png
- summary-cards-sketch.png

Please answer the questions above and let me know if you've added any visual files or can point to similar existing dashboard surfaces in the codebase.
