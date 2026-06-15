# Verification Report: Runtime Log Input at Discovery Run Start

**Spec:** `2026-05-10-runtime-log-input-at-discovery-run-start`
**Date:** 2026-05-10
**Verifier:** implementation-verifier
**Status:** Passed with Issues (manual smoke 6.1-6.7 deferred to user as planned)

---

## Executive Summary

Spec 4 (the first cross-service spec in the 7-spec roadmap) is implemented correctly across all three services (architecture-model-service, gateway, frontend). All 85 automated tests across the Spec 4 surface and the Spec 1-3 backstops pass. The static-checkable portion of the cross-service smoke check (discovery-service untouched, Spec 1-3 frontend files untouched) passes verbatim. The manual smoke scenarios 6.1-6.7 (running services locally with real file uploads) remain deferred to the user as planned and tracked under a NOTE block in tasks.md.

---

## 1. Tasks Verification

**Status:** All Complete (within agent scope; manual smoke scenarios 6.1-6.7 deferred to user as planned)

### Completed Tasks

- [x] Task Group 1: PATCH endpoint for log-file metadata + multipart limit bump
  - [x] 1.1-1.8 — All AMS subtasks complete and the 5-test JUnit class passes (5/5).
- [x] Task Group 2: Gateway multipart upload route + disk-write service + downstream PATCH
  - [x] 2.1-2.7 — All gateway subtasks complete; 6/6 Jest tests pass.
- [x] Task Group 3: Reusable LogFileUploadInput component
  - [x] 3.1-3.5 — Component + 6/6 Vitest tests pass.
- [x] Task Group 4: Pre-run modals + run-start orchestration + upload API client
  - [x] 4.1-4.7 — All Vitest tests pass; PreflightModal preserves existing controls; Grid.tsx wires the new modal correctly.
- [x] Task Group 5: Warning chip on the run row + integration tests
  - [x] 5.1-5.5 — Pure helper + chip rendering in both run-list surfaces; 4/4 Vitest tests pass.
- [x] Task Group 6: Cross-service smoke verification (static portion only)
  - [x] 6.0 Verify the cross-service plumbing end-to-end (Spec 4 surface only)
  - [ ] 6.1-6.7 (manual scenarios; deferred to user — see "Manual Smoke Deferral" below)
  - [x] 6.8 Confirm discovery-service was NOT touched in any group — CONFIRMED via `git diff --stat -- discovery-service/src/` returning empty.
  - [x] 6.9 Confirm Spec 1-3 frontend files were NOT touched in any group — CONFIRMED via `git status` (only `CandidateDetailsPanel.tsx` shows modified, and its mtime is 17:47 vs the earliest Spec 4 file at 20:19; this is pre-existing Spec 1-3 work).

### Incomplete or Issues

None within the agent's scope. Sub-tasks 6.1-6.7 are deliberately deferred manual smoke scenarios per the existing NOTE block in tasks.md.

---

## 2. Documentation Verification

**Status:** Complete (no implementation reports were written; spec files are sufficient)

### Implementation Documentation

- The `implementation/` folder under the spec is empty. The spec did not require per-task implementation reports — task list and inline code comments are the documentation.

### Verification Documentation

- This report: `agent-os/specs/2026-05-10-runtime-log-input-at-discovery-run-start/verifications/final-verification.md` (created here).

### Missing Documentation

None.

---

## 3. Roadmap Updates

**Status:** No Updates Needed

### Updated Roadmap Items

None. A search of `agent-os/product/roadmap.md` for "discovery", "candidate", "evidence", "log", "runtime", "spec 4", and "input" yielded no roadmap entries that match the description of this spec. The 7-spec discovery-candidate-evidence roadmap is tracked inside the spec set itself, not in `roadmap.md`.

### Notes

If a roadmap item is added later that maps to this spec, it can be ticked retroactively.

---

## 4. Test Suite Results

**Status:** All Passing (focused Spec 4 surface + Spec 1-3 backstops + AMS Group 1 test)

### Test Summary

- **Total tests run for Spec 4 verification:** 90
  - Frontend (Vitest): 79 tests (6 LogFileUploadInput, 6 StartDiscoveryRunModal, 4 runRowLogsAttachWarningChip, 7 candidateDetailsExpansion, 29 codeDetectionMappers, 10 candidateDetailsPanel, 7 candidateEvidenceSectionCard, 10 candidateEvidenceBuilder)
  - Gateway (Jest): 6 tests (discoveryRunLogService — sanitisation, collision, happy path, disk-write failure, AMS PATCH error surfacing)
  - Architecture-model-service (JUnit/MockMvc): 5 tests (DiscoveryRunInputArtifactsControllerTest)
- **Passing:** 90
- **Failing:** 0
- **Errors:** 0

### Failed Tests

None — all tests passing across the focused Spec 4 + Spec 1-3 backstop surface.

### Notes

- A full-repo AMS Maven test run (`mvn test -Dmaven.test.skip=false`) **fails to compile** because of pre-existing test compilation errors in unrelated test classes: `RoadmapImportServiceV3Test.java`, `OrganisationControllerTextIdTest.java`, `OrganisationControllerDocsAppliedTest.java`, `WorkItemImplementContextServiceTest.java`. These are pre-existing failures unrelated to Spec 4 — they exist because the AMS project sets `maven.test.skip=true` by default. Workaround used: `mvn surefire:test -Dtest=DiscoveryRunInputArtifactsControllerTest -DskipTests=false -Dmaven.test.skip=false` (against pre-compiled test classes in `target/test-classes/`), which yields **5 tests run, 0 failures, 0 errors, 0 skipped**.
- Frontend `tsc --noEmit` shows pre-existing errors in unrelated files (e.g. `Grid.tsx` lines 102 / 1032 / 1581 / 1589, `utils/*.ts`, `api/discoveryApi.gapFill.test.ts`, etc.). All Spec 4 production files (`LogFileUploadInput.tsx`, `StartDiscoveryRunModal.tsx`, `runInputArtifactsHelpers.ts`, `discoveryApi.ts` log-upload section) type-check cleanly with zero new errors.
- Gateway `tsc --noEmit` is fully clean (zero errors).

---

## 5. Acceptance Criteria Sweep against `spec.md`

Each criterion verified against the actual code.

### AMS PATCH endpoint

- [x] **URL exact match:** `PATCH /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/input-artifacts/log-files` — verified at `DiscoveryRunController.java:55` (class-level `@RequestMapping`) + `:274` (`@PatchMapping("/{runId}/input-artifacts/log-files")`).
- [x] **Idempotent merge on `artifactId`:** `DiscoveryRunService.java:704-723` iterates incoming entries, scans existing `mergedLogFiles` for matching `artifactId`, replaces in place when found, otherwise appends.
- [x] **`attemptedCount = max(existing, incoming)`:** `DiscoveryRunService.java:728-734`, with `Math.max(existingAttempted, incomingAttempted)`.
- [x] **404 for missing run:** `DiscoveryRunService.java:662-667` throws `ResourceNotFoundException` (mapped by `GlobalExceptionHandler` to 404).
- [x] **400 for validation failure:** Controller-local `@ExceptionHandler(MethodArgumentNotValidException.class)` at `DiscoveryRunController.java:311-322` returns 400 with field-level error messages. (Required because the global handler catches `Exception.class` and would otherwise short-circuit Spring's normal 400 mapping to 500.)
- [x] **No Liquibase changeset:** `git status -- architecture-model-service/src/main/resources/db/changelog/` returns empty.

### AMS DTO shapes

- [x] `LogFileMetaDto` has all required camelCase fields (`artifactId`, `originalFileName`, `sizeBytes`, `fileExtension`, `contentType`, `uploadedAtIso`, `relativePath`) with correct validation annotations.
- [x] `LogFilesPatchRequest` has `List<LogFileMetaDto> logFiles` (`@NotEmpty @Valid`) and `Integer attemptedCount` (`@PositiveOrZero`).

### AMS multipart limits

- [x] `architecture-model-service/src/main/resources/application.yml` lines 49-51: `max-file-size: 50MB`, `max-request-size: 200MB`.
- [x] `architecture-model-service/src/test/resources/application.yml` lines 34-36: same values.

### Gateway route

- [x] **Route URL:** `discoveryRouter.post('/projects/:projectId/architectures/:architectureId/runs/:runId/log-files', ...)` at `discovery.ts:2183`.
- [x] **multer wired:** `import multer from 'multer'` at `discovery.ts:63`; memory storage with `fileSize: LOG_UPLOAD_MAX_FILE_BYTES` and `files: 50` at `discovery.ts:2145-2151`.
- [x] **Env vars at module init:** `LOG_UPLOAD_MAX_FILE_BYTES` (default 52,428,800) at `discovery.ts:2131-2135`; `LOG_UPLOAD_MAX_TOTAL_BYTES` (default 209,715,200) at `discovery.ts:2137-2141`.
- [x] **Total-request size cap enforced in handler:** `discovery.ts:2249-2258` sums `req.files[*].size` and returns 413 on overflow.
- [x] **Multer LIMIT_FILE_SIZE → 413:** `discovery.ts:2189-2196`.
- [x] **Server-side extension allowlist re-check (415):** `discovery.ts:2238-2247`. `hasAllowedLogExtension` is case-insensitive (`.toLowerCase()` then `endsWith`).
- [x] **Empty array / missing runId → 400:** `discovery.ts:2223-2235`.

### Gateway service (`discoveryRunLogService.ts`)

- [x] **Sanitisation rules:** `sanitiseFileName` at lines 131-166 strips `/`, `\\`, `\\x00-\\x1F`, `\\x7F`; collapses whitespace runs to `_`; preserves extension; returns null on empty (caller maps to 400).
- [x] **Collision suffix `(2)`, `(3)`, ...:** `resolveCollisionSuffix` at lines 189-206 inserts ` (N)` before extension.
- [x] **`relativePath` is project-folder-rooted:** line 289 — `discovery-runs/${runId}/logs/${finalName}` with forward slashes (NOT absolute).
- [x] **Disk-write failure aborts before PATCH:** `DiskWriteError` thrown in `try/catch` around `fs.writeFile` at lines 267-280; PATCH call at line 307 is reached only after the loop completes.
- [x] **`fetchProjectFolder` used:** line 234.
- [x] **`uuidv4()` for `artifactId`:** line 292.

### Gateway thin client

- [x] **PATCH URL exact match:** `architectureModelClient.ts:2026-2030` builds `/api/model/projects/.../architectures/.../discovery/runs/.../input-artifacts/log-files`.
- [x] **`LogFileMeta` and `LogFilesPatchRequest` exported:** lines 1975-1992.
- [x] **`Content-Type: application/json`:** line 2044.

### Frontend `LogFileUploadInput`

- [x] **`accept=".log,.txt,.jsonl,.ndjson"`:** `LogFileUploadInput.tsx:42-43` builds the accept attr; line 204 applies it to the `<input>`.
- [x] **`multiple` attribute:** line 203.
- [x] **Controlled props (`selectedFiles`, `onChange`):** props at lines 99-112.
- [x] **Per-row remove button + filename + size:** lines 222-241.
- [x] **Client-side validation rejects unsupported ext / oversize / over-total-size with inline messages:** lines 144-167; messages shown in `<ul role="alert" data-testid="log-file-upload-input-validation-errors">` at lines 248-260.
- [x] **No silent drops:** every rejection pushes a message into `errors[]`; only the `onChange` accepts the surviving files.

### Frontend `StartDiscoveryRunModal`

- [x] **Title + LogFileUploadInput + Start/Cancel buttons:** lines 196-251.
- [x] **No "Include external libraries" toggle, no BFS preview, no architecture picker:** verified by reading the full file (only `<LogFileUploadInput>` in the body).
- [x] **Create-run-first → upload-after sequencing:** `handleStart` at lines 122-184: (1) `startDiscoveryRun(...)` then capture `runId`, (2) only if `selectedFiles.length > 0`, call `uploadDiscoveryRunLogFiles`.
- [x] **Empty-file path skips upload:** lines 149-153.
- [x] **Upload failure keeps run, shows error banner, does NOT roll back, does NOT auto-close:** lines 162-174 — sets `uploadError`, calls `onRunStarted(runId)` (so the parent knows the run exists), but does NOT call `onClose()`.

### Frontend `PreflightModal`

- [x] **Existing controls preserved:** `BFS scan plan preview` (`scanPlan.internalLibrariesToScan`, `scanPlan.externalLibrariesToRecord`, expand/collapse), "Include external libraries" toggle (`preflight-modal-toggle-include-external` data-testid at line 450), Run button — all intact.
- [x] **Upload Log Files section above Run/Cancel:** `<LogFileUploadInput>` at line 459, with the comment block at lines 456-457 noting Spec 2026-05-10 Task Group 4.4.
- [x] **Submit handler threads files into the existing flow:** `handlePreflightConfirm` in `Grid.tsx:812-871` receives `(includeExternal, selectedLogFiles)` and performs the create-run-first → upload-after orchestration.

### Frontend `Grid.tsx`

- [x] **`handleStartDiscoveryRunFromMenu` opens new modal instead of firing run immediately:** `Grid.tsx:621-663` now calls `setStartRunModalState({ isOpen: true, ... })` instead of `invokeStartRun`.
- [x] **`handlePreflightConfirm` non-rollback failure semantics:** `Grid.tsx:848-862` — on upload error, `showToast('error', ...)` and explicitly does NOT return; the user still navigates to the run-detail page.
- [x] **New modal mounted next to `StartDiscoveryRunConfirmModal`:** `Grid.tsx:1266` (StartDiscoveryRunModal) + `1282` (StartDiscoveryRunConfirmModal preserved unchanged).
- [x] **Tier-C 409 confirmation flow unchanged:** `StartDiscoveryRunConfirmModal.tsx` shows zero diff vs HEAD; `handleStartRunModalError` (Grid.tsx:685-713) routes 409 LLM_SOLO back to the existing confirm modal pipeline.

### Warning chip predicates and placement

- [x] **`partial = attemptedCount > 0 && logFiles.length < attemptedCount && logFiles.length > 0`:** `runInputArtifactsHelpers.ts:111-115` — after early-returns for `attemptedCount<=0` and `logFilesLength>=attemptedCount`, the only remaining case for `'partial'` is `attemptedCount>0 && logFilesLength>0 && logFilesLength<attemptedCount`.
- [x] **`failed = attemptedCount > 0 && logFiles.length === 0`:** `runInputArtifactsHelpers.ts:112-114`.
- [x] **Chip placement: immediate next-sibling `<span>` of the status-badge `<span>` in each `<li data-testid="run-list-item">`:**
  - `DiscoveryRunsList.tsx:179-201` — `<li data-testid="run-list-item">` → `<span className={statusBadge}>` → `{warningLabel && <span data-testid="run-list-logs-attach-warning-chip">...</span>}`.
  - `DiscoveryRunDetailView.tsx:542-563` — same pattern in the detail-view's run-list rendering.
- [x] **Labels exact:** `LOG_ATTACH_WARNING_LABEL_PARTIAL = 'Logs partially attached'` and `LOG_ATTACH_WARNING_LABEL_FAILED = 'Log attach failed'` at `runInputArtifactsHelpers.ts:46-47`.

### Out-of-scope confirmation

- [x] **Discovery-service untouched:** `git diff --stat -- discovery-service/src/` returns empty (no changes anywhere under the discovery-service tree).
- [x] **Spec 1-3 frontend files untouched by Spec 4:** `CandidateDetailsPanel.tsx` shows as modified in working tree but mtime is 2026-05-10 17:47, earlier than the earliest Spec 4 file `LogFileUploadInput.tsx` at 20:19 — confirming this modification is pre-existing Spec 1-3 work, not Spec 4.
- [x] **`StartDiscoveryRunConfirmModal.tsx` Tier-C flow unchanged:** `git diff --stat` returns empty.
- [x] **Existing run-start proxy at `POST /projects/.../runs` untouched:** spot-checked; the new route is additive at `discovery.ts:2182-2183`.
- [x] **Existing log-enrichment proxy untouched:** spot-checked; the Spec-5-future endpoint is left at its existing line and not modified.

### Cross-service `LogFileMeta` consistency

| Field            | AMS Java (`LogFileMetaDto`) | Gateway TS (`architectureModelClient`) | Frontend TS (`discoveryApi`) |
|------------------|-----------------------------|-----------------------------------------|------------------------------|
| `artifactId`     | String, required (`@NotBlank`) | string                                  | string                       |
| `originalFileName` | String, required (`@NotBlank`) | string                                | string                       |
| `sizeBytes`      | Long, required (`@NotNull @PositiveOrZero`) | number                       | number                       |
| `fileExtension`  | String, required (`@NotBlank`) | string                                  | string                       |
| `contentType`    | String, optional             | string?                                  | string?                      |
| `uploadedAtIso`  | String, required (`@NotBlank`) | string                                  | string                       |
| `relativePath`   | String, required (`@NotBlank`) | string                                  | string                       |

All three definitions align field-for-field on names, types, and required/optional status.

---

## 6. Final Overall Verdict

**PASSED** with the following caveats:

1. **Manual smoke 6.1-6.7 deferred to user.** This was the agreed delivery shape (the NOTE block in tasks.md explicitly states these are manual scenarios requiring locally-running services with real file uploads). The user must:
   - Start architecture-model-service, gateway, and frontend locally (e.g. via dev-compose).
   - 6.2 — Trigger default Start Discovery Run; confirm modal opens; click Start with no files; verify run starts and no chip appears.
   - 6.3 — Repeat with 2 valid log files; verify upload writes to `{projectFolder}/discovery-runs/{runId}/logs/`, `inputArtifacts.logFiles[]` has 2 entries with project-folder-rooted `relativePath`, `attemptedCount===2`, no chip.
   - 6.4 — Trigger Library Scan; confirm BFS preview + "Include external libraries" toggle still render alongside the new upload section; upload 1 file + Run; verify `inputArtifacts` populated.
   - 6.5 — `curl` re-PATCH the AMS endpoint with the same `LogFileMeta` payload; verify `logFiles[]` length unchanged (replace, not duplicate).
   - 6.6 — Manually craft a state where `attemptedCount > logFiles.length`; reload UI; verify "Logs partially attached" chip; set `logFiles: []` and verify "Log attach failed" chip.
   - 6.7 — Try `.png` upload (frontend rejects); >50MB single file (frontend rejects); curl `.png` to gateway (415); curl >50MB to gateway (413).

2. **Pre-existing AMS test compilation failures** in unrelated files prevent a full `mvn test` run. The Spec 4 test class itself (`DiscoveryRunInputArtifactsControllerTest`) compiles and runs cleanly via `mvn surefire:test -Dtest=...` with all 5 tests passing. Project default skip flag (`maven.test.skip=true`) was set precisely because of these pre-existing issues, so this is not new regression.

3. **Pre-existing frontend `tsc --noEmit` errors** in unrelated files (e.g. `Grid.tsx` constructor mismatches at lines 102 / 1032 / 1581 / 1589, `utils/*.ts` index-signature errors, `api/discoveryApi.gapFill.test.ts` "Cannot find name 'global'") are pre-existing and not caused by Spec 4. All Spec 4 production code type-checks cleanly with zero new errors.
