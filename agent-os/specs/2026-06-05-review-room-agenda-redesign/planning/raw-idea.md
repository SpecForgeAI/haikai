# Review-Room Agenda Redesign

Redesign how the Discovery Review Room (the conversational "Architecture Room" / Architect-persona candidate review) organizes candidates into review chunks, adds bulk actions, and gates writes. Fixes three real-stack defects (triage points 1, 2b, 3).

## Problems being fixed
1. **No per-chunk bulk action** — a chunk of 15 rows has only per-row Approve/Reject/Defer; no "Approve all".
2. **Double-confirm on a single non-cascading row** — approving one row pops a separate "Confirm & apply" gate even when there is nothing cascaded, forcing two clicks for one decision.
3. **Arbitrary "random pages of 15"** — the agenda is flattened across sections and sliced every 15 items, mixing unrelated candidates; the parent of an attribute is in a different chunk than the attribute.

## Current behavior (root causes, from code investigation)
- `gateway/src/services/discoveryReviewConversation/agendaSequencer.ts` builds a flat agenda ordered by section (live conflicts → high-blast-radius → remaining-by-type → findings → cross-scan links) then slices it into `DEFAULT_CHUNK_SIZE = 15` chunks bounded only by the (section, scanScope) boundary. Parent→child relationships are NOT used for grouping.
- The review model (`reviewModelFull.ts`) already carries `edges` including `edge_kind === 'parent_child'` (from_id=parent, to_id=child) and blast-radius dependents tagged with `via_edge_kind` — but the sequencer ignores parent_child edges for grouping (only uses them for the cross-scan section).
- Chunk turns (`reviewTurnShape.ts` `ChunkSummaryTurn`) carry only `items: ChunkItemRef[]` — no bulk-action flag, no parent/children metadata.
- The frontend (`frontend/src/components/Discovery/DiscoveryReviewRoom.tsx`) renders only per-row action buttons; there is no chunk-level bulk control anywhere in the codebase.
- The confirm gate (`reviewConversationCoordinator.ts` `openConfirmationGate`) is UNCONDITIONAL — every apply-decision appends a pending-confirmation turn regardless of whether anything cascades.

## Settled design (all decisions confirmed with the user)
1. **Parent-family chunks.** Each chunk = ONE parent (logical_data_entity / interface / service) + ALL its children (logical_data_attributes / endpoints), grouped via the existing `parent_child` edges. Families ordered by the existing priority intent (live conflicts → high-impact → by type/name). True orphans (no parent, no children) grouped by type into chunks AFTER the families. Cross-scan links remain their own section.
2. **One chunk per family regardless of size** — a 40-attribute entity is one (scrollable) chunk; never split a family across chunks (splitting defeats "approve the family once"). A "show more" expander inside a very large family is acceptable but the family stays one approvable unit.
3. **Always-present family-level bulk action** — every family chunk gets Approve-all / Reject-all / Defer-all for the whole family. Per-row Approve/Reject/Defer remain for granular control.
4. **Cascade-aware confirm gate (the key rule).** Show the "Confirm & apply" gate ONLY when the action would touch candidates NOT visible on screen (hidden blast-radius beyond the chunk). SKIP the gate (apply immediately on the click — the click IS the confirmation) when (a) it is a single row with no cascade, OR (b) the family chunk already shows the seed + ALL its affected candidates and the user hits "Approve all" — because re-confirming would be asking for the exact same response twice. When the gate IS shown, it carries a "+N beyond this family" summary. This deliberately relaxes the prior "every mutation is gated / no low-stakes fast path" property — the user has authorized this relaxation because the explicit click is itself a deliberate confirmation.

## Scope
- **Gateway**: `agendaSequencer.ts` (family grouping + chunking), `reviewTurnShape.ts` (chunk-bulk + parent/children metadata on the turn shape; chunk-bulk intent), `reviewConversationCoordinator.ts` (cascade-aware confirm-skip + chunk-bulk intent handling).
- **Frontend**: `DiscoveryReviewRoom.tsx` (family rendering with parent + indented children, family-level bulk button, immediate-apply path when no confirm needed).
- **No AMS change** — the apply path was already made architecture-scoped + atomic in the just-shipped 404 fix; this spec inherits it.

## Out of scope
- Scan selection / multi-service tiering (that is the separate spec ⑤).
- Any AMS endpoint change.
- The duplicate-attribute dedupe (already shipped as a direct fix in discovery-service).
