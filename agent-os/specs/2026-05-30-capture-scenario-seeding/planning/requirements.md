# Spec Requirements: Capture Scenario Seeding — discovery seeds the runtime equivalence harness (REST first, SOAP where available)

## Initial Description

Spec #2 of 6 in the HAIKAI Phase-2 "oracle perfection" program (a like-for-like API/DB migration
tool). North star: memory `project_migration_ultimate_goal` — treat a current service+DB as a black
box and prove the upgraded inside (Java 8/Spring Classic + Sybase → Java 21/Spring Boot 4 +
PostgreSQL) is behaviourally equivalent. The runtime equivalence harness
(`api-migration-validation-service`) is the API behavioural oracle: it captures → replays → diffs
each endpoint. But to exercise an endpoint it needs SCENARIOS + INPUTS, and today discovery does
not seed it — the harness improvises every input.

**Problem / goal:** Make discovery seed the harness. Discovery already holds the perfect seed
material (endpoint→data access modes, per-method behaviour with validation/edge/io, SOAP message
shapes), but that material dead-ends at display and is never read by the capture orchestrator.
The harness consequently generates exactly ONE `happy_path` scenario per operation, tells the LLM
to invent the request body/params/headers blind, decides destructiveness from the HTTP verb alone,
and synthesises REST endpoints with `requestSchema: null`. This spec computes per-operation
**capture scenario seeds** from the persisted model and feeds them to the harness so it expands
scenarios, pre-fills inputs/auth/preconditions, drives `safe_to_execute` from the real data-effect
access mode, and keeps the LLM as a fallback that REFINES seeds rather than inventing blind.

The runtime harness remains the equivalence VERIFIER. Discovery does not prove behaviour — it
describes the model completely and honestly, and now hands the harness richer, pre-filled scenarios
so the capture run is grounded rather than improvised.

**Verified audit findings (the gaps this spec closes — all confirmed against the codebase):**
1. `api-migration-validation-service/src/services/captureSessionOrchestrator.ts` `defaultScenarioSet`
   (line 357) returns exactly ONE `{ name: 'happy_path', type: 'happy_path' }` per operation, with
   `void op; // Reserved for per-operation extension in v2.` — no edge/error/auth scenarios, no
   example inputs, no auth/tokens, no preconditions. The per-scenario prompt instructs the LLM to
   not invent beyond evidence but supplies no concrete inputs to start from.
2. The discovery→harness DTO `MigrationDiscoveryContextDto` (built in `MigrationDiscoveryContextService`)
   carries COUNTS + finding titles + evidence paths (`FindingsSummary`, `highPriorityFindings`,
   `evidenceHighlights`, `databaseDiscoverySummary`, etc.) — NOT sample values, example payloads,
   auth, or preconditions. Contrast `MigrationSpecContextDto`, which DOES carry `sampleDataHints`
   maps (lines 195 / 227) — but that is the SPEC path, not the CAPTURE path.
3. Spec 2 behaviour blocks live on `BusinessLogicEntity.behavior` (JSONB, line 61) carrying
   io / validation / edge_cases — persisted but NEVER read by the capture orchestrator; the perfect
   seed material dead-ends at the candidate-details display.
4. `safe_to_execute` is VERB-ONLY: `captureSessionActions.ts` `isNonMutatingMethod` (line 216)
   tests `NON_MUTATING_METHODS` against the HTTP verb; Spec 1's resolved
   `endpoint_data_effects.access_mode` (`EndpointDataEffectEntity.accessMode`, line 102) is
   discarded at the seam.
5. Endpoints synthesised for the harness from the discovery model carry `requestSchema: null` and
   `responseSchema: null` for REST (`captureSessionActions.ts` lines 428–429), so the harness has no
   request/response shape to build a valid call from.

**Final decisions carried from the raw idea (NOT open for re-litigation — pre-approved, the build
runs autonomously and cannot ask questions):**
1. **Scenario-seed model.** Discovery/AMS computes, per included operation, a set of capture
   SCENARIO SEEDS — `happy_path` + `edge` + `error` + `auth_variant` — each with example inputs
   (request body / params / headers), preconditions (data that must pre-exist), an expected status,
   and a `safe_to_execute` flag. Seeds are migration-process REALITY (test seeds), NOT a new
   meta-model entity TYPE.
2. **Computed-on-read at handoff** (mirrors the Capture Coverage Gates spec, 2026-05-30). AMS
   computes the seeds in `MigrationDiscoveryContextService` from the persisted Spec 1/2/4(/#1) model
   and carries them on the migration-discovery-context response DTO (camelCase-wired). NO new
   persistence / NO Liquibase changeset in v1.
3. **Harness consumes the seeds.** Extend `captureSessionOrchestrator` `defaultScenarioSet` to expand
   beyond one happy-path using the seeds (one scenario per seed) and pre-fill example inputs / auth /
   preconditions; keep the LLM as a fallback that REFINES seeded inputs rather than inventing blind.
4. **`safe_to_execute` from `access_mode`.** Drive destructiveness from Spec 1's resolved
   `endpoint_data_effects.access_mode` (write / read-write → unsafe), not the HTTP verb; fall back to
   the verb when no data-effect exists.
5. **Request/response schema projection.** Project the resolved endpoint request/response entity
   shapes (Spec 4 SOAP message entities; REST `request_data_entity_point_id` /
   `response_data_entity_point_id` body DTOs) into the synthesised operation's `requestSchema` /
   `responseSchema` so the harness can build a valid request.
6. **Advisory / graceful.** If a source signal is absent (no Spec 2 behaviour, no #1
   `response_contract`), degrade to the seeds that can be computed; never block.
7. **Scope.** REST first; SOAP seeds from Spec 4 where available.

## Requirements Discussion

> All clarifying questions were resolved and user-approved BEFORE this document was written. The
> answers below are FINAL build decisions, not prompts for further input. There are no open
> questions; the build session must implement exactly what is recorded here.

### First Round Questions

**Q1 — Seed shape and where it rides.**
What is the shape of a scenario seed, and how does it travel from AMS to the harness?
**Answer:** A new `scenarioSeeds` block on `MigrationDiscoveryContextDto`, computed-on-read by
`MigrationDiscoveryContextService`. Shape = one entry per included operation, each holding an ordered
list of seeds. Each SEED carries: `scenarioType` (`happy_path` | `edge` | `error` | `auth_variant`),
`scenarioName` (stable, deterministic, e.g. `happy_path`, `edge_missing_required_field`,
`error_not_found`, `auth_missing_token`), `exampleRequest` (`{ body, pathParams, queryParams,
headers }` — any subset; absent fields omitted), `preconditions` (free-text list of data that must
pre-exist, e.g. "an Owner row with id=1 must exist"), `expectedStatus` (nullable integer best-guess,
e.g. 200 / 400 / 404 / 401), `safeToExecute` (boolean, decision #4), and `provenance` (which model
signal produced it: `behavior.io` / `behavior.validation` / `behavior.edge_cases` /
`access_mode` / `response_contract` / `soap_message` / `verb_fallback`). The operation key is the
SOAP-aware operation key the service already uses for the coverage-gate inventory reconciliation
(method+path for REST; SOAP operation key for SOAP), so a seed entry binds unambiguously to the
harness's persisted operation row. The block is carried INSIDE the existing migration-discovery-
context response that the harness already fetches once per session — NO new endpoint, NO new
transport.

**Q2 — Seed-source mapping (which model signal feeds which scenario type).**
Precisely which persisted signal produces each of the four scenario types?
**Answer:**
- `happy_path` — built from `BusinessLogicEntity.behavior.io` (input names/types/meaning →
  example body/params) for the rule-bearing method(s) on the endpoint's call path, plus the
  projected request schema (decision #5) for field shapes. Preconditions come from `behavior.io`
  (inputs that reference existing data) and from Spec 1's read-side `endpoint_data_effects` (entities
  the happy path reads must pre-exist). `expectedStatus` defaults to 200/201 by access mode.
- `edge` — one seed per boundary documented in `behavior.edge_cases` (null/empty/boundary per
  branch) and per required field in `behavior.validation` / the request schema (missing-required
  variant). `expectedStatus` from the validation block's documented failure status where present.
- `error` — built from `behavior.validation` (the check → error/exception → status/fault mapping)
  and, when present, Spec #1's `response_contract` (documented non-2xx responses: 400/404/409/422
  with their shapes). `expectedStatus` taken from the contract / validation mapping.
- `auth_variant` — built ONLY when an auth signal exists: Spec #1's `response_contract` 401/403
  responses, or a documented auth precondition in `behavior` (e.g. a security-relevant precondition /
  side effect). Produces a "missing/invalid token" seed with `expectedStatus` 401/403.
  When NO auth signal exists, NO `auth_variant` seed is emitted (decision #6 — graceful degrade;
  do NOT fabricate an auth model).

**Q3 — `safe_to_execute` derivation.**
How is destructiveness decided, given decision #4?
**Answer:** Per operation, resolve from Spec 1's `endpoint_data_effects` for that endpoint: if ANY
effect has `access_mode` `write` or `read-write` → the operation is UNSAFE (`safeToExecute=false`)
and every seed for it inherits `safeToExecute=false`. If all effects are `read`, or there are
effects but none are write → SAFE. If there are NO `endpoint_data_effects` rows for the endpoint at
all → fall back to the HTTP verb via the harness's existing `NON_MUTATING_METHODS` set (the current
behaviour), and stamp `provenance: verb_fallback`. The computed `safeToExecute` is advisory metadata
on the seed; it does NOT auto-execute anything and does NOT override the session's existing
`mutating_calls_confirmed` gate — it makes the existing gate accurate instead of verb-guessed.

**Q4 — Schema projection (decision #5) — exactly what gets projected, and where the harness uses it.**
**Answer:** In `captureSessionActions.ts` (the discovery-endpoint→operation synthesiser, where REST
rows are currently emitted with `requestSchema: null` / `responseSchema: null`), project the resolved
entity shape into `requestSchema` / `responseSchema`:
- REST: resolve `EndpointEntity.requestDataEntityPointId` / `responseDataEntityPointId` → the logical
  data entity + its attributes (name/dataType/isNullable/isPrimaryKey) → a minimal JSON-schema-shaped
  object (`{ type: 'object', properties: {...}, required: [...] }`). Best-effort; if the point is
  unresolved, leave null (current behaviour) and degrade.
- SOAP: from Spec 4's per-interface bound message entities (`InterfaceLogicalEntityEntity`:
  `interfaceId` + `dataEntityPointId` + `direction`) project the request/response message field shape
  into the SOAP operation stub (already carried under `x-amvs-soap`). Best-effort; degrade when
  absent.
  The projected schema is what the harness (and its LLM fallback) uses to build a valid request body;
  the example values from the seeds (Q2) fill it.

**Q5 — Harness expansion behaviour (decision #3) — how `defaultScenarioSet` changes.**
**Answer:** `defaultScenarioSet(op)` is rewritten to read the per-operation seeds from the injected
`discoveryContext.scenarioSeeds` (matched by the SOAP-aware operation key) and return ONE scenario
per seed (`{ name: seed.scenarioName, type: seed.scenarioType }`) instead of the single hardcoded
happy-path. When NO seeds exist for the operation (no discovery context, or nothing computable), it
falls back to the current single `happy_path` — behaviour-preserving for un-seeded operations. The
persisted scenario row already carries `scenario_type` (line 472), so the four seed types flow
straight into `api_behaviour_scenarios` with no schema change. The seed's `exampleRequest` /
`preconditions` / `expectedStatus` / `safeToExecute` are threaded into the per-scenario prompt via
the SAME `discoveryContext` object `buildScenarioPrompt` already consumes (line 488–495), under a new
`scenarioSeed` field on the prompt's `discoveryContext` payload, with explicit guidance: "These are
SEEDED inputs computed from the discovery model. Use them as the starting request; REFINE them
against the live OAS/response evidence; do NOT discard them to invent blind. Record a note via
`record_capture_note` if a seeded input is contradicted by evidence." The LLM remains the executor
and refiner — it is no longer the blind inventor.

**Q6 — Persistence: compute-on-read vs a new `api_behaviour_*` field.**
**Answer:** COMPUTE-ON-READ, NO new persistence, NO Liquibase changeset in v1 (decision #2). The
seeds are derived from the already-persisted Spec 1/2/4(/#1) model every time the harness fetches the
migration-discovery-context, exactly as the Capture Coverage Gates spec (2026-05-30) computes its
advisory coverage dimensions in this same service. A small `api_behaviour_*` persistence field is
added ONLY if a later iteration shows the harness genuinely MUST persist accepted seeds (e.g. for
replay-stability across re-runs) — explicitly PREFER NOT, and it is OUT OF SCOPE for v1. The seeds
ride on the scenario rows the harness already persists (`scenario_type` + the LLM-refined inputs the
existing loop already saves); v1 adds no new column.

**Q7 — Frontend surfacing.**
**Answer:** OPTIONAL and minimal: show the SEEDED SCENARIO COUNT on the existing capture surface
(the capture-session / baseline view that already renders operation + scenario counts), reusing the
existing count-display treatment. NO bespoke widget, NO per-seed editor, NO new page. If the count is
trivially derivable from data the surface already has, this can be a one-line addition; if it would
require new plumbing, it is deferred without affecting the core (backend seeding is the deliverable).

**Q8 — Explicit out-of-scope.**
**Answer:** Auto-executing capture (the run stays operator-initiated and gated; seeds are advisory).
New meta-model entity types (seeds are test-process reality, computed-on-read — NOT a new type; see
the meta-model reference: architecture holds ARCHITECTURE only, and the existing `endpoint_data_effects`
/ `business_logics.behavior` signals already hold the truth we read). A blocking gate (seeds never
block a capture run — degrade per decision #6). Changing the LLM capture loop's core (the
`runScenarioLoop` mechanics, tool surface, and diff/record flow are untouched; only the scenario LIST
and the per-scenario PROMPT seed are added). Non-Spring protocols for seed generation (REST + Spring-
Classic SOAP only; the seed computation reads Spec 1/2/4 outputs which are Spring-Classic-scoped).
Persisting accepted seeds (per Q6). The shape-spec path's `sampleDataHints` (a different DTO / a
different consumer — not touched).

### Existing Code to Reference

**Confirmed reuse targets (verified to exist; reuse — do NOT fork):**
- **AMS seed computation (the primary home):** `architecture-model-service/.../service/migration/MigrationDiscoveryContextService.java`
  — already a read-only, compute-on-read aggregation service that imports `EndpointEntity`,
  `EndpointDataEffectEntity` + `EndpointDataEffectRepository`, `InterfaceLogicalEntityEntity` +
  `InterfaceLogicalEntityRepository`, and `BusinessLogicRepository`/`BusinessLogicDto`. The Capture
  Coverage Gates spec (2026-05-30) already added compute-on-read advisory dimensions here — same
  pattern, same file. Add the per-operation `scenarioSeeds` computation alongside.
- **The carrier DTO (camelCase convention to MATCH):** `architecture-model-service/.../model/dto/migration/MigrationDiscoveryContextDto.java`
  — every field is `@JsonProperty("camelCase")` and every numeric is BOXED (`Long`/`Integer`/`Double`)
  to avoid the primitive-default-to-zero hazard. The new `scenarioSeeds` field + its nested records
  MUST follow this exact convention. `ReadinessAssessmentDto.java` is the sibling DTO and is also
  per-field `@JsonProperty("camelCase")`.
- **Seed-source precedent (the contrast DTO):** `architecture-model-service/.../model/dto/migration/MigrationSpecContextDto.java`
  — its `sampleDataHints` fields (`List<Map<String, Object>>`, `@JsonProperty("sampleDataHints")`,
  lines 195 / 227) are the precedent SHAPE for a loose, LLM-ready hint list. The seed
  `exampleRequest` / `preconditions` may use the same `List<Map<String, Object>>` looseness where a
  typed record would be over-constraining.
- **Seed-source signals (read-only):** `BusinessLogicEntity.behavior` JSONB (io / validation /
  edge_cases — line 61); `EndpointDataEffectEntity.accessMode` + `pathMetadataJson` (lines 102 /
  111); `EndpointEntity.requestDataEntityPointId` / `responseDataEntityPointId` (lines 65 / 68) +
  its SOAP metadata block; `InterfaceLogicalEntityEntity` (`interfaceId` + `dataEntityPointId` +
  `direction`) for SOAP message shapes.
- **Gateway proxy (confirm only — NO change):** `gateway/src/routes/migrationContext.ts` is a thin
  byte-for-byte pass-through ("No business logic lives here"; `res.status(200).json(result)`,
  forwards the body verbatim). The new `scenarioSeeds` field rides through unchanged. NO gateway edit
  expected.
- **Harness scenario expansion:** `api-migration-validation-service/src/services/captureSessionOrchestrator.ts`
  — `defaultScenarioSet` (line 357, the one-per-op generator to expand), the orchestration loop
  (lines 456–508) that already creates a `scenario_type`-carrying scenario row, and
  `buildScenarioPrompt` (line 488) which already threads `discoveryContext: MigrationDiscoveryContextDto`
  (the type imported at line 77) into the per-scenario prompt. The seeds plug into THIS object.
- **Harness `safe_to_execute` + schema projection:** `api-migration-validation-service/src/routes/captureSessionActions.ts`
  — `isNonMutatingMethod` (line 216, the verb-only check to keep as FALLBACK), the discovery-endpoint
  synthesiser emitting `requestSchema: null` / `responseSchema: null` (lines 428–429, where decision
  #5 projects shapes), and `persistInventory` (line 231, where `safe_to_execute` is stamped — now
  fed by the access-mode-derived flag with verb fallback).
- **Shared verb set:** `api-migration-validation-service/src/types/oas.ts` (`NON_MUTATING_METHODS`)
  — the fallback when no `endpoint_data_effects` exists.

**Genuinely NEW work (no prior art):**
- The per-operation seed COMPUTATION in `MigrationDiscoveryContextService` (mapping `behavior` parts +
  `access_mode` + `response_contract` + SOAP message shapes → the four scenario-type seeds with
  example inputs / preconditions / expected status). There is no existing seed builder.
- The harness-side consumption that turns seeds into N scenarios + pre-filled per-scenario prompt
  inputs (the current code only ever builds one blind happy-path).
- The REST/SOAP request/response SCHEMA PROJECTION from resolved entity points into the synthesised
  operation (`requestSchema` / `responseSchema` are hardcoded null today).

### Follow-up Questions

None. All eight clarifying questions were resolved and user-approved before this document was
written; every decision above is FINAL.

## Visual Assets

### Files Provided:

No visual assets provided. The `planning/visuals/` folder was created and is empty. The feature is
backend-dominant; the only optional UI touch (a seeded-scenario count) reuses the existing capture-
surface count treatment, so no mockups are needed.

### Visual Insights:

Not applicable — proceeding without visuals.

## Requirements Summary

### Functional Requirements

- Compute, per INCLUDED operation, a set of **capture scenario seeds** of types `happy_path`,
  `edge`, `error`, and `auth_variant`, each carrying: `scenarioType`, a stable deterministic
  `scenarioName`, `exampleRequest` (`body` / `pathParams` / `queryParams` / `headers`, any subset),
  `preconditions` (data that must pre-exist), a nullable `expectedStatus`, a `safeToExecute` flag,
  and `provenance` (the model signal that produced it).
- **Source the seeds** from the already-persisted model:
  - `happy_path` ← Spec 2 `behavior.io` (+ projected request schema for field shapes; + read-side
    `endpoint_data_effects` for preconditions).
  - `edge` ← `behavior.edge_cases` + required-field/`behavior.validation` boundaries.
  - `error` ← `behavior.validation` (check→error→status) + Spec #1 `response_contract` non-2xx
    (when present).
  - `auth_variant` ← Spec #1 `response_contract` 401/403 or a documented auth precondition — emitted
    ONLY when an auth signal exists; otherwise omitted (no fabricated auth model).
- **Compute-on-read at handoff:** the seeds are derived in `MigrationDiscoveryContextService` from the
  persisted Spec 1/2/4(/#1) model and carried on `MigrationDiscoveryContextDto.scenarioSeeds`
  (camelCase-wired, boxed numerics) — NO new persistence, NO Liquibase changeset in v1. Mirrors the
  Capture Coverage Gates spec's compute-on-read advisory dimensions in the same service.
- **Gateway proxies byte-for-byte:** the new field rides through `migrationContext.ts` unchanged (thin
  pass-through; confirmed — no gateway edit expected).
- **Harness expands scenarios:** `captureSessionOrchestrator.defaultScenarioSet` reads
  `discoveryContext.scenarioSeeds` (SOAP-aware operation key), returns ONE scenario per seed
  (`scenario_type` flows into the persisted scenario row), and falls back to the current single
  `happy_path` when no seeds exist (behaviour-preserving).
- **Harness pre-fills inputs:** the seed's `exampleRequest` / `preconditions` / `expectedStatus` /
  `safeToExecute` are threaded into the per-scenario prompt via the existing `discoveryContext`
  payload (new `scenarioSeed` field), with explicit guidance that the LLM REFINES the seeded inputs
  against live evidence rather than inventing blind. The capture loop mechanics, tool surface, and
  diff/record flow are otherwise untouched.
- **`safe_to_execute` from `access_mode`:** destructiveness is resolved from Spec 1's
  `endpoint_data_effects.access_mode` (any `write`/`read-write` → unsafe), with HTTP-verb fallback
  (`NON_MUTATING_METHODS`) only when no data-effect rows exist for the endpoint; stamped advisory on
  the seed and used to make the existing `mutating_calls_confirmed` gate accurate.
- **Request/response schema projection:** in `captureSessionActions.ts`, project the resolved REST
  body DTO (`request_data_entity_point_id` / `response_data_entity_point_id` → entity attributes →
  minimal JSON-schema object) and the SOAP message entity shape (Spec 4
  `InterfaceLogicalEntityEntity` bindings) into the synthesised operation's `requestSchema` /
  `responseSchema` — replacing the hardcoded `null`s. Best-effort; degrade to null when unresolved.
- **Advisory / graceful throughout:** any absent source signal degrades to the seeds that can be
  computed; nothing blocks a capture run.
- **Optional UI:** show a seeded-scenario count on the existing capture surface, reusing the existing
  count treatment; no bespoke widget. Deferred without affecting the core if it would need new
  plumbing.

### Reusability Opportunities

- `MigrationDiscoveryContextService` — add the seed computation to this existing compute-on-read
  aggregation service (same pattern the Capture Coverage Gates spec already established here).
- `MigrationDiscoveryContextDto` / `ReadinessAssessmentDto` — MATCH the per-field
  `@JsonProperty("camelCase")` + boxed-numeric convention for the new `scenarioSeeds` field and
  nested records.
- `MigrationSpecContextDto.sampleDataHints` — precedent for a loose `List<Map<String, Object>>`
  LLM-ready hint shape.
- `gateway/src/routes/migrationContext.ts` — byte-for-byte proxy; rides the new field for free.
- `captureSessionOrchestrator.ts` (`defaultScenarioSet`, the scenario loop's `scenario_type` row,
  `buildScenarioPrompt`'s `discoveryContext` thread) — the expansion + pre-fill seam.
- `captureSessionActions.ts` (`isNonMutatingMethod` as fallback, `persistInventory`'s
  `safe_to_execute`, the `requestSchema: null` synthesiser) — the access-mode + schema-projection
  seam.
- `api-migration-validation-service/src/types/oas.ts` `NON_MUTATING_METHODS` — the verb fallback.
- The persisted seed signals: `BusinessLogicEntity.behavior`, `EndpointDataEffectEntity.accessMode`,
  `EndpointEntity` request/response points + SOAP metadata, `InterfaceLogicalEntityEntity` SOAP
  message bindings — all read-only.

### Scope Boundaries

**In Scope:**
- AMS: per-operation scenario-seed computation in `MigrationDiscoveryContextService`, carried on a new
  `scenarioSeeds` block of `MigrationDiscoveryContextDto` (camelCase, boxed numerics), compute-on-read,
  NO changeset.
- gateway: confirm the byte-for-byte proxy carries the new field (no code change expected).
- harness (`api-migration-validation-service`): expand `defaultScenarioSet` to one-scenario-per-seed
  with happy-path fallback; thread seed inputs into the per-scenario prompt as REFINE-not-invent
  guidance; drive `safe_to_execute` from `access_mode` with verb fallback; project REST + SOAP
  request/response schemas into the synthesised operation.
- frontend (optional): seeded-scenario count on the existing capture surface, reusing existing count
  treatment.
- REST first; SOAP seeds from Spec 4 where available.

**Out of Scope:**
- Auto-executing capture (operator-initiated + gated; seeds are advisory).
- New meta-model entity types (seeds are test-process reality, computed-on-read).
- A blocking gate (always degrade gracefully; never block).
- Changing the LLM capture loop's core (`runScenarioLoop` mechanics / tool surface / diff+record flow
  untouched — only the scenario LIST and per-scenario PROMPT seed are added).
- Non-Spring protocols for seed generation (REST + Spring-Classic SOAP only).
- Persisting accepted seeds / any new `api_behaviour_*` column in v1 (compute-on-read; add later ONLY
  if the harness genuinely must persist accepted seeds — prefer not).
- The shape-spec path's `sampleDataHints` (different DTO / different consumer — untouched).

### Technical Considerations

- **AMS wire format:** `MigrationDiscoveryContextDto` is camelCase-wired via per-field
  `@JsonProperty("camelCase")` (NOT the snake_case global default) and every numeric is BOXED
  (`Long`/`Integer`/`Double`) per the primitive-default-to-zero hazard
  (`project_primitive_double_dto_overwrite.md`). The new `scenarioSeeds` field and all nested records
  MUST follow this exact convention; the harness `MigrationDiscoveryContextDto` TypeScript type reads
  these camelCase fields, so the names must match on both sides.
- **Compute-on-read, no changeset (v1):** the seeds are derived from the persisted Spec 1/2/4(/#1)
  model on every migration-discovery-context read — no new tables, no Liquibase changeset, no writes
  (mirroring the Capture Coverage Gates spec, 2026-05-30, in this same service). Never edit an applied
  Liquibase changeset (`feedback_liquibase_immutable_changesets`).
- **Architecture vs reality:** scenario seeds are migration-process REALITY (test seeds), not
  architecture — so per the meta-model reference and `project_architecture_vs_reality`, they are NOT a
  new entity type; they are computed from the existing `endpoint_data_effects` /
  `business_logics.behavior` / SOAP-message signals that already hold the truth.
- **Graceful degradation is mandatory** (decision #6): seeds are best-effort and advisory; absent
  signals reduce the seed set but never block, and the harness preserves its current single-happy-path
  behaviour for un-seeded operations.
- **In-flight runs:** do NOT edit `discovery-service/src/**` (or restart the harness mid-run) while a
  discovery/capture run is in flight — `tsx watch` auto-reload kills runs
  (`feedback_no_src_edits_during_run`). This spec's edits are in AMS (Java) + the harness +
  optionally the frontend; sequence harness edits when no capture run is active.
- **The LLM stays the verifier/refiner, not the inventor:** the harness's per-scenario LLM loop is
  retained verbatim; the only change is that it now starts from seeded inputs and is instructed to
  refine-against-evidence rather than invent blind, recording a `record_capture_note` when evidence
  contradicts a seed.

## Phase-2 Build Ordering & File-Overlap

**Position:** Spec #2 of 6 in the HAIKAI Phase-2 "oracle perfection" program. Built STRICTLY
SEQUENTIALLY, AFTER Spec #1.

**Dependency on Spec #1:** Spec #2 depends on Spec #1's `response_contract` for the RICHEST `error`
and `auth_variant` seeds (the documented non-2xx / 401 / 403 responses with their shapes). The
intended build order is **#1 then #2**. If Spec #1's `response_contract` is absent at build/run time,
Spec #2 DEGRADES GRACEFULLY (decision #6): it still emits `happy_path` + `edge` from Spec 2
`behavior`, and `error` seeds from `behavior.validation`'s check→status mapping; `auth_variant` is
simply omitted when no auth signal exists. No hard build-time dependency — but the seeds are
materially richer when #1 lands first.

**Shared-file overlap with Spec #3 (integrity readiness):** Spec #2 and Spec #3 BOTH modify
`MigrationDiscoveryContextService` + the migration-discovery-context DTO — Spec #3 adds integrity
readiness signals to the SAME service and DTO. To avoid merge work, **build Spec #2 before Spec #3
touches the service** (or expect a merge in `MigrationDiscoveryContextService.java` +
`MigrationDiscoveryContextDto.java`). The additions are additive (a new DTO field + a new compute
block each), so a merge is mechanical but real — sequencing #2 before #3 is preferred.

**Sole owner of the harness:** Spec #2 is the ONLY Phase-2 spec that touches
`api-migration-validation-service` (`captureSessionOrchestrator.ts` / `captureSessionActions.ts` /
the prompt seam). No other Phase-2 spec edits the harness, so the harness-side changes carry NO
cross-spec merge risk.

**Net build order guidance:** #1 (data-effects + `response_contract`) → **#2 (this: capture scenario
seeding)** → #3 (integrity readiness, which then layers onto the same AMS service/DTO #2 extended).
Specs #4 (SOAP message field depth) and the remaining Phase-2 specs supply richer SOAP message shapes
that #2's SOAP schema projection reads when present — #2 degrades gracefully if they are not yet in.
