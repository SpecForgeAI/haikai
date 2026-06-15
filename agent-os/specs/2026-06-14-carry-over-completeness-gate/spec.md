# Specification: D4 — Carry-over Completeness Gate

## Goal
Make a human consciously account for every behaviour-bearing carry_over capability/finding — by citing it into a story or dismissing it with a reason — before Migrate unlocks, because non-API work has no reconciliation backstop. D4 extends the already-built Spec-3 Migrate hard-block; it does not fork a parallel gate.

## User Stories
- As a migration owner, I want Migrate blocked while any behaviour-bearing carry_over capability/finding is neither cited by a story nor dismissed, so silent loss of internal (non-API) work is impossible.
- As a reviewer, I want a per-item coverage status plus cite/dismiss actions on the existing Capabilities-in-Findings view, so I can clear the accounting pass without leaving the surface I already use.

## Specific Requirements

**Coverage computation (gateway, per book-of-work)**
- Compute per-item coverage status `un-actioned` | `cited-by-story` | `dismissed` for the book's must-account set, scoped by the book's project + `current_architecture_id` across the discovery runs that fed the plan (D5, D8).
- Must-account set = {behaviour-bearing capabilities} ∪ {behaviour-bearing findings NOT a member of any capability}; `behaviourBearing == true` is the sole gating predicate (read from `detail_json`; `false` never gates) (D2).
- A **capability** is `cited-by-story` iff a `work_item` exists with `source_capability_id == capability.id` (the new column) (D8).
- A **finding** is `cited-by-story` iff its id appears in any book item's `discoveryFindingReferences` OR it rolls up under a covered/dismissed capability via `discovery_capability_member` (D8, D9).
- Either is `dismissed` iff `reviewStatus`/`review_status` ∈ {`rejected`, `dismissed`} with a non-empty reason; `approved`/`pending_review`/`deferred` do NOT satisfy (D4).
- Roll-up: a finding that is a member of a covered/dismissed capability is accounted-for and is NOT double-counted; an un-grouped behaviour-bearing finding gates on its own (D2, D9).
- ANY citing story counts as accounted-for; whether that story is then deferred / spec-ready is the SEPARATE existing gate dimension (D6, D8).

**Activate the passive coverage snapshot**
- Make `buildFindingsCoverageSnapshot` (gateway `migrationBookOfWorkHandler.ts`) active and enforcing rather than a passive create-time list.
- Re-key it from `severity` (critical/high) to `behaviourBearing`, and add capabilities alongside findings (problem statement; D2).
- Mirror the re-key in frontend `findingsCoverage.ts` `computeFindingsCoverage` so the read-side grading matches.

**Extend the Migrate hard-block (gateway)**
- Add a new reason `{ code: 'carry_over_not_accounted', message, workItemId? }` to `evaluateHardBlock` in `migrationExecutionDriver.ts`; surface capabilities AND un-grouped findings in the SAME `reasons[]` list, treated identically (D1).
- Wire the check inside the existing `startMigration` pre-flight (server-side; never trust the UI); blocks when any must-account item is neither cited nor dismissed (D5).
- NO-REGRESSION: existing reasons `story_not_spec_ready` and `missing_current_baseline` keep firing unchanged; the new reason stacks alongside them (D11).

**Dismissal vocabulary (AMS service-layer, no DDL)**
- Add a dedicated `dismissed` string value to the reviewer-valid set on BOTH `DiscoveryFindingService` (`ALLOWED_STATUSES` / reviewer set) and `DiscoveryCapabilityService` (`DiscoveryCapabilityReviewStatus.REVIEWER_VALID` + `ALL`) (D4).
- Net accounted-for-by-disposition rule = `reviewStatus`/`review_status` ∈ {`rejected`, `dismissed`} with a non-empty reason; dismissal requires a mandatory reason (`reviewerNotes`, folded into `detail_json.reviewerNotes` for the capability per the D2 pattern) (D4).
- `rejected` = "not real" (auto-satisfies); `dismissed` = "real but consciously excluded"; both are strings — `review_status` is TEXT, so no DDL (D4, D10).

**Promote `source_capability_id` to a column (AMS changeset 185)**
- Add `work_item.source_capability_id` (UUID, nullable) in ONE small changeset numbered 185 (latest applied is D2's 184; coordinate so D5 takes 186) — and NOTHING else (D3, D10).
- Update D3's `appendCapabilityStory` (`GeneratedMigrationBookOfWorkService`) to ALSO write the new column when it stamps the `book_of_work_json` blob, so the gate's coverage query is a structured join (D3).
- The finding side reuses `discoveryFindingReferences` as-is — no change (D3).

**Cite + batch actions (gateway, on the review surface)**
- Per-capability "Create story" (cite) action calls D3's `append-capability-story` (stamps `source_capability_id` → `cited-by-story`) (D6).
- A "Generate all capability stories" batch runs the cite once per un-covered approved behaviour-bearing capability; model it on the AMS `append-test-item` batch-create precedent (D6).
- Both live on the completeness review surface, NOT the spec-Generate-All dialog (different stage) (D6).

**Coverage-data queries (AMS)**
- Provide the reads the gateway gate needs: behaviour-bearing capabilities + findings for a project + architecture, their `discovery_capability_member` membership, and `work_item.source_capability_id` coverage (D5, D9).

## Visual Design
No visual assets provided (`planning/visuals/` is empty). Follow the existing `CapabilitiesSection.tsx` / `MigrationDeliveryMigratePanel.tsx` visual conventions.

## Existing Code to Leverage

**Spec-3 Migrate hard-block — `gateway/src/services/migrationExecutionDriver.ts`**
- `evaluateHardBlock` already returns `reasons[]` of `{ code, message, workItemId? }` and `startMigration` runs it as a server-side pre-flight; ADD the `carry_over_not_accounted` reason here, do not fork.
- `HardBlockResult` / `StartMigrationResult` `'blocked'` shapes and `buildOrderedDispatchSet` are reused unchanged.

**Migrate panel — `frontend/.../MigrationDeliveryMigratePanel.tsx`**
- `computeHardBlockReasons` + the `serverBlockReasons` / `blockReasons` list rendering already render structured reasons; ADD the blocked-reason rendering for the new code here, with a deep-link to the review surface.

**Coverage snapshot — `gateway/.../migrationBookOfWorkHandler.ts` + `frontend/src/utils/findingsCoverage.ts`**
- `buildFindingsCoverageSnapshot` (passive, severity-keyed, findings-only) and `computeFindingsCoverage` are the bases to make active, re-key to `behaviourBearing`, and extend with capabilities.

**D2 + D3 — capabilities, cite, dismissal**
- AMS `discovery_capability` + `discovery_capability_member` (polymorphic `member_type='discovery_finding'`/`member_id`) is the roll-up source; `DiscoveryCapabilityService` review validation and `DiscoveryFindingService` `validateReviewStatus`/`ALLOWED_STATUSES` are the sets to extend with `dismissed`; `behaviourBearing` rides `detail_json` on both entities.
- `frontend/.../CapabilitiesSection.tsx` (rendered by `FindingsTab.tsx`) is the read-only D2 view to extend with a coverage-status column + cite/dismiss actions; `DiscoveryFindingEntity.reviewerNotes` is the dismissal reason store.
- D3's `appendCapabilityStory` (already stamps `source_capability_id` into the blob) is the cite mechanism to update to also write the new column; AMS `append-test-item` is the batch-create precedent.

## Out of Scope
- net_new items + provenance (D5 of the program).
- Reconcile-time verification / target_only routing (D6 of the program).
- Any escape-hatch satisfying the gate via `approved`, `pending_review`, or `deferred` dispositions.
- Reusing `WorkItem.deferred` (changeset 182) semantics for dismissal — it means "exclude from implementation but STILL in reconciliation scope" and deliberately does NOT satisfy this gate.
- Any DDL for dismissal (it reuses the string-typed `reviewStatus`/`review_status`) and any changeset beyond the single 185 adding `work_item.source_capability_id`.
- A new standalone review panel — D4 extends the existing Capabilities-in-Findings view and Migrate panel only.
