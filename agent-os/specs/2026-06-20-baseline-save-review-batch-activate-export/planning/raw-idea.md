TITLE: Baseline save & review — batch persistence + manual Make-Active + table detail view + Postman export.

PROBLEM (3 issues, all in the API Behaviour Baseline save→review→activate tail):
1. "Accept All" and "Save baseline" each LOOP over every capture and hit the gateway ONE REQUEST PER ITEM (SaveAsBaselineModal createBaselineItem loop; CaptureReviewPanel handleAcceptAll/handleRejectAll updateCapture loops). With ~263 captures that's ~264 sequential POSTs / ~263 PATCHes → gateway rate-limiting ("Too many requests"). 
2. After saving, the baseline DETAIL view (BaselineDetailView) dumps EVERY item's full request+response JSON inline → a massive page. And activation is buried (manual Activate on the list).
3. No way to export a baseline for human inspection / spec authoring / reconciliation scope.

DECISIONS ALREADY MADE (FIXED — do NOT relitigate):

A. BATCH ENDPOINTS — best-effort PER-ITEM, NOT atomic, returning per-item results (this is the rate-limit fix AND the "best-effort partial with warnings" the user wants):
   - `POST .../baseline-items/batch` — creates all accepted captures' items in ONE gateway request; processes each server-side BEST-EFFORT (a bad item does NOT abort the rest); returns `{ created: [...], failed: [{ captureId (or index), reason }] }`. Collapses ~264 requests → 1.
   - `PATCH .../captures/batch` — bulk accept/reject in ONE request; best-effort per item; returns `{ updated: [...], failed: [...] }`. Collapses ~263 → 1.
   - Reuse the existing per-item validation/build: extract a shared `buildEntity(request)` from `ApiBehaviourBaselineItemService.create` (validation ~lines 50-103) reused by single + batch; reuse the captures `update` field-merge for the captures batch.
   - Mirror the discovery `DiscoveryFindingController.bulkCreate` (@PostMapping "/bulk") + `DiscoveryFindingService.bulkCreate` (cap `MAX_BULK_FINDINGS=500`) PATTERN, BUT make ours NON-ATOMIC/best-effort-per-item (discovery's is one transaction; ours returns a per-item failed[] and continues).
   - Integrity hash is NOT computed at item-create (only at activate) — the batch just persists rows; no hashing concern.
   - Gateway: add explicit proxied batch routes (the generic `registerCrudProxy` only knows collection + /:id shapes, so a collection-level POST/PATCH to `/batch` needs explicit routes registered BEFORE the /:id routes). RAISE the body-size limit for these batch routes — 263 items carrying full request/response JSON envelopes exceed the current 32KB `maxMessageBytes`. (After batching, the RPM 60→300 band-aid can be reverted/left.)

B. UI BUTTONS — three actions, separable AND combinable:
   - Capture-review stage (CaptureReviewPanel): "Accept All", "Reject All", "Save All" (the existing Save-as-Baseline CTA, now batched), and a NEW "Accept and Save All" (combined: accept-all THEN save, in one click). All best-effort with clear warnings listing exactly which captures/items failed to accept/save (driven by the batch `failed[]`).
   - Saved-baseline stage: "Make Active" + "Export Postman Collection". SHARED toolbar, contextually enabled: Accept/Save are DISABLED once past the capture stage; Make Active is enabled only while the saved baseline is draft/not-active; Export is enabled on ANY saved baseline (draft OR active).

C. MAKE ACTIVE — fully SEPARATE and MANUAL (NO auto-activate):
   - Own button using the EXISTING server path `updateBaseline(status:'active')` (the draft→active transition already stamps the integrity hash + provenance — Spec C — for kind='current').
   - NO auto-activate on save. Rationale: best-effort partial saves can leave gaps, so the user reviews the warnings, fixes gaps, THEN deliberately activates.
   - The existing per-row "Activate" on the baselines list MAY stay as a fallback.

D. POST-SAVE NAVIGATION: after a Save, navigate back to the baselines LIST (route `/projects/:p/architectures/:a/api-behaviour`) — NOT the detail dump. The row shows "draft" until the user clicks Make Active.

E. DETAIL VIEW: default to a compact TABLE of captured behaviours (Method / Path / Scenario / Status); a "Full detail" TOGGLE reveals the full request/response JSON. Replaces today's BaselineDetailView inline dump of every item. Reuse the CaptureReviewPanel table styling + the existing tab/toggle pattern.

F. POSTMAN EXPORT — PURE FRONTEND (no AMS/server save):
   - Download a Postman Collection v2.1 JSON containing EVERY baseline item with as much captured detail as exists: method, path, query, headers, request body, and the response (status + body) as a saved example.
   - `{{baseUrl}}` collection variable (optionally pre-filled from the session `api_base_url` via a fail-soft `getCaptureSession`, else blank).
   - Multi-step `sequence_json` items: FLATTEN the chain into ordered Postman requests so nothing captured is lost ("as much detail as captured").
   - Reuse the existing `utils/fileOperations.ts` `triggerDownload` (~line 558) + `sanitizeFilename` (~540). Button on the saved-baseline toolbar; available on any saved baseline (draft or active).

GROUNDING / KEY CODE (verified earlier):
- frontend: `SaveAsBaselineModal.tsx` (sequential `createBaselineItem` loop ~198-258 → swap for one batch call; navigation ~284-287 currently → detail, change to list). `CaptureReviewPanel.tsx` (`handleAcceptAll`/`handleRejectAll` loops ~542-598 → batch; add "Accept and Save All"; the Save CTA). `BaselineDetailView.tsx` (inline dump ~536-596, `formatJson` ~91-98 → table default + Full-detail toggle + Make Active/Export toolbar). `BaselinesList.tsx` (status badge ~42-53; `nextStatusAction` Activate/Archive ~70-82; `handleStatusAction` → `updateBaseline` ~121-143). `ApiBaselinesListPage.tsx` (list page; route `/api-behaviour`). `apiBehaviourClient.ts` (add `createBaselineItemsBatch` + `updateCapturesBatch`; `updateBaseline` already exists with status state machine; `listBaselineItems`; `getCaptureSession` for `api_base_url`). `utils/fileOperations.ts` (`triggerDownload` ~558, `sanitizeFilename` ~540).
- AMS: `ApiBehaviourBaselineItemController`/`Service` (single create ~62-67; per-item validation ~50-103 → extract `buildEntity`; NO bulk today). `ApiBehaviourCaptureController`/`Service` (single PATCH ~79-85; NO bulk). `DiscoveryFindingController.bulkCreate` + `DiscoveryFindingService.bulkCreate` (the bulk PATTERN to mirror, but make ours best-effort/non-atomic). `BaselineContentHashUtil` (stamped at activate, not item-create).
- gateway: `apiMigrationValidation.ts` (`API_BEHAVIOUR_RESOURCES` ~81-89, `registerCrudProxy` ~245-264, `buildAmsUrl` ~104-130, `proxyToAms` ~139-232). Rate limit applied globally `server.ts:31`; `config.ts` `rateLimitRpm`=300, `rateLimitBurst`=20, `maxMessageBytes`=32KB (~276).

OPEN QUESTIONS for shaping (shaper decides what to ask):
- Exact batch request/response DTO shapes + the `failed[]` item identity (captureId vs index).
- Per-call cap (mirror discovery 500 vs higher e.g. 1000) + HOW to raise the body-size limit for batch routes (a dedicated higher limit on the batch routes vs bumping global `maxMessageBytes`).
- `captures/batch` shape: a shared patch body + a list of ids (accept-all/reject-all send identical bodies) vs a list of `{id, patch}`.
- "Accept and Save All" sequencing: accept-batch THEN save-batch = 2 requests — confirm; if accept partially fails, proceed to save the ones that accepted + warn, or stop?
- Make Active / Export toolbar HOME: BaselineDetailView toolbar (user described "click the row → Make Active button beside the now-disabled Accept/Save") — confirm vs the baselines-list row; and whether the existing list-row Activate stays.
- Detail-view table columns + the toggle widget (reuse CaptureReviewPanel table).
- Postman: response-example shape; sequence-flatten ordering; `{{baseUrl}}` prefill (fail-soft `getCaptureSession`) vs blank.

NON-GOALS:
- The data-type format-defaults wizard step (that is the separate Spec A).
- Changing the integrity-hash/activation server logic (reuse existing `updateBaseline` status path; activation stamps the hash as today).
- Server-side Postman storage (pure frontend only).
- Atomic all-or-nothing batch (explicitly best-effort per-item with results).
- Removing the existing per-row Activate on the baselines list (it may stay as a fallback).
