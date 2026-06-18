# Specification: Baseline Integrity & Provenance

## Goal
Make the pinned current-state API-behaviour baseline (the oracle) tamper-EVIDENT and auditable by stamping it server-side at activation with a deterministic content hash plus a provenance record (including Spec A's coverage score), and surfacing a verified / mismatch / "no hash recorded" integrity status at reconcile time and in the baseline view.

## User Stories
- As a migration reviewer, I want to see at a glance how a pinned oracle was produced (capture session, environment, when it was activated, coverage score, capture counts) so I can judge its trustworthiness before relying on a reconcile result.
- As a migration engineer, I want a tampered or drifted oracle to raise a visible integrity warning during reconcile (without blocking the run) so silent corruption of the trust anchor can never go unnoticed.

## Specific Requirements

**AMS columns + Liquibase changeset 191**
- Add two nullable columns to the `api_behaviour_baselines` HEADER: `content_hash` (TEXT, nullable) and `provenance_json` (JSONB, nullable).
- One NEW changeset (`191-baseline-content-hash-provenance.sql`); VERIFY next-free at build time (187/188/189/190 on disk now — expect 191) and register AFTER 190 in `db.changelog-master.yaml`.
- Use the `not.columnExists` precondition idiom and `COMMENT ON COLUMN`, mirroring 187 / 189; never edit applied changesets.
- `content_hash` null = pre-existing or never-activated baseline (NO backfill). `provenance_json` follows the sibling JSONB column pattern (`@Type(JsonType.class)`, `Map<String,Object>`).
- Add the fields to `ApiBehaviourBaselineEntity` (reference types, no primitive-wipe risk), extend `ApiBehaviourBaselineDto` via a backward-compatible delegating constructor (mirror the existing 11-arg→13-arg chain), and map both in `ApiBehaviourMapper.toDto`.

**Server-side hash + provenance stamping at draft→active activate (R1+R2)**
- Compute and stamp ENTIRELY in AMS (Java), in `ApiBehaviourBaselineService.update()` at the existing draft→active detection point (~lines 224-227 where `traceBaselineActivated` fires), in the SAME transaction as the activation.
- At activate, baseline items are already persisted by the frontend draft flow; AMS reads its own items (via the item repository), canonical-serializes, SHA-256-hashes, and writes `content_hash` + `provenance_json` onto the header.
- Draft baselines carry NO hash and NO provenance (still mutable); stamping happens only on transition INTO active.
- A client-/frontend-computed hash is explicitly rejected as not a trust boundary; the server that owns the immutable data is the only legitimate hasher.
- Reuse an existing AMS SHA-256 util (`UserJourneyDiagramHashUtil` canonical-mapper + `MessageDigest` pattern, or `MissingInputKeyHasher`) for the digest; do not introduce a new crypto dependency.

**Canonical content form (R6, `canonical_version: 1`)**
- Per item the hashed content = `method`, `path`, `scenario_name`, `request_json`, `response_status`, `response_json`, and `volatile_paths_json` (whatever `{headers, body}` envelope shape Spec B left on `response_json` is covered as-is).
- Items are sorted by the stable key `(method, path, scenario_name)`; JSON object keys are sorted recursively; UTF-8 encoding; SHA-256 lowercase hex.
- `volatile_paths_json` IS part of the hash: the declared volatile envelope is PINNED CONTENT, so changing which paths are flagged volatile changes the oracle and must be tamper-evident.
- This pinning is SEPARATE from reconcile-time volatile TOLERANCE: the hash records the declared paths but does NOT change `expected_volatile` / diff behaviour. State this distinction explicitly in code comments + the changeset comment.
- Document the canonical form precisely and tag it `canonical_version: 1` (carried into provenance) so a future format change is detectable.

**Provenance record contents (R3+R5)**
- `provenance_json` = `{ session_id, environment_name, activated_at, coverage_score, coverage_summary (or a compact ref), accepted_capture_count, operation_count, hash_algo: "sha256", canonical_version: 1 }`.
- `activated_at` is server time at the activate transition. Reuse existing header fields for `session_id`, `accepted_capture_count`, `operation_count`.
- `environment_name`, `coverage_score`, and `coverage_summary` are read from the capture session via the baseline's `session_id` (the session carries `environment_name` and Spec A's `coverage_summary_json`).
- `coverage_score` is Spec A's `overall_score` from `coverage_summary_json`; do NOT use `in_scope_coverage_pct` (inventory reconciliation, a different number).
- If the session's `coverage_summary_json` is null (legacy / not recorded), record `coverage_score: null` and omit/null the summary — never fabricate.

**Server-side verify operation in AMS (R4)**
- Add an explicit `GET /api/projects/{projectId}/api-behaviour/baselines/{baselineId}/integrity` operation (preferred over an `integrity` block on every `getBaseline`, to avoid recompute on list reads).
- It recomputes the hash over the CURRENT stored items using the identical canonical form and returns `{ content_hash, recomputed_hash, integrity_verified: boolean }` (snake_case wire, no `@CamelCaseWire`).
- `integrity_verified` = `content_hash != null && content_hash == recomputed_hash`. When `content_hash` is null (pre-existing / never-activated), return a neutral result (e.g. `content_hash: null`, `integrity_verified: false` with the consumer treating null-hash as "no hash recorded", NOT a mismatch).
- Verification is ALSO server-side; there is NO TS↔Java hash reimplementation and NO cross-language parity test — one hashing implementation (Java) eliminates canonical-serialization drift.

**TS reconcile consumes the verdict (R4+R7)**
- In `diffRunner.ts`, after loading the source/oracle baseline (`diff.source_baseline_id`), call the new AMS verify operation via a new `archModelClient` method; the TS path CONSUMES the verdict and does NOT recompute the hash itself.
- On `integrity_verified === false` (with a non-null `content_hash`) emit a VISIBLE integrity warning finding and PROCEED (advisory — never blocks the reconcile).
- When the source baseline has no hash recorded, SKIP verification (neutral, no finding, not a mismatch).
- Follow the existing fail-soft finding-emission pattern (`createDiffFinding`, the recompute-cleanup ordering) and the trace `detail`/`step` idioms already in `diffRunner.ts`; a verify-call error must not fail the reconcile.

**Frontend baseline-view surfacing (R3+R7)**
- Add `content_hash` and `provenance_json` to the frontend `ApiBehaviourBaselineDto` (snake_case) and surface them in `BaselineDetailView.tsx`'s Summary section (the existing `operation_count` / `accepted_capture_count` / `session_id` rows).
- Show the content hash (or "no integrity hash recorded" when null), provenance (environment, activated_at, capture counts), and the coverage score.
- Show an integrity badge: verified / mismatch (red) / "no hash recorded" (neutral) — reuse the existing `statusBadge` styling pattern in the view; the badge consumes the AMS verify operation for the displayed baseline.
- Surface only on current-state (`kind='current'`) baselines; target baselines are out of scope.

**Preserve lifecycle, immutability, and the oracle invariant**
- Do NOT regress the draft/active/archived transition rules, the kind/pairing invariant, or existing reconcile classification + finding emission.
- Integrity is tamper-EVIDENCE layered on top of existing immutability-by-no-mutation-path; it never mutates pinned content.
- The mismatch signal must always be advisory, visible, and never silent.

## Existing Code to Leverage

**`UserJourneyDiagramHashUtil.java` / `MissingInputKeyHasher.java` (AMS SHA-256)**
- `UserJourneyDiagramHashUtil.computeCanonicalHash` already does Jackson canonical serialization (`ORDER_MAP_ENTRIES_BY_KEYS`, `SORT_PROPERTIES_ALPHABETICALLY`) + `MessageDigest.getInstance("SHA-256")` + lowercase-hex.
- Reuse this canonical-mapper + digest + `bytesToHex` pattern for the baseline content hash; do not add a new crypto util.

**`ApiBehaviourBaselineService.update()` activate hook (~:224-227)**
- The `"active".equalsIgnoreCase(saved.getStatus()) && !"active".equalsIgnoreCase(statusBefore)` block already detects draft→active and fires `traceBaselineActivated`.
- Hash + provenance stamping hooks in at exactly this point, in the same `@Transactional` method, before the DTO is returned.

**`ApiBehaviourCaptureSessionEntity.coverageSummaryJson` + `getEnvironmentName` (Spec A)**
- The capture session carries `environment_name` and Spec A's `coverage_summary_json` (`{ overall_score, ... }`, changeset 189); resolve via the baseline's `session_id` to populate provenance.

**`diffRunner.ts` source load + finding emission**
- Source baseline + items load at ~:379-394 (`getBaseline`, `listBaselineItems` on `diff.source_baseline_id`) is where the verify call hooks in.
- The fail-soft finding tail (`deleteFindingsByApiBehaviourDiffId`, `createDiffFinding`, per-item try/catch, trace `detail`/`step`) is the pattern for the advisory integrity-warning finding.

**`archModelClient.ts` + `ApiBehaviourBaselineController` idioms**
- `archModelClient.getBaseline` / `listBaselineItems` are the precedent for adding a `getBaselineIntegrity` method; mirror its endpoint + `toClientError` shape.
- `ApiBehaviourBaselineController` `@GetMapping("/{baselineId}/...")` pattern (`/target-baselines`) is the precedent for the new `/{baselineId}/integrity` route.

## Out of Scope
- Target-side baselines (`kind='target'`, written each reconcile by `targetReplayRunner`) — transient/regenerated, not the pinned trust anchor; no integrity or provenance for them this iteration.
- Cryptographic SIGNING / key management — plain content hash gives tamper-EVIDENCE only; note signing as a future follow-on.
- Backfill of pre-existing baselines — they show "no integrity hash recorded" until re-pinned/re-activated; reconcile skips verification for them.
- Changing reconcile-time volatile TOLERANCE or `expected_volatile` diff behaviour — the hash pins declared paths; it does not alter how volatility is tolerated at diff.
- Capture-side coverage scoring itself (Spec A) and reconcile break-type / full-response fidelity (Spec B) — already built; this spec only READS their outputs.
- Hashing or verifying at draft save, on every list read, or in the frontend — hashing and verification are server-side only, at activate and at the explicit verify endpoint.
- Any TS↔Java hash parity implementation or cross-language canonical-serialization mirror.
