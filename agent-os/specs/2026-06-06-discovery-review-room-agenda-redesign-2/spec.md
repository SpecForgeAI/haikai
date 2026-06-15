# Specification: Discovery Review Room Agenda Redesign 2 (confirm-box removal + rich cascade chunks)

## Goal

Redesign the Discovery Review Room conversation so each family chunk carries a rich multi-line cascade summary plus four immediate-apply buttons (no off-screen confirm gate), auto-advances and scrolls after a decision, dedups already-decided families, and ends with a single Save Yes/No. Gateway conversation + frontend only; the parity-tested `resolveBulkActionSet` resolver, its parity fixture, and AMS are all untouched.

## User Stories

- As an architect reviewing discovery candidates, I want each family chunk to show me exactly what its Approve covers (full-cascade total, per-type breakdown, and how many are already approved/rejected/deferred) with the Approve/Reject/Defer/Approve-visible buttons right there, so I never have to scroll past a long chunk to find an off-screen "Confirm & apply" gate.
- As an architect, I want a decision to apply immediately and the conversation to advance to the next chunk and scroll it into view, and I want families I have already fully decided to never reappear, so reviewing is one click per family with no re-work.
- As an architect, I want the ONLY confirmation in the whole flow to be a single Save Yes/No at the very end, so committing approved candidates back to the architecture is a deliberate final step and everything before it is friction-free.

## Specific Requirements

**1. Four-button family chunk with a rich cascade summary (feature i)**
- Each FAMILY chunk renders a multi-line cascade summary from the new `cascadePreview` field (Requirement 5) and FOUR buttons that replace the old per-family Approve/Reject/Defer plus the confirm gate.
- A) Approve All = full cascade (`scope:'cascade'`), idempotent on already-approved members; cascaded logical entities/attributes are decided now and do NOT get their own later chunk.
- B) Approve visible chunk = family-only (`scope:'family'` = seed plus its direct `parent_child` children, via `deriveFamilyForSeed`); the associated logical entities/attributes are NOT cascaded and arrive as their own later chunks; no-ops already-decided members.
- C) Reject All = full reject cascade as today, including the Spec A exclusivity / relationship-row surfacing owned by `2026-06-05-reject-cascade-correctness`.
- D) Defer All = full defer cascade as today.
- The confirm box (`PendingConfirmationTurn` / `PendingConfirmationView`) is REMOVED from the chunk path; it survives ONLY for the terminal Save (Requirement 8).

**2. Immediate apply + auto-advance + scroll (feature ii)**
- Clicking ANY of the four chunk buttons applies IMMEDIATELY with no confirmation: `openConfirmationGate` no longer appends a `pending-confirmation` turn for `apply-decision`.
- The coordinator returns the NEXT chunk inside the `'applied'` outcome so the frontend auto-advances and renders it without a separate "Show next chunk" click (the manual advance button behaviour is replaced by this).
- The frontend calls `scrollIntoView` anchored to the user's last blue action message turn (`data-testid="review-room-turn-user-message"` / `chassis.turnUser`) so the TOP of that message sits at the viewport top and the just-appended next chunk directly below it is visible without manual scrolling.

**3. Conflicts apply immediately, in place (feature iii)**
- "Use \<source\>" / "Use \<source\> for all N" (`resolve-conflict` / `resolve-conflicts-by-pattern`) apply IMMEDIATELY with no confirmation and RE-RENDER the SAME chunk with the conflict cleared.
- Conflict resolution does NOT auto-advance — ONLY the four disposition buttons apply-then-advance. The coordinator returns the same (refreshed) chunk for the conflict path, not the next one.

**4. Dedup of already-decided families + per-type annotations (feature iv)**
- A family is presented as a chunk IFF it still has at least one actionable member, where actionable = `review_status` pending AND not `committed`. A fully-decided family (every member decided/committed) is EXCLUDED from the agenda — this is the dedup fix; add the `review_status`/`committed` filter to `buildFamilies` / `buildAgenda`, which have none today.
- Within a SHOWN family, already-decided members render read-only / annotated and are NOT re-actioned; Approve visible chunk and Approve All no-op them.
- The per-type breakdown annotates ALL THREE dispositions separately — "(N already approved)", "(N already rejected)", "(N already deferred)" — not only approved.

**5. `cascadePreview` field on `ChunkSummaryTurn` (S2 — gateway-only builder)**
- Add a structured `cascadePreview` field to `ChunkSummaryTurn` carrying the full-cascade `total` plus a per-`candidate_type` breakdown, each type with `count` and the three sub-counts `alreadyApproved` / `alreadyRejected` / `alreadyDeferred` (final field shape at the spec's discretion provided it carries total + per-type counts + the three already-* sub-counts).
- A NEW gateway-only builder computes it over the FULL review model the coordinator already holds (`FullReviewModelWire` nodes carrying `candidate_type`, `review_status`, `committed`); it must be PURE and cycle-safe like the sequencer and `deriveFamilyForSeed`.
- This does NOT widen the parity-tested resolver wire, so there is NO resolver or parity-fixture churn for the preview.
- The frontend `ChunkSummaryView` renders the multi-line summary from this field (full-cascade total line + per-type lines with the "(N already …)" annotations). Keep the field additive/optional on the closed `ReviewTurn` union so non-family chunks still validate.

**6. Shallow vs full apply branch (S1 — coordinator-only)**
- Add a `scope: 'family' | 'cascade'` discriminator to the `apply-decision` intent.
- `scope:'family'` applies the EXACT family id set from the existing exported pure `deriveFamilyForSeed(seeds, model)` (seed plus direct `parent_child` children) directly to the AMS bulk-review applicator.
- `scope:'cascade'` applies the resolver's FULL touched set exactly as today.
- The shallow id-set selection lives ENTIRELY in the coordinator; `resolveBulkActionSet` stays PURE with no shallow flag. The orchestrator's flat `candidate_ids[]` write path is unchanged — only WHICH ids are sent differs.

**7. Generalisation to DB scans + cross-scan links (Q2)**
- The per-type breakdown is type-driven from `candidate_type`, so a DATABASE-scan family (a physical entity / table → its columns, plus cross-scan logical↔physical mappings) renders analogously (e.g. "1) The current table 'ORDERS' and its 24 columns; 2) their associated 2 logical data entities and 18 logical data attributes").
- Cross-scan-LINK chunks are NOT parent families and have no shallow-vs-full distinction → they KEEP the existing per-item treatment. The four-button rich-summary layout applies to FAMILY chunks ONLY.

**8. Terminal Save Yes/No is the only remaining confirmation (Q3)**
- When an apply leaves the agenda exhausted (`nextCursor === null` / `nextChunk === null`), auto-append a single terminal "Save all approved candidates back to the architecture?" turn with Yes/No — the ONLY surviving `PendingConfirmationTurn` / `PendingConfirmationView` use.
- "Yes" == the same effect as the non-conversation candidates-table "Save All Approved" button; "No" == do nothing further (the user closes the conversation; the candidates table remains the anytime escape hatch). There is NO mid-conversation save affordance.
- The end-of-agenda scroll still scrolls the user's last blue action message to the top, leaving the Save prompt visible below it.

**9. Layering and untouched boundaries**
- Gateway `discoveryReviewConversation/` does the bulk of the work: `reviewTurnShape.ts` (`cascadePreview`, retire confirm for chunk/conflict, new visible-chunk action), `agendaSequencer.ts` (dedup filter; four `FAMILY_BULK_ACTIONS`), `reviewConversationCoordinator.ts` (immediate-apply for decision + conflict, gate only the final save, return next-chunk/exhaustion in the `'applied'` outcome, the `scope` branch, host the new preview builder), `reviewDecisionOrchestrator.ts` (unchanged write path).
- Frontend: `DiscoveryReviewRoom.tsx` (`ChunkSummaryView` four buttons + multi-line summary, `applyOutcome` auto-advance + `scrollIntoView`, conflicts-in-place, terminal Save) and `discoveryReviewApi.ts` (mirror the new turn shape, `'applied'` next-chunk, and the `scope` field).
- EXPLICITLY UNTOUCHED: `resolveBulkActionSet.ts` (gateway + its byte-for-byte frontend mirror) and its parity fixture; the AMS `DiscoveryCascadeReviewService.bulkReviewCascade` pure applicator (no endpoint / DTO / Liquibase change).

**10. Test strategy (S3)**
- Gateway unit tests (`gateway/src/services/discoveryReviewConversation/__tests__/`): the dedup/exclusion filter (fully-decided families dropped; partially-decided kept with the actionable subset); shallow `scope:'family'` apply (exactly `deriveFamilyForSeed` ids) vs full `scope:'cascade'` apply (resolver touched set); the no-confirm immediate-apply path for chunk decisions AND conflicts; the next chunk returned inside the `'applied'` outcome; auto-Save-on-exhaustion (terminal Save turn appended when `nextCursor === null`); the `cascadePreview` per-type breakdown with the three already-* sub-counts.
- Frontend tests (`frontend/src/components/Discovery/DiscoveryReviewRoom.test.tsx`): the four buttons (presence + correct intent/`scope`); the multi-line summary incl. the "(N already approved/rejected/deferred)" annotations; auto-advance + `scrollIntoView` with the DOM call MOCKED; conflicts applying immediately and re-rendering in place (no advance); the terminal Save Yes/No (Yes triggers the save-all effect, No is a no-op).
- Parity: NO resolver parity-fixture change — keep `resolveBulkActionSet.parity.test.ts` and `rejectCascadeParityFixture.ts` GREEN unchanged.

## Visual Design

No visual assets provided. `planning/visuals/` exists but is empty — this is a behavioural change over the existing conversation and candidates-table surfaces, so no mockups are expected. Illustrative summary prose lives in the requirements (e.g. "Review the current 123 candidates: 1) The current seed 'My Interface' and its 10 endpoints; 2) their associated 8 logical data entities and 104 logical data attributes"); exact wording is at the spec's discretion.

## Existing Code to Leverage

**`gateway/src/services/discoveryReviewConversation/reviewConversationCoordinator.ts` (`openConfirmationGate` ~381-545, `deriveFamilyForSeed` ~689-701, `confirmPending` ~580-673)**
- Remove the overage gate (~412-443 / 457-481) so `apply-decision`, `resolve-conflict`, and `resolve-conflicts-by-pattern` always apply immediately; keep the gate ONLY for the final `save`, which still flows through `confirmPending` re-validation. Reuse the EXPORTED PURE `deriveFamilyForSeed` as-is for the `scope:'family'` id set, and host the new gateway-only `cascadePreview` builder here (or a sibling it calls) over the model the coordinator already holds.

**`gateway/src/services/discoveryReviewConversation/agendaSequencer.ts` (`buildAgenda` ~216-293, `buildFamilies` ~313-359, `FAMILY_BULK_ACTIONS` ~106)**
- `buildFamilies` already bands on `committed` / `has_live_conflict` / `blast_radius` but never drops decided nodes — add the `review_status`/`committed` dedup so fully-decided families are excluded and partially-decided families keep only their actionable subset (Q1). Expand `FAMILY_BULK_ACTIONS` to the four actions including the new visible-chunk one. Stays a pure function of model + cursor.

**`gateway/src/services/discoveryReviewConversation/reviewModelFull.ts` (`FullReviewModelWire` ~60-81, `aggregations.by_candidate_type` ~110-121)**
- Nodes carry `candidate_type` (S2 breakdown), `review_status` (~67-68; Q1 dedup + the annotations), and `committed`; the model is re-fetched FRESH each route call, so already-decided state is reliably queryable mid-conversation for both the dedup and the per-type annotations. The new preview builder reads this; no new model field or computation.

**`gateway/src/services/discoveryReviewConversation/reviewTurnShape.ts` (`ChunkSummaryTurn` ~222-255, `PendingConfirmationTurn` ~286-341) and `reviewDecisionOrchestrator.ts` (`applyDecision` ~189-233)**
- Add `cascadePreview` and the visible-chunk action to `ChunkSummaryTurn`; retire `PendingConfirmationTurn` for the chunk + conflict paths (Save only). `applyDecision` sends a FLAT `candidate_ids[]` to the unchanged AMS apply path — the shallow apply only changes which ids are sent (the `deriveFamilyForSeed` set vs the resolver touched set); no new write path.

**`frontend/src/components/Discovery/DiscoveryReviewRoom.tsx` (`ChunkSummaryView` ~1046-1208, `PendingConfirmationView` ~1210-1314, `applyOutcome` ~479-509, intent helpers `applyDecisionIntentFor` / `familyBulkIntentFor` ~238-259) and `frontend/src/api/discoveryReviewApi.ts` (~297-346)**
- Render the four buttons + the multi-line `cascadePreview` summary in `ChunkSummaryView`; remove `PendingConfirmationView` for chunk/conflict (keep for the terminal Save); make `applyOutcome` `'applied'` auto-advance from the outcome's next chunk and call `scrollIntoView` on the last user-message turn; replace the manual "Show next chunk" advance (`onAdvance(turn.nextCursor)` ~1195-1205); have the intent helpers set the new `scope` (`'family'` for Approve-visible-chunk, `'cascade'` for Approve All); mirror the new turn shape / `'applied'` next-chunk / `scope` in `discoveryReviewApi.ts`.

## Out of Scope

- Any change to the parity-tested `resolveBulkActionSet` cascade algorithm or its parity fixture (`resolveBulkActionSet.parity.test.ts`, `rejectCascadeParityFixture.ts`) — the shallow apply is coordinator-only and the preview is gateway-only; the reject-exclusivity algorithm is owned by `2026-06-05-reject-cascade-correctness`.
- Any AMS endpoint / DTO / Liquibase changeset change — `bulkReviewCascade` is a pure applicator that writes exactly the ids it is handed.
- The non-conversation candidates table itself, referenced ONLY as the Save escape hatch (the terminal "Yes" mirrors its "Save All Approved" effect).
- A four-button rich-summary layout for cross-scan-LINK chunks (they keep the existing per-item treatment).
- Any mid-conversation save affordance (Save is end-only, on agenda exhaustion).
- Scan-selection / multi-service tiering; folding findings into family chunks.
- Re-deriving conflicts, cascades, or blast radius in the sequencer or the preview builder — both stay pure reads of the precomputed full model.
