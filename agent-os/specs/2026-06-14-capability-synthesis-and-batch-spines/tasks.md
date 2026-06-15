# Task Breakdown: D2 — Capability Synthesis + Batch Spines

## Overview
Total Tasks: 6 task groups

This is D2 (the structural centerpiece) of the 6-spec discovery-completeness program. D1
(operational_artifact findings pass + gateway summariser relay) is BUILT. D2 produces ONLY
`discovery_capability` records + members + the batch spines; downstream consumption (keystone,
book-of-work, modernisation spec-gen) is out of scope.

D2 carries the only Liquibase changeset in the whole program: 184. Build the AMS persistence
foundation FIRST (Group 1) because every discovery-service synthesis write (Group 4) and the
frontend read (Group 5) depend on the capability + member endpoints existing.

**Cross-cutting constraints (apply to every group):**
- snake_case wire is the global default; the new capability entity has NO camelCase consumer, so
  NO `@CamelCaseWire`. All PATCH-mutable numerics are boxed (`Double`, not `double`) with
  null-guards in the update handler (avoid the primitive 0-on-PATCH wipe).
- discovery-service is TypeScript; only edit `discovery-service/src/**` when NO discovery run is
  active (tsx watch auto-reload kills active runs).
- Reuse the EXISTING Java tree-sitter IR; NEVER add a bare top-level `require('tree-sitter')` in a
  parser (use the shared binding cache).
- LLM is naming-only, temperature 0, source-hash cached, and MOCKED in all tests (no live LLM).
- NEW changeset 184 only — never edit an applied changeset; register after 183 in
  `db.changelog-master.yaml`.

## Task List

### AMS Persistence Layer

#### Task Group 1: `discovery_capability` Foundation (changeset 184)
**Dependencies:** None
**Owner:** AMS (Java / Spring Boot)

- [x] 1.0 Complete the AMS capability + membership persistence and endpoints
  - [x] 1.1 Write 2-8 focused tests for the capability persistence + endpoints
    - Limit to 2-8 highly focused tests maximum
    - Cover only critical behaviours: changeset 184 applies on H2; capability create + member
      bulk-create round-trip (snake_case wire, JSONB `detail_json` survives); patch-review records
      `previous_review_status` and does NOT wipe boxed `confidence` on a partial PATCH
    - Skip exhaustive coverage of every field, endpoint, and error path
  - [x] 1.2 Author `sql/184-discovery-capability.sql` with TWO tables
    - `discovery_capability`: `id`, `run_id`, `project_id`, `architecture_id`, `name`,
      `kind` (TEXT, NO DB enum), `summary`, `review_status` (default `pending_review`),
      `previous_review_status`, `confidence` (nullable double), `detail_json` (JSONB),
      `source`, `created_by_stage`, `created_at`, `updated_at`
    - `discovery_capability_member`: `id`, `capability_id` (FK → `discovery_capability(id)`,
      indexed, ON DELETE CASCADE), polymorphic `member_type` + `member_id`, timestamps
    - Indexes on the read keys (`run_id`, `project_id`, `architecture_id`, `review_status`;
      `capability_id` on the member table)
    - Replicate the comment-rich, boxed-type, snake_case style of
      `sql/183-migration-reconciliation-break.sql` (the verified template; 184 is next)
    - Register 184 AFTER 183 in `db.changelog-master.yaml`
  - [x] 1.3 Create `DiscoveryCapabilityEntity` + `DiscoveryCapabilityMemberEntity`
    - Mirror `DiscoveryFindingEntity`: boxed `Double confidence`, String `review_status`
      defaulting `pending_review`, String `previous_review_status` audit field,
      `@Type(JsonType.class)` JSONB `detailJson`, `@PrePersist`/`@PreUpdate` timestamps
    - Member entity: polymorphic `member_type` (String) + `member_id`, FK back to capability
    - `member_type` value set: `discovery_finding`, `discovery_candidate`, `architecture_element`,
      `discovery_relationship`
  - [x] 1.4 Create the DTOs + MapStruct/mapper + repositories
    - Follow the `member_type`/`member_id` snake_case shape from `DiscoveryClusterMemberDto`
      (the polymorphic-member precedent) — but DO NOT reuse the `@deprecated` `DiscoveryCluster`
      entity itself
    - snake_case wire; NO `@CamelCaseWire`
    - Repositories for capability + member (find by run/project/architecture)
  - [x] 1.5 Create `DiscoveryCapabilityController` + service
    - Endpoints mirroring `DiscoveryFindingController` conventions: GET list, GET `/{id}`,
      POST create, POST `/bulk` (bulk-create), review mutation (patch-review)
    - patch-review records `previous_review_status`; approve/reject does NOT cascade to members
      in D2 (members keep independent `review_status`)
    - Boxed PATCH-mutable types with null-guards in the update handler
    - KEEP the patch-review endpoint despite the read-only UI — forward-needed by the D4-gate spec
  - [x] 1.6 Confirm the finding-link mechanism is untouched
    - `discovery_finding` is in the capability `member_type` set BUT must stay OUT of
      `DiscoveryFindingLink`'s `ALLOWED_LINK_TARGET_TYPES`
      (`service/discovery/DiscoveryFindingService.java`) — different mechanism, do not extend it
  - [x] 1.7 Ensure AMS capability tests pass
    - Run ONLY the 2-8 tests written in 1.1 via targeted FOREGROUND `mvn` (H2 2.3 estate)
    - Verify changeset 184 applies and the create/bulk/patch round-trips work
    - Do NOT run the entire AMS test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass (targeted foreground `mvn`, H2)
- Changeset 184 applies cleanly and is registered after 183 in the master changelog
- Capability + member create/bulk-create/patch-review work over snake_case wire; `detail_json`
  JSONB survives the round-trip
- Partial PATCH does NOT wipe boxed `confidence`; `previous_review_status` is recorded
- `DiscoveryFindingLink.ALLOWED_LINK_TARGET_TYPES` is unchanged

### Batch-Spine Extractors (discovery-service)

#### Task Group 2: Autosys JIL Parser
**Dependencies:** None (consumed by Group 4; parser output is self-contained)
**Owner:** discovery-service (TypeScript)

- [x] 2.0 Complete the hand-rolled JIL parser
  - [x] 2.1 Write 2-8 focused tests for the JIL parser
    - Limit to 2-8 highly focused tests maximum
    - Use fixture `.jil` files; cover only: box + jobs parse into topology, a file-watcher job
      (`job_type f`) is recognised, DAG `condition` variants (success / done / notrunning /
      failure) parse into edges, and an unknown keyword lands in the `attributes` bag without a
      hard failure
    - Skip exhaustive coverage of every keyword and dialect
  - [x] 2.2 Implement the hand-rolled key:value `.jil` parser
    - Hand-rolled key:value parsing (NOT tree-sitter); NO bare `require('tree-sitter')`
    - Recognise the keyword subset: `insert_job`, `job_type` (c / b / f), `box_name`, `command`,
      `machine`, `condition` (success / done / notrunning / failure), `start_times`, `start_mins`,
      `days_of_week`, `run_calendar`, `alarm_if_fail`, `std_out_file` / `std_err_file`
    - Unknown keywords → a generic `attributes` bag (tolerate dialects, no hard failure)
  - [x] 2.3 Produce the structured topology object
    - Emit boxes / jobs / the dependency-trigger DAG / schedules / machine / file-watcher jobs as a
      structured object consumed by synthesis (Group 4) and landed in capability `detail_json`
    - Mint NO per-job candidate rows
  - [x] 2.4 Ensure JIL parser tests pass
    - Run ONLY the 2-8 tests written in 2.1 via targeted jest, then `npx tsc --noEmit`
    - Do NOT run the entire discovery-service suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass (targeted jest) and `tsc --noEmit` is clean
- Parser produces a deterministic topology object (boxes / jobs / edges / schedules)
- Unknown keywords are tolerated via the `attributes` bag; no per-job candidates are minted

#### Task Group 3: Plain-Java `main()` Batch-Entrypoint Emission
**Dependencies:** None for the emission rule; the linkage feed (Group 4) refines the recognition
gate. (Independent of Groups 1-2.)
**Owner:** discovery-service (TypeScript)

- [x] 3.0 Complete the `main()` batch-entrypoint emission rule
  - [x] 3.1 Write 2-8 focused tests for the emission rule
    - Limit to 2-8 highly focused tests maximum
    - POSITIVE: a `public static void main(String[])` class with a batch signal emits the class as
      candidate type `class` with a `batch_entrypoint` marker in `data`, child `method` candidates
      for `main`/`execute`, and the captured `-o` operation flag
    - NEGATIVE: a normal Spring service is UNCHANGED (no emission regression)
    - Skip exhaustive coverage of every signature/package permutation
  - [x] 3.2 Implement the emission rule at the springClassic emission path
    - Drop point: `services/extensionPacks/frameworkAdapters/springClassic/index.ts:1792`
      (`if (!stereotyped && !nameSuggests) return;`)
    - Recognise `public static void main(String[])` AND (shell-invoked per the invocation linkage
      OR a batch package/name signal) → emit the class as candidate type `class` (NOT
      `app_component`) with a `batch_entrypoint` marker in `data`
    - Emit `main` / `execute` as child `method` candidates; capture the operation-flag pattern
      (`-o UPDATE` / `-o ARCHIVE`)
    - Detect via the EXISTING Java IR: `MethodIR.modifiers` (`static`) + `ParameterIR.type`
      (`String[]`) — no new parse; reuse `languageExtractors/java/extract.ts` + `languageIR.ts`
    - Gate to runs carrying batch signals ONLY
  - [x] 3.3 Ensure emission tests pass (positive AND negative)
    - Run ONLY the 2-8 tests written in 3.1 via targeted jest, then `npx tsc --noEmit`
    - The negative test MUST confirm no Spring-emission regression
    - Do NOT run the entire discovery-service suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass (targeted jest) and `tsc --noEmit` is clean
- Batch-entrypoint classes emit as `class` + child `method` with the `batch_entrypoint` marker and
  captured `-o` flag, gated to batch-signal runs
- Existing Spring emission is NOT regressed (negative test green)
- No bare `require('tree-sitter')` introduced

### Synthesis (discovery-service + optional gateway relay)

#### Task Group 4: Invocation Linkage + Capability Synthesis
**Dependencies:** Task Group 1 (AMS endpoints to persist into), Task Group 2 (JIL topology),
Task Group 3 (batch-entrypoint candidates)
**Owner:** discovery-service (TypeScript), with an optional small gateway relay route

- [x] 4.0 Complete invocation linkage + the capability synthesis step
  - [x] 4.1 Write 2-8 focused tests for linkage + synthesis
    - Limit to 2-8 highly focused tests maximum
    - Cover only: invocation edges resolve by FQCN/string match (vs discovered Java candidates +
      D1 `detailJson.invokes`) and land in `detail_json` with confidence; JIL-DAG transitive
      closure produces one seed; co-location heuristic seeds an un-orchestrated artifact; LLM
      naming consumes the MOCKED response (and NEVER changes membership); zero signals → no-op
      (no capabilities, no error)
    - MOCK the LLM / `gatewayClient` (NO live LLM); skip exhaustive scenario coverage
  - [x] 4.2 Implement the invocation-linkage resolver
    - Capture a typed `invocations[]` array inside capability `detail_json`:
      `{ from, fromKind, to, toKind, mechanism, confidence }`
    - Resolve by FQCN / string match against discovered Java candidates plus D1's
      `detailJson.invokes` strings
    - Edges live in `detail_json` ONLY — mint NO `DiscoveryRelationship` / `discovery_candidate`
      rows; inferred edges carry explicit, lower confidence than deterministic edges
  - [x] 4.3 Implement the deterministic synthesis seeding (TWO modes)
    - (a) JIL-DAG transitive closure: a box plus everything its DAG transitively triggers = one seed
    - (b) Co-location / shared-external-system / artifactKind heuristic for the un-orchestrated long
      tail (Monitoring, Deployment/ARM, FTP ingestion)
    - Membership is DETERMINISTIC; consume D1 `operational_artifact` findings WHEN PRESENT but do
      not require them (graceful — fewer/smaller seeds when sparse; no-op when zero signals)
  - [x] 4.4 Implement the naming-only LLM call
    - LLM NAMES / summarises / classifies `kind` ONLY — never adds, removes, or moves members
    - Temperature 0 + source-hash caching mirroring `llmBehaviourCaptureStep.ts`
      (`computeSourceHash` / `normalizeForHash` / cache-hit skip)
    - Route via the existing `services/gatewayClient.ts` → gateway relay precedent
      (`captureBehaviour` / `gateway/src/routes/discoveryGapFill.ts`)
    - OPTIONAL: add a small dedicated gateway route ONLY if the synthesis prompt diverges — clone
      the `discoveryGapFill.ts` precedent
  - [x] 4.5 Persist capabilities + members and wire into the pipeline
    - Persist `discovery_capability` + members via the AMS create / bulk-create endpoints (Group 1)
    - Build the `detail_json` payload: JIL-DAG topology snapshot, the `invocations[]` edges,
      schedule/trigger metadata, external systems, and the aggregated `behaviourBearing` hint
      (forward seam for the D4-gate spec)
    - Insert the synthesis step into `services/discoveryV3Pipeline.ts` AFTER the merge / persist seam
  - [x] 4.6 Ensure linkage + synthesis tests pass
    - Run ONLY the 2-8 tests written in 4.1 via targeted jest (LLM/`gatewayClient` mocked), then
      `npx tsc --noEmit`
    - IF a gateway relay route was added: run targeted gateway jest (live-LLM guard) + gateway tsc
    - Do NOT run the entire discovery-service / gateway suites at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass (targeted jest, LLM mocked); `tsc --noEmit` clean
- Invocation edges resolve and persist into `detail_json` with confidence; no relationship/
  candidate rows are minted for inferred edges
- Both seeding modes produce deterministic membership; LLM is naming-only and consumes the mocked
  response; zero signals → no-op (no error)
- Capabilities + members persist via the AMS endpoints; the step is wired after the
  `discoveryV3Pipeline` merge/persist seam
- If added, the gateway relay route passes its targeted jest (LLM-guard) + tsc

### Frontend

#### Task Group 5: Read-Only Capabilities Section in Findings
**Dependencies:** Task Group 1 (capability list/get endpoints), Task Group 4 (capabilities to read)
**Owner:** frontend (React / TypeScript)

- [x] 5.0 Complete the read-only Capabilities section inside `FindingsTab`
  - [x] 5.1 Write 2-8 focused tests for the Capabilities section
    - Limit to 2-8 highly focused tests maximum
    - Cover only: the section renders a synthesised capability row (name, kind, member count,
      confidence); expanding a row shows its members + the batch-spine summary; empty state renders
      cleanly with no capabilities
    - Use `renderWithProviders`; skip exhaustive interaction coverage
  - [x] 5.2 Extend `FindingsTab.tsx` with a read-only Capabilities section
    - Add a READ-ONLY "Capabilities" section / sub-tab INSIDE `FindingsTab.tsx`
      (`frontend/src/components/Discovery/FindingsTab.tsx`); NO standalone tab (Option-B deferred)
    - List each capability: name, kind, member count, confidence
  - [x] 5.3 Implement the expand → members + batch-spine summary view
    - On expand, show members + the batch-spine summary, reusing `FindingDetailDrawer.tsx`
      patterns and `findingTypeLabels.ts` label conventions
    - NO capability review actions / cascade UI
  - [x] 5.4 Ensure frontend tests pass
    - Run ONLY the 2-8 tests written in 5.1 via targeted vitest (`renderWithProviders`), then
      `npx tsc --noEmit` against the tsc baseline
    - Do NOT run the entire frontend suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 5.1 pass (targeted vitest); `tsc --noEmit` within the baseline
- The Capabilities section renders read-only inside `FindingsTab` (name / kind / member count /
  confidence); expand shows members + batch-spine summary
- NO review actions / cascade UI; NO standalone tab

### Testing

#### Task Group 6: Test Review & Gap Analysis
**Dependencies:** Task Groups 1-5
**Owner:** test review across AMS / discovery-service / gateway / frontend

- [x] 6.0 Review existing tests and fill critical gaps only
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review the 2-8 tests each from Group 1 (AMS), Group 2 (JIL parser), Group 3 (`main()`
      emission), Group 4 (linkage + synthesis), Group 5 (frontend)
    - Total existing tests: approximately 10-40 tests
  - [x] 6.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows lacking coverage; focus ONLY on this spec's
      requirements — do NOT assess whole-application coverage
    - Prioritise the cross-component spines over unit gaps
  - [x] 6.3 Write up to 10 additional strategic tests maximum
    - Add a MAXIMUM of 10 new tests, only IF NECESSARY, to cover:
      - feature-level JIL pipeline → capability with members + topology in `detail_json` +
        invocation edges
      - `main()`-entrypoint emission end-to-end (batch run → `class` + child `method` candidates)
      - co-location seeding for un-orchestrated artifacts
      - graceful no-op when there are no signals
      - the AMS capability + member round-trip
      - the read-only Capabilities UI render
    - Skip edge cases, performance, and accessibility tests unless business-critical; keep the LLM
      mocked
  - [x] 6.4 Run feature-specific tests only
    - Run ONLY tests related to this spec: AMS targeted foreground `mvn` (H2) for the capability
      tests; discovery-service targeted jest + `tsc`; gateway targeted jest (LLM-guard) + `tsc` IF
      a relay route was added; frontend targeted vitest + `tsc` baseline
    - Expected total: approximately 20-50 tests maximum
    - Do NOT run any full application test suite
    - Verify the critical capability-synthesis + batch-spine workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 20-50 tests total)
- Critical workflows for THIS feature are covered (JIL → capability, `main()` emission,
  co-location seeding, graceful no-op, AMS round-trip, read-only UI)
- No more than 10 additional tests added when filling gaps
- Testing focused exclusively on this spec's requirements; LLM remains mocked throughout

## Execution Order

Recommended implementation sequence (dependency-ordered):
1. AMS `discovery_capability` Foundation — changeset 184 (Task Group 1)
2. Autosys JIL Parser (Task Group 2)
3. Plain-Java `main()` Batch-Entrypoint Emission (Task Group 3)
4. Invocation Linkage + Capability Synthesis (Task Group 4) — needs Groups 1, 2, 3
5. Read-Only Capabilities Section in Findings (Task Group 5) — needs Groups 1, 4
6. Test Review & Gap Analysis (Task Group 6)

Groups 2 and 3 are independent of Group 1 and of each other; they can proceed in parallel with the
AMS work once Group 1's endpoint shapes are agreed. Group 4 is the convergence point that consumes
all three upstream groups and writes through the AMS endpoints.
