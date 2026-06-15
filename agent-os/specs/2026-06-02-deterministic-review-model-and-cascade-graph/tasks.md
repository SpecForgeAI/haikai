# Task Breakdown: Deterministic Review Model + Cascade/Dependency Graph + Aggregation Backbone

## Overview
Total Tasks: 7 task groups

This is "Spec 1" of the discovery-review-unification program (F → 0 → 1 → 2 → 3). It builds a DETERMINISTIC (no-LLM) review-model + typed cascade/dependency-graph + aggregation backbone in `discovery-service`, computed live on read, exposed via a NEW read endpoint, proxied by the gateway, and consumed single-run by re-pointing the existing candidate grid's count/aggregation `useMemo`s. The model is READ-ONLY and NEVER persisted (recompute on read); there is NO AMS schema / Liquibase change.

### CRITICAL cautions (apply to ALL discovery-service groups — 1, 2, 3, 4)
- **NO `discovery-service/src/**` edits while a discovery run is active.** `tsx watch` auto-reload kills in-flight runs (`feedback_no_src_edits_during_run`). This includes test files under `src/**`. CONFIRM no discovery run is active before starting any discovery-service group, and pause edits if one starts.
- **tree-sitter jest isolation** (`project_tree_sitter_jest_isolation_fix`): the review-model module itself is pure / no-parse, but the endpoint tests in Group 4 import the runs router, which may transitively pull parser modules. If a combined jest run flakes on parse-touching suites, RE-RUN the parse-touching suite in ISOLATION; never add a bare top-level `require('tree-sitter')` to any module.
- **No git operations** (`feedback_no_git_operations`) — stop at code + verification; the user owns all commits/branches/pushes.

### Build-fresh / reuse rules (confirmed by the spec)
- Build the graph + closure FRESH as a pure closure over the candidate graph. The existing `discovery-service/src/services/transitiveDependencyWalker.ts` (Maven/npm library-dependency BFS with I/O + writes) and `discovery-service/src/types/relationship.ts` (Layer-1b evidence-atom relationships) are WRONG-DOMAIN — do NOT reuse them.
- DO reuse Spec 0 primitives directly: `discovery-service/src/services/candidateIdentity.ts` (`buildIdentityKey`, `classifySourceTier`/`SOURCE_TIER_RANK`, `readAddedBy`), `candidateMerge.ts` (conflict/provenance/merge-group model, typed by `CandidateMergeData` in `discovery-service/src/types/candidate.ts`), and `candidateReconcile.ts`'s name→survivor resolution rule (`ENTITY_NAME_FIELDS = ['logicalEntityName','dataEntityName']`, `ldeIdentityKeyForName`, `ldeSurvivorNameByKey`, drop-orphan-row behaviour).
- `*_points` polymorphic wrappers (`application_points`, `data_entity_points`, `business_points`, `app_business_points`) are backend auto-managed and are NEVER nodes or edges anywhere.

### Test commands
- discovery-service / gateway: `jest` (e.g. `npx jest <files>`)
- frontend: `npx vitest run <files>`

## Task List

### Discovery Service — Model & Graph Foundation

#### Task Group 1: Review-Model Types + Pure Node-Set + Typed-Edge Builder
**Dependencies:** None

- [x] 1.0 Define the review-model + graph types and build the pure node-set + typed-edge construction (no I/O)
  - [x] 1.1 Write 2-8 focused jest tests for node-set + edge construction
    - Place under `discovery-service/src/services/reviewModel/` (e.g. `reviewModel.graph.test.ts`)
    - Test ONLY critical behaviours: (a) each candidate becomes a node carrying review status, `committed`, conflict flags from `data._conflicts`/`_conflictResolutions`, provenance (`_addedBy`/`_mergedFrom`), merge-group, `operation`, candidate type, source tier (via `classifySourceTier`), and scan-kind; (b) structural `parentCandidateId` → one parent→child edge with correct `edgeKind` + direction; (c) at least one name-keyed relationship row (`interface_logical_entities` or `endpoint_data_effects`) resolves endpoint BY NAME → survivor via `buildIdentityKey`, and a row resolving to NO survivor is DROPPED (orphan); (d) `*_points` rows produce NO node and NO edge
    - Skip exhaustive coverage of every edgeKind here (the full taxonomy + cross-scan is covered in Groups 2-3)
  - [x] 1.2 Define the review-model + graph TypeScript types
    - New module dir `discovery-service/src/services/reviewModel/` (e.g. `types.ts`)
    - `ReviewModelNode`: candidate id, candidateType, name, review status (Spec F vocabulary `pending_review`/`approved`/`rejected`/`deferred`), `committed` flag, conflict flags (live-conflict booleans + the underlying `_conflicts`/`_conflictResolutions` lens via `CandidateMergeData`), provenance (`_addedBy`/`_mergedFrom`), merge-group membership, `operation` (`create`/`enrich`/`link`), source tier (`SourceTier`), scan-kind (`code`/`database`)
    - `ReviewModelEdge`: a TYPED edge carrying an `edgeKind` discriminator + direction (e.g. `fromId`/`toId` with parent→child / source→target orientation). `edgeKind` union = `parent_child` (structural) PLUS the six relationship-row kinds (`interface_logical_entities`, `endpoint_data_effects`, `logical_data_entity_physical_data_entities`, `logical_data_attribute_physical_data_attributes`, `logical_data_entity_relationships`, `data_movements`)
    - `ReviewFindingNode`: finding id, review status, severity, category, candidate link ids
    - Top-level `ReviewModel`: `nodes`, `edges`, `findings`, `blastRadius` (Group 2), `aggregations` (Group 2) — shaped for snake_case serialization on the read endpoint and for Spec 2 (preview→confirm) / Spec 3 (conversation) downstream consumption with no rework
    - `edgeKind` source of truth = the relationship-kind union + per-kind doc comments in `discovery-service/src/types/candidate.ts` (note `data_movements` REUSES the existing relationship type, not a new one)
  - [x] 1.3 Build the pure node-set from candidates
    - One node per candidate, EXCLUDING all `*_points` wrapper candidates
    - Read source tier via `classifySourceTier`(best `_addedBy` label) and provenance via `readAddedBy` (reuse `candidateIdentity.ts` — do NOT re-derive)
    - Read conflict/provenance/merge-group via the `CandidateMergeData` lens (reuse `candidateMerge.ts` shape — do NOT re-derive)
    - Read scan-kind from the run the candidate belongs to (each run is `code` XOR `database`)
  - [x] 1.4 Build structural `parentCandidateId` edges
    - Emit one `parent_child` edge per candidate with a `parentCandidateId`, parent→child direction
    - Mirror the structural walk in `candidateReconcile.ts`
  - [x] 1.5 Build relationship-row edges with NAME→survivor resolution
    - Emit one typed edge per relationship-row candidate, one `edgeKind` per relationship type, with correct direction
    - For rows that NAME their endpoints, resolve BY NAME → survivor candidate using `buildIdentityKey`, mirroring `candidateReconcile.ts` (`ENTITY_NAME_FIELDS = ['logicalEntityName','dataEntityName']` read from `data`, mapped through the same identity-key helper / `ldeSurvivorNameByKey` index)
    - DROP any relationship row whose endpoint resolves to NO surviving candidate (orphan), exactly matching reconcile's drop-orphan behaviour
    - Handle candidate-id-referencing rows directly; never assume relationship rows carry candidate-id endpoints
    - NO I/O, NO LLM, NO mutation of candidate/finding rows
  - [x] 1.6 Ensure foundation tests pass
    - Run ONLY the 2-8 tests written in 1.1: `npx jest src/services/reviewModel`
    - Do NOT run the entire discovery-service suite at this stage
    - Confirm no discovery run is active before editing/running (tsx-watch caution)

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass
- Nodes carry all required attributes via reused Spec 0 primitives (no re-derived identity/tier/conflict logic)
- Structural + relationship-row typed edges emit with correct `edgeKind` + direction; name-keyed rows resolve to survivor and orphans are dropped
- `*_points` never become nodes or edges
- Module is pure (no I/O, no writes, no LLM)

### Discovery Service — Computation

#### Task Group 2: Surface-Only Blast-Radius + Aggregation Computation
**Dependencies:** Task Group 1

- [x] 2.0 Compute the surface-only blast-radius (with edge provenance + would-be-orphan advisory) and the aggregation dimensions (pure)
  - [x] 2.1 Write 2-8 focused jest tests for blast-radius + aggregation
    - Place under `discovery-service/src/services/reviewModel/` (e.g. `reviewModel.blastRadius.test.ts`, `reviewModel.aggregation.test.ts`)
    - Test ONLY critical behaviours: (a) downward transitive closure over a multi-hop chain (e.g. service → interface → endpoint → logical entity → attribute) returns the correct dependent set; (b) each dependent records WHICH edge pulled it in (the `edgeKind` + immediate predecessor); (c) a relationship cycle TERMINATES (visited-set), no infinite loop; (d) would-be-orphan advisory fires ONLY when ALL of a parent's children are in the reject set, and the parent is NEVER added to the hard downward radius; (e) status is NEVER mutated; (f) aggregation counts across the seven dimensions match a hand-computed fixture and the live-conflict count matches the grid's `getUnresolvedConflicts` semantics
  - [x] 2.2 Compute the surface-only blast-radius per candidate
    - For each candidate, compute the transitive set of DEPENDENT candidate ids a reject/defer WOULD affect = downward transitive closure following edge direction
    - Spec 1 NEVER mutates status — this is a hypothetical "would affect" set only
    - Record edge provenance per dependent: the `edgeKind` + the immediate predecessor node that reached it, in the shape Spec 2's preview→confirm will render
    - Cycle-safe via a visited-set so a relationship cycle cannot loop forever
  - [x] 2.3 Compute the would-be-orphan advisory (child→parent, advisory-only)
    - Flag a parent as "would-be-orphaned" when ALL of its children are rejected (or in the candidate's reject set)
    - NEVER force a roll-up and NEVER add the parent to the hard downward radius — advisory metadata only
  - [x] 2.4 Compute the aggregation dimensions over the unified candidate + finding set
    - Counts by: candidate type, review status, source/tier, conflict state (live-conflict vs clean), merge group, scan-kind (code/DB), and finding severity (and finding review status)
    - The "live conflict" predicate MUST match the grid's `getUnresolvedConflicts` (a `data._conflicts[attr]` entry with NO matching `data._conflictResolutions[attr]`) so grid and backbone agree EXACTLY
    - Per-node: degree (in/out edge counts) and blast-radius size
    - Include an `operation` (create/enrich/link) rollup as a cheap extra IF it falls out for free — it is NOT load-bearing
    - Pure — no I/O, no writes
  - [x] 2.5 Ensure blast-radius + aggregation tests pass
    - Run ONLY the 2-8 tests written in 2.1: `npx jest src/services/reviewModel`
    - Do NOT run the entire discovery-service suite at this stage
    - Confirm no discovery run is active before editing/running (tsx-watch caution)

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass
- Downward transitive closure is correct and cycle-safe; each dependent records its pulling edge (edgeKind + predecessor)
- Would-be-orphan fires only when ALL children are rejected; parent never enters the hard radius; status never mutated
- All seven aggregation dimensions + per-node degree/blast-radius size are correct; live-conflict count matches `getUnresolvedConflicts`
- Computation is pure

#### Task Group 3: Scan-Selection Union + Cross-Scan Edges + Findings Bridge
**Dependencies:** Task Groups 1-2

- [x] 3.0 Union candidates + findings across the scan selection, compute cross-scan logical↔physical edges, and bridge findings to candidates
  - [x] 3.1 Write 2-8 focused jest tests for union + cross-scan + findings bridge
    - Place under `discovery-service/src/services/reviewModel/` (e.g. `reviewModel.scanSelection.test.ts`)
    - Test ONLY critical behaviours: (a) candidates + findings unioned across one code-kind run + one DB-kind run, node ids stay globally unique (AMS candidate ids); (b) with both runs present, a `logical_data_entity_physical_data_entities` cross-scan edge links the code-scan logical entity ↔ the DB-scan physical entity (non-1:1 honored, never assume 1:1); (c) with ONLY one run, NO cross-scan edge is produced and the full single-run model still computes; (d) findings bridge to candidates via `DiscoveryFindingDto.links[]` where `target_type === 'discovery_candidate'` → `target_id`, carrying Spec F `review_status`
  - [x] 3.2 Implement the scan-selection union
    - Union candidates + findings across at most TWO runs: ≤1 `code`-kind run + ≤1 `database`-kind run
    - Node ids stay globally unique (AMS candidate ids)
    - Degrade cleanly to a SINGLE run (the only run-kind present): all single-run behaviour (nodes, intra-scan edges, blast-radius, aggregations) works with one run id and no cross-scan edges
  - [x] 3.3 Compute cross-scan logical↔physical edges (both runs present only)
    - When BOTH a code run and a DB run are selected, resolve `logical_data_entity_physical_data_entities` (and `logical_data_attribute_physical_data_attributes`) edges spanning the code-scan logical entity ↔ the DB-scan physical entity
    - Honor the meta-model's EXPLICIT non-1:1 mapping (never assume 1:1) per `gateway/src/config/prompts/shared/architecture-context-explainer.md`
    - When only one run is present, produce NO cross-scan edge
  - [x] 3.4 Bridge findings → candidates
    - Union each finding into the model carrying its review status (Spec F vocabulary), severity, and category
    - Resolve its candidate link(s) via `DiscoveryFindingDto.links[]` where `target_type === 'discovery_candidate'` → `target_id`
  - [x] 3.5 Ensure scan-selection tests pass
    - Run ONLY the 2-8 tests written in 3.1: `npx jest src/services/reviewModel`
    - Do NOT run the entire discovery-service suite at this stage
    - Confirm no discovery run is active before editing/running (tsx-watch caution)

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass
- Candidates + findings union across the selection with globally-unique node ids; single-run degrades cleanly with no cross-scan edges
- Cross-scan logical↔physical edges computed only when both runs present, non-1:1 honored
- Findings bridge to candidates via `links[]` and carry Spec F review status

### Discovery Service — Read Endpoint

#### Task Group 4: Read Endpoint + AMS Fetch Wiring
**Dependencies:** Task Groups 1-3

- [x] 4.0 Add a NEW run-scoped read endpoint that fetches candidates + findings from AMS and returns the computed model (READ-ONLY)
  - [x] 4.1 Write 2-8 focused jest tests for the endpoint
    - Place under `discovery-service/src/__tests__/` (or alongside the runs router test fixtures), mocking `archModelClient`
    - Test ONLY critical behaviours: (a) endpoint returns the computed model for a single run id; (b) endpoint returns the model for two run ids (one code + one DB) including cross-scan edges; (c) an invalid selection (two same-kind runs, or >2 runs) is REJECTED with a clear error (not silently picking one); (d) the endpoint writes NOTHING back to AMS (no `review_status` / `conflictResolutions` writes) — assert no write-path client method is invoked
    - tree-sitter caution: importing the runs router may transitively pull parser modules; if a combined run flakes on parse suites, re-run the parse-touching suite in ISOLATION
  - [x] 4.2 Add the read endpoint to the runs router
    - Mount on the existing runs router (`discovery-service/src/routes/runs.ts`, `mergeParams: true`, under `/discovery/projects/:projectId/architectures/:architectureId/runs`) as a sibling of the existing run-scoped routes
    - Accept the scan selection: the path `:runId` as the primary run plus an OPTIONAL second run id via query param (the up-to-two-run selection)
    - Reject invalid selections (two same-kind runs, >2 runs) with a clear error
  - [x] 4.3 Wire the AMS fetch + model assembly
    - Fetch candidates via `archModelClient.getCandidatesByRun(projectId, runId, ...)` and findings via `archModelClient.listDiscoveryFindings(...)` for each selected run
    - Classify each run's kind via the run row's `discovery_kind` (`getDiscoveryRun` exposes it; `code` XOR `database`)
    - Assemble the model via the Groups 1-3 module (nodes, edges, cross-scan edges, findings bridge, blast-radius, aggregations) and return it
    - AMS is UNCHANGED (no schema change, no new AMS endpoint); the endpoint is READ-ONLY (never writes `review_status` / `conflictResolutions`)
    - snake_case on the wire
  - [x] 4.4 Ensure endpoint tests pass
    - Run ONLY the 2-8 tests written in 4.1
    - Do NOT run the entire discovery-service suite at this stage
    - Confirm no discovery run is active before editing/running (tsx-watch caution); apply the tree-sitter isolation caution if a combined run flakes on parse suites

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass
- Endpoint returns the model for 1 and 2 run ids (cross-scan edges when both present) and rejects invalid selections with a clear error
- Endpoint fetches via `archModelClient` and is strictly READ-ONLY (no AMS schema change, no write-back)
- snake_case wire format

### Gateway — Proxy

#### Task Group 5: Gateway Proxy Route
**Dependencies:** Task Group 4 (the endpoint contract)

- [x] 5.0 Add a pure proxy route forwarding to the discovery-service model endpoint
  - [x] 5.1 Write 2-8 focused jest tests for the proxy
    - Place under `gateway/src/__tests__/` (mirror an existing discovery-proxy test, e.g. `discovery-read-routes.test.ts` / `discovery-findings-proxy.test.ts`)
    - Test ONLY critical behaviours: (a) the proxy forwards to the discovery-service `/discovery/...` model URL and passes through status + JSON body VERBATIM (single run); (b) it forwards the optional second-run-id query param; (c) it returns 503 on a downstream network error
  - [x] 5.2 Add the proxy route in `gateway/src/routes/discovery.ts`
    - Forward to discovery-service `/discovery/...` (NOT AMS — discovery-service computes the model)
    - Follow the existing pure-proxy idiom exactly: `res.status(response.status).json(responseBody)` to forward status + body verbatim, `res.status(503).json({ error: { code: 503, ... } })` on network error, with structured logging
    - snake_case on the wire; forward the scan selection (primary run id path + optional second run id query param)
  - [x] 5.3 Ensure proxy tests pass
    - Run ONLY the 2-8 tests written in 5.1: `npx jest src/__tests__/<new-proxy-test>`
    - Do NOT run the entire gateway suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 5.1 pass
- Proxy forwards to discovery-service (not AMS), passes status + body verbatim, returns 503 on downstream failure
- Scan selection (primary + optional second run id) forwarded; snake_case wire

### Frontend — API Client & Grid Re-point

#### Task Group 6: Frontend API Client + Grid `useMemo` Re-point (Single-Run)
**Dependencies:** Task Group 1 (model shape) + Task Group 5 (route)

- [x] 6.0 Add the snake_case API client function and re-point the grid's existing aggregation/count `useMemo`s onto the backbone (single-run)
  - [x] 6.1 Write 2-8 focused vitest tests for the re-pointed grid reads
    - Place alongside the grid (e.g. `frontend/src/components/DashboardView/DiscoveryCandidateTable.backbone.test.tsx`)
    - Test ONLY critical behaviours: (a) the migrated count memos (`committedCount`/`actionableCount`) read backbone counts and produce IDENTICAL values/gating to today; (b) the conflict counts (`unresolvedConflictCount`/`filteredUnresolvedConflictCount`) match the grid's existing `getUnresolvedConflicts` semantics on the same fixture; (c) `uniqueTierLabels` produces the SAME labels as today; (d) per-row review actions / conflict-resolution modal / optimistic state remain on the existing write paths (unaffected)
  - [x] 6.2 Add the snake_case frontend API client function
    - In `frontend/src/api/discoveryApi.ts` (or a sibling), following the existing `fetch('/api/v1/discovery/...')` idiom the grid already uses (mirror `getDiscoveryCandidates`)
    - Pass a SINGLE `runId` (the grid is single-run; the API can span two — the client passes one)
    - snake_case wire
  - [x] 6.3 Re-point the grid's aggregation/count `useMemo`s onto the backbone
    - In `frontend/src/components/DashboardView/DiscoveryCandidateTable.tsx`, migrate: `committedCount` / `actionableCount` (and filtered counts), `unresolvedConflictCount` / `filteredUnresolvedConflictCount` (the `getUnresolvedConflicts`/`hasUnresolvedConflicts`-driven counts), and the tier rollup `uniqueTierLabels` (and `getDisplayTierLabel`/`getBaseTierLabel`/`getAddedBy` reads) to read backbone counts
    - Keep display semantics IDENTICAL — same labels, same gating booleans (the "Approve All" / filtered-approve / reject disable+title logic must be byte-for-byte equivalent)
    - Grid stays SINGLE-run with NO blast-radius/cascade UI (that is Spec 2)
    - Leave per-row review actions, the conflict-resolution modal, and optimistic state on the EXISTING write paths untouched
  - [x] 6.4 Ensure grid tests pass
    - Run ONLY the new tests from 6.1 PLUS the existing companion grid suites to confirm they stay green: `npx vitest run src/components/DashboardView/DiscoveryCandidateTable.conflicts.test.tsx src/components/DashboardView/__tests__/discoveryCandidateTableCommitted.test.tsx src/components/DashboardView/__tests__/discoveryCandidateTableOperation.test.tsx src/components/DashboardView/__tests__/discoveryCandidateTableRuntime.test.tsx src/components/DashboardView/__tests__/discoveryRunDetailBelowGateCount.test.tsx <new backbone test>`
    - Do NOT run the entire frontend suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 6.1 pass AND the existing companion grid suites stay green
- Migrated memos read backbone counts and produce IDENTICAL labels + gating booleans to today
- Grid stays single-run with no blast-radius/cascade UI; per-row actions + conflict modal + optimistic state untouched

### Testing

#### Task Group 7: Cross-Stack Verification & Gap Analysis
**Dependencies:** Task Groups 1-6

- [x] 7.0 Review existing tests and fill critical gaps only (cross-stack)
  - [x] 7.1 Review tests from Task Groups 1-6
    - Review the 2-8 tests from Group 1 (node-set + edges), Group 2 (blast-radius + aggregation), Group 3 (scan-selection + cross-scan + findings), Group 4 (endpoint), Group 5 (gateway proxy), Group 6 (grid re-point)
    - Total existing tests: approximately 12-48 tests
  - [x] 7.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end scenarios that lack coverage: e.g. model-correctness "reject a logical entity reaches its attributes + logical↔physical mappings + endpoints referencing it via `endpoint_data_effects`" (meta-model conformance); grid-reads-backbone end-to-end
    - Focus ONLY on gaps for this spec's requirements; do NOT assess application-wide coverage
    - Prioritize end-to-end model correctness + the grid-reads-backbone path over unit gaps
  - [x] 7.3 Write up to 10 additional strategic tests maximum
    - Add a MAXIMUM of 10 new tests to fill identified critical gaps (e.g. the "reject a logical entity" meta-model traversal scenario; a 2-run end-to-end endpoint→model scenario)
    - Skip edge cases, performance, and accessibility tests unless business-critical
  - [x] 7.4 Run feature-specific tests only (per stack)
    - discovery-service: `npx jest src/services/reviewModel src/__tests__/<endpoint test>` (apply tree-sitter ISOLATION re-run if a combined run flakes on parse-touching suites)
    - gateway: `npx jest src/__tests__/<new-proxy-test>`
    - frontend: `npx vitest run` the Group 6 files (new + companion grid suites)
    - Expected total: approximately 22-58 tests maximum
    - Do NOT run the entire application test suite for any stack
    - Confirm no discovery run is active before running discovery-service tests (tsx-watch caution)

**Acceptance Criteria:**
- All feature-specific tests pass across discovery-service (jest), gateway (jest), and frontend (vitest)
- The meta-model traversal scenario (rejecting a logical entity reaches attributes + logical↔physical mappings + endpoints) and the grid-reads-backbone path are covered
- No more than 10 additional tests added; testing focused exclusively on this spec's requirements
- Model remains READ-ONLY and never persisted (no AMS schema change) — confirmed by the no-write-back assertions

## Execution Order

Recommended implementation sequence (respecting dependencies):
1. Review-Model Types + Pure Node-Set + Typed-Edge Builder (Task Group 1)
2. Surface-Only Blast-Radius + Aggregation Computation (Task Group 2)
3. Scan-Selection Union + Cross-Scan Edges + Findings Bridge (Task Group 3)
4. Read Endpoint + AMS Fetch Wiring (Task Group 4)
5. Gateway Proxy Route (Task Group 5)
6. Frontend API Client + Grid `useMemo` Re-point (Task Group 6)
7. Cross-Stack Verification & Gap Analysis (Task Group 7)
