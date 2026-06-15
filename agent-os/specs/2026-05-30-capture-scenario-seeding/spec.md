# Spec: Capture Scenario Seeding

> Spec folder: `agent-os/specs/2026-05-30-capture-scenario-seeding`
> Spec #2 of 6 in the HAIKAI Phase-2 "oracle perfection" program.
> Builds on spec #1 `response-contract-capture` (commit `019d17d`, master).
> Source of truth: `planning/requirements.md` in this folder.

## Summary

The runtime equivalence harness (`api-migration-validation-service`, "AMVS")
captures → replays → diffs each API operation. Today it improvises every input:
`defaultScenarioSet` emits exactly one blind `happy_path` per operation, the LLM
is told to invent the request body/params blind, and `safe_to_execute` is decided
from the HTTP verb alone. Meanwhile discovery has already persisted the perfect
seed material — per-endpoint `response_contract` (spec #1), `endpoint_data_effects`
access modes, and SOAP message shapes — but that material dead-ends at display.

This spec makes discovery **seed** the harness. The Architecture Model Service
(AMS) computes, per included operation, a set of **capture scenario seeds**
(`happy_path` / `edge` / `error` / `auth_variant`) on-read and carries them on the
existing migration-discovery-context response. The harness expands its scenario
set from those seeds, threads the seeded inputs into the per-scenario LLM prompt
as REFINE-not-invent guidance, and drives `safe_to_execute` from the real data
access mode (with HTTP-verb fallback). The LLM remains the executor/refiner — no
longer the blind inventor. Everything is advisory and degrades gracefully.

## Design decisions (from planning/requirements.md — FINAL, not re-litigated)

- **D1 Scenario-seed model.** Per included operation, a set of seeds of types
  `happy_path` + `edge` + `error` + `auth_variant`, each with example inputs,
  preconditions, an expected status, a `safeToExecute` flag, and `provenance`.
  Seeds are migration-process REALITY (test seeds), NOT a new meta-model entity.
- **D2 Computed-on-read at handoff.** AMS computes seeds in
  `MigrationDiscoveryContextService` from the already-persisted model and carries
  them on `MigrationDiscoveryContextDto` (camelCase-wired, boxed numerics). NO new
  persistence, NO Liquibase changeset in v1 (mirrors the Capture Coverage Gates
  spec already living in this service).
- **D3 Harness consumes the seeds.** `defaultScenarioSet` expands beyond one
  happy-path using the seeds (one scenario per seed); per-scenario prompt is
  pre-filled with the seeded inputs; LLM REFINES rather than invents.
- **D4 `safe_to_execute` from `access_mode`.** Destructiveness from
  `endpoint_data_effects.access_mode` (write / read-write → unsafe); fall back to
  the HTTP verb (`NON_MUTATING_METHODS`) when no data-effect rows exist.
- **D5 Request/response schema projection.** Project resolved endpoint request /
  response shapes into the synthesised operation's `requestSchema` /
  `responseSchema` so the harness can build a valid request. Best-effort; SOAP
  from the endpoint's SOAP metadata; degrade to null when unresolved.
- **D6 Advisory / graceful.** Any absent source signal degrades to the seeds that
  can be computed; nothing ever blocks a capture run.
- **D7 Scope.** REST first; SOAP seeds/shapes where available.

## Functional requirements

### FR1 — Scenario-seed DTO block (AMS)

`MigrationDiscoveryContextDto` gains a `scenarioSeeds` field: a list of
per-operation seed sets. Each set is keyed by the SOAP-aware operation key the
service already uses for coverage-gate reconciliation (`"<METHOD> <path>"` for
REST; `soap::<soap_action>` for SOAP) and carries the operation `method`/`path`,
an operation-level `safeToExecute`, and an ordered `seeds` list. Each **seed**
carries `scenarioType`, a stable deterministic `scenarioName`, `exampleRequest`
(`body`/`pathParams`/`queryParams`/`headers`, any subset), `preconditions`
(free-text list), a nullable `expectedStatus`, a `safeToExecute` flag, and
`provenance` (the model signal that produced it). All fields follow the per-field
`@JsonProperty("camelCase")` + boxed-numeric convention of the carrier DTO.

### FR2 — Seed computation, compute-on-read (AMS)

`MigrationDiscoveryContextService` computes the seeds in `build(...)` from the
already-persisted model, reusing the existing operation-key helpers and the
already-injected `EndpointRepository` / `EndpointDataEffectRepository`. Seed
sourcing per type:

- `happy_path` — emitted for every included operation; `expectedStatus` defaults
  by access mode (200, or 201 for a writing POST); `preconditions` from read-side
  `endpoint_data_effects`; provenance `access_mode` (or `verb_fallback`).
- `error` — from the endpoint's spec-#1 `response_contract` documented non-2xx
  responses (`error_responses[]` / non-2xx `status_codes` / `validation[]`);
  `scenarioName` `error_<status>`; `expectedStatus` from the contract; provenance
  `response_contract`.
- `edge` — from `response_contract.validation[]` required-field checks
  (missing-required variant → `edge_missing_required_field`, 400) and
  `conditional_variants[]`; provenance `response_contract`.
- `auth_variant` — ONLY when an auth signal exists (`response_contract.auth` or a
  401/403 documented response) → `auth_missing_token`, `expectedStatus` 401/403;
  provenance `response_contract`. Omitted entirely when no auth signal exists.

`safeToExecute` is resolved once per operation from `endpoint_data_effects`
(any write/read-write → false; all read → true; none → HTTP-verb fallback) and
inherited by every seed for that operation.

Graceful degradation: when an operation matches no model endpoint or carries no
`response_contract`, the operation still receives a minimal `happy_path` seed so
the harness has a grounded starting point; richer types are simply omitted.

### FR3 — Gateway pass-through (confirm only)

`gateway/src/routes/migrationContext.ts` forwards the AMS response body verbatim
(`res.status(200).json(result)`). The new `scenarioSeeds` field rides through
with no gateway change.

### FR4 — Harness scenario expansion (AMVS)

The harness `MigrationDiscoveryContextDto` TypeScript type (in
`archModelClient.ts`) gains the matching optional `scenarioSeeds` shape.
`defaultScenarioSet(op, discoveryContext?)` looks up the op's seed set by the
`"<METHOD> <path>"` key and returns one `{ name, type }` per seed; when no seeds
exist it falls back to the current single `happy_path` (behaviour-preserving).
The four seed types flow straight into the persisted `scenario_type` with no
schema change.

### FR5 — Per-scenario prompt pre-fill (AMVS)

`buildScenarioPrompt` gains an optional `scenarioSeed` parameter; when present it
adds a `scenarioSeed` block to the prompt's user payload with explicit guidance:
"These are SEEDED inputs computed from the discovery model. Use them as the
starting request; REFINE them against the live OAS/response evidence; do NOT
discard them to invent blind. Record a note via `record_capture_note` if a seeded
input is contradicted by evidence." The orchestration loop passes the seed that
matches the current scenario (by `scenarioName`). `runScenarioLoop` mechanics,
the tool surface, and the diff/record flow are untouched.

### FR6 — `safe_to_execute` from access mode (AMVS)

`persistInventory` derives each operation's `safe_to_execute` from the
seed-set-provided `safeToExecute` (access-mode-derived) keyed by `"<METHOD>
<path>"`, falling back to the existing verb-only `isNonMutatingMethod` when the
operation has no seed set. This makes the existing `mutating_calls_confirmed`
gate accurate instead of verb-guessed; it does not auto-execute anything.

### FR7 — Schema projection (AMVS, best-effort)

The discovery-endpoint→operation synthesiser, which currently emits
`requestSchema: null` / `responseSchema: null`, projects a minimal schema for
SOAP operations from the endpoint's SOAP metadata (`request_root_element` /
`response_root_element` carried under `x-amvs-soap`). REST schema projection
degrades to `null` (current behaviour) when the request/response entity shape is
not resolvable at the synthesiser, and is recorded as a follow-up.

## Non-functional / constraints

- AMS DTO is camelCase-wired (per-field `@JsonProperty`), boxed numerics — the
  harness TS field names must match exactly on both sides.
- Compute-on-read only; no new tables / no Liquibase changeset (v1).
- Seeds are advisory and best-effort; never block a run.
- Harness: only the scenario LIST and the per-scenario PROMPT seed change; the
  capture loop core is untouched. Sole owner of the harness among Phase-2 specs.

## Out of scope

Auto-executing capture; new meta-model entity types; any blocking gate; changing
the LLM capture loop core; non-Spring protocols; persisting accepted seeds / any
new `api_behaviour_*` column; the shape-spec path's `sampleDataHints`. The
optional frontend seeded-scenario count is deferred (backend seeding is the
deliverable).

## Affected / new files

AMS (Java):
- `.../model/dto/migration/MigrationDiscoveryContextDto.java` — add `scenarioSeeds`
  field + `ScenarioSeedSetDto` / `ScenarioSeedDto` nested records.
- `.../service/migration/MigrationDiscoveryContextService.java` — add
  `computeScenarioSeeds(...)` and thread it into `build(...)`.
- New test `.../service/migration/MigrationDiscoveryContextScenarioSeedsTest.java`.

Harness (TypeScript):
- `api-migration-validation-service/src/services/archModelClient.ts` — add the
  `scenarioSeeds` shape to the TS DTO.
- `.../src/services/captureSessionOrchestrator.ts` — expand `defaultScenarioSet`,
  thread the seed into `buildScenarioPrompt`.
- `.../src/routes/captureSessionActions.ts` — `safe_to_execute` from seeds,
  minimal SOAP schema projection.
- New jest tests under `.../src/__tests__/`.

Gateway: confirmed pass-through, no change.

## Acceptance criteria

- AMS `MigrationDiscoveryContextDto` serializes a camelCase `scenarioSeeds` block;
  seeds cover `happy_path` always, plus `error`/`edge`/`auth_variant` when the
  endpoint's `response_contract` provides the signal; `safeToExecute` reflects
  `access_mode` with verb fallback. No changeset added.
- Harness `defaultScenarioSet` returns one scenario per seed for a seeded op and
  the single `happy_path` for an unseeded op; the seeded inputs reach the
  per-scenario prompt with refine-not-invent guidance; `persistInventory`'s
  `safe_to_execute` uses the access-mode-derived flag with verb fallback.
- Gateway forwards the field unchanged.
- Harness jest tests pass. AMS tests are written correctly (run on a Maven-capable
  machine; not run here).
