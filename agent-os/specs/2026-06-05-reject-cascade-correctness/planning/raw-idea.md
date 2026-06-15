# Reject-Cascade Correctness (the oracle foundation for the Review-Room work)

## Why
The Discovery Review Room (conversational) AND the discovery candidate grid both apply Approve/Reject/Defer dispositions across a cascade computed by `resolveBulkActionSet` (gateway + a frontend mirror) from the Spec-1 blast-radius. A code investigation found TWO oracle-correctness gaps in how REJECT cascades. Fixing them in the shared resolver corrects BOTH surfaces; the agenda/gate UI (separate Spec ④) is then built on top of the now-correct resolved set.

## The two gaps (verified in code)
1. **Shared-entity over-rejection.** `resolveBulkActionSet` walks the blast-radius transitively and is disposition-agnostic: rejecting an endpoint rejects its whole downward closure — including the `logical_data_entity` it binds (via the `endpoint_data_effects` edge) and that entity's attributes (via `parent_child`). There is NO exclusivity check. If that entity is ALSO used by other (surviving) endpoints, it is STILL rejected — wrongly killing it for the others. The only orphan logic that exists (`would_be_orphaned_parent_ids` in `computeBlastRadiusAndAggregations.ts`) is ADVISORY-ONLY and covers `parent_child` (single-parent) edges, not the many-to-one relationship-row edges.

2. **Dangling-relationship invisibility + stale status.** The relationship-row candidate types (`logical_data_entity_relationships`, `physical_data_entity_relationships`, `interface_logical_entities`, `endpoint_data_effects`) are represented as EDGES (not nodes) in the review model, so they are never in any entity's blast radius. When an entity is rejected, the save-back (`candidateSaveBackService.ts`) DOES correctly skip relationship rows whose endpoint no longer resolves (no dangling relationship reaches the migration model), BUT: (a) the relationship CANDIDATE's `review_status` stays stale (still approved/pending though it will never be saved), and (b) the drop is invisible in the review/confirm surfaces.

## Settled framing (confirmed with the user)
- **Exclusivity (fixes gap 1):** a REJECT pulls in a downstream node reached via a many-to-one relationship-row edge ONLY when ALL of that node's referencing predecessors are (being) rejected — evaluated over {already-persisted-rejected} ∪ {this action's rejected seeds}. Shared nodes survive. `parent_child` cascade is UNCHANGED (an attribute has a single parent, so it is trivially exclusive — rejecting the entity still rejects its attributes). Reject-specific: approve/defer cascade behaviour is unchanged unless the shaper finds a reason otherwise.
- **Relationship surfacing + marking (fixes gap 2):** when a node is rejected, the relationship-row candidates that reference it are (a) surfaced as cascade members so "+N relationships dropped" is real data a gate/grid can display, and (b) marked rejected, so their status is no longer stale (consistent with the save-back skip that already happens).
- **Shared foundation:** both the conversational confirm-gate and the grid's "Approve/Reject Filtered" consume `resolveBulkActionSet`, so this fix corrects both. This spec ONLY makes the RESOLVED SET correct + surfaces relationships; the agenda chunking / family bulk / gate UI is Spec ④ (built afterwards, on top of this).

## Key files
- `discovery-service/src/services/reviewModel/computeBlastRadiusAndAggregations.ts` — blast-radius downward closure + the `would_be_orphaned_parent_ids` advisory.
- `discovery-service/src/services/reviewModel/types.ts` — the `EdgeKind` enum (7 kinds + directions): parent_child, interface_logical_entities, endpoint_data_effects, logical_data_entity_physical_data_entities, logical_data_attribute_physical_data_attributes, logical_data_entity_relationships, data_movements.
- `gateway/src/services/discovery/resolveBulkActionSet.ts` AND the frontend mirror `frontend/src/components/Discovery/resolveBulkActionSet.ts` — the seed→cascade expansion that applies dispositions; where exclusivity must be enforced. (BOTH mirrors must stay in lock-step.)
- `discovery-service/.../candidateSaveBackService.ts` — the save-back relationship-resolution skip (already correct; the relationship-status-marking change relates here).
- The relationship-row candidate types + how a relationship row names the two entities it connects (the from/to reference, by name or id).

## Open design questions (for the shaper to ground in code + the user to decide)
1. Which edge kinds get the exclusivity check — confirm it is ALL the many-to-one relationship-row edges (endpoint_data_effects, interface_logical_entities, logical→physical, logical-attr→physical-attr, data_movements) and NOT parent_child.
2. Reject-only, or also Defer? (Approve cascade is benign.)
3. WHERE the exclusivity logic lives. The blast-radius is precomputed + disposition-agnostic, but exclusivity depends on the CURRENT reject set, so it must be applied at resolve time in `resolveBulkActionSet` — which needs each node's INCOMING relationship-row edges to test "are all my referencers rejected?". Does the resolver currently have the edge graph (or only the flattened blast-radius dependents)? If only the latter, the review model may need to expose in-edges (or a referencer map). Ground this precisely.
4. How relationship-rows are surfaced: a reverse lookup from a rejected node to the relationship-row CANDIDATES (by id) whose from/to references it, added to the reject set + marked rejected.
5. Confirm the exclusivity evaluates over {already-rejected ∪ this-action's-rejects} together (a node is orphaned only if ALL referencers fall in that union).

## Scope
- discovery-service (blast-radius/graph + any in-edge/referencer exposure + save-back relationship status), gateway + frontend (`resolveBulkActionSet` mirrors kept identical). Pure/deterministic logic with focused unit tests on each mirror + the blast-radius.
- OUT of scope: agenda chunking, family bulk actions, the confirm-gate UI (that is Spec ④, built after this). This spec stops at "the resolved set is correct + relationships surfaced/marked."
