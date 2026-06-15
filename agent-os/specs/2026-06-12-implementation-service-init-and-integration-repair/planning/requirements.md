# Spec Requirements: Implementation-Service Init and Integration Repair

## Initial Description

Implementation-service generic integration repair + project init workspace registration.

Context: the external implementation/verification service (contract: openapi.json in repo root, "Standards Extractor API") had breaking changes; this spec re-aligns Haikai's integration for the "spec is implemented, verified, git-pushed to a feature branch" flow (reconciliation-bug integration is explicitly OUT of scope, a later spec).

Scope agreed with the user (settled — do not re-open):
1. Create Product modal rework: radio "Repo: ( ) Single ( ) Poly". Single = the existing single repo URL field; Poly = a 2-column table (folder, repo URL), starting with 2 rows, add/delete row controls. On Create, after creating the Haikai project, the gateway calls the external service's POST /projects/init with {company, project, repos} — company = normalised Haikai organisation name, project = normalised product name (existing normalizeIdentifier conventions). Project creation NEVER fails due to init: init success is tracked as a boolean on the Haikai project (plus persisting the returned per-repo detected modes greenfield/brownfield, workspace dirs, project_dir). Init failure (all-or-nothing rollback upstream, 400 with detail) surfaces inline but the project is still created.
2. Implementation-screen gate: "Product & Delivery -> Implementation" is unavailable until init succeeded. If not initialised, entering it forces a variant of the init modal (project-determined values like org/product name locked, repos editable); if init still fails the Implementation screen loads with an error. This also covers all existing projects (no separate backfill).
3. Repo CRUD after init: wire the external service's polyrepo CRUD (GET /projects/{c}/{p}/repos, POST add, PUT re-point/re-clone, DELETE remove) so the repo map is editable post-create, plus a drift check (GET) against Haikai's stored map.
4. Retire the two dead legacy orchestration callers: gateway /execute flow (sends feature_descriptions which no longer exists in OrchestrationRequest; hardcodes company "Global") and the string-based POST /v1/orchestrations proxy (contract now requires spec_intents as objects).
5. Enforce single-spec-only on POST /api/v2/jobs/orchestrations (new contract: one spec per job; serialize or reject multi).
6. Upgrade the job poller (GET /api/v2/jobs/{job_id}): consume the new JobDetailResponse (status enum no longer has 'pending' — now queued|running|completed|failed|cancelled; new fields progress, result, started_at/completed_at, logs_url) and surface the git outcome (feature branch / PR from result) to the user in the Implement flow.

All upstream calls keep going through gateway implementationLlmProxyClient (Bearer auth, IMPLEMENTATION_LLM_SERVICE_BASE_URL). AMS persistence for the repo map likely a new table (project_implementation_repos: folder, git_url, workspace_dir, mode) + init-status fields on project; new Liquibase changeset (never edit applied ones).

## Codebase Research Findings (pre-question analysis)

### External contract (openapi.json, repo root)
- `POST /projects/init` — `ProjectInitRequest {company, project, repos?: {folder->url}, repo_url?: string}`; exactly one of `repos` / `repo_url` must be set; legacy `repo_url` is promoted internally to a one-entry map keyed by the project name. Contract states keys (folders) AND values (URLs) must be unique within the map. Response `ProjectInitResponse {success, message, project_dir, mode ('brownfield'|'greenfield'|'polyrepo'), repos: RepoInitResult[{folder, dir, mode}]}`. All-or-nothing rollback; 400 with detail on any clone failure.
- Polyrepo CRUD: `GET/POST /projects/{company}/{project}/repos`, `PUT/DELETE /projects/{company}/{project}/repos/{folder}`. All return `RepoMapResponse {company, project, repos: {folder->url}}`. `AddRepoRequest {folder, url}`, `UpdateRepoRequest {url}` (PUT re-points/re-clones).
- `POST /api/v2/jobs/orchestrations` — `OrchestrationRequest {company, project, spec_intents: SpecIntent[] (minItems 1), context_files?, options?}`; `SpecIntent {spec_name (spec folder name), session_id?}`. New contract: single spec per job, requires prior init.
- `GET /api/v2/jobs/{job_id}` — `JobDetailResponse {job_id, type, status, company, project, created_at, started_at?, completed_at?, progress?: JobProgress{current_step,total_steps,step_description,percentage}, result?: object (untyped, additionalProperties:true), error?, logs_url?}`. `JobStatus` enum: queued|running|completed|failed|cancelled ('pending' removed). NOTE: `result` is untyped in the contract — the branch/PR key names are NOT documented in openapi.json.

### Gateway
- `gateway/src/services/implementationLlmProxyClient.ts` — `request(path, opts)` injects base URL + server-side Bearer token. All upstream calls go through it.
- `gateway/src/routes/orchestrations.ts`:
  - `POST /execute` (lines ~344-433): legacy; maps handoff_intents -> `feature_descriptions` (field no longer exists upstream), hardcodes `company: "Global"`. To retire.
  - `POST /v1/orchestrations` (lines ~454-603): proxies string-array `spec_intents` (contract now requires objects). To retire.
  - `POST /v2/jobs/orchestrations` (lines ~626-773): keep/upgrade. Currently accepts N spec_intents (validate >=1). Its `CreateJobResponse` type doc still says status 'pending'.
  - `GET /v2/jobs/:job_id` (lines ~792-895): keep/upgrade; forwards transparently.

### Frontend
- `frontend/src/components/Project/CreateProjectModal.tsx` — Create Product modal; mandatory single `repoUrl` text field (Spec 2026-03-21); org autocomplete; calls `createProject(name, undefined, hierarchy, organisationId, repoUrl)`; auto-save runs in background; modal closes immediately on create success. This is the modal to rework (Single/Poly radio).
- `frontend/src/api/projectsApi.ts` — `createProject(..., repoUrl?)` sends `repo_url`; `ProjectDto.repoUrl` mapped from `repo_url`.
- `frontend/src/api/orchestrationApi.ts` — `executeOrchestration` (legacy /execute caller), `startOrchestrationJob` (normalises company/project with `normalizeIdentifier`, strips empty session_id), `pollJobStatus` (returns ONLY `{status, error}` — discards progress/result/logs_url/timestamps).
- `frontend/src/types/part.ts` line 68 — `JobStatus.status` union still includes `'pending'`.
- `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` — the Implement flow:
  - All live `startOrchestrationJob` calls pass a SINGLE-element `[specIntent]` array (lines ~2024, ~2100, ~3463) — multi-intent is not exercised by any live caller.
  - LIVE legacy call: `executeOrchestration({...})` at line ~2300 — the "dead" /execute flow still has a live frontend caller that must be retired with it.
  - BUG vs new contract: `handleRetryOrchestration` (line ~3463) sets `spec_name: specIntent` where `specIntent = composePartPayload(...)` — a multiline composed part-payload STRING, not a spec folder name. The non-retry paths correctly use the shape-spec `folder`.
  - Job polling loop (`startJobPolling`, ~line 3657): polls every 2s, handles completed/failed/cancelled, surfaces only a generic chat message ("Part N implementation completed successfully") — no branch/PR/result display today.
  - Company name derivation: fetches organisation by `activeProject.organisationId`, falls back to literal `'Unknown Organisation'`.
- Routing: `frontend/src/App.tsx` — `product` parent route renders `ProductView` (persistent tab bar Mission/Roadmap/Backlog/Implement); `product/implement/:workItemId` -> `ImplementTab`. The Implementation gate applies here.
- `frontend/src/components/Project/ProjectConfigModal.tsx` — existing project settings modal; currently has NO repo field (superseded as the repo-editing home by Q1's answer: the Create/Edit project modal component is the home for repo editing).
- `frontend/src/utils/normalizeIdentifier.ts` — trim, lowercase, whitespace-runs -> single hyphen.

### AMS (architecture-model-service)
- `ProjectEntity` has nullable `repo_url` column (Spec 2026-03-21); `ProjectDto`/`ProjectMapper`/`ProjectService` carry it. Beyond create/display, `repo_url` has essentially no downstream consumers (frontend: only projectsApi + CreateProjectModal; gateway chatV2 repoUrl usage is a different per-mapping object).
- Liquibase: `architecture-model-service/src/main/resources/db/changelog/sql/` — latest applied changeset is `179-...`; new work = changeset 180+ (NEVER edit applied changesets). PATCH-mutable numeric/boolean fields must be boxed types per project convention.

### Contradictions / repairs found in code (beyond raw idea's list)
1. `ImplementationAssistantPanel.tsx` line ~2300 still calls `executeOrchestration` — the legacy /execute flow is not caller-dead; retiring the route requires retiring/replacing this call path too.
2. `handleRetryOrchestration` sends a composed payload string as `spec_name` (contract requires spec folder name) — needs fixing as part of the v2 jobs repair.
3. `frontend/src/types/part.ts` `JobStatus` union and gateway `CreateJobResponse` doc still carry `'pending'`.
4. `pollJobStatus` discards `progress`, `result`, `logs_url`, `started_at`/`completed_at` — needs widening for scope item 6.

## Requirements Discussion

### First Round Questions

(Asked 2026-06-12 — answered 2026-06-12; all answers FINAL and confirmed by the user.)

**Q1 (repo-map editing home):** Where should post-create repo-map editing (scope item 3 CRUD + drift check) live in the UI? Proposed: a "Repositories" section inside the existing ProjectConfigModal (project settings), with the Implementation screen showing a read-only summary + link.
**Answer:** Post-create repo editing = a "Repositories" section in the existing project settings modal — with an IMPORTANT refinement: the SAME modal component (the Create Project modal) is reused with title "Edit project" (instead of "Create project"). In edit mode, project fields (name, organisation, etc.) become read-only and the repos section is editable. This modal pops automatically when the user clicks "Implement" and POST /projects/init has not yet succeeded. Repos remain editable EVEN AFTER successful init: load the current map via GET /projects/{c}/{p}/repos and apply changes via the PUT (re-point) / POST (add) / DELETE (remove) CRUD endpoints.

**Q2 (drift resolution semantics):** When GET /repos disagrees with Haikai's stored map, which side wins? Proposed: external service is the source of truth for what is actually cloned; Haikai auto-syncs its stored map on read, surfacing a notice.
**Answer:** Agreed — the external service is the source of truth for what is actually cloned. Haikai auto-syncs its stored map on read, with a visible "repo map updated from workspace" notice. No push-upstream repair.

**Q3 (multi-intent enforcement):** Reject >1 spec_intents at the gateway with 400 (no live caller sends multi) vs serialize into N sequential jobs?
**Answer:** Gateway REJECTS `spec_intents.length > 1` with a clear 400. The UI must gracefully handle one-at-a-time submission — when the implement screen breaks a feature into multiple increments (multiple specs), the user submits them one at a time (the current part-based behaviour already does this). EXPLICITLY OUT OF SCOPE / parked for future discussion: an automated mechanism to submit all specs in sequence automatically.

**Q4 (job result keys + persistence):** `result` is untyped in the contract — what keys carry branch/PR? Display defensively? Persist outcome onto the work item in AMS or chat/panel-only?
**Answer:** Render `JobDetailResponse.result` DEFENSIVELY — key names are undocumented upstream; e.g. look for branch/pr_url-like keys but tolerate anything. The user will confirm the exact keys with the other developer later and we adjust. PERSIST the branch/PR outcome onto the AMS work item so it survives leaving the screen.

**Q5 (folder-name validation):** Contract only requires uniqueness of folders and URLs. Charset rule for folder names? Proposed slug rule: must match `^[a-z0-9][a-z0-9._-]*$`, client + gateway enforced.
**Answer:** Confirmed. Folders must match `^[a-z0-9][a-z0-9._-]*$`; client-side uniqueness enforced on BOTH the folder and URL columns.

**Q6 (init-modal variant for pre-feature projects):** Existing project's repo_url prefills as Single — can the user switch to Poly in the forced init modal? Proposed: yes (init hasn't happened); after successful init the radio disappears and changes go through repo CRUD only.
**Answer:** Confirmed ("convert for existing"). The existing `repo_url` prefills as Single; the user CAN switch to Poly until init succeeds; after successful init the Single/Poly radio disappears — all subsequent changes go via repo CRUD.

**Q7 (legacy repo_url column fate):** For new projects, keep writing `projects.repo_url` (single-mode only) alongside the new repo table, or make the new table the single source and leave repo_url as a legacy read-only remnant?
**Answer:** KEEP DUAL-WRITING `projects.repo_url` for single-repo mode for now. Do NOT make the new table the sole source of truth yet.

**Q8 (confirm extra repairs in scope):** Confirm the three code repairs found (retire live executeOrchestration caller at ImplementationAssistantPanel ~2300; fix retry-path spec_name payload bug ~3463; remove 'pending' from frontend/gateway types) are in scope under items 4-6.
**Answer:** All three confirmed in scope: (a) retire /execute including replacing its live caller in `ImplementationAssistantPanel.tsx` (~line 2300); (b) fix `handleRetryOrchestration` (~line 3463) sending payload text as `spec_name` instead of the spec folder name; (c) remove `'pending'` from the frontend job-status union and the gateway `CreateJobResponse` types.

### Existing Code to Reference

**Similar Features Identified (from orchestrator-provided context + code study):**
- Create Product modal: `frontend/src/components/Project/CreateProjectModal.tsx` (+ `CreateProjectModal.module.css`, tests under `frontend/src/__tests__/CreateProjectModal*.tsx`) — per Q1, this component is reused in an "Edit project" mode
- Project settings modal: `frontend/src/components/Project/ProjectConfigModal.tsx`
- Projects API: `frontend/src/api/projectsApi.ts` (`createProject` with `repo_url` since Spec 2026-03-21)
- Orchestration API client: `frontend/src/api/orchestrationApi.ts`; job status type: `frontend/src/types/part.ts`
- Implement flow: `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`, `ImplementTab.tsx`, `ProductView.tsx` (tab bar), route `product/implement/:workItemId` in `frontend/src/App.tsx`
- Gateway upstream client: `gateway/src/services/implementationLlmProxyClient.ts`; routes: `gateway/src/routes/orchestrations.ts`, `gateway/src/routes/shapeSpec.ts`
- AMS: `architecture-model-service/.../model/entity/ProjectEntity.java`, `ProjectController.java`, `ProjectService.java`, `ProjectMapper.java`; Liquibase `db/changelog/sql/` (latest 179)
- Identifier normalisation: `frontend/src/utils/normalizeIdentifier.ts`
- External contract: `openapi.json` at repo root ("Standards Extractor API")

### Follow-up Questions

None required — first-round answers were complete and contained no material conflicts with the codebase research.

## Visual Assets

### Files Provided:

No visual assets provided. `planning/visuals/` checked via filesystem listing on 2026-06-12 (after answers received): empty — consistent with the user's statement.

## Requirements Summary

### Functional Requirements

**1. Create Project modal rework (Single/Poly) + dual-mode "Edit project" reuse**
- Radio "Repo: ( ) Single ( ) Poly". Single = existing single repo URL field. Poly = 2-column table (folder, repo URL) starting with 2 rows, add/delete row controls.
- Folder validation: `^[a-z0-9][a-z0-9._-]*$`; client-side uniqueness on both folder and URL columns.
- On Create: create the Haikai project first, then the gateway calls external `POST /projects/init` with `{company, project, repos}` (company = normalizeIdentifier(organisation name), project = normalizeIdentifier(product name)).
- Init NEVER blocks/fails project creation. Init success tracked as a boolean on the project; persist returned per-repo modes (greenfield/brownfield), workspace dirs, and project_dir. Init failure (upstream all-or-nothing rollback, 400 with detail) surfaces inline.
- The SAME modal component is reused as "Edit project" (title swap): project fields (name, organisation, etc.) read-only; repos editable. Pops automatically when the user clicks "Implement" and init has not yet succeeded.

**2. Implementation-screen gate**
- "Product & Delivery -> Implementation" unavailable until init succeeded. Clicking "Implement" pre-init auto-opens the Edit project modal (org/product locked, repos editable, Single/Poly radio available pre-init). If init still fails, the Implementation screen loads with an error. Covers all existing projects — no separate backfill.
- Pre-init existing projects: stored `repo_url` prefills as Single; user may switch to Poly until init succeeds; post-init the Single/Poly radio disappears.

**3. Post-init repo CRUD + drift sync**
- Post-init, repos remain editable in the Edit project modal's Repositories section: load current map via `GET /projects/{c}/{p}/repos`; changes via `POST` (add), `PUT` (re-point/re-clone), `DELETE` (remove).
- Drift handling: external service is the source of truth for what is cloned. Haikai auto-syncs its stored map on read with a visible "repo map updated from workspace" notice. No push-upstream repair.

**4. Retire legacy orchestration paths**
- Retire gateway `POST /execute` (feature_descriptions / hardcoded "Global") INCLUDING replacing its live caller in `ImplementationAssistantPanel.tsx` ~line 2300.
- Retire gateway string-based `POST /v1/orchestrations` proxy.

**5. Single-spec enforcement on v2 jobs**
- Gateway rejects `spec_intents.length > 1` with a clear 400 on `POST /api/v2/jobs/orchestrations`.
- UI gracefully handles one-at-a-time submission (current part-based behaviour already submits singly).
- Fix `handleRetryOrchestration` (~line 3463): send the spec FOLDER name as `spec_name`, not the composed payload text.

**6. Job poller upgrade + git outcome**
- Consume new `JobDetailResponse`: status enum queued|running|completed|failed|cancelled (remove `'pending'` from `frontend/src/types/part.ts` union AND gateway `CreateJobResponse` types); widen `pollJobStatus` to carry progress, result, logs_url, started_at/completed_at.
- Render `result` DEFENSIVELY (keys undocumented upstream — look for branch/pr_url-like keys but tolerate anything; exact keys to be confirmed with the upstream developer later and adjusted).
- PERSIST the branch/PR outcome onto the AMS work item so it survives leaving the screen.

### Reusability Opportunities
- `CreateProjectModal.tsx` becomes the dual-mode Create/Edit component (Q1) — reuse its org autocomplete, repo field, styles, and existing tests as the base.
- `normalizeIdentifier.ts` for company/project identifiers (already used by `startOrchestrationJob`).
- `implementationLlmProxyClient.ts` for ALL upstream calls (init, repo CRUD, jobs).
- Existing `startOrchestrationJob` / `startJobPolling` flow in `ImplementationAssistantPanel.tsx` as the base for the poller upgrade.

### Scope Boundaries

**In Scope:**
- Items 1-6 above, including the three extra repairs (retire live /execute caller; retry spec_name bug fix; 'pending' removal from frontend + gateway types).
- AMS persistence: new repo-map table + init-status/outcome fields; persistence of branch/PR outcome on the work item.

**Out of Scope:**
- Reconciliation-bug integration (later spec).
- Separate backfill for existing projects (the gate modal covers them).
- Automated mechanism to submit multiple specs in sequence automatically (explicitly parked for future discussion).
- Push-upstream drift repair (Haikai never pushes its stored map to the external service to "fix" drift).
- Making the new repo table the sole source of truth for single-repo mode (dual-write `projects.repo_url` retained for now).

### Technical Considerations
- All upstream calls via gateway `implementationLlmProxyClient` (Bearer auth, `IMPLEMENTATION_LLM_SERVICE_BASE_URL`).
- company = normalizeIdentifier(organisation name); project = normalizeIdentifier(product name).
- AMS persistence: likely new table `project_implementation_repos` (folder, git_url, workspace_dir, mode) + init-status fields on project + work-item fields for branch/PR outcome; new Liquibase changeset 180+ (NEVER edit applied changesets); boxed types for PATCH-mutable numeric/boolean fields.
- Dual-write: single-repo mode keeps writing `projects.repo_url` alongside the new table.
- Folder validation `^[a-z0-9][a-z0-9._-]*$` enforced client-side (uniqueness on folder + URL columns client-side; the external contract also requires map-wide uniqueness of both).
- `JobDetailResponse.result` is untyped upstream (`additionalProperties: true`) — defensive rendering required; key names subject to later confirmation with the upstream developer.
