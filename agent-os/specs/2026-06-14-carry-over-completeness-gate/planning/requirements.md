# Spec Requirements: D4 — Carry-over Completeness Gate

## Initial Description

D4 is Spec 4 of 6 in the discovery-completeness + net_new program. It implements the **carry_over completeness gate**: the human-accountability backstop that replaces reconciliation for non-API work.

The load-bearing insight of the whole program: **reconciliation is API-only**. Non-API / internal work (batch capabilities, stored procedures, scheduled jobs, monitoring, deployment) has NO downstream backstop — if we fail to carry it over, nothing ever catches it (unlike a missed API endpoint, which surfaces as a reconciliation break). D4 IS that backstop: a human must consciously ACCOUNT FOR every behaviour-bearing carry_over capability/finding before the Migrate button unlocks.

D4 extends the already-built Spec-3 Migrate hard-block rather than forking a parallel gate.

## Problem Statement / Context

- **Reconciliation covers API behaviour only.** The runtime-capture oracle (api-migration-validation-service) verifies API behaviour against the legacy black box. Internal / non-API work is invisible to it.
- **Non-API carry_over work therefore has no backstop.** Batch capabilities, stored procs, scheduled jobs, monitoring, and deployment concerns that are dropped during migration produce no reconciliation break — the loss is silent.
- **A human must close that gap before Migrate.** The only safe substitute for an automated oracle is a conscious human accounting pass: every behaviour-bearing carry_over capability/finding must be either CITED by a story (it will be carried over) or explicitly DISMISSED with a reason (it consciously won't be).
- **The existing coverage snapshot is passive and severity-keyed.** `migrationBookOfWorkHandler.ts` `buildFindingsCoverageSnapshot` today only lists `review_status='approved'` critical/high findings, keyed to **severity** (not `behaviourBearing`), with NO capabilities, and **enforces nothing**. D4 must make it active, re-key it to `behaviourBearing`, and add capabilities.

D4 = the carry_over completeness gate ONLY: account-for-everything (cite or dismiss) → Migrate unlocks. Net_new / provenance (D5) and reconcile-time verification / target_only routing (D6) are explicitly out.

## Requirements Discussion

The clarifying-question phase is complete. The user reviewed all recommendations and agreed with every one, including the addition of a dedicated `dismissed` disposition value. The finalized, user-confirmed decisions are captured below as Confirmed Decisions D1–D12.

### Existing Code to Reference

All paths below were verified during shaping. The build extends — does not fork — the built Spec-3 Migrate hard-block.

**Built Spec-3 Migrate hard-block (extend in place):**
- `gateway` `migrationExecutionDriver.ts` — `evaluateHardBlock` returns `reasons[]` of `{ code, message, workItemId? }`; also `startMigration` pre-flight and `buildOrderedDispatchSet`. The gate reads structured rows already.
- `frontend` `MigrationDeliveryMigratePanel.tsx` — `computeHardBlockReasons` + the `serverBlockReasons` / `blockReasons` list rendering.

**Coverage snapshot (make active):**
- `gateway` `migrationBookOfWorkHandler.ts` — `buildFindingsCoverageSnapshot` (the PASSIVE snapshot: only `review_status='approved'` critical/high, keyed to severity not `behaviourBearing`, NO capabilities).
- `frontend/src/utils/findingsCoverage.ts` — `computeFindingsCoverage`.

**Findings / dispositions:**
- AMS `DiscoveryFindingEntity` — `reviewStatus` / `previousReviewStatus` / `reviewerNotes` / `reviewedAt` / `detailJson`; queryable per project+architecture and per run+project+architecture.
- `discoveryFindingReferences[]` on `book_of_work_json` blob items (the finding-citation mechanism, reused as-is).

**D2 capabilities (the review surface to extend + the roll-up source):**
- AMS `discovery_capability` + `discovery_capability_member` (polymorphic `member_type` / `member_id`).
- `frontend` `FindingsTab.tsx` — the read-only Capabilities-in-Findings section (D2's read-only view).

**D3 cite mechanism + the column to promote:**
- D3 `append-capability-story` endpoint (the cite mechanism) + `source_capability_id` (currently stamped into the `book_of_work_json` blob).
- The AMS `append-test-item` endpoint (the batch-create precedent for the "Generate all capability stories" batch).

**Similar Features Identified:**
- Feature: Spec-3 Migrate hard-block — Path: `gateway` `migrationExecutionDriver.ts`, `frontend` `MigrationDeliveryMigratePanel.tsx`
- Feature: Findings coverage snapshot — Path: `gateway` `migrationBookOfWorkHandler.ts` (`buildFindingsCoverageSnapshot`), `frontend/src/utils/findingsCoverage.ts`
- Feature: D2 Capabilities-in-Findings — Path: `frontend` `FindingsTab.tsx`; AMS `discovery_capability` + `discovery_capability_member`
- Feature: D3 cite path — Path: `append-capability-story` endpoint; `source_capability_id`
- Backend batch precedent: AMS `append-test-item` endpoint

**Critical non-reuse warning:** `WorkItem.deferred` (changeset 182) means "implementation-exclusion only, **still in reconciliation scope**". Do NOT reuse its semantics for finding/capability dismissal. `deferred` is deliberately NOT an escape hatch for this gate (see D4).

### Follow-up Questions

None required. The user confirmed all recommendations in a single pass.

## Visual Assets

### Files Provided:

No visual assets provided. The `planning/visuals/` folder was checked via bash and is empty (visuals were optional for this spec).

### Visual Insights:

Not applicable.

## Confirmed Decisions

### D1 — Block vs Warn: HARD-BLOCK

HARD-BLOCK (not warn). Add a NEW reason code `carry_over_not_accounted` to the **same** `evaluateHardBlock` / `computeHardBlockReasons` surface (gateway `migrationExecutionDriver.ts` + frontend `MigrationDeliveryMigratePanel.tsx`). Capabilities AND un-grouped behaviour-bearing findings are treated **identically** — both block, and both are surfaced in the **same** offending list. A warning would defeat the no-backstop purpose.

### D2 — Gating Predicate + Roll-up

`behaviourBearing == true` is the **sole** predicate for "must be accounted for". This is the D1/D2 hint, surfaced via finding `detailJson` and aggregated on the capability. `behaviourBearing == false` NEVER gates.

Roll-up rules:
- A finding that is a **member of a covered-or-dismissed capability** is itself accounted-for (do NOT double-count it).
- A behaviour-bearing finding that is **NOT a member of any capability** gates **on its own**.

Must-account set = **{behaviour-bearing capabilities}** ∪ **{behaviour-bearing findings not rolled into any capability}**.

### D3 — `source_capability_id` Storage: PROMOTE to a Column

PROMOTE `source_capability_id` to a real `work_item` **column** (changeset ~185, UUID, nullable) so the gate's coverage query is an efficient structured join (`evaluateHardBlock` already reads structured rows), not a per-Migrate blob re-parse.

D3→D4 handoff:
- D3 stamps the `book_of_work_json` blob (stays changeset-free).
- D4 ADDS the column AND updates D3's `append-capability-story` endpoint to ALSO write the column.
- The gate then queries the column.
- The finding side reuses the existing `discoveryFindingReferences` on blob items as-is (no change).

### D4 — Dismissal Vocabulary

A human dismisses a behaviour-bearing item with a MANDATORY reason (non-empty `reviewerNotes`) to satisfy the gate.

ADD a dedicated `dismissed` disposition value AND ALSO let pre-existing `rejected` satisfy the gate — they mean different things:
- `rejected` = "not real / not valid" — a not-real finding needn't be carried over, so it auto-satisfies.
- `dismissed` = "real but consciously excluded from migration" — dead code retired, out-of-scope.

Both are STRING values (NO DDL — `reviewStatus` / `review_status` are string-typed). Extend the **service-layer validation set** on BOTH `DiscoveryFinding` and `discovery_capability` to accept `dismissed`.

**NET RULE:** accounted-for-by-disposition = `reviewStatus ∈ {rejected, dismissed}` with a **non-empty reason**.

`approved` / `pending_review` / `deferred` do NOT satisfy:
- An approved-but-uncited capability still gates.
- `deferred` is deliberately NOT an escape hatch — built-Spec-3 already overloads work_item `deferred` for "exclude from implementation but STILL in reconciliation scope".

### D5 — Gate Scope: per Book-of-Work

Per BOOK-OF-WORK (same as the built gate). The book identifies project + `current_architecture_id`, which selects the capabilities/findings to evaluate. Checked inside the same `startMigration` pre-flight and mirrored on the panel. The must-account set is drawn from the book's project + architecture across the discovery runs that fed the plan.

### D6 — Cite Action + "Generate All Capability Stories" Batch

D4 wires a per-capability "Create story" (cite) action calling D3's `append-capability-story` (stamps `source_capability_id` → covered), AND a batch that does it once per un-covered approved behaviour-bearing capability.

Both live on the **completeness review surface**, NOT bolted onto the existing spec-Generate-All dialog (different stage).

Composition: citing creates the STORY; the existing `story_not_spec_ready` gate dimension then ensures that story gets a spec — **the two gate dimensions STACK**.

### D7 — Review Surface

EXTEND the D2 read-only Capabilities-in-Findings view (`FindingsTab.tsx`) with a coverage-status column + cite/dismiss actions, AND add the blocked-reason rendering to the existing `MigrationDeliveryMigratePanel` (deep-link to the review surface). NO new standalone panel.

Division of responsibility:
- The Migrate panel surfaces THAT there is un-accounted carry_over work.
- The actual cite/dismiss pass happens on the extended Capabilities view.

### D8 — Coverage Status Model

Per-item states: **{ un-actioned | cited-by-story | dismissed }**.
- A **capability** is `cited-by-story` iff a `work_item` exists with `source_capability_id == capability.id` (the D3 column).
- A **finding** is `cited-by-story` iff its id appears in any book item's `discoveryFindingReferences` OR it rolls up under a covered/dismissed capability (D2 membership).
- Either is `dismissed` iff `reviewStatus ∈ {rejected, dismissed}` with a reason (D4).
- Everything else behaviour-bearing is `un-actioned` (and gates).

ANY citing story counts as accounted-for — whether it is then deferred / spec-ready is the SEPARATE existing gate dimension.

### D9 — Roll-up Data Source

Read D2's `discovery_capability_member` table (polymorphic `member_type='discovery_finding'` / `member_id`) to resolve which member findings a covered/dismissed capability absorbs.

### D10 — Changeset

ONE small changeset ~185 adding `work_item.source_capability_id` (UUID, nullable) and NOTHING else. Dismissal reuses `reviewStatus` / `reviewerNotes`; the `dismissed` value is a string — no DDL.

Coordinate the number with D5 (one takes 185, the other 186 — settle when both are written).

Everything else is:
- gateway: coverage computation + the new hard-block reason + cite/batch wiring.
- frontend: review surface + blocked-reason rendering.

### D11 — Test Strategy

**gateway jest** (LLM-guard — mock `llmClient` — + `architectureModelClientMock`):
- (a) coverage-computation unit tests: covered / un-actioned / dismissed / member-finding roll-up / `behaviourBearing=false`-doesn't-gate.
- (b) a Migrate-gate extension test: blocks on un-accounted; unblocks after cite via `append-capability-story`; unblocks after dismiss.
- (c) a NO-REGRESSION test that the existing hard-block reasons (`story_not_spec_ready`, `missing_current_baseline`) still fire unchanged.

**AMS H2** (foreground `mvn`): entity/migration test for the new `source_capability_id` column.

**frontend vitest** (`renderWithProviders` + tsc baseline): the extended review surface + the new blocked-reason rendering.

### D12 — Scope Out

Strictly OUT of D4:
- net_new items + provenance (D5).
- reconcile-time verification / target_only routing (D6).

D4 = the carry_over completeness gate ONLY (account-for-everything → cite or dismiss → Migrate unlocks).

## Requirements Summary

### Functional Requirements

- Compute, per book-of-work, the coverage status of every behaviour-bearing carry_over capability and finding: `un-actioned` / `cited-by-story` / `dismissed` (D2, D8).
- Make the passive findings-coverage snapshot active and re-key it from severity to `behaviourBearing`, adding capabilities (problem statement; D2).
- Hard-block Migrate with a new `carry_over_not_accounted` reason whenever any behaviour-bearing carry_over capability/finding is neither cited nor dismissed; surface capabilities and un-grouped findings in one offending list (D1, D5).
- Let a human account for an item by either citing it (create a story via D3's `append-capability-story`, stamping `source_capability_id`) or dismissing it with a mandatory non-empty reason (D4, D6, D8).
- Roll up coverage: a finding under a covered/dismissed capability is accounted-for without double-counting; a finding under no capability gates on its own (D2, D9).
- Provide a per-capability cite action and a batch "Generate all capability stories" action on the completeness review surface (D6).
- Extend the D2 Capabilities-in-Findings view with coverage status + cite/dismiss actions, and render the blocked reason (with a deep-link) in the Migrate panel (D7).

### Reusability Opportunities

- Extend `evaluateHardBlock` / `computeHardBlockReasons` (gateway + frontend) — add a reason code, do not fork (D1).
- Make `buildFindingsCoverageSnapshot` + `findingsCoverage.ts` active rather than building new coverage logic (D2).
- Reuse `discoveryFindingReferences[]` for finding citation, `discovery_capability_member` for roll-up, and D3's `append-capability-story` for the cite action (D3, D6, D9).
- Model the batch on the AMS `append-test-item` precedent (D6).
- Reuse `reviewStatus` / `reviewerNotes` (findings) and `review_status` (capabilities) for dismissal — string-typed, no DDL (D4).

### Scope Boundaries

**In Scope:**
- Coverage computation for behaviour-bearing carry_over capabilities + findings (per book-of-work).
- The `carry_over_not_accounted` hard-block dimension on the existing Migrate gate.
- Cite (single + batch) and dismiss (with mandatory reason) actions.
- The extended Capabilities-in-Findings review surface + Migrate-panel blocked-reason rendering.
- One changeset adding `work_item.source_capability_id` and updating `append-capability-story` to write it.
- The `dismissed` disposition value (service-layer validation only) on `DiscoveryFinding` and `discovery_capability`.

**Out of Scope:**
- net_new items + provenance (D5).
- Reconcile-time verification / target_only routing (D6 of the program).
- Any escape-hatch behaviour for `approved` / `pending_review` / `deferred` dispositions.

### Technical Considerations

- **Owners:** gateway (coverage computation + the `carry_over_not_accounted` hard-block extension + cite/dismiss wiring + the "Generate all capability stories" batch + updating `append-capability-story` to write the new column) + AMS (changeset ~185 `work_item.source_capability_id`; extend `reviewStatus` / `review_status` validation to accept `dismissed` on BOTH `DiscoveryFinding` and `discovery_capability`; the coverage-data queries) + frontend (extend the D2 Capabilities-in-Findings view with coverage status + cite/dismiss + the Migrate-panel blocked-reason rendering).
- **`source_capability_id` is promoted to a structured column** so the gate query is a join, not a blob re-parse; `evaluateHardBlock` already reads structured rows (D3, D10).
- **No DDL for dismissal** — `reviewStatus` / `review_status` are string-typed; `dismissed` is added to the service-layer validation set only (D4, D10).
- **Changeset number coordination** with D5 — one takes 185, the other 186; settle when both are written (D10).
- **Gate dimensions stack** — citing satisfies `carry_over_not_accounted`; the existing `story_not_spec_ready` then ensures the cited story gets a spec (D6).
- **Do NOT reuse `WorkItem.deferred` (changeset 182) semantics** for dismissal — it means implementation-exclusion-but-still-in-reconciliation-scope; `deferred` deliberately does not satisfy this gate (D4).
- **Repo conventions:** gateway Express/TS with jest LLM-guard + `architectureModelClientMock`; AMS Java/Spring, new changeset ~185, boxed PATCH-mutable types, snake_case wire; frontend React/TS, vitest + `renderWithProviders` + tsc baseline.
