# Specification: Runtime Log Input at Discovery Run Start

## Goal
Allow users to optionally upload one or more runtime log files when starting a discovery run, persisting them to the project folder on disk and recording lightweight references on the discovery_run row so that Spec 5 can later parse them into runtime endpoint evidence. This is Spec 4 of a 7-spec roadmap for discovery candidate evidence explainability and is the first cross-service change (frontend + gateway + architecture-model-service); discovery-service is intentionally NOT touched.

## User Stories
- As a discovery reviewer, I want to attach runtime log files (.log/.txt/.jsonl/.ndjson) when starting a discovery run so that later runtime-evidence steps have real traffic data to mine.
- As a discovery reviewer, I want the upload to be fully optional and to fail loudly (not silently) so that I am never left thinking my logs were attached when they were not.
- As a discovery reviewer, I want a minimal modal on the default Start-Run path and the same upload section embedded in the existing Library-Scan PreflightModal so that both flows have identical log-attach capability.

## Specific Requirements

**Scope and what changes from Specs 1-3**
- Specs 1-3 are pure frontend evidence-rendering refactors; none of their code (`CodeDetectionPanel`, `codeDetectionMappers`, `candidateEvidenceTypes`, `CandidateDetailsPanel`) is touched in this spec.
- Spec 4 lands files where Spec 5 can find them: it does NOT parse, classify, or correlate logs to candidates.
- Discovery-service code is NOT modified in this spec (no `runs.ts`, no `runManager`, no `logEnrichment.ts` changes); Spec 5 will read the run row to discover the on-disk log paths.

**New minimal pre-run modal for the default Start Discovery Run flow**
- New component `frontend/src/components/Discovery/StartDiscoveryRunModal.tsx`.
- Shown only for the default path (Tier A / Tier B "Start Discovery Run" context-menu action) which today fires immediately with no modal.
- Contents: title, the `LogFileUploadInput` section, an architecture picker ONLY if not already implicit at the trigger point (verify: `handleStartDiscoveryRunFromMenu` in `Grid.tsx` already has architectureId in scope, so the picker is NOT required), and Start / Cancel buttons.
- Do NOT replicate `PreflightModal.tsx` options (no "include external libraries" toggle, no BFS scan plan preview).
- Tier-C 409 confirmation flow (`StartDiscoveryRunConfirmModal.tsx`) is unchanged; its 409-retry semantics remain a separate gate.

**Embed upload section into existing Library-Scan PreflightModal**
- Modify `frontend/src/components/Grid/PreflightModal.tsx` to render a new "Upload Log Files" section ABOVE Run/Cancel using the same `LogFileUploadInput` component.
- All existing PreflightModal behaviour (BFS scan preview, "Include external libraries" toggle, Run button) MUST remain intact.
- Selected files are passed into the modal's existing submit handler so the run-start sequence is the only orchestration change.

**Reusable LogFileUploadInput component**
- New component `frontend/src/components/Discovery/LogFileUploadInput.tsx`.
- Mirrors `frontend/src/components/Import/InfrastructureTerraformImportModal.tsx` patterns: native `<input type="file" multiple accept=".log,.txt,.jsonl,.ndjson" />`, controlled selection list, per-row remove button, file-name + human-readable size shown for each row.
- Section title "Upload Log Files" with helper text "Optional. Upload runtime log files to attach them to this discovery run. Log processing will be used by later discovery steps."
- Client-side validation: reject any file whose extension is not in the accept list (case-insensitive); reject any file > `LOG_UPLOAD_MAX_FILE_BYTES`; reject if cumulative selected size > `LOG_UPLOAD_MAX_TOTAL_BYTES`. Show inline validation messages; do not silently drop.
- Exposes `selectedFiles: File[]` + `onChange(files: File[])` so both modals can own the state.

**Run-start orchestration: create-run-first then upload-after**
- Sequence: (1) user picks files in modal, (2) clicks Start, (3) frontend calls the existing run-creation API (`startDiscoveryRun` in `gatewayClient.ts` / `createDiscoveryRun` in `discoveryApi.ts`) unchanged, (4) on success the just-returned `runId` is captured, (5) if `selectedFiles.length > 0` the frontend then POSTs the files via multipart to the new gateway upload route scoped by `runId`, (6) modal closes on upload success or surfaces a non-blocking failure toast on upload failure (the run is NOT rolled back).
- If `selectedFiles.length === 0`, step 5 is skipped entirely and the existing no-log behaviour is byte-for-byte unchanged.
- Modify `frontend/src/api/discoveryApi.ts` to add a new `uploadDiscoveryRunLogFiles(projectId, architectureId, runId, files: File[]): Promise<UploadResult>` function that builds `FormData` and POSTs to the new gateway route. Browser supplies the multipart boundary; do NOT set `Content-Type` manually.

**Gateway multipart upload route**
- New route: `POST /api/v1/discovery/projects/:projectId/architectures/:architectureId/runs/:runId/log-files`, mounted in `gateway/src/routes/discovery.ts`.
- Wires `multer` (memory storage) into the gateway: add `multer` and `@types/multer` to `gateway/package.json` dependencies.
- Multer config: `limits: { fileSize: LOG_UPLOAD_MAX_FILE_BYTES, files: 50 }`. Total-request size enforced explicitly in handler against `LOG_UPLOAD_MAX_TOTAL_BYTES` by summing `req.files[*].size`.
- Server-side extension allowlist re-check (`.log/.txt/.jsonl/.ndjson` case-insensitive); reject 415 on mismatch.
- Multer-rejected oversize → 413 Payload Too Large; total-size overflow → 413; missing `runId` or files-array empty → 400.
- Env vars: `LOG_UPLOAD_MAX_FILE_BYTES` (default `52428800` i.e. 50 MB), `LOG_UPLOAD_MAX_TOTAL_BYTES` (default `209715200` i.e. 200 MB). Read at module init via existing gateway env-loading conventions.

**New gateway service for disk write + downstream PATCH**
- New file `gateway/src/services/discoveryRunLogService.ts` modelled on `gateway/src/services/discoveryInsightsService.ts`.
- Resolves project folder via existing `fetchProjectFolder(projectId)` (per project-memory: `architectureModelClient.ts`).
- Writes each uploaded file to `{projectFolder}/discovery-runs/{runId}/logs/{sanitizedOriginalFileName}` using `fs.mkdir({ recursive: true })` then `fs.writeFile`.
- Sanitisation rules: strip path separators (`/`, `\`), strip control characters, collapse whitespace runs to a single underscore, preserve the original extension. If the sanitised name is empty, reject the file (400). Filename collision within the same upload batch suffixed ` (2)`, ` (3)`, etc. before the extension.
- For each successfully written file, builds a `LogFileMeta` entry: `{ artifactId: uuidv4(), originalFileName, sizeBytes, fileExtension, contentType, uploadedAtIso: new Date().toISOString(), relativePath: "discovery-runs/{runId}/logs/{sanitizedName}" }`. `relativePath` is rooted at the project folder, NOT absolute.
- After all files are written, calls the new architecture-model-service PATCH endpoint with `{ logFiles: LogFileMeta[], attemptedCount: req.files.length }` and waits for success.
- On any disk-write failure: do NOT call the PATCH; return 500 with a structured error including which file failed; the caller (frontend) surfaces the warning chip per failure-mode flow.

**Architecture-model-service PATCH endpoint**
- New endpoint: `PATCH /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/input-artifacts/log-files`.
- Request DTO `LogFilesPatchRequest { List<LogFileMetaDto> logFiles; Integer attemptedCount; }` with camelCase JSON field names matching the gateway payload.
- `LogFileMetaDto` fields: `artifactId`, `originalFileName`, `sizeBytes`, `fileExtension`, `contentType`, `uploadedAtIso`, `relativePath` (all camelCase, all required except `contentType`).
- Loads the `DiscoveryRunEntity` row, mutates `config_snapshot` JSONB by merging entries into `config_snapshot.inputArtifacts.logFiles[]` (idempotent on `artifactId` — replace existing entry if same id, otherwise append) and sets `config_snapshot.inputArtifacts.attemptedCount` to the maximum of existing and incoming values.
- Returns 200 with the updated `inputArtifacts` block; returns 404 if the run row does not exist; returns 400 on schema/validation failure.
- NO Liquibase changeset: the JSONB `config_snapshot` column already exists on `discovery_run`.

**Spring Boot multipart config bump**
- Modify `architecture-model-service/src/main/resources/application.yml` to set `spring.servlet.multipart.max-file-size: 50MB` and `spring.servlet.multipart.max-request-size: 200MB` (replacing Spring's 1 MB / 10 MB defaults). Apply same values to `application-test.yml` if it exists.
- These are bumped even though the gateway proxy is the only intended caller, to match the body sizes the gateway can produce on the PATCH and to leave headroom; the PATCH itself is a small JSON body (metadata only, no raw file bytes).

**Failure-mode flow and warning-chip UX**
- Run row tracks `config_snapshot.inputArtifacts.attemptedCount` (set by the PATCH) AND the actual `config_snapshot.inputArtifacts.logFiles[].length`. When `attemptedCount > logFiles.length`, the run row is in a "log-attach partial" state.
- Add a small warning chip / badge to the discovery run row in the candidate-review surface (the run-list UI rendering each run row); label text "Logs partially attached" when partial, "Log attach failed" when `logFiles.length === 0 && attemptedCount > 0`. Pin chip placement adjacent to the existing run-status indicator.
- At upload time, surface a toast on the frontend with the gateway error detail when the upload POST returns non-2xx; do NOT close the modal until the user dismisses (run already started; user can retry by closing and re-uploading via Spec 5's reprocess pathway).
- Spec 4 does NOT add a reprocess endpoint. Spec 5 will provide retry over the existing `logEnrichment.ts` discovery-service route.

## Visual Design
No visual mockups were provided in `planning/visuals/`. UI shape is constrained by the textual brief and the precedent components (`InfrastructureTerraformImportModal.tsx`, `PreflightModal.tsx`).

## Existing Code to Leverage

**`frontend/src/components/Import/InfrastructureTerraformImportModal.tsx`**
- Canonical multi-file upload pattern: `<input type="file" multiple accept=...>`, `FormData` build, POST without manual `Content-Type`.
- Mirror its selection-list rendering and per-file remove control in the new `LogFileUploadInput`.
- Do NOT reuse the `importInfrastructureTerraform` API (Terraform-specific, posts directly to architecture-model-service).

**`frontend/src/components/Grid/PreflightModal.tsx` and `Grid.tsx`**
- `PreflightModal` is the existing Library-Scan modal triggered by `handleStartLibraryScanFromMenu` (Grid.tsx line 677). Embed the upload section here.
- `handleStartDiscoveryRunFromMenu` (Grid.tsx line 604) is the default-flow trigger that fires immediately with no modal today; insert `StartDiscoveryRunModal` here BEFORE the existing `invokeStartRun` call.
- `startDiscoveryRun` (`gateway/src/services/gatewayClient.ts` line 167) is the run-creation function actually used by Grid; the new upload call is sequenced AFTER its successful return.

**`gateway/src/services/discoveryInsightsService.ts`**
- Reference pattern for "gateway resolves project folder via `fetchProjectFolder`, then writes files into it." The new `discoveryRunLogService.ts` mirrors this shape (mkdir-recursive + writeFile).
- Same module also demonstrates the test-friendly seam where `fs` and `architectureModelClient` are imported at module scope and mocked in Jest tests.

**`gateway/src/routes/discovery.ts`**
- Existing run-start proxy at `POST /projects/:projectId/architectures/:architectureId/runs` (line 106) — leave untouched. The new `/log-files` route is mounted in the same router.
- Existing log-enrichment proxy (line 1546) is unrelated to this spec; it forwards JSON to discovery-service for post-run reprocess and is what Spec 5 will exercise.

**`architecture-model-service/.../DiscoveryRunEntity.java` and surrounding service/controller layer**
- `DiscoveryRunEntity.config_snapshot` (JSONB, `Map<String, Object>`) is the storage target — no schema change needed.
- Existing CRUD service for `DiscoveryRunEntity` provides the load + save pattern; the new PATCH controller method calls into a new service method that mutates the in-memory map and persists.
- `InfrastructureTerraformImportController.java` proves Spring Boot multipart wiring is functional but is NOT reused (it parses in-memory and returns a review; it does not persist files).

## Out of Scope
- Parsing log files, detecting log formats, extracting endpoint call counts, or any log-content interpretation (Spec 5 owns this).
- Matching logs to endpoint / interface / logical-entity candidates (Spec 5).
- Populating any "Log Scans" evidence column or section content beyond run-row status indicators (Spec 6).
- Updating candidate confidence scores, tier labels, or runtime badges (Spec 7).
- Any LLM prompt changes.
- Persistence of raw log content in the database (logs go to disk only; only metadata to JSONB).
- Long-term log retention policy, archival, or cleanup of `discovery-runs/{runId}/logs/` directories.
- Compressed log formats (`.gz`, `.zip`, `.tar`); only the four plain-text extensions in the accept list.
- Server-side log file path input (no "scan a path on the server" mode); browser upload only.
- Drag-and-drop file selection beyond what the native `<input type="file">` provides for free.
- Any change to `runArchitectureRegistry`, discovery-service `runManager`, discovery-service routes, or the existing `logEnrichment.ts` reprocess pathway.
- Any new Liquibase changeset (the JSONB column already exists; no schema migration in this spec).
- Retry / reprocess UI for failed log uploads (Spec 5 will provide; Spec 4 only surfaces failure clearly).
