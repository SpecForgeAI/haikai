# Spec: Baseline Save & Review — Batch Persistence + Manual Activate + Table Detail + Postman Export

> Authoritative requirements: `planning/requirements.md`. This spec restates the
> settled design (decisions A–F + the 8 resolved defaults) in implementation terms.
> Visuals: none.

## Overview

Fix the three problems in the API Behaviour Baseline **save → review → activate**
tail:

1. **Rate-limit storm.** "Accept All", "Reject All", and "Save baseline" each loop
   over every capture and hit the gateway **one request per item** (~263 captures
   → ~264 sequential POSTs / ~263 PATCHes), tripping the gateway rate limiter
   ("Too many requests").
2. **Buried activation + a huge detail page.** After saving, `BaselineDetailView`
   dumps every item's full request+response JSON inline; activation is only
   reachable as a per-row action on the list.
3. **No export.** No way to take a baseline out for human inspection / spec
   authoring / reconciliation scope.

The fix: best-effort **batch endpoints**, a restructured **button set**, **manual
Make-Active** (no auto-activate), a compact **table-default detail view** with a
Full-detail toggle, and a pure-frontend **Postman Collection export**.

## User stories

- As a reviewer with hundreds of captures, I can **Accept All** (or **Reject
  All**, or **Accept and Save All**) in **one** request without hitting rate
  limits, and I see a clear warning listing exactly which items failed.
- As a reviewer, after saving a baseline I land back on the baselines **list**
  (not a giant JSON page), where my new baseline shows as **draft**.
- As a reviewer, I deliberately click **Make Active** on a saved baseline when I'm
  satisfied (it's never auto-activated, because a best-effort save can leave gaps).
- As a reviewer, I can open a saved baseline and see a **compact table** of
  captured behaviours, toggling to **Full detail** only when I want the JSON.
- As a reviewer, I can **Export Postman Collection** for any saved baseline
  (draft or active) to inspect/share it.

## Scope / Requirements

### R1 — Batch endpoints (best-effort, non-atomic, per-item results)

**AMS:**
- `POST /api/projects/{projectId}/api-behaviour/baseline-items/batch`
  - Request: `{ "items": CreateApiBehaviourBaselineItemRequest[] }`.
  - Response (200): `{ "created": ApiBehaviourBaselineItemDto[], "failed": [{ "index": number, "capture_id": string|null, "reason": string }] }`.
  - **Best-effort, NON-atomic:** each item is validated + persisted independently;
    a bad item is recorded in `failed[]` and the loop continues (it does NOT abort
    the rest or roll back the successes).
  - Per-call cap **500** (HTTP 400 with a clear message if exceeded).
  - Reuse: extract a private `buildEntity(projectId, request)` from the existing
    `ApiBehaviourBaselineItemService.create` (the validation at ~lines 50–83 +
    entity build ~85–100) and call it from BOTH `create` and `createBatch`.
  - The integrity hash is NOT touched here (it is stamped at activate); the batch
    only persists rows. Item order is irrelevant to the hash (it canonical-sorts).
- `PATCH /api/projects/{projectId}/api-behaviour/captures/batch`
  - Request: `{ "items": [{ "id": string, "patch": UpdateApiBehaviourCaptureRequest }] }`
    (a list of `{id, patch}` so reject-all can preserve each capture's own
    `reviewer_notes` masks; accept-all sends the same patch per id).
  - Response (200): `{ "updated": ApiBehaviourCaptureDto[], "failed": [{ "id": string, "reason": string }] }`.
  - Best-effort, non-atomic; per-call cap **500**; reuse the existing `update`
    field-merge (~lines 122–185) per item.
- Mirror the STRUCTURE of the discovery `DiscoveryFindingController.bulkCreate` /
  `DiscoveryFindingService.bulkCreate` (cap + `@PostMapping("/bulk")` shape), but
  ours is **best-effort/non-atomic** (per-item `failed[]`, no throw-on-first-bad-item).

**Gateway** (`apiMigrationValidation.ts`):
- Register the two batch routes EXPLICITLY and BEFORE the generic
  `registerCrudProxy` collection/`:id` registration (else `/batch` is captured as
  `:id`). They proxy JSON to AMS via the existing `proxyToAms`/`buildAmsUrl`.
- **No body-limit change:** the 32KB `maxMessageBytes` is chat-only and is NOT
  applied to these proxy routes; they are bounded by the global
  `express.json({ limit: '30mb' })` at `server.ts:27`. The per-call 500 cap +
  a clear 413/400 is the guardrail. The RPM band-aid may be left or reverted.

**Frontend** (`apiBehaviourClient.ts`):
- Add `createBaselineItemsBatch(projectId, architectureId, items)` and
  `updateCapturesBatch(projectId, architectureId, items)` returning the typed
  `{ created|updated, failed }` shapes.

### R2 — Button set (three separable + combinable actions)

`CaptureReviewPanel` (capture-review stage):
- **Accept All** — one `updateCapturesBatch` with `{accepted:true, accepted_at}` per id.
- **Reject All** — one `updateCapturesBatch` where each item carries its own
  notes-preserving patch (`{accepted:false, accepted_at:null, reviewer_notes:<each row's masks>}`).
- **Save All** — the existing Save-as-Baseline flow, now using `createBaselineItemsBatch`.
- **Accept and Save All** (NEW, combined) — see R4.
- All four are best-effort: render the batch `failed[]` as a clear warning naming
  the failed captures/items (do not silently drop).

`BaselineDetailView` (saved-baseline stage) toolbar (NET-NEW — this view has no
toolbar today):
- **Make Active** — enabled only while `status === 'draft'` (see R3).
- **Export Postman Collection** — enabled on ANY saved baseline (draft OR active) (R5).

### R3 — Manual Make-Active (no auto-activate)

- **No auto-activate on save.** Make Active is a deliberate, separate action.
- Uses the EXISTING `updateBaseline(projectId, architectureId, baselineId, { status: 'active' })`
  path. The draft→active transition already stamps the integrity hash +
  provenance for `kind='current'` baselines (Spec C) — do NOT change that logic.
- Gated to `status === 'draft'`.
- The existing per-row Activate on `BaselinesList` STAYS as a fallback.

### R4 — "Accept and Save All" + post-save navigation

- Combined action = two sequential requests: `updateCapturesBatch` (accept all)
  → `createBaselineItemsBatch` (save). On a **partial accept failure, PROCEED**
  to save the captures that DID accept, then show ONE combined warning listing
  both the accept failures and any save failures.
- After ANY successful Save (Save All or Accept-and-Save-All), navigate to the
  baselines LIST route `/projects/:projectId/architectures/:architectureId/api-behaviour`
  (NOT the detail view). The new row shows as **draft** until Make Active.

### R5 — Detail view: table default + Full-detail toggle

- `BaselineDetailView` defaults to a compact **table**: columns **Method · Path ·
  Scenario · Status** (reuse `CaptureReviewPanel` review-table styling).
- A **page-level "Full detail" toggle** (reuse the existing `tabsNav` toggle
  pattern in the file) switches ALL rows to today's per-item request/response JSON
  dump (including `BaselineSequenceView` for sequence items).

### R6 — Postman Collection export (pure frontend, v2.1)

- New pure-frontend util mapping `ApiBehaviourBaselineItemDto[]` → a Postman
  Collection v2.1 JSON; download via `utils/fileOperations.ts` `triggerDownload`
  + `sanitizeFilename`. NO server-side storage, NO new backend endpoint.
- Per item → one Postman request: `method`; URL `{{baseUrl}}{path}` + query from
  `request_json.query`; headers from `request_json.headers`; body =
  `request_json.body` as raw JSON.
- One saved **response example** per item from `response_json` (`{headers, body}`)
  with `code = response_status`, name `"<scenario_name> (<status>)"`.
- `sequence_json` multi-step items: FLATTEN `steps[]` into ordered separate
  requests named `"<scenario> — <role> #<index>"` (setup→act→cleanup); preserve
  inter-step `response_refs` as DESCRIPTION NOTES (NOT generated `pm.*` scripts).
- `{{baseUrl}}` collection variable, fail-soft prefilled from
  `getCaptureSession(...).api_base_url` when the baseline has `session_id`
  (blank if absent / fetch fails).
- Export is available on ANY saved baseline (draft or active).

## Non-goals

- The data-type format-defaults wizard step (that is Spec A).
- Changing the integrity-hash / activation server logic (reuse the existing
  `updateBaseline` status path; activation stamps the hash as today).
- Server-side Postman storage (pure frontend only).
- Atomic all-or-nothing batch (explicitly best-effort per-item with results).
- Removing the existing per-row Activate on the baselines list.

## Grounding (verified file references)

- Frontend: `SaveAsBaselineModal.tsx` (createBaselineItem loop ~198–258; navigate
  ~284–287), `CaptureReviewPanel.tsx` (handleAcceptAll/handleRejectAll ~542–598;
  Save CTA ~774–783), `BaselineDetailView.tsx` (inline dump ~536–596; `formatJson`
  ~91–98; `tabsNav` toggle ~652–685), `BaselinesList.tsx` (status badge ~42–53;
  nextStatusAction ~70–82; handleStatusAction→updateBaseline ~121–143),
  `apiBehaviourClient.ts` (`createBaselineItem`, `updateCapture`, `updateBaseline`
  status state-machine, `listBaselineItems`, `getCaptureSession`),
  `utils/fileOperations.ts` (`triggerDownload` ~558, `sanitizeFilename` ~540),
  `ApiBehaviourBaselineItemDto` (request_json {query,headers,body}, response_json
  {headers,body}, method/path/responseStatus/scenarioName/sequenceJson).
- AMS: `ApiBehaviourBaselineItemController`/`Service` (single POST ~62–67;
  validation/build ~50–100; NO bulk), `ApiBehaviourCaptureController`/`Service`
  (single PATCH ~79–85; update ~122–185; NO bulk), `DiscoveryFindingController.bulkCreate`/
  `DiscoveryFindingService.bulkCreate` (structural precedent), `BaselineContentHashUtil`
  (activate-time stamping).
- Gateway: `apiMigrationValidation.ts` (`registerCrudProxy` ~245–264,
  `proxyToAms`/`buildAmsUrl` ~104–232), `server.ts` (rate limit :31, express.json
  30mb :27), `config.ts` (rateLimitRpm=300; chat-only maxMessageBytes).

## Load-bearing test surfaces

- Both batch endpoints process best-effort and return per-item `failed[]` — one
  bad item does NOT abort the rest, and successes persist.
- Per-call cap 500 enforced (clear error above).
- Frontend collapses the accept/reject/save loops into single batch calls and
  renders `failed[]` as warnings.
- "Accept and Save All" proceeds to save the accepted captures on a partial
  accept failure, with one combined warning.
- Make Active uses the existing `updateBaseline` status path (stamps hash on
  draft→active) and is gated to draft; post-save navigation lands on the list
  with the row shown as draft.
- Detail view defaults to the table; the Full-detail toggle reveals the JSON dump.
- Postman export produces a valid v2.1 collection: all items, one response
  example each, flattened sequence steps, `{{baseUrl}}` variable.
- Gateway batch routes proxy correctly and are registered BEFORE the generic
  `/:id` routes.
