# Raw Idea: API Test Harness — Target-Side Capture

## Why this spec exists

The platform already has a fully-built current-state API behaviour capture loop (`api-migration-validation-service` + 7 AMS tables, shipped 2026-05-15 and 2026-05-16). An architect points it at a non-prod current-state API, an LLM-guided loop generates and executes realistic scenarios, and the user-accepted captures are persisted as a durable `api_behaviour_baseline` with `api_behaviour_baseline_items` (one per accepted capture).

That's half of the migration validation story. The other half is the **target side**: after a team has built a target service from the migration backlog and deployed it to UAT, we need a paired set of captures against the target URL so we can prove that the target reproduces the current-state behaviour. Without this pairing there's no evidence base to either gate the migration cutover or to surface drift findings.

This spec adds the **target-side capture** flow: take an existing current-state baseline, replay its accepted captures against the target service's URL, persist the target responses as a paired `api_behaviour_baseline` of `kind=target`, link the two baselines via a `paired_with_baseline_id` foreign key, and surface the new baseline alongside the current-state one in the existing UI.

The output is the **input** to the next two specs:
- **Spec #5 (diff engine)** consumes the paired baselines and produces a structured diff (status drift, body shape drift, missing endpoints, new endpoints).
- **Spec #6 (findings integration)** turns the structured diff into Discovery Findings rows so the diff is visible inside the existing migration-evidence surfaces.

This spec is **only** the capture half. It does not produce a diff and does not write findings.

## What this spec is (and isn't)

**This spec is:**

- A second capture flow inside the existing `api-migration-validation-service` — same service, same wizard shell, same OAS plumbing, same secrets policy, same mutating-call confirmation. New entry point and new endpoint paths.
- A schema extension: `api_behaviour_baselines` gains a `kind` discriminator (`current` | `target`) and a nullable `paired_with_baseline_id` FK so target baselines point back at the current-state baseline they were generated against. New Liquibase changeset; no edits to changesets 128-134.
- A **replay-driven** target capture loop: walks every accepted `api_behaviour_baseline_item` from the source current baseline, re-sends the request (same method / path / query / headers / body) at the target URL, captures the target's response, and persists it as a new `api_behaviour_capture` row + accepted `api_behaviour_baseline_item` on the target-side baseline.
- A target-session config wizard: identical to the current-state wizard except for two fields — the user picks an existing current-state baseline as the **source**, and provides a target base URL + auth config. OAS upload step is replaced by "use the source baseline's OAS inventory" since the captures already encode the operation set.
- A target-side captures review surface (accept / reject / re-execute) that mirrors the current-state review surface — same UI components, same accept/reject semantics, same diagnostics handling.
- A new endpoint set on `api-migration-validation-service` (`POST /target-capture-sessions/...` + action endpoints for `start`, `cancel`, `test-target-connection`).
- New gateway proxy routes mirroring the existing `gateway/src/routes/apiMigrationValidation.ts` pattern.

**This spec is not:**

- The diff engine (Spec #5). Target captures are persisted with their raw request/response payloads; no comparison work happens here. The diff engine reads from both baselines in #5.
- A new LLM-driven scenario generator. v1 is replay-only; the existing LLM tool loop is **not invoked** during target capture. If a replay fails (target returns 4xx/5xx where current returned 2xx, or vice versa), the failure is captured and the diagnostic is recorded, but no LLM-driven retry / regeneration kicks in. LLM-driven retry is deferred to a future spec.
- DB sampling for the target service. Inputs come from the current-state baseline items, never from sampling the target's database.
- A multi-environment matrix (target capture against dev + UAT + staging simultaneously). v1 captures against one target environment per session; the user runs N sessions if they want N environments.
- A way to capture target behaviour without an existing current-state baseline. The flow is paired-only; if there's no source baseline, the user uses the existing current-state capture loop to create one first.
- A migration of the existing baseline rows. Existing baselines get `kind='current'` via the Liquibase backfill; no other change.
- New OAS parsing / inventory work. The source baseline already encodes operation set + scenario set.
- A change to the existing current-state capture flow. Out of scope.

## Decisions already made (don't re-litigate in shape-spec)

These were settled while drafting this raw idea:

1. **Replay-driven, not LLM-driven, for v1.** Re-using the same scenario set (same inputs at the target URL) is the minimum viable input to the diff engine and is fully deterministic. The LLM-driven re-generation path is a future spec (call it "target-side LLM exploration") and is explicitly out of scope here.
2. **Same service, not a new one.** `api-migration-validation-service` already owns the capture loop, the secrets handling, the redactor, the LLM tool relay, the OAS plumbing. Forking a new service for the mirror operation would duplicate ~80% of the code with no architectural benefit.
3. **Reuse the existing schema with extensions, not parallel tables.** A target capture is structurally identical to a current capture (a request + a response). The discriminator goes on `api_behaviour_baselines` (and probably `api_behaviour_capture_sessions`); the actual capture rows go in the same `api_behaviour_captures` table they always did.
4. **One source baseline → one target baseline at a time.** N:M pairing (one source, many target environments) is a future enhancement. v1 is 1:1.
5. **Target capture is paired-only.** No "freestanding" target captures without a source baseline reference. If the user wants to capture target behaviour without a pair, they use the existing current-state capture flow against the target URL — same loop, same output shape, just no pairing.
6. **No new LLM tools.** Replay does not need `list_oas_operations`, `sample_db_values`, etc. The existing tool registry stays for the current-state loop.
7. **Mutating-call confirmation still required.** UAT is still "non-prod-mutable"; the same confirmation gate applies.
8. **One commit boundary per logical layer** is the default — DB+entity layer, AMS controller layer, new service capture loop, gateway proxy, frontend wizard — but the implementer may merge if the surface is small per layer. Shape-spec to refine.

## Specific requirements (rough — let shape-spec refine)

### AMS persistence — schema extensions

**New Liquibase changeset `135-api-behaviour-baselines-kind.sql`** (numbering continues from 134):
- `ALTER TABLE api_behaviour_baselines ADD COLUMN kind TEXT NOT NULL DEFAULT 'current'` — discriminator. v1 values: `current` | `target`.
- `ALTER TABLE api_behaviour_baselines ADD COLUMN paired_with_baseline_id UUID NULL REFERENCES api_behaviour_baselines(id) ON DELETE SET NULL` — points from a target baseline back at the source current-state baseline.
- `CREATE INDEX api_behaviour_baselines_paired_idx ON api_behaviour_baselines(paired_with_baseline_id) WHERE paired_with_baseline_id IS NOT NULL`.
- Constraint: a `target` baseline MUST have `paired_with_baseline_id` set; a `current` baseline MUST have it null. Enforce at service layer (matches existing AMS convention of not using DB-level enums for status discriminators).

**Liquibase changeset `136-api-behaviour-capture-sessions-kind.sql`**:
- `ALTER TABLE api_behaviour_capture_sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'current'` — discriminator. Mirrors the baselines column.
- `ALTER TABLE api_behaviour_capture_sessions ADD COLUMN source_baseline_id UUID NULL REFERENCES api_behaviour_baselines(id) ON DELETE SET NULL` — points from a target session at the source current-state baseline it is replaying.
- Index on `source_baseline_id`.

**No changes to** `api_behaviour_operations`, `api_behaviour_scenarios`, `api_behaviour_captures`, `api_behaviour_baseline_items`, `api_behaviour_diagnostics`. Existing tables are kind-neutral.

### AMS Java layer

- Entities `ApiBehaviourBaselineEntity` and `ApiBehaviourCaptureSessionEntity` gain `kind` (String) and the new nullable UUID FK fields (`pairedWithBaselineId`, `sourceBaselineId`).
- DTOs `ApiBehaviourBaselineDto` and `ApiBehaviourCaptureSessionDto` extend with same fields. Backward-compatible constructor delegation for existing call sites (same pattern as `ArchitectureDto`'s 8-arg / 10-arg / 11-arg delegating constructors).
- Service-layer validation: when creating/updating a baseline or session, validate `kind` is one of the allowed values; validate the FK-pairing invariant (target → must have source; current → must NOT have source).
- New repository finder methods: `findByPairedWithBaselineId(UUID sourceBaselineId)`; `findByProjectIdAndArchitectureIdAndKind(UUID, UUID, String)`.

### `api-migration-validation-service` (TypeScript) — new capture mode

**New endpoint set on the existing service** (mounted under the same `/api-migration-validation` router):
- `POST /target-capture-sessions` — create a target session in `draft` status. Body includes `sourceBaselineId`, `targetApiBaseUrl`, `authType`, `authConfigRedactedJson`, `defaultHeadersRedactedJson`, `mutatingCallsConfirmed`. `kind` is server-set to `target`.
- `POST /target-capture-sessions/:id/test-connection` — same shape as the existing test-api-connection for current-state.
- `POST /target-capture-sessions/:id/start` — moves session to `running`, fires the replay loop, returns immediately with `runId` for polling.
- `POST /target-capture-sessions/:id/cancel` — terminates the in-flight loop, marks session `cancelled`.
- `GET /target-capture-sessions/:id/status` — polling endpoint; returns counts and last diagnostic.
- AMS-direct proxies for the new typed baseline / session list endpoints (filtered by `kind=target`).

**Reuse**:
- Same `runManager` (in-memory map of in-flight sessions).
- Same `secretsStore` (target auth secrets held in-memory only).
- Same `redactor.ts` (no new redaction rules needed).
- Same `archModelClient.ts` (gains methods for the new baseline/session paths).
- Same hard limits (per-scenario round limit, tool-call timeout, scenario wall-clock).

**New: `src/services/targetReplayRunner.ts`** — the replay loop:
1. Load the source baseline by id (via `archModelClient.ts` → AMS).
2. For each accepted `api_behaviour_baseline_item` in the source:
   a. Construct an `execute_http_request` payload from the persisted source request (method, path, query, headers, body), substituting the target base URL.
   b. Apply target-side auth from the in-memory secrets bundle.
   c. Execute the request via the existing axios infrastructure (same redaction, same timeout, same retry-count knobs as the current-state loop).
   d. Persist the response (status, headers redacted, body, duration) as a new `api_behaviour_capture` row tied to the target session.
   e. Auto-accept the capture (target captures are accepted-by-default since they exist to be diffed, not curated) — also creates the `api_behaviour_baseline_item` row.
   f. On error (network failure, target-side 5xx, timeout): emit a diagnostic; **do not** retry beyond the existing per-call retry count; continue to next item.
3. After all items processed: mark session `completed`, finalise the target baseline.

**Important: the LLM tool loop is NOT invoked.** Replay is deterministic. No tool calls. No scenario regeneration.

**Mutating-call gate**: replay still respects the per-session `mutating_calls_confirmed` flag. If the source baseline contains mutating captures and the user did NOT confirm, those items are skipped during replay (diagnostic emitted: `mutating_skipped`).

### Gateway proxy surface

Mirror the existing `gateway/src/routes/apiMigrationValidation.ts` pattern. Add proxy routes that forward to the new service:
- `POST /api/v1/api-migration-validation/target-capture-sessions`
- `POST /api/v1/api-migration-validation/target-capture-sessions/:id/test-connection`
- `POST /api/v1/api-migration-validation/target-capture-sessions/:id/start`
- `POST /api/v1/api-migration-validation/target-capture-sessions/:id/cancel`
- `GET /api/v1/api-migration-validation/target-capture-sessions/:id/status`

AMS-direct proxies for the kind-filtered baseline/session list endpoints (forwarded verbatim).

Add typed wrappers in `gateway/src/services/apiMigrationValidationClient.ts` (or wherever the current-state typed wrappers live).

### Frontend

Reuse the existing wizard shell. Add a sibling entry point on the API Migration Validation page: a "Capture target behaviour" button alongside the existing "Capture current behaviour" button. The new button is **disabled** when no current-state baseline exists for the project+architecture; tooltip explains why.

**New wizard step shape** for target capture:
- Step 1: Pick source baseline — list current-state baselines for the project+architecture (only `kind=current, status=active`).
- Step 2: Target environment config — base URL, auth type, auth config, default headers, mutating-calls confirmation. Same UI components as the current-state wizard step 2/3 (the "configure connection" step).
- Step 3: Confirm — shows source baseline name, item count, target URL, mutating-confirm state. "Start replay" button.
- Step 4: Progress — polls `/status` endpoint, shows counts (`scenarios queued / running / completed / failed`), live diagnostic list. Same component as the current-state live progress.
- Step 5: Review — auto-accepted captures laid out for spot-check; user can re-execute single items if a transient failure happened. No "accept" toggle (target captures are accepted-by-default).

The target-side review surface intentionally skips the curation step the current-state flow has. The user is not picking which captures to keep — they're keeping all of them so the diff engine has full coverage.

**Target baseline detail page**: mostly identical to the current-state baseline detail page, but:
- Header shows "Target Baseline (paired with: [source baseline name])".
- A "Re-replay this baseline against a new target" action button opens the wizard pre-filled to a new draft target session sourcing the same baseline.
- (Diff and findings surfaces are added in Specs #5 and #6 — not here.)

### Tests

- AMS service tests for the schema extension (entity, repo finders, validation, FK-pairing invariant).
- AMS service test for the kind-filter `findByProjectIdAndArchitectureIdAndKind`.
- `api-migration-validation-service` Jest tests for the replay runner: source baseline load, per-item replay, response persistence, mutating-skipped path, diagnostic emission.
- Gateway tests for the new proxy routes.
- Frontend Vitest tests for the new wizard (only the new steps; reused steps already have coverage).
- No end-to-end harness needed for v1 — that's appropriate for a separate integration-test spec, not this one.

Tests cap: aim for moderate coverage. The current-state spec landed ~40 backend tests across the 5 layers; target-side should be ~20-25 because most of the surface is reuse. Shape-spec to confirm.

### Verification

- Manual: create a current-state baseline against the in-codebase mock current service (or whatever non-prod service the user has handy), then trigger a target capture against a sibling URL, confirm the target baseline materialises with `kind=target, paired_with_baseline_id=...`, and contains `api_behaviour_baseline_items` with status responses captured from the target.
- `cd architecture-model-service && mvn test-compile` exits 0 (already a constant invariant per the test-infrastructure-cleanup spec).
- `cd architecture-model-service && mvn test` does not regress beyond the pre-existing follow-up list.

## Out of Scope

- The diff engine itself. Comparing the paired baselines lives in Spec #5.
- The Discovery Findings integration for the diff results. Lives in Spec #6.
- LLM-driven target-side scenario regeneration / exploration. Deferred to a future spec.
- N:M baseline pairing (capture against multiple target environments per source baseline in one go).
- Capturing target behaviour without a source baseline pair.
- Per-operation override of mutating-call exclusion. Mirrors the current-state spec's v1 decision.
- Sybase DB adapter support (existing stub still throws).
- Multi-target replay parallelism (v1 replays sequentially within a session; if perf becomes an issue we revisit).
- Authentication / authorization beyond what the gateway already requires.
- New OAS parsing / upload — source baseline already encodes the operation set.
- Existing baselines backfill beyond setting `kind='current'` via Liquibase default.
- Any change to the existing current-state capture flow's behaviour.
- The `api-migration-validation-service` test-infrastructure follow-up (`<maven.test.skip>` etc. — the AMS test cleanup spec called out `jira-service` as a sibling; this service may or may not have the same pattern — that's a separate cleanup spec).
- `@JsonNaming` audit for the new DTOs — they follow the existing convention (`@CamelCaseWire` if the consumer is camelCase, no annotation if snake_case is fine).

## Dependencies

- `2026-05-15-api-behaviour-baseline-capture-service` (shipped) — provides the current-state capture machinery this spec extends.
- `2026-05-16-api-behaviour-capture-fixes` (shipped) — fixes that should also apply to the target-side flow by virtue of reusing the same loop.
- `2026-05-25-ams-test-infrastructure-cleanup` (shipped) — `mvn test` works again, which matters because Spec #4 adds AMS test surface.
- `2026-05-25-ams-dto-json-naming-audit-sweep` (shipped) — `@CamelCaseWire` annotation available for the new DTOs whose consumers are camelCase. Existing apibehaviour DTOs use `@JsonProperty` per-field; new DTOs should match.

No new functional dependencies.

## Open questions for shape-spec to clarify

1. **Replay vs LLM-driven for v1.** The raw-idea recommends replay-only. Confirm? An alternative is "replay first, then optional LLM-driven follow-up pass to explore newly-introduced target endpoints (target OAS endpoints not present in source baseline)". My instinct: **stick with replay for v1**; LLM-driven exploration is a future spec and shouldn't bloat the first cut.

2. **Pairing cardinality.** v1 is 1 source → 1 target. The schema allows N:M trivially (multiple target baselines could all have the same `paired_with_baseline_id`). Should the spec also expose a "list all target baselines paired with this source" endpoint, or wait until the UI needs it (#5/#6)? My instinct: **add the read-side endpoint now** (`GET /api/projects/.../baselines/{sourceId}/target-baselines`); the new service / frontend won't need it in #4 itself, but #5's diff UI will, and adding it now keeps the AMS contract complete.

3. **Auto-accept policy.** Target captures are accepted-by-default (no user curation step in the wizard). Confirm? Alternative: same curation step as current-state, user manually accepts each one. My instinct: **auto-accept**. The diff engine needs full coverage to surface drift; making the user curate target captures defeats the purpose.

4. **`mutating_skipped` semantics on the target side.** When the source baseline contains a mutating capture (e.g. `POST /orders`) and the target session has `mutating_calls_confirmed=false`, we skip it. Should the diff engine in #5 then treat the missing target capture as "not tested" or as a finding? My instinct: **not-tested in #5**, with a clear filter in the diff UI ("X items not replayed because mutating not confirmed"). But that's #5's concern, not #4's — #4 just emits the `mutating_skipped` diagnostic.

5. **Replay-time fail-fast vs continue-on-error.** If 5 consecutive replays fail with network errors (target service down), do we abort the session or continue? My instinct: **continue-on-error per-item, but emit a `target_unreachable` diagnostic if N consecutive failures exceed a threshold (default 10)**. Abort-the-session is too eager for transient flakes.

6. **Target session resume after process restart.** The current-state spec already handles the `secrets_lost_during_run` reconciliation. Target-side should follow the same pattern verbatim. Confirm? My instinct: **yes, same pattern**.

7. **Schema: should `kind` and `paired_with_baseline_id` go on `api_behaviour_capture_sessions` AND `api_behaviour_baselines`, or just the baseline?** The session-level discriminator is useful for the running-sessions list ("show me only target sessions"). My instinct: **both** — adds zero meaningful complexity, makes the session APIs uniformly filterable, and the join cost is trivial.

8. **DTO PATCH-safety for the new fields.** `kind` is a `String` (already PATCH-safe). `pairedWithBaselineId` is a nullable UUID (already PATCH-safe). No primitive-numeric/boolean drift risk per `project_primitive_double_dto_overwrite.md`. Confirm. My instinct: **confirm — no boxed-type-needed fields added**.

9. **Frontend test cap.** The reused wizard steps are already covered by current-state tests; new step coverage should be capped at 4-6 frontend tests (target session create, source baseline picker, target URL validation, progress polling, review step). My instinct: **6 frontend tests**.

10. **Commit boundary.** One commit per layer? Or one commit for the whole thing? My instinct: **per-layer** — Liquibase + entities + repos as commit 1, controllers + service-layer validation as commit 2, new service replay loop as commit 3, gateway proxies as commit 4, frontend as commit 5. The whole spec is large enough that a 5-commit boundary keeps each PR / review chunk digestible. But if you prefer one big commit (matches the pattern of the migration-workflow rework specs), I can adjust.

## Verification

After this spec:
- A new target baseline can be created end-to-end via the UI: pick source baseline, configure target URL + auth, start replay, see progress, end up with a target baseline paired to the source with one `api_behaviour_baseline_item` per replayed-and-captured source item.
- `kind='target'` baselines are visible alongside `kind='current'` baselines in the existing baselines list, filterable by kind.
- The replay loop respects `mutating_calls_confirmed`; mutating items are skipped with diagnostic when not confirmed.
- The diff engine work in #5 has all the data shape it needs to consume both sides of a pair.
- All AMS-side compile + test commands stay green for previously-green tests.

## Commit boundary

One commit per layer is the default (Liquibase + entity + repo → AMS Java controller + service → new service replay loop → gateway proxy → frontend). Shape-spec to confirm.
