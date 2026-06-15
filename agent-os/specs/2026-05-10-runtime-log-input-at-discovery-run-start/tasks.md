# Task Breakdown: Runtime Log Input at Discovery Run Start

## Overview
Total Tasks: 6 task groups

This is the first cross-service spec in the 7-spec roadmap and spans frontend + gateway + architecture-model-service. Discovery-service is intentionally NOT modified. Spec 1-3 frontend code (`CandidateDetailsPanel.tsx`, `CandidateEvidenceSectionCard.tsx`, `codeDetectionMappers.ts`, `candidateEvidenceTypes.ts`, etc.) is intentionally NOT modified.

## Task List

### Architecture-Model-Service Layer

#### Task Group 1: PATCH endpoint for log-file metadata + multipart limit bump
**Dependencies:** None

- [x] 1.0 Complete architecture-model-service backend foundation
  - [x] 1.1 Write 2-8 focused Spring Boot tests for the new PATCH endpoint
    - Limit to 2-8 highly focused tests maximum
    - Test: (a) initial PATCH appends entries to empty `config_snapshot.inputArtifacts.logFiles[]`, (b) re-PATCH with same `artifactId` REPLACES the entry (idempotent, no duplicate append), (c) `attemptedCount` is set to `max(existing, incoming)`, (d) 404 when run row is missing, (e) 400 on schema validation failure (missing required field)
    - Use H2 + Spring Boot Test with MockMvc; follow the existing controller test pattern
    - Skip exhaustive coverage of all DTO field combinations and edge cases
  - [x] 1.2 Create `LogFileMetaDto` Java record/class
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/discovery/LogFileMetaDto.java`
    - camelCase JSON fields: `artifactId` (String, required), `originalFileName` (String, required), `sizeBytes` (long, required), `fileExtension` (String, required), `contentType` (String, optional), `uploadedAtIso` (String, required), `relativePath` (String, required)
    - Use Jakarta validation annotations (`@NotBlank`, `@NotNull`) on required fields
  - [x] 1.3 Create `LogFilesPatchRequest` request DTO
    - Fields: `List<LogFileMetaDto> logFiles` (required, non-empty), `Integer attemptedCount` (required, >= 0)
    - Place alongside `LogFileMetaDto` in the same `dto/discovery/` subpackage
  - [x] 1.4 Add new service method on the existing `DiscoveryRunEntity` service layer
    - Match the existing CRUD service pattern for `DiscoveryRunEntity` (load, mutate, save)
    - Method signature: `Map<String, Object> patchLogFileArtifacts(UUID projectId, UUID architectureId, UUID runId, LogFilesPatchRequest request)` returning the updated `inputArtifacts` block
    - Behaviour: load run by `(projectId, architectureId, runId)`; if missing throw a 404-mapped exception. Read `config_snapshot` (initialise empty Maps as needed for `inputArtifacts` and `logFiles`). Merge each incoming entry into `inputArtifacts.logFiles[]` keyed on `artifactId` (replace existing, otherwise append). Set `inputArtifacts.attemptedCount = max(existing or 0, incoming)`. Persist via the existing JPA save path. Return the updated `inputArtifacts` map.
  - [x] 1.5 Create new PATCH controller method
    - Endpoint: `PATCH /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/input-artifacts/log-files`
    - Place in the existing discovery-run controller (or create a focused `DiscoveryRunInputArtifactsController` if the existing controller is overloaded — match existing project conventions)
    - Body: `@Valid @RequestBody LogFilesPatchRequest`
    - Returns 200 with the updated `inputArtifacts` Map; 404 mapping for missing run; 400 mapping for validation failure
  - [x] 1.6 Bump Spring multipart limits in `application.yml`
    - File: `architecture-model-service/src/main/resources/application.yml`
    - Set `spring.servlet.multipart.max-file-size: 50MB`
    - Set `spring.servlet.multipart.max-request-size: 200MB`
    - If `application-test.yml` exists, apply the same values there
    - Note: this PATCH endpoint itself only carries small JSON bodies (metadata only); the bump leaves headroom and matches gateway-side caps
  - [x] 1.7 Confirm NO Liquibase changeset is created
    - The JSONB `config_snapshot` column already exists on `discovery_run`
    - Per memory feedback "Never edit applied Liquibase changesets" — and this spec adds NO new changesets either
  - [x] 1.8 Ensure architecture-model-service tests pass
    - Run ONLY the 2-8 tests written in 1.1 (e.g. `mvn -pl architecture-model-service test -Dtest=DiscoveryRunInputArtifactsControllerTest`)
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass
- PATCH endpoint persists log-file metadata to `config_snapshot.inputArtifacts.logFiles[]` and is idempotent on `artifactId`
- `attemptedCount` is updated using `max(existing, incoming)`
- 404 returned for missing run; 400 for invalid request body
- Spring multipart limits raised to 50MB / 200MB
- No new Liquibase changeset added

---

### Gateway Layer

#### Task Group 2: Gateway multipart upload route + disk-write service + downstream PATCH
**Dependencies:** Task Group 1 (the route's downstream PATCH targets the AMS endpoint; tests mock the AMS client, runtime requires Group 1 deployed)

- [x] 2.0 Complete gateway upload pipeline
  - [x] 2.1 Write 2-8 focused Jest tests for the new route + service
    - Limit to 2-8 highly focused tests maximum
    - Test: (a) multipart parsing happy path — two files written to disk + AMS PATCH called with correct `LogFileMeta[]` shape (mock `fs` and architecture-model-service client), (b) filename sanitisation strips path separators / control chars / collapses whitespace and preserves extension, (c) collision suffixing within one batch (` (2)`, ` (3)`), (d) disk-write failure returns 500 and does NOT call AMS PATCH, (e) AMS PATCH failure surfaces error to caller with the run already created
    - Use the existing test patterns: `jest.mock('fs/promises')`, mock `architectureModelClient` with the `jest.requireActual` spread pattern (per project memory)
    - Skip exhaustive coverage of every error code permutation
  - [x] 2.2 Add multer dependency
    - Add `multer` and `@types/multer` to `gateway/package.json` `dependencies` / `devDependencies`
    - Run `npm install` in `gateway/` to refresh the lockfile
  - [x] 2.3 Create `gateway/src/services/discoveryRunLogService.ts`
    - Model on `gateway/src/services/discoveryInsightsService.ts` (same fs + architectureModelClient seam for testability)
    - Export `writeLogFilesAndPatchRun(args: { projectId, architectureId, runId, files: Array<{ originalname, size, mimetype, buffer }>, attemptedCount }): Promise<{ logFiles: LogFileMeta[], attemptedCount: number, successfulCount: number }>`
    - Resolve project folder via `fetchProjectFolder(projectId)` (per project memory: in `architectureModelClient.ts`)
    - Sanitisation rules (faithful to spec): strip `/` and `\`, strip control chars (`\x00`-`\x1F`, `\x7F`), collapse whitespace runs to single `_`, preserve original extension. If sanitised name is empty → reject the file (caller maps to 400).
    - Collision rule: within one batch, if a sanitised name already used, suffix base name with ` (2)`, ` (3)`, etc. before the extension
    - Write each file to `{projectFolder}/discovery-runs/{runId}/logs/{sanitizedName}` via `fs.mkdir({ recursive: true })` + `fs.writeFile`
    - For each successfully written file, build `LogFileMeta` entry: `{ artifactId: uuidv4(), originalFileName: sanitizedName, sizeBytes, fileExtension, contentType, uploadedAtIso: new Date().toISOString(), relativePath: 'discovery-runs/{runId}/logs/{sanitizedName}' }` — `relativePath` is project-folder-rooted, NOT absolute
    - On any disk-write failure: do NOT call PATCH; throw a structured error containing the failed filename
    - On all-files-written success: PATCH the AMS endpoint from Group 1 with `{ logFiles, attemptedCount }`; if PATCH fails, throw a structured error
  - [x] 2.4 Create new gateway route
    - File: add to `gateway/src/routes/discovery.ts`
    - Route: `POST /projects/:projectId/architectures/:architectureId/runs/:runId/log-files`
    - Wires multer (memory storage) with `limits: { fileSize: LOG_UPLOAD_MAX_FILE_BYTES, files: 50 }`
    - Read env vars at module init: `LOG_UPLOAD_MAX_FILE_BYTES` (default `52428800` / 50 MB), `LOG_UPLOAD_MAX_TOTAL_BYTES` (default `209715200` / 200 MB)
    - Total-request size enforced explicitly in handler against `LOG_UPLOAD_MAX_TOTAL_BYTES` by summing `req.files[*].size`; on overflow → 413
    - Multer `LIMIT_FILE_SIZE` error → 413 Payload Too Large
    - Server-side extension allowlist re-check (`.log`, `.txt`, `.jsonl`, `.ndjson` case-insensitive); mismatch → 415
    - Empty files array or missing `runId` → 400
    - On success, return `{ logFiles: LogFileMeta[], attemptedCount: number, successfulCount: number }` with HTTP 200
    - Set `attemptedCount = req.files.length` BEFORE write attempts; `successfulCount = logFiles.length` after
  - [x] 2.5 Confirm the existing run-start proxy at `POST /projects/:projectId/architectures/:architectureId/runs` is NOT modified
    - This route stays untouched; the upload flow runs AFTER it returns the new `runId`
  - [x] 2.6 Confirm discovery-service is NOT touched
    - No edits to `discovery-service/src/**`
    - No edits to the existing log-enrichment proxy (line ~1546 in `discovery.ts`)
  - [x] 2.7 Ensure gateway tests pass
    - Run ONLY the 2-8 tests written in 2.1 (e.g. `cd gateway && npx jest src/__tests__/discoveryRunLogService.test.ts`)
    - Do NOT run the entire gateway test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass
- multer wired into gateway with env-configurable per-file and total caps
- Filename sanitisation matches spec rules byte-for-byte
- Collision suffixing produces ` (2)`, ` (3)`, ... before the extension
- Files written to `{projectFolder}/discovery-runs/{runId}/logs/{sanitizedName}` (project-folder-rooted `relativePath` recorded in metadata)
- Disk-write failure prevents AMS PATCH and surfaces 500
- AMS PATCH failure surfaces upstream error to frontend (run already started, NOT rolled back)
- Discovery-service unchanged

---

### Frontend Layer

#### Task Group 3: Reusable LogFileUploadInput component
**Dependencies:** None (independent of Group 2; can run in parallel)

- [x] 3.0 Build the reusable upload component
  - [x] 3.1 Write 2-8 focused Vitest + Testing Library tests for `LogFileUploadInput`
    - Limit to 2-8 highly focused tests maximum
    - Test: (a) renders multi-file input with `accept` attribute, (b) selecting files calls `onChange` with the File array, (c) clicking remove on a row removes that file from the displayed list and calls `onChange`, (d) client-side validation rejects an unsupported extension with an inline error, (e) client-side validation rejects when a single file exceeds `LOG_UPLOAD_MAX_FILE_BYTES`, (f) client-side validation rejects when cumulative size exceeds `LOG_UPLOAD_MAX_TOTAL_BYTES`
    - Use the existing Vitest setup with Proxy CSS module mock
    - Skip exhaustive coverage of all UI states
  - [x] 3.2 Create `frontend/src/components/Discovery/LogFileUploadInput.tsx`
    - Mirror `frontend/src/components/Import/InfrastructureTerraformImportModal.tsx` patterns
    - Native `<input type="file" accept=".log,.txt,.jsonl,.ndjson" multiple />`
    - Section title: "Upload Log Files"
    - Helper text: "Optional. Upload runtime log files to attach them to this discovery run. Log processing will be used by later discovery steps."
    - Selection list: each row shows filename, human-readable size, and a remove button
    - Props: `selectedFiles: File[]`, `onChange: (files: File[]) => void`, optional `maxFileBytes?: number` and `maxTotalBytes?: number` (defaults from frontend env)
    - Inline validation messages — do NOT silently drop files
    - Drag-and-drop only if trivially supported by the native `<input type="file">` — do NOT add custom drag-drop handlers
  - [x] 3.3 Create accompanying `LogFileUploadInput.module.css` (or follow existing Discovery component style convention)
    - Match visual conventions of `InfrastructureTerraformImportModal`
  - [x] 3.4 Confirm Spec 1-3 frontend code is NOT touched
    - No edits to `CandidateDetailsPanel.tsx`, `CandidateEvidenceSectionCard.tsx`, `codeDetectionMappers.ts`, or `candidateEvidenceTypes.ts`
  - [x] 3.5 Ensure component tests pass
    - Run ONLY the 2-8 tests written in 3.1 (e.g. `cd frontend && npx vitest run src/components/Discovery/LogFileUploadInput.test.tsx`)
    - Do NOT run the entire frontend test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass
- Component is a fully controlled input (parent owns `selectedFiles` state)
- Client-side validation rejects unsupported extensions and over-size files (per-file + cumulative) with visible inline messages
- No edits to Spec 1-3 frontend files

---

#### Task Group 4: Pre-run modals + run-start orchestration + upload API client
**Dependencies:** Task Group 3 (uses `LogFileUploadInput`); Task Group 2 (uploads target the new gateway route — for runtime, mocks for test)

- [x] 4.0 Wire upload into both run-start flows
  - [x] 4.1 Write 2-8 focused Vitest tests across the new modal + modified PreflightModal + API client
    - Limit to 2-8 highly focused tests maximum
    - Test: (a) `StartDiscoveryRunModal` renders `LogFileUploadInput` and Start/Cancel; clicking Start calls `createDiscoveryRun` then (when files present) `uploadDiscoveryRunLogFiles` with the returned `runId`, (b) `StartDiscoveryRunModal` Start with no files selected calls `createDiscoveryRun` and SKIPS the upload call, (c) `StartDiscoveryRunModal` upload-failure path keeps the run and surfaces a toast (does NOT roll back), (d) modified `PreflightModal` renders the new "Upload Log Files" section above Run/Cancel and preserves all existing controls (BFS preview + "Include external libraries" toggle), (e) modified `PreflightModal` Run flow performs create-run-first → upload-after sequencing, (f) `uploadDiscoveryRunLogFiles` builds `FormData` with all files and POSTs without setting `Content-Type` manually
    - Mock `ArchitectureContext`, `PendingActionContext`, `ModalActionContext` (per project memory)
    - Mock `createDiscoveryRun` / `startDiscoveryRun` and `uploadDiscoveryRunLogFiles`
  - [x] 4.2 Add `uploadDiscoveryRunLogFiles` to `frontend/src/api/discoveryApi.ts`
    - Signature: `uploadDiscoveryRunLogFiles(projectId: string, architectureId: string, runId: string, files: File[]): Promise<{ logFiles: LogFileMeta[], attemptedCount: number, successfulCount: number }>`
    - Builds `FormData`, appends each file under field name `logFiles` (matches multer config in 2.4)
    - POSTs to `/api/v1/discovery/projects/{projectId}/architectures/{architectureId}/runs/{runId}/log-files`
    - Do NOT set `Content-Type` header manually — let the browser supply the multipart boundary
    - Define and export the `LogFileMeta` TypeScript type matching the gateway/AMS shape (`artifactId`, `originalFileName`, `sizeBytes`, `fileExtension`, `contentType?`, `uploadedAtIso`, `relativePath`)
  - [x] 4.3 Create `frontend/src/components/Discovery/StartDiscoveryRunModal.tsx`
    - Minimal modal for the default Start Discovery Run flow (today fires immediately with no modal)
    - Contents: title, embedded `LogFileUploadInput` section, Start / Cancel buttons
    - Architecture picker NOT required (per shaping notes: `handleStartDiscoveryRunFromMenu` in `Grid.tsx` already has `architectureId` in scope)
    - Do NOT replicate `PreflightModal.tsx` options (no "include external libraries" toggle, no BFS scan plan preview)
    - On Start:
      1. Call existing `startDiscoveryRun` (or `createDiscoveryRun`) — unchanged signature
      2. Capture returned `runId`
      3. If `selectedFiles.length > 0`, call `uploadDiscoveryRunLogFiles(projectId, architectureId, runId, selectedFiles)`
      4. On upload success → close modal
      5. On upload failure → keep run, surface error toast with gateway error detail, do NOT auto-close (user dismisses)
    - On Cancel: close modal without starting a run
  - [x] 4.4 Modify `frontend/src/components/Grid/PreflightModal.tsx`
    - Add a new "Upload Log Files" section ABOVE Run/Cancel using the same `LogFileUploadInput` component
    - All existing PreflightModal behaviour (BFS scan preview, "Include external libraries" toggle, Run button) MUST remain intact
    - Selected files are owned by the modal's existing state and threaded into the existing submit handler
    - Modify the submit handler to perform create-run-first → upload-after orchestration matching `StartDiscoveryRunModal`
    - On upload failure: keep run, surface toast, do NOT roll back
  - [x] 4.5 Wire `StartDiscoveryRunModal` into the default-flow trigger site
    - File: `frontend/src/components/Grid/Grid.tsx`
    - Modify `handleStartDiscoveryRunFromMenu` (line ~604 per shaping notes) to OPEN `StartDiscoveryRunModal` BEFORE the existing `invokeStartRun` call (instead of firing the run immediately)
    - The Tier-C 409 confirmation flow (`StartDiscoveryRunConfirmModal.tsx`) is unchanged; its 409-retry semantics remain a separate gate
    - Mount the modal in the same JSX tree as the existing `StartDiscoveryRunConfirmModal`
  - [x] 4.6 Confirm Spec 1-3 frontend code is NOT touched
    - Verify no edits made to `CandidateDetailsPanel.tsx`, `CandidateEvidenceSectionCard.tsx`, `codeDetectionMappers.ts`, `candidateEvidenceTypes.ts`
  - [x] 4.7 Ensure orchestration tests pass
    - Run ONLY the 2-8 tests written in 4.1
    - Do NOT run the entire frontend test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass
- Default-flow context-menu action now opens `StartDiscoveryRunModal` instead of firing the run immediately
- Library-Scan flow continues to open `PreflightModal` with all existing controls intact AND the new upload section embedded
- Both flows perform create-run-first → upload-after sequencing
- Empty file selection skips the upload call and preserves byte-for-byte the existing no-log behaviour
- Upload failure keeps the run, surfaces a toast, and does NOT roll back
- Spec 1-3 frontend files unchanged
- Tier-C 409 confirmation flow unchanged

---

#### Task Group 5: Warning chip on the run row + integration tests
**Dependencies:** Task Group 4

- [x] 5.0 Surface partial / failed log-attach state on the run row
  - [x] 5.1 Write 2-8 focused Vitest tests for the warning-chip rendering
    - Limit to 2-8 highly focused tests maximum
    - Test: (a) chip NOT rendered when `attemptedCount === successfulCount` (or both 0), (b) chip with label "Logs partially attached" rendered when `attemptedCount > logFiles.length > 0`, (c) chip with label "Log attach failed" rendered when `logFiles.length === 0 && attemptedCount > 0`, (d) chip placement is adjacent to the existing run-status indicator in the run-list row
    - Mock the run-fetch response to return `config_snapshot.inputArtifacts.logFiles[]` and `attemptedCount` shapes
  - [x] 5.2 Locate the existing run-list / run-row render component
    - Identify the component rendering each discovery run row in the candidate-review surface (likely under `frontend/src/components/Discovery/` or `frontend/src/components/Grid/`)
    - Use the existing run-fetch endpoint output (no new API call) — `inputArtifacts` already returns from `config_snapshot`
  - [x] 5.3 Add the warning chip / badge to the run-row component
    - Read `config_snapshot.inputArtifacts.logFiles[]` and `config_snapshot.inputArtifacts.attemptedCount` from the run row data
    - Compute partial-state: `partial = attemptedCount > 0 && logFiles.length < attemptedCount`
    - Compute total-failure-state: `failed = attemptedCount > 0 && logFiles.length === 0`
    - Label text: "Log attach failed" when `failed`, otherwise "Logs partially attached" when `partial`
    - Chip placement: pinned adjacent to the existing run-status indicator
    - Use existing chip / badge styling conventions in the codebase
  - [x] 5.4 Confirm no new API endpoint is added
    - The chip reads from the existing run-fetch endpoint payload
    - No edits to discovery-service routes
  - [x] 5.5 Ensure chip tests pass
    - Run ONLY the 2-8 tests written in 5.1
    - Do NOT run the entire frontend test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 5.1 pass
- Chip correctly renders for partial / failed states based on `inputArtifacts` payload
- Chip is positioned adjacent to the existing run-status indicator
- No new API endpoint added; chip reads from existing run-fetch payload
- Run is never rolled back on log-upload failure

---

### End-to-End Verification

#### Task Group 6: Cross-service smoke verification
**Dependencies:** Task Groups 1-5

> **NOTE — Manual scenarios deferred to user.** Sub-tasks 6.1 through 6.7 are MANUAL smoke scenarios that require running architecture-model-service, gateway, and frontend locally with real file uploads. These are deferred to the user and remain unchecked. The static checks (6.8 discovery-service untouched, 6.9 Spec 1-3 frontend files untouched) plus a non-regression test sweep across the Spec 4 + Spec 1-3 surface have been completed by the agent — these are the static-checkable portion of Group 6.

- [x] 6.0 Verify the cross-service plumbing end-to-end (Spec 4 surface only)
  - [ ] 6.1 Start architecture-model-service, gateway, and frontend locally (or in dev-compose if available)
  - [ ] 6.2 Smoke: default Start Discovery Run flow — modal opens, no logs selected
    - Trigger "Start Discovery Run" from the Services/Libraries grid context menu
    - Confirm `StartDiscoveryRunModal` opens
    - Click Start with no files
    - Verify run starts (existing behaviour preserved); no upload call fired
    - Verify NO chip appears on the run row
  - [ ] 6.3 Smoke: default Start Discovery Run flow — modal opens, logs selected
    - Re-trigger; select 2 valid log files (e.g. `.log` and `.jsonl`)
    - Click Start
    - Verify run is created, then upload POST succeeds, then modal closes
    - Verify files appear at `{projectFolder}/discovery-runs/{runId}/logs/`
    - Verify run row's `config_snapshot.inputArtifacts.logFiles[]` has 2 entries with project-folder-rooted `relativePath`
    - Verify `attemptedCount === 2`, `logFiles.length === 2`, NO chip appears
  - [ ] 6.4 Smoke: Library-Scan flow with logs
    - Trigger "Start Discovery Run (Library Scan)" — `PreflightModal` opens
    - Confirm BFS preview + "Include external libraries" toggle still render
    - Confirm new "Upload Log Files" section is present above Run/Cancel
    - Select 1 log file, click Run
    - Verify run starts, files written, `inputArtifacts` populated
  - [ ] 6.5 Smoke: idempotent PATCH
    - Manually re-PATCH the AMS endpoint with the same `LogFileMeta` payload (e.g. via curl)
    - Verify `logFiles[]` array length is unchanged (entry replaced, not duplicated)
    - Verify `attemptedCount` unchanged (or set via max rule)
  - [ ] 6.6 Smoke: partial-failure warning chip
    - Manually craft a state where `attemptedCount > logFiles.length` (e.g. PATCH with `attemptedCount: 3, logFiles: [oneEntry]`)
    - Reload the run-list UI
    - Verify "Logs partially attached" chip renders adjacent to the run-status indicator
    - Set `logFiles: []` → verify "Log attach failed" chip
  - [ ] 6.7 Smoke: extension + size validation
    - Try to select a `.png` file → frontend rejects with inline message
    - Try to select a >50MB single file → frontend rejects
    - Bypass frontend (curl multipart to gateway) with a `.png` → 415
    - Curl with a >50MB file → 413
  - [x] 6.8 Confirm discovery-service was NOT touched in any group
    - `git diff --stat` on `discovery-service/src/` shows zero changes
  - [x] 6.9 Confirm Spec 1-3 frontend files were NOT touched in any group
    - `git diff --stat` on `CandidateDetailsPanel.tsx`, `CandidateEvidenceSectionCard.tsx`, `codeDetectionMappers.ts`, `candidateEvidenceTypes.ts` shows zero changes

**Acceptance Criteria:**
- All six smoke scenarios pass manually
- File system shows logs at `{projectFolder}/discovery-runs/{runId}/logs/{sanitizedName}`
- `discovery_run.config_snapshot.inputArtifacts` contains correct `logFiles[]` and `attemptedCount`
- Idempotent re-PATCH does not duplicate entries
- Warning chip renders for partial / failed states
- Discovery-service files unchanged
- Spec 1-3 frontend files unchanged
- NO full test-suite run at this stage (focused Spec 4 surface only)

---

## Execution Order

Recommended implementation sequence:
1. **Task Group 1** — Architecture-model-service PATCH endpoint + DTO + service + Spring test + multipart bump
2. **Task Group 2** — Gateway multer wiring + `discoveryRunLogService.ts` + new upload route + Jest tests (depends on Group 1 for runtime; tests mock AMS)
3. **Task Group 3** — Reusable `LogFileUploadInput.tsx` + Vitest tests (can run in parallel with Group 2)
4. **Task Group 4** — `StartDiscoveryRunModal.tsx` + modified `PreflightModal.tsx` + `Grid.tsx` wiring + `discoveryApi.ts` upload function + Vitest tests (depends on Group 3)
5. **Task Group 5** — Warning-chip UI on run row + integration tests (depends on Group 4)
6. **Task Group 6** — End-to-end cross-service smoke verification (depends on Groups 1-5)

## Critical Constraints (re-stated from spec)

- Discovery-service is NOT touched in any task group
- Spec 1-3 frontend code is NOT touched in any task group (no edits to `CandidateDetailsPanel.tsx`, `CandidateEvidenceSectionCard.tsx`, `codeDetectionMappers.ts`, `candidateEvidenceTypes.ts`)
- The new AMS PATCH endpoint must be idempotent on `artifactId` (re-PATCHing the same artifactId replaces the entry, does not append a duplicate)
- Filename sanitisation rules from spec must be implemented faithfully (strip path separators, strip control chars, collapse whitespace to underscores, preserve extension, disallow empty sanitised name)
- Filename collision within same run: ` (2)`, ` (3)`, ...
- `relativePath` written to `config_snapshot` is project-folder-rooted, NOT absolute
- Create-run-first → upload-after timing is locked; on partial failure: warning chip + toast, do NOT roll back the run
- Both file size limits (per-file, total) must be env-configurable on both gateway (multer) and AMS (Spring multipart)
- NO Liquibase changeset (the JSONB column already exists)
