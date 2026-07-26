---
name: carry-over-triage-build-plan
description: "BUILD-READY (user said go, 2026-07-26): carry-over accounting on the plan review screen + LLM triage of unaccounted items with 4 dispositions (cite | amend story X | new story | dismiss), batch review + approve-all, amend-guidance field. Full design + verified mechanics + file anchors."
metadata: 
  node_type: memory
  type: project
  originSessionId: be941d5a-9751-4199-8b5b-fd6e694eb4f1
---

USER-AGREED DESIGN (2026-07-26, build without stopping, per-item merge --no-ff + push):

## The four dispositions (all LLM-drafted, ALL human-approved, gate maths deterministic)
1. **cite** — story text already demonstrably covers the finding; link only.
2. **amend_story** — finding in story X's scope but X doesn't address it: LLM
   drafts description update + added acceptance criteria; accepting applies
   amendment + cites finding + MARKS SPEC STALE (drops from stage readiness
   until regenerated with the finding folded in). Triage prompt must PREFER
   amend over cite when in doubt. **USER REQUIREMENT: free-text guidance field
   passed to the LLM when the user chooses/edits an amend** (also give
   new_story the same field — same drafting shape).
3. **new_story** — drafted title/description/AC/workstream grounded in finding
   evidence; accepting creates a REAL story that flows through normal LLM spec
   generation. Description must EMBED the finding's essence (don't rely on
   reference plumbing alone).
4. **dismiss** — with drafted reason; existing dismiss machinery.

**Batch UX (user requirement):** "Get suggestions" runs triage over ALL
unaccounted items → review list showing item + suggested disposition +
rationale + drafts; user edits individual items (change disposition, pick
target story, edit drafts, add guidance → re-draft) OR **"Approve all
suggestions"** applies everything in one go. Nothing auto-applies.

## Verified mechanics (all anchors checked 2026-07-26)
- Coverage model: `gateway/src/services/migrationCarryOverCoverage.ts` — PURE.
  Capability cited iff work_item.source_capability_id == cap.id; finding cited
  iff id ∈ any book item's discoveryFindingReferences OR rolls up under
  covered/dismissed capability; dismissed iff review_status ∈
  {rejected,dismissed} + non-empty reason. Must-account = behaviour-bearing.
- Reads: `migrationCarryOverCoverageReads.gatherCarryOverCoverageInputs`.
- Existing actions: `migrationCarryOverActions.ts` — citeCapability (via AMS
  `POST .../{bookId}/items/append-capability-story`, stamps column+blob in one
  tx), dismissCarryOverItem (PATCH review_status=dismissed + MANDATORY reason;
  findings need runId), generateAllCapabilityStories (batch).
- Existing routes (migrationExecution.ts): GET
  `.../migration-books-of-work/:bookId/carry-over-coverage` (:896), POST
  `.../carry-over/dismiss` (:944), POST
  `.../carry-over/generate-all-capability-stories` (:997).
- Generic story append: AMS `POST .../{bookId}/items/append`
  (GeneratedMigrationBookOfWorkController:213, atomic merge, draft-only guard
  service:1429 — NOTE: user's book is SAVED; verify append works post-save or
  needs the guard relaxed/a saved-book path!). append-test-item :305,
  append-capability-story :340.
- Spec staleness: MigrationStorySpecGenerationEntity has
  stale/staleMarkedAt/staleReason; regeneration clears (service :372-376,
  :892-897). NEED: find/create the MARK-stale write path callable from the
  gateway (MissingInputResolutionCascadeService sets it internally — check
  for an existing endpoint; else add a small AMS PATCH).
- FINDING-cite onto an EXISTING story: needs a book-item patch adding to
  discoveryFindingReferences (+ work item?) — NO existing route found; add
  AMS `items/{itemId}/cite-finding` (or fold into a generic item PATCH) that
  updates the blob (+ pessimistic lock precedent service:1572).
- Amend apply: patch book item description/acceptanceCriteria in the blob +
  cite finding + mark spec stale. Same new AMS item-patch surface.
- Gateway LLM helper: RESOLVED — `createAzureOpenAIClient(config): LlmClient`
  (`gateway/src/services/azureOpenaiClient.ts:335`) with
  `sendChatRequest(messages, requestId, sessionId, options)`; the a54f6b8
  rate-limit handling (llmRateLimit.ts) is wired into it. Usage patterns for
  JSON-structured responses: migrationBookOfWorkExpansionHandler /
  migrationShapeSpecGenerationHandler.
- Mark-stale: RESOLVED — NO existing AMS endpoint; precedent is service-side
  stamping (MissingInputResolutionCascadeService.java:182-185:
  setStale(TRUE) + setStaleReason(...) + setStaleMarkedAt(now) +
  setUpdatedAt). Add a small AMS endpoint (e.g. POST
  .../spec-generations/mark-stale-by-work-item {work_item_id, stale_reason},
  reason like 'story_amended_for_finding:<id>'). Columns exist — NO DDL.
- Existing FE carry-over UI: MigrationDeliveryMigratePanel (delivery
  dashboard) + tests — reuse patterns; NEW panel goes on the plan REVIEW
  screen (MigrationBookOfWorkReviewWorkspace) where the stage cards live.

## Build order (per-item branch → verify → merge --no-ff → push)
1. **Plumbing**: review-screen accounting panel (GET carry-over-coverage;
   list unaccounted with content), Stage-2 (service) card shows
   `carry-over accounted M/N` + included in Start enablement (mirrors the
   server gate which ALREADY blocks service starts on it — 3b162be); manual
   actions wired: dismiss (existing), create story (append/append-capability-
   story), cite finding→story + amend story (NEW AMS item-patch + stale
   mark). Kill the "advisory" banner doublespeak: say "N items need citing
   or dismissing before Stage 2 (Service) can start".
2. **Triage**: gateway `POST .../carry-over/triage` — per unaccounted item,
   LLM call (structured output) with item content (title/summary/evidence
   from detail_json) + compact story index (id/title/desc/workstream) →
   {disposition, targetBookItemId?, rationale, draftAmendment?, draftStory?,
   dismissReason?}; deterministic validation (target exists; workstream ∈
   known set; capability-cite constraint: source_capability_id occupancy —
   reject cite/amend onto a story already citing a different capability →
   prefer new_story); invalid → disposition null (FE: "needs manual choice").
  `POST .../carry-over/apply-triage` — apply approved suggestions
   sequentially, fail-soft per item, per-item results; refresh coverage.
   Per-item re-draft route accepting {forcedDisposition, guidance}.
3. **FE triage panel**: suggestions table (item, disposition dropdown ×4,
   target story picker, drafts expandable/editable, guidance textarea +
   "Re-draft", rationale), "Approve all suggestions", per-item Apply;
   amended stories visibly drop stage spec counts until regenerated via the
   existing Generate specs flow (VERIFY generation picks up stale rows).

## Context (why)
User ruling chain: per-plane runs merged `3b162be` (Start stage N = stage N
only; carry-over gates ONLY service starts). User: "the 37 items should
either create new specs OR be dismissed"; worry: "deterministic only
approach" → hence LLM triage + human approval; 4th disposition amend_story
is the user's own addition ("existing story may need edited so that it
actually deals with the finding"). Their live book: 61 accepted crit/high
findings, 37 behaviour-bearing unaccounted. Suspicion: many will triage to
cite/amend onto the deterministic per-endpoint stories.
[[four-pending-fixes-2026-07-25]]
