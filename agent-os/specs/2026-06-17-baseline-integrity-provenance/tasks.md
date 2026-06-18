# Task Breakdown: Baseline Integrity & Provenance

## Overview
Total Tasks: 4 task groups

This is Spec C of a 3-spec series (A = oracle coverage scoring [changeset 189], B = reconcile
full-response fidelity [changeset 190], C = this). A and B are already built on disk; this spec
only READS their outputs. Build order within this spec is strictly bottom-up:
AMS (the bulk) → validation-service reconcile consumer → frontend surface → cross-layer test review.

Authoritative constraints: `planning/requirements.md` "Resolved Clarifications" R1–R8 are binding.
Hashing AND verification are SERVER-SIDE (Java/AMS) only — there is NO TS↔Java hash
reimplementation and NO cross-language parity test (R4). Scope is current-state oracle baselines
only (`kind = 'current'`); target baselines are out of scope (R8).

## Task List

### AMS Layer (Java / Spring / Postgres)

#### Task Group 1: Columns, entity/DTO/mapper, hash + provenance stamping at activate, and verify endpoint
**Dependencies:** None (Spec A changeset 189 and Spec B changeset 190 already on disk)

This is the bulk of the spec. It covers the schema migration, the entity/DTO/mapper threading, the
server-side stamping at the draft→active transition, and the server-side verify operation.

- [x] 1.0 Complete the AMS integrity + provenance layer
  - [x] 1.1 Write 2-8 focused AMS tests (write first; they will pass by end of group)
    - Limit to 2-8 highly focused tests maximum; cover only critical behaviours below
    - Hash determinism + canonical-form stability: same item set (in any insertion order, with
      JSON object keys in any order) produces the identical `content_hash`; reordering items by
      anything other than the stable key `(method, path, scenario_name)` does not change the hash
    - Stamp-at-activate: a draft→active PATCH stamps both `content_hash` and `provenance_json` on
      the header; a draft baseline carries NEITHER (null hash, null provenance)
    - Verify endpoint: returns `integrity_verified: true` for an untampered active baseline;
      returns `integrity_verified: false` after an item is tampered (mismatch); returns the
      neutral null-hash result (`content_hash: null`) for a pre-existing baseline with no recorded
      hash
    - snake_case wire: the verify response serializes `content_hash` / `recomputed_hash` /
      `integrity_verified` in snake_case (no `@CamelCaseWire`)
    - Current-only: a `kind='target'` baseline transition does NOT stamp a hash/provenance
    - Skip exhaustive coverage of all transition permutations and edge cases
  - [x] 1.2 Create Liquibase changeset `191-baseline-content-hash-provenance.sql`
    - VERIFY next-free at build time: 187/188/189/190 are the highest on disk — expect 191 (do not
      assume; confirm before writing)
    - Add two NULLABLE columns to `api_behaviour_baselines` HEADER: `content_hash` (TEXT) and
      `provenance_json` (JSONB)
    - Use the `not.columnExists` precondition idiom and `COMMENT ON COLUMN`, mirroring changesets
      187 / 189; NEVER edit an already-applied changeset
    - In the changeset COMMENT state explicitly: `content_hash` null = pre-existing /
      never-activated baseline (NO backfill); and that `volatile_paths_json` is PINNED CONTENT
      inside the hash but this is SEPARATE from reconcile-time volatile TOLERANCE
    - Register the changeset AFTER 190 in `db.changelog-master.yaml`
  - [x] 1.3 Thread the new fields through `ApiBehaviourBaselineEntity`
    - Add `contentHash` (String, reference type — no primitive-wipe risk) mapped to `content_hash`
    - Add `provenanceJson` (`Map<String,Object>`) mapped to `provenance_json`, following the
      sibling JSONB column pattern (`@Type(JsonType.class)`)
  - [x] 1.4 Extend `ApiBehaviourBaselineDto` and `ApiBehaviourMapper.toDto`
    - Add `contentHash` (String) and `provenanceJson` (`Map<String,Object>`) to the record
    - Extend the existing backward-compatible delegating constructor chain (mirror the current
      11-arg → 13-arg pattern; add a 13-arg → 15-arg delegation so existing call sites compile
      unchanged with null hash/provenance)
    - Map both new fields in `ApiBehaviourMapper.toDto`
    - No `@CamelCaseWire` — these are snake_case consumers (validation-service + frontend)
  - [x] 1.5 Implement the canonical content form + SHA-256 hash (server-side, Java)
    - Reuse `UserJourneyDiagramHashUtil` (canonical Jackson serialize with
      `ORDER_MAP_ENTRIES_BY_KEYS` + `SORT_PROPERTIES_ALPHABETICALLY`, `MessageDigest` SHA-256,
      lowercase-hex `bytesToHex`); do NOT add a new crypto dependency
    - Per item the hashed content = `method`, `path`, `scenario_name`, `request_json`,
      `response_status`, `response_json`, `volatile_paths_json` (take whatever `{headers, body}`
      envelope shape Spec B left on `response_json` as-is)
    - Items sorted by the stable key `(method, path, scenario_name)`; JSON object keys sorted
      recursively; UTF-8 encoding; tag `canonical_version: 1`
    - Add code comments documenting the canonical form precisely AND the volatile pinning vs
      reconcile-time tolerance distinction (the hash records declared volatile paths but does NOT
      change `expected_volatile` / diff behaviour)
  - [x] 1.6 Stamp hash + provenance at the draft→active ACTIVATE transition
    - Hook into `ApiBehaviourBaselineService.update()` at the existing draft→active detection point
      (~:224-227 where `traceBaselineActivated` fires), inside the SAME `@Transactional` method,
      before the DTO is returned
    - Read the baseline's OWN items via the item repository (items are already persisted by the
      frontend draft flow), build the canonical serialization, compute the hash, and write
      `content_hash` onto the header
    - Assemble `provenance_json` = `{ session_id, environment_name, activated_at (server time at
      the transition), coverage_score, coverage_summary (or compact ref), accepted_capture_count,
      operation_count, hash_algo: "sha256", canonical_version: 1 }`
    - Reuse existing header fields for `session_id`, `accepted_capture_count`, `operation_count`;
      read `environment_name`, `coverage_score`, `coverage_summary` from the capture session via
      the baseline's `session_id` (`ApiBehaviourCaptureSessionEntity.getEnvironmentName` +
      `coverageSummaryJson`)
    - `coverage_score` = Spec A's `overall_score` from `coverage_summary_json.overall_score`; do
      NOT use `in_scope_coverage_pct`. If `coverage_summary_json` is null, record
      `coverage_score: null` and omit/null the summary — never fabricate
    - Stamp ONLY for `kind='current'` baselines; do NOT stamp `kind='target'`
    - Draft baselines remain unstamped and mutable (stamping happens only on transition INTO active)
  - [x] 1.7 Add the server-side verify operation
    - Add `GET /api/projects/{projectId}/api-behaviour/baselines/{baselineId}/integrity`, mirroring
      the `ApiBehaviourBaselineController` `@GetMapping("/{baselineId}/...")` pattern
    - Recompute the hash over the CURRENT stored items using the IDENTICAL canonical form from 1.5
      and return `{ content_hash, recomputed_hash, integrity_verified }` (snake_case wire, no
      `@CamelCaseWire`)
    - `integrity_verified` = `content_hash != null && content_hash == recomputed_hash`
    - When `content_hash` is null (pre-existing / never-activated), return a neutral result
      (`content_hash: null`, `integrity_verified: false`) for the consumer to treat as "no hash
      recorded", NOT a mismatch
  - [x] 1.8 Ensure AMS layer tests pass + no lifecycle regression
    - Compile AMS (`mvn -q compile` or module build) successfully
    - Run ONLY the 2-8 tests written in 1.1
    - Verify the new migration runs successfully against the test schema
    - No-regression check: the draft/active/archived transition rules, the kind/pairing invariant,
      and `traceBaselineActivated` behaviour are unchanged; integrity never mutates pinned content
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass; AMS compiles
- Changeset 191 (verified next-free) adds both nullable columns with `not.columnExists` +
  `COMMENT ON COLUMN`, registered after 190; no applied changeset edited
- `content_hash` + `provenance_json` thread through entity, DTO (delegating ctor), and mapper in
  snake_case
- Hash + provenance are stamped only at draft→active, only for `kind='current'`, in the activation
  transaction; drafts carry neither
- `coverage_score` is Spec A's `overall_score` (null-safe when the session summary is null)
- The verify endpoint recomputes server-side and returns the correct verified / mismatch /
  null-hash-neutral verdict in snake_case
- Baseline lifecycle, immutability, and kind/pairing invariant are not regressed

### validation-service Layer (Node / TypeScript)

#### Task Group 2: Reconcile consumes the integrity verdict (advisory, non-blocking)
**Dependencies:** Task Group 1 (the AMS verify endpoint + DTO fields)

- [x] 2.0 Consume the AMS integrity verdict at reconcile time
  - [x] 2.1 Write 2-8 focused validation-service tests (write first)
    - Limit to 2-8 highly focused tests maximum
    - On `integrity_verified === false` (with a non-null `content_hash`) a VISIBLE advisory
      integrity-warning finding is emitted AND the reconcile PROCEEDS (never blocks)
    - When the source baseline has no recorded hash (null `content_hash`), verification is SKIPPED:
      no finding, not a mismatch (neutral)
    - A verify-call error (AMS unreachable / error response) does NOT fail the reconcile (fail-soft)
    - On `integrity_verified === true` no integrity finding is emitted and reconcile proceeds
      normally
    - Skip exhaustive coverage of all finding permutations
  - [x] 2.2 Add `getBaselineIntegrity` to `archModelClient.ts`
    - New client method calling the AMS `GET .../baselines/{id}/integrity` endpoint; mirror the
      existing `getBaseline` / `listBaselineItems` endpoint shape and `toClientError` handling
    - Type the result `{ content_hash, recomputed_hash, integrity_verified }` (snake_case)
    - Add `content_hash` and `provenance_json` to the baseline DTO type (`BaselineDto`, snake_case)
  - [x] 2.3 Call verify at source/oracle load in `diffRunner.ts`
    - After loading the source/oracle baseline (`diff.source_baseline_id`, ~:379-394 where
      `getBaseline` / `listBaselineItems` run), call `getBaselineIntegrity`
    - The TS path CONSUMES the verdict and does NOT recompute the hash itself
    - On `integrity_verified === false` (non-null `content_hash`) emit the advisory integrity
      warning and PROCEED; skip verification (no finding) when the source baseline has no hash
    - Follow the existing fail-soft finding-emission pattern (`createDiffFinding`, the
      recompute-cleanup ordering / `deleteFindingsByApiBehaviourDiffId`, per-item try/catch) and
      the trace `detail` / `step` idioms already in `diffRunner.ts`; a verify-call error must not
      fail the reconcile
  - [x] 2.4 Ensure validation-service tests pass + no reconcile regression
    - `npx tsc --noEmit` is clean
    - Run the FULL `npx jest` suite (currently 308 pass / 1 skip after Spec B — it MUST stay green)
    - No-regression check: existing reconcile classification + finding emission are unchanged; the
      integrity finding is purely additive and advisory

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass; `tsc --noEmit` is clean
- FULL jest suite stays green at 308 pass / 1 skip (plus the newly added tests)
- A tampered/drifted oracle (`integrity_verified === false`) emits a visible advisory finding and
  the reconcile still completes
- Pre-existing null-hash baselines skip verification with no false mismatch
- A verify-call failure never fails the reconcile (fail-soft); existing reconcile behaviour is not
  regressed

### Frontend Layer (React / TypeScript)

#### Task Group 3: Surface integrity, provenance, and coverage in the baseline view
**Dependencies:** Task Group 1 (AMS verify endpoint + DTO fields); Task Group 2 not required

- [x] 3.0 Surface integrity + provenance + coverage on `BaselineDetailView.tsx`
  - [x] 3.1 Write 2-8 focused frontend tests (write first)
    - Limit to 2-8 highly focused tests maximum
    - Integrity badge renders "verified" when the verify result is `integrity_verified: true`
    - Integrity badge renders the red "mismatch" state when `integrity_verified: false` with a
      non-null `content_hash`
    - Integrity badge renders the neutral "no integrity hash recorded" state when `content_hash`
      is null
    - Provenance rows (environment, activated_at, capture counts) and the coverage score render
      from `provenance_json`
    - Skip exhaustive coverage of all render permutations
  - [x] 3.2 Add `content_hash` and `provenance_json` to the frontend baseline API type
    - Extend the `ApiBehaviourBaselineDto` (snake_case) in the frontend baseline API module
      (`apiBehaviourClient.ts`)
    - Add a client method to call the AMS verify endpoint for the displayed baseline
  - [x] 3.3 Render integrity + provenance + coverage in the Summary section
    - In `BaselineDetailView.tsx`'s Summary section (the existing `operation_count` /
      `accepted_capture_count` / `session_id` rows), show: the content hash (or "no integrity hash
      recorded" when null), provenance (environment, activated_at, capture counts), and the
      coverage score (from `provenance_json`)
    - Add an integrity badge: verified / mismatch (red) / "no hash recorded" (neutral), reusing the
      existing `statusBadge` styling pattern; the badge consumes the AMS verify operation for the
      displayed baseline
    - Surface ONLY on current-state (`kind='current'`) baselines; target baselines are out of scope
  - [x] 3.4 Ensure frontend tests pass + no view regression
    - Changed-file typecheck on the edited frontend files (the repo has ~515 pre-existing unrelated
      tsc errors — verify the CHANGED files introduce no NEW errors; do not attempt a clean
      whole-repo typecheck)
    - Run ONLY the focused vitest tests written in 3.1
    - No-regression check: the existing baseline-detail header + items rendering is unchanged;
      integrity/provenance is additive

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass; changed files introduce no new tsc errors
- Content hash, provenance (environment, activated_at, counts), and coverage score are visible on
  current-state baselines
- The integrity badge shows verified / mismatch (red) / "no hash recorded" (neutral), reusing
  `statusBadge` styling
- Target baselines are not surfaced; existing baseline-detail rendering is not regressed

### Cross-Layer Testing

#### Task Group 4: Test review & critical gap analysis
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 2-8 AMS tests (Task 1.1), the 2-8 validation-service tests (Task 2.1), and the
      2-8 frontend tests (Task 3.1) — approximately 6-24 existing tests
  - [x] 4.2 Analyze coverage gaps for THIS feature only
    - Identify critical end-to-end / integration behaviours of this spec that lack coverage
    - Focus ONLY on this spec's requirements; do NOT assess whole-application coverage
    - Candidate gaps to confirm are covered (add a test only if a genuine gap exists):
      - Hash determinism + canonical-form stability (insertion order / JSON key order independence)
      - Stamp-only-at-activate (a draft has no hash; the hash appears exactly on transition INTO
        active)
      - Tamper → mismatch detected by the verify endpoint
      - Advisory-not-blocking at reconcile (mismatch emits a finding, reconcile still completes)
      - Null-hash baseline = neutral (no false mismatch) at both verify and reconcile
      - Coverage score embedded from Spec A (`overall_score`, null-safe)
      - Current-only (a `kind='target'` baseline is never stamped/surfaced)
  - [x] 4.3 Write up to 10 additional strategic tests MAXIMUM (only if gaps exist)
    - Add a maximum of 10 new tests, focused on the integration points and behaviours above
    - Do NOT write comprehensive coverage for all scenarios; skip edge/performance/accessibility
      tests unless business-critical
  - [x] 4.4 Run feature-specific tests only + final no-regression check
    - Run ONLY the tests related to this spec (from 1.1, 2.1, 3.1, and 4.3) per layer
    - Re-confirm the validation-service FULL jest suite remains green (308 pass / 1 skip baseline
      plus this spec's additions)
    - Final no-regression check across layers: baseline lifecycle / immutability, kind/pairing
      invariant, and existing reconcile classification + finding emission are all intact; the
      integrity signal is advisory, visible, and never silent
    - Do NOT run the entire application test suite

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 16-34 tests total)
- Critical behaviours (determinism, stamp-at-activate, tamper detection, advisory-not-blocking,
  null-hash-neutral, coverage-from-Spec-A, current-only) are covered
- No more than 10 additional tests added when filling gaps
- No regression of baseline lifecycle / immutability or existing reconcile behaviour

## Execution Order

Recommended implementation sequence (strictly bottom-up, mirroring the determinism + Spec A/B
ordering):
1. AMS Layer — columns, entity/DTO/mapper, stamp-at-activate, verify endpoint (Task Group 1)
2. validation-service — reconcile consumes the verdict (Task Group 2)
3. Frontend — baseline-view surfacing (Task Group 3)
4. Cross-layer test review & gap analysis (Task Group 4)
