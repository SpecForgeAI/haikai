# Specification: Discovery Findings / Evidence as a First-Class Discovery Concept

## Goal
Introduce `DiscoveryFinding` as a durable, run-scoped, reviewable entity in `architecture-model-service`, exposed via gateway proxies, emitted by `discovery-service` at seven well-defined v1 hook points, and reviewed in the frontend via a new "Findings" tab on `DiscoveryRunDetailView`. Findings sit alongside (not inside) the architecture model and form the foundation for later migration-planning workflows.

## User Stories
- As a solutions architect reviewing a discovery run, I want to see migration-useful intelligence (risks, ambiguities, evidence gaps, runtime observations) as durable findings separate from candidates so that I can triage non-architecture insights without polluting the model.
- As a reviewer, I want to accept, ignore, mark needs-review, mark resolved, and add notes to findings, with links to the candidates / evidence / relationships / decision tasks that support them, so that my review state survives across sessions.
- As a discovery-pipeline developer, I want a single `FindingEmitter` utility that normalizes finding shape, dedupes deterministically, attaches links, and degrades to a warn-and-continue on persistence failure so that pipeline stages can emit findings without bespoke wiring.

## Specific Requirements

**AMS persistence: `discovery_findings` table (Liquibase 135-discovery-findings.sql)**
- Columns: `id` (PK), `run_id` (FK NOT NULL to `discovery_runs`), `project_id` (NOT NULL), `architecture_id` (NOT NULL — matches `DiscoveryRunEntity.architecture_id` which is itself NOT NULL), `finding_type` (string), `category` (string), `severity` (string: info/low/medium/high/critical), `confidence` (numeric 0-1 nullable), `status` (string: new/accepted/ignored/needs_review/resolved; default `new` per D5), `title` (string NOT NULL), `summary` (text), `detail_json` (jsonb nullable), `source` (string), `created_by_stage` (string), `created_at`, `updated_at`, `reviewed_at` (nullable), `reviewer_notes` (text nullable).
- Indexes: `run_id`, `project_id`, `architecture_id`, `status`, `category`, `severity`, `finding_type`, `source`.
- String-typed enumish fields (not Java enums) — preserves extensibility for future pack-specific values without DDL.
- Liquibase tail is 134; this is changeset 135. Never edit applied changesets (`feedback_liquibase_immutable_changesets.md`).

**AMS persistence: `discovery_finding_links` table (Liquibase 136-discovery-finding-links.sql)**
- Columns: `id` (PK), `finding_id` (FK to `discovery_findings`, NOT NULL, `ON DELETE CASCADE` per D6), `link_type` (string: supports/derived_from/related_to/blocks/resolves/saved_as/references), `target_type` (string: discovery_evidence / discovery_candidate / discovery_relationship / discovery_cluster / discovery_decision_task / architecture_element; future-only values `work_item`, `api_behaviour_baseline` documented but not emitted in v1), `target_id` (string NOT NULL), `label` (string nullable), `created_at`.
- Indexes: `finding_id`, composite `(target_type, target_id)`.
- Forward-compat note (`project_pg_deferrable_set_null_action.md`): capture-and-restore flows that re-INSERT a linkable parent under CASCADE would lose link rows. Findings are NOT part of selective-copy today, so this is a note for future work, not a v1 blocker.

**AMS Java surface: entity, repository, service, controller, DTOs**
- Entity `DiscoveryFindingEntity` and `DiscoveryFindingLinkEntity` under `architecture-model-service/src/main/java/com/example/architecturemodel/`.
- DTOs: `DiscoveryFindingDto`, `DiscoveryFindingLinkDto`, `CreateDiscoveryFindingRequest`, `UpdateDiscoveryFindingRequest`, `ReviewDiscoveryFindingRequest`, `DiscoveryFindingSearchResponse`, `BulkCreateDiscoveryFindingsRequest`.
- DTO numeric/boolean fields that participate in PATCH semantics MUST be boxed (`Double`, `Long`, `Boolean`) per `project_primitive_double_dto_overwrite.md` — `confidence` is `Double`, not `double`; service code null-guards on update.
- Repository: Spring Data JPA repository with derived queries for the indexed filter columns + a specification or @Query for multi-field search.
- Service enforces: run/project/architecture scoping on every read/write; status transition validation (`new` → any; `accepted`/`ignored` → `needs_review`/`resolved`; `resolved` is terminal but re-openable to `needs_review`); link target existence + same-run / same-architecture check (D6 hard-reject, 400 on failure); reviewer-notes-only updates allowed without status change.
- Controller path convention: `/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/findings` (NOT `/api/projects/...` — the raw idea was wrong, this corrects it).

**AMS REST endpoints**
- `GET .../findings` — list with query filters: `category`, `findingType`, `severity`, `status`, `source`, `createdByStage`, `linkedTargetType`, `linkedTargetId`, plus paging + text search.
- `POST .../findings` — single create.
- `POST .../findings/bulk` — bulk create (used by `FindingEmitter` post-merge).
- `GET .../findings/{id}` — fetch single, including links.
- `PATCH .../findings/{id}` — update mutable fields (title/summary/detail_json/severity/category/reviewer_notes/status; status validated).
- `POST .../findings/{id}/review` — convenience endpoint for `{ status, reviewer_notes? }` setting `reviewed_at`.
- `GET/POST/DELETE .../findings/{findingId}/links(/{linkId})` — link management; POST validates target before insert (D6).

**Gateway proxies (phase 2)**
- Extend `gateway/src/routes/discovery.ts` following the existing discovery proxy template.
- Mirror the AMS surface area 1:1 under `/projects/:projectId/architectures/:architectureId/discovery/runs/:runId/findings...`.
- No business logic in gateway — pass-through with auth + path translation only.
- Jest tests for each proxied route (success path + AMS error pass-through).

**Discovery-service `FindingEmitter` (phase 3)**
- New module `discovery-service/src/services/findings/FindingEmitter.ts` exporting `emitFinding({...})` and `emitFindings([...])`.
- Responsibilities: normalize `finding_type` / `category` / `severity`; default `status = 'new'` (D5); attach `run_id` / `project_id` / `architecture_id`; attach evidence/candidate/relationship/decision-task/cluster/architecture-element links; compute dedupe key (D2: `runId + findingType + category + title + primaryLinkedTarget`); `primaryLinkedTarget` priority `discovery_candidate > discovery_decision_task > discovery_relationship > discovery_evidence > discovery_cluster > architecture_element`, tiebreak lowest `target_id`, empty string when no links; persist via `archModelClient`; on persistence failure log a warning and continue — never fail the discovery run.
- New `archModelClient` methods: `createDiscoveryFinding`, `bulkCreateDiscoveryFindings`, `listDiscoveryFindings`, `updateDiscoveryFinding`, `reviewDiscoveryFinding`, `createDiscoveryFindingLink`.
- LLM enrichment (D7): shape compatibility only — `summary`, `detail_json`, `confidence`, `source` (with `'llm_enrichment'` as a documented-but-unused future source), `created_by_stage` are enrichment-friendly. NO stub method, NO placeholder call site, NO no-op enrichment hook.

**Discovery-service v1 emission sources (phase 3)**
- A — low-confidence candidate (`low_confidence_candidate` / `ambiguity` / low-medium): emit after merge in `discoveryV3Pipeline.ts` using `triageEngine.ts` `AMBIGUOUS_THRESHOLD`.
- B — unresolved decision task (`unresolved_decision_task` / `ambiguity` / medium): emit alongside `DecisionTask` creation in `triageEngine.ts`.
- C — candidate conflict / duplicate (`candidate_conflict` / `ambiguity` / medium): emit at `dedupDroppedCount` site in `discoveryV3Pipeline.ts` AND at competing-relationship resolution in `triageEngine.ts` (D3 — in v1).
- D — unmatched runtime endpoint (`unmatched_runtime_endpoint` / `runtime_usage` / medium-high): emit from `runtimeEvidence/endpointRuntimeMatcher.ts` / `endpointRuntimeAggregator.ts` using existing `unmatchedRouteHintCandidates`.
- E — runtime evidence on endpoint candidate (`runtime_usage_observation` / `runtime_usage` / info): emit from `runtimeEvidence/runDiscoveryRuntimeEvidence.ts`.
- F — ambiguous relationship inference (`ambiguous_relationship` / `ambiguity` / low-medium): emit from `linkerRules/*` + `triageEngine.ts` competing-relationships path.
- H — evidence gap (`evidence_gap` / `evidence_gap` / medium): new generic post-merge pass scanning for endpoint-without-responseSchema, interface-without-contract-detail, service-candidate-without-owner, data-entity-without-attributes.
- G — `unsupported_pattern`: enum value documented in AMS for forward compat; NO v1 emission (D4 — deferred to per-pack follow-up).

**Frontend tab refactor + Findings UI (phase 4)**
- Canonical home: `frontend/src/components/Discovery/DiscoveryRunDetailView.tsx` (D8). Reconcile/remove the duplicate at `frontend/src/components/DashboardView/DiscoveryRunDetailView.tsx` (left over from Spec 2026-05-04 routing) as part of this phase.
- Introduce a tab control where the current "View Candidates" toggle lives. Initial tabs: "Candidates" (existing `DiscoveryCandidateTable` content moves here unchanged) + "Findings" (new). Tab structure designed so Evidence / Decision Tasks / Relationships / Clusters can slot in later without restructuring.
- Findings tab content: table with severity / category / type / title / summary / confidence / status / source+stage / linked target count / created_at; filters for status / severity / category / type / source / text-search; default grouping severity then category.
- Finding detail drawer: readable title/summary/detail_json, severity/category/type/status, confidence, source/stage, linked-evidence/candidates/relationships/decision-tasks/architecture-elements panel (this is the "Evidence Explorer improvement" reduced scope — a linked-evidence panel inside the drawer, not a standalone explorer), reviewer notes. Actions: accept / ignore / mark needs review / mark resolved / add notes / open linked items / link to architecture element where practical. "Create work item" UI affordance acceptable; backend deferred.
- Discovery run detail summary counts: total / critical+high / needs_review / accepted / ignored.
- TypeScript DTO mirror: numeric/boolean PATCH-eligible fields typed as `number | null` / `boolean | null`.
- AppShell model cache (`project_appshell_model_cache.md`) is NOT invalidated on finding writes — findings live outside the architecture model; no `LOAD_MODEL` dispatch needed.

**Commit boundaries (per D1)**
- Commit 1 — AMS persistence + API + tests: Liquibase 135 + 136, entities, repository, service, controller, DTOs, validation, status transitions, link validation.
- Commit 2 — Gateway proxies + tests: routes under `gateway/src/routes/discovery.ts` mirroring AMS surface.
- Commit 3 — Discovery-service `FindingEmitter` + 7 v1 source wirings + archModelClient methods + tests.
- Commit 4 — Frontend tab control + Findings table + drawer + reviewer actions + duplicate-view reconciliation + tests.
- Task-list-creator should mirror these four commit groups as four task-list phases.

**Testing requirements**
- AMS: create with full validation (project/architecture/run scope, status default, status transitions, link target validation + same-run/architecture rejection), list with each filter, bulk create, update without status change, review endpoint sets `reviewed_at`, link create / reject-on-bad-target / delete, CASCADE on parent delete.
- Discovery-service: `FindingEmitter` normalize + persist + failure-soft (mock archModelClient throws → run continues, warning logged); dedupe key computation including the priority + tiebreak rules; one happy-path test per v1 source (A, B, C, D, E, F, H).
- Frontend: tab control renders both tabs, Findings table renders rows + filter behavior, drawer opens with linked refs, accept/ignore/needs-review/notes actions update AMS, summary counts update after status change.
- Gateway: each new route success + error pass-through.
- Do NOT touch the pre-existing broken tests listed in `CLAUDE.md` (bootstrap-summary-fetching, conversation-memory-edge-cases, dashboardSummary*, hub-bootstrap-4-task-definition, chatV2-panel-*).

**Implementation-notes constraints**
- Path convention is `/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/findings/...` (raw idea's `/api/projects/...` was wrong).
- New Liquibase changesets start at 135. Never edit applied changesets ≤134 (`feedback_liquibase_immutable_changesets.md`).
- Per `feedback_no_src_edits_during_run.md`: do not edit `discovery-service/src/**` while a discovery run is active in dev (tsx watch restarts kill runs).
- Sequence after Discovery Run Robustness spec (2026-05-11) Group 7 verification lands — soft dependency, not a hard blocker.
- Existing `DiscoveryRun`, `DiscoveryCandidate`, `DiscoveryEvidence`, `DiscoveryRelationship`, `DiscoveryCluster`, `DiscoveryDecisionTask` entities are already present — do NOT recreate. `DiscoveryFinding` is the only genuinely new entity.

## Existing Code to Leverage

**`architecture-model-service/.../discovery/*Entity` family + Liquibase tail at 134**
- `DiscoveryRunEntity`, `DiscoveryCandidateEntity`, `DiscoveryEvidenceEntity`, `DiscoveryRelationshipEntity`, `DiscoveryClusterEntity`, `DiscoveryDecisionTaskEntity` already provide the entity / repository / service / controller pattern to mirror for `DiscoveryFindingEntity`.
- `DiscoveryRunEntity.architecture_id NOT NULL` is the precedent — findings inherit this constraint.
- Reuse the controller path shape `/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/...` exactly.

**`gateway/src/routes/discovery.ts` (existing proxy pattern)**
- Already proxies discovery routes from gateway to AMS. New findings proxies fit cleanly under the same router and Jest-mock pattern. No new infrastructure needed.

**`discovery-service/src/discoveryV3Pipeline.ts` + `triageEngine.ts` + `runtimeEvidence/*` + `linkerRules/*`**
- `discoveryV3Pipeline.ts` already has the merge + dedupe site (`dedupDroppedCount`) where sources A and C emit.
- `triageEngine.ts` already computes `AMBIGUOUS_THRESHOLD`, creates DecisionTasks, and resolves competing relationships — emission sites for A, B, C, F.
- `runtimeEvidence/endpointRuntimeMatcher.ts` + `endpointRuntimeAggregator.ts` already produce `unmatchedRouteHintCandidates` — source D.
- `runtimeEvidence/runDiscoveryRuntimeEvidence.ts` already correlates aggregates to endpoint candidates — source E.

**`frontend/src/components/Discovery/DiscoveryRunDetailView.tsx` + `DiscoveryRunDetailPage.tsx`**
- Canonical view per D8 and Spec 2026-05-04. Current "View Candidates" toggle and `DiscoveryCandidateTable` move into a "Candidates" tab as-is during the tab control introduction.
- The duplicate at `frontend/src/components/DashboardView/DiscoveryRunDetailView.tsx` is reconciled/removed in phase 4.

**`DiscoveryCandidate.review_status` pattern (frontend + AMS)**
- Existing accept/ignore/needs-review flow on candidates is the template for finding reviewer actions: same status vocabulary semantics (new/accepted/ignored/needs_review), same drawer-with-actions UX, same backend status-transition validation pattern.

## Out of Scope
- Source G `unsupported_pattern` v1 emission (deferred to per-pack follow-up per D4; enum value retained for forward compat).
- Cross-run finding correlation, trends, or analytics.
- LLM enrichment implementation (shape compatibility only per D7; no stub code, no placeholder method, no call site).
- Java/Spring/Maven pack-specific finding sources.
- Database discovery pack findings.
- Migration book-of-work generation (roadmap / migration backlog / epics / features / shape-spec-ready stories).
- "Create work item" backend (UI affordance acceptable; backend deferred).
- Automatic semantic diff of architectures.
- Replacing or restructuring existing `DiscoveryCandidate` / `DiscoveryEvidence` / `DiscoveryDecisionTask` flows (candidate save-back continues unchanged).
- Persisting large raw evidence blobs beyond what `DiscoveryEvidence` already stores.
