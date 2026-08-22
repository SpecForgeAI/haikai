# Foundations & Scope Program — Decision Record (2026-08-22)

Agreed with the product owner across the 2026-08-21→22 design conversation.
This document is the authoritative design contract for Specs 0–5; the
BUILD-LOG.md beside it records as-built reality.

## Problem

Estate-level facts (backup-copy tables, temp/working tables, keyless
tables, engine hazards, never-CRUDed tables) are knowable at scan time but
today surface four stages later as capture failures (missing_pk walls, S0
fingerprint mismatches from app churn) at maximum cost. Fail-closed is
right; LATE fail-closed is expensive.

## Core design (all agreed)

1. **Not a new scan.** A Foundations Review = deterministic rule engine
   over evidence the existing scans already collect, surfaced as an
   adjudication panel ON the existing scan review screens (one scan, one
   review, one save). Questions ACCRETE: DB-only questions at the DB-scan
   review; joint (code+DB) questions at the code-scan review.
2. **Decisions are durable, additive model facts** ("dispositions") with
   provenance + evidence hash. Re-scans keep settled answers; a question
   reopens (stale-chipped, prior answer shown) only when its evidence
   changed. Rules can auto-apply to future matches.
3. **Decisions never block.** Unanswered questions apply safe defaults
   (include everything, keys fail-closed) and stay visible.
4. **Exclusion is a tag, never a deletion.** Current-state model keeps
   excluded entities (factual record + S0 fingerprint needs their
   metadata: metadataForTable lookups). Target-side stages filter scope.
5. **Persistence — OPTION (a), user-ruled:** single collection
   (`physical_data_entities`) + `migration_scope` + `scope_decision_ref`
   fields + ONE mandatory accessor pair per service
   (`inScopeEntities(model)` / `allEntities(model)`) + a guard test per
   service that fails the build on raw collection access outside the
   accessor module.
6. **Candidate terminal status `committed_excluded`** (user proposed
   "committed_ignored"; renamed — it IS committed to current state,
   excluded from migration) + scope level + decision ref on the candidate.
7. **Scope levels:** `in_scope` (default) | `excluded` (current ✓ badged,
   target ✗) | `volatile` (current ✓, target ✗, S0-fingerprint tolerated)
   | `data_only` (target schema+data, no code-behaviour expectations).
   NO hard-delete-from-current-state option (S0 verifier would report
   table_not_in_model).
8. **Cascade with preview.** Containment (attributes) and same-scope
   references cascade silently; anything CROSSING the scope boundary
   (in-scope FK → excluded table, endpoint writing an excluded table,
   view/proc reading one) is promoted to an explicit sub-question. The
   review card shows a cascade preview before confirm.
9. **Receipts everywhere.** Counters + per-row chips citing decision refs
   (`EXCLUDED · backup_copy · F-1`) on candidates/findings/structural
   model; scope receipt lines on plan/pack; reconciliation and drift show
   excluded tables as an EXPLICIT "excluded from reconciliation" slice —
   never silently absent. Capture preflight + S0 verdicts cite F-refs.
10. **S0 plane separation.** Dispositions never re-dump S0; the ONE
    interaction is `volatile` scope read live by the fingerprint
    COMPARISON (tolerated list). S0 re-pins only on physical environment
    change.
11. **Key policy per keyless table:** promote unique index → PK (verified
    all columns non-null; materialized additively into
    `constraints_metadata.primary_key` with provenance tag) | surrogate on
    target + declared diff key | keyless multiset count+hash diff for
    capture | exclude. LLM is proposer-never-decider (composite candidates
    to PROBE), deterministic probes + human review decide.
12. **Sequencing (user-confirmed):** Spec 0 ships first as a standalone
    capture-resilience slice using the same data model (nothing throwaway).

## Spec breakdown

- **Spec 0 — Capture resilience** (standalone): S0 diverged-table list in
  the diagnostic message (top-N names + expected→actual; payload already
  persisted); `paused_auth_expired` pause after N consecutive
  auth-expired failures + resume via existing uncovered-retry path;
  frontend diagnostics grouping of identical messages with ×count.
- **Spec 1 — Scope & decisions data plane**: model fields
  (migration_scope, scope_decision_ref), `foundation_decisions` carried in
  the model JSON (MCP additive merge, the model-write-owner idiom),
  `committed_excluded` candidate status, accessor pair + guard tests in
  gateway/AMVS/discovery/frontend, save-back cascade (entities,
  relationships, findings auto-resolve), AMS wire-carriage verification
  (typed DTOs must not strip the new fields).
- **Spec 2 — DB-scan foundations review**: deterministic rules
  (backup-copy via column-signature near-duplicate + name patterns;
  temp/working name patterns; key posture 3-bucket with nullability
  verification; engine type hazards; sentinel/dormant rules only where
  scan evidence carries data samples/row counts — honest conditional);
  review panel (cards, bulk answers, per-table override, cascade preview,
  boundary-crosser sub-questions); excluded buckets + chips; structural
  model scope groups/badges; Foundations decisions panel.
- **Spec 3 — Capture + S0 readers**: promotion materialization consumed by
  compensation unchanged; keyless multiset count+hash bracket mode;
  preflight scope conflicts citing F-refs (excluded effect tables leave
  effect scope); volatile-tolerant S0 verification with split verdict
  (tolerated vs unexpected) in report, diagnostics and UI.
- **Spec 4 — Target & reconciliation readers**: pack/plan/spec filter via
  accessor + receipts; surrogate-on-target wiring for keyless decision;
  reconcile/drift/progress explicit excluded slice; per-consumer
  acceptance tests (excluded ⇒ no DDL, no data script, no story, no rec
  row — one receipt row).
- **Spec 5 — Joint layer + estate entry**: CRUD matrix questions on the
  code-scan review (never-CRUDed, write-only audit, read-only reference);
  excluded-but-code-touches conflict; staleness reopen + auto-apply
  rules; "Full estate scan" orchestration (DB run → code run →
  sequential reviews).

## Standing constraints honored

Never write client-derived tokens into code/tests/fixtures (invented
fixture vocabulary only). Additive model writes through MCP. snake_case
AMS wire (camelCase only with @CamelCaseWire). No AskUserQuestion. Loud
over silent, everywhere.
