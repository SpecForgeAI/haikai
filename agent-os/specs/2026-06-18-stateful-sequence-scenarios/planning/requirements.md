# Spec Requirements: Stateful Sequence Scenarios (Spec D)

## Initial Description

(From `planning/raw-idea.md` — "Spec D" after the A/B/C oracle-standard series; item 3 of the Oracle-standard roadmap.)

The oracle cannot faithfully capture/reconcile MUTATING endpoints or STATEFUL flows. Three concrete gaps:
1. Reconcile re-issues captured requests against the target as black-box HTTP with NO rollback/transaction/reset and NO target-DB access (`targetReplayRunner` fires mutating requests when `mutating_calls_confirmed=true`, else skips them).
2. The scenario `preconditions` field is text-only, never executed; no scenario chaining exists (only opportunistic id-harvesting via `extractIdentifierFacts`).
3. The volatility probe SKIPS mutating endpoints, so a generated id in a 201 response is compared strictly and throws a false break on replay.

Known failing case: `POST /filters/submitForReview` needs a private, un-promoted filter to exist first.

The requester has pre-locked the key design decisions (1–6 + reconcile semantics, reproduced below). This spec was shaped by direct codebase research against that locked design; there was no interactive end-user Q&A. The clarifying questions below carry a "Locked?" verdict each (see the final orchestrator-facing response) — the orchestrator answers the open ones from the locked design; only genuinely material + undecided questions go back to the end user.

## Requirements Discussion

### Locked Decisions (fixed — do NOT relitigate)

1. **CORE ABSTRACTION = "stateful sequence scenario"**: a scenario becomes an ORDERED HTTP chain — setup/create step(s) → the ACT (behaviour under test) → optional CLEANUP step(s) — captured atomically as ONE oracle unit. Covers mutating safety + stateful preconditions + idempotency.
2. **AUTHORING = HYBRID**: the LLM DISCOVERS the chain + real ids during CAPTURE; PIN it as an explicit, ordered, DECLARATIVE step list with inter-step references (id placeholders, e.g. `$1.id` = a field extracted from step 1's response, JSONPath-ish). RECONCILE replays the pinned steps DETERMINISTICALLY with NO LLM. Not LLM-dynamic-replay; not human-declared-only.
3. **ISOLATION = self-clean-via-HTTP**: sequences DELETE the resources they create; where no cleanup endpoint exists, accept BOUNDED, FLAGGED residual pollution (surface it, never pretend clean). Isolation must be PLUGGABLE (future DB-reset/seed or fresh-target-per-run strategy slots in without changing the sequence model).
4. **TRANSPORT extensible but HTTP-ONLY today**: each step has a `kind` field — `http` is the ONLY implemented kind now; RESERVE room for future `sql` (DB reconciliation) and `e2e` (Playwright) kinds WITHOUT building them now.
5. **MUTATING-ID VOLATILITY**: extend the volatility handling (which today SKIPS mutating endpoints — `volatilityProbe.ts` ~:167-169) so generated ids in MUTATING responses are tolerated at reconcile AND threaded forward to later steps via the inter-step references. A generated id changing capture→replay must NOT be a false break; a genuinely-changed NON-volatile field still MUST break (oracle invariant preserved).
6. **SCOPE = ONE coherent spec**, built as ordered task groups (AMS sequence model → capture-side sequence builder/pin → deterministic replay engine → reconcile incl. id-volatility → frontend) — NOT split into multiple specs.

**RECONCILE SEMANTICS (decided)**: replay the pinned sequence against the target; ASSERT setup steps reach their expected status (means-to-an-end, not necessarily full-body-diffed); FULLY DIFF the ACT step's response reusing Spec B's full-response fidelity (status/headers/body-shape/body-value/ordering + volatile tolerance); CLEANUP is best-effort + flagged on failure.

### First Round Questions

See the final orchestrator-facing response for the numbered clarifying questions with "Locked?" verdicts. They are not duplicated here to avoid drift; the answers will be filled from the locked design once the orchestrator confirms.

### Existing Code to Reference

**Capture orchestrator + scenario model (TS, `api-migration-validation-service`):**
- `src/services/captureSessionOrchestrator.ts` — `orchestrateCaptureSession` (line 1099) is the per-session driver. `defaultScenarioSet` (line 942) builds the per-operation rubric of `GeneratedScenario[]` (line 480: `{ name, type, expectedStatus, directive }`); the per-scenario loop (lines 1224-1389) creates a draft scenario row (`createScenario`, line 1259), runs `runScenarioLoop`, then does Phase-2 intent-driven canonical capture via `selectCanonicalCapture` (line 527) and `safeRejectNonCanonicalCapture` (line 1080). Oracle Coverage Scoring is computed inline: `scoreEndpointCoverage` (line 682) consumes the SAME `GeneratedScenario[]` array as one-dimension-per-scenario (line 569 `CoverageDimensionResult`). `buildScenarioPrompt` (line 310) assembles the LLM prompt. `NON_CANONICAL_REVIEWER_NOTE` (line 505).
- `src/services/captureLoopRunner.ts` — `runScenarioLoop` (line 117): the per-scenario LLM tool-call loop (12 rounds / 30s per call / 5min wall-clock, from `config.ts`). The LLM never executes HTTP directly — only via the registered tools. The terminal tool (`record_capture_note`) exits the loop.
- `src/services/tools/execute_http_request.ts` — the ONLY path to a real HTTP call. `extractIdentifierFacts` (line 113, harvests up to 5 id-ish keys from a 2xx body — the opportunistic precursor to inter-step refs). Mutating gate `safe_to_execute || mutatingCallsConfirmed` (lines 328-352). Capture-time volatility probe call (lines 573-602; skipped for mutating/non-2xx/auth-override). Per-attempt capture persistence + `runManager.recordScenarioCapture` (line 726). Tool schema (line 845: `operationId/method/path/query/headers/body/authMode`).
- `src/services/tools/index.ts` + `record_capture_note.ts` + `record_scenario_candidate.ts` — the tool registry; `record_scenario_candidate` is how the LLM registers extra scenario variants today.
- `src/services/runManager.ts` — per-session lifecycle handle; holds `scenarioCaptures` (reset per `beginScenario`), `learnedFacts`, `scenarioHttpAttempts`, abort signal.

**Baseline / oracle persistence (Java/Spring/Postgres, `architecture-model-service`):**
- `model/entity/apibehaviour/ApiBehaviourBaselineItemEntity.java` — the frozen oracle row. Columns: `method`/`path`/`scenario_name` (NOT NULL), `request_json` (jsonb NOT NULL), `response_status` (boxed Integer NOT NULL), `response_json` (jsonb NOT NULL), `volatile_paths_json` (jsonb nullable, changeset 187), `business_notes`. This is the unit a sequence must extend or sit beside.
- `util/BaselineContentHashUtil.java` — Spec C's integrity hash (`computeContentHash`, line 77). Canonical form (canonical_version 1): items sorted by `(method, path, scenario_name)`; per-item hashed content = `method, path, scenario_name, request_json, response_status, response_json, volatile_paths_json` (line 117 `itemContent`). **A sequence's pinned steps MUST be coherently covered by / extend this hash** (see Technical Considerations).
- `service/apibehaviour/ApiBehaviourBaselineService.java` — `verifyIntegrity` (line 172) recomputes the hash; activation stamp (`stampActivation`, line ~302) sets `content_hash` + `provenance_json`. Hashing is done ENTIRELY in Java; the TS side only CONSUMES the verdict.
- `controller/apibehaviour/ApiBehaviourBaselineItemController.java` — REST surface (GET list / GET by id / POST create / PATCH / DELETE).
- Liquibase: `src/main/resources/db/changelog/sql/` — highest on disk is `191-baseline-content-hash-provenance.sql`. **Next-free = 192** (builder verifies at build time; use the `not.columnExists` precondition idiom per 189/190/191).

**Reconcile / replay path (TS, `api-migration-validation-service`):**
- `src/services/targetReplayRunner.ts` — `runTargetReplay` (line 278): the NO-LLM deterministic target-side replay. Per-item loop (lines 471-663). Mutating gate (line 508: skip mutating when `mutating_calls_confirmed=false`, emit `mutating_skipped`). `extractItemRequest` (line 242: unwraps `request_json` into `{ query, headers, body }`). Promotes each replay to a target baseline-item with `response_json: { headers, body }` (line 593, Spec B symmetric wrapper). Auto-triggers the diff (lines 694-744). Consecutive-transport-failure abort (line 638).
- `src/services/diffRunner.ts` — `runDiff` (line 284): pairs source/target items by `pairKey` = `${method}|${path}|${scenarioName}` (line 121), classifies via `compareJsonShapes` with the source item's `volatile_paths_json` envelope + `nonDeterministicEndpointKeys` signal (`buildVolatilityContext`, line 186; `parseVolatilityEnvelope`, line 151). Counts incl. local-only `body_ordering_drift` + `header_drift` (line 233). Finding-emission tail + integrity advisory (lines 727-898).
- `src/services/jsonShapeComparator.ts` — Spec B fidelity engine: `compareJsonShapes(source, target, ctx?)`; `BodyClassification` incl. `body_ordering_drift` (line 127); `HeaderClassification` (line 150); `unwrapBodyEnvelope` (line 427); `VolatilityContext`/`VolatilityEnvelope`/`VolatilitySource` (lines 172-321); `isVolatileHeaderName` (line 387). **This is the ACT-step full-diff machinery to reuse verbatim.**
- `src/services/volatilityProbe.ts` — `runVolatilityProbe` (line 152): capture-time k-repeat self-diff. **Mutating-scenario guard at lines 167-169 returns `{ paths: [], volatility_source: 'not_probed', k: 0 }` WITHOUT any replay** — this is the exact gate Decision 5 must extend so generated ids in mutating responses are tolerated. `volatilityEnvelopeToWire` (line 295).
- `src/services/nonDeterministicEndpointKeys.ts` — resolves the `non_deterministic_endpoint` discovery signal into `${METHOD}|${path}` keys; the FU-1 endpoint-signal volatility seam.

**Mutating gating:**
- `execute_http_request.ts` lines 328-352 — capture-side gate `included AND (safe_to_execute OR mutatingCallsConfirmed)`.
- `targetReplayRunner.ts` line 508 + `volatilityProbe.ts` line 167 — reconcile-side + probe-side mutating gates.
- `ScenarioSeed` types + `mutating_calls_confirmed` on the session (`archModelClient.ts` lines 85/147/164). A sequence is INHERENTLY mutating (it creates resources), so it relates to `mutating_calls_confirmed` (see Q on gating).

**Frontend (React/TS, `frontend`):**
- `src/components/DashboardView/CaptureReviewPanel.tsx` — per-capture human review (accept/reject); the `accepted` toggle + reviewer notes.
- `src/components/DashboardView/CaptureSessionDetailView.tsx` / `CaptureSessionDetailPage.tsx` — session-level capture review + coverage display.
- `src/components/DashboardView/SaveAsBaselineModal.tsx` — the Save-as-baseline action (lines 129-180): iterates `acceptedCaptures`, calls `createBaseline` then `createBaselineItem` per capture, pinning `response_json: { headers, body }` (line 168) + `volatile_paths_json` carry-through (line 178). **This is where a sequence must be assembled into a sequence-bearing baseline item.**
- `src/components/DashboardView/BaselineDetailView.tsx` — renders baseline items (method/path/scenario_name/status/request_json/response_json, lines 544-580). Where sequence steps/refs/cleanup-status/pollution-flag should surface.
- `src/components/ProductManager/MigrationDeliveryDashboard/MigrationDeliveryReconciliationPanel.tsx` — the run-scoped break review table; where a sequence's per-step outcome (setup status assertions, ACT diff, cleanup/pollution flag) should surface.
- `src/api/apiBehaviourClient.ts` — the wire client (`createBaselineItem` line 1164, `createBaseline` line 1079, `listBaselineItems` line 1154, etc.).

**Idiom reference specs (named by the requester):**
- `agent-os/specs/2026-06-16-reconcile-determinism-volatile-values/` — volatile-disposition machinery, `volatility_source` taxonomy, "create-then-auto-dispose, never silent" invariant, layer-ordering (AMS → validation-service → gateway → frontend), `not.columnExists` changeset idiom.
- `agent-os/specs/2026-06-17-reconcile-full-response-fidelity/` (Spec B) — full-response fidelity (status/headers/body-shape/value/ordering + volatile tolerance) to reuse for the ACT step diff.
- `agent-os/specs/2026-06-17-baseline-integrity-provenance/` (Spec C) — the content-hash; the sequence model must cohere with it.
- `agent-os/specs/2026-06-17-oracle-coverage-scoring/` (Spec A) — the one-dimension-per-`GeneratedScenario` rubric; a sequence must be ONE rubric dimension, not N.

No prior multi-step / chained-scenario feature exists; capture today is single-shot per operation with opportunistic cross-scenario id reuse only.

### Follow-up Questions

None asked interactively — see the orchestrator-facing question list with "Locked?" verdicts in the final response.

## Visual Assets

### Files Provided:
No visual assets provided. Mandatory `ls` of `planning/visuals/` returned no image/PDF files (the `visuals/` directory exists but is empty). The feature reuses the existing capture-review / baseline-detail / reconcile-break surfaces; no bespoke widget mockup was supplied (matching the A/B/C specs' "reuse existing surface, no visual assets" stance).

### Visual Insights:
- None (no files). Fidelity level: n/a.

## Requirements Summary

### Functional Requirements

**Sequence model (AMS, changeset 192):**
- Persist an ORDERED multi-step sequence as ONE oracle unit, with each step carrying: `kind` (`http` only today; reserve `sql`/`e2e`), the request shape, the captured response, a `role` (setup / act / cleanup), inter-step references (`$N.field` placeholders), and per-step volatility/expected-status metadata.
- Single ACT step per sequence (the behaviour under test); 0..N setup steps; 0..N cleanup steps.
- Coexist with single-shot baseline items (sequences are additive; a non-sequence scenario must persist + reconcile EXACTLY as today).
- The pinned step list + inter-step references must be coherently covered by / extend Spec C's `BaselineContentHashUtil` canonical form (tamper-evidence).

**Capture-side discovery + pin:**
- The LLM discovers the chain + real ids during capture (a new tool and/or orchestrator phase), then PINS it as the declarative ordered step list with placeholders substituted for the volatile ids it observed.
- A sequence is ONE coverage-rubric dimension (one `GeneratedScenario`/one `CoverageDimensionResult`) — it must NOT inflate the per-endpoint rubric into N dimensions.

**Deterministic replay engine (reconcile):**
- Replay the pinned steps in order against the target with NO LLM: resolve `$N.field` references from earlier steps' LIVE target responses, run each step, ASSERT setup steps reach their expected status, FULLY DIFF the ACT step's response (reuse `compareJsonShapes` + Spec B fidelity + volatile tolerance), run CLEANUP best-effort and FLAG on failure.
- Generated-id volatility: a mutating-response generated id changing capture→replay must NOT be a false break (it is threaded via the inter-step ref / tolerated); a genuinely-changed NON-volatile field STILL breaks.

**Isolation:**
- Self-clean-via-HTTP: cleanup steps DELETE created resources; where no cleanup endpoint exists, surface a BOUNDED, FLAGGED residual-pollution marker (never pretend clean).
- Pluggable isolation strategy slot (future DB-reset/seed / fresh-target-per-run) without changing the sequence model.

**Frontend:**
- Surface a sequence's steps, inter-step references, setup-status assertions, ACT diff, cleanup status, and pollution flag in the capture-review / baseline-detail / reconcile-break surfaces.

### Reusability Opportunities
- `compareJsonShapes` + the whole Spec B `VolatilityContext`/`VolatilityEnvelope` machinery for the ACT-step diff — reuse, do NOT reinvent.
- `runVolatilityProbe` — EXTEND the mutating gate (lines 167-169) rather than adding a parallel probe.
- `extractIdentifierFacts` (`execute_http_request.ts` line 113) — the existing id-harvest is the natural seed for inter-step reference discovery.
- `targetReplayRunner.runTargetReplay` per-item loop + `extractItemRequest` — the deterministic replay shell to extend for ordered sequence steps.
- `selectCanonicalCapture` / `scoreEndpointCoverage` — the rubric pattern a sequence dimension must plug into without drift.
- `SaveAsBaselineModal` createBaseline/createBaselineItem flow — the pin-to-baseline path to extend.
- `pairKey` (`diffRunner.ts` line 121) — the source/target pairing key; a sequence pairs at the sequence level (its ACT step), not per raw HTTP call.

### Scope Boundaries

**In Scope:**
- ONE coherent spec, ordered task groups: AMS sequence model → capture-side sequence builder/pin → deterministic replay engine → reconcile incl. id-volatility → frontend.
- HTTP `kind` steps only; the `kind` field + model headroom for `sql`/`e2e`.
- Self-clean-via-HTTP isolation + bounded/flagged residual pollution + pluggable-strategy seam.
- Mutating-response generated-id volatility tolerance threaded via inter-step references.
- Sequence-aware coverage (one rubric dimension), integrity-hash coherence, and frontend surfacing.

**Out of Scope:**
- Implementing `sql` (DB reconciliation) or `e2e` (Playwright) step kinds — model headroom only.
- Building a DB-reset / seed / fresh-target-per-run isolation strategy — pluggable seam only.
- Any regression of A/B/C work or existing single-shot capture/reconcile.
- LLM-dynamic replay (replay is deterministic, no LLM) and human-declared-only authoring (authoring is hybrid LLM-discover + pin).

### Technical Considerations
- **AMS wire = snake_case** (CLAUDE.md): new sequence DTOs default to snake_case; only apply `@CamelCaseWire` if a camelCase consumer exists (none expected here — the TS clients are snake_case).
- **Integrity-hash coherence (Spec C)**: `BaselineContentHashUtil.itemContent` currently hashes `method/path/scenario_name/request_json/response_status/response_json/volatile_paths_json`. The sequence's pinned steps + inter-step refs are NEW oracle content and MUST be folded into the canonical form (either as a new per-item field hashed alongside the existing seven, or by the sequence living on the baseline item such that its content is reachable) — bump `CANONICAL_VERSION` if the per-item field set changes. Tamper-evidence of the pinned chain is the requirement.
- **Persistence-model choice (open for spec-writer; see Q1)**: three candidates — (a) a NEW `api_behaviour_sequence` + `..._step` entity pair referenced by the baseline item; (b) an extension of `ApiBehaviourBaselineItemEntity` with a `sequence_json` jsonb blob (mirrors the `volatile_paths_json` nullable-jsonb idiom, lowest-friction, keeps the single oracle-unit framing + integrity hash trivially); (c) a hybrid. The `volatile_paths_json` nullable-jsonb-on-the-item precedent (changeset 187) strongly favours (b) for the v1 single-spec scope: a nullable `sequence_json` column on the baseline item is the cleanest "additive, non-regressing, integrity-coherent" shape — `null` = today's single-shot item.
- **Replay dispatch**: the `kind='target'` session already routes `/start` to `runTargetReplay` (route is the discriminator). A sequence-bearing baseline item is detected inside the replay loop (its `sequence_json` is non-null) and handed to a new ordered-step sub-runner; non-sequence items take the existing single-shot path unchanged.
- **Mutating gating**: a sequence is inherently mutating, so it requires `mutating_calls_confirmed=true` to capture AND to replay. Cleanup steps are themselves DELETEs (mutating) and run under the same confirmation. The existing `mutating_skipped` diagnostic path must NOT silently drop a whole sequence — a skipped sequence should be surfaced distinctly.
- **Volatility for mutating responses**: extending `runVolatilityProbe`'s mutating gate means the probe can no longer be a blind k-repeat (re-POSTing k times would create k resources). The mutating-response id tolerance is more likely derived from the inter-step reference declaration (the field the LLM pinned as `$N.id`) than from a k-repeat self-diff — the spec must reconcile "extend volatility handling" (Decision 5) with "do not re-run mutating side effects k times" (the existing guard exists for exactly this reason).
- **Coverage / rubric**: a sequence must enter `defaultScenarioSet` as ONE `GeneratedScenario` and score as ONE `CoverageDimensionResult` via the existing `selectCanonicalCapture`/`scoreEndpointCoverage` path (no second coverage definition).
- **No-regression invariant**: every non-sequence scenario, baseline item, replay, and diff must behave byte-for-byte as today (sequences are strictly additive — `sequence_json` null is the existing path).

## Resolved Clarifications (AUTHORITATIVE — bind the spec-writer)

The requirements authority resolves all 8 shaper questions. These are FIXED. All are implementation/technical-correctness decisions consistent with the locked product decisions (1–6); none reopens a product fork.

**R1 (persistence) — nullable `sequence_json` jsonb column on `ApiBehaviourBaselineItemEntity`** (NOT a child entity/table). `null` = today's single-shot item (zero regression); non-null = the pinned ordered steps. Mirrors the `volatile_paths_json` nullable-jsonb precedent (changeset 187). Steps are read as a UNIT at reconcile (no independent step queryability needed in v1). Changeset 192 (verify next-free; `not.columnExists`).

**`sequence_json` shape (decided):** `{ steps: [ { index, role: 'setup'|'act'|'cleanup', kind: 'http', request: { method, path, query, headers, body }, expected_status, response_refs: [ { ref: '$<stepIndex>.<jsonpath>', from_step, json_path } ] } ], act_step_index, cleanup_best_effort: true }`. `kind` is present on every step with ONLY `'http'` implemented now (room reserved for future `'sql'`/`'e2e'` — do NOT implement them). Inter-step references use `$<stepIndex>.<jsonpath>` (e.g. `$1.id`) resolved at replay from the live response of the referenced earlier step.

**R2 (discovery hook) — a NEW terminal capture tool the LLM calls to PIN the sequence** (e.g. `pin_sequence` / `record_sequence_candidate`), alongside `record_capture_note`/`record_scenario_candidate` in `tools/`. The LLM is the only actor that knows which executed calls were setup vs act vs cleanup and which response field is `$N.<path>`, so it declares roles + the act step + inter-step refs explicitly. The orchestrator assembles the pinned `sequence_json` from that declaration + the ordered `runManager.getScenarioCaptures`. Hook point: the per-scenario block in `captureSessionOrchestrator.ts` after `runScenarioLoop` returns, around `selectCanonicalCapture`. A sequence stays ONE `GeneratedScenario` → ONE `CoverageDimensionResult` (no rubric inflation).

**R3 (mutating-id volatility) — REF-DERIVED, not probe-derived.** Resolve the Decision-5/probe-guard tension as follows: the volatility probe (`volatilityProbe.ts:167-169`) STILL skips re-running mutating calls (re-POSTing k times would create k resources — keep that guard). Instead, the id-tolerance is DERIVED from the pinned inter-step references: any response field that a later step references as `$N.<path>` (and the generated-id fields surfaced by `extractIdentifierFacts`) is, BY CONSTRUCTION, expected-volatile. Record those paths into the SAME `volatile_paths_json` envelope shape (`volatilityEnvelopeToWire`) the diff engine already consumes — so the diff/reconcile side needs NO change to tolerate them. A genuinely-changed NON-volatile field still breaks (oracle invariant intact).

**R4 (mutating confirmation) — YES, both.** A sequence is inherently mutating: it requires `mutating_calls_confirmed=true` to CAPTURE and to REPLAY; cleanup DELETEs run under the same flag. A sequence that cannot run for lack of confirmation must be surfaced distinctly (not silently dropped via the generic `mutating_skipped` path) — see R6.

**R5 (reconcile pairing granularity) — pairKey = the ACT step's `${method}|${path}|${scenarioName}`.** The diff_item/break IS the sequence's ACT step (FULLY diffed via Spec B fidelity + volatile tolerance, reusing `compareJsonShapes`/`buildVolatilityContext` — no new diff engine). Setup steps are ASSERTED to reach their `expected_status` (status-only, not full-body-diffed); a failed setup step fails the sequence with a clear diagnostic (the act isn't reached). Cleanup is best-effort. Single-shot pairing is unchanged.

**R6 (pollution + skip surfacing) — both a diagnostic AND a result field.** Residual pollution (a created resource with no cleanup endpoint, or a cleanup step that failed) is surfaced via (a) a distinct diagnostic (sibling to `mutating_skipped`, e.g. `sequence_cleanup_failed` / `sequence_residual_pollution`) and (b) a flag on the sequence replay result / break detail_json so the frontend renders it. A sequence skipped for lack of `mutating_calls_confirmed` gets its own distinct diagnostic (`sequence_skipped`), not the generic per-call one.

**R7 (integrity hash) — ADDITIVE, NULL-OMITTED; do NOT bump `canonical_version` (stays 1).** Fold `sequence_json` into `BaselineContentHashUtil.itemContent` such that when `sequence_json` is null (ALL existing baselines + every single-shot item) the canonical form is BYTE-IDENTICAL to today's v1 — i.e. OMIT the field entirely when null rather than serializing `null`. Only sequence-bearing items (which did not exist under v1) include it. This deliberately OVERRIDES the shaper's "bump to v2" suggestion: a version bump would make `verifyIntegrity` recompute existing v1 baselines under v2 and FALSE-MISMATCH them (Spec C's verify is not version-dispatched). Omit-when-null keeps every existing `content_hash` valid, needs no version-aware verify, and still tamper-protects pinned steps when present. Document that `sequence_json` participates in the hash when present.

**R8 (out of scope) — confirmed.** OUT: implementing non-`http` step kinds (`sql`/`e2e`); any isolation strategy beyond self-clean-via-HTTP (DB-reset/seed, fresh-target-per-run — reserved, pluggable, not built); LLM-dynamic replay; human-declared-only authoring; backfill of existing baselines; ANY regression of A/B/C or single-shot capture/reconcile.
