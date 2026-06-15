# Task Breakdown: Business-logic behaviour capture for discovery (Java / Spring Classic first) — Gap C

## Overview
Total Tasks: 4 task groups (1 parent task each)

Layering / dependency order (per spec.md "Layering order"):
**AMS meta-model (schema gate) → discovery-service (capture stage) → frontend (render)**.
The frontend (Group 3) consumes the snake_case `behavior` block exposed by Group 1 and
produced by Group 2; it is dependency-ordered last but does not strictly require Group 2
to be runtime-complete (it tolerates a missing/malformed block and renders a stub).

Hard constraints carried into every group (from spec.md + CLAUDE.md + memory):
- AMS wire is **snake_case by default**; the `behavior` column / DTO get **NO `@CamelCaseWire`**.
- **NEVER edit an applied Liquibase changeset** (including `015-business-logic.sql` and any `<= 161`);
  comment-only edits break startup via checksum validation. Add a **NEW** changeset only.
- **No direct LLM call from discovery-service** — all LLM access goes through the existing
  gateway relay (`gatewayClient`), exactly like `llmGapFillStep.ts`.
- **No new candidate types** — the block attaches to the EXISTING `business_logics` candidate,
  keyed by the stable method id `FQN#name(ParamTypes)` Spec 1 already stamps.
- **Do NOT edit `discovery-service/src/**` while a discovery run is in flight** (tsx watch
  auto-reload kills runs) — schedule Group 2 edits only when no run is active.
- **Boxed `Double`** for confidence so PATCH preserves null (per `project_primitive_double_dto_overwrite.md`).
- v1 scope = **Java / Spring Classic, inbound-HTTP-only** (inherited from Spec 1's edge scope).
  Shape-spec / book-of-work generation wiring is **OUT OF SCOPE** (persist + expose + display only).

## Task List

### AMS Meta-Model Layer

#### Task Group 1: `behavior` JSONB column on the business-logic entity + read-DTO exposure
**Dependencies:** None

Add ONE `behavior` JSONB column to the EXISTING `business_logics` table via a NEW Liquibase
changeset, map it on the JPA entity / DTO / mapper, and expose it on the AMS read DTO keyed by
the method id. Model the JSONB + confidence handling on Spec 1's `161-endpoint-data-effects.sql`
(JSONB passthrough `Map` + boxed `Double` confidence). The internal `schema_version` and
`source_hash` live INSIDE the JSONB blob (loose, no migration as the shape evolves — mirrors
`path_metadata_json`); they are NOT separate columns.

- [x] 1.0 Complete AMS meta-model layer
  - [x] 1.1 Write 2-8 focused Java tests for the `behavior` column and DTO exposure
    - Mirror the existing Spec 1 test conventions:
      `architecture-model-service/src/test/java/com/example/architecturemodel/migration/EndpointDataEffectsChangesetTest.java`
      (changeset applies + column exists) and
      `.../repository/discovery/EndpointDataEffectPersistenceTest.java` (JPA round-trip).
    - Limit to 2-8 highly focused tests. Cover only: (a) the NEW changeset adds a `behavior`
      JSONB column to `business_logics` (column exists, type jsonb); (b) a `BusinessLogicEntity`
      with a populated `behavior` map persists and re-reads as the same structured map
      (round-trip, no field loss); (c) `behavior` round-trips through the DTO at the wire as
      `snake_case` key `behavior` with the embedded confidence preserved as a boxed `Double`
      (null preserved on PATCH-style write).
    - Skip exhaustive coverage of every sub-field shape (the blob is loose JSONB).
  - [x] 1.2 Create the NEW Liquibase changeset SQL file
    - File: `architecture-model-service/src/main/resources/db/changelog/sql/162-business-logic-behavior.sql`
      (NEXT FREE number — verified: highest existing is `161-endpoint-data-effects.sql`).
    - `ALTER TABLE business_logics ADD COLUMN behavior JSONB;` — one nullable JSONB column.
    - Header comment: explain the block carries internal `schema_version` + `source_hash`
      (loose JSONB, no migration as the shape evolves — `path_metadata_json` precedent) and the
      embedded confidence is `DOUBLE PRECISION` inside the JSONB mapped to boxed `Double`.
    - Do NOT touch `015-business-logic.sql` or any applied changeset.
  - [x] 1.3 Register the changeset in the master changelog
    - File: `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`.
    - Append a `- changeSet:` block AFTER `161-endpoint-data-effects`, matching that block's
      shape: `id: 162-business-logic-behavior`, `author: architecture-tool`, a `preConditions`
      guard (`onFail: MARK_RAN`, `not: columnExists` on `business_logics.behavior`), and
      `changes: - sqlFile: path: db/changelog/sql/162-business-logic-behavior.sql`,
      `relativeToChangelogFile: false`.
  - [x] 1.4 Add the `behavior` field to `BusinessLogicEntity`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/BusinessLogicEntity.java`.
    - Add `@Type(JsonType.class) @Column(name = "behavior", columnDefinition = "jsonb")
      private Map<String, Object> behavior;` — copy the exact JSONB-via-Hypersistence idiom from
      `EndpointDataEffectEntity.pathMetadataJson` (`io.hypersistence.utils.hibernate.type.json.JsonType`).
      Boxed reference `Map` type so a PATCH carrying no value preserves the column content.
  - [x] 1.5 Add the `behavior` field to `BusinessLogicDto`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/BusinessLogicDto.java`.
    - Add `@JsonProperty("behavior") Map<String, Object> behavior` to the record.
    - snake_case wire (global default); NO `@CamelCaseWire`. The embedded confidence stays a
      boxed `Double` inside the map shape the LLM emits — never a top-level primitive.
  - [x] 1.6 Map the field through `EntityMapper`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java`.
    - Extend `toDto(BusinessLogicEntity)` (~line 916) and `toEntity(BusinessLogicDto, String)`
      (~line 928) to carry `behavior` through in both directions (passthrough `Map`, no field loss).
    - Confirm the read-DTO assembly path (`MetaModelEntitiesDto` / `ModelService`) surfaces the
      already-mapped `BusinessLogicDto.behavior` so a future shape-spec / book-of-work step can
      read the block keyed by the method id — no separate assembly change needed beyond the mapper.
  - [x] 1.7 Ensure AMS meta-model layer tests pass
    - Run ONLY the 2-8 tests written in 1.1 (e.g. `mvn -Dtest=BusinessLogicBehavior*Test test`
      plus the touched `BusinessLogicIntegrationTest` if extended).
    - Verify the changeset applies on a clean test DB and the entity/DTO round-trip holds.
    - Do NOT run the entire AMS test suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass.
- A NEW `162-business-logic-behavior.sql` changeset adds a nullable `behavior` JSONB column to
  `business_logics`; `015-business-logic.sql` and all `<= 161` changesets are untouched.
- `BusinessLogicEntity` / `BusinessLogicDto` carry `behavior` as a passthrough JSONB `Map`;
  the embedded confidence is a boxed `Double` (null-preserving on PATCH).
- Wire format is snake_case (`"behavior"`); NO `@CamelCaseWire` is applied.
- The block is exposed on the business-logic read DTO, keyed by the method id Spec 1 stamps.

### Discovery-Service Extraction Layer

#### Task Group 2: `llmBehaviourCaptureStep.ts` — per-method LLM behaviour capture stage
**Dependencies:** Task Group 1 (the `behavior` block shape the stage writes is the column added in 1).
**Scheduling constraint:** make these `discovery-service/src/**` edits ONLY when no discovery run
is in flight (tsx watch auto-reload kills runs).

Add a NEW sibling per-METHOD discovery stage that reuses the gap-fill conventions
(`gatewayClient` relay, hand-rolled `promisePool` concurrency, `getConfidenceForTag`,
`failures[]` + max-failure-rate → stage `failed`), driven by a DETERMINISTIC method selector,
tier-gated like gap-fill, with per-run method + token caps and `source_hash` caching. It attaches
the 7-part block to the EXISTING `business_logics` candidate keyed by `FQN#name(ParamTypes)`.
Do NOT overload `llmGapFillStep.ts` — distinct sibling, same idioms.

- [x] 2.0 Complete discovery-service extraction layer
  - [x] 2.1 Write 2-8 focused tests for the selector, caching, and stage
    - Use the existing discovery test conventions (Jest, `src/__tests__/`, alongside
      `endpointDataEffectResolver.test.ts`, `gatewayClientGapFill.test.ts`, `confidenceModule.test.ts`).
    - Limit to 2-8 highly focused tests. Cover only the critical behaviours:
      (a) the deterministic selector INCLUDES a `business_logics` candidate that is
      endpoint-reachable + non-boilerplate, and EXCLUDES getters/setters/`equals`/`hashCode`/
      `toString`/builders + Lombok-generated + `@Override` callbacks + trivial one-liners, while
      ALWAYS including `@Transactional` methods / custom-exception throwers / endpoint→data-path
      methods; (b) `source_hash` cache HIT skips the LLM call and carries the prior `behavior`
      block forward verbatim on unchanged hash; (c) the stage parses a well-formed 7-part block
      response into the candidate's `behavior` (keyed by method id) and records stage metrics;
      (d) failure-rate gating marks the stage `failed` past the env threshold (mirror
      `GAP_FILL_MAX_FAILURE_RATE` behaviour).
    - Mock `gatewayClient` (no real LLM call). Skip exhaustive prompt-shape assertions.
  - [x] 2.2 Add a behaviour-capture confidence tag to `confidence.ts`
    - File: `discovery-service/src/services/confidence.ts`.
    - Add `'llm-behaviour-capture'` to `ConfidenceTagKey`, `CONFIDENCE_DEFAULTS`,
      `CONFIDENCE_RANGES`, `ENV_VAR_NAMES`, and `classifyTag()` (new env override, e.g.
      `CONFIDENCE_LLM_BEHAVIOUR_CAPTURE`). Reuse the existing clamp/midpoint logic via
      `getConfidenceForTag` — do NOT invent a parallel confidence scheme. Blocks are
      confidence-scored, never presented as proven.
  - [x] 2.3 Implement the deterministic method SELECTOR
    - A method qualifies only if ALL hold: (i) it is a `business_logics` candidate, AND
      (ii) it is endpoint-reachable via Spec 1's call graph, AND (iii) it survives a
      DETERMINISTIC boilerplate exclusion. No LLM judgement in the selector (bound cost,
      reuse Spec 1's work).
    - Endpoint-reachability: reuse Spec 1's resolver output (`resolveEndpointDataEffects` /
      `PathHop.methodId` in
      `extensionPacks/frameworkAdapters/springClassic/endpointDataEffectResolver.ts`) — the
      set of method ids on a resolved endpoint→data path. Do NOT re-derive a new call graph.
    - Key on the stable method id `FQN#name(ParamTypes)` (`method.methodId` / `methodIdOf`);
      do NOT introduce a new key.
    - EXCLUDE: getters/setters/`equals`/`hashCode`/`toString`/builders, Lombok-generated
      methods, framework `@Override` callbacks, trivial one-liners.
    - ALWAYS INCLUDE: `@Transactional` methods, custom-exception throwers, anything on an
      endpoint→data path (the include rules override the boilerplate exclusion).
  - [x] 2.4 Implement `source_hash` computation + caching
    - `source_hash` = hash of the NORMALIZED method body PLUS the signatures/bodies of the
      1-hop callees actually fed to the LLM.
    - On re-run: if the stored `source_hash` on the prior `behavior` block is unchanged, SKIP
      the LLM call and carry the prior block forward verbatim (cache hit). Track cache-hit count.
    - Do NOT invalidate the block on Spec 1 data-effect edge changes — edges are LINKED live at
      render/consume time, not embedded in the block, so edge churn must not force re-capture.
  - [x] 2.5 Implement the LLM call (gateway relay) + 1-hop depth + prompt
    - Create `discovery-service/src/services/llmBehaviourCaptureStep.ts` (NEW sibling — do NOT
      modify `llmGapFillStep.ts`).
    - LLM analysis DEPTH = the method body + 1 hop of DIRECT-callee bodies only; the callee cap
      is env-tunable (no unbounded fan-out).
    - Call via `gatewayClient` (the gateway relay) — NOT a direct LLM call. Reuse the `prompts/`
      composer idiom; prompt the LLM to emit EXACTLY the documented 7-part shape (IO; validation/
      preconditions + error/exception→HTTP/SOAP; transformation/computation; data effects;
      side effects; edge cases; provenance + confidence). Parse + tolerate malformed responses
      per the gap-fill `parseAndValidate` precedent (failure recorded, run continues).
    - Reuse the hand-rolled `promisePool` concurrency limiter (env-tunable) and the `failures[]`
      + max-failure-rate → stage `failed` handling. Score the block confidence via
      `getConfidenceForTag('llm-behaviour-capture', …)`.
    - Attach the resulting 7-part block to the existing `business_logics` candidate's `behavior`,
      keyed by `FQN#name(ParamTypes)`, with `schema_version` + `source_hash` embedded.
  - [x] 2.6 Wire the stage into `discoveryV3Pipeline.ts`, tier-gated, with caps + metrics
    - File: `discovery-service/src/services/discoveryV3Pipeline.ts`.
    - Run as part of the existing LLM stages, TIER-GATED exactly like gap-fill (driven by the
      run's computed tier A/B/C — the `tier` already threaded through the pipeline) — NOT a
      separate off-by-default opt-in flag (avoid a built-but-never-runs feature).
    - Bound cost: env-tunable per-run METHOD cap + TOKEN ceiling, on top of the selector keeping
      the set small.
    - Persist stage metrics on the run's `steps_payload` ALONGSIDE the gap-fill metrics
      (`v3.gapFill` precedent → add e.g. `v3.behaviourCapture`): processed / skipped / cache-hit /
      failures / stage status. Follow the load-merge-write pattern used for the gap-fill metrics.
  - [x] 2.7 Ensure discovery-service extraction layer tests pass
    - Run ONLY the 2-8 tests written in 2.1 (e.g. the new behaviour-capture/selector specs in
      `discovery-service/src/__tests__/`).
    - Confirm no real LLM call is made (gateway relay is mocked).
    - Do NOT run the entire discovery test suite at this stage. Do NOT run while a scan is active.

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass; `gatewayClient` is mocked (no direct LLM call).
- The selector is deterministic and honours every include/exclude rule, keyed by `FQN#name(ParamTypes)`.
- `source_hash` cache HIT skips the LLM and reuses the prior block; Spec 1 edge changes do NOT invalidate it.
- The stage uses the gateway relay, the shared `promisePool`, `getConfidenceForTag`, and failure-rate gating.
- The stage is TIER-GATED like gap-fill (not off-by-default) with per-run method + token caps; metrics land on `steps_payload`.
- The 7-part block attaches to the existing `business_logics` candidate's `behavior` (no new candidate type).

**End-to-end seams closed by Task Group 2 (verified, with tests):**
- **Seam 1 — gateway relay (no direct LLM call):** the existing `/v3/gap-fill` gateway route
  is a GENERIC stateless prompt relay (the doc comment + `gatewayClient.callTechHintsLlm`
  reusing it both confirm this), so it is NOT gap-fill-specific. To give behaviour-capture
  its own observable seam following the spec's "sibling relay route + client method, same
  pattern" intent, a SIBLING route `POST /api/v1/discovery/v3/behaviour-capture`
  (`gateway/src/routes/discoveryBehaviourCapture.ts`, exported from `routes/index.ts`, mounted
  in `server.ts`) + a `gatewayClient.captureBehaviour(prompt, methodId, runId)` method
  (`discovery-service/src/services/gatewayClient.ts`, with a typed
  `BehaviourCaptureGatewayError`) were added. The stage calls only the relay — never the LLM
  directly. Tests: `gateway/src/__tests__/discoveryBehaviourCapture.test.ts` (3),
  `discovery-service/src/__tests__/gatewayClientBehaviourCapture.test.ts` (2).
- **Seam 2 — MCP save-back persistence:** the block rides on the `business_logics` candidate's
  `data.behavior` (auto-stored in `discovery_candidates.data` via `bulkSaveCandidates` ->
  `mapCandidateToBackend`, which passes `data` through verbatim — verified). On save-approved,
  the MCP `candidateSaveBackService.convertCandidateToEntity` `business_logics` branch now maps
  `candidate.data.behavior` -> the AMS `business_logics.behavior` JSONB column (added in Group 1);
  absent block leaves the column unset. Test:
  `mcp-server/src/__tests__/candidateSaveBackBehaviour.test.ts` (2).

### Frontend Layer

#### Task Group 3: Read-only expandable 7-part behaviour block in the candidate-details panel
**Dependencies:** Task Group 1 (snake_case `behavior` on the read DTO). Renders the block Group 2 produces.

Render the 7-part block read-only + EXPANDABLE + confidence badge in the EXISTING
`business_logics` candidate-details panel, reusing the `EndpointDataEffectPathBlock` pattern.
VIEW-ONLY (no accept/reject/edit on the block). Tolerate a missing/malformed block by rendering
nothing / a stub — never throw.

- [x] 3.0 Complete frontend layer
  - [x] 3.1 Write 2-8 focused Vitest tests for the behaviour block
    - Use the existing frontend test conventions (Vitest, `vi.mock`), alongside
      `frontend/src/components/DashboardView/__tests__/endpointDataEffectCandidate.test.tsx`.
    - Limit to 2-8 highly focused tests. Cover only: (a) a `business_logics` candidate carrying
      a well-formed `behavior` block renders the 7 sections collapsed by default and expands on
      the disclosure toggle (`aria-expanded` flips); (b) the confidence badge reflects the
      block's confidence using the existing low-confidence visual treatment; (c) a candidate with
      a missing OR malformed `behavior` renders nothing / a stub and does NOT throw; (d)
      `supportsDetails('business_logics')` returns true.
    - Skip exhaustive per-section content assertions and full a11y/responsive coverage.
  - [x] 3.2 Add `business_logics` to `SUPPORTED_DETAIL_TYPES`
    - File: `frontend/src/components/DashboardView/candidateDetailsSupport.ts`.
    - Add `'business_logics'` to the `SUPPORTED_DETAIL_TYPES` set so the candidate gains an
      expandable details surface (mirrors how `endpoint_data_effects` was added).
  - [x] 3.3 Add the snake_case typings for the `behavior` block
    - Extend the `DiscoveryCandidateDto` (snake_case) typing so `behavior` is readable on a
      `business_logics` candidate. Type the 7-part shape loosely (optional sub-fields, prose as
      strings) to match the loose JSONB — tolerate partial / extra fields. snake_case keys.
  - [x] 3.4 Implement the read-only expandable `BehaviourBlock` component
    - File: `frontend/src/components/DashboardView/CandidateDetailsPanel.tsx`.
    - Add a `BehaviourBlock` component mirroring `EndpointDataEffectPathBlock` (~lines 92-165):
      a local `useState` toggle, `aria-expanded`, a Show/Hide disclosure control, per-section
      `data-testid`s, and a malformed-tolerant reader (return `null` when no usable block —
      same idiom as `buildEndpointDataEffectPathHops` returning `[]`).
    - Render the 7 parts section-by-section (IO; validation/preconditions; transformation/
      computation; data effects; side effects; edge cases; provenance + confidence).
    - Render a confidence badge using the EXISTING low-confidence visual treatment (reuse the
      established styling — do not invent a new scheme).
    - VIEW-ONLY: no accept/reject/edit controls on the block.
  - [x] 3.5 Render the block conditionally for `business_logics` candidates
    - In `CandidateDetailsPanel` (~line 179-196), add a guard
      `candidate.candidate_type === 'business_logics'` and render `<BehaviourBlock candidate={…} />`
      conditionally — mirroring the existing `isEndpointDataEffect && <EndpointDataEffectPathBlock/>`.
  - [x] 3.6 Ensure frontend layer tests pass + no NEW tsc errors
    - Run ONLY the 2-8 tests written in 3.1 (the new behaviour-block spec + the
      `candidateDetailsSupport` assertion).
    - Confirm no NEW TypeScript errors are introduced (frontend `tsc` has ~513 PRE-EXISTING
      baseline errors unrelated to this work — the bar is **no NEW errors**, not zero errors).
    - Do NOT run the entire frontend test suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass.
- `business_logics` is in `SUPPORTED_DETAIL_TYPES`; `supportsDetails('business_logics')` is true.
- The 7-part block renders read-only + expandable (`aria-expanded`, Show/Hide, per-section `data-testid`)
  with a confidence badge using the existing low-confidence visual treatment.
- A missing / malformed `behavior` block renders nothing / a stub and never throws.
- No accept/reject/edit actions on the block (view-only). snake_case typings.
- No NEW `tsc` errors beyond the ~513 pre-existing baseline.

### Testing

#### Task Group 4: Test Review & Gap Analysis
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 2-8 Java tests from Group 1 (1.1), the 2-8 discovery tests from Group 2 (2.1),
      and the 2-8 Vitest tests from Group 3 (3.1). Total existing: ~6-24 tests.
    - Reviewed: Group 1 = `BusinessLogicBehaviorChangesetTest` (1) + `BusinessLogicBehaviorPersistenceTest`
      (5) + the extended `BusinessLogicIntegrationTest` (AMS PUT->GET round-trip through ModelService);
      Group 2 = `llmBehaviourCaptureStep.test.ts` (8: selector include/exclude, source_hash determinism,
      stage parse, cache hit/miss, failure-rate) + the two relay seams
      (`gatewayClientBehaviourCapture.test.ts` 2, `discoveryBehaviourCapture.test.ts` 3) + the MCP
      save-back seam (`candidateSaveBackBehaviour.test.ts` 2); Group 3 = `behaviourBlockCandidate.test.tsx`
      (7) + `supportsDetails.test.ts` (4).
  - [x] 4.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end gaps SPECIFIC to this feature: e.g. a selected method's
      7-part block flows discovery → AMS persistence (snake_case `behavior`) → frontend render;
      and the cache-skip path carries an unchanged block forward end-to-end.
    - Do NOT assess whole-application coverage. Prioritize the capture→persist→display workflow
      and the selector/cache integration over unit-level edge cases.
    - Gaps found (each LAYER tested in isolation, the SEAMS untested): (1) the snake_case
      `behavior` wire-shape contract ACROSS the discovery→AMS-DTO→frontend-reader seam (no test
      asserts the keys the writer emits == the keys the reader consumes); (2) selector ∩
      Spec-1-reachability INTEGRATION on real IR (Group 2 hand-builds the reachable Set rather
      than feeding the real `resolveEndpointDataEffects` output); (3) tier-gating + per-run cap
      honoured by the PIPELINE wiring (`discoveryV3Pipeline.test.ts` mocks only `runLlmGapFill`
      and never exercises the behaviour-capture stage); (4) pipeline-level cache-skip via the real
      `getCandidatesByRun` -> `buildPriorBehaviourBlocks` seam carrying an unchanged block forward.
  - [x] 4.3 Write up to 10 additional strategic tests maximum
    - Add a MAXIMUM of 10 new tests to fill identified critical gaps (integration / end-to-end
      points only). Skip edge cases, performance, and accessibility tests unless business-critical.
    - Likely highest-value: (a) round-trip integrity of the `behavior` block snake_case wire
      shape AMS↔consumer; (b) selector ∩ Spec-1-reachability integration over a small realistic
      Spring IR fixture; (c) tier-gating + per-run cap honoured by the pipeline wiring.
    - Added 7 new tests (within the 10 cap):
      `discovery-service/src/__tests__/behaviourCapturePipelineIntegration.test.ts` (4 — drives the
      REAL `runDiscoveryV3` over a REAL parsed Spring slice with the REAL resolver→selector→capture
      chain: selector ∩ real-reachability + block flows to persist + `v3.behaviourCapture` metrics;
      per-run method cap of 1 over 2 selected methods → exactly one LLM call; Tier C gated out;
      pipeline-level cache-skip via the real `getCandidatesByRun` seam) and
      `frontend/src/components/DashboardView/__tests__/behaviourBlockWireRoundTrip.test.tsx` (3 — the
      snake_case `behavior` shape the discovery stage writes survives the AMS snake_case wire and the
      frontend reader maps all 7 parts + confidence; full render through `CandidateDetailsPanel`;
      negative cross-seam guard proving the reader keys strictly on snake_case yet never throws).
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY the tests related to THIS feature (1.1, 2.1, 3.1, and 4.3). Expected total:
      ~16-34 tests. Do NOT run the entire application test suite.
    - Frontend bar remains "no NEW tsc errors". Discovery edits only when no run is active.
    - Result: Java Group-1 dedicated behaviour tests pass (6: changeset + persistence/DTO/mapper);
      discovery feature tests pass (14 = 8 stage + 2 gatewayClient + 4 new pipeline integration);
      MCP save-back passes (2); frontend feature tests pass (14 = 7 block + 4 supportsDetails +
      3 new wire round-trip). Total feature-specific passing: 36. Frontend `tsc` = 513 errors
      (matches the pre-existing baseline; the new test file adds ZERO new errors).
    - DEVIATION (pre-existing, unrelated): `BusinessLogicIntegrationTest` (`@SpringBootTest`) has 5
      pre-existing environmental errors that predate this spec and are unrelated to the `behavior`
      column — `ui_characteristics."key"` (H2 reserved word, fails in the full-model load BEFORE any
      behaviour assertion is reached) and `applications.abbreviation NOT NULL` (test-fixture omits a
      required column). Neither query references `business_logics.behavior`. The behaviour-block
      round-trip through `ModelService` is independently covered by the 6 dedicated isolated
      `@DataJpaTest`/direct-SQL Group-1 tests, all green.

**Acceptance Criteria:**
- All feature-specific tests pass (~16-34 tests total).
- The capture → persist (snake_case `behavior`) → display workflow is covered end-to-end.
- No more than 10 additional tests added; testing focused exclusively on this spec's requirements.

## Execution Order

Recommended implementation sequence (per spec.md layering: AMS → discovery → frontend):
1. AMS Meta-Model Layer (Task Group 1) — the schema gate; NEW changeset `162`, entity/DTO/mapper, read-DTO exposure.
2. Discovery-Service Extraction Layer (Task Group 2) — `llmBehaviourCaptureStep.ts`, deterministic selector, `source_hash` caching, tier-gated pipeline wiring (edit only when no run is active).
3. Frontend Layer (Task Group 3) — `SUPPORTED_DETAIL_TYPES` + read-only expandable behaviour block + confidence badge.
4. Test Review & Gap Analysis (Task Group 4) — fill critical end-to-end gaps only (max 10 tests).
