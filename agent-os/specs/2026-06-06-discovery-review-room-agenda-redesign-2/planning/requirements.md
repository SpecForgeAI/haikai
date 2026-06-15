# Spec Requirements: Discovery Review Room Conversation Redesign (agenda-redesign-2)

> AUTHORITATIVE, BUILD-READY requirements. Every clarifying question is resolved
> and user-approved. `planning/raw-idea.md` remains the comprehensive problem
> statement; this document is the settled contract the spec-writer builds against.
> The read-only codebase trace is complete — do NOT re-trace; the file:line
> references below were verified against source during research.

## Initial Description

The "Discovery Review Room" is the conversational Architect persona over
current-state Discovery candidates. It walks a deterministic agenda of candidate
"family chunks" (a parent seed + its DIRECT `parent_child` children — e.g. an
interface + its endpoints) for Approve / Reject / Defer review.

This spec redesigns the conversation:

- **(i)** Replace the per-chunk confirm box with a rich cascade summary + FOUR
  buttons on each family chunk (Approve All / Approve visible chunk / Reject All
  / Defer All).
- **(ii)** Immediate-apply + auto-advance + scroll after any of the four chunk
  buttons.
- **(iii)** Conflict resolution applies immediately (no confirm) and re-renders
  the SAME chunk with the conflict cleared (does NOT auto-advance).
- **(iv)** Already-decided annotations + dedup of fully-decided families from the
  agenda; the per-type breakdown annotates all three dispositions.
- **Save:** a single terminal "Save all approved candidates back to the
  architecture?" Yes/No is the ONLY remaining confirmation, surfaced ONLY when the
  agenda is exhausted.

Follow-on to the committed `2026-06-05-review-room-agenda-redesign` (family chunks
+ cascade-aware confirm-skip) and `2026-06-05-reject-cascade-correctness` (reject
exclusivity + relationship-row surfacing), on the Spec 1/2/3 review-model +
cascade backbone.

## Requirements Discussion

### Originally-confirmed product decisions (carried forward from the raw idea)

These four were confirmed with the user before research and are settled:

1. The third disposition is **Defer** ("Refer" in the raw idea was a typo).
2. **Approve visible chunk** = family-only (seed + direct `parent_child`
   children); the associated logical entities/attributes are NOT cascaded and
   instead arrive as their own later chunks. **Approve All** = full cascade, so
   those cascaded entities are decided now and will NOT get their own later chunk.
3. The chunk total = full-cascade count, rendered with "(N already …)"
   annotations, and Approve-All is idempotent on already-approved candidates.
4. The ONLY remaining confirmation is the final Save-All-approved Yes/No — "Yes" ==
   the candidates-table "Save All Approved" button; "No" == do nothing further.

### Settled implementation decisions (S1–S3, user-approved)

**S1 — "Approve visible chunk" mechanism (shallow apply).**
Add a `scope: 'family' | 'cascade'` discriminator to the `apply-decision` intent.

- For `scope: 'family'`, the coordinator applies the EXACT family set from the
  existing exported pure helper `deriveFamilyForSeed(seeds, model)` (seed ∪ its
  direct `parent_child` children) directly to the AMS bulk-review applicator.
- For `scope: 'cascade'`, the coordinator applies the resolver's FULL touched set
  exactly as today.
- The AMS applicator writes EXACTLY the `candidate_ids` it is handed with NO
  server-side re-expansion → **NO AMS change is needed.**
- `resolveBulkActionSet` stays PURE — there is NO shallow flag inside the
  resolver. The shallow id-set selection lives entirely in the coordinator.

**S2 — Rich cascade summary computation (gateway-only builder).**
A NEW gateway-only chunk-preview builder computes the per-type breakdown +
already-decided sub-counts over the FULL review model the coordinator already
holds (`FullReviewModelWire`, whose nodes carry `candidate_type`,
`review_status`, `committed`).

- Attach the result to `ChunkSummaryTurn` as a NEW structured field:

  ```
  cascadePreview: {
    total: number,
    byType: Array<{
      type: string,            // candidate_type
      count: number,           // full-cascade count of this type
      alreadyApproved: number,
      alreadyRejected: number,
      alreadyDeferred: number
    }>
  }
  ```

  (Final field shape is at the spec's discretion provided it carries total +
  per-type counts + the three already-* sub-counts.)
- This does NOT widen the parity-tested resolver wire → NO resolver/parity-fixture
  churn for the preview.

**S3 — Test scope.** See the "Test Strategy" section below for the full
breakdown. Headline: gateway unit tests + frontend tests only; **no resolver
parity-fixture change is required** (preview is gateway-only; shallow apply is
coordinator-only).

### Resolved edge cases (Q1–Q4, user-approved)

**Q1 — Partially-decided families.**

- A family is presented as a chunk IFF it still has ≥1 actionable member, where
  "actionable" = pending AND non-committed. A FULLY-decided family (every member
  decided/committed) is EXCLUDED from the agenda. This is the dedup fix.
- Within a SHOWN family, already-decided members render read-only / annotated and
  are NOT re-actioned. "Approve visible chunk" no-ops the already-decided members.
- The per-type breakdown annotates ALL THREE dispositions —
  "(N already approved)", "(N already rejected)", "(N already deferred)" — not
  only approved. (So "already approved" in the raw idea generalises to "any
  terminal disposition", each surfaced separately.)

**Q2 — Generalisation to DB scans + cross-scan links.**

- The per-type breakdown is fully type-driven from `candidate_type`, so a
  DATABASE-scan family (a physical entity / table → its columns, plus cross-scan
  logical↔physical mappings) renders analogously. Example phrasing:
  > 1) The current table 'ORDERS' and its 24 columns;
  > 2) their associated 2 logical data entities and 18 logical data attributes.
- Cross-scan-LINK chunks are NOT parent families (there is no shallow-vs-full
  distinction for them) → they KEEP the existing per-item treatment. The
  four-button rich-summary layout applies to FAMILY chunks ONLY.

**Q3 — Final Save is END-ONLY.**

- When an apply leaves the agenda exhausted (`nextCursor === null` /
  `nextChunk === null`), auto-append the terminal "Save all approved candidates
  back to the architecture?" turn with Yes/No.
- "Yes" == the same effect as the non-conversation candidates-table "Save All
  Approved" button.
- "No" == do nothing further (the user closes the conversation; the candidates
  table remains the anytime escape hatch).
- There is NO mid-conversation save affordance.
- The end-of-agenda scroll still scrolls the user's last action (blue) message to
  the top, leaving the Save prompt visible below it.

**Q4 — Conflicts resolve in place; do NOT auto-advance.**

- Conflict resolution ("Use \<source\>" / "Use \<source\> for all N") applies
  IMMEDIATELY with no confirmation AND re-renders the SAME chunk with the conflict
  cleared — it does NOT advance to the next chunk.
- ONLY the four disposition buttons (Approve All / Approve visible chunk / Reject
  All / Defer All) apply-then-auto-advance + scroll.

## Existing Code to Reference

All file:line references below were verified against source during the read-only
trace (line numbers accurate within a few lines).

### Gateway conversation — `gateway/src/services/discoveryReviewConversation/`

- `reviewTurnShape.ts`
  - `ChunkSummaryTurn` (~222–255) GAINS the structured `cascadePreview` field
    (S2). Add the "Approve visible chunk" action to the chunk's action set.
  - `PendingConfirmationTurn` (~286–341) is RETIRED for the chunk + conflict
    paths; it remains ONLY for the final Save confirmation.
- `agendaSequencer.ts`
  - `buildAgenda` (~216–293) and `buildFamilies` (~313–359) have NO
    `review_status` filter today — add the dedup so FULLY-decided families are
    excluded (Q1). `buildFamilies` banding currently reads
    `committed`/`has_live_conflict`/`blast_radius` but never drops decided nodes.
  - `FAMILY_BULK_ACTIONS` (~line 106) → the FOUR actions including the new
    visible-chunk one.
- `reviewConversationCoordinator.ts`
  - `openConfirmationGate` (~381–545): always apply IMMEDIATELY for
    `apply-decision` + `resolve-conflict` + `resolve-conflicts-by-pattern` (remove
    the overage gate ~412–443 / 457–481). Keep the gate ONLY for the final `save`.
  - After an applied decision, return the NEXT chunk in the `'applied'` outcome so
    the frontend auto-advances without a separate advance click. When there IS no
    next chunk, signal exhaustion so the terminal Save turn is appended (Q3).
  - Branch the `apply-decision` write between `scope:'family'` (use
    `deriveFamilyForSeed`) and `scope:'cascade'` (use the resolver's full touched
    set) — S1.
  - `deriveFamilyForSeed` (~689–701) — EXPORTED + PURE; the shallow id-set source
    (seed ∪ direct `parent_child` children). REUSED as-is.
  - `confirmPending` (~580–673) keeps re-validation; only the `save` intent flows
    through it after the redesign.
  - Host the NEW gateway-only cascade-preview builder here (or a sibling module it
    calls), reading the full model the coordinator already holds — S2.
- `reviewDecisionOrchestrator.ts`
  - `applyDecision` (~189–233) sends a FLAT `candidate_ids[]` to the unchanged
    AMS apply path — the shallow apply just changes WHICH ids are sent (the
    `deriveFamilyForSeed` set instead of the resolver's full touched set). No new
    write path; same applicator.
- `reviewModelFull.ts`
  - `FullReviewModelWire` (~60–81) nodes carry `candidate_type` (used by S2),
    `review_status` (~line 67/68, used by Q1 dedup + the annotations), and
    `committed`. `aggregations.by_candidate_type` (~110–121) exists.
  - The model is re-fetched FRESH each route call, so already-decided state is
    queryable mid-conversation for both the dedup and the annotations.

### Resolver (parity-mirrored) — UNCHANGED by this spec

- `gateway/src/services/discovery/resolveBulkActionSet.ts` (~317–592) and its
  byte-for-byte frontend mirror
  `frontend/src/components/Discovery/resolveBulkActionSet.ts` (parity-tested):
  used as-is for the `scope:'cascade'` full touched set + the full-cascade total.
  **No change** — the per-type preview is gateway-only (S2) and the shallow apply
  is coordinator-only (S1), so neither the resolver wire nor the parity fixture
  changes.
- Wire: `gateway/src/services/discovery/reviewModelWire.ts` (`BulkReviewAction`
  enum, `EdgeKind`). Unchanged unless the spec needs the new visible-chunk action
  surfaced in a shared enum — if so it must NOT alter the parity-tested resolver
  node shape (`{ id, review_status }`, ~128–136).

### Frontend room — `frontend/src/components/Discovery/`

- `DiscoveryReviewRoom.tsx`
  - `ChunkSummaryView` (~1046–1208) renders the new multi-line cascade summary
    (from `cascadePreview`) + the FOUR buttons.
  - `PendingConfirmationView` (~1210–1314) is REMOVED for chunk/conflict turns;
    it remains ONLY for the final Save Yes/No.
  - `applyOutcome` `'applied'` case (~486–495 / ~479–509) auto-advances by setting
    the next chunk from the outcome and scrolls.
  - Add `scrollIntoView` anchored to the LAST user-message turn
    (`data-testid="review-room-turn-user-message"`, `chassis.turnUser`,
    ~1014–1020) so its TOP sits at the viewport top.
  - Replace the manual "Show next chunk" advance button
    (`onAdvance(turn.nextCursor)`, ~1195–1205) behaviour with the auto-advance.
  - Conflict choices apply immediately and re-render the same chunk (Q4).
  - Intent helpers `applyDecisionIntentFor` / `familyBulkIntentFor` (~238–259)
    set the new `scope` discriminator (`'family'` for Approve-visible-chunk,
    `'cascade'` for Approve All).
- `frontend/src/api/discoveryReviewApi.ts` (~297–346) mirrors the new turn shape
  (`cascadePreview`) + the `'applied'` outcome's next-chunk + the new `scope`
  field on the apply-decision intent.

### AMS — UNCHANGED (pure applicator, decisive)

`DiscoveryCascadeReviewService.bulkReviewCascade`
(`architecture-model-service/.../service/discovery/DiscoveryCascadeReviewService.java:134–180`)
is a PURE APPLICATOR: it applies the requested `review_status` to EXACTLY the
supplied `candidate_ids[]` (+ `finding_ids[]`), with NO server-side cascade
re-expansion. "Cascade" in the AMS name refers ONLY to spanning candidates +
findings atomically in one `@Transactional` boundary (committed rows skipped;
same-status rows counted `alreadyInTarget`; any out-of-scope id → 404 rollback).
⇒ "Approve visible chunk" needs ONLY a family-only id set passed to the existing
endpoint — **no AMS endpoint/DTO/changeset change.**

### Existing tests (suites to extend; the parity guard stays green untouched)

- Gateway conversation suites
  `gateway/src/services/discoveryReviewConversation/__tests__/` —
  `reviewConfirmSkip.test.ts`, `reviewFamilyBulkIntent.test.ts`,
  `agendaSequencerFamilies.test.ts`, `reviewEngine.test.ts`,
  `reviewDefectFixes.test.ts`, `discoveryReviewConversationStore.test.ts`,
  `selectedScanSet.test.ts`.
- Resolver parity guard `gateway/src/services/discovery/__tests__/` —
  `resolveBulkActionSet.test.ts`, `resolveBulkActionSet.parity.test.ts` +
  `rejectCascadeParityFixture.ts`. These must remain GREEN with NO fixture edits
  (the resolver is untouched).
- Frontend room suite
  `frontend/src/components/Discovery/DiscoveryReviewRoom.test.tsx`.

### Existing similar features identified by the user

No NEW similar-feature paths were supplied beyond the two directly-preceding specs
this builds on (`2026-06-05-review-room-agenda-redesign`,
`2026-06-05-reject-cascade-correctness`) and the Spec 1/2/3 review-model + cascade
backbone. All relevant code is enumerated above.

## Visual Assets

No visual assets provided. `planning/visuals/` exists but is EMPTY (verified via
directory listing during research and re-verified at finalisation). This is a
behavioural change over existing conversation/candidate-table surfaces, so no
mockups are expected.

## Requirements Summary

### Functional Requirements

The four feature areas (i)–(iv) mapped to concrete behaviour:

**(i) Four-button family chunk with a rich cascade summary.**
Each FAMILY chunk renders a multi-line cascade summary built from
`cascadePreview` (S2) — a full-cascade total plus per-`candidate_type` lines with
"(N already approved/rejected/deferred)" sub-counts (Q1) — and FOUR buttons that
replace the old per-family Approve/Reject/Defer + the confirm gate:

- **A) Approve All** — applies the FULL cascade (`scope:'cascade'`); idempotent on
  already-approved members. Cascaded entities are decided now and will NOT get
  their own later chunk.
- **B) Approve visible chunk** — applies ONLY the visible family
  (`scope:'family'` = seed ∪ direct `parent_child` children, via
  `deriveFamilyForSeed`). The associated logical entities/attributes are NOT
  cascaded and arrive as their own later chunks. No-ops already-decided members.
- **C) Reject All** — full reject cascade as today (incl. the Spec A exclusivity
  / relationship-row behaviour owned by reject-cascade-correctness).
- **D) Defer All** — full defer cascade as today.

Example summaries (illustrative — exact prose at the spec's discretion):

> Review the current 123 candidates:
> 1) The current seed 'My Interface' and its 10 endpoints
> 2) their associated 8 logical data entities and 104 logical data attributes

> Review the current 86 candidates:
> 1) The current seed 'Your Interface' and its 9 endpoints
> 2) their associated 6 logical data entities (3 already approved) and 70 logical
>    data attributes (45 already approved)

DB-scan family analogue (Q2):

> 1) The current table 'ORDERS' and its 24 columns;
> 2) their associated 2 logical data entities and 18 logical data attributes.

Cross-scan-LINK chunks are NOT families → KEEP the existing per-item treatment
(no four-button layout).

**(ii) Immediate apply + auto-advance + scroll.**
Clicking ANY of the four chunk buttons: apply IMMEDIATELY (no confirm) →
coordinator returns the NEXT chunk in the `'applied'` outcome → frontend renders
it → `scrollIntoView` puts the TOP of the user's blue action message at the
viewport top so the just-appended next chunk directly below is visible without
manual scrolling. When the apply exhausts the agenda, append the terminal Save
turn instead of a next chunk (Q3).

**(iii) Conflicts apply immediately, in place.**
"Use \<source\>" / "Use \<source\> for all N" apply IMMEDIATELY with no confirm and
RE-RENDER the SAME chunk with the conflict cleared. They do NOT auto-advance (Q4).

**(iv) Already-decided annotations + dedup.**
Fully-decided families are EXCLUDED from the agenda (the dedup fix — Q1). Shown
families render already-decided members read-only/annotated; the per-type
breakdown annotates all three dispositions; Approve-All / Approve-visible-chunk
no-op already-decided members.

**Save (the only remaining confirmation).**
A single terminal "Save all approved candidates back to the architecture?" Yes/No,
surfaced ONLY when the agenda is exhausted (Q3). "Yes" == candidates-table "Save
All Approved"; "No" == nothing further. No mid-conversation save. All per-chunk and
per-conflict gates are removed.

### Architecture / Approach (S1–S3) and Layering

Layering — **gateway → resolver-untouched → frontend**:

- **Gateway (the bulk of the work).**
  - Sequencer: dedup fully-decided families (Q1); four `FAMILY_BULK_ACTIONS`.
  - Turn shape: `cascadePreview` on `ChunkSummaryTurn`; retire
    `PendingConfirmationTurn` for chunk/conflict; new visible-chunk action.
  - Coordinator: immediate-apply for decision + conflict paths; gate ONLY the
    final save; return next-chunk (or exhaustion) in the `'applied'` outcome;
    branch `scope:'family'` (`deriveFamilyForSeed`) vs `scope:'cascade'` (resolver
    full set) — S1; host the NEW gateway-only cascade-preview builder over the
    full model — S2.
  - Orchestrator: unchanged flat `candidate_ids[]` write path; shallow apply just
    changes which ids are sent.
- **Resolver — UNTOUCHED.** Used as-is for the `scope:'cascade'` full touched set
  and full-cascade total. The per-type preview is gateway-only (S2); the shallow
  apply is coordinator-only (S1). Neither the parity-tested resolver wire
  (`{ id, review_status }`) nor the parity fixture changes — the parity guard
  stays green with NO edits.
- **Frontend.** `ChunkSummaryView` renders the four buttons + the multi-line
  cascade summary (incl. the "(N already …)" annotations); `applyOutcome`
  auto-advances + `scrollIntoView`; conflicts apply immediately and re-render in
  place; the terminal Save Yes/No is the only remaining `PendingConfirmationView`
  use; `discoveryReviewApi.ts` mirrors the new turn shape / outcome / `scope`.
- **AMS — UNTOUCHED** (pure applicator).

### Test Strategy (S3)

**Gateway unit tests:**

- The already-decided dedup / exclusion filter (fully-decided families dropped;
  partially-decided families kept with the actionable subset).
- The shallow `scope:'family'` apply (exactly `deriveFamilyForSeed` ids) vs the
  full `scope:'cascade'` apply (resolver touched set).
- The no-confirm immediate-apply path for chunk decisions AND conflicts.
- The next chunk returned inside the `'applied'` outcome (auto-advance source).
- The auto-Save-on-agenda-exhaustion (terminal Save turn appended when
  `nextCursor === null`).

**Frontend tests:**

- The four buttons (presence + correct intent/`scope` per button).
- The multi-line cascade summary including the "(N already approved/rejected/
  deferred)" annotations.
- Auto-advance + `scrollIntoView` with the DOM call MOCKED.
- Conflicts applying immediately and re-rendering in place (no advance).
- The terminal Save Yes/No (Yes triggers the save-all effect; No is a no-op).

**Parity:** NO resolver parity-fixture change is required — the preview is
gateway-only and the shallow apply is coordinator-only. Keep
`resolveBulkActionSet.parity.test.ts` + `rejectCascadeParityFixture.ts` GREEN
unchanged.

### Scope Boundaries

**In scope:**
- Gateway conversation: turn shape (`cascadePreview`, retire confirm for
  chunk/conflict, new visible-chunk action); sequencer dedup of fully-decided
  families; coordinator immediate-apply + next-chunk-in-outcome + the
  `scope:'family'|'cascade'` branch + the gateway-only per-type preview builder;
  unchanged orchestrator write path.
- Frontend room: four buttons, rich multi-line summary, auto-advance, scroll,
  conflicts-immediate-in-place, terminal Save Yes/No; API wire mirror.

**Out of scope:**
- Any AMS endpoint / DTO / Liquibase changeset change (pure applicator confirmed).
- Any change to the parity-tested resolver algorithm or its parity fixture (the
  reject-exclusivity algorithm is owned by `reject-cascade-correctness`).
- Scan-selection / tiering; findings-into-families folding.
- A four-button rich-summary layout for cross-scan-LINK chunks (they keep the
  existing per-item treatment — Q2).
- Any mid-conversation save affordance (Save is end-only — Q3).

### Technical Considerations

- AMS / discovery-service speak snake_case on the wire; the conversation
  turn/outcome shapes are the gateway's OWN closed-union shapes mirrored
  byte-for-shape in `frontend/src/api/discoveryReviewApi.ts` — keep that mirror in
  lockstep for the new `cascadePreview` field, the `'applied'` next-chunk, and the
  new `scope` discriminator.
- The resolver, sequencer, and `deriveFamilyForSeed` are PURE (no I/O / clock /
  globals). The new gateway-only cascade-preview builder must likewise be PURE and
  cycle-safe (it reads the full model the coordinator already holds).
- The full review model is re-fetched FRESH each route call, so already-decided
  `review_status` is reliably queryable mid-conversation for BOTH the dedup (Q1)
  and the per-type annotations (S2 / Q1).
- The shallow apply reuses the EXISTING flat-`candidate_ids[]` AMS apply path —
  only the id SELECTION differs (`deriveFamilyForSeed` set vs resolver touched
  set), so no new write path and no AMS contract change.
