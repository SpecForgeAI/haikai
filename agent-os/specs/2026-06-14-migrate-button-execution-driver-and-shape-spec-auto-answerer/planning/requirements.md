# Spec Requirements: Migrate Button + Migration Execution Driver + External Shape-Spec Auto-Answerer (Spec 3 of 4)

## Initial Description

(From `planning/raw-idea.md` — most major product decisions are already LOCKED.)

A single "Migrate" button (over a human-reviewed book of work) kicks off the fully-automated
implementation half. The **Migration Execution Driver** — GATEWAY-HOSTED control + AMS
run-state, event-driven, plus a lightweight background-async runner — drives each
implementation-ready spec (stories from Spec 1 + TEST items from Spec 2) through: the external
Software-Developer shape-spec stream WITH an **auto-answerer** answering its questions → an
orchestration job → advance on the build-results `implemented` callback / halt on `failed` →
BIG-BANG: only the FINAL spec sets `deploy_on_complete=true` → on the `deployed` callback, mark
the run deployed and hand off to reconciliation (Spec 4).

**LOCKED (do not re-litigate):** big-bang (deploy on final spec only → one deploy + one
reconciliation); Migrate scope = one book of work; auto-answerer DECIDES + LOGS, never abstains;
GATEWAY-HOSTED (not a separate microservice) + a lightweight background runner; single-spec-
per-orchestration-job (external contract enforces); the build-results contract (snake_case +
camelCase-tolerant, outcome `implemented|deployed|failed|rejected`, per-request `callback_url`,
`target_base_url` on `deployed`); spec/TEST-item ordering (TEST after the children they span).

**OUT OF SCOPE:** spec generation (Spec 1); TEST item creation (Spec 2); the reconciliation
replay + bug-report send + scoped re-reconciliation + circuit breaker (Spec 4 — Spec 4 EXTENDS
the build-results door Spec 3 builds with the `bug_id`/deployed-reconcile paths). The external
service's deploy + build-results emission is already built on their side.

## Requirements Discussion

### Code-Tracing Findings (established by CODE READING; no app run)

Haikai services only (`gateway/`, `frontend/`, `architecture-model-service/`); the repo-root
`src/` external Python service was ignored per instruction. The pinned external contract lives
at `docs/reconciliation-integration/migration-reconciliation-integration.md` +
`migration-reconciliation-integration.openapi.yaml`.

#### 1. THE BIG ONE — can the shape-spec SSE stream be driven server-side from the gateway? YES.

The shape-spec stream is currently a BROWSER-driven SSE (`frontend/src/hooks/useShapeSpecStream.ts`:
`fetch` + `ReadableStream` reader; event union `content` / `questions` / `folder` / `session` /
`done` / `skill_invoked`). The gateway proxy `gateway/src/routes/shapeSpec.ts` (`POST
/api/v2/shape-spec/stream`, mounted at `/api/v2/shape-spec`) is a TRANSPARENT pass-through: it
calls `requestStream(SHAPE_SPEC_STREAM_PATH, { method:'POST', body, signal })` from
`implementationLlmProxyClient.ts` and pipes the upstream `ReadableStream` straight to the client
(`pump()` / `pipe()` path), injecting the upstream Bearer token.

**Crucially, `requestStream` returns a `fetch` `Response` whose `.body` is a `ReadableStream`
that the GATEWAY ALREADY consumes server-side today** (the `pump()` loop in `shapeSpec.ts` reads
`reader.read()` chunk-by-chunk in-process). So a HEADLESS server-side consumer is fully feasible
WITHOUT a new transport: the Driver/auto-answerer can call `requestStream(SHAPE_SPEC_STREAM_PATH,
…)` directly, get the `ReadableStream`, parse `data:` SSE lines in-process (the exact
`parseSSELine` logic the hook uses — strip `data:`, JSON.parse, switch on `type`), and on a
`questions` event compute an answer and RE-POST to the SAME endpoint with `session_mode:'resume'`
(+ the prior `session_id`) to continue the conversation. The browser hook and the gateway proxy
are simply two existing consumers of the same upstream SSE; a third (in-process, headless) one
is the natural extension. **No new upstream transport mechanism is needed** — only an in-gateway
SSE-line parser + the resume re-POST loop.

Open mechanics to settle (Q1): the resume protocol — does answering a `questions` batch mean
re-POSTing ONE combined answer string (numbered, the way the manual UI composes it) or one POST
per question; and how `session_mode:'resume'` + `session_id` are threaded back in (the
`ShapeSpecStreamRequest` body today carries `company`, `project`, `message`, `session_mode?`; the
gateway proxy forwards `session_mode` when present but does NOT forward a `session_id` field — so
session continuity may rely on `session_mode:'resume'` + the server's own session, or a
`session_id` may need adding to the forwarded body).

#### 2. Background/async execution in the gateway TODAY — there is NO worker/queue. Request-scoped only.

The closest analogue, the Spec-1 generator `gateway/src/services/migrationShapeSpecGenerationHandler.ts`
(`runShapeSpecGenerationBatch`), runs **request-scoped + synchronous**: its route
`gateway/src/routes/migrationShapeSpecGeneration.ts` does `const result = await
runShapeSpecGenerationBatch({...}); res.status(200).json(result)` — the HTTP request BLOCKS until
the whole batch finishes (the handler doc itself says "Per-batch processing is SYNCHRONOUS (R-3);
per-batch internal loop is SERIAL (R-4)"). A repo-wide scan for `setInterval` / `BullMQ` / `p-queue`
/ `setImmediate` / fire-and-forget / worker found only storage helpers (`sessionStore.ts`,
`transcriptStore.ts`) — **no job queue, no background worker, no scheduler exists in the gateway**.
This confirms the raw idea's premise: Spec 3 must ADD a "lightweight background-async runner" for
the minutes-long per-spec shape-spec-auto-answer segment, because the Migrate trigger must return
immediately and the run must not be held in a request. Open: in-process detached async (a
fire-and-forget kicked off by the Migrate POST, resumed by each callback) vs a minimal persisted
task table + a tick loop (Q2). The Driver itself is specified as EVENT-DRIVEN over durable AMS
run-state (each callback steps it forward; restart-safe; no long-held in-memory loop) — the
background runner is needed ONLY for the autonomous shape-spec-answer-then-submit segment of one
spec, between "submit this spec" and "orchestration job created".

#### 3. Orchestration handoff — `deploy_on_complete` and the callback are NOT plumbed today.

`frontend/src/api/orchestrationApi.ts` `startOrchestrationJob(company, project, specIntents,
contextFiles)` POSTs `/api/v2/jobs/orchestrations` with `{ company, project, spec_intents,
context_files, options }`. The gateway proxy `gateway/src/routes/orchestrations.ts` validates
EXACTLY ONE spec per job (single-spec contract — Spec 2026-06-12) and forwards `{ company,
project, spec_intents (session_id stripped when empty), context_files, options }`. **Neither the
client nor the proxy sends `deploy_on_complete` today, and neither sends a `callback_url`.** The
external `OrchestrationRequest` schema (openapi.yaml) DOES define `deploy_on_complete: boolean
(default false)` as a NEW field Haikai sets true only on the final spec — so Spec 3 must thread
`deploy_on_complete` through the proxy body (and likely add it to a Driver-side submit call, not
necessarily the browser client). `SpecIntent = { spec_name, session_id? }`; `spec_name` is the
SPEC FOLDER NAME from the shape-spec `folder` event (NOT a payload string). The job response is
`{ job_id, status, created_at }`; status enum `queued|running|completed|failed|cancelled` (no
`pending`). The Driver correlates the returned `job_id` to the run_item.

**`callback_url` is the key contradiction to resolve (Q3).** In the openapi.yaml, `callback_url`
appears ONLY on `CreateBugRequest` (Spec 4's `POST /api/v2/bugs`), annotated *"Transitional only.
While the implementation service is external it may be handed Haikai's build-results URL here;
once in-repo the address is known by config and this field is unused."* The `OrchestrationRequest`
schema has NO `callback_url` field, and the design doc's invariant says *"services address each
other by configured base URL (like gateway ↔ AMS today) rather than … per-project URL tokens."*
So for ORCHESTRATION the external service is expected to know Haikai's build-results URL by its
own config, NOT via a per-request field. The raw idea + the brief both assume a "per-request
`callback_url`" on submit — but the pinned contract does NOT carry one on the orchestration
request. This must be reconciled (add `callback_url` to the orchestration submit anyway as the
transitional belt-and-braces, OR rely on configured base URL and drop the per-request idea).

#### 4. The build-results door does NOT exist yet — Spec 3 creates it on the `/api/implementation` namespace.

`gateway/src/routes/implementationProjects.ts` (mounted at `/api/implementation` in `server.ts`)
today exposes ONLY `POST /projects/init` and the repo-map CRUD (`GET/POST
/projects/:company/:project/repos`, `PUT/DELETE …/repos/:folder`). **There is NO
`POST /api/implementation/build-results` today.** Spec 3 ADDS it to this same router (so the path
resolves to exactly `/api/implementation/build-results`, matching the contract). Contract
(openapi.yaml `BuildResultCallback`): required `{ company, project, outcome }`; exactly one of
`job_id`/`bug_id` present; `outcome ∈ {implemented, deployed, failed, rejected}`; `target_base_url`
required when `outcome=deployed`; optional `pr_url` (human traceability only) + `summary`.
Response is `202 { acknowledged: true }` (`BuildResultAck`). Error codes: `401` (bad token), `404`
(unknown job_id/bug_id for workspace), `422` (neither id present, or deployed without
`target_base_url`). **Dispatch rule (Spec 3 owns the `job_id` paths):** `job_id`+`implemented` →
Driver advance (record `pr_url`, submit next spec); `job_id`+`failed` → Driver HALT + surface;
`job_id`+`deployed` (last spec) → mark run deployed + hand off to Reconciler. Spec 4 EXTENDS the
SAME door with the `bug_id` paths (`bug_id`+`deployed` → scoped re-reconcile; `bug_id`+`failed`/
`rejected` → break needs-human-review). The door must be snake_case + camelCase-tolerant (the
existing implementationProjects routes are snake_case wire). The auth model: the door is an
INBOUND endpoint the external service calls — note the existing gateway has NO inbound bearer-gate
middleware on these proxy routes (auth is OUTBOUND only via `implementationLlmProxyClient`), so
the `401` "Missing or invalid service token" in the contract implies a NEW inbound auth check on
this door (Q open / probe area, but lower-stakes).

#### 5. AMS run-state — new tables `migration_execution_run` + `migration_execution_run_item`; changeset numbering must coordinate.

Latest APPLIED Liquibase changeset = **180** (`180-implementation-init-and-repo-map`, which added
the `work_item` git-outcome columns `implementation_branch` / `implementation_pr_url` /
`implementation_logs_url`, the `project_implementation_repos` table, and the project init-status
columns). **No changeset 181+ exists yet.** Spec 1 (D6) adds a NEW changeset after 180 (its
structured-`tests` JSONB column on `migration_story_spec_generations`); Spec 2 (D7) adds NO
changeset. **Spec 3 adds another changeset (the two run-state tables) and MUST coordinate the
number with Spec 1** — all three sibling specs are being shaped together and only 180 is applied,
so Spec 1 = 181, Spec 3 = 182 (or as agreed) to avoid collision. Run-state shape (raw idea):
`migration_execution_run` (the run over one book of work — progress, current position, halt state,
deployed state, target_base_url, a ref to the auto-answerer decision log) + `migration_execution_run_item`
(per-spec: status, job_id, branch, pr_url, the spec_name/work_item_id, the auto-answerer decision
log ref, sequence position). AMS conventions: snake_case wire default; boxed Java reference types
for any PATCH-mutable field (per `project_primitive_double_dto_overwrite.md` — primitive
`double`/`boolean` silently wipe to 0/false on PATCH); `@CamelCaseWire` only where a camelCase
consumer exists. The Driver advances run-state on each callback (the run_item moves to
implemented/failed/deployed; the run advances `current position` to the next item).

#### 6. The auto-answerer reuse target — the Architect open-phase chassis (PATTERN, not the tools).

`gateway/src/services/architectConversation/openPhaseLoopRunner.ts` is a bounded LLM tool-loop
SIBLING to the preset architect loop. What is genuinely reusable for the auto-answerer is the
**CHASSIS**, not its four domain tools:
- the `ArchitectLlmClient` seam (`callLlmToolLoop`) — the LLM boundary mocked in every test;
- the SAME hard limits: `ARCHITECT_LOOP_ROUND_LIMIT` (5 rounds), `ARCHITECT_LOOP_PER_CALL_TIMEOUT_MS`
  (30s/call), `ARCHITECT_LOOP_WALL_CLOCK_MS` (120s wall) imported from `llmLoopRunner.ts`;
- the `withTimeout` synthetic-timer race + abort handling;
- the structured-result (never-throw) `OpenPhaseLoopResult` failure-to-error mapping;
- `runSingleToolRound(...)` — one bounded `callLlmToolLoop` with `toolChoice` pinned to a tool,
  parse + validate the args → typed payload, all failures as structured results.

The four existing tools (`suggest-candidate-areas` / `propose-options-for-topic` /
`capture-user-decision` / `record-discussion-note`) are architect-domain-specific and do NOT
fit the auto-answerer's task. The auto-answerer needs its OWN tool — given a streamed shape-spec
QUESTION + the implementation-ready spec text + oracle grounding → emit an ANSWER STRING (and a
short rationale), DECIDING (best grounded recommendation), NEVER abstaining (the LOCK). The
grounding assembler `openPhaseGrounding.ts` `buildOpenPhaseGrounding(...)` is a PURE,
side-effect-free composer over already-resolved materials (captured decisions / target-model
summary / product summary / discovery findings). It is the PATTERN to mirror — but the
auto-answerer's grounding sources differ: the spec text itself (the combined `generated_spec_text`
body from Spec 1) is the primary ground, supplemented by the gateway context resolvers
(`gateway/src/services/contextResolvers.ts`) for product/migration goal + discovery findings.
Open (Q4): how the bounded loop maps a question → answer using spec text + grounding, and WHERE
the decision + rationale are logged (a dedicated transcript/decision-log table referenced from
the run_item, vs an inline JSONB column on the run_item).

#### 7. Polling fallback + job-result shape (already in place from the part workflow).

`GET /api/v2/jobs/{job_id}` is already proxied transparently (`orchestrations.ts`,
`JobDetailResponse`: `status / progress / result (untyped) / logs_url / started_at / completed_at
/ error`). The frontend part workflow polls it every 2s (`frontend/src/types/part.ts`,
`pollJobStatus` in `orchestrationApi.ts`). `frontend/src/utils/extractGitOutcome.ts` is the SINGLE
isolated place that defensively reads `branch` / `pr_url` / `logs_url` from the UNTYPED job
`result` (candidate-key BFS, never throws). The reconciliation doc names this poll as the
LOST-CALLBACK FALLBACK for the Driver ("if a build-results callback is lost, Haikai polls GET
/api/v2/jobs/{job_id}"). So the Driver is callback-FIRST with a poll fallback. Open (Q6): whether
v1 implements the poll fallback now or treats it as a Spec-4/later hardening; and the idempotency
guard for a build-results callback that arrives AND is also seen via poll, or arrives twice.

#### 8. The Migrate trigger surface — the Migration Delivery Dashboard + the node DTO ready signals.

The book-of-work-scoped surfaces are `frontend/src/components/ProductManager/MigrationDeliveryDashboard/`
(`MigrationDeliveryDashboard.tsx` + `MigrationDeliveryHierarchyTree.tsx` + the existing
book-of-work-scoped `MigrationDeliveryGenerateAllDialog.tsx` "Generate All" control) and the
plan-authoring `MigrationDeliveryPlan/` wizard. The "Migrate" button + confirm + run-progress
view would mount on the delivery dashboard, modelled on the Generate-All dialog surface (a
book-of-work-scoped action, exactly Migrate's scope). The READY-TO-MIGRATE signals already exist
on `MigrationDeliveryHierarchyNodeDto` per node: `specGenerationStatus` (`generated` /
`generated_with_warnings` / `insufficient_context` / `failed` / null), `specGenerationConfidence`,
`backlogStatus` (`saved` / `not_saved_to_backlog`), `staleReason`
(`target_architecture_changed` / `resolution_reset` / null), `missingInputsCount`, `manuallyEdited`,
`qualityGrade`, plus `workItemId` (presence = saved-to-backlog) and `implementationStatus`. The
ready-predicate composes from these. Open (Q7): the EXACT ready-predicate (which statuses count
as "ready"; how `insufficient_context` / not-generated / stale stories are handled at Migrate time
— skip-and-exclude from the run vs hard-block the button vs warn-and-proceed like Spec 2's
holistic gating).

### Existing Code to Reference (for the spec-writer to reuse, not re-derive)

**Shape-spec stream (drive server-side):**
- `frontend/src/hooks/useShapeSpecStream.ts` — the event union + `parseSSELine` + the
  batch-process-then-`done` discipline + the `session_mode` / `session_id` handling (reuse the
  PARSE logic server-side; the hook is the browser consumer, not the path).
- `gateway/src/routes/shapeSpec.ts` — the existing transparent SSE proxy; shows `requestStream`
  consumed server-side via `pump()`/`pipe()`. The auto-answerer consumes the SAME
  `requestStream(SHAPE_SPEC_STREAM_PATH, …)` in-process.
- `gateway/src/services/implementationLlmProxyClient.ts` — `requestStream` (SSE) + `request`
  (JSON), both auto-inject the upstream Bearer token; the seam for ALL upstream calls.

**Orchestration handoff:**
- `frontend/src/api/orchestrationApi.ts` (`startOrchestrationJob`, `pollJobStatus`, `SpecIntent`)
  + `gateway/src/routes/orchestrations.ts` (`POST /v2/jobs/orchestrations` single-spec proxy + the
  `GET /v2/jobs/:job_id` poll proxy + `JobDetailResponse`). Thread `deploy_on_complete` (and
  possibly `callback_url`) through the proxy body.
- `frontend/src/utils/extractGitOutcome.ts` — defensive untyped-result reader (the lost-callback
  poll fallback path).

**Auto-answerer chassis (the PATTERN):**
- `gateway/src/services/architectConversation/openPhaseLoopRunner.ts` — the bounded tool-loop
  chassis (`ArchitectLlmClient` seam, the `ARCHITECT_LOOP_*` limits, `withTimeout`,
  `runSingleToolRound`, never-throw structured results). Adapt with a NEW answer-the-question tool.
- `gateway/src/services/architectConversation/openPhaseGrounding.ts` (`buildOpenPhaseGrounding`) —
  the PURE grounding-composer pattern. The auto-answerer's grounding is the spec text + product/
  migration goal + findings (different sources, same compose-already-resolved-materials discipline).
- `gateway/src/services/contextResolvers.ts` — the existing context resolvers for grounding
  (product summary, migration discovery context, etc.).
- `gateway/src/services/architectConversation/llmLoopRunner.ts` — exports the `ARCHITECT_LOOP_*`
  constants reused above.

**Build-results door:**
- `gateway/src/routes/implementationProjects.ts` (mounted `/api/implementation`) — ADD `POST
  /build-results` here; reuse its snake_case wire conventions + the `callUpstream` error idiom +
  the AMS-client persistence pattern.
- `docs/reconciliation-integration/migration-reconciliation-integration.md` +
  `migration-reconciliation-integration.openapi.yaml` — the PINNED contract (BuildResultCallback,
  BuildResultAck, OrchestrationRequest incl. `deploy_on_complete`, JobResponse, dispatch table,
  invariants). Spec 4 extends the door's `bug_id` paths.

**AMS run-state:**
- `architecture-model-service/.../db/changelog/db.changelog-master.yaml` (latest applied = 180) —
  the NEW run-state changeset lands here, AFTER Spec 1's (coordinate the number).
- `MigrationStorySpecGenerationEntity.java` + the existing `work_item` git-outcome columns
  (changeset 180) — the entity / boxed-type / `@Type(JsonType.class)` JSONB idiom to mirror.
- `architecture-model-service/.../model/dto/MigrationDeliveryHierarchyNodeDto.java` — the node
  ready-signal fields the Migrate predicate composes from.

**Migrate trigger + progress UI:**
- `frontend/src/components/ProductManager/MigrationDeliveryDashboard/` (`MigrationDeliveryDashboard.tsx`,
  `MigrationDeliveryHierarchyTree.tsx`, `MigrationDeliveryGenerateAllDialog.tsx`) — model the
  Migrate button + confirm + run-progress view on the Generate-All surface (book-of-work-scoped).
- `frontend/src/components/ProductManager/MigrationDeliveryPlan/` — the plan wizard (alternate
  surface; the dashboard is the more likely mount).

**Sibling specs (the inputs Spec 3 consumes):**
- `agent-os/specs/2026-06-14-implementation-ready-migration-spec-generation/planning/requirements.md`
  (Spec 1: D1/D2 write `implement-state.json`; D3 canonical `generated_spec_text` body prefixed
  `/agent-os:shape-spec`; D6 new structured-tests changeset after 180).
- `agent-os/specs/2026-06-14-holistic-integration-e2e-test-work-items/planning/requirements.md`
  (Spec 2: D2 one TEST item per test; D3 BOTH blob item + work_item row; D4 sortOrder after the
  last spanned child; D6 each TEST item gets a `migration_story_spec_generations` row +
  `implement-state.json`; D7 no new changeset).

### Follow-up Questions
(none yet — first round)

## Visual Assets

### Files Provided
No visual assets provided (mandatory `ls` of `planning/visuals/` returned no image/pdf files at
first round).

### Visual Insights
N/A

## Requirements Summary

### Functional Requirements
- **Migrate button** (frontend, on the Migration Delivery Dashboard, book-of-work-scoped) over a
  reviewed book of work, with a ready-to-migrate predicate composed from the node DTO signals
  (`specGenerationStatus` / `backlogStatus` / `staleReason` / `missingInputsCount` / `workItemId` /
  `manuallyEdited`) + a confirm gate. Scope of one Migrate = ONE BOOK OF WORK.
- **Migration Execution Driver** (gateway control + AMS run-state): build the ORDERED sequence of
  the plan's implementation-ready specs — stories, plus TEST items AFTER the children they span.
  Submit ONE spec at a time → feed its combined `generated_spec_text` to the external shape-spec
  stream → answer questions via the auto-answerer → on stream conclusion (`folder`+`session`)
  `startOrchestrationJob` → wait for the build-results callback → `implemented` advances; `failed`
  HALTS; only the FINAL spec carries `deploy_on_complete=true`; the resulting `deployed` callback
  marks the run deployed + hands off to reconciliation (Spec 4). EVENT-DRIVEN over persisted
  run-state (each callback steps the run; no long-held in-memory loop; restart-safe).
- **Lightweight background-async runner** for the autonomous per-spec shape-spec-auto-answer
  segment (minutes-long; not request-driven; gateway-hosted).
- **External shape-spec auto-answerer**: drive the SSE shape-spec stream server-side (consume
  `requestStream` in-process + answer by re-POSTing `session_mode:'resume'`); a bounded LLM loop
  (reuse the architect chassis) grounded by the spec text + oracle context maps each question →
  an answer string; it DECIDES (best grounded recommendation), NEVER abstains, and RECORDS each
  decision + rationale in the run transcript.
- **Build-results receiver + dispatch** (`POST /api/implementation/build-results`, the single
  inbound door): parse `outcome` + `job_id`/`bug_id`, persist, DISPATCH. Spec 3 owns the `job_id`
  paths (implemented→advance / failed→halt / deployed→mark deployed + hand off); `202 { acknowledged }`.
- **Run-state persistence** (AMS new Liquibase changeset, after Spec 1's): `migration_execution_run`
  + `migration_execution_run_item` (per-spec status / job_id / branch / pr_url, run progress,
  current position, halt state, deployed state, target_base_url, the auto-answerer decision-log ref,
  PLUS the pinned current-state API-behaviour baseline id Spec 4 reconciles against — see CD-7).
- **Driver run-progress view** (frontend): show the run advancing through specs (per-spec status,
  current, halted, deployed) + the auto-answer decision log.

### Reusability Opportunities
- `requestStream` server-side consumption (already proven in `shapeSpec.ts`) for the headless
  shape-spec drive; the hook's `parseSSELine` logic for in-gateway SSE parsing.
- The architect open-phase chassis (`openPhaseLoopRunner.ts` + `buildOpenPhaseGrounding` pattern +
  the `ARCHITECT_LOOP_*` limits + `contextResolvers.ts`) for the auto-answerer.
- `startOrchestrationJob` / the `orchestrations.ts` proxy (thread `deploy_on_complete` through);
  `pollJobStatus` + `extractGitOutcome` for the lost-callback poll fallback.
- The `implementationProjects.ts` router (snake_case wire, `callUpstream` error idiom, AMS-client
  persistence) for the new build-results door.
- The `MigrationDeliveryGenerateAllDialog` surface for the Migrate button + confirm + progress view.
- The `MigrationStorySpecGenerationEntity` JSONB/boxed-type idiom for the new run-state tables.

### Scope Boundaries
**In Scope:** the Migrate button + ready-predicate + confirm; the gateway Driver control + AMS
run-state; the background-async runner; the headless shape-spec auto-answerer (bounded loop,
decides+logs, never abstains); the build-results door + the `job_id` dispatch paths; threading
`deploy_on_complete` (big-bang on the final spec) through orchestration; the run-progress view.
**Out of Scope:** Spec 1 (spec generation), Spec 2 (TEST item creation), Spec 4 (reconciliation
replay + bug-report send + scoped re-reconciliation + circuit breaker + the `bug_id` dispatch
paths Spec 4 adds to the same door). The external service's deploy + build-results emission.

### Technical Considerations
- **No existing gateway worker/queue** — Spec 3 introduces the background runner from scratch
  (in-process detached async vs minimal persisted task table + tick — Q2).
- **`callback_url` contradiction** — the pinned `OrchestrationRequest` carries NO `callback_url`
  (only `CreateBugRequest` does, "transitional"); the design invariant is configured-base-URL
  addressing. The brief's per-request-callback_url assumption must be reconciled (Q3).
- **`deploy_on_complete` not plumbed today** — thread it through the orchestration proxy body
  (final spec only) and a Driver-side submit (Q3-adjacent).
- **Changeset numbering** — only 180 applied; coordinate Spec 1 (181) + Spec 3 (182) so the two
  new changesets do not collide.
- **Inbound auth on the build-results door** — the existing `/api/implementation` proxy routes
  have OUTBOUND auth only; the contract's `401` implies a NEW inbound service-token check.
- **Idempotency / restart-safety** — duplicate build-results callbacks (or callback + poll) must
  be idempotent against run-state; the Driver is restart-safe (event-driven over AMS, no in-memory
  loop) but the background auto-answer segment is in-memory while running (Q2/Q6).
- AMS conventions: new Liquibase changeset ONLY; snake_case wire; boxed PATCH-mutable types;
  `@CamelCaseWire` only where a camelCase consumer exists.
- Frontend: vitest + `renderWithProviders`; tsc baseline discipline. Gateway: Jest with the
  live-LLM guard + `architectureModelClientMock` helper.

## Confirmed Decisions

(The 8 clarifying questions were put to the user; the user CONFIRMED all recommendations. These
are the FINAL, authoritative decisions. They supersede the corresponding "Open (Qn)" notes in the
Code-Tracing Findings above. The research sections above are retained as the rationale trail.)

### CD-1 — Shape-spec resume protocol (resolves Q1)
The auto-answerer re-POSTs **ONE combined, numbered answer string** per `questions` batch (mirrors
how the manual UI composes a single answer over the whole batch), with `session_mode:'resume'`.
**No `session_id` is threaded into the shape-spec request body.** The external service holds the
session by **company/project** (server-side session), so `session_mode:'resume'` alone continues
the conversation — matching the gateway proxy today, which forwards `session_mode` but never a
`session_id`. (`session_id` IS captured separately, but only for the orchestration handoff — see
CD-3 / the `SpecIntent.session_id`. It is NOT part of the shape-spec stream resume.)

### CD-2 — Background runner shape (resolves Q2)
The background runner is a **MINIMAL detached in-process async task per spec** — NOT a generic
persisted task table + continuous tick loop. The ONLY in-memory window is a single spec's
`shape-spec-answer → submit-orchestration` segment; **everything across specs is event-driven over
durable AMS run-state** (each build-results callback steps the run forward). PLUS a **boot-time
recovery sweep on gateway startup** that re-kicks any run found stuck mid-shape-spec (i.e. a
run_item whose state is "submitting / answering" with no job_id yet), so a long migration
auto-resumes across gateway restarts. (Net: detached async for the live segment + AMS run-state as
the durable spine + a startup sweep for crash/restart recovery.)

### CD-3 — `callback_url` is NOT a contradiction; the Driver sends it (CORRECTS / resolves Q3)
**IMPORTANT CORRECTION to Code-Tracing Finding #3.** The external service's CURRENT implementation
(their round-2 work) added `callback_url` to its `OrchestrationRequest` and posts build-results to
it. Therefore:
- The Driver **SENDS `callback_url`** (Haikai's build-results URL) **per-request on every
  orchestration submit**.
- The Driver **threads `deploy_on_complete=true` on the FINAL spec ONLY** (big-bang).
- Both are plumbed through a **NEW Driver-side, server-side orchestration submit** (the Driver
  submits server-to-server; not via the browser client). The older "services address each other by
  configured base URL" invariant is the **post-merge future**, NOT v1.
- The Driver **correlates the returned `job_id` to the `run_item`**.

> **MATERIAL CONTRACT-DRIFT FLAG (for the spec-writer / user to reconcile, NOT a blocker):**
> The on-disk pinned contract
> `docs/reconciliation-integration/migration-reconciliation-integration.openapi.yaml` (dated
> 2026-06-13) still defines `callback_url` ONLY on `CreateBugRequest` (line 274); the
> `OrchestrationRequest` schema (lines 210-236) carries `company, project, spec_intents,
> context_files, deploy_on_complete, options` and **has NO `callback_url` field**. The user's
> CD-3 decision (the external round-2 service now accepts `callback_url` on the orchestration
> request) is taken as AUTHORITATIVE over the file, but the pinned openapi.yaml has not yet been
> updated to match. **Recommend the spec-writer add `callback_url` to the `OrchestrationRequest`
> schema in the pinned contract (and the design doc's send-side narrative) as part of Spec 3, so
> the contract and the implementation agree.** This is the one place the FINAL decision diverges
> from the on-disk contract.

### CD-4 — Auto-answerer decision log = inline JSONB column (resolves Q4)
The auto-answerer decision log is an **INLINE JSONB column on `migration_execution_run_item`**
(mirrors the existing `*_json` idiom, e.g. `MigrationStorySpecGenerationEntity`'s
`@Type(JsonType.class)` JSONB columns) — **NOT a separate table**. It holds the per-spec list of
`{ question, chosen answer, rationale }` and is surfaced in the run-progress view.

### CD-5 — Run-sequence ordering source = `book_of_work_json`, walked (depth, sequenceOrder) (resolves Q7-ordering)
The authoritative run-sequence ordering source is the **`book_of_work_json` blob**, walked in
**(depth, sequenceOrder) order**. For each item, resolve its
`migration_story_spec_generations.generated_spec_text` + folder / `spec_name`. **TEST items fall
after their spanned children naturally** (Spec 2 wrote them at `sortOrder` after the last spanned
child), so the walk needs **no special-casing**. `book_of_work_json` is authoritative for order.

### CD-6 — v1 = idempotent run-state advances; poll-fallback DEFERRED (resolves Q6)
v1 build-results dispatch performs **IDEMPOTENT run-state advances**: a duplicate
`implemented` / `deployed` / `failed` callback for an **already-advanced** `run_item` is a
**no-op `202`**. The active **poll-fallback loop (`GET /api/v2/jobs/{job_id}`) is DEFERRED beyond
v1** — callback-first + the boot-time recovery sweep (CD-2) + manual re-kick cover v1.
(The poll-fallback wiring `extractGitOutcome.ts` / `pollJobStatus` is noted for the later
hardening, not built in Spec 3.)

### CD-7 — Not-ready stories at Migrate = HARD-BLOCK + explicit DEFER action + baseline-pinning readiness (resolves Q7-gating)
The Migrate button is a **HARD-BLOCK** (not skip-and-exclude, not warn-and-proceed): it is
**blocked until every IN-SCOPE (non-deferred) story is spec-ready**, where spec-ready =
saved-to-backlog (`workItemId` present / `backlogStatus = saved`) **AND**
`specGenerationStatus ∈ { generated, generated_with_warnings }` **AND not stale**
(`staleReason = null`). When blocked, show a **clear list of exactly what is blocking**.

**The Migrate ready-predicate / hard-block ALSO includes an oracle precondition:** an
**active `kind='current'` API-behaviour baseline MUST exist** for the workspace before Migrate can
run — **you cannot reconcile without an oracle**, so its absence is a HARD-BLOCK alongside the
per-story readiness above. (Added during Spec 4 shaping.)

PLUS an explicit **"DEFER THIS STORY" action**: marks a story **`deferred`** — a deliberate,
**visible** state that **EXCLUDES that story from THIS Migrate run only** (it is NOT built this
run). A deferred story drops out of the in-scope set the hard-block checks, so deferring an
un-generated story is the deliberate, visible way to proceed without it — NOT an auto-skip.
**Deferral is never silent.**

**Deferral does NOT remove the story from reconciliation scope.** A deferred (i.e. unimplemented)
story's operations REMAIN in the reconciliation scope (Spec 4). Because the story was not migrated,
its post-deploy responses WILL differ from current-state, so it **correctly surfaces as a BREAK**
("this wasn't migrated") — this is the desired, truthful signal, **not a false break**. Spec 4
does NOT exclude deferred operations from reconciliation, and does NOT auto-report the resulting
break as a bug; the break is handled by **HUMAN DISPOSITION at the Spec 4 breaks review**
(accept / won't-report). (Net: deferral excludes from the IMPLEMENTATION run only, never from the
reconciliation oracle.)

**Baseline pinning (Spec 3 run-state addition, discovered during Spec 4 shaping):** at Migrate
time the run **RECORDS the active current-state API-behaviour baseline id**, pinned on
`migration_execution_run` (a new column on the run-state table from Finding #5), so **Spec 4
reconciles against EXACTLY that baseline** — the run's behavioural oracle is fixed at kick-off and
does not drift if a newer baseline is captured mid-run.

### CD-8 — No other contract contradiction
Beyond CD-3 (resolved above, with the one flagged on-disk openapi.yaml drift), there is **no other
contradiction with the pinned contract**.

### CD-9 — Changeset numbering (run-state tables)
`migration_execution_run` + `migration_execution_run_item` land in a **NEW Liquibase changeset
AFTER Spec 1's**. Coordinated numbering: **180 is the latest applied**; **Spec 1 adds the next
(181)**; **Spec 3 adds the one after that (182)**. The new run-state changeset is appended to
`architecture-model-service/.../db/changelog/` and registered in `db.changelog-master.yaml` AFTER
Spec 1's, so the two sibling changesets do not collide.

### Visual assets
No visual assets provided. Mandatory `ls` of `planning/visuals/` at finalization returned no
image/PDF files.
