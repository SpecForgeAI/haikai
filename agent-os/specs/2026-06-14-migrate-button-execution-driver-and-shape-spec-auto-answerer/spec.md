# Specification: Migrate Button + Migration Execution Driver + External Shape-Spec Auto-Answerer

## Goal
Add the execution layer that turns a human-reviewed migration book of work into running code: a "Migrate" button that kicks off the whole big-bang run, a gateway-hosted Migration Execution Driver that dispatches each implementation-ready spec to the external implementation/verification service, an auto-answerer that answers the external shape-spec questions without a human, and the inbound build-results door that advances the run.

## User Stories
- As a migration owner, I want a single "Migrate" button over my reviewed book of work so the whole big-bang migration is implemented and deployed automatically once every in-scope story is spec-ready.
- As a migration owner, I want to defer a not-ready story so I can still launch the run, while knowing the deferred story stays in the reconciliation scope and will surface as a break.
- As a migration owner, I want to watch the run advance spec-by-spec (with the auto-answer decisions) so I can see progress, halts, and the final deploy.

## Specific Requirements

**Migrate button + hard-block readiness gate (frontend)**
- Add a "Migrate" button on the Migration Delivery Dashboard, book-of-work-scoped, modelled on `MigrationDeliveryGenerateAllDialog` (confirm dialog + run-progress surface).
- HARD-BLOCK: Migrate is disabled until EVERY in-scope (non-deferred) story is spec-ready, where spec-ready = saved-to-backlog (`workItemId` present / `backlogStatus = saved`) AND `specGenerationStatus ∈ {generated, generated_with_warnings}` AND not stale (`staleReason = null`).
- ALSO hard-block unless an active `kind = 'current'` API-behaviour baseline exists for the workspace (you cannot reconcile without an oracle).
- When blocked, show a clear list of exactly what is blocking (per-story reason + the missing-baseline reason); never silently skip.
- Surface the per-story "defer this story" action and the run-progress view (per-spec status, current, halted, deployed) plus the per-spec auto-answer decision log, all driven from the run-state read API.

**Defer-this-story action (frontend + AMS)**
- Provide an explicit, visible "defer this story" action that marks the story `deferred`; a deferred story drops out of the in-scope set the hard-block checks, so it is the deliberate way to launch without an un-generated story.
- DEFER = implementation-EXCLUSION ONLY: the deferred story is NOT sent for implementation in this Migrate run; deferral never removes it from reconciliation scope (Spec 4 reconciles the full current-state baseline, and a deferred/un-migrated story correctly surfaces there as a break).
- Persist the deferred state on the book item / work item in AMS (boxed type, snake_case wire) so it is durable and readable by the readiness predicate and the run-sequence builder.
- Deferral is per-run scope (excludes from THIS Migrate dispatch set) and is never silent.

**Migrate trigger endpoint + run-sequence build (gateway + AMS)**
- Add a gateway Migrate trigger endpoint (book-of-work-scoped) that validates the hard-block readiness server-side, creates a `migration_execution_run` (status started), records the active `kind='current'` baseline id on the run (baseline pinning — CD-7), and returns immediately (the run must NOT be held in the request).
- Build the ordered run sequence from `book_of_work_json`, walked in (depth, sequenceOrder) order; for each non-deferred item resolve its `migration_story_spec_generations.generated_spec_text` (the edited override wins) + its folder / `spec_name`.
- TEST items (Spec 2 siblings) fall after their spanned children naturally (Spec 2 wrote them at `sortOrder` after the last spanned child) — the walk needs no special-casing; `book_of_work_json` is authoritative for order.
- Create one `migration_execution_run_item` per sequenced spec (status pending, sequence position, `work_item_id`, `spec_name`).
- Kick off the first spec's dispatch via the background runner, then progress event-driven on callbacks.

**Migration Execution Driver — gateway-hosted control over durable AMS run-state**
- The Driver is gateway-hosted (NOT a new microservice); it persists run-state in AMS so it survives a restart (which specs dispatched, their `job_id`, outcome, run status, current position, halt/deployed state, `target_base_url`).
- Progression is EVENT-DRIVEN: each build-results callback steps the run forward (advance the run_item, advance the run position, dispatch the next spec, or on the final spec trigger the deploy). No long-held in-memory loop across specs.
- The ONLY in-memory window is a single spec's shape-spec-answer→submit-orchestration segment (the background runner, below).
- Boot-recovery sweep on gateway startup: reconcile in-flight run-state against reality and re-kick any run found stuck mid-shape-spec (a run_item in submitting/answering with no `job_id` yet), so a long migration auto-resumes across gateway restarts.
- Per-item failure isolation: a `failed` / `rejected` job halts the run and is recorded against the work item; structured logs throughout.

**Background-async runner (gateway)**
- Add a minimal detached in-process async task per spec for the autonomous, minutes-long shape-spec-answer→submit segment (the gateway has no worker/queue today; the Migrate trigger must return immediately).
- NOT a generic persisted task table + continuous tick loop — everything across specs is event-driven over durable AMS run-state.
- On crash/restart, the boot-recovery sweep (above) re-kicks any spec whose run_item is mid-segment with no `job_id`.

**Shape-spec auto-answerer — headless server-side stream drive (gateway)**
- Drive the shape-spec SSE stream server-side: call `requestStream(SHAPE_SPEC_STREAM_PATH, …)` in-process (already proven in `shapeSpec.ts`), parse `data:` SSE lines with the same logic the browser hook uses (`parseSSELine` event union: `content`/`questions`/`folder`/`session`/`done`/`skill_invoked`), feeding the spec's combined `generated_spec_text` as the first message.
- Resume protocol (CD-1): on a `questions` batch, re-POST ONE combined, numbered answer string with `session_mode:'resume'` and NO `session_id` in the body (the external service holds the session by company/project — matching the gateway proxy today). Capture `session_id` separately, only for the orchestration handoff (`SpecIntent.session_id`).
- On stream conclusion (`folder` + `session`), hand the captured `spec_name` (the folder) to the orchestration submit.
- No new upstream transport is needed — only an in-gateway SSE-line parser + the resume re-POST loop.

**Shape-spec auto-answer endpoint + decision logic (gateway)**
- Add a gateway-hosted auto-answer endpoint the Driver/runner calls to answer each shape-spec `questions` batch automatically from the migration context. It DECIDES (best grounded recommendation) and NEVER ABSTAINS (no human-in-the-loop during the automated run — the LOCK).
- Reuse the architect open-phase CHASSIS as the PATTERN (`openPhaseLoopRunner.ts`: the `ArchitectLlmClient` seam, the `ARCHITECT_LOOP_*` limits — 5 rounds / 30s per call / 120s wall — `withTimeout`, `runSingleToolRound`, never-throw structured results). Do NOT reuse its four architect-domain tools.
- Add a NEW single tool: given a streamed shape-spec QUESTION + the implementation-ready spec text + oracle grounding → emit an ANSWER STRING + a short rationale, deciding, never abstaining.
- Grounding is the spec text (the combined `generated_spec_text` body) as the primary ground, supplemented by the gateway context resolvers (`contextResolvers.ts`) for product/migration goal + discovery findings, composed via the pure `buildOpenPhaseGrounding` PATTERN.
- Record each spec's `{ question, chosen answer, rationale }` list in the run_item decision log (inline JSONB — CD-4), surfaced in the run-progress view.

**Orchestration dispatch contract (gateway)**
- Per spec, the Driver submits ONE spec per orchestration job server-to-server (single-spec contract; not via the browser client), POSTing to `/api/v2/jobs/orchestrations` with `spec_intents` (the `spec_name` folder + optional `session_id`), `context_files`, `options`.
- The Driver SENDS `callback_url` (Haikai's build-results URL) per-request on EVERY orchestration submit (CD-3 — the external round-2 service accepts it; the older configured-base-URL invariant is the post-merge future, not v1).
- The Driver threads `deploy_on_complete = true` on the FINAL spec ONLY (big-bang: the external service integrates all specs and deploys once everything is implemented; `target_base_url` comes back on the deployed outcome).
- The Driver correlates the returned `job_id` (from the `{ job_id, status, created_at }` response) to the `run_item`.
- Thread `deploy_on_complete` (and `callback_url`) through a Driver-side submit path; add `callback_url` to the `OrchestrationRequest` schema in the pinned on-disk contract + the design-doc send-side narrative so contract and implementation agree (CD-3 drift flag).

**Build-results receiver + job_id dispatch (gateway)**
- Add `POST /build-results` to `implementationProjectsRouter` (mounted at `/api/implementation`, so the path resolves to `/api/implementation/build-results`, matching the pinned contract). Reuse the router's snake_case wire conventions, `callUpstream` error idiom, and AMS-client persistence pattern; the door is snake_case + camelCase-tolerant.
- Contract (`BuildResultCallback`): required `{ company, project, outcome }`; exactly one of `job_id`/`bug_id`; `outcome ∈ {implemented, deployed, failed, rejected}`; `target_base_url` required when `outcome=deployed`; optional `pr_url` + `summary`. Respond `202 { acknowledged: true }`. Errors: `401` (bad token — NEW inbound service-token check, since these routes have outbound-only auth today), `404` (unknown job_id/bug_id for workspace), `422` (neither id present, or deployed without `target_base_url`).
- Spec 3 owns the `job_id` paths: `job_id`+`implemented` → record `pr_url`, advance, submit next spec; `job_id`+`failed`|`rejected` → halt run + surface (record against the work item); `job_id`+`deployed` (final spec) → mark run deployed + record `target_base_url` + hand off to reconciliation (Spec 4 seam).
- Keep the `bug_id` paths as a clean seam for Spec 4 (do not implement them here).

**Idempotent advances + run-state persistence (gateway + AMS)**
- v1 dispatch performs IDEMPOTENT run-state advances: a duplicate `implemented`/`deployed`/`failed` callback for an already-advanced run_item is a no-op `202` (CD-6).
- The active poll-fallback loop (`GET /api/v2/jobs/{job_id}`) is DEFERRED beyond v1 — callback-first + the boot-recovery sweep + manual re-kick cover v1 (`extractGitOutcome` / `pollJobStatus` are noted for later hardening, not built here).
- Persist run-state in AMS via a NEW Liquibase changeset 182 (181 is Spec 1's, already on disk; 180 applied): `migration_execution_run` (run over one book of work: status, current position, halt state, deployed state, `target_base_url`, the pinned `kind='current'` baseline id, decision-log refs) + `migration_execution_run_item` (per spec: status, `job_id`, branch, `pr_url`, `spec_name`/`work_item_id`, sequence position, inline JSONB auto-answer decision log).
- AMS conventions: register 182 in `db.changelog-master.yaml` after Spec 1's; boxed reference types for every PATCH-mutable field (per `project_primitive_double_dto_overwrite.md`); snake_case wire default; `@CamelCaseWire` only if a camelCase consumer exists.

## Existing Code to Leverage

**`gateway/src/routes/shapeSpec.ts` + `gateway/src/services/implementationLlmProxyClient.ts`**
- `requestStream(SHAPE_SPEC_STREAM_PATH, …)` is already consumed server-side in-process (the `pump()` loop) with the upstream Bearer auto-injected — the auto-answerer consumes the SAME seam headless.
- `request(...)` is the JSON seam for the server-side orchestration submit + the build-results-adjacent calls.

**`frontend/src/hooks/useShapeSpecStream.ts`**
- The SSE event union + `parseSSELine` (strip `data:`, JSON.parse, switch on `type`) + the batch-process-then-`done` discipline + the `session_mode` handling — reuse the PARSE logic server-side; the hook itself is the browser consumer, not the path.

**`gateway/src/routes/orchestrations.ts`**
- `POST /v2/jobs/orchestrations` (single-spec validation + `JobDetailResponse`/`CreateJobResponse` types) is the precedent to thread `deploy_on_complete` + `callback_url` through; `GET /v2/jobs/:job_id` is the deferred poll fallback.

**`gateway/src/services/architectConversation/openPhaseLoopRunner.ts` + `openPhaseGrounding.ts` + `contextResolvers.ts`**
- The bounded LLM tool-loop chassis (`ArchitectLlmClient` seam, `ARCHITECT_LOOP_*` limits, `withTimeout`, `runSingleToolRound`, never-throw structured results) is the PATTERN for the auto-answerer (with a NEW answer-the-question tool); `buildOpenPhaseGrounding` is the pure compose-already-resolved-materials pattern; `contextResolvers.ts` supplies product/migration-goal + discovery findings.

**`gateway/src/routes/implementationProjects.ts` + `docs/reconciliation-integration/`**
- Add `POST /build-results` to this router (snake_case wire, `callUpstream` error idiom, AMS-client persistence). The pinned `migration-reconciliation-integration.md` + `.openapi.yaml` are the agreed contract (BuildResultCallback/Ack, OrchestrationRequest incl. `deploy_on_complete`, JobResponse, the dispatch table); align dispatch/callback shapes to it and add `callback_url` to `OrchestrationRequest` per CD-3.

**`MigrationStorySpecGenerationEntity.java` (changeset 181) + `GeneratedMigrationBookOfWorkEntity.book_of_work_json` + `MigrationDeliveryHierarchyNodeDto.java` + `ApiBehaviourBaselineDto` (`kind='current'`)**
- The `@Type(JsonType.class)` JSONB + boxed-reference-type idiom to mirror for the run-state tables; `book_of_work_json` (per-item `id`/`workItemId`/`sequenceOrder`) is the run-sequence source; the node DTO ready-signal fields compose the Migrate predicate; the `kind='current'` baseline is the pinned oracle. `MigrationDeliveryGenerateAllDialog.tsx` is the book-of-work-scoped surface to model the Migrate button + confirm + progress on.

## Out of Scope
- Migration spec generation and the `generated_spec_text` / `implement-state.json` authoring (Spec 1).
- TEST work-item creation as siblings (Spec 2) — Spec 3 only DISPATCHES the TEST items' specs.
- The reconciliation replay, bug-report send, scoped re-reconciliation, and circuit breaker (Spec 4).
- The `bug_id` dispatch paths on the build-results door (Spec 4 extends the same door) — leave the seam clean.
- The deployed→reconcile loop body beyond marking the run deployed + handing off (Spec 4).
- The external service's deploy and build-results emission (already built on their side).
- The active `GET /api/v2/jobs/{job_id}` poll-fallback loop and `extractGitOutcome` wiring (deferred beyond v1 — CD-6).
- Removing deferred stories from reconciliation scope, or auto-reporting a deferred-story break as a bug (Spec 4 handles the break by human disposition).
- Multi-book / non-big-bang or per-area incremental deploy (Migrate = ONE book of work, deploy on the final spec only).
