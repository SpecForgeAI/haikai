# Raw Idea: Bulk Findings Actions

## Why this spec exists

Today every reviewer action on a `discovery_finding` requires opening the per-row detail drawer (`FindingDetailDrawer.tsx`) and clicking one of the four action buttons: `finding-action-accept`, `finding-action-ignore`, `finding-action-needs-review`, `finding-action-resolved`. With a run producing 300+ findings (a Java/Spring/XSD/WADL scan against a real codebase typically does), reviewing each one-by-one is impractical. Users want the same bulk-action affordance the Discovery Candidates table already has — "Approve All / Approve Filtered / Reject All / Reject Filtered" — but adapted to findings' four-status lifecycle.

The user agreed on a specific UX during shaping conversation: a **single segmented scope toggle** `[ All (N) | Filtered (M) ]` followed by **four action buttons** `[Accept (X)] [Ignore (X)] [Needs Review (X)] [Mark Resolved (X)]`. This gives 5 controls instead of 8 (the naïve mirror of candidates), with the toggle setting the scope once and each action button echoing the scope's current count.

End-to-end the spec ships: an AMS bulk-review endpoint with skip-already-in-target semantics, a gateway proxy + typed client, a confirmation modal with optional shared reviewer note, post-action toast reporting `updated_count + skipped_already_in_target`, and an optimistic `runSummary` delta so the pills update immediately (matching the single-row pattern we just shipped).

## What this spec is (and isn't)

**This spec is:**

- A new AMS endpoint `POST /api/projects/{p}/architectures/{a}/discovery/runs/{r}/findings/bulk-review` accepting `{ ids?: string[], filter?: ListFindingsFilters, status: 'accepted'|'ignored'|'needs_review'|'resolved', reviewer_notes?: string }` and returning `{ updated_count: number, skipped_count: number }`.
- A gateway proxy mirroring the existing finding-review proxy pattern + a typed `bulkReviewFindings` wrapper in `findingsApi.ts`.
- A new toolbar block on `FindingsTab.tsx` directly above the table, structured as:
  - Row 1: `Bulk apply to: [ All (N) | Filtered (M) ]` segmented toggle.
  - Row 2: four action buttons `[Accept (X)] [Ignore (X)] [Needs Review (X)] [Mark Resolved (X)]` where `X` is the count of findings in the currently-active scope that are NOT already in the target status.
- A confirmation modal that opens for ANY bulk action (no "small enough to skip" threshold per spec — every bulk action is consequential enough to confirm).
- Optional shared reviewer note threaded through the modal into the AMS endpoint.
- A post-action toast: `✓ Marked X of Y findings as <Status>. Z were already <status> (skipped).`
- An optimistic `runSummary` status-count delta after a successful bulk action (mirrors the single-row pattern shipped on 2026-05-28).
- Sticky scope toggle: remembers the user's last-used scope per session in component state (resets when filters are cleared, since "Filtered" is meaningless without filters).

**This spec is not:**

- A row-checkbox selection model (Option C from shaping). The user picked the toggle approach explicitly. Row checkboxes can be a follow-up if needed.
- A change to the per-row drawer behaviour. The drawer keeps all four action buttons + Save Notes + Create Work Item exactly as today.
- A change to the underlying status lifecycle or supersession semantics.
- A bulk re-classification (changing `category` / `finding_type` / `severity` in bulk). Status-only.
- A bulk Create-Work-Item action (the drawer's `finding-action-create-work-item` stays single-row in v1).
- A bulk Save Notes action separate from the reviewer-notes field on the confirmation modal. The shared reviewer note IS the bulk-save-notes path.
- A change to existing single-row bulk endpoints (`POST /findings/{id}/review`). They stay; bulk-review is a sibling.
- A new finding status. The four existing reviewer transitions (`accepted`/`ignored`/`needs_review`/`resolved`) cover the surface.
- A change to `discovery_finding` schema or wire shape. The bulk endpoint mutates existing rows.
- A backfill or migration for existing findings.
- A streaming / progress-bar UI for large bulk actions. v1 is request-response with a single toast.
- A change to the FindingsTab's filter / search / table-render code beyond adding the new toolbar above it.

## Decisions already made (don't re-litigate in shape-spec)

These were settled in the conversation that produced this raw idea:

1. **Toggle + 4 action buttons, NOT 8 separate buttons NOT row-checkboxes.** User explicitly chose the toggle approach during shaping.
2. **Confirmation modal fires for every bulk action.** No size threshold. Even bulk-accepting 2 findings opens the modal. Rationale: bulk is a different commitment than single-row; the modal echoes scope + filters + counts so accidental wider-than-intended actions are impossible.
3. **Skip-already-in-target semantics.** The endpoint applies the new status only to findings whose current `status` differs from the target. Already-in-target rows are returned in `skipped_count`. NOT skipped: any finding in `status='resolved'` does NOT auto-skip a transition back to (say) `needs_review` — only literal target-status matches are skipped.
4. **Counts echo on action buttons + segmented toggle.** Both toggle sides AND every action button show the actionable count for the active scope. Counts update live as filters change.
5. **Sticky scope toggle.** Remembers across actions; resets only when filters are cleared (since "Filtered" loses meaning).
6. **Optional shared reviewer note.** One textarea on the confirmation modal; the note is applied to every affected finding.
7. **Optimistic `runSummary` delta after success.** Same pattern as the single-row `onFindingUpdated` callback. Bulk version applies the delta in one pass: `runSummary.{newStatus} += updated_count`, `runSummary.{oldStatus} -= updated_count` (the latter aggregated from the response). For correctness when starting status varies per row, return per-row `from_status → to_status` deltas from the endpoint (see Open Questions Q1).
8. **Backend uses path consistent with existing finding endpoints** — `POST .../findings/bulk-review` (not `PATCH .../findings/bulk` or `POST .../findings/bulk` — the `-review` suffix mirrors the existing single-row `POST /findings/{id}/review` precedent).
9. **One commit per layer.** AMS → gateway → frontend. Same cadence as recent specs.

## Specific requirements (rough — let shape-spec refine)

### AMS layer

1. **New endpoint** on `DiscoveryFindingController` at `POST /api/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/findings/bulk-review`.

2. **Request body** (`BulkReviewDiscoveryFindingsRequest`):
   ```java
   public record BulkReviewDiscoveryFindingsRequest(
     List<UUID> ids,            // optional — exact id set (Option-C-style future-proofing)
     ListFindingsFilters filter, // optional — server-applies same filters as the UI
     String status,             // required — one of accepted|ignored|needs_review|resolved
     String reviewerNotes        // optional — applied to every affected finding
   ) {}
   ```
   - `ids` and `filter` are mutually exclusive (validate); if both null/missing, the action applies to every actionable finding in the (project, architecture, run) scope.
   - `status` validated against the existing `VALID_STATUSES` set; reject 400 if invalid.

3. **Response body** (`BulkReviewDiscoveryFindingsResponse`):
   ```java
   public record BulkReviewDiscoveryFindingsResponse(
     int updatedCount,
     int skippedCount,
     // Per-from-status breakdown so the frontend can apply runSummary deltas
     // accurately (e.g. "10 went accepted→ignored; 5 went needs_review→ignored").
     Map<String, Integer> deltaByFromStatus
   ) {}
   ```

4. **Service-layer logic** in `DiscoveryFindingService`:
   - Resolve the candidate set: if `ids` given → fetch by id list (filter by run for safety); else if `filter` given → apply the same query as `search()`; else fetch all findings for the run.
   - Filter to actionable: `f.status != requestedStatus`.
   - Atomic batch update: stamp `status`, `reviewed_at = NOW()`, `reviewer_notes` (only if request supplied non-null), `updated_at = NOW()`.
   - Return `{ updatedCount, skippedCount, deltaByFromStatus }` where `skippedCount = (candidates.size() - updatedCount)` and `deltaByFromStatus` maps each pre-mutation status string to its count among the updated rows.

5. **Concurrency**: single `@Transactional` boundary. No advisory locking; the existing optimistic-concurrency model (per-row `updated_at` stamp) is sufficient — a row that another reviewer already moved out of the candidate-set since the user's last fetch will simply not match the actionable filter and roll into `skipped_count`.

6. **Validation**:
   - `status` must be one of the four reviewer-valid statuses (`accepted`/`ignored`/`needs_review`/`resolved`). NOT `new` — bulk reverting to `new` is out of scope per Decision 7.
   - When `ids` supplied: every id must belong to the path's `(projectId, architectureId, runId)` — server-side guard against cross-run id injection. 404 if any id is foreign.
   - When `filter` supplied: only the fields on `ListFindingsFilters` are honoured (defense against unrecognised filter fields).
   - When both `ids` and `filter` supplied → 400 `mutually_exclusive_inputs`.

7. **Tests** in `DiscoveryFindingControllerTest` / `DiscoveryFindingServiceTest`:
   - Happy path: 47 findings in filtered scope, 42 actionable + 5 already-accepted → response `updatedCount=42, skippedCount=5`.
   - All in target status → `updatedCount=0, skippedCount=N`.
   - Mixed from-status: 10 from `new`, 5 from `needs_review` → `deltaByFromStatus={'new':10, 'needs_review':5}`.
   - Cross-run id injection → 404.
   - Mutually-exclusive ids + filter → 400.
   - Invalid status → 400.
   - Atomicity: simulated mid-update DB error → all rolled back (no partial commit).
   - `reviewer_notes` applied to every updated finding; null reviewer_notes leaves existing notes intact.

### Gateway layer

8. **Proxy route** on the existing api-migration-validation findings router (or wherever the discovery findings proxy lives — verify in shape-spec): `POST /api/v1/discovery/projects/:projectId/architectures/:architectureId/runs/:runId/findings/bulk-review` → forwards to AMS verbatim.

9. **Typed client wrapper** in `gateway/src/services/architectureModelClient.ts` (or `discoveryClient.ts` — match existing pattern): `bulkReviewFindings(projectId, architectureId, runId, body): Promise<BulkReviewDiscoveryFindingsResponse>`.

10. **Tests** in the gateway test suite: 1 proxy pass-through test asserting verbatim forwarding of body + status + response.

### Frontend layer

11. **New `bulkReviewFindings` function** in `frontend/src/api/findingsApi.ts` matching the gateway's signature. Returns the typed response shape.

12. **New toolbar block** in `FindingsTab.tsx` rendered between the filter strip and the table:
    - Row 1 (segmented toggle): `Bulk apply to: [ All (N) | Filtered (M) ]`
      - When no filter is active: Filtered side disabled with tooltip "Apply a filter to enable" and toggle locked to All.
      - When a filter is active and toggle is on All: clicking Filtered switches scope.
      - Sticky: scope state survives across actions; resets to All when `Clear filters` is clicked.
    - Row 2 (four action buttons): `[Accept (X)] [Ignore (X)] [Needs Review (X)] [Mark Resolved (X)]`
      - `X` = count of findings in active scope where `status != action's target status`.
      - Each button disabled when its `X === 0`, with tooltip "All findings in scope are already <status>".
      - Each button disabled while ANY bulk action is in flight (only one bulk at a time).

13. **Confirmation modal** (`BulkFindingActionConfirmModal.tsx` — new file):
    - Title: `Mark {X} findings as {Status}?`
    - Body line 1: `Scope: {All|Filtered}` plus a chip-list of active filter values if Filtered (e.g. `Severity=high`, `Category=ambiguity`).
    - Body line 2: pre-action breakdown: `Will change status on: {X} findings` + `Already {status}: {skippedPreview}` (computed client-side from `runSummary` + filtered count; refined to actual `skippedCount` in the post-toast).
    - Optional reviewer note textarea labelled "Optional reviewer note (applied to all selected findings):" with 500-char soft cap.
    - Buttons: `[Cancel]` and `[Confirm <Action> (X)]`.
    - Dismissal: Cancel button + ESC + click-outside-backdrop (all three; matches existing modal patterns).
    - The Confirm button shows a small spinner + disables while the API call is in flight.

14. **Post-action toast** rendered via the existing toast system (or a small inline status banner if no toast system exists — shape-spec confirms):
    - Success: `✓ Marked {updatedCount} of {scopedTotal} findings as {Status}.` plus `{skippedCount} were already {status} (skipped).` when skipped > 0.
    - Failure: `✗ Bulk review failed: {error}.` (kept short; details in browser console).

15. **Optimistic `runSummary` delta** after a successful bulk action:
    - Read `deltaByFromStatus` from the response.
    - Apply: `setRunSummary(prev => { const next = {...prev}; for each [fromStatus, count] in delta: next[fromStatus] -= count; next[toStatus] += count; return next; })`.
    - The `criticalHigh` count is unaffected by reviewer-status changes (severity is independent).
    - The filtered table also needs refreshing — call the existing filtered-fetch `useEffect`'s underlying function manually or trigger via filter-state nudge (shape-spec picks the cleanest pattern).

16. **Tests** in `FindingsTab.test.tsx`:
    - Toggle: clicking Filtered when no filter active → button is disabled (or click is no-op + tooltip shown).
    - Action button click opens the confirmation modal.
    - Confirmation modal: Cancel closes; ESC closes; click-outside closes; Confirm fires `bulkReviewFindings` with correct body.
    - Toast renders correct counts from the API response.
    - `runSummary` updates correctly after a successful bulk action.
    - Mutually-exclusive ids+filter: not testable client-side (server-only).

### Verification

After this spec:
- Open Findings tab on a real run. The toolbar shows the segmented toggle + 4 action buttons with correct counts.
- Set Severity=high filter. Toggle's Filtered side becomes enabled; counts update.
- Click `Accept (47)`. Modal opens echoing "Mark 47 findings as Accepted? Scope: Filtered (Severity=high)".
- Confirm. API call succeeds; toast shows `✓ Marked 47 of 47 findings as Accepted.`; the Accepted summary pill ticks up by 47; the Needs Review pill (or wherever the 47 came from) ticks down by 47; filtered table refreshes.
- Click `Accept` again — disabled with tooltip "All findings in scope are already accepted".
- Clear filters. Toggle resets to All; counts repopulate against the full run.

## Out of Scope

- Row-checkbox selection model (Option C from shaping — deferred).
- Bulk Create-Work-Item action.
- Bulk re-classification (changing category / finding_type / severity in bulk).
- Bulk reverting to `status='new'` (would defeat the point of reviewer actions).
- A streaming / progress bar for large bulk actions. v1 is request-response.
- Cross-run bulk actions (e.g. "accept all critical findings across every run for this architecture"). v1 is per-run.
- Bulk-action audit log / undo. Existing per-row `reviewed_at` + `reviewer_notes` cover audit; full undo is out of scope.
- Change to per-row drawer behaviour.
- Change to single-row review endpoint or its semantics.
- New toast / banner infrastructure if none exists (shape-spec picks an existing pattern or notes the gap).
- Changes to the existing `runSummary` derivation for non-bulk paths.
- `@JsonNaming` audit for the new DTOs (follow existing snake_case convention).

## Dependencies

- `2026-05-16-discovery-findings-first-class` (shipped) — provides `discovery_findings` table + single-row `/review` endpoint + `FindingsTab.tsx` infrastructure.
- `2026-05-28` findings UI work (just shipped) — the runSummary unfiltered fetch + optimistic delta in `onFindingUpdated`. This spec extends the same delta path.
- `2026-05-22+ 2026-05-28` Discovery Candidate bulk-review pattern (`DiscoveryCandidateTable.tsx`'s `Approve All / Approve Filtered`) — design precedent.

No new external dependencies.

## Open questions for shape-spec to clarify

1. **`deltaByFromStatus` response field — endpoint computes it or client?**
   The endpoint NEEDS to know each row's old status (it's reading them anyway to decide skip-vs-update). Returning the breakdown is ~5 LOC of grouping. Alternative: client refetches `runSummary` after success (clean but wastes a round-trip).
   My instinct: **endpoint computes it**. Avoids the extra round-trip; lets the optimistic delta be exact rather than approximate.

2. **Filter shape in the endpoint body — verbatim `ListFindingsFilters` JSON or restructured?**
   The frontend has a `ListFindingsFilters` type; AMS has a sibling. Easiest path: define a sibling Java record matching the same fields and accept it directly in the body. Alternative: flatten the fields (`category`, `severity`, `findingType`, `status`, `source`, `q`, `linkedTargetType`, `linkedTargetId`) into the request record.
   My instinct: **dedicated nested filter object on the request** — `BulkReviewDiscoveryFindingsRequest.filter: BulkReviewFilter`. Keeps the request shape declarative and lets us add filter fields without changing the request envelope.

3. **Confirmation modal threshold (skip modal for very small bulks)?**
   Decision 2 above says "modal for every bulk". But there's an argument for skipping the modal when count is `1` (the user could've used the drawer in that case; the bulk path is just being lazy). My instinct: **modal always**. Bulk has a different mental model; consistency beats one click saved.

4. **What happens if the post-bulk filtered table refresh shows 0 rows?**
   E.g. user filters to Severity=high, accepts all 47 (now status=accepted). If the active filter is "status != accepted" implicitly, the rows disappear from the table after the action. That's correct behaviour. My instinct: **no special UX**; the empty-state of the table covers it.

5. **`reviewer_notes` overwrite semantics.**
   If a row already has a `reviewer_notes` value and the bulk applies a different one, do we overwrite or append? My instinct: **overwrite**. Bulk action is a deliberate reviewer choice; if they wanted to preserve, they'd omit the field.

6. **Sticky toggle persistence: in-component state only OR localStorage?**
   Component state means the toggle resets on tab close / page reload. localStorage means it persists across sessions. My instinct: **component state only**. Power users do bulk in a focused session; persisting "I last filtered to high severity 3 days ago" is more annoying than useful.

7. **Should the unfiltered/All scope toggle account for paginated rows (≥500)?**
   The `runSummary` total is server-provided (we just shipped that fix). So "All" should mean every finding in the run regardless of client-side pagination. My instinct: **yes** — the endpoint's no-`ids`-no-`filter` path acts on the full run, not the client's loaded page.

8. **Confirmation modal: where do active filter chips render?**
   Inline as a comma-separated list (`Scope: Filtered (Severity=high, Category=ambiguity)`) or as visual chips/pills? My instinct: **comma-separated text**. The modal is short-lived; chips would look heavier than needed.

9. **Test cap.**
   Per-layer: AMS ~6-8, gateway ~1, frontend ~5. Total ~12-14.
   My instinct: **as proposed**.

10. **Commit boundary.**
    AMS (Liquibase not needed since no schema change) + Java code → gateway → frontend. 3 layers.
    My instinct: **3 commits**, matches the recent specs' cadence.

## Verification

After this spec:
- Bulk-action toolbar visible on Findings tab; scope toggle + 4 action buttons render with live counts.
- Confirmation modal opens on every bulk action with correct scope echo + skipped preview.
- AMS bulk endpoint accepts the body shape, applies skip-already-in-target semantics, returns accurate `updatedCount + skippedCount + deltaByFromStatus`.
- Post-action toast renders correct counts.
- `runSummary` pills update optimistically without a refetch.
- Single-row drawer behaviour is unchanged.

## Commit boundary

3 commits per layer: AMS Java → gateway proxy + typed client → frontend toolbar + modal + tests. ~12-14 new tests total across the three layers.
