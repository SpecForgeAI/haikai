# Spec Requirements: Baseline Integrity & Provenance

## Initial Description

Make the pinned API-behaviour baseline (the oracle) tamper-EVIDENT and auditable, and stamp it
with how it was produced (including the coverage score from the oracle-coverage-scoring spec).

Today the baseline's immutability is enforced ONLY by the ABSENCE of a mutation path — there is no
content hash/signature, so silent tampering or drift of a pinned oracle is undetectable. There is
also no provenance recorded ON the baseline (which capture session produced it, against which
environment, when it was pinned/activated) and no at-a-glance view of how thorough the oracle is.

This is Spec C of a 3-spec series (A = oracle coverage scoring, B = reconcile full-response
fidelity, C = this). Build order A → B → C; by C's build time A's coverage field and B's
response-shape changes already exist. Next free Liquibase changeset after A=189 and B=190 is
expected ~191 (builder verifies next-free at build time).

(Full raw idea: `planning/raw-idea.md`.)

## Requirements Discussion

The requirements authority pre-locked the four key decisions; no end-user clarification round was
run. The numbered clarifying questions with "Locked?" verdicts are recorded at the end of this
document for the orchestrator to confirm/close. The four locked decisions are:

1. **CONTENT HASH** per pinned baseline — deterministic hash over the baseline's behavioural
   content (the set of baseline items: status, headers, body, volatile envelope, etc.) via
   canonical/stable serialization. Recompute-and-verify on read / at reconcile time; mismatch =
   VISIBLE integrity warning (never silent).
2. **PROVENANCE** stamped at pin/activate — capture session id, environment name,
   pinned/activated timestamp, the COVERAGE SCORE from Spec A, plus capture metadata
   (scenario/capture counts). Auditable.
3. **SURFACE** integrity status + provenance + coverage score in the baseline view UI
   (at-a-glance trustworthiness).
4. **Preserve immutability** — baseline stays immutable once active; integrity makes it
   tamper-EVIDENT on top. The hash captures exactly what is pinned; reconcile-time volatile
   tolerance is SEPARATE (NOT part of the hash). The hash is over the raw pinned content;
   volatile / `expected_volatile` handling at reconcile is unaffected by it.

### Existing Code to Reference

**Reference idiom spec (use throughout):**
`agent-os/specs/2026-06-16-reconcile-determinism-volatile-values/spec.md` + `tasks.md` — the
canonical pattern for AMS-field + Liquibase changeset (`not.columnExists`) + DTO snake_case wire +
frontend-surfacing this series follows. The `volatile_paths_json` column it added (changeset 187)
sits on the very entity this spec hashes.

**Canonical serialization + SHA-256 (the reuse target for the content hash):**
- `gateway/src/services/dbMigrationPack/inputs.ts:162` `canonicalSerialize(value)` —
  recursively sorts object keys so serialization is order-independent; `inputs.ts:184`
  `computeInputSnapshotHash` does `crypto.createHash('sha256').update(canonicalSerialize(...),
  'utf8').digest('hex')` and the staleness check recomputes-and-compares — exactly the
  recompute-and-verify shape this spec needs.
- `gateway/src/services/missingInputKeyHasher.ts` (TS) ↔
  `architecture-model-service/.../service/MissingInputKeyHasher.java` (Java) — a PROVEN
  cross-language SHA-256 parity pair (TS computes, Java mirrors, byte-identical, parity-tested).
  This is the precedent for "stable across TS builder and Java-side verification".
- `architecture-model-service/.../util/UserJourneyDiagramHashUtil.java:46` — another AMS
  `MessageDigest.getInstance("SHA-256")` hashing util.

**Baseline entities / DTOs / service (AMS, where hash + provenance columns are added):**
- `ApiBehaviourBaselineEntity.java` — the baseline header (status, kind, session_id, counts).
- `ApiBehaviourBaselineItemEntity.java` — the per-item frozen capture (`response_json`,
  `request_json`, `response_status`, `volatile_paths_json`); the hashed content.
- `ApiBehaviourBaselineDto.java` — the wire shape (note the backward-compatible delegating
  constructor pattern when adding fields).
- `ApiBehaviourBaselineService.java` — CRUD + status-transition validation; the
  draft→active transition + `traceBaselineActivated` live here.
- `ApiBehaviourMapper.java` — manual entity↔DTO mapping (add new fields here).
- `ApiBehaviourCaptureSessionEntity.java` — carries `environment_name` and is the likely home of
  Spec A's coverage summary field.

**api-migration-validation-service (TS — builds/reads baselines):**
- `archModelClient.ts` — `BaselineDto`, `BaselineItemDto`, `CreateBaselineItemRequest` (all
  snake_case); `getBaseline`, `listBaselineItems`, `createBaseline`, `createBaselineItem`,
  `patchBaseline`, `getCaptureSession`.
- `diffRunner.ts:376-383` — the reconcile read path: loads source + target baseline items via
  `listBaselineItems`. Where a recompute-and-verify of the SOURCE (oracle) hash hooks in.
- `targetReplayRunner.ts:417,580,673` — the server-side TS path that reads source items and
  WRITES target baseline items (the only non-frontend baseline-item writer).

**Frontend (React/TS — baseline view):**
- `SaveAsBaselineModal.tsx:124-155` — pins the baseline: `createBaseline` (draft) then per-item
  `createBaselineItem` (already carries `volatile_paths_json`).
- `BaselinesList.tsx:70-82,121-133` — the Activate / Archive surface (PATCH `{ status }`).
- `BaselineDetailView.tsx` — read-only baseline header + items; surface for integrity +
  provenance + coverage.
- `frontend/src/api/apiBehaviourClient.ts` — frontend baseline API module (snake_case typed).

### Follow-up Questions

No end-user follow-up round was run (requirements authority is the decision authority). Open
shaping questions are recorded as numbered clarifying questions below for the orchestrator.

## Visual Assets

### Files Provided:
No visual assets provided. `planning/visuals/` confirmed empty via directory listing.

### Visual Insights:
N/A — the feature reuses the existing baseline-detail surface (`BaselineDetailView.tsx`) and the
Save-as-Baseline / Activate surfaces (`SaveAsBaselineModal.tsx`, `BaselinesList.tsx`); no bespoke
widget is implied. Integrity status + provenance + coverage are added to the existing baseline
header the way the volatile-determinism spec added its badges to existing surfaces.

## Requirements Summary

### Functional Requirements

- **Content hash on the pinned baseline.** A deterministic SHA-256 over canonically-serialized
  behavioural content of the baseline's item set (per item: method, path, scenario_name,
  request_json, response_status, response_json, volatile_paths_json — the raw pinned content).
  Computed in TS at pin time (the validation-service / frontend write path), persisted on the
  baseline so it can be recomputed and compared later.
- **Recompute-and-verify on read / at reconcile.** At reconcile time (`diffRunner.ts` source-item
  load) recompute the hash over the loaded source items and compare to the stored hash; a mismatch
  is surfaced as a VISIBLE integrity warning, never silently swallowed.
- **Provenance stamped at pin/activate.** Capture session id, environment name (from the session),
  pinned/activated timestamp, the coverage score (read from Spec A's coverage summary field), plus
  capture metadata (scenario/capture counts). Auditable record on the baseline.
- **Surface in the baseline view.** Integrity status (verified / mismatch / "no integrity hash
  recorded"), provenance, and coverage score shown at a glance on `BaselineDetailView.tsx`
  (and any active-baseline metadata display).
- **Graceful no-backfill handling.** Pre-existing baselines (pinned before this spec) carry no
  hash; the UI shows "no integrity hash recorded" and reconcile skips verification for them. No
  backfill.

### Reusability Opportunities

- `canonicalSerialize` (`gateway/.../dbMigrationPack/inputs.ts:162`) — recursively sorted-key JSON;
  reuse (or port the identical algorithm) so the TS hash is order-independent. NOTE: it currently
  lives in the gateway module, not the validation-service; the spec-writer must decide whether to
  import/share it or replicate the (tiny, well-documented) algorithm in the validation-service to
  avoid a cross-module dependency.
- `missingInputKeyHasher.ts` ↔ `MissingInputKeyHasher.java` — the exact TS↔Java SHA-256 parity
  precedent (separator constants mirrored verbatim, parity-tested) to mirror IF Java-side
  verification is in scope.
- The `volatile_paths_json` changeset (187) + DTO additions are the field-addition template for
  the new hash/provenance columns.
- The `traceBaselineActivated` hook in `ApiBehaviourBaselineService.update()` is the existing
  draft→active detection point.

### Scope Boundaries

**In Scope:**
- Deterministic content hash over the pinned baseline item set (one canonical serialization + one
  algo, SHA-256 over sorted-key canonical JSON).
- Recompute-and-verify at reconcile read (TS) and the visible mismatch warning.
- Provenance fields stamped at pin/activate (session id, environment, timestamp, coverage score
  from Spec A, scenario/capture counts).
- Surfacing integrity status + provenance + coverage in the baseline view.
- AMS columns + DTO + mapper for the hash and provenance; Liquibase changeset (~191, builder
  verifies next-free; `not.columnExists` idiom).
- Graceful "no integrity hash recorded" for pre-existing baselines.

**Out of Scope:**
- Cryptographic SIGNING / key management (plain content hash = tamper-EVIDENCE this iteration;
  note signing as a future follow-on).
- Backfill of pre-existing baselines (they show "no integrity hash recorded" until re-pinned).
- Capture-side coverage scoring itself (Spec A) and reconcile break-type fidelity (Spec B).
- Changing reconcile-time volatile tolerance — the hash is over raw pinned content;
  `expected_volatile` / volatile handling is unaffected.

### Technical Considerations

- **AMS wire = snake_case by default** (CLAUDE.md). New baseline DTO fields take NO `@CamelCaseWire`
  (the validation-service + frontend baseline consumers are snake_case). Follow the `archModelClient`
  + AMS entity/changeset idioms from the 2026-06-16 reconcile-determinism spec.
- **Pin is frontend-driven, activate is a separate PATCH.** The current-state baseline is created
  draft + items by `SaveAsBaselineModal` (frontend → AMS `createBaseline`/`createBaselineItem`),
  then activated by a frontend PATCH `{ status: 'active' }` in `BaselinesList`. There is NO
  server-side validation-service pin route. The locked "hash in TS at pin time" decision must be
  reconciled with this: where exactly the whole-baseline hash is computed and stamped (frontend
  during pin vs a new server step) is the main open shaping question (Q1/Q2 below).
- **Cross-language hash agreement.** ONE canonical serialization + algo (SHA-256 over sorted-key
  canonical JSON). TS computes at pin and verifies at reconcile read; whether Java also verifies
  (e.g. server-side guard) is an open scope question (Q4) — if yes, mirror the
  `MissingInputKeyHasher` TS↔Java parity precedent.
- **Next-free changeset** expected ~191 (188 highest committed; A=189, B=190 build first). Builder
  verifies next-free at build time; `not.columnExists` precondition; never edit applied changesets.
- **Spec A coverage field** is referenced as "the coverage summary field from the
  oracle-coverage-scoring spec" — ONE AMS field carrying per-endpoint + overall coverage on the
  capture session/completion; it will exist at C's build time. NOTE: the frontend `BaselinesList`
  already shows a DIFFERENT coverage number (`in_scope_coverage_pct` from the inventory
  reconciliation endpoint) — these must not be conflated; Spec A's field is the authoritative
  coverage SCORE to embed in provenance (Q5).

## Resolved Clarifications (AUTHORITATIVE — supersede the open verdicts and the "hash in TS at pin time" wording above)

The requirements authority resolves all 8 questions. These are FIXED constraints for the spec-writer. NOTE: the earlier draft text said the hash is "computed in TS at pin time" — that is SUPERSEDED by R1/R4 below (hashing moves SERVER-SIDE into AMS, the correct trust boundary).

**R1 + R2 (where/when the hash + provenance are computed and stamped) — SERVER-SIDE in AMS, at the draft→active ACTIVATE transition.**
- Rationale: a client-/frontend-computed hash is not a trust boundary (trivially forgeable, doesn't protect stored data). The hash must be computed by the server that owns the immutable data, over the items AS PERSISTED, at the moment immutability takes effect.
- Compute in AMS (Java) at the existing draft→active detection point in `ApiBehaviourBaselineService.update()` (`:224-227`, where `traceBaselineActivated` already fires). At activate, all baseline items are already persisted by the frontend draft flow, so AMS reads its own items, canonical-serializes, SHA-256-hashes, and stamps the hash + provenance onto the baseline header in the SAME transaction as the activation.
- Draft baselines carry NO hash (still mutable); the hash is only meaningful once active. Stamp BOTH hash and provenance at activate.
- Reuse an existing AMS SHA-256 util (`UserJourneyDiagramHashUtil` / `MissingInputKeyHasher`) for the digest.

**R3 (field placement) — CONFIRMED: new columns on the `api_behaviour_baselines` HEADER.** Add `content_hash` (TEXT, nullable — null = pre-existing/never-activated) + `provenance_json` (JSONB, nullable). `provenance_json` holds `{ session_id, environment_name, activated_at (server time), coverage_score, coverage_summary (or a ref), accepted_capture_count, operation_count, hash_algo: "sha256", canonical_version: 1 }`. Reuse existing header fields where present (`session_id`, `accepted_capture_count`, `operation_count` at `:94-99`). One changeset (~191, builder verifies next-free, `not.columnExists`).

**R4 (verification language/scope) — VERIFICATION IS ALSO SERVER-SIDE in AMS; NO cross-language hash reimplementation (TS↔Java parity is ELIMINATED, not mirrored).**
- AMS exposes a verify result: either a dedicated `GET .../baselines/{id}/integrity` operation OR an `integrity` block populated on `getBaseline` read, that recomputes the hash over current stored items and returns `{ content_hash, recomputed_hash, integrity_verified: boolean }`. Spec-writer picks the surface; an explicit endpoint called at reconcile is preferred (avoids recompute on every list).
- The TS reconcile path (`diffRunner.ts` source/oracle load, source = `diff.source_baseline_id`) CONSUMES that verdict (it does NOT recompute the hash itself). On `integrity_verified === false` it emits a VISIBLE integrity warning finding and PROCEEDS (advisory — see R7).
- This is a deliberate improvement over the draft's "TS recompute at reconcile": one hashing implementation (Java), no canonical-serialization drift risk between languages. The `MissingInputKeyHasher` parity precedent is therefore NOT needed.

**R5 (which coverage number) — CONFIRMED: embed Spec A's coverage-summary field** (read from the capture session via the baseline's `session_id`, `archModelClient.getCaptureSession`). Do NOT use the existing `in_scope_coverage_pct` (inventory reconciliation). Provenance embeds Spec A's overall coverage score (+ the summary or a compact form).

**R6 (hashed content scope) — CONFIRMED: hash includes `volatile_paths_json`.** Per item the canonical content = `method`, `path`, `scenario_name`, `request_json`, `response_status`, `response_json`, AND `volatile_paths_json` (the declared volatile envelope is PINNED CONTENT — changing which paths are flagged volatile changes the pinned oracle and MUST be tamper-evident). Items are sorted by a stable key `(method, path, scenario_name)`; JSON object keys sorted recursively; UTF-8; SHA-256 hex. This is SEPARATE from reconcile-time volatile TOLERANCE (decision 4) — the hash pins the declared paths; it does not change how `expected_volatile` behaves at diff. The spec-writer must state this distinction explicitly and document the canonical form precisely (`canonical_version: 1`).

**R7 (mismatch behaviour) — CONFIRMED: ADVISORY warning, never blocks.** An integrity mismatch surfaces a visible warning (a finding + a red badge in the baseline view) and the reconcile PROCEEDS. Never silent. Pre-existing baselines with no hash show "no integrity hash recorded" (neutral, not a mismatch) and reconcile skips verification for them.

**R8 (target-side baselines) — OUT of scope: current-state ORACLE baselines only** (`kind = 'current'`). Target baselines (`kind = 'target'`, written each reconcile by `targetReplayRunner`) are transient/regenerated, not the pinned trust anchor — no integrity/provenance for them this iteration. Add an explicit out-of-scope line.
