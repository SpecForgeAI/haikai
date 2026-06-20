# Task Breakdown: Baseline Save & Review — Batch + Activate + Table Detail + Postman Export

## ⚠️ IMPLEMENTER GUARDRAILS — READ BEFORE ANY EDIT ⚠️

MANDATORY. Past whole-file `Write`s have CLOBBERED large files in this repo, and
implementer subagents have `Write` but NO `Edit`.

1. **EXISTING files — NEVER re-`Write` the whole file.** Make ANCHORED in-place
   edits via `Bash`/Node string splices against unique anchors. Especially:
   - `frontend/src/components/DashboardView/SaveAsBaselineModal.tsx`
   - `frontend/src/components/DashboardView/CaptureReviewPanel.tsx`
   - `frontend/src/components/DashboardView/BaselineDetailView.tsx`
   - `frontend/src/components/DashboardView/BaselinesList.tsx`
   - `frontend/src/api/apiBehaviourClient.ts`
   - `gateway/src/routes/apiMigrationValidation.ts`
   - the AMS baseline-item/capture controllers + services + DTOs.
2. **NEW files MAY use `Write`** (the Postman util, new batch request DTOs, new
   test files, any new sub-component).
3. **NEVER use `git checkout`, `git stash`, or `git reset`.** Fix forward.
4. **After every edit to an existing file**, grep for the mojibake marker `â€"`
   (expect ZERO) and re-read the spliced region + surroundings to confirm
   byte-intactness (balanced braces/JSX/imports). Preserve each file's existing
   line endings (CRLF vs LF).
5. Prefer the smallest possible anchored splice; verify with `tsc`/`mvn`, not by
   re-Writing.

## NON-GOALS (enforce throughout)
- The data-type format-defaults wizard step (Spec A).
- Changing the integrity-hash/activation server logic (reuse `updateBaseline`
  status path; activation stamps the hash as today).
- Server-side Postman storage (pure frontend only).
- Atomic all-or-nothing batch (explicitly best-effort per-item with `failed[]`).
- Removing the existing per-row Activate on `BaselinesList`.

## Architectural anchors (verified)
- AMS baseline-items: `ApiBehaviourBaselineItemController` single `@PostMapping`
  ~62-67; `ApiBehaviourBaselineItemService.create` validation ~50-83 + entity
  build ~85-100. Captures: `ApiBehaviourCaptureController` single `@PatchMapping`
  ~79-85; `ApiBehaviourCaptureService.update` field-merge ~122-185. Bulk
  precedent: `DiscoveryFindingController.bulkCreate` + `DiscoveryFindingService.bulkCreate`
  (cap pattern; ours is best-effort/non-atomic). Hash: `BaselineContentHashUtil`
  stamped at activate only.
- Gateway: `apiMigrationValidation.ts` `registerCrudProxy` (~245-264) + the
  resource loop (~266-268); `proxyToAms`/`buildAmsUrl` (~104-232). Register
  `/baseline-items/batch` (POST) + `/captures/batch` (PATCH) BEFORE the loop.
- Frontend: `SaveAsBaselineModal.tsx` (loop ~198-258, navigate ~284-287),
  `CaptureReviewPanel.tsx` (accept/reject loops ~542-598, Save CTA ~774-783),
  `BaselineDetailView.tsx` (dump ~536-596, formatJson ~91-98, tabsNav ~652-685),
  `BaselinesList.tsx` (~42-143), `apiBehaviourClient.ts` (updateBaseline,
  getCaptureSession, listBaselineItems), `utils/fileOperations.ts`
  (triggerDownload ~558, sanitizeFilename ~540).

---

## Task List

### Backend — AMS

#### Task Group 1: AMS batch endpoints (best-effort, non-atomic)
**Dependencies:** None

- [x] 1.0 Add baseline-items + captures batch endpoints
  - [x] 1.1 Write 4-8 focused tests (AMS): baseline-items batch persists all valid
    items + returns `failed[]` (with index + capture_id) for invalid ones WITHOUT
    aborting the rest; captures batch applies each `{id,patch}` best-effort +
    returns `failed[]`; per-call cap 500 → 400; reject-all-style per-row notes
    preserved. Place beside the existing apibehaviour service/controller tests.
  - [x] 1.2 Extract `buildEntity(projectId, request)` from
    `ApiBehaviourBaselineItemService.create` (ANCHORED) and call it from both
    `create` and a new `createBatch(projectId, List<CreateApiBehaviourBaselineItemRequest>)`
    that loops best-effort, collecting `created` + `failed{index,captureId,reason}`.
    Cap 500. Do NOT touch hash logic.
  - [x] 1.3 Add `updateBatch(projectId, List<{id,patch}>)` to
    `ApiBehaviourCaptureService` reusing the existing `update` field-merge per item,
    best-effort, collecting `updated` + `failed{id,reason}`. Cap 500.
  - [x] 1.4 Add controller endpoints (ANCHORED): `@PostMapping("/batch")` on
    `ApiBehaviourBaselineItemController` and `@PatchMapping("/batch")` on
    `ApiBehaviourCaptureController`, with NEW request DTO records
    (`BatchCreateApiBehaviourBaselineItemsRequest { List<...> items }`,
    `BatchUpdateApiBehaviourCapturesRequest { List<ItemPatch> items }`) and
    response records (`{ created/updated, failed }`). Snake_case wire (global default).
  - [x] 1.5 Run ONLY the new tests (`mvn -o -f architecture-model-service/pom.xml -Dtest=<classes> test`).
  - [x] 1.6 Mojibake/intactness check on every edited existing AMS file.

**Acceptance:** both batch endpoints persist/patch best-effort, return per-item
`failed[]`, enforce cap 500, never touch the hash; new tests pass; files intact.

### Backend — Gateway

#### Task Group 2: Gateway batch route proxies
**Dependencies:** Task Group 1

- [x] 2.0 Proxy the two batch routes
  - [x] 2.1 Write 1-3 tests: a POST to `.../baseline-items/batch` and a PATCH to
    `.../captures/batch` proxy JSON to AMS at the matching path (mirror the
    existing `apiMigrationValidation-*-proxy.test.ts`).
  - [x] 2.2 Register the two routes EXPLICITLY in `apiMigrationValidation.ts`
    (ANCHORED) BEFORE the generic `registerCrudProxy` loop so `/batch` is not
    captured as `:id`. Use `proxyToAms`/`buildAmsUrl` with the literal `batch`
    segment. No body-limit change (the 32KB cap is chat-only; routes use the
    global 30mb express.json).
  - [x] 2.3 Run ONLY the new test(s). 
  - [x] 2.4 Mojibake/intactness check on `apiMigrationValidation.ts`.

**Acceptance:** both batch routes proxy correctly, ordered before `/:id`; tests pass.

### Frontend — API client

#### Task Group 3: Batch client functions + types
**Dependencies:** Task Group 2

- [x] 3.0 Add batch clients
  - [x] 3.1 Tests (2-4): `createBaselineItemsBatch` posts to `.../baseline-items/batch`
    returning `{created, failed}`; `updateCapturesBatch` patches `.../captures/batch`
    returning `{updated, failed}`. Mirror the existing client test style.
  - [x] 3.2 Add the two functions + their request/response wire types in
    `apiBehaviourClient.ts` (ANCHORED), mirroring existing helpers + `actionUrl`/
    `gatewayUrl` conventions for the `baseline-items`/`captures` resources + `batch`.
  - [x] 3.3 Run ONLY the new tests; `tsc --noEmit`.
  - [x] 3.4 Mojibake/intactness check on `apiBehaviourClient.ts`.

**Acceptance:** both batch clients call the right URLs + return typed `{...,failed}`.

### Frontend — Review panel (buttons + batch wiring)

#### Task Group 4: CaptureReviewPanel batch + Accept-and-Save-All
**Dependencies:** Task Group 3
**Files:** `CaptureReviewPanel.tsx` (+ it mounts/uses `SaveAsBaselineModal`)

- [x] 4.0 Swap loops for batch + add the combined button
  - [x] 4.1 Tests (3-6): Accept All calls `updateCapturesBatch` ONCE (not a loop)
    + merges `updated` + warns on `failed`; Reject All sends per-row notes-preserving
    patches in one batch; "Accept and Save All" runs accept-batch then save-batch
    and on partial accept failure STILL saves the accepted ones with one combined
    warning. Add to/alongside `CaptureReviewPanel.test.tsx`.
  - [x] 4.2 Replace `handleAcceptAll`/`handleRejectAll` loops (~542-598) with single
    `updateCapturesBatch` calls (ANCHORED); merge the returned `updated[]` into
    state; surface `failed[]` as a warning listing the failed captures.
  - [x] 4.3 Add an "Accept and Save All" action (accept-batch → then the save flow);
    proceed-on-partial-accept with a combined warning.
  - [x] 4.4 Run ONLY this group's tests; `tsc --noEmit`.
  - [x] 4.5 Mojibake/intactness check on `CaptureReviewPanel.tsx`.

**Acceptance:** accept/reject/accept-and-save use single batch calls with warnings;
no per-item loops remain; proceed-on-partial works.

### Frontend — Save modal (batch + navigate to list)

#### Task Group 5: SaveAsBaselineModal batch + post-save navigation
**Dependencies:** Task Group 3

- [x] 5.0 Batch the save + navigate to the list (no auto-activate)
  - [x] 5.1 Tests (2-4): Save calls `createBaselineItemsBatch` ONCE (not a loop);
    on success navigates to the baselines LIST route (NOT the detail route); a
    `failed[]` surfaces a warning; the baseline is left as draft (NO updateBaseline
    status call here). Update `SaveAsBaselineModal.cacheInvalidation.test.tsx`
    (it asserts the detail-route navigation today).
  - [x] 5.2 Replace the `createBaselineItem` loop (~198-258) with a single
    `createBaselineItemsBatch` call (ANCHORED); build the items array exactly as
    the loop did (the `{query,headers,body}` request_json envelope + response_json
    envelope + volatile/sequence carry).
  - [x] 5.3 Change the post-save `navigate` (~284-287) from the detail route to the
    list route `/projects/:p/architectures/:a/api-behaviour`. Do NOT auto-activate.
  - [x] 5.4 Run ONLY this group's tests; `tsc --noEmit`.
  - [x] 5.5 Mojibake/intactness check on `SaveAsBaselineModal.tsx`.

**Acceptance:** one batch save call; navigates to the list; row stays draft; warnings on failures.

### Frontend — Detail view (table + toggle + toolbar)

#### Task Group 6: BaselineDetailView table default + Full-detail toggle + Make Active + Export
**Dependencies:** Task Group 3 (Export uses the Postman util from TG7 — order TG7 before TG6's export wiring, or stub the import)
**Files:** `BaselineDetailView.tsx`

- [x] 6.0 Table-default detail + toolbar
  - [x] 6.1 Tests (3-6): the view defaults to a TABLE (Method·Path·Scenario·Status);
    the "Full detail" toggle reveals the per-item JSON dump; "Make Active" shows
    only while `status==='draft'` and calls `updateBaseline({status:'active'})`;
    "Export Postman Collection" shows for any saved baseline and triggers a download.
    Update existing `BaselineDetailView.*.test.tsx` if needed.
  - [x] 6.2 Add a `viewMode: 'table'|'full'` toggle (ANCHORED, reuse the `tabsNav`
    pattern); default `table`. Render the items section (~536-596) as a compact
    table by default; the `full` mode is today's `<pre>`+`formatJson` dump (keep it,
    incl. `BaselineSequenceView`). Reuse `CaptureReviewPanel` review-table styling.
  - [x] 6.3 Add the NET-NEW toolbar: "Make Active" (gated `status==='draft'`,
    calls the existing `updateBaseline` status path then refreshes/badges active)
    + "Export Postman Collection" (any saved baseline; calls the TG7 util).
  - [x] 6.4 Run ONLY this group's tests; `tsc --noEmit`.
  - [x] 6.5 Mojibake/intactness check on `BaselineDetailView.tsx`.

**Acceptance:** table by default; toggle reveals JSON; Make Active gated to draft;
Export available on any saved baseline.

### Frontend — Postman export util

#### Task Group 7: Postman Collection v2.1 export util (pure frontend)
**Dependencies:** Task Group 3 (types)
**Files:** NEW `frontend/src/utils/postmanExport.ts` (Write)

- [x] 7.0 Build the export util
  - [x] 7.1 Tests (3-6): maps `ApiBehaviourBaselineItemDto[]` → a valid v2.1
    collection (info.schema, item[]); per item carries method/path/query/headers/
    body + one response example (code=status, name "<scenario> (<status>)");
    `sequence_json` items flatten to ordered requests "<scenario> — <role> #<index>"
    with response_refs preserved in the description; `{{baseUrl}}` variable present;
    a baseline with a session prefills baseUrl fail-soft.
  - [x] 7.2 Implement `baselineToPostmanCollection(name, items, baseUrl?)` per R6.
  - [x] 7.3 Wire the download in `BaselineDetailView` (TG6) via `triggerDownload` +
    `sanitizeFilename`, with `{{baseUrl}}` fail-soft prefilled from
    `getCaptureSession(...).api_base_url` when the baseline has `session_id`.
  - [x] 7.4 Run ONLY this group's tests; `tsc --noEmit`.

**Acceptance:** valid v2.1 collection, all items + response examples + flattened
sequences + `{{baseUrl}}`; pure frontend; downloads via the existing helper.

### Testing

#### Task Group 8: Test review & gap analysis (feature-only)
**Dependencies:** Task Groups 1-7

- [x] 8.0 Review TG1-7 tests; fill the highest-value end-to-end gaps (MAX 10 added):
  esp. the rate-limit-fix headline (accept-all/save collapse to single batch calls
  with `failed[]` warnings) and the Postman round-trip. Run ONLY this feature's
  tests across the touched stacks. Final mojibake sweep on every edited existing file.

## Execution Order
1. TG1 (AMS batch) → 2. TG2 (gateway) → 3. TG3 (client) → then TG7 (Postman util)
→ TG4 (review panel) + TG5 (save modal) + TG6 (detail view) → TG8 (test review).
Note: TG4, TG5, TG6 each edit a DIFFERENT frontend file, but TG6's Export wiring
depends on TG7's util — build TG7 before TG6's export step.
