# Spec Requirements: Oracle Coverage Scoring

## Initial Description

(From `planning/raw-idea.md`.)

Oracle coverage scoring — a single shared rubric that BOTH drives LLM scenario
generation AND scores baseline completeness (in the
`api-migration-validation-service` capture layer), plus one new AMS field to
persist the coverage summary, plus frontend surfacing, INCLUDING project-wide
auth-negative coverage.

Problem: the capture service now generates thorough per-endpoint scenarios
(Phase 1: `defaultScenarioSet` — happy_path / not_found / one-per-enum-value /
filter-combo / bad_request) and keeps only the canonical capture per intended
outcome (Phase 2: `selectCanonicalCapture` + reject-and-hide of fumbles), but
NOTHING MEASURES how much of each endpoint's behaviour the baseline actually
pins. A "green" reconcile is only trustworthy if you know the oracle is
thorough. Today there is no coverage score, no per-dimension achieved/missed
visibility, and no project-wide auth-negative coverage.

This is Spec A of a 3-spec series (A = coverage scoring, B = full-response
reconcile fidelity / break types, C = baseline integrity & provenance).

## Requirements Discussion

The requester is acting as the requirements authority and has pre-locked the
five key decisions below (and the constraints). The clarifying questions in the
"Follow-up Questions" section were answered directly from those locked
decisions by the orchestrator rather than by an end user. The locked decisions
are recorded verbatim first so the spec-writer treats them as fixed inputs.

### Locked Decisions (fixed constraints — not to be relitigated)

**LD1 — ONE rubric, SHARED both ways.** The SAME logic that SCORES baseline
completeness MUST also be the logic that FORMULATES the LLM-driven scenario
requests. The generated scenario set IS the rubric — today this is
`defaultScenarioSet(op, discoveryContext, oasOperation)` in
`api-migration-validation-service/src/services/captureSessionOrchestrator.ts`,
which already emits one `GeneratedScenario` per coverage dimension
(`happy_path`, `not_found_<param>`, `enum_<param>_<value>`,
`filter_combo_<names>`, `bad_request_<param>`). The scorer must score those
very same dimensions. There must be NO second/divergent definition of "what
good coverage is".

**LD2 — Coverage score formula.** Coverage score = per-endpoint AND overall =
(rubric dimensions that achieved a canonical capture matching their intended
outcome) / (total rubric dimensions). It is computed from Phase-2's existing
per-scenario outcomes: `runManager` tracks `scenarioCaptures`
(`{ captureId, status }` per scenario) and
`selectCanonicalCapture(captures, expectedStatus)` already picks the canonical
capture per intent. A dimension is "achieved" iff a canonical capture matching
its `expectedStatus` was recorded. Each MISSED dimension must carry an honest,
human-readable reason string (e.g. "enum=CLOSED: no canonical capture — value
not reachable"; "happy_path: system returned 500 on all attempts").

**LD3 — Surfacing.** Surface the coverage score (overall + per-endpoint, with
missed-dimension reasons) at the Save-as-Baseline step AND on the readiness
screen; visually flag endpoints whose coverage is thin (e.g. only happy_path
captured, or negatives missing). Frontend components in play:
`frontend/src/components/DashboardView/CaptureReviewPanel.tsx` /
`CaptureSessionDetailView.tsx` and the readiness view.

**LD4 — Project-wide auth-negative coverage.** Add a SMALL number of
SESSION-level (NOT per-endpoint) auth-negative scenarios — no-token → expect
401, bad/garbage-token → expect 401/403 — executed once against ONE
representative included endpoint. NO multi-role / multi-token capture (too
sensitive). This REQUIRES a new auth-override capability in the HTTP execution
tool (`api-migration-validation-service/src/services/tools/execute_http_request.ts`,
which today auto-injects the session's valid `ssoToken`) so an auth-negative
scenario can deliberately send WITHOUT auth or with a bad token. Treat auth
coverage as a single project-level rubric dimension that contributes to the
overall score.

**LD5 — Persistence.** Persist the coverage summary (per-endpoint dimensions +
achieved/missed + reasons + overall score) via ONE new AMS field on the
capture session (or its completion record), plain TEXT/JSON (avoid fragile DDL
/ multi-column). Next free Liquibase changeset number is 189 (highest existing
is 188, confirmed on disk). Design the field so a LATER spec (baseline
integrity & provenance — Spec C) can read the coverage score and stamp it onto
the immutable baseline. AMS wire format is snake_case by default (see
repo-root `CLAUDE.md`).

### Constraints (fixed)

- Must NOT regress existing Phase 1/2/3 behaviour or tests
  (`defaultScenarioSet`, `selectCanonicalCapture`, learned-facts harvest,
  multi-segment path params). Full jest suite currently green
  (282 pass / 1 skip).
- Single-source rubric: generation and scoring must be incapable of drifting.
- Follow existing `archModelClient.ts` idioms for the AMS field; follow the
  AMS-field + changeset + frontend-surfacing patterns in
  `agent-os/specs/2026-06-16-reconcile-determinism-volatile-values`
  (`spec.md` + `tasks.md`) as the idiom reference.

### Existing Code to Reference

Identified by codebase research (the requester pointed at the orchestrator,
runManager, executor, archModelClient, the reference spec, and the frontend
components; the paths below were confirmed by reading them).

**Single-source rubric / generation + scoring**
- `api-migration-validation-service/src/services/captureSessionOrchestrator.ts`
  - `defaultScenarioSet(op, discoveryContext, oasOperation)` — emits one
    `GeneratedScenario` per coverage dimension (the rubric). Each carries
    `name`, `type`, `expectedStatus`, and a `directive`. The scorer must read
    the SAME `GeneratedScenario[]` so a dimension can never be scored that
    wasn't generated, and vice-versa.
  - `selectCanonicalCapture(captures, expectedStatus)` — already determines
    the per-scenario canonical capture by intent; the scorer reuses this exact
    function to decide "achieved". (Exported, unit-tested.)
  - `ScenarioExpectedStatus` (`'success' | 'not_found' | 'client_error'`),
    `GeneratedScenario` interface, `seedsForOperation`, `operationSeedKey`.
  - The per-scenario loop already computes `canonical` + `droppedCount` and
    increments `scenariosCompleted` / `scenariosErrored` — the natural place
    to also accumulate per-dimension achieved/missed for the coverage summary.
- `api-migration-validation-service/src/services/runManager.ts`
  - `ScenarioCaptureRef` (`{ captureId, status }`), `getScenarioCaptures`,
    `recordScenarioCapture` — the per-scenario outcome source the scorer reads.
    NOTE: `scenarioCaptures` is RESET per scenario in `beginScenario`; any
    cross-scenario coverage accumulation must be captured by the orchestrator
    inside the per-scenario loop (not read once at the end), OR a new
    session-level accumulator must be added to `runManager`.

**Auth-override (LD4)**
- `api-migration-validation-service/src/services/tools/execute_http_request.ts`
  — the only LLM path into a live HTTP call; today the executor's request
  interceptor auto-injects session auth. Needs a per-call override so a
  scenario can send no-auth / bad-auth.
- `api-migration-validation-service/src/services/httpExecutor.ts`
  - `applyAuthToConfig(config, auth)` injects auth from `currentAuth` via a
    request interceptor reading the closure variable; `setAuth(auth)` swaps it
    for the NEXT call (used by the re-entry path). `validateStatus: () => true`
    means a 401/403 arrives as a normal response, not a throw — so an
    auth-negative capture row persists exactly like any other.
  - `ApiAuthSecret` (`api-migration-validation-service/src/types/secrets.ts`)
    has a `type: 'none'` variant, so "send without auth" is expressible as an
    auth bundle today; "bad token" would be a `bearer` with a garbage token.
- `api-migration-validation-service/src/services/tools/toolTypes.ts` —
  `ToolExecutionContext` (carries `httpExecutor`, `currentScenarioId`,
  `session`, `secrets`); the override flag must be threadable per scenario.

**AMS field idiom (LD5)**
- `api-migration-validation-service/src/services/archModelClient.ts`
  - `CaptureSessionDto` / `CreateCaptureSessionRequest` /
    `PatchCaptureSessionRequest` (lines ~71-170) — the read/write surface the
    new field is added to; `patchCaptureSession` is the completion-PATCH call
    site (`captureSessionOrchestrator.ts` final PATCH already sends
    `scenarios_attempted/completed/errored`).
  - `scenarios_attempted/completed/errored` are the precedent nullable boxed
    numeric tally fields — the coverage summary is the JSON sibling.
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/apibehaviour/ApiBehaviourCaptureSessionEntity.java`
  - The JPA entity; `@Type(JsonType.class) @Column(columnDefinition = "jsonb")`
    is the established JSONB-field idiom (used by `authConfigRedactedJson`,
    `oasSpecRefsJson`, `scopeInterfaceIdsJson`, etc.). PATCH-mutable numerics
    are boxed per `project_primitive_double_dto_overwrite.md`.
  - Sibling AMS files to update (per the entity package layout):
    `ApiBehaviourCaptureSessionDto.java`,
    `UpdateApiBehaviourCaptureSessionRequest.java`,
    `ApiBehaviourCaptureSessionService.java` (null-guarded PATCH apply),
    and `ApiBehaviourCaptureSessionController.java`.
- `architecture-model-service/src/main/resources/db/changelog/sql/188-capture-volatile-paths.sql`
  — the direct idiom reference for a new nullable JSON column on a capture-side
  table (ADD COLUMN `jsonb NULL`, `COMMENT ON COLUMN`, NO backfill,
  not-columnExists precondition, registered after the previous changeset in
  `db.changelog-master.yaml`). 188 is the highest changeset on disk;
  189 is free.
- Reference spec idiom: `agent-os/specs/2026-06-16-reconcile-determinism-volatile-values/spec.md`
  + `tasks.md` — AMS field + changeset + frontend-surfacing + build-ordering
  pattern (AMS → validation-service → frontend), and the snake_case-wire
  guidance.

**Frontend surfacing (LD3)**
- `frontend/src/components/DashboardView/CaptureReviewPanel.tsx` — reviewer
  panel; hosts the "Save as Baseline" CTA (appears once ≥1 accepted capture).
- `frontend/src/components/DashboardView/SaveAsBaselineModal.tsx` — the
  Save-as-Baseline step (LD3 surface #1). Already threads capture-row fields
  forward to `createBaselineItem` (the `volatile_paths_json` carry-forward
  precedent — relevant for Spec C handoff).
- `frontend/src/components/DashboardView/CaptureSessionDetailView.tsx` —
  renders the session header + tallies ("Completed — N of M captured") + the
  zero-captures banner; natural host for the coverage score and the readiness
  surface (LD3 surface #2).
- `frontend/src/api/apiBehaviourClient.ts` — the frontend capture API module
  (the coverage field is read here off the session DTO).

(No similar pre-existing "coverage scoring" feature exists to model after; the
volatility-envelope spec is the closest structural analogue and is the named
idiom reference.)

### Follow-up Questions

The clarifying questions below were ANSWERED by the orchestrator directly from
the locked decisions (the requester is the requirements authority). For each,
"Locked?" records whether LD1–LD5 / the constraints already settle it.

**Q1 — Where does the coverage score get COMPUTED?**
Is the scorer a new pure function in `captureSessionOrchestrator.ts` (sibling
to `selectCanonicalCapture`) that takes the per-operation `GeneratedScenario[]`
+ the per-scenario canonical outcomes and returns the coverage summary,
invoked from inside `orchestrateCaptureSession` as it finishes each operation?
**Answer:** Yes. Locked by LD1 + LD2: the scorer must consume the SAME
`defaultScenarioSet` output and the SAME `selectCanonicalCapture` decision, so
it lives alongside them in the orchestrator and runs in the existing
per-scenario / per-operation loop (no second definition of coverage).
**Locked?** Yes (LD1, LD2).

**Q2 — What is the exact shape of the persisted coverage summary?**
A single JSON object on the capture session, snake_case wire, roughly:
`{ overall_score, dimensions_total, dimensions_achieved, per_endpoint: [{ operation_id, method, path, score, dimensions: [{ name, type, expected_status, achieved, canonical_capture_id|null, reason|null }] }], auth_coverage: { dimensions: [...], representative_operation_id } }`.
**Answer:** Use a single JSON blob carrying overall + per-endpoint dimensions +
achieved/missed + reason strings + the auth dimension, snake_case. Exact field
names are the spec-writer's to finalise, but it MUST be ONE field, plain
TEXT/JSON, and MUST include the missed-dimension reasons and an overall score
readable by a later spec. **Locked?** Mostly (LD2 fixes the numerator/
denominator and the per-dimension reason requirement; LD5 fixes "one field,
TEXT/JSON, snake_case, readable by Spec C"). The precise JSON key names are NOT
pre-dictated — spec-writer decides, consistent with `archModelClient.ts`
idioms.

**Q3 — Is auth coverage ONE overall dimension, or per representative endpoint?**
**Answer:** Auth coverage is a SINGLE project-level rubric dimension that
contributes to the OVERALL score (not the per-endpoint scores), executed once
against ONE representative included endpoint. The two probes (no-token → 401,
bad-token → 401/403) collapse into that one auth dimension. **Locked?** Yes
(LD4). Open sub-detail for the spec-writer: whether "no-token" and "bad-token"
each count as their own sub-dimension within the single auth dimension, or
whether the auth dimension is "achieved" only when BOTH probes return their
expected rejection — recommend the spec-writer treat each probe as a tracked
sub-result but roll them into the one project-level dimension for the overall
fraction, so a partial auth result still carries an honest reason.

**Q4 — How is the auth-override plumbed through `execute_http_request`?**
Is it a new optional tool/arg (e.g. `authMode: 'session' | 'none' | 'bad_token'`)
on `execute_http_request`, plumbed to a per-call override on the
`SessionHttpExecutor` (the request interceptor currently always injects
`currentAuth`)?
**Answer:** Yes — a new auth-override path is REQUIRED on the executor/tool so
a scenario can deliberately send without/with-bad auth despite the session
auto-injecting valid auth. The mechanism (per-call arg vs. a scoped
`setAuth` swap) is the spec-writer's design choice, provided: (a) it is
per-request / scoped so it can NEVER leak the no-auth/bad-auth state onto a
subsequent normal capture; (b) the normal path is unchanged when the override
is absent (no regression). **Locked?** Requirement is locked (LD4 says this
capability is required and must be the no-auth/bad-token path); the exact
plumbing is the spec-writer's, bounded by the no-leak + no-regression
constraints. Research note: the executor reads `currentAuth` via a closure in
its request interceptor and exposes `setAuth`; `ApiAuthSecret` already has a
`type: 'none'` variant, and `validateStatus: () => true` means a 401/403 is
captured as a normal row — so the override is feasible without restructuring
the executor.

**Q5 — Are the auth-negative scenarios part of `defaultScenarioSet` (the
per-endpoint rubric) or a separate SESSION-level rubric?**
**Answer:** SEPARATE and SESSION-level — NOT per-endpoint. Auth-negative
scenarios are generated once for the session (run against one representative
included endpoint), distinct from the per-operation `defaultScenarioSet`
dimensions. They contribute to the OVERALL score as the single auth dimension,
not to any endpoint's per-endpoint score. **Locked?** Yes (LD4: "SESSION-level
(NOT per-endpoint)").

**Q6 — Which representative endpoint runs the auth probes, and what if it is
mutating / unsafe?**
**Answer:** ONE representative included endpoint. To stay safe, pick a
non-mutating / `safe_to_execute` included endpoint (ideally one already
captured with a happy_path so the request shape is known-good); if none is
safe/available, the auth dimension is recorded MISSED with an honest reason
rather than firing an unsafe call. **Locked?** Partially — LD4 fixes "one
representative included endpoint" and "run once"; the SELECTION rule (prefer a
safe, already-happy-path endpoint; honest-miss fallback when none qualifies) is
a spec-writer detail consistent with the existing `safe_to_execute` /
`mutating_calls_confirmed` gate in `execute_http_request` and the
honest-reason requirement of LD2.

**Q7 — When is the coverage summary persisted, and on which entity?**
**Answer:** On the capture session, written on the SAME completion PATCH that
already sends `scenarios_attempted/completed/errored`
(`patchCaptureSession` at the end of `orchestrateCaptureSession`), via the ONE
new AMS field. **Locked?** Yes (LD5: "ONE new AMS field on the capture session
(or its completion record)"). The completion-PATCH call site is the established
place the per-run tallies are written, so the coverage summary rides along.

**Q8 — Frontend: net-new widget or reuse existing surfaces?**
**Answer:** Reuse the existing surfaces — render overall + per-endpoint
coverage with missed-dimension reasons at the Save-as-Baseline step
(`SaveAsBaselineModal` / `CaptureReviewPanel`) and on the readiness view
(`CaptureSessionDetailView`), and visually flag thin-coverage endpoints (only
happy_path, or negatives missing). No bespoke charting widget. **Locked?** Yes
(LD3 names the two surfaces and the thin-coverage flag; the
reuse-existing-surfaces approach mirrors the reference spec's
"no bespoke widget" stance).

**Q9 — Anything explicitly OUT of scope?**
**Answer:** Out of scope (deferred to later specs / not this iteration):
multi-role / multi-token auth capture; stamping the coverage score onto the
immutable baseline (that READ is Spec C — this spec only DESIGNS the field so C
can read it); full-response reconcile fidelity / break types (Spec B);
backfilling coverage for already-completed sessions; any automated
threshold/alert/"coverage too low to save" hard gate (display + flag only this
iteration). **Locked?** Yes (LD4 excludes multi-role; LD5 scopes the field for
a LATER spec to consume; the 3-spec split in the raw idea fixes B/C boundaries;
display-only mirrors the reference spec's "displayed count only, no automated
threshold" stance).

## Visual Assets

### Files Provided:
No visual assets provided.
(Mandatory check ran:
`ls -la .../planning/visuals/` → "No visual files found". The `visuals/`
folder is empty/absent, matching the orchestrator's "none expected".)

### Visual Insights:
None — feature reuses existing capture-review / Save-as-Baseline / session-
detail surfaces; no new bespoke UI is designed from a mockup.

## Requirements Summary

### Functional Requirements

- **Single-source coverage scorer.** A scorer that consumes the EXACT
  `GeneratedScenario[]` produced by `defaultScenarioSet` (the rubric) and the
  EXACT per-scenario canonical decision from `selectCanonicalCapture`, so
  generation and scoring cannot drift. A coverage "dimension" == a generated
  scenario; "achieved" == a canonical capture matching that dimension's
  `expectedStatus` was recorded.
- **Per-endpoint and overall scores.** For each included operation:
  `score = achieved_dimensions / total_dimensions`. Overall (session) score
  aggregates all per-endpoint dimensions PLUS the single project-level auth
  dimension.
- **Honest missed-dimension reasons.** Every MISSED dimension carries a
  human-readable reason string derived from the per-scenario outcome
  (e.g. only fumbles/500 → "system returned 5xx on all attempts"; enum value
  unreachable → "value not reachable"; no canonical of intended class).
- **Project-wide auth-negative coverage.** A small set of SESSION-level
  auth-negative scenarios (no-token → expect 401; bad/garbage-token →
  expect 401/403), executed ONCE against one representative included endpoint,
  rolled into a single project-level auth dimension contributing to the
  overall score, each carrying an honest reason when not achieved.
- **Auth-override execution capability.** A per-request, scoped auth-override
  on `execute_http_request` / the `SessionHttpExecutor` so a scenario can send
  with no auth or a bad token despite the session auto-injecting valid auth —
  with NO leakage of the override onto subsequent normal captures and NO change
  to the normal path when the override is absent.
- **Persist the coverage summary** as ONE new AMS field (plain TEXT/JSON,
  snake_case wire) on the capture session, written on the existing completion
  PATCH, shaped so Spec C can read the overall score + per-endpoint dimensions
  + reasons and stamp it onto the immutable baseline.
- **Surface coverage** (overall + per-endpoint + missed reasons) at the
  Save-as-Baseline step AND on the readiness/session-detail view, visually
  flagging thin-coverage endpoints (only happy_path captured, or negatives
  missing).

### Reusability Opportunities

- `defaultScenarioSet`, `selectCanonicalCapture`, `GeneratedScenario`,
  `ScenarioExpectedStatus` — reused verbatim as the single rubric source; the
  scorer is a sibling pure function.
- `runManager.getScenarioCaptures` / `ScenarioCaptureRef` — the per-scenario
  outcome source (note the per-scenario reset; accumulate within the loop or
  add a session-level accumulator).
- `httpExecutor.applyAuthToConfig` / `setAuth` / `ApiAuthSecret('none')` /
  `validateStatus: () => true` — the auth-override seam.
- `archModelClient.ts` capture-session DTO/PATCH + the AMS JSONB-column idiom
  (`@Type(JsonType.class)`, `188-capture-volatile-paths.sql`) — the field.
- The reference spec `2026-06-16-reconcile-determinism-volatile-values`
  (spec.md + tasks.md) — AMS-field/changeset/frontend-surfacing + build-order
  idiom and the `volatile_paths_json` carry-forward precedent (informs the
  Spec-C handoff design).
- Frontend `CaptureReviewPanel` / `SaveAsBaselineModal` /
  `CaptureSessionDetailView` / `apiBehaviourClient.ts` — existing surfaces to
  extend, no bespoke widget.

### Scope Boundaries

**In Scope:**
- Single-source coverage scorer (per-endpoint + overall) computed from the
  existing rubric + canonical-capture outcomes, with honest missed reasons.
- Session-level auth-negative coverage (no-token / bad-token) as one
  project-level dimension, plus the required auth-override execution
  capability.
- One new AMS field (changeset 189) persisting the coverage summary on the
  capture session, designed for Spec-C consumption.
- Frontend surfacing at Save-as-Baseline and the readiness/session-detail
  view, with thin-coverage flagging.

**Out of Scope:**
- Multi-role / multi-token auth capture (too sensitive — explicitly excluded).
- Stamping the coverage score onto the immutable baseline (that READ belongs to
  Spec C — this spec only designs the field so C can consume it).
- Full-response reconcile fidelity / break types (Spec B).
- Backfilling coverage for already-completed capture sessions.
- Any automated threshold / alert / hard "coverage too low to save" gate —
  display + visual flag only this iteration.
- Changing `defaultScenarioSet`'s existing dimension set, `selectCanonicalCapture`
  semantics, the learned-facts harvest, or multi-segment path-param handling
  (no Phase 1/2/3 regression).

### Technical Considerations

- **No drift invariant (must-have test).** Generation and scoring read the
  same `GeneratedScenario[]`; a test must prove a dimension cannot be scored
  that was not generated, and every generated dimension is scored.
- **No Phase 1/2/3 regression.** `defaultScenarioSet`, `selectCanonicalCapture`,
  learned-facts harvest, multi-segment path params must be untouched; full jest
  suite (282 pass / 1 skip) stays green.
- **Auth-override no-leak / no-regression.** The override must be scoped to its
  single call and must not alter the normal capture path when absent;
  `validateStatus: () => true` already makes a 401/403 a normal captured row.
- **Per-scenario reset caveat.** `runManager.scenarioCaptures` resets every
  `beginScenario`; coverage accumulation must happen inside the per-scenario
  loop or via a new session-level accumulator on `runManager`.
- **AMS field idiom.** ONE nullable JSONB column on
  `api_behaviour_capture_sessions`, Liquibase changeset 189
  (`not.columnExists` precondition, `COMMENT ON COLUMN`, NO backfill, registered
  after 188 in `db.changelog-master.yaml`), `@Type(JsonType.class)` on the
  entity; snake_case wire (AMS default, NO `@CamelCaseWire`); written on the
  existing completion PATCH; mirror null-guarded boxed PATCH-apply semantics
  (`project_primitive_double_dto_overwrite.md`).
- **Build order (per reference spec).** AMS field/changeset →
  api-migration-validation-service scorer + auth-override → frontend surfacing;
  each layer independently testable against mocked AMS + fixtures.
- **Spec-C handoff.** The persisted summary must expose a clean overall score
  and per-endpoint dimensions/reasons for Spec C to stamp onto the immutable
  baseline (analogous to the `volatile_paths_json` capture→baseline
  carry-forward).
