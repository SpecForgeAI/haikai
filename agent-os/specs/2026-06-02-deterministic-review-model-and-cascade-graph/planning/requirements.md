# Spec Requirements: Deterministic Review Model + Cascade/Dependency Graph + Aggregation Backbone

## Initial Description

Spec 1 of the discovery-review-unification program (sequenced F -> 0 -> 1 -> 2 -> 3).
Specs F (normalize findings review actions to Approve/Reject/Defer) and 0 (universal
identity-keyed cross-source candidate MERGE + conflict/provenance data model in candidate
`data`) are BUILT + verified. Spec 1 is next.

**Problem.** After a discovery scan, a user faces huge lists of candidates + findings (code
scan AND DB scan). Even after Spec 0 collapses duplicates, the user has no deterministic,
precomputed view of *what's there* and *what depends on what*. There is no single backbone
that answers "how many endpoints are pending review under this interface?", "if I reject this
logical data entity, what cascades?", or "what's the blast radius of rejecting this service?".
Both the existing candidate grid AND the future conversational "Architect" review persona
(Spec 3) need to consume the SAME deterministic model -- counts, groupings, dependency edges,
and cascade blast-radius -- rather than each recomputing ad hoc.

**This spec builds the deterministic backbone (NO LLM):**
1. A **deterministic review model** for a chosen scan selection -- the unified set of
   candidates + findings across one code scan and/or one DB scan (max one of each), with their
   shared Approve/Reject/Defer review status (Spec F vocabulary, applied to BOTH candidates and
   findings), Spec 0 conflict flags (`data._conflicts`), provenance (`_addedBy`/`_mergedFrom`),
   and merge-group membership.
2. **Precomputed aggregation / counts** -- by type, review status, source/tier, conflict state,
   merge group; rolled up so the grid header and the conversation agenda can both read them
   without re-deriving.
3. A **cascade / dependency graph** over candidates -- parent->child structural edges AND
   relationship-row edges. For any candidate, compute the **blast radius**: the transitive set
   of dependents that a reject/defer would affect. This is the precomputed input that Spec 2's
   cascade-aware bulk accept/reject/save (preview->confirm) and Spec 3's conversation consume.

Spec 1 is the MODEL + GRAPH only. It does NOT execute bulk actions (Spec 2) and does NOT add
the conversational persona (Spec 3). It exposes the cascade blast-radius in the shape Spec 2's
preview->confirm will render.

## Requirements Discussion

The clarifying-question round was conducted and the user accepted every recommendation. The
questions and the (recommendation-accepted) answers are recorded below; the full enumerated
decisions are restated in the "Resolved Decisions" section at the end of this document.

### First Round Questions

**Q1 (Where + how is the model/graph computed and exposed -- gateway vs AMS vs
discovery-service; live-computed vs persisted/cached?):**
**Answer:** A NEW deterministic TypeScript module in `discovery-service` plus a NEW read
endpoint, **live-computed on read, NOT persisted** (no graph table, no AMS schema change). The
endpoint FETCHES candidates + findings from AMS (discovery-service already owns the AMS client,
`discovery-service/src/services/archModelClient.ts`), then computes the model in memory. The
gateway proxies the new endpoint using its existing pure-proxy pattern
(`gateway/src/routes/discovery.ts`). The module reuses the Spec 0 identity/merge primitives.

**Q2 (How does scan selection feed the model -- single run, or the unified one-code + one-DB
framing?):**
**Answer:** The model/API accepts a **scan selection of up to two run ids** (at most one
`code`-kind run + at most one `database`-kind run), unions candidates + findings across both,
and computes cross-scan edges (logical <-> physical) when both are present. It **degrades
cleanly to a single run** (the only run-kind present). The logical <-> physical layer is the DB
schema-migration source per the product North Star, so spanning both scans is a first-class
capability of the API even though the grid in this spec consumes it single-run.

**Q3 (Exact edge taxonomy -- structural only, or the full relationship-row set too?):**
**Answer:** The FULL edge set in v1: structural `parentCandidateId` edges AND every
relationship-row edge (`interface_logical_entities`, `endpoint_data_effects`,
`logical_data_entity_physical_data_entities`,
`logical_data_attribute_physical_data_attributes`, `logical_data_entity_relationships`,
`data_movements`). Edges are modeled as **typed edges** carrying an `edgeKind` discriminator
plus a direction. Relationship rows that name their endpoints (rather than referencing a
candidate id) are resolved name -> survivor via Spec 0's `buildIdentityKey`. The polymorphic
`*_points` wrappers are backend auto-managed and NEVER become nodes or edges.

**Q4 (Blast-radius semantics -- does a reject cascade HARD to children, or just surface them
for confirmation?):**
**Answer:** **Surface-only** in Spec 1. For each candidate, compute the **transitive set of
dependent candidate ids that a reject/defer WOULD affect**; Spec 1 **never mutates** any
status. The closure is the downward transitive closure (reject a parent => its children /
dependents are in the radius). The child -> parent direction is **advisory-only**: flag a
parent as "would-be-orphaned" when all of its children are rejected, but never force a roll-up.
Each dependent in the radius records **which edge pulled it in** (edge provenance), in the shape
Spec 2's preview -> confirm will render. The hard cascade + reject-suppresses-downstream-IR
behaviour is Spec 2.

**Q5 (How does the grid begin consuming this in Spec 1 vs. Spec 2/3?):**
**Answer:** Ship the model + graph + aggregation API + tests, AND **re-point the grid's
existing count/aggregation reads** onto the deterministic backbone. Specifically the
`useMemo` aggregation blocks in `DiscoveryCandidateTable.tsx` -- counts, conflict counts,
tier roll-ups -- begin reading the new backbone (single-run consumption). Add **NO**
blast-radius / cascade UI (that is Spec 2). Keep the grid **single-run**: it passes its one
`runId`, even though the API can span two run ids.

**Q6 (Recompute vs store -- is any of the model persisted, and who owns the underlying user
state?):**
**Answer:** The model is **fully recomputed on read, never persisted**. Candidate
`review_status`, finding `review_status`, and Spec 0's `data._conflictResolutions` remain
USER STATE, written exclusively through the EXISTING write paths. **Spec 1 is read-only on all
of it** -- it reads candidates, findings, and resolution state to compute the model and never
writes any of them.

**Q7 (Which aggregation dimensions does the model precompute?):**
**Answer:** Counts by **type, review status, source/tier, conflict state, merge group,
scan-kind (code/DB), and finding severity** -- computed once over the unified candidate +
finding set -- plus per-node degree and blast-radius size. `operation` (create / enrich /
link) is included as a cheap extra roll-up if it falls out for free, but it is not
load-bearing.

### Existing Code to Reference

The user confirmed the program's prior research; the following are the concrete reuse anchors
(verified against the code during this research pass). The spec writer should reference these;
detailed exploration is the spec writer's job.

**Similar Features / Reuse Anchors Identified:**

- **Spec 0 identity + merge primitives (reuse directly):**
  - Feature: per-type candidate identity keys + source-precedence -- Path:
    `discovery-service/src/services/candidateIdentity.ts` (exports `buildIdentityKey`,
    `classifySourceTier` / `SOURCE_TIER_RANK`, and a name-keyed key helper used by reconcile;
    the merge's "read addedBy" provenance reader is in this primitive layer). Pure, no I/O.
  - Feature: cross-source merge engine + conflict/provenance model -- Path:
    `discovery-service/src/services/candidateMerge.ts` (owns `data._conflicts`,
    `_conflictResolutions`, `_addedBy`/`_mergedFrom`, merge-group membership).
  - Feature: post-merge reconcile (structural + name-resolved edges) -- Path:
    `discovery-service/src/services/candidateReconcile.ts`. **This file is the proof of the
    name-resolution rule**: relationship rows resolve their endpoints BY NAME
    (`ENTITY_NAME_FIELDS = ['logicalEntityName', 'dataEntityName']` read from `data`), mapped
    to a survivor via a `buildIdentityKey`-mirroring helper (`ldeIdentityKeyForName`,
    `ldeSurvivorNameByKey`). It also walks structural `parentCandidateId` edges. The cascade
    graph must use the same name -> survivor resolution.

- **AMS client in discovery-service (the model endpoint's data source):** Path:
  `discovery-service/src/services/archModelClient.ts`. The new read endpoint fetches candidates
  + findings via this client. (AMS controllers are run-scoped:
  `.../runs/{runId}/candidates|findings`.)

- **Grid aggregation memos to re-point (single-run consumption):** Path:
  `frontend/src/components/DashboardView/DiscoveryCandidateTable.tsx`. NOTE: the actual path is
  under `DashboardView/`, not `Discovery/` (the program brief's path was approximate). The file
  contains the client-side aggregation primitives to migrate onto the backbone: `getAddedBy`,
  `getUnresolvedConflicts` (and the `hasUnresolvedConflicts` predicate), `getDisplayTierLabel` /
  `getBaseTierLabel`, the tier-filter unique-values `useMemo`, the committed/conflict counts,
  and `review_status`/`reviewStatus` row-tinting derivations. Companion test files:
  `DiscoveryCandidateTable.conflicts.test.tsx`,
  `__tests__/discoveryCandidateTableCommitted.test.tsx`,
  `__tests__/discoveryCandidateTableOperation.test.tsx`,
  `__tests__/discoveryCandidateTableRuntime.test.tsx`,
  `__tests__/discoveryRunDetailBelowGateCount.test.tsx`.

- **Single-run-scoped surfaces (context for the single-run grid + the run-scoped API today):**
  - `frontend/src/components/DashboardView/DiscoveryRunDetailPage.tsx` (one `selectedRun` /
    `runId`).
  - `frontend/src/components/Discovery/DiscoveryRunDetailView.tsx` (run-detail view).

- **snake_case proxy idiom (for the new endpoint's client + proxy):** Paths:
  `frontend/src/api/discoveryApi.ts`, `frontend/src/api/findingsApi.ts`, and
  `gateway/src/routes/discovery.ts` (a pure proxy that forwards to discovery-service
  `/discovery/...` URLs). AMS speaks snake_case at the wire by default (per repo `CLAUDE.md`).

- **Findings <-> candidate bridge + vocabulary (for unioning findings into the model):** Path:
  `frontend/src/api/findingsApi.ts`. `DiscoveryFindingDto.links[]` carry
  `target_type: 'discovery_candidate' | ...` + `target_id`. Findings carry Spec F's
  `review_status` with vocabulary `pending_review` / `approved` / `rejected` / `deferred`
  (candidate parity), plus a `previous_review_status` audit field. Candidates additionally have
  a `committed` status used in the grid's count derivations.

- **Relationship-row field source-of-truth (edge taxonomy reference):** Path:
  `discovery-service/src/types/candidate.ts`. Its relationship-kind union and per-kind doc
  comments enumerate all six relationship-row types and their endpoint-field shapes
  (e.g. `data_movements` is the existing OUTBOUND integration edge, NOT a new type).

- **Run-kind dispatch (proof a run is code XOR database):** Path:
  `discovery-service/src/routes/runs.ts`. The `discoveryKind` variable is typed
  `'code' | 'database' | 'combined' | undefined` but the dispatch only branches on
  `=== 'database'` (else falls through to code); `'combined'` is never produced or dispatched
  here or in `runManager.ts`. Therefore "one code + one DB scan" = TWO separate runs, which is
  exactly the up-to-two-run-ids scan selection in Q2.

**Reuse-alignment to investigate (research-to-do for the spec writer, NOT blocking):**

- **Diagram-generation / relationship-walking + an existing transitive walker.** A
  `transitiveDependencyWalker.ts` already exists at
  `discovery-service/src/services/transitiveDependencyWalker.ts`, and there is relationship
  inference under `discovery-service/src/services/databasePacks/*/...RelationshipInference.ts`
  plus a relationship type module at `discovery-service/src/types/relationship.ts`. The spec
  writer should check whether `transitiveDependencyWalker.ts` (or the diagram relationship walk)
  is a genuine shared graph primitive the blast-radius closure should align with / reuse, rather
  than hand-rolling a new traversal.
- **Target-state captured-decisions cascade.** Lives under
  `frontend/src/components/targetState/architectConversation/` (e.g. `CascadeSummaryControls.tsx`,
  `CascadeSummary.test.tsx`) and `frontend/src/api/epicCapturedDecisionsApi.ts`. As the brief
  predicted, this appears to be a *decision* cascade in the target-state / architect-conversation
  domain -- a DIFFERENT domain from discovery-candidate dependency. The spec writer should
  CONFIRM this and only align if a real shared primitive exists; otherwise build fresh on the
  Spec 0 primitives.

### Follow-up Questions

No follow-up questions were required. The clarifying-question round resolved every open
question; the user accepted all recommendations on 2026-06-02.

## Visual Assets

### Files Provided:

No visual assets provided. The `planning/visuals/` folder was checked via directory listing and
contains no image files (`.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.pdf`). This is a backend
model + graph + API spec with a small grid re-pointing; no mockups are expected.

### Visual Insights:

Not applicable -- no visual assets to analyze.

## Requirements Summary

### Functional Requirements

- **Deterministic review model module (new, in `discovery-service`).** A pure TypeScript module
  that, given a scan selection, builds the unified review model: every candidate + finding
  across the selected run(s), each carrying its review status (Approve/Reject/Defer vocabulary,
  Spec F), Spec 0 conflict flags (`data._conflicts`), conflict resolutions
  (`data._conflictResolutions`), provenance (`_addedBy` / `_mergedFrom`), and merge-group
  membership. No LLM. Reuses the Spec 0 identity/merge primitives.
- **New read endpoint + gateway proxy.** A new discovery-service read endpoint computes the
  model live on read (fetching candidates + findings from AMS via `archModelClient.ts`); the
  gateway proxies it via the existing pure-proxy pattern. A snake_case frontend API client
  consumes it following the existing proxy idiom.
- **Scan selection of up to two run ids.** Accept <=1 code-kind run + <=1 DB-kind run; union
  candidates + findings across both. Compute cross-scan logical <-> physical edges (code-scan
  `logical_data_entities` <-> DB-scan `physical_data_entities` via
  `logical_data_entity_physical_data_entities`) when both scans are present. Degrade cleanly to
  a single run.
- **Cascade / dependency graph (typed edges).** Build a graph over candidate nodes with the
  full v1 edge set:
  - Structural edges from `parentCandidateId`.
  - Relationship-row edges: `interface_logical_entities`, `endpoint_data_effects`,
    `logical_data_entity_physical_data_entities`,
    `logical_data_attribute_physical_data_attributes`, `logical_data_entity_relationships`,
    `data_movements`.
  - Each edge carries an `edgeKind` discriminator + a direction.
  - Relationship rows that identify endpoints BY NAME are resolved name -> survivor via
    `buildIdentityKey` (the `candidateReconcile.ts` resolution rule).
  - The polymorphic `*_points` wrappers are NEVER nodes or edges.
- **Blast-radius computation (surface-only).** Per candidate, compute the transitive set of
  dependent candidate ids a reject/defer WOULD affect (downward transitive closure). Each
  dependent records the edge that pulled it in (edge provenance), in the shape Spec 2's
  preview -> confirm will render. Flag a parent as "would-be-orphaned" when all its children are
  rejected (advisory only). Spec 1 NEVER mutates status.
- **Precomputed aggregation / counts.** Over the unified candidate + finding set, compute counts
  by type, review status, source/tier, conflict state, merge group, scan-kind (code/DB), and
  finding severity; plus per-node degree and blast-radius size. Include an `operation`
  (create/enrich/link) roll-up if it falls out for free (not load-bearing).
- **Grid re-pointing (single-run).** Re-point the existing `useMemo` aggregation reads in
  `DiscoveryCandidateTable.tsx` (counts, conflict counts, tier roll-ups) onto the deterministic
  backbone, consuming it single-run (the grid passes its one `runId`). No new grid UI for
  blast-radius/cascade.
- **Tests.** Unit tests for the model module (identity/merge reuse, edge taxonomy incl.
  name-resolution, blast-radius closure incl. would-be-orphan advisory, single-run degrade,
  two-run cross-scan edges, aggregation dimensions); endpoint + gateway-proxy tests following
  the existing proxy-test pattern; updated/added grid tests for the re-pointed aggregations.

### Reusability Opportunities

- Spec 0 primitives reused directly: `buildIdentityKey`, `classifySourceTier`/`SOURCE_TIER_RANK`,
  the `_addedBy` provenance reader (`candidateIdentity.ts`); the conflict/provenance/merge-group
  model (`candidateMerge.ts`); the structural + name-resolved edge walk and name -> survivor
  resolution (`candidateReconcile.ts`).
- AMS data access reused: `archModelClient.ts` for fetching candidates + findings.
- Frontend aggregation logic migrated (not duplicated): `getAddedBy`, `getUnresolvedConflicts`,
  tier-label derivations, count memos in `DiscoveryCandidateTable.tsx`.
- Proxy + snake_case client idiom reused: `gateway/src/routes/discovery.ts`,
  `frontend/src/api/discoveryApi.ts`, `frontend/src/api/findingsApi.ts`.
- To investigate for alignment: `transitiveDependencyWalker.ts` (possible shared closure
  primitive) and `discovery-service/src/types/relationship.ts`; the target-state captured-
  decisions cascade (likely a different domain -- confirm before reusing).

### Scope Boundaries

**In Scope:**
- New deterministic review-model + cascade/dependency-graph + aggregation TypeScript module in
  `discovery-service`, computed live on read.
- New read endpoint (discovery-service) + gateway proxy + snake_case frontend client.
- Up-to-two-run-id scan selection (code XOR database per run), cross-scan logical <-> physical
  edges when both present, single-run degrade.
- Full v1 typed-edge taxonomy (structural + all six relationship-row kinds), name -> survivor
  resolution, `*_points` excluded.
- Surface-only blast radius (transitive downward closure + edge provenance + would-be-orphan
  advisory); never mutates status.
- Aggregation by type / review status / source-tier / conflict state / merge group / scan-kind /
  finding severity, + per-node degree + blast-radius size; optional `operation` roll-up.
- Re-point the grid's existing count/aggregation memos onto the backbone (single-run).
- Tests across module, endpoint/proxy, and grid.

**Out of Scope:**
- Bulk-action EXECUTION, the cascade preview -> confirm UI, and reject-suppresses-downstream-IR
  -- all **Spec 2**.
- The conversational "Architect" review persona, bulk-resolve-by-pattern, and ANY LLM use -- all
  **Spec 3** (Specs 0-2 are fully deterministic).
- A multi-run grid UI (grid stays single-run even though the API spans two runs).
- Any persisted or cached graph; any graph table; any AMS schema change (model is recomputed on
  read).
- Any WRITE to candidate `review_status`, finding `review_status`, or `data._conflictResolutions`
  (Spec 1 is read-only on all user state; existing write paths remain the owners).

### Technical Considerations

- **Compute location:** discovery-service owns the model (it owns the AMS client and the Spec 0
  primitives). Gateway is a pure proxy. AMS is unchanged.
- **Read-only + recompute:** no persistence, no caching of the graph; user state lives in AMS and
  is written only via existing paths.
- **AMS run-scoping:** AMS exposes candidates/findings per run (`.../runs/{runId}/...`); the new
  endpoint fetches per selected run and unions in the discovery-service module.
- **Run-kind invariant:** each run is `code` XOR `database`; the `'combined'` type-union value in
  `runs.ts` is never produced. Cross-scan edges therefore inherently span two runs.
- **Name-based edge resolution:** relationship rows resolve endpoints by name fields in `data`
  (`logicalEntityName`, `dataEntityName`), resolved to a survivor via `buildIdentityKey` -- the
  graph must NOT assume candidate-id endpoints for relationship rows.
- **Meta-model conformance:** logical and physical are DISTINCT layers with EXPLICIT non-1:1
  mappings (never default to 1:1); `classes` / `methods` are first-class entity types;
  `*_points` polymorphic wrappers are backend auto-managed and are NEVER nodes/edges. Rejecting a
  logical entity must correctly touch its attributes, its logical <-> physical mappings, and the
  endpoints referencing it via `endpoint_data_effects`.
- **Shared vocabulary:** Approve/Reject/Defer (`pending_review`/`approved`/`rejected`/`deferred`,
  candidates also `committed`) applies to BOTH candidates and findings everywhere.
- **Wire format:** AMS speaks snake_case by default; the new client + proxy follow the existing
  snake_case discovery/findings idiom.
- **Cross-spec delivery framing:** per the program feedback that Specs 1-3 deliver as a set (the
  user will not use the tool until all three are complete), optimize for clean hand-offs and a
  complete feature set across 1-3 rather than per-spec standalone usability -- BUT do NOT stub or
  defer any REQUIRED functionality; the union of Specs 1-3 must be complete, and Spec 1's own
  required scope (model + graph + aggregation API + grid re-pointing + tests) ships in full. The
  blast-radius output shape must be the shape Spec 2's preview -> confirm consumes, and the model
  must be the shared backbone Spec 3's conversation reads.

## Resolved Decisions (user-confirmed 2026-06-02)

1. **Compute / expose:** a NEW deterministic TypeScript module in `discovery-service` + a NEW
   read endpoint, **live-computed on read, NOT persisted** (no graph table, no AMS schema
   change). The endpoint fetches candidates + findings from AMS (discovery-service owns the AMS
   client), then computes the model. The gateway proxies it. Reuse the Spec 0 identity/merge
   primitives.
2. **Scan scope:** the model/API accepts a **scan selection of up to two run ids** (<=1
   code-kind + <=1 DB-kind), unions candidates + findings across both, and computes cross-scan
   edges (logical <-> physical) when both are present; it **degrades cleanly to a single run**.
   (The logical <-> physical layer is the DB schema-migration source per the product North Star.)
3. **Edge taxonomy:** the FULL edge set in v1 -- structural `parentCandidateId` edges AND all
   relationship-row edges (`interface_logical_entities`, `endpoint_data_effects`,
   `logical_data_entity_physical_data_entities`,
   `logical_data_attribute_physical_data_attributes`, `logical_data_entity_relationships`,
   `data_movements`) -- modeled as **typed edges (`edgeKind` + direction)**. Relationship rows
   resolved name -> survivor via `buildIdentityKey`. `*_points` never become nodes/edges.
4. **Blast-radius semantics:** **surface-only** -- compute, per candidate, the **transitive set
   of dependent candidate ids a reject/defer WOULD affect**; Spec 1 **never mutates** any status.
   Downward transitive closure (reject a parent => its children/dependents). Child -> parent is
   **advisory-only** (flag a parent as "would-be-orphaned" when all children are rejected); never
   a forced roll-up. Each dependent records **which edge pulled it in** (edge provenance). The
   hard cascade + reject-suppresses-downstream-IR is Spec 2.
5. **Grid adoption (scope of THIS spec):** ship the model + graph + aggregation API + tests, AND
   **re-point the grid's existing count/aggregation reads** (`DiscoveryCandidateTable.tsx`
   `useMemo`s -- counts, conflict counts, tier roll-ups) onto the deterministic backbone
   (single-run consumption). Add **NO** blast-radius/cascade UI (that's Spec 2) and keep the grid
   **single-run** (it passes its one `runId`; the API can span two).
6. **Recompute vs store:** the model is **fully recomputed on read, never persisted**. Candidate
   `review_status`, finding `review_status`, and Spec 0's `data._conflictResolutions` remain user
   state via the EXISTING write paths -- **Spec 1 is read-only on all of it** (reads, never
   writes).
7. **Aggregation dimensions:** counts by **type, review status, source/tier, conflict state,
   merge group, scan-kind (code/DB), and finding severity**, computed once over the unified
   candidate + finding set, plus per-node degree / blast-radius size. `operation`
   (create/enrich/link) as a cheap extra roll-up if free, not load-bearing.
