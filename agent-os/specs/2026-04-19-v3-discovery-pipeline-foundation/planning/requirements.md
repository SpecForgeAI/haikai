# Spec Requirements: V3 Discovery Pipeline Foundation

## Initial Description

Build the scaffolding for the "v3 discovery pipeline" that runs extension packs FIRST and then an LLM gap-fill stage SECOND. This spec covers the core pipeline contract, the pack-interface refactor, and migrating ONE reference pack end-to-end to prove the shape.

Today's V2 pipeline runs the LLM first and extension packs second, unioning two independent producers. V3 inverts this: packs produce deterministic structural facts first, then the LLM adds semantic gap-fill on top. This gives cheaper LLM runs, fail-fast detection of pack regressions, and a deterministic backbone for candidate output.

Packs today bundle (file filter + language extractor + framework adapter) into a single unit. V3 splits this into two tiers so the pipeline can degrade gracefully when no framework adapter matches:
- **LanguagePack** — matches on language, produces Universal IR (`SourceFileIR`)
- **FrameworkPack** — matches on language+technology, consumes IR, emits `DiscoveryCandidate`s

(Original raw idea retained in `planning/raw-idea.md`; updated to reflect the scope shift captured below.)

## Requirements Discussion

### First Round Questions

**Q1:** How should V2 and V3 coexist during and after this spec? Should the V2 runtime path be kept operational in-tree, removed entirely, or kept-but-unreachable so deletion effort is minimized?
**Answer:** V3 replaces V2. V2 code can stay in-tree if deletion is messy (purely dead code / deprecated), but no runtime path routes to it. Prefer keeping V2 files un-registered and un-referenced rather than spending effort on deletion.

**Q2:** Should the `DISCOVERY_PIPELINE_VERSION` feature flag be per-run (DB/API-controlled), process-wide (env var), or developer-only?
**Answer:** Originally process-wide, but combined with the Q5 scope change ("V3 only from now on") the flag is no longer needed for V2/V3 switching. The flag is removed. A dev/test-only override may remain if useful, but the default assumption is no flag at all — V3 runs unconditionally.

**Q3:** Should the computed tier (A/B/C) be persisted on the discovery run entity now, or deferred to Spec 5 (tier-aware UX)?
**Answer:** (Assistant decision — user deferred) YES, persist now. Add a nullable `mode` / `tier` column to `discovery_run` in `architecture-model-service`. Cheap to add now, avoids a duplicate migration in Spec 5, and gives observability benefits from day one.

**Q4:** How should the stubbed Stage 3 signal its presence so downstream tooling can distinguish "no gaps found" from "not implemented yet"?
**Answer:** (Assistant decision — user agreed to pattern, left details to assistant) Stage 3 emits `gapFillStage: "v3-spec1-stub"` and `gapFillCandidates: 0` into the run's `steps_payload`.

**Q5:** How should migrated (V3) and un-migrated (V2) packs interact within the same runtime? Is there any scenario where a V2 pack runs alongside a V3 pack in the same discovery run?
**Answer:** No V2 runtime. Period. Un-migrated packs simply won't activate — Tier B/C handles their absence. Spec 4 migrates them. **This is a significant scope change from the raw idea** — V3 is now the only runtime pipeline, not a parallel path behind a flag.

**Q6:** Should this spec include a shadow-mode where both V2 and V3 run against the same input and diff their outputs for validation?
**Answer:** (Assistant decision — user deferred) DEFER to Spec 3 (eval harness). Shadow-mode validation is what the eval harness is for. Keep this spec focused.

**Q7:** What's the target test coverage? Numeric threshold or focused scenario tests?
**Answer:** (Assistant decision — user deferred) Focused scenario tests over numeric coverage threshold. Specific cases:
- `computeTier()` returns `'A'` when both language and framework match.
- `computeTier()` returns `'B'` when only language matches.
- `computeTier()` returns `'C'` when neither matches.
- `findLanguagePack()` returns the correct pack for Java, TypeScript, etc.
- `findFrameworkPacks()` returns empty when techHints don't match any registered framework.
- `runDiscoveryV3` with spring-classic produces approximately 1037 spring-classic-adapter-tagged candidates on the OpenMRS local harness (tolerance per Q8).

**Q8:** What parity tolerance should the OpenMRS acceptance run enforce — numeric count only, or identity equality on the candidates themselves?
**Answer:** (Assistant decision — user favored quality over decision time) Verify BOTH:
- Count within ±2% of the V2 baseline (~1037).
- A spot-check of at least 10 known candidates by `(type, name, filePath, _addedBy)` identity equality.
Adapter output is deterministic, so identity equality is reasonable. This avoids accepting numerically-correct-but-semantically-drifted output.

**Q9:** Should the `SourceFileIR` / `ClassIR` / `FunctionIR` schema be formalized and versioned as part of this spec, or deferred?
**Answer:** Defer. If Spec 4 (multi-language extractor broadening) covers it, put it in Spec 4. This spec uses the existing IR shape already in `discovery-service/src/services/extensionPacks/languageIR.ts` (`ClassIR` / `FunctionIR` / `FieldIR` / `AnnotationIR`) without formalizing further.

**Q10:** Are there any additional items the user wants explicitly out of scope beyond what the raw idea already lists?
**Answer:** Nothing additional.

### Existing Code to Reference

**Similar Features Identified (all confirmed by user as patterns to model after):**

- V2 spring-classic pack split:
  - `discovery-service/src/services/extensionPacks/springClassicPackV2/index.ts` — the existing extractor side
  - `discovery-service/src/services/extensionPacks/frameworkAdapters/springClassic/index.ts` — the existing adapter side
  - This existing extractor/adapter split IS the V3 model; this spec just formalizes it into the `LanguagePack` + `FrameworkPack` types.
- `discovery-service/src/config.ts` — env-var pattern for any flags (if a dev/test override is kept).
- `discovery-service/src/services/llmFileAnalysisStep.ts` — current pipeline stage orchestration; this is where `runDiscoveryV3` is invoked from.
- `discovery-service/scripts/run-pack-local.ts` and `discovery-service/scripts/batch-validate-packs.sh` — local harness pattern to update for the V3 shape.
- `discovery-service/src/__tests__/extensionPackFramework.test.ts` — predicate / registry test style to follow.
- `discovery-service/src/services/extensionPacks/languageIR.ts` — existing IR type surface (`ClassIR` / `FunctionIR` / `FieldIR` / `AnnotationIR`) used as-is in this spec.

### Follow-up Questions

No follow-up round was needed — decisions were captured in a single consolidated reply from the user, with assistant-owned decisions explicitly marked.

## Visual Assets

### Files Provided

Bash check of `planning/visuals/` returned no visual files.

No visual assets provided. The spec relies on textual architecture descriptions and the existing `DISCOVERY_SERVICE_EXPLAINER.md` for diagrams/flows.

### Visual Insights

Not applicable.

## Requirements Summary

### Functional Requirements

**Pack interface refactor (`discovery-service/src/services/extensionPacks`):**
- Introduce `LanguagePack { id, when: { language }, extract(sourceFiles, techHints) → Map<filePath, SourceFileIR> }`.
- Introduce `FrameworkPack { id, when: { language, technology }, adapt(irFiles, runId, techHints) → DiscoveryCandidate[] }`.
- Retain the legacy `ExtensionPack` TYPE so any remaining V2 files compile, but do not register or invoke them at runtime.

**Registry updates (`extensionPackRegistry.ts`):**
- New registries: `languagePacks[]`, `frameworkPacks[]`. Legacy `packs[]` registry is removed or emptied of runtime registrations.
- New lookups: `findLanguagePack(techHints)`, `findFrameworkPacks(techHints)`, `computeTier(techHints)` returning `'A' | 'B' | 'C'`:
  - `'A'` — a LanguagePack matches AND at least one FrameworkPack matches.
  - `'B'` — a LanguagePack matches but no FrameworkPack matches.
  - `'C'` — neither matches.
- `matchesPredicate` retains per-field AND semantics across techHints (existing fix preserved).

**V3 pipeline (`services/discoveryV3Pipeline.ts`):**
- `runDiscoveryV3(context)` with four stages:
  - Stage 1: resolve LanguagePack → extract IR for applicable files.
  - Stage 2: resolve FrameworkPacks → run their adapters on IR, collect candidates tagged `'<framework>-adapter'` (e.g. `'spring-classic-adapter'`).
  - Stage 3: stubbed. Emits `gapFillStage: "v3-spec1-stub"` and `gapFillCandidates: 0` into the run's `steps_payload`.
  - Stage 4: merge + persist.
- Invoked unconditionally from `llmFileAnalysisStep.ts`. The V2 LLM-first runtime path is no longer reachable.
- Computes the tier via `computeTier(techHints)` and persists it on the run.

**Persistence (architecture-model-service):**
- Add a nullable `mode` (or `tier`) column to `discovery_run` via a new Liquibase changeset in `architecture-model-service/src/main/resources/db/changelog`.
- Surface the column through `DiscoveryRunEntity`, `DiscoveryRunDto`, and the `EntityMapper`.
- `runDiscoveryV3` populates it on every run.

**Reference pack migration — spring-classic:**
- Split into `javaLangPack` (extractor) and `springClassicFrameworkPack` (adapter).
- Remove its V2 `ExtensionPack` runtime registration.
- Update local harness (`scripts/run-pack-local.ts` + `scripts/batch-validate-packs.sh`) to exercise the V3 shape.

**Tests (scenario-driven, no numeric coverage threshold):**
- `computeTier()` returns `'A'` when both language and framework match.
- `computeTier()` returns `'B'` when only language matches.
- `computeTier()` returns `'C'` when neither matches.
- `findLanguagePack()` returns the correct pack for Java and TypeScript.
- `findFrameworkPacks()` returns empty when techHints don't match any registered framework.
- `runDiscoveryV3` with spring-classic produces ~1037 candidates tagged `spring-classic-adapter` on the OpenMRS local harness, verified by BOTH:
  - Count within ±2% of the baseline, AND
  - A spot-check of at least 10 known candidates by `(type, name, filePath, _addedBy)` identity equality.
- Stage 3 stub marker (`gapFillStage: "v3-spec1-stub"`, `gapFillCandidates: 0`) appears in `steps_payload` for every V3 run.

**Documentation:**
- Update `DISCOVERY_SERVICE_EXPLAINER.md` with a V3 section describing the four stages, the LanguagePack / FrameworkPack split, the tier model, and the removal of the V2 runtime path.

### Reusability Opportunities

- Reuse the existing extractor/adapter separation already present in `springClassicPackV2/index.ts` + `frameworkAdapters/springClassic/index.ts` — formalize it into typed `LanguagePack` / `FrameworkPack` rather than re-architect.
- Reuse existing IR types from `extensionPacks/languageIR.ts` unchanged — no schema churn in this spec.
- Reuse the local-harness script scaffolding (`run-pack-local.ts`, `batch-validate-packs.sh`) — update shape, keep the pattern.
- Reuse the predicate / registry test style from `extensionPackFramework.test.ts` for the new `computeTier` / `findLanguagePack` / `findFrameworkPacks` tests.
- Reuse `config.ts` env-var pattern if a dev/test override flag is retained.
- Reuse Liquibase changeset patterns already in `db/changelog/db.changelog-master.yaml` for the `discovery_run.mode` column.
- Reuse the `DiscoveryRunEntity` / `DiscoveryRunDto` / `EntityMapper` plumbing pattern for the new nullable column.

### Scope Boundaries

**In Scope:**
- `LanguagePack` + `FrameworkPack` type introduction in the pack framework.
- Registry updates including `computeTier`, `findLanguagePack`, `findFrameworkPacks`.
- `runDiscoveryV3` with four stages (Stage 3 stubbed).
- Unconditional wiring of V3 into `llmFileAnalysisStep.ts`; removal of V2 runtime routing.
- Persistence of the computed tier on `discovery_run` (new nullable column + DTO/mapper plumbing).
- Stage 3 stub marker (`gapFillStage: "v3-spec1-stub"`, `gapFillCandidates: 0`) in `steps_payload`.
- Migration of the spring-classic pack to the V3 shape as the reference implementation.
- Local harness update to call the V3 shape.
- Scenario tests as listed above.
- OpenMRS end-to-end parity verification (count ±2% AND ≥10-candidate spot-check).
- `DISCOVERY_SERVICE_EXPLAINER.md` documentation update.

**Out of Scope:**
- Prompt architecture (Spec 2).
- Real LLM gap-fill (Spec 2) — Stage 3 is stubbed here.
- Evaluation harness / shadow-mode V2-vs-V3 diffing (Spec 3).
- Migration of any pack other than spring-classic (Spec 4).
- Tier-aware user warnings / confidence propagation / opt-in UX (Spec 5).
- `SourceFileIR` / `ClassIR` / `FunctionIR` schema formalization and versioning (Spec 4).
- V2 runtime path — removed, not maintained. V2 files may remain in-tree as dead code only if deletion is disruptive.
- Deletion of V2 files purely for cleanliness — prefer un-registering / un-referencing.
- Tier B/C progressive-degradation behavioral spec — exists elsewhere in the V3 plan; this spec only requires that the V3 pipeline continues to run regardless of pack coverage.
- Numeric test-coverage thresholds.
- Per-run or API-controlled `DISCOVERY_PIPELINE_VERSION` flag — feature flag removed entirely (dev/test-only override may exist at implementer discretion).

### Technical Considerations

- **Predicate semantics:** `matchesPredicate` must preserve per-field AND across techHints (the recent fix). Service-scoped runs build techHints via `parseCoretech()` — one field per hint.
- **Candidate tagging:** Framework adapter candidates continue to carry `_addedBy: '<framework>-adapter'` (e.g. `'spring-classic-adapter'`). Existing downstream consumers rely on this tag shape.
- **Determinism:** Adapter output must remain deterministic across runs on the same input so identity-equality spot-checks are stable.
- **No V2 runtime:** `llmFileAnalysisStep.ts` no longer invokes the V2 LLM-first path. V2 pack files may remain un-registered if deletion is disruptive.
- **Pack absence is fine:** If no FrameworkPack matches the techHints, the V3 pipeline still runs and degrades to Tier B / C (behavior detailed in other V3 specs). This spec only guarantees that V3 is the unconditional runtime entry point.
- **Database migration:** The new nullable `mode` / `tier` column on `discovery_run` ships as a Liquibase changeset alongside DTO + mapper changes. Because the column is nullable, existing rows are unaffected.
- **Observability:** Persisted tier + `gapFillStage` marker in `steps_payload` together let operators distinguish (a) which runs were Tier A/B/C and (b) whether Stage 3 was a stub vs. a real gap-fill that produced zero gaps.
- **Local harness:** `scripts/run-pack-local.ts` and `batch-validate-packs.sh` must be the primary vehicle for the OpenMRS parity check — the acceptance criterion lives there, not in CI unit tests.
- **IR stability:** The `SourceFileIR` shape is frozen at its current form for this spec; any evolution happens in Spec 4. Treat the existing `languageIR.ts` types as the contract.
- **Tech stack touchpoints:** changes span `discovery-service` (TypeScript/Node) and `architecture-model-service` (Java/Spring Boot + Liquibase). Coordinate DTO shape between the two.
