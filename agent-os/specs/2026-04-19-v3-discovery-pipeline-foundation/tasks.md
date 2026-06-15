# Task Breakdown: V3 Discovery Pipeline Foundation

## Overview
Total Tasks: 8 task groups

This breakdown reflects the two-service shape of the spec (Java/Spring Boot `architecture-model-service` for tier persistence, TypeScript/Node `discovery-service` for the pipeline itself) and the dependency chain: DB migration -> DTO/mapper -> pack types -> registry -> spring-classic migration -> pipeline orchestrator -> wiring -> local harness -> tests -> docs.

## Task List

### Database & Persistence Layer (Java / architecture-model-service)

#### Task Group 1: Liquibase changeset + entity/DTO/mapper for `discovery_run.mode`
**Dependencies:** None (prerequisite for Java DTO plumbing; independent of TypeScript work)

- [x] 1.0 Add nullable tier/mode column to `discovery_run` end-to-end (DB -> entity -> DTO -> mapper)
  - [x] 1.1 Write 2-8 focused tests for the new column plumbing
    - Limit to 2-8 highly focused tests maximum
    - Target tests (pick a subset):
      - `DiscoveryRunControllerTest` or equivalent: a run payload with `mode: "A"` round-trips through the controller serialization
      - `EntityMapper` (Java) unit test: entity-with-mode -> DTO copies the value; DTO-with-mode -> entity copies the value
      - `DiscoveryRunEntity` persistence test (or existing `ServiceCoreTechPersistenceTest`-style): saving a run with a null mode succeeds, saving a run with `"A"` succeeds
    - Skip exhaustive coverage; pick the round-trip and one null-safety case
    - Model on `architecture-model-service/src/test/java/com/example/architecturemodel/service/ServiceCoreTechPersistenceTest.java` and `mapper/EntityMapperParticipantStylingTest.java`
  - [x] 1.2 Create new Liquibase changeset SQL file under `architecture-model-service/src/main/resources/db/changelog/sql/`
    - Follow the numbered-file pattern (e.g. `066-discovery-run-mode.sql` or next free number after `065-discovery-run.sql`)
    - Statement: `ALTER TABLE discovery_run ADD COLUMN mode VARCHAR(1) NULL;` (or `tier` — pick one and use consistently; spec allows either)
    - Column is nullable so existing rows stay valid
  - [x] 1.3 Wire the new changeset into `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
    - Follow the existing `include` entry pattern
  - [x] 1.4 Add the field to `DiscoveryRunEntity.java`
    - Nullable `String mode` (or `tier`) with JPA `@Column` mapping to the new DB column
    - Match the column name chosen in 1.2
  - [x] 1.5 Add the field to `DiscoveryRunDto.java`
    - Nullable `String mode` (or `tier`) — keep naming aligned with the entity and with what the TypeScript client will send
  - [x] 1.6 Update `EntityMapper.java` to copy the value in both directions (entity <-> DTO)
    - Mirror the pattern used for the recent `serviceId` column addition
  - [x] 1.7 Run ONLY the 2-8 tests written in 1.1
    - Verify the new changeset applies cleanly against the local dev DB
    - Do NOT run the full Java test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass
- `mvn liquibase:update` (or equivalent Spring Boot startup) applies the changeset successfully
- A `DiscoveryRunDto` with `mode = "A"` survives a DTO <-> entity round-trip
- Null mode values continue to work on pre-existing rows

---

### Discovery Service — Pack Type Contract

#### Task Group 2: Introduce `LanguagePack` + `FrameworkPack` types
**Dependencies:** None (pure TypeScript type definitions; can run in parallel with Task Group 1)

- [x] 2.0 Define the new pack interface contracts
  - [x] 2.1 Write 2-8 focused tests for the pack type surface
    - Limit to 2-8 highly focused tests maximum
    - Target tests (pick a subset):
      - A minimal `LanguagePack` implementation compiles and exposes `id`, `when.language`, `extract`
      - A minimal `FrameworkPack` implementation compiles and exposes `id`, `when.language`, `when.technology`, `adapt`
      - Type-level test: legacy `ExtensionPack` type still exports and its consumers compile (no runtime assertion needed — a `tsc --noEmit` smoke-run is sufficient or a trivial structural test)
    - Model on `discovery-service/src/__tests__/extensionPackFramework.test.ts`
  - [x] 2.2 Add `LanguagePack` type in `discovery-service/src/services/extensionPacks/`
    - Shape: `{ id: string; when: { language: string }; extract(sourceFiles, techHints): Map<filePath, SourceFileIR> }`
    - Import `SourceFileIR` unchanged from `languageIR.ts` — do NOT formalize the IR in this spec
  - [x] 2.3 Add `FrameworkPack` type in `discovery-service/src/services/extensionPacks/`
    - Shape: `{ id: string; when: { language: string; technology: string }; adapt(irFiles, runId, techHints): DiscoveryCandidate[] }`
  - [x] 2.4 Retain the legacy `ExtensionPack` type in `types/extensionPack.ts`
    - Keep the type export; unregister it at runtime later (Task Group 4)
    - Do NOT delete any V2 pack files — prefer un-registration (per spec Out of Scope)
  - [x] 2.5 Run ONLY the 2-8 tests written in 2.1
    - Verify compile-level integrity (`tsc --noEmit` is acceptable)
    - Do NOT run the entire test suite

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass
- `LanguagePack` and `FrameworkPack` types are importable from `services/extensionPacks`
- Legacy `ExtensionPack` type still compiles so dead V2 pack files do not break the build

---

#### Task Group 3: Registry refactor (`extensionPackRegistry.ts`)
**Dependencies:** Task Group 2

- [x] 3.0 Refactor the registry to carry two tiers plus tier computation
  - [x] 3.1 Write 2-8 focused tests for the new registry lookups
    - Limit to 2-8 highly focused tests maximum
    - Target tests (required — these are the spec's named scenarios):
      - `computeTier()` returns `'A'` when both language and framework packs match
      - `computeTier()` returns `'B'` when only a language pack matches
      - `computeTier()` returns `'C'` when neither matches
      - `findLanguagePack()` returns the correct pack for Java techHints
      - `findFrameworkPacks()` returns `[]` when techHints do not match any registered framework
    - Preserve `matchesPredicate` per-field AND semantics (classic-Spring techHints `{language:'Java'}` + `{technology:'Spring'}` match `{language:'Java', technology:'Spring'}` but NOT `{language:'Java', technology:'Spring Boot'}`) — include at least one test that pins this
    - Model on `discovery-service/src/__tests__/extensionPackFramework.test.ts`
  - [x] 3.2 Introduce `languagePacks[]` and `frameworkPacks[]` arrays in `extensionPackRegistry.ts`
  - [x] 3.3 Add `registerLanguagePack(pack)` and `registerFrameworkPack(pack)` functions
  - [x] 3.4 Add `findLanguagePack(techHints): LanguagePack | null`
    - Return the first matching pack (or null) — reuse `matchesPredicate`
  - [x] 3.5 Add `findFrameworkPacks(techHints): FrameworkPack[]`
    - Return all matching packs — reuse `matchesPredicate`
  - [x] 3.6 Add `computeTier(techHints): 'A' | 'B' | 'C'`
    - `'A'` when both language and framework match, `'B'` when only language matches, `'C'` when neither matches
  - [x] 3.7 Empty or remove the legacy `packs[]` runtime registrations; update `clearRegistry()` and `getRegisteredPackCount()` helpers to cover the new registries
    - Preserve `matchesPredicate` per-field AND semantics unchanged
  - [x] 3.8 Run ONLY the 2-8 tests written in 3.1
    - Do NOT run the full discovery-service test suite yet

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass
- `computeTier` returns A/B/C correctly per the three scenarios
- `findLanguagePack` and `findFrameworkPacks` use per-field AND predicate semantics (classic vs Boot distinction preserved)
- `clearRegistry()` resets both new registries cleanly for tests

---

### Discovery Service — Reference Pack Migration

#### Task Group 4: Migrate spring-classic to `LanguagePack` + `FrameworkPack`
**Dependencies:** Task Group 3

- [x] 4.0 Split the spring-classic V2 pack into a `javaLangPack` + `springClassicFrameworkPack`
  - [x] 4.1 Write 2-8 focused tests for the migrated pack
    - Limit to 2-8 highly focused tests maximum
    - Target tests (pick a subset):
      - `javaLangPack.extract` returns a `Map<filePath, SourceFileIR>` with entries for Java files and none for test files (reuses the existing `filterJavaFiles` / `isTestFile` behavior)
      - `springClassicFrameworkPack.adapt` given a minimal IR map produces candidates tagged `_addedBy: 'spring-classic-adapter'`
      - Registry smoke-test: after `register.ts` runs, `findLanguagePack({language:'Java'})` returns `javaLangPack` and `findFrameworkPacks({language:'Java', technology:'Spring'})` includes `springClassicFrameworkPack`
    - Skip exhaustive adapter behavior tests — OpenMRS parity in Task Group 7 is the acceptance vehicle
  - [x] 4.2 Create `javaLangPack` (LanguagePack)
    - Wrap existing `extractJavaIR` + `filterJavaFiles` + `isTestFile` logic from `springClassicPackV2/index.ts`
    - Produce `Map<filePath, SourceFileIR>` from source files
    - `when: { language: 'Java' }`
    - Place in the natural location — e.g. `discovery-service/src/services/extensionPacks/languagePacks/javaLangPack/` (or alongside existing language extractor)
  - [x] 4.3 Create `springClassicFrameworkPack` (FrameworkPack)
    - Delegates `adapt(irFiles, runId, techHints)` to the existing `runSpringClassicAdapter(irFiles, runId)` from `frameworkAdapters/springClassic/index.ts`
    - `when: { language: 'Java', technology: 'Spring' }` — preserve the classic-not-Boot predicate semantics
    - Ensure emitted candidates continue to carry `_addedBy: 'spring-classic-adapter'` (no tag change)
  - [x] 4.4 Update `extensionPacks/register.ts`
    - Remove the V2 `registerPack(springClassicPackV2)` call
    - Add `registerLanguagePack(javaLangPack)` and `registerFrameworkPack(springClassicFrameworkPack)`
    - Do NOT register the other 17 V2 packs (per spec Out of Scope — Spec 4 handles them)
  - [x] 4.5 Run ONLY the 2-8 tests written in 4.1
    - Do NOT run the full suite yet

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass
- `register.ts` no longer references the V2 `springClassicPackV2` runtime registration
- `javaLangPack` and `springClassicFrameworkPack` are the ONLY spring-classic runtime entries
- Adapter still tags candidates `_addedBy: 'spring-classic-adapter'` (no downstream consumer break)

---

### Discovery Service — Pipeline Orchestrator

#### Task Group 5: Create `discoveryV3Pipeline.ts` + wire into `llmFileAnalysisStep.ts`
**Dependencies:** Task Groups 1, 3, 4 (needs the DTO/mapper for tier persistence, the registry for lookups, and the migrated spring-classic pack so there is something to run)

- [x] 5.0 Build the four-stage V3 orchestrator and make it the unconditional runtime entry point
  - [x] 5.1 Write 2-8 focused tests for `runDiscoveryV3`
    - Limit to 2-8 highly focused tests maximum
    - Target tests (required — named in the spec):
      - `runDiscoveryV3` writes `gapFillStage: "v3-spec1-stub"` and `gapFillCandidates: 0` into `steps_payload` on every run
      - `runDiscoveryV3` with techHints matching Java + Spring runs both stages and returns candidates tagged `_addedBy: 'spring-classic-adapter'`
      - `runDiscoveryV3` passes the computed tier through to the persisted run record (A when spring-classic present, B when only the language pack registers, C when neither)
    - Use fakes/mocks for the persistence layer (e.g. mock the candidate-save path and `architectureModelClient`) — full persistence is integration-tested by the harness in Task Group 7
    - Model on `discovery-service/src/__tests__/extensionPackFramework.test.ts`
  - [x] 5.2 Create `discovery-service/src/services/discoveryV3Pipeline.ts` exporting `runDiscoveryV3(context)`
    - Stage 1: call `findLanguagePack(techHints)`; if present, run `extract(sourceFiles, techHints)` to build `Map<filePath, SourceFileIR>`
    - Stage 2: call `findFrameworkPacks(techHints)`; for each, invoke `adapt(irFiles, runId, techHints)` and collect candidates
    - Stage 3: STUB ONLY — write `gapFillStage: "v3-spec1-stub"` and `gapFillCandidates: 0` into the run's `steps_payload`. NO LLM calls, NO prompts, NO placeholder candidates
    - Stage 4: merge candidates from Stages 1-2 and persist via the existing candidate-save paths
  - [x] 5.3 Compute tier via `computeTier(techHints)` and thread it through to the run record
    - Populate the new `mode`/`tier` DTO field (from Task Group 1) on every run — `'A' | 'B' | 'C'`
  - [x] 5.4 Wire `runDiscoveryV3` into `llmFileAnalysisStep.ts` unconditionally
    - Remove the V2 LLM-first runtime invocation path
    - Per spec: keep dead V2 files unlinked rather than churning deletion
    - No `DISCOVERY_PIPELINE_VERSION` feature flag — V3 is unconditional (dev/test env override is optional per implementer discretion)
  - [x] 5.5 Update `runManager.ts` if needed to carry the new tier through the run lifecycle
    - Check: tier needs to be populated before the run is persisted by the candidate-save path
  - [x] 5.6 Run ONLY the 2-8 tests written in 5.1
    - Do NOT run the full discovery-service test suite yet

**Acceptance Criteria:**
- The 2-8 tests written in 5.1 pass
- `runDiscoveryV3` is the only runtime pipeline invoked from `llmFileAnalysisStep.ts`
- V2 LLM-first runtime path is unreachable (but V2 files may stay in-tree as dead code)
- Every V3 run emits `gapFillStage: "v3-spec1-stub"` + `gapFillCandidates: 0` into `steps_payload`
- Every V3 run persists the computed tier on the run record

---

### Local Harness

#### Task Group 6: Update local harness scripts for the V3 shape
**Dependencies:** Task Group 5

- [x] 6.0 Update `run-pack-local.ts`, sibling scripts, and `batch-validate-packs.sh` to drive the V3 shape
  - [x] 6.1 Write 2-8 focused tests for the harness wiring
    - Limit to 2-8 highly focused tests maximum
    - Target tests (pick a subset — harness-level tests are lighter-touch):
      - Dry-run smoke test: harness entry point invokes `LanguagePack.extract` then `FrameworkPack.adapt` (not the V2 `pack.enrich()` path)
      - Harness emits candidate counts for each registered framework pack (needed for the identity-equality spot-check in Task Group 7)
    - Tests may be lightweight node scripts or minimal Jest tests if the harness is structured to allow it
  - [x] 6.2 Update `discovery-service/scripts/run-pack-local.ts`
    - Replace the V2 `pack.enrich(...)` call with a two-step invocation: `LanguagePack.extract` -> `FrameworkPack.adapt`
    - Emit candidate counts and enough detail for the identity-equality spot-check
  - [x] 6.3 Update `discovery-service/scripts/run-spring-classic-local.ts`
    - Same V2 -> V3 shape swap; this is the reference harness so update it first if easier
  - [x] 6.4 Update `discovery-service/scripts/run-both-adapters-local.ts` if it exists and is affected
    - Same shape swap
  - [x] 6.5 Update `discovery-service/scripts/batch-validate-packs.sh`
    - Drive the V3 entry point; continue to run against the OpenMRS clone as the parity target
  - [x] 6.6 Run ONLY the 2-8 tests written in 6.1
    - Do NOT run the full test suite yet

**Acceptance Criteria:**
- The 2-8 tests written in 6.1 pass
- `run-pack-local.ts` and siblings invoke `LanguagePack.extract` + `FrameworkPack.adapt` (NOT `pack.enrich`)
- `batch-validate-packs.sh` drives the V3 entry point
- Harness output includes candidate counts and per-candidate detail sufficient for `(type, name, filePath, _addedBy)` spot-check

---

### Acceptance & Test Review

#### Task Group 7: OpenMRS parity verification + test coverage gap review
**Dependencies:** Task Groups 1-6

- [x] 7.0 Run the OpenMRS harness for end-to-end acceptance and fill any critical test gaps
  - [x] 7.1 Review tests from Task Groups 1-6
    - Task Group 1 Java tests (approx 2-8 tests on the tier column plumbing)
    - Task Group 2 pack type tests (approx 2-8)
    - Task Group 3 registry + `computeTier` tests (approx 2-8)
    - Task Group 4 spring-classic migration tests (approx 2-8)
    - Task Group 5 `runDiscoveryV3` orchestrator tests (approx 2-8)
    - Task Group 6 harness tests (approx 2-8)
    - Total existing tests: approximately 12-48 tests across both services
  - [x] 7.2 Run the OpenMRS end-to-end acceptance via the local harness
    - Drive the OpenMRS clone through `runDiscoveryV3` via the updated harness
    - Verify candidate count is within ±2% of the V2 baseline (~1037 candidates)
    - Verify a spot-check of at least 10 known candidates matches by `(type, name, filePath, _addedBy)` identity equality
    - This acceptance lives in the local harness, NOT in CI unit tests
  - [x] 7.3 Analyze test coverage gaps for THIS spec only
    - Identify critical workflows that lack coverage (e.g. tier-B degradation when only `javaLangPack` is registered and no framework matches; tier-C when no packs match at all)
    - Focus ONLY on gaps tied to the V3 pipeline foundation
    - Do NOT assess broader discovery-service or architecture-model-service coverage
  - [x] 7.4 Write up to 10 additional strategic tests maximum
    - Add a maximum of 10 new tests to fill identified critical gaps
    - Candidates for additional tests:
      - Tier B degradation: `runDiscoveryV3` with only a language pack registered produces IR + zero framework candidates + tier `'B'` + stub marker
      - Tier C: `runDiscoveryV3` with no matching packs produces zero candidates + tier `'C'` + stub marker
      - End-to-end: tier persists into `discovery_run.mode` via the Java DTO pipeline (integration test spanning both services if feasible)
    - Skip edge cases, performance tests, accessibility tests unless business-critical
  - [x] 7.5 Run feature-specific tests only
    - Run tests from 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, and 7.4
    - Expected total: approximately 22-58 tests across both services
    - Do NOT run the entire application test suite in either service
    - Verify critical V3 workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 22-58 tests total across both services)
- OpenMRS harness run produces ~1037 spring-classic-adapter candidates (±2%) AND passes the ≥10-candidate identity-equality spot-check
- Critical tier-A / tier-B / tier-C behaviors are covered
- No more than 10 additional tests added when filling gaps
- Testing focused exclusively on this spec's V3 foundation requirements

---

### Documentation

#### Task Group 8: Update `DISCOVERY_SERVICE_EXPLAINER.md`
**Dependencies:** Task Group 7 (document after the implementation is verified against OpenMRS)

- [x] 8.0 Update the discovery service explainer with the V3 section
  - [x] 8.1 Add a V3 section describing:
    - The four-stage pipeline (Stage 1 LanguagePack extract -> Stage 2 FrameworkPack adapt -> Stage 3 gap-fill stub -> Stage 4 merge + persist)
    - The `LanguagePack` + `FrameworkPack` split and how they replace the monolithic V2 `ExtensionPack`
    - The A/B/C tier model (what each tier means and how `computeTier` derives it from techHints)
    - The Stage 3 stub marker (`gapFillStage: "v3-spec1-stub"`, `gapFillCandidates: 0`) and why it exists (so Spec 2 can distinguish stubbed-vs-real-gap-fill-that-produced-zero-gaps)
    - The removal of the V2 runtime path (V2 files remain in-tree but un-registered / un-referenced)
  - [x] 8.2 Cross-reference the persisted `discovery_run.mode` column so operators know where to look for tier observability
  - [x] 8.3 No tests required for documentation — this is a docs-only task group

**Acceptance Criteria:**
- `DISCOVERY_SERVICE_EXPLAINER.md` contains a V3 section covering all five bullets above
- Document reflects V3 as the only runtime pipeline (no feature flag described)
- Document references the new `mode`/`tier` column on `discovery_run`

---

## Execution Order

Recommended implementation sequence (Task Groups 1 and 2 can run in parallel since they touch different services and share no files):

1. **Task Group 1** — Database layer + DTO/mapper (Java / architecture-model-service) — runs in parallel with Task Group 2
2. **Task Group 2** — `LanguagePack` + `FrameworkPack` types (TypeScript) — runs in parallel with Task Group 1
3. **Task Group 3** — Registry refactor (`computeTier`, `findLanguagePack`, `findFrameworkPacks`) — depends on Task Group 2
4. **Task Group 4** — spring-classic migration to `javaLangPack` + `springClassicFrameworkPack` — depends on Task Group 3
5. **Task Group 5** — `discoveryV3Pipeline.ts` orchestrator + wiring into `llmFileAnalysisStep.ts` / `runManager.ts` — depends on Task Groups 1, 3, 4
6. **Task Group 6** — Local harness updates (`run-pack-local.ts`, `batch-validate-packs.sh`, siblings) — depends on Task Group 5
7. **Task Group 7** — OpenMRS parity acceptance + test coverage gap review — depends on Task Groups 1-6
8. **Task Group 8** — `DISCOVERY_SERVICE_EXPLAINER.md` V3 section — depends on Task Group 7
