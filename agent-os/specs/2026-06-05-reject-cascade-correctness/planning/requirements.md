# Spec Requirements: Reject-Cascade Correctness

## Initial Description

(From `planning/raw-idea.md`.) The Discovery Review Room (conversational) AND the
discovery candidate grid both apply Approve/Reject/Defer dispositions across a
cascade computed by `resolveBulkActionSet` (a gateway helper + a frontend mirror)
from the Spec-1 blast radius. A code investigation found TWO oracle-correctness
gaps in how REJECT cascades. Fixing them in the shared resolver corrects BOTH
surfaces; the agenda/gate UI (separate Spec 4) is then built on top of the
now-correct resolved set.

**Gap 1 — Shared-entity over-rejection.** `resolveBulkActionSet` walks the
blast radius transitively and is disposition-agnostic: rejecting an endpoint
rejects its whole downward closure, including a `logical_data_entity` it binds
(via the `endpoint_data_effects` edge) and that entity's attributes (via
`parent_child`). There is NO exclusivity check, so a shared entity still used by
surviving endpoints is wrongly killed. The only orphan logic that exists
(`would_be_orphaned_parent_ids`) is ADVISORY-ONLY and covers `parent_child`
(single-parent) edges, not the many-to-one relationship-row edges.

**Gap 2 — Dangling-relationship invisibility + stale status.** The
relationship-row candidate types are represented as EDGES (not nodes) in the
review model, so they are never in any entity's blast radius. When an entity is
rejected, the save-back (`candidateSaveBackService.ts`) correctly SKIPS
relationship rows whose endpoint no longer resolves (no dangling relationship
reaches the migration model), BUT (a) the relationship CANDIDATE's
`review_status` stays stale (still approved/pending though it will never be
saved), and (b) the drop is invisible in the review/confirm surfaces.

## Settled Framing (LOCKED — confirmed with the user; NOT re-litigated here)

- **Exclusivity (fixes gap 1):** a REJECT pulls in a downstream node reached via
  a many-to-one relationship-row edge ONLY when ALL of that node's referencing
  predecessors are (being) rejected, evaluated over
  {already-persisted-rejected} ∪ {this action's rejected seeds+cascade}. Shared
  nodes survive. `parent_child` cascade is UNCHANGED (single parent ⇒ trivially
  exclusive).
- **Relationship surfacing + marking (fixes gap 2):** when a node is rejected,
  the relationship-row candidates that reference it are (a) surfaced as cascade
  members so "+N relationships dropped" is real data, and (b) marked rejected so
  their status is no longer stale.
- **Shared foundation:** both the conversational confirm-gate and the grid's
  "Approve/Reject Filtered" consume `resolveBulkActionSet`; this fix corrects
  both. This spec ONLY makes the RESOLVED SET correct + surfaces relationships;
  agenda chunking / family bulk / gate UI is Spec 4.

## Confirmed Decisions (user, 2026-06-05)

All six shaper questions were confirmed at their recommended defaults. Locked:

1. **Referencer exposure = raw `edges` array.** Pass the raw `edges`
   (`from_id`/`to_id`/`edge_kind`/`relationship_candidate_id`) through to BOTH
   resolver mirrors; each builds its own in-adjacency at resolve time. NO
   precomputed referencer map / new discovery-service compute pass.
2. **Peer (entity↔entity) relationships: surface + mark the row, NEVER reject the
   far entity.** The five "owned-by" relationship-row edge kinds
   (`interface_logical_entities`, `endpoint_data_effects`,
   `logical_data_entity_physical_data_entities`,
   `logical_data_attribute_physical_data_attributes`, `data_movements`) cascade
   WITH exclusivity. `logical_data_entity_relationships` is peer-to-peer:
   rejecting one endpoint drops the relationship ROW (surface + mark rejected) but
   must NEVER pull the opposite entity into the reject set.
   **Physical symmetry (user addition):** the physical entity↔entity relationship
   (`physical_data_entity_relationships`) MUST get the identical peer treatment —
   drop the row, keep the far table. The implementer MUST verify how the physical
   relationship is represented (the `EdgeKind` enum lists
   `logical_data_entity_relationships`; confirm the physical equivalent's edge
   kind / representation) and apply the same peer rule wherever it is represented.
   If physical relationships are NOT currently review-model edges, surface that as
   a build-time finding — the peer rule still applies.
3. **Reject-only.** Exclusivity + relationship surfacing/marking apply ONLY to
   `rejected`. Approve and Defer cascade behaviour is unchanged.
4. **Mark dropped relationship rows `rejected` via the EXISTING atomic cascade
   endpoint.** Add the relationship candidates' ids to the flat `candidate_ids[]`
   the resolver yields; persist via the existing cascade bulk-review path. Same
   `rejected` status as a user reject (no distinct "auto-dangling" status). NO new
   AMS endpoint / DTO / changeset.
5. **Add a shared-fixture behavioral parity test** that runs one input through
   BOTH the gateway and frontend resolvers and diff-asserts identical output, in
   addition to per-mirror unit tests. The existing wire-shape contract test stays.
6. **Leave `would_be_orphaned_parent_ids` as-is** (already vestigial — hard-coded
   to `[]` at the grid; the new general exclusivity subsumes the single-parent
   case). Out of scope; do not remove (wire churn for zero behaviour change).

## Code Investigation — Findings (file:line)

### THE LOAD-BEARING QUESTION (resolved precisely)

**Does `resolveBulkActionSet` currently receive the raw edge graph (`edges` with
`from_id`/`to_id`/`edge_kind`), or ONLY the flattened, outgoing-only
`blast_radius[].dependents`?**

**Answer: ONLY the flattened `blast_radius[].dependents`. The raw edge graph is
NOT available to the resolver on either the gateway or the frontend side. It must
be added.** Evidence:

- The resolver's input type is `ReviewModelWire`, whose top-level keys are
  exactly `{ blast_radius, findings, aggregations }` —
  `gateway/src/services/discovery/reviewModelWire.ts:174-181`. There is NO
  `edges` (or `nodes`) field. The drift-guard manifest pins this:
  `REVIEW_MODEL_WIRE_FIELDS.model = ['blast_radius', 'findings', 'aggregations']`
  (`reviewModelWire.ts:197-206`).
- The resolver body reads ONLY `reviewModel.blast_radius`, `.findings`,
  `.aggregations` (`gateway/src/services/discovery/resolveBulkActionSet.ts:186-292`).
  Its cascade walk is a BFS over `entry.dependents` (the OUTGOING downward
  closure) — `resolveBulkActionSet.ts:223-238`. There is no in-edge / referencer
  structure anywhere in the function.
- The conversation hands the resolver a model narrowed by `toResolverModel`,
  which constructs `{ blast_radius, findings, aggregations }` and **explicitly
  drops `edges`** even though the full wire (`FullReviewModelWire`) HAS an
  `edges: ReviewModelEdge[]` field —
  `gateway/src/services/discoveryReviewConversation/reviewModelFull.ts:99-148`
  (edges field at 99-107 / 128-135; the narrowing cast at 142-148 omits it).
- The frontend mirror's input type is `ReviewModel` from
  `frontend/src/api/discoveryApi.ts:461-468` = `{ nodes, aggregations,
  blast_radius?, findings? }` — again **NO `edges`**. The frontend resolver reads
  only `blast_radius`/`findings`/`aggregations`
  (`frontend/src/components/Discovery/resolveBulkActionSet.ts:197-303`).

`blast_radius[].dependents` is computed by `downwardClosure` over an
OUT-adjacency map (`from_id`→`to_id`) — it is structurally outgoing-only and
loses the in-edge structure
(`discovery-service/src/services/reviewModel/computeBlastRadiusAndAggregations.ts:26-72`,
`83-146`). So even though the discovery-service review model HAS the full
`edges` array (`buildReviewModel.ts:399-423`, `types.ts:361-374`), neither
resolver mirror receives it.

**What must be added:** the review-model wire handed to the resolver must expose
the INCOMING relationship-row edges per node — either the raw `edges` array (so
each mirror builds its own in-adjacency / referencer map at resolve time) OR a
precomputed `referencers` map (node id → list of `{ referencer_node_id,
relationship_candidate_id, edge_kind }`). This touches: the resolver
`ReviewModelWire` (gateway), its `REVIEW_MODEL_WIRE_FIELDS` manifest + contract
test, `toResolverModel` (stop dropping the new field), the frontend `ReviewModel`
type, and — if a precomputed map is chosen — the discovery-service review model
(`types.ts` + a new compute pass) and AMS proxy passthrough. The raw `edges`
array already exists end-to-end in the discovery-service model; it is dropped
only at the resolver boundary, so plumbing it through is the smaller change.

### Open question groundings

**Q1 — which edge kinds get exclusivity.** The relationship-row edge kinds are
the six in `RELATIONSHIP_EDGE_KINDS`
(`discovery-service/src/services/reviewModel/types.ts:89-97`):
`interface_logical_entities`, `endpoint_data_effects`,
`logical_data_entity_physical_data_entities`,
`logical_data_attribute_physical_data_attributes`,
`logical_data_entity_relationships`, `data_movements`. `parent_child` is the
seventh `EdgeKind` and is structural/single-parent (`types.ts:80-87`) — excluded
from exclusivity (unchanged). Note `logical_data_entity_relationships` is a
peer-to-peer entity↔entity edge (sourceEntity→targetEntity,
`buildReviewModel.ts:319-335`): rejecting one of its endpoints rejecting the
OTHER endpoint would be surprising (the target entity may stand alone), so it is
a candidate for "surface + mark the relationship row, but never pull the far
endpoint into the reject set." Whether any relationship-row edge is genuinely
1:1 (exclusivity a no-op) is the substance of Q1.

**Q2 — reject-only vs also defer.** The action union is the three terminal
dispositions (`reviewModelWire.ts:80`). Approve cascade is benign (you cannot
over-approve a shared survivor). Defer is the open one.

**Q3 — node→relationship-candidate-id reverse lookup.** The
candidate-id↔edge correspondence ALREADY EXISTS:
`ReviewModelEdge.relationship_candidate_id` is the id of the relationship-ROW
candidate that produced the edge (`types.ts:199-213`, populated at
`buildReviewModel.ts:416-423`). So surfacing/marking does NOT require
reconstruction by name at resolve time — it requires the `edges` (or referencer
map) carrying `relationship_candidate_id` to reach the resolver (same plumbing as
the load-bearing question). With the edge graph present, a rejected node's
referencing relationship candidates = every edge whose `from_id` or `to_id` is
the rejected node, take its `relationship_candidate_id`.

**Q4 — already-persisted rejected status availability.** Each node carries
`review_status` (verbatim AMS persisted value) on `ReviewModelNode`
(`types.ts:146-182`, field at 158; frontend `discoveryApi.ts:503`). The
discovery-service blast-radius computation already reads it to seed
`rejectedNow` for the (advisory) orphan check
(`computeBlastRadiusAndAggregations.ts:104-107`). BUT the resolver's narrow
`ReviewModelWire` does NOT include `nodes` today (only `blast_radius`/`findings`/
`aggregations`) — so to compute the union {already-rejected ∪ this-action's
rejects} at resolve time, the resolver also needs node `review_status`. The
frontend `ReviewModel` DOES carry `nodes` (`discoveryApi.ts:462`); the gateway
resolver wire does not. This is a second wire-shape addition (node id +
`review_status`), parallel to the edge addition.

**Q5 — keeping the two resolver mirrors identical.** The gateway helper
(`gateway/src/services/discovery/resolveBulkActionSet.ts`) is the CANONICAL home;
the frontend file (`frontend/src/components/Discovery/resolveBulkActionSet.ts`)
is a declared byte-for-byte LOGIC MIRROR (both files' header comments state
this). Parity is currently held ONLY by a wire-shape CONTRACT TEST in
`gateway/src/services/discovery/__tests__/resolveBulkActionSet.test.ts:325-414`
(pins `REVIEW_MODEL_WIRE_FIELDS` against a built sample). There is NO frontend
resolver test file and NO test that runs one fixture through BOTH copies and
diff-asserts the output. So the contract test guards the wire SHAPE, not
algorithm parity — adding exclusivity + referencer logic to both copies is
unguarded against behavioral drift unless a shared-fixture parity test is added.

**Q6 — `would_be_orphaned_parent_ids` future.** This advisory field is consumed
NOWHERE behaviorally: the wire types carry it "for shape parity but NOT part of
the hard touched set" (`reviewModelWire.ts:99-113`,
`discoveryApi.ts:417-426`); `DiscoveryCandidateTable.tsx:891` hard-codes it to
`[]` when building a model; the resolver never reads it. It is computed in
`computeBlastRadiusAndAggregations.ts:113-137`. So folding it into the new
general exclusivity (which subsumes the single-parent case via `parent_child`
being trivially exclusive) vs leaving it as dead-but-harmless shape is a
low-stakes cleanup call.

### Save-back relationship skip + stale status (gap 2 confirmation)

The save-back is `mcp-server/src/services/candidateSaveBackService.ts`
(orchestration `saveDiscoveryCandidatesToModel`, line 2050). Relationship rows
are deferred to Pass-2 passes; an endpoint that no longer resolves yields
`{ row: null, ... }` and is SKIPPED (e.g. `endpoint_data_effects` resolver
returns `resolved: false` at lines ~1346-1366; `data_movements`
`skippedReason: 'source'` at ~1545). Only candidates that produced a
`candidateAction` get `review_status: 'committed'` (Step 11, lines 3328-3363).
A skipped relationship row is NOT in `candidateActions`, so its `review_status`
is never touched → stale (gap 2a). The marking fix is UPSTREAM of save-back: the
resolver adds the relationship candidate's id to the rejected set, and the
existing atomic cascade endpoint persists `review_status: 'rejected'` on it (see
below). No save-back change is required for the status-marking itself.

### Persistence path for the marked set (no new AMS work)

The resolved candidate-id set is persisted via the EXISTING atomic cascade
bulk-review endpoint:
- AMS: `DiscoveryCascadeReviewService` + `BulkReviewCascadeRequest`/`Response`
  (`architecture-model-service/.../service/discovery/DiscoveryCascadeReviewService.java`,
  DTOs under `.../model/dto/discovery/`).
- Gateway proxy: `POST .../runs/:runId/candidates/bulk-review`
  (`gateway/src/routes/discovery.ts:1388`), body
  `{ review_status, candidate_ids[] }`.
- The request takes a FLAT `candidate_ids[]` + `review_status`
  (`discoveryApi.ts:499-505`). So marking relationship candidates rejected =
  including their ids in the `candidate_ids[]` the resolver yields. No new
  endpoint / DTO is needed — only a more-complete id set.

## Visual Assets

No visual assets provided (pure backend / deterministic-logic spec — none
expected).

## Existing Code to Reference

- `gateway/src/services/discovery/resolveBulkActionSet.ts` — CANONICAL resolver
  (the seed→cascade walk to extend with exclusivity + referencer surfacing).
- `frontend/src/components/Discovery/resolveBulkActionSet.ts` — the byte-for-byte
  MIRROR to keep in lock-step.
- `gateway/src/services/discovery/reviewModelWire.ts` — the resolver input wire +
  `REVIEW_MODEL_WIRE_FIELDS` drift-guard manifest (extend for the new fields).
- `gateway/src/services/discoveryReviewConversation/reviewModelFull.ts` —
  `toResolverModel` (currently drops `edges`; must pass the new field through).
- `discovery-service/src/services/reviewModel/types.ts` — `EdgeKind`,
  `RELATIONSHIP_EDGE_KINDS`, `ReviewModelEdge.relationship_candidate_id`,
  `ReviewModelNode.review_status`, `BlastRadiusEntry`.
- `discovery-service/src/services/reviewModel/computeBlastRadiusAndAggregations.ts`
  — `downwardClosure` (outgoing-only) + the advisory orphan logic that reads
  `rejectedNow`.
- `discovery-service/src/services/reviewModel/buildReviewModel.ts` — where
  relationship rows become edges with `relationship_candidate_id`; the
  name→survivor resolution.
- `frontend/src/api/discoveryApi.ts` — frontend `ReviewModel` /
  `ReviewModelNode` / `BulkReviewCascadeRequest` wire types.
- `gateway/src/services/discovery/__tests__/resolveBulkActionSet.test.ts` — the
  existing wire-shape contract test (the only current parity guard).
- `mcp-server/src/services/candidateSaveBackService.ts` — the relationship-row
  skip + the `committed` status transition (gap-2 reference; no change needed
  for marking).
- `architecture-model-service/.../service/discovery/DiscoveryCascadeReviewService.java`
  + `gateway/src/routes/discovery.ts:1388` — the existing atomic persistence path.

## Requirements Summary

### Functional Requirements

1. Extend the review-model wire handed to BOTH resolver mirrors so each node's
   INCOMING relationship-row edges (referencers) are available at resolve time —
   carrying `from_id`/`to_id`/`edge_kind`/`relationship_candidate_id` (raw
   `edges` array, or an equivalent precomputed referencer map) PLUS each node's
   `review_status`.
2. In the resolver cascade walk, when a node would be pulled into the reject set
   via a many-to-one relationship-row edge, include it ONLY if ALL of its
   referencing predecessors (across the relevant edge kind) are in the reject set
   = {already-persisted rejected} ∪ {this action's rejected seeds + cascade}.
   `parent_child` cascade unchanged.
3. For every rejected node, surface its referencing relationship-row CANDIDATES
   (via `relationship_candidate_id`) as cascade members of the resolved set, and
   include their candidate ids so they are marked rejected through the existing
   atomic cascade endpoint.
4. Keep the gateway resolver and frontend mirror behaviorally identical; add
   focused unit tests on each mirror + the blast-radius/graph; add (or extend) a
   shared-fixture parity guard so exclusivity + referencer logic cannot drift
   between the two copies.

### Reusability Opportunities

- The candidate-id↔edge link (`relationship_candidate_id`) already exists in the
  discovery-service model — reuse, don't reconstruct by name.
- The atomic cascade bulk-review endpoint + gateway proxy already persist a flat
  `candidate_ids[]` set — reuse for marking; no new AMS endpoint.
- The discovery-service review model already builds the full `edges` array —
  reuse it; the only change is to stop dropping it at the resolver boundary (and
  expose node `review_status` to the gateway resolver wire).

### Scope Boundaries

**In Scope:**
- discovery-service (review-model graph / blast-radius + any in-edge/referencer +
  node-status exposure to the wire).
- gateway + frontend `resolveBulkActionSet` mirrors (exclusivity + relationship
  surfacing + marking), kept identical.
- The resolver input wire shape + its drift-guard/contract test (+ a behavioral
  parity guard).
- Pure/deterministic logic with focused unit tests.

**Out of Scope (Spec 4 / elsewhere):**
- Agenda chunking, family bulk actions, the confirm-gate UI.
- Any new AMS endpoint / DTO / changeset (the existing atomic cascade endpoint is
  reused).
- Save-back changes (the relationship-row skip is already correct; marking is
  upstream).

### Technical Considerations

- AMS / discovery-service speak snake_case at the wire (repo CLAUDE.md); the
  review model serializes verbatim with `JSON.stringify` — any new wire field is
  snake_case and the mirrors must match field-for-field.
- The resolver purity contract is load-bearing (no I/O / React / clock / global
  state; cycle-safe) — exclusivity + referencer logic must stay pure and
  cycle-safe.
- Both mirrors are deliberately separate copies (build-boundary); a shared
  fixture / contract test is the only safe parity mechanism.
