# Shaping Notes — Spec 4: Runtime Log Input at Discovery Run Start

## 1. Code-inspection findings

### Frontend — start-run flows

- **Two distinct start-run flows exist on the Services/Libraries grid context menu** (`frontend/src/components/Grid/Grid.tsx`):
  1. **"Start Discovery Run"** — `handleStartDiscoveryRunFromMenu` (line 604). Calls `invokeStartRun` directly. NO modal is shown by default. The only modal that may appear is `StartDiscoveryRunConfirmModal` (line 1149) — but only as a **post-409 retry confirmation** when the backend rejects with `LLM_SOLO_CONFIRMATION_REQUIRED` (Tier C). For Tier A / Tier B runs, the run starts immediately with no upfront modal.
  2. **"Start Discovery Run (Library Scan)"** — `handleStartLibraryScanFromMenu` (line 677). Always opens `PreflightModal` (`frontend/src/components/Grid/PreflightModal.tsx`) — this IS the "Libraries / service library scan modal" the brief refers to. Confirmed exists. The user previews the BFS scan plan + toggles "Include external libraries", then clicks Run.

- **The brief's mental model is slightly off.** It says "if the user starts a discovery run from a service row and the current flow shows the Libraries/service library scan modal, add an Upload Log Files section to that existing modal." In reality:
  - The default "Start Discovery Run" path shows NO modal (just fires).
  - The Library-Scan path always shows `PreflightModal`.
  - The Tier C path shows `StartDiscoveryRunConfirmModal` only on 409 (a confirmation dialog, not a config dialog).

- **`StartDiscoveryRunConfirmModal`** (`frontend/src/components/Grid/StartDiscoveryRunConfirmModal.tsx`) embeds `<ArchitectureRunTargetPicker>` and is shown only after a 409 LLM_SOLO response. It's a "do you really want to proceed" gate, not a setup dialog.

- **Run-start API client**: `createDiscoveryRun` in `frontend/src/api/discoveryApi.ts` (line 511). Signature: `(projectId, architectureId, options?: { confirmLlmSolo?, serviceId? })`. POSTs JSON to `/api/v1/discovery/projects/{projectId}/architectures/{architectureId}/runs` (gateway route).

- **An older `startDiscoveryRun` function exists** in `frontend/src/services/gatewayClient.ts` (line 167) — this is the function `Grid.tsx` actually imports/uses. Hits the same gateway URL.

### Frontend — existing multi-file upload pattern (REUSE TARGET)

- **`frontend/src/components/Import/InfrastructureTerraformImportModal.tsx`** is the canonical multi-file upload modal in the codebase. Pattern:
  - `<input type="file" multiple accept=".tf,.zip" />`
  - Builds `FormData` client-side, POSTs directly to architecture-model-service via `frontend/src/api/modelApi.ts → importInfrastructureTerraform(projectId, architectureId, formData)`.
  - Browser supplies multipart boundary; no manual `Content-Type`.
- **No generic `<FileUploadInput>` reusable component exists.** Spec 4 should either (a) lift a new `<LogFileUploadInput>` from this modal, or (b) inline the same `<input type="file" multiple accept=...>` pattern in the new place.

### Gateway

- **`gateway/src/routes/discovery.ts`** — already has the run-start proxy at `POST /projects/:projectId/architectures/:architectureId/runs` (line 106). JSON body, forwards to discovery-service.
- **No multipart middleware (multer / busboy / formidable) is wired into the gateway.** `package.json` has no such dep. The gateway is JSON-only today.
- **An existing log-enrichment proxy exists** at `POST /projects/:projectId/architectures/:architectureId/runs/:runId/log-enrichment` (line 1546). Forwards JSON to discovery-service `POST /discovery/log-enrichment`. The discovery-service handler accepts EITHER `logFilePath` (server-side path) OR `logContent` (inline string). This is the existing post-run log ingestion path — it is NOT a multipart upload.
- **The Terraform import path bypasses the gateway entirely.** Frontend POSTs `multipart/form-data` directly to architecture-model-service `/api/model/...` (Vite proxy `/api → modelApiTarget:8080` in dev). Production would presumably do the same. So there IS a precedent for "multipart traffic skips the gateway."
- **Gateway has filesystem write access** to the project folder via `fetchProjectFolder(projectId)` in `architectureModelClient.ts`. `discoveryInsightsService.ts` writes to `{projectFolder}/agent-os/insights/`. This pattern IS reusable.

### Discovery service

- **`discovery-service/src/routes/runs.ts`** mounts at `/discovery/projects/:projectId/architectures/:architectureId/runs`. POST creates the run via `archModelClient.createDiscoveryRun(...)` (which hits architecture-model-service), then fires `startRun` async. **The run row is created BEFORE `startRun` returns to the route, so a `runId` is available immediately to the route response.**
- **`runManager.startRun(projectId, runId, architectureId, serviceId?, options?)`** — confirmed signature. `options: StartRunOptions { tier?, doPerformanceRun? }`. Currently no `inputArtifacts` field but trivially extensible.
- **Existing log infrastructure already exists in discovery-service:** `services/logEnrichment.ts`, `services/logExtractors/`, `services/logParsing/`, `services/logEnrichmentMetadata.ts`, `routes/logEnrichment.ts`. **Spec 5 will plug into these.** Spec 4 only needs to land the files where Spec 5 can find them.

### Architecture-model-service / storage

- **`ProjectArtifactController`** (`controller/ProjectArtifactController.java`) is **NOT a generic file artifact store.** It's a versioned markdown-blob store keyed on `(projectId, artifactType ∈ {MISSION_MD, ROADMAP_MD, BACKLOG_MD})`, with content as a `String` column in the DB. NOT suitable for log files. Do not reuse.
- **A multipart-aware controller does exist**: `InfrastructureTerraformImportController` (`controller/InfrastructureTerraformImportController.java`) accepts `multipart/form-data` with `MultipartFile[]`. **But it does NOT persist files to disk** — it parses them in-memory and returns a review result. So this proves Spring Boot multipart is wired (Spring Boot defaults: 1 MB per file, 10 MB total — would need to be raised for log files), but no existing controller actually saves files to a project artifact directory.
- **`DiscoveryRunEntity`** (`model/entity/DiscoveryRunEntity.java`) HAS two existing JSONB columns we can reuse:
  - `config_snapshot` (jsonb, `Map<String, Object>`) — "Immutable snapshot of the Phase 0 discovery config JSON captured at run creation time."
  - `steps_payload` (jsonb, `Map<String, Object>`) — Per-step status tracking.
  - **Recommendation: stash log artifact references under `config_snapshot.inputArtifacts.logFiles[]` at run-creation time.** No schema change needed. Spec 5 reads from there.
- **No `discovery_run.input_artifacts` column exists.** Adding one would require a Liquibase changeset and is unnecessary given the JSONB columns above.

## 2. Recommended timing strategy (autonomous low-stakes call)

**Recommendation: create-run-first → upload-via-run-id-scoped endpoint → discovery-service finalizes association.**

Rationale:
- The discovery-service run-start route synchronously returns a `runId` from `archModelClient.createDiscoveryRun(...)` BEFORE async `startRun` execution begins. So a `runId` is available within ~one round-trip.
- Discovery-service's existing `/discovery/log-enrichment` route already accepts a `logFilePath` referencing a server-side path — same pattern can be used for run-start ingestion.
- Trying to upload to a "pre-run scratch area" before the run exists (alternative) means we'd need a temp-id allocation + later finalize, which is more moving parts and has cleanup risk if the user abandons the modal.
- The "create-run + upload-after" sequence has one risk (spec ACs 13 + 99): "run started but log attachment failed." Failure semantics are a real product question — see Q4 below.

**Storage location (autonomous low-stakes call)**: write logs to `{projectFolder}/discovery-runs/{runId}/logs/{originalFileName}` via the gateway (mirroring `discoveryInsightsService.ts` pattern). The gateway already has `fetchProjectFolder` + `fs.writeFile` plumbing. Discovery-service can later read the same path during Spec 5 because it shares the host filesystem in current deployment topology.

**Multipart routing (autonomous low-stakes call)**: add a NEW gateway route `POST /api/v1/discovery/projects/:projectId/architectures/:architectureId/runs/:runId/log-artifacts` accepting multipart, write files to the project folder, then PATCH the discovery_run.config_snapshot via architecture-model-service (or pass the metadata back to discovery-service which already has an archModel client). Wire `multer` (memory or disk storage) into the gateway. Bypassing the gateway entirely (terraform-style direct-to-arch-model-service) is an alternative but adds a new arch-model-service controller for log persistence — more code.

## 3. Decisions made autonomously (low-stakes)

- **Reuse the multi-file `<input type="file" multiple accept=".log,.txt,.jsonl,.ndjson">` pattern from `InfrastructureTerraformImportModal.tsx`** rather than building a new generic `<FileUploadInput>` component. Lift into `frontend/src/components/Discovery/LogFileUploadInput.tsx` if reuse needed across Preflight + simple modals.
- **Add the upload section to `PreflightModal`** for the Library-Scan path (this satisfies brief case 1 — it IS the Libraries modal).
- **Build a new minimal `StartDiscoveryRunModal` (or extend `StartDiscoveryRunConfirmModal`) for the default "Start Discovery Run" path** — see Q1 + Q6 for the real product call.
- **Stash log refs in `discovery_run.config_snapshot.inputArtifacts.logFiles[]`** — no Liquibase changeset.
- **Add `multer` to the gateway** for the new `/log-artifacts` route. Memory storage, then write to project folder.
- **Validation rules**: client-side reject any file whose extension is not `.log/.txt/.jsonl/.ndjson` (case-insensitive). Server-side double-check by extension. No content sniffing.

## 4. Real product/architecture questions (escalate)

These cannot be defaulted reasonably from the brief alone:

1. **The "default" Start Discovery Run path currently shows no upfront modal at all** — it fires immediately. To add an upload step, we have to introduce a new pre-run modal where none exists today. Should this new modal be **minimal** (just the log-upload section + Start/Cancel + the architecture picker if the project has multiple architectures) **or full** (also include any pre-run options the Library-Scan PreflightModal exposes — e.g. an "include external libraries" toggle if relevant)?
2. **Per-file size cap and total cap** for log uploads. Spring Boot multipart defaults are 1 MB / 10 MB which are too small for runtime logs. Suggest **50 MB per file, 200 MB total**, configurable via env var.
3. **Failure semantics for "run started but log attachment failed"** (AC 13, AC 99). Two options:
   - (a) Roll back the run (delete the discovery_run row) on log-write failure — clean but adds backend complexity.
   - (b) Keep the run, surface a non-blocking warning chip on the run row and an error toast — simpler, but the run runs without logs the user expected to be there.
4. **Where does the log-artifact-reference list live in `discovery_run`?** Options:
   - (a) `config_snapshot.inputArtifacts.logFiles[]` — no schema change; this is my recommended default.
   - (b) `steps_payload._inputs.logFiles[]` — also no schema change but feels semantically wrong (steps_payload is for per-step state).
   - (c) New dedicated `input_artifacts` JSONB column — cleanest model, but requires a Liquibase changeset.
5. **Architecture-model-service write path for log metadata.** Should the gateway's new `/log-artifacts` route call architecture-model-service to PATCH `config_snapshot`, or call discovery-service which then calls architecture-model-service? Ownership question — discovery-service owns the run lifecycle, but the run row is owned by architecture-model-service. Spec 5 will need to read the path back, so wherever it's stored must be retrievable.
6. **Should the user be able to start a run with logs but no other modal options?** In other words: if the user clicks "Start Discovery Run" (not the Library-Scan variant), do they expect a one-section "Upload Log Files (optional)" + Start, OR do they expect the full Library-Scan preview to be folded in too? The brief's case 2 implies a "simple modal" but doesn't say what else (if anything) belongs there.

---

## Resolved decisions (user-confirmed 2026-05-10)

The six clarifying questions raised during shaping have all been resolved by the user. All match the shaper's recommended defaults.

1. **New pre-run modal shape (default flow) → Minimal.**
   The modal contains: the new log-upload section, whatever pre-run context is genuinely required to start the run (architecture picker if it isn't already in scope at the trigger point — verify against the current frontend run-start path before assuming it's needed), and Start / Cancel buttons. **Do NOT copy the Library-Scan / `PreflightModal.tsx` options into this path.** This new modal is the lightest insertion required — easy to skip, log-upload section is the only first-class addition.

2. **File size limits → 50 MB per file, 200 MB total. Both env-configurable.**
   - Per-file cap: 50 MB (initial default), env var name suggestion `LOG_UPLOAD_MAX_FILE_BYTES` or follow existing project env conventions.
   - Total cap (across all files in one upload): 200 MB (initial default), env var name suggestion `LOG_UPLOAD_MAX_TOTAL_BYTES`.
   - Enforce client-side (in the upload UI: reject before submit) AND server-side (in the gateway multer config and again in the architecture-model-service controller).
   - Spring Boot multipart defaults must be raised on the architecture-model-service side (`spring.servlet.multipart.max-file-size`, `spring.servlet.multipart.max-request-size`).

3. **Failure semantics: run started but log attachment failed → Keep run, surface warning chip + toast.**
   - Do NOT roll back the run.
   - Surface a non-blocking warning chip / state on the run row indicating that intended log attachment failed (or partial — `N attached / M intended`).
   - Surface a toast / error message at the time of failure with enough context for the user to retry or proceed.
   - Spec 5 will provide the reprocess pathway; Spec 4 only needs to surface the failure clearly so the user is not silently left without logs.

4. **Storage location of log-artifact references on `discovery_run` → `config_snapshot.inputArtifacts.logFiles[]`.**
   - No new column. No Liquibase changeset for the schema. The existing JSONB `config_snapshot` column is the home.
   - Shape per entry (final field names should follow existing project conventions if any precedent exists; otherwise use these as the locked names):
     ```
     {
       artifactId: string,            // server-assigned id
       originalFileName: string,      // sanitized but recognisable
       sizeBytes: number,
       fileExtension: ".log" | ".txt" | ".jsonl" | ".ndjson",
       contentType: string,           // sniffed or browser-reported
       uploadedAtIso: string,
       relativePath: string           // path relative to the project folder
     }
     ```
   - Location of the file on disk is captured separately in #6; `relativePath` is the bridge so Spec 5 can read the file content given only the run row.

5. **PATCH path: Gateway → Architecture Model Service direct.**
   - The gateway owns the new file-upload endpoint (multer) and, on successful disk write, PATCHes `config_snapshot.inputArtifacts.logFiles[]` on the relevant `discovery_run` via an architecture-model-service endpoint.
   - Discovery-service is NOT involved in Spec 4. Spec 5 will read the references back from the run row.
   - This removes the need for any discovery-service code change in Spec 4 (per memory feedback "no src edits during in-flight run" — keeps discovery-service out of the change set entirely).
   - The architecture-model-service endpoint should be a new narrow PATCH (e.g. `/api/model/projects/{p}/architectures/{a}/discovery/runs/{runId}/input-artifacts/log-files`) that merges the new entries into the existing `config_snapshot.inputArtifacts.logFiles[]` array (idempotent if the same artifactId is re-PATCHed).

6. **On-disk storage path → `{projectFolder}/discovery-runs/{runId}/logs/{sanitizedOriginalFileName}`.**
   - Mirrors the `discoveryInsightsService` project-folder pattern.
   - The gateway already has `fetchProjectFolder()` plumbing.
   - Discovery-service shares the host filesystem in current deployment, so Spec 5 can read directly from the same path.
   - Sanitisation: strip path separators, strip control characters, collapse whitespace to single underscores, preserve the file extension. Disallow files whose sanitised name is empty.
   - On filename collision within the same run (rare — same original name uploaded twice in one go): suffix with ` (2)`, ` (3)`, etc.
   - The `relativePath` written to `config_snapshot` is rooted at the project folder (e.g. `discovery-runs/{runId}/logs/web_access.log`), NOT the absolute path — so the project folder is portable.

---
