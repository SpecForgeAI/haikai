# Task Breakdown: Oracle Integrity & Determinism (run-level degraded signal + reproducible extraction)

## Overview
Total Tasks: 6 task groups

Phase-2 "oracle perfection" **Spec #3 of 6** (oracle integrity & determinism) — combines the program's run-integrity, determinism, and non-determinism-flagging clusters. **ADVISORY throughout**: every signal downgrades / flags, **NEVER blocks**. A degraded run still transitions to `COMPLETED`. Built strictly on the committed base (HEAD `d3ebeca`, Specs #1-#2 done). **ADD / EXTEND only — do NOT revert or re-author.**

The six groups are in **strict layering order**: AMS persistence/DTO first, then the discovery-service computation/scanner/cache, then the MCP save-back guards, then the frontend surface. See the **Phase-2 Build Ordering & File-Overlap** section at the bottom for the cross-spec sequencing constraints.

---

## Task List

### AMS Persistence Layer

#### Task Group 1: Run-record `degraded` flag + `degraded_reasons` (DTO, entity, service, controller, Liquibase)
**Dependencies:** None (foundation — everything else surfaces this field)

Add an advisory `degraded` boolean flag PLUS a structured `degraded_reasons` payload on the discovery-run record/DTO, riding **ALONGSIDE** the existing `COMPLETED` status. This is **NOT** a new status-enum value — `validateStatusTransition` (in discovery-service) must stay untouched. Model it exactly on the existing advisory `warnings` field precedent.

- [x] 1.0 Complete AMS run-record degraded field
  - [x] 1.1 Write 2-8 focused tests for the `degraded` / `degraded_reasons` field (Maven / JUnit)
    - Limit to 2-8 highly focused tests maximum
    - Test only: the DTO serializes `degraded` / `degraded_reasons` under the correct **snake_case** wire names; the field round-trips through the entity (persist + read back); a run with the field absent/null stays valid (back-compat, no backfill)
    - Skip exhaustive coverage of all DTO fields and all controller routes
  - [x] 1.2 Decide column-vs-rider, then add the field to `DiscoveryRunDto.java` (DECISION: dedicated-column path — the documented default — mirroring `warnings`)
    - Add `degraded` (boxed `Boolean`, `@JsonProperty("degraded")`) and `degraded_reasons` (JSON-encoded `String`, `@JsonProperty("degraded_reasons")`) to the record, mirroring the `warnings` field exactly: per-field explicit `@JsonProperty("snake_case")`, **NO `@CamelCaseWire`** (no camelCase consumer is introduced on the run record)
    - **Boxed types only** (`Boolean`, never `boolean`): a primitive would silently wipe to `false`/`0` on PATCH (see project memory `primitive_double_dto_overwrite`). Add a null-guard in the update handler so PATCH does not overwrite an existing value with null
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/DiscoveryRunDto.java`
  - [x] 1.3 Add the matching column to `DiscoveryRunEntity.java` + a NEW Liquibase changeset (ONLY if persisted) (NEW changeset `169-discovery-run-degraded.sql`; 169 confirmed free at build time)
    - Mirror the `warnings` entity field: nullable `TEXT` column, `@Column(name = "degraded_reasons", columnDefinition = "TEXT")` for the reasons payload; a nullable `BOOLEAN`/`TEXT` for `degraded`
    - **NEW Liquibase changeset file ONLY if a persisted column is added.** Use the **next free number `≥169`** at build time (highest applied today is `168-endpoint-response-contract.sql`, Spec #1's — confirm 169 is still free at build time; Specs #1/#2 may have consumed numbers). Mirror the `085-discovery-run-warnings.sql` precedent (nullable, no backfill, `TEXT` not `JSONB` for portability)
    - **NEVER edit an applied changeset** (checksum-validation breaks AMS startup — see project memory `liquibase_immutable_changesets`). New file only
    - File(s): `.../model/entity/DiscoveryRunEntity.java`, `.../resources/db/changelog/sql/169-discovery-run-degraded.sql` (new), and register it in `db.changelog-master.yaml`
    - **PREFER-RIDER NOTE:** if the degraded signal can ride the existing `warnings` / `steps_payload` JSON without a new column (e.g. a reserved key in `steps_payload`), prefer that and **note it in the task** — then 1.3's changeset is skipped entirely and only the DTO read-projection changes. Decide in 1.2; the spec permits either, with a dedicated column as the documented default.
  - [x] 1.4 Thread the field through `DiscoveryRunService.java` + `DiscoveryRunController.java`
    - Map entity <-> DTO for the new field(s); ensure create/update/read all carry it; do NOT overwrite on PATCH when the incoming value is null (non-clobber, per 1.2)
    - File(s): `.../service/DiscoveryRunService.java`, `.../controller/DiscoveryRunController.java`
  - [x] 1.5 (Conditional) Surface on `ReadinessAssessmentDto.java` IF the readiness surface reads it — SKIPPED: no AMS readiness consumer reads `degraded` (verified — no `degraded` reference in `model/dto/migration/`); the spec permits skipping (frontend TG6 decides). `ReadinessAssessmentDto.java` left untouched to avoid a speculative camelCase field with no consumer.
    - If the value is also exposed on the readiness DTO, that DTO is per-field **`@JsonProperty("camelCase")`** (verified: `overallStatus`, `apiReadiness`, …) — a readiness-side field uses **camelCase** to avoid a mixed-casing payload. (Run record = snake_case; readiness = camelCase — match each DTO's own convention.)
    - File: `.../model/dto/migration/ReadinessAssessmentDto.java`
  - [x] 1.6 Mark 1.0 `- [x]` and run ONLY this group's tests (ran `-Dtest=DiscoveryRunDegradedPersistenceTest` → 4/4 green, BUILD SUCCESS; changeset registered + master changelog parses, no duplicate ids)
    - Run ONLY the 2-8 tests written in 1.1 (Maven, the new test class only — do NOT run the entire AMS suite)
    - Verify the new changeset applies cleanly against a fresh schema (or confirm the rider path skips it)

- **CAUTION:** **W2** (`temperature: 0` relays) and **W4** (`scanner_failed` Finding + sentinel) are ALREADY DONE / committed on HEAD `d3ebeca` (Specs #1-#2 done) — this group does NOT touch them. This group ONLY adds the advisory `degraded` field on the AMS run record. Do NOT add a new run-STATUS enum value and do NOT touch the discovery-service `validateStatusTransition` state machine from here.

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass (offline unit tests green, no running AMS instance required)
- `DiscoveryRunDto` exposes `degraded` (Boolean) + `degraded_reasons` under snake_case wire names, mirroring `warnings`; boxed types with PATCH null-guards
- A NEW (never-edited) Liquibase changeset at the next free number `≥169` adds the column — OR the rider path is taken and documented (no new column)
- `validateStatusTransition` and the run-STATUS enum are untouched; `degraded` rides alongside `COMPLETED`

**Per-group verification note:** Offline JUnit unit tests green (the 1.1 class only). No live AMS / DB instance is started by the agent — the changeset is validated for clean apply, not run against a live server.

---

### Discovery-Service Layer

#### Task Group 2: Run-integrity computation — compute `degraded`, wire real `filesFailed`
**Dependencies:** Task Group 1

In `discoveryV3Pipeline.ts` / `runManager.ts`: compute the `degraded` flag and set it when ANY trigger fires, surfacing it on the run record at the COMPLETED branches. The run **still COMPLETES** — never block. This ESCALATES existing signals to the run level; it does not re-emit them.

- [x] 2.0 Complete run-integrity computation
  - [x] 2.1 Write 2-8 focused tests for the degraded computation (Jest)
    - Limit to 2-8 highly focused tests maximum
    - Test only: a `scanner_failed` Finding present -> `degraded = true` + matching reason; nonzero `filesFailed` (from `failures.length`) -> degraded + reason; gap-fill `stageStatus: 'failed'` -> degraded + reason; a method/token cap-hit (Spec 2) -> degraded + reason; and the **non-block invariant** (every trigger still yields a `COMPLETED` transition)
    - Skip exhaustive permutations of every trigger combination
  - [x] 2.2 Wire the real `filesFailed` count (replace the hardcoded `0`)
    - Replace the literal `filesFailed: 0` in `discoveryV3Pipeline.ts` (currently `~L1471` — line has drifted from the spec's pinned `L1344`, value identical) with the real per-file gap-fill failure count
    - `GapFillStepOutput` (`llmGapFillStep.ts:207-211`) exposes `failures: GapFillFailure[]` — there is **NO** pre-existing `filesFailed` field on the output; derive the count from `failures.length` and surface it into the stage-output construction
    - File(s): `discovery-service/src/services/discoveryV3Pipeline.ts`
  - [x] 2.3 Compute `degraded` + accumulate `degraded_reasons` from the trigger set
    - SET `degraded = true` and append the matching reason when ANY of: a `scanner_failed` Finding was emitted (**W4 — reuse, do not re-emit**); the gap-fill stage `stageStatus: 'failed'` **OR** nonzero `filesFailed` (from 2.2); a method/token cap was hit (Spec 2's `DEFAULT_METHOD_CAP` / `DEFAULT_TOKEN_CEILING`); a contract pass or runtime pass failed (Spec 1's response-contract scanner / the harness pass)
    - Keep `GAP_FILL_MAX_FAILURE_RATE` semantics unchanged (`llmGapFillStep.ts ~L250`, default `0.2`) — do NOT start failing the run on partial gap-fill; treat partial outcomes as a degraded trigger only
    - File(s): `discovery-service/src/services/discoveryV3Pipeline.ts`
  - [x] 2.4 Persist `degraded` alongside the `COMPLETED` transition (both paths)
    - Set the run-record `degraded` / `degraded_reasons` at the COMPLETED branch (`runManager.ts ~L1469-1479`) AND the resume path (`~L1710-1719`), persisting alongside the existing `COMPLETED` write — via the Task Group 1 AMS field (or the rider path if 1.3 chose it)
    - **Do NOT touch `validateStatusTransition` or the `RUNNING -> [RUNNING, COMPLETED, FAILED]` map (`runManager.ts:1198`).** Degraded rides ON TOP of `COMPLETED`; the state machine is not extended. The run still COMPLETES in every branch — add NO new block
    - File(s): `discovery-service/src/services/runManager.ts`
  - [x] 2.5 Mark 2.0 `- [x]` and run ONLY this group's tests
    - Run ONLY the 2-8 tests written in 2.1 (Jest, by test path — do NOT run the entire discovery-service suite)

- **CAUTION:** **W2** (`temperature: 0` relays) + **W4** (`scanner_failed` Finding) are ALREADY committed on HEAD — **EXTEND them, do NOT redo.** This group ESCALATES W4's existing `scanner_failed` Finding to the run-level degraded signal (reads it, does not re-emit it). Do NOT edit `discovery-service/src/**` during an in-flight run — `tsx watch` auto-reload kills active runs (project memory `no_src_edits_during_run`). Build on `d3ebeca`; ADD/EXTEND only.

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass (offline)
- The hardcoded `filesFailed: 0` is replaced with `failures.length`; a nonzero count is a degraded trigger
- `degraded` is computed from the full trigger set and persisted at BOTH the COMPLETED branch and the resume path
- The run still transitions to `COMPLETED` for every trigger; `validateStatusTransition` and the transition map are untouched

**Per-group verification note:** Offline Jest unit tests green (the 2.1 file only). No discovery run is started; no `tsx watch` process is active during edits.

---

#### Task Group 3: Gap-fill LLM output cache (content-addressed, reproducible)
**Dependencies:** Task Group 2

A content-addressed cache keyed on `(normalized-prompt hash + model + temperature)` for the gap-fill relay path, EXTENDING the behaviour stage's existing `source_hash` hashing pattern. Cache hit -> reuse prior response with NO LLM call (reproducibility + cost). Pairs with W2: `temperature: 0` makes the model deterministic; the cache makes the pipeline deterministic.

- [x] 3.0 Complete gap-fill output cache
  - [x] 3.1 Write 2-8 focused tests for the cache (Jest)
    - Limit to 2-8 highly focused tests maximum
    - Test only: identical `(normalized-prompt, model, temperature)` inputs produce the same key; a second call with a cached key returns the prior response with **no relay/LLM call** (assert the relay mock is NOT invoked on hit); a changed prompt/model/temperature is a cache MISS; the `temperature: 0` (W2) value participates in the key
    - Skip exhaustive coverage of cache eviction/TTL and concurrency
  - [x] 3.2 Add the content-addressed cache for the gap-fill relay
    - Key on `(normalized-prompt hash + model + temperature)`, EXTENDING the behaviour stage's `computeSourceHash` pattern in `llmBehaviourCaptureStep.ts` (`createHash('sha256')` over a normalized input, with a `kind: 'cache-hit'` reuse path and a `cacheHits` counter) — reuse the **approach**, do NOT reuse the same cache instance
    - The key MUST include W2's `temperature: 0` (the relay is the single LLM path; the cache wraps that relay)
    - On a hit, reuse the prior response with NO LLM call; keep the behaviour stage's own `source_hash` cache as-is (this is the gap-fill ANALOGUE, a separate cache)
    - File(s): the gap-fill relay path — `discovery-service/src/services/llmGapFillStep.ts` (and a small cache helper module if cleaner; mirror the behaviour-stage helper layout)
  - [x] 3.3 Mark 3.0 `- [x]` and run ONLY this group's tests
    - Run ONLY the 2-8 tests written in 3.1 (Jest, by test path — do NOT run the entire discovery-service suite)

- **CAUTION:** **W2** (`temperature: 0`) is ALREADY committed — the cache key CONSUMES that temperature; do NOT re-wire the relay temperature. **W4** is unaffected here. EXTEND the behaviour-stage `source_hash` template; do NOT modify or share the behaviour stage's own cache. Do NOT edit `discovery-service/src/**` during an in-flight run (`tsx watch`). Build on `d3ebeca`; ADD only.

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass (offline)
- A cache hit reuses the prior response with no relay/LLM call; the key includes normalized-prompt + model + `temperature: 0`
- The behaviour stage's existing `source_hash` cache is untouched (separate analogue)

**Per-group verification note:** Offline Jest unit tests green (the 3.1 file only), with the gateway relay mocked — no real LLM call, no live run.

---

#### Task Group 4: New deterministic `non_deterministic_endpoint` scanner + sentinel
**Dependencies:** Task Group 2 (shares `emissionSources.ts` / pipeline with TG2; build after)

A NEW deterministic scanner (Spring / Spring Classic ONLY) emitting a `non_deterministic_endpoint` evidence-gap Finding for endpoints whose handler reaches `@Scheduled` / `@Cacheable` / `@Async` / `@Profile`-gated beans, session-scoped state, or clock / random — so the runtime harness knows the endpoint is NOT a pure function of its inputs and must not treat legitimate variance as a behavioural diff.

- [x] 4.0 Complete non-deterministic-endpoint scanner
  - [x] 4.1 Write 2-8 focused tests for the scanner + sentinel (Jest)
    - Limit to 2-8 highly focused tests maximum
    - Test only: an endpoint handler reaching `@Scheduled`/`@Cacheable`/`@Async` (or a `@Profile`-gated bean / session state / clock / random) emits a `non_deterministic_endpoint` Finding with `detail_json.gapType === 'non_deterministic_endpoint'`; a pure handler emits nothing; the scanner soft-fails (never throws) on malformed input; a non-Spring input is a no-op
    - Skip exhaustive coverage of every annotation/source-of-variance permutation
  - [x] 4.2 Add the `non_deterministic_endpoint` sentinel to `emissionSources.ts`
    - Add `non_deterministic_endpoint` to the `EvidenceGapType` union next to W4's `scanner_failed` (`L466`) and the existing `low_confidence_candidate` (`L50`); add the matching evidence-gap builder following the existing builder pattern
    - File: `discovery-service/src/services/findings/emissionSources.ts`
  - [x] 4.3 Implement the deterministic scanner (Spring / Spring Classic only)
    - Detect endpoints whose handler reaches `@Scheduled` / `@Cacheable` / `@Async` / `@Profile`-gated beans, session-scoped state, or clock / random; emit one `non_deterministic_endpoint` Finding per such endpoint via `FindingEmitter` (which already normalizes + dedupes + soft-fails)
    - Spring / Spring Classic ONLY — no non-Spring protocols. Register/wire it alongside the existing pack finding scanners (mirror W4's `scanner_failed` soft-fail catch-site placement in `packFindingScanners/index.ts` and the pipeline)
    - File(s): a new scanner under `discovery-service/src/services/findings/packFindingScanners/` (mirror an existing scanner's layout), wired in `packFindingScanners/index.ts` and surfaced from `discoveryV3Pipeline.ts`
  - [x] 4.4 Mark 4.0 `- [x]` and run ONLY this group's tests
    - Run ONLY the 2-8 tests written in 4.1 (Jest, by test path — do NOT run the entire discovery-service suite)

- **CAUTION:** **W4** (`scanner_failed` sentinel + soft-fail catch sites) is ALREADY committed — **ADD the new `non_deterministic_endpoint` sentinel NEXT TO it**; do NOT re-author or move `scanner_failed`. **W2** is unaffected. Reuse `FindingEmitter` + the existing evidence-gap builder pattern — NO new component. Do NOT edit `discovery-service/src/**` during an in-flight run (`tsx watch`). Build on `d3ebeca`; ADD only. (`emissionSources.ts` is shared with Specs #1/#4 — extend the committed version, do not duplicate.)

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass (offline)
- `non_deterministic_endpoint` is in the `EvidenceGapType` union beside `scanner_failed` / `low_confidence_candidate`
- The scanner emits the Finding for the listed sources of variance, is Spring/Spring-Classic-only, and soft-fails (never throws); `scanner_failed` is untouched

**Per-group verification note:** Offline Jest unit tests green (the 4.1 file only). No live run; scanner exercised against fixtures.

---

### MCP Save-Back Layer

#### Task Group 5: False-merge guard + below-gate hardening
**Dependencies:** Task Groups 1-4 (consumes the `possible_entity_collision` sentinel registered in TG4's `emissionSources.ts`; surfaces a below-gate count that TG6 renders). `candidateSaveBackService.ts` is shared with Spec #5 — build this AFTER #3.

In `candidateSaveBackService.ts`: (a) a NORMALIZED (non-exact, `0.7`) match driving a binding must NOT silently take the first match; (b) below-`0.75` candidates must be PERSISTED as reviewable with an explicit "below auto-accept" status + a run-summary count. **Reuse (do NOT fork) the identity primitive** `normalizeNameForMatch` and the `0.75` gate.

- [x] 5.0 Complete save-back guards
  - [x] 5.1 Write 2-8 focused tests for both guards (Jest)
    - Limit to 2-8 highly focused tests maximum
    - Test only: an EXACT (`1.0`) match binds silently (no Finding); a NORMALIZED (`0.7`, non-exact) match driving a binding is recorded as a low-confidence/reviewable binding OR emits a `possible_entity_collision` Finding (assert one or the other — e.g. `Order` vs `Orders`); a below-`0.75` candidate is PERSISTED as reviewable with the explicit "below auto-accept" status (not dropped); the run-summary below-gate COUNT is nonzero for a below-gate run (e.g. a whole Tier-C `llm-solo` run at `0.4`)
    - Skip exhaustive coverage of every binding type (relationship/enrich/link/request-response) — cover one binding path plus the count
  - [x] 5.2 Register the `possible_entity_collision` sentinel in `emissionSources.ts` (DONE by the discovery-service batch TG2-4: union member + `buildPossibleEntityCollisionFinding` already on HEAD; MCP emits the gapType STRING via `bulkCreateDiscoveryFindings`)
    - Add `possible_entity_collision` to the `EvidenceGapType` union next to `non_deterministic_endpoint` (from TG4), `scanner_failed`, and `low_confidence_candidate`; reuse the existing evidence-gap builder pattern
    - File: `discovery-service/src/services/findings/emissionSources.ts` (extend the same committed registry TG4 touched — do NOT duplicate)
  - [x] 5.3 Add the false-merge guard on normalized (non-exact) bindings
    - Only EXACT (`1.0`) matches bind silently. A NORMALIZED (fuzzy, `0.7`) match driving a relationship / enrich / link / request-response binding must EITHER be recorded as a low-confidence / reviewable binding OR emit a `possible_entity_collision` Finding — do NOT silently take the first match
    - **GUARD the existing `normalizeNameForMatch` primitive (`candidateSaveBackService.ts:354`) — do NOT replace it.** It folds case, strips separators, and blanket-singularizes (English-only), so it can false-bind distinct entities (`Order` vs `Orders`); it is the SAME shared primitive Spec #1's resolver upgraded and Spec #5's `data_movements` producer consumes — guard it in place
    - Optional best-effort: tighten the naive English-only singularization. The guard is the must-have; the singularization tweak is NOT required
    - File: `mcp-server/src/services/candidateSaveBackService.ts`
  - [x] 5.4 Verify-then-harden below-gate candidate persistence + run-summary count
    - FIRST verify the existing path already persists below-gate candidates as reviewable (it references "below the auto-accept gate -> reviewable candidate" at `L176`, `L2398-2404`, `L2596-2604`, `L2833`) — do NOT duplicate an already-working path
    - THEN harden: guarantee an explicit "below auto-accept" review status AND a run-summary COUNT; close any gap where a below-gate candidate is DROPPED instead of persisted-for-review; guarantee the count reaches the run summary (a whole Tier-C run sits below the gate — `llm-solo` scores `0.4`, `llmGapFillStep.ts ~L730`)
    - Keep the `0.75` auto-accept gate (`CANDIDATE_AUTO_ACCEPT_THRESHOLD`, `L72`) — do NOT auto-pollute the model with low-confidence guesses
    - File: `mcp-server/src/services/candidateSaveBackService.ts`
  - [x] 5.5 Mark 5.0 `- [x]` and run ONLY this group's tests
    - Run ONLY the 2-8 tests written in 5.1 (Jest, by test path — do NOT run the entire mcp-server suite)

- **CAUTION:** **W4**'s `scanner_failed` and the `non_deterministic_endpoint` sentinel (TG4) ALREADY sit in `emissionSources.ts` — **ADD `possible_entity_collision` NEXT TO them**; do NOT re-author the registry. **W2** is unaffected. **GUARD, do not replace** the `normalizeNameForMatch` / `0.75`-gate primitive (shared with Specs #1 and #5). `candidateSaveBackService.ts` is shared with Spec #5 (`data_movements` producer) — extend the committed version; Spec #5 builds AFTER #3. Build on `d3ebeca`; ADD/EXTEND only.

**Acceptance Criteria:**
- The 2-8 tests written in 5.1 pass (offline)
- EXACT matches bind silently; NORMALIZED matches are reviewable OR emit `possible_entity_collision`; nothing is silently first-match-bound
- Below-gate candidates are persisted as reviewable with an explicit "below auto-accept" status; the count reaches the run summary; nothing is dropped
- `normalizeNameForMatch` and the `0.75` gate are guarded in place, not replaced

**Per-group verification note:** Offline Jest unit tests green (the 5.1 file only). No live MCP server / discovery run; AMS save-back calls mocked.

---

### Frontend Layer

#### Task Group 6: Surface degraded + below-gate count; render the two new finding types
**Dependencies:** Task Groups 1-5 (renders the AMS `degraded` field from TG1, the below-gate count from TG5, and the two new finding sentinels from TG4/TG5)

Surface the `degraded` flag (with `degraded_reasons`) and the below-gate candidate count on the EXISTING run / readiness surface — NO bespoke widget — and render the two new finding types via the existing Findings UI.

- [x] 6.0 Complete frontend surfacing
  - [x] 6.1 Write 2-8 focused tests for the surfaced signals (Vitest)
    - Limit to 2-8 highly focused tests maximum
    - Test only: a `degraded` run shows the flag + its `degraded_reasons` on the run-detail surface the SAME way `warnings`/tier/status are shown; a non-degraded run shows nothing; the below-gate candidate count renders; `FINDING_TYPE_LABELS` has human labels for `non_deterministic_endpoint` and `possible_entity_collision` so they render in the drawer/tab
    - Skip exhaustive coverage of all run states and every findings filter
  - [x] 6.2 Render `non_deterministic_endpoint` + `possible_entity_collision` in the Findings UI
    - Add human-readable labels for both sentinels to `FINDING_TYPE_LABELS` (`Record<string, string>`) so `FindingsTab` / `FindingDetailDrawer` render them with **NO new component**
    - File(s): `frontend/src/components/Discovery/findingTypeLabels.ts` (label map); verify `FindingDetailDrawer.tsx` / `FindingsTab.tsx` pick up the new types
  - [x] 6.3 Surface `degraded` + `degraded_reasons` on the run-side surface
    - Render the flag + reasons on the verified run-detail component (`DiscoveryRunDetailView.tsx` — renders the run header status/architecture/created) the SAME way existing run metadata (`warnings`, tier, status) is shown; thread the field through the findings/run API type if needed
    - File(s): `frontend/src/components/Discovery/DiscoveryRunDetailView.tsx` (+ the run/findings API type module as needed)
  - [x] 6.4 Surface the below-gate candidate count on the readiness surface (VERIFIED: `belowGateCount` does NOT flow to the readiness wizard / `ReadinessAssessmentDto` -- TG1.5 skipped, the readiness DTO has no `degraded`/below-gate field. It DOES flow verbatim through the gateway save-approved proxy onto the frontend `saveApprovedCandidates` result, so it was surfaced on the EXISTING run-detail save-back outcome line in `DashboardView/DiscoveryRunDetailPage.tsx` -- the nearest existing surface that receives it -- with the type threaded onto `SaveApprovedResult`. No bespoke widget; `MigrationDeliveryPlanWizard.tsx` left untouched.)
    - Surface the below-gate count (from TG5's run summary) on the readiness side — the verified readiness component is `MigrationDeliveryPlanWizard.tsx` (under `components/ProductManager/MigrationDeliveryPlan/`) — matching how existing readiness/run metadata is shown; NO bespoke widget
    - If `degraded` is also exposed on `ReadinessAssessmentDto` (TG1.5), read it as **camelCase** here (the readiness DTO is camelCase; the run record is snake_case — read each per its own DTO convention)
    - File(s): `frontend/src/components/ProductManager/MigrationDeliveryPlan/MigrationDeliveryPlanWizard.tsx` (+ `migrationDeliveryPlanApi.ts` type as needed)
  - [x] 6.5 Mark 6.0 `- [x]` and run ONLY this group's tests
    - Run ONLY the 2-8 tests written in 6.1 (Vitest, by test path — do NOT run the entire frontend suite)

- **CAUTION:** **W2** / **W4** are backend-only and ALREADY committed — this group renders downstream signals; it does NOT touch the relays or the `scanner_failed` emission. Reuse the EXISTING run/readiness surface and Findings UI — **NO bespoke degraded-status widget** (out of scope). Match each DTO's casing (run = snake_case, readiness = camelCase). Build on `d3ebeca`; ADD only.

**Acceptance Criteria:**
- The 2-8 tests written in 6.1 pass (offline Vitest)
- `degraded` + `degraded_reasons` render on the existing run-detail surface the same way `warnings`/tier/status do; the below-gate count renders on the readiness surface; no bespoke widget
- `non_deterministic_endpoint` and `possible_entity_collision` render via `FindingsTab` / `FindingDetailDrawer` with no new component

**Per-group verification note:** Offline Vitest unit tests green (the 6.1 file only), with API modules mocked — no live backend.

---

## Execution Order

Recommended implementation sequence (strict layering):
1. **AMS Persistence** — Task Group 1 (the `degraded` field/column the whole spec surfaces)
2. **Discovery run-integrity** — Task Group 2 (compute degraded; wire `filesFailed`)
3. **Discovery gap-fill cache** — Task Group 3 (reproducibility)
4. **Discovery non-deterministic scanner** — Task Group 4 (new sentinel + scanner)
5. **MCP save-back guards** — Task Group 5 (false-merge guard + below-gate hardening)
6. **Frontend** — Task Group 6 (surface degraded + below-gate count; render new finding types)

---

## Phase-2 Build Ordering & File-Overlap

**Position:** This is Spec **#3 of 6** in the Phase-2 "oracle perfection" program. It is built **STRICTLY SEQUENTIALLY after Spec #1 (response-contract scanner) and Spec #2 (capture-coverage seeding + method/token caps)** — never in parallel. Specs #1-#2 are COMMITTED on HEAD `d3ebeca` ("specs 2 of 6 complete"). #3 reads signals produced by #1 (contract-pass-failed) and #2 (method/token cap-hit) as degraded triggers, and extends their committed scanners + run/readiness DTO rather than racing them.

**Already on HEAD (extend, do NOT redo):**
- **W2** — `temperature: 0` on the gap-fill / behaviour / decision LLM relays in `gateway/src/routes/discovery*.ts`. The new gap-fill cache key (TG3) CONSUMES this temperature; the relay stays the single LLM path.
- **W4** — `scanner_failed` evidence-gap Finding at soft-fail catch sites in `discoveryV3Pipeline.ts` + `packFindingScanners/index.ts`, sentinel in `emissionSources.ts`. TG2 ESCALATES this existing Finding to the run-level degraded signal (reads it, does not re-emit it); TG4 adds a NEW sentinel beside it.

**Build layering across this spec (strict):** AMS (TG1) -> discovery-service (TG2 integrity, TG3 cache, TG4 scanner) -> MCP save-back (TG5) -> frontend (TG6).

**Cross-cutting files shared with sibling specs — extend the committed version, do NOT duplicate or race:**
- `discovery-service/src/services/discoveryV3Pipeline.ts` and `runManager.ts` — shared with **#1** (response-contract scanner), **#4** (inbound scanners), **#5 / #6** (resolvers). This spec adds degraded computation (TG2) + `filesFailed` wiring (TG2) + the `non_deterministic_endpoint` scanner (TG4) + the gap-fill cache (TG3). Built AFTER #1/#2 landed their changes here.
- `discovery-service/src/services/findings/emissionSources.ts` — shared sentinel registry (already holds W4's `scanner_failed` + `low_confidence_candidate`; #1/#4 add their own). This spec ADDS `non_deterministic_endpoint` (TG4) and `possible_entity_collision` (TG5) next to them.
- `mcp-server/src/services/candidateSaveBackService.ts` — shared with **#5** (`data_movements` producer) and **#1**'s identity-primitive upgrade. This spec adds the false-merge guard + below-gate hardening (TG5) on the SAME `normalizeNameForMatch` / `0.75`-gate primitive; guard it in place. **Spec #5 builds AFTER #3.**
- The run / readiness DTO (`DiscoveryRunDto` + `ReadinessAssessmentDto`) — shared with **#2** (seeding). This spec ADDS the advisory `degraded` field (TG1) to the version #2 committed; it does not re-author the DTO.

**In-flight-run constraint:** Discovery groups (TG2, TG3, TG4) must NOT be edited during an in-flight discovery run — `tsx watch` auto-reload kills active runs (project memory `no_src_edits_during_run`). Make discovery-service edits only when no run is active.

**Net rule for this spec:** Build ON the committed base (HEAD `d3ebeca`, Specs #1-#2 done); **ADD / EXTEND only — do NOT revert or re-author** any committed W2/W4/Spec-#1/Spec-#2 artifact.
