# Verification Report: Reject-Cascade Correctness

**Spec:** `2026-06-05-reject-cascade-correctness`
**Date:** 2026-06-05
**Verifier:** implementation-verifier
**Status:** ✅ Passed

---

## Executive Summary

The spec is fully and faithfully implemented across all four task groups. The wire
extension plumbs the raw `edges` graph + per-node `review_status` to both resolver
mirrors; reject-only exclusivity, the peer rule, and relationship surfacing/marking
are implemented identically in the gateway (canonical) and frontend (mirror) copies;
and a shared-fixture behavioral parity test proves the two copies have not drifted.
All feature tests pass across the three trees (discovery-service 17, gateway 35,
frontend 21 — 73 total). gateway and discovery-service typecheck clean (exit 0); the
frontend's large pre-existing `tsc` baseline is unchanged in its REAL-error
population (zero real type errors in any spec-touched production file). Scope was
respected: no AMS code, no save-back, and no agenda/gate UI were changed by this spec.

One honest nuance (not a defect): the spec's new gateway-style frontend unit test
(`resolveBulkActionSet.test.ts`) uses ambient `describe/it/expect` rather than
importing them from vitest, so it adds 57 `tsc` lines — all in the known
test-runner-global category (TS2582/TS2304), none real, and all suppressed at
runtime by `globals: true`. Detailed below.

---

## 1. Tasks Verification

**Status:** ✅ All Complete

All four task groups in `tasks.md` were already marked `- [x]` (every sub-task too).
Each was independently re-verified against the code and the feature tests — not taken
on faith. No checkbox required correction.

### Per-acceptance-criterion results

#### Task Group 1 — Expose raw edge graph + node `review_status` to both resolver inputs

| Acceptance criterion | Result | Evidence |
|---|---|---|
| 2–8 wire-shape tests pass | ✅ Pass | Gateway contract block: "exposes the new top-level `edges` array…", "exposes the new top-level `nodes` array…", snake_case manifest check — all green |
| Gateway `ReviewModelWire` + manifest carry `edges` (edge_kind/from_id/to_id/relationship_candidate_id) and `nodes` (id/review_status); manifest stays snake_case | ✅ Pass | `reviewModelWire.ts` `ReviewModelWire.edges/.nodes` (:245/:251); `REVIEW_MODEL_WIRE_FIELDS.model = ['blast_radius','findings','aggregations','edges','nodes']`, new `edge` + `node` manifest entries (:270/:278/:280) |
| `toResolverModel` forwards `edges` + `nodes` (no longer drops `edges`) | ✅ Pass | `reviewModelFull.ts:151-159` returns `edges: model.edges ?? []`, `nodes: model.nodes ?? []` |
| Frontend `ReviewModel` carries `edges` field-for-field | ✅ Pass | `discoveryApi.ts` `ReviewModel.edges?` (:498) reusing `ReviewModelEdge`/`ReviewModelEdgeKind` (:459/:390); `nodes` with `review_status` already present (:328) |
| No discovery-service compute pass; no precomputed referencer map (Decision 1) | ✅ Pass | Raw `edges` plumbed through; each mirror builds its own in-adjacency at resolve time (`referencersByNode`, both copies) |

#### Task Group 2 — Reject-only exclusivity (fixes gap 1)

| Acceptance criterion | Result | Evidence |
|---|---|---|
| 2–8 tests pass on BOTH mirrors with identical cases | ✅ Pass | Gateway + frontend each have the identical Group-2 block (shared-survives, all-rejected-pulled-in, already-persisted-rejected union, reject-only Approve, reject-only Defer, peer rule, cycle-safety, absence-tolerance) — name-for-name |
| Shared entity with a surviving referencer SURVIVES; pulled in only when ALL referencers ∈ {already-rejected ∪ this-action's rejects} | ✅ Pass | `isEligibleNow` + `allReferencersRejected` over `OWNED_BY_RELATIONSHIP_EDGE_KINDS`; `isInRejectSet = touched ∪ alreadyRejected`; tests green on both mirrors |
| `logical_data_entity_relationships` never pulls the far entity (covers logical AND physical) | ✅ Pass | `PEER_RELATIONSHIP_EDGE_KIND` excluded from owned-by set; `consider()` drops peer dependents; peer test asserts logical + physical (same edge kind) |
| Approve/Defer unchanged; logic is reject-only | ✅ Pass | `if (action === 'rejected') {…} else {…}`; the `else` branch is the verbatim pre-change BFS ("APPROVE / DEFER -- UNCHANGED") in both copies; reject-only Approve/Defer tests confirm full cascade |
| Walk stays pure + cycle-safe; output stable/deterministic | ✅ Pass | Monotone fixpoint bounded by `touched` visited-set; cycle test (`s1→s2→s3→s1`) terminates with a stable set |
| Two resolver copies byte-for-byte identical in changed regions | ✅ Pass | Full-file diff (below) shows only declared type seams + comments differ |

#### Task Group 3 — Relationship surfacing + marking (fixes gap 2)

| Acceptance criterion | Result | Evidence |
|---|---|---|
| 2–8 tests pass on BOTH mirrors with identical cases | ✅ Pass | Gateway + frontend Group-3 block: surface+mark+count, peer-row marking (logical+physical), reject-only Approve, reject-only Defer, absent/empty `relationship_candidate_id` guard |
| Every rejected node's referencing relationship-row candidate ids (via `relationship_candidate_id`) appear in resolved set + flat `candidate_ids[]`; "+N dropped" count correct | ✅ Pass | Step 2b scans `edges` for incident edges whose `edge_kind ∈ RELATIONSHIP_ROW_EDGE_KINDS`, adds `relationship_candidate_id` to `touched` → rides `candidates[]`; count tests green |
| Peer rows surfaced + marked even when far entity survives; physical-to-physical identical | ✅ Pass | Peer test: `entB` not in candidate set but `rel-AB` surfaced; asserts logical + physical instances |
| No AMS/DTO/changeset change; no save-back change — marking flows through existing atomic cascade endpoint | ✅ Pass | `candidateSaveBackService.ts` NOT modified; `discovery.ts` NOT modified; existing `candidates/bulk-review` proxy intact (Decision 4) |
| Two resolver copies byte-for-byte identical in changed regions | ✅ Pass | See mirror diff |

#### Task Group 4 — Behavioral parity guard + graph/blast-radius confirmation

| Acceptance criterion | Result | Evidence |
|---|---|---|
| All feature tests pass across the three trees | ✅ Pass | discovery-service 17/17, gateway 35/35, frontend 21/21 |
| Shared-fixture parity test diff-asserts IDENTICAL output from both resolvers | ✅ Pass | `rejectCascadeParityFixture.ts` (`PARITY_EXPECTED`) imported by BOTH `resolveBulkActionSet.parity.test.ts` halves; each `toEqual(PARITY_EXPECTED)` + flat-id assert; both green. Fixture exercises exclusivity + peer + cycle + Group-3 surfacing in one input |
| `buildReviewModel` still emits `edges` with `relationship_candidate_id` for every relationship-row kind; `toResolverModel` forwards `edges`+`nodes` | ✅ Pass | `buildReviewModel.ts:413-423` (`relationship_candidate_id: rel.id`); graph test's +4 gap-fill pins endpoint_data_effects / data_movements / logical_data_entity_relationships + a mixed-model "EVERY relationship-row edge carries a non-empty id" test |
| ≤ ~10 additional tests when filling gaps | ✅ Pass | discovery-service graph test: +128 lines, tests ADDED only (0 removed) — within budget |

---

## 2. Documentation Verification

**Status:** ⚠️ Issues Found (non-blocking)

### Implementation Documentation

The spec's `implementation/` directory exists but is **EMPTY** — no per-task-group
implementation reports were written (`implementation/1-…`, `2-…`, etc. are absent).

This does NOT affect the correctness of the implementation, which is fully verified
directly against the code and the passing feature tests. It is noted only for
record-keeping completeness. The in-code documentation is unusually thorough
(extensive module + algorithm-step doc-comments in both resolver copies and the
shared fixture), which substantially mitigates the missing standalone reports.

### Verification Documentation

This report (`verifications/final-verification.md`).

### Missing Documentation

- `implementation/1-wire-extension-implementation.md` (and groups 2–4) — not present.

---

## 3. Roadmap Updates

**Status:** ✅ No Updates Needed

`agent-os/product/roadmap.md` does not exist in this repo (product roadmap tracking
is maintained in user auto-memory, e.g. the discovery-review-unification program /
oracle-perfection roadmap notes, not a checked-in roadmap file). This spec is a
correctness fix to the shared `resolveBulkActionSet` resolver underpinning the
discovery review surfaces; it is the foundation Spec 4 (agenda/gate UI) builds on. No
checked-in roadmap item required marking.

---

## 4. Test Suite Results

**Status:** ✅ All Passing (feature-scoped, per instruction — the full application
suite was deliberately NOT run)

### Test Summary (feature tests actually executed)

- **Total Tests:** 73
- **Passing:** 73
- **Failing:** 0
- **Errors:** 0

| Tree | Suite(s) | Result |
|---|---|---|
| discovery-service | `reviewModel.graph.test.ts` + `reviewModel.blastRadius.test.ts` | 17 passed / 17 |
| gateway | `resolveBulkActionSet.test.ts` + `resolveBulkActionSet.parity.test.ts` + `reviewEngine.test.ts` | 35 passed / 35 |
| frontend | `resolveBulkActionSet.test.ts` + `resolveBulkActionSet.parity.test.ts` + `DiscoveryCandidateTable.bulkCascade.test.tsx` + `BulkCandidateActionConfirmModal.test.tsx` | 21 passed / 21 |

Breakdown of the frontend 21: resolver unit 13, parity 1, bulkCascade 4, modal 3.
The gateway 35 includes the original cascade-resolution + wire-shape contract blocks
(extended, not replaced) PLUS the new Group-2 (8) and Group-3 (5) blocks and the
parity (1) + reviewEngine (7) suites.

### Failed Tests

None — all feature tests passing.

### Notes

- Per the verification brief, the full application test suite was NOT run; only this
  spec's feature tests were executed across the three trees.
- The conversational confirm-gate surface is genuinely covered: `reviewTools.ts:185`
  calls `resolveBulkActionSet({ seedCandidateIds, action }, toResolverModel(model))`,
  so the fix reaches BOTH the conversational gate (via `reviewTools` → `toResolverModel`)
  and the grid (via `DiscoveryCandidateTable.tsx` → frontend mirror). `reviewEngine.test.ts`
  (7 passing) exercises the conversational path end-to-end.

---

## 5. Mirror Equality (byte-for-byte diff)

**Status:** ✅ Confirmed — only the declared type seams differ.

A full-file `diff` of the two resolver copies
(`gateway/src/services/discovery/resolveBulkActionSet.ts` vs
`frontend/src/components/Discovery/resolveBulkActionSet.ts`) yields differences in
EXACTLY these declared-seam regions and **nothing in the executable algorithm body**:

1. **Header doc-comment** — canonical-home framing (gateway) vs mirror framing
   (frontend). Documentation only.
2. **Imports** — gateway: `{ BulkReviewAction, EdgeKind, ReviewModelEdge, ReviewModelWire }`
   from `./reviewModelWire`; frontend: `{ ReviewModel, ReviewModelEdge, ReviewModelEdgeKind }`
   from `../../api/discoveryApi`.
3. **Edge-kind alias line** — `type ResolverEdgeKind = EdgeKind` vs
   `type ResolverEdgeKind = ReviewModelEdgeKind` (the single declared type-binding seam).
4. **`BulkReviewAction`** — gateway imports it; frontend declares it locally
   (`export type BulkReviewAction = 'approved' | 'rejected' | 'deferred'`).
5. **Two exported-interface type annotations** — `via_edge_kind: EdgeKind | null` vs
   `via_edge_kind: ReviewModelEdgeKind | null` (consequence of seam 3).
6. **Param type** — `reviewModel: ReviewModelWire` vs `reviewModel: ReviewModel`.
7. **A handful of comment-only differences** (section headers like
   "Implementation" vs "Implementation (byte-for-byte mirror…)"; the seed-source
   doc line "or the coordinator's targeted ids" present only gatewayside).

Every line of the algorithm itself — the in-adjacency build (`referencersByNode`),
`alreadyRejected` seeding, `isInRejectSet`, `allReferencersRejected`, `isEligibleNow`,
the `consider`/`admit` fixpoint, the Group-3 surfacing loop, the finding join, and the
counts — is **identical text** in both files. The diff result matches the spec's
declared seam list exactly. The shared-fixture parity test provides the runtime proof
that these textually-identical bodies also behave identically.

---

## 6. Typecheck Results

**Status:** ✅ As expected (gateway + discovery-service clean; frontend baseline
correctly accounted for)

| Tree | `tsc --noEmit` exit | Real type errors from this spec |
|---|---|---|
| gateway | **0 (CLEAN)** | 0 |
| discovery-service | **0 (CLEAN)** | 0 |
| frontend | 2 (pre-existing baseline) | **0 real** (see below) |

### Frontend baseline analysis (handled honestly)

The frontend `tsc` reports **511** `error TS` lines — within the stated ~454–511
pre-existing baseline on `master`. Decomposition:

- **453** errors are the "real" pre-existing population (unrelated production modules
  + test-runner globals in OTHER files). **NONE** are in any file this spec touched.
- **57** errors are test-runner-global noise (`TS2304 Cannot find name 'expect'` ×42 +
  `TS2582 Cannot find name 'describe'/'it'` ×15), and they all come from a SINGLE
  file: this spec's `frontend/src/components/Discovery/resolveBulkActionSet.test.ts`.

**Spec-touched production files are type-clean:**
- `frontend/src/components/Discovery/resolveBulkActionSet.ts` — 0 errors.
- `frontend/src/api/discoveryApi.ts` (the `edges` field addition) — 0 errors.
- `gateway/src/services/discovery/__tests__/rejectCascadeParityFixture.ts` — 0 errors.
- `frontend/src/components/Discovery/resolveBulkActionSet.parity.test.ts` — 0 errors
  (it imports `describe, it, expect` from vitest explicitly).

**Honest nuance:** the implementer's "net-zero" claim is true for REAL type errors —
zero new real type errors in any production file. However, this spec's new unit test
`resolveBulkActionSet.test.ts` DOES raise the raw `tsc` line count by 57 versus the
master baseline, because it follows the older gateway-style convention of using
ambient `describe/it/expect` instead of importing them. These 57 are 100%
test-runner-global category (confirmed: the file's only error codes are TS2304 and
TS2582), they are suppressed at runtime by `globals: true` in `frontend/vite.config.ts`
(which is why the suite passes), and they are exactly the baseline pattern the
verification brief flagged. This is a cosmetic lint-hygiene observation, not a
functional or type-safety defect. (A trivial future cleanup would add
`import { describe, it, expect } from 'vitest';` to that one file, matching the parity
test.)

---

## 7. Scope Adherence

**Status:** ✅ Confirmed clean.

| Scope boundary | Result | Evidence |
|---|---|---|
| NO AMS code changed by this spec | ✅ Confirmed | The AMS files dirty in the working tree (`DiscoveryCascadeReviewService.java`, `CascadeBulkReviewTest.java`) are an unrelated **architecture-scoped cascade-review** change (run→architecture scope verification) from a DIFFERENT in-flight workstream — its diff has nothing to do with the resolver/wire/edges work. No reject-cascade change touches AMS. |
| NO save-back change (`candidateSaveBackService.ts`) | ✅ Confirmed | Not in `git status` — untouched. |
| NO agenda/gate UI change (that's Spec 4) | ✅ Confirmed | Neither `DiscoveryCandidateTable.tsx` nor `BulkCandidateActionConfirmModal.tsx` production components modified; no agenda/Review-Room UI files changed by this spec. |
| Existing wire-shape contract test EXTENDED, not replaced | ✅ Confirmed | `resolveBulkActionSet.test.ts` diff = +643 / −18; the 18 removals are in-place comment/assertion edits within retained tests (e.g. the seed-only test retitled to "…(plus its referencing relationship row)"), not test-case deletions. Original "cascade resolution" + "wire-shape contract" blocks remain and pass. |
| No new endpoint / DTO / changeset (Decision 4) | ✅ Confirmed | `gateway/src/routes/discovery.ts` untouched; existing `candidates/bulk-review` + `bulk-review-cascade` proxies intact. |

> NOTE on a dirty working tree: the repo currently has uncommitted changes from
> SEVERAL concurrent specs (an `api-migration-validation-service` capture-session
> change, an architect-conversation change, the architecture-scoped AMS cascade
> change, etc.). Scope adherence above is asserted for the **reject-cascade-correctness
> files specifically** — the two resolvers, `reviewModelWire.ts`, `reviewModelFull.ts`,
> the `discoveryApi.ts` edges field, the gateway contract/parity tests + fixture, the
> frontend unit/parity tests, and the `reviewModel.graph.test.ts` gap-fill. None of
> those is AMS, save-back, or agenda/gate UI.

---

## 8. Confirmed-Decision Fidelity (spot-check)

| Decision | Reflected in code? | Evidence |
|---|---|---|
| 1. Referencer exposure = raw `edges` array; each mirror builds own in-adjacency; no precomputed map / compute pass | ✅ | `ReviewModelWire.edges` + frontend `ReviewModel.edges`; `referencersByNode` built per-resolve in both copies; no discovery-service compute pass added |
| 2. Peer relationships: surface + mark the row, NEVER reject the far entity | ✅ | `PEER_RELATIONSHIP_EDGE_KIND` excluded from owned-by; `consider()` drops peer dependents; Group-3 still surfaces the peer row |
| Physical symmetry: no separate `physical_data_entity_relationships` edge kind; folds into `logical_data_entity_relationships` | ✅ | Verified `buildReviewModel.ts:319-335` ("BOTH logical-to-logical AND physical-to-physical land on this type"; `resolveName('logical_data_entities',…) ?? resolvePhysicalEntityByName(…)` on both sides); `EdgeKind` (types.ts:80-87) lists no physical equivalent. Finding is stated verbatim in both resolver copies' `PEER_RELATIONSHIP_EDGE_KIND` doc-comment |
| 3. Reject-only — Approve/Defer unchanged | ✅ | `if (action === 'rejected')` gate; verbatim pre-change BFS in the `else` branch of both copies; reject-only Approve/Defer tests green |
| 4. Mark dropped rows `rejected` via the EXISTING atomic cascade endpoint; same status as a user reject; no new AMS | ✅ | Surfaced row ids ride `candidates[]` → flat `candidate_ids[]`; `discovery.ts` + `candidateSaveBackService.ts` untouched |
| 5. Shared-fixture behavioral parity test added; wire-shape contract test stays | ✅ | `rejectCascadeParityFixture.ts` + both `*.parity.test.ts`; contract test extended in place (kept) |
| 6. Leave `would_be_orphaned_parent_ids` as-is | ✅ | Field retained in `reviewModelWire.ts:168` and `discoveryApi.ts:426`; resolver never reads it |

---

## 9. Genuine Gaps / Risks

1. **Missing implementation reports (documentation only).** The `implementation/`
   directory is empty — no per-task-group `*-implementation.md` files. Non-blocking
   for correctness (verified directly against code + tests; in-code docs are
   thorough), but worth back-filling for process completeness.

2. **One spec test file adds 57 test-global `tsc` lines (cosmetic).** Adding
   `import { describe, it, expect } from 'vitest';` to
   `frontend/src/components/Discovery/resolveBulkActionSet.test.ts` (as the parity
   test already does) would zero them out and make the frontend `tsc` delta literally
   net-zero rather than net-zero-after-classifying-the-noise. No runtime impact.

3. **Verification ran feature tests only (by instruction).** The full application
   suite was not run, so any cross-cutting regression OUTSIDE the touched resolver /
   wire surface is out of this report's scope. Given the change is additive plumbing +
   a reject-only branch (Approve/Defer provably unchanged, absence-tolerant degrade),
   regression risk to untested surfaces is low, but not zero-by-proof here.

4. **Dirty multi-spec working tree.** Several unrelated specs are uncommitted
   alongside this one. Scope-adherence was asserted file-by-file for the
   reject-cascade changes; a reviewer committing this spec should stage ONLY the
   reject-cascade files and leave the AMS / capture-session / architect-conversation
   changes to their own commits.

---

## Top-Level Verdict

**✅ PASSED.** Reject-cascade-correctness is correctly and completely implemented to
spec. The two resolver mirrors are byte-for-byte identical in the algorithm body
(only declared type seams differ) and proven behaviorally identical by the
shared-fixture parity test. All 73 feature tests pass; gateway + discovery-service
typecheck clean; the frontend's pre-existing `tsc` baseline is unchanged in its real
population with zero real type errors in any spec-touched production file. All six
confirmed decisions and the physical-symmetry finding are reflected in code, and the
declared out-of-scope areas (AMS, save-back, agenda/gate UI) were not touched. The
only issues are documentation/hygiene (empty implementation reports; one test file's
57 ambient-global `tsc` lines) — neither affects functional correctness.
