# Verification Report: Import a Postman Collection into Capture

**Spec:** `2026-06-23-import-postman-collection-into-capture`
**Date:** 2026-06-23
**Verifier:** implementation-verifier
**Status:** ✅ Passed

---

## Executive Summary

The Postman Collection v2.1 import feature is fully implemented end-to-end across
all three services (frontend, AMVS, AMS). All 9 task groups are complete, all
nine requirements (R1–R8 + the scope boundaries) are satisfied with file:line
evidence, and the feature-scoped test suites pass in full: 48 frontend (vitest),
18 AMVS (jest), and 3 AMS (JUnit/MockMvc) = **69 feature tests, 0 failures**.
The large existing files were only additively (anchored) edited with all
pre-existing symbols retained, and no mojibake was introduced. The only caveat
is a pre-existing, whole-repo `tsc --noEmit` type-debt baseline (538 errors,
none in this feature's production source) — the feature's own files typecheck
clean and run green under their proper vitest/jest type environments.

---

## 1. Tasks Verification

**Status:** ✅ All Complete

All 9 task groups (and every sub-task) in `tasks.md` were already marked `- [x]`.
Each was spot-checked against real code and found genuinely implemented (see the
per-requirement evidence in Section 5). No checkbox required correction.

### Completed Tasks
- [x] Task Group 1: Postman v2.1 IMPORT parser (R1) — `frontend/src/utils/postmanImport.ts`
- [x] Task Group 2: Frontend client wiring (R2, R8) — `addOperation` + reused clients in `apiBehaviourClient.ts`
- [x] Task Group 3: Import staging + reconciled review component (R3, D6) — `PostmanImportStaging.tsx`
- [x] Task Group 4: Architecture-match warning + discovery-candidate staging (R5, D5, A2, A4, A5) — `PostmanImportArchMatchStep.tsx`
- [x] Task Group 5: AMS discovery-candidate staging support (R5, A4) — `PostmanImportCandidateStagingService.java` + `DiscoveryOrphanController.java`
- [x] Task Group 6: AMVS import→operations mapping, add-operation, Postman-only run (R2, R4c, R7, R8) — `addOperationSupport.ts` + `captureSessionActions.ts`
- [x] Task Group 7: Mode 1(b) two-stage per-op bounded subtraction (R6, D3, A5) — `postmanDelta*.ts` + orchestrator seam
- [x] Task Group 8: Mode 1 wizard selector + Mode 2 detail-view append (R4, R7, A1, A3, A6) — wizard + detail-view edits + `usePostmanImportRun.ts`
- [x] Task Group 9: End-to-end wiring + gap analysis + verification (R1–R8) — e2e tests + manual wiring pass

### Incomplete or Issues
None — all tasks complete and substantiated in code.

---

## 2. Documentation Verification

**Status:** ⚠️ Issues Found (non-blocking)

### Implementation Documentation
- The `implementation/` directory exists but is **EMPTY** — no per-task-group
  implementation reports were written. This is a documentation gap only; it does
  not affect the correctness of the shipped code.

### Planning / Spike Documentation
- [x] `spec.md` — full spec present
- [x] `planning/requirements.md` — DECIDED D1–D6 + answers A1–A7 present
- [x] `planning/group5-notes.md` — Group 5 spike findings + chosen approach (synthetic-run candidate staging) present and matches the shipped `PostmanImportCandidateStagingService`

### Verification Documentation
- [x] This report (`verifications/final-verification.md`)

### Missing Documentation
- `implementation/*.md` per-group implementation reports (empty folder). Noted as
  a process gap; code evidence was gathered directly instead.

---

## 3. Roadmap Updates

**Status:** ⚠️ No Updates Needed

### Updated Roadmap Items
None.

### Notes
`agent-os/product/roadmap.md` (101 lines) was scanned for any item matching this
spec (`postman`, `import`, `collection`, `capture`, `baseline`, `behaviour`,
`api migration`). The only `capture`-adjacent entry is item 25 "Auto-Save to
State" (an unrelated diagram feature, already `[x]`). There is no roadmap line
item describing Postman-collection import into capture, so no checkbox update is
applicable.

---

## 4. Test Suite Results

**Status:** ✅ All Passing (feature-scoped, per the spec's explicit instruction)

Per Task Group 9.5 and the verification brief, tests were run feature-scoped per
service (not the whole-app suites).

### Test Summary
- **Total feature tests:** 69
- **Passing:** 69
- **Failing:** 0
- **Errors:** 0

| Service | Command | Files | Tests | Result |
|---|---|---|---|---|
| frontend (vitest) | `vitest run` on the 7 feature test files | 7 | 48 | ✅ all pass |
| AMVS (jest) | `jest` on the 4 feature test files | 4 | 18 | ✅ all pass |
| AMS (JUnit/MockMvc) | `mvn -o test -Dtest=PostmanImportCandidateStagingControllerTest` | 1 | 3 | ✅ all pass (BUILD SUCCESS) |

**Frontend feature test files (48 tests):**
- `frontend/src/utils/postmanImport.test.ts` (6)
- `frontend/src/api/discoveryApi.stageImportedCandidate.test.ts` (2)
- `frontend/src/api/__tests__/apiBehaviourClient.test.ts` (16)
- `frontend/src/components/ApiBehaviour/PostmanImportStaging.test.tsx` (6)
- `frontend/src/components/ApiBehaviour/PostmanImportArchMatchStep.test.tsx` (5)
- `frontend/src/components/ApiBehaviour/postmanImportRun.test.tsx` (11)
- `frontend/src/components/ApiBehaviour/PostmanImportAppendModal.e2e.test.tsx` (2)

**AMVS feature test files (18 tests):**
- `src/__tests__/captureSessionActions.addOperation.test.ts` (6: add-operation no/with endpointId, idempotency, validation, Postman-only `/start` with + without override)
- `src/__tests__/captureSessionActions.postmanModeOneB.test.ts`
- `src/__tests__/captureSessionOrchestrator.postmanDelta.test.ts` (2: Mode 1b subtract-before-generate, Mode 1c skip)
- `src/__tests__/postmanDelta.test.ts` (8: Stage-1, Stage-2, cap-including-captured, budget floor)

### Build / Typecheck Results
- **AMVS** `tsc --noEmit`: ✅ clean (exit 0).
- **AMS**: ✅ compiles (the MockMvc test run is a full `mvn test` compile + run; BUILD SUCCESS).
- **frontend** `tsc --noEmit`: ⚠️ 538 errors PROJECT-WIDE — all pre-existing
  whole-repo type debt in unrelated files (`fileOperations.ts`, `rendering.ts`,
  `workspaceSchemaVersion.ts`, `implementStateSerializer.ts`, etc.). This
  feature's **production** source files produce **zero** type errors. The only
  feature-file `tsc` diagnostics are `Cannot find name 'global'` /
  `'React' is declared but its value is never read` in the colocated `.test`
  files — and the identical `global` pattern appears in many pre-existing,
  non-feature test files (e.g. `architecturesApi.architectureMappings.test.ts`),
  confirming it is an app-tsconfig scoping artifact for colocated tests (which
  run under vitest's own type env, and pass), NOT a defect this spec introduced.

### Failed Tests
None — all feature-scoped tests pass.

### Notes
- The known jsdom limitation in `PostmanImportAppendModal.e2e.test.tsx:143-147`
  is benign: it attaches a working `File.text()` (jsdom does not implement
  `Blob.text()` against constructor parts). It stubs ONLY the browser file-read;
  the real feature chain (parse → stage → arch-match → send → 409 re-enter-secrets
  → retry capture) runs unmocked. Confirmed.

---

## 5. Per-Requirement Verification (file:line evidence)

**R1 — Postman v2.1 import parser** ✅ PASS
- New module `frontend/src/utils/postmanImport.ts`; imports the v2.1 type surface
  from `postmanExport.ts` (`postmanImport.ts:39-47`); pure `parsePostmanCollection`
  (`:456-462`).
- JSON-only: `resolveBody` flags non-`raw` / non-JSON bodies with
  `NON_JSON_BODY_REASON` and a `null` body (`:268-317`) — never silently sent.
- Flatten folders + `sequence` steps in order: `flattenItems` recursion +
  `resolveSteps`/`flattenSteps` index-sort (`:355-438`).
- Ignore embedded auth: no `auth` is read; only `header`/`url`/`body`/`method`
  are mapped (`resolveItem` `:324-344`); test asserts secrets never leak
  (`postmanImport.test.ts:183-206`).
- Fail-soft, never throws: defensive `asRecord`/`asString`/`asArray` narrowing
  (`:100-124`); test `:100-129` asserts `.not.toThrow()` on malformed input.
- Strip `{{baseUrl}}`/host, keep path+query: `resolveUrl`/`resolveUrlString`
  (`:143-240`); `ImportedRequest` carries `{ method, path, query, headers, body,
  sourceItemName, unsupportedReason? }` (`:86-94`).

**R2 / D2 — shared execute→persist primitive reused** ✅ PASS
- The send loop uses the existing `manualCapture(...)` client verbatim — no
  forked send/redact/persist logic: `usePostmanImportRun.ts:207-213` calls
  `manualCapture(...)`. Both Mode 1 (wizard) and Mode 2 (modal) drive this same
  hook (`StartCaptureSessionWizard.tsx:331-339`, `PostmanImportAppendModal.tsx`).
- Body stays camelCase (`ManualCaptureRequest` at `apiBehaviourClient.ts:353`,
  `operationId` `:354`).

**R4 / D3 — 3-way run-mode selector in the wizard** ✅ PASS
- Selector + upload added to the wizard Step-4 sub-section:
  `StartCaptureSessionWizard.tsx:318-340` (`postmanRunMode` state),
  `:1826-1844` (`<PostmanImportWizardStep>`).
- (a) LLM-only unchanged: default `postmanRunMode = 'llm'` (`:322`); the Postman
  send block is gated on `modeUsesPostman(...)` (`:1062-1063`).
- (b) fires imported items then per-op delta tops up: `:1064-1090` runs
  `postmanRun.runSends()` post-`/start`, then forwards `postmanCapturedByOp`
  (`:1110-1113`); orchestrator subtracts before generating
  (`captureSessionOrchestrator.ts:1351-1377`).
- (c) Postman-only skips planner+LLM and carries override: `startBody.postmanOnly`
  (`:1104`) and the auto-justification (`:1118-1121`); AMVS `/start` forwards
  `postmanOnly` to the orchestrator deps (`captureSessionActions.ts:2290`); the
  orchestrator `continue`s the per-op loop when `postmanOnly` (`:1345`).

**R6 / A5 — Mode 1(b) two-stage PER-OP bounded subtraction, cap INCLUDING captures** ✅ PASS
- Stage-1 code pre-filter (archetype/method/path/which-param/expectedStatus):
  `postmanDeltaStage1.ts:103-151`.
- Stage-2 LLM judge over remaining candidates: `postmanDelta.ts:64-72` calls
  `stage2JudgeRedundant`.
- Cap INCLUDING already-captured Postman scenarios:
  `postmanDelta.ts:76` (`budget = max(0, maxScenariosPerOp - captured.length)`).
- Per-operation, wired at the loop seam:
  `captureSessionOrchestrator.ts:1356-1377` (`computePostmanDelta` per `op`,
  `MAX_SCENARIOS_PER_OP` from `:926`).
- Tests assert all of the above (`postmanDelta.test.ts` 8 tests incl. cap +
  budget-floor; `captureSessionOrchestrator.postmanDelta.test.ts` subtract-before-generate).

**R7 / A1 / A2 / A3 — Mode 2 append replays LIVE; add-operation; re-enter-secrets** ✅ PASS
- Launched from the capture-session detail view; replays LIVE via `manualCapture`:
  `CaptureSessionDetailView.tsx:1008-1041` (append row + modal), the modal uses
  the same `usePostmanImportRun` live-send hook.
- New endpoints get an add-operation row (`included=true`) BEFORE sending:
  AMVS route `captureSessionActions.ts:1543-1675` (`POST .../add-operation`,
  `included: true` in both branches; idempotent; appends to `oasInventoryStore`);
  arch-match "Keep & run" calls it first (`PostmanImportArchMatchStep.tsx:143-149`).
- Finished-session 409 `SECRETS_NOT_LOADED` → re-enter-secrets:
  `usePostmanImportRun.ts:231-242` (`isSecretsNotLoadedError`, pause);
  `PostmanImportAppendModal.tsx:189-193, 301-321` (`onRequestReenterSecrets`).
- A1: replay-live only — no saved-response/persist-without-send path exists
  (grep confirmed absent).

**R5 / D5 / A4 — unmatched items → arch-match; "Add to architecture" STAGES candidate; "Delete" drops** ✅ PASS
- Unmatched/unmapped routed to the warning step from
  `operations_without_model_endpoint` (read verbatim:
  `postmanImportStagingSupport.ts:113`); `PostmanImportArchMatchStep.tsx` renders
  the warning; a still-`pending` flagged item blocks the run
  (`postmanImportArchMatchSupport.ts:57-65`, wizard gate `:1057-1063`).
- "Add to architecture" stages an UN-APPROVED discovery candidate (not a direct
  write): `PostmanImportArchMatchStep.tsx:121-135` → `onStageDiscoveryCandidate`
  bound to `stageImportedDiscoveryCandidate` (`PostmanImportWizardStep.tsx:132`,
  `PostmanImportAppendModal.tsx:172`); AMS service stages
  `review_status='pending_review'`, `status='proposed'`
  (`PostmanImportCandidateStagingService.java:118-128`).
- "Delete the item" drops it: `PostmanImportArchMatchStep.tsx:164-168` →
  `onDeleteItem`; hook drops the index (`usePostmanImportRun.ts:166-172`).

**R7 cross-service wiring resolves** ✅ PASS
- Stage-imported-candidate: frontend POST
  `/api/v1/discovery/projects/:p/architectures/:a/stage-imported-candidate`
  (`discoveryApi.ts` `stageImportedDiscoveryCandidate`) → gateway proxy
  (`gateway/src/routes/discovery.ts:1457`, mounted at `/api/v1/discovery` in
  `server.ts:98`) → AMS `POST .../discovery/stage-imported-candidate`
  (`DiscoveryOrphanController.java:101-114`, `@RequestMapping` `:34`). URLs match.
- Add-operation: frontend `actionUrl(..., 'add-operation')`
  (`apiBehaviourClient.ts:981-985`) → gateway allowlist now includes
  `'add-operation'` (`gateway/src/routes/apiMigrationValidation.ts:535`) → AMVS
  route `captureSessionActions.ts:1543`. URLs match.

**R8 — wire format** ✅ PASS
- AMS create shapes snake_case: `buildSynthesisedCreateBody`
  (`addOperationSupport.ts:144-183`, all `session_id`/`operation_id`/
  `request_schema_json`/etc.); `StageImportedCandidateRequest` snake_case
  (`@JsonProperty("source_item_name")` `:40`, no `@CamelCaseWire`).
- `manualCapture` body camelCase: `ManualCaptureRequest` (`apiBehaviourClient.ts:353`,
  `operationId` `:354`); `AddOperationRequest` camelCase in, mapped server-side.

**Out-of-scope NOT built** ✅ PASS
- import-saved-responses / persist-without-send: ABSENT (grep clean).
- non-JSON content types: FLAGGED not sent (`postmanImport.ts:268-317`).
- multiple collections per run: parser is single-document
  (`parsePostmanCollection(collection)`); UI uploads one file.
- direct committed-architecture writes: ABSENT — only candidate staging
  (no `createEndpoint`/`saveEndpoint` in the arch-match path).
- `pm.*` scripts / inter-step `response_refs`: ABSENT (only a comment noting they
  are deliberately NOT generated, `postmanImport.ts:30`).

---

## 6. Clobber / Regression Check

**Status:** ✅ Pass — additive-only, all pre-existing symbols retained, no mojibake.

`git diff --stat HEAD` shows insertions-dominated changes with no symbol loss:

| File | Change shape | Pre-existing symbols retained |
|---|---|---|
| `captureSessionActions.ts` | +197 (new `add-operation` route + 2 body fields + 2 orchestrator deps) | manual-capture, account-endpoints, reconcile-inventory, parse-oas, synthesiseOperationFromEndpoint, coverageOverrideJustification, buildCaptureSessionActionsRouter ✅ |
| `captureSessionOrchestrator.ts` | +68 (delta imports + 3 deps + per-op seam) | defaultScenarioSet, MAX_SCENARIOS_PER_OP, orchestrateCaptureSession, persistedOperations ✅ |
| `StartCaptureSessionWizard.tsx` | +111 (state + send orchestration + step render) | WizardStep, handleStart, submitSecrets, startCaptureSession ✅ |
| `CaptureSessionDetailView.tsx` | +40 (append row + modal) | CaptureReviewPanel, showReviewPanel, setSecretsPromptOpen, fetchOnce ✅ |
| `apiBehaviourClient.ts` | +96 (`addOperation` client + 2 start-body fields) | manualCapture, reconcileInventory, accountEndpoints, isSecretsNotLoadedError, startCaptureSession ✅ |
| `discoveryApi.ts` | +69 (`stageImportedDiscoveryCandidate`) | getDiscoveryCandidates, GATEWAY_BASE ✅ |
| `DiscoveryOrphanController.java` | +48 (`stage-imported-candidate` mapping) | findOrphans, cleanup, DiscoveryRunService, @RequestMapping ✅ |
| `gateway/routes/discovery.ts` | +91 (proxy) / `apiMigrationValidation.ts` | +5 (allowlist) | existing routers intact ✅ |

Mojibake / encoding: a byte-level UTF-8 scan of all new + changed feature files
found **0** invalid-UTF-8 files and **0** U+FFFD replacement chars. The only
non-ASCII code points are intentional typography — em-dash `U+2014`, ellipsis
`U+2026`, right single quote `U+2019` — in UI strings/comments, all valid UTF-8.

---

## 7. Defects / Gaps Found

1. **(Process, non-blocking)** `implementation/` folder is empty — no per-task
   implementation reports were authored. Code is correct regardless; flagged for
   process hygiene only.
2. **(Pre-existing, not introduced)** Whole-repo `frontend` `tsc --noEmit` has
   538 type errors across unrelated files. None are in this feature's production
   source. The feature's colocated `.test` files show the same `global`/unused-
   `React` diagnostics already present across the existing test corpus (a
   tsconfig scoping artifact; those tests run/pass under vitest). No action
   required for this spec; the broader type-debt cleanup is out of scope.

No functional defects were found in the feature implementation.

---

## Overall Verdict

✅ **PASSED.** The Import-a-Postman-Collection-into-Capture feature is correctly
and completely implemented across frontend, AMVS, and AMS. Every requirement
(R1–R8) and decision (D1–D6 / A1–A7) is satisfied with concrete file:line
evidence; all out-of-scope boundaries hold; the cross-service URL chains resolve;
the wire-format split (snake_case AMS create shapes vs camelCase `manualCapture`)
is correct; the large existing files were edited additively with all pre-existing
symbols intact and no mojibake; and all 69 feature-scoped tests pass with zero
failures. The only notes are a missing set of implementation reports and a
pre-existing whole-repo TypeScript type-debt baseline — neither affects the
correctness of the shipped feature.
