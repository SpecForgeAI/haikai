# Spec Requirements: Baseline save & review — batch persistence + manual Make-Active + table detail view + Postman export

## Initial Description

Source: `planning/raw-idea.md` (no `initialization.md` present; the raw idea carries the original description).

Three issues in the API Behaviour Baseline save→review→activate tail:

1. **Per-item request storms.** "Accept All" and "Save baseline" each LOOP over every capture and hit the gateway ONE REQUEST PER ITEM (`SaveAsBaselineModal` `createBaselineItem` loop; `CaptureReviewPanel` `handleAcceptAll`/`handleRejectAll` `updateCapture` loops). With ~263 captures that is ~264 sequential POSTs / ~263 PATCHes → gateway rate-limiting ("Too many requests").
2. **Heavy detail view + buried activation.** After saving, `BaselineDetailView` dumps EVERY item's full request+response JSON inline → a massive page. Activation is buried (manual Activate on the list).
3. **No export.** No way to export a baseline for human inspection / spec authoring / reconciliation scope.

## Requirements Discussion

The user reviewed 8 clarifying questions and replied "defaults are fine" — accepting ALL recommended defaults for questions 1-8. No visual assets were provided.

### First Round Questions

**Q1: Batch request/response DTO shapes and the `failed[]` item identity.**
**Answer (default accepted):**
- `POST .../baseline-items/batch` — request `{ items: CreateApiBehaviourBaselineItemRequest[] }` → response `{ created: ApiBehaviourBaselineItemDto[], failed: [{ index, captureId, reason }] }`.
- `PATCH .../captures/batch` → response `{ updated: ApiBehaviourCaptureDto[], failed: [{ id, reason }] }`.

**Q2: Per-call cap and body-size handling for the batch routes.**
**Answer (default accepted):** Per-call cap = 500 with a clear error above the cap. NO body-limit change is needed: the existing global `express.json` 30MB limit (`server.ts:27`) already bounds these proxy routes. The 32KB `maxMessageBytes` is chat-only and does NOT apply to the api-behaviour proxy routes. The per-call 500 cap plus a clear 413/400 is the guardrail.

**Q3: `captures/batch` body shape.**
**Answer (default accepted):** A LIST of `{ id, patch }` entries (NOT a single shared patch + list of ids). This preserves each capture's own `reviewer_notes` masks on reject-all; accept-all sends the same patch per id.

**Q4: "Accept and Save All" sequencing and partial-failure behaviour.**
**Answer (default accepted):** Two sequential requests (accept-batch → save-batch). On partial accept failure, PROCEED to save the captures that accepted, then show ONE combined warning listing accept failures + save failures.

**Q5: Make Active / Export toolbar home, and the fate of the existing list-row Activate.**
**Answer (default accepted):** The Make Active / Export toolbar lives on `BaselineDetailView`. Make Active is enabled only while `status === 'draft'`; Export is enabled on ANY saved baseline (`draft` or `active`). The existing per-row Activate on `BaselinesList` STAYS as a fallback.

**Q6: Detail-view table columns and the toggle widget.**
**Answer (default accepted):** Detail table columns = Method · Path · Scenario · Status, reusing the `CaptureReviewPanel` review-table styling. A PAGE-LEVEL "Full detail" toggle switches all rows to today's per-item request/response JSON dump (including `BaselineSequenceView` for sequence items).

**Q7: Postman export shape — response examples, sequence flattening, `{{baseUrl}}` prefill.**
**Answer (default accepted):**
- (a) One saved response example per item built from `response_json` `{headers, body}` with `code = response_status`, named `"<scenario_name> (<status>)"`.
- (b) Flatten `sequence_json` `steps[]` into ordered separate Postman requests named `"<scenario> — <role> #<index>"` (setup → act → cleanup order), preserving inter-step `response_refs` as DESCRIPTION NOTES (no generated `pm.*` scripts).
- (c) `{{baseUrl}}` collection variable, fail-soft prefilled from `getCaptureSession(...).api_base_url` when the baseline has a `session_id` (blank if absent or the fetch fails).

**Q8: Any additional non-goals.**
**Answer (default accepted):** No extra non-goals beyond those already stated.

### Existing Code to Reference

**Similar Features Identified (grounded, verified earlier):**

Frontend:
- Feature: Save-as-baseline flow — Path: `frontend/src/.../SaveAsBaselineModal.tsx` (sequential `createBaselineItem` loop ~198-258 → swap for one batch call; navigation ~284-287 currently → detail, change to list).
- Feature: Capture review — Path: `frontend/src/.../CaptureReviewPanel.tsx` (`handleAcceptAll`/`handleRejectAll` loops ~542-598 → batch; add "Accept and Save All"; existing Save CTA; review-table styling to reuse for the detail table).
- Feature: Baseline detail — Path: `frontend/src/.../BaselineDetailView.tsx` (inline dump ~536-596; `formatJson` ~91-98; HAS NO toolbar today — net-new; reuses its existing `tabsNav` toggle pattern for the Full-detail toggle; `BaselineSequenceView` for sequence items).
- Feature: Baselines list — Path: `frontend/src/.../BaselinesList.tsx` (status badge ~42-53; `nextStatusAction` Activate/Archive ~70-82; `handleStatusAction` → `updateBaseline` ~121-143; per-row Activate STAYS as fallback).
- Feature: List page / route — Path: `frontend/src/.../ApiBaselinesListPage.tsx` (route `/projects/:p/architectures/:a/api-behaviour` is the post-save navigation target).
- Client: `frontend/src/.../apiBehaviourClient.ts` — add `createBaselineItemsBatch` + `updateCapturesBatch`; reuse existing `updateBaseline` (status state machine, stamps hash on draft→active), `listBaselineItems`, `getCaptureSession` (for `api_base_url`).
- Utils: `frontend/src/utils/fileOperations.ts` — reuse `triggerDownload` (~558) + `sanitizeFilename` (~540).

AMS (backend):
- Service to extend: `ApiBehaviourBaselineItemService` — single `create` per-item validation ~50-83; extract a shared `buildEntity(request)` reused by single + batch. NOTE: the baseline-items route prefix has NO `architectureId` path segment.
- Service to reuse: `ApiBehaviourCaptureService` — reuse the `update` field-merge (~122-185) for the captures batch.
- Controllers: `ApiBehaviourBaselineItemController` / `ApiBehaviourCaptureController` (no bulk endpoints today; add batch).
- Structural precedent: `DiscoveryFindingController.bulkCreate` (`@PostMapping "/bulk"`) + `DiscoveryFindingService.bulkCreate` (cap `MAX_BULK_FINDINGS=500`). Mirror the shape, BUT make ours BEST-EFFORT / NON-ATOMIC: per-item `failed[]`, no throw-on-first-bad-item (discovery's is one transaction).
- `BaselineContentHashUtil` — stamped at activate only; the batch persists rows only (no hashing concern).

Gateway:
- `apiMigrationValidation.ts` — `API_BEHAVIOUR_RESOURCES` ~81-89, `registerCrudProxy` ~245-264, `buildAmsUrl` ~104-130, `proxyToAms` ~139-232. Add explicit proxied batch routes; they MUST be registered BEFORE the generic `registerCrudProxy` `/:id` routes (else `/batch` is captured as `:id`).
- `server.ts` — global `express.json` 30MB limit at line 27 (bounds the proxy routes); rate limit applied globally at `server.ts:31`.
- `config.ts` — `rateLimitRpm`=300, `rateLimitBurst`=20, `maxMessageBytes`=32KB (~276) is chat-only (NOT applied to these routes). After batching, the RPM 60→300 band-aid can be reverted/left.

## Visual Assets

No visual assets provided. Mandatory bash check of `planning/visuals/` returned no image/PDF files.

## Requirements Summary

### Functional Requirements

Batch persistence (the rate-limit fix):
- A best-effort, NON-ATOMIC `POST .../baseline-items/batch` creating all accepted captures' items in ONE gateway request; one bad item does NOT abort the rest; returns per-item `created[]` + `failed[{ index, captureId, reason }]`. Collapses ~264 requests → 1.
- A best-effort, NON-ATOMIC `PATCH .../captures/batch` for bulk accept/reject in ONE request; one bad item does NOT abort the rest; body is a LIST of `{ id, patch }`; returns `updated[]` + `failed[{ id, reason }]`. Collapses ~263 → 1.
- The frontend collapses today's per-item loops into single batch calls and renders the returned `failed[]` as warnings.

UI actions (three separable AND combinable, at the capture-review stage on `CaptureReviewPanel`):
- "Accept All", "Reject All", "Save All" (existing Save-as-Baseline CTA, now batched), and a NEW "Accept and Save All" (accept-batch → save-batch in one click).
- All best-effort with clear warnings listing exactly which captures/items failed, driven by the batch `failed[]`.
- "Accept and Save All" proceeds to save on partial accept failure and shows ONE combined warning (accept failures + save failures).

Make Active (manual, no auto-activate):
- A dedicated Make Active button on `BaselineDetailView`, gated to `status === 'draft'`, using the EXISTING `updateBaseline(status:'active')` path (draft→active stamps the integrity hash + provenance for kind='current').
- NO auto-activate on save — best-effort partial saves can leave gaps, so the user reviews warnings, fixes gaps, THEN deliberately activates.
- The existing per-row Activate on `BaselinesList` stays as a fallback.

Post-save navigation:
- After a Save, navigate back to the baselines LIST (`/projects/:p/architectures/:a/api-behaviour`), NOT the detail dump. The row shows "draft" until Make Active is clicked.

Detail view:
- Default to a compact TABLE of captured behaviours (columns: Method · Path · Scenario · Status), reusing `CaptureReviewPanel` review-table styling.
- A PAGE-LEVEL "Full detail" toggle (reusing the existing `tabsNav` toggle pattern) switches all rows to today's per-item request/response JSON dump, including `BaselineSequenceView` for sequence items. Replaces today's always-on inline dump.

Postman export (PURE FRONTEND, no AMS/server save):
- Download a Postman Collection v2.1 JSON containing EVERY baseline item with as much captured detail as exists (method, path, query, headers, request body, response).
- One saved response example per item from `response_json` `{headers, body}`, `code = response_status`, name `"<scenario_name> (<status>)"`.
- Flatten `sequence_json` `steps[]` into ordered separate Postman requests named `"<scenario> — <role> #<index>"` (setup → act → cleanup), preserving inter-step `response_refs` as DESCRIPTION NOTES (no generated `pm.*` scripts).
- `{{baseUrl}}` collection variable, fail-soft prefilled from `getCaptureSession(...).api_base_url` when the baseline has `session_id` (blank if absent / fetch fails).
- Export button on the `BaselineDetailView` toolbar; enabled on ANY saved baseline (draft OR active).
- Postman mapping source: `ApiBehaviourBaselineItemDto` — `requestJson {query, headers, body}`, `responseJson {headers, body}`, `method` / `path` / `responseStatus` / `scenarioName` / `sequenceJson`.

### Reusability Opportunities

- Extract a shared `buildEntity` from `ApiBehaviourBaselineItemService.create` (validation ~50-83) reused by single + batch.
- Reuse the captures `update` field-merge (~122-185) for the captures batch.
- Mirror the discovery `bulkCreate` structure, made best-effort/non-atomic.
- Reuse the `CaptureReviewPanel` review-table styling for the detail table.
- Reuse the `BaselineDetailView` existing `tabsNav` toggle pattern for the Full-detail toggle (the view has NO toolbar today — that is net-new).
- Reuse the existing `updateBaseline` status state-machine, `getCaptureSession`, `listBaselineItems`, and `triggerDownload` / `sanitizeFilename`.
- `BaselineSequenceView` reused under the Full-detail toggle for sequence items.

### Scope Boundaries

**In Scope:**
- The two best-effort, non-atomic batch endpoints (baseline-items + captures) and their gateway proxy routes (ordered before `/:id`).
- The four capture-review actions (Accept All / Reject All / Save All / Accept-and-Save-All), all batched and best-effort with `failed[]` warnings.
- Manual Make Active on `BaselineDetailView` (draft-gated) via the existing `updateBaseline` path.
- Post-save navigation to the baselines list.
- Table-default detail view + page-level Full-detail toggle.
- Pure-frontend Postman v2.1 export (every item, max detail, response examples, sequence flattening, fail-soft `{{baseUrl}}`).

**Out of Scope (Non-Goals):**
- The data-type format-defaults wizard step (separate Spec A).
- Changing the integrity-hash / activation server logic (reuse the existing `updateBaseline` status path; activation stamps the hash as today).
- Server-side Postman storage (pure frontend only).
- Atomic all-or-nothing batch (explicitly best-effort per-item with results).
- Removing the existing per-row Activate on the baselines list (it may stay as a fallback).
- No extra non-goals beyond these.

### Technical Considerations

- **Body-size grounding correction (verified):** The 32KB `maxMessageBytes` (`config.ts` ~276) is chat-only and does NOT apply to the api-behaviour proxy routes. Those routes are bounded by the global `express.json` 30MB limit at `server.ts:27`. Therefore NO body-cap work is needed — the per-call 500 cap + a clear 413/400 is the guardrail.
- AMS baseline-items route prefix has NO `architectureId` path segment.
- Gateway batch routes MUST be registered BEFORE the generic `registerCrudProxy` `/:id` routes, or `/batch` is captured as `:id`.
- Discovery `bulkCreate` is the structural precedent, but ours is best-effort / non-atomic (per-item `failed[]`, no throw-on-first-bad-item).
- `BaselineContentHashUtil` is stamped at activate; the batch persists rows only.
- After batching, the RPM 60→300 rate-limit band-aid can be reverted or left.

### Load-Bearing Test Surfaces

- Both batch endpoints process best-effort and return per-item `failed[]` — one bad item does not abort the rest.
- The frontend collapses the per-item loops into single batch calls and renders the `failed[]` as warnings.
- "Accept and Save All" proceeds to save on partial accept failure and surfaces ONE combined warning.
- Make Active uses the existing `updateBaseline` status path (stamps the hash on draft→active) and is gated to `draft`.
- Export produces a valid Postman v2.1 collection with all items + response examples + flattened sequences + `{{baseUrl}}`.
- The detail view defaults to the table; the toggle reveals full JSON.
- Post-save navigation lands on the list with the row shown as draft.
- Gateway batch routes proxy correctly and are ordered before `/:id`.
