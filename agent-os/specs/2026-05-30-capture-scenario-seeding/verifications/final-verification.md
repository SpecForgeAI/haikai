# Final Verification — Capture Scenario Seeding

> Verdict: **PASS (code complete & internally consistent on disk), tests
> NOT executed in this environment, NOT committed.** All seven requirement
> areas are implemented and were verified on the authoritative working disk via
> the file tools. Automated tests could not be run reliably here (see Caveats),
> and the change was deliberately NOT committed because the sandbox's git layer
> sees a corrupted/stale mount. The user must run the test suites and commit on
> a healthy checkout.

Spec folder: `agent-os/specs/2026-05-30-capture-scenario-seeding`
Verified against `spec.md` / `tasks.md`. Date: 2026-05-30.
Branch: `master`; HEAD remains spec #1 `019d17d` (this change is uncommitted in
the working tree).

## Environment caveats (why tests weren't run / why not committed)

This build ran in a sandbox whose Linux mount served stale, truncating, and at
times NUL-/garbage-laden snapshots of the larger edited files, while the
authoritative Windows-disk file tools (Read/Edit/Write/Grep) stayed reliable.
Consequently `tsc`/`jest`/`git` — which run against the mount — could not
produce trustworthy results, and a commit made here would have recorded
corrupted file contents. Java additionally cannot compile here (no Maven/JDK).
Every "PASS" below was therefore established by authoritative file-tool review,
not by a green CI run.

## Verdict summary

| Area | Result |
|------|--------|
| FR1 — AMS `scenarioSeeds` DTO block (camelCase, boxed numerics) | PASS (reviewed) |
| FR2 — AMS compute-on-read seed computation, no changeset | PASS (reviewed) |
| FR3 — Gateway byte-for-byte pass-through (no change) | PASS (confirmed) |
| FR4 — Harness `defaultScenarioSet` expansion + happy-path fallback | PASS (reviewed) |
| FR5 — Harness per-scenario prompt seed pre-fill (refine-not-invent) | PASS (reviewed) |
| FR6 — `safe_to_execute` from access_mode with verb fallback | PASS (reviewed) |
| FR7 — Schema projection: SOAP projected, REST → null (per spec) | PARTIAL (per spec) |
| Harness (TS) tests | WRITTEN; not reliably executed here |
| AMS (Java) tests | WRITTEN; not run (no Maven/JDK) |
| On-disk consistency (authoritative file tools) | PASS |
| Commit | NOT committed (intentional — see caveats) |

## Requirement detail (all verified via authoritative file reads)

**FR1 / FR2 — AMS.** `MigrationDiscoveryContextDto.java` carries nested records
`ScenarioSeedDto` (`scenarioType`, `scenarioName`, `exampleRequest`,
`preconditions`, `expectedStatus` boxed `Integer`, `safeToExecute` boxed
`Boolean`, `provenance`) and `ScenarioSeedSetDto` (`operationKey`, `method`,
`path`, `safeToExecute`, `seeds`), plus a top-level
`@JsonProperty("scenarioSeeds") List<ScenarioSeedSetDto> scenarioSeeds` as the
final record component; the record closes cleanly. `MigrationDiscoveryContextService`
computes seeds on-read in `build(...)` via `computeScenarioSeeds(...)` →
`buildSeedSet(...)` with defensive helpers (`safeResponseContract`, `asMap`,
`asList`, `coerceStatus`, `collectErrorResponseStatuses`,
`collectStatusCodeStatuses`, `collectValidationStatuses`,
`hasRequiredFieldValidation`, `authIndicatesRequired`, `loadEffectsForSeeds`,
`isReadOnlyVerb`, `effectTarget`, `addSeed`). It reuses the existing
`loadHarnessOperationsForBaselines` + `resolveModelFileId` + `endpointKey`/
`operationKey` helpers and the already-injected
`EndpointRepository`/`EndpointDataEffectRepository` — **no new constructor
dependency, no persistence, no Liquibase changeset.** The single
`new MigrationDiscoveryContextDto(...)` call passes `scenarioSeeds` as its final
argument; the file closes at its class brace. Per included op it always emits
`happy_path`; adds `error_<status>` seeds from the spec-#1 `response_contract`
non-2xx responses; `edge_missing_required_field`/`edge_variant_<i>` from
validation/conditional variants; and `auth_missing_token` only when an auth
signal exists. `safeToExecute` is resolved from `access_mode` (write/read-write
→ false; all read → true; none → GET/HEAD/OPTIONS verb fallback) and inherited
by every seed. Returns an empty list (never null/never throws) when
collaborators are absent.

**FR3 — Gateway.** `migrationContext.ts` forwards the AMS body verbatim
(`res.status(200).json(result)`); the field rides through unchanged. No edit.

**FR4 / FR5 — Harness.** `archModelClient.ts` carries matching optional
`scenarioSeeds` (`ScenarioSeedDto`/`ScenarioSeedSetDto`, camelCase identical to
AMS). `captureSessionOrchestrator.ts` exports `operationSeedKey` /
`seedsForOperation` and a seed-aware `defaultScenarioSet(op, discoveryContext?)`
(one scenario per seed; single `happy_path` fallback). `buildScenarioPrompt`
takes an optional `scenarioSeed` and attaches a `scenarioSeed` block with
explicit refine-not-invent guidance; the loop passes the seed matching the
current scenario by `scenarioName`. `runScenarioLoop`, the tool surface and the
diff/record flow are untouched.

**FR6 — Harness.** `persistInventory` derives `safe_to_execute` from a
seed-safety map keyed by `"<METHOD> <path>"` (`buildSeedSafetyMap` +
`seededSafe`), falling back to verb-only `isNonMutatingMethod` when no seed set
matches. (Note: `persistInventory` is presently invoked from `/parse-oas`,
where no discovery context is in scope; the new param is optional and defaults
to verb logic, so behaviour is preserved. Threading a context fetch into
`/parse-oas` is a recorded follow-up.)

**FR7 — Harness (partial, per spec).** The discovery-endpoint synthesiser now
projects a minimal SOAP `requestSchema`/`responseSchema`
(`{ type:'object', 'x-amvs-soap-root': <root> }`) from the endpoint SOAP
metadata; REST stays `null`. Full REST entity-shape projection is a recorded
follow-up, as FR7 permits.

## Tests — written, NOT executed here

- Harness (jest): `api-migration-validation-service/src/__tests__/captureSessionSeeding.test.ts`
  — `operationSeedKey`, `seedsForOperation`, `defaultScenarioSet`
  (expand-per-seed + happy-path fallback), `buildScenarioPrompt` seed block +
  guidance, and `persistInventory` `safe_to_execute` from seed with verb
  fallback (passes a stub client directly — no module mock).
- AMS (JUnit/Mockito):
  `architecture-model-service/src/test/java/com/example/architecturemodel/service/migration/MigrationDiscoveryContextScenarioSeedsTest.java`.

Run on a healthy checkout:
- `cd api-migration-validation-service && npx tsc --noEmit && npx jest captureSessionSeeding && npx jest captureSession`
- `mvn -pl architecture-model-service test`

## On-disk consistency

All changed source + test files were verified present and internally consistent
via the authoritative file tools. During the session the heavily-edited
`captureSessionOrchestrator.ts` import header was transiently corrupted by the
flaky flush layer (duplicated imports); this was repaired and re-verified (clean
deduplicated imports; `defaultScenarioSet`/`buildScenarioPrompt`/`operationSeedKey`/
`seedsForOperation` each defined once; no stray text). The bash-mount `wc`/`grep`
views of the large files are stale/garbled and were disregarded in favour of the
file tools. **Recommendation:** before relying on these files, the user should
open `captureSessionOrchestrator.ts`, `captureSessionActions.ts`, and the two
large AMS Java files in a clean checkout and confirm they compile, since the
sandbox could not run the compilers.

## Stray draft files to delete (created during an aborted earlier misread)

These were neutralised to harmless void compilation units because the sandbox
denied deletion; they are NOT part of the change and should be removed:
`architecture-model-service/src/main/java/com/example/architecturemodel/capture/`
(CaptureScenarioSeeder.java, CaptureSeedStartupRunner.java, SeedSummaryDto.java),
`architecture-model-service/src/test/java/com/example/architecturemodel/capture/`
(CaptureScenarioSeederTest.java, SeedSummaryDtoTest.java),
`architecture-model-service/src/main/resources/seed/capture-scenarios.json`,
`frontend/src/api/captureSeedingApi.ts`, `frontend/src/api/captureSeedingApi.test.ts`.

## Commit

NOT committed. HEAD is still `019d17d`. Blockers: (a) `.git/HEAD.lock` and
`.git/index.lock` are held and could not be removed in the sandbox; (b) git in
the sandbox reads the corrupted/stale mount, so a commit here would record
broken files. The user should, on their machine: delete the stray files above,
run the test commands, and commit (e.g. `git add -A <the changed paths> && git commit`).

## Follow-ups
- Run the harness jest suite and the AMS Maven tests to confirm green.
- Full REST request/response entity-shape schema projection (FR7).
- Thread a discovery-context fetch into the `/parse-oas` handler so FR6's
  access-mode `safe_to_execute` applies there too.
- Optional frontend seeded-scenario count.
- Delete the neutralised stray files.
