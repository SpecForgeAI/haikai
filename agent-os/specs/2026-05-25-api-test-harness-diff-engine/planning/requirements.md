# Spec Requirements: API Test Harness — Diff Engine

## Initial Description

See `planning/raw-idea.md` for the full design. In summary:

- Add a deterministic diff engine in `api-migration-validation-service` that compares paired source / target baselines (produced by Spec #4) and persists structured drift findings in two new AMS tables (`api_behaviour_diffs` + `api_behaviour_diff_items`).
- Auto-trigger at the end of target replay; expose a manual recompute button.
- Add a "Drift report" tab on `BaselineDetailView` when `kind=target`.
- v1 is deterministic (no LLM), hand-rolled JSON shape comparator, no new external deps.

The raw idea lists 11 open questions and explicitly notes a set of "Decisions already made (don't re-litigate)" that should be honoured.

## Validated Reuse Inventory

Files validated against the codebase (paths verified):

| Concern | Path | Notes |
|---|---|---|
| Spec #4 replay runner (auto-trigger insertion point) | `api-migration-validation-service/src/services/targetReplayRunner.ts` | Lines 632-641 — successful happy-path PATCHes session to `completed` then baseline to `active`. The one-line auto-diff POST belongs immediately after line 641, before the `return { ... finalStatus: 'completed' }`. The runner already has every value the diff POST needs in scope: `projectId`, `session.architecture_id`, `session.source_baseline_id`, `targetBaseline.id`. |
| Background-task pattern | `api-migration-validation-service/src/services/runManager.ts` | `RunManager.start({ sessionId, projectId, architectureId })` is keyed on `sessionId` and throws if the same id is already running. The diff has no `sessionId`. **Real complication** — see findings. |
| Route-handler fire-and-forget pattern | `api-migration-validation-service/src/routes/targetCaptureSessionActions.ts` lines 343-371 | Patches status → `running` first, registers in `runManager`, then `spawnRunner(...).catch(log)`. Diff runner should mirror this. |
| Validation-service AMS client | `api-migration-validation-service/src/services/archModelClient.ts` | Already has `getBaseline`, `listBaselineItems`, `createBaselineItem` (lines 712-975). Will need new `createDiff`, `createDiffItem`, `patchDiff`, `getDiffByTarget`, `listDiffItemsByDiff` methods. |
| BaselineItem DTO at validation-service | `api-migration-validation-service/src/services/archModelClient.ts` lines 329-344 | `request_json` and `response_json` typed as `unknown` — TS contract is permissive. |
| BaselineItem entity at AMS | `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/apibehaviour/ApiBehaviourBaselineItemEntity.java` lines 89-103 | `request_json` and `response_json` typed as `Map<String, Object>` — Java contract **enforces object shape** at the persistence boundary. |
| AMS api-behaviour CRUD patterns to mirror | `architecture-model-service/src/main/java/com/example/architecturemodel/{controller,service,repository,model/{dto,entity}}/apibehaviour/ApiBehaviourBaselineItem*` | Established Lombok / `@JdbcTypeCode(SqlTypes.JSON)` / boxed-Integer / record-DTO conventions. |
| Liquibase changeset registration pattern | `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` | Pattern: `id`, `author: architecture-tool`, `preConditions: onFail: MARK_RAN`, `<sqlFile>` with `path`, `relativeToChangelogFile: false`, `splitStatements: true`, `stripComments: true`. |
| Frontend baseline detail view (tab insertion) | `frontend/src/components/DashboardView/BaselineDetailView.tsx` | **Currently flat — no tab structure.** The kind=target header banner is on lines 257-269; main content (Summary, Baseline items) directly below. Adding a "Drift report" tab requires a small structural refactor — see findings. |
| Frontend api-behaviour client | `frontend/src/api/apiBehaviourClient.ts` lines 313-331 | `ApiBehaviourBaselineItemDto` types `request_json` / `response_json` as `Record<string, unknown> \| null`. Need to extend with diff DTOs and client functions. |
| Existing tab pattern | `frontend/src/components/Architecture/ArchitectureDesignSubTabs.tsx` | A reference pattern if the spec opts to extract a generic tabs primitive (probably overkill for two tabs). |
| Gateway proxy pattern for api-migration-validation | `gateway/src/routes/apiMigrationValidation.ts` lines 442-650 | Established action-endpoint proxy + capture-session proxy + target-capture-session proxy patterns. Diff routes slot in alongside. |

**Spec #4 implementer-surfaced caveat:** `BaselineDetailView.tsx` lives under `frontend/src/components/DashboardView/`, NOT `frontend/src/components/ApiBehaviour/`. The raw-idea's proposed paths for `DriftReportTab.tsx` and `DiffItemDetailModal.tsx` (under `ApiBehaviour/`) are wrong — they should sit under `DashboardView/` to colocate with the parent view, OR a new `frontend/src/components/ApiBehaviour/` folder is created (currently no such folder exists). Recommendation: put the new components under `DashboardView/` for proximity to the parent.

## Findings: Validation Against the Raw Idea's Assumptions

### F1. AMS schema validates — Spec #4 columns are exactly as assumed

Confirmed against `156-api-behaviour-baselines-kind.sql`:
- `kind TEXT NOT NULL DEFAULT 'current'`
- `paired_with_baseline_id UUID NULL REFERENCES api_behaviour_baselines(id) ON DELETE SET NULL`
- `ON DELETE SET NULL` (not CASCADE) on the self-FK — so target baselines survive source-deletion as orphans.

Confirmed against `134-api-behaviour-baseline-items.sql`:
- Composite-key columns `(method, path, scenario_name)` are all `NOT NULL TEXT` — safe to use as the pairing key.

**Implication for diff:** Because `paired_with_baseline_id` becomes `NULL` on source-delete (not the target row itself), and the diff's own `source_baseline_id` FK CASCADEs on source-delete, the **diff rows will vanish whenever the source baseline is deleted but the target baseline survives unmoored**. This isn't necessarily wrong but it's worth a service-layer note. Worth considering: should the orphaned-target case surface as a UI state ("source baseline deleted; recompute unavailable")? See Q8 below.

### F2. SHAPE INCONSISTENCY — source-side `response_json` is the raw body; target-side `response_json` is `{ headers, body }`

This is the most significant finding. The two sides of a paired baseline have **structurally different `response_json` shapes**:

- **Source side** (`frontend/src/components/DashboardView/SaveAsBaselineModal.tsx` line 146): `response_json: cap.response_body_json` — the raw response body. At the Java layer this gets typed as `Map<String, Object>`, so root-level arrays/primitives are impossible (the entity won't deserialize them).
- **Target side** (`api-migration-validation-service/src/services/targetReplayRunner.ts` lines 558-561): `response_json: { headers: capture.response_headers_redacted_json, body: capture.response_body_json }` — a wrapper object with the body nested under a `body` key.

**The diff engine MUST normalize.** A naive comparator would treat *every* item as `body_shape_drift` because the target side has an extra `headers` key and an indirection through `body`.

The simplest fix: when the comparator reads a baseline item's `response_json`, **normalize it via this rule**: if the JSON is an object containing both `body` and `headers` keys (and no other "business" keys), unwrap to `body`. Apply symmetrically.

For `request_json` the divergence is smaller — both sides use `{ query, headers, body }` shape (see `targetReplayRunner.ts` lines 552-556 vs `captureSessionFullFlow.e2e.test.ts` referenced in line 215 of `targetReplayRunner.ts` claiming the source also uses this merged shape). The diff engine v1 likely compares **response bodies only**, not request bodies (the request is the same between source and target by definition of the replay). Confirm via Q1.

### F3. JSON shape comparator can simplify — root is always an object (or null)

Because the Java entity uses `Map<String, Object>`, the persistence boundary rejects any non-object root JSON. The comparator therefore needs to handle:
- objects (`Record<string, unknown>`) — the dominant case
- `null` — when the column was nulled (won't happen since `NOT NULL`, but defensive)
- arrays — only if **nested** inside an object (never at the root)
- primitives — only if nested

So v1's comparator interface can be `compareJsonObjects(source: Record<string, unknown>, target: Record<string, unknown>)` rather than `(source: unknown, target: unknown)`. Recursive walk still needs to handle arrays/primitives within objects.

### F4. Volatile-value drift (timestamps, UUIDs, sequence numbers) is a real concern but should NOT be in v1

I considered whether v1's deterministic shape comparator needs a "value-volatile" allowlist (skip drift classification for paths matching e.g. `*.id`, `*.timestamp`, `*.createdAt`).

**Recommendation: keep v1 strict** — record everything as `body_value_drift`, classified as informational (the raw idea's existing decision is correct). Reasoning:
- Adding an allowlist now bakes in a heuristic that's hard to extract later.
- `body_value_drift` is already separately classified from `body_shape_drift` and treated as info, not a defect.
- Spec #6 (findings integration) is the right place to add per-finding "this is expected drift" overrides.
- A regex allowlist would be project/service-specific and arguably belongs in user-facing config (v2 surface).

This stays a v2 concern. Confirm via Q3.

### F5. `runManager` is keyed on sessionId, diff has none — small adaptation needed

The existing `RunManager.start()` takes `{ sessionId, projectId, architectureId }` and throws if the id is already running (line 56-58). The diff has no `sessionId` but needs the same fire-and-forget background + cancel surface.

**Three options:**
1. **Reuse `runManager` with `diffId` in the `sessionId` slot.** Cheapest. Slightly misleading naming but functional. The `runManager` map already has session-running-state semantics that don't apply cleanly (`currentScenarioRounds`, `scenarioHttpAttempts`) but they don't need to be populated.
2. **Add a parallel `diffRunManager`.** Cleaner separation; small duplication.
3. **Generalize `RunManager` to take an opaque `runId`.** Bigger refactor (touches Spec #4 code).

**Recommendation: option 1** — pass `diffId` as `sessionId`, populate `projectId` + `architectureId` from the diff row, leave the per-scenario counters unused. The diff runner has no LLM loop so the unused counters are irrelevant. Document the slight semantic stretch in a comment. Confirm via Q5.

### F6. Auto-trigger boundary — happy-path PATCH already locates the insertion point

The clean insertion point is `api-migration-validation-service/src/services/targetReplayRunner.ts` immediately after line 641 (`patchBaseline` to `status='active'`) and before line 643's `console.log('op=complete')`. At that point `targetBaseline.id`, `session.source_baseline_id`, `projectId`, `session.architecture_id` are all in scope.

The trigger should:
- POST to its own `/diffs` endpoint as a self-fetch (or call `diffRunner.runDiff` directly via local import — see Q4 for which).
- Fail soft: log on error and continue (the raw-idea correctly says this).

**Implication:** the trigger should NOT block the runner's return — it spawns the diff and returns immediately (the diff is its own background task).

The AMS-side trigger alternative (when `target_baseline.status` flips to `active`) is rejected because AMS has no notion of calling-out to the validation service — and Spec #4 doesn't have any event hook on baseline status changes anyway.

### F7. BaselineDetailView is flat — small structural refactor needed for the tab

`BaselineDetailView.tsx` is currently a single flat view (Summary + Baseline items list). It has NO tab container.

To add the "Drift report" tab, the shape-spec needs to plan a small refactor:
1. Wrap the existing Summary + Baseline-items in a "Baseline detail" tab content block.
2. Add a tabs nav strip when `baseline.kind === 'target'`.
3. The "Drift report" tab content is the new `DriftReportTab.tsx` component.

For `kind='current'` (the source side), no tabs are shown — the existing flat view is preserved exactly.

This refactor is **not large** (probably ~50 LOC across the file) but it's worth being explicit in the shape-spec so the test budget accounts for it (and the existing snapshot/rendering tests aren't broken). Worth considering: should the source baseline ALSO show a "Drift report" tab listing any target-side diffs that point at it (since `paired_with_baseline_id` is a UUID, a source can be replayed multiple times)? My instinct is **no, defer** — the user navigates to the target baseline to see drift. See Q9.

### F8. Predicted changeset slots (verify empirically)

Spec #4 landed at slots **156** and **157**. The current next available slots are **158** and **159**, BUT the implementer must verify empirically at start because:
- Other in-flight specs may land between now and this spec's implementation.
- Spec #4 itself surfaced that the raw-idea's predicted slot numbers were 14 numbers stale.

**Recommended caveat (carry forward into the spec):** "Next two available slots. Implementer to run `ls src/main/resources/db/changelog/sql/ | sort -V | tail -5` to confirm before naming files. Update `db.changelog-master.yaml` accordingly."

### F9. Gateway typed client extension — file already exists from Spec #4

`gateway/src/services/apiBehaviourClient.ts` was extended in Spec #4 (per the raw-idea's reference). The new diff functions slot into the same file. No new gateway file needed.

### F10. No new dependencies, JSON-diff hand-rolled (validated)

Confirmed via raw-idea brief: no JSON-diff library in any service's `package.json`. Hand-rolled walker is the only zero-dep path. ~150-250 LOC estimate sounds right given the bounded input (always-object root, capped depth).

## Predicted Risks / Surprises

1. **Response-shape divergence (F2) is the biggest risk.** If the comparator doesn't normalize, every paired diff would surface as `body_shape_drift` and the v1 feature would look broken on day one. Must be called out explicitly in the shape-spec and covered by a test.
2. **The runManager-keyed-on-sessionId mismatch (F5)** is small but needs an explicit decision so the diff runner doesn't drift from the Spec #4 pattern.
3. **The flat BaselineDetailView (F7)** means the spec's "add a tab" framing understates the work. The refactor is small but real.
4. **Recompute-button concurrency:** two clicks in quick succession could spawn two compute runs. The `runManager`-with-`diffId`-as-key pattern (F5 option 1) gives us free 409 protection because `runManager.start()` throws if the id is already running. The route handler should catch this and return 409 with `currentStatus='computing'`.
5. **Source-deletion orphans (F1)** are a transient UI state worth thinking about — see Q8.
6. **`status_drift` granularity:** the raw-idea collapses any status code difference into `status_drift`. A 200 vs 201 mismatch is qualitatively different from a 200 vs 500. v1 may want to keep the binary classification (status_match / status_drift) and surface the raw codes for the UI to render — the user can see the codes themselves. v2 could add severity. See Q6.

## Open Questions (Numbered, with My Instinct)

These refine / merge / drop the 11 open questions in the raw-idea, plus a few new ones from the investigation findings.

**1. Body-only comparison or also request-body comparison?**
The diff engine v1 — is it comparing **response bodies only** (since the request is identical by design of replay), or also walking request bodies to surface any drift in what was sent?
My instinct: **response-only for v1**. The request is identical between source and target by construction (the replay carries it through verbatim). Surfacing request-drift adds noise without signal.

**2. Normalization of `response_json` wrapper shape (F2 — biggest concern).**
The source-side baseline items store `response_json` as the raw body; the target-side stores it as `{ headers, body }`. Confirm the diff engine normalizes by unwrapping `body` when the JSON object is an exact `{ headers, body }` envelope?
My instinct: **yes, unwrap symmetrically** with a guarded rule (the JSON has exactly the keys `headers` and `body`, nothing else, otherwise leave verbatim). Cover with a dedicated unit test in the JSON shape comparator.

**3. Volatile-value drift allowlist (F4).**
v1 records `body_value_drift` separately from `body_shape_drift` and treats it as informational. Add a regex-based allowlist for values that legitimately differ (timestamps, ids, sequence numbers) so they don't even register as `body_value_drift`?
My instinct: **no, defer to v2 / Spec #6**. Keep v1 strict; record every differing leaf; mark `body_value_drift` as info-only. Spec #6 (findings integration) is the right place to add per-finding "expected drift" overrides via user input.

**4. Auto-trigger mechanism — self-HTTP-call vs direct local invocation.**
The auto-trigger at the end of `runTargetReplay` can either (a) POST to its own `/diffs` endpoint (treats the runner like an external client; goes through the route handler + same validation), or (b) directly import `diffRunner.runDiff` and invoke it as a fire-and-forget local function.
My instinct: **direct local invocation**. Self-HTTP-calling for a co-located function adds latency, depends on the service's own port being correct, and obscures the call chain in stack traces. Direct invocation is cleaner; the route handler still exists for the manual recompute path.

**5. `runManager` reuse vs parallel manager (F5).**
The existing `runManager` is keyed on `sessionId` and carries scenario counters. The diff has no session and no scenarios. Option 1: reuse `runManager` with `diffId` in the sessionId slot (cheapest, slight semantic stretch). Option 2: add a parallel `diffRunManager` (cleaner, small duplication). Option 3: generalize to opaque `runId` (bigger refactor).
My instinct: **option 1 (reuse with diffId)**. Document the semantic stretch in a code comment. The unused per-scenario counters are harmless.

**6. `status_drift` granularity (new from F11 risk).**
Should `status_drift` be a single classification, or split (e.g. `status_drift_2xx_pair` vs `status_drift_5xx_drift`)? The codes are recorded verbatim in `source_response_status` / `target_response_status` so the UI can render the distinction either way.
My instinct: **single classification for v1**. The raw codes are in the diff_item row; the UI can colour-code 4xx/5xx vs 200/201 mismatches without backend severity. Severity is a Spec #6 / v2 concern.

**7. `source_only` vs `mutating_skipped` distinction (raw-idea Q5).**
When a source item has no paired target (e.g. mutating-skipped, or replay-failed), should the classification be `source_only` for both with notes carrying the reason, or split (e.g. `source_only_mutating_skipped`, `source_only_replay_failed`)?
My instinct: **single classification with notes field carrying the reason**. The notes field is a free-text string; the reason ("mutating skipped" / "transport failure" / "no target item") is human-readable and Spec #6 can pick it up for finding text. Avoids classification proliferation.

**8. Orphaned target (F1) — UI state for source-deleted (new from F1).**
If a target baseline's `paired_with_baseline_id` becomes NULL (source baseline deleted, SET NULL fired), the diff rows are themselves CASCADE-deleted. The drift report tab on the orphaned target has nothing to show. Behaviour: render an empty state ("source baseline has been deleted; no drift report available") OR a more aggressive banner?
My instinct: **empty state with a clear message + disable the Recompute button**. The view still loads; the drift report tab is shown but informs the user the data is gone. No new error surface.

**9. Source baseline showing reverse-drift list (new from F7).**
Should the source baseline (`kind='current'`) ALSO show a "Drift report" tab listing all target-side diffs that point at it? A single source can be replayed multiple times.
My instinct: **defer**. v1 is one-way (target → source). The user navigates to the target baseline to see drift. Reverse-lookup is a v2 concern; the AMS endpoint `GET /diffs/by-source/{sourceBaselineId}` can be added when needed.

**10. Recompute button concurrency — 409 on already-computing (new from F11 #4).**
If the user clicks "Recompute" twice, the second request should 409 because the first is still running (the `runManager` start would throw with the diffId reuse pattern). UI: surface a "Already computing…" toast, button stays disabled while `status='computing'`.
My instinct: **yes, 409 on already-computing; UI disables the button while `status='computing'` and re-polls.**

**11. JSON-diff array comparison strategy (raw-idea Q7).**
Compare arrays as ordered (positional) or unordered (set-like, match by id)?
My instinct: **ordered for v1**. Simpler, deterministic, fits the bounded scope. Unordered+id-based matching is a v2 concern and would require knowing which key is the "id" (out-of-band schema knowledge).

**12. Auto-recompute on baseline item toggle (raw-idea Q6).**
If a user manually rejects a target baseline item (via existing `CaptureReviewPanel` toggle), the target baseline's `updated_at` changes. Auto-recompute the diff?
My instinct: **no — surface as stale**. Already-recommended behaviour; user has a Recompute button. Aggressive recompute is wasteful given the user may toggle multiple items in a session.

**13. Failure on diffing a `draft` target baseline (raw-idea Q9).**
If the diff endpoint is called against a target baseline whose `status='draft'` (not yet finalised), reject with 400 or proceed?
My instinct: **400 reject** with `error='target_baseline_not_finalised'`. A draft baseline is an in-progress capture; diffing it produces misleading results.

**14. Test cap and commit boundary (raw-idea Q10).**
Roughly 20-26 tests across 4 layers; 5-commit cadence (AMS DB, AMS Java, validation service, gateway, frontend)?
My instinct: **yes — same per-layer 5-commit cadence as Spec #4**. Maintains the established rhythm and minimises diff-review surface per commit.

**15. Naming convention (raw-idea Q11).**
Engineering / schema / endpoints use "diff"; user-facing UI uses "drift". Keep the split?
My instinct: **yes, keep the split**. "Diff" is precise; "drift" reads naturally. Consistent with how the raw-idea is written.

## Out-of-Scope Confirmations (carried from raw-idea + reinforced by investigation)

- LLM-assisted classification.
- Header drift detection.
- OAS-schema-aware diff.
- Multi-baseline n-way diff (compare one source against multiple targets in one view).
- Replay-of-the-replay verification.
- Markdown / PDF export of the diff.
- Per-field severity rules.
- Reverse-direction "this source has these targets" lookup (deferred — Q9).

## Accepted Answers (2026-05-25)

User accepted all defaults. Decisions to encode in the spec:

- **Q1 Body-only comparison.** v1 compares response bodies only. Request
  bodies are identical-by-construction (Spec #4 replay carries them verbatim).
- **Q2 Normalize `response_json` wrapper mismatch.** The comparator unwraps
  `body` symmetrically when JSON has EXACTLY the keys `headers` + `body`
  (and nothing else). Any other shape: leave verbatim. Critical — without
  this, every item would be flagged drift.
- **Q3 Volatile-value drift allowlist deferred.** Keep v1 strict. Mark
  `body_value_drift` as informational; Spec #6 layers "expected drift"
  overrides on top via user input.
- **Q4 Auto-trigger via direct local invocation.** At the end of
  `runTargetReplay`, import and call `diffRunner.runDiff(diffId)` directly.
  No self-HTTP-call. Cleaner stack traces, no port dependency, no extra
  latency.
- **Q5 `runManager` reuse with `diffId` in the `sessionId` slot.** Single
  manager; code comment documents the semantic stretch ("sessionId field
  also holds diffIds for diff runs"). Avoids a parallel manager + the
  overhead of generalising the type.
- **Q6 Single `status_drift` classification.** Raw codes (source + target)
  recorded per-item; severity is Spec #6's concern.
- **Q7 Single `source_only` classification.** Notes field carries the
  reason ("mutating_skipped", "transport_failure", "no_paired_target").
  Avoids classification proliferation.
- **Q8 Orphaned target empty state.** When source baseline is deleted
  (CASCADE), the target survives unmoored. Drift report tab renders
  "Source baseline has been deleted; no drift report available" + Recompute
  button disabled.
- **Q9 Source-side reverse-drift list deferred to v2.** v1 navigation is
  one-way: target baseline → drift report. Source baselines do NOT show
  a "Drift report" tab listing all targets pointing at them.
- **Q10 Recompute concurrency: 409 on already-computing.** Second rapid
  click returns HTTP 409; button disabled while `status='computing'`; UI
  polls.
- **Q11 Ordered JSON array comparison.** v1 compares arrays positionally.
  Unordered + match-by-id is a v2 concern (needs schema knowledge).
- **Q12 No auto-recompute on baseline item toggle.** Manual reject changes
  baseline `updated_at`; "Stale" badge surfaces. User clicks Recompute
  explicitly. Aggressive auto-recompute is wasteful.
- **Q13 Reject diff against draft target baseline.** Endpoint returns
  400 `error='target_baseline_not_finalised'` when called against a
  target baseline whose `status` is still `draft`.
- **Q14 Test cap + commit boundary.** ~20-26 tests across 5 layers;
  5-commit per-layer cadence matching Spec #4 (1: AMS DB layer / 2: AMS
  Java app / 3: validation service diff runner + routes + auto-trigger
  line / 4: gateway proxy + client / 5: frontend tab + modal).
- **Q15 Keep "diff" (engineering) vs "drift" (UI) split.** Diff in code/
  schema/endpoints; drift in user-facing copy. Consistent with raw-idea.

**Net effect:** The diff engine ships as a validation-service-side
deterministic runner that walks paired baselines, normalizes the
source/target response_json wrapper mismatch, classifies each scenario,
and persists results in two new AMS tables. UI is a new tab on the
target baseline detail view; auto-computed on target-replay finalisation;
user-recomputable.

