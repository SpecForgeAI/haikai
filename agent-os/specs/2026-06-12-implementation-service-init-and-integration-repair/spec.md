# Specification: Implementation-Service Init and Integration Repair

## Goal
Re-align Haikai's integration with the external implementation/verification service ("Standards Extractor API", contract: `openapi.json` at repo root) after upstream breaking changes, and add project workspace registration (`POST /projects/init`) with single/poly repo support so the "spec is implemented, verified, git-pushed to a feature branch" flow works end-to-end.

## User Stories
- As a product owner, I want to register my product's repository (or repository map) when creating a project so the implementation service has a cloned workspace ready before I implement anything.
- As a developer using the Implement flow, I want job status, progress, and the resulting feature branch / PR surfaced and persisted so I know exactly what was delivered even after leaving the screen.
- As a project admin, I want to edit the repo map after setup (add, re-point, remove) and have Haikai stay in sync with what the workspace actually has cloned.

## Specific Requirements

**1. Create Project modal: Single/Poly repo selection**
- Add a radio group "Repo: ( ) Single ( ) Poly" to `CreateProjectModal.tsx`.
- Single = the existing mandatory single repo URL text field (unchanged behaviour).
- Poly = a 2-column table (folder, repo URL) starting with 2 rows, with add-row and delete-row controls.
- Folder names must match `^[a-z0-9][a-z0-9._-]*$`, validated client-side.
- Client-side uniqueness enforced on BOTH columns: no duplicate folders, no duplicate URLs (the external contract requires map-wide uniqueness of both).
- Single-repo mode keeps dual-writing `projects.repo_url` (existing `createProject` path) alongside the new repo persistence — do not make the new table the sole source.

**2. Gateway project init call (POST /projects/init)**
- After the Haikai project is created, the gateway calls external `POST /projects/init` with `{company, project, repos}` via `implementationLlmProxyClient` (server-side Bearer; never browser auth).
- `company` = `normalizeIdentifier(organisation name)`, `project` = `normalizeIdentifier(product name)` — existing organisation→company, product→project mapping.
- Send the `repos` map form (folder→url) for both modes; per contract exactly one of `repos`/`repo_url` may be set.
- Init NEVER blocks or fails project creation: the project is created regardless; init success is recorded as a boolean on the project.
- On success, persist the returned per-repo detected modes (greenfield/brownfield), per-repo workspace dirs, overall `mode`, and `project_dir` from `ProjectInitResponse`.
- On failure (upstream all-or-nothing rollback, 400 with `detail`), surface the detail message inline in the modal; the project remains created with init-success = false.

**3. AMS persistence (new Liquibase changeset, 180+)**
- New table `project_implementation_repos`: project FK, folder, git_url, workspace_dir, mode — one row per repo in the map.
- Init-status fields on the project: init-success boolean, overall mode, project_dir (boxed Java types for any PATCH-mutable boolean/numeric fields; null guards in update handlers).
- Work-item fields to persist the implementation git outcome (feature branch / PR URL) from job results (requirement 9).
- New changeset file(s) numbered 180+ only — NEVER edit applied changesets (latest applied is 179).
- Wire format: snake_case default per AMS convention; only apply `@CamelCaseWire` if a consumer needs camelCase (default consumers here are the gateway/frontend snake_case modules, so no annotation expected).
- Extend `ProjectEntity`/`ProjectDto`/`ProjectMapper`/`ProjectService`/`ProjectController` and the relevant work-item entity/DTO stack accordingly.

**4. Dual-mode modal: "Edit project" reuse**
- The SAME `CreateProjectModal` component is reused in an edit mode with title "Edit project".
- In edit mode, project-determined fields (name, organisation, hierarchy, etc.) are read-only; the Repositories section is editable.
- Pre-init existing projects: stored `repo_url` prefills as Single; the user CAN switch to Poly until init succeeds.
- After successful init, the Single/Poly radio disappears — all subsequent repo changes go through repo CRUD (requirement 6).
- Edit mode is also reachable as the "Repositories" home from project settings (per Q1), replacing any need for a separate repo section in `ProjectConfigModal`.

**5. Implementation-screen gate**
- "Product & Delivery → Implementation" is unavailable until init has succeeded for the active project.
- Clicking "Implement" pre-init auto-opens the Edit project modal variant (org/product locked, repos editable) and attempts init on save.
- If init still fails, the Implementation screen loads with a visible error state.
- The gate covers ALL existing projects — no separate backfill job or migration; the modal is the conversion path.
- Gate applies to the `product/implement/:workItemId` route and the Implement tab in `ProductView`.

**6. Post-init repo CRUD + drift sync**
- Wire the external polyrepo CRUD through the gateway: `GET /projects/{company}/{project}/repos` (read map), `POST .../repos` (add), `PUT .../repos/{folder}` (re-point/re-clone), `DELETE .../repos/{folder}` (remove) — all via `implementationLlmProxyClient`, all returning `RepoMapResponse`.
- The Edit project modal's Repositories section loads the current map from the external GET, then applies user changes through the CRUD endpoints.
- Drift handling: the external service is the source of truth for what is cloned. On read, Haikai auto-syncs its stored `project_implementation_repos` map and shows a visible "repo map updated from workspace" notice when it changed.
- No push-upstream repair: Haikai never writes its stored map to the external service to "fix" drift.
- Folder validation and uniqueness rules from requirement 1 apply to add/re-point operations.

**7. Retire legacy orchestration paths**
- Remove gateway `POST /execute` in `gateway/src/routes/orchestrations.ts` (sends `feature_descriptions`, which no longer exists upstream; hardcodes company "Global").
- Retire its LIVE frontend caller: `executeOrchestration(...)` at `ImplementationAssistantPanel.tsx` ~line 2300 must be replaced with the v2 jobs path (or removed if its flow is fully superseded), plus removal of `executeOrchestration` from `orchestrationApi.ts`.
- Remove gateway string-based `POST /v1/orchestrations` proxy (contract now requires `spec_intents` as objects).
- Update/remove associated gateway jest tests and frontend vitest tests for the retired paths.

**8. Single-spec enforcement on v2 jobs + retry bug fix**
- Gateway `POST /v2/jobs/orchestrations` rejects `spec_intents.length > 1` with a clear 400 (and still rejects empty); upstream contract is one spec per job.
- All live frontend callers already send single-element arrays; keep one-at-a-time submission in the UI (current part-based behaviour).
- Fix `handleRetryOrchestration` (`ImplementationAssistantPanel.tsx` ~line 3463): it currently sends the composed part-payload STRING as `spec_name`; it must send the spec FOLDER name, matching the non-retry paths.
- `SpecIntent` shape: `{spec_name, session_id?}`; continue stripping empty `session_id` (existing `startOrchestrationJob` behaviour).

**9. Job poller upgrade + git outcome surfacing/persistence**
- Consume the new `JobDetailResponse` from `GET /api/v2/jobs/{job_id}`: status enum is `queued|running|completed|failed|cancelled` — remove `'pending'` from the `frontend/src/types/part.ts` `JobStatus` union AND the gateway `CreateJobResponse` type docs.
- Widen `pollJobStatus` (`orchestrationApi.ts`) to return `progress` (current_step/total_steps/step_description/percentage), `result`, `logs_url`, `started_at`/`completed_at` instead of only `{status, error}`.
- Surface progress during polling and the git outcome on completion in the Implement flow (`startJobPolling` in `ImplementationAssistantPanel.tsx`), replacing the generic "completed successfully" message.
- Render `result` DEFENSIVELY: it is untyped upstream (`additionalProperties: true`); look for branch / pr_url-like keys but tolerate any shape; exact keys will be confirmed with the upstream developer later, so keep the key-matching logic isolated and easy to adjust.
- Persist the branch/PR outcome onto the AMS work item (requirement 3 fields) so it survives leaving the screen; render it on return.
- Include `logs_url` in the surfaced outcome where present.

**10. Testing conventions**
- Frontend: vitest with the shared `test-utils/renderWithProviders` helper; extend existing `CreateProjectModal*` tests for the dual-mode/Single-Poly behaviour.
- Gateway: jest with the LLM-guard (no live LLM calls in tests) and `testSetup/architectureModelClientMock`; cover init proxy, repo CRUD proxy, multi-spec 400, and poller field pass-through.
- AMS: standard Spring Boot controller/service tests for the new repo table and project/work-item fields.

## Visual Design
No visual assets provided — `planning/visuals/` is empty. UI follows existing `CreateProjectModal.module.css` styling conventions; the Poly table and radio group should match the modal's existing form-field look.

## Existing Code to Leverage

**`frontend/src/components/Project/CreateProjectModal.tsx` (+ `.module.css`, tests in `frontend/src/__tests__/CreateProjectModal*.tsx`)**
- Current Create Product modal with mandatory single `repoUrl` field and organisation autocomplete.
- Becomes the dual-mode Create/Edit component: reuse its org autocomplete, repo field, validation patterns, styles, and tests as the base.
- Calls `createProject(name, undefined, hierarchy, organisationId, repoUrl)` and closes on success — the init call hooks in after this.

**`gateway/src/services/implementationLlmProxyClient.ts`**
- `request(path, opts)` / `postJson` / `getJson` inject `IMPLEMENTATION_LLM_SERVICE_BASE_URL` and the server-side Bearer token.
- ALL new upstream calls (init, repo CRUD, jobs) must go through these helpers; never expose auth to the browser.

**`gateway/src/routes/orchestrations.ts`**
- `POST /execute` (~344-433) and `POST /v1/orchestrations` (~454-603) are the routes to retire.
- `POST /v2/jobs/orchestrations` (~626-773) and `GET /v2/jobs/:job_id` (~792-895) are kept and upgraded (single-spec 400; transparent JobDetailResponse pass-through); follow their existing validation/error-shape patterns for the new init and repo CRUD routes.

**`frontend/src/api/orchestrationApi.ts` + `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`**
- `startOrchestrationJob` already normalises company/project with `normalizeIdentifier` and strips empty `session_id` — reuse for the init payload derivation.
- `startJobPolling` (~3657) polls every 2s and handles completed/failed/cancelled — base for the poller upgrade; company derivation from `activeProject.organisationId` already exists here.
- `pollJobStatus` is the function to widen; `executeOrchestration` is the one to retire.

**`frontend/src/api/projectsApi.ts` + AMS `ProjectEntity`/`ProjectDto`/`ProjectMapper`/`ProjectService` stack**
- `createProject` already sends `repo_url`; `ProjectDto.repoUrl` mapping shows the snake_case wire pattern to follow for the new init-status and repo-map fields.
- `ProjectEntity.repo_url` (nullable, Spec 2026-03-21) is the dual-write target for single-repo mode.

## Out of Scope
- Reconciliation-bug integration with the external service (explicitly a later spec).
- Any separate backfill job/migration for existing projects (the gate modal is the conversion path).
- Automated mechanism to submit multiple specs in sequence automatically (explicitly parked for future discussion; gateway 400 + manual one-at-a-time only).
- Push-upstream drift repair — Haikai never pushes its stored repo map to the external service.
- Making the new repo table the sole source of truth for single-repo mode (`projects.repo_url` dual-write retained).
- Typed modelling of `JobDetailResponse.result` keys (undocumented upstream; defensive rendering only, exact keys adjusted later).
- Editing project-determined fields (name, organisation) in the Edit project modal mode.
- Any changes to discovery, capture, or PM pipeline flows beyond the Implement-flow touchpoints listed above.
