# Specification: Deterministic Review Model + Cascade/Dependency Graph + Aggregation Backbone

## Goal
Build the deterministic (no-LLM) review-model + typed cascade/dependency graph + aggregation backbone for a discovery scan selection, computed live on read in `discovery-service` and exposed via a new read endpoint, so both the candidate grid AND the future conversational Architect persona (Spec 3) consume one shared source of truth for counts, groupings, dependency edges, and reject/defer blast-radius. Spec 1 is read-only model+graph only; it never mutates status and never executes actions.

## User Stories
- As a reviewer facing large candidate + finding lists after a code and/or DB scan, I want a single precomputed view of what is there (counts by type, status, source, conflict state, scan-kind, severity) so the grid header and (later) the conversation agenda read identical numbers instead of each re-deriving them.
- As a reviewer about to reject a logical data entity or service, I want to see the transitive set of dependent candidates a reject/defer WOULD affect (with which edge pulled each one in) so I understand the blast radius before any future bulk action commits it.
- As a developer building Spec 2 (cascade-aware bulk apply) and Spec 3 (Architect conversation), I want the blast-radius and aggregation output shaped exactly as those specs consume so no rework or recompute is needed downstream.

## Specific Requirements

**Deterministic review-model module (new, in `discovery-service`)**
- New pure TypeScript module(s) under `discovery-service/src/services/` (e.g. `reviewModel/`); no LLM, no persistence, no side effects on the candidate/finding rows.
- Input: a scan selection (1-2 run ids) plus the fetched candidates + findings; output: a single in-memory model object (nodes, edges, blast-radius, aggregations) suitable for serialization on the read endpoint.
- Each candidate node carries: review status (Spec F vocabulary), `committed` flag, Spec 0 conflict flags from `data._conflicts` and resolutions from `data._conflictResolutions`, provenance (`_addedBy`/`_mergedFrom`), merge-group membership, `operation` (create/enrich/link), candidate type, source tier, and originating scan-kind (code/DB).
- Each finding is unioned into the model with its review status, severity, category, and its candidate link(s) (`DiscoveryFindingDto.links[]` where `target_type === 'discovery_candidate'` → `target_id`).
- Reuse Spec 0 primitives directly: `candidateIdentity.ts` (`buildIdentityKey`, `classifySourceTier`/`SOURCE_TIER_RANK`, `readAddedBy`), `candidateMerge.ts` (conflict/provenance/merge-group model), `candidateReconcile.ts` (the name→survivor resolution rule); do NOT re-derive identity or tier logic.
- Compute live on every read; the model is throwaway and is NEVER written back to AMS or cached as a graph.

**Scan selection input (up to two run ids)**
- Accept a scan selection of at most two run ids: ≤1 `code`-kind run + ≤1 `database`-kind run. Run kind is read from the run row's `discovery_kind` (each run is `code` XOR `database`; `combined` is never produced — see `discovery-service/src/routes/runs.ts`).
- Union candidates + findings across both selected runs into one model; node ids stay globally unique (AMS candidate ids).
- Degrade cleanly to a single run (the only run-kind present): all single-run behaviour must work with one run id and no cross-scan edges.
- Reject an invalid selection (two same-kind runs, >2 runs) with a clear error rather than silently picking one.

**Typed cascade/dependency graph (full v1 edge set)**
- Build a directed graph over candidate nodes with the FULL v1 edge set; every edge carries an `edgeKind` discriminator + a direction (e.g. parent→child).
- Structural edges: `parentCandidateId` (parent→child).
- Relationship-row edges, one `edgeKind` per type: `interface_logical_entities`, `endpoint_data_effects`, `logical_data_entity_physical_data_entities`, `logical_data_attribute_physical_data_attributes`, `logical_data_entity_relationships`, `data_movements`.
- Relationship rows that name their endpoints (rather than referencing a candidate id) resolve BY NAME → survivor via `buildIdentityKey`, mirroring `candidateReconcile.ts` (`ENTITY_NAME_FIELDS = ['logicalEntityName','dataEntityName']` read from `data`, mapped through the same identity-key helper). A relationship row whose endpoint resolves to no surviving candidate is dropped (orphan), matching reconcile.
- The polymorphic `*_points` wrappers (`application_points`, `data_entity_points`, `business_points`, `app_business_points`) are backend auto-managed and NEVER become nodes or edges.
- Cross-scan edges: when both a code run and a DB run are selected, resolve `logical_data_entity_physical_data_entities` (and `logical_data_attribute_physical_data_attributes`) edges spanning the code-scan logical entity ↔ the DB-scan physical entity; honor the meta-model's explicit non-1:1 mapping (never assume 1:1).

**Surface-only blast-radius (with edge provenance + would-be-orphan advisory)**
- Per candidate, compute the transitive set of dependent candidate ids that a reject/defer WOULD affect (downward transitive closure following edge direction); Spec 1 NEVER mutates status.
- Each dependent in the radius records WHICH edge pulled it in (edge provenance: the `edgeKind` + the immediate predecessor that reached it), in the shape Spec 2's preview→confirm will render.
- Child→parent is advisory-only: flag a parent as "would-be-orphaned" when ALL of its children are rejected (or in the candidate's reject set); never force a roll-up and never add the parent to the hard downward radius.
- Handle cycles safely (visited-set) so a relationship cycle cannot loop forever.
- Investigated for reuse and REJECTED: `discovery-service/src/services/transitiveDependencyWalker.ts` is a Maven/npm library-dependency BFS with I/O + find-or-create writes + scope/depth-cap rules tied to manifests — a different domain; do not force-fit. `discovery-service/src/types/relationship.ts` is Layer-1b evidence-atom relationships (imports/calls), also a different layer. Build a fresh pure closure over the candidate graph. (See Existing Code to Leverage.)

**Aggregation dimensions**
- Compute once over the unified candidate + finding set: counts by candidate type, review status, source/tier, conflict state (live-conflict vs clean), merge group, and scan-kind (code/DB); plus finding counts by severity (and review status).
- Per-node: degree (in/out edge counts) and blast-radius size.
- Include an `operation` (create/enrich/link) rollup as a cheap extra if it falls out for free; it is NOT load-bearing.
- "Live conflict" = a `data._conflicts[attr]` entry with no matching `data._conflictResolutions[attr]`, identical to the grid's `getUnresolvedConflicts` predicate (so grid and backbone agree exactly).

**New read endpoint + gateway proxy + frontend client**
- New discovery-service read endpoint, run-scoped, mounted as a sibling of the existing runs routes (`discovery-service/src/routes/runs.ts`, under `/discovery/projects/:projectId/architectures/:architectureId/runs`); it accepts the scan selection (the path `:runId` as the primary run plus an optional second run id via query param) and returns the computed model.
- The endpoint fetches candidates + findings from AMS via `discovery-service/src/services/archModelClient.ts` (`getCandidatesByRun`, `listDiscoveryFindings`) for each selected run; AMS is unchanged (no schema change, no new AMS endpoint).
- Gateway adds a pure proxy route in `gateway/src/routes/discovery.ts` following the existing forward-the-status-and-body idiom (forward to discovery-service `/discovery/...`, 503 on network error); snake_case on the wire.
- New frontend snake_case API client function (in `frontend/src/api/discoveryApi.ts` or a sibling) following the existing `fetch('/api/v1/discovery/...')` idiom that the grid calls.

**Grid re-pointing (single-run consumption, THIS spec)**
- Re-point the existing aggregation/count `useMemo`s in `frontend/src/components/DashboardView/DiscoveryCandidateTable.tsx` onto the deterministic backbone, consumed single-run (the grid passes its one `runId`; the API can span two).
- Specifically migrate: candidate counts (`committedCount`, `actionableCount`, filtered counts), conflict counts (`getUnresolvedConflicts`/`hasUnresolvedConflicts`, `unresolvedConflictCount`, `filteredUnresolvedConflictCount`), and tier rollups/unique-values (`getDisplayTierLabel`/`getBaseTierLabel`/`getAddedBy`, `uniqueTierLabels`).
- Keep the display semantics IDENTICAL (same labels, same gating booleans); the grid stays single-run with NO blast-radius/cascade UI (that is Spec 2). Per-row review actions, conflict-resolution modal, and optimistic state remain on the existing write paths untouched.

**Read-only + recompute semantics**
- The model is fully recomputed on read and never persisted. Candidate `review_status`, finding `review_status`, and Spec 0's `data._conflictResolutions` remain user state owned by the EXISTING write paths; Spec 1 reads them and writes none of them.
- No graph table, no cache, no AMS schema/Liquibase change.

**Meta-model conformance**
- Logical and physical are DISTINCT layers with EXPLICIT non-1:1 mappings (never default to 1:1) per `gateway/src/config/prompts/shared/architecture-context-explainer.md`; `classes`/`methods` are first-class entity types (but discovery does not mint them — call-chain hops live in `endpoint_data_effects.path_metadata_json` as evidence, not nodes).
- Rejecting a logical entity must correctly reach (via edges) its attributes, its logical↔physical mappings, and the endpoints referencing it via `endpoint_data_effects`.
- `*_points` polymorphic wrappers are backend-managed and are excluded from nodes and edges everywhere in the graph.

## Existing Code to Leverage

**Spec 0 identity/merge/reconcile primitives — `discovery-service/src/services/candidateIdentity.ts`, `candidateMerge.ts`, `candidateReconcile.ts`**
- `buildIdentityKey`, `classifySourceTier`/`SOURCE_TIER_RANK`, `readAddedBy` give per-type identity, source tier, and provenance — reuse directly for node tier + name→survivor edge resolution + source-tier aggregation.
- `candidateReconcile.ts` is the proof of the name-resolution rule (`ENTITY_NAME_FIELDS`, `ldeIdentityKeyForName`, drop-orphan-row behaviour) the cascade graph's relationship edges must mirror.
- `candidateMerge.ts` owns the `data._conflicts`/`_conflictResolutions`/`_addedBy`/`_mergedFrom`/merge-group shape the model reads (typed by `CandidateMergeData` in `discovery-service/src/types/candidate.ts`).

**AMS data source — `discovery-service/src/services/archModelClient.ts`**
- `getCandidatesByRun(projectId, runId, ...)` and `listDiscoveryFindings(...)` (returns `DiscoveryFindingSearchResponse`) are the run-scoped fetches the new endpoint calls per selected run; the model unions their results. `getDiscoveryRun` exposes `discovery_kind` for run-kind classification.

**Gateway pure-proxy idiom — `gateway/src/routes/discovery.ts`**
- Existing GET proxies (e.g. list-candidates, summary) show the exact pattern to copy: forward to the downstream URL, pass through status + JSON body verbatim, 503 on network error, structured logging. The new proxy forwards to discovery-service `/discovery/...` (not AMS) since discovery-service computes the model.

**Frontend grid + client idiom — `frontend/src/components/DashboardView/DiscoveryCandidateTable.tsx`, `frontend/src/api/discoveryApi.ts`, `frontend/src/api/findingsApi.ts`**
- The grid's aggregation memos and conflict/tier helpers (`getAddedBy`, `getUnresolvedConflicts`, `getDisplayTierLabel`, count memos) are the exact reads to migrate onto the backbone (keep labels identical). `discoveryApi.ts`/`findingsApi.ts` show the snake_case `fetch('/api/v1/discovery/...')` client idiom + finding vocabulary (`pending_review`/`approved`/`rejected`/`deferred`).

**Relationship-row taxonomy + run-kind — `discovery-service/src/types/candidate.ts`, `discovery-service/src/routes/runs.ts`**
- `candidate.ts` enumerates all six relationship-row kinds and their endpoint-field shapes (e.g. `data_movements` REUSES the existing relationship type, not a new one) — the `edgeKind` source of truth. `runs.ts` confirms `discovery_kind` is `code` XOR `database` (so "one code + one DB" = two runs = the up-to-two-run-id selection).

## Test Plan

- **Model computation (unit):** given a fixture candidate+finding set, the model exposes correct node attributes (review status, `committed`, conflict flags from `data._conflicts`/`_conflictResolutions`, `_addedBy`/`_mergedFrom`, merge group, source tier via `classifySourceTier`, scan-kind); findings unioned with their `discovery_candidate` links; no LLM, no writes.
- **Graph edge resolution (unit):** structural `parentCandidateId` edges and all six relationship-row `edgeKind`s are emitted with correct direction; name-keyed relationship rows resolve to the survivor via `buildIdentityKey` (mirroring `candidateReconcile.ts`), and rows resolving to no survivor are dropped; assert `*_points` rows never produce nodes/edges.
- **Cross-scan logical↔physical (unit):** with a code run + a DB run selected, a `logical_data_entity_physical_data_entities` edge links the code-scan logical entity to the DB-scan physical entity (non-1:1 honored); with only one run, no cross-scan edge is produced.
- **Blast-radius (unit):** downward transitive closure is correct over multi-hop chains (e.g. service → interface → endpoint → logical entity → attribute); each dependent records the `edgeKind` + predecessor that pulled it in; cycles terminate; would-be-orphan advisory fires only when ALL of a parent's children are in the reject set and the parent is never added to the hard downward radius; assert status is never mutated.
- **Aggregation (unit):** counts by type, review status, source/tier, conflict state, merge group, scan-kind, and finding severity match hand-computed fixtures; per-node degree + blast-radius size correct; `operation` rollup present when free. Live-conflict count matches the grid's `getUnresolvedConflicts` semantics on the same fixture.
- **Single-run degradation (unit):** the full model (nodes, intra-scan edges, blast-radius, aggregations) computes correctly from a single run id with cross-scan edges absent.
- **Endpoint + gateway proxy (integration):** discovery-service endpoint returns the computed model for 1 and 2 run ids and rejects invalid selections; the gateway proxy forwards status + body verbatim and returns 503 on downstream failure, following the existing discovery-proxy test pattern (`gateway/src/__tests__/`).
- **Grid re-point (frontend):** the migrated `useMemo`s read backbone counts (committed/actionable/conflict/tier) and produce identical labels/gating to today; existing grid tests (`DiscoveryCandidateTable.conflicts.test.tsx`, `__tests__/discoveryCandidateTableCommitted.test.tsx`, `…Operation`, `…Runtime`, `discoveryRunDetailBelowGateCount.test.tsx`) stay green; per-row review actions and the conflict modal are unaffected.

## Out of Scope
- Bulk-action EXECUTION, the cascade preview→confirm UI, and reject-suppresses-downstream-IR — all Spec 2.
- The conversational Architect review persona, bulk-resolve-by-pattern, and ANY LLM use — all Spec 3 (Specs 0-2 are fully deterministic).
- A multi-run grid UI; the grid stays single-run even though the API can span two run ids.
- Any blast-radius or cascade UI in this spec (no preview, no confirm, no radius rendering in the grid).
- Any persisted or cached graph; any graph table; any AMS schema / Liquibase change.
- Any WRITE to candidate `review_status`, finding `review_status`, or `data._conflictResolutions` (Spec 1 is read-only on all user state; existing write paths remain the owners).
- Force-fitting the target-state captured-decisions cascade (`frontend/src/components/targetState/architectConversation/CascadeSummaryControls.tsx`, `frontend/src/api/epicCapturedDecisionsApi.ts`) — confirmed a different (decision) domain; not reused.
- Editing `discovery-service/src/**` while a discovery run is active (implementer note: tsx watch reloads kill in-flight runs).
