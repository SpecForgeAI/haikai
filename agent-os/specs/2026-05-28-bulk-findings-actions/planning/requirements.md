# Spec Requirements: Bulk Findings Actions

## Initial Description

Extend the Findings tab (shipped 2026-05-16 + UI follow-ups 2026-05-28) with a
bulk-action toolbar so reviewers can transition many findings at once instead of
opening the per-row drawer. UX already settled in shaping: a segmented scope
toggle `[ All (N) | Filtered (M) ]` followed by four action buttons `[Accept
(X)] [Ignore (X)] [Needs Review (X)] [Mark Resolved (X)]`, a confirmation modal
for every bulk action, optional shared reviewer note, post-action inline status
(no toast library), and an optimistic `runSummary` delta. Three-layer ship: AMS
bulk endpoint -> gateway proxy + typed client -> frontend toolbar + modal.

Full raw idea, including the 10 open questions, lives in `raw-idea.md`.

## Validated Reuse Inventory

### AMS layer

**Single-row review endpoint** (the precedent we mirror) -
`DiscoveryFindingController.review` at
`POST /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/findings/{findingId}/review`.
Body: `ReviewDiscoveryFindingRequest(String status, String reviewerNotes)`.
Returns the mutated `DiscoveryFindingDto`. The service implementation
(`DiscoveryFindingService.review`) verifies the run guard, calls
`applyStatusChange(entity, status, stampReviewedAt=true)` which enforces
`ALLOWED_TRANSITIONS`, optionally sets `reviewerNotes`, then
`findingRepository.saveAndFlush(entity)`.

**Service-layer constants we will reuse verbatim:**

- `ALLOWED_STATUSES = { "new", "accepted", "ignored", "needs_review",
  "resolved" }` (DiscoveryFindingService:120).
- `ALLOWED_TRANSITIONS` map (DiscoveryFindingService:155-161) - critical: the
  bulk endpoint must enforce the SAME per-row transition guard, not just
  whitelist the target status. In particular:
  - `resolved -> {needs_review}` only (so a bulk Accept that includes resolved
    rows must skip OR fail those rows; see Q7 below).
  - same-status -> no-op stamp.
- `applyStatusChange(entity, requestedStatus, true)` helper - reuse as the
  per-row mutator inside the bulk loop. It already throws
  `InvalidFindingStatusTransitionException` on illegal moves.

**Filter shape on AMS side - SURPRISE: there is no `ListFindingsFilters` Java
DTO.** The list endpoint accepts flat `@RequestParam` strings:
`category, findingType, severity, status, source, createdByStage,
linkedTargetType, linkedTargetId, text` (DiscoveryFindingController:54-80) and
forwards them to `DiscoveryFindingRepository.search(...)` (12 named params,
nullable). We need to MINT a new `BulkReviewDiscoveryFindingsRequest.Filter`
nested record (Java side) that mirrors the same field set; the request DTO is
the first Java-side filter object for findings.

**No existing batched-update helper.** `DiscoveryFindingService.bulkCreate`
loops single inserts inside one `@Transactional`; that is the per-row loop
shape to mirror for bulk-update. There is `deleteFindingsByApiBehaviourDiffId`
(617-622) which loads-then-loops `findingRepository.delete(entity)`; same
pattern. So the implementation is "load candidate entities, loop
`applyStatusChange` + accumulate counters, single saveAndFlush at end (or
per-iteration save) inside one `@Transactional`".

**`DiscoveryRunArchitectureGuard.verify(runId, projectId, architectureId)`** -
must be called once at the top of the bulk handler, same as every other
run-scoped surface.

### Gateway layer

**Single-row review proxy** at `gateway/src/routes/discovery.ts:2761-2777`:

```ts
discoveryRouter.post(
  '/projects/:projectId/architectures/:architectureId/runs/:runId/findings/:findingId/review',
  async (req, res) => {
    const { projectId, architectureId, runId, findingId } = req.params;
    await proxyFindingsToAms({
      req, res,
      routeLabel: 'discovery finding review',
      method: 'POST',
      amsPath: amsFindingsPathPrefix(projectId, architectureId, runId)
             + `/${encodeURIComponent(findingId)}/review`,
      forwardBody: true,
      logContext: { projectId, architectureId, runId, findingId },
    });
  }
);
```

**`proxyFindingsToAms` helper** (discovery.ts:2495) - pass-through utility used
by every findings route; the bulk-review proxy is a one-call clone.

**`amsFindingsPathPrefix(p,a,r)`** helper (discovery.ts:2602) builds the AMS
URL prefix - reuse verbatim for the bulk-review route.

**Bulk-candidates precedent is NOT a direct model.** The candidates "bulk
review" at discovery.ts:1276-1377 is NOT an AMS bulk endpoint - it loops
PATCH-per-row from the gateway (parallel batches of 20). We are deliberately
moving away from that shape and going with a real AMS bulk endpoint, so the
gateway side stays a thin proxy (no per-row loop in the gateway).

### Frontend layer

**`reviewFinding` typed client** at
`frontend/src/api/findingsApi.ts:448-463` - target shape to mirror for the new
`bulkReviewFindings` function. POST + JSON body + `jsonRequest` helper +
`FindingsApiError` on non-2xx.

**`bulkReviewCandidates` typed client** at
`frontend/src/api/discoveryApi.ts:430-455` - parallel precedent (candidate
flavour). Returns `{ review_status, total, succeeded, failed }`. The finding
flavour will return AMS's
`{ updated_count, skipped_count, delta_by_from_status }`.

**`ListFindingsFilters` TS type** at `findingsApi.ts:255-267` - already exists.
The bulk-review TS request body will embed this type as the optional
`filter` field. The wire shape (snake_case via Jackson SNAKE_CASE) is
ready; no rename needed.

**FindingsTab toolbar insertion point** at `FindingsTab.tsx:590-606` -
between the closing `</div>` of the filter strip (after the "Clear" button at
line 590) and the table render block at line 592. The summary strip sits at
the top (445-469), filter strip at 472-590, then the new bulk-action block,
then the table. The existing CSS module
(`FindingsTab.module.css`) has the styling vocabulary we will extend.

**Existing optimistic-delta machinery** at `FindingsTab.tsx:413-436`
(`onFindingUpdated` callback). The bulk version applies the same shape in one
pass:

```ts
setRunSummary((prev) => {
  const next = { ...prev };
  for (const [from, count] of Object.entries(deltaByFromStatus)) {
    if (from === 'needs_review') next.needsReview -= count;
    else if (from === 'accepted') next.accepted -= count;
    else if (from === 'ignored') next.ignored -= count;
    // 'new' and 'resolved' do not appear on pills today
  }
  if (toStatus === 'needs_review') next.needsReview += updatedCount;
  else if (toStatus === 'accepted') next.accepted += updatedCount;
  else if (toStatus === 'ignored') next.ignored += updatedCount;
  return next;
});
```

Note: `resolved` count is NOT currently rendered on a pill (see
`FindingsSummary` interface at line 97-103: `total`, `criticalHigh`,
`needsReview`, `accepted`, `ignored`). If we surface "Mark Resolved" as a
bulk action we should consider whether to add a Resolved pill - see Q9 below.

**`fetchAllPages` helper** at `FindingsTab.tsx:180-208` - the multi-page
fetch loop. After a successful bulk action we will re-call this for the
filtered set to refresh the table. The unfiltered `runSummary` does NOT need a
refetch because the optimistic delta is exact (`deltaByFromStatus` is
authoritative).

**Modal pattern reference.** `frontend/src/components/DiagramsView/modals/
DeleteDiagramConfirmModal.tsx` is the closest template - escape-key + overlay
click + isOpen guard + header/content/footer layout. It has plain
`[Cancel] [Delete]` buttons; the bulk modal will add an optional reviewer-note
textarea between content and footer, plus a spinner-on-confirm state.
`frontend/src/components/common/Modal.tsx` is a more generic wrapper (one OK
button only) - not a good fit here, but worth noting it exists.

**Inline status messaging precedent.** `DiscoveryCandidateTable.handleBulkReview`
(DiscoveryCandidateTable.tsx:432-458) uses `console.error` ONLY on failure -
NO inline success or error banner today. That is a gap, not a precedent. The
shape-spec should pick: (a) introduce a small inline status banner under the
toolbar (no library), (b) wire one new shared `<InlineStatusBanner>` component
that the candidate table can adopt later, or (c) silently rely on the
optimistic update + table refresh + button-count change to communicate
success. My instinct: **(a) inline status banner under the toolbar**, rendered
for ~5s post-action then auto-dismissed - cheap, no library, and the
"Marked X of Y findings as accepted; Z skipped (already in target)" message is
load-bearing for confirming the action ran.

**Toast library check: NEGATIVE.** No `react-toastify`, `react-hot-toast`,
`sonner`, or `Toaster`-like dependency anywhere in `frontend/src`. The raw-idea
hedges with "shape-spec confirms" - confirmed gap, go with inline banner.

## Surprises and Notes

1. **No AMS-side filter DTO yet.** The single-row list endpoint takes flat
   `@RequestParam` strings; we will introduce the first findings filter DTO as
   a nested record on the bulk-review request. This means the bulk endpoint
   does NOT 1:1 mirror the GET endpoint's query-parameter envelope - the bulk
   endpoint takes a structured nested object. That is fine and matches
   instinct on Q2, but the spec-writer should note the asymmetry.

2. **AMS already filters `resolved -> non-needs_review` transitions.** The
   per-row `applyStatusChange` will throw on `resolved -> accepted` or
   `resolved -> ignored`. The bulk endpoint must NOT just blindly call
   `applyStatusChange` per row in a transaction - one offending row would roll
   back the whole batch. See Q7 for the recommended skip-instead-of-throw
   handling.

3. **Candidates bulk-review is gateway-side parallel-PATCH, not AMS bulk.**
   The raw-idea calls this "design precedent" - it is conceptually a precedent
   for the UX (Approve All / Approve Filtered) but the wire layer is being
   intentionally upgraded for findings: real AMS endpoint, one transaction,
   atomic, returns counters + `delta_by_from_status`. This is a deliberate
   improvement, not a regression to call out in the spec.

4. **`resolved` is not a summary pill today.** Mark Resolved in bulk has no
   pill to delta against. The optimistic-delta code skips it gracefully (the
   `else if` chain ignores `resolved`) - but UX-wise a reviewer who "Marks
   Resolved (47)" will see no pill change. See Q9.

5. **Findings status filter dropdown includes `new` and `resolved`** but the
   summary pills do NOT (FindingsTab:485-489 vs computeSummary:105-122). The
   bulk endpoint's `delta_by_from_status` may include `new` and `resolved`
   counts that the frontend can't reflect on pills - we just silently apply
   them. That is fine, but the spec-writer should note this asymmetry so the
   summary-pill expansion (Q9) is properly scoped if accepted.

6. **`AppShell model cache` is NOT touched.** Findings live outside the
   architecture model; the bulk-review path follows the same
   "no cache invalidation" rule the single-row path uses (FindingsTab.tsx
   comments at 17-19 and 410-412).

## Confirmed Java + TypeScript types ready for extension

**Java (AMS):**
- `DiscoveryFindingDto` (response type for single-row review; bulk does NOT
  return this, but the same status vocabulary applies).
- `ReviewDiscoveryFindingRequest(String status, String reviewerNotes)` - the
  single-row body. The bulk request adds `ids: List<UUID>` and a new
  `Filter` nested record + uses `List<DiscoveryFindingStatusFrom>` keys in the
  response map.
- `DiscoveryFindingService.ALLOWED_STATUSES`,
  `ALLOWED_TRANSITIONS`, `applyStatusChange` -
  reused unchanged inside the new bulk method.
- `DiscoveryRunArchitectureGuard.verify(runId, projectId, architectureId)` -
  called once.
- `DiscoveryFindingRepository.search(...)` - the 12-param JPQL method; the bulk
  service method will call this when `filter` is supplied, with
  `Pageable.unpaged()` (or the existing pageable shape) to load every match.

**TypeScript (frontend):**
- `ListFindingsFilters` (findingsApi.ts:255) - already snake_case-friendly via
  the `buildQueryString` helper. The bulk-review request body embeds this
  shape as a nested `filter?` field.
- `DiscoveryFindingStatus`, `DiscoveryFindingSeverity` - vocabulary unions
  already defined.
- `FindingsApiError`, `jsonRequest`, `findingsPathPrefix` - reused for the new
  `bulkReviewFindings` function.

**TypeScript (gateway):**
- `proxyFindingsToAms` + `amsFindingsPathPrefix` - reused verbatim for the new
  POST `/findings/bulk-review` route.

## Visual Assets

No `planning/visuals/` folder exists. The raw-idea contains the agreed ASCII
toolbar layout; no further mockups requested per the user's instruction
("code-only spec on an existing surface").

## Clarifying Questions

(Numbered to match the 10 open questions in raw-idea, with code-validated
recommendations. Spec-writer should answer Q1-Q10 plus the new Q11-Q13 that
came out of code reading.)

**Q1. `deltaByFromStatus` response field - endpoint computes it or client?**
My instinct: **endpoint computes it.** Confirmed cheap on the server -
`applyStatusChange` already reads the pre-mutation `entity.getStatus()`, so
grouping into a `Map<String, Integer>` is a 3-line accumulator inside the
service loop. The frontend's optimistic delta is exact rather than
approximate, and we save a round-trip.

**Q2. Filter shape in the endpoint body - verbatim AMS query params or
dedicated nested DTO?**
My instinct: **dedicated nested DTO** (new `BulkReviewDiscoveryFindingsRequest
.Filter` record on the Java side). The Java side has no existing filter DTO
(SURPRISE) so we are minting one - keep it nested under the bulk-review
request rather than introducing a top-level `ListFindingsFilters` DTO that
nothing else uses. Fields mirror the 12 `@RequestParam`s from the GET endpoint
plus the linkedTarget pair.

**Q3. Confirmation modal threshold (skip modal for very small bulks)?**
My instinct: **modal always**, matching Decision 2 in the raw-idea. Even
"Mark Resolved (1)" via bulk is a different mental commitment than the
single-row drawer click; the modal echoes scope + filters and protects
against fat-finger toggle-state mismatch. Decision 2 stands.

**Q4. What happens if the post-bulk filtered table refresh shows 0 rows?**
My instinct: **no special UX**. The existing `findings.length === 0` branch
(FindingsTab.tsx:601) already renders `<div>No findings for this run.</div>`.
That message is fine post-bulk; reviewers see the correlated banner above
("Marked 47 of 47..."). Nice-to-have: tweak the empty-state message when a
filter is active to "No findings match your filter." - independent of this
spec.

**Q5. `reviewer_notes` overwrite semantics.**
My instinct: **overwrite when the request supplies a non-null note;
preserve when omitted.** The single-row `review` endpoint already follows
this rule (DiscoveryFindingService.review:387-389). Match it. The
confirmation modal's optional textarea must distinguish "blank string" (which
overwrites with empty - probably not desired) from "field omitted entirely".
Recommendation: only send `reviewer_notes` in the request body if the textarea
has non-empty content after `.trim()`.

**Q6. Sticky toggle persistence: in-component state OR localStorage?**
My instinct: **in-component state only**. Aligns with raw-idea Decision 5 and
matches the user's "power users do bulk in a focused session" instinct.
LocalStorage adds reset complexity for a marginal benefit.

**Q7. Should the bulk endpoint skip rows whose CURRENT transition to the
target is forbidden (e.g. `resolved -> accepted`)?** **NEW QUESTION surfaced
by code review.** AMS `ALLOWED_TRANSITIONS` is stricter than just
"already in target". For example, `resolved -> accepted` throws
`InvalidFindingStatusTransitionException`. If the bulk endpoint calls
`applyStatusChange` per row, one offending `resolved` row inside a bulk
"Accept Filtered" would roll back the whole batch.
My instinct: **rename the bookkeeping: `updated_count` + `skipped_count`,
where `skipped_count` covers BOTH "already in target" AND "transition not
allowed".** Add a per-skip breakdown field if cheap:
`skipped_by_reason: { already_in_target: N, transition_not_allowed: M }`. The
endpoint pre-checks `ALLOWED_TRANSITIONS` for each row inside the service loop
and silently skips disallowed transitions rather than letting
`applyStatusChange` throw mid-batch. Post-toast wording: "Marked X of Y; Z
skipped (already in target or non-applicable transition)."

**Q8. Confirmation modal: where do active filter chips render?**
My instinct: **comma-separated text**, per Decision 5 in raw-idea's open
questions. The modal is short-lived; visual chips would look heavier than
warranted. Format: `Scope: Filtered (Severity=high, Category=ambiguity)`.

**Q9. Should we add a "Resolved" pill to the summary strip when introducing
bulk Mark Resolved?** **NEW QUESTION surfaced by code review.** Today the
summary pills are Total / Critical+High / Needs Review / Accepted / Ignored -
no Resolved pill. Bulk Mark Resolved (47) would show no visible pill change,
which is anti-climactic UX.
My instinct: **yes, add a Resolved pill** as part of this spec. It is a
1-line `FindingsSummary` interface change + 1 pill block + 1 entry in
`computeSummary` + 1 line in the optimistic delta. Low cost, high feedback
clarity. Note this also means `runSummary.resolved` becomes a fifth tracked
count.

**Q10. Test cap.** My instinct: AMS ~7-8 (happy path + already-in-target +
mixed-from-status + cross-run id injection + mutually-exclusive ids+filter +
invalid status + transition-not-allowed-skip + reviewer-notes overwrite-vs-
preserve), gateway 1 (proxy pass-through), frontend ~5-6 (toggle disable-when-
no-filter, action-button opens modal, modal cancel/ESC/click-outside, modal
confirm fires `bulkReviewFindings` with correct body, runSummary delta after
success, inline banner renders correct counts). **Total ~13-15.** Matches
raw-idea's instinct.

**Q11. Inline status banner OR true toast?** **NEW QUESTION (raw-idea
hedged).** No toast library exists in the frontend. My instinct: **inline
status banner under the bulk toolbar**, auto-dismisses after ~5s OR on next
filter change. Cheap, no new dependency, single component scope.

**Q12. Bulk endpoint commit boundary inside the service: per-row save or
single batch?** **NEW QUESTION surfaced by code review.** Existing
`bulkCreate` does `persistNewFinding(...)` (saveAndFlush per row) inside one
transaction; `deleteFindingsByApiBehaviourDiffId` does per-row delete +
single flush at end. My instinct: **per-row `applyStatusChange` mutating the
entity, single `findingRepository.saveAll(...)` + flush at the end** inside
one `@Transactional`. Mirrors the JPA dirty-checking convention better than
N saveAndFlush calls and is atomic by virtue of the transaction. If
`saveAll` for some reason becomes awkward (mixed dirty entities + read entities
in the same session), fall back to per-row save before flush.

**Q13. Confirmation modal's "skipped preview" computation - client-side
approximation OR server-side dry-run?** **NEW QUESTION (raw-idea mentions
"computed client-side").** The modal opens BEFORE the request fires; the
precise `skipped_count` is unknown until the server responds. Two options:
(a) show an APPROXIMATE preview computed from the loaded filtered list
("~5 already accepted"), accepting that the loaded list may not exactly match
the server's set under concurrent edits. (b) Skip the preview and just say
"Will change status on all findings in scope" with the precise X+Y counts
revealed in the post-action banner.
My instinct: **(a) approximate preview** - the loaded list is the source of
truth the user is acting on, and a tilde-prefix communicates the
approximation. Refined to exact in the post-action banner.

## Requirements Summary

### Functional requirements

- AMS endpoint `POST /api/model/projects/{p}/architectures/{a}/discovery/runs/
  {r}/findings/bulk-review` accepting `{ ids?, filter?, status, reviewer_notes?
  }`, returning `{ updated_count, skipped_count, skipped_by_reason?,
  delta_by_from_status }`.
- Per-row transition guard inside the bulk loop (Q7) - skip-instead-of-throw
  for forbidden transitions.
- Service layer reuses `applyStatusChange`, `ALLOWED_STATUSES`,
  `ALLOWED_TRANSITIONS`, and `DiscoveryRunArchitectureGuard`.
- Gateway adds one `POST .../findings/bulk-review` route reusing
  `proxyFindingsToAms`.
- Frontend `bulkReviewFindings` typed client mirrors `reviewFinding` shape.
- FindingsTab toolbar block (segmented toggle + 4 action buttons) inserted
  between filter strip (line 590) and table render (line 592).
- New `BulkFindingActionConfirmModal.tsx` follows `DeleteDiagramConfirmModal`
  pattern - escape + overlay click + isOpen guard + header/content/footer.
  Adds an optional reviewer-note textarea + spinner-on-confirm.
- Inline status banner under the toolbar (no toast library) - auto-dismisses
  after ~5s.
- Optimistic `runSummary` delta using `delta_by_from_status` from the
  response.
- Filtered table refresh via re-call of `fetchAllPages`.
- Sticky scope toggle in component state; resets on Clear filters.
- Optional: Resolved pill added to summary strip (Q9).

### Reusability opportunities used

- AMS: `applyStatusChange`, `ALLOWED_STATUSES`, `ALLOWED_TRANSITIONS`,
  `DiscoveryRunArchitectureGuard`, `DiscoveryFindingRepository.search`.
- Gateway: `proxyFindingsToAms`, `amsFindingsPathPrefix`.
- Frontend: `findingsPathPrefix`, `jsonRequest`, `FindingsApiError`,
  `ListFindingsFilters`, `fetchAllPages`, `onFindingUpdated` delta shape.

### Scope boundaries

**In scope:**
- AMS bulk-review endpoint + DTO + tests.
- Gateway proxy + 1 test.
- Frontend toolbar + modal + typed client + inline banner + delta wiring +
  tests.
- Optionally adding the Resolved summary pill (Q9, recommended yes).

**Out of scope:**
- Row-checkbox selection model.
- Bulk Create-Work-Item.
- Bulk re-classification (severity / category / finding_type).
- Bulk reverting to `status='new'`.
- Streaming / progress-bar UI.
- Cross-run bulk actions.
- New toast library (use inline banner instead).
- Changing single-row drawer behaviour or its endpoint.
- Schema or wire-shape changes to `discovery_findings`.

### Technical considerations

- The bulk endpoint MUST pre-check `ALLOWED_TRANSITIONS` per row (Q7) -
  blindly delegating to `applyStatusChange` would rollback on a single
  offending row.
- `reviewer_notes` field on the request body should only be sent when the
  textarea content is non-empty after `.trim()` (Q5).
- AMS Jackson SNAKE_CASE convention is global - new DTO fields stay
  camelCase in Java and serialise to snake_case automatically.
- AppShell model cache is NOT invalidated (findings live outside the
  architecture model).
- The Resolved pill addition (Q9) requires editing the
  `FindingsSummary` interface + `computeSummary` + summary strip JSX +
  optimistic-delta switch.

## Accepted Answers

User accepted all defaults / instincts on 2026-05-25.

- Q1: `delta_by_from_status` computed server-side inside the bulk service loop
  (pre-mutation `entity.getStatus()` accumulator). Frontend applies it
  verbatim for an exact optimistic delta.
- Q2: Nested `BulkReviewDiscoveryFindingsRequest.Filter` record on the Java
  side, mirroring the 12 `@RequestParam`s of the GET endpoint plus the
  linkedTarget pair. First findings filter DTO on the Java side.
- Q3: Confirmation modal ALWAYS - no skip threshold. Even bulk action with
  count of 1 opens the modal to confirm scope + filters.
- Q4: No special empty-state UX. Existing `findings.length === 0` branch
  ("No findings for this run.") stands. Banner above communicates success.
- Q5: `reviewer_notes` overwrite when supplied as non-empty after `.trim()`;
  preserve when omitted. Client only includes the field in the request body
  when the textarea has non-empty trimmed content.
- Q6: Sticky toggle in-component state ONLY. No localStorage. Toggle resets
  on Clear filters.
- Q7: **CRITICAL** - skip-instead-of-throw for forbidden transitions. Bulk
  endpoint pre-checks `ALLOWED_TRANSITIONS` for each row inside the service
  loop; silently skips disallowed transitions rather than letting
  `applyStatusChange` throw mid-batch. Response includes
  `skipped_count` covering both "already in target" and "transition not
  allowed", plus optional `skipped_by_reason: { already_in_target: N,
  transition_not_allowed: M }` breakdown.
- Q8: Comma-separated filter text in modal -
  `Scope: Filtered (Severity=high, Category=ambiguity)`. No visual chips.
- Q9: Add Resolved pill to summary strip. Edits: `FindingsSummary` interface
  + `computeSummary` + summary strip JSX + optimistic-delta switch. Tracks
  `runSummary.resolved` as a fifth count.
- Q10: ~13-15 tests total - AMS ~7-8, gateway 1, frontend ~5-6.
- Q11: Inline status banner under the bulk toolbar (no toast library).
  Auto-dismisses after ~5s OR on next filter change. Message format:
  "Marked X of Y findings as accepted; Z skipped (already in target or
  non-applicable transition)."
- Q12: Per-row `applyStatusChange` mutates the entity; single
  `findingRepository.saveAll(...)` + flush at the end inside ONE
  `@Transactional`. Atomic by transaction boundary.
- Q13: Approximate preview in the modal (tilde-prefix communicates
  approximation, computed from loaded filtered list). Precise count revealed
  in post-action inline banner.
