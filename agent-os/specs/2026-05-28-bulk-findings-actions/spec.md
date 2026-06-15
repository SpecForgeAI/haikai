# Specification: Bulk Findings Actions

## Goal
Add a bulk-action toolbar to the Findings tab so reviewers can transition many discovery findings at once (Accept / Ignore / Needs Review / Mark Resolved) via a real atomic AMS endpoint, replacing the per-row drawer round-trip for high-volume reviews.

## User Stories
- As a reviewer triaging a 300+ finding run, I want to apply a status to every filtered finding in one click so I do not have to open the per-row drawer hundreds of times.
- As a reviewer, I want a confirmation modal that echoes my scope and active filters before any bulk action fires so I never accidentally mutate more findings than I intended.
- As a reviewer, I want the summary pills and table to update immediately after a bulk action so I get visible feedback that my action ran.

## Specific Requirements

**AMS bulk-review endpoint**
- New `POST /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/findings/bulk-review` on `DiscoveryFindingController`.
- Request body (Jackson serialises camelCase Java to snake_case wire automatically): `{ ids?: UUID[], filter?: Filter, status: string, reviewer_notes?: string }`.
- Mints first findings-side Java filter DTO as nested record `BulkReviewDiscoveryFindingsRequest.Filter` mirroring the 12 `@RequestParam`s of the GET list endpoint plus the `linked_target_type` / `linked_target_id` pair.
- `ids` and `filter` are mutually exclusive: both supplied returns 400 `mutually_exclusive_inputs`; neither supplied means "all findings in the run".
- `status` validated against `ALLOWED_STATUSES` minus `new` (reviewer-valid transitions only); invalid value returns 400.
- `DiscoveryRunArchitectureGuard.verify(runId, projectId, architectureId)` called once at top of handler.
- Cross-run `id` injection returns 404 when any id is foreign to `(projectId, architectureId, runId)`.

**Per-row transition guard with skip-instead-of-throw (Q7, CRITICAL)**
- Service loop pre-checks `ALLOWED_TRANSITIONS` for each candidate entity inside the bulk loop; never lets `applyStatusChange` throw mid-batch.
- Disallowed transitions (e.g. `resolved -> accepted`) are silently skipped, not rolled back.
- Same-status rows (`entity.getStatus() == requestedStatus`) are also skipped.
- Skipped rows are counted in `skipped_count` with an optional `skipped_by_reason: { already_in_target: N, transition_not_allowed: M }` breakdown.
- Reuses `ALLOWED_STATUSES`, `ALLOWED_TRANSITIONS`, and `applyStatusChange(entity, status, stampReviewedAt=true)` verbatim from `DiscoveryFindingService`.

**AMS service-layer commit shape (Q12)**
- Single `@Transactional` boundary on the bulk service method.
- Per-row `applyStatusChange` mutates the loaded entity in-place; pre-mutation `entity.getStatus()` is captured into a `Map<String, Integer> deltaByFromStatus` accumulator.
- Single `findingRepository.saveAll(updatedEntities)` followed by a flush at the end of the loop (not per-row `saveAndFlush`).
- Atomic by transaction boundary; no partial commits.

**AMS bulk-review response shape**
- Response body: `{ updated_count: int, skipped_count: int, skipped_by_reason?: { already_in_target: int, transition_not_allowed: int }, delta_by_from_status: Map<string, int> }`.
- `delta_by_from_status` is server-computed (Q1) using the pre-mutation status accumulator; keys are status strings (`new`, `needs_review`, `accepted`, `ignored`, `resolved`).
- `reviewer_notes` semantics (Q5): overwrite the entity's `reviewerNotes` when the request supplies a non-empty value after trim; preserve existing notes when the field is omitted or null.

**Gateway thin proxy**
- New route `POST /projects/:projectId/architectures/:architectureId/runs/:runId/findings/bulk-review` on `discoveryRouter` in `gateway/src/routes/discovery.ts`.
- Uses `proxyFindingsToAms` helper with `forwardBody: true` and `amsFindingsPathPrefix(projectId, architectureId, runId) + '/bulk-review'`.
- No gateway-side loop; no per-row PATCH parallelism (intentionally NOT mirroring the candidates bulk-review pattern).

**Frontend typed client**
- New `bulkReviewFindings(projectId, architectureId, runId, body)` in `frontend/src/api/findingsApi.ts` mirroring the shape of `reviewFinding` (POST + JSON body + `jsonRequest` helper + `FindingsApiError` on non-2xx).
- Request body TypeScript type embeds the existing `ListFindingsFilters` type as optional `filter` field; snake_case wire shape needs no rename.
- Response type matches AMS: `{ updated_count, skipped_count, skipped_by_reason?, delta_by_from_status }`.

**FindingsTab toolbar block**
- Inserted in `frontend/src/components/.../FindingsTab.tsx` between the filter strip's closing `</div>` (line 590) and the table render block (line 592).
- Row 1: segmented scope toggle `Bulk apply to: [ All (N) | Filtered (M) ]`. Filtered side disabled with tooltip "Apply a filter to enable" when no filter is active. Sticky in component state only (Q6); resets to All on Clear filters.
- Row 2: four action buttons `[Accept (X)] [Ignore (X)] [Needs Review (X)] [Mark Resolved (X)]` where X is the count of findings in active scope whose status differs from the action's target.
- Each action button disabled when its X = 0 (tooltip "All findings in scope are already <status>") and while any bulk action is in flight.
- Counts update live as filters change.

**Confirmation modal `BulkFindingActionConfirmModal.tsx`**
- Always opens for every bulk action (Q3); no count threshold.
- Follows `DeleteDiagramConfirmModal` pattern: escape-key + overlay click + `isOpen` guard + header/content/footer.
- Title: `Mark {X} findings as {Status}?`.
- Body line: `Scope: {All|Filtered}` plus comma-separated active filter text (Q8) e.g. `Scope: Filtered (Severity=high, Category=ambiguity)`.
- Body shows approximate skipped preview with tilde prefix (Q13) computed from the loaded filtered list e.g. `~5 already accepted`.
- Optional reviewer-note textarea with 500-char soft cap; field included in the request body only when content is non-empty after `.trim()` (Q5).
- Confirm button shows spinner + disables while API call is in flight; Cancel / ESC / overlay click all dismiss.

**Inline status banner (Q11)**
- Banner rendered under the bulk toolbar after a bulk action; no toast library (none exists in `frontend/src`).
- Success message: `Marked {updated_count} of {scoped_total} findings as {Status}; {skipped_count} skipped (already in target or non-applicable transition).`
- Failure message: `Bulk review failed: {error}.` (kept short).
- Auto-dismisses after ~5 seconds OR on next filter change.

**Optimistic runSummary delta + Resolved pill (Q9)**
- After successful bulk action, apply `delta_by_from_status` to `runSummary` in one pass: decrement each from-status pill by its count, increment the to-status pill by `updated_count`.
- Adds Resolved as a fifth tracked pill: edit `FindingsSummary` interface, `computeSummary`, summary strip JSX, and the optimistic-delta switch statement (both the single-row `onFindingUpdated` path and the new bulk path).
- Filtered table refreshed by re-calling existing `fetchAllPages` helper after success; unfiltered `runSummary` not refetched because the delta is exact.
- AppShell model cache is NOT invalidated (findings live outside the architecture model).

**Test cap ~13-15 total (Q10)**
- AMS 7-8 tests: happy path, already-in-target skip, mixed-from-status delta, cross-run id injection 404, mutually-exclusive ids+filter 400, invalid status 400, transition-not-allowed skip (`resolved -> accepted`), `reviewer_notes` overwrite-vs-preserve.
- Gateway 1 test: proxy pass-through (body + status + response forwarded verbatim).
- Frontend 5-6 tests: toggle disabled when no filter, action button opens modal, modal Cancel/ESC/click-outside dismisses, modal Confirm fires `bulkReviewFindings` with correct body, `runSummary` delta after success, inline banner renders correct counts.

## Existing Code to Leverage

See `planning/requirements.md` "Validated Reuse Inventory" for the line-by-line file/line references. Headline reuse:

**AMS service-layer primitives (`DiscoveryFindingService`)**
- `applyStatusChange(entity, status, stampReviewedAt=true)` reused unchanged as the per-row mutator inside the bulk loop.
- `ALLOWED_STATUSES` and `ALLOWED_TRANSITIONS` reused verbatim for validation and the per-row transition pre-check.
- `DiscoveryRunArchitectureGuard.verify(runId, projectId, architectureId)` reused at handler entry.
- `DiscoveryFindingRepository.search(...)` (12-param JPQL method) reused when `filter` is supplied, with `Pageable.unpaged()`.

**Gateway proxy primitives (`gateway/src/routes/discovery.ts`)**
- `proxyFindingsToAms` helper at line 2495 reused for the new bulk-review route.
- `amsFindingsPathPrefix(p,a,r)` helper at line 2602 reused verbatim.
- Single-row `/review` proxy at lines 2761-2777 is the structural clone target.

**Frontend typed-client primitives (`frontend/src/api/findingsApi.ts`)**
- `reviewFinding` at lines 448-463 is the shape clone target for `bulkReviewFindings`.
- `findingsPathPrefix`, `jsonRequest`, `FindingsApiError`, and the `ListFindingsFilters` type at lines 255-267 reused for request/response wiring.

**FindingsTab existing machinery (`FindingsTab.tsx`)**
- `fetchAllPages` helper at lines 180-208 reused to refresh the filtered table post-action.
- `onFindingUpdated` optimistic-delta callback at lines 413-436 is the per-status delta shape we replicate in bulk.
- Summary strip at lines 445-469, filter strip at 472-590, and existing CSS module `FindingsTab.module.css` provide the styling vocabulary to extend.

**Modal pattern reference**
- `frontend/src/components/DiagramsView/modals/DeleteDiagramConfirmModal.tsx` is the closest template (escape + overlay + isOpen + header/content/footer); the bulk modal adds an optional reviewer-note textarea and spinner-on-confirm.

## Out of Scope
- Row-checkbox selection model.
- Bulk Create-Work-Item action.
- Bulk re-classification (severity / category / finding_type).
- Bulk reverting to `status='new'`.
- Streaming or progress-bar UI for large bulk actions.
- Cross-run bulk actions (e.g. "accept all critical findings across every run").
- Introducing a new toast library (inline banner is used instead).
- Changes to the single-row drawer behaviour or its `/review` endpoint.
- Schema or wire-shape changes to `discovery_findings`.
- Bulk-action audit log or undo functionality.
