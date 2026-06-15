# Specification: D2 — Capability Synthesis + Batch Spines

## Goal
Turn D1's scattered per-file operational findings (plus discovered entities and DB objects) into coherent, durable, migrate-able `discovery_capability` records, and add the structured batch spines (JIL topology, plain-Java `main()` emission, cross-language invocation linkage) that give each capability accurate members.

## User Stories
- As a migration architect, I want related batch findings grouped into named capabilities (e.g. "Daily Risk Hierarchy Load Pipeline") with their schedule and invocation chain, so each becomes one coherent migration story instead of thirty disconnected file findings.
- As a reviewer, I want a read-only Capabilities view inside the Findings review showing each capability's name, kind, member count, confidence, members, and batch-spine summary, so I can see what the discovery synthesised.

## Specific Requirements

**`discovery_capability` grouping entity (AMS, changeset 184)**
- New standalone table with its OWN `id`, `run_id`, `project_id`, `architecture_id`, `name`, `kind` (free-text String, NO DB enum), `summary`, `review_status` (default `pending_review`), `previous_review_status`, `confidence` (boxed `Double`), `detail_json` (JSONB), `source`, `created_by_stage`, `created_at`, `updated_at`.
- Members and outbound architecture-entity links live ONLY in the membership table, never on the capability row.
- snake_case wire (global default); NO `@CamelCaseWire` (no camelCase consumer); all PATCH-mutable numerics boxed.
- Model on `MigrationReconciliationBreakEntity` (183) + `DiscoveryFindingEntity` (boxed `Double` confidence, String `review_status` + `previous_review_status` audit, `@Type(JsonType.class)` JSONB).
- Shaped to graduate to a first-class "Discovered Capabilities" output (Option B) later with NO data re-model.

**`discovery_capability_member` polymorphic membership table (AMS, changeset 184)**
- Separate table; polymorphic `member_type` / `member_id` pair supporting `discovery_finding`, `discovery_candidate`, `architecture_element`, `discovery_relationship`.
- Do NOT extend `DiscoveryFindingLink` and do NOT add `discovery_finding` to `ALLOWED_LINK_TARGET_TYPES` — finding-link semantics stay untouched.
- Follow the existing `member_type`/`member_id` snake_case precedent (e.g. `DiscoveryClusterMemberDto`) WITHOUT reusing the deprecated cluster entity.
- FK `capability_id` to `discovery_capability(id)`, indexed; ON DELETE CASCADE.

**`detail_json` payload contract**
- Carries: the JIL-DAG topology snapshot (boxes / jobs / trigger DAG / schedules / machine / file-watchers), the typed `invocations[]` edges (D8), schedule / trigger metadata, external systems, and an aggregated `behaviourBearing` hint.
- The `behaviourBearing` hint and the kept patch-review endpoint are intentional forward seams for the later D4-gate spec.
- JIL topology lands AUTHORITATIVELY here during synthesis, enriching (not competing with) the `.jil` file's D1 `operational_artifact` finding.

**AMS controller + service + persistence (changeset 184)**
- `DiscoveryCapabilityEntity` + `DiscoveryCapabilityMemberEntity`, DTOs, mapper, repositories.
- `DiscoveryCapabilityController` + service with: list, get, create, bulk-create, patch-review.
- Mirror the `DiscoveryFindingController` endpoint conventions (GET list, GET `/{id}`, POST create, POST `/bulk`, review mutation).
- KEEP the patch-review endpoint despite the read-only UI — trivial, forward-needed by the D4-gate spec, avoids a later AMS round-trip.
- `review_status` mutation records `previous_review_status`; approve/reject does NOT cascade to members in D2.
- NEW changeset 184 only (183 is the latest on disk); never edit applied changesets; register after 183 in `db.changelog-master.yaml`.

**Autosys JIL parser (discovery-service, hand-rolled)**
- Hand-rolled key:value parser for `.jil` files (NOT tree-sitter); no bare `require('tree-sitter')`.
- Parse: `insert_job`, `job_type` (c / b / f), `box_name`, `command`, `machine`, `condition` (success / done / notrunning / failure), `start_times`, `start_mins`, `days_of_week`, `run_calendar`, `alarm_if_fail`, `std_out_file` / `std_err_file`.
- Extract the topology: boxes, jobs, the dependency/trigger DAG, schedules, machine, file-watcher jobs (`job_type f`).
- Unknown keywords captured into a generic `attributes` bag — no hard failure on dialects.
- No new per-job candidate rows are minted; output lands in the capability `detail_json` during synthesis.

**Plain-Java `main()` batch-entrypoint emission (discovery-service)**
- Recognition rule: `public static void main(String[])` signature AND (shell-invoked per the invocation linkage OR a batch package/name signal).
- Emit the class as candidate type `class` (NOT `app_component`) with a `batch_entrypoint` marker in its `data`; emit `main` / `execute` methods as child `method` candidates.
- Capture the operation-flag pattern (`-o UPDATE` / `-o ARCHIVE`).
- Reuse the EXISTING Java tree-sitter IR (already parses `main()`); the gap is purely the emission rule. Detect via `MethodIR.modifiers` (`static`) + `parameters[].type` (`String[]`).
- Gate to runs carrying batch signals ONLY.
- MUST NOT regress existing Spring emission; the drop point is `springClassic/index.ts:1792` (`if (!stereotyped && !nameSuggests) return;`).

**Invocation linkage JIL → shell → Java → DB (discovery-service)**
- Capture as a typed `invocations[]` array inside the capability `detail_json`: `{ from, fromKind, to, toKind, mechanism, confidence }`.
- Resolve by FQCN / string match against discovered Java candidates plus D1's `detailJson.invokes` strings.
- Do NOT mint `DiscoveryRelationship` / `discovery_candidate` rows for inferred cross-language edges.
- Inferred edges carry explicit `confidence`, lower than deterministic edges — keeps low-confidence links out of the architecture relationship tables.

**Capability synthesis step (discovery-service)**
- DETERMINISTIC membership; the LLM NAMES / summarises / classifies `kind` only and NEVER adds, removes, or moves members.
- Two deterministic seeding modes: (a) JIL-DAG transitive closure for orchestrated pipelines (a box plus everything its DAG transitively triggers = one seed); (b) co-location / shared-external-system / artifactKind heuristic for the un-orchestrated long tail (Monitoring, Deployment/ARM, FTP ingestion).
- LLM call: temperature 0, source-hash caching mirroring `llmBehaviourCaptureStep`, via the existing `gatewayClient` → gateway relay precedent; a small dedicated gateway route MAY be added if the prompt diverges.
- Insert the step into `discoveryV3Pipeline` AFTER merge / persist; mocked in tests (no live LLM).
- Persist results as `discovery_capability` + members via the AMS create / bulk-create endpoints.
- A mis-seed is caught by human review (review is the safety net, not a perfect seeder).

**Graceful degradation + standalone operation (D9)**
- D2 stands alone: consumes D1 `operational_artifact` findings WHEN PRESENT but does NOT require them.
- Also seeds from batch-entrypoint candidates + DB-object findings + JIL topology alone (fully testable with fixture `.jil` + Java + DB inputs and NO D1 run).
- Sparse / absent signals → fewer / smaller seeds; zero signals → no-op (no capabilities emitted, no error).

**Read-only Capabilities view (frontend, `FindingsTab.tsx`)**
- A READ-ONLY "Capabilities" section / sub-tab INSIDE the existing `FindingsTab.tsx`; NO standalone tab (Option-B deferred).
- Lists synthesised capabilities: name, kind, member count, confidence.
- On expand: shows members + the batch-spine summary, reusing `FindingDetailDrawer` patterns and `findingTypeLabels` label conventions.
- NO capability review actions / cascade UI.

## Existing Code to Leverage

**`MigrationReconciliationBreakEntity` + `sql/183-migration-reconciliation-break.sql`**
- The changeset / boxed-type / snake_case template for changeset 184: status-as-TEXT (no DB enum), boxed nullable types, JSONB `detail_json` via `JsonType`, `created_at`/`updated_at` defaults, indexes on the read keys.
- Replicate the comment-rich changeset style and the "NEW changeset only" discipline.

**`DiscoveryFindingEntity` (+ controller / service / mapper / repository)**
- Field pattern to replicate: boxed `Double confidence`, String `review_status` defaulting `pending_review`, `previous_review_status` audit, `@Type(JsonType.class)` JSONB `detailJson`, `@PrePersist`/`@PreUpdate` timestamps.
- `DiscoveryFindingController` is the endpoint-shape template (GET list, GET `/{id}`, POST create, POST `/bulk`, review mutation) for `DiscoveryCapabilityController`.

**`gatewayClient.ts` → gateway `discoveryGapFill.ts` + `llmBehaviourCaptureStep.ts`**
- The `gatewayClient` → gateway relay precedent (`captureBehaviour` / per-file relay) for the naming-only LLM call.
- `llmBehaviourCaptureStep` supplies the source-hash caching + temperature-0 determinism pattern (`computeSourceHash`, `normalizeForHash`, cache-hit skip) to mirror.

**`springClassic/index.ts` + `languageExtractors/java/extract.ts` + `languageIR.ts`**
- `springClassic/index.ts:1792` is the exact emission edit point; `makeCandidate(type, name, filePath, data, runId)` is the candidate-emission shape with a `data` bag + child `method` parenting.
- The Java IR (`ClassIR` / `MethodIR` / `ParameterIR` with `modifiers: string[]`, `parameters[].type`) already parses `main()`; reuse it, no new parse.

**`FindingsTab.tsx` + `FindingDetailDrawer.tsx` + `findingTypeLabels.ts`**
- `FindingsTab.tsx` is the host for the read-only Capabilities section (already uses `listFindings` + a detail drawer).
- `FindingDetailDrawer.tsx` supplies the expand / member-detail pattern; `findingTypeLabels.ts` the label conventions.

## Out of Scope
- Keystone consumption (capabilities → implementation-ready modernised specs).
- Book-of-work / migration-plan consumption.
- Modernisation spec-generation.
- The Option-B first-class standalone "Discovered Capabilities" tab.
- Capability review actions / cascade UI in the frontend.
- Member cascade on capability approve / reject (deferred to the keystone / gate specs).
- Changing `DiscoveryFindingLink` or adding `discovery_finding` to `ALLOWED_LINK_TARGET_TYPES`.
- Minting `DiscoveryRelationship` / `discovery_candidate` rows for inferred cross-language edges or per-JIL-job candidates.
- Reuse of the `@deprecated` / Phase-1c-only `DiscoveryCluster` for capabilities.
