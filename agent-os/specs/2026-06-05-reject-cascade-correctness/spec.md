# Specification: Reject-Cascade Correctness

## Goal
Make the shared `resolveBulkActionSet` cascade resolver REJECT-correct so a rejected entity no longer kills a shared entity still used by surviving endpoints (exclusivity), and so the relationship-row candidates that reference a rejected entity are surfaced as cascade members and marked `rejected` (no longer stale/invisible). The fix is in the resolver only and corrects BOTH the conversational confirm-gate and the candidate grid; the agenda/gate UI (Spec 4) is built on top of the now-correct set.

## User Stories
- As an architect rejecting an endpoint, I want a `logical_data_entity` it touches to SURVIVE when another surviving endpoint still uses it, so I don't silently destroy a shared entity for the rest of the migration model.
- As a reviewer, I want every relationship row that references a rejected entity to be counted ("+N relationships dropped") and persisted as `rejected`, so the review surfaces tell the truth and no relationship candidate is left with a stale `approved`/`pending` status it will never honour.

## Specific Requirements

**Extend the resolver wire to carry the raw edge graph (incoming-edge exposure)**
- The resolver currently receives ONLY `{ blast_radius, findings, aggregations }` (`gateway/src/services/discovery/reviewModelWire.ts:174-181`); the outgoing-only `blast_radius[].dependents` loses all in-edge structure, so neither mirror can test "are all my referencers rejected?".
- Add a top-level `edges` array to the gateway `ReviewModelWire`, each edge carrying `edge_kind` / `from_id` / `to_id` / `relationship_candidate_id` (mirror of `ReviewModelEdge` at `discovery-service/src/services/reviewModel/types.ts:199-213`). NO precomputed referencer map / new discovery-service compute pass — each mirror builds its own in-adjacency at resolve time (Confirmed Decision 1).
- Extend `REVIEW_MODEL_WIRE_FIELDS` (`reviewModelWire.ts:197-206`) with the `model` key `edges` and a new `edge` entry `['edge_kind', 'from_id', 'to_id', 'relationship_candidate_id']`; update the wire-shape contract test to pin them (`gateway/src/services/discovery/__tests__/resolveBulkActionSet.test.ts:337-369`).
- `toResolverModel` (`gateway/src/services/discoveryReviewConversation/reviewModelFull.ts:142-148`) currently DROPS `edges` though `FullReviewModelWire` already carries them (`reviewModelFull.ts:128-135`, edge type at :99-107) — stop dropping; pass `edges` through.
- The frontend `ReviewModel` (`frontend/src/api/discoveryApi.ts:461-468`) already carries `nodes` but NOT `edges` — add an `edges` field (reuse the `ReviewModelEdgeKind` union at `discoveryApi.ts:390-398`) so the frontend mirror reads the same graph.
- The discovery-service review model already builds the full `edges` array (`buildReviewModel.ts:399-423`); it is dropped only at the resolver boundary, so plumbing it through is the smaller change — do NOT add a discovery-service compute pass.

**Expose each node's `review_status` to the gateway resolver wire**
- Exclusivity evaluates over {already-persisted-rejected} ∪ {this action's rejected seeds+cascade}; the resolver needs each node's persisted `review_status` to seed the already-rejected half.
- The frontend `ReviewModel` already carries `nodes` with `review_status` (`discoveryApi.ts:324-335`, field at :328) — no frontend node change needed.
- The gateway `ReviewModelWire` does NOT carry `nodes` — add a minimal `nodes` array (node `id` + `review_status`) to the gateway wire + manifest + contract test, parallel to the `edges` addition. `FullReviewModelWire.nodes` already carries both (`reviewModelFull.ts:60-81`), so `toResolverModel` just forwards them.

**Reject-only exclusivity in the cascade walk (fixes gap 1)**
- Applies ONLY to `action === 'rejected'`. Approve and Defer cascade behaviour is UNCHANGED (Confirmed Decision 3) — the existing seed→`blast_radius` BFS (`resolveBulkActionSet.ts:219-238`) runs as-is for those.
- For a node reached via a many-to-one relationship-row edge, add it to the reject set ONLY if ALL of its referencing predecessors (of that edge kind, computed from the new in-adjacency) are in the reject set = {already-persisted-rejected from node `review_status`} ∪ {this action's rejected seeds + the cascade already accreted}. Shared nodes (≥1 surviving referencer) SURVIVE.
- `parent_child` cascade is UNCHANGED — a child has a single parent, so it is trivially exclusive; rejecting the entity still rejects its attributes (Confirmed Decision 3 / `types.ts:80-87`).
- The five "owned-by" relationship-row edge kinds cascade WITH exclusivity: `interface_logical_entities`, `endpoint_data_effects`, `logical_data_entity_physical_data_entities`, `logical_data_attribute_physical_data_attributes`, `data_movements` (`RELATIONSHIP_EDGE_KINDS`, `types.ts:89-97`).
- Keep the walk PURE and cycle-safe (no I/O / React / clock / global state; `touched` doubles as the visited-set, `resolveBulkActionSet.ts:25-31`). Because exclusivity depends on the evolving reject set, a single forward BFS pass may add a node only once all its referencers are present — re-evaluate deferred candidates as the reject set grows (a fixpoint / re-queue), still bounded by the visited-set.

**Peer relationship rule — `logical_data_entity_relationships` never pulls the far entity**
- `logical_data_entity_relationships` is peer-to-peer (sourceEntity→targetEntity, `buildReviewModel.ts:319-335`): rejecting one endpoint must DROP the relationship ROW (surface + mark rejected) but NEVER pull the opposite entity into the reject set (Confirmed Decision 2).
- **Physical symmetry (verified build-time finding):** there is NO separate `physical_data_entity_relationships` edge kind anywhere in production code — the physical entity↔entity relationship FOLDS INTO `logical_data_entity_relationships` ("BOTH logical-to-logical AND physical-to-physical land on this type", `buildReviewModel.ts:319-335`). Applying the peer rule to the single `logical_data_entity_relationships` edge kind therefore covers BOTH the logical and physical entity↔entity relationship as the user required — no second edge kind to special-case. State this finding in the implementation; the peer rule is applied wherever the entity↔entity relationship is represented (today: `logical_data_entity_relationships`).

**Relationship surfacing + marking for every rejected node (fixes gap 2)**
- For every node in the final reject set, find every edge whose `from_id` OR `to_id` is that node and whose `edge_kind` is a relationship-row kind; collect its `relationship_candidate_id` (`ReviewModelEdge.relationship_candidate_id`, `types.ts:199-213`, populated at `buildReviewModel.ts:416-423`).
- Add those relationship-candidate ids to the resolved candidate set as cascade members (so "+N relationships dropped" is real data) AND into the flat candidate-id set the resolver yields, so they are persisted `rejected` through the EXISTING atomic cascade bulk-review endpoint (Confirmed Decision 4). NO reconstruction by name — the `relationship_candidate_id` already links edge→row candidate.
- This includes BOTH the peer `logical_data_entity_relationships` rows AND the owned-by rows: a rejected entity's referencing relationship CANDIDATES are always surfaced + marked, even when (peer case) the far entity is not pulled in.

**Persist via the existing atomic cascade endpoint — no new AMS work**
- The resolved candidate-id set is persisted via the EXISTING `POST .../runs/:runId/candidates/bulk-review` proxy (`gateway/src/routes/discovery.ts:1388`, body `{ review_status, candidate_ids[] }`) backed by AMS `DiscoveryCascadeReviewService` + `BulkReviewCascadeRequest`/`Response`.
- Marking the relationship rows = INCLUDING their ids in the flat `candidate_ids[]` the resolver yields. The endpoint persists `review_status: 'rejected'` (same status as a user reject — no distinct "auto-dangling" status, Confirmed Decision 4). NO new endpoint / DTO / changeset; NO save-back change (`mcp-server/src/services/candidateSaveBackService.ts` already skips dangling relationship rows correctly; marking is upstream).

**Keep the two resolver mirrors behaviorally identical**
- The gateway helper (`gateway/src/services/discovery/resolveBulkActionSet.ts`) is the CANONICAL home; the frontend file (`frontend/src/components/Discovery/resolveBulkActionSet.ts`) is a byte-for-byte LOGIC MIRROR (both header comments state this). Every algorithm change (in-adjacency build, exclusivity, peer rule, surfacing/marking) MUST be applied identically to both copies.
- Wire fields are snake_case (AMS/discovery-service default; model serializes verbatim with `JSON.stringify`) — the mirrors match the new `edges`/`nodes` fields field-for-field.

**Leave `would_be_orphaned_parent_ids` as-is**
- It is advisory-only, consumed nowhere behaviorally (`reviewModelWire.ts:99-113`; hard-coded `[]` at `DiscoveryCandidateTable.tsx`; resolver never reads it); the new general exclusivity subsumes the single-parent case via `parent_child` being trivially exclusive.
- Do NOT remove it — leaving the field avoids wire churn for zero behaviour change (Confirmed Decision 6). Out of scope for this spec.

## Existing Code to Leverage

**`discovery-service/src/services/reviewModel/buildReviewModel.ts` (edges + `relationship_candidate_id`)**
- Already builds the full `edges` array with `edge_kind`/`from_id`/`to_id`/`relationship_candidate_id` (:399-423) — reuse end-to-end; the only change is to stop dropping it at the resolver boundary.
- :319-335 is the load-bearing physical-symmetry evidence: physical entity↔entity relationships land on `logical_data_entity_relationships`, so the single peer rule covers both layers.

**`discovery-service/src/services/reviewModel/types.ts` (taxonomy + node status)**
- `EdgeKind` (:80-87), `RELATIONSHIP_EDGE_KINDS` (the six relationship-row kinds, :89-97), `ReviewModelEdge.relationship_candidate_id` (:199-213), `ReviewModelNode.review_status` (:146-182, field at :158) — reuse verbatim; no new types in discovery-service.

**`gateway/src/services/discovery/reviewModelWire.ts` + its contract test**
- The resolver input wire + `REVIEW_MODEL_WIRE_FIELDS` drift-guard manifest (:174-206) — extend with `edges` + `nodes`; extend the contract test (`__tests__/resolveBulkActionSet.test.ts:337-369`) to pin the new fields. The existing wire-shape contract test STAYS (Confirmed Decision 5).

**`mcp-server/src/services/candidateSaveBackService.ts` (gap-2 reference; no change)**
- Already SKIPS relationship rows whose endpoint no longer resolves (so no dangling relationship reaches the migration model); only candidates that produced an action get `committed` (Step 11). The stale-status gap is fixed UPSTREAM by the resolver marking the relationship candidate `rejected` — confirm no change is needed here.

**The atomic cascade bulk-review path (AMS + gateway proxy)**
- AMS `DiscoveryCascadeReviewService` + `BulkReviewCascadeRequest`/`Response`; gateway proxy `discovery.ts:1388` taking flat `{ review_status, candidate_ids[] }` (`discoveryApi.ts:499-505`) — reuse for marking; a more-complete id set is the only change.

## Out of Scope
- Agenda chunking, family bulk actions, and the confirm-gate / Review-Room UI — that is Spec 4, built on top of the now-correct resolved set.
- Any new AMS endpoint, DTO, service, or Liquibase changeset — the existing atomic cascade bulk-review endpoint is reused unchanged.
- Save-back changes in `candidateSaveBackService.ts` — the relationship-row skip is already correct; marking is upstream in the resolver.
- Approve and Defer cascade behaviour — unchanged; exclusivity + surfacing/marking are reject-only.
- Removing or repurposing `would_be_orphaned_parent_ids` — left as-is (vestigial but harmless).
- Any precomputed referencer map or new discovery-service blast-radius/compute pass — the raw `edges` array is plumbed through instead.
- A distinct "auto-dangling" review status — dropped relationship rows are marked the same `rejected` as a user reject.

## Testing Strategy

**Per-mirror unit tests (gateway home + frontend mirror, identical cases)**
- Exclusivity: a shared `logical_data_entity` with two referencing endpoints — rejecting one endpoint leaves the entity (and its attributes) OUT of the reject set; rejecting BOTH (and/or one already persisted `rejected`) pulls it in. Exercise the union {already-persisted-rejected ∪ this-action's rejects}.
- Peer rule: rejecting one endpoint of a `logical_data_entity_relationships` edge marks the relationship ROW candidate `rejected` but NEVER adds the far entity to the candidate set; include a physical-to-physical instance (same edge kind) to prove the physical symmetry.
- Surfacing/marking: every rejected node's referencing relationship-row `relationship_candidate_id`s appear in the resolved candidate set + the flat `candidate_ids[]`; "+N relationships dropped" count is correct.
- Reject-only: Approve / Defer over the same fixture produce the pre-change cascade (no exclusivity, no relationship marking).
- Cycle-safety preserved: a cyclic relationship graph terminates and yields a stable, deterministic set.

**Shared-fixture behavioral PARITY test (Confirmed Decision 5)**
- Run ONE input (seed ids + action + a review model containing edges, node `review_status`, shared entities, a peer relationship, and a cycle) through BOTH the gateway and the frontend resolver and diff-assert IDENTICAL output (candidates, findings, the marked candidate-id set, counts). This is the only guard against the two copies drifting on the new logic; add it in addition to (not replacing) the wire-shape contract test.

**Wire-shape contract + manifest tests**
- Extend `gateway/src/services/discovery/__tests__/resolveBulkActionSet.test.ts:337-369` to assert the built sample exposes the new `edges` (with `edge_kind`/`from_id`/`to_id`/`relationship_candidate_id`) and `nodes` (with `id`/`review_status`) fields, and that the manifest stays snake_case (the `/^[a-z]+(_[a-z]+)*$/` check at :401-412).

**Blast-radius / graph tests (discovery-service)**
- Confirm `buildReviewModel` still emits the full `edges` array with `relationship_candidate_id` populated for every relationship-row kind (the resolver's surfacing depends on it), and that `toResolverModel` now forwards `edges` + `nodes` rather than dropping them.
