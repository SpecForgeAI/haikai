# D5 — Net-new backlog items + provenance

This is Spec 5 (of 6) in the discovery-completeness + net_new program. It serves USE-CASE 2: genuinely NEW work we want to add to the migration roadmap/backlog BEFORE Migrate — work that is NOT in current-state, so NOT a like-for-like carry-over (e.g. a brand-new batch/monitoring job, a new feature, or out-of-codebase maintenance like OS cron / vacuum schedules / ops runbooks that no parser can discover). The user's stated preference: add such non-reconciling work to the backlog BEFORE hitting Migrate (their "Option B").

## What D5 does
1. PROVENANCE MARKER — add a `provenance` field on work items (default `carry_over` = like-for-like, must match current-state; `net_new` = additive, deliberately outside the like-for-like envelope). This distinguishes the two use-cases throughout the system. New Liquibase changeset ~186 (coordinate with D4's ~185 — D4 adds work_item.source_capability_id at ~185; settle exact numbers when both are written).
2. THE "ADD NEW ITEM BEFORE MIGRATE" PATH — a first-class way for the user to add a work item to the backlog/book-of-work, which then flows into spec-gen → gets an implementation-ready spec → is included in the built Migrate dispatch. Reuse the built Spec-1 manual-add work-item path for API work; D3's append-capability-story / the operational_capability spec-gen path for non-API work. Newly-added net_new items are marked provenance=net_new.
3. INTERACTION WITH THE D4 COMPLETENESS GATE — net_new items are NOT carry_over, so they are NOT subject to D4's "account for every behaviour-bearing carry_over capability/finding" gate (that gate is about CURRENT-STATE coverage completeness; net_new is additive). The provenance marker is what tells D4 "this is net_new, not a carry_over obligation."
4. INTERACTION WITH RECONCILIATION (forward pointer to D6) — a net_new API endpoint will appear in reconciliation as `target_only` (in the target, not in the current-state baseline) — which is NOT a break, it's expected. D5 only SETS the provenance marker; D6 (the next spec) consumes it to auto-recognise net_new target_only as expected. D5 does NOT touch reconciliation.

## KEY OPEN QUESTION — "carry_over that's undiscoverable"
Some current-state work is genuinely carry_over (it exists today, must be preserved like-for-like) but is NOT discoverable from code/DB — e.g. OS-level cron, vacuum/index schedules, ops runbooks. It can't be a discovered finding/capability, so D4's completeness gate (which evaluates DISCOVERED findings/capabilities) won't include it. So how does a human add a carry_over item that discovery could not find? Is it the same "add item" path but marked provenance=carry_over (vs net_new)? Does a manually-added carry_over item participate in reconciliation differently from a net_new one? This is a genuine nuance the shaping must resolve: the "add item" path likely needs to support BOTH provenance values (a human adding undiscoverable carry_over work AND adding genuinely-new net_new work), and the provenance value drives downstream treatment (reconciliation expectation in D6; the D4 gate only ever gates DISCOVERED carry_over, never manual adds).

## Owners
- AMS: the `provenance` column on work_item + changeset ~186 (coordinate with D4's ~185); boxed/snake_case.
- gateway: the add-item handler routing net_new (and manual carry_over) to the right spec-gen path (built generator for API; operational_capability path for non-API); the provenance plumbing through book-of-work + dispatch.
- frontend: the add-item surface (on the Migration Delivery Dashboard / backlog) + a provenance badge/filter (net_new vs carry_over) in the backlog/tree.

## Reuse
- The built Spec-1 manual-add work-item path (the existing "add a work item manually" that also needs an implementation-ready spec).
- D3's append-capability-story (for non-API net_new / manual operational work).
- The built Migrate dispatch (net_new items dispatched like any spec-ready story).
- D4's gate (provenance tells it net_new is not a carry_over obligation; manual adds are never in the gate's discovered must-account set).

## Scope boundaries (OUT of D5)
- Reconcile-time verification / net_new target_only handling (D6 — D5 only SETS provenance; D6 consumes it).
D5 = the provenance marker + the add-(net_new-or-manual-carry_over)-item path, flowing into spec-gen + Migrate dispatch.

## Repo conventions
gateway = Express/TS, jest with the live-LLM guard (mock llmClient) + architectureModelClientMock; AMS = Java/Spring, new Liquibase changeset ~186 ONLY (latest applied 183; D2 adds 184; D4 ~185 — coordinate), boxed PATCH-mutable types (provenance is a string but any PATCH-mutable fields boxed), snake_case wire; frontend = React/TS, vitest + renderWithProviders + tsc baseline. Reuse the built manual-add + dispatch rather than forking.
