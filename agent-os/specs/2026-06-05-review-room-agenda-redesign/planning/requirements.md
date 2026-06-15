# Spec Requirements: Review-Room Agenda Redesign

## Initial Description

Redesign how the Discovery Review Room (the conversational "Architecture Room" /
Architect-persona candidate review) organizes candidates into review chunks, adds
bulk actions, and gates writes. Fixes three real-stack defects:

1. **No per-chunk bulk action** — a chunk of 15 rows has only per-row
   Approve/Reject/Defer; no "Approve all".
2. **Double-confirm on a single non-cascading row** — approving one row pops a
   separate "Confirm & apply" gate even when there is nothing cascaded, forcing
   two clicks for one decision.
3. **Arbitrary "random pages of 15"** — the agenda is flattened across sections
   and sliced every 15 items, mixing unrelated candidates; the parent of an
   attribute lands in a different chunk than the attribute.

(Full description in `planning/raw-idea.md`.)

## Settled Design (LOCKED — confirmed with the user; NOT re-opened here)

1. **Parent-family chunks.** Each chunk = ONE parent (logical_data_entity /
   interface / service) + ALL its children (logical_data_attributes / endpoints),
   grouped via the existing `parent_child` edges. Families ordered by the existing
   priority intent (live conflicts → high-impact → by type/name). True orphans
   (no parent, no children) grouped by type into chunks AFTER the families.
   Cross-scan links remain their own section.
2. **One chunk per family regardless of size** — a 40-attribute entity is one
   (scrollable) chunk; never split a family across chunks. A "show more" expander
   inside a very large family is acceptable, but the family stays one approvable
   unit.
3. **Always-present family-level bulk action** — every family chunk gets
   Approve-all / Reject-all / Defer-all for the whole family. Per-row
   Approve/Reject/Defer remain for granular control.
4. **Cascade-aware confirm gate (the key rule).** Show the "Confirm & apply" gate
   ONLY when the action would touch candidates NOT visible on screen (hidden
   blast-radius beyond the chunk). SKIP the gate (apply on the click — the click
   IS the confirmation) when (a) a single row with no cascade, OR (b) the family
   chunk already shows the seed + ALL its affected candidates and the user hits
   "Approve all". When the gate IS shown it carries a "+N beyond this family"
   summary. This deliberately relaxes the prior "every mutation is gated" property;
   the user has authorized the relaxation.

## Confirmed Decisions (user, 2026-06-05)

All six first-round questions (below) were confirmed at their recommended
defaults; the chunk-grouping shape and the Spec A dependency are also locked:

- **Q1 (orphans):** a node with no `parent_child` edge is an orphan, chunked by
  type AFTER families; families stay strictly structural (parent_child only — NOT
  relationship-row edges).
- **Q2 (confirm-skip test):** SERVER-SIDE — the coordinator re-derives the family
  (seed parent + its `parent_child` children) and skips the gate iff the resolved
  touched set ⊆ that derived family. No client-sent visible-id list.
- **Q3 (cascade escaping the family):** show the gate with "+N beyond this
  family" (anything off-screen gets the gate).
- **Q4 (child sub-order):** conflicts-first, then alphabetical by name.
- **Q5 (family with a live conflict):** the whole family ranks up into the
  conflicts band and stays ONE intact chunk; the conflicted member sorts to the
  top of its family (Q4) — never hoisted into a separate section.
- **Q6 (findings):** findings stay their own `findings-by-severity` section; not
  folded into families (this spec).

- **Chunk grouping = TWO-LEVEL structural families.** A chunk = one parent + its
  DIRECT `parent_child` children only (interface + its endpoints; entity + its
  attributes; physical entity + its columns). It is NOT a four-level
  `interface → endpoint → entity → attribute` data-flow nesting — an endpoint and
  the entity it binds are SEPARATE families (their link is a data-binding cascade
  surfaced via the confirm gate, not structural nesting). A shared entity is thus
  reviewed exactly once in its own family.

- **Spec A dependency (the foundation is now BUILT + verified).** This spec builds
  ON TOP of the now-correct `resolveBulkActionSet` from Spec A (reject-cascade
  correctness). Consequences for the confirm gate — IN SCOPE here (display only;
  do NOT change Spec A's resolver):
  - For a REJECT action the resolved touched set now (a) EXCLUDES shared entities
    (only exclusively-orphaned downstream is pulled in) and (b) INCLUDES the
    relationship-row candidates referencing rejected nodes (Spec A surfaces +
    marks them). The gate's "+N beyond this family" summary MUST surface these,
    distinguishing the relationship-row drops as a separate "+N relationships
    dropped" figure (relationship rows are not rendered inside any family chunk).
  - Confirm-skip interaction: because Spec A surfaces relationship rows on REJECT
    (reject-only), a family REJECT will typically NOT be "fully visible" (the
    relationship rows sit outside the chunk) → the gate SHOWS with the
    relationship-drops summary. A family APPROVE (no relationship surfacing) can
    still skip the gate when fully visible. This is the intended, correct
    behaviour — the user explicitly wanted to SEE relationship drops on reject.

## Scope (from raw idea)

- **Gateway**: `agendaSequencer.ts` (family grouping + chunking),
  `reviewTurnShape.ts` (chunk-bulk + parent/children metadata on the turn shape;
  chunk-bulk intent), `reviewConversationCoordinator.ts` (cascade-aware
  confirm-skip + chunk-bulk intent handling).
- **Frontend**: `DiscoveryReviewRoom.tsx` (family rendering with parent + indented
  children, family-level bulk button, immediate-apply path when no confirm needed).
- **No AMS change** — the apply path is already architecture-scoped + atomic
  (`candidates/bulk-review-cascade`); this spec inherits it.

### Out of Scope (from raw idea)

- Scan selection / multi-service tiering (separate spec ⑤).
- Any AMS endpoint change.
- The duplicate-attribute dedupe (already shipped in discovery-service).

## Codebase Grounding (verified by reading the source)

### The `parent_child` edge — the load-bearing assumption

`parent_child` edges are built in
`discovery-service/src/services/reviewModel/buildReviewModel.ts` PURELY from
`child.parentCandidateId` being set AND the parent surviving as a node
(`structuralChildren` loop → "drop when parent not a node"). So family grouping
holds exactly where candidate emitters stamp `parentCandidateId`. Verified per
source:

- **Java DTO entities → attributes**:
  `springClassic/index.ts` `emitLogicalEntityFromDtoClass` emits each
  `logical_data_attributes` with the entity's `logical.id` as parent. Parented.
- **Java inbound REST controller → endpoints**:
  `springClassic/index.ts` (~line 871) emits `endpoints` with
  `interfaceCandidateId` as parent. Parented.
- **Java outbound REST (RestTemplate / WebClient) endpoints** (~lines 1721/1750)
  and **scheduled/messaging endpoints** (~line 1603): emitted with NO parent —
  they belong to no controller interface. These are correctly ORPHANS (grouped by
  type after families).
- **SOAP (springClassicSoap)**: `soapEndpointEmitter.ts` sets endpoint
  `parentCandidateId: ifaceId`; `messageEntityEmitter.ts` sets attribute
  `parentCandidateId: parentEntityId`. Parented.
- **WADL / XSD**: `contractCandidates.ts` `runWadlCandidatePass` /
  `runXsdCandidatePass` build `interfaces`+`endpoints` (endpoint→interface via
  `parentCandidateId`, ~line 157) and `logical_data_entities`+
  `logical_data_attributes` (attribute→entity) candidates, and
  `runContractCandidatePasses` pushes them into the candidate stream. Parented.
  NOTE: the bare WADL *finding* emitter (`restWadl/wadlEndpointEmitter.ts`) emits
  `endpoint` / `interface_definition` FINDINGS (not candidates). Those carry no
  `parentCandidateId` and never become family nodes — they live in the findings
  arm. The candidate path (contractCandidates) is what populates family nodes.

**Conclusion**: parent_child coverage is reliable for the family-bearing cases;
the genuinely-parentless cases (outbound/scheduled endpoints, top-level entities
with no fields) are real orphans and the settled "orphans grouped by type after
families" rule already covers them. Open question Q1 narrows to the explicit
fallback ordering for parentless nodes + a sanity check on whether any *inbound*
family is expected to be missing parents.

### Blast radius already walks parent_child (relevant to the confirm-gate skip)

`computeBlastRadiusAndAggregations.ts` `downwardClosure` follows ALL edges incl.
`parent_child` (parent → child). So a PARENT's `blast_radius.dependents` already
contains its children. This means: for an "Approve-all family" seeded from the
parent, the resolved touched set (`resolveBulkActionSet`) = parent + children
(+ any of their further dependents). The confirm-skip test (Q2) is therefore
"is the resolved touched set ⊆ the ids rendered in the family chunk?".

### Where the confirm gate lives today (relevant to Q2)

- `reviewConversationCoordinator.ts` `openConfirmationGate` is UNCONDITIONAL: every
  apply-decision computes `preview(...)` (= `resolveBulkActionSet`) and appends a
  `pending-confirmation` turn. The skip logic must be added HERE.
- The `/capture` `propose-intent` route + `captureDeterministicTurn` carry
  `{ intent, userText }` only — they do NOT currently carry the set of ids
  visible in the active chunk. So either (a) the frontend passes a
  `visibleCandidateIds` set with the propose-intent, or (b) the coordinator
  re-derives the family membership for the seed (parent + its parent_child
  children) and compares the resolved touched set against THAT. Both are feasible;
  this is a real design choice (Q2).

### Turn shape (what must change in `reviewTurnShape.ts`)

`ChunkSummaryTurn` carries `items: ChunkItemRef[]` + `section`/`scanScope`/cursor
only — no notion of a family (parent id, child grouping) and no bulk-action flag.
A family-aware chunk shape (parent ref + children refs, or a `familyParentId` on
the chunk) plus a family-bulk intent will be needed. `ProposedReviewIntent`
`apply-decision` already takes `seedCandidateIds: string[]`, so a family-bulk
apply is representable by seeding the parent id (cascade pulls the children) OR by
seeding all family ids explicitly — a small choice tied to Q2.

### Apply path (confirms "no AMS change")

`reviewDecisionOrchestrator.applyDecision` → AMS
`candidates/bulk-review-cascade`. Atomic + architecture-scoped already. The
family-bulk seed set flows straight into this unchanged.

## Requirements Discussion

### First Round Questions (ANSWERED 2026-06-05 — authoritative answers in "Confirmed Decisions" above; originals kept below for traceability)

**Q1 — Parentless-node fallback grouping.** The whole redesign keys families off
`parent_child` edges, which exist only where a candidate carries
`parentCandidateId`. Verified: Java DTO attributes, inbound REST controller
endpoints, SOAP endpoints/attributes, and WADL/XSD contract candidates all set
it; outbound/scheduled REST endpoints and field-less top-level entities do NOT
(they are genuine orphans). Proposed handling: a node with no `parent_child` edge
in EITHER direction is an orphan and is chunked into a by-type group AFTER all
families (exactly the settled rule), with no special "synthetic parent" attempt.
Is that the intended behaviour, or do you want any reachable non-parent_child
relationship (e.g. an `interface_logical_entities` edge) to also pull a node into
a family? (Recommendation: orphans-by-type only; do NOT use relationship-row
edges for family grouping — keep families strictly structural parent_child.)
**Answer:** _pending_

**Q2 — Where the "fully visible in the chunk" test lives at apply time.** To
decide whether to skip the confirm gate, the coordinator must compare the
resolved touched set against what is on screen. Two options:
(A) the frontend sends a `visibleCandidateIds` array on the `propose-intent`
capture, and the coordinator skips the gate iff `resolvedTouchedSet ⊆
visibleCandidateIds`; or
(B) the coordinator re-derives the family (seed parent + its `parent_child`
children) server-side and skips iff the resolved touched set ⊆ that derived
family. Option B keeps the skip rule deterministic server-side and immune to a
stale/incorrect client list, but assumes the chunk on screen == the derived
family (true given one-chunk-per-family). Which do you prefer?
(Recommendation: B — derive server-side; it is the safer oracle property and
needs no new client→server field.)
**Answer:** _pending_

**Q3 — A child whose OWN cascade escapes the family.** Confirm the settled rule's
edge case: e.g. an endpoint in the family has an `endpoint_data_effects` edge to a
`logical_data_entity` that sits in a DIFFERENT family. An "Approve-all family"
then resolves to {family} + {that outside entity (+ its dependents)}. Per the
settled rule this is NOT fully visible, so the gate SHOWS with "+N beyond this
family". Confirm that is what you want (rather than, say, silently including the
outside entity). The code makes this easy — the resolver already returns the full
transitive set, so the +N is just `resolvedTouchedSet − familyVisibleIds`.
**Answer:** _pending_

**Q4 — Sub-ordering of children within a family chunk.** Parent first is settled.
For the children beneath it, what order? Options: (a) conflicts-first then by
name; (b) strictly by name; (c) by severity/blast then name. (Recommendation:
conflicts-first, then alphabetical by name — surfaces the items that need a
human decision at the top of the family, consistent with the agenda's
conflicts-first spirit.)
**Answer:** _pending_

**Q5 — A family that contains a live conflict on the parent or a child.** Families
are ordered conflicts-first. Does a conflicted MEMBER pull its WHOLE family up to
the conflicts position (i.e. family ordering rank = "does any member have a live
conflict?"), keeping the family intact as one chunk? Or should conflicts still be
hoisted into a separate conflicts-only section ahead of families (which would
split a conflicted child away from its parent)? The settled "never split a family"
rule argues for the former. (Recommendation: rank the family by its
highest-priority member — any live conflict in the family ranks it in the
conflicts band — and keep the family whole; do NOT hoist individual conflicted
children into a separate section.)
**Answer:** _pending_

**Q6 — Findings.** Today the agenda has a separate `findings-by-severity` section.
Do findings stay their own section (simplest; families are candidate-only), or
should a finding that links to a candidate in a family (via
`candidate_link_ids`) fold INTO that family's chunk? Note WADL/REST contract
endpoints can ALSO appear as `endpoint` *findings* (separate from the endpoint
candidates). (Recommendation: keep findings as their own
`findings-by-severity` section for this spec — folding findings into families is
a larger change and the linked-finding cascade is already handled at apply time;
revisit folding separately if needed.)
**Answer:** _pending_

### Existing Code to Reference

**Files central to this change (read + confirmed):**
- Gateway sequencer: `gateway/src/services/discoveryReviewConversation/agendaSequencer.ts`
- Turn shape: `gateway/src/services/discoveryReviewConversation/reviewTurnShape.ts`
- Coordinator + gate: `gateway/src/services/discoveryReviewConversation/reviewConversationCoordinator.ts`
- Review routes: `gateway/src/routes/discoveryReviewConversation.ts`
- Cascade resolver (canonical): `gateway/src/services/discovery/resolveBulkActionSet.ts`
- Cascade resolver (frontend mirror): `frontend/src/components/Discovery/resolveBulkActionSet.ts`
- Frontend room: `frontend/src/components/Discovery/DiscoveryReviewRoom.tsx`
- Review-model builder (parent_child source of truth):
  `discovery-service/src/services/reviewModel/buildReviewModel.ts`
- Blast-radius / aggregations:
  `discovery-service/src/services/reviewModel/computeBlastRadiusAndAggregations.ts`
- Parent-link emitters: `springClassic/index.ts`,
  `springClassicSoap/{soapEndpointEmitter,messageEntityEmitter}.ts`,
  `findings/packFindingScanners/contractCandidates.ts`

**Patterns to reuse:**
- The existing always-actionable `ChunkSummaryView` per-row Approve/Reject/Defer
  buttons in `DiscoveryReviewRoom.tsx` — extend with a family-level bulk control
  + indented children, do NOT rebuild.
- The grid's confirm modal `BulkFindingActionConfirmModal.tsx` (and the
  in-flight `2026-05-28-bulk-findings-actions` spec) for the "+N beyond" summary
  styling precedent.

### Follow-up Questions

_None yet._

## Visual Assets

No visual assets provided (checked `planning/visuals/` — none present).

## Requirements Summary

### Functional Requirements

- Group review candidates into parent-family chunks (one parent + all its
  `parent_child` children) instead of flat 15-item slices.
- One chunk per family regardless of size; a large family may have an in-chunk
  "show more" expander but stays one approvable unit.
- Add always-present family-level Approve-all / Reject-all / Defer-all controls
  alongside the existing per-row controls.
- Make the confirm gate cascade-aware: skip it (apply on click) when the touched
  set is fully visible in the chunk; show it (with "+N beyond this family") when
  the action reaches hidden candidates.
- Order families by the existing priority intent (conflicts → high-impact →
  by type/name); orphans grouped by type AFTER families; cross-scan links last.

### Reusability Opportunities

- Extend the existing `ChunkSummaryView` rather than rebuilding the renderer.
- Reuse the canonical `resolveBulkActionSet` for the touched-set computation that
  drives the confirm-skip decision (no new cascade logic).
- Reuse the `bulk-review-cascade` AMS apply path unchanged.

### Scope Boundaries

**In Scope:** gateway sequencer/turn-shape/coordinator changes + frontend room
family rendering, bulk control, and immediate-apply path.

**Out of Scope:** scan selection / multi-service tiering (spec ⑤), AMS endpoint
changes, duplicate-attribute dedupe (already shipped).

### Technical Considerations

- Family grouping is a pure re-derivation over the EXISTING review-model
  `edges` (`edge_kind === 'parent_child'`) + nodes; no new discovery-service or
  AMS computation (consistent with the Spec 1 "no new computation" contract).
- The confirm-skip decision needs the visible-id set at apply time — resolved
  either by passing visible ids from the frontend on `propose-intent` or by
  re-deriving family membership in the coordinator (Q2).
- The apply path (`bulk-review-cascade`) and the cascade resolver are unchanged.
