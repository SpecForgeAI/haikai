# D4 — Carry-over completeness gate

This is Spec 4 (of 6) in the discovery-completeness + net_new program. THE LOAD-BEARING INSIGHT of the whole program: reconciliation is API-only, so non-API / internal work (batch capabilities, stored procs, scheduled jobs, monitoring, deployment) has NO backstop — if we fail to carry it over, nothing downstream ever catches it (unlike a missed API endpoint, which surfaces as a reconciliation break). D4 IS that backstop: a human must consciously ACCOUNT FOR every behaviour-bearing carry_over capability/finding before the Migrate button unlocks.

## What D4 does
1. COVERAGE COMPUTATION — for a migration run / book-of-work, compute which behaviour-bearing carry_over findings + D2 capabilities are CITED by a story (covered) vs un-actioned. Reuse the existing `findingsCoverage` snapshot (today PASSIVE — it lists accepted findings but enforces nothing). Citation resolves via: a story created from a capability through D3's `append-capability-story` path stamps `source_capability_id` (currently in the book_of_work_json blob); a story citing a finding uses the existing `discoveryFindingReferences[]`. Coverage ROLLS UP: a finding that is a member of a covered capability counts as covered (don't double-count).

2. THE GATE AT MIGRATE — extend the already-built Spec-3 Migrate HARD-BLOCK (migrationExecutionDriver `evaluateHardBlock` + the frontend MigrationDeliveryMigratePanel gate UI) with a COVERAGE dimension: Migrate is blocked if any behaviour-bearing carry_over capability/finding is NEITHER cited by a story NOR explicitly human-dismissed. Surface the offending list exactly like the built hard-block surfaces non-generated stories. (Block-vs-warn is a shaping question — the built Migrate gate is a hard-block; non-API work has no backstop, so lean hard-block.)

3. HUMAN DISMISSAL — a human can explicitly DISMISS a behaviour-bearing finding/capability with a REASON (won't be carried over — dead code, intentionally dropped, out-of-scope). Reuse the existing finding `reviewStatus` (pending_review/approved/rejected/deferred) + `reviewerNotes` and the D2 capability `review_status`. A dismissed disposition with a reason SATISFIES the gate (accounted-for). The `behaviourBearing` hint (D1 best-effort, D2 aggregated, D3 surfaced) is the predicate for WHICH findings/capabilities MUST be accounted for — pure-config/noise (behaviourBearing=false) does NOT gate.

4. THE REVIEW SURFACE — a completeness review (frontend) listing behaviour-bearing capabilities/findings with their coverage status (cited-by-story / dismissed / un-actioned), with actions to CITE (create a story via D3's append-capability-story — this is where the "Generate all" capability-story batch deferred from D3 lands) or DISMISS (with reason). This is where the user does the "account for everything" pass before Migrate.

## Key open design questions (for shaping)
- BLOCK vs WARN at Migrate for un-accounted behaviour-bearing carry_over work (lean hard-block, matching the built Migrate gate).
- The exact coverage-resolution + roll-up (capability covered ⇒ its member findings covered; a finding directly referenced ⇒ covered).
- Does D4 PROMOTE `source_capability_id` from the book_of_work_json blob to a COLUMN for an efficient coverage query? (D3 deliberately left it in the blob and said "D4 promotes to a column if its coverage query needs it.") Likely a small changeset (~185 — but D5's provenance changeset is also ~185; COORDINATE numbering).
- Which `review_status` values satisfy the gate as "accounted-for" (rejected/dismissed-with-reason yes; deferred = ? — note built-Spec-3 already uses `deferred` for "exclude from implementation but STILL in reconciliation scope" on work_items; findings/capabilities are a different object — define cleanly).
- Gate scope: per migration run / per book-of-work / per project+architecture.

## Owners
- gateway: the coverage computation + the Migrate hard-block extension (the coverage dimension) + the cite/dismiss action wiring + the "Generate all capability stories" batch (D3's append-capability-story driven from the gate).
- AMS: the coverage data (capabilities + findings + their citation [source_capability_id] + dismissal [review_status]); possibly promote source_capability_id to a column (changeset ~185, coordinate with D5).
- frontend: the completeness review surface + the gate-blocked reason in the existing Migrate panel.

## Reuse
- Built Spec-3 Migrate hard-block: migrationExecutionDriver.ts `evaluateHardBlock` (+ its offending-list return) + frontend MigrationDeliveryMigratePanel.tsx gate UI.
- The `findingsCoverage` snapshot in the book-of-work handler (today passive) — make it active.
- Finding `reviewStatus` + `reviewerNotes`; D2 capability `review_status` + the read-only Capabilities-in-Findings surface; stories' `discoveryFindingReferences[]`.
- D3's `append-capability-story` (the cite mechanism).

## Scope boundaries (OUT of D4)
- Net_new items + provenance (D5).
- Reconcile-time verification / target_only routing (D6).
D4 = the carry_over completeness gate ONLY: account-for-everything (cite or dismiss) before Migrate.

## Repo conventions
gateway = Express/TS, jest with the live-LLM guard (mock llmClient) + architectureModelClientMock; AMS = Java/Spring, new Liquibase changesets ONLY if truly needed (latest applied 183; D2 adds 184; D4/D5 ~185 — coordinate), boxed PATCH-mutable types, snake_case wire; frontend = React/TS, vitest + renderWithProviders + tsc baseline. Extend the built Migrate hard-block rather than building a parallel gate.
