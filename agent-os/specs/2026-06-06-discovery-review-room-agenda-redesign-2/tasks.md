# Task Breakdown: Discovery Review Room Agenda Redesign 2 (confirm-box removal + rich cascade chunks)

## Overview
Total Tasks: 6 task groups

This feature is a behavioural redesign of the Discovery Review Room conversation,
split across two layers in strict dependency order: **gateway first** (turn shape,
cascade-preview builder, agenda dedup, coordinator immediate-apply + scope branch),
then **frontend** (four-button chunk view, auto-advance/scroll, conflicts-in-place,
terminal Save). The parity-tested `resolveBulkActionSet` resolver + its parity
fixture and the AMS `bulkReviewCascade` applicator are EXPLICITLY UNTOUCHED.

Layering / dependency order:
1. Gateway turn-shape + wire types (Task Group 1) — foundation; everything else types against it.
2. Gateway cascade-preview builder (Task Group 2) — depends on the new field shape from TG1.
3. Gateway agenda dedup + four FAMILY_BULK_ACTIONS (Task Group 3) — depends on TG1.
4. Gateway coordinator immediate-apply + scope branch + next-chunk/exhaustion (Task Group 4) — depends on TG1–TG3.
5. Frontend ChunkSummaryView + room flow + API mirror (Task Group 5) — depends on the whole gateway contract (TG1–TG4).
6. Test review & gap analysis (Task Group 6) — depends on TG1–TG5.

## Task List

### Gateway — Conversation Contract

#### Task Group 1: Turn shape + wire types (`reviewTurnShape.ts` + frontend mirror)
**Dependencies:** None

- [x] 1.0 Extend the conversation turn/intent contract for the redesign
  - [x] 1.1 Write 2-8 focused tests for the new contract shape
    - Limit to 2-8 highly focused tests maximum
    - Test only critical contract behaviours: a `ChunkSummaryTurn` carrying the new `cascadePreview` field validates; the `apply-decision` intent accepts the `scope: 'family' | 'cascade'` discriminator; the `ReviewTurn` closed union still validates a non-family chunk with `cascadePreview` absent
    - Skip exhaustive field-by-field type coverage and conflict/save edge cases (covered in later groups)
  - [x] 1.2 Add the structured `cascadePreview` field to `ChunkSummaryTurn` (`gateway/src/services/discoveryReviewConversation/reviewTurnShape.ts` ~222-255)
    - Shape: `{ total: number, byType: Array<{ type: string, count: number, alreadyApproved: number, alreadyRejected: number, alreadyDeferred: number }> }`
    - `type` is the `candidate_type`; `count` is the full-cascade count of that type; the three sub-counts are the already-decided members of that type
    - Keep the field ADDITIVE + OPTIONAL so non-family chunks (orphan-by-type / findings / cross-scan) still validate against the closed `ReviewTurn` union
  - [x] 1.3 Add the new "Approve visible chunk" action to the family chunk action set
    - Expand `familyBulkActions` (or add the dedicated visible-chunk action alongside it) on `ChunkSummaryTurn` so the four-button layout is expressible
    - Do NOT alter the parity-tested resolver node shape (`{ id, review_status }`) in `reviewModelWire.ts`; if a shared enum needs the visible-chunk action it must not touch the resolver wire
  - [x] 1.4 Add the `scope: 'family' | 'cascade'` discriminator to the `apply-decision` intent (`ProposedReviewIntent`)
    - Keep it additive; existing callers default to `'cascade'` (today's full-cascade behaviour) where unspecified
  - [x] 1.5 Retire `PendingConfirmationTurn` for the chunk + conflict paths at the type level
    - Keep `PendingConfirmationTurn` in the union but document/constrain its surviving use to the TERMINAL Save Yes/No ONLY
    - Do not delete `PendingConfirmationTurn` (Save still uses it — Task Group 4 / 5)
  - [x] 1.6 Mirror ALL of the above wire changes in `frontend/src/api/discoveryReviewApi.ts` (~297-346)
    - Add `cascadePreview` to the frontend `ChunkSummaryTurn` mirror (additive/optional)
    - Add the `scope` field to the frontend apply-decision intent mirror
    - Add the new visible-chunk action to the frontend action mirror
    - Keep the mirror in byte-for-shape lockstep with the gateway (the established convention)
  - [x] 1.7 Ensure turn-shape tests pass
    - Run ONLY the 2-8 tests written in 1.1 plus the gateway TypeScript typecheck for the touched files
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass
- `ChunkSummaryTurn` carries the optional `cascadePreview` field and the new visible-chunk action; the `apply-decision` intent carries `scope`
- `PendingConfirmationTurn` remains only for the terminal Save (constrained at the type/usage level)
- The `frontend/src/api/discoveryReviewApi.ts` mirror matches the new gateway shape exactly
- Gateway + frontend both typecheck the touched files
- The parity-tested resolver node shape (`{ id, review_status }`) is unchanged

### Gateway — Cascade Preview

#### Task Group 2: Gateway-only cascade-preview builder (S2)
**Dependencies:** Task Group 1

- [x] 2.0 Build the pure per-type cascade-preview computation
  - [x] 2.1 Write 2-8 focused tests for the preview builder
    - Limit to 2-8 highly focused tests maximum
    - Test only critical behaviours: the per-type breakdown groups by `candidate_type` with correct `count`; the three already-* sub-counts (`alreadyApproved` / `alreadyRejected` / `alreadyDeferred`) reflect each member's `review_status`; `total` equals the full-cascade count; the builder is cycle-safe on a model with a `parent_child` cycle
    - Skip DB-scan vs code-scan prose assertions (prose is rendered in TG5) and exhaustive type permutations
  - [x] 2.2 Implement the NEW gateway-only `cascadePreview` builder
    - Host it in `reviewConversationCoordinator.ts` or a sibling module the coordinator calls (per spec)
    - Read the FULL review model the coordinator already holds (`FullReviewModelWire` nodes carrying `candidate_type`, `review_status`, `committed`) — see `reviewModelFull.ts` (`FullReviewModelWire` ~60-81, `aggregations.by_candidate_type` ~110-121)
    - Compute `total` from the resolver's full-cascade touched set (reuse `resolveBulkActionSet` as-is for the cascade reach; do NOT modify it)
    - Group the touched set by `candidate_type`; per type emit `count` plus `alreadyApproved` / `alreadyRejected` / `alreadyDeferred` derived from each member's `review_status`
    - The builder MUST be PURE (no I/O, clock, or globals) and CYCLE-SAFE, like the sequencer and `deriveFamilyForSeed`
  - [x] 2.3 Wire the builder into chunk construction in the agenda/coordinator path
    - Populate `ChunkSummaryTurn.cascadePreview` for FAMILY chunks at chunk-build time
    - Leave `cascadePreview` ABSENT for non-family chunks (orphan-by-type / findings / cross-scan-LINK)
    - Do NOT widen the parity-tested resolver wire (no resolver / parity-fixture churn)
  - [x] 2.4 Ensure preview-builder tests pass
    - Run ONLY the 2-8 tests written in 2.1
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass
- The builder is pure + cycle-safe and reads only the precomputed full model (no re-derivation of conflicts/cascades/blast radius beyond the resolver's existing touched set)
- `cascadePreview.total` = full-cascade count; per-type `count` + the three already-* sub-counts are correct from `review_status`
- FAMILY chunks carry `cascadePreview`; non-family chunks do not
- No change to `resolveBulkActionSet.ts` or the parity fixture

### Gateway — Agenda Dedup

#### Task Group 3: Agenda dedup of decided families + four FAMILY_BULK_ACTIONS (`agendaSequencer.ts`)
**Dependencies:** Task Group 1

- [x] 3.0 Dedup fully-decided families and expand the family action set
  - [x] 3.1 Write 2-8 focused tests for the dedup filter
    - Limit to 2-8 highly focused tests maximum
    - Test only critical behaviours: a FULLY-decided family (every member `review_status` non-pending OR `committed`) is EXCLUDED from the agenda; a PARTIALLY-decided family is KEPT and still presented as a chunk (it has ≥1 actionable member); `FAMILY_BULK_ACTIONS` exposes the four actions including the new visible-chunk one
    - Skip cross-scan-LINK chunk permutations and section-ordering assertions
  - [x] 3.2 Add the `review_status` / `committed` dedup filter to `buildFamilies` (~313-359) and `buildAgenda` (~216-293)
    - Define actionable = `review_status` pending AND NOT `committed`
    - A family is presented as a chunk IFF it has ≥1 actionable member; fully-decided families are dropped (the dedup fix — neither function filters on status today)
    - Keep partially-decided families in the agenda with their decided members retained for read-only/annotated rendering (the frontend marks them; do not strip decided members from the chunk)
    - Generalise type-driven so DATABASE-scan families (physical entity / table → columns + cross-scan logical↔physical mappings) are handled by the same filter
    - Keep both functions PURE functions of model + cursor
  - [x] 3.3 Expand `FAMILY_BULK_ACTIONS` (~line 106) to the four actions
    - Add the new visible-chunk action to the existing `['approved', 'rejected', 'deferred']` set so each family chunk advertises Approve All / Approve visible chunk / Reject All / Defer All
  - [x] 3.4 Preserve cross-scan-LINK chunk treatment unchanged
    - Cross-scan-LINK chunks are NOT parent families → KEEP the existing per-item treatment; the four-button rich-summary layout applies to FAMILY chunks ONLY
  - [x] 3.5 Ensure agenda-sequencer tests pass
    - Run ONLY the 2-8 tests written in 3.1 (plus the existing `agendaSequencerFamilies.test.ts` if it touches the same surface, to confirm no regression in the dedup-adjacent banding)
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass
- Fully-decided families are excluded from the agenda; partially-decided families are kept with decided members retained for annotation
- `FAMILY_BULK_ACTIONS` exposes the four actions
- Cross-scan-LINK chunks keep their existing per-item treatment
- `buildFamilies` / `buildAgenda` remain pure functions of model + cursor

### Gateway — Coordinator

#### Task Group 4: Coordinator immediate-apply, scope branch, next-chunk/exhaustion (`reviewConversationCoordinator.ts`)
**Dependencies:** Task Groups 1, 2, 3

- [x] 4.0 Remove the confirm gate (except Save), branch the apply scope, and auto-advance
  - [x] 4.1 Write 2-8 focused tests for the coordinator behaviour
    - Limit to 2-8 highly focused tests maximum
    - Test only critical behaviours: `apply-decision` applies IMMEDIATELY (no `pending-confirmation` turn) for both `scope` values; `scope:'family'` writes EXACTLY the `deriveFamilyForSeed` id set while `scope:'cascade'` writes the resolver's full touched set; `resolve-conflict` / `resolve-conflicts-by-pattern` apply immediately and return the SAME (refreshed) chunk WITHOUT advancing; the NEXT chunk is returned inside the `'applied'` outcome after a disposition; when `nextCursor === null` a terminal Save `pending-confirmation` turn is appended
    - Skip exhaustive re-validation paths and the full-conflict-class permutations
  - [x] 4.2 Remove the overage / off-screen confirm gate for `apply-decision`, `resolve-conflict`, and `resolve-conflicts-by-pattern` (`openConfirmationGate` ~381-545; overage gate ~412-443 / 457-481)
    - These three intents now ALWAYS apply immediately and return an `'applied'` outcome — `openConfirmationGate` no longer appends a `pending-confirmation` turn for them
    - Keep the gate ONLY for the final `save` intent (still flows through `confirmPending` ~580-673 re-validation)
  - [x] 4.3 Implement the `scope` branch for `apply-decision` (S1)
    - `scope:'family'` → apply via the EXPORTED PURE `deriveFamilyForSeed(seeds, model)` (~689-701) id set (seed ∪ direct `parent_child` children), passed flat to the AMS bulk-review applicator
    - `scope:'cascade'` → apply the resolver's FULL touched set exactly as today
    - The shallow id-set selection lives ENTIRELY in the coordinator; do NOT add a shallow flag to `resolveBulkActionSet`; the orchestrator's flat `candidate_ids[]` write path (`reviewDecisionOrchestrator.applyDecision` ~189-233) is UNCHANGED — only WHICH ids are sent differs
    - Reject All / Defer All remain full-cascade (`scope:'cascade'`); Reject retains the Spec A exclusivity / relationship-row behaviour owned by `2026-06-05-reject-cascade-correctness` (do not re-implement it here)
  - [x] 4.4 Return the NEXT chunk inside the `'applied'` outcome (auto-advance source)
    - After a disposition apply, compute and include the next chunk in the `'applied'` outcome so the frontend renders it with no separate advance click
    - For the conflict paths (`resolve-conflict` / `resolve-conflicts-by-pattern`), return the SAME chunk REFRESHED with the conflict cleared — do NOT advance (Q4)
  - [x] 4.5 Auto-append the terminal Save on agenda exhaustion (Q3)
    - When an apply leaves the agenda exhausted (`nextCursor === null` / next chunk is `null`), auto-append a single terminal "Save all approved candidates back to the architecture?" `PendingConfirmationTurn` with Yes/No
    - This is the ONLY surviving `PendingConfirmationTurn` use; there is NO mid-conversation save affordance
  - [x] 4.6 Keep the model re-fetched FRESH per route call
    - Rely on the existing fresh re-fetch so already-decided `review_status` is queryable mid-conversation for the dedup (TG3) and the per-type annotations (TG2); no new model field or caching
  - [x] 4.7 Ensure coordinator tests pass
    - Run ONLY the 2-8 tests written in 4.1 (plus the existing `reviewConfirmSkip.test.ts` / `reviewFamilyBulkIntent.test.ts` if they assert the now-changed confirm behaviour, updating those assertions to the immediate-apply contract)
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass
- `apply-decision` (both scopes), `resolve-conflict`, and `resolve-conflicts-by-pattern` apply immediately with NO confirm turn
- `scope:'family'` writes exactly the `deriveFamilyForSeed` id set; `scope:'cascade'` writes the resolver touched set; the orchestrator write path is unchanged
- The next chunk is returned inside the `'applied'` outcome (disposition); the SAME refreshed chunk is returned for conflicts (no advance)
- A terminal Save Yes/No turn is appended when the agenda is exhausted; the gate survives ONLY for Save
- `resolveBulkActionSet` stays pure with no shallow flag

### Frontend — Review Room

#### Task Group 5: ChunkSummaryView four buttons, auto-advance/scroll, conflicts-in-place, terminal Save (`DiscoveryReviewRoom.tsx`)
**Dependencies:** Task Groups 1, 2, 3, 4

- [x] 5.0 Render the rich four-button chunk and wire the immediate-apply + auto-advance flow
  - [x] 5.1 Write 2-8 focused tests for the room UI
    - Limit to 2-8 highly focused tests maximum
    - Test only critical behaviours: the FOUR buttons render (Approve All / Approve visible chunk / Reject All / Defer All) with the correct intent + `scope` per button (`'family'` for Approve visible chunk, `'cascade'` for Approve All); the multi-line cascade summary renders from `cascadePreview` INCLUDING the "(N already approved)" / "(N already rejected)" / "(N already deferred)" annotations; a disposition click auto-advances by appending the next chunk from the `'applied'` outcome and calls `scrollIntoView` (DOM call MOCKED); a conflict choice applies immediately and re-renders the SAME chunk WITHOUT advancing; the terminal Save Yes triggers the save-all effect and No is a no-op
    - Skip exhaustive button-disabled-state and responsive-layout assertions
  - [x] 5.2 Render the multi-line cascade summary in `ChunkSummaryView` (~1046-1208)
    - Build the numbered multi-line prose from `cascadePreview` (full-cascade total line + per-type lines), e.g. "Review the current N candidates: 1) The current seed '…' and its M endpoints; 2) their associated …"
    - Append "(N already approved)" / "(N already rejected)" / "(N already deferred)" annotations per type from the three sub-counts (only when non-zero)
    - Type-driven so a DB-scan family renders the table/columns + logical entities/attributes analogue (Q2); exact prose at the spec's discretion
  - [x] 5.3 Render the FOUR buttons and wire each to the immediate-apply flow
    - Approve All → `apply-decision` `scope:'cascade'`; Approve visible chunk → `apply-decision` `scope:'family'`; Reject All → full reject cascade; Defer All → full defer cascade
    - Have the intent helpers `applyDecisionIntentFor` / `familyBulkIntentFor` (~238-259) set the new `scope` discriminator
    - Render already-decided members read-only / annotated; Approve All and Approve visible chunk no-op them
  - [x] 5.4 Auto-advance in `applyOutcome` `'applied'` (~479-509)
    - On `'applied'`, append the next chunk carried in the outcome (replacing the manual "Show next chunk" advance `onAdvance(turn.nextCursor)` ~1195-1205)
    - Call `scrollIntoView` anchored to the LAST user-message (blue) turn (`data-testid="review-room-turn-user-message"` / `chassis.turnUser` ~1014-1020) so the TOP of that message sits at the viewport top and the appended next chunk directly below is visible
  - [x] 5.5 Apply conflicts immediately, in place (Q4)
    - "Use \<source\>" / "Use \<source\> for all N" apply immediately and re-render the SAME chunk (refreshed, conflict cleared) returned by the coordinator; they do NOT auto-advance and do NOT scroll-advance — only the four disposition buttons advance
  - [x] 5.6 Reduce `PendingConfirmationView` (~1210-1314) to the terminal Save ONLY
    - Remove `PendingConfirmationView` for chunk + conflict turns; keep it ONLY for the terminal Save Yes/No
    - Wire Save "Yes" to the same effect as the candidates-table "Save All Approved" button; "No" is a no-op (user closes the conversation; the candidates table remains the escape hatch)
    - The end-of-agenda scroll still scrolls the user's last blue action message to the top, leaving the Save prompt visible below it
  - [x] 5.7 Confirm the API mirror is consumed correctly
    - Verify `discoveryReviewApi.ts` (mirrored in TG1) is the source of the `cascadePreview`, `'applied'` next-chunk, and `scope` shapes the room now consumes (no second divergent definition)
  - [x] 5.8 Ensure room UI tests pass
    - Run ONLY the 2-8 tests written in 5.1
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 5.1 pass
- The four buttons render with the correct intent + `scope`; the multi-line summary renders incl. all three already-* annotations
- A disposition click auto-advances (next chunk from the outcome) and calls `scrollIntoView`; conflicts apply immediately + re-render in place with no advance
- `PendingConfirmationView` survives ONLY for the terminal Save; Save Yes triggers the save-all effect, No is a no-op
- The frontend consumes the single `discoveryReviewApi.ts` mirror for the new shapes

### Testing

#### Task Group 6: Test review & gap analysis
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical gaps only
  - [x] 6.1 Review tests written in Task Groups 1-5
    - Review the 2-8 gateway turn-shape tests (Task 1.1)
    - Review the 2-8 cascade-preview builder tests (Task 2.1)
    - Review the 2-8 agenda-dedup tests (Task 3.1)
    - Review the 2-8 coordinator tests (Task 4.1)
    - Review the 2-8 frontend room tests (Task 5.1)
    - Total existing tests: approximately 10-40 tests
  - [x] 6.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows that lack coverage: one-click-per-family review (apply → auto-advance → next chunk → … → agenda exhausted → terminal Save), and the family-vs-cascade id-set distinction surfacing correctly through to the AMS apply call
    - Focus ONLY on gaps related to this spec's requirements (features i-iv + Save); do NOT assess application-wide coverage
    - Prioritize end-to-end workflows and the gateway↔frontend wire contract over unit-level gaps
    - Q1 INVESTIGATION (already-decided members not re-actioned): confirmed the AMS applicator `DiscoveryCascadeReviewService.applyCandidateArm` only no-ops a SAME-status row (`requestedStatus.equals(current)`, lines 205-208) + a `committed` row (lines 200-203); it OVERWRITES a member already in a DIFFERENT terminal disposition (lines 211-212). A probe proved the coordinator's disposition write-set included the already-approved member id for Reject/Defer over a partially-approved family — a REQUIREMENT VIOLATION. FIXED in `reviewConversationCoordinator.ts` by intersecting the write-set with the actionable (pending, non-committed) NODE members (mirroring `agendaSequencer.isActionable`), for ALL dispositions and BOTH scopes; non-node reject-surfaced relationship-row ids are preserved.
  - [x] 6.3 Write up to 10 additional strategic tests maximum
    - Added 7 gateway tests in `reviewWalkAndQ1Gaps.test.ts`: the one-click-per-family walk to exhaustion + terminal Save; `scope:'family'` leaving the cascaded entity as its own later chunk vs `scope:'cascade'` deciding it now; the CRITICAL Q1 edge (Reject-All / Defer-All / Approve-All on a partially-approved family all EXCLUDE the already-approved member, and the reject-surfaced relationship-ROW non-node id is still sent)
    - Did NOT write comprehensive coverage; skipped performance + accessibility
  - [x] 6.4 Run feature-specific tests only
    - Ran the gateway conversation suite (`gateway/src/services/discoveryReviewConversation/__tests__/`, 13 files incl. the new one) + the frontend room suite (`frontend/src/components/Discovery/DiscoveryReviewRoom.test.tsx`) + the parity guard
    - Confirmed the resolver parity guard stays GREEN UNCHANGED (`resolveBulkActionSet.parity.test.ts` passes; `rejectCascadeParityFixture.ts` + both `resolveBulkActionSet.ts` mirrors + `reviewModelWire.ts` + AMS `DiscoveryCascadeReviewService.java` all git-clean)
    - Totals: gateway conversation 61 + parity 1 = 62 gateway; frontend room 25 — all pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 20-50 tests total)
- Critical user workflows for this feature are covered (one-click-per-family review through to terminal Save; family-vs-cascade id sets)
- No more than 10 additional tests added when filling gaps
- The resolver parity guard (`resolveBulkActionSet.parity.test.ts` + `rejectCascadeParityFixture.ts`) is GREEN with NO fixture edits
- Testing focused exclusively on this spec's requirements

## Execution Order

Recommended implementation sequence (strict gateway-before-frontend layering):
1. Gateway turn shape + wire types + frontend mirror (Task Group 1)
2. Gateway cascade-preview builder (Task Group 2)
3. Gateway agenda dedup + four FAMILY_BULK_ACTIONS (Task Group 3)
4. Gateway coordinator immediate-apply + scope branch + next-chunk/exhaustion (Task Group 4)
5. Frontend ChunkSummaryView + room flow + API mirror consumption (Task Group 5)
6. Test review & gap analysis (Task Group 6)

## Untouched Boundaries (do not modify)

- `gateway/src/services/discovery/resolveBulkActionSet.ts` and its byte-for-byte frontend mirror `frontend/src/components/Discovery/resolveBulkActionSet.ts`
- `gateway/src/services/discovery/__tests__/resolveBulkActionSet.parity.test.ts` and `rejectCascadeParityFixture.ts` (keep GREEN, NO edits)
- The AMS `DiscoveryCascadeReviewService.bulkReviewCascade` pure applicator — no endpoint / DTO / Liquibase change
- `reviewDecisionOrchestrator.applyDecision` flat `candidate_ids[]` write path — unchanged (only WHICH ids are sent differs)
