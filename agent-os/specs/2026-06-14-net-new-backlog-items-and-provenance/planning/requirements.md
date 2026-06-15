# Spec Requirements: Net-new backlog items + provenance (D5)

## Initial Description

This is Spec 5 (of 6) in the discovery-completeness + net_new program. It serves
**use-case 2**: genuinely NEW work the user wants to add to the migration
roadmap/backlog **before hitting Migrate** — work that is NOT in current-state, so
NOT a like-for-like carry-over (e.g. a brand-new batch/monitoring job, a new
feature, or out-of-codebase maintenance like OS cron / vacuum schedules / ops
runbooks that no parser can discover). The user's stated preference ("Option B")
is to add such non-reconciling work to the backlog before Migrate.

D5 delivers:
1. A `provenance` marker on work items (`carry_over` = like-for-like, must match
   current-state; `net_new` = additive, deliberately outside the like-for-like
   envelope) that distinguishes the two use-cases throughout the system.
2. A first-class "add a work item before Migrate" path that flows the new item
   into spec-gen → an implementation-ready spec → the built Migrate dispatch.
3. The interaction rules with D4's completeness gate (net_new is never a
   carry_over obligation) and a forward pointer to D6 (reconcile consumes the
   marker; D5 only SETS it).

**The undiscoverable-carry_over nuance** is in-scope to resolve: some current-state
work is genuinely carry_over (exists today, must be preserved like-for-like) but
is NOT discoverable from code/DB (OS cron, vacuum/index schedules, ops runbooks).
The "add item" path must therefore support BOTH provenance values — a human adding
undiscoverable carry_over work AND adding genuinely-new net_new work.

## Problem Statement / Context

The migration tool treats a current service + DB as a black box and rebuilds the
inside like-for-like; discovery seeds the book-of-work, and reconciliation (API-only)
is the behavioural oracle. Two gaps motivate D5:

- **Use-case 2 — additive work before Migrate.** Today there is no first-class way
  to add genuinely-new, non-reconciling work (a new job, a new feature) to the
  migration backlog so it gets an implementation-ready spec and rides the Migrate
  dispatch. Net_new work is additive: it is deliberately outside the like-for-like
  envelope, so it must not be treated as a current-state coverage obligation.

- **Undiscoverable carry_over.** Some genuinely like-for-like work (OS-level cron,
  vacuum/index schedules, ops runbooks) cannot be discovered by any parser, so it
  never becomes a discovered finding/capability and D4's completeness gate (which
  evaluates DISCOVERED findings/capabilities) cannot include it. A human must be
  able to add such carry_over work manually.

- **Honesty nuance for non-API manual carry_over.** Reconciliation is API-only (it
  needs a replay surface). For a NON-API manual carry_over add (the OS-cron case)
  there is no replay surface, so the "absence is a reconciliation break" framing
  does not literally apply — its real assurance is effect-tests (the same backstop
  as a net_new non-API item). So for a non-API manual add, carry_over vs net_new is
  mostly **semantic**; it only materially differs for the **API** case, where it
  drives D6's target_only handling. D5 must mark both values without over-promising
  a reconciliation backstop that non-API work cannot have.

- **Verified latent bug — `applyManualEdit` does not promote status.** The existing
  AMS `applyManualEdit` overwrites `generatedSpecText` plus the 4 manual-edit audit
  columns but does NOT change `status`. A hand-authored spec on an
  `insufficient_context` row therefore stays un-dispatchable. D5's hand-author
  escape hatch (D3 below) closes this.

**Provenance semantics:** `carry_over` = like-for-like, must match current-state
(the default; every existing/discovered item is correctly carry_over with NO
backfill). `net_new` = additive, deliberately outside the like-for-like envelope.

## Requirements Discussion

The clarifying-question phase is complete. The user agreed with all recommendations,
including the fuller describe→generate (primary) + author→promote (fallback) path
for spec-gen. The agreed direction is captured as Confirmed Decisions D1–D9 below.

### First Round Questions

**Q1 (undiscoverable-carry_over model):** Should the add-item path support BOTH
provenance values now (a human adding genuinely-new net_new work AND undiscoverable
carry_over work), given reconciliation is API-only and non-API carry_over has no
replay surface?
**Answer:** Yes — support both values now. D5 only SETS the marker; D6 consumes it.
For non-API manual carry_over the reconciliation-break framing does not literally
apply (its assurance is effect-tests, same as net_new non-API), so carry_over vs
net_new on a non-API manual add is mostly semantic and only drives D6's target_only
handling for the API case. Mark both values; do not over-promise a reconciliation
backstop non-API cannot have. (→ D1)

**Q2 (provenance storage):** Store provenance as a `work_item.provenance` column
(VARCHAR NOT NULL DEFAULT 'carry_over'), boxed/null-guarded PATCH exactly like the
`deferred` column from changeset 182, column-authoritative and column-only (dispatch
ignores it; D6's reconcile reads rows), adding a blob mirror only if D6 shaping
surfaces a need?
**Answer:** Yes. Values are {carry_over (default), net_new} only. The carry_over
default means every existing/discovered item is correct with NO backfill. Column is
authoritative and column-only; add a blob mirror ONLY if D6 needs it. (→ D2, D7)

**Q3 (spec-gen for a manual net_new item):** For a manually-added net_new item,
should spec-gen run description-grounded from the human's description (the PRIMARY
path), with a hand-author override that promotes status — and do BOTH?
**Answer (user agreed the fuller path):** Do BOTH, with describe→generate as the
PRIMARY path. (b, primary) The add-item form takes a human description; spec-gen runs
DESCRIPTION-GROUNDED (the human's intent IS the context, replacing the
discovered-context resolver) to produce a full implementation-ready spec the normal
way (reaching `generated`, hydrating implement-state + the test pack). For net_new
the no-fabrication constraint RELAXES — the human's description is the authoritative
intent, not something to guess. (a, fallback/override) FIX `applyManualEdit` to
PROMOTE status to `generated` on non-empty hand-authored spec text — a precise
hand-author escape hatch that also closes the latent bug. Rationale: the program's
value is LLM-generated implementation-ready specs; forcing hand-authoring of every
net_new spec would be inconsistent and laborious. (→ D3)

**Q4 (add-item surface + routing):** One "Add work item" action on the Migration
Delivery Dashboard (where the book-of-work + Migrate gate live), with provenance +
kind flavour (API vs operational/non-API) + title/description, backed by an
append-*-item-style AMS endpoint modelled on append-test-item — and should a manual
add (either provenance) route through D3's discovered operational_capability path or
always through description-grounded spec-gen?
**Answer:** One action on the Migration Delivery Dashboard (this is net-new UI — no
add-work-item surface there today), backed by an append-*-item-style AMS endpoint
(modelled on append-test-item) that creates the WorkItem via persistOne + appends the
book_of_work_json.items[] blob + stamps provenance in one transaction. TIGHTENED
DESIGN: a manually-added item (EITHER provenance) has NO discovered
capability/finding, so it does NOT route through D3's operational_capability path
(that path is for DISCOVERED capabilities) — it is ALWAYS description-grounded
spec-gen; "kind" only tunes the prompt FLAVOUR (API-endpoint vs
operational-effect-test orientation). Clean split: discovered work =
resolver-grounded; manual adds = description-grounded. Reuse WorkItemCreateModal.tsx
form patterns but mount the action on the dashboard. (→ D4)

**Q5 (dispatch + D4-gate interaction):** Does a net_new spec-ready story dispatch
unchanged, and is net_new excluded from D4's carry_over gate purely by the marker
(no gate code) — and is a manual carry_over add also outside the gate's discovered
must-account set?
**Answer:** Yes to all. (a) A net_new spec-ready story dispatches UNCHANGED — dispatch
keys on workItemId + spec-ready (status ∈ {generated, generated_with_warnings} +
non-stale) + non-deferred, and reads NO provenance. (b) net_new is excluded from D4's
carry_over gate PURELY by the marker; D4's must-account set is DISCOVERED
capabilities/findings, never manual adds — NO gate code needed beyond the marker
existing. (c) A manually-added carry_over item is ALSO not in D4's discovered
must-account set; its safety net is D6/effect-tests, NOT the D4 gate. (→ D5)

**Q6 (frontend):** A provenance badge + a filter in the backlog/hierarchy tree, plus
the add-item form (provenance + kind flavour + title/description + the
describe→generate trigger and the hand-author field), with no bulk re-classify in v1?
**Answer:** Yes. Badge (net_new / carry_over) + filter (show only net_new / only
carry_over) in the backlog/hierarchy tree; the add-item form per D4 (provenance + kind
flavour + title/description + describe→generate trigger + the hand-author field per
D3). NO bulk re-classify in v1. (→ D6)

**Q7 (scope out):** Does reconcile-time target_only handling stay entirely out of D5?
**Answer:** Yes. Reconcile-time target_only handling stays OUT of D5 entirely; D5 only
SETS provenance; D6 consumes it to auto-recognise a net_new API endpoint appearing as
target_only as EXPECTED (not a break). NAMING NOTE: the discovery-program's "D6" is
the reconcile CONSUMER that EXTENDS the already-built
`migration-reconciliation-and-bug-loop` spec — NOT the same file/spec. (→ D9)

### Existing Code to Reference

The user verified these reuse points (no exploration needed by the spec-writer beyond
referencing them):

**Provenance-column precedent (AMS):**
- `WorkItemEntity.deferred` (changeset 182) — boxed type, NOT NULL DEFAULT,
  `@PrePersist` mirror, null-guarded PATCH. The EXACT precedent for the provenance
  column. `WorkItemDto` is a Java record with convenience constructors.

**Add-item endpoint precedent (AMS):**
- The built **append-test-item** AMS endpoint — creates a WorkItem via `persistOne`
  + appends `book_of_work_json.items[]` in one transaction. The add-item precedent for
  D4's append-*-item endpoint.

**The latent bug the D3 fallback closes (AMS):**
- `manualEditSpec` → AMS `applyManualEdit` — overwrites `generatedSpecText` + the 4
  manual-edit audit columns but does NOT change `status` (so a hand-authored
  insufficient_context row stays un-dispatchable).

**Spec generator (gateway):**
- `migrationShapeSpecGenerationHandler` — the generator; needs a description-grounded
  mode for manual adds (the human's description replaces the discovered-context
  resolver).

**Dispatch (gateway):**
- `migrationExecutionDriver.ts` `evaluateHardBlock` / `buildOrderedDispatchSet` — keys
  on workItemId + spec-ready + non-deferred, reads NO provenance → net_new dispatches
  unchanged.

**The discovered-capability path (NOT for manual adds):**
- D3 **append-capability-story** — for DISCOVERED capabilities ONLY, NOT manual adds.
  Documented here precisely so the spec-writer keeps the clean split (manual adds never
  route through it).

**D4 gate:**
- D4 gate — the marker tells it net_new isn't a carry_over obligation; no gate code
  change is needed beyond the marker existing.

**Add-form patterns (frontend):**
- `WorkItemCreateModal.tsx` (Product Backlog add form) — reuse patterns, but mount the
  action on the Migration Delivery Dashboard.

### Follow-up Questions

None. The clarifying phase concluded with the user agreeing to all recommendations.

## Visual Assets

### Files Provided:

No visual assets provided. (`planning/visuals/` confirmed empty via bash;
`ls … | grep` for image/PDF extensions returned "No visual files found".) Visuals were
optional for this spec.

### Visual Insights:

Not applicable — no visual assets to analyse.

## Requirements Summary

### Confirmed Decisions

**D1 — Undiscoverable-carry_over model.** Support BOTH provenance values now: a human
can add genuinely-`net_new` work AND `undiscoverable-carry_over` work. D5 only SETS the
marker; D6 consumes it. HONESTY NUANCE: for NON-API manual carry_over (the OS-cron
case) the "absence is a reconciliation break" framing does not literally apply —
reconciliation is API-only (no replay surface); its real assurance is effect-tests
(same as net_new non-API). So carry_over vs net_new on a non-API manual add is mostly
semantic and drives D6's target_only handling only for the API case. Mark both values;
do not over-promise a reconciliation backstop non-API cannot have.

**D2 — Provenance storage.** A `work_item.provenance` COLUMN (changeset ~186, VARCHAR
NOT NULL DEFAULT `'carry_over'`, boxed/null-guarded PATCH exactly like the `deferred`
column from changeset 182), values {`carry_over` (default), `net_new`} ONLY. Default
`carry_over` ⇒ every existing/discovered item is correct with NO backfill. COLUMN is
authoritative; COLUMN-ONLY (dispatch ignores provenance; D6's reconcile reads rows) —
add a blob mirror ONLY if D6 shaping surfaces a need.

**D3 — Spec-gen for a manual net_new item.** Do BOTH, with describe→generate as the
PRIMARY path:
- (b, primary) the add-item form takes a HUMAN DESCRIPTION, and spec-gen runs
  DESCRIPTION-GROUNDED (the human's intent IS the context, replacing the
  discovered-context resolver) to produce a full implementation-ready spec the normal
  way (reaching `generated`, hydrating implement-state + the test pack). For net_new the
  no-fabrication constraint RELAXES — the human's description is the authoritative
  intent, not something to guess.
- (a, fallback/override) FIX `applyManualEdit` to PROMOTE status to `generated` on
  non-empty hand-authored spec text — a precise hand-author escape hatch AND closes the
  latent bug (applyManualEdit today overwrites generatedSpecText + the 4 manual-edit
  audit columns but does NOT change status, so a hand-authored insufficient_context row
  stays un-dispatchable).

Rationale: the program's value is LLM-generated implementation-ready specs; forcing
hand-authoring of every net_new spec would be inconsistent and laborious.

**D4 — Add-item surface + routing.** ONE "Add work item" action on the Migration
Delivery Dashboard (where the book-of-work + Migrate gate live; net-new UI — no
add-work-item surface there today) with provenance (carry_over/net_new) + kind FLAVOUR
(API vs operational/non-API) + title/description, backed by an append-*-item-style AMS
endpoint (modelled on append-test-item) that creates the WorkItem via `persistOne` +
appends the `book_of_work_json.items[]` blob + stamps provenance, in one transaction.
TIGHTENED DESIGN: a manually-added item (EITHER provenance) has NO discovered
capability/finding, so it does NOT route through D3's `operational_capability` path
(that path is for DISCOVERED capabilities) — it is ALWAYS description-grounded spec-gen;
the "kind" only tunes the prompt FLAVOUR (API-endpoint vs operational-effect-test
orientation). Clean split: discovered work = resolver-grounded; manual adds =
description-grounded. Reuse `WorkItemCreateModal.tsx` form patterns but mount the action
on the dashboard.

**D5 — Dispatch + D4-gate interaction.** (a) A net_new spec-ready story dispatches
UNCHANGED (dispatch keys on workItemId + spec-ready [status ∈ {generated,
generated_with_warnings} + non-stale] + non-deferred; reads NO provenance). (b) net_new
is excluded from D4's carry_over gate PURELY by the marker (D4's must-account set is
DISCOVERED capabilities/findings, never manual adds — NO gate code needed beyond the
marker existing). (c) A manually-added carry_over item is ALSO not in D4's discovered
must-account set — its safety net is D6/effect-tests, NOT the D4 gate.

**D6 — Frontend.** A provenance badge (net_new / carry_over) + a filter (show only
net_new / only carry_over) in the backlog/hierarchy tree, plus the add-item form (D4:
provenance + kind flavour + title/description + the describe→generate trigger and the
hand-author field per D3). NO bulk re-classify in v1.

**D7 — Changeset.** ~186 (`work_item.provenance`, VARCHAR NOT NULL DEFAULT
`'carry_over'`), ONE column only. D4 takes 185 (`source_capability_id`), D5 takes 186 —
coordinate exact numbers when both are written. (Latest applied changeset is 183; D2 of
the program adds 184.)

**D8 — Test strategy.**
- gateway jest LLM-guard (mock `llmClient`) + architectureModelClientMock: (a)
  add-net_new-item → describe→generate → dispatch path; (b) the
  manual-author→dispatchable-status fix (applyManualEdit promotes status to `generated`
  on non-empty text); (c) a test that net_new is NOT in D4's must-account set.
- AMS H2 (foreground mvn): the provenance column + carry_over default + boxed-PATCH
  null-guard (mirror the `deferred` migration test); the add-item endpoint round-trip.
- frontend vitest (renderWithProviders + tsc baseline): the add-item form (provenance +
  kind) + the badge/filter.

**D9 — Scope out.** Reconcile-time target_only handling stays OUT of D5 entirely; D5
only SETS provenance; D6 consumes it to auto-recognise a net_new API endpoint appearing
as target_only as EXPECTED (not a break). NAMING NOTE: the discovery-program's "D6" is
the reconcile CONSUMER that EXTENDS the already-built
`migration-reconciliation-and-bug-loop` spec — NOT the same file/spec as this D5.

### Functional Requirements

- Add a `provenance` marker to work items with values {`carry_over` (default),
  `net_new`}; carry_over is the default so no backfill is required (D1, D2).
- Provide ONE "Add work item" action on the Migration Delivery Dashboard capturing
  provenance + kind flavour (API vs operational/non-API) + title + description (D4, D6).
- Persist a manually-added work item and stamp provenance via an append-*-item-style
  AMS endpoint that creates the WorkItem (`persistOne`) and appends
  `book_of_work_json.items[]` in one transaction (D4).
- Route every manual add (either provenance) to DESCRIPTION-GROUNDED spec-gen (the
  human's description replaces the discovered-context resolver); kind only tunes the
  prompt flavour. Manual adds never route through D3's discovered-capability path (D3,
  D4).
- Relax the no-fabrication constraint for net_new manual adds (the human description is
  authoritative intent) so spec-gen reaches `generated`, hydrating implement-state + the
  test pack (D3).
- Fix `applyManualEdit` to promote status to `generated` on non-empty hand-authored spec
  text — a hand-author escape hatch that also closes the latent un-dispatchable-row bug
  (D3).
- Dispatch a net_new spec-ready story unchanged (dispatch reads no provenance) (D5).
- Surface a provenance badge and a provenance filter in the backlog/hierarchy tree (D6).

### Reusability Opportunities

- `WorkItemEntity.deferred` (changeset 182) — exact precedent for the provenance column
  (boxed type, NOT NULL DEFAULT, `@PrePersist` mirror, null-guarded PATCH);
  `WorkItemDto` is a Java record with convenience constructors.
- The built **append-test-item** AMS endpoint — precedent for D4's add-item endpoint
  (persistOne + appends `book_of_work_json.items[]` in one transaction).
- `migrationShapeSpecGenerationHandler` — extend with a description-grounded mode for
  manual adds.
- `migrationExecutionDriver.ts` `evaluateHardBlock` / `buildOrderedDispatchSet` —
  unchanged; reads no provenance so net_new dispatches as-is.
- `WorkItemCreateModal.tsx` — reuse Product Backlog add-form patterns, mounted on the
  Migration Delivery Dashboard.
- D3 append-capability-story and D4 gate — referenced for the clean split (manual adds
  are never resolver-grounded and never a gate obligation); no code change to either
  beyond the marker existing.

### Scope Boundaries

**In Scope:**
- The `work_item.provenance` column + changeset ~186 (D2, D7).
- The append-*-item AMS endpoint that stamps provenance (D4).
- The add-item action on the Migration Delivery Dashboard (D4, D6).
- Description-grounded spec-gen for manual adds, with kind tuning the prompt flavour
  (D3, D4).
- The `applyManualEdit` status-promotion fix (D3).
- Provenance plumbing through the book-of-work + read-only pass-through in dispatch (D5).
- Provenance badge + filter in the backlog/hierarchy tree (D6).
- Tests across AMS, gateway, and frontend (D8).

**Out of Scope:**
- Reconcile-time verification / net_new target_only handling — that is the discovery
  program's D6 (a separate spec that EXTENDS `migration-reconciliation-and-bug-loop`)
  (D9).
- A blob mirror of provenance (column-only unless D6 shaping surfaces a need) (D2).
- Bulk re-classify of provenance in v1 (D6).
- Any change to D4's gate code or D3's discovered-capability path beyond the marker
  existing (D4, D5).

### Technical Considerations

- **Provenance is column-authoritative and column-only**: dispatch ignores it; D6's
  reconcile reads rows directly. Add a blob mirror only if D6 shaping surfaces a need
  (D2).
- **Changeset coordination**: D4 takes 185 (`source_capability_id`); D5 takes 186
  (`provenance`); settle exact numbers when both are written. Latest applied is 183; the
  program's D2 adds 184 (D7).
- **Boxed/null-guarded PATCH + snake_case wire** for any PATCH-mutable field, mirroring
  the `deferred` migration (D2).
- **Clean routing split**: discovered work = resolver-grounded (D3 capability path);
  manual adds = description-grounded spec-gen with kind-flavoured prompt (D4).
- **Honesty constraint**: do not promise a reconciliation backstop for non-API manual
  carry_over — its assurance is effect-tests, identical to net_new non-API (D1).
- **Repo conventions**: gateway Express/TS with jest LLM-guard (mock `llmClient`) +
  architectureModelClientMock; AMS Java/Spring with new changeset ~186 and boxed
  PATCH-mutable types on snake_case wire; frontend React/TS with vitest +
  renderWithProviders + tsc baseline. Reuse the built manual-add + dispatch rather than
  forking.

### Owners

- **AMS**: the `provenance` column on `work_item` + changeset ~186 (coordinate with D4's
  ~185), boxed/snake_case; the append-*-item endpoint that stamps provenance (modelled
  on append-test-item).
- **gateway**: the add-item handler routing manual adds to DESCRIPTION-GROUNDED spec-gen
  with the kind flavour tuning the prompt; the `applyManualEdit` status-promotion fix;
  the provenance plumbing through book-of-work + read-only pass-through in dispatch.
- **frontend**: the add-item form on the Migration Delivery Dashboard + the provenance
  badge/filter in the backlog/tree.
