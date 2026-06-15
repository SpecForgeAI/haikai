# Task Breakdown: Discovery Findings / Evidence as a First-Class Discovery Concept

## Overview
Total Task Groups: 9

A 4-service spec spanning AMS (Java/Spring + Liquibase 135/136), the gateway (Express/TS) proxy layer, the discovery-service (Node/TS) emission pipeline, and the frontend (React/TS) review surface. Per D1 the work lands as four sequential commits in that order; the task groups below mirror those four phases. Standing constraints (Liquibase immutability at 134, boxed PATCH DTO types, no `discovery-service/src/**` edits during a live run, pre-existing broken tests left untouched, AppShell model cache NOT invalidated on finding writes) apply to every implementer.

## Task List

### Phase 1 — AMS Persistence + API (Commit 1)

#### Task Group 1: AMS Liquibase + JPA entities + repositories
**Dependencies:** None
**Scope:** Durable persistence only — two Liquibase changesets, two JPA entities, two repositories. No service or controller logic. Mirror the existing `DiscoveryCandidateEntity` / repository style.

- [x] 1.0 Complete AMS persistence layer for findings + finding links
  - [x] 1.1 Write 2-8 focused tests for persistence
    - One repository round-trip test for `DiscoveryFindingEntity` (insert → findById → status update → `updated_at` bumped)
    - One repository test for `DiscoveryFindingLinkEntity` round-trip (insert link, find by `findingId`, find by `(targetType, targetId)`)
    - One cascade-delete test confirming deleting a `DiscoveryFinding` cascades to its `discovery_finding_links` rows
    - One JSONB round-trip test asserting `detail_json` survives serialize/deserialize via `@JdbcTypeCode(SqlTypes.JSON)`
    - One nullable-boxed-field test asserting `confidence=null` round-trips correctly (boxed `Double`, NOT primitive)
    - Skip exhaustive column-by-column coverage
  - [x] 1.2 Add Liquibase changeset `architecture-model-service/src/main/resources/db/changelog/sql/135-discovery-findings.sql`
    - Columns per spec: `id` UUID PK, `run_id` UUID NOT NULL FK → `discovery_runs`, `project_id` UUID NOT NULL, `architecture_id` UUID NOT NULL, `finding_type` text NOT NULL, `category` text NOT NULL, `severity` text NOT NULL, `confidence` double precision NULL, `status` text NOT NULL DEFAULT 'new', `title` text NOT NULL, `summary` text NULL, `detail_json` jsonb NULL, `source` text NULL, `created_by_stage` text NULL, `created_at` timestamp NOT NULL, `updated_at` timestamp NOT NULL, `reviewed_at` timestamp NULL, `reviewer_notes` text NULL
    - Indexes: `run_id`, `project_id`, `architecture_id`, `status`, `category`, `severity`, `finding_type`, `source`
    - `ON DELETE CASCADE` from `discovery_runs` to `discovery_findings`
    - `COMMENT ON TABLE/COLUMN` documenting the enumish string vocabularies (status / severity / finding_type / category)
  - [x] 1.3 Add Liquibase changeset `architecture-model-service/src/main/resources/db/changelog/sql/136-discovery-finding-links.sql`
    - Columns: `id` UUID PK, `finding_id` UUID NOT NULL FK → `discovery_findings` `ON DELETE CASCADE`, `link_type` text NOT NULL, `target_type` text NOT NULL, `target_id` text NOT NULL, `label` text NULL, `created_at` timestamp NOT NULL
    - Indexes: `finding_id`, composite `(target_type, target_id)`
    - `COMMENT` on `target_type` listing v1 values (`discovery_evidence` / `discovery_candidate` / `discovery_relationship` / `discovery_cluster` / `discovery_decision_task` / `architecture_element`) and documented-but-unused future values (`work_item`, `api_behaviour_baseline`)
    - Note that `ON DELETE CASCADE` is also declared per D6 from each linkable parent table (`discovery_candidate`, `discovery_decision_task`, `discovery_relationship`, `discovery_evidence`, `discovery_cluster`, `architecture_element`) to `discovery_finding_links` rows that reference them — implemented in the same changeset via triggers or `ON DELETE CASCADE` clauses tied to a parent-pointer column OR (preferred) deferred to a follow-up changeset 137 if the architecture-element FK shape doesn't permit a single SQL clause; document the chosen approach in the changeset comment header
  - [x] 1.4 Register both new changesets in `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
    - Append-only; never modify or remove existing entries ≤134 (`feedback_liquibase_immutable_changesets.md`)
  - [x] 1.5 Create JPA entity `DiscoveryFindingEntity` under `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/discovery/`
    - Mirror `DiscoveryCandidateEntity` (Lombok `@Entity`, `@Builder`, `@Getter`, `@Setter`, `@NoArgsConstructor`, `@AllArgsConstructor`)
    - `@Table(name = "discovery_findings")` with `@Index` annotations matching the migration
    - `confidence` declared as boxed `Double` (NOT `double`) per `project_primitive_double_dto_overwrite.md`
    - `detail_json` as `JsonNode` (or `Map<String,Object>`) with `@JdbcTypeCode(SqlTypes.JSON)`
    - `@PrePersist` sets `createdAt` + `updatedAt`; `@PreUpdate` bumps `updatedAt`
    - Status / severity / finding_type / category / source / created_by_stage stay `String` (not Java enums) per spec — preserves extensibility for pack values without DDL
  - [x] 1.6 Create JPA entity `DiscoveryFindingLinkEntity`
    - `@Table(name = "discovery_finding_links")`
    - FK to `DiscoveryFindingEntity` (`@ManyToOne(fetch = LAZY)` or raw `findingId` UUID — match the AMS convention used by `DiscoveryCandidateEntityMappingEntity`)
    - `target_type` + `target_id` as `String` to preserve the polymorphic target shape
    - `@PrePersist` sets `createdAt`
  - [x] 1.7 Create Spring Data repositories under `repository/discovery/`
    - `DiscoveryFindingRepository extends JpaRepository<DiscoveryFindingEntity, UUID>` — derived finders for `findByRunIdAndProjectIdAndArchitectureId(...)`, plus a `@Query` (or `Specification`) covering the filter set: `category`, `findingType`, `severity`, `status`, `source`, `createdByStage`, `linkedTargetType`, `linkedTargetId`, text search on `title`+`summary`, paging
    - `DiscoveryFindingLinkRepository extends JpaRepository<DiscoveryFindingLinkEntity, UUID>` — `findByFindingId`, `findByTargetTypeAndTargetId`, `existsByFindingIdAndTargetTypeAndTargetId` (for dedupe-on-create)
  - [x] 1.8 Run ONLY the persistence tests written in 1.1
    - Verify both Liquibase changesets apply cleanly from a fresh DB
    - Verify the cascade-delete behaviour
    - Do NOT run the entire AMS test suite

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass
- Changesets 135 and 136 apply cleanly with checksums recorded; no edit to changesets ≤134
- `db.changelog-master.yaml` registers both new changesets as discrete `changeSet` blocks
- `confidence` is a boxed `Double` on the entity (verified by null round-trip)
- Cascade deletes from a `DiscoveryFinding` remove its `discovery_finding_links` rows

---

#### Task Group 2: AMS DTOs, mapper, service, controller, validation
**Dependencies:** Task Group 1
**Scope:** Java service + controller exposing the full REST surface for findings + finding-links under the canonical `/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/findings...` path. PATCH semantics with boxed-type DTOs and null-guards; D6 hard-reject link validation; status transition guards.

- [x] 2.0 Complete AMS service + controller layer for findings
  - [x] 2.1 Write 2-8 focused tests for service + controller
    - One MockMvc test for `POST .../findings` happy path — verifies default `status='new'` (D5), `created_at` set, all three scoping ids stored
    - One MockMvc test for `POST .../findings` rejecting payloads whose `run_id`/`project_id`/`architecture_id` derived from path mismatch — wrong project returns 404 (existing scoping pattern), wrong architecture for the run returns 400
    - One MockMvc test for `POST .../findings/{id}/links` rejecting an invalid target (target doesn't exist OR target belongs to a different run/architecture) — D6 hard-reject with 400
    - One MockMvc test for `PATCH .../findings/{id}` with a partial body containing only `reviewer_notes` — verifies `confidence` (boxed Double) is NOT wiped to 0, `status` unchanged when not in payload, allowed mutable fields applied
    - One MockMvc test for `POST .../findings/{id}/review` — sets `status` + `reviewed_at` + `reviewer_notes` in one call
    - One service-layer unit test for status transition rules: `new → accepted` allowed, `accepted → resolved` allowed, `resolved → needs_review` allowed (re-opening), invalid transitions (`resolved → new`) rejected with structured error
    - One MockMvc test for `GET .../findings` with multiple filters (`status=needs_review&severity=high&linkedTargetType=discovery_candidate&linkedTargetId=...`) — returns only matching rows
    - Skip exhaustive coverage of every filter combination and every status transition pair
  - [x] 2.2 Create DTOs under `model/dto/discovery/`
    - `DiscoveryFindingDto`, `DiscoveryFindingLinkDto` (response shapes including links)
    - `CreateDiscoveryFindingRequest`, `UpdateDiscoveryFindingRequest`, `ReviewDiscoveryFindingRequest`, `BulkCreateDiscoveryFindingsRequest`, `DiscoveryFindingSearchResponse`
    - All numeric/boolean PATCH-mutable fields as boxed types — `confidence` is `Double`, NOT `double` (`project_primitive_double_dto_overwrite.md`)
    - `detail_json` typed as `JsonNode` (Jackson) or `Map<String, Object>`
  - [x] 2.3 Create mapper under `mapper/discovery/`
    - Entity ↔ DTO conversion for findings and finding-links; manual mapping (match existing AMS convention; do not introduce MapStruct if not already used in the discovery package)
    - Finding-to-DTO maps embedded `links` list when present on the entity
  - [x] 2.4 Create `DiscoveryFindingService` under `service/discovery/`
    - `@Service`, `@Transactional` for writes, `@Transactional(readOnly = true)` for reads
    - Methods: `list(projectId, architectureId, runId, filters, pageable)`, `get(projectId, architectureId, runId, findingId)`, `create(projectId, architectureId, runId, request)`, `bulkCreate(projectId, architectureId, runId, request)`, `update(...)`, `review(...)`, `delete(...)`, `addLink(...)`, `removeLink(...)`, `listLinks(...)`
    - Enforce on every read/write: the finding's `(project_id, architecture_id, run_id)` matches the path tuple (reuse the discovery scoping pattern from `DiscoveryCandidateService`)
    - PATCH handler null-guards EVERY field per the primitive-wipe pitfall; `confidence=null` in the request leaves the persisted value untouched
    - Status transition validator: `new → any`; `accepted`/`ignored` → `needs_review`/`resolved`; `resolved` is terminal-with-reopen (can move back to `needs_review` only); invalid transitions throw a typed exception mapped to 422 by the controller
    - Link target validation (D6): on link create, look up the target by `(target_type, target_id)` in the appropriate repository and assert it belongs to the same `run_id` (for run-scoped target types) or same `architecture_id` (for `architecture_element`); missing or out-of-scope target returns 400 with `{code: "invalid_link_target"}`
    - Reviewer-notes-only updates are allowed without a status change
  - [x] 2.5 Create `DiscoveryFindingController` under `controller/discovery/`
    - Path prefix: `/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/findings`
    - Routes per spec:
      - `GET /` — list with query filters + paging
      - `POST /` — single create
      - `POST /bulk` — bulk create (used by `FindingEmitter` post-merge)
      - `GET /{id}` — fetch single (includes links)
      - `PATCH /{id}` — partial update (mutable fields only; status validated)
      - `POST /{id}/review` — convenience setter for `{status, reviewer_notes?}` + `reviewed_at`
      - `GET /{findingId}/links` — list links
      - `POST /{findingId}/links` — create link (validates target per D6)
      - `DELETE /{findingId}/links/{linkId}` — remove link
    - Reuse the `:projectId`/`:architectureId` URL safety property from existing discovery controllers
  - [x] 2.6 Wire status-transition + invalid-link-target exception handling
    - Map typed exceptions to HTTP responses in `GlobalExceptionHandler.java` (or the discovery-specific equivalent) — invalid status transition → 422, invalid link target → 400 with structured `{code, message}` body
  - [x] 2.7 Run ONLY the service + controller tests written in 2.1
    - Verify PATCH does NOT wipe `confidence` (boxed Double)
    - Verify D6 hard-reject on bad link targets
    - Verify status transition guard
    - Do NOT run the entire AMS test suite

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass
- All routes reachable under `/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/findings/...`
- PATCH semantics safe for `confidence` and any future boxed numeric/boolean fields
- D6 invalid-link-target hard-rejected with 400
- Status transition guard rejects illegal moves with 422
- Reviewer-notes-only updates allowed without status change

---

### Phase 2 — Gateway Proxies (Commit 2)

#### Task Group 3: Gateway proxies for findings + finding-links
**Dependencies:** Task Group 2
**Scope:** Extend `gateway/src/routes/discovery.ts` with proxies that mirror the AMS surface 1:1. No business logic — pass-through with project + architecture URL safety only.

- [x] 3.0 Complete gateway proxy layer for findings
  - [x] 3.1 Write 2-8 focused tests for gateway proxies
    - One Jest test proxying `GET .../findings` to AMS — verifies the gateway forwards `:projectId`, `:architectureId`, `:runId` and the query string preserved (mock axios)
    - One test proxying `POST .../findings` and asserting the AMS body is forwarded verbatim
    - One test proxying `POST .../findings/bulk` confirming the bulk path is preserved
    - One test for `POST .../findings/{findingId}/links` happy path
    - One test for AMS error pass-through: AMS returns 400 with `{code: "invalid_link_target"}` → gateway surfaces the same status + body shape
    - One test asserting a missing `:architectureId` segment 404s at Express layer (no fallback resolution — mirrors the existing discovery proxy pattern)
    - Skip exhaustive per-route coverage
  - [x] 3.2 Extend `gateway/src/routes/discovery.ts` with proxies mirroring the AMS surface
    - `GET /projects/:projectId/architectures/:architectureId/discovery/runs/:runId/findings`
    - `POST /projects/:projectId/architectures/:architectureId/discovery/runs/:runId/findings`
    - `POST /projects/:projectId/architectures/:architectureId/discovery/runs/:runId/findings/bulk`
    - `GET /projects/:projectId/architectures/:architectureId/discovery/runs/:runId/findings/:findingId`
    - `PATCH /projects/:projectId/architectures/:architectureId/discovery/runs/:runId/findings/:findingId`
    - `POST /projects/:projectId/architectures/:architectureId/discovery/runs/:runId/findings/:findingId/review`
    - `GET /projects/:projectId/architectures/:architectureId/discovery/runs/:runId/findings/:findingId/links`
    - `POST /projects/:projectId/architectures/:architectureId/discovery/runs/:runId/findings/:findingId/links`
    - `DELETE /projects/:projectId/architectures/:architectureId/discovery/runs/:runId/findings/:findingId/links/:linkId`
    - Mirror the existing discovery proxy template (URL translation, error pass-through, no body mutation)
    - Forgetting `:architectureId` MUST 404 at Express layer (no fallback resolution)
  - [x] 3.3 Run ONLY the gateway tests written in 3.1
    - Verify URL construction preserves all three path params
    - Verify AMS error pass-through preserves status + body
    - Do NOT run the entire gateway test suite

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass
- All 9 finding/link routes reachable through the gateway with project + architecture URL safety
- AMS error responses (especially the 400 D6 invalid-link-target shape and 422 status-transition shape) pass through unchanged
- No business logic added in the gateway

---

### Phase 3 — Discovery-Service Emission (Commit 3)

#### Task Group 4: archModelClient methods + `FindingEmitter` utility
**Dependencies:** Task Group 3
**Scope:** New `discovery-service/src/services/findings/FindingEmitter.ts` plus the archModelClient methods it depends on. Normalization, dedupe-key computation, soft-fail persistence. NO call-site wiring in this group — that lands in Group 5.
**Pre-condition:** Verify no discovery run is active before editing `discovery-service/src/**` (`feedback_no_src_edits_during_run.md`).

- [x] 4.0 Complete `FindingEmitter` + archModelClient methods
  - [x] 4.1 Write 2-8 focused tests for emitter + client methods
    - One unit test for `emitFinding` happy path — verifies normalization (lowercased `finding_type`/`category`/`severity`), default `status='new'` (D5), `run_id`/`project_id`/`architecture_id` attached from context, calls `archModelClient.createDiscoveryFinding` with the assembled payload
    - One unit test for `emitFindings` (bulk) — verifies it calls `archModelClient.bulkCreateDiscoveryFindings` with N payloads in one request
    - One unit test for the dedupe-key formula: `runId + findingType + category + title + primaryLinkedTarget` where `primaryLinkedTarget` follows the D2 priority chain (`discovery_candidate > discovery_decision_task > discovery_relationship > discovery_evidence > discovery_cluster > architecture_element`) with lowest-`target_id` tiebreak; verifies a finding with `[discovery_evidence:E1, discovery_candidate:C7]` picks `discovery_candidate:C7` as primary
    - One unit test for the empty-links case — dedupe key uses the empty string for `primaryLinkedTarget`
    - One unit test for soft-fail behaviour — mock `archModelClient.createDiscoveryFinding` to throw, assert `emitFinding` logs a warning and returns without rethrowing (run must continue per spec)
    - One unit test asserting links attached to the emit payload survive normalization (link_type, target_type, target_id pass through unchanged)
    - Skip exhaustive normalization-edge-case coverage
  - [x] 4.2 Add archModelClient methods in `discovery-service/src/services/archModelClient.ts`
    - `createDiscoveryFinding(projectId, architectureId, runId, payload)` → `POST .../findings`
    - `bulkCreateDiscoveryFindings(projectId, architectureId, runId, payloads)` → `POST .../findings/bulk`
    - `listDiscoveryFindings(projectId, architectureId, runId, filters)` → `GET .../findings`
    - `updateDiscoveryFinding(projectId, architectureId, runId, findingId, patch)` → `PATCH .../findings/:findingId`
    - `reviewDiscoveryFinding(projectId, architectureId, runId, findingId, body)` → `POST .../findings/:findingId/review`
    - `createDiscoveryFindingLink(projectId, architectureId, runId, findingId, link)` → `POST .../findings/:findingId/links`
    - Mirror the existing discovery client error taxonomy (axios error → typed `ArchModelClientError`)
  - [x] 4.3 Implement `discovery-service/src/services/findings/FindingEmitter.ts`
    - Exports `emitFinding({runContext, findingType, category, severity, title, summary?, detailJson?, confidence?, source?, createdByStage?, links?})` and `emitFindings(array)`
    - `runContext` carries `{runId, projectId, architectureId}` (constructed once per run by the orchestrator)
    - Normalize: lowercase `finding_type` / `category` / `severity`; strip surrounding whitespace; pass through unchanged if already normalized
    - Default `status='new'` (D5)
    - Attach scoping ids from `runContext`
    - Compute `primaryLinkedTarget` per D2 priority chain with lowest-`target_id` tiebreak; empty string when `links` is absent or empty; document the priority order in a JSDoc block above the helper function
    - Compute dedupe key `runId|findingType|category|title|primaryLinkedTarget`; in-process dedupe set per run prevents emitting duplicates from the same pass (helps when multiple emission sites flag the same candidate)
    - Persist via `archModelClient.createDiscoveryFinding` (or `bulkCreateDiscoveryFindings` for `emitFindings`)
    - On persistence failure: `logger.warn({err, dedupeKey}, 'finding emit failed; continuing run')` and return — never throw, never abort the discovery run
  - [x] 4.4 Document the "no LLM enrichment in v1" stance (D7)
    - Add a JSDoc block at the top of `FindingEmitter.ts` noting which fields are enrichment-friendly (`summary`, `detail_json`, `confidence`, `source`, `created_by_stage`) and that `'llm_enrichment'` is a documented future `source` value with no v1 call site
    - NO stub method, NO placeholder enrichment hook, NO no-op pass — pure documentation only
  - [x] 4.5 Run ONLY the emitter + client tests written in 4.1
    - Verify D2 priority + tiebreak logic
    - Verify soft-fail does not throw
    - Verify normalization shape
    - Do NOT run the entire discovery-service suite

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass
- `FindingEmitter` normalizes, dedupes, and persists; soft-fails on archModelClient errors
- All six archModelClient methods exist and follow the existing discovery-client error taxonomy
- D2 primary-link priority + tiebreak documented in code
- No LLM enrichment code shipped (D7 shape-only compliance)

---

#### Task Group 5: Wire emission at 7 v1 source points (A, B, C, D, E, F, H)
**Dependencies:** Task Group 4
**Scope:** Add `FindingEmitter` calls at the seven v1 emission sites identified in the spec. Source G is explicitly deferred (D4) — do NOT wire `unsupported_pattern` in v1.
**Pre-condition:** Verify no discovery run is active before editing `discovery-service/src/**` (`feedback_no_src_edits_during_run.md`).

- [x] 5.0 Complete v1 emission wiring at all 7 source points
  - [x] 5.1 Write 2-8 focused tests for emission wiring
    - One pipeline test for Source A (low-confidence candidate) — drive `discoveryV3Pipeline.ts` with a fixture producing a sub-`AMBIGUOUS_THRESHOLD` candidate; assert `emitFinding` called with `findingType='low_confidence_candidate'`, `category='ambiguity'`, severity in {low, medium}, and a link of `target_type='discovery_candidate'`
    - One unit test for Source B (unresolved decision task) — drive `triageEngine.ts` decision-task creation; assert `emitFinding` called with `findingType='unresolved_decision_task'`, `category='ambiguity'`, `severity='medium'`, link `target_type='discovery_decision_task'`
    - One pipeline test for Source C (candidate conflict / duplicate) at the `dedupDroppedCount` site AND one test at the `triageEngine.ts` competing-relationships path — both assert `findingType='candidate_conflict'`, `category='ambiguity'`, `severity='medium'`
    - One runtime-evidence test for Source D (unmatched runtime endpoint) — feed `unmatchedRouteHintCandidates` into `endpointRuntimeMatcher.ts`/`endpointRuntimeAggregator.ts`; assert `findingType='unmatched_runtime_endpoint'`, `category='runtime_usage'`
    - One runtime-evidence test for Source E (runtime usage on endpoint candidate) — assert `findingType='runtime_usage_observation'`, `category='runtime_usage'`, `severity='info'`, link `target_type='discovery_candidate'`
    - One linker-rules test for Source F (ambiguous relationship) — drive a competing-relationships scenario; assert `findingType='ambiguous_relationship'`, `category='ambiguity'`, link `target_type='discovery_relationship'`
    - One pipeline test for Source H (evidence gap) — feed a merged candidate set with a known gap (endpoint without responseSchema); assert `findingType='evidence_gap'`, `category='evidence_gap'`, `severity='medium'`
    - One negative test asserting NO `unsupported_pattern` finding is emitted in v1 (D4) anywhere in the pipeline
  - [x] 5.2 Wire Source A (low-confidence candidate)
    - In `discovery-service/src/discoveryV3Pipeline.ts` post-merge step, after candidates have stable IDs, iterate candidates whose confidence is below `triageEngine.ts` `AMBIGUOUS_THRESHOLD` and call `emitFinding` per candidate
    - `created_by_stage='discoveryV3Pipeline.postMerge.lowConfidence'`; link to the `discovery_candidate`
  - [x] 5.3 Wire Source B (unresolved decision task)
    - In `discovery-service/src/triageEngine.ts` alongside the DecisionTask creation path, call `emitFinding` for each DecisionTask
    - `created_by_stage='triageEngine.decisionTaskCreation'`; link to the `discovery_decision_task` and to the conflicting `discovery_candidate`(s) where available
  - [x] 5.4 Wire Source C (candidate conflict / duplicate) at TWO sites
    - `discoveryV3Pipeline.ts` `dedupDroppedCount` site — emit one finding per drop describing the duplicate group (link to the surviving + dropped candidates)
    - `triageEngine.ts` competing-relationships resolution — emit one finding per resolved conflict
    - `created_by_stage` distinguishes the two sites (`'discoveryV3Pipeline.dedup'` vs `'triageEngine.competingRelationships'`)
  - [x] 5.5 Wire Source D (unmatched runtime endpoint)
    - In `discovery-service/src/runtimeEvidence/endpointRuntimeMatcher.ts` (and/or `endpointRuntimeAggregator.ts`) where `unmatchedRouteHintCandidates` is computed, emit one finding per unmatched runtime endpoint
    - `created_by_stage='runtimeEvidence.endpointRuntimeMatcher'`; link to the runtime `discovery_evidence` row and any near-miss `discovery_candidate`
  - [x] 5.6 Wire Source E (runtime usage observation on endpoint candidate)
    - In `discovery-service/src/runtimeEvidence/runDiscoveryRuntimeEvidence.ts` where aggregates are correlated to endpoint candidates, emit one info-severity finding per correlated candidate
    - `created_by_stage='runtimeEvidence.runDiscoveryRuntimeEvidence'`; link to the `discovery_candidate` and the runtime `discovery_evidence`
  - [x] 5.7 Wire Source F (ambiguous relationship)
    - In `discovery-service/src/linkerRules/*` and the `triageEngine.ts` competing-relationships path, emit a finding for relationships that meet the ambiguous-inference criteria (low confidence + multiple competing targets)
    - `created_by_stage` reflects the specific linker rule firing site; link to the `discovery_relationship` and competing target `discovery_candidate`s
  - [x] 5.8 Implement and wire Source H (evidence gap) as a new post-merge pass
    - New file `discovery-service/src/services/findings/evidenceGapScanner.ts` exporting `scanForEvidenceGaps(candidates, runContext)`
    - Detects: endpoint candidate without `responseSchema`, interface candidate without contract detail, service candidate without owner, data-entity candidate without attributes
    - Emits one finding per gap, `category='evidence_gap'`, `severity='medium'`, link to the affected `discovery_candidate`
    - Call the scanner from `discoveryV3Pipeline.ts` AFTER all other emission sources have run (so it sees the merged candidate set)
    - `created_by_stage='findings.evidenceGapScanner'`
  - [x] 5.9 Confirm Source G is NOT wired (D4)
    - Add a comment in `discoveryV3Pipeline.ts` noting `unsupported_pattern` is deferred to a per-pack follow-up; enum value lives in AMS for forward compat
    - Verify the negative test in 5.1 passes (no `unsupported_pattern` emission anywhere in v1)
  - [x] 5.10 Run ONLY the emission wiring tests written in 5.1
    - Verify each of the 7 v1 sources fires under its trigger condition
    - Verify Source G remains unwired
    - Do NOT run the entire discovery-service suite

**Acceptance Criteria:**
- The 2-8 tests written in 5.1 pass
- Each of the 7 v1 sources (A, B, C-pipeline, C-triage, D, E, F, H) emits at its designated hook point
- Source G is documented as deferred and not emitted anywhere in v1
- Discovery runs do not fail when AMS rejects a finding (soft-fail per Group 4)
- No pre-existing candidate save-back flow regressed

---

### Phase 4 — Frontend Findings UI (Commit 4)

#### Task Group 6: Frontend API client + tab control refactor on DiscoveryRunDetailView
**Dependencies:** Task Group 5
**Scope:** TypeScript client for findings + finding-links, plus the introduction of a tab control on `frontend/src/components/Discovery/DiscoveryRunDetailView.tsx` that hosts the existing "Candidates" surface unchanged and the new "Findings" tab. Includes the duplicate-view reconciliation (D8).

- [x] 6.0 Complete frontend client + tab control refactor
  - [x] 6.1 Write 2-8 focused tests for client + tab control
    - One Vitest test of `findingsApi.ts` confirming `listFindings(projectId, architectureId, runId, filters)` builds the correct gateway URL with query string
    - One Vitest test asserting `findingsApi.reviewFinding(...)` POSTs to `.../findings/{id}/review` with `{status, reviewer_notes?}`
    - One Vitest test mounting `DiscoveryRunDetailView` and asserting it renders both "Candidates" + "Findings" tabs; default-active tab is "Candidates" (no behaviour regression for existing users)
    - One Vitest test asserting clicking the "Findings" tab swaps the panel content without unmounting the surrounding view header / run-info / run-list
    - One Vitest test asserting the existing `DiscoveryCandidateTable` content renders unchanged inside the "Candidates" tab (no prop or behaviour drift)
    - One Vitest test asserting the duplicate `frontend/src/components/DashboardView/DiscoveryRunDetailView.tsx` is removed or now re-exports the canonical `Discovery/` version (D8 reconciliation) — DEFERRED: per implementer instructions for this commit, the `DashboardView/` copy is left in place because it's still wired into App.tsx routing; duplicate-view reconciliation will land in a follow-up that retargets the routes
    - Skip exhaustive tab-state coverage and accessibility tests unless trivially testable in the same render
  - [x] 6.2 Implement `frontend/src/api/findingsApi.ts`
    - Functions: `listFindings`, `getFinding`, `createFinding`, `bulkCreateFindings`, `updateFinding`, `reviewFinding`, `listFindingLinks`, `createFindingLink`, `deleteFindingLink`
    - All calls through the gateway; preserve `:projectId`/`:architectureId`/`:runId` in URL templates
    - Numeric/boolean PATCH-eligible fields typed as `number | null` / `boolean | null` per `project_primitive_double_dto_overwrite.md`
    - DTO mirror types (`DiscoveryFindingDto`, `DiscoveryFindingLinkDto`, etc.) in a sibling `findingsApi.types.ts` or inline at top of `findingsApi.ts`
  - [x] 6.3 Introduce tab control on `frontend/src/components/Discovery/DiscoveryRunDetailView.tsx`
    - Replace the current "View Candidates" toggle with a tab control where this toggle lives
    - Initial tabs: "Candidates" (existing `DiscoveryCandidateTable` content moves into this tab unchanged) + "Findings" (new — Group 7 fills in)
    - Tab structure designed so Evidence / Decision Tasks / Relationships / Clusters can slot in later without restructuring
    - Tab state stored in component state (URL query param optional; keep v1 simple unless trivially testable)
    - Default-active tab: "Candidates" (no behaviour regression)
  - [x] 6.4 Reconcile the duplicate `DiscoveryRunDetailView` (D8) — PARTIAL
    - Naming clash resolved: new canonical file renamed to `frontend/src/components/Discovery/DiscoveryRunDetailViewWithTabs.tsx` (+ matching `.module.css` and `.test.tsx`) so there is only one `DiscoveryRunDetailView.tsx` in the tree (the legacy `DashboardView/DiscoveryRunDetailView.tsx`).
    - Full routing retarget DEFERRED to a follow-up refactor spec because the two views have incompatible prop contracts: the legacy view (1097 lines) owns run-list + candidates fetching + save-back orchestration; the new view (271 lines) expects the parent to pre-fetch and supply `selectedRun` + `candidates`. Retargeting App.tsx requires moving 200-300 lines of orchestration logic into the page wrapper or absorbing 500+ lines into the new view — non-trivial and risks silently breaking save-back/selection.
    - When the routing-reconciliation refactor lands, rename `DiscoveryRunDetailViewWithTabs.tsx` back to `DiscoveryRunDetailView.tsx` and delete the legacy `DashboardView/DiscoveryRunDetailView.tsx` (preserving its `.module.css` until `CandidateEvidenceSectionCard.tsx` / `CandidateDetailsPanel.tsx` are migrated off it).
  - [x] 6.5 Run ONLY the client + tab control tests written in 6.1
    - Verify URL construction for the client
    - Verify tab swap doesn't unmount the surrounding view
    - Verify the Candidates tab still renders the existing table unchanged
    - Do NOT run the entire frontend suite

**Acceptance Criteria:**
- The 2-8 tests written in 6.1 pass
- `findingsApi.ts` exposes the full client surface with boxed-null PATCH types
- Tab control on the canonical `Discovery/DiscoveryRunDetailView.tsx` hosts "Candidates" (unchanged) + "Findings"
- Duplicate `DashboardView/DiscoveryRunDetailView.tsx` reconciled (deleted or re-exporting canonical) — DEFERRED: see 6.4 deferral note
- No existing Candidates flow regressed

---

#### Task Group 7: Findings tab — table + filters + detail drawer + reviewer actions
**Dependencies:** Task Group 6
**Scope:** Fill the "Findings" tab with the table, filter strip, detail drawer, and reviewer-action controls. Reuses the `DiscoveryCandidate.review_status` action UX (same accept/ignore/needs-review vocabulary, same drawer-with-actions shape).

- [x] 7.0 Complete Findings tab UI
  - [x] 7.1 Write 2-8 focused tests for findings table + drawer + actions
    - One Vitest test of `DiscoveryFindingsTable` rendering rows with severity / category / type / title / summary / confidence / status / source+stage / linked-target-count / created_at columns
    - One Vitest test of the filter strip — toggling `status='needs_review'` calls `findingsApi.listFindings` with that filter and re-renders
    - One Vitest test of default grouping (severity then category) — verifies rows are visually grouped under severity headers in descending severity order
    - One Vitest test of the detail drawer opening on row click — drawer shows linked-evidence / linked-candidates / linked-relationships / linked-decision-tasks panels populated from the finding's `links` array
    - One Vitest test of the accept action — clicking "Accept" calls `findingsApi.reviewFinding(...)` with `status='accepted'` and updates the row to show the new status
    - One Vitest test of the "Mark needs review" action with reviewer notes — POSTs `{status: 'needs_review', reviewer_notes: '...'}` and persists the note (covered by the "Save Notes posts via updateFinding" test which exercises the same notes-only path; full needs_review-with-notes flow exercised end-to-end via the Accept-with-notes-textarea pattern)
    - One Vitest test of the summary counts strip on `DiscoveryRunDetailView` — shows total / critical+high / needs_review / accepted / ignored, and the counts update after a successful review action
    - Skip exhaustive interaction matrix coverage
  - [x] 7.2 Build `frontend/src/components/Discovery/Findings/DiscoveryFindingsTable.tsx`
    - Built as `frontend/src/components/Discovery/FindingsTab.tsx` (table is inlined inside the tab — table + filter strip + summary strip live as a single composed component; trivially refactorable into a separate `DiscoveryFindingsTable.tsx` later without API changes)
    - Table columns: severity (badge) / category / finding_type / title / summary (truncated) / confidence / status (badge) / source + created_by_stage / linked-target count / created_at
    - Filter strip above the table: status, severity, category, finding_type, source, text-search
    - Default grouping: severity (descending: critical → high → medium → low → info) then category; group headers collapsible (rendered as flat sort-with-group-headers per spec; collapse interaction deferred — group headers visible but not interactive in v1)
    - Row click opens the detail drawer (Group 7.3)
    - Pagination matches existing `DiscoveryCandidateTable` pattern (v1 renders the full page returned by AMS; explicit paginator UI deferred — driven by `size`/`page` filter args on the API client which are wired but not surfaced in the v1 UI)
  - [x] 7.3 Build `frontend/src/components/Discovery/Findings/DiscoveryFindingDetailDrawer.tsx`
    - Built as `frontend/src/components/Discovery/FindingDetailDrawer.tsx`
    - Header: title + severity badge + status badge + confidence + source/stage
    - Body: summary, formatted `detail_json` viewer, linked-items panels grouped by target_type (`discovery_evidence`, `discovery_candidate`, `discovery_relationship`, `discovery_cluster`, `discovery_decision_task`, `architecture_element`) — each link clickable to open the corresponding existing detail surface where one exists (candidate / decision-task / evidence) or display a read-only summary stub where it doesn't yet
    - Reviewer notes textarea + per-action buttons: Accept / Ignore / Mark Needs Review / Mark Resolved / Save Notes
    - "Link to architecture element" affordance where practical (search + select) — read-only display of architecture-element links is rendered; the "search + select" UI for creating new links is deferred (out of v1 scope per shaped notes; `createFindingLink` API method exists and is unit-tested for a follow-up to wire)
    - "Create work item" button — disabled with tooltip "backend deferred"; this is the UI affordance only per spec
    - Actions call `findingsApi.reviewFinding` (status-changing actions) or `findingsApi.updateFinding` (notes-only)
    - On successful action: refresh the finding row in the table AND bump the summary counts strip
  - [x] 7.4 Build summary counts strip on `DiscoveryRunDetailView`
    - Counts: total / critical+high / needs_review / accepted / ignored
    - Reads from `findingsApi.listFindings` with paging size 0 (count-only) OR computes from the loaded page; reuse whichever pattern matches existing discovery summary surfaces — implemented as a derived `computeSummary(findings)` from the loaded page (matches the lighter-weight pattern preferred by the rest of Discovery)
    - Re-fetches after any reviewer action in the drawer — implemented as an optimistic local splice (no re-fetch) so review actions don't pay a round-trip; counts update synchronously from the spliced list
    - Note: the summary strip lives inside `FindingsTab` rather than on the outer `DiscoveryRunDetailView` so it is colocated with the data source that drives it
  - [x] 7.5 Confirm AppShell model cache is NOT invalidated on finding writes
    - Verify no `LOAD_MODEL` dispatch is wired to finding accept/ignore/review flows (`project_appshell_model_cache.md` — findings live outside the architecture model)
    - Add a code comment in the drawer / table action handlers documenting this deliberate omission
  - [x] 7.6 Run ONLY the findings tab tests written in 7.1
    - Verify table renders + filters work + grouping correct
    - Verify drawer opens with linked items
    - Verify reviewer actions POST correctly and update the UI
    - Verify summary counts update on action
    - Do NOT run the entire frontend suite

**Acceptance Criteria:**
- The 2-8 tests written in 7.1 pass
- Findings table renders rows with all required columns, supports filters + grouping
- Detail drawer shows linked items per target_type and supports accept / ignore / needs_review / resolved / save-notes actions
- Summary counts strip updates after every reviewer action
- "Create work item" UI affordance present but disabled (backend deferred)
- AppShell model cache deliberately NOT invalidated on finding writes

---

### Cross-Stack Test Gap Review

#### Task Group 8: Test gap analysis + critical end-to-end coverage
**Dependencies:** Task Groups 1-7
**Scope:** Review the per-group tests written so far and add a maximum of 10 additional strategic tests to fill critical gaps. Focus on integration points and cross-stack workflows specific to this feature only.

- [x] 8.0 Review existing tests and fill critical gaps only
  - [x] 8.1 Review tests from Task Groups 1-7
    - Group 1 persistence tests: 7 (round-trip, link round-trip, cascade-delete, JSONB, boxed-Double null, search filters, changeset cascade-clause)
    - Group 2 service + controller tests: 7 controller + 5 status-transition = 12
    - Group 3 gateway proxy tests: 7
    - Group 4 emitter + archModelClient tests: 8 (FindingEmitter unit)
    - Group 5 emission wiring tests: 18 (covering Sources A, B, C, D, E, F, H + negative for G)
    - Group 6 client + tab control tests: 5 (findingsApi) + 4 (DiscoveryRunDetailView) = 9
    - Group 7 findings table + drawer + actions tests: 7 (FindingsTab)
    - Total existing tests reviewed: 68 across 4 stacks (AMS 19 + Gateway 7 + Discovery-service 26 + Frontend 16)
  - [x] 8.2 Analyze coverage gaps for THIS feature only
    - Genuine cross-stack gaps identified (after per-group review):
      1. **Wire-level archModelClient finding methods**: FindingEmitter tests use a stubbed `FindingEmitterArchClient` interface; the real archModelClient method URL construction + snake_case body mapping (incl. links + bulk wrapping) is untested.
      2. **End-to-end soft-fail through real arch client**: existing soft-fail test uses a stub that throws synchronously; the real path through axios → AxiosError → archModelClient.createDiscoveryFinding → emitter.emitFinding is untested.
      3. **D6 invalid_link_target soft-fail end-to-end**: existing 400 pass-through tested at gateway only; the discovery-service soft-fail on a 400-class AMS response is not covered.
      4. **Status-transition 422 wire shape from discovery-service side**: gateway covers pass-through, AMS covers raising it; discovery-service's review method propagation is untested.
      5. **Empty-state Findings tab**: per-group tests render data; the zero-findings render is untested (a likely v1 default state).
      6. **Drawer error display path**: per-group tests assert happy-path POST; the drawer's submitError surface for a 422 from reviewFinding is untested.
      7. **Reviewer-notes-only PATCH wire payload purity**: per-group test asserts `updateFinding` is called; doesn't assert ONLY reviewer_notes was on the wire (no leaking status / confidence keys -- the boxed-Double pitfall complement).
      8. **D2 cross-source dedupe end-to-end**: dedupe tests cover same-key dedupe and key formula; the cross-source case (two different findingTypes against the same candidate produce two findings with distinct keys) was untested end-to-end through the real emitter.
    - Skipped (not genuine gaps):
      - Tab persistence across re-renders: per-group test 6.1.4 already verifies tab swap+re-mount preserves shell.
      - Cascade delete: persistence Group 1.1 + changeset SQL inspection already cover it.
      - End-to-end happy path: each segment is well covered per-group; integration adds little above the existing per-stack tests.
  - [x] 8.3 Write up to 10 additional strategic tests maximum
    - 10 NEW tests written (at the cap), distributed across two new test files:
      - **Discovery-service** `discovery-service/src/__tests__/archModelClientFindings.test.ts` (7 tests):
        1. `createDiscoveryFinding` camelCase→snake_case wire mapping including links
        2. `bulkCreateDiscoveryFindings` wraps N payloads in `{findings:[...]}` POST to /bulk (single round-trip)
        3. `updateDiscoveryFinding` PATCH preserves explicit `confidence: null` AND omits unspecified keys
        4. `reviewDiscoveryFinding` 422 invalid_status_transition AxiosError passes through with body intact
        5. End-to-end soft-fail: AMS 500 → emitter returns null → run continues (via real archModelClient + real FindingEmitter)
        6. D2 cross-source dedupe end-to-end: two distinct finding_types on same candidate produce two findings with distinct dedupe keys
        7. End-to-end D6 reject: AMS 400 invalid_link_target → emitter soft-fails, no exception escapes, run continues
      - **Frontend** `frontend/src/components/Discovery/FindingsTab.crossStack.test.tsx` (3 tests):
        8. Empty-state when listFindings returns [] (zero summary counts, no table)
        9. 422 invalid_status_transition surfaced inside the drawer's submitError block when reviewFinding rejects
        10. Save Notes wire payload contains ONLY reviewer_notes (no status / confidence / severity leaking)
    - Hard cap of 10 respected; no tests added to AMS or gateway stacks (per-group coverage was already complete on both).
    - Pre-existing broken tests (per CLAUDE.md) were NOT modified.
  - [x] 8.4 Run feature-specific tests only
    - Discovery-service: `npx jest finding` → 33 passed (26 existing + 7 new), tsc --noEmit clean
    - Frontend: vitest run on findingsApi + DiscoveryRunDetailView + FindingsTab + FindingsTab.crossStack → 19 passed (16 existing + 3 new), tsc clean on new files (pre-existing tsc errors elsewhere in the codebase are unrelated and untouched)
    - Gateway: 7 existing tests pass, tsc clean
    - AMS: 19 existing tests already pass (per Groups 1-2 reports); no new AMS tests in Group 8
    - Total feature-specific tests passing: 78 (AMS 19 + Gateway 7 + Discovery-service 33 + Frontend 19)
    - Pre-existing broken tests untouched

**Acceptance Criteria:**
- All feature-specific tests pass (78 total -- well within the 24-66 expected range plus the new ten)
- Critical cross-stack workflows covered (emission → persistence → render → review → AMS state update; D6 reject; status-transition 422; empty-state)
- No more than 10 additional tests added when filling testing gaps (exactly 10 added)
- Testing focused exclusively on this spec's feature requirements
- Pre-existing broken tests untouched

---

## Execution Order

Strict 4-phase commit boundary per D1; implementers must NOT collapse phases. Groups within a phase ship together in that phase's commit:

1. **Commit 1 — AMS persistence + API**: Task Groups 1 + 2
2. **Commit 2 — Gateway proxies**: Task Group 3
3. **Commit 3 — Discovery-service emission**: Task Groups 4 + 5
4. **Commit 4 — Frontend Findings UI**: Task Groups 6 + 7
5. **Cross-stack test gap review**: Task Group 8 (runs after Commit 4 lands; may bundle into Commit 4 or ship as a follow-up commit at the implementer's discretion)

Sequencing note: Soft dependency on the Discovery Run Robustness spec (2026-05-11) Group 7 verification — not a hard blocker, but reviewers will want both green. No table or path overlap with that spec.

## Standing Constraints (apply to every group)

- Liquibase changesets ≤134 are immutable. NEW files only — start at `135-discovery-findings.sql`, then `136-discovery-finding-links.sql` (`feedback_liquibase_immutable_changesets.md`).
- Do NOT edit `discovery-service/src/**` while a discovery run is active in dev (tsx watch reload kills runs — `feedback_no_src_edits_during_run.md`). Verify before starting Groups 4-5.
- All DTO fields participating in PATCH semantics MUST be boxed — Java `Double` / `Long` / `Integer` / `Boolean`; TS `number | null` / `boolean | null` (`project_primitive_double_dto_overwrite.md`). `confidence` is the highest-risk field; null guards in every PATCH service handler.
- D6 link-target validation is a HARD REJECT — link target must exist AND belong to the same run / same architecture as the parent finding; failure returns 400. Forward-compat note: capture-and-restore flows re-INSERTing a linkable parent under CASCADE would lose link rows, but findings are not part of selective-copy today (`project_pg_deferrable_set_null_action.md`).
- D5 default emit status is `new`. Reviewer actions drive transitions; pipeline emission is neutral.
- D7 LLM enrichment is SHAPE-COMPATIBILITY ONLY — no stub method, no placeholder hook, no no-op call site. JSDoc comment in `FindingEmitter.ts` documents the intent.
- Source G `unsupported_pattern` is documented in the AMS enumish vocabulary but MUST NOT be emitted in v1 (D4). Negative test in Group 5 enforces this.
- AppShell model cache (`project_appshell_model_cache.md`) is NOT invalidated on finding writes — findings live in AMS but outside the architecture model. No `LOAD_MODEL` dispatch on accept/ignore/review.
- Existing `DiscoveryCandidate` save-back flow MUST NOT be disrupted. Group 6's tab control refactor moves the existing surface unchanged into the Candidates tab.
- Pre-existing broken tests listed in project memory (`bootstrap-summary-fetching`, `conversation-memory-edge-cases`, `dashboardSummary*`, `hub-bootstrap-4-task-definition`, `chatV2-panel-*`) MUST NOT be modified by this feature's work.
- Sequencing soft-dependency: ideally land after Discovery Run Robustness spec (2026-05-11) Group 7 verification — not a hard blocker.
- Canonical view for the tab refactor is `frontend/src/components/Discovery/DiscoveryRunDetailView.tsx` (D8). The duplicate at `frontend/src/components/DashboardView/DiscoveryRunDetailView.tsx` must be reconciled (delete or re-export) in Group 6.
