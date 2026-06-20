# Verification Report: Baseline Save & Review — Batch Persistence + Manual Activate + Table Detail + Postman Export

**Spec:** `2026-06-20-baseline-save-review-batch-activate-export`
**Date:** 2026-06-20
**Verifier:** implementation-verifier
**Status:** ✅ Passed

---

## Executive Summary

The save → review → activate tail is fully implemented across all four stacks (AMS Java, gateway TS, frontend TS) and every cross-cutting invariant holds against the actual code. All feature tests are green (AMS 7, gateway 3, frontend 67 = 77 total), both typechecks are clean of new feature errors, and the mojibake sweep on every edited file is zero. One tasks.md checkbox (7.3) was stale-marked incomplete despite the work being present and tested — corrected to `- [x]` during verification. Two cosmetic, non-blocking doc-comment stalenesses were noted (no behavioural impact).

---

## 1. Tasks Verification

**Status:** ✅ All Complete (one checkbox corrected during verification)

### Completed Task Groups
- [x] TG1: AMS batch endpoints (best-effort, non-atomic) — `createBatch`, `updateBatch`, `buildEntity` extraction, batch DTOs, cap 500, controller `/batch` mappings before `/{id}`.
- [x] TG2: Gateway batch route proxies — both routes registered before `registerCrudProxy`, proxy JSON via `proxyToAms`.
- [x] TG3: Batch client functions + types — `createBaselineItemsBatch`, `updateCapturesBatch` with typed `{...,failed}` shapes.
- [x] TG4: `CaptureReviewPanel` batch + Accept-and-Save-All — single batch per action, per-row notes preserved, proceed-on-partial.
- [x] TG5: `SaveAsBaselineModal` batch + navigate to list — single batch save, navigates to LIST, no auto-activate.
- [x] TG6: `BaselineDetailView` table default + Full-detail toggle + Make Active + Export.
- [x] TG7: Postman Collection v2.1 export util (pure frontend).
- [x] TG8: Test review & gap analysis.

### Correction Applied
- **Task 7.3** ("Wire the download in `BaselineDetailView` via `triggerDownload` + `sanitizeFilename`, with `{{baseUrl}}` fail-soft prefilled from `getCaptureSession(...).api_base_url`") was marked `- [ ]` in tasks.md. Spot-check confirmed it IS implemented: `BaselineDetailView.tsx` `handleExportPostman` (lines 378-414) calls `getCaptureSession` fail-soft, builds the collection via `baselineToPostmanCollection`, and downloads via `triggerDownload(JSON.stringify(...), \`${sanitizeFilename(...)}.postman_collection.json\`)`. The `BaselineDetailView.toolbar.test.tsx` export-triggers-download test passes. Checkbox corrected to `- [x]`.

### Incomplete or Issues
None. All task groups are complete.

---

## 2. Documentation Verification

**Status:** ⚠️ Implementation reports absent (verified directly from code instead)

### Implementation Documentation
- The `implementation/` folder is empty — no per-task-group implementation reports were produced for this spec.
- Verification was therefore performed by direct code spot-check + test re-run rather than by reading implementation reports. All acceptance criteria and invariants were confirmable against the actual source.

### Missing Documentation
- `implementation/` reports (1 through 7/8) — absent. Non-blocking for the feature itself (code + tests are complete and green), but noted.

---

## 3. Roadmap Updates

**Status:** ✅ No Updates Needed

### Notes
`agent-os/product/roadmap.md` covers Phases 1–5 (meta-model CRUD, diagram rendering/editing, UX polish, backend/deployment). No roadmap item matches this spec's API Behaviour Baseline save/review/activate/export scope (keyword scan for baseline / batch / postman / activate / export / save-review returned nothing). This spec is sub-feature work tracked under `agent-os/specs/`, not the high-level product roadmap. No change made.

---

## 4. Cross-Cutting Invariant Checks

**Status:** ✅ All 8 invariants hold

| # | Invariant | Result | Evidence |
|---|-----------|--------|----------|
| a | Both AMS batch endpoints best-effort/NON-atomic (bad item → `failed[]`, rest persist, no rollback); cap 500 → 400; hash NOT computed at item-create | ✅ | `ApiBehaviourBaselineItemService.createBatch` (per-item `try/catch RuntimeException`, `failed.add`, loop continues; `MAX_BATCH_ITEMS=500` throws `IllegalArgumentException`; no hash call). `ApiBehaviourCaptureService.updateBatch` identical posture. No `BaselineContentHashUtil` reference in either batch path. |
| b | `buildEntity` extracted from `create`; `create` behaves identically | ✅ | `ApiBehaviourBaselineItemService` lines 58-64: `create` now calls `buildEntity(request)` then `saveAndFlush`. `buildEntity` (122-174) holds the original validation + builder verbatim; `createBatch` reuses the same `buildEntity`. |
| c | Gateway batch routes registered BEFORE generic `/:id`; proxy JSON | ✅ | `apiMigrationValidation.ts` lines 294-302 register `POST .../baseline-items/batch` and `PATCH .../captures/batch` BEFORE the `for (resource) registerCrudProxy` loop (304-306). Both call `proxyToAms(..., 'batch')` → forward URL `/api/projects/{p}/api-behaviour/<resource>/batch`. Gateway test asserts `/batch` is not captured as `:id`. |
| d | Frontend Accept All / Reject All / Save collapse to a SINGLE batch each; render `failed[]`; Reject All preserves each row's reviewer_notes masks | ✅ | `CaptureReviewPanel.handleAcceptAll` / `handleRejectAll` / `handleAcceptAndSaveAll` each make exactly one `updateCapturesBatch` call; no per-item network loop remains (remaining singular `updateCapture` calls are single-row handlers only). Reject All builds per-row patches with `reviewer_notes` from `parseReviewerNotes(capture.reviewer_notes)` (masks preserved). `failed[]` → `describeCaptureBatchFailures` warning. `SaveAsBaselineModal` uses one `createBaselineItemsBatch`. Integration test confirms exactly ONE fetch to the batch URL. |
| e | Make Active is MANUAL (no auto-activate; save navigates to LIST, leaves draft); uses existing `updateBaseline(status:'active')`; gated to draft | ✅ | `SaveAsBaselineModal` navigates to `/projects/:p/architectures/:a/api-behaviour` (list), no `updateBaseline`/`status:'active'` call on save. `BaselineDetailView.handleMakeActive` gated `baseline.status !== 'draft'` early-return, calls `updateBaseline(...{status:'active'})`; button renders only when `status === 'draft'`. |
| f | BaselineDetailView defaults to TABLE; Full-detail toggle reveals JSON dump | ✅ | `viewMode` state defaults to `'table'`; Method/Path/Scenario/Status table renders when `viewMode === 'table'`; the per-item `<pre>`/`formatJson` dump (incl. `BaselineSequenceView`) renders when `viewMode === 'full'`. Toolbar test confirms default table + toggle. |
| g | Postman export pure frontend, v2.1, every item + response example + flattened sequences + `{{baseUrl}}` | ✅ | `postmanExport.ts` is a pure function (no fetch/DOM). `info.schema = v2.1.0`; `flatMap(itemToPostmanItems)` over every item; single-shot items carry method/path/query/headers/body + one response example (`code = status`, name `"<scenario> (<status>)"`); sequence items flatten `steps[]` to ordered requests `"<scenario> — <role> #<index>"` with `response_refs` as DESCRIPTION NOTES (no `pm.*`); `{{baseUrl}}` collection variable + `host: ['{{baseUrl}}']`. |
| h | Existing per-row Activate on `BaselinesList` still present | ✅ | `BaselinesList.tsx` `nextStatusAction` returns `{label:'Activate', to:'active'}` for draft; `handleStatusAction` → `updateBaseline(...{status:to})`; wired to a per-row button (`baseline-status-action-*`). Not removed. |

---

## 5. Per-Group Acceptance Check (spot-checked against actual code)

- **TG1 acceptance** — both batch endpoints persist/patch best-effort, return per-item `failed[]`, enforce cap 500, never touch the hash; new tests pass; files intact. ✅
- **TG2 acceptance** — both batch routes proxy correctly, ordered before `/:id`; tests pass. ✅
- **TG3 acceptance** — both batch clients call the right URLs (`.../baseline-items/batch`, `.../captures/batch`) + return typed `{...,failed}`. ✅
- **TG4 acceptance** — accept/reject/accept-and-save use single batch calls with warnings; no per-item loops remain; proceed-on-partial works. ✅
- **TG5 acceptance** — one batch save call; navigates to the list; row stays draft; warnings on failures. ✅
- **TG6 acceptance** — table by default; toggle reveals JSON; Make Active gated to draft; Export available on any saved baseline. ✅
- **TG7 acceptance** — valid v2.1 collection, all items + response examples + flattened sequences + `{{baseUrl}}`; pure frontend; downloads via the existing helper. ✅
- **TG8 acceptance** — feature tests run across the touched stacks; final mojibake sweep clean. ✅

---

## 6. Test Suite Results (re-run independently)

**Status:** ✅ All Passing

### AMS (Java / Maven)
Command: `mvn -o -f architecture-model-service/pom.xml -Dtest=ApiBehaviourBaselineItemBatchServiceTest,ApiBehaviourCaptureBatchServiceTest test`
- `ApiBehaviourBaselineItemBatchServiceTest`: 3 passed
- `ApiBehaviourCaptureBatchServiceTest`: 4 passed
- **Total: 7 run, 0 failures, 0 errors. BUILD SUCCESS.**

### Gateway (TS / Jest)
Command: `npx jest src/__tests__/apiMigrationValidation-batch-proxy.test.ts`
- POST `.../baseline-items/batch` forwards items verbatim, pipes `{created,failed}` — passed
- PATCH `.../captures/batch` forwards (not captured as `:id`), pipes `{updated,failed}` — passed
- batch proxy 404s when `:architectureId` missing — passed
- **Total: 3 passed, 3 total.**

### Frontend (TS / Vitest)
Command: `npx vitest run` over the 11 feature files.
- `src/utils/postmanExport.test.ts` — 7
- `src/api/__tests__/apiBehaviourClient.test.ts` — 14
- `CaptureReviewPanel.bulk.test.tsx` — 8
- `CaptureReviewPanel.batchWire.integration.test.tsx` — 2
- `CaptureReviewPanel.test.tsx` — 8
- `SaveAsBaselineModal.cacheInvalidation.test.tsx` — 5
- `SaveAsBaselineModal.headerCarry.test.tsx` — 2
- `SaveAsBaselineModal.sequenceCarry.test.tsx` — 3
- `BaselineDetailView.toolbar.test.tsx` — 7
- `BaselineDetailView.sequence.test.tsx` — 2
- `BaselineDetailView.integrity.test.tsx` — 9
- **Total: 11 files, 67 passed, 0 failed.** (React Router v7 future-flag warnings are pre-existing framework deprecation notices, not failures.)

### Grand Total
- **77 feature tests passing (7 AMS + 3 gateway + 67 frontend), 0 failures, 0 errors.**

---

## 7. Typecheck Results

**Status:** ✅ No new feature errors

- **Gateway** `npx tsc --noEmit`: clean (exit 0, zero errors).
- **Frontend** `npx tsc --noEmit`: exit 0; pre-existing unrelated errors only — all in `src/utils/*` and other unrelated modules (`erdUtils`, `excelOperations`, `fileOperations`, `rendering`, `sequenceLayout`, `workspaceSchemaVersion`, `implementStateSerializer`, etc.), exactly the class the spec flagged as pre-existing. A targeted grep for the feature files (`postmanExport`, `apiBehaviourClient`, `CaptureReviewPanel`, `SaveAsBaselineModal`, `BaselineDetailView`, `BaselinesList`) returned ZERO errors.

---

## 8. Mojibake Sweep

**Status:** ✅ Zero

Searched the `â€"` mojibake marker (and the `â€` byte prefix) across every edited existing source file plus the new DTOs/util:
- AMS `controller/apibehaviour/*`, `service/apibehaviour/*`, `model/dto/apibehaviour/*`
- `gateway/src/routes/apiMigrationValidation.ts`
- `frontend/src/api/apiBehaviourClient.ts`
- `frontend/src/components/DashboardView/{SaveAsBaselineModal,CaptureReviewPanel,BaselineDetailView,BaselinesList}.tsx`
- `frontend/src/utils/postmanExport.ts`

**Result: zero matches (clean).** Note `postmanExport.ts` deliberately builds its em-dash via `String.fromCharCode(0x2014)` so the source stays pure ASCII and cannot corrupt on disk.

---

## 9. Issues & Defects

| Severity | Issue | Detail | Action |
|----------|-------|--------|--------|
| Info (fixed) | tasks.md 7.3 stale-unchecked | Task 7.3 was `- [ ]` but the export download wiring is present in `BaselineDetailView.tsx` (378-414) and covered by a passing toolbar test. | Corrected to `- [x]` during verification. |
| Low (cosmetic) | Stale doc comment in `SaveAsBaselineModal.tsx` | Lines 39-42 still describe "The bulk-create is sequential rather than `Promise.all`…" — describing the removed per-item loop. The code is now a single `createBaselineItemsBatch` call. No behavioural impact; comment-only. | Documented; not modified (no feature-code change mandate). |
| Low (cosmetic) | Stale doc comment in `SaveAsBaselineModal.tsx` | Line 310-317 comment references landing "on the baseline detail view" while the code (and lines 334-338) correctly navigate to the LIST. Mixed/contradictory comment; the executed `navigate` target is correct (list). | Documented; not modified. |
| Info | No implementation reports | `implementation/` folder is empty; no per-TG implementation `.md` reports exist. Verification done directly from code + tests. | Documented. |

No functional defects found. All issues are documentation-only or already corrected.

---

## Overall Verdict

**✅ PASS.** The feature is correctly and completely implemented end-to-end. All 8 cross-cutting invariants hold against the actual code, all per-group acceptance criteria are met, all 77 feature tests are green, both typechecks are free of new feature errors, and the mojibake sweep is clean. The only corrections were a stale tasks.md checkbox (now fixed) and two cosmetic stale doc comments (documented, no code change needed).
