# Tasks: Capture Scenario Seeding

> Source of truth: `spec.md` in this folder. Check off (`- [x]`) as completed.

## Task Group 1 — AMS scenario-seed DTO (FR1)

- [x] 1.1 Add nested record `ScenarioSeedDto` to `MigrationDiscoveryContextDto`
      (`scenarioType`, `scenarioName`, `exampleRequest` Map, `preconditions`
      List<String>, `expectedStatus` Integer, `safeToExecute` Boolean,
      `provenance`), per-field `@JsonProperty` camelCase.
- [x] 1.2 Add nested record `ScenarioSeedSetDto` (`operationKey`, `method`,
      `path`, `safeToExecute` Boolean, `seeds` List<ScenarioSeedDto>).
- [x] 1.3 Add top-level `@JsonProperty("scenarioSeeds") List<ScenarioSeedSetDto>
      scenarioSeeds` to the record and its canonical constructor.

## Task Group 2 — AMS seed computation, compute-on-read (FR2)

- [x] 2.1 Add `computeScenarioSeeds(...)` to `MigrationDiscoveryContextService`,
      enumerating included operations and matching them to model endpoints with
      the existing `operationKey` / `endpointKey` helpers (no new constructor
      deps; reuse injected `EndpointRepository` / `EndpointDataEffectRepository`).
- [x] 2.2 Resolve per-operation `safeToExecute` from `endpoint_data_effects`
      `access_mode` (write/read-write → false; all read → true; none → HTTP-verb
      fallback).
- [x] 2.3 Build `happy_path` (always), `error` (from `response_contract`),
      `edge` (from `response_contract.validation`/`conditional_variants`), and
      `auth_variant` (only when an auth signal exists) seeds with stable
      deterministic names, expected statuses, preconditions, and provenance.
- [x] 2.4 Thread the computed `scenarioSeeds` into the `MigrationDiscoveryContextDto`
      construction in `build(...)`. Degrade gracefully; never throw.

## Task Group 3 — Harness DTO + scenario expansion (FR4)

- [x] 3.1 Add `ScenarioSeedDto` / `ScenarioSeedSetDto` interfaces and an optional
      `scenarioSeeds` field to the harness `MigrationDiscoveryContextDto`
      (`archModelClient.ts`), camelCase matching AMS.
- [x] 3.2 Rewrite `defaultScenarioSet(op, discoveryContext?)` to return one
      `{ name, type }` per seed for the matched op key, falling back to a single
      `happy_path` when no seeds exist.

## Task Group 4 — Harness prompt pre-fill (FR5)

- [x] 4.1 Add an optional `scenarioSeed` parameter to `buildScenarioPrompt`;
      attach a `scenarioSeed` block to the user payload with refine-not-invent
      guidance.
- [x] 4.2 In the orchestration loop, pass the seed matching the current scenario
      (by `scenarioName`) into `buildScenarioPrompt`.

## Task Group 5 — Harness safe_to_execute + schema projection (FR6, FR7)

- [x] 5.1 Derive `persistInventory`'s `safe_to_execute` from the seed-set
      `safeToExecute` keyed by `"<METHOD> <path>"`, falling back to the existing
      verb-only `isNonMutatingMethod`.
- [x] 5.2 Project a minimal SOAP `requestSchema`/`responseSchema` in the
      discovery-endpoint synthesiser from the SOAP metadata; REST degrades to
      null (documented follow-up).

## Task Group 6 — Gateway (FR3)

- [x] 6.1 Confirm `gateway/src/routes/migrationContext.ts` forwards the response
      body verbatim — no code change.

## Task Group 7 — Tests & verification

- [x] 7.1 AMS: `MigrationDiscoveryContextScenarioSeedsTest` (Mockito) — seeds
      cover happy_path always; error/auth from `response_contract`; safeToExecute
      from access_mode with verb fallback; graceful when signals absent.
- [x] 7.2 Harness jest: `defaultScenarioSet` expands