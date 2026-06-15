# Task Breakdown: Reject-Cascade Correctness

## Overview
Total Tasks: 4 task groups

This is PURE backend / deterministic-logic work across THREE trees that must move
in lock-step:
- **discovery-service** — review-model graph/wire (`edges` + node `review_status`
  already built; the only change is stopping them being dropped at the resolver
  boundary, plus confirming graph tests).
- **gateway** — the CANONICAL `resolveBulkActionSet` + the `ReviewModelWire` /
  `REVIEW_MODEL_WIRE_FIELDS` manifest / `toResolverModel` plumbing.
- **frontend** — the `resolveBulkActionSet` MIRROR + the `ReviewModel` type.

**NO AMS change, NO save-back change, NO UI** (the agenda/gate UI is Spec 4, built
on top of the now-correct resolved set).

> **CRITICAL MIRROR CONSTRAINT (applies to every group below).**
> `gateway/src/services/discovery/resolveBulkActionSet.ts` and
> `frontend/src/components/Discovery/resolveBulkActionSet.ts` are a declared
> **BYTE-FOR-BYTE LOGIC MIRROR** (both files' header comments state this). The
> gateway file is the CANONICAL home. EVERY algorithm change in this spec
> (in-adjacency build, exclusivity, peer rule, surfacing/marking) and EVERY new
> wire field MUST be applied IDENTICALLY to both copies, field-for-field and
> snake_case-for-snake_case. The new shared-fixture parity test (Task Group 4) is
> the only guard against the two copies drifting on the new logic.

## Task List

### Wire Layer (foundational)

#### Task Group 1: Expose the raw edge graph + node `review_status` to BOTH resolver inputs
**Dependencies:** None

This group is purely additive plumbing of data the discovery-service model
ALREADY builds. No algorithm change yet. Everything in Groups 2-3 depends on the
resolver inputs carrying `edges` (with `relationship_candidate_id`) and node
`review_status`.

- [x] 1.0 Complete the wire extension across the three trees
  - [x] 1.1 Write 2-8 focused tests for the extended wire shape
    - Extend the EXISTING wire-shape contract test
      (`gateway/src/services/discovery/__tests__/resolveBulkActionSet.test.ts:337-369`)
      — the existing test STAYS (Confirmed Decision 5), do not replace it.
    - Assert a built sample exposes the new top-level `edges` array with
      `edge_kind` / `from_id` / `to_id` / `relationship_candidate_id` on each edge.
    - Assert a built sample exposes the new top-level `nodes` array with
      `id` / `review_status` on each node.
    - Assert the extended `REVIEW_MODEL_WIRE_FIELDS` manifest still passes the
      snake_case check (`/^[a-z]+(_[a-z]+)*$/`, the check at :401-412).
    - Limit to 2-8 highly focused tests maximum; pin only the new fields + the
      manifest invariant.
  - [x] 1.2 Add `edges` + `nodes` to the gateway `ReviewModelWire`
    - File: `gateway/src/services/discovery/reviewModelWire.ts:174-181`.
    - Add top-level `edges` array; each edge carries `edge_kind` / `from_id` /
      `to_id` / `relationship_candidate_id` (mirror of `ReviewModelEdge`,
      `discovery-service/src/services/reviewModel/types.ts:199-213`).
    - Add a minimal top-level `nodes` array; each node carries `id` +
      `review_status` only (the resolver seeds the already-rejected half from it,
      spec "Expose each node's review_status").
    - Fields are snake_case (AMS/discovery-service default; model serializes
      verbatim via `JSON.stringify`).
  - [x] 1.3 Extend the `REVIEW_MODEL_WIRE_FIELDS` drift-guard manifest
    - File: `gateway/src/services/discovery/reviewModelWire.ts:197-206`.
    - Add `edges` to the `model` key (now
      `['blast_radius', 'findings', 'aggregations', 'edges', 'nodes']`).
    - Add a new `edge` manifest entry:
      `['edge_kind', 'from_id', 'to_id', 'relationship_candidate_id']`.
    - Add a new `node` manifest entry: `['id', 'review_status']`.
  - [x] 1.4 Stop `toResolverModel` dropping `edges`; forward `edges` + `nodes`
    - File:
      `gateway/src/services/discoveryReviewConversation/reviewModelFull.ts:142-148`.
    - `FullReviewModelWire` ALREADY carries `edges` (:99-107 / :128-135) and
      `nodes` (:60-81) — the narrowing cast at :142-148 currently OMITS `edges`.
    - Stop dropping `edges`; forward both `edges` and `nodes` into the narrowed
      resolver model. Pure passthrough, no transform.
  - [x] 1.5 Add `edges` to the frontend `ReviewModel` type
    - File: `frontend/src/api/discoveryApi.ts:461-468`.
    - `ReviewModel` already carries `nodes` (with `review_status` at
      `discoveryApi.ts:324-335`, field at :328) — NO frontend node change needed.
    - Add an `edges` field; reuse the `ReviewModelEdgeKind` union at
      `discoveryApi.ts:390-398` and the existing edge fields so the frontend
      mirror reads the same graph field-for-field with the gateway wire.
  - [x] 1.6 Ensure the wire-layer tests pass
    - Typecheck the three trees touched (gateway, frontend; discovery-service
      types are referenced only).
    - Run ONLY the extended wire-shape contract test from 1.1
      (`gateway/src/services/discovery/__tests__/resolveBulkActionSet.test.ts`).
    - Do NOT run the entire test suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass.
- The gateway `ReviewModelWire` + manifest carry `edges`
  (`edge_kind`/`from_id`/`to_id`/`relationship_candidate_id`) and `nodes`
  (`id`/`review_status`); the manifest stays snake_case.
- `toResolverModel` forwards `edges` + `nodes` (no longer drops `edges`).
- The frontend `ReviewModel` carries `edges` field-for-field with the gateway
  wire.
- No discovery-service compute pass added (raw `edges` plumbed through, Confirmed
  Decision 1); no precomputed referencer map.

### Resolver Logic — Exclusivity (reject-only)

#### Task Group 2: Reject-only exclusivity in the cascade walk (fixes gap 1)
**Dependencies:** Task Group 1

Applies the same logic IDENTICALLY to both resolver mirrors. Reject-only —
Approve and Defer cascade behaviour is UNCHANGED (Confirmed Decision 3).

- [x] 2.0 Complete reject-only exclusivity in both mirrors
  - [x] 2.1 Write 2-8 focused tests on EACH mirror (identical cases)
    - Gateway:
      `gateway/src/services/discovery/__tests__/resolveBulkActionSet.test.ts`.
    - Frontend: a NEW resolver test file alongside
      `frontend/src/components/Discovery/resolveBulkActionSet.ts` (none exists
      today, per requirements Q5).
    - Exclusivity (shared entity): a `logical_data_entity` with two referencing
      endpoints — rejecting ONE leaves the entity (and its attributes) OUT of the
      reject set; rejecting BOTH (and/or one already persisted `rejected` via node
      `review_status`) pulls it in. Exercise the union {already-persisted-rejected
      ∪ this-action's rejects}.
    - Reject-only: Approve / Defer over the same fixture produce the pre-change
      cascade (no exclusivity).
    - Cycle-safety: a cyclic relationship graph terminates and yields a stable,
      deterministic set.
    - Limit to 2-8 highly focused tests maximum per mirror.
  - [x] 2.2 Build per-resolve in-adjacency (referencer map) from `edges`
    - Apply IDENTICALLY to gateway (`resolveBulkActionSet.ts`) and frontend
      (`resolveBulkActionSet.ts`).
    - Each mirror builds its OWN in-adjacency at resolve time from the raw `edges`
      (Confirmed Decision 1) — node id → list of `{ from_id, edge_kind,
      relationship_candidate_id }` referencing predecessors. No precomputed map.
    - Keep PURE (no I/O / React / clock / global state, `resolveBulkActionSet.ts:25-31`).
  - [x] 2.3 Seed the already-rejected set from node `review_status`
    - From the new `nodes` array, seed {already-persisted-rejected} = nodes whose
      `review_status === 'rejected'`. The exclusivity union is
      {already-persisted-rejected} ∪ {this action's rejected seeds + cascade}.
  - [x] 2.4 Apply exclusivity to the five owned-by relationship-row edge kinds
    - For a node reached via a many-to-one relationship-row edge, add it to the
      reject set ONLY if ALL of its referencing predecessors (of that edge kind,
      from the in-adjacency) are in the reject set. Shared nodes (≥1 surviving
      referencer) SURVIVE.
    - The five owned-by kinds cascade WITH exclusivity: `interface_logical_entities`,
      `endpoint_data_effects`, `logical_data_entity_physical_data_entities`,
      `logical_data_attribute_physical_data_attributes`, `data_movements`
      (`RELATIONSHIP_EDGE_KINDS`, `types.ts:89-97`).
    - `parent_child` cascade is UNCHANGED — single parent ⇒ trivially exclusive;
      rejecting the entity still rejects its attributes (Confirmed Decision 3 /
      `types.ts:80-87`). Reject-only — guard with `action === 'rejected'`; the
      existing seed→`blast_radius` BFS (`resolveBulkActionSet.ts:219-238`) runs
      as-is for Approve/Defer.
  - [x] 2.5 Make the walk a cycle-safe fixpoint over the evolving reject set
    - Because exclusivity depends on the evolving reject set, a node may become
      includable only once all its referencers are present — re-evaluate deferred
      candidates as the reject set grows (a fixpoint / re-queue).
    - Still bounded by the visited-set (`touched` doubles as the visited-set,
      `resolveBulkActionSet.ts:25-31`); terminate deterministically on cycles.
  - [x] 2.6 Apply the peer rule for `logical_data_entity_relationships`
    - This edge kind is peer-to-peer (sourceEntity→targetEntity,
      `buildReviewModel.ts:319-335`): rejecting one endpoint DROPS the
      relationship ROW but must NEVER pull the opposite entity into the reject
      set (Confirmed Decision 2). The far-entity surfacing/marking is Group 3; here,
      simply never traverse this edge kind to add the far entity to the reject
      set (it is NOT one of the five owned-by exclusivity kinds in 2.4).
    - **Physical-symmetry finding (state in the implementation):** there is NO
      separate `physical_data_entity_relationships` edge kind in production code —
      the physical entity↔entity relationship FOLDS INTO
      `logical_data_entity_relationships` (`buildReviewModel.ts:319-335`). The
      single peer rule therefore covers BOTH the logical and physical entity↔entity
      relationship; no second edge kind to special-case.
  - [x] 2.7 Ensure exclusivity tests pass (both mirrors)
    - Typecheck gateway + frontend.
    - Run ONLY the 2-8 gateway tests AND the 2-8 frontend tests from 2.1
      (gateway jest + frontend vitest).
    - Confirm the byte-for-byte mirror: diff the changed regions of the two
      resolver files to verify the exclusivity/in-adjacency logic is identical.
    - Do NOT run the entire test suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass on BOTH mirrors with identical cases.
- A shared entity with a surviving referencer SURVIVES; only when ALL referencers
  are in {already-rejected ∪ this-action's rejects} is it pulled in.
- `logical_data_entity_relationships` never pulls the far entity (peer rule),
  covering both logical and physical entity↔entity relationships.
- Approve and Defer cascade behaviour is unchanged; logic is reject-only.
- The walk stays pure and cycle-safe; output is stable/deterministic.
- The two resolver copies are byte-for-byte identical in the changed regions.

### Resolver Logic — Relationship Surfacing + Marking

#### Task Group 3: Surface + mark referencing relationship-row candidates for every rejected node (fixes gap 2)
**Dependencies:** Task Group 2

Applies the same logic IDENTICALLY to both resolver mirrors. Uses the EXISTING
atomic cascade bulk-review endpoint — no new AMS work.

- [x] 3.0 Complete relationship surfacing + marking in both mirrors
  - [x] 3.1 Write 2-8 focused tests on EACH mirror (identical cases)
    - Surfacing/marking: every rejected node's referencing relationship-row
      `relationship_candidate_id`s appear in the resolved candidate set AND in the
      flat `candidate_ids[]` the resolver yields; the "+N relationships dropped"
      count is correct.
    - Peer-row marking: rejecting one endpoint of a `logical_data_entity_relationships`
      edge marks the relationship ROW candidate `rejected` but the far entity is
      NOT in the candidate set; include a physical-to-physical instance (same edge
      kind) to prove the physical symmetry.
    - Reject-only: Approve / Defer over the same fixture produce NO relationship
      marking (pre-change behaviour).
    - Limit to 2-8 highly focused tests maximum per mirror.
  - [x] 3.2 Collect referencing relationship-row candidate ids per rejected node
    - Apply IDENTICALLY to both resolver copies.
    - For every node in the FINAL reject set, find every edge whose `from_id` OR
      `to_id` is that node and whose `edge_kind` is a relationship-row kind;
      collect its `relationship_candidate_id` (`types.ts:199-213`, populated at
      `buildReviewModel.ts:416-423`). NO reconstruction by name — the
      `relationship_candidate_id` already links edge → row candidate.
    - This includes BOTH the peer `logical_data_entity_relationships` rows AND the
      owned-by rows: a rejected entity's referencing relationship CANDIDATES are
      always surfaced + marked, even when (peer case) the far entity is not pulled
      in.
  - [x] 3.3 Add the relationship candidates to the resolved set + flat id set
    - Add the collected relationship-candidate ids to the resolved set as cascade
      members (so "+N relationships dropped" is real data) AND into the flat
      candidate-id set the resolver yields, so they are persisted `rejected`
      through the EXISTING atomic cascade bulk-review endpoint (Confirmed Decision 4).
  - [x] 3.4 Confirm the persistence + save-back paths need NO change
    - The flat `candidate_ids[]` is persisted via the EXISTING proxy
      `POST .../runs/:runId/candidates/bulk-review` (`gateway/src/routes/discovery.ts:1388`,
      body `{ review_status, candidate_ids[] }`) backed by AMS
      `DiscoveryCascadeReviewService`. Same `rejected` status as a user reject — no
      distinct "auto-dangling" status. NO new endpoint / DTO / changeset.
    - Confirm `mcp-server/src/services/candidateSaveBackService.ts` already SKIPS
      dangling relationship rows correctly (marking is upstream); no save-back
      change. This is a verification/read-only step — assert no edits needed.
  - [x] 3.5 Ensure surfacing/marking tests pass (both mirrors)
    - Typecheck gateway + frontend.
    - Run ONLY the 2-8 gateway tests AND the 2-8 frontend tests from 3.1.
    - Diff the changed regions of the two resolver files to verify the
      surfacing/marking logic is byte-for-byte identical.
    - Do NOT run the entire test suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass on BOTH mirrors with identical cases.
- Every rejected node's referencing relationship-row candidate ids (via
  `relationship_candidate_id`) appear in the resolved set + the flat
  `candidate_ids[]`; the "+N relationships dropped" count is correct.
- Peer-relationship rows are surfaced + marked even when the far entity survives;
  physical-to-physical instances behave identically (single edge kind).
- No AMS / DTO / changeset change; no save-back change — marking flows through the
  existing atomic cascade endpoint.
- The two resolver copies are byte-for-byte identical in the changed regions.

### Parity + Cross-Tree Verification

#### Task Group 4: Behavioral parity guard + graph/blast-radius confirmation
**Dependencies:** Task Groups 1-3

The shared-fixture parity test is the ONLY guard against the two resolver copies
drifting on the new logic (Confirmed Decision 5). It is added IN ADDITION to (not
replacing) the wire-shape contract test from Group 1 and the per-mirror unit tests
from Groups 2-3.

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the wire-shape contract test (Task 1.1).
    - Review the per-mirror exclusivity tests (Task 2.1, both mirrors).
    - Review the per-mirror surfacing/marking tests (Task 3.1, both mirrors).
  - [x] 4.2 Add the NEW shared-fixture behavioral PARITY test
    - Build ONE input (seed ids + action + a review model containing `edges`,
      node `review_status`, shared entities, a peer `logical_data_entity_relationships`
      relationship, and a cycle) and run it through BOTH the gateway and the
      frontend `resolveBulkActionSet`; diff-assert IDENTICAL output (candidates,
      findings, the marked candidate-id set, counts).
    - This is one strategic test (the parity guard); it does not need to re-cover
      every per-mirror case.
  - [x] 4.3 Confirm discovery-service graph / blast-radius still correct
    - Confirm `buildReviewModel` still emits the full `edges` array with
      `relationship_candidate_id` populated for EVERY relationship-row kind (the
      resolver's surfacing depends on it) — `buildReviewModel.ts:399-423`.
    - Confirm `toResolverModel` now forwards `edges` + `nodes` rather than
      dropping them (cross-check with Task 1.4).
    - Add up to a small number of focused discovery-service graph/blast-radius
      tests ONLY if a gap is found; do NOT write comprehensive coverage. Total new
      tests across 4.2-4.3 should stay within ~10 maximum.
  - [x] 4.4 Run feature-specific tests only across the three trees
    - discovery-service: the graph/blast-radius tests touched/added.
    - gateway: the extended wire-shape contract test + the gateway resolver unit
      tests + the parity test (jest).
    - frontend: the frontend resolver unit tests (vitest).
    - Typecheck all three trees.
    - Run ONLY tests related to THIS spec's feature; do NOT run the entire
      application test suite for any tree.

**Acceptance Criteria:**
- All feature-specific tests pass across the three trees (wire contract +
  per-mirror exclusivity + per-mirror surfacing/marking + the shared-fixture
  parity test + the discovery-service graph confirmation).
- The shared-fixture parity test diff-asserts IDENTICAL output from both
  resolvers, proving no behavioral drift on the new logic.
- `buildReviewModel` still emits `edges` with `relationship_candidate_id` for
  every relationship-row kind; `toResolverModel` forwards `edges` + `nodes`.
- No more than ~10 additional tests added when filling gaps; testing focused
  exclusively on this spec.

## Execution Order

Recommended implementation sequence (foundational first):
1. Wire extension — expose raw `edges` + node `review_status` to both resolver
   inputs (Task Group 1). Everything else depends on this.
2. Reject-only exclusivity in both resolver mirrors (Task Group 2).
3. Relationship surfacing + marking in both resolver mirrors (Task Group 3).
4. Behavioral parity guard + discovery-service graph confirmation + cross-tree
   verification (Task Group 4).
