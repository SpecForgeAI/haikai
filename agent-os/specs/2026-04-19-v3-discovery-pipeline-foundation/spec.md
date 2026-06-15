# Specification: V3 Discovery Pipeline Foundation

## Goal
Invert the discovery pipeline so deterministic extension packs run FIRST and LLM gap-fill runs SECOND, and split the pack interface into `LanguagePack` + `FrameworkPack` tiers. V3 becomes the ONLY runtime pipeline; one reference pack (spring-classic) is migrated end-to-end to prove the shape.

## User Stories
- As a discovery pipeline operator, I want packs to produce deterministic structural facts before any LLM call so that pack regressions fail fast and LLM runs are cheaper and bounded.
- As a platform engineer, I want every discovery run to record its computed tier (A/B/C) so I can distinguish full-coverage runs from language-only or LLM-only runs without re-deriving the state.
- As a pack author, I want a typed `LanguagePack` / `FrameworkPack` contract so I can write a language extractor once and reuse it across frameworks.

## Specific Requirements

**Introduce `LanguagePack` and `FrameworkPack` types**
- Add `LanguagePack { id, when: { language }, extract(sourceFiles, techHints) => Map<filePath, SourceFileIR> }` in `discovery-service/src/services/extensionPacks`.
- Add `FrameworkPack { id, when: { language, technology }, adapt(irFiles, runId, techHints) => DiscoveryCandidate[] }`.
- Retain the legacy `ExtensionPack` TYPE in `types/extensionPack.ts` so un-migrated V2 pack FILES still compile.
- Do NOT register any V2 pack at runtime in V3; V2 files stay in-tree as un-referenced code.
- Reuse the existing IR shape from `extensionPacks/languageIR.ts` (`SourceFileIR` / `ClassIR` / `FunctionIR` / `FieldIR` / `AnnotationIR`) unchanged — no schema formalization in this spec.

**Refactor `extensionPackRegistry.ts`**
- Introduce `languagePacks[]` and `frameworkPacks[]` registries with `registerLanguagePack()` / `registerFrameworkPack()` functions.
- Remove (or empty) the legacy `packs[]` runtime registrations; keep `clearRegistry()`-style test helpers updated to cover the new registries.
- Add `findLanguagePack(techHints)` returning the first matching `LanguagePack` (or `null`).
- Add `findFrameworkPacks(techHints)` returning all matching `FrameworkPack`s.
- Add `computeTier(techHints): 'A' | 'B' | 'C'` — `'A'` = language + framework match, `'B'` = language only, `'C'` = neither.
- Preserve the existing `matchesPredicate` per-field AND semantics so classic-Spring techHints (`{language:'Java'}`, `{technology:'Spring'}`) match `{language:'Java', technology:'Spring'}` but not `{language:'Java', technology:'Spring Boot'}`.

**Create `runDiscoveryV3` pipeline**
- New file `discovery-service/src/services/discoveryV3Pipeline.ts` exporting `runDiscoveryV3(context)`.
- Stage 1: call `findLanguagePack(techHints)`; if present, run `extract()` across applicable source files to build the `Map<filePath, SourceFileIR>`.
- Stage 2: call `findFrameworkPacks(techHints)`; for each, invoke `adapt()` on the IR map and collect `DiscoveryCandidate`s tagged `_addedBy: '<framework>-adapter'` (e.g. `'spring-classic-adapter'`).
- Stage 3: stub only — write `gapFillStage: "v3-spec1-stub"` and `gapFillCandidates: 0` into the run's `steps_payload`. Do not invoke any LLM.
- Stage 4: merge candidates and persist via existing candidate-save paths; compute tier via `computeTier(techHints)` and pass it through to the run record.
- Invoke `runDiscoveryV3` unconditionally from `llmFileAnalysisStep.ts`; delete/remove the V2 LLM-first runtime invocation path (keep dead V2 files unlinked rather than churning deletion).
- No `DISCOVERY_PIPELINE_VERSION` feature flag; V3 is unconditional. A dev/test-only env override MAY exist at implementer discretion but is not required.

**Persist computed tier on `discovery_run`**
- Add a new Liquibase changeset under `architecture-model-service/src/main/resources/db/changelog/sql/` adding a nullable `mode` (or `tier`) column to `discovery_run`; wire it into `db.changelog-master.yaml`.
- Update `DiscoveryRunEntity.java` with the new column mapping.
- Update `DiscoveryRunDto.java` with the new field (nullable).
- Update `EntityMapper.java` to read/write the tier between entity and DTO.
- `runDiscoveryV3` populates the tier on every run (`'A' | 'B' | 'C'`). Existing rows stay null — safe because the column is nullable.

**Migrate spring-classic as the reference V3 pack**
- Split `springClassicPackV2/index.ts` into:
  - `javaLangPack` (new `LanguagePack`) wrapping the existing `extractJavaIR` + `filterJavaFiles` + `isTestFile` logic to produce `Map<filePath, SourceFileIR>`.
  - `springClassicFrameworkPack` (new `FrameworkPack`) that consumes IR and calls the existing `runSpringClassicAdapter`.
- Remove the V2 `registerPack(springClassicPackV2)` call from `extensionPacks/register.ts`; replace with `registerLanguagePack(javaLangPack)` + `registerFrameworkPack(springClassicFrameworkPack)`.
- Framework adapter output must remain deterministic and continue tagging candidates with `_addedBy: 'spring-classic-adapter'`.
- Do NOT migrate any other pack in this spec — the other 17 V2 packs stay un-registered (Tier B/C handles their absence) until Spec 4.

**Update local harness scripts**
- Update `discovery-service/scripts/run-pack-local.ts` (and any affected helper in `run-spring-classic-local.ts` / `run-both-adapters-local.ts`) to invoke the V3 shape — wire `LanguagePack.extract` then `FrameworkPack.adapt` instead of the V2 `pack.enrich()` call.
- Update `discovery-service/scripts/batch-validate-packs.sh` to drive the V3 entry point and continue to run against the OpenMRS clone as the parity target.
- Harness must emit candidate counts and enough detail for the identity-equality spot-check below.

**OpenMRS end-to-end acceptance**
- Running `runDiscoveryV3` via the local harness against the OpenMRS clone must produce candidates tagged `spring-classic-adapter` satisfying BOTH:
  - Count within ±2% of the V2 baseline (~1037 candidates).
  - A spot-check of at least 10 known candidates matching by `(type, name, filePath, _addedBy)` identity equality.
- Acceptance lives in the local harness (not in CI unit tests) because it needs the OpenMRS checkout.

**Scenario tests**
- `computeTier()` returns `'A'` when both language and framework packs match.
- `computeTier()` returns `'B'` when only a language pack matches.
- `computeTier()` returns `'C'` when neither matches.
- `findLanguagePack()` returns the correct pack for Java (and for TypeScript once/if a language pack is registered in-test).
- `findFrameworkPacks()` returns empty when techHints don't match any registered framework.
- `runDiscoveryV3` writes `gapFillStage: "v3-spec1-stub"` and `gapFillCandidates: 0` into `steps_payload` on every run.
- Model the test style on `discovery-service/src/__tests__/extensionPackFramework.test.ts`; no numeric coverage threshold.

**Persist and surface Stage 3 stub marker**
- `runDiscoveryV3` must write `gapFillStage: "v3-spec1-stub"` and `gapFillCandidates: 0` into the run's `steps_payload` so Spec 2 (real gap-fill) can distinguish "stubbed" from "implemented, produced zero gaps".
- Do not emit any LLM calls, prompts, or placeholder candidates from Stage 3 in this spec.

**Documentation**
- Update `DISCOVERY_SERVICE_EXPLAINER.md` with a V3 section covering: the four-stage pipeline, the `LanguagePack` + `FrameworkPack` split, the A/B/C tier model, the Stage 3 stub marker, and the removal of the V2 runtime path.

## Existing Code to Leverage

**`discovery-service/src/services/extensionPacks/springClassicPackV2/index.ts`**
- Already demonstrates the extractor/adapter split (calls `extractJavaIR` then `runSpringClassicAdapter`).
- Split body directly into the new `javaLangPack.extract` and `springClassicFrameworkPack.adapt` implementations — no adapter logic change required.
- Preserves the existing `filterJavaFiles` + `isTestFile` filtering on the LanguagePack side.

**`discovery-service/src/services/extensionPacks/frameworkAdapters/springClassic/index.ts`**
- `runSpringClassicAdapter(irFiles, runId)` is reusable as-is inside `springClassicFrameworkPack.adapt`.
- Candidate tag format `_addedBy: 'spring-classic-adapter'` already matches the V3 contract.

**`discovery-service/src/services/extensionPacks/languageIR.ts`**
- `SourceFileIR`, `ClassIR`, `FunctionIR`, `FieldIR`, `AnnotationIR` form the contract between LanguagePack and FrameworkPack — import and reuse unchanged.
- Helpers `hasAnnotation` / `findAnnotation` / `annotationArg` continue to serve adapters.

**`discovery-service/src/services/extensionPackRegistry.ts`**
- `matchesPredicate` per-field AND semantics (the recent fix) carry over unchanged — reuse for both `findLanguagePack` and `findFrameworkPacks`.
- `clearRegistry()` / `getRegisteredPackCount()` patterns should be mirrored for the new registries.

**`discovery-service/scripts/run-pack-local.ts` + `batch-validate-packs.sh`**
- Existing harness pattern for running a pack against a local clone (OpenMRS) is the acceptance vehicle — update call sites to the V3 shape, keep the orchestration pattern.
- `run-spring-classic-local.ts` already targets the reference pack and should be updated first.

**`architecture-model-service/src/main/resources/db/changelog/sql/065-discovery-run.sql` + sibling changesets**
- Existing Liquibase changeset style (numbered SQL file + entry in `db.changelog-master.yaml`) is the pattern for adding the nullable `mode` column.
- `DiscoveryRunEntity` / `DiscoveryRunDto` / `EntityMapper` wiring follows the same pattern as the recent `serviceId` column addition.

## Out of Scope
- Real LLM gap-fill logic (Spec 2) — Stage 3 stays stubbed.
- Prompt architecture design (Spec 2).
- Evaluation harness / shadow-mode V2-vs-V3 diffing (Spec 3).
- Migration of any pack other than spring-classic — the other 17 V2 packs remain un-registered (Spec 4).
- Tier-aware UX, user warnings, confidence propagation, opt-in flows (Spec 5).
- `SourceFileIR` / `ClassIR` / `FunctionIR` schema formalization and versioning (Spec 4).
- Deletion of V2 pack files purely for cleanliness — prefer un-registering over churny deletion.
- Per-run or API-controlled `DISCOVERY_PIPELINE_VERSION` feature flag — removed entirely.
- Tier B/C progressive-degradation behavioral specification — covered in other V3 specs; this spec only requires V3 remains the runtime path regardless of pack coverage.
- Numeric test-coverage thresholds.
