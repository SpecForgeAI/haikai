# Task Breakdown: Implementation-Service Init and Integration Repair

## Overview
Total Task Groups: 6

Dependency shape: AMS persistence (Group 1) is the foundation every other group reads/writes through. Gateway integration (Group 2) depends on Group 1 (init result + repo map + work-item outcome persistence targets). Frontend Groups 3-5 depend on Group 2's routes. Group 6 reviews and fills test gaps across the whole feature.

No visual assets — `planning/visuals/` is empty. UI follows existing `CreateProjectModal.module.css` conventions.

## Task List

### AMS Persistence Layer

#### Task Group 1: Liquibase changeset 180+, repo-map table, project init-status fields, work-item outcome fields
**Dependencies:** None

- [x] 1.0 Complete AMS persistence layer
  - [x] 1.1 Write 2-8 focused tests for the new persistence surface
    - Limit to 2-8 highly focused tests maximum (standard Spring Boot controller/service tests)
    - Suggested critical behaviours: (a) project init-status fields round-trip through `ProjectController` GET/PATCH; (b) PATCH omitting init fields does NOT wipe them (boxed-type null-guard semantics); (c) replace-repo-map endpoint persists `project_implementation_repos` rows and returns them snake_case; (d) work-item branch/PR/logs_url outcome fields round-trip via the work-item controller
    - Follow existing controller test patterns in `architecture-model-service/src/test/java/com/example/architecturemodel/controller/`
  - [x] 1.2 Create new Liquibase changeset file(s) numbered 180+
    - Location: `architecture-model-service/src/main/resources/db/changelog/sql/` (latest applied is `179-...` — NEVER edit applied changesets; new files only)
    - New table `project_implementation_repos`: id PK, project FK (indexed, ON DELETE CASCADE), `folder`, `git_url`, `workspace_dir` (nullable), `mode` (nullable) — one row per repo in the map; unique constraint on (project_id, folder)
    - New nullable columns on the project table: init-success boolean, overall mode (text), `project_dir` (text)
    - New nullable columns on the work-item table for the implementation git outcome: feature branch, PR URL, logs URL (text)
  - [x] 1.3 Create `ProjectImplementationRepoEntity` + repository
    - Fields: project association, folder, gitUrl, workspaceDir, mode
    - Follow existing entity patterns (e.g. `ProjectEntity`, `ProjectArtifactEntity`)
  - [x] 1.4 Extend `ProjectEntity`/`ProjectDto`/`ProjectMapper`/`ProjectService`/`ProjectController`
    - Init-status fields: init-success as `Boolean` (BOXED, never primitive — PATCH-mutable; missing JSON must not wipe to false), overall mode, project_dir — null guards in the update handler for every new field
    - DTO carries the repo map (list of {folder, git_url, workspace_dir, mode}) on project reads
    - Endpoint(s) for the gateway to persist init results and replace/sync the stored repo map (drift auto-sync target): a full-map replace operation is sufficient — no per-row CRUD needed in AMS
    - Wire format: snake_case default (NO `@CamelCaseWire` — consumers are the gateway/frontend snake_case modules); follow the existing `ProjectDto.repoUrl`/`repo_url` mapping pattern
    - Do NOT remove or stop honouring `projects.repo_url` — single-repo mode dual-writes it (existing `createProject` path unchanged)
  - [x] 1.5 Extend the work-item entity/DTO/mapper/service/controller stack
    - New PATCH-able fields: implementation feature branch, PR URL, logs URL — all nullable Strings with null guards (absent on PATCH = unchanged)
    - snake_case wire, no annotation needed
  - [x] 1.6 Ensure AMS persistence tests pass
    - Run ONLY the test classes written in 1.1, e.g. `mvn -pl architecture-model-service test -Dtest=ProjectImplementationRepoControllerTest,ProjectInitStatusTest,...` (actual class names as created)
    - Verify the 180+ changeset applies cleanly on the test database
    - Do NOT run the entire AMS test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass
- Changeset 180+ applies cleanly; no applied changeset (≤179) was touched
- PATCH with omitted fields leaves stored init-status/outcome values intact (boxed types + null guards)
- Repo map, init-status, and work-item outcome fields round-trip in snake_case

### Gateway Integration Layer

#### Task Group 2: Init proxy, repo CRUD proxy, single-spec 400, legacy route retirement, poller pass-through
**Dependencies:** Task Group 1

- [x] 2.0 Complete gateway integration layer
  - [x] 2.1 Write 2-8 focused jest tests for the gateway routes
    - Limit to 2-8 highly focused tests maximum; use the LLM-guard (no live LLM calls) and `testSetup/architectureModelClientMock`; mock `implementationLlmProxyClient`
    - Suggested critical behaviours: (a) init route forwards `{company, project, repos}` upstream and persists success fields to AMS; (b) init upstream 400 returns the `detail` message AND the project still records init-success=false (never throws project creation away); (c) `POST /v2/jobs/orchestrations` returns 400 for `spec_intents.length > 1` and for empty; (d) `GET /v2/jobs/:job_id` passes through the full `JobDetailResponse` (progress/result/logs_url/started_at/completed_at); (e) one repo-CRUD route proxies and returns `RepoMapResponse`
  - [x] 2.2 Add project init proxy route
    - New route (in `gateway/src/routes/orchestrations.ts` or a sibling route file following its validation/error-shape patterns) that calls external `POST /projects/init` via `implementationLlmProxyClient.postJson` — server-side Bearer only, never browser auth
    - Request body from the frontend: `{company, project, repos}`; always send the `repos` map form (folder→url) for BOTH single and poly modes (per contract exactly one of `repos`/`repo_url` may be set)
    - On upstream success: persist to AMS via `architectureModelClient` — init-success=true, overall `mode`, `project_dir`, and per-repo rows (folder, url, `dir`→workspace_dir, per-repo `mode`) from `ProjectInitResponse`
    - On upstream failure (all-or-nothing rollback, 400 with `detail`): persist init-success=false and return the `detail` message in the route response so the modal can surface it inline; the route itself returns a non-5xx, well-shaped error payload
    - Gateway-side folder validation: `^[a-z0-9][a-z0-9._-]*$` + uniqueness on both folders and URLs (mirror of client-side rules)
  - [x] 2.3 Add repo CRUD proxy routes
    - `GET /projects/{company}/{project}/repos` (read map), `POST .../repos` (add, `AddRepoRequest {folder, url}`), `PUT .../repos/{folder}` (re-point/re-clone, `UpdateRepoRequest {url}`), `DELETE .../repos/{folder}` — all via `implementationLlmProxyClient`, all returning the upstream `RepoMapResponse {company, project, repos}` to the frontend
    - On every read (GET) AND on every successful mutation response, sync the returned map into AMS `project_implementation_repos` (full-map replace from 1.4) and include a `changed` flag (or before/after map) in the gateway response so the frontend can show the "repo map updated from workspace" notice
    - Never push Haikai's stored map upstream — external service is the source of truth for what is cloned
    - Apply folder validation/uniqueness rules to add and re-point
  - [x] 2.4 Retire legacy orchestration routes
    - Delete `POST /execute` (~lines 344-433 of `gateway/src/routes/orchestrations.ts` — sends `feature_descriptions`, hardcodes company "Global")
    - Delete string-based `POST /v1/orchestrations` proxy (~lines 454-603)
    - Remove/update the associated gateway jest tests for both retired routes
  - [x] 2.5 Enforce single-spec on `POST /v2/jobs/orchestrations`
    - Reject `spec_intents.length > 1` with a clear 400 message (one spec per job per upstream contract); keep rejecting empty
    - Keep `SpecIntent {spec_name, session_id?}` object shape pass-through
  - [x] 2.6 Upgrade `GET /v2/jobs/:job_id` pass-through + type docs
    - Forward the full `JobDetailResponse` transparently: `status` (queued|running|completed|failed|cancelled), `progress {current_step, total_steps, step_description, percentage}`, `result` (untyped — pass through verbatim), `logs_url`, `started_at`, `completed_at`, `error`
    - Remove `'pending'` from the gateway `CreateJobResponse` type/docs
  - [x] 2.7 Ensure gateway layer verification passes
    - `npx tsc --noEmit` in `gateway/` is clean
    - Run ONLY the jest tests written in 2.1 plus the updated/retired-route test files, e.g. `npx jest src/__tests__/<new-and-touched-files>` — do NOT run the entire gateway suite

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass; `npx tsc --noEmit` clean
- Init failure never produces a project-creation failure path; `detail` is surfaced and init-success=false persisted
- `/execute` and `/v1/orchestrations` are gone along with their tests; multi-spec submissions get a clear 400
- Job-detail route forwards progress/result/logs_url/timestamps untouched

### Frontend — Create/Edit Project Modal

#### Task Group 3: Dual-mode CreateProjectModal with Single/Poly repo selection and init call
**Dependencies:** Task Group 2

- [x] 3.0 Complete dual-mode Create/Edit project modal
  - [x] 3.1 Write 2-8 focused vitest tests for the modal
    - Limit to 2-8 highly focused tests maximum; extend the existing `frontend/src/__tests__/CreateProjectModal*.tsx` suites with the shared `test-utils/renderWithProviders` helper
    - Suggested critical behaviours: (a) Poly radio swaps the single URL field for the 2-column table with 2 starting rows + add/delete; (b) invalid folder name and duplicate folder/URL block submit with inline errors; (c) Create succeeds and the modal still reports init failure inline (project created, init-success=false); (d) edit mode prefills stored `repo_url` as Single with name/org read-only; (e) radio is absent in edit mode once init has succeeded
  - [x] 3.2 Add frontend API functions
    - In `frontend/src/api/projectsApi.ts` (or a new `implementationProjectApi.ts`): `initProjectWorkspace(company, project, repos)` calling the Group 2 init route; functions for the repo CRUD routes (used in Group 4); snake_case request/response typing matching the gateway shapes
    - Reuse `normalizeIdentifier` for company (organisation name) and project (product name) derivation, matching `startOrchestrationJob`
  - [x] 3.3 Add the Single/Poly radio + Poly table to `CreateProjectModal.tsx`
    - Radio group "Repo: ( ) Single ( ) Poly"; Single keeps the existing mandatory single repo URL field unchanged
    - Poly = 2-column table (folder, repo URL) starting with 2 rows, add-row and delete-row controls
    - Styling per existing `CreateProjectModal.module.css` form-field conventions (no visual assets provided)
  - [x] 3.4 Implement client-side validation
    - Folder names: `^[a-z0-9][a-z0-9._-]*$`, validated inline per row
    - Uniqueness on BOTH columns: no duplicate folders, no duplicate URLs across the map (single-mode URL needs no uniqueness check)
    - Non-empty URL required per row; clear inline error messaging
  - [x] 3.5 Wire the create flow with never-blocks-create init
    - Create the Haikai project first via the existing `createProject(...)` path; single-repo mode keeps dual-writing `projects.repo_url` (do NOT remove the repoUrl argument)
    - After create succeeds, call init with `{company, project, repos}` — send the repos map form for both modes (single = one-entry map; pick a folder key consistent with the contract's promotion convention, e.g. the normalized project name)
    - Init success: close as today; init failure: keep the modal open enough to surface the upstream `detail` inline, but the project IS created either way — creation must never fail or roll back due to init
  - [x] 3.6 Implement edit mode ("Edit project")
    - Same component, mode prop: title "Edit project"; project-determined fields (name, organisation, hierarchy) read-only; Repositories section editable
    - Pre-init: stored `repo_url` prefills as Single; user CAN switch to Poly until init succeeds; Save attempts init
    - Post-init: Single/Poly radio disappears entirely — the Repositories section becomes the repo-CRUD home (wired in Group 4)
    - Reachable as the "Repositories" home from project settings (replaces any need for a repo section in `ProjectConfigModal`)
  - [x] 3.7 Ensure modal verification passes
    - Run ONLY the vitest files written/extended in 3.1, e.g. `npx vitest run src/__tests__/CreateProjectModal*` — do NOT run the entire frontend suite
    - `npx tsc --noEmit` in `frontend/` introduces no NEW errors versus the pre-change baseline (capture the baseline first; pre-existing failures are known)

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass; tsc baseline unchanged
- Poly table validates slug + dual-column uniqueness client-side
- Project creation never fails due to init; init `detail` surfaces inline
- Edit mode locks project fields, prefills repo_url as Single, hides the radio post-init

### Frontend — Implementation Gate and Repo CRUD

#### Task Group 4: Init gate on the Implement flow + post-init repo CRUD with drift sync
**Dependencies:** Task Groups 2, 3

- [x] 4.0 Complete Implementation gate and repo CRUD wiring
  - [x] 4.1 Write 2-8 focused vitest tests for gate + CRUD behaviour
    - Limit to 2-8 highly focused tests maximum (renderWithProviders; mock the APIs from 3.2)
    - Suggested critical behaviours: (a) clicking Implement pre-init opens the Edit-project modal instead of the screen; (b) successful init from the modal lets the Implementation screen load; (c) continued init failure renders the Implementation error state; (d) drift on GET shows the "repo map updated from workspace" notice
  - [x] 4.2 Implement the init gate
    - Gate on the project's init-success boolean (from the Group 1 project DTO field, available on the active project)
    - Applies to BOTH the `product/implement/:workItemId` route and the Implement tab in `ProductView` ("Product & Delivery → Implementation")
    - Pre-init click on Implement auto-opens the Edit-project modal variant (org/product locked, repos editable, Single/Poly radio available); Save attempts init
    - If init still fails after the modal, the Implementation screen loads with a visible error state (not a blank/silent screen)
    - No backfill: the gate + modal IS the conversion path for all existing projects
  - [x] 4.3 Wire post-init repo CRUD into the edit modal's Repositories section
    - On open (post-init): load the current map from the gateway GET route; render as the editable table (no radio)
    - User changes apply through the CRUD endpoints: add row → POST, re-point URL → PUT `/{folder}`, delete row → DELETE `/{folder}`; each returns the fresh `RepoMapResponse` to re-render from
    - Folder validation + dual-column uniqueness rules from 3.4 apply to add/re-point
  - [x] 4.4 Implement drift auto-sync notice (external-wins)
    - When the gateway GET response indicates the stored map changed (Group 2's `changed` flag), show a visible "repo map updated from workspace" notice in the Repositories section
    - Never offer a push-upstream "repair" action — external service is the source of truth
  - [x] 4.5 Ensure gate/CRUD verification passes
    - Run ONLY the vitest files written in 4.1 — do NOT run the entire frontend suite
    - `npx tsc --noEmit` in `frontend/` introduces no NEW errors versus baseline

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass; tsc baseline unchanged
- Implement is unreachable pre-init on both the route and the tab; modal is the forced path; error state on continued failure
- Repo CRUD round-trips through the gateway and re-renders from `RepoMapResponse`
- Drift surfaces the notice and auto-syncs without any push-upstream option

### Frontend — Implement-Flow Repairs

#### Task Group 5: Retire executeOrchestration, retry bug fix, poller upgrade, git outcome surfacing + persistence
**Dependencies:** Task Groups 1, 2

- [x] 5.0 Complete implement-flow repairs
  - [x] 5.1 Write 2-8 focused vitest tests for the repaired flow
    - Limit to 2-8 highly focused tests maximum
    - Suggested critical behaviours: (a) `pollJobStatus` returns progress/result/logs_url/timestamps (not just `{status, error}`); (b) retry path sends the spec FOLDER name as `spec_name`, not the composed payload string; (c) defensive result rendering extracts branch/pr_url-like keys and tolerates an arbitrary/empty result shape; (d) completion persists the branch/PR/logs_url outcome to the AMS work item
  - [x] 5.2 Retire `executeOrchestration`
    - Replace its LIVE caller at `ImplementationAssistantPanel.tsx` ~line 2300 with the v2 jobs path (`startOrchestrationJob` + `startJobPolling`), or remove the call path entirely if fully superseded by the existing v2 flow — verify which before deleting
    - Remove `executeOrchestration` from `frontend/src/api/orchestrationApi.ts`
    - Remove/update the frontend vitest tests covering the retired path
  - [x] 5.3 Fix `handleRetryOrchestration` spec_name bug (~line 3463)
    - It currently sends the composed part-payload STRING (`composePartPayload(...)` output) as `spec_name`; change it to send the spec FOLDER name, matching the non-retry paths
    - Keep `SpecIntent {spec_name, session_id?}` shape and the existing empty-`session_id` stripping in `startOrchestrationJob`
  - [x] 5.4 Remove `'pending'` from the job-status types
    - `frontend/src/types/part.ts` (~line 68) `JobStatus` union → `queued|running|completed|failed|cancelled`
    - Fix any frontend code/tests that branch on `'pending'` (treat queued as the pre-running state)
  - [x] 5.5 Widen `pollJobStatus` and upgrade `startJobPolling`
    - `pollJobStatus` (`orchestrationApi.ts`) returns `progress {current_step, total_steps, step_description, percentage}`, `result`, `logs_url`, `started_at`, `completed_at` in addition to status/error
    - `startJobPolling` (`ImplementationAssistantPanel.tsx` ~line 3657, 2s interval) surfaces progress during polling (step description / percentage) instead of silence
  - [x] 5.6 Defensive git-outcome rendering on completion
    - Replace the generic "completed successfully" message with the git outcome: scan `result` for branch / pr_url-like keys (e.g. `branch`, `feature_branch`, `pr_url`, `pull_request_url`) but tolerate ANY shape including missing/empty — `result` is untyped upstream (`additionalProperties: true`)
    - Keep the key-matching logic ISOLATED in one small helper function so exact keys can be adjusted easily once confirmed with the upstream developer
    - Include `logs_url` in the surfaced outcome where present
  - [x] 5.7 Persist and re-render the git outcome on the AMS work item
    - On completion, PATCH the extracted branch/PR/logs_url onto the work item via the Group 1 fields (snake_case API call)
    - On returning to the Implement screen, render the persisted outcome from the work item so it survives leaving the screen
  - [x] 5.8 Ensure implement-flow verification passes
    - Run ONLY the vitest files written/updated in 5.1/5.2 — do NOT run the entire frontend suite
    - `npx tsc --noEmit` in `frontend/` introduces no NEW errors versus baseline (the `'pending'` removal must compile clean everywhere)

**Acceptance Criteria:**
- The 2-8 tests written in 5.1 pass; tsc baseline unchanged
- No references to `executeOrchestration` or `'pending'` remain in frontend source
- Retry submits the spec folder name; poller surfaces progress and a defensive git outcome with isolated key-matching
- Branch/PR/logs_url persist to the work item and render on return

### Testing

#### Task Group 6: Test review and gap analysis
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical gaps only
  - [x] 6.1 Review tests from Task Groups 1-5
    - AMS tests (1.1), gateway jest tests (2.1), modal vitest (3.1), gate/CRUD vitest (4.1), implement-flow vitest (5.1)
    - Total existing tests: approximately 10-40
  - [x] 6.2 Analyze coverage gaps for THIS feature only
    - Focus on the end-to-end workflow: create-poly project → init succeeds → gate opens → implement job submitted → multi-spec rejected with 400 → job completes → git outcome rendered and persisted → outcome survives screen re-entry
    - Also check: init-failure path leaves a usable created project + working forced-modal conversion; drift sync round-trip (gateway sync → AMS map replace → frontend notice)
    - Do NOT assess whole-application coverage; ignore the known pre-existing failing suites (they are not regressions)
  - [x] 6.3 Write up to 10 additional strategic tests maximum
    - Prioritise cross-layer integration seams the per-group tests could not cover: gateway init route → AMS persistence shape; frontend single-mode init payload (one-entry repos map + dual-written repo_url); work-item outcome PATCH → re-render
    - Skip edge cases, performance, and accessibility tests unless business-critical
  - [x] 6.4 Run feature-specific tests only
    - AMS: `mvn -pl architecture-model-service test -Dtest=<feature test classes>`
    - Gateway: `npx tsc --noEmit` + `npx jest <feature test files>`
    - Frontend: `npx tsc --noEmit` (baseline discipline) + `npx vitest run <feature test files>`
    - Expected total: approximately 20-50 tests; do NOT run the entire suites

**Acceptance Criteria:**
- All feature-specific tests pass across the three stacks
- The end-to-end create→init→gate→implement→outcome-persisted workflow is covered
- No more than 10 additional tests added
- Both tsc checks clean / at baseline

## Execution Order

1. AMS Persistence Layer (Task Group 1)
2. Gateway Integration Layer (Task Group 2)
3. Frontend Create/Edit Project Modal (Task Group 3)
4. Frontend Implementation Gate + Repo CRUD (Task Group 4)
5. Frontend Implement-Flow Repairs (Task Group 5) — depends only on Groups 1-2, so it may run in parallel with Groups 3-4 if staffing allows
6. Test Review & Gap Analysis (Task Group 6)
