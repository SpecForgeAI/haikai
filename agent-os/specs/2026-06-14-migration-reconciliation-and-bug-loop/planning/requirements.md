# Spec Requirements: Migration Reconciliation + Bug Loop (the Verification back-half) — Spec 4 of 4

## Initial Description

(From `planning/raw-idea.md` — most major product decisions are already LOCKED. This spec is
the FINAL of a 4-spec migration auto-flow program and EXTENDS the build-results door Spec 3 builds.)

After the Migration Execution Driver's FINAL spec deploys (Spec 3's `deployed` build-results
callback), run the automated verification/reconciliation half: replay ALL captured current-state
operations against the deployed target, flag behavioural BREAKS (any differing response), send them
as BUG REPORTS to the external implementation/verification service, and on the fix-redeploy callback
RE-RECONCILE only those breaks — with a CIRCUIT BREAKER (no auto-re-report after one failed round →
human review). Then POST the verdict back to the external service's `/api/v2/reconciliation` to
RELEASE the haibox serve box.

**LOCKED (do NOT re-litigate):** BIG-BANG (one full reconciliation after the final deploy); Haikai
OWNS the replay reconciler (the external service's own `reconcile.py` is their-side fallback, NOT
used in this flow); reconciliation runs only against a DEPLOYED target; per-invocation target
credentials stay our side (never stored); circuit breaker = 1 re-run round then human review;
DEFERRED stories (Spec 3's `deferred` state, CD-7) are EXCLUDED from reconciliation scope; the
verdict-round-trip release POST to the external `/api/v2/reconciliation` releases the haibox box.

> **SUPERSEDED — see Confirmed Decision B.** The "DEFERRED stories … EXCLUDED from reconciliation
> scope" clause above is REVERSED by the user's final decision: reconciliation replays the FULL
> pinned baseline (NO deferred-exclusion); deferred stories correctly surface as breaks and are
> handled by human disposition. Spec 3's CD-7 exclusion is being corrected in parallel.

**OUT OF SCOPE:** spec generation (Spec 1); TEST item creation (Spec 2); the Migrate button + Driver
+ auto-answerer + the build-results DOOR ITSELF (Spec 3 — Spec 4 only EXTENDS it with the
`deployed`/`bug_id` reconcile paths). The external service's bug investigate→fix→redeploy + its CI
verification + haibox deploy are already built on their side.

## Requirements Discussion

### Code-Tracing Findings (established by CODE READING; no app run)

Haikai services only (`gateway/`, `frontend/`, `architecture-model-service/`,
`api-migration-validation-service/`); the repo-root `src/` external Python service was ignored per
instruction. The pinned external contract lives at
`docs/reconciliation-integration/migration-reconciliation-integration.md` +
`migration-reconciliation-integration.openapi.yaml`. Spec 3's `planning/requirements.md` (the door
this spec extends) was read in full; its `CD-*` decisions are authoritative and are referenced below.

#### 1. THE RECONCILER EXISTS AND IS RICH — but it is SESSION-driven, not callback-driven, and it depends on a pre-existing current-state baseline.

The replay-vs-baseline engine is the `api-migration-validation-service` (a TypeScript/Express
service on port 8092, despite the "validation-service" name — NOT Java). The replay engine is
`api-migration-validation-service/src/services/targetReplayRunner.ts` `runTargetReplay(sessionId)`:

- **What it does (already a full reconciler):** loads a target capture SESSION (`kind='target'`,
  `source_baseline_id`, `api_base_url`), loads the SOURCE baseline (`kind='current'`) + its accepted
  `baseline_items`, sets up a per-session axios executor against the target URL with the session's
  in-memory auth, REPLAYS every source item's persisted request (`extractItemRequest` rebuilds
  method/path/query/headers/body from `request_json`), persists each target response as a NEW
  `kind='target'` baseline (auto-accepted), then **AUTO-TRIGGERS the diff engine** (`runDiff`)
  fire-and-forget. Mutating methods are gated (`mutating_calls_confirmed`); HTTP 4xx/5xx are DATA
  (kept, not failures); only transport-level failures count toward a consecutive-failure abort
  (default 10) → `error_message='target_unreachable'`.
- **The diff engine** `diffRunner.ts` `runDiff(diffId)`: pairs source↔target baseline_items by
  `${method}|${path}|${scenarioName}`, classifies each (`status_match`/`status_drift`;
  body via `compareJsonShapes` → `body_match`/`body_shape_drift`/`body_value_drift`;
  `source_only`/`target_only`), persists each as an `api_behaviour_diff_item` row (with
  `body_diff_json`), PATCHes the diff with the count summary, and EMITS a `discovery_finding` per
  drifting item (linked `derived_from` → `api_behaviour_diff_item`). **An `api_behaviour_diff_item`
  IS a "break"** (it already carries operation, source/target status, body diff). The diff row +
  diff_items are the existing "breaks" surface.

- **CURRENT trigger / entry points (the GAP):** the ONLY way to drive a replay today is the
  human-driven SESSION flow:
  - `POST /api-migration-validation/api/target-capture-sessions` (create; server stamps
    `kind='target'`, requires `sourceBaselineId` + `targetApiBaseUrl`),
  - `POST .../target-capture-sessions/:id/secrets` (load auth into in-memory `secretsStore`),
  - `POST .../target-capture-sessions/:id/start` (transition `running`, fire-and-forget
    `runTargetReplay`, returns 202).
  The route handler in `targetCaptureSessionActions.ts` REFUSES to start unless `secretsStore.has`.
  `runTargetReplay` discovers the projectId by scanning `listAllCaptureSessionsByStatus('running')`
  for the session id — i.e. the route handler must have transitioned the session to `running` first.
  There is **NO headless "reconcile against this supplied `target_base_url` with these creds"
  endpoint** and **NO callback-driven entry**. The gateway proxy `apiMigrationValidation.ts`
  exposes only these session/diff/test-connection passthroughs (it does NOT proxy any reconcile
  trigger).
  → **The "exists vs callback-driven" gap is exactly:** (a) a NEW headless invocation that accepts
  `target_base_url` + per-invocation creds + the resolved projectId/architectureId/source-baseline,
  creates+starts a target session server-side, and (b) the wiring from the gateway's `deployed`
  build-results dispatch to that invocation. The replay engine body itself is reusable AS-IS.

- **THE BASELINE DEPENDENCY (probe area 1):** replay REQUIRES a pre-existing
  `kind='current', status='active'` baseline whose `accepted` `baseline_items` ARE the "API
  behaviour baseline" / captured current-state operations. That baseline is produced by a SEPARATE
  current-state capture session (the LLM capture loop in `captureSessionOrchestrator.ts`, run
  earlier against the legacy service) and curated/accepted in `CaptureReviewPanel`. So "replay ALL
  captured current-state operations" presupposes the current-state capture+baseline already happened
  for this project+architecture. **Where the full-reconciliation trigger gets its `source_baseline_id`
  from at `deployed`-callback time is an open decision** (the most recent active `kind='current'`
  baseline for the project+architecture? a baseline id recorded on the migration run at Migrate
  time? selected by the user?).

#### 2. The "breaks" surface ALREADY EXISTS in the frontend (reuse for "show all breaks" + disposition).

`frontend/src/components/DashboardView/DriftReportTab.tsx` renders, for a target baseline's diff:
a counts strip (matched / status drift / body shape drift / body value drift / source-only), a
Stale badge, a sortable/filterable table of `diff_item`s (method, path, scenario, source status,
target status, classification, findings badge), a "View diff" action → `DiffItemDetailModal.tsx`
(source-vs-target side-by-side), a Findings badge → `DiffFindingDetailDrawer.tsx`, and a Recompute
button. The frontend client is `frontend/src/api/apiBehaviourClient.ts` (`getDiffByTargetBaseline`,
`listDiffItems`, `createDiff`, `recomputeDiff`, `getDiffStatus`) + `frontend/src/api/diffFindingsApi.ts`
(`listDiffFindings`, finding PATCH). **This is the "every differing response rendered as a break,
selectable for reporting" surface to EXTEND** — it already shows the operation, replayed request,
current-state expected, target actual, and structured diff. Spec 4 adds: break SELECTION + a "Send
bug report" action + per-break disposition (open/reported/closed/needs-review/disputed) + a
needs-review queue. NOTE the naming convention enforced in that file: UI copy says "drift / Drift
report"; the data + endpoints say "diff". (Raw idea calls them "breaks" — a naming reconciliation
the spec-writer should make explicit: break == drifting `api_behaviour_diff_item`.)

#### 3. There is NO existing bug-report send and NO build-results door anywhere in Haikai.

A repo-wide search (`gateway`, `frontend`, `api-migration-validation-service`,
`architecture-model-service`) for `v2/bugs`, `v2/reconciliation`, `build-results`, `bugReport`
found ZERO matches outside the contract docs. So `POST /api/v2/bugs` (send), `GET /api/v2/bugs/{id}`
(fallback), `POST /api/v2/reconciliation` (verdict release) are all NET-NEW outbound calls, and the
inbound `POST /api/implementation/build-results` door is created by Spec 3 (Spec 4 extends its
dispatch). The outbound seam is `gateway/src/services/implementationLlmProxyClient.ts` `request(path,
{ method, body, … })` — it auto-injects the `IMPLEMENTATION_LLM_SERVICE_BEARER_TOKEN` Bearer and
targets `IMPLEMENTATION_LLM_SERVICE_BASE_URL` (port 8000, config key `implementationLlmServiceBaseUrl`).
The external implementation/verification service is that same upstream (it owns
`/api/v2/jobs/orchestrations`, `/api/v2/bugs`, `/api/v2/reconciliation`). So the bug-report send +
verdict release are server-side `request('/api/v2/bugs', …)` / `request('/api/v2/reconciliation', …)`
calls through the existing authed proxy client — no new transport.

#### 4. The build-results dispatch seam Spec 4 extends.

Spec 3 (its CD/findings, confirmed) creates `POST /api/implementation/build-results` on
`gateway/src/routes/implementationProjects.ts` (mounted `/api/implementation`). Contract
(`BuildResultCallback`): required `{ company, project, outcome }`; exactly one of `job_id`/`bug_id`;
`outcome ∈ {implemented, deployed, failed, rejected}`; `target_base_url` required when
`outcome=deployed`; optional `pr_url`/`summary`; response `202 { acknowledged:true }`. Spec 3 owns
the `job_id` paths; **Spec 4 owns the `bug_id` paths PLUS the `deployed` (no bug_id) → FULL
reconciliation handoff** (Spec 3 only "marks the run deployed and hands off to reconciliation" — the
reconciliation trigger itself is Spec 4). Dispatch rule Spec 4 implements:
- `deployed` + NO `bug_id` (final-spec deploy) → trigger FULL reconciliation against `target_base_url`.
- `bug_id` + `deployed` → SCOPED re-reconciliation of THAT bug's breaks against `target_base_url`.
- `bug_id` + `failed`/`rejected` → route that bug's break(s) to human review (no re-run).
The door is snake_case + camelCase-tolerant (Spec 3 lock). An inbound service-token check (the
contract's `401`) is Spec 3's door concern.

#### 5. Credentials at reconciliation time — the per-invocation pattern is real, but the callback does NOT carry creds (probe area 3).

`secretsStore.ts` is an in-memory, sessionId-keyed bundle: `set`/`get`/`has`/`purge`, NEVER persisted,
NEVER logged, NEVER sent to AMS, purged on terminal status, and `startupReconciliation.ts` marks any
`running` session `failed` on restart because secrets are gone. The replay loads creds via the
session `/secrets` route before `/start`. **The `build-results` `deployed` callback supplies
`target_base_url` (location) but NO credentials** (the contract invariant is explicit: "Location ≠
access. The callback supplies where the target runs; replaying still uses Haikai-side per-project
credentials, same as the capture harness"). So Spec 4 must source the deployed target's creds
per-invocation our side. **Where those creds come from is open:** the migration is fully automated
from a single Migrate click (Spec 3) with no human in the loop at deploy time, yet target creds are
never stored — so either (a) the user supplies target creds ONCE up front (at Migrate, held for the
run), (b) the reconciliation PAUSES and prompts for target creds when the `deployed` callback lands,
or (c) a non-prod target needs no auth (`type:'none'`) for the common like-for-like case.

#### 6. Break → bug-report mapping + the SEND trigger (probe areas 4 + 6).

The contract `CreateBugRequest` is `{ company, project, repo_folder?, bug_type, title,
bug_description, callback_url?, attachments?[] }` with `attachments` recommended to carry
`breaks.json` (an array of `BreakEvidence` = `{ operation, request, expected_response,
actual_response, diff }`). The raw idea says "one report per user-selected BATCH of breaks" and
describes a "show all breaks" review surface — implying a HUMAN-GATED send (review breaks → select a
batch → Send bug report), NOT a fully automatic post-reconciliation send. This is a genuine open
decision: fully-automatic send of every break after reconciliation vs human-reviews-then-sends a
selected batch. (The auto-answerer is auto, but the brief + the existing drift UI strongly suggest
the bug SEND is human-reviewed — the raw idea's "selectable for reporting" wording.) Also open: ONE
bug per break vs ONE bug per selected batch (raw idea = batch; the `bug_description`'s "one entry per
break" narrative and the `breaks.json` array both fit a batch-of-breaks single report).

> **CONTRACT-SHAPE DISCREPANCY FLAG (probe area 2).** The pinned `migration-reconciliation-integration
> .openapi.yaml` `CreateBugRequest` is **snake_case** (`bug_description`, `bug_type`, `callback_url`,
> `repo_folder`). The brief states the EXTERNAL SERVICE'S ACTUAL round-1 `/api/v2/bugs` is
> **camelCase** (`bugDescription`, `bugType`, `callbackUrl`, plus `company`/`project`/`attachments`).
> This mirrors Spec 3's CD-3 finding that the external round-2 service diverged from the on-disk
> contract (there: `callback_url` on the orchestration request). The send-side body shape Haikai
> emits must match the RUNNING external code, not necessarily the on-disk doc. → open decision:
> align the send to camelCase (the running service) and update the pinned contract to match, mirroring
> CD-3's recommendation.
>
> **RESOLVED — see Confirmed Decision 3.** The external service's ROUND-2 code made **snake_case**
> canonical (camelCase accepted as aliases). Bug-send body casing is **snake_case** — which ALSO
> matches the pinned doc, so NO doc change is needed for the bug send (unlike Spec 3's orchestration
> `callback_url`). The round-1 camelCase observation above is obsolete.

#### 7. Break↔bug lifecycle persistence (AMS) + how scoped re-reconciliation finds "that bug's breaks" (probe area 5).

No break↔bug lifecycle table exists. The existing diff/diff_item/finding tables hold the breaks but
have no `bug_id` linkage or report lifecycle. AMS changeset numbering: **180 is the latest APPLIED**;
Spec 1 adds **181**, Spec 3 adds **182** (its `migration_execution_run` + `migration_execution_run_item`
tables), so **Spec 4 adds 183** (coordinate — only 180 is applied, the three siblings are shaped
together). The lifecycle (raw idea + contract Break-lifecycle): `open → reported → (fix_reported →
re-run → closed | reopened→needs-review) | needs-review`, with disposition `closed / needs-review /
disputed`. Open shape decisions: the new table(s) — e.g. a `migration_reconciliation_bug` (bug_id ↔
breaks, status, the round counter for the circuit breaker, the verdict) + a per-break link (bug_id ↔
`api_behaviour_diff_item` id, or a dedicated `reconciliation_break` row that references the diff_item)
— and HOW scoped re-reconciliation resolves "that bug's breaks" back to replayable source operations
(re-replay only those source baseline_items, by the diff_item's `source_baseline_item_id`). AMS
conventions: new Liquibase changeset ONLY; snake_case wire default; boxed Java reference types for any
PATCH-mutable field (`project_primitive_double_dto_overwrite.md`); `@CamelCaseWire` only where a
camelCase consumer exists.

#### 8. The verdict-round-trip release (probe area 7).

`POST /api/v2/reconciliation` ("the verdict-round-trip that RELEASES the haibox box") is NOT in the
pinned openapi.yaml (the doc names only build-results, jobs/orchestrations, bugs, bugs/{id}). Its
request shape is therefore unspecified on-disk and must be defined against the external dev's actual
endpoint. Open: the verdict payload (`{ company, project, status: verified|breaks_found|... }`?
correlation to the original deploy? whether it is sent ONCE after the full reconciliation regardless
of outcome — "release the box" reads as an always-sent gate — or only on a terminal verdict). This
is the step that lets the external service's haibox serving box go live.

#### 9. Replay is in-process + fire-and-forget — restart caveat for the callback-driven flow.

`runManager.ts` tracks live runs in memory with an AbortController; the runner is spawned
fire-and-forget from the `/start` route; `runDiff` likewise. Secrets are in-memory and lost on
restart (`startupReconciliation` fails orphaned `running` sessions). So a callback-driven
reconciliation is an in-memory async run on the validation service; if it crashes mid-run the session
goes `failed` and there is no auto-resume (the human re-enters secrets today). Spec 4 should note
this matches Spec 3's CD-6 posture (idempotent advances, poll-fallback deferred) — the reconciliation
trigger should be idempotent against the break↔bug lifecycle and tolerate a re-fired `deployed`
callback. (Whether a failed/lost reconciliation auto-retries or is surfaced for manual re-kick is a
lower-stakes open point that can follow Spec 3's "manual re-kick" precedent.)

### Existing Code to Reference (for the spec-writer to reuse, not re-derive)

**The reconciler engine (reuse the body; add a headless trigger):**
- `api-migration-validation-service/src/services/targetReplayRunner.ts` — `runTargetReplay(sessionId)`:
  replay-vs-baseline + auto-trigger diff. The engine to drive on the `deployed` callback.
- `api-migration-validation-service/src/services/diffRunner.ts` — `runDiff(diffId)`: the break
  classifier + diff_item + finding emission. A break == a drifting `api_behaviour_diff_item`.
- `api-migration-validation-service/src/services/jsonShapeComparator.ts` — `compareJsonShapes` (the
  structural diff producing `body_diff_json`).
- `api-migration-validation-service/src/routes/targetCaptureSessionActions.ts` — the session
  create/secrets/start lifecycle (the pattern a headless trigger mirrors server-side); the 202
  fire-and-forget spawn.
- `api-migration-validation-service/src/routes/diffActions.ts` — `POST /diffs` / recompute / status /
  cancel (scoped re-reconciliation reuses the recompute/create-diff path).
- `api-migration-validation-service/src/services/secretsStore.ts` — the per-invocation in-memory
  creds pattern (NEVER persisted); `startupReconciliation.ts` — the orphan-on-restart behaviour.
- `api-migration-validation-service/src/services/runManager.ts` + `httpExecutor.ts` — in-flight run
  handle + per-session axios executor (reused unchanged).
- `api-migration-validation-service/src/services/archModelClient.ts` — `BaselineDto`,
  `BaselineItemDto`, `ApiBehaviourDiffDto`, `ApiBehaviourDiffItemDto`, the create/patch/list calls.

**The breaks UI (extend for select → send → disposition):**
- `frontend/src/components/DashboardView/DriftReportTab.tsx` — the breaks table + counts + recompute.
- `frontend/src/components/DashboardView/DiffItemDetailModal.tsx` — source-vs-target break detail.
- `frontend/src/components/DashboardView/DiffFindingDetailDrawer.tsx` — finding disposition drawer
  (the disposition-UI pattern).
- `frontend/src/api/apiBehaviourClient.ts` + `frontend/src/api/diffFindingsApi.ts` — the diff /
  diff-item / finding clients.

**The gateway outbound + dispatch:**
- `gateway/src/services/implementationLlmProxyClient.ts` — `request(...)` authed outbound seam for
  `POST /api/v2/bugs`, `GET /api/v2/bugs/{id}`, `POST /api/v2/reconciliation`.
- `gateway/src/routes/implementationProjects.ts` — Spec 3's build-results door lives here; Spec 4
  extends the dispatch (`deployed`/`bug_id` paths). Also the `company`/`project` → projectId
  resolution idiom + the `request`-proxy error conventions.
- `gateway/src/routes/apiMigrationValidation.ts` — the existing gateway↔validation-service proxy (the
  place a "trigger reconciliation" gateway→validation call would be added, mirroring the diff/target
  proxies).
- `gateway/src/routes/orchestrations.ts` — the `request`-based server-to-server submit pattern
  (Spec 3 CD-3); the model for the outbound bug/verdict calls.

**AMS persistence (new changeset 183):**
- `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` — latest
  registered = 180; the new break↔bug changeset registers AFTER Spec 1's (181) and Spec 3's (182).
- The `api_behaviour_diff` / `api_behaviour_diff_item` / `discovery_finding` tables + their AMS DTOs
  (the existing break data the lifecycle links to).
- Spec 3's `migration_execution_run` / `migration_execution_run_item` (the run the reconciliation +
  bug lifecycle hang off; the deferred-story state CD-7 to honour).
- `MigrationStorySpecGenerationEntity` — the boxed-type / `@Type(JsonType.class)` JSONB idiom to
  mirror for any verdict/evidence JSON column.

**The pinned contract:**
- `docs/reconciliation-integration/migration-reconciliation-integration.md` +
  `migration-reconciliation-integration.openapi.yaml` — BuildResultCallback dispatch table, the
  Break lifecycle, CreateBugRequest/BreakEvidence/BugAttachment, the design invariants. NOTE the two
  drift flags above (CreateBugRequest camelCase-vs-snake_case; `/api/v2/reconciliation` absent).

**Sibling specs (the inputs Spec 4 consumes):**
- `agent-os/specs/2026-06-14-migrate-button-execution-driver-and-shape-spec-auto-answerer/planning/requirements.md`
  (Spec 3 — the door + run-state + CD-7 deferred story state Spec 4 MUST honour + CD-3/CD-6 posture).
- Spec 1 + Spec 2 requirements (the stories/TEST items that became the implemented specs; their
  operations are what reconciliation replays).

### Follow-up Questions
(none yet — first round)

## Visual Assets

### Files Provided
No visual assets provided. Mandatory `ls` of `planning/visuals/` returned no image/PDF files.

### Visual Insights
N/A

## Requirements Summary

### Functional Requirements
- **Extend the build-results dispatch** (`POST /api/implementation/build-results`, Spec 3's door):
  `deployed`+no-`bug_id` → FULL reconciliation; `bug_id`+`deployed` → SCOPED re-reconciliation;
  `bug_id`+`failed`/`rejected` → human review.
- **Full reconciliation trigger**: on the final `deployed` callback, drive the existing reconciler
  (`api-migration-validation-service`) HEADLESSLY against `target_base_url` with per-invocation creds
  — replay ALL accepted current-state baseline_items, structurally diff each vs the current-state
  oracle, record breaks (drifting `api_behaviour_diff_item`s), EXCLUDING deferred stories'
  operations (CD-7). Then POST the verdict to `/api/v2/reconciliation` to release the haibox box.
  *(SUPERSEDED by Confirmed Decision B: the FULL pinned baseline is replayed; there is NO
  deferred-exclusion — deferred stories surface as breaks and are handled by disposition.)*
- **"Show all breaks" review surface** (frontend): every differing response as a break (operation,
  replayed request, current-state expected, target actual, structured diff), selectable — extending
  the existing `DriftReportTab` / `DiffItemDetailModal`.
- **Breaks → bug-report send**: `POST /api/v2/bugs` (per-break prose `bug_description` + optional
  `breaks.json` evidence attachment + Haikai's `callback_url`); persist `bug_id → [break ids]`.
- **Break↔bug lifecycle** (AMS, new Liquibase changeset 183): `open → reported → (fix_reported →
  re-run → closed | reopened→needs-review) | needs-review`; persist bug↔break linkage + the
  circuit-breaker round counter + the verdict.
- **Scoped re-reconciliation**: on the bug-fix `deployed` callback, replay ONLY that bug's breaks'
  source operations against the redeployed target; close on match, reopen on diff.
- **Circuit breaker**: a re-run still differing → do NOT auto-re-report → "needs human review";
  bounded to 1 re-run round. Disposition: closed / needs-review / disputed.
  *(SUPERSEDED by Confirmed Decision A: disposition set ALSO includes "accepted / won't-report".)*
- **Disposition UI** (frontend): break review + disposition + the needs-review queue.

### Reusability Opportunities
- The entire replay+diff+findings engine in `api-migration-validation-service` (add a headless,
  callback-driven trigger; the engine body is reused unchanged).
- The existing breaks UI (`DriftReportTab`, `DiffItemDetailModal`, `DiffFindingDetailDrawer`,
  `apiBehaviourClient`, `diffFindingsApi`) — extend for select/send/disposition.
- The per-invocation in-memory `secretsStore` creds pattern for the deployed target creds.
- `implementationLlmProxyClient.request(...)` for the authed outbound bug/verdict calls.
- Spec 3's build-results door + dispatch seam + run-state + CD-7 deferred state.

### Scope Boundaries
**In Scope:** the `deployed`/`bug_id` dispatch extension; the headless full + scoped reconciliation
trigger; the breaks review + select; the bug-report send + lifecycle persistence (changeset 183);
the circuit breaker; the verdict-round-trip release; the disposition UI.
**Out of Scope:** Spec 1 (spec generation), Spec 2 (TEST items), Spec 3 (the Migrate button, Driver,
auto-answerer, the build-results door itself + its `job_id` paths). The external service's bug
investigate→fix→redeploy, its CI verification, and haibox deploy.
*(NOTE: "the deferred-exclusion" was previously listed In Scope — REMOVED per Confirmed Decision B;
there is no deferred-exclusion logic.)*

### Technical Considerations
- **Reconciler is session-driven, not callback-driven** — the gap is a headless invocation accepting
  a supplied `target_base_url` + creds + resolved projectId/architectureId/source-baseline, plus the
  gateway dispatch→trigger wiring. The replay depends on a pre-existing `kind='current'` baseline
  (probe 1).
- **The callback carries `target_base_url` but no creds** — per-invocation, never-stored creds must
  be sourced our side at reconciliation time (probe 3).
- **Contract drift**: `CreateBugRequest` on-disk is snake_case; the running external service is
  camelCase (probe 2). `POST /api/v2/reconciliation` is absent from the pinned contract (probe 7).
  Mirror Spec 3 CD-3: align to the running service + update the doc.
  *(RESOLVED by Confirmed Decision 3: bug-send is snake_case — matches BOTH the round-2 running
  service and the doc; no doc change for the bug send. The `/api/v2/reconciliation` shape stays a
  contract detail to pin with the external dev — Confirmed Decision 7.)*
- **AMS**: new changeset 183 (after 181/182); snake_case wire; boxed PATCH-mutable types;
  `@CamelCaseWire` only where a camelCase consumer exists.
- **Restart/idempotency**: replay is in-memory fire-and-forget (secrets lost on restart); the trigger
  must be idempotent against the break↔bug lifecycle (mirror Spec 3 CD-6).
- Frontend: vitest + `renderWithProviders`; tsc baseline discipline. Gateway: Jest with the live-LLM
  guard. Validation-service: Jest.

## Confirmed Decisions

*Recorded 2026-06-14. The user reviewed the 8 clarifying questions, CONFIRMED the recommended
defaults, and made TWO critical corrections (A, B) that REVERSE/EXTEND earlier "LOCKED" assumptions.
Where a confirmed decision supersedes research text above, the superseding note is inlined at the
original location and the authoritative wording lives here.*

### CD-1 — BASELINE pinned at Migrate (resolves probe 1)

Spec 3's migration run records the active `kind='current', status='active'` API-behaviour baseline id
**at Migrate time**. Spec 4's full reconciliation replays against **EXACTLY that pinned baseline id**
— NOT "the most recent active `kind='current'` baseline at reconcile time". Migrate
**HARD-BLOCKS** if no active current-state baseline exists at Migrate time (no oracle ⇒ nothing to
reconcile against). The pinned baseline id is read from the migration run record when the `deployed`
callback drives the headless reconciliation.

### CD-2 — TARGET CREDENTIALS captured once at Migrate confirm; never stored (resolves probe 3)

Target-env credentials are captured **once, at the Migrate confirm step** (the user knows the target
env's auth up front; the target URL itself arrives later in the `deployed` callback). They are held in
the validation service's in-memory `secretsStore` **for the run only** — NEVER persisted, NEVER
logged (the existing `secretsStore` invariant). `type:'none'` is allowed for an unauthenticated
target (the common like-for-like non-prod case).
**FALLBACK:** if creds are absent when the `deployed` callback lands (e.g. gateway/validation-service
restart, or a long-running migration that outlives the in-memory store), the run **PAUSES in a "needs
target credentials" state** for the user to re-enter — creds are STILL never stored.

### CD-3 — BUG-SEND body casing = snake_case (resolves probe 2)

The external service's **round-2** code made **snake_case** canonical (camelCase accepted as
aliases). The bug-send (`POST /api/v2/bugs`) body Haikai emits is therefore **snake_case**, which
ALSO matches the pinned on-disk contract — so **NO doc change is needed for the bug send** (this is
unlike Spec 3's orchestration `callback_url`, which did require a doc change). Send `callback_url`
(Haikai's build-results URL) on **every** bug report while the verification service remains external.

### CD-4 — BUG-SEND is HUMAN-GATED (resolves probe 6, send-trigger half)

Reconciliation runs **automatically** on the `deployed` callback and records **all** breaks. The
human then reviews them in the "show all breaks" surface, selects a batch, and clicks **Send** — the
bug report is **NOT auto-fired** after reconciliation.

### CD-5 — ONE bug report per user-selected BATCH (resolves probe 6, granularity half)

One `POST /api/v2/bugs` report per user-selected **batch** of breaks: one prose entry per break inside
the single `bug_description`, plus a `breaks.json` evidence array (the `BreakEvidence[]` attachment).
Persist `bug_id → [break ids]`.

### CD-6 — SCOPED re-reconciliation on the bug-fix redeploy (resolves probe 5, re-run half)

On a `bug_id` + `deployed` callback, replay **ONLY** the specific `source_baseline_item`s behind that
bug's breaks — resolved via each `api_behaviour_diff_item.source_baseline_item_id` — and diff **just
those**. Close the break on match; on a still-differing break, **reopen → needs-review**. The circuit
breaker is **that single round** (no auto-re-report after the one re-run round).

### CD-7 — VERDICT round-trip sent ONCE, always (resolves probe 7)

`POST /api/v2/reconciliation` is sent **ONCE** after the full reconciliation completes,
**REGARDLESS of outcome** (always release the haibox box). It carries the verdict
(`verified` / `breaks_found`) plus the box/cell correlation **taken FROM the `deployed` callback**
(the external service holds the box keyed by cell).
**CONTRACT DETAIL TO PIN:** the exact field shape is NOT on-disk (the endpoint is absent from the
pinned openapi). It must be confirmed with the external developer and modelled on the external
service's `/api/v2/reconciliation` intake (`source` + `findings[{ verdict, cell keys }]`). FLAG: this
contract detail MUST be pinned before the verdict-round-trip sub-task builds.

### CD-8 — LIFECYCLE persistence (AMS changeset 183) (resolves probe 5, persistence half)

A NEW `migration_reconciliation_bug` row carrying:
- `bug_id`,
- `status` ∈ `open → reported → fix_reported → closed` | `needs_review` | `disputed`
  (PLUS the `accepted / won't-report` disposition from CD-A below),
- the circuit-breaker **round counter**,
- the **verdict**,
- an FK to the Spec 3 migration run (**run-scoped**).

PLUS a **thin `bug_id ↔ api_behaviour_diff_item` link** (no break-data duplication — the link only
references existing diff_item rows). New Liquibase **changeset 183** (180 applied; Spec 1 = 181,
Spec 3 = 182). AMS conventions: new changeset only; snake_case wire; boxed PATCH-mutable Java types;
`@CamelCaseWire` only where a camelCase consumer exists.

### CD-A — CRITICAL CORRECTION: reconciliation oracle is CURRENT-STATE, ALWAYS

The reconciler compares each target response to the **current-state** response for the same request;
**ANY deviation is a break**. There is **NO mechanism in v1 to override the expected response**. A
manually-edited spec that *intentionally* changes behaviour — even implemented perfectly — **WILL
show as a break**. This is correct and by design.

**Intentional deviations** (edited specs that change behaviour, OR deferred/unimplemented stories)
are handled by **HUMAN DISPOSITION at the breaks review** — the human marks them
**accepted / won't-report** so they are NOT sent as bugs — **NOT by changing the oracle**.

Add an explicit disposition state **"accepted / won't-report (intentional deviation or deferred)"**
alongside `closed` / `needs-review` / `disputed`. **Accepted breaks are TERMINAL**: not sent, not
re-run. (This SUPERSEDES the research's "disposition: closed / needs-review / disputed" set, which
omitted `accepted / won't-report`.)

### CD-B — CRITICAL CORRECTION: deferred stories are NOT excluded from reconciliation

Reconciliation replays the **FULL pinned baseline** against the target — there is **NO
deferred-exclusion logic**. Deferred stories surface as breaks (correctly) and are handled by the
CD-A disposition (`accepted / won't-report`). **This REVERSES the earlier "LOCKED" decision** (and
Spec 3's CD-7 deferred-exclusion) that deferred stories are excluded from reconciliation scope; Spec 3
is being corrected in parallel. All "EXCLUDING deferred stories" wording in the research above is
therefore obsolete.

### Material-conflict note

The two critical corrections (A, B) DIRECTLY contradict text the research had marked **LOCKED**
(deferred-exclusion) and the research's disposition set (missing `accepted / won't-report`). They are
recorded here as the AUTHORITATIVE final decisions; the contradicted research passages are flagged
inline as SUPERSEDED rather than deleted, to preserve the research trail. The spec-writer MUST treat
CD-A and CD-B as governing. One forward dependency remains **open by design**: the exact
`POST /api/v2/reconciliation` field shape (CD-7) must be pinned with the external developer before
that sub-task builds — this is a contract detail, not an unresolved product decision.
