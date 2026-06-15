# Shaping Notes: Discovery Findings/Evidence as a First-Class Discovery Concept

Spec folder: `agent-os/specs/2026-05-16-discovery-findings-first-class/`
Raw idea: `agent-os/specs/2026-05-16-discovery-findings-first-class/planning/raw-idea.md`
No visuals required (backend + frontend feature, no design layer).

---

## Final Summary

**Scope.** Introduce `DiscoveryFinding` as a first-class, queryable, reviewable entity in AMS, surfaced through the gateway, emitted by the discovery-service pipeline at well-defined hook points (sources A, B, C, D, E, F, H from the raw idea), and presented in the frontend via a new "Findings" tab on the Discovery Run Detail view. Findings are run-scoped, architecture-scoped, link to 0..N existing discovery entities (candidates, decision tasks, relationships, evidence, clusters, architecture elements), are deduped deterministically, and carry reviewer-driven status transitions.

**Key decisions (D1-D8).** Single spec, 4 phased commits (AMS → gateway → discovery-service → frontend). Deterministic dedupe priority across linked targets. `candidate_conflict` ships in v1. `unsupported_pattern` deferred to a per-pack follow-up but documented in the enum. Default emit status is `new`. Hard-reject invalid links at creation, `ON DELETE CASCADE` from parents. LLM enrichment is shape-compatible only — no code in v1. Frontend tab control replaces the current "View Candidates" toggle on `DiscoveryRunDetailView.tsx`, with "Candidates" + "Findings" as the initial tabs.

**Services touched.** `architecture-model-service` (new entity, repository, service, controller, DTOs, Liquibase changesets 135-136). `gateway` (new proxies under `gateway/src/routes/discovery.ts`). `discovery-service` (new `FindingEmitter` + emit-site wiring at the V3 pipeline / triage engine / runtime matcher hooks). `frontend` (tab control + findings table + drawer + reviewer actions on `frontend/src/components/Discovery/DiscoveryRunDetailView.tsx`).

**Sequencing — 4 phased commits on a single spec.**
1. **AMS persistence + tests** — entity, repository, service, controller, DTOs, Liquibase 135 (findings) + 136 (finding_links).
2. **Gateway proxies + tests** — new routes mirroring the AMS surface area.
3. **Discovery-service `FindingEmitter` + v1 source wiring + tests** — emit at sources A, B, C, D, E, F, H.
4. **Frontend tab + findings table + drawer + reviewer actions + tests.**

**Out of scope (explicit).**
- Source G `unsupported_pattern` v1 emission (deferred to per-pack follow-up; enum value retained for forward compat).
- Pack-specific (Java/Spring/Maven) finding sources.
- DB discovery pack findings.
- Migration book-of-work generation.
- "Create work item" action backend (UI affordance acceptable; backend deferred).
- Cross-run finding correlation / trends.
- LLM-driven enrichment of findings (shape-compatibility only).

---

## Resolved Decisions

### D1 — Commit grouping / migration sequencing — RESOLVED
**Decision:** Single spec, implementation phased into 4 sequential commits: (1) AMS persistence + tests, (2) gateway proxies + tests, (3) discovery-service `FindingEmitter` + v1 source wiring + tests, (4) frontend tab + drawer + reviewer actions + tests. One coherent design, four reviewable commits.

### D2 — Dedupe key: "primary linked target" — RESOLVED
**Decision:** Dedupe key is `runId + findingType + category + title + primaryLinkedTarget`. `primaryLinkedTarget` is computed deterministically by the emitter using priority order on `target_type`:
`discovery_candidate > discovery_decision_task > discovery_relationship > discovery_evidence > discovery_cluster > architecture_element`.
Take the highest-priority link present; tiebreak by lowest `target_id`. When a finding has no links, use the empty string. This logic lives in the emitter and must be documented in code and the spec.

### D3 — `candidate_conflict` in v1 — RESOLVED
**Decision:** `candidate_conflict` IS in v1. Signal already exists (`dedupDroppedCount` in `discoveryV3Pipeline.ts`; competing relationships in `triageEngine.ts`). Severity: medium. Category: ambiguity. Add to the AMS finding_type enum and wire emit at the dedupe/competing-relationship hook points.

### D4 — Source G `unsupported_pattern` — RESOLVED
**Decision:** Defer v1 emission to a per-pack follow-up spec. The `unsupported_pattern` value remains documented in the AMS finding_type enum so packs can emit later via the `FindingEmitter` without an AMS schema change. Explicitly listed in spec out-of-scope.

### D5 — Default emit status — RESOLVED
**Decision:** Default status on pipeline emit is `new`. The pipeline is neutral; reviewer actions drive transitions (`accepted`, `ignored`, `needs_review`, `resolved`). Matches the existing `DiscoveryCandidate.review_status` pattern.

### D6 — Linked-target validation strictness — RESOLVED
**Decision:** Hard-reject invalid links at creation — the link's target must exist AND belong to the same run / same architecture as the parent finding. Validation failures return 400 from the AMS controller. On parent deletion, declare `ON DELETE CASCADE` from `discovery_findings` to `discovery_finding_links` AND from each linkable parent (`discovery_candidate`, `discovery_decision_task`, `discovery_relationship`, `discovery_evidence`, `discovery_cluster`, `architecture_element`) to the corresponding `discovery_finding_links` rows. Notes for the spec writer:
- Per `project_pg_deferrable_set_null_action.md`, capture-and-restore flows that re-INSERT parents would lose their finding-link rows. Findings are not part of selective-copy today, so this is a forward-compat note, not a blocker.

### D7 — LLM enrichment in v1 — RESOLVED
**Decision:** Shape compatibility only. DTO fields `summary`, `detail_json`, `confidence`, `source` (with `'llm_enrichment'` as a documented future value), and `created_by_stage` are enrichment-friendly. **No** stub code, no placeholder no-op method, no LLM call site. A "Future enrichment" note goes in the spec.

### D8 — Frontend tab placement — RESOLVED
**Decision:** Add a tab control to the existing `DiscoveryRunDetailView` with "Candidates" (current content moved into the first tab) + "Findings" (new) to start. Future tabs (Evidence, Decision Tasks, Relationships, Clusters) slot in cleanly later. Canonical home: `frontend/src/components/Discovery/DiscoveryRunDetailView.tsx`. The duplicate copy at `frontend/src/components/DashboardView/DiscoveryRunDetailView.tsx` (per Spec 2026-05-04) needs to be reconciled — spec should call out the canonical-vs-duplicate cleanup.

---

## Codebase Reality Check

### AMS — already persisted (entity + controller + service + Liquibase)
- `DiscoveryRunEntity` — `architecture_id` is **NOT NULL** (Spec #4 2026-05-01). Runs are always architecture-scoped.
- `DiscoveryCandidateEntity`, `DiscoveryCandidateEntityMappingEntity`
- `DiscoveryEvidenceEntity` — raw extracted atoms; JSONB data; types include `file_structure`, `symbol`, `string_pattern`, `llm_file_analysis`, `extension_pack_analysis`
- `DiscoveryRelationshipEntity`, `DiscoveryClusterEntity` + `DiscoveryClusterMemberEntity`
- `DiscoveryDecisionTaskEntity`, `DiscoveryConfigEntity`
- Controllers all follow `/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/...` (raw idea wrote `/api/projects/...` — correct path is `/api/model/projects/...`).

### AMS — does NOT exist yet
- `DiscoveryFinding` entity, repository, service, controller
- `discovery_findings` table + `discovery_finding_links` table
- Finding DTOs (request/response shapes)

### Liquibase numbering
- Tail occupied: 124-134 (124 application-points-target-type-library through 134 api-behaviour-baseline-items).
- **Next available: 135.** New findings changesets:
  - `135-discovery-findings.sql`
  - `136-discovery-finding-links.sql`
- Per `feedback_liquibase_immutable_changesets.md`, never edit applied changesets — only add new ones.

### Discovery-service — emission points for v1 finding sources (A-H, with G deferred per D4)

| Source | Where it hooks today | Status |
|---|---|---|
| **A** low-confidence candidate | `discoveryV3Pipeline.ts` after merge (~line 666 dedupe step); `triageEngine.ts` knows `AMBIGUOUS_THRESHOLD` | v1 emit |
| **B** unresolved decision task | `triageEngine.ts` creates DecisionTasks; new finding-emit call alongside DecisionTask creation | v1 emit |
| **C** candidate conflict / duplicate | `discoveryV3Pipeline.ts` `dedupDroppedCount` + `triageEngine.ts` competing-relationships path | v1 emit (D3) |
| **D** unmatched runtime endpoint | `runtimeEvidence/endpointRuntimeMatcher.ts` + `endpointRuntimeAggregator.ts` already produce `unmatchedRouteHintCandidates` | v1 emit |
| **E** runtime evidence on endpoint candidate | `runtimeEvidence/runDiscoveryRuntimeEvidence.ts` already correlates aggregates to endpoint candidates | v1 emit |
| **F** ambiguous relationship inference | `linkerRules/*` + `triageEngine.ts` resolve-competing-relationships path | v1 emit |
| **G** unsupported / partially supported pattern | **No upstream signal today.** | **Deferred (D4)** — enum value retained, no v1 emit |
| **H** evidence gap | Post-merge inspection of candidates (endpoint without responseSchema, interface without contract detail, service candidate with no owner, data entity without attributes) | v1 emit — generic post-merge pass |

### Frontend — DiscoveryRunDetailView reality
- Current shape: single-pane view with header + run info + run-list + "View Candidates" toggle revealing `DiscoveryCandidateTable`. **No tabs today.** No decision-task / evidence / relationship / cluster surfaces here yet. **No Evidence Explorer exists today.**
- Adding a "Findings" tab means introducing a tab control where there isn't one.
- **Two copies exist** (per Spec 2026-05-04 routing):
  - `frontend/src/components/DashboardView/DiscoveryRunDetailView.tsx`
  - `frontend/src/components/Discovery/DiscoveryRunDetailView.tsx` (+ `DiscoveryRunDetailPage.tsx`)
- **Canonical for new tab work: `frontend/src/components/Discovery/DiscoveryRunDetailView.tsx`** (per D8). Reconcile or remove the `DashboardView/` duplicate as part of phase 4.
- AppShell model cache (`project_appshell_model_cache.md`) does NOT need invalidation on finding writes — findings live in AMS but outside the architecture model; no `LOAD_MODEL` dispatch required.

### Gateway
- Existing pattern in `gateway/src/routes/discovery.ts` is the proxy template. New findings proxies fit cleanly under the same router with shape `/projects/:projectId/architectures/:architectureId/discovery/runs/:runId/findings...`. No new pattern needed.

### Cross-references with in-flight work
- **Discovery Run Robustness spec (2026-05-11):** Wave 1+2 done, Group 7 verification pending. No table overlap. Sequence after that verification lands — not a hard blocker but reviewers will want both green.
- **API Behaviour spec (just landed, changesets 128-134):** no overlap; just consumes adjacent changeset numbers.
- **`feedback_no_src_edits_during_run.md`:** implementation phase must avoid editing `discovery-service/src/**` while a discovery run is active (tsx watch restarts kill runs). Flag in the spec's implementation-notes section.

---

## Items to flag explicitly in spec implementation-notes section
- Liquibase: new changesets start at 135 (`135-discovery-findings.sql`, `136-discovery-finding-links.sql`).
- Path convention: `/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/findings/...` (correct the raw idea's `/api/projects/...`).
- `discovery_findings.architecture_id` is **NOT NULL** — `DiscoveryRunEntity.architecture_id` is itself NOT NULL, runs are always architecture-scoped, findings ride on the run.
- Per `feedback_no_src_edits_during_run.md`: avoid editing `discovery-service/src/**` during active discovery runs in dev.
- Per `feedback_liquibase_immutable_changesets.md`: never edit applied changesets — only add new ones.
- AppShell cache (`project_appshell_model_cache.md`) does NOT need invalidation on finding writes.
- Sequence after Discovery Run Robustness Group 7 verification lands (soft).
- Reconcile the two `DiscoveryRunDetailView.tsx` copies during phase 4; canonical is the `Discovery/` one.
- Forward-compat note re: `project_pg_deferrable_set_null_action.md` — capture-and-restore flows that re-INSERT a linkable parent would lose link rows under CASCADE. Findings aren't in selective-copy today, but the note belongs in the spec.

---

## Out of Scope (consolidated)
- Source G `unsupported_pattern` v1 emission — deferred to per-pack follow-up; enum value retained for forward compatibility.
- Pack-specific (Java/Spring/Maven) finding sources.
- DB discovery pack findings.
- Migration book-of-work generation.
- "Create work item" action backend (UI affordance acceptable; backend deferred).
- Cross-run finding correlation / trends.
- LLM-driven enrichment of findings (shape-compatibility only in v1).
