# Discovery Review Room conversation redesign — remove the confirm box, rich cascade chunk summaries, shallow "Approve visible chunk", dedup of already-decided candidates, auto-advance + scroll, single final Save confirmation

## Context
The "Discovery Review Room" is the Architect chat (Current-State Discovery) that walks a deterministic agenda of discovery candidates for Approve/Reject/Defer review. A read-only trace of the current implementation is complete (file:line references in Technical Scope). The product decisions are ALREADY CONFIRMED with the user (see "Already-confirmed decisions" — do NOT re-litigate these).

## Problem (today)
Each "family chunk" (a parent + its DIRECT parent_child children — e.g. an interface + its endpoints) renders only the family, but "Approve all in this family" resolves the FULL cascade (interface→endpoints→logical entities→attributes…). Because the cascade escapes the visible family, the gateway raises a confirm gate (PendingConfirmationTurn) that renders as a turn at the BOTTOM of the transcript, below the long chunk, off-screen — unusable. Also: the agenda does NOT dedup already-decided candidates (they reappear), there is no shallow approve, and there is no auto-advance/auto-scroll after a decision.

## Changes

### (i) Replace the confirm box on family chunks with a rich cascade summary + four buttons
At chunk-build time the gateway computes the family's full-cascade preview (resolveBulkActionSet) and ships a structured summary the frontend renders as multi-line text, e.g.:
> Review the current 123 candidates:
> 1) The current seed 'My Interface' and its 10 endpoints
> 2) their associated 8 logical data entities and 104 logical data attributes

The total (123) = full-cascade count = seed(1) + endpoints(10) + logical entities(8) + attributes(104). Four buttons replace the old per-family Approve/Reject/Defer + the confirm gate:
- A) **Approve All** — approves all N (full cascade); idempotent on already-approved.
- B) **Approve visible chunk** — approves ONLY the family shown (seed + its direct children, e.g. interface + endpoints); the associated logical entities/attributes are NOT cascaded and instead come as their own later chunks. NEW shallow/non-cascading apply (the resolver currently only does full cascade).
- C) **Reject All** — as today (full reject cascade incl. the Spec A exclusivity / relationship-row behaviour).
- D) **Defer All** — as today.

### (iv) Already-approved annotations + dedup
When a chunk's cascade includes candidates already decided by an earlier chunk, the per-type lines annotate the already-approved subset, e.g.:
> Review the current 86 candidates:
> 1) The current seed 'Your Interface' and its 9 endpoints
> 2) their associated 6 logical data entities (3 already approved) and 70 logical data attributes (45 already approved)

Total still counts the full cascade (86 = 1+9+6+70); the "(N already approved)" are sub-counts within each type. AND already-decided candidates must NOT reappear as their own standalone chunks later — the agenda must exclude already-decided families (this is the current bug). Approving an already-approved candidate is a no-op.

### (ii) Auto-advance + scroll
After clicking ANY of the four chunk buttons: apply IMMEDIATELY (no confirm), automatically advance to + render the next chunk, and scroll the transcript so the TOP of the user's blue action message (the "You: Approve all in this family" bubble — the turn-user-message element) sits at the top of the viewport, so the just-appended next chunk directly below it is visible without manual scrolling.

### (iii) Conflicts apply immediately
The "Use <source>" / "Use <source> for all N" conflict-resolution choices apply IMMEDIATELY with no confirmation turn.

### Save (the only remaining confirmation)
At the very END of the conversation, keep a single "Save all approved candidates back to the architecture" confirmation with two options:
- "Yes" — same effect as the "Save All Approved" button in the non-conversation candidates table.
- "No" — do nothing further (the user can close the conversation and later use the candidates table's "Save All Approved" button).

All per-chunk and per-conflict gates are removed; this final Save Yes/No is the ONLY confirmation that remains.

## Technical scope (from the completed trace — for the spec to verify and detail)
- Gateway `gateway/src/services/discoveryReviewConversation/`:
  - `reviewTurnShape.ts` — ChunkSummaryTurn (~222-255) gains a structured cascade-preview (full-cascade total + per-type breakdown with already-approved sub-counts); add the "Approve visible chunk" action; retire PendingConfirmationTurn (~286-341) for chunk+conflict paths, keep only the final save confirmation.
  - `agendaSequencer.ts` — exclude already-decided candidates/families from the agenda (buildAgenda ~216-293, buildFamilies ~313-359 have NO status filter today); FAMILY_BULK_ACTIONS (~line 106) → the four actions incl. the new visible-chunk one.
  - `reviewConversationCoordinator.ts` — openConfirmationGate (~381-545): always apply immediately for apply-decision + resolve-conflict + resolve-conflicts-by-pattern (remove the overage gate ~412-443/457-481); keep the gate ONLY for the final save (Yes/No). After an applied decision, return the NEXT chunk in the outcome so the frontend auto-advances without a separate advance click.
  - `reviewDecisionOrchestrator.ts` — a non-cascading apply for "Approve visible chunk" (apply 'approved' to exactly the family node ids = parentId + parent_child childIds, no cascade).
- Resolver `gateway/src/services/discovery/resolveBulkActionSet.ts` (~317-592) + frontend byte-for-byte mirror `frontend/src/components/Discovery/resolveBulkActionSet.ts` (parity-tested) — add a shallow/family-only scope (seed + parent_child children only, no relationship-row cascade) for "Approve visible chunk"; expose the per-type cascade preview (counts by type + already-approved). BulkReviewAction enum + EdgeKind in `gateway/src/services/discovery/reviewModelWire.ts`.
- Frontend `frontend/src/components/Discovery/DiscoveryReviewRoom.tsx` — ChunkSummaryView (~1046-1208) renders the new multi-line cascade summary + four buttons; remove PendingConfirmationView (~1210-1314) for chunk/conflict turns, keep only the final Save Yes/No; applyOutcome (~479-509) auto-advances after an applied decision; add scrollIntoView anchored to the last user-message turn (chassis.turnUser, data-testid review-room-turn-user-message); conflicts apply immediately. `discoveryReviewApi.ts` (~297-346) mirrors the new turn shapes/outcomes.
- `review_status` lives on each ReviewModelNode (`reviewModelFull.ts` ~line 68); the model is re-fetched fresh each route call, so already-decided state is queryable mid-conversation for both the dedup and the annotations.

## Already-confirmed product decisions (do NOT re-ask)
1. The third action is **Defer** (user's "Refer" was a typo).
2. **Approve visible chunk** = family-only, with the logical entities/attributes deferred to their own later chunks; **Approve All** = full cascade so those entities are decided now and won't get their own chunk.
3. The chunk total = full-cascade count, with "(N already approved)" annotations and an idempotent Approve-All.
4. The ONLY remaining confirmation is the final Save-All-approved with "Yes" (= candidates-table "Save All Approved") and "No" (do nothing further).
