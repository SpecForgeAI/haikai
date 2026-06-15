# Specification: Oracle Integrity & Determinism (run-level degraded signal + reproducible extraction)

## Goal
Make a discovery run honest about its own completeness (an advisory run-level `degraded` signal that rides alongside `COMPLETED`, never blocking) and reproducible in its own extraction (a content-addressed gap-fill LLM output cache), plus three correctness guards so nothing is silently lost or false-bound. Spec #3 of 6 in the Phase-2 "oracle perfection" program; built strictly after Spec #1 and Spec #2, extending their committed scanners + run/readiness DTO and the two quick-wins (W2, W4) already on HEAD.

## User Stories
- As a migration analyst, I want a run that hit a scanner failure, a gap-fill failure, failed files, or a method/token cap to carry a visible `degraded` flag (with reasons) while still completing, so that "the model may be partial" is never silent.
- As a reviewer, I want below-auto-accept-gate candidates persisted as reviewable (not dropped) with a run-summary count, and any fuzzy (normalized, non-exact) name match flagged rather than silently bound, so that low-confidence guesses are surfaced, not lost or mis-merged.
- As the runtime harness, I want endpoints that are not pure functions of their inputs flagged (`non_deterministic_endpoint`) so that legitimate variance is not treated as a behavioural diff.

## Specific Requirements

**Run-level advisory `degraded` signal (rides alongside `COMPLETED`, never a new status)**
- Add a boolean-style `degraded` flag PLUS a structured `degraded_reasons` payload (the set of reasons it tripped) on the run record, modelled on the existing advisory `warnings` field — NOT a new terminal status enum value.
- Do NOT touch `validateStatusTransition` or its `RUNNING -> [RUNNING, COMPLETED, FAILED]` map (`runManager.ts`): degraded rides ON TOP of `COMPLETED`, it does not replace or extend the state machine.
- SET `degraded = true` (and append the matching reason) when ANY of: a `scanner_failed` Finding was emitted (W4); the gap-fill stage `stageStatus: 'failed'` OR any files failed (nonzero `filesFailed`); a method/token cap was hit (Spec 2's `DEFAULT_METHOD_CAP` / `DEFAULT_TOKEN_CEILING`); a contract pass or runtime pass failed (Spec 1's response-contract scanner / the harness pass).
- This ESCALATES existing signals (the W4 `scanner_failed` Finding and the cap-hit signal already exist) to the run level; it does not re-emit them.
- Compute degraded in `discoveryV3Pipeline.ts` / `runManager.ts` at the COMPLETED branches (~L1469-1479 and the resume path ~L1710-1719) and persist it alongside the COMPLETED transition. The run still COMPLETES regardless. Advisory only — never blocks.

**Wire the real `filesFailed` count**
- Replace the hardcoded literal `filesFailed: 0` in `discoveryV3Pipeline.ts` (requirements pinned ~L1344; the literal currently sits in the gap-fill stage-output construction near L1471 — line has drifted, value identical) with the real per-file gap-fill failure count.
- `GapFillStepOutput` (`llmGapFillStep.ts`) exposes `failures: GapFillFailure[]`; derive the count from `failures.length` (there is no pre-existing `filesFailed` field on the output — surface it from the failure array).
- Feed the wired count into the degraded computation: a nonzero `filesFailed` is one of the degraded triggers.

**Partial gap-fill made visible, not blocked**
- Keep `GAP_FILL_MAX_FAILURE_RATE` semantics unchanged (`llmGapFillStep.ts` ~L250, default `0.2`); do NOT start failing the run on partial gap-fill.
- Treat `stageStatus: 'failed'` OR nonzero `filesFailed` as a degraded trigger so the partial outcome shows on the run record, while the run still transitions to `COMPLETED` (no new block in either the COMPLETED branch or the resume path).

**Gap-fill LLM output cache (reproducibility + cost)**
- Add a content-addressed cache for the gap-fill relay keyed on `(normalized-prompt hash + model + temperature)`, extending the behaviour stage's hashing pattern (`llmBehaviourCaptureStep.ts` `computeSourceHash` — `createHash('sha256')` over a normalized input, with a `kind: 'cache-hit'` reuse path).
- On a cache hit, reuse the prior response with NO LLM call (the gateway relay is the single LLM path; the cache wraps that relay). The cache key includes W2's `temperature: 0`.
- Keep the behaviour stage's own `source_hash` cache as-is; this is the gap-fill ANALOGUE, not the same cache. Pairs with W2: `temperature: 0` makes the model deterministic, the cache makes the pipeline deterministic.

**Below-gate candidate visibility (verify-then-harden, never silently lost)**
- Keep the 0.75 auto-accept gate (`candidateSaveBackService.ts` `CANDIDATE_AUTO_ACCEPT_THRESHOLD`, L72) — do NOT auto-pollute the model with low-confidence guesses.
- FIRST verify the existing save-back path already persists below-gate candidates as reviewable candidates (it references "below the auto-accept gate -> reviewable candidate" at L176, L2398-2404, L2596-2604, L2833). Do NOT duplicate an already-working path.
- THEN harden: guarantee an explicit "below auto-accept" review status AND a run-summary count; close any gap where a below-gate candidate is dropped instead of persisted-for-review; guarantee the count reaches the run summary (a whole Tier-C run sits below the gate — `llm-solo` scores `0.4`, `llmGapFillStep.ts` ~L730).

**False-merge guard on normalized (non-exact) bindings**
- Only EXACT name matches bind silently. A NORMALIZED (fuzzy) match driving a binding (relationship / enrich / link / request-response resolution) in `candidateSaveBackService.ts` must EITHER be recorded as a low-confidence / reviewable binding OR emit a `possible_entity_collision` Finding.
- GUARD the existing identity primitive `normalizeNameForMatch` (L354) — do not replace it. It folds case, strips separators, and blanket-singularizes (English-only), so it can false-bind distinct entities (e.g. `Order` vs `Orders`) silently; this is the same shared primitive Spec #1's resolver upgraded and Spec #5's `data_movements` producer consumes.
- Optional best-effort: tighten the naive English-only singularization. The guard is the must-have; the singularization tweak is NOT required.

**New deterministic `non_deterministic_endpoint` scanner (Spring / Spring Classic only)**
- Add a NEW deterministic scanner that emits a `non_deterministic_endpoint` evidence-gap Finding for endpoints whose handler reaches `@Scheduled` / `@Cacheable` / `@Async` / `@Profile`-gated beans, session-scoped state, or clock / random — i.e. the endpoint is NOT a pure function of its inputs.
- This tells the harness the endpoint has legitimate variance and must not be treated as a behavioural diff. Spring / Spring Classic only; no non-Spring protocols.
- Add the `non_deterministic_endpoint` sentinel to the `EvidenceGapType` union in `emissionSources.ts`, alongside W4's `scanner_failed` (L466) and the existing `low_confidence_candidate` (L50); reuse the existing evidence-gap builder pattern.

**Two new finding sentinels (reuse the Findings machinery — no new component)**
- Register `non_deterministic_endpoint` and `possible_entity_collision` in the `EvidenceGapType` / finding-type sentinels in `emissionSources.ts`, next to `scanner_failed` and `low_confidence_candidate`.
- Reuse `FindingEmitter` + `emissionSources.ts` (normalize + dedupe + soft-fail); the frontend `FindingsTab` / `FindingDetailDrawer` render the new types with NO new component.

**Surface degraded + below-gate count on the existing run / readiness surface**
- Surface the `degraded` flag (with `degraded_reasons`) and the below-gate candidate count on the run record and the readiness/run UI the SAME way existing run metadata (`warnings`, tier, status) is shown — no bespoke widget.
- Downstream Spec #5 (coverage) and the runtime harness read it off the run / readiness DTO.

**AMS wire convention + persistence**
- The run-record `degraded` (+ `degraded_reasons`) field follows the existing `DiscoveryRunDto` convention exactly: explicit per-field `@JsonProperty("snake_case")` (belt-and-braces snake_case, NO `@CamelCaseWire`) — the advisory `warnings` field (`@JsonProperty("warnings")`, JSON-encoded `string[]`, null when absent) is the precedent.
- If the value is also surfaced on `ReadinessAssessmentDto`, that DTO is per-field `@JsonProperty("camelCase")` (verified: `overallStatus`, `apiReadiness`, …) — a readiness-side field uses camelCase to avoid a mixed-casing payload. (Run record = snake_case; readiness = camelCase — match each DTO's own convention.)
- A NEW Liquibase changeset is needed ONLY if a run-status/flag COLUMN is added — a NEW file at the next free number `≥169` at build time (highest applied today is `168-endpoint-response-contract.sql`, Spec #1's; take the next free number when building). NEVER edit an applied changeset.

## Visual Design
No visual assets provided (`planning/visuals/` is empty). The UI reuses the existing run/readiness surface and the Findings tab; no bespoke widget is built.

## Existing Code to Leverage

**W2 temperature wiring (extend — do NOT redo)**
- `gateway/src/routes/discoveryGapFill.ts` (`temperature: 0`, L134), `discoveryBehaviourCapture.ts` (L138), `discoveryDecisionTasks.ts` (L157) — already on HEAD. The new gap-fill cache key includes this temperature; the relay stays the single LLM path. (`discoveryPerformanceScore.ts` uses `0.2` — out of scope.)

**W4 `scanner_failed` Finding + sentinel (extend — do NOT redo)**
- Soft-fail catch sites in `discoveryV3Pipeline.ts` + `packFindingScanners/index.ts`; sentinel `'scanner_failed'` in `emissionSources.ts` (`EvidenceGapType` union L466, emitter ~L678). This spec ESCALATES the existing `scanner_failed` Finding to the run-level degraded signal; it does not re-emit it.

**Findings machinery — `findings/emissionSources.ts` + `FindingEmitter`**
- The evidence-gap builder pattern + the `EvidenceGapType` union (single source of truth for `detail_json.gapType`) live here. Add the `non_deterministic_endpoint` and `possible_entity_collision` sentinels + builders next to `scanner_failed` (L466) and `low_confidence_candidate` (L50). `FindingEmitter` already normalizes + dedupes + soft-fails (never throws) — reuse as-is.

**Behaviour-stage hashing — `llmBehaviourCaptureStep.ts` (cache template)**
- `computeSourceHash` (`createHash('sha256')` over a NORMALIZED method body + callee bodies) plus the `kind: 'cache-hit'` reuse path and the `cacheHits` counter are the template for the new gap-fill `(normalized-prompt hash + model + temperature)` cache. Reuse the approach; do not reuse the same cache.

**Gap-fill stage — `llmGapFillStep.ts`**
- `runLlmGapFill` returns `GapFillStepOutput` with `failures: GapFillFailure[]` (source of the real `filesFailed` count), `stageStatus: 'completed' | 'failed'`, and `GAP_FILL_MAX_FAILURE_RATE` (~L250, default `0.2`, unchanged). Tier-C `llm-solo` candidates score `0.4` (~L730) — entirely below the 0.75 gate.

**Run lifecycle — `discoveryV3Pipeline.ts` + `runManager.ts`**
- `discoveryV3Pipeline.ts` constructs the gap-fill stage output with the hardcoded `filesFailed: 0` literal (replace it) and is where degraded is computed. `runManager.ts` holds `validateStatusTransition` + the `RUNNING -> [RUNNING, COMPLETED, FAILED]` map (L1198) and the COMPLETED branches (~L1469-1479 and resume ~L1710-1719) where degraded is persisted alongside `COMPLETED`. Do NOT edit `discovery-service/src/**` during an in-flight run (tsx watch reload kills runs).

**Identity / matching primitive — `mcp-server/src/services/candidateSaveBackService.ts` (GUARD, do not replace)**
- `normalizeNameForMatch` (L354), the 0.75 gate `CANDIDATE_AUTO_ACCEPT_THRESHOLD` (L72), and the existing "below the auto-accept gate -> reviewable candidate" sites (L176, L2398-2404, L2596-2604, L2833). The false-merge guard and the below-gate hardening both live here on this SAME shared primitive (shared with Spec #1's resolver upgrade and Spec #5's `data_movements` producer).

**AMS run record + readiness — DTO / entity / controller / service**
- `model/dto/DiscoveryRunDto.java` (record; per-field `@JsonProperty("snake_case")`; advisory `warnings` field = precedent), `model/entity/DiscoveryRunEntity.java`, `controller/DiscoveryRunController.java`, `service/DiscoveryRunService.java`. Add the `degraded` field here if persisted. `model/dto/migration/ReadinessAssessmentDto.java` (per-field `@JsonProperty("camelCase")`) is the read-only readiness surface. Closest changeset precedent: `085-discovery-run-warnings.sql`.

## Out of Scope
- Blocking gates of any kind — every signal is advisory only; a degraded run still `COMPLETED`s.
- Redoing W2 (`temperature: 0` relays) or W4 (`scanner_failed` Finding + sentinel) — extend them, do not re-author.
- Auto-remediation of any flagged condition — signals are surfaced; nothing is auto-fixed.
- A new terminal run-STATUS enum value — `degraded` rides alongside `COMPLETED`; the `validateStatusTransition` state machine is untouched.
- Changing `GAP_FILL_MAX_FAILURE_RATE` semantics or starting to fail the run on partial gap-fill.
- Replacing (vs guarding) the normalized-name identity primitive; the optional singularization tweak is best-effort, not required.
- A bespoke degraded-status UI widget — reuse the existing run / readiness surface and the Findings tab.
- Non-Spring / non-Spring-Classic protocols anywhere (including the new `non_deterministic_endpoint` scanner).

## Phase-2 Build Ordering & File-Overlap

**Position:** Spec **#3 of 6** in the Phase-2 "oracle perfection" program. **Built STRICTLY SEQUENTIALLY after Spec #1 (response-contract scanner) and Spec #2 (capture-coverage seeding + method/token caps)** — never in parallel — so it extends their COMMITTED scanners + run/readiness DTO rather than racing them. #3 reads signals produced by #1 (contract-pass-failed) and #2 (method/token cap-hit) as degraded triggers.

**Already on HEAD (extend, do NOT redo):**
- **W2** — `temperature: 0` on the gap-fill / behaviour / decision LLM relays in `gateway/src/routes/discovery*.ts`.
- **W4** — `scanner_failed` evidence-gap Finding at soft-fail catch sites in `discoveryV3Pipeline.ts` + `packFindingScanners/index.ts`, sentinel in `emissionSources.ts`.

**Build layering (strict order):**
1. **AMS** — add the advisory `degraded` (+ `degraded_reasons`) field to the run record IF persisted (`DiscoveryRunDto` per-field snake_case `@JsonProperty`, no `@CamelCaseWire`); surface on the readiness DTO (camelCase). NEW Liquibase changeset ONLY if a run column is added — next free `≥169` at build time; never edit an applied changeset.
2. **discovery-service** (`discoveryV3Pipeline.ts` / `runManager.ts`) — compute degraded; wire `filesFailed` (replace the `0` literal); escalate W4's `scanner_failed` + cap-hits + gap-fill stage-failure/failed-files + contract/runtime-pass failures to degraded; add the `non_deterministic_endpoint` scanner + sentinel; add the gap-fill LLM output cache. NO `discovery-service/src/**` edits during an in-flight run.
3. **MCP save-back** (`mcp-server/src/services/candidateSaveBackService.ts`) — false-merge guard on normalized bindings (reviewable binding OR `possible_entity_collision` Finding; only exact matches bind silently) + harden below-gate reviewable-candidate persistence and the run-summary count. Guard the identity primitive; do not replace it.
4. **frontend** — surface `degraded` (+ reasons) and the below-gate candidate count on the existing run / readiness surface; render the two new finding types via `FindingsTab` / `FindingDetailDrawer`. No bespoke widget.

**Cross-cutting files shared with sibling specs — extend the committed version, do not duplicate or race:**
- `discovery-service/src/services/discoveryV3Pipeline.ts` and `runManager.ts` — shared with **#1** (response-contract scanner), **#4** (inbound scanners), **#5 / #6** (resolvers). This spec adds degraded computation + `filesFailed` wiring + the non-deterministic-endpoint scanner + the gap-fill cache. Build AFTER #1/#2 land here.
- `discovery-service/src/services/findings/emissionSources.ts` — shared sentinel registry (holds W4's `scanner_failed` + `low_confidence_candidate`; #1/#4 add their own). This spec ADDS `non_deterministic_endpoint` and `possible_entity_collision` next to them.
- `mcp-server/src/services/candidateSaveBackService.ts` — shared with **#5** (`data_movements` producer) and **#1**'s identity-primitive upgrade. This spec adds the false-merge guard + below-gate hardening on the SAME `normalizeNameForMatch` / 0.75-gate primitive; guard it in place.
- The run / readiness DTO (`DiscoveryRunDto` + `ReadinessAssessmentDto`) — shared with **#2** (seeding). This spec ADDS the advisory `degraded` field to the version #2 committed; it does not re-author the DTO.
