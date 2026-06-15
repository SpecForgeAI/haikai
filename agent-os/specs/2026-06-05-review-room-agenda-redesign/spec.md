# Specification: Review-Room Agenda Redesign

## Goal

Re-organize the Discovery Review Room agenda from flat 15-item slices into
parent-family chunks, add an always-present family-level bulk action, and make the
confirmation gate cascade-aware (skip it when the touched set is fully visible on
screen; show it with a "+N beyond this family" / "+N relationships dropped" summary
when the action reaches hidden candidates). Gateway + frontend only; no AMS change;
builds on top of Spec A's already-correct `resolveBulkActionSet`.

## User Stories

- As an architect reviewing discovery candidates, I want each chunk to be one
  parent plus its direct children (interface + endpoints; entity + attributes;
  physical entity + columns) so the parent and its children are reviewed together,
  not scattered across "random pages of 15".
- As an architect, I want a single Approve-all / Reject-all / Defer-all control on
  each family so I can disposition the whole family in one click instead of clicking
  every row.
- As an architect, I want the "Confirm & apply" gate to appear ONLY when my action
  touches candidates I cannot see on screen, so a self-contained decision is one
  click — but a reject that drops off-screen relationship rows still shows me what is
  going away first.

## Specific Requirements

**1. Parent-family chunks (TWO-LEVEL structural grouping)**
- Replace the flat `buildAgenda` → `getReviewChunk` slicing in
  `agendaSequencer.ts` (currently `DEFAULT_CHUNK_SIZE = 15` bounded only by the
  `(section, scanScope)` group) with family-aware grouping.
- A family = ONE parent node + its DIRECT `parent_child` children, derived from the
  existing review-model `edges` where `edge_kind === 'parent_child'`
  (`from_id` = parent, `to_id` = child). The sequencer currently ignores
  `parent_child` for grouping — it must now consume those edges.
- TWO-LEVEL only: an interface+endpoints, an entity+attributes, or a physical
  entity+columns. NOT a four-level `interface → endpoint → entity → attribute`
  data-flow nesting. An endpoint and the entity it binds are SEPARATE families
  (their link is a data-binding cascade surfaced by the confirm gate, not structural
  nesting). A shared entity is reviewed exactly once, in its own family.
- ONE chunk per family regardless of size; never split a family across chunks. A
  large family MAY render an in-chunk "show more" expander, but the family stays one
  approvable unit.
- Orphans (nodes with no `parent_child` edge in either direction) are grouped by
  `candidate_type` into chunks AFTER all families. Outbound/scheduled REST endpoints
  and field-less top-level entities are the expected orphan cases (verified: those
  emitters set no `parentCandidateId`); no synthetic-parent attempt.
- Families are strictly structural — `parent_child` only; relationship-row edges
  (`interface_logical_entities`, `endpoint_data_effects`, etc.) MUST NOT pull a node
  into a family.

**2. Family ordering + child sub-ordering**
- Order families by the existing priority intent: conflicts-first → high-impact
  (non-empty `blast_radius`) → then by type/name.
- A family's ordering rank = "does ANY member (parent or child) have a live
  conflict?" — a family with any live-conflict member ranks up into the conflicts
  band and stays ONE intact chunk. Conflicted members are NEVER hoisted into a
  separate conflicts-only section that would split them from their parent.
- Within a family: parent first, then children sub-ordered conflicts-first, then
  alphabetical by name.
- Cross-scan logical↔physical links remain their own `cross-scan-links` section
  (LAST), unchanged. Findings remain their own `findings-by-severity` section
  (NOT folded into families in this spec).

**3. Always-present family-level bulk action**
- Every family chunk gets Approve-all / Reject-all / Defer-all for the WHOLE family,
  alongside the existing per-row Approve/Reject/Defer controls.
- The family bulk is representable on the existing `apply-decision` intent
  (`seedCandidateIds: string[]`) by seeding the parent id (cascade pulls the
  children via `parent_child`) OR by seeding all family ids — a small choice tied to
  the confirm-skip gate logic (Requirement 4); pick the representation that makes the
  server-side `resolvedTouchedSet ⊆ derivedFamily` test exact.
- The family-bulk seed flows unchanged into `reviewDecisionOrchestrator.applyDecision`
  → AMS `candidates/bulk-review-cascade`. No new apply path.

**4. Cascade-aware confirm gate (the key rule)**
- `openConfirmationGate` in `reviewConversationCoordinator.ts` is UNCONDITIONAL
  today (every apply-decision appends a `pending-confirmation` turn). Add the skip
  branch HERE.
- SHOW the gate only when the resolved touched set is NOT fully visible on screen.
  SKIP it (apply on the click — the click IS the confirmation) when (a) a single row
  with no cascade, OR (b) a family bulk where `resolvedTouchedSet ⊆` the family's
  rendered ids.
- The confirm-skip test is SERVER-SIDE (Confirmed Decision Q2): the coordinator
  re-derives the family (seed parent + its `parent_child` children from the model)
  and skips iff `resolvedTouchedSet ⊆ derivedFamily`. NO client-sent
  `visibleCandidateIds` list. This keeps the rule deterministic and immune to a
  stale client list, and is sound because one-chunk-per-family means the rendered
  chunk == the derived family.
- When the gate IS shown, its summary carries the off-screen overage:
  `resolvedTouchedSet − derivedFamily`, surfaced as "+N beyond this family".
- This deliberately relaxes the prior "every mutation is gated" property (the
  `openConfirmationGate` doc comment + the coordinator header both assert "EVERY
  mutation is gated / NO low-stakes fast path"); the user has authorized the
  relaxation. Update those comments to describe the new conditional behaviour.

**5. Spec A interaction — surface relationship drops in the gate summary (DISPLAY ONLY)**
- Do NOT modify Spec A's `resolveBulkActionSet` or its wire — Spec A owns them and
  they are built + verified. This spec reads its output.
- For a REJECT, Spec A's resolver now (a) EXCLUDES shared entities (only
  exclusively-orphaned downstream is pulled in) and (b) INCLUDES the relationship-row
  candidates referencing rejected nodes (folded into `resolved.candidates`, tagged
  `via_edge_kind` ∈ the six relationship-row kinds).
- The gate summary MUST distinguish two figures: "+N entities/candidates beyond this
  family" (resolved non-relationship-row candidates outside the family) and a
  SEPARATE "+N relationships dropped" (resolved candidates whose `via_edge_kind` is a
  relationship-row kind). Relationship rows are not rendered inside any family chunk,
  so they always count as off-screen.
- Consequence (intended): because relationship surfacing is reject-only, a family
  REJECT typically will NOT be fully visible → the gate SHOWS with the
  relationship-drops summary. A family APPROVE (no relationship surfacing) can still
  skip when fully visible. This is correct — the user explicitly wanted to SEE
  relationship drops on reject.

**6. Extend the turn shape for family awareness**
- `ChunkSummaryTurn` in `reviewTurnShape.ts` carries `items: ChunkItemRef[]` +
  `section` / `scanScope` / `cursor` / `nextCursor` / `agendaTotal` only — no family
  notion and no bulk flag. Extend it for family awareness: a parent ref + children
  refs, or a `familyParentId` identifying the parent within `items`, plus a
  family-bulk flag/intent the frontend renders the bulk control from.
- Keep the change additive to the closed `ReviewTurn` union; the new fields must be
  optional so non-family chunks (orphan-by-type, findings, cross-scan) still
  validate. Existing `ChunkItemRef.conflicts` (live-conflict facts) is untouched.

**7. Frontend family rendering + immediate-apply path**
- Extend the existing `ChunkSummaryView` in `DiscoveryReviewRoom.tsx` (do NOT
  rebuild) to render the family parent with indented children, reusing the existing
  per-row Approve/Reject/Defer buttons that already route through
  `onPropose` → `/capture` `propose-intent` → `/confirm`.
- Add the family-level bulk control (Approve-all / Reject-all / Defer-all) that
  proposes a family-bulk intent through the SAME `onPropose` seam.
- Wire the immediate-apply path: when `/capture` returns an outcome indicating the
  gate was skipped (apply already performed server-side), the room reflects the
  applied result without showing a `pending-confirmation` surface; when it returns
  `pending-confirmation`, the existing gate surface renders with the new "+N beyond
  this family" / "+N relationships dropped" summary.
- Reuse `BulkFindingActionConfirmModal` styling precedent for the "+N" summary block.

## Existing Code to Leverage

**`gateway/src/services/discoveryReviewConversation/agendaSequencer.ts` (`buildAgenda`, `getReviewChunk`)**
- The flat agenda builder (sections 1-5, lines 124-225) and the
  `(section, scanScope)`-bounded slicer (lines 242-295). Family grouping replaces the
  chunking but REUSES the existing comparators (`compareByNameThenId`,
  `compareByTypeThenNameThenId`, `compareBlastRadius`, line 369+) and the existing
  conflict-enrichment (`candidateRefWithConflicts` / `liveConflictFacts`, lines
  318-358). Stays a PURE function of model + cursor (purity contract, lines 10-15).

**`gateway/src/services/discovery/resolveBulkActionSet.ts` (Spec A — DO NOT MODIFY)**
- The canonical cascade resolver. For the confirm-skip test, the coordinator
  compares its `resolved.candidates` (the full touched set, lines 565/585-591)
  against the derived family. For reject, its relationship-row surfacing (Group 3,
  lines 478-514) tags rows with a relationship-row `via_edge_kind`
  (`RELATIONSHIP_ROW_EDGE_KINDS`, lines 141-145) — the gate uses that tag to split
  "relationships dropped" from "candidates beyond".

**`gateway/src/services/discoveryReviewConversation/reviewConversationCoordinator.ts` (`openConfirmationGate`, line 342)**
- The gate already attaches deterministic `preview(...)` counts (= `resolveBulkActionSet`
  via `reviewTools.preview`, line 352) and builds the `pending-confirmation` summary.
  Reuse `resolved.candidates` here for the skip test + the "+N" overage; the skip
  branch is added at the top of the apply-decision arm.

**`gateway/src/services/discoveryReviewConversation/reviewModelFull.ts` (`FullReviewModelWire`)**
- The model the coordinator already holds (`edges` with `edge_kind`, `from_id`,
  `to_id`; `nodes` with `candidate_type`, `conflict_state`, `committed`). Family
  derivation reads `edges` filtered to `parent_child`; no new model field, no new
  computation (Spec 1 "no new computation" contract, lines 22-25).

**`frontend/src/components/Discovery/DiscoveryReviewRoom.tsx` (`ChunkSummaryView`, line 857; `applyOutcome`, line 293)**
- The always-actionable per-row buttons (line 877+) and the `/capture` → `/confirm`
  seam (`handlePropose` line 385, `handleConfirm` line 412). Extend `ChunkSummaryView`
  for the family layout + bulk control; extend `applyOutcome` (line 293) for the
  gate-skipped immediate-apply branch.

**`frontend/src/components/Discovery/BulkFindingActionConfirmModal.tsx`**
- Styling precedent for the gate's "+N beyond" / "+N relationships dropped" summary
  block (the in-flight `2026-05-28-bulk-findings-actions` spec's modal).

## Out of Scope

- Scan selection / multi-service tiering (separate spec ⑤).
- Any AMS endpoint change — the apply path (`candidates/bulk-review-cascade`) is
  already architecture-scoped + atomic and is inherited unchanged.
- The duplicate-attribute dedupe (already shipped in discovery-service).
- Any change to Spec A's `resolveBulkActionSet` resolver or its wire — this spec is
  display-only over Spec A's output.
- Folding findings into family chunks (findings stay their own
  `findings-by-severity` section).
- Re-deriving conflicts, cascades, or blast radius in the sequencer — it stays a
  pure read of Spec 1's precomputed model.
- No client-sent `visibleCandidateIds` field — the confirm-skip test is server-side.

## Testing Strategy

**Gateway (Jest, `gateway/src/services/discoveryReviewConversation/__tests__/`)**
- Sequencer (`buildAgenda` / `getReviewChunk`): a `parent_child`-bearing fixture
  yields one chunk per family (parent + its direct children, no splitting); orphans
  grouped by type AFTER families; cross-scan links + findings stay their own
  sections; family ranks into the conflicts band when any member is live-conflicted
  and stays intact; children sub-ordered conflicts-first then alphabetical; a shared
  entity bound by an endpoint appears once in its own family (not nested).
- Coordinator (`openConfirmationGate` / `captureDeterministicTurn`): a family bulk
  whose `resolvedTouchedSet ⊆ derivedFamily` SKIPS the gate (no
  `pending-confirmation`; apply path invoked); a single non-cascading row SKIPS; a
  family whose cascade escapes the family SHOWS the gate with "+N beyond this family";
  a family REJECT SHOWS the gate with a distinct "+N relationships dropped" figure
  (driven by Spec A's relationship-row `via_edge_kind` tags) while a fully-visible
  family APPROVE skips. Re-use the existing coordinator test harness
  (`reviewEngine.test.ts` / `reviewDefectFixes.test.ts`) and the
  `discovery-review-conversation-routes.test.ts` route seam.

**Frontend (Vitest, `frontend/src/components/Discovery/DiscoveryReviewRoom.test.tsx`)**
- A family chunk renders the parent with indented children and a single family-level
  Approve-all / Reject-all / Defer-all control plus the existing per-row controls.
- A gate-skipped capture outcome applies without rendering a
  `pending-confirmation` surface; a gated outcome renders the surface with the "+N
  beyond this family" and "+N relationships dropped" summary. Reuse the existing
  `discoveryReviewApi` mock + the `getReviewModelCounts` re-read-after-write pattern
  already in the test file.
