# Task Breakdown: Bulk Findings Actions

## Overview
Total Tasks: 3 task groups (one per layer), approximately 13-15 tests total.

Execution proceeds AMS Java -> Gateway -> Frontend so that each layer can be
wired against a working endpoint below it. Each task group is independently
reviewable and committable.

## Task List

### AMS Java Layer (architecture-model-service)

#### Task Group 1: Bulk-Review Endpoint, DTOs, and Service Logic
**Dependencies:** None

- [x] 1.0 Complete AMS bulk-review endpoint
  - [x] 1.1 Write 7-8 focused tests for bulk-review endpoint and service
    - Limit to 7-8 highly focused tests maximum
    - Test cases (all critical, no padding):
      - Happy path: mixed-from-status request returns correct `updated_count`,
        `skipped_count`, and `delta_by_from_status` map.
      - Already-in-target skip: rows whose current status equals the requested
        status are counted in `skipped_count` under
        `skipped_by_reason.already_in_target`.
      - Transition-not-allowed skip (CRITICAL Q7): `resolved -> accepted`
        bulk request skips the offending rows rather than throwing, counted
        under `skipped_by_reason.transition_not_allowed`.
      - Cross-run id injection returns 404 when any id in `ids` is foreign to
        `(projectId, architectureId, runId)`.
      - Mutually-exclusive inputs: both `ids` and `filter` supplied returns
        400 `mutually_exclusive_inputs`.
      - Invalid status returns 400 (e.g. `status: "new"` or unknown value).
      - `reviewer_notes` semantics (Q5): non-empty trimmed value overwrites
        existing `reviewerNotes`; omitted/null preserves existing notes.
      - (Optional 8th) `delta_by_from_status` keys include all encountered
        pre-mutation statuses (`new`, `needs_review`, `accepted`, `ignored`,
        `resolved`) with correct counts.
    - Skip exhaustive coverage of edge cases beyond the list above.
  - [x] 1.2 Create request DTO `BulkReviewDiscoveryFindingsRequest`
    - Java record: `(List<UUID> ids, Filter filter, String status,
      String reviewerNotes)`.
    - Nested `Filter` record mirroring the 12 `@RequestParam`s of the GET
      list endpoint on `DiscoveryFindingController` (line 54-80):
      `category, findingType, severity, status, source, createdByStage,
      linkedTargetType, linkedTargetId, text` plus any remaining params from
      the list endpoint to reach the 12-field parity.
    - First findings-side Java filter DTO (no existing one to reuse).
    - Relies on global Jackson `SNAKE_CASE` strategy in
      `application.yml` per the repo's CLAUDE.md guidance; no `@JsonNaming`
      annotation needed.
  - [x] 1.3 Create response DTO `BulkReviewDiscoveryFindingsResponse`
    - Java record: `(int updatedCount, int skippedCount,
      SkippedByReason skippedByReason, Map<String, Integer>
      deltaByFromStatus)`.
    - Nested `SkippedByReason` record: `(int alreadyInTarget,
      int transitionNotAllowed)`.
    - `deltaByFromStatus` keys are status strings (`new`, `needs_review`,
      `accepted`, `ignored`, `resolved`).
  - [x] 1.4 Add controller method on `DiscoveryFindingController`
    - Route: `POST /api/model/projects/{projectId}/architectures/
      {architectureId}/discovery/runs/{runId}/findings/bulk-review`.
    - Calls `DiscoveryRunArchitectureGuard.verify(runId, projectId,
      architectureId)` once at the top of the handler.
    - Validates `status` against `ALLOWED_STATUSES` minus `new`; returns
      400 on invalid value.
    - Validates `ids XOR filter`; returns 400 `mutually_exclusive_inputs`
      when both supplied; neither supplied means "all findings in the run".
    - Delegates to the new service method and returns the response DTO.
  - [x] 1.5 Add service method on `DiscoveryFindingService`
    - Single `@Transactional` boundary on the method (Q12).
    - Resolve candidate set:
      - `ids` supplied: `findingRepository.findAllById(ids)` then verify
        each entity's `(projectId, architectureId, runId)` triple matches
        the path; throw 404 on any foreign id.
      - `filter` supplied: call `DiscoveryFindingRepository.search(...)`
        with the 12 nullable params from the `Filter` record and
        `Pageable.unpaged()`.
      - Neither supplied: load all findings for the `(projectId,
        architectureId, runId)` triple.
    - Loop the candidate list:
      - Skip same-status rows (`entity.getStatus().equals(requestedStatus)`),
        increment `skippedByReason.alreadyInTarget`.
      - Pre-check `ALLOWED_TRANSITIONS.get(entity.getStatus())`; if it does
        not contain `requestedStatus`, skip the row and increment
        `skippedByReason.transitionNotAllowed`.
      - Otherwise: capture `entity.getStatus()` into the
        `Map<String, Integer> deltaByFromStatus` accumulator, then call
        `applyStatusChange(entity, requestedStatus, true)` reused verbatim
        from `DiscoveryFindingService`.
      - When `reviewerNotes` is non-null and non-empty after trim, set
        `entity.setReviewerNotes(trimmedValue)` (Q5).
    - After the loop: single `findingRepository.saveAll(updatedEntities)`
      followed by a flush (Q12). No per-row `saveAndFlush`.
    - Build and return the response DTO with `updatedCount = sum of
      delta_by_from_status values`, `skippedCount = alreadyInTarget +
      transitionNotAllowed`, the breakdown, and the accumulator map.
  - [x] 1.6 CRITICAL invariant: `applyStatusChange` must never throw
        mid-batch (Q7)
    - The pre-check on `ALLOWED_TRANSITIONS` inside the loop ensures
      forbidden transitions are skipped, never delegated to
      `applyStatusChange`. Verified by test 1.1 case 3
      (`resolved -> accepted` skip).
  - [x] 1.7 Ensure AMS layer tests pass
    - Run ONLY the 7-8 tests written in 1.1
    - Do NOT run the entire AMS test suite at this stage.

**Acceptance Criteria:**
- The 7-8 tests written in 1.1 pass.
- Endpoint returns the correct response shape with snake_case wire format.
- Forbidden transitions are skipped, never thrown, inside the bulk loop.
- One transactional boundary; one `saveAll` + flush at the end.
- Run guard called once at handler entry.
- Cross-run id injection returns 404; mutually exclusive inputs return 400;
  invalid status returns 400.
- `reviewer_notes` overwrite-vs-preserve semantics match the single-row
  `review` endpoint precedent.

### Gateway Layer (gateway/src)

#### Task Group 2: Proxy Route and Typed Client Wrapper
**Dependencies:** Task Group 1

- [x] 2.0 Complete gateway proxy and frontend typed client
  - [x] 2.1 Write 1 focused test for the gateway proxy
    - Limit to 1 test (per Q10 cap).
    - Test: pass-through asserts the proxy forwards POST body + status code
      + AMS response verbatim to the caller, with the correct AMS path
      built from `amsFindingsPathPrefix(projectId, architectureId, runId)
      + '/bulk-review'`.
  - [x] 2.2 Add proxy route in `gateway/src/routes/discovery.ts`
    - Route: `POST /projects/:projectId/architectures/:architectureId/
      runs/:runId/findings/bulk-review` on `discoveryRouter`.
    - Reuses `proxyFindingsToAms` (line 2495) with `forwardBody: true`.
    - AMS path: `amsFindingsPathPrefix(projectId, architectureId, runId)
      + '/bulk-review'`.
    - Route label: `'discovery finding bulk review'`.
    - Log context: `{ projectId, architectureId, runId }`.
    - Structural clone of the single-row `/review` proxy at lines
      2761-2777. NO gateway-side loop. NO per-row PATCH parallelism
      (intentionally NOT mirroring the candidates bulk-review pattern at
      1276-1377).
  - [x] 2.3 Add typed client wrapper `bulkReviewFindings` in
        `frontend/src/api/findingsApi.ts`
    - Function signature: `bulkReviewFindings(projectId, architectureId,
      runId, body): Promise<BulkReviewFindingsResponse>`.
    - Mirrors `reviewFinding` shape (lines 448-463): POST + JSON body +
      `jsonRequest` helper + `FindingsApiError` on non-2xx.
    - Request body type: `{ ids?: string[], filter?: ListFindingsFilters,
      status: DiscoveryFindingStatus, reviewer_notes?: string }`.
      Embeds existing `ListFindingsFilters` (lines 255-267) as optional
      nested field. Snake_case wire shape needs no rename.
    - Response type: `{ updated_count: number, skipped_count: number,
      skipped_by_reason?: { already_in_target: number,
      transition_not_allowed: number },
      delta_by_from_status: Record<string, number> }`.
  - [x] 2.4 Ensure gateway layer tests pass
    - Run ONLY the 1 test written in 2.1.
    - Do NOT run the entire gateway test suite at this stage.

**Acceptance Criteria:**
- The 1 test written in 2.1 passes.
- Proxy forwards body + status + response verbatim with the correct AMS
  path.
- Typed client wrapper compiles and serialises the request body in
  snake_case wire shape.
- No gateway-side per-row looping.

### Frontend Layer (frontend/src)

#### Task Group 3: Toolbar, Confirmation Modal, Banner, Optimistic Delta
**Dependencies:** Task Group 2

- [x] 3.0 Complete frontend bulk-action UI
  - [x] 3.1 Write 5-6 focused tests for the frontend
    - Limit to 5-6 highly focused tests maximum.
    - Test cases (all critical, no padding):
      - Scope toggle's `Filtered` side is disabled with tooltip when no
        filter is active.
      - Clicking an action button opens `BulkFindingActionConfirmModal`.
      - Modal Cancel button + ESC + overlay click all dismiss the modal.
      - Modal Confirm fires `bulkReviewFindings` with the correct body
        (status, scope -> ids/filter, `reviewer_notes` only present when
        trimmed non-empty).
      - `runSummary` pills apply `delta_by_from_status` correctly after a
        successful bulk action (decrement each from-status pill, increment
        the to-status pill, including new Resolved pill).
      - Inline status banner renders the correct counts post-action and
        auto-dismisses after ~5s OR on next filter change.
    - Skip exhaustive coverage of all component states and edge cases.
  - [x] 3.2 Extend `FindingsSummary` shape and `computeSummary` for Resolved
        pill (Q9)
    - Edit `FindingsSummary` interface (FindingsTab.tsx:97-103) to add
      `resolved: number` as a fifth tracked count.
    - Update `computeSummary` (lines 105-122) to include the resolved
      count.
    - Add Resolved pill to the summary strip JSX (lines 445-469).
  - [x] 3.3 Add `BulkScopeToggle` block to `FindingsTab.tsx`
    - Insert between filter strip's closing `</div>` (line 590) and the
      table render block (line 592).
    - Row 1: segmented toggle `Bulk apply to: [ All (N) | Filtered (M) ]`.
    - `Filtered` side disabled with tooltip `Apply a filter to enable`
      when no filter is active.
    - Sticky in-component state only (Q6); resets to `All` on Clear
      filters.
    - N = total findings in run (from `runSummary`); M = current filtered
      count from `findings.length` (or `fetchAllPages` total).
  - [x] 3.4 Add four action buttons row to `FindingsTab.tsx`
    - Row 2: `[Accept (X)] [Ignore (X)] [Needs Review (X)] [Mark Resolved
      (X)]` where X is the count of findings in the active scope whose
      status differs from the action's target.
    - Each button disabled when its X = 0 with tooltip
      `All findings in scope are already <status>`.
    - All four buttons disabled while any bulk action is in flight.
    - Counts update live as filters change.
  - [x] 3.5 Create `BulkFindingActionConfirmModal.tsx`
    - New file under `frontend/src/components/.../`.
    - Follows `DeleteDiagramConfirmModal` pattern: escape-key handler,
      overlay click handler, `isOpen` guard, header/content/footer
      layout.
    - Title: `Mark {X} findings as {Status}?`.
    - Body line 1: `Scope: {All|Filtered}` plus comma-separated active
      filter text (Q8), e.g. `Scope: Filtered (Severity=high,
      Category=ambiguity)`.
    - Body line 2: approximate skipped preview with tilde prefix (Q13)
      computed from the loaded filtered list, e.g. `~5 already accepted`.
    - Optional reviewer-note textarea, 500-char soft cap. Field included
      in the request body only when content is non-empty after `.trim()`
      (Q5).
    - Cancel button + Confirm button. Confirm shows spinner + disables
      while API call is in flight. Cancel + ESC + overlay click all
      dismiss.
    - Always opens for every bulk action (Q3); no count threshold.
  - [x] 3.6 Wire optimistic `runSummary` delta after success
    - Apply `delta_by_from_status` in one pass to `runSummary`:
      decrement each from-status pill by its count
      (`needs_review`, `accepted`, `ignored`, `resolved`); increment the
      to-status pill by `updated_count`. The `new` from-status is
      silently dropped (no pill).
    - Mirror the shape of `onFindingUpdated` (lines 413-436), but apply
      the entire delta in one `setRunSummary` call.
    - Include `resolved` branches in the optimistic-delta switch
      statement (both the single-row `onFindingUpdated` path AND the new
      bulk path) since the Resolved pill is new.
  - [x] 3.7 Refresh filtered table after success
    - Re-call existing `fetchAllPages` helper (lines 180-208) for the
      filtered set.
    - Unfiltered `runSummary` is NOT refetched (the delta is exact).
    - AppShell model cache is NOT invalidated (findings live outside the
      architecture model).
  - [x] 3.8 Add inline status banner under the bulk toolbar (Q11)
    - Banner rendered under the bulk toolbar after a bulk action; no
      toast library (none exists in `frontend/src`).
    - Success: `Marked {updated_count} of {scoped_total} findings as
      {Status}; {skipped_count} skipped (already in target or
      non-applicable transition).`
    - Failure: `Bulk review failed: {error}.` (kept short).
    - Auto-dismisses after ~5 seconds OR on next filter change.
  - [x] 3.9 Ensure frontend layer tests pass
    - Run ONLY the 5-6 tests written in 3.1.
    - Do NOT run the entire frontend test suite at this stage.

**Acceptance Criteria:**
- The 5-6 tests written in 3.1 pass.
- Toolbar renders the segmented toggle + 4 action buttons with live
  counts.
- Confirmation modal opens for every bulk action with correct scope echo,
  comma-separated filter text, and tilde-prefixed skipped preview.
- `reviewer_notes` is only sent in the request body when the textarea is
  non-empty after trim.
- Sticky scope toggle is in-component state only; resets on Clear filters.
- `runSummary` pills update optimistically using `delta_by_from_status`
  including the new Resolved pill.
- Inline status banner renders correct counts post-action and
  auto-dismisses after ~5s or on filter change.
- Filtered table refreshes via `fetchAllPages` after success.

## Execution Order

Recommended implementation sequence:
1. AMS Java Layer (Task Group 1) -- ship the bulk-review endpoint first
   so downstream layers wire against a working API.
2. Gateway Layer (Task Group 2) -- thin proxy + typed client wrapper.
3. Frontend Layer (Task Group 3) -- toolbar, modal, banner, optimistic
   delta + Resolved pill.

Each task group is independently reviewable and committable. Total test
budget: AMS 7-8 + Gateway 1 + Frontend 5-6 = approximately 13-15 tests
(Q10 cap).
