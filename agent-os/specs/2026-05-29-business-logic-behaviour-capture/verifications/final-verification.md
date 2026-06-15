# Verification Report: Business-logic behaviour capture for discovery (Gap C)

**Spec:** `2026-05-29-business-logic-behaviour-capture`
**Date:** 2026-05-29
**Verifier:** implementation-verifier
**Status:** ✅ Passed

---

## Executive Summary

All four task groups are fully implemented and verified against their acceptance criteria. The feature adds a per-method 7-part structured behaviour block to the existing `business_logics` candidate, persisted via a new `behavior` JSONB column on AMS, produced by a new tier-gated discovery stage that goes through the gateway LLM relay, and rendered as a read-only expandable block in the candidate-details panel. The highest-value check — the snake_case `behavior` wire-shape contract across the discovery→AMS→frontend seam — holds end-to-end and is pinned by a dedicated cross-layer round-trip test (including a negative camelCase-drift guard). All 39 feature-specific tests pass; the frontend `tsc` count is exactly the 513-error pre-existing baseline (no NEW errors); discovery `tsc --noEmit` is clean. No constraint violations were found.

---

## 1. Tasks Verification

**Status:** ✅ All Complete

All 28 checkboxes in `tasks.md` are marked `- [x]`; zero unchecked. Each was independently corroborated against the implementation in code (not taken on trust).

### Completed Tasks
- [x] Task Group 1: `behavior` JSONB column on the business-logic entity + read-DTO exposure
  - [x] 1.1 Java tests (changeset + persistence/DTO/mapper) — `BusinessLogicBehaviorChangesetTest`, `BusinessLogicBehaviorPersistenceTest`
  - [x] 1.2 NEW changeset `162-business-logic-behavior.sql` (`ALTER TABLE business_logics ADD COLUMN behavior JSONB;`)
  - [x] 1.3 Registered in `db.changelog-master.yaml` after 161, `columnExists` precondition + `MARK_RAN`
  - [x] 1.4 `BusinessLogicEntity.behavior` — `@Type(JsonType.class)`, boxed `Map<String,Object>`
  - [x] 1.5 `BusinessLogicDto.behavior` — `@JsonProperty("behavior")`, snake_case, no `@CamelCaseWire`
  - [x] 1.6 `EntityMapper.toDto` + `toEntity` carry `behavior` both ways
  - [x] 1.7 Group 1 tests pass (6/6)
- [x] Task Group 2: `llmBehaviourCaptureStep.ts` — per-method LLM behaviour capture stage
  - [x] 2.1 Focused tests (selector / cache / stage / failure-rate)
  - [x] 2.2 `llm-behaviour-capture` confidence tag (key, defaults 0.6, range [0.5,0.7], env var, classifyTag)
  - [x] 2.3 Deterministic selector (business_logics ∩ endpoint-reachable ∩ non-boilerplate; always-include @Transactional/custom-throwers)
  - [x] 2.4 `source_hash` compute + cache-hit skip; edge churn does not invalidate
  - [x] 2.5 LLM via `gatewayClient.captureBehaviour` (relay), 1-hop callee depth, 7-part prompt, tolerant parse
  - [x] 2.6 Stage-3b wiring in `discoveryV3Pipeline.ts`, tier-gated, method+token caps, `v3.behaviourCapture` metrics
  - [x] 2.7 Group 2 tests pass; gateway relay mocked (no direct LLM)
  - Seam 1 (gateway relay) + Seam 2 (MCP save-back) both implemented and tested
- [x] Task Group 3: Read-only expandable 7-part behaviour block in the candidate-details panel
  - [x] 3.1 Vitest tests for the block
  - [x] 3.2 `business_logics` added to `SUPPORTED_DETAIL_TYPES`
  - [x] 3.3 Loose snake_case typing (`DiscoveryBehaviourBlock`)
  - [x] 3.4 `BehaviourBlock` component (useState toggle, aria-expanded, per-section data-testid, confidence badge, malformed-tolerant)
  - [x] 3.5 Conditional render on `candidate_type === 'business_logics'`
  - [x] 3.6 Group 3 tests pass; no NEW tsc errors
- [x] Task Group 4: Test Review & Gap Analysis
  - [x] 4.1 Reviewed Group 1-3 tests
  - [x] 4.2 Identified seam gaps (cross-layer wire shape; selector ∩ real reachability; tier-gating/caps; pipeline cache-skip)
  - [x] 4.3 Added 7 strategic tests (4 pipeline integration + 3 wire round-trip) — within the 10 cap
  - [x] 4.4 Ran feature-specific tests only

### Incomplete or Issues
None. (`tasks.md` was already fully checked and required no modification by the verifier.)

---

## 2. Documentation Verification

**Status:** ⚠️ Issues Found (minor — inline docs are excellent; the planned `implementation/*.md` files are absent)

### Implementation Documentation
- The `agent-os/specs/2026-05-29-business-logic-behaviour-capture/implementation/` folder exists but is **EMPTY**. `tasks.md` (Group 4) references per-group implementation summaries inline, but no standalone `implementation/N-*.md` report files were written.
- This is a documentation-artifact gap only. The implementation itself is extensively self-documented via module-level JSDoc/JavaDoc (e.g. the `llmBehaviourCaptureStep.ts` header, `BusinessLogicEntity`/`BusinessLogicDto` JavaDoc, the changeset header comment, the `CandidateDetailsPanel`/`codeDetectionMappers` block comments) and the highly detailed sub-task notes in `tasks.md` itself. No behaviour is undocumented.

### Verification Documentation
- This report: `agent-os/specs/2026-05-29-business-logic-behaviour-capture/verifications/final-verification.md`.
- No separate area-verifier documents were produced (single end-to-end verification pass).

### Missing Documentation
- Per-task-group `implementation/*.md` reports (non-blocking; see above).

---

## 3. Roadmap Updates

**Status:** ⚠️ No Updates Needed

### Updated Roadmap Items
None.

### Notes
`agent-os/product/roadmap.md` is the original architecture-diagramming product roadmap (meta-model CRUD, diagram rendering/editing, backend/deployment). It contains no item corresponding to the HAIKAI discovery-richness program or Gap C / behaviour capture (grep for `behaviour|business.?logic|gap.?c|specification oracle|reconstruction` returned nothing). This spec belongs to a separate discovery initiative that is not tracked in `roadmap.md`, so no roadmap checkbox applies.

---

## 4. Test Suite Results

**Status:** ✅ All Passing

Per the verification constraints, NO long-running service was started and the entire application suite was NOT run; the feature-specific tests were re-run per layer (as the spec's own Task 4.4 scopes them), plus type-checks. Results below.

### Test Summary (feature-specific)
- **Total Tests:** 39
- **Passing:** 39
- **Failing:** 0
- **Errors:** 0

| Layer | Suite | Tests | Result |
|---|---|---|---|
| AMS | `BusinessLogicBehaviorChangesetTest` | 1 | ✅ |
| AMS | `BusinessLogicBehaviorPersistenceTest` | 5 | ✅ |
| discovery | `llmBehaviourCaptureStep.test.ts` | 8 | ✅ |
| discovery | `behaviourCapturePipelineIntegration.test.ts` | 4 | ✅ |
| discovery | `gatewayClientBehaviourCapture.test.ts` | 2 | ✅ |
| gateway | `discoveryBehaviourCapture.test.ts` | 3 | ✅ |
| mcp-server | `candidateSaveBackBehaviour.test.ts` | 2 | ✅ |
| frontend | `behaviourBlockCandidate.test.tsx` | 7 | ✅ |
| frontend | `behaviourBlockWireRoundTrip.test.tsx` | 3 | ✅ |
| frontend | `supportsDetails.test.ts` | 4 | ✅ |

Type-checks:
- discovery `npx tsc --noEmit` → **clean (exit 0)**.
- frontend `npx tsc --noEmit` → **513 errors** = the documented pre-existing baseline EXACTLY. **No NEW errors** introduced by this spec.

### Failed Tests
None — all feature-specific tests passing.

### Notes
- The full AMS / discovery / frontend suites were intentionally not run (constraint: no whole-app suite, no live services). The known pre-existing `BusinessLogicIntegrationTest` (`@SpringBootTest`) environmental errors (5: H2 reserved word `key` in `UICharacteristicEntity`; `ApplicationEntity.abbreviation` NOT NULL) were observed bleeding into a broader Maven run's logs but are **NOT regressions** — they predate this spec, reference neither `business_logics.behavior` nor any code this spec touched, and the two dedicated isolated Group-1 tests (`@DataJpaTest` / direct-SQL) that DO exercise the `behavior` column both pass. This matches the implementers' git-stash-confirmed pre-existing list.
- mcp-server `tsc` `types/index.ts` `ProcessActivityInput` re-export and the frontend ~513 baseline are likewise pre-existing and were not introduced here.

---

## 5. Cross-Layer Contract Check (highest-value)

**Status:** ✅ Contract holds end-to-end — no key mismatch.

The snake_case `behavior` block keys line up verbatim across every seam:

| Stage | Where | Keys |
|---|---|---|
| **Discovery writes** | `llmBehaviourCaptureStep.ts` → `candidate.data.behavior` | `schema_version`, `method_id`, `source_hash`, `confidence`, `io`, `validation`, `transformation`, `data_effects`, `side_effects`, `edge_cases`, `provenance` |
| **MCP save-back maps** | `candidateSaveBackService.ts` `case 'business_logics'` | `entity.behavior = data.behavior` — passthrough verbatim; absent block ⇒ key UNSET (not null) |
| **AMS column / read DTO** | `behavior` JSONB; `BusinessLogicDto.@JsonProperty("behavior")` | snake_case global (`SNAKE_CASE`), NO `@CamelCaseWire` ⇒ inner JSONB keys pass through unchanged |
| **Frontend reads** | `codeDetectionMappers.ts` `buildBehaviourBlock` | reads the same 7 snake_case part keys + `confidence` (top-level or `provenance.confidence`) + `provenance.method_id` |

This is asserted in code, not merely inspected:
- `candidateSaveBackBehaviour.test.ts`: `entity.behavior` deep-equals the emitted block (snake_case parts + numeric confidence preserved); `'behavior' in entity === false` when absent.
- `behaviourBlockWireRoundTrip.test.tsx`: a block shaped exactly as discovery emits it is sent through a `SNAKE_CASE` JSON round-trip (the AMS wire), then driven through the REAL `buildBehaviourBlock` + `CandidateDetailsPanel`; all 7 sections resolve by key, confidence surfaces for the badge, provenance method id is hoisted. A negative test proves a camelCased wire (the drift a stray `@CamelCaseWire` would cause) yields zero sections and never throws — i.e. the reader keys strictly on snake_case and the contract is guarded against future drift.

**One benign asymmetry (not a defect, not contract-breaking):** the discovery writer stamps a top-level `method_id` and a top-level `confidence`, whereas the frontend's provenance headline reader (`readBehaviourProvenanceMethodId`) reads only from inside the `provenance` object (`provenance.method_id` / `source_method_id` / `methodId`). The behaviour-capture prompt explicitly instructs the LLM to emit `provenance.method_id`, so in practice the headline populates; if a model omitted it, the block still renders (sections + confidence badge) and never throws. Confidence is read defensively from BOTH the top level and `provenance.confidence`, so it always surfaces. No action required.

---

## 6. Constraint Compliance

**Status:** ✅ All constraints honoured.

- ✅ **LLM via gateway relay, not direct:** the stage calls only `gatewayClient.captureBehaviour` → `POST /api/v1/discovery/v3/behaviour-capture` (`gateway/src/routes/discoveryBehaviourCapture.ts`, exported from `routes/index.ts`, mounted in `server.ts`). No direct LLM client import in the discovery stage.
- ✅ **Tier-gated, not off-by-default:** Stage 3b runs under `behaviourCaptureTierAdmits(tier)` (default tiers A/B, env `BEHAVIOUR_CAPTURE_TIERS`). The integration test confirms Tier C makes zero LLM calls and emits no `behaviourCapture` metrics; tiers A/B run. It is NOT a separate opt-in flag.
- ✅ **`015-business-logic.sql` untouched:** not in `git status`, no diff vs `HEAD`. No applied changeset ≤ 161 modified; only the NEW `162-business-logic-behavior.sql` was added.
- ✅ **No `@CamelCaseWire`:** absent on both `BusinessLogicDto` and `BusinessLogicEntity` (the only textual match is JavaDoc explaining its deliberate absence).
- ✅ **No new candidate types:** the block attaches to the EXISTING `business_logics` candidate's `data.behavior`, keyed by `FQN#name(ParamTypes)`. No `class`/`method` candidate types introduced.
- ✅ **Shape-spec / book-of-work consumer NOT built:** no consumer of the `behavior` block exists in `migrationShapeSpecGeneration.ts` / `migrationBookOfWork.ts` (the only hits are unrelated — the word "behaviour" in prose and `apiBehaviourBaselineIds`, the runtime-harness baseline concept). Persist + expose + display only, as scoped.
- ✅ **Boxed types for PATCH-null preservation:** entity/DTO `behavior` is a boxed `Map`; the embedded confidence is a boxed `Double` inside the map (never a top-level primitive). Group 1's null-PATCH test passes.
- ✅ **`source_hash` caching + edge-churn non-invalidation:** cache-hit skips the LLM and carries the prior block forward verbatim; Spec 1 edges are linked live (read at render/consume time), not embedded, so edge churn cannot force re-capture. Covered by stage + pipeline cache-skip tests.
- ✅ **1-hop callee depth, env-tunable caps:** `BEHAVIOUR_CAPTURE_CALLEE_CAP` (default 6), `BEHAVIOUR_CAPTURE_MAX_METHODS` (200), `BEHAVIOUR_CAPTURE_TOKEN_CEILING` (400k), `BEHAVIOUR_CAPTURE_CONCURRENCY` (2), `BEHAVIOUR_CAPTURE_MAX_FAILURE_RATE` (0.2). Per-run method cap honoured by the pipeline test (2 selected, cap 1 → exactly one LLM call).
- ✅ **No `discovery-service/src/**` edits during a live run / verifier started no services:** verification was read + type-check + focused-test re-run only.

---

## 7. Genuine Gaps / Follow-ups

Clearly distinguished from the known pre-existing issues (which are NOT regressions and are documented in §4).

1. **Empty `implementation/` folder (documentation-only, low priority).** No standalone per-task-group `implementation/*.md` reports were written, despite `tasks.md` referencing them. Mitigated by exceptionally thorough inline JSDoc/JavaDoc + the detailed sub-task notes in `tasks.md`. Consider backfilling the reports for archival consistency; does not affect functionality.

2. **Provenance-headline read asymmetry (cosmetic, no action required).** Documented in §5 — the frontend reads the provenance method-id headline only from `provenance.*`, while the writer also stamps a top-level `method_id`. The prompt instructs the LLM to nest it under `provenance`, confidence is read from both locations, and the block degrades gracefully (no throw) if the LLM omits it. Optional hardening: have `buildBehaviourBlock` fall back to the block's top-level `method_id`.

3. **Cross-RUN cache carry-forward intentionally not built (in line with scope).** `buildPriorBehaviourBlocks` only indexes prior blocks already persisted for the SAME run id; carrying a previous run's blocks under a new run id would need a new AMS run-history query and is explicitly deferred (noted in the code). The `source_hash` cache mechanism and its env/test coverage are complete; this is a documented, scoped boundary, not a defect.

None of the above blocks acceptance. The implementation fully satisfies every Group 1-4 acceptance criterion.
