# Task Breakdown: Review-Room Agenda Redesign

## Overview
Total Tasks: 4 task groups

**Scope guard (read before any work):** This spec touches the **gateway + frontend ONLY**.
There is **NO AMS change** — the apply path (`candidates/bulk-review-cascade`) is already
architecture-scoped + atomic and is inherited unchanged. **Do NOT modify Spec A's
`gateway/src/services/discovery/resolveBulkActionSet.ts` resolver or its wire** — they are
built + verified and Spec A owns them; this spec only *consumes* the resolver's
`resolved.candidates` output (incl. the reject-only relationship-row candidates it tags with
`via_edge_kind`) and *displays* it. Do NOT re-derive conflicts, cascades, or blast radius in
the sequencer — it stays a pure read of Spec 1's precomputed review model. The confirm-skip
test is **server-side** — there is NO client-sent `visibleCandidateIds` field.

## Task List

### Gateway — Sequencer Layer

#### Task Group 1: Family chunking in the agenda sequencer
**Dependencies:** None
**File:** `gateway/src/services/discoveryReviewConversation/agendaSequencer.ts`

Re-derive parent-family chunks from the review-model `parent_child` edges. This is the
foundational change — every downstream group depends on the family-aware chunk shape.

- [x] 1.0 Complete family-aware sequencer
  - [x] 1.1 Write 2-8 focused tests for family chunking
    - In `gateway/src/services/discoveryReviewConversation/__tests__/` (new file
      `agendaSequencerFamilies.test.ts` or extend an existing sequencer test)
    - Limit to 2-8 highly focused tests maximum covering only the critical behaviours:
      - A `parent_child`-bearing fixture yields ONE chunk per family (parent + its
        direct children, never split across chunks)
      - Orphans (no `parent_child` edge in either direction) grouped by type AFTER
        all families
      - A family with any live-conflict member ranks into the conflicts band and stays
        ONE intact chunk; children sub-ordered conflicts-first then alphabetical
      - A shared entity bound by an endpoint (relationship-row edge, NOT `parent_child`)
        appears ONCE in its own family — never pulled into the endpoint's family
    - Skip exhaustive coverage of every section/scan-scope permutation
  - [x] 1.2 Derive families from `parent_child` edges in `buildAgenda` (lines ~124-225)
    - A family = ONE parent node + its DIRECT `parent_child` children only, from
      `model.edges` where `edge_kind === 'parent_child'` (`from_id` = parent,
      `to_id` = child). TWO-LEVEL only (interface+endpoints; entity+attributes; physical
      entity+columns) — NOT four-level data-flow nesting
    - Families are strictly structural: relationship-row edges
      (`interface_logical_entities`, `endpoint_data_effects`, etc.) MUST NOT pull a node
      into a family
    - Reuse the existing review model the sequencer already reads
      (`reviewModelFull.ts` `FullReviewModelWire`) — no new model field, no new
      computation; stays a PURE function of model + cursor (purity contract lines 10-15)
  - [x] 1.3 Implement family ordering + child sub-ordering
    - Family ordering rank = "does ANY member (parent or child) have a live conflict?";
      a family with any live-conflict member ranks up into the conflicts band and stays
      intact — never hoist a conflicted child into a separate conflicts-only section
    - Order: conflicts-first -> high-impact (non-empty `blast_radius`) -> by type/name
    - Within a family: parent first, then children sub-ordered conflicts-first then
      alphabetical by name
    - REUSE the existing comparators (`compareByNameThenId`,
      `compareByTypeThenNameThenId`, `compareBlastRadius`, lines 369+) and the existing
      conflict-enrichment (`candidateRefWithConflicts` / `liveConflictFacts`, lines
      318-358) — do NOT rewrite them
  - [x] 1.4 Replace the flat slicer with one-chunk-per-family chunking in `getReviewChunk`
    - Lines ~242-295: today bounded only by the `(section, scanScope)` group with
      `DEFAULT_CHUNK_SIZE = 15`; replace so each family is ONE chunk regardless of size
      (never split a family across chunks)
    - Orphans grouped by `candidate_type` into chunks AFTER families
    - Cross-scan logical<->physical links stay their own `cross-scan-links` section
      (LAST, unchanged); findings stay their own `findings-by-severity` section
      (NOT folded into families)
  - [x] 1.5 Ensure sequencer tests pass
    - Run ONLY the 2-8 tests written in 1.1
    - Do NOT run the entire gateway test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass
- One chunk per family from `parent_child` edges; families never split
- Orphans grouped by type after families; cross-scan + findings sections unchanged
- A live-conflict member ranks its whole family into the conflicts band, intact
- The sequencer remains a pure read of the model (no new computation, no I/O)

### Gateway — Turn Shape & Intent

#### Task Group 2: Turn-shape + family-bulk intent
**Dependencies:** Task Group 1
**Files:** `gateway/src/services/discoveryReviewConversation/reviewTurnShape.ts`,
`gateway/src/services/discoveryReviewConversation/reviewConversationCoordinator.ts`

Make the chunk turn family-aware and add a family-level bulk intent that seeds the family
into the UNCHANGED `bulk-review-cascade` apply path.

- [x] 2.0 Complete turn-shape + family-bulk intent
  - [x] 2.1 Write 2-8 focused tests for the family-aware turn + bulk intent
    - In `gateway/src/services/discoveryReviewConversation/__tests__/` (extend
      `reviewEngine.test.ts` / `reviewDefectFixes.test.ts`)
    - Limit to 2-8 tests maximum covering only critical behaviours:
      - A family chunk turn validates with the new family fields populated
        (parent ref + children, or `familyParentId`) + the family-bulk flag
      - A non-family chunk (orphan-by-type / findings / cross-scan) still validates with
        the new fields ABSENT (additive/optional change to the closed `ReviewTurn` union)
      - A family-bulk Approve/Reject/Defer-all intent seeds the family and flows into the
        existing `apply-decision` -> `bulk-review-cascade` path (no new apply path)
    - Skip exhaustive coverage of every intent permutation
    - DONE: new file `reviewFamilyBulkIntent.test.ts` (4 tests: family chunk turn carries
      `family`+`familyBulkActions`; non-family chunk has them absent; family-bulk seed-parent
      APPROVE flows into `bulk-review-cascade` over the whole family; seed-parent == family ==
      touched-set exactness for the Group 3 skip).
  - [x] 2.2 Extend `ChunkSummaryTurn` for family awareness in `reviewTurnShape.ts`
    - `ChunkSummaryTurn` (lines 175-189) carries `items` + `section`/`scanScope`/`cursor`/
      `nextCursor`/`agendaTotal` only — add a parent ref + children refs OR a
      `familyParentId` identifying the parent within `items`, plus a family-bulk
      flag/intent the frontend renders the bulk control from
    - Keep the change ADDITIVE to the closed `ReviewTurn` union — new fields MUST be
      optional so non-family chunks still validate. Existing `ChunkItemRef.conflicts`
      (live-conflict facts) is untouched
    - DONE: added optional `family?: ChunkFamily` (`{ parentId, childIds }`) +
      `familyBulkActions?: BulkReviewAction[]` (new `ChunkFamily` interface). Both optional;
      non-family chunks validate with them absent.
  - [x] 2.3 Populate the new family fields from the sequencer
    - The sequencer (Group 1) emits the `ChunkSummaryTurn`; populate `familyParentId` /
      parent+children + the family-bulk flag for family chunks; leave them absent for
      orphan-by-type, findings, and cross-scan chunks
    - DONE: `emitFamily` stamps `familyParentId`+`familyChildIds` on every item of a true
      multi-node family (a SURFACE of the family Group 1 already chunked); `getReviewChunk`
      reads them off the head item and sets `family`+`familyBulkActions` for family heads
      only (`isFamily === false` heads leave both absent).
  - [x] 2.4 Add the family-level bulk intent on the coordinator
    - Represent the family bulk on the existing `apply-decision` intent
      (`ProposedReviewIntent`, `seedCandidateIds: string[]`) — pick the seed
      representation (seed parent id so cascade pulls children, OR seed all family ids)
      that makes the server-side `resolvedTouchedSet subset-of derivedFamily` test in
      Group 3 EXACT
    - The seed flows unchanged into `reviewDecisionOrchestrator.applyDecision` ->
      AMS `candidates/bulk-review-cascade`. No new apply path
    - DONE: seed the PARENT id (the cascade pulls the `parent_child` children via the
      resolver's blast radius). No new intent variant + no new apply path — the existing
      `apply-decision` carries it. Exactness verified in `reviewFamilyBulkIntent.test.ts`
      (test 4: `deriveFamilyForSeed([parent]) === resolved touched set === rendered family`).
  - [x] 2.5 Ensure turn-shape + intent tests pass
    - Run ONLY the 2-8 tests written in 2.1
    - Do NOT run the entire gateway test suite at this stage
    - DONE: `reviewFamilyBulkIntent.test.ts` (4) green; gateway typecheck clean.

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass
- Family chunks carry the parent/children + family-bulk flag; non-family chunks validate
  with the new fields absent (additive optional change)
- A family bulk is representable on `apply-decision` and flows into the unchanged
  `bulk-review-cascade` path
- The seed representation matches what the Group 3 confirm-skip test needs to be exact

### Gateway — Confirm Gate

#### Task Group 3: Cascade-aware confirm gate
**Dependencies:** Task Groups 1, 2
**File:** `gateway/src/services/discoveryReviewConversation/reviewConversationCoordinator.ts`

Add the SERVER-SIDE confirm-skip branch to `openConfirmationGate` and surface the
off-screen overage as two distinct figures.

- [x] 3.0 Complete the cascade-aware confirm gate
  - [x] 3.1 Write 2-8 focused tests for the confirm-skip + overage summary
    - In `gateway/src/services/discoveryReviewConversation/__tests__/` (extend
      `reviewEngine.test.ts` / `reviewDefectFixes.test.ts`); also exercise the route seam
      via `discovery-review-conversation-routes.test.ts` if a route assertion is needed
    - Limit to 2-8 tests maximum covering only critical behaviours:
      - A family bulk whose `resolvedTouchedSet subset-of derivedFamily` SKIPS the gate
        (no `pending-confirmation` turn; the apply path is invoked) — and a single
        non-cascading row SKIPS
      - A family whose cascade escapes the family SHOWS the gate with a "+N beyond this
        family" figure
      - A family REJECT SHOWS the gate with a SEPARATE "+N relationships dropped" figure
        (driven by Spec A's relationship-row `via_edge_kind` tags) while a fully-visible
        family APPROVE skips
    - Skip exhaustive coverage of every action/cascade permutation
    - DONE: new file `reviewConfirmSkip.test.ts` (6 tests covering all three behaviours +
      a `partitionOverage` unit + a skip-uses-same-writer assertion). Route seam updated:
      `discovery-review-conversation-routes.test.ts` test 5 now asserts a fully-visible
      `/capture` returns `applied` over HTTP + fires one `bulk-review-cascade`.
  - [x] 3.2 Add the server-side confirm-skip branch at the top of the apply-decision arm
    - `openConfirmationGate` (line 342) is UNCONDITIONAL today (apply-decision arm
      lines ~351-405 always appends `pending-confirmation`). Re-derive the family
      server-side (seed parent + its `parent_child` children from the model) and SKIP the
      gate iff `resolvedTouchedSet subset-of derivedFamily`; otherwise SHOW it
    - Reuse the already-computed `resolved.candidates` (line 368, from
      `reviewTools.preview` = `resolveBulkActionSet`) as the touched set — do NOT call a
      new resolver and do NOT modify Spec A's resolver
    - NO `visibleCandidateIds` from the client — one-chunk-per-family means the rendered
      chunk == the derived family, so the server derivation is exact
    - DONE: new pure `deriveFamilyForSeed(seedIds, model)` (seed ∪ direct `parent_child`
      children); `partitionOverage(touched, family, model)`; `fullyVisible` iff both overage
      figures are 0 → skip. The touched set is `resolved.candidates` (consumed only).
  - [x] 3.3 Wire the skip path to apply immediately + return an "applied" outcome
    - On skip, the click IS the confirmation: invoke the apply path and return an outcome
      the frontend reads as "applied" (no pending turn). On no-skip, keep appending the
      `pending-confirmation` turn as today
    - DONE: skip branch calls `deps.orchestrator.applyDecision(...)` with the FULL touched
      set + findings and returns the NEW `ReviewTurnOutcome` variant
      `{ kind: 'applied', userMessageTurn, previewTurn, appliedTurn }` (no pending turn).
      An immediate-apply failure returns the orchestrator's `error` outcome.
  - [x] 3.4 Surface the two distinct overage figures in the gate summary
    - When the gate IS shown, compute `resolvedTouchedSet - derivedFamily` and split it:
      - "+N entities/candidates beyond this family" = resolved NON-relationship-row
        candidates outside the family
      - "+N relationships dropped" = resolved candidates whose `via_edge_kind` is one of
        Spec A's six relationship-row kinds (`RELATIONSHIP_ROW_EDGE_KINDS`); these are
        never rendered inside a family chunk so they always count as off-screen
    - Carry both figures on the `pending-confirmation` summary surface
    - DONE: `PendingConfirmationTurn.overage = { beyondFamilyCount, relationshipsDroppedCount }`
      (new optional field). The split uses the model's NODE-ID SET (a touched id NOT in the
      node set is a relationship-ROW edge candidate) — the spec's key technique — NOT
      `via_edge_kind` alone. Both figures + a prose tail land on the gate summary.
  - [x] 3.5 Update the now-stale "every mutation is gated" comments
    - The `openConfirmationGate` doc comment (lines ~334-340) and the coordinator header
      assert "EVERY mutation is gated / NO low-stakes fast path" — update both to
      describe the new CONDITIONAL skip behaviour (the user has authorized the relaxation)
    - DONE: the coordinator header's oracle-safety bullet now documents the
      CASCADE-AWARE CONFIRM-SKIP; the `openConfirmationGate` doc comment describes the
      conditional skip-vs-gate behaviour.
  - [x] 3.6 Ensure confirm-gate tests pass
    - Run ONLY the 2-8 tests written in 3.1
    - Do NOT run the entire gateway test suite at this stage
    - DONE: `reviewConfirmSkip.test.ts` (6) + the updated `reviewEngine.test.ts` (7) +
      `discovery-review-conversation-routes.test.ts` (5) all green; gateway typecheck clean.

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass
- Confirm-skip is server-side (no client visible-id list); skips iff
  `resolvedTouchedSet subset-of derivedFamily`; a single non-cascading row also skips
- The shown gate carries BOTH "+N beyond this family" and "+N relationships dropped" as
  separate figures; a family REJECT (relationship-row surfacing) shows the gate while a
  fully-visible family APPROVE skips
- Spec A's `resolveBulkActionSet` and its wire are UNCHANGED (consumed only)
- The "every mutation is gated" comments are updated to the new conditional behaviour

### Frontend — Review Room

#### Task Group 4: Frontend family rendering + immediate-apply path
**Dependencies:** Task Groups 1, 2, 3
**File:** `frontend/src/components/Discovery/DiscoveryReviewRoom.tsx`

Render families and add the immediate-apply path for the no-confirm-needed case.

> **Pre-existing-test gotcha (flag before writing tests):** any Vitest that renders
> `DiscoveryReviewRoom` / `DiscoveryCandidateTable` MUST include `getReviewModel` in the
> `discoveryApi` mock factory — the grid fetches it on mount, and a missing export throws
> "No getReviewModel export...". Copy the mock from the existing test file
> (`DiscoveryReviewRoom.test.tsx` already has the `discoveryReviewApi` mock +
> `getReviewModelCounts` re-read-after-write pattern) so the implementer does not trip it.

- [x] 4.0 Complete the frontend family rendering + immediate-apply path
  - [x] 4.1 Write 2-8 focused tests for the room
    - In `frontend/src/components/Discovery/DiscoveryReviewRoom.test.tsx` (extend the
      existing file; reuse its `discoveryReviewApi` mock + `getReviewModelCounts`
      re-read-after-write pattern; include `getReviewModel` in the mock per the gotcha)
    - Limit to 2-8 tests maximum covering only critical behaviours:
      - A family chunk renders the parent with indented children + a single family-level
        Approve-all / Reject-all / Defer-all control PLUS the existing per-row controls
      - A gate-skipped capture outcome applies WITHOUT rendering a `pending-confirmation`
        surface
      - A gated outcome renders the surface with the "+N beyond this family" and
        "+N relationships dropped" summary
    - Skip exhaustive coverage of every chunk-section render state
  - [x] 4.2 Extend `ChunkSummaryView` to render the family (do NOT rebuild)
    - `ChunkSummaryView` (line ~857): render the family parent with INDENTED children,
      reusing the existing always-actionable per-row Approve/Reject/Defer buttons
      (line ~877+) that already route through `onPropose` -> `/capture` `propose-intent`
      -> `/confirm`
  - [x] 4.3 Add the family-level bulk control
    - Add a single Approve-all / Reject-all / Defer-all control on the family that
      proposes the family-bulk intent through the SAME `onPropose` seam (no new seam)
  - [x] 4.4 Wire the immediate-apply path in `applyOutcome`
    - `applyOutcome` (line ~293) handles `pending-confirmation` / `narrated` / `error`
      only. Add the branch for the gate-skipped case: when the coordinator returns the
      "applied" outcome (no pending turn), reflect the applied result WITHOUT showing a
      `pending-confirmation` surface; when it returns `pending-confirmation`, the existing
      gate surface renders with the new summary
  - [x] 4.5 Render the two-figure overage summary in the confirm box
    - Show "+N beyond this family" and "+N relationships dropped" in the confirm surface,
      reusing the `BulkFindingActionConfirmModal.tsx` styling precedent
  - [x] 4.6 Ensure room tests pass
    - Run ONLY the 2-8 tests written in 4.1
    - Do NOT run the entire frontend test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass
- A family renders parent + indented children with both the family-level bulk control and
  the per-row controls; `ChunkSummaryView` is extended, not rebuilt
- A gate-skipped outcome applies without a `pending-confirmation` surface; a gated outcome
  renders the surface with both "+N" figures
- Tests do not trip the missing-`getReviewModel` failure

## Execution Order

Recommended implementation sequence (foundational first — each group depends on the prior):
1. Family chunking in the agenda sequencer (Task Group 1)
2. Turn-shape + family-bulk intent (Task Group 2)
3. Cascade-aware confirm gate (Task Group 3)
4. Frontend family rendering + immediate-apply path (Task Group 4)
