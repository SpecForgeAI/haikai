# Task Breakdown: Stateful Sequence Scenarios (Spec D)

## Overview
Total Tasks: 5 task groups

Strictly-additive support for ordered, mutating, stateful HTTP chains (setup -> act -> cleanup) captured atomically as ONE oracle unit, pinned declaratively with inter-step references, and replayed deterministically at reconcile. Built bottom-up mirroring the A/B/C build layering: AMS persistence -> capture-side discovery/pin -> deterministic replay -> frontend surfacing -> cross-layer test review. The overriding invariant across every group: when `sequence_json` is null, every existing single-shot capture, baseline item, replay, and diff must behave BYTE-FOR-BYTE as today, and A/B/C work must not regress.

## Task List

### AMS Layer (Java / Spring / Postgres)

#### Task Group 1: `sequence_json` column, DTO/mapper/service threading, integrity-hash fold
**Dependencies:** None

Mirror the `volatile_paths_json` write-once / no-PATCH precedent (changeset 187). The integrity-hash fold is the highest-risk sub-task: it MUST be omit-when-null so existing rows hash byte-identical, and MUST NOT bump `CANONICAL_VERSION` (R7).

- [x] 1.0 Complete AMS sequence persistence + hash fold
  - [x] 1.1 Write 2-8 focused tests for the AMS sequence layer
    - Limit to 2-8 highly focused tests maximum
    - Hash-omit-when-null regression test: an item with `sequence_json == null` produces the IDENTICAL canonical content / digest as today's 7-field form (existing seven fields unchanged) -- this is the load-bearing Spec C protection test
    - Hash-includes-sequence-when-present test: a non-null `sequence_json` changes the digest vs the same item with it null (tamper-evidence)
    - One DTO/mapper round-trip test: `sequenceJson` survives `create` -> entity -> `toDto` as snake_case `sequence_json`
    - Skip exhaustive coverage of every field permutation
  - [x] 1.2 Add nullable `sequence_json jsonb` column to `ApiBehaviourBaselineItemEntity`
    - `@Type(JsonType.class)`, `Map<String,Object>`, nullable -- copy the `volatile_paths_json` field declaration shape verbatim
    - No `@PrePersist` defaulting, no backfill; `null` = single-shot item
  - [x] 1.3 Create Liquibase changeset `192-baseline-item-sequence.sql`
    - VERIFY next-free at build time (highest on disk is 191; 192 is free)
    - `ALTER TABLE api_behaviour_baseline_items ADD COLUMN sequence_json jsonb NULL;` column-only
    - Use the `not.columnExists` precondition idiom (per 189/190/191) + `COMMENT ON COLUMN`
    - Register AFTER 191 in `db.changelog-master.yaml`; never edit applied changesets
  - [x] 1.4 Thread `sequenceJson` through DTO + create request (write-once, no PATCH)
    - Add `sequenceJson` (`Map<String,Object>`, OPTIONAL) to `ApiBehaviourBaselineItemDto` and `CreateApiBehaviourBaselineItemRequest` via delegating constructors (same posture as `volatilePathsJson`)
    - Default snake_case wire (`sequence_json`); do NOT apply `@CamelCaseWire` (TS clients are snake_case per CLAUDE.md)
    - No PATCH path -- write-once at create only
  - [x] 1.5 Thread `sequenceJson` through mapper + service
    - `ApiBehaviourMapper.toDto` carries `sequence_json` alongside `volatile_paths_json`
    - `ApiBehaviourBaselineItemService.create` adds `.sequenceJson(request.sequenceJson())` to the builder alongside `volatilePathsJson`
  - [x] 1.6 Fold `sequence_json` into `BaselineContentHashUtil.itemContent` (ADDITIVE, NULL-OMITTED)
    - Include the key in the canonical per-item content ONLY when `sequence_json` is non-null; OMIT it entirely when null (serializing `null` would change the digest)
    - Keep `CANONICAL_VERSION = 1` -- do NOT bump (Spec C `verifyIntegrity` is not version-dispatched; a bump would false-mismatch existing v1 baselines)
    - Reuse `UserJourneyDiagramHashUtil.computeCanonicalHash` for SHA-256 (no new crypto)
    - Document in Javadoc + changeset comment that `sequence_json` participates in the hash when present, and that omit-when-null is the explicit override of any "bump to v2" suggestion
  - [x] 1.7 Ensure AMS layer compiles + the 2-8 focused tests pass
    - Run AMS compile
    - Run ONLY the 2-8 tests written in 1.1
    - Do NOT run the entire AMS test suite at this stage
  - [x] 1.8 No-regression check: existing baselines hash byte-identical
    - Confirm the hash-omit-when-null test proves an existing/single-shot row's digest is unchanged
    - Confirm `CANONICAL_VERSION` is still 1
    - Confirm no edits to applied changesets and no regression of A/B/C (Spec C) integrity behaviour

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass; AMS compiles
- `sequence_json` nullable jsonb column exists via changeset 192 with `not.columnExists` precondition, registered after 191
- `sequenceJson` round-trips through DTO/request/mapper/service as snake_case, write-once with no PATCH
- An item with `sequence_json == null` hashes BYTE-IDENTICAL to today's 7-field canonical form; `CANONICAL_VERSION` stays 1
- A non-null `sequence_json` is folded into the hash (tamper-evidence) when present

### validation-service Capture Layer (Node / TS)

#### Task Group 2: `pin_sequence` terminal tool + orchestrator sequence assembly + ref-derived volatility
**Dependencies:** Task Group 1

The LLM is the only actor that knows step roles + refs; replay never re-derives them. A sequence stays ONE GeneratedScenario -> ONE CoverageDimensionResult (no rubric inflation). Ref-derived volatility (R3) records referenced fields into the EXISTING `volatile_paths_json` envelope so the diff side needs no change.

- [x] 2.0 Complete capture-side sequence discovery + pin + ref-derived volatility
  - [x] 2.1 Write 2-8 focused tests for the capture layer
    - Limit to 2-8 highly focused tests maximum
    - `pin_sequence` declaration validation: rejects malformed input (not exactly one act step, invalid role/kind, a ref pointing to a non-earlier step) with a `ToolValidationError`; accepts a valid setup->act->cleanup declaration
    - Orchestrator assembly: a valid pin declaration + ordered `getScenarioCaptures` produces a well-formed `sequence_json` (correct `steps`, `act_step_index`, `cleanup_best_effort`, `$N.<path>` refs with parsed `from_step`/`json_path`)
    - Ref-derived volatility: referenced `$N.<path>` fields + `extractIdentifierFacts` generated ids land in the `volatile_paths_json` envelope via `volatilityEnvelopeToWire`
    - One-dimension assertion: a sequence scenario yields ONE `CoverageDimensionResult` (no N-dimension inflation)
    - Skip exhaustive coverage of all ref/jsonpath permutations
  - [x] 2.2 Add the new `pin_sequence` terminal tool in `services/tools/`
    - Place alongside `record_capture_note` / `record_scenario_candidate`; register in `tools/index.ts`
    - Mark `terminal: true` so it exits the per-scenario loop like `record_capture_note`
    - Schema: LLM declares per-executed-call role (`setup`/`act`/`cleanup`), the act step, and each inter-step ref `$N.<jsonpath>`
    - Validate the declaration (exactly one act step; valid roles/kinds; refs point to EARLIER steps); raise `ToolValidationError` on malformed input
  - [x] 2.3 Assemble `sequence_json` in the orchestrator
    - Hook the per-scenario block of `captureSessionOrchestrator.ts` AFTER `runScenarioLoop` returns, around `selectCanonicalCapture` (~:1313, the `runManager.getScenarioCaptures` snapshot point)
    - Build `sequence_json` from the pin declaration + the ordered `runManager.getScenarioCaptures(session.id)` (each capture's request/response in attempt order), substituting the volatile ids the LLM observed with `$N.<path>` placeholders
    - Shape: `{ steps: [ { index, role, kind: 'http', request: {method,path,query,headers,body}, expected_status, response_refs: [{ ref, from_step, json_path }] } ], act_step_index, cleanup_best_effort: true }` (snake_case wire)
    - `null` for every non-sequence scenario (the existing path is untouched)
  - [x] 2.4 Keep the sequence as ONE coverage dimension
    - Do NOT add a second coverage definition; `selectCanonicalCapture` / `scoreEndpointCoverage` path stays unchanged -- one `GeneratedScenario` -> one `CoverageDimensionResult`
  - [x] 2.5 Implement ref-derived mutating-id volatility (R3, REF-DERIVED not probe-derived)
    - KEEP the `volatilityProbe.ts:167-169` mutating-skip guard untouched (re-running mutating calls k times would create k resources)
    - Derive id-tolerance from the PINNED inter-step refs: every `$N.<path>` referenced field + the `extractIdentifierFacts` generated-id fields are expected-volatile by construction
    - Record those paths into the SAME `volatile_paths_json` envelope via `volatilityEnvelopeToWire` so the diff/reconcile side needs NO change
  - [x] 2.6 Persist `sequence_json` through the pin -> baseline path
    - Carry the assembled `sequence_json` through `archModelClient.createBaselineItem` alongside `volatile_paths_json`
  - [x] 2.7 Ensure capture layer typechecks + the 2-8 focused tests pass
    - Run `npx tsc --noEmit`
    - Run ONLY the 2-8 tests written in 2.1 (targeted)
    - Do NOT yet run the full suite at this sub-task
  - [x] 2.8 No-regression check: full suite + single-shot capture unchanged
    - Run FULL `npx jest` -- must stay green (currently 315 pass / 1 skip after Spec C)
    - Confirm non-sequence scenarios still assemble with `sequence_json == null` and the single-shot capture path / coverage rubric is unchanged; no A/B/C regression

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass; `npx tsc --noEmit` clean
- `pin_sequence` is a registered terminal tool that validates declarations and rejects malformed input with `ToolValidationError`
- Orchestrator assembles a well-formed snake_case `sequence_json` from the pin declaration + ordered captures; `null` for non-sequence scenarios
- A sequence remains ONE `CoverageDimensionResult` (no rubric inflation)
- Ref-derived + `extractIdentifierFacts` volatile paths are recorded into the existing `volatile_paths_json` envelope
- FULL `npx jest` stays green (315 pass / 1 skip); single-shot capture + A/B/C unaffected

### validation-service Reconcile Layer (Node / TS)

#### Task Group 3: deterministic ordered-step sub-runner + diagnostics
**Dependencies:** Task Groups 1, 2

Detect `item.sequence_json != null` in the per-item loop (`targetReplayRunner.ts` ~:471-663) and hand it to a NEW ordered-step sub-runner. Non-sequence items take the existing single-shot path BYTE-FOR-BYTE unchanged. Reuse the Spec B diff machinery verbatim for the act step -- NO new diff engine, NO new pairing granularity.

- [x] 3.0 Complete the deterministic sequence replay sub-runner + diagnostics
  - [x] 3.1 Write 2-8 focused tests for the reconcile layer
    - Limit to 2-8 highly focused tests maximum
    - Ref resolution: `$N.<jsonpath>` resolves correctly from a prior step's LIVE response and is threaded into a later step's request
    - Setup-fail semantics: a setup step missing its `expected_status` fails the whole sequence with `sequence_setup_failed`; the act step is NOT reached / NOT diffed
    - Act-step diff: the act response promotes to a target baseline-item (`{headers,body}` wrapper) and pairs at `${method}|${path}|${scenarioName}`, fully diffed via Spec B fidelity + volatile tolerance
    - Skip gate: a sequence without `mutating_calls_confirmed` emits `sequence_skipped` (NOT the generic `mutating_skipped`), never silently dropped
    - Cleanup-fail: a failed cleanup step flags `sequence_cleanup_failed` / `sequence_residual_pollution` and does NOT fail the sequence or crash the runner
    - Skip exhaustive coverage of every diagnostic/diff combination
  - [x] 3.2 Add the sequence dispatch branch to the per-item replay loop
    - In `targetReplayRunner.runTargetReplay`, detect `item.sequence_json != null` inside the per-item loop and hand it to the new ordered-step sub-runner
    - Non-sequence items take the EXISTING single-shot path unchanged (byte-for-byte)
  - [x] 3.3 Implement the ordered-step sub-runner (NO LLM)
    - Resolve `$<step>.<jsonpath>` refs from earlier steps' LIVE target responses
    - Run steps in declared order via the per-session executor, reusing the `extractItemRequest` `{method,path,query,headers,body}` shape
    - Reject/skip non-`http` `kind` at replay with a diagnostic (only `http` is implemented)
  - [x] 3.4 Enforce setup-step assertions
    - ASSERT each setup step reaches its `expected_status` (status-only, NOT full-body-diffed)
    - A failed setup fails the whole sequence with a clear `sequence_setup_failed` diagnostic; the act step is NOT reached
  - [x] 3.5 Diff the act step via the existing Spec B path
    - Promote the act step's response to a target baseline-item (`{headers,body}` wrapper)
    - pairKey = act step's `${method}|${path}|${scenarioName}` (the existing `diffRunner.ts:121` key shape)
    - FULLY DIFF via `compareJsonShapes` + `buildVolatilityContext` + the source item's volatile envelope -- reuse verbatim, NO new diff engine, NO new pairing granularity
  - [x] 3.6 Run cleanup best-effort + surface isolation outcomes
    - Cleanup DELETEs run under the same `mutating_calls_confirmed` flag, best-effort
    - On cleanup failure or absent cleanup endpoint: emit `sequence_cleanup_failed` / `sequence_residual_pollution` and set a flag on the sequence replay result / break `detail_json`; do NOT fail the sequence on cleanup error; bounded + FLAGGED, never pretended-clean
  - [x] 3.7 Add the new diagnostic types
    - Add `sequence_skipped`, `sequence_setup_failed`, `sequence_cleanup_failed`, `sequence_residual_pollution` to `TargetReplayDiagnosticType`
    - A sequence without `mutating_calls_confirmed` emits `sequence_skipped` (distinct from the generic per-call `mutating_skipped`), never silently dropped
    - Reuse the existing `emitDiagnostic` best-effort persistence path
  - [x] 3.8 Ensure reconcile layer typechecks + the 2-8 focused tests pass
    - Run `npx tsc --noEmit`
    - Run ONLY the 2-8 tests written in 3.1 plus targeted `targetReplayRunner` / `diffRunner` tests
    - Do NOT yet run the full suite at this sub-task
  - [x] 3.9 No-regression check: full suite + single-shot replay/diff unchanged
    - Run FULL `npx jest` -- must stay green
    - Confirm non-sequence items take the existing single-shot replay + diff path byte-for-byte unchanged; no A/B/C regression

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass; `npx tsc --noEmit` clean
- Sequence-bearing items replay deterministically (no LLM) with ordered ref resolution; non-sequence items unchanged
- Setup steps are status-asserted; a failed setup fails the sequence (`sequence_setup_failed`) and the act is not diffed
- The act step is fully diffed via the existing Spec B machinery at the act-step pairKey (no new diff engine)
- Cleanup runs best-effort; failures/pollution are surfaced as a diagnostic AND a result/`detail_json` flag, never crashing the runner
- An unconfirmed sequence emits `sequence_skipped`, not the generic `mutating_skipped`
- FULL `npx jest` stays green; single-shot replay/diff + A/B/C unaffected

### Frontend Layer (React / TS)

#### Task Group 4: surface sequence steps, refs, cleanup status, pollution flag
**Dependencies:** Task Groups 1, 2, 3

Carry `sequence_json` through the pin-to-baseline flow (mirror the `volatile_paths_json` carry) and render the sequence on the baseline-detail + reconcile-break surfaces. Repo has ~515 pre-existing unrelated tsc errors, so verify via changed-file typecheck only.

- [x] 4.0 Complete frontend sequence surfacing
  - [x] 4.1 Write 2-8 focused tests (focused vitest) for the frontend
    - Limit to 2-8 highly focused tests maximum
    - `SaveAsBaselineModal` carries `sequence_json` through `createBaselineItem` (mirroring the `volatile_paths_json` carry)
    - `BaselineDetailView` renders a sequence's ordered steps + roles + inter-step refs
    - `MigrationDeliveryReconciliationPanel` renders a sequence break with cleanup status + residual-pollution flag
    - Skip exhaustive rendering/state coverage
  - [x] 4.2 Add sequence fields to the frontend baseline item type
    - Add `sequence_json` (and any cleanup/pollution result fields read from `detail_json`) to the frontend baseline item type used by `apiBehaviourClient.ts`
  - [x] 4.3 Carry `sequence_json` through `SaveAsBaselineModal.tsx`
    - Thread `sequence_json` into the `createBaselineItem` call alongside the existing `volatile_paths_json` carry
  - [x] 4.4 Render the sequence in `BaselineDetailView.tsx`
    - Show ordered steps, each step's role (setup/act/cleanup), and inter-step `$N.<path>` references
  - [x] 4.5 Surface sequence outcomes in `MigrationDeliveryReconciliationPanel.tsx`
    - Show sequence breaks, setup-status assertions, the act diff, cleanup status, and the residual-pollution flag from the result / break `detail_json`
  - [x] 4.6 Ensure changed-file typecheck + focused vitest pass
    - Run a CHANGED-FILE typecheck (repo has ~515 pre-existing unrelated tsc errors -- do NOT gate on the full-repo tsc count)
    - Run ONLY the 2-8 focused vitest tests from 4.1
  - [x] 4.7 No-regression check: single-shot baseline + reconcile surfaces unchanged
    - Confirm non-sequence baseline items + single-shot reconcile breaks render exactly as today (sequence UI is conditional on `sequence_json` present)
    - Confirm no new tsc errors introduced in changed files; no A/B/C surface regression

**Acceptance Criteria:**
- The 2-8 focused vitest tests from 4.1 pass; no new tsc errors in changed files
- `sequence_json` is carried through the Save-as-baseline flow (mirroring `volatile_paths_json`)
- Baseline-detail renders ordered steps, roles, and inter-step refs
- The reconcile panel surfaces sequence breaks, cleanup status, and the residual-pollution flag
- Non-sequence baseline items + single-shot reconcile surfaces render unchanged

### Cross-Layer Test Review

#### Task Group 5: cross-layer invariant review + gap fill (max 10 added tests)
**Dependencies:** Task Groups 1-4

Review the focused tests from Groups 1-4 and fill ONLY critical load-bearing-invariant gaps for THIS feature. Maximum 10 new tests. Do not assess whole-application coverage.

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review the focused tests from Task Groups 1-4
    - Group 1 (AMS, 2-8), Group 2 (capture, 2-8), Group 3 (reconcile, 2-8), Group 4 (frontend, 2-8)
    - Total existing: approximately 8-32 tests
  - [x] 5.2 Analyze coverage gaps for the load-bearing invariants ONLY
    - Focus exclusively on this spec's invariants; do NOT assess the whole application
    - Target invariants: deterministic replay resolves `$N.id` refs correctly end-to-end; ref-derived id tolerance (generated id change -> NOT a break; real non-volatile change -> STILL breaks); setup-fail -> sequence fails (act not diffed); cleanup-fail -> flagged not crashed; sequence requires `mutating_calls_confirmed` (else `sequence_skipped`); integrity hash byte-identical when `sequence_json` null; NO regression of single-shot capture/reconcile or A/B/C
  - [x] 5.3 Write up to 10 additional strategic tests maximum
    - Maximum of 10 new tests to fill identified critical invariant gaps (prioritize end-to-end / integration points)
    - Especially: the ref-derived id-tolerance pair (generated id change tolerated AND a genuinely-changed non-volatile field still breaks) end-to-end through capture-volatility -> reconcile-diff
    - Do NOT write comprehensive coverage; skip edge cases / performance / accessibility unless business-critical
  - [x] 5.4 Run feature-specific tests only + full no-regression sweep
    - Run the feature-specific tests (Groups 1-4 + the up-to-10 added here): approximately 18-42 tests
    - Run FULL `npx jest` (validation-service) -- must stay green (315 pass / 1 skip baseline); confirm single-shot + A/B/C unaffected
    - Confirm AMS focused tests + the hash-omit-when-null regression still pass
    - Do NOT run the entire application test suite beyond the validation-service full jest no-regression sweep

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 18-42 tests total)
- The load-bearing invariants are covered: ref resolution, ref-derived id tolerance (both directions), setup-fail, cleanup-fail-flagged, skip-gate, hash-omit-when-null
- No more than 10 additional tests added
- FULL `npx jest` stays green (315 pass / 1 skip); no regression of single-shot capture/reconcile or A/B/C

## Execution Order

Recommended implementation sequence (bottom-up, mirroring the A/B/C builds):
1. AMS Layer -- `sequence_json` column, DTO/mapper/service, integrity-hash fold (Task Group 1)
2. validation-service Capture -- `pin_sequence` tool, orchestrator assembly, ref-derived volatility (Task Group 2)
3. validation-service Reconcile -- deterministic ordered-step sub-runner + diagnostics (Task Group 3)
4. Frontend -- surface steps/refs/cleanup/pollution (Task Group 4)
5. Cross-layer test review + gap fill (Task Group 5)

Each group ends with explicit verification sub-tasks and a "no regression of the single-shot path or A/B/C" check.
