# Specification: Stateful Sequence Scenarios (Spec D)

## Goal
Give the oracle faithful MUTATING + STATEFUL support: capture an ordered HTTP chain (setup -> act -> cleanup) atomically as ONE oracle unit, pin it declaratively with inter-step references, and replay it deterministically at reconcile — strictly additive over the existing single-shot path (Spec D of the A/B/C series).

## User Stories
- As a migration engineer, I want a scenario that needs a precondition (e.g. `POST /filters/submitForReview` needs a private un-promoted filter to exist) to be captured as a setup-then-act chain so the act step actually exercises real behaviour instead of failing on missing state.
- As a migration engineer, I want a mutating endpoint's generated id (in a 201) to be tolerated at reconcile and threaded forward to later steps, so a new id capture->replay is NOT a false break while a genuinely-changed non-volatile field STILL breaks.
- As a reviewer, I want a sequence's steps, inter-step refs, setup assertions, act diff, cleanup status, and any residual pollution surfaced in the capture-review / baseline-detail / reconcile-break surfaces.

## Specific Requirements

**AMS `sequence_json` column (changeset 192)**
- Add a NULLABLE `sequence_json jsonb` column on `ApiBehaviourBaselineItemEntity` (`@Type(JsonType.class)`, `Map<String,Object>`), mirroring `volatile_paths_json` (changeset 187): `null` = today's single-shot item (zero regression), non-null = the pinned ordered chain. No `@PrePersist` defaulting; no backfill.
- New changeset `192-baseline-item-sequence.sql` — verify next-free at build time (highest on disk is 191). Column-only `ALTER TABLE api_behaviour_baseline_items ADD COLUMN sequence_json jsonb NULL;` with the `not.columnExists` precondition idiom + `COMMENT ON COLUMN`, registered AFTER 191 in `db.changelog-master.yaml`. Never edit applied changesets.
- Steps are read as ONE UNIT at reconcile (no independent step queryability needed in v1); a single column is correct, NOT a child entity/table.

**`sequence_json` shape (snake_case wire)**
- `{ steps: [ { index, role: 'setup'|'act'|'cleanup', kind: 'http', request: { method, path, query, headers, body }, expected_status, response_refs: [ { ref: '$<stepIndex>.<jsonpath>', from_step, json_path } ] } ], act_step_index, cleanup_best_effort: true }`.
- `kind` is present on EVERY step; ONLY `'http'` is implemented now — reserve `'sql'`/`'e2e'` as future values but do NOT build them (reject/skip non-http at replay with a diagnostic).
- Exactly ONE step has `role: 'act'` (pointed to by `act_step_index`); 0..N `setup` steps precede it; 0..N `cleanup` steps follow.
- Inter-step references use `$<stepIndex>.<jsonpath>` (e.g. `$1.id`) — a value pulled from an EARLIER step's LIVE response at replay; `from_step` + `json_path` are the parsed components carried alongside the raw `ref`.
- All AMS sequence DTOs default to snake_case (CLAUDE.md AMS wire); do NOT apply `@CamelCaseWire` (the TS clients are snake_case).

**AMS DTO + mapper + service threading**
- Add `sequenceJson` (`Map<String,Object>`) to `ApiBehaviourBaselineItemDto` and `CreateApiBehaviourBaselineItemRequest` (OPTIONAL, write-once at create, no PATCH path — same posture as `volatilePathsJson`).
- Thread it through `ApiBehaviourMapper.toDto` and `ApiBehaviourBaselineItemService.create` (`.sequenceJson(request.sequenceJson())` in the builder) alongside `volatilePathsJson`.

**Integrity-hash fold (protect Spec C — ADDITIVE, NULL-OMITTED)**
- Fold `sequence_json` into `BaselineContentHashUtil.itemContent` ONLY when non-null: OMIT the key entirely when null so every existing baseline + single-shot item hashes BYTE-IDENTICAL to today's canonical form (serializing `null` would change the digest).
- Do NOT bump `CANONICAL_VERSION` (stays `1`): Spec C's `verifyIntegrity` is NOT version-dispatched, so a bump would recompute existing v1 baselines under v2 and false-mismatch them.
- Document (Javadoc + changeset comment) that `sequence_json` participates in the hash when present (tamper-evidence of the pinned chain); the omit-when-null rule is the explicit override of any "bump to v2" suggestion.

**Capture-side: a new terminal pin tool**
- Add a NEW terminal tool (e.g. `pin_sequence`) alongside `record_capture_note` / `record_scenario_candidate` in `services/tools/`, registered in `tools/index.ts`. Mark it `terminal: true` so it exits the per-scenario loop like `record_capture_note`.
- The LLM calls it to DECLARE: which executed calls were `setup`/`act`/`cleanup`, the act step, and each inter-step ref (`$N.<jsonpath>`). The LLM is the only actor that knows roles + refs; replay never re-derives them.
- Validate the declaration (one act step, valid roles/kinds, refs point to earlier steps) and surface a `ToolValidationError` on malformed input.

**Capture-side: orchestrator sequence assembly**
- Hook in the per-scenario block of `captureSessionOrchestrator.ts` AFTER `runScenarioLoop` returns, around `selectCanonicalCapture` (the existing `runManager.getScenarioCaptures` snapshot point).
- Assemble `sequence_json` from the pin-tool declaration + the ordered `runManager.getScenarioCaptures(session.id)` (each capture's request/response in attempt order), substituting the volatile ids the LLM observed with `$N.<path>` placeholders.
- A sequence stays ONE `GeneratedScenario` -> ONE `CoverageDimensionResult`: it must NOT inflate the per-endpoint rubric into N dimensions (`selectCanonicalCapture` / `scoreEndpointCoverage` path unchanged).
- Carry the assembled `sequence_json` through to the baseline item at pin time (via the capture row / Save-as-baseline flow); `null` for every non-sequence scenario.

**Capture-side: ref-derived mutating-id volatility (REF-DERIVED, not probe-derived)**
- KEEP the `volatilityProbe.ts:167-169` mutating-skip guard — re-running mutating calls k times would create k resources.
- Derive id-tolerance from the PINNED inter-step references: any response field referenced as `$N.<path>` (plus the generated-id fields from `extractIdentifierFacts`) is by construction expected-volatile.
- Record those paths into the SAME `volatile_paths_json` envelope shape via `volatilityEnvelopeToWire` so the diff/reconcile side needs NO change to tolerate them. A genuinely-changed NON-volatile field still breaks (oracle invariant intact).

**Reconcile: deterministic ordered-step sub-runner**
- In `targetReplayRunner.runTargetReplay`, detect a sequence-bearing item (`sequence_json` non-null) inside the per-item loop and hand it to a NEW ordered-step sub-runner; non-sequence items take the existing single-shot path BYTE-FOR-BYTE unchanged.
- Replay pinned steps in order with NO LLM: resolve `$N.<jsonpath>` refs from earlier steps' LIVE target responses, send each step via the per-session executor (reuse `extractItemRequest` shape for `{method,path,query,headers,body}`).
- Setup steps: ASSERT each reaches its `expected_status` (status-only, not full-body-diffed). A failed setup fails the whole sequence with a clear diagnostic; the act step is NOT reached.
- Act step: promote to a target baseline-item (Spec B `{headers,body}` wrapper) and FULLY DIFF via `compareJsonShapes` + `buildVolatilityContext` + the source item's volatile envelope (reuse verbatim — NO new diff engine).
- Cleanup steps: run best-effort (DELETEs are mutating, under the same confirmation); flag on failure, do not fail the sequence on cleanup error.

**Reconcile: pairing + diff granularity**
- pairKey = the ACT step's `${method}|${path}|${scenarioName}` (the existing `diffRunner.ts:121` key shape). The diff_item / break IS the sequence's act step; single-shot pairing is unchanged.
- The act-step diff reuses the Spec B fidelity classifications (status/headers/body-shape/body-value/ordering + volatile tolerance) so a sequence break is indistinguishable in machinery from a single-shot break.

**Mutating confirmation gate (capture AND replay)**
- A sequence is inherently mutating: it requires `mutating_calls_confirmed=true` to CAPTURE and to REPLAY; cleanup DELETEs run under the same flag.
- A sequence skipped for lack of confirmation is surfaced via a DISTINCT diagnostic `sequence_skipped` (NOT the generic per-call `mutating_skipped`), never silently dropped.

**Diagnostics + result surfacing for isolation/skip**
- Add sequence diagnostic types to `TargetReplayDiagnosticType`: `sequence_skipped` (no confirmation), `sequence_setup_failed` (a setup step missed its `expected_status`), `sequence_cleanup_failed` / `sequence_residual_pollution` (cleanup failed or no cleanup endpoint exists).
- Residual pollution and cleanup failures are surfaced BOTH as a distinct diagnostic AND as a flag on the sequence replay result / break `detail_json` so the frontend can render them. Pollution is bounded and FLAGGED, never pretended-clean.

## Visual Design
No visual assets provided (the `planning/visuals/` directory is empty). The feature reuses the existing capture-review / baseline-detail / reconcile-break surfaces; no bespoke widget mockup was supplied (matching the A/B/C stance).

## Existing Code to Leverage

**`BaselineContentHashUtil.itemContent` (`architecture-model-service/.../util/`)**
- Builds the per-item canonical content (`method/path/scenario_name/request_json/response_status/response_json/volatile_paths_json`). Add `sequence_json` ONLY when non-null; keep `CANONICAL_VERSION = 1`; relies on `UserJourneyDiagramHashUtil.computeCanonicalHash` for the SHA-256 pipeline (no new crypto).

**`volatilePathsJson` precedent (entity + DTO + mapper + service, changeset 187)**
- `ApiBehaviourBaselineItemEntity` nullable-jsonb column, `ApiBehaviourBaselineItemDto` / `CreateApiBehaviourBaselineItemRequest` optional field, `ApiBehaviourMapper.toDto`, `ApiBehaviourBaselineItemService.create` builder line — copy this exact shape for `sequence_json` (write-once, no PATCH).

**`volatilityProbe.ts` (`volatilityEnvelopeToWire`, mutating guard :167-169)**
- Keep the mutating-skip guard untouched. Reuse `volatilityEnvelopeToWire` to emit the ref-derived volatile paths into the SAME `volatile_paths_json` envelope the diff engine already consumes.

**`targetReplayRunner.runTargetReplay` + `extractItemRequest` + `emitDiagnostic`**
- The deterministic per-item replay shell, the `{method,path,query,headers,body}` request extraction, the `{headers,body}` promotion wrapper, the transport-failure counter, and the best-effort diagnostic persistence — extend (not replace) for the ordered-step sub-runner and the new diagnostic types.

**`captureSessionOrchestrator.ts` per-scenario block + `runManager.getScenarioCaptures` / `selectCanonicalCapture` / `scoreEndpointCoverage`**
- The post-`runScenarioLoop` hook point, the ordered scenario-capture snapshot, the canonical selection, and the one-dimension-per-`GeneratedScenario` rubric — assemble `sequence_json` here without adding a second coverage definition. `record_capture_note` is the terminal-tool template for the new pin tool.

**`compareJsonShapes` / `buildVolatilityContext` / `pairKey` (`jsonShapeComparator.ts`, `diffRunner.ts`) + frontend surfaces**
- The Spec B fidelity diff for the act step, the volatility context builder, the `${method}|${path}|${scenarioName}` pairKey, and `SaveAsBaselineModal` / `BaselineDetailView` / `MigrationDeliveryReconciliationPanel` / `apiBehaviourClient.ts` (`ApiBehaviourBaselineItemDto`, `CreateApiBehaviourBaselineItemRequest`, the `detail_json` readers) for surfacing steps/refs/cleanup/pollution.

## Out of Scope
- Implementing non-`http` step kinds (`sql` DB-reconciliation, `e2e` Playwright) — model headroom (`kind` field) only.
- Building any isolation strategy beyond self-clean-via-HTTP (DB-reset/seed, fresh-target-per-run) — pluggable seam only, not built.
- LLM-dynamic replay — replay is deterministic with NO LLM.
- Human-declared-only authoring — authoring is hybrid (LLM-discover-then-pin).
- Backfill of existing baselines or single-shot items with `sequence_json`.
- Bumping `CANONICAL_VERSION` / version-dispatching Spec C's `verifyIntegrity`.
- A child `api_behaviour_sequence` / `..._step` entity or table (single jsonb column only).
- A second coverage-rubric definition or per-step rubric dimensions (one sequence = one dimension).
- A new diff engine or new pairing granularity (reuse `compareJsonShapes` + the act-step pairKey).
- ANY regression of A/B/C work or existing single-shot capture / replay / diff (must stay byte-for-byte identical when `sequence_json` is null).
