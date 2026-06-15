# Task Breakdown: Capture Coverage Gates (Spec 5 — HAIKAI discovery-richness capstone)

## Overview
Total Tasks: 4 task groups (strict layering order; each group depends on the prior).

This is **Spec 5**, the program's FINAL spec. It is **DETERMINISTIC** (no LLM) and
**COMPUTED-ON-READ**: there is **NO new Liquibase changeset, NO new entity/table, NO new
meta-model entity TYPE, and never a `*_points` wrapper**. Coverage is migration-process
REALITY, not architecture (per `gateway/src/config/prompts/shared/architecture-context-explainer.md`).
All three coverage dimensions ship in v1, surfaced through the EXISTING readiness mechanism +
Findings, and are strictly **ADVISORY** — they downgrade readiness streams to
`partial`/`insufficient` and emit gap codes / Findings, but **NEVER block**.

The three dimensions:
- **(A) CAPTURE coverage** (harness side, AMS): of a baseline session's `included`
  `api_behaviour_operations`, how many were captured → replayed → diffed.
- **(B) SPECIFICATION coverage** (AMS metric + discovery Findings, per-protocol): REST = has a
  resolved `endpoint_data_effects` edge; SOAP = parent interface has bound request/response
  message entities; `business_logics.behavior` = BONUS only, never required.
- **(C) INVENTORY reconciliation** (AMS): model endpoint inventory vs `api_behaviour_operations`
  in both directions, using a SOAP-aware key.

### GIT REALITY (caution — applies to EVERY group below)
- Prior-spec work is **COMMITTED in HEAD**: Issue 1, Specs 1-3, and Issue 2 land in
  `85f44b4` (bulk findings action), `b0f985f` (discovery hardening Specs 1-3),
  `2e907f0` (cross-scan architecture awareness). HEAD itself is `f6b0cec` (SOAP pack
  improvement). Build on HEAD normally.
- **Spec 4** (`2026-05-30-soap-wsdl-message-field-depth`) is **UNCOMMITTED in the working
  tree**, and this build's **earlier Spec 5 groups will also be uncommitted** as you progress.
- Do **NOT** `git checkout` / `git restore` / `git stash` / revert ANY uncommitted Spec 4 or
  Spec 5 work. **Only ADD / EXTEND.** Read-only git (status/diff/log) for diagnostics is fine.
- Dimension B touches `discovery-service/src/**` (Task Group 2): **do NOT edit it during an
  in-flight discovery run** — `tsx watch` auto-reload kills runs. Edit only when no run is active.

### Per-group verification note
Each group's verification target is **offline unit tests green** (run ONLY that group's new
tests, not the whole suite). **Live end-to-end behaviour leans on the user's environment** —
the user starts services and owns all git operations; do not start services or run live
pipelines as part of verification.

---

## Task List

### AMS Layer (the core)

#### Task Group 1: Coverage computation + new gap codes in `assessReadiness`
**Dependencies:** None (builds on HEAD)

**Caution (git reality):** Build on HEAD (`f6b0cec`). Specs 1-3 + Issue 2 are committed; Spec 4
and earlier Spec 5 groups are uncommitted in the working tree — ADD/EXTEND only, never revert.

All work is a **PURE READ** inside `MigrationDiscoveryContextService` — no schema change, no new
persistence. PREFER reusing the existing repository finders the spec lists; add a NEW read-only
finder ONLY where a needed join genuinely has none.

Verified anchors:
- `architecture-model-service/.../service/migration/MigrationDiscoveryContextService.java`:
  `assessReadiness(ReadinessContext)` ~line 967 (per-stream rules + `gaps` dedupe at end);
  `record ReadinessContext` ~line 953; `build(...)` ~line 196 composes `ReadinessContext` at
  ~line 297 and calls `assessReadiness` at ~line 308; `buildBaselineSummary(...)` ~line 861
  exposes `b.getSessionId()` (the join key — baselines link via `session_id`, NOT a baseline FK).
- `architecture-model-service/.../model/dto/migration/MigrationGapCodes.java`: 8 existing
  **snake_case String VALUE** constants (e.g. `NO_API_BEHAVIOUR_BASELINE = "no_api_behaviour_baseline"`).
- `architecture-model-service/.../model/dto/migration/ReadinessAssessmentDto.java`: record with
  per-field `@JsonProperty("camelCase")` (`overallStatus`, `apiReadiness`, `baselineReadiness`, …).

- [x] 1.0 Complete AMS coverage computation + gap-code wiring
  - [x] 1.1 Write 2-8 focused tests FIRST (extend `architecture-model-service/src/test/.../migration/`)
    - Limit to 2-8 highly focused tests maximum.
    - Test ONLY the critical coverage behaviours, e.g.: (A) a partially-captured session
      emits `incomplete_capture_coverage` and downgrades `baselineReadiness`/`apiReadiness`;
      a captured-but-never-replayed (current-only) baseline does NOT emit a diff-coverage
      error (the absent diff IS the unexecuted signal, not a failure); (B) an under-specified
      REST endpoint (no `endpoint_data_effects`) drives `under_specified_endpoints` while a
      SOAP op judged by its message bindings is scored on the SOAP bar; (C) a
      discovered-but-not-captured AND a captured-but-not-discovered op both flag
      `discovery_harness_inventory_mismatch` using the SOAP-aware key; plus a sanity check
      that fully-covered input emits NONE of the new codes.
    - Assert advisory semantics: streams downgrade to `partial`/`insufficient`, never block;
      `gaps` is still deduped at the end of `assessReadiness`.
    - If metric VALUE fields are added (1.6), assert the camelCase `@JsonProperty` wire names.
    - Skip exhaustive coverage of every join permutation and every status combination.
  - [x] 1.2 Add the three new gap-code constants to `MigrationGapCodes`
    - Alongside the existing eight (String constants, NOT a Java enum).
    - Suggested: `INCOMPLETE_CAPTURE_COVERAGE = "incomplete_capture_coverage"` (A),
      `UNDER_SPECIFIED_ENDPOINTS = "under_specified_endpoints"` (B),
      `DISCOVERY_HARNESS_INVENTORY_MISMATCH = "discovery_harness_inventory_mismatch"` (C).
    - Match the existing snake_case String-VALUE convention exactly (NOT the UPPER_SNAKE name).
  - [x] 1.3 Compute dimension (A) CAPTURE coverage from the `api_behaviour_*` tables
    - Scope per baseline reached via `buildBaselineSummary` using `ApiBehaviourBaselineEntity.getSessionId()`.
    - Denominator = `api_behaviour_operations` for that session filtered to `included = true`
      (via existing `findBySessionIdOrderByCreatedAtAsc`).
    - "Captured/executed" = an `api_behaviour_captures` row for that `operation_id` in the
      session (carries `accepted` / `response_status` / `error_type`, via existing
      `findBySessionIdOrderByCapturedAtAsc`); "replayed-eligible" = an
      `api_behaviour_baseline_items` row for the baseline (`operation_id` / `method` / `path`);
      "diffed" = a diff item (baseline as SOURCE via `ApiBehaviourDiffRepository.findBySourceBaselineId`
      → `findByDiffIdOrderByMethodAscPathAsc`).
    - **Treat a current-only baseline never replayed against a target as having no "diffed"
      coverage by nature — that ABSENCE is the unexecuted-coverage signal, NOT an error.**
    - Compute `capturedCount / includedCount` AND surface WHICH operations are missing
      (by `operation_id` / `{method, path}`), not just a count.
    - Add a NEW read-only finder ONLY if a listed join truly lacks one (no schema change).
  - [x] 1.4 Compute dimension (B) SPECIFICATION coverage from the persisted model (AMS side)
    - Resolve `model_file_id` the way `MetaModelSummaryService` does (via `ModelFileRepository`);
      read entity repositories directly (`MetaModelSummaryDto` is counts-only — cannot supply
      effects/bindings).
    - Per-protocol bar (detect via `EndpointEntity.protocol` / `endpoint_type`): REST = has a
      resolved `endpoint_data_effects` edge (`EndpointDataEffectRepository.findByEndpointId`
      non-empty / Spec 1); SOAP = parent interface has bound request/response message entities
      (`InterfaceLogicalEntityRepository.findByInterfaceId` / Spec 4 `interface_logical_entities`
      + message `logical_data_entities`).
    - `business_logics.behavior` (Spec 2, via `BusinessLogicRepository`) is a BONUS signal ONLY —
      NEVER required for "fully specified".
    - Compute `fullySpecifiedCount / totalDiscoveredEndpoints`. (Per-endpoint Findings emission
      lives in Task Group 2 — discovery side.)
  - [x] 1.5 Compute dimension (C) INVENTORY reconciliation (read-time compare, both directions)
    - Compare model-file-scoped `EndpointEntity` rows (`findByModelFileId`) against the harness
      `api_behaviour_operations` set for the baseline's session.
    - Use a PROTOCOL-AWARE key: SOAP = `soap_action` / `request_root_element` (from
      `EndpointEntity.protocolMetadataJson`) because every SOAP op emits
      `{operation_verb:'POST', path_or_address: servletPath}` with `path` often null (so
      `{method, path}` collapses N SOAP ops to one); REST = `{method, path}`.
    - Flag BOTH directions: discovered-but-not-captured AND captured-but-not-discovered.
    - No discovery→harness manifest, no new handoff payload — pure read-time compare.
  - [x] 1.6 Thread aggregates through `ReadinessContext` + `build(...)` and fold codes into streams
    - Extend the `ReadinessContext` record with the new aggregates; compute them in `build(...)`
      before constructing the context (resolve the model file there for dimension B), and pass
      them in at the ~line 297 construction site.
    - In `assessReadiness`: fold (A)/(C) into `baselineReadiness` / `apiReadiness` and (B) into
      `discoveryReadiness`; downgrade to `partial`/`insufficient` only — NEVER block. Let the
      existing end-of-method `gaps` dedupe handle duplicates.
    - ONLY IF metric VALUES must ride the wire: add camelCase `@JsonProperty` fields to
      `ReadinessAssessmentDto` (e.g. `captureCoverage`, `specificationCoverage`,
      `inventoryReconciliation`) following its EXISTING per-field convention (NOT snake_case,
      NOT `@CamelCaseWire`); keep the shape byte-stable. New gap codes ride the existing `gaps`
      list for free, so prefer codes-only unless values are genuinely needed downstream.
  - [x] 1.7 Mark this group `- [x]` and run ONLY this group's tests
    - Run ONLY the 2-8 tests from 1.1 (e.g. the targeted Maven test class), NOT the whole suite.
    - Verify offline unit tests are green; live end-to-end leans on the user's environment.

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass.
- All THREE dimensions compute inside `assessReadiness` from existing data — NO schema change,
  NO new changeset, NO new entity/table.
- The three new gap codes exist in `MigrationGapCodes` (snake_case String values) and fold into
  the existing streams as ADVISORY downgrades (never blocking); `gaps` stays deduped.
- A captured-but-never-replayed current-only baseline produces no false diff-coverage error.
- Any new DTO metric fields use per-field camelCase `@JsonProperty`; the DTO shape stays stable.
- Any new repository finder is read-only (no schema change), added only where a join lacked one.

---

### Discovery Layer

#### Task Group 2: Dimension-B per-endpoint evidence-gap Findings + run aggregate rollup
**Dependencies:** Task Group 1

**Caution (git reality):** Specs 1-3 committed; Spec 4 + Task Group 1 are uncommitted in the
working tree — ADD/EXTEND only, never revert. **Do NOT edit `discovery-service/src/**` while a
discovery run is in flight** (`tsx watch` reload kills runs); edit only when no run is active.

Same per-protocol "fully specified" definition as AMS dimension B. Deterministic, no LLM.

Verified anchors:
- `discovery-service/src/services/findings/emissionSources.ts`: `EvidenceGapType` union ~line 418
  (single source of truth for `detail_json.gapType`); `buildEvidenceGapFinding(...)` ~line 443
  (`findingType:'evidence_gap'`, `category:'evidence_gap'`, severity `'medium'`,
  `source:'pipeline_evidence_gap'`, `supports` link to the candidate) — the pattern to follow.
- `discovery-service/src/services/discoveryV3Pipeline.ts`: the `runContext`-based emit wiring
  (e.g. `buildLowConfidenceCandidateFinding` at ~line 1188; `runContext` threaded ~line 1167+).
- `discovery-service/src/services/findings/FindingEmitter.ts`: `emitFinding`/`emitFindings`
  (normalize + dedupe + soft-fail, never throws); `getRunAggregate(runId)` →
  `{ totalEmitted, totalPersisted, totalDeduped }` (already surfaced into the run `steps_payload`).

- [x] 2.0 Complete discovery dimension-B Findings + rollup
  - [x] 2.1 Write 2-8 focused tests FIRST (discovery Vitest, alongside existing findings tests)
    - Limit to 2-8 highly focused tests maximum.
    - Test ONLY critical behaviours: the new builder returns the canonical evidence-gap shape
      (`findingType`/`category`/severity `'medium'`/`supports` link/`detailJson.gapType` =
      the new sentinel); an under-specified REST endpoint (no resolved data effect) yields one
      Finding; an under-specified SOAP op (no bound message entities) yields one Finding; a
      fully-specified endpoint yields NONE; and the per-endpoint "fully specified?" count rolls
      into the run aggregate. Optionally assert dedupe via the existing emitter path.
    - Skip exhaustive per-protocol matrix and edge cases.
  - [x] 2.2 Add the new sentinel(s) + builder in `emissionSources.ts`
    - Extend the `EvidenceGapType` union with the new sentinel(s) (e.g. `endpoint_under_specified`,
      or split `endpoint_missing_data_effect` / `soap_operation_missing_message_binding` if a
      per-protocol distinction is clearer).
    - Add ONE new builder mirroring `buildEvidenceGapFinding`: `findingType:'evidence_gap'`,
      `category:'evidence_gap'`, severity `'medium'`, `source:'pipeline_evidence_gap'`, a
      `supports` link to the endpoint's discovery candidate, `detailJson.gapType` = the sentinel.
  - [x] 2.3 Compute per-endpoint dimension-B completeness in the pipeline (same bar as AMS)
    - Apply the per-protocol bar from Task Group 1 (REST = resolved data effect; SOAP = bound
      request/response message entities; behaviour is BONUS only) over the run's discovered
      endpoints. Deterministic, no LLM.
  - [x] 2.4 Emit per-under-specified-endpoint Findings + roll the count into the run aggregate
    - Wire emission in `discoveryV3Pipeline.ts` following the existing `runContext`-construct /
      `findingEmitter`-emit pattern; reuse the built-in dedupe + soft-fail (never throws).
    - Reflect the per-endpoint "fully specified?" rollup via `getRunAggregate` as-is (no new
      aggregate shape) so it surfaces in `steps_payload`.
  - [x] 2.5 Mark this group `- [x]` and run ONLY this group's tests
    - Confirm no discovery run is in flight before editing/running. Run ONLY the 2-8 tests from
      2.1, NOT the whole suite. Offline unit tests green; live end-to-end leans on the user's env.

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass.
- Each under-specified discovered endpoint emits exactly one `evidence_gap` Finding via the
  existing `FindingEmitter` (canonical shape + new sentinel), with the per-protocol bar matching
  AMS; fully-specified endpoints emit none.
- The per-endpoint completeness count rolls into the existing run aggregate (`getRunAggregate`),
  no new aggregate shape.
- Deterministic, no LLM; no edits made during an in-flight run.

---

### Gateway Layer

#### Task Group 3: Confirm the readiness proxy (expected NO change)
**Dependencies:** Task Group 2

**Caution (git reality):** Specs 1-3 committed; Spec 4 + Task Groups 1-2 are uncommitted in the
working tree — ADD/EXTEND only, never revert.

Verified anchor:
- `gateway/src/routes/migrationContext.ts`: `POST /api/v1/projects/:projectId/migration-discovery-context`
  forwards the body verbatim and re-emits the AMS response (`res.status(...).json(...)`)
  **byte-for-byte** (200 success ~line 59; AMS error status/body round-trip ~lines 71-77). The
  new gap codes + any camelCase metric fields ride this proxy untransformed.

- [x] 3.0 Confirm the gateway proxy round-trips the new fields
  - [x] 3.1 Write 2-8 focused tests FIRST (only if warranted) — `gateway/src/__tests__/`
    - Limit to 2-8 highly focused tests maximum.
    - A single regression test is usually sufficient: mock AMS to return a readiness payload
      carrying the new `gaps[]` codes (and any camelCase metric fields) and assert the gateway
      re-emits status + body byte-for-byte with NO transformation. Follow existing
      `migrationContext` proxy test patterns.
    - Skip broader proxy re-testing — only cover the new-field passthrough.
  - [x] 3.2 Verify `migrationContext.ts` requires no code change
    - Confirm the verbatim forward already passes the new codes/fields through; make NO
      modification unless a real gap is found.
  - [x] 3.3 Mark this group `- [x]` and run ONLY this group's tests
    - Run ONLY the 2-8 (likely 1) tests from 3.1, NOT the whole suite. Offline unit tests green;
      live end-to-end leans on the user's environment.

**Acceptance Criteria:**
- The proxy is confirmed to forward the new gap codes + any camelCase metric fields byte-for-byte
  with no transformation.
- `migrationContext.ts` is unchanged (or, if a real gap surfaced, the minimal fix plus a
  regression test).

---

### Frontend Layer

#### Task Group 4: Render the new gap codes + metrics in the existing readiness surface
**Dependencies:** Task Group 3

**Caution (git reality):** Specs 1-3 committed; Spec 4 + Task Groups 1-3 are uncommitted in the
working tree — ADD/EXTEND only, never revert.

Reuse the EXISTING readiness surface — **NO bespoke widget**. Per-endpoint dimension-B Findings
already appear on the existing Findings tab for free (standard `evidence_gap` findings).

Verified anchors:
- `frontend/src/api/migrationDiscoveryContextApi.ts`: `MigrationReadinessAssessment` type
  ~line 173 (already has `overallStatus`, the per-stream fields, and `gaps?: string[]` ~line 182).
- `frontend/src/components/ProductManager/MigrationDeliveryPlan/MigrationDeliveryPlanWizard.tsx`
  — the verified readiness render surface (readiness card with the `Gaps:` row, ~lines 643-680).
  (NOT `MigrationDeliveryDashboard`, which does not consume `readinessAssessment` directly.)
  Co-located tests live in `frontend/src/components/ProductManager/MigrationDeliveryPlan/__tests__/`.

- [x] 4.0 Complete frontend rendering of the new codes/metrics
  - [x] 4.1 Write 2-8 focused tests FIRST — `.../MigrationDeliveryPlan/__tests__/` (Vitest)
    - Limit to 2-8 highly focused tests maximum.
    - Test ONLY: the wizard's `Gaps:` row renders the three new codes when present in
      `readinessAssessment.gaps`; and (if metric VALUE fields were added in Task Group 1.6) the
      readiness card renders the new camelCase metric values. Extend the existing
      `MigrationDeliveryPlanWizard.test.tsx` patterns.
    - Skip exhaustive snapshotting and unrelated wizard states.
  - [x] 4.2 Extend the `MigrationReadinessAssessment` type (only if metric fields were added)
    - New gap codes flow through the existing `gaps?: string[]` for FREE — no type change for
      codes. ONLY IF Task Group 1.6 added DTO metric VALUE fields, add matching **camelCase**
      optional fields (e.g. `captureCoverage?`, `specificationCoverage?`, `inventoryReconciliation?`)
      to this type to mirror the wire.
  - [x] 4.3 Render the new codes/metrics in the `MigrationDeliveryPlanWizard` readiness card
    - The `Gaps:` row already renders any `gaps[]` entries — confirm the new codes display
      legibly (humanise labels if the row already does so for existing codes). If metric values
      were added, render them in the existing readiness card alongside `overallStatus` / the
      per-stream rows. NO bespoke widget, NO new dashboard.
  - [x] 4.4 Mark this group `- [x]` and run ONLY this group's tests
    - Run ONLY the 2-8 tests from 4.1, NOT the whole suite. Offline unit tests green; live
      end-to-end leans on the user's environment.

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass.
- The three new gap codes render in the existing `MigrationDeliveryPlanWizard` readiness card
  `Gaps:` row (codes free via `gaps[]`).
- If metric VALUE fields were added, the `MigrationReadinessAssessment` type carries them in
  camelCase and the card renders them — otherwise no type change.
- No bespoke widget / dashboard added; dimension-B Findings appear on the existing Findings tab
  for free.

---

## Execution Order

Strict layering (each group depends on the prior):
1. AMS Layer — coverage computation + new gap codes in `assessReadiness` (Task Group 1)
2. Discovery Layer — dimension-B Findings + run aggregate rollup (Task Group 2)
3. Gateway Layer — confirm proxy, expected no change (Task Group 3)
4. Frontend Layer — render new gap codes + metrics in the existing readiness surface (Task Group 4)
