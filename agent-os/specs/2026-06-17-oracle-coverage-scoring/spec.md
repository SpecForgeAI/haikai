# Specification: Oracle Coverage Scoring

## Goal
Measure and surface how thoroughly each capture session's baseline pins the behaviour it set out to capture, using a single shared rubric that BOTH drives LLM scenario generation AND scores completeness, plus project-wide auth-negative coverage, so a "green" reconcile is only trusted when the oracle is known thorough.

## User Stories
- As a migration analyst, I want a per-endpoint and overall coverage score (with honest reasons for every missed dimension) at Save-as-Baseline and on the readiness screen, so I know how much behaviour the baseline actually pins before I lock it.
- As the platform owner, I want generation and scoring to read one rubric so they can never drift, and I want project-wide auth-negative coverage proven once, so the baseline's completeness claim is trustworthy.

## Specific Requirements

**Single-source coverage scorer (sibling pure function)**
- Add a PURE scorer in `captureSessionOrchestrator.ts`, sibling to `selectCanonicalCapture`, that consumes the EXACT `GeneratedScenario[]` from `defaultScenarioSet(op, discoveryContext, oasOperation)` (the rubric) — no second definition of "good coverage".
- A coverage dimension == one generated scenario (`happy_path` / `not_found_<param>` / `enum_<param>_<value>` / `filter_combo_<names>` / `bad_request_<param>`).
- A dimension is "achieved" iff `selectCanonicalCapture(scenarioCaptures, scenario.expectedStatus)` returns a non-null capture for that scenario — reuse the existing function verbatim.
- Each MISSED dimension carries an honest human-readable reason derived from the per-scenario outcome (e.g. `enum=CLOSED: no canonical capture — value not reachable`; `happy_path: system returned 5xx on all attempts`; `no capture matched the intended <expectedStatus> class`).
- Record per dimension: `name`, `type`, `expected_status`, `achieved`, `canonical_capture_id` (or null), `reason` (or null).
- Do NOT modify `defaultScenarioSet`, `selectCanonicalCapture`, `GeneratedScenario`, or `ScenarioExpectedStatus` semantics (Phase 1/2/3 no-regression).

**Coverage accumulation across the per-scenario loop**
- `runManager.scenarioCaptures` is RESET every `beginScenario`, so coverage MUST be accumulated as each scenario completes inside `orchestrateCaptureSession`'s per-scenario loop — it cannot be read once at the end.
- Accumulate per-dimension achieved/missed results in the loop (where `canonical` + `droppedCount` are already computed), keyed by operation, OR via a new session-level accumulator on `runManager`; pick the option that keeps the orchestrator's existing tally flow intact.
- The scorer itself stays pure (inputs in, summary out); the orchestrator owns the accumulation and the final assembly into the persisted summary.

**Coverage score formula**
- Per-endpoint score = achieved dimensions / total rubric dimensions for that operation.
- Overall (session) score = (all achieved per-endpoint dimensions + the achieved auth dimension) / (all per-endpoint dimensions + 1 auth dimension).
- Persist totals (`dimensions_total`, `dimensions_achieved`) alongside the fraction so a later reader does not recompute.
- Scores are display-only this iteration — no hard gate, no "too low to save" block.

**Project-wide auth-negative coverage (session-level, one dimension)**
- A SMALL set of SESSION-level auth-negative probes (NOT per-endpoint): no-token → expect 401; bad/garbage-token → expect 401/403.
- Run ONCE against one representative included endpoint; the two probes roll into a SINGLE project-level dimension that contributes to the OVERALL score only (never to a per-endpoint score).
- Track each probe as a sub-result with its own honest reason; the auth dimension is "achieved" only when BOTH probes returned their expected rejection, otherwise MISSED with a reason naming which probe failed and the observed status.
- No multi-role / multi-token capture.

**Representative-endpoint selection for auth probes**
- Prefer a non-mutating / `safe_to_execute` included endpoint already captured with a happy_path (known-good request shape).
- If no safe/known-good endpoint qualifies, record the auth dimension MISSED with an honest reason (e.g. `no safe representative endpoint available for auth probes`) rather than firing an unsafe call — respect the existing `safe_to_execute` / `mutating_calls_confirmed` gate.

**Auth-override execution capability (no-leak, no-regression)**
- Add a per-request, scoped auth-override path on `execute_http_request` / `SessionHttpExecutor` so a scenario can deliberately send with NO auth (`ApiAuthSecret { type: 'none' }`) or a bad token (`bearer` with a garbage token) despite the session auto-injecting the valid `ssoToken`.
- Use the existing seam: `setAuth(auth)` swaps `currentAuth` for the next call, and `validateStatus: () => true` already lets a 401/403 land as a normal captured row.
- The override MUST be scoped to its single call (swap before, restore the session auth immediately after) so it can NEVER leak onto a subsequent normal capture; thread the override flag via `ToolExecutionContext` / a new optional tool arg (e.g. `authMode: 'session' | 'none' | 'bad_token'`).
- When the override is absent the normal path is byte-for-byte unchanged.

**Persist the coverage summary on the capture session (ONE AMS field)**
- Add ONE new nullable JSONB column to `api_behaviour_capture_sessions` holding the whole coverage summary as plain JSON (snake_case wire, AMS default — NO `@CamelCaseWire`).
- Shape: `{ overall_score, dimensions_total, dimensions_achieved, per_endpoint: [{ operation_id, method, path, score, dimensions: [{ name, type, expected_status, achieved, canonical_capture_id|null, reason|null }] }], auth_coverage: { achieved, representative_operation_id|null, probes: [{ name, expected, achieved, observed_status|null, reason|null }] } }` (final key names the spec-writer's, consistent with `archModelClient.ts` snake_case idioms).
- Write it on the EXISTING completion PATCH (`patchCaptureSession` at the end of `orchestrateCaptureSession`, beside `scenarios_attempted/completed/errored`).
- Design the field so a later spec (baseline integrity & provenance, Spec C) can read `overall_score` + per-endpoint dimensions/reasons off the session and stamp it onto the immutable baseline.

**AMS field idiom (changeset 189)**
- Liquibase changeset `189` (`not.columnExists` precondition, `COMMENT ON COLUMN`, NO backfill, registered after `188` in `db.changelog-master.yaml`) — VERIFY at build time that `188-capture-volatile-paths.sql` is still highest on disk.
- Mirror `188-capture-volatile-paths.sql`: `ALTER TABLE api_behaviour_capture_sessions ADD COLUMN <name> jsonb NULL`.
- Entity: `@Type(JsonType.class) @Column(columnDefinition = "jsonb")` on `ApiBehaviourCaptureSessionEntity.java` (mirroring `scopeInterfaceIdsJson` / `oasSpecRefsJson`).
- Thread the field through the sibling AMS files: `ApiBehaviourCaptureSessionDto.java` (add a delegating backward-compatible constructor), `UpdateApiBehaviourCaptureSessionRequest.java` (add delegating ctor), `ApiBehaviourCaptureSessionService.java` (null-guarded PATCH apply per `project_primitive_double_dto_overwrite.md`), `ApiBehaviourMapper.java` (`toDto`), and the controller if needed.
- Add the snake_case field to `archModelClient.ts` `CaptureSessionDto` + `PatchCaptureSessionRequest`.

**Frontend surfacing (reuse existing surfaces, no bespoke widget)**
- Add the field to the frontend `ApiBehaviourCaptureSessionDto` in `apiBehaviourClient.ts` (snake_case, read off the session DTO).
- Surface overall + per-endpoint coverage (with missed-dimension reasons) at Save-as-Baseline (`SaveAsBaselineModal` / `CaptureReviewPanel`) AND on the readiness/session-detail view (`CaptureSessionDetailView`), beside the existing "Completed — N of M scenarios captured" tally.
- Visually FLAG thin coverage (e.g. only `happy_path` achieved, or all negatives missing) — reuse existing banner/badge styling (like the coverage-override / zero-captures banners), no charting widget.
- Display-only; null/absent summary (legacy or pre-fix sessions) renders gracefully as "coverage not recorded", not an error.

**No-drift + no-regression invariant tests**
- A test proving a dimension cannot be scored that was not generated, and every generated dimension is scored (generation and scoring read the same `GeneratedScenario[]`).
- A test proving the auth-override is scoped and never leaks onto a subsequent normal capture, and that the normal capture path is unchanged when the override is absent.
- Full jest suite (currently 282 pass / 1 skip) stays green; `defaultScenarioSet`, `selectCanonicalCapture`, learned-facts harvest, and multi-segment path-param handling are untouched.

## Visual Design
No visual assets provided (`planning/visuals/` confirmed empty). The feature reuses the existing capture-review / Save-as-Baseline / session-detail surfaces; coverage is rendered beside the existing scenario-tally and coverage-override banners the same way those banners already render.

## Existing Code to Leverage

**`defaultScenarioSet` / `selectCanonicalCapture` / `GeneratedScenario` — `captureSessionOrchestrator.ts`**
- `defaultScenarioSet` IS the rubric (one `GeneratedScenario` per dimension, each with `name`/`type`/`expectedStatus`/`directive`); the scorer reads this exact array so generation and scoring cannot diverge.
- `selectCanonicalCapture(captures, expectedStatus)` is reused verbatim to decide "achieved"; the per-scenario loop already computes `canonical` + `droppedCount` — the natural accumulation point.

**`runManager` — `runManager.ts`**
- `getScenarioCaptures` / `ScenarioCaptureRef` ({ captureId, status }) is the per-scenario outcome source; `scenarioCaptures` is RESET in `beginScenario`, so accumulate within the loop or add a session-level accumulator here.

**`httpExecutor.ts` + `execute_http_request.ts` + `secrets.ts`**
- `setAuth(auth)` swaps `currentAuth` for the next call; `validateStatus: () => true` makes a 401/403 a normal captured row; `ApiAuthSecret` has a `type: 'none'` variant + `bearer` (garbage token) — the auth-override seam, threaded via `ToolExecutionContext`.

**AMS capture-session field idiom — `ApiBehaviourCaptureSessionEntity.java` + DTO/Request/Service/Mapper + `188-capture-volatile-paths.sql`**
- `scenariosAttempted/completed/errored` + `coverageOverride*` are the precedent nullable PATCH-mutable fields written on the completion PATCH; `@Type(JsonType.class)` JSONB columns (`scopeInterfaceIdsJson`, `oasSpecRefsJson`) are the column idiom; changeset 188 is the ADD COLUMN jsonb NULL reference; null-guarded PATCH apply per `project_primitive_double_dto_overwrite.md`.

**Reference spec + frontend surfaces — `2026-06-16-reconcile-determinism-volatile-values` / `apiBehaviourClient.ts` / `CaptureSessionDetailView.tsx` / `SaveAsBaselineModal.tsx`**
- The reference spec's AMS-field + changeset + frontend-surfacing + build-order (AMS → validation-service → frontend) and "displayed count only, no automated threshold" stance; `CaptureSessionDetailView` hosts the scenario-tally + coverage-override + zero-captures banners (the readiness surface); `SaveAsBaselineModal` already shows a coverage warning and threads `volatile_paths_json` forward (the Spec-C carry-forward analogue).

## Out of Scope
- Multi-role / multi-token auth capture (too sensitive — explicitly excluded).
- Stamping the coverage score onto the immutable baseline (that READ is Spec C; this spec only DESIGNS the field for C to consume).
- Full-response reconcile fidelity / break types (Spec B).
- Backfilling coverage for already-completed capture sessions (legacy rows stay null = "not recorded").
- Any automated threshold / alert / hard "coverage too low to save" gate — display + visual flag only this iteration.
- Changing `defaultScenarioSet`'s dimension set, `selectCanonicalCapture` semantics, the learned-facts harvest, or multi-segment path-param handling.
- A bespoke charting widget — reuse the existing capture-review / Save-as-Baseline / session-detail surfaces.
- Probing mutating/unsafe endpoints for auth coverage (fall back to an honest MISSED reason).
